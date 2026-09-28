//! What the engine and the shell agree on about the build they are and the
//! folder the studio's saved data lives in.
//!
//! The studio runs a release build on the platform's default app-data folder.
//! Every other build is a development build, and a development build never
//! opens that folder: a newer build would upgrade the saved data at its first
//! start, after which the studio's own build refuses it, and the addresses
//! saved there would put a development run on the real console and rig. Both
//! programs ask `refuse_studio_folders` before they create or open anything,
//! the log included.
//!
//! `npm run app` gives a development run folders of its own. To work on the
//! studio's data, copy the folder and name the copy.

use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};

/// The studio's folder in the platform's app-data folder.
pub const DEFAULT_APP_DATA_DIR_NAME: &str = "ExEd Studio Control Native";

/// Whether this is a development build: one with debug assertions, which is
/// what `cargo build`, `cargo test` and `tauri dev` make.
pub fn development_build() -> bool {
    cfg!(debug_assertions)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostPlatform {
    /// The Linux CI runners, which build and test the engine and the shell
    /// (D22: Studio Control itself runs on Windows only).
    Unix,
    Windows,
}

pub fn host_platform() -> HostPlatform {
    if cfg!(target_os = "windows") {
        HostPlatform::Windows
    } else {
        HostPlatform::Unix
    }
}

fn env_path<F>(name: &str, get_env: &mut F) -> Option<PathBuf>
where
    F: FnMut(&str) -> Option<OsString>,
{
    get_env(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Every place the default app-data folder can be on this host, the one in
/// use first: a base that is not set gives the next.
pub fn default_app_data_dirs<F>(platform: HostPlatform, mut get_env: F) -> Vec<PathBuf>
where
    F: FnMut(&str) -> Option<OsString>,
{
    let bases = match platform {
        HostPlatform::Windows => [
            env_path("APPDATA", &mut get_env),
            env_path("LOCALAPPDATA", &mut get_env),
        ],
        HostPlatform::Unix => [
            env_path("XDG_DATA_HOME", &mut get_env),
            env_path("HOME", &mut get_env).map(|home| home.join(".local").join("share")),
        ],
    };
    bases
        .into_iter()
        .flatten()
        .map(|base| base.join(DEFAULT_APP_DATA_DIR_NAME))
        .collect()
}

/// The durable per-user app-data folder of the platform, never a path
/// relative to the working directory (2026-09 production readiness, Slice 1,
/// finding F22).
pub fn default_app_data_dir<F>(platform: HostPlatform, get_env: F) -> Result<PathBuf, String>
where
    F: FnMut(&str) -> Option<OsString>,
{
    default_app_data_dirs(platform, get_env)
        .into_iter()
        .next()
        .ok_or_else(|| {
            String::from(
                "Unable to resolve a durable app-data directory. Set SSE_APP_DATA_DIR to an absolute path.",
            )
        })
}

/// Refuses a development build a folder that is the studio's or inside it.
/// `folders` are the folders the run would use, its saved data and its logs.
/// A release build, the studio's, is refused nothing.
pub fn refuse_studio_folders<F>(
    development_build: bool,
    platform: HostPlatform,
    folders: &[&Path],
    get_env: F,
) -> Result<(), String>
where
    F: FnMut(&str) -> Option<OsString>,
{
    if !development_build {
        return Ok(());
    }
    // No default folder on this host: there is no studio data to open.
    let studio_dirs = default_app_data_dirs(platform, get_env);
    for folder in folders {
        if let Some(studio_dir) = studio_dirs
            .iter()
            .find(|studio_dir| same_or_inside(folder, studio_dir))
        {
            return Err(format!(
                "This is a development build, and {} is in the studio's saved data ({}). Start it with `npm run app`, which gives it folders of its own, or name other folders in SSE_APP_DATA_DIR and SSE_LOG_DIR.",
                folder.display(),
                studio_dir.display()
            ));
        }
    }
    Ok(())
}

/// Whether `candidate` is `folder` or a path inside it, as the file system
/// resolves the two: through a junction, a symbolic link, a short 8.3 name
/// or a detour by `..`, with either separator, and without regard to case on
/// Windows.
pub fn same_or_inside(candidate: &Path, folder: &Path) -> bool {
    let (candidate, folder) = (parts(candidate), parts(folder));
    !folder.is_empty() && candidate.len() >= folder.len() && candidate[..folder.len()] == folder[..]
}

fn parts(path: &Path) -> Vec<String> {
    resolved(path)
        .components()
        .map(|part| {
            let part = part.as_os_str().to_string_lossy();
            if cfg!(target_os = "windows") {
                part.to_lowercase()
            } else {
                part.into_owned()
            }
        })
        .collect()
}

/// The path as the file system resolves it. A path that does not exist yet
/// is resolved as far as it does: its nearest folder that exists, then the
/// rest as written. So a folder the run would create is recognised by the
/// place it would be created in.
fn resolved(path: &Path) -> PathBuf {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut missing: Vec<&OsStr> = Vec::new();
    let mut existing = absolute.as_path();
    loop {
        if let Ok(mut resolved) = fs::canonicalize(existing) {
            resolved.extend(missing.iter().rev());
            return resolved;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name);
                existing = parent;
            }
            _ => return absolute.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "studio-control-development-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("test dir should be created");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn env_fixture(entries: &[(&str, &Path)]) -> impl FnMut(&str) -> Option<OsString> {
        let entries: Vec<(String, OsString)> = entries
            .iter()
            .map(|(name, value)| ((*name).to_string(), value.as_os_str().to_os_string()))
            .collect();
        move |name: &str| {
            entries
                .iter()
                .find(|(entry, _)| entry == name)
                .map(|(_, value)| value.clone())
        }
    }

    /// The variable the platform's first base comes from.
    fn base_name() -> &'static str {
        match host_platform() {
            HostPlatform::Windows => "APPDATA",
            HostPlatform::Unix => "XDG_DATA_HOME",
        }
    }

    #[test]
    fn every_platform_names_its_default_folders() {
        let windows = default_app_data_dirs(
            HostPlatform::Windows,
            env_fixture(&[
                ("APPDATA", Path::new("C:/Users/operator/AppData/Roaming")),
                ("LOCALAPPDATA", Path::new("C:/Users/operator/AppData/Local")),
            ]),
        );
        assert_eq!(
            windows,
            vec![
                PathBuf::from("C:/Users/operator/AppData/Roaming").join(DEFAULT_APP_DATA_DIR_NAME),
                PathBuf::from("C:/Users/operator/AppData/Local").join(DEFAULT_APP_DATA_DIR_NAME),
            ]
        );
        assert_eq!(
            default_app_data_dir(
                HostPlatform::Windows,
                env_fixture(&[("LOCALAPPDATA", Path::new("C:/Users/operator/AppData/Local"))]),
            )
            .expect("the local base"),
            PathBuf::from("C:/Users/operator/AppData/Local").join(DEFAULT_APP_DATA_DIR_NAME)
        );

        let unix = default_app_data_dirs(
            HostPlatform::Unix,
            env_fixture(&[
                ("XDG_DATA_HOME", Path::new("/home/operator/.local/data")),
                ("HOME", Path::new("/home/operator")),
            ]),
        );
        assert_eq!(
            unix,
            vec![
                PathBuf::from("/home/operator/.local/data").join(DEFAULT_APP_DATA_DIR_NAME),
                PathBuf::from("/home/operator")
                    .join(".local")
                    .join("share")
                    .join(DEFAULT_APP_DATA_DIR_NAME),
            ]
        );

        // An empty base counts as one that is not set.
        let error = default_app_data_dir(
            HostPlatform::Windows,
            env_fixture(&[("APPDATA", Path::new(""))]),
        )
        .expect_err("no base, no folder");
        assert!(error.contains("SSE_APP_DATA_DIR"), "{error}");
    }

    // Streamlining, 2026-09-28: a development build is refused the studio's
    // saved data before it creates or opens anything there. Until then
    // `tauri dev` and an engine started by hand opened the studio's data
    // whenever SSE_APP_DATA_DIR was not set: a newer build upgraded it at
    // that start, and the studio's own build then refused it.
    #[test]
    fn a_development_build_is_refused_the_studios_folders() {
        let host = TestDir::new("refused");
        let platform = host_platform();
        let env = || env_fixture(&[(base_name(), host.path())]);
        let studio = default_app_data_dir(platform, env()).expect("the default folder");
        let scratch = host.path().join("scratch");

        // Refused whether the folder is there yet or not.
        for exists in [false, true] {
            if exists {
                fs::create_dir_all(studio.join("logs")).expect("the studio's folder");
            }
            let refused = [
                ("the data folder", vec![studio.clone(), scratch.clone()]),
                (
                    "the logs folder",
                    vec![scratch.clone(), studio.join("logs")],
                ),
                (
                    "a folder inside",
                    vec![studio.join("development"), scratch.clone()],
                ),
                (
                    "by a detour",
                    vec![host
                        .path()
                        .join("scratch")
                        .join("..")
                        .join(DEFAULT_APP_DATA_DIR_NAME)],
                ),
                (
                    "with a separator at its end",
                    vec![PathBuf::from(format!(
                        "{}{}",
                        studio.display(),
                        std::path::MAIN_SEPARATOR
                    ))],
                ),
            ];
            for (label, folders) in refused {
                let folders: Vec<&Path> = folders.iter().map(PathBuf::as_path).collect();
                let error = refuse_studio_folders(true, platform, &folders, env())
                    .expect_err(&format!("{label} (exists: {exists})"));
                assert!(error.contains("npm run app"), "{error}");
                assert!(error.contains(&studio.display().to_string()), "{error}");
            }

            // The studio's build, a release build, opens it.
            refuse_studio_folders(false, platform, &[&studio, &studio.join("logs")], env())
                .expect("a release build opens the studio's data");
        }
    }

    #[test]
    fn a_development_build_is_refused_every_default_folder() {
        // Windows takes LOCALAPPDATA when APPDATA is not set, so the studio's
        // data can be in either; the same holds for the two Unix bases.
        let host = TestDir::new("both-bases");
        let (first, second) = (host.path().join("first"), host.path().join("second"));
        let (platform, bases): (HostPlatform, [(&str, &Path); 2]) = match host_platform() {
            HostPlatform::Windows => (
                HostPlatform::Windows,
                [("APPDATA", &first), ("LOCALAPPDATA", &second)],
            ),
            HostPlatform::Unix => (
                HostPlatform::Unix,
                [("XDG_DATA_HOME", &first), ("HOME", &second)],
            ),
        };
        for folder in default_app_data_dirs(platform, env_fixture(&bases)) {
            assert!(folder.starts_with(host.path()), "{}", folder.display());
            refuse_studio_folders(true, platform, &[&folder], env_fixture(&bases))
                .expect_err(&format!("{} is a default folder", folder.display()));
        }
    }

    #[test]
    fn a_development_build_opens_folders_of_its_own() {
        let host = TestDir::new("own");
        let platform = host_platform();
        let env = || env_fixture(&[(base_name(), host.path())]);
        let studio = default_app_data_dir(platform, env()).expect("the default folder");
        fs::create_dir_all(&studio).expect("the studio's folder");

        let scratch = host.path().join("scratch");
        refuse_studio_folders(true, platform, &[&scratch, &scratch.join("logs")], env())
            .expect("a scratch folder is the run's own");
        // A folder beside the studio's, its name beginning the same way, is
        // not inside it.
        let beside = studio.with_file_name(format!("{DEFAULT_APP_DATA_DIR_NAME} Dev"));
        refuse_studio_folders(true, platform, &[&beside], env())
            .expect("a folder beside the studio's is the run's own");
        // Nor is the folder the studio's sits in.
        refuse_studio_folders(true, platform, &[host.path()], env())
            .expect("the folder above the studio's is not the studio's");
        // A host with no platform base has no studio data to open.
        refuse_studio_folders(true, platform, &[&studio], env_fixture(&[]))
            .expect("nothing to refuse without a default folder");
    }

    #[test]
    fn one_folder_is_recognised_however_it_is_written() {
        let test_dir = TestDir::new("same-folder");
        let folder = test_dir.path().join("Studio Data");
        fs::create_dir_all(folder.join("logs")).expect("folders");

        assert!(same_or_inside(&folder, &folder));
        assert!(same_or_inside(&folder.join("logs"), &folder));
        assert!(same_or_inside(&folder.join("logs").join(".."), &folder));
        assert!(same_or_inside(
            &folder.join("not").join("there").join("yet"),
            &folder
        ));
        assert!(!same_or_inside(&folder, &folder.join("logs")));
        assert!(!same_or_inside(test_dir.path(), &folder));
        assert!(!same_or_inside(
            &test_dir.path().join("Studio Data 2"),
            &folder
        ));

        // Windows does not tell `Studio Data` from `STUDIO DATA`; the Linux
        // CI runners do.
        assert_eq!(
            same_or_inside(&test_dir.path().join("STUDIO DATA"), &folder),
            cfg!(target_os = "windows")
        );
        assert_eq!(
            same_or_inside(
                &test_dir.path().join("MISSING").join("inside"),
                &test_dir.path().join("missing")
            ),
            cfg!(target_os = "windows")
        );
    }

    // A junction to the studio's folder is the studio's folder. Windows makes
    // a junction without the rights a symbolic link needs.
    #[cfg(windows)]
    #[test]
    fn a_junction_to_the_studios_folder_is_refused() {
        let host = TestDir::new("junction");
        let env = || env_fixture(&[("APPDATA", host.path())]);
        let studio =
            default_app_data_dir(HostPlatform::Windows, env()).expect("the default folder");
        fs::create_dir_all(&studio).expect("the studio's folder");
        let junction = host.path().join("elsewhere");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&studio)
            .output()
            .expect("mklink runs");
        assert!(made.status.success(), "{made:?}");

        refuse_studio_folders(true, HostPlatform::Windows, &[&junction], env())
            .expect_err("the junction leads into the studio's folder");
        refuse_studio_folders(
            true,
            HostPlatform::Windows,
            &[&junction.join("logs")],
            env(),
        )
        .expect_err("and so does a folder through it");
        // Removes the junction, not the folder it leads to.
        fs::remove_dir(&junction).expect("the junction is removed");
        assert!(studio.is_dir());
    }
}
