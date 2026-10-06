//! The Pocket's link without a camera: its state machine, the guard that
//! keeps every test off Bluetooth, what the runtime reads through it, and
//! the two things the source must hold: only `winrt.rs` names Windows'
//! Bluetooth, and nothing writes the Camera Status characteristic.

use crate::cameras::model::Setting;
use crate::cameras::pocket::characteristics::{Notified, Writable, CAMERA_STATUS};
use crate::cameras::pocket::link::{guard_bluetooth, PocketLink};
use crate::cameras::pocket::protocol::{Message, Parameter, TYPE_INT32, VIDEO_ISO};
use crate::cameras::pocket::state::{
    Connection, LinkState, Noticed, STATUS_CAMERA_READY, STATUS_INITIAL_PAYLOAD_RECEIVED,
};
use crate::cameras::real_link::{parse_bluetooth_address, BluetoothAddress, LinkFailure};
use crate::cameras::runtime;
use crate::cameras::simulated::{CameraCommand, CameraReading, CameraValue};
use crate::cameras::store::{write_setup, StoredSetup};
use crate::cameras::test_support::{assert_operator_words, refusal, TestCameras};
use crate::storage::open_connection;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const POCKET_ADDRESS: &str = "D4:3A:2C:11:22:33";

fn pocket_address() -> BluetoothAddress {
    BluetoothAddress {
        address: 0xD43A_2C11_2233,
        random: false,
    }
}

fn iso(value: i32) -> Vec<u8> {
    Message {
        parameter: VIDEO_ISO,
        data_type: TYPE_INT32,
        operation: 0,
        data: value.to_le_bytes().to_vec(),
    }
    .encode()
    .expect("it encodes")
}

// The link's state: starting reads as no answer; connected, the camera's
// messages fill the reading and a changed value is noticed, a timecode or a
// status flag is not; lost keeps the reading and reads as no answer; a
// failure reads as the link's own sentence, and the same failure again says
// nothing.
#[test]
fn the_link_s_state_follows_the_connection_and_the_camera_s_messages() {
    let mut state = LinkState::new();
    assert_eq!(state.connection, Connection::Starting);
    assert_eq!(state.read(), Err(LinkFailure::NoAnswer));

    assert_eq!(state.connected(), Noticed::Changed);
    assert_eq!(
        state.read(),
        Ok(CameraReading::default()),
        "nothing read yet"
    );
    assert_eq!(state.control(&iso(800)), Noticed::Changed);
    assert_eq!(
        state.control(&iso(800)),
        Noticed::Nothing,
        "the same value again"
    );
    assert_eq!(state.read().expect("connected").iso.as_deref(), Some("800"));
    assert_eq!(
        state.timecode(&[0x10, 0x53, 0x12, 0x09]),
        Noticed::Nothing,
        "a timecode that moves is no change"
    );
    assert_eq!(
        state.read().expect("connected").timecode.as_deref(),
        Some("09:12:53:10")
    );
    assert_eq!(
        state.status_flags(&[STATUS_CAMERA_READY | STATUS_INITIAL_PAYLOAD_RECEIVED]),
        Noticed::Nothing
    );
    assert!(state.initial_payload_received());
    // Two messages in one notification, one of them nobody's.
    let mut two = iso(1600);
    two.extend(
        Message {
            parameter: Parameter(2, 0),
            data_type: TYPE_INT32,
            operation: 0,
            data: vec![0; 4],
        }
        .encode()
        .expect("it encodes"),
    );
    assert_eq!(state.control(&two), Noticed::Changed);
    assert_eq!(
        state.read().expect("connected").iso.as_deref(),
        Some("1600")
    );
    assert_eq!(state.control(&[0xFF, 0xFF]), Noticed::Nothing, "garbage");

    assert_eq!(state.lost(), Noticed::Changed);
    assert_eq!(state.lost(), Noticed::Nothing, "said once");
    assert_eq!(state.read(), Err(LinkFailure::NoAnswer));
    assert_eq!(
        state.reading.iso.as_deref(),
        Some("1600"),
        "the last reading stays, as doubt"
    );
    assert_eq!(state.connected(), Noticed::Changed);
    assert_eq!(
        state.read(),
        Ok(CameraReading::default()),
        "connected again: the camera sends everything afresh"
    );
    assert!(!state.initial_payload_received());

    let off = String::from("Bluetooth is off on this PC.");
    assert_eq!(state.failed(off.clone()), Noticed::Changed);
    assert_eq!(state.connection, Connection::Stopped);
    assert_eq!(state.read(), Err(LinkFailure::Bluetooth(off.clone())));
    assert_eq!(
        state.failed(off.clone()),
        Noticed::Nothing,
        "the same failure again, a retry that failed the same way"
    );
    assert_eq!(
        state.failed(String::from(
            "Windows did not find CAM 1 at its Bluetooth address."
        )),
        Noticed::Changed,
        "another failure is a change"
    );
    state.let_go();
    assert_eq!(state.read(), Err(LinkFailure::NoAnswer));
    assert_eq!(state.connection, Connection::Stopped);
}

