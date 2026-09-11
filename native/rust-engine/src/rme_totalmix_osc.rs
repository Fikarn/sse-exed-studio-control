use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::{
    read_audio_snapshot, AudioChannelSnapshot, AudioMixTargetSnapshot, AudioSnapshot,
};
use crate::diagnostics::append_log;
use crate::protocol::{event_message, EVENT_AUDIO_CHANGED};
use crate::storage::list_settings_by_prefix;
use rosc::{decoder, encoder, OscMessage, OscPacket, OscType};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::path::PathBuf;
use std::sync::{mpsc::Sender, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

// The command paths, split by remote generation (2026-09 production readiness,
// Slice 6): the classic page-2 EQ path on the first classic remote, and the
// Global OSC remote's absolute channel / output-mix commands. The metering
// paths of both generations stay here because they share the meter state.
mod classic_eq;
mod global_commands;

pub use classic_eq::send_totalmix_eq_update;
pub(crate) use global_commands::{
    global_channel_surface, global_channel_target, global_output_channel, global_output_mix_target,
};
pub use global_commands::{
    send_totalmix_channel_update, send_totalmix_mix_target_update, TotalMixSendReport,
};

pub const RME_TOTALMIX_OSC_SOURCE: &str = "rme-totalmix-osc";
pub const SIMULATED_AUDIO_SOURCE: &str = "simulated";

const LIVE_AFTER_PACKET_MS: u64 = 500;
const OFFLINE_AFTER_PACKET_MS: u64 = 2_000;
const PUBLISH_INTERVAL: Duration = Duration::from_millis(33);
const STATUS_PUBLISH_INTERVAL: Duration = Duration::from_millis(250);
const SETTINGS_REFRESH_INTERVAL: Duration = Duration::from_millis(500);
// TotalMix transmits OSC data only to remotes it considers active, and it
// deactivates a remote after send failures (e.g. while the engine was
// restarting) or inactivity. A remote's active bus is also client-driven
// state — every remote wakes up on the Input bus until the client selects
// another one, and TotalMix's own settings dialog cannot pin it. Each slot
// therefore needs a periodic nudge that both keeps the remote alive AND
// re-selects its commissioned bus and bank start, or all three slots end up
// metering the input bus.
const KEEPALIVE_INTERVAL: Duration = Duration::from_millis(1_000);
// Optional fourth remote (TotalMix FX 2.1+ "Global OSC" mode) on send/recv
// port offset +3, used purely for output-bus metering, which classic OSC
// never streams. The slot is inert until the operator commissions remote
// controller 4 in Global OSC mode; /sendall re-primes it when levels stop.
const GLOBAL_OSC_PORT_OFFSET: u16 = 3;
const GLOBAL_OSC_REFRESH_STALE: Duration = Duration::from_millis(3_000);
/// Lab override for the local address the metering receive ports bind (an IP
/// address). Unset, the ports bind loopback for a loopback console and every
/// interface for a console on another host (2026-09 production readiness,
/// Slice 6 — finding F05).
pub(crate) const OSC_BIND_HOST_ENV: &str = "SSE_OSC_BIND_HOST";
/// A datagram from a host other than the console is dropped and noted in the
/// engine log at most this often per source address.
const DROPPED_SOURCE_LOG_INTERVAL: Duration = Duration::from_secs(60);
/// Source addresses remembered for that rate limit; past this a flood of new
/// sources is dropped without further log lines until old entries expire.
const MAX_TRACKED_DROP_SOURCES: usize = 256;
const DEFAULT_POLL_INTERVAL_MS: u64 = 16;
const MIN_POLL_INTERVAL_MS: u64 = 5;
const MAX_POLL_INTERVAL_MS: u64 = 100;
const RECEIVE_BUFFER_BYTES: usize = 2048;
const AUDIO_METER_FLOOR_DBFS: f64 = -60.0;
const CONSOLE_METER_POINT_INPUT: &str = "input";
const CONSOLE_METER_POINT_PLAYBACK: &str = "playback";
const CONSOLE_METER_POINT_POST_FADER: &str = "post-fader";
const CONSOLE_PEAK_HOLD_MS: u64 = 1_500;
const CONSOLE_PEAK_FALL_DB_PER_SECOND: f64 = 20.0;
const CONSOLE_PEAK_WARNING_DBFS: f64 = -3.0;
const CONSOLE_OVER_DBFS: f64 = 0.0;

fn poll_interval_from_value(value: Option<&str>) -> Duration {
    let milliseconds = value
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_POLL_INTERVAL_MS)
        .clamp(MIN_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS);
    Duration::from_millis(milliseconds)
}

fn configured_poll_interval() -> Duration {
    poll_interval_from_value(std::env::var("SSE_AUDIO_METER_POLL_MS").ok().as_deref())
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum RmeTotalMixBus {
    Input,
    Playback,
    Output,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RmeMeterSide {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RmeMeteringState {
    Live,
    Stale,
    Offline,
}

impl RmeMeteringState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Stale => "stale",
            Self::Offline => "offline",
        }
    }
}

#[derive(Clone, Debug)]
pub struct RmeTotalMixMeterMessage {
    pub channel_index: usize,
    pub side: RmeMeterSide,
    pub normalized: f64,
    pub dbfs: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct RmeMeterPair {
    pub left: f64,
    pub right: f64,
    pub left_dbfs: f64,
    pub right_dbfs: f64,
}

impl Default for RmeMeterPair {
    fn default() -> Self {
        Self {
            left: 0.0,
            right: 0.0,
            left_dbfs: f64::NEG_INFINITY,
            right_dbfs: f64::NEG_INFINITY,
        }
    }
}

#[derive(Clone, Debug, Default)]
struct RmeConsoleMeterEntry {
    current: RmeMeterPair,
    peak_hold_dbfs: RmeMeterPair,
    hold_until_ms_left: u64,
    hold_until_ms_right: u64,
    clip_latch_left: bool,
    clip_latch_right: bool,
}

impl RmeConsoleMeterEntry {
    fn apply_side(&mut self, side: RmeMeterSide, normalized: f64, dbfs: f64, now_ms: u64) {
        let normalized = normalized.clamp(0.0, 1.0);
        match side {
            RmeMeterSide::Left => {
                self.current.left = normalized;
                self.current.left_dbfs = dbfs;
                if should_replace_peak_hold(
                    dbfs,
                    self.peak_hold_dbfs.left_dbfs,
                    now_ms,
                    self.hold_until_ms_left,
                ) {
                    self.peak_hold_dbfs.left = normalized;
                    self.peak_hold_dbfs.left_dbfs = dbfs;
                    self.hold_until_ms_left = now_ms.saturating_add(CONSOLE_PEAK_HOLD_MS);
                }
                if dbfs >= CONSOLE_OVER_DBFS {
                    self.clip_latch_left = true;
                }
            }
            RmeMeterSide::Right => {
                self.current.right = normalized;
                self.current.right_dbfs = dbfs;
                if should_replace_peak_hold(
                    dbfs,
                    self.peak_hold_dbfs.right_dbfs,
                    now_ms,
                    self.hold_until_ms_right,
                ) {
                    self.peak_hold_dbfs.right = normalized;
                    self.peak_hold_dbfs.right_dbfs = dbfs;
                    self.hold_until_ms_right = now_ms.saturating_add(CONSOLE_PEAK_HOLD_MS);
                }
                if dbfs >= CONSOLE_OVER_DBFS {
                    self.clip_latch_right = true;
                }
            }
        }
    }

    fn pair_at(&self, now_ms: u64) -> RmeMeterPair {
        let left_dbfs = held_peak_dbfs(
            self.peak_hold_dbfs.left_dbfs,
            self.current.left_dbfs,
            self.hold_until_ms_left,
            now_ms,
        );
        let right_dbfs = held_peak_dbfs(
            self.peak_hold_dbfs.right_dbfs,
            self.current.right_dbfs,
            self.hold_until_ms_right,
            now_ms,
        );
        RmeMeterPair {
            left: dbfs_to_normalized(left_dbfs),
            right: dbfs_to_normalized(right_dbfs),
            left_dbfs,
            right_dbfs,
        }
    }

