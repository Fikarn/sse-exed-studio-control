//! The Pocket link's own state, pure: whether the camera is connected, what
//! it has reported, and why it cannot be read. The link's thread feeds it
//! what Windows hands over (a connection that comes or goes, the bytes of a
//! notification, a failure) and asks it what the runtime should notice; the
//! runtime reads it at once, never waiting on the camera.

use crate::cameras::pocket::protocol::{apply, Message};
use crate::cameras::pocket::timecode::timecode_text;
use crate::cameras::real_link::LinkFailure;
use crate::cameras::simulated::CameraReading;
use std::collections::BTreeSet;

/// Where the link stands with the camera.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Connection {
    /// The link is up and Windows is asked to connect; the camera has not
    /// answered yet.
    Starting,
    /// Connected and subscribed: what the camera sends fills the reading.
    Connected,
    /// The connection went; Windows keeps trying while the link is held.
    Lost,
    /// The link stopped: let go, or a failure it cannot get past
    /// (`failure`).
    Stopped,
}

/// What a change on the link means for the runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Noticed {
    /// Nothing the runtime would show otherwise: a timecode that moved, a
    /// status flag, a message that changed no value.
    Nothing,
    /// Something the page shows changed: the runtime reads the link again
    /// and announces what it finds.
    Changed,
}

/// The camera status characteristic's flags (Blackmagic's Developer
/// Information).
pub(crate) const STATUS_POWER_ON: u8 = 0x01;
pub(crate) const STATUS_CONNECTED: u8 = 0x02;
pub(crate) const STATUS_PAIRED: u8 = 0x04;
pub(crate) const STATUS_VERSIONS_VERIFIED: u8 = 0x08;
pub(crate) const STATUS_INITIAL_PAYLOAD_RECEIVED: u8 = 0x10;
pub(crate) const STATUS_CAMERA_READY: u8 = 0x20;

