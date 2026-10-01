//! The link to the shell's picture layer, and the draw loop (the camera
//! pictures, D30). While the Cameras page shows the pictures the helper
//! connects to the shell's listener, says the secret and then hello with its
//! process; the shell answers with a composition surface made for it and,
//! from then on, each scene the page shows. The helper draws that scene into
//! the surface from each camera's newest frame (`renderer.rs`): the test
//! card's, or vMix's (`receive.rs`), a frame no older than half a second. No
//! picture leaves this process.
//!
//! vMix's frames are drawn in step with vMix: each frame handed over wakes
//! the draw loop (`Inbox`), which draws once every live camera has a new
//! frame (`pace`). Its own clock, 29.97 times a second, draws only while no
//! camera's frames come: the test cards, or none at all. A clock of its own
//! lost frames: a timed wait on Windows can wake up to 16 ms late (read on
//! the studio PC on 2026-10-01), and a camera whose frames landed within that
//! band had one in six or seven replaced before it was drawn.
//!
//! The listener is on 127.0.0.1 and nowhere else: an address that is not
//! this PC's is refused, whatever the line said. No graphics object is made
//! before the shell's `surface` line. When the page stops showing the
//! pictures the connection and the renderer go; they are made again the next
//! time. A connection that breaks, or a draw that fails, is answered the same
//! way after a second: a new connection, and with it a new surface.

use crate::card::{card_uyvy, mark, FULL};
use crate::picture::Picture;
use crate::receive::{lock, Frames};
use crate::renderer::Renderer;
use crate::vmix::Spread;
use crate::watch::Beats;
use std::collections::VecDeque;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::picture_layer::{FromLayerHelper, Scene, ToLayerHelper};
use studio_control_protocol::pictures::{
    from_line, to_line, LinkSecret, WantedCamera, MAX_LINE_BYTES, SIMULATED_VMIX_INPUTS,
};

/// 29.97 frames a second: what the studio's vMix preset sends.
const FRAME_NANOS: u64 = 33_366_667;
pub const FRAME_INTERVAL: Duration = Duration::from_nanos(FRAME_NANOS);
/// After the first new frame of the live cameras lands, the longest the draw
/// waits for the others': half a frame. vMix renders its outputs on one
/// clock, so theirs land close together; one that skipped a frame is drawn
/// with the next.
const SETTLE: Duration = Duration::from_nanos(FRAME_NANOS / 2);
/// While cameras are live and none hands over a frame, a draw comes this
/// long after the last all the same: the scene may have moved.
const QUIET: Duration = Duration::from_nanos(FRAME_NANOS * 2);
/// The last part of a timed wait is slept in steps of `STEP`, looking at the
/// inbox between them: a wait on Windows' coarse timer can wake up to 16 ms
/// late, a sleep within about a millisecond.
const PRECISE_FOR: Duration = Duration::from_millis(20);
const STEP: Duration = Duration::from_millis(1);
/// The bins of the wait from a frame's landing to its draw.
const WAIT_EDGES: [Duration; 4] = [
    Duration::from_millis(1),
    Duration::from_millis(4),
    Duration::from_millis(12),
    Duration::from_millis(20),
];
/// How long a broken connection waits before it is made again.
const RECONNECT_DELAY: Duration = Duration::from_secs(1);
/// The longest wait after failures in a row: each doubles the last.
const LONGEST_RECONNECT_DELAY: Duration = Duration::from_secs(30);
/// How long a write may take before the connection counts as broken.
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);
/// How often the counts go to stderr, which the engine logs.
const COUNT_INTERVAL: Duration = Duration::from_secs(60);
/// The most the shell's lines are read in one go, between two draws.
const MAX_READS: usize = 16;
/// A received frame older than this is not drawn: its place stays clear.
const SHOWN_FOR: Duration = Duration::from_millis(500);
/// The draw loop's name to the helper's watch (`watch.rs`).
const WHO: &str = "The draw loop";

/// What the draw loop draws the pictures from.
#[derive(Clone)]
pub enum Pictures {
    /// Each camera's test card: the simulated source.
    Cards,
    /// Each camera's newest frame from vMix (`receive.rs`).
    Received(Arc<Frames>),
    /// Nothing: vMix's pictures were asked for, and this helper takes none.
    Nothing,
}

/// What the draw loop is told.
pub enum Order {
    Link(SocketAddr, LinkSecret),
    Want {
        cameras: Vec<WantedCamera>,
        showing: bool,
        pictures: Pictures,
    },
}

/// What wakes the draw loop: the helper's orders, and each frame of vMix's as
/// a receiver hands it over (`receive.rs`). Either wakes it at once, which a
/// wait for a time alone does not on Windows; the last `PRECISE_FOR` of such
/// a wait is slept in steps instead.
#[derive(Default)]
pub struct Inbox {
    mail: Mutex<Mail>,
    bell: Condvar,
}

#[derive(Default)]
struct Mail {
    orders: VecDeque<Order>,
    /// No more orders come: the helper is ending.
    closed: bool,
    /// A frame was handed over since the draw loop last looked.
    landed: bool,
}

impl Mail {
    fn any(&self) -> bool {
        !self.orders.is_empty() || self.closed || self.landed
    }
}

/// What a wait brought.
struct Delivery {
    orders: Vec<Order>,
    /// The helper is ending.
    closed: bool,
}

impl Inbox {
    pub fn order(&self, order: Order) {
        lock(&self.mail).orders.push_back(order);
        self.bell.notify_one();
    }

    /// The helper is ending: the draw loop ends at its next look.
    pub fn close(&self) {
        lock(&self.mail).closed = true;
        self.bell.notify_one();
    }

