import { Store } from "@tauri-apps/plugin-store";
import {
  CANDLE_INTERVAL_OPTIONS,
  CHART_TYPES,
  DEFAULT_WATCHLIST,
  defaultPrefs,
  MAX_STORED_VISIBLE_RANGES,
  MOVING_AVERAGE_PERIOD_OPTIONS,
  RANGES,
  WATCHLIST_STORAGE_KEY,
} from "./constants";
import { currentChartViewKey, persistPrefs, state } from "./store";
import {
  normalizeMovingAveragePeriods,
  normalizeVisibleRangesByViewKey,
  normalizeWatchlistSymbols,
  parseStoredJson,
} from "./utils";
import type { AppPrefs } from "./types";

type VisibleRange = { from: number; to: number };

// Window position/size used to be persisted by hand under this key; the
// tauri-plugin-window-state plugin owns that now.
const LEGACY_WINDOW_LAYOUT_KEY = "windowLayoutV1";

let lastKnownVisibleRange: VisibleRange | null = null;
let visibleRangeSaveTimer: number | null = null;

export async function initPrefs(): Promise<void> {
  const prefsStore = await Store.load("ui-preferences.json");
  const stored = await prefsStore.get<AppPrefs>("dashboard");
  const prefs: AppPrefs = { ...defaultPrefs, ...(stored ?? {}) };

  const storeWatchlist = normalizeWatchlistSymbols(prefs.watchlistSymbols);
  const localWatchlist = normalizeWatchlistSymbols(parseStoredJson(WATCHLIST_STORAGE_KEY));
  const watchlistSymbols = storeWatchlist.length > 0
    ? storeWatchlist
    : localWatchlist.length > 0
      ? localWatchlist
      : [...DEFAULT_WATCHLIST];

  prefs.watchlistSymbols = [...watchlistSymbols];
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlistSymbols));
  localStorage.removeItem(LEGACY_WINDOW_LAYOUT_KEY);

  state.prefsStore = prefsStore;
  state.prefs = prefs;
  state.watchlistSymbols = watchlistSymbols;
  state.selectedTicker = watchlistSymbols.includes(prefs.ticker) ? prefs.ticker : watchlistSymbols[0];
  state.selectedRange = RANGES.find((item) => item.label === prefs.rangeLabel) ?? RANGES[2];
  state.selectedChartType = CHART_TYPES.includes(prefs.chartType) ? prefs.chartType : "candlestick";
  state.selectedMovingAveragePeriods = normalizeMovingAveragePeriods(
    prefs.movingAveragePeriods,
    MOVING_AVERAGE_PERIOD_OPTIONS,
    defaultPrefs.movingAveragePeriods ?? [],
  );
  prefs.movingAveragePeriods = [...state.selectedMovingAveragePeriods];
  state.selectedCandleIntervalKey =
    prefs.candleIntervalKey && CANDLE_INTERVAL_OPTIONS.some((item) => item.key === prefs.candleIntervalKey)
      ? prefs.candleIntervalKey
      : "5m";

  hydrateVisibleRangeState();
  persistPrefs();
}

export function ensureSelectedTicker(): void {
  if (state.watchlistSymbols.length === 0) {
    state.watchlistSymbols = [...DEFAULT_WATCHLIST];
  }

  if (!state.watchlistSymbols.includes(state.selectedTicker)) {
    state.selectedTicker = state.watchlistSymbols[0];
  }
}

export function persistWatchlistSymbols(): void {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(state.watchlistSymbols));
  state.prefs.watchlistSymbols = [...state.watchlistSymbols];
  persistPrefs();
}

export function hydrateVisibleRangeState(): void {
  const rangesByViewKey = normalizeVisibleRangesByViewKey(state.prefs.visibleRangesByViewKey);
  state.prefs.visibleRangesByViewKey = rangesByViewKey;
  lastKnownVisibleRange = rangesByViewKey[currentChartViewKey()] ?? null;
}

export function getStoredVisibleRange(viewKey: string): VisibleRange | null {
  return normalizeVisibleRangesByViewKey(state.prefs.visibleRangesByViewKey)[viewKey] ?? null;
}

function upsertVisibleRangeForViewKey(viewKey: string, range: VisibleRange): void {
  const existing = normalizeVisibleRangesByViewKey(state.prefs.visibleRangesByViewKey);
  const next = {
    ...existing,
    [viewKey]: range,
  };

  const keys = Object.keys(next);
  if (keys.length > MAX_STORED_VISIBLE_RANGES) {
    delete next[keys[0]];
  }

  state.prefs.visibleRangesByViewKey = next;
}

function persistVisibleRangeForCurrentView(range: VisibleRange | null): void {
  if (!range) {
    return;
  }

  lastKnownVisibleRange = { from: range.from, to: range.to };
  upsertVisibleRangeForViewKey(currentChartViewKey(), lastKnownVisibleRange);
  persistPrefs();
}

/** Called on every chart pan/zoom; debounces the actual write. */
export function onVisibleRangeChange(viewKey: string, range: VisibleRange): void {
  if (viewKey !== currentChartViewKey()) {
    return;
  }

  lastKnownVisibleRange = { from: range.from, to: range.to };

  if (visibleRangeSaveTimer !== null) {
    window.clearTimeout(visibleRangeSaveTimer);
  }

  visibleRangeSaveTimer = window.setTimeout(() => {
    visibleRangeSaveTimer = null;
    persistVisibleRangeForCurrentView(lastKnownVisibleRange);
  }, 250);
}

/** Persist whatever the chart is showing right now (used on shutdown). */
export function flushVisibleRange(currentRange: VisibleRange | null): void {
  if (visibleRangeSaveTimer !== null) {
    window.clearTimeout(visibleRangeSaveTimer);
    visibleRangeSaveTimer = null;
  }

  persistVisibleRangeForCurrentView(currentRange ?? lastKnownVisibleRange);
}
