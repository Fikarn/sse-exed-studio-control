use crate::app_state::{CommissioningSnapshot, APP_SETTINGS_PREFIX};
use crate::lighting_bridge_watch::{look_at_bridge, BRIDGE_LOOK_TIMEOUT, BRIDGE_PORT};
use crate::rme_totalmix_osc::{self, ProbeAnswer, ProbeKey, ProbeRefused};
use crate::storage::{list_settings_by_prefix, open_connection, set_settings_owned, EngineResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

/// The one request that runs aside the request loop, on a thread of its own
/// (`main.rs`): a probe waits on the bridge or on TotalMix for seconds, and
/// held every page and the deck's displays meanwhile (the audit of 2026-10-12).
pub(crate) const PROBE_METHOD: &str = "commissioning.check.run";

pub(crate) fn is_probe_method(method: &str) -> bool {
    method == PROBE_METHOD
}

/// How long the audio probe waits for TotalMix's answer: the metering loop
/// re-reads the settings within 500 ms and binds the probe's ports, and a
/// TotalMix in touch answers `/sendstate` within about 30 ms.
const AUDIO_PROBE_WAIT: Duration = Duration::from_secs(3);

pub const LIGHTING_BRIDGE_IP_KEY: &str = "app.commissioning.lighting.bridge_ip";
pub const LIGHTING_UNIVERSE_KEY: &str = "app.commissioning.lighting.universe";
pub const AUDIO_SEND_HOST_KEY: &str = "app.commissioning.audio.send_host";
pub const AUDIO_SEND_PORT_KEY: &str = "app.commissioning.audio.send_port";
pub const AUDIO_RECEIVE_PORT_KEY: &str = "app.commissioning.audio.receive_port";

pub const CONTROL_SURFACE_CHECK_ID: &str = "control-surface";
pub const LIGHTING_CHECK_ID: &str = "lighting";
pub const AUDIO_CHECK_ID: &str = "audio";
/// Set when the operator published with `overrideProbes: true` while a probe
/// was not `passed` (2026-09 audit Slice 8); empty after a clean publish.
pub const PUBLISH_OVERRIDE_AT_KEY: &str = "app.commissioning.publish_override_at";
/// The key the Control Surface Probe's last line is saved under.
pub const CONTROL_SURFACE_MESSAGE_KEY: &str = "app.commissioning.check.control-surface.message";
/// How every line the Control Surface Probe saved while Planning was part of
/// the app begins ("Planning context is reachable. ..."; builds before the
/// new pages program, Slice 2).
pub const PLANNING_ERA_PROBE_PREFIX: &str = "Planning context is reachable.";
/// What such a line reads once schema 8 or a restore retires it. The probe's
/// status stays as it was, so publishing is not affected.
pub const PROBE_CHECKED_BEFORE_THIS_VERSION: &str =
    "Checked before this version of Studio Control. Run the probe again to refresh this line.";
const PROBE_CHECKS: [(&str, &str); 3] = [
    (CONTROL_SURFACE_CHECK_ID, "Control Surface Probe"),
    (LIGHTING_CHECK_ID, "Lighting Bridge Probe"),
    (AUDIO_CHECK_ID, "Audio OSC Probe"),
];

const DEFAULT_LIGHTING_UNIVERSE: i64 = 1;
const DEFAULT_AUDIO_SEND_HOST: &str = "127.0.0.1";
const DEFAULT_AUDIO_SEND_PORT: i64 = 7001;
const DEFAULT_AUDIO_RECEIVE_PORT: i64 = 9001;

#[derive(Debug)]
pub enum CommissioningCommandError {
    InvalidParams(String),
    Storage(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommissioningStepSnapshot {
    pub id: String,
    pub label: String,
    pub status: String,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommissioningCheckSnapshot {
    pub id: String,
    pub label: String,
    pub status: String,
    pub message: String,
    #[serde(rename = "checkedAt")]
    pub checked_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommissioningSnapshotPayload {
    #[serde(rename = "hasCompletedSetup")]
    pub has_completed_setup: bool,
    pub stage: String,
    #[serde(rename = "runnerStage")]
    pub runner_stage: String,
    #[serde(rename = "hardwareProfile")]
    pub hardware_profile: String,
    pub summary: String,
    #[serde(rename = "configSummary")]
    pub config_summary: String,
    #[serde(rename = "readinessSummary")]
    pub readiness_summary: String,
    /// When the last publish overrode incomplete probes (`None` after a
    /// clean publish or before any publish).
    #[serde(rename = "publishOverrideAt", default)]
    pub publish_override_at: Option<String>,
    pub steps: Vec<CommissioningStepSnapshot>,
    pub checks: Vec<CommissioningCheckSnapshot>,
    pub lighting: CommissioningLightingConfig,
    pub audio: CommissioningAudioConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommissioningLightingConfig {
    #[serde(rename = "bridgeIp")]
    pub bridge_ip: String,
    pub universe: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommissioningAudioConfig {
    #[serde(rename = "sendHost")]
    pub send_host: String,
    #[serde(rename = "sendPort")]
    pub send_port: i64,
    #[serde(rename = "receivePort")]
    pub receive_port: i64,
}

#[derive(Debug, Clone)]
pub struct CommissioningCheckRequest {
    pub target: CommissioningCheckTarget,
    pub lighting_bridge_ip: Option<String>,
    pub lighting_universe: Option<i64>,
    pub audio_send_host: Option<String>,
    pub audio_send_port: Option<i64>,
    pub audio_receive_port: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommissioningCheckTarget {
    ControlSurface,
    Lighting,
    Audio,
}

pub fn default_settings_entries() -> Vec<(&'static str, &'static str)> {
    vec![
        (LIGHTING_BRIDGE_IP_KEY, ""),
        (LIGHTING_UNIVERSE_KEY, "1"),
        (AUDIO_SEND_HOST_KEY, DEFAULT_AUDIO_SEND_HOST),
        (AUDIO_SEND_PORT_KEY, "7001"),
        (AUDIO_RECEIVE_PORT_KEY, "9001"),
    ]
}

pub fn parse_commissioning_check_request(
    params: &Value,
) -> Result<CommissioningCheckRequest, String> {
    let target = match params.get("target").and_then(Value::as_str) {
        Some("control-surface") => CommissioningCheckTarget::ControlSurface,
        Some("lighting") => CommissioningCheckTarget::Lighting,
        Some("audio") => CommissioningCheckTarget::Audio,
        Some(_) => {
            return Err(String::from(
                "target must be one of: control-surface, lighting, audio",
            ))
        }
        None => return Err(String::from("target is required")),
    };

    let lighting_bridge_ip = params
        .get("bridgeIp")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| String::from("bridgeIp must be a string"))
                .map(|text| text.trim().to_string())
        })
        .transpose()?;
    let lighting_universe = params
        .get("universe")
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| String::from("universe must be an integer"))
        })
        .transpose()?;
    let audio_send_host = params
        .get("sendHost")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| String::from("sendHost must be a string"))
                .map(|text| text.trim().to_string())
        })
        .transpose()?;
    let audio_send_port = params
        .get("sendPort")
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| String::from("sendPort must be an integer"))
        })
        .transpose()?;
    let audio_receive_port = params
        .get("receivePort")
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| String::from("receivePort must be an integer"))
        })
        .transpose()?;

    Ok(CommissioningCheckRequest {
        target,
        lighting_bridge_ip,
        lighting_universe,
        audio_send_host,
        audio_send_port,
        audio_receive_port,
    })
}

