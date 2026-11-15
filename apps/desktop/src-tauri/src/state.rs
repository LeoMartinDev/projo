//! Process-wide state shared by commands and window handlers.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::mpv::Player;

pub struct AppState {
    pub config_path: PathBuf,
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
            player,
            server_origin: Mutex::new(server_origin),
            change_requested: AtomicU64::new(0),
            change_done: AtomicU64::new(0),
        }
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
}
