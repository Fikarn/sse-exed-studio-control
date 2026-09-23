//! Process-wide lighting state (2026-09 production readiness, Slice 10 —
//! F12, F18): the lock every lighting read-modify-write runs under, the one
//! preview buffer the IPC loop and the Stream Deck bridge share, and the
//! render generation the sACN thread watches instead of the database.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

use super::preview::LightingPreviewRuntimeState;

/// Serialises every read-modify-write of the lighting settings — above all
/// the editor-state blob, which each mutation loads whole and writes back
/// whole. SQLite already serialises the writes themselves; this protects the
/// load → mutate → persist window of the IPC loop against the bridge's
/// workers, and the workers against each other. Lock order everywhere:
/// `LIGHTING_STATE_LOCK` first, then the shared preview; a reader takes the
/// preview alone. Never held together with `AUDIO_STATE_LOCK`: no lighting
/// function calls into audio and no audio function into lighting. The mutex
/// is not re-entrant — the two `with_lighting_state*` functions below are
/// the only ones that take it, and nothing they run calls back into them.
static LIGHTING_STATE_LOCK: Mutex<()> = Mutex::new(());

/// Advanced whenever something the light output depends on may have changed.
/// The sACN thread renders from its cached settings until this moves.
static LIGHTING_RENDER_GENERATION: AtomicU64 = AtomicU64::new(0);

/// The preview buffer, one per process: a Stream Deck key pressed while the
/// operator previews on screen edits the same buffer the screen shows.
pub fn shared_lighting_preview() -> &'static Mutex<LightingPreviewRuntimeState> {
    static SHARED: OnceLock<Mutex<LightingPreviewRuntimeState>> = OnceLock::new();
    SHARED.get_or_init(|| Mutex::new(LightingPreviewRuntimeState::default()))
}

/// For readers (`lighting.snapshot`, the deck's LCD): the preview alone,
/// taken before the settings are read so the pair is consistent. A writer
/// goes through `with_lighting_state_and_preview`.
pub fn lock_shared_lighting_preview() -> MutexGuard<'static, LightingPreviewRuntimeState> {
    shared_lighting_preview()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn lighting_render_generation() -> u64 {
    LIGHTING_RENDER_GENERATION.load(Ordering::SeqCst)
}

/// For the writers that change what the wire carries without going through a
/// lighting function: the commissioned bridge address and universe.
pub fn bump_lighting_render_generation() {
    LIGHTING_RENDER_GENERATION.fetch_add(1, Ordering::SeqCst);
}

struct BumpGenerationOnDrop;

impl Drop for BumpGenerationOnDrop {
    fn drop(&mut self) {
        bump_lighting_render_generation();
    }
}

/// Runs one lighting mutation — its load, its change and its persist — under
/// the state lock, then advances the render generation while still holding
/// it. The generation moves whether the mutation succeeded or not: a refusal
/// costs the sACN thread one read, a missed change would cost the wire.
pub fn with_lighting_state<T>(mutate: impl FnOnce() -> T) -> T {
    let _state_guard = LIGHTING_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _bump = BumpGenerationOnDrop;
    mutate()
}

/// `with_lighting_state` for the preview-aware mutations: the state lock
/// first, then the shared preview, handed to the mutation.
pub fn with_lighting_state_and_preview<T>(
    mutate: impl FnOnce(&mut LightingPreviewRuntimeState) -> T,
) -> T {
    with_lighting_state(|| {
        let mut preview = lock_shared_lighting_preview();
        mutate(&mut preview)
    })
}

/// Every test that reads or writes through the shared preview holds this, so
/// one test's preview mode never shows up in another's snapshot.
#[cfg(test)]
static SHARED_PREVIEW_TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) fn reset_shared_preview() {
    *lock_shared_lighting_preview() = LightingPreviewRuntimeState::default();
}

/// Takes the test lock and starts the test from a preview that is off,
/// whatever the previous holder left behind.
#[cfg(test)]
pub(crate) fn shared_preview_test_guard() -> MutexGuard<'static, ()> {
    let guard = SHARED_PREVIEW_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    reset_shared_preview();
    guard
}
