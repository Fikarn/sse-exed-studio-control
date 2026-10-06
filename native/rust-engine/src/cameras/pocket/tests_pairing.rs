//! CAM 1's pairing without a camera (part 5, 2026-10-06): the PIN's form,
//! what tells the Pocket's advertisement from another's, what Windows'
//! answers mean, the steps as Setup shows them, and the guard that keeps
//! every test's pairing off Bluetooth.

use crate::cameras::pocket::characteristics::SERVICE;
use crate::cameras::pocket::pairing::{
    asked, is_pocket, pairing_result, parse_pin, Asked, PairingStep, PocketPairing, PIN_REFUSED,
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
// in its advertisement, or the camera's own name.
#[test]
fn only_the_pocket_s_advertisement_is_taken() {
    assert!(is_pocket(&[SERVICE], ""));
    assert!(is_pocket(&[0x1234, SERVICE], "TimoTwo"));
    assert!(is_pocket(&[], "Pocket Cinema Camera 6K Pro"));
    assert!(is_pocket(&[], " pocket cinema camera 6K Pro A:1B2C"));
    for (services, name) in [
        (vec![], ""),
        (vec![], "TimoTwo"),
        (vec![], "INFINIMAT-13F156"),
        (vec![0x1234_u128], "Blackmagic"),
        (vec![], "My Pocket Cinema Camera"),
    ] {
        assert!(!is_pocket(&services, name), "{name} {services:?}");
    }
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
            String::from("Looking for CAM 1. Switch its Bluetooth on, with the iPad's app closed.")
        ))
    );
    assert_eq!(
        shown(PairingStep::Pin),
        Some((
            CameraPairingState::Pin,
            String::from("CAM 1 shows a 6-digit PIN. Enter it here.")
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
