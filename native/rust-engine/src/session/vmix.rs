//! vMix's recording (the Session page's step 2, D52). vMix's API cannot set
//! where vMix records, so the running session's window copies the session's
//! vMix Recording path for vMix's Recording settings, and says whether the
//! file vMix reports is in the session's folder. The hardware link reads
//! vMix's state over its API on this PC, `GET /api` at 127.0.0.1:8088
//! (vMix's own port, not a setting), and only reads it: in the studio's
//! build alone, never in a simulated run (`places.rs`), so no test, lane,
//! development run or trial of the release asks vMix anything.
//!
//! The read is the Companion export's (`exports/profile.rs`): HTTP/1.0, so
//! vMix closes the connection, with a connect timeout added: 500 ms to
//! connect, 1 s for the whole answer, at most 2 MiB of it. vMix 29 answers
//! `<recording>False</recording>` with no `filename1` until it has recorded
//! once since its start (read on the studio PC on 2026-10-19), then names
//! the file it records to, and after a recording its last one.

use std::collections::VecDeque;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, SocketAddrV4, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

/// vMix's API on this PC.
pub(crate) const VMIX_API: SocketAddr =
    SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 8088));
const CONNECT_TIMEOUT: Duration = Duration::from_millis(500);
/// The whole answer's time, from the request on.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(1);
/// vMix's state is about 5 KB on the studio PC; an answer over this is not
/// read.
const ANSWER_MAX_BYTES: usize = 2 * 1024 * 1024;
/// A write rate needs looks this far apart.
const RATE_SPAN: Duration = Duration::from_secs(10);
/// And is taken over the last minute.
const RATE_WINDOW: Duration = Duration::from_secs(60);

/// What vMix's state says of its recording.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VmixRecording {
    pub recording: bool,
    /// `filename1`: the file it records to, or its last one; `None` when it
    /// names none.
    pub file: Option<String>,
}

/// One read of vMix's state at `address`; `None` when vMix does not answer
/// as vMix: no connection, no whole answer in time, an answer that is not a
/// `200` with vMix's state in it.
pub(crate) fn read_vmix(address: SocketAddr) -> Option<VmixRecording> {
    parse_vmix_state(&fetch_state(address)?)
}

/// `GET /api HTTP/1.0`, and the answer's body.
fn fetch_state(address: SocketAddr) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).ok()?;
    let deadline = Instant::now() + ANSWER_TIMEOUT;
    stream.set_write_timeout(Some(ANSWER_TIMEOUT)).ok()?;
    stream
        .write_all(
            format!(
                "GET /api HTTP/1.0\r\nHost: {address}\r\nAccept: text/xml\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .ok()?;
    let answer = read_answer(&mut stream, deadline);
    let _ = stream.shutdown(Shutdown::Both);
    body_of(&answer?)
}

/// The answer's bytes until vMix closes, the answer is whole, or the time
/// is up (`None`, as for an answer over the cap).
fn read_answer(stream: &mut TcpStream, deadline: Instant) -> Option<Vec<u8>> {
    let mut answer = Vec::new();
    let mut chunk = [0_u8; 16 * 1024];
    loop {
        let left = deadline
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())?;
        stream.set_read_timeout(Some(left)).ok()?;
        match stream.read(&mut chunk) {
            Ok(0) => return Some(answer),
            Ok(read) => {
                answer.extend_from_slice(&chunk[..read]);
                if answer.len() > ANSWER_MAX_BYTES {
                    return None;
                }
                if whole(&answer) {
                    return Some(answer);
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(_) => return None,
        }
    }
}

/// The headers and the body of an answer, split.
fn split(answer: &[u8]) -> Option<(&[u8], &[u8])> {
    let at = answer.windows(4).position(|four| four == b"\r\n\r\n")?;
    Some((&answer[..at], &answer[at + 4..]))
}

/// The answer's `Content-Length`, when it has one.
fn content_length(headers: &[u8]) -> Option<usize> {
    String::from_utf8_lossy(headers)
        .lines()
        .skip(1)
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse().ok()
            } else {
                None
            }
        })
}

