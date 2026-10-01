//! No NDI where there is no Windows: vMix and NDI's SDK are on the studio's
//! PC alone (`ndi_library.rs`). The helper's receiving still compiles here and
//! its rules are tested; asked to load the library, it says why it cannot,
//! and nothing past the load is ever reached (the types below have no value).

use crate::ndi_sdk::{Captured, Taken};
use crate::vmix::{Announced, LibraryCounts};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub enum Ndi {}

impl Ndi {
    pub fn load(_library: &Path) -> Result<Self, String> {
        Err(String::from("is loaded on Windows alone"))
    }

    pub fn version(&self) -> &str {
        match *self {}
    }
}

pub enum Finder {}

impl Finder {
    pub fn open(ndi: &Arc<Ndi>) -> Result<Self, String> {
        match **ndi {}
    }

    pub fn look(&mut self, _wait: Duration) -> Vec<Announced> {
        match *self {}
    }
}

pub enum Receiver {}

impl Receiver {
    pub fn open(ndi: &Arc<Ndi>, _source: &Announced, _name: &str) -> Result<Self, String> {
        match **ndi {}
    }

    pub fn capture(&mut self, _wait: Duration, _take: &mut dyn FnMut(Taken<'_>)) -> Captured {
        match *self {}
    }

    pub fn counters(&self) -> LibraryCounts {
        match *self {}
    }
}
