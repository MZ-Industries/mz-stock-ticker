import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineWidth,
  type MouseEventParams,
  type SeriesType,
  type TickMarkType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { clamp, fmtCompact, fmtNumber, formatAxisTime, formatTooltipTime, getNyParts } from "./utils";
import type { AggregateBar, ChartType, RangePreset } from "./types";

export type VisibleRange = { from: number; to: number };

const MOVING_AVERAGE_COLORS = ["#60a5fa", "#f59e0b", "#a78bfa", "#fb7185"] as const;

// Logical-range deltas below this are sub-pixel. Mirroring them between the two
// charts would just bounce rounding noise back and forth forever.
const RANGE_SYNC_EPSILON = 1e-4;

// Scrolling to within this many bars of the data's left edge asks for older
// history. The suppression window keeps a programmatic view reset (fitContent,
// restored zoom) from looking like the user scrolled back.
const BACKFILL_TRIGGER_BARS = 15;
const VIEW_RESET_SUPPRESS_MS = 1500;

const UP_COLOR = "#34d399";
const DOWN_COLOR = "#f87171";

export type ChartControllerDeps = {
  priceContainer: HTMLDivElement;
  volumeContainer: HTMLDivElement;
  rightScaleWidthPx: number;
  renderSessionShading: (chart: IChartApi, container: HTMLDivElement) => void;
  clearSessionShading: (container: HTMLDivElement) => void;
  getStoredVisibleRange: (viewKey: string) => VisibleRange | null;
  onVisibleRangeChange: (viewKey: string, range: VisibleRange) => void;
  /** Fired when the user scrolls close to the oldest loaded bar. */
  onNeedOlderData?: () => void;
};

export type ChartRenderRequest = {
  bars: AggregateBar[];
  chartType: ChartType;
  timespan: RangePreset["timespan"];
  movingAveragePeriods: number[];
  /** Official previous close; drawn as a dashed reference line when set. */
  previousClose: number | null;
  /**
   * Initial window to show when no better view applies (e.g. 1D shows the
   * latest session even though the series holds several days). When set it
   * takes precedence over any stored visible range.
   */
  defaultVisibleRange: VisibleRange | null;
  /**
   * Number of bars prepended since the previous render. The visible window is
   * shifted by this amount so the user keeps looking at the same candles while
   * older history streams in behind them.
   */
  prependedBars?: number;
  /** Key the saved visible range is stored under (ticker + range preset). */
  viewKey: string;
  /**
   * Changing this means the bars now describe a different slice of time, so the
   * saved view is re-applied. Everything else (new candles, chart type, moving
   * averages) is folded into the existing charts without touching the time scale.
   */
  resetKey: string;
};

export type ChartController = {
  render: (request: ChartRenderRequest) => void;
  applyLiveBars: (bars: AggregateBar[]) => void;
  getVisibleLogicalRange: () => VisibleRange | null;
  dispose: () => void;
};

function usesOhlcData(chartType: ChartType): boolean {
  return chartType === "candlestick" || chartType === "bar";
}

function toSeconds(bar: AggregateBar): UTCTimestamp {
  return Math.floor(bar.t / 1000) as UTCTimestamp;
}

function volumeColor(bar: AggregateBar): string {
  return bar.c >= bar.o ? "rgba(52,211,153,0.82)" : "rgba(248,113,113,0.82)";
}

function buildMovingAverageData(bars: AggregateBar[], period: number): Array<{ time: UTCTimestamp; value: number }> {
  if (period < 2 || bars.length < period) {
    return [];
  }

  const points: Array<{ time: UTCTimestamp; value: number }> = [];
  let rolling = 0;

  for (let index = 0; index < bars.length; index += 1) {
    rolling += bars[index].c;
    if (index >= period) {
      rolling -= bars[index - period].c;
    }

    if (index >= period - 1) {
      points.push({ time: toSeconds(bars[index]), value: rolling / period });
    }
  }

  return points;
}

