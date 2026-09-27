//! The prompter's glass and its take through the request path (new pages
//! program, Slice 4): putting a script on, replacing, updating and clearing
//! it (D11), the clock's rules (D12, D19, §14), a restart, and the look.

use crate::prompter::test_support::TestPrompter;
use serde_json::json;
use std::thread;
use std::time::Duration;

fn place(value: &serde_json::Value) -> (u64, u64) {
    (
        value["paragraph"].as_u64().expect("paragraph"),
        value["word"].as_u64().expect("word"),
    )
}

// §5.5: Put on the prompter is one press on a blank prompter, and the script
// comes on paused at its own place; replacing another script needs the
// page's second press (`replace: true`, D11), and the replaced script keeps
// its place.
#[test]
fn put_on_is_one_press_on_a_blank_prompter_and_replacing_needs_the_second() {
    let prompter = TestPrompter::new("put-on");
    let intro = prompter.script("Intro", &["One two three four.", "Five six seven."]);
    let outro = prompter.script("Outro", &["Goodbye now."]);
    assert!(prompter.snapshot()["glass"].is_null());

    let result = prompter.call("prompter.putOn", json!({ "scriptId": intro }));
    assert_eq!(result["action"], "put-on");
    assert_eq!(result["sentence"], "Put Intro on the prompter.");
    let glass = &prompter.snapshot()["glass"];
    assert_eq!(glass["name"], "Intro");
    assert_eq!(glass["playing"], false, "on the prompter, paused");
    assert_eq!(place(&glass["place"]), (0, 0));
    assert_eq!(glass["notUpdated"], false);

    prompter.call(
        "prompter.jump",
        json!({ "to": "paragraph", "paragraph": 1 }),
    );
    let (code, sentence) = prompter.refused("prompter.putOn", json!({ "scriptId": outro }));
    assert_eq!(code, "PROMPTER_REPLACE_NOT_CONFIRMED");
    assert_eq!(
        sentence,
        "The prompter shows Intro. Replacing it with Outro needs the second press."
    );
    assert_eq!(
        prompter.snapshot()["glass"]["name"],
        "Intro",
        "nothing changed"
    );

    let result = prompter.call(
        "prompter.putOn",
        json!({ "scriptId": outro, "replace": true }),
    );
    assert_eq!(result["action"], "replaced");
    assert_eq!(
        result["sentence"],
        "Replaced Intro with Outro on the prompter."
    );
    let scripts = prompter.snapshot()["scripts"].clone();
    let intro_row = scripts
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == "Intro")
        .unwrap()
        .clone();
    assert_eq!(place(&intro_row["place"]), (1, 0), "Intro kept its place");
    assert_eq!(intro_row["onPrompter"], false);

    let (code, _) = prompter.refused(
        "prompter.putOn",
        json!({ "scriptId": outro, "replace": true }),
    );
    assert_eq!(code, "PROMPTER_ALREADY_ON");
}

// §6.3: an edit changes Studio Control's copy, not the presenter's; Update
// (armed on the page) puts the edit on with the same words at the reading
// line, and a deleted paragraph at the reading line moves the place to the
// start of the next one, which the sentence says.
#[test]
fn an_edit_waits_for_update_and_update_keeps_the_words_at_the_reading_line() {
    let prompter = TestPrompter::new("update");
    let script = prompter.script(
        "Talk",
        &["Alpha one.", "Beta two.", "Gamma three.", "Delta four."],
    );
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.call(
        "prompter.jump",
        json!({ "to": "paragraph", "paragraph": 2 }),
    );

    prompter.edit(
        &script,
        &[
            "New opening.",
            "Alpha one.",
            "Beta two.",
            "Gamma three.",
            "Delta four.",
        ],
    );
    let glass = prompter.call("prompter.glass.snapshot", json!({}));
    assert_eq!(
        glass["paragraphs"].as_array().unwrap().len(),
        4,
        "the glass keeps its text"
    );
    assert_eq!(prompter.snapshot()["glass"]["notUpdated"], true);

    let result = prompter.call("prompter.update", json!({}));
    assert_eq!(result["sentence"], "Updated Talk on the prompter.");
    let snapshot = prompter.snapshot();
    assert_eq!(
        place(&snapshot["glass"]["place"]),
        (3, 0),
        "Gamma is still at the reading line"
    );
    assert_eq!(snapshot["glass"]["notUpdated"], false);
    assert_eq!(
        prompter.refused("prompter.update", json!({})).0,
        "PROMPTER_UP_TO_DATE"
    );

    prompter.edit(
        &script,
        &["New opening.", "Alpha one.", "Beta two.", "Delta four."],
    );
    let result = prompter.call("prompter.update", json!({}));
    assert_eq!(
        result["sentence"],
        "Updated Talk on the prompter. The paragraph at the reading line was deleted, so the prompter now starts at paragraph 4."
    );
    assert_eq!(place(&prompter.snapshot()["glass"]["place"]), (3, 0));
}

