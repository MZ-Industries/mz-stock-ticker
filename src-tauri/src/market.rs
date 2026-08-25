use super::*;

pub(crate) fn get_cached_snapshot(ticker: &str) -> Option<SnapshotItem> {
    let cache = snapshot_cache();
    let map = cache.lock().ok()?;
    let (item, seen_at) = map.get(ticker)?;
    if seen_at.elapsed() <= SNAPSHOT_CACHE_TTL {
        Some(item.clone())
    } else {
        None
    }
}

pub(crate) fn get_any_cached_snapshot(ticker: &str) -> Option<SnapshotItem> {
    let cache = snapshot_cache();
    let map = cache.lock().ok()?;
    map.get(ticker).map(|(item, _)| item.clone())
}

pub(crate) fn put_cached_snapshot(item: SnapshotItem) {
    if let Ok(mut map) = snapshot_cache().lock() {
        map.insert(item.ticker.clone(), (item, Instant::now()));
    }
}

pub(crate) fn stop_active_stream(stream_state: &StreamState) {
    stream_state.streaming.store(false, Ordering::Relaxed);
    if let Ok(mut task_lock) = stream_state.task.lock() {
        if let Some(task) = task_lock.take() {
            task.abort();
        }
    }
}

pub(crate) fn debug_enabled() -> bool {
    std::env::var("MASSIVE_DEBUG")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(true)
}

pub(crate) fn debug_log(message: &str) {
    if debug_enabled() {
        eprintln!("[ticker-debug] {}", message);
    }
}

pub(crate) fn yahoo_base_url() -> String {
    std::env::var("YAHOO_BASE_URL").unwrap_or_else(|_| "https://query1.finance.yahoo.com".to_string())
}

pub(crate) fn yahoo_news_base_url() -> String {
    std::env::var("YAHOO_NEWS_BASE_URL").unwrap_or_else(|_| "https://query2.finance.yahoo.com".to_string())
}

pub(crate) fn massive_base_url() -> String {
    std::env::var("MASSIVE_BASE_URL")
        .or_else(|_| std::env::var("POLYGON_BASE_URL"))
        .unwrap_or_else(|_| "https://api.massive.com".to_string())
}

pub(crate) fn massive_api_key() -> Option<String> {
    std::env::var("MASSIVE_API_KEY")
        .or_else(|_| std::env::var("POLYGON_API_KEY"))
        .ok()
}

pub(crate) fn yahoo_client() -> Result<&'static Client, String> {
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

pub(crate) fn rate_limit_error(prefix: &str, response: &reqwest::Response) -> String {
    let retry_after = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("90");
    format!("RATE_LIMITED:{}:retry_after={}", prefix, retry_after)
}

pub(crate) fn is_regular_market_bar(timestamp_ms: i64) -> bool {
    let Some(dt) = New_York.timestamp_millis_opt(timestamp_ms).single() else {
        return false;
    };
    let mins = dt.hour() * 60 + dt.minute();
    let open = 9 * 60 + 30;
    let close = 16 * 60;
    mins >= open && mins <= close
}

pub(crate) fn interval_to_ms(multiplier: u16, timespan: &str) -> Option<i64> {
    let base_ms = match timespan {
        "minute" => 60_000_i64,
        "hour" => 3_600_000_i64,
        "day" => 86_400_000_i64,
        "week" => 7 * 86_400_000_i64,
        "month" => 30 * 86_400_000_i64,
        _ => return None,
    };

    base_ms.checked_mul(multiplier as i64)
}

pub(crate) fn to_bucket(timestamp_ms: i64, bucket_ms: i64) -> i64 {
    // Align to fixed buckets so slightly offset feed timestamps can still join.
    timestamp_ms.div_euclid(bucket_ms)
}

pub(crate) fn is_premarket_bar(timestamp_ms: i64) -> bool {
    let Some(dt) = New_York.timestamp_millis_opt(timestamp_ms).single() else {
        return false;
    };
    let mins = dt.hour() * 60 + dt.minute();
    let open = 9 * 60 + 30;
    mins < open
}