/// Whether an answer vMix has not closed yet is whole: its body as long as
/// its `Content-Length`.
fn whole(answer: &[u8]) -> bool {
    split(answer).is_some_and(|(headers, body)| {
        content_length(headers).is_some_and(|length| body.len() >= length)
    })
}

/// The body of a `200`; `None` for any other answer.
fn body_of(answer: &[u8]) -> Option<String> {
    let (headers, body) = split(answer)?;
    let status = String::from_utf8_lossy(headers);
    let mut words = status.lines().next()?.split_whitespace();
    let (version, code) = (words.next()?, words.next()?);
    if !version.starts_with("HTTP/1.") || code != "200" {
        return None;
    }
    let body = match content_length(headers) {
        Some(length) => body.get(..length)?,
        None => body,
    };
    Some(String::from_utf8_lossy(body).into_owned())
}

/// The value of `element`'s attribute `name`, its entities read; a damaged
/// attribute ends the search.
fn attribute(element: &BytesStart<'_>, name: &str) -> Option<String> {
    let mut attributes = element.attributes();
    attributes.with_checks(false);
    attributes
        .map_while(Result::ok)
        .find(|attribute| attribute.key.into_inner() == name)
        .and_then(|attribute| {
            attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .ok()
                .map(|value| value.into_owned())
        })
}

/// What vMix's state XML says of its recording: the word of `<recording>`,
/// a child of `<vmix>` (`True` or `False`), and its `filename1`, its
/// entities read; `filename2` and everything else are passed over. `None`
/// for a text that is not vMix's state, or a word that is neither.
pub(crate) fn parse_vmix_state(xml: &str) -> Option<VmixRecording> {
    let mut reader = Reader::from_str(xml);
    let mut depth = 0_usize;
    let mut file = None;
    let mut word: Option<String> = None;
    let mut found = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                depth += 1;
                let name = element.name().into_inner();
                if depth == 1 && name != "vmix" {
                    return None;
                }
                if depth == 2 && name == "recording" && found.is_none() {
                    file = attribute(&element, "filename1").filter(|file| !file.is_empty());
                    word = Some(String::new());
                }
            }
            Ok(Event::Text(text)) => {
                if let Some(word) = word.as_mut() {
                    word.push_str(&text.xml10_content());
                }
            }
            Ok(Event::End(_)) => {
                if depth == 2 {
                    if let Some(word) = word.take() {
                        found = Some(match word.trim() {
                            said if said.eq_ignore_ascii_case("true") => true,
                            said if said.eq_ignore_ascii_case("false") => false,
                            _ => return None,
                        });
                    }
                }
                depth = depth.saturating_sub(1);
            }
            // `<vmix/>`: vMix's root with nothing in it.
            Ok(Event::Empty(_)) if depth == 0 => return None,
            Ok(Event::Eof) => break,
            Err(_) => return None,
            Ok(_) => {}
        }
    }
    found.map(|recording| VmixRecording { recording, file })
}

/// Whether `file` is inside `folder`, capitals aside and `\` and `/` alike,
/// as Windows reads paths.
pub(crate) fn in_folder(file: &str, folder: &str) -> bool {
    let read = |path: &str| path.replace('/', "\\").to_lowercase();
    let (file, folder) = (read(file), read(folder));
    let folder = folder.trim_end_matches('\\');
    !folder.is_empty()
        && file
            .strip_prefix(folder)
            .and_then(|rest| rest.strip_prefix('\\'))
            .is_some_and(|rest| !rest.is_empty())
}

/// The folder vMix should record to in a session's folder: its first
/// subfolder, by name, whose name holds `vmix` in any case, as the disk
/// writes it (`vMix Recording`), else the folder itself. `None` when the
/// folder cannot be listed.
pub(crate) fn recording_folder_in(folder: &Path) -> Option<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        })
        .filter_map(|entry| entry.file_name().to_str().map(String::from))
        .filter(|name| name.to_lowercase().contains("vmix"))
        .collect();
    names.sort_by_key(|name| name.to_lowercase());
    Some(match names.first() {
        Some(name) => folder.join(name).display().to_string(),
        None => folder.display().to_string(),
    })
}

