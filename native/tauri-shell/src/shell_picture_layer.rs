//! The native picture layer (the camera pictures, D30): the cameras'
//! pictures are drawn by the pictures helper, not by the page.
//!
//! The shell puts one DirectComposition visual topmost on the main window, so
//! it is composed above WebView2's child windows, at the box the page
//! reports for the Cameras bay (`shell_pictures::pictures_place`). A
//! composition visual takes no input: clicks go on to the page under it.
//! What the visual shows is a composition surface made from a handle. At
//! each connection of the pictures helper (after its secret it says hello
//! with its process), the layer makes a new surface handle, hands a
//! duplicate to the helper's process, and says `surface` on the connection;
//! the helper presents into it, clear wherever the page shows no picture.
//! From then on the layer tells the helper each new scene, and does nothing
//! per frame.
//!
//! It hides when the page says it shows no picture (a dialog over the bay,
//! another page), when the page has said nothing for a while (a reload says
//! no goodbye), and while no helper is connected.
//!
//! Every DirectComposition object lives on the layer's own thread; only
//! integers, a scene and the helper's connection cross to it. A fault here
//! is in the window's process, which is why nothing but these few calls is:
//! the device that draws is the helper's.

use crate::shell_pictures::LayerSink;
use std::io::Write;
use std::net::{Shutdown, TcpStream};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::picture_layer::{Placement, Scene, ToLayerHelper};
use studio_control_protocol::pictures::to_line;
use tauri::AppHandle;
use windows::core::{IUnknown, Interface};
use windows::Win32::Foundation::{
    CloseHandle, DuplicateHandle, DUPLICATE_CLOSE_SOURCE, DUPLICATE_SAME_ACCESS, HANDLE, HMODULE,
    HWND,
};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice2, DCompositionCreateSurfaceHandle, IDCompositionDesktopDevice,
    IDCompositionTarget, IDCompositionVisual, IDCompositionVisual2, COMPOSITIONOBJECT_READ,
    COMPOSITIONOBJECT_WRITE,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcess, PROCESS_DUP_HANDLE};

/// How long the layer stays up without a word from the page.
const PAGE_SILENCE: Duration = Duration::from_millis(2500);
/// How often the layer looks at the page's silence between orders.
const WAKE: Duration = Duration::from_millis(500);
/// How often its counts go to `shell.log`, while anything happened.
const COUNT_INTERVAL: Duration = Duration::from_secs(60);

enum LayerOrder {
    /// A helper's connection that said hello: a surface for its process.
    Attach {
        number: u64,
        pid: u32,
        writer: TcpStream,
    },
    /// That connection ended.
    Detach { number: u64 },
    /// What the page shows, or that it shows no picture.
    Place(Option<Placement>),
    /// The window is closing.
    Stop,
}

static ORDERS: OnceLock<Sender<LayerOrder>> = OnceLock::new();

/// Hands an order to the layer; nothing when it never started.
fn tell(order: LayerOrder) {
    if let Some(orders) = ORDERS.get() {
        let _ = orders.send(order);
    }
}

/// Starts the layer's thread on the main window, once.
pub(crate) fn start(app: &AppHandle, window: &tauri::WebviewWindow) {
    let log = {
        let app = app.clone();
        move |line: &str| {
            crate::shell_window_layout::log_shell_line(&app, &format!("Picture layer: {line}"));
        }
    };
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd.0 as isize,
        Err(error) => {
            log(&format!("no window to stand on ({error})."));
            return;
        }
    };
    let (orders, received) = mpsc::channel();
    if ORDERS.set(orders).is_err() {
        return;
    }
    let spawned = thread::Builder::new()
        .name(String::from("picture-layer"))
        .spawn(move || run(hwnd, &received, &log));
    if let Err(error) = spawned {
        crate::shell_window_layout::log_shell_line(
            app,
            &format!("Picture layer: no thread for it ({error})."),
        );
    }
}

