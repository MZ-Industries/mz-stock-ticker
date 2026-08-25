import { invoke } from "@tauri-apps/api/core";
import type { Store } from "@tauri-apps/plugin-store";
import type { IChartApi } from "lightweight-charts";
import {
  AUTO_REFRESH_PROGRESS_WINDOW_MS,
  BARS_REFRESH_BASELINE_MS,
  CANDLE_INTERVAL_OPTIONS,
  CHART_TYPES,
  DEFAULT_WATCHLIST,
  defaultPrefs,
  MAX_CHART_AREA_RATIO,
  MOVING_AVERAGE_PERIOD_OPTIONS,
  MAX_PRICE_PANE_RATIO,
  MAX_STORED_VISIBLE_RANGES,
  MIN_CHART_AREA_RATIO,
  MIN_PRICE_PANE_RATIO,
  RANGES,
  RIGHT_SCALE_WIDTH_PX,
  USE_NATIVE_WINDOW_STATE,
  WATCHLIST_STORAGE_KEY,
  WINDOW_LAYOUT_PERIODIC_SAVE_MS,
  WINDOW_LAYOUT_SAVE_DEBOUNCE_MS,
  WINDOW_LAYOUT_STORAGE_KEY,
} from "./app/constants";
import { getAppElements } from "./app/elements";
import { APP_TEMPLATE } from "./app/template";
import {
  applyLiveBarsAction,
  attachLiveBarsListenerAction,
  fetchBarsAction,
  loadBarsAction,
  loadNewsAction,
  loadSparklinesAction,
  loadWatchlistAction,
  refreshAllAction,
  selectTickerAndRefreshAction,
  startStreamAction,
} from "./app/actions";
import { createChartController } from "./app/charts";
import { reorderWatchlistSymbolsAction, setupSplitters as setupSplittersLayout } from "./app/layout";
import {
  bootstrapApp,
  registerBeforeUnloadHandler,
  registerGlobalEventHandlers,
  registerWatchlistEventHandlers,
} from "./app/lifecycle";
import {
  clearSessionShading,
  effectiveAggregationPreset as getEffectiveAggregationPreset,
  getBarDateRange as getMarketBarDateRange,
  getExtendedStripFromBars as getMarketExtendedStripFromBars,
  isCandleIntervalRelevant as isMarketCandleIntervalRelevant,
  renderSessionShading as renderMarketSessionShading,
  selectOneDaySession as selectMarketOneDaySession,
} from "./app/market";
import {
  barsRefreshCadenceMsView,
  renderProviderStatusView,
  scheduleAdaptiveBarsRefreshView,
  updateLagPillView,
} from "./app/provider";
import {
  clamp,
  getNyParts,
  normalizeTicker,
  normalizeVisibleRangesByViewKey,
  parseRetryAfterSeconds,
} from "./app/utils";
import { renderControlsView, updateHeadlineView } from "./app/ui";
import {
  captureWindowLayoutAction,
  ensureSelectedTickerAction,
  hydrateVisibleRangeStateAction,
  initStoreAction,
  initWindowLayoutPersistenceAction,
  persistPrefsAction,
  persistVisibleRangeForCurrentViewAction,
  persistWatchlistSymbolsAction,
  restoreWindowLayoutAction,
  schedulePersistVisibleRangeForCurrentViewAction,
  scheduleWindowLayoutSaveAction,
  upsertVisibleRangeForViewKeyAction,
} from "./app/state";
import type {
  AggregateBar,
  AppPrefs,
  ChartType,
  LiveBarsEvent,
  ProviderStatus,
  RangePreset,
  SnapshotItem,
} from "./app/types";

let selectedTicker = "AAPL";
let selectedRange = RANGES[2];
let selectedChartType: ChartType = "candlestick";
let selectedCandleIntervalKey = "5m";
let selectedMovingAveragePeriods = [...(defaultPrefs.movingAveragePeriods ?? [])];
let watchlistSymbols = [...DEFAULT_WATCHLIST];
let latestBars: AggregateBar[] = [];
let activeSessionDate: string | null = null;
let prefsStore: Store | null = null;
let unlistenLiveBars: (() => void) | null = null;
let apiCooldownUntilMs = 0;
let latestSnapshotsByTicker = new Map<string, SnapshotItem>();
let latestSparklinesByTicker = new Map<string, number[]>();
let suppressWatchlistClick = false;
let refreshInFlightCount = 0;
let refreshProgressRaf: number | null = null;
let lastRefreshFinishedAtMs = Date.now();
let windowLayoutSaveTimer: number | null = null;
let windowLayoutPeriodicTimer: number | null = null;
let unlistenWindowMoved: (() => void) | null = null;
let unlistenWindowResized: (() => void) | null = null;
let unlistenDomResize: (() => void) | null = null;
let persistedVisibleRange: { from: number; to: number } | null = null;
let visibleRangeSaveTimer: number | null = null;
let providerStatus: ProviderStatus | null = null;
let barsRefreshTimer: number | null = null;

