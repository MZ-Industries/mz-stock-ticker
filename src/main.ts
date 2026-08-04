import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Store } from "@tauri-apps/plugin-store";
import {
  createChart,
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type TickMarkType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

type ChartType = "line" | "area" | "baseline" | "candlestick" | "bar";

type AggregateBar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type LiveAggregateEvent = {
  ev: "A" | "AM";
  sym: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  s: number;
  e: number;
};

type SnapshotItem = {
  ticker: string;
  price: number;
  change_percent: number;
  post_market_price?: number;
  post_market_change_percent?: number;
};

type NewsItem = {
  id: string;
  title: string;
  source: string;
  author: string;
  published_utc: string;
  article_url: string;
  image_url: string;
  description: string;
};

type RangePreset = {
  label: string;
  days: number;
  multiplier: number;
  timespan: "minute" | "hour" | "day";
};

type AppPrefs = {
  ticker: string;
  rangeLabel: string;
  chartType: ChartType;
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

const DEFAULT_WATCHLIST = [
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

const WATCHLIST_STORAGE_KEY = "watchlistSymbols";

const RANGES: RangePreset[] = [
  { label: "1D", days: 1, multiplier: 1, timespan: "minute" },
  { label: "1W", days: 7, multiplier: 5, timespan: "minute" },
  { label: "1M", days: 30, multiplier: 30, timespan: "minute" },
  { label: "3M", days: 90, multiplier: 1, timespan: "hour" },
  { label: "6M", days: 180, multiplier: 4, timespan: "hour" },
  { label: "1Y", days: 365, multiplier: 1, timespan: "day" },
  { label: "ALL", days: 1800, multiplier: 1, timespan: "day" },
];

let selectedTicker = "AAPL";
let selectedRange = RANGES[2];
let selectedChartType: ChartType = "candlestick";
let watchlistSymbols = [...DEFAULT_WATCHLIST];
let latestBars: AggregateBar[] = [];
let activeSessionDate: string | null = null;
let priceChart: IChartApi | null = null;
let volumeChart: IChartApi | null = null;
let resizeObserver: ResizeObserver | null = null;
let pushPriceBar: ((bar: AggregateBar) => void) | null = null;
let pushVolumeBar: ((bar: AggregateBar) => void) | null = null;
let prefsStore: Store | null = null;
let unlistenAggregate: (() => void) | null = null;
let apiCooldownUntilMs = 0;
let latestSnapshotsByTicker = new Map<string, SnapshotItem>();
let refreshInFlightCount = 0;
let refreshProgressRaf: number | null = null;
let lastRefreshFinishedAtMs = Date.now();
let windowLayoutSaveTimer: number | null = null;
let unlistenWindowMoved: (() => void) | null = null;
let unlistenWindowResized: (() => void) | null = null;
let persistedVisibleRange: { from: number; to: number } | null = null;
let persistedVisibleRangeKey: string | null = null;

const AUTO_REFRESH_PROGRESS_WINDOW_MS = 60_000;
const WINDOW_LAYOUT_SAVE_DEBOUNCE_MS = 800;

const defaultPrefs: AppPrefs = {
  ticker: "AAPL",
  rangeLabel: "1M",
  chartType: "candlestick",
  sidebarWidth: 280,
  pricePaneHeight: 0,
  chartAreaHeight: 0,
};

let prefs: AppPrefs = { ...defaultPrefs };

const root = document.querySelector("#app") as HTMLDivElement;

root.innerHTML = `
  <div id="refresh-progress" class="refresh-progress" aria-hidden="true">
    <div id="refresh-progress-fill" class="refresh-progress-fill"></div>
  </div>
  <div class="app-shell">
    <aside class="watchlist" id="watchlist">
      <div class="watchlist-header">
        <h2>Symbols</h2>
        <form class="watchlist-add-form" id="watchlist-add-form">
          <input id="watchlist-add-input" type="text" maxlength="12" placeholder="Add symbol" aria-label="Add symbol" />
          <button type="submit" class="watchlist-add-button">Add</button>
        </form>
      </div>
      <div class="watchlist-list" id="watchlist-list"></div>
    </aside>
    <div class="splitter vertical" id="sidebar-splitter" role="separator" aria-orientation="vertical"></div>
    <section class="main-panel">
      <header class="topbar">
        <div>
          <h1 id="title-ticker">AAPL</h1>
          <p class="subtle">NASDAQ · USD</p>
        </div>
        <div class="price-headline">
          <p id="headline-price">-</p>
          <p id="headline-change" class="subtle">-</p>
          <div id="extended-strip" class="extended-strip hidden" aria-label="Extended hours pricing">
            <div class="extended-item">
              <p id="close-price" class="extended-price">-</p>
              <p id="close-change" class="extended-change subtle">-</p>
              <p class="extended-label subtle">At Close</p>
            </div>
            <div class="extended-divider"></div>
            <div class="extended-item">
              <p id="after-price" class="extended-price">-</p>
              <p id="after-change" class="extended-change subtle">-</p>
              <p class="extended-label subtle">After Hours</p>
            </div>
          </div>
        </div>
      </header>
      <div class="controls">
        <div class="range-group" id="range-group"></div>
        <div class="type-group" id="type-group"></div>
      </div>
      <div class="chart-stack" id="chart-stack">
        <div class="price-chart" id="price-chart"></div>
        <div class="splitter horizontal" id="volume-splitter" role="separator" aria-orientation="horizontal"></div>
        <div class="volume-chart" id="volume-chart"></div>
      </div>
      <div class="splitter horizontal" id="news-splitter" role="separator" aria-orientation="horizontal"></div>
      <section class="news-panel">
        <div class="news-header">
          <h2>Business News</h2>
          <span class="subtle">from Yahoo Finance</span>
        </div>
        <div class="news-grid" id="news-grid"></div>
      </section>
    </section>
  </div>
`;

const watchlistEl = document.querySelector("#watchlist") as HTMLDivElement;
const watchlistListEl = document.querySelector("#watchlist-list") as HTMLDivElement;
const watchlistAddFormEl = document.querySelector("#watchlist-add-form") as HTMLFormElement;
const watchlistAddInputEl = document.querySelector("#watchlist-add-input") as HTMLInputElement;
const rangeGroupEl = document.querySelector("#range-group") as HTMLDivElement;
const typeGroupEl = document.querySelector("#type-group") as HTMLDivElement;
const headlinePriceEl = document.querySelector("#headline-price") as HTMLParagraphElement;
const headlineChangeEl = document.querySelector("#headline-change") as HTMLParagraphElement;
const titleTickerEl = document.querySelector("#title-ticker") as HTMLHeadingElement;
const extendedStripEl = document.querySelector("#extended-strip") as HTMLDivElement;
const closePriceEl = document.querySelector("#close-price") as HTMLParagraphElement;
const closeChangeEl = document.querySelector("#close-change") as HTMLParagraphElement;
const afterPriceEl = document.querySelector("#after-price") as HTMLParagraphElement;
const afterChangeEl = document.querySelector("#after-change") as HTMLParagraphElement;
const refreshProgressEl = document.querySelector("#refresh-progress") as HTMLDivElement;
const refreshProgressFillEl = document.querySelector("#refresh-progress-fill") as HTMLDivElement;

const chartTypes: ChartType[] = ["line", "area", "baseline", "candlestick", "bar"];
const RIGHT_SCALE_WIDTH_PX = 72;

const DEBUG = true;

function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) {
    return;
  }

  if (data !== undefined) {
    console.debug(`[ticker-debug] ${message}`, data);
  } else {
    console.debug(`[ticker-debug] ${message}`);
  }
}

function parseRetryAfterSeconds(error: unknown): number | null {
  const text = String(error);
  const match = text.match(/retry_after=(\d+)/i);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return Math.min(seconds, 600);
}

function isRateLimitError(error: unknown): boolean {
  const text = String(error);
  return text.includes("RATE_LIMITED") || text.includes("429");
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

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
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

function normalizeTicker(raw: string): string | null {
  const ticker = raw.trim().toUpperCase();
  if (!ticker) {
    return null;
  }

  const valid = ticker.length <= 12 && /^[A-Z0-9.-]+$/.test(ticker);
  return valid ? ticker : null;
}

function loadWatchlistSymbols(): void {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) {
      watchlistSymbols = [...DEFAULT_WATCHLIST];
      return;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      watchlistSymbols = [...DEFAULT_WATCHLIST];
      return;
    }

    const normalized = parsed
      .map((value) => (typeof value === "string" ? normalizeTicker(value) : null))
      .filter((value): value is string => Boolean(value));

    watchlistSymbols = [...new Set(normalized)].slice(0, 60);
    if (watchlistSymbols.length === 0) {
      watchlistSymbols = [...DEFAULT_WATCHLIST];
    }
  } catch {
    watchlistSymbols = [...DEFAULT_WATCHLIST];
  }
}

