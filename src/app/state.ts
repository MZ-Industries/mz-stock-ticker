import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Store } from "@tauri-apps/plugin-store";
import { clamp, normalizeMovingAveragePeriods, normalizeStoredRatio, normalizeVisibleRangesByViewKey, normalizeWatchlistSymbols, normalizeWindowLayout, parseStoredJson } from "./utils";
import type { AppPrefs, ChartType, RangePreset } from "./types";

export function hydrateVisibleRangeStateAction(params: {
  prefs: AppPrefs;
  currentChartViewKey: string;
}): { persistedVisibleRangeKey: string; persistedVisibleRange: { from: number; to: number } | null } {
  const { prefs, currentChartViewKey } = params;
  const rangesByViewKey = normalizeVisibleRangesByViewKey(prefs.visibleRangesByViewKey);
  prefs.visibleRangesByViewKey = rangesByViewKey;

  const key = currentChartViewKey;
  const range = rangesByViewKey[key];
  return {
    persistedVisibleRangeKey: key,
    persistedVisibleRange: range ?? null,
  };
}

export function upsertVisibleRangeForViewKeyAction(params: {
  prefs: AppPrefs;
  maxStoredVisibleRanges: number;
  viewKey: string;
  range: { from: number; to: number };
}): void {
  const { prefs, maxStoredVisibleRanges, viewKey, range } = params;
  const existing = normalizeVisibleRangesByViewKey(prefs.visibleRangesByViewKey);
  const next = {
    ...existing,
    [viewKey]: range,
  };

  const keys = Object.keys(next);
  if (keys.length > maxStoredVisibleRanges) {
    const oldestKey = keys[0];
    delete next[oldestKey];
  }

  prefs.visibleRangesByViewKey = next;
}

export function persistVisibleRangeForCurrentViewAction(params: {
  range: { from: number; to: number } | null;
  currentChartViewKey: string;
  upsertVisibleRangeForViewKey: (viewKey: string, range: { from: number; to: number }) => void;
  persistPrefs: () => void;
}): { persistedVisibleRangeKey: string | null; persistedVisibleRange: { from: number; to: number } | null } {
  const { range, currentChartViewKey, upsertVisibleRangeForViewKey, persistPrefs } = params;
  if (!range) {
    return {
      persistedVisibleRangeKey: null,
      persistedVisibleRange: null,
    };
  }

  const persistedVisibleRange = {
    from: range.from,
    to: range.to,
  };

  upsertVisibleRangeForViewKey(currentChartViewKey, persistedVisibleRange);
  persistPrefs();

  return {
    persistedVisibleRangeKey: currentChartViewKey,
    persistedVisibleRange,
  };
}

export function schedulePersistVisibleRangeForCurrentViewAction(params: {
  range: { from: number; to: number } | null;
  visibleRangeSaveTimer: number | null;
  setVisibleRangeSaveTimer: (value: number | null) => void;
  persistVisibleRangeForCurrentView: (range: { from: number; to: number } | null) => void;
}): void {
  const {
    range,
    visibleRangeSaveTimer,
    setVisibleRangeSaveTimer,
    persistVisibleRangeForCurrentView,
  } = params;

  if (!range) {
    return;
  }

  const normalized = {
    from: range.from,
    to: range.to,
  };

  if (visibleRangeSaveTimer !== null) {
    window.clearTimeout(visibleRangeSaveTimer);
  }

  const timer = window.setTimeout(() => {
    setVisibleRangeSaveTimer(null);
    persistVisibleRangeForCurrentView(normalized);
  }, 250);

  setVisibleRangeSaveTimer(timer);
}

export function loadWatchlistSymbolsFromLocalStorageAction(watchlistStorageKey: string): string[] {
  const parsed = parseStoredJson(watchlistStorageKey);
  return normalizeWatchlistSymbols(parsed);
}

export function persistWatchlistSymbolsAction(params: {
  watchlistStorageKey: string;
  watchlistSymbols: string[];
  prefs: AppPrefs;
  persistPrefs: () => void;
}): void {
  const { watchlistStorageKey, watchlistSymbols, prefs, persistPrefs } = params;
  localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlistSymbols));
  prefs.watchlistSymbols = [...watchlistSymbols];
  persistPrefs();
}

export function ensureSelectedTickerAction(params: {
  watchlistSymbols: string[];
  selectedTicker: string;
  defaultWatchlist: string[];
}): { watchlistSymbols: string[]; selectedTicker: string } {
  let { watchlistSymbols, selectedTicker } = params;

  if (watchlistSymbols.length === 0) {
    watchlistSymbols = [...params.defaultWatchlist];
  }

  if (!watchlistSymbols.includes(selectedTicker)) {
    selectedTicker = watchlistSymbols[0];
  }

  return { watchlistSymbols, selectedTicker };
}

