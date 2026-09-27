//! Character references in pasted HTML: `&#229;`, `&#xE5;` and the names
//! Word, browsers and Google Docs write.

use std::borrow::Cow;

use super::slice;

/// Reads the character references in a text. An unknown name stays as it was
/// written.
pub(super) fn decode_entities(text: &str) -> Cow<'_, str> {
    if !text.contains('&') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(ampersand) = rest.find('&') {
        out.push_str(&rest[..ampersand]);
        let after = &rest[ampersand + 1..];
        match entity(after) {
            Some((decoded, used)) => {
                out.push_str(&decoded);
                rest = slice(after, used, after.len());
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

/// The entity at the start of `after` (the text after a `&`): what it stands
/// for and how many bytes it takes, its `;` included.
fn entity(after: &str) -> Option<(String, usize)> {
    if let Some(number) = after.strip_prefix('#') {
        let (digits, radix, marker) = match number.strip_prefix(['x', 'X']) {
            Some(hex) => (hex, 16, 2),
            None => (number, 10, 1),
        };
        let length = digits
            .bytes()
            .take_while(|byte| byte.is_ascii_digit() || (radix == 16 && byte.is_ascii_hexdigit()))
            .count();
        if length == 0 {
            return None;
        }
        let code = u32::from_str_radix(slice(digits, 0, length.min(8)), radix).unwrap_or(0);
        let code = if length > 8 { 0 } else { code };
        let semicolon = usize::from(digits.as_bytes().get(length) == Some(&b';'));
        return Some((numeric_character(code), marker + length + semicolon));
    }
    let length = after.bytes().take_while(u8::is_ascii_alphanumeric).count();
    if length == 0 || after.as_bytes().get(length) != Some(&b';') {
        return None;
    }
    let decoded = named_entity(slice(after, 0, length))?;
    Some((decoded.to_string(), length + 1))
}

/// A numeric reference's character. 128–159 are read as Windows-1252, as the
/// HTML standard says (old Word pages write `&#150;` for an en dash); 0, a
/// surrogate or a number past Unicode is U+FFFD.
fn numeric_character(code: u32) -> String {
    let character = match u8::try_from(code) {
        Ok(byte @ 0x80..=0x9F) => super::super::txt::windows_1252_char(byte),
        _ if code == 0 => Some('\u{FFFD}'),
        _ => Some(char::from_u32(code).unwrap_or('\u{FFFD}')),
    };
    character.map(String::from).unwrap_or_default()
}

fn named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => "\u{00A0}",
        "ndash" => "–",
        "mdash" => "—",
        "hellip" => "…",
        "lsquo" => "‘",
        "rsquo" => "’",
        "sbquo" => "‚",
        "ldquo" => "“",
        "rdquo" => "”",
        "bdquo" => "„",
        "laquo" => "«",
        "raquo" => "»",
        "bull" => "•",
        "middot" => "·",
        "copy" => "©",
        "reg" => "®",
        "trade" => "™",
        "euro" => "€",
        "pound" => "£",
        "deg" => "°",
        "times" => "×",
        "divide" => "÷",
        "aring" => "å",
        "auml" => "ä",
        "ouml" => "ö",
        "Aring" => "Å",
        "Auml" => "Ä",
        "Ouml" => "Ö",
        "eacute" => "é",
        "Eacute" => "É",
        "egrave" => "è",
        "uuml" => "ü",
        "Uuml" => "Ü",
        "oslash" => "ø",
        "Oslash" => "Ø",
        "aelig" => "æ",
        "AElig" => "Æ",
        "szlig" => "ß",
        "ensp" => "\u{2002}",
        "emsp" => "\u{2003}",
        "thinsp" => "\u{2009}",
        "shy" | "zwnj" | "zwj" => "",
        _ => return None,
    })
}
