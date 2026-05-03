use crate::app_state::{CommissioningSnapshot, APP_SETTINGS_PREFIX};
use crate::bootstrap::RuntimeContext;
use crate::legacy_import::{ImportLegacyError, LegacyImportRequest};
use crate::planning::{read_planning_context, PlanningContextSnapshot};
use crate::planning_settings::PLANNING_SETTINGS_PREFIX;
use crate::shell_settings::{SHELL_SETTINGS_PREFIX, WORKSPACE_KEY};
use crate::storage::{
    import_legacy_db, list_settings_by_prefix, open_connection, set_settings_owned, EngineResult,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::net::{Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

const SAMPLE_LEGACY_DB_JSON: &str = include_str!("../fixtures/commissioning-sample-db.json");

pub const LIGHTING_BRIDGE_IP_KEY: &str = "app.commissioning.lighting.bridge_ip";
pub const LIGHTING_UNIVERSE_KEY: &str = "app.commissioning.lighting.universe";
pub const AUDIO_SEND_HOST_KEY: &str = "app.commissioning.audio.send_host";
pub const AUDIO_SEND_PORT_KEY: &str = "app.commissioning.audio.send_port";
pub const AUDIO_RECEIVE_PORT_KEY: &str = "app.commissioning.audio.receive_port";

pub const CONTROL_SURFACE_CHECK_ID: &str = "control-surface";
pub const LIGHTING_CHECK_ID: &str = "lighting";
pub const AUDIO_CHECK_ID: &str = "audio";

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
    #[serde(rename = "planningProjectCount")]
    pub planning_project_count: usize,
    #[serde(rename = "planningTaskCount")]
    pub planning_task_count: usize,
    #[serde(rename = "sampleSeedAvailable")]
    pub sample_seed_available: bool,
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

#[derive(Debug, Clone)]
pub struct CommissioningSeedRequest {
    pub replace_existing_data: bool,
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

pub fn parse_commissioning_seed_request(
    params: &Value,
) -> Result<CommissioningSeedRequest, String> {
    let replace_existing_data = params
        .get("replaceExistingData")
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| String::from("replaceExistingData must be a boolean"))
        })
        .transpose()?
        .unwrap_or(false);

    Ok(CommissioningSeedRequest {
        replace_existing_data,
    })
}

pub fn read_commissioning_snapshot(db_path: &Path) -> EngineResult<CommissioningSnapshotPayload> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)?;
    let commissioning = CommissioningSnapshot::from_settings(&app_settings);
    let planning_counts = read_planning_counts(db_path)?;

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
    let summary = format!(
        "Stage '{}', {} projects, {} tasks, {} probe records.",
        commissioning.runner_stage,
        planning_counts.0,
        planning_counts.1,
        checks.len()
    );
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
    let readiness_summary = if commissioning.has_completed_setup {
        format!(
            "{} of {} commissioning probes passed. Startup routes directly into the dashboard.",
            completed_checks,
            checks.len()
        )
    } else if planning_counts.0 > 0 || planning_counts.1 > 0 || completed_checks > 0 {
        format!(
            "{} of {} commissioning probes passed. Planning store has {} projects and {} tasks. Startup still routes to the commissioning surface until the engine-owned stage is marked ready.",
            completed_checks,
            checks.len(),
            planning_counts.0,
            planning_counts.1
        )
    } else {
        format!(
            "{} of {} commissioning probes passed. Planning seed is still empty. Startup routes to the commissioning surface until the engine-owned stage is marked ready.",
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
            summary: if planning_counts.0 > 0 {
                String::from("Profile export and sample planning data are ready for commissioning.")
            } else {
                String::from("Export the Companion profile and seed sample planning data before probing hardware.")
            },
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
            summary: if planning_counts.0 > 0 {
                format!(
                    "Review {} projects and {} tasks across the mapped control-surface pages.",
                    planning_counts.0, planning_counts.1
                )
            } else {
                String::from("Review the engine-owned control-surface pages before moving to live verification.")
            },
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
                String::from("Commit setup, export a support backup, and return to Planning.")
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
        readiness_summary,
        planning_project_count: planning_counts.0,
        planning_task_count: planning_counts.1,
        sample_seed_available: true,
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
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;

    let mut updates = Vec::new();
    let connection = open_connection(db_path)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;
    let checked_at = current_timestamp(&connection)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;

    let (check_id, status, message) = match request.target {
        CommissioningCheckTarget::ControlSurface => {
            let context = read_planning_context(db_path, &planning_settings)
                .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;
            (
                CONTROL_SURFACE_CHECK_ID,
                String::from("passed"),
                summarize_control_surface_probe(&context),
            )
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
                    "bridgeIp is required for the lighting probe",
                )));
            }
            if !is_valid_ipv4(&bridge_ip) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "bridgeIp must be a valid IPv4 address",
                )));
            }
            if !(1..=63999).contains(&universe) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "universe must be between 1 and 63999",
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
                        "Bridge probe reached {} on universe {}. Native DMX adapter wiring can build on this endpoint.",
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
                    "sendHost is required for the audio probe",
                )));
            }
            if !is_valid_osc_host(&send_host) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "sendHost must be localhost or a valid IPv4 address",
                )));
            }
            if !is_valid_port(send_port) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "sendPort must be between 1 and 65535",
                )));
            }
            if !is_valid_port(receive_port) {
                return Err(CommissioningCommandError::InvalidParams(String::from(
                    "receivePort must be between 1 and 65535",
                )));
            }

            updates.push((String::from(AUDIO_SEND_HOST_KEY), send_host.clone()));
            updates.push((String::from(AUDIO_SEND_PORT_KEY), send_port.to_string()));
            updates.push((
                String::from(AUDIO_RECEIVE_PORT_KEY),
                receive_port.to_string(),
            ));

            match probe_audio_transport(&send_host, send_port as u16, receive_port as u16) {
                Ok(summary) => (AUDIO_CHECK_ID, String::from("passed"), summary),
                Err(summary) => (AUDIO_CHECK_ID, String::from("failed"), summary),
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

pub fn seed_sample_planning_data(
    runtime: &RuntimeContext,
    request: &CommissioningSeedRequest,
) -> Result<CommissioningSnapshotPayload, CommissioningCommandError> {
    let app_settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;
    let shell_settings = list_settings_by_prefix(&runtime.db_path, SHELL_SETTINGS_PREFIX)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;
    let sample_path = runtime.app_data_dir.join("commissioning-sample-db.json");

    fs::write(&sample_path, SAMPLE_LEGACY_DB_JSON)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;

    import_legacy_db(
        &runtime.db_path,
        &LegacyImportRequest {
            source_path: sample_path.clone(),
            force: request.replace_existing_data,
        },
    )
    .map_err(map_import_error)?;

    let mut restore_settings = app_settings
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Vec<_>>();

    if let Some(workspace) = shell_settings.get(WORKSPACE_KEY) {
        restore_settings.push((String::from(WORKSPACE_KEY), workspace.clone()));
    }

    set_settings_owned(&runtime.db_path, &restore_settings)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))?;

    read_commissioning_snapshot(&runtime.db_path)
        .map_err(|error| CommissioningCommandError::Storage(error.to_string()))
}

