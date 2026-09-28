//! What a development build does by itself at its start.
//!
//! A development build (`studio_control_protocol::development`) keeps off
//! the studio's devices and off the studio's Stream Deck bridge whoever
//! starts it: where its environment leaves a switch unset, it takes the safe
//! value. `npm run app` and the test lanes set every one of them; this is
//! for the engine started by hand, or by a shell that was. A variable that
//! is set is left as it is, so a lane can still leave the safe start out and
//! a hardware test can ask for the real console.
//!
//! The studio's build, a release build, sets nothing.

use std::ffi::OsString;

/// The Stream Deck bridge port of a development run. The studio's is
/// `control_surface::DEFAULT_CONTROL_SURFACE_PORT`, the one Companion talks
/// to.
pub const DEVELOPMENT_CONTROL_SURFACE_PORT: u16 = 38211;

/// The variables a development build sets at its start, with their values:
/// each switch its environment leaves unset or empty. The bridge port is
/// also set when its value is no port at all, which the bridge would answer
/// with the studio's port.
pub fn development_defaults<F>(mut get_env: F) -> Vec<(&'static str, String)>
where
    F: FnMut(&str) -> Option<OsString>,
{
    let mut value_of = |name: &str| -> Option<String> {
        get_env(name)
            .map(|value| value.to_string_lossy().trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let mut defaults = Vec::new();

    let port = value_of("SSE_CONTROL_SURFACE_PORT");
    if port
        .as_deref()
        .and_then(|value| value.parse::<u16>().ok())
        .is_none()
    {
        defaults.push((
            "SSE_CONTROL_SURFACE_PORT",
            DEVELOPMENT_CONTROL_SURFACE_PORT.to_string(),
        ));
    }
    for switch in [
        "SSE_SAFE_START",
        "SSE_LIGHTS_SIMULATED",
        "SSE_AUDIO_SIMULATED_INPUT_MODE",
        "SSE_CAMERAS_SIMULATED",
    ] {
        if value_of(switch).is_none() {
            defaults.push((switch, String::from("1")));
        }
    }
    defaults
}

/// One line for the log: what the build set by itself.
pub fn development_defaults_line(defaults: &[(&'static str, String)]) -> String {
    if defaults.is_empty() {
        return String::from(
            "Development build: every switch was set by the environment it was started in.",
        );
    }
    let set: Vec<String> = defaults
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect();
    format!(
        "Development build: set by itself, since nothing else had: {}.",
        set.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cameras::simulated_cameras_requested;
    use crate::control_surface::DEFAULT_CONTROL_SURFACE_PORT;
    use crate::lighting_sacn_output::simulated_lights_requested;

    fn env_fixture(entries: &[(&str, &str)]) -> impl FnMut(&str) -> Option<OsString> {
        let entries: Vec<(String, String)> = entries
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect();
        move |name: &str| {
            entries
                .iter()
                .find(|(entry, _)| entry == name)
                .map(|(_, value)| OsString::from(value))
        }
    }

    fn value<'a>(defaults: &'a [(&'static str, String)], name: &str) -> Option<&'a str> {
        defaults
            .iter()
            .find(|(entry, _)| *entry == name)
            .map(|(_, value)| value.as_str())
    }

    // Streamlining, 2026-09-28: started by hand with nothing set, a
    // development build took the studio's bridge port, the real console and
    // the real cameras, and streamed to the rig when its saved data said
    // armed. It now takes the safe value of every switch nothing set.
    #[test]
    fn a_development_build_is_safe_with_nothing_set() {
        let defaults = development_defaults(env_fixture(&[]));

        let port = value(&defaults, "SSE_CONTROL_SURFACE_PORT").expect("a port");
        assert_eq!(port, DEVELOPMENT_CONTROL_SURFACE_PORT.to_string());
        assert_ne!(
            DEVELOPMENT_CONTROL_SURFACE_PORT, DEFAULT_CONTROL_SURFACE_PORT,
            "never the studio's port"
        );
        // Each value as the switch's own reader takes it.
        assert!(crate::bootstrap::safe_start_requested(
            value(&defaults, "SSE_SAFE_START").expect("a safe start")
        ));
        assert!(simulated_lights_requested(
            value(&defaults, "SSE_LIGHTS_SIMULATED").expect("simulated lights")
        ));
        assert!(simulated_cameras_requested(
            value(&defaults, "SSE_CAMERAS_SIMULATED").expect("simulated cameras")
        ));
        assert_eq!(
            value(&defaults, "SSE_AUDIO_SIMULATED_INPUT_MODE"),
            Some("1"),
            "the value audio/helpers.rs `resolve_audio_config` reads as simulated"
        );
        assert_eq!(defaults.len(), 5);

        let line = development_defaults_line(&defaults);
        assert!(line.contains("SSE_SAFE_START=1"), "{line}");
        assert!(line.contains("SSE_CONTROL_SURFACE_PORT=38211"), "{line}");
    }

    #[test]
    fn a_switch_that_is_set_is_left_as_it_is() {
        // What a lane sets, its one launch without the safe start and the
        // live console lane included.
        let defaults = development_defaults(env_fixture(&[
            ("SSE_CONTROL_SURFACE_PORT", "0"),
            ("SSE_SAFE_START", "0"),
            ("SSE_LIGHTS_SIMULATED", "1"),
            ("SSE_AUDIO_SIMULATED_INPUT_MODE", "0"),
            ("SSE_CAMERAS_SIMULATED", "1"),
        ]));
        assert!(defaults.is_empty(), "{defaults:?}");
        assert!(development_defaults_line(&defaults).contains("every switch was set"));
    }

    #[test]
    fn an_empty_switch_and_a_port_that_is_none_count_as_unset() {
        let defaults = development_defaults(env_fixture(&[
            ("SSE_CONTROL_SURFACE_PORT", "the deck"),
            ("SSE_SAFE_START", "  "),
            ("SSE_LIGHTS_SIMULATED", ""),
            ("SSE_AUDIO_SIMULATED_INPUT_MODE", "1"),
            ("SSE_CAMERAS_SIMULATED", "1"),
        ]));
        assert_eq!(
            defaults,
            vec![
                ("SSE_CONTROL_SURFACE_PORT", String::from("38211")),
                ("SSE_SAFE_START", String::from("1")),
                ("SSE_LIGHTS_SIMULATED", String::from("1")),
            ]
        );
        // A port past the range is no port either.
        let defaults = development_defaults(env_fixture(&[("SSE_CONTROL_SURFACE_PORT", "70000")]));
        assert_eq!(value(&defaults, "SSE_CONTROL_SURFACE_PORT"), Some("38211"));
    }
}
