import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import type { AggregateBar, ChartType, RangePreset, SnapshotItem } from "./types";
import { clamp, getNyParts, isAfterHoursBar, isPreMarketBar, isRegularMarketHour, toNyIsoDate } from "./utils";

type CandleIntervalOption = {
  key: string;
  multiplier: number;
  timespan: "minute" | "hour" | "day";
};

type ExtendedStrip = {
  closePrice: number;
  closeChangePct: number;
  afterPrice: number;
  afterChangePct: number;
  isPreMarket: boolean;
};

export function isCandleIntervalRelevant(
  selectedChartType: ChartType,
  selectedRange: RangePreset,
): boolean {
  const supportsType = selectedChartType === "candlestick" || selectedChartType === "bar";
  const supportsRange = selectedRange.timespan === "minute";
  return supportsType && supportsRange;
}

export function effectiveAggregationPreset(
  selectedChartType: ChartType,
  selectedRange: RangePreset,
  selectedCandleIntervalKey: string,
  candleIntervalOptions: CandleIntervalOption[],
): { multiplier: number; timespan: "minute" | "hour" | "day" } {
  if (isCandleIntervalRelevant(selectedChartType, selectedRange)) {
    const selected =
      candleIntervalOptions.find((item) => item.key === selectedCandleIntervalKey) ??
      candleIntervalOptions[2];
    return {
      multiplier: selected.multiplier,
      timespan: selected.timespan,
    };
  }

  return {
    multiplier: selectedRange.multiplier,
    timespan: selectedRange.timespan,
  };
}

export function getExtendedStripFromBars(params: {
  selectedRange: RangePreset;
  latestBars: AggregateBar[];
  activeSessionDate: string | null;
  selectedTicker: string;
  latestSnapshotsByTicker: Map<string, SnapshotItem>;
}): ExtendedStrip | null {
  const {
    selectedRange,
    latestBars,
    activeSessionDate,
    selectedTicker,
    latestSnapshotsByTicker,
  } = params;

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

  if (regularBars.length === 0) {
    const preMarketBars = sessionBars.filter(isPreMarketBar);
    if (preMarketBars.length > 0) {
      const snapshot = latestSnapshotsByTicker.get(selectedTicker);
      const closePrice = snapshot?.price;
      const closeChangePct = snapshot?.change_percent;
      const afterBar = preMarketBars[preMarketBars.length - 1];
      if (
        !Number.isFinite(closePrice) ||
        !Number.isFinite(closeChangePct) ||
        !closePrice ||
        !Number.isFinite(afterBar.c) ||
        afterBar.c === 0
      ) {
        return null;
      }
      return {
        closePrice: closePrice as number,
        closeChangePct: closeChangePct as number,
        afterPrice: afterBar.c,
        afterChangePct: ((afterBar.c - (closePrice as number)) / (closePrice as number)) * 100,
        isPreMarket: true,
      };
    }
    return null;
  }

  if (afterHoursBars.length === 0) {
    return null;
  }

  const closeBar = regularBars[regularBars.length - 1];
  const afterBar = afterHoursBars[afterHoursBars.length - 1];
  const firstRegularOpen = regularBars[0].o;

  if (
    !Number.isFinite(afterBar.c) ||
    afterBar.c === 0 ||
    !Number.isFinite(firstRegularOpen) ||
    firstRegularOpen === 0
  ) {
    return null;
  }

  const snapshot = latestSnapshotsByTicker.get(selectedTicker);
  const snapshotClose = snapshot?.price;
  const closePrice =
    Number.isFinite(snapshotClose) && (snapshotClose as number) > 0
      ? (snapshotClose as number)
      : closeBar.c;

  if (!Number.isFinite(closePrice) || closePrice === 0) {
    return null;
  }

  const closeChangePct = Number.isFinite(snapshot?.change_percent)
    ? (snapshot?.change_percent as number)
    : ((closePrice - firstRegularOpen) / firstRegularOpen) * 100;
  const afterChangePct = ((afterBar.c - closePrice) / closePrice) * 100;

  return {
    closePrice,
    closeChangePct,
    afterPrice: afterBar.c,
    afterChangePct,
    isPreMarket: false,
  };
}

export type RegularSession = { openMs: number; closeMs: number };

let sessionCacheKey = "";
let sessionCache: RegularSession[] = [];

/**
 * First/last regular-hours bar per NY trading day, chronological. Memoised on
 * the series identity because shading recomputes on every pan frame.
 */
