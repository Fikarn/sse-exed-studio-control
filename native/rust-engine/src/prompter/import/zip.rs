//! The zip container a `.docx` is: its central directory, and an entry stored
//! or deflated (miniz_oxide).

/// The bytes of the entry named `name`, inflated, or `None` when the archive
/// has no such entry. `limit` caps the inflated size.
pub(super) fn read_entry(
    _bytes: &[u8],
    _name: &str,
    _limit: usize,
) -> Result<Option<Vec<u8>>, String> {
    Ok(None)
}
