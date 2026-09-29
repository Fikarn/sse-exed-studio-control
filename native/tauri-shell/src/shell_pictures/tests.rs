//! The frame route: the listener, its secret, the newest frame of each
//! camera, and what it refuses. Every connection here is to 127.0.0.1, to a
//! listener the test opened. Nothing asserts a tighter time than a few
//! seconds: the gate runs below normal priority.

use super::*;
use std::io::Write;
use studio_control_protocol::pictures::{FrameFormat, FRAME_MAX_JPEG_BYTES};

const PATIENCE: Duration = Duration::from_secs(20);

fn recorded_log() -> (PicturesLog, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let log: PicturesLog = {
        let lines = Arc::clone(&lines);
        Arc::new(move |line: &str| lock(&lines).push(line.to_string()))
    };
    (log, lines)
}

fn frame(camera: u8, sequence: u64, width: u16, height: u16) -> Vec<u8> {
    let header = FrameHeader::raw(camera, FrameFormat::Uyvy, width, height, sequence);
    let mut bytes = header.encode().to_vec();
    bytes.resize(FRAME_HEADER_LEN + header.length as usize, sequence as u8);
    bytes
}

/// Waits until `ready` holds, or fails the test after `PATIENCE`.
fn wait_until(what: &str, ready: impl Fn() -> bool) {
    let started = Instant::now();
    while !ready() {
        assert!(started.elapsed() < PATIENCE, "{what}");
        thread::sleep(Duration::from_millis(10));
    }
}

/// A take that does not wait: what is there now.
fn taken_now(store: &PicturesStore) -> Vec<u8> {
    store.take(Duration::ZERO, Duration::ZERO)
}

/// The cameras and sequences of an answer, in its order, each frame whole:
/// the answer walks from header to header to its very end.
fn cameras_in(answer: &[u8]) -> Vec<(u8, u64)> {
    let mut found = Vec::new();
    let mut at = 0;
    while at < answer.len() {
        let header: [u8; FRAME_HEADER_LEN] = answer[at..at + FRAME_HEADER_LEN]
            .try_into()
            .expect("a whole header");
        let header = FrameHeader::decode(&header).expect("a frame");
        found.push((header.camera, header.sequence));
        at += FRAME_HEADER_LEN + header.length as usize;
        assert!(at <= answer.len(), "a whole picture");
    }
    found
}

fn open() -> (Arc<PicturesStore>, PicturesLink, Arc<Mutex<Vec<String>>>) {
    let store = Arc::new(PicturesStore::default());
    let (log, lines) = recorded_log();
    let link = PicturesLink::open(Arc::clone(&store), log).expect("the listener opens");
    (store, link, lines)
}

#[test]
fn it_listens_on_this_pc_alone_with_a_new_secret_each_start() {
    let (_, first, _) = open();
    let (_, second, _) = open();
    for link in [&first, &second] {
        assert_eq!(
            link.address().ip(),
            std::net::IpAddr::from(Ipv4Addr::LOCALHOST)
        );
        assert_ne!(link.address().port(), 0);
        assert!(studio_control_protocol::pictures::is_link_secret(
            link.secret()
        ));
    }
    assert_ne!(first.secret(), second.secret());
}

#[test]
fn frames_arrive_the_newest_wins_and_each_is_taken_once() {
    let (store, link, lines) = open();
    let mut helper = connect_saying(link.address(), link.secret()).expect("connects");
    helper.write_all(&frame(2, 1, 544, 306)).expect("writes");
    wait_until("the first frame", || lock(&store.newest)[1].is_some());
    helper.write_all(&frame(2, 2, 544, 306)).expect("writes");
    helper.write_all(&frame(1, 1, 1920, 1080)).expect("writes");
    wait_until("CAM 1's frame", || lock(&store.newest)[0].is_some());

    // One answer holds each camera's newest, in camera order though CAM 2's
    // came first; nothing came for CAM 3.
    let answer = taken_now(&store);
    assert_eq!(cameras_in(&answer), [(1, 1), (2, 2)]);
    assert_eq!(
        answer.len(),
        2 * FRAME_HEADER_LEN + 1920 * 1080 * 2 + 544 * 306 * 2
    );
    assert!(taken_now(&store).is_empty(), "each is taken once");

    let counts = store.take_counts();
    assert_eq!(counts.received, 3);
    assert_eq!(counts.taken, 2);
    assert_eq!(
        counts.skipped, 1,
        "frame 1 of CAM 2 was replaced before it was taken"
    );
    assert!(lock(&lines)
        .iter()
        .any(|line| line == "The pictures helper is connected."));
}

