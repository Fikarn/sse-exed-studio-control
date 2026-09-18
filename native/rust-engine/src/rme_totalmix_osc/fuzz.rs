//! Property tests for what the engine does with a datagram from the console
//! (2026-09 production readiness, Slice 13 — finding F25).
//!
//! Since Slice 6 only the console's own address is listened to, but what it
//! sends is still bytes from outside the process: they go through `rosc`'s
//! decoder and then into the meter state and the console link. These hold, for
//! arbitrary bytes, for damaged copies of real packets and for every shape of
//! level message, that nothing panics and that a level which is accepted is a
//! level — between 0 and 1, never NaN.
//!
//! Nothing here opens a socket or sends a datagram, and every case works on
//! values of its own: the process-wide console link and meter state that other
//! tests share are never touched.

use super::*;
use crate::rme_console_link::ConsoleLinkState;
use proptest::prelude::*;
use rosc::OscBundle;

const BUSES: [RmeTotalMixBus; 3] = [
    RmeTotalMixBus::Input,
    RmeTotalMixBus::Playback,
    RmeTotalMixBus::Output,
];

/// What a level in dBFS may be, stated here on its own: a number, or silence.
/// Deliberately not the engine's `is_level_dbfs` — a property that asks the code
/// under test for the right answer cannot fail (the first version did, and a
/// sabotaged `is_level_dbfs` sailed through it).
fn is_a_level(dbfs: f64) -> bool {
    !dbfs.is_nan() && dbfs != f64::INFINITY
}

/// Everything the receive loops do with a decoded packet, on local values.
fn ingest_everywhere(packet: &OscPacket, now_ms: u64) {
    for bus in BUSES {
        let mut meters = RmeTotalMixMeterState::new();
        meters.apply_packet(bus, packet, now_ms);
        let _ = meters.status_at(now_ms);
        let _ = meters.diagnostics();
    }
    let mut meters = RmeTotalMixMeterState::new();
    let mut link = ConsoleLinkState::default();
    route_locally(packet, &mut meters, &mut link, now_ms);
}

/// `route_global_packet` with the two process-wide destinations passed in.
fn route_locally(
    packet: &OscPacket,
    meters: &mut RmeTotalMixMeterState,
    link: &mut ConsoleLinkState,
    now_ms: u64,
) {
    match packet {
        OscPacket::Message(message) => {
            if message.addr.starts_with("/level/") {
                meters.apply_global_message(message, now_ms);
            } else {
                link.ingest(message, now_ms);
            }
        }
        OscPacket::Bundle(bundle) => {
            for inner in &bundle.content {
                route_locally(inner, meters, link, now_ms);
            }
        }
    }
}

fn channel_number() -> impl Strategy<Value = String> {
    prop_oneof![
        (0_u32..40).prop_map(|channel| channel.to_string()),
        any::<u64>().prop_map(|channel| channel.to_string()),
        Just(String::from("18446744073709551616")),
        Just(String::from("-1")),
        Just(String::from("+3")),
        Just(String::from("007")),
        Just(String::new()),
        "[0-9a-z+-]{0,6}",
    ]
}

/// Addresses in and around the two level namespaces, and anything else.
fn address() -> impl Strategy<Value = String> {
    prop_oneof![
        ("(0|1|2|3)", channel_number(), "(Left|Right|Mid|)", "(Val|)").prop_map(
            |(page, channel, side, display)| format!("/{page}/level{channel}{side}{display}")
        ),
        ("(in|pb|out|fx|)", channel_number(), "(/extra|/|)")
            .prop_map(|(bus, channel, tail)| format!("/level/{bus}/{channel}{tail}")),
        "/[ -~]{0,40}",
        any::<String>(),
    ]
}

fn level_text() -> impl Strategy<Value = String> {
    prop_oneof![
        (-140.0_f64..12.0).prop_map(|level| format!("{level:.1} dB")),
        (-140.0_f64..12.0).prop_map(|level| format!("{level:.1}dBFS")),
        Just(String::from("-oo")),
        Just(String::from("-inf")),
        Just(String::from("nan")),
        Just(String::from("NaN dB")),
        Just(String::from("inf")),
        Just(String::from("1e400")),
        "[ -~]{0,12}",
    ]
}

fn argument() -> impl Strategy<Value = OscType> {
    prop_oneof![
        any::<f32>().prop_map(OscType::Float),
        any::<f64>().prop_map(OscType::Double),
        Just(OscType::Float(f32::NAN)),
        Just(OscType::Float(f32::INFINITY)),
        Just(OscType::Float(f32::NEG_INFINITY)),
        Just(OscType::Double(f64::NAN)),
        (0.0_f32..=1.0).prop_map(OscType::Float),
        any::<i32>().prop_map(OscType::Int),
        any::<i64>().prop_map(OscType::Long),
        level_text().prop_map(OscType::String),
        any::<bool>().prop_map(OscType::Bool),
        Just(OscType::Nil),
        Just(OscType::Inf),
        proptest::collection::vec(any::<u8>(), 0..12).prop_map(OscType::Blob),
    ]
}

fn message() -> impl Strategy<Value = OscMessage> {
    (address(), proptest::collection::vec(argument(), 0..4))
        .prop_map(|(addr, args)| OscMessage { addr, args })
}