pub(crate) fn overlay_volume_for_bucket(overlay: &HashMap<i64, f64>, bucket: i64) -> Option<f64> {
    // Feeds can label intervals differently (start vs end), so allow adjacent bucket fallback.
    let candidates = [bucket, bucket - 1, bucket + 1];
    candidates
        .iter()
        .filter_map(|candidate| overlay.get(candidate).copied())
        .filter(|volume| *volume > 0.0)
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
}

pub(crate) async fn fetch_massive_volume_overlay(
    ticker: &str,
    multiplier: u16,
    timespan: &str,
    from: &str,
    to: &str,
) -> Result<HashMap<i64, f64>, String> {
    let Some(api_key) = massive_api_key() else {
        return Ok(HashMap::new());
    };

    let overlay_to = add_days_ymd(to, 1).unwrap_or_else(|| to.to_string());
    debug_log(&format!(
        "aggs:massive-req ticker={} multiplier={} timespan={} from={} to={} overlay_to={}",
        ticker, multiplier, timespan, from, to, overlay_to
    ));

    let mut url = Url::parse(&format!(
        "{}/v2/aggs/ticker/{}/range/{}/{}/{}/{}",
        massive_base_url(), ticker, multiplier, timespan, from, overlay_to
    ))
    .map_err(|err| format!("Bad Massive aggs URL: {}", err))?;

    url.query_pairs_mut()
        .append_pair("adjusted", "true")
        .append_pair("sort", "asc")
        .append_pair("limit", "50000")
        .append_pair("apiKey", &api_key);

    let client = yahoo_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("Massive network error: {}", err))?;

    if !response.status().is_success() {
        return Err(format!("Massive API error: HTTP {}", response.status()));
    }

    let payload = response
        .json::<MassiveAggregatesResponse>()
        .await
        .map_err(|err| format!("Failed to parse Massive aggregate response: {}", err))?;

    let Some(bucket_ms) = interval_to_ms(multiplier, timespan) else {
        return Ok(HashMap::new());
    };

    let rows = payload.results.unwrap_or_default();
    if let (Some(first), Some(last)) = (rows.first(), rows.last()) {
        debug_log(&format!(
            "aggs:massive-window first_t={} last_t={} count={}",
            first.t,
            last.t,
            rows.len()
        ));
    }

    let mut by_bucket: HashMap<i64, f64> = HashMap::new();
    for bar in rows {
        if bar.v <= 0.0 {
            continue;
        }

        let bucket = to_bucket(bar.t, bucket_ms);
        by_bucket
            .entry(bucket)
            .and_modify(|current| {
                if bar.v > *current {
                    *current = bar.v;
                }
            })
            .or_insert(bar.v);
    }

    Ok(by_bucket)
}

pub(crate) async fn fetch_snapshot_from_chart(client: &Client, ticker: &str) -> SnapshotItem {
    let mut url = match Url::parse(&format!("{}/v8/finance/chart/{}", yahoo_base_url(), ticker)) {
        Ok(value) => value,
        Err(_) => {
            return SnapshotItem {
                ticker: ticker.to_string(),
                price: 0.0,
                change_percent: 0.0,
                quote_timestamp_ms: None,
                pre_market_price: None,
                pre_market_change_percent: None,
                post_market_price: None,
                post_market_change_percent: None,
                name: None,
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
                quote_timestamp_ms: None,
                pre_market_price: None,
                pre_market_change_percent: None,
                post_market_price: None,
                post_market_change_percent: None,
                name: None,
            }
        }
    };

    if !response.status().is_success() {
        return SnapshotItem {
            ticker: ticker.to_string(),
            price: 0.0,
            change_percent: 0.0,
            quote_timestamp_ms: None,
            pre_market_price: None,
            pre_market_change_percent: None,
            post_market_price: None,
            post_market_change_percent: None,
            name: None,
        };
    }

    let payload = match response.json::<YahooChartResponse>().await {
        Ok(value) => value,
        Err(_) => {
            return SnapshotItem {
                ticker: ticker.to_string(),
                price: 0.0,
                change_percent: 0.0,
                quote_timestamp_ms: None,
                pre_market_price: None,
                pre_market_change_percent: None,
                post_market_price: None,
                post_market_change_percent: None,
                name: None,
            }
        }
    };

    let chart = payload.chart.result.unwrap_or_default().into_iter().next();
    let Some(chart) = chart else {
        return SnapshotItem {
            ticker: ticker.to_string(),
            price: 0.0,
            change_percent: 0.0,
            quote_timestamp_ms: None,
            pre_market_price: None,
            pre_market_change_percent: None,
            post_market_price: None,
            post_market_change_percent: None,
            name: None,
        };
    };

    let close_from_meta = chart.meta.as_ref().and_then(|meta| meta.regular_market_price);
    let prev_close = chart.meta.as_ref().and_then(|meta| meta.previous_close);
    let pre_market_price = chart.meta.as_ref().and_then(|meta| meta.pre_market_price);
    let pre_market_change_percent = chart.meta.as_ref().and_then(|meta| meta.pre_market_change_percent);
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
        quote_timestamp_ms: None,
        pre_market_price,
        pre_market_change_percent,
        post_market_price,
        post_market_change_percent,
        name: None,
    }
}

