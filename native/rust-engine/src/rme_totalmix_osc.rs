use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::{
    read_audio_snapshot, AudioChannelSnapshot, AudioChannelUpdateRequest, AudioEqUpdateRequest,
    AudioMixTargetSnapshot, AudioMixTargetUpdateRequest, AudioSnapshot,
};
use crate::protocol::{event_message, EVENT_AUDIO_CHANGED};
use crate::storage::list_settings_by_prefix;
use rosc::{decoder, encoder, OscMessage, OscPacket, OscType};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::{mpsc::Sender, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

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

pub fn send_totalmix_eq_update(
    send_host: &str,
    send_port: i64,
    channel_id: &str,
    request: &AudioEqUpdateRequest,
) -> Result<usize, String> {
    let Some((bus_command, channel_index)) = totalmix_channel_target(channel_id) else {
        return Err(format!(
            "Audio channel '{channel_id}' is not addressable by TotalMix Page 2 EQ."
        ));
    };
    if send_port <= 0 || send_port > u16::MAX as i64 {
        return Err(String::from("TotalMix OSC send port is invalid."));
    }

    let mut messages = totalmix_eq_parameter_messages(request);
    if messages.is_empty() {
        return Ok(0);
    }
    messages.splice(
        0..0,
        [
            (format!("/2/{bus_command}"), OscType::Float(1.0)),
            (
                String::from("/setBankStart"),
                OscType::Int(channel_index as i32),
            ),
            (String::from("/setOffsetInBank"), OscType::Int(0)),
        ],
    );

    send_osc_messages(send_host, send_port as u16, &messages)
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

fn totalmix_channel_target(channel_id: &str) -> Option<(&'static str, usize)> {
    if let Some(raw) = channel_id.strip_prefix("audio-input-") {
        let index = raw.parse::<usize>().ok()?.checked_sub(1)?;
        return Some(("busInput", index));
    }
    if let Some(raw) = channel_id.strip_prefix("audio-playback-") {
        let left = raw.split('-').next()?.parse::<usize>().ok()?;
        let index = left.checked_sub(1)?;
        return Some(("busPlayback", index));
    }
    None
}

fn totalmix_eq_parameter_messages(request: &AudioEqUpdateRequest) -> Vec<(String, OscType)> {
    let mut messages = Vec::new();
    if request.enabled.is_some() {
        messages.push((String::from("/2/eqEnable"), OscType::Float(1.0)));
    }
    if request.low_cut_enabled.is_some() {
        messages.push((String::from("/2/lowcutEnable"), OscType::Float(1.0)));
    }
    if let Some(frequency_hz) = request.low_cut_frequency_hz {
        messages.push((
            String::from("/2/lowcutFreq"),
            OscType::Float(totalmix_frequency_scale(frequency_hz)),
        ));
    }
    if let Some(slope) = request.low_cut_slope_db_per_octave {
        messages.push((
            String::from("/2/lowcutGrade"),
            OscType::Float(totalmix_low_cut_grade_scale(slope)),
        ));
    }

    if let Some(band_id) = request.band_id.as_deref() {
        if let Some(band_index) = totalmix_eq_band_index(band_id) {
            if let Some(band_type) = request.band_type.as_deref() {
                if band_index == 1 || band_index == 3 {
                    messages.push((
                        format!("/2/eqType{band_index}"),
                        OscType::Float(totalmix_eq_type_scale(band_index, band_type)),
                    ));
                }
            }
            if let Some(gain_db) = request.gain_db {
                messages.push((
                    format!("/2/eqGain{band_index}"),
                    OscType::Float(totalmix_linear_scale(gain_db, -20.0, 20.0)),
                ));
            }
            if let Some(frequency_hz) = request.frequency_hz {
                messages.push((
                    format!("/2/eqFreq{band_index}"),
                    OscType::Float(totalmix_frequency_scale(frequency_hz)),
                ));
            }
            if let Some(q) = request.q {
                messages.push((
                    format!("/2/eqQ{band_index}"),
                    OscType::Float(totalmix_linear_scale(q, 0.4, 9.9)),
                ));
            }
        }
    }

    messages
}

fn totalmix_eq_band_index(band_id: &str) -> Option<i64> {
    match band_id {
        "1" => Some(1),
        "2" => Some(2),
        "3" => Some(3),
        _ => None,
    }
}

fn totalmix_frequency_scale(frequency_hz: f64) -> f32 {
    let min = 20.0_f64.ln();
    let max = 20_000.0_f64.ln();
    (((frequency_hz.clamp(20.0, 20_000.0).ln() - min) / (max - min)).clamp(0.0, 1.0)) as f32
}

fn totalmix_linear_scale(value: f64, min: f64, max: f64) -> f32 {
    (((value.clamp(min, max) - min) / (max - min)).clamp(0.0, 1.0)) as f32
}

fn totalmix_low_cut_grade_scale(slope: i64) -> f32 {
    match slope {
        6 => 0.0,
        12 => 1.0 / 3.0,
        18 => 2.0 / 3.0,
        24 => 1.0,
        _ => 1.0 / 3.0,
    }
}

fn totalmix_eq_type_scale(band_index: i64, band_type: &str) -> f32 {
    match (band_index, band_type) {
        (1, "low-shelf") | (3, "high-shelf") => 1.0 / 3.0,
        (1, "high-pass") | (3, "low-pass") => 2.0 / 3.0,
        (1, "low-pass") | (3, "high-pass") => 1.0,
        _ => 0.0,
    }
}

/// Outcome of one outbound TotalMix control send: how many OSC commands went
/// to the wire, and which requested fields stayed app-local because TotalMix
/// exposes no OSC command for them on this surface.
#[derive(Debug, Default)]
pub struct TotalMixSendReport {
    pub sent: usize,
    pub local_only: Vec<&'static str>,
}

/// Maps a console channel surface onto the Global OSC namespace: the bus
/// word plus the 0-based hardware channel number (left channel of a stereo
/// pair, per RME's protocol table). Hardware numbering never shifts with
/// the TotalMix mixer layout.
pub(crate) fn global_channel_target(surface_id: &str) -> Option<(&'static str, usize)> {
    if let Some(raw) = surface_id.strip_prefix("audio-input-") {
        let number = raw.parse::<usize>().ok()?;
        if (1..=12).contains(&number) {
            return Some(("input", number - 1));
        }
        return None;
    }
    if let Some(raw) = surface_id.strip_prefix("audio-playback-") {
        let left = raw.split('-').next()?.parse::<usize>().ok()?;
        if left % 2 == 1 && (1..=11).contains(&left) {
            return Some(("playback", left - 1));
        }
        return None;
    }
    None
}

/// Maps a mix-target surface onto its 0-based hardware output channel (left
/// channel of the pair): Main = AN 1/2, Phones 1 = PH 9/10, Phones 2 =
/// PH 11/12. Doubles as the submix address for `/mix/{in|pb}/{ch}/{out}/…`
/// sends.
pub(crate) fn global_output_channel(mix_target_id: &str) -> Option<usize> {
    match mix_target_id {
        "audio-mix-main" => Some(0),
        "audio-mix-phones-a" => Some(8),
        "audio-mix-phones-b" => Some(10),
        _ => None,
    }
}

/// Inverse of [`global_channel_target`]: the app surface for a hardware
/// channel the console reported. Right channels of stereo pairs and channels
/// outside the modelled range map to nothing.
pub(crate) fn global_channel_surface(bus_word: &str, channel: usize) -> Option<String> {
    match bus_word {
        "input" if channel < 12 => Some(format!("audio-input-{}", channel + 1)),
        "playback" if channel.is_multiple_of(2) && channel <= 10 => {
            Some(format!("audio-playback-{}-{}", channel + 1, channel + 2))
        }
        _ => None,
    }
}

/// Inverse of [`global_output_channel`].
pub(crate) fn global_output_mix_target(output: usize) -> Option<&'static str> {
    match output {
        0 => Some("audio-mix-main"),
        8 => Some("audio-mix-phones-a"),
        10 => Some("audio-mix-phones-b"),
        _ => None,
    }
}

fn osc_bool(value: bool) -> OscType {
    OscType::Float(if value { 1.0 } else { 0.0 })
}

fn validated_command_port(send_port: i64, offset: u16) -> Result<u16, String> {
    let base =
        u16::try_from(send_port).map_err(|_| String::from("TotalMix OSC send port is invalid."))?;
    base.checked_add(offset)
        .ok_or_else(|| String::from("TotalMix OSC send port leaves no room for the +1/+2 slots."))
}

/// Sends one operator channel edit to TotalMix over the Global OSC
/// namespace (RME protocol table, 2026-07-21): hardware channel numbering
/// that never shifts with the mixer layout, and absolute values throughout
/// — mute/solo/48V state can no longer invert against the console. Faders
/// route to the requested submix node (`/mix/{in|pb}/{ch}/{out}/faderlin`,
/// linear 0..1 — the app's own fader scale); preamp gain is sent in real
/// dB. Fields with no OSC command on this surface stay app-local.
pub fn send_totalmix_channel_update(
    send_host: &str,
    send_port: i64,
    channel: &AudioChannelSnapshot,
    request: &AudioChannelUpdateRequest,
) -> Result<TotalMixSendReport, String> {
    let Some((bus_word, ch)) = global_channel_target(&channel.id) else {
        return Ok(TotalMixSendReport {
            sent: 0,
            local_only: vec!["all fields (channel is not on the console)"],
        });
    };
    let port = validated_command_port(send_port, GLOBAL_OSC_PORT_OFFSET)?;
    let is_input = bus_word == "input";
    let mix_word = if is_input { "in" } else { "pb" };

    let mut report = TotalMixSendReport::default();
    let mut messages: Vec<(String, OscType)> = Vec::new();

    if let Some(fader) = request.fader {
        let target_id = request.mix_target_id.as_deref().unwrap_or("audio-mix-main");
        if let Some(out) = global_output_channel(target_id) {
            messages.push((
                format!("/mix/{mix_word}/{ch}/{out}/faderlin"),
                OscType::Float(fader.clamp(0.0, 1.0) as f32),
            ));
        } else {
            report.local_only.push("fader (unknown submix)");
        }
    }
    if let Some(gain) = request.gain {
        if channel.role == "front-preamp" {
            messages.push((format!("/input/{ch}/gain"), OscType::Float(gain as f32)));
        } else {
            report.local_only.push("gain (no preamp on this channel)");
        }
    }
    if let Some(mute) = request.mute {
        messages.push((format!("/{bus_word}/{ch}/mute"), osc_bool(mute)));
    }
    if let Some(solo) = request.solo {
        // Solo is a per-mix-node flag; the operator's solo acts on the main
        // submix, matching the console's default solo bus.
        messages.push((format!("/mix/{mix_word}/{ch}/0/solo"), osc_bool(solo)));
    }
    if let Some(phantom) = request.phantom {
        if is_input {
            messages.push((format!("/input/{ch}/48v"), osc_bool(phantom)));
        } else {
            report.local_only.push("phantom (input channels only)");
        }
    }
    if let Some(phase) = request.phase {
        if is_input {
            messages.push((format!("/input/{ch}/phase"), osc_bool(phase)));
        } else {
            report.local_only.push("phase (input channels only)");
        }
    }
    if let Some(pad) = request.pad {
        if is_input {
            messages.push((format!("/input/{ch}/pad"), osc_bool(pad)));
        } else {
            report.local_only.push("pad (input channels only)");
        }
    }
    if let Some(instrument) = request.instrument {
        if is_input {
            messages.push((format!("/input/{ch}/instrument"), osc_bool(instrument)));
        } else {
            report.local_only.push("instrument (input channels only)");
        }
    }
    if let Some(auto_set) = request.auto_set {
        if is_input {
            messages.push((format!("/input/{ch}/autoset"), osc_bool(auto_set)));
        } else {
            report.local_only.push("auto-set (input channels only)");
        }
    }

    report.sent = send_osc_messages(send_host, port, &messages)?;
    // Registered after the datagrams left: the console link now expects each
    // parameter to read back with this value (rme_console_link).
    crate::rme_console_link::register_outgoing_commands(&messages);
    Ok(report)
}

/// Sends one operator output-mix edit to TotalMix over the Global OSC
/// namespace. Output level rides `/output/{ch}/faderlin` (linear 0..1) and
/// mute is absolute; dim, mono, and talkback are control-room functions
/// that TotalMix exposes only for the main out, so they are sent for
/// `audio-mix-main` and reported local-only for the phones targets.
pub fn send_totalmix_mix_target_update(
    send_host: &str,
    send_port: i64,
    mix_target_id: &str,
    request: &AudioMixTargetUpdateRequest,
) -> Result<TotalMixSendReport, String> {
    let Some(out) = global_output_channel(mix_target_id) else {
        return Ok(TotalMixSendReport {
            sent: 0,
            local_only: vec!["all fields (mix target is not on the console)"],
        });
    };
    let port = validated_command_port(send_port, GLOBAL_OSC_PORT_OFFSET)?;
    let is_main = mix_target_id == "audio-mix-main";

    let mut report = TotalMixSendReport::default();
    let mut messages: Vec<(String, OscType)> = Vec::new();

    if let Some(volume) = request.volume {
        messages.push((
            format!("/output/{out}/faderlin"),
            OscType::Float(volume.clamp(0.0, 1.0) as f32),
        ));
    }
    if let Some(mute) = request.mute {
        messages.push((format!("/output/{out}/mute"), osc_bool(mute)));
    }
    if let Some(dim) = request.dim {
        if is_main {
            messages.push((String::from("/controlroom/dim"), osc_bool(dim)));
        } else {
            report.local_only.push("dim (main out only)");
        }
    }
    if let Some(mono) = request.mono {
        if is_main {
            messages.push((String::from("/controlroom/mainmono"), osc_bool(mono)));
        } else {
            report.local_only.push("mono (main out only)");
        }
    }
    if let Some(talkback) = request.talkback {
        if is_main {
            messages.push((String::from("/controlroom/talkback"), osc_bool(talkback)));
        } else {
            report.local_only.push("talkback (main out only)");
        }
    }

    report.sent = send_osc_messages(send_host, port, &messages)?;
    crate::rme_console_link::register_outgoing_commands(&messages);
    Ok(report)
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

pub fn spawn_rme_totalmix_audio_metering(sender: Sender<Value>, db_path: PathBuf) {
    let state = shared_meter_state();
    thread::spawn(move || {
        let poll_interval = configured_poll_interval();
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
                    sockets = bind_slots(snapshot.send_port, snapshot.receive_port);
                    global_slot = bind_global_slot(snapshot.send_port, snapshot.receive_port);
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
            read_available_packets(&sockets, state.clone(), now_ms);
            if let Some(slot) = global_slot.as_mut() {
                read_global_packets(slot, &state, now_ms);
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

fn bind_slots(send_port: i64, receive_port: i64) -> Vec<BoundRmeSlot> {
    let Ok(slots) = slot_configs(send_port, receive_port) else {
        return Vec::new();
    };
    slots
        .into_iter()
        .filter_map(|slot| {
            let socket = UdpSocket::bind(("0.0.0.0", slot.receive_port))
                .map_err(|error| {
                    eprintln!(
                        "RME TotalMix metering could not bind receive port {}: {}",
                        slot.receive_port, error
                    );
                    error
                })
                .ok()?;
            if let Err(error) = socket.set_nonblocking(true) {
                eprintln!(
                    "RME TotalMix metering could not set receive port {} nonblocking: {}",
                    slot.receive_port, error
                );
                return None;
            }
            Some(BoundRmeSlot {
                bus: slot.bus,
                send_port: slot.send_port,
                socket,
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
) {
    let mut buffer = [0_u8; RECEIVE_BUFFER_BYTES];
    for slot in sockets {
        loop {
            match slot.socket.recv_from(&mut buffer) {
                Ok((len, _source)) => match decoder::decode_udp(&buffer[..len]) {
                    Ok((_remainder, packet)) => {
                        if let Ok(mut state) = state.lock() {
                            state.apply_packet(slot.bus, &packet, now_ms);
                        }
                    }
                    Err(error) => eprintln!("RME TotalMix OSC decode failed: {error}"),
                },
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
}

pub(crate) struct GlobalOscSlot {
    send_port: u16,
    socket: UdpSocket,
    last_rx_at: Option<Instant>,
}

fn bind_global_slot(send_port: i64, receive_port: i64) -> Option<GlobalOscSlot> {
    let send = u16::try_from(send_port)
        .ok()?
        .checked_add(GLOBAL_OSC_PORT_OFFSET)?;
    let recv = u16::try_from(receive_port)
        .ok()?
        .checked_add(GLOBAL_OSC_PORT_OFFSET)?;
    let socket = UdpSocket::bind(("0.0.0.0", recv)).ok()?;
    socket.set_nonblocking(true).ok()?;
    Some(GlobalOscSlot {
        send_port: send,
        socket,
        last_rx_at: None,
    })
}

pub(crate) fn read_global_packets(
    slot: &mut GlobalOscSlot,
    state: &Arc<Mutex<RmeTotalMixMeterState>>,
    now_ms: u64,
) {
    let mut buffer = [0_u8; RECEIVE_BUFFER_BYTES];
    loop {
        match slot.socket.recv_from(&mut buffer) {
            Ok((len, _source)) => {
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

/// Test stand-in for the metering thread's per-tick console-link work: read
/// the slot, service read-backs, flush to the database.
#[cfg(test)]
pub(crate) fn pump_global_slot_for_test(
    slot: &mut GlobalOscSlot,
    send_host: &str,
    db_path: &std::path::Path,
) {
    let state = shared_meter_state();
    read_global_packets(slot, &state, monotonic_now_ms());
    service_console_link(slot, send_host);
    flush_console_link_to_db(db_path);
}

/// A Global OSC slot on an ephemeral loopback port whose read-backs go to
/// `send_port` (a fake console in tests).
#[cfg(test)]
pub(crate) fn bind_test_global_slot(send_port: u16) -> GlobalOscSlot {
    let socket = UdpSocket::bind(("127.0.0.1", 0)).expect("test global slot should bind");
    socket
        .set_nonblocking(true)
        .expect("test global slot should be non-blocking");
    GlobalOscSlot {
        send_port,
        socket,
        last_rx_at: None,
    }
}

#[cfg(test)]
impl GlobalOscSlot {
    pub(crate) fn local_port(&self) -> u16 {
        self.socket.local_addr().expect("slot address").port()
    }
}

/// The real Global OSC slot (`send_port`, `receive_port` already +3) for the
/// hardware-lane pull test.
#[cfg(test)]
pub(crate) fn bind_live_global_slot_for_test(
    send_port: u16,
    receive_port: u16,
) -> Option<GlobalOscSlot> {
    let socket = UdpSocket::bind(("0.0.0.0", receive_port)).ok()?;
    socket.set_nonblocking(true).ok()?;
    Some(GlobalOscSlot {
        send_port,
        socket,
        last_rx_at: None,
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
mod tests {
    use super::*;
    use crate::audio_backend::{read_default_audio_inventory, AudioBackendConfig};
    use rosc::{OscBundle, OscMessage, OscTime, OscType};

    fn message(addr: &str, arg: OscType) -> OscMessage {
        OscMessage {
            addr: addr.to_string(),
            args: vec![arg],
        }
    }

    #[test]
    fn parses_numbered_totalmix_level_messages() {
        let parsed = parse_totalmix_meter_message(&message("/1/level9Left", OscType::Float(0.5)))
            .expect("level9 left should parse");

        assert_eq!(parsed.channel_index, 8);
        assert_eq!(parsed.side, RmeMeterSide::Left);
        assert!((parsed.normalized - 0.5).abs() < 0.000_001);
        assert!((parsed.dbfs + 6.020_6).abs() < 0.001);
    }

    #[test]
    fn clamps_configured_poll_interval() {
        assert_eq!(poll_interval_from_value(None), Duration::from_millis(16));
        assert_eq!(
            poll_interval_from_value(Some("1")),
            Duration::from_millis(5)
        );
        assert_eq!(
            poll_interval_from_value(Some("40")),
            Duration::from_millis(40)
        );
        assert_eq!(
            poll_interval_from_value(Some("250")),
            Duration::from_millis(100)
        );
        assert_eq!(
            poll_interval_from_value(Some("bad")),
            Duration::from_millis(16)
        );
    }

    #[test]
    fn builds_totalmix_page_two_eq_messages_for_rme_model() {
        assert_eq!(
            totalmix_channel_target("audio-input-9"),
            Some(("busInput", 8))
        );
        assert_eq!(
            totalmix_channel_target("audio-playback-3-4"),
            Some(("busPlayback", 2))
        );

        let request = AudioEqUpdateRequest {
            channel_id: String::from("audio-input-9"),
            enabled: Some(true),
            low_cut_enabled: Some(true),
            low_cut_frequency_hz: Some(80.0),
            low_cut_slope_db_per_octave: Some(18),
            band_id: Some(String::from("3")),
            band_enabled: None,
            band_type: Some(String::from("high-shelf")),
            frequency_hz: Some(8_500.0),
            gain_db: Some(6.0),
            q: Some(1.4),
        };
        let messages = totalmix_eq_parameter_messages(&request);
        let addresses = messages
            .iter()
            .map(|(address, _)| address.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            addresses,
            vec![
                "/2/eqEnable",
                "/2/lowcutEnable",
                "/2/lowcutFreq",
                "/2/lowcutGrade",
                "/2/eqType3",
                "/2/eqGain3",
                "/2/eqFreq3",
                "/2/eqQ3",
            ]
        );
        assert!(
            matches!(messages[3].1, OscType::Float(value) if (value - (2.0 / 3.0)).abs() < 0.000_001)
        );
        assert!(
            matches!(messages[4].1, OscType::Float(value) if (value - (1.0 / 3.0)).abs() < 0.000_001)
        );
    }

    #[test]
    fn parses_totalmix_db_display_values_including_negative_infinity() {
        let finite = parse_totalmix_meter_message(&message(
            "/1/level2RightVal",
            OscType::String("-18.0 dB".to_string()),
        ))
        .expect("level2 right display value should parse");
        assert_eq!(finite.channel_index, 1);
        assert_eq!(finite.side, RmeMeterSide::Right);
        assert!((finite.dbfs + 18.0).abs() < 0.001);
        assert!((finite.normalized - 0.125_893).abs() < 0.000_01);

        let silent = parse_totalmix_meter_message(&message(
            "/1/level2RightVal",
            OscType::String("-oo".to_string()),
        ))
        .expect("-oo display value should parse");
        assert!(silent.dbfs.is_infinite());
        assert!(silent.dbfs.is_sign_negative());
        assert_eq!(silent.normalized, 0.0);
    }

    #[test]
    fn maps_three_totalmix_slots_to_commissioned_tidied_layout_surface_ids() {
        let mut state = RmeTotalMixMeterState::new();
        // Tidied layout: input strip 1 = front preamp 9.
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1LeftVal", OscType::String("-12 dB".to_string())),
            1_000,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1RightVal", OscType::String("-12 dB".to_string())),
            1_000,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Playback,
            &message("/1/level2LeftVal", OscType::String("-20 dB".to_string())),
            1_010,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Playback,
            &message("/1/level2RightVal", OscType::String("-21 dB".to_string())),
            1_010,
        ));
        // Tidied layout: output strip 5 = Phones 1 (Main sits at strip 1).
        assert!(state.apply_message(
            RmeTotalMixBus::Output,
            &message("/1/level5LeftVal", OscType::String("-9 dB".to_string())),
            1_020,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Output,
            &message("/1/level5RightVal", OscType::String("-10 dB".to_string())),
            1_020,
        ));

        let host = state
            .entry_for_surface_id("audio-input-9")
            .expect("input strip 1 should map to front preamp 9");
        assert!((host.left_dbfs + 12.0).abs() < 0.001);
        assert!((host.right_dbfs + 12.0).abs() < 0.001);

        let playback = state
            .entry_for_surface_id("audio-playback-3-4")
            .expect("playback 3/4 should be mapped from slot playback strip 2");
        assert!((playback.left_dbfs + 20.0).abs() < 0.001);
        assert!((playback.right_dbfs + 21.0).abs() < 0.001);

        let phones = state
            .entry_for_surface_id("audio-mix-phones-a")
            .expect("phones 1 should be mapped from output strip 5");
        assert!((phones.left_dbfs + 9.0).abs() < 0.001);
        assert!((phones.right_dbfs + 10.0).abs() < 0.001);

        // Strips outside the tidied layout stay unmapped.
        assert!(!state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level9LeftVal", OscType::String("-3 dB".to_string())),
            1_030,
        ));
    }

    #[test]
    fn applies_every_meter_message_in_osc_bundles() {
        let mut state = RmeTotalMixMeterState::new();
        let packet = OscPacket::Bundle(OscBundle {
            timetag: OscTime::from((0, 1)),
            content: vec![
                OscPacket::Message(message("/1/level1Left", OscType::Float(0.25))),
                OscPacket::Message(message("/1/level2Left", OscType::Float(0.5))),
            ],
        });

        assert!(state.apply_packet(RmeTotalMixBus::Input, &packet, 1_000));

        assert_eq!(state.diagnostics().mapped_packet_count, 2);
        assert!(state.entry_for_surface_id("audio-input-9").is_some());
        assert!(state.entry_for_surface_id("audio-input-10").is_some());
    }

    #[test]
    fn reports_live_stale_and_offline_from_real_packet_age() {
        let mut state = RmeTotalMixMeterState::new();
        assert_eq!(state.status_at(1_000), RmeMeteringState::Offline);

        state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1Left", OscType::Float(0.25)),
            1_000,
        );

        assert_eq!(state.status_at(1_250), RmeMeteringState::Live);
        assert_eq!(state.last_packet_age_ms(1_250), Some(250));
        assert_eq!(state.status_at(1_700), RmeMeteringState::Stale);
        assert_eq!(state.status_at(3_100), RmeMeteringState::Offline);
    }

    #[test]
    fn default_inventory_is_rme_totalmix_with_no_synthetic_meter_motion() {
        let config = AudioBackendConfig {
            send_host: "127.0.0.1".to_string(),
            send_port: 7001,
            receive_port: 9001,
            metering_source: RME_TOTALMIX_OSC_SOURCE.to_string(),
        };

        let first = read_default_audio_inventory(&config);
        std::thread::sleep(std::time::Duration::from_millis(140));
        let second = read_default_audio_inventory(&config);

        assert_eq!(first.adapter_mode, RME_TOTALMIX_OSC_SOURCE);
        assert_eq!(second.adapter_mode, RME_TOTALMIX_OSC_SOURCE);
        assert_eq!(first.channels.len(), 18);
        assert_eq!(first.mix_targets.len(), 3);
        assert!(
            second
                .channels
                .iter()
                .all(|channel| channel.meter_level == 0.0
                    && channel.meter_left == 0.0
                    && channel.meter_right == 0.0),
            "production RME inventory must not synthesize moving meters"
        );
    }

    #[test]
    fn compact_rme_meter_payload_separates_current_body_from_held_peak() {
        let config = AudioBackendConfig {
            send_host: "127.0.0.1".to_string(),
            send_port: 7001,
            receive_port: 9001,
            metering_source: RME_TOTALMIX_OSC_SOURCE.to_string(),
        };
        let inventory = read_default_audio_inventory(&config);
        let mut channel = inventory
            .channels
            .into_iter()
            .find(|channel| channel.id == "audio-input-9")
            .expect("default inventory should include host input");

        channel.stereo = true;
        channel.meter_left = 0.25;
        channel.meter_right = 0.10;
        channel.meter_level = 0.25;
        channel.peak_hold_left = 0.80;
        channel.peak_hold_right = 0.40;
        channel.peak_hold = 0.80;

        let payload = channel_meter_payload(&channel);

        assert!(
            (payload["rmsLeftDbfs"].as_f64().unwrap() - normalized_to_payload_dbfs(0.25)).abs()
                < 0.001
        );
        assert!(
            (payload["rmsRightDbfs"].as_f64().unwrap() - normalized_to_payload_dbfs(0.10)).abs()
                < 0.001
        );
        assert!(
            (payload["peakLeftDbfs"].as_f64().unwrap() - normalized_to_payload_dbfs(0.80)).abs()
                < 0.001
        );
        assert!(
            (payload["peakRightDbfs"].as_f64().unwrap() - normalized_to_payload_dbfs(0.40)).abs()
                < 0.001
        );
    }

    #[test]
    fn compact_rme_meter_payload_exposes_console_meter_fields() {
        let config = AudioBackendConfig {
            send_host: "127.0.0.1".to_string(),
            send_port: 7001,
            receive_port: 9001,
            metering_source: RME_TOTALMIX_OSC_SOURCE.to_string(),
        };
        let inventory = read_default_audio_inventory(&config);
        let mut channel = inventory
            .channels
            .into_iter()
            .find(|channel| channel.id == "audio-input-9")
            .expect("default inventory should include host input");

        channel.meter_left = dbfs_to_normalized(-3.0);
        channel.meter_right = dbfs_to_normalized(-24.0);
        channel.meter_level = channel.meter_left.max(channel.meter_right);
        channel.peak_hold_left = dbfs_to_normalized(-1.5);
        channel.peak_hold_right = dbfs_to_normalized(-18.0);
        channel.peak_hold = channel.peak_hold_left.max(channel.peak_hold_right);
        channel.clip = true;

        let payload = channel_meter_payload(&channel);

        assert_eq!(payload["meterPoint"], "input");
        assert!((payload["levelLeftDbfs"].as_f64().unwrap() + 3.0).abs() < 0.001);
        assert!((payload["levelRightDbfs"].as_f64().unwrap() + 24.0).abs() < 0.001);
        assert_eq!(payload["peakWarning"], true);
        assert_eq!(payload["meterPointOver"], false);
        assert_eq!(payload["meterPointOverLeft"], false);
        assert_eq!(payload["meterPointOverRight"], false);
        assert_eq!(payload["channelPathClip"], true);
        assert_eq!(payload["over"], false);
        assert_eq!(payload["overLeft"], false);
        assert_eq!(payload["overRight"], false);
        assert_eq!(payload["clipHold"], true);
    }

    #[test]
    fn rme_meter_state_holds_and_decays_peaks_with_console_ballistics() {
        let config = AudioBackendConfig {
            send_host: "127.0.0.1".to_string(),
            send_port: 7001,
            receive_port: 9001,
            metering_source: RME_TOTALMIX_OSC_SOURCE.to_string(),
        };
        let mut snapshot = AudioSnapshot {
            status: String::from("ready"),
            ..crate::audio::read_audio_snapshot(&std::collections::HashMap::from([(
                String::from("app.audio.metering_source"),
                String::from(RME_TOTALMIX_OSC_SOURCE),
            )]))
        };
        snapshot.channels = read_default_audio_inventory(&config).channels;
        let mut state = RmeTotalMixMeterState::new();

        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1LeftVal", OscType::String("-1.0 dB".to_string())),
            1_000,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1RightVal", OscType::String("-1.0 dB".to_string())),
            1_000,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1LeftVal", OscType::String("-24.0 dB".to_string())),
            1_033,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1RightVal", OscType::String("-24.0 dB".to_string())),
            1_033,
        ));

        state.apply_to_snapshot(&mut snapshot, 1_033);
        let held = snapshot
            .channels
            .iter()
            .find(|channel| channel.id == "audio-input-9")
            .expect("host input should be mapped after first packet");
        assert!((normalized_to_payload_dbfs(held.meter_left) + 24.0).abs() < 0.001);
        assert!((normalized_to_payload_dbfs(held.peak_hold_left) + 1.0).abs() < 0.001);

        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1LeftVal", OscType::String("-24.0 dB".to_string())),
            2_750,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1RightVal", OscType::String("-24.0 dB".to_string())),
            2_750,
        ));
        state.apply_to_snapshot(&mut snapshot, 2_800);
        let decayed = snapshot
            .channels
            .iter()
            .find(|channel| channel.id == "audio-input-9")
            .expect("host input should still be mapped");
        assert!(
            (normalized_to_payload_dbfs(decayed.peak_hold_left) + 7.0).abs() < 0.25,
            "peak should decay by roughly 20 dB/s after the 1500 ms hold window"
        );
    }

    // plan PR 8 / workstream E6: wire-level OSC test. Binds a local UDP
    // receiver and asserts that `send_totalmix_eq_update` emits the
    // documented prefix sequence (`/2/busInput` + `/setBankStart` +
    // `/setOffsetInBank`) followed by the per-band parameter messages.
    // Exercises the bytes that actually go on the wire — the higher-level
    // simulator/parser tests above cover the receive side; this fills in
    // the send-side coverage the plan called out.
    #[test]
    fn send_totalmix_eq_update_emits_documented_address_prefix_on_the_wire() {
        use crate::audio::AudioEqUpdateRequest;
        use rosc::OscPacket;
        use std::time::Duration;

        let receiver = UdpSocket::bind(("127.0.0.1", 0)).expect("test UDP receiver should bind");
        receiver
            .set_read_timeout(Some(Duration::from_secs(1)))
            .expect("test receiver should accept timeout");
        let port = receiver
            .local_addr()
            .expect("receiver should expose port")
            .port();

        let request = AudioEqUpdateRequest {
            channel_id: String::from("audio-input-9"),
            enabled: None,
            low_cut_enabled: None,
            low_cut_frequency_hz: None,
            low_cut_slope_db_per_octave: None,
            band_id: Some(String::from("1")),
            band_enabled: None,
            band_type: Some(String::from("bell")),
            frequency_hz: Some(180.0),
            gain_db: Some(3.0),
            q: Some(0.9),
        };

        let count =
            super::send_totalmix_eq_update("127.0.0.1", port as i64, "audio-input-9", &request)
                .expect("send_totalmix_eq_update should succeed against the local receiver");
        assert!(
            count >= 3,
            "sender should emit at least the 3-message prefix (got {count})"
        );

        let mut addresses: Vec<String> = Vec::new();
        let mut buffer = [0u8; 4096];
        for _ in 0..count {
            let (read, _from) = receiver
                .recv_from(&mut buffer)
                .expect("each sent message should arrive on the loopback");
            let packet = rosc::decoder::decode_udp(&buffer[..read])
                .expect("each datagram should decode as OSC")
                .1;
            if let OscPacket::Message(message) = packet {
                addresses.push(message.addr);
            }
        }

        // Prefix contract per `send_totalmix_eq_update`:
        //   1. `/2/<bus>` (busInput / busOutput)
        //   2. `/setBankStart`
        //   3. `/setOffsetInBank`
        assert!(
            addresses.iter().any(|addr| addr == "/2/busInput"),
            "prefix should include /2/busInput, saw {addresses:?}"
        );
        assert!(
            addresses.contains(&String::from("/setBankStart")),
            "prefix should include /setBankStart, saw {addresses:?}"
        );
        assert!(
            addresses.contains(&String::from("/setOffsetInBank")),
            "prefix should include /setOffsetInBank, saw {addresses:?}"
        );
        // And at least one per-band parameter address after the prefix.
        assert!(
            addresses.iter().any(|addr| addr.starts_with("/2/eq")),
            "wire payload should include at least one /2/eq* parameter address, saw {addresses:?}"
        );
    }

    fn bind_test_receiver() -> (UdpSocket, u16) {
        let receiver = UdpSocket::bind(("127.0.0.1", 0)).expect("test UDP receiver should bind");
        receiver
            .set_read_timeout(Some(Duration::from_secs(1)))
            .expect("test receiver should accept timeout");
        let port = receiver
            .local_addr()
            .expect("receiver should expose port")
            .port();
        (receiver, port)
    }

    fn receive_messages(receiver: &UdpSocket, count: usize) -> Vec<(String, Option<f32>)> {
        let mut received = Vec::new();
        let mut buffer = [0u8; 4096];
        for _ in 0..count {
            let (read, _from) = receiver
                .recv_from(&mut buffer)
                .expect("each sent message should arrive on the loopback");
            let packet = rosc::decoder::decode_udp(&buffer[..read])
                .expect("each datagram should decode as OSC")
                .1;
            if let OscPacket::Message(message) = packet {
                let value = message.args.first().and_then(|arg| match arg {
                    OscType::Float(value) => Some(*value),
                    _ => None,
                });
                received.push((message.addr, value));
            }
        }
        received
    }

    #[test]
    fn send_slot_keepalives_pins_each_slot_to_its_bus_and_bank_start() {
        let (receiver, port) = bind_test_receiver();
        let slot_socket = UdpSocket::bind(("127.0.0.1", 0)).expect("slot send socket should bind");
        let slots = vec![super::BoundRmeSlot {
            bus: RmeTotalMixBus::Playback,
            send_port: port,
            socket: slot_socket,
        }];

        super::send_slot_keepalives(&slots, "127.0.0.1");

        let mut addresses = Vec::new();
        let mut buffer = [0u8; 512];
        for _ in 0..2 {
            let (read, _from) = receiver
                .recv_from(&mut buffer)
                .expect("keepalive messages should arrive on the slot send port");
            let packet = rosc::decoder::decode_udp(&buffer[..read])
                .expect("keepalive should decode as OSC")
                .1;
            if let OscPacket::Message(message) = packet {
                addresses.push(message.addr);
            }
        }
        assert_eq!(addresses, vec!["/1/busPlayback", "/setBankStart"]);
    }

    #[test]
    fn global_osc_output_levels_map_to_mix_target_meters() {
        let mut state = RmeTotalMixMeterState::new();

        // Main out = hardware output channels 0/1, values are peak dB.
        assert!(state.apply_global_message(&message("/level/out/0", OscType::Float(-10.5)), 1_000,));
        assert!(state.apply_global_message(&message("/level/out/1", OscType::Float(-11.5)), 1_000,));
        // Phones 1 = channels 8/9.
        assert!(state.apply_global_message(&message("/level/out/9", OscType::Float(-20.0)), 1_005,));

        let main = state
            .entry_for_surface_id("audio-mix-main")
            .expect("main out should be mapped from output channels 0/1");
        assert!((main.left_dbfs + 10.5).abs() < 0.001);
        assert!((main.right_dbfs + 11.5).abs() < 0.001);

        let phones = state
            .entry_for_surface_id("audio-mix-phones-a")
            .expect("phones 1 should be mapped from output channel 9");
        assert!((phones.right_dbfs + 20.0).abs() < 0.001);

        // Liveness advances on mapped global packets.
        assert_eq!(state.status_at(1_010), RmeMeteringState::Live);
    }

    #[test]
    fn global_osc_maps_input_and_playback_levels_on_hardware_numbering() {
        let mut state = RmeTotalMixMeterState::new();
        // Mono input channel 9 (0-based 8) drives both meter sides.
        assert!(state.apply_global_message(&message("/level/in/8", OscType::Float(-24.0)), 1_000));
        let host = state
            .entry_for_surface_id("audio-input-9")
            .expect("input channel 8 should map to front preamp 9");
        assert!((host.left_dbfs + 24.0).abs() < 0.001);
        assert!((host.right_dbfs + 24.0).abs() < 0.001);

        // Playback channels 0/1 form pair 1/2 with distinct sides.
        assert!(state.apply_global_message(&message("/level/pb/0", OscType::Float(-12.0)), 1_000));
        assert!(state.apply_global_message(&message("/level/pb/1", OscType::Float(-13.0)), 1_000));
        let program = state
            .entry_for_surface_id("audio-playback-1-2")
            .expect("playback channels 0/1 should map to pair 1/2");
        assert!((program.left_dbfs + 12.0).abs() < 0.001);
        assert!((program.right_dbfs + 13.0).abs() < 0.001);
    }

    #[test]
    fn global_osc_ignores_unmapped_channels_and_status_traffic() {
        let mut state = RmeTotalMixMeterState::new();
        // Unmapped channels (AN 3-8 outputs, digital I/O) are dropped.
        assert!(!state.apply_global_message(&message("/level/out/5", OscType::Float(-6.0)), 1_000));
        assert!(!state.apply_global_message(&message("/level/in/12", OscType::Float(-6.0)), 1_000));
        assert!(!state.apply_global_message(
            &message("/status/device", OscType::String(String::from("UFX III"))),
            1_000,
        ));
        assert!(state.entry_for_surface_id("audio-mix-main").is_none());
    }

    #[test]
    fn live_global_levels_suppress_classic_bank_levels() {
        let mut state = RmeTotalMixMeterState::new();
        assert!(state.apply_global_message(&message("/level/in/8", OscType::Float(-24.0)), 1_000));

        // A classic bank message inside the authority window is ignored —
        // bank strip indexes shift with the mixer layout, global numbering
        // does not.
        assert!(!state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1LeftVal", OscType::String("-3.0 dB".to_string())),
            1_500,
        ));
        let host = state
            .entry_for_surface_id("audio-input-9")
            .expect("global entry should survive");
        assert!((host.left_dbfs + 24.0).abs() < 0.001);

        // Once the global stream has been quiet long enough, classic levels
        // resume as the fallback source.
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level1LeftVal", OscType::String("-3.0 dB".to_string())),
            4_000,
        ));
    }

    #[test]
    fn service_console_link_reads_back_over_the_global_slot_and_confirms() {
        use crate::rme_console_link::{
            link_now_ms, shared_console_link, ChannelFlag, ConsoleBus, ConsoleValue, ParamKey,
            READBACK_DELAY_MS,
        };
        // Fake TotalMix: receives the read-back request on the slot's send
        // port and answers on the slot socket, like the real console does.
        let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Ok(mut link) = shared_console_link().lock() {
            link.reset_for_test();
        }
        let (fake_totalmix, fake_port) = bind_test_receiver();
        let socket = UdpSocket::bind(("127.0.0.1", 0)).expect("global slot socket should bind");
        socket
            .set_nonblocking(true)
            .expect("slot socket should be non-blocking");
        let slot_port = socket.local_addr().expect("slot addr").port();
        let mut slot = super::GlobalOscSlot {
            send_port: fake_port,
            socket,
            last_rx_at: None,
        };
        let key = ParamKey::ChannelFlag {
            bus: ConsoleBus::Input,
            channel: 11,
            flag: ChannelFlag::Mute,
        };
        {
            let link = shared_console_link();
            let mut link = link.lock().expect("link lock");
            link.register_send(key.clone(), ConsoleValue::Flag(true), link_now_ms());
        }
        std::thread::sleep(Duration::from_millis(READBACK_DELAY_MS + 20));
        super::service_console_link(&slot, "127.0.0.1");

        // The read-back for input 11 must reach the fake console (other tests
        // may have queued unrelated read-backs on the shared link).
        let mut saw_readback = false;
        for _ in 0..64 {
            let mut buffer = [0u8; 512];
            let Ok((read, _)) = fake_totalmix.recv_from(&mut buffer) else {
                break;
            };
            if let Ok((_, OscPacket::Message(message))) = rosc::decoder::decode_udp(&buffer[..read])
            {
                if message.addr == "/sendchan/input/11" {
                    assert_eq!(message.args, vec![OscType::Float(1.0)]);
                    saw_readback = true;
                    break;
                }
            }
        }
        assert!(
            saw_readback,
            "the console link should ask TotalMix to report input 11"
        );

        // The fake console reports the channel; the link confirms the send.
        let reply = encoder::encode(&OscPacket::Message(OscMessage {
            addr: String::from("/input/11/mute"),
            args: vec![OscType::Float(1.0)],
        }))
        .expect("reply should encode");
        fake_totalmix
            .send_to(&reply, ("127.0.0.1", slot_port))
            .expect("reply should send");
        std::thread::sleep(Duration::from_millis(30));
        let state = shared_meter_state();
        super::read_global_packets(&mut slot, &state, monotonic_now_ms());

        let link = shared_console_link();
        let link = link.lock().expect("link lock");
        assert!(
            !link.has_pending(&key),
            "the read-back reply should confirm the send"
        );
    }

    #[test]
    fn test_guard_drops_sends_to_real_totalmix_ports_only() {
        // The studio workstation runs this suite with TotalMix listening on
        // 7001-7004; nothing a test sends may reach it.
        assert!(super::test_guard_blocks_console_port(7001));
        assert!(super::test_guard_blocks_console_port(7004));
        assert!(!super::test_guard_blocks_console_port(19_004));
        assert!(!super::test_guard_blocks_console_port(1));

        let request = AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-9"),
            mix_target_id: None,
            name: None,
            gain: None,
            fader: None,
            mute: Some(true),
            solo: None,
            phantom: None,
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        };
        let snapshot = read_audio_snapshot(&HashMap::new());
        let channel = snapshot
            .channels
            .iter()
            .find(|channel| channel.id == "audio-input-9")
            .expect("default snapshot should expose front preamp 9");
        // Aimed at the default remote (7001 + 3): reported as sent, never
        // put on the wire.
        let report = super::send_totalmix_channel_update("127.0.0.1", 7001, channel, &request)
            .expect("guarded send should not error");
        assert_eq!(report.sent, 1);

        // Aimed at a loopback receiver on an ephemeral port: delivered.
        let (receiver, port) = bind_test_receiver();
        let report = super::send_totalmix_channel_update(
            "127.0.0.1",
            i64::from(port) - 3,
            channel,
            &request,
        )
        .expect("loopback send should succeed");
        assert_eq!(report.sent, 1);
        let received = receive_messages(&receiver, 1);
        assert_eq!(received[0].0, "/input/8/mute");
    }

    #[test]
    fn refresh_global_slot_sends_sendall_and_sendstate_to_the_slot_port() {
        let (receiver, port) = bind_test_receiver();
        let socket = UdpSocket::bind(("127.0.0.1", 0)).expect("global slot socket should bind");
        let slot = super::GlobalOscSlot {
            send_port: port,
            socket,
            last_rx_at: None,
        };

        super::refresh_global_slot(&slot, "127.0.0.1");

        // `/sendall 2` asks for every parameter with mix nodes above -65 dB
        // (RME protocol table); `/sendstate 1` adds the status messages.
        let received = receive_messages(&receiver, 2);
        assert_eq!(
            received,
            vec![
                (String::from("/sendall"), Some(2.0)),
                (String::from("/sendstate"), Some(1.0)),
            ]
        );
    }

    #[test]
    fn send_console_pull_request_targets_the_global_slot() {
        let (receiver, port) = bind_test_receiver();
        let sent = super::send_console_pull_request("127.0.0.1", i64::from(port) - 3)
            .expect("pull request should send");
        assert_eq!(sent, 2);
        let received = receive_messages(&receiver, 2);
        assert_eq!(received[0], (String::from("/sendall"), Some(2.0)));
        assert_eq!(received[1], (String::from("/sendstate"), Some(1.0)));
    }

    #[test]
    fn global_channel_target_maps_hardware_numbering() {
        assert_eq!(
            super::global_channel_target("audio-input-1"),
            Some(("input", 0))
        );
        assert_eq!(
            super::global_channel_target("audio-input-9"),
            Some(("input", 8))
        );
        assert_eq!(
            super::global_channel_target("audio-input-12"),
            Some(("input", 11))
        );
        assert_eq!(super::global_channel_target("audio-input-13"), None);
        assert_eq!(
            super::global_channel_target("audio-playback-1-2"),
            Some(("playback", 0))
        );
        assert_eq!(
            super::global_channel_target("audio-playback-11-12"),
            Some(("playback", 10))
        );
        assert_eq!(super::global_channel_target("audio-mix-main"), None);

        assert_eq!(super::global_output_channel("audio-mix-main"), Some(0));
        assert_eq!(super::global_output_channel("audio-mix-phones-a"), Some(8));
        assert_eq!(super::global_output_channel("audio-mix-phones-b"), Some(10));
        assert_eq!(super::global_output_channel("audio-mix-unknown"), None);
    }

    #[test]
    fn send_totalmix_channel_update_emits_global_absolute_commands() {
        let (receiver, port) = bind_test_receiver();
        // Global OSC commands go to the global slot at send_port + 3.
        let base_port = port as i64 - 3;
        let snapshot = read_audio_snapshot(&HashMap::new());
        let channel = snapshot
            .channels
            .iter()
            .find(|channel| channel.id == "audio-input-9")
            .expect("default snapshot should expose front preamp 9");

        let request = AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-9"),
            mix_target_id: None,
            name: None,
            gain: Some(30),
            fader: Some(0.5),
            mute: Some(true),
            solo: None,
            phantom: Some(true),
            phase: Some(true),
            pad: None,
            instrument: None,
            auto_set: None,
        };

        let report = super::send_totalmix_channel_update("127.0.0.1", base_port, channel, &request)
            .expect("channel update should send against the local receiver");
        assert_eq!(
            report.sent, 5,
            "fader + gain + mute + phantom + phase should send"
        );
        assert!(report.local_only.is_empty());

        let received = receive_messages(&receiver, report.sent);
        let addresses: Vec<&str> = received.iter().map(|(addr, _)| addr.as_str()).collect();
        // Front preamp 9 = hardware channel 8; main mix = output channel 0.
        assert!(
            addresses.contains(&"/mix/in/8/0/faderlin"),
            "saw {addresses:?}"
        );
        assert!(addresses.contains(&"/input/8/gain"), "saw {addresses:?}");
        assert!(addresses.contains(&"/input/8/mute"), "saw {addresses:?}");
        assert!(addresses.contains(&"/input/8/48v"), "saw {addresses:?}");
        assert!(addresses.contains(&"/input/8/phase"), "saw {addresses:?}");

        let fader = received
            .iter()
            .find(|(addr, _)| addr == "/mix/in/8/0/faderlin")
            .and_then(|(_, value)| *value)
            .expect("faderlin message should carry a float");
        assert!(
            (fader - 0.5).abs() < 0.001,
            "faderlin is the app's 0..1 scale"
        );
        let gain = received
            .iter()
            .find(|(addr, _)| addr == "/input/8/gain")
            .and_then(|(_, value)| *value)
            .expect("gain message should carry a float");
        assert!((gain - 30.0).abs() < 0.001, "gain is sent in real dB");
        let mute = received
            .iter()
            .find(|(addr, _)| addr == "/input/8/mute")
            .and_then(|(_, value)| *value)
            .expect("mute message should carry a float");
        assert!(
            (mute - 1.0).abs() < 0.001,
            "mute is absolute state, not a toggle"
        );
    }

    #[test]
    fn send_totalmix_channel_update_reaches_non_main_submixes_and_absolute_off() {
        let (receiver, port) = bind_test_receiver();
        let base_port = port as i64 - 3;
        let snapshot = read_audio_snapshot(&HashMap::new());
        let channel = snapshot
            .channels
            .iter()
            .find(|channel| channel.id == "audio-input-9")
            .expect("default snapshot should expose front preamp 9");

        let request = AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-9"),
            mix_target_id: Some(String::from("audio-mix-phones-a")),
            name: None,
            gain: None,
            fader: Some(0.7),
            mute: Some(false),
            solo: None,
            phantom: None,
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        };

        let report = super::send_totalmix_channel_update("127.0.0.1", base_port, channel, &request)
            .expect("phones-submix fader should send over Global OSC");
        assert_eq!(report.sent, 2, "fader + mute should send");
        assert!(report.local_only.is_empty());

        let received = receive_messages(&receiver, report.sent);
        // Phones 1 submix = output channel 8.
        let fader = received
            .iter()
            .find(|(addr, _)| addr == "/mix/in/8/8/faderlin")
            .and_then(|(_, value)| *value)
            .expect("phones-submix faderlin should arrive");
        assert!((fader - 0.7).abs() < 0.001);
        let mute = received
            .iter()
            .find(|(addr, _)| addr == "/input/8/mute")
            .and_then(|(_, value)| *value)
            .expect("mute message should arrive");
        assert!(mute.abs() < 0.001, "unmute sends absolute 0.0");
    }

    #[test]
    fn send_totalmix_channel_update_handles_lines_and_playback_channels() {
        let (receiver, port) = bind_test_receiver();
        let base_port = port as i64 - 3;
        let snapshot = read_audio_snapshot(&HashMap::new());

        // Rear line 1 = hardware channel 0: fader/mute send, gain stays local.
        let line = snapshot
            .channels
            .iter()
            .find(|channel| channel.id == "audio-input-1")
            .expect("default snapshot should expose rear line 1");
        let request = AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-1"),
            mix_target_id: None,
            name: None,
            gain: Some(10),
            fader: Some(0.4),
            mute: Some(true),
            solo: None,
            phantom: None,
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        };
        let report = super::send_totalmix_channel_update("127.0.0.1", base_port, line, &request)
            .expect("line-channel edits should send fader and mute");
        assert_eq!(report.sent, 2);
        assert!(report
            .local_only
            .contains(&"gain (no preamp on this channel)"));
        let received = receive_messages(&receiver, report.sent);
        let addresses: Vec<&str> = received.iter().map(|(addr, _)| addr.as_str()).collect();
        assert!(
            addresses.contains(&"/mix/in/0/0/faderlin"),
            "saw {addresses:?}"
        );
        assert!(addresses.contains(&"/input/0/mute"), "saw {addresses:?}");

        // Playback pair 1/2 = pb channel 0: mute on the playback bus,
        // phantom is input-only.
        let playback = snapshot
            .channels
            .iter()
            .find(|channel| channel.id == "audio-playback-1-2")
            .expect("default snapshot should expose playback pair 1/2");
        let request = AudioChannelUpdateRequest {
            channel_id: String::from("audio-playback-1-2"),
            mix_target_id: None,
            name: None,
            gain: None,
            fader: None,
            mute: Some(true),
            solo: None,
            phantom: Some(true),
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        };
        let report =
            super::send_totalmix_channel_update("127.0.0.1", base_port, playback, &request)
                .expect("playback edits should send mute");
        assert_eq!(report.sent, 1);
        assert!(report.local_only.contains(&"phantom (input channels only)"));
        let received = receive_messages(&receiver, report.sent);
        assert_eq!(received[0].0, "/playback/0/mute");
    }

    #[test]
    fn send_totalmix_mix_target_update_uses_output_faderlin_and_control_room() {
        let (receiver, port) = bind_test_receiver();
        let base_port = port as i64 - 3;

        let request = AudioMixTargetUpdateRequest {
            mix_target_id: String::from("audio-mix-main"),
            volume: Some(0.8),
            mute: None,
            dim: Some(true),
            mono: None,
            talkback: None,
        };

        let report = super::send_totalmix_mix_target_update(
            "127.0.0.1",
            base_port,
            "audio-mix-main",
            &request,
        )
        .expect("mix target update should send against the local receiver");
        assert_eq!(report.sent, 2, "volume + dim should send");
        assert!(report.local_only.is_empty());

        let received = receive_messages(&receiver, report.sent);
        let addresses: Vec<&str> = received.iter().map(|(addr, _)| addr.as_str()).collect();
        // Main out = hardware output channel 0.
        assert!(
            addresses.contains(&"/output/0/faderlin"),
            "saw {addresses:?}"
        );
        assert!(addresses.contains(&"/controlroom/dim"), "saw {addresses:?}");
    }

    #[test]
    fn send_totalmix_mix_target_update_keeps_phones_control_room_functions_local() {
        let (receiver, port) = bind_test_receiver();
        let base_port = port as i64 - 3;

        let request = AudioMixTargetUpdateRequest {
            mix_target_id: String::from("audio-mix-phones-b"),
            volume: Some(0.6),
            mute: None,
            dim: Some(true),
            mono: Some(true),
            talkback: None,
        };

        let report = super::send_totalmix_mix_target_update(
            "127.0.0.1",
            base_port,
            "audio-mix-phones-b",
            &request,
        )
        .expect("phones update should send volume and keep dim/mono local");
        assert_eq!(report.sent, 1, "only the volume message should send");
        assert!(report.local_only.contains(&"dim (main out only)"));
        assert!(report.local_only.contains(&"mono (main out only)"));

        let received = receive_messages(&receiver, report.sent);
        // Phones 2 = hardware output channel 10.
        assert_eq!(received[0].0, "/output/10/faderlin");
    }
}
