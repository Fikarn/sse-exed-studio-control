//! WebView2's own keys, switched off (decision 12). Windows only: the
//! module is compiled there alone.

use crate::shell_window_layout::log_shell_line;
use tauri::{AppHandle, WebviewWindow};

/// New pages program, Slice 3, decision 12: the one guard against keys Studio
/// Control does not bind itself. The screen runs in WebView2, which has keys of
/// its own — reload (F5, Ctrl+R, Ctrl+Shift+R), find (Ctrl+F, F3), print
/// (Ctrl+P), zoom, back and forward, the developer tools. With its browser
/// accelerator keys switched off none of them acts on the operator's screen
/// during a show, while the keys that move and edit — Home, End, Page Up, Page
/// Down, cut, copy, paste, select-all and undo in text fields — keep working.
/// The guard binds no function; the page sees nothing of it. A refusal is one
/// line in shell.log and the shell carries on with WebView2's defaults.
///
/// For the operator's window it is called from `.setup`, which runs on the
/// main thread, where `with_webview` runs its closure at once: after the
/// webview is built and before the event loop delivers its first
/// `NavigationStarting`. That matters, because WebView2 applies most settings
/// changed after `NavigationStarting` only from the next top-level navigation
/// — and the operator's screen never navigates again. The prompter's window
/// is built on the watch's thread, where the closure is queued and may come
/// late; that window takes no keyboard on the Prompter XL.
pub(crate) fn switch_off_browser_keys(app: &AppHandle, window: &WebviewWindow) {
    let app_for_webview = app.clone();
    let queued = window.with_webview(move |webview| {
        if let Err(error) = set_browser_accelerator_keys_off(&webview.controller()) {
            log_browser_keys_left_on(&app_for_webview, &error.to_string());
        }
    });
    if let Err(error) = queued {
        log_browser_keys_left_on(app, &error.to_string());
    }
}

/// `ICoreWebView2Controller` → `CoreWebView2` → `Settings` →
/// `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled(false)`, the
/// setting wry applies when a webview is built with its browser accelerator
/// keys off (Tauri does not expose that option).
#[allow(unsafe_code)]
fn set_browser_accelerator_keys_off(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    // SAFETY: `controller` is the live controller Tauri passes to
    // `with_webview`, on the thread that owns the webview. These are two COM
    // getters and one setter on it, each checked through the `Result` the
    // bindings return; the interfaces are reference-counted and released when
    // they drop at the end of this function.
    unsafe {
        let settings = controller.CoreWebView2()?.Settings()?;
        settings
            .cast::<ICoreWebView2Settings3>()?
            .SetAreBrowserAcceleratorKeysEnabled(false)
    }
}

fn log_browser_keys_left_on(app: &AppHandle, error: &str) {
    log_shell_line(
        app,
        &format!("WebView2's browser keys stayed on (reload, find, print, zoom): {error}"),
    );
}
