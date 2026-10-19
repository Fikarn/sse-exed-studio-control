//! Saved JSON values, read with a word when one does not read (the audit of
//! 2026-10-12, M11). The settings hold JSON under some keys: the lighting
//! editor's state, the Console's channel maps and hidden strips, the cameras'
//! last readings, the lighting markers, the shell's thumbs and marks. A value
//! that failed to parse used to become its default without a word, and the
//! next write kept the default: a damaged row, or a field a newer build wrote,
//! reset the rig to the four simulated fixtures and three scenes, and only
//! the operator noticed. The callers still fall back to their defaults; the
//! log now says so, once per key for the engine's life.

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

use serde::de::DeserializeOwned;

use crate::diagnostics::{log_event, LogLevel};

/// The keys said in the log, each once.
static SAID: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// `value`, saved under `key`, as `T`; `None` when it does not read, with a
/// WARN line the first time for that key.
pub(crate) fn parse_saved_json<T: DeserializeOwned>(key: &str, value: &str) -> Option<T> {
    parse_checked_saved_json(key, value, Ok)
}

/// `parse_saved_json`, then `check`, which may also put the value in its
/// kept form: a value that reads and fails the check is `None` as well, said
/// the same way with the check's reason (the session's settings, D52, whose
/// update refuses what this refuses).
pub(crate) fn parse_checked_saved_json<T: DeserializeOwned>(
    key: &str,
    value: &str,
    check: impl FnOnce(T) -> Result<T, String>,
) -> Option<T> {
    let outcome = serde_json::from_str::<T>(value)
        .map_err(|error| error.to_string())
        .and_then(check);
    match outcome {
        Ok(parsed) => Some(parsed),
        Err(why) => {
            if first_complaint(key) {
                log_event(
                    LogLevel::Warn,
                    &format!(
                        "The saved value {key} could not be read ({why}); its default is used until it is written again. If the saved data should have it, restore a backup from Setup / Support."
                    ),
                );
            }
            None
        }
    }
}

fn first_complaint(key: &str) -> bool {
    SAID.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(String::from(key))
}

/// Whether `key` has been said in the log.
#[cfg(test)]
pub(crate) fn complained_about(key: &str) -> bool {
    SAID.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn a_value_that_reads_is_read_and_not_complained_about() {
        let parsed: Option<HashMap<String, i64>> =
            parse_saved_json("app.test.reads", r#"{"a": 1}"#);
        assert_eq!(parsed.and_then(|map| map.get("a").copied()), Some(1));
        assert!(!complained_about("app.test.reads"));
    }

    #[test]
    fn a_value_that_does_not_read_is_none_and_said_once() {
        let first: Option<HashMap<String, i64>> = parse_saved_json("app.test.damaged", "{not json");
        assert!(first.is_none());
        assert!(complained_about("app.test.damaged"));
        // Said once: the second failure adds nothing (the set holds the key).
        let second: Option<Vec<String>> = parse_saved_json("app.test.damaged", "[1, 2");
        assert!(second.is_none());
        assert!(complained_about("app.test.damaged"));
        assert!(!complained_about("app.test.other"));
    }

    #[test]
    fn a_value_that_reads_and_fails_its_check_is_none_and_said() {
        let even = |value: i64| {
            if value % 2 == 0 {
                Ok(value / 2)
            } else {
                Err(format!("{value} is odd"))
            }
        };
        assert_eq!(
            parse_checked_saved_json("app.test.even", "8", even),
            Some(4)
        );
        assert!(!complained_about("app.test.even"));
        assert_eq!(parse_checked_saved_json("app.test.odd", "7", even), None);
        assert!(complained_about("app.test.odd"));
        assert_eq!(
            parse_checked_saved_json("app.test.text", "\"8\"", even),
            None
        );
        assert!(complained_about("app.test.text"));
    }
}