function persistWatchlistSymbols(): void {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlistSymbols));
}

function ensureSelectedTicker(): void {
  if (watchlistSymbols.length === 0) {
    watchlistSymbols = [...DEFAULT_WATCHLIST];
  }

  if (!watchlistSymbols.includes(selectedTicker)) {
    selectedTicker = watchlistSymbols[0];
  }
}

function renderWatchlistRows(pricesByTicker?: Map<string, SnapshotItem>): void {
  watchlistListEl.innerHTML = watchlistSymbols.map((ticker) => {
    const item = pricesByTicker?.get(ticker);
    const hasAfterHours = item
      && Number.isFinite(item.post_market_price)
      && Number.isFinite(item.post_market_change_percent);
    const displayPrice = hasAfterHours ? (item?.post_market_price as number) : item?.price;
    const displayChange = hasAfterHours ? (item?.post_market_change_percent as number) : item?.change_percent;
    const price = displayPrice !== undefined ? fmtNumber(displayPrice) : "--";
    const change = displayChange !== undefined ? fmtPct(displayChange) : "--";
    const cls = displayChange !== undefined && displayChange >= 0 ? "up" : "down";
    const sessionLabel = hasAfterHours ? " AH" : "";
    const selected = ticker === selectedTicker ? "selected" : "";

    return `
      <div class="watch-row-wrap">
        <button class="watch-row ${selected}" data-ticker="${ticker}">
          <span>${ticker}</span>
          <span class="watch-meta ${cls}">${price} · ${change}${sessionLabel}</span>
        </button>
        <button class="watch-remove" data-remove-ticker="${ticker}" aria-label="Remove ${ticker}">×</button>
      </div>
    `;
  }).join("");
}

