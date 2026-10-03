//! The deck's bridge's queue (fix D, 2026-10-02). The acceptor queues every
//! connection unread; the workers read each one as soon as they can and
//! answer a key's press at once, while a display's read is parked behind
//! every connection still unread. Companion's once-a-second poll sends 47
//! display reads at one instant: before this, a press that came just after
//! them waited for all 47 to be answered, and for as long as any of them
//! stalled. Reading is short (Companion's bytes are there when it connects),
//! answering is what takes the time.
//!
//! A read parked for `parked_at_most` is answered before the unread
//! connections (the review of #291): a backlog of presses (a fast spin of a
//! dial during a stall) never freezes the displays, and a parked read does
//! not hold its place in the queue for longer.
//!
//! The queue is bounded (finding F06): unread connections and parked reads
//! together hold at most `capacity`. A press that finds it full takes one of
//! `reserve` slots kept for presses, since Companion never sends a refused
//! press again; anything else is refused by the bridge.

use std::collections::VecDeque;
use std::net::TcpStream;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// What a worker is handed next.
pub(crate) enum Next<R> {
    /// A connection not read yet, with the moment it arrived.
    Unread(TcpStream, Instant),
    /// A read, parked until no connection waits unread.
    Parked(R),
    /// The acceptor is gone and nothing waits.
    Closed,
}

struct Lines<R> {
    unread: VecDeque<(TcpStream, Instant)>,
    /// Each parked read with the moment it was parked.
    parked: VecDeque<(R, Instant)>,
    closed: bool,
}

impl<R> Lines<R> {
    fn depth(&self) -> usize {
        self.unread.len() + self.parked.len()
    }
}

pub(crate) struct Pool<R> {
    lines: Mutex<Lines<R>>,
    waiting: Condvar,
    capacity: usize,
    reserve: usize,
    parked_at_most: Duration,
}

impl<R> Pool<R> {
    pub(crate) fn new(capacity: usize, reserve: usize, parked_at_most: Duration) -> Self {
        Self {
            lines: Mutex::new(Lines {
                unread: VecDeque::new(),
                parked: VecDeque::new(),
                closed: false,
            }),
            waiting: Condvar::new(),
            capacity: capacity.max(1),
            reserve,
            parked_at_most,
        }
    }

    fn lines(&self) -> MutexGuard<'_, Lines<R>> {
        self.lines
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Queues a connection while the queue has room, and answers how many
    /// wait with it; a full queue gives it back.
    pub(crate) fn offer(&self, stream: TcpStream, arrived: Instant) -> Result<usize, TcpStream> {
        self.queue(stream, arrived, self.capacity)
    }

    /// Queues a press in a slot kept for presses: for a queue that is full.
    pub(crate) fn offer_press(
        &self,
        stream: TcpStream,
        arrived: Instant,
    ) -> Result<usize, TcpStream> {
        self.queue(stream, arrived, self.capacity + self.reserve)
    }

    fn queue(&self, stream: TcpStream, arrived: Instant, room: usize) -> Result<usize, TcpStream> {
        let mut lines = self.lines();
        if lines.depth() >= room {
            return Err(stream);
        }
        lines.unread.push_back((stream, arrived));
        let depth = lines.depth();
        drop(lines);
        self.waiting.notify_one();
        Ok(depth)
    }

    /// Parks a read that was taken off the unread line: it is answered once
    /// no connection waits unread, or once it has waited `parked_at_most`. It
    /// took its place in the queue when it came, so it is never turned away
    /// here.
    pub(crate) fn park(&self, read: R) {
        self.lines().parked.push_back((read, Instant::now()));
        self.waiting.notify_one();
    }

