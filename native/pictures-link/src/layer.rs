//! The link to the shell's picture layer, and the draw loop (the camera
//! pictures, D30). While the Cameras page shows the pictures the helper
//! connects to the shell's listener, says the secret and then hello with its
//! process; the shell answers with a composition surface made for it and,
//! from then on, each scene the page shows. The helper draws that scene into
//! the surface 29.97 times a second from each camera's newest frame
//! (`renderer.rs`). No picture leaves this process.
//!
//! The listener is on 127.0.0.1 and nowhere else: an address that is not
//! this PC's is refused, whatever the line said. No graphics object is made
//! before the shell's `surface` line. When the page stops showing the
//! pictures the connection and the renderer go; they are made again the next
//! time. A connection that breaks, or a draw that fails, is answered the same
//! way after a second: a new connection, and with it a new surface.

use crate::card::{card_uyvy, mark, FULL};
use crate::picture::Picture;
use crate::renderer::Renderer;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};
use studio_control_protocol::picture_layer::{FromLayerHelper, Scene, ToLayerHelper};
use studio_control_protocol::pictures::{
    from_line, to_line, LinkSecret, WantedCamera, MAX_LINE_BYTES, SIMULATED_VMIX_INPUTS,
};

/// 29.97 frames a second: what the studio's vMix preset sends.
pub const FRAME_INTERVAL: Duration = Duration::from_nanos(33_366_667);
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

/// What the draw loop is told.
pub enum Order {
    Link(SocketAddr, LinkSecret),
    Want {
        cameras: Vec<WantedCamera>,
        showing: bool,
    },
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
}

impl Counts {
    fn any(&self) -> bool {
        self.drawn + self.failed + self.late + self.no_surface + self.no_scene > 0
    }

    fn line(&self, statistics: &str) -> String {
        format!(
            "The pictures helper drew {} frames in the last minute ({} failed, {} late; the slowest took {:.1} ms; {} waited for a surface, {} for a scene){}{}.",
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
    /// Each camera's test card, and the copy the moving mark is drawn into.
    cards: [Vec<u8>; 3],
    marked: [Vec<u8>; 3],
    frame: u64,
    counts: Counts,
    counted: Instant,
    /// The last line said on stderr about the link: said once, not every
    /// second while it stays true.
    said: Option<String>,
    /// Connections given up in a row without a frame drawn.
    failures: u32,
}

impl Drawer {
    fn new() -> Self {
        let cards = [card_uyvy(1), card_uyvy(2), card_uyvy(3)];
        Self {
            link: None,
            connection: None,
            renderer: None,
            scene: None,
            retry_at: Instant::now(),
            cameras: Vec::new(),
            showing: false,
            marked: cards.clone(),
            cards,
            frame: 0,
            counts: Counts::default(),
            counted: Instant::now(),
            said: None,
            failures: 0,
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
            Order::Want { cameras, showing } => {
                self.cameras = cameras;
                if showing && !self.showing {
                    self.retry_at = Instant::now();
                }
                self.showing = showing;
                if !showing {
                    self.let_go();
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

    /// One draw: the scene, from every camera whose picture arrives.
    fn draw(&mut self) {
        let Some(scene) = self.scene.as_ref() else {
            if self.renderer.is_some() {
                self.counts.no_scene += 1;
            } else {
                self.counts.no_surface += 1;
            }
            return;
        };
        if self.renderer.is_none() {
            self.counts.no_surface += 1;
            return;
        }
        let frame = self.frame;
        self.frame = self.frame.wrapping_add(1);
        let mut arrives = [false; 3];
        for camera in &self.cameras {
            let index = usize::from(camera.camera).wrapping_sub(1);
            let shown = scene
                .pictures
                .iter()
                .any(|placed| placed.camera == camera.camera);
            if index < 3 && shown && SIMULATED_VMIX_INPUTS.contains(&camera.vmix_input) {
                arrives[index] = true;
            }
        }
        for (index, marked) in self.marked.iter_mut().enumerate() {
            if arrives[index] {
                marked.copy_from_slice(&self.cards[index]);
                mark(marked, FULL.0, FULL.1, frame);
            }
        }
        let picture = |index: usize| {
            arrives[index].then(|| Picture {
                uyvy: &self.marked[index],
                width: u32::from(FULL.0),
                height: u32::from(FULL.1),
                stride: u32::from(FULL.0) * 2,
            })
        };
        let pictures = [picture(0), picture(1), picture(2)];
        let started = Instant::now();
        let drawn = match self.renderer.as_mut() {
            Some(renderer) => renderer.draw(scene, &pictures),
            None => return,
        };
        match drawn {
            Ok(_) => {
                self.failures = 0;
                self.counts.drawn += 1;
                self.counts.slowest = self.counts.slowest.max(started.elapsed());
            }
            Err(why) => {
                self.counts.failed += 1;
                self.broke(format!("The pictures helper could not draw: {why}"));
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

    fn tick(&mut self) {
        self.connect();
        self.hear();
        if self.connection.is_some() {
            self.draw();
        }
        self.count();
    }
}

/// Draws until `orders` closes: the helper is ending.
pub fn run(orders: &Receiver<Order>) {
    let mut drawer = Drawer::new();
    let mut due = Instant::now();
    loop {
        // Nothing to draw while the page does not show the pictures: wait for
        // an order, not for the next frame's time.
        if !drawer.showing {
            match orders.recv() {
                Ok(order) => drawer.take(order),
                Err(_) => return,
            }
            due = Instant::now();
            continue;
        }
        match orders.recv_timeout(due.saturating_duration_since(Instant::now())) {
            Ok(order) => {
                drawer.take(order);
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        drawer.tick();
        due += FRAME_INTERVAL;
        // Behind by more than a frame (a busy PC, a slow present): the frames
        // missed are missed, not drawn in a burst.
        if due < Instant::now() {
            drawer.counts.late += 1;
            due = Instant::now() + FRAME_INTERVAL;
        }
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
        let mut drawer = Drawer::new();
        drawer.take(Order::Want {
            cameras: vec![WantedCamera {
                camera: 1,
                vmix_input: 1,
            }],
            showing: true,
        });
        // No link told: no connection is tried, and a draw is not counted.
        drawer.tick();
        assert!(drawer.connection.is_none() && drawer.renderer.is_none());
        assert!(!drawer.counts.any());
        drawer.take(Order::Want {
            cameras: Vec::new(),
            showing: false,
        });
        assert!(!drawer.showing);
    }
}
