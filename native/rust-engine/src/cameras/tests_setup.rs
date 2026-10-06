//! Setup's part of the cameras (new pages program, Slice 8; D15): CAM 2's
//! and CAM 3's addresses, CAM 1's pairing, each camera's vMix input — saved
//! in `camera_setup` (schema 10) — and what the hardware link does with
//! them: a camera set up is held and read at once, and nothing is sent.

use crate::cameras::model::parse_camera_address;
use crate::cameras::store::{read_setup, write_setup, StoredSetup};
use crate::cameras::test_support::{
    announced_changes, assert_operator_words, refusal, TestCameras, CAM2_ADDRESS, CAM3_ADDRESS,
};
use crate::storage::open_connection;
use serde_json::{json, Value};

fn saved(cameras: &TestCameras) -> [StoredSetup; 3] {
    read_setup(&open_connection(cameras.path()).expect("connection should open"))
        .expect("the rows should read")
}

// D15 rule 1: an address sets CAM 2 or CAM 3 up; it is held and read at
// once, and nothing is sent. The answer is the camera's setup.
#[test]
fn an_address_sets_a_camera_up_and_holds_it() {
    let cameras = TestCameras::new("address");
    let reply = cameras
        .reply(
            "cameras.setup.update",
            json!({ "camera": 2, "address": " 172.16.16.85 " }),
        )
        .expect("the address is saved");
    assert_eq!(
        reply.result,
        json!({
            "camera": 2,
            "setup": {
                "setUp": true, "address": "172.16.16.85", "paired": false, "vmixInput": 2,
                "vmixOutput": 3, "noLink": null
            }
        })
    );
    assert_eq!(reply.event, Some(("setup", Some(2))));
    assert!(
        reply.health_changed,
        "CAM 2's line in the check says HELD now"
    );
    let cam2 = cameras.camera(2);
    assert_eq!(cam2["state"], "held");
    assert_eq!(cam2["values"]["iso"]["value"], "800");
    assert!(cam2["readAt"].is_string());
    assert_eq!(saved(&cameras)[1].address.as_deref(), Some(CAM2_ADDRESS));
    assert!(cameras.nothing_sent());

    // Saving an address again takes a released camera back.
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 2, "address": CAM2_ADDRESS }),
    );
    assert_eq!(cameras.camera(2)["state"], "held");
    // A vMix input alone leaves who holds it as it is.
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    assert_eq!(
        cameras.call(
            "cameras.setup.update",
            json!({ "camera": 2, "vmixInput": 1000 })
        )["setup"]["vmixInput"],
        1000
    );
    assert_eq!(cameras.camera(2)["state"], "released");
    assert!(cameras.nothing_sent());
}

// D15 rule 1: an IPv4 address of one machine — four numbers from 0 to 255 —
// and not 0.0.0.0, the broadcast or a multicast address.
#[test]
fn setup_refuses_what_is_not_the_address_of_one_machine() {
    let cameras = TestCameras::new("address-refused");
    for value in [
        "0.0.0.0",
        "255.255.255.255",
        "224.0.0.1",
        "239.255.255.250",
        "256.1.1.1",
        "1.2.3",
        "1.2.3.4.5",
        "1..2.3",
        "+1.2.3.4",
        "-1.2.3.4",
        "a.b.c.d",
        "1.2.3.4 5",
        "cam2.local",
        "::1",
    ] {
        let sentence = format!(
            "{value} is not the address of one machine. Enter the camera's IPv4 address: four numbers from 0 to 255, such as 172.16.16.85."
        );
        assert_eq!(
            cameras.refused(
                "cameras.setup.update",
                json!({ "camera": 3, "address": value })
            ),
            refusal("CAMERA_ADDRESS_INVALID", &sentence),
            "{value}"
        );
        assert_operator_words(&sentence);
    }
    assert_eq!(
        parse_camera_address("10.0.0.1").as_deref(),
        Some("10.0.0.1")
    );
    assert_eq!(
        parse_camera_address(" 010.0.0.1 ").as_deref(),
        Some("10.0.0.1")
    );
    assert_eq!(
        parse_camera_address("127.0.0.1").as_deref(),
        Some("127.0.0.1")
    );
    assert_eq!(
        parse_camera_address("223.255.255.254").as_deref(),
        Some("223.255.255.254")
    );

    for params in [
        json!({ "camera": 3, "address": 42 }),
        json!({ "camera": 3, "address": "" }),
        json!({ "camera": 3, "address": "   " }),
        json!({ "camera": 1, "address": "10.0.0.1" }),
        json!({ "camera": 1, "address": null }),
        json!({ "camera": 2, "vmixInput": 0 }),
        json!({ "camera": 2, "vmixInput": 1001 }),
        json!({ "camera": 2, "vmixInput": "3" }),
        json!({ "camera": 2, "vmixInput": null }),
        json!({ "camera": 2, "vmixInput": 2.5 }),
        json!({ "camera": 2 }),
        json!({ "camera": 4, "vmixInput": 4 }),
    ] {
        assert_eq!(
            cameras.code("cameras.setup.update", params.clone()),
            "INVALID_PARAMS",
            "{params}"
        );
    }
    assert!(
        saved(&cameras).iter().all(|row| !row.set_up()),
        "nothing was saved"
    );
}

