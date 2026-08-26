import type { AppPrefs, CandleIntervalOption, ChartType, RangePreset } from "./types";

export const DEFAULT_WATCHLIST = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "TSLA",
  "GOOGL",
  "AMD",
  "SPY",
  "QQQ",
  "PLTR",
  "NFLX",
];

export const WATCHLIST_STORAGE_KEY = "watchlistSymbols";
export const MAX_STORED_VISIBLE_RANGES = 120;
export const MAX_WATCHLIST_SYMBOLS = 60;

export const RANGES: RangePreset[] = [
  { label: "1D", days: 1, multiplier: 1, timespan: "minute" },
  { label: "1W", days: 7, multiplier: 5, timespan: "minute" },
  { label: "1M", days: 30, multiplier: 30, timespan: "minute" },
  { label: "3M", days: 90, multiplier: 1, timespan: "hour" },
  { label: "6M", days: 180, multiplier: 4, timespan: "hour" },
  // Days for YTD are an upper bound; the actual window starts at Jan 1 (see getBarDateRange).
  { label: "YTD", days: 365, multiplier: 1, timespan: "day" },
  { label: "1Y", days: 365, multiplier: 1, timespan: "day" },
  { label: "5Y", days: 1825, multiplier: 1, timespan: "day" },
  { label: "ALL", days: 7300, multiplier: 1, timespan: "day" },
];

export const CANDLE_INTERVAL_OPTIONS: CandleIntervalOption[] = [
  { key: "1m", label: "1m", multiplier: 1, timespan: "minute" },
  { key: "2m", label: "2m", multiplier: 2, timespan: "minute" },
  { key: "5m", label: "5m", multiplier: 5, timespan: "minute" },
  { key: "15m", label: "15m", multiplier: 15, timespan: "minute" },
  { key: "30m", label: "30m", multiplier: 30, timespan: "minute" },
  { key: "60m", label: "60m", multiplier: 60, timespan: "minute" },
  { key: "90m", label: "90m", multiplier: 90, timespan: "minute" },
];

export const CHART_TYPES: ChartType[] = ["line", "area", "baseline", "candlestick", "bar"];
export const MOVING_AVERAGE_PERIOD_OPTIONS = [20, 50, 200] as const;

export const RIGHT_SCALE_WIDTH_PX = 72;
export const AUTO_REFRESH_PROGRESS_WINDOW_MS = 60_000;
export const MIN_PRICE_PANE_RATIO = 0.4;
export const MAX_PRICE_PANE_RATIO = 0.9;
export const MIN_CHART_AREA_RATIO = 0.35;
export const MAX_CHART_AREA_RATIO = 0.85;
export const BARS_REFRESH_BASELINE_MS = 300_000;

export const WATCHLIST_REFRESH_MS = 60_000;
export const SPARKLINE_REFRESH_MS = 300_000;
// News rarely changes minute to minute, and every request counts against
// Yahoo's shared per-IP budget.
export const NEWS_REFRESH_MS = 300_000;
export const SEARCH_DEBOUNCE_MS = 250;

export const defaultPrefs: AppPrefs = {
  ticker: "AAPL",
  rangeLabel: "1M",
  chartType: "candlestick",
  candleIntervalKey: "5m",
  movingAveragePeriods: [200],
  sidebarWidth: 280,
  pricePaneHeight: 0,
  chartAreaHeight: 0,
};
