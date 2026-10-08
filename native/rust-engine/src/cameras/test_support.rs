//! What the cameras' tests share: a database of their own, the request path
//! the screen takes, the simulated cameras' hooks (the body, a camera that
//! stops answering) and the events announced outside a request's reply.

use crate::cameras::model::Setting;
use crate::cameras::runtime::{self, ANNOUNCED};
use crate::cameras::simulated::{CameraCommand, CameraValue, SIMULATED_PIN};
use crate::cameras::store::{write_setup, StoredSetup};
use crate::cameras::{handle_cameras_request, CameraError, CamerasReply};
use crate::storage::{initialize_test_database, open_connection};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

/// CAM 2's and CAM 3's addresses in the tests. The simulated link never
/// reaches for them; the real one would be stopped by the drift guard.
pub(crate) const CAM2_ADDRESS: &str = "172.16.16.85";
pub(crate) const CAM3_ADDRESS: &str = "172.16.16.86";

pub(crate) struct TestCameras {
    root: PathBuf,
    pub db_path: PathBuf,
    /// `SSE_CAMERAS_SIMULATED=1`.
    pub simulated: bool,
}

impl TestCameras {
    /// New saved data with the simulated cameras, nothing set up.
    pub(crate) fn new(label: &str) -> Self {
        Self::with_link(label, true)
    }

    /// New saved data without the simulated cameras (the live app before
    /// Slices 11 and 13).
    pub(crate) fn without_simulation(label: &str) -> Self {
        Self::with_link(label, false)
    }

    fn with_link(label: &str, simulated: bool) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "studio-control-cameras-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&root).expect("test dir should be created");
        let db_path = root.join("studio-control.sqlite3");
        initialize_test_database(&db_path).expect("database should initialize");
        take_announced();
        Self {
            root,
            db_path,
            simulated,
        }
    }

    /// New saved data with all three cameras set up and held: CAM 1 paired,
    /// CAM 2 and CAM 3 at their addresses.
    pub(crate) fn set_up(label: &str) -> Self {
        let cameras = Self::new(label);
        cameras.pair_cam_1();
        cameras.call(
            "cameras.setup.update",
            json!({ "camera": 2, "address": CAM2_ADDRESS }),
        );
        cameras.call(
            "cameras.setup.update",
            json!({ "camera": 3, "address": CAM3_ADDRESS }),
        );
        take_announced();
        cameras
    }

    pub(crate) fn path(&self) -> &Path {
        &self.db_path
    }

    /// Pairs the simulated CAM 1 as Setup does: `Pair CAM 1`, then the PIN
    /// the camera shows.
    pub(crate) fn pair_cam_1(&self) {
        self.call("cameras.setup.pair", json!({ "camera": 1 }));
        self.call(
            "cameras.setup.pair",
            json!({ "camera": 1, "pin": SIMULATED_PIN }),
        );
    }

    /// A request as the screen sends it; the whole reply.
    pub(crate) fn reply(&self, method: &str, params: Value) -> Result<CamerasReply, CameraError> {
        handle_cameras_request(&self.db_path, self.simulated, method, &params)
    }

    /// A request that must succeed; its result.
    pub(crate) fn call(&self, method: &str, params: Value) -> Value {
        self.reply(method, params)
            .unwrap_or_else(|error| panic!("{method} should succeed: {error:?}"))
            .result
    }

    /// A request that must be refused; its code and sentence.
    pub(crate) fn refused(&self, method: &str, params: Value) -> (String, String) {
        match self.reply(method, params) {
            Ok(reply) => panic!("{method} should be refused, answered {}", reply.result),
            Err(CameraError::Refused(code, sentence)) => (code.to_string(), sentence),
            Err(CameraError::Invalid(sentence)) => (String::from("INVALID_PARAMS"), sentence),
            Err(CameraError::Storage(message)) => (String::from("STORAGE_ERROR"), message),
        }
    }

    /// A refusal's code alone.
    pub(crate) fn code(&self, method: &str, params: Value) -> String {
        self.refused(method, params).0
    }

    pub(crate) fn snapshot(&self) -> Value {
        self.call("cameras.snapshot", json!({}))
    }

    /// One camera in `cameras.snapshot`.
    pub(crate) fn camera(&self, camera: u8) -> Value {
        self.snapshot()["cameras"][usize::from(camera) - 1].clone()
    }

    /// `checks.cameras`.
    pub(crate) fn health(&self) -> crate::cameras::snapshot::CamerasHealthCheck {
        crate::cameras::cameras_health_check(&self.db_path, self.simulated)
            .expect("the check should read")
    }

    /// What the simulated camera was sent, oldest first.
    pub(crate) fn sent(&self, camera: u8) -> Vec<CameraCommand> {
        runtime::sent(&self.db_path, camera)
    }

    /// Nothing sent to any camera.
    pub(crate) fn nothing_sent(&self) -> bool {
        [1, 2, 3].iter().all(|camera| self.sent(*camera).is_empty())
    }

    /// A start: the hardware link forgets what it held; the cameras stay.
    pub(crate) fn restart(&self) {
        runtime::forget(&self.db_path);
    }

    /// Saved data that holds an address Setup did not take here, as a
    /// database backup restored whole brings it: the row is written, and
    /// the hardware link starts.
    pub(crate) fn starts_with_address(&self, camera: u8, address: &str) {
        let connection = open_connection(&self.db_path).expect("connection should open");
        write_setup(
            &connection,
            &StoredSetup {
                address: Some(String::from(address)),
                ..StoredSetup::new(camera)
            },
        )
        .expect("the row writes");
        self.restart();
    }

    /// The body: a value changed on the camera itself, or from the iPad.
    pub(crate) fn body_sets(&self, camera: u8, setting: Setting, value: CameraValue) {
        runtime::with_bodies(&self.db_path, |bodies| {
            bodies.body_sets(camera, setting, value);
        });
    }

    /// The body stops reporting a setting.
    pub(crate) fn body_clears(&self, camera: u8, setting: Setting) {
        runtime::with_bodies(&self.db_path, |bodies| {
            bodies.body_clears(camera, setting);
        });
    }

    /// The body starts or stops a take.
    pub(crate) fn body_records(&self, camera: u8, recording: bool) {
        runtime::with_bodies(&self.db_path, |bodies| {
            bodies.body_records(camera, recording);
        });
    }

    /// The camera stops answering (`false`) or answers again (`true`).
    pub(crate) fn answering(&self, camera: u8, answering: bool) {
        runtime::with_bodies(&self.db_path, |bodies| {
            bodies.set_answering(camera, answering);
        });
    }

    /// The camera's link has brought no setting since it connected
    /// (`false`), or the camera reports (`true`; finding 19).
    pub(crate) fn reporting(&self, camera: u8, reporting: bool) {
        runtime::with_bodies(&self.db_path, |bodies| {
            bodies.set_reporting(camera, reporting);
        });
    }

    /// The time of day the camera's timecode reads.
    pub(crate) fn set_clock(&self, camera: u8, time_of_day: std::time::Duration) {
        runtime::with_bodies(&self.db_path, |bodies| {
            bodies.set_clock(camera, time_of_day);
        });
    }
}

