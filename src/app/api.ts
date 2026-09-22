import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AggregateBar,
  LiveBarsEvent,
  NewsItem,
  ProviderStatus,
  SearchResult,
  SnapshotItem,
  SparklineItem,
  SymbolDetail,
} from "./types";

export function fetchAggregates(params: {
  ticker: string;
  multiplier: number;
  timespan: "minute" | "hour" | "day";
  from: string;
  to: string;
}): Promise<AggregateBar[]> {
  return invoke<AggregateBar[]>("fetch_aggregates", { ...params });
}

export function fetchSnapshots(tickers: string[]): Promise<SnapshotItem[]> {
  return invoke<SnapshotItem[]>("fetch_snapshots", { tickers });
}

export function fetchSparklines(tickers: string[]): Promise<SparklineItem[]> {
  return invoke<SparklineItem[]>("fetch_sparklines", { tickers });
}

export function fetchNews(ticker: string, limit: number): Promise<NewsItem[]> {
  return invoke<NewsItem[]>("fetch_news", { ticker, limit });
}

export function fetchSymbolDetail(ticker: string): Promise<SymbolDetail> {
  return invoke<SymbolDetail>("fetch_symbol_detail", { ticker });
}

export function searchSymbols(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_symbols", { query });
}

export function getProviderStatus(): Promise<ProviderStatus> {
  return invoke<ProviderStatus>("get_provider_status");
}

export function startLiveStream(params: {
  ticker: string;
  multiplier: number;
  timespan: "minute" | "hour" | "day";
}): Promise<void> {
  return invoke("start_live_stream", { ...params });
}

export function stopLiveStream(): Promise<void> {
  return invoke("stop_live_stream");
}

export function listenLiveBars(handler: (event: LiveBarsEvent) => void): Promise<UnlistenFn> {
  return listen<LiveBarsEvent>("live-bars", (event) => handler(event.payload));
}

/** Mirrors the stored preference into the menu's automatic-check box. */
export function setAutoUpdateCheckMenuItem(enabled: boolean): Promise<void> {
  return invoke("set_auto_update_check", { enabled });
}

/** Fired when "Check for Updates…" is picked from the native menu. */
export function listenMenuCheckForUpdates(handler: () => void): Promise<UnlistenFn> {
  return listen("menu:check-for-updates", () => handler());
}

/** Fired with the new state whenever the menu's automatic-check box is toggled. */
export function listenMenuAutoUpdateCheck(handler: (enabled: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>("menu:auto-update-check", (event) => handler(event.payload));
}