pub fn read_commissioning_snapshot(db_path: &Path) -> EngineResult<CommissioningSnapshotPayload> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)?;
    let commissioning = CommissioningSnapshot::from_settings(&app_settings);

    let checks = vec![
        read_check_snapshot(
            &app_settings,
            CONTROL_SURFACE_CHECK_ID,
            "Control Surface Probe",
        ),
        read_check_snapshot(&app_settings, LIGHTING_CHECK_ID, "Lighting Bridge Probe"),
        read_check_snapshot(&app_settings, AUDIO_CHECK_ID, "Audio OSC Probe"),
    ];

    let completed_checks = checks
        .iter()
        .filter(|check| check.status == "passed")
        .count();
    let failed_checks = checks
        .iter()
        .filter(|check| check.status == "failed")
        .count();
    let lighting = CommissioningLightingConfig {
        bridge_ip: app_settings
            .get(LIGHTING_BRIDGE_IP_KEY)
            .cloned()
            .unwrap_or_default(),
        universe: app_settings
            .get(LIGHTING_UNIVERSE_KEY)
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| (1..=63999).contains(value))
            .unwrap_or(DEFAULT_LIGHTING_UNIVERSE),
    };
    let audio = CommissioningAudioConfig {
        send_host: app_settings
            .get(AUDIO_SEND_HOST_KEY)
            .cloned()
            .unwrap_or_else(|| String::from(DEFAULT_AUDIO_SEND_HOST)),
        send_port: app_settings
            .get(AUDIO_SEND_PORT_KEY)
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| is_valid_port(*value))
            .unwrap_or(DEFAULT_AUDIO_SEND_PORT),
        receive_port: app_settings
            .get(AUDIO_RECEIVE_PORT_KEY)
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| is_valid_port(*value))
            .unwrap_or(DEFAULT_AUDIO_RECEIVE_PORT),
    };
    // Setup's state sentence, printed as it is (2026-09-28: it read "Stage
    // 'publish', 3 probe records.").
    let summary = String::from(if commissioning.has_completed_setup {
        "Setup is published: Lighting, Audio, Cameras and Teleprompter are open."
    } else {
        "Setup is not published yet: Lighting, Audio, Cameras and Teleprompter stay locked until it is."
    });
    let config_summary = format!(
        "Profile '{}'. Lighting bridge '{}' on universe {}. Audio send {}:{} and receive {}.",
        commissioning.hardware_profile,
        if lighting.bridge_ip.trim().is_empty() {
            "unconfigured"
        } else {
            lighting.bridge_ip.as_str()
        },
        lighting.universe,
        audio.send_host,
        audio.send_port,
        audio.receive_port
    );
    let publish_override_at = app_settings
        .get(PUBLISH_OVERRIDE_AT_KEY)
        .filter(|value| !value.trim().is_empty())
        .cloned();
    let readiness_summary = if commissioning.has_completed_setup {
        format!(
            "{} of {} commissioning probes passed. Startup routes directly into the dashboard.",
            completed_checks,
            checks.len()
        )
    } else {
        format!(
            "{} of {} commissioning probes passed. Startup remains on Setup until publish.",
            completed_checks,
            checks.len()
        )
    };
    let current_stage = commissioning.runner_stage.as_str();
    let stage_index = match current_stage {
        "probe" => 1,
        "map" => 2,
        "verify" => 3,
        "publish" => 4,
        _ => 0,
    };
    let all_checks_completed = completed_checks == checks.len() && failed_checks == 0;

    let steps = vec![
        CommissioningStepSnapshot {
            id: String::from("import"),
            label: String::from("Import profile"),
            status: if stage_index > 0 {
                String::from("completed")
            } else {
                String::from("current")
            },
            summary: String::from("Export the Companion profile before probing hardware."),
        },
        CommissioningStepSnapshot {
            id: String::from("probe"),
            label: String::from("Probe hardware"),
            status: if failed_checks > 0 {
                String::from("attention")
            } else if stage_index > 1 {
                String::from("completed")
            } else if current_stage == "probe" {
                String::from("current")
            } else if completed_checks > 0 {
                String::from("ready")
            } else {
                String::from("pending")
            },
            summary: format!(
                "{} of {} commissioning probes passed. Failed: {}.",
                completed_checks,
                checks.len(),
                failed_checks
            ),
        },
        CommissioningStepSnapshot {
            id: String::from("map"),
            label: String::from("Map bindings"),
            status: if stage_index > 2 {
                String::from("completed")
            } else if current_stage == "map" {
                String::from("current")
            } else if all_checks_completed {
                String::from("ready")
            } else {
                String::from("pending")
            },
            summary: String::from(
                "Review the engine-owned control-surface pages before moving to live verification.",
            ),
        },
        CommissioningStepSnapshot {
            id: String::from("verify"),
            label: String::from("Verify live echo"),
            status: if stage_index > 3 {
                String::from("completed")
            } else if current_stage == "verify" {
                String::from("current")
            } else if all_checks_completed {
                String::from("ready")
            } else {
                String::from("pending")
            },
            summary: if current_stage == "verify" || stage_index > 3 {
                String::from(
                    "Press the physical Stream Deck+ controls and watch the matching cell pulse.",
                )
            } else {
                String::from("Physical-button echo verification remains locked until probes and mapping are complete.")
            },
        },
        CommissioningStepSnapshot {
            id: String::from("publish"),
            label: String::from("Publish"),
            status: if commissioning.has_completed_setup {
                String::from("completed")
            } else if current_stage == "publish" {
                String::from("current")
            } else if all_checks_completed {
                String::from("ready")
            } else {
                String::from("pending")
            },
            summary: if commissioning.has_completed_setup {
                String::from("Startup is routed directly into the dashboard surface and the publish backup can be restored.")
            } else {
                // D47: Publish opens the Overview, the page the app opens on.
                String::from("Commit setup, export a support backup, and open the Overview.")
            },
        },
    ];

    Ok(CommissioningSnapshotPayload {
        has_completed_setup: commissioning.has_completed_setup,
        stage: commissioning.stage,
        runner_stage: commissioning.runner_stage,
        hardware_profile: commissioning.hardware_profile,
        summary,
        config_summary,
        readiness_summary: with_publish_override_note(
            readiness_summary,
            publish_override_at.as_deref(),
            commissioning.has_completed_setup,
        ),
        publish_override_at,
        steps,
        checks,
        lighting,
        audio,
    })
}