export async function initStoreAction(params: {
  defaultPrefs: AppPrefs;
  defaultWatchlist: string[];
  watchlistStorageKey: string;
  windowLayoutStorageKey: string;
  ranges: RangePreset[];
  chartTypes: ChartType[];
  movingAveragePeriodOptions: readonly number[];
  defaultMovingAveragePeriods: readonly number[];
  candleIntervalOptions: Array<{ key: string }>;
  minPricePaneRatio: number;
  maxPricePaneRatio: number;
  minChartAreaRatio: number;
  maxChartAreaRatio: number;
}): Promise<{
  prefsStore: Store;
  prefs: AppPrefs;
  watchlistSymbols: string[];
  selectedTicker: string;
  selectedRange: RangePreset;
  selectedChartType: ChartType;
  selectedMovingAveragePeriods: number[];
  selectedCandleIntervalKey: string;
}> {
  const {
    defaultPrefs,
    defaultWatchlist,
    watchlistStorageKey,
    windowLayoutStorageKey,
    ranges,
    chartTypes,
    movingAveragePeriodOptions,
    defaultMovingAveragePeriods,
    candleIntervalOptions,
    minPricePaneRatio,
    maxPricePaneRatio,
    minChartAreaRatio,
    maxChartAreaRatio,
  } = params;

  const prefsStore = await Store.load("ui-preferences.json");
  const stored = await prefsStore.get<AppPrefs>("dashboard");
  const prefs: AppPrefs = { ...defaultPrefs, ...(stored ?? {}) };

  const storeWatchlist = normalizeWatchlistSymbols(prefs.watchlistSymbols);
  const localWatchlist = loadWatchlistSymbolsFromLocalStorageAction(watchlistStorageKey);
  const watchlistSymbols = storeWatchlist.length > 0
    ? storeWatchlist
    : localWatchlist.length > 0
      ? localWatchlist
      : [...defaultWatchlist];

  prefs.watchlistSymbols = [...watchlistSymbols];
  localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlistSymbols));

  if (!normalizeWindowLayout(prefs.windowLayout)) {
    const legacyLayout = normalizeWindowLayout(parseStoredJson(windowLayoutStorageKey));
    if (legacyLayout) {
      prefs.windowLayout = legacyLayout;
    }
  }

  localStorage.removeItem(windowLayoutStorageKey);

  const selectedTicker = watchlistSymbols.includes(prefs.ticker)
    ? prefs.ticker
    : watchlistSymbols[0];

  const selectedRange = ranges.find((item) => item.label === prefs.rangeLabel) ?? ranges[2];
  const selectedChartType = chartTypes.includes(prefs.chartType) ? prefs.chartType : chartTypes[3];
  const selectedMovingAveragePeriods = normalizeMovingAveragePeriods(
    prefs.movingAveragePeriods,
    movingAveragePeriodOptions,
    defaultMovingAveragePeriods,
  );
  prefs.movingAveragePeriods = [...selectedMovingAveragePeriods];
  const selectedCandleIntervalKey =
    prefs.candleIntervalKey && candleIntervalOptions.some((item) => item.key === prefs.candleIntervalKey)
      ? prefs.candleIntervalKey
      : "5m";

  const shell = document.querySelector(".app-shell") as HTMLDivElement;
  const mainPanel = document.querySelector(".main-panel") as HTMLDivElement;
  const chartStack = document.querySelector("#chart-stack") as HTMLDivElement;

  if (prefs.sidebarWidth > 0) {
    shell.style.setProperty("--sidebar-width", `${clamp(210, 420, prefs.sidebarWidth)}px`);
  }

  if (prefs.pricePaneHeight > 0) {
    const chartStackHeight = chartStack.getBoundingClientRect().height || window.innerHeight;
    const ratio = normalizeStoredRatio(
      prefs.pricePaneHeight,
      chartStackHeight,
      minPricePaneRatio,
      maxPricePaneRatio,
    );
    chartStack.style.setProperty("--price-pane-height", `${(ratio * 100).toFixed(3)}%`);
    prefs.pricePaneHeight = ratio;
  }

  if (prefs.chartAreaHeight > 0) {
    const mainPanelHeight = mainPanel.getBoundingClientRect().height || window.innerHeight;
    const ratio = normalizeStoredRatio(
      prefs.chartAreaHeight,
      mainPanelHeight,
      minChartAreaRatio,
      maxChartAreaRatio,
    );
    shell.style.setProperty("--chart-area-height", `${(ratio * 100).toFixed(3)}%`);
    prefs.chartAreaHeight = ratio;
  }

  return {
    prefsStore,
    prefs,
    watchlistSymbols,
    selectedTicker,
    selectedRange,
    selectedChartType,
    selectedMovingAveragePeriods,
    selectedCandleIntervalKey,
  };
}

