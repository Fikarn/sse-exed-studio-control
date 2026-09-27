//! The cameras in the hardware link (new pages program, Slice 8): the three
//! cameras, who holds each, what each reports, the selection, the simulated
//! cameras every test, lane and scratch run uses, and Setup's part of them in
//! the saved data. The contract is `v1.md`'s "Cameras" section; the slice's
//! first steps, answered by the operator on 2026-09-27, are recorded under
//! the ledger's Slice 8.

pub(crate) mod snapshot;