    /// A camera's frame was handed over.
    pub fn landed(&self) {
        lock(&self.mail).landed = true;
        self.bell.notify_one();
    }

    /// Waits until an order or a frame comes, the helper ends, or `until`
    /// passes (never, for none).
    fn wait(&self, until: Option<Instant>) -> Delivery {
        let mut mail = lock(&self.mail);
        while !mail.any() {
            let Some(until) = until else {
                mail = self.bell.wait(mail).unwrap_or_else(PoisonError::into_inner);
                continue;
            };
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            if left > PRECISE_FOR {
                mail = self
                    .bell
                    .wait_timeout(mail, left - PRECISE_FOR)
                    .unwrap_or_else(PoisonError::into_inner)
                    .0;
            } else {
                drop(mail);
                thread::sleep(left.min(STEP));
                mail = lock(&self.mail);
            }
        }
        mail.landed = false;
        Delivery {
            orders: mail.orders.drain(..).collect(),
            closed: mail.closed,
        }
    }
}

/// What the draw loop knows of one camera's frames when it wakes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Waiting {
    /// Its picture is in the scene and its frames come: one landed within
    /// `SHOWN_FOR`.
    live: bool,
    /// When its newest frame landed, if that one is not drawn yet.
    new_since: Option<Instant>,
}

/// What brought a draw, for the minute's line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Why {
    /// Every live camera had a new frame.
    AllCame,
    /// `SETTLE` after the first new frame, without the rest.
    Settled,
    /// Cameras were live and none had a new frame for `QUIET`.
    Quiet,
    /// No camera was live: the draw loop's own clock.
    Clock,
}

/// When the draw loop draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pace {
    Now(Why),
    /// Not before then, unless a frame lands first.
    At(Instant),
}

/// When to draw, in step with vMix's frames: as soon as every live camera has
/// a new frame, or `SETTLE` after the first of them landed when one is
/// missing; while cameras are live and none has a new frame, `QUIET` after
/// the last draw; and on the draw loop's own clock (`due`) only while no
/// camera is live.
fn pace(cameras: &[Waiting; 3], due: Instant, drew_at: Option<Instant>, now: Instant) -> Pace {
    let live = || cameras.iter().filter(|camera| camera.live);
    if live().next().is_none() {
        return if now >= due {
            Pace::Now(Why::Clock)
        } else {
            Pace::At(due)
        };
    }
    match live().filter_map(|camera| camera.new_since).min() {
        Some(_) if live().all(|camera| camera.new_since.is_some()) => Pace::Now(Why::AllCame),
        Some(first) if now >= first + SETTLE => Pace::Now(Why::Settled),
        Some(first) => Pace::At(first + SETTLE),
        None => match drew_at.map(|at| at + QUIET) {
            Some(quiet) if now < quiet => Pace::At(quiet),
            _ => Pace::Now(Why::Quiet),
        },
    }
}

/// Whether `scene` holds a place of `camera`'s (1 to 3).
fn shows(scene: &Scene, camera: u8) -> bool {
    scene.pictures.iter().any(|placed| placed.camera == camera)
}

/// What a draw took of one camera's frames from vMix, counted once the draw
/// is presented (`Counts::add`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Took {
    /// A new frame: how long it waited from its hand-over, and how many
    /// before it were replaced unseen.
    new: Option<(Duration, u64)>,
    /// The frame drawn last was drawn again.
    again: bool,
}

/// Takes each shown camera's newest frame from vMix for a draw, while one
/// came within `SHOWN_FOR`: a new one takes the place of the one drawn last
/// (the buffers go round, and no frame is copied again). Which cameras
/// arrive, and what was taken of each.
fn take_received(
    frames: &Frames,
    scene: &Scene,
    fronts: &mut [Front; 3],
    now: Instant,
) -> ([bool; 3], [Took; 3]) {
    let mut arrives = [false; 3];
    let mut took = [Took::default(); 3];
    for (index, front) in fronts.iter_mut().enumerate() {
        if !shows(scene, index as u8 + 1) {
            // Frames of a camera the scene does not show are not missed.
            front.drawn_at = None;
            continue;
        }
        let mut newest = lock(&frames[index]);
        let Some(landed) = newest
            .arrived
            .filter(|at| now.saturating_duration_since(*at) < SHOWN_FOR)
        else {
            continue;
        };
        let unbroken = front
            .drawn_at
            .is_some_and(|at| now.saturating_duration_since(at) < SHOWN_FOR);
        if newest.sequence != front.sequence {
            let missed = if unbroken {
                let missed = newest.sequence.wrapping_sub(front.sequence);
                missed.saturating_sub(1).min(1_000)
            } else {
                0
            };
            took[index].new = Some((now.saturating_duration_since(landed), missed));
            std::mem::swap(&mut newest.bytes, &mut front.bytes);
            front.width = newest.width;
            front.height = newest.height;
            front.stride = newest.stride;
            front.sequence = newest.sequence;
        } else {
            took[index].again = unbroken;
        }
        front.drawn_at = Some(now);
        arrives[index] = true;
    }
    (arrives, took)
}

/// A received frame the draw loop holds while it draws it.
#[derive(Default)]
struct Front {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
    stride: u32,
    sequence: u64,
    /// When the draw loop last drew from it: frames replaced before they
    /// were taken count only while it draws this camera without a break.
    drawn_at: Option<Instant>,
}

