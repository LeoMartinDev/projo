//! IPC commands (PRODUCT.md §28.6). The main window only ever shows the bundled page
//! (http://tauri.localhost), which `capabilities/main.json` grants every command; each command
//! checks the webview's URL again. No remote origin is ever granted IPC.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, State, Webview};
use url::Url;

use crate::device::device_name;
use crate::main_window;
use crate::media_session::{self, MediaError};
use crate::mpv::{MpvError, Player};
use crate::origin::{is_same_origin, parse_server_origin, OriginError};
use crate::server::{check_health, HealthError};
use crate::state::AppState;
use crate::token::{self, TokenError};
use crate::updates::{self, PendingUpdate};
use crate::{local_page_url, MAIN};

#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl CommandError {
    fn new(code: &'static str, message: impl Into<String>) -> CommandError {
        CommandError {
            code,
            message: message.into(),
        }
    }
}

impl From<MpvError> for CommandError {
    fn from(error: MpvError) -> CommandError {
        CommandError::new(error.code(), error.message())
    }
}

impl From<MediaError> for CommandError {
    fn from(error: MediaError) -> CommandError {
        CommandError::new(error.code(), error.message())
    }
}

impl From<TokenError> for CommandError {
    fn from(TokenError(message): TokenError) -> CommandError {
        CommandError::new("desktop/keyring_failed", message)
    }
}

impl From<OriginError> for CommandError {
    fn from(error: OriginError) -> CommandError {
        let message = match error {
            OriginError::Empty => "no address",
            OriginError::Invalid => "not a valid address",
            OriginError::UnsupportedScheme => "only http:// and https:// are supported",
            OriginError::Credentials => "the address must not contain a user name or password",
        };
        CommandError::new("server/invalid_url", message)
    }
}

type CommandResult<T> = Result<T, CommandError>;

/// Whether `url` is the bundled page (its origin: http://tauri.localhost on Windows).
pub fn is_local_page(url: &Url) -> bool {
    is_same_origin(url, &local_page_url().origin().ascii_serialization())
}

fn require_local<R: Runtime>(webview: &Webview<R>) -> CommandResult<()> {
    match webview.url() {
        Ok(url) if is_local_page(&url) => Ok(()),
        _ => Err(CommandError::new(
            "desktop/forbidden_origin",
            "only the bundled page may do this",
        )),
    }
}

/// Runs blocking work (libmpv calls, HTTP, the credential store) off the UI thread and off the
/// async workers.
async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(run)
        .await
        .unwrap_or_else(|error| Err(CommandError::new("desktop/internal", error.to_string())))
}

fn player(state: &AppState) -> Arc<Player> {
    Arc::clone(&state.player)
}

#[tauri::command]
pub async fn mpv_init<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    options: Option<BTreeMap<String, String>>,
) -> CommandResult<()> {
    require_local(&webview)?;
    let player = player(&state);
    blocking(move || Ok(player.init_blocking(options.unwrap_or_default())?)).await
}

#[tauri::command]
pub async fn mpv_command<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    args: Vec<String>,
) -> CommandResult<()> {
    require_local(&webview)?;
    let player = player(&state);
    blocking(move || Ok(player.command(&args)?)).await
}

#[tauri::command]
pub async fn mpv_set_property<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    name: String,
    value: String,
) -> CommandResult<()> {
    require_local(&webview)?;
    let player = player(&state);
    blocking(move || Ok(player.set_property(&name, &value)?)).await
}

/// The value in node format; an unavailable property answers `null` (IPC has no `undefined`).
#[tauri::command]
pub async fn mpv_get_property<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    name: String,
) -> CommandResult<Option<Value>> {
    require_local(&webview)?;
    let player = player(&state);
    blocking(move || Ok(player.get_property(&name)?)).await
}

#[tauri::command]
pub async fn mpv_observe<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    names: Vec<String>,
) -> CommandResult<()> {
    require_local(&webview)?;
    let player = player(&state);
    blocking(move || Ok(player.observe(&names)?)).await
}

/// Also clears the system media controls: nothing plays any more.
#[tauri::command]
pub async fn mpv_destroy<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    require_local(&webview)?;
    let player = player(&state);
    blocking(move || {
        media_session::clear(&app);
        player.destroy_blocking();
        Ok(())
    })
    .await
}

/// What plays, shown by Windows' media controls (media_session.rs). Synchronous: Tauri runs it on
/// the main thread, where the WinRT calls belong.
#[tauri::command]
pub fn media_session_set<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
    title: String,
    subtitle: Option<String>,
    artwork_url: Option<String>,
    actions: Vec<String>,
) -> CommandResult<()> {
    require_local(&webview)?;
    let metadata = media_session::validate_metadata(
        &title,
        subtitle.as_deref(),
        artwork_url.as_deref(),
        &actions,
        state.server_origin().as_deref(),
    )?;
    let artwork = metadata.artwork.clone();
    let generation = media_session::on_main_thread(&app, move |session| session.set(&metadata))?;
    if let Some(url) = artwork {
        media_session::load_artwork(&app, generation, url);
    }
    Ok(())
}

