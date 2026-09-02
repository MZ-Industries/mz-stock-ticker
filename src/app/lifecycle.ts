import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "./api";
import {
  attachLiveBarsListener,
  clearAdaptiveBarsRefresh,
  detachLiveBarsListener,
  loadBars,
  loadNews,
  loadSparklines,
  loadWatchlist,
  refreshAll,
  scheduleAdaptiveBarsRefresh,
  selectTickerAndRefresh,
  startStream,
} from "./actions";
import { disposeCharts, getVisibleLogicalRange, renderCharts } from "./chartPanel";
import {
  CANDLE_INTERVAL_OPTIONS,
  MAX_WATCHLIST_SYMBOLS,
  MOVING_AVERAGE_PERIOD_OPTIONS,
  NEWS_REFRESH_MS,
  RANGES,
  SPARKLINE_REFRESH_MS,
  WATCHLIST_REFRESH_MS,
} from "./constants";
import { els } from "./elements";
import { applyStoredPaneSizes, reorderWatchlistSymbols, setupSplitters } from "./layout";
import { isCandleIntervalRelevant } from "./market";
import { ensureSelectedTicker, flushVisibleRange, initPrefs, persistWatchlistSymbols } from "./prefs";
import { startRefreshProgressLoop, stopRefreshProgressLoop } from "./progress";
import { loadProviderStatus } from "./provider";
import { hideSearchResults, setupSymbolSearch } from "./search";
import { debugLog, isApiCooldownActive, persistPrefs, state } from "./store";
import { renderControls, renderStats } from "./ui";
import { initUpdater } from "./updater";
import { normalizeTicker } from "./utils";
import { cycleWatchlistBadgeMode, renderWatchlistRows, setupWatchlistDragAndDrop } from "./watchlist";
import type { ChartType } from "./types";

function addSymbolToWatchlist(symbol: string): void {
  if (!state.watchlistSymbols.includes(symbol)) {
    state.watchlistSymbols = [symbol, ...state.watchlistSymbols].slice(0, MAX_WATCHLIST_SYMBOLS);
    persistWatchlistSymbols();
  }

  void selectTickerAndRefresh(symbol);
}

function scrollSelectedRowIntoView(): void {
  const row = els.watchlistListEl.querySelector(".watch-row.selected");
  row?.scrollIntoView({ block: "nearest" });
}

let keyboardRefreshTimer: number | null = null;

/**
 * Arrow-key navigation moves the selection instantly but debounces the data
 * refresh, so holding a key does not fire a request per row.
 */
function selectTickerViaKeyboard(ticker: string): void {
  state.selectedTicker = ticker;
  state.prefs.ticker = ticker;
  persistPrefs();
  renderWatchlistRows();
  scrollSelectedRowIntoView();
  renderStats();

  if (keyboardRefreshTimer !== null) {
    window.clearTimeout(keyboardRefreshTimer);
  }
  keyboardRefreshTimer = window.setTimeout(() => {
    keyboardRefreshTimer = null;
    void refreshAll();
  }, 350);
}

export function registerGlobalEventHandlers(): void {
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

  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    const symbols = state.watchlistSymbols;
    if (symbols.length === 0) {
      return;
    }

    const index = symbols.indexOf(state.selectedTicker);
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(symbols.length - 1, index + 1)
      : Math.max(0, index < 0 ? 0 : index - 1);

    if (nextIndex === index) {
      return;
    }

    event.preventDefault();
    selectTickerViaKeyboard(symbols[nextIndex]);
  });

  els.rangeGroupEl.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest("[data-range]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const preset = RANGES.find((range) => range.label === button.dataset.range);
    if (!preset) {
      return;
    }

    state.selectedRange = preset;
    state.prefs.rangeLabel = preset.label;
    persistPrefs();
    renderControls();
    await loadBars();
    await startStream();
  });

  els.intervalGroupEl.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest("[data-candle-interval]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const nextKey = button.dataset.candleInterval;
    if (!nextKey || !CANDLE_INTERVAL_OPTIONS.some((item) => item.key === nextKey)) {
      return;
    }

    state.selectedCandleIntervalKey = nextKey;
    state.prefs.candleIntervalKey = nextKey;
    persistPrefs();
    renderControls();
    await loadBars();
    await startStream();
  });

  els.maGroupEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("[data-ma-period]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const period = Number(button.dataset.maPeriod);
    if (!Number.isInteger(period) || !(MOVING_AVERAGE_PERIOD_OPTIONS as readonly number[]).includes(period)) {
      return;
    }

    const previous = state.selectedMovingAveragePeriods;
    const next = previous.includes(period)
      ? previous.filter((value) => value !== period)
      : [...previous, period].sort((a, b) => a - b);

    state.selectedMovingAveragePeriods = next;
    state.prefs.movingAveragePeriods = [...next];
    persistPrefs();
    renderControls();
    renderCharts();
  });

  els.typeGroupEl.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest("[data-type]") as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const wasRelevant = isCandleIntervalRelevant(state.selectedChartType, state.selectedRange);
    const nextType = (button.dataset.type as ChartType) ?? state.selectedChartType;
    state.selectedChartType = nextType;
    state.prefs.chartType = nextType;
    persistPrefs();

    const isRelevant = isCandleIntervalRelevant(state.selectedChartType, state.selectedRange);
    renderControls();

    if (!wasRelevant && isRelevant) {
      await loadBars();
      await startStream();
      return;
    }

    renderCharts();
  });

  els.newsGridEl.addEventListener("click", (event) => {
    const card = (event.target as HTMLElement).closest("[data-url]") as HTMLElement | null;
    const url = card?.dataset.url;
    if (!url) {
      return;
    }

    void openUrl(url).catch((error) => {
      debugLog("news:open-failed", String(error));
    });
  });
}