pub(crate) fn sanitize_ticker(ticker: &str) -> Result<String, String> {
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

pub(crate) fn parse_ymd(date: &str) -> Option<(i32, u32, u32)> {
    let mut parts = date.split('-');
    let y = parts.next()?.parse::<i32>().ok()?;
    let m = parts.next()?.parse::<u32>().ok()?;
    let d = parts.next()?.parse::<u32>().ok()?;
    Some((y, m, d))
}

pub(crate) fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = month as i32;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) as i64
}

pub(crate) fn range_days(from: &str, to: &str) -> u32 {
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

pub(crate) fn yahoo_range_from_days(days: u32) -> &'static str {
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

pub(crate) fn yahoo_interval(timespan: &str, multiplier: u16, range: &str) -> String {
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

pub(crate) fn add_days_ymd(date: &str, days: i64) -> Option<String> {
    let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let shifted = parsed.checked_add_signed(chrono::Duration::days(days))?;
    Some(shifted.format("%Y-%m-%d").to_string())
}

/// Milliseconds covered by a Yahoo `interval` string, for minute-based intervals only.
pub(crate) fn yahoo_minute_interval_ms(interval: &str) -> Option<i64> {
    let minutes = interval.strip_suffix('m')?.parse::<i64>().ok()?;
    if minutes <= 0 {
        return None;
    }
    Some(minutes * 60_000)
}

/// Snaps intraday candles onto their interval grid.
///
/// Yahoo tails an intraday series with the live quote stamped at wall-clock time
/// rather than at the bucket start. Left alone that trailing entry sits a few tens
/// of seconds off the grid and every downstream "is this the same bucket?"
/// comparison inherits the skew.
///
/// That trailing entry is a *quote snapshot*, not a candle: its price fields are
/// current, but its volume is a running total for the session, not the volume of
/// the bucket it lands in. Carrying that number across would drop a bar worth tens
/// of millions of shares into a two-minute bucket. So an off-grid entry
/// contributes price only - the bucket keeps whatever volume a real candle gave it,
/// and a bucket that has no real candle yet reports no volume until Yahoo
/// publishes one.
pub(crate) fn align_bars_to_grid(bars: Vec<AggregateBar>, bucket_ms: i64) -> Vec<AggregateBar> {
    let mut out: Vec<AggregateBar> = Vec::with_capacity(bars.len());

    for mut bar in bars {
        let bucket_start = bar.t.div_euclid(bucket_ms) * bucket_ms;
        let is_quote_snapshot = bar.t != bucket_start;
        bar.t = bucket_start;

        if is_quote_snapshot {
            bar.v = 0.0;
        }

        match out.last_mut() {
            Some(last) if last.t == bar.t => {
                last.h = last.h.max(bar.h);
                last.l = last.l.min(bar.l);
                last.c = bar.c;
                if !is_quote_snapshot {
                    last.v = bar.v;
                }
            }
            _ => out.push(bar),
        }
    }

    out
}

/// Extended-hours trading window (04:00-20:00 ET, weekdays). Used to decide how
/// aggressively the live poller should hit Yahoo.
pub(crate) fn is_extended_session_now() -> bool {
    let now = chrono::Utc::now().with_timezone(&New_York);
    if matches!(now.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun) {
        return false;
    }

    let minutes = now.hour() * 60 + now.minute();
    minutes >= 4 * 60 && minutes < 20 * 60
}

pub(crate) fn live_poll_interval() -> Duration {
    let configured = std::env::var("LIVE_POLL_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value >= 1_000);

    match configured {
        Some(ms) => Duration::from_millis(ms),
        None if is_extended_session_now() => LIVE_POLL_ACTIVE,
        None => LIVE_POLL_IDLE,
    }
}

/// Fetches candles from Yahoo's chart endpoint and snaps intraday ones onto their
/// interval grid. Shared by the one-shot history fetch and the live poller so both
/// see identical timestamps.
pub(crate) async fn fetch_chart_bars(
    ticker: &str,
    range: &str,
    interval: &str,
) -> Result<Vec<AggregateBar>, String> {
    let mut url = Url::parse(&format!("{}/v8/finance/chart/{}", yahoo_base_url(), ticker))
        .map_err(|err| format!("Bad Yahoo chart URL: {}", err))?;
    url.query_pairs_mut()
        .append_pair("range", range)
        .append_pair("interval", interval)
        .append_pair("includePrePost", "true")
        .append_pair("events", "div,split");

    let client = yahoo_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("Network error: {}", err))?;

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

    let bars = payload
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
                let Some((open, high, low, close)) = opens
                    .get(index)
                    .and_then(|v| *v)
                    .zip(highs.get(index).and_then(|v| *v))
                    .zip(lows.get(index).and_then(|v| *v))
                    .zip(closes.get(index).and_then(|v| *v))
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
                    v: volumes.get(index).and_then(|v| *v).unwrap_or(0.0),
                });
            }

            Some(bars)
        })
        .unwrap_or_default();

    if let Some(bucket_ms) = yahoo_minute_interval_ms(interval) {
        log_volume_outliers(&bars, bucket_ms);
    }

    // Hourly and daily candles are stamped at the session open (09:30 ET); flooring
    // those to a UTC grid would relabel them half an hour early.
    Ok(match yahoo_minute_interval_ms(interval) {
        Some(interval_ms) => align_bars_to_grid(bars, interval_ms),
        None => bars,
    })
}

