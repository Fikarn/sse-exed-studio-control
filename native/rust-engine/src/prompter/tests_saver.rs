//! The prompter's saver (2026-10-02, after the afternoon recording): the
//! take's controls, the deck and the clock wait for no disk; the newest
//! value always reaches the disk; a save taken before the glass changed is
//! refused; the lists, a restart and a stop read what the saver holds.

use crate::prompter::clock::PrompterPlace;
use crate::prompter::deck::{deck_texts, handle_deck_action};
use crate::prompter::runtime::{finish_saving, flush_saves, forget, saver_of};
use crate::prompter::saver::{hooks, GlassSave, Urgency};
use crate::prompter::store;
use crate::prompter::test_support::{hold_the_write_lock, TestPrompter};
use crate::storage::open_connection;
use serde_json::json;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

/// The script's place and pace as the disk has them.
fn stored(prompter: &TestPrompter, id: &str) -> (PrompterPlace, u32) {
    let connection = open_connection(prompter.path()).expect("a connection");
    let script = store::read_script(&connection, id)
        .expect("the script reads")
        .expect("the script is there");
    (script.place, script.speed_wpm)
}

fn glass_revision(path: &Path) -> i64 {
    let connection = open_connection(path).expect("a connection");
    store::read_prompter(&connection)
        .expect("the prompter reads")
        .glass_revision
}

/// A script of eight paragraphs on the glass, laid out; its id.
fn on_the_glass(prompter: &TestPrompter, name: &str) -> String {
    let paragraphs: Vec<String> = (1..=8)
        .map(|index| format!("Paragraph {index} has a few words in it."))
        .collect();
    let paragraphs: Vec<&str> = paragraphs.iter().map(String::as_str).collect();
    let id = prompter.script(name, &paragraphs);
    prompter.call("prompter.putOn", json!({ "scriptId": id }));
    prompter.lay_out(4, 100.0);
    id
}

// The afternoon of 2026-10-02: one write that took 449 ms held every turn of
// the dial behind it, and the glass jumped back 17 px and forward 14 px.
#[test]
fn a_turn_of_the_speed_dial_waits_for_no_disk() {
    let prompter = TestPrompter::with_saver("saver-dial");
    let id = on_the_glass(&prompter, "Dial");
    let writer = hold_the_write_lock(prompter.path(), Duration::from_millis(600));

    let started = Instant::now();
    handle_deck_action(prompter.path(), "speed", Some("up")).expect("the dial turns");
    handle_deck_action(prompter.path(), "speed", Some("up")).expect("the dial turns");
    let took = started.elapsed();
    let texts = deck_texts(prompter.path()).expect("the displays read");
    assert!(
        took < Duration::from_millis(300),
        "two detents took {took:?} behind a held disk"
    );
    assert!(texts
        .iter()
        .any(|(key, text)| *key == "prompter_speed" && text == "SPEED\\n150"));

    writer.join().expect("the writer lets go");
    assert!(flush_saves(prompter.path(), Duration::from_secs(5)));
    assert_eq!(stored(&prompter, &id).1, 150);
}

// A dial turned forward and back while a write is on its way ends with the
// place it came back to (the critic of the design, 2026-10-02).
#[test]
fn the_newest_place_reaches_the_disk_after_a_write_on_its_way() {
    let prompter = TestPrompter::new("saver-newest");
    let id = on_the_glass(&prompter, "Newest");
    let saver = saver_of(prompter.path());
    let revision = glass_revision(prompter.path());
    let save = |paragraph: u32| GlassSave {
        script_id: id.clone(),
        glass_revision: revision,
        place: PrompterPlace { paragraph, word: 0 },
        speed_wpm: 140,
    };
    saver.keep_glass(save(2), Urgency::Now);
    assert_eq!(stored(&prompter, &id).0.paragraph, 2);

    hooks::hold_writes(&saver);
    saver.keep_glass(save(3), Urgency::Now);
    let taken = hooks::take(&saver).expect("a write to make");
    saver.keep_glass(save(2), Urgency::Now);
    hooks::write(&saver, taken);
    assert_eq!(stored(&prompter, &id).0.paragraph, 3);
    hooks::release_writes(&saver);
    assert_eq!(stored(&prompter, &id).0.paragraph, 2);
}