// D15: `null` takes an address away, `forget` takes an address or the
// pairing away; the vMix input stays, and the camera is not set up again.
#[test]
fn an_address_or_a_pairing_taken_away_leaves_the_vmix_input() {
    let cameras = TestCameras::set_up("forget");
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 3, "vmixInput": 12 }),
    );
    assert_eq!(
        cameras.call(
            "cameras.setup.update",
            json!({ "camera": 3, "address": null })
        )["setup"],
        json!({
            "setUp": false, "address": null, "paired": false, "vmixInput": 12,
            "vmixOutput": 4, "noLink": null
        })
    );
    let cam3 = cameras.camera(3);
    assert_eq!(cam3["state"], "not-set-up");
    assert_eq!(cam3["values"]["iso"]["value"], Value::Null);

    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 1, "vmixInput": 5 }),
    );
    let reply = cameras
        .reply("cameras.setup.forget", json!({ "camera": 1 }))
        .expect("the pairing is taken away");
    assert_eq!(
        reply.result,
        json!({
            "camera": 1,
            "setup": {
                "setUp": false, "address": null, "paired": false, "vmixInput": 5,
                "vmixOutput": 2, "noLink": null
            }
        })
    );
    assert_eq!(reply.event, Some(("setup", Some(1))));
    assert_eq!(cameras.camera(1)["state"], "not-set-up");
    cameras.call("cameras.setup.forget", json!({ "camera": 2 }));
    assert_eq!(
        saved(&cameras),
        [
            StoredSetup {
                camera: 1,
                address: None,
                paired: false,
                vmix_input: 5
            },
            StoredSetup::new(2),
            StoredSetup {
                camera: 3,
                address: None,
                paired: false,
                vmix_input: 12
            },
        ]
    );
    assert_eq!(
        cameras.code("cameras.setup.forget", json!({ "camera": 9 })),
        "INVALID_PARAMS"
    );
    assert!(cameras.nothing_sent());
}

// D15 rule 2: CAM 1 is paired (the simulated link at once), then held;
// CAM 2 and CAM 3 take an address instead.
#[test]
fn cam_1_is_paired_and_held() {
    let cameras = TestCameras::new("pair");
    let reply = cameras
        .reply("cameras.setup.pair", json!({ "camera": 1 }))
        .expect("CAM 1 pairs");
    assert_eq!(
        reply.result,
        json!({
            "camera": 1,
            "setup": {
                "setUp": true, "address": null, "paired": true, "vmixInput": 1,
                "vmixOutput": 2, "noLink": null
            }
        })
    );
    assert_eq!(
        announced_changes(),
        (Vec::new(), false),
        "the reply carries its event"
    );
    assert_eq!(cameras.camera(1)["state"], "held");
    assert!(saved(&cameras)[0].paired);
    for camera in [2, 3, 0] {
        assert_eq!(
            cameras.code("cameras.setup.pair", json!({ "camera": camera })),
            "INVALID_PARAMS"
        );
    }
    assert!(cameras.nothing_sent());
}