function movingAverageAt(bars: AggregateBar[], index: number, period: number): number | null {
  if (index + 1 < period) {
    return null;
  }

  let sum = 0;
  for (let cursor = index; cursor > index - period; cursor -= 1) {
    sum += bars[cursor].c;
  }

  return sum / period;
}

function normalizeMovingAveragePeriods(periods: number[]): number[] {
  return [...new Set(periods)]
    .filter((period) => Number.isInteger(period) && period > 1)
    .sort((a, b) => a - b);
}

function addPriceSeries(chart: IChartApi, chartType: ChartType, bars: AggregateBar[]): ISeriesApi<SeriesType> {
  switch (chartType) {
    case "line":
      return chart.addSeries(LineSeries, { color: "#2dd4bf", lineWidth: 2 });
    case "area":
      return chart.addSeries(AreaSeries, {
        lineColor: "#2dd4bf",
        topColor: "rgba(45,212,191,0.35)",
        bottomColor: "rgba(45,212,191,0.03)",
        lineWidth: 2,
      });
    case "baseline":
      return chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: bars[0]?.c ?? 0 },
        topLineColor: UP_COLOR,
        topFillColor1: "rgba(52,211,153,0.28)",
        topFillColor2: "rgba(52,211,153,0.05)",
        bottomLineColor: DOWN_COLOR,
        bottomFillColor1: "rgba(248,113,113,0.22)",
        bottomFillColor2: "rgba(248,113,113,0.05)",
      });
    case "bar":
      return chart.addSeries(BarSeries, { upColor: UP_COLOR, downColor: DOWN_COLOR });
    default:
      return chart.addSeries(CandlestickSeries, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderVisible: false,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
      });
  }
}

/**
 * Owns the price and volume charts.
 *
 * Deliberately has no auto-scroll logic of its own: lightweight-charts already
 * shifts the visible range when a bar is appended *and the last bar is on
 * screen* (`shiftVisibleRangeOnNewBar`), which is exactly the behaviour we want.
 * Anything we add on top can only fire in the cases the library declined to
 * shift — i.e. when the user has deliberately scrolled away from real time.
 */
