//! The Companion profile: the file `exports.companion.export` writes
//! (`companion.rs` makes its document), where it is written, and the deck's
//! id it names, which the studio's build asks Companion for.

use super::companion::generate_companion_config;
use crate::bootstrap::RuntimeContext;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const DEFAULT_COMPANION_URL: &str = "http://127.0.0.1:8000";

#[derive(Debug)]
pub enum ExportCommandError {
    InvalidParams(String),
    Storage(String),
}

#[derive(Debug, Serialize)]
pub struct CompanionExportSummary {
    pub path: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "pageCount")]
    pub page_count: usize,
    #[serde(rename = "actionCount")]
    pub action_count: usize,
    #[serde(rename = "triggerCount")]
    pub trigger_count: usize,
    #[serde(rename = "deckSurfaceId")]
    pub deck_surface_id: Option<String>,
}

pub fn export_companion_config(
    runtime: &RuntimeContext,
    base_url_override: Option<&str>,
) -> Result<CompanionExportSummary, ExportCommandError> {
    if !runtime.control_surface_bridge.available {
        return Err(ExportCommandError::InvalidParams(format!(
            "Companion export is unavailable because the native control-surface bridge is not running: {}",
            runtime
                .control_surface_bridge
                .error
                .clone()
                .unwrap_or_else(|| String::from("bridge unavailable"))
        )));
    }

    let export_dir = runtime.app_data_dir.join("exports");
    fs::create_dir_all(&export_dir)
        .map_err(|error| ExportCommandError::Storage(error.to_string()))?;
    let timestamp = current_export_timestamp();
    let file_name = format!("sse-exed-studio-control-native-{timestamp}.companionconfig");
    let path = export_dir.join(&file_name);
    let base_url = base_url_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&runtime.control_surface_bridge.base_url);
    let deck_surface_id = discover_streamdeck_surface_id();
    let config = generate_companion_config(
        base_url,
        deck_surface_id.as_deref(),
        &runtime.control_surface_token,
    );
    let action_count = count_companion_actions(&config);
    let page_count = config
        .get("pages")
        .and_then(Value::as_object)
        .map(|pages| pages.len())
        .unwrap_or(0);
    let trigger_count = config
        .get("triggers")
        .and_then(Value::as_object)
        .map(|triggers| triggers.len())
        .unwrap_or(0);
    let json = serde_json::to_vec_pretty(&config)
        .map_err(|error| ExportCommandError::Storage(error.to_string()))?;
    fs::write(&path, json).map_err(|error| ExportCommandError::Storage(error.to_string()))?;

    Ok(CompanionExportSummary {
        path: path.display().to_string(),
        file_name,
        base_url: String::from(base_url),
        page_count,
        action_count,
        trigger_count,
        deck_surface_id,
    })
}

// Asks the local Companion for its configured surfaces so the page-follow
// triggers can bind to the physical Stream Deck+ instead of "self" (which has
// no meaning in a trigger context). Companion being closed is not an error —
// the export then targets "self" and the operator re-exports with Companion
// running to get surface-bound follow.
//
// A development build asks nobody (2026-09-28): Companion is the studio's,
// and the bridge lane exports a profile at every run of the gate. Its export
// targets "self", as one made with Companion closed does.
fn discover_streamdeck_surface_id() -> Option<String> {
    streamdeck_surface_id_from(
        studio_control_protocol::development::development_build(),
        || fetch_companion_export_json(DEFAULT_COMPANION_URL),
    )
}

pub(super) fn streamdeck_surface_id_from<F>(development_build: bool, fetch: F) -> Option<String>
where
    F: FnOnce() -> Option<String>,
{
    if development_build {
        return None;
    }
    let body = fetch()?;
    let parsed = serde_json::from_str::<Value>(&body).ok()?;
    parsed
        .get("surfaces")
        .and_then(Value::as_object)?
        .keys()
        .find(|key| key.starts_with("streamdeck:"))
        .cloned()
}