// A save the saver took before an Update of the same script, and wrote
// after it, is refused: the place stays the one Update carried into the new
// text (the review of #287: a put-on refuses by the script alone, an Update
// only by the glass's revision).
#[test]
fn a_save_taken_before_an_update_is_refused() {
    let prompter = TestPrompter::new("saver-update");
    let id = on_the_glass(&prompter, "Updated");
    prompter.call(
        "prompter.jump",
        json!({ "to": "paragraph", "paragraph": 2 }),
    );
    let saver = saver_of(prompter.path());
    let revision = glass_revision(prompter.path());
    prompter.edit(
        &id,
        &[
            "A new first paragraph.",
            "Paragraph 1 has a few words in it.",
            "Paragraph 2 has a few words in it.",
            "Paragraph 3 has a few words in it.",
        ],
    );

    hooks::hold_writes(&saver);
    saver.keep_glass(
        GlassSave {
            script_id: id.clone(),
            glass_revision: revision,
            place: PrompterPlace {
                paragraph: 6,
                word: 0,
            },
            speed_wpm: 140,
        },
        Urgency::Now,
    );
    let taken = hooks::take(&saver).expect("a write to make");
    prompter.call("prompter.update", json!({}));
    let updated = stored(&prompter, &id);
    hooks::write(&saver, taken);
    assert_eq!(stored(&prompter, &id), updated);
    assert_eq!(updated.0.paragraph, 3, "the place moved with its words");
    assert_eq!(saver.take_counts().refused, 1);
    hooks::release_writes(&saver);
}

// A save the saver took before a put-on, and wrote after it, is refused: the
// script let go of keeps the place the put-on gave it.
#[test]
fn a_save_taken_before_the_glass_changed_is_refused() {
    let prompter = TestPrompter::new("saver-refused");
    let first = on_the_glass(&prompter, "First");
    let second = prompter.script("Second", &["One.", "Two."]);
    let saver = saver_of(prompter.path());
    let revision = glass_revision(prompter.path());

    hooks::hold_writes(&saver);
    saver.keep_glass(
        GlassSave {
            script_id: first.clone(),
            glass_revision: revision,
            place: PrompterPlace {
                paragraph: 5,
                word: 0,
            },
            speed_wpm: 200,
        },
        Urgency::Now,
    );
    let taken = hooks::take(&saver).expect("a write to make");
    prompter.call(
        "prompter.putOn",
        json!({ "scriptId": second, "replace": true }),
    );
    let released = stored(&prompter, &first);
    hooks::write(&saver, taken);
    assert_eq!(stored(&prompter, &first), released);
    assert_eq!(released.0.paragraph, 0);
    assert_eq!(released.1, 140);
    assert_eq!(saver.take_counts().refused, 1);
    hooks::release_writes(&saver);
}

// An edit of the script on the glass leaves its place alone: it used to write
// back the place it had read, over one the saver wrote meanwhile. Here the
// saver's write lands between the edit's read and its write.
#[test]
fn an_edit_of_the_script_on_the_glass_keeps_the_newest_place() {
    let prompter = TestPrompter::new("saver-edit");
    let id = on_the_glass(&prompter, "Edited");
    let path = prompter.path().to_path_buf();
    let script = id.clone();
    let (taken, taking) = std::sync::mpsc::channel();
    let saver = thread::spawn(move || {
        let mut connection = open_connection(&path).expect("a connection");
        let transaction = store::begin(&mut connection).expect("the write lock");
        transaction
            .execute(
                "UPDATE prompter_scripts SET place_paragraph = 7, place_word = 0 WHERE id = ?1",
                [&script],
            )
            .expect("the place");
        taken.send(()).expect("the test waits");
        thread::sleep(Duration::from_millis(300));
        transaction.commit().expect("the commit");
    });
    taking.recv().expect("the lock is taken");
    prompter.edit(&id, &["A new first paragraph.", "And a second."]);
    saver.join().expect("the write lands");

    assert_eq!(stored(&prompter, &id).0.paragraph, 7);
    let glass = &prompter.snapshot()["glass"];
    assert_eq!(glass["notUpdated"], true);
    assert_eq!(glass["name"], "Edited");
}