pub fn run_commissioning_check(
    db_path: &Path,
    request: &CommissioningCheckRequest,
) -> Result<CommissioningSnapshotPayload, CommissioningCommandError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;

    let mut updates = Vec::new();
    let connection = open_connection(db_path)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;
    let checked_at = current_timestamp(&connection)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;

    let (check_id, status, message) = match request.target {
        // The deck passes when it asked the bridge lately (2026-09-29): until
        // then the probe counted the pages the app holds and always passed.
        CommissioningCheckTarget::ControlSurface => {
            let now = std::time::Instant::now();
            if crate::deck_heard::deck_heard_lately(db_path, now) {
                let age = crate::deck_heard::deck_heard_age(db_path, now)
                    .map(|age| age.as_secs())
                    .unwrap_or(0);
                (
                    CONTROL_SURFACE_CHECK_ID,
                    String::from("passed"),
                    format!(
                        "Companion asked the deck's bridge {age} s ago. {}",
                        summarize_control_surface_probe()
                    ),
                )
            } else {
                (
                    CONTROL_SURFACE_CHECK_ID,
                    String::from("failed"),
                    crate::deck_heard::deck_quiet_sentence(db_path, now),
                )
            }
        }
        CommissioningCheckTarget::Lighting => {
            let bridge_ip = request
                .lighting_bridge_ip
                .clone()
                .or_else(|| app_settings.get(LIGHTING_BRIDGE_IP_KEY).cloned())
                .unwrap_or_default();
            let universe = request
                .lighting_universe
                .or_else(|| {
                    app_settings
                        .get(LIGHTING_UNIVERSE_KEY)
                        .and_then(|value| value.parse::<i64>().ok())
                })
                .unwrap_or(DEFAULT_LIGHTING_UNIVERSE);

            if bridge_ip.trim().is_empty() {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "Enter the lighting bridge's IP address for the lighting probe.",
                )));
            }
            if !is_valid_ipv4(&bridge_ip) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "The lighting bridge IP must be four numbers, like 10.1.0.1.",
                )));
            }
            // The one-machine rule (the audit of 2026-10-12): a multicast
            // address would be streamed to every sACN receiver on the LAN,
            // a broadcast to every machine; the probe refuses them rather
            // than save them with its answer.
            if one_machine_ipv4(&bridge_ip).is_none() {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "The lighting bridge IP must be the address of one machine: not 0.0.0.0, a broadcast or a multicast address.",
                )));
            }
            if !(1..=63999).contains(&universe) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "The universe must be between 1 and 63999.",
                )));
            }

            updates.push((String::from(LIGHTING_BRIDGE_IP_KEY), bridge_ip.clone()));
            updates.push((String::from(LIGHTING_UNIVERSE_KEY), universe.to_string()));

            let reachable = probe_bridge_reachable(&bridge_ip);
            (
                LIGHTING_CHECK_ID,
                if reachable {
                    String::from("passed")
                } else {
                    String::from("failed")
                },
                if reachable {
                    format!(
                        "The bridge at {} answered on universe {}.",
                        bridge_ip, universe
                    )
                } else {
                    format!(
                        "Bridge probe could not reach {} on port 80. Verify power, Ethernet, and the configured address.",
                        bridge_ip
                    )
                },
            )
        }
        CommissioningCheckTarget::Audio => {
            let send_host = request
                .audio_send_host
                .clone()
                .or_else(|| app_settings.get(AUDIO_SEND_HOST_KEY).cloned())
                .unwrap_or_else(|| String::from(DEFAULT_AUDIO_SEND_HOST));
            let send_port = request
                .audio_send_port
                .or_else(|| {
                    app_settings
                        .get(AUDIO_SEND_PORT_KEY)
                        .and_then(|value| value.parse::<i64>().ok())
                })
                .unwrap_or(DEFAULT_AUDIO_SEND_PORT);
            let receive_port = request
                .audio_receive_port
                .or_else(|| {
                    app_settings
                        .get(AUDIO_RECEIVE_PORT_KEY)
                        .and_then(|value| value.parse::<i64>().ok())
                })
                .unwrap_or(DEFAULT_AUDIO_RECEIVE_PORT);

            if send_host.trim().is_empty() {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "Enter TotalMix's send host for the audio probe.",
                )));
            }
            if let Some(refusal) = crate::audio::totalmix_host_refusal(&send_host) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    refusal,
                )));
            }
            if !is_valid_port(send_port) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "TotalMix's send port must be between 1 and 65535.",
                )));
            }
            if !is_valid_port(receive_port) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "TotalMix's receive port must be between 1 and 65535.",
                )));
            }
            if let Some(refusal) = crate::audio::totalmix_port_refusal(send_port)
                .or_else(|| crate::audio::totalmix_port_refusal(receive_port))
            {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    refusal,
                )));
            }

            // The typed address and ports are saved first, so that the
            // metering loop binds to them and the probe asks TotalMix there.
            // Changed ones are a changed desk: the Console reads unknown
            // until a Sync, as the audio settings' own change writes it
            // (until the audit of 2026-10-12 the probe wrote the address
            // alone, and a saved `aligned` survived a port change).
            let saved = (
                app_settings
                    .get(AUDIO_SEND_HOST_KEY)
                    .cloned()
                    .unwrap_or_else(|| String::from(DEFAULT_AUDIO_SEND_HOST)),
                app_settings
                    .get(AUDIO_SEND_PORT_KEY)
                    .and_then(|value| value.parse::<i64>().ok())
                    .unwrap_or(DEFAULT_AUDIO_SEND_PORT),
                app_settings
                    .get(AUDIO_RECEIVE_PORT_KEY)
                    .and_then(|value| value.parse::<i64>().ok())
                    .unwrap_or(DEFAULT_AUDIO_RECEIVE_PORT),
            );
            let transport_changed = saved != (send_host.clone(), send_port, receive_port);
            let mut address = vec![
                (String::from(AUDIO_SEND_HOST_KEY), send_host.clone()),
                (String::from(AUDIO_SEND_PORT_KEY), send_port.to_string()),
                (
                    String::from(AUDIO_RECEIVE_PORT_KEY),
                    receive_port.to_string(),
                ),
            ];
            if transport_changed {
                address.extend(crate::audio::console_transport_changed_updates());
            }
            {
                let _state_guard = transport_changed.then(crate::audio::lock_audio_state);
                set_settings_owned(db_path, &address)
                    .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;
            }

            if crate::audio::audio_metering_is_simulated(&app_settings) {
                // Simulated input mode has no console to probe. Passing here is
                // honest because every audio surface labels the console "test
                // simulation" while this mode is active; it is how a run
                // without TotalMix reaches the `ready` gate.
                (
                    AUDIO_CHECK_ID,
                    String::from("passed"),
                    String::from(
                        "Simulated audio input mode: the audio probe passes without TotalMix (test mode). Metering and console control stay simulated until this mode is turned off.",
                    ),
                )
            } else if !crate::audio::audio_osc_enabled(&app_settings) {
                // With OSC off the metering loop binds nothing, so nobody
                // would ask TotalMix: said at once, not after the wait.
                (
                    AUDIO_CHECK_ID,
                    String::from("failed"),
                    String::from(
                        "OSC is off in the audio settings, so TotalMix was not asked. Turn it on, then run the probe again.",
                    ),
                )
            } else {
                match probe_audio_console(&send_host, send_port, receive_port) {
                    Ok(summary) => (AUDIO_CHECK_ID, String::from("passed"), summary),
                    Err(summary) => (AUDIO_CHECK_ID, String::from("failed"), summary),
                }
            }
        }
    };

    updates.push((check_status_key(check_id), status));
    updates.push((check_message_key(check_id), message));
    updates.push((check_checked_at_key(check_id), checked_at));
    set_settings_owned(db_path, &updates)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;

    read_commissioning_snapshot(db_path)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))
}

