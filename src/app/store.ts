import type { Store } from "@tauri-apps/plugin-store";
import { CANDLE_INTERVAL_OPTIONS, DEFAULT_WATCHLIST, defaultPrefs, RANGES } from "./constants";
import { effectiveAggregationPreset } from "./market";
import { parseRetryAfterSeconds } from "./utils";
import type {
  AggregateBar,
  AppPrefs,
  ChartType,
  ProviderStatus,
  RangePreset,
  SnapshotItem,
  SymbolDetail,
} from "./types";

/**
 * Central mutable application state. Modules read and write it directly instead
 * of threading getter/setter pairs through every call.
 */
export const state = {
  selectedTicker: "AAPL",
  selectedRange: RANGES[2] as RangePreset,
  selectedChartType: "candlestick" as ChartType,
  selectedCandleIntervalKey: "5m",
  selectedMovingAveragePeriods: [...(defaultPrefs.movingAveragePeriods ?? [])],
  watchlistSymbols: [...DEFAULT_WATCHLIST],
  latestBars: [] as AggregateBar[],
  activeSessionDate: null as string | null,
  prefs: { ...defaultPrefs } as AppPrefs,
  prefsStore: null as Store | null,
  apiCooldownUntilMs: 0,
  latestSnapshotsByTicker: new Map<string, SnapshotItem>(),
  latestSparklinesByTicker: new Map<string, number[]>(),
  latestSymbolDetail: null as SymbolDetail | null,
  providerStatus: null as ProviderStatus | null,
  suppressWatchlistClick: false,
  refreshInFlightCount: 0,
  lastRefreshFinishedAtMs: Date.now(),
};

export function debugLog(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.debug(`[ticker-debug] ${message}`, data);
  } else {
    console.debug(`[ticker-debug] ${message}`);
  }
}

export function enterApiCooldown(error: unknown): void {
  const retryAfter = parseRetryAfterSeconds(error) ?? 90;
  const until = Date.now() + retryAfter * 1000;
  state.apiCooldownUntilMs = Math.max(state.apiCooldownUntilMs, until);
  debugLog("api:cooldown-enter", {
    retryAfterSeconds: retryAfter,
    untilIso: new Date(state.apiCooldownUntilMs).toISOString(),
    reason: String(error),
  });
}

export function isApiCooldownActive(): boolean {
  return Date.now() < state.apiCooldownUntilMs;
}

/** Key the saved visible range is stored under (ticker + range preset). */
export function currentChartViewKey(): string {
  return `${state.selectedTicker}:${state.selectedRange.label}`;
}

export function currentAggregationPreset(): { multiplier: number; timespan: "minute" | "hour" | "day" } {
  return effectiveAggregationPreset(
    state.selectedChartType,
    state.selectedRange,
    state.selectedCandleIntervalKey,
    CANDLE_INTERVAL_OPTIONS,
  );
}

/**
 * Anything that changes *which* bars are on screen forces the saved view to be
 * re-applied. Chart type and moving averages are not in here: they restyle the
 * same bars, so the user's zoom and scroll position should survive them.
 */
export function currentChartResetKey(): string {
  const effective = currentAggregationPreset();
  return `${currentChartViewKey()}:${effective.multiplier}${effective.timespan}`;
}

export function persistPrefs(): void {
  const { prefsStore, prefs } = state;
  if (!prefsStore) {
    return;
  }

  void prefsStore.set("dashboard", prefs).then(() => prefsStore.save());
}