/// A message at an address the classic parser takes, with any arguments: every
/// case reaches the code that turns an argument into a level.
fn classic_level_message() -> impl Strategy<Value = OscMessage> {
    (
        "(1|2)",
        1_u32..40,
        "(Left|Right)",
        "(Val|)",
        proptest::collection::vec(argument(), 1..3),
    )
        .prop_map(|(page, channel, side, display, args)| OscMessage {
            addr: format!("/{page}/level{channel}{side}{display}"),
            args,
        })
}

/// The same for the Global OSC namespace.
fn global_level_message() -> impl Strategy<Value = OscMessage> {
    (
        "(in|pb|out)",
        0_u32..40,
        proptest::collection::vec(argument(), 1..3),
    )
        .prop_map(|(bus, channel, args)| OscMessage {
            addr: format!("/level/{bus}/{channel}"),
            args,
        })
}

fn packet() -> impl Strategy<Value = OscPacket> {
    let leaf = message().prop_map(OscPacket::Message);
    leaf.prop_recursive(3, 12, 4, |inner| {
        proptest::collection::vec(inner, 0..4).prop_map(|content| {
            OscPacket::Bundle(OscBundle {
                timetag: (0, 1).into(),
                content,
            })
        })
    })
}

/// One change to the bytes of a real packet: the damage a truncated, corrupted
/// or hostile datagram would carry past the point where random bytes give up.
#[derive(Clone, Debug)]
enum Damage {
    Truncate(usize),
    Flip(usize, u8),
    Insert(usize, u8),
    Remove(usize),
}

fn damage() -> impl Strategy<Value = Damage> {
    prop_oneof![
        any::<usize>().prop_map(Damage::Truncate),
        (any::<usize>(), 1_u8..=255).prop_map(|(at, mask)| Damage::Flip(at, mask)),
        (any::<usize>(), any::<u8>()).prop_map(|(at, byte)| Damage::Insert(at, byte)),
        any::<usize>().prop_map(Damage::Remove),
    ]
}

fn damaged(mut bytes: Vec<u8>, changes: &[Damage]) -> Vec<u8> {
    for change in changes {
        if bytes.is_empty() {
            break;
        }
        match *change {
            Damage::Truncate(at) => bytes.truncate(at % (bytes.len() + 1)),
            Damage::Flip(at, mask) => {
                let at = at % bytes.len();
                bytes[at] ^= mask;
            }
            Damage::Insert(at, byte) => bytes.insert(at % (bytes.len() + 1), byte),
            Damage::Remove(at) => {
                bytes.remove(at % bytes.len());
            }
        }
    }
    bytes
}

proptest! {
    /// Arbitrary datagrams, and real packets with a few bytes damaged: decoding
    /// and everything done with the result never panics.
    #[test]
    fn osc_decode_never_panics(
        bytes in prop_oneof![
            proptest::collection::vec(any::<u8>(), 0..1024),
            (packet(), proptest::collection::vec(damage(), 0..4)).prop_map(|(packet, changes)| {
                damaged(encoder::encode(&packet).unwrap_or_default(), &changes)
            }),
        ],
        now_ms in any::<u64>(),
    ) {
        if let Ok((_remainder, packet)) = decoder::decode_udp(&bytes) {
            ingest_everywhere(&packet, now_ms);
        }
    }

    /// Every shape of message, nested in bundles or not, is taken or left
    /// without a panic — channel numbers past every table, arguments of every
    /// type, clocks at both ends.
    #[test]
    fn osc_packets_never_panic(packet in packet(), now_ms in any::<u64>()) {
        ingest_everywhere(&packet, now_ms);
    }

    /// A classic level message that is accepted carries a level: 0 to 1, and a
    /// dBFS value that is a number or −∞ for silence — never NaN or +∞, which
    /// the snapshot would hand to the meters as `null`. This is the property
    /// that found `/1/level1LeftVal [NaN]` being taken as a level; the seed is
    /// kept in `proptest-regressions/`.
    #[test]
    fn accepted_classic_levels_are_levels(
        message in prop_oneof![classic_level_message(), message()],
    ) {
        if let Some(parsed) = parse_totalmix_meter_message(&message) {
            prop_assert!(
                (0.0..=1.0).contains(&parsed.normalized),
                "normalized {} from {:?}", parsed.normalized, message
            );
            prop_assert!(is_a_level(parsed.dbfs), "dBFS {} from {:?}", parsed.dbfs, message);
            // And it stays one in the meter state, for every bus.
            for bus in BUSES {
                let mut meters = RmeTotalMixMeterState::new();
                meters.apply_message(bus, &message, 1_000);
                for entry in meters.entries.values() {
                    prop_assert!((0.0..=1.0).contains(&entry.current.left));
                    prop_assert!((0.0..=1.0).contains(&entry.current.right));
                }
            }
        }
    }

    /// The same for the Global OSC namespace (it found `/level/in/0 [NaN]`).
    #[test]
    fn accepted_global_levels_are_levels(
        message in prop_oneof![global_level_message(), message()],
    ) {
        if let Some((_bus, _channel, dbfs)) = parse_global_level(&message) {
            prop_assert!(is_a_level(dbfs), "dBFS {} from {:?}", dbfs, message);
            let mut meters = RmeTotalMixMeterState::new();
            meters.apply_global_message(&message, 1_000);
            for entry in meters.entries.values() {
                prop_assert!((0.0..=1.0).contains(&entry.current.left));
                prop_assert!((0.0..=1.0).contains(&entry.current.right));
            }
        }
    }
}
