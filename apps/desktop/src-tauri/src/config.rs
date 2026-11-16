//! The stored configuration: `config.json` in the app config dir (`%APPDATA%\<identifier>\`).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};

pub const FILE_NAME: &str = "config.json";

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
    /// The main window's bounds when the app last closed (§28.4); absent before the first close
    /// (or in a config written by an older app).
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub window: Option<WindowBounds>,
}

/// The main window outside full screen: its outer position in physical pixels (the virtual
/// screen's coordinates, which every monitor shares), its inner size in logical pixels (the size
/// the page is drawn at, whatever the monitor's scale) and whether it was maximized. When it was,
/// the position and size are the ones it restores to.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

/// A field the app can live without: an unreadable value is absent rather than the whole file
/// unreadable (a broken `window` must not forget the server).
fn lenient<'de, D: Deserializer<'de>, T: DeserializeOwned>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).ok())
}

pub fn config_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// A missing or unreadable file is an empty config (first launch, or a file the user broke): the app
/// then asks for the server again instead of failing to start.
pub fn load(path: &Path) -> Config {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
            log::warn!("ignoring unreadable {}: {error}", path.display());
            Config::default()
        }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Config::default(),
        Err(error) => {
            log::warn!("cannot read {}: {error}", path.display());
            Config::default()
        }
    }
}

/// Written to a temporary file then renamed, so a crash never leaves a half-written config.
pub fn save(path: &Path, config: &Config) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(config).map_err(io::Error::other)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, text + "\n")?;
    fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "projo-desktop-test-{name}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn missing_file_is_an_empty_config() {
        let dir = temp_dir("missing");
        assert_eq!(load(&config_path(&dir)), Config::default());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn saves_and_loads_the_server_url() {
        let dir = temp_dir("roundtrip").join("nested");
        let path = config_path(&dir);
        let config = Config {
            server_url: Some("http://nas.local:8080".into()),
            window: None,
        };
        save(&path, &config).expect("save");
        assert_eq!(load(&path), config);
        let text = fs::read_to_string(&path).expect("read");
        assert!(
            text.contains("\"serverUrl\": \"http://nas.local:8080\""),
            "{text}"
        );
        assert!(!path.with_extension("json.tmp").exists());
        save(&path, &Config::default()).expect("save empty");
        assert_eq!(fs::read_to_string(&path).expect("read").trim(), "{}");
        fs::remove_dir_all(dir.parent().expect("parent")).ok();
    }

    #[test]
    fn corrupt_file_is_an_empty_config() {
        let dir = temp_dir("corrupt");
        let path = config_path(&dir);
        fs::write(&path, "{ not json").expect("write");
        assert_eq!(load(&path), Config::default());
        fs::write(&path, r#"{ "serverUrl": "http://a:1", "unknown": true }"#).expect("write");
        assert_eq!(
            load(&path),
            Config {
                server_url: Some("http://a:1".into()),
                window: None,
            }
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn saves_and_loads_the_window_bounds() {
        let dir = temp_dir("window");
        let path = config_path(&dir);
        let config = Config {
            server_url: Some("http://nas.local:8080".into()),
            window: Some(WindowBounds {
                x: -1800,
                y: 120,
                width: 1440.5,
                height: 900.0,
                maximized: true,
            }),
        };
        save(&path, &config).expect("save");
        assert_eq!(load(&path), config);
        let text = fs::read_to_string(&path).expect("read");
        assert!(text.contains("\"maximized\": true"), "{text}");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn an_unreadable_window_keeps_the_server() {
        let dir = temp_dir("window-corrupt");
        let path = config_path(&dir);
        for window in [
            r#""wide""#,
            r#"{ "x": 1, "y": 2 }"#,
            r#"{ "x": 1.5, "y": 2, "width": 1280, "height": 720 }"#,
            "null",
        ] {
            fs::write(
                &path,
                format!(r#"{{ "serverUrl": "http://a:1", "window": {window} }}"#),
            )
            .expect("write");
            assert_eq!(
                load(&path),
                Config {
                    server_url: Some("http://a:1".into()),
                    window: None,
                },
                "{window}"
            );
        }
        // `maximized` left out: not maximized.
        fs::write(
            &path,
            r#"{ "window": { "x": 10, "y": 20, "width": 1280, "height": 720 } }"#,
        )
        .expect("write");
        assert_eq!(
            load(&path).window,
            Some(WindowBounds {
                x: 10,
                y: 20,
                width: 1280.0,
                height: 720.0,
                maximized: false,
            })
        );
        fs::remove_dir_all(dir).ok();
    }
}
