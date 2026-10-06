//! `PocketLink`: CAM 1's link as the runtime holds it. One thread speaks to
//! Windows (`winrt.rs`; `stub.rs` where there is no Windows) and keeps the
//! link's state (`state.rs`) up to date; a second, small thread tells the
//! runtime to look again (`notify`, the runtime's `notice`) whenever
//! something the page shows changed, so the link's thread never waits on the
//! cameras' lock and a press never waits on a notice. The runtime reads the
//! state at once, never waiting on the camera, and sends a press through the
//! link's thread with a bounded wait.
//!
//! The guard (D15 rule 2): `guard_bluetooth` is called before any thread
//! starts, and it refuses every test build and every development build, so
//! no test and no development run opens Bluetooth; the link then stands
//! stopped with the guard's sentence, which CAM 1 reads as its `UNREACHABLE`
//! sentence. Only the studio's build passes.

use crate::cameras::pocket::protocol::encode_commands;
use crate::cameras::pocket::state::{Connection, LinkState, Noticed};
use crate::cameras::real_link::{BluetoothAddress, LinkFailure};
use crate::cameras::simulated::{CameraCommand, CameraReading};
use crate::diagnostics::{log_event, LogLevel};
use std::fmt;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::development::{
    camera_bluetooth_requested, development_build, CAMERA_BLUETOOTH_ENV,
};

#[cfg(not(windows))]
use crate::cameras::pocket::stub as platform;
#[cfg(windows)]
use crate::cameras::pocket::winrt as platform;

/// How long a press waits for the camera's answer before it reads as
/// unreachable: the request loop must never wait longer on a camera. A
/// press the thread reaches after this is not sent (its deadline).
pub(crate) const SEND_TIMEOUT: Duration = Duration::from_secs(2);
/// Notices to the runtime are coalesced and come at most this often: an
/// auto setting that moves every frame is one read and one event a quarter
/// second, not one each.
pub(crate) const NOTICE_INTERVAL: Duration = Duration::from_millis(250);

/// Why no test and no plain development run opens Bluetooth.
const TEST_REFUSAL: &str =
    "A test run does not open Bluetooth: CAM 1 is reached by the studio's build alone (rule 2).";
const DEVELOPMENT_REFUSAL: &str =
    "A development run does not open Bluetooth unless it was started with npm run app -- --bluetooth, a hardware test the owner attends (rule 2).";

/// The one check before Bluetooth is opened (rule 2). A test build is
/// refused whatever else is true; a development build passes only with
/// Bluetooth's switch, which `npm run app -- --bluetooth` alone sets (D41);
/// the studio's build passes, and never reads the switch.
pub(crate) fn guard_bluetooth() -> Result<(), String> {
    let switch =
        std::env::var(CAMERA_BLUETOOTH_ENV).is_ok_and(|value| camera_bluetooth_requested(&value));
    guard_bluetooth_for(cfg!(test), development_build(), switch)
}

