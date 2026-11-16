//! What the main window does with an address (PRODUCT.md §28.4): it shows the bundled page only;
//! another site opens in the system browser.

use url::Url;

use crate::commands::is_local_page;

/// Whether the window may load `url`: the bundled page (and the blank page WebView2 starts on).
pub fn may_load(url: &Url) -> bool {
    is_local_page(url) || url.as_str() == "about:blank"
}

#[derive(Debug, PartialEq, Eq)]
pub enum NewWindow {
    /// Nothing opens: a page of the app has no address outside the window (http://tauri.localhost
    /// means nothing to the system browser).
    Ignore,
    OpenInBrowser,
}

/// A new window asked by the page (`target="_blank"`, `window.open`, a middle click, Ctrl or
/// Shift + click): the window never opens another, so another site goes to the system browser and
/// a page of the app is ignored.
pub fn new_window(url: &Url) -> NewWindow {
    if !is_local_page(url) && is_web(url) {
        NewWindow::OpenInBrowser
    } else {
        NewWindow::Ignore
    }
}

fn is_web(url: &Url) -> bool {
    url.scheme() == "http" || url.scheme() == "https"
}

/// Opens `url` in the default browser; anything but `http(s)` is ignored.
pub fn open_in_browser(url: &Url) {
    if !is_web(url) {
        return;
    }
    // The default browser, without a shell in between (no quoting issue).
    let opened = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url.as_str()])
        .spawn();
    if let Err(error) = opened {
        log::warn!("cannot open {url}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_page_url;

    fn url(value: &str) -> Url {
        Url::parse(value).expect("test url")
    }

    fn local(path: &str) -> Url {
        local_page_url().join(path).expect("local url")
    }

    #[test]
    fn loads_the_bundled_page_only() {
        assert!(may_load(&local("/")));
        assert!(may_load(&local("/items/abc?season=2")));
        assert!(may_load(&url("about:blank")));
        assert!(!may_load(&url("http://nas.local:8080/")));
        assert!(!may_load(&url("https://www.themoviedb.org/movie/1")));
    }

    #[test]
    fn a_new_window_of_the_app_is_ignored() {
        assert_eq!(new_window(&local("/items/abc")), NewWindow::Ignore);
        assert_eq!(new_window(&local("/")), NewWindow::Ignore);
        assert_eq!(new_window(&url("about:blank")), NewWindow::Ignore);
        assert_eq!(new_window(&url("file:///C:/Windows")), NewWindow::Ignore);
        assert_eq!(new_window(&url("javascript:alert(1)")), NewWindow::Ignore);
    }

    #[test]
    fn a_new_window_of_another_site_opens_in_the_browser() {
        assert_eq!(
            new_window(&url("http://nas.local:8080/setup")),
            NewWindow::OpenInBrowser
        );
        assert_eq!(
            new_window(&url("https://github.com/LeoMartinDev/projo")),
            NewWindow::OpenInBrowser
        );
    }
}
