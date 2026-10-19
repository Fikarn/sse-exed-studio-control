//! The session's folder (D52) on saved data of its own: what a begin makes
//! and answers, a folder that exists, a parent, every refusal and their
//! order, the folder's name against the shared case table, and the settings
//! with their defaults, their checks and a damaged value. Every folder is
//! made inside the test's own temp folder: the places are a simulated run's,
//! whose new folders go in its scratch folder alone.

use super::folder::{
    folder_leaf, local_day, make_folder, name_problem, read_drive_path, FolderPlan, PathProblem,
    SESSION_DRIVE_MISSING, SESSION_FOLDER_MISSING, SESSION_FOLDER_NOT_MADE,
    SESSION_FOLDER_NOT_ON_A_DRIVE, SESSION_FOLDER_OUTSIDE_SCRATCH, SESSION_FOLDER_PATH_TOO_LONG,
};
use super::settings::{
    ROOT_KEY, SESSION_ROOT_INVALID, SESSION_SUBFOLDERS_INVALID, SESSION_THRESHOLDS_INVALID,
    SUBFOLDERS_KEY, THRESHOLDS_KEY,
};
use super::snapshot::SessionKind;
use super::tests::{TestSession, EVENING, MORNING, NOON};
use super::SessionError;
use crate::cameras::runtime::utc_time;
use crate::saved_json::complained_about;
use crate::storage::{open_connection, set_settings};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// What a folder holds, its names sorted.
fn listing(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .expect("the folder reads")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

fn sorted(names: &[&str]) -> Vec<String> {
    let mut names: Vec<String> = names.iter().map(|name| String::from(*name)).collect();
    names.sort();
    names
}

fn text(path: &Path) -> String {
    path.display().to_string()
}

/// A drive letter this PC has no drive for, looked for from Y: down to F:;
/// `None` when every one of them is there.
fn missing_drive() -> Option<char> {
    ('F'..='Y')
        .rev()
        .find(|letter| !Path::new(&format!("{letter}:\\")).exists())
}

fn refused(code: &'static str, sentence: &str) -> SessionError {
    SessionError::Refused(code, String::from(sentence))
}

impl TestSession {
    fn update(&self, params: Value) -> Value {
        let reply = self
            .request("session.settings.update", params, NOON)
            .expect("the update is answered");
        assert_eq!(reply.event, Some("settings"));
        reply.result
    }
}

#[test]
fn a_begin_makes_the_sessions_folder_the_folder_and_the_kinds_subfolders() {
    let test = TestSession::new("folder-made");
    assert!(!test.places.scratch_root.exists());
    let reply = test.begin("podcast", "Morning take", MORNING);
    let folder = test.folder("podcast", "Morning take", MORNING);
    assert_eq!(
        reply["folder"],
        json!({ "path": text(&folder), "made": true })
    );
    assert_eq!(reply["session"]["folder"], json!(text(&folder)));
    assert_eq!(folder.parent(), Some(test.places.scratch_root.as_path()));
    assert_eq!(
        listing(&folder),
        sorted(&["Audio", "Video", "vMix Recording", "Exports"])
    );
    // Each kind its own.
    let reply = test.begin("green-screen", "Lecture 3", NOON);
    let folder = PathBuf::from(reply["folder"]["path"].as_str().expect("a path"));
    assert_eq!(
        listing(&folder),
        sorted(&["Video", "vMix Recording", "Script", "Exports"])
    );
    let reply = test.begin("webinar", "", EVENING);
    let folder = PathBuf::from(reply["folder"]["path"].as_str().expect("a path"));
    assert_eq!(folder, test.folder("webinar", "", EVENING));
    assert!(text(&folder).ends_with(")"));
    assert_eq!(
        listing(&folder),
        sorted(&["Slides", "vMix Recording", "Exports"])
    );
}

#[test]
fn a_second_begin_of_one_name_on_one_day_uses_the_folder_and_makes_nothing_in_it() {
    let test = TestSession::new("folder-again");
    test.begin("podcast", "Morning take", MORNING);
    let folder = test.folder("podcast", "Morning take", MORNING);
    // The test's own folder: a subfolder taken away is not made again.
    fs::remove_dir(folder.join("Exports")).expect("the test's subfolder goes");
    fs::write(folder.join("Audio").join("take 1.wav"), b"RIFF").expect("a file");
    let reply = test.begin("podcast", "Morning take", NOON);
    assert_eq!(
        reply["folder"],
        json!({ "path": text(&folder), "made": false })
    );
    assert_eq!(
        listing(&folder),
        sorted(&["Audio", "Video", "vMix Recording"])
    );
    assert_eq!(
        listing(&folder.join("Audio")),
        vec![String::from("take 1.wav")]
    );
}

#[test]
fn a_kind_with_no_subfolders_makes_the_folder_alone() {
    let test = TestSession::new("folder-bare");
    test.update(json!({ "subfolders": { "webinar": [] } }));
    let reply = test.begin("webinar", "Spring launch", MORNING);
    let folder = test.folder("webinar", "Spring launch", MORNING);
    assert_eq!(
        reply["folder"],
        json!({ "path": text(&folder), "made": true })
    );
    assert!(listing(&folder).is_empty());
}

#[test]
fn a_folder_that_exists_is_used_as_it_is() {
    let test = TestSession::new("folder-existing");
    // Outside the scratch folder: a simulated run makes nothing there, and
    // uses a folder that is there.
    let series = test.root.join("All").join("Series (2026-10-01)");
    fs::create_dir_all(&series).expect("the test's folder");
    let written = text(&series).replace('\\', "/") + "/";
    let reply = test.begin_with(
        json!({ "kind": "podcast", "name": "Episode 4", "folder": { "mode": "existing", "path": written } }),
        MORNING,
    );
    assert_eq!(
        reply["folder"],
        json!({ "path": text(&series), "made": false })
    );
    assert_eq!(reply["session"]["folder"], json!(text(&series)));
    assert!(listing(&series).is_empty(), "nothing is made in it");
    assert!(
        !test.places.scratch_root.exists(),
        "nor is the sessions' folder"
    );
}

#[test]
fn a_new_folder_goes_in_the_parent_chosen() {
    let test = TestSession::new("folder-parent");
    let series = test.places.scratch_root.join("Leadership series");
    fs::create_dir_all(&series).expect("the test's folder");
    let reply = test.begin_with(
        json!({ "kind": "podcast", "name": "Episode 4", "folder": { "mode": "new", "parent": text(&series) } }),
        MORNING,
    );
    let day = local_day(utc_time(MORNING).expect("a time")).expect("the day");
    let folder = series.join(format!("Episode 4 ({day})"));
    assert_eq!(
        reply["folder"],
        json!({ "path": text(&folder), "made": true })
    );
    assert_eq!(
        listing(&folder),
        sorted(&["Audio", "Video", "vMix Recording", "Exports"])
    );
    // A parent that is null is the sessions' folder.
    let reply = test.begin_with(
        json!({ "kind": "webinar", "folder": { "mode": "new", "parent": null } }),
        NOON,
    );
    assert_eq!(
        reply["folder"]["path"],
        json!(text(&test.folder("webinar", "", NOON)))
    );
}

#[test]
fn a_folder_that_does_not_read_is_the_requests_fault() {
    let test = TestSession::new("folder-shape");
    let scratch = text(&test.places.scratch_root);
    for folder in [
        json!(3),
        json!("new"),
        json!({}),
        json!({ "mode": "old" }),
        json!({ "mode": "existing" }),
        json!({ "mode": "existing", "path": 4 }),
        json!({ "mode": "new", "parent": scratch, "name": "x" }),
        json!({ "mode": "new", "parent": "Sessions" }),
        json!({ "mode": "new", "parent": "C:Sessions" }),
        json!({ "mode": "new", "parent": r"\Sessions" }),
        json!({ "mode": "new", "parent": format!(r"{scratch}\..\elsewhere") }),
        json!({ "mode": "new", "parent": format!(r"{scratch}\.\here") }),
        json!({ "mode": "new", "parent": format!(r"{scratch}\\twice") }),
        json!({ "mode": "new", "parent": format!(r"\\?\{scratch}") }),
        json!({ "mode": "existing", "path": format!(r"{scratch}\a*b") }),
    ] {
        let refusal = test.refusal(
            "session.begin",
            json!({ "kind": "podcast", "folder": folder.clone() }),
        );
        assert!(
            matches!(refusal, SessionError::Invalid(_)),
            "{folder}: {refusal:?}"
        );
    }
    for folder in [
        json!({ "mode": "new", "parent": r"\\172.16.18.28\Public\Sessions" }),
        json!({ "mode": "existing", "path": "//172.16.18.28/Public/Series" }),
    ] {
        assert_eq!(
            test.refusal(
                "session.begin",
                json!({ "kind": "podcast", "folder": folder })
            ),
            refused(
                SESSION_FOLDER_NOT_ON_A_DRIVE,
                "Choose a folder on a drive with a letter, such as Public (Z:)."
            )
        );
    }
    assert!(
        !test.places.scratch_root.exists(),
        "a refusal makes nothing"
    );
    assert_eq!(test.snapshot()["current"], Value::Null);
}

#[test]
fn every_refusal_says_why_and_comes_in_its_order() {
    let test = TestSession::new("folder-refusals");
    let scratch = test.places.scratch_root.clone();
    let begin = |folder: Value| {
        test.refusal(
            "session.begin",
            json!({ "kind": "podcast", "name": "Take", "folder": folder }),
        )
    };

    // The kind and the name come first, the folder's shape after them.
    assert!(matches!(
        test.refusal("session.begin", json!({ "kind": "interview", "folder": 3 })),
        SessionError::Refused("SESSION_KIND_UNKNOWN", _)
    ));
    assert!(matches!(
        test.refusal(
            "session.begin",
            json!({ "kind": "podcast", "name": "a".repeat(81), "folder": 3 })
        ),
        SessionError::Refused("SESSION_NAME_TOO_LONG", _)
    ));

    // A drive that is not there, before the scratch folder's rule.
    if let Some(letter) = missing_drive() {
        assert_eq!(
            begin(json!({ "mode": "new", "parent": format!(r"{letter}:\Series") })),
            SessionError::Refused(
                SESSION_DRIVE_MISSING,
                format!("{letter}: is not there, so the session's folder cannot be made there. Choose a folder that exists, or set another sessions' folder in Setup / Support.")
            )
        );
        assert_eq!(
            begin(
                json!({ "mode": "existing", "path": format!(r"{letter}:\All\Old take (2026-10-01)") })
            ),
            SessionError::Refused(
                SESSION_DRIVE_MISSING,
                format!(
                    r"{letter}: is not there, so {letter}:\All\Old take (2026-10-01) cannot be used. Choose another folder."
                )
            )
        );
    }

    // Outside the scratch folder, in a simulated run, before the length.
    let outside_sentence = format!(
        "This run makes its folders only in {}, beside its own saved data.",
        text(&scratch)
    );
    assert_eq!(
        begin(json!({ "mode": "new", "parent": text(&test.root) })),
        SessionError::Refused(SESSION_FOLDER_OUTSIDE_SCRATCH, outside_sentence.clone())
    );
    let deep_outside = test.root.join("x".repeat(120));
    assert_eq!(
        begin(json!({ "mode": "new", "parent": text(&deep_outside) })),
        SessionError::Refused(SESSION_FOLDER_OUTSIDE_SCRATCH, outside_sentence)
    );

    // The length, before the parent's being there: the folder and its
    // longest subfolder, `vMix Recording`.
    let deep = scratch.join("y".repeat(100));
    let folder = deep.join(format!(
        "Take ({})",
        local_day(utc_time(NOON).expect("a time")).expect("the day")
    ));
    let length = text(&folder).encode_utf16().count() + r"\vMix Recording".len();
    assert!(length > 200, "{length}");
    assert_eq!(
        begin(json!({ "mode": "new", "parent": text(&deep) })),
        SessionError::Refused(
            SESSION_FOLDER_PATH_TOO_LONG,
            format!("That folder's path would be {length} characters, over 200: choose a shorter name, or a folder nearer the drive's top.")
        )
    );

    // A parent or a folder that is not there, or is a file.
    let gone = scratch.join("Gone series");
    assert_eq!(
        begin(json!({ "mode": "new", "parent": text(&gone) })),
        SessionError::Refused(
            SESSION_FOLDER_MISSING,
            format!(
                "{} is not there any more. Choose another folder.",
                text(&gone)
            )
        )
    );
    let old = test.root.join("All").join("Old take (2026-10-01)");
    assert_eq!(
        begin(json!({ "mode": "existing", "path": text(&old) })),
        SessionError::Refused(
            SESSION_FOLDER_MISSING,
            format!(
                "{} is not there any more. Choose another folder.",
                text(&old)
            )
        )
    );
    let file = test.root.join("notes.txt");
    fs::write(&file, b"notes").expect("the test's file");
    assert_eq!(
        begin(json!({ "mode": "existing", "path": text(&file) })),
        SessionError::Refused(
            SESSION_FOLDER_MISSING,
            format!(
                "{} is a file, not a folder. Choose another folder.",
                text(&file)
            )
        )
    );
    assert!(!scratch.exists(), "no refusal so far made anything");

    // A file where the new folder would be: Windows' reason.
    fs::create_dir_all(&scratch).expect("the scratch folder");
    let taken = test.folder("podcast", "Take", NOON);
    fs::write(&taken, b"in the way").expect("the test's file");
    match begin(json!({ "mode": "new" })) {
        SessionError::Refused(SESSION_FOLDER_NOT_MADE, sentence) => {
            let start = format!("{} could not be made: ", text(&taken));
            assert!(sentence.starts_with(&start), "{sentence}");
            assert!(
                sentence.ends_with('.') && !sentence.contains("os error"),
                "{sentence}"
            );
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(test.snapshot()["current"], Value::Null, "nothing began");
}

// The review of #354: a begin that made its folder and then cannot write the
// session says that the folder stays, and begins nothing. A trigger in the
// test's own saved data stands in for a write the saved data refuses.
#[test]
fn a_begin_that_cannot_save_the_session_says_its_folder_stays() {
    let test = TestSession::new("folder-unsaved");
    open_connection(&test.db_path)
        .expect("the database opens")
        .execute_batch(
            "CREATE TRIGGER refuse_the_session BEFORE INSERT ON app_settings \
             WHEN NEW.key = 'session.current' \
             BEGIN SELECT RAISE(ABORT, 'the saved data refused it'); END;",
        )
        .expect("the trigger is made");
    let folder = test.folder("podcast", "Take", NOON);
    match test.refusal(
        "session.begin",
        json!({ "kind": "podcast", "name": "Take" }),
    ) {
        SessionError::Storage(sentence) => {
            assert!(sentence.contains("the saved data refused it"), "{sentence}");
            assert!(
                sentence.ends_with(&format!(
                    ". {} was made, and is left as it is.",
                    text(&folder)
                )),
                "{sentence}"
            );
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        listing(&folder).len(),
        4,
        "the folder and its subfolders stay"
    );
    assert_eq!(test.snapshot()["current"], Value::Null, "nothing began");
}

// A failure after the folder was made leaves what was made, and the
// sentence says which; the checks would refuse such a list, so the acts are
// given it directly.
#[test]
fn a_subfolder_that_cannot_be_made_leaves_what_was_made() {
    let test = TestSession::new("folder-half");
    let folder = test.places.scratch_root.join("Half (2026-10-18)");
    let plan = FolderPlan::New {
        root: Some(test.places.scratch_root.clone()),
        folder: folder.clone(),
        subfolders: vec![String::from("Audio"), String::from(r"missing\Video")],
    };
    match make_folder(plan) {
        Err(SessionError::Refused(SESSION_FOLDER_NOT_MADE, sentence)) => {
            let start = format!(r"{}\missing\Video could not be made: ", text(&folder));
            assert!(sentence.starts_with(&start), "{sentence}");
            assert!(
                sentence.ends_with(&format!(
                    ". {} was made, with Audio, and is left as it is.",
                    text(&folder)
                )),
                "{sentence}"
            );
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(listing(&folder), vec![String::from("Audio")]);
}

#[test]
fn the_folders_name_holds_to_the_shared_case_table() {
    #[derive(Deserialize)]
    struct Case {
        name: String,
        kind: SessionKind,
        day: String,
        leaf: String,
    }
    #[derive(Deserialize)]
    struct Table {
        cases: Vec<Case>,
    }
    let table: Table =
        serde_json::from_str(include_str!("../../../protocol/session-folder-names.json"))
            .expect("the table reads");
    assert!(table.cases.len() >= 15);
    for case in table.cases {
        assert_eq!(
            folder_leaf(&case.name, case.kind, &case.day),
            case.leaf,
            "{:?}",
            case.name
        );
    }
}

#[test]
fn the_day_is_the_local_day() {
    // Noon UTC is the same day from UTC-11 to UTC+11.
    let day = local_day(utc_time("2026-10-18T12:00:00.000Z").expect("a time")).expect("the day");
    assert_eq!(day, "2026-10-18");
}

#[test]
fn a_path_is_read_as_windows_writes_it() {
    let read = |text: &str| read_drive_path(text).map(|path| path.text);
    assert_eq!(read(r"D:\Sessions"), Ok(String::from(r"D:\Sessions")));
    assert_eq!(read("d:/Sessions/"), Ok(String::from(r"D:\Sessions")));
    assert_eq!(
        read(r"Z:\Studio\Series 2\\"),
        Ok(String::from(r"Z:\Studio\Series 2"))
    );
    assert_eq!(read(r"E:\"), Ok(String::from(r"E:\")));
    assert_eq!(read("E:"), Err(PathProblem::Shape(String::from(
        "\"E:\" is not a folder's full path: it begins with a drive's letter, as D:\\Sessions does."
    ))));
    assert_eq!(read(r"\\server\share"), Err(PathProblem::Share));
    for shape in [
        "",
        "Sessions",
        r"1:\Sessions",
        r"D:Sessions",
        r"D:\a\..\b",
        r"D:\a\.",
        r"D:\a\\b",
        r"\\?\D:\Sessions",
        r"\\.\D:\Sessions",
        r"D:\a|b",
        "D:\\a\u{1}b",
        r"D:\Sessions.",
        r"D:\Sessions ",
        r"D:\NUL",
        r"D:\com1.txt",
    ] {
        assert!(
            matches!(read(shape), Err(PathProblem::Shape(_))),
            "{shape:?}: {:?}",
            read(shape)
        );
    }
}

#[test]
fn a_name_windows_does_not_take_is_said() {
    for good in [
        "Audio",
        "vMix Recording",
        ".hidden",
        "CONSOLE",
        "COM10",
        "Q&A",
    ] {
        assert_eq!(name_problem(good), None, "{good}");
    }
    assert_eq!(
        name_problem("Exports."),
        Some(String::from(
            "\"Exports.\" ends with a dot or a space, which Windows leaves out of a folder's name."
        ))
    );
    assert_eq!(
        name_problem("aux"),
        Some(String::from("\"aux\" is a name Windows keeps for itself."))
    );
    assert_eq!(
        name_problem("Lpt3 .wav"),
        Some(String::from(
            "\"Lpt3 .wav\" is a name Windows keeps for itself."
        ))
    );
    // Windows' whole list (the review of #354): the digit 0, the superscript
    // digits, and the console's two.
    for reserved in ["COM0", "lpt0", "COM¹", "lpt³.txt", "CONIN$", "conout$"] {
        assert_eq!(
            name_problem(reserved),
            Some(format!(
                "\"{reserved}\" is a name Windows keeps for itself."
            )),
            "{reserved}"
        );
    }
    assert_eq!(
        name_problem(".."),
        Some(String::from("\"..\" is not a folder's name."))
    );
    assert!(
        name_problem("Audio/Video").is_some_and(|problem| problem.contains("a control character"))
    );
}

#[test]
fn the_settings_read_their_defaults_and_the_places() {
    let test = TestSession::new("settings-defaults");
    let snapshot = test.snapshot();
    assert_eq!(
        snapshot["settings"],
        json!({
            "root": r"D:\Sessions",
            "subfolders": {
                "green-screen": ["Video", "vMix Recording", "Script", "Exports"],
                "podcast": ["Audio", "Video", "vMix Recording", "Exports"],
                "webinar": ["Slides", "vMix Recording", "Exports"]
            },
            "lowBelowGb": 200,
            "nearlyFullBelowGb": 50
        })
    );
    assert_eq!(
        snapshot["places"],
        json!({ "root": text(&test.places.scratch_root), "simulated": true })
    );
    let mut keys: Vec<&str> = snapshot
        .as_object()
        .expect("an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["current", "last", "places", "settings"]);
}

// Said once for its key: `saved_json`'s own test holds the once.
#[test]
fn a_damaged_setting_reads_as_its_default_and_is_said_in_the_log() {
    let test = TestSession::new("settings-damaged");
    set_settings(
        &test.db_path,
        &[
            (ROOT_KEY, json!("Sessions").to_string()),
            (SUBFOLDERS_KEY, json!({ "podcast": ["Audio"] }).to_string()),
            (
                THRESHOLDS_KEY,
                json!({ "lowBelowGb": 40, "nearlyFullBelowGb": 50 }).to_string(),
            ),
        ],
    )
    .expect("the settings are written");
    let settings = test.snapshot()["settings"].clone();
    assert_eq!(settings["root"], r"D:\Sessions");
    assert_eq!(
        settings["subfolders"]["podcast"].as_array().map(Vec::len),
        Some(4)
    );
    assert_eq!(
        (
            settings["lowBelowGb"].clone(),
            settings["nearlyFullBelowGb"].clone()
        ),
        (json!(200), json!(50))
    );
    for key in [ROOT_KEY, SUBFOLDERS_KEY, THRESHOLDS_KEY] {
        assert!(complained_about(key), "{key}");
    }
    // A list with a name Windows does not take is damaged too; a begin then
    // makes the kind's own.
    set_settings(
        &test.db_path,
        &[(
            SUBFOLDERS_KEY,
            json!({ "green-screen": [], "podcast": ["CON"], "webinar": [] }).to_string(),
        )],
    )
    .expect("the setting is written");
    let reply = test.begin("podcast", "Take", MORNING);
    let folder = PathBuf::from(reply["folder"]["path"].as_str().expect("a path"));
    assert_eq!(listing(&folder).len(), 4);
}

#[test]
fn an_update_writes_what_it_gives_and_answers_the_settings() {
    let test = TestSession::new("settings-update");
    let reply = test.update(json!({ "root": "e:/Studio/Sessions 2026/" }));
    assert_eq!(reply["settings"]["root"], r"E:\Studio\Sessions 2026");
    assert_eq!(
        test.setting(ROOT_KEY),
        Some(json!(r"E:\Studio\Sessions 2026"))
    );
    assert_eq!(test.setting(SUBFOLDERS_KEY), None, "only what it gives");
    // A simulated run keeps making its folders in its scratch folder.
    assert_eq!(
        test.snapshot()["places"]["root"],
        json!(text(&test.places.scratch_root))
    );

    let reply =
        test.update(json!({ "subfolders": { "webinar": [" Slides ", "Q&A", "vMix Recording"] } }));
    assert_eq!(
        reply["settings"]["subfolders"],
        json!({
            "green-screen": ["Video", "vMix Recording", "Script", "Exports"],
            "podcast": ["Audio", "Video", "vMix Recording", "Exports"],
            "webinar": ["Slides", "Q&A", "vMix Recording"]
        })
    );
    assert_eq!(
        test.setting(SUBFOLDERS_KEY),
        Some(reply["settings"]["subfolders"].clone())
    );

    let reply = test.update(json!({ "lowBelowGb": 300 }));
    assert_eq!(
        (
            reply["settings"]["lowBelowGb"].clone(),
            reply["settings"]["nearlyFullBelowGb"].clone()
        ),
        (json!(300), json!(50))
    );
    let reply = test.update(json!({ "lowBelowGb": 120.0, "nearlyFullBelowGb": 20 }));
    assert_eq!(
        test.setting(THRESHOLDS_KEY),
        Some(json!({ "lowBelowGb": 120, "nearlyFullBelowGb": 20 }))
    );
    assert_eq!(reply["settings"]["root"], r"E:\Studio\Sessions 2026");
    assert_eq!(test.snapshot()["settings"], reply["settings"]);
}

#[test]
fn an_update_is_checked_and_a_refused_one_writes_nothing() {
    let test = TestSession::new("settings-refused");
    let before = test.snapshot()["settings"].clone();
    let update = |params: Value| test.refusal("session.settings.update", params);

    for params in [
        json!({}),
        json!({ "root": null }),
        json!({ "subfolders": {} }),
        json!({ "rot": r"E:\Sessions" }),
        json!({ "root": 3 }),
        json!({ "subfolders": { "interview": [] } }),
        json!({ "subfolders": { "podcast": "Audio" } }),
        json!({ "lowBelowGb": "200" }),
        json!([]),
    ] {
        assert!(
            matches!(update(params.clone()), SessionError::Invalid(_)),
            "{params}"
        );
    }

    for (root, sentence) in [
        (
            "Sessions",
            "\"Sessions\" is not a folder's full path: it begins with a drive's letter, as D:\\Sessions does.",
        ),
        (
            r"\\172.16.18.28\Public",
            "The sessions' folder is on a drive with a letter, such as Public (Z:), not a share's path.",
        ),
        (
            r"E:\Sessions.",
            "\"Sessions.\" ends with a dot or a space, which Windows leaves out of a folder's name.",
        ),
        (r"E:\CON", "\"CON\" is a name Windows keeps for itself."),
    ] {
        assert_eq!(
            update(json!({ "root": root })),
            refused(SESSION_ROOT_INVALID, sentence),
            "{root}"
        );
    }
    let long = format!(r"E:\{}", "s".repeat(118));
    assert_eq!(
        update(json!({ "root": long })),
        refused(
            SESSION_ROOT_INVALID,
            "The sessions' folder's path has at most 120 characters; this one has 121."
        )
    );

    let podcast = |names: Value| update(json!({ "subfolders": { "podcast": names } }));
    let long = "x".repeat(41);
    for (names, sentence) in [
        (
            json!(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
            String::from("Podcast Recording has at most 8 subfolders; this list has 9."),
        ),
        (
            json!(["Audio", "  "]),
            String::from("A subfolder of Podcast Recording has no name."),
        ),
        (
            json!([long]),
            format!("\"{long}\" has 41 characters: a subfolder's name has at most 40."),
        ),
        (
            json!(["Exports."]),
            String::from(
                "\"Exports.\" ends with a dot or a space, which Windows leaves out of a folder's name.",
            ),
        ),
        (json!([".."]), String::from("\"..\" is not a folder's name.")),
        (
            json!(["NUL"]),
            String::from("\"NUL\" is a name Windows keeps for itself."),
        ),
        (
            json!(["Audio", "Audio"]),
            String::from("Podcast Recording has \"Audio\" twice."),
        ),
        (
            json!(["Audio", " audio"]),
            String::from(
                "Podcast Recording has \"Audio\" and \"audio\", which Windows takes for one name.",
            ),
        ),
    ] {
        assert_eq!(
            podcast(names.clone()),
            SessionError::Refused(SESSION_SUBFOLDERS_INVALID, sentence),
            "{names}"
        );
    }
    assert!(matches!(
        podcast(json!(["Audio/Video"])),
        SessionError::Refused(SESSION_SUBFOLDERS_INVALID, _)
    ));

    for (params, sentence) in [
        (
            json!({ "nearlyFullBelowGb": 0 }),
            "Nearly full is at least 1 GB.",
        ),
        (
            json!({ "lowBelowGb": 40 }),
            "Low must be above Nearly full: Low under 40 GB, Nearly full under 50 GB.",
        ),
        (
            json!({ "lowBelowGb": 50, "nearlyFullBelowGb": 50 }),
            "Low must be above Nearly full: Low under 50 GB, Nearly full under 50 GB.",
        ),
        (
            json!({ "lowBelowGb": 100_001 }),
            "Low is at most 100,000 GB.",
        ),
        (
            json!({ "lowBelowGb": 200.5 }),
            "Low is a whole number of GB; 200.5 is not.",
        ),
        (
            json!({ "nearlyFullBelowGb": -5 }),
            "Nearly full is at least 1 GB.",
        ),
    ] {
        assert_eq!(
            update(params.clone()),
            refused(SESSION_THRESHOLDS_INVALID, sentence),
            "{params}"
        );
    }

    // The folder is checked first; one part refused writes none of them.
    assert!(matches!(
        update(json!({ "root": "Sessions", "lowBelowGb": 40 })),
        SessionError::Refused(SESSION_ROOT_INVALID, _)
    ));
    assert!(matches!(
        update(json!({ "root": r"E:\Sessions", "subfolders": { "podcast": ["NUL"] } })),
        SessionError::Refused(SESSION_SUBFOLDERS_INVALID, _)
    ));
    assert!(matches!(
        update(json!({ "root": r"E:\Sessions", "lowBelowGb": 40 })),
        SessionError::Refused(SESSION_THRESHOLDS_INVALID, _)
    ));
    assert_eq!(test.snapshot()["settings"], before);
    for key in [ROOT_KEY, SUBFOLDERS_KEY, THRESHOLDS_KEY] {
        assert_eq!(test.setting(key), None, "{key}");
    }
}
