//! The Teleprompter in the hardware link (new pages program, Slice 4): the
//! scripts and the prompter in the saved data, the scroll's clock, the
//! `prompter.*` methods and the import. The design is
//! `docs/redesign/teleprompter-2026-09.md` (the ledger's D20), and the
//! slice's first steps, answered by the operator on 2026-09-27, are recorded
//! under the ledger's Slice 4.

pub(crate) mod import;
pub(crate) mod model;
