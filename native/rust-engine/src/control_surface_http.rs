//! The HTTP transport of the control-surface bridge: the listener, the
//! per-install bearer token, the request limits, the worker pool and the
//! routing into `control_surface` (2026-09 production readiness, Slice 2 —
//! findings F01 bridge unauthenticated, F06 bridge DoS, F28 percent decoding).
//! What a deck action or an LCD key does lives in `control_surface` and
//! `control_surface_audio`; nothing here interprets a request beyond its
//! method, target, headers and body.

use crate::control_surface::{
    handle_deck_http_action_at, read_control_surface_context, read_deck_lcd_text,
    ControlSurfaceBridgeInfo, ControlSurfaceError, DEFAULT_CONTROL_SURFACE_HOST,
};
use crate::diagnostics::append_log;
use crate::health::{report as report_health, SubsystemState, SUBSYSTEM_BRIDGE};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// The per-install bearer token every bridge request must carry (finding
/// F01). Written once into the app-data directory and embedded in the exported
/// Stream Deck profile.
pub const CONTROL_SURFACE_TOKEN_FILE_NAME: &str = "control-surface.token";
const CONTROL_SURFACE_TOKEN_BYTES: usize = 32;

// Request limits (finding F06). A request that breaks one of them is answered
// with the matching status and the connection is closed; nothing is parsed.
const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_BODY_BYTES: usize = 16 * 1024;
const REQUEST_DEADLINE: Duration = Duration::from_secs(1);
const RESPONSE_WRITE_TIMEOUT: Duration = Duration::from_secs(2);
const BUSY_WRITE_TIMEOUT: Duration = Duration::from_millis(200);
const DRAIN_TIMEOUT: Duration = Duration::from_millis(250);
const DRAIN_LIMIT_BYTES: usize = 64 * 1024;
const WORKER_COUNT: usize = 4;
/// Sized for the deck's worst instant: the exported profile's once-a-second
/// LCD poll sends one request per polled LCD key, all at once, and the
/// control with the most LCD refreshes sends its own burst on one press
/// (`exports::deck_worst_instant_requests` counts them). All
/// of them must fit the workers and the queue together, with
/// room for another press (`the_pool_holds_the_decks_worst_instant`); a queue
/// of 16 turned the poll's last five requests away every second on the studio
/// workstation. The thread count stays fixed whatever the queue holds. With
/// the CAMERAS and PROMPTER pages the instant was 62 requests (it was 44),
/// and 64 since the LIGHTS page's `OFF?` and `DEL?` (2026-09-28); the queue
/// went from 64 to 96: a refused key press is lost, since Companion never
/// sends one again. Since 2026-09-29 the LIGHTS page's four dial displays are
/// polled rather than refreshed by its page-follow trigger, which sends
/// nothing to the bridge now: the instant stays 64 (47 polled, a press of
/// 17). A fast spin of the Light dial sends its action and three displays a
/// detent, and is worked off about one detent at a time behind the lighting
/// lock.
const QUEUE_CAPACITY: usize = 96;
const REJECTION_LOG_INTERVAL: Duration = Duration::from_secs(60);
/// A key a page refuses is a line of its own, one a second at most for each
/// key: a dial's turn is many refused detents (the review of #254).
const REFUSED_KEY_LOG_INTERVAL: Duration = Duration::from_secs(1);

/// The bearer token the bridge demands on every request (finding F01):
/// `<app-data>/control-surface.token`, 64 hex characters from OS randomness,
/// created on the first launch of an install and reused afterwards. The
/// exported Stream Deck profile embeds it, which is why a profile exported
/// before this landed stops working and must be exported and imported again.
pub fn load_or_create_bridge_token(app_data_dir: &Path) -> Result<String, String> {
    let path = app_data_dir.join(CONTROL_SURFACE_TOKEN_FILE_NAME);
    if let Ok(existing) = fs::read_to_string(&path) {
        let existing = existing.trim();
        if is_bridge_token(existing) {
            return Ok(existing.to_string());
        }
    }

    let token = generate_bridge_token()?;
    write_bridge_token_file(&path, &token).map_err(|error| {
        format!(
            "Unable to write the bridge token file {}: {error}",
            path.display()
        )
    })?;
    Ok(token)
}