    /// The next thing to do, waiting until there is one: a read parked for
    /// `parked_at_most`, then an unread connection, then the oldest parked
    /// read.
    pub(crate) fn next(&self) -> Next<R> {
        let mut lines = self.lines();
        loop {
            let overdue = lines
                .parked
                .front()
                .is_some_and(|(_, parked_at)| parked_at.elapsed() >= self.parked_at_most);
            if !overdue {
                if let Some((stream, arrived)) = lines.unread.pop_front() {
                    return Next::Unread(stream, arrived);
                }
            }
            if let Some((read, _)) = lines.parked.pop_front() {
                return Next::Parked(read);
            }
            if lines.closed {
                return Next::Closed;
            }
            lines = self
                .waiting
                .wait(lines)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    /// The acceptor is gone: the workers finish what waits, then stop.
    pub(crate) fn close(&self) {
        self.lines().closed = true;
        self.waiting.notify_all();
    }

    /// How many connections and parked reads wait.
    #[cfg(test)]
    pub(crate) fn depth(&self) -> usize {
        self.lines().depth()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// A parked read waits this long in the tests that are not about it.
    const LONG: Duration = Duration::from_secs(60);

    /// One end of a loopback connection, as the acceptor gets it.
    fn connection(listener: &TcpListener) -> TcpStream {
        let _client = TcpStream::connect(listener.local_addr().expect("address")).expect("connect");
        listener.accept().expect("accept").0
    }

    fn listener() -> TcpListener {
        TcpListener::bind(("127.0.0.1", 0)).expect("an ephemeral loopback port")
    }

    fn what<R: std::fmt::Debug>(next: Next<R>) -> String {
        match next {
            Next::Unread(_, _) => String::from("unread"),
            Next::Parked(read) => format!("parked {read:?}"),
            Next::Closed => String::from("closed"),
        }
    }

    #[test]
    fn an_unread_connection_comes_before_a_parked_read() {
        let listener = listener();
        let pool = Pool::<&str>::new(8, 2, LONG);
        pool.park("lcd 1");
        pool.park("lcd 2");
        pool.offer(connection(&listener), Instant::now())
            .expect("room");
        assert_eq!(what(pool.next()), "unread");
        assert_eq!(what(pool.next()), "parked \"lcd 1\"");
        assert_eq!(what(pool.next()), "parked \"lcd 2\"");
    }

    // The review of #291: a backlog of presses must not freeze the displays.
    #[test]
    fn a_read_parked_long_enough_comes_before_an_unread_connection() {
        let listener = listener();
        let pool = Pool::<&str>::new(8, 2, Duration::from_millis(30));
        pool.park("lcd 1");
        pool.offer(connection(&listener), Instant::now())
            .expect("room");
        assert_eq!(what(pool.next()), "unread", "parked a moment ago");
        pool.park("lcd 2");
        pool.offer(connection(&listener), Instant::now())
            .expect("room");
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(what(pool.next()), "parked \"lcd 1\"", "parked long enough");
        assert_eq!(what(pool.next()), "parked \"lcd 2\"");
        assert_eq!(what(pool.next()), "unread");
    }

    #[test]
    fn a_full_queue_counts_the_parked_reads_and_keeps_its_slots_for_presses() {
        let listener = listener();
        let pool = Pool::<&str>::new(3, 1, LONG);
        pool.park("lcd 1");
        assert_eq!(
            pool.offer(connection(&listener), Instant::now()).ok(),
            Some(2)
        );
        assert_eq!(
            pool.offer(connection(&listener), Instant::now()).ok(),
            Some(3)
        );
        assert!(
            pool.offer(connection(&listener), Instant::now()).is_err(),
            "full"
        );
        assert_eq!(
            pool.offer_press(connection(&listener), Instant::now()).ok(),
            Some(4),
            "a press takes the slot kept for it"
        );
        assert!(
            pool.offer_press(connection(&listener), Instant::now())
                .is_err(),
            "the slots kept for presses are bounded too"
        );
        assert_eq!(pool.depth(), 4);
    }

    #[test]
    fn a_closed_queue_hands_out_what_waits_then_stops_its_workers() {
        let pool = std::sync::Arc::new(Pool::<&str>::new(4, 0, LONG));
        pool.park("lcd 1");
        pool.close();
        assert_eq!(what(pool.next()), "parked \"lcd 1\"");
        assert_eq!(what(pool.next()), "closed");

        // A worker that waits is woken by the close.
        let waiting = std::sync::Arc::new(Pool::<&str>::new(4, 0, LONG));
        let worker = {
            let waiting = std::sync::Arc::clone(&waiting);
            std::thread::spawn(move || what(waiting.next()))
        };
        std::thread::sleep(Duration::from_millis(50));
        waiting.close();
        assert_eq!(worker.join().expect("the worker"), "closed");
    }
}
