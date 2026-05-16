use serde_json::Value;

use super::helpers::*;
use super::types::*;

pub fn parse_audio_snapshot_recall_request(
    params: &Value,
) -> Result<AudioSnapshotRecallRequest, String> {
    let snapshot_id = params
        .get("snapshotId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("snapshotId is required"))?;

    Ok(AudioSnapshotRecallRequest {
        snapshot_id: String::from(snapshot_id),
    })
}

pub fn parse_audio_snapshot_create_request(
    params: &Value,
) -> Result<AudioSnapshotCreateRequest, String> {
    let name = optional_trimmed_string(params.get("name"), "name")?
        .map(|value| validate_audio_snapshot_name(value, "name"))
        .transpose()?
        .ok_or_else(|| String::from("name is required"))?;
    let osc_index = optional_integer_range(params.get("oscIndex"), "oscIndex", 0, 7)?
        .ok_or_else(|| String::from("oscIndex is required"))?;
    let capture_current_state =
        optional_bool(params.get("captureCurrentState"), "captureCurrentState")?;

    Ok(AudioSnapshotCreateRequest {
        name,
        osc_index,
        capture_current_state,
    })
}

pub fn parse_audio_snapshot_update_request(
    params: &Value,
) -> Result<AudioSnapshotUpdateRequest, String> {
    let snapshot_id = params
        .get("snapshotId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("snapshotId is required"))?;
    let name = optional_trimmed_string(params.get("name"), "name")?
        .map(|value| validate_audio_snapshot_name(value, "name"))
        .transpose()?;
    let osc_index = optional_integer_range(params.get("oscIndex"), "oscIndex", 0, 7)?;
    let capture_current_state =
        optional_bool(params.get("captureCurrentState"), "captureCurrentState")?;

    if name.is_none() && osc_index.is_none() && capture_current_state.is_none() {
        return Err(String::from(
            "audio.snapshot.update requires one or more supported fields",
        ));
    }

    Ok(AudioSnapshotUpdateRequest {
        snapshot_id: String::from(snapshot_id),
        name,
        osc_index,
        capture_current_state,
    })
}

pub fn parse_audio_snapshot_delete_request(
    params: &Value,
) -> Result<AudioSnapshotDeleteRequest, String> {
    let snapshot_id = params
        .get("snapshotId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("snapshotId is required"))?;

    Ok(AudioSnapshotDeleteRequest {
        snapshot_id: String::from(snapshot_id),
    })
}

pub fn parse_audio_channel_update_request(
    params: &Value,
) -> Result<AudioChannelUpdateRequest, String> {
    let channel_id = params
        .get("channelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("channelId is required"))?;

    let mix_target_id = params
        .get("mixTargetId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);
    let name = optional_trimmed_string(params.get("name"), "name")?
        .map(|value| validate_audio_snapshot_name(value, "name"))
        .transpose()?;
    let gain = optional_gain(params.get("gain"), "gain")?;
    let fader = optional_level(params.get("fader"), "fader")?;
    let mute = optional_bool(params.get("mute"), "mute")?;
    let solo = optional_bool(params.get("solo"), "solo")?;
    let phantom = optional_bool(params.get("phantom"), "phantom")?;
    let phase = optional_bool(params.get("phase"), "phase")?;
    let pad = optional_bool(params.get("pad"), "pad")?;
    let instrument = optional_bool(params.get("instrument"), "instrument")?;
    let auto_set = optional_bool(params.get("autoSet"), "autoSet")?;

    if name.is_none()
        && gain.is_none()
        && fader.is_none()
        && mute.is_none()
        && solo.is_none()
        && phantom.is_none()
        && phase.is_none()
        && pad.is_none()
        && instrument.is_none()
        && auto_set.is_none()
    {
        return Err(String::from(
            "audio.channel.update requires one or more supported fields",
        ));
    }

    Ok(AudioChannelUpdateRequest {
        channel_id: String::from(channel_id),
        mix_target_id,
        name,
        gain,
        fader,
        mute,
        solo,
        phantom,
        phase,
        pad,
        instrument,
        auto_set,
    })
}

pub fn parse_audio_mix_target_update_request(
    params: &Value,
) -> Result<AudioMixTargetUpdateRequest, String> {
    let mix_target_id = params
        .get("mixTargetId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("mixTargetId is required"))?;

    let volume = optional_level(params.get("volume"), "volume")?;
    let mute = optional_bool(params.get("mute"), "mute")?;
    let dim = optional_bool(params.get("dim"), "dim")?;
    let mono = optional_bool(params.get("mono"), "mono")?;
    let talkback = optional_bool(params.get("talkback"), "talkback")?;

    if volume.is_none() && mute.is_none() && dim.is_none() && mono.is_none() && talkback.is_none() {
        return Err(String::from(
            "audio.mixTarget.update requires one or more supported fields",
        ));
    }

    Ok(AudioMixTargetUpdateRequest {
        mix_target_id: String::from(mix_target_id),
        volume,
        mute,
        dim,
        mono,
        talkback,
    })
}

pub fn parse_audio_settings_update_request(
    params: &Value,
) -> Result<AudioSettingsUpdateRequest, String> {
    let osc_enabled = optional_bool(params.get("oscEnabled"), "oscEnabled")?;
    let send_host = optional_trimmed_string(params.get("sendHost"), "sendHost")?;
    let send_port = optional_port(params.get("sendPort"), "sendPort")?;
    let receive_port = optional_port(params.get("receivePort"), "receivePort")?;
    let selected_channel_id =
        optional_nullable_trimmed_string(params.get("selectedChannelId"), "selectedChannelId")?;
    let selected_mix_target_id =
        optional_trimmed_string(params.get("selectedMixTargetId"), "selectedMixTargetId")?;
    let expected_peak_data = optional_bool(params.get("expectedPeakData"), "expectedPeakData")?;
    let expected_submix_lock =
        optional_bool(params.get("expectedSubmixLock"), "expectedSubmixLock")?;
    let expected_compatibility_mode = optional_bool(
        params.get("expectedCompatibilityMode"),
        "expectedCompatibilityMode",
    )?;
    let faders_per_bank =
        optional_integer_range(params.get("fadersPerBank"), "fadersPerBank", 1, 24)?;
    let view_mode =
        optional_enum_string(params.get("viewMode"), "viewMode", &["submix", "master"])?;

    if osc_enabled.is_none()
        && send_host.is_none()
        && send_port.is_none()
        && receive_port.is_none()
        && selected_channel_id.is_none()
        && selected_mix_target_id.is_none()
        && expected_peak_data.is_none()
        && expected_submix_lock.is_none()
        && expected_compatibility_mode.is_none()
        && faders_per_bank.is_none()
        && view_mode.is_none()
    {
        return Err(String::from(
            "audio.settings.update requires one or more supported fields",
        ));
    }

    Ok(AudioSettingsUpdateRequest {
        osc_enabled,
        send_host,
        send_port,
        receive_port,
        selected_channel_id,
        selected_mix_target_id,
        expected_peak_data,
        expected_submix_lock,
        expected_compatibility_mode,
        faders_per_bank,
        view_mode,
    })
}

pub fn parse_audio_clip_clear_request(params: &Value) -> Result<AudioClipClearRequest, String> {
    let channel_id = optional_trimmed_string(params.get("channelId"), "channelId")?;
    Ok(AudioClipClearRequest { channel_id })
}

pub fn parse_audio_eq_update_request(params: &Value) -> Result<AudioEqUpdateRequest, String> {
    let channel_id = required_trimmed_string(params, "channelId")?;
    let enabled = optional_bool(params.get("enabled"), "enabled")?;
    let band_id = optional_enum_string(params.get("bandId"), "bandId", &["lc", "lo", "mid", "hi"])?;
    let band_enabled = optional_bool(params.get("bandEnabled"), "bandEnabled")?;
    let frequency_hz =
        optional_number_range(params.get("frequencyHz"), "frequencyHz", 20.0, 20_000.0)?;
    let gain_db = optional_number_range(params.get("gainDb"), "gainDb", -12.0, 12.0)?;
    let q = optional_number_range(params.get("q"), "q", 0.1, 12.0)?;

    if enabled.is_none()
        && band_id.is_none()
        && band_enabled.is_none()
        && frequency_hz.is_none()
        && gain_db.is_none()
        && q.is_none()
    {
        return Err(String::from(
            "audio.channel.eq.update requires one or more supported fields",
        ));
    }

    Ok(AudioEqUpdateRequest {
        channel_id,
        enabled,
        band_id,
        band_enabled,
        frequency_hz,
        gain_db,
        q,
    })
}

pub fn parse_audio_dynamics_update_request(
    params: &Value,
) -> Result<AudioDynamicsUpdateRequest, String> {
    let channel_id = required_trimmed_string(params, "channelId")?;
    let section = optional_enum_string(params.get("section"), "section", &["compressor", "gate"])?
        .ok_or_else(|| String::from("section is required"))?;
    let enabled = optional_bool(params.get("enabled"), "enabled")?;
    let threshold_db = optional_number_range(params.get("thresholdDb"), "thresholdDb", -80.0, 0.0)?;
    let ratio = optional_number_range(params.get("ratio"), "ratio", 1.0, 20.0)?;
    let attack_ms = optional_number_range(params.get("attackMs"), "attackMs", 0.1, 2000.0)?;
    let release_ms = optional_number_range(params.get("releaseMs"), "releaseMs", 0.1, 2000.0)?;
    let makeup_db = optional_number_range(params.get("makeupDb"), "makeupDb", 0.0, 24.0)?;

    if enabled.is_none()
        && threshold_db.is_none()
        && ratio.is_none()
        && attack_ms.is_none()
        && release_ms.is_none()
        && makeup_db.is_none()
    {
        return Err(String::from(
            "audio.channel.dynamics.update requires one or more supported fields",
        ));
    }

    Ok(AudioDynamicsUpdateRequest {
        channel_id,
        section,
        enabled,
        threshold_db,
        ratio,
        attack_ms,
        release_ms,
        makeup_db,
    })
}

pub fn parse_audio_send_mode_update_request(
    params: &Value,
) -> Result<AudioSendModeUpdateRequest, String> {
    let channel_id = required_trimmed_string(params, "channelId")?;
    let mix_target_id = required_trimmed_string(params, "mixTargetId")?;
    let pre_fader = optional_bool(params.get("preFader"), "preFader")?;
    let mute = optional_bool(params.get("mute"), "mute")?;
    let link_stereo = optional_bool(params.get("linkStereo"), "linkStereo")?;
    let solo = optional_bool(params.get("solo"), "solo")?;

    if pre_fader.is_none() && mute.is_none() && link_stereo.is_none() && solo.is_none() {
        return Err(String::from(
            "audio.channel.send.update requires one or more supported fields",
        ));
    }

    Ok(AudioSendModeUpdateRequest {
        channel_id,
        mix_target_id,
        pre_fader,
        mute,
        link_stereo,
        solo,
    })
}

pub(super) fn optional_level(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<f64>, String> {
    match value {
        Some(raw) => {
            let number = raw
                .as_f64()
                .ok_or_else(|| format!("{field_name} must be a number"))?;
            if !(0.0..=1.0).contains(&number) {
                return Err(format!("{field_name} must be between 0.0 and 1.0"));
            }
            Ok(Some(clamp_level(number)))
        }
        None => Ok(None),
    }
}

pub(super) fn optional_number_range(
    value: Option<&Value>,
    field_name: &str,
    min: f64,
    max: f64,
) -> Result<Option<f64>, String> {
    match value {
        Some(raw) => {
            let number = raw
                .as_f64()
                .ok_or_else(|| format!("{field_name} must be a number"))?;
            if !(min..=max).contains(&number) {
                return Err(format!("{field_name} must be between {min} and {max}"));
            }
            Ok(Some(number.clamp(min, max)))
        }
        None => Ok(None),
    }
}

pub(super) fn required_trimmed_string(params: &Value, field_name: &str) -> Result<String, String> {
    params
        .get(field_name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| format!("{field_name} is required"))
}

pub(super) fn optional_enum_string(
    value: Option<&Value>,
    field_name: &str,
    allowed: &[&str],
) -> Result<Option<String>, String> {
    match value {
        Some(raw) => {
            let parsed = raw
                .as_str()
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .ok_or_else(|| format!("{field_name} must be a non-empty string"))?;
            if allowed.contains(&parsed) {
                Ok(Some(String::from(parsed)))
            } else {
                Err(format!(
                    "{field_name} must be one of: {}",
                    allowed.join(", ")
                ))
            }
        }
        None => Ok(None),
    }
}

pub(super) fn optional_trimmed_string(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<String>, String> {
    match value {
        Some(raw) => {
            let parsed = raw
                .as_str()
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(String::from)
                .ok_or_else(|| format!("{field_name} must be a non-empty string"))?;
            Ok(Some(parsed))
        }
        None => Ok(None),
    }
}

pub(super) fn validate_audio_snapshot_name(
    value: String,
    field_name: &str,
) -> Result<String, String> {
    if value.len() > 50 {
        return Err(format!("{field_name} must be 50 characters or fewer"));
    }
    Ok(value)
}

pub(super) fn optional_nullable_trimmed_string(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<Option<String>>, String> {
    match value {
        Some(Value::Null) => Ok(Some(None)),
        Some(raw) => raw
            .as_str()
            .map(str::trim)
            .map(|entry| {
                if entry.is_empty() {
                    None
                } else {
                    Some(String::from(entry))
                }
            })
            .map(Some)
            .ok_or_else(|| format!("{field_name} must be a string or null")),
        None => Ok(None),
    }
}

pub(super) fn optional_integer_range(
    value: Option<&Value>,
    field_name: &str,
    minimum: i64,
    maximum: i64,
) -> Result<Option<i64>, String> {
    match value {
        Some(raw) => {
            let number = raw
                .as_i64()
                .ok_or_else(|| format!("{field_name} must be an integer"))?;
            if !(minimum..=maximum).contains(&number) {
                return Err(format!(
                    "{field_name} must be between {minimum} and {maximum}"
                ));
            }
            Ok(Some(number))
        }
        None => Ok(None),
    }
}

pub(super) fn optional_port(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<i64>, String> {
    optional_integer_range(value, field_name, 1, 65535)
}

pub(super) fn optional_gain(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<i64>, String> {
    match value {
        Some(raw) => {
            let number = raw
                .as_i64()
                .ok_or_else(|| format!("{field_name} must be an integer"))?;
            if !(0..=75).contains(&number) {
                return Err(format!("{field_name} must be between 0 and 75"));
            }
            Ok(Some(clamp_gain(number)))
        }
        None => Ok(None),
    }
}

pub(super) fn optional_bool(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<bool>, String> {
    match value {
        Some(raw) => raw
            .as_bool()
            .map(Some)
            .ok_or_else(|| format!("{field_name} must be a boolean")),
        None => Ok(None),
    }
}
