import { invoke } from "@tauri-apps/api/core";
import { renderWatchlistRows, setupWatchlistDragAndDrop } from "./watchlist";
import type { AppPrefs, ChartType, RangePreset, SnapshotItem } from "./types";

export function registerGlobalEventHandlers(params: {
  rangeGroupEl: HTMLDivElement;
  intervalGroupEl: HTMLDivElement;
  maGroupEl: HTMLDivElement;
  typeGroupEl: HTMLDivElement;
  ranges: RangePreset[];
  candleIntervalOptions: Array<{ key: string }>;
  movingAveragePeriodOptions: readonly number[];
  scheduleAdaptiveBarsRefresh: () => void;
  isApiCooldownActive: () => boolean;
  loadWatchlist: () => Promise<void>;
  loadBars: () => Promise<void>;
  startStream: () => Promise<void>;
  renderControls: () => void;
  renderCharts: () => void;
  persistPrefs: () => void;
  getPrefs: () => AppPrefs;
  setSelectedRange: (range: RangePreset) => void;
  setSelectedCandleIntervalKey: (key: string) => void;
  getSelectedChartType: () => ChartType;
  setSelectedChartType: (type: ChartType) => void;
  getSelectedMovingAveragePeriods: () => number[];
  setSelectedMovingAveragePeriods: (periods: number[]) => void;
  isCandleIntervalRelevant: () => boolean;
}): void {
  const {
    rangeGroupEl,
    intervalGroupEl,
    maGroupEl,
    typeGroupEl,
    ranges,
    candleIntervalOptions,
    movingAveragePeriodOptions,
    scheduleAdaptiveBarsRefresh,
    isApiCooldownActive,
    loadWatchlist,
    loadBars,
    startStream,
    renderControls,
    renderCharts,
    persistPrefs,
    getPrefs,
    setSelectedRange,
    setSelectedCandleIntervalKey,
    getSelectedChartType,
    setSelectedChartType,
    getSelectedMovingAveragePeriods,
    setSelectedMovingAveragePeriods,
    isCandleIntervalRelevant,
  } = params;

  document.addEventListener("visibilitychange", () => {
    scheduleAdaptiveBarsRefresh();
    if (!document.hidden && !isApiCooldownActive()) {
      void loadWatchlist();
    }
  });

  window.addEventListener("focus", () => {
    if (!isApiCooldownActive()) {
      void loadWatchlist();
    }
  });

  rangeGroupEl.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest("[data-range]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const preset = ranges.find((range) => range.label === button.dataset.range);
    if (!preset) {
      return;
    }

    setSelectedRange(preset);
    const prefs = getPrefs();
    prefs.rangeLabel = preset.label;
    persistPrefs();
    renderControls();
    await loadBars();
    await startStream();
  });

  intervalGroupEl.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest("[data-candle-interval]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const nextKey = button.dataset.candleInterval;
    if (!nextKey || !candleIntervalOptions.some((item) => item.key === nextKey)) {
      return;
    }

    setSelectedCandleIntervalKey(nextKey);
    const prefs = getPrefs();
    prefs.candleIntervalKey = nextKey;
    persistPrefs();
    renderControls();
    await loadBars();
    await startStream();
  });

  maGroupEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("[data-ma-period]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const period = Number(button.dataset.maPeriod);
    if (!Number.isInteger(period) || !movingAveragePeriodOptions.includes(period)) {
      return;
    }

    const previous = getSelectedMovingAveragePeriods();
    const next = previous.includes(period)
      ? previous.filter((value) => value !== period)
      : [...previous, period].sort((a, b) => a - b);

    setSelectedMovingAveragePeriods(next);
    const prefs = getPrefs();
    prefs.movingAveragePeriods = [...next];
    persistPrefs();
    renderControls();
    renderCharts();
  });

  typeGroupEl.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest("[data-type]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const wasRelevant = isCandleIntervalRelevant();
    const nextType = (button.dataset.type as ChartType) ?? getSelectedChartType();
    setSelectedChartType(nextType);
    const prefs = getPrefs();
    prefs.chartType = nextType;
    persistPrefs();

    const isRelevant = isCandleIntervalRelevant();
    renderControls();

    if (!wasRelevant && isRelevant) {
      await loadBars();
      await startStream();
      return;
    }

    renderCharts();
  });
}

