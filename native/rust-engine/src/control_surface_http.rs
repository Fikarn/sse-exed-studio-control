//! The HTTP transport of the control-surface bridge: the listener, the
//! per-install bearer token, the request limits, the worker pool and the
//! routing into `control_surface` (2026-09 production readiness, Slice 2 —
//! findings F01 bridge unauthenticated, F06 bridge DoS, F28 percent decoding).
//! What a deck action or an LCD key does lives in `control_surface` and
//! `control_surface_audio`; nothing here interprets a request beyond its
//! method, target, headers and body.

use crate::control_surface::{
    handle_control_surface_http_action, read_control_surface_context,
    read_control_surface_lcd_text, ControlSurfaceBridgeInfo, ControlSurfaceError,
    DEFAULT_CONTROL_SURFACE_HOST,
};
use crate::diagnostics::append_log;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, TrySendError};
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
const QUEUE_CAPACITY: usize = 16;
const REJECTION_LOG_INTERVAL: Duration = Duration::from_secs(60);

/// The bearer token the bridge demands on every request (finding F01):
/// `<app-data>/control-surface.token`, 64 hex characters from OS randomness,
/// created on the first launch of an install and reused afterwards (owner
/// read/write only where the platform has file modes). The exported Stream
/// Deck profile embeds it, which is why a profile exported before this landed
/// stops working and must be exported and imported again. Lanes override it
/// with `SSE_CONTROL_SURFACE_TOKEN`, which then leaves the file alone.
pub fn load_or_create_bridge_token(app_data_dir: &Path) -> Result<String, String> {
    load_or_create_bridge_token_from(app_data_dir, |name| std::env::var_os(name))
}

