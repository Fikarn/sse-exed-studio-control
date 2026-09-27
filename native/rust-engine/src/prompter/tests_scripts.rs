//! The prompter's scripts through the request path (new pages program,
//! Slice 4; the proposal §3.3): made, renamed, edited, removed, restored,
//! deleted for good, and their versions.

use crate::prompter::model::{PrompterParagraph, PrompterRun, MAX_SCRIPT_WORDS};
use crate::prompter::store::VERSIONS_KEPT;
use crate::prompter::test_support::TestPrompter;
use serde_json::{json, Value};

fn names(list: &Value) -> Vec<String> {
    list.as_array()
        .expect("a list")
        .iter()
        .map(|row| row["name"].as_str().expect("a name").to_string())
        .collect()
}

// §3.3: the list is sorted by name with numbers in their natural order, so a
// running order is a matter of naming; New script takes the next free name.
#[test]
fn the_list_is_sorted_by_name_and_new_scripts_take_a_free_name() {
    let prompter = TestPrompter::new("names");
    for name in ["10 Outro", "2 Guest", "01 Intro"] {
        prompter.call("prompter.script.create", json!({ "name": name }));
    }
    assert_eq!(
        prompter.call("prompter.script.create", json!({}))["name"],
        "New script"
    );
    assert_eq!(
        prompter.call("prompter.script.create", json!({}))["name"],
        "New script 2"
    );
    assert_eq!(
        names(&prompter.snapshot()["scripts"]),
        [
            "01 Intro",
            "2 Guest",
            "10 Outro",
            "New script",
            "New script 2"
        ]
    );
    let id = prompter.snapshot()["scripts"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let renamed = prompter.call(
        "prompter.script.rename",
        json!({ "scriptId": id, "name": "  00   Cold\nopen  " }),
    );
    assert_eq!(
        renamed["name"], "00 Cold open",
        "one line, spaces collapsed"
    );
    assert_eq!(
        prompter
            .refused(
                "prompter.script.rename",
                json!({ "scriptId": id, "name": "   " })
            )
            .0,
        "INVALID_PARAMS"
    );
    assert_eq!(
        prompter
            .refused(
                "prompter.script.rename",
                json!({ "scriptId": "script-none", "name": "X" })
            )
            .0,
        "PROMPTER_SCRIPT_UNKNOWN"
    );
}

// §3.3: saved as you type — an edit is the script's text at once, with its
// emphasis, and counts its words; a script over 30,000 words is refused.
#[test]
fn an_edit_is_saved_with_its_emphasis_and_its_counts() {
    let prompter = TestPrompter::new("edit");
    let id = prompter.script("Talk", &["placeholder"]);
    let paragraphs = vec![
        PrompterParagraph {
            runs: vec![
                PrompterRun::plain("Hello "),
                PrompterRun {
                    text: String::from("there"),
                    bold: true,
                    ..PrompterRun::default()
                },
                PrompterRun::plain("\u{FEFF} friend\r\nagain"),
            ],
        },
        PrompterParagraph::plain("[PAUSE]"),
        PrompterParagraph::default(),
    ];
    let result = prompter.call(
        "prompter.script.edit",
        json!({ "scriptId": id, "paragraphs": paragraphs }),
    );
    assert!(result["changedAt"]
        .as_str()
        .is_some_and(|at| at.ends_with('Z')));
    let script = prompter.call("prompter.script.snapshot", json!({ "scriptId": id }));
    assert_eq!(
        script["paragraphs"][0]["runs"],
        json!([
            { "text": "Hello ", "bold": false, "italic": false, "underline": false },
            { "text": "there", "bold": true, "italic": false, "underline": false },
            { "text": " friend\nagain", "bold": false, "italic": false, "underline": false }
        ])
    );
    assert_eq!(
        script["paragraphs"][2],
        json!({ "runs": [] }),
        "an empty paragraph stays"
    );
    assert_eq!(script["script"]["readWords"], 4, "the cue is not read");
    assert_eq!(script["script"]["paragraphCount"], 3);
    assert_eq!(
        script["cues"],
        json!([{ "paragraph": 1, "word": 0, "text": "PAUSE" }])
    );

    let too_long = vec![PrompterParagraph::plain(
        "word ".repeat(MAX_SCRIPT_WORDS + 1),
    )];
    assert_eq!(
        prompter
            .refused(
                "prompter.script.edit",
                json!({ "scriptId": id, "paragraphs": too_long })
            )
            .0,
        "PROMPTER_SCRIPT_TOO_LONG"
    );
}

// §5.2: the place is words, so an edit elsewhere in a script leaves the
// words at its place; the script on the prompter keeps the glass's place
// until Update (§6.3).
#[test]
fn an_edit_moves_the_place_with_the_words() {
    let prompter = TestPrompter::new("edit-place");
    let away = prompter.script("Away", &["a b", "c d", "e f"]);
    prompter.call("prompter.putOn", json!({ "scriptId": away }));
    prompter.call(
        "prompter.jump",
        json!({ "to": "place", "paragraph": 2, "word": 1 }),
    );
    prompter.call("prompter.clear", json!({}));
    prompter.edit(&away, &["new", "a b", "c d", "e f"]);
    let row = prompter.snapshot()["scripts"][0].clone();
    assert_eq!(row["place"], json!({ "paragraph": 3, "word": 1 }));

    prompter.call("prompter.putOn", json!({ "scriptId": away }));
    prompter.edit(&away, &["newer", "new", "a b", "c d", "e f"]);
    assert_eq!(
        prompter.snapshot()["glass"]["place"],
        json!({ "paragraph": 3, "word": 1 }),
        "the glass's place is in the glass's text"
    );
}

// §3.3: Remove moves a script to Removed; the one on the prompter cannot be
// removed; Restore brings it back; only Delete for good in Removed ends it.
#[test]
fn removed_scripts_come_back_and_only_a_removed_one_is_deleted() {
    let prompter = TestPrompter::new("removed");
    let on = prompter.script("On air", &["words"]);
    let off = prompter.script("Spare", &["words"]);
    prompter.call("prompter.putOn", json!({ "scriptId": on }));
    let (code, sentence) = prompter.refused("prompter.script.remove", json!({ "scriptId": on }));
    assert_eq!(code, "PROMPTER_SCRIPT_ON_PROMPTER");
    assert_eq!(
        sentence,
        "On air is on the prompter. Clear the prompter first."
    );
    let (code, _) = prompter.refused("prompter.script.delete", json!({ "scriptId": off }));
    assert_eq!(code, "PROMPTER_SCRIPT_NOT_REMOVED");

    prompter.call("prompter.script.remove", json!({ "scriptId": off }));
    let snapshot = prompter.snapshot();
    assert_eq!(names(&snapshot["scripts"]), ["On air"]);
    assert_eq!(names(&snapshot["removed"]), ["Spare"]);
    assert!(snapshot["removed"][0]["removedAt"].is_string());
    let (code, _) = prompter.refused(
        "prompter.putOn",
        json!({ "scriptId": off, "replace": true }),
    );
    assert_eq!(code, "PROMPTER_SCRIPT_REMOVED");

    prompter.call("prompter.script.restore", json!({ "scriptId": off }));
    assert_eq!(names(&prompter.snapshot()["scripts"]), ["On air", "Spare"]);
    prompter.call("prompter.script.remove", json!({ "scriptId": off }));
    prompter.call("prompter.script.delete", json!({ "scriptId": off }));
    let snapshot = prompter.snapshot();
    assert_eq!(names(&snapshot["removed"]), Vec::<String>::new());
    assert_eq!(
        prompter
            .refused("prompter.script.snapshot", json!({ "scriptId": off }))
            .0,
        "PROMPTER_SCRIPT_UNKNOWN"
    );
}

// §3.3: every time a script's text goes on the prompter it is kept as a
// version, the last 20 are kept, and bringing one back keeps the text it
// replaces.
#[test]
fn versions_are_kept_and_brought_back() {
    let prompter = TestPrompter::new("versions");
    let id = prompter.script("Talk", &["first text"]);
    prompter.call("prompter.putOn", json!({ "scriptId": id }));
    let versions =
        prompter.call("prompter.script.snapshot", json!({ "scriptId": id }))["versions"].clone();
    assert_eq!(versions.as_array().unwrap().len(), 1);
    assert_eq!(versions[0]["reason"], "put-on");

    for round in 0..(VERSIONS_KEPT + 3) {
        prompter.edit(&id, &[&format!("text number {round}")]);
        prompter.call("prompter.update", json!({}));
    }
    let versions =
        prompter.call("prompter.script.snapshot", json!({ "scriptId": id }))["versions"].clone();
    assert_eq!(versions.as_array().unwrap().len(), VERSIONS_KEPT as usize);
    assert_eq!(versions[0]["reason"], "updated");
    let oldest_kept = versions[VERSIONS_KEPT as usize - 1]["id"].clone();

    prompter.edit(&id, &["unsaved thought"]);
    prompter.call(
        "prompter.script.version.bringBack",
        json!({ "scriptId": id, "versionId": oldest_kept }),
    );
    let script = prompter.call("prompter.script.snapshot", json!({ "scriptId": id }));
    assert_eq!(script["paragraphs"][0]["runs"][0]["text"], "text number 3");
    assert_eq!(script["versions"][0]["reason"], "before-bringing-back");
    assert_eq!(
        prompter.snapshot()["glass"]["notUpdated"],
        true,
        "the glass waits for Update"
    );
    assert_eq!(
        prompter
            .refused(
                "prompter.script.version.bringBack",
                json!({ "scriptId": id, "versionId": 1 })
            )
            .0,
        "PROMPTER_VERSION_UNKNOWN",
        "the first version was let go"
    );
}

fn base64(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

// First step 2a: a file comes from the page's own picker as its name and its
// bytes; the hardware link reads it itself, keeps it as a new script named
// after the file, keeps the text as a version, and answers with the import
// sentence. Opened again with `updateScriptId`, it becomes that script's
// text, the earlier text kept.
#[test]
fn a_file_arrives_as_its_name_and_its_bytes() {
    let prompter = TestPrompter::new("import-file");
    let text = "First para\nline two\n\n[PAUSE]\n\nSecond å ä ö";
    let imported = prompter.call(
        "prompter.script.import",
        json!({ "fileName": "Interview intro.txt", "contentBase64": base64(text.as_bytes()) }),
    );
    assert_eq!(
        imported["sentence"],
        "Imported Interview intro.txt: 3 paragraphs, 9 words, 1 cue. Read as UTF-8."
    );
    assert_eq!(imported["name"], "Interview intro");
    let id = imported["scriptId"].as_str().unwrap().to_string();
    let script = prompter.call("prompter.script.snapshot", json!({ "scriptId": id }));
    assert_eq!(script["script"]["sourceFileName"], "Interview intro.txt");
    assert_eq!(
        script["paragraphs"][0]["runs"][0]["text"],
        "First para\nline two"
    );
    assert_eq!(script["paragraphs"][2]["runs"][0]["text"], "Second å ä ö");
    assert_eq!(script["versions"][0]["reason"], "imported");

    // Edited since, so the text the file replaces is not a kept version yet
    // (one that is, is not kept twice).
    prompter.edit(&id, &["Edited by hand."]);
    let again = prompter.call(
        "prompter.script.import",
        json!({
            "fileName": "Interview intro.txt",
            "contentBase64": base64(b"Rewritten."),
            "updateScriptId": id,
        }),
    );
    assert_eq!(again["scriptId"], json!(id));
    assert!(again["sentence"].as_str().unwrap().ends_with(
        " It is now the text of Interview intro; the earlier text is kept among its versions."
    ));
    let script = prompter.call("prompter.script.snapshot", json!({ "scriptId": id }));
    assert_eq!(script["paragraphs"][0]["runs"][0]["text"], "Rewritten.");
    let reasons: Vec<&str> = script["versions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|version| version["reason"].as_str().unwrap())
        .collect();
    assert_eq!(reasons, ["imported", "before-file-update", "imported"]);
    assert_eq!(names(&prompter.snapshot()["scripts"]), ["Interview intro"]);
}

// §3.1: what is not read is refused with the operator's sentence, and
// nothing is kept.
#[test]
fn a_file_that_is_not_read_is_refused_and_nothing_is_kept() {
    let prompter = TestPrompter::new("import-refused");
    let (code, sentence) = prompter.refused(
        "prompter.script.import",
        json!({ "fileName": "Old.doc", "contentBase64": base64(b"\xD0\xCF\x11\xE0") }),
    );
    assert_eq!(code, "PROMPTER_IMPORT_REFUSED");
    assert_eq!(
        sentence,
        "Old.doc is in Word's old format (.doc), which Studio Control does not read. Save it as .docx in Word, then open that."
    );
    let (code, _) = prompter.refused(
        "prompter.script.import",
        json!({ "fileName": "Notes.pdf", "contentBase64": base64(b"%PDF-1.7") }),
    );
    assert_eq!(code, "PROMPTER_IMPORT_REFUSED");
    let (code, _) = prompter.refused(
        "prompter.script.import",
        json!({ "fileName": "Script.txt", "contentBase64": "not base64!" }),
    );
    assert_eq!(code, "INVALID_PARAMS");
    let (code, sentence) = prompter.refused(
        "prompter.script.import",
        json!({ "fileName": "Blank.txt", "contentBase64": base64(b"  \n\n ") }),
    );
    assert_eq!(code, "PROMPTER_IMPORT_REFUSED");
    assert_eq!(sentence, "Blank.txt has no text in it.");
    assert_eq!(names(&prompter.snapshot()["scripts"]), Vec::<String>::new());
}

// First step 3a: what the page read from the clipboard — its HTML when it
// held formatting — becomes a new script named after its first words, the
// emphasis kept and a heading a cue.
#[test]
fn a_paste_becomes_a_script_named_after_its_first_words() {
    let prompter = TestPrompter::new("paste");
    let pasted = prompter.call(
        "prompter.script.paste",
        json!({
            "html": "<p>Good evening and <b>welcome</b> to the programme tonight</p><h2>Guest</h2>",
            "text": "Good evening and welcome to the programme tonight\n\nGuest",
        }),
    );
    assert_eq!(pasted["name"], "Good evening and welcome to the");
    assert_eq!(
        pasted["sentence"],
        "Imported the pasted text: 2 paragraphs, 9 words, 1 cue."
    );
    let id = pasted["scriptId"].as_str().unwrap();
    let script = prompter.call("prompter.script.snapshot", json!({ "scriptId": id }));
    assert_eq!(script["paragraphs"][0]["runs"][1]["text"], "welcome");
    assert_eq!(script["paragraphs"][0]["runs"][1]["bold"], true);
    assert_eq!(script["paragraphs"][1]["runs"][0]["text"], "[Guest]");
    assert_eq!(script["script"]["sourceFileName"], Value::Null);
    let (code, sentence) = prompter.refused(
        "prompter.script.paste",
        json!({ "html": "<p> </p>", "text": "" }),
    );
    assert_eq!(code, "PROMPTER_IMPORT_REFUSED");
    assert_eq!(sentence, "The pasted text has no text in it.");
}