let prefs: AppPrefs = { ...defaultPrefs };

const root = document.querySelector("#app") as HTMLDivElement;
root.innerHTML = APP_TEMPLATE;

const {
  watchlistEl,
  watchlistListEl,
  watchlistAddFormEl,
  watchlistAddInputEl,
  rangeGroupEl,
  intervalGroupEl,
  typeGroupEl,
  maGroupEl,
  headlinePriceEl,
  headlineChangeEl,
  titleTickerEl,
  extendedStripEl,
  refreshProgressEl,
  refreshProgressFillEl,
  providerPillEl,
  streamPillEl,
  lagPillEl,
} = getAppElements(root);

function debugLog(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.debug(`[ticker-debug] ${message}`, data);
  } else {
    console.debug(`[ticker-debug] ${message}`);
  }
}

function enterApiCooldown(error: unknown): void {
  const retryAfter = parseRetryAfterSeconds(error) ?? 90;
  const until = Date.now() + retryAfter * 1000;
  apiCooldownUntilMs = Math.max(apiCooldownUntilMs, until);
  debugLog("api:cooldown-enter", {
    retryAfterSeconds: retryAfter,
    untilIso: new Date(apiCooldownUntilMs).toISOString(),
    reason: String(error),
  });
}

function isApiCooldownActive(): boolean {
  return Date.now() < apiCooldownUntilMs;
}

function currentChartViewKey(): string {
  return `${selectedTicker}:${selectedRange.label}`;
}

function setRefreshProgress(value: number): void {
  const normalized = clamp(0, 1, value);
  refreshProgressFillEl.style.transform = `scaleX(${normalized})`;
}

function renderRefreshProgress(): void {
  const now = Date.now();

  if (refreshInFlightCount > 0) {
    refreshProgressEl.classList.add("loading");
    const pulse = 0.9 + ((Math.sin(now / 130) + 1) / 2) * 0.1;
    setRefreshProgress(pulse);
  } else {
    refreshProgressEl.classList.remove("loading");
    const elapsed = now - lastRefreshFinishedAtMs;
    const progress = elapsed / AUTO_REFRESH_PROGRESS_WINDOW_MS;
    setRefreshProgress(progress);
  }

  refreshProgressRaf = window.requestAnimationFrame(renderRefreshProgress);
}

async function loadProviderStatus(): Promise<void> {
  try {
    providerStatus = await invoke<ProviderStatus>("get_provider_status");
    debugLog("provider:status", providerStatus);
    renderProviderStatusView({ providerStatus, providerPillEl, streamPillEl });
    scheduleAdaptiveBarsRefresh();
  } catch (error) {
    debugLog("provider:status-failed", String(error));
  }
}

function updateLagPill(referenceMs?: number): void {
  updateLagPillView({ referenceMs, lagPillEl });
}

function clearAdaptiveBarsRefresh(): void {
  if (barsRefreshTimer !== null) {
    window.clearTimeout(barsRefreshTimer);
    barsRefreshTimer = null;
  }
}

function scheduleAdaptiveBarsRefresh(): void {
  scheduleAdaptiveBarsRefreshView({
    getBarsRefreshTimer: () => barsRefreshTimer,
    setBarsRefreshTimer: (value) => {
      barsRefreshTimer = value;
    },
    barsRefreshCadenceMs: () => barsRefreshCadenceMsView({
      baselineMs: BARS_REFRESH_BASELINE_MS,
      isDocumentHidden: document.hidden,
    }),
    isApiCooldownActive,
    loadBars,
    loadWatchlist,
  });
}


function startRefreshProgressLoop(): void {
  if (refreshProgressRaf !== null) {
    window.cancelAnimationFrame(refreshProgressRaf);
  }
  refreshProgressRaf = window.requestAnimationFrame(renderRefreshProgress);
}

