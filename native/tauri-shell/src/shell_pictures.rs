//! The pictures' link in the shell (the camera pictures, D28 and D30).
//!
//! The pictures helper draws the pictures itself, into a composition surface
//! the shell puts over the Cameras page (`shell_picture_layer.rs`). No
//! picture passes the shell or the page. What the shell keeps is the link on
//! which the helper is handed its surface and told what to draw.
//!
//! At each start of the hardware link the shell opens a listener on
//! 127.0.0.1, at a port the system picks, with a secret of 32 random bytes,
//! and puts both into the engine's environment (`engine.rs`); the engine
//! hands them to the pictures helper alone. The helper connects, says the
//! secret, and then says hello with its process (`picture_layer`'s lines).
//! The layer makes a surface for that connection and says on it what to
//! draw, as the page reports it (`pictures_place`). Only the main window may
//! call that command (`shell_commands::window_may_call`).
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
//! - The process a surface is handed to is the one the connection named
//!   after the secret: the secret is the trust, and the shell opens that
//!   process for nothing but handing it the one handle.
//! - The secret is in no log line and no answer to the page.

use std::io::{self, ErrorKind, Read};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::picture_layer::{placement, FromLayerHelper, PlaceReport};
use studio_control_protocol::pictures::{constant_time_eq, from_line, LINK_SECRET_HEX};

/// How long a connection has to say the secret, and then hello.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(1);
/// How often a connection that waits for its end looks whether it is still
/// the current one.
const LINK_WAKE: Duration = Duration::from_secs(2);
/// How long a line to the helper may take to write.
const WRITE_TIMEOUT: Duration = Duration::from_secs(1);
/// How often refused connections are logged, while there are any.
const COUNT_INTERVAL: Duration = Duration::from_secs(60);
/// Connections that may wait to say the secret at once.
const MAX_HANDSHAKES: usize = 8;
/// The rest after an accept that failed (the system out of sockets).
const ACCEPT_FAILED_REST: Duration = Duration::from_millis(50);
/// The longest hello a connection may say.
const MAX_HELLO_BYTES: usize = 128;

/// Where the link's lines go: `shell.log`, or a test's list.
pub(crate) type PicturesLog = Arc<dyn Fn(&str) + Send + Sync>;

/// What a helper's connection asks of the native layer.
pub(crate) trait LayerSink: Send + Sync {
    /// The helper said hello on connection `number`: a surface for its
    /// process, said to it on `writer`.
    fn attach(&self, number: u64, pid: u32, writer: TcpStream);
    /// Connection `number` ended: its surface goes.
    fn detach(&self, number: u64);
}

/// The sink of a system without the layer: the helper gets no surface.
#[cfg(not(windows))]
pub(crate) struct NoLayer;

#[cfg(not(windows))]
impl LayerSink for NoLayer {
    fn attach(&self, _number: u64, _pid: u32, _writer: TcpStream) {}
    fn detach(&self, _number: u64) {}
}

/// The listener of one start of the hardware link. Dropped with that
/// start's process, it stops listening, and its connection ends.
pub(crate) struct PicturesLink {
    address: SocketAddr,
    secret: String,
    closed: Arc<AtomicBool>,
    /// Connections that did not say the secret, since the last count.
    #[cfg(test)]
    refused: Arc<AtomicU64>,
}

impl PicturesLink {
    /// Opens a listener on 127.0.0.1 with a new secret.
    pub(crate) fn open(log: PicturesLog, layer: Arc<dyn LayerSink>) -> io::Result<Self> {
        Self::open_with(log, layer, HANDSHAKE_TIMEOUT)
    }

