//! Process-wide state shared by commands and window handlers.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::mpv::Player;

pub struct AppState {
    pub config_path: PathBuf,
    pub player: Arc<Player>,
    server_origin: Mutex<Option<String>>,
    granted: Mutex<HashSet<String>>,
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
            granted: Mutex::new(HashSet::new()),
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

    /// Records a grant; false when the origin already had one.
    pub fn mark_granted(&self, origin: &str) -> bool {
        self.granted
            .lock()
            .map(|mut granted| granted.insert(origin.to_string()))
            .unwrap_or(false)
    }

    pub fn granted_count(&self) -> usize {
        self.granted
            .lock()
            .map(|granted| granted.len())
            .unwrap_or(0)
    }
}