function trackRefreshScope(): (success: boolean) => void {
  refreshInFlightCount += 1;

  return (success: boolean) => {
    refreshInFlightCount = Math.max(0, refreshInFlightCount - 1);
    if (success) {
      lastRefreshFinishedAtMs = Date.now();
      setRefreshProgress(0);
    }
  };
}

function hydrateVisibleRangeStateForCurrentView(): void {
  const hydrated = hydrateVisibleRangeStateAction({
    prefs,
    currentChartViewKey: currentChartViewKey(),
  });
  persistedVisibleRange = hydrated.persistedVisibleRange;
}

function upsertVisibleRangeForViewKey(viewKey: string, range: { from: number; to: number }): void {
  upsertVisibleRangeForViewKeyAction({
    prefs,
    maxStoredVisibleRanges: MAX_STORED_VISIBLE_RANGES,
    viewKey,
    range,
  });
}

function persistVisibleRangeForCurrentView(range: { from: number; to: number } | null): void {
  const persisted = persistVisibleRangeForCurrentViewAction({
    range,
    currentChartViewKey: currentChartViewKey(),
    upsertVisibleRangeForViewKey,
    persistPrefs,
  });
  if (persisted.persistedVisibleRange) {
    persistedVisibleRange = persisted.persistedVisibleRange;
  }
}

function schedulePersistVisibleRangeForCurrentView(range: { from: number; to: number } | null): void {
  schedulePersistVisibleRangeForCurrentViewAction({
    range,
    visibleRangeSaveTimer,
    setVisibleRangeSaveTimer: (value) => {
      visibleRangeSaveTimer = value;
    },
    persistVisibleRangeForCurrentView,
  });
}

function persistWatchlistSymbols(): void {
  persistWatchlistSymbolsAction({
    watchlistStorageKey: WATCHLIST_STORAGE_KEY,
    watchlistSymbols,
    prefs,
    persistPrefs,
  });
}

function ensureSelectedTicker(): void {
  const ensured = ensureSelectedTickerAction({
    watchlistSymbols,
    selectedTicker,
    defaultWatchlist: DEFAULT_WATCHLIST,
  });
  watchlistSymbols = ensured.watchlistSymbols;
  selectedTicker = ensured.selectedTicker;
}

async function initStore(): Promise<void> {
  const storeState = await initStoreAction({
    defaultPrefs,
    defaultWatchlist: DEFAULT_WATCHLIST,
    watchlistStorageKey: WATCHLIST_STORAGE_KEY,
    windowLayoutStorageKey: WINDOW_LAYOUT_STORAGE_KEY,
    ranges: RANGES,
    chartTypes: CHART_TYPES,
    movingAveragePeriodOptions: MOVING_AVERAGE_PERIOD_OPTIONS,
    defaultMovingAveragePeriods: defaultPrefs.movingAveragePeriods ?? [],
    candleIntervalOptions: CANDLE_INTERVAL_OPTIONS,
    minPricePaneRatio: MIN_PRICE_PANE_RATIO,
    maxPricePaneRatio: MAX_PRICE_PANE_RATIO,
    minChartAreaRatio: MIN_CHART_AREA_RATIO,
    maxChartAreaRatio: MAX_CHART_AREA_RATIO,
  });

  prefsStore = storeState.prefsStore;
  prefs = storeState.prefs;
  watchlistSymbols = storeState.watchlistSymbols;
  selectedTicker = storeState.selectedTicker;
  selectedRange = storeState.selectedRange;
  selectedChartType = storeState.selectedChartType;
  selectedMovingAveragePeriods = storeState.selectedMovingAveragePeriods;
  selectedCandleIntervalKey = storeState.selectedCandleIntervalKey;

  hydrateVisibleRangeStateForCurrentView();
  persistPrefs();
}

function persistPrefs(): void {
  persistPrefsAction(prefsStore, prefs);
}

async function captureWindowLayout(): Promise<void> {
  await captureWindowLayoutAction({
    useNativeWindowState: USE_NATIVE_WINDOW_STATE,
    prefs,
    persistPrefs,
    debugLog,
  });
}

function scheduleWindowLayoutSave(): void {
  scheduleWindowLayoutSaveAction({
    useNativeWindowState: USE_NATIVE_WINDOW_STATE,
    windowLayoutSaveDebounceMs: WINDOW_LAYOUT_SAVE_DEBOUNCE_MS,
    windowLayoutSaveTimer,
    setWindowLayoutSaveTimer: (value) => {
      windowLayoutSaveTimer = value;
    },
    captureWindowLayout,
  });
}

