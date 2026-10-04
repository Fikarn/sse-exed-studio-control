use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::commissioning::AUDIO_SEND_HOST_KEY;
use crate::storage::{initialize_test_database, list_settings_by_prefix, set_settings_owned};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(super) struct TestDir {
    path: PathBuf,
}

impl TestDir {
    pub(super) fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "studio-control-engine-audio-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&path).expect("test dir should be created");
        Self { path }
    }

    pub(super) fn db_path(&self) -> PathBuf {
        self.path.join("native.sqlite3")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

// 2026-10-04 (the owner's decision): the per-send modes are gone. They were
// kept in the channels' saved state (`sendModes`) and never reached TotalMix.
// A channel map written with them still reads whole, every other field kept,
// and the field is not written again.
#[test]
fn saved_channel_state_with_the_old_send_modes_still_reads() {
    let mut settings = HashMap::new();
    settings.insert(
        String::from(AUDIO_CHANNEL_STATE_KEY),
        String::from(
            r#"{"audio-input-9":{"gain":41,"mute":true,"phantom":true,"mixLevels":{"audio-mix-main":0.5},"sendModes":{"audio-mix-main":{"preFader":true,"mute":true,"linkStereo":false,"solo":true}}}}"#,
        ),
    );

    let snapshot = read_audio_snapshot(&settings);
    let host = snapshot
        .channels
        .iter()
        .find(|channel| channel.id == "audio-input-9")
        .expect("the first front preamp");
    assert_eq!(host.gain, 41, "the rest of the saved channel is read");
    assert!(host.mute && host.phantom);

    let stored = super::helpers::read_channel_state_map(&settings);
    assert_eq!(stored["audio-input-9"].gain, 41);
    let written = serde_json::to_string(&stored["audio-input-9"]).expect("the state serializes");
    assert!(!written.contains("sendModes"), "{written}");
    let served = serde_json::to_string(host).expect("the snapshot serializes");
    assert!(!served.contains("sendModes"), "{served}");
}

// D26 (2026-09-28): talkback is gone, and what the build before wrote is still
// read. The mix targets' saved state carries a `talkback` field; it is read
// past, and nothing writes it again. The builds before 2026-10-01 kept
// Console snapshots of their own (`app.audio.snapshots_state`): the row stays
// in the saved data and nothing reads it, so the Console lists TotalMix's.
#[test]
fn saved_state_with_the_old_talkback_field_still_reads() {
    let mut settings = HashMap::new();
    settings.insert(
        String::from(AUDIO_MIX_TARGET_STATE_KEY),
        String::from(
            r#"{"audio-mix-main":{"volume":0.61,"mute":true,"dim":true,"mono":false,"talkback":true}}"#,
        ),
    );
    settings.insert(
        String::from("app.audio.snapshots_state"),
        String::from(
            r#"[{"id":"audio-snapshot-1","name":"Panel","oscIndex":0,"order":0,"contents":{"capturedAt":"2026-09-20T10:00:00Z","channels":{},"mixTargets":{"audio-mix-main":{"volume":0.5,"mute":false,"dim":false,"mono":true,"talkback":true}}}}]"#,
        ),
    );

    let snapshot = read_audio_snapshot(&settings);
    let main = snapshot
        .mix_targets
        .iter()
        .find(|target| target.id == "audio-mix-main")
        .expect("the main out");
    assert_eq!(main.volume, 0.61);
    assert!(main.mute && main.dim && !main.mono);

    let written = serde_json::to_string(
        &super::helpers::read_mix_target_state_map(&settings)["audio-mix-main"],
    )
    .expect("the state serializes");
    assert!(!written.contains("talkback"), "{written}");

    let slots = &snapshot.console_snapshots.slots;
    assert_eq!(slots.len(), 8);
    assert!(
        slots
            .iter()
            .all(|slot| slot.name.as_deref() != Some("Panel")),
        "the old build's own snapshot must not be listed: {slots:?}"
    );
}

// The app's own recall went on 2026-10-01. A last action it wrote (the studio
// walk left "Recalled Snapshot 5: … 25 unconfirmed") would describe a recall
// this build cannot make, so it reads as no action, as a talkback refusal does.
#[test]
fn a_saved_recall_message_reads_as_no_action() {
    let saved = HashMap::from([
        (
            String::from(AUDIO_LAST_ACTION_STATUS_KEY),
            String::from("failed"),
        ),
        (
            String::from(AUDIO_LAST_ACTION_CODE_KEY),
            String::from("AUDIO_CONSOLE_UNCONFIRMED"),
        ),
        (
            String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
            String::from(
                "Recalled Snapshot 5: 122 values pushed, 97 confirmed · 25 unconfirmed (…).",
            ),
        ),
    ]);
    let retired = read_audio_snapshot(&saved);
    assert_eq!(retired.last_action_status, "idle");
    assert_eq!(retired.last_action_code, None);
    assert_eq!(retired.last_action_message, None);

    // The same code from an ordinary edit is still the Console's state.
    let mut edit = saved.clone();
    edit.insert(
        String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
        String::from("TotalMix did not confirm input 8 mute."),
    );
    let failed = read_audio_snapshot(&edit);
    assert_eq!(failed.last_action_status, "failed");
    assert_eq!(
        failed.last_action_code.as_deref(),
        Some("AUDIO_CONSOLE_UNCONFIRMED")
    );

    // The old snapshot requests' and the old rename's last actions go too.
    let last = |status: &str, code: &str, message: &str| {
        read_audio_snapshot(&HashMap::from([
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from(status),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::from(code)),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                String::from(message),
            ),
        ]))
    };
    for (status, code, message) in [
        (
            "failed",
            "AUDIO_SNAPSHOT_NOT_FOUND",
            "Snapshot 'x' no longer exists.",
        ),
        (
            "failed",
            "AUDIO_SNAPSHOT_RECALL_FAILED",
            "The push could not send.",
        ),
        (
            "failed",
            "AUDIO_CHANNEL_NAME_INVALID",
            "Audio channel names must be 1-50 characters.",
        ),
        (
            "succeeded",
            "",
            "Audio snapshot 'Talk' was created on slot 6.",
        ),
    ] {
        let retired = last(status, code, message);
        assert_eq!(retired.last_action_status, "idle", "{message}");
        assert_eq!(retired.last_action_message, None, "{message}");
    }
    // A load's own failure for a slot TotalMix named "Recalled …" stays.
    let named = last(
        "failed",
        "AUDIO_SYNC_NO_ECHO",
        "Recalled show was sent to TotalMix; TotalMix did not answer.",
    );
    assert_eq!(named.last_action_status, "failed");
}

