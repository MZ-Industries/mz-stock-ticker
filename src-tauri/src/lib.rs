use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use reqwest::{Client, Url};

#[derive(Debug, Deserialize)]
struct YahooChartResponse {
    chart: YahooChartContainer,
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
    post_market_price: Option<f64>,
    post_market_change_percent: Option<f64>,
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

#[derive(Debug, Deserialize, Serialize)]
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
    regular_market_previous_close: Option<f64>,
    regular_market_change_percent: Option<f64>,
    post_market_price: Option<f64>,
    post_market_change_percent: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
struct SnapshotItem {
    ticker: String,
    price: f64,
    change_percent: f64,
    post_market_price: Option<f64>,
    post_market_change_percent: Option<f64>,
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
struct StreamState;

type SnapshotCache = Mutex<HashMap<String, (SnapshotItem, Instant)>>;

static SNAPSHOT_CACHE: OnceLock<SnapshotCache> = OnceLock::new();
static YAHOO_CLIENT: OnceLock<Client> = OnceLock::new();

const SNAPSHOT_CACHE_TTL: Duration = Duration::from_secs(90);

fn snapshot_cache() -> &'static SnapshotCache {
    SNAPSHOT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_cached_snapshot(ticker: &str) -> Option<SnapshotItem> {
    let cache = snapshot_cache();
    let map = cache.lock().ok()?;
    let (item, seen_at) = map.get(ticker)?;
    if seen_at.elapsed() <= SNAPSHOT_CACHE_TTL {
        Some(item.clone())
    } else {
        None
    }
}

fn get_any_cached_snapshot(ticker: &str) -> Option<SnapshotItem> {
    let cache = snapshot_cache();
    let map = cache.lock().ok()?;
    map.get(ticker).map(|(item, _)| item.clone())
}

fn put_cached_snapshot(item: SnapshotItem) {
    if let Ok(mut map) = snapshot_cache().lock() {
        map.insert(item.ticker.clone(), (item, Instant::now()));
    }
}

fn debug_enabled() -> bool {
    std::env::var("MASSIVE_DEBUG")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(true)
}

fn debug_log(message: &str) {
    if debug_enabled() {
        eprintln!("[ticker-debug] {}", message);
    }
}

fn yahoo_base_url() -> String {
    std::env::var("YAHOO_BASE_URL").unwrap_or_else(|_| "https://query1.finance.yahoo.com".to_string())
}

fn yahoo_news_base_url() -> String {
    std::env::var("YAHOO_NEWS_BASE_URL").unwrap_or_else(|_| "https://query2.finance.yahoo.com".to_string())
}

fn yahoo_client() -> Result<&'static Client, String> {
    if let Some(client) = YAHOO_CLIENT.get() {
        return Ok(client);
    }

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| format!("Failed to build Yahoo HTTP client: {}", err))?;

    let _ = YAHOO_CLIENT.set(client);

    YAHOO_CLIENT
        .get()
        .ok_or_else(|| "Yahoo HTTP client initialization failed".to_string())
}

fn rate_limit_error(prefix: &str, response: &reqwest::Response) -> String {
    let retry_after = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("90");
    format!("RATE_LIMITED:{}:retry_after={}", prefix, retry_after)
}

async fn fetch_snapshot_from_chart(client: &Client, ticker: &str) -> SnapshotItem {
    let mut url = match Url::parse(&format!("{}/v8/finance/chart/{}", yahoo_base_url(), ticker)) {
        Ok(value) => value,
        Err(_) => {
            return SnapshotItem {
                ticker: ticker.to_string(),
                price: 0.0,
                change_percent: 0.0,
                post_market_price: None,
                post_market_change_percent: None,
            }
        }
    };

    url.query_pairs_mut()
        .append_pair("range", "1d")
        .append_pair("interval", "1m")
        .append_pair("includePrePost", "true");

    let response = match client.get(url).send().await {
        Ok(value) => value,
        Err(_) => {
            return SnapshotItem {
                ticker: ticker.to_string(),
                price: 0.0,
                change_percent: 0.0,
                post_market_price: None,
                post_market_change_percent: None,
            }
        }
    };

    if !response.status().is_success() {
        return SnapshotItem {
            ticker: ticker.to_string(),
            price: 0.0,
            change_percent: 0.0,
            post_market_price: None,
            post_market_change_percent: None,
        };
    }

    let payload = match response.json::<YahooChartResponse>().await {
        Ok(value) => value,
        Err(_) => {
            return SnapshotItem {
                ticker: ticker.to_string(),
                price: 0.0,
                change_percent: 0.0,
                post_market_price: None,
                post_market_change_percent: None,
            }
        }
    };

    let chart = payload.chart.result.unwrap_or_default().into_iter().next();
    let Some(chart) = chart else {
        return SnapshotItem {
            ticker: ticker.to_string(),
            price: 0.0,
            change_percent: 0.0,
            post_market_price: None,
            post_market_change_percent: None,
        };
    };

    let close_from_meta = chart.meta.as_ref().and_then(|meta| meta.regular_market_price);
    let prev_close = chart.meta.as_ref().and_then(|meta| meta.previous_close);
    let post_market_price = chart.meta.as_ref().and_then(|meta| meta.post_market_price);
    let post_market_change_percent = chart
        .meta
        .as_ref()
        .and_then(|meta| meta.post_market_change_percent);

    let close_from_bars = chart
        .indicators
        .and_then(|indicators| indicators.quote)
        .and_then(|mut quotes| quotes.pop())
        .and_then(|quote| quote.close)
        .and_then(|closes| closes.into_iter().rev().flatten().next());

    let price = close_from_meta.or(close_from_bars).unwrap_or(0.0);
    let change_percent = if let Some(previous_close) = prev_close {
        if previous_close.abs() > f64::EPSILON {
            ((price - previous_close) / previous_close) * 100.0
        } else {
            0.0
        }
    } else {
        0.0
    };

    SnapshotItem {
        ticker: ticker.to_string(),
        price,
        change_percent,
        post_market_price,
        post_market_change_percent,
    }
}