async function restoreWindowLayout(): Promise<void> {
  await restoreWindowLayoutAction({
    useNativeWindowState: USE_NATIVE_WINDOW_STATE,
    layout: prefs.windowLayout,
    debugLog,
  });
}

async function initWindowLayoutPersistence(): Promise<void> {
  await initWindowLayoutPersistenceAction({
    useNativeWindowState: USE_NATIVE_WINDOW_STATE,
    windowLayoutPeriodicSaveMs: WINDOW_LAYOUT_PERIODIC_SAVE_MS,
    scheduleWindowLayoutSave,
    setUnlistenWindowMoved: (value) => {
      unlistenWindowMoved = value;
    },
    setUnlistenWindowResized: (value) => {
      unlistenWindowResized = value;
    },
    setUnlistenDomResize: (value) => {
      unlistenDomResize = value;
    },
    setWindowLayoutPeriodicTimer: (value) => {
      windowLayoutPeriodicTimer = value;
    },
  });
}

function isCandleIntervalRelevant(): boolean {
  return isMarketCandleIntervalRelevant(selectedChartType, selectedRange);
}

function effectiveAggregationPreset(): { multiplier: number; timespan: "minute" | "hour" | "day" } {
  return getEffectiveAggregationPreset(
    selectedChartType,
    selectedRange,
    selectedCandleIntervalKey,
    CANDLE_INTERVAL_OPTIONS,
  );
}

function getExtendedStripFromBars(): { closePrice: number; closeChangePct: number; afterPrice: number; afterChangePct: number; isPreMarket: boolean } | null {
  return getMarketExtendedStripFromBars({
    selectedRange,
    latestBars,
    activeSessionDate,
    selectedTicker,
    latestSnapshotsByTicker,
  });
}

function selectOneDaySession(bars: AggregateBar[]): { bars: AggregateBar[]; sessionDate: string | null } {
  return selectMarketOneDaySession(bars);
}

function getBarDateRange(): { from: string; to: string } {
  return getMarketBarDateRange(selectedRange);
}

function renderSessionShading(chart: IChartApi, container: HTMLDivElement): void {
  renderMarketSessionShading({
    chart,
    container,
    selectedRange,
    latestBars,
  });
}

async function fetchBars(
  from: string,
  to: string,
  multiplier: number = effectiveAggregationPreset().multiplier,
  timespan: RangePreset["timespan"] = effectiveAggregationPreset().timespan,
): Promise<AggregateBar[]> {
  return fetchBarsAction({
    selectedTicker,
    from,
    to,
    multiplier,
    timespan,
  });
}

async function loadWatchlist(): Promise<void> {
  await loadWatchlistAction({
    isApiCooldownActive,
    debugLog,
    watchlistSymbols,
    selectedTicker,
    latestSparklinesByTicker,
    trackRefreshScope,
    enterApiCooldown,
    updateLagPill,
    setLatestSnapshotsByTicker: (map) => {
      latestSnapshotsByTicker = map;
    },
    updateHeadline,
    watchlistListEl,
  });
}

async function loadBars(): Promise<void> {
  await loadBarsAction({
    isApiCooldownActive,
    debugLog,
    selectedTicker,
    selectedRange,
    effectiveAggregationPreset,
    getBarDateRange,
    fetchBars,
    trackRefreshScope,
    enterApiCooldown,
    selectOneDaySession,
    setActiveSessionDate: (value) => {
      activeSessionDate = value;
    },
    setLatestBars: (bars) => {
      latestBars = bars;
    },
    updateLagPill,
    renderCharts,
    updateHeadline,
  });
}

async function loadNews(): Promise<void> {
  await loadNewsAction({
    selectedTicker,
    isApiCooldownActive,
    debugLog,
    trackRefreshScope,
    enterApiCooldown,
  });
}

const chartController = createChartController({
  priceContainer: document.querySelector("#price-chart") as HTMLDivElement,
  volumeContainer: document.querySelector("#volume-chart") as HTMLDivElement,
  rightScaleWidthPx: RIGHT_SCALE_WIDTH_PX,
  renderSessionShading,
  clearSessionShading,
  getStoredVisibleRange: (viewKey) =>
    normalizeVisibleRangesByViewKey(prefs.visibleRangesByViewKey)[viewKey] ?? null,
  onVisibleRangeChange: (viewKey, range) => {
    if (viewKey !== currentChartViewKey()) {
      return;
    }
    persistedVisibleRange = range;
    schedulePersistVisibleRangeForCurrentView(range);
  },
});

