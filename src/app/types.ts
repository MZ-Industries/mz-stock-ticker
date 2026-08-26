export type ChartType = "line" | "area" | "baseline" | "candlestick" | "bar";

export type AggregateBar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

/** The tail of the chart's own series, re-read on every poll. */
export type LiveBarsEvent = {
  sym: string;
  bars: AggregateBar[];
};

export type SnapshotItem = {
  ticker: string;
  price: number;
  change_percent: number;
  previous_close?: number;
  quote_timestamp_ms?: number;
  pre_market_price?: number;
  pre_market_change_percent?: number;
  post_market_price?: number;
  post_market_change_percent?: number;
  name?: string;
};

export type SparklineItem = {
  ticker: string;
  prices: number[];
};

export type NewsItem = {
  id: string;
  title: string;
  source: string;
  author: string;
  published_utc: string;
  article_url: string;
  image_url: string;
  description: string;
};

/** Per-symbol stats for the detail header and stats strip. */
export type SymbolDetail = {
  ticker: string;
  name?: string;
  exchange?: string;
  currency?: string;
  market_state?: string;
  open?: number;
  day_high?: number;
  day_low?: number;
  previous_close?: number;
  volume?: number;
  average_volume_3m?: number;
  fifty_two_week_high?: number;
  fifty_two_week_low?: number;
  market_cap?: number;
  trailing_pe?: number;
  eps_ttm?: number;
  dividend_yield_percent?: number;
};

export type SearchResult = {
  symbol: string;
  name: string;
  exchange: string;
  quote_type: string;
};

export type ProviderStatus = {
  provider: string;
  streaming: boolean;
  poll_interval_ms: number;
};

export type RangePreset = {
  label: string;
  days: number;
  multiplier: number;
  timespan: "minute" | "hour" | "day";
};

export type CandleIntervalOption = {
  key: string;
  label: string;
  multiplier: number;
  timespan: "minute" | "hour";
};

export type AppPrefs = {
  ticker: string;
  rangeLabel: string;
  chartType: ChartType;
  candleIntervalKey?: string;
  movingAveragePeriods?: number[];
  watchlistSymbols?: string[];
  watchlistBadgeMode?: "percent" | "delta";
  visibleRangesByViewKey?: Record<string, { from: number; to: number }>;
  sidebarWidth: number;
  pricePaneHeight: number;
  chartAreaHeight: number;
};
