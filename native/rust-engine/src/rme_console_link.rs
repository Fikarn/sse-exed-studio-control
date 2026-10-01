//! RME TotalMix console link: parses what the console says back over the
//! Global OSC remote and tracks whether the app's own sends were confirmed.
//!
//! Ground truth, measured live on the studio UFX III (TotalMix FX 2.1 beta,
//! Global OSC remote 4 on 7004/9004, 2026-09-03):
//!
//! - TotalMix does **not** echo a value back to the remote that sent it unless
//!   the per-remote "re-send" option is on (RME's own notes warn that it
//!   causes ping-pong and fader lag). A send is therefore confirmed by an
//!   explicit read-back: `/sendchan/{input|playback|output}/{ch}` for channel
//!   parameters, `/sendsubmix/{out} 2` for mix nodes, `/sendsettings` for the
//!   control-room functions. Every reply arrives as one burst ~30 ms later.
//! - Read-backs and dumps report faders in **dB** (`/mix/…/fader`,
//!   `/output/…/volume`), never `faderlin`, so comparisons go through the RME
//!   fader curve. `/sendsubmix 2` omits nodes at or below -65 dB, so an "off"
//!   send is confirmed by its absence once the reply burst has finished.
//! - Writes to channels hidden in the TotalMix layout are dropped silently;
//!   the read-back then reports the old value and the console wins.
//!
//! The state lives behind [`shared_console_link`]: the IPC thread registers
//! outgoing commands before they hit the wire, the metering thread (which owns
//! the Global slot socket) ingests replies, issues read-backs, expires
//! timeouts, and hands queued console changes to `audio::console_link` for
//! persistence.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use rosc::{OscMessage, OscType};

use crate::audio::fader_curve::{fader_lin_to_db, fader_positions_match, FADER_MATCH_TOLERANCE};

/// A send that has not been confirmed after this long is reported as such.
pub const CONFIRM_TIMEOUT_MS: u64 = 1_500;
/// Quiet time after the last send to a parameter before its read-back goes
/// out, so a fader drag produces one read-back at the end instead of one per
/// step.
pub const READBACK_DELAY_MS: u64 = 120;
/// A read-back reply burst counts as complete after this much silence.
pub const REPLY_QUIET_MS: u64 = 80;
/// How often queued console changes are written to the database.
pub const FLUSH_INTERVAL_MS: u64 = 100;
/// After a flush's write failed, how long before the link tries again to mark
/// the desk unread when nothing else is waiting.
pub const LOST_REPORTS_RETRY_MS: u64 = 2_000;
const GAIN_MATCH_TOLERANCE_DB: f64 = 0.5;
const MAX_UNCONFIRMED_ADDRESSES: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ConsoleBus {
    Input,
    Playback,
    Output,
}

impl ConsoleBus {
    fn from_word(word: &str) -> Option<Self> {
        match word {
            "input" => Some(Self::Input),
            "playback" => Some(Self::Playback),
            "output" => Some(Self::Output),
            _ => None,
        }
    }

    fn from_mix_word(word: &str) -> Option<Self> {
        match word {
            "in" => Some(Self::Input),
            "pb" => Some(Self::Playback),
            _ => None,
        }
    }

    pub fn word(self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::Playback => "playback",
            Self::Output => "output",
        }
    }

    fn mix_word(self) -> &'static str {
        match self {
            Self::Input => "in",
            Self::Playback => "pb",
            Self::Output => "out",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChannelFlag {
    Mute,
    Phantom,
    Phase,
    Instrument,
    AutoSet,
    Pad,
}

impl ChannelFlag {
    fn from_word(word: &str) -> Option<Self> {
        match word {
            "mute" => Some(Self::Mute),
            "48v" => Some(Self::Phantom),
            "phase" => Some(Self::Phase),
            "instrument" => Some(Self::Instrument),
            "autoset" => Some(Self::AutoSet),
            "pad" => Some(Self::Pad),
            _ => None,
        }
    }

    pub fn word(self) -> &'static str {
        match self {
            Self::Mute => "mute",
            Self::Phantom => "48v",
            Self::Phase => "phase",
            Self::Instrument => "instrument",
            Self::AutoSet => "autoset",
            Self::Pad => "pad",
        }
    }
}

/// The control room's switches the app follows. The desk's talkback is not
/// among them (D26, 2026-09-28): the studio does not use it, the app never
/// sends it, and a report of it is ignored like any address it does not read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ControlRoomFunction {
    Dim,
    MainMono,
}

impl ControlRoomFunction {
    fn from_word(word: &str) -> Option<Self> {
        match word {
            "dim" => Some(Self::Dim),
            "mainmono" => Some(Self::MainMono),
            _ => None,
        }
    }

    pub fn word(self) -> &'static str {
        match self {
            Self::Dim => "dim",
            Self::MainMono => "mainmono",
        }
    }
}

/// Identity of one console parameter, shared by the app's outgoing command
/// (`faderlin`) and the console's reply for it (`fader` in dB).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ParamKey {
    ChannelFlag {
        bus: ConsoleBus,
        channel: usize,
        flag: ChannelFlag,
    },
    InputGain {
        channel: usize,
    },
    OutputVolume {
        output: usize,
    },
    MixFader {
        bus: ConsoleBus,
        channel: usize,
        output: usize,
    },
    MixSolo {
        bus: ConsoleBus,
        channel: usize,
        output: usize,
    },
    /// A channel's name as TotalMix shows it (`/input|playback|output/<ch>/name`,
    /// a string in channel dumps and `/sendall`). Names are given at TotalMix
    /// only: the app never sends one, so nothing reads it back.
    ChannelName {
        bus: ConsoleBus,
        channel: usize,
    },
    ControlRoom(ControlRoomFunction),
    StatusConnection,
    StatusDevice,
    StatusDsp,
    SnapshotLoad {
        number: usize,
    },
}

