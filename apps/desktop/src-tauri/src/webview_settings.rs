//! The webview behaves as an app, not a browser (PRODUCT.md §28.4): no browser context menu (only
//! the edit items, on an editable target or a selection) and no browser accelerator keys (reload,
//! print, find, view source, caret browsing, back and forward…). Release builds only: debug builds
//! keep both for inspecting the page, unless `PROJO_DESKTOP_NATIVE_WEBVIEW=1`.
//!
//! Tauri does not pass wry's `default_context_menus` and `browser_accelerator_keys` on, so this
//! goes to WebView2 itself through the window's controller (`with_webview`).
// The menu's rules are tested everywhere but only applied on Windows.
#![cfg_attr(not(windows), allow(dead_code))]

/// The debug-build switch that applies the release behaviour, to check it by hand.
const NATIVE_IN_DEBUG: &str = "PROJO_DESKTOP_NATIVE_WEBVIEW";

/// Whether the browser behaviours are turned off.
fn enabled() -> bool {
    !cfg!(debug_assertions) || std::env::var(NATIVE_IN_DEBUG).is_ok_and(|value| value == "1")
}

/// What a right click is on: WebView2's `ContextMenuTarget`.
#[derive(Clone, Copy, Debug)]
pub struct Target {
    /// An input, a textarea, a `contenteditable` element.
    pub editable: bool,
    /// Text is selected under the pointer.
    pub selection: bool,
}

/// An entry of WebView2's default menu: an item by its unlocalized `Name` (lower camel case, the
/// English label), or a separator.
#[derive(Clone, Copy, Debug)]
pub enum Entry<'a> {
    Item(&'a str),
    Separator,
}

/// What an editable target keeps: the spelling suggestions (every spelling item is named
/// `spellCheck`) and the edit items, like a native text box's menu.
const EDITABLE_ITEMS: &[&str] = &[
    "spellCheck",
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "pasteAndMatchStyle",
    "selectAll",
];

/// What a selection elsewhere keeps.
const SELECTION_ITEMS: &[&str] = &["copy", "selectAll"];

fn keeps(target: Target, name: &str) -> bool {
    if target.editable {
        EDITABLE_ITEMS.contains(&name)
    } else if target.selection {
        SELECTION_ITEMS.contains(&name)
    } else {
        false
    }
}

/// Which entries of the default menu stay, in order: the items `target` keeps and the separators
/// between two groups of them (never first, last or twice in a row). None kept: no menu at all.
pub fn kept(target: Target, entries: &[Entry]) -> Vec<bool> {
    let mut kept = vec![false; entries.len()];
    let mut item_before = false;
    let mut separator = None;
    for (index, entry) in entries.iter().enumerate() {
        match entry {
            Entry::Separator if item_before => separator = Some(index),
            Entry::Separator => {}
            Entry::Item(name) if keeps(target, name) => {
                if let Some(separator) = separator.take() {
                    kept[separator] = true;
                }
                kept[index] = true;
                item_before = true;
            }
            Entry::Item(_) => {}
        }
    }
    kept
}

/// Turns the browser behaviours off in the main window's webview (when `enabled`). Failures are
/// logged: the app works on, the webview left as a browser.
#[cfg(windows)]
pub fn apply(window: &tauri::WebviewWindow) {
    if !enabled() {
        return;
    }
    // On the window's thread, where the webview's COM objects live.
    let sent = window.with_webview(|webview| native::apply(&webview.controller()));
    if let Err(error) = sent {
        log::warn!("webview left as a browser: {error}");
    }
}

#[cfg(not(windows))]
pub fn apply(_window: &tauri::WebviewWindow) {
    let _ = enabled();
}

