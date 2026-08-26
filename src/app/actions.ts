import type { UnlistenFn } from "@tauri-apps/api/event";
import * as api from "./api";
import { pushLiveBars, renderCharts } from "./chartPanel";
import { els } from "./elements";
import { getBarDateRange, selectOneDaySession } from "./market";
import { trackRefreshScope } from "./progress";
import { barsRefreshCadenceMs, loadProviderStatus, updateLagPill } from "./provider";
import {
  currentAggregationPreset,
  debugLog,
  enterApiCooldown,
  isApiCooldownActive,
  persistPrefs,
  state,
} from "./store";
import { renderNewsItems, renderNewsMessage, renderStats, updateHeadline } from "./ui";
import {
  formatEt,
  formatUtc,
  getNyParts,
  isPreMarketBar,
  isRateLimitError,
  isRegularMarketHour,
  toNyIsoDate,
} from "./utils";
import { patchWatchlistRow, renderSparklineSvg, renderWatchlistRows } from "./watchlist";
import type { AggregateBar, LiveBarsEvent } from "./types";

let unlistenLiveBars: UnlistenFn | null = null;
let barsRefreshTimer: number | null = null;

async function fetchBars(
  from: string,
  to: string,
  multiplier?: number,
  timespan?: "minute" | "hour" | "day",
): Promise<AggregateBar[]> {
  const effective = currentAggregationPreset();

  try {
    return await api.fetchAggregates({
      ticker: state.selectedTicker,
      multiplier: multiplier ?? effective.multiplier,
      timespan: timespan ?? effective.timespan,
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

export async function loadWatchlist(): Promise<void> {
  const endRefresh = trackRefreshScope();
  let success = false;

  try {
    if (isApiCooldownActive()) {
      debugLog("watchlist:skipped-cooldown");
      return;
    }

    const snapshots = await api.fetchSnapshots(state.watchlistSymbols);
    state.latestSnapshotsByTicker = new Map(snapshots.map((item) => [item.ticker, item]));
    updateLagPill(state.latestSnapshotsByTicker.get(state.selectedTicker)?.quote_timestamp_ms);
    renderWatchlistRows();
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

export async function loadBars(): Promise<void> {
  const endRefresh = trackRefreshScope();
  let success = false;

  try {
    if (isApiCooldownActive()) {
      debugLog("loadBars:skipped-cooldown");
      return;
    }

    const { from, to } = getBarDateRange(state.selectedRange);
    const effective = currentAggregationPreset();
    debugLog("loadBars:start", {
      ticker: state.selectedTicker,
      range: state.selectedRange.label,
      multiplier: effective.multiplier,
      timespan: effective.timespan,
      from,
      to,
    });

    let bars: AggregateBar[] = [];
    try {
      bars = await fetchBars(from, to);

      if (bars.length === 0) {
        bars = await fetchBars(toNyIsoDate(14), toNyIsoDate(0));
      }

      if (bars.length === 0 && effective.timespan !== "day") {
        bars = await fetchBars(toNyIsoDate(Math.max(state.selectedRange.days, 60)), toNyIsoDate(0), 1, "day");
      }
    } catch (error) {
      if (isRateLimitError(error)) {
        enterApiCooldown(error);
        return;
      }
      throw error;
    }

    if (bars.length === 0) {
      debugLog("loadBars:empty-after-fallbacks");
      return;
    }

    if (state.selectedRange.label === "1D") {
      const session = selectOneDaySession(bars);
      bars = session.bars;
      state.activeSessionDate = session.sessionDate;
      debugLog("loadBars:1d-session", {
        sessionDate: session.sessionDate,
        count: bars.length,
        firstEt: bars[0] ? formatEt(bars[0].t) : null,
        lastEt: bars[bars.length - 1] ? formatEt(bars[bars.length - 1].t) : null,
      });
    } else {
      state.activeSessionDate = null;
    }

    state.latestBars = bars;
    updateLagPill(bars[bars.length - 1]?.t);

    renderCharts();
    updateHeadline();
    success = true;
  } finally {
    endRefresh(success);
  }
}

export async function loadNews(): Promise<void> {
  const endRefresh = trackRefreshScope();
  let success = false;

  try {
    if (isApiCooldownActive()) {
      debugLog("news:skipped-cooldown");
      if (!els.newsGridEl.querySelector(".news-card")) {
        renderNewsMessage("Cooling down after rate limit. Retrying shortly.");
      }
      return;
    }

    const items = await api.fetchNews(state.selectedTicker, 12);
    renderNewsItems(items);
    success = true;
  } catch (error) {
    if (isRateLimitError(error)) {
      enterApiCooldown(error);
      if (!els.newsGridEl.querySelector(".news-card")) {
        renderNewsMessage("Rate limited by provider. Waiting before retry.");
      }
      return;
    }
    renderNewsMessage("News is currently unavailable.");
  } finally {
    endRefresh(success);
  }
}

export async function loadSymbolDetail(): Promise<void> {
  if (isApiCooldownActive()) {
    debugLog("detail:skipped-cooldown");
    return;
  }

  const ticker = state.selectedTicker;
  try {
    const detail = await api.fetchSymbolDetail(ticker);
    if (ticker !== state.selectedTicker) {
      return;
    }

    state.latestSymbolDetail = detail;
    renderStats();
    updateHeadline();
    if (state.latestBars.length > 0) {
      // Re-render so the previous-close reference line can pick up the detail.
      renderCharts();
    }
  } catch (error) {
    if (isRateLimitError(error)) {
      enterApiCooldown(error);
      return;
    }
    debugLog("detail:failed", String(error));
  }
}

export async function loadSparklines(): Promise<void> {
  try {
    if (isApiCooldownActive()) {
      return;
    }

    const items = await api.fetchSparklines(state.watchlistSymbols);
    for (const item of items) {
      state.latestSparklinesByTicker.set(item.ticker, item.prices);
      const rowButton = els.watchlistListEl.querySelector(`[data-ticker="${item.ticker}"]`) as HTMLButtonElement | null;
      if (rowButton) {
        const sparklineEl = rowButton.querySelector(".watch-sparkline") as HTMLDivElement | null;
        const snapshot = state.latestSnapshotsByTicker.get(item.ticker);
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

/**
 * Splices the freshly polled tail of the series into `state.latestBars`.
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

export function applyLiveBars(event: LiveBarsEvent): void {
  if (event.sym !== state.selectedTicker || event.bars.length === 0) {
    return;
  }

  let incoming = event.bars.filter((bar) => bar.t > 0);
  if (state.selectedRange.label === "1D" && state.activeSessionDate) {
    incoming = incoming.filter((bar) => getNyParts(bar.t).date === state.activeSessionDate);
  }

  const changed = spliceLiveBars(state.latestBars, incoming);
  if (changed.length === 0) {
    return;
  }

  const lastBar = state.latestBars[state.latestBars.length - 1];
  const currentSnapshot = state.latestSnapshotsByTicker.get(event.sym);
  if (currentSnapshot) {
    const sessionClose = Number.isFinite(currentSnapshot.price) && currentSnapshot.price > 0
      ? currentSnapshot.price
      : Number.NaN;

    if (isRegularMarketHour(lastBar) || !Number.isFinite(sessionClose)) {
      let previousClose = Number.isFinite(currentSnapshot.previous_close)
        ? (currentSnapshot.previous_close as number)
        : Number.NaN;

      if (!Number.isFinite(previousClose) && Number.isFinite(currentSnapshot.price) && Number.isFinite(currentSnapshot.change_percent)) {
        const denom = 100 + currentSnapshot.change_percent;
        if (Math.abs(denom) > Number.EPSILON) {
          previousClose = (currentSnapshot.price * 100) / denom;
        }
      }

      if ((!Number.isFinite(previousClose) || Math.abs(previousClose) <= Number.EPSILON) && state.latestBars.length >= 1) {
        previousClose = state.latestBars[0].o;
      }

      let liveChangePercent = currentSnapshot.change_percent;
      if (Number.isFinite(previousClose) && Math.abs(previousClose) > Number.EPSILON) {
        liveChangePercent = ((lastBar.c - previousClose) / previousClose) * 100;
      }

      state.latestSnapshotsByTicker.set(event.sym, {
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

      state.latestSnapshotsByTicker.set(event.sym, {
        ...currentSnapshot,
        ...extended,
        quote_timestamp_ms: lastBar.t,
      });
    }

    patchWatchlistRow(event.sym);
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
  pushLiveBars(changed);
  updateHeadline();
}

export async function attachLiveBarsListener(): Promise<void> {
  if (unlistenLiveBars) {
    return;
  }

  unlistenLiveBars = await api.listenLiveBars(applyLiveBars);
}

export function detachLiveBarsListener(): void {
  if (unlistenLiveBars) {
    unlistenLiveBars();
    unlistenLiveBars = null;
  }
}

export async function startStream(): Promise<void> {
  if (isApiCooldownActive()) {
    debugLog("stream:start-skipped-cooldown");
    return;
  }

  const { multiplier, timespan } = currentAggregationPreset();
  debugLog("stream:start", { ticker: state.selectedTicker, multiplier, timespan });
  await api.startLiveStream({ ticker: state.selectedTicker, multiplier, timespan });
  await loadProviderStatus();
  scheduleAdaptiveBarsRefresh();
}

export async function refreshAll(): Promise<void> {
  if (isApiCooldownActive()) {
    debugLog("refreshAll:skipped-cooldown");
    return;
  }

  await Promise.all([loadWatchlist(), loadBars(), loadNews(), loadSymbolDetail()]);
  void loadSparklines();
  await startStream();
}

export async function selectTickerAndRefresh(ticker: string): Promise<void> {
  state.selectedTicker = ticker;
  state.prefs.ticker = ticker;
  persistPrefs();
  renderStats();
  await refreshAll();
}

export function clearAdaptiveBarsRefresh(): void {
  if (barsRefreshTimer !== null) {
    window.clearTimeout(barsRefreshTimer);
    barsRefreshTimer = null;
  }
}

/**
 * Periodic full refetch that repairs history (splits, late volume). The live
 * poller keeps the trailing candle current, so this can afford to be lazy.
 */
export function scheduleAdaptiveBarsRefresh(): void {
  clearAdaptiveBarsRefresh();

  barsRefreshTimer = window.setTimeout(async () => {
    barsRefreshTimer = null;
    if (!isApiCooldownActive()) {
      await Promise.allSettled([loadBars(), loadWatchlist()]);
    }
    scheduleAdaptiveBarsRefresh();
  }, barsRefreshCadenceMs());
}
