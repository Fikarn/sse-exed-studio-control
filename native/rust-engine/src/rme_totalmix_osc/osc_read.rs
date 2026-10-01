//! A second reading for what the OSC library could not read in a datagram
//! from TotalMix (the studio walk of 2026-10-01).
//!
//! TotalMix writes a name in Windows-1252: a channel named `BÖÖM` arrives as
//! the bytes `42 D6 D6 4D`. The library reads a string only as UTF-8, so it
//! refuses such a message. In a bundle it loses every element after it, and
//! in a bundle inside a bundle it drops them without a word.
//!
//! The library stays the reader of everything it can read. This picks up
//! where it stopped and reads again only the messages it refused, taking a
//! string argument that is not UTF-8 as Windows-1252, as the names file is
//! read (`rme_totalmix_names`). An element that neither reading can read is
//! skipped, and the rest of its bundle is still read: each element's size
//! says where the next one begins.

use crate::prompter::import::txt::windows_1252;
use rosc::{decoder, OscMessage, OscPacket, OscType};

/// `#bundle`, its NUL and the 8-byte time tag; a bundle's elements follow.
const BUNDLE_HEADER_BYTES: usize = 16;
const ENDS_TOO_SOON: &str = "it ends too soon";

/// A datagram as read: its packet, when any of it could be read, and what
/// was left unread, in words for the engine log and as the bytes from where
/// the reading stopped.
pub(super) struct ReadDatagram<'a> {
    pub(super) packet: Option<OscPacket>,
    pub(super) unread: Option<(String, &'a [u8])>,
}

/// What neither reading could read of a bundle: how many bytes, and the
/// bytes from the first element skipped.
#[derive(Default)]
struct Skipped<'a> {
    bytes: usize,
    first: Option<&'a [u8]>,
}

impl<'a> Skipped<'a> {
    fn add(&mut self, other: Skipped<'a>) {
        self.bytes += other.bytes;
        self.first = self.first.or(other.first);
    }
}

/// Reads a datagram from TotalMix: by the OSC library, then again where the
/// library stopped.
pub(super) fn read_datagram(bytes: &[u8]) -> ReadDatagram<'_> {
    match decoder::decode_udp(bytes) {
        Ok((rest, OscPacket::Bundle(mut bundle))) => {
            let skipped = read_bundle_again(&mut bundle.content, bundle_elements(bytes), rest);
            ReadDatagram {
                packet: Some(OscPacket::Bundle(bundle)),
                unread: skipped.first.map(|from| {
                    (
                        format!(
                            "a bundle with {} of its {} bytes left unread",
                            skipped.bytes,
                            bytes.len()
                        ),
                        from,
                    )
                }),
            }
        }
        // A message's bytes after its arguments are ignored, as before.
        Ok((_, packet)) => ReadDatagram {
            packet: Some(packet),
            unread: None,
        },
        Err(error) => match read_message(bytes) {
            Ok(message) => ReadDatagram {
                packet: Some(OscPacket::Message(message)),
                unread: None,
            },
            Err(why) => ReadDatagram {
                packet: None,
                unread: Some((
                    format!(
                        "a datagram of {} bytes refused ({error}; read again: {why})",
                        bytes.len()
                    ),
                    bytes,
                )),
            },
        },
    }
}

/// Reads again what the library left of a bundle: it read `content` from
/// the bundle's `elements` and stopped at `rest`. A bundle among what it
/// read is looked into as well, because the library drops the rest of a
/// bundle inside a bundle without a word.
fn read_bundle_again<'a>(
    content: &mut Vec<OscPacket>,
    elements: &'a [u8],
    rest: &'a [u8],
) -> Skipped<'a> {
    let mut skipped = Skipped::default();
    let mut at = elements;
    for packet in content.iter_mut() {
        // From a size that is not a multiple of 4 on, the library counted
        // the padding from another start than the element's own: a bundle
        // there is left as it was read.
        let Some((element, after)) = split_element(at) else {
            break;
        };
        if let OscPacket::Bundle(inner) = packet {
            if let Ok((inner_rest, _)) = decoder::decode_udp(element) {
                skipped.add(read_bundle_again(
                    &mut inner.content,
                    bundle_elements(element),
                    inner_rest,
                ));
            }
        }
        at = after;
    }
    skipped.add(read_rest_of_bundle(content, rest));
    skipped
}