export function registerWatchlistEventHandlers(params: {
  watchlistEl: HTMLDivElement;
  watchlistAddFormEl: HTMLFormElement;
  watchlistAddInputEl: HTMLInputElement;
  isSuppressWatchlistClick: () => boolean;
  setSuppressWatchlistClick: (value: boolean) => void;
  getWatchlistSymbols: () => string[];
  setWatchlistSymbols: (symbols: string[]) => void;
  persistWatchlistSymbols: () => void;
  getSelectedTicker: () => string;
  ensureSelectedTicker: () => void;
  getPrefs: () => AppPrefs;
  persistPrefs: () => void;
  refreshAll: () => Promise<void>;
  loadWatchlist: () => Promise<void>;
  selectTickerAndRefresh: (ticker: string) => Promise<void>;
  normalizeTicker: (raw: string) => string | null;
}): void {
  const {
    watchlistEl,
    watchlistAddFormEl,
    watchlistAddInputEl,
    isSuppressWatchlistClick,
    setSuppressWatchlistClick,
    getWatchlistSymbols,
    setWatchlistSymbols,
    persistWatchlistSymbols,
    getSelectedTicker,
    ensureSelectedTicker,
    getPrefs,
    persistPrefs,
    refreshAll,
    loadWatchlist,
    selectTickerAndRefresh,
    normalizeTicker,
  } = params;

  watchlistEl.addEventListener("click", async (event) => {
    if (isSuppressWatchlistClick()) {
      setSuppressWatchlistClick(false);
      event.preventDefault();
      return;
    }

    const removeButton = (event.target as HTMLElement).closest("[data-remove-ticker]") as HTMLButtonElement | null;
    if (removeButton) {
      const tickerToRemove = removeButton.dataset.removeTicker;
      const symbols = getWatchlistSymbols();
      if (!tickerToRemove || symbols.length <= 1) {
        return;
      }

      setWatchlistSymbols(symbols.filter((ticker) => ticker !== tickerToRemove));
      persistWatchlistSymbols();

      if (tickerToRemove === getSelectedTicker()) {
        ensureSelectedTicker();
        const prefs = getPrefs();
        prefs.ticker = getSelectedTicker();
        persistPrefs();
        await refreshAll();
        return;
      }

      await loadWatchlist();
      return;
    }

    const button = (event.target as HTMLElement).closest("[data-ticker]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const ticker = button.dataset.ticker;
    if (!ticker) {
      return;
    }

    await selectTickerAndRefresh(ticker);
  });

  watchlistAddFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();

    const symbol = normalizeTicker(watchlistAddInputEl.value);
    if (!symbol) {
      return;
    }

    watchlistAddInputEl.value = "";
    const symbols = getWatchlistSymbols();
    if (!symbols.includes(symbol)) {
      setWatchlistSymbols([symbol, ...symbols].slice(0, 60));
      persistWatchlistSymbols();
    }

    await selectTickerAndRefresh(symbol);
  });
}

export async function bootstrapApp(params: {
  startRefreshProgressLoop: () => void;
  loadProviderStatus: () => Promise<void>;
  initStore: () => Promise<void>;
  ensureSelectedTicker: () => void;
  watchlistListEl: HTMLDivElement;
  getWatchlistSymbols: () => string[];
  getSelectedTicker: () => string;
  getLatestSparklinesByTicker: () => Map<string, number[]>;
  getLatestSnapshotsByTicker: () => Map<string, SnapshotItem>;
  restoreWindowLayout: () => Promise<void>;
  initWindowLayoutPersistence: () => Promise<void>;
  debugLog: (message: string, data?: unknown) => void;
  renderControls: () => void;
  setupSplitters: () => void;
  onReorderWatchlist: (draggedTicker: string, targetTicker: string, placeAfter: boolean) => boolean;
  onSelectTicker: (ticker: string) => Promise<void>;
  setSuppressWatchlistClick: (value: boolean) => void;
  attachLiveBarsListener: () => Promise<void>;
  refreshAll: () => Promise<void>;
  isApiCooldownActive: () => boolean;
  loadWatchlist: () => Promise<void>;
  loadSparklines: () => Promise<void>;
  loadNews: () => Promise<void>;
  scheduleAdaptiveBarsRefresh: () => void;
}): Promise<void> {
  const {
    startRefreshProgressLoop,
    loadProviderStatus,
    initStore,
    ensureSelectedTicker,
    watchlistListEl,
    getWatchlistSymbols,
    getSelectedTicker,
    getLatestSparklinesByTicker,
    getLatestSnapshotsByTicker,
    restoreWindowLayout,
    initWindowLayoutPersistence,
    debugLog,
    renderControls,
    setupSplitters,
    onReorderWatchlist,
    onSelectTicker,
    setSuppressWatchlistClick,
    attachLiveBarsListener,
    refreshAll,
    isApiCooldownActive,
    loadWatchlist,
    loadSparklines,
    loadNews,
    scheduleAdaptiveBarsRefresh,
  } = params;

  startRefreshProgressLoop();
  await loadProviderStatus();
  await initStore();
  ensureSelectedTicker();

  renderWatchlistRows(
    watchlistListEl,
    getWatchlistSymbols(),
    getSelectedTicker(),
    getLatestSparklinesByTicker(),
  );

  try {
    await restoreWindowLayout();
  } catch (error) {
    debugLog("window:restore-exception", String(error));
  }

  try {
    await initWindowLayoutPersistence();
  } catch (error) {
    debugLog("window:persistence-init-failed", String(error));
  }

  renderControls();
  setupSplitters();
  setupWatchlistDragAndDrop({
    watchlistListEl,
    onReorder: onReorderWatchlist,
    onSelectTicker,
    onRenderRows: () => {
      renderWatchlistRows(
        watchlistListEl,
        getWatchlistSymbols(),
        getSelectedTicker(),
        getLatestSparklinesByTicker(),
        getLatestSnapshotsByTicker(),
      );
    },
    setSuppressWatchlistClick,
  });

  await attachLiveBarsListener();
  await refreshAll();

  window.setInterval(() => {
    if (isApiCooldownActive()) {
      return;
    }
    void loadWatchlist();
  }, 60_000);

  window.setInterval(() => {
    if (isApiCooldownActive()) {
      return;
    }
    void loadSparklines();
  }, 300_000);

  window.setInterval(() => {
    if (isApiCooldownActive()) {
      return;
    }
    void loadNews();
  }, 90_000);

  scheduleAdaptiveBarsRefresh();
}

