//! The pictures' frame route in the shell (the camera pictures, D28).
//!
//! At each start of the hardware link the shell opens a listener on
//! 127.0.0.1, at a port the system picks, with a secret of 32 random bytes,
//! and puts both into the engine's environment (`engine.rs`); the engine
//! hands them to the pictures helper alone. The helper connects, says the
//! secret, and sends frames: a header (`FrameHeader`), then the picture. The
//! shell keeps the newest frame of each camera, and the page takes them
//! with `pictures_next`, a raw answer that is an `ArrayBuffer` in the page,
//! over the IPC protocol the page's connection policy already allows. Only
//! the main window may call it (`shell_commands::window_may_call`). The
//! engine never holds a picture.
//!
//! One take brings the three cameras' newest frames, back to back, and waits
//! in the shell for the next when none is new: about one take a frame of the
//! helper's, where a take for each camera and a short rest between them made
//! about 140 a second, and the pages' requests to the hardware link waited
//! behind them (the measurement of 2026-09-29).
//!
//! What guards it:
//!
//! - It listens on 127.0.0.1 alone. Any program on this PC can connect: a
//!   connection that does not say the secret within a second is closed, and
//!   the secret is compared in the same time whatever its difference. At
//!   most `MAX_HANDSHAKES` wait to say it at once; one more is closed at
//!   once, so a flood of connections costs the pictures and never the shell,
//!   which is also the window's process.
//! - One connection at a time: a new one that says the secret replaces the
//!   old, for a helper started again says the same secret. The next start of
//!   the hardware link has a secret of its own.
//! - A header is held to what a frame may be before a byte of its picture is
//!   kept, and a frame that stalls halfway closes the connection.
//! - The secret is in no log line and no answer to the page.
//! - A frame nobody took is replaced by the next, so a slow page skips
//!   frames and never queues them; the counts go to `shell.log` once a
//!   minute while frames arrive.

use crate::shell_commands::off_main_thread;
use crate::EngineState;
use std::io::{self, ErrorKind, Read};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::pictures::{
    constant_time_eq, FrameHeader, FRAME_HEADER_LEN, LINK_SECRET_HEX,
};

/// How long a connection has to say the secret.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(1);
/// How long a frame's bytes may stall once the frame began. Between frames
/// there is no limit: the helper sends nothing while the page is closed.
const FRAME_STALL: Duration = Duration::from_secs(2);
/// How often the counts are logged while frames arrive.
const COUNT_INTERVAL: Duration = Duration::from_secs(60);
/// Connections that may wait to say the secret at once.
const MAX_HANDSHAKES: usize = 8;
/// The rest after an accept that failed (the system out of sockets).
const ACCEPT_FAILED_REST: Duration = Duration::from_millis(50);
/// How long a take waits for a frame when none is new: also about how long
/// the page's last take outlives the page (with the gather, up to 258 ms),
/// and how often a page with no pictures asks.
const TAKE_WAIT: Duration = Duration::from_millis(250);
/// After a take's first new frame, how long it waits for the others of the
/// helper's tick, which the helper writes back to back: well under a frame
/// (33 ms), so none is replaced while it waits. It waits for all three, so
/// with a camera that sends nothing every answer waits it out; and a
/// Condvar's wait on Windows ends on the system's timer tick, so it is
/// nearer 16 ms there. Latency only, still under a frame.
const TAKE_GATHER: Duration = Duration::from_millis(8);

/// Where the frame route's lines go: `shell.log`, or a test's list.
pub(crate) type PicturesLog = Arc<dyn Fn(&str) + Send + Sync>;

/// What the frame route did since the last count.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Counts {
    pub received: u64,
    pub taken: u64,
    /// Replaced by a newer frame before the page took it.
    pub skipped: u64,
    /// Connections that did not say the secret.
    pub refused: u64,
}

struct Frame {
    /// The header and the picture, as the page takes them.
    bytes: Vec<u8>,
}

