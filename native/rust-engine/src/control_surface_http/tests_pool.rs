//! The bridge's queue over the wire: its size, its refusals, and the order
//! it answers in (fix D, 2026-10-02: a press before the displays' reads).

use super::overflow::Overflow;
use super::tests::{
    raw_request, start_test_bridge, start_test_bridge_with_context, status_of, TEST_TOKEN,
};
use super::*;
use crate::control_surface::test_support::ready_audio_test_db;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::sync_channel;

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
// sent a request per audio LCD key all at once, and a queue of 16 turned
// the last five away every second — the same five keys each time. The
// engine's own pool must hold the deck's worst instant, the poll meeting
// the press that sends the most. Since 2026-10-03 the poll is one read of
// every display (it was 47 reads, and the instant 64), and a press its
// action and that read again.
#[test]
fn the_pool_holds_the_decks_worst_instant() {
    let worst = crate::exports::deck_worst_instant_requests();
    // The numbers the queue was sized for. A profile that sends more
    // changes them here, and the queue with them.
    assert_eq!(
        (worst.poll, worst.follow, worst.press, worst.total()),
        (1, 0, 2, 3)
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

    // A fast spin of a dial is the busiest the deck gets now: a detent's
    // action and its read again, a dozen detents at once, over the poll.
    // Each read is every display: it must be served as a read of one was.
    let detents = 12;
    let requests: Vec<String> = std::iter::once(displays_read(&host))
        .chain((0..detents).flat_map(|_| [press(&host), displays_read(&host)]))
        .collect();
    assert!(requests.len() >= worst.total());

    // Every connection is open before any request is sent, so no worker can
    // finish one and make room: the whole burst waits at once.
    let mut streams: Vec<TcpStream> = requests
        .iter()
        .map(|_| TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect"))
        .collect();
    thread::sleep(Duration::from_millis(200));
    for (stream, request) in streams.iter_mut().zip(&requests) {
        let _ = stream.write_all(request.as_bytes());
        let _ = stream.shutdown(Shutdown::Write);
    }
    let statuses: Vec<u16> = streams
        .into_iter()
        .map(|mut stream| {
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("read timeout");
            let mut response = Vec::new();
            let _ = stream.read_to_end(&mut response);
            status_of(&String::from_utf8_lossy(&response))
        })
        .collect();
    let reads = statuses.iter().step_by(2).collect::<Vec<_>>();
    assert!(
        reads.iter().all(|status| **status == 200),
        "a read of the displays at the deck's busiest was not served: {statuses:?}"
    );
    // The presses are the test's own action, which the page refuses; each
    // was answered.
    assert!(
        statuses.iter().all(|status| *status != 0 && *status != 503),
        "{statuses:?}"
    );
}

/// The deck's one read of every display (2026-10-03).
fn displays_read(host: &str) -> String {
    format!(
        "GET /api/deck/displays HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
    )
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

// Fix D (2026-10-02): the poll's display reads came at one instant, and a
// press just after them waited for every one to be answered. The deck reads
// every display at once since 2026-10-03; a press still goes first.
#[test]
fn a_press_is_answered_before_the_display_reads_that_came_first() {
    let test_dir = ready_audio_test_db("bridge-press-first");
    let port = start_test_bridge(&test_dir, 1, QUEUE_CAPACITY);
    let host = format!("127.0.0.1:{port}");

    // The only worker waits on a connection that sends nothing, until its
    // 408; the reads and then the press queue up behind it.
    let _idle = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
    thread::sleep(Duration::from_millis(100));
    let reads: Vec<TcpStream> = (0..10).map(|_| send(port, &displays_read(&host))).collect();
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
    let (read_status, _) = answer_of(send(port, &displays_read(&host)));
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
    // The refusal is written as soon as the overflow thread sees the
    // request's start; the body comes well inside the drain's 250 ms.
    thread::sleep(Duration::from_millis(50));
    let _ = stream.write_all(body.as_bytes());
    let (status, _) = answer_of(stream);
    assert_eq!(status, 503);
}

// The review of #291: a timeout for each read let a client that sends a byte
// every 200 ms hold the overflow thread for hours.
#[test]
fn a_drain_ends_within_its_time_however_slowly_the_client_sends() {
    let listener = TcpListener::bind((DEFAULT_CONTROL_SURFACE_HOST, 0)).expect("a port");
    let mut client = TcpStream::connect(listener.local_addr().expect("address")).expect("connect");
    let (server, _) = listener.accept().expect("accept");
    let dripping = thread::spawn(move || {
        for _ in 0..30 {
            if client.write_all(b"x").is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    });
    let started = Instant::now();
    finish_connection(server);
    let took = started.elapsed();
    assert!(took < Duration::from_millis(1_000), "{took:?}");
    let _ = dripping.join();
}

// The review of #291: a press that waited for the overflow thread was
// overtaken by a later press that found room in the queue.
#[test]
fn while_connections_wait_for_the_overflow_every_connection_goes_there_in_order() {
    let test_dir = ready_audio_test_db("bridge-overflow-order");
    let context = BridgeContext::new(
        test_dir.db_path(),
        test_dir.path().join("engine.log"),
        TEST_TOKEN.to_string(),
        0,
    );
    let pool = Pool::<ParkedRead>::new(8, 2, PARKED_AT_MOST);
    let (sender, receiver) = sync_channel(4);
    let overflow = Overflow {
        sender,
        waiting: Arc::new(AtomicUsize::new(0)),
    };
    let listener = TcpListener::bind((DEFAULT_CONTROL_SURFACE_HOST, 0)).expect("a port");
    let mut clients = Vec::new();
    let mut connection = || {
        clients.push(TcpStream::connect(listener.local_addr().expect("address")).expect("connect"));
        listener.accept().expect("accept").0
    };

    // Nothing waits for the overflow thread: the queue has room.
    accept(&pool, &overflow, &context, connection(), Instant::now());
    assert_eq!(pool.depth(), 1);
    assert!(receiver.try_recv().is_err());

    // One waits there: the next goes behind it, though the queue has room.
    overflow.waiting.store(1, Ordering::Release);
    accept(&pool, &overflow, &context, connection(), Instant::now());
    assert_eq!(pool.depth(), 1);
    assert!(receiver.try_recv().is_ok());
    assert_eq!(overflow.waiting.load(Ordering::Acquire), 2);
}

#[test]
fn the_minute_counts_what_the_bridge_served() {
    let test_dir = ready_audio_test_db("bridge-minute");
    let (port, context) = start_test_bridge_with_context(&test_dir, 2, 8);
    let host = format!("127.0.0.1:{port}");
    assert_eq!(
        status_of(&raw_request(port, &display_read(&host, "workspace"))),
        200
    );
    assert_eq!(status_of(&raw_request(port, &displays_read(&host))), 200);
    assert_ne!(status_of(&raw_request(port, &press(&host))), 0);
    let context_read = format!(
        "GET /api/deck/context HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
    );
    assert_eq!(status_of(&raw_request(port, &context_read)), 200);

    let minute = std::mem::take(&mut *context.minute());
    assert_eq!((minute.presses, minute.displays, minute.other), (1, 2, 1));
    assert_eq!((minute.refused, minute.timed_out), (0, 0));
    assert!(minute.deepest >= 1);
    assert!(
        [
            "GET lcd",
            "GET displays",
            "POST audio-action",
            "GET context"
        ]
        .contains(&minute.longest_handling.1.as_str()),
        "{minute:?}"
    );
}