/// What the page shows, in physical pixels; `None` hides the layer.
pub(crate) fn place(placed: Option<Placement>) {
    tell(LayerOrder::Place(placed));
}

/// The window is closing: the layer lets go of it.
pub(crate) fn stop() {
    tell(LayerOrder::Stop);
}

/// The helper's connections, handed to the layer's thread.
pub(crate) struct LayerLink;

impl LayerSink for LayerLink {
    fn attach(&self, number: u64, pid: u32, writer: TcpStream) {
        tell(LayerOrder::Attach {
            number,
            pid,
            writer,
        });
    }

    fn detach(&self, number: u64) {
        tell(LayerOrder::Detach { number });
    }
}

struct Layer {
    device: IDCompositionDesktopDevice,
    target: IDCompositionTarget,
    visual: IDCompositionVisual2,
    /// The device the composition device was made on, kept as long as it.
    _d3d: ID3D11Device,
}

/// The surface in the visual, and the connection it was made for.
struct Content {
    /// The shell's own copy of the surface handle, closed when it goes.
    handle: HANDLE,
    number: u64,
    writer: TcpStream,
    /// The scene this helper was last told.
    told: Option<Scene>,
}

/// What the layer did since its last line in the log.
#[derive(Default)]
struct Counts {
    places: u64,
    scenes: u64,
    attached: u64,
    detached: u64,
    unsaid: u64,
}

impl Counts {
    fn any(&self) -> bool {
        self.places + self.scenes + self.attached + self.detached + self.unsaid > 0
    }
}

/// Says a line to the helper; false when it did not go (the connection is
/// ending, and its end takes the surface back).
fn say(content: &mut Content, line: &ToLayerHelper) -> bool {
    writeln!(content.writer, "{}", to_line(line)).is_ok()
}

/// Tells the helper the scene, when it is not the one it was last told.
fn tell_scene(content: &mut Content, scene: &Scene, counts: &mut Counts) {
    if content.told.as_ref() == Some(scene) {
        return;
    }
    if say(content, &ToLayerHelper::Scene(scene.clone())) {
        content.told = Some(scene.clone());
        counts.scenes += 1;
    } else {
        counts.unsaid += 1;
    }
}