export function registerBeforeUnloadHandler(params: {
  getVisibleRangeSaveTimer: () => number | null;
  setVisibleRangeSaveTimer: (value: number | null) => void;
  clearAdaptiveBarsRefresh: () => void;
  disposeCharts: () => void;
  getWindowLayoutSaveTimer: () => number | null;
  setWindowLayoutSaveTimer: (value: number | null) => void;
  getWindowLayoutPeriodicTimer: () => number | null;
  setWindowLayoutPeriodicTimer: (value: number | null) => void;
  captureWindowLayout: () => Promise<void>;
  getUnlistenWindowMoved: () => (() => void) | null;
  setUnlistenWindowMoved: (value: (() => void) | null) => void;
  getUnlistenWindowResized: () => (() => void) | null;
  setUnlistenWindowResized: (value: (() => void) | null) => void;
  getUnlistenDomResize: () => (() => void) | null;
  setUnlistenDomResize: (value: (() => void) | null) => void;
  getRefreshProgressRaf: () => number | null;
  setRefreshProgressRaf: (value: number | null) => void;
  getUnlistenLiveBars: () => (() => void) | null;
  setUnlistenLiveBars: (value: (() => void) | null) => void;
  persistVisibleRangeForCurrentView: (range: { from: number; to: number } | null) => void;
  getCurrentVisibleRange: () => { from: number; to: number } | null;
}): void {
  const {
    getVisibleRangeSaveTimer,
    setVisibleRangeSaveTimer,
    clearAdaptiveBarsRefresh,
    disposeCharts,
    getWindowLayoutSaveTimer,
    setWindowLayoutSaveTimer,
    getWindowLayoutPeriodicTimer,
    setWindowLayoutPeriodicTimer,
    captureWindowLayout,
    getUnlistenWindowMoved,
    setUnlistenWindowMoved,
    getUnlistenWindowResized,
    setUnlistenWindowResized,
    getUnlistenDomResize,
    setUnlistenDomResize,
    getRefreshProgressRaf,
    setRefreshProgressRaf,
    getUnlistenLiveBars,
    setUnlistenLiveBars,
    persistVisibleRangeForCurrentView,
    getCurrentVisibleRange,
  } = params;

  window.addEventListener("beforeunload", () => {
    const visibleRangeSaveTimer = getVisibleRangeSaveTimer();
    if (visibleRangeSaveTimer !== null) {
      window.clearTimeout(visibleRangeSaveTimer);
      setVisibleRangeSaveTimer(null);
    }
    persistVisibleRangeForCurrentView(getCurrentVisibleRange());

    const windowLayoutSaveTimer = getWindowLayoutSaveTimer();
    if (windowLayoutSaveTimer !== null) {
      window.clearTimeout(windowLayoutSaveTimer);
      setWindowLayoutSaveTimer(null);
    }

    const windowLayoutPeriodicTimer = getWindowLayoutPeriodicTimer();
    if (windowLayoutPeriodicTimer !== null) {
      window.clearInterval(windowLayoutPeriodicTimer);
      setWindowLayoutPeriodicTimer(null);
    }

    void captureWindowLayout();

    const unlistenWindowMoved = getUnlistenWindowMoved();
    if (unlistenWindowMoved) {
      unlistenWindowMoved();
      setUnlistenWindowMoved(null);
    }

    const unlistenWindowResized = getUnlistenWindowResized();
    if (unlistenWindowResized) {
      unlistenWindowResized();
      setUnlistenWindowResized(null);
    }

    const unlistenDomResize = getUnlistenDomResize();
    if (unlistenDomResize) {
      unlistenDomResize();
      setUnlistenDomResize(null);
    }

    const refreshProgressRaf = getRefreshProgressRaf();
    if (refreshProgressRaf !== null) {
      window.cancelAnimationFrame(refreshProgressRaf);
      setRefreshProgressRaf(null);
    }

    clearAdaptiveBarsRefresh();
    disposeCharts();

    const unlistenLiveBars = getUnlistenLiveBars();
    if (unlistenLiveBars) {
      unlistenLiveBars();
      setUnlistenLiveBars(null);
    }

    void invoke("stop_live_stream");
  });
}