impl Drop for TestCameras {
    fn drop(&mut self) {
        runtime::remove(&self.db_path);
        crate::pictures_helper::set_status_for_test(&self.db_path, None);
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// The events announced on this thread since the last call, as (event,
/// payload).
pub(crate) fn take_announced() -> Vec<(String, Value)> {
    ANNOUNCED.with(|events| std::mem::take(&mut *events.borrow_mut()))
}

/// The `cameras.changed` reasons and cameras announced since the last call,
/// and whether `app.changed { reason: "health" }` followed.
pub(crate) fn announced_changes() -> (Vec<(String, Value)>, bool) {
    let events = take_announced();
    let health = events
        .iter()
        .any(|(event, payload)| event == "app.changed" && payload["reason"] == "health");
    let changes = events
        .into_iter()
        .filter(|(event, _)| event == "cameras.changed")
        .map(|(_, payload)| {
            (
                payload["reason"].as_str().unwrap_or_default().to_string(),
                payload["camera"].clone(),
            )
        })
        .collect();
    (changes, health)
}

/// A refused request's code and sentence, for the assertions.
pub(crate) fn refusal(code: &str, sentence: &str) -> (String, String) {
    (String::from(code), String::from(sentence))
}

/// Every word the operator reads is clean of the words they never read.
pub(crate) fn assert_operator_words(sentence: &str) {
    for word in sentence
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
    {
        assert!(
            ![
                "engine",
                "backend",
                "transport",
                "ipc",
                "snapshot",
                "snapshots"
            ]
            .contains(&word),
            "\"{sentence}\" says {word}"
        );
    }
}