fn is_bridge_token(value: &str) -> bool {
    value.len() == CONTROL_SURFACE_TOKEN_BYTES * 2
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn generate_bridge_token() -> Result<String, String> {
    let mut bytes = [0_u8; CONTROL_SURFACE_TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|error| {
        format!("The operating system did not provide randomness for the bridge token: {error}")
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn write_bridge_token_file(path: &Path, token: &str) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    let mut file = options.open(path)?;
    file.write_all(token.as_bytes())?;
    file.write_all(b"\n")?;
    file.flush()?;
    Ok(())
}

/// `cameras_simulated` is `SSE_CAMERAS_SIMULATED`, read at the start: the
/// CAMERAS page's keys and displays reach the cameras the screen reaches.
pub fn start_control_surface_bridge(
    db_path: &Path,
    log_file_path: &Path,
    requested_port: u16,
    token: String,
    cameras_simulated: bool,
) -> ControlSurfaceBridgeInfo {
    match bind_control_surface_listener(requested_port) {
        Ok(listener) => {
            let port = listener
                .local_addr()
                .map(|address| address.port())
                .unwrap_or(requested_port);
            let base_url = format!("http://{DEFAULT_CONTROL_SURFACE_HOST}:{port}");
            let summary = format!("The deck's bridge is ready at {base_url}.");

            // The bootstrap writes the one log line about this start, serving
            // or not (`start_logged_control_surface_bridge`).
            report_health(SUBSYSTEM_BRIDGE, SubsystemState::Ok, summary.clone());

            let context = Arc::new(
                BridgeContext::new(
                    db_path.to_path_buf(),
                    log_file_path.to_path_buf(),
                    token,
                    port,
                )
                .with_cameras_simulated(cameras_simulated)
                .keeping_read_connections(),
            );
            thread::spawn(move || {
                run_control_surface_bridge(listener, context, WORKER_COUNT, QUEUE_CAPACITY)
            });
            crate::deck_heard::spawn_deck_quiet_watch(db_path.to_path_buf());

            ControlSurfaceBridgeInfo {
                base_url,
                port,
                available: true,
                status: String::from("ready"),
                summary,
                error: None,
            }
        }
        Err(message) => {
            let summary = format!(
                "The deck's bridge could not open its port: {message}. Close what holds it, then restart the hardware link."
            );
            // Health `attention` (Slice 8 — F14): the deck cannot reach the
            // app until the port is free or SSE_CONTROL_SURFACE_PORT names
            // another one; there is no fallback port.
            report_health(SUBSYSTEM_BRIDGE, SubsystemState::Attention, summary.clone());
            ControlSurfaceBridgeInfo {
                base_url: format!("http://{DEFAULT_CONTROL_SURFACE_HOST}:{requested_port}"),
                port: requested_port,
                available: false,
                status: String::from("unavailable"),
                summary,
                error: Some(message),
            }
        }
    }
}

fn bind_control_surface_listener(requested_port: u16) -> Result<TcpListener, String> {
    TcpListener::bind((DEFAULT_CONTROL_SURFACE_HOST, requested_port))
        .map_err(|error| error.to_string())
}

/// What the acceptor and the worker threads of one bridge share.
struct BridgeContext {
    db_path: PathBuf,
    log_file_path: PathBuf,
    token: String,
    port: u16,
    rejection_log: Mutex<HashMap<u16, RejectionTally>>,
    /// The refused keys' lines, for each route and action: when the last was
    /// written, and how many were refused since without one.
    refused_keys: Mutex<HashMap<String, (Option<Instant>, u32)>>,
    /// Whether the workers keep one read connection each (Slice 10 — F18).
    /// The engine's bridge does; a test's bridge does not, because its
    /// workers outlive the test and would hold its temporary database open.
    keep_read_connections: bool,
    /// `SSE_CAMERAS_SIMULATED`, read at the start. A context that was not
    /// told has none of the simulated cameras: a bridge that forgot to ask
    /// reads every camera as having no link, and never shows a simulated
    /// camera as a real one.
    cameras_simulated: bool,
}

impl BridgeContext {
    fn new(db_path: PathBuf, log_file_path: PathBuf, token: String, port: u16) -> Self {
        Self {
            db_path,
            log_file_path,
            token,
            port,
            rejection_log: Mutex::new(HashMap::new()),
            refused_keys: Mutex::new(HashMap::new()),
            keep_read_connections: false,
            cameras_simulated: false,
        }
    }

    fn with_cameras_simulated(mut self, cameras_simulated: bool) -> Self {
        self.cameras_simulated = cameras_simulated;
        self
    }

    fn keeping_read_connections(mut self) -> Self {
        self.keep_read_connections = true;
        self
    }

    /// A refused request is logged at most once per status per minute, so a
    /// flood of bad requests cannot become a flood of log lines (F06). Each
    /// line also counts the refusals with its status that went unwritten since
    /// the one before: a line a minute was read as "refused about once a
    /// minute" while every request was being refused (2026-09-22).
    fn note_rejection(&self, status_code: u16, message: &str) {
        self.note_rejection_at(status_code, message, Instant::now());
    }

    fn note_rejection_at(&self, status_code: u16, message: &str, now: Instant) {
        let unwritten = {
            let mut recent = self
                .rejection_log
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match recent.get_mut(&status_code) {
                Some(tally)
                    if now.saturating_duration_since(tally.last_written)
                        < REJECTION_LOG_INTERVAL =>
                {
                    tally.unwritten += 1;
                    None
                }
                Some(tally) => {
                    let unwritten = tally.unwritten;
                    *tally = RejectionTally {
                        last_written: now,
                        unwritten: 0,
                    };
                    Some(unwritten)
                }
                None => {
                    recent.insert(
                        status_code,
                        RejectionTally {
                            last_written: now,
                            unwritten: 0,
                        },
                    );
                    Some(0)
                }
            }
        };
        if let Some(unwritten) = unwritten {
            let more = if unwritten == 0 {
                String::new()
            } else {
                format!(" ({unwritten} more with this status since the last such line)")
            };
            let _ = append_log(
                self.log_file_path.as_path(),
                "WARN",
                &format!(
                    "Control-surface bridge refused a request ({status_code}): {message}{more}"
                ),
            );
        }
    }
}

/// When a refusal status was last written to the log, and how many refusals
/// with it have gone unwritten since.
struct RejectionTally {
    last_written: Instant,
    unwritten: u64,
}

/// One acceptor, a bounded queue and a fixed pool of workers (F06). A
/// connection that finds the queue full is answered 503 by the acceptor and
/// closed, so a burst can never grow the thread count. A worker that panics
/// inside a handler logs and carries on serving.
fn run_control_surface_bridge(
    listener: TcpListener,
    context: Arc<BridgeContext>,
    worker_count: usize,
    queue_capacity: usize,
) {
    let _ = listener.set_nonblocking(false);
    // A connection is queued with the moment it arrived: a key's moment is
    // its arrival, not when a worker is free (the review of #254), so a press
    // that waited behind a burst is never taken for a later one.
    let (sender, receiver) = sync_channel::<(TcpStream, Instant)>(queue_capacity.max(1));
    let receiver = Arc::new(Mutex::new(receiver));

    for index in 0..worker_count.max(1) {
        let receiver = Arc::clone(&receiver);
        let worker_context = Arc::clone(&context);
        let spawned = thread::Builder::new()
            .name(format!("control-surface-worker-{index}"))
            .spawn(move || serve_queued_connections(&receiver, &worker_context));
        if let Err(error) = spawned {
            let _ = append_log(
                context.log_file_path.as_path(),
                "ERROR",
                &format!("Control-surface bridge could not start worker {index}: {error}"),
            );
        }
    }

    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => match sender.try_send((stream, Instant::now())) {
                Ok(()) => {}
                Err(TrySendError::Full((stream, _)))
                | Err(TrySendError::Disconnected((stream, _))) => {
                    refuse_busy(stream, &context);
                }
            },
            Err(error) => {
                let _ = append_log(
                    context.log_file_path.as_path(),
                    "WARN",
                    &format!("Control-surface bridge accept failed: {error}"),
                );
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

/// One worker: serves queued connections until the acceptor goes away. The
/// engine's workers keep one read connection each for their settings reads
/// (2026-09 production readiness, Slice 10 — F18).
fn serve_queued_connections(
    receiver: &Mutex<Receiver<(TcpStream, Instant)>>,
    context: &BridgeContext,
) {
    if context.keep_read_connections {
        crate::storage::enable_thread_read_connection();
    }
    loop {
        let next = receiver
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv();
        let Ok((stream, arrived)) = next else {
            break;
        };
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            handle_control_surface_connection(stream, context, arrived)
        }));
        match outcome {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = append_log(
                    context.log_file_path.as_path(),
                    "WARN",
                    &format!("Control-surface bridge request failed: {}", error.message()),
                );
            }
            Err(_) => {
                let _ = append_log(
                    context.log_file_path.as_path(),
                    "ERROR",
                    "Control-surface bridge worker recovered from a panic while serving a request",
                );
            }
        }
    }
}

fn refuse_busy(mut stream: TcpStream, context: &BridgeContext) {
    let _ = stream.set_write_timeout(Some(BUSY_WRITE_TIMEOUT));
    let error = ControlSurfaceError::Busy(String::from(
        "The bridge is busy with other requests; retry shortly.",
    ));
    let response = HttpResponse::from_error(&error);
    let _ = write_http_response(&mut stream, response.status_code, &response.body);
    context.note_rejection(response.status_code, error.message());
}

fn handle_control_surface_connection(
    mut stream: TcpStream,
    context: &BridgeContext,
    arrived: Instant,
) -> Result<(), ControlSurfaceError> {
    let deadline = Instant::now() + REQUEST_DEADLINE;
    let _ = stream.set_write_timeout(Some(RESPONSE_WRITE_TIMEOUT));
    let request = read_http_request(&mut stream, deadline);
    let response = respond_at(context, request, arrived);
    let written = write_http_response(&mut stream, response.status_code, &response.body);
    finish_connection(stream);
    written.map_err(|error| ControlSurfaceError::Storage(error.to_string()))
}

/// Authorization runs before anything in the request is interpreted: an
/// unauthenticated body is never parsed, whatever it says.
#[cfg(test)]
fn respond(
    context: &BridgeContext,
    request: Result<HttpRequest, ControlSurfaceError>,
) -> HttpResponse {
    respond_at(context, request, Instant::now())
}

/// `respond` for a request that arrived at `arrived`: a key's moment.
fn respond_at(
    context: &BridgeContext,
    request: Result<HttpRequest, ControlSurfaceError>,
    arrived: Instant,
) -> HttpResponse {
    let authorized = request
        .and_then(|request| authorize(&request, &context.token, context.port).map(|()| request));
    match authorized {
        Ok(request) => {
            // A request with the token is the deck's: Setup's probe and the
            // Surface lamp read when it last asked (2026-09-29).
            crate::deck_heard::note_deck_heard(&context.db_path, arrived);
            let response = route_control_surface_request(
                &context.db_path,
                context.cameras_simulated,
                &request,
                arrived,
            );
            note_refused_key(context, &request, &response, arrived);
            response
        }
        Err(error) => {
            context.note_rejection(error.status_code(), error.message());
            HttpResponse::from_error(&error)
        }
    }
}

/// The routes a key or a dial of the deck posts to, one a page (D5).
const KEY_ROUTES: [&str; 4] = [
    "/api/deck/light-action",
    "/api/deck/audio-action",
    "/api/deck/camera-action",
    "/api/deck/prompter-action",
];

/// A key the deck was refused leaves a line in the log (2026-09-28): the
/// route, the key and its value as the profile sent them, the status and the
/// sentence. Companion never sends a refused press again, so without it the
/// press was lost without a trace (`REC` while CAM 1 is released). One line
/// a second at most for each route and action, since a dial's turn is many
/// refused detents; the next line of that key counts the ones between. The
/// displays' reads are left out, since the poll asks for 47 of them a second,
/// and so are the bridge's own refusals, which `note_rejection` counts.
fn note_refused_key(
    context: &BridgeContext,
    request: &HttpRequest,
    response: &HttpResponse,
    at: Instant,
) {
    let (path, _) = split_target(&request.target);
    if request.method != "POST" || !KEY_ROUTES.contains(&path) || response.status_code == 200 {
        return;
    }
    let body = serde_json::from_slice::<Value>(&request.body).unwrap_or(Value::Null);
    let text = |field: &str| body.get(field).and_then(Value::as_str).unwrap_or_default();
    // What the profile sent, on one line whatever it holds.
    let key = [text("action"), text("value")]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .replace(['\r', '\n'], " ");
    let sentence = serde_json::from_slice::<Value>(&response.body)
        .ok()
        .and_then(|answer| {
            answer
                .get("error")
                .and_then(Value::as_str)
                .map(String::from)
        })
        .unwrap_or_default()
        // The sentence can repeat what the profile sent: one line too.
        .replace(['\r', '\n'], " ");
    let route = path.trim_start_matches("/api/deck/");
    // One line a second at most for each key: a dial's turn is many refused
    // detents. The line counts the refusals it stands for.
    let since = {
        let mut tally = context
            .refused_keys
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Only a token holder can name actions the profile does not have;
        // the tally stays small whatever they send.
        if tally.len() >= 256 {
            tally.clear();
        }
        let entry = tally
            .entry(format!("{route} {}", text("action")))
            .or_insert((None, 0));
        if entry
            .0
            .is_some_and(|last| at.saturating_duration_since(last) < REFUSED_KEY_LOG_INTERVAL)
        {
            entry.1 += 1;
            return;
        }
        let since = entry.1;
        *entry = (Some(at), 0);
        since
    };
    let _ = append_log(
        &context.log_file_path,
        "WARN",
        &format!(
            "Stream Deck key {route} {} was refused ({}): {sentence}{}",
            if key.is_empty() { "(no action)" } else { &key },
            response.status_code,
            if since > 0 {
                format!(" ({since} more of this key refused since the last line)")
            } else {
                String::new()
            }
        ),
    );
}

/// Closes without resetting: the response is written, so signal the end of
/// our side and swallow (a bounded amount of) whatever the client is still
/// sending before dropping the socket. Dropping with unread input makes the
/// kernel send RST, and some clients then discard the status they were owed.
fn finish_connection(mut stream: TcpStream) {
    let _ = stream.shutdown(Shutdown::Write);
    let _ = stream.set_read_timeout(Some(DRAIN_TIMEOUT));
    let mut discarded = 0_usize;
    let mut chunk = [0_u8; 4096];
    while discarded < DRAIN_LIMIT_BYTES {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(bytes_read) => discarded += bytes_read,
        }
    }
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    target: String,
    /// Header names lower-cased and values trimmed; the last value wins,
    /// except that conflicting `Content-Length` values are refused.
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

impl HttpRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }
}