fn summarize_control_surface_probe(context: &PlanningContextSnapshot) -> String {
    if context.project_count == 0 {
        return String::from(
            "Planning context is reachable. No projects are loaded yet, so the deck surface would start empty.",
        );
    }

    match &context.selected_project {
        Some(project) => format!(
            "Planning context is reachable. Selected project '{}' exposes {} tasks for operator navigation.",
            project.title, context.task_count
        ),
        None => format!(
            "Planning context is reachable with {} projects in native storage.",
            context.project_count
        ),
    }
}

fn read_planning_counts(db_path: &Path) -> EngineResult<(usize, usize)> {
    let connection = open_connection(db_path)?;
    let project_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))?;
    let task_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))?;
    Ok((project_count.max(0) as usize, task_count.max(0) as usize))
}

fn current_timestamp(connection: &rusqlite::Connection) -> Result<String, rusqlite::Error> {
    connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
        row.get(0)
    })
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

fn map_import_error(error: ImportLegacyError) -> CommissioningCommandError {
    match error {
        ImportLegacyError::ExistingDataRequiresForce => CommissioningCommandError::InvalidParams(
            String::from("Sample planning data already exists. Re-run with replaceExistingData=true to replace it."),
        ),
        other => CommissioningCommandError::Storage(other.to_string()),
    }
}

fn probe_bridge_reachable(ip: &str) -> bool {
    let Some(parsed_ip) = parse_ipv4(ip) else {
        return false;
    };

    let address = SocketAddr::from((parsed_ip, 80));
    match TcpStream::connect_timeout(&address, Duration::from_millis(1500)) {
        Ok(stream) => {
            let _ = stream.shutdown(std::net::Shutdown::Both);
            true
        }
        Err(error) => error.kind() == std::io::ErrorKind::ConnectionRefused,
    }
}

fn probe_audio_transport(host: &str, send_port: u16, receive_port: u16) -> Result<String, String> {
    let send_target = if host == "localhost" {
        format!("127.0.0.1:{send_port}")
    } else {
        format!("{host}:{send_port}")
    };

    let receive_socket = UdpSocket::bind(("0.0.0.0", receive_port)).map_err(|error| {
        format!(
            "Audio OSC probe could not bind receive port {}: {}",
            receive_port, error
        )
    })?;
    drop(receive_socket);

    let send_socket = UdpSocket::bind(("0.0.0.0", 0)).map_err(|error| {
        format!(
            "Audio OSC probe could not allocate a send socket: {}",
            error
        )
    })?;
    send_socket.connect(&send_target).map_err(|error| {
        format!(
            "Audio OSC probe could not target {}: {}",
            send_target, error
        )
    })?;
    let _ = send_socket.send(b"/native/probe");

    Ok(format!(
        "OSC transport config accepted for {} (send {}, receive {}). Live meter verification will attach when the audio adapter lands.",
        host, send_port, receive_port
    ))
}

