import { createChartController, type ChartController, type VisibleRange } from "./charts";
import { RIGHT_SCALE_WIDTH_PX } from "./constants";
import { els } from "./elements";
import { clearSessionShading, renderSessionShading } from "./market";
import { getStoredVisibleRange, onVisibleRangeChange } from "./prefs";
import { currentAggregationPreset, currentChartResetKey, currentChartViewKey, state } from "./store";
import { getNyParts } from "./utils";
import type { AggregateBar } from "./types";

let controller: ChartController | null = null;

export type ChartPanelOptions = {
  onNeedOlderData?: () => void;
};

export function initChartPanel(options: ChartPanelOptions = {}): void {
  controller = createChartController({
    priceContainer: els.priceChartEl,
    volumeContainer: els.volumeChartEl,
    rightScaleWidthPx: RIGHT_SCALE_WIDTH_PX,
    renderSessionShading: (chart, container) =>
      renderSessionShading({
        chart,
        container,
        selectedRange: state.selectedRange,
        latestBars: state.latestBars,
      }),
    clearSessionShading,
    getStoredVisibleRange,
    onVisibleRangeChange: (viewKey, range) => {
      // 1D always opens on the latest session, so persisting its zoom would
      // only replay a stale window over a series whose length keeps changing.
      if (viewKey.endsWith(":1D")) {
        return;
      }
      onVisibleRangeChange(viewKey, range);
    },
    onNeedOlderData: options.onNeedOlderData,
  });
}

/** Official previous close for the 1D reference line, best source first. */
function previousCloseForChart(): number | null {
  if (state.selectedRange.label !== "1D") {
    return null;
  }

  const snapshot = state.latestSnapshotsByTicker.get(state.selectedTicker);
  const detail = state.latestSymbolDetail?.ticker === state.selectedTicker ? state.latestSymbolDetail : null;

  for (const candidate of [snapshot?.previous_close, detail?.previous_close]) {
    if (Number.isFinite(candidate) && (candidate as number) > 0) {
      return candidate as number;
    }
  }

  if (snapshot && Number.isFinite(snapshot.price) && Number.isFinite(snapshot.change_percent)) {
    const denom = 100 + snapshot.change_percent;
    if (Math.abs(denom) > Number.EPSILON) {
      const derived = (snapshot.price * 100) / denom;
      if (Number.isFinite(derived) && derived > 0) {
        return derived;
      }
    }
  }

  return null;
}

/**
 * The 1D series spans several days so older sessions stay reachable by
 * scrolling, but the opening view should still read as "today": the latest
 * session, padded out with the prior session's tail when the day is young
 * (early pre-market would otherwise be a handful of giant candles).
 */
function defaultViewForOneDay(): VisibleRange | null {
  if (state.selectedRange.label !== "1D") {
    return null;
  }

  const bars = state.latestBars;
  if (bars.length === 0) {
    return null;
  }

  const sessionDate = state.activeSessionDate ?? getNyParts(bars[bars.length - 1].t).date;
  let firstIndex = bars.length - 1;
  while (firstIndex > 0 && getNyParts(bars[firstIndex - 1].t).date === sessionDate) {
    firstIndex -= 1;
  }

  const multiplier = Math.max(1, currentAggregationPreset().multiplier);
  const minWidthBars = Math.round(390 / multiplier);
  let from = firstIndex - 0.5;
  if (bars.length - firstIndex < minWidthBars) {
    from = Math.max(-0.5, bars.length - minWidthBars - 0.5);
  }

  return { from, to: bars.length + 2.5 };
}

export function renderCharts(prependedBars?: number): void {
  controller?.render({
    bars: state.latestBars,
    chartType: state.selectedChartType,
    timespan: currentAggregationPreset().timespan,
    movingAveragePeriods: state.selectedMovingAveragePeriods,
    previousClose: previousCloseForChart(),
    defaultVisibleRange: defaultViewForOneDay(),
    prependedBars,
    viewKey: currentChartViewKey(),
    resetKey: currentChartResetKey(),
  });
}

export function pushLiveBars(bars: AggregateBar[]): void {
  controller?.applyLiveBars(bars);
}

export function getVisibleLogicalRange(): VisibleRange | null {
  return controller?.getVisibleLogicalRange() ?? null;
}

export function disposeCharts(): void {
  controller?.dispose();
  controller = null;
}