/// The guard's rule over plain facts, for the tests.
pub(crate) fn guard_bluetooth_for(
    test_build: bool,
    development: bool,
    switch: bool,
) -> Result<(), String> {
    if test_build {
        return Err(String::from(TEST_REFUSAL));
    }
    if development && !switch {
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
    /// A press: the messages to write, where to say how it went, and the
    /// moment after which it is not sent any more (the runtime has stopped
    /// waiting, and told the operator the camera did not answer).
    Send {
        messages: Vec<Vec<u8>>,
        reply: Sender<Result<(), String>>,
        deadline: Instant,
    },
    /// Release, Forget, a new link: disconnect and end.
    LetGo,
    /// What Windows handed over.
    Event(Event),
}

/// What the threads and the runtime share.
pub(crate) struct Shared {
    pub address: BluetoothAddress,
    state: Mutex<LinkState>,
    /// The notifier thread's queue: one message a change, coalesced there.
    notices: Sender<()>,
}

impl Shared {
    pub(crate) fn with_state<T>(&self, action: impl FnOnce(&mut LinkState) -> T) -> T {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        action(&mut state)
    }

    /// Tells the notifier thread when the runtime should look. Never under
    /// the state's lock, and never waits.
    fn noticed(&self, noticed: Noticed) {
        if noticed == Noticed::Changed {
            let _ = self.notices.send(());
        }
    }

    /// Takes what Windows handed over, and tells the runtime when it
    /// should look. A connection that came or went is a line in the log.
    pub(crate) fn take(&self, event: &Event) {
        let noticed = self.with_state(|state| match event {
            Event::Connected(true) => state.connected(),
            Event::Connected(false) => state.lost(),
            Event::Control(bytes) => state.control(bytes),
            Event::Timecode(bytes) => state.timecode(bytes),
            Event::Status(bytes) => state.status_flags(bytes),
        });
        if noticed == Noticed::Changed {
            match event {
                Event::Connected(true) => log_event(
                    LogLevel::Info,
                    "CAM 1 is connected over Bluetooth and reads its settings.",
                ),
                Event::Connected(false) => log_event(
                    LogLevel::Warn,
                    "CAM 1's Bluetooth connection went. Windows connects again when the camera is free.",
                ),
                _ => {}
            }
        }
        self.noticed(noticed);
    }

    /// The link cannot go on for now: the sentence says why. The same
    /// sentence again changes nothing and says nothing.
    pub(crate) fn fail(&self, sentence: String) {
        let line = format!("CAM 1's Bluetooth link stopped: {sentence}");
        let noticed = self.with_state(|state| state.failed(sentence));
        if noticed == Noticed::Changed {
            log_event(LogLevel::Warn, &line);
        }
        self.noticed(noticed);
    }

    /// Let go on purpose.
    pub(crate) fn stopped(&self) {
        self.with_state(LinkState::let_go);
    }

    /// Why the link cannot read the camera now, for a press that arrives
    /// while it is stopped.
    pub(crate) fn failure_sentence(&self) -> String {
        self.with_state(|state| {
            state
                .failure
                .clone()
                .unwrap_or_else(|| String::from("CAM 1 is not connected over Bluetooth."))
        })
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
    /// hearing that something changed; it runs on the notifier thread.
    pub(crate) fn start(
        address: BluetoothAddress,
        notify: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        let (orders, inbox) = channel::<Order>();
        let (notices, notice_queue) = channel::<()>();
        let shared = Arc::new(Shared {
            address,
            state: Mutex::new(LinkState::new()),
            notices,
        });
        match guard_bluetooth() {
            // Not through `fail`: nobody is to be told to look at a link
            // that never started.
            Err(sentence) => {
                shared.with_state(|state| state.failed(sentence));
            }
            Ok(()) => {
                if development_build() {
                    log_event(
                        LogLevel::Info,
                        "CAM 1's Bluetooth link starts in a development run (SSE_CAMERA_BLUETOOTH=1): a hardware test the owner attends.",
                    );
                }
                let notifier = thread::Builder::new()
                    .name(String::from("cam1-notice"))
                    .spawn(move || run_notifier(&notice_queue, notify));
                let thread_shared = Arc::clone(&shared);
                let events = orders.clone();
                let link = thread::Builder::new()
                    .name(String::from("cam1-bluetooth"))
                    .spawn(move || platform::run(thread_shared, inbox, events));
                if let Err(error) = notifier.and(link) {
                    shared.with_state(|state| {
                        state.failed(format!("CAM 1's link could not start its thread: {error}"))
                    });
                }
            }
        }
        Self { shared, orders }
    }

    pub(crate) fn address(&self) -> BluetoothAddress {
        self.shared.address
    }

    /// The link has stopped: let go, or failed for now.
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
    /// `SEND_TIMEOUT`, after which the thread does not send it either. A
    /// press the protocol cannot carry is refused before anything is sent
    /// (`NotCarried`); a camera that does not answer in time reads as
    /// unreachable.
    pub(crate) fn send(
        &self,
        commands: &[CameraCommand],
        current: &CameraReading,
    ) -> Result<(), LinkFailure> {
        let messages = encode_commands(commands, current).map_err(LinkFailure::NotCarried)?;
        let (reply, answer) = channel();
        let deadline = Instant::now() + SEND_TIMEOUT;
        let order = Order::Send {
            messages,
            reply,
            deadline,
        };
        if self.orders.send(order).is_err() {
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

    /// Nobody but the link's own thread holds the link any more: it was
    /// dropped without `let_go`, and the thread ends by itself.
    pub(crate) fn abandoned(shared: &Arc<Shared>) -> bool {
        Arc::strong_count(shared) == 1
    }
}

/// The notifier thread: each queued notice becomes one call of `notify`,
/// what queued up meanwhile folded into it, and never two within
/// `NOTICE_INTERVAL`. It ends when the link is gone (every sender dropped).
fn run_notifier(queue: &Receiver<()>, notify: impl Fn()) {
    let mut last: Option<Instant> = None;
    while queue.recv().is_ok() {
        if let Some(last) = last {
            let since = last.elapsed();
            if since < NOTICE_INTERVAL {
                thread::sleep(NOTICE_INTERVAL - since);
            }
        }
        while queue.try_recv().is_ok() {}
        notify();
        last = Some(Instant::now());
    }
}

/// The thread's inbox and the way Windows' handlers reach it, for the
/// platform modules.
pub(crate) type Inbox = Receiver<Order>;
pub(crate) type Events = Sender<Order>;
