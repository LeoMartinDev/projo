//! A page of the main window that does not load (the server went away after the start check, a
//! reload while it is off, its address no longer resolves) would leave WebView2's own error page in
//! a window without a native frame: no window buttons, nothing to move it by. The window goes back
//! to the bundled page instead, which has both, says the server does not answer and lets the user
//! retry or change server (PRODUCT.md §28.3).

use url::Url;

/// WebView2's `COREWEBVIEW2_WEB_ERROR_STATUS` values for which it shows its own error page: the
/// server could not be reached or trusted. Not `UNKNOWN` (0: an HTTP error the server's own page
/// answers, `window.stop()`), `OPERATION_CANCELED` (14: a navigation replaced, or refused by the
/// app) nor the credential prompts (17, 18).
pub fn is_load_failure(status: i32) -> bool {
    matches!(status, 1..=13 | 15 | 16)
}

/// Where the window goes when `failed` did not load: the bundled page, told why. None when the
/// bundled page itself failed (`tauri dev` without its dev server): there is nothing to go back to.
pub fn fallback_for(failed: &str, local: &Url) -> Option<Url> {
    let is_local = Url::parse(failed).is_ok_and(|url| {
        url.scheme() == local.scheme()
            && url.host_str() == local.host_str()
            && url.port_or_known_default() == local.port_or_known_default()
    });
    if is_local {
        return None;
    }
    let mut target = local.clone();
    target.set_path("/index.html");
    target.set_query(Some("unreachable=1"));
    target.set_fragment(None);
    Some(target)
}

/// Watches the main window's page loads (WebView2 `NavigationStarting` / `NavigationCompleted`)
/// and sends a failed one back to the bundled page.
#[cfg(windows)]
pub fn watch<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, local: Url) -> tauri::Result<()> {
    window.with_webview(move |platform| {
        // SAFETY: called on the UI thread with the window's live controller.
        if let Err(error) = unsafe { register(&platform.controller(), local) } {
            log::error!("cannot watch page loads: {error}");
        }
    })
}

#[cfg(windows)]
unsafe fn register(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    local: Url,
) -> windows_core::Result<()> {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_ERROR_STATUS;
    use webview2_com::{
        take_pwstr, NavigationCompletedEventHandler, NavigationStartingEventHandler,
    };
    use windows_core::{BOOL, HSTRING, PWSTR};

    let webview = controller.CoreWebView2()?;
    // The URL of each navigation in flight, by id: `NavigationCompleted` does not carry it.
    let pending: Rc<RefCell<HashMap<u64, String>>> = Rc::default();
    let starting = Rc::clone(&pending);
    let mut token = 0_i64;

    webview.add_NavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut id = 0_u64;
            let mut uri = PWSTR::null();
            // SAFETY: valid out-pointers; `take_pwstr` frees the string WebView2 allocated.
            unsafe {
                args.NavigationId(&mut id)?;
                args.Uri(&mut uri)?;
            }
            starting.borrow_mut().insert(id, take_pwstr(uri));
            Ok(())
        })),
        &mut token,
    )?;

    webview.add_NavigationCompleted(
        &NavigationCompletedEventHandler::create(Box::new(move |webview, args| {
            let (Some(webview), Some(args)) = (webview, args) else {
                return Ok(());
            };
            let mut id = 0_u64;
            let mut success = BOOL::default();
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            // SAFETY: valid out-pointers.
            unsafe {
                args.NavigationId(&mut id)?;
                args.IsSuccess(&mut success)?;
                args.WebErrorStatus(&mut status)?;
            }
            let Some(uri) = pending.borrow_mut().remove(&id) else {
                return Ok(());
            };
            if success.as_bool() || !is_load_failure(status.0) {
                return Ok(());
            }
            let Some(target) = fallback_for(&uri, &local) else {
                log::error!(
                    "the bundled page {uri} did not load (WebView2 error {})",
                    status.0
                );
                return Ok(());
            };
            log::warn!(
                "{uri} did not load (WebView2 error {}): back to the bundled page",
                status.0
            );
            // SAFETY: the webview that raised the event, on its UI thread.
            unsafe { webview.Navigate(&HSTRING::from(target.as_str())) }
        })),
        &mut token,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn connection_and_certificate_errors_are_load_failures() {
        for status in [1, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16] {
            assert!(is_load_failure(status), "{status}");
        }
    }

    #[test]
    fn http_errors_cancellations_and_credential_prompts_are_not() {
        for status in [0, 14, 17, 18, 19, -1] {
            assert!(!is_load_failure(status), "{status}");
        }
    }

    #[test]
    fn a_server_page_falls_back_to_the_bundled_page() {
        let local = url("http://tauri.localhost/");
        assert_eq!(
            fallback_for("https://projo.example.com/watch/abc?t=3#x", &local),
            Some(url("http://tauri.localhost/index.html?unreachable=1"))
        );
        let dev = url("http://127.0.0.1:1430/");
        assert_eq!(
            fallback_for("http://127.0.0.1:8080/", &dev),
            Some(url("http://127.0.0.1:1430/index.html?unreachable=1"))
        );
    }

    #[test]
    fn the_bundled_page_itself_has_no_fallback() {
        assert_eq!(
            fallback_for(
                "http://tauri.localhost/index.html",
                &url("http://tauri.localhost/")
            ),
            None
        );
        assert_eq!(
            fallback_for("http://127.0.0.1:1430/", &url("http://127.0.0.1:1430/")),
            None
        );
    }
}
