import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { patchWatchlistRow, renderSparklineSvg, renderWatchlistRows } from "./watchlist";
import { formatEt, formatUtc, isAfterHoursBar, isPreMarketBar, isRateLimitError, isRegularMarketHour, toNyIsoDate } from "./utils";
import type { AggregateBar, LiveBarsEvent, NewsItem, RangePreset, SnapshotItem, SparklineItem } from "./types";

export async function fetchBarsAction(params: {
  selectedTicker: string;
  from: string;
  to: string;
  multiplier: number;
  timespan: RangePreset["timespan"];
}): Promise<AggregateBar[]> {
  const { selectedTicker, from, to, multiplier, timespan } = params;

  try {
    return await invoke<AggregateBar[]>("fetch_aggregates", {
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

export async function loadWatchlistAction(params: {
  isApiCooldownActive: () => boolean;
  debugLog: (message: string, data?: unknown) => void;
  watchlistSymbols: string[];
  selectedTicker: string;
  latestSparklinesByTicker: Map<string, number[]>;
  trackRefreshScope: () => (success: boolean) => void;
  enterApiCooldown: (error: unknown) => void;
  updateLagPill: (referenceMs?: number) => void;
  setLatestSnapshotsByTicker: (map: Map<string, SnapshotItem>) => void;
  updateHeadline: () => void;
  watchlistListEl: HTMLDivElement;
}): Promise<void> {
  const {
    isApiCooldownActive,
    debugLog,
    watchlistSymbols,
    selectedTicker,
    latestSparklinesByTicker,
    trackRefreshScope,
    enterApiCooldown,
    updateLagPill,
    setLatestSnapshotsByTicker,
    updateHeadline,
    watchlistListEl,
  } = params;

  const endRefresh = trackRefreshScope();
  let success = false;

  try {
    if (isApiCooldownActive()) {
      debugLog("watchlist:skipped-cooldown");
      return;
    }

    const snapshots = await invoke<SnapshotItem[]>("fetch_snapshots", {
      tickers: watchlistSymbols,
    });
    const byTicker = new Map(snapshots.map((item) => [item.ticker, item]));
    setLatestSnapshotsByTicker(byTicker);
    updateLagPill(byTicker.get(selectedTicker)?.quote_timestamp_ms);
    renderWatchlistRows(watchlistListEl, watchlistSymbols, selectedTicker, latestSparklinesByTicker, byTicker);
    updateHeadline();
    success = true;
  } catch (error) {
    if (isRateLimitError(error)) {
      enterApiCooldown(error);
    }
    renderWatchlistRows(watchlistListEl, watchlistSymbols, selectedTicker, latestSparklinesByTicker);
  } finally {
    endRefresh(success);
  }
}

export async function loadBarsAction(params: {
  isApiCooldownActive: () => boolean;
  debugLog: (message: string, data?: unknown) => void;
  selectedTicker: string;
  selectedRange: RangePreset;
  effectiveAggregationPreset: () => { multiplier: number; timespan: "minute" | "hour" | "day" };
  getBarDateRange: () => { from: string; to: string };
  fetchBars: (from: string, to: string, multiplier?: number, timespan?: RangePreset["timespan"]) => Promise<AggregateBar[]>;
  trackRefreshScope: () => (success: boolean) => void;
  enterApiCooldown: (error: unknown) => void;
  selectOneDaySession: (bars: AggregateBar[]) => { bars: AggregateBar[]; sessionDate: string | null };
  setActiveSessionDate: (value: string | null) => void;
  setLatestBars: (bars: AggregateBar[]) => void;
  updateLagPill: (referenceMs?: number) => void;
  renderCharts: () => void;
  updateHeadline: () => void;
}): Promise<void> {
  const {
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
    setActiveSessionDate,
    setLatestBars,
    updateLagPill,
    renderCharts,
    updateHeadline,
  } = params;

  const endRefresh = trackRefreshScope();
  let success = false;

  try {
    if (isApiCooldownActive()) {
      debugLog("loadBars:skipped-cooldown");
      return;
    }

    const { from, to } = getBarDateRange();
    const effective = effectiveAggregationPreset();
    debugLog("loadBars:start", {
      ticker: selectedTicker,
      range: selectedRange.label,
      multiplier: effective.multiplier,
      timespan: effective.timespan,
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

    if (bars.length === 0 && effective.timespan !== "day") {
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
      setActiveSessionDate(session.sessionDate);
      const regularCount = bars.filter(isRegularMarketHour).length;
      const afterHoursBars = bars.filter(isAfterHoursBar);
      const afterHoursCount = afterHoursBars.length;
      const afterHoursNonZeroVolume = afterHoursBars.filter((bar) => bar.v > 0).length;
      const afterHoursVolumeSample = afterHoursBars.slice(-12).map((bar) => ({
        et: formatEt(bar.t),
        close: bar.c,
        volume: bar.v,
      }));
      const afterHoursVolumeMax = afterHoursBars.reduce((max, bar) => Math.max(max, bar.v), 0);
      debugLog("loadBars:1d-session", {
        sessionDate: session.sessionDate,
        count: bars.length,
        regularCount,
        afterHoursCount,
        afterHoursNonZeroVolume,
        afterHoursVolumeMax,
        afterHoursVolumeSample,
        firstEt: bars[0] ? formatEt(bars[0].t) : null,
        lastEt: bars[bars.length - 1] ? formatEt(bars[bars.length - 1].t) : null,
      });
    } else {
      setActiveSessionDate(null);
    }

    setLatestBars(bars);
    updateLagPill(bars[bars.length - 1]?.t);

    renderCharts();
    updateHeadline();
    success = true;
  } finally {
    endRefresh(success);
  }
}

export async function loadNewsAction(params: {
  selectedTicker: string;
  isApiCooldownActive: () => boolean;
  debugLog: (message: string, data?: unknown) => void;
  trackRefreshScope: () => (success: boolean) => void;
  enterApiCooldown: (error: unknown) => void;
}): Promise<void> {
  const {
    selectedTicker,
    isApiCooldownActive,
    debugLog,
    trackRefreshScope,
    enterApiCooldown,
  } = params;

  const endRefresh = trackRefreshScope();
  let success = false;

  try {
    const newsGrid = document.querySelector("#news-grid") as HTMLDivElement;
    if (isApiCooldownActive()) {
      debugLog("news:skipped-cooldown");
      newsGrid.innerHTML = `<p class="subtle">Cooling down after rate limit. Retrying shortly.</p>`;
      return;
    }

    const items = await invoke<NewsItem[]>("fetch_news", {
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

/**
 * Splices the freshly polled tail of the series into `latestBars`.
 *
 * The backend polls the same interval the chart is drawing, so candles arrive
 * ready to use - no bucketing, no volume accounting. Yahoo keeps revising the
 * newest candles, so a bar that already exists is replaced outright rather than
 * merged.
 *
 * Returns the bars that actually changed, oldest first.
 */
function spliceLiveBars(latestBars: AggregateBar[], incoming: AggregateBar[]): AggregateBar[] {
  const changed: AggregateBar[] = [];
  const ordered = [...incoming].sort((a, b) => a.t - b.t);

  for (const bar of ordered) {
    const index = latestBars.findIndex((existing) => existing.t === bar.t);

    if (index >= 0) {
      const existing = latestBars[index];
      const unchanged = existing.o === bar.o
        && existing.h === bar.h
        && existing.l === bar.l
        && existing.c === bar.c
        && existing.v === bar.v;
      if (unchanged) {
        continue;
      }
      latestBars[index] = bar;
      changed.push(bar);
      continue;
    }

    const lastBar = latestBars.length > 0 ? latestBars[latestBars.length - 1] : null;
    if (lastBar && bar.t < lastBar.t) {
      // Older than anything we hold and not a match - the periodic refetch owns it.
      continue;
    }

    latestBars.push(bar);
    changed.push(bar);
  }

  return changed;
}

export function applyLiveBarsAction(params: {
  event: LiveBarsEvent;
  selectedTicker: string;
  selectedRangeLabel: string;
  activeSessionDate: string | null;
  getSessionDate: (timestampMs: number) => string;
  latestBars: AggregateBar[];
  latestSnapshotsByTicker: Map<string, SnapshotItem>;
  latestSparklinesByTicker: Map<string, number[]>;
  watchlistListEl: HTMLDivElement;
  debugLog: (message: string, data?: unknown) => void;
  updateLagPill: (referenceMs?: number) => void;
  updateHeadline: () => void;
  pushBars: (bars: AggregateBar[]) => void;
}): void {
  const {
    event,
    selectedTicker,
    selectedRangeLabel,
    activeSessionDate,
    getSessionDate,
    latestBars,
    latestSnapshotsByTicker,
    latestSparklinesByTicker,
    watchlistListEl,
    debugLog,
    updateLagPill,
    updateHeadline,
    pushBars,
  } = params;

  if (event.sym !== selectedTicker || event.bars.length === 0) {
    return;
  }

  let incoming = event.bars.filter((bar) => bar.t > 0);
  if (selectedRangeLabel === "1D" && activeSessionDate) {
    incoming = incoming.filter((bar) => getSessionDate(bar.t) === activeSessionDate);
  }

  const changed = spliceLiveBars(latestBars, incoming);
  if (changed.length === 0) {
    return;
  }

  const lastBar = latestBars[latestBars.length - 1];
  const currentSnapshot = latestSnapshotsByTicker.get(event.sym);
  if (currentSnapshot) {
    const sessionClose = Number.isFinite(currentSnapshot.price) && currentSnapshot.price > 0
      ? currentSnapshot.price
      : Number.NaN;

    if (isRegularMarketHour(lastBar) || !Number.isFinite(sessionClose)) {
      let previousClose = Number.NaN;
      if (Number.isFinite(currentSnapshot.price) && Number.isFinite(currentSnapshot.change_percent)) {
        const denom = 100 + currentSnapshot.change_percent;
        if (Math.abs(denom) > Number.EPSILON) {
          previousClose = (currentSnapshot.price * 100) / denom;
        }
      }

      if ((!Number.isFinite(previousClose) || Math.abs(previousClose) <= Number.EPSILON) && latestBars.length >= 1) {
        previousClose = latestBars[0].o;
      }

      let liveChangePercent = currentSnapshot.change_percent;
      if (Number.isFinite(previousClose) && Math.abs(previousClose) > Number.EPSILON) {
        liveChangePercent = ((lastBar.c - previousClose) / previousClose) * 100;
      }

      latestSnapshotsByTicker.set(event.sym, {
        ...currentSnapshot,
        price: lastBar.c,
        change_percent: liveChangePercent,
        quote_timestamp_ms: lastBar.t,
      });
    } else {
      // Outside the regular session `price` is the official close, and the headline
      // shows it as the headline number with the extended-hours quote underneath.
      // Writing the extended price over it collapses that into one number and makes
      // the extended change read as 0%.
      const changeFromClose = ((lastBar.c - sessionClose) / sessionClose) * 100;
      const extended = isPreMarketBar(lastBar)
        ? { pre_market_price: lastBar.c, pre_market_change_percent: changeFromClose }
        : { post_market_price: lastBar.c, post_market_change_percent: changeFromClose };

      latestSnapshotsByTicker.set(event.sym, {
        ...currentSnapshot,
        ...extended,
        quote_timestamp_ms: lastBar.t,
      });
    }

    patchWatchlistRow(watchlistListEl, event.sym, latestSnapshotsByTicker, latestSparklinesByTicker);
  }

  debugLog("stream:bars-applied", {
    ticker: event.sym,
    changed: changed.length,
    newestEt: formatEt(lastBar.t),
    newestUtc: formatUtc(lastBar.t),
    close: lastBar.c,
    volume: lastBar.v,
  });

  updateLagPill(lastBar.t);
  // lightweight-charts follows real time on its own when the last bar is visible.
  pushBars(changed);
  updateHeadline();
}

export async function startStreamAction(params: {
  isApiCooldownActive: () => boolean;
  debugLog: (message: string, data?: unknown) => void;
  selectedTicker: string;
  effectiveAggregationPreset: () => { multiplier: number; timespan: "minute" | "hour" | "day" };
  loadProviderStatus: () => Promise<void>;
}): Promise<void> {
  const {
    isApiCooldownActive,
    debugLog,
    selectedTicker,
    effectiveAggregationPreset,
    loadProviderStatus,
  } = params;

  if (isApiCooldownActive()) {
    debugLog("stream:start-skipped-cooldown");
    return;
  }

  const { multiplier, timespan } = effectiveAggregationPreset();
  debugLog("stream:start", { ticker: selectedTicker, multiplier, timespan });
  await invoke("start_live_stream", { ticker: selectedTicker, multiplier, timespan });
  await loadProviderStatus();
}

export async function attachLiveBarsListenerAction(params: {
  unlistenLiveBars: (() => void) | null;
  setUnlistenLiveBars: (value: (() => void) | null) => void;
  applyLiveBars: (event: LiveBarsEvent) => void;
}): Promise<void> {
  const { unlistenLiveBars, setUnlistenLiveBars, applyLiveBars } = params;

  if (unlistenLiveBars) {
    return;
  }

  const unlisten = await listen<LiveBarsEvent>("live-bars", (event) => {
    applyLiveBars(event.payload);
  });
  setUnlistenLiveBars(unlisten);
}

export async function loadSparklinesAction(params: {
  isApiCooldownActive: () => boolean;
  watchlistSymbols: string[];
  latestSparklinesByTicker: Map<string, number[]>;
  latestSnapshotsByTicker: Map<string, SnapshotItem>;
  watchlistListEl: HTMLDivElement;
  debugLog: (message: string, data?: unknown) => void;
}): Promise<void> {
  const {
    isApiCooldownActive,
    watchlistSymbols,
    latestSparklinesByTicker,
    latestSnapshotsByTicker,
    watchlistListEl,
    debugLog,
  } = params;

  try {
    if (isApiCooldownActive()) {
      return;
    }
    const items = await invoke<SparklineItem[]>("fetch_sparklines", {
      tickers: watchlistSymbols,
    });
    for (const item of items) {
      latestSparklinesByTicker.set(item.ticker, item.prices);
      const rowButton = watchlistListEl.querySelector(`[data-ticker="${item.ticker}"]`) as HTMLButtonElement | null;
      if (rowButton) {
        const sparklineEl = rowButton.querySelector(".watch-sparkline") as HTMLDivElement | null;
        const snapshot = latestSnapshotsByTicker.get(item.ticker);
        const isPositive = (snapshot?.change_percent ?? 0) >= 0;
        if (sparklineEl && item.prices.length >= 2) {
          sparklineEl.innerHTML = renderSparklineSvg(item.prices, isPositive);
        }
      }
    }
  } catch (error) {
    debugLog("sparklines:failed", String(error));
  }
}

export async function refreshAllAction(params: {
  isApiCooldownActive: () => boolean;
  debugLog: (message: string, data?: unknown) => void;
  loadWatchlist: () => Promise<void>;
  loadBars: () => Promise<void>;
  loadNews: () => Promise<void>;
  loadSparklines: () => Promise<void>;
  startStream: () => Promise<void>;
}): Promise<void> {
  const {
    isApiCooldownActive,
    debugLog,
    loadWatchlist,
    loadBars,
    loadNews,
    loadSparklines,
    startStream,
  } = params;

  if (isApiCooldownActive()) {
    debugLog("refreshAll:skipped-cooldown");
    return;
  }

  await Promise.all([loadWatchlist(), loadBars(), loadNews()]);
  void loadSparklines();
  await startStream();
}

export async function selectTickerAndRefreshAction(params: {
  ticker: string;
  setSelectedTicker: (ticker: string) => void;
  setPrefsTicker: (ticker: string) => void;
  persistPrefs: () => void;
  refreshAll: () => Promise<void>;
}): Promise<void> {
  const {
    ticker,
    setSelectedTicker,
    setPrefsTicker,
    persistPrefs,
    refreshAll,
  } = params;

  setSelectedTicker(ticker);
  setPrefsTicker(ticker);
  persistPrefs();
  await refreshAll();
}
