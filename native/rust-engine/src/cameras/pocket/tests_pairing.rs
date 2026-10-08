//! CAM 1's pairing without a camera (part 5, 2026-10-06): the PIN's form,
//! what tells the Pocket's advertisement from another's, what Windows'
//! answers mean, the steps as Setup shows them, and the guard that keeps
//! every test's pairing off Bluetooth.

use crate::cameras::pocket::characteristics::SERVICE;
use crate::cameras::pocket::pairing::{
    asked, heard_entry, heard_line, is_pocket, pairing_result, parse_pin, Asked, Heard,
    PairingStep, PocketPairing, HEARD_KEPT, PIN_REFUSED,
};
use crate::cameras::real_link::BluetoothAddress;
use crate::cameras::snapshot::CameraPairingState;
use crate::cameras::test_support::assert_operator_words;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[test]
fn a_pin_is_the_six_digits_the_camera_shows() {
    assert_eq!(parse_pin("123456").as_deref(), Some("123456"));
    assert_eq!(parse_pin(" 012345 ").as_deref(), Some("012345"));
    for wrong in [
        "",
        "12345",
        "1234567",
        "12a456",
        "12 456",
        "١٢٣٤٥٦",
        "+12345",
    ] {
        assert_eq!(parse_pin(wrong), None, "{wrong}");
    }
}

// The pairing takes no device but the Pocket: Blackmagic's camera service
// in its advertisement or scan reply. Its name (`A:F901D868` on the
// studio's Pocket) is not looked at.
#[test]
fn only_the_pocket_s_advertisement_is_taken() {
    assert!(is_pocket(&[SERVICE]));
    assert!(is_pocket(&[0x1234, SERVICE]));
    assert!(!is_pocket(&[]));
    assert!(!is_pocket(&[0x1234]));
    assert!(!is_pocket(&[SERVICE.wrapping_add(1)]));
}

// A listen that did not hear the Pocket says in the log what it heard:
// each device's address, name and services once, `HEARD_KEPT` at most.
#[test]
fn a_listen_that_missed_the_pocket_says_what_it_heard() {
    let light = BluetoothAddress {
        address: 0xD43A_2C11_2233,
        random: false,
    };
    let module = BluetoothAddress {
        address: 0x0102_0304_0506,
        random: true,
    };
    assert_eq!(heard_entry(light, "", &[], &[], &[]), "D4:3A:2C:11:22:33");
    assert_eq!(
        heard_entry(light, " INFINIMAT-13F156 ", &[0x180F], &[], &[0x01, 0x09]),
        "D4:3A:2C:11:22:33 \"INFINIMAT-13F156\" [00000000-0000-0000-0000-00000000180F] sections 01 09"
    );
    assert_eq!(
        heard_entry(module, "TimoTwo", &[SERVICE, 0x1], &[0x004C, 0x0075], &[]),
        "01:02:03:04:05:06 random \"TimoTwo\" [291D567A-6D75-11E6-8B77-86F30CA893D3, 00000000-0000-0000-0000-000000000001] maker 004C, 0075"
    );

    let mut heard = Heard::default();
    assert_eq!(
        heard.line(0),
        "CAM 1 was not heard: 0 advertisements in all, none the Pocket's."
    );
    heard.note(heard_entry(light, "INFINIMAT-13F156", &[], &[], &[]), -97);
    heard.note(heard_entry(module, "TimoTwo", &[], &[], &[]), -80);
    heard.note(heard_entry(light, "INFINIMAT-13F156", &[], &[], &[]), -91);
    assert_eq!(
        heard.line(3),
        "CAM 1 was not heard: 3 advertisements in all, none the Pocket's. Heard: 01:02:03:04:05:06 random \"TimoTwo\" (-80 dBm, 1×); D4:3A:2C:11:22:33 \"INFINIMAT-13F156\" (-91 dBm, 2×)."
    );

    let mut many = Heard::default();
    for index in 0..HEARD_KEPT + 2 {
        many.note(format!("device {index:03}"), -70);
    }
    let line = many.line(99);
    assert_eq!(line.matches("device ").count(), HEARD_KEPT);
    assert!(line.ends_with("; and more."), "{line}");

    assert_eq!(
        heard_line(light, -62, true),
        "CAM 1 was heard at D4:3A:2C:11:22:33 (-62 dBm, in its scan reply)."
    );
    assert_eq!(
        heard_line(module, -70, false),
        "CAM 1 was heard at 01:02:03:04:05:06 random (-70 dBm, in its advertisement)."
    );
}

