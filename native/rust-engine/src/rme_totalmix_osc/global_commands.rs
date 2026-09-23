//! The Global OSC command path (TotalMix FX 2.1+ remote 4): operator
//! channel and output-mix edits as absolute values on 0-based hardware
//! channel numbering, plus the surface ↔ hardware maps the console link,
//! the sync pull and the recall path share. Split out of
//! `rme_totalmix_osc.rs` by remote generation (2026-09 production readiness,
//! Slice 6) under the 2,000-line file-health guard; nothing here changed on
//! the way.

use super::{send_osc_messages, validated_command_port, GLOBAL_OSC_PORT_OFFSET};
use crate::audio::{AudioChannelSnapshot, AudioChannelUpdateRequest, AudioMixTargetUpdateRequest};
use rosc::OscType;

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