impl ParamKey {
    /// The read-back that makes the console report this parameter.
    pub fn readback(&self) -> Option<ReadbackRequest> {
        match self {
            Self::ChannelFlag { bus, channel, .. } => Some(ReadbackRequest::Channel {
                bus: *bus,
                channel: *channel,
            }),
            Self::InputGain { channel } => Some(ReadbackRequest::Channel {
                bus: ConsoleBus::Input,
                channel: *channel,
            }),
            Self::OutputVolume { output } => Some(ReadbackRequest::Channel {
                bus: ConsoleBus::Output,
                channel: *output,
            }),
            Self::MixFader { output, .. } | Self::MixSolo { output, .. } => {
                Some(ReadbackRequest::Submix { output: *output })
            }
            Self::ControlRoom(_) => Some(ReadbackRequest::Settings),
            Self::ChannelName { .. }
            | Self::StatusConnection
            | Self::StatusDevice
            | Self::StatusDsp
            | Self::SnapshotLoad { .. } => None,
        }
    }

    /// Operator-facing name, e.g. `input 8 mute`, `mix pb 6 -> out 10 fader`.
    pub fn describe(&self) -> String {
        match self {
            Self::ChannelFlag { bus, channel, flag } => {
                format!("{} {} {}", bus.word(), channel, flag.word())
            }
            Self::InputGain { channel } => format!("input {channel} gain"),
            Self::OutputVolume { output } => format!("output {output} volume"),
            Self::MixFader {
                bus,
                channel,
                output,
            } => format!("mix {} {} -> out {} fader", bus.mix_word(), channel, output),
            Self::MixSolo {
                bus,
                channel,
                output,
            } => format!("mix {} {} -> out {} solo", bus.mix_word(), channel, output),
            Self::ChannelName { bus, channel } => format!("{} {} name", bus.word(), channel),
            Self::ControlRoom(function) => format!("control room {}", function.word()),
            Self::StatusConnection => String::from("status connection"),
            Self::StatusDevice => String::from("status device"),
            Self::StatusDsp => String::from("status dsp"),
            Self::SnapshotLoad { number } => format!("snapshot {number}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConsoleValue {
    /// Linear fader position 0..1 (`faderlin`).
    Position(f64),
    /// Decibels (`fader`, `volume`, `gain`).
    Db(f64),
    Flag(bool),
    Number(f64),
    Text(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConsoleMessage {
    pub key: ParamKey,
    pub value: ConsoleValue,
}

fn numeric(value: &OscType) -> Option<f64> {
    match value {
        OscType::Float(v) => Some(f64::from(*v)),
        OscType::Double(v) => Some(*v),
        OscType::Int(v) => Some(f64::from(*v)),
        OscType::Long(v) => Some(*v as f64),
        OscType::Bool(v) => Some(if *v { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn flag(value: &OscType) -> Option<bool> {
    numeric(value).map(|v| v >= 0.5)
}

fn text(value: &OscType) -> Option<String> {
    match value {
        OscType::String(v) => Some(v.clone()),
        _ => None,
    }
}

/// Parses one Global OSC message into the parameter it addresses. Returns
/// `None` for levels, EQ/dynamics detail, triggers, and anything else the app
/// does not model, so the caller can count it and move on. The same parser
/// serves the app's own outgoing commands (same vocabulary, `faderlin`).
pub fn parse_console_message(message: &OscMessage) -> Option<ConsoleMessage> {
    let trimmed = message.addr.trim_start_matches('/');
    let parts: Vec<&str> = trimmed.split('/').collect();
    let arg = message.args.first()?;
    let (key, value) = match parts.as_slice() {
        ["status", "connection"] => (
            ParamKey::StatusConnection,
            ConsoleValue::Number(numeric(arg)?),
        ),
        ["status", "device"] => (ParamKey::StatusDevice, ConsoleValue::Text(text(arg)?)),
        ["status", "dsp"] => (ParamKey::StatusDsp, ConsoleValue::Number(numeric(arg)?)),
        ["snapshot", "load", number] => (
            ParamKey::SnapshotLoad {
                number: number.parse().ok()?,
            },
            ConsoleValue::Number(numeric(arg)?),
        ),
        ["controlroom", function] => (
            ParamKey::ControlRoom(ControlRoomFunction::from_word(function)?),
            ConsoleValue::Flag(flag(arg)?),
        ),
        ["mix", bus_word, channel, output, param] => {
            let bus = ConsoleBus::from_mix_word(bus_word)?;
            let channel = channel.parse().ok()?;
            let output = output.parse().ok()?;
            match *param {
                "fader" => (
                    ParamKey::MixFader {
                        bus,
                        channel,
                        output,
                    },
                    ConsoleValue::Db(numeric(arg)?),
                ),
                "faderlin" => (
                    ParamKey::MixFader {
                        bus,
                        channel,
                        output,
                    },
                    ConsoleValue::Position(numeric(arg)?),
                ),
                "solo" => (
                    ParamKey::MixSolo {
                        bus,
                        channel,
                        output,
                    },
                    ConsoleValue::Flag(flag(arg)?),
                ),
                _ => return None,
            }
        }
        ["output", output, "volume"] => (
            ParamKey::OutputVolume {
                output: output.parse().ok()?,
            },
            ConsoleValue::Db(numeric(arg)?),
        ),
        ["output", output, "faderlin"] => (
            ParamKey::OutputVolume {
                output: output.parse().ok()?,
            },
            ConsoleValue::Position(numeric(arg)?),
        ),
        ["input", channel, "gain"] => (
            ParamKey::InputGain {
                channel: channel.parse().ok()?,
            },
            ConsoleValue::Db(numeric(arg)?),
        ),
        // A name is a string; anything else at a name's address is not one.
        [bus_word, channel, "name"] => (
            ParamKey::ChannelName {
                bus: ConsoleBus::from_word(bus_word)?,
                channel: channel.parse().ok()?,
            },
            ConsoleValue::Text(text(arg)?),
        ),
        [bus_word, channel, flag_word] => {
            let bus = ConsoleBus::from_word(bus_word)?;
            let flag_kind = ChannelFlag::from_word(flag_word)?;
            if bus != ConsoleBus::Input && flag_kind != ChannelFlag::Mute {
                return None;
            }
            (
                ParamKey::ChannelFlag {
                    bus,
                    channel: channel.parse().ok()?,
                    flag: flag_kind,
                },
                ConsoleValue::Flag(flag(arg)?),
            )
        }
        _ => return None,
    };
    Some(ConsoleMessage { key, value })
}

/// Which read-back command makes TotalMix report a group of parameters.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ReadbackRequest {
    Channel { bus: ConsoleBus, channel: usize },
    Submix { output: usize },
    Settings,
}

impl ReadbackRequest {
    /// The datagrams that make TotalMix report this group. A submix read-back
    /// is followed by `/sendstate`: `/sendsubmix 2` answers nothing at all for
    /// a bus with no active nodes (live-verified), so the status reply is the
    /// guaranteed end-of-burst marker that lets an "off" send confirm by
    /// absence.
    pub fn osc(&self) -> Vec<(String, OscType)> {
        match self {
            Self::Channel { bus, channel } => vec![(
                format!("/sendchan/{}/{}", bus.word(), channel),
                OscType::Float(1.0),
            )],
            Self::Submix { output } => vec![
                (format!("/sendsubmix/{output}"), OscType::Float(2.0)),
                (String::from("/sendstate"), OscType::Float(1.0)),
            ],
            Self::Settings => vec![(String::from("/sendsettings"), OscType::Float(1.0))],
        }
    }

    fn covers(&self, key: &ParamKey) -> bool {
        match (self, key) {
            (
                Self::Channel { bus, channel },
                ParamKey::ChannelFlag {
                    bus: key_bus,
                    channel: key_channel,
                    ..
                },
            ) => bus == key_bus && channel == key_channel,
            (
                Self::Channel { bus, channel },
                ParamKey::InputGain {
                    channel: key_channel,
                },
            ) => *bus == ConsoleBus::Input && channel == key_channel,
            (Self::Channel { bus, channel }, ParamKey::OutputVolume { output }) => {
                *bus == ConsoleBus::Output && channel == output
            }
            (
                Self::Submix { output },
                ParamKey::MixFader {
                    output: key_output, ..
                },
            )
            | (
                Self::Submix { output },
                ParamKey::MixSolo {
                    output: key_output, ..
                },
            ) => output == key_output,
            (Self::Settings, ParamKey::ControlRoom(_)) => true,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PendingSend {
    pub key: ParamKey,
    pub value: ConsoleValue,
    pub sent_at_ms: u64,
    pub requested_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classification {
    /// The console reported the value the app sent.
    Confirmed,
    /// The console reported a different value for a parameter the app sent;
    /// the console's value is queued and wins.
    Adjusted,
    /// A reply that predates a newer send of the same parameter; ignored.
    Stale,
    /// A change nobody in the app asked for (operator at TotalMix, another
    /// remote, a read-back reporting untouched parameters); queued.
    External,
    /// `/status/*` or `/snapshot/load/*`; recorded on the link only.
    Status,
    /// Not a parameter the app models (levels, EQ detail, …).
    Ignored,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConsoleUpdate {
    pub key: ParamKey,
    pub value: ConsoleValue,
    pub adjusted: bool,
    /// The desk confirmed a value the app sent. It is written like any other
    /// report, so it lands after whatever the desk said about the parameter
    /// before it, but it is the app's own action, not a change at TotalMix.
    pub confirms_send: bool,
    /// The desk reported it while a load in TotalMix was under way: it is the
    /// load's, written like any report but not a change made at TotalMix.
    pub during_load: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ConsoleConnection {
    #[default]
    Unknown,
    Connected,
    Disconnected,
}

impl ConsoleConnection {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Connected => "connected",
            Self::Disconnected => "disconnected",
        }
    }
}

/// TotalMix keeps eight snapshots, numbered 1 to 8 on its remote.
pub use crate::rme_totalmix_names::SNAPSHOT_SLOTS;

/// What TotalMix last said about one of its snapshot slots
/// (`/snapshot/load/N`: 0 off, 2 active, 3 active and changed since it was
/// loaded).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SnapshotSlotState {
    /// The desk has not reported this slot since the link last knew it.
    #[default]
    Unknown,
    Off,
    Active,
    /// Loaded, and something has been changed on the desk since.
    Changed,
}

impl SnapshotSlotState {
    /// The state a `/snapshot/load/N` value reports; `None` for any other
    /// value (TotalMix sends 0, 2 and 3; 1 is only ever sent to it, to load).
    fn from_report(value: f64) -> Option<Self> {
        if value < 0.5 {
            Some(Self::Off)
        } else if (1.5..2.5).contains(&value) {
            Some(Self::Active)
        } else if (2.5..3.5).contains(&value) {
            Some(Self::Changed)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone)]
struct OutstandingRequest {
    requested_at_ms: u64,
    last_reply_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConsoleLinkSummary {
    pub slot_bound: bool,
    pub connection: ConsoleConnection,
    pub device: Option<String>,
    pub dsp_load: Option<f64>,
    pub last_echo_age_ms: Option<u64>,
    pub pending_sends: usize,
    pub unconfirmed_sends: u64,
    pub unconfirmed_addresses: Vec<String>,
    pub confirmed_sends: u64,
    pub adjusted_sends: u64,
    pub external_changes: u64,
    /// TotalMix's eight snapshot slots, slot 1 first.
    pub snapshot_slots: [SnapshotSlotState; SNAPSHOT_SLOTS],
}

#[derive(Debug, Default)]
pub struct ConsoleLinkState {
    pending: HashMap<ParamKey, PendingSend>,
    outstanding: HashMap<ReadbackRequest, OutstandingRequest>,
    queued: Vec<ConsoleUpdate>,
    expired: Vec<PendingSend>,
    pub slot_bound: bool,
    connection: ConsoleConnection,
    connection_lost: bool,
    reports_lost: bool,
    reports_lost_retry_at_ms: u64,
    device: Option<String>,
    dsp_load: Option<f64>,
    last_echo_at_ms: Option<u64>,
    snapshot_slots: [SnapshotSlotState; SNAPSHOT_SLOTS],
    /// Per slot, the report count when the desk last reported it.
    snapshot_slot_seqs: [u64; SNAPSHOT_SLOTS],
    /// Counts every valid slot report, so a caller that sent something can
    /// wait for a report that came after it.
    snapshot_report_seq: u64,
    /// A slot's state changed since the last flush took it.
    snapshot_slots_changed: bool,
    /// A load in TotalMix is under way: from just before it is sent until
    /// its read-back has been written.
    load_in_progress: bool,
    confirmed_total: u64,
    adjusted_total: u64,
    external_total: u64,
    unconfirmed_total: u64,
    unconfirmed_addresses: Vec<String>,
    pull: Option<PullTracker>,
}

/// Bookkeeping for one console pull (`/sendall 2` + `/sendstate`): what
/// arrived, when the burst went quiet, and which mix nodes the console listed
/// (so the caller can treat the ones it omitted as off).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullProgress {
    pub started_at_ms: u64,
    /// Every non-level datagram since the pull began, parsed or not.
    pub control_messages: u64,
    /// Messages the link could map to a parameter the app models.
    pub parsed_messages: u64,
    pub last_message_age_ms: Option<u64>,
    pub status_seen: bool,
    pub channels_seen: Vec<(ConsoleBus, usize)>,
    pub outputs_seen: Vec<usize>,
    pub mix_nodes_seen: Vec<(ConsoleBus, usize, usize)>,
    /// Every name the dump carried, as TotalMix sent it (the last one for a
    /// channel wins), for the log's line on what a read-back named.
    pub names: Vec<(ConsoleBus, usize, String)>,
}

impl PullProgress {
    /// The dump has ended: something arrived and the console has been quiet
    /// for `quiet_ms`.
    pub fn is_complete(&self, quiet_ms: u64) -> bool {
        self.control_messages > 0
            && self
                .last_message_age_ms
                .map(|age| age >= quiet_ms)
                .unwrap_or(false)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PullTracker {
    started_at_ms: u64,
    control_messages: u64,
    parsed_messages: u64,
    last_message_at_ms: Option<u64>,
    status_seen: bool,
    channels_seen: Vec<(ConsoleBus, usize)>,
    outputs_seen: Vec<usize>,
    mix_nodes_seen: Vec<(ConsoleBus, usize, usize)>,
    names: Vec<(ConsoleBus, usize, String)>,
}

impl PullTracker {
    fn progress(&self, now_ms: u64) -> PullProgress {
        PullProgress {
            started_at_ms: self.started_at_ms,
            control_messages: self.control_messages,
            parsed_messages: self.parsed_messages,
            last_message_age_ms: self
                .last_message_at_ms
                .map(|last| now_ms.saturating_sub(last)),
            status_seen: self.status_seen,
            channels_seen: self.channels_seen.clone(),
            outputs_seen: self.outputs_seen.clone(),
            mix_nodes_seen: self.mix_nodes_seen.clone(),
            names: self.names.clone(),
        }
    }

    fn note(&mut self, key: &ParamKey, value: &ConsoleValue) {
        if let (ParamKey::ChannelName { bus, channel }, ConsoleValue::Text(name)) = (key, value) {
            self.names
                .retain(|(seen_bus, seen_channel, _)| (seen_bus, seen_channel) != (bus, channel));
            self.names.push((*bus, *channel, name.clone()));
        }
        self.parsed_messages = self.parsed_messages.saturating_add(1);
        match key {
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Output,
                channel,
                ..
            }
            | ParamKey::ChannelName {
                bus: ConsoleBus::Output,
                channel,
            }
            | ParamKey::OutputVolume { output: channel } => {
                if !self.outputs_seen.contains(channel) {
                    self.outputs_seen.push(*channel);
                }
            }
            ParamKey::ChannelFlag { bus, channel, .. } | ParamKey::ChannelName { bus, channel } => {
                if !self.channels_seen.contains(&(*bus, *channel)) {
                    self.channels_seen.push((*bus, *channel));
                }
            }
            ParamKey::InputGain { channel } => {
                if !self.channels_seen.contains(&(ConsoleBus::Input, *channel)) {
                    self.channels_seen.push((ConsoleBus::Input, *channel));
                }
            }
            ParamKey::MixFader {
                bus,
                channel,
                output,
            } => {
                if !self.mix_nodes_seen.contains(&(*bus, *channel, *output)) {
                    self.mix_nodes_seen.push((*bus, *channel, *output));
                }
            }
            ParamKey::StatusConnection | ParamKey::StatusDevice | ParamKey::StatusDsp => {
                self.status_seen = true;
            }
            ParamKey::MixSolo { .. } | ParamKey::ControlRoom(_) | ParamKey::SnapshotLoad { .. } => {
            }
        }
    }
}

fn values_match(sent: &ConsoleValue, reported: &ConsoleValue) -> bool {
    match (sent, reported) {
        (ConsoleValue::Position(a), ConsoleValue::Position(b)) => {
            (a - b).abs() <= FADER_MATCH_TOLERANCE
        }
        (ConsoleValue::Position(a), ConsoleValue::Db(b)) => fader_positions_match(*a, *b),
        (ConsoleValue::Db(a), ConsoleValue::Db(b)) => (a - b).abs() <= GAIN_MATCH_TOLERANCE_DB,
        (ConsoleValue::Flag(a), ConsoleValue::Flag(b)) => a == b,
        (ConsoleValue::Number(a), ConsoleValue::Number(b)) => (a - b).abs() < 1e-6,
        _ => false,
    }
}

fn is_off_send(value: &ConsoleValue) -> bool {
    match value {
        ConsoleValue::Position(position) => fader_lin_to_db(*position).is_none(),
        _ => false,
    }
}

/// Whether a pending send that a completed read-back burst did not mention
/// counts as confirmed. Live-verified on the studio desk (2026-09-03):
/// `/sendsubmix 2` lists only nodes above -65 dB, so an off fader and a
/// solo-off on such a node never appear; `/sendchan` for the right side of a
/// stereo-linked pair reports only the L/R parameters, so a mute or gain sent
/// to it is never echoed either. A fader that should be audible but is absent
/// stays unconfirmed — that is exactly the hidden-channel case where TotalMix
/// dropped the write.
fn confirmable_by_absence(request: &ReadbackRequest, key: &ParamKey, value: &ConsoleValue) -> bool {
    match (request, key) {
        (ReadbackRequest::Submix { .. }, ParamKey::MixFader { .. }) => is_off_send(value),
        (ReadbackRequest::Submix { .. }, ParamKey::MixSolo { .. }) => {
            matches!(value, ConsoleValue::Flag(false))
        }
        (ReadbackRequest::Channel { .. }, _) => true,
        _ => false,
    }
}

/// Whether a read-back burst that went quiet answers this pending send: the
/// send's own read-back was asked at or before the request the burst
/// completed. The link keeps one request per read-back, stamped with the time
/// it was last asked, so when a second burst of sends to the same submix
/// settles on a later check, its read-back restamps the request before the
/// first reply has gone quiet. The first burst's sends were asked earlier and
/// the desk had them before either request. Matched on the exact time (until
/// 2026-10-01, a fault since #201), their off faders and solo-offs, which
/// `/sendsubmix 2` never lists, expired as unconfirmed: on the studio desk 25
/// of 122 values after a recall, and the Console fell to assumed. A send not
/// yet asked is not answered: the desk may have dumped the submix before the
/// send reached it.
fn read_back_answers(pending: &PendingSend, asked_at_ms: u64) -> bool {
    pending
        .requested_at_ms
        .is_some_and(|requested_at| requested_at <= asked_at_ms)
}

impl ConsoleLinkState {
    /// Records one outgoing command so its read-back can confirm it. Sending
    /// the same parameter again (a fader drag) restarts its clock and cancels
    /// the read-back that was scheduled for the earlier value.
    pub fn register_send(&mut self, key: ParamKey, value: ConsoleValue, now_ms: u64) {
        if key.readback().is_none() {
            return;
        }
        self.pending.insert(
            key.clone(),
            PendingSend {
                key,
                value,
                sent_at_ms: now_ms,
                requested_at_ms: None,
            },
        );
    }

    /// Registers every recognised command in an outgoing batch.
    pub fn register_outgoing(&mut self, messages: &[(String, OscType)], now_ms: u64) {
        for (address, value) in messages {
            let message = OscMessage {
                addr: address.clone(),
                args: vec![value.clone()],
            };
            if let Some(parsed) = parse_console_message(&message) {
                self.register_send(parsed.key, parsed.value, now_ms);
            }
        }
    }

    /// Starts tracking a console pull. The caller sends `/sendall 2` +
    /// `/sendstate` itself; the metering thread keeps ingesting as usual.
    pub fn begin_pull(&mut self, now_ms: u64) {
        self.pull = Some(PullTracker {
            started_at_ms: now_ms,
            control_messages: 0,
            parsed_messages: 0,
            last_message_at_ms: None,
            status_seen: false,
            channels_seen: Vec::new(),
            outputs_seen: Vec::new(),
            mix_nodes_seen: Vec::new(),
            names: Vec::new(),
        });
    }

    pub fn pull_progress(&self, now_ms: u64) -> Option<PullProgress> {
        self.pull.as_ref().map(|tracker| tracker.progress(now_ms))
    }

    /// Ends the pull and returns what it saw.
    pub fn finish_pull(&mut self, now_ms: u64) -> Option<PullProgress> {
        self.pull.take().map(|tracker| tracker.progress(now_ms))
    }

    pub fn ingest(&mut self, message: &OscMessage, now_ms: u64) -> Classification {
        if !message.addr.starts_with("/level/") {
            if let Some(tracker) = self.pull.as_mut() {
                tracker.control_messages = tracker.control_messages.saturating_add(1);
                tracker.last_message_at_ms = Some(now_ms);
            }
        }
        let Some(parsed) = parse_console_message(message) else {
            return Classification::Ignored;
        };
        self.last_echo_at_ms = Some(now_ms);
        if let Some(tracker) = self.pull.as_mut() {
            tracker.note(&parsed.key, &parsed.value);
        }

        let mut newest_request_at: Option<u64> = None;
        for (request, outstanding) in self.outstanding.iter_mut() {
            if request.covers(&parsed.key) {
                outstanding.last_reply_at_ms = Some(now_ms);
                newest_request_at = Some(
                    newest_request_at
                        .map(|current| current.max(outstanding.requested_at_ms))
                        .unwrap_or(outstanding.requested_at_ms),
                );
            }
        }

        // Status replies are the end-of-burst marker for every outstanding
        // read-back (each submix read-back is paired with `/sendstate`).
        if matches!(
            parsed.key,
            ParamKey::StatusConnection | ParamKey::StatusDevice | ParamKey::StatusDsp
        ) {
            for outstanding in self.outstanding.values_mut() {
                if outstanding.requested_at_ms <= now_ms && outstanding.last_reply_at_ms.is_none() {
                    outstanding.last_reply_at_ms = Some(now_ms);
                }
            }
        }

        match (&parsed.key, &parsed.value) {
            (ParamKey::StatusConnection, ConsoleValue::Number(value)) => {
                let next = if *value >= 0.5 {
                    ConsoleConnection::Connected
                } else {
                    ConsoleConnection::Disconnected
                };
                if next == ConsoleConnection::Disconnected
                    && self.connection != ConsoleConnection::Disconnected
                {
                    self.connection_lost = true;
                }
                if next == ConsoleConnection::Disconnected {
                    // With the interface gone the desk's snapshots are not
                    // known until it reports them again.
                    self.forget_snapshot_slots();
                }
                self.connection = next;
                return Classification::Status;
            }
            (ParamKey::StatusDevice, ConsoleValue::Text(value)) => {
                if let Some(line) = self.note_device(value) {
                    crate::diagnostics::log_event(crate::diagnostics::LogLevel::Info, &line);
                }
                return Classification::Status;
            }
            (ParamKey::StatusDsp, ConsoleValue::Number(value)) => {
                self.dsp_load = Some(*value);
                return Classification::Status;
            }
            (ParamKey::SnapshotLoad { number }, ConsoleValue::Number(value)) => {
                self.note_snapshot_report(*number, *value);
                return Classification::Status;
            }
            _ => {}
        }

        let pulling = self.pull.is_some();
        if let Some(pending) = self.pending.get(&parsed.key) {
            if values_match(&pending.value, &parsed.value) {
                let sent = pending.value.clone();
                self.pending.remove(&parsed.key);
                self.confirmed_total = self.confirmed_total.saturating_add(1);
                // The desk holds the app's value now, and that is applied
                // too: a report of this parameter that was waiting for a flush
                // when the app wrote its own value (a change at TotalMix just
                // before a recall or an edit) must not be the last word. When
                // the app's state already says it, applying it changes
                // nothing. During a pull the dump is the truth for everything
                // it lists, so the value the desk reported is applied.
                self.queued.push(ConsoleUpdate {
                    key: parsed.key,
                    value: if pulling { parsed.value } else { sent },
                    adjusted: false,
                    confirms_send: true,
                    during_load: self.load_in_progress,
                });
                return Classification::Confirmed;
            }
            // A reply can answer a send only if something asked the desk after
            // the send: its own read-back, or, during a pull, the pull's
            // request, which covers every parameter. A dump line for a
            // parameter the app sent after the pull began may predate the send
            // (the desk dumped it before the send reached it). Taken as the desk
            // adjusting the send, it was written, the send was never read back,
            // and Sync wrote aligned over a value the desk no longer held. It is
            // stale like any older reply; the send's own read-back decides it.
            // The pull's time is stamped before its request leaves, in whole
            // milliseconds, so a send stamped in the same millisecond may have
            // left after the request: only a pull that began strictly after the
            // send can answer it. A read-back is asked at least
            // READBACK_DELAY_MS after its send, so it has no such tie.
            let answered_by_read_back =
                newest_request_at.is_some_and(|requested_at| requested_at >= pending.sent_at_ms);
            let answered_by_pull = self
                .pull
                .as_ref()
                .is_some_and(|tracker| tracker.started_at_ms > pending.sent_at_ms);
            let reply_is_stale = !(answered_by_read_back || answered_by_pull);
            if reply_is_stale {
                return Classification::Stale;
            }
            self.pending.remove(&parsed.key);
            self.adjusted_total = self.adjusted_total.saturating_add(1);
            self.queued.push(ConsoleUpdate {
                key: parsed.key,
                value: parsed.value,
                adjusted: true,
                confirms_send: false,
                during_load: self.load_in_progress,
            });
            return Classification::Adjusted;
        }

        self.external_total = self.external_total.saturating_add(1);
        self.queued.push(ConsoleUpdate {
            key: parsed.key,
            value: parsed.value,
            adjusted: false,
            confirms_send: false,
            during_load: self.load_in_progress,
        });
        Classification::External
    }

    /// Read-back commands that should go out now: one per request kind, for
    /// every pending send that has settled for `READBACK_DELAY_MS`.
    pub fn due_readbacks(&mut self, now_ms: u64) -> Vec<(String, OscType)> {
        let mut requests: Vec<ReadbackRequest> = Vec::new();
        for pending in self.pending.values_mut() {
            if pending.requested_at_ms.is_some()
                || now_ms.saturating_sub(pending.sent_at_ms) < READBACK_DELAY_MS
            {
                continue;
            }
            if let Some(request) = pending.key.readback() {
                pending.requested_at_ms = Some(now_ms);
                if !requests.contains(&request) {
                    requests.push(request);
                }
            }
        }
        for request in &requests {
            self.outstanding.insert(
                request.clone(),
                OutstandingRequest {
                    requested_at_ms: now_ms,
                    last_reply_at_ms: None,
                },
            );
        }
        requests.iter().flat_map(ReadbackRequest::osc).collect()
    }

    /// Completes quiet reply bursts (an off fader absent from its submix reply
    /// is confirmed) and expires sends that were never confirmed.
    pub fn tick(&mut self, now_ms: u64) {
        let completed: Vec<ReadbackRequest> = self
            .outstanding
            .iter()
            .filter(|(_, outstanding)| {
                outstanding
                    .last_reply_at_ms
                    .map(|last| now_ms.saturating_sub(last) >= REPLY_QUIET_MS)
                    .unwrap_or(false)
            })
            .map(|(request, _)| request.clone())
            .collect();
        for request in completed {
            let Some(outstanding) = self.outstanding.remove(&request) else {
                continue;
            };
            let absent_sends: Vec<ParamKey> = self
                .pending
                .iter()
                .filter(|(key, pending)| {
                    request.covers(key)
                        && read_back_answers(pending, outstanding.requested_at_ms)
                        && confirmable_by_absence(&request, key, &pending.value)
                })
                .map(|(key, _)| key.clone())
                .collect();
            for key in absent_sends {
                let Some(pending) = self.pending.remove(&key) else {
                    continue;
                };
                self.confirmed_total = self.confirmed_total.saturating_add(1);
                // Applied like a confirming reply (see `ingest`).
                self.queued.push(ConsoleUpdate {
                    key,
                    value: pending.value,
                    adjusted: false,
                    confirms_send: true,
                    during_load: self.load_in_progress,
                });
            }
        }

        let expired_keys: Vec<ParamKey> = self
            .pending
            .iter()
            .filter(|(_, pending)| now_ms.saturating_sub(pending.sent_at_ms) >= CONFIRM_TIMEOUT_MS)
            .map(|(key, _)| key.clone())
            .collect();
        for key in expired_keys {
            if let Some(pending) = self.pending.remove(&key) {
                self.unconfirmed_total = self.unconfirmed_total.saturating_add(1);
                let description = pending.key.describe();
                if !self.unconfirmed_addresses.contains(&description) {
                    if self.unconfirmed_addresses.len() >= MAX_UNCONFIRMED_ADDRESSES {
                        self.unconfirmed_addresses.remove(0);
                    }
                    self.unconfirmed_addresses.push(description);
                }
                self.expired.push(pending);
            }
        }

        self.outstanding.retain(|_, outstanding| {
            now_ms.saturating_sub(outstanding.requested_at_ms) < CONFIRM_TIMEOUT_MS
        });
    }

    /// Whether a flush has anything to write or report: queued changes,
    /// expired sends, a lost connection or a snapshot slot that changed.
    pub fn has_activity(&self) -> bool {
        !self.queued.is_empty()
            || !self.expired.is_empty()
            || self.connection_lost
            || self.snapshot_slots_changed
    }

    /// One `/snapshot/load/N` report. Slots outside 1 to 8 and values
    /// TotalMix does not send are ignored and do not count as reports.
    fn note_snapshot_report(&mut self, slot: usize, value: f64) {
        if !(1..=SNAPSHOT_SLOTS).contains(&slot) {
            return;
        }
        let Some(state) = SnapshotSlotState::from_report(value) else {
            return;
        };
        self.snapshot_report_seq = self.snapshot_report_seq.saturating_add(1);
        self.snapshot_slot_seqs[slot - 1] = self.snapshot_report_seq;
        if self.snapshot_slots[slot - 1] != state {
            self.snapshot_slots[slot - 1] = state;
            self.snapshot_slots_changed = true;
        }
    }

    /// Keeps the device's name TotalMix gives on `/status/device`, and returns
    /// the line for `engine.log` the first time the link hears it and
    /// whenever it changes. The names file is found by it, so the line names
    /// that file too.
    fn note_device(&mut self, device: &str) -> Option<String> {
        if self.device.as_deref() == Some(device) {
            return None;
        }
        let file = crate::rme_totalmix_names::settings_file_name(device)
            .map(|name| format!("its names file is {name}"))
            .unwrap_or_else(|| String::from("no names file is named after it"));
        Some(match self.device.replace(device.to_string()) {
            None => format!("TotalMix's device: {device:?} ({file})."),
            Some(before) => {
                format!("TotalMix's device is now {device:?}, was {before:?} ({file}).")
            }
        })
    }

    pub fn forget_snapshot_slots(&mut self) {
        if self
            .snapshot_slots
            .iter()
            .any(|state| *state != SnapshotSlotState::Unknown)
        {
            self.snapshot_slots = [SnapshotSlotState::Unknown; SNAPSHOT_SLOTS];
            self.snapshot_slots_changed = true;
        }
    }

    /// The desk loaded `slot` (1 to 8) without saying so, or the simulated
    /// console loaded it: that slot is active and every other slot the desk
    /// has reported is off. It is not a report, so the report count stays.
    // This and the two readers below serve the load at the operator's second
    // press (`audio/load.rs`).
    pub fn mark_snapshot_loaded(&mut self, slot: usize) {
        if !(1..=SNAPSHOT_SLOTS).contains(&slot) {
            return;
        }
        for (index, state) in self.snapshot_slots.iter_mut().enumerate() {
            if index + 1 == slot {
                *state = SnapshotSlotState::Active;
            } else if *state != SnapshotSlotState::Unknown {
                *state = SnapshotSlotState::Off;
            }
        }
        self.snapshot_slots_changed = true;
    }

    /// How many valid slot reports the desk has made: read it before sending,
    /// then wait for a slot whose report count is higher.
    pub fn snapshot_report_seq(&self) -> u64 {
        self.snapshot_report_seq
    }

    /// The state of `slot` (1 to 8) and the report count of its last report
    /// (0 when the desk never reported it); `None` outside 1 to 8.
    pub fn snapshot_slot(&self, slot: usize) -> Option<(SnapshotSlotState, u64)> {
        if !(1..=SNAPSHOT_SLOTS).contains(&slot) {
            return None;
        }
        Some((
            self.snapshot_slots[slot - 1],
            self.snapshot_slot_seqs[slot - 1],
        ))
    }

    /// Marks the time a load in TotalMix is under way, so what the desk
    /// reports meanwhile is taken as the load's (`ConsoleUpdate::during_load`).
    pub fn set_load_in_progress(&mut self, on: bool) {
        self.load_in_progress = on;
    }

    /// Takes the mark that a slot's state changed, for the flush that reports
    /// it (the Console reads the slots again).
    pub fn take_snapshot_slots_changed(&mut self) -> bool {
        std::mem::take(&mut self.snapshot_slots_changed)
    }

    pub fn take_queued(&mut self) -> Vec<ConsoleUpdate> {
        std::mem::take(&mut self.queued)
    }

    pub fn take_expired(&mut self) -> Vec<PendingSend> {
        std::mem::take(&mut self.expired)
    }

    pub fn take_connection_lost(&mut self) -> bool {
        std::mem::take(&mut self.connection_lost)
    }

    /// A flush whose write failed has dropped what it took, so the app may
    /// hold an older value than the desk: the next flush that writes marks
    /// the desk unread (the Console asks for a Sync). With nothing else
    /// waiting it is tried at most every `LOST_REPORTS_RETRY_MS`.
    pub fn mark_reports_lost(&mut self, now_ms: u64) {
        self.reports_lost = true;
        self.reports_lost_retry_at_ms = now_ms.saturating_add(LOST_REPORTS_RETRY_MS);
    }

    /// [`Self::has_activity`], or a lost-reports mark whose retry time has come.
    pub fn has_activity_at(&self, now_ms: u64) -> bool {
        self.has_activity() || (self.reports_lost && now_ms >= self.reports_lost_retry_at_ms)
    }

    /// Takes the lost-reports mark, for the flush that writes it. Any flush
    /// that has something to write takes it, so a Sync's or a recall's own
    /// flushes write it before their `aligned`.
    pub fn take_reports_lost(&mut self) -> bool {
        std::mem::take(&mut self.reports_lost)
    }

    /// Forgets the unconfirmed history, e.g. after a complete console pull has
    /// re-established the truth.
    pub fn reset_unconfirmed(&mut self) {
        self.unconfirmed_total = 0;
        self.unconfirmed_addresses.clear();
    }

    #[cfg(test)]
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    /// Console changes waiting for the next flush.
    #[cfg(test)]
    pub fn queued_count(&self) -> usize {
        self.queued.len()
    }

    /// Read-backs still waiting for their replies to go quiet.
    #[cfg(test)]
    pub fn outstanding_count(&self) -> usize {
        self.outstanding.len()
    }

    /// Whether the app has sent this parameter and the desk has not yet
    /// confirmed, adjusted or failed to confirm it.
    pub fn has_pending(&self, key: &ParamKey) -> bool {
        self.pending.contains_key(key)
    }

    #[cfg(test)]
    pub fn connection(&self) -> ConsoleConnection {
        self.connection
    }

    /// `connected` / `disconnected` / `unknown`, for results and summaries.
    pub fn connection_label(&self) -> String {
        String::from(self.connection.as_str())
    }

    pub fn summary(&self, now_ms: u64) -> ConsoleLinkSummary {
        ConsoleLinkSummary {
            slot_bound: self.slot_bound,
            connection: self.connection,
            device: self.device.clone(),
            dsp_load: self.dsp_load,
            last_echo_age_ms: self.last_echo_at_ms.map(|last| now_ms.saturating_sub(last)),
            pending_sends: self.pending.len(),
            unconfirmed_sends: self.unconfirmed_total,
            unconfirmed_addresses: self.unconfirmed_addresses.clone(),
            confirmed_sends: self.confirmed_total,
            adjusted_sends: self.adjusted_total,
            external_changes: self.external_total,
            snapshot_slots: self.snapshot_slots,
        }
    }
}

/// Tests that drive the process-wide link (pull tests, the loopback read-back
/// test) hold this so they do not answer each other's read-backs.
#[cfg(test)]
pub(crate) static SHARED_LINK_TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
impl ConsoleLinkState {
    /// Forgets pending sends, queued updates, any pull and the snapshot
    /// slots, so a test starts from a quiet link regardless of what ran before
    /// it.
    pub fn reset_for_test(&mut self) {
        self.pending.clear();
        self.outstanding.clear();
        self.queued.clear();
        self.expired.clear();
        self.pull = None;
        self.connection_lost = false;
        self.reports_lost = false;
        self.snapshot_slots = [SnapshotSlotState::Unknown; SNAPSHOT_SLOTS];
        self.snapshot_slot_seqs = [0; SNAPSHOT_SLOTS];
        self.snapshot_report_seq = 0;
        self.snapshot_slots_changed = false;
        self.load_in_progress = false;
    }

    pub fn queue_for_test(&mut self, update: ConsoleUpdate) {
        self.queued.push(update);
    }
}

pub fn shared_console_link() -> Arc<Mutex<ConsoleLinkState>> {
    static SHARED: OnceLock<Arc<Mutex<ConsoleLinkState>>> = OnceLock::new();
    SHARED
        .get_or_init(|| Arc::new(Mutex::new(ConsoleLinkState::default())))
        .clone()
}

/// Milliseconds on a process-local monotonic clock, shared by every caller of
/// the link so timestamps compare.
pub fn link_now_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    let start = START.get_or_init(Instant::now);
    Instant::now().duration_since(*start).as_millis() as u64
}

/// Registers an outgoing command batch on the shared link. Called by the
/// senders right before the datagrams leave.
pub fn register_outgoing_commands(messages: &[(String, OscType)]) {
    if let Ok(mut link) = shared_console_link().lock() {
        link.register_outgoing(messages, link_now_ms());
    }
}

#[cfg(test)]
mod tests;
