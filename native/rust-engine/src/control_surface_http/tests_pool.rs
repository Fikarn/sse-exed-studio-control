//! The bridge's queue over the wire: its size, its refusals, and the order
//! it answers in (fix D, 2026-10-02: a press before the displays' reads).

use super::tests::{
    raw_request, start_test_bridge, start_test_bridge_with_context, status_of, TEST_TOKEN,
};
use super::*;
use crate::control_surface::test_support::ready_audio_test_db;

#[test]
fn worker_pool_returns_503_when_saturated() {
    let test_dir = ready_audio_test_db("bridge-saturated");
    let port = start_test_bridge(&test_dir, 1, 1);

    // One idle connection occupies the only worker; the next fills the only
    // queue slot; the third finds the queue full.
    let _busy_worker = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    thread::sleep(Duration::from_millis(200));
    let _queued = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    thread::sleep(Duration::from_millis(200));

    let refused = raw_request(port, "");
    assert_eq!(status_of(&refused), 503, "{refused}");

    // Once the idle connections time out (408) the pool serves again.
    let host = format!("127.0.0.1:{port}");
    let mut last = String::new();
    for _ in 0..12 {
        thread::sleep(Duration::from_millis(500));
        last = raw_request(
            port,
            &format!(
                "GET /api/deck/context HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
            ),
        );
        if status_of(&last) == 200 {
            break;
        }
    }
    assert_eq!(
        status_of(&last),
        200,
        "the pool must recover after the idle connections time out: {last}"
    );
}

// 2026-09-22, found on the studio workstation after the profile was
// imported with its token: the exported profile's once-a-second LCD poll
// sends a request per audio LCD key all at once, and a queue of 16 turned
// the last five away every second — the same five keys each time. The
// engine's own pool must hold the deck's worst instant, the poll meeting
// the press that sends the most.
#[test]
fn the_pool_holds_the_decks_worst_instant() {
    let worst = crate::exports::deck_worst_instant_requests();
    // The numbers the queue was sized for. A profile that sends more
    // changes them here, and the queue with them. Since 2026-09-29 the
    // LIGHTS page's four dial displays are polled, and arriving on LIGHTS
    // refreshes nothing (it was 43, 4, 17): the instant is the same size.
    assert_eq!(
        (worst.poll, worst.follow, worst.press, worst.total()),
        (47, 0, 17, 64)
    );
    // The instant and the largest press again must fit: a key pressed
    // while the instant waits is not turned away.
    assert!(
        WORKER_COUNT + QUEUE_CAPACITY >= worst.total() + worst.press,
        "{} requests at the worst instant and a press of {} more do not fit {WORKER_COUNT} workers and a queue of {QUEUE_CAPACITY}",
        worst.total(),
        worst.press
    );
    let test_dir = ready_audio_test_db("bridge-deck-burst");
    let port = start_test_bridge(&test_dir, WORKER_COUNT, QUEUE_CAPACITY);
    let host = format!("127.0.0.1:{port}");

    // What the instant asks for: every display of the poll, the LIGHTS
    // page's among them, and a press's worth of displays more.
    let polled = crate::exports::polled_lcd_keys();
    let keys: Vec<&str> = polled
        .iter()
        .copied()
        .chain(polled.iter().copied().take(worst.press))
        .collect();
    assert_eq!(keys.len(), worst.total());

    // Every connection is open before any request is sent, so no worker can
    // finish one and make room: the whole burst waits at once.
    let mut streams: Vec<TcpStream> = keys
        .iter()
        .map(|_| TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect"))
        .collect();
    thread::sleep(Duration::from_millis(200));
    for (stream, key) in streams.iter_mut().zip(&keys) {
        let request = format!(
            "GET /api/deck/lcd?key={key} HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
        );
        let _ = stream.write_all(request.as_bytes());
        let _ = stream.shutdown(Shutdown::Write);
    }
    let statuses: Vec<(&str, u16)> = streams
        .into_iter()
        .zip(&keys)
        .map(|(mut stream, key)| {
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("read timeout");
            let mut response = Vec::new();
            let _ = stream.read_to_end(&mut response);
            (*key, status_of(&String::from_utf8_lossy(&response)))
        })
        .collect();
    let unserved: Vec<&(&str, u16)> = statuses
        .iter()
        .filter(|(_, status)| *status != 200)
        .collect();
    assert!(
        unserved.is_empty(),
        "{} of {} requests at the deck's worst instant were not served: {unserved:?}",
        unserved.len(),
        keys.len()
    );
}

/// Opens a connection and sends `request` at once, as Companion does.
fn send(port: u16, request: &str) -> TcpStream {
    let mut stream = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    stream.write_all(request.as_bytes()).expect("write");
    stream
}

/// Reads the answer to the end, and when it came.
fn answer_of(mut stream: TcpStream) -> (u16, Instant) {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("read timeout");
    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response);
    (
        status_of(&String::from_utf8_lossy(&response)),
        Instant::now(),
    )
}

