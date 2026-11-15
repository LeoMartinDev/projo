//! The session's bearer token (PRODUCT.md §28.3) in the Windows Credential Manager, through the
//! `keyring` crate's native backend: one generic credential per server origin (service: the app's
//! identifier, user: the origin), so a token is only ever read back for the server that issued
//! it. Never in the page's storage. A missing or failing store is an error, never a panic.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenError(pub String);

#[cfg(windows)]
mod store {
    use keyring::{Entry, Error};

    use super::TokenError;

    /// The credential's service: the app's identifier (`tauri.conf.json`).
    const SERVICE: &str = "dev.leomartin.projo.desktop";

    fn failed(error: Error) -> TokenError {
        TokenError(error.to_string())
    }

    /// No credential is not a failure: no token.
    pub fn absent_is_none<T>(result: Result<T, Error>) -> Result<Option<T>, TokenError> {
        match result {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(failed(error)),
        }
    }

    fn entry(origin: &str) -> Result<Entry, TokenError> {
        Entry::new(SERVICE, origin).map_err(failed)
    }

    pub fn read(origin: &str) -> Result<Option<String>, TokenError> {
        absent_is_none(entry(origin)?.get_password())
    }

    pub fn write(origin: &str, token: &str) -> Result<(), TokenError> {
        entry(origin)?.set_password(token).map_err(failed)
    }

    pub fn clear(origin: &str) -> Result<(), TokenError> {
        absent_is_none(entry(origin)?.delete_credential()).map(|_| ())
    }
}

#[cfg(not(windows))]
mod store {
    use super::TokenError;

    fn unavailable() -> TokenError {
        TokenError("no credential store on this platform".into())
    }

    pub fn read(_origin: &str) -> Result<Option<String>, TokenError> {
        Err(unavailable())
    }

    pub fn write(_origin: &str, _token: &str) -> Result<(), TokenError> {
        Err(unavailable())
    }

    pub fn clear(_origin: &str) -> Result<(), TokenError> {
        Err(unavailable())
    }
}

/// The token kept for `origin`, if any.
pub fn read(origin: &str) -> Result<Option<String>, TokenError> {
    store::read(origin)
}

/// Keeps `token` for `origin`, replacing any previous one.
pub fn write(origin: &str, token: &str) -> Result<(), TokenError> {
    if token.trim().is_empty() {
        return Err(TokenError("empty token".into()));
    }
    store::write(origin, token)
}

/// Forgets the token of `origin`; nothing kept is not an error.
pub fn clear(origin: &str) -> Result<(), TokenError> {
    store::clear(origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_an_empty_token() {
        assert!(write("http://nas.local:8080", "  ").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn a_missing_credential_is_no_token() {
        use keyring::Error;
        assert_eq!(
            store::absent_is_none::<String>(Err(Error::NoEntry)),
            Ok(None)
        );
        assert_eq!(
            store::absent_is_none(Ok("token".to_string())),
            Ok(Some("token".to_string()))
        );
        assert!(
            store::absent_is_none::<String>(Err(Error::NoStorageAccess("locked".into()))).is_err()
        );
    }
}