/// Reports candles whose volume is wildly out of line with the rest of the series.
///
/// Yahoo has been observed publishing the *session running total* in the volume
/// field instead of the bucket's own volume, which paints a bar tens of times
/// taller than any real one. The trailing off-grid quote row is a known source and
/// is handled in `align_bars_to_grid`; this exists to show whether grid-aligned
/// rows carry it too, which would need a different remedy.
fn log_volume_outliers(bars: &[AggregateBar], bucket_ms: i64) {
    if !debug_enabled() {
        return;
    }

    let mut volumes: Vec<f64> = bars.iter().map(|bar| bar.v).filter(|v| *v > 0.0).collect();
    if volumes.len() < 20 {
        return;
    }

    volumes.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = volumes[volumes.len() / 2];
    if median <= 0.0 {
        return;
    }

    let threshold = median * 20.0;
    let mut running = 0.0_f64;

    for bar in bars {
        if bar.v > threshold {
            let on_grid = bar.t == bar.t.div_euclid(bucket_ms) * bucket_ms;
            debug_log(&format!(
                "aggs:volume-outlier t={} on_grid={} v={} median={} running_total_before={} ratio_to_running={:.3}",
                bar.t,
                on_grid,
                bar.v,
                median,
                running,
                if running > 0.0 { bar.v / running } else { f64::NAN }
            ));
        }
        running += bar.v;
    }
}

/// How far back the live poller looks. Just enough to cover the candle being
/// filled plus the couple behind it that Yahoo may still be revising.
pub(crate) fn live_stream_range(timespan: &str) -> &'static str {
    match timespan {
        "minute" => "1d",
        "hour" => "5d",
        _ => "1mo",
    }
}

