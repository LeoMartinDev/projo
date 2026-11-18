//! projo desktop (PRODUCT.md §28): the web app bundled with the app (`@projo/web-app`, built from
//! `apps/desktop/web`), served at http://tauri.localhost in a transparent window, talking to the
//! user's projo server as an API client, and playing through libmpv drawn under the page.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod device;
mod fonts;
mod main_window;
mod media_session;
mod mpv;
mod navigation;
mod origin;
mod server;
mod state;
mod token;
mod tray;
mod updates;
mod webview_settings;
mod window_size;

use std::sync::Arc;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    Emitter, EventTarget, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use url::Url;

use crate::main_window::MainWindow;
use crate::media_session::MediaSession;
use crate::mpv::{Emitted, Player};
use crate::navigation::NewWindow;
use crate::state::AppState;

pub const MAIN: &str = "main";

/// The bundled page's address: Tauri serves `frontendDist` at http://tauri.localhost on Windows
/// (never `useHttpsScheme`: an `http://` server would be mixed content), tauri://localhost
/// elsewhere. Under `tauri dev` too: there is no dev server, the page must be on the origin the
/// server's CORS allows (`desktopOrigins` of `@projo/shared/api/desktop`).
pub fn local_page_url() -> Url {
    let url = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(url).unwrap_or_else(|_| unreachable!("constant URL"))
}

/// Debug builds only, for driving the app in tests: `PROJO_DESKTOP_TEST_WINDOW=x,y` opens the window
/// there (logical pixels) without focus, whatever bounds were saved, and saves none.
fn test_window_position() -> Option<(f64, f64)> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let value = std::env::var("PROJO_DESKTOP_TEST_WINDOW").ok()?;
    let (x, y) = value.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

/// No native frame on Windows: the page fills the window and draws its own buttons and drag strip
/// (§28.4); the edges still resize it. Overlay scroll bars (shown while scrolling), like Windows
/// 11's own apps, instead of the classic bar the web app's `overflow-y: scroll` keeps visible.
#[cfg(windows)]
fn window_frame<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .scroll_bar_style(tauri::webview::ScrollBarStyle::FluentOverlay)
        .decorations(false)
}

/// macOS keeps its own window buttons over the page (the page fills the window, title bar
/// included, and leaves them room): the system's close, minimize and zoom, its full screen, its
/// rounded corners and shadow.
#[cfg(target_os = "macos")]
fn window_frame<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 20.0))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn window_frame<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder.decorations(false)
}

/// Where libmpv draws, under the page: a child of the window on Windows (`wid`), the app's own
/// layer on macOS. Without it, libmpv opens a window of its own.
#[cfg(not(target_os = "macos"))]
fn attach_video_output<R: Runtime>(window: &tauri::WebviewWindow<R>, player: &Player) {
    match window.window_handle().map(|handle| handle.as_raw()) {
        Ok(RawWindowHandle::Win32(win32)) => {
            player.set_output(Arc::new(mpv::ChildWindow(win32.hwnd.get() as i64)));
        }
        Ok(_) => log::warn!("no Win32 window handle: mpv opens its own window"),
        Err(error) => log::warn!("no window handle ({error}): mpv opens its own window"),
    }
}