struct HttpResponse {
    status_code: u16,
    body: Vec<u8>,
}

impl HttpResponse {
    fn from_error(error: &ControlSurfaceError) -> Self {
        HttpResponse {
            status_code: error.status_code(),
            body: serde_json::to_vec(&json!({ "error": error.message() }))
                .unwrap_or_else(|_| b"{\"error\":\"bridge failure\"}".to_vec()),
        }
    }
}

/// A request reader that can be told how long the next read may wait. A
/// `TcpStream` maps it onto its read timeout; test doubles ignore it.
trait RequestSource: Read {
    fn limit_wait(&mut self, _remaining: Duration) {}
}

impl RequestSource for TcpStream {
    fn limit_wait(&mut self, remaining: Duration) {
        let _ = self.set_read_timeout(Some(remaining.max(Duration::from_millis(10))));
    }
}

/// Reads one request under the limits: at most `MAX_HEADER_BYTES` before the
/// header terminator (431), a body only with a usable `Content-Length` (411)
/// of at most `MAX_BODY_BYTES` (413), and everything within `deadline` (408).
fn read_http_request<R: RequestSource>(
    reader: &mut R,
    deadline: Instant,
) -> Result<HttpRequest, ControlSurfaceError> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];

    let header_end = loop {
        if let Some(position) = find_header_end(&buffer) {
            break position + 4;
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Err(ControlSurfaceError::HeadersTooLarge(format!(
                "Request headers exceed the bridge limit of {MAX_HEADER_BYTES} bytes"
            )));
        }
        let bytes_read = read_within_deadline(reader, &mut chunk, deadline)?;
        if bytes_read == 0 {
            return Err(ControlSurfaceError::InvalidParams(String::from(
                "Malformed HTTP request: the connection closed before the headers ended",
            )));
        }
        buffer.extend_from_slice(&chunk[..bytes_read]);
    };

    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| ControlSurfaceError::InvalidParams(String::from("Missing request line")))?;
    let (method, target) = parse_request_line(request_line)?;
    let headers = parse_header_lines(lines)?;

    if headers.contains_key("transfer-encoding") {
        return Err(ControlSurfaceError::LengthRequired(String::from(
            "Transfer-Encoding is not supported by the bridge; send a Content-Length",
        )));
    }
    let content_length = match headers.get("content-length") {
        Some(value) => value.parse::<usize>().map_err(|_| {
            ControlSurfaceError::LengthRequired(format!("Invalid Content-Length: {value}"))
        })?,
        None if method == "POST" => {
            return Err(ControlSurfaceError::LengthRequired(String::from(
                "POST requests must carry a Content-Length",
            )))
        }
        None => 0,
    };
    if content_length > MAX_BODY_BYTES {
        return Err(ControlSurfaceError::TooLarge(format!(
            "Request body of {content_length} bytes exceeds the bridge limit of {MAX_BODY_BYTES} bytes"
        )));
    }

    while buffer.len() < header_end + content_length {
        let bytes_read = read_within_deadline(reader, &mut chunk, deadline)?;
        if bytes_read == 0 {
            return Err(ControlSurfaceError::InvalidParams(String::from(
                "Malformed HTTP request: the body ended before Content-Length bytes arrived",
            )));
        }
        buffer.extend_from_slice(&chunk[..bytes_read]);
    }

    let mut body = buffer.split_off(header_end);
    body.truncate(content_length);

    Ok(HttpRequest {
        method,
        target,
        headers,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn read_within_deadline<R: RequestSource>(
    reader: &mut R,
    chunk: &mut [u8],
    deadline: Instant,
) -> Result<usize, ControlSurfaceError> {
    let now = Instant::now();
    if now >= deadline {
        return Err(request_timeout());
    }
    reader.limit_wait(deadline - now);
    match reader.read(chunk) {
        Ok(bytes_read) => Ok(bytes_read),
        Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
            Err(request_timeout())
        }
        Err(error) => Err(ControlSurfaceError::InvalidParams(format!(
            "Failed to read the request: {error}"
        ))),
    }
}

fn request_timeout() -> ControlSurfaceError {
    ControlSurfaceError::Timeout(format!(
        "The request did not arrive within {} ms",
        REQUEST_DEADLINE.as_millis()
    ))
}

fn parse_request_line(line: &str) -> Result<(String, String), ControlSurfaceError> {
    let mut parts = line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| ControlSurfaceError::InvalidParams(String::from("Missing HTTP method")))?;
    let target = parts
        .next()
        .ok_or_else(|| ControlSurfaceError::InvalidParams(String::from("Missing HTTP target")))?;
    let version = parts
        .next()
        .ok_or_else(|| ControlSurfaceError::InvalidParams(String::from("Missing HTTP version")))?;
    if !version.starts_with("HTTP/1.") || parts.next().is_some() {
        return Err(ControlSurfaceError::InvalidParams(format!(
            "Unsupported request line: {line}"
        )));
    }
    Ok((method.to_string(), target.to_string()))
}