// A value handed over while a write is on its way waits its own time: it
// does not take the due of the value the write took (the review of #287:
// with a slow disk the saver wrote back to back).
#[test]
fn a_value_handed_over_during_a_write_waits_its_own_second() {
    let prompter = TestPrompter::new("saver-coalesce");
    let id = on_the_glass(&prompter, "Coalesced");
    let saver = saver_of(prompter.path());
    let revision = glass_revision(prompter.path());
    let save = |speed_wpm: u32| GlassSave {
        script_id: id.clone(),
        glass_revision: revision,
        place: PrompterPlace::TOP,
        speed_wpm,
    };

    hooks::hold_writes(&saver);
    saver.keep_glass(save(145), Urgency::Now);
    let taken = hooks::take_due(&saver).expect("due at once");
    saver.keep_glass(save(150), Urgency::Coalesced);
    assert!(
        hooks::take_due(&saver).is_none(),
        "the newer value waits a second from the write on its way"
    );
    hooks::write(&saver, taken);
    assert!(hooks::take_due(&saver).is_none());
    hooks::release_writes(&saver);
    assert_eq!(stored(&prompter, &id).1, 150);
}

// A flush returns as soon as nothing waits, when the last value handed over
// equals the one last written. (The review of #287 found the saver could let
// such a value go without waking a flush; it now wakes every waiter each time
// it goes back to sleep. That race is too narrow to force here.)
#[test]
fn a_flush_returns_promptly_when_the_last_value_was_written_already() {
    let prompter = TestPrompter::with_saver("saver-flush");
    let id = on_the_glass(&prompter, "Flushed");
    let saver = saver_of(prompter.path());
    let revision = glass_revision(prompter.path());
    let save = |speed_wpm: u32| GlassSave {
        script_id: id.clone(),
        glass_revision: revision,
        place: PrompterPlace::TOP,
        speed_wpm,
    };
    saver.keep_glass(save(140), Urgency::Now);
    assert!(flush_saves(prompter.path(), Duration::from_secs(5)));

    saver.keep_glass(save(145), Urgency::Coalesced);
    saver.keep_glass(save(140), Urgency::Coalesced);
    let started = Instant::now();
    assert!(flush_saves(prompter.path(), Duration::from_secs(5)));
    let took = started.elapsed();
    assert!(took < Duration::from_secs(1), "the flush took {took:?}");
    assert_eq!(stored(&prompter, &id).1, 140);
}

// The lists show a new pace at once, although the disk has it a moment
// later.
#[test]
fn the_lists_show_a_new_pace_before_the_disk_has_it() {
    let prompter = TestPrompter::new("saver-lists");
    let id = on_the_glass(&prompter, "Listed");
    let saver = saver_of(prompter.path());

    hooks::hold_writes(&saver);
    prompter.call("prompter.speed", json!({ "wpm": 175 }));
    assert_eq!(stored(&prompter, &id).1, 140);
    let snapshot = prompter.snapshot();
    let row = snapshot["scripts"]
        .as_array()
        .expect("the list")
        .iter()
        .find(|row| row["id"] == id.as_str())
        .expect("the script's row");
    assert_eq!(row["speedWpm"], 175);
    let script = prompter.call("prompter.script.snapshot", json!({ "scriptId": id }));
    assert_eq!(script["script"]["speedWpm"], 175);
    hooks::release_writes(&saver);
    assert_eq!(stored(&prompter, &id).1, 175);
}