async function initStore(): Promise<void> {
  loadWatchlistSymbols();

  prefsStore = await Store.load("ui-preferences.json");
  const stored = await prefsStore.get<AppPrefs>("dashboard");
  prefs = { ...defaultPrefs, ...(stored ?? {}) };

  if (watchlistSymbols.includes(prefs.ticker)) {
    selectedTicker = prefs.ticker;
  } else {
    selectedTicker = watchlistSymbols[0];
  }

  const matchingRange = RANGES.find((item) => item.label === prefs.rangeLabel);
  if (matchingRange) {
    selectedRange = matchingRange;
  }

  if (chartTypes.includes(prefs.chartType)) {
    selectedChartType = prefs.chartType;
  }

  const shell = document.querySelector(".app-shell") as HTMLDivElement;
  const chartStack = document.querySelector("#chart-stack") as HTMLDivElement;
  if (prefs.sidebarWidth > 0) {
    shell.style.setProperty("--sidebar-width", `${clamp(210, 420, prefs.sidebarWidth)}px`);
  }
  if (prefs.pricePaneHeight > 0) {
    chartStack.style.setProperty("--price-pane-height", `${clamp(220, 900, prefs.pricePaneHeight)}px`);
  }
  if (prefs.chartAreaHeight > 0) {
    shell.style.setProperty("--chart-area-height", `${clamp(320, 1200, prefs.chartAreaHeight)}px`);
  }
}

function persistPrefs(): void {
  if (!prefsStore) {
    return;
  }

  void prefsStore.set("dashboard", prefs).then(() => prefsStore?.save());
}

async function captureWindowLayout(): Promise<void> {
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
}

function scheduleWindowLayoutSave(): void {
  if (windowLayoutSaveTimer !== null) {
    window.clearTimeout(windowLayoutSaveTimer);
  }

  windowLayoutSaveTimer = window.setTimeout(() => {
    windowLayoutSaveTimer = null;
    void captureWindowLayout();
  }, WINDOW_LAYOUT_SAVE_DEBOUNCE_MS);
}

async function restoreWindowLayout(): Promise<void> {
  const layout = prefs.windowLayout;
  if (!layout) {
    return;
  }

  const appWindow = getCurrentWindow();
  await appWindow.setPosition(new PhysicalPosition(layout.x, layout.y));
  await appWindow.setSize(new PhysicalSize(layout.width, layout.height));
  if (layout.maximized) {
    await appWindow.maximize();
  }
}

async function initWindowLayoutPersistence(): Promise<void> {
  const appWindow = getCurrentWindow();
  unlistenWindowMoved = await appWindow.onMoved(() => {
    scheduleWindowLayoutSave();
  });
  unlistenWindowResized = await appWindow.onResized(() => {
    scheduleWindowLayoutSave();
  });
}

function fmtNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

function fmtPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatAxisTime(time: Time, _tickType: TickMarkType): string | null {
  if (typeof time === "string") {
    return time;
  }

  if (typeof time !== "number") {
    return `${String(time.month).padStart(2, "0")}/${String(time.day).padStart(2, "0")}`;
  }

  const date = new Date(time * 1000);

  if (selectedRange.timespan === "day") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatTooltipTime(time: Time): string {
  if (typeof time === "string") {
    return time;
  }

  if (typeof time !== "number") {
    return `${String(time.month).padStart(2, "0")}/${String(time.day).padStart(2, "0")}`;
  }

  const date = new Date(time * 1000);
  if (selectedRange.timespan === "day") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function toNyIsoDate(daysBack: number): string {
  const now = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function getNyParts(timestampMs: number): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestampMs));

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

function isRegularMarketHour(bar: AggregateBar): boolean {
  const ny = getNyParts(bar.t);
  const totalMinutes = ny.hour * 60 + ny.minute;
  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  return totalMinutes >= marketOpen && totalMinutes <= marketClose;
}

function isAfterHoursBar(bar: AggregateBar): boolean {
  const ny = getNyParts(bar.t);
  const totalMinutes = ny.hour * 60 + ny.minute;
  const marketClose = 16 * 60;
  return totalMinutes > marketClose;
}

function getExtendedStripFromBars(): { closePrice: number; closeChangePct: number; afterPrice: number; afterChangePct: number } | null {
  if (selectedRange.label !== "1D" || latestBars.length === 0) {
    return null;
  }

  const currentSessionDate = activeSessionDate ?? getNyParts(latestBars[latestBars.length - 1].t).date;
  const sessionBars = latestBars.filter((bar) => getNyParts(bar.t).date === currentSessionDate);
  if (sessionBars.length === 0) {
    return null;
  }

  const regularBars = sessionBars.filter(isRegularMarketHour);
  const afterHoursBars = sessionBars.filter(isAfterHoursBar);
  if (regularBars.length === 0 || afterHoursBars.length === 0) {
    return null;
  }

  const closeBar = regularBars[regularBars.length - 1];
  const afterBar = afterHoursBars[afterHoursBars.length - 1];
  const firstRegularOpen = regularBars[0].o;

  if (!Number.isFinite(closeBar.c) || !Number.isFinite(afterBar.c) || closeBar.c === 0 || !Number.isFinite(firstRegularOpen) || firstRegularOpen === 0) {
    return null;
  }

  const snapshot = latestSnapshotsByTicker.get(selectedTicker);
  const closeChangePct = snapshot?.change_percent ?? ((closeBar.c - firstRegularOpen) / firstRegularOpen) * 100;
  const afterChangePct = ((afterBar.c - closeBar.c) / closeBar.c) * 100;

  return {
    closePrice: closeBar.c,
    closeChangePct,
    afterPrice: afterBar.c,
    afterChangePct,
  };
}

function selectOneDaySession(bars: AggregateBar[]): { bars: AggregateBar[]; sessionDate: string | null } {
  if (bars.length === 0) {
    return { bars: [], sessionDate: null };
  }

  const grouped = new Map<string, AggregateBar[]>();
  for (const bar of bars) {
    const date = getNyParts(bar.t).date;
    const existing = grouped.get(date) ?? [];
    existing.push(bar);
    grouped.set(date, existing);
  }

  const dates = Array.from(grouped.keys()).sort();
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const date = dates[i];
    const sessionBars = grouped.get(date) ?? [];
    const regular = sessionBars.filter(isRegularMarketHour);
    if (regular.length > 0) {
      // Keep full session bars so pre/post-market can be visualized distinctly.
      return { bars: sessionBars, sessionDate: date };
    }
  }

  const latestDate = dates[dates.length - 1];
  return { bars: grouped.get(latestDate) ?? [], sessionDate: latestDate };
}

