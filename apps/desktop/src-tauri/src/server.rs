//! Checks that an origin is a projo server: `GET <origin>/health` → `{ "status": "ok", "version": … }`.

use std::time::Duration;

use serde::Deserialize;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};

#[derive(Debug, PartialEq, Eq)]
pub enum HealthError {
    Unreachable(String),
    NotProjo(String),
}

#[derive(Deserialize)]
struct Health {
    status: String,
    version: String,
}

/// Validates a `/health` body; returns the server version.
pub fn parse_health(body: &str) -> Result<String, HealthError> {
    let health: Health = serde_json::from_str(body)
        .map_err(|_| HealthError::NotProjo("/health did not answer like a projo server".into()))?;
    if health.status != "ok" || health.version.is_empty() {
        return Err(HealthError::NotProjo(format!(
            "/health answered status {:?}",
            health.status
        )));
    }
    Ok(health.version)
}

pub fn check_health(origin: &str) -> Result<String, HealthError> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(6)))
        .max_redirects(0)
        .http_status_as_error(false)
        // The system's TLS stack and trust store, like the webview.
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .new_agent();
    let mut response = agent
        .get(format!("{origin}/health"))
        .header("accept", "application/json")
        .call()
        .map_err(|error| HealthError::Unreachable(error.to_string()))?;
    if response.status() != 200 {
        return Err(HealthError::NotProjo(format!(
            "/health answered HTTP {}",
            response.status().as_u16()
        )));
    }
    let body = response
        .body_mut()
        .with_config()
        .limit(64 * 1024)
        .read_to_string()
        .map_err(|error| HealthError::Unreachable(error.to_string()))?;
    let version = parse_health(&body)?;
    log::info!("{origin} is projo {version}");
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_projo_health_body() {
        assert_eq!(
            parse_health(r#"{"status":"ok","version":"1.16.0","runtime":"0.3.0"}"#),
            Ok("1.16.0".into())
        );
    }

    #[test]
    fn refuses_other_bodies() {
        for body in [
            "<html></html>",
            "{}",
            r#"{"status":"ok"}"#,
            r#"{"status":"down","version":"1"}"#,
            r#"{"status":"ok","version":""}"#,
        ] {
            assert!(
                matches!(parse_health(body), Err(HealthError::NotProjo(_))),
                "{body}"
            );
        }
    }
}
