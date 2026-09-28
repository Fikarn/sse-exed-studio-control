//! Setup's part of the cameras in the saved data (schema 10): `camera_setup`,
//! one row a camera — CAM 2's and CAM 3's address, whether CAM 1 is paired,
//! and the vMix input that carries each camera's picture. Nothing else about
//! a camera is saved: who holds it and what it reports are the camera's own
//! (D12, D13), and the selection is kept in memory (D19).

use crate::cameras::model::{CAMERA_NUMBERS, VMIX_INPUT_MAX, VMIX_INPUT_MIN};
use crate::cameras::snapshot::CameraSetupSummary;
use rusqlite::{params, Connection};

/// One camera's row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredSetup {
    pub camera: u8,
    /// CAM 2's or CAM 3's address; always `None` for CAM 1.
    pub address: Option<String>,
    /// CAM 1 is paired; always `false` for CAM 2 and CAM 3.
    pub paired: bool,
    pub vmix_input: u32,
}

impl StoredSetup {
    /// A camera's row in new saved data: nothing entered, its own number as
    /// its vMix input.
    pub(crate) fn new(camera: u8) -> Self {
        Self {
            camera,
            address: None,
            paired: false,
            vmix_input: u32::from(camera),
        }
    }

    /// Setup holds it: CAM 1 is paired, or CAM 2's or CAM 3's address is
    /// entered (D15).
    pub(crate) fn set_up(&self) -> bool {
        if self.camera == 1 {
            self.paired
        } else {
            self.address.is_some()
        }
    }

    /// The saved part of the summary; whether the build has a link to the
    /// camera is the hardware link's to add (`CameraRuntime::setup_summary`).
    pub(crate) fn summary(&self) -> CameraSetupSummary {
        CameraSetupSummary {
            set_up: self.set_up(),
            address: self.address.clone().filter(|_| self.camera != 1),
            paired: self.camera == 1 && self.paired,
            vmix_input: self.vmix_input,
            no_link: None,
        }
    }
}

/// The three rows, CAM 1 first. A row that is missing reads as new saved
/// data has it; a vMix input out of range reads as the camera's own number.
pub(crate) fn read_setup(connection: &Connection) -> Result<[StoredSetup; 3], rusqlite::Error> {
    let mut rows = CAMERA_NUMBERS.map(StoredSetup::new);
    let mut statement = connection
        .prepare("SELECT camera, address, paired, vmix_input FROM camera_setup ORDER BY camera")?;
    let stored = statement.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    for row in stored {
        let (camera, address, paired, vmix_input) = row?;
        let Some(slot) = u8::try_from(camera)
            .ok()
            .filter(|camera| CAMERA_NUMBERS.contains(camera))
        else {
            continue;
        };
        let vmix_input = u32::try_from(vmix_input)
            .ok()
            .filter(|input| (VMIX_INPUT_MIN..=VMIX_INPUT_MAX).contains(input))
            .unwrap_or(u32::from(slot));
        rows[usize::from(slot) - 1] = StoredSetup {
            camera: slot,
            address: address.filter(|address| !address.trim().is_empty()),
            paired: paired == 1,
            vmix_input,
        };
    }
    Ok(rows)
}

/// Writes one camera's row.
pub(crate) fn write_setup(
    connection: &Connection,
    setup: &StoredSetup,
) -> Result<(), rusqlite::Error> {
    connection.execute(
        "INSERT INTO camera_setup (camera, address, paired, vmix_input)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(camera) DO UPDATE SET
           address = excluded.address,
           paired = excluded.paired,
           vmix_input = excluded.vmix_input",
        params![
            i64::from(setup.camera),
            setup.address,
            i64::from(setup.paired),
            i64::from(setup.vmix_input)
        ],
    )?;
    Ok(())
}