export function registerWatchlistEventHandlers(): void {
  els.watchlistEl.addEventListener("click", async (event) => {
    if (state.suppressWatchlistClick) {
      state.suppressWatchlistClick = false;
      event.preventDefault();
      return;
    }

    const removeButton = (event.target as HTMLElement).closest("[data-remove-ticker]") as HTMLButtonElement | null;
    if (removeButton) {
      const tickerToRemove = removeButton.dataset.removeTicker;
      if (!tickerToRemove || state.watchlistSymbols.length <= 1) {
        return;
      }

      state.watchlistSymbols = state.watchlistSymbols.filter((ticker) => ticker !== tickerToRemove);
      persistWatchlistSymbols();

      if (tickerToRemove === state.selectedTicker) {
        ensureSelectedTicker();
        state.prefs.ticker = state.selectedTicker;
        persistPrefs();
        await refreshAll();
        return;
      }

      renderWatchlistRows();
      return;
    }

    const button = (event.target as HTMLElement).closest("[data-ticker]") as HTMLButtonElement | null;
    const ticker = button?.dataset.ticker;
    if (!ticker) {
      return;
    }

    await selectTickerAndRefresh(ticker);
  });

  els.watchlistAddFormEl.addEventListener("submit", (event) => {
    event.preventDefault();

    const symbol = normalizeTicker(els.watchlistAddInputEl.value);
    if (!symbol) {
      return;
    }

    els.watchlistAddInputEl.value = "";
    hideSearchResults();
    addSymbolToWatchlist(symbol);
  });

  setupSymbolSearch({
    onPick: (picked) => {
      const symbol = normalizeTicker(picked);
      if (symbol) {
        addSymbolToWatchlist(symbol);
      }
    },
  });
}

export async function bootstrapApp(): Promise<void> {
  startRefreshProgressLoop();
  await loadProviderStatus();
  await initPrefs();
  ensureSelectedTicker();

  renderWatchlistRows();
  applyStoredPaneSizes();
  renderControls();
  setupSplitters();

  setupWatchlistDragAndDrop({
    watchlistListEl: els.watchlistListEl,
    onReorder: (draggedTicker, targetTicker, placeAfter) => {
      const next = reorderWatchlistSymbols(draggedTicker, targetTicker, placeAfter);
      if (!next) {
        return false;
      }

      state.watchlistSymbols = next;
      persistWatchlistSymbols();
      return true;
    },
    onSelectTicker: selectTickerAndRefresh,
    onRenderRows: renderWatchlistRows,
    onBadgeClick: () => {
      cycleWatchlistBadgeMode();
      persistPrefs();
      renderWatchlistRows();
    },
    setSuppressWatchlistClick: (value) => {
      state.suppressWatchlistClick = value;
    },
  });

  await attachLiveBarsListener();
  await refreshAll();

  window.setInterval(() => {
    if (!isApiCooldownActive()) {
      void loadWatchlist();
    }
  }, WATCHLIST_REFRESH_MS);

  window.setInterval(() => {
    if (!isApiCooldownActive()) {
      void loadSparklines();
    }
  }, SPARKLINE_REFRESH_MS);

  window.setInterval(() => {
    if (!isApiCooldownActive()) {
      void loadNews();
    }
  }, NEWS_REFRESH_MS);

  scheduleAdaptiveBarsRefresh();
  initUpdater();
}

export function registerBeforeUnloadHandler(): void {
  window.addEventListener("beforeunload", () => {
    flushVisibleRange(getVisibleLogicalRange());
    stopRefreshProgressLoop();
    clearAdaptiveBarsRefresh();
    disposeCharts();
    detachLiveBarsListener();
    void api.stopLiveStream();
  });
}