/// The newest frame of each camera, for the shell's life.
#[derive(Default)]
pub(crate) struct PicturesStore {
    newest: Mutex<[Option<Frame>; 3]>,
    /// Told of each frame kept, for a take that waits.
    arrived: Condvar,
    counts: Mutex<Counts>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Waits on `arrived` for at most `left`, poisoning set aside as `lock` does.
fn wait_for<'a, T>(
    arrived: &Condvar,
    guard: MutexGuard<'a, T>,
    left: Duration,
) -> MutexGuard<'a, T> {
    match arrived.wait_timeout(guard, left) {
        Ok((guard, _)) => guard,
        Err(poisoned) => poisoned.into_inner().0,
    }
}

/// Frames as one answer, back to back in camera order: each is its header
/// and its picture, so the page reads where the next begins.
fn back_to_back(mut frames: Vec<Frame>) -> Vec<u8> {
    if frames.len() == 1 {
        return frames.remove(0).bytes;
    }
    let mut answer = Vec::with_capacity(frames.iter().map(|frame| frame.bytes.len()).sum());
    for frame in frames {
        answer.extend_from_slice(&frame.bytes);
    }
    answer
}

impl PicturesStore {
    /// Keeps a frame, while `still` says its connection is the current one:
    /// asked under the lock a new start's `clear` takes, so no frame of the
    /// last start's helper survives into this one.
    fn put(&self, camera: u8, bytes: Vec<u8>, still: &dyn Fn() -> bool) {
        let Some(index) = usize::from(camera)
            .checked_sub(1)
            .filter(|index| *index < 3)
        else {
            return;
        };
        let replaced = {
            let mut newest = lock(&self.newest);
            if !still() {
                return;
            }
            newest[index].replace(Frame { bytes }).is_some()
        };
        self.arrived.notify_all();
        let mut counts = lock(&self.counts);
        counts.received += 1;
        if replaced {
            counts.skipped += 1;
        }
    }

    /// The cameras' newest frames, each once, back to back in camera order:
    /// empty when none is new after `wait`. After the first new frame it
    /// waits up to `gather` for the others of the helper's tick, and no
    /// longer once all three are there. Blocking: the command runs it off the
    /// async runtime.
    pub(crate) fn take(&self, wait: Duration, gather: Duration) -> Vec<u8> {
        let deadline = Instant::now() + wait;
        let mut newest = lock(&self.newest);
        while newest.iter().all(Option::is_none) {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Vec::new();
            }
            newest = wait_for(&self.arrived, newest, left);
        }
        let gathered = Instant::now() + gather;
        while newest.iter().any(Option::is_none) {
            let left = gathered.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            newest = wait_for(&self.arrived, newest, left);
        }
        let frames: Vec<Frame> = newest.iter_mut().filter_map(Option::take).collect();
        drop(newest);
        lock(&self.counts).taken += frames.len() as u64;
        back_to_back(frames)
    }

    fn refused(&self) {
        lock(&self.counts).refused += 1;
    }

    /// The counts since the last call.
    fn take_counts(&self) -> Counts {
        std::mem::take(&mut *lock(&self.counts))
    }

    /// A new start: the last helper's frames are not this one's.
    fn clear(&self) {
        *lock(&self.newest) = Default::default();
    }
}

/// The listener of one start of the hardware link. Dropped with that
/// start's process, it stops listening, and its connection ends.
pub(crate) struct PicturesLink {
    address: SocketAddr,
    secret: String,
    closed: Arc<AtomicBool>,
}

impl PicturesLink {
    /// Opens a listener on 127.0.0.1 with a new secret.
    pub(crate) fn open(store: Arc<PicturesStore>, log: PicturesLog) -> io::Result<Self> {
        Self::open_with(store, log, HANDSHAKE_TIMEOUT)
    }

