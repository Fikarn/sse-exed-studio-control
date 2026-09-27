//! The Prompter XL in the prompter (new pages program, Slice 5a): the state
//! the shell reports, `PLAY`'s lock, the pause when the glass goes, and the
//! check the header's lamp reads. The first steps, answered by the operator
//! on 2026-09-27, are in the ledger's Slice 5a.

use crate::prompter::runtime::forget;
use crate::prompter::test_support::TestPrompter;
use crate::prompter::{prompter_health_check, PrompterError};
use serde_json::json;
use std::thread;
use std::time::Duration;

fn on_the_glass(prompter: &TestPrompter) -> String {
    let script = prompter.script("Talk", &["one two three four", "five six seven eight"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(2, 100.0);
    script
}

// First step 2: after every start, until the shell reports, the Prompter XL
// reads NOT CONNECTED and PLAY is refused; the rest of the take works.
#[test]
fn until_the_shell_reports_the_prompter_xl_is_not_connected() {
    let prompter = TestPrompter::new("screen-start");
    on_the_glass(&prompter);
    forget(prompter.path());

    let screen = prompter.snapshot()["screen"].clone();
    assert_eq!(screen["state"], "not-connected");
    assert_eq!(screen["word"], "NOT CONNECTED");
    assert_eq!(screen["reported"], false);
    assert_eq!(screen["draws"], false);
    assert!(screen["sentence"]
        .as_str()
        .unwrap()
        .starts_with("Windows has not reported the Prompter XL"));

    prompter.lay_out(2, 100.0);
    let (code, sentence) = prompter.refused("prompter.play", json!({}));
    assert_eq!(code, "PROMPTER_NOT_ON_GLASS");
    assert!(sentence.starts_with("The Prompter XL is not connected, so the text cannot scroll."));
    for (method, params) in [
        ("prompter.jump", json!({ "to": "nextParagraph" })),
        ("prompter.speed", json!({ "step": 1 })),
        ("prompter.textSize", json!({ "step": 1 })),
        ("prompter.pause", json!({})),
    ] {
        prompter.call(method, params);
    }

    prompter.connect_screen();
    assert_eq!(prompter.snapshot()["screen"]["word"], "CONNECTED");
    prompter.lay_out(2, 100.0);
    prompter.call("prompter.play", json!({}));
    assert_eq!(prompter.snapshot()["glass"]["playing"], true);
}

// The proposal §7–8 and board 1: PLAY is refused while nothing is drawn on
// the glass, with the reason; LOW RESOLUTION still plays.
#[test]
fn play_waits_for_a_drawn_glass() {
    let prompter = TestPrompter::new("screen-play");
    on_the_glass(&prompter);
    let screen = |extra: serde_json::Value| {
        let mut params = json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 });
        for (key, value) in extra.as_object().unwrap() {
            params[key] = value.clone();
        }
        params
    };
    for (params, sentence) in [
        (
            json!({ "found": false }),
            "The Prompter XL is not connected",
        ),
        (
            screen(json!({ "duplicated": true })),
            "Windows shows a copy of another screen on the Prompter XL",
        ),
        (
            screen(json!({ "windowError": "The window could not be created." })),
            "Studio Control's window on the Prompter XL is not open",
        ),
    ] {
        prompter.report_screen(params.clone());
        let (code, refusal) = prompter.refused("prompter.play", json!({}));
        assert_eq!(code, "PROMPTER_NOT_ON_GLASS", "{params}");
        assert!(refusal.starts_with(sentence), "{refusal}");
    }
    prompter.report_screen(screen(json!({ "width": 1280, "height": 720 })));
    assert_eq!(prompter.snapshot()["screen"]["word"], "LOW RESOLUTION");
    prompter.call("prompter.play", json!({}));
    assert_eq!(prompter.snapshot()["glass"]["playing"], true);

    // Nothing on the prompter is still the first reason.
    prompter.call("prompter.clear", json!({}));
    prompter.report_screen(json!({ "found": false }));
    assert_eq!(
        prompter.refused("prompter.play", json!({})).0,
        "PROMPTER_NOTHING_ON"
    );
}

