//! The cameras' part of the backup archive (format 7, new pages program,
//! Slice 8): each camera's address and vMix input. Whether CAM 1 is paired
//! is Windows' own and stays with this PC, so the archive leaves it out and
//! a restore keeps this PC's. A restore writes the saved data only and sends
//! nothing to a camera (D12); the hardware link reads the cameras again from
//! the new setup (`commands::after_archive_restore`). In a build with no link
//! to a camera the restore leaves its address out, as Setup would refuse it,
//! and says which it left out.

use crate::cameras::model::{parse_camera_address, CAMERA_NUMBERS, VMIX_INPUT_MAX, VMIX_INPUT_MIN};
use crate::cameras::real_link::has_link;
use crate::cameras::store::{read_setup, write_setup};
use crate::storage::EngineResult;
use rusqlite::{Connection, Transaction};
use serde::{Deserialize, Serialize};

/// One camera in the archive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ArchivedCamera {
    pub camera: u8,
    /// CAM 2's or CAM 3's address; `null` for CAM 1 and for a camera with
    /// none.
    pub address: Option<String>,
    #[serde(rename = "vmixInput")]
    pub vmix_input: u32,
}

pub(crate) fn build_cameras_archive(connection: &Connection) -> EngineResult<Vec<ArchivedCamera>> {
    Ok(read_setup(connection)?
        .into_iter()
        .map(|setup| ArchivedCamera {
            camera: setup.camera,
            address: setup.address.filter(|_| setup.camera != 1),
            vmix_input: setup.vmix_input,
        })
        .collect())
}

/// Writes the archive's addresses and vMix inputs inside the restore's
/// transaction; the pairing stays as this PC has it. A camera the archive
/// does not name keeps its setup, and so does a value this build would not
/// take from Setup (an address that is not one machine's, a vMix input out
/// of range, an address in a build with no link to the camera): the restore
/// never writes what Setup would refuse. Answers the cameras whose address
/// it left out for want of a link, in their order.
pub(crate) fn restore_cameras_archive(
    transaction: &Transaction<'_>,
    cameras: &[ArchivedCamera],
    simulated: bool,
) -> EngineResult<Vec<u8>> {
    let mut rows = read_setup(transaction)?;
    let mut left_out = Vec::new();
    for archived in cameras {
        if !CAMERA_NUMBERS.contains(&archived.camera) {
            continue;
        }
        let row = &mut rows[usize::from(archived.camera) - 1];
        if archived.camera != 1 {
            match archived.address.as_deref() {
                None => row.address = None,
                Some(address) => {
                    if let Some(address) = parse_camera_address(address) {
                        if has_link(archived.camera, simulated) {
                            row.address = Some(address);
                        } else if row.address.as_deref() != Some(address.as_str())
                            && !left_out.contains(&archived.camera)
                        {
                            left_out.push(archived.camera);
                        }
                    }
                }
            }
        }
        if (VMIX_INPUT_MIN..=VMIX_INPUT_MAX).contains(&archived.vmix_input) {
            row.vmix_input = archived.vmix_input;
        }
        write_setup(transaction, row)?;
    }
    left_out.sort_unstable();
    Ok(left_out)
}