/// How fast vMix's file grows while it records: its size at each look, over
/// the last minute, once two looks are 10 s apart. It starts again when the
/// file changes, the recording stops, or the file reads smaller.
#[derive(Debug, Default)]
pub(crate) struct WriteRate {
    file: Option<String>,
    looks: VecDeque<(Instant, u64)>,
}

impl WriteRate {
    /// Takes one look: whether vMix records, the file it names and that
    /// file's size (`None` when it could not be read), at `at`. Answers the
    /// rate in bytes a second, or `None` before two looks are 10 s apart.
    pub(crate) fn take(
        &mut self,
        recording: bool,
        file: Option<&str>,
        size: Option<u64>,
        at: Instant,
    ) -> Option<u64> {
        if !recording || file.is_none() || file != self.file.as_deref() {
            self.looks.clear();
            self.file = file.filter(|_| recording).map(String::from);
        }
        if !recording {
            return None;
        }
        let size = size?;
        if self.looks.back().is_some_and(|&(_, last)| size < last) {
            self.looks.clear();
        }
        self.looks.push_back((at, size));
        while self.looks.len() > 2
            && self
                .looks
                .get(1)
                .is_some_and(|&(second, _)| at.saturating_duration_since(second) >= RATE_WINDOW)
        {
            self.looks.pop_front();
        }
        let &(first_at, first) = self.looks.front()?;
        let span = at.saturating_duration_since(first_at);
        if span < RATE_SPAN {
            return None;
        }
        let grown = u128::from(size - first);
        u64::try_from(grown * 1_000 / span.as_millis().max(1)).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// vMix 29's state on the studio PC, cut to what matters here, with
    /// made-up names (the repository is public).
    fn state(recording: &str) -> String {
        format!(
            r#"<vmix><version>29.0.0.49</version><edition>Max</edition><preset>C:\Users\Studio\Desktop\2026 new.vmix</preset><inputs><input key="a1" number="1" type="Capture" title="CAM 1" state="Running">CAM 1</input></inputs><overlays><overlay number="1"/></overlays><preview>1</preview><active>1</active><fadeToBlack>False</fadeToBlack>{recording}<external>False</external><streaming>False</streaming><playList>False</playList><multiCorder>False</multiCorder><fullscreen>False</fullscreen><audio><master volume="100" muted="False"/></audio></vmix>"#
        )
    }

    #[test]
    fn vmix_before_its_first_recording_names_no_file() {
        assert_eq!(
            parse_vmix_state(&state("<recording>False</recording>")),
            Some(VmixRecording {
                recording: false,
                file: None
            })
        );
    }

    #[test]
    fn vmix_after_a_recording_names_its_last_file() {
        assert_eq!(
            parse_vmix_state(&state(
                r#"<recording filename1="D:\All\Old take (2026-10-15)\capture - 15 October 2026 - 09-23-54 am.avi">False</recording>"#
            )),
            Some(VmixRecording {
                recording: false,
                file: Some(String::from(
                    r"D:\All\Old take (2026-10-15)\capture - 15 October 2026 - 09-23-54 am.avi"
                )),
            })
        );
    }

    #[test]
    fn vmix_recording_names_the_file_it_records_to_and_its_second_is_passed_over() {
        assert_eq!(
            parse_vmix_state(&state(
                r#"<recording filename1="D:\Sessions\Morning take (2026-10-18)\vMix Recording\capture.avi" filename2="E:\backup.avi">True</recording>"#
            )),
            Some(VmixRecording {
                recording: true,
                file: Some(String::from(
                    r"D:\Sessions\Morning take (2026-10-18)\vMix Recording\capture.avi"
                )),
            })
        );
    }

    #[test]
    fn a_files_entities_are_read() {
        assert_eq!(
            parse_vmix_state(&state(
                r#"<recording filename1="D:\Sessions\Q&amp;A &quot;live&quot; &#233;t&#xE9; (2026-10-18)\a.avi">True</recording>"#
            ))
            .and_then(|read| read.file),
            Some(String::from(
                r#"D:\Sessions\Q&A "live" été (2026-10-18)\a.avi"#
            ))
        );
        // An empty name names nothing.
        assert_eq!(
            parse_vmix_state(&state(r#"<recording filename1="">False</recording>"#))
                .and_then(|read| read.file),
            None
        );
    }

    #[test]
    fn a_damaged_answer_or_another_document_is_not_vmixs_state() {
        for text in [
            String::new(),
            String::from("not xml at all"),
            String::from("<html><body>vMix</body></html>"),
            String::from("<vmix/>"),
            String::from("<vmix><version>29</version></vmix>"),
            state("<recording>Maybe</recording>"),
            state("<recording>False</record>"),
            String::from("<vmix><recording>True"),
        ] {
            assert_eq!(parse_vmix_state(&text), None, "{text:?}");
        }
        // A `recording` deeper down is an input's, not vMix's own.
        assert_eq!(
            parse_vmix_state("<vmix><inputs><recording>True</recording></inputs></vmix>"),
            None
        );
        // vMix's own word is read whatever its case and spaces.
        assert_eq!(
            parse_vmix_state(&state("<recording> TRUE </recording>")).map(|read| read.recording),
            Some(true)
        );
    }

    /// A server on 127.0.0.1 that answers one request with `answer` (and
    /// reads it first), standing in for vMix: no test asks vMix itself.
    fn stand_in(answer: Vec<u8>, close: bool) -> SocketAddr {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("a listener binds");
        let address = listener.local_addr().expect("its address");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("the read connects");
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(&answer);
            if close {
                let _ = stream.shutdown(Shutdown::Both);
            } else {
                // Held open past the read's second.
                thread::sleep(Duration::from_secs(3));
            }
        });
        address
    }

    fn http(status: &str, body: &str, length: bool) -> Vec<u8> {
        let length = if length {
            format!("Content-Length: {}\r\n", body.len())
        } else {
            String::new()
        };
        format!("HTTP/1.1 {status}\r\nContent-Type: text/xml\r\n{length}\r\n{body}").into_bytes()
    }

    #[test]
    fn a_read_takes_vmixs_answer_once_it_is_whole() {
        let body = state(r#"<recording filename1="D:\a.avi">True</recording>"#);
        let expected = Some(VmixRecording {
            recording: true,
            file: Some(String::from(r"D:\a.avi")),
        });
        // Closed after the answer, as HTTP/1.0 asks.
        assert_eq!(
            read_vmix(stand_in(http("200 OK", &body, false), true)),
            expected
        );
        // Left open, but whole by its length: read without waiting.
        let started = Instant::now();
        assert_eq!(
            read_vmix(stand_in(http("200 OK", &body, true), false)),
            expected
        );
        assert!(started.elapsed() < Duration::from_millis(900));
    }

    #[test]
    fn a_read_that_is_not_a_whole_answer_in_time_is_not_vmix_answering() {
        let body = state("<recording>False</recording>");
        // Another status.
        assert_eq!(
            read_vmix(stand_in(http("404 Not Found", &body, true), true)),
            None
        );
        // A 200 with no vMix state in it.
        assert_eq!(
            read_vmix(stand_in(http("200 OK", "<html/>", true), true)),
            None
        );
        // An answer cut short and held open: the second is up.
        let mut cut = http("200 OK", &body, true);
        cut.truncate(cut.len() - 20);
        let started = Instant::now();
        assert_eq!(read_vmix(stand_in(cut, false)), None);
        let waited = started.elapsed();
        assert!(waited >= ANSWER_TIMEOUT, "{waited:?}");
        assert!(
            waited < ANSWER_TIMEOUT + Duration::from_millis(900),
            "{waited:?}"
        );
        // Nobody listening: a port given up at once.
        let gone = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .and_then(|listener| listener.local_addr())
            .expect("a port");
        assert_eq!(read_vmix(gone), None);
    }

    #[test]
    fn an_answer_over_two_mib_is_not_read() {
        let mut body = state("<recording>False</recording>");
        body.push_str(&" ".repeat(ANSWER_MAX_BYTES));
        assert_eq!(
            read_vmix(stand_in(http("200 OK", &body, false), true)),
            None
        );
    }

    #[test]
    fn a_file_is_in_a_folder_capitals_aside_and_slashes_alike() {
        let folder = r"D:\Sessions\Morning take (2026-10-18)";
        for (file, inside) in [
            (
                r"D:\Sessions\Morning take (2026-10-18)\vMix Recording\a.avi",
                true,
            ),
            (r"d:/sessions/morning TAKE (2026-10-18)/a.avi", true),
            (r"D:\Sessions\Morning take (2026-10-18)", false),
            (r"D:\Sessions\Morning take (2026-10-18)\", false),
            (r"D:\Sessions\Morning take (2026-10-18) 2\a.avi", false),
            (r"D:\All\Morning take (2026-10-18)\a.avi", false),
            (r"E:\Sessions\Morning take (2026-10-18)\a.avi", false),
        ] {
            assert_eq!(in_folder(file, folder), inside, "{file}");
        }
        assert!(in_folder(r"D:\Sessions\x\a.avi", r"D:\Sessions\x\"));
        assert!(!in_folder(r"D:\a.avi", ""));
    }

    #[test]
    fn the_recording_folder_is_the_first_vmix_subfolder_else_the_folder() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "studio-control-vmix-folder-{}-{unique}",
            std::process::id()
        ));
        let folder = root.join("Morning take (2026-10-18)");
        for subfolder in ["Audio", "Exports", "vMix Recording", "Video"] {
            fs::create_dir_all(folder.join(subfolder)).expect("a subfolder is made");
        }
        // A file whose name holds vmix is no folder.
        fs::write(folder.join("vmix notes.txt"), b"").expect("a file is written");
        assert_eq!(
            recording_folder_in(&folder),
            Some(folder.join("vMix Recording").display().to_string())
        );

        let other = root.join("Series");
        for subfolder in ["VMIX take 2", "older vmix"] {
            fs::create_dir_all(other.join(subfolder)).expect("a subfolder is made");
        }
        assert_eq!(
            recording_folder_in(&other),
            Some(other.join("older vmix").display().to_string()),
            "the first by name"
        );

        let plain = root.join("Plain");
        fs::create_dir_all(plain.join("Audio")).expect("a subfolder is made");
        assert_eq!(
            recording_folder_in(&plain),
            Some(plain.display().to_string())
        );
        assert_eq!(recording_folder_in(&root.join("Not there")), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_write_rate_waits_ten_seconds_and_starts_again_with_a_new_file() {
        let start = Instant::now();
        let at = |seconds: u64| start + Duration::from_secs(seconds);
        let mb = 1024 * 1024;
        let mut rate = WriteRate::default();
        let file = Some(r"D:\Sessions\Take (2026-10-18)\vMix Recording\a.avi");
        assert_eq!(rate.take(true, file, Some(0), at(0)), None);
        assert_eq!(
            rate.take(true, file, Some(65 * mb), at(5)),
            None,
            "5 s apart"
        );
        assert_eq!(rate.take(true, file, Some(130 * mb), at(10)), Some(13 * mb));
        // A look whose size could not be read leaves the looks as they were.
        assert_eq!(rate.take(true, file, None, at(15)), None);
        assert_eq!(rate.take(true, file, Some(260 * mb), at(20)), Some(13 * mb));

        // Over a minute, the oldest looks go: the rate is the last minute's.
        for second in (25..=120).step_by(5) {
            rate.take(
                true,
                file,
                Some(260 * mb + (second - 20) * 26 * mb),
                at(second),
            );
        }
        assert_eq!(
            rate.take(true, file, Some(260 * mb + 105 * 26 * mb), at(125)),
            Some(26 * mb)
        );

        // Another file: started again.
        let next = Some(r"D:\Sessions\Take (2026-10-18)\vMix Recording\b.avi");
        assert_eq!(rate.take(true, next, Some(mb), at(130)), None);
        assert_eq!(
            rate.take(true, next, Some(mb + 130 * mb), at(140)),
            Some(13 * mb)
        );
        // A file that reads smaller: started again.
        assert_eq!(rate.take(true, next, Some(mb), at(145)), None);
        // The recording stops: no rate, and it starts again after.
        assert_eq!(rate.take(false, next, Some(400 * mb), at(150)), None);
        assert_eq!(rate.take(true, next, Some(400 * mb), at(155)), None);
        assert_eq!(
            rate.take(true, next, Some(530 * mb), at(165)),
            Some(13 * mb)
        );
        // No file named: no rate.
        assert_eq!(rate.take(true, None, Some(0), at(170)), None);
    }
}