/// Playing or paused, the position, the duration and the rate, for the media controls' timeline.
#[tauri::command]
pub fn media_session_state<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    playing: bool,
    position_ms: f64,
    duration_ms: f64,
    rate: f64,
) -> CommandResult<()> {
    require_local(&webview)?;
    let playback = media_session::validate_state(playing, position_ms, duration_ms, rate)?;
    Ok(media_session::on_main_thread(&app, move |session| {
        session.state(&playback)
    })?)
}

/// Hides the media controls' session.
#[tauri::command]
pub fn media_session_clear<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
) -> CommandResult<()> {
    require_local(&webview)?;
    Ok(media_session::on_main_thread(&app, |session| {
        session.clear()
    })?)
}

/// The page's first screen is painted: shows the window, hidden until then so that WebView2's start
/// never shows an empty transparent window (§28.4; the app shows it anyway after 3 s). Idempotent.
#[tauri::command]
pub fn desktop_window_ready<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
) -> CommandResult<()> {
    require_local(&webview)?;
    main_window::reveal(&app);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    version: String,
    mpv: String,
    /// Since 0.5.0: the name the app gives its sessions (device.rs).
    device_name: String,
}

#[tauri::command]
pub async fn desktop_info<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<DesktopInfo> {
    require_local(&webview)?;
    let player = player(&state);
    let version = app.package_info().version.to_string();
    blocking(move || {
        Ok(DesktopInfo {
            version,
            mpv: player.mpv_version_blocking()?,
            device_name: device_name(),
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDevice {
    device_name: String,
}

/// The name the app gives its sessions (device.rs). Never touches libmpv, unlike `desktop_info`:
/// sign-in works with libmpv missing. Since 0.5.0.
#[tauri::command]
pub async fn desktop_device<R: Runtime>(webview: Webview<R>) -> CommandResult<DesktopDevice> {
    require_local(&webview)?;
    blocking(|| {
        Ok(DesktopDevice {
            device_name: device_name(),
        })
    })
    .await
}

#[derive(Serialize)]
pub struct UpdateStatus {
    #[serde(skip_serializing_if = "Option::is_none")]
    ready: Option<String>,
}

/// The version downloaded and waiting to be installed, if any (§28.10).
#[tauri::command]
pub fn desktop_update_status<R: Runtime>(
    webview: Webview<R>,
    pending: State<'_, PendingUpdate>,
) -> CommandResult<UpdateStatus> {
    require_local(&webview)?;
    Ok(UpdateStatus {
        ready: pending.ready_version(),
    })
}

/// Installs the waiting version now and starts the app again on it; libmpv is stopped first.
#[tauri::command]
pub async fn desktop_update_install<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    require_local(&webview)?;
    let player = player(&state);
    blocking(move || {
        player.destroy_blocking();
        Ok(())
    })
    .await?;
    // The process ends without the app's exit (§28.10): keep the window's bounds first.
    main_window::remember(&app);
    updates::install_now(&app).map_err(|error| CommandError::new("desktop/update_failed", error))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSetup {
    #[serde(skip_serializing_if = "Option::is_none")]
    server_url: Option<String>,
}

/// The saved server (`config.json`), if any.
#[tauri::command]
pub fn get_server<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<ServerSetup> {
    require_local(&webview)?;
    Ok(ServerSetup {
        server_url: state.server_origin(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCheck {
    server_url: String,
    version: String,
}

/// Reduces `url` to an origin and checks that `<origin>/health` answers like a projo server, from
/// Rust (no CORS involved: a server too old to answer the bundled page still tells its version).
/// `serverUrl` is the origin that answered: an `http://` one redirecting to `https://` on the
/// same host gives the latter (server.rs). Saves nothing.
#[tauri::command]
pub async fn check_server<R: Runtime>(
    webview: Webview<R>,
    url: String,
) -> CommandResult<ServerCheck> {
    require_local(&webview)?;
    let origin = parse_server_origin(&url)?;
    blocking(move || {
        let checked = check_health(&origin).map_err(|error| match error {
            HealthError::Unreachable(message) => CommandError::new("server/unreachable", message),
            HealthError::NotProjo(message) => CommandError::new("server/not_projo", message),
        })?;
        Ok(ServerCheck {
            server_url: checked.origin,
            version: checked.version,
        })
    })
    .await
}

/// Saves the server (`config.json`). Moving to another origin forgets the previous one's token.
#[tauri::command]
pub async fn save_server<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    url: String,
) -> CommandResult<ServerSetup> {
    require_local(&webview)?;
    let origin = parse_server_origin(&url)?;
    let previous = state.server_origin();
    state
        .update_config(|config| config.server_url = Some(origin.clone()))
        .map_err(|error| CommandError::new("desktop/config_not_saved", error.to_string()))?;
    state.set_server_origin(origin.clone());
    if let Some(previous) = previous.filter(|previous| *previous != origin) {
        blocking(move || {
            if let Err(TokenError(error)) = token::clear(&previous) {
                log::warn!("cannot forget the token of {previous}: {error}");
            }
            Ok(())
        })
        .await?;
    }
    Ok(ServerSetup {
        server_url: Some(origin),
    })
}

#[derive(Serialize)]
pub struct TokenAnswer {
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

/// The saved server's token, if one is kept (none without a saved server).
#[tauri::command]
pub async fn get_token<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<TokenAnswer> {
    require_local(&webview)?;
    let Some(origin) = state.server_origin() else {
        return Ok(TokenAnswer { token: None });
    };
    blocking(move || {
        Ok(TokenAnswer {
            token: token::read(&origin)?,
        })
    })
    .await
}

/// Keeps the saved server's token (sign-in, pairing claim).
#[tauri::command]
pub async fn set_token<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    token: String,
) -> CommandResult<()> {
    require_local(&webview)?;
    let origin = state
        .server_origin()
        .ok_or_else(|| CommandError::new("desktop/no_server", "no server saved"))?;
    blocking(move || Ok(token::write(&origin, &token)?)).await
}

/// Forgets the saved server's token (sign-out, a request answered 401).
#[tauri::command]
pub async fn clear_token<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    require_local(&webview)?;
    let Some(origin) = state.server_origin() else {
        return Ok(());
    };
    blocking(move || Ok(token::clear(&origin)?)).await
}

/// Back to the server screen: forgets the token, stops libmpv and reloads the bundled page with
/// `?change=1`. The page calls it once it signed out on the server (Ctrl+Shift+U, its own
/// "Change server", or the tray's `desktop://change-server`, see `request_change_server`).
#[tauri::command]
pub async fn change_server<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
) -> CommandResult<()> {
    require_local(&webview)?;
    blocking(move || change_server_now(&app, Reload::Replace)).await
}

/// Sent to the page by the tray's "Change server": the page signs out on the server (best
/// effort), then calls `change_server`.
pub const CHANGE_SERVER_EVENT: &str = "desktop://change-server";
/// How long the page has to answer `CHANGE_SERVER_EVENT` before the app changes server without it
/// (a page that hangs or never loaded): the server session then simply expires.
const CHANGE_SERVER_GRACE: Duration = Duration::from_secs(8);

/// The tray's "Change server": asks the page first, so that the session ends on the server too.
pub fn request_change_server<R: Runtime>(app: &AppHandle<R>) {
    let request = app.state::<AppState>().begin_change_server();
    if let Err(error) = app.emit_to(EventTarget::webview_window(MAIN), CHANGE_SERVER_EVENT, ()) {
        log::warn!("change server: the page was not told ({error})");
    }
    let app = app.clone();
    // Off the UI thread: destroying libmpv waits on mpv's threads (mpv/mod.rs).
    std::thread::spawn(move || {
        std::thread::sleep(CHANGE_SERVER_GRACE);
        if app.state::<AppState>().change_server_pending(request) {
            log::warn!("change server: no answer from the page, changing without signing out");
            if let Err(error) = change_server_now(&app, Reload::Navigate) {
                log::error!("change server: {error:?}");
            }
        }
    });
}

/// How the bundled page goes to the server address screen.
pub enum Reload {
    /// The page asked (it is alive): it replaces itself, so no history entry leads back to the
    /// signed-out app (the mouse's back button, Alt+Left).
    Replace,
    /// The page never answered (it may hang): the webview navigates.
    Navigate,
}

/// Blocking: libmpv is destroyed and the credential store written before the page reloads.
pub fn change_server_now<R: Runtime>(app: &AppHandle<R>, reload: Reload) -> CommandResult<()> {
    let state = app.state::<AppState>();
    state.end_change_server();
    media_session::clear(app);
    state.player.destroy_blocking();
    if let Some(origin) = state.server_origin() {
        if let Err(TokenError(error)) = token::clear(&origin) {
            log::warn!("cannot forget the token of {origin}: {error}");
        }
    }
    let window = app
        .get_webview_window(MAIN)
        .ok_or_else(|| CommandError::new("desktop/internal", "main window missing"))?;
    let mut target = local_page_url();
    target.set_query(Some("change=1"));
    let done = match reload {
        Reload::Replace => window.eval(replace_script(&target)),
        Reload::Navigate => window.navigate(target),
    };
    done.map_err(|error| CommandError::new("desktop/internal", error.to_string()))
}

/// `location.replace` of `target`, quoted as a JSON string.
fn replace_script(target: &Url) -> String {
    format!("window.location.replace({})", Value::from(target.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_the_page_with_the_server_screen() {
        let mut target = local_page_url();
        target.set_query(Some("change=1"));
        assert_eq!(
            replace_script(&target),
            format!("window.location.replace(\"{}?change=1\")", local_page_url())
        );
    }
}
