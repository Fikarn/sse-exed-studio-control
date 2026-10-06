//! `PocketLink`: CAM 1's link as the runtime holds it. One thread speaks to
//! Windows (`winrt.rs`; `stub.rs` where there is no Windows) and keeps the
//! link's state (`state.rs`) up to date; the runtime reads the state at
//! once, never waiting on the camera, sends a press through the thread with
//! a bounded wait, and is told to look again whenever something it shows
//! changed (`notify`, the runtime's `notice`).
//!
//! The guard (D15 rule 2): `guard_bluetooth` is called before the thread
//! starts, and it refuses every test build and every development build, so
//! no test and no development run opens Bluetooth; the link then stands
//! stopped with the guard's sentence, which CAM 1 reads as its `UNREACHABLE`
//! sentence. Only the studio's build passes.

use crate::cameras::pocket::protocol::encode_commands;
use crate::cameras::pocket::state::{Connection, LinkState, Noticed};
use crate::cameras::real_link::LinkFailure;
use crate::cameras::simulated::{CameraCommand, CameraReading};
use std::fmt;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use studio_control_protocol::development::development_build;

#[cfg(not(windows))]
use crate::cameras::pocket::stub as platform;
#[cfg(windows)]
use crate::cameras::pocket::winrt as platform;

/// How long a press waits for the camera's answer before it reads as
/// unreachable: the request loop must never wait longer on a camera.
pub(crate) const SEND_TIMEOUT: Duration = Duration::from_secs(2);

/// Why no test and no development run opens Bluetooth.
const TEST_REFUSAL: &str =
    "A test run does not open Bluetooth: CAM 1 is reached by the studio's build alone (rule 2).";
const DEVELOPMENT_REFUSAL: &str =
    "A development run does not open Bluetooth: CAM 1 is reached by the studio's build alone (rule 2).";

/// The one check before Bluetooth is opened. A test build is refused
/// whatever else is true; a development build is refused (rule 2); the
/// studio's build passes.
pub(crate) fn guard_bluetooth() -> Result<(), String> {
    if cfg!(test) {
        return Err(String::from(TEST_REFUSAL));
    }
    if development_build() {
        return Err(String::from(DEVELOPMENT_REFUSAL));
    }
    Ok(())
}

/// What Windows hands the link's thread, through the handlers it registers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Event {
    /// The connection came (`true`) or went.
    Connected(bool),
    /// Bytes from the Incoming Camera Control characteristic.
    Control(Vec<u8>),
    /// Bytes from the Timecode characteristic.
    Timecode(Vec<u8>),
    /// Bytes from the Camera Status characteristic.
    Status(Vec<u8>),
}

/// What reaches the link's thread.
pub(crate) enum Order {
    /// A press: the messages to write, and where to say how it went.
    Send(Vec<Vec<u8>>, Sender<Result<(), String>>),
    /// Release, Forget, a new link: disconnect and end.
    LetGo,
    /// What Windows handed over.
    Event(Event),
}

/// What the thread and the runtime share.
pub(crate) struct Shared {
    pub address: u64,
    state: Mutex<LinkState>,
    /// Tells the runtime to read the link again and announce what changed.
    /// Called from the link's thread only, never under the state's lock.
    notify: Box<dyn Fn() + Send + Sync>,
}

impl Shared {
    pub(crate) fn with_state<T>(&self, action: impl FnOnce(&mut LinkState) -> T) -> T {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        action(&mut state)
    }

    fn notify_if(&self, noticed: Noticed) {
        if noticed == Noticed::Changed {
            (self.notify)();
        }
    }

    /// Takes what Windows handed over, and tells the runtime when it
    /// should look.
    pub(crate) fn take(&self, event: &Event) {
        let noticed = self.with_state(|state| match event {
            Event::Connected(true) => state.connected(),
            Event::Connected(false) => state.lost(),
            Event::Control(bytes) => state.control(bytes),
            Event::Timecode(bytes) => state.timecode(bytes),
            Event::Status(bytes) => state.status_flags(bytes),
        });
        self.notify_if(noticed);
    }

