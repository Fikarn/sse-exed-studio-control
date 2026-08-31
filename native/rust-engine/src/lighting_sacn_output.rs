//! Native lighting output: streams the engine-owned DMX state to the
//! commissioned Apollo Bridge as sACN (ANSI E1.31) over UDP unicast.
//!
//! Behavior is intentional and documented (see docs/OPERATIONS.md): once
//! lighting is enabled with a valid commissioned bridge address and at least
//! one patched fixture, the engine continuously transmits the current
//! lighting state — including grand master, identify/highlight/solo overlays,
//! and in-flight fades — at the output tick rate, with unchanged frames
//! re-sent as E1.31 keep-alives. When output becomes ineligible (lighting
//! disabled, bridge unconfigured, or the rig unpatched) the stream ends with
//! E1.31 stream-terminated packets and the fixtures hold their last levels;
//! the engine never fabricates a blackout the operator did not ask for.
//!
//! The slot values come from the same renderer as the operator-facing DMX
//! monitor, so the wire always matches what the UI shows.

use crate::app_state::APP_SETTINGS_PREFIX;
use crate::diagnostics::append_log;
use crate::lighting::{read_lighting_sacn_output_state, LightingUniverseFrame};
use crate::storage::list_settings_by_prefix;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

pub const SACN_PORT: u16 = 5568;
const OUTPUT_TICK: Duration = Duration::from_millis(40);
const KEEPALIVE_INTERVAL: Duration = Duration::from_millis(800);
const STREAM_TERMINATED_SENDS: usize = 3;
const E131_PRIORITY: u8 = 100;
const E131_PACKET_LEN: usize = 638;
const E131_OPTIONS_STREAM_TERMINATED: u8 = 0x40;
const SOURCE_NAME: &str = "SSE ExEd Studio Control";
// Stable RFC 4122-shaped source CID; E1.31 receivers key source identity on
// this, and the app is a single fixed-workstation source, so a constant is
// correct — regenerating per launch would look like a competing source.
const SOURCE_CID: [u8; 16] = [
    0xa3, 0x7d, 0x5e, 0x21, 0x9b, 0x04, 0x4a, 0x6f, 0x8c, 0x2e, 0xd1, 0x57, 0x33, 0x90, 0x41, 0xbe,
];

pub fn spawn_lighting_sacn_output(db_path: PathBuf, log_file_path: PathBuf) {
    thread::spawn(move || run_output_loop(&db_path, &log_file_path));
}

struct UniverseTx {
    sequence: u8,
    last_slots: [u8; 512],
    last_sent_at: Instant,
}

fn run_output_loop(db_path: &Path, log_file_path: &Path) {
    let socket = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
        Ok(socket) => socket,
        Err(error) => {
            let _ = append_log(
                log_file_path,
                "ERROR",
                &format!("Lighting sACN output could not allocate a UDP socket: {error}"),
            );
            return;
        }
    };

    let mut active_bridge: Option<Ipv4Addr> = None;
    let mut universes: HashMap<u16, UniverseTx> = HashMap::new();

    loop {
        thread::sleep(OUTPUT_TICK);

        let Ok(settings) = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX) else {
            // Transient storage contention; keep the last wire state and retry.
            continue;
        };

        match read_lighting_sacn_output_state(&settings) {
            Some(state) => {
                if active_bridge != Some(state.bridge_ip) {
                    if let Some(previous_bridge) = active_bridge {
                        let all: Vec<u16> = universes.keys().copied().collect();
                        terminate_universes(&socket, previous_bridge, &mut universes, all);
                    }
                    active_bridge = Some(state.bridge_ip);
                    let _ = append_log(
                        log_file_path,
                        "INFO",
                        &format!(
                            "Lighting sACN output active: streaming {} universe(s) to {}:{}.",
                            state.frames.len(),
                            state.bridge_ip,
                            SACN_PORT
                        ),
                    );
                }

                let current: Vec<u16> = state.frames.iter().map(|frame| frame.universe).collect();
                let stale: Vec<u16> = universes
                    .keys()
                    .copied()
                    .filter(|universe| !current.contains(universe))
                    .collect();
                if !stale.is_empty() {
                    terminate_universes(&socket, state.bridge_ip, &mut universes, stale);
                }

                for frame in &state.frames {
                    send_frame(&socket, state.bridge_ip, &mut universes, frame);
                }
            }
            None => {
                if let Some(previous_bridge) = active_bridge.take() {
                    let all: Vec<u16> = universes.keys().copied().collect();
                    terminate_universes(&socket, previous_bridge, &mut universes, all);
                    let _ = append_log(
                        log_file_path,
                        "INFO",
                        "Lighting sACN output idle: stream terminated; fixtures hold last levels.",
                    );
                }
            }
        }
    }
}

