//! The Pocket link's own state, pure: whether the camera is connected, what
//! it has reported, and why it cannot be read. The link's thread feeds it
//! what Windows hands over (a connection that comes or goes, the bytes of a
//! notification, a failure) and asks it what the runtime should notice; the
//! runtime reads it at once, never waiting on the camera.

use crate::cameras::pocket::protocol::{apply, Message};
use crate::cameras::pocket::timecode::timecode_text;
use crate::cameras::real_link::LinkFailure;
use crate::cameras::simulated::CameraReading;

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
}

impl LinkState {
    pub(crate) fn new() -> Self {
        Self {
            connection: Connection::Starting,
            reading: CameraReading::default(),
            status: None,
            failure: None,
        }
    }

    /// Connected and subscribed. The camera sends every setting afresh, so
    /// what was read before is dropped rather than shown as today's.
    pub(crate) fn connected(&mut self) -> Noticed {
        self.connection = Connection::Connected;
        self.reading = CameraReading::default();
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
            apply(&mut self.reading, &message);
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

    /// Bytes from the Camera Status characteristic: the flags.
    pub(crate) fn status_flags(&mut self, bytes: &[u8]) -> Noticed {
        if let Some(flags) = bytes.first() {
            self.status = Some(*flags);
        }
        Noticed::Nothing
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