// The same build could leave a refused talkback as the Console's last action.
// It must not greet this build with ACTION FAILED over a key it does not have.
#[test]
fn a_saved_talkback_refusal_reads_as_no_action() {
    let refusal = |code: &str| {
        HashMap::from([
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("failed"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::from(code)),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                String::from("TotalMix refused talkback."),
            ),
        ])
    };

    let retired = read_audio_snapshot(&refusal("AUDIO_TALKBACK_REFUSED"));
    assert_eq!(retired.last_action_status, "idle");
    assert_eq!(retired.last_action_code, None);
    assert_eq!(retired.last_action_message, None);
    let never_acted = read_audio_snapshot(&HashMap::new());
    assert_eq!(retired.status, never_acted.status);
    assert_eq!(retired.summary, never_acted.summary);

    // Any other failure is still the Console's state.
    let failed = read_audio_snapshot(&refusal("AUDIO_SYNC_FAILED"));
    assert_eq!(failed.last_action_status, "failed");
    assert_eq!(
        failed.last_action_code.as_deref(),
        Some("AUDIO_SYNC_FAILED")
    );
    assert_eq!(
        failed.last_action_message.as_deref(),
        Some("TotalMix refused talkback.")
    );
}

#[test]
fn audio_snapshot_defaults_to_not_verified() {
    let snapshot = read_audio_snapshot(&HashMap::new());
    assert_eq!(snapshot.status, "not-verified");
    assert!(!snapshot.connected);
    assert!(!snapshot.verified);
    assert_eq!(snapshot.channels.len(), 18);
    assert_eq!(snapshot.mix_targets.len(), 3);
    assert_eq!(snapshot.console_state_confidence, "unknown");
    let slots = &snapshot.console_snapshots.slots;
    assert_eq!(
        slots.iter().map(|slot| slot.slot).collect::<Vec<_>>(),
        (1..=8).collect::<Vec<i64>>()
    );
}

#[test]
fn audio_snapshot_reports_ready_when_probe_passed() {
    let settings = HashMap::from([
        (
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        ),
        (String::from(AUDIO_SEND_HOST_KEY), String::from("127.0.0.1")),
        (
            String::from(AUDIO_METERING_SOURCE_KEY),
            String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
        ),
    ]);

    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.status, "ready");
    assert!(snapshot.connected);
    assert!(snapshot.verified);
    assert_eq!(snapshot.channels.len(), 18);
    assert_eq!(snapshot.mix_targets.len(), 3);
    assert_eq!(snapshot.console_snapshots.slots.len(), 8);
}

#[test]
fn default_audio_eq_uses_totalmix_low_cut_and_three_peq_bands() {
    let eq = default_audio_eq_snapshot();
    assert!(!eq.low_cut.enabled);
    assert_eq!(eq.low_cut.frequency_hz, 80.0);
    assert_eq!(eq.low_cut.slope_db_per_octave, 12);
    assert_eq!(
        eq.bands
            .iter()
            .map(|band| band.id.as_str())
            .collect::<Vec<_>>(),
        vec!["1", "2", "3"]
    );
    assert!(eq.bands.iter().all(|band| band.enabled));
    assert_eq!(eq.bands[2].band_type, "high-shelf");
    assert_eq!(eq.hardware_status, "local");
}

#[test]
fn audio_eq_parser_enforces_totalmix_ranges_and_band_ids() {
    let request = parse_audio_eq_update_request(&serde_json::json!({
        "channelId": "audio-input-9",
        "enabled": true,
        "lowCutEnabled": true,
        "lowCutFrequencyHz": 120.0,
        "lowCutSlopeDbPerOctave": 18,
        "bandId": "1",
        "bandType": "low-shelf",
        "frequencyHz": 240.0,
        "gainDb": -18.0,
        "q": 0.4
    }))
    .expect("RME EQ request should parse");
    assert_eq!(request.band_id.as_deref(), Some("1"));
    assert_eq!(request.band_type.as_deref(), Some("low-shelf"));
    assert_eq!(request.low_cut_slope_db_per_octave, Some(18));

    assert!(parse_audio_eq_update_request(&serde_json::json!({
        "channelId": "audio-input-9",
        "bandId": "lo",
        "frequencyHz": 240.0
    }))
    .is_err());
    assert!(parse_audio_eq_update_request(&serde_json::json!({
        "channelId": "audio-input-9",
        "lowCutSlopeDbPerOctave": 10
    }))
    .is_err());
    assert!(parse_audio_eq_update_request(&serde_json::json!({
        "channelId": "audio-input-9",
        "gainDb": 21.0
    }))
    .is_err());
}

#[test]
fn audio_eq_normalizes_legacy_lc_lo_mid_hi_state() {
    let legacy = AudioEqSnapshot {
        enabled: true,
        low_cut: default_audio_low_cut_snapshot(),
        hardware_status: String::from("unknown"),
        bands: vec![
            AudioEqBandSnapshot {
                id: String::from("lc"),
                label: String::from("LC"),
                enabled: true,
                frequency_hz: 640.0,
                gain_db: 0.0,
                q: 0.7,
                band_type: String::from("low-cut"),
            },
            AudioEqBandSnapshot {
                id: String::from("lo"),
                label: String::from("LO"),
                enabled: true,
                frequency_hz: 180.0,
                gain_db: -16.0,
                q: 0.2,
                band_type: String::from("bell"),
            },
            AudioEqBandSnapshot {
                id: String::from("mid"),
                label: String::from("MID"),
                enabled: true,
                frequency_hz: 1600.0,
                gain_db: 0.0,
                q: 1.2,
                band_type: String::from("bell"),
            },
            AudioEqBandSnapshot {
                id: String::from("hi"),
                label: String::from("HI"),
                enabled: true,
                frequency_hz: 8500.0,
                gain_db: 24.0,
                q: 0.8,
                band_type: String::from("shelf"),
            },
        ],
    };

    let normalized = super::helpers::normalize_audio_eq_snapshot(&legacy);
    assert!(normalized.low_cut.enabled);
    assert_eq!(normalized.low_cut.frequency_hz, 500.0);
    assert_eq!(normalized.hardware_status, "local");
    assert_eq!(normalized.bands[0].id, "1");
    assert_eq!(normalized.bands[0].q, 0.4);
    assert_eq!(normalized.bands[2].id, "3");
    assert!(normalized.bands.iter().all(|band| band.enabled));
    assert_eq!(normalized.bands[2].gain_db, 20.0);
    assert_eq!(normalized.bands[2].band_type, "high-shelf");
}

