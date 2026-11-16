//! The main window at run time (PRODUCT.md §28.4): opened where it was when the app last closed,
//! hidden until the page's first screen is painted, its bounds followed while it runs and saved
//! in `config.json` when the app quits.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewWindow, Window};

use crate::config::WindowBounds;
use crate::state::AppState;
use crate::window_size::{self, Monitor, Observation, Placement, Rect};
use crate::MAIN;

/// How long the page has to call `desktop_window_ready` before the window shows anyway (a page
/// that failed to start must not leave the app invisible).
const READY_GRACE: Duration = Duration::from_secs(3);

pub struct MainWindow {
    shown: AtomicBool,
    /// Whether showing the window also focuses it (not for a test window).
    focus: bool,
    /// Whether the bounds are followed and saved (not for a test window).
    remember: bool,
    bounds: Mutex<Option<WindowBounds>>,
    saved: Mutex<Option<WindowBounds>>,
}

impl MainWindow {
    /// `placement`: where the window opens (none for a test window); `saved`: what `config.json`
    /// holds.
    pub fn new(placement: Option<&Placement>, saved: Option<WindowBounds>) -> MainWindow {
        let opened = placement.and_then(|placement| {
            let (x, y) = placement.position?;
            Some(WindowBounds {
                x,
                y,
                width: placement.size.0,
                height: placement.size.1,
                maximized: placement.maximized,
            })
        });
        MainWindow {
            shown: AtomicBool::new(false),
            focus: placement.is_some(),
            remember: placement.is_some(),
            bounds: Mutex::new(opened),
            saved: Mutex::new(saved),
        }
    }
}

fn monitor(monitor: &tauri::Monitor) -> Monitor {
    let rect = |x: i32, y: i32, width: u32, height: u32| Rect {
        x: f64::from(x),
        y: f64::from(y),
        width: f64::from(width),
        height: f64::from(height),
    };
    let work_area = monitor.work_area();
    Monitor {
        bounds: rect(
            monitor.position().x,
            monitor.position().y,
            monitor.size().width,
            monitor.size().height,
        ),
        work_area: rect(
            work_area.position.x,
            work_area.position.y,
            work_area.size.width,
            work_area.size.height,
        ),
        scale: monitor.scale_factor(),
    }
}

/// The minimum size (logical, fitted into the primary monitor's work area) and where the window
/// opens given the saved bounds and the monitors connected now.
pub fn opening<R: Runtime>(
    app: &AppHandle<R>,
    saved: Option<&WindowBounds>,
) -> ((f64, f64), Placement) {
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|primary| monitor(&primary));
    let monitors: Vec<Monitor> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(monitor)
        .collect();
    (
        window_size::minimum_for(primary.as_ref()),
        window_size::placement(saved, &monitors, primary.as_ref()),
    )
}

/// Moves the window, still hidden, to `placement`. The position first: on a monitor of another
/// scale the size then converts at that monitor's scale. Maximized last, so that it restores to
/// the saved bounds; a hidden window only takes the state and shows maximized (no frame at the
/// smaller size).
pub fn place<R: Runtime>(window: &WebviewWindow<R>, placement: &Placement) {
    if let Some((x, y)) = placement.position {
        if let Err(error) = window.set_position(PhysicalPosition::new(x, y)) {
            log::warn!("window not placed: {error}");
        }
        let (width, height) = placement.size;
        if let Err(error) = window.set_size(LogicalSize::new(width, height)) {
            log::warn!("window not sized: {error}");
        }
    }
    if placement.maximized {
        if let Err(error) = window.maximize() {
            log::warn!("window not maximized: {error}");
        }
    }
}

/// Shows the window, once: when the page says its first screen is painted
/// (`desktop_window_ready`), or after `READY_GRACE` (`show_later`).
pub fn reveal<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<MainWindow>() else {
        return;
    };
    if state.shown.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    if let Err(error) = window.show() {
        log::error!("cannot show the window: {error}");
    }
    if state.focus {
        if let Err(error) = window.set_focus() {
            log::warn!("cannot focus the window: {error}");
        }
    }
}

/// The safety net of `reveal`: a page that crashed or never started still gets a window.
pub fn show_later<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(READY_GRACE);
        let waiting = app
            .try_state::<MainWindow>()
            .is_some_and(|state| !state.shown.load(Ordering::SeqCst));
        if waiting {
            log::warn!("the page did not show the window: showing it anyway");
            reveal(&app);
        }
    });
}

/// Brings the window to the front: a second launch of the app, the tray icon.
pub fn bring_forward<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<MainWindow>() {
        state.shown.store(true, Ordering::SeqCst);
    }
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Follows the window's bounds (on every move and resize; full screen, minimized and maximized
/// keep the bounds it comes back to).
pub fn observe<R: Runtime>(window: &Window<R>) {
    let Some(state) = window.try_state::<MainWindow>() else {
        return;
    };
    if !state.remember {
        return;
    }
    let Some(seen) = observation(window) else {
        return;
    };
    let mut bounds = state.bounds.lock().unwrap_or_else(PoisonError::into_inner);
    *bounds = window_size::observe(*bounds, seen);
}

fn observation<R: Runtime>(window: &Window<R>) -> Option<Observation> {
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Observation {
        position: (position.x, position.y),
        size: (size.width, size.height),
        maximized: match is_zoomed(window) {
            Some(zoomed) => zoomed,
            None => window.is_maximized().ok()?,
        },
        minimized: window.is_minimized().ok()?,
        fullscreen: window.is_fullscreen().ok()?,
    })
}

/// The window's own maximized state. Tauri's `is_maximized` follows `WM_SIZE`, which comes after
/// the move of a maximize: read then, it would take the maximized position for the normal one.
#[cfg(windows)]
fn is_zoomed<R: Runtime>(window: &Window<R>) -> Option<bool> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsZoomed;

    let RawWindowHandle::Win32(handle) = window.window_handle().ok()?.as_raw() else {
        return None;
    };
    // SAFETY: the handle of a live window of this process; `IsZoomed` only reads its style.
    Some(unsafe { IsZoomed(HWND(handle.hwnd.get() as *mut _)) }.as_bool())
}

#[cfg(not(windows))]
fn is_zoomed<R: Runtime>(_window: &Window<R>) -> Option<bool> {
    None
}

/// Saves the window's bounds in `config.json` when they changed (closing the window, quitting,
/// restarting for an update). Never the full-screen state.
pub fn remember<R: Runtime>(app: &AppHandle<R>) {
    let (Some(state), Some(app_state)) =
        (app.try_state::<MainWindow>(), app.try_state::<AppState>())
    else {
        return;
    };
    if !state.remember {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN) {
        observe(&window.as_ref().window());
    }
    let Some(bounds) = *state.bounds.lock().unwrap_or_else(PoisonError::into_inner) else {
        return;
    };
    let mut saved = state.saved.lock().unwrap_or_else(PoisonError::into_inner);
    if *saved == Some(bounds) {
        return;
    }
    match app_state.update_config(|config| config.window = Some(bounds)) {
        Ok(()) => *saved = Some(bounds),
        Err(error) => log::warn!("window bounds not saved: {error}"),
    }
}
