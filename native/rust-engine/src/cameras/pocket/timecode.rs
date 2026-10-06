//! The Pocket's timecode, as its Timecode characteristic notifies it: a
//! 32-bit BCD number, `09:12:53:10` as `0x09125310` (Blackmagic's Developer
//! Information). Bluetooth sends a 32-bit value least significant byte
//! first, so the frames come first on the wire; whether the camera does the
//! same is read on the camera (the attended check), and this is the one
//! place to turn it round.

/// `HH:MM:SS:FF` from the characteristic's bytes; `None` for anything but
/// four bytes. Each byte is two decimal digits; a byte that is not (a flag
/// in a high bit, say) still prints its digits, so a wrong order shows as
/// odd numbers rather than nothing.
pub(crate) fn timecode_text(bytes: &[u8]) -> Option<String> {
    let [frames, seconds, minutes, hours] = <[u8; 4]>::try_from(bytes).ok()?;
    Some(format!(
        "{}:{}:{}:{}",
        bcd(hours & 0x3F),
        bcd(minutes),
        bcd(seconds),
        bcd(frames)
    ))
}

fn bcd(byte: u8) -> String {
    format!("{}{}", (byte >> 4) & 0x0F, byte & 0x0F)
}
