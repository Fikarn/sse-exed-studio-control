//! What the engine and the shell agree on about the build they are and the
//! folder the studio's saved data lives in.
//!
//! The studio runs a studio build on the platform's default app-data folder.
//! Every other build is a development build, and a development build never
//! opens that folder: a newer build would upgrade the saved data at its first
//! start, after which the studio's own build refuses it, and the addresses
//! saved there would put a development run on the real console and rig. Both
//! programs ask `refuse_studio_folders` before they create or open anything,
//! the log included.
//!
//! `npm run app` gives a development run folders of its own. To work on the
//! studio's data, copy the folder and name the copy.
//!
//! Every engine carries a mark in its file that says what build it is
//! (`BUILD_MARK`), and the shell reads it before it starts one: it starts an
//! engine only of its own build, both development builds or the studio build
//! of one commit. It reads the file, never asks the program: an engine, once
//! started, opens its saved data and the devices at once, and an engine older
//! than the mark would not understand a question.

use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// The studio's folder in the platform's app-data folder.
pub const DEFAULT_APP_DATA_DIR_NAME: &str = "ExEd Studio Control Native";

/// The variable `npm run release` sets for the compiler: the commit it
/// builds, all forty characters.
pub const STUDIO_BUILD_ENV: &str = "SSE_STUDIO_BUILD";

/// The commit a studio build was made from; `None` in a development build.
///
/// A studio build is a release build that `npm run release` made. The
/// command sets `SSE_STUDIO_BUILD` to the commit while it compiles, and the
/// answer is compiled in: nothing at run time makes a studio build of
/// another. A release build made any other way (`cargo build --release`,
/// `tauri build`) is development code the owner has not walked, and it is a
/// development build like the rest.
pub fn studio_build_commit() -> Option<&'static str> {
    STUDIO_BUILD_COMMIT
}

/// Worked out once, for the answer above and for the mark alike.
const STUDIO_BUILD_COMMIT: Option<&str> =
    studio_build_commit_from(cfg!(debug_assertions), option_env!("SSE_STUDIO_BUILD"));

/// The commit `marker` names when it makes a studio build: forty lowercase
/// hexadecimal characters, in a build without debug assertions.
const fn studio_build_commit_from(debug_assertions: bool, marker: Option<&str>) -> Option<&str> {
    let Some(commit) = marker else {
        return None;
    };
    if debug_assertions || commit.len() != 40 {
        return None;
    }
    let bytes = commit.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        if !matches!(bytes[at], b'0'..=b'9' | b'a'..=b'f') {
            return None;
        }
        at += 1;
    }
    Some(commit)
}

/// What an engine's file says it is (`build_marked_in`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarkedBuild<'a> {
    Development,
    /// The studio build of this commit.
    Studio(&'a str),
    /// No mark: an engine older than the mark, or not an engine at all.
    Unmarked,
    /// Marks that say different things.
    Conflicting,
}

impl MarkedBuild<'static> {
    /// This build, as its own mark says it.
    pub fn this_build() -> Self {
        match STUDIO_BUILD_COMMIT {
            Some(commit) => Self::Studio(commit),
            None => Self::Development,
        }
    }
}

/// The mark's layout, all ASCII: the prefix, which holds the layout's
/// version, so that another layout reads as no mark; `S` or `D` and a colon;
/// then a studio build's commit, or forty dashes for a development build.
const BUILD_MARK_PREFIX: &[u8; 24] = b"studio-control-build:v1:";
const BUILD_MARK_KIND: usize = BUILD_MARK_PREFIX.len();
const BUILD_MARK_COMMIT: usize = BUILD_MARK_KIND + 2;
pub const BUILD_MARK_LEN: usize = BUILD_MARK_COMMIT + 40;

/// This build's mark. The engine keeps it in its file (its `main`), where
/// the shell reads it.
pub const BUILD_MARK: [u8; BUILD_MARK_LEN] = build_mark_of(STUDIO_BUILD_COMMIT);

/// The mark of the studio build of `commit`, or of a development build. The
/// commit is forty characters, as `studio_build_commit` gives it (the shell's
/// tests make marks of other commits).
pub const fn build_mark_of(commit: Option<&str>) -> [u8; BUILD_MARK_LEN] {
    let mut mark = [b'-'; BUILD_MARK_LEN];
    let mut at = 0;
    while at < BUILD_MARK_KIND {
        mark[at] = BUILD_MARK_PREFIX[at];
        at += 1;
    }
    mark[BUILD_MARK_KIND] = b'D';
    mark[BUILD_MARK_KIND + 1] = b':';
    if let Some(commit) = commit {
        let bytes = commit.as_bytes();
        assert!(
            bytes.len() == 40,
            "a studio build's commit has forty characters"
        );
        mark[BUILD_MARK_KIND] = b'S';
        let mut at = 0;
        while at < 40 {
            mark[BUILD_MARK_COMMIT + at] = bytes[at];
            at += 1;
        }
    }
    mark
}