fn sanitize_ticker(ticker: &str) -> Result<String, String> {
    let trimmed = ticker.trim().to_uppercase();
    let valid = !trimmed.is_empty()
        && trimmed.len() <= 12
        && trimmed
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '.' || c == '-');

    if valid {
        Ok(trimmed)
    } else {
        Err("Ticker symbol contains invalid characters".to_string())
    }
}

fn parse_ymd(date: &str) -> Option<(i32, u32, u32)> {
    let mut parts = date.split('-');
    let y = parts.next()?.parse::<i32>().ok()?;
    let m = parts.next()?.parse::<u32>().ok()?;
    let d = parts.next()?.parse::<u32>().ok()?;
    Some((y, m, d))
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = month as i32;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) as i64
}

fn range_days(from: &str, to: &str) -> u32 {
    let Some((fy, fm, fd)) = parse_ymd(from) else {
        return 30;
    };
    let Some((ty, tm, td)) = parse_ymd(to) else {
        return 30;
    };

    let start = days_from_civil(fy, fm, fd);
    let end = days_from_civil(ty, tm, td);
    let diff = (end - start).abs() as u32;
    diff.max(1)
}

fn yahoo_range_from_days(days: u32) -> &'static str {
    match days {
        0..=1 => "1d",
        2..=5 => "5d",
        6..=30 => "1mo",
        31..=90 => "3mo",
        91..=180 => "6mo",
        181..=365 => "1y",
        366..=730 => "2y",
        731..=1825 => "5y",
        _ => "max",
    }
}

fn yahoo_interval(timespan: &str, multiplier: u16, range: &str) -> String {
    let mut interval = match timespan {
        "minute" => {
            let minute_intervals = [1_u16, 2, 5, 15, 30, 60, 90];
            let selected = minute_intervals
                .iter()
                .copied()
                .find(|value| *value >= multiplier)
                .unwrap_or(90);
            format!("{}m", selected)
        }
        "hour" => "60m".to_string(),
        _ => "1d".to_string(),
    };

    if matches!(range, "1y" | "2y" | "5y" | "max") {
        interval = "1d".to_string();
    }
    if matches!(range, "6mo") && (interval == "1m" || interval == "2m") {
        interval = "30m".to_string();
    }
    if !matches!(range, "1d" | "5d") && interval == "1m" {
        interval = "5m".to_string();
    }

    interval
}

#[tauri::command]
async fn start_polygon_stream(
    ticker: String,
    channel: String,
) -> Result<(), String> {
    let _ = sanitize_ticker(&ticker)?;
    if channel != "A" && channel != "AM" {
        return Err("Unsupported stream channel".to_string());
    }
    debug_log("stream:disabled-provider=yahoo");
    Ok(())
}

#[tauri::command]
async fn stop_polygon_stream() -> Result<(), String> {
    debug_log("stream:stop-noop-provider=yahoo");
    Ok(())
}