export function persistPrefsAction(prefsStore: Store | null, prefs: AppPrefs): void {
  if (!prefsStore) {
    return;
  }

  void prefsStore.set("dashboard", prefs).then(() => prefsStore.save());
}

export async function captureWindowLayoutAction(params: {
  useNativeWindowState: boolean;
  prefs: AppPrefs;
  persistPrefs: () => void;
  debugLog: (message: string, data?: unknown) => void;
}): Promise<void> {
  const { useNativeWindowState, prefs, persistPrefs, debugLog } = params;
  if (useNativeWindowState) {
    return;
  }

  try {
    const appWindow = getCurrentWindow();
    const maximized = await appWindow.isMaximized();

    if (maximized && prefs.windowLayout) {
      prefs.windowLayout = {
        ...prefs.windowLayout,
        maximized: true,
      };
      persistPrefs();
      return;
    }

    const [position, size] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.innerSize(),
    ]);

    prefs.windowLayout = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      maximized,
    };
    persistPrefs();
  } catch (error) {
    debugLog("window:capture-failed", String(error));
  }
}

export function scheduleWindowLayoutSaveAction(params: {
  useNativeWindowState: boolean;
  windowLayoutSaveDebounceMs: number;
  windowLayoutSaveTimer: number | null;
  setWindowLayoutSaveTimer: (value: number | null) => void;
  captureWindowLayout: () => Promise<void>;
}): void {
  const {
    useNativeWindowState,
    windowLayoutSaveDebounceMs,
    windowLayoutSaveTimer,
    setWindowLayoutSaveTimer,
    captureWindowLayout,
  } = params;

  if (useNativeWindowState) {
    return;
  }

  if (windowLayoutSaveTimer !== null) {
    window.clearTimeout(windowLayoutSaveTimer);
  }

  const timer = window.setTimeout(() => {
    setWindowLayoutSaveTimer(null);
    void captureWindowLayout();
  }, windowLayoutSaveDebounceMs);

  setWindowLayoutSaveTimer(timer);
}

export async function restoreWindowLayoutAction(params: {
  useNativeWindowState: boolean;
  layout: AppPrefs["windowLayout"];
  debugLog: (message: string, data?: unknown) => void;
}): Promise<void> {
  const { useNativeWindowState, layout, debugLog } = params;
  if (useNativeWindowState) {
    return;
  }

  if (!layout) {
    return;
  }

  const appWindow = getCurrentWindow();
  try {
    await appWindow.setPosition(new PhysicalPosition(layout.x, layout.y));
    await appWindow.setSize(new PhysicalSize(layout.width, layout.height));
    if (layout.maximized) {
      await appWindow.maximize();
    }
  } catch (error) {
    debugLog("window:restore-failed", {
      error: String(error),
      layout,
    });
  }
}

export async function initWindowLayoutPersistenceAction(params: {
  useNativeWindowState: boolean;
  windowLayoutPeriodicSaveMs: number;
  scheduleWindowLayoutSave: () => void;
  setUnlistenWindowMoved: (value: (() => void) | null) => void;
  setUnlistenWindowResized: (value: (() => void) | null) => void;
  setUnlistenDomResize: (value: (() => void) | null) => void;
  setWindowLayoutPeriodicTimer: (value: number | null) => void;
}): Promise<void> {
  const {
    useNativeWindowState,
    windowLayoutPeriodicSaveMs,
    scheduleWindowLayoutSave,
    setUnlistenWindowMoved,
    setUnlistenWindowResized,
    setUnlistenDomResize,
    setWindowLayoutPeriodicTimer,
  } = params;

  if (useNativeWindowState) {
    return;
  }

  const appWindow = getCurrentWindow();
  setUnlistenWindowMoved(await appWindow.onMoved(() => {
    scheduleWindowLayoutSave();
  }));
  setUnlistenWindowResized(await appWindow.onResized(() => {
    scheduleWindowLayoutSave();
  }));

  const onDomResize = () => {
    scheduleWindowLayoutSave();
  };
  window.addEventListener("resize", onDomResize);
  setUnlistenDomResize(() => {
    window.removeEventListener("resize", onDomResize);
  });

  setWindowLayoutPeriodicTimer(window.setInterval(() => {
    scheduleWindowLayoutSave();
  }, windowLayoutPeriodicSaveMs));

  scheduleWindowLayoutSave();
}
