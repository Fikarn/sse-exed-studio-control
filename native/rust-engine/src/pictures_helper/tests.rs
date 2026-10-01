//! The pictures helper's supervision: when it is started again and ended,
//! with the time passed in; then a few real processes standing in for it
//! (the shell's `engine.rs` tests do the same for the engine). No test starts
//! the helper's own program: the helper's crate tests it
//! (`native/pictures-link/tests/process.rs`).

use super::*;
use crate::cameras::test_support::TestCameras;

fn times() -> Times {
    Times {
        silence: Duration::from_secs(5),
        first_delay: Duration::from_secs(1),
        longest_delay: Duration::from_secs(30),
        showing_tail: Duration::from_secs(30),
    }
}

#[test]
fn a_helper_that_ends_is_started_again_after_a_doubling_wait() {
    let start = Instant::now();
    let at = |seconds: u64| start + Duration::from_secs(seconds);
    let mut supervision = Supervision::new(times());
    assert_eq!(supervision.take(Happened::Started(at(0))), None);
    assert_eq!(supervision.take(Happened::Tick(at(1))), None);

    // Ended: waits 1 s, then 2, 4 … and never more than 30.
    let mut now = 1;
    for wait in [1, 2, 4, 8, 16, 30, 30] {
        assert_eq!(supervision.take(Happened::Ended(at(now))), None);
        assert_eq!(supervision.take(Happened::Tick(at(now + wait - 1))), None);
        assert_eq!(
            supervision.take(Happened::Tick(at(now + wait))),
            Some(Todo::Start),
            "after {wait} s"
        );
        now += wait;
        supervision.take(Happened::Started(at(now)));
    }

    // A line heard soon after a start clears nothing: a helper that fails
    // after its first line still waits the longest.
    supervision.take(Happened::Heard(at(now + 1)));
    supervision.take(Happened::Ended(at(now + 2)));
    now += 2;
    assert_eq!(supervision.take(Happened::Tick(at(now + 29))), None);
    assert_eq!(
        supervision.take(Happened::Tick(at(now + 30))),
        Some(Todo::Start)
    );
    now += 30;
    supervision.take(Happened::Started(at(now)));

    // One that stayed up 30 s and speaks: the next end waits one second again.
    supervision.take(Happened::Heard(at(now + 30)));
    supervision.take(Happened::Ended(at(now + 31)));
    assert_eq!(
        supervision.take(Happened::Tick(at(now + 32))),
        Some(Todo::Start)
    );
}

#[test]
fn a_helper_silent_too_long_is_ended_and_one_that_speaks_is_not() {
    let start = Instant::now();
    let at = |millis: u64| start + Duration::from_millis(millis);
    let mut supervision = Supervision::new(times());
    supervision.take(Happened::Started(at(0)));
    // It speaks every second: never ended.
    for second in 1..20 {
        supervision.take(Happened::Heard(at(second * 1000)));
        assert_eq!(
            supervision.take(Happened::Tick(at(second * 1000 + 900))),
            None
        );
    }
    // Silent from 19 s: ended once past five seconds, not at five.
    assert_eq!(supervision.take(Happened::Tick(at(24_000))), None);
    assert_eq!(
        supervision.take(Happened::Tick(at(24_001))),
        Some(Todo::End)
    );
}

#[test]
fn a_missing_program_is_not_looked_for_again() {
    let mut supervision = Supervision::new(times());
    supervision.take(Happened::NotFound);
    let later = Instant::now() + Duration::from_secs(3600);
    assert_eq!(supervision.take(Happened::Tick(later)), None);
}

// ---------------------------------------------------------------------------
// Real processes standing in for the helper
// ---------------------------------------------------------------------------

/// Long enough for a slow gate run; nothing asserts a tighter bound.
const PATIENCE: Duration = Duration::from_secs(30);

fn quick_times() -> Times {
    Times {
        silence: Duration::from_millis(600),
        first_delay: Duration::from_millis(100),
        longest_delay: Duration::from_millis(200),
        showing_tail: Duration::from_millis(300),
    }
}

fn launch(program: &str, args: &[&str]) -> Launch {
    Launch {
        program: which(program),
        args: args.iter().map(|arg| String::from(*arg)).collect(),
    }
}

/// A program of the system's, by its full path: the supervisor takes a
/// file, as it takes the helper's beside the engine's.
fn which(program: &str) -> PathBuf {
    let name = if cfg!(windows) {
        format!("{program}.exe")
    } else {
        String::from(program)
    };
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|dir| dir.join(&name))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| panic!("{name} is on the PATH"))
}