fn load_or_create_bridge_token_from<F>(
    app_data_dir: &Path,
    mut get_env: F,
) -> Result<String, String>
where
    F: FnMut(&str) -> Option<OsString>,
{
    if let Some(value) = get_env("SSE_CONTROL_SURFACE_TOKEN") {
        let value = value
            .into_string()
            .map_err(|_| String::from("SSE_CONTROL_SURFACE_TOKEN is not valid UTF-8."))?;
        let value = value.trim();
        if !value.is_empty() {
            if value.chars().any(|c| c.is_whitespace() || c.is_control()) {
                return Err(String::from(
                    "SSE_CONTROL_SURFACE_TOKEN must not contain whitespace or control characters.",
                ));
            }
            return Ok(value.to_string());
        }
    }

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
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(token.as_bytes())?;
    file.write_all(b"\n")?;
    file.flush()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub fn start_control_surface_bridge(
    db_path: &Path,
    log_file_path: &Path,
    requested_port: u16,
    token: String,
) -> ControlSurfaceBridgeInfo {
    match bind_control_surface_listener(requested_port) {
        Ok(listener) => {
            let port = listener
                .local_addr()
                .map(|address| address.port())
                .unwrap_or(requested_port);
            let base_url = format!("http://{DEFAULT_CONTROL_SURFACE_HOST}:{port}");
            let summary = format!(
                "Native control-surface bridge is serving deck actions and LCD payloads at {base_url}."
            );

            let _ = append_log(log_file_path, "INFO", &summary);

            let context = Arc::new(BridgeContext::new(
                db_path.to_path_buf(),
                log_file_path.to_path_buf(),
                token,
                port,
            ));
            thread::spawn(move || {
                run_control_surface_bridge(listener, context, WORKER_COUNT, QUEUE_CAPACITY)
            });

            ControlSurfaceBridgeInfo {
                base_url,
                port,
                available: true,
                status: String::from("ready"),
                summary,
                error: None,
            }
        }
        Err(message) => ControlSurfaceBridgeInfo {
            base_url: format!("http://{DEFAULT_CONTROL_SURFACE_HOST}:{requested_port}"),
            port: requested_port,
            available: false,
            status: String::from("unavailable"),
            summary: format!(
                "Native control-surface bridge is unavailable because the listener could not bind: {message}"
            ),
            error: Some(message),
        },
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
    rejection_log: Mutex<HashMap<u16, Instant>>,
}

impl BridgeContext {
    fn new(db_path: PathBuf, log_file_path: PathBuf, token: String, port: u16) -> Self {
        Self {
            db_path,
            log_file_path,
            token,
            port,
            rejection_log: Mutex::new(HashMap::new()),
        }
    }

    /// A refused request is logged at most once per status per minute, so a
    /// flood of bad requests cannot become a flood of log lines (F06).
    fn note_rejection(&self, status_code: u16, message: &str) {
        let now = Instant::now();
        let should_log = {
            let mut recent = self
                .rejection_log
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match recent.get(&status_code) {
                Some(last) if now.duration_since(*last) < REJECTION_LOG_INTERVAL => false,
                _ => {
                    recent.insert(status_code, now);
                    true
                }
            }
        };
        if should_log {
            let _ = append_log(
                self.log_file_path.as_path(),
                "WARN",
                &format!("Control-surface bridge refused a request ({status_code}): {message}"),
            );
        }
    }
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
    let (sender, receiver) = sync_channel::<TcpStream>(queue_capacity.max(1));
    let receiver = Arc::new(Mutex::new(receiver));

    for index in 0..worker_count.max(1) {
        let receiver = Arc::clone(&receiver);
        let worker_context = Arc::clone(&context);
        let spawned = thread::Builder::new()
            .name(format!("control-surface-worker-{index}"))
            .spawn(move || loop {
                let next = receiver
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .recv();
                let Ok(stream) = next else {
                    break;
                };
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    handle_control_surface_connection(stream, &worker_context)
                }));
                match outcome {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        let _ = append_log(
                            worker_context.log_file_path.as_path(),
                            "WARN",
                            &format!(
                                "Control-surface bridge request failed: {}",
                                error.message()
                            ),
                        );
                    }
                    Err(_) => {
                        let _ = append_log(
                            worker_context.log_file_path.as_path(),
                            "ERROR",
                            "Control-surface bridge worker recovered from a panic while serving a request",
                        );
                    }
                }
            });
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
            Ok(stream) => match sender.try_send(stream) {
                Ok(()) => {}
                Err(TrySendError::Full(stream)) | Err(TrySendError::Disconnected(stream)) => {
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
) -> Result<(), ControlSurfaceError> {
    let deadline = Instant::now() + REQUEST_DEADLINE;
    let _ = stream.set_write_timeout(Some(RESPONSE_WRITE_TIMEOUT));
    let request = read_http_request(&mut stream, deadline);
    let response = respond(context, request);
    let written = write_http_response(&mut stream, response.status_code, &response.body);
    finish_connection(stream);
    written.map_err(|error| ControlSurfaceError::Storage(error.to_string()))
}

/// Authorization runs before anything in the request is interpreted: an
/// unauthenticated body is never parsed, whatever it says.
fn respond(
    context: &BridgeContext,
    request: Result<HttpRequest, ControlSurfaceError>,
) -> HttpResponse {
    let authorized = request
        .and_then(|request| authorize(&request, &context.token, context.port).map(|()| request));
    match authorized {
        Ok(request) => route_control_surface_request(&context.db_path, &request),
        Err(error) => {
            context.note_rejection(error.status_code(), error.message());
            HttpResponse::from_error(&error)
        }
    }
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

fn route_control_surface_request(db_path: &Path, request: &HttpRequest) -> HttpResponse {
    let (path, query) = split_target(&request.target);

    let result = match (request.method.as_str(), path) {
        ("GET", "/api/deck/context") => read_control_surface_context(db_path),
        ("GET", "/api/deck/lcd") => {
            let key = query_parameter(query, "key").ok_or_else(|| {
                ControlSurfaceError::InvalidParams(String::from("Missing ?key= parameter"))
            });
            key.and_then(|key| read_control_surface_lcd_text(db_path, &key).map(Value::String))
        }
        ("POST", "/api/deck/action")
        | ("POST", "/api/deck/light-action")
        | ("POST", "/api/deck/audio-action") => parse_json_body(&request.body)
            .and_then(|body| handle_control_surface_http_action(db_path, path, &body)),
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

        let anonymous = request_with(
            "POST",
            "/api/deck/action",
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
            "/api/deck/action",
            &[("host", "127.0.0.1:38201"), ("authorization", &bearer)],
            b"not json at all",
        );
        assert_eq!(
            respond(&context, Ok(authenticated)).status_code,
            400,
            "with the token the same body is parsed and refused as malformed"
        );

        assert_eq!(
            respond(&context, Err(request_timeout())).status_code,
            408,
            "a read failure keeps its own status"
        );
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
            query_parameter("k%65y=project_nav", "key").as_deref(),
            Some("project_nav"),
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
        let first = load_or_create_bridge_token_from(test_dir.path(), |_| None)
            .expect("the first launch creates the token");
        assert!(is_bridge_token(&first), "{first}");
        let token_path = test_dir.path().join(CONTROL_SURFACE_TOKEN_FILE_NAME);
        assert_eq!(
            fs::read_to_string(&token_path).expect("token file").trim(),
            first
        );

        let second = load_or_create_bridge_token_from(test_dir.path(), |_| None)
            .expect("later launches reuse it");
        assert_eq!(second, first);

        let other_install = TestDir::new("token-file-other");
        let other = load_or_create_bridge_token_from(other_install.path(), |_| None)
            .expect("another install gets its own token");
        assert_ne!(other, first);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&token_path)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn token_file_with_junk_is_regenerated() {
        let test_dir = TestDir::new("token-junk");
        let token_path = test_dir.path().join(CONTROL_SURFACE_TOKEN_FILE_NAME);
        fs::write(&token_path, "not a token\n").expect("junk file");
        let token = load_or_create_bridge_token_from(test_dir.path(), |_| None)
            .expect("a damaged file is replaced");
        assert!(is_bridge_token(&token), "{token}");
        assert_eq!(
            fs::read_to_string(&token_path).expect("token file").trim(),
            token
        );
    }

    #[test]
    fn token_env_override_wins_and_leaves_the_file_alone() {
        let test_dir = TestDir::new("token-env");
        let token = load_or_create_bridge_token_from(test_dir.path(), |name| {
            (name == "SSE_CONTROL_SURFACE_TOKEN").then(|| OsString::from("  lane-token-123  "))
        })
        .expect("the override is used");
        assert_eq!(token, "lane-token-123");
        assert!(!test_dir
            .path()
            .join(CONTROL_SURFACE_TOKEN_FILE_NAME)
            .exists());

        let error = load_or_create_bridge_token_from(test_dir.path(), |_| {
            Some(OsString::from("two words"))
        })
        .expect_err("whitespace inside the override is refused");
        assert!(error.contains("whitespace"), "{error}");

        let generated =
            load_or_create_bridge_token_from(test_dir.path(), |_| Some(OsString::from("   ")))
                .expect("an empty override is no override");
        assert!(is_bridge_token(&generated), "{generated}");
    }

    fn start_test_bridge(test_dir: &TestDir, workers: usize, queue: usize) -> u16 {
        let listener = TcpListener::bind((DEFAULT_CONTROL_SURFACE_HOST, 0))
            .expect("an ephemeral loopback port");
        let port = listener.local_addr().expect("local address").port();
        let context = Arc::new(BridgeContext::new(
            test_dir.db_path(),
            test_dir.path().join("engine.log"),
            TEST_TOKEN.to_string(),
            port,
        ));
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

        let anonymous = raw_request(
            port,
            &format!(
                "POST /api/deck/action HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: 26\r\n\r\n{{\"action\":\"deleteProject\"}}"
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
        assert!(context.contains("\"projectCount\""), "{context}");

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
}