// The proposal §7: unplugged, the scroll pauses at the place; plugged back
// in, it stays paused (D12: nothing scrolls by itself).
#[test]
fn a_glass_that_goes_pauses_the_scroll_and_its_return_leaves_it_paused() {
    let prompter = TestPrompter::new("screen-lost");
    on_the_glass(&prompter);
    prompter.call("prompter.speed", json!({ "wpm": 300 }));
    prompter.call("prompter.play", json!({}));
    thread::sleep(Duration::from_millis(400));

    let reply = prompter
        .reply("prompter.screen.report", json!({ "found": false }))
        .expect("a report");
    assert_eq!(reply.reason, Some("screen"));
    assert_eq!(reply.result["paused"], true);
    assert_eq!(reply.result["screen"]["word"], "NOT CONNECTED");
    assert_eq!(reply.result["screen"]["reported"], true);
    let anchor = reply.anchor.expect("an anchor");
    assert!(!anchor.playing);
    assert!(reply.health_changed);
    thread::sleep(Duration::from_millis(400));
    let place = prompter.snapshot()["glass"]["place"].clone();
    thread::sleep(Duration::from_millis(200));
    assert_eq!(prompter.snapshot()["glass"]["place"], place, "it stays put");

    let back = prompter.connect_screen();
    assert_eq!(back["paused"], false);
    let glass = prompter.snapshot()["glass"].clone();
    assert_eq!(glass["playing"], false, "plugging back in never plays");
    assert_eq!(glass["place"], place);
}

// A report that changes nothing raises nothing: the shell may report the
// same screen again, and the lamp does not flicker.
#[test]
fn the_same_report_again_raises_nothing() {
    let prompter = TestPrompter::new("screen-same");
    let reply = prompter
        .reply(
            "prompter.screen.report",
            json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 }),
        )
        .expect("a report");
    assert_eq!(reply.reason, None);
    assert!(!reply.health_changed);
    let changed = prompter
        .reply(
            "prompter.screen.report",
            json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 50 }),
        )
        .expect("a report");
    assert_eq!(changed.reason, Some("screen"));
    assert!(
        changed.health_changed,
        "the check carries the refresh rate the page shows"
    );
    assert!(matches!(
        prompter.reply("prompter.screen.report", json!({ "found": true })),
        Err(PrompterError::Invalid(_))
    ));
}

// First step 3: checks.prompter is the worse of the screen's state and NOT
// UPDATED; a request after which it says something else says so, so the
// header's lamp follows, and a take's controls do not.
#[test]
fn the_check_follows_the_screen_and_not_updated() {
    let prompter = TestPrompter::new("screen-check");
    let script = on_the_glass(&prompter);
    let check = prompter_health_check(prompter.path()).expect("the check");
    assert!(check.ok);
    assert_eq!(check.word, "CONNECTED");

    let play = prompter.reply("prompter.play", json!({})).unwrap();
    assert!(
        !play.health_changed,
        "a take's control leaves the lamp alone"
    );
    let edit = prompter
        .reply(
            "prompter.script.edit",
            json!({ "scriptId": script, "paragraphs": [
                { "runs": [{ "text": "one two", "bold": false, "italic": false, "underline": false }] }
            ] }),
        )
        .unwrap();
    assert!(edit.health_changed);
    let check = prompter_health_check(prompter.path()).expect("the check");
    assert_eq!(check.word, "NOT UPDATED");
    assert_eq!(check.status.as_str(), "attention");
    assert!(check
        .summary
        .starts_with("Talk was edited after it went on the prompter."));

    let gone = prompter
        .reply("prompter.screen.report", json!({ "found": false }))
        .unwrap();
    assert!(gone.health_changed);
    let check = prompter_health_check(prompter.path()).expect("the check");
    assert_eq!(check.word, "NOT CONNECTED");
    assert_eq!(check.status.as_str(), "error");
    assert!(check.not_updated);
    assert_eq!(check.whole_status().as_str(), "attention");

    prompter.connect_screen();
    let update = prompter.reply("prompter.update", json!({})).unwrap();
    assert!(update.health_changed);
    assert!(prompter_health_check(prompter.path()).unwrap().ok);
}

// Review of the slice's push: the check is compared only around the
// requests that can change it, and never fails one. A pause acts on the
// glass even when the saved scripts cannot be read (before, the comparison
// read the glass's script first and failed the pause with STORAGE_ERROR while
// the text scrolled on).
#[test]
fn a_pause_acts_even_when_the_scripts_cannot_be_read() {
    let prompter = TestPrompter::new("screen-unreadable");
    on_the_glass(&prompter);
    prompter.call("prompter.play", json!({}));
    let connection = crate::storage::open_connection(prompter.path()).expect("a connection");
    connection
        .execute_batch("ALTER TABLE prompter_scripts RENAME TO prompter_scripts_away;")
        .expect("the scripts' table moves away");
    let reply = prompter
        .reply("prompter.pause", json!({}))
        .expect("the pause acts");
    assert_eq!(reply.reason, Some("paused"));
    assert!(!reply.anchor.expect("an anchor").playing);
    assert!(!reply.health_changed, "a take's control reads no check");
    // A request that can change the check says it may have, when it cannot
    // read it, rather than failing for it.
    let report = prompter
        .reply("prompter.screen.report", json!({ "found": false }))
        .expect("the report is taken");
    assert!(report.health_changed);
    connection
        .execute_batch("ALTER TABLE prompter_scripts_away RENAME TO prompter_scripts;")
        .expect("the scripts' table comes back");
}