/// Re-fetches the tail of the chart's own series and republishes any candle that
/// changed.
///
/// It polls at the interval the chart is actually displaying rather than
/// synthesising candles from 1-minute data. Yahoo publishes the in-progress candle
/// as a near-flat, zero-volume placeholder and only fills in its real OHLC once the
/// candle closes, so the tail has to be re-read - emitting a candle once, when it
/// is first seen, freezes it in that placeholder state forever.
pub(crate) fn start_live_poll_task(
    app: AppHandle,
    stream_state: &StreamState,
    ticker: String,
    interval: String,
    range: &'static str,
) {
    stop_active_stream(stream_state);
    stream_state.streaming.store(true, Ordering::Relaxed);

    let streaming = Arc::clone(&stream_state.streaming);
    let emit_ticker = ticker.to_uppercase();
    let task = tauri::async_runtime::spawn(async move {
        let mut last_emitted: Vec<AggregateBar> = Vec::new();
        let mut backoff = Duration::ZERO;

        loop {
            if !streaming.load(Ordering::Relaxed) {
                return;
            }

            match fetch_chart_bars(&emit_ticker, range, &interval).await {
                Ok(bars) => {
                    backoff = Duration::ZERO;

                    let tail_start = bars.len().saturating_sub(LIVE_TAIL_BARS);
                    let tail = &bars[tail_start..];

                    if !tail.is_empty() && !same_bars(tail, &last_emitted) {
                        last_emitted = tail.to_vec();
                        if let Some(newest) = tail.last() {
                            debug_log(&format!(
                                "stream:emit ticker={} bars={} newest_t={} c={} v={}",
                                emit_ticker,
                                tail.len(),
                                newest.t,
                                newest.c,
                                newest.v
                            ));
                        }
                        let _ = app.emit(
                            LIVE_BARS_EVENT,
                            LiveBarsEvent {
                                sym: emit_ticker.clone(),
                                bars: last_emitted.clone(),
                            },
                        );
                    }
                }
                Err(err) => {
                    // Back off on failure so a rate limit does not turn into a hot loop.
                    backoff = if err.starts_with("RATE_LIMITED") {
                        (backoff * 2).clamp(LIVE_POLL_RATE_LIMIT_BACKOFF, LIVE_POLL_MAX_BACKOFF)
                    } else {
                        (backoff * 2).clamp(LIVE_POLL_ACTIVE, LIVE_POLL_MAX_BACKOFF)
                    };
                    debug_log(&format!(
                        "stream:poll-failed ticker={} backoff_ms={} reason={}",
                        emit_ticker,
                        backoff.as_millis(),
                        err
                    ));
                }
            }

            let delay = if backoff.is_zero() { live_poll_interval() } else { backoff };
            tokio::time::sleep(delay).await;
        }
    });

    if let Ok(mut task_lock) = stream_state.task.lock() {
        *task_lock = Some(task);
    }
}