fn is_valid_ipv4(value: &str) -> bool {
    parse_ipv4(value).is_some()
}

fn parse_ipv4(value: &str) -> Option<Ipv4Addr> {
    Ipv4Addr::from_str(value.trim()).ok()
}

fn is_valid_osc_host(host: &str) -> bool {
    host == "localhost" || is_valid_ipv4(host)
}

fn is_valid_port(port: i64) -> bool {
    (1..=65535).contains(&port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::{
        COMMISSIONING_COMPLETED_KEY, COMMISSIONING_RUNNER_STAGE_KEY, COMMISSIONING_STAGE_KEY,
    };
    use crate::control_surface::ControlSurfaceBridgeInfo;
    use crate::storage::{initialize_database, set_settings};
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

    fn runtime_for(test_dir: &TestDir) -> RuntimeContext {
        RuntimeContext {
            protocol_version: String::from("1"),
            app_data_dir: test_dir.path().to_path_buf(),
            backups_dir: test_dir.path().join("backups"),
            logs_dir: test_dir.path().join("logs"),
            log_file_path: test_dir.path().join("logs").join("engine.log"),
            db_path: test_dir.path().join("native.sqlite3"),
            update_repository_path: None,
            storage_ready: true,
            storage_bootstrap: crate::storage::StorageBootstrap {
                schema_version: 4,
                format_version: String::from("1"),
                journal_mode: String::from("wal"),
                integrity_check: String::from("ok"),
            },
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

    #[test]
    fn commissioning_snapshot_reflects_seeded_planning_counts() {
        let test_dir = TestDir::new("commissioning-snapshot");
        let runtime = runtime_for(&test_dir);
        initialize_database(&runtime.db_path).expect("database should initialize");

        let snapshot = seed_sample_planning_data(
            &runtime,
            &CommissioningSeedRequest {
                replace_existing_data: false,
            },
        )
        .expect("sample seed should succeed");

        assert_eq!(snapshot.planning_project_count, 2);
        assert_eq!(snapshot.planning_task_count, 3);
        assert_eq!(
            snapshot
                .steps
                .iter()
                .find(|step| step.id == "import")
                .map(|step| step.status.as_str()),
            Some("current")
        );
        assert!(snapshot.summary.contains("2 projects"));
        assert!(snapshot.config_summary.contains("Lighting bridge"));
        assert!(snapshot.readiness_summary.contains("Startup still routes"));
    }

    #[test]
    fn control_surface_probe_records_passed_status() {
        let test_dir = TestDir::new("commissioning-control-surface");
        let runtime = runtime_for(&test_dir);
        initialize_database(&runtime.db_path).expect("database should initialize");

        seed_sample_planning_data(
            &runtime,
            &CommissioningSeedRequest {
                replace_existing_data: false,
            },
        )
        .expect("sample seed should succeed");

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
        .expect("control surface probe should succeed");

        assert_eq!(
            snapshot
                .checks
                .iter()
                .find(|check| check.id == CONTROL_SURFACE_CHECK_ID)
                .map(|check| check.status.as_str()),
            Some("passed")
        );
    }

    #[test]
    fn audio_probe_rejects_invalid_host() {
        let test_dir = TestDir::new("commissioning-audio-invalid-host");
        let runtime = runtime_for(&test_dir);
        initialize_database(&runtime.db_path).expect("database should initialize");

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
                    "sendHost must be localhost or a valid IPv4 address"
                );
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn sample_seed_preserves_commissioning_stage_and_workspace() {
        let test_dir = TestDir::new("commissioning-seed-preserve");
        let runtime = runtime_for(&test_dir);
        initialize_database(&runtime.db_path).expect("database should initialize");

        set_settings(
            &runtime.db_path,
            &[
                (COMMISSIONING_STAGE_KEY, String::from("in-progress")),
                (COMMISSIONING_RUNNER_STAGE_KEY, String::from("probe")),
                (COMMISSIONING_COMPLETED_KEY, String::from("false")),
                (WORKSPACE_KEY, String::from("audio")),
            ],
        )
        .expect("pre-seed settings should persist");

        seed_sample_planning_data(
            &runtime,
            &CommissioningSeedRequest {
                replace_existing_data: false,
            },
        )
        .expect("sample seed should succeed");

        let app_settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
            .expect("app settings should load");
        let shell_settings = list_settings_by_prefix(&runtime.db_path, SHELL_SETTINGS_PREFIX)
            .expect("shell settings should load");

        assert_eq!(
            app_settings
                .get(COMMISSIONING_STAGE_KEY)
                .map(String::as_str),
            Some("in-progress")
        );
        assert_eq!(
            app_settings
                .get(COMMISSIONING_RUNNER_STAGE_KEY)
                .map(String::as_str),
            Some("probe")
        );
        assert_eq!(
            shell_settings.get(WORKSPACE_KEY).map(String::as_str),
            Some("audio")
        );
    }
}
