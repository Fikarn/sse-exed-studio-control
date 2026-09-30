//! The pictures' link: the listener, its secret, the helper's hello, what the
//! layer is asked, and what is refused. Every connection here is to
//! 127.0.0.1, to a listener the test opened. Nothing asserts a tighter time
//! than a few seconds: the gate runs below normal priority.

use super::*;
use std::io::Write;
use std::sync::{Mutex, MutexGuard};

const PATIENCE: Duration = Duration::from_secs(20);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn recorded_log() -> (PicturesLog, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let log: PicturesLog = {
        let lines = Arc::clone(&lines);
        Arc::new(move |line: &str| lock(&lines).push(line.to_string()))
    };
    (log, lines)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Asked {
    Attach { number: u64, pid: u32 },
    Detach { number: u64 },
}

/// A layer that records what it is asked, and answers each attach with a
/// line on the connection, as the real one says `surface`.
#[derive(Default)]
struct RecordedLayer {
    asked: Mutex<Vec<Asked>>,
}

impl LayerSink for RecordedLayer {
    fn attach(&self, number: u64, pid: u32, mut writer: TcpStream) {
        lock(&self.asked).push(Asked::Attach { number, pid });
        let _ = writeln!(writer, "attached {number}");
    }

    fn detach(&self, number: u64) {
        lock(&self.asked).push(Asked::Detach { number });
    }
}

/// Waits until `ready` holds, or fails the test after `PATIENCE`.
fn wait_until(what: &str, mut ready: impl FnMut() -> bool) {
    let started = Instant::now();
    while !ready() {
        assert!(started.elapsed() < PATIENCE, "{what}");
        thread::sleep(Duration::from_millis(10));
    }
}

fn open() -> (Arc<RecordedLayer>, PicturesLink, Arc<Mutex<Vec<String>>>) {
    let layer = Arc::new(RecordedLayer::default());
    let (log, lines) = recorded_log();
    let sink: Arc<dyn LayerSink> = Arc::clone(&layer) as Arc<dyn LayerSink>;
    let link = PicturesLink::open(log, sink).expect("the listener opens");
    (layer, link, lines)
}

/// The number of the connection whose helper said hello with `pid`, once the
/// layer is asked for its surface. Numbers run on across the tests of this
/// process, so a test learns them.
fn attached(layer: &RecordedLayer, pid: u32) -> u64 {
    let mut number = None;
    wait_until("the layer is asked for a surface", || {
        number = lock(&layer.asked).iter().find_map(|asked| match asked {
            Asked::Attach { number, pid: said } if *said == pid => Some(*number),
            _ => None,
        });
        number.is_some()
    });
    number.expect("an attach")
}

/// The helper's side: the secret, then hello.
fn helper(link: &PicturesLink, pid: u32) -> TcpStream {
    let mut stream = connect_saying(link.address(), link.secret()).expect("connects");
    writeln!(stream, r#"{{"type":"hello","pid":{pid}}}"#).expect("says hello");
    stream
}

/// Closed by the listener: the read ends with nothing, or an error.
fn is_closed(stream: &mut TcpStream) -> bool {
    stream.set_read_timeout(Some(PATIENCE)).expect("a timeout");
    let mut byte = [0_u8; 1];
    matches!(stream.read(&mut byte), Ok(0) | Err(_))
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
fn a_helper_that_says_hello_is_handed_to_the_layer_and_taken_back_at_its_end() {
    let (layer, link, lines) = open();
    let mut stream = helper(&link, 4242);
    let number = attached(&layer, 4242);
    assert_eq!(lock(&layer.asked).len(), 1, "asked once");
    // The layer's writer is this connection: its line arrives.
    stream.set_read_timeout(Some(PATIENCE)).expect("a timeout");
    let expected = format!("attached {number}\n");
    let mut said = vec![0_u8; expected.len()];
    stream.read_exact(&mut said).expect("the layer's line");
    assert_eq!(said, expected.into_bytes());
    // What the helper says afterwards is passed over.
    writeln!(stream, "anything").expect("writes");
    drop(stream);
    wait_until("the surface is taken back", || {
        lock(&layer.asked).last() == Some(&Asked::Detach { number })
    });
    let lines = lock(&lines);
    assert!(lines
        .iter()
        .any(|line| line == "The pictures helper is connected."));
    assert!(lines
        .iter()
        .any(|line| line.contains("the helper closed it")));
}

#[test]
fn a_connection_without_the_secret_is_closed_and_counted() {
    let (layer, link, _) = open();
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
        let _ = writeln!(stranger, r#"{{"type":"hello","pid":1}}"#);
        assert!(is_closed(&mut stranger), "{attempt}");
    }
    // One that says nothing at all is closed after a second.
    let mut silent = TcpStream::connect(link.address()).expect("connects");
    assert!(is_closed(&mut silent));

    assert!(lock(&layer.asked).is_empty(), "the layer was asked nothing");
    assert_eq!(link.refused.load(Ordering::SeqCst), 5);
}

// A flood of connections that say nothing: past `MAX_HANDSHAKES` they are
// closed at once, and once the waiting ones are gone the helper gets in. The
// handshake here waits half a minute, longer than this test waits for the
// refusals: they can only come from the cap.
#[test]
fn a_flood_of_silent_connections_is_turned_away_and_the_helper_still_gets_in() {
    let layer = Arc::new(RecordedLayer::default());
    let (log, _) = recorded_log();
    let sink: Arc<dyn LayerSink> = Arc::clone(&layer) as Arc<dyn LayerSink>;
    let link =
        PicturesLink::open_with(log, sink, Duration::from_secs(30)).expect("the listener opens");
    let flood: Vec<TcpStream> = (0..MAX_HANDSHAKES + 12)
        .filter_map(|_| TcpStream::connect(link.address()).ok())
        .collect();
    assert_eq!(flood.len(), MAX_HANDSHAKES + 12);
    let started = Instant::now();
    while link.refused.load(Ordering::SeqCst) < 12 {
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "the ones past the cap are refused at once"
        );
        thread::sleep(Duration::from_millis(10));
    }
    // The ones that wait end when the flood lets go of them.
    drop(flood);
    // The helper tries again after a second, as its link does.
    let mut kept = Vec::new();
    wait_until("the helper gets in", || {
        kept.push(helper(&link, 7));
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if lock(&layer.asked)
                .iter()
                .any(|asked| matches!(asked, Asked::Attach { pid: 7, .. }))
            {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        false
    });
}

#[test]
fn a_first_line_that_is_not_a_hello_closes_the_connection() {
    let (layer, link, lines) = open();
    for said in [
        "not a hello at all",
        r#"{"type":"scene","width":1,"height":1,"pictures":[],"holes":[]}"#,
        r#"{"type":"hello","pid":-4}"#,
    ] {
        let mut stream = connect_saying(link.address(), link.secret()).expect("connects");
        writeln!(stream, "{said}").expect("writes");
        assert!(is_closed(&mut stream), "{said}");
    }
    // A hello that does not end within its bound.
    let mut long = connect_saying(link.address(), link.secret()).expect("connects");
    let _ = long.write_all("x".repeat(MAX_HELLO_BYTES * 4).as_bytes());
    assert!(is_closed(&mut long));
    // The secret and then nothing: closed after a second.
    let mut silent = connect_saying(link.address(), link.secret()).expect("connects");
    assert!(is_closed(&mut silent));

    assert!(lock(&layer.asked).is_empty(), "the layer was asked nothing");
    wait_until("the reasons are logged", || {
        let lines = lock(&lines);
        lines.iter().any(|line| line.contains("was not a hello"))
            && lines.iter().any(|line| line.contains("did not say hello"))
    });
}

#[test]
fn a_new_connection_with_the_secret_takes_the_old_one_s_place() {
    let (layer, link, _) = open();
    let _first = helper(&link, 11);
    let first = attached(&layer, 11);
    let _second = helper(&link, 12);
    let second = attached(&layer, 12);
    assert!(second > first, "{first} then {second}");
    // The first one's connection is given up though it stays open: its
    // surface is taken back, and the second one's is not.
    wait_until("the first one's surface is taken back", || {
        lock(&layer.asked).contains(&Asked::Detach { number: first })
    });
    assert!(!lock(&layer.asked).contains(&Asked::Detach { number: second }));
}

// A connection whose hello comes after a newer connection said the secret
// gets no surface: the newer one keeps its place. The handshake waits half a
// minute here, so the older one's hello can come as late as the test wants.
#[test]
fn a_hello_that_comes_after_a_newer_connection_gets_no_surface() {
    let layer = Arc::new(RecordedLayer::default());
    let (log, lines) = recorded_log();
    let sink: Arc<dyn LayerSink> = Arc::clone(&layer) as Arc<dyn LayerSink>;
    let link =
        PicturesLink::open_with(log, sink, Duration::from_secs(30)).expect("the listener opens");
    let mut older = connect_saying(link.address(), link.secret()).expect("connects");
    wait_until("the older one's secret is taken", || {
        lock(&lines)
            .iter()
            .filter(|line| *line == "The pictures helper is connected.")
            .count()
            == 1
    });
    let _newer = helper(&link, 22);
    attached(&layer, 22);
    writeln!(older, r#"{{"type":"hello","pid":21}}"#).expect("the late hello");
    assert!(is_closed(&mut older), "the older connection ends");
    assert!(
        !lock(&layer.asked)
            .iter()
            .any(|asked| matches!(asked, Asked::Attach { pid: 21, .. })),
        "the older one gets no surface"
    );
}

#[test]
fn a_new_start_refuses_the_old_secret_and_the_old_listener_closes() {
    let (_, old, _) = open();
    let old_address = old.address();
    let old_secret = old.secret().to_string();
    drop(old);
    let (layer, new, _) = open();
    // The old listener is gone.
    wait_until("the old listener closes", || {
        TcpStream::connect_timeout(&old_address, Duration::from_millis(200)).is_err()
    });
    // The new one does not take the old secret.
    let mut late = connect_saying(new.address(), &old_secret).expect("connects");
    let _ = writeln!(late, r#"{{"type":"hello","pid":1}}"#);
    assert!(is_closed(&mut late));
    assert!(lock(&layer.asked).is_empty());
}

#[test]
fn the_secret_is_in_no_log_line() {
    let (_, link, lines) = open();
    let mut stream = connect_saying(link.address(), link.secret()).expect("connects");
    // A helper that says the secret again where its hello belongs.
    writeln!(stream, "{}", link.secret()).expect("writes");
    let mut stranger = connect_saying(link.address(), "0").expect("connects");
    let _ = stranger.write_all(b"x");
    wait_until("the bad hello is logged", || {
        lock(&lines)
            .iter()
            .any(|line| line.contains("was not a hello"))
    });
    for line in lock(&lines).iter() {
        assert!(!line.contains(link.secret()), "{line}");
    }
}

// The page's connection policy stays as it is: the page reaches the shell
// through the IPC protocol it already allows, and nothing else. No picture
// comes to the page at all. `scripts/tauri-smoke.mjs` checks the policy's
// shape; this holds its two sources exactly.
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
