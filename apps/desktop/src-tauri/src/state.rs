//! Process-wide state shared by commands and window handlers.

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use crate::config::{self, Config};
use crate::mpv::Player;

pub struct AppState {
    pub config_path: PathBuf,
    /// One writer of `config.json` at a time: the server and the window's bounds share it.
    config_lock: Mutex<()>,
    pub player: Arc<Player>,
    server_origin: Mutex<Option<String>>,
    /// "Change server" asked by the tray (numbered) and the last one done (commands.rs).
    change_requested: AtomicU64,
    change_done: AtomicU64,
}

impl AppState {
    pub fn new(
        config_path: PathBuf,
        player: Arc<Player>,
        server_origin: Option<String>,
    ) -> AppState {
        AppState {
            config_path,
            config_lock: Mutex::new(()),
            player,
            server_origin: Mutex::new(server_origin),
            change_requested: AtomicU64::new(0),
            change_done: AtomicU64::new(0),
        }
    }

    /// Reads `config.json`, applies `change` and writes it back, keeping what it does not change.
    pub fn update_config(&self, change: impl FnOnce(&mut Config)) -> io::Result<()> {
        let _writing = self
            .config_lock
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let mut config = config::load(&self.config_path);
        change(&mut config);
        config::save(&self.config_path, &config)
    }

    pub fn server_origin(&self) -> Option<String> {
        self.server_origin
            .lock()
            .map(|origin| origin.clone())
            .unwrap_or(None)
    }

    pub fn set_server_origin(&self, origin: String) {
        if let Ok(mut current) = self.server_origin.lock() {
            *current = Some(origin);
        }
    }

    /// A "Change server" asked: its number.
    pub fn begin_change_server(&self) -> u64 {
        self.change_requested.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Whether the request `number` is still waiting for the server change.
    pub fn change_server_pending(&self, number: u64) -> bool {
        self.change_done.load(Ordering::SeqCst) < number
    }

    /// The server changed: every request so far is done.
    pub fn end_change_server(&self) {
        self.change_done.store(
            self.change_requested.load(Ordering::SeqCst),
            Ordering::SeqCst,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_of_server_is_pending_until_done() {
        let player = Player::new(Vec::new(), Arc::new(|_| {}));
        let state = AppState::new(PathBuf::from("config.json"), player, None);
        let first = state.begin_change_server();
        assert!(state.change_server_pending(first));
        state.end_change_server();
        assert!(!state.change_server_pending(first));
        let second = state.begin_change_server();
        assert!(state.change_server_pending(second));
    }

    #[test]
    fn a_config_update_keeps_the_other_fields() {
        let dir = std::env::temp_dir().join(format!(
            "projo-desktop-test-state-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let path = config::config_path(&dir);
        let player = Player::new(Vec::new(), Arc::new(|_| {}));
        let state = AppState::new(path.clone(), player, None);
        state
            .update_config(|config| config.server_url = Some("http://nas.local:8080".into()))
            .expect("save the server");
        let bounds = config::WindowBounds {
            x: 10,
            y: 20,
            width: 1280.0,
            height: 720.0,
            maximized: false,
        };
        state
            .update_config(|config| config.window = Some(bounds))
            .expect("save the window");
        assert_eq!(
            config::load(&path),
            Config {
                server_url: Some("http://nas.local:8080".into()),
                window: Some(bounds),
            }
        );
        std::fs::remove_dir_all(dir).ok();
    }
}
