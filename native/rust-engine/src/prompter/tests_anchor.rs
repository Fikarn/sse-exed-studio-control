//! The anchors' numbers (fix C, 2026-10-02): an unchanged glass reads the
//! number the last change carried, every change takes the next, the number
//! keeps rising whatever the glass shows, and a start counts from one again.

use crate::prompter::runtime::{forget, ANNOUNCED_ENDS};
use crate::prompter::test_support::TestPrompter;
use serde_json::{json, Value};
use std::thread;
use std::time::Duration;

/// The anchor's number in a reply's anchor or a read's.
fn number(anchor: &Value) -> u64 {
    anchor["revision"].as_u64().expect("a numbered anchor")
}

fn glass_number(prompter: &TestPrompter) -> u64 {
    number(&prompter.call("prompter.glass.snapshot", json!({}))["anchor"])
}

fn reply_number(prompter: &TestPrompter, method: &str, params: Value) -> u64 {
    let reply = prompter
        .reply(method, params)
        .unwrap_or_else(|error| panic!("{method} should succeed: {error:?}"));
    let anchor = reply.anchor.expect("the reply carries the anchor");
    anchor.revision
}

fn on_the_glass(prompter: &TestPrompter) -> String {
    let id = prompter.script(
        "Numbered",
        &[
            "one two three four five six",
            "seven eight nine ten eleven twelve",
            "thirteen fourteen fifteen sixteen",
        ],
    );
    prompter.call("prompter.putOn", json!({ "scriptId": id }));
    prompter.lay_out(2, 100.0);
    id
}

#[test]
fn an_unchanged_glass_reads_the_number_the_last_change_carried() {
    let prompter = TestPrompter::new("anchor-unchanged");
    let id = on_the_glass(&prompter);

    let read = glass_number(&prompter);
    thread::sleep(Duration::from_millis(20));
    assert_eq!(glass_number(&prompter), read, "a read again");
    let snapshot = prompter.snapshot();
    assert_eq!(
        number(&snapshot["glass"]["anchor"]),
        read,
        "the page's read"
    );

    // What leaves the motion alone keeps the number.
    assert_eq!(
        reply_number(&prompter, "prompter.speed", json!({ "wpm": 150 })),
        read,
        "a pace while paused"
    );
    prompter.edit(&id, &["A new text the glass does not show yet."]);
    assert_eq!(glass_number(&prompter), read, "an edit");

    // Every change takes the next.
    let played = reply_number(&prompter, "prompter.play", json!({}));
    assert_eq!(played, read + 1);
    assert_eq!(glass_number(&prompter), played, "a read while playing");
    let faster = reply_number(&prompter, "prompter.speed", json!({ "wpm": 200 }));
    assert_eq!(faster, played + 1);
    let paused = reply_number(&prompter, "prompter.pause", json!({}));
    assert_eq!(paused, faster + 1);
    let jumped = reply_number(&prompter, "prompter.jump", json!({ "to": "top" }));
    assert_eq!(jumped, paused + 1);
}

#[test]
fn the_number_keeps_rising_across_clear_and_put_on() {
    let prompter = TestPrompter::new("anchor-rising");
    on_the_glass(&prompter);
    let before = glass_number(&prompter);
    let cleared = prompter
        .reply("prompter.clear", json!({}))
        .expect("the prompter clears");
    assert!(cleared.anchor.is_none(), "nothing on the glass, no anchor");

    let other = prompter.script("Other", &["one two three"]);
    let put_on = reply_number(&prompter, "prompter.putOn", json!({ "scriptId": other }));
    assert!(put_on > before, "{put_on} after {before}");
}

// Whoever finds the text at END says so before its own answer, and the END
// anchor is numbered before the anchor of the press that found it.
#[test]
fn the_end_is_numbered_before_the_press_that_found_it() {
    let prompter = TestPrompter::new("anchor-end");
    let script = prompter.script("Short", &["Go."]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(5, 10.0);
    prompter.call("prompter.speed", json!({ "wpm": 300 }));
    ANNOUNCED_ENDS.with(|ends| ends.borrow_mut().clear());
    let played = reply_number(&prompter, "prompter.play", json!({}));
    thread::sleep(Duration::from_millis(1_000));

    let top = reply_number(&prompter, "prompter.jump", json!({ "to": "top" }));
    let ends = ANNOUNCED_ENDS.with(|ends| ends.borrow().clone());
    assert_eq!(ends.len(), 1);
    assert!(ends[0].revision > played);
    assert_eq!(top, ends[0].revision + 1);
}

// The numbers count within one run of the hardware link: a start counts
// from one again, and the views forget the number when the link stops.
#[test]
fn a_start_counts_from_one_again() {
    let prompter = TestPrompter::new("anchor-start");
    on_the_glass(&prompter);
    prompter.call("prompter.play", json!({}));
    prompter.call("prompter.pause", json!({}));
    assert!(glass_number(&prompter) > 1);
    forget(prompter.path());
    assert_eq!(glass_number(&prompter), 1);
}
