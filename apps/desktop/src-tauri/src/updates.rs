//! Updates of the app itself (PRODUCT.md §28.10): the `desktop-vX.Y.Z` releases of the projo
//! repository on GitHub, each with an NSIS installer signed for the updater (minisign key, public
//! half in tauri.conf.json) and the updater's `latest.json`. Release builds check a minute after
//! launch then every 6 hours, download and verify a newer installer in the background, and run it
//! quietly when the app quits, without restarting it: an update never interrupts playback.
//!
//! The newest desktop release is found through its tag, not GitHub's "latest" release, which is
//! the server's (§16.4).

use std::sync::Mutex;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use url::Url;

const REPOSITORY: &str = "LeoMartinDev/projo";
const TAG_PREFIX: &str = "desktop-v";
const FIRST_CHECK: Duration = Duration::from_secs(60);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// A newer version, downloaded and verified, waiting for the app to quit.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<(Update, Vec<u8>)>>);

type Version = (u64, u64, u64);

/// `X.Y.Z` only: the desktop app publishes stable versions (no pre-release, no build metadata).
fn parse_version(text: &str) -> Option<Version> {
    let mut parts = text.split('.');
    let mut next = || -> Option<u64> {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    let version = (next()?, next()?, next()?);
    parts.next().is_none().then_some(version)
}

fn format_version((major, minor, patch): Version) -> String {
    format!("{major}.{minor}.{patch}")
}

/// The highest `desktop-vX.Y.Z` among the refs of GitHub's matching-refs answer.
fn newest_release(matching_refs: &str) -> Option<Version> {
    let refs: Value = serde_json::from_str(matching_refs).ok()?;
    refs.as_array()?
        .iter()
        .filter_map(|entry| entry.get("ref")?.as_str())
        .filter_map(|name| name.strip_prefix("refs/tags/")?.strip_prefix(TAG_PREFIX))
        .filter_map(parse_version)
        .max()
}

fn manifest_url(version: Version) -> Result<Url, String> {
    let version = format_version(version);
    Url::parse(&format!(
        "https://github.com/{REPOSITORY}/releases/download/{TAG_PREFIX}{version}/latest.json"
    ))
    .map_err(|error| error.to_string())
}

fn fetch_newest_release() -> Result<Option<Version>, String> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .new_agent();
    let mut response = agent
        .get(format!(
            "https://api.github.com/repos/{REPOSITORY}/git/matching-refs/tags/{TAG_PREFIX}"
        ))
        .header("accept", "application/vnd.github+json")
        .header("user-agent", "projo-desktop")
        .call()
        .map_err(|error| error.to_string())?;
    let body = response
        .body_mut()
        .with_config()
        .limit(1024 * 1024)
        .read_to_string()
        .map_err(|error| error.to_string())?;
    Ok(newest_release(&body))
}

fn check_once<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let pending = app.state::<PendingUpdate>();
    if pending
        .0
        .lock()
        .map(|pending| pending.is_some())
        .unwrap_or(true)
    {
        return Ok(());
    }
    let current = parse_version(&app.package_info().version.to_string());
    let Some(newest) = fetch_newest_release()? else {
        return Ok(());
    };
    if current.is_some_and(|current| newest <= current) {
        log::debug!("update: {} is the newest", format_version(newest));
        return Ok(());
    }
    let updater = app
        .updater_builder()
        .endpoints(vec![manifest_url(newest)?])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    let Some(update) =
        tauri::async_runtime::block_on(updater.check()).map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    log::info!("update: downloading {}", update.version);
    // The signature (and the version it was signed for) is checked by download().
    let bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {}))
        .map_err(|error| error.to_string())?;
    log::info!(
        "update: {} ready, installed when the app quits",
        update.version
    );
    if let Ok(mut pending) = pending.0.lock() {
        *pending = Some((update, bytes));
    }
    Ok(())
}

/// Release builds only, like the server's updater (§16.4): a debug build is never replaced.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    app.manage(PendingUpdate::default());
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("updates".into())
        .spawn(move || {
            std::thread::sleep(FIRST_CHECK);
            loop {
                if let Err(error) = check_once(&app) {
                    log::warn!("update check failed: {error}");
                }
                std::thread::sleep(CHECK_EVERY);
            }
        });
    if let Err(error) = spawned {
        log::warn!("cannot start the update checks: {error}");
    }
}

/// On quit, once libmpv is gone: runs the pending installer quietly (`installMode` of
/// tauri.conf.json) and exits; does nothing when there is none.
pub fn install_pending<R: Runtime>(app: &AppHandle<R>) {
    let Some(pending) = app.try_state::<PendingUpdate>() else {
        return;
    };
    let Some((update, bytes)) = pending.0.lock().ok().and_then(|mut pending| pending.take()) else {
        return;
    };
    let version = update.version.clone();
    log::info!("update: installing {version}");
    if let Err(error) = update.restart_after_install(false).install(bytes) {
        log::error!("update: cannot install {version}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_stable_versions_only() {
        assert_eq!(parse_version("0.2.10"), Some((0, 2, 10)));
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version("1.2.3-beta.1"), None);
        assert_eq!(parse_version("1.+2.3"), None);
        assert_eq!(parse_version("v1.2.3"), None);
    }

    #[test]
    fn picks_the_highest_desktop_tag() {
        let refs = r#"[
            {"ref": "refs/tags/desktop-v0.2.0"},
            {"ref": "refs/tags/desktop-v0.10.0"},
            {"ref": "refs/tags/desktop-v0.9.3"},
            {"ref": "refs/tags/desktop-v1.0.0-rc.1"},
            {"ref": "refs/tags/v9.0.0"}
        ]"#;
        assert_eq!(newest_release(refs), Some((0, 10, 0)));
        assert_eq!(newest_release("[]"), None);
        assert_eq!(newest_release(r#"{"message": "Not Found"}"#), None);
    }

    #[test]
    fn points_at_the_release_manifest() {
        assert_eq!(
            manifest_url((0, 3, 1)).map(String::from),
            Ok(
                "https://github.com/LeoMartinDev/projo/releases/download/desktop-v0.3.1/latest.json"
                    .into()
            )
        );
    }
}