#[test]
fn simulated_audio_metering_models_inputs_playback_and_mix_outputs() {
    let settings = HashMap::from([
        (
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        ),
        (String::from(AUDIO_SEND_HOST_KEY), String::from("127.0.0.1")),
        (
            String::from(AUDIO_METERING_SOURCE_KEY),
            String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
        ),
    ]);

    let first = read_audio_snapshot(&settings);
    let mut second = first.clone();
    let mut host_meter_changed = false;
    for _ in 0..8 {
        std::thread::sleep(Duration::from_millis(140));
        second = read_audio_snapshot(&settings);
        let first_level = first
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .map(|entry| entry.meter_level)
            .unwrap_or_default();
        let next_level = second
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .map(|entry| entry.meter_level)
            .unwrap_or_default();
        if (first_level - next_level).abs() > 0.0001 {
            host_meter_changed = true;
            break;
        }
    }

    let host_second = second
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("host preamp should be present after refresh");
    assert!(host_meter_changed);
    assert!(!host_second.stereo);
    assert_eq!(host_second.meter_left, host_second.meter_right);
    assert!(host_second.peak_hold >= host_second.meter_level);
    assert_eq!(host_second.peak_hold_left, host_second.peak_hold_right);

    let program = second
        .channels
        .iter()
        .find(|entry| entry.id == "audio-playback-1-2")
        .expect("program playback should be present");
    let fx = second
        .channels
        .iter()
        .find(|entry| entry.id == "audio-playback-3-4")
        .expect("fx playback should be present");
    assert!(program.stereo);
    assert!(fx.stereo);
    assert!((program.meter_left - program.meter_right).abs() > f64::EPSILON);
    assert!((program.meter_level - fx.meter_level).abs() > f64::EPSILON);

    let main_mix = second
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-main")
        .expect("main mix target should be present");
    assert!(main_mix.meter_level > 0.0);
    assert!(main_mix.peak_hold >= main_mix.meter_level);
}

#[test]
fn simulated_audio_metering_uses_professional_ballistics() {
    let settings = HashMap::from([
        (
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        ),
        (String::from(AUDIO_SEND_HOST_KEY), String::from("127.0.0.1")),
        (
            String::from(AUDIO_METERING_SOURCE_KEY),
            String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
        ),
    ]);

    let mut samples = Vec::new();
    for _ in 0..8 {
        let snapshot = read_audio_snapshot(&settings);
        let host = snapshot
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host preamp should be present");
        samples.push((
            host.meter_level,
            host.peak_hold,
            host.peak_hold_left,
            host.peak_hold_right,
            host.clip,
        ));
        std::thread::sleep(Duration::from_millis(90));
    }

    assert!(
        samples
            .windows(2)
            .any(|pair| (pair[0].0 - pair[1].0).abs() > 0.0001),
        "speech body meter should still move between metering ticks"
    );
    for pair in samples.windows(2) {
        assert!(
            (pair[0].0 - pair[1].0).abs() <= 0.18,
            "speech body meter should not make distracting tick-to-tick jumps: {:?}",
            pair
        );
    }
    for (meter_level, peak_hold, peak_hold_left, peak_hold_right, clip) in samples {
        assert!(peak_hold >= meter_level);
        assert!(peak_hold_left >= meter_level);
        assert!(peak_hold_right >= meter_level * 0.84);
        assert!(!clip, "normal speech simulation should avoid clip state");
    }
}

#[test]
fn simulated_stereo_sources_and_outputs_expose_independent_peak_holds() {
    let settings = HashMap::from([
        (
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        ),
        (String::from(AUDIO_SEND_HOST_KEY), String::from("127.0.0.1")),
        (
            String::from(AUDIO_METERING_SOURCE_KEY),
            String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
        ),
    ]);

    let snapshot = read_audio_snapshot(&settings);
    let music = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-playback-7-8")
        .expect("music playback should be present");
    assert!(music.stereo);
    assert!(music.peak_hold_left >= music.meter_left);
    assert!(music.peak_hold_right >= music.meter_right);
    assert!(
        (music.peak_hold_left - music.peak_hold_right).abs() > 0.0001,
        "stereo peak holds should be independently computed"
    );
    assert_eq!(
        music.peak_hold,
        music.peak_hold_left.max(music.peak_hold_right)
    );

    let main_mix = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-main")
        .expect("main mix target should be present");
    assert!(main_mix.peak_hold_left >= main_mix.meter_left);
    assert!(main_mix.peak_hold_right >= main_mix.meter_right);
    assert_eq!(
        main_mix.peak_hold,
        main_mix.peak_hold_left.max(main_mix.peak_hold_right)
    );
}

#[test]
fn simulated_output_submix_uses_totalmix_fader_gain_curve() {
    let mut channels = vec![meter_test_channel(
        "audio-input-9",
        "front-preamp",
        false,
        0.25,
        0.25,
        super::fader_curve::AUDIO_FADER_UNITY,
    )];
    let mut mix_targets = vec![meter_test_mix_target(super::fader_curve::AUDIO_FADER_UNITY)];

    super::snapshot::apply_mix_target_metering(&channels, &mut mix_targets);
    assert_meter_close(mix_targets[0].meter_left, 0.25);
    assert_meter_close(mix_targets[0].meter_right, 0.25);

    // -10 dB on RME's curve (2026-09 audit Slice 5; the old law put it at 0.7).
    let minus_ten_db_position = super::fader_curve::fader_db_to_lin(-10.0);
    channels[0]
        .mix_levels
        .insert(String::from("audio-mix-main"), minus_ten_db_position);
    channels[0].fader = minus_ten_db_position;
    super::snapshot::apply_mix_target_metering(&channels, &mut mix_targets);
    let minus_ten_db_gain = 10.0_f64.powf(-10.0 / 20.0);
    assert_meter_close(mix_targets[0].meter_left, 0.25 * minus_ten_db_gain);
    assert_meter_close(mix_targets[0].meter_right, 0.25 * minus_ten_db_gain);

    mix_targets[0].dim = true;
    super::snapshot::apply_mix_target_metering(&channels, &mut mix_targets);
    assert_meter_close(mix_targets[0].meter_left, 0.25 * minus_ten_db_gain * 0.42);
    assert_meter_close(mix_targets[0].meter_right, 0.25 * minus_ten_db_gain * 0.42);
}

