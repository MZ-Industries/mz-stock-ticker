use chrono::{Datelike, TimeZone, Timelike};
use chrono_tz::America::New_York;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

mod commands;
use commands::*;
mod market;
use market::*;

/// Tauri event carrying the freshly polled tail of the chart's series.
pub(crate) const LIVE_BARS_EVENT: &str = "live-bars";

#[derive(Debug, Deserialize)]
struct YahooChartResponse {
    chart: YahooChartContainer,
}

#[derive(Debug, Deserialize)]
struct MassiveAggregatesResponse {
    results: Option<Vec<AggregateBar>>,
}

#[derive(Debug, Deserialize)]
struct YahooChartContainer {
    result: Option<Vec<YahooChartResult>>,
}

#[derive(Debug, Deserialize)]
struct YahooChartResult {
    timestamp: Option<Vec<i64>>,
    indicators: Option<YahooIndicators>,
    meta: Option<YahooChartMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YahooChartMeta {
    regular_market_price: Option<f64>,
    previous_close: Option<f64>,
    chart_previous_close: Option<f64>,
    pre_market_price: Option<f64>,
    pre_market_change_percent: Option<f64>,
    post_market_price: Option<f64>,
    post_market_change_percent: Option<f64>,
    regular_market_day_high: Option<f64>,
    regular_market_day_low: Option<f64>,
    regular_market_volume: Option<f64>,
    fifty_two_week_high: Option<f64>,
    fifty_two_week_low: Option<f64>,
    long_name: Option<String>,
    short_name: Option<String>,
    currency: Option<String>,
    full_exchange_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YahooIndicators {
    quote: Option<Vec<YahooQuoteSeries>>,
}

#[derive(Debug, Deserialize)]
struct YahooQuoteSeries {
    open: Option<Vec<Option<f64>>>,
    high: Option<Vec<Option<f64>>>,
    low: Option<Vec<Option<f64>>>,
    close: Option<Vec<Option<f64>>>,
    volume: Option<Vec<Option<f64>>>,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
struct AggregateBar {
    t: i64,
    o: f64,
    h: f64,
    l: f64,
    c: f64,
    v: f64,
}

#[derive(Debug, Deserialize)]
struct YahooQuoteResponse {
    #[serde(rename = "quoteResponse")]
    quote_response: YahooQuoteContainer,
}

#[derive(Debug, Deserialize)]
struct YahooQuoteContainer {
    result: Option<Vec<YahooQuoteItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YahooQuoteItem {
    symbol: String,
    regular_market_price: Option<f64>,
    regular_market_time: Option<i64>,
    regular_market_previous_close: Option<f64>,
    regular_market_change_percent: Option<f64>,
    regular_market_open: Option<f64>,
    regular_market_day_high: Option<f64>,
    regular_market_day_low: Option<f64>,
    regular_market_volume: Option<f64>,
    average_daily_volume_3_month: Option<f64>,
    fifty_two_week_high: Option<f64>,
    fifty_two_week_low: Option<f64>,
    market_cap: Option<f64>,
    #[serde(rename = "trailingPE")]
    trailing_pe: Option<f64>,
    eps_trailing_twelve_months: Option<f64>,
    /// Already a percentage (e.g. 0.35 means 0.35%), unlike trailingAnnualDividendYield.
    dividend_yield: Option<f64>,
    market_state: Option<String>,
    currency: Option<String>,
    full_exchange_name: Option<String>,
    pre_market_price: Option<f64>,
    pre_market_change_percent: Option<f64>,
    post_market_price: Option<f64>,
    post_market_change_percent: Option<f64>,
    short_name: Option<String>,
    long_name: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct SnapshotItem {
    ticker: String,
    price: f64,
    change_percent: f64,
    previous_close: Option<f64>,
    quote_timestamp_ms: Option<i64>,
    pre_market_price: Option<f64>,
    pre_market_change_percent: Option<f64>,
    post_market_price: Option<f64>,
    post_market_change_percent: Option<f64>,
    name: Option<String>,
}

impl SnapshotItem {
    fn empty(ticker: &str) -> Self {
        SnapshotItem {
            ticker: ticker.to_string(),
            price: 0.0,
            change_percent: 0.0,
            previous_close: None,
            quote_timestamp_ms: None,
            pre_market_price: None,
            pre_market_change_percent: None,
            post_market_price: None,
            post_market_change_percent: None,
            name: None,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct SymbolDetail {
    ticker: String,
    name: Option<String>,
    exchange: Option<String>,
    currency: Option<String>,
    market_state: Option<String>,
    open: Option<f64>,
    day_high: Option<f64>,
    day_low: Option<f64>,
    previous_close: Option<f64>,
    volume: Option<f64>,
    average_volume_3m: Option<f64>,
    fifty_two_week_high: Option<f64>,
    fifty_two_week_low: Option<f64>,
    market_cap: Option<f64>,
    trailing_pe: Option<f64>,
    eps_ttm: Option<f64>,
    dividend_yield_percent: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct YahooSearchQuotesResponse {
    quotes: Option<Vec<YahooSearchQuote>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YahooSearchQuote {
    symbol: Option<String>,
    shortname: Option<String>,
    longname: Option<String>,
    exch_disp: Option<String>,
    exchange: Option<String>,
    quote_type: Option<String>,
    type_disp: Option<String>,
    is_yahoo_finance: Option<bool>,
}

#[derive(Debug, Serialize)]
struct SearchResult {
    symbol: String,
    name: String,
    exchange: String,
    quote_type: String,
}

#[derive(Debug, Deserialize)]
struct YahooSearchResponse {
    news: Option<Vec<YahooNewsItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YahooNewsItem {
    uuid: Option<String>,
    title: Option<String>,
    publisher: Option<String>,
    link: Option<String>,
    provider_publish_time: Option<i64>,
    summary: Option<String>,
    thumbnail: Option<YahooNewsThumbnail>,
}

#[derive(Debug, Deserialize)]
struct YahooNewsThumbnail {
    resolutions: Option<Vec<YahooNewsResolution>>,
}

#[derive(Debug, Deserialize)]
struct YahooNewsResolution {
    url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct NewsItem {
    id: String,
    title: String,
    source: String,
    author: String,
    published_utc: String,
    article_url: String,
    image_url: String,
    description: String,
}

#[derive(Default)]
struct StreamState {
    task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    streaming: Arc<AtomicBool>,
}

type SnapshotCache = Mutex<HashMap<String, (SnapshotItem, Instant)>>;
type DetailCache = Mutex<HashMap<String, (SymbolDetail, Instant)>>;

static SNAPSHOT_CACHE: OnceLock<SnapshotCache> = OnceLock::new();
static DETAIL_CACHE: OnceLock<DetailCache> = OnceLock::new();
static YAHOO_CLIENT: OnceLock<Client> = OnceLock::new();
/// Cached crumb for the v7 quote endpoint; None until first acquired,
/// invalidated whenever Yahoo answers 401/403.
static YAHOO_CRUMB: OnceLock<Mutex<Option<String>>> = OnceLock::new();

const SNAPSHOT_CACHE_TTL: Duration = Duration::from_secs(90);
const DETAIL_CACHE_TTL: Duration = Duration::from_secs(60);
// Yahoo's chart endpoint rate-limits well before you would like it to, and a 429
// there also starves the aggregate/quote calls that share the same host.
const LIVE_POLL_ACTIVE: Duration = Duration::from_secs(15);
const LIVE_POLL_IDLE: Duration = Duration::from_secs(120);
const LIVE_POLL_MAX_BACKOFF: Duration = Duration::from_secs(300);
const LIVE_POLL_RATE_LIMIT_BACKOFF: Duration = Duration::from_secs(120);
/// Candles re-read on every poll, to catch Yahoo backfilling one that just closed.
const LIVE_TAIL_BARS: usize = 4;

#[derive(Debug, Serialize)]
struct ProviderStatus {
    provider: String,
    streaming: bool,
    poll_interval_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
struct LiveBarsEvent {
    sym: String,
    bars: Vec<AggregateBar>,
}

fn snapshot_cache() -> &'static SnapshotCache {
    SNAPSHOT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .manage(StreamState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_provider_status,
            fetch_aggregates,
            fetch_snapshots,
            fetch_sparklines,
            fetch_news,
            fetch_symbol_detail,
            search_symbols,
            start_live_stream,
            stop_live_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