/// A listener's address the helper may connect to: 127.0.0.1 and nothing
/// else.
pub fn listener_address(address: &str) -> Result<SocketAddr, String> {
    let parsed: SocketAddr = address
        .parse()
        .map_err(|_| format!("{address} is not an address"))?;
    if parsed.ip() != IpAddr::from(Ipv4Addr::LOCALHOST) {
        return Err(format!("{address} is not this PC's"));
    }
    Ok(parsed)
}

/// The shell's bytes as lines: whole lines are handed on, a last part waits
/// for its end, and a line longer than `MAX_LINE_BYTES` ends the connection.
#[derive(Default)]
struct Lines {
    waiting: Vec<u8>,
}

impl Lines {
    fn take(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.waiting.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(end) = self.waiting.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.waiting.drain(..=end).collect();
            if line.len() > MAX_LINE_BYTES {
                return Err(format!("a line of {} bytes", line.len()));
            }
            let line = String::from_utf8_lossy(&line[..end]);
            if !line.trim().is_empty() {
                lines.push(line.trim().to_string());
            }
        }
        if self.waiting.len() > MAX_LINE_BYTES {
            return Err(format!(
                "a line of more than {MAX_LINE_BYTES} bytes without an end"
            ));
        }
        Ok(lines)
    }
}

/// The connection to the shell's listener, after the secret and hello.
struct Link {
    stream: TcpStream,
    lines: Lines,
}

impl Link {
    fn open(address: &SocketAddr, secret: &LinkSecret) -> std::io::Result<Self> {
        let mut stream = TcpStream::connect_timeout(address, RECONNECT_DELAY)?;
        stream.set_write_timeout(Some(WRITE_TIMEOUT))?;
        stream.set_nodelay(true)?;
        writeln!(stream, "{}", secret.0)?;
        let hello = FromLayerHelper::Hello {
            pid: std::process::id(),
        };
        writeln!(stream, "{}", to_line(&hello))?;
        // Read between two draws, never waited on.
        stream.set_nonblocking(true)?;
        Ok(Self {
            stream,
            lines: Lines::default(),
        })
    }

