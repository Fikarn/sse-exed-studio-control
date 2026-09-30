//! The helper as the engine starts it: its own program, its stdin and stdout
//! piped. It says what it receives, speaks again within a second or two with
//! nothing asked, and ends when its stdin closes.
//!
//! Every helper started here is started without vMix's switch and without
//! NDI's library, whatever the terminal holds (D33): no test opens vMix's
//! pictures or loads the library, and one test holds the helper to that.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::pictures::{
    from_line, FromHelper, HelperProblem, HelperSource, NDI_LIBRARY_ENV, VMIX_PICTURES_ENV,
};

/// Long enough for a slow gate run: nothing here asserts an upper bound
/// tighter than the helper's own second.
const PATIENCE: Duration = Duration::from_secs(30);

/// The helper, started as the engine starts it; `configure` may add to its
/// environment. Its stdout's lines and its stderr's come on two channels.
fn start(
    configure: impl FnOnce(&mut Command),
) -> (Child, ChildStdin, Receiver<String>, Receiver<String>) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_studio-control-pictures"));
    command
        .env_remove(VMIX_PICTURES_ENV)
        .env_remove(NDI_LIBRARY_ENV)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure(&mut command);
    let mut child = command.spawn().expect("the helper starts");
    let stdin = child.stdin.take().expect("its stdin");
    let lines = read_lines(child.stdout.take().expect("its stdout"));
    let said = read_lines(child.stderr.take().expect("its stderr"));
    (child, stdin, lines, said)
}

/// Each line of `input` on a channel, read on a thread of its own.
fn read_lines(input: impl std::io::Read + Send + 'static) -> Receiver<String> {
    let (sender, lines) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(input).lines() {
            let Ok(line) = line else { return };
            if sender.send(line).is_err() {
                return;
            }
        }
    });
    lines
}

/// Closes the helper's stdin and waits for it to end, as the engine does.
fn stop(mut child: Child, stdin: ChildStdin) {
    drop(stdin);
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().expect("its status reads") {
            assert!(status.success(), "{status}");
            return;
        }
        assert!(
            started.elapsed() < PATIENCE,
            "the helper ends when its stdin closes"
        );
        thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn the_helper_answers_speaks_every_second_and_ends_with_its_stdin() {
    let (child, mut stdin, lines, _said) = start(|_| {});
    writeln!(
        stdin,
        r#"{{"type":"want","cameras":[{{"camera":1,"vmixInput":2}},{{"camera":2,"vmixInput":5}},{{"camera":3,"vmixInput":4}}]}}"#
    )
    .expect("the want is written");
    stdin.flush().expect("flushed");

    let wanted = loop {
        let line = lines.recv_timeout(PATIENCE).expect("a state line");
        let FromHelper::State { cameras, .. } = from_line(&line).expect("a state");
        if cameras.len() == 3 {
            break cameras;
        }
    };
    assert_eq!(
        wanted
            .iter()
            .map(|camera| (camera.camera, camera.vmix_input, camera.receiving))
            .collect::<Vec<_>>(),
        [(1, 2, true), (2, 5, false), (3, 4, true)]
    );

    // Nothing asked: it speaks again all the same.
    let again = lines.recv_timeout(PATIENCE).expect("a second state line");
    assert!(
        again.contains(r#""vmixInput":5,"receiving":false"#),
        "{again}"
    );
    stop(child, stdin);
}

/// The first state line after a want of vMix's pictures.
fn told_vmix(lines: &Receiver<String>, stdin: &mut ChildStdin) -> FromHelper {
    writeln!(
        stdin,
        r#"{{"type":"want","cameras":[{{"camera":1,"vmixInput":1}},{{"camera":2,"vmixInput":2}},{{"camera":3,"vmixInput":3}}],"showing":true,"source":"vmix"}}"#
    )
    .expect("the want is written");
    stdin.flush().expect("flushed");
    let line = lines.recv_timeout(PATIENCE).expect("a state line");
    from_line(&line).expect("a state")
}

// The engine's word alone does not open vMix's pictures: a helper started
// without the switch takes none, and says so.
#[test]
fn a_helper_without_the_switch_takes_nothing_from_vmix() {
    let (child, mut stdin, lines, _said) = start(|_| {});
    let FromHelper::State {
        source,
        sending,
        problem,
        cameras,
    } = told_vmix(&lines, &mut stdin);
    assert_eq!(source, HelperSource::Vmix);
    assert!(!sending);
    assert_eq!(problem, Some(HelperProblem::NotAllowed));
    assert!(cameras.iter().all(|camera| !camera.receiving));
    stop(child, stdin);
}

// With the switch, a file that is not named as NDI's library is never
// loaded; nor is one named so whose SHA-256 is not the pinned one.
#[test]
fn a_helper_with_the_switch_loads_no_file_but_the_pinned_library() {
    let folder = std::env::temp_dir().join(format!("sse-pictures-process-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("a scratch folder");
    let named_so = folder.join("Processing.NDI.Lib.x64.dll");
    std::fs::write(&named_so, b"not NDI's library").expect("a scratch file");
    let not_named = std::env::current_exe().expect("this test's own program");
    for library in [&not_named, &named_so] {
        let (child, mut stdin, lines, said) = start(|command| {
            command
                .env(VMIX_PICTURES_ENV, "1")
                .env(NDI_LIBRARY_ENV, library);
        });
        let FromHelper::State {
            sending, problem, ..
        } = told_vmix(&lines, &mut stdin);
        assert!(!sending, "{}", library.display());
        assert_eq!(
            problem,
            Some(HelperProblem::NoLibrary),
            "{}",
            library.display()
        );
        stop(child, stdin);
        // The file named as the library was held to the pin before any
        // load was tried: the helper says so.
        if library == &named_so {
            // The helper has ended, so its stderr has closed: every line is in.
            let said: Vec<String> = said.iter().collect();
            assert!(
                said.iter()
                    .any(|line| line.contains("is not the pinned file")),
                "{said:?}"
            );
        }
    }
    let _ = std::fs::remove_dir_all(&folder);
}