/// What `file`, an engine's bytes, says it is. Its well-formed marks must
/// all say the same; a stretch that begins like a mark and is not one is
/// passed over. A plain indexed loop: a debug shell reads a whole debug
/// engine at every start, and iterator adapters are slower there.
pub fn build_marked_in(file: &[u8]) -> MarkedBuild<'_> {
    let mut kept: Option<&[u8]> = None;
    let mut at = 0;
    while at + BUILD_MARK_LEN <= file.len() {
        if file[at] == BUILD_MARK_PREFIX[0] {
            let candidate = &file[at..at + BUILD_MARK_LEN];
            if marked_build(candidate).is_some() {
                match kept {
                    None => kept = Some(candidate),
                    Some(mark) if mark != candidate => return MarkedBuild::Conflicting,
                    Some(_) => {}
                }
                at += BUILD_MARK_LEN;
                continue;
            }
        }
        at += 1;
    }
    kept.and_then(marked_build).unwrap_or(MarkedBuild::Unmarked)
}

/// The build one well-formed mark says; `None` when `candidate` is not one.
fn marked_build(candidate: &[u8]) -> Option<MarkedBuild<'_>> {
    if candidate.len() != BUILD_MARK_LEN
        || !candidate.starts_with(BUILD_MARK_PREFIX)
        || candidate[BUILD_MARK_KIND + 1] != b':'
    {
        return None;
    }
    let commit = &candidate[BUILD_MARK_COMMIT..];
    match candidate[BUILD_MARK_KIND] {
        b'D' if commit.iter().all(|byte| *byte == b'-') => Some(MarkedBuild::Development),
        b'S' => std::str::from_utf8(commit)
            .ok()
            .and_then(|commit| studio_build_commit_from(false, Some(commit)))
            .map(MarkedBuild::Studio),
        _ => None,
    }
}

/// Whether this is a studio build.
pub fn studio_build() -> bool {
    studio_build_commit().is_some()
}

