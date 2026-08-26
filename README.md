# MZ Stock Ticker

Desktop stock dashboard built with Tauri + Rust + TypeScript, styled after Apple Stocks and powered by Yahoo Finance endpoints.

## Features

- Apple-style watchlist + detail layout
- Symbol search with company-name autocomplete (exchange and type shown per result)
- Multiple chart modes (line, area, baseline, candlestick, bar)
- Crosshair OHLC/volume legend on the price chart
- Previous-close reference line on the 1D chart
- Key statistics strip (open, day range, prev close, volume, avg volume, 52-week range, market cap, P/E, EPS, dividend yield)
- Dedicated volume chart below price chart
- Moving average overlays (20 / 50 / 200)
- Range presets: 1D, 1W, 1M, 3M, 6M, YTD, 1Y, 5Y, ALL
- Resizable panes (sidebar width, price/volume split, chart/news split)
- Add/remove/reorder symbols directly in the watchlist; arrow keys move the selection
- Watchlist change badge toggles between % and $ change on click
- News cards with thumbnails and relative timestamps; opens stories in the default browser
- Yahoo-backed data calls from Rust commands (aggregates, quotes, sparklines, news, search, symbol detail)
- Cookie + crumb authentication for Yahoo's quote endpoint (required since 2023), with automatic refresh on 401
- Live trailing candle via a backend poller that republishes Yahoo's 1-minute bars
- Optional volume backfill from a Massive/Polygon-compatible aggregates API
- Persisted dashboard preferences via Tauri Store (ticker/range/chart type/pane sizes/visible range)
- Window position/size persisted natively via tauri-plugin-window-state

## Prerequisites

- Node.js 20+
- Rust toolchain
- Tauri prerequisites for macOS
- No API key required

## Environment variables

The app auto-loads a root `.env` file on startup. All are optional:

- `YAHOO_BASE_URL` (default: `https://query1.finance.yahoo.com`)
- `YAHOO_NEWS_BASE_URL` (default: `https://query2.finance.yahoo.com`)
- `MASSIVE_API_KEY` / `POLYGON_API_KEY` — enables the volume overlay that fills in
  candles Yahoo reports with zero volume (mostly pre/post market)
- `MASSIVE_BASE_URL` / `POLYGON_BASE_URL` (default: `https://api.massive.com`)
- `LIVE_POLL_MS` — override the live poll interval (minimum 1000). Defaults to 15s
  during extended trading hours and 120s outside them.
- `MASSIVE_DEBUG=true` to enable backend debug logs (off by default)

## Backend commands

- `get_provider_status`
- `fetch_aggregates`
- `fetch_snapshots`
- `fetch_sparklines`
- `fetch_news`
- `fetch_symbol_detail`
- `search_symbols`
- `start_live_stream` / `stop_live_stream`

The live stream emits a `live-bars` event carrying the freshly polled candle tail.

## Run

```bash
npm install
npm run tauri dev
```

Quick setup:

```bash
cp .env.example .env
npm run tauri dev
```

## Notes

- Yahoo endpoints are unofficial and can change without notice.
- Yahoo's `/v7/finance/quote` endpoint requires a session cookie plus a "crumb"
  token; the backend acquires and caches both automatically and falls back to
  per-symbol chart metadata if the quote endpoint is unavailable.
- Yahoo rate-limits aggressively per IP (multi-hour bans have been observed) and
  since early 2025 also blocks some non-browser TLS fingerprints outright. If the
  app sits in a 429 cooldown loop for a long time, the IP is likely temporarily
  banned — lower the request rate or wait it out. A browser-impersonating HTTP
  stack (e.g. the `rquest` crate) or a first-party data API is the durable fix.
- Intraday data quality/latency may vary by symbol and session.
- Chart scrolling follows real time only while the newest candle is already on
  screen — that is lightweight-charts' `shiftVisibleRangeOnNewBar`, deliberately
  left to the library. Scroll back into history and the view stays put.

## Build checks

```bash
npm run build
npm test
cd src-tauri && cargo check && cargo test
```