pub(crate) fn same_bars(left: &[AggregateBar], right: &[AggregateBar]) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(a, b)| {
            a.t == b.t && a.o == b.o && a.h == b.h && a.l == b.l && a.c == b.c && a.v == b.v
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bar(t: i64, o: f64, h: f64, l: f64, c: f64, v: f64) -> AggregateBar {
        AggregateBar { t, o, h, l, c, v }
    }

    #[test]
    fn minute_interval_ms_parses_only_minute_intervals() {
        assert_eq!(yahoo_minute_interval_ms("1m"), Some(60_000));
        assert_eq!(yahoo_minute_interval_ms("5m"), Some(300_000));
        assert_eq!(yahoo_minute_interval_ms("60m"), Some(3_600_000));
        assert_eq!(yahoo_minute_interval_ms("1d"), None);
        assert_eq!(yahoo_minute_interval_ms("0m"), None);
    }

    #[test]
    fn aligned_bars_are_left_alone() {
        let bars = vec![
            bar(1_787_588_100_000, 1.0, 2.0, 0.5, 1.5, 10.0),
            bar(1_787_588_160_000, 1.5, 2.5, 1.0, 2.0, 20.0),
        ];

        let aligned = align_bars_to_grid(bars, 60_000);

        assert_eq!(aligned.len(), 2);
        assert_eq!(aligned[0].t, 1_787_588_100_000);
        assert_eq!(aligned[1].t, 1_787_588_160_000);
    }

    #[test]
    fn trailing_quote_snapshot_contributes_price_but_not_volume() {
        // Yahoo tails the series with the live quote stamped at wall-clock time -
        // 1787588212000 is 52s into the 1787588160000 minute - and its volume field
        // is the session running total, not this minute's volume.
        let bars = vec![
            bar(1_787_588_100_000, 1.0, 2.0, 0.5, 1.5, 10.0),
            bar(1_787_588_160_000, 1.5, 2.6, 1.4, 2.0, 20.0),
            bar(1_787_588_212_000, 2.0, 2.9, 1.2, 2.4, 31_000_000.0),
        ];

        let aligned = align_bars_to_grid(bars, 60_000);

        assert_eq!(aligned.len(), 2);
        let last = &aligned[1];
        assert_eq!(last.t, 1_787_588_160_000);
        assert_eq!(last.o, 1.5, "the bucket keeps the open it started with");
        assert_eq!(last.h, 2.9, "the snapshot still extends the range");
        assert_eq!(last.l, 1.2);
        assert_eq!(last.c, 2.4, "and carries the newest close");
        assert_eq!(last.v, 20.0, "but its session running total must not become bar volume");
    }

    #[test]
    fn quote_snapshot_alone_in_a_bucket_reports_no_volume() {
        // The in-progress bucket before Yahoo has published a real candle for it.
        let bars = vec![
            bar(1_787_588_100_000, 1.0, 2.0, 0.5, 1.5, 10.0),
            bar(1_787_588_171_000, 2.0, 2.0, 2.0, 2.0, 31_000_000.0),
        ];

        let aligned = align_bars_to_grid(bars, 60_000);

        assert_eq!(aligned.len(), 2);
        assert_eq!(aligned[1].t, 1_787_588_160_000);
        assert_eq!(aligned[1].c, 2.0, "price is still live");
        assert_eq!(aligned[1].v, 0.0, "volume waits for a real candle");
    }

    #[test]
    fn same_bars_compares_contents_not_identity() {
        let a = vec![bar(1_000, 1.0, 2.0, 0.5, 1.5, 10.0)];
        let same = vec![bar(1_000, 1.0, 2.0, 0.5, 1.5, 10.0)];
        // Yahoo publishes the in-progress candle flat and zero-volume, then fills it
        // in; that revision has to register as a change or it is never republished.
        let revised = vec![bar(1_000, 1.0, 2.4, 0.4, 1.9, 880.0)];

        assert!(same_bars(&a, &same));
        assert!(!same_bars(&a, &revised));
        assert!(!same_bars(&a, &[]));
    }

    #[test]
    fn live_range_covers_a_few_candles_at_each_timespan() {
        assert_eq!(live_stream_range("minute"), "1d");
        assert_eq!(live_stream_range("hour"), "5d");
        assert_eq!(live_stream_range("day"), "1mo");
    }

    #[test]
    fn live_stream_interval_matches_the_history_fetch() {
        // Streamed candles are spliced straight into the history, so both paths must
        // resolve to the same Yahoo interval or the timestamps will never line up.
        for (multiplier, timespan, history_range) in [
            (1_u16, "minute", "1d"),
            (5, "minute", "5d"),
            (30, "minute", "1mo"),
            (1, "hour", "3mo"),
            (4, "hour", "6mo"),
            (1, "day", "1y"),
        ] {
            let history = yahoo_interval(timespan, multiplier, history_range);
            let live = yahoo_interval(timespan, multiplier, live_stream_range(timespan));
            assert_eq!(history, live, "{}x{} mismatched", multiplier, timespan);
        }
    }

    #[test]
    fn wider_buckets_group_their_minutes() {
        let bars = vec![
            bar(1_787_588_100_000, 1.0, 2.0, 0.5, 1.5, 10.0),
            bar(1_787_588_160_000, 1.5, 2.5, 1.0, 2.0, 20.0),
            bar(1_787_588_400_000, 2.0, 3.0, 1.8, 2.8, 30.0),
        ];

        let aligned = align_bars_to_grid(bars, 300_000);

        assert_eq!(aligned.len(), 2);
        assert_eq!(aligned[0].t, 1_787_588_100_000);
        assert_eq!(aligned[0].c, 2.0);
        assert_eq!(aligned[1].t, 1_787_588_400_000);
    }
}
