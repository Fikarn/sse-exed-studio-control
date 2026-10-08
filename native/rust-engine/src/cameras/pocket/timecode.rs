//! The Pocket's timecode, as its Timecode characteristic notifies it: a
//! 32-bit BCD number, `09:12:53:10` as `0x09125310` (Blackmagic's Developer
//! Information), least significant byte first, so the frames come first on
//! the wire. The camera notifies twelve bytes, a camera control message's
//! frame around the timecode, which is the last four (Magic Pocket Control
//! reads it so; our first attended run, 2026-10-07, dropped every one of
//! them by taking only four-byte notifications).

/// `HH:MM:SS:FF` from the characteristic's bytes: the last four of a
/// twelve-byte notification, or four bytes alone; `None` for anything else.
/// Each byte is two decimal digits; a byte that is not (a flag in a high
/// bit, say) still prints its digits, so a wrong order shows as odd numbers
/// rather than nothing.
pub(crate) fn timecode_text(bytes: &[u8]) -> Option<String> {
    let four = match bytes.len() {
        4 => bytes,
        12 => bytes.get(8..)?,
        _ => return None,
    };
    let [frames, seconds, minutes, hours] = <[u8; 4]>::try_from(four).ok()?;
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