/// Waits until the status of `cameras` is one `wanted` accepts.
fn wait_for(cameras: &TestCameras, what: &str, wanted: impl Fn(&HelperStatus) -> bool) {
    let started = Instant::now();
    loop {
        if helper_status(cameras.path()).as_ref().is_some_and(&wanted) {
            return;
        }
        assert!(
            started.elapsed() < PATIENCE,
            "{what}: the status stayed {:?}",
            helper_status(cameras.path())
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn log_of(cameras: &TestCameras) -> PathBuf {
    cameras.path().with_file_name("engine.log")
}

#[test]
fn a_program_that_is_not_there_reads_missing_and_is_said_once() {
    let cameras = TestCameras::new("helper-missing");
    let helper = start_supervisor(
        cameras.path().to_path_buf(),
        log_of(&cameras),
        Launch {
            program: cameras.path().with_file_name("no-such-helper"),
            args: Vec::new(),
        },
        quick_times(),
        HelperSource::Simulated,
        None,
    );
    wait_for(&cameras, "missing", |status| {
        *status == HelperStatus::Missing
    });
    thread::sleep(Duration::from_millis(400));
    assert_eq!(helper_status(cameras.path()), Some(HelperStatus::Missing));
    let log = std::fs::read_to_string(log_of(&cameras)).unwrap_or_default();
    assert_eq!(
        log.matches("The pictures helper is not beside the hardware link")
            .count(),
        1,
        "{log}"
    );
    helper.stop();
    assert_eq!(helper_status(cameras.path()), None);
}

#[test]
fn a_helper_that_ends_by_itself_is_started_again() {
    let cameras = TestCameras::new("helper-ends");
    let (program, args): (&str, &[&str]) = if cfg!(windows) {
        ("cmd", &["/C", "exit 0"])
    } else {
        ("true", &[])
    };
    let helper = start_supervisor(
        cameras.path().to_path_buf(),
        log_of(&cameras),
        launch(program, args),
        quick_times(),
        HelperSource::Simulated,
        None,
    );
    // Its start lasts a moment only: the log, not the status, says it came
    // round again.
    let log = || std::fs::read_to_string(log_of(&cameras)).unwrap_or_default();
    let started = Instant::now();
    while log().matches("The pictures helper started").count() < 2 {
        assert!(started.elapsed() < PATIENCE, "{}", log());
        thread::sleep(Duration::from_millis(20));
    }
    helper.stop();
    assert!(log().contains("it is started again in"), "{}", log());
}

#[test]
fn a_silent_helper_is_ended_and_started_again() {
    let cameras = TestCameras::new("helper-silent");
    // It lives half a minute and says nothing. On Windows `ping` itself, not
    // `cmd /C ping`, so the process ended is the one that holds the pipes.
    let (program, args): (&str, &[&str]) = if cfg!(windows) {
        ("ping", &["-n", "30", "127.0.0.1"])
    } else {
        ("sleep", &["30"])
    };
    let helper = start_supervisor(
        cameras.path().to_path_buf(),
        log_of(&cameras),
        launch(program, args),
        quick_times(),
        HelperSource::Simulated,
        None,
    );
    wait_for(&cameras, "restarting", |status| {
        *status == HelperStatus::Restarting
    });
    helper.stop();
    let log = std::fs::read_to_string(log_of(&cameras)).unwrap_or_default();
    assert!(log.contains("it was silent too long"), "{log}");
}

#[test]
fn a_helper_that_speaks_is_running_and_stop_ends_it() {
    let cameras = TestCameras::new("helper-speaks");
    // One state line, then it waits for its stdin to close, as the helper
    // does: `sort` prints what it read once its input ends, so a line is
    // written after the want the supervisor sends … which is not a state.
    // A shell prints one at once instead, then reads until its input ends.
    let line = r#"{"type":"state","source":"simulated","sending":true,"cameras":[{"camera":1,"vmixInput":1,"receiving":true}]}"#;
    let launch = if cfg!(windows) {
        Launch {
            program: which("powershell"),
            args: vec![
                String::from("-NoProfile"),
                String::from("-Command"),
                format!("Write-Output '{line}'; [Console]::In.ReadToEnd() | Out-Null"),
            ],
        }
    } else {
        Launch {
            program: which("sh"),
            args: vec![
                String::from("-c"),
                format!("echo '{line}'; cat > /dev/null"),
            ],
        }
    };
    let helper = start_supervisor(
        cameras.path().to_path_buf(),
        log_of(&cameras),
        launch,
        Times {
            silence: PATIENCE,
            ..quick_times()
        },
        HelperSource::Simulated,
        None,
    );
    wait_for(
        &cameras,
        "running",
        |status| matches!(status, HelperStatus::Running { sending: true, cameras, .. } if cameras.len() == 1),
    );
    let stopping = Instant::now();
    helper.stop();
    assert!(
        stopping.elapsed() < PATIENCE,
        "stop ends a helper that ends with its stdin"
    );
    assert_eq!(helper_status(cameras.path()), None);
}

// D33: a development build with the simulated cameras starts a helper, on
// vMix's pictures only when the switch was read; nothing else starts one.
#[test]
fn only_a_development_build_with_the_simulated_cameras_starts_a_helper_and_the_switch_picks_vmix() {
    for (development, simulated, switch, source) in [
        (true, true, false, Some(HelperSource::Simulated)),
        (true, true, true, Some(HelperSource::Vmix)),
        (true, false, false, None),
        (true, false, true, None),
        (false, true, false, None),
        (false, true, true, None),
        (false, false, false, None),
        (false, false, true, None),
    ] {
        assert_eq!(
            source_for(development, simulated, switch),
            source,
            "development {development}, simulated {simulated}, switch {switch}"
        );
    }
}

// The helper is told vMix's pictures on every want, and the log says so once.
#[test]
fn a_helper_on_vmix_s_pictures_is_told_so_on_every_want() {
    let cameras = TestCameras::new("helper-vmix");
    let line =
        r#"{"type":"state","source":"vmix","sending":false,"problem":"notAllowed","cameras":[]}"#;
    // A stand-in that says one state line and then writes each line it is
    // told to its stderr, which the supervisor logs.
    let launch = if cfg!(windows) {
        Launch {
            program: which("powershell"),
            args: vec![
                String::from("-NoProfile"),
                String::from("-Command"),
                format!(
                    "Write-Output '{line}'; while ($null -ne ($l = [Console]::In.ReadLine())) {{ [Console]::Error.WriteLine($l) }}"
                ),
            ],
        }
    } else {
        Launch {
            program: which("sh"),
            args: vec![
                String::from("-c"),
                format!("echo '{line}'; while read -r l; do echo \"$l\" >&2; done"),
            ],
        }
    };
    let supervisor = start_supervisor(
        cameras.path().to_path_buf(),
        log_of(&cameras),
        launch,
        Times {
            silence: PATIENCE,
            ..quick_times()
        },
        HelperSource::Vmix,
        None,
    );
    wait_for(&cameras, "running", |status| {
        matches!(
            status,
            HelperStatus::Running {
                problem: Some(HelperProblem::NotAllowed),
                ..
            }
        )
    });
    assert_eq!(
        helper(cameras.path()).map(|(source, _)| source),
        Some(HelperSource::Vmix)
    );
    showing(cameras.path());
    let log = || std::fs::read_to_string(log_of(&cameras)).unwrap_or_default();
    let started = Instant::now();
    while !log().contains(r#""showing":true,"source":"vmix""#) {
        assert!(started.elapsed() < PATIENCE, "{}", log());
        thread::sleep(Duration::from_millis(20));
    }
    supervisor.stop();
    let log = log();
    assert!(
        log.contains(r#""showing":false,"source":"vmix""#),
        "the first want: {log}"
    );
    assert_eq!(
        log.matches("told to take vMix's Outputs 2, 3 and 4")
            .count(),
        1,
        "{log}"
    );
}

#[test]
fn without_the_simulated_cameras_no_helper_starts() {
    // A test build is a development build: it would look for the helper
    // with the simulated cameras, and never without them, the switch or not.
    let cameras = TestCameras::new("helper-none");
    assert!(spawn_pictures_helper(
        cameras.path().to_path_buf(),
        log_of(&cameras),
        false,
        true,
        None
    )
    .is_none());
    assert_eq!(helper_status(cameras.path()), None);
}

// ---------------------------------------------------------------------------
// What reaches the helper
// ---------------------------------------------------------------------------

/// A want as the helper hears it: the selected camera, and each camera's
/// input.
type HeardWant = (u8, Vec<(u8, u32)>);

#[test]
fn a_vmix_input_or_the_selection_changed_reaches_the_helper_and_nothing_else_does() {
    let cameras = TestCameras::set_up("helper-wants");
    let (sender, messages) = mpsc::channel();
    helpers()
        .entry(cameras.path().to_path_buf())
        .or_default()
        .to_supervisor = Some(sender);
    // Each want as (the selected camera, each camera's input), and whether
    // the page said it shows the pictures.
    let heard = |messages: &Receiver<Message>| -> (Vec<HeardWant>, usize) {
        let mut wants = Vec::new();
        let mut showings = 0;
        for message in messages.try_iter() {
            match message {
                Message::Want(wanted) => wants.push((
                    wanted.selected,
                    wanted
                        .cameras
                        .iter()
                        .map(|camera| (camera.camera, camera.vmix_input))
                        .collect(),
                )),
                Message::Showing => showings += 1,
                _ => {}
            }
        }
        (wants, showings)
    };

    cameras.call("cameras.snapshot", serde_json::json!({}));
    cameras.call("cameras.select", serde_json::json!({ "camera": 1 }));
    assert_eq!(
        heard(&messages),
        (Vec::new(), 0),
        "a read, or the camera selected already, is not a want"
    );

    // The selected camera is sent big.
    cameras.call("cameras.select", serde_json::json!({ "camera": 2 }));
    assert_eq!(
        heard(&messages),
        (vec![(2, vec![(1, 1), (2, 2), (3, 3)])], 0)
    );

    cameras.call(
        "cameras.setup.update",
        serde_json::json!({ "camera": 3, "vmixInput": 9 }),
    );
    assert_eq!(
        heard(&messages),
        (vec![(2, vec![(1, 1), (2, 2), (3, 9)])], 0)
    );
    // The same input again changes nothing.
    cameras.call(
        "cameras.setup.update",
        serde_json::json!({ "camera": 3, "vmixInput": 9 }),
    );
    assert_eq!(heard(&messages), (Vec::new(), 0));

    // The page shows the pictures: it answers nothing and changes nothing.
    let reply = cameras
        .reply("cameras.pictures.showing", serde_json::json!({}))
        .expect("it answers");
    assert_eq!(reply.result, serde_json::json!({}));
    assert_eq!(reply.event, None);
    assert_eq!(heard(&messages), (Vec::new(), 1));
}

// The page says it shows the pictures: the helper is told at once, after the
// link and a first want that wanted no frames.
#[test]
fn frames_are_wanted_while_the_page_shows_them_and_a_while_after() {
    let cameras = TestCameras::new("helper-showing");
    let line = r#"{"type":"state","source":"simulated","sending":true,"cameras":[]}"#;
    // A stand-in that says one state line and then writes each line it is
    // told to its stderr, which the supervisor logs.
    let launch = if cfg!(windows) {
        Launch {
            program: which("powershell"),
            args: vec![
                String::from("-NoProfile"),
                String::from("-Command"),
                format!(
                    "Write-Output '{line}'; while ($null -ne ($l = [Console]::In.ReadLine())) {{ [Console]::Error.WriteLine($l) }}"
                ),
            ],
        }
    } else {
        Launch {
            program: which("sh"),
            args: vec![
                String::from("-c"),
                format!("echo '{line}'; while read -r l; do echo \"$l\" >&2; done"),
            ],
        }
    };
    let helper = start_supervisor(
        cameras.path().to_path_buf(),
        log_of(&cameras),
        launch,
        Times {
            silence: PATIENCE,
            ..quick_times()
        },
        HelperSource::Simulated,
        Some(Link {
            address: String::from("127.0.0.1:9"),
            secret: LinkSecret("ab".repeat(32)),
        }),
    );
    wait_for(&cameras, "running", |status| {
        matches!(status, HelperStatus::Running { .. })
    });
    showing(cameras.path());
    let log = || std::fs::read_to_string(log_of(&cameras)).unwrap_or_default();
    let started = Instant::now();
    while !log().contains(r#""showing":true"#) {
        assert!(started.elapsed() < PATIENCE, "{}", log());
        thread::sleep(Duration::from_millis(20));
    }
    // Nothing said since: when the tail has run out the helper hears that
    // frames are no longer wanted.
    let started = Instant::now();
    loop {
        let log = log();
        let shown = log.find(r#""showing":true"#).expect("shown");
        if log[shown..].contains(r#""showing":false"#) {
            break;
        }
        assert!(started.elapsed() < PATIENCE, "{log}");
        thread::sleep(Duration::from_millis(20));
    }
    helper.stop();
    let log = log();
    assert!(
        log.contains(r#""type":"link","address":"127.0.0.1:9""#),
        "{log}"
    );
    assert!(log.contains(r#""showing":false"#), "the first want: {log}");
    // The stand-in echoed the link's line, secret and all, into the log: the
    // supervisor itself never writes it anywhere but the helper's stdin.
    assert_eq!(log.matches(&"ab".repeat(32)).count(), 1, "{log}");
}