    /// `open`, with the time a connection has to say the secret: the tests'
    /// is longer, so what refuses a connection sooner can only be the cap.
    fn open_with(
        store: Arc<PicturesStore>,
        log: PicturesLog,
        handshake: Duration,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let address = listener.local_addr()?;
        let secret = new_secret()?;
        let closed = Arc::new(AtomicBool::new(false));
        store.clear();
        {
            let secret = secret.clone();
            let store = Arc::clone(&store);
            let closed = Arc::clone(&closed);
            let log = Arc::clone(&log);
            thread::Builder::new()
                .name(String::from("pictures-listener"))
                .spawn(move || accept(&listener, &secret, handshake, &store, &closed, &log))?;
        }
        {
            let closed = Arc::clone(&closed);
            let _ = thread::Builder::new()
                .name(String::from("pictures-counts"))
                .spawn(move || log_counts(&store, &closed, &log));
        }
        Ok(Self {
            address,
            secret,
            closed,
        })
    }

    pub(crate) fn address(&self) -> SocketAddr {
        self.address
    }

    pub(crate) fn secret(&self) -> &str {
        &self.secret
    }
}

impl Drop for PicturesLink {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
        // The listener waits in `accept`: a connection wakes it to see that
        // it is closed.
        let _ = TcpStream::connect_timeout(&self.address, Duration::from_millis(200));
    }
}

