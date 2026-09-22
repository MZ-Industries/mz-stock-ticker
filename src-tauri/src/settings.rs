//! Backend settings edited from the Preferences pane.
//!
//! These used to be read from the environment (a `.env` file in development).
//! They now live in `settings.json` beside the dashboard preferences and are
//! cached in memory, so the synchronous accessors in `market.rs` can read them
//! per request without touching the disk.

use serde::{Deserialize, Serialize};
use std::sync::{OnceLock, RwLock};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "backend";

pub(crate) const DEFAULT_YAHOO_BASE_URL: &str = "https://query1.finance.yahoo.com";
pub(crate) const DEFAULT_YAHOO_NEWS_BASE_URL: &str = "https://query2.finance.yahoo.com";
pub(crate) const DEFAULT_BACKFILL_BASE_URL: &str = "https://api.massive.com";

/// Yahoo's chart endpoint rate-limits well before a faster poll would help.
const MIN_LIVE_POLL_MS: u64 = 1_000;

static SETTINGS: OnceLock<RwLock<Settings>> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Market-data endpoint (quotes, charts, sparklines).
    pub yahoo_base_url: String,
    /// News and symbol-search endpoint.
    pub yahoo_news_base_url: String,
    /// Polygon-compatible aggregates API used to backfill missing volume.
    pub backfill_base_url: String,
    /// Empty turns the volume backfill off.
    pub backfill_api_key: String,
    /// Live poll interval in milliseconds. Zero follows the session: 15s during
    /// extended hours, 120s outside them.
    pub live_poll_ms: u64,
    /// Writes backend request logs to stderr.
    pub debug_logging: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            yahoo_base_url: DEFAULT_YAHOO_BASE_URL.to_string(),
            yahoo_news_base_url: DEFAULT_YAHOO_NEWS_BASE_URL.to_string(),
            backfill_base_url: DEFAULT_BACKFILL_BASE_URL.to_string(),
            backfill_api_key: String::new(),
            live_poll_ms: 0,
            debug_logging: false,
        }
    }
}

impl Settings {
    /// A blank endpoint falls back to its default and an out-of-range poll
    /// interval back to automatic, so a half-filled form cannot break fetching.
    fn normalized(mut self) -> Self {
        self.yahoo_base_url = endpoint(&self.yahoo_base_url, DEFAULT_YAHOO_BASE_URL);
        self.yahoo_news_base_url = endpoint(&self.yahoo_news_base_url, DEFAULT_YAHOO_NEWS_BASE_URL);
        self.backfill_base_url = endpoint(&self.backfill_base_url, DEFAULT_BACKFILL_BASE_URL);
        self.backfill_api_key = self.backfill_api_key.trim().to_string();

        if self.live_poll_ms < MIN_LIVE_POLL_MS {
            self.live_poll_ms = 0;
        }

        self
    }
}

/// Trailing slashes would double up against the `/v8/...` paths appended later.
fn endpoint(value: &str, fallback: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn cell() -> &'static RwLock<Settings> {
    SETTINGS.get_or_init(|| RwLock::new(Settings::default()))
}

/// Reads the live settings. Callers borrow rather than clone so that the hot
/// paths (`debug_log`, every request URL) stay cheap.
pub(crate) fn with<T>(read: impl FnOnce(&Settings) -> T) -> T {
    match cell().read() {
        Ok(settings) => read(&settings),
        Err(poisoned) => read(&poisoned.into_inner()),
    }
}

fn replace(settings: Settings) {
    match cell().write() {
        Ok(mut current) => *current = settings,
        Err(poisoned) => *poisoned.into_inner() = settings,
    }
}

/// Loads the stored settings at startup. Anything unreadable leaves the
/// defaults in place, which is what a fresh install runs on anyway.
pub fn load(app: &AppHandle) {
    let stored = app
        .store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(STORE_KEY))
        .and_then(|value| serde_json::from_value::<Settings>(value).ok());

    if let Some(settings) = stored {
        replace(settings.normalized());
    }
}

#[tauri::command]
pub fn get_settings() -> Settings {
    with(Clone::clone)
}

/// Persists the pane's edits and returns them as stored, so the form can show
/// the normalized values back to the user.
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let settings = settings.normalized();
    let value = serde_json::to_value(&settings).map_err(|err| err.to_string())?;

    let store = app.store(STORE_FILE).map_err(|err| err.to_string())?;
    store.set(STORE_KEY, value);
    store.save().map_err(|err| err.to_string())?;

    replace(settings.clone());
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_endpoints_fall_back_to_defaults() {
        let settings = Settings {
            yahoo_base_url: "   ".to_string(),
            yahoo_news_base_url: String::new(),
            backfill_base_url: String::new(),
            ..Settings::default()
        }
        .normalized();

        assert_eq!(settings.yahoo_base_url, DEFAULT_YAHOO_BASE_URL);
        assert_eq!(settings.yahoo_news_base_url, DEFAULT_YAHOO_NEWS_BASE_URL);
        assert_eq!(settings.backfill_base_url, DEFAULT_BACKFILL_BASE_URL);
    }

    #[test]
    fn endpoints_lose_trailing_slashes_and_padding() {
        let settings = Settings {
            yahoo_base_url: "  https://example.test/  ".to_string(),
            ..Settings::default()
        }
        .normalized();

        assert_eq!(settings.yahoo_base_url, "https://example.test");
    }

    #[test]
    fn too_fast_a_poll_interval_reverts_to_automatic() {
        assert_eq!(
            Settings {
                live_poll_ms: 250,
                ..Settings::default()
            }
            .normalized()
            .live_poll_ms,
            0
        );
        assert_eq!(
            Settings {
                live_poll_ms: 30_000,
                ..Settings::default()
            }
            .normalized()
            .live_poll_ms,
            30_000
        );
    }

    #[test]
    fn api_key_is_trimmed() {
        let settings = Settings {
            backfill_api_key: "  abc123 ".to_string(),
            ..Settings::default()
        }
        .normalized();

        assert_eq!(settings.backfill_api_key, "abc123");
    }
}
