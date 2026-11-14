//! The window's user agent is WebView2's, an Edge one, plus `projo-desktop/<version>`: the server
//! names a session opened from the app "projo desktop · Windows", not "Edge · Windows"
//! (PRODUCT.md §28.4).

/// `default` with the app's token appended, once.
pub fn with_app_token(default: &str, version: &str) -> String {
    let token = format!("projo-desktop/{version}");
    if default.split(' ').any(|part| part == token) {
        default.to_owned()
    } else {
        format!("{default} {token}")
    }
}

/// Appends the app's token to the main window's user agent (WebView2 `ICoreWebView2Settings2`).
/// The window starts on the bundled page, so the server's origin always sees the marked one.
#[cfg(windows)]
pub fn mark<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    version: String,
) -> tauri::Result<()> {
    window.with_webview(move |platform| {
        // SAFETY: called on the UI thread with the window's live controller.
        if let Err(error) = unsafe { set(&platform.controller(), &version) } {
            log::error!("cannot set the user agent: {error}");
        }
    })
}

#[cfg(windows)]
unsafe fn set(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    version: &str,
) -> windows_core::Result<()> {
    use webview2_com::take_pwstr;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings2;
    use windows_core::{Interface, HSTRING, PWSTR};

    let settings: ICoreWebView2Settings2 = controller.CoreWebView2()?.Settings()?.cast()?;
    let mut current = PWSTR::null();
    settings.UserAgent(&mut current)?;
    // `take_pwstr` frees the string WebView2 allocated.
    let marked = with_app_token(&take_pwstr(current), version);
    settings.SetUserAgent(&HSTRING::from(marked))
}

#[cfg(test)]
mod tests {
    use super::*;

    const EDGE: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                        (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";

    #[test]
    fn appends_the_app_token() {
        assert_eq!(
            with_app_token(EDGE, "0.4.0"),
            format!("{EDGE} projo-desktop/0.4.0")
        );
    }

    #[test]
    fn appends_it_once() {
        let marked = with_app_token(EDGE, "0.4.0");
        assert_eq!(with_app_token(&marked, "0.4.0"), marked);
    }
}