/**
 * Anything that changes *which* bars are on screen forces the saved view to be
 * re-applied. Chart type and moving averages are not in here: they restyle the
 * same bars, so the user's zoom and scroll position should survive them.
 */
function currentChartResetKey(): string {
  const effective = effectiveAggregationPreset();
  return `${currentChartViewKey()}:${effective.multiplier}${effective.timespan}`;
}

function renderCharts(): void {
  chartController.render({
    bars: latestBars,
    chartType: selectedChartType,
    timespan: effectiveAggregationPreset().timespan,
    movingAveragePeriods: selectedMovingAveragePeriods,
    viewKey: currentChartViewKey(),
    resetKey: currentChartResetKey(),
  });
}

function updateHeadline(): void {
  updateHeadlineView({
    selectedTicker,
    latestSnapshotsByTicker,
    latestBars,
    getExtendedStripFromBars,
    titleTickerEl,
    headlinePriceEl,
    headlineChangeEl,
    extendedStripEl,
  });
}

function renderControls(): void {
  renderControlsView({
    ranges: RANGES,
    selectedRange,
    rangeGroupEl,
    isCandleIntervalRelevant,
    intervalGroupEl,
    candleIntervalOptions: CANDLE_INTERVAL_OPTIONS,
    selectedCandleIntervalKey,
    movingAveragePeriodOptions: MOVING_AVERAGE_PERIOD_OPTIONS,
    selectedMovingAveragePeriods,
    maGroupEl,
    chartTypes: CHART_TYPES,
    selectedChartType,
    typeGroupEl,
  });
}

function applyLiveBars(event: LiveBarsEvent): void {
  applyLiveBarsAction({
    event,
    selectedTicker,
    selectedRangeLabel: selectedRange.label,
    activeSessionDate,
    getSessionDate: (timestampMs: number) => getNyParts(timestampMs).date,
    latestBars,
    latestSnapshotsByTicker,
    latestSparklinesByTicker,
    watchlistListEl,
    debugLog,
    updateLagPill,
    updateHeadline,
    pushBars: (bars) => chartController.applyLiveBars(bars),
  });
}

async function startStream(): Promise<void> {
  await startStreamAction({
    isApiCooldownActive,
    debugLog,
    selectedTicker,
    effectiveAggregationPreset,
    loadProviderStatus,
  });
}

async function attachLiveBarsListener(): Promise<void> {
  await attachLiveBarsListenerAction({
    unlistenLiveBars,
    setUnlistenLiveBars: (value) => {
      unlistenLiveBars = value;
    },
    applyLiveBars,
  });
}

function setupSplitters(): void {
  setupSplittersLayout({
    prefs,
    persistPrefs,
    minPricePaneRatio: MIN_PRICE_PANE_RATIO,
    maxPricePaneRatio: MAX_PRICE_PANE_RATIO,
    minChartAreaRatio: MIN_CHART_AREA_RATIO,
    maxChartAreaRatio: MAX_CHART_AREA_RATIO,
  });
}

function reorderWatchlistSymbols(
  draggedTicker: string,
  targetTicker: string,
  placeAfter: boolean,
): boolean {
  const next = reorderWatchlistSymbolsAction(watchlistSymbols, draggedTicker, targetTicker, placeAfter);
  if (!next) {
    return false;
  }

  watchlistSymbols = next;
  persistWatchlistSymbols();
  return true;
}

async function loadSparklines(): Promise<void> {
  await loadSparklinesAction({
    isApiCooldownActive,
    watchlistSymbols,
    latestSparklinesByTicker,
    latestSnapshotsByTicker,
    watchlistListEl,
    debugLog,
  });
}

async function refreshAll(): Promise<void> {
  await refreshAllAction({
    isApiCooldownActive,
    debugLog,
    loadWatchlist,
    loadBars,
    loadNews,
    loadSparklines,
    startStream,
  });
}

async function selectTickerAndRefresh(ticker: string): Promise<void> {
  await selectTickerAndRefreshAction({
    ticker,
    setSelectedTicker: (value) => {
      selectedTicker = value;
    },
    setPrefsTicker: (value) => {
      prefs.ticker = value;
    },
    persistPrefs,
    refreshAll,
  });
}

