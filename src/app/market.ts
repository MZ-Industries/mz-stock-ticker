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

export function selectOneDaySession(bars: AggregateBar[]): { bars: AggregateBar[]; sessionDate: string | null } {
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
  const latestDate = dates[dates.length - 1];
  const latestSessionBars = grouped.get(latestDate) ?? [];
  const latestRegularCount = latestSessionBars.filter(isRegularMarketHour).length;
  if (latestSessionBars.length > 0 && latestRegularCount === 0) {
    return { bars: latestSessionBars, sessionDate: latestDate };
  }

  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const date = dates[i];
    const sessionBars = grouped.get(date) ?? [];
    const regular = sessionBars.filter(isRegularMarketHour);
    if (regular.length > 0) {
      return { bars: sessionBars, sessionDate: date };
    }
  }

  return { bars: grouped.get(latestDate) ?? [], sessionDate: latestDate };
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

export function renderSessionShading(params: {
  chart: IChartApi;
  container: HTMLDivElement;
  selectedRange: RangePreset;
  latestBars: AggregateBar[];
}): void {
  const { chart, container, selectedRange, latestBars } = params;

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
