//! The server the app shows is one origin (`scheme://host[:port]`): what the user types is reduced to
//! it, and every navigation / IPC call is checked against it.

use url::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum OriginError {
    Empty,
    Invalid,
    UnsupportedScheme,
    Credentials,
}

/// `nas.local:8080`, `http://nas.local:8080/`, `https://projo.example.com/admin` →
/// `http://nas.local:8080`, `http://nas.local:8080`, `https://projo.example.com`.
/// Without a scheme, `http://` is assumed (a LAN server is the common case).
pub fn parse_server_origin(input: &str) -> Result<String, OriginError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(OriginError::Empty);
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| OriginError::Invalid)?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(OriginError::UnsupportedScheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(OriginError::Credentials);
    }
    match url.host_str() {
        Some(host) if !host.is_empty() => {}
        _ => return Err(OriginError::Invalid),
    }
    Ok(url.origin().ascii_serialization())
}

/// Whether `url` belongs to `origin` (as returned by `parse_server_origin`).
pub fn is_same_origin(url: &Url, origin: &str) -> bool {
    url.origin().ascii_serialization() == origin
}

/// The capability pattern granting IPC to every page of the origin.
pub fn remote_pattern(origin: &str) -> String {
    format!("{origin}/*")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduces_input_to_an_origin() {
        assert_eq!(
            parse_server_origin("http://nas.local:8080/").as_deref(),
            Ok("http://nas.local:8080")
        );
        assert_eq!(
            parse_server_origin("  nas.local:8080 ").as_deref(),
            Ok("http://nas.local:8080")
        );
        assert_eq!(
            parse_server_origin("192.168.1.20:8080").as_deref(),
            Ok("http://192.168.1.20:8080")
        );
        assert_eq!(
            parse_server_origin("https://Projo.Example.com/admin/settings?x=1#y").as_deref(),
            Ok("https://projo.example.com")
        );
        assert_eq!(
            parse_server_origin("https://projo.example.com:443").as_deref(),
            Ok("https://projo.example.com")
        );
        assert_eq!(
            parse_server_origin("http://[::1]:8080").as_deref(),
            Ok("http://[::1]:8080")
        );
    }

    #[test]
    fn refuses_what_is_not_an_http_server() {
        assert_eq!(parse_server_origin(""), Err(OriginError::Empty));
        assert_eq!(parse_server_origin("   "), Err(OriginError::Empty));
        assert_eq!(
            parse_server_origin("file:///C:/x"),
            Err(OriginError::UnsupportedScheme)
        );
        assert_eq!(
            parse_server_origin("javascript://alert(1)"),
            Err(OriginError::UnsupportedScheme)
        );
        assert_eq!(
            parse_server_origin("ftp://nas"),
            Err(OriginError::UnsupportedScheme)
        );
        assert_eq!(
            parse_server_origin("http://user:pw@nas:8080"),
            Err(OriginError::Credentials)
        );
        assert_eq!(parse_server_origin("http://"), Err(OriginError::Invalid));
        assert_eq!(
            parse_server_origin("http://nas:99999"),
            Err(OriginError::Invalid)
        );
    }

    #[test]
    fn matches_urls_of_the_origin_only() {
        let origin = "http://127.0.0.1:8791";
        let url = |value: &str| Url::parse(value).expect("test url");
        assert!(is_same_origin(&url("http://127.0.0.1:8791/"), origin));
        assert!(is_same_origin(
            &url("http://127.0.0.1:8791/watch/abc?t=1"),
            origin
        ));
        assert!(!is_same_origin(&url("http://127.0.0.1:8792/"), origin));
        assert!(!is_same_origin(&url("https://127.0.0.1:8791/"), origin));
        assert!(!is_same_origin(&url("http://localhost:8791/"), origin));
        assert!(!is_same_origin(
            &url("http://127.0.0.1.evil.example:8791/"),
            origin
        ));
        assert!(!is_same_origin(
            &url("http://tauri.localhost/index.html"),
            origin
        ));
        assert_eq!(remote_pattern(origin), "http://127.0.0.1:8791/*");
    }
}
