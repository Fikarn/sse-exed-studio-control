//! The pictures helper (the camera pictures, D28): a process of its own that
//! the engine starts, steers and stops, so that whatever receives the
//! pictures costs the pictures and nothing else when it fails.
//!
//! It reads the engine's lines on its stdin (`ToHelper`) and writes what it
//! receives on its stdout (`FromHelper::State`), on every change and at least
//! once a second, so the engine hears that it lives. It ends when its stdin
//! closes: the engine stopped it, or went. It writes nothing else on stdout;
//! a line it cannot read is said on stderr, which the engine logs.
//!
//! Its source is the one the engine names on each want. The simulated one:
//! test pictures on vMix inputs 1 to 4 (`simulated_state`, `card.rs`). Or, in
//! a development run started with `npm run app -- --vmix-pictures` and
//! nowhere else, vMix's Outputs 2 to 4 over NDI on this PC (`receive.rs`,
//! D31 to D33): a hardware test the owner asks for and attends. Two fences
//! must both give way for that: the engine's word on the want, and the
//! switch and NDI's library in this process's own environment
//! (`vmix::permission`). With either missing it takes nothing from vMix and
//! says why.
//!
//! While the Cameras page shows the pictures it draws them itself (D30): it
//! connects to the shell's listener on 127.0.0.1, whose address and secret
//! the engine tells it, is handed a composition surface over the page and
//! told where each picture stands (`layer.rs`), and draws them on the
//! graphics card (`renderer.rs`). It opens no device. A studio build does
//! not start it until the studio build's step, and a studio build of it
//! refuses to run.
//!
//! A thread that stops (a draw that hangs, a receiver stuck in NDI's
//! library) makes it go silent (`watch.rs`), and the engine ends it and
//! starts it again.

mod card;
mod layer;
#[cfg(windows)]
mod ndi_library;
#[cfg(not(windows))]
#[path = "ndi_library_none.rs"]
mod ndi_library;
mod ndi_sdk;
mod picture;
mod receive;
#[cfg(windows)]
mod renderer;
#[cfg(not(windows))]
#[path = "renderer_none.rs"]
mod renderer;
mod sha256;
mod vmix;
mod watch;

use layer::Pictures;
use receive::Vmix;
use std::io::{self, BufReader, Read, Write};
use std::process::ExitCode;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::pictures::{
    from_line, read_line_bounded, simulated_state, to_line, FromHelper, HelperProblem,
    HelperSource, ReceivedCamera, ToHelper, WantedCamera, STATE_INTERVAL,
};
use vmix::Permission;
use watch::{Beats, STALL};

/// How often what was received goes to stderr, which the engine logs.
const MINUTE: Duration = Duration::from_secs(60);

fn main() -> ExitCode {
    let studio_build = studio_control_protocol::development::studio_build();
    if studio_build {
        eprintln!(
            "The pictures helper is not in a studio build yet: it comes with the studio build's step."
        );
        return ExitCode::from(2);
    }
    let beats = Arc::new(Beats::default());
    let mut sources = Sources::new(
        vmix::permission(studio_build, |name| std::env::var_os(name)),
        Arc::clone(&beats),
    );
    let (orders, received) = mpsc::channel();
    let drawer = thread::Builder::new()
        .name(String::from("pictures"))
        .spawn(move || layer::run(&received, &beats));
    let stdout = io::stdout();
    run(io::stdin(), &mut stdout.lock(), &orders, &mut sources);
    drop(orders);
    // NDI's receivers and search end before the process does, within the
    // engine's second of grace.
    sources.finish(FINISH_WITHIN);
    if let Ok(drawer) = drawer {
        let _ = drawer.join();
    }
    ExitCode::SUCCESS
}

/// How long the helper waits at its end for NDI's threads: less than the
/// second the engine gives it before it ends it (`STOP_GRACE`).
const FINISH_WITHIN: Duration = Duration::from_millis(700);

/// The last want: the cameras, whether the page shows them, and the source.
struct Wanted {
    cameras: Vec<WantedCamera>,
    showing: bool,
    source: HelperSource,
}