    /// The link cannot go on: the sentence says why.
    pub(crate) fn fail(&self, sentence: String) {
        let noticed = self.with_state(|state| state.failed(sentence));
        self.notify_if(noticed);
    }

    /// Let go on purpose.
    pub(crate) fn stopped(&self) {
        self.with_state(LinkState::let_go);
    }
}

impl fmt::Debug for Shared {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Shared")
            .field("address", &self.address)
            .field("state", &self.with_state(|state| state.clone()))
            .finish_non_exhaustive()
    }
}

/// CAM 1's link, cloned freely: every clone is the same link.
#[derive(Clone, Debug)]
pub(crate) struct PocketLink {
    shared: Arc<Shared>,
    orders: Sender<Order>,
}

impl PocketLink {
    /// Starts the link to the camera at `address`, behind the guard: in a
    /// test or development build no thread starts and the link stands
    /// stopped with the guard's sentence. `notify` is the runtime's way of
    /// hearing that something changed.
    pub(crate) fn start(address: u64, notify: impl Fn() + Send + Sync + 'static) -> Self {
        let (orders, inbox) = channel::<Order>();
        let shared = Arc::new(Shared {
            address,
            state: Mutex::new(LinkState::new()),
            notify: Box::new(notify),
        });
        match guard_bluetooth() {
            // Not through `fail`: the runtime holds its lock while it
            // starts a link, and would be told to look under it.
            Err(sentence) => {
                shared.with_state(|state| state.failed(sentence));
            }
            Ok(()) => {
                let thread_shared = Arc::clone(&shared);
                let events = orders.clone();
                let spawned = thread::Builder::new()
                    .name(String::from("cam1-bluetooth"))
                    .spawn(move || platform::run(thread_shared, inbox, events));
                if let Err(error) = spawned {
                    shared.with_state(|state| {
                        state.failed(format!("CAM 1's link could not start its thread: {error}"))
                    });
                }
            }
        }
        Self { shared, orders }
    }

    pub(crate) fn address(&self) -> u64 {
        self.shared.address
    }

    /// The link has stopped: let go, or failed.
    pub(crate) fn stopped(&self) -> bool {
        self.shared
            .with_state(|state| state.connection == Connection::Stopped)
    }

    /// What the camera last reported, at once; or why it cannot be read.
    pub(crate) fn read(&self) -> Result<CameraReading, LinkFailure> {
        self.shared.with_state(|state| state.read())
    }

    /// Sends a press: its messages are made from the commands and what the
    /// camera last reported, written by the thread, and waited for at most
    /// `SEND_TIMEOUT`. A press the protocol cannot carry is refused before
    /// anything is sent (`NotCarried`); a camera that does not answer in
    /// time reads as unreachable.
    pub(crate) fn send(
        &self,
        commands: &[CameraCommand],
        current: &CameraReading,
    ) -> Result<(), LinkFailure> {
        let messages = encode_commands(commands, current).map_err(LinkFailure::NotCarried)?;
        let (reply, answer) = channel();
        if self.orders.send(Order::Send(messages, reply)).is_err() {
            // The thread is gone: the state says why.
            return Err(self.read().err().unwrap_or(LinkFailure::NoAnswer));
        }
        match answer.recv_timeout(SEND_TIMEOUT) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(sentence)) => Err(LinkFailure::Bluetooth(sentence)),
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
                Err(LinkFailure::NoAnswer)
            }
        }
    }

    /// Lets the camera go: the thread disconnects and ends.
    pub(crate) fn let_go(&self) {
        let _ = self.orders.send(Order::LetGo);
        self.shared.stopped();
    }
}

/// The thread's inbox and the way Windows' handlers reach it, for the
/// platform modules.
pub(crate) type Inbox = Receiver<Order>;
pub(crate) type Events = Sender<Order>;