#[test]
fn audio_clip_clear_resets_live_rme_clip_latch() {
    crate::rme_totalmix_osc::with_shared_meter_state_for_test(|shared| {
        let test_dir = TestDir::new("clip-clear-rme-latch");
        initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[
                (
                    String::from("app.commissioning.check.audio.status"),
                    String::from("passed"),
                ),
                (String::from(AUDIO_SEND_HOST_KEY), String::from("127.0.0.1")),
                (
                    String::from(AUDIO_METERING_SOURCE_KEY),
                    String::from(crate::rme_totalmix_osc::RME_TOTALMIX_OSC_SOURCE),
                ),
            ],
        )
        .expect("ready RME audio settings should persist");

        {
            let mut state = shared.lock().expect("shared meter state should lock");
            state.apply_message(
                crate::rme_totalmix_osc::RmeTotalMixBus::Input,
                &rosc::OscMessage {
                    addr: "/1/level1LeftVal".to_string(),
                    args: vec![rosc::OscType::String("0.0 dB".to_string())],
                },
                1_000,
            );
            state.apply_message(
                crate::rme_totalmix_osc::RmeTotalMixBus::Input,
                &rosc::OscMessage {
                    addr: "/1/level1LeftVal".to_string(),
                    args: vec![rosc::OscType::String("-24.0 dB".to_string())],
                },
                1_033,
            );
        }

        let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load");
        let mut latched_snapshot = read_audio_snapshot(&settings);
        shared
            .lock()
            .expect("shared meter state should lock")
            .apply_to_snapshot(&mut latched_snapshot, 1_033);
        assert!(
            latched_snapshot
                .channels
                .iter()
                .find(|channel| channel.id == "audio-input-9")
                .expect("host input should exist")
                .clip,
            "clip should remain latched after the live level falls"
        );

        clear_audio_clips(
            test_dir.db_path().as_path(),
            &AudioClipClearRequest {
                channel_id: Some(String::from("audio-input-9")),
            },
        )
        .expect("clip clear should succeed");

        let mut cleared_snapshot = read_audio_snapshot(&settings);
        shared
            .lock()
            .expect("shared meter state should lock")
            .apply_to_snapshot(&mut cleared_snapshot, 1_034);
        assert!(
            !cleared_snapshot
                .channels
                .iter()
                .find(|channel| channel.id == "audio-input-9")
                .expect("host input should exist")
                .clip,
            "audio.clip.clear should reset the live RME clip latch"
        );
    });
}

fn meter_test_channel(
    id: &str,
    role: &str,
    stereo: bool,
    meter_left: f64,
    meter_right: f64,
    send_level: f64,
) -> AudioChannelSnapshot {
    AudioChannelSnapshot {
        id: String::from(id),
        name: String::from("Test Source"),
        short_name: String::from("SRC"),
        role: String::from(role),
        stereo,
        gain: 0,
        fader: send_level,
        meter_left,
        meter_right,
        meter_level: meter_left.max(meter_right),
        peak_hold: meter_left.max(meter_right),
        peak_hold_left: meter_left,
        peak_hold_right: meter_right,
        clip: false,
        mix_levels: HashMap::from([(String::from("audio-mix-main"), send_level)]),
        mute: false,
        solo: false,
        phantom: false,
        phase: false,
        pad: false,
        instrument: false,
        auto_set: false,
        eq: default_audio_eq_snapshot(),
        dynamics: default_audio_dynamics_snapshot(),
    }
}

fn meter_test_mix_target(volume: f64) -> AudioMixTargetSnapshot {
    AudioMixTargetSnapshot {
        id: String::from("audio-mix-main"),
        name: String::from("Main Out"),
        short_name: String::from("MAIN"),
        role: String::from("main-out"),
        volume,
        meter_left: 0.0,
        meter_right: 0.0,
        meter_level: 0.0,
        peak_hold: 0.0,
        peak_hold_left: 0.0,
        peak_hold_right: 0.0,
        mute: false,
        dim: false,
        mono: false,
    }
}

fn assert_meter_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 0.000_001,
        "expected {actual:.6} to be close to {expected:.6}"
    );
}

#[test]
fn audio_sync_rejects_until_probe_passes_and_records_failure_state() {
    let test_dir = TestDir::new("sync-rejects");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");

    let error = sync_audio_console(test_dir.db_path().as_path()).expect_err("sync should reject");
    match error {
        AudioCommandError::Rejected(code, _) => assert_eq!(code, "AUDIO_NOT_VERIFIED"),
        other => panic!("unexpected error: {other:?}"),
    }

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.last_action_status, "failed");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_NOT_VERIFIED")
    );
}

fn probe_passed_db(label: &str, live_console: bool) -> TestDir {
    let test_dir = TestDir::new(label);
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    let mut settings = vec![(
        String::from("app.commissioning.check.audio.status"),
        String::from("passed"),
    )];
    if !live_console {
        settings.push((
            String::from(AUDIO_METERING_SOURCE_KEY),
            String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
        ));
    }
    set_settings_owned(test_dir.db_path().as_path(), &settings)
        .expect("probe state should persist");
    test_dir
}

fn quick_load() -> LoadTiming {
    LoadTiming {
        report_wait_ms: 50,
        poll_ms: 5,
        pull: PullTiming {
            quiet_ms: 60,
            timeout_ms: 400,
            poll_ms: 5,
        },
    }
}

// TotalMix's own snapshots (2026-10-01): on the simulated console a load sends
// nothing, marks the slot active and leaves the console aligned.
#[test]
fn a_load_on_the_simulated_console_marks_the_slot_and_sends_nothing() {
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    crate::rme_console_link::shared_console_link()
        .lock()
        .expect("the link locks")
        .reset_for_test();
    let test_dir = probe_passed_db("load-simulated", false);

    for studio in [false, true] {
        let loaded = load_audio_console_snapshot_with(
            test_dir.db_path().as_path(),
            &AudioSnapshotLoadRequest { slot: 3 },
            quick_load(),
            studio,
        )
        .expect("a load on the simulated console succeeds in either build");
        assert!(loaded.loaded);
        assert_eq!(loaded.slot, 3);
        assert_eq!(loaded.console_state_confidence, "aligned");
        assert!(!loaded.total_mix_reported);
        assert_eq!(loaded.pulled_values, 0);
        assert!(
            loaded.summary.contains("simulated console"),
            "{}",
            loaded.summary
        );
        assert!(
            !loaded.summary.to_lowercase().contains("snapshot"),
            "{}",
            loaded.summary
        );
    }

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let states: Vec<&str> = snapshot
        .console_snapshots
        .slots
        .iter()
        .map(|slot| slot.state.as_str())
        .collect();
    assert_eq!(states[2], "active", "{states:?}");
    assert!(
        states.iter().filter(|state| **state == "active").count() == 1,
        "{states:?}"
    );
    assert_eq!(snapshot.console_state_confidence, "aligned");
    assert_eq!(
        snapshot.last_console_sync_reason.as_deref(),
        Some("simulated-load")
    );
    assert_eq!(snapshot.last_action_status, "succeeded");
    crate::rme_console_link::shared_console_link()
        .lock()
        .expect("the link locks")
        .reset_for_test();
}

