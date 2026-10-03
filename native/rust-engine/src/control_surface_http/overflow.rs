//! The bridge's overflow (fix D, 2026-10-02): what happens to a connection
//! that finds the queue full. The acceptor hands it to a thread of its own,
//! which never holds the acceptor: a press takes one of the slots kept for
//! presses, anything else is answered `503` and drained.

use super::{finish_connection, write_http_response, BridgeContext, HttpResponse, ParkedRead};
use crate::control_surface::ControlSurfaceError;
use crate::control_surface_pool::Pool;
use crate::diagnostics::append_log;
use std::io::ErrorKind;
use std::net::TcpStream;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const BUSY_WRITE_TIMEOUT: Duration = Duration::from_millis(200);
/// How long the overflow thread looks at a connection that found the queue
/// full for the start of a press. Companion's bytes are there at once; an
/// idle connection costs the overflow thread this, never the acceptor.
const PRESS_PEEK_WAIT: Duration = Duration::from_millis(50);
/// Connections that wait for the overflow thread: more than one poll's
/// displays and every slot kept for presses (the review of #291: at 32, a
/// poll that found the queue full lost a press with the slots still free).
/// It holds sockets, not threads. Past it a connection is closed unanswered,
/// and the minute counts it.
const OVERFLOW_QUEUE: usize = 128;
const BUSY_MESSAGE: &str = "The bridge is busy with other requests; retry shortly.";

/// The overflow thread (fix D, 2026-10-02): a connection that found the
/// queue full. It looks for the start of a press for `PRESS_PEEK_WAIT` at
/// most; a press takes a slot kept for presses, anything else is answered
/// 503 and drained as `finish_connection` drains, so the client reads its
/// status rather than a reset. The acceptor never waits on it.
pub(super) fn spawn_overflow(pool: Arc<Pool<ParkedRead>>, context: Arc<BridgeContext>) -> Overflow {
    let (sender, receiver) = sync_channel::<(TcpStream, Instant)>(OVERFLOW_QUEUE);
    let waiting = Arc::new(AtomicUsize::new(0));
    let log_file_path = context.log_file_path.clone();
    let thread_waiting = Arc::clone(&waiting);
    let spawned = thread::Builder::new()
        .name(String::from("control-surface-overflow"))
        .spawn(move || {
            for (stream, arrived) in receiver {
                // A panic costs this connection, never the thread: the slots
                // kept for presses stay (the review of #291).
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    overflow_one(&pool, &context, stream, arrived);
                }));
                thread_waiting.fetch_sub(1, Ordering::AcqRel);
            }
        });
    if let Err(error) = spawned {
        let _ = append_log(
            log_file_path.as_path(),
            "ERROR",
            &format!("Control-surface bridge could not start its overflow thread: {error}"),
        );
    }
    Overflow { sender, waiting }
}

/// The overflow thread's line, and how many connections wait in it or are
/// on the overflow thread.
pub(super) struct Overflow {
    pub(super) sender: SyncSender<(TcpStream, Instant)>,
    pub(super) waiting: Arc<AtomicUsize>,
}

/// Where the acceptor puts a connection: in the queue, unless connections
/// wait for the overflow thread. Then the overflow thread takes every
/// connection, in the order they came, so a press that waits there is never
/// overtaken by a later one that found room (the review of #291).
pub(super) fn accept(
    pool: &Pool<ParkedRead>,
    overflow: &Overflow,
    context: &BridgeContext,
    stream: TcpStream,
    arrived: Instant,
) {
    let stream = if overflow.waiting.load(Ordering::Acquire) == 0 {
        match pool.offer(stream, arrived) {
            Ok(depth) => {
                context.minute().note_depth(depth);
                return;
            }
            Err(stream) => stream,
        }
    } else {
        stream
    };
    overflow.waiting.fetch_add(1, Ordering::AcqRel);
    if overflow.sender.try_send((stream, arrived)).is_err() {
        overflow.waiting.fetch_sub(1, Ordering::AcqRel);
        context.minute().note_refused();
        context.note_dropped();
    }
}

/// One connection on the overflow thread: queued if the queue has room
/// again, in a slot kept for presses if it is a press, else answered 503.
fn overflow_one(
    pool: &Pool<ParkedRead>,
    context: &BridgeContext,
    stream: TcpStream,
    arrived: Instant,
) {
    let stream = match pool.offer(stream, arrived) {
        Ok(depth) => {
            context.minute().note_depth(depth);
            return;
        }
        Err(stream) => stream,
    };
    let stream = if starts_a_press(&stream) {
        match pool.offer_press(stream, arrived) {
            Ok(depth) => {
                context.minute().note_depth(depth);
                return;
            }
            Err(stream) => stream,
        }
    } else {
        stream
    };
    context.minute().note_refused();
    context.note_rejection(503, BUSY_MESSAGE);
    answer_busy(stream);
}

/// Whether the connection's first bytes are a POST: a press, which is a
/// POST to a page's route (a POST to another route is answered as one).
fn starts_a_press(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return false;
    }
    let until = Instant::now() + PRESS_PEEK_WAIT;
    let mut head = [0_u8; 5];
    let press = loop {
        match stream.peek(&mut head) {
            Ok(read) if read == head.len() => break &head == b"POST ",
            Ok(0) => break false,
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::WouldBlock => {}
            Err(_) => break false,
        }
        if Instant::now() >= until {
            break false;
        }
        thread::sleep(Duration::from_millis(1));
    };
    let _ = stream.set_nonblocking(false);
    press
}

fn answer_busy(mut stream: TcpStream) {
    let _ = stream.set_write_timeout(Some(BUSY_WRITE_TIMEOUT));
    let response = HttpResponse::from_error(&ControlSurfaceError::Busy(String::from(BUSY_MESSAGE)));
    let _ = write_http_response(&mut stream, response.status_code, &response.body);
    finish_connection(stream);
}