    /// `open`, with the time a connection has to say the secret: the tests'
    /// is longer, so what refuses a connection sooner can only be the cap.
    fn open_with(
        log: PicturesLog,
        layer: Arc<dyn LayerSink>,
        handshake: Duration,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let address = listener.local_addr()?;
        let secret = new_secret()?;
        let closed = Arc::new(AtomicBool::new(false));
        let refused = Arc::new(AtomicU64::new(0));
        {
            let secret = secret.clone();
            let closed = Arc::clone(&closed);
            let refused = Arc::clone(&refused);
            let log = Arc::clone(&log);
            thread::Builder::new()
                .name(String::from("pictures-listener"))
                .spawn(move || {
                    accept(
                        &listener, &secret, handshake, &layer, &closed, &refused, &log,
                    )
                })?;
        }
        {
            let closed = Arc::clone(&closed);
            let refused = Arc::clone(&refused);
            let _ = thread::Builder::new()
                .name(String::from("pictures-counts"))
                .spawn(move || log_refused(&refused, &closed, &log));
        }
        Ok(Self {
            address,
            secret,
            closed,
            #[cfg(test)]
            refused,
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
    layer: &Arc<dyn LayerSink>,
    closed: &Arc<AtomicBool>,
    refused: &Arc<AtomicU64>,
    log: &PicturesLog,
) {
    // The connection the layer serves; each one's own number.
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
            refused.fetch_add(1, Ordering::SeqCst);
            let _ = stream.shutdown(Shutdown::Both);
            continue;
        }
        handshaking.fetch_add(1, Ordering::SeqCst);
        number += 1;
        let connection = Connection {
            number,
            secret: secret.to_string(),
            handshake,
            layer: Arc::clone(layer),
            closed: Arc::clone(closed),
            refused: Arc::clone(refused),
            current: Arc::clone(&current),
            handshaking: Arc::clone(&handshaking),
            log: Arc::clone(log),
        };
        // A connection of its own, so one that says nothing never holds the
        // listener.
        let spawned = thread::Builder::new()
            .name(String::from("pictures-connection"))
            .spawn(move || connection.serve(stream));
        if spawned.is_err() {
            handshaking.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

/// What one connection's thread holds.
struct Connection {
    number: u64,
    secret: String,
    handshake: Duration,
    layer: Arc<dyn LayerSink>,
    closed: Arc<AtomicBool>,
    refused: Arc<AtomicU64>,
    current: Arc<AtomicU64>,
    handshaking: Arc<AtomicUsize>,
    log: PicturesLog,
}

impl Connection {
    fn serve(self, mut stream: TcpStream) {
        let deadline = Instant::now() + self.handshake;
        let said = !self.closed.load(Ordering::SeqCst)
            && read_line(&mut stream, LINK_SECRET_HEX + 1, deadline)
                .is_some_and(|line| constant_time_eq(&line, self.secret.as_bytes()));
        self.handshaking.fetch_sub(1, Ordering::SeqCst);
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        if !said {
            self.refused.fetch_add(1, Ordering::SeqCst);
            let _ = stream.shutdown(Shutdown::Both);
            return;
        }
        self.current.store(self.number, Ordering::SeqCst);
        (self.log)("The pictures helper is connected.");
        match self.hello(&mut stream) {
            Ok(pid) => self.keep(&mut stream, pid),
            Err(why) => (self.log)(&format!("The pictures' connection closed: {why}.")),
        }
        let _ = stream.shutdown(Shutdown::Both);
    }

    /// The helper's process, as its hello says it.
    fn hello(&self, stream: &mut TcpStream) -> Result<u32, String> {
        let deadline = Instant::now() + self.handshake;
        let line =
            read_line(stream, MAX_HELLO_BYTES, deadline).ok_or("the helper did not say hello")?;
        let line = String::from_utf8(line).map_err(|_| "its hello was not text")?;
        match from_line::<FromLayerHelper>(&line) {
            Ok(FromLayerHelper::Hello { pid }) => Ok(pid),
            Err(_) => Err(String::from("its first line was not a hello")),
        }
    }

    /// Hands the connection to the layer and waits for its end: the helper
    /// closes it, or another connection takes its place.
    fn keep(&self, stream: &mut TcpStream, pid: u32) {
        let is_current = || {
            self.current.load(Ordering::SeqCst) == self.number
                && !self.closed.load(Ordering::SeqCst)
        };
        let writer = stream.try_clone().and_then(|writer| {
            writer.set_write_timeout(Some(WRITE_TIMEOUT))?;
            Ok(writer)
        });
        let Ok(writer) = writer else {
            (self.log)("The pictures' connection closed: it could not be written to.");
            return;
        };
        if stream.set_read_timeout(Some(LINK_WAKE)).is_err() {
            return;
        }
        self.layer.attach(self.number, pid, writer);
        let mut bytes = [0_u8; 64];
        while is_current() {
            match stream.read(&mut bytes) {
                Ok(0) => {
                    (self.log)("The pictures' connection closed: the helper closed it.");
                    break;
                }
                // The helper has nothing more to say; what it says is passed over.
                Ok(_) => {}
                Err(error) if timed_out(&error) => {}
                Err(error) => {
                    (self.log)(&format!("The pictures' connection closed: {error}."));
                    break;
                }
            }
        }
        self.layer.detach(self.number);
    }
}

/// Reads one line of at most `longest` bytes before `deadline`, without its
/// line end; `None` for a longer one, a late one, or a connection that ended.
fn read_line(stream: &mut TcpStream, longest: usize, deadline: Instant) -> Option<Vec<u8>> {
    let mut line = Vec::with_capacity(longest + 1);
    let mut byte = [0_u8; 1];
    while line.len() <= longest {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() || stream.set_read_timeout(Some(left)).is_err() {
            return None;
        }
        match stream.read(&mut byte) {
            Ok(1) if byte[0] == b'\n' => {
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return Some(line);
            }
            Ok(1) => line.push(byte[0]),
            _ => return None,
        }
    }
    None
}

fn timed_out(error: &io::Error) -> bool {
    matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)
}

fn log_refused(refused: &AtomicU64, closed: &AtomicBool, log: &PicturesLog) {
    let mut last = Instant::now();
    while !closed.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(250));
        if last.elapsed() < COUNT_INTERVAL {
            continue;
        }
        last = Instant::now();
        let count = refused.swap(0, Ordering::SeqCst);
        if count > 0 {
            log(&format!(
                "The pictures' listener refused {count} connections in the last minute."
            ));
        }
    }
}

/// The page says where its pictures are, at every change and once a second;
/// the native layer follows. Only a channel send: the window's thread does
/// no composition work.
#[tauri::command]
pub(crate) fn pictures_place(place: PlaceReport) {
    let placed = placement(&place);
    #[cfg(windows)]
    crate::shell_picture_layer::place(placed);
    #[cfg(not(windows))]
    drop(placed);
}

/// Says `secret` on a new connection to `address`: the helper's side, for
/// the tests.
#[cfg(test)]
pub(crate) fn connect_saying(address: SocketAddr, secret: &str) -> io::Result<TcpStream> {
    use std::io::Write;
    let mut stream = TcpStream::connect(address)?;
    writeln!(stream, "{secret}")?;
    Ok(stream)
}

#[cfg(test)]
mod tests;