// CAM 1's row may carry its Bluetooth address beside its pairing (the
// Pocket's link, 2026-10-06): the snapshot hides it, as the address is
// Windows' pairing's and not Setup's to show, the archive leaves it out
// with the pairing, and Forget takes both away.
#[test]
fn cam_1_s_row_may_carry_its_bluetooth_address_which_stays_on_this_pc() {
    let cameras = TestCameras::new("bluetooth-address");
    let connection = open_connection(cameras.path()).expect("connection should open");
    write_setup(
        &connection,
        &StoredSetup {
            camera: 1,
            address: Some(String::from("D4:3A:2C:11:22:33")),
            paired: true,
            vmix_input: 1,
        },
    )
    .expect("the row writes");
    cameras.restart();
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["state"], "held");
    assert_eq!(cam1["setup"]["paired"], true);
    assert_eq!(cam1["setup"]["address"], Value::Null, "hidden for CAM 1");
    assert_eq!(
        saved(&cameras)[0].address.as_deref(),
        Some("D4:3A:2C:11:22:33"),
        "and kept in the row"
    );
    let archived =
        crate::cameras::archive::build_cameras_archive(&connection).expect("the archive builds");
    assert_eq!(archived[0].address, None, "the archive leaves it out");
    assert_eq!(archived[0].camera, 1);

    cameras.call("cameras.setup.forget", json!({ "camera": 1 }));
    assert_eq!(saved(&cameras)[0], StoredSetup::new(1));
    assert!(cameras.nothing_sent());
}

// D13, D19, D41: Setup is saved, and so is a release (2026-10-06); the
// selection is not — after a start CAM 1 is selected, and a released camera
// is still released.
#[test]
fn setup_and_a_release_are_saved_and_the_selection_is_not() {
    let cameras = TestCameras::set_up("saved");
    cameras.call("cameras.release", json!({ "camera": 3, "confirm": true }));
    cameras.call("cameras.select", json!({ "camera": 2 }));
    cameras.restart();
    let snapshot = cameras.snapshot();
    assert_eq!(snapshot["selected"], 1);
    assert_eq!(snapshot["cameras"][2]["state"], "released");
    assert_eq!(snapshot["cameras"][2]["setup"]["address"], CAM3_ADDRESS);
    assert_eq!(snapshot["cameras"][0]["setup"]["paired"], true);
    assert_eq!(snapshot["cameras"][0]["state"], "held");
}

// A restore writes Setup's rows and sends nothing: the hardware link takes
// the new setup — a camera whose address changed starts again, held and
// read; one whose setup is the same stays as it was, released or not.
#[test]
fn a_restore_s_setup_is_taken_without_sending_anything() {
    let cameras = TestCameras::set_up("restore");
    cameras.call("cameras.release", json!({ "camera": 3, "confirm": true }));
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    let connection = open_connection(cameras.path()).expect("connection should open");
    write_setup(
        &connection,
        &StoredSetup {
            camera: 2,
            address: Some(String::from("172.16.16.90")),
            paired: false,
            vmix_input: 2,
        },
    )
    .expect("the row writes");
    write_setup(
        &connection,
        &StoredSetup {
            camera: 3,
            address: Some(String::from(CAM3_ADDRESS)),
            paired: false,
            vmix_input: 30,
        },
    )
    .expect("the row writes");
    let health_changed =
        crate::cameras::after_archive_restore(cameras.path(), true).expect("the restore settles");
    assert!(health_changed, "CAM 2's line in the check says HELD again");
    assert_eq!(
        cameras.health().word,
        "RELEASED",
        "CAM 3 is still the worst"
    );
    let snapshot = cameras.snapshot();
    assert_eq!(snapshot["cameras"][1]["state"], "held");
    assert_eq!(snapshot["cameras"][1]["setup"]["address"], "172.16.16.90");
    assert_eq!(snapshot["cameras"][2]["state"], "released");
    assert_eq!(snapshot["cameras"][2]["setup"]["vmixInput"], 30);
    assert!(cameras.nothing_sent());
}