#[cfg(target_os = "macos")]
fn attach_video_output<R: Runtime>(window: &tauri::WebviewWindow<R>, player: &Player) {
    let installed = window
        .ns_window()
        .map_err(|error| error.to_string())
        .and_then(mpv::gl_layer::install);
    match installed {
        Ok(layer) => player.set_output(Arc::new(layer)),
        Err(error) => log::warn!("no picture layer ({error}): mpv opens its own window"),
    }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let app = tauri::Builder::default()
        // First: a second launch hands over to the running app (it comes to the front) and exits
        // before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            main_window::bring_forward(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::mpv_init,
            commands::mpv_command,
            commands::mpv_set_property,
            commands::mpv_get_property,
            commands::mpv_observe,
            commands::mpv_destroy,
            commands::desktop_window_ready,
            commands::desktop_info,
            commands::desktop_device,
            commands::desktop_update_status,
            commands::desktop_update_install,
            commands::get_server,
            commands::check_server,
            commands::save_server,
            commands::get_token,
            commands::set_token,
            commands::clear_token,
            commands::change_server,
            commands::media_session_set,
            commands::media_session_state,
            commands::media_session_clear,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let config_dir = app.path().app_config_dir()?;
            let config_path = config::config_path(&config_dir);
            let config = config::load(&config_path);
            let stored = config
                .server_url
                .and_then(|url| origin::parse_server_origin(&url).ok());
            log::info!(
                "config {}: server {}",
                config_path.display(),
                stored.as_deref().unwrap_or("none")
            );
            let exe_dir = std::env::current_exe()?
                .parent()
                .map(|dir| dir.to_path_buf())
                .unwrap_or_default();
            let emitter = handle.clone();
            let player = Player::new(
                mpv::ffi::library_candidates(&exe_dir),
                Arc::new(move |emitted| {
                    let target = EventTarget::webview_window(MAIN);
                    let sent = match emitted {
                        Emitted::Property(payload) => {
                            emitter.emit_to(target, "mpv://property", payload)
                        }
                        Emitted::Event(payload) => emitter.emit_to(target, "mpv://event", payload),
                    };
                    if let Err(error) = sent {
                        log::debug!("mpv event not delivered: {error}");
                    }
                }),
            );
            match fonts::install(&config_dir) {
                Ok(dir) => player.set_subtitle_fonts(dir),
                Err(error) => log::warn!("subtitle fonts not installed: {error}"),
            }
            app.manage(AppState::new(config_path, Arc::clone(&player), stored));
            let media_emitter = handle.clone();
            app.manage(MediaSession::new(Arc::new(move |action| {
                let target = EventTarget::webview_window(MAIN);
                if let Err(error) =
                    media_emitter.emit_to(target, media_session::ACTION_EVENT, action)
                {
                    log::debug!("media action not delivered: {error}");
                }
            })));

            updates::start(&handle);
            tray::install(&handle)?;

            // Where it was when the app last closed, else centered on the primary monitor; never
            // below the minimum fitted into the primary monitor's work area.
            let test_position = test_window_position();
            let (minimum, placement) = main_window::opening(&handle, config.window.as_ref());
            let placement = test_position.is_none().then_some(placement);
            app.manage(MainWindow::new(placement.as_ref(), config.window));
            let (width, height) = placement.map_or(minimum, |placement| placement.size);
            let page_loads = Arc::clone(&player);
            let mut builder =
                WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                    .title("projo")
                    .inner_size(width, height)
                    .min_inner_size(minimum.0, minimum.1)
                    // Shown once the page painted its first screen (`desktop_window_ready`): the
                    // transparent window never shows empty while WebView2 starts.
                    .visible(false)
                    .transparent(true);
            builder = window_frame(builder);
            // WebView2's flags (Windows), replacing wry's defaults, which are kept. Chromium runs
            // a background-color transition on the compositor, and when the page is busy at its
            // end (a new page rendering after a click), one frame shows its start again: a button
            // or a nav link blinks back to its previous state. CompositeBGColorAnimation off runs
            // them on the main thread, as before Chromium 115.
            let flags = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,\
                         CompositeBGColorAnimation";
            builder = builder.additional_browser_args(&if cfg!(debug_assertions) {
                // Dev builds also serve the Chrome DevTools Protocol on 127.0.0.1:9229.
                format!("{flags} --remote-debugging-port=9229")
            } else {
                flags.to_owned()
            });
            if let Some((x, y)) = test_position {
                builder = builder.position(x, y).focused(false);
            }
            let window = builder
                // The window shows the bundled page only (§28.4): any other address (a link to
                // the server, TMDB, GitHub…) opens in the system browser.
                .on_navigation(|url| {
                    let allowed = navigation::may_load(url);
                    if !allowed {
                        log::info!("opening {url} in the browser");
                        navigation::open_in_browser(url);
                    }
                    allowed
                })
                // Never another window: another site opens in the browser, a page of the app
                // (a middle click, Ctrl or Shift + click on a link) nowhere.
                .on_new_window(|url, _features| {
                    match navigation::new_window(&url) {
                        NewWindow::OpenInBrowser => {
                            log::info!("opening {url} in the browser");
                            navigation::open_in_browser(&url);
                        }
                        NewWindow::Ignore => log::debug!("new window ignored: {url}"),
                    }
                    NewWindowResponse::Deny
                })
                .on_page_load(move |window, payload| {
                    // The page that drove mpv is gone (reload, change of server): stop the picture
                    // and hide its media session.
                    if payload.event() == PageLoadEvent::Started {
                        media_session::clear(window.app_handle());
                        if page_loads.has_instance() {
                            page_loads.destroy_later();
                        }
                    }
                })
                .build()?;
            // An app, not a browser: no browser context menu nor accelerator keys (§28.4).
            webview_settings::apply(&window);
            if let Some(placement) = &placement {
                main_window::place(&window, placement);
            }
            main_window::show_later(&handle);
            attach_video_output(&window, &player);
            if let Ok(RawWindowHandle::Win32(win32)) =
                window.window_handle().map(|handle| handle.as_raw())
            {
                if let Some(media) = handle.try_state::<MediaSession>() {
                    media.set_hwnd(win32.hwnd.get());
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) if window.label() == MAIN => {
                main_window::observe(window);
                #[cfg(target_os = "macos")]
                if let (WindowEvent::Moved(_), Ok(ns_window)) = (event, window.ns_window()) {
                    mpv::gl_layer::screen_changed(ns_window);
                }
            }
            #[cfg(target_os = "macos")]
            WindowEvent::ScaleFactorChanged { .. } if window.label() == MAIN => {
                if let Ok(ns_window) = window.ns_window() {
                    mpv::gl_layer::screen_changed(ns_window);
                }
            }
            // mpv's video window is a child of this one: destroy mpv first (off the UI thread), then
            // the window.
            WindowEvent::CloseRequested { api, .. } => {
                main_window::remember(window.app_handle());
                media_session::clear(window.app_handle());
                let player = Arc::clone(&window.state::<AppState>().player);
                if player.has_instance() {
                    api.prevent_close();
                    let window = window.clone();
                    std::thread::spawn(move || {
                        player.destroy_blocking();
                        if let Err(error) = window.destroy() {
                            log::error!("cannot close the window: {error}");
                        }
                    });
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            eprintln!("projo desktop failed to start: {error}");
            std::process::exit(1);
        }
    };
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // The tray's "Quit" closes no window first.
            main_window::remember(handle);
            // On the main thread: the media controls' WinRT calls belong there.
            if let Some(media) = handle.try_state::<MediaSession>() {
                media.shutdown();
            }
            if let Some(state) = handle.try_state::<AppState>() {
                state.player.destroy_blocking();
            }
            updates::install_pending(handle);
        }
    });
}
