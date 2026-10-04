use serde_json::Value;

use super::helpers::*;
use super::types::*;

/// `audio.snapshot.load`: TotalMix's snapshot slot, 1 to 8.
pub fn parse_audio_snapshot_load_request(
    params: &Value,
) -> Result<AudioSnapshotLoadRequest, String> {
    let slot = optional_integer_range(params.get("slot"), "slot", 1, 8)?
        .ok_or_else(|| String::from("slot is required"))?;
    Ok(AudioSnapshotLoadRequest {
        slot: slot as usize,
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
    // The channels take TotalMix's names (2026-10-01): a channel is renamed
    // in TotalMix, and a request that still carries a name is refused rather
    // than half applied.
    if params.get("name").is_some() {
        return Err(String::from(
            "audio.channel.update takes no name: channels are named in TotalMix",
        ));
    }
    let gain = optional_gain(params.get("gain"), "gain")?;
    let fader = optional_level(params.get("fader"), "fader")?;
    let mute = optional_bool(params.get("mute"), "mute")?;
    let solo = optional_bool(params.get("solo"), "solo")?;
    let phantom = optional_bool(params.get("phantom"), "phantom")?;
    let phase = optional_bool(params.get("phase"), "phase")?;
    let pad = optional_bool(params.get("pad"), "pad")?;
    let instrument = optional_bool(params.get("instrument"), "instrument")?;
    let auto_set = optional_bool(params.get("autoSet"), "autoSet")?;

    if gain.is_none()
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

    if volume.is_none() && mute.is_none() && dim.is_none() && mono.is_none() {
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
    let low_cut_enabled = optional_bool(params.get("lowCutEnabled"), "lowCutEnabled")?;
    let low_cut_frequency_hz = optional_number_range(
        params.get("lowCutFrequencyHz"),
        "lowCutFrequencyHz",
        20.0,
        500.0,
    )?;
    let low_cut_slope_db_per_octave = optional_low_cut_slope(params.get("lowCutSlopeDbPerOctave"))?;
    let band_id = optional_enum_string(params.get("bandId"), "bandId", &["1", "2", "3"])?;
    let band_enabled = optional_bool(params.get("bandEnabled"), "bandEnabled")?;
    let band_type = optional_enum_string(
        params.get("bandType"),
        "bandType",
        &["bell", "low-shelf", "high-shelf", "high-pass", "low-pass"],
    )?;
    let frequency_hz =
        optional_number_range(params.get("frequencyHz"), "frequencyHz", 20.0, 20_000.0)?;
    let gain_db = optional_number_range(params.get("gainDb"), "gainDb", -20.0, 20.0)?;
    let q = optional_number_range(params.get("q"), "q", 0.4, 9.9)?;

    if enabled.is_none()
        && low_cut_enabled.is_none()
        && low_cut_frequency_hz.is_none()
        && low_cut_slope_db_per_octave.is_none()
        && band_id.is_none()
        && band_enabled.is_none()
        && band_type.is_none()
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
        low_cut_enabled,
        low_cut_frequency_hz,
        low_cut_slope_db_per_octave,
        band_id,
        band_enabled,
        band_type,
        frequency_hz,
        gain_db,
        q,
    })
}

fn optional_low_cut_slope(value: Option<&Value>) -> Result<Option<i64>, String> {
    match optional_integer_range(value, "lowCutSlopeDbPerOctave", 6, 24)? {
        Some(value @ (6 | 12 | 18 | 24)) => Ok(Some(value)),
        Some(_) => Err(String::from(
            "lowCutSlopeDbPerOctave must be one of: 6, 12, 18, 24",
        )),
        None => Ok(None),
    }
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
