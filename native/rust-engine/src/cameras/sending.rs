//! A press on its way to a camera (the audit of 2026-10-12, finding H1).
//! Until then a press waited for the camera's answer under the cameras' lock
//! and on the request loop: a Pocket out of reach cost every page and the
//! deck's displays 2 s per press. Now a press is begun under the lock (the
//! checks, the messages, the order to the link's thread), waited for with
//! the lock let go, and finished under the lock again (the camera's answer,
//! or its silence, read back). What waits is a [`SendTicket`]; what a link
//! hands back is a [`Sending`], done at once (the simulated cameras, a press
//! nothing carries) or waiting.

use crate::cameras::real_link::LinkFailure;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Instant;

/// A press the link's thread is writing: where its answer comes, and the
/// moment after which the camera is taken not to have answered (the thread
/// does not send it after that either, and withdraws a write it began).
#[derive(Debug)]
pub(crate) struct SendTicket {
    answer: Receiver<Result<(), String>>,
    deadline: Instant,
}

impl SendTicket {
    pub(crate) fn new(answer: Receiver<Result<(), String>>, deadline: Instant) -> Self {
        Self { answer, deadline }
    }

    #[cfg(test)]
    pub(crate) fn deadline(&self) -> Instant {
        self.deadline
    }

    /// Waits for the camera's answer, until the deadline at most. Never
    /// called under the cameras' lock.
    pub(crate) fn wait(self) -> Result<(), LinkFailure> {
        let left = self.deadline.saturating_duration_since(Instant::now());
        match self.answer.recv_timeout(left) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(sentence)) => Err(LinkFailure::Bluetooth(sentence)),
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
                Err(LinkFailure::NoAnswer)
            }
        }
    }
}

/// A press that was begun: answered already, or on its way.
#[derive(Debug)]
pub(crate) enum Sending {
    /// The link answered at once: the simulated cameras, or a press that
    /// could not be given to a link.
    Done(Result<(), LinkFailure>),
    /// The link's thread is writing it.
    Waiting(SendTicket),
}

impl Sending {
    /// Answered at once: taken, or not answered at all (the simulated
    /// cameras, which name no link of their own).
    pub(crate) fn done(taken: bool) -> Self {
        Self::Done(if taken {
            Ok(())
        } else {
            Err(LinkFailure::NoAnswer)
        })
    }

    /// The camera's answer, waited for if need be. Never called under the
    /// cameras' lock.
    pub(crate) fn wait(self) -> Result<(), LinkFailure> {
        match self {
            Self::Done(outcome) => outcome,
            Self::Waiting(ticket) => ticket.wait(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    // The ticket answers as the link did: well, with the link's sentence, or
    // not within its deadline; a thread that went away is no answer either.
    #[test]
    fn a_ticket_answers_as_the_link_did_or_times_out_at_its_deadline() {
        let (reply, answer) = channel();
        reply.send(Ok(())).expect("the test holds the receiver");
        let ticket = SendTicket::new(answer, Instant::now() + Duration::from_millis(50));
        assert_eq!(ticket.wait(), Ok(()));

        let (reply, answer) = channel();
        reply
            .send(Err(String::from("CAM 1 did not take the message.")))
            .expect("the test holds the receiver");
        let ticket = SendTicket::new(answer, Instant::now() + Duration::from_millis(50));
        assert_eq!(
            ticket.wait(),
            Err(LinkFailure::Bluetooth(String::from(
                "CAM 1 did not take the message."
            )))
        );

        let (reply, answer) = channel::<Result<(), String>>();
        let deadline = Instant::now() + Duration::from_millis(30);
        let ticket = SendTicket::new(answer, deadline);
        assert_eq!(ticket.deadline(), deadline);
        let started = Instant::now();
        assert_eq!(ticket.wait(), Err(LinkFailure::NoAnswer));
        assert!(
            started.elapsed() >= Duration::from_millis(25),
            "the wait lasts until the deadline"
        );
        drop(reply);

        let (reply, answer) = channel::<Result<(), String>>();
        drop(reply);
        let ticket = SendTicket::new(answer, Instant::now() + Duration::from_secs(5));
        let started = Instant::now();
        assert_eq!(ticket.wait(), Err(LinkFailure::NoAnswer));
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "a thread that is gone is no answer, at once"
        );

        assert_eq!(Sending::Done(Ok(())).wait(), Ok(()));
        assert_eq!(
            Sending::Done(Err(LinkFailure::NoLinkYet)).wait(),
            Err(LinkFailure::NoLinkYet)
        );
    }
}