// 2026-09-29: one take brings the three cameras and waits in the shell for
// the next frame; a take for each camera made about 140 requests a second,
// and the pages' requests to the hardware link waited behind them.
#[test]
fn a_take_waits_for_the_next_frame_and_no_longer_than_its_bound() {
    let (store, link, _) = open();
    // Nothing sent: the take waits its bound, then answers empty.
    let started = Instant::now();
    assert!(store
        .take(Duration::from_millis(300), Duration::ZERO)
        .is_empty());
    assert!(started.elapsed() >= Duration::from_millis(300));

    // A frame that comes while a take waits reaches it at once, and the
    // listener keeps frames while the take waits.
    let waiter = {
        let store = Arc::clone(&store);
        thread::spawn(move || {
            let started = Instant::now();
            (store.take(PATIENCE, Duration::ZERO), started.elapsed())
        })
    };
    thread::sleep(Duration::from_millis(200));
    let mut helper = connect_saying(link.address(), link.secret()).expect("connects");
    helper.write_all(&frame(3, 1, 544, 306)).expect("writes");
    let (answer, waited) = waiter.join().expect("the waiting take ends");
    assert_eq!(cameras_in(&answer), [(3, 1)]);
    assert!(waited < PATIENCE, "it answered when the frame came");
}

#[test]
fn a_take_gathers_the_frames_of_a_tick_into_one_answer() {
    let store = Arc::new(PicturesStore::default());
    let put = |camera: u8, sequence: u64| {
        store.put(camera, frame(camera, sequence, 544, 306), &|| true);
    };
    // Three cameras 200 ms apart: the take waits for the first, gathers the
    // others, and answers as soon as all three are there.
    let waiter = {
        let store = Arc::clone(&store);
        thread::spawn(move || {
            let started = Instant::now();
            (store.take(PATIENCE, PATIENCE), started.elapsed())
        })
    };
    for camera in [2, 3, 1] {
        thread::sleep(Duration::from_millis(200));
        put(camera, 1);
    }
    let (answer, waited) = waiter.join().expect("the take ends");
    assert_eq!(cameras_in(&answer), [(1, 1), (2, 1), (3, 1)]);
    assert!(waited < PATIENCE, "it answered once the third came");

    // Two cameras alone: the gather ends at its bound.
    put(1, 2);
    put(3, 2);
    let started = Instant::now();
    let answer = store.take(PATIENCE, Duration::from_millis(300));
    assert!(started.elapsed() >= Duration::from_millis(300));
    assert_eq!(cameras_in(&answer), [(1, 2), (3, 2)]);
    assert!(taken_now(&store).is_empty());

    let counts = store.take_counts();
    assert_eq!((counts.received, counts.taken, counts.skipped), (5, 5, 0));
}

