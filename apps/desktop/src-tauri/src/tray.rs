//! The tray icon (PRODUCT.md §28.3): "Change server" and "Quit", in the system's language (French
//! or English, like the bundled page's default). No menu bar over the player.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Runtime};

use crate::commands::request_change_server;
use crate::main_window::bring_forward;

const CHANGE_SERVER: &str = "change_server";
const QUIT: &str = "quit";

struct Labels {
    change_server: &'static str,
    quit: &'static str,
}

fn labels(french: bool) -> Labels {
    if french {
        Labels {
            change_server: "Changer de serveur",
            quit: "Quitter",
        }
    } else {
        Labels {
            change_server: "Change server",
            quit: "Quit",
        }
    }
}

/// Whether a locale name (`fr-FR`, `en-US`…) is French.
fn is_french(locale: &str) -> bool {
    locale
        .split(['-', '_'])
        .next()
        .is_some_and(|language| language.eq_ignore_ascii_case("fr"))
}

#[cfg(windows)]
fn user_locale() -> Option<String> {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;
    // LOCALE_NAME_MAX_LENGTH.
    let mut buffer = [0u16; 85];
    // SAFETY: the buffer is writable for its whole length; the answer is the length written,
    // NUL included, or 0 on failure.
    let length = unsafe { GetUserDefaultLocaleName(&mut buffer) };
    let length = usize::try_from(length).ok()?.checked_sub(1)?;
    String::from_utf16(buffer.get(..length)?).ok()
}

#[cfg(not(windows))]
fn user_locale() -> Option<String> {
    std::env::var("LANG").ok()
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let labels = labels(user_locale().as_deref().is_some_and(is_french));
    let change = MenuItem::with_id(app, CHANGE_SERVER, labels.change_server, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, labels.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&change, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("projo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            CHANGE_SERVER => {
                bring_forward(app);
                request_change_server(app);
            }
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                bring_forward(tray.app_handle());
            }
        });
    // macOS' menu bar takes a template image (the symbol's shape, tinted by the system), never the
    // app's colour icon.
    if cfg!(target_os = "macos") {
        builder = builder
            .icon(tauri::include_image!("icons/tray-template.png"))
            .icon_as_template(true);
    } else if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_french_locales() {
        assert!(is_french("fr-FR"));
        assert!(is_french("fr_CA"));
        assert!(is_french("FR"));
        assert!(!is_french("en-US"));
        assert!(!is_french("fy-NL"));
        assert!(!is_french(""));
    }

    #[test]
    fn labels_follow_the_language() {
        assert_eq!(labels(true).change_server, "Changer de serveur");
        assert_eq!(labels(false).quit, "Quit");
    }
}