/// The deck's pages as the exported profile maps them (the fixture double
/// says the same sentence); Planning's selection, which it used to describe,
/// left with the page (new pages program, Slice 2).
pub(crate) fn summarize_control_surface_probe() -> String {
    let snapshot = crate::exports::build_control_surface_snapshot();
    let controls = snapshot
        .pages
        .iter()
        .map(|page| page.buttons.len() + page.dials.len())
        .sum::<usize>();
    format!(
        "The deck's bridge serves {controls} controls on {} pages.",
        snapshot.pages.len()
    )
}

/// A saved probe line that still talks about Planning reads as checked before
/// this version; every other line is kept word for word.
pub fn retire_planning_probe_message(message: &str) -> &str {
    if message.starts_with(PLANNING_ERA_PROBE_PREFIX) {
        PROBE_CHECKED_BEFORE_THIS_VERSION
    } else {
        message
    }
}

fn current_timestamp(connection: &rusqlite::Connection) -> Result<String, rusqlite::Error> {
    connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
        row.get(0)
    })
}

fn with_publish_override_note(
    readiness_summary: String,
    publish_override_at: Option<&str>,
    has_completed_setup: bool,
) -> String {
    match publish_override_at {
        Some(at) if has_completed_setup => {
            format!("{readiness_summary} Published with a probe override at {at}.")
        }
        _ => readiness_summary,
    }
}

/// Every commissioning probe that is not `passed`, worded for the operator:
/// "Audio OSC Probe failed", "Lighting Bridge Probe not run".
pub fn failing_probes(settings: &HashMap<String, String>) -> Vec<String> {
    PROBE_CHECKS
        .iter()
        .filter_map(|(check_id, label)| {
            let status = settings
                .get(&check_status_key(check_id))
                .map(String::as_str)
                .unwrap_or("idle");
            match status {
                "passed" => None,
                "failed" => Some(format!("{label} failed")),
                "idle" => Some(format!("{label} not run")),
                other => Some(format!("{label} {other}")),
            }
        })
        .collect()
}

/// Outcome of the publish gate (2026-09 audit Slice 8, operator decision 7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublishGate {
    /// Every probe passed: publish, and clear any earlier override marker.
    Clear,
    /// A probe is not passed and the request did not override.
    Refused { message: String },
    /// A probe is not passed and the operator overrode explicitly: publish
    /// and record the exception.
    Overridden { failing: Vec<String> },
}

pub fn evaluate_publish_gate(
    settings: &HashMap<String, String>,
    override_probes: bool,
) -> PublishGate {
    let failing = failing_probes(settings);
    if failing.is_empty() {
        return PublishGate::Clear;
    }
    if override_probes {
        return PublishGate::Overridden { failing };
    }
    PublishGate::Refused {
        message: format!(
            "Publish refused: {}. Run the probes until they pass, or publish with the explicit override to record the exception.",
            failing.join(", ")
        ),
    }
}

/// Timestamp recorded under `PUBLISH_OVERRIDE_AT_KEY` for an overridden publish.
pub fn publish_override_timestamp(db_path: &Path) -> EngineResult<String> {
    let connection = open_connection(db_path)?;
    Ok(current_timestamp(&connection)?)
}

fn read_check_snapshot(
    settings: &HashMap<String, String>,
    check_id: &str,
    label: &str,
) -> CommissioningCheckSnapshot {
    CommissioningCheckSnapshot {
        id: String::from(check_id),
        label: String::from(label),
        status: settings
            .get(&check_status_key(check_id))
            .cloned()
            .unwrap_or_else(|| String::from("idle")),
        message: settings
            .get(&check_message_key(check_id))
            .cloned()
            .unwrap_or_else(|| String::from("Not run yet.")),
        checked_at: settings.get(&check_checked_at_key(check_id)).cloned(),
    }
}

fn check_status_key(check_id: &str) -> String {
    format!("app.commissioning.check.{check_id}.status")
}

fn check_message_key(check_id: &str) -> String {
    format!("app.commissioning.check.{check_id}.message")
}

fn check_checked_at_key(check_id: &str) -> String {
    format!("app.commissioning.check.{check_id}.checked_at")
}

