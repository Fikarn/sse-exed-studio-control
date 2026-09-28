//! The words rule (AGENTS.md): words on screen never say "engine",
//! "backend", "transport", "IPC" or "snapshot", and the screen calls the
//! engine "the hardware link". The pages' own words are held by
//! `scripts/check-operator-copy.mjs` and the layout measures; those never read
//! the sentences the hardware link makes, which the pages print as they are.
//! This holds the ones found on 2026-09-28, with the words that came with
//! them: "native", the wire's and the database's names.

use crate::app_state::COMMISSIONING_COMPLETED_KEY;
use crate::commissioning::{read_commissioning_snapshot, summarize_control_surface_probe};
use crate::diagnostics::read_log_tail;
use crate::lighting::lighting_refusal;
use crate::storage::{initialize_test_database, set_settings_owned};

/// Words a sentence the screen prints may not hold.
const DEVELOPER_WORDS: [&str; 16] = [
    "engine",
    "backend",
    "transport",
    "ipc",
    "snapshot",
    "snapshots",
    "native",
    "json",
    "sqlite",
    "stdin",
    "stdout",
    "stderr",
    "serde",
    "mutex",
    "endpoint",
    "payload",
];

pub(crate) fn assert_operator_words(sentence: &str) {
    for word in sentence
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
    {
        assert!(
            !DEVELOPER_WORDS.contains(&word),
            "\"{sentence}\" says {word}"
        );
    }
}

#[test]
fn the_sentences_the_screen_prints_say_no_developer_word() {
    let dir = std::env::temp_dir().join(format!(
        "sse-operator-words-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    ));
    std::fs::create_dir_all(&dir).expect("a scratch folder");
    let db_path = dir.join("studio-control.sqlite3");
    initialize_test_database(&db_path).expect("database should initialize");

    // Setup's state sentence and the probes' details, unpublished and published.
    let unpublished = read_commissioning_snapshot(&db_path).expect("snapshot should read");
    assert_operator_words(&unpublished.summary);
    for check in &unpublished.checks {
        assert_operator_words(&check.message);
    }
    set_settings_owned(
        &db_path,
        &[(
            String::from(COMMISSIONING_COMPLETED_KEY),
            String::from("true"),
        )],
    )
    .expect("the setting should persist");
    assert_operator_words(
        &read_commissioning_snapshot(&db_path)
            .expect("snapshot should read")
            .summary,
    );

    // The deck probe's detail, the lighting's refusals, the log's fallbacks.
    assert_operator_words(&summarize_control_surface_probe());
    for status in ["attention", "not-verified", "disabled", "unconfigured"] {
        let (_, sentence) = lighting_refusal(status).expect("a refusal");
        assert_operator_words(sentence);
    }
    assert_operator_words(&read_log_tail(&dir.join("missing.log"), 4096, 12));
    std::fs::write(dir.join("empty.log"), b"").expect("an empty log");
    assert_operator_words(&read_log_tail(&dir.join("empty.log"), 4096, 12));
    let _ = std::fs::remove_dir_all(&dir);
}