fn parse_header_lines<'a>(
    lines: impl Iterator<Item = &'a str>,
) -> Result<HashMap<String, String>, ControlSurfaceError> {
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(ControlSurfaceError::InvalidParams(format!(
                "Malformed header line: {line}"
            )));
        };
        let name = name.trim().to_ascii_lowercase();
        if name.is_empty() || name.chars().any(char::is_whitespace) {
            return Err(ControlSurfaceError::InvalidParams(String::from(
                "Malformed header name",
            )));
        }
        let value = value.trim().to_string();
        if name == "content-length"
            && headers
                .get(&name)
                .is_some_and(|existing| existing != &value)
        {
            return Err(ControlSurfaceError::InvalidParams(String::from(
                "Conflicting Content-Length headers",
            )));
        }
        headers.insert(name, value);
    }
    Ok(headers)
}

/// Every route, before anything else: no browser origin (403), a `Host` that
/// names this bridge (400), and the workstation's bearer token (401), compared
/// in constant time.
fn authorize(request: &HttpRequest, token: &str, port: u16) -> Result<(), ControlSurfaceError> {
    if request.header("origin").is_some() {
        return Err(ControlSurfaceError::Forbidden(String::from(
            "Browser requests are not accepted by the bridge",
        )));
    }

    let expected_hosts = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    let host_matches = request.header("host").is_some_and(|host| {
        expected_hosts
            .iter()
            .any(|expected| host.eq_ignore_ascii_case(expected))
    });
    if !host_matches {
        return Err(ControlSurfaceError::InvalidParams(format!(
            "Host must be 127.0.0.1:{port} or localhost:{port}"
        )));
    }

    let presented = request.header("authorization").and_then(|value| {
        let (scheme, credential) = value.split_once(' ')?;
        scheme
            .eq_ignore_ascii_case("bearer")
            .then(|| credential.trim())
    });
    match presented {
        Some(credential) if constant_time_eq(credential.as_bytes(), token.as_bytes()) => Ok(()),
        Some(_) => Err(ControlSurfaceError::Unauthorized(String::from(
            "The bridge token does not match this workstation. Export the Stream Deck profile again from Setup and import it with Full Reset & Import.",
        ))),
        None => Err(ControlSurfaceError::Unauthorized(String::from(
            "A bearer token is required. Export the Stream Deck profile from Setup and import it with Full Reset & Import.",
        ))),
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (a, b) in left.iter().zip(right) {
        difference |= a ^ b;
    }
    difference == 0
}

fn route_control_surface_request(
    db_path: &Path,
    cameras_simulated: bool,
    request: &HttpRequest,
    arrived: Instant,
) -> HttpResponse {
    let (path, query) = split_target(&request.target);

    let result = match (request.method.as_str(), path) {
        ("GET", "/api/deck/context") => read_control_surface_context(db_path),
        ("GET", "/api/deck/lcd") => {
            let key = query_parameter(query, "key").ok_or_else(|| {
                ControlSurfaceError::InvalidParams(String::from("Missing ?key= parameter"))
            });
            key.and_then(|key| {
                read_deck_lcd_text(db_path, cameras_simulated, &key).map(Value::String)
            })
        }
        // New pages program, Slice 2: `POST /api/deck/action`, the PROJECTS
        // and TASKS keys' route, left with Planning. One route a page (D5).
        ("POST", "/api/deck/light-action")
        | ("POST", "/api/deck/audio-action")
        | ("POST", "/api/deck/camera-action")
        | ("POST", "/api/deck/prompter-action") => {
            parse_json_body(&request.body).and_then(|body| {
                handle_deck_http_action_at(db_path, cameras_simulated, path, &body, arrived)
            })
        }
        _ => Err(ControlSurfaceError::InvalidParams(format!(
            "Unsupported bridge endpoint: {} {}",
            request.method, path
        ))),
    };

    match result {
        Ok(value) => HttpResponse {
            status_code: 200,
            body: serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec()),
        },
        Err(error) => HttpResponse::from_error(&error),
    }
}