// Only a studio build loads a mix on a real console: a development build on
// the live console refuses before anything leaves.
#[test]
fn a_development_build_never_loads_a_mix_in_totalmix() {
    // Changing the TotalMix address forgets the slot states on the
    // process-wide console link, so this runs one at a time with the tests
    // that read them.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("load-development");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    // Pointing the transport at the receiver resets the probe, so it passes after.
    let receiver = bind_console_probe_receiver(test_dir.db_path().as_path());
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let error = load_audio_console_snapshot_with(
        test_dir.db_path().as_path(),
        &AudioSnapshotLoadRequest { slot: 1 },
        quick_load(),
        false,
    )
    .expect_err("a development build refuses the load");
    match error {
        AudioCommandError::Rejected(code, message) => {
            assert_eq!(code, "AUDIO_SNAPSHOT_LOAD_STUDIO_ONLY");
            assert!(!message.to_lowercase().contains("snapshot"), "{message}");
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert_no_console_datagram(&receiver, "a development build's load");
    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    assert_eq!(
        read_audio_snapshot(&settings).last_action_code.as_deref(),
        Some("AUDIO_SNAPSHOT_LOAD_STUDIO_ONLY")
    );
}

// A load writes to the desk, so it waits for the probe like any console write.
#[test]
fn a_load_waits_for_the_audio_probe() {
    // Changing the TotalMix address forgets the slot states on the
    // process-wide console link, so this runs one at a time with the tests
    // that read them.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("load-not-verified");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    let receiver = bind_console_probe_receiver(test_dir.db_path().as_path());

    let error = load_audio_console_snapshot_with(
        test_dir.db_path().as_path(),
        &AudioSnapshotLoadRequest { slot: 2 },
        quick_load(),
        true,
    )
    .expect_err("the load is refused before the probe passed");
    match error {
        AudioCommandError::Rejected(code, _) => assert_eq!(code, "AUDIO_NOT_VERIFIED"),
        other => panic!("unexpected error: {other:?}"),
    }
    assert_no_console_datagram(&receiver, "a load before the probe");
}

#[test]
fn a_load_takes_slots_one_to_eight_only() {
    for slot in [1, 8] {
        let parsed = parse_audio_snapshot_load_request(&serde_json::json!({ "slot": slot }))
            .expect("slots 1 to 8 parse");
        assert_eq!(parsed.slot, slot as usize);
    }
    for params in [
        serde_json::json!({ "slot": 0 }),
        serde_json::json!({ "slot": 9 }),
        serde_json::json!({ "slot": "3" }),
        serde_json::json!({ "slot": 2.5 }),
        serde_json::json!({}),
    ] {
        assert!(
            parse_audio_snapshot_load_request(&params).is_err(),
            "{params} must be refused"
        );
    }
    let test_dir = probe_passed_db("load-slot-nine", false);
    assert!(matches!(
        load_audio_console_snapshot_with(
            test_dir.db_path().as_path(),
            &AudioSnapshotLoadRequest { slot: 9 },
            quick_load(),
            true,
        ),
        Err(AudioCommandError::Rejected(
            "AUDIO_SNAPSHOT_SLOT_INVALID",
            _
        ))
    ));
}

#[test]
fn audio_channel_update_persists_front_preamp_controls() {
    // Registers sends on the process-wide console link, so it runs one at a
    // time with the tests that push, pull or read back through it.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("channel-front-preamp");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let updated = update_audio_channel(
        test_dir.db_path().as_path(),
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-9"),
            mix_target_id: None,
            gain: Some(41),
            fader: None,
            mute: None,
            solo: Some(true),
            phantom: Some(true),
            phase: Some(true),
            pad: None,
            instrument: Some(true),
            auto_set: Some(true),
        },
    )
    .expect("front preamp update should succeed");

    assert_eq!(updated.id, "audio-input-9");
    assert_eq!(updated.gain, 41);
    assert!(updated.solo);
    assert!(updated.phantom);
    assert!(updated.phase);
    assert!(!updated.pad);
    assert!(updated.instrument);
    assert!(updated.auto_set);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let refreshed = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("updated channel should be present");
    assert_eq!(refreshed.gain, 41);
    assert!(refreshed.phantom);
    assert!(refreshed.phase);
    assert!(!refreshed.pad);
    assert!(refreshed.instrument);
    assert!(refreshed.auto_set);
    assert_eq!(snapshot.last_action_status, "succeeded");
    // 2026-09 audit remediation, Slice 1: an edit is a UDP send, not a
    // confirmation, so it must never move console-state confidence. The old
    // assertion ("aligned") encoded the finding.
    assert_eq!(snapshot.console_state_confidence, "unknown");
}

/// Binds a loopback receiver on the Global OSC slot (`send_port + 3`) and
/// points the audio transport at it, so a test can prove whether a command put
/// anything on the wire. Pair every "nothing was sent" assertion with a
/// positive control through the same receiver.
fn bind_console_probe_receiver(db_path: &std::path::Path) -> std::net::UdpSocket {
    let receiver = std::net::UdpSocket::bind("127.0.0.1:0").expect("loopback receiver should bind");
    receiver
        .set_read_timeout(Some(std::time::Duration::from_millis(250)))
        .expect("read timeout should apply");
    let slot_port = i64::from(receiver.local_addr().expect("local addr").port());
    update_audio_settings(
        db_path,
        &AudioSettingsUpdateRequest {
            osc_enabled: None,
            send_host: Some(String::from("127.0.0.1")),
            send_port: Some(slot_port - 3),
            receive_port: None,
            selected_channel_id: None,
            selected_mix_target_id: None,
            expected_peak_data: None,
            expected_submix_lock: None,
            expected_compatibility_mode: None,
            faders_per_bank: None,
            view_mode: None,
        },
    )
    .expect("transport settings should persist");
    receiver
}