/// Reads the elements the library left, `rest`, one by one into `content`.
/// One that neither reading can read is skipped. A size that is 0, not a
/// multiple of 4 or past the end stops the reading there.
fn read_rest_of_bundle<'a>(content: &mut Vec<OscPacket>, mut rest: &'a [u8]) -> Skipped<'a> {
    let mut skipped = Skipped::default();
    while !rest.is_empty() {
        let Some((element, after)) = split_element(rest) else {
            skipped.add(Skipped {
                bytes: rest.len(),
                first: Some(rest),
            });
            break;
        };
        match decoder::decode_udp(element) {
            Ok((inner_rest, OscPacket::Bundle(mut inner))) => {
                skipped.add(read_bundle_again(
                    &mut inner.content,
                    bundle_elements(element),
                    inner_rest,
                ));
                content.push(OscPacket::Bundle(inner));
            }
            Ok((_, packet)) => content.push(packet),
            Err(_) => match read_message(element) {
                Ok(message) => content.push(OscPacket::Message(message)),
                Err(_) => skipped.add(Skipped {
                    bytes: rest.len() - after.len(),
                    first: Some(rest),
                }),
            },
        }
        rest = after;
    }
    skipped
}

/// A bundle's elements: what follows its header.
fn bundle_elements(bundle: &[u8]) -> &[u8] {
    bundle.get(BUNDLE_HEADER_BYTES..).unwrap_or_default()
}

/// The first element of `elements` and what follows it, when its size is
/// one an element can have: above 0, a multiple of 4, and within the bytes.
fn split_element(elements: &[u8]) -> Option<(&[u8], &[u8])> {
    let mut at = 0;
    let size = usize::try_from(u32::from_be_bytes(take(elements, &mut at).ok()?)).ok()?;
    if size == 0 || !size.is_multiple_of(4) {
        return None;
    }
    let end = at.checked_add(size)?;
    Some((elements.get(at..end)?, elements.get(end..)?))
}

/// One message, read as the library reads it, except that a string argument
/// that is not UTF-8 is read as Windows-1252. The address and the type tags
/// get no such second chance, and only the type tags TotalMix sends are read.
fn read_message(bytes: &[u8]) -> Result<OscMessage, &'static str> {
    let mut at = 0;
    let addr = std::str::from_utf8(osc_string(bytes, &mut at)?)
        .map_err(|_| "an address that is not UTF-8")?;
    if !addr.starts_with('/') {
        return Err("an address that does not begin with /");
    }
    let tags = osc_string(bytes, &mut at)?
        .strip_prefix(b",")
        .ok_or("type tags without their comma")?;
    let mut args = Vec::with_capacity(tags.len());
    for &tag in tags {
        args.push(match tag {
            b'f' => OscType::Float(f32::from_be_bytes(take(bytes, &mut at)?)),
            b'i' => OscType::Int(i32::from_be_bytes(take(bytes, &mut at)?)),
            b'd' => OscType::Double(f64::from_be_bytes(take(bytes, &mut at)?)),
            b'h' => OscType::Long(i64::from_be_bytes(take(bytes, &mut at)?)),
            b's' => OscType::String(text(osc_string(bytes, &mut at)?)),
            b'T' => OscType::Bool(true),
            b'F' => OscType::Bool(false),
            b'N' => OscType::Nil,
            b'I' => OscType::Inf,
            _ => return Err("a type tag TotalMix does not send"),
        });
    }
    Ok(OscMessage {
        addr: addr.to_string(),
        args,
    })
}