registerWatchlistEventHandlers({
  watchlistEl,
  watchlistAddFormEl,
  watchlistAddInputEl,
  isSuppressWatchlistClick: () => suppressWatchlistClick,
  setSuppressWatchlistClick: (value) => {
    suppressWatchlistClick = value;
  },
  getWatchlistSymbols: () => watchlistSymbols,
  setWatchlistSymbols: (symbols) => {
    watchlistSymbols = symbols;
  },
  persistWatchlistSymbols,
  getSelectedTicker: () => selectedTicker,
  ensureSelectedTicker,
  getPrefs: () => prefs,
  persistPrefs,
  refreshAll,
  loadWatchlist,
  selectTickerAndRefresh,
  normalizeTicker,
});

registerGlobalEventHandlers({
  rangeGroupEl,
  intervalGroupEl,
  maGroupEl,
  typeGroupEl,
  ranges: RANGES,
  candleIntervalOptions: CANDLE_INTERVAL_OPTIONS,
  movingAveragePeriodOptions: MOVING_AVERAGE_PERIOD_OPTIONS,
  scheduleAdaptiveBarsRefresh,
  isApiCooldownActive,
  loadWatchlist,
  loadBars,
  startStream,
  renderControls,
  renderCharts,
  persistPrefs,
  getPrefs: () => prefs,
  setSelectedRange: (range) => {
    selectedRange = range;
  },
  setSelectedCandleIntervalKey: (key) => {
    selectedCandleIntervalKey = key;
  },
  getSelectedChartType: () => selectedChartType,
  setSelectedChartType: (type) => {
    selectedChartType = type;
  },
  getSelectedMovingAveragePeriods: () => selectedMovingAveragePeriods,
  setSelectedMovingAveragePeriods: (periods) => {
    selectedMovingAveragePeriods = [...periods];
  },
  isCandleIntervalRelevant,
});

async function bootstrap(): Promise<void> {
  await bootstrapApp({
    startRefreshProgressLoop,
    loadProviderStatus,
    initStore,
    ensureSelectedTicker,
    watchlistListEl,
    getWatchlistSymbols: () => watchlistSymbols,
    getSelectedTicker: () => selectedTicker,
    getLatestSparklinesByTicker: () => latestSparklinesByTicker,
    getLatestSnapshotsByTicker: () => latestSnapshotsByTicker,
    restoreWindowLayout,
    initWindowLayoutPersistence,
    debugLog,
    renderControls,
    setupSplitters,
    onReorderWatchlist: reorderWatchlistSymbols,
    onSelectTicker: selectTickerAndRefresh,
    setSuppressWatchlistClick: (value) => {
      suppressWatchlistClick = value;
    },
    attachLiveBarsListener,
    refreshAll,
    isApiCooldownActive,
    loadWatchlist,
    loadSparklines,
    loadNews,
    scheduleAdaptiveBarsRefresh,
  });
}

registerBeforeUnloadHandler({
  getVisibleRangeSaveTimer: () => visibleRangeSaveTimer,
  setVisibleRangeSaveTimer: (value) => {
    visibleRangeSaveTimer = value;
  },
  clearAdaptiveBarsRefresh,
  disposeCharts: () => chartController.dispose(),
  getWindowLayoutSaveTimer: () => windowLayoutSaveTimer,
  setWindowLayoutSaveTimer: (value) => {
    windowLayoutSaveTimer = value;
  },
  getWindowLayoutPeriodicTimer: () => windowLayoutPeriodicTimer,
  setWindowLayoutPeriodicTimer: (value) => {
    windowLayoutPeriodicTimer = value;
  },
  captureWindowLayout,
  getUnlistenWindowMoved: () => unlistenWindowMoved,
  setUnlistenWindowMoved: (value) => {
    unlistenWindowMoved = value;
  },
  getUnlistenWindowResized: () => unlistenWindowResized,
  setUnlistenWindowResized: (value) => {
    unlistenWindowResized = value;
  },
  getUnlistenDomResize: () => unlistenDomResize,
  setUnlistenDomResize: (value) => {
    unlistenDomResize = value;
  },
  getRefreshProgressRaf: () => refreshProgressRaf,
  setRefreshProgressRaf: (value) => {
    refreshProgressRaf = value;
  },
  getUnlistenLiveBars: () => unlistenLiveBars,
  setUnlistenLiveBars: (value) => {
    unlistenLiveBars = value;
  },
  persistVisibleRangeForCurrentView,
  getCurrentVisibleRange: () => chartController.getVisibleLogicalRange() ?? persistedVisibleRange,
});

void bootstrap();
