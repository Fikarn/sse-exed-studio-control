//! The RME TotalMix OSC module's tests: the classic and Global OSC meter
//! paths, the command senders, the console-link service and — since the
//! 2026-09 production readiness Slice 6 — the ingress rule (loopback bind,
//! console-only sources). Split out of `rme_totalmix_osc.rs` under the
//! 2,000-line file-health guard, as `storage/tests.rs` was in Slice 3.

use super::classic_eq::{totalmix_channel_target, totalmix_eq_parameter_messages};
use super::*;
use crate::audio::{AudioChannelUpdateRequest, AudioEqUpdateRequest, AudioMixTargetUpdateRequest};
use crate::audio_backend::{read_default_audio_inventory, AudioBackendConfig};
use rosc::{OscBundle, OscMessage, OscTime, OscType};
use std::fs;

const LOOPBACK: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);
const LAN_CONSOLE: IpAddr = IpAddr::V4(Ipv4Addr::new(10, 1, 0, 50));

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
        (payload["rmsLeftDbfs"].as_f64().unwrap() - normalized_to_payload_dbfs(0.25)).abs() < 0.001
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

    let count = super::send_totalmix_eq_update("127.0.0.1", port as i64, "audio-input-9", &request)
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
        console: LOOPBACK,
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
        console: LOOPBACK,
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
        if let Ok((_, OscPacket::Message(message))) = rosc::decoder::decode_udp(&buffer[..read]) {
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
    super::read_global_packets(
        &mut slot,
        &state,
        monotonic_now_ms(),
        &mut DroppedSourceLog::new(None),
    );

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
    let report =
        super::send_totalmix_channel_update("127.0.0.1", i64::from(port) - 3, channel, &request)
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
        console: LOOPBACK,
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
    let report = super::send_totalmix_channel_update("127.0.0.1", base_port, playback, &request)
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

    let report =
        super::send_totalmix_mix_target_update("127.0.0.1", base_port, "audio-mix-main", &request)
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

// ---------------------------------------------------------------------------
// OSC ingress (2026-09 production readiness, Slice 6 — finding F05): the
// receive ports bind loopback for a loopback console and read datagrams from
// the console's own address only; anything else is dropped and noted in the
// engine log once a minute per source.
// ---------------------------------------------------------------------------

fn temp_log_path(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sse-osc-ingress-{}-{name}", std::process::id()));
    fs::create_dir_all(&dir).expect("temp dir should exist");
    let path = dir.join("engine.log");
    let _ = fs::remove_file(&path);
    path
}

fn remove_temp_log(path: &std::path::Path) {
    if let Some(dir) = path.parent() {
        let _ = fs::remove_dir_all(dir);
    }
}

fn socket_addr(ip: &str, port: u16) -> SocketAddr {
    SocketAddr::new(ip.parse().expect("test address should parse"), port)
}

/// Binds the three classic slots and the Global slot on a free four-port base
/// (base..base+3) taken from a throwaway ephemeral socket — never a TotalMix
/// port (7001–7010) — retrying until all four bind.
fn bind_loopback_slot_set(policy: ReceivePolicy) -> (Vec<BoundRmeSlot>, GlobalOscSlot, u16) {
    for _ in 0..20 {
        let probe = UdpSocket::bind(("127.0.0.1", 0)).expect("throwaway socket should bind");
        let base = local_port_of(&probe);
        drop(probe);
        if !(7011..=u16::MAX - 3).contains(&base) {
            continue;
        }
        let slots = bind_slots(policy, 7011, i64::from(base));
        let global = bind_global_slot(policy, 7011, i64::from(base));
        if let (3, Some(global)) = (slots.len(), global) {
            return (slots, global, base);
        }
    }
    panic!("no free four-port base found for the loopback bind test");
}

#[test]
fn accept_source_rejects_foreign_ip() {
    assert!(accept_source(socket_addr("127.0.0.1", 51193), LOOPBACK));
    assert!(!accept_source(socket_addr("172.16.16.5", 7001), LOOPBACK));
    assert!(!accept_source(socket_addr("10.1.0.50", 9004), LOOPBACK));
    assert!(accept_source(socket_addr("10.1.0.50", 9004), LAN_CONSOLE));
    assert!(!accept_source(socket_addr("10.1.0.51", 9004), LAN_CONSOLE));
    assert!(!accept_source(socket_addr("127.0.0.1", 9004), LAN_CONSOLE));
    // An IPv4 console seen through a dual-stack socket is still the console;
    // the IPv6 loopback is not the IPv4 one.
    assert!(accept_source(
        socket_addr("::ffff:127.0.0.1", 51193),
        LOOPBACK
    ));
    assert!(!accept_source(
        socket_addr("::ffff:172.16.16.5", 51193),
        LOOPBACK
    ));
    assert!(!accept_source(socket_addr("::1", 51193), LOOPBACK));
    let v6_console: IpAddr = "fd00::10".parse().expect("v6 console");
    assert!(accept_source(socket_addr("fd00::10", 9004), v6_console));
    assert!(!accept_source(socket_addr("fd00::11", 9004), v6_console));
}

#[test]
fn receive_policy_binds_loopback_for_a_loopback_console_and_every_interface_otherwise() {
    assert_eq!(
        ReceivePolicy::for_console(LOOPBACK, None),
        ReceivePolicy {
            console: LOOPBACK,
            bind_host: LOOPBACK,
        }
    );
    assert_eq!(
        ReceivePolicy::for_console(LAN_CONSOLE, None),
        ReceivePolicy {
            console: LAN_CONSOLE,
            bind_host: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        }
    );
    let v6_loopback = IpAddr::V6(Ipv6Addr::LOCALHOST);
    assert_eq!(
        ReceivePolicy::for_console(v6_loopback, None).bind_host,
        v6_loopback
    );
    // The lab override wins over the rule, whatever the console address.
    let lab = IpAddr::V4(Ipv4Addr::new(10, 1, 79, 224));
    assert_eq!(
        ReceivePolicy::for_console(LOOPBACK, Some(lab)),
        ReceivePolicy {
            console: LOOPBACK,
            bind_host: lab,
        }
    );

    assert_eq!(resolve_console_address("localhost"), Some(LOOPBACK));
    assert_eq!(resolve_console_address("LOCALHOST"), Some(LOOPBACK));
    assert_eq!(resolve_console_address(" 127.0.0.1 "), Some(LOOPBACK));
    assert_eq!(resolve_console_address("10.1.0.50"), Some(LAN_CONSOLE));
    assert_eq!(resolve_console_address(""), None);
    assert_eq!(resolve_console_address("   "), None);

    assert_eq!(parse_bind_override(None), Ok(None));
    assert_eq!(parse_bind_override(Some("")), Ok(None));
    assert_eq!(parse_bind_override(Some("  ")), Ok(None));
    assert_eq!(
        parse_bind_override(Some("0.0.0.0")),
        Ok(Some(IpAddr::V4(Ipv4Addr::UNSPECIFIED)))
    );
    assert_eq!(parse_bind_override(Some(" 10.1.79.224 ")), Ok(Some(lab)));
    let refused = parse_bind_override(Some("desk")).expect_err("a name is not an address");
    assert!(refused.contains("SSE_OSC_BIND_HOST"), "{refused}");
    assert!(refused.contains("\"desk\""), "{refused}");
}

#[test]
fn receive_sockets_bind_loopback_for_loopback_console() {
    let console = resolve_console_address("localhost").expect("localhost resolves");
    let policy = ReceivePolicy::for_console(console, None);
    let (slots, global, base) = bind_loopback_slot_set(policy);

    let ports: Vec<u16> = slots
        .iter()
        .map(|slot| local_port_of(&slot.socket))
        .collect();
    assert_eq!(ports, vec![base, base + 1, base + 2]);
    for slot in &slots {
        let bound = slot.socket.local_addr().expect("slot address");
        assert_eq!(
            bound.ip(),
            LOOPBACK,
            "classic slot {:?} must bind loopback",
            slot.bus
        );
        assert_eq!(slot.console, LOOPBACK);
    }
    let send_ports: Vec<u16> = slots.iter().map(|slot| slot.send_port).collect();
    assert_eq!(send_ports, vec![7011, 7012, 7013]);

    let bound = global.socket.local_addr().expect("global slot address");
    assert_eq!(
        bound.ip(),
        LOOPBACK,
        "the Global OSC slot must bind loopback"
    );
    assert_eq!(bound.port(), base + 3);
    assert_eq!(global.send_port, 7014);
    assert_eq!(global.console, LOOPBACK);
}

#[test]
fn foreign_datagrams_are_dropped_and_logged_once_per_minute() {
    let log_path = temp_log_path("global-drop");
    let sender = UdpSocket::bind(("127.0.0.1", 0)).expect("sender should bind");
    let sender_port = local_port_of(&sender);
    // A slot commissioned for a console on the LAN: a loopback datagram is
    // foreign to it.
    let mut slot = GlobalOscSlot {
        send_port: 7014,
        socket: bind_receive_socket(LOOPBACK, 0).expect("slot should bind"),
        last_rx_at: None,
        console: LAN_CONSOLE,
    };
    let slot_port = slot.local_port();
    let level = encoder::encode(&OscPacket::Message(message(
        "/level/out/0",
        OscType::Float(-6.0),
    )))
    .expect("level should encode");
    let state = Arc::new(Mutex::new(RmeTotalMixMeterState::new()));
    let mut drops = DroppedSourceLog::new(Some(log_path.clone()));

    for _ in 0..3 {
        sender
            .send_to(&level, ("127.0.0.1", slot_port))
            .expect("send should succeed");
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    while drops.last_logged.is_empty() && Instant::now() < deadline {
        read_global_packets(&mut slot, &state, 1_000, &mut drops);
        thread::sleep(Duration::from_millis(10));
    }
    thread::sleep(Duration::from_millis(50));
    read_global_packets(&mut slot, &state, 1_000, &mut drops);

    assert!(
        slot.last_rx_at.is_none(),
        "a foreign datagram must not count as console activity"
    );
    let diagnostics = state.lock().expect("state").diagnostics();
    assert_eq!(
        diagnostics.packet_count, 0,
        "a foreign level must not reach the meters"
    );
    assert!(state
        .lock()
        .expect("state")
        .entry_for_surface_id("audio-mix-main")
        .is_none());
    let log = fs::read_to_string(&log_path).expect("the drop should be logged");
    let lines: Vec<&str> = log.lines().collect();
    assert_eq!(
        lines.len(),
        1,
        "one line per source per minute, got {log:?}"
    );
    assert!(lines[0].contains(" WARN "), "{log}");
    assert!(
        lines[0].contains(&format!("from 127.0.0.1:{sender_port} dropped")),
        "{log}"
    );
    assert!(
        lines[0].contains(&format!("receive port {slot_port}")),
        "{log}"
    );
    assert!(lines[0].contains("the TotalMix address 10.1.0.50"), "{log}");

    // The same datagram from the console's own address is read, and logs nothing.
    slot.console = LOOPBACK;
    sender
        .send_to(&level, ("127.0.0.1", slot_port))
        .expect("send should succeed");
    let deadline = Instant::now() + Duration::from_secs(2);
    while slot.last_rx_at.is_none() && Instant::now() < deadline {
        read_global_packets(&mut slot, &state, 2_000, &mut drops);
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        slot.last_rx_at.is_some(),
        "the console's datagram counts as activity"
    );
    let main = state
        .lock()
        .expect("state")
        .entry_for_surface_id("audio-mix-main")
        .expect("the console's level reaches the meters");
    assert!((main.left_dbfs + 6.0).abs() < 0.001);
    assert_eq!(state.lock().expect("state").diagnostics().packet_count, 1);
    assert_eq!(
        fs::read_to_string(&log_path).expect("log").lines().count(),
        1,
        "an accepted datagram writes nothing"
    );
    remove_temp_log(&log_path);
}

#[test]
fn classic_slots_read_the_console_address_only() {
    let log_path = temp_log_path("classic-drop");
    let sender = UdpSocket::bind(("127.0.0.1", 0)).expect("sender should bind");
    let mut slot = BoundRmeSlot {
        bus: RmeTotalMixBus::Input,
        send_port: 7011,
        socket: bind_receive_socket(LOOPBACK, 0).expect("slot should bind"),
        console: LAN_CONSOLE,
    };
    let slot_port = local_port_of(&slot.socket);
    let level = encoder::encode(&OscPacket::Message(message(
        "/1/level1Left",
        OscType::Float(0.25),
    )))
    .expect("level should encode");
    let state = Arc::new(Mutex::new(RmeTotalMixMeterState::new()));
    let mut drops = DroppedSourceLog::new(Some(log_path.clone()));

    sender
        .send_to(&level, ("127.0.0.1", slot_port))
        .expect("send should succeed");
    let deadline = Instant::now() + Duration::from_secs(2);
    while drops.last_logged.is_empty() && Instant::now() < deadline {
        read_available_packets(
            std::slice::from_ref(&slot),
            state.clone(),
            1_000,
            &mut drops,
        );
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(state.lock().expect("state").diagnostics().packet_count, 0);
    assert!(state
        .lock()
        .expect("state")
        .entry_for_surface_id("audio-input-9")
        .is_none());
    let log = fs::read_to_string(&log_path).expect("the drop should be logged");
    assert_eq!(log.lines().count(), 1, "{log}");
    assert!(log.contains(&format!("receive port {slot_port}")), "{log}");

    slot.console = LOOPBACK;
    sender
        .send_to(&level, ("127.0.0.1", slot_port))
        .expect("send should succeed");
    let deadline = Instant::now() + Duration::from_secs(2);
    while state.lock().expect("state").diagnostics().packet_count == 0 && Instant::now() < deadline
    {
        read_available_packets(
            std::slice::from_ref(&slot),
            state.clone(),
            1_000,
            &mut drops,
        );
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        state
            .lock()
            .expect("state")
            .diagnostics()
            .mapped_packet_count,
        1
    );
    assert!(state
        .lock()
        .expect("state")
        .entry_for_surface_id("audio-input-9")
        .is_some());
    assert_eq!(
        fs::read_to_string(&log_path).expect("log").lines().count(),
        1
    );
    remove_temp_log(&log_path);
}

#[test]
fn dropped_source_log_notes_a_source_once_a_minute() {
    let log_path = temp_log_path("rate-limit");
    let mut drops = DroppedSourceLog::new(Some(log_path.clone()));
    let source = socket_addr("172.16.16.5", 40_000);
    let other = socket_addr("172.16.16.6", 40_001);
    let start = Instant::now();

    assert!(drops.record_at(source, LOOPBACK, 9001, start));
    assert!(!drops.record_at(source, LOOPBACK, 9001, start + Duration::from_secs(30)));
    assert!(
        !drops.record_at(
            socket_addr("172.16.16.5", 40_002),
            LOOPBACK,
            9002,
            start + Duration::from_secs(59)
        ),
        "the rate limit is per address, not per port"
    );
    assert!(drops.record_at(other, LOOPBACK, 9001, start + Duration::from_secs(30)));
    assert!(drops.record_at(source, LOOPBACK, 9001, start + Duration::from_secs(60)));
    let log = fs::read_to_string(&log_path).expect("log");
    assert_eq!(log.lines().count(), 3, "{log}");
    assert!(log.contains("172.16.16.5:40000"), "{log}");
    assert!(log.contains("172.16.16.6:40001"), "{log}");
    remove_temp_log(&log_path);

    // Without a log path the limiter still counts and nothing is written.
    let mut silent = DroppedSourceLog::new(None);
    assert!(silent.record_at(source, LOOPBACK, 9001, start));
    assert!(!silent.record_at(source, LOOPBACK, 9001, start));

    // A flood of distinct sources is bounded: past the cap, new sources are
    // dropped silently until the old entries expire.
    let mut flood = DroppedSourceLog::new(None);
    for index in 0..MAX_TRACKED_DROP_SOURCES {
        let ip = IpAddr::V4(Ipv4Addr::new(
            10,
            9,
            (index / 256) as u8,
            (index % 256) as u8,
        ));
        assert!(flood.record_at(SocketAddr::new(ip, 1), LOOPBACK, 9001, start));
    }
    let extra = socket_addr("10.10.0.1", 1);
    assert!(!flood.record_at(extra, LOOPBACK, 9001, start + Duration::from_secs(30)));
    assert!(flood.record_at(extra, LOOPBACK, 9001, start + Duration::from_secs(60)));
}
