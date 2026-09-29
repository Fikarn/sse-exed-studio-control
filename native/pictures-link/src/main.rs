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
//! Its one source is the simulated one: test pictures on vMix inputs 1 to 4
//! (`simulated_state`, `card.rs`). While the Cameras page shows them it sends
//! them as frames to the shell's listener on 127.0.0.1, whose address and
//! secret the engine tells it (`frames.rs`); it opens no device. A studio
//! build does not start it until NDI is built (the owner, 2026-09-29), and a
//! studio build of it refuses to run.

mod card;
mod frames;

use std::io::{self, BufReader, Read, Write};
use std::process::ExitCode;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Instant;
use studio_control_protocol::pictures::{
    from_line, read_line_bounded, simulated_state, to_line, ToHelper, WantedCamera, STATE_INTERVAL,
};

fn main() -> ExitCode {
    if studio_control_protocol::development::studio_build() {
        eprintln!(
            "The pictures helper has only the simulated source, which a studio build does not use."
        );
        return ExitCode::from(2);
    }
    let (orders, received) = mpsc::channel();
    let sender = thread::Builder::new()
        .name(String::from("frames"))
        .spawn(move || frames::run(&received));
    let stdout = io::stdout();
    run(io::stdin(), &mut stdout.lock(), &orders);
    drop(orders);
    if let Ok(sender) = sender {
        let _ = sender.join();
    }
    ExitCode::SUCCESS
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
/// wants to the frame sender, and says what it receives, until its input
/// closes or its output cannot be written. It says nothing before the first
/// want: a helper that was never told the cameras has nothing to say, and
/// the engine would read its silence as a hang.
fn run(input: impl Read + Send + 'static, output: &mut impl Write, orders: &Sender<frames::Order>) {
    let lines = spawn_reader(input);
    let mut want: Option<Vec<WantedCamera>> = None;
    let mut said: Option<String> = None;
    let mut due = Instant::now();
    loop {
        match lines.recv_timeout(due.saturating_duration_since(Instant::now())) {
            Ok(Input::Line(Ok(ToHelper::Want {
                cameras,
                selected,
                showing,
            }))) => {
                let _ = orders.send(frames::Order::Want {
                    cameras: cameras.clone(),
                    selected,
                    showing,
                });
                want = Some(cameras);
            }
            Ok(Input::Line(Ok(ToHelper::Link { address, secret }))) => {
                match frames::listener_address(&address) {
                    Ok(address) => {
                        let _ = orders.send(frames::Order::Link(address, secret));
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
        let Some(want) = &want else {
            due = Instant::now() + STATE_INTERVAL;
            continue;
        };
        let line = to_line(&simulated_state(want));
        if said.as_deref() != Some(line.as_str()) || Instant::now() >= due {
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

    #[test]
    fn it_says_what_it_receives_for_the_cameras_wanted_and_ends_with_its_input() {
        let input = concat!(
            r#"{"type":"want","cameras":[{"camera":1,"vmixInput":1},{"camera":2,"vmixInput":7},{"camera":3,"vmixInput":3}]}"#,
            "\n"
        );
        let mut output = Vec::new();
        run(
            io::Cursor::new(input.as_bytes().to_vec()),
            &mut output,
            &mpsc::channel().0,
        );
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
        let mut output = Vec::new();
        run(
            io::Cursor::new(b"\n\n".to_vec()),
            &mut output,
            &mpsc::channel().0,
        );
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
        let mut output = Vec::new();
        run(
            io::Cursor::new(input.as_bytes().to_vec()),
            &mut output,
            &mpsc::channel().0,
        );
        let FromHelper::State { cameras, .. } = states(&output).pop().expect("a line");
        assert_eq!(cameras.len(), 1);
        assert!(!cameras[0].receiving);
    }
}
