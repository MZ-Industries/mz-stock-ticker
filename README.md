# MZ Stock Ticker

Desktop stock dashboard built with Tauri + Rust + TypeScript, styled after Apple Stocks and powered by Yahoo Finance endpoints.

## Implemented in this first slice

- Apple-style watchlist + detail layout
- Multiple chart modes (line, area, baseline, candlestick, bar)
- Dedicated volume chart below price chart
- Resizable panes (sidebar width, price/volume split, chart/news split)
- Add/remove symbols directly in the watchlist
- Yahoo-backed data calls from Rust commands (aggregates, quotes, news)
- No paid websocket dependency (stream command is a no-op in Yahoo mode)
- Persisted dashboard preferences via Tauri Store (ticker/range/chart type/pane sizes)
- Persisted watchlist symbols via localStorage (restored on next launch)

## Prerequisites

- Node.js 20+
- Rust toolchain
- Tauri prerequisites for macOS
- No API key required for Yahoo mode

## Environment variables

The app auto-loads a root `.env` file on startup.

Optional:

- `YAHOO_BASE_URL` (default: `https://query1.finance.yahoo.com`)
- `YAHOO_NEWS_BASE_URL` (default: `https://query2.finance.yahoo.com`)
- `MASSIVE_DEBUG=true` to enable backend debug logs

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

## Build checks

```bash
npm run build
cd src-tauri && cargo check
```