function getBarDateRange(): { from: string; to: string } {
  // 1D should prefer the latest US session, including weekends/holidays fallback.
  if (selectedRange.label === "1D") {
    return { from: toNyIsoDate(4), to: toNyIsoDate(0) };
  }

  return {
    from: toNyIsoDate(selectedRange.days),
    to: toNyIsoDate(0),
  };
}

function formatEt(tsMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(tsMs));
}

function formatUtc(tsMs: number): string {
  return new Date(tsMs).toISOString();
}

function clearSessionShading(container: HTMLDivElement): void {
  const existing = container.querySelector(".session-shade-overlay");
  if (existing) {
    existing.remove();
  }
}

function renderSessionShading(chart: IChartApi, container: HTMLDivElement): void {
  let overlay = container.querySelector(".session-shade-overlay") as HTMLDivElement | null;

  if (selectedRange.label !== "1D" || latestBars.length === 0) {
    clearSessionShading(container);
    return;
  }

  const regularBars = latestBars.filter(isRegularMarketHour);
  if (regularBars.length === 0) {
    clearSessionShading(container);
    return;
  }

  const openTs = Math.floor(regularBars[0].t / 1000) as UTCTimestamp;
  const closeTs = Math.floor(regularBars[regularBars.length - 1].t / 1000) as UTCTimestamp;
  const openX = chart.timeScale().timeToCoordinate(openTs);
  const closeX = chart.timeScale().timeToCoordinate(closeTs);
  if (openX === null || closeX === null) {
    clearSessionShading(container);
    return;
  }

  const width = container.clientWidth;
  const leftWidth = clamp(0, width, openX);
  const rightStart = clamp(0, width, closeX);
  const rightWidth = Math.max(0, width - rightStart);

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "session-shade-overlay";

    const left = document.createElement("div");
    left.className = "session-shade-block session-shade-left";

    const right = document.createElement("div");
    right.className = "session-shade-block session-shade-right";

    overlay.append(left, right);
    container.appendChild(overlay);
  }

  const left = overlay.querySelector(".session-shade-left") as HTMLDivElement;
  const right = overlay.querySelector(".session-shade-right") as HTMLDivElement;
  left.style.left = "0px";
  left.style.width = `${leftWidth}px`;
  right.style.left = `${rightStart}px`;
  right.style.width = `${rightWidth}px`;
}