    fn clip_hold(&self) -> bool {
        self.clip_latch_left || self.clip_latch_right
    }

    fn clear_clip_latch(&mut self) {
        self.clip_latch_left = false;
        self.clip_latch_right = false;
    }
}

fn should_replace_peak_hold(
    current_dbfs: f64,
    held_dbfs: f64,
    now_ms: u64,
    hold_until_ms: u64,
) -> bool {
    if !current_dbfs.is_finite() {
        return false;
    }
    if !held_dbfs.is_finite() {
        return true;
    }
    current_dbfs >= held_peak_dbfs(held_dbfs, current_dbfs, hold_until_ms, now_ms)
}

fn held_peak_dbfs(held_dbfs: f64, current_dbfs: f64, hold_until_ms: u64, now_ms: u64) -> f64 {
    if !held_dbfs.is_finite() {
        return current_dbfs;
    }
    if now_ms <= hold_until_ms {
        return held_dbfs.max(current_dbfs);
    }
    let elapsed_seconds = now_ms.saturating_sub(hold_until_ms) as f64 / 1000.0;
    (held_dbfs - elapsed_seconds * CONSOLE_PEAK_FALL_DB_PER_SECOND).max(current_dbfs)
}

#[derive(Clone, Debug, Default)]
pub struct RmeTotalMixDiagnostics {
    pub packet_count: u64,
    pub mapped_packet_count: u64,
    pub unknown_packet_count: u64,
    pub last_address: Option<String>,
    pub mapped_entry_count: usize,
}

// While Global OSC levels are flowing they own every meter surface; classic
// bank levels are suppressed because bank strip indexes shift with the
// TotalMix mixer layout and would fight the layout-proof hardware numbering.
const GLOBAL_LEVEL_AUTHORITY_MS: u64 = 2_000;

#[derive(Clone, Debug, Default)]
pub struct RmeTotalMixMeterState {
    entries: HashMap<String, RmeConsoleMeterEntry>,
    last_packet_at_ms: Option<u64>,
    last_global_level_at_ms: Option<u64>,
    diagnostics: RmeTotalMixDiagnostics,
}

impl RmeTotalMixMeterState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply_message(
        &mut self,
        bus: RmeTotalMixBus,
        message: &OscMessage,
        now_ms: u64,
    ) -> bool {
        self.diagnostics.packet_count = self.diagnostics.packet_count.saturating_add(1);
        self.diagnostics.last_address = Some(message.addr.clone());
        let Some(parsed) = parse_totalmix_meter_message(message) else {
            self.diagnostics.unknown_packet_count =
                self.diagnostics.unknown_packet_count.saturating_add(1);
            return false;
        };
        // Layout-proof Global OSC levels take authority over the classic
        // banked levels whenever they are flowing.
        if self
            .last_global_level_at_ms
            .map(|last| now_ms.saturating_sub(last) < GLOBAL_LEVEL_AUTHORITY_MS)
            .unwrap_or(false)
        {
            return false;
        }
        let Some(surface_id) = surface_id_for_meter(bus, parsed.channel_index) else {
            self.diagnostics.unknown_packet_count =
                self.diagnostics.unknown_packet_count.saturating_add(1);
            return false;
        };

        let entry = self.entries.entry(surface_id).or_default();
        entry.apply_side(parsed.side, parsed.normalized, parsed.dbfs, now_ms);
        self.last_packet_at_ms = Some(now_ms);
        self.diagnostics.mapped_packet_count =
            self.diagnostics.mapped_packet_count.saturating_add(1);
        self.diagnostics.mapped_entry_count = self.entries.len();
        true
    }

    /// Applies one Global OSC message (TotalMix FX 2.1+ "Global OSC" remote
    /// mode). `/level/{in|pb|out}/{ch}` peak-dB values are consumed on
    /// 0-based hardware channel numbering, which never shifts with the
    /// TotalMix mixer layout — so when this stream is live it is the meter
    /// authority for every surface, and it is the only source of output-bus
    /// levels (classic OSC never streams those at all).
    pub fn apply_global_message(&mut self, message: &OscMessage, now_ms: u64) -> bool {
        self.diagnostics.packet_count = self.diagnostics.packet_count.saturating_add(1);
        self.diagnostics.last_address = Some(message.addr.clone());
        let Some((bus, channel, dbfs)) = parse_global_level(message) else {
            self.diagnostics.unknown_packet_count =
                self.diagnostics.unknown_packet_count.saturating_add(1);
            return false;
        };
        let Some((surface_id, side)) = global_level_surface(bus, channel) else {
            self.diagnostics.unknown_packet_count =
                self.diagnostics.unknown_packet_count.saturating_add(1);
            return false;
        };

        let entry = self.entries.entry(surface_id).or_default();
        let normalized = dbfs_to_normalized(dbfs);
        match side {
            Some(side) => entry.apply_side(side, normalized, dbfs, now_ms),
            None => {
                entry.apply_side(RmeMeterSide::Left, normalized, dbfs, now_ms);
                entry.apply_side(RmeMeterSide::Right, normalized, dbfs, now_ms);
            }
        }
        self.last_packet_at_ms = Some(now_ms);
        self.last_global_level_at_ms = Some(now_ms);
        self.diagnostics.mapped_packet_count =
            self.diagnostics.mapped_packet_count.saturating_add(1);
        self.diagnostics.mapped_entry_count = self.entries.len();
        true
    }

    pub fn apply_packet(&mut self, bus: RmeTotalMixBus, packet: &OscPacket, now_ms: u64) -> bool {
        match packet {
            OscPacket::Message(message) => self.apply_message(bus, message, now_ms),
            OscPacket::Bundle(bundle) => {
                let mut mapped = false;
                for packet in &bundle.content {
                    mapped |= self.apply_packet(bus, packet, now_ms);
                }
                mapped
            }
        }
    }

    #[cfg(test)]
    fn entry_for_surface_id(&self, surface_id: &str) -> Option<RmeMeterPair> {
        self.entries.get(surface_id).map(|entry| entry.current)
    }

    pub fn last_packet_age_ms(&self, now_ms: u64) -> Option<u64> {
        self.last_packet_at_ms
            .map(|last_packet_at_ms| now_ms.saturating_sub(last_packet_at_ms))
    }

    pub fn status_at(&self, now_ms: u64) -> RmeMeteringState {
        match self.last_packet_age_ms(now_ms) {
            Some(age_ms) if age_ms <= LIVE_AFTER_PACKET_MS => RmeMeteringState::Live,
            Some(age_ms) if age_ms <= OFFLINE_AFTER_PACKET_MS => RmeMeteringState::Stale,
            _ => RmeMeteringState::Offline,
        }
    }

    pub fn diagnostics(&self) -> RmeTotalMixDiagnostics {
        self.diagnostics.clone()
    }

    pub fn clear_clip_latches(&mut self, channel_id: Option<&str>) {
        for (surface_id, entry) in &mut self.entries {
            if channel_id.map(|id| id == surface_id).unwrap_or(true) {
                entry.clear_clip_latch();
            }
        }
    }