#[tauri::command]
async fn fetch_polygon_aggregates(
    ticker: String,
    multiplier: u16,
    timespan: String,
    from: String,
    to: String,
) -> Result<Vec<AggregateBar>, String> {
    let ticker = sanitize_ticker(&ticker)?;
    if multiplier == 0 || multiplier > 1440 {
        return Err("Multiplier must be between 1 and 1440".to_string());
    }

    let allowed_timespans = ["minute", "hour", "day"];
    if !allowed_timespans.contains(&timespan.as_str()) {
        return Err("Unsupported timespan".to_string());
    }

    let days = range_days(&from, &to);
    let range = yahoo_range_from_days(days);
    let interval = yahoo_interval(&timespan, multiplier, range);

    let mut url = Url::parse(&format!("{}/v8/finance/chart/{}", yahoo_base_url(), ticker))
        .map_err(|err| format!("Bad Yahoo chart URL: {}", err))?;
    url.query_pairs_mut()
        .append_pair("range", range)
        .append_pair("interval", &interval)
        .append_pair("includePrePost", "true")
        .append_pair("events", "div,split");

    debug_log(&format!(
        "aggs:req provider=yahoo ticker={} interval={} range={} from={} to={}",
        ticker, interval, range, from, to
    ));

    let client = yahoo_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("Network error: {}", err))?;

    debug_log(&format!("aggs:status {}", response.status()));

    if response.status().as_u16() == 429 {
        return Err(rate_limit_error("aggs", &response));
    }

    if !response.status().is_success() {
        return Err(format!("Yahoo API error: HTTP {}", response.status()));
    }

    let payload = response
        .json::<YahooChartResponse>()
        .await
        .map_err(|err| format!("Failed to parse Yahoo chart response: {}", err))?;

    let results = payload
        .chart
        .result
        .unwrap_or_default()
        .into_iter()
        .next()
        .and_then(|result| {
            let timestamps = result.timestamp?;
            let quote = result.indicators?.quote?.into_iter().next()?;
            let opens = quote.open.unwrap_or_default();
            let highs = quote.high.unwrap_or_default();
            let lows = quote.low.unwrap_or_default();
            let closes = quote.close.unwrap_or_default();
            let volumes = quote.volume.unwrap_or_default();

            let mut bars = Vec::with_capacity(timestamps.len());
            for (index, ts) in timestamps.into_iter().enumerate() {
                let o = opens.get(index).and_then(|v| *v);
                let h = highs.get(index).and_then(|v| *v);
                let l = lows.get(index).and_then(|v| *v);
                let c = closes.get(index).and_then(|v| *v);
                let v = volumes.get(index).and_then(|v| *v).unwrap_or(0.0);
                let Some((open, high, low, close)) = o
                    .zip(h)
                    .zip(l)
                    .zip(c)
                    .map(|(((open, high), low), close)| (open, high, low, close))
                else {
                    continue;
                };

                // Yahoo occasionally returns malformed intraday candles; drop them to avoid chart spikes.
                if open <= 0.0 || high <= 0.0 || low <= 0.0 || close <= 0.0 {
                    continue;
                }
                if high < low {
                    continue;
                }
                if high < open.max(close) || low > open.min(close) {
                    continue;
                }

                bars.push(AggregateBar {
                    t: ts * 1000,
                    o: open,
                    h: high,
                    l: low,
                    c: close,
                    v,
                });
            }

            Some(bars)
        })
        .unwrap_or_default();

    if let Some(last) = results.last() {
        debug_log(&format!("aggs:count {} last_t {}", results.len(), last.t));
    } else {
        debug_log("aggs:count 0");
    }

    Ok(results)
}

