//! The frames: sent to the shell's listener while the Cameras page shows
//! the pictures, at the source's rate, the selected camera big and the other
//! two small, each only while its picture arrives. They never pass the
//! engine.
//!
//! The listener is on 127.0.0.1 and nowhere else: an address that is not
//! this PC's is refused, whatever the line said. A connection that breaks is
//! made again after a second; the frames between are lost, as a slow page
//! skips them.

use crate::card::{mark, Cards, FULL, SMALL};
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};
use studio_control_protocol::pictures::{
    FrameFormat, FrameHeader, LinkSecret, WantedCamera, SIMULATED_VMIX_INPUTS,
};

/// 29.97 frames a second: what the studio's vMix preset sends.
pub const FRAME_INTERVAL: Duration = Duration::from_nanos(33_366_667);
/// How long a broken connection waits before it is made again.
const RECONNECT_DELAY: Duration = Duration::from_secs(1);
/// How long a write may take before the connection counts as broken.
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);

/// What the frame sender is told.
pub enum Order {
    Link(SocketAddr, LinkSecret),
    Want {
        cameras: Vec<WantedCamera>,
        selected: u8,
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

struct Sender {
    link: Option<(SocketAddr, LinkSecret)>,
    stream: Option<TcpStream>,
    retry_at: Instant,
    cameras: Vec<WantedCamera>,
    selected: u8,
    showing: bool,
    cards: [Cards; 3],
    sequence: [u64; 3],
    frame: u64,
}

impl Sender {
    fn take(&mut self, order: Order) {
        match order {
            Order::Link(address, secret) => {
                self.link = Some((address, secret));
                self.stream = None;
                self.retry_at = Instant::now();
            }
            Order::Want {
                cameras,
                selected,
                showing,
            } => {
                self.cameras = cameras;
                self.selected = selected;
                self.showing = showing;
                if !showing {
                    // Closed while nothing is sent: the shell's reader has
                    // no connection to wait on.
                    self.stream = None;
                }
            }
        }
    }

    /// The connection, made when there is none and the wait is over.
    fn connected(&mut self) -> Option<&mut TcpStream> {
        if self.stream.is_none() && Instant::now() >= self.retry_at {
            let (address, secret) = self.link.as_ref()?;
            self.retry_at = Instant::now() + RECONNECT_DELAY;
            let opened =
                TcpStream::connect_timeout(address, RECONNECT_DELAY).and_then(|mut stream| {
                    stream.set_write_timeout(Some(WRITE_TIMEOUT))?;
                    stream.set_nodelay(true)?;
                    writeln!(stream, "{}", secret.0)?;
                    Ok(stream)
                });
            match opened {
                Ok(stream) => self.stream = Some(stream),
                Err(error) => {
                    eprintln!("The pictures' listener did not take the connection: {error}")
                }
            }
        }
        self.stream.as_mut()
    }

    /// One frame of every camera whose picture arrives.
    fn send_frames(&mut self) {
        if !self.showing {
            return;
        }
        let frame = self.frame;
        self.frame = self.frame.wrapping_add(1);
        let wanted: Vec<(u8, bool)> = self
            .cameras
            .iter()
            .filter(|camera| SIMULATED_VMIX_INPUTS.contains(&camera.vmix_input))
            .map(|camera| (camera.camera, camera.camera == self.selected))
            .collect();
        for (camera, big) in wanted {
            let Some(index) = usize::from(camera)
                .checked_sub(1)
                .filter(|index| *index < 3)
            else {
                continue;
            };
            let (width, height) = if big { FULL } else { SMALL };
            let mut picture = if big {
                self.cards[index].full.clone()
            } else {
                self.cards[index].small.clone()
            };
            mark(&mut picture, width, height, frame);
            self.sequence[index] += 1;
            let header = FrameHeader::raw(
                camera,
                FrameFormat::Uyvy,
                width,
                height,
                self.sequence[index],
            );
            let Some(stream) = self.connected() else {
                return;
            };
            let written = stream
                .write_all(&header.encode())
                .and_then(|()| stream.write_all(&picture));
            if let Err(error) = written {
                eprintln!("The pictures' connection broke: {error}");
                self.stream = None;
                self.retry_at = Instant::now() + RECONNECT_DELAY;
                return;
            }
        }
    }
}

/// Sends frames until `orders` closes: the helper is ending.
pub fn run(orders: &Receiver<Order>) {
    let mut sender = Sender {
        link: None,
        stream: None,
        retry_at: Instant::now(),
        cameras: Vec::new(),
        selected: 1,
        showing: false,
        cards: [Cards::new(1), Cards::new(2), Cards::new(3)],
        sequence: [0; 3],
        frame: 0,
    };
    let mut due = Instant::now();
    loop {
        match orders.recv_timeout(due.saturating_duration_since(Instant::now())) {
            Ok(order) => {
                sender.take(order);
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        sender.send_frames();
        due += FRAME_INTERVAL;
        // Behind by more than a frame (a busy PC): the frames missed are
        // missed, not sent in a burst.
        if due < Instant::now() {
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
}