/// Where the pictures come from: the test cards, or vMix's, which are
/// loaded at the first want that names them and only when this helper may
/// take them.
struct Sources {
    permission: Permission,
    beats: Arc<Beats>,
    /// vMix's pictures once asked for: started, or why not.
    vmix: Option<Result<Vmix, String>>,
    /// A refusal is said on stderr once.
    refusal_said: bool,
}

impl Sources {
    fn new(permission: Permission, beats: Arc<Beats>) -> Self {
        Self {
            permission,
            beats,
            vmix: None,
            refusal_said: false,
        }
    }

    /// vMix's pictures, started at the first ask when this helper may take
    /// them; `None` when it may not, or they did not start (said once).
    fn vmix(&mut self) -> Option<&mut Vmix> {
        let library = match &self.permission {
            Permission::Allowed(library) => library,
            Permission::Refused(_, why) => {
                if !self.refusal_said {
                    eprintln!("The pictures helper takes no pictures from vMix: {why}.");
                    self.refusal_said = true;
                }
                return None;
            }
        };
        let beats = &self.beats;
        self.vmix
            .get_or_insert_with(|| {
                Vmix::start(library, Arc::clone(beats)).inspect_err(|why| {
                    eprintln!("The pictures helper takes no pictures from vMix: {why}.");
                })
            })
            .as_mut()
            .ok()
    }

    /// What the draw loop draws from, for a want: the receivers are made or
    /// let go of with it.
    fn pictures(&mut self, source: HelperSource, showing: bool) -> Pictures {
        match source {
            HelperSource::Simulated => Pictures::Cards,
            HelperSource::Vmix => match self.vmix() {
                Some(vmix) => {
                    vmix.keep(showing);
                    Pictures::Received(vmix.frames())
                }
                None => Pictures::Nothing,
            },
        }
    }

    /// The state line for `wanted`; `None` while NDI's search has not yet
    /// had its first seconds.
    fn state(&mut self, wanted: &Wanted, now: Instant) -> Option<FromHelper> {
        if wanted.source == HelperSource::Simulated {
            return Some(simulated_state(&wanted.cameras));
        }
        let Some(vmix) = self.vmix() else {
            let problem = match &self.permission {
                Permission::Refused(problem, _) => *problem,
                Permission::Allowed(_) => HelperProblem::NoLibrary,
            };
            return Some(nothing_received(&wanted.cameras, problem));
        };
        vmix.keep(wanted.showing);
        if let Some(problem) = vmix.problem() {
            return Some(nothing_received(&wanted.cameras, problem));
        }
        if !vmix.settled(now) {
            return None;
        }
        let (sending, cameras) = vmix.report(&wanted.cameras, now);
        Some(FromHelper::State {
            source: HelperSource::Vmix,
            sending,
            problem: None,
            cameras,
        })
    }

    /// The minute's line of what was received, if anything was.
    fn minute(&self) -> Option<String> {
        self.vmix.as_ref()?.as_ref().ok()?.minute()
    }

    /// Ends vMix's receivers and search, waiting up to `within` for them.
    fn finish(&mut self, within: Duration) {
        if let Some(Ok(vmix)) = self.vmix.as_mut() {
            vmix.finish(within);
        }
    }
}

/// vMix's pictures asked for, and none taken, for `problem`.
fn nothing_received(cameras: &[WantedCamera], problem: HelperProblem) -> FromHelper {
    FromHelper::State {
        source: HelperSource::Vmix,
        sending: false,
        problem: Some(problem),
        cameras: cameras
            .iter()
            .map(|wanted| ReceivedCamera {
                camera: wanted.camera,
                vmix_input: wanted.vmix_input,
                receiving: false,
                format: None,
            })
            .collect(),
    }
}

/// What the stdin reader hands on.
enum Input {
    Line(Result<ToHelper, String>),
    Closed,
}

