//! projo desktop (PRODUCT.md §28): the web app bundled with the app (`@projo/web-app`, built from
//! `apps/desktop/web`), served at http://tauri.localhost in a transparent window, talking to the
//! user's projo server as an API client, and playing through libmpv drawn under the page.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod device;
mod mpv;
mod origin;
mod server;
mod state;
mod token;
mod tray;
mod updates;
mod window_size;

use std::sync::Arc;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::webview::{NewWindowResponse, PageLoadEvent, ScrollBarStyle};
use tauri::{
    Emitter, EventTarget, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use url::Url;

use crate::commands::is_local_page;
use crate::mpv::{Emitted, Player};
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
/// there without focus.
fn test_window_position() -> Option<(f64, f64)> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let value = std::env::var("PROJO_DESKTOP_TEST_WINDOW").ok()?;
    let (x, y) = value.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

fn open_externally(url: &Url) {
    if url.scheme() != "http" && url.scheme() != "https" {
        return;
    }
    // The default browser, without a shell in between (no quoting issue).
    let opened = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url.as_str()])
        .spawn();
    if let Err(error) = opened {
        log::warn!("cannot open {url}: {error}");
    }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::mpv_init,
            commands::mpv_command,
            commands::mpv_set_property,
            commands::mpv_get_property,
            commands::mpv_observe,
            commands::mpv_destroy,
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
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let config_dir = app.path().app_config_dir()?;
            let config_path = config::config_path(&config_dir);
            let stored = config::load(&config_path)
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
            app.manage(AppState::new(config_path, Arc::clone(&player), stored));

            updates::start(&handle);
            tray::install(&handle)?;

            // The window opens on the primary monitor: fit the minimum into its work area.
            let work_area = handle.primary_monitor().ok().flatten().map(|monitor| {
                let size = monitor
                    .work_area()
                    .size
                    .to_logical::<f64>(monitor.scale_factor());
                (size.width, size.height)
            });
            let (width, height) = window_size::fitted_minimum(work_area);
            let page_loads = Arc::clone(&player);
            let mut builder =
                WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                    .title("projo")
                    .inner_size(width, height)
                    .min_inner_size(width, height)
                    // Overlay scroll bars (shown while scrolling), like Windows 11's own apps,
                    // instead of the classic bar the web app's `overflow-y: scroll` keeps visible.
                    .scroll_bar_style(ScrollBarStyle::FluentOverlay)
                    // No native frame: the page fills the window and draws its own buttons and
                    // drag strip (§28.4); the edges still resize it.
                    .decorations(false)
                    .transparent(true);
            if cfg!(debug_assertions) {
                // Dev builds only: Chrome DevTools Protocol on 127.0.0.1:9229 to inspect the page
                // (wry's default flags kept).
                builder = builder.additional_browser_args(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
                     --remote-debugging-port=9229",
                );
            }
            if let Some((x, y)) = test_window_position() {
                builder = builder.position(x, y).focused(false);
            }
            let window = builder
                // The window shows the bundled page only (§28.4): any other address (a link to
                // the server, TMDB, GitHub…) opens in the system browser.
                .on_navigation(|url| {
                    let allowed = is_local_page(url) || url.as_str() == "about:blank";
                    if !allowed {
                        log::info!("opening {url} in the browser");
                        open_externally(url);
                    }
                    allowed
                })
                .on_new_window(|url, _features| {
                    open_externally(&url);
                    NewWindowResponse::Deny
                })
                .on_page_load(move |_window, payload| {
                    // The page that drove mpv is gone (reload, change of server): stop the picture.
                    if payload.event() == PageLoadEvent::Started && page_loads.has_instance() {
                        page_loads.destroy_later();
                    }
                })
                .build()?;
            match window.window_handle().map(|handle| handle.as_raw()) {
                Ok(RawWindowHandle::Win32(win32)) => player.set_wid(win32.hwnd.get() as i64),
                Ok(_) => log::warn!("no Win32 window handle: mpv opens its own window"),
                Err(error) => log::warn!("no window handle ({error}): mpv opens its own window"),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // mpv's video window is a child of this one: destroy mpv first (off the UI thread), then
            // the window.
            if let WindowEvent::CloseRequested { api, .. } = event {
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
            if let Some(state) = handle.try_state::<AppState>() {
                state.player.destroy_blocking();
            }
            updates::install_pending(handle);
        }
    });
}