async function fetchBars(
  from: string,
  to: string,
  multiplier: number = selectedRange.multiplier,
  timespan: RangePreset["timespan"] = selectedRange.timespan,
): Promise<AggregateBar[]> {
  try {
    return await invoke<AggregateBar[]>("fetch_polygon_aggregates", {
      ticker: selectedTicker,
      multiplier,
      timespan,
      from,
      to,
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      throw error;
    }
    return [];
  }
}

async function loadWatchlist(): Promise<void> {
  const endRefresh = trackRefreshScope();
  let success = false;

  try {
    if (isApiCooldownActive()) {
      debugLog("watchlist:skipped-cooldown");
      return;
    }

    const snapshots = await invoke<SnapshotItem[]>("fetch_polygon_snapshots", {
      tickers: watchlistSymbols,
    });
    const byTicker = new Map(snapshots.map((item) => [item.ticker, item]));
    latestSnapshotsByTicker = byTicker;
    renderWatchlistRows(byTicker);
    updateHeadline();
    success = true;
  } catch (error) {
    if (isRateLimitError(error)) {
      enterApiCooldown(error);
    }
    renderWatchlistRows();
  } finally {
    endRefresh(success);
  }
}

async function loadBars(): Promise<void> {
  const endRefresh = trackRefreshScope();
  let success = false;
  try {
    if (isApiCooldownActive()) {
      debugLog("loadBars:skipped-cooldown");
      return;
    }

    const { from, to } = getBarDateRange();
    debugLog("loadBars:start", {
      ticker: selectedTicker,
      range: selectedRange.label,
      multiplier: selectedRange.multiplier,
      timespan: selectedRange.timespan,
      from,
      to,
    });

    let bars: AggregateBar[] = [];
    try {
      bars = await fetchBars(from, to);
    } catch (error) {
      if (isRateLimitError(error)) {
        enterApiCooldown(error);
        return;
      }
      throw error;
    }

    if (bars.length === 0) {
      try {
        bars = await fetchBars(toNyIsoDate(14), toNyIsoDate(0));
      } catch (error) {
        if (isRateLimitError(error)) {
          enterApiCooldown(error);
          return;
        }
        throw error;
      }
    }

    if (bars.length === 0 && selectedRange.timespan !== "day") {
      try {
        bars = await fetchBars(toNyIsoDate(Math.max(selectedRange.days, 60)), toNyIsoDate(0), 1, "day");
      } catch (error) {
        if (isRateLimitError(error)) {
          enterApiCooldown(error);
          return;
        }
        throw error;
      }
    }

    if (bars.length === 0) {
      debugLog("loadBars:empty-after-fallbacks");
      return;
    }

    const rawLast = bars[bars.length - 1]?.t;
    if (rawLast) {
      debugLog("loadBars:raw-last", {
        count: bars.length,
        lastEt: formatEt(rawLast),
        lastUtc: formatUtc(rawLast),
      });
    }

    if (selectedRange.label === "1D") {
      const session = selectOneDaySession(bars);
      bars = session.bars;
      activeSessionDate = session.sessionDate;
      const regularCount = bars.filter(isRegularMarketHour).length;
      const afterHoursBars = bars.filter(isAfterHoursBar);
      const afterHoursCount = afterHoursBars.length;
      const afterHoursNonZeroVolume = afterHoursBars.filter((bar) => bar.v > 0).length;
      debugLog("loadBars:1d-session", {
        sessionDate: activeSessionDate,
        count: bars.length,
        regularCount,
        afterHoursCount,
        afterHoursNonZeroVolume,
        firstEt: bars[0] ? formatEt(bars[0].t) : null,
        lastEt: bars[bars.length - 1] ? formatEt(bars[bars.length - 1].t) : null,
      });
    } else {
      activeSessionDate = null;
    }

    latestBars = bars;

    renderCharts();
    updateHeadline();
    success = true;
  } finally {
    endRefresh(success);
  }
}

async function loadNews(): Promise<void> {
  const endRefresh = trackRefreshScope();
  let success = false;

  try {
    const newsGrid = document.querySelector("#news-grid") as HTMLDivElement;
    if (isApiCooldownActive()) {
      debugLog("news:skipped-cooldown");
      newsGrid.innerHTML = `<p class="subtle">Cooling down after rate limit. Retrying shortly.</p>`;
      return;
    }

    const items = await invoke<NewsItem[]>("fetch_polygon_news", {
      ticker: selectedTicker,
      limit: 12,
    });

    newsGrid.innerHTML = items.map((item) => `
      <article class="news-card">
        <div>
          <p class="subtle">${item.source || "News"}</p>
          <h3>${item.title}</h3>
          <p>${item.description || ""}</p>
        </div>
        <a href="${item.article_url}" target="_blank" rel="noreferrer">Read</a>
      </article>
    `).join("");
    success = true;
  } catch (error) {
    const newsGrid = document.querySelector("#news-grid") as HTMLDivElement;
    if (isRateLimitError(error)) {
      enterApiCooldown(error);
      newsGrid.innerHTML = `<p class="subtle">Rate limited by provider. Waiting before retry.</p>`;
      return;
    }
    newsGrid.innerHTML = `<p class="subtle">News is currently unavailable.</p>`;
  } finally {
    endRefresh(success);
  }
}

function disposeCharts(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;

  const priceContainer = document.querySelector("#price-chart") as HTMLDivElement | null;
  const volumeContainer = document.querySelector("#volume-chart") as HTMLDivElement | null;
  if (priceContainer) {
    clearSessionShading(priceContainer);
  }
  if (volumeContainer) {
    clearSessionShading(volumeContainer);
  }

  priceChart?.remove();
  volumeChart?.remove();
  priceChart = null;
  volumeChart = null;

  pushPriceBar = null;
  pushVolumeBar = null;
}

function buildPriceSeries(chart: IChartApi) {
  switch (selectedChartType) {
    case "line":
      return chart.addSeries(LineSeries, {
        color: "#2dd4bf",
        lineWidth: 2,
      });
    case "area":
      return chart.addSeries(AreaSeries, {
        lineColor: "#2dd4bf",
        topColor: "rgba(45,212,191,0.35)",
        bottomColor: "rgba(45,212,191,0.03)",
        lineWidth: 2,
      });
    case "baseline":
      return chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: latestBars[0]?.c ?? 0 },
        topLineColor: "#34d399",
        topFillColor1: "rgba(52,211,153,0.28)",
        topFillColor2: "rgba(52,211,153,0.05)",
        bottomLineColor: "#f87171",
        bottomFillColor1: "rgba(248,113,113,0.22)",
        bottomFillColor2: "rgba(248,113,113,0.05)",
      });
    case "bar":
      return chart.addSeries(BarSeries, {
        upColor: "#34d399",
        downColor: "#f87171",
      });
    default:
      return chart.addSeries(CandlestickSeries, {
        upColor: "#34d399",
        downColor: "#f87171",
        borderVisible: false,
        wickUpColor: "#34d399",
        wickDownColor: "#f87171",
      });
  }
}