fn assert_no_console_datagram(receiver: &std::net::UdpSocket, context: &str) {
    let mut buffer = [0u8; 2048];
    match receiver.recv_from(&mut buffer) {
        Ok((len, _)) => panic!("{context}: expected no OSC datagram but received {len} bytes"),
        Err(error) => assert!(
            matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ),
            "{context}: unexpected receive error: {error}"
        ),
    }
}

fn assert_console_datagram_received(receiver: &std::net::UdpSocket, context: &str) {
    let mut buffer = [0u8; 2048];
    let (len, _) = receiver
        .recv_from(&mut buffer)
        .unwrap_or_else(|error| panic!("{context}: expected an OSC datagram: {error}"));
    assert!(len > 0, "{context}: datagram should carry an OSC payload");
}

#[test]
fn clear_all_audio_solo_returns_full_snapshot_and_is_idempotent() {
    // Registers sends on the process-wide console link, so it runs one at a
    // time with the tests that push, pull or read back through it.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("clear-all-solo");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    // Solo is a console write, so this test now runs under the same gate the
    // operator faces (Slice 1); before it passed without any probe state.
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    for channel_id in ["audio-input-9", "audio-playback-3-4"] {
        update_audio_channel(
            test_dir.db_path().as_path(),
            &AudioChannelUpdateRequest {
                auto_set: None,
                channel_id: String::from(channel_id),
                fader: None,
                gain: None,
                instrument: None,
                mix_target_id: None,
                mute: None,
                pad: None,
                phantom: None,
                phase: None,
                solo: Some(true),
            },
        )
        .expect("solo setup should succeed");
    }

    let cleared =
        clear_all_audio_solo(test_dir.db_path().as_path()).expect("clear all solo should succeed");
    assert!(cleared.channels.iter().all(|entry| !entry.solo));
    assert_eq!(cleared.last_action_status, "succeeded");
    // Clearing solos sends OSC but confirms nothing; confidence stays put.
    assert_eq!(cleared.console_state_confidence, "unknown");

    let idempotent = clear_all_audio_solo(test_dir.db_path().as_path())
        .expect("idempotent clear all solo should succeed");
    assert!(idempotent.channels.iter().all(|entry| !entry.solo));
    assert_eq!(
        idempotent.last_action_message.as_deref(),
        Some("No soloed audio channels to clear.")
    );
}

// 2026-09 audit remediation, Slice 1 (operator decision 5: match the deck).
// Replaces `audio_channel_update_succeeds_before_probe_passes`, which asserted
// that an unverified console link accepted a hardware write and then marked
// the console "aligned" — the exact behaviour the audit flagged.
#[test]
fn audio_channel_update_is_refused_before_probe_passes() {
    // Registers sends on the process-wide console link, so it runs one at a
    // time with the tests that push, pull or read back through it.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("channel-not-verified");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    let receiver = bind_console_probe_receiver(test_dir.db_path().as_path());
    let before = read_audio_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    )
    .channels
    .into_iter()
    .find(|entry| entry.id == "audio-input-9")
    .expect("channel should be present");
    let request = AudioChannelUpdateRequest {
        channel_id: String::from("audio-input-9"),
        mix_target_id: None,
        gain: Some(before.gain + 7),
        fader: None,
        mute: Some(!before.mute),
        solo: None,
        phantom: Some(!before.phantom),
        phase: Some(!before.phase),
        pad: None,
        instrument: Some(!before.instrument),
        auto_set: Some(!before.auto_set),
    };

    let error = update_audio_channel(test_dir.db_path().as_path(), &request)
        .expect_err("hardware-facing channel update must be refused before the probe passes");
    match error {
        AudioCommandError::Rejected(code, message) => {
            assert_eq!(code, "AUDIO_NOT_VERIFIED");
            assert!(
                message.contains("Run the audio probe"),
                "refusal should tell the operator what to do: {message}"
            );
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert_no_console_datagram(&receiver, "refused channel update");

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let untouched = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("channel should be present");
    assert_eq!(
        untouched.gain, before.gain,
        "state must not change on refusal"
    );
    assert_eq!(untouched.mute, before.mute);
    assert_eq!(untouched.phantom, before.phantom);
    assert_eq!(untouched.phase, before.phase);
    assert_eq!(untouched.instrument, before.instrument);
    assert_eq!(untouched.auto_set, before.auto_set);
    assert_eq!(snapshot.status, "not-verified");
    assert_eq!(snapshot.last_action_status, "failed");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_NOT_VERIFIED")
    );
    assert_eq!(snapshot.console_state_confidence, "unknown");

    // Positive control: the same request goes through (and reaches the wire)
    // once the probe has passed, which proves the receiver would have seen a
    // datagram above.
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");
    let updated = update_audio_channel(test_dir.db_path().as_path(), &request)
        .expect("channel update should succeed once the probe passed");
    assert_eq!(updated.gain, before.gain + 7);
    assert_eq!(updated.mute, !before.mute);
    assert_eq!(updated.phantom, !before.phantom);
    assert_console_datagram_received(&receiver, "allowed channel update");
}

// The channels take TotalMix's names (2026-10-01): a request that still names
// a channel is refused whole, never half applied.
#[test]
fn a_channel_update_that_names_the_channel_is_refused() {
    for params in [
        serde_json::json!({ "channelId": "audio-input-9", "name": "Guest Mic" }),
        serde_json::json!({ "channelId": "audio-input-9", "name": "Guest Mic", "mute": true }),
    ] {
        let error = parse_audio_channel_update_request(&params).expect_err("a name is refused");
        assert!(error.contains("TotalMix"), "{error}");
    }
}

#[test]
fn audio_channel_update_validates_before_sending() {
    // Registers sends on the process-wide console link, so it runs one at a
    // time with the tests that push, pull or read back through it.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("channel-validate-first");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    // Bind (which re-points the transport and therefore resets the probe
    // state) before marking the probe as passed.
    let receiver = bind_console_probe_receiver(test_dir.db_path().as_path());
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    // One request carrying an unsupported field (playback gain) and a valid
    // one (mute): the whole request is rejected and nothing reaches the
    // console, so the mute can never half-apply.
    let error = update_audio_channel(
        test_dir.db_path().as_path(),
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-playback-1-2"),
            mix_target_id: None,
            gain: Some(12),
            fader: None,
            mute: Some(true),
            solo: None,
            phantom: None,
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        },
    )
    .expect_err("mixed valid/unsupported request must be rejected as a whole");
    match error {
        AudioCommandError::Rejected(code, _) => assert_eq!(code, "AUDIO_CHANNEL_FIELD_UNSUPPORTED"),
        other => panic!("unexpected error: {other:?}"),
    }
    assert_no_console_datagram(&receiver, "rejected mixed request");

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let untouched = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-playback-1-2")
        .expect("playback channel should be present");
    assert!(!untouched.mute, "the valid half must not have applied");

    // Positive control through the same receiver.
    update_audio_channel(
        test_dir.db_path().as_path(),
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-playback-1-2"),
            mix_target_id: None,
            gain: None,
            fader: None,
            mute: Some(true),
            solo: None,
            phantom: None,
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        },
    )
    .expect("a valid mute-only update should send");
    assert_console_datagram_received(&receiver, "valid mute update");
}