    /// The lines the shell has said since the last look. An error is the
    /// connection's end.
    fn hear(&mut self) -> Result<Vec<ToLayerHelper>, String> {
        let mut heard = Vec::new();
        let mut buffer = [0_u8; MAX_LINE_BYTES];
        for _ in 0..MAX_READS {
            match self.stream.read(&mut buffer) {
                Ok(0) => return Err(String::from("the shell closed it")),
                Ok(length) => {
                    for line in self.lines.take(&buffer[..length])? {
                        match from_line::<ToLayerHelper>(&line) {
                            Ok(said) => heard.push(said),
                            Err(why) => {
                                eprintln!(
                                    "The pictures helper could not read the shell's line: {why}"
                                )
                            }
                        }
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == ErrorKind::Interrupted => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        Ok(heard)
    }
}

/// What the loop did since its last line on stderr.
#[derive(Default)]
struct Counts {
    drawn: u64,
    failed: u64,
    late: u64,
    no_surface: u64,
    no_scene: u64,
    slowest: Duration,
    /// What brought each draw, by `Why`.
    paced: [u64; 4],
    /// Of each camera's frames from vMix: taken to be drawn, replaced by a
    /// newer one before the draw loop took them, and drawn again for want of
    /// a newer one; and how long each waited from its landing to its draw.
    received: [u64; 3],
    replaced: [u64; 3],
    repeated: [u64; 3],
    waited: [Spread; 3],
}

impl Counts {
    fn any(&self) -> bool {
        self.drawn + self.failed + self.late + self.no_surface + self.no_scene > 0
    }

    /// What a presented draw took of vMix's frames.
    fn add(&mut self, took: &[Took; 3]) {
        for (index, took) in took.iter().enumerate() {
            if let Some((waited, missed)) = took.new {
                self.received[index] += 1;
                self.replaced[index] += missed;
                self.waited[index].note(waited, &WAIT_EDGES);
            }
            if took.again {
                self.repeated[index] += 1;
            }
        }
    }

    fn line(&self, statistics: &str) -> String {
        let total = |counts: &[u64; 3]| counts.iter().sum::<u64>();
        let received = if total(&self.received) + total(&self.replaced) + total(&self.repeated) > 0
        {
            let cameras: Vec<String> = (0..3)
                .filter(|index| {
                    self.received[*index] + self.replaced[*index] + self.repeated[*index] > 0
                })
                .map(|index| {
                    format!(
                        "CAM {}: {} taken, {} replaced, {} again, waited to be drawn {}",
                        index + 1,
                        self.received[index],
                        self.replaced[index],
                        self.repeated[index],
                        self.waited[index].words(&WAIT_EDGES)
                    )
                })
                .collect();
            format!(
                "; of vMix's frames {} were taken, {} replaced before they were drawn, and {} times a frame was drawn again; {}",
                total(&self.received),
                total(&self.replaced),
                total(&self.repeated),
                cameras.join("; ")
            )
        } else {
            String::new()
        };
        let [all_came, settled, quiet, clock] = self.paced;
        format!(
            "The pictures helper drew {} frames in the last minute ({} failed, {} late; the slowest took {:.1} ms; {} waited for a surface, {} for a scene; {all_came} as every live camera's frame came, {settled} after half a frame without one, {quiet} with no new frame, {clock} on its own clock){}{}{received}.",
            self.drawn,
            self.failed,
            self.late,
            self.slowest.as_secs_f64() * 1000.0,
            self.no_surface,
            self.no_scene,
            if statistics.is_empty() { "" } else { "; " },
            statistics
        )
    }
}

struct Drawer {
    link: Option<(SocketAddr, LinkSecret)>,
    connection: Option<Link>,
    renderer: Option<Renderer>,
    scene: Option<Scene>,
    retry_at: Instant,
    cameras: Vec<WantedCamera>,
    showing: bool,
    pictures: Pictures,
    /// Each camera's test card, and the copy the moving mark is drawn into.
    cards: [Vec<u8>; 3],
    marked: [Vec<u8>; 3],
    /// Each camera's received frame, as last taken from `receive.rs`.
    fronts: [Front; 3],
    frame: u64,
    /// The own clock's next draw, and the last draw: when, and what brought
    /// it.
    due: Instant,
    drew_at: Option<Instant>,
    drew_by: Option<Why>,
    counts: Counts,
    counted: Instant,
    /// The last line said on stderr about the link: said once, not every
    /// second while it stays true.
    said: Option<String>,
    /// Connections given up in a row without a frame drawn.
    failures: u32,
    beats: Arc<Beats>,
}

impl Drawer {
    fn new(beats: Arc<Beats>) -> Self {
        let cards = [card_uyvy(1), card_uyvy(2), card_uyvy(3)];
        Self {
            link: None,
            connection: None,
            renderer: None,
            scene: None,
            retry_at: Instant::now(),
            cameras: Vec::new(),
            showing: false,
            pictures: Pictures::Cards,
            marked: cards.clone(),
            cards,
            fronts: Default::default(),
            frame: 0,
            due: Instant::now(),
            drew_at: None,
            drew_by: None,
            counts: Counts::default(),
            counted: Instant::now(),
            said: None,
            failures: 0,
            beats,
        }
    }

    fn say(&mut self, line: String) {
        if self.said.as_deref() != Some(line.as_str()) {
            eprintln!("{line}");
            self.said = Some(line);
        }
    }

    /// Lets go of the connection, and with it of the surface and the scene.
    /// The renderer goes first: it presents into the shell's surface.
    fn let_go(&mut self) {
        self.renderer = None;
        self.scene = None;
        self.connection = None;
    }

    fn take(&mut self, order: Order) {
        match order {
            Order::Link(address, secret) => {
                self.link = Some((address, secret));
                self.let_go();
                self.retry_at = Instant::now();
            }
            Order::Want {
                cameras,
                showing,
                pictures,
            } => {
                self.cameras = cameras;
                self.pictures = pictures;
                if showing && !self.showing {
                    let now = Instant::now();
                    self.retry_at = now;
                    self.due = now;
                    self.drew_at = None;
                    self.drew_by = None;
                }
                self.showing = showing;
                if !showing {
                    self.let_go();
                    // It waits for an order now, which cannot hang.
                    self.beats.rest(WHO);
                }
            }
        }
    }

    /// The connection, made when there is none and the wait is over.
    fn connect(&mut self) {
        if self.connection.is_some() || Instant::now() < self.retry_at {
            return;
        }
        let Some((address, secret)) = self.link.as_ref() else {
            return;
        };
        self.retry_at = Instant::now() + RECONNECT_DELAY;
        match Link::open(address, secret) {
            Ok(link) => self.connection = Some(link),
            Err(error) => {
                self.say(format!(
                    "The picture layer's listener did not take the connection: {error}"
                ));
            }
        }
    }

    /// The connection is given up; it is made again after a second, and
    /// after longer each time it is given up again before a frame is drawn,
    /// so a surface that cannot be drawn into is not asked for every second.
    fn broke(&mut self, why: String) {
        self.say(why);
        self.let_go();
        let wait = RECONNECT_DELAY.saturating_mul(1 << self.failures.min(5));
        self.retry_at = Instant::now() + wait.min(LONGEST_RECONNECT_DELAY);
        self.failures = self.failures.saturating_add(1);
    }

    fn hear(&mut self) {
        let Some(link) = self.connection.as_mut() else {
            return;
        };
        let heard = match link.hear() {
            Ok(heard) => heard,
            Err(why) => {
                self.broke(format!("The picture layer's connection ended: {why}"));
                return;
            }
        };
        for said in heard {
            match said {
                ToLayerHelper::Surface { handle } => {
                    // A second surface on one connection takes the first
                    // one's place.
                    self.renderer = None;
                    match Renderer::open(handle) {
                        Ok(renderer) => {
                            self.renderer = Some(renderer);
                            self.say(String::from(
                                "The pictures helper draws into the shell's surface.",
                            ));
                        }
                        Err(why) => {
                            self.broke(format!("The pictures helper cannot draw: {why}"));
                            return;
                        }
                    }
                }
                ToLayerHelper::Scene(scene) => match scene.check() {
                    Ok(()) => self.scene = Some(scene),
                    Err(why) => {
                        self.scene = None;
                        self.say(format!("The pictures helper refused a scene: {why}"));
                    }
                },
            }
        }
    }

    /// Each camera's frames as the draw loop wakes: whether they come, and
    /// whether one waits to be drawn. Only vMix's are live; the test cards
    /// are drawn on the draw loop's own clock.
    fn waiting(&self, now: Instant) -> [Waiting; 3] {
        let mut waiting = [Waiting::default(); 3];
        let (Some(scene), Pictures::Received(frames)) = (self.scene.as_ref(), &self.pictures)
        else {
            return waiting;
        };
        for (index, front) in self.fronts.iter().enumerate() {
            if !shows(scene, index as u8 + 1) {
                continue;
            }
            let newest = lock(&frames[index]);
            let Some(landed) = newest
                .arrived
                .filter(|at| now.saturating_duration_since(*at) < SHOWN_FOR)
            else {
                continue;
            };
            waiting[index] = Waiting {
                live: true,
                new_since: (newest.sequence != front.sequence).then_some(landed),
            };
        }
        waiting
    }

    /// A draw was made at `now` for `why`, presented or not. While the own
    /// clock alone draws, its next draw is a frame after its last; any other
    /// draw sets it a frame after itself, so that the clock takes over from
    /// vMix's frames without reading as late.
    fn drew(&mut self, why: Why, now: Instant) {
        let clocked = self.drew_by == Some(Why::Clock);
        self.drew_at = Some(now);
        self.drew_by = Some(why);
        if why == Why::Clock && clocked {
            self.due += FRAME_INTERVAL;
            // Behind by more than a frame (a busy PC, a slow present): the
            // frames missed are missed, not drawn in a burst.
            if self.due < now {
                self.counts.late += 1;
                self.due = now + FRAME_INTERVAL;
            }
        } else {
            self.due = now + FRAME_INTERVAL;
        }
    }

    /// One draw: the scene, from every camera whose picture arrives. Whether
    /// it was presented; what it took of vMix's frames is counted only then.
    fn draw(&mut self) -> bool {
        let Some(scene) = self.scene.as_ref() else {
            if self.renderer.is_some() {
                self.counts.no_scene += 1;
            } else {
                self.counts.no_surface += 1;
            }
            return false;
        };
        let frame = self.frame;
        self.frame = self.frame.wrapping_add(1);
        let mut arrives = [false; 3];
        let mut took = [Took::default(); 3];
        match &self.pictures {
            Pictures::Cards => {
                for camera in &self.cameras {
                    let index = usize::from(camera.camera).wrapping_sub(1);
                    if index < 3
                        && shows(scene, camera.camera)
                        && SIMULATED_VMIX_INPUTS.contains(&camera.vmix_input)
                    {
                        arrives[index] = true;
                    }
                }
                for (index, marked) in self.marked.iter_mut().enumerate() {
                    if arrives[index] {
                        marked.copy_from_slice(&self.cards[index]);
                        mark(marked, FULL.0, FULL.1, frame);
                    }
                }
            }
            Pictures::Received(frames) => {
                (arrives, took) = take_received(frames, scene, &mut self.fronts, Instant::now());
            }
            Pictures::Nothing => {}
        }
        let picture = |index: usize| {
            if !arrives[index] {
                return None;
            }
            Some(match &self.pictures {
                Pictures::Received(_) => {
                    let front = &self.fronts[index];
                    Picture {
                        uyvy: &front.bytes,
                        width: front.width,
                        height: front.height,
                        stride: front.stride,
                        sequence: front.sequence,
                    }
                }
                Pictures::Cards | Pictures::Nothing => Picture {
                    uyvy: &self.marked[index],
                    width: u32::from(FULL.0),
                    height: u32::from(FULL.1),
                    stride: u32::from(FULL.0) * 2,
                    sequence: frame,
                },
            })
        };
        let pictures = [picture(0), picture(1), picture(2)];
        let started = Instant::now();
        let drawn = match self.renderer.as_mut() {
            Some(renderer) => renderer.draw(scene, &pictures),
            None => {
                self.counts.no_surface += 1;
                return false;
            }
        };
        match drawn {
            Ok(_) => {
                self.failures = 0;
                self.counts.drawn += 1;
                self.counts.slowest = self.counts.slowest.max(started.elapsed());
                self.counts.add(&took);
                true
            }
            Err(why) => {
                self.counts.failed += 1;
                self.broke(format!("The pictures helper could not draw: {why}"));
                false
            }
        }
    }

    fn count(&mut self) {
        if self.counted.elapsed() < COUNT_INTERVAL {
            return;
        }
        self.counted = Instant::now();
        if self.counts.any() {
            let statistics = self
                .renderer
                .as_ref()
                .map_or_else(String::new, Renderer::statistics);
            eprintln!("{}", self.counts.line(&statistics));
        }
        self.counts = Counts::default();
    }

    /// One wake while the pictures show: the link kept, the shell heard, and
    /// a draw when it is time (`pace`). Returns when to wake next if no
    /// order or frame comes first.
    fn wake(&mut self) -> Instant {
        self.beats.beat(WHO);
        self.connect();
        self.hear();
        let now = Instant::now();
        let next = if self.connection.is_some() {
            if let Pace::Now(why) = pace(&self.waiting(now), self.due, self.drew_at, now) {
                if self.draw() {
                    self.counts.paced[why as usize] += 1;
                }
                self.drew(why, now);
            }
            match pace(&self.waiting(now), self.due, self.drew_at, now) {
                Pace::At(at) => at,
                // A frame landed meanwhile: its wake is already in the inbox.
                Pace::Now(_) => now,
            }
        } else {
            // A connection is tried again within a frame (`connect`).
            self.due = now + FRAME_INTERVAL;
            self.due
        };
        self.count();
        next
    }
}

/// Draws until the inbox is closed: the helper is ending. It beats while it
/// draws (`watch.rs`), so a draw that hangs makes the helper go silent.
pub fn run(inbox: &Inbox, beats: &Arc<Beats>) {
    let mut drawer = Drawer::new(Arc::clone(beats));
    let mut until = None;
    loop {
        let delivery = inbox.wait(until);
        if delivery.closed {
            return;
        }
        for order in delivery.orders {
            drawer.take(order);
        }
        // Nothing to draw while the page does not show the pictures: it
        // waits for an order, not for a time.
        until = if drawer.showing {
            Some(drawer.wake())
        } else {
            None
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_this_pc_s_listener_is_taken() {
        assert!(listener_address("127.0.0.1:49152").is_ok());
        for refused in [
            "10.0.0.5:49152",
            "172.16.16.85:80",
            "0.0.0.0:49152",
            "127.0.0.2:49152",
            "[::1]:49152",
            "localhost:49152",
            "127.0.0.1",
            "",
        ] {
            assert!(listener_address(refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn the_shell_s_bytes_come_as_whole_lines_however_they_are_cut() {
        let mut lines = Lines::default();
        assert_eq!(
            lines.take(b"{\"type\":\"sur").expect("a part"),
            Vec::<String>::new()
        );
        assert_eq!(
            lines
                .take(b"face\",\"handle\":500}\r\n\n{\"a\":1}\n{\"b")
                .expect("two lines"),
            [r#"{"type":"surface","handle":500}"#, r#"{"a":1}"#]
        );
        assert_eq!(lines.take(b"\":2}\n").expect("the rest"), [r#"{"b":2}"#]);
    }

    #[test]
    fn a_line_that_is_too_long_ends_the_connection() {
        let mut lines = Lines::default();
        assert!(lines.take(&vec![b'x'; MAX_LINE_BYTES]).is_ok());
        assert!(lines.take(b"x").is_err(), "no end within the bound");
        let mut lines = Lines::default();
        let mut long = vec![b'x'; MAX_LINE_BYTES + 1];
        long.push(b'\n');
        assert!(lines.take(&long).is_err(), "an end past the bound");
    }

    #[test]
    fn the_helper_says_the_secret_and_hello_and_takes_the_shell_s_lines() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("a listener");
        let address = listener.local_addr().expect("its address");
        let secret = LinkSecret("a".repeat(64));
        let mut link = Link::open(&address, &secret).expect("connects");
        let (mut shell, _) = listener.accept().expect("the helper's connection");
        shell
            .set_read_timeout(Some(Duration::from_secs(20)))
            .expect("a timeout");
        let expected = format!(
            "{}\n{{\"type\":\"hello\",\"pid\":{}}}\n",
            secret.0,
            std::process::id()
        );
        let mut said = vec![0_u8; expected.len()];
        shell.read_exact(&mut said).expect("the helper's two lines");
        assert_eq!(String::from_utf8_lossy(&said), expected);

        assert_eq!(link.hear().expect("nothing yet"), []);
        writeln!(
            shell,
            r#"{{"type":"scene","width":100,"height":50,"pictures":[],"holes":[]}}"#
        )
        .expect("a scene");
        writeln!(shell, "not a line of the shell's").expect("a bad line");
        let started = Instant::now();
        let heard = loop {
            let heard = link.hear().expect("the connection holds");
            if !heard.is_empty() {
                break heard;
            }
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "the scene arrives"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(
            heard,
            [ToLayerHelper::Scene(Scene {
                width: 100,
                height: 50,
                pictures: Vec::new(),
                holes: Vec::new(),
            })]
        );
        drop(shell);
        let started = Instant::now();
        while link.hear().is_ok() {
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "the end is heard"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn nothing_is_drawn_and_nothing_made_without_the_shell_s_surface() {
        let beats = Arc::new(Beats::default());
        let mut drawer = Drawer::new(Arc::clone(&beats));
        drawer.take(Order::Want {
            cameras: vec![WantedCamera {
                camera: 1,
                vmix_input: 1,
            }],
            showing: true,
            pictures: Pictures::Cards,
        });
        // No link told: no connection is tried, and a draw is not counted.
        drawer.wake();
        assert!(drawer.connection.is_none() && drawer.renderer.is_none());
        assert!(!drawer.counts.any());
        // It beats while it draws, and rests while the pictures do not show.
        let later = Instant::now() + crate::watch::STALL;
        assert_eq!(beats.stalled(later).as_deref(), Some(WHO));
        drawer.take(Order::Want {
            cameras: Vec::new(),
            showing: false,
            pictures: Pictures::Cards,
        });
        assert!(!drawer.showing);
        assert_eq!(beats.stalled(later), None);
    }

    /// A scene with each camera's picture in a place of its own.
    fn scene_of(cameras: &[u8]) -> Scene {
        use studio_control_protocol::picture_layer::{Part, PictureRect, PlacedPicture};
        Scene {
            width: 1000,
            height: 600,
            pictures: cameras
                .iter()
                .map(|camera| PlacedPicture {
                    camera: *camera,
                    at: PictureRect {
                        x: 0,
                        y: 0,
                        width: 480,
                        height: 270,
                    },
                    part: Part {
                        x: 0,
                        y: 0,
                        width: 1920,
                        height: 1080,
                    },
                    smooth: true,
                    guides: false,
                    zebras: false,
                    peaking: false,
                    marker: None,
                })
                .collect(),
            holes: Vec::new(),
        }
    }

    /// A frame of `bytes` handed over as `sequence` at `at`.
    fn hand_over(frames: &Frames, index: usize, bytes: u8, sequence: u64, at: Option<Instant>) {
        *lock(&frames[index]) = crate::receive::Newest {
            bytes: vec![bytes; 8 * 2 * 2],
            width: 8,
            height: 2,
            stride: 16,
            sequence,
            arrived: at,
        };
    }

    // The newest received frame is taken, and a frame older than half a
    // second is not: its place stays clear. A frame replaced before it was
    // taken, and a frame taken again, are said of the camera they belong to.
    #[test]
    fn a_received_frame_is_taken_while_it_is_recent() {
        let frames: Frames = Default::default();
        let mut fronts: [Front; 3] = Default::default();
        let scene = scene_of(&[1, 2, 3]);
        let now = Instant::now();
        let before = |ms: u64| now.checked_sub(Duration::from_millis(ms));
        let after = |ms: u64| now + Duration::from_millis(ms);
        hand_over(&frames, 1, 7, 5, before(3));
        hand_over(&frames, 2, 9, 3, before(2_000));
        let (arrives, took) = take_received(&frames, &scene, &mut fronts, now);
        assert_eq!(arrives, [false, true, false]);
        assert_eq!(
            took[1],
            Took {
                new: Some((Duration::from_millis(3), 0)),
                again: false
            },
            "the first take after a break misses nothing"
        );
        assert_eq!((took[0], took[2]), (Took::default(), Took::default()));
        assert_eq!(fronts[1].sequence, 5, "CAM 2's frame is taken");
        assert_eq!(fronts[1].bytes, vec![7; 32]);
        assert!(
            lock(&frames[1]).bytes.is_empty(),
            "and its buffer handed back"
        );
        assert_eq!(fronts[2].sequence, 0, "CAM 3's is too old");
        assert_eq!(fronts[0].sequence, 0, "CAM 1 sent none");
        let mut counts = Counts::default();
        counts.add(&took);

        // Taken on without a break: the frames replaced before it are
        // counted, and so is the same frame taken again.
        hand_over(&frames, 1, 8, 8, Some(now));
        let (_, took) = take_received(&frames, &scene, &mut fronts, after(33));
        assert_eq!(
            took[1].new,
            Some((Duration::from_millis(33), 2)),
            "frames 6 and 7 were never drawn"
        );
        assert_eq!(fronts[1].bytes, vec![8; 32]);
        counts.add(&took);
        let (_, took) = take_received(&frames, &scene, &mut fronts, after(66));
        assert_eq!(
            took[1],
            Took {
                new: None,
                again: true
            },
            "frame 8 taken again"
        );
        counts.add(&took);
        assert_eq!(counts.received, [0, 2, 0]);
        assert_eq!(counts.replaced, [0, 2, 0]);
        assert_eq!(counts.repeated, [0, 1, 0]);
        assert_eq!(counts.waited[1].counts, [0, 1, 0, 0, 1], "3 ms and 33 ms");
        let line = counts.line("");
        assert!(
            line.contains("of vMix's frames 2 were taken, 2 replaced before they were drawn, and 1 times a frame was drawn again; CAM 2: 2 taken, 2 replaced, 1 again, waited to be drawn (under 1, 1–4, 4–12, 12–20, 20 ms or more) 0 / 1 / 0 / 0 / 1, the longest 33.0 ms."),
            "{line}"
        );

        // A camera the scene stops showing for a moment has missed nothing
        // when it shows again.
        let (arrives, _) = take_received(&frames, &scene_of(&[1, 3]), &mut fronts, after(83));
        assert!(!arrives[1]);
        hand_over(&frames, 1, 4, 12, Some(after(93)));
        let (_, took) = take_received(&frames, &scene, &mut fronts, after(99));
        assert_eq!(took[1].new, Some((Duration::from_millis(6), 0)));
    }

    // A draw that is not presented counts no frame as taken: here there is
    // no surface, and a frame taken for it is counted nowhere but there.
    #[test]
    fn a_draw_without_a_surface_counts_no_frame_taken() {
        let frames: Arc<Frames> = Arc::new(Default::default());
        let mut drawer = Drawer::new(Arc::new(Beats::default()));
        drawer.take(Order::Want {
            cameras: Vec::new(),
            showing: true,
            pictures: Pictures::Received(Arc::clone(&frames)),
        });
        drawer.scene = Some(scene_of(&[1]));
        hand_over(&frames, 0, 7, 1, Some(Instant::now()));
        assert!(!drawer.draw(), "nothing presented");
        assert_eq!(drawer.counts.no_surface, 1);
        assert_eq!(drawer.counts.received, [0; 3]);
        assert!(!drawer.counts.waited[0].any());
    }

    // The own clock takes over from vMix's frames a frame after their last
    // draw, without reading as late; while it alone draws, a draw more than
    // a frame behind is late, and the clock starts again from it.
    #[test]
    fn the_own_clock_takes_over_from_vmix_s_frames_without_reading_late() {
        let mut drawer = Drawer::new(Arc::new(Beats::default()));
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        drawer.drew(Why::AllCame, at(0));
        drawer.drew(Why::Quiet, at(67));
        // Every output stopped: the clock's first draw comes a little after
        // the quiet draw's own next frame.
        drawer.drew(Why::Clock, at(140));
        assert_eq!(drawer.counts.late, 0);
        assert_eq!(drawer.due, at(140) + FRAME_INTERVAL);
        drawer.drew(Why::Clock, at(174));
        assert_eq!(drawer.counts.late, 0);
        assert_eq!(drawer.due, at(140) + FRAME_INTERVAL * 2);
        drawer.drew(Why::Clock, at(300));
        assert_eq!(drawer.counts.late, 1);
        assert_eq!(drawer.due, at(300) + FRAME_INTERVAL);
    }

    /// Three cameras' frames as the draw loop finds them.
    fn cameras(live: [bool; 3], new_since: [Option<Instant>; 3]) -> [Waiting; 3] {
        [0, 1, 2].map(|index| Waiting {
            live: live[index],
            new_since: new_since[index],
        })
    }

    // In step with vMix: a draw as soon as every live camera has a new
    // frame, half a frame after the first when one is missing, and the own
    // clock only while no camera is live.
    #[test]
    fn the_draw_comes_when_every_live_camera_s_frame_has_come() {
        let start = Instant::now();
        let ms = |ms: u64| start + Duration::from_millis(ms);
        let due = ms(30);

        // No camera live: the own clock.
        let none = cameras([false; 3], [None; 3]);
        assert_eq!(pace(&none, due, None, ms(10)), Pace::At(due));
        assert_eq!(pace(&none, due, None, ms(30)), Pace::Now(Why::Clock));
        assert_eq!(
            pace(&none, due, Some(ms(29)), ms(31)),
            Pace::Now(Why::Clock)
        );

        // All three live; two have new frames, the third's has not come.
        let two = cameras([true; 3], [Some(ms(2)), Some(ms(3)), None]);
        assert_eq!(pace(&two, due, None, ms(4)), Pace::At(ms(2) + SETTLE));
        assert_eq!(
            pace(&two, due, None, ms(2) + SETTLE),
            Pace::Now(Why::Settled),
            "the third skipped a frame"
        );
        // The third's comes: drawn at once, whatever the own clock says.
        let all = cameras([true; 3], [Some(ms(2)), Some(ms(3)), Some(ms(5))]);
        assert_eq!(pace(&all, due, None, ms(5)), Pace::Now(Why::AllCame));
        assert_eq!(pace(&all, ms(0), None, ms(5)), Pace::Now(Why::AllCame));

        // A camera that is not live (its output off, or not in the scene)
        // is not waited for.
        let one_off = cameras([true, false, true], [Some(ms(2)), None, Some(ms(4))]);
        assert_eq!(pace(&one_off, due, None, ms(4)), Pace::Now(Why::AllCame));

        // Live, and nothing new since the last draw: a draw all the same
        // after `QUIET`, for the scene may have moved.
        let quiet = cameras([true; 3], [None; 3]);
        assert_eq!(
            pace(&quiet, due, Some(ms(40)), ms(50)),
            Pace::At(ms(40) + QUIET)
        );
        assert_eq!(
            pace(&quiet, due, Some(ms(40)), ms(40) + QUIET),
            Pace::Now(Why::Quiet)
        );
        assert_eq!(pace(&quiet, due, None, ms(50)), Pace::Now(Why::Quiet));
    }

    // vMix's frames are live while one landed within half a second and the
    // scene shows the camera; a frame not yet taken is new. The test cards
    // are never live: they are drawn on the own clock.
    #[test]
    fn a_camera_is_live_while_its_frames_come_and_its_newest_waits_until_drawn() {
        use crate::receive::Newest;
        let frames: Arc<Frames> = Arc::new(Default::default());
        let mut drawer = Drawer::new(Arc::new(Beats::default()));
        drawer.scene = Some(scene_of(&[1, 2]));
        assert_eq!(
            drawer.waiting(Instant::now()),
            [Waiting::default(); 3],
            "the test cards"
        );
        drawer.take(Order::Want {
            cameras: Vec::new(),
            showing: true,
            pictures: Pictures::Received(Arc::clone(&frames)),
        });
        let now = Instant::now();
        let landed = now.checked_sub(Duration::from_millis(5)).expect("a clock");
        let old = now.checked_sub(Duration::from_secs(2)).expect("a clock");
        let hand_over = |index: usize, sequence: u64, at: Instant| {
            *lock(&frames[index]) = Newest {
                bytes: vec![1; 32],
                width: 8,
                height: 2,
                stride: 16,
                sequence,
                arrived: Some(at),
            };
        };
        hand_over(0, 1, landed);
        hand_over(1, 4, old);
        hand_over(2, 9, landed);
        let waiting = drawer.waiting(now);
        assert_eq!(
            waiting[0],
            Waiting {
                live: true,
                new_since: Some(landed)
            }
        );
        assert_eq!(waiting[1], Waiting::default(), "its frames stopped");
        assert_eq!(waiting[2], Waiting::default(), "not in the scene");

        drawer.draw();
        assert_eq!(
            drawer.waiting(now)[0],
            Waiting {
                live: true,
                new_since: None
            },
            "drawn: nothing waits"
        );
    }

    #[test]
    fn the_inbox_wakes_the_draw_loop_at_once_for_an_order_or_a_frame() {
        let inbox = Arc::new(Inbox::default());
        let later = Instant::now() + Duration::from_secs(60);
        let wake = |inbox: &Arc<Inbox>, tell: fn(&Inbox)| {
            let teller = Arc::clone(inbox);
            let started = Instant::now();
            let thread = thread::spawn(move || {
                thread::sleep(Duration::from_millis(20));
                tell(&teller);
            });
            let delivery = inbox.wait(Some(later));
            thread.join().expect("the teller");
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "woken by the teller, not by the time"
            );
            delivery
        };

        let delivery = wake(&inbox, |inbox| {
            inbox.order(Order::Want {
                cameras: Vec::new(),
                showing: false,
                pictures: Pictures::Nothing,
            });
        });
        assert_eq!(delivery.orders.len(), 1);
        assert!(!delivery.closed);

        let delivery = wake(&inbox, Inbox::landed);
        assert!(delivery.orders.is_empty() && !delivery.closed);
        // A landing is taken once: the next wait runs to its time.
        let until = Instant::now() + Duration::from_millis(30);
        let delivery = inbox.wait(Some(until));
        assert!(Instant::now() >= until, "it waited out its time");
        assert!(delivery.orders.is_empty() && !delivery.closed);

        let delivery = wake(&inbox, Inbox::close);
        assert!(delivery.closed);
        // Closed stays closed, and a wait without a time returns.
        assert!(inbox.wait(None).closed);
    }
}