fn fetch_companion_export_json(companion_url: &str) -> Option<String> {
    let host_port = companion_url
        .trim()
        .strip_prefix("http://")
        .unwrap_or(companion_url)
        .trim_end_matches('/');
    let host = host_port.split(':').next().unwrap_or("127.0.0.1");
    let stream = TcpStream::connect(host_port).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .ok()?;
    let mut stream = stream;
    // HTTP/1.0 so the server closes the connection instead of chunking.
    stream
        .write_all(
            format!(
                "GET /int/export/full?format=json HTTP/1.0\r\nHost: {host}\r\nAccept: application/json\r\n\r\n"
            )
            .as_bytes(),
        )
        .ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let response = String::from_utf8_lossy(&response);
    let (headers, body) = response.split_once("\r\n\r\n")?;
    if !headers.starts_with("HTTP/1.0 200") && !headers.starts_with("HTTP/1.1 200") {
        return None;
    }
    Some(String::from(body))
}

fn current_export_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    now.to_string()
}

/// The actions the profile's keys and dials send, in all.
fn count_companion_actions(config: &Value) -> usize {
    config
        .get("pages")
        .and_then(Value::as_object)
        .map(|pages| {
            pages
                .values()
                .filter_map(|page| page.get("controls").and_then(Value::as_object))
                .flat_map(|rows| rows.values())
                .filter_map(Value::as_object)
                .flat_map(|columns| columns.values())
                .filter_map(|control| control.get("steps").and_then(Value::as_object))
                .flat_map(|steps| steps.values())
                .filter_map(|step| step.get("action_sets").and_then(Value::as_object))
                .map(|action_sets| {
                    action_sets
                        .values()
                        .filter_map(Value::as_array)
                        .map(Vec::len)
                        .sum::<usize>()
                })
                .sum()
        })
        .unwrap_or(0)
}

/// The most bridge requests the exported profile can have in flight at one
/// instant: its once-a-second poll meeting the page-follow trigger the poll's
/// own answer can set off and the one press or turn that sends the most. The
/// bridge's worker pool is sized to hold them all (`control_surface_http`,
/// `the_pool_holds_the_decks_worst_instant`). Until 2026-10-03 the poll was a
/// request a display, 47 of them, and the largest press 17 (AUDIO's BANK
/// and its displays): 64. Since then the poll is one read of every display,
/// and a press its action and that read again: 3.
#[cfg(test)]
pub(crate) fn deck_worst_instant_requests() -> DeckWorstInstant {
    use super::companion::INSTANCE_ID;
    use serde_json::Map;

    fn bridge_requests(value: &Value) -> usize {
        match value {
            Value::Object(map) => {
                usize::from(map.get("connectionId").and_then(Value::as_str) == Some(INSTANCE_ID))
                    + map.values().map(bridge_requests).sum::<usize>()
            }
            Value::Array(items) => items.iter().map(bridge_requests).sum(),
            _ => 0,
        }
    }
    fn entries(value: &Value) -> impl Iterator<Item = &Value> {
        value.as_object().into_iter().flat_map(Map::values)
    }

    let config = generate_companion_config(
        "http://127.0.0.1:38201",
        Some("streamdeck:TESTSERIAL"),
        "token",
    );
    let poll = entries(&config["triggers"])
        .filter(|trigger| trigger["events"][0]["type"] == "interval")
        .map(|trigger| bridge_requests(&trigger["actions"]))
        .sum();
    let largest_follow = entries(&config["triggers"])
        .filter(|trigger| trigger["events"][0]["type"] != "interval")
        .map(|trigger| bridge_requests(&trigger["actions"]))
        .max()
        .unwrap_or(0);
    let largest_press = entries(&config["pages"])
        .flat_map(|page| entries(&page["controls"]))
        .flat_map(entries)
        .flat_map(|control| entries(&control["steps"]))
        .flat_map(|step| entries(&step["action_sets"]))
        .map(bridge_requests)
        .max()
        .unwrap_or(0);
    DeckWorstInstant {
        poll,
        follow: largest_follow,
        press: largest_press,
    }
}

/// The requests of the deck's worst instant, by what sends them.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DeckWorstInstant {
    /// The once-a-second triggers: the read of every display.
    pub poll: usize,
    /// The other trigger that sends the most.
    pub follow: usize,
    /// The key that sends the most: its action and its read.
    pub press: usize,
}

#[cfg(test)]
impl DeckWorstInstant {
    pub(crate) fn total(self) -> usize {
        self.poll + self.follow + self.press
    }
}
