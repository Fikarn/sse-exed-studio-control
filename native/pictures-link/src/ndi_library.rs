//! NDI's library (D17, D31 to D33): the NDI SDK's own
//! `Processing.NDI.Lib.x64.dll`, loaded once by the full path the helper was
//! given (`vmix::permission` held it to the SDK's file, and `npm run app`
//! checked its hash against the pin) and never unloaded. Each function is
//! taken by its name and called with the types of its declaration in the
//! SDK's headers; the structures are `ndi_sdk.rs`'s, whose tests hold them to
//! the headers' layout.
//!
//! The calls stand in the free functions below, each listed with its reason
//! in `PICTURES_UNSAFE` (`scripts/check-no-shortcuts.test.mjs`). Around them
//! stand three owners, each used on the one thread that made it: `Ndi`, the
//! library, shared by every thread; `Finder`, NDI's search; and `Receiver`,
//! one camera's connection, which frees each frame it takes.

use crate::ndi_sdk::{
    check_video, AudioFrameV3, Captured, FindCreate, MetadataFrame, Performance, Queue,
    RecvCreateV3, Source, Taken, VideoFrameV2, FRAME_AUDIO, FRAME_ERROR, FRAME_METADATA,
    FRAME_NONE, FRAME_VIDEO,
};
use crate::vmix::{Announced, LibraryCounts};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;
use std::ptr::NonNull;
use std::sync::Arc;
use std::time::Duration;
use windows::core::{s, HSTRING};
use windows::Win32::System::LibraryLoader::{
    GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
    LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
};

/// The most sources one look of the search reads.
const MOST_SOURCES: usize = 256;

/// What `GetProcAddress` hands back for a name.
type Symbol = unsafe extern "system" fn() -> isize;

/// The library's functions this helper calls, as the SDK's headers declare
/// them (`Processing.NDI.Lib.h`, `.Find.h`, `.Recv.h`).
#[derive(Clone, Copy)]
struct Functions {
    initialize: unsafe extern "C" fn() -> bool,
    version: unsafe extern "C" fn() -> *const c_char,
    find_create: unsafe extern "C" fn(*const FindCreate) -> *mut c_void,
    find_destroy: unsafe extern "C" fn(*mut c_void),
    find_wait: unsafe extern "C" fn(*mut c_void, u32) -> bool,
    find_sources: unsafe extern "C" fn(*mut c_void, *mut u32) -> *const Source,
    recv_create: unsafe extern "C" fn(*const RecvCreateV3) -> *mut c_void,
    recv_destroy: unsafe extern "C" fn(*mut c_void),
    recv_capture: unsafe extern "C" fn(
        *mut c_void,
        *mut VideoFrameV2,
        *mut AudioFrameV3,
        *mut MetadataFrame,
        u32,
    ) -> c_int,
    free_video: unsafe extern "C" fn(*mut c_void, *const VideoFrameV2),
    free_audio: unsafe extern "C" fn(*mut c_void, *const AudioFrameV3),
    free_metadata: unsafe extern "C" fn(*mut c_void, *const MetadataFrame),
    recv_performance: unsafe extern "C" fn(*mut c_void, *mut Performance, *mut Performance),
    recv_queue: unsafe extern "C" fn(*mut c_void, *mut Queue),
    recv_connections: unsafe extern "C" fn(*mut c_void) -> c_int,
}

/// NDI's library, loaded and started.
pub struct Ndi {
    functions: Functions,
    version: String,
}

impl Ndi {
    /// Loads the library at `library` (a full path) and starts it.
    pub fn load(library: &Path) -> Result<Self, String> {
        let functions = load_functions(library)?;
        let version = start_library(&functions)?;
        Ok(Self { functions, version })
    }

    /// The version the library says it is.
    pub fn version(&self) -> &str {
        &self.version
    }
}

/// Milliseconds for the library, at most a minute.
fn millis(wait: Duration) -> u32 {
    u32::try_from(wait.as_millis().min(60_000)).unwrap_or(60_000)
}