// §5.5: Clear the prompter blanks the glass; the script stays in the list
// with its place.
#[test]
fn clear_blanks_the_glass_and_the_script_keeps_its_place() {
    let prompter = TestPrompter::new("clear");
    let script = prompter.script("Talk", &["One.", "Two.", "Three."]);
    assert_eq!(
        prompter.refused("prompter.clear", json!({})).0,
        "PROMPTER_NOTHING_ON"
    );
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.call(
        "prompter.jump",
        json!({ "to": "paragraph", "paragraph": 2 }),
    );
    let result = prompter.call("prompter.clear", json!({}));
    assert_eq!(result["sentence"], "Cleared the prompter.");
    let snapshot = prompter.snapshot();
    assert!(snapshot["glass"].is_null());
    assert_eq!(place(&snapshot["scripts"][0]["place"]), (2, 0));
    let glass = prompter.call("prompter.glass.snapshot", json!({}));
    assert_eq!(glass["paragraphs"], json!([]));
    for method in ["prompter.play", "prompter.pause", "prompter.update"] {
        assert_eq!(
            prompter.refused(method, json!({})).0,
            "PROMPTER_NOTHING_ON",
            "{method}"
        );
    }
}

// First step 1a: the clock runs in the layout the view reports. Without one
// the prompter cannot scroll or step a line, a stale report changes nothing,
// and one that does not fit the text is refused.
#[test]
fn the_take_runs_on_the_reported_layout() {
    let prompter = TestPrompter::new("layout");
    let script = prompter.script("Talk", &["one two three four five six", "seven eight nine"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    assert_eq!(
        prompter.refused("prompter.play", json!({})).0,
        "PROMPTER_NOT_LAID_OUT"
    );
    assert_eq!(
        prompter
            .refused("prompter.jump", json!({ "to": "nextLine" }))
            .0,
        "PROMPTER_NOT_LAID_OUT"
    );
    let snapshot = prompter.snapshot();
    assert_eq!(snapshot["glass"]["laidOut"], false);
    assert_eq!(snapshot["glass"]["estimated"], true);

    let stale = prompter.call(
        "prompter.layout.report",
        json!({ "layoutKey": "g0-l0", "lines": [], "endTop": 0 }),
    );
    assert_eq!(stale["accepted"], false);
    let key = snapshot["glass"]["layoutKey"].clone();
    let (code, _) = prompter.refused(
        "prompter.layout.report",
        json!({ "layoutKey": key, "lines": [{ "paragraph": 0, "word": 0, "top": 0, "height": 100 }], "endTop": 500 }),
    );
    assert_eq!(code, "INVALID_PARAMS", "a paragraph is missing");

    assert_eq!(prompter.lay_out(3, 100.0)["accepted"], true);
    let snapshot = prompter.snapshot();
    assert_eq!(snapshot["glass"]["laidOut"], true);
    assert_eq!(snapshot["glass"]["estimated"], false);

    let reply = prompter.reply("prompter.play", json!({})).unwrap();
    assert_eq!(reply.reason, Some("played"));
    let anchor = reply.anchor.expect("an anchor");
    assert!(anchor.playing);
    assert_eq!(anchor.to_wpm, 140.0);
    assert_eq!(anchor.ramp_ms, 300.0);
    assert_eq!(anchor.position, Some(0.0));

    prompter.call("prompter.jump", json!({ "to": "nextLine" }));
    assert_eq!(
        prompter.snapshot()["glass"]["playing"],
        true,
        "a line step never stops the scroll"
    );
    prompter.call("prompter.jump", json!({ "to": "top" }));
    let glass = prompter.snapshot()["glass"].clone();
    assert_eq!(glass["playing"], false, "TOP pauses");
    assert_eq!(place(&glass["place"]), (0, 0));
}

// §5.4 and D19: the scroll stops at END and stays stopped; PLAY is refused
// until a jump moves the place back.
#[test]
fn at_the_end_play_waits_for_a_jump_back() {
    let prompter = TestPrompter::new("end");
    let script = prompter.script("Short", &["Go."]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(5, 10.0);
    prompter.call("prompter.speed", json!({ "wpm": 300 }));
    prompter.call("prompter.play", json!({}));
    // One read word at 300 words a minute is 0.2 s, and the ease 0.15 s.
    thread::sleep(Duration::from_millis(700));
    let glass = prompter.snapshot()["glass"].clone();
    assert_eq!(glass["atEnd"], true);
    assert_eq!(glass["playing"], false);
    let (code, sentence) = prompter.refused("prompter.play", json!({}));
    assert_eq!(code, "PROMPTER_AT_END");
    assert_eq!(
        sentence,
        "The prompter is at the end of Short. Go back with BACK, TOP or a jump first."
    );
    prompter.call("prompter.jump", json!({ "to": "back" }));
    assert_eq!(prompter.snapshot()["glass"]["atEnd"], false);
    prompter.call("prompter.play", json!({}));
    thread::sleep(Duration::from_millis(700));
    assert_eq!(prompter.snapshot()["glass"]["atEnd"], true);

    // Put on again from its end, a script comes on at the top (§5.5).
    prompter.call("prompter.clear", json!({}));
    let row = prompter.snapshot()["scripts"][0].clone();
    assert_eq!(row["atEnd"], true, "it was left at its end");
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    assert_eq!(place(&prompter.snapshot()["glass"]["place"]), (0, 0));
}

// D12: a start never scrolls. The next start finds what the saved data
// holds: the script on the prompter at its place, paused.
#[test]
fn a_restart_finds_the_prompter_paused_at_its_place() {
    let prompter = TestPrompter::new("restart");
    let script = prompter.script("Talk", &["one two", "three four", "five six"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(2, 100.0);
    prompter.call(
        "prompter.jump",
        json!({ "to": "paragraph", "paragraph": 1 }),
    );
    prompter.call("prompter.play", json!({}));
    crate::prompter::runtime::forget(prompter.path());

    let glass = prompter.snapshot()["glass"].clone();
    assert_eq!(glass["name"], "Talk");
    assert_eq!(glass["playing"], false);
    assert_eq!(place(&glass["place"]), (1, 0));
    assert_eq!(
        glass["laidOut"], false,
        "the layout is reported again after a start"
    );
}

// §5 (answered in §14): BACK goes to the start of the paragraph at the
// reading line, and from its first line to the one before; the paragraph
// and cue steps go to the next or the one before.
#[test]
fn back_and_the_steps_go_where_the_proposal_says() {
    let prompter = TestPrompter::new("jumps");
    let script = prompter.script(
        "Talk",
        &[
            "[INTRO]",
            "one two three four",
            "[GUEST]",
            "five six seven eight",
            "nine ten",
        ],
    );
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    let at = || place(&prompter.snapshot()["glass"]["place"]);

    prompter.call(
        "prompter.jump",
        json!({ "to": "place", "paragraph": 3, "word": 2 }),
    );
    prompter.call("prompter.jump", json!({ "to": "back" }));
    assert_eq!(at(), (3, 0), "the start of its paragraph");
    prompter.call("prompter.jump", json!({ "to": "back" }));
    assert_eq!(at(), (2, 0), "from the first line, the paragraph before");
    prompter.call("prompter.jump", json!({ "to": "nextParagraph" }));
    assert_eq!(at(), (3, 0));
    prompter.call("prompter.jump", json!({ "to": "previousCue" }));
    assert_eq!(at(), (2, 0));
    prompter.call("prompter.jump", json!({ "to": "previousCue" }));
    assert_eq!(at(), (0, 0));
    assert_eq!(
        prompter
            .refused("prompter.jump", json!({ "to": "previousCue" }))
            .0,
        "PROMPTER_NO_CUE"
    );
    prompter.call("prompter.jump", json!({ "to": "nextCue" }));
    assert_eq!(at(), (2, 0));
    let cues = prompter.snapshot()["glass"]["cues"].clone();
    assert_eq!(
        cues,
        json!([
            { "paragraph": 0, "word": 0, "text": "INTRO" },
            { "paragraph": 2, "word": 0, "text": "GUEST" }
        ])
    );
    assert_eq!(
        prompter
            .refused(
                "prompter.jump",
                json!({ "to": "paragraph", "paragraph": 5 })
            )
            .0,
        "INVALID_PARAMS"
    );
    assert_eq!(
        prompter
            .refused("prompter.jump", json!({ "to": "sideways" }))
            .0,
        "INVALID_PARAMS"
    );
}

// §5.1 and §4.1: the pace is 40–300 words a minute in steps of 5 and is the
// script's own; the size moves in 4 px steps inside 48–160, Standard goes
// back, and a new standard carries the take's size along when it was at the
// standard.
#[test]
fn speed_size_and_look_stay_in_their_ranges() {
    let prompter = TestPrompter::new("look");
    let script = prompter.script("Talk", &["one two three"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    assert_eq!(
        prompter.call("prompter.speed", json!({ "step": 2 }))["speedWpm"],
        150
    );
    assert_eq!(
        prompter.call("prompter.speed", json!({ "step": -100 }))["speedWpm"],
        40
    );
    assert_eq!(
        prompter.refused("prompter.speed", json!({ "wpm": 142 })).0,
        "INVALID_PARAMS"
    );
    assert_eq!(
        prompter.snapshot()["scripts"][0]["speedWpm"],
        40,
        "the script's own pace"
    );

    let key_before = prompter.snapshot()["glass"]["layoutKey"].clone();
    assert_eq!(
        prompter.call("prompter.textSize", json!({ "step": 3 }))["sizePx"],
        100
    );
    let snapshot = prompter.snapshot();
    assert_ne!(
        snapshot["glass"]["layoutKey"], key_before,
        "a new size is laid out again"
    );
    assert_eq!(snapshot["sizePx"], 100);
    assert_eq!(
        prompter.call("prompter.textSize", json!({ "standard": true }))["sizePx"],
        88
    );
    assert_eq!(
        prompter.call("prompter.textSize", json!({ "step": -20 }))["sizePx"],
        48
    );
    assert_eq!(
        prompter
            .refused("prompter.textSize", json!({ "sizePx": 90 }))
            .0,
        "INVALID_PARAMS"
    );

    prompter.call("prompter.textSize", json!({ "standard": true }));
    prompter.call(
        "prompter.look.update",
        json!({ "standardSizePx": 96, "textColour": "yellow" }),
    );
    let snapshot = prompter.snapshot();
    assert_eq!(snapshot["look"]["standardSizePx"], 96);
    assert_eq!(snapshot["look"]["textColour"], "yellow");
    assert_eq!(
        snapshot["sizePx"], 96,
        "the take was at the standard, and follows it"
    );
    let key = snapshot["glass"]["layoutKey"].clone();
    prompter.call("prompter.look.update", json!({ "dimReadText": false }));
    assert_eq!(
        prompter.snapshot()["glass"]["layoutKey"],
        key,
        "dimming changes no line"
    );
}

// Review of 2026-09-27 (M1): the script on the glass keeps its place in the
// glass's text; when it was edited and never Updated, Clear and Replace carry
// the place into the edited text. (It was saved as it stood: five paragraphs
// cut above the reading line put the next put-on five paragraphs late.)
#[test]
fn letting_go_of_an_edited_script_carries_its_place_into_its_text() {
    let prompter = TestPrompter::new("release-edited");
    let paragraphs: Vec<String> = (0..10)
        .map(|index| format!("Paragraph number {index} here."))
        .collect();
    let texts: Vec<&str> = paragraphs.iter().map(String::as_str).collect();
    let script = prompter.script("Talk", &texts);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.call(
        "prompter.jump",
        json!({ "to": "place", "paragraph": 7, "word": 2 }),
    );
    // Paragraphs 2 to 4 cut, with no Update.
    let edited: Vec<&str> = texts[..2]
        .iter()
        .chain(texts[5..].iter())
        .copied()
        .collect();
    prompter.edit(&script, &edited);
    prompter.call("prompter.clear", json!({}));
    assert_eq!(
        place(&prompter.snapshot()["scripts"][0]["place"]),
        (4, 2),
        "the same words, in the edited text"
    );
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    assert_eq!(place(&prompter.snapshot()["glass"]["place"]), (4, 2));
}

// Review of 2026-09-27 (L1): when a request is the first to find the text at
// END, it says so with `at-end` as the clock's thread would.
#[test]
fn whoever_finds_the_text_at_the_end_announces_it() {
    let prompter = TestPrompter::new("announce-end");
    let script = prompter.script("Short", &["Go."]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(5, 10.0);
    prompter.call("prompter.speed", json!({ "wpm": 300 }));
    crate::prompter::runtime::ANNOUNCED_ENDS.with(|ends| ends.borrow_mut().clear());
    prompter.call("prompter.play", json!({}));
    thread::sleep(Duration::from_millis(700));
    prompter.snapshot();
    let announced = crate::prompter::runtime::ANNOUNCED_ENDS.with(|ends| ends.borrow().clone());
    assert_eq!(announced.len(), 1);
    assert!(announced[0].at_end && !announced[0].playing);
}

// Review of 2026-09-27 (L3): from the last paragraph there is no next one,
// and the text does not move (it went back to the paragraph's start).
#[test]
fn there_is_no_paragraph_after_the_last() {
    let prompter = TestPrompter::new("no-next");
    let script = prompter.script("Talk", &["one two three", "four five six"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.call(
        "prompter.jump",
        json!({ "to": "place", "paragraph": 1, "word": 2 }),
    );
    let (code, sentence) = prompter.refused("prompter.jump", json!({ "to": "nextParagraph" }));
    assert_eq!(code, "PROMPTER_NO_PARAGRAPH");
    assert_eq!(sentence, "There is no paragraph after the reading line.");
    assert_eq!(place(&prompter.snapshot()["glass"]["place"]), (1, 2));
}

// Review of 2026-09-27 (L4): the first layout reported for a key is the one
// the clock runs on; another view's for the same key moves nothing.
#[test]
fn the_first_layout_for_a_key_is_the_one_the_clock_runs_on() {
    let prompter = TestPrompter::new("first-layout");
    let script = prompter.script("Talk", &["one two three four five six seven eight"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(4, 100.0);
    prompter.call(
        "prompter.jump",
        json!({ "to": "place", "paragraph": 0, "word": 5 }),
    );
    let before = prompter.snapshot()["glass"]["anchor"].clone();
    let reply = prompter.reply("prompter.layout.report", {
        let glass = prompter.call("prompter.glass.snapshot", json!({}));
        json!({
            "layoutKey": glass["layoutKey"],
            "lines": [
                { "paragraph": 0, "word": 0, "top": 0, "height": 90 },
                { "paragraph": 0, "word": 3, "top": 90, "height": 90 },
                { "paragraph": 0, "word": 6, "top": 180, "height": 90 }
            ],
            "endTop": 400
        })
    });
    let reply = reply.expect("a second report is answered");
    assert_eq!(reply.result["accepted"], true);
    assert_eq!(reply.reason, None, "nothing moved, nothing to say");
    let after = prompter.snapshot()["glass"]["anchor"].clone();
    assert_eq!(after["position"], before["position"]);
    assert_eq!(after["wordOffset"], before["wordOffset"]);
}