/// Reads the engine's lines off the main loop, so the loop can speak once a
/// second whether a line came or not.
fn spawn_reader(input: impl Read + Send + 'static) -> Receiver<Input> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(input);
        loop {
            let input = match read_line_bounded(&mut reader) {
                Ok(Some(Ok(line))) if line.trim().is_empty() => continue,
                Ok(Some(Ok(line))) => Input::Line(from_line(&line)),
                Ok(Some(Err(length))) => {
                    Input::Line(Err(format!("a line of {length} bytes, too long to read")))
                }
                Ok(None) | Err(_) => Input::Closed,
            };
            let closed = matches!(input, Input::Closed);
            if sender.send(input).is_err() || closed {
                return;
            }
        }
    });
    receiver
}

/// The helper's loop: takes the engine's lines, hands the link and the
/// wants to the draw loop, and says what it receives, until its input
/// closes or its output cannot be written. It says nothing before the first
/// want: a helper that was never told the cameras has nothing to say, and
/// the engine would read its silence as a hang. It says nothing either
/// while one of its threads has stopped (`watch.rs`), so that the engine
/// ends it and starts it again.
fn run(
    input: impl Read + Send + 'static,
    output: &mut impl Write,
    orders: &Sender<layer::Order>,
    sources: &mut Sources,
) {
    let lines = spawn_reader(input);
    let mut want: Option<Wanted> = None;
    let mut said: Option<String> = None;
    let mut due = Instant::now();
    let mut minute = Instant::now() + MINUTE;
    let mut stalled: Option<String> = None;
    loop {
        match lines.recv_timeout(due.saturating_duration_since(Instant::now())) {
            // Which camera is the selected one is the page's to say, in the
            // scene the shell hands on: the helper draws what it is told.
            Ok(Input::Line(Ok(ToHelper::Want {
                cameras,
                showing,
                source,
                ..
            }))) => {
                let _ = orders.send(layer::Order::Want {
                    cameras: cameras.clone(),
                    showing,
                    pictures: sources.pictures(source, showing),
                });
                want = Some(Wanted {
                    cameras,
                    showing,
                    source,
                });
            }
            Ok(Input::Line(Ok(ToHelper::Link { address, secret }))) => {
                match layer::listener_address(&address) {
                    Ok(address) => {
                        let _ = orders.send(layer::Order::Link(address, secret));
                    }
                    Err(why) => eprintln!("The pictures helper refused a listener: {why}"),
                }
            }
            Ok(Input::Line(Err(why))) => {
                eprintln!("The pictures helper could not read a line: {why}")
            }
            Ok(Input::Closed) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        let now = Instant::now();
        let Some(wanted) = &want else {
            due = now + STATE_INTERVAL;
            continue;
        };
        let stopped = sources.beats.stalled(now);
        if stopped != stalled {
            if let Some(who) = &stopped {
                eprintln!(
                    "{who} has not moved for {} s: the pictures helper says nothing more, so that the hardware link starts it again.",
                    STALL.as_secs()
                );
            }
            stalled = stopped;
        }
        if stalled.is_some() {
            due = now + STATE_INTERVAL;
            continue;
        }
        if now >= minute {
            if let Some(line) = sources.minute() {
                eprintln!("{line}");
            }
            minute = now + MINUTE;
        }
        let Some(state) = sources.state(wanted, now) else {
            due = now + STATE_INTERVAL;
            continue;
        };
        let line = to_line(&state);
        if said.as_deref() != Some(line.as_str()) || now >= due {
            if writeln!(output, "{line}")
                .and_then(|()| output.flush())
                .is_err()
            {
                return;
            }
            said = Some(line);
            due = Instant::now() + STATE_INTERVAL;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use studio_control_protocol::pictures::FromHelper;

    fn states(output: &[u8]) -> Vec<FromHelper> {
        String::from_utf8_lossy(output)
            .lines()
            .map(|line| from_line(line).expect("a state line"))
            .collect()
    }

    /// A helper's sources as a test's environment gives them: without the
    /// switch, so vMix's pictures are refused.
    fn sources() -> Sources {
        Sources::new(
            vmix::permission(false, |_| None),
            Arc::new(Beats::default()),
        )
    }

    fn run_on(input: &str, sources: &mut Sources) -> Vec<u8> {
        let mut output = Vec::new();
        run(
            io::Cursor::new(input.as_bytes().to_vec()),
            &mut output,
            &mpsc::channel().0,
            sources,
        );
        output
    }

    #[test]
    fn it_says_what_it_receives_for_the_cameras_wanted_and_ends_with_its_input() {
        let input = concat!(
            r#"{"type":"want","cameras":[{"camera":1,"vmixInput":1},{"camera":2,"vmixInput":7},{"camera":3,"vmixInput":3}]}"#,
            "\n"
        );
        let output = run_on(input, &mut sources());
        let last = states(&output).pop().expect("at least one line");
        let FromHelper::State { cameras, .. } = last;
        assert_eq!(
            cameras
                .iter()
                .map(|camera| (camera.camera, camera.receiving))
                .collect::<Vec<_>>(),
            [(1, true), (2, false), (3, true)]
        );
    }

    #[test]
    fn it_says_nothing_before_it_is_told_the_cameras() {
        let output = run_on("\n\n", &mut sources());
        assert!(output.is_empty(), "{}", String::from_utf8_lossy(&output));
    }

    #[test]
    fn a_line_it_cannot_read_is_passed_over() {
        let input = concat!(
            "not a line of the engine's\n",
            "\n",
            r#"{"type":"want","cameras":[{"camera":1,"vmixInput":9}]}"#,
            "\n"
        );
        let output = run_on(input, &mut sources());
        let FromHelper::State { cameras, .. } = states(&output).pop().expect("a line");
        assert_eq!(cameras.len(), 1);
        assert!(!cameras[0].receiving);
    }

    // The engine's word alone does not open vMix's pictures: without the
    // switch in its own environment the helper takes none, loads nothing,
    // and says why.
    #[test]
    fn vmix_s_pictures_asked_for_without_the_switch_are_refused() {
        let input = concat!(
            r#"{"type":"want","cameras":[{"camera":1,"vmixInput":1},{"camera":2,"vmixInput":2}],"showing":true,"source":"vmix"}"#,
            "\n"
        );
        let mut sources = sources();
        let output = run_on(input, &mut sources);
        let FromHelper::State {
            source,
            sending,
            problem,
            cameras,
        } = states(&output).pop().expect("a line");
        assert_eq!(source, HelperSource::Vmix);
        assert!(!sending);
        assert_eq!(problem, Some(HelperProblem::NotAllowed));
        assert_eq!(
            cameras
                .iter()
                .map(|camera| (camera.camera, camera.vmix_input, camera.receiving))
                .collect::<Vec<_>>(),
            [(1, 1, false), (2, 2, false)]
        );
        assert!(sources.vmix.is_none(), "nothing was loaded");
    }

    // With the switch, a library that is not the SDK's file is not loaded.
    #[test]
    fn vmix_s_pictures_without_the_sdk_s_library_are_refused() {
        let mut sources = Sources::new(
            vmix::permission(false, |name| {
                (name == studio_control_protocol::pictures::VMIX_PICTURES_ENV)
                    .then(|| std::ffi::OsString::from("1"))
            }),
            Arc::new(Beats::default()),
        );
        let input = concat!(
            r#"{"type":"want","cameras":[{"camera":3,"vmixInput":3}],"source":"vmix"}"#,
            "\n"
        );
        let output = run_on(input, &mut sources);
        let FromHelper::State { problem, .. } = states(&output).pop().expect("a line");
        assert_eq!(problem, Some(HelperProblem::NoLibrary));
        assert!(sources.vmix.is_none(), "nothing was loaded");
    }

    // A thread that has stopped makes the helper say nothing, so that the
    // engine ends it and starts it again.
    #[test]
    fn a_stopped_thread_makes_it_silent() {
        let mut sources = sources();
        let long_ago = Instant::now().checked_sub(STALL).expect("a clock");
        sources.beats.beat_at("the test's thread", long_ago);
        let input = concat!(
            r#"{"type":"want","cameras":[{"camera":1,"vmixInput":1}]}"#,
            "\n"
        );
        let output = run_on(input, &mut sources);
        assert!(output.is_empty(), "{}", String::from_utf8_lossy(&output));
    }
}