fn run(hwnd: isize, orders: &Receiver<LayerOrder>, log: &dyn Fn(&str)) {
    let layer = match create_layer(hwnd) {
        Ok(layer) => layer,
        Err(error) => {
            log(&format!(
                "not made: {error}. The pictures' places stay empty."
            ));
            return;
        }
    };
    log("made, topmost on the main window.");
    let mut placed: Option<Placement> = None;
    let mut last_word = Instant::now();
    let mut content: Option<Content> = None;
    let mut shown: Option<(i32, i32)> = None;
    let mut counted = Instant::now();
    let mut counts = Counts::default();
    loop {
        match orders.recv_timeout(WAKE) {
            Ok(LayerOrder::Place(next)) => {
                counts.places += 1;
                last_word = Instant::now();
                if let (Some(next), Some(held)) = (next.as_ref(), content.as_mut()) {
                    tell_scene(held, &next.scene, &mut counts);
                }
                placed = next;
            }
            Ok(LayerOrder::Attach {
                number,
                pid,
                writer,
            }) => {
                // A connection older than the one held, whose hello came late:
                // the newer one keeps its surface, and the older one ends.
                if content.as_ref().is_some_and(|held| held.number > number) {
                    let _ = writer.shutdown(Shutdown::Both);
                } else {
                    counts.attached += 1;
                    release(&layer, content.take(), log);
                    content = attach(
                        &layer,
                        number,
                        pid,
                        writer,
                        placed.as_ref(),
                        &mut counts,
                        log,
                    );
                }
            }
            Ok(LayerOrder::Detach { number }) => {
                if content.as_ref().is_some_and(|held| held.number == number) {
                    counts.detached += 1;
                    release(&layer, content.take(), log);
                }
            }
            Ok(LayerOrder::Stop) | Err(RecvTimeoutError::Disconnected) => {
                release(&layer, content.take(), log);
                let _ = show(&layer, None, shown.is_some());
                return;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        let wanted = placed
            .as_ref()
            .filter(|_| content.is_some() && last_word.elapsed() < PAGE_SILENCE)
            .map(|placed| (placed.x, placed.y));
        if wanted != shown {
            match show(&layer, wanted, shown.is_some()) {
                Ok(()) => shown = wanted,
                Err(error) => log(&format!(
                    "could not {}: {error}.",
                    if wanted.is_some() { "show" } else { "hide" }
                )),
            }
        }
        if counted.elapsed() >= COUNT_INTERVAL {
            counted = Instant::now();
            if counts.any() {
                log(&format!(
                    "in the last minute the page said {} places and the helper was told {} scenes ({} did not go); {} attached, {} detached; now {}.",
                    counts.places,
                    counts.scenes,
                    counts.unsaid,
                    counts.attached,
                    counts.detached,
                    if shown.is_some() { "shown" } else { "hidden" }
                ));
            }
            counts = Counts::default();
        }
    }
}

/// A surface for a helper's connection, said to it on the connection. When
/// no surface can be made, or its line does not go, the connection ends:
/// the helper tries again after a while, and is not left waiting.
fn attach(
    layer: &Layer,
    number: u64,
    pid: u32,
    writer: TcpStream,
    placed: Option<&Placement>,
    counts: &mut Counts,
    log: &dyn Fn(&str),
) -> Option<Content> {
    let made = new_surface(layer)
        .and_then(|handle| hand_over(layer, handle, pid).map(|remote| (handle, remote)));
    let (handle, remote) = match made {
        Ok(made) => made,
        Err(error) => {
            log(&format!(
                "no surface for the pictures helper (process {pid}): {error}."
            ));
            let _ = writer.shutdown(Shutdown::Both);
            return None;
        }
    };
    let mut held = Content {
        handle,
        number,
        writer,
        told: None,
    };
    if !say(&mut held, &ToLayerHelper::Surface { handle: remote }) {
        // The helper never learns of its copy: it is closed from here.
        take_back(pid, remote);
        log(&format!(
            "a surface for the pictures helper (process {pid}) was not said: the connection ends."
        ));
        release(layer, Some(held), log);
        return None;
    }
    log(&format!(
        "a surface for the pictures helper (process {pid})."
    ));
    if let Some(placed) = placed {
        tell_scene(&mut held, &placed.scene, counts);
    }
    Some(held)
}

/// The layer on the window: a composition device made on a Direct3D device,
/// a topmost target, one visual.
#[allow(unsafe_code)]
fn create_layer(hwnd: isize) -> windows::core::Result<Layer> {
    // SAFETY: plain COM and Direct3D calls with owned out-values; `hwnd` is
    // the main window's own handle, of this process, alive while the shell
    // runs.
    unsafe {
        let mut d3d: Option<ID3D11Device> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut d3d),
            None,
            None,
        )?;
        let d3d = d3d.ok_or_else(windows::core::Error::empty)?;
        let dxgi: IDXGIDevice = d3d.cast()?;
        let device: IDCompositionDesktopDevice = DCompositionCreateDevice2(&dxgi)?;
        let target = device.CreateTargetForHwnd(HWND(hwnd as _), true)?;
        let visual = device.CreateVisual()?;
        device.Commit()?;
        Ok(Layer {
            device,
            target,
            visual,
            _d3d: d3d,
        })
    }
}

