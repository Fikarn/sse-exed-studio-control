//! The Pocket's Bluetooth service and its characteristics, by their UUIDs
//! (Blackmagic's Developer Information, read on the web on 2026-10-06), and
//! which of them the link writes and which it listens to. The Camera Status
//! characteristic is listened to and never written: a `0x00` written there
//! switches the camera off (`docs/HARDWARE.md`). `Writable` names every
//! characteristic the link may write, and a test holds that it never names
//! that one.

/// The Blackmagic Camera Service.
pub(crate) const SERVICE: u128 = 0x291D567A_6D75_11E6_8B77_86F30CA893D3;
/// Written: the camera control messages the operator's presses become.
pub(crate) const OUTGOING_CAMERA_CONTROL: u128 = 0x5DD3465F_1AEE_4299_8493_D2ECA2F8E1BB;
/// Notified: the camera's settings, every one once after the connection and
/// then each change.
pub(crate) const INCOMING_CAMERA_CONTROL: u128 = 0xB864E140_76A0_416A_BF30_5876504537D9;
/// Notified: the timecode, four BCD bytes.
pub(crate) const TIMECODE: u128 = 0x6D8F2110_86F1_41BF_9AFB_451D87E976C8;
/// Notified, never written: the camera's status flags.
pub(crate) const CAMERA_STATUS: u128 = 0x7FE8691D_95DC_4FC5_8ABD_CA74339B51B9;
/// Written once, when the owner says so: the controller's name, which the
/// camera shows (up to 32 characters).
pub(crate) const DEVICE_NAME: u128 = 0xFFAC0C52_C9FB_41A0_B063_CC76282EB89C;
/// Read: the camera's protocol version.
pub(crate) const PROTOCOL_VERSION: u128 = 0x8F1FD018_B508_456F_8F82_3D392BEE2706;

/// Every characteristic the link may write. The status characteristic is
/// not among them, and cannot be: the one function that writes takes one of
/// these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Writable {
    OutgoingControl,
    DeviceName,
}

impl Writable {
    pub(crate) const ALL: [Self; 2] = [Self::OutgoingControl, Self::DeviceName];

    pub(crate) fn uuid(self) -> u128 {
        match self {
            Self::OutgoingControl => OUTGOING_CAMERA_CONTROL,
            Self::DeviceName => DEVICE_NAME,
        }
    }
}

/// Every characteristic the link listens to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Notified {
    Control,
    Timecode,
    Status,
}

impl Notified {
    pub(crate) const ALL: [Self; 3] = [Self::Control, Self::Timecode, Self::Status];

    pub(crate) fn uuid(self) -> u128 {
        match self {
            Self::Control => INCOMING_CAMERA_CONTROL,
            Self::Timecode => TIMECODE,
            Self::Status => CAMERA_STATUS,
        }
    }
}