fn display_read(host: &str, key: &str) -> String {
    format!(
        "GET /api/deck/lcd?key={key} HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
    )
}

fn press(host: &str) -> String {
    let body = r#"{"action":"nothing-at-all"}"#;
    format!(
        "POST /api/deck/audio-action HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
}

// Fix D (2026-10-02): the poll's 47 display reads come at one instant, and a
// press just after them waited for every one to be answered.
#[test]
fn a_press_is_answered_before_the_display_reads_that_came_first() {
    let test_dir = ready_audio_test_db("bridge-press-first");
    let port = start_test_bridge(&test_dir, 1, QUEUE_CAPACITY);
    let host = format!("127.0.0.1:{port}");

    // The only worker waits on a connection that sends nothing, until its
    // 408; the reads and then the press queue up behind it.
    let _idle = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    thread::sleep(Duration::from_millis(100));
    let key = crate::exports::polled_lcd_keys()[0];
    let reads: Vec<TcpStream> = (0..10)
        .map(|_| send(port, &display_read(&host, key)))
        .collect();
    thread::sleep(Duration::from_millis(50));
    let pressed = send(port, &press(&host));

    let reads: Vec<_> = reads
        .into_iter()
        .map(|stream| thread::spawn(move || answer_of(stream)))
        .collect();
    let (press_status, press_answered) = answer_of(pressed);
    assert_ne!(press_status, 0, "the press was answered");
    for read in reads {
        let (status, answered) = read.join().expect("a read");
        assert_eq!(status, 200);
        assert!(
            press_answered < answered,
            "the press is answered before every read that came before it"
        );
    }
}

#[test]
fn a_press_that_finds_the_queue_full_is_served_and_a_read_is_refused() {
    let test_dir = ready_audio_test_db("bridge-press-reserve");
    let (port, context) = start_test_bridge_with_context(&test_dir, 1, 1);
    let host = format!("127.0.0.1:{port}");

    // One idle connection holds the only worker, the next fills the queue.
    let _busy_worker = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    thread::sleep(Duration::from_millis(200));
    let _queued = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    thread::sleep(Duration::from_millis(200));

    let pressed = send(port, &press(&host));
    thread::sleep(Duration::from_millis(200));
    let key = crate::exports::polled_lcd_keys()[0];
    let (read_status, _) = answer_of(send(port, &display_read(&host, key)));
    assert_eq!(read_status, 503, "a read finds the queue full");

    // Once the idle connections time out, the press is answered.
    let (press_status, _) = answer_of(pressed);
    assert_ne!(press_status, 503, "the press took a slot kept for presses");
    assert_ne!(press_status, 0, "the press was answered");
    assert_eq!(context.minute().refused, 1, "the minute counts the refusal");
}

// A refusal used to be written and the socket dropped with the request
// unread: Windows then resets the connection, and a client still sending
// loses the status it was owed.
#[test]
fn a_refused_request_reads_its_503_while_it_is_still_sending() {
    let test_dir = ready_audio_test_db("bridge-drained-503");
    let port = start_test_bridge(&test_dir, 1, 1);
    let host = format!("127.0.0.1:{port}");
    let _busy_worker = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    thread::sleep(Duration::from_millis(200));
    let _queued = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    thread::sleep(Duration::from_millis(200));

    // Not a press: its headers, then its body after the refusal was written.
    let body = "x".repeat(12_000);
    let head = format!(
        "PUT /api/deck/context HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\nContent-Length: {}\r\n\r\n",
        body.len()
    );
    let mut stream = send(port, &head);
    thread::sleep(Duration::from_millis(150));
    for chunk in body.as_bytes().chunks(1_000) {
        let _ = stream.write_all(chunk);
        thread::sleep(Duration::from_millis(5));
    }
    let (status, _) = answer_of(stream);
    assert_eq!(status, 503);
}

#[test]
fn the_minute_counts_what_the_bridge_served() {
    let test_dir = ready_audio_test_db("bridge-minute");
    let (port, context) = start_test_bridge_with_context(&test_dir, 2, 8);
    let host = format!("127.0.0.1:{port}");
    let key = crate::exports::polled_lcd_keys()[0];

    assert_eq!(
        status_of(&raw_request(port, &display_read(&host, key))),
        200
    );
    assert_ne!(status_of(&raw_request(port, &press(&host))), 0);
    let context_read = format!(
        "GET /api/deck/context HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
    );
    assert_eq!(status_of(&raw_request(port, &context_read)), 200);

    let minute = std::mem::take(&mut *context.minute());
    assert_eq!((minute.presses, minute.displays, minute.other), (1, 1, 1));
    assert_eq!((minute.refused, minute.timed_out), (0, 0));
    assert!(minute.deepest >= 1);
    assert!(
        ["GET lcd", "POST audio-action", "GET context"]
            .contains(&minute.longest_handling.1.as_str()),
        "{minute:?}"
    );
}