    pub fn apply_to_snapshot(&self, snapshot: &mut AudioSnapshot, now_ms: u64) {
        let status = self.status_at(now_ms);
        snapshot.metering_source = RME_TOTALMIX_OSC_SOURCE.to_string();
        snapshot.metering_state = status.as_str().to_string();
        if status != RmeMeteringState::Live {
            clear_snapshot_meters(snapshot);
            return;
        }

        for channel in &mut snapshot.channels {
            if let Some(entry) = self.entries.get(&channel.id) {
                apply_pair_to_channel(
                    channel,
                    &entry.current,
                    &entry.pair_at(now_ms),
                    entry.clip_hold(),
                );
            } else {
                clear_channel_meter(channel);
            }
        }

        for mix_target in &mut snapshot.mix_targets {
            if let Some(entry) = self.entries.get(&mix_target.id) {
                apply_pair_to_mix_target(mix_target, &entry.current, &entry.pair_at(now_ms));
            } else {
                clear_mix_target_meter(mix_target);
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RmeTotalMixSlotConfig {
    pub bus: RmeTotalMixBus,
    pub send_port: u16,
    pub receive_port: u16,
}

pub fn slot_configs(
    send_port: i64,
    receive_port: i64,
) -> Result<Vec<RmeTotalMixSlotConfig>, String> {
    let send_base =
        u16::try_from(send_port).map_err(|_| String::from("sendPort is outside u16 range"))?;
    let receive_base = u16::try_from(receive_port)
        .map_err(|_| String::from("receivePort is outside u16 range"))?;
    if send_base > u16::MAX - 2 || receive_base > u16::MAX - 2 {
        return Err(String::from(
            "RME TotalMix three-slot metering requires sendPort and receivePort to leave room for +1 and +2 slots.",
        ));
    }

    Ok(vec![
        RmeTotalMixSlotConfig {
            bus: RmeTotalMixBus::Input,
            send_port: send_base,
            receive_port: receive_base,
        },
        RmeTotalMixSlotConfig {
            bus: RmeTotalMixBus::Playback,
            send_port: send_base + 1,
            receive_port: receive_base + 1,
        },
        RmeTotalMixSlotConfig {
            bus: RmeTotalMixBus::Output,
            send_port: send_base + 2,
            receive_port: receive_base + 2,
        },
    ])
}

/// Parses a Global OSC level message: `/level/{in|pb|out}/{ch}` with one
/// float argument carrying the peak level in dB (0-based hardware channel).
fn parse_global_level(message: &OscMessage) -> Option<(RmeTotalMixBus, usize, f64)> {
    let mut parts = message.addr.trim().strip_prefix('/')?.split('/');
    if parts.next()? != "level" {
        return None;
    }
    let bus = match parts.next()? {
        "in" => RmeTotalMixBus::Input,
        "pb" => RmeTotalMixBus::Playback,
        "out" => RmeTotalMixBus::Output,
        _ => return None,
    };
    let channel = parts.next()?.parse::<usize>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    let dbfs = numeric_arg(message.args.first()?)?;
    Some((bus, channel, dbfs))
}

/// Maps a 0-based hardware channel from the Global OSC namespace to the
/// app's fixed surfaces. Hardware numbering is layout independent — hiding
/// or reordering channels in the TotalMix mixer view never shifts it:
/// inputs 0..11 = channels 1-12 (mono strips feed both meter sides),
/// playback pairs 1/2..11/12 = channels 0/1..10/11, outputs AN 1/2 = Main
/// and PH 9/10 / 11/12 = Phones 1 / Phones 2.
fn global_level_surface(
    bus: RmeTotalMixBus,
    channel: usize,
) -> Option<(String, Option<RmeMeterSide>)> {
    match bus {
        RmeTotalMixBus::Input if channel < 12 => {
            // Mono input strips: one hardware channel drives both sides.
            Some((format!("audio-input-{}", channel + 1), None))
        }
        RmeTotalMixBus::Playback if channel < 12 => {
            let first = (channel / 2) * 2 + 1;
            let side = if channel.is_multiple_of(2) {
                RmeMeterSide::Left
            } else {
                RmeMeterSide::Right
            };
            Some((
                format!("audio-playback-{}-{}", first, first + 1),
                Some(side),
            ))
        }
        RmeTotalMixBus::Output => {
            let (surface, side) = match channel {
                0 => ("audio-mix-main", RmeMeterSide::Left),
                1 => ("audio-mix-main", RmeMeterSide::Right),
                8 => ("audio-mix-phones-a", RmeMeterSide::Left),
                9 => ("audio-mix-phones-a", RmeMeterSide::Right),
                10 => ("audio-mix-phones-b", RmeMeterSide::Left),
                11 => ("audio-mix-phones-b", RmeMeterSide::Right),
                _ => return None,
            };
            Some((String::from(surface), Some(side)))
        }
        _ => None,
    }
}

pub fn parse_totalmix_meter_message(message: &OscMessage) -> Option<RmeTotalMixMeterMessage> {
    let address = message.addr.trim();
    let mut parts = address.strip_prefix('/')?.split('/');
    let page = parts.next()?;
    if page != "1" && page != "2" {
        return None;
    }
    let name = parts.next()?;
    if parts.next().is_some() {
        return None;
    }

    let (name, is_display_value) = name
        .strip_suffix("Val")
        .map(|base| (base, true))
        .unwrap_or((name, false));
    let side = if let Some(base) = name.strip_suffix("Left") {
        (base, RmeMeterSide::Left)
    } else if let Some(base) = name.strip_suffix("Right") {
        (base, RmeMeterSide::Right)
    } else {
        return None;
    };
    let channel_index = side
        .0
        .strip_prefix("level")?
        .parse::<usize>()
        .ok()?
        .checked_sub(1)?;
    let raw_value = message.args.first()?;
    let (normalized, dbfs) = if is_display_value {
        let dbfs = parse_dbfs_arg(raw_value)?;
        (dbfs_to_normalized(dbfs), dbfs)
    } else {
        let normalized = numeric_arg(raw_value)?.clamp(0.0, 1.0);
        (normalized, normalized_to_dbfs(normalized))
    };

    Some(RmeTotalMixMeterMessage {
        channel_index,
        side: side.1,
        normalized,
        dbfs,
    })
}

fn send_osc_messages(
    send_host: &str,
    send_port: u16,
    messages: &[(String, OscType)],
) -> Result<usize, String> {
    if messages.is_empty() {
        return Ok(0);
    }
    #[cfg(test)]
    if test_guard_blocks_console_port(send_port) {
        eprintln!(
            "test guard: dropped {} TotalMix datagram(s) aimed at {}:{send_port}",
            messages.len(),
            send_host.trim()
        );
        return Ok(messages.len());
    }

    let socket = UdpSocket::bind(("0.0.0.0", 0))
        .map_err(|error| format!("TotalMix OSC send socket could not bind: {error}"))?;
    let target = format!("{}:{}", send_host.trim(), send_port);
    for (address, value) in messages {
        let packet = OscPacket::Message(OscMessage {
            addr: address.clone(),
            args: vec![value.clone()],
        });
        let bytes = encoder::encode(&packet).map_err(|error| {
            format!("TotalMix OSC message '{address}' could not encode: {error}")
        })?;
        socket
            .send_to(&bytes, &target)
            .map_err(|error| format!("TotalMix OSC message '{address}' could not send: {error}"))?;
    }

    Ok(messages.len())
}

/// Engine unit tests also run on the studio workstation, where TotalMix really
/// listens on 7001-7004 — and until 2026-09-03 `cargo test` wrote its fixture
/// values to the live desk (Host mic phase-inverted and in instrument mode,
/// preamp 12 with 48V, Main dimmed and mono, playback 1/2 soloed into Main).
/// Tests that want to observe datagrams bind a loopback receiver on an
/// ephemeral port; anything still aimed at a TotalMix remote port is dropped
/// unless the hardware lane opts in with `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1`.
#[cfg(test)]
fn test_guard_blocks_console_port(port: u16) -> bool {
    const TOTALMIX_REMOTE_PORTS: std::ops::RangeInclusive<u16> = 7001..=7010;
    let writes_allowed = std::env::var("SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES")
        .map(|value| value == "1")
        .unwrap_or(false);
    TOTALMIX_REMOTE_PORTS.contains(&port) && !writes_allowed
}

fn validated_command_port(send_port: i64, offset: u16) -> Result<u16, String> {
    let base =
        u16::try_from(send_port).map_err(|_| String::from("TotalMix OSC send port is invalid."))?;
    base.checked_add(offset)
        .ok_or_else(|| String::from("TotalMix OSC send port leaves no room for the +1/+2 slots."))
}

pub fn shared_meter_state() -> Arc<Mutex<RmeTotalMixMeterState>> {
    static SHARED: OnceLock<Arc<Mutex<RmeTotalMixMeterState>>> = OnceLock::new();
    SHARED
        .get_or_init(|| Arc::new(Mutex::new(RmeTotalMixMeterState::new())))
        .clone()
}

#[cfg(test)]
pub fn with_shared_meter_state_for_test<T>(
    callback: impl FnOnce(Arc<Mutex<RmeTotalMixMeterState>>) -> T,
) -> T {
    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("shared RME meter test lock should not be poisoned");
    let state = shared_meter_state();
    *state.lock().expect("shared meter state should lock") = RmeTotalMixMeterState::new();
    let result = callback(state.clone());
    *state.lock().expect("shared meter state should lock") = RmeTotalMixMeterState::new();
    result
}

pub fn clear_shared_clip_latches(channel_id: Option<&str>) {
    let state = shared_meter_state();
    if let Ok(mut state) = state.lock() {
        state.clear_clip_latches(channel_id);
    };
}

pub fn current_shared_status() -> RmeMeteringState {
    let state = shared_meter_state();
    let Ok(state) = state.lock() else {
        return RmeMeteringState::Offline;
    };
    let now_ms = monotonic_now_ms();
    state.status_at(now_ms)
}

pub fn wait_for_live_metering(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if current_shared_status() == RmeMeteringState::Live {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

pub fn spawn_rme_totalmix_audio_metering(
    sender: Sender<Value>,
    db_path: PathBuf,
    log_file_path: PathBuf,
) {
    let state = shared_meter_state();
    thread::spawn(move || {
        let poll_interval = configured_poll_interval();
        let bind_override =
            match parse_bind_override(std::env::var(OSC_BIND_HOST_ENV).ok().as_deref()) {
                Ok(value) => value,
                Err(message) => {
                    let _ = append_log(&log_file_path, "WARN", &message);
                    None
                }
            };
        let mut drops = DroppedSourceLog::new(Some(log_file_path.clone()));
        let metering_started_at = Instant::now();
        let mut sequence = 0_u64;
        let mut sockets = Vec::<BoundRmeSlot>::new();
        let mut global_slot: Option<GlobalOscSlot> = None;
        let mut bound_key: Option<(String, i64, i64)> = None;
        let mut last_settings_refresh_at: Option<Instant> = None;
        let mut cached_snapshot: Option<AudioSnapshot> = None;
        let mut last_snapshot_refresh_at: Option<Instant> = None;
        let mut last_publish_at: Option<Instant> = None;
        let mut last_status_publish_at: Option<Instant> = None;
        let mut last_keepalive_at: Option<Instant> = None;
        let mut last_link_flush_at: Option<Instant> = None;

        loop {
            let now = Instant::now();
            let should_refresh_settings = last_settings_refresh_at
                .map(|last| now.duration_since(last) >= SETTINGS_REFRESH_INTERVAL)
                .unwrap_or(true);
            if should_refresh_settings {
                let settings = match list_settings_by_prefix(&db_path, APP_SETTINGS_PREFIX) {
                    Ok(settings) => settings,
                    Err(error) => {
                        eprintln!("Failed to read audio settings for RME metering: {error}");
                        thread::sleep(Duration::from_millis(50));
                        continue;
                    }
                };
                let snapshot = read_audio_snapshot(&settings);
                let key = (
                    snapshot.send_host.clone(),
                    snapshot.send_port,
                    snapshot.receive_port,
                );
                if snapshot.metering_source == RME_TOTALMIX_OSC_SOURCE
                    && snapshot.osc_enabled
                    && bound_key.as_ref() != Some(&key)
                {
                    match resolve_console_address(&snapshot.send_host) {
                        Some(console) => {
                            let policy = ReceivePolicy::for_console(console, bind_override);
                            sockets = bind_slots(policy, snapshot.send_port, snapshot.receive_port);
                            global_slot =
                                bind_global_slot(policy, snapshot.send_port, snapshot.receive_port);
                        }
                        None => {
                            let _ = append_log(
                                &log_file_path,
                                "WARN",
                                &format!(
                                    "RME TotalMix metering is not listening: the TotalMix address {:?} does not resolve to an IP address (Setup, TotalMix address)",
                                    snapshot.send_host
                                ),
                            );
                            sockets = Vec::new();
                            global_slot = None;
                        }
                    }
                    mark_console_link_slot(global_slot.is_some());
                    bound_key = Some(key);
                    last_keepalive_at = None;
                } else if snapshot.metering_source != RME_TOTALMIX_OSC_SOURCE
                    || !snapshot.osc_enabled
                {
                    sockets.clear();
                    global_slot = None;
                    mark_console_link_slot(false);
                    bound_key = None;
                }
                cached_snapshot = Some(snapshot);
                last_settings_refresh_at = Some(now);
                last_snapshot_refresh_at = Some(now);
            } else if last_snapshot_refresh_at
                .map(|last| now.duration_since(last) >= SETTINGS_REFRESH_INTERVAL)
                .unwrap_or(true)
            {
                if let Ok(settings) = list_settings_by_prefix(&db_path, APP_SETTINGS_PREFIX) {
                    cached_snapshot = Some(read_audio_snapshot(&settings));
                    last_snapshot_refresh_at = Some(now);
                }
            }

            if !sockets.is_empty()
                && last_keepalive_at
                    .map(|last| now.duration_since(last) >= KEEPALIVE_INTERVAL)
                    .unwrap_or(true)
            {
                if let Some((send_host, _, _)) = bound_key.as_ref() {
                    send_slot_keepalives(&sockets, send_host);
                    if let Some(slot) = global_slot.as_ref() {
                        let stale = slot
                            .last_rx_at
                            .map(|last| now.duration_since(last) >= GLOBAL_OSC_REFRESH_STALE)
                            .unwrap_or(true);
                        if stale {
                            refresh_global_slot(slot, send_host);
                        }
                    }
                    last_keepalive_at = Some(now);
                }
            }

            let now_ms = monotonic_now_ms();
            read_available_packets(&sockets, state.clone(), now_ms, &mut drops);
            if let Some(slot) = global_slot.as_mut() {
                read_global_packets(slot, &state, now_ms, &mut drops);
                if let Some((send_host, _, _)) = bound_key.as_ref() {
                    service_console_link(slot, send_host);
                }
            }
            if last_link_flush_at
                .map(|last| now.duration_since(last) >= LINK_FLUSH_INTERVAL)
                .unwrap_or(true)
            {
                flush_console_link_to_db(&db_path);
                last_link_flush_at = Some(now);
            }

            let state_snapshot = state
                .lock()
                .map(|state| state.clone())
                .unwrap_or_else(|_| RmeTotalMixMeterState::new());
            let status = state_snapshot.status_at(now_ms);
            let publish_interval = if status == RmeMeteringState::Live {
                PUBLISH_INTERVAL
            } else {
                STATUS_PUBLISH_INTERVAL
            };
            let should_publish = last_publish_at
                .map(|last| now.duration_since(last) >= publish_interval)
                .unwrap_or(true)
                || (status != RmeMeteringState::Live
                    && last_status_publish_at
                        .map(|last| now.duration_since(last) >= STATUS_PUBLISH_INTERVAL)
                        .unwrap_or(true));

            if should_publish {
                if let Some(snapshot) = cached_snapshot.as_ref() {
                    let mut snapshot = snapshot.clone();
                    state_snapshot.apply_to_snapshot(&mut snapshot, now_ms);
                    sequence = sequence.saturating_add(1);
                    let payload = audio_meter_tick_payload(
                        &snapshot,
                        &state_snapshot,
                        sequence,
                        metering_started_at,
                        now_ms,
                    );
                    let event = event_message(EVENT_AUDIO_CHANGED, payload);
                    if sender.send(event).is_err() {
                        break;
                    }
                    last_publish_at = Some(now);
                    if status != RmeMeteringState::Live {
                        last_status_publish_at = Some(now);
                    }
                }
            }

            thread::sleep(poll_interval);
        }
    });
}

/// Where the metering thread listens, decided once per bind from the TotalMix
/// address the operator commissioned (2026-09 production readiness, Slice 6 —
/// finding F05). TotalMix on this workstation sends to the remote IP set in
/// Options › Settings › OSC, `127.0.0.1`, so a loopback console gets a
/// loopback bind and nothing on the studio LAN can reach receive ports
/// 9001–9004; a console on another host needs the wildcard bind. Either way
/// only datagrams from the console's own address are read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ReceivePolicy {
    /// The console's address: the one source whose datagrams are read.
    pub(crate) console: IpAddr,
    /// The local address every receive port binds.
    pub(crate) bind_host: IpAddr,
}

impl ReceivePolicy {
    pub(crate) fn for_console(console: IpAddr, bind_override: Option<IpAddr>) -> Self {
        let bind_host = match bind_override {
            Some(host) => host,
            None => match console {
                IpAddr::V4(address) if address.is_loopback() => IpAddr::V4(Ipv4Addr::LOCALHOST),
                IpAddr::V4(_) => IpAddr::V4(Ipv4Addr::UNSPECIFIED),
                IpAddr::V6(address) if address.is_loopback() => IpAddr::V6(Ipv6Addr::LOCALHOST),
                IpAddr::V6(_) => IpAddr::V6(Ipv6Addr::UNSPECIFIED),
            },
        };
        Self { console, bind_host }
    }
}

/// The commissioned TotalMix address (`sendHost`) as the address the receive
/// sockets expect datagrams from: `localhost` is the IPv4 loopback, a literal
/// address is itself, anything else goes through the resolver the send path
/// uses. `None` for an empty or unresolvable host.
pub(crate) fn resolve_console_address(send_host: &str) -> Option<IpAddr> {
    let host = send_host.trim();
    if host.is_empty() {
        return None;
    }
    if host.eq_ignore_ascii_case("localhost") {
        return Some(IpAddr::V4(Ipv4Addr::LOCALHOST));
    }
    if let Ok(address) = host.parse::<IpAddr>() {
        return Some(address);
    }
    (host, 0_u16)
        .to_socket_addrs()
        .ok()?
        .next()
        .map(|address| address.ip())
}

/// `SSE_OSC_BIND_HOST`: unset or empty → no override; an IP address → that
/// address; anything else is refused with the sentence the caller logs.
pub(crate) fn parse_bind_override(raw: Option<&str>) -> Result<Option<IpAddr>, String> {
    match raw.map(str::trim) {
        None | Some("") => Ok(None),
        Some(value) => value.parse::<IpAddr>().map(Some).map_err(|_| {
            format!(
                "{}={value:?} is not an IP address; the metering receive ports bind by the TotalMix address instead",
                OSC_BIND_HOST_ENV
            )
        }),
    }
}

/// Whether a datagram from `source` is read: only one from the console's own
/// address is (an IPv4 console seen through an IPv4-mapped IPv6 address is
/// still the console).
pub(crate) fn accept_source(source: SocketAddr, expected: IpAddr) -> bool {
    match (source.ip(), expected) {
        (IpAddr::V4(got), IpAddr::V4(want)) => got == want,
        (IpAddr::V6(got), IpAddr::V6(want)) => got == want,
        (IpAddr::V6(got), IpAddr::V4(want)) => got.to_ipv4_mapped() == Some(want),
        (IpAddr::V4(got), IpAddr::V6(want)) => want.to_ipv4_mapped() == Some(got),
    }
}

/// Dropped-datagram bookkeeping for the metering thread: a source that is not
/// the console is noted in the engine log (WARN) at most once a minute, keyed
/// by address, and the datagram is discarded. Written through `append_log`
/// until Slice 8 moves the module to `log_event`.
pub(crate) struct DroppedSourceLog {
    log_file_path: Option<PathBuf>,
    last_logged: HashMap<IpAddr, Instant>,
}

impl DroppedSourceLog {
    pub(crate) fn new(log_file_path: Option<PathBuf>) -> Self {
        Self {
            log_file_path,
            last_logged: HashMap::new(),
        }
    }

    fn record(&mut self, source: SocketAddr, expected: IpAddr, receive_port: u16) {
        self.record_at(source, expected, receive_port, Instant::now());
    }

    /// Returns whether a log line was due (and written when a log path is set).
    fn record_at(
        &mut self,
        source: SocketAddr,
        expected: IpAddr,
        receive_port: u16,
        now: Instant,
    ) -> bool {
        if !self.due(source.ip(), now) {
            return false;
        }
        if let Some(path) = self.log_file_path.as_deref() {
            let _ = append_log(
                path,
                "WARN",
                &format!(
                    "RME TotalMix OSC datagram from {source} dropped on receive port {receive_port}: only the TotalMix address {expected} is read; further drops from this source are noted once a minute"
                ),
            );
        }
        true
    }

    /// The rate limit on its own: true when `source` is due for a line now.
    fn due(&mut self, source: IpAddr, now: Instant) -> bool {
        if let Some(last) = self.last_logged.get(&source) {
            if now.duration_since(*last) < DROPPED_SOURCE_LOG_INTERVAL {
                return false;
            }
        } else if self.last_logged.len() >= MAX_TRACKED_DROP_SOURCES {
            self.last_logged
                .retain(|_, last| now.duration_since(*last) < DROPPED_SOURCE_LOG_INTERVAL);
            if self.last_logged.len() >= MAX_TRACKED_DROP_SOURCES {
                return false;
            }
        }
        self.last_logged.insert(source, now);
        true
    }
}

/// One non-blocking receive socket on the policy's bind host.
fn bind_receive_socket(bind_host: IpAddr, port: u16) -> std::io::Result<UdpSocket> {
    let socket = UdpSocket::bind((bind_host, port))?;
    socket.set_nonblocking(true)?;
    Ok(socket)
}

fn local_port_of(socket: &UdpSocket) -> u16 {
    socket
        .local_addr()
        .map(|address| address.port())
        .unwrap_or(0)
}

fn bind_slots(policy: ReceivePolicy, send_port: i64, receive_port: i64) -> Vec<BoundRmeSlot> {
    let Ok(slots) = slot_configs(send_port, receive_port) else {
        return Vec::new();
    };
    slots
        .into_iter()
        .filter_map(|slot| {
            let socket = bind_receive_socket(policy.bind_host, slot.receive_port)
                .map_err(|error| {
                    eprintln!(
                        "RME TotalMix metering could not bind receive port {} on {}: {}",
                        slot.receive_port, policy.bind_host, error
                    );
                    error
                })
                .ok()?;
            Some(BoundRmeSlot {
                bus: slot.bus,
                send_port: slot.send_port,
                socket,
                console: policy.console,
            })
        })
        .collect()
}

fn bus_select_address(bus: RmeTotalMixBus) -> &'static str {
    match bus {
        RmeTotalMixBus::Input => "/1/busInput",
        RmeTotalMixBus::Playback => "/1/busPlayback",
        RmeTotalMixBus::Output => "/1/busOutput",
    }
}

/// Best-effort per-slot nudge: keeps every commissioned TotalMix remote
/// active AND pinned to its commissioned bus with the bank parked at the
/// first strip. Sent from each slot's own receive socket, so TotalMix sees
/// traffic from the same peer it meters to. Errors are ignored — the next
/// tick retries.
fn send_slot_keepalives(slots: &[BoundRmeSlot], send_host: &str) {
    let host = send_host.trim();
    if host.is_empty() {
        return;
    }
    for slot in slots {
        let messages = [
            (bus_select_address(slot.bus), OscType::Float(1.0)),
            ("/setBankStart", OscType::Int(0)),
        ];
        for (address, value) in messages {
            let Ok(bytes) = encoder::encode(&OscPacket::Message(OscMessage {
                addr: String::from(address),
                args: vec![value],
            })) else {
                continue;
            };
            let _ = slot.socket.send_to(&bytes, (host, slot.send_port));
        }
    }
}

fn read_available_packets(
    sockets: &[BoundRmeSlot],
    state: Arc<Mutex<RmeTotalMixMeterState>>,
    now_ms: u64,
    drops: &mut DroppedSourceLog,
) {
    let mut buffer = [0_u8; RECEIVE_BUFFER_BYTES];
    for slot in sockets {
        loop {
            match slot.socket.recv_from(&mut buffer) {
                Ok((len, source)) => {
                    if !accept_source(source, slot.console) {
                        drops.record(source, slot.console, local_port_of(&slot.socket));
                        continue;
                    }
                    match decoder::decode_udp(&buffer[..len]) {
                        Ok((_remainder, packet)) => {
                            if let Ok(mut state) = state.lock() {
                                state.apply_packet(slot.bus, &packet, now_ms);
                            }
                        }
                        Err(error) => eprintln!("RME TotalMix OSC decode failed: {error}"),
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                // Windows surfaces a keepalive sent to a TotalMix remote that is
                // not listening as ConnectionReset (10054) on the next receive.
                // A disabled classic slot is a normal state, not an error.
                Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => break,
                Err(error) => {
                    eprintln!("RME TotalMix OSC receive failed: {error}");
                    break;
                }
            }
        }
    }
}

struct BoundRmeSlot {
    bus: RmeTotalMixBus,
    send_port: u16,
    socket: UdpSocket,
    /// The console's address: the one source this slot reads.
    console: IpAddr,
}

pub(crate) struct GlobalOscSlot {
    send_port: u16,
    socket: UdpSocket,
    last_rx_at: Option<Instant>,
    /// The console's address: the one source this slot reads.
    console: IpAddr,
}

fn bind_global_slot(
    policy: ReceivePolicy,
    send_port: i64,
    receive_port: i64,
) -> Option<GlobalOscSlot> {
    let send = u16::try_from(send_port)
        .ok()?
        .checked_add(GLOBAL_OSC_PORT_OFFSET)?;
    let recv = u16::try_from(receive_port)
        .ok()?
        .checked_add(GLOBAL_OSC_PORT_OFFSET)?;
    let socket = bind_receive_socket(policy.bind_host, recv).ok()?;
    Some(GlobalOscSlot {
        send_port: send,
        socket,
        last_rx_at: None,
        console: policy.console,
    })
}

pub(crate) fn read_global_packets(
    slot: &mut GlobalOscSlot,
    state: &Arc<Mutex<RmeTotalMixMeterState>>,
    now_ms: u64,
    drops: &mut DroppedSourceLog,
) {
    let mut buffer = [0_u8; RECEIVE_BUFFER_BYTES];
    loop {
        match slot.socket.recv_from(&mut buffer) {
            Ok((len, source)) => {
                if !accept_source(source, slot.console) {
                    drops.record(source, slot.console, local_port_of(&slot.socket));
                    continue;
                }
                slot.last_rx_at = Some(Instant::now());
                if let Ok((_remainder, packet)) = decoder::decode_udp(&buffer[..len]) {
                    route_global_packet(&packet, state, now_ms);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(_) => break,
        }
    }
}

/// Global OSC traffic splits two ways: `/level/*` feeds the meter state,
/// everything else (control parameters, `/status/*`, snapshot flags) feeds the
/// console link, which decides whether it confirms one of the app's own sends
/// or is a change to apply.
fn route_global_packet(packet: &OscPacket, state: &Arc<Mutex<RmeTotalMixMeterState>>, now_ms: u64) {
    match packet {
        OscPacket::Message(message) => {
            if message.addr.starts_with("/level/") {
                if let Ok(mut state) = state.lock() {
                    state.apply_global_message(message, now_ms);
                }
            } else if let Ok(mut link) = crate::rme_console_link::shared_console_link().lock() {
                link.ingest(message, crate::rme_console_link::link_now_ms());
            }
        }
        OscPacket::Bundle(bundle) => {
            for inner in &bundle.content {
                route_global_packet(inner, state, now_ms);
            }
        }
    }
}

const LINK_FLUSH_INTERVAL: Duration =
    Duration::from_millis(crate::rme_console_link::FLUSH_INTERVAL_MS);

pub(crate) fn mark_console_link_slot(bound: bool) {
    if let Ok(mut link) = crate::rme_console_link::shared_console_link().lock() {
        link.slot_bound = bound;
    }
}

/// Advances the console link's clocks and sends the read-backs that are due
/// (`/sendchan/…`, `/sendsubmix/…`, `/sendsettings`) over the Global slot.
pub(crate) fn service_console_link(slot: &GlobalOscSlot, send_host: &str) {
    let now_ms = crate::rme_console_link::link_now_ms();
    let requests = match crate::rme_console_link::shared_console_link().lock() {
        Ok(mut link) => {
            link.slot_bound = true;
            link.tick(now_ms);
            link.due_readbacks(now_ms)
        }
        Err(_) => Vec::new(),
    };
    let host = send_host.trim();
    if host.is_empty() {
        return;
    }
    for (address, value) in requests {
        let Ok(bytes) = encoder::encode(&OscPacket::Message(OscMessage {
            addr: address,
            args: vec![value],
        })) else {
            continue;
        };
        let _ = slot.socket.send_to(&bytes, (host, slot.send_port));
    }
}

/// Persists whatever the console link produced since the last flush and tells
/// every consumer through `audio.changed { reason: "console-echo" }`.
pub(crate) fn flush_console_link_to_db(db_path: &std::path::Path) {
    match crate::audio::flush_console_link(db_path) {
        Ok(report) if report.changed() => {
            crate::engine_events::emit_audio_changed_with(serde_json::json!({
                "reason": "console-echo",
                "applied": report.applied,
                "unconfirmed": report.unconfirmed,
                "connectionLost": report.connection_lost,
            }));
        }
        Ok(_) => {}
        Err(error) => {
            eprintln!("Console link flush failed: {error:?}");
        }
    }
}

/// Re-primes the Global OSC remote when its level stream is silent. TotalMix
/// only transmits deltas, so a fresh engine (or a static console) needs a
/// `/sendall` to start receiving values; the send also doubles as the
/// activity nudge that keeps the remote alive.
fn refresh_global_slot(slot: &GlobalOscSlot, send_host: &str) {
    let host = send_host.trim();
    if host.is_empty() {
        return;
    }
    for (address, value) in console_pull_messages() {
        let Ok(bytes) = encoder::encode(&OscPacket::Message(OscMessage {
            addr: address,
            args: vec![value],
        })) else {
            continue;
        };
        let _ = slot.socket.send_to(&bytes, (host, slot.send_port));
    }
}

/// `/sendall 2` (every parameter; mix nodes only above -65 dB) followed by
/// `/sendstate` (status incl. `/status/connection`): the console pull.
pub(crate) fn console_pull_messages() -> Vec<(String, OscType)> {
    vec![
        (String::from("/sendall"), OscType::Float(2.0)),
        (String::from("/sendstate"), OscType::Float(1.0)),
    ]
}

/// Asks TotalMix for a full dump over the Global OSC remote (`send_port + 3`).
/// The replies land on the metering thread's slot socket and flow through the
/// console link; `audio::sync` waits for the burst to go quiet.
pub(crate) fn send_console_pull_request(send_host: &str, send_port: i64) -> Result<usize, String> {
    let port = validated_command_port(send_port, GLOBAL_OSC_PORT_OFFSET)?;
    send_osc_messages(send_host, port, &console_pull_messages())
}

/// Messages per burst and the pause between bursts when pushing a snapshot.
/// A full recall is ~60 datagrams; TotalMix's own status cadence is slow, so
/// the pacing keeps the desk's receive queue shallow.
const RECALL_BURST_SIZE: usize = 48;
const RECALL_BURST_PAUSE: Duration = Duration::from_millis(10);

/// Pushes a snapshot to TotalMix phase by phase (mutes on, values, mutes off,
/// control room), registering every command on the console link so its
/// read-back can confirm it. Returns the number of datagrams sent.
pub(crate) fn send_totalmix_recall_plan(
    send_host: &str,
    send_port: i64,
    phases: &[Vec<(String, OscType)>],
) -> Result<usize, String> {
    let port = validated_command_port(send_port, GLOBAL_OSC_PORT_OFFSET)?;
    let mut sent = 0usize;
    for phase in phases {
        for burst in phase.chunks(RECALL_BURST_SIZE) {
            sent += send_osc_messages(send_host, port, burst)?;
            crate::rme_console_link::register_outgoing_commands(burst);
            thread::sleep(RECALL_BURST_PAUSE);
        }
    }
    Ok(sent)
}

/// Test stand-in for the metering thread's per-tick console-link work: read
/// the slot, service read-backs, flush to the database.
#[cfg(test)]
pub(crate) fn pump_global_slot_for_test(
    slot: &mut GlobalOscSlot,
    send_host: &str,
    db_path: &std::path::Path,
) {
    let state = shared_meter_state();
    let mut drops = DroppedSourceLog::new(None);
    read_global_packets(slot, &state, monotonic_now_ms(), &mut drops);
    service_console_link(slot, send_host);
    flush_console_link_to_db(db_path);
}

/// A Global OSC slot on an ephemeral loopback port whose read-backs go to
/// `send_port` (a fake console in tests).
#[cfg(test)]
pub(crate) fn bind_test_global_slot(send_port: u16) -> GlobalOscSlot {
    let console = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let socket = bind_receive_socket(console, 0).expect("test global slot should bind");
    GlobalOscSlot {
        send_port,
        socket,
        last_rx_at: None,
        console,
    }
}

#[cfg(test)]
impl GlobalOscSlot {
    pub(crate) fn local_port(&self) -> u16 {
        self.socket.local_addr().expect("slot address").port()
    }
}

/// The real Global OSC slot (`send_port`, `receive_port` already +3) for the
/// hardware-lane pull test, bound by the engine's own rule: the studio
/// TotalMix is at 127.0.0.1, so the slot binds loopback and reads loopback
/// only, unless `SSE_OSC_BIND_HOST` names another local address.
#[cfg(test)]
pub(crate) fn bind_live_global_slot_for_test(
    send_port: u16,
    receive_port: u16,
) -> Option<GlobalOscSlot> {
    let bind_override =
        parse_bind_override(std::env::var(OSC_BIND_HOST_ENV).ok().as_deref()).unwrap_or(None);
    let policy = ReceivePolicy::for_console(IpAddr::V4(Ipv4Addr::LOCALHOST), bind_override);
    let socket = bind_receive_socket(policy.bind_host, receive_port).ok()?;
    Some(GlobalOscSlot {
        send_port,
        socket,
        last_rx_at: None,
        console: policy.console,
    })
}

// TotalMix OSC banks index the *visible mixer layout*, not hardware channel
// numbers — hidden channels are skipped and the control-room strips sit at
// the end of the output row. The fixed studio workstation runs the
// commissioned "tidied" TotalMix layout (docs/OPERATIONS.md):
//
//   inputs   strip 1..4  = front preamps 9..12 (line inputs 1-8 hidden)
//   playback strip 1..4  = pairs 1/2, 3/4, 5/6, 7/8 (pairs 9-12 hidden)
//   outputs  strip 1 = Main (AN 1/2), 2..4 = AN 3/4, 5/6, 7/8,
//            strip 5 = Phones 1, strip 6 = Phones 2
//
// The bank follows the hardware order of visible channels (verified via the
// remotes' `/1/trackname{N}` state dumps), NOT the mixer window's visual
// order — TotalMix draws the control-room strips at the right edge, but the
// OSC bank keeps Main first because Main is AN 1/2. If the operator changes
// the TotalMix channel layout, this table and the command map in
// `totalmix_strip_target` must be recommissioned together.
fn surface_id_for_meter(bus: RmeTotalMixBus, channel_index: usize) -> Option<String> {
    match bus {
        RmeTotalMixBus::Input if channel_index < 4 => {
            Some(format!("audio-input-{}", channel_index + 9))
        }
        RmeTotalMixBus::Playback if channel_index < 4 => {
            let first = channel_index * 2 + 1;
            Some(format!("audio-playback-{}-{}", first, first + 1))
        }
        RmeTotalMixBus::Output => match channel_index {
            0 => Some(String::from("audio-mix-main")),
            4 => Some(String::from("audio-mix-phones-a")),
            5 => Some(String::from("audio-mix-phones-b")),
            _ => None,
        },
        _ => None,
    }
}

fn numeric_arg(value: &OscType) -> Option<f64> {
    match value {
        OscType::Float(value) => Some(f64::from(*value)),
        OscType::Double(value) => Some(*value),
        OscType::Int(value) => Some(f64::from(*value)),
        OscType::Long(value) => Some(*value as f64),
        _ => None,
    }
}

fn parse_dbfs_arg(value: &OscType) -> Option<f64> {
    match value {
        OscType::String(value) => parse_dbfs_string(value),
        _ => numeric_arg(value),
    }
}

fn parse_dbfs_string(value: &str) -> Option<f64> {
    let normalized = value.trim().to_lowercase();
    if normalized == "-oo" || normalized == "-∞" || normalized == "-inf" {
        return Some(f64::NEG_INFINITY);
    }
    let without_unit = normalized
        .strip_suffix("dbfs")
        .or_else(|| normalized.strip_suffix("db"))
        .unwrap_or(normalized.as_str())
        .trim();
    without_unit.parse::<f64>().ok()
}

fn normalized_to_dbfs(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return f64::NEG_INFINITY;
    }
    20.0 * value.clamp(0.0, 1.0).log10()
}

fn dbfs_to_normalized(dbfs: f64) -> f64 {
    if !dbfs.is_finite() {
        return 0.0;
    }
    10.0_f64.powf(dbfs.clamp(AUDIO_METER_FLOOR_DBFS, 0.0) / 20.0)
}

fn clear_snapshot_meters(snapshot: &mut AudioSnapshot) {
    for channel in &mut snapshot.channels {
        clear_channel_meter(channel);
    }
    for mix_target in &mut snapshot.mix_targets {
        clear_mix_target_meter(mix_target);
    }
}

fn clear_channel_meter(channel: &mut AudioChannelSnapshot) {
    channel.meter_left = 0.0;
    channel.meter_right = 0.0;
    channel.meter_level = 0.0;
    channel.peak_hold = 0.0;
    channel.peak_hold_left = 0.0;
    channel.peak_hold_right = 0.0;
    channel.clip = false;
}

fn clear_mix_target_meter(mix_target: &mut AudioMixTargetSnapshot) {
    mix_target.meter_left = 0.0;
    mix_target.meter_right = 0.0;
    mix_target.meter_level = 0.0;
    mix_target.peak_hold = 0.0;
    mix_target.peak_hold_left = 0.0;
    mix_target.peak_hold_right = 0.0;
}

fn apply_pair_to_channel(
    channel: &mut AudioChannelSnapshot,
    pair: &RmeMeterPair,
    peak_hold_pair: &RmeMeterPair,
    clip_hold: bool,
) {
    channel.meter_left = pair.left;
    channel.meter_right = if channel.stereo {
        pair.right
    } else {
        pair.left.max(pair.right)
    };
    channel.meter_level = channel.meter_left.max(channel.meter_right);
    channel.peak_hold_left = peak_hold_pair.left.max(channel.meter_left);
    channel.peak_hold_right = if channel.stereo {
        peak_hold_pair.right.max(channel.meter_right)
    } else {
        peak_hold_pair
            .left
            .max(peak_hold_pair.right)
            .max(channel.meter_right)
    };
    channel.peak_hold = channel.meter_level;
    channel.peak_hold = channel
        .peak_hold
        .max(channel.peak_hold_left)
        .max(channel.peak_hold_right);
    channel.clip = clip_hold;
}

fn apply_pair_to_mix_target(
    mix_target: &mut AudioMixTargetSnapshot,
    pair: &RmeMeterPair,
    peak_hold_pair: &RmeMeterPair,
) {
    mix_target.meter_left = pair.left;
    mix_target.meter_right = pair.right;
    mix_target.meter_level = pair.left.max(pair.right);
    mix_target.peak_hold_left = peak_hold_pair.left.max(mix_target.meter_left);
    mix_target.peak_hold_right = peak_hold_pair.right.max(mix_target.meter_right);
    mix_target.peak_hold = mix_target
        .meter_level
        .max(mix_target.peak_hold_left)
        .max(mix_target.peak_hold_right);
}

fn meter_point_for_channel(channel: &AudioChannelSnapshot) -> &'static str {
    if channel.role == "playback-pair" {
        CONSOLE_METER_POINT_PLAYBACK
    } else {
        CONSOLE_METER_POINT_INPUT
    }
}

fn channel_meter_payload(channel: &AudioChannelSnapshot) -> Value {
    let peak_left = channel.peak_hold_left.max(channel.meter_left);
    let peak_right = channel.peak_hold_right.max(channel.meter_right);
    let level_left_dbfs = normalized_to_payload_dbfs(channel.meter_left);
    let level_right_dbfs = normalized_to_payload_dbfs(channel.meter_right);
    let over_left = level_left_dbfs >= CONSOLE_OVER_DBFS;
    let over_right = level_right_dbfs >= CONSOLE_OVER_DBFS;
    let meter_point_over = over_left || over_right;
    let peak_warning = level_left_dbfs >= CONSOLE_PEAK_WARNING_DBFS
        || level_right_dbfs >= CONSOLE_PEAK_WARNING_DBFS
        || channel.clip;

    json!({
        "channelPathClip": channel.clip,
        "channelPathClipHold": channel.clip,
        "id": channel.id,
        "meterPoint": meter_point_for_channel(channel),
        "meterLeft": channel.meter_left,
        "meterRight": channel.meter_right,
        "meterLevel": channel.meter_level,
        "peakHold": channel.peak_hold,
        "peakHoldLeft": channel.peak_hold_left,
        "peakHoldRight": channel.peak_hold_right,
        "levelLeftDbfs": level_left_dbfs,
        "levelRightDbfs": level_right_dbfs,
        "peakLeftDbfs": normalized_to_payload_dbfs(peak_left),
        "peakRightDbfs": normalized_to_payload_dbfs(peak_right),
        "rmsLeftDbfs": level_left_dbfs,
        "rmsRightDbfs": level_right_dbfs,
        "peakHoldLeftDbfs": normalized_to_payload_dbfs(channel.peak_hold_left),
        "peakHoldRightDbfs": normalized_to_payload_dbfs(channel.peak_hold_right),
        "peakWarning": peak_warning,
        "meterPointOver": meter_point_over,
        "meterPointOverLeft": over_left,
        "meterPointOverRight": over_right,
        "over": meter_point_over,
        "overLeft": over_left,
        "overRight": over_right,
        "clipHold": channel.clip,
        "clip": channel.clip,
    })
}

fn mix_target_meter_payload(mix_target: &AudioMixTargetSnapshot) -> Value {
    let peak_left = mix_target.peak_hold_left.max(mix_target.meter_left);
    let peak_right = mix_target.peak_hold_right.max(mix_target.meter_right);
    let level_left_dbfs = normalized_to_payload_dbfs(mix_target.meter_left);
    let level_right_dbfs = normalized_to_payload_dbfs(mix_target.meter_right);
    let over_left = level_left_dbfs >= CONSOLE_OVER_DBFS;
    let over_right = level_right_dbfs >= CONSOLE_OVER_DBFS;
    let meter_point_over = over_left || over_right;
    let peak_warning = level_left_dbfs >= CONSOLE_PEAK_WARNING_DBFS
        || level_right_dbfs >= CONSOLE_PEAK_WARNING_DBFS;

    json!({
        "channelPathClip": false,
        "channelPathClipHold": false,
        "id": mix_target.id,
        "meterPoint": CONSOLE_METER_POINT_POST_FADER,
        "meterLeft": mix_target.meter_left,
        "meterRight": mix_target.meter_right,
        "meterLevel": mix_target.meter_level,
        "peakHold": mix_target.peak_hold,
        "peakHoldLeft": mix_target.peak_hold_left,
        "peakHoldRight": mix_target.peak_hold_right,
        "levelLeftDbfs": level_left_dbfs,
        "levelRightDbfs": level_right_dbfs,
        "peakLeftDbfs": normalized_to_payload_dbfs(peak_left),
        "peakRightDbfs": normalized_to_payload_dbfs(peak_right),
        "rmsLeftDbfs": level_left_dbfs,
        "rmsRightDbfs": level_right_dbfs,
        "peakHoldLeftDbfs": normalized_to_payload_dbfs(mix_target.peak_hold_left),
        "peakHoldRightDbfs": normalized_to_payload_dbfs(mix_target.peak_hold_right),
        "peakWarning": peak_warning,
        "meterPointOver": meter_point_over,
        "meterPointOverLeft": over_left,
        "meterPointOverRight": over_right,
        "over": meter_point_over,
        "overLeft": over_left,
        "overRight": over_right,
        "clipHold": false,
    })
}

fn audio_meter_tick_payload(
    snapshot: &AudioSnapshot,
    state: &RmeTotalMixMeterState,
    sequence: u64,
    metering_started_at: Instant,
    now_ms: u64,
) -> Value {
    let diagnostics = state.diagnostics();
    json!({
        "reason": "metering-tick",
        "sequence": sequence,
        "monotonicTimestampMs": metering_started_at.elapsed().as_secs_f64() * 1000.0,
        "cadenceHz": 30.0,
        "meteringSource": RME_TOTALMIX_OSC_SOURCE,
        "meteringState": state.status_at(now_ms).as_str(),
        "lastPacketAgeMs": state.last_packet_age_ms(now_ms),
        "diagnostics": {
            "packetCount": diagnostics.packet_count,
            "mappedPacketCount": diagnostics.mapped_packet_count,
            "unknownPacketCount": diagnostics.unknown_packet_count,
            "lastAddress": diagnostics.last_address,
            "mappedEntryCount": diagnostics.mapped_entry_count,
        },
        "selectedMixTargetId": snapshot.selected_mix_target_id,
        "channels": snapshot
            .channels
            .iter()
            .map(channel_meter_payload)
            .collect::<Vec<_>>(),
        "mixTargets": snapshot
            .mix_targets
            .iter()
            .map(mix_target_meter_payload)
            .collect::<Vec<_>>(),
    })
}

fn normalized_to_payload_dbfs(value: f64) -> f64 {
    let dbfs = normalized_to_dbfs(value);
    if dbfs.is_finite() {
        dbfs.clamp(AUDIO_METER_FLOOR_DBFS, 0.0)
    } else {
        AUDIO_METER_FLOOR_DBFS
    }
}

fn monotonic_now_ms() -> u64 {
    static STARTED_AT: OnceLock<Instant> = OnceLock::new();
    STARTED_AT
        .get_or_init(Instant::now)
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests;