// D15 rule 2: a test build never opens Bluetooth. The guard refuses, the
// link stands stopped with the guard's sentence, nothing is told to look,
// and a press is refused before anything would be sent; a press the
// protocol cannot carry is refused as such.
#[test]
fn the_guard_keeps_every_test_off_bluetooth() {
    let refused = guard_bluetooth().expect_err("a test build is refused");
    assert!(
        refused.starts_with("A test run does not open Bluetooth"),
        "{refused}"
    );
    assert_operator_words(&refused);

    let looked = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&looked);
    let link = PocketLink::start(pocket_address(), move || {
        counted.fetch_add(1, Ordering::SeqCst);
    });
    assert!(link.stopped());
    assert_eq!(link.address(), pocket_address());
    assert_eq!(link.read(), Err(LinkFailure::Bluetooth(refused.clone())));
    assert_eq!(
        link.send(&[CameraCommand::RecordStart], &CameraReading::default()),
        Err(LinkFailure::Bluetooth(refused.clone())),
        "the thread never ran"
    );
    assert_eq!(
        link.send(&[CameraCommand::FocusSteps(1)], &CameraReading::default()),
        Err(LinkFailure::NotCarried(String::from(
            "CAM 1's focus is a position, not a step: the Pocket takes no focus step."
        ))),
        "refused before the thread is asked"
    );
    assert_eq!(
        link.send(
            &[CameraCommand::Set(
                Setting::Iso,
                CameraValue::Text(String::from("Auto"))
            )],
            &CameraReading::default()
        ),
        Err(LinkFailure::NotCarried(String::from(
            "The Pocket's protocol cannot carry ISO Auto."
        )))
    );
    link.let_go();
    assert!(link.stopped());
    assert_eq!(looked.load(Ordering::SeqCst), 0, "nobody was told to look");
}

// Through the runtime: CAM 1 paired, with its Bluetooth address in its row,
// in a build without the simulated cameras. The links are told to hold it,
// the guard's sentence is CAM 1's UNREACHABLE sentence, a press is refused
// as unreachable with it, and nothing is sent. A row whose address goes
// lets the link go.
#[test]
fn a_test_build_reads_the_guard_s_sentence_as_cam_1_s_unreachable_sentence() {
    let cameras = TestCameras::without_simulation("guarded");
    let connection = open_connection(cameras.path()).expect("connection should open");
    write_setup(
        &connection,
        &StoredSetup {
            camera: 1,
            address: Some(String::from(POCKET_ADDRESS)),
            paired: true,
            vmix_input: 1,
        },
    )
    .expect("the row writes");
    cameras.restart();
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["state"], "unreachable");
    let sentence = cam1["sentence"].as_str().expect("a sentence").to_string();
    assert!(
        sentence.starts_with("A test run does not open Bluetooth"),
        "{sentence}"
    );
    assert_eq!(cam1["setup"]["address"], serde_json::Value::Null);
    assert_eq!(runtime::links_told(cameras.path())[0], "hold 1");
    assert_eq!(
        cameras.refused(
            "cameras.set",
            json!({ "camera": 1, "setting": "iso", "value": "800" })
        ),
        refusal("CAMERA_UNREACHABLE", &sentence)
    );
    cameras.call("cameras.release", json!({ "camera": 1, "confirm": true }));
    assert_eq!(cameras.camera(1)["state"], "released");
    cameras.call("cameras.connect", json!({ "camera": 1 }));
    assert_eq!(cameras.camera(1)["state"], "unreachable");
    assert_eq!(
        runtime::links_told(cameras.path()),
        vec!["hold 1", "let go 2", "let go 3", "let go 1", "hold 1"]
    );
    // The pairing stays and the address goes (a backup from before the
    // link, restored whole): no link to start, and the old one let go.
    write_setup(
        &connection,
        &StoredSetup {
            camera: 1,
            address: None,
            paired: true,
            vmix_input: 1,
        },
    )
    .expect("the row writes");
    crate::cameras::after_archive_restore(cameras.path(), false).expect("the restore settles");
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["state"], "unreachable");
    assert_eq!(
        cam1["sentence"],
        "Studio Control has no link to CAM 1 yet: it comes with a later version."
    );
    assert!(cameras.nothing_sent());
}