function renderCharts(): void {
  const priceContainer = document.querySelector("#price-chart") as HTMLDivElement;
  const volumeContainer = document.querySelector("#volume-chart") as HTMLDivElement;
  if (!priceContainer || !volumeContainer || latestBars.length === 0) {
    return;
  }

  const nextViewKey = currentChartViewKey();
  const previousVisibleRange = priceChart?.timeScale().getVisibleLogicalRange() ?? null;
  if (previousVisibleRange && persistedVisibleRangeKey === nextViewKey) {
    persistedVisibleRange = previousVisibleRange;
  }

  disposeCharts();

  priceChart = createChart(priceContainer, {
    layout: {
      background: { color: "#0b1220" },
      textColor: "#98a2b3",
    },
    grid: {
      vertLines: { color: "rgba(148, 163, 184, 0.08)" },
      horzLines: { color: "rgba(148, 163, 184, 0.08)" },
    },
    rightPriceScale: {
      borderVisible: false,
      minimumWidth: RIGHT_SCALE_WIDTH_PX,
    },
    timeScale: {
      borderVisible: false,
      timeVisible: selectedRange.timespan !== "day",
      tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => formatAxisTime(time, tickMarkType),
    },
    localization: {
      timeFormatter: (time: Time) => formatTooltipTime(time),
    },
    crosshair: {
      vertLine: { color: "rgba(226,232,240,0.35)" },
      horzLine: { color: "rgba(226,232,240,0.35)" },
    },
  });

  volumeChart = createChart(volumeContainer, {
    layout: {
      background: { color: "#0b1220" },
      textColor: "#98a2b3",
    },
    grid: {
      vertLines: { color: "rgba(148, 163, 184, 0.03)" },
      horzLines: { color: "rgba(148, 163, 184, 0.03)" },
    },
    rightPriceScale: {
      borderVisible: false,
      minimumWidth: RIGHT_SCALE_WIDTH_PX,
      scaleMargins: { top: 0.2, bottom: 0.05 },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: selectedRange.timespan !== "day",
      tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => formatAxisTime(time, tickMarkType),
    },
    localization: {
      timeFormatter: (time: Time) => formatTooltipTime(time),
    },
    handleScroll: false,
    handleScale: false,
  });

  const priceSeries = buildPriceSeries(priceChart);
  const volumeSeries = volumeChart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
  });

  const ohlcData = latestBars.map((bar) => ({
    time: Math.floor(bar.t / 1000) as UTCTimestamp,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
  }));

  const lineData = latestBars.map((bar) => ({
    time: Math.floor(bar.t / 1000) as UTCTimestamp,
    value: bar.c,
  }));

  const volumeData = latestBars.map((bar) => ({
    time: Math.floor(bar.t / 1000) as UTCTimestamp,
    value: bar.v,
    color: bar.c >= bar.o ? "rgba(52,211,153,0.82)" : "rgba(248,113,113,0.82)",
  }));

  if (selectedChartType === "candlestick" || selectedChartType === "bar") {
    priceSeries.setData(ohlcData);
    pushPriceBar = (bar) => {
      priceSeries.update({
        time: Math.floor(bar.t / 1000) as UTCTimestamp,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
      });
    };
  } else {
    priceSeries.setData(lineData);
    pushPriceBar = (bar) => {
      priceSeries.update({
        time: Math.floor(bar.t / 1000) as UTCTimestamp,
        value: bar.c,
      });
    };
  }

  volumeSeries.setData(volumeData);
  pushVolumeBar = (bar) => {
    volumeSeries.update({
      time: Math.floor(bar.t / 1000) as UTCTimestamp,
      value: bar.v,
      color: bar.c >= bar.o ? "rgba(52,211,153,0.82)" : "rgba(248,113,113,0.82)",
    });
  };

  if (persistedVisibleRange && persistedVisibleRangeKey === nextViewKey) {
    priceChart.timeScale().setVisibleLogicalRange(persistedVisibleRange);
    volumeChart.timeScale().setVisibleLogicalRange(persistedVisibleRange);
  } else {
    priceChart.timeScale().fitContent();
    volumeChart.timeScale().fitContent();
    persistedVisibleRange = priceChart.timeScale().getVisibleLogicalRange() ?? null;
  }
  persistedVisibleRangeKey = nextViewKey;

  let syncingVisibleRange = false;
  const syncVisibleRange = (from: IChartApi, to: IChartApi) => {
    if (syncingVisibleRange) {
      return;
    }

    const range = from.timeScale().getVisibleLogicalRange();
    if (!range) {
      return;
    }

    syncingVisibleRange = true;
    to.timeScale().setVisibleLogicalRange(range);
    syncingVisibleRange = false;
  };

  let sessionShadeFrame: number | null = null;
  const syncSessionShading = () => {
    if (sessionShadeFrame !== null) {
      return;
    }

    sessionShadeFrame = window.requestAnimationFrame(() => {
      sessionShadeFrame = null;
      if (priceChart) {
        renderSessionShading(priceChart, priceContainer);
      }
      if (volumeChart) {
        renderSessionShading(volumeChart, volumeContainer);
      }
    });
  };

  syncVisibleRange(priceChart, volumeChart);
  syncSessionShading();
  priceChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    if (priceChart && persistedVisibleRangeKey === currentChartViewKey()) {
      persistedVisibleRange = priceChart.timeScale().getVisibleLogicalRange() ?? null;
    }
    if (priceChart && volumeChart) {
      syncVisibleRange(priceChart, volumeChart);
    }
    syncSessionShading();
  });

  const resize = () => {
    priceChart?.resize(priceContainer.clientWidth, priceContainer.clientHeight);
    volumeChart?.resize(volumeContainer.clientWidth, volumeContainer.clientHeight);
    syncSessionShading();
  };

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(priceContainer);
  resizeObserver.observe(volumeContainer);
}