#[tauri::command]
async fn fetch_polygon_snapshots(tickers: Vec<String>) -> Result<Vec<SnapshotItem>, String> {
    if tickers.is_empty() {
        return Ok(vec![]);
    }

    let safe_tickers = tickers
        .iter()
        .map(|t| sanitize_ticker(t))
        .collect::<Result<Vec<_>, _>>()?;

    let mut mapped: Vec<SnapshotItem> = Vec::with_capacity(safe_tickers.len());
    let mut missing: Vec<String> = Vec::new();

    for ticker in &safe_tickers {
        if let Some(cached) = get_cached_snapshot(&ticker) {
            debug_log(&format!("prev:cache-hit ticker={}", ticker));
            mapped.push(cached);
            continue;
        }

        missing.push(ticker.clone());
    }

    if !missing.is_empty() {
        let symbols = missing.join(",");
        let mut url = Url::parse(&format!("{}/v7/finance/quote", yahoo_base_url()))
            .map_err(|err| format!("Bad Yahoo quote URL: {}", err))?;
        url.query_pairs_mut().append_pair("symbols", &symbols);

        debug_log(&format!(
            "quote:req provider=yahoo symbols={} count={}",
            symbols,
            missing.len()
        ));

        let client = yahoo_client()?;
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|err| format!("Network error: {}", err))?;

        debug_log(&format!("quote:status {}", response.status()));

        if response.status().as_u16() == 429 {
            return Err(rate_limit_error("quote", &response));
        }

        if response.status().is_success() {
            let payload = response
                .json::<YahooQuoteResponse>()
                .await
                .map_err(|err| format!("Failed to parse Yahoo quote response: {}", err))?;

            let mut by_symbol: HashMap<String, YahooQuoteItem> = HashMap::new();
            for item in payload.quote_response.result.unwrap_or_default() {
                by_symbol.insert(item.symbol.to_uppercase(), item);
            }

            for ticker in missing {
                if let Some(item) = by_symbol.get(&ticker) {
                    let price = item.regular_market_price.unwrap_or(0.0);
                    let change_percent = if let Some(cp) = item.regular_market_change_percent {
                        cp
                    } else if let Some(prev_close) = item.regular_market_previous_close {
                        if prev_close.abs() > f64::EPSILON {
                            ((price - prev_close) / prev_close) * 100.0
                        } else {
                            0.0
                        }
                    } else {
                        0.0
                    };

                    let snapshot = SnapshotItem {
                        ticker: ticker.clone(),
                        price,
                        change_percent,
                        post_market_price: item.post_market_price,
                        post_market_change_percent: item.post_market_change_percent,
                    };

                    put_cached_snapshot(snapshot.clone());
                    mapped.push(snapshot);
                } else if let Some(stale) = get_any_cached_snapshot(&ticker) {
                    mapped.push(stale);
                } else {
                    mapped.push(SnapshotItem {
                        ticker,
                        price: 0.0,
                        change_percent: 0.0,
                        post_market_price: None,
                        post_market_change_percent: None,
                    });
                }
            }
        } else {
            debug_log("quote:fallback=chart");
            for ticker in missing {
                let mut snapshot = fetch_snapshot_from_chart(client, &ticker).await;
                if snapshot.price <= 0.0 {
                    if let Some(stale) = get_any_cached_snapshot(&ticker) {
                        debug_log(&format!("quote:error-using-cache ticker={}", ticker));
                        snapshot = stale;
                    }
                }

                if snapshot.price > 0.0 {
                    put_cached_snapshot(snapshot.clone());
                }
                mapped.push(snapshot);
            }
        }
    }

    mapped.sort_by(|a, b| {
        let ai = safe_tickers
            .iter()
            .position(|ticker| ticker == &a.ticker)
            .unwrap_or(usize::MAX);
        let bi = safe_tickers
            .iter()
            .position(|ticker| ticker == &b.ticker)
            .unwrap_or(usize::MAX);
        ai.cmp(&bi)
    });

    Ok(mapped)
}

#[tauri::command]
async fn fetch_polygon_news(ticker: String, limit: u8) -> Result<Vec<NewsItem>, String> {
    let ticker = sanitize_ticker(&ticker)?;
    let safe_limit = limit.clamp(1, 50);
    let mut url = Url::parse(&format!("{}/v1/finance/search", yahoo_news_base_url()))
        .map_err(|err| format!("Bad Yahoo news URL: {}", err))?;
    url.query_pairs_mut()
        .append_pair("q", &ticker)
        .append_pair("quotesCount", "0")
        .append_pair("newsCount", &safe_limit.to_string())
        .append_pair("enableFuzzyQuery", "false");

    debug_log(&format!("news:req provider=yahoo ticker={} limit={}", ticker, safe_limit));

    let client = yahoo_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("Network error: {}", err))?;

    if response.status().as_u16() == 429 {
        return Err(rate_limit_error("news", &response));
    }

    if !response.status().is_success() {
        return Err(format!("Yahoo API error: HTTP {}", response.status()));
    }

    let payload = response
        .json::<YahooSearchResponse>()
        .await
        .map_err(|err| format!("Failed to parse Yahoo news response: {}", err))?;

    let items = payload
        .news
        .unwrap_or_default()
        .into_iter()
        .take(safe_limit as usize)
        .map(|item| NewsItem {
            id: item
                .uuid
                .clone()
                .or_else(|| item.link.clone())
                .unwrap_or_else(|| format!("{}-{}", ticker, item.provider_publish_time.unwrap_or_default())),
            title: item.title.unwrap_or_else(|| "Untitled story".to_string()),
            source: item.publisher.unwrap_or_else(|| "Yahoo Finance".to_string()),
            author: "".to_string(),
            published_utc: item
                .provider_publish_time
                .map(|ts| ts.to_string())
                .unwrap_or_default(),
            article_url: item.link.unwrap_or_default(),
            image_url: item
                .thumbnail
                .and_then(|thumb| thumb.resolutions)
                .and_then(|mut resolutions| resolutions.pop())
                .and_then(|res| res.url)
                .unwrap_or_default(),
            description: item.summary.unwrap_or_default(),
        })
        .collect::<Vec<_>>();

    Ok(items)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .manage(StreamState)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            fetch_polygon_aggregates,
            fetch_polygon_snapshots,
            fetch_polygon_news,
            start_polygon_stream,
            stop_polygon_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