/// NDI's search. It lists the sources it hears of; it connects to none.
pub struct Finder {
    ndi: Arc<Ndi>,
    finder: NonNull<c_void>,
}

impl Finder {
    pub fn open(ndi: &Arc<Ndi>) -> Result<Self, String> {
        let finder = find_open(&ndi.functions).ok_or("the library made no search")?;
        Ok(Self {
            ndi: Arc::clone(ndi),
            finder,
        })
    }

    /// Waits up to `wait` for a change, then says every source listed now.
    pub fn look(&mut self, wait: Duration) -> Vec<Announced> {
        find_look(&self.ndi.functions, self.finder, millis(wait))
    }
}

impl Drop for Finder {
    fn drop(&mut self) {
        find_close(&self.ndi.functions, self.finder);
    }
}

/// The frames a receiver captures into.
struct Frames {
    video: VideoFrameV2,
    audio: AudioFrameV3,
    metadata: MetadataFrame,
}

/// One camera's connection to its source: the whole picture, as UYVY.
pub struct Receiver {
    ndi: Arc<Ndi>,
    receiver: NonNull<c_void>,
    frames: Frames,
    /// The source's name and address and the receiver's own name, for the
    /// receiver's life.
    _strings: [CString; 3],
}

impl Receiver {
    /// Connects to `source`, as the search listed it, under `name`.
    pub fn open(ndi: &Arc<Ndi>, source: &Announced, name: &str) -> Result<Self, String> {
        let text =
            |value: &str| CString::new(value).map_err(|_| format!("{value:?} holds a zero byte"));
        let strings = [text(&source.name)?, text(&source.url)?, text(name)?];
        let settings = RecvCreateV3::whole_picture(
            strings[0].as_ptr(),
            strings[1].as_ptr(),
            strings[2].as_ptr(),
        );
        let receiver =
            receiver_open(&ndi.functions, &settings).ok_or("the library made no receiver")?;
        Ok(Self {
            ndi: Arc::clone(ndi),
            receiver,
            frames: Frames {
                video: VideoFrameV2::empty(),
                audio: AudioFrameV3::empty(),
                metadata: MetadataFrame::empty(),
            },
            _strings: strings,
        })
    }