/// The status flags in words, for the log: `power on, connected, paired`;
/// `none` for no flag; an unknown bit as its hex.
pub(crate) fn status_words(flags: u8) -> String {
    const NAMED: [(u8, &str); 6] = [
        (STATUS_POWER_ON, "power on"),
        (STATUS_CONNECTED, "connected"),
        (STATUS_PAIRED, "paired"),
        (STATUS_VERSIONS_VERIFIED, "versions verified"),
        (STATUS_INITIAL_PAYLOAD_RECEIVED, "initial payload sent"),
        (STATUS_CAMERA_READY, "camera ready"),
    ];
    let mut words: Vec<String> = NAMED
        .iter()
        .filter(|(bit, _)| flags & bit != 0)
        .map(|(_, word)| String::from(*word))
        .collect();
    let unknown = flags & !NAMED.iter().fold(0, |all, (bit, _)| all | bit);
    if unknown != 0 {
        words.push(format!("0x{unknown:02X}"));
    }
    if words.is_empty() {
        String::from("none")
    } else {
        words.join(", ")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LinkState {
    pub connection: Connection,
    /// What the camera has reported since it connected.
    pub reading: CameraReading,
    /// The camera status flags last notified.
    pub status: Option<u8>,
    /// Why the link stopped, in the operator's words; `None` while it runs
    /// or was let go.
    pub failure: Option<LinkFailure>,
    /// Reports the camera sent that `apply` does not read, each kind once
    /// per connection, for the log (the attended run, 2026-10-07).
    unread: Vec<String>,
    noted_unread: BTreeSet<(u8, u8, u8)>,
    /// How many notifications of each kind came since the connection, for
    /// the development run's trace.
    pub traced_control: usize,
    pub traced_timecode: usize,
}

/// How many control indications a development run traces each connection.
pub(crate) const TRACE_CONTROL: usize = 400;
/// The first timecode notifications a development run traces, and then one
/// in this many.
pub(crate) const TRACE_TIMECODE_FIRST: usize = 3;
pub(crate) const TRACE_TIMECODE_EVERY: usize = 150;

/// Bytes as the log writes them: `FF 08 00 00`.
pub(crate) fn hex(bytes: &[u8]) -> String {
    let pairs: Vec<String> = bytes.iter().map(|byte| format!("{byte:02X}")).collect();
    pairs.join(" ")
}

/// Every message in a notification, as the trace writes them:
/// `10.1 (type 1, operation 2, data 02 00 01)`; the raw bytes when nothing
/// in them reads as a message.
pub(crate) fn describe(bytes: &[u8]) -> String {
    let messages = Message::decode_all(bytes);
    if messages.is_empty() {
        return format!("raw {}", hex(bytes));
    }
    let described: Vec<String> = messages
        .iter()
        .map(|message| {
            format!(
                "{}.{} (type {}, operation {}, data {})",
                message.parameter.0,
                message.parameter.1,
                message.data_type,
                message.operation,
                if message.data.is_empty() {
                    String::from("none")
                } else {
                    hex(&message.data)
                }
            )
        })
        .collect();
    described.join("; ")
}

impl LinkState {
    pub(crate) fn new() -> Self {
        Self {
            connection: Connection::Starting,
            reading: CameraReading::default(),
            status: None,
            failure: None,
            unread: Vec::new(),
            noted_unread: BTreeSet::new(),
            traced_control: 0,
            traced_timecode: 0,
        }
    }

    /// The reports not read since the last call, as the log names them.
    pub(crate) fn take_unread(&mut self) -> Vec<String> {
        std::mem::take(&mut self.unread)
    }

    /// Connected and subscribed. The camera sends every setting afresh, so
    /// what was read before is dropped rather than shown as today's.
    pub(crate) fn connected(&mut self) -> Noticed {
        self.connection = Connection::Connected;
        self.reading = CameraReading::default();
        self.noted_unread.clear();
        self.traced_control = 0;
        self.traced_timecode = 0;
        self.status = None;
        Noticed::Changed
    }

    /// The connection went; the reading stays as the last known, which the
    /// runtime shows as doubt (D19).
    pub(crate) fn lost(&mut self) -> Noticed {
        if self.connection == Connection::Lost {
            return Noticed::Nothing;
        }
        self.connection = Connection::Lost;
        Noticed::Changed
    }

    /// The link cannot go on for now: the failure says why. The same
    /// failure again (a retry that failed the same way) changes nothing.
    pub(crate) fn failed(&mut self, failure: LinkFailure) -> Noticed {
        if self.connection == Connection::Stopped && self.failure.as_ref() == Some(&failure) {
            return Noticed::Nothing;
        }
        self.connection = Connection::Stopped;
        self.failure = Some(failure);
        Noticed::Changed
    }

    /// Let go on purpose: stopped, with nothing to say.
    pub(crate) fn let_go(&mut self) {
        self.connection = Connection::Stopped;
        self.failure = None;
    }

    /// Bytes from the Incoming Camera Control characteristic: every message
    /// in them is read into the reading.
    pub(crate) fn control(&mut self, bytes: &[u8]) -> Noticed {
        let before = self.reading.clone();
        for message in Message::decode_all(bytes) {
            if apply(&mut self.reading, &message) {
                continue;
            }
            let key = (message.parameter.0, message.parameter.1, message.data_type);
            if self.noted_unread.insert(key) {
                let data: Vec<String> = message
                    .data
                    .iter()
                    .map(|byte| format!("{byte:02X}"))
                    .collect();
                self.unread.push(format!(
                    "{}.{} (type {}, operation {}, data {})",
                    message.parameter.0,
                    message.parameter.1,
                    message.data_type,
                    message.operation,
                    if data.is_empty() {
                        String::from("none")
                    } else {
                        data.join(" ")
                    }
                ));
            }
        }
        if before.same_values(&self.reading) {
            Noticed::Nothing
        } else {
            Noticed::Changed
        }
    }

    /// Bytes from the Timecode characteristic. A timecode that moves is not
    /// a change the camera made (`same_values`).
    pub(crate) fn timecode(&mut self, bytes: &[u8]) -> Noticed {
        if let Some(timecode) = timecode_text(bytes) {
            self.reading.timecode = Some(timecode);
        }
        Noticed::Nothing
    }

    /// Bytes from the Camera Status characteristic: the flags. `Some` with
    /// the new flags when they differ from the last, for the log.
    pub(crate) fn status_flags(&mut self, bytes: &[u8]) -> Option<u8> {
        let flags = *bytes.first()?;
        if self.status == Some(flags) {
            return None;
        }
        self.status = Some(flags);
        Some(flags)
    }

    /// The camera has sent every setting once since it connected.
    pub(crate) fn initial_payload_received(&self) -> bool {
        self.status
            .is_some_and(|flags| flags & STATUS_INITIAL_PAYLOAD_RECEIVED != 0)
    }

    /// What the runtime reads: the reading while connected; otherwise why
    /// not.
    pub(crate) fn read(&self) -> Result<CameraReading, LinkFailure> {
        match self.connection {
            Connection::Connected => Ok(self.reading.clone()),
            Connection::Starting | Connection::Lost => Err(LinkFailure::NoAnswer),
            Connection::Stopped => Err(self.failure.clone().unwrap_or(LinkFailure::NoAnswer)),
        }
    }
}
