//! The zip container a `.docx` is: its central directory, and an entry stored
//! or deflated (miniz_oxide). Only what Word writes is read: no Zip64, no
//! encrypted entries, no other compression. The bytes come from outside the
//! process, so every offset and size is checked against them before it is
//! used, and inflating stops at a limit the caller names (a small zip can
//! inflate to gigabytes).
//!
//! The error strings finish the refusal sentence "… could not be read:
//! {reason}.", so they are a few plain words.

use std::collections::HashMap;

use miniz_oxide::inflate::{decompress_to_vec_with_limit, TINFLStatus};

const END_OF_CENTRAL_DIRECTORY: u32 = 0x0605_4b50;
const CENTRAL_DIRECTORY_ENTRY: u32 = 0x0201_4b50;
const LOCAL_HEADER: u32 = 0x0403_4b50;
/// The end record's fixed part; a comment of up to 65,535 bytes follows it.
const END_RECORD_LEN: usize = 22;
const LONGEST_COMMENT: usize = 65_535;
const CENTRAL_ENTRY_LEN: usize = 46;
const LOCAL_HEADER_LEN: usize = 30;
/// General-purpose flag bit 0: the entry is encrypted.
const ENCRYPTED: u16 = 1;
const STORED: u16 = 0;
const DEFLATED: u16 = 8;
/// The most entries a zip may hold. Word writes a few dozen parts, and a
/// document of many pictures a few hundred; a zip of more is not a document
/// (the end record allows 65,535).
const MOST_ENTRIES: usize = 10_000;

pub(super) const DAMAGED: &str = "the file is damaged";
const PACKED_OTHERWISE: &str = "it is packed in a way Studio Control does not read";
const LOCKED: &str = "it is locked with a password";
const TOO_LARGE: &str = "it is too large once unpacked";

/// An opened zip: the bytes, the central directory's entries, and where
/// each is by its name lower-cased, so finding one never scans them all.
pub(super) struct Zip<'a> {
    bytes: &'a [u8],
    entries: Vec<Entry>,
    by_name: HashMap<String, usize>,
}

struct Entry {
    name: String,
    flags: u16,
    method: u16,
    compressed_size: usize,
    local_header: usize,
}

impl<'a> Zip<'a> {
    /// Reads the central directory. The entries' data is not touched until
    /// `read` asks for one.
    pub(super) fn open(bytes: &'a [u8]) -> Result<Self, String> {
        let end = end_record(bytes).ok_or(DAMAGED)?;
        let count = u16_at(bytes, end + 10).ok_or(DAMAGED)?;
        let size = u32_at(bytes, end + 12).ok_or(DAMAGED)?;
        let offset = u32_at(bytes, end + 16).ok_or(DAMAGED)?;
        // All ones in the end record means the real values are in a Zip64
        // record, which Word never needs.
        if count == u16::MAX || size == u32::MAX || offset == u32::MAX {
            return Err(PACKED_OTHERWISE.to_string());
        }
        if usize::from(count) > MOST_ENTRIES {
            return Err(DAMAGED.to_string());
        }
        let mut entries = Vec::with_capacity(usize::from(count));
        let mut at = offset as usize;
        for _ in 0..count {
            if u32_at(bytes, at) != Some(CENTRAL_DIRECTORY_ENTRY) {
                return Err(DAMAGED.to_string());
            }
            let field16 = |offset: usize| u16_at(bytes, at.saturating_add(offset)).ok_or(DAMAGED);
            let field32 = |offset: usize| u32_at(bytes, at.saturating_add(offset)).ok_or(DAMAGED);
            let flags = field16(8)?;
            let method = field16(10)?;
            let compressed_size = field32(20)?;
            let uncompressed_size = field32(24)?;
            let name_len = usize::from(field16(28)?);
            let extra_len = usize::from(field16(30)?);
            let comment_len = usize::from(field16(32)?);
            let local_header = field32(42)?;
            if [compressed_size, uncompressed_size, local_header].contains(&u32::MAX) {
                return Err(PACKED_OTHERWISE.to_string());
            }
            let name_start = at.saturating_add(CENTRAL_ENTRY_LEN);
            let name = bytes
                .get(name_start..name_start.saturating_add(name_len))
                .ok_or(DAMAGED)?;
            entries.push(Entry {
                name: String::from_utf8_lossy(name).into_owned(),
                flags,
                method,
                compressed_size: compressed_size as usize,
                local_header: local_header as usize,
            });
            at = name_start.saturating_add(name_len + extra_len + comment_len);
        }
        let mut by_name = HashMap::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            // Of two entries with one name, the first is the one read.
            by_name
                .entry(entry.name.to_ascii_lowercase())
                .or_insert(index);
        }
        Ok(Self {
            bytes,
            entries,
            by_name,
        })
    }

    /// Every entry's name, in the central directory's order.
    pub(super) fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|entry| entry.name.as_str())
    }

    /// The bytes of the entry named `name` (ASCII case ignored, as the Office
    /// packages' part names are), inflated, or `None` when the zip has no such
    /// entry. `limit` caps the inflated size.
    pub(super) fn read(&self, name: &str, limit: usize) -> Result<Option<Vec<u8>>, String> {
        let Some(entry) = self
            .by_name
            .get(&name.to_ascii_lowercase())
            .and_then(|&index| self.entries.get(index))
        else {
            return Ok(None);
        };
        if entry.flags & ENCRYPTED != 0 {
            return Err(LOCKED.to_string());
        }
        let at = entry.local_header;
        if u32_at(self.bytes, at) != Some(LOCAL_HEADER) {
            return Err(DAMAGED.to_string());
        }
        let name_len = usize::from(u16_at(self.bytes, at + 26).ok_or(DAMAGED)?);
        let extra_len = usize::from(u16_at(self.bytes, at + 28).ok_or(DAMAGED)?);
        // The sizes come from the central directory: an entry written as a
        // stream has zeros in its local header and the sizes after the data.
        let start = at + LOCAL_HEADER_LEN + name_len + extra_len;
        let data = self
            .bytes
            .get(start..start.saturating_add(entry.compressed_size))
            .ok_or(DAMAGED)?;
        match entry.method {
            STORED if data.len() > limit => Err(TOO_LARGE.to_string()),
            STORED => Ok(Some(data.to_vec())),
            DEFLATED => decompress_to_vec_with_limit(data, limit)
                .map(Some)
                .map_err(|error| match error.status {
                    TINFLStatus::HasMoreOutput => TOO_LARGE.to_string(),
                    _ => DAMAGED.to_string(),
                }),
            _ => Err(PACKED_OTHERWISE.to_string()),
        }
    }
}

/// Where the end of central directory record starts: scanning back from the
/// end, past a comment of up to 65,535 bytes, for its signature with a
/// comment length that fits the bytes that follow it.
fn end_record(bytes: &[u8]) -> Option<usize> {
    let last = bytes.len().checked_sub(END_RECORD_LEN)?;
    let first = last.saturating_sub(LONGEST_COMMENT);
    (first..=last).rev().find(|&at| {
        u32_at(bytes, at) == Some(END_OF_CENTRAL_DIRECTORY)
            && u16_at(bytes, at + 20)
                .is_some_and(|comment| at + END_RECORD_LEN + usize::from(comment) <= bytes.len())
    })
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    let field = bytes.get(at..at.checked_add(2)?)?;
    Some(u16::from_le_bytes([field[0], field[1]]))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    let field = bytes.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes([field[0], field[1], field[2], field[3]]))
}