/// An OSC string at `at`: its bytes before its NUL. `at` moves past the NUL
/// and the padding to the next multiple of 4.
fn osc_string<'a>(bytes: &'a [u8], at: &mut usize) -> Result<&'a [u8], &'static str> {
    let rest = bytes.get(*at..).ok_or(ENDS_TOO_SOON)?;
    let nul = rest
        .iter()
        .position(|&byte| byte == 0)
        .ok_or(ENDS_TOO_SOON)?;
    let padded = (nul + 4) & !3;
    if padded > rest.len() {
        return Err(ENDS_TOO_SOON);
    }
    *at += padded;
    Ok(&rest[..nul])
}

/// The `N` bytes at `at`; `at` moves past them.
fn take<const N: usize>(bytes: &[u8], at: &mut usize) -> Result<[u8; N], &'static str> {
    let end = at.checked_add(N).ok_or(ENDS_TOO_SOON)?;
    let taken = bytes.get(*at..end).ok_or(ENDS_TOO_SOON)?;
    *at = end;
    taken.try_into().map_err(|_| ENDS_TOO_SOON)
}

/// A string argument: UTF-8 when it is UTF-8, else Windows-1252, decided for
/// each string on its own.
fn text(raw: &[u8]) -> String {
    match std::str::from_utf8(raw) {
        Ok(text) => text.to_string(),
        Err(_) => windows_1252(raw),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rme_totalmix_osc::RECEIVE_BUFFER_BYTES;
    use proptest::prelude::*;
    use rosc::{encoder, OscBundle, OscTime};

    /// An OSC string: the bytes, a NUL, and NULs to a multiple of 4.
    fn osc_str(raw: &[u8]) -> Vec<u8> {
        let mut bytes = raw.to_vec();
        bytes.push(0);
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
        bytes
    }

    /// A message's bytes: its address, its type tags and its arguments.
    fn message(address: &[u8], tags: &[u8], args: &[&[u8]]) -> Vec<u8> {
        let mut bytes = osc_str(address);
        bytes.extend(osc_str(tags));
        for arg in args {
            bytes.extend_from_slice(arg);
        }
        bytes
    }

    fn float(address: &str, value: f32) -> Vec<u8> {
        message(address.as_bytes(), b",f", &[&value.to_be_bytes()])
    }

    fn name(address: &str, raw: &[u8]) -> Vec<u8> {
        message(address.as_bytes(), b",s", &[&osc_str(raw)])
    }

    /// A bundle's bytes, its time tag (0, 1), each element after its size.
    fn bundle(elements: &[Vec<u8>]) -> Vec<u8> {
        bundle_at((0, 1).into(), elements)
    }

    /// A bundle's bytes at a time tag: `#bundle`, the tag's seconds and
    /// fraction, each element after its size.
    fn bundle_at(timetag: OscTime, elements: &[Vec<u8>]) -> Vec<u8> {
        let mut bytes = osc_str(b"#bundle");
        bytes.extend_from_slice(&timetag.seconds.to_be_bytes());
        bytes.extend_from_slice(&timetag.fractional.to_be_bytes());
        for element in elements {
            let size = u32::try_from(element.len()).expect("an element's size fits");
            bytes.extend_from_slice(&size.to_be_bytes());
            bytes.extend_from_slice(element);
        }
        bytes
    }

    fn number(addr: &str, value: f32) -> OscPacket {
        OscPacket::Message(OscMessage {
            addr: addr.to_string(),
            args: vec![OscType::Float(value)],
        })
    }

    fn words(addr: &str, value: &str) -> OscPacket {
        OscPacket::Message(OscMessage {
            addr: addr.to_string(),
            args: vec![OscType::String(value.to_string())],
        })
    }

    fn bundled(content: Vec<OscPacket>) -> OscPacket {
        OscPacket::Bundle(OscBundle {
            timetag: (0, 1).into(),
            content,
        })
    }

    /// A channel's report as TotalMix sends it, its name in Windows-1252.
    fn channel_report() -> Vec<Vec<u8>> {
        vec![
            float("/input/8/gain", 0.5),
            name("/input/8/name", b"R\xF6st"),
            float("/input/8/mute", 1.0),
            float("/input/8/solo", 0.0),
        ]
    }

    fn channel_report_read() -> Vec<OscPacket> {
        vec![
            number("/input/8/gain", 0.5),
            words("/input/8/name", "Röst"),
            number("/input/8/mute", 1.0),
            number("/input/8/solo", 0.0),
        ]
    }

    /// A name of 4 bytes takes 4 NULs after it, and the field after them, a
    /// level here, is read from its own place.
    #[test]
    fn a_name_in_windows_1252_is_read() {
        let bytes = message(
            b"/input/8/name",
            b",sf",
            &[&osc_str(&[0x42, 0xD6, 0xD6, 0x4D]), &0.5_f32.to_be_bytes()],
        );
        assert_eq!(
            &bytes[bytes.len() - 12..],
            &[0x42, 0xD6, 0xD6, 0x4D, 0, 0, 0, 0, 0x3F, 0, 0, 0]
        );
        assert!(
            decoder::decode_udp(&bytes).is_err(),
            "the library alone refuses it"
        );

        let read = read_datagram(&bytes);
        assert_eq!(
            read.packet,
            Some(OscPacket::Message(OscMessage {
                addr: String::from("/input/8/name"),
                args: vec![OscType::String(String::from("BÖÖM")), OscType::Float(0.5)],
            }))
        );
        assert!(read.unread.is_none());
    }

    #[test]
    fn the_rest_of_the_bundle_after_such_a_name_is_read() {
        let bytes = bundle(&channel_report());
        let (rest, _) = decoder::decode_udp(&bytes).expect("the library reads the start");
        assert!(!rest.is_empty(), "the library alone leaves the rest");

        let read = read_datagram(&bytes);
        assert_eq!(read.packet, Some(bundled(channel_report_read())));
        assert!(read.unread.is_none());
    }

    #[test]
    fn utf8_stays_utf8_and_each_string_is_decided_alone() {
        let bytes = message(
            b"/input/8/name",
            b",ss",
            &[&osc_str("Röst".as_bytes()), &osc_str(&[0x80, 0x81])],
        );
        assert!(decoder::decode_udp(&bytes).is_err());

        let read = read_datagram(&bytes);
        assert_eq!(
            read.packet,
            Some(OscPacket::Message(OscMessage {
                addr: String::from("/input/8/name"),
                // 0x81 is a byte Windows-1252 leaves undefined: it is dropped.
                args: vec![
                    OscType::String(String::from("Röst")),
                    OscType::String(String::from("€")),
                ],
            }))
        );
        assert!(read.unread.is_none());
    }

    #[test]
    fn an_unreadable_element_is_skipped_and_the_rest_read() {
        let first = float("/level/out/0", -6.0);
        let unreadable = message(b"/level/in/0", b",x", &[&(-6.0_f32).to_be_bytes()]);
        let bytes = bundle(&[
            first.clone(),
            unreadable.clone(),
            float("/level/out/1", -7.0),
        ]);

        let read = read_datagram(&bytes);
        assert_eq!(
            read.packet,
            Some(bundled(vec![
                number("/level/out/0", -6.0),
                number("/level/out/1", -7.0),
            ]))
        );
        let (what, from) = read.unread.expect("the skipped element is noted");
        assert_eq!(
            what,
            format!(
                "a bundle with {} of its {} bytes left unread",
                4 + unreadable.len(),
                bytes.len()
            )
        );
        let size_at = BUNDLE_HEADER_BYTES + 4 + first.len();
        assert_eq!(from, &bytes[size_at..], "from the element's size on");
    }

    #[test]
    fn an_element_size_past_the_end_stops_the_reading_there() {
        let mut elements = channel_report();
        elements.truncate(3);
        let mut bytes = bundle(&elements);
        let size_at = bytes.len() - elements[2].len() - 4;
        bytes[size_at..size_at + 4].copy_from_slice(&1_024_u32.to_be_bytes());

        let read = read_datagram(&bytes);
        assert_eq!(
            read.packet,
            Some(bundled(vec![
                number("/input/8/gain", 0.5),
                words("/input/8/name", "Röst"),
            ]))
        );
        let (what, from) = read.unread.expect("the rest is noted");
        assert_eq!(
            what,
            format!(
                "a bundle with {} of its {} bytes left unread",
                bytes.len() - size_at,
                bytes.len()
            )
        );
        assert_eq!(from, &bytes[size_at..]);
    }

    #[test]
    fn a_datagram_neither_reading_can_read_is_refused_with_both_reasons() {
        let whole = float("/level/out/0", -6.0);
        let bytes = &whole[..whole.len() - 2];

        let read = read_datagram(bytes);
        assert!(read.packet.is_none());
        let (what, from) = read.unread.expect("the refusal is noted");
        assert!(
            what.starts_with(&format!("a datagram of {} bytes refused (", bytes.len())),
            "{what}"
        );
        assert!(what.ends_with("; read again: it ends too soon)"), "{what}");
        assert_eq!(from, bytes, "the whole datagram");
    }

    #[test]
    fn only_arguments_get_windows_1252() {
        let address = message(b"/input/\xD6/gain", b",f", &[&0.5_f32.to_be_bytes()]);
        assert!(read_datagram(&address).packet.is_none());
        assert_eq!(
            read_message(&address).err(),
            Some("an address that is not UTF-8")
        );

        // The library skips the first type tag whatever it is; this does not.
        let no_comma = message(b"/input/8/name", b"ss", &[&osc_str(b"R\xF6st")]);
        assert!(read_datagram(&no_comma).packet.is_none());
        assert_eq!(
            read_message(&no_comma).err(),
            Some("type tags without their comma")
        );
    }

    #[test]
    fn a_nested_bundle_with_such_a_name_is_read_in_full() {
        let bytes = bundle(&[bundle(&channel_report()), float("/level/out/0", -6.0)]);
        let (rest, OscPacket::Bundle(library)) =
            decoder::decode_udp(&bytes).expect("the library reads it")
        else {
            panic!("a bundle");
        };
        assert!(rest.is_empty(), "the library reports nothing left");
        assert_eq!(
            library.content[0],
            bundled(vec![number("/input/8/gain", 0.5)]),
            "yet it dropped the inner bundle's rest without a word"
        );

        let read = read_datagram(&bytes);
        assert_eq!(
            read.packet,
            Some(bundled(vec![
                bundled(channel_report_read()),
                number("/level/out/0", -6.0),
            ]))
        );
        assert!(read.unread.is_none());
    }

    /// After such a name the library reads nothing more of the bundle, so a
    /// bundle after it is read here, and a skip inside that bundle is noted
    /// from the skipped element's size to the inner bundle's end.
    #[test]
    fn a_skip_in_a_bundle_after_such_a_name_is_noted() {
        let unreadable = message(b"/input/8/mute", b",x", &[&1.0_f32.to_be_bytes()]);
        let gain = float("/input/8/gain", 0.5);
        let inner = bundle(&[
            gain.clone(),
            unreadable.clone(),
            float("/input/8/solo", 0.0),
        ]);
        let first = name("/input/8/name", b"R\xF6st");
        let bytes = bundle(&[first.clone(), inner.clone(), float("/level/out/0", -6.0)]);

        let read = read_datagram(&bytes);
        assert_eq!(
            read.packet,
            Some(bundled(vec![
                words("/input/8/name", "Röst"),
                bundled(vec![
                    number("/input/8/gain", 0.5),
                    number("/input/8/solo", 0.0),
                ]),
                number("/level/out/0", -6.0),
            ]))
        );
        let (what, from) = read.unread.expect("the skipped element is noted");
        assert_eq!(
            what,
            format!(
                "a bundle with {} of its {} bytes left unread",
                4 + unreadable.len(),
                bytes.len()
            )
        );
        let inner_at = BUNDLE_HEADER_BYTES + 4 + first.len() + 4;
        let size_at = inner_at + BUNDLE_HEADER_BYTES + 4 + gain.len();
        assert_eq!(
            from,
            &bytes[size_at..inner_at + inner.len()],
            "from the element's size to the end of its bundle"
        );
    }

    /// The deepest nesting a datagram can carry: each bundle inside a
    /// bundle takes 20 bytes, so 101 of them fit the receive buffer's 2,048
    /// bytes with a name in Windows-1252 at the bottom. Every level is read
    /// again down to it, without a panic.
    #[test]
    fn the_deepest_bundle_that_fits_is_read_to_its_bottom() {
        let mut bytes = bundle(&[name("/input/8/name", b"B\xD6\xD6M")]);
        let mut expected = bundled(vec![words("/input/8/name", "BÖÖM")]);
        let mut depth = 1;
        while bytes.len() + 4 + BUNDLE_HEADER_BYTES <= RECEIVE_BUFFER_BYTES {
            bytes = bundle(&[bytes]);
            expected = bundled(vec![expected]);
            depth += 1;
        }
        assert_eq!((bytes.len(), depth), (2_048, 101));

        let read = read_datagram(&bytes);
        assert_eq!(
            read.packet,
            Some(expected),
            "the name at the bottom is read"
        );
        assert!(read.unread.is_none());
    }

    /// A string's bytes in Windows-1252, for the letters the property below
    /// uses: ASCII, the upper half of Latin-1 (which Windows-1252 shares) and
    /// `€`.
    fn windows_1252_bytes(text: &str) -> Vec<u8> {
        text.chars()
            .map(|letter| match letter {
                '€' => 0x80,
                _ => u8::try_from(u32::from(letter))
                    .ok()
                    .filter(|byte| !(0x80..0xA0).contains(byte))
                    .expect("a letter Windows-1252 writes as itself"),
            })
            .collect()
    }

    /// A packet's bytes as TotalMix writes them: OSC 1.0, each string
    /// argument in Windows-1252. Written here byte by byte, not by the
    /// library, which writes only UTF-8.
    fn as_totalmix_writes(packet: &OscPacket) -> Vec<u8> {
        match packet {
            OscPacket::Message(sent) => {
                assert!(sent.addr.is_ascii(), "an address in ASCII");
                let mut tags = vec![b','];
                let mut args = Vec::new();
                for arg in &sent.args {
                    let (tag, bytes) = match arg {
                        OscType::Float(value) => (b'f', value.to_be_bytes().to_vec()),
                        OscType::Int(value) => (b'i', value.to_be_bytes().to_vec()),
                        OscType::Double(value) => (b'd', value.to_be_bytes().to_vec()),
                        OscType::Long(value) => (b'h', value.to_be_bytes().to_vec()),
                        OscType::String(text) => (b's', osc_str(&windows_1252_bytes(text))),
                        OscType::Bool(true) => (b'T', Vec::new()),
                        OscType::Bool(false) => (b'F', Vec::new()),
                        OscType::Nil => (b'N', Vec::new()),
                        OscType::Inf => (b'I', Vec::new()),
                        other => panic!("TotalMix does not send {other:?}"),
                    };
                    tags.push(tag);
                    args.extend(bytes);
                }
                message(sent.addr.as_bytes(), &tags, &[&args])
            }
            OscPacket::Bundle(sent) => {
                let elements: Vec<Vec<u8>> = sent.content.iter().map(as_totalmix_writes).collect();
                bundle_at(sent.timetag, &elements)
            }
        }
    }

    /// What a packet TotalMix wrote reads as: itself, except that a string
    /// whose Windows-1252 bytes are UTF-8 as well reads as UTF-8, as each
    /// string is read as UTF-8 first (`Ö€` is `D6 80`, which is `ր`).
    fn read_as(sent: &OscPacket) -> OscPacket {
        match sent {
            OscPacket::Message(sent) => OscPacket::Message(OscMessage {
                addr: sent.addr.clone(),
                args: sent
                    .args
                    .iter()
                    .map(|arg| match arg {
                        OscType::String(text) => OscType::String(
                            String::from_utf8(windows_1252_bytes(text))
                                .unwrap_or_else(|_| text.clone()),
                        ),
                        other => other.clone(),
                    })
                    .collect(),
            }),
            OscPacket::Bundle(sent) => OscPacket::Bundle(OscBundle {
                timetag: sent.timetag,
                content: sent.content.iter().map(read_as).collect(),
            }),
        }
    }

    /// Whether every string argument in a packet, in its bundles too, is
    /// ASCII.
    fn all_ascii(packet: &OscPacket) -> bool {
        match packet {
            OscPacket::Message(message) => message.args.iter().all(|arg| match arg {
                OscType::String(text) => text.is_ascii(),
                _ => true,
            }),
            OscPacket::Bundle(bundle) => bundle.content.iter().all(all_ascii),
        }
    }

    /// A string argument: ASCII letters, or ASCII letters with letters
    /// Windows-1252 writes above 0x7F. Up to 8 letters, one byte each, so a
    /// string of 4 or 8 bytes and its 4 NULs come often.
    fn text_argument() -> impl Strategy<Value = String> {
        prop_oneof![
            "[A-Za-z]{0,8}",
            proptest::collection::vec(prop_oneof![2 => "[A-Za-z]", 1 => "[åäöÖé€]"], 0..9)
                .prop_map(|letters| letters.concat()),
        ]
    }

    /// An argument of each type TotalMix sends, the ones read here
    /// (`f i d h s T F N I`).
    fn totalmix_argument() -> impl Strategy<Value = OscType> {
        prop_oneof![
            2 => any::<f32>().prop_map(OscType::Float),
            1 => Just(OscType::Float(f32::NAN)),
            1 => any::<i32>().prop_map(OscType::Int),
            1 => any::<f64>().prop_map(OscType::Double),
            1 => any::<i64>().prop_map(OscType::Long),
            4 => text_argument().prop_map(OscType::String),
            1 => any::<bool>().prop_map(OscType::Bool),
            1 => Just(OscType::Nil),
            1 => Just(OscType::Inf),
        ]
    }

    /// Messages with a few arguments, and bundles of them nested up to 3
    /// deep, at any time tag.
    fn totalmix_packet() -> impl Strategy<Value = OscPacket> {
        let leaf = (
            "/[a-z0-9/]{0,16}",
            proptest::collection::vec(totalmix_argument(), 0..5),
        )
            .prop_map(|(addr, args)| OscPacket::Message(OscMessage { addr, args }));
        leaf.prop_recursive(3, 24, 4, |inner| {
            (any::<(u32, u32)>(), proptest::collection::vec(inner, 0..5)).prop_map(
                |(timetag, content)| {
                    OscPacket::Bundle(OscBundle {
                        timetag: timetag.into(),
                        content,
                    })
                },
            )
        })
    }

    proptest! {
        /// A packet as TotalMix writes it, its strings in Windows-1252, is
        /// read exactly: every element once and in its place, each type
        /// tag's value, bundles inside bundles in full, and nothing is noted
        /// as unread. Where every string is ASCII the bytes are the
        /// library's own, and the library alone reads them the same.
        /// Packets are compared by their bytes, as NaN is not equal to
        /// itself.
        #[test]
        fn a_packet_as_totalmix_writes_it_is_read_exactly(sent in totalmix_packet()) {
            let bytes = as_totalmix_writes(&sent);
            let expected = encoder::encode(&read_as(&sent)).expect("the expected packet encodes");

            let read = read_datagram(&bytes);
            let Some(packet) = read.packet.as_ref() else {
                return Err(TestCaseError::fail("the datagram is read"));
            };
            prop_assert_eq!(encoder::encode(packet).ok(), Some(expected.clone()));
            prop_assert!(
                read.unread.is_none(),
                "nothing left unread: {:?}",
                read.unread.as_ref().map(|(what, _)| what)
            );

            if all_ascii(&sent) {
                prop_assert_eq!(&bytes, &expected, "the library writes the same bytes");
                let (rest, library) = match decoder::decode_udp(&bytes) {
                    Ok(read) => read,
                    Err(error) => {
                        return Err(TestCaseError::fail(format!("the library reads it: {error:?}")));
                    }
                };
                prop_assert!(rest.is_empty());
                prop_assert_eq!(encoder::encode(&library).ok(), Some(expected));
            }
        }
    }
}
