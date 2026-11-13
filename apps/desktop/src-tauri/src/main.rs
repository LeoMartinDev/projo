//! projo desktop (PRODUCT.md §28): the user's projo server in a transparent window, played through
//! libmpv drawn under the page.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod mpv;
mod origin;
mod server;
mod state;

use std::sync::{Arc, OnceLock};

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    Emitter, EventTarget, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use url::Url;

use crate::commands::is_local_page;
use crate::mpv::{Emitted, Player};
use crate::origin::is_same_origin;
use crate::state::AppState;

pub const MAIN: &str = "main";

/// Set once at startup: the dev server under `tauri dev`, else the bundled assets' origin.
static LOCAL_PAGE: OnceLock<Url> = OnceLock::new();

/// The bundled page's origin: `tauri dev` serves it from the CLI's dev server
/// (`build.devUrl`, e.g. http://127.0.0.1:1430); a build serves it over http://tauri.localhost
/// (Windows, Android) or tauri://localhost.
pub fn local_page_url() -> Url {
    LOCAL_PAGE.get().cloned().unwrap_or_else(bundled_page_url)
}

fn bundled_page_url() -> Url {
    let url = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(url).unwrap_or_else(|_| unreachable!("constant URL"))
}

fn init_local_page(dev_url: Option<&Url>) -> Url {
    let url = match dev_url {
        Some(dev) if tauri::is_dev() => {
            let mut origin = dev.clone();
            origin.set_path("/");
            origin.set_query(None);
            origin.set_fragment(None);
            origin
        }
        _ => bundled_page_url(),
    };
    LOCAL_PAGE.get_or_init(|| url).clone()
}

/// Ctrl+Shift+U on any page of the main window: back to the server picker.
const SHORTCUT_SCRIPT: &str = r#"
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === 'KeyU') {
    event.preventDefault()
    window.__TAURI_INTERNALS__.invoke('change_server').catch((error) => console.error('change_server', error))
  }
}, true)
"#;

/// Debug builds only, for driving the app in tests: `PROJO_DESKTOP_TEST_WINDOW=x,y` opens the window
/// there without focus; `PROJO_DESKTOP_TEST_EXTRA_ORIGIN=<origin>` lets the main window navigate to
/// one more origin (never granted IPC), to check that IPC is refused there.
struct TestHooks {
    window_position: Option<(f64, f64)>,
    extra_origin: Option<String>,
}

fn test_hooks() -> TestHooks {
    if !cfg!(debug_assertions) {
        return TestHooks {
            window_position: None,
            extra_origin: None,
        };
    }
    let window_position = std::env::var("PROJO_DESKTOP_TEST_WINDOW")
        .ok()
        .and_then(|value| {
            let (x, y) = value.split_once(',')?;
            Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
        });
    let extra_origin = std::env::var("PROJO_DESKTOP_TEST_EXTRA_ORIGIN")
        .ok()
        .and_then(|value| origin::parse_server_origin(&value).ok());
    TestHooks {
        window_position,
        extra_origin,
    }
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
        .invoke_handler(tauri::generate_handler![
            commands::mpv_init,
            commands::mpv_command,
            commands::mpv_set_property,
            commands::mpv_get_property,
            commands::mpv_observe,
            commands::mpv_destroy,
            commands::desktop_info,
            commands::get_setup,
            commands::connect_server,
            commands::change_server,
        ])
        .setup(|app| {
            let local_page = init_local_page(app.config().build.dev_url.as_ref());
            log::info!("bundled page served from {local_page}");
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
            app.manage(AppState::new(
                config_path,
                Arc::clone(&player),
                stored.clone(),
            ));
            if let Some(origin) = &stored {
                // The bundled page checks the server first, then navigates (connect_server).
                commands::grant_server(&handle, &app.state::<AppState>(), origin)
                    .map_err(|error| format!("{error:?}"))?;
            }

            let hooks = test_hooks();
            let navigation = handle.clone();
            let page_loads = Arc::clone(&player);
            let mut builder =
                WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                    .title("projo")
                    .inner_size(1280.0, 720.0)
                    .min_inner_size(640.0, 360.0)
                    .transparent(true);
            if let Some((x, y)) = hooks.window_position {
                builder = builder.position(x, y).focused(false);
            }
            let extra_origin = hooks.extra_origin;
            let window = builder
                .initialization_script(SHORTCUT_SCRIPT)
                .on_navigation(move |url| {
                    let server = navigation.state::<AppState>().server_origin();
                    let allowed = is_local_page(url)
                        || server
                            .as_deref()
                            .is_some_and(|origin| is_same_origin(url, origin))
                        || extra_origin
                            .as_deref()
                            .is_some_and(|origin| is_same_origin(url, origin))
                        || url.as_str() == "about:blank";
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
        }
    });
}