/// Whether this is a development build: every build but the studio's.
pub fn development_build() -> bool {
    !studio_build()
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
/// A studio build is refused nothing.
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
/// rest as written, a `..` in it taking the step back it names. So a folder
/// the run would create is recognised by the place it would be created in.
fn resolved(path: &Path) -> PathBuf {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut existing = absolute.clone();
    // What follows the nearest folder that exists, last part first.
    let mut rest: Vec<Option<OsString>> = Vec::new();
    let mut resolved = loop {
        if let Ok(resolved) = fs::canonicalize(&existing) {
            break resolved;
        }
        match existing.components().next_back() {
            Some(Component::Normal(name)) => rest.push(Some(name.to_os_string())),
            Some(Component::ParentDir) => rest.push(None),
            Some(Component::CurDir) => {}
            // A root or a drive that is not there: nothing resolves.
            _ => return absolute,
        }
        if !existing.pop() {
            return absolute;
        }
    };
    for part in rest.into_iter().rev() {
        match part {
            Some(name) => resolved.push(name),
            None => {
                resolved.pop();
            }
        }
    }
    resolved
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

    // Streamlining, 2026-09-28: the studio's build is the one the release
    // command marked with its commit. Until then every build without debug
    // assertions counted, so `tauri build` on a branch made an app that
    // opened the studio's saved data.
    #[test]
    fn only_a_marked_release_build_is_the_studios() {
        let commit = "55efa2990123456789abcdef0123456789abcdef";
        assert_eq!(commit.len(), 40);
        assert_eq!(studio_build_commit_from(false, Some(commit)), Some(commit));
        for (debug_assertions, marker) in [
            (false, None),
            (false, Some("")),
            (false, Some("1")),
            (false, Some("true")),
            (false, Some("55efa29")),
            (false, Some("55EFA2990123456789ABCDEF0123456789ABCDEF")),
            (false, Some("55efa2990123456789abcdef0123456789abcdeg")),
            (false, Some(" 55efa2990123456789abcdef0123456789abcde")),
            (true, Some(commit)),
            (true, None),
        ] {
            assert_eq!(
                studio_build_commit_from(debug_assertions, marker),
                None,
                "{debug_assertions} {marker:?}"
            );
        }
        // Tests are built with debug assertions.
        assert!(development_build());
        assert!(!studio_build());
        assert_eq!(STUDIO_BUILD_ENV, "SSE_STUDIO_BUILD");
    }

    // 2026-09-29: a shell started whatever engine sat beside it; now it reads
    // the engine's mark first, and starts only one of its own build.
    #[test]
    fn a_build_is_marked_with_what_it_is() {
        let commit = "55efa2990123456789abcdef0123456789abcdef";
        assert_eq!(
            build_mark_of(Some(commit)).as_slice(),
            format!("studio-control-build:v1:S:{commit}").as_bytes()
        );
        assert_eq!(
            build_mark_of(None).as_slice(),
            format!("studio-control-build:v1:D:{}", "-".repeat(40)).as_bytes()
        );
        assert_eq!(
            build_marked_in(&build_mark_of(Some(commit))),
            MarkedBuild::Studio(commit)
        );
        // This build's mark and its answer come from one place.
        assert_eq!(BUILD_MARK, build_mark_of(studio_build_commit()));
        assert_eq!(build_marked_in(&BUILD_MARK), MarkedBuild::this_build());
        // Tests are built with debug assertions.
        assert_eq!(MarkedBuild::this_build(), MarkedBuild::Development);
    }

    #[test]
    fn a_file_is_read_for_its_marks_and_nothing_else() {
        let a = "55efa2990123456789abcdef0123456789abcdef";
        let b = "0123456789abcdef0123456789abcdef01234567";
        let development = build_mark_of(None);
        let studio_a = build_mark_of(Some(a));
        let studio_b = build_mark_of(Some(b));
        let junk: &[u8] = b"\0\x7fELF studio control's strings \xff\xfe";
        let file = |parts: &[&[u8]]| parts.concat();

        assert_eq!(
            build_marked_in(&file(&[junk, &development, junk])),
            MarkedBuild::Development
        );
        assert_eq!(
            build_marked_in(&file(&[junk, &studio_a, junk])),
            MarkedBuild::Studio(a)
        );
        // At the file's very start and very end; one byte short is none.
        assert_eq!(build_marked_in(&development), MarkedBuild::Development);
        assert_eq!(
            build_marked_in(&file(&[junk, &studio_a])),
            MarkedBuild::Studio(a)
        );
        assert_eq!(
            build_marked_in(&file(&[junk, &studio_a[..BUILD_MARK_LEN - 1]])),
            MarkedBuild::Unmarked
        );
        // The same mark twice is one; marks that differ are refused.
        assert_eq!(
            build_marked_in(&file(&[&studio_a, junk, &studio_a])),
            MarkedBuild::Studio(a)
        );
        assert_eq!(
            build_marked_in(&file(&[&development, junk, &studio_a])),
            MarkedBuild::Conflicting
        );
        assert_eq!(
            build_marked_in(&file(&[&studio_a, &studio_b])),
            MarkedBuild::Conflicting
        );
        // Nothing, or nothing that is a mark.
        assert_eq!(build_marked_in(b""), MarkedBuild::Unmarked);
        assert_eq!(build_marked_in(junk), MarkedBuild::Unmarked);

        // What only looks like a mark is passed over, and a mark after it is
        // still read.
        let with = |at: usize, byte: u8, from: &[u8]| {
            let mut copy = from.to_vec();
            copy[at] = byte;
            copy
        };
        let version = BUILD_MARK_PREFIX
            .iter()
            .position(|byte| *byte == b'1')
            .expect("the prefix holds its version");
        for (why, lookalike) in [
            ("another kind", with(BUILD_MARK_KIND, b'X', &development)),
            ("no colon", with(BUILD_MARK_KIND + 1, b';', &development)),
            (
                "a development build with a commit",
                with(BUILD_MARK_KIND, b'D', &studio_a),
            ),
            ("a capital", with(BUILD_MARK_COMMIT, b'A', &studio_a)),
            ("a g", with(BUILD_MARK_COMMIT + 5, b'g', &studio_a)),
            (
                "a studio build with a dash",
                with(BUILD_MARK_COMMIT + 39, b'-', &studio_a),
            ),
            ("another layout", with(version, b'2', &development)),
        ] {
            assert_eq!(build_marked_in(&lookalike), MarkedBuild::Unmarked, "{why}");
            assert_eq!(
                build_marked_in(&file(&[&lookalike, junk, &studio_b])),
                MarkedBuild::Studio(b),
                "{why}"
            );
        }
        // The prefix alone, right before a mark.
        assert_eq!(
            build_marked_in(&file(&[BUILD_MARK_PREFIX, &studio_b])),
            MarkedBuild::Studio(b)
        );
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

            // A studio build opens it.
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
        // A detour through folders that are not there leads where it says.
        let detour = test_dir
            .path()
            .join("not")
            .join("there")
            .join("..")
            .join("..")
            .join("Studio Data")
            .join("new");
        assert!(same_or_inside(&detour, &folder));
        assert!(!same_or_inside(
            &folder.join("not-there").join("..").join(".."),
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