#[test]
fn a_bluetooth_address_is_six_pairs_of_hexadecimal_digits_and_its_kind() {
    assert_eq!(
        parse_bluetooth_address(POCKET_ADDRESS),
        Some(pocket_address())
    );
    assert_eq!(
        parse_bluetooth_address(" d4-3a-2c-11-22-33 "),
        Some(pocket_address())
    );
    assert_eq!(
        parse_bluetooth_address("D4:3A:2C:11:22:33 random"),
        Some(BluetoothAddress {
            random: true,
            ..pocket_address()
        })
    );
    for other in [
        "172.16.16.85",
        "D4:3A:2C:11:22",
        "D4:3A:2C:11:22:33:44",
        "D4:3A:2C:11:22:3G",
        "",
        "D43A2C112233",
        "D4:3A:2C:11:22:33 public",
        "D4:3A:2C:11:22:33 random more",
    ] {
        assert_eq!(parse_bluetooth_address(other), None, "{other}");
    }
    assert_eq!(pocket_address().text(), POCKET_ADDRESS);
    assert_eq!(
        BluetoothAddress {
            random: true,
            ..pocket_address()
        }
        .text(),
        "D4:3A:2C:11:22:33 random"
    );
    for text in [POCKET_ADDRESS, "D4:3A:2C:11:22:33 random"] {
        assert_eq!(
            parse_bluetooth_address(text).map(BluetoothAddress::text),
            Some(String::from(text)),
            "written and read back"
        );
    }
}

// Nothing ever writes the Camera Status characteristic: the writable
// characteristics are named, and the status is not among them; the Windows
// module has one write, which takes a writable one.
#[test]
fn nothing_writes_the_camera_status_characteristic() {
    for writable in Writable::ALL {
        assert_ne!(writable.uuid(), CAMERA_STATUS, "{writable:?}");
        for notified in Notified::ALL {
            assert_ne!(
                writable.uuid(),
                notified.uuid(),
                "{writable:?} is listened to"
            );
        }
    }
    let source = include_str!("winrt.rs");
    let code: String = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(
        code.matches("WriteValueWithResultAsync").count(),
        1,
        "one write in winrt.rs"
    );
    assert!(
        !code.contains("CAMERA_STATUS"),
        "winrt.rs names the status characteristic only through Notified"
    );
    assert!(!code.contains("PairAsync"), "pairing is the next part's");
}

// D15 rule 2: only `winrt.rs` speaks to Windows' Bluetooth; every other
// file of the cameras names no Bluetooth crate.
#[test]
fn only_the_windows_module_names_bluetooth() {
    let sources: [(&str, &str); 11] = [
        ("real_link.rs", include_str!("../real_link.rs")),
        ("runtime.rs", include_str!("../runtime.rs")),
        ("commands.rs", include_str!("../commands.rs")),
        ("model.rs", include_str!("../model.rs")),
        ("store.rs", include_str!("../store.rs")),
        ("pocket/link.rs", include_str!("link.rs")),
        ("pocket/state.rs", include_str!("state.rs")),
        ("pocket/protocol.rs", include_str!("protocol.rs")),
        ("pocket/format.rs", include_str!("format.rs")),
        ("pocket/timecode.rs", include_str!("timecode.rs")),
        ("pocket/stub.rs", include_str!("stub.rs")),
    ];
    for (name, source) in sources {
        let code: String = source
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        for forbidden in ["windows::", "btleplug", "bluest", "Devices::Bluetooth"] {
            assert!(!code.contains(forbidden), "{name} names {forbidden}");
        }
    }
    assert!(include_str!("winrt.rs").contains("windows::Devices::Bluetooth"));
}
