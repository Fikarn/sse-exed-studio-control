//! Property tests for the bridge's request reader and query decoder (2026-09
//! production readiness, Slice 13 — finding F25).
//!
//! The example tests in `control_surface_http.rs` pin each limit with one
//! request written by hand. These run the same two functions over whatever
//! bytes a client can put on the socket — arbitrary, cut at arbitrary places,
//! and request-shaped with hostile lengths — and hold what the bridge promises
//! for all of them: no panic, a bounded read (finding F06), and a request that
//! says what was sent when one is returned.
//!
//! Nothing here opens a socket: the reader is fed from memory.

use super::*;
use proptest::prelude::*;
use std::io::Read;

/// The reader's own chunk size: the most a single read can overshoot a limit.
const READ_CHUNK: usize = 1024;
/// The most the reader may take off a connection, whatever arrives: headers up
/// to their limit plus one chunk, then a body up to its limit plus one chunk.
const MAX_BYTES_TAKEN: usize = MAX_HEADER_BYTES + MAX_BODY_BYTES + 2 * READ_CHUNK;

/// Hands out the bytes a few at a time, as a slow or hostile client would, and
/// counts what was taken.
struct Trickle {
    data: Vec<u8>,
    at: usize,
    step: usize,
}

impl Trickle {
    fn new(data: Vec<u8>, step: usize) -> Self {
        Trickle {
            data,
            at: 0,
            step: step.max(1),
        }
    }
}

impl Read for Trickle {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let count = self.step.min(buffer.len()).min(self.data.len() - self.at);
        buffer[..count].copy_from_slice(&self.data[self.at..self.at + count]);
        self.at += count;
        Ok(count)
    }
}

impl RequestSource for Trickle {}

fn far_deadline() -> Instant {
    Instant::now() + Duration::from_secs(30)
}

/// What every returned request must satisfy, whatever produced it.
fn assert_request_is_sound(request: &HttpRequest) -> Result<(), TestCaseError> {
    prop_assert!(!request.method.is_empty());
    prop_assert!(!request.method.contains(char::is_whitespace));
    prop_assert!(!request.target.is_empty());
    prop_assert!(!request.target.contains(char::is_whitespace));
    prop_assert!(request.body.len() <= MAX_BODY_BYTES);
    for name in request.headers.keys() {
        prop_assert!(!name.is_empty());
        prop_assert!(!name.contains(char::is_whitespace));
        prop_assert_eq!(name, &name.to_ascii_lowercase());
    }
    let declared = request
        .header("content-length")
        .map(|value| value.parse::<usize>());
    match declared {
        Some(Ok(length)) => prop_assert_eq!(request.body.len(), length),
        Some(Err(_)) => prop_assert!(false, "an unreadable Content-Length was accepted"),
        None => prop_assert!(request.body.is_empty()),
    }
    Ok(())
}

/// A `Content-Length` value a hostile client might send.
fn content_length_value() -> impl Strategy<Value = String> {
    prop_oneof![
        (0_usize..64).prop_map(|length| length.to_string()),
        (MAX_BODY_BYTES - 2..MAX_BODY_BYTES + 3).prop_map(|length| length.to_string()),
        any::<u64>().prop_map(|length| length.to_string()),
        Just(String::from("18446744073709551616")),
        Just(String::from("-1")),
        Just(String::from("+5")),
        Just(String::from("0x10")),
        Just(String::from("5, 5")),
        Just(String::new()),
        "[0-9a-f ]{0,12}",
    ]
}

fn header_line() -> impl Strategy<Value = String> {
    prop_oneof![
        content_length_value().prop_map(|value| format!("Content-Length: {value}")),
        content_length_value().prop_map(|value| format!("content-length:{value}")),
        Just(String::from("Transfer-Encoding: chunked")),
        Just(String::from("Host: 127.0.0.1:38201")),
        Just(String::from("Authorization: Bearer 0123456789abcdef")),
        "[A-Za-z-]{1,16}: [ -~]{0,48}",
        // Lines that are not headers at all.
        "[ -~]{0,32}",
        Just(String::from(": no name")),
        Just(String::from("Two Words: value")),
    ]
}

fn request_line() -> impl Strategy<Value = String> {
    prop_oneof![
        ("(GET|POST|PUT|DELETE|OPTIONS)", "/[!-~]{0,48}", "(0|1|9)")
            .prop_map(|(method, target, minor)| format!("{method} {target} HTTP/1.{minor}")),
        "[ -~]{0,64}",
        Just(String::from("GET / HTTP/2")),
        Just(String::from("GET  /  HTTP/1.1  extra")),
        Just(String::new()),
    ]
}

/// Bytes shaped like a request: a request line, some header lines, the blank
/// line (or not), and a body whose length need not match anything it declared.
fn request_shaped_bytes() -> impl Strategy<Value = Vec<u8>> {
    (
        request_line(),
        proptest::collection::vec(header_line(), 0..8),
        prop_oneof![Just("\r\n"), Just("\n")],
        any::<bool>(),
        proptest::collection::vec(any::<u8>(), 0..96),
    )
        .prop_map(|(line, headers, newline, terminated, body)| {
            let mut bytes = Vec::new();
            bytes.extend_from_slice(line.as_bytes());
            bytes.extend_from_slice(newline.as_bytes());
            for header in headers {
                bytes.extend_from_slice(header.as_bytes());
                bytes.extend_from_slice(newline.as_bytes());
            }
            if terminated {
                bytes.extend_from_slice(newline.as_bytes());
            }
            bytes.extend_from_slice(&body);
            bytes
        })
}

/// Every byte as `%XX`, so any string survives being put in a query.
fn percent_encode_all(value: &str) -> String {
    value.bytes().map(|byte| format!("%{byte:02X}")).collect()
}

