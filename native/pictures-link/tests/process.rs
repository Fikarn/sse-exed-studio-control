//! The helper as the engine starts it: its own program, its stdin and stdout
//! piped. It says what it receives, speaks again within a second or two with
//! nothing asked, and ends when its stdin closes.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::pictures::{from_line, FromHelper};

/// Long enough for a slow gate run: nothing here asserts an upper bound
/// tighter than the helper's own second.
const PATIENCE: Duration = Duration::from_secs(30);

#[test]
fn the_helper_answers_speaks_every_second_and_ends_with_its_stdin() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_studio-control-pictures"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the helper starts");
    let mut stdin = child.stdin.take().expect("its stdin");
    let stdout = child.stdout.take().expect("its stdout");
    let (sender, lines) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { return };
            if sender.send(line).is_err() {
                return;
            }
        }
    });

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

    drop(stdin);
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().expect("its status reads") {
            assert!(status.success(), "{status}");
            break;
        }
        assert!(
            started.elapsed() < PATIENCE,
            "the helper ends when its stdin closes"
        );
        thread::sleep(Duration::from_millis(50));
    }
}