#[test]
fn a_connection_without_the_secret_is_closed_and_counted() {
    let (store, link, _) = open();
    let wrong = "0".repeat(LINK_SECRET_HEX);
    let short = &link.secret()[..LINK_SECRET_HEX - 1];
    let longer = format!("{}0", link.secret());
    // A failure names the attempt, never what it said: that is the secret, or
    // nearly.
    for (attempt, said) in [
        ("a wrong secret", wrong.as_str()),
        ("one character short", short),
        ("one character more", longer.as_str()),
        ("an empty line", ""),
    ] {
        let mut stranger = connect_saying(link.address(), said).expect("connects");
        let _ = stranger.write_all(&frame(1, 1, 544, 306));
        stranger
            .set_read_timeout(Some(PATIENCE))
            .expect("a timeout");
        let mut byte = [0_u8; 1];
        // Closed by the listener: the read ends with nothing (or an error).
        assert!(
            matches!(stranger.read(&mut byte), Ok(0) | Err(_)),
            "{attempt}"
        );
    }
    // One that says nothing at all is closed after a second.
    let mut silent = TcpStream::connect(link.address()).expect("connects");
    silent.set_read_timeout(Some(PATIENCE)).expect("a timeout");
    let mut byte = [0_u8; 1];
    assert!(matches!(silent.read(&mut byte), Ok(0) | Err(_)));

    assert!(taken_now(&store).is_empty(), "nothing it sent was kept");
    assert_eq!(store.take_counts().refused, 5);
}