/// The probe looks as the bridge watch does (`look_at_bridge`): a connection
/// taken or refused is an answer from the address.
fn probe_bridge_reachable(ip: &str) -> bool {
    let Some(parsed_ip) = parse_ipv4(ip) else {
        return false;
    };

    look_at_bridge(
        SocketAddr::from((parsed_ip, BRIDGE_PORT)),
        BRIDGE_LOOK_TIMEOUT,
    )
    .answers()
}

/// The audio probe: TotalMix at `host` is asked for its status on remote 4
/// (the Global OSC remote, `send_port + 3`) by the metering loop, which has
/// bound the probe's ports, and the probe passes only when TotalMix answers
/// from that address on that port (the audit of 2026-10-12: the probe used to
/// pass on levels already arriving from whatever address was bound). The
/// ports in the sentences are as TotalMix's OSC settings name them: `incoming`
/// is where TotalMix listens, `outgoing` where it sends.
fn probe_audio_console(host: &str, send_port: i64, receive_port: i64) -> Result<String, String> {
    let key = ProbeKey {
        host: String::from(host.trim()),
        send_port,
        receive_port,
    };
    audio_probe_sentence(
        host,
        send_port,
        receive_port,
        rme_totalmix_osc::probe_console(key, AUDIO_PROBE_WAIT),
    )
}

/// What the audio probe says of its outcome, on screen: `Ok` for a pass.
fn audio_probe_sentence(
    host: &str,
    send_port: i64,
    receive_port: i64,
    outcome: Result<ProbeAnswer, ProbeRefused>,
) -> Result<String, String> {
    let remotes_1_to_3 = format!(
        "port incoming {}–{} and port outgoing {}–{}",
        send_port,
        send_port + 2,
        receive_port,
        receive_port + 2
    );
    let remote_4 = format!(
        "port incoming {} and port outgoing {}",
        send_port + 3,
        receive_port + 3
    );
    match outcome {
        Ok(ProbeAnswer::Answered) => Ok(format!(
            "TotalMix at {host} answered on remote 4 ({remote_4}). Remotes 1 to 3 are on {remotes_1_to_3}; their meters follow while Send Peak Level Data is on in TotalMix."
        )),
        Ok(ProbeAnswer::SlotUnbound) => Err(format!(
            "Studio Control could not listen on port {} for TotalMix's answer: another program holds it. Free the port or choose other ports, then run the probe again.",
            receive_port + 3
        )),
        Ok(ProbeAnswer::Unanswered { asked: true }) => Err(format!(
            "TotalMix at {host} did not answer on remote 4 within {} s. In TotalMix Options › Settings › OSC, set remote controller 4 to Global OSC mode with {remote_4}, and remote controllers 1–3 to {remotes_1_to_3} with Send Peak Level Data on, then run this probe again.",
            AUDIO_PROBE_WAIT.as_secs()
        )),
        // The request never went out: the loop did not bind the probe's
        // settings in time (a slow database, the address changed under the
        // probe) — the app's own fault, not TotalMix's to be set up for.
        Ok(ProbeAnswer::Unanswered { asked: false }) => Err(format!(
            "The hardware link did not get to ask TotalMix at {host} within {} s. Run the probe again; if it says so again, restart the hardware link.",
            AUDIO_PROBE_WAIT.as_secs()
        )),
        Err(ProbeRefused::NoMetering) => Err(format!(
            "The console's metering is not running, so TotalMix at {host} was not asked. Restart the hardware link, then run the probe again."
        )),
        Err(ProbeRefused::Busy) => Err(String::from(
            "A probe is still waiting for TotalMix's answer. Wait for it, then run this one again.",
        )),
    }
}

fn is_valid_ipv4(value: &str) -> bool {
    parse_ipv4(value).is_some()
}

fn parse_ipv4(value: &str) -> Option<Ipv4Addr> {
    Ipv4Addr::from_str(value.trim()).ok()
}

/// The one-machine rule for a typed address (the audit of 2026-10-12): the
/// IPv4 address of one machine, so never `0.0.0.0`, a broadcast or a multicast
/// address, which the lights would stream to every sACN receiver on the LAN
/// and the Console would send to every machine. The lighting bridge's and
/// TotalMix's addresses are held to it in Setup, at their own settings and at
/// the wire; the cameras' setup has a rule of its own (`cameras::model`).
pub(crate) fn one_machine_ipv4(value: &str) -> Option<Ipv4Addr> {
    parse_ipv4(value).filter(|address| {
        !(address.is_unspecified() || address.is_broadcast() || address.is_multicast())
    })
}

