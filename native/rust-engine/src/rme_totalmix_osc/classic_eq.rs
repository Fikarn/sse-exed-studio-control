//! The classic (paged) TotalMix OSC command path: Page 2 EQ and Low Cut
//! edits on the first classic remote, the one command the app still sends
//! over classic OSC. Everything else rides the Global OSC remote
//! (`global_commands.rs`); the classic remotes otherwise serve as the
//! metering fallback. Split out of `rme_totalmix_osc.rs` by remote
//! generation (2026-09 production readiness, Slice 6) under the 2,000-line
//! file-health guard; nothing here changed on the way.

use super::send_osc_messages;
use crate::audio::AudioEqUpdateRequest;
use rosc::OscType;

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

pub(super) fn totalmix_channel_target(channel_id: &str) -> Option<(&'static str, usize)> {
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

pub(super) fn totalmix_eq_parameter_messages(
    request: &AudioEqUpdateRequest,
) -> Vec<(String, OscType)> {
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
