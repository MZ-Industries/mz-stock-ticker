# MZ Stock Ticker

Desktop stock dashboard built with Tauri + Rust + TypeScript, styled after Apple Stocks and powered by Yahoo Finance endpoints.

## Features

- Apple-style watchlist + detail layout
- Multiple chart modes (line, area, baseline, candlestick, bar)
- Dedicated volume chart below price chart
- Moving average overlays (20 / 50 / 200)
- Resizable panes (sidebar width, price/volume split, chart/news split)
- Add/remove/reorder symbols directly in the watchlist
- Yahoo-backed data calls from Rust commands (aggregates, quotes, sparklines, news)
- Live trailing candle via a backend poller that republishes Yahoo's 1-minute bars
- Optional volume backfill from a Massive/Polygon-compatible aggregates API
- Persisted dashboard preferences via Tauri Store (ticker/range/chart type/pane sizes/visible range)
- Persisted watchlist symbols via localStorage (restored on next launch)

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
- `MASSIVE_DEBUG=true` to enable backend debug logs

## Backend commands

- `get_provider_status`
- `fetch_aggregates`
- `fetch_snapshots`
- `fetch_sparklines`
- `fetch_news`
- `start_live_stream` / `stop_live_stream`

The live stream emits a `live-aggregate` event per updated candle.

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
- Intraday data quality/latency may vary by symbol and session.
- Chart scrolling follows real time only while the newest candle is already on
  screen — that is lightweight-charts' `shiftVisibleRangeOnNewBar`, deliberately
  left to the library. Scroll back into history and the view stays put.

## Build checks

```bash
npm run build
cd src-tauri && cargo check
```
