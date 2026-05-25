//! plan PR 7 / workstream E2.
//!
//! Asserts that every method named in `native/protocol/v1.contract.json`
//! has a matching dispatch arm in the rust-engine source, and that every
//! event named in the contract has a matching `EVENT_*` constant exported
//! from `studio-control-protocol`.
//!
//! The plan suggested introducing a `KNOWN_METHODS: &[&str]` slice as the
//! single source of truth, but the dispatch is already centralised in one
//! file (`src/app.rs`, with one extra arm in `src/control_surface.rs`), so
//! a source-scan test is simpler and doesn't require adding a runtime
//! check at every dispatch site. If the dispatch ever splits across more
//! files, the workaround is to add another `include_str!` here — the
//! contract → source comparison stays the same shape.
//!
//! The test lives in `rust-engine/tests/` rather than the plan's stated
//! `protocol/tests/contract.rs` because the source files we need to scan
//! belong to rust-engine. Documented divergence; logged in the PR body.

use serde_json::Value;
use studio_control_protocol::EVENT_NAMES;

const CONTRACT_JSON: &str = include_str!("../../protocol/v1.contract.json");
const APP_DISPATCH_SOURCE: &str = include_str!("../src/app.rs");
const CONTROL_SURFACE_DISPATCH_SOURCE: &str = include_str!("../src/control_surface.rs");

#[test]
fn every_contract_method_has_a_dispatch_arm() {
    let contract: Value = serde_json::from_str(CONTRACT_JSON).expect("contract JSON must parse");
    let methods = contract["methods"]
        .as_array()
        .expect("contract.methods must be an array");

    let mut missing = Vec::new();
    for method in methods {
        let name = method
            .as_str()
            .expect("contract.methods entries must be strings");
        // Match the literal `"method.name" =>` pattern that every dispatch
        // arm uses. Plain `"method.name"` (without the fat-arrow) would
        // catch unrelated occurrences (error messages, doc comments).
        let arm = format!("\"{name}\" =>");
        if !APP_DISPATCH_SOURCE.contains(&arm) && !CONTROL_SURFACE_DISPATCH_SOURCE.contains(&arm) {
            missing.push(name.to_string());
        }
    }

    assert!(
        missing.is_empty(),
        "{} contract method(s) have no dispatch arm in app.rs or control_surface.rs: {:?}.\n\
         Either add the dispatch arm in the engine, or remove the method from v1.contract.json.",
        missing.len(),
        missing
    );
}

#[test]
fn every_dispatch_arm_appears_in_the_contract() {
    let contract: Value = serde_json::from_str(CONTRACT_JSON).expect("contract JSON must parse");
    let methods: std::collections::HashSet<&str> = contract["methods"]
        .as_array()
        .expect("contract.methods must be an array")
        .iter()
        .map(|value| value.as_str().expect("methods entries are strings"))
        .collect();

    // Scan for every `"name" =>` arm in the dispatch sources. The regex-free
    // approach: split each source on `=>`, look at the suffix of the line
    // before the arrow, and pull out the quoted method name.
    let mut undocumented = Vec::new();
    for source in [APP_DISPATCH_SOURCE, CONTROL_SURFACE_DISPATCH_SOURCE] {
        for line in source.lines() {
            let line = line.trim_start();
            // Only count single quoted strings at the start of an arm.
            if !line.starts_with('"') {
                continue;
            }
            let Some(name_end) = line[1..].find('"') else {
                continue;
            };
            let after_quote = &line[name_end + 2..];
            if !after_quote.trim_start().starts_with("=>") {
                continue;
            }
            let name = &line[1..name_end + 1];
            // Exclude internal sub-keys that contain no dot — those are
            // nested match arms (e.g. control-surface sub-paths), not
            // top-level IPC methods.
            if !name.contains('.') {
                continue;
            }
            if !methods.contains(name) {
                undocumented.push(name.to_string());
            }
        }
    }
    undocumented.sort();
    undocumented.dedup();

    assert!(
        undocumented.is_empty(),
        "{} dispatch arm(s) are not declared in v1.contract.json: {:?}.\n\
         Either add the method to v1.contract.json (and run `npm run protocol:generate`), or \
         remove the dispatch arm.",
        undocumented.len(),
        undocumented
    );
}

#[test]
fn every_contract_event_has_a_protocol_constant() {
    let contract: Value = serde_json::from_str(CONTRACT_JSON).expect("contract JSON must parse");
    let events = contract["events"]
        .as_array()
        .expect("contract.events must be an array");

    let known: std::collections::HashSet<&str> = EVENT_NAMES.iter().copied().collect();
    let mut missing = Vec::new();
    for event in events {
        let name = event
            .as_str()
            .expect("contract.events entries must be strings");
        if !known.contains(name) {
            missing.push(name.to_string());
        }
    }

    assert!(
        missing.is_empty(),
        "{} contract event(s) have no EVENT_* constant in studio-control-protocol: {:?}",
        missing.len(),
        missing
    );
}

#[test]
fn every_protocol_event_constant_appears_in_the_contract() {
    let contract: Value = serde_json::from_str(CONTRACT_JSON).expect("contract JSON must parse");
    let events: std::collections::HashSet<&str> = contract["events"]
        .as_array()
        .expect("contract.events must be an array")
        .iter()
        .map(|value| value.as_str().expect("events entries are strings"))
        .collect();

    let mut extra = Vec::new();
    for name in EVENT_NAMES {
        if !events.contains(name) {
            extra.push((*name).to_string());
        }
    }

    assert!(
        extra.is_empty(),
        "{} EVENT_* constant(s) are exported by studio-control-protocol but not in v1.contract.json: {:?}",
        extra.len(),
        extra
    );
}