fn write_http_response(
    stream: &mut TcpStream,
    status_code: u16,
    body: &[u8],
) -> Result<(), std::io::Error> {
    let status_text = match status_code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        408 => "Request Timeout",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let challenge = if status_code == 401 {
        "WWW-Authenticate: Bearer realm=\"studio-control\"\r\n"
    } else {
        ""
    };
    let headers = format!(
        "HTTP/1.1 {status_code} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{challenge}Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn split_target(target: &str) -> (&str, &str) {
    target.split_once('?').unwrap_or((target, ""))
}

fn query_parameter(query: &str, name: &str) -> Option<String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find_map(|(key, value)| (percent_decode(key) == name).then(|| percent_decode(value)))
}

/// Decodes `%XX` escapes and `+` (a space in a query string). An escape that
/// is not two hex digits is kept as it came (finding F28).
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'%' {
            if let (Some(high), Some(low)) = (
                bytes.get(index + 1).and_then(hex_value),
                bytes.get(index + 2).and_then(hex_value),
            ) {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        decoded.push(if byte == b'+' { b' ' } else { byte });
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(byte: &u8) -> Option<u8> {
    (*byte as char).to_digit(16).map(|digit| digit as u8)
}

fn parse_json_body(body: &[u8]) -> Result<Value, ControlSurfaceError> {
    if body.is_empty() {
        return Ok(json!({}));
    }

    serde_json::from_slice(body)
        .map_err(|error| ControlSurfaceError::InvalidParams(error.to_string()))
}

// Property tests for the request reader and the query decoder (Slice 13).
#[cfg(test)]
mod fuzz;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_surface::control_surface_last_event;
    use crate::control_surface::test_support::{ready_audio_test_db, TestDir};
    use std::io::Cursor;

    const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    impl<T: AsRef<[u8]>> RequestSource for Cursor<T> {}

    /// Delivers its bytes, then stalls: once the buffered data is gone every
    /// read reports a timeout, as a `TcpStream` does when its read timeout
    /// expires with nothing arriving.
    struct StallingClient {
        data: Cursor<Vec<u8>>,
    }

    impl Read for StallingClient {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let bytes_read = self.data.read(buffer)?;
            if bytes_read == 0 {
                return Err(std::io::Error::new(ErrorKind::TimedOut, "client stalled"));
            }
            Ok(bytes_read)
        }
    }

    impl RequestSource for StallingClient {}

    trait UnwrapErrOrPanic<E> {
        fn unwrap_err_or_panic(self, message: &str) -> E;
    }

    impl<T, E> UnwrapErrOrPanic<E> for Result<T, E> {
        fn unwrap_err_or_panic(self, message: &str) -> E {
            match self {
                Ok(_) => panic!("{message}"),
                Err(error) => error,
            }
        }
    }

    fn far_deadline() -> Instant {
        Instant::now() + Duration::from_secs(5)
    }

    fn request_bytes(text: &str) -> Cursor<Vec<u8>> {
        Cursor::new(text.as_bytes().to_vec())
    }

    fn request_with(
        method: &str,
        target: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> HttpRequest {
        HttpRequest {
            method: method.to_string(),
            target: target.to_string(),
            headers: headers
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
            body: body.to_vec(),
        }
    }

    #[test]
    fn read_http_request_parses_headers_lower_cased_and_body() {
        let mut client = request_bytes(
            "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nAuthorization: Bearer abc\r\nContent-Length: 17\r\n\r\n{\"action\":\"next\"}",
        );
        let request = read_http_request(&mut client, far_deadline()).expect("request should parse");
        assert_eq!(request.method, "POST");
        assert_eq!(request.target, "/api/deck/action");
        assert_eq!(request.header("host"), Some("127.0.0.1:38201"));
        assert_eq!(request.header("authorization"), Some("Bearer abc"));
        assert_eq!(request.body, b"{\"action\":\"next\"}");
    }

    #[test]
    fn read_http_request_rejects_body_over_cap() {
        let mut client = request_bytes(
            "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nContent-Length: 17408\r\n\r\n",
        );
        let error =
            read_http_request(&mut client, far_deadline()).expect_err("17 KiB must be refused");
        assert!(
            matches!(error, ControlSurfaceError::TooLarge(_)),
            "{error:?}"
        );
        assert_eq!(error.status_code(), 413);

        let mut absurd = request_bytes(
            "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nContent-Length: 99999999\r\n\r\nshort",
        );
        assert_eq!(
            read_http_request(&mut absurd, far_deadline())
                .expect_err("a declared length over the cap is refused before any body is read")
                .status_code(),
            413
        );
    }

    #[test]
    fn read_http_request_rejects_oversized_headers() {
        let mut text = String::from("GET /api/deck/context HTTP/1.1\r\n");
        while text.len() <= MAX_HEADER_BYTES + 1024 {
            text.push_str("X-Padding: ");
            text.push_str(&"a".repeat(120));
            text.push_str("\r\n");
        }
        let mut client = request_bytes(&text);
        let error = read_http_request(&mut client, far_deadline())
            .expect_err("headers past the cap must be refused");
        assert!(
            matches!(error, ControlSurfaceError::HeadersTooLarge(_)),
            "{error:?}"
        );
        assert_eq!(error.status_code(), 431);
    }

    #[test]
    fn read_http_request_rejects_post_without_content_length() {
        let mut client = request_bytes(
            "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\n\r\n{\"action\":\"x\"}",
        );
        let error = read_http_request(&mut client, far_deadline())
            .expect_err("a POST without Content-Length must be refused");
        assert!(
            matches!(error, ControlSurfaceError::LengthRequired(_)),
            "{error:?}"
        );
        assert_eq!(error.status_code(), 411);
    }

    #[test]
    fn read_http_request_rejects_chunked_transfer_encoding() {
        let mut client = request_bytes(
            "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
        );
        let error = read_http_request(&mut client, far_deadline())
            .expect_err("chunked bodies must be refused");
        assert_eq!(error.status_code(), 411);
    }

    #[test]
    fn read_http_request_times_out_on_short_body() {
        let mut client = StallingClient {
            data: request_bytes(
                "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nContent-Length: 4000\r\n\r\n{\"action\":",
            ),
        };
        let error = read_http_request(&mut client, far_deadline())
            .expect_err("a body that stops arriving must time out");
        assert!(
            matches!(error, ControlSurfaceError::Timeout(_)),
            "{error:?}"
        );
        assert_eq!(error.status_code(), 408);
    }

    #[test]
    fn read_http_request_honours_the_deadline() {
        let mut client =
            request_bytes("GET /api/deck/context HTTP/1.1\r\nHost: 127.0.0.1:38201\r\n\r\n");
        let expired = Instant::now()
            .checked_sub(Duration::from_millis(1))
            .unwrap_or_else(Instant::now);
        let error = read_http_request(&mut client, expired)
            .expect_err("an expired deadline refuses even a request that is ready");
        assert_eq!(error.status_code(), 408);
    }

    #[test]
    fn read_http_request_rejects_a_truncated_body() {
        let mut client = request_bytes(
            "POST /api/deck/action HTTP/1.1\r\nHost: 127.0.0.1:38201\r\nContent-Length: 40\r\n\r\n{\"a\":",
        );
        let error = read_http_request(&mut client, far_deadline())
            .expect_err("a connection closed mid-body is malformed");
        assert_eq!(error.status_code(), 400);
    }

    #[test]
    fn authorize_rejects_missing_bearer() {
        let request = request_with(
            "GET",
            "/api/deck/context",
            &[("host", "127.0.0.1:38201")],
            b"",
        );
        let error = authorize(&request, TEST_TOKEN, 38201).expect_err("no token must be refused");
        assert!(
            matches!(error, ControlSurfaceError::Unauthorized(_)),
            "{error:?}"
        );
        assert_eq!(error.status_code(), 401);
    }

    #[test]
    fn authorize_rejects_wrong_token() {
        for credential in [
            format!("Bearer {}", TEST_TOKEN.replace('0', "1")),
            format!("Bearer {}", &TEST_TOKEN[..32]),
            format!("Bearer {TEST_TOKEN}0"),
            format!("Basic {TEST_TOKEN}"),
            String::from("Bearer"),
        ] {
            let request = request_with(
                "GET",
                "/api/deck/context",
                &[("host", "127.0.0.1:38201"), ("authorization", &credential)],
                b"",
            );
            let error = authorize(&request, TEST_TOKEN, 38201)
                .unwrap_err_or_panic(&format!("{credential} must be refused"));
            assert_eq!(error.status_code(), 401, "{credential}");
        }
    }

    #[test]
    fn authorize_rejects_origin() {
        let bearer = format!("Bearer {TEST_TOKEN}");
        let request = request_with(
            "GET",
            "/api/deck/context",
            &[
                ("host", "127.0.0.1:38201"),
                ("authorization", &bearer),
                ("origin", "http://127.0.0.1:38201"),
            ],
            b"",
        );
        let error = authorize(&request, TEST_TOKEN, 38201)
            .expect_err("a browser origin is refused even with the token");
        assert!(
            matches!(error, ControlSurfaceError::Forbidden(_)),
            "{error:?}"
        );
        assert_eq!(error.status_code(), 403);
    }

    #[test]
    fn authorize_rejects_foreign_host() {
        let bearer = format!("Bearer {TEST_TOKEN}");
        for host in [
            "studio-pc.local:38201",
            "127.0.0.1:38202",
            "127.0.0.1",
            "192.168.10.5:38201",
        ] {
            let request = request_with(
                "GET",
                "/api/deck/context",
                &[("host", host), ("authorization", &bearer)],
                b"",
            );
            let error = authorize(&request, TEST_TOKEN, 38201)
                .unwrap_err_or_panic(&format!("{host} must be refused"));
            assert_eq!(error.status_code(), 400, "{host}");
        }
        let without_host = request_with(
            "GET",
            "/api/deck/context",
            &[("authorization", &bearer)],
            b"",
        );
        assert_eq!(
            authorize(&without_host, TEST_TOKEN, 38201)
                .expect_err("a request without Host is refused")
                .status_code(),
            400
        );
    }

    #[test]
    fn authorize_accepts_loopback_hosts_with_the_token() {
        let bearer = format!("bearer {TEST_TOKEN}");
        for host in ["127.0.0.1:38201", "localhost:38201", "LOCALHOST:38201"] {
            let request = request_with(
                "POST",
                "/api/deck/action",
                &[("host", host), ("authorization", &bearer)],
                b"{}",
            );
            authorize(&request, TEST_TOKEN, 38201)
                .unwrap_or_else(|error| panic!("{host}: {error:?}"));
        }
    }

    #[test]
    fn authorization_precedes_body_parsing() {
        let test_dir = ready_audio_test_db("auth-before-body");
        let context = BridgeContext::new(
            test_dir.db_path(),
            test_dir.path().join("engine.log"),
            TEST_TOKEN.to_string(),
            38201,
        );

        // New pages program, Slice 2: on the lighting route, which parses its
        // body; the Planning route this used (`/api/deck/action`) left, and a
        // route the bridge does not have is refused before any body is read.
        let anonymous = request_with(
            "POST",
            "/api/deck/light-action",
            &[("host", "127.0.0.1:38201")],
            b"not json at all",
        );
        assert_eq!(
            respond(&context, Ok(anonymous)).status_code,
            401,
            "without a token the body is never looked at"
        );

        let bearer = format!("Bearer {TEST_TOKEN}");
        let authenticated = request_with(
            "POST",
            "/api/deck/light-action",
            &[("host", "127.0.0.1:38201"), ("authorization", &bearer)],
            b"not json at all",
        );
        let malformed = respond(&context, Ok(authenticated));
        assert_eq!(
            malformed.status_code, 400,
            "with the token the same body is parsed and refused as malformed"
        );
        let malformed_body = String::from_utf8_lossy(&malformed.body);
        assert!(
            !malformed_body.contains("Unsupported bridge endpoint"),
            "the body was refused, not the route: {malformed_body}"
        );

        assert_eq!(
            respond(&context, Err(request_timeout())).status_code,
            408,
            "a read failure keeps its own status"
        );
        assert!(control_surface_last_event(test_dir.db_path().as_path()).is_null());
    }

    // New pages program, Slice 2: `POST /api/deck/action` carried the PROJECTS
    // and TASKS keys (filters, statuses, the task timer, new projects). It is
    // not a bridge endpoint any more, with or without the token, and a key an
    // old profile still sends there changes nothing.
    #[test]
    fn the_planning_keys_route_is_not_a_bridge_endpoint() {
        let test_dir = ready_audio_test_db("planning-route");
        let context = BridgeContext::new(
            test_dir.db_path(),
            test_dir.path().join("engine.log"),
            TEST_TOKEN.to_string(),
            38201,
        );
        let bearer = format!("Bearer {TEST_TOKEN}");
        for body in [
            &b"{\"action\":\"nextSort\"}"[..],
            b"{\"action\":\"createProject\"}",
            b"{\"action\":\"toggleTimer\"}",
        ] {
            let request = request_with(
                "POST",
                "/api/deck/action",
                &[("host", "127.0.0.1:38201"), ("authorization", &bearer)],
                body,
            );
            let response = respond(&context, Ok(request));
            let text = String::from_utf8_lossy(&response.body);
            assert_eq!(response.status_code, 400, "{text}");
            assert!(
                text.contains("Unsupported bridge endpoint: POST /api/deck/action"),
                "{text}"
            );
        }
        assert!(control_surface_last_event(test_dir.db_path().as_path()).is_null());
    }

    #[test]
    fn query_parameter_decodes_percent() {
        assert_eq!(
            query_parameter("key=audio%5Fstrip%5F1", "key").as_deref(),
            Some("audio_strip_1")
        );
        assert_eq!(
            query_parameter("key=light%2Fnav", "key").as_deref(),
            Some("light/nav")
        );
        assert_eq!(
            query_parameter("other=1&key=a%20b+c", "key").as_deref(),
            Some("a b c")
        );
        assert_eq!(
            query_parameter("k%65y=light_nav", "key").as_deref(),
            Some("light_nav"),
            "the parameter name decodes too"
        );
        assert_eq!(
            query_parameter("key=100%zz", "key").as_deref(),
            Some("100%zz"),
            "an incomplete escape is kept as it came"
        );
        assert_eq!(query_parameter("key=%C3%A5", "key").as_deref(), Some("å"));
        assert_eq!(query_parameter("other=1", "key"), None);
    }

    #[test]
    fn token_file_is_created_once_and_reused() {
        let test_dir = TestDir::new("token-file");
        let first = load_or_create_bridge_token(test_dir.path())
            .expect("the first launch creates the token");
        assert!(is_bridge_token(&first), "{first}");
        let token_path = test_dir.path().join(CONTROL_SURFACE_TOKEN_FILE_NAME);
        assert_eq!(
            fs::read_to_string(&token_path).expect("token file").trim(),
            first
        );

        let second = load_or_create_bridge_token(test_dir.path()).expect("later launches reuse it");
        assert_eq!(second, first);

        let other_install = TestDir::new("token-file-other");
        let other = load_or_create_bridge_token(other_install.path())
            .expect("another install gets its own token");
        assert_ne!(other, first);
    }

    #[test]
    fn token_file_with_junk_is_regenerated() {
        let test_dir = TestDir::new("token-junk");
        let token_path = test_dir.path().join(CONTROL_SURFACE_TOKEN_FILE_NAME);
        fs::write(&token_path, "not a token\n").expect("junk file");
        let token =
            load_or_create_bridge_token(test_dir.path()).expect("a damaged file is replaced");
        assert!(is_bridge_token(&token), "{token}");
        assert_eq!(
            fs::read_to_string(&token_path).expect("token file").trim(),
            token
        );
    }

    fn start_test_bridge(test_dir: &TestDir, workers: usize, queue: usize) -> u16 {
        let listener = TcpListener::bind((DEFAULT_CONTROL_SURFACE_HOST, 0))
            .expect("an ephemeral loopback port");
        let port = listener.local_addr().expect("local address").port();
        let context = Arc::new(
            BridgeContext::new(
                test_dir.db_path(),
                test_dir.path().join("engine.log"),
                TEST_TOKEN.to_string(),
                port,
            )
            .with_cameras_simulated(true),
        );
        thread::spawn(move || run_control_surface_bridge(listener, context, workers, queue));
        port
    }

    /// Sends raw bytes and returns everything the bridge answered before it
    /// closed the connection.
    fn raw_request(port: u16, request: &str) -> String {
        let mut stream = TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("read timeout");
        stream.write_all(request.as_bytes()).expect("write");
        let mut response = Vec::new();
        let _ = stream.read_to_end(&mut response);
        String::from_utf8_lossy(&response).into_owned()
    }

    fn status_of(response: &str) -> u16 {
        response
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0)
    }

    #[test]
    fn bridge_refuses_unauthenticated_requests_and_serves_authenticated_ones() {
        let test_dir = ready_audio_test_db("bridge-auth");
        let port = start_test_bridge(&test_dir, 2, 4);
        let host = format!("127.0.0.1:{port}");

        // A key the bridge would serve with the token (new pages program,
        // Slice 2: it was the Planning route's `deleteProject`, which left).
        let anonymous = raw_request(
            port,
            &format!(
                "POST /api/deck/light-action HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: 28\r\n\r\n{{\"action\":\"selectNextScene\"}}"
            ),
        );
        assert_eq!(status_of(&anonymous), 401, "{anonymous}");
        assert!(
            anonymous.contains("WWW-Authenticate: Bearer"),
            "{anonymous}"
        );

        let wrong = raw_request(
            port,
            &format!(
                "GET /api/deck/context HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer nope\r\n\r\n"
            ),
        );
        assert_eq!(status_of(&wrong), 401, "{wrong}");

        let browser = raw_request(
            port,
            &format!(
                "GET /api/deck/context HTTP/1.1\r\nHost: {host}\r\nOrigin: http://127.0.0.1:{port}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
            ),
        );
        assert_eq!(status_of(&browser), 403, "{browser}");

        let foreign_host = raw_request(
            port,
            &format!(
                "GET /api/deck/context HTTP/1.1\r\nHost: studio-pc.local:{port}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
            ),
        );
        assert_eq!(status_of(&foreign_host), 400, "{foreign_host}");

        let oversized = raw_request(
            port,
            &format!(
                "POST /api/deck/action HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\nContent-Length: 17408\r\n\r\n"
            ),
        );
        assert_eq!(status_of(&oversized), 413, "{oversized}");

        let stalled_at = Instant::now();
        let stalled = raw_request(
            port,
            &format!(
                "POST /api/deck/action HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\nContent-Length: 4000\r\n\r\n{{\"action\":"
            ),
        );
        assert_eq!(status_of(&stalled), 408, "{stalled}");
        assert!(
            stalled_at.elapsed() < Duration::from_millis(2500),
            "the 408 must arrive on the deadline, took {:?}",
            stalled_at.elapsed()
        );

        let context = raw_request(
            port,
            &format!(
                "GET /api/deck/context HTTP/1.1\r\nHost: localhost:{port}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
            ),
        );
        assert_eq!(status_of(&context), 200, "{context}");
        // New pages program, Slice 2: the context's Planning selection (and its
        // `projectCount`) left; the audio deck block's strips mark the body.
        assert!(context.contains("\"strips\""), "{context}");

        let decoded = raw_request(
            port,
            &format!(
                "GET /api/deck/lcd?key=audio%2Fstrip_1 HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
            ),
        );
        assert_eq!(status_of(&decoded), 400, "{decoded}");
        assert!(
            decoded.contains("audio/strip_1"),
            "the key must reach the handler decoded: {decoded}"
        );

        let lcd = raw_request(
            port,
            &format!(
                "GET /api/deck/lcd?key=audio%5Fstrip%5F1 HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
            ),
        );
        assert_eq!(status_of(&lcd), 200, "{lcd}");

        assert!(
            control_surface_last_event(test_dir.db_path().as_path()).is_null(),
            "no refused request reached a handler"
        );
    }

    #[test]
    fn worker_pool_returns_503_when_saturated() {
        let test_dir = ready_audio_test_db("bridge-saturated");
        let port = start_test_bridge(&test_dir, 1, 1);

        // One idle connection occupies the only worker; the next fills the only
        // queue slot; the third finds the queue full.
        let _busy_worker =
            TcpStream::connect((DEFAULT_CONTROL_SURFACE_HOST, port)).expect("connect");
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

    // The CAMERAS and PROMPTER pages over the wire: a key of each is pressed
    // as Companion presses it, and answered as the page's own entry point
    // answers. The cameras are the simulated ones (D15).
    #[test]
    fn the_cameras_and_the_prompter_keys_are_pressed_over_the_wire() {
        let test_dir = ready_audio_test_db("bridge-page-keys");
        let port = start_test_bridge(&test_dir, 2, 4);
        let host = format!("127.0.0.1:{port}");
        let post = |route: &str, body: &str| {
            raw_request(
                port,
                &format!(
                    "POST {route} HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                ),
            )
        };
        let get = |key: &str| {
            raw_request(
                port,
                &format!(
                    "GET /api/deck/lcd?key={key} HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {TEST_TOKEN}\r\n\r\n"
                ),
            )
        };

        let selected = post(
            "/api/deck/camera-action",
            r#"{"action":"select","value":"2"}"#,
        );
        assert_eq!(status_of(&selected), 200, "{selected}");
        assert!(selected.contains(r#""did":"select""#), "{selected}");
        assert!(selected.contains(r#""selected":2"#), "{selected}");
        let display = get("camera_state_selected");
        assert_eq!(status_of(&display), 200, "{display}");
        assert!(display.ends_with("\"2\""), "{display}");

        let bank = post("/api/deck/camera-action", r#"{"action":"bank"}"#);
        assert_eq!(status_of(&bank), 200, "{bank}");
        assert!(bank.contains(r#""bank":"colour""#), "{bank}");

        // New saved data holds no camera: a dial is refused in the cameras'
        // own words, and nothing is on the prompter.
        let dial = post(
            "/api/deck/camera-action",
            r#"{"action":"dial","value":"1:up"}"#,
        );
        assert_eq!(status_of(&dial), 409, "{dial}");
        let play = post("/api/deck/prompter-action", r#"{"action":"playPause"}"#);
        assert_eq!(status_of(&play), 409, "{play}");
        assert!(
            play.contains("Nothing is on the prompter. Put a script on first."),
            "{play}"
        );
        let unknown = post("/api/deck/prompter-action", r#"{"action":"rec"}"#);
        assert_eq!(status_of(&unknown), 400, "{unknown}");
        let display = get("prompter_name");
        assert_eq!(status_of(&display), 200, "{display}");

        // Without the token a key of the new pages is refused as any other.
        let anonymous = raw_request(
            port,
            &format!(
                "POST /api/deck/camera-action HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: 16\r\n\r\n{{\"action\":\"rec\"}}"
            ),
        );
        assert_eq!(status_of(&anonymous), 401, "{anonymous}");

        // A key a page refused is one line in the log, with the key and the
        // page's sentence (2026-09-28); a key that acted, a display's read
        // and the bridge's own refusal (the token) are none.
        let log = fs::read_to_string(test_dir.path().join("engine.log")).unwrap_or_default();
        let refused = log
            .lines()
            .filter(|line| line.contains("Stream Deck key"))
            .collect::<Vec<_>>();
        assert_eq!(refused.len(), 3, "{log}");
        assert!(
            refused[0].contains("WARN")
                && refused[0]
                    .contains("Stream Deck key camera-action dial 1:up was refused (409): "),
            "{log}"
        );
        assert!(
            refused[1].contains(
                "Stream Deck key prompter-action playPause was refused (409): Nothing is on the prompter. Put a script on first."
            ),
            "{log}"
        );
        assert!(
            refused[2].contains("Stream Deck key prompter-action rec was refused (400): "),
            "{log}"
        );
    }

    // The review of #254: a dial turned on a page that refuses it is many
    // refused detents. A key's line is written once a second at most, and
    // counts the refusals it stands for; another key has its own.
    #[test]
    fn a_refused_key_is_one_line_a_second_counting_the_rest() {
        let test_dir = TestDir::new("bridge-refused-key-rate");
        let log_path = test_dir.path().join("engine.log");
        let context = BridgeContext::new(
            test_dir.db_path(),
            log_path.clone(),
            TEST_TOKEN.to_string(),
            38201,
        );
        let refused = HttpResponse {
            status_code: 409,
            body: br#"{"error":"CAM 1 is released."}"#.to_vec(),
        };
        let press =
            |body: &str| request_with("POST", "/api/deck/camera-action", &[], body.as_bytes());
        let start = Instant::now();
        for tenth in 0..5 {
            note_refused_key(
                &context,
                &press(r#"{"action":"dial","value":"1:up"}"#),
                &refused,
                start + Duration::from_millis(100 * tenth),
            );
        }
        note_refused_key(&context, &press(r#"{"action":"rec"}"#), &refused, start);
        note_refused_key(
            &context,
            &press(r#"{"action":"dial","value":"1:down"}"#),
            &refused,
            start + Duration::from_millis(1_200),
        );
        let log = fs::read_to_string(&log_path).expect("the log");
        let lines = log
            .lines()
            .filter(|line| line.contains("Stream Deck key"))
            .collect::<Vec<_>>();
        assert_eq!(lines.len(), 3, "{log}");
        assert!(lines[0].contains("camera-action dial 1:up was refused (409): CAM 1 is released."));
        assert!(lines[1].contains("camera-action rec was refused (409)"));
        assert!(
            lines[2].contains("camera-action dial 1:down was refused (409): CAM 1 is released. (4 more of this key refused since the last line)"),
            "{log}"
        );
        // A display's read and a key that acted leave nothing.
        note_refused_key(
            &context,
            &request_with("GET", "/api/deck/lcd?key=camera_key_rec", &[], b""),
            &refused,
            start + Duration::from_secs(5),
        );
        let answered = HttpResponse {
            status_code: 200,
            body: b"{}".to_vec(),
        };
        note_refused_key(
            &context,
            &press(r#"{"action":"rec"}"#),
            &answered,
            start + Duration::from_secs(5),
        );
        let after = fs::read_to_string(&log_path).expect("the log");
        assert_eq!(
            after
                .lines()
                .filter(|line| line.contains("Stream Deck key"))
                .count(),
            3
        );
    }

    #[test]
    fn a_refusal_line_counts_the_refusals_it_stood_for() {
        let test_dir = TestDir::new("bridge-refusal-count");
        let log_path = test_dir.path().join("engine.log");
        let context = BridgeContext::new(
            test_dir.db_path(),
            log_path.clone(),
            TEST_TOKEN.to_string(),
            38201,
        );
        let start = Instant::now();
        let token_required = "A bearer token is required.";
        for tenth in 0..5 {
            context.note_rejection_at(
                401,
                token_required,
                start + Duration::from_millis(tenth * 100),
            );
        }
        context.note_rejection_at(503, "busy", start + Duration::from_secs(1));
        context.note_rejection_at(401, token_required, start + Duration::from_secs(61));
        context.note_rejection_at(401, token_required, start + Duration::from_secs(62));
        context.note_rejection_at(401, token_required, start + Duration::from_secs(122));

        let log = fs::read_to_string(&log_path).expect("the refusals were logged");
        let lines: Vec<&str> = log
            .lines()
            .filter(|line| line.contains("refused a request"))
            .collect();
        assert_eq!(lines.len(), 4, "{log}");
        assert!(
            lines[0].ends_with("(401): A bearer token is required."),
            "{log}"
        );
        assert!(lines[1].ends_with("(503): busy"), "{log}");
        assert!(
            lines[2].ends_with("(401): A bearer token is required. (4 more with this status since the last such line)"),
            "{log}"
        );
        assert!(
            lines[3].ends_with("(401): A bearer token is required. (1 more with this status since the last such line)"),
            "{log}"
        );
    }
}