function updateHeadline(): void {
  if (latestBars.length < 2) {
    return;
  }

  const first = latestBars[0].o;
  const last = latestBars[latestBars.length - 1].c;
  const delta = last - first;
  const pct = (delta / first) * 100;

  titleTickerEl.textContent = selectedTicker;
  headlinePriceEl.textContent = fmtNumber(last);
  headlineChangeEl.textContent = `${delta >= 0 ? "+" : ""}${fmtNumber(delta)} (${fmtPct(pct)})`;
  headlineChangeEl.className = `subtle ${delta >= 0 ? "up" : "down"}`;

  const snapshot = latestSnapshotsByTicker.get(selectedTicker);
  const snapshotHasExtended = Number.isFinite(snapshot?.post_market_price)
    && Number.isFinite(snapshot?.post_market_change_percent)
    && Number.isFinite(snapshot?.price)
    && Number.isFinite(snapshot?.change_percent);

  const stripData = snapshotHasExtended
    ? {
      closePrice: snapshot?.price as number,
      closeChangePct: snapshot?.change_percent as number,
      afterPrice: snapshot?.post_market_price as number,
      afterChangePct: snapshot?.post_market_change_percent as number,
    }
    : getExtendedStripFromBars();

  if (!stripData) {
    extendedStripEl.classList.add("hidden");
    return;
  }

  extendedStripEl.classList.remove("hidden");

  closePriceEl.textContent = fmtNumber(stripData.closePrice);
  closeChangeEl.textContent = fmtPct(stripData.closeChangePct);
  closeChangeEl.className = `extended-change subtle ${stripData.closeChangePct >= 0 ? "up" : "down"}`;

  afterPriceEl.textContent = fmtNumber(stripData.afterPrice);
  afterChangeEl.textContent = fmtPct(stripData.afterChangePct);
  afterChangeEl.className = `extended-change subtle ${stripData.afterChangePct >= 0 ? "up" : "down"}`;
}

function renderControls(): void {
  rangeGroupEl.innerHTML = RANGES.map((item) => {
    const active = item.label === selectedRange.label ? "active" : "";
    return `<button class="pill ${active}" data-range="${item.label}">${item.label}</button>`;
  }).join("");

  typeGroupEl.innerHTML = chartTypes.map((type) => {
    const active = type === selectedChartType ? "active" : "";
    return `<button class="pill ${active}" data-type="${type}">${type}</button>`;
  }).join("");
}

function selectedChannel(): "A" | "AM" {
  // AM is the minute aggregate channel and aligns directly with our chart windows.
  return "AM";
}

function aggregateWindowMs(): number {
  if (selectedRange.timespan === "minute") {
    return selectedRange.multiplier * 60_000;
  }
  if (selectedRange.timespan === "hour") {
    return selectedRange.multiplier * 60 * 60_000;
  }
  return selectedRange.multiplier * 24 * 60 * 60_000;
}

function applyLiveAggregate(event: LiveAggregateEvent): void {
  if (event.sym !== selectedTicker || event.s <= 0) {
    return;
  }

  if (selectedRange.label === "1D") {
    const sessionDate = getNyParts(event.s).date;
    if (activeSessionDate && sessionDate !== activeSessionDate) {
      return;
    }
  }

  const windowMs = aggregateWindowMs();
  const bucketStart = Math.floor(event.s / windowMs) * windowMs;
  const incoming: AggregateBar = {
    t: bucketStart,
    o: event.o,
    h: event.h,
    l: event.l,
    c: event.c,
    v: event.v,
  };

  let targetIndex = latestBars.findIndex((bar) => bar.t === bucketStart);
  if (targetIndex < 0) {
    latestBars.push(incoming);
    latestBars.sort((a, b) => a.t - b.t);
    targetIndex = latestBars.findIndex((bar) => bar.t === bucketStart);
  } else {
    const existing = latestBars[targetIndex];
    const shouldReplaceCurrentBar = selectedRange.timespan === "minute" && selectedRange.multiplier === 1;

    latestBars[targetIndex] = {
      t: existing.t,
      o: shouldReplaceCurrentBar ? incoming.o : existing.o,
      h: shouldReplaceCurrentBar ? incoming.h : Math.max(existing.h, incoming.h),
      l: shouldReplaceCurrentBar ? incoming.l : Math.min(existing.l, incoming.l),
      c: incoming.c,
      v: shouldReplaceCurrentBar ? incoming.v : existing.v + incoming.v,
    };
  }

  const lastIndex = latestBars.length - 1;
  if (targetIndex !== lastIndex) {
    return;
  }

  const lastBar = latestBars[lastIndex];
  debugLog("stream:bar-applied", {
    ticker: event.sym,
    eventStartEt: formatEt(event.s),
    eventStartUtc: formatUtc(event.s),
    barEt: formatEt(lastBar.t),
    barUtc: formatUtc(lastBar.t),
    close: lastBar.c,
  });
  pushPriceBar?.(lastBar);
  pushVolumeBar?.(lastBar);
  updateHeadline();
}

async function startStream(): Promise<void> {
  if (isApiCooldownActive()) {
    debugLog("stream:start-skipped-cooldown");
    return;
  }

  debugLog("stream:start", {
    ticker: selectedTicker,
    channel: selectedChannel(),
  });
  await invoke("start_polygon_stream", {
    ticker: selectedTicker,
    channel: selectedChannel(),
  });
}