fn send_frame(
    socket: &UdpSocket,
    bridge_ip: Ipv4Addr,
    universes: &mut HashMap<u16, UniverseTx>,
    frame: &LightingUniverseFrame,
) {
    let target = SocketAddrV4::new(bridge_ip, SACN_PORT);
    let entry = universes
        .entry(frame.universe)
        .or_insert_with(|| UniverseTx {
            sequence: 0,
            last_slots: [0_u8; 512],
            last_sent_at: Instant::now() - KEEPALIVE_INTERVAL,
        });

    let changed = entry.last_slots != frame.slots;
    if !changed && entry.last_sent_at.elapsed() < KEEPALIVE_INTERVAL {
        return;
    }

    let packet = build_e131_data_packet(frame.universe, entry.sequence, false, &frame.slots);
    if socket.send_to(&packet, target).is_ok() {
        entry.sequence = entry.sequence.wrapping_add(1);
        entry.last_slots = frame.slots;
        entry.last_sent_at = Instant::now();
    }
}

fn terminate_universes(
    socket: &UdpSocket,
    bridge_ip: Ipv4Addr,
    universes: &mut HashMap<u16, UniverseTx>,
    targets: Vec<u16>,
) {
    let target_addr = SocketAddrV4::new(bridge_ip, SACN_PORT);
    for universe in targets {
        let Some(mut entry) = universes.remove(&universe) else {
            continue;
        };
        for _ in 0..STREAM_TERMINATED_SENDS {
            let packet = build_e131_data_packet(universe, entry.sequence, true, &entry.last_slots);
            let _ = socket.send_to(&packet, target_addr);
            entry.sequence = entry.sequence.wrapping_add(1);
        }
    }
}

/// Builds one ANSI E1.31 data packet: root layer, framing layer, and a DMP
/// layer carrying the null start code plus all 512 slots (638 bytes total).
fn build_e131_data_packet(
    universe: u16,
    sequence: u8,
    stream_terminated: bool,
    slots: &[u8; 512],
) -> [u8; E131_PACKET_LEN] {
    let mut packet = [0_u8; E131_PACKET_LEN];

    // Root layer.
    packet[0..2].copy_from_slice(&0x0010_u16.to_be_bytes()); // preamble size
    packet[2..4].copy_from_slice(&0x0000_u16.to_be_bytes()); // post-amble size
    packet[4..16].copy_from_slice(b"ASC-E1.17\0\0\0"); // ACN packet identifier
    packet[16..18].copy_from_slice(&flags_and_length(E131_PACKET_LEN - 16)); // 622
    packet[18..22].copy_from_slice(&0x0000_0004_u32.to_be_bytes()); // VECTOR_ROOT_E131_DATA
    packet[22..38].copy_from_slice(&SOURCE_CID);

    // Framing layer.
    packet[38..40].copy_from_slice(&flags_and_length(E131_PACKET_LEN - 38)); // 600
    packet[40..44].copy_from_slice(&0x0000_0002_u32.to_be_bytes()); // VECTOR_E131_DATA_PACKET
    let name_bytes = SOURCE_NAME.as_bytes();
    packet[44..44 + name_bytes.len()].copy_from_slice(name_bytes); // 64-byte field, zero padded
    packet[108] = E131_PRIORITY;
    packet[109..111].copy_from_slice(&0x0000_u16.to_be_bytes()); // synchronization address
    packet[111] = sequence;
    packet[112] = if stream_terminated {
        E131_OPTIONS_STREAM_TERMINATED
    } else {
        0x00
    };
    packet[113..115].copy_from_slice(&universe.to_be_bytes());

    // DMP layer.
    packet[115..117].copy_from_slice(&flags_and_length(E131_PACKET_LEN - 115)); // 523
    packet[117] = 0x02; // VECTOR_DMP_SET_PROPERTY
    packet[118] = 0xA1; // address type & data type
    packet[119..121].copy_from_slice(&0x0000_u16.to_be_bytes()); // first property address
    packet[121..123].copy_from_slice(&0x0001_u16.to_be_bytes()); // address increment
    packet[123..125].copy_from_slice(&513_u16.to_be_bytes()); // start code + 512 slots
    packet[125] = 0x00; // DMX null start code
    packet[126..638].copy_from_slice(slots);

    packet
}