// A flood of connections that say nothing: past `MAX_HANDSHAKES` they are
// closed at once, and once the waiting ones are gone the helper gets in. The
// handshake here waits half a minute, longer than this test waits for the
// refusals: they can only come from the cap.
#[test]
fn a_flood_of_silent_connections_is_turned_away_and_the_helper_still_gets_in() {
    let store = Arc::new(PicturesStore::default());
    let (log, _) = recorded_log();
    let link = PicturesLink::open_with(Arc::clone(&store), log, Duration::from_secs(30))
        .expect("the listener opens");
    let flood: Vec<TcpStream> = (0..MAX_HANDSHAKES + 12)
        .filter_map(|_| TcpStream::connect(link.address()).ok())
        .collect();
    assert_eq!(flood.len(), MAX_HANDSHAKES + 12);
    let started = Instant::now();
    while lock(&store.counts).refused < 12 {
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "the ones past the cap are refused at once"
        );
        thread::sleep(Duration::from_millis(10));
    }
    // The ones that wait end when the flood lets go of them.
    drop(flood);
    // The helper tries again after a second, as its sender does.
    wait_until("the helper gets in", || {
        let Ok(mut helper) = connect_saying(link.address(), link.secret()) else {
            return false;
        };
        if helper.write_all(&frame(1, 1, 544, 306)).is_err() {
            thread::sleep(Duration::from_millis(200));
            return false;
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if lock(&store.newest)[0].is_some() {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        false
    });
}

#[test]
fn a_frame_that_is_not_one_closes_the_connection() {
    let (store, link, lines) = open();
    let mut helper = connect_saying(link.address(), link.secret()).expect("connects");
    // Only the header: the listener closes on it, and a picture written after
    // it could meet a closed connection.
    let mut bad = frame(1, 1, 544, 306)[..FRAME_HEADER_LEN].to_vec();
    bad[5] = 7; // CAM 7
    helper.write_all(&bad).expect("writes");
    helper.set_read_timeout(Some(PATIENCE)).expect("a timeout");
    let mut byte = [0_u8; 1];
    assert!(matches!(helper.read(&mut byte), Ok(0) | Err(_)));
    assert!(taken_now(&store).is_empty());
    wait_until("the reason is logged", || {
        lock(&lines)
            .iter()
            .any(|line| line.contains("not a frame: camera 7"))
    });
}

#[test]
fn a_new_connection_with_the_secret_takes_the_old_one_s_place() {
    let (store, link, _) = open();
    let mut first = connect_saying(link.address(), link.secret()).expect("connects");
    first.write_all(&frame(3, 1, 544, 306)).expect("writes");
    wait_until("the first helper's frame", || {
        lock(&store.newest)[2].is_some()
    });
    assert_eq!(cameras_in(&taken_now(&store)), [(3, 1)]);

    let mut second = connect_saying(link.address(), link.secret()).expect("connects");
    second.write_all(&frame(3, 1, 544, 306)).expect("writes");
    wait_until("the second helper's frame", || {
        lock(&store.newest)[2].is_some()
    });
    assert_eq!(cameras_in(&taken_now(&store)), [(3, 1)]);

    // The first one's next frame is not kept: its place is taken.
    let _ = first.write_all(&frame(3, 2, 544, 306));
    let _ = first.write_all(&frame(3, 3, 544, 306));
    thread::sleep(Duration::from_millis(300));
    assert!(taken_now(&store).is_empty());
}

#[test]
fn a_new_start_refuses_the_old_secret_and_the_old_listener_closes() {
    let (store, old, _) = open();
    let old_address = old.address();
    let old_secret = old.secret().to_string();
    drop(old);
    let (_, new, _) = open();
    // The old listener is gone.
    wait_until("the old listener closes", || {
        TcpStream::connect_timeout(&old_address, Duration::from_millis(200)).is_err()
    });
    // The new one does not take the old secret.
    let mut late = connect_saying(new.address(), &old_secret).expect("connects");
    late.set_read_timeout(Some(PATIENCE)).expect("a timeout");
    let mut byte = [0_u8; 1];
    assert!(matches!(late.read(&mut byte), Ok(0) | Err(_)));
    assert!(taken_now(&store).is_empty());
}

#[test]
fn the_secret_is_in_no_log_line() {
    let (_, link, lines) = open();
    let mut helper = connect_saying(link.address(), link.secret()).expect("connects");
    helper
        .write_all(b"not a frame at all, not at all\n")
        .expect("writes");
    let mut stranger = connect_saying(link.address(), "0").expect("connects");
    let _ = stranger.write_all(b"x");
    wait_until("the bad frame is logged", || {
        lock(&lines).iter().any(|line| line.contains("not a frame"))
    });
    for line in lock(&lines).iter() {
        assert!(!line.contains(link.secret()), "{line}");
    }
}

/// Bytes from a small generator of our own: what a stranger or a broken
/// helper might send after the secret. The reader must never panic, never
/// keep a frame that is not one, and never take more than a frame's bound.
#[test]
fn the_frame_reader_takes_any_bytes_without_a_panic() {
    let mut seed = 0x5eed_u64;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let good = frame(2, 5, 544, 306);
    for round in 0..400 {
        let mut bytes = match round % 4 {
            // Random bytes.
            0 => (0..(next() % 200))
                .map(|_| next() as u8)
                .collect::<Vec<u8>>(),
            // A good frame cut short anywhere.
            1 => good[..(next() as usize % good.len())].to_vec(),
            // A good header with a random byte of it changed.
            2 => {
                let mut changed = good.clone();
                let at = next() as usize % FRAME_HEADER_LEN;
                changed[at] = next() as u8;
                changed
            }
            // A header that claims a huge JPEG.
            _ => {
                let mut header = FrameHeader::raw(1, FrameFormat::Jpeg, 16, 16, 1);
                header.length = FRAME_MAX_JPEG_BYTES + 1 + (next() % 1000) as u32;
                header.encode().to_vec()
            }
        };
        bytes.truncate(64 * 1024);
        let store = PicturesStore::default();
        let result = read_frames(&mut io::Cursor::new(bytes), &store, &|| true);
        assert!(
            result.is_err(),
            "round {round}: every input here ends in an error"
        );
        // Every kept frame is whole: the answer walks from header to header.
        cameras_in(&taken_now(&store));
    }
}

// The page's connection policy stays as it is (D28's route b): the frames
// come through the IPC protocol it already allows, and nothing else may be
// reached from the page. `scripts/tauri-smoke.mjs` checks the policy's shape;
// this holds its two sources exactly.
#[test]
fn the_page_s_connection_policy_is_unchanged() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).expect("the config is JSON");
    let directive = |name: &str| -> String {
        config["app"]["security"]["csp"]
            .as_str()
            .expect("a policy")
            .split(';')
            .map(str::trim)
            .find_map(|part| part.strip_prefix(name).map(str::trim).map(String::from))
            .unwrap_or_default()
    };
    assert_eq!(directive("connect-src"), "ipc: http://ipc.localhost");
    assert_eq!(
        directive("img-src"),
        "'self' data: blob: asset: http://asset.localhost"
    );
}