export function collectRegularSessions(bars: AggregateBar[]): RegularSession[] {
  if (bars.length === 0) {
    return [];
  }

  const key = `${bars.length}:${bars[0].t}:${bars[bars.length - 1].t}`;
  if (key === sessionCacheKey) {
    return sessionCache;
  }

  const sessions: RegularSession[] = [];
  let currentDate = "";
  let openMs = 0;
  let closeMs = 0;

  for (const bar of bars) {
    if (!isRegularMarketHour(bar)) {
      continue;
    }

    const date = getNyParts(bar.t).date;
    if (date !== currentDate) {
      if (currentDate) {
        sessions.push({ openMs, closeMs });
      }
      currentDate = date;
      openMs = bar.t;
    }
    closeMs = bar.t;
  }

  if (currentDate) {
    sessions.push({ openMs, closeMs });
  }

  sessionCacheKey = key;
  sessionCache = sessions;
  return sessions;
}

/**
 * How far back one scroll-triggered history load reaches. Sized so intraday
 * chunks stay inside Yahoo's per-request limits; the per-interval retention
 * floors (1m ~30d, 5-30m ~60d, hourly ~2y) end the backfill with a hard error
 * that callers treat as "no more history".
 */
export function backfillChunkDays(preset: { multiplier: number; timespan: "minute" | "hour" | "day" }): number {
  if (preset.timespan === "minute") {
    return preset.multiplier === 1 ? 5 : 15;
  }
  if (preset.timespan === "hour") {
    return 60;
  }
  return 730;
}

export function getBarDateRange(selectedRange: RangePreset): { from: string; to: string } {
  if (selectedRange.label === "1D") {
    return { from: toNyIsoDate(4), to: toNyIsoDate(0) };
  }

  if (selectedRange.label === "YTD") {
    const nyToday = getNyParts(Date.now()).date;
    return { from: `${nyToday.slice(0, 4)}-01-01`, to: toNyIsoDate(0) };
  }

  return {
    from: toNyIsoDate(selectedRange.days),
    to: toNyIsoDate(0),
  };
}

export function clearSessionShading(container: HTMLDivElement): void {
  const existing = container.querySelector(".session-shade-overlay");
  if (existing) {
    existing.remove();
  }
}

/**
 * Shades everything outside regular trading hours. The series can span many
 * sessions, so the shading is a run of blocks: chart-left to the first visible
 * open, each close-to-next-open gap, and the last close to chart-right.
 */
export function renderSessionShading(params: {
  chart: IChartApi;
  container: HTMLDivElement;
  selectedRange: RangePreset;
  latestBars: AggregateBar[];
}): void {
  const { chart, container, selectedRange, latestBars } = params;

  if (selectedRange.label !== "1D" || latestBars.length === 0) {
    clearSessionShading(container);
    return;
  }

  const timeScale = chart.timeScale();
  const visible = timeScale.getVisibleRange();
  if (!visible || typeof visible.from !== "number" || typeof visible.to !== "number") {
    clearSessionShading(container);
    return;
  }

  const width = container.clientWidth;
  const visibleFromSec = visible.from as number;
  const visibleToSec = visible.to as number;

  // Session boundaries are bar timestamps, so timeToCoordinate resolves them
  // whenever they are on screen; off-screen boundaries clamp to the edges.
  const coordFor = (timestampMs: number): number => {
    const seconds = Math.floor(timestampMs / 1000);
    if (seconds <= visibleFromSec) {
      return 0;
    }
    if (seconds >= visibleToSec) {
      return width;
    }
    const coord = timeScale.timeToCoordinate(seconds as UTCTimestamp);
    if (coord === null) {
      return seconds < (visibleFromSec + visibleToSec) / 2 ? 0 : width;
    }
    return clamp(0, width, coord);
  };

  const blocks: Array<{ left: number; width: number }> = [];
  let cursor = 0;
  for (const session of collectRegularSessions(latestBars)) {
    const openX = coordFor(session.openMs);
    const closeX = coordFor(session.closeMs);
    if (openX > cursor + 0.5) {
      blocks.push({ left: cursor, width: openX - cursor });
    }
    cursor = Math.max(cursor, closeX);
  }
  if (cursor < width - 0.5) {
    blocks.push({ left: cursor, width: width - cursor });
  }

  let overlay = container.querySelector(".session-shade-overlay") as HTMLDivElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "session-shade-overlay";
    container.appendChild(overlay);
  }

  overlay.innerHTML = blocks
    .map((block) =>
      `<div class="session-shade-block" style="left:${block.left.toFixed(1)}px;width:${block.width.toFixed(1)}px"></div>`)
    .join("");
}