proptest! {
    /// Whatever arrives, in whatever pieces: no panic, a bounded read, and a
    /// sound request when one is returned.
    #[test]
    fn read_http_request_never_panics(
        bytes in prop_oneof![
            proptest::collection::vec(any::<u8>(), 0..2048),
            request_shaped_bytes(),
        ],
        step in 1_usize..1500,
    ) {
        let mut client = Trickle::new(bytes, step);
        let outcome = read_http_request(&mut client, far_deadline());
        prop_assert!(client.at <= MAX_BYTES_TAKEN);
        if let Ok(request) = outcome {
            assert_request_is_sound(&request)?;
        }
    }

    /// An endless client is cut off at the limits: the reader never takes more
    /// than the header and body allowances, however much is on offer.
    #[test]
    fn read_http_request_stops_reading_at_its_limits(
        filler in any::<u8>(),
        prefix in request_shaped_bytes(),
        step in 1_usize..1500,
    ) {
        let mut bytes = prefix;
        bytes.resize(bytes.len() + 4 * MAX_BYTES_TAKEN, filler);
        let mut client = Trickle::new(bytes, step);
        let outcome = read_http_request(&mut client, far_deadline());
        prop_assert!(client.at <= MAX_BYTES_TAKEN, "took {} bytes", client.at);
        if let Ok(request) = outcome {
            assert_request_is_sound(&request)?;
        }
    }

    /// A well-formed request comes back as it was sent, however it is cut up.
    #[test]
    fn read_http_request_returns_what_was_sent(
        method in "(GET|POST)",
        target in "/[!-~]{0,64}",
        body in proptest::collection::vec(any::<u8>(), 0..512),
        trailing in proptest::collection::vec(any::<u8>(), 0..64),
        step in 1_usize..1500,
    ) {
        let mut bytes = format!(
            "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        bytes.extend_from_slice(&body);
        // Bytes after the declared body belong to nobody and must not leak in.
        bytes.extend_from_slice(&trailing);
        let mut client = Trickle::new(bytes, step);
        let request = read_http_request(&mut client, far_deadline());
        prop_assert!(request.is_ok(), "a well-formed request was refused: {:?}", request.err());
        let request = request.unwrap();
        prop_assert_eq!(&request.method, &method);
        prop_assert_eq!(&request.target, &target);
        prop_assert_eq!(&request.body, &body);
        assert_request_is_sound(&request)?;
    }

    /// An otherwise well-formed request that declares a body over the cap is
    /// refused from its headers alone — for every length up to the largest a
    /// header can spell, with as much body on offer as the client likes. (The
    /// request-shaped generator above rarely builds a *valid* request with a
    /// hostile length, so the cap had no property of its own: removing it went
    /// unnoticed until this one was added.)
    #[test]
    fn read_http_request_refuses_a_body_over_the_cap(
        declared in prop_oneof![
            MAX_BODY_BYTES + 1..MAX_BODY_BYTES + 64,
            MAX_BODY_BYTES + 1..usize::MAX,
            Just(usize::MAX),
        ],
        filler in any::<u8>(),
        step in 1_usize..1500,
    ) {
        let head = format!(
            "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nContent-Length: {declared}\r\n\r\n"
        );
        let head_len = head.len();
        let mut bytes = head.into_bytes();
        bytes.resize(bytes.len() + 4 * MAX_BYTES_TAKEN, filler);
        let mut client = Trickle::new(bytes, step);
        let outcome = read_http_request(&mut client, far_deadline());
        prop_assert!(
            matches!(outcome, Err(ControlSurfaceError::TooLarge(_))),
            "Content-Length {} was not refused as too large: {:?}", declared, outcome.map(|request| request.body.len())
        );
        // Refused on the headers: at most one read past them, none of the body.
        prop_assert!(client.at <= head_len + READ_CHUNK, "took {} bytes", client.at);
    }

    /// The cap itself is allowed: a body of exactly the limit is read whole.
    #[test]
    fn read_http_request_takes_a_body_at_the_cap(filler in any::<u8>(), step in 64_usize..1500) {
        let mut bytes = format!(
            "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nContent-Length: {MAX_BODY_BYTES}\r\n\r\n"
        )
        .into_bytes();
        bytes.resize(bytes.len() + MAX_BODY_BYTES, filler);
        let mut client = Trickle::new(bytes, step);
        let request = read_http_request(&mut client, far_deadline());
        prop_assert!(request.is_ok(), "a body at the cap was refused: {:?}", request.err());
        prop_assert_eq!(request.unwrap().body.len(), MAX_BODY_BYTES);
    }

    /// Any query and any name: no panic, and a value only when the name is there.
    #[test]
    fn query_parameter_never_panics(
        query in prop_oneof![any::<String>(), "[%&=+0-9a-fA-F zZ]{0,64}"],
        name in prop_oneof![any::<String>(), "[a-z%+]{0,8}"],
    ) {
        let found = query_parameter(&query, &name);
        if found.is_some() {
            prop_assert!(query.contains('='));
        }
        let _ = percent_decode(&query);
    }

    /// What a client encodes is what the bridge reads (finding F28), also with
    /// other pairs around it.
    #[test]
    fn query_parameter_decodes_what_was_encoded(
        key in any::<String>(),
        value in any::<String>(),
        before in "([a-z]{1,6}=[a-z0-9]{0,6}&){0,3}",
        after in "(&[a-z]{1,6}=[a-z0-9]{0,6}){0,3}",
    ) {
        // The pairs around it use plain lower-case keys; keep ours distinct.
        let key = format!("K{key}");
        let query = format!("{before}{}={}{after}", percent_encode_all(&key), percent_encode_all(&value));
        prop_assert_eq!(query_parameter(&query, &key), Some(value));
    }
}