async function attachAggregateListener(): Promise<void> {
  if (unlistenAggregate) {
    return;
  }

  unlistenAggregate = await listen<LiveAggregateEvent>("polygon-aggregate", (event) => {
    applyLiveAggregate(event.payload);
  });
}

function setupSplitters(): void {
  const shell = document.querySelector(".app-shell") as HTMLDivElement;
  const chartStack = document.querySelector("#chart-stack") as HTMLDivElement;
  const sidebarSplitter = document.querySelector("#sidebar-splitter") as HTMLDivElement;
  const volumeSplitter = document.querySelector("#volume-splitter") as HTMLDivElement;
  const newsSplitter = document.querySelector("#news-splitter") as HTMLDivElement;

  const drag = (move: (x: number, y: number) => void) => (event: PointerEvent) => {
    const onMove = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    event.preventDefault();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  sidebarSplitter.addEventListener(
    "pointerdown",
    drag((x) => {
      const width = Math.max(210, Math.min(420, x));
      shell.style.setProperty("--sidebar-width", `${width}px`);
      prefs.sidebarWidth = width;
      persistPrefs();
    }),
  );

  volumeSplitter.addEventListener(
    "pointerdown",
    drag((_x, y) => {
      const rect = chartStack.getBoundingClientRect();
      const priceHeight = Math.max(220, Math.min(rect.height - 120, y - rect.top));
      chartStack.style.setProperty("--price-pane-height", `${priceHeight}px`);
      prefs.pricePaneHeight = priceHeight;
      persistPrefs();
    }),
  );

  newsSplitter.addEventListener(
    "pointerdown",
    drag((_x, y) => {
      const appRect = shell.getBoundingClientRect();
      const chartHeight = Math.max(320, Math.min(appRect.height - 220, y - appRect.top - 86));
      shell.style.setProperty("--chart-area-height", `${chartHeight}px`);
      prefs.chartAreaHeight = chartHeight;
      persistPrefs();
    }),
  );
}

async function refreshAll(): Promise<void> {
  if (isApiCooldownActive()) {
    debugLog("refreshAll:skipped-cooldown");
    return;
  }

  await Promise.all([loadWatchlist(), loadBars(), loadNews()]);
  await startStream();
}

watchlistEl.addEventListener("click", async (event) => {
  const removeButton = (event.target as HTMLElement).closest("[data-remove-ticker]") as HTMLButtonElement | null;
  if (removeButton) {
    const tickerToRemove = removeButton.dataset.removeTicker;
    if (!tickerToRemove || watchlistSymbols.length <= 1) {
      return;
    }

    watchlistSymbols = watchlistSymbols.filter((ticker) => ticker !== tickerToRemove);
    persistWatchlistSymbols();

    if (tickerToRemove === selectedTicker) {
      ensureSelectedTicker();
      prefs.ticker = selectedTicker;
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
  selectedTicker = button.dataset.ticker ?? selectedTicker;
  prefs.ticker = selectedTicker;
  persistPrefs();
  await refreshAll();
});

watchlistAddFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  const symbol = normalizeTicker(watchlistAddInputEl.value);
  if (!symbol) {
    return;
  }

  watchlistAddInputEl.value = "";

  if (!watchlistSymbols.includes(symbol)) {
    watchlistSymbols = [symbol, ...watchlistSymbols].slice(0, 60);
    persistWatchlistSymbols();
  }

  selectedTicker = symbol;
  prefs.ticker = selectedTicker;
  persistPrefs();
  await refreshAll();
});

rangeGroupEl.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest("[data-range]") as HTMLButtonElement | null;
  if (!button) {
    return;
  }
  const preset = RANGES.find((range) => range.label === button.dataset.range);
  if (!preset) {
    return;
  }
  selectedRange = preset;
  prefs.rangeLabel = selectedRange.label;
  persistPrefs();
  renderControls();
  await loadBars();
  await startStream();
});

typeGroupEl.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest("[data-type]") as HTMLButtonElement | null;
  if (!button) {
    return;
  }
  selectedChartType = (button.dataset.type as ChartType) ?? selectedChartType;
  prefs.chartType = selectedChartType;
  persistPrefs();
  renderControls();
  renderCharts();
});

async function bootstrap(): Promise<void> {
  startRefreshProgressLoop();
  await initStore();
  await restoreWindowLayout();
  await initWindowLayoutPersistence();
  ensureSelectedTicker();
  renderControls();
  setupSplitters();
  await attachAggregateListener();
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
    void loadNews();
  }, 90_000);

  window.setInterval(() => {
    if (isApiCooldownActive()) {
      return;
    }
    void loadBars();
  }, 300_000);
}

window.addEventListener("beforeunload", () => {
  if (windowLayoutSaveTimer !== null) {
    window.clearTimeout(windowLayoutSaveTimer);
    windowLayoutSaveTimer = null;
  }
  void captureWindowLayout();

  if (unlistenWindowMoved) {
    unlistenWindowMoved();
    unlistenWindowMoved = null;
  }
  if (unlistenWindowResized) {
    unlistenWindowResized();
    unlistenWindowResized = null;
  }

  if (refreshProgressRaf !== null) {
    window.cancelAnimationFrame(refreshProgressRaf);
    refreshProgressRaf = null;
  }

  if (unlistenAggregate) {
    unlistenAggregate();
    unlistenAggregate = null;
  }

  void invoke("stop_polygon_stream");
});

void bootstrap();
