// The rules on TotalMix's address and ports, and what a change of them writes
// (the audit of 2026-10-12 and its review). The tests that write settings take
// the shared console link's lock: a transport change forgets the link's slot
// states, which the load tests read back.

use super::tests::TestDir;
use super::tests_console_link::serialize_shared_link;
use super::*;
use crate::storage::initialize_test_database;

// The one-machine rule (the audit of 2026-10-12): the audio settings' own
// change of TotalMix's address refuses what is no machine's, as Setup's probe
// does; `localhost` and one machine's address are taken.
#[test]
fn a_totalmix_address_that_is_not_one_machines_is_refused() {
    let _serial = serialize_shared_link();
    let test_dir = TestDir::new("totalmix-one-machine");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    let update = |host: &str| {
        update_audio_settings(
            test_dir.db_path().as_path(),
            &AudioSettingsUpdateRequest {
                osc_enabled: None,
                send_host: Some(String::from(host)),
                send_port: None,
                receive_port: None,
                selected_channel_id: None,
                selected_mix_target_id: None,
                expected_peak_data: None,
                expected_submix_lock: None,
                expected_compatibility_mode: None,
                faders_per_bank: None,
                view_mode: None,
                hidden_channel_ids: None,
            },
        )
    };
    for host in ["0.0.0.0", "255.255.255.255", "239.255.0.1"] {
        match update(host) {
            Err(AudioCommandError::Rejected(code, message)) => {
                assert_eq!(code, "AUDIO_HOST_INVALID", "{host}");
                assert_eq!(
                    message,
                    "TotalMix's address must be the address of one machine: not 0.0.0.0, a broadcast or a multicast address."
                );
            }
            other => panic!("{host} should be refused: {other:?}"),
        }
    }
    match update("not an address") {
        Err(AudioCommandError::Rejected(_, message)) => assert_eq!(
            message,
            "TotalMix's address must be localhost or four numbers, like 127.0.0.1."
        ),
        other => panic!("words should be refused: {other:?}"),
    }
    assert_eq!(
        update("localhost").expect("localhost is taken").send_host,
        "localhost"
    );
    assert_eq!(
        update("10.1.0.20")
            .expect("one machine's address is taken")
            .send_host,
        "10.1.0.20"
    );
}

// TotalMix's ports leave room for remotes 2 to 4 above them (the review of
// the audit's probes item): 65533 and up are refused.
#[test]
fn a_totalmix_port_with_no_room_for_remote_4_is_refused() {
    let _serial = serialize_shared_link();
    let test_dir = TestDir::new("totalmix-port-room");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    let request = |send_port: Option<i64>, receive_port: Option<i64>| AudioSettingsUpdateRequest {
        osc_enabled: None,
        send_host: None,
        send_port,
        receive_port,
        selected_channel_id: None,
        selected_mix_target_id: None,
        expected_peak_data: None,
        expected_submix_lock: None,
        expected_compatibility_mode: None,
        faders_per_bank: None,
        view_mode: None,
        hidden_channel_ids: None,
    };
    for (send_port, receive_port) in [(Some(65_533), None), (None, Some(65_535))] {
        match update_audio_settings(
            test_dir.db_path().as_path(),
            &request(send_port, receive_port),
        ) {
            Err(AudioCommandError::Rejected(code, message)) => {
                assert_eq!(code, "AUDIO_PORT_INVALID");
                assert_eq!(
                    message,
                    "TotalMix's ports must leave room for remotes 2 to 4 above them: at most 65532."
                );
            }
            other => panic!("the port should be refused: {other:?}"),
        }
    }
    assert!(update_audio_settings(
        test_dir.db_path().as_path(),
        &request(Some(65_532), Some(65_532))
    )
    .is_ok());
}

// A change of TotalMix's address or ports, from the audio settings or from
// Setup's probe, resets the audio probe and the Console's knowledge together
// (the review: the probe used to leave the old `passed`, and the remotes' bus
// selection went to the new, unprobed address for the probe's window).
#[test]
fn a_transport_change_resets_the_probe_and_the_consoles_knowledge_together() {
    let _serial = serialize_shared_link();
    let updates = console_transport_changed_updates();
    let value = |key: &str| {
        updates
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    };
    assert_eq!(value("app.commissioning.check.audio.status"), Some("idle"));
    assert_eq!(
        value("app.commissioning.check.audio.message"),
        Some("The TotalMix address or ports changed. Run the audio probe again.")
    );
    assert_eq!(value("app.commissioning.check.audio.checked_at"), Some(""));
    assert!(updates.contains(&confidence_setting(ConsoleConfidence::Unknown)));
}