/// A new composition surface handle, put into the visual as its content.
#[allow(unsafe_code)]
fn new_surface(layer: &Layer) -> windows::core::Result<HANDLE> {
    // SAFETY: the handle is owned here, and closed on an error; otherwise
    // `release` closes it.
    unsafe {
        let handle = DCompositionCreateSurfaceHandle(
            (COMPOSITIONOBJECT_READ | COMPOSITIONOBJECT_WRITE) as u32,
            None,
        )?;
        let surface: windows::core::Result<IUnknown> = layer.device.CreateSurfaceFromHandle(handle);
        let set = surface.and_then(|surface| {
            layer.visual.SetContent(&surface)?;
            layer.device.Commit()
        });
        match set {
            Ok(()) => Ok(handle),
            Err(error) => {
                let _ = CloseHandle(handle);
                Err(error)
            }
        }
    }
}

/// Hands a duplicate of the surface's handle to the helper's process and
/// returns its value there. On an error the surface is taken out again and
/// the shell's handle closed.
#[allow(unsafe_code)]
fn hand_over(layer: &Layer, handle: HANDLE, pid: u32) -> windows::core::Result<u64> {
    // SAFETY: the helper's process is opened for duplicating handles only,
    // and closed at once; the duplicate belongs to the helper from then on.
    // The process is the one that said the link's secret.
    unsafe {
        let handed = OpenProcess(PROCESS_DUP_HANDLE, false, pid).and_then(|helper| {
            let mut remote = HANDLE::default();
            let duplicated = DuplicateHandle(
                GetCurrentProcess(),
                handle,
                helper,
                &mut remote,
                0,
                false,
                DUPLICATE_SAME_ACCESS,
            );
            let _ = CloseHandle(helper);
            duplicated.map(|()| remote.0 as usize as u64)
        });
        if handed.is_err() {
            let _ = layer.visual.SetContent(None::<&IUnknown>);
            let _ = layer.device.Commit();
            let _ = CloseHandle(handle);
        }
        handed
    }
}

/// Closes the helper's copy of a surface's handle that the helper was never
/// told of.
#[allow(unsafe_code)]
fn take_back(pid: u32, remote: u64) {
    // SAFETY: the helper's process is opened for duplicating handles only,
    // and closed at once. The handle closed in it is the copy `hand_over`
    // put there, whose value the helper never read, so nothing there uses
    // it or closes it too.
    unsafe {
        if let Ok(helper) = OpenProcess(PROCESS_DUP_HANDLE, false, pid) {
            let _ = DuplicateHandle(
                helper,
                HANDLE(remote as usize as _),
                HANDLE::default(),
                std::ptr::null_mut(),
                0,
                false,
                DUPLICATE_CLOSE_SOURCE,
            );
            let _ = CloseHandle(helper);
        }
    }
}

/// Takes a surface out of the visual and closes the shell's handle to it.
#[allow(unsafe_code)]
fn release(layer: &Layer, content: Option<Content>, log: &dyn Fn(&str)) {
    let Some(content) = content else {
        return;
    };
    // The helper's connection ends: its reader holds a handle of its own, so
    // dropping the writer alone would leave it open, and the helper would
    // wait on a surface that is gone.
    let _ = content.writer.shutdown(Shutdown::Both);
    drop(content.writer);
    // SAFETY: the handle is the shell's own copy, closed once, here.
    unsafe {
        if let Err(error) = layer
            .visual
            .SetContent(None::<&IUnknown>)
            .and_then(|()| layer.device.Commit())
        {
            log(&format!("the surface did not come out: {error}."));
        }
        let _ = CloseHandle(content.handle);
    }
}

/// Shows the visual with its corner at `at`, or hides it. `rooted` says
/// that it is shown already: a move then only moves it.
#[allow(unsafe_code)]
fn show(layer: &Layer, at: Option<(i32, i32)>, rooted: bool) -> windows::core::Result<()> {
    // SAFETY: COM calls on this thread's own objects.
    unsafe {
        match at {
            Some((x, y)) => {
                layer.visual.SetOffsetX2(x as f32)?;
                layer.visual.SetOffsetY2(y as f32)?;
                if !rooted {
                    layer.target.SetRoot(&layer.visual)?;
                }
            }
            None => layer.target.SetRoot(None::<&IDCompositionVisual>)?,
        }
        layer.device.Commit()
    }
}
