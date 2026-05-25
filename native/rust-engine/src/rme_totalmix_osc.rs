use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::{
    read_audio_snapshot, AudioChannelSnapshot, AudioEqUpdateRequest, AudioMixTargetSnapshot,
    AudioSnapshot,
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

#[derive(Clone, Debug, Default)]
pub struct RmeTotalMixMeterState {
    entries: HashMap<String, RmeConsoleMeterEntry>,
    last_packet_at_ms: Option<u64>,
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

    let socket = UdpSocket::bind(("0.0.0.0", 0))
        .map_err(|error| format!("TotalMix OSC send socket could not bind: {error}"))?;
    let target = format!("{}:{}", send_host.trim(), send_port);
    for (address, value) in &messages {
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
        let mut bound_key: Option<(String, i64, i64)> = None;
        let mut last_settings_refresh_at: Option<Instant> = None;
        let mut cached_snapshot: Option<AudioSnapshot> = None;
        let mut last_snapshot_refresh_at: Option<Instant> = None;
        let mut last_publish_at: Option<Instant> = None;
        let mut last_status_publish_at: Option<Instant> = None;

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
                    bound_key = Some(key);
                } else if snapshot.metering_source != RME_TOTALMIX_OSC_SOURCE
                    || !snapshot.osc_enabled
                {
                    sockets.clear();
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

            let now_ms = monotonic_now_ms();
            read_available_packets(&sockets, state.clone(), now_ms);

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
                socket,
            })
        })
        .collect()
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
    socket: UdpSocket,
}

fn surface_id_for_meter(bus: RmeTotalMixBus, channel_index: usize) -> Option<String> {
    match bus {
        RmeTotalMixBus::Input if channel_index < 12 => {
            Some(format!("audio-input-{}", channel_index + 1))
        }
        RmeTotalMixBus::Playback if channel_index < 6 => {
            let first = channel_index * 2 + 1;
            Some(format!("audio-playback-{}-{}", first, first + 1))
        }
        RmeTotalMixBus::Output => match channel_index {
            0 => Some(String::from("audio-mix-main")),
            8 => Some(String::from("audio-mix-phones-a")),
            10 => Some(String::from("audio-mix-phones-b")),
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
    fn maps_three_totalmix_slots_to_fixed_fireface_surface_ids() {
        let mut state = RmeTotalMixMeterState::new();
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level9LeftVal", OscType::String("-12 dB".to_string())),
            1_000,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level9RightVal", OscType::String("-12 dB".to_string())),
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
        assert!(state.apply_message(
            RmeTotalMixBus::Output,
            &message("/1/level9LeftVal", OscType::String("-9 dB".to_string())),
            1_020,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Output,
            &message("/1/level9RightVal", OscType::String("-10 dB".to_string())),
            1_020,
        ));

        let host = state
            .entry_for_surface_id("audio-input-9")
            .expect("input 9 should be mapped");
        assert!((host.left_dbfs + 12.0).abs() < 0.001);
        assert!((host.right_dbfs + 12.0).abs() < 0.001);

        let playback = state
            .entry_for_surface_id("audio-playback-3-4")
            .expect("playback 3/4 should be mapped from slot playback channel 2");
        assert!((playback.left_dbfs + 20.0).abs() < 0.001);
        assert!((playback.right_dbfs + 21.0).abs() < 0.001);

        let phones = state
            .entry_for_surface_id("audio-mix-phones-a")
            .expect("phones 1 should be mapped from output channel 9/10");
        assert!((phones.left_dbfs + 9.0).abs() < 0.001);
        assert!((phones.right_dbfs + 10.0).abs() < 0.001);
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
        assert!(state.entry_for_surface_id("audio-input-1").is_some());
        assert!(state.entry_for_surface_id("audio-input-2").is_some());
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
            &message("/1/level9LeftVal", OscType::String("-1.0 dB".to_string())),
            1_000,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level9RightVal", OscType::String("-1.0 dB".to_string())),
            1_000,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level9LeftVal", OscType::String("-24.0 dB".to_string())),
            1_033,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level9RightVal", OscType::String("-24.0 dB".to_string())),
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
            &message("/1/level9LeftVal", OscType::String("-24.0 dB".to_string())),
            2_750,
        ));
        assert!(state.apply_message(
            RmeTotalMixBus::Input,
            &message("/1/level9RightVal", OscType::String("-24.0 dB".to_string())),
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
}