fn flags_and_length(pdu_length: usize) -> [u8; 2] {
    (0x7000_u16 | (pdu_length as u16 & 0x0FFF)).to_be_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commissioning::LIGHTING_BRIDGE_IP_KEY;
    use std::collections::HashMap;

    #[test]
    fn e131_data_packet_layout_matches_spec() {
        let mut slots = [0_u8; 512];
        slots[0] = 255;
        slots[511] = 42;

        let packet = build_e131_data_packet(1, 7, false, &slots);

        assert_eq!(packet.len(), 638);
        assert_eq!(&packet[0..2], &[0x00, 0x10]);
        assert_eq!(&packet[4..16], b"ASC-E1.17\0\0\0");
        assert_eq!(&packet[16..18], &[0x72, 0x6E]); // root: 0x7000 | 622
        assert_eq!(&packet[18..22], &[0x00, 0x00, 0x00, 0x04]);
        assert_eq!(&packet[22..38], &SOURCE_CID);
        assert_eq!(&packet[38..40], &[0x72, 0x58]); // framing: 0x7000 | 600
        assert_eq!(&packet[40..44], &[0x00, 0x00, 0x00, 0x02]);
        assert_eq!(&packet[44..44 + SOURCE_NAME.len()], SOURCE_NAME.as_bytes());
        assert_eq!(packet[107], 0x00); // source name stays zero padded
        assert_eq!(packet[108], E131_PRIORITY);
        assert_eq!(packet[111], 7);
        assert_eq!(packet[112], 0x00);
        assert_eq!(&packet[113..115], &[0x00, 0x01]);
        assert_eq!(&packet[115..117], &[0x72, 0x0B]); // DMP: 0x7000 | 523
        assert_eq!(packet[117], 0x02);
        assert_eq!(packet[118], 0xA1);
        assert_eq!(&packet[123..125], &[0x02, 0x01]); // 513 property values
        assert_eq!(packet[125], 0x00); // null start code
        assert_eq!(packet[126], 255);
        assert_eq!(packet[637], 42);
    }

    #[test]
    fn e131_data_packet_marks_stream_terminated() {
        let slots = [0_u8; 512];
        let packet = build_e131_data_packet(1, 0, true, &slots);
        assert_eq!(packet[112], E131_OPTIONS_STREAM_TERMINATED);
    }

    #[test]
    fn e131_data_packet_encodes_high_universe_numbers() {
        let slots = [0_u8; 512];
        let packet = build_e131_data_packet(63999, 0, false, &slots);
        assert_eq!(&packet[113..115], &63999_u16.to_be_bytes());
    }

    #[test]
    fn sacn_output_state_is_dark_without_a_commissioned_bridge() {
        assert!(read_lighting_sacn_output_state(&HashMap::new()).is_none());

        let mut invalid = HashMap::new();
        invalid.insert(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("not-an-ip"),
        );
        assert!(read_lighting_sacn_output_state(&invalid).is_none());
    }

    #[test]
    fn sacn_output_state_renders_frames_for_a_commissioned_bridge() {
        let mut settings = HashMap::new();
        settings.insert(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("127.0.0.1"),
        );

        let state = read_lighting_sacn_output_state(&settings)
            .expect("configured lighting should render sACN frames");

        assert_eq!(state.bridge_ip, Ipv4Addr::LOCALHOST);
        assert_eq!(state.frames.len(), 1);
        assert_eq!(state.frames[0].universe, 1);
        // Default inventory fixtures are off, so every dimmer slot is dark,
        // but CCT slots carry their scaled kelvin values — the frame must
        // mirror the DMX monitor, not an all-zero blackout.
        assert!(state.frames[0].slots.iter().any(|slot| *slot > 0));
    }

    #[test]
    fn e131_packets_survive_a_udp_loopback_round_trip() {
        let receiver = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).expect("receiver should bind");
        let sender = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).expect("sender should bind");
        let target = receiver.local_addr().expect("receiver address");

        let mut slots = [0_u8; 512];
        slots[9] = 128;
        let packet = build_e131_data_packet(1, 3, false, &slots);
        sender.send_to(&packet, target).expect("packet should send");

        let mut buffer = [0_u8; 1024];
        receiver
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("receiver timeout should set");
        let (received, _) = receiver
            .recv_from(&mut buffer)
            .expect("packet should arrive");
        assert_eq!(received, E131_PACKET_LEN);
        assert_eq!(&buffer[..received], &packet[..]);
    }
}