    /// Waits up to `wait` for a frame. A video frame is handed to `take`,
    /// its picture with it when `check_video` takes it, or why not, and is
    /// freed when `take` returns; any other frame is freed at once.
    pub fn capture(&mut self, wait: Duration, take: &mut dyn FnMut(Taken<'_>)) -> Captured {
        receiver_capture(
            &self.ndi.functions,
            self.receiver,
            &mut self.frames,
            millis(wait),
            take,
        )
    }

    /// The library's counts of this receiver.
    pub fn counters(&self) -> LibraryCounts {
        receiver_counters(&self.ndi.functions, self.receiver)
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        receiver_close(&self.ndi.functions, self.receiver);
    }
}

/// Loads the library and takes its functions by name.
#[allow(unsafe_code)]
fn load_functions(library: &Path) -> Result<Functions, String> {
    let path = HSTRING::from(library);
    // SAFETY: the library is loaded by its full path, with its own folder and
    // Windows' own for what it needs, and never freed, so every function
    // taken from it lives as long as the process. Each is taken by its name
    // and given the type the SDK's headers declare for it; a name the library
    // lacks fails the load before anything is called.
    unsafe {
        let module = LoadLibraryExW(
            &path,
            None,
            LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
        )
        .map_err(|error| format!("did not load: {error}"))?;
        macro_rules! function {
            ($name:literal, $type:ty) => {
                std::mem::transmute::<Symbol, $type>(
                    GetProcAddress(module, s!($name)).ok_or(concat!("has no ", $name))?,
                )
            };
        }
        Ok(Functions {
            initialize: function!("NDIlib_initialize", unsafe extern "C" fn() -> bool),
            version: function!("NDIlib_version", unsafe extern "C" fn() -> *const c_char),
            find_create: function!(
                "NDIlib_find_create_v2",
                unsafe extern "C" fn(*const FindCreate) -> *mut c_void
            ),
            find_destroy: function!("NDIlib_find_destroy", unsafe extern "C" fn(*mut c_void)),
            find_wait: function!(
                "NDIlib_find_wait_for_sources",
                unsafe extern "C" fn(*mut c_void, u32) -> bool
            ),
            find_sources: function!(
                "NDIlib_find_get_current_sources",
                unsafe extern "C" fn(*mut c_void, *mut u32) -> *const Source
            ),
            recv_create: function!(
                "NDIlib_recv_create_v3",
                unsafe extern "C" fn(*const RecvCreateV3) -> *mut c_void
            ),
            recv_destroy: function!("NDIlib_recv_destroy", unsafe extern "C" fn(*mut c_void)),
            recv_capture: function!(
                "NDIlib_recv_capture_v3",
                unsafe extern "C" fn(
                    *mut c_void,
                    *mut VideoFrameV2,
                    *mut AudioFrameV3,
                    *mut MetadataFrame,
                    u32,
                ) -> c_int
            ),
            free_video: function!(
                "NDIlib_recv_free_video_v2",
                unsafe extern "C" fn(*mut c_void, *const VideoFrameV2)
            ),
            free_audio: function!(
                "NDIlib_recv_free_audio_v3",
                unsafe extern "C" fn(*mut c_void, *const AudioFrameV3)
            ),
            free_metadata: function!(
                "NDIlib_recv_free_metadata",
                unsafe extern "C" fn(*mut c_void, *const MetadataFrame)
            ),
            recv_performance: function!(
                "NDIlib_recv_get_performance",
                unsafe extern "C" fn(*mut c_void, *mut Performance, *mut Performance)
            ),
            recv_queue: function!(
                "NDIlib_recv_get_queue",
                unsafe extern "C" fn(*mut c_void, *mut Queue)
            ),
            recv_connections: function!(
                "NDIlib_recv_get_no_connections",
                unsafe extern "C" fn(*mut c_void) -> c_int
            ),
        })
    }
}

/// Starts the library and reads its version.
#[allow(unsafe_code)]
fn start_library(functions: &Functions) -> Result<String, String> {
    // SAFETY: two calls without arguments. The version is a string the
    // library keeps for its life; it is copied here.
    unsafe {
        if !(functions.initialize)() {
            return Err(String::from(
                "would not start (NDIlib_initialize: this processor is not one it supports)",
            ));
        }
        let version = (functions.version)();
        Ok(if version.is_null() {
            String::from("of no version it says")
        } else {
            CStr::from_ptr(version).to_string_lossy().into_owned()
        })
    }
}

/// Makes NDI's search.
#[allow(unsafe_code)]
fn find_open(functions: &Functions) -> Option<NonNull<c_void>> {
    let settings = FindCreate::this_pc();
    // SAFETY: the settings live across the call, which reads them; their two
    // strings are null, which the header allows.
    unsafe { NonNull::new((functions.find_create)(&settings)) }
}

/// Waits for a change, then copies every source listed now.
#[allow(unsafe_code)]
fn find_look(functions: &Functions, finder: NonNull<c_void>, wait: u32) -> Vec<Announced> {
    // SAFETY: `finder` is a search the library made and has not destroyed,
    // used on the one thread that owns it. The list the library returns
    // holds `count` sources and stays valid until the next call on this
    // search; every string in it is copied here before then, and a null one
    // is read as none.
    unsafe {
        let _ = (functions.find_wait)(finder.as_ptr(), wait);
        let mut count: u32 = 0;
        let sources = (functions.find_sources)(finder.as_ptr(), &mut count);
        if sources.is_null() {
            return Vec::new();
        }
        let listed = std::slice::from_raw_parts(sources, (count as usize).min(MOST_SOURCES));
        let text = |pointer: *const c_char| {
            (!pointer.is_null()).then(|| CStr::from_ptr(pointer).to_string_lossy().into_owned())
        };
        listed
            .iter()
            .filter_map(|source| {
                Some(Announced {
                    name: text(source.p_ndi_name)?,
                    url: text(source.p_url_address).unwrap_or_default(),
                })
            })
            .collect()
    }
}

/// Ends NDI's search.
#[allow(unsafe_code)]
fn find_close(functions: &Functions, finder: NonNull<c_void>) {
    // SAFETY: the search is destroyed once, from its owner's drop, on the
    // thread that made and used it.
    unsafe { (functions.find_destroy)(finder.as_ptr()) }
}

/// Makes a receiver connected to the source the settings name.
#[allow(unsafe_code)]
fn receiver_open(functions: &Functions, settings: &RecvCreateV3) -> Option<NonNull<c_void>> {
    // SAFETY: the settings live across the call, and the strings they point
    // to for the receiver's whole life (`Receiver` keeps them).
    unsafe { NonNull::new((functions.recv_create)(settings)) }
}

/// Captures one frame, hands a video frame to `take` and frees it.
#[allow(unsafe_code)]
fn receiver_capture(
    functions: &Functions,
    receiver: NonNull<c_void>,
    frames: &mut Frames,
    wait: u32,
    take: &mut dyn FnMut(Taken<'_>),
) -> Captured {
    // SAFETY: `receiver` is the library's and alive, used on the one thread
    // that owns it, and the frames are its own out-values. A video frame's
    // picture is read only once `check_video` has held its size to its rows,
    // and only within `length` bytes (the last row to its own end), while
    // the frame is held: `take` cannot keep the slice, and the frame is
    // freed after it returns. Each frame taken is freed with its own call;
    // the other kinds hold nothing.
    unsafe {
        let kind = (functions.recv_capture)(
            receiver.as_ptr(),
            &mut frames.video,
            &mut frames.audio,
            &mut frames.metadata,
            wait,
        );
        match kind {
            FRAME_VIDEO => {
                let video = &frames.video;
                let taken = check_video(&video.header()).map(|checked| {
                    let picture =
                        std::slice::from_raw_parts(video.p_data.cast_const(), checked.length);
                    (checked, picture)
                });
                take(taken);
                (functions.free_video)(receiver.as_ptr(), &frames.video);
                Captured::Video
            }
            FRAME_AUDIO => {
                (functions.free_audio)(receiver.as_ptr(), &frames.audio);
                Captured::Audio
            }
            FRAME_METADATA => {
                (functions.free_metadata)(receiver.as_ptr(), &frames.metadata);
                Captured::Metadata
            }
            FRAME_NONE => Captured::Nothing,
            FRAME_ERROR => Captured::Lost,
            other => Captured::Other(other),
        }
    }
}

/// The library's counts of a receiver.
#[allow(unsafe_code)]
fn receiver_counters(functions: &Functions, receiver: NonNull<c_void>) -> LibraryCounts {
    let mut total = Performance::default();
    let mut dropped = Performance::default();
    let mut queue = Queue::default();
    // SAFETY: plain reads into owned out-values, of a receiver that is alive
    // and used on the one thread that owns it.
    unsafe {
        (functions.recv_performance)(receiver.as_ptr(), &mut total, &mut dropped);
        (functions.recv_queue)(receiver.as_ptr(), &mut queue);
        LibraryCounts {
            frames: total.video_frames,
            dropped: dropped.video_frames,
            queued: queue.video_frames,
            connections: (functions.recv_connections)(receiver.as_ptr()),
        }
    }
}

/// Ends a receiver, and with it its connection.
#[allow(unsafe_code)]
fn receiver_close(functions: &Functions, receiver: NonNull<c_void>) {
    // SAFETY: the receiver is destroyed once, from its owner's drop, on the
    // thread that made and used it, with none of its frames held.
    unsafe { (functions.recv_destroy)(receiver.as_ptr()) }
}