export function createChartController(deps: ChartControllerDeps): ChartController {
  const {
    priceContainer,
    volumeContainer,
    rightScaleWidthPx,
    renderSessionShading,
    clearSessionShading,
    getStoredVisibleRange,
    onVisibleRangeChange,
  } = deps;

  let priceChart: IChartApi | null = null;
  let volumeChart: IChartApi | null = null;
  let priceSeries: ISeriesApi<SeriesType> | null = null;
  let volumeSeries: ISeriesApi<"Histogram"> | null = null;
  const movingAverageSeries = new Map<number, ISeriesApi<"Line">>();
  const movingAverageAppliedStyle = new Map<number, string>();
  let resizeObserver: ResizeObserver | null = null;

  let bars: AggregateBar[] = [];
  let chartType: ChartType = "candlestick";
  let timespan: RangePreset["timespan"] = "minute";
  let viewKey = "";
  let resetKey: string | null = null;
  let newestSeriesTime: UTCTimestamp | null = null;
  let shadingFrame: number | null = null;
  let previousClose: number | null = null;
  let previousCloseLine: IPriceLine | null = null;
  let legendEl: HTMLDivElement | null = null;
  let defaultVisibleRange: VisibleRange | null = null;
  let lastViewResetAtMs = 0;
  let multiDayView = false;

  const maybeRequestOlderData = (range: VisibleRange | null): void => {
    if (!range || bars.length === 0 || !deps.onNeedOlderData) {
      return;
    }
    if (Date.now() - lastViewResetAtMs < VIEW_RESET_SUPPRESS_MS) {
      return;
    }
    if (range.from > BACKFILL_TRIGGER_BARS) {
      return;
    }
    deps.onNeedOlderData();
  };

  const renderLegend = (index: number): void => {
    if (!legendEl) {
      return;
    }

    const bar = bars[index];
    if (!bar) {
      legendEl.innerHTML = "";
      return;
    }

    const base = index > 0 ? bars[index - 1].c : bar.o;
    const pct = Math.abs(base) > Number.EPSILON ? ((bar.c - base) / base) * 100 : 0;
    const cls = bar.c >= base ? "up" : "down";
    const showOhlc = usesOhlcData(chartType);

    legendEl.innerHTML = showOhlc
      ? `<span>O <b>${fmtNumber(bar.o)}</b></span>`
        + `<span>H <b>${fmtNumber(bar.h)}</b></span>`
        + `<span>L <b>${fmtNumber(bar.l)}</b></span>`
        + `<span>C <b class="${cls}">${fmtNumber(bar.c)}</b></span>`
        + `<span class="${cls}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>`
        + `<span>Vol <b>${fmtCompact(bar.v)}</b></span>`
      : `<span><b class="${cls}">${fmtNumber(bar.c)}</b></span>`
        + `<span class="${cls}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>`
        + `<span>Vol <b>${fmtCompact(bar.v)}</b></span>`;
  };

  const renderLegendForCrosshair = (param: MouseEventParams): void => {
    if (typeof param.time !== "number") {
      renderLegend(bars.length - 1);
      return;
    }

    const timestampMs = param.time * 1000;
    const index = bars.findIndex((bar) => bar.t === timestampMs);
    renderLegend(index >= 0 ? index : bars.length - 1);
  };

  const syncPreviousCloseLine = (): void => {
    if (!priceSeries) {
      return;
    }

    if (previousCloseLine) {
      priceSeries.removePriceLine(previousCloseLine);
      previousCloseLine = null;
    }

    if (previousClose !== null && Number.isFinite(previousClose) && previousClose > 0) {
      previousCloseLine = priceSeries.createPriceLine({
        price: previousClose,
        color: "rgba(148, 163, 184, 0.55)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "prev close",
      });
    }
  };

  const scheduleShading = (): void => {
    if (shadingFrame !== null || !priceChart || !volumeChart) {
      return;
    }

    shadingFrame = window.requestAnimationFrame(() => {
      shadingFrame = null;
      if (!priceChart || !volumeChart) {
        return;
      }
      renderSessionShading(priceChart, priceContainer);
      renderSessionShading(volumeChart, volumeContainer);
    });
  };

  const timeAxisOptions = () => ({
    timeScale: {
      borderVisible: false,
      timeVisible: timespan !== "day",
      tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
        formatAxisTime(time, tickMarkType, timespan, multiDayView),
    },
    localization: {
      timeFormatter: (time: Time) => formatTooltipTime(time, timespan),
    },
  });

  /**
   * Intra-day tick labels carry their date ("Aug 28 14:30") whenever the
   * visible window spans more than one New York calendar day, because a bare
   * clock time is ambiguous with several sessions on screen. The formatter
   * can't see the visible range, so the flag is tracked here - and a flip has
   * to re-apply the axis options, which is what flushes lightweight-charts'
   * cache of already-formatted tick labels.
   */
  const syncMultiDayView = (range: VisibleRange | null): void => {
    if (!priceChart || !volumeChart || !range || bars.length === 0) {
      return;
    }

    const lastIndex = bars.length - 1;
    const firstVisible = bars[clamp(0, lastIndex, Math.round(range.from))];
    const lastVisible = bars[clamp(0, lastIndex, Math.round(range.to))];
    const multiDay = getNyParts(firstVisible.t).date !== getNyParts(lastVisible.t).date;

    if (multiDay !== multiDayView) {
      multiDayView = multiDay;
      priceChart.applyOptions(timeAxisOptions());
      volumeChart.applyOptions(timeAxisOptions());
    }
  };

  const mirrorRange = (source: IChartApi, target: IChartApi): void => {
    const range = source.timeScale().getVisibleLogicalRange();
    if (!range) {
      return;
    }

    // No "ignore the next event" flag here on purpose: lightweight-charts applies
    // setVisibleLogicalRange on the next animation frame, so a one-shot flag set
    // now can just as easily swallow a real user gesture that lands in between.
    // Comparing values instead is self-terminating - once the two charts agree,
    // the echo stops.
    const targetRange = target.timeScale().getVisibleLogicalRange();
    const inSync = targetRange !== null
      && Math.abs(range.from - targetRange.from) <= RANGE_SYNC_EPSILON
      && Math.abs(range.to - targetRange.to) <= RANGE_SYNC_EPSILON;

    if (!inSync) {
      target.timeScale().setVisibleLogicalRange(range);
    }

    onVisibleRangeChange(viewKey, range);
    scheduleShading();
  };

  const createCharts = (): void => {
    priceChart = createChart(priceContainer, {
      layout: {
        attributionLogo: false,
        background: { color: "#0b1220" },
        textColor: "#98a2b3",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: { borderVisible: false, minimumWidth: rightScaleWidthPx },
      crosshair: {
        vertLine: { color: "rgba(226,232,240,0.35)" },
        horzLine: { color: "rgba(226,232,240,0.35)" },
      },
      ...timeAxisOptions(),
    });

    volumeChart = createChart(volumeContainer, {
      layout: {
        attributionLogo: false,
        background: { color: "#0b1220" },
        textColor: "#98a2b3",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.03)" },
        horzLines: { color: "rgba(148, 163, 184, 0.03)" },
      },
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: rightScaleWidthPx,
        scaleMargins: { top: 0.2, bottom: 0.05 },
      },
      ...timeAxisOptions(),
    });

    volumeSeries = volumeChart.addSeries(HistogramSeries, { priceFormat: { type: "volume" } });

    legendEl = document.createElement("div");
    legendEl.className = "chart-legend";
    priceContainer.appendChild(legendEl);

    const price = priceChart;
    const volume = volumeChart;
    price.subscribeCrosshairMove(renderLegendForCrosshair);
    price.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      mirrorRange(price, volume);
      syncMultiDayView(range);
      maybeRequestOlderData(range);
    });
    volume.timeScale().subscribeVisibleLogicalRangeChange(() => mirrorRange(volume, price));

    resizeObserver = new ResizeObserver(() => {
      price.resize(priceContainer.clientWidth, priceContainer.clientHeight);
      volume.resize(volumeContainer.clientWidth, volumeContainer.clientHeight);
      scheduleShading();
    });
    resizeObserver.observe(priceContainer);
    resizeObserver.observe(volumeContainer);
  };

  const syncPriceSeries = (nextChartType: ChartType): void => {
    if (!priceChart) {
      return;
    }

    if (priceSeries && chartType === nextChartType) {
      return;
    }

    if (priceSeries) {
      priceChart.removeSeries(priceSeries);
      // Any reference line died with the series it was drawn on.
      previousCloseLine = null;
    }

    chartType = nextChartType;
    priceSeries = addPriceSeries(priceChart, nextChartType, bars);
  };

  const syncMovingAverageSeries = (periods: number[]): void => {
    if (!priceChart) {
      return;
    }

    const wanted = normalizeMovingAveragePeriods(periods);

    for (const [period, series] of [...movingAverageSeries]) {
      if (!wanted.includes(period)) {
        priceChart.removeSeries(series);
        movingAverageSeries.delete(period);
        movingAverageAppliedStyle.delete(period);
      }
    }

    wanted.forEach((period, index) => {
      const options = {
        color: MOVING_AVERAGE_COLORS[index % MOVING_AVERAGE_COLORS.length],
        lineWidth: (period >= 200 ? 2 : 1) as LineWidth,
      };
      const styleKey = `${options.color}:${options.lineWidth}`;

      // Never applyOptions() on these sparse Line series: in lightweight-charts
      // 5.2 it schedules an item re-style pass that crashes ("Value is null")
      // on the next zoom. Styling only changes when the set of enabled MAs
      // changes, so recreating the series then is cheap and safe.
      const existing = movingAverageSeries.get(period);
      if (existing && movingAverageAppliedStyle.get(period) === styleKey) {
        return;
      }
      if (existing) {
        priceChart!.removeSeries(existing);
        movingAverageSeries.delete(period);
      }

      movingAverageAppliedStyle.set(period, styleKey);
      movingAverageSeries.set(
        period,
        priceChart!.addSeries(LineSeries, {
          ...options,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }),
      );
    });
  };

  const applyData = (): void => {
    if (!priceSeries || !volumeSeries) {
      return;
    }

    if (chartType === "baseline") {
      priceSeries.applyOptions({ baseValue: { type: "price", price: bars[0]?.c ?? 0 } });
    }

    if (usesOhlcData(chartType)) {
      (priceSeries as ISeriesApi<"Candlestick">).setData(
        bars.map((bar) => ({ time: toSeconds(bar), open: bar.o, high: bar.h, low: bar.l, close: bar.c })),
      );
    } else {
      (priceSeries as ISeriesApi<"Line">).setData(
        bars.map((bar) => ({ time: toSeconds(bar), value: bar.c })),
      );
    }

    volumeSeries.setData(
      bars.map((bar) => ({ time: toSeconds(bar), value: bar.v, color: volumeColor(bar) })),
    );

    newestSeriesTime = bars.length > 0 ? toSeconds(bars[bars.length - 1]) : null;

    for (const [period, series] of movingAverageSeries) {
      const data = buildMovingAverageData(bars, period);
      if (data.length === 0) {
        // A series with no points crashes lightweight-charts' bar colorer on
        // crosshair moves (e.g. MA 200 over a series shorter than 200 bars).
        priceChart?.removeSeries(series);
        movingAverageSeries.delete(period);
        movingAverageAppliedStyle.delete(period);
        continue;
      }
      series.setData(data);
    }

    syncPreviousCloseLine();
    renderLegend(bars.length - 1);
  };

  /**
   * A saved range is a pair of bar indices, and the bar count moves - an intraday
   * session that was 390 candles long yesterday is 180 at lunchtime today.
   * Replaying the raw indices leaves the newest candle stranded in the middle of
   * the chart with dead space to its right, so keep the zoom level and slide the
   * window back onto the data.
   */
  const restorableRange = (barCount: number): VisibleRange | null => {
    const stored = getStoredVisibleRange(viewKey);
    if (!stored) {
      return null;
    }

    const width = stored.to - stored.from;
    if (!(width > 0) || width >= barCount) {
      return null;
    }

    const rightEdge = barCount - 1;
    if (stored.to <= rightEdge) {
      return stored;
    }

    return { from: rightEdge - width, to: rightEdge };
  };

  const restoreView = (): void => {
    if (!priceChart || !volumeChart) {
      return;
    }

    lastViewResetAtMs = Date.now();

    if (defaultVisibleRange) {
      priceChart.timeScale().setVisibleLogicalRange(defaultVisibleRange);
      volumeChart.timeScale().setVisibleLogicalRange(defaultVisibleRange);
      return;
    }

    const restored = restorableRange(bars.length);
    if (restored) {
      priceChart.timeScale().setVisibleLogicalRange(restored);
      volumeChart.timeScale().setVisibleLogicalRange(restored);
      return;
    }

    priceChart.timeScale().fitContent();
    volumeChart.timeScale().fitContent();
  };

  const render = (request: ChartRenderRequest): void => {
    if (request.bars.length === 0) {
      return;
    }

    const firstRender = priceChart === null;
    if (firstRender) {
      timespan = request.timespan;
      createCharts();
    } else if (request.timespan !== timespan) {
      timespan = request.timespan;
      priceChart!.applyOptions(timeAxisOptions());
      volumeChart!.applyOptions(timeAxisOptions());
    }

    bars = request.bars;
    viewKey = request.viewKey;
    previousClose = request.previousClose;
    defaultVisibleRange = request.defaultVisibleRange;
    syncPriceSeries(request.chartType);
    syncMovingAverageSeries(request.movingAveragePeriods);

    // setData keeps logical indices, and prepending shifts what every index
    // means - capture the window first and re-apply it shifted so the user
    // keeps looking at the same candles.
    const prepended = !firstRender && request.prependedBars ? request.prependedBars : 0;
    const preservedRange = prepended > 0
      ? priceChart!.timeScale().getVisibleLogicalRange()
      : null;

    applyData();

    if (preservedRange) {
      const shifted = {
        from: preservedRange.from + prepended,
        to: preservedRange.to + prepended,
      };
      lastViewResetAtMs = Date.now();
      priceChart!.timeScale().setVisibleLogicalRange(shifted);
      volumeChart!.timeScale().setVisibleLogicalRange(shifted);
    } else if (firstRender || request.resetKey !== resetKey) {
      // Only a genuine change of what is being charted re-applies the saved view.
      // A periodic data refresh must leave the time scale exactly where the user
      // left it - that is what used to make the chart jump and rescale.
      resetKey = request.resetKey;
      restoreView();
    }

    // A data refresh can change which dates the visible indices point at
    // without moving the logical range, so the subscription won't fire.
    syncMultiDayView(priceChart!.timeScale().getVisibleLogicalRange());

    scheduleShading();
  };

  /**
   * Folds freshly polled candles into the existing series.
   *
   * `update()` rather than `setData()` on purpose: it is what triggers
   * lightweight-charts' `shiftVisibleRangeOnNewBar`, which follows real time only
   * while the newest candle is already on screen. `setData()` would re-anchor the
   * view on every tick and drag the user forward even when they had scrolled back
   * into history.
   */
  const applyLiveBars = (nextBars: AggregateBar[]): void => {
    if (!priceSeries || !volumeSeries || nextBars.length === 0) {
      return;
    }

    const ordered = [...nextBars].sort((a, b) => a.t - b.t);

    for (const bar of ordered) {
      const time = toSeconds(bar);
      // update() can only touch the newest point onwards. Anything older is left
      // to the periodic refetch, which rebuilds the series wholesale.
      if (newestSeriesTime !== null && time < newestSeriesTime) {
        continue;
      }
      newestSeriesTime = time;

      if (usesOhlcData(chartType)) {
        (priceSeries as ISeriesApi<"Candlestick">).update({
          time,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
        });
      } else {
        (priceSeries as ISeriesApi<"Line">).update({ time, value: bar.c });
      }

      volumeSeries.update({ time, value: bar.v, color: volumeColor(bar) });

      const index = bars.findIndex((existing) => existing.t === bar.t);
      for (const [period, series] of movingAverageSeries) {
        const value = index >= 0 ? movingAverageAt(bars, index, period) : null;
        if (value !== null) {
          series.update({ time, value });
        }
      }
    }

    renderLegend(bars.length - 1);
    scheduleShading();
  };

  const getVisibleLogicalRange = (): VisibleRange | null => {
    const range = priceChart?.timeScale().getVisibleLogicalRange() ?? null;
    return range ? { from: range.from, to: range.to } : null;
  };

  const dispose = (): void => {
    if (shadingFrame !== null) {
      window.cancelAnimationFrame(shadingFrame);
      shadingFrame = null;
    }

    resizeObserver?.disconnect();
    resizeObserver = null;

    clearSessionShading(priceContainer);
    clearSessionShading(volumeContainer);

    legendEl?.remove();
    legendEl = null;

    priceChart?.remove();
    volumeChart?.remove();
    priceChart = null;
    volumeChart = null;
    priceSeries = null;
    volumeSeries = null;
    movingAverageSeries.clear();
    movingAverageAppliedStyle.clear();
    resetKey = null;
    newestSeriesTime = null;
    previousClose = null;
    previousCloseLine = null;
    defaultVisibleRange = null;
    multiDayView = false;
  };

  return { render, applyLiveBars, getVisibleLogicalRange, dispose };
}