#[test]
fn audio_channel_update_rejects_unsupported_gain_controls() {
    let test_dir = TestDir::new("channel-unsupported-field");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let error = update_audio_channel(
        test_dir.db_path().as_path(),
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-playback-1-2"),
            mix_target_id: None,
            gain: Some(12),
            fader: None,
            mute: None,
            solo: None,
            phantom: None,
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        },
    )
    .expect_err("playback gain should be rejected");

    match error {
        AudioCommandError::Rejected(code, message) => {
            assert_eq!(code, "AUDIO_CHANNEL_FIELD_UNSUPPORTED");
            assert!(message.contains("has no preamp gain"));
        }
        other => panic!("unexpected error: {other:?}"),
    }

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.last_action_status, "failed");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_CHANNEL_FIELD_UNSUPPORTED")
    );
}

// Twin of `audio_channel_update_is_refused_before_probe_passes` for the
// control-room path (replaces `audio_mix_target_update_succeeds_before_probe_passes`).
#[test]
fn audio_mix_target_update_is_refused_before_probe_passes() {
    // Registers sends on the process-wide console link, so it runs one at a
    // time with the tests that push, pull or read back through it.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("mix-target-not-verified");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    let receiver = bind_console_probe_receiver(test_dir.db_path().as_path());
    let request = AudioMixTargetUpdateRequest {
        mix_target_id: String::from("audio-mix-main"),
        volume: Some(0.81),
        mute: Some(true),
        dim: Some(true),
        mono: Some(true),
    };

    let error = update_audio_mix_target(test_dir.db_path().as_path(), &request)
        .expect_err("mix target update must be refused before the probe passes");
    match error {
        AudioCommandError::Rejected(code, message) => {
            assert_eq!(code, "AUDIO_NOT_VERIFIED");
            assert!(message.contains("Run the audio probe"));
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert_no_console_datagram(&receiver, "refused mix target update");

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let untouched = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-main")
        .expect("mix target should be present");
    assert_ne!(untouched.volume, 0.81);
    assert!(!untouched.mute);
    assert!(!untouched.dim);
    assert!(!untouched.mono);
    assert_eq!(snapshot.status, "not-verified");
    assert_eq!(snapshot.last_action_status, "failed");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_NOT_VERIFIED")
    );
    assert_eq!(snapshot.console_state_confidence, "unknown");

    // Positive control once the probe has passed.
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");
    let updated = update_audio_mix_target(test_dir.db_path().as_path(), &request)
        .expect("mix target update should succeed once the probe passed");
    assert_eq!(updated.volume, 0.81);
    assert!(updated.mono);
    assert_console_datagram_received(&receiver, "allowed mix target update");

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.last_action_status, "succeeded");
    // A send is not a confirmation: confidence stays where it was.
    assert_eq!(snapshot.console_state_confidence, "unknown");
}

#[test]
fn audio_settings_update_persists_selection_and_checklist_flags() {
    let test_dir = TestDir::new("settings-update");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let snapshot = update_audio_settings(
        test_dir.db_path().as_path(),
        &AudioSettingsUpdateRequest {
            osc_enabled: None,
            send_host: None,
            send_port: None,
            receive_port: None,
            selected_channel_id: Some(Some(String::from("audio-playback-1-2"))),
            selected_mix_target_id: Some(String::from("audio-mix-phones-a")),
            expected_peak_data: Some(false),
            expected_submix_lock: Some(false),
            expected_compatibility_mode: Some(true),
            faders_per_bank: Some(8),
            view_mode: Some(String::from("master")),
        },
    )
    .expect("settings update should succeed");

    assert_eq!(
        snapshot.selected_channel_id.as_deref(),
        Some("audio-playback-1-2")
    );
    assert_eq!(snapshot.selected_mix_target_id, "audio-mix-phones-a");
    assert!(!snapshot.expected_peak_data);
    assert!(!snapshot.expected_submix_lock);
    assert!(snapshot.expected_compatibility_mode);
    assert_eq!(snapshot.faders_per_bank, 8);
    assert_eq!(snapshot.view_mode, "master");
    assert_eq!(snapshot.last_action_status, "succeeded");
}

#[test]
fn audio_settings_update_resets_probe_when_transport_changes() {
    // Changing the TotalMix address forgets the slot states on the
    // process-wide console link, so this runs one at a time with the tests
    // that read them.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // TotalMix's slot states belong to the desk the link heard.
    crate::rme_console_link::shared_console_link()
        .lock()
        .expect("the link locks")
        .mark_snapshot_loaded(2);
    let test_dir = TestDir::new("settings-transport-reset");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from("app.commissioning.check.audio.status"),
                String::from("passed"),
            ),
            (
                String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
                String::from("aligned"),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY),
                String::from("2026-01-01T00:00:00Z"),
            ),
        ],
    )
    .expect("audio state should persist");

    let snapshot = update_audio_settings(
        test_dir.db_path().as_path(),
        &AudioSettingsUpdateRequest {
            osc_enabled: Some(false),
            send_host: Some(String::from("127.0.0.2")),
            send_port: Some(7002),
            receive_port: Some(9002),
            selected_channel_id: None,
            selected_mix_target_id: None,
            expected_peak_data: None,
            expected_submix_lock: None,
            expected_compatibility_mode: None,
            faders_per_bank: None,
            view_mode: None,
        },
    )
    .expect("transport settings update should succeed");

    assert!(!snapshot.osc_enabled);
    assert_eq!(snapshot.status, "not-verified");
    assert!(!snapshot.connected);
    assert!(!snapshot.verified);
    assert_eq!(snapshot.metering_state, "disabled");
    assert_eq!(snapshot.console_state_confidence, "unknown");
    assert!(
        snapshot
            .console_snapshots
            .slots
            .iter()
            .all(|slot| slot.state == "unknown"),
        "another address may be another desk: {:?}",
        snapshot.console_snapshots.slots
    );
    assert!(snapshot.last_console_sync_at.is_none());

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    assert_eq!(
        settings
            .get("app.commissioning.check.audio.status")
            .map(String::as_str),
        Some("idle")
    );
}