// The requests that read before they write wait for another writer instead
// of failing: the saver writes beside them now.
#[test]
fn a_put_on_an_update_and_a_clear_wait_for_another_writer() {
    let prompter = TestPrompter::new("saver-immediate");
    let id = on_the_glass(&prompter, "Waiting");
    let other = prompter.script("Other", &["One.", "Two."]);

    prompter.edit(&id, &["Changed.", "Text."]);
    let writer = hold_the_write_lock(prompter.path(), Duration::from_millis(300));
    prompter.call("prompter.update", json!({}));
    writer.join().expect("the writer lets go");

    let writer = hold_the_write_lock(prompter.path(), Duration::from_millis(300));
    prompter.call(
        "prompter.putOn",
        json!({ "scriptId": other, "replace": true }),
    );
    writer.join().expect("the writer lets go");

    let writer = hold_the_write_lock(prompter.path(), Duration::from_millis(300));
    prompter.call("prompter.clear", json!({}));
    writer.join().expect("the writer lets go");
    assert!(prompter.snapshot()["glass"].is_null());
}

// A start moves the look's revision on and saves it, so a layout key of an
// earlier run is never handed out again with another size.
#[test]
fn a_start_moves_the_look_revision_on() {
    let prompter = TestPrompter::new("saver-start");
    on_the_glass(&prompter, "Started");
    let before = prompter.call("prompter.glass.snapshot", json!({}))["layoutKey"]
        .as_str()
        .expect("a key")
        .to_string();
    forget(prompter.path());
    let after = prompter.call("prompter.glass.snapshot", json!({}))["layoutKey"]
        .as_str()
        .expect("a key")
        .to_string();
    let look = |key: &str| -> i64 {
        key.rsplit_once("-l")
            .and_then(|(_, revision)| revision.parse().ok())
            .expect("a look revision")
    };
    assert_eq!(look(&after), look(&before) + 1000);
    let connection = open_connection(prompter.path()).expect("a connection");
    assert_eq!(
        store::read_prompter(&connection)
            .expect("the prompter reads")
            .look_revision,
        look(&after)
    );
}

// The size dial's detents reach the disk with the look's revision, through
// the saver.
#[test]
fn the_size_dial_is_saved_with_the_look_revision() {
    let prompter = TestPrompter::with_saver("saver-size");
    on_the_glass(&prompter, "Sized");
    handle_deck_action(prompter.path(), "size", Some("up")).expect("the dial turns");
    let key = prompter.call("prompter.glass.snapshot", json!({}))["layoutKey"]
        .as_str()
        .expect("a key")
        .to_string();
    assert!(flush_saves(prompter.path(), Duration::from_secs(5)));
    let connection = open_connection(prompter.path()).expect("a connection");
    let stored = store::read_prompter(&connection).expect("the prompter reads");
    assert_eq!(stored.size_px, 92);
    assert!(key.ends_with(&format!("-l{}", stored.look_revision)));
}

// At a stop the place of that moment and everything the saver holds reach
// the disk, and later hand-offs are let go.
#[test]
fn a_stop_writes_what_the_saver_holds() {
    let prompter = TestPrompter::with_saver("saver-stop");
    let id = on_the_glass(&prompter, "Stopped");
    prompter.call(
        "prompter.jump",
        json!({ "to": "paragraph", "paragraph": 3 }),
    );
    prompter.call("prompter.speed", json!({ "wpm": 180 }));
    assert!(finish_saving(prompter.path(), Duration::from_secs(5)));
    assert_eq!(
        stored(&prompter, &id),
        (
            PrompterPlace {
                paragraph: 3,
                word: 0
            },
            180
        )
    );

    prompter.call("prompter.speed", json!({ "wpm": 200 }));
    thread::sleep(Duration::from_millis(50));
    assert_eq!(stored(&prompter, &id).1, 180);
}
