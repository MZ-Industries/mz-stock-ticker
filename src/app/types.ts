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
  visibleRangesByViewKey?: Record<string, { from: number; to: number }>;
  sidebarWidth: number;
  pricePaneHeight: number;
  chartAreaHeight: number;
  windowLayout?: {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  };
};