// plan PR 7 / workstream E3: gain-reduction (GR) meter closure guard.
//
// 2026-05-21 closure (logged in docs/plans/slice-4-deferred.md): TotalMix
// OSC structurally does not expose gain-reduction. The plan flagged this
// as a class-of-regression risk — a future agent might silently re-attempt
// GR work and the suite would not catch the re-introduction. This test
// asserts that no `gain_reduction` or `gr_meter` symbol creeps back into
// the OSC adapter source, and that no such field appears in the public
// meter snapshot types. Re-open the GR work ONLY with a new architecture
// decision logged in docs/plans/.

const RME_TOTALMIX_OSC_SOURCE: &str = include_str!("../rme_totalmix_osc.rs");
const AUDIO_TYPES_SOURCE: &str = include_str!("./types.rs");
const AUDIO_PARSE_SOURCE: &str = include_str!("./parse.rs");

#[test]
fn gain_reduction_remains_unsupported_by_rme_totalmix_osc() {
    let forbidden = [
        "gain_reduction",
        "gr_meter",
        "gainReduction",
        "grMeter",
        "/gr/",
    ];
    let mut hits: Vec<String> = Vec::new();
    for source in [
        RME_TOTALMIX_OSC_SOURCE,
        AUDIO_TYPES_SOURCE,
        AUDIO_PARSE_SOURCE,
    ] {
        for token in forbidden {
            if source.contains(token) {
                hits.push(token.to_string());
            }
        }
    }
    assert!(
        hits.is_empty(),
        "Found {} gain-reduction symbol(s) in the RME OSC adapter / audio types: {:?}.
\
         The GR-meter closure (2026-05-21, slice-4-deferred.md) is binding: TotalMix OSC \
         structurally does not expose GR. Re-open the closure with a new architecture \
         decision before reintroducing these symbols.",
        hits.len(),
        hits
    );
}

// 2026-09-23 (a finding recorded under `919047b`): `fader` is a channel's Main
// Out level and `mix_levels` holds every output's; the console link and Sync
// write `fader` for Main alone. A fader edit aimed at a phones mix wrote the
// phones level into `fader` as well, so the channel's main fader showed
// whichever of the two was written last.
#[test]
fn a_phones_fader_edit_leaves_the_main_fader_alone() {
    // Registers sends on the process-wide console link, so it runs one at a
    // time with the tests that push, pull or read back through it.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("channel-phones-fader");
    let db_path = test_dir.db_path();
    initialize_test_database(db_path.as_path()).expect("database should initialize");
    set_settings_owned(
        db_path.as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");
    let settings = list_settings_by_prefix(db_path.as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let before = read_audio_snapshot(&settings)
        .channels
        .into_iter()
        .find(|entry| entry.id == "audio-playback-7-8")
        .expect("playback 7/8 should be present");
    let fader_edit = |mix_target_id: Option<&str>, level: f64| AudioChannelUpdateRequest {
        channel_id: String::from("audio-playback-7-8"),
        mix_target_id: mix_target_id.map(String::from),
        gain: None,
        fader: Some(level),
        mute: None,
        solo: None,
        phantom: None,
        phase: None,
        pad: None,
        instrument: None,
        auto_set: None,
    };
    let phones_level = if (before.fader - 0.3).abs() < 1e-6 {
        0.35
    } else {
        0.3
    };

    let updated = update_audio_channel(
        db_path.as_path(),
        &fader_edit(Some("audio-mix-phones-b"), phones_level),
    )
    .expect("a phones fader edit should succeed");
    assert_eq!(
        updated.fader, before.fader,
        "the main fader is Main Out's level"
    );
    assert_eq!(
        updated.mix_levels.get("audio-mix-phones-b").copied(),
        Some(phones_level)
    );

    // A Main edit writes both.
    let updated = update_audio_channel(db_path.as_path(), &fader_edit(None, 0.5))
        .expect("a main fader edit should succeed");
    assert_eq!(updated.fader, 0.5);
    assert_eq!(updated.mix_levels.get("audio-mix-main").copied(), Some(0.5));
    assert_eq!(
        updated.mix_levels.get("audio-mix-phones-b").copied(),
        Some(phones_level)
    );
}

// 2026-09-23 (a finding recorded under `919047b`): every channel edit reads,
// changes and writes the stored channel map under `AUDIO_STATE_LOCK`, which the
// console flush on the metering thread holds while it writes what the desk
// reported. The dynamics and send-mode edits and the clip clear did not take
// it, so a flush committed between their read and their write was undone. The lock is held
// here on the test's thread; each edit, run on a second one, must wait for it.
// (The send-mode edit went on 2026-10-04 with the send modes.)
#[test]
fn dynamics_and_clip_edits_wait_for_the_audio_state_lock() {
    let test_dir = TestDir::new("channel-edits-take-the-lock");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    for edit in ["dynamics", "clip clear"] {
        let guard = super::helpers::lock_audio_state();
        let (sender, receiver) = std::sync::mpsc::channel();
        let db_path = test_dir.db_path();
        let worker = std::thread::spawn(move || {
            let outcome = if edit == "dynamics" {
                update_audio_channel_dynamics(
                    db_path.as_path(),
                    &AudioDynamicsUpdateRequest {
                        channel_id: String::from("audio-input-9"),
                        section: String::from("compressor"),
                        enabled: Some(true),
                        threshold_db: Some(-18.0),
                        ratio: None,
                        attack_ms: None,
                        release_ms: None,
                        makeup_db: None,
                    },
                )
                .map(|_| ())
            } else {
                clear_audio_clips(
                    db_path.as_path(),
                    &AudioClipClearRequest {
                        channel_id: Some(String::from("audio-input-9")),
                    },
                )
                .map(|_| ())
            };
            let _ = sender.send(outcome.is_ok());
        });
        let early = receiver.recv_timeout(Duration::from_millis(300));
        drop(guard);
        assert!(
            early.is_err(),
            "the {edit} edit went ahead while the audio state lock was held"
        );
        assert!(
            receiver
                .recv_timeout(Duration::from_secs(10))
                .expect("the edit should finish once the lock is free"),
            "the {edit} edit should succeed"
        );
        worker.join().expect("the edit's thread should finish");
    }
}