fn is_valid_port(port: i64) -> bool {
    (1..=65535).contains(&port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bootstrap::RuntimeContext;
    use crate::control_surface::ControlSurfaceBridgeInfo;
    use crate::storage::initialize_test_database;
    use std::fs;
    use std::path::PathBuf;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "studio-control-engine-{label}-{}-{unique}",
                process::id()
            ));
            fs::create_dir_all(&path).expect("test dir should be created");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    /// The audio probe forgets the shared console link's slot states when the
    /// address or ports change (`console_transport_changed_updates`); the load
    /// tests read them back, so the probes that save ports run one at a time
    /// with them.
    fn serialize_shared_link() -> std::sync::MutexGuard<'static, ()> {
        crate::rme_console_link::SHARED_LINK_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn runtime_for(test_dir: &TestDir) -> RuntimeContext {
        RuntimeContext {
            protocol_version: String::from("1"),
            app_data_dir: test_dir.path().to_path_buf(),
            backups_dir: test_dir.path().join("backups"),
            logs_dir: test_dir.path().join("logs"),
            log_file_path: test_dir.path().join("logs").join("engine.log"),
            db_path: test_dir.path().join("native.sqlite3"),
            storage_ready: true,
            storage_bootstrap: crate::storage::StorageBootstrap {
                schema_version: 4,
                format_version: String::from("1"),
                journal_mode: String::from("wal"),
                integrity_check: String::from("ok"),
            },
            control_surface_token: String::from("bridge-token-for-tests"),
            cameras_simulated: true,
            sessions_simulated: true,
            control_surface_bridge: ControlSurfaceBridgeInfo {
                base_url: String::from("http://127.0.0.1:38201"),
                port: 38201,
                available: true,
                status: String::from("ready"),
                summary: String::from("Test bridge"),
                error: None,
            },
        }
    }

    // New pages program, Slice 2: Planning left the commissioning snapshot —
    // its counts, the sample seed and every sentence that named them.
    #[test]
    fn commissioning_snapshot_says_nothing_of_planning() {
        let test_dir = TestDir::new("commissioning-snapshot");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");

        let snapshot = read_commissioning_snapshot(&runtime.db_path).expect("snapshot should read");

        assert_eq!(snapshot.summary, "Setup is not published yet: Lighting, Audio, Cameras and Teleprompter stay locked until it is.");
        assert_eq!(
            snapshot
                .steps
                .iter()
                .find(|step| step.id == "import")
                .map(|step| step.status.as_str()),
            Some("current")
        );
        assert!(snapshot.config_summary.contains("Lighting bridge"));
        assert_eq!(
            snapshot.readiness_summary,
            "0 of 3 commissioning probes passed. Startup remains on Setup until publish."
        );
        let wire = serde_json::to_value(&snapshot).expect("snapshot serializes");
        for field in [
            "planningProjectCount",
            "planningTaskCount",
            "sampleSeedAvailable",
        ] {
            assert!(wire.get(field).is_none(), "{field} is still on the wire");
        }
        let sentences = [&snapshot.summary, &snapshot.readiness_summary]
            .into_iter()
            .chain(snapshot.steps.iter().map(|step| &step.summary));
        for sentence in sentences {
            assert!(
                !sentence.to_lowercase().contains("planning"),
                "\"{sentence}\" names Planning"
            );
        }
    }

    #[test]
    fn publish_gate_refuses_until_every_probe_passed_and_records_an_override() {
        // 2026-09 audit Slice 8. Nothing has run: every probe is "not run".
        let mut settings: HashMap<String, String> = HashMap::new();
        let super::PublishGate::Refused { message } =
            super::evaluate_publish_gate(&settings, false)
        else {
            panic!("a fresh workstation must not publish");
        };
        assert!(message.starts_with("Publish refused: "), "{message}");
        assert!(
            message.contains("Control Surface Probe not run"),
            "{message}"
        );
        assert!(
            message.contains("Lighting Bridge Probe not run"),
            "{message}"
        );
        assert!(message.contains("Audio OSC Probe not run"), "{message}");

        settings.insert(
            super::check_status_key(super::CONTROL_SURFACE_CHECK_ID),
            String::from("passed"),
        );
        settings.insert(
            super::check_status_key(super::LIGHTING_CHECK_ID),
            String::from("failed"),
        );
        let super::PublishGate::Refused { message } =
            super::evaluate_publish_gate(&settings, false)
        else {
            panic!("a failed probe must refuse");
        };
        assert!(
            message.contains("Lighting Bridge Probe failed"),
            "{message}"
        );
        assert!(message.contains("Audio OSC Probe not run"), "{message}");
        assert!(!message.contains("Control Surface"), "{message}");

        assert_eq!(
            super::evaluate_publish_gate(&settings, true),
            super::PublishGate::Overridden {
                failing: vec![
                    String::from("Lighting Bridge Probe failed"),
                    String::from("Audio OSC Probe not run"),
                ],
            }
        );

        settings.insert(
            super::check_status_key(super::LIGHTING_CHECK_ID),
            String::from("passed"),
        );
        settings.insert(
            super::check_status_key(super::AUDIO_CHECK_ID),
            String::from("passed"),
        );
        assert_eq!(
            super::evaluate_publish_gate(&settings, false),
            super::PublishGate::Clear
        );
        // An override with nothing to override records nothing.
        assert_eq!(
            super::evaluate_publish_gate(&settings, true),
            super::PublishGate::Clear
        );
    }

    #[test]
    fn readiness_summary_names_a_probe_override_only_after_publish() {
        assert_eq!(
            super::with_publish_override_note(
                String::from("All good."),
                Some("2026-09-04T10:00:00Z"),
                true
            ),
            "All good. Published with a probe override at 2026-09-04T10:00:00Z."
        );
        assert_eq!(
            super::with_publish_override_note(
                String::from("Pending."),
                Some("2026-09-04T10:00:00Z"),
                false
            ),
            "Pending."
        );
        assert_eq!(
            super::with_publish_override_note(String::from("All good."), None, true),
            "All good."
        );
    }

    // Found, to check (2026-09-28): the deck's probe counted the pages the app
    // holds and always passed. It passes when the deck asked the bridge
    // lately, and says what to check when it has not (2026-09-29).
    #[test]
    fn control_surface_probe_passes_only_when_the_deck_asked_lately() {
        let test_dir = TestDir::new("commissioning-control-surface");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");
        let probe = || {
            let snapshot = run_commissioning_check(
                &runtime.db_path,
                &CommissioningCheckRequest {
                    target: CommissioningCheckTarget::ControlSurface,
                    lighting_bridge_ip: None,
                    lighting_universe: None,
                    audio_send_host: None,
                    audio_send_port: None,
                    audio_receive_port: None,
                },
            )
            .expect("control surface probe should run");
            snapshot
                .checks
                .into_iter()
                .find(|check| check.id == CONTROL_SURFACE_CHECK_ID)
                .map(|check| (check.status, check.message))
                .expect("the deck's probe is listed")
        };

        let (status, message) = probe();
        assert_eq!(status, "failed", "no deck has asked this bridge");
        assert!(
            message.starts_with(
                "Companion has not asked the deck's bridge for anything since the hardware link started."
            ),
            "{message}"
        );

        crate::deck_heard::note_deck_heard(&runtime.db_path, std::time::Instant::now());
        let (status, message) = probe();
        assert_eq!(status, "passed");
        // New pages program, Slice 2: the probe describes the deck's pages,
        // not a Planning selection (it said "Planning context is reachable").
        assert!(
            message.starts_with("Companion asked the deck's bridge "),
            "{message}"
        );
        assert!(message.contains("The deck's bridge serves "), "{message}");
        assert!(!message.to_lowercase().contains("planning"), "{message}");
    }

    // The test double says this sentence word for word
    // (`controlSurface.test.ts`), and the pages' captures print its number:
    // when the deck's model changes, both change. Since 2026-10-03 (the
    // approved layout): 7 keys, 4 strip cells and 12 dial controls on LIGHTS,
    // CAMERAS and PROMPTER, which have a dark key each; 8 keys, 4 strip cells
    // and 12 dial controls on AUDIO.
    #[test]
    fn the_control_surface_probe_counts_the_decks_controls() {
        assert_eq!(
            summarize_control_surface_probe(),
            "The deck's bridge serves 93 controls on 4 pages."
        );
    }

    #[test]
    fn audio_probe_rejects_invalid_host() {
        let test_dir = TestDir::new("commissioning-audio-invalid-host");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");

        let error = run_commissioning_check(
            &runtime.db_path,
            &CommissioningCheckRequest {
                target: CommissioningCheckTarget::Audio,
                lighting_bridge_ip: None,
                lighting_universe: None,
                audio_send_host: Some(String::from("bad host")),
                audio_send_port: Some(7001),
                audio_receive_port: Some(9001),
            },
        )
        .expect_err("invalid host should fail");

        match error {
            CommissioningCommandError::InvalidParams(message) => {
                assert_eq!(
                    message,
                    "TotalMix's address must be localhost or four numbers, like 127.0.0.1."
                );
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    // The one-machine rule (the audit of 2026-10-12): an address that is no
    // machine's is refused before anything is saved, for the bridge and for
    // TotalMix alike.
    #[test]
    fn a_probe_refuses_an_address_that_is_not_one_machines() {
        let test_dir = TestDir::new("commissioning-one-machine");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");
        let refusal = |request: CommissioningCheckRequest| match run_commissioning_check(
            &runtime.db_path,
            &request,
        ) {
            Err(CommissioningCommandError::InvalidParams(message)) => message,
            other => panic!("the address should be refused: {other:?}"),
        };
        for address in ["0.0.0.0", "255.255.255.255", "239.255.0.1"] {
            assert_eq!(
                refusal(CommissioningCheckRequest {
                    target: CommissioningCheckTarget::Lighting,
                    lighting_bridge_ip: Some(String::from(address)),
                    lighting_universe: Some(1),
                    audio_send_host: None,
                    audio_send_port: None,
                    audio_receive_port: None,
                }),
                "The lighting bridge IP must be the address of one machine: not 0.0.0.0, a broadcast or a multicast address.",
                "{address}"
            );
            assert_eq!(
                refusal(CommissioningCheckRequest {
                    target: CommissioningCheckTarget::Audio,
                    lighting_bridge_ip: None,
                    lighting_universe: None,
                    audio_send_host: Some(String::from(address)),
                    audio_send_port: Some(7_001),
                    audio_receive_port: Some(19_001),
                }),
                "TotalMix's address must be the address of one machine: not 0.0.0.0, a broadcast or a multicast address.",
                "{address}"
            );
        }
        let settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
            .expect("settings should load");
        assert_eq!(
            settings.get(LIGHTING_BRIDGE_IP_KEY).map(String::as_str),
            Some(""),
            "nothing saved"
        );
        assert_eq!(
            settings.get(AUDIO_SEND_HOST_KEY).map(String::as_str),
            Some(DEFAULT_AUDIO_SEND_HOST),
            "nothing saved"
        );
        assert_eq!(
            one_machine_ipv4("10.1.0.1"),
            Some(Ipv4Addr::new(10, 1, 0, 1))
        );
        assert_eq!(one_machine_ipv4(" 127.0.0.1 "), Some(Ipv4Addr::LOCALHOST));
        assert_eq!(one_machine_ipv4("224.0.0.1"), None);
    }

    // Without the metering loop (a test has none) the probe is refused at once
    // and says so, with the ports as TotalMix names them; the typed address
    // and ports are saved first all the same, since the loop binds to them.
    #[test]
    fn audio_probe_fails_at_once_without_the_metering_loop_and_saves_the_ports() {
        let _serial = serialize_shared_link();
        let test_dir = TestDir::new("commissioning-audio-no-metering");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");

        let started = std::time::Instant::now();
        let snapshot = run_commissioning_check(
            &runtime.db_path,
            &CommissioningCheckRequest {
                target: CommissioningCheckTarget::Audio,
                lighting_bridge_ip: None,
                lighting_universe: None,
                audio_send_host: Some(String::from("127.0.0.1")),
                // A dead send port: nothing of the probe's must reach the
                // studio's real TotalMix remotes on 7001-7004.
                audio_send_port: Some(1),
                audio_receive_port: Some(19_001),
            },
        )
        .expect("audio probe should record failed status, not reject valid params");
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "no wait without a loop"
        );

        let audio_check = snapshot
            .checks
            .iter()
            .find(|check| check.id == AUDIO_CHECK_ID)
            .expect("audio check should be present");
        assert_eq!(audio_check.status, "failed");
        assert_eq!(
            audio_check.message,
            "The console's metering is not running, so TotalMix at 127.0.0.1 was not asked. Restart the hardware link, then run the probe again."
        );
        assert_eq!(snapshot.audio.send_host, "127.0.0.1");
        assert_eq!(snapshot.audio.send_port, 1);
        assert_eq!(snapshot.audio.receive_port, 19_001);
    }

    // With OSC off nobody would ask TotalMix: said at once, before any wait.
    #[test]
    fn audio_probe_fails_at_once_while_osc_is_off() {
        let _serial = serialize_shared_link();
        let test_dir = TestDir::new("commissioning-audio-osc-off");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");
        crate::storage::set_settings_owned(
            &runtime.db_path,
            &[(String::from("app.audio.osc_enabled"), String::from("false"))],
        )
        .expect("the setting should persist");

        let snapshot = run_commissioning_check(
            &runtime.db_path,
            &CommissioningCheckRequest {
                target: CommissioningCheckTarget::Audio,
                lighting_bridge_ip: None,
                lighting_universe: None,
                audio_send_host: Some(String::from("127.0.0.1")),
                audio_send_port: Some(1),
                audio_receive_port: Some(19_001),
            },
        )
        .expect("the probe records a failed status");
        let audio_check = snapshot
            .checks
            .iter()
            .find(|check| check.id == AUDIO_CHECK_ID)
            .expect("audio check should be present");
        assert_eq!(audio_check.status, "failed");
        assert_eq!(
            audio_check.message,
            "OSC is off in the audio settings, so TotalMix was not asked. Turn it on, then run the probe again."
        );
    }

    // A probe with another address or other ports is a changed desk: the
    // Console reads unknown until a Sync, as the audio settings' own change
    // writes it (the roadmap's open item of 2026-10-01); the same address
    // probed again leaves what the Console knows.
    #[test]
    fn audio_probe_with_other_ports_makes_the_console_unknown() {
        let _serial = serialize_shared_link();
        let test_dir = TestDir::new("commissioning-audio-unknown");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");
        let confidence = || {
            crate::audio::read_audio_snapshot(
                &list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
                    .expect("settings should load"),
            )
            .console_state_confidence
        };
        let probe = |send_port: i64| {
            run_commissioning_check(
                &runtime.db_path,
                &CommissioningCheckRequest {
                    target: CommissioningCheckTarget::Audio,
                    lighting_bridge_ip: None,
                    lighting_universe: None,
                    audio_send_host: Some(String::from("127.0.0.1")),
                    audio_send_port: Some(send_port),
                    audio_receive_port: Some(19_001),
                },
            )
            .expect("the probe records its status");
        };
        probe(1);
        crate::storage::set_settings_owned(
            &runtime.db_path,
            &[crate::audio::confidence_setting(
                crate::audio::ConsoleConfidence::Aligned,
            )],
        )
        .expect("the confidence should persist");

        probe(1);
        assert_eq!(
            confidence(),
            "aligned",
            "the same address and ports leave the Console as it was"
        );
        probe(2);
        assert_eq!(
            confidence(),
            "unknown",
            "other ports make the Console unknown until a Sync"
        );
    }

    #[test]
    fn audio_probe_passes_in_simulated_input_mode() {
        let _serial = serialize_shared_link();
        // 2026-09 audit remediation, Slice 1: console writes are refused until
        // the audio probe passes, and a test has no TotalMix. Simulated
        // input mode is the honest way through — every audio surface labels
        // the console "test simulation" while it is active — and it must open
        // the same gate the operator faces.
        let test_dir = TestDir::new("commissioning-audio-simulated");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");
        crate::storage::set_settings_owned(
            &runtime.db_path,
            &[(
                String::from("app.audio.metering_source"),
                String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
            )],
        )
        .expect("simulated metering source should persist");

        let snapshot = run_commissioning_check(
            &runtime.db_path,
            &CommissioningCheckRequest {
                target: CommissioningCheckTarget::Audio,
                lighting_bridge_ip: None,
                lighting_universe: None,
                audio_send_host: Some(String::from("127.0.0.1")),
                audio_send_port: Some(7_001),
                audio_receive_port: Some(19_101),
            },
        )
        .expect("audio probe should run in simulated mode");

        let audio_check = snapshot
            .checks
            .iter()
            .find(|check| check.id == AUDIO_CHECK_ID)
            .expect("audio check should be present");
        assert_eq!(audio_check.status, "passed");
        assert!(
            audio_check.message.contains("Simulated audio input mode"),
            "unexpected audio probe message: {}",
            audio_check.message
        );

        let app_settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
            .expect("settings should load");
        let audio = crate::audio::read_audio_snapshot(&app_settings);
        assert_eq!(audio.status, "ready");
        assert!(audio.capabilities.can_edit_mixer_state);
        assert!(audio.capabilities.can_sync);
    }

    // New pages program, Slice 2 review: both lines the probe wrote while
    // Planning was part of the app read as checked before this version; the
    // line it writes now, and any other, is kept word for word.
    #[test]
    fn a_probe_line_about_planning_reads_as_checked_before_this_version() {
        for planning_era in [
            "Planning context is reachable. No projects are loaded yet, so the deck surface would start empty.",
            "Planning context is reachable. Selected project 'Spring season' exposes 3 tasks for operator navigation.",
        ] {
            assert_eq!(
                retire_planning_probe_message(planning_era),
                PROBE_CHECKED_BEFORE_THIS_VERSION
            );
        }
        let current = summarize_control_surface_probe();
        for kept in [
            current.as_str(),
            "Not run yet.",
            "Probe failed. Planning context is reachable.",
        ] {
            assert_eq!(retire_planning_probe_message(kept), kept);
        }
        assert!(!PROBE_CHECKED_BEFORE_THIS_VERSION
            .to_lowercase()
            .contains("planning"));
    }

    // What the audio probe says of each outcome holds the words rule, names
    // the ports as TotalMix does, and tells a request that never went out
    // (the app's own fault) from a TotalMix that did not answer (the review).
    #[test]
    fn the_audio_probes_sentences_hold_the_words_rule_and_tell_the_outcomes_apart() {
        let sentence = |outcome| audio_probe_sentence("10.1.0.20", 7_001, 9_001, outcome);
        let answered = sentence(Ok(ProbeAnswer::Answered)).expect("a pass");
        assert!(
            answered.contains("port incoming 7004 and port outgoing 9004"),
            "{answered}"
        );
        assert!(answered.contains("port incoming 7001–7003 and port outgoing 9001–9003"));
        let unbound = sentence(Ok(ProbeAnswer::SlotUnbound)).expect_err("a failure");
        assert!(unbound.contains("port 9004"), "{unbound}");
        let not_answered =
            sentence(Ok(ProbeAnswer::Unanswered { asked: true })).expect_err("a failure");
        assert!(
            not_answered
                .starts_with("TotalMix at 10.1.0.20 did not answer on remote 4 within 3 s."),
            "{not_answered}"
        );
        let not_asked =
            sentence(Ok(ProbeAnswer::Unanswered { asked: false })).expect_err("a failure");
        assert!(
            not_asked.starts_with(
                "The hardware link did not get to ask TotalMix at 10.1.0.20 within 3 s."
            ),
            "{not_asked}"
        );
        assert!(
            !not_asked.contains("Options"),
            "nothing to set up in TotalMix: {not_asked}"
        );
        let no_loop = sentence(Err(ProbeRefused::NoMetering)).expect_err("a failure");
        let busy = sentence(Err(ProbeRefused::Busy)).expect_err("a failure");
        for text in [
            &answered,
            &unbound,
            &not_answered,
            &not_asked,
            &no_loop,
            &busy,
        ] {
            crate::operator_words::assert_operator_words(text);
        }
    }

    // TotalMix's ports leave room for remotes 2 to 4 above them (the review).
    #[test]
    fn an_audio_probe_with_no_room_for_remote_4_is_refused() {
        let test_dir = TestDir::new("commissioning-audio-port-room");
        let runtime = runtime_for(&test_dir);
        initialize_test_database(&runtime.db_path).expect("database should initialize");
        let error = run_commissioning_check(
            &runtime.db_path,
            &CommissioningCheckRequest {
                target: CommissioningCheckTarget::Audio,
                lighting_bridge_ip: None,
                lighting_universe: None,
                audio_send_host: Some(String::from("127.0.0.1")),
                audio_send_port: Some(65_533),
                audio_receive_port: Some(19_001),
            },
        )
        .expect_err("the port should be refused");
        match error {
            CommissioningCommandError::InvalidParams(message) => assert_eq!(
                message,
                "TotalMix's ports must leave room for remotes 2 to 4 above them: at most 65532."
            ),
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
