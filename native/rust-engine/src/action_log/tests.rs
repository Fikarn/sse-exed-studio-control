use super::*;
use crate::control_surface::test_support::TestDir;
use crate::storage::initialize_test_database;
use serde_json::json;

fn row(detail: &str) -> ActionRecord {
    ActionRecord::new(
        ActionSource::Ui,
        DOMAIN_LIGHTING,
        "all-off",
        "All lights",
        detail,
    )
}

// Finding F30: rows go in with their source, come back newest first, and the
// table never grows past its cap — the prune runs in the insert's own
// transaction, so the whole of this test waits for the disk five times.
#[test]
fn record_list_prune() {
    let test_dir = TestDir::new("action-log");
    let db_path = test_dir.db_path();
    initialize_test_database(db_path.as_path()).expect("database should initialize");

    assert!(
        list_recent_actions(db_path.as_path(), RECENT_ACTIONS_LIMIT)
            .expect("an empty log lists")
            .is_empty(),
        "a new database has no rows"
    );
    record_actions(db_path.as_path(), &[]).expect("nothing to write is not an error");

    record_actions(
        db_path.as_path(),
        &[
            row("first"),
            ActionRecord::new(
                ActionSource::Deck,
                DOMAIN_AUDIO,
                "mute",
                "Host mic",
                "Mute on: Host mic",
            ),
        ],
    )
    .expect("rows should be written");
    record_actions(
        db_path.as_path(),
        &[ActionRecord::new(
            ActionSource::Watchdog,
            DOMAIN_AUDIO,
            "talkback-off",
            "Talkback",
            "Talkback released: nobody was holding it",
        )],
    )
    .expect("a row should be written");

    let listed = list_recent_actions(db_path.as_path(), RECENT_ACTIONS_LIMIT).expect("rows list");
    assert_eq!(
        listed
            .iter()
            .map(|entry| (entry.source.as_str(), entry.detail.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("watchdog", "Talkback released: nobody was holding it"),
            ("deck", "Mute on: Host mic"),
            ("ui", "first"),
        ],
        "newest first, each with its source"
    );
    let newest = &listed[0];
    assert_eq!(
        (
            newest.domain.as_str(),
            newest.action.as_str(),
            newest.target.as_str()
        ),
        ("audio", "talkback-off", "Talkback")
    );
    assert!(
        newest.at.len() == 24 && newest.at.ends_with('Z') && newest.at.contains('T'),
        "UTC with milliseconds, got {}",
        newest.at
    );
    assert_eq!(
        list_recent_actions(db_path.as_path(), 2)
            .expect("rows list")
            .len(),
        2,
        "the limit is the caller's"
    );

    // Past the cap in one transaction: the oldest leave, the newest stay.
    let many = (0..ACTION_LOG_MAX_ROWS + 7)
        .map(|number| row(&format!("bulk {number}")))
        .collect::<Vec<_>>();
    record_actions(db_path.as_path(), &many).expect("the bulk insert should commit");
    let count_and_oldest = |db_path: &std::path::Path| -> (i64, String) {
        let connection = open_connection(db_path).expect("database opens");
        connection
            .query_row(
                "SELECT COUNT(*), (SELECT detail FROM event_log ORDER BY id ASC LIMIT 1) FROM event_log",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("count")
    };
    assert_eq!(
        count_and_oldest(db_path.as_path()),
        (ACTION_LOG_MAX_ROWS, String::from("bulk 7")),
        "exactly the cap is kept, and it is the newest"
    );

    record_actions(db_path.as_path(), &[row("one more")]).expect("a row should be written");
    assert_eq!(
        count_and_oldest(db_path.as_path()),
        (ACTION_LOG_MAX_ROWS, String::from("bulk 8"))
    );
    assert_eq!(
        list_recent_actions(db_path.as_path(), 1).expect("rows list")[0].detail,
        "one more"
    );
}

/// One request per recorded method that leaves at least one row.
fn ui_examples() -> Vec<(&'static str, Value, Value)> {
    vec![
        (
            "lighting.power.all",
            json!({ "on": false }),
            json!({ "affectedFixtures": 4 }),
        ),
        (
            "lighting.group.power",
            json!({ "groupId": "group-key", "on": true }),
            json!({ "groupId": "group-key", "groupName": "Key lights" }),
        ),
        (
            "lighting.fixture.update",
            json!({ "fixtureId": "fixture-key-left", "on": true, "dmxStartAddress": 21 }),
            json!({ "fixture": { "name": "Key left", "universe": 1, "dmxStartAddress": 21 } }),
        ),
        (
            "lighting.fixture.create",
            json!({ "name": "Hair light" }),
            json!({ "fixture": { "name": "Hair light" } }),
        ),
        (
            "lighting.fixture.delete",
            json!({ "fixtureId": "fixture-hair" }),
            json!({ "deleted": true, "fixtureId": "fixture-hair" }),
        ),
        (
            "lighting.scene.recall",
            json!({ "sceneId": "scene-interview" }),
            json!({ "sceneName": "Interview wide", "fadeDurationSeconds": 2.0, "previewMode": false }),
        ),
        (
            "lighting.palette.apply",
            json!({ "paletteId": "palette-cct-warm" }),
            json!({ "paletteName": "Warm", "affectedFixtures": 2, "previewMode": false }),
        ),
        (
            "lighting.settings.update",
            json!({ "enabled": false, "bridgeIp": "192.168.1.80" }),
            json!({ "enabled": false, "bridgeIp": "192.168.1.80", "universe": 1 }),
        ),
        (
            "lighting.fixture.identify",
            json!({ "fixtureId": "fixture-key-left" }),
            json!({ "fixtureId": "fixture-key-left", "durationMs": 1500 }),
        ),
        (
            "lighting.fixture.identifySequence",
            json!({ "fixtureIds": ["a", "b"] }),
            json!({ "fixtureCount": 2 }),
        ),
        (
            "lighting.fixture.identify.clearAll",
            json!({}),
            json!({ "clearedCount": 1 }),
        ),
        (
            "lighting.fixture.highlight",
            json!({ "fixtureIds": ["a"], "mode": "solo" }),
            json!({ "mode": "solo", "fixtureCount": 1 }),
        ),
        (
            "lighting.output.setArmed",
            json!({ "armed": false }),
            json!({ "armed": false }),
        ),
        (
            "audio.channel.update",
            json!({ "channelId": "audio-input-1", "mute": true, "phantom": true, "gain": 32 }),
            json!({ "id": "audio-input-1", "name": "Host mic" }),
        ),
        (
            "audio.mixTarget.update",
            json!({ "mixTargetId": "audio-mix-main", "dim": true, "volume": 0.4 }),
            json!({ "id": "audio-mix-main", "name": "Main out" }),
        ),
        (
            "audio.channel.eq.update",
            json!({ "channelId": "audio-input-1", "enabled": true, "lowCutEnabled": true, "bandId": "band-2", "bandEnabled": false }),
            json!({ "name": "Host mic" }),
        ),
        (
            "audio.channel.dynamics.update",
            json!({ "channelId": "audio-input-1", "section": "compressor", "enabled": true }),
            json!({ "name": "Host mic" }),
        ),
        (
            "audio.channel.send.update",
            json!({ "channelId": "audio-input-1", "mixTargetId": "audio-mix-phones-a", "preFader": true }),
            json!({ "name": "Host mic" }),
        ),
        (
            "audio.snapshot.recall",
            json!({ "snapshotId": "snap-1" }),
            json!({ "snapshotName": "Panel", "recalled": true }),
        ),
        (
            "audio.talkback.hold",
            json!({ "engaged": true }),
            json!({ "mixTargetId": "audio-mix-main", "talkback": true, "changed": true }),
        ),
        ("audio.solo.clearAll", json!({}), json!({})),
        (
            "audio.settings.update",
            json!({ "oscEnabled": true, "sendHost": "127.0.0.1" }),
            json!({ "sendHost": "127.0.0.1", "sendPort": 7001 }),
        ),
        (
            "commissioning.check.run",
            json!({ "target": "lighting", "bridgeIp": "192.168.1.80" }),
            json!({}),
        ),
        (
            "support.backup.restore",
            json!({ "path": "backups/archive.json" }),
            json!({ "requiresRestart": false }),
        ),
    ]
}

fn deck_examples() -> Vec<(&'static str, &'static str, Value)> {
    vec![
        (
            "/api/deck/light-action",
            "allOff",
            json!({ "on": false, "preview": false }),
        ),
        (
            "/api/deck/light-action",
            "toggleLight",
            json!({ "light": { "id": "fixture-key-left", "name": "Key left", "on": true }, "preview": false }),
        ),
        (
            "/api/deck/light-action",
            "resetIntensity",
            json!({ "light": { "id": "fixture-key-left", "name": "Key left", "intensity": 100 }, "preview": false }),
        ),
        (
            "/api/deck/light-action",
            "resetCct",
            json!({ "light": { "id": "fixture-key-left", "name": "Key left", "cct": 4500 }, "preview": false }),
        ),
        (
            "/api/deck/light-action",
            "recallScene",
            json!({ "recalled": "Interview wide", "preview": false }),
        ),
        (
            "/api/deck/audio-action",
            "recallSnapshot",
            json!({ "recalled": "Panel" }),
        ),
        (
            "/api/deck/audio-action",
            "dialPress",
            json!({ "strip": 1, "channelId": "audio-input-1", "name": "Host mic", "mute": true }),
        ),
        (
            "/api/deck/audio-action",
            "dimToggle",
            json!({ "mixTargetId": "audio-mix-main", "dim": true }),
        ),
        (
            "/api/deck/audio-action",
            "talkOn",
            json!({ "mixTargetId": "audio-mix-main", "talkback": true, "changed": true }),
        ),
        (
            "/api/deck/audio-action",
            "soloClearAll",
            json!({ "cleared": 2 }),
        ),
    ]
}

// The screen's table: a discrete change is a row, a ride in the same request
// is not, a staged change is not, and the heartbeat of a held key is not.
#[test]
fn ui_requests_leave_rows_for_discrete_changes_only() {
    for (method, params, result) in ui_examples() {
        let rows = ui_actions(method, &params, &result, false);
        assert!(!rows.is_empty(), "{method} should leave a row");
        assert!(
            rows.iter().all(|entry| entry.source == ActionSource::Ui),
            "{method}: a request is the screen's"
        );
        assert_eq!(
            ui_method_class(method),
            Some(UiMethodClass::Recorded),
            "{method} is in the recorded list"
        );
    }
    for method in RECORDED_UI_METHODS {
        assert!(
            ui_examples()
                .iter()
                .any(|(example, _, _)| example == method),
            "{method} has no example here, so nothing shows that it leaves a row"
        );
    }

    let details = |method: &str, params: Value, result: Value, staged: bool| {
        ui_actions(method, &params, &result, staged)
            .into_iter()
            .map(|entry| entry.detail)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        details(
            "audio.channel.update",
            json!({ "channelId": "a", "mute": true, "phantom": false, "gain": 30, "fader": 0.5 }),
            json!({ "name": "Host mic" }),
            false
        ),
        vec!["Mute on: Host mic", "48 V off: Host mic"],
        "the flags are rows; the gain and the fader in the same request are rides"
    );
    for ride in [
        json!({ "channelId": "a", "fader": 0.5 }),
        json!({ "channelId": "a", "gain": 30 }),
        json!({ "channelId": "a", "name": "Guest" }),
    ] {
        assert!(details(
            "audio.channel.update",
            ride,
            json!({ "name": "Host mic" }),
            false
        )
        .is_empty());
    }
    assert!(details(
        "lighting.fixture.update",
        json!({ "fixtureId": "f", "intensity": 40, "cct": 4000 }),
        json!({ "fixture": { "name": "Key left" } }),
        false
    )
    .is_empty());
    assert!(details(
        "lighting.settings.update",
        json!({ "grandMaster": 80, "selectedFixtureId": "f" }),
        json!({ "grandMaster": 80 }),
        false
    )
    .is_empty());
    assert_eq!(
        details(
            "lighting.scene.recall",
            json!({ "sceneId": "s" }),
            json!({ "sceneName": "Interview wide", "fadeDurationSeconds": 0.0 }),
            false
        ),
        vec!["Scene recalled: Interview wide"]
    );

    // Staged in the preview: nothing reached the rig.
    for method in PREVIEW_AWARE_UI_METHODS {
        assert!(ui_method_stages_in_preview(method));
        let (_, params, result) = ui_examples()
            .into_iter()
            .find(|(example, _, _)| example == method)
            .expect("an example");
        assert!(
            ui_actions(method, &params, &result, true).is_empty(),
            "{method} staged in the preview is not a row"
        );
    }
    assert!(!ui_method_stages_in_preview("lighting.output.setArmed"));

    // A heartbeat of the held talkback key, a staged database restore.
    assert!(details(
        "audio.talkback.hold",
        json!({ "engaged": true }),
        json!({ "talkback": true, "changed": false }),
        false
    )
    .is_empty());
    assert!(details(
        "support.backup.restore",
        json!({ "path": "backups/db.sqlite3" }),
        json!({ "requiresRestart": true }),
        false
    )
    .is_empty());
    assert!(details(
        "commissioning.check.run",
        json!({ "target": "lighting" }),
        json!({}),
        false
    )
    .is_empty());
}

// The deck's table: every row is the deck's; a dial detent, a selection and a
// key staged in the preview leave nothing.
#[test]
fn deck_keys_leave_rows_for_discrete_changes_only() {
    for (path, action, reply) in deck_examples() {
        let rows = deck_actions(path, action, &reply);
        assert_eq!(rows.len(), 1, "{action} should leave one row");
        assert_eq!(rows[0].source, ActionSource::Deck, "{action}");
    }
    let all_off = deck_actions(
        "/api/deck/light-action",
        "allOff",
        &json!({ "on": false, "preview": false }),
    );
    assert_eq!(
        (
            all_off[0].domain,
            all_off[0].action,
            all_off[0].detail.as_str()
        ),
        ("lighting", "all-off", "All lights off")
    );

    for (path, action, reply) in [
        (
            "/api/deck/light-action",
            "allOff",
            json!({ "on": false, "preview": true }),
        ),
        (
            "/api/deck/light-action",
            "recallScene",
            json!({ "recalled": "Interview wide", "preview": true }),
        ),
        (
            "/api/deck/light-action",
            "intensityUp",
            json!({ "light": { "id": "f", "name": "Key left", "intensity": 55 }, "preview": false }),
        ),
        (
            "/api/deck/light-action",
            "cctDown",
            json!({ "light": { "id": "f", "name": "Key left", "cct": 4300 }, "preview": false }),
        ),
        (
            "/api/deck/light-action",
            "selectNextLight",
            json!({ "selectedLightId": "f" }),
        ),
        (
            "/api/deck/light-action",
            "saveScene",
            json!({ "scene": { "id": "s", "name": "Scene 4" } }),
        ),
        (
            "/api/deck/light-action",
            "switchToDeckMode",
            json!({ "deckMode": "light" }),
        ),
        (
            "/api/deck/audio-action",
            "dialTurn",
            json!({ "strip": 1, "channelId": "a", "name": "Host mic", "fader": 0.62 }),
        ),
        (
            "/api/deck/audio-action",
            "stripTap",
            json!({ "strip": 1, "selectedChannelId": "a" }),
        ),
        (
            "/api/deck/audio-action",
            "cycleBank",
            json!({ "bank": "outputs" }),
        ),
        (
            "/api/deck/audio-action",
            "talkOn",
            json!({ "mixTargetId": "audio-mix-main", "talkback": true, "changed": false }),
        ),
        (
            "/api/deck/audio-action",
            "soloClearAll",
            json!({ "cleared": 0 }),
        ),
        (
            "/api/deck/action",
            "toggleTimer",
            json!({ "running": true }),
        ),
    ] {
        assert!(
            deck_actions(path, action, &reply).is_empty(),
            "{action} should leave no row"
        );
    }
}

// "Every hardware-affecting action has a row" holds only while every method
// has been looked at: a method added to the contract fails here until it is
// put in one list or the other, and a list entry the contract no longer has
// fails too.
#[test]
fn every_contract_method_is_classified() {
    let contract: Value = serde_json::from_str(include_str!("../../../protocol/v1.contract.json"))
        .expect("the contract parses");
    let methods = contract["methods"]
        .as_array()
        .expect("methods")
        .iter()
        .map(|method| method.as_str().expect("a method name"))
        .collect::<Vec<_>>();
    for method in &methods {
        assert!(
            ui_method_class(method).is_some(),
            "{method} is in neither RECORDED_UI_METHODS nor NOT_AN_ACTION_UI_METHODS"
        );
    }
    for listed in RECORDED_UI_METHODS.iter().chain(NOT_AN_ACTION_UI_METHODS) {
        assert!(methods.contains(listed), "{listed} is not in the contract");
    }
    for listed in RECORDED_UI_METHODS {
        assert!(
            !NOT_AN_ACTION_UI_METHODS.contains(listed),
            "{listed} is in both lists"
        );
    }
    assert_eq!(
        RECORDED_UI_METHODS.len() + NOT_AN_ACTION_UI_METHODS.len(),
        methods.len()
    );
}

// The sentences are printed to the operator as they are, and the copy gate
// reads the front-end's source only — so the rule it enforces is held here:
// never "engine", "backend", "transport", "IPC" — or "snapshot". The rows
// print on the Setup plate, outside the Console, and the UI contract's
// in-page scan allows that word inside the Console alone, whatever the
// sentence names (the Setup boards caught "Console snapshot recalled"). The
// Console's own word for what it saves is the mix.
#[test]
fn sentences_avoid_the_words_the_operator_never_reads() {
    let mut rows = Vec::new();
    for (method, params, result) in ui_examples() {
        rows.extend(ui_actions(method, &params, &result, false));
    }
    for (path, action, reply) in deck_examples() {
        rows.extend(deck_actions(path, action, &reply));
    }
    assert!(rows.len() > 30);

    let words = |sentence: &str| {
        sentence
            .to_lowercase()
            .split(|character: char| !character.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    for entry in rows {
        for sentence in [&entry.detail, &entry.target] {
            let words = words(sentence);
            for forbidden in [
                "engine",
                "backend",
                "transport",
                "ipc",
                "snapshot",
                "snapshots",
            ] {
                assert!(
                    !words.iter().any(|word| word == forbidden),
                    "\"{sentence}\" says {forbidden}"
                );
            }
        }
    }
}
