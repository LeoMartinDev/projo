//! IPC commands. mpv_* and desktop_info are granted to the server origin only (runtime capability,
//! see `grant_server`) and re-checked here against the webview's current URL; get_setup and
//! connect_server belong to the bundled first-launch page; change_server to both.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, Runtime, State, Webview};
use url::Url;

use crate::config::{self, Config};
use crate::mpv::{MpvError, Player};
use crate::origin::{is_same_origin, parse_server_origin, remote_pattern, OriginError};
use crate::server::{check_health, HealthError};
use crate::state::AppState;
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

type CommandResult<T> = Result<T, CommandError>;

/// Same origin as the configured server, else `desktop/forbidden_origin`.
fn require_server<R: Runtime>(webview: &Webview<R>, state: &AppState) -> CommandResult<()> {
    let url = webview
        .url()
        .map_err(|error| CommandError::new("desktop/forbidden_origin", error.to_string()))?;
    match state.server_origin() {
        Some(origin) if is_same_origin(&url, &origin) => Ok(()),
        _ => Err(CommandError::new(
            "desktop/forbidden_origin",
            format!(
                "{} is not the configured server",
                url.origin().ascii_serialization()
            ),
        )),
    }
}

pub fn is_local_page(url: &Url) -> bool {
    let local = local_page_url();
    url.scheme() == local.scheme()
        && url.host_str() == local.host_str()
        && url.port() == local.port()
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

/// Runs blocking work (libmpv calls, HTTP) off the UI thread and off the async workers.
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
    require_server(&webview, &state)?;
    let player = player(&state);
    blocking(move || Ok(player.init_blocking(options.unwrap_or_default())?)).await
}

#[tauri::command]
pub async fn mpv_command<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    args: Vec<String>,
) -> CommandResult<()> {
    require_server(&webview, &state)?;
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
    require_server(&webview, &state)?;
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
    require_server(&webview, &state)?;
    let player = player(&state);
    blocking(move || Ok(player.get_property(&name)?)).await
}

#[tauri::command]
pub async fn mpv_observe<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
    names: Vec<String>,
) -> CommandResult<()> {
    require_server(&webview, &state)?;
    let player = player(&state);
    blocking(move || Ok(player.observe(&names)?)).await
}

#[tauri::command]
pub async fn mpv_destroy<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    require_server(&webview, &state)?;
    let player = player(&state);
    blocking(move || {
        player.destroy_blocking();
        Ok(())
    })
    .await
}

#[derive(Serialize)]
pub struct DesktopInfo {
    version: String,
    mpv: String,
}

#[tauri::command]
pub async fn desktop_info<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<DesktopInfo> {
    require_server(&webview, &state)?;
    let player = player(&state);
    let version = app.package_info().version.to_string();
    blocking(move || {
        Ok(DesktopInfo {
            version,
            mpv: player.mpv_version_blocking()?,
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    #[serde(skip_serializing_if = "Option::is_none")]
    server_url: Option<String>,
}

#[tauri::command]
pub fn get_setup<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> CommandResult<Setup> {
    require_local(&webview)?;
    Ok(Setup {
        server_url: state.server_origin(),
    })
}

/// Validates `url` (`<origin>/health` must answer like a projo server), stores it, grants the
/// origin IPC and navigates the main window there.
#[tauri::command]
pub async fn connect_server<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
    url: String,
) -> CommandResult<()> {
    require_local(&webview)?;
    let origin = parse_server_origin(&url).map_err(|error| {
        let message = match error {
            OriginError::Empty => "no address",
            OriginError::Invalid => "not a valid address",
            OriginError::UnsupportedScheme => "only http:// and https:// are supported",
            OriginError::Credentials => "the address must not contain a user name or password",
        };
        CommandError::new("server/invalid_url", message)
    })?;
    let checked = origin.clone();
    blocking(move || {
        check_health(&checked).map_err(|error| match error {
            HealthError::Unreachable(message) => CommandError::new("server/unreachable", message),
            HealthError::NotProjo(message) => CommandError::new("server/not_projo", message),
        })
    })
    .await?;
    let config = Config {
        server_url: Some(origin.clone()),
    };
    config::save(&state.config_path, &config)
        .map_err(|error| CommandError::new("desktop/config_not_saved", error.to_string()))?;
    state.set_server_origin(origin.clone());
    grant_server(&app, &state, &origin)?;
    let target = Url::parse(&format!("{origin}/"))
        .map_err(|error| CommandError::new("server/invalid_url", error.to_string()))?;
    let window = app
        .get_webview_window(MAIN)
        .ok_or_else(|| CommandError::new("desktop/internal", "main window missing"))?;
    log::info!("opening {origin}");
    window
        .navigate(target)
        .map_err(|error| CommandError::new("desktop/internal", error.to_string()))
}

/// Grants the server origin the IPC it needs, once per origin and process. A grant cannot be
/// withdrawn at runtime: after a change of server the old origin is unreachable anyway (navigation
/// is limited to the configured origin) and `require_server` refuses it.
pub fn grant_server<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    origin: &str,
) -> CommandResult<()> {
    if !state.mark_granted(origin) {
        return Ok(());
    }
    let mut capability = CapabilityBuilder::new(format!("server-{}", state.granted_count()))
        .remote(remote_pattern(origin))
        .local(false)
        .window(MAIN);
    for permission in SERVER_PERMISSIONS {
        capability = capability.permission(*permission);
    }
    app.add_capability(capability).map_err(|error| {
        CommandError::new(
            "desktop/internal",
            format!("cannot grant IPC to {origin}: {error}"),
        )
    })
}

pub const SERVER_PERMISSIONS: &[&str] = &[
    "allow-mpv-init",
    "allow-mpv-command",
    "allow-mpv-set-property",
    "allow-mpv-get-property",
    "allow-mpv-observe",
    "allow-mpv-destroy",
    "allow-desktop-info",
    "allow-change-server",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:window:allow-set-fullscreen",
    "core:window:allow-is-fullscreen",
    "core:window:allow-is-maximized",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-internal-toggle-maximize",
    "core:window:allow-start-dragging",
    "core:window:allow-close",
];

/// Back to the bundled page to pick another server (also Ctrl+Shift+U, see `SHORTCUT_SCRIPT`).
#[tauri::command]
pub async fn change_server<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let player = player(&state);
    blocking(move || {
        player.destroy_blocking();
        Ok(())
    })
    .await?;
    let window = app
        .get_webview_window(MAIN)
        .ok_or_else(|| CommandError::new("desktop/internal", "main window missing"))?;
    let mut target = local_page_url();
    target.set_path("/index.html");
    target.set_query(Some("change=1"));
    window
        .navigate(target)
        .map_err(|error| CommandError::new("desktop/internal", error.to_string()))
}