// Windows' answers, by their numbers: paired (or already), or a sentence
// that says why not and what to do.
#[test]
fn windows_answers_read_as_paired_or_a_sentence() {
    assert_eq!(pairing_result(0), Ok(()));
    assert_eq!(pairing_result(3), Ok(()));
    assert_eq!(pairing_result(9), Err(String::from(PIN_REFUSED)));
    for status in [1, 2, 4, 5, 7, 8, 11, 14, 17, 19, 42] {
        let sentence = pairing_result(status).expect_err("not paired");
        assert!(
            sentence.ends_with("Press Pair CAM 1 to try again."),
            "{status}: {sentence}"
        );
        assert_operator_words(&sentence);
    }
    assert_eq!(asked(4), Asked::Pin);
    assert_eq!(asked(1), Asked::Confirm);
    for other in [0, 2, 8, 16, 32, 5] {
        assert_eq!(asked(other), Asked::Other, "{other}");
    }
}

// Each step as Setup shows it; a pairing that succeeded is shown as the
// camera's pairing, not as a step.
#[test]
fn each_step_says_what_to_do() {
    let shown = |step: PairingStep| {
        step.shown()
            .map(|pairing| (pairing.state, pairing.sentence))
    };
    assert_eq!(
        shown(PairingStep::Finding),
        Some((
            CameraPairingState::Finding,
            String::from("Looking for CAM 1. Switch its Bluetooth on, with no other controller connected to it.")
        ))
    );
    assert_eq!(
        shown(PairingStep::Pin),
        Some((
            CameraPairingState::Pin,
            String::from("CAM 1 shows a 6-digit PIN. Enter it here within 30 seconds.")
        ))
    );
    assert_eq!(
        shown(PairingStep::Pairing),
        Some((
            CameraPairingState::Pairing,
            String::from("Pairing with CAM 1…")
        ))
    );
    assert_eq!(
        shown(PairingStep::Failed(String::from(PIN_REFUSED))),
        Some((CameraPairingState::Failed, String::from(PIN_REFUSED)))
    );
    let address = BluetoothAddress {
        address: 0xD43A_2C11_2233,
        random: false,
    };
    assert_eq!(shown(PairingStep::Paired(address)), None);
    for step in [PairingStep::Finding, PairingStep::Pin, PairingStep::Pairing] {
        assert!(step.running(), "{step:?}");
        assert_operator_words(&step.shown().expect("shown").sentence);
    }
    assert!(!PairingStep::Failed(String::new()).running());
    assert!(!PairingStep::Paired(address).running());
}

// D15 rule 2: a test build's pairing is refused before any thread starts:
// it has failed with the guard's sentence, takes no PIN, and tells nobody.
#[test]
fn the_guard_keeps_every_test_s_pairing_off_bluetooth() {
    let told = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&told);
    let pairing = PocketPairing::start(move || {
        counted.fetch_add(1, Ordering::SeqCst);
    });
    let PairingStep::Failed(sentence) = pairing.step() else {
        panic!("a test build's pairing fails at once: {:?}", pairing.step());
    };
    assert!(
        sentence.starts_with("A test run does not open Bluetooth"),
        "{sentence}"
    );
    assert!(!pairing.pin(String::from("123456")), "no PIN is wanted");
    pairing.cancel();
    assert_eq!(told.load(Ordering::SeqCst), 0, "nobody is told to look");
}
