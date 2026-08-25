use super::*;

#[tauri::command]
pub async fn get_provider_status(
    stream_state: tauri::State<'_, StreamState>,
) -> Result<ProviderStatus, String> {
    Ok(ProviderStatus {
        provider: "yahoo".to_string(),
        streaming: stream_state.streaming.load(Ordering::Relaxed),
        poll_interval_ms: live_poll_interval().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn start_live_stream(
    app: AppHandle,
    stream_state: tauri::State<'_, StreamState>,
    ticker: String,
    multiplier: u16,
    timespan: String,
) -> Result<(), String> {
    let ticker = sanitize_ticker(&ticker)?;
    // Poll the same series the chart is drawing, so streamed candles need no
    // re-bucketing on the front end.
    let range = live_stream_range(&timespan);
    let interval = yahoo_interval(&timespan, multiplier.max(1), range);

    start_live_poll_task(app, &stream_state, ticker.clone(), interval.clone(), range);
    debug_log(&format!(
        "stream:start ticker={} interval={} range={} poll_ms={}",
        ticker,
        interval,
        range,
        live_poll_interval().as_millis()
    ));
    Ok(())
}

#[tauri::command]
pub async fn stop_live_stream(stream_state: tauri::State<'_, StreamState>) -> Result<(), String> {
    stop_active_stream(&stream_state);
    debug_log("stream:stop");
    Ok(())
}

#[tauri::command]
pub async fn fetch_aggregates(
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

    debug_log(&format!(
        "aggs:req ticker={} interval={} range={} from={} to={}",
        ticker, interval, range, from, to
    ));

    let mut results = fetch_chart_bars(&ticker, range, &interval).await?;

    let bucket_ms = interval_to_ms(multiplier, &timespan);

    match fetch_massive_volume_overlay(&ticker, multiplier, &timespan, &from, &to).await {
        Ok(overlay) => {
            if !overlay.is_empty() {
                let mut patched = 0_usize;
                let mut patched_premarket = 0_usize;
                let mut patched_after_hours = 0_usize;
                if let Some(bucket_ms) = bucket_ms {
                    for bar in &mut results {
                        if bar.v <= 0.0 {
                            let bucket = to_bucket(bar.t, bucket_ms);
                            if let Some(volume) = overlay_volume_for_bucket(&overlay, bucket) {
                                bar.v = volume;
                                patched += 1;
                                if is_premarket_bar(bar.t) {
                                    patched_premarket += 1;
                                } else if !is_regular_market_bar(bar.t) {
                                    patched_after_hours += 1;
                                }
                            }
                        }
                    }
                }

                debug_log(&format!(
                    "aggs:massive-overlay points={} patched_zero_volume={} patched_premarket={} patched_after_hours={} bucket_ms={}",
                    overlay.len(),
                    patched,
                    patched_premarket,
                    patched_after_hours,
                    bucket_ms.unwrap_or(0)
                ));
            }
        }
        Err(err) => {
            debug_log(&format!("aggs:massive-overlay-unavailable {}", err));
        }
    }

    if !results.is_empty() {
        let regular_count = results.iter().filter(|bar| is_regular_market_bar(bar.t)).count();
        let after_hours: Vec<&AggregateBar> = results
            .iter()
            .filter(|bar| !is_regular_market_bar(bar.t))
            .collect();
        let after_non_zero = after_hours.iter().filter(|bar| bar.v > 0.0).count();
        let sample: Vec<String> = after_hours
            .iter()
            .rev()
            .take(4)
            .map(|bar| format!("t={} c={} v={}", bar.t, bar.c, bar.v))
            .collect();

        debug_log(&format!(
            "aggs:session regular={} after={} after_non_zero={} after_sample=[{}]",
            regular_count,
            after_hours.len(),
            after_non_zero,
            sample.join(", ")
        ));
    }

    if let Some(last) = results.last() {
        debug_log(&format!("aggs:count {} last_t {}", results.len(), last.t));
    } else {
        debug_log("aggs:count 0");
    }

    Ok(results)
}

#[derive(Debug, Serialize)]
pub struct SparklineItem {
    ticker: String,
    prices: Vec<f64>,
}

#[derive(Debug, Deserialize)]
pub struct YahooSparkTickerData {
    close: Option<Vec<Option<f64>>>,
}

#[tauri::command]
pub async fn fetch_sparklines(tickers: Vec<String>) -> Result<Vec<SparklineItem>, String> {
    if tickers.is_empty() {
        return Ok(vec![]);
    }

    let safe_tickers: Vec<String> = tickers
        .iter()
        .map(|t| sanitize_ticker(t))
        .collect::<Result<Vec<_>, _>>()?;

    let symbols = safe_tickers.join(",");
    let mut url = Url::parse(&format!("{}/v8/finance/spark", yahoo_base_url()))
        .map_err(|err| format!("Bad spark URL: {}", err))?;
    url.query_pairs_mut()
        .append_pair("symbols", &symbols)
        .append_pair("range", "1d")
        .append_pair("interval", "5m");

    let client = yahoo_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("Network error: {}", err))?;

    if response.status().as_u16() == 429 {
        return Err(rate_limit_error("sparklines", &response));
    }

    if !response.status().is_success() {
        return Err(format!("Yahoo spark API error: HTTP {}", response.status()));
    }

    let payload: HashMap<String, YahooSparkTickerData> = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse Yahoo spark response: {}", err))?;

    let mut items: Vec<SparklineItem> = Vec::new();
    for ticker in &safe_tickers {
        if let Some(data) = payload.get(ticker.as_str()) {
            let prices: Vec<f64> = data
                .close
                .as_deref()
                .unwrap_or_default()
                .iter()
                .filter_map(|p| *p)
                .collect();
            if !prices.is_empty() {
                items.push(SparklineItem { ticker: ticker.clone(), prices });
            }
        }
    }

    Ok(items)
}

#[tauri::command]
pub async fn fetch_snapshots(tickers: Vec<String>) -> Result<Vec<SnapshotItem>, String> {
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
        if let Some(cached) = get_cached_snapshot(ticker) {
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

        debug_log(&format!("quote:req symbols={} count={}", symbols, missing.len()));

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
                        quote_timestamp_ms: item.regular_market_time.map(|t| t * 1000),
                        pre_market_price: item.pre_market_price,
                        pre_market_change_percent: item.pre_market_change_percent,
                        post_market_price: item.post_market_price,
                        post_market_change_percent: item.post_market_change_percent,
                        name: item.short_name.clone(),
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
                        quote_timestamp_ms: None,
                        pre_market_price: None,
                        pre_market_change_percent: None,
                        post_market_price: None,
                        post_market_change_percent: None,
                        name: None,
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

    for item in &mapped {
        debug_log(&format!(
            "quote:resolved ticker={} price={} change_pct={} pre={:?}/{:?} post={:?}/{:?}",
            item.ticker,
            item.price,
            item.change_percent,
            item.pre_market_price,
            item.pre_market_change_percent,
            item.post_market_price,
            item.post_market_change_percent
        ));
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
pub async fn fetch_news(ticker: String, limit: u8) -> Result<Vec<NewsItem>, String> {
    let ticker = sanitize_ticker(&ticker)?;
    let safe_limit = limit.clamp(1, 50);
    let mut url = Url::parse(&format!("{}/v1/finance/search", yahoo_news_base_url()))
        .map_err(|err| format!("Bad Yahoo news URL: {}", err))?;
    url.query_pairs_mut()
        .append_pair("q", &ticker)
        .append_pair("quotesCount", "0")
        .append_pair("newsCount", &safe_limit.to_string())
        .append_pair("enableFuzzyQuery", "false");

    debug_log(&format!("news:req ticker={} limit={}", ticker, safe_limit));

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
