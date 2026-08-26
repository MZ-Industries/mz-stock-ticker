import { createChartController, type ChartController, type VisibleRange } from "./charts";
import { RIGHT_SCALE_WIDTH_PX } from "./constants";
import { els } from "./elements";
import { clearSessionShading, renderSessionShading } from "./market";
import { getStoredVisibleRange, onVisibleRangeChange } from "./prefs";
import { currentAggregationPreset, currentChartResetKey, currentChartViewKey, state } from "./store";
import type { AggregateBar } from "./types";

let controller: ChartController | null = null;

export function initChartPanel(): void {
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
    onVisibleRangeChange,
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

export function renderCharts(): void {
  controller?.render({
    bars: state.latestBars,
    chartType: state.selectedChartType,
    timespan: currentAggregationPreset().timespan,
    movingAveragePeriods: state.selectedMovingAveragePeriods,
    previousClose: previousCloseForChart(),
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
