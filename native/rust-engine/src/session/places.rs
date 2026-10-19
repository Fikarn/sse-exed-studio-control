//! Where a session's folders go (the Session page's step 2, D52): the
//! sessions' folder the setting names, in a studio build alone. Every other
//! run keeps its sessions' folders beside its own saved data and makes a new
//! folder only there: a development build always, whatever its environment
//! holds, and any run started with `SSE_SESSIONS_SIMULATED=1`, which
//! `npm run app` and the lanes set, and the release's trial with them. A
//! switch tells the trial from the studio, not the data folder: the trial
//! moves `APPDATA` to a scratch folder, so its default data folder looks
//! like the studio's own.

use std::path::{Path, PathBuf};

use studio_control_protocol::development::same_or_inside;

use crate::session::snapshot::SessionPlaces;

/// The switch: `1` keeps a studio build's sessions' folders beside its saved
/// data, as a test's and a development run's are.
pub(crate) const SESSIONS_SIMULATED_ENV: &str = "SSE_SESSIONS_SIMULATED";

/// The folder in the saved data's folder that holds a simulated run's
/// sessions' folders.
pub(crate) const SCRATCH_FOLDER_NAME: &str = "Sessions";

/// Whether this run's sessions' folders are its scratch folder's: always in
/// a development build, and in a studio build when the switch says `1`
/// (trimmed, as the other switches are read).
pub(crate) fn sessions_simulated(development_build: bool, switch: Option<&str>) -> bool {
    development_build || switch.is_some_and(|value| value.trim() == "1")
}

/// Where this run makes the sessions' folders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Places {
    /// The run's folders are its scratch folder's (`sessions_simulated`).
    pub simulated: bool,
    /// `<the saved data's folder>\Sessions`.
    pub scratch_root: PathBuf,
}

impl Places {
    pub(crate) fn new(simulated: bool, app_data_dir: &Path) -> Self {
        Self {
            simulated,
            scratch_root: app_data_dir.join(SCRATCH_FOLDER_NAME),
        }
    }

    /// The sessions' folder a new session's folder goes on: the setting's
    /// root, or the scratch folder in a simulated run.
    pub(crate) fn effective_root(&self, root_setting: &str) -> PathBuf {
        if self.simulated {
            self.scratch_root.clone()
        } else {
            PathBuf::from(root_setting)
        }
    }

    /// Whether this run may make `path`, a folder: anywhere in the studio's
    /// build, and only inside its scratch folder in a simulated run, as the
    /// file system resolves the path (a junction or a detour by `..` that
    /// leads out of it is out of it).
    pub(crate) fn may_make(&self, path: &Path) -> bool {
        !self.simulated || same_or_inside(path, &self.scratch_root)
    }

    /// What `session.snapshot` says of the places.
    pub(crate) fn snapshot(&self, root_setting: &str) -> SessionPlaces {
        SessionPlaces {
            root: self.effective_root(root_setting).display().to_string(),
            simulated: self.simulated,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_development_build_is_simulated_whatever_the_switch_says() {
        for switch in [None, Some(""), Some("0"), Some("1"), Some("no")] {
            assert!(sessions_simulated(true, switch), "{switch:?}");
        }
        // A studio build takes the setting's root unless the switch says 1.
        for (switch, simulated) in [
            (None, false),
            (Some(""), false),
            (Some("0"), false),
            (Some("true"), false),
            (Some("yes"), false),
            (Some("11"), false),
            (Some("1"), true),
            (Some(" 1 "), true),
        ] {
            assert_eq!(sessions_simulated(false, switch), simulated, "{switch:?}");
        }
        assert_eq!(SESSIONS_SIMULATED_ENV, "SSE_SESSIONS_SIMULATED");
    }

    #[test]
    fn the_scratch_folder_follows_the_saved_data_and_the_studio_takes_the_setting() {
        let app_data = std::env::temp_dir().join("studio-control-places-app-data");
        let simulated = Places::new(true, &app_data);
        assert_eq!(simulated.scratch_root, app_data.join("Sessions"));
        assert_eq!(
            simulated.effective_root(r"D:\Sessions"),
            app_data.join("Sessions")
        );
        assert_eq!(
            simulated.snapshot(r"D:\Sessions"),
            SessionPlaces {
                root: app_data.join("Sessions").display().to_string(),
                simulated: true
            }
        );
        assert!(simulated.may_make(&app_data.join("Sessions")));
        assert!(simulated.may_make(&app_data.join("Sessions").join("Take (2026-10-18)")));
        assert!(!simulated.may_make(&app_data.join("Elsewhere")));
        assert!(!simulated.may_make(&app_data.join("Sessions").join("..").join("Elsewhere")));
        assert!(!simulated.may_make(&app_data));

        let studio = Places::new(false, &app_data);
        assert_eq!(
            studio.effective_root(r"D:\Sessions"),
            PathBuf::from(r"D:\Sessions")
        );
        assert_eq!(
            studio.snapshot(r"D:\Sessions"),
            SessionPlaces {
                root: String::from(r"D:\Sessions"),
                simulated: false
            }
        );
        assert!(studio.may_make(&app_data.join("Elsewhere")));
    }
}
