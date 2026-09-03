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
const GAIN_MATCH_TOLERANCE_DB: f64 = 0.5;
const MAX_UNCONFIRMED_ADDRESSES: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ControlRoomFunction {
    Dim,
    MainMono,
    Talkback,
}

impl ControlRoomFunction {
    fn from_word(word: &str) -> Option<Self> {
        match word {
            "dim" => Some(Self::Dim),
            "mainmono" => Some(Self::MainMono),
            "talkback" => Some(Self::Talkback),
            _ => None,
        }
    }

    pub fn word(self) -> &'static str {
        match self {
            Self::Dim => "dim",
            Self::MainMono => "mainmono",
            Self::Talkback => "talkback",
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
            Self::StatusConnection
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
    pub active_snapshot: Option<usize>,
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
    device: Option<String>,
    dsp_load: Option<f64>,
    last_echo_at_ms: Option<u64>,
    active_snapshot: Option<usize>,
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
        }
    }

    fn note_key(&mut self, key: &ParamKey) {
        self.parsed_messages = self.parsed_messages.saturating_add(1);
        match key {
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Output,
                channel,
                ..
            }
            | ParamKey::OutputVolume { output: channel } => {
                if !self.outputs_seen.contains(channel) {
                    self.outputs_seen.push(*channel);
                }
            }
            ParamKey::ChannelFlag { bus, channel, .. } => {
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
            tracker.note_key(&parsed.key);
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
                self.connection = next;
                return Classification::Status;
            }
            (ParamKey::StatusDevice, ConsoleValue::Text(value)) => {
                self.device = Some(value.clone());
                return Classification::Status;
            }
            (ParamKey::StatusDsp, ConsoleValue::Number(value)) => {
                self.dsp_load = Some(*value);
                return Classification::Status;
            }
            (ParamKey::SnapshotLoad { number }, ConsoleValue::Number(value)) => {
                // 0 = off, 2 = active, 3 = active but changed.
                if *value >= 1.5 {
                    self.active_snapshot = Some(*number);
                } else if self.active_snapshot == Some(*number) {
                    self.active_snapshot = None;
                }
                return Classification::Status;
            }
            _ => {}
        }

        let pulling = self.pull.is_some();
        if let Some(pending) = self.pending.get(&parsed.key) {
            if values_match(&pending.value, &parsed.value) {
                self.pending.remove(&parsed.key);
                self.confirmed_total = self.confirmed_total.saturating_add(1);
                // During a pull the dump is the truth for everything it
                // lists, so a confirming value is applied as well (a no-op
                // when the app already holds it).
                if pulling {
                    self.queued.push(ConsoleUpdate {
                        key: parsed.key,
                        value: parsed.value,
                        adjusted: false,
                    });
                }
                return Classification::Confirmed;
            }
            let reply_is_stale = !pulling
                && match newest_request_at {
                    Some(requested_at) => pending.sent_at_ms > requested_at,
                    None => true,
                };
            if reply_is_stale {
                return Classification::Stale;
            }
            self.pending.remove(&parsed.key);
            self.adjusted_total = self.adjusted_total.saturating_add(1);
            self.queued.push(ConsoleUpdate {
                key: parsed.key,
                value: parsed.value,
                adjusted: true,
            });
            return Classification::Adjusted;
        }

        self.external_total = self.external_total.saturating_add(1);
        self.queued.push(ConsoleUpdate {
            key: parsed.key,
            value: parsed.value,
            adjusted: false,
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
            let absent_off_sends: Vec<ParamKey> = self
                .pending
                .iter()
                .filter(|(key, pending)| {
                    request.covers(key)
                        && pending.requested_at_ms == Some(outstanding.requested_at_ms)
                        && is_off_send(&pending.value)
                })
                .map(|(key, _)| key.clone())
                .collect();
            for key in absent_off_sends {
                self.pending.remove(&key);
                self.confirmed_total = self.confirmed_total.saturating_add(1);
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

    pub fn take_queued(&mut self) -> Vec<ConsoleUpdate> {
        std::mem::take(&mut self.queued)
    }

    pub fn take_expired(&mut self) -> Vec<PendingSend> {
        std::mem::take(&mut self.expired)
    }

    pub fn take_connection_lost(&mut self) -> bool {
        std::mem::take(&mut self.connection_lost)
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

    #[cfg(test)]
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
            active_snapshot: self.active_snapshot,
        }
    }
}

/// Tests that drive the process-wide link (pull tests, the loopback read-back
/// test) hold this so they do not answer each other's read-backs.
#[cfg(test)]
pub(crate) static SHARED_LINK_TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
impl ConsoleLinkState {
    /// Forgets pending sends, queued updates and any pull, so a test starts
    /// from a quiet link regardless of what ran before it.
    pub fn reset_for_test(&mut self) {
        self.pending.clear();
        self.outstanding.clear();
        self.queued.clear();
        self.expired.clear();
        self.pull = None;
        self.connection_lost = false;
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
mod tests {
    use super::*;

    fn msg(address: &str, value: OscType) -> OscMessage {
        OscMessage {
            addr: String::from(address),
            args: vec![value],
        }
    }

    fn f(value: f64) -> OscType {
        OscType::Float(value as f32)
    }

    #[test]
    fn parses_every_global_control_address_family() {
        let cases: Vec<(&str, OscType, ParamKey, ConsoleValue)> = vec![
            (
                "/input/8/mute",
                f(1.0),
                ParamKey::ChannelFlag {
                    bus: ConsoleBus::Input,
                    channel: 8,
                    flag: ChannelFlag::Mute,
                },
                ConsoleValue::Flag(true),
            ),
            (
                "/input/8/48v",
                OscType::Int(0),
                ParamKey::ChannelFlag {
                    bus: ConsoleBus::Input,
                    channel: 8,
                    flag: ChannelFlag::Phantom,
                },
                ConsoleValue::Flag(false),
            ),
            (
                "/input/9/phase",
                OscType::Bool(true),
                ParamKey::ChannelFlag {
                    bus: ConsoleBus::Input,
                    channel: 9,
                    flag: ChannelFlag::Phase,
                },
                ConsoleValue::Flag(true),
            ),
            (
                "/input/10/instrument",
                f(1.0),
                ParamKey::ChannelFlag {
                    bus: ConsoleBus::Input,
                    channel: 10,
                    flag: ChannelFlag::Instrument,
                },
                ConsoleValue::Flag(true),
            ),
            (
                "/input/11/autoset",
                f(0.0),
                ParamKey::ChannelFlag {
                    bus: ConsoleBus::Input,
                    channel: 11,
                    flag: ChannelFlag::AutoSet,
                },
                ConsoleValue::Flag(false),
            ),
            (
                "/input/8/gain",
                f(41.0),
                ParamKey::InputGain { channel: 8 },
                ConsoleValue::Db(41.0),
            ),
            (
                "/playback/6/mute",
                f(1.0),
                ParamKey::ChannelFlag {
                    bus: ConsoleBus::Playback,
                    channel: 6,
                    flag: ChannelFlag::Mute,
                },
                ConsoleValue::Flag(true),
            ),
            (
                "/output/8/mute",
                f(0.0),
                ParamKey::ChannelFlag {
                    bus: ConsoleBus::Output,
                    channel: 8,
                    flag: ChannelFlag::Mute,
                },
                ConsoleValue::Flag(false),
            ),
            (
                "/output/8/volume",
                f(-16.6),
                ParamKey::OutputVolume { output: 8 },
                ConsoleValue::Db(-16.600_000_381_469_727),
            ),
            (
                "/output/0/faderlin",
                f(0.5),
                ParamKey::OutputVolume { output: 0 },
                ConsoleValue::Position(0.5),
            ),
            (
                "/mix/pb/6/10/fader",
                f(-61.974_41),
                ParamKey::MixFader {
                    bus: ConsoleBus::Playback,
                    channel: 6,
                    output: 10,
                },
                ConsoleValue::Db(f64::from(-61.974_41_f32)),
            ),
            (
                "/mix/in/8/0/faderlin",
                f(0.25),
                ParamKey::MixFader {
                    bus: ConsoleBus::Input,
                    channel: 8,
                    output: 0,
                },
                ConsoleValue::Position(0.25),
            ),
            (
                "/mix/in/8/0/solo",
                f(1.0),
                ParamKey::MixSolo {
                    bus: ConsoleBus::Input,
                    channel: 8,
                    output: 0,
                },
                ConsoleValue::Flag(true),
            ),
            (
                "/controlroom/dim",
                f(1.0),
                ParamKey::ControlRoom(ControlRoomFunction::Dim),
                ConsoleValue::Flag(true),
            ),
            (
                "/controlroom/mainmono",
                f(0.0),
                ParamKey::ControlRoom(ControlRoomFunction::MainMono),
                ConsoleValue::Flag(false),
            ),
            (
                "/controlroom/talkback",
                f(1.0),
                ParamKey::ControlRoom(ControlRoomFunction::Talkback),
                ConsoleValue::Flag(true),
            ),
            (
                "/status/connection",
                f(1.0),
                ParamKey::StatusConnection,
                ConsoleValue::Number(1.0),
            ),
            (
                "/status/device",
                OscType::String(String::from("Fireface UFX III (1)")),
                ParamKey::StatusDevice,
                ConsoleValue::Text(String::from("Fireface UFX III (1)")),
            ),
            (
                "/status/dsp",
                f(8.0),
                ParamKey::StatusDsp,
                ConsoleValue::Number(8.0),
            ),
            (
                "/snapshot/load/3",
                f(2.0),
                ParamKey::SnapshotLoad { number: 3 },
                ConsoleValue::Number(2.0),
            ),
        ];
        for (address, value, key, expected) in cases {
            let parsed = parse_console_message(&msg(address, value))
                .unwrap_or_else(|| panic!("{address} should parse"));
            assert_eq!(parsed.key, key, "{address}");
            match (&parsed.value, &expected) {
                (ConsoleValue::Db(a), ConsoleValue::Db(b))
                | (ConsoleValue::Position(a), ConsoleValue::Position(b)) => {
                    assert!((a - b).abs() < 1e-4, "{address}: {a} vs {b}")
                }
                (a, b) => assert_eq!(a, b, "{address}"),
            }
        }

        for ignored in [
            "/level/in/8",
            "/level/out/0",
            "/input/8/eq/band1freq",
            "/input/8/dynamics/enable",
            "/input/8/name",
            "/output/8/talkbacksel",
            "/controlroom/dimreduction",
            "/mix/pb/6/10/balpan",
            "/sendall",
            "/durec/state",
        ] {
            assert!(
                parse_console_message(&msg(ignored, f(1.0))).is_none(),
                "{ignored} should be ignored"
            );
        }
        assert!(parse_console_message(&msg("/output/8/48v", f(1.0))).is_none());
        assert!(parse_console_message(&msg("/playback/6/phase", f(1.0))).is_none());
    }

    #[test]
    fn outgoing_commands_share_keys_with_their_readbacks() {
        let sent = parse_console_message(&msg("/mix/pb/6/10/faderlin", f(0.02))).unwrap();
        let reported = parse_console_message(&msg("/mix/pb/6/10/fader", f(-61.974))).unwrap();
        assert_eq!(sent.key, reported.key);
        assert!(values_match(&sent.value, &reported.value));
        assert_eq!(
            sent.key.readback(),
            Some(ReadbackRequest::Submix { output: 10 })
        );
        assert_eq!(
            ReadbackRequest::Submix { output: 10 }.osc(),
            vec![
                (String::from("/sendsubmix/10"), OscType::Float(2.0)),
                (String::from("/sendstate"), OscType::Float(1.0)),
            ]
        );
        assert_eq!(
            ReadbackRequest::Channel {
                bus: ConsoleBus::Input,
                channel: 8
            }
            .osc(),
            vec![(String::from("/sendchan/input/8"), OscType::Float(1.0))]
        );
        assert_eq!(
            ReadbackRequest::Settings.osc(),
            vec![(String::from("/sendsettings"), OscType::Float(1.0))]
        );
        assert_eq!(
            ParamKey::MixFader {
                bus: ConsoleBus::Playback,
                channel: 6,
                output: 10
            }
            .describe(),
            "mix pb 6 -> out 10 fader"
        );
    }

    #[test]
    fn readback_is_requested_once_the_send_settles() {
        let mut link = ConsoleLinkState::default();
        link.register_outgoing(
            &[
                (String::from("/input/8/mute"), f(1.0)),
                (String::from("/input/8/gain"), f(44.0)),
            ],
            0,
        );
        assert_eq!(link.pending_count(), 2);
        assert!(link.due_readbacks(50).is_empty(), "too early");
        let requests = link.due_readbacks(130);
        assert_eq!(
            requests,
            vec![(String::from("/sendchan/input/8"), OscType::Float(1.0))],
            "both parameters share one channel read-back"
        );
        assert!(link.due_readbacks(140).is_empty(), "requested only once");

        // A fresh send of the same parameter restarts the clock.
        link.register_outgoing(&[(String::from("/input/8/gain"), f(45.0))], 200);
        assert!(link.due_readbacks(250).is_empty());
        assert_eq!(link.due_readbacks(330).len(), 1);
    }

    #[test]
    fn readback_reply_within_tolerance_confirms_the_send() {
        let mut link = ConsoleLinkState::default();
        link.register_outgoing(
            &[
                (String::from("/input/8/mute"), f(1.0)),
                (String::from("/mix/pb/6/10/faderlin"), f(0.02)),
                (String::from("/output/0/faderlin"), f(0.5)),
            ],
            0,
        );
        link.due_readbacks(130);
        assert_eq!(
            link.ingest(&msg("/input/8/mute", f(1.0)), 160),
            Classification::Confirmed
        );
        assert_eq!(
            link.ingest(&msg("/mix/pb/6/10/fader", f(-61.974_41)), 160),
            Classification::Confirmed
        );
        // Output 0 at position 0.5 is -12.13 dB on the RME curve.
        assert_eq!(
            link.ingest(&msg("/output/0/volume", f(-12.13)), 160),
            Classification::Confirmed
        );
        assert_eq!(link.pending_count(), 0);
        let summary = link.summary(200);
        assert_eq!(summary.confirmed_sends, 3);
        assert_eq!(summary.unconfirmed_sends, 0);
        assert_eq!(summary.last_echo_age_ms, Some(40));
        assert!(link.take_queued().is_empty(), "confirmations queue nothing");
    }

    #[test]
    fn readback_reply_with_a_different_value_is_adjusted_and_queued() {
        let mut link = ConsoleLinkState::default();
        link.register_outgoing(&[(String::from("/input/8/gain"), f(41.0))], 0);
        link.due_readbacks(130);
        assert_eq!(
            link.ingest(&msg("/input/8/gain", f(44.0)), 160),
            Classification::Adjusted
        );
        assert_eq!(link.pending_count(), 0);
        let queued = link.take_queued();
        assert_eq!(
            queued,
            vec![ConsoleUpdate {
                key: ParamKey::InputGain { channel: 8 },
                value: ConsoleValue::Db(44.0),
                adjusted: true,
            }]
        );
        assert_eq!(link.summary(200).adjusted_sends, 1);
    }

    #[test]
    fn stale_reply_does_not_override_a_newer_send() {
        let mut link = ConsoleLinkState::default();
        link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.5))], 0);
        link.due_readbacks(130);
        // The operator keeps dragging before the first reply lands.
        link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.7))], 200);
        assert_eq!(
            link.ingest(&msg("/mix/pb/6/10/fader", f(-12.13)), 210),
            Classification::Stale
        );
        assert_eq!(link.pending_count(), 1, "the newer send stays pending");
        assert!(link.take_queued().is_empty());
        // The second read-back confirms the final position (-3.85 dB).
        assert_eq!(
            link.due_readbacks(330).len(),
            2,
            "submix read-back plus its /sendstate marker"
        );
        assert_eq!(
            link.ingest(&msg("/mix/pb/6/10/fader", f(-3.85)), 360),
            Classification::Confirmed
        );
        assert_eq!(link.pending_count(), 0);
    }

    #[test]
    fn unsolicited_message_is_an_external_change() {
        let mut link = ConsoleLinkState::default();
        assert_eq!(
            link.ingest(&msg("/controlroom/dim", f(1.0)), 10),
            Classification::External
        );
        assert_eq!(
            link.ingest(&msg("/level/in/8", f(-20.0)), 11),
            Classification::Ignored
        );
        let queued = link.take_queued();
        assert_eq!(queued.len(), 1);
        assert_eq!(
            queued[0].key,
            ParamKey::ControlRoom(ControlRoomFunction::Dim)
        );
        assert!(!queued[0].adjusted);
        assert_eq!(link.summary(20).external_changes, 1);
        assert_eq!(link.summary(20).last_echo_age_ms, Some(10));
    }

    #[test]
    fn off_send_is_confirmed_by_absence_once_the_submix_reply_finishes() {
        let mut link = ConsoleLinkState::default();
        link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.0))], 0);
        assert_eq!(
            link.due_readbacks(130),
            vec![
                (String::from("/sendsubmix/10"), OscType::Float(2.0)),
                (String::from("/sendstate"), OscType::Float(1.0)),
            ]
        );
        // The reply burst mentions another node on the same submix only.
        assert_eq!(
            link.ingest(&msg("/mix/pb/0/10/fader", f(-12.0)), 160),
            Classification::External
        );
        link.tick(200);
        assert_eq!(link.pending_count(), 1, "burst not quiet yet");
        link.tick(250);
        assert_eq!(link.pending_count(), 0, "absence confirms the off node");
        assert_eq!(link.summary(250).confirmed_sends, 1);
        assert_eq!(link.summary(250).unconfirmed_sends, 0);
    }

    #[test]
    fn off_send_on_an_empty_submix_is_confirmed_by_the_status_marker() {
        // Live-verified: `/sendsubmix 2` for a bus with no active nodes sends
        // nothing at all. Without the paired `/sendstate`, the first restore
        // to "off" on the studio console expired as unconfirmed (2026-09-03).
        let mut link = ConsoleLinkState::default();
        link.register_outgoing(&[(String::from("/mix/pb/6/10/faderlin"), f(0.0))], 0);
        assert_eq!(link.due_readbacks(130).len(), 2);
        // Only the status marker comes back.
        assert_eq!(
            link.ingest(&msg("/status/connection", f(1.0)), 160),
            Classification::Status
        );
        link.ingest(
            &msg("/status/device", OscType::String(String::from("UFX III"))),
            161,
        );
        link.ingest(&msg("/status/dsp", f(8.0)), 162);
        link.tick(200);
        assert_eq!(link.pending_count(), 1, "quiet window not reached yet");
        link.tick(250);
        assert_eq!(
            link.pending_count(),
            0,
            "empty burst + status confirms the off node"
        );
        let summary = link.summary(250);
        assert_eq!(summary.confirmed_sends, 1);
        assert_eq!(summary.unconfirmed_sends, 0);
    }

    #[test]
    fn non_off_send_absent_from_the_reply_expires_as_unconfirmed() {
        let mut link = ConsoleLinkState::default();
        link.register_outgoing(&[(String::from("/input/8/mute"), f(1.0))], 0);
        link.due_readbacks(130);
        link.tick(1_000);
        assert_eq!(link.pending_count(), 1);
        link.tick(1_600);
        assert_eq!(link.pending_count(), 0);
        let expired = link.take_expired();
        assert_eq!(expired.len(), 1);
        assert_eq!(
            expired[0].key,
            ParamKey::ChannelFlag {
                bus: ConsoleBus::Input,
                channel: 8,
                flag: ChannelFlag::Mute
            }
        );
        let summary = link.summary(1_600);
        assert_eq!(summary.unconfirmed_sends, 1);
        assert_eq!(
            summary.unconfirmed_addresses,
            vec![String::from("input 8 mute")]
        );
        link.reset_unconfirmed();
        assert_eq!(link.summary(1_700).unconfirmed_sends, 0);
    }

    #[test]
    fn pull_applies_every_dump_value_even_when_it_confirms_a_pending_send() {
        // Outside a pull a confirming reply is not re-applied (the app already
        // holds the value). During a pull the dump is authoritative, so it is
        // queued too — otherwise a value that happened to match an in-flight
        // send would never reach the database if the app's copy was stale.
        let mut link = ConsoleLinkState::default();
        link.register_outgoing(&[(String::from("/input/8/mute"), f(1.0))], 0);
        assert_eq!(
            link.ingest(&msg("/input/8/mute", f(1.0)), 50),
            Classification::Confirmed
        );
        assert!(
            link.take_queued().is_empty(),
            "no pull: confirmation queues nothing"
        );

        link.register_outgoing(&[(String::from("/input/8/mute"), f(1.0))], 100);
        link.register_outgoing(&[(String::from("/input/8/gain"), f(41.0))], 100);
        link.begin_pull(120);
        assert_eq!(
            link.ingest(&msg("/input/8/mute", f(1.0)), 150),
            Classification::Confirmed
        );
        // A different value during a pull is never "stale": the console wins.
        assert_eq!(
            link.ingest(&msg("/input/8/gain", f(33.0)), 151),
            Classification::Adjusted
        );
        let queued = link.take_queued();
        assert_eq!(queued.len(), 2);
        assert_eq!(queued[0].value, ConsoleValue::Flag(true));
        assert!(!queued[0].adjusted);
        assert_eq!(queued[1].value, ConsoleValue::Db(33.0));
        assert!(queued[1].adjusted);
        assert_eq!(link.pending_count(), 0);
    }

    #[test]
    fn pull_tracker_counts_the_dump_and_reports_quiet() {
        let mut link = ConsoleLinkState::default();
        assert!(link.pull_progress(0).is_none());
        link.begin_pull(100);
        let early = link.pull_progress(150).expect("pull in progress");
        assert_eq!(early.control_messages, 0);
        assert!(!early.is_complete(300), "nothing arrived yet");

        // The dump: status first, then parameters, including an EQ detail
        // message the app does not model (counts as traffic, not as parsed).
        link.ingest(&msg("/status/connection", f(1.0)), 160);
        link.ingest(&msg("/input/8/mute", f(0.0)), 170);
        link.ingest(&msg("/input/8/gain", f(41.0)), 171);
        link.ingest(&msg("/input/8/eq/band1freq", f(100.0)), 172);
        link.ingest(&msg("/output/8/volume", f(-16.6)), 180);
        link.ingest(&msg("/mix/in/8/8/fader", f(0.0)), 190);
        link.ingest(&msg("/mix/pb/2/0/fader", f(-6.0)), 191);
        link.ingest(&msg("/level/in/8", f(-20.0)), 400);

        let progress = link.pull_progress(420).expect("pull in progress");
        assert_eq!(progress.control_messages, 7, "levels are not dump traffic");
        assert_eq!(progress.parsed_messages, 6);
        assert!(progress.status_seen);
        assert_eq!(progress.channels_seen, vec![(ConsoleBus::Input, 8)]);
        assert_eq!(progress.outputs_seen, vec![8]);
        assert_eq!(
            progress.mix_nodes_seen,
            vec![(ConsoleBus::Input, 8, 8), (ConsoleBus::Playback, 2, 0)]
        );
        assert_eq!(progress.last_message_age_ms, Some(229));
        assert!(!progress.is_complete(300));
        assert!(link.pull_progress(500).unwrap().is_complete(300));

        let finished = link.finish_pull(500).expect("pull should finish");
        assert_eq!(finished.parsed_messages, 6);
        assert!(link.pull_progress(600).is_none());
        // Traffic after the pull is no longer counted against it.
        link.ingest(&msg("/input/9/mute", f(1.0)), 700);
        assert!(link.finish_pull(700).is_none());
    }

    #[test]
    fn status_messages_drive_the_link_state_only() {
        let mut link = ConsoleLinkState::default();
        assert_eq!(link.connection(), ConsoleConnection::Unknown);
        assert_eq!(
            link.ingest(&msg("/status/connection", f(1.0)), 5),
            Classification::Status
        );
        assert_eq!(link.connection(), ConsoleConnection::Connected);
        assert!(!link.take_connection_lost());
        link.ingest(
            &msg(
                "/status/device",
                OscType::String(String::from("Fireface UFX III (1)")),
            ),
            6,
        );
        link.ingest(&msg("/status/dsp", f(8.0)), 7);
        link.ingest(&msg("/snapshot/load/2", f(2.0)), 8);
        assert_eq!(
            link.ingest(&msg("/status/connection", f(0.0)), 9),
            Classification::Status
        );
        assert_eq!(link.connection(), ConsoleConnection::Disconnected);
        assert!(link.take_connection_lost());
        assert!(!link.take_connection_lost(), "flag is consumed once");
        let summary = link.summary(10);
        assert_eq!(summary.device.as_deref(), Some("Fireface UFX III (1)"));
        assert_eq!(summary.dsp_load, Some(8.0));
        assert_eq!(summary.active_snapshot, Some(2));
        assert!(link.take_queued().is_empty(), "status never queues state");
    }
}