/// 32 bytes of the operating system's randomness, as hex.
fn new_secret() -> io::Result<String> {
    let mut bytes = [0_u8; LINK_SECRET_HEX / 2];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn accept(
    listener: &TcpListener,
    secret: &str,
    handshake: Duration,
    store: &Arc<PicturesStore>,
    closed: &Arc<AtomicBool>,
    log: &PicturesLog,
) {
    // The connection that may send frames; each one's own number.
    let current = Arc::new(AtomicU64::new(0));
    // The connections still to say the secret.
    let handshaking = Arc::new(AtomicUsize::new(0));
    let mut number = 0_u64;
    for stream in listener.incoming() {
        if closed.load(Ordering::SeqCst) {
            return;
        }
        let Ok(stream) = stream else {
            thread::sleep(ACCEPT_FAILED_REST);
            continue;
        };
        if handshaking.load(Ordering::SeqCst) >= MAX_HANDSHAKES {
            store.refused();
            let _ = stream.shutdown(Shutdown::Both);
            continue;
        }
        handshaking.fetch_add(1, Ordering::SeqCst);
        number += 1;
        let (secret, store, closed, current, handshaking_now, log) = (
            secret.to_string(),
            Arc::clone(store),
            Arc::clone(closed),
            Arc::clone(&current),
            Arc::clone(&handshaking),
            Arc::clone(log),
        );
        // A connection of its own, so one that says nothing never holds the
        // listener.
        let spawned = thread::Builder::new()
            .name(String::from("pictures-connection"))
            .spawn(move || {
                serve(
                    stream,
                    number,
                    &secret,
                    handshake,
                    &store,
                    &closed,
                    &current,
                    &handshaking_now,
                    &log,
                );
            });
        if spawned.is_err() {
            handshaking.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn serve(
    mut stream: TcpStream,
    number: u64,
    secret: &str,
    handshake: Duration,
    store: &PicturesStore,
    closed: &AtomicBool,
    current: &AtomicU64,
    handshaking: &AtomicUsize,
    log: &PicturesLog,
) {
    let said = !closed.load(Ordering::SeqCst) && says_the_secret(&mut stream, secret, handshake);
    handshaking.fetch_sub(1, Ordering::SeqCst);
    if closed.load(Ordering::SeqCst) {
        return;
    }
    if !said {
        store.refused();
        let _ = stream.shutdown(Shutdown::Both);
        return;
    }
    if stream.set_read_timeout(Some(FRAME_STALL)).is_err() {
        return;
    }
    current.store(number, Ordering::SeqCst);
    log("The pictures helper is connected.");
    let is_current = || current.load(Ordering::SeqCst) == number && !closed.load(Ordering::SeqCst);
    match read_frames(&mut stream, store, &is_current) {
        Ok(()) => {}
        Err(why) => log(&format!("The pictures' connection closed: {why}.")),
    }
    let _ = stream.shutdown(Shutdown::Both);
}

/// Reads the first line, bounded, within `handshake`, and compares it with
/// the secret.
fn says_the_secret(stream: &mut TcpStream, secret: &str, handshake: Duration) -> bool {
    let deadline = Instant::now() + handshake;
    let mut line = Vec::with_capacity(LINK_SECRET_HEX + 2);
    let mut byte = [0_u8; 1];
    while line.len() <= LINK_SECRET_HEX + 1 {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() || stream.set_read_timeout(Some(left)).is_err() {
            return false;
        }
        match stream.read(&mut byte) {
            Ok(1) if byte[0] == b'\n' => {
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return constant_time_eq(&line, secret.as_bytes());
            }
            Ok(1) => line.push(byte[0]),
            _ => return false,
        }
    }
    false
}

fn timed_out(error: &io::Error) -> bool {
    matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)
}

/// Reads frames until the helper closes the connection, a frame is not one,
/// or another connection took this one's place.
fn read_frames(
    stream: &mut impl Read,
    store: &PicturesStore,
    is_current: &dyn Fn() -> bool,
) -> Result<(), String> {
    let mut header = [0_u8; FRAME_HEADER_LEN];
    loop {
        if !is_current() {
            return Ok(());
        }
        // Between frames: as long as it takes.
        match stream.read(&mut header[..1]) {
            Ok(0) => return Err(String::from("the helper closed it")),
            Ok(_) => {}
            Err(error) if timed_out(&error) => continue,
            Err(error) => return Err(error.to_string()),
        }
        stream
            .read_exact(&mut header[1..])
            .map_err(|error| format!("a frame's header stalled ({error})"))?;
        let frame = FrameHeader::decode(&header).map_err(|why| format!("not a frame: {why}"))?;
        let length = usize::try_from(frame.length).map_err(|error| error.to_string())?;
        let mut bytes = Vec::with_capacity(FRAME_HEADER_LEN + length);
        bytes.extend_from_slice(&header);
        bytes.resize(FRAME_HEADER_LEN + length, 0);
        stream
            .read_exact(&mut bytes[FRAME_HEADER_LEN..])
            .map_err(|error| format!("a frame's picture stalled ({error})"))?;
        store.put(frame.camera, bytes, is_current);
    }
}

fn log_counts(store: &PicturesStore, closed: &AtomicBool, log: &PicturesLog) {
    let mut last = Instant::now();
    while !closed.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(250));
        if last.elapsed() < COUNT_INTERVAL {
            continue;
        }
        last = Instant::now();
        let counts = store.take_counts();
        if counts.received > 0 || counts.refused > 0 {
            log(&format!(
                "Pictures in the last minute: {} frames received, {} taken by the page, {} replaced before they were taken, {} connections refused.",
                counts.received, counts.taken, counts.skipped, counts.refused
            ));
        }
    }
}

/// The page takes the cameras' newest frames: each its header and picture,
/// back to back, as one `ArrayBuffer`; empty when none came within
/// `TAKE_WAIT`. The wait runs on the blocking pool, so it holds neither the
/// async runtime nor the window's thread, and the pages' other requests go
/// on meanwhile.
#[tauri::command]
pub(crate) async fn pictures_next(
    state: tauri::State<'_, EngineState>,
) -> Result<tauri::ipc::Response, String> {
    let bridge = Arc::clone(&state.bridge);
    let frames =
        off_main_thread(move || Ok(bridge.pictures().take(TAKE_WAIT, TAKE_GATHER))).await?;
    Ok(tauri::ipc::Response::new(frames))
}

/// Says `secret` on a new connection to `address`: the helper's side, for
/// the tests and the lane.
#[cfg(test)]
pub(crate) fn connect_saying(address: SocketAddr, secret: &str) -> io::Result<TcpStream> {
    use std::io::Write;
    let mut stream = TcpStream::connect(address)?;
    writeln!(stream, "{secret}")?;
    Ok(stream)
}

#[cfg(test)]
mod tests;