#[cfg(windows)]
mod native {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventArgs, ICoreWebView2AcceleratorKeyPressedEventArgs2,
        ICoreWebView2ContextMenuRequestedEventArgs, ICoreWebView2Controller,
        ICoreWebView2Settings3, ICoreWebView2_11, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND,
        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR, COREWEBVIEW2_KEY_EVENT_KIND,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
    };
    use webview2_com::{
        take_pwstr, AcceleratorKeyPressedEventHandler, ContextMenuRequestedEventHandler,
    };
    use windows::core::{Interface, Result, BOOL, PWSTR};

    use super::{kept, Entry, Target};

    pub fn apply(controller: &ICoreWebView2Controller) {
        // SAFETY (each): COM calls on the controller of a live webview, on its own thread
        // (`with_webview` runs there); every out-parameter is a local of the right type.
        if let Err(error) = unsafe { browser_keys_off(controller) } {
            log::warn!("browser accelerator keys left on: {error}");
        }
        if let Err(error) = unsafe { edit_menu_only(controller) } {
            log::warn!("browser context menu left on: {error}");
        }
    }

    /// Two steps, since WebView2 reads `AreBrowserAcceleratorKeysEnabled` only when a page loads
    /// ("disabled after the next navigation"), and the bundled page is already loading when the
    /// window is built: the setting for every later page (a change of server reloads it), and
    /// `IsBrowserAcceleratorKeyEnabled` set to false on each key down for the page loaded now
    /// (it takes precedence over the setting, at once). Neither touches the editing and movement
    /// keys (copy, paste, select all, undo, Home, End…), and both still let every key reach the
    /// page (unlike `Handled`), so the web app's own shortcuts keep working.
    unsafe fn browser_keys_off(controller: &ICoreWebView2Controller) -> Result<()> {
        let webview = controller.CoreWebView2()?;
        webview
            .Settings()?
            .cast::<ICoreWebView2Settings3>()?
            .SetAreBrowserAcceleratorKeysEnabled(false)?;
        let mut token = 0i64;
        controller.add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
                match args {
                    // SAFETY: event arguments WebView2 hands to its handler, on its thread.
                    Some(args) => unsafe { skip_browser_key(&args) },
                    None => Ok(()),
                }
            })),
            &mut token,
        )
    }

    unsafe fn skip_browser_key(args: &ICoreWebView2AcceleratorKeyPressedEventArgs) -> Result<()> {
        let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
        args.KeyEventKind(&mut kind)?;
        if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
            && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
        {
            return Ok(());
        }
        // Absent before WebView2 1.0.2210: the setting alone, from the next page load.
        match args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>() {
            Ok(args) => args.SetIsBrowserAcceleratorKeyEnabled(false),
            Err(_) => Ok(()),
        }
    }

    unsafe fn edit_menu_only(controller: &ICoreWebView2Controller) -> Result<()> {
        let webview = controller.CoreWebView2()?.cast::<ICoreWebView2_11>()?;
        let mut token = 0i64;
        webview.add_ContextMenuRequested(
            &ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                // SAFETY: event arguments WebView2 hands to its handler, on its thread.
                unsafe {
                    if let Err(error) = filter_menu(&args) {
                        // Rather no menu than the browser's.
                        log::warn!("context menu not filtered: {error}");
                        args.SetHandled(true)?;
                    }
                }
                Ok(())
            })),
            &mut token,
        )
    }

    /// Leaves the items `kept` keeps in the default menu, or shows none (`Handled`).
    unsafe fn filter_menu(args: &ICoreWebView2ContextMenuRequestedEventArgs) -> Result<()> {
        let target = args.ContextMenuTarget()?;
        let mut editable = BOOL::default();
        target.IsEditable(&mut editable)?;
        let mut selection = BOOL::default();
        target.HasSelection(&mut selection)?;
        let target = Target {
            editable: editable.as_bool(),
            selection: selection.as_bool(),
        };

        let items = args.MenuItems()?;
        let mut count = 0u32;
        items.Count(&mut count)?;
        let mut names = Vec::with_capacity(count as usize);
        for index in 0..count {
            let item = items.GetValueAtIndex(index)?;
            let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
            item.Kind(&mut kind)?;
            names.push(if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                None
            } else {
                let mut name = PWSTR::null();
                item.Name(&mut name)?;
                Some(take_pwstr(name))
            });
        }
        let entries: Vec<Entry> = names
            .iter()
            .map(|name| name.as_deref().map_or(Entry::Separator, Entry::Item))
            .collect();
        let kept = kept(target, &entries);
        log::debug!("context menu on {target:?}: {names:?}, kept {kept:?}");

        if !kept.contains(&true) {
            return args.SetHandled(true);
        }
        // From the end: removing an entry shifts the ones after it.
        for index in (0..count).rev() {
            if !kept[index as usize] {
                items.RemoveValueAtIndex(index)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EDITABLE: Target = Target {
        editable: true,
        selection: false,
    };
    const SELECTION: Target = Target {
        editable: false,
        selection: true,
    };
    const ELSEWHERE: Target = Target {
        editable: false,
        selection: false,
    };

    /// The default menu of a text field with a misspelled word selected.
    fn text_field() -> Vec<Entry<'static>> {
        vec![
            Entry::Item("spellCheck"),
            Entry::Item("spellCheck"),
            Entry::Separator,
            Entry::Item("emoji"),
            Entry::Separator,
            Entry::Item("undo"),
            Entry::Item("redo"),
            Entry::Separator,
            Entry::Item("cut"),
            Entry::Item("copy"),
            Entry::Item("paste"),
            Entry::Item("pasteAndMatchStyle"),
            Entry::Item("selectAll"),
            Entry::Separator,
            Entry::Item("writingDirection"),
            Entry::Separator,
            Entry::Item("inspectElement"),
        ]
    }

    fn names<'a>(entries: &[Entry<'a>], kept: &[bool]) -> Vec<&'a str> {
        entries
            .iter()
            .zip(kept)
            .filter(|(_, kept)| **kept)
            .map(|(entry, _)| match entry {
                Entry::Item(name) => *name,
                Entry::Separator => "-",
            })
            .collect()
    }

    #[test]
    fn an_editable_target_keeps_the_spelling_and_edit_items() {
        let entries = text_field();
        let kept = kept(EDITABLE, &entries);
        assert_eq!(
            names(&entries, &kept),
            [
                "spellCheck",
                "spellCheck",
                "-",
                "undo",
                "redo",
                "-",
                "cut",
                "copy",
                "paste",
                "pasteAndMatchStyle",
                "selectAll",
            ]
        );
    }

    #[test]
    fn a_selection_keeps_copy_and_select_all() {
        let entries = [
            Entry::Item("copy"),
            Entry::Item("selectAll"),
            Entry::Separator,
            Entry::Item("print"),
            Entry::Item("share"),
            Entry::Separator,
            Entry::Item("inspectElement"),
        ];
        let kept = kept(SELECTION, &entries);
        assert_eq!(names(&entries, &kept), ["copy", "selectAll"]);
    }

    #[test]
    fn a_selection_never_keeps_the_items_that_change_text() {
        let entries = [
            Entry::Item("cut"),
            Entry::Item("paste"),
            Entry::Item("undo"),
        ];
        assert_eq!(kept(SELECTION, &entries), [false, false, false]);
    }

    #[test]
    fn anywhere_else_there_is_no_menu() {
        let page = [
            Entry::Item("back"),
            Entry::Item("forward"),
            Entry::Item("reload"),
            Entry::Separator,
            Entry::Item("saveAs"),
            Entry::Item("print"),
            Entry::Separator,
            Entry::Item("inspectElement"),
        ];
        assert!(!kept(ELSEWHERE, &page).contains(&true));
        let link = [
            Entry::Item("openLinkInNewWindow"),
            Entry::Item("copyLinkLocation"),
            Entry::Item("copy"),
        ];
        assert!(!kept(ELSEWHERE, &link).contains(&true));
    }

    #[test]
    fn separators_only_between_kept_groups() {
        let entries = [
            Entry::Separator,
            Entry::Item("copy"),
            Entry::Separator,
            Entry::Item("print"),
            Entry::Separator,
            Entry::Separator,
            Entry::Item("selectAll"),
            Entry::Separator,
        ];
        let kept = kept(SELECTION, &entries);
        assert_eq!(names(&entries, &kept), ["copy", "-", "selectAll"]);
        assert_eq!(
            kept,
            [false, true, false, false, false, true, true, false],
            "the last separator before the next kept item stays"
        );
    }

    #[test]
    fn an_empty_menu_stays_empty() {
        assert!(kept(EDITABLE, &[]).is_empty());
    }
}
