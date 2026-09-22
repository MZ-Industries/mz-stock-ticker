import {
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
import { getStudy, type StudyPlot, type StudyResult } from "./studies";
import type { AggregateBar, ChartType, RangePreset } from "./types";

export type VisibleRange = { from: number; to: number };

const MOVING_AVERAGE_COLORS = ["#60a5fa", "#f59e0b", "#a78bfa", "#fb7185"] as const;

// Logical-range deltas below this are sub-pixel. Mirroring them between the
// panes would just bounce rounding noise back and forth forever.
const RANGE_SYNC_EPSILON = 1e-4;

// Scrolling to within this many bars of the data's left edge asks for older
// history. The suppression window keeps a programmatic view reset (fitContent,
// restored zoom) from looking like the user scrolled back.
const BACKFILL_TRIGGER_BARS = 15;
const VIEW_RESET_SUPPRESS_MS = 1500;

const UP_COLOR = "#34d399";
const DOWN_COLOR = "#f87171";

const CHART_BACKGROUND = "#0b1220";
const CHART_TEXT = "#98a2b3";

/** Hidden scale the Volume Underlay study hangs off, inside the price pane. */
const UNDERLAY_SCALE_ID = "study-underlay";

/** Fallback share of the chart stack given to the price pane. */
const DEFAULT_PRICE_PANE_PERCENT = 68;
/** The price pane never gives up more than this, however many studies are on. */
const MIN_PRICE_PANE_PERCENT = 30;
/** Height of the price/volume splitter row, in pixels. */
const SPLITTER_HEIGHT_PX = 8;
/**
 * Smallest useful height for a pane under the price chart. Must match the
 * `minmax()` floor on `.lower-panes` in the stylesheet: the price pane gives up
 * room to keep every pane at least this tall, and once it cannot, the lower
 * strip scrolls instead of squeezing them all into a few pixels.
 */
const MIN_LOWER_PANE_PX = 84;

export type ChartControllerDeps = {
  stackContainer: HTMLDivElement;
  /** Scrolling strip that holds the volume chart and every study pane. */
  lowerPanesContainer: HTMLDivElement;
  priceContainer: HTMLDivElement;
  volumeContainer: HTMLDivElement;
  rightScaleWidthPx: number;
  renderSessionShading: (chart: IChartApi, container: HTMLDivElement) => void;
  clearSessionShading: (container: HTMLDivElement) => void;
  getStoredVisibleRange: (viewKey: string) => VisibleRange | null;
  onVisibleRangeChange: (viewKey: string, range: VisibleRange) => void;
  /** Share of the chart stack the user has dragged the price pane to (0-1). */
  getPricePaneRatio: () => number;
  /** Fired when the user scrolls close to the oldest loaded bar. */
  onNeedOlderData?: () => void;
};

export type ChartRenderRequest = {
  bars: AggregateBar[];
  chartType: ChartType;
  timespan: RangePreset["timespan"];
  multiplier: number;
  movingAveragePeriods: number[];
  /** Enabled study keys, in the order the user turned them on. */
  studyKeys: string[];
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
   * averages, studies) is folded into the existing charts without touching the
   * time scale.
   */
  resetKey: string;
};

export type ChartController = {
  render: (request: ChartRenderRequest) => void;
  applyLiveBars: (bars: AggregateBar[]) => void;
  getVisibleLogicalRange: () => VisibleRange | null;
  /** Re-applies the chart stack's row sizes (after a splitter drag). */
  applyPaneLayout: () => void;
  dispose: () => void;
};

/** A series the controller owns, plus the style it was created with. */
type ManagedSeries = {
  series: ISeriesApi<SeriesType>;
  styleKey: string;
};

/** One study drawn in its own chart under the volume pane. */
type StudyPane = {
  studyKey: string;
  container: HTMLDivElement;
  chart: IChartApi;
  legendEl: HTMLDivElement;
  series: Map<string, ManagedSeries>;
  levelLines: IPriceLine[];
  /** The series `levelLines` were drawn on; they die with it. */
  levelAnchor: ISeriesApi<SeriesType> | null;
};

function usesOhlcData(chartType: ChartType): boolean {
  return chartType === "candlestick";
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

function addPriceSeries(chart: IChartApi, chartType: ChartType): ISeriesApi<SeriesType> {
  if (chartType === "line") {
    return chart.addSeries(LineSeries, { color: "#2dd4bf", lineWidth: 2 });
  }

  return chart.addSeries(CandlestickSeries, {
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    borderVisible: false,
    wickUpColor: UP_COLOR,
    wickDownColor: DOWN_COLOR,
  });
}

/** Identifies a plot's visual style, so only real restyles recreate a series. */
function plotStyleKey(plot: StudyPlot): string {
  return [
    plot.type,
    plot.color,
    plot.lineWidth ?? 1,
    plot.dashed ? "dashed" : "solid",
    plot.underlay ? "underlay" : "scaled",
  ].join("|");
}

function createPlotSeries(chart: IChartApi, plot: StudyPlot): ISeriesApi<SeriesType> {
  if (plot.type === "histogram") {
    const series = chart.addSeries(HistogramSeries, {
      color: plot.color,
      priceLineVisible: false,
      lastValueVisible: false,
      ...(plot.underlay
        ? { priceScaleId: UNDERLAY_SCALE_ID, priceFormat: { type: "volume" as const } }
        : {}),
    });

    if (plot.underlay) {
      // Keeps the underlay pinned to the bottom fifth of the price pane so it
      // never competes with the candles for vertical space.
      chart.priceScale(UNDERLAY_SCALE_ID).applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
    }

    return series;
  }

  const base = {
    color: plot.color,
    lineWidth: (plot.lineWidth ?? 1) as LineWidth,
    lineStyle: plot.dashed ? LineStyle.Dashed : LineStyle.Solid,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  };

  if (plot.type === "dots") {
    return chart.addSeries(LineSeries, {
      ...base,
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 1.5,
    });
  }

  return chart.addSeries(LineSeries, base);
}

function formatStudyValue(value: number, result: StudyResult): string {
  if (result.compact) {
    return fmtCompact(value);
  }
  return value.toFixed(result.precision ?? 2);
}

/**
 * Owns the price chart, the volume chart and one chart per enabled study.
 *
 * Deliberately has no auto-scroll logic of its own: lightweight-charts already
 * shifts the visible range when a bar is appended *and the last bar is on
 * screen* (`shiftVisibleRangeOnNewBar`), which is exactly the behaviour we want.
 * Anything we add on top can only fire in the cases the library declined to
 * shift - i.e. when the user has deliberately scrolled away from real time.
 */
export function createChartController(deps: ChartControllerDeps): ChartController {
  const {
    stackContainer,
    lowerPanesContainer,
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
  /** Overlay study plots drawn on the price pane, keyed `study:plot`. */
  const overlaySeries = new Map<string, ManagedSeries>();
  let studyPanes: StudyPane[] = [];
  let studyResults = new Map<string, StudyResult>();
  let resizeObserver: ResizeObserver | null = null;

  let bars: AggregateBar[] = [];
  let chartType: ChartType = "candlestick";
  let timespan: RangePreset["timespan"] = "minute";
  let multiplier = 1;
  let studyKeys: string[] = [];
  let viewKey = "";
  let resetKey: string | null = null;
  let newestSeriesTime: UTCTimestamp | null = null;
  let shadingFrame: number | null = null;
  let previousClose: number | null = null;
  let previousCloseLine: IPriceLine | null = null;
  let legendEl: HTMLDivElement | null = null;
  let overlayLegendEl: HTMLDivElement | null = null;
  let defaultVisibleRange: VisibleRange | null = null;
  let lastViewResetAtMs = 0;
  let multiDayView = false;

  const allCharts = (): IChartApi[] => {
    const charts: IChartApi[] = [];
    if (priceChart) {
      charts.push(priceChart);
    }
    if (volumeChart) {
      charts.push(volumeChart);
    }
    for (const pane of studyPanes) {
      charts.push(pane.chart);
    }
    return charts;
  };

  const allContainers = (): HTMLDivElement[] => [
    priceContainer,
    volumeContainer,
    ...studyPanes.map((pane) => pane.container),
  ];

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

  const renderPriceLegend = (index: number): void => {
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

  /** One row per overlay study, under the OHLC legend on the price pane. */
  const renderOverlayLegend = (index: number): void => {
    if (!overlayLegendEl) {
      return;
    }

    const rows: string[] = [];

    for (const key of studyKeys) {
      const study = getStudy(key);
      const result = studyResults.get(key);
      if (!study || !result || study.placement !== "price") {
        continue;
      }

      const values = result.plots
        .map((plot) => {
          const value = plot.values[index];
          if (value === null || value === undefined || !Number.isFinite(value)) {
            return null;
          }
          return `<span style="color:${plot.color}">${plot.label} <b>${formatStudyValue(value, result)}</b></span>`;
        })
        .filter((part): part is string => part !== null);

      if (values.length > 0) {
        rows.push(`<div class="study-legend-row"><span class="study-name">${study.label}</span>${values.join("")}</div>`);
      }
    }

    overlayLegendEl.innerHTML = rows.join("");
  };

  const renderStudyPaneLegend = (pane: StudyPane, index: number): void => {
    const study = getStudy(pane.studyKey);
    const result = studyResults.get(pane.studyKey);
    if (!study || !result) {
      pane.legendEl.innerHTML = "";
      return;
    }

    const values = result.plots
      .map((plot) => {
        const value = plot.values[index];
        if (value === null || value === undefined || !Number.isFinite(value)) {
          return null;
        }
        return `<span style="color:${plot.color}">${plot.label} <b>${formatStudyValue(value, result)}</b></span>`;
      })
      .filter((part): part is string => part !== null);

    pane.legendEl.innerHTML = `<span class="study-name">${study.label}</span>${values.join("")}`;
  };

  const renderAllLegends = (index: number): void => {
    renderPriceLegend(index);
    renderOverlayLegend(index);
    for (const pane of studyPanes) {
      renderStudyPaneLegend(pane, index);
    }
  };

  const renderLegendForCrosshair = (param: MouseEventParams): void => {
    if (typeof param.time !== "number") {
      renderAllLegends(bars.length - 1);
      return;
    }

    const timestampMs = param.time * 1000;
    const index = bars.findIndex((bar) => bar.t === timestampMs);
    renderAllLegends(index >= 0 ? index : bars.length - 1);
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
    if (shadingFrame !== null || !priceChart) {
      return;
    }

    shadingFrame = window.requestAnimationFrame(() => {
      shadingFrame = null;
      if (!priceChart) {
        return;
      }
      renderSessionShading(priceChart, priceContainer);
      if (volumeChart) {
        renderSessionShading(volumeChart, volumeContainer);
      }
      for (const pane of studyPanes) {
        renderSessionShading(pane.chart, pane.container);
      }
    });
  };

  const timeAxisOptions = (visible: boolean) => ({
    timeScale: {
      borderVisible: false,
      visible,
      timeVisible: timespan !== "day",
      tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
        formatAxisTime(time, tickMarkType, timespan, multiDayView),
    },
    localization: {
      timeFormatter: (time: Time) => formatTooltipTime(time, timespan),
    },
  });

  /** Only the bottom-most pane carries a time axis; the rest would just repeat it. */
  const applyTimeAxisOptions = (): void => {
    const charts = allCharts();
    charts.forEach((chart, index) => {
      chart.applyOptions(timeAxisOptions(index === charts.length - 1));
    });
  };

  /**
   * Intra-day tick labels carry their date ("Aug 28 14:30") whenever the
   * visible window spans more than one New York calendar day, because a bare
   * clock time is ambiguous with several sessions on screen. The formatter
   * can't see the visible range, so the flag is tracked here - and a flip has
   * to re-apply the axis options, which is what flushes lightweight-charts'
   * cache of already-formatted tick labels.
   */
  const syncMultiDayView = (range: VisibleRange | null): void => {
    if (!priceChart || !range || bars.length === 0) {
      return;
    }

    const lastIndex = bars.length - 1;
    const firstVisible = bars[clamp(0, lastIndex, Math.round(range.from))];
    const lastVisible = bars[clamp(0, lastIndex, Math.round(range.to))];
    const multiDay = getNyParts(firstVisible.t).date !== getNyParts(lastVisible.t).date;

    if (multiDay !== multiDayView) {
      multiDayView = multiDay;
      applyTimeAxisOptions();
    }
  };

  /**
   * Pushes one pane's window onto every other pane.
   *
   * No "ignore the next event" flag here on purpose: lightweight-charts applies
   * setVisibleLogicalRange on the next animation frame, so a one-shot flag set
   * now can just as easily swallow a real user gesture that lands in between.
   * Comparing values instead is self-terminating - once the panes agree, the
   * echo stops.
   */
  const mirrorRange = (source: IChartApi): void => {
    const range = source.timeScale().getVisibleLogicalRange();
    if (!range) {
      return;
    }

    for (const target of allCharts()) {
      if (target === source) {
        continue;
      }

      const targetRange = target.timeScale().getVisibleLogicalRange();
      const inSync = targetRange !== null
        && Math.abs(range.from - targetRange.from) <= RANGE_SYNC_EPSILON
        && Math.abs(range.to - targetRange.to) <= RANGE_SYNC_EPSILON;

      if (!inSync) {
        target.timeScale().setVisibleLogicalRange(range);
      }
    }

    onVisibleRangeChange(viewKey, range);
    syncMultiDayView(range);
    maybeRequestOlderData(range);
    scheduleShading();
  };

  const basePaneOptions = (faintGrid: boolean) => ({
    layout: {
      attributionLogo: false,
      background: { color: CHART_BACKGROUND },
      textColor: CHART_TEXT,
    },
    grid: {
      vertLines: { color: faintGrid ? "rgba(148, 163, 184, 0.03)" : "rgba(148, 163, 184, 0.08)" },
      horzLines: { color: faintGrid ? "rgba(148, 163, 184, 0.03)" : "rgba(148, 163, 184, 0.08)" },
    },
    crosshair: {
      vertLine: { color: "rgba(226,232,240,0.35)" },
      horzLine: { color: "rgba(226,232,240,0.35)" },
    },
  });

  /** Wires a chart into the shared crosshair and range-sync subscriptions. */
  const connectChart = (chart: IChartApi): void => {
    chart.subscribeCrosshairMove(renderLegendForCrosshair);
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => mirrorRange(chart));
  };

/**
   * Row heights for the chart stack. The price pane keeps whatever share the
   * user dragged it to, but hands room back as studies are added so each pane
   * below it stays readable.
   */
  const applyPaneLayout = (): void => {
    const requested = deps.getPricePaneRatio() * 100;
    const stackHeight = stackContainer.clientHeight;
    const lowerPaneCount = 1 + studyPanes.length;

    let maxPricePercent = 100;
    if (stackHeight > 0) {
      const lowerPanesNeed = lowerPaneCount * MIN_LOWER_PANE_PX + SPLITTER_HEIGHT_PX;
      maxPricePercent = ((stackHeight - lowerPanesNeed) / stackHeight) * 100;
    }

    const pricePercent = clamp(
      MIN_PRICE_PANE_PERCENT,
      Math.max(MIN_PRICE_PANE_PERCENT, maxPricePercent),
      requested > 0 ? requested : DEFAULT_PRICE_PANE_PERCENT,
    );

    const rows = `${pricePercent.toFixed(3)}% ${SPLITTER_HEIGHT_PX}px minmax(0, 1fr)`;
    if (stackContainer.style.gridTemplateRows !== rows) {
      stackContainer.style.gridTemplateRows = rows;
    }
  };

  const createStudyPane = (studyKey: string): StudyPane => {
    const container = document.createElement("div");
    container.className = "study-chart";
    container.dataset.study = studyKey;

    lowerPanesContainer.append(container);

    const chart = createChart(container, {
      ...basePaneOptions(true),
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: rightScaleWidthPx,
        scaleMargins: { top: 0.18, bottom: 0.1 },
      },
      ...timeAxisOptions(false),
    });

    const legendEl = document.createElement("div");
    legendEl.className = "chart-legend study-legend";
    container.appendChild(legendEl);

    connectChart(chart);
    resizeObserver?.observe(container);

    return {
      studyKey,
      container,
      chart,
      legendEl,
      series: new Map(),
      levelLines: [],
      levelAnchor: null,
    };
  };

  const destroyStudyPane = (pane: StudyPane): void => {
    resizeObserver?.unobserve(pane.container);
    clearSessionShading(pane.container);
    pane.legendEl.remove();
    pane.chart.remove();
    pane.container.remove();
  };

  /** Adds and removes panes so they match the enabled pane-placed studies. */
  const syncStudyPanes = (keys: string[]): void => {
    const wanted = keys.filter((key) => getStudy(key)?.placement === "pane");
    const wantedSet = new Set(wanted);

    for (const pane of studyPanes) {
      if (!wantedSet.has(pane.studyKey)) {
        destroyStudyPane(pane);
      }
    }

    const existing = new Map(
      studyPanes.filter((pane) => wantedSet.has(pane.studyKey)).map((pane) => [pane.studyKey, pane]),
    );

    const referenceRange = priceChart?.timeScale().getVisibleLogicalRange() ?? null;
    const next: StudyPane[] = [];

    for (const key of wanted) {
      const pane = existing.get(key);
      if (pane) {
        // Re-append so the panes stack in the order the studies are listed.
        lowerPanesContainer.append(pane.container);
        next.push(pane);
        continue;
      }

      const created = createStudyPane(key);
      if (referenceRange) {
        created.chart.timeScale().setVisibleLogicalRange(referenceRange);
      }
      next.push(created);
    }

    const changed = next.length !== studyPanes.length
      || next.some((pane, index) => pane !== studyPanes[index]);
    studyPanes = next;

    if (changed) {
      applyPaneLayout();
      applyTimeAxisOptions();
    }
  };

  const createCharts = (): void => {
    priceChart = createChart(priceContainer, {
      ...basePaneOptions(false),
      rightPriceScale: { borderVisible: false, minimumWidth: rightScaleWidthPx },
      ...timeAxisOptions(false),
    });

    volumeChart = createChart(volumeContainer, {
      ...basePaneOptions(true),
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: rightScaleWidthPx,
        scaleMargins: { top: 0.2, bottom: 0.05 },
      },
      ...timeAxisOptions(true),
    });

    volumeSeries = volumeChart.addSeries(HistogramSeries, { priceFormat: { type: "volume" } });

    legendEl = document.createElement("div");
    legendEl.className = "chart-legend";
    priceContainer.appendChild(legendEl);

    overlayLegendEl = document.createElement("div");
    overlayLegendEl.className = "chart-legend overlay-legend";
    priceContainer.appendChild(overlayLegendEl);

    connectChart(priceChart);
    connectChart(volumeChart);

    resizeObserver = new ResizeObserver(() => {
      // A shorter window changes how much the price pane may keep.
      applyPaneLayout();
      priceChart?.resize(priceContainer.clientWidth, priceContainer.clientHeight);
      volumeChart?.resize(volumeContainer.clientWidth, volumeContainer.clientHeight);
      for (const pane of studyPanes) {
        pane.chart.resize(pane.container.clientWidth, pane.container.clientHeight);
      }
      scheduleShading();
    });

    resizeObserver.observe(stackContainer);
    for (const container of allContainers()) {
      resizeObserver.observe(container);
    }

    applyPaneLayout();
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
    priceSeries = addPriceSeries(priceChart, nextChartType);
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

  /** Turns an indicator's aligned values into chart points, dropping the gaps. */
  const toPlotData = (plot: StudyPlot): Array<{ time: UTCTimestamp; value: number; color?: string }> => {
    const points: Array<{ time: UTCTimestamp; value: number; color?: string }> = [];
    const length = Math.min(plot.values.length, bars.length);

    for (let index = 0; index < length; index += 1) {
      const value = plot.values[index];
      if (value === null || !Number.isFinite(value)) {
        continue;
      }

      const color = plot.colors?.[index];
      points.push(
        color
          ? { time: toSeconds(bars[index]), value, color }
          : { time: toSeconds(bars[index]), value },
      );
    }

    return points;
  };

  /**
   * Creates, restyles and fills the series for one study's plots.
   *
   * A plot with no points is dropped outright: lightweight-charts crashes in its
   * bar colorer on the next crosshair move over an empty series.
   */
  const applyPlots = (
    chart: IChartApi,
    store: Map<string, ManagedSeries>,
    keyPrefix: string,
    plots: StudyPlot[],
  ): void => {
    for (const plot of plots) {
      const key = `${keyPrefix}:${plot.key}`;
      const data = toPlotData(plot);
      const existing = store.get(key);

      if (data.length === 0) {
        if (existing) {
          chart.removeSeries(existing.series);
          store.delete(key);
        }
        continue;
      }

      const styleKey = plotStyleKey(plot);
      let managed = existing;

      // Same recreate-instead-of-applyOptions rule as the moving averages:
      // these series are sparse and applyOptions on them crashes on zoom.
      if (managed && managed.styleKey !== styleKey) {
        chart.removeSeries(managed.series);
        store.delete(key);
        managed = undefined;
      }

      if (!managed) {
        managed = { series: createPlotSeries(chart, plot), styleKey };
        store.set(key, managed);
      }

      (managed.series as ISeriesApi<"Line">).setData(data);
    }
  };

  /** Drops series whose study is no longer enabled. */
  const pruneSeries = (
    chart: IChartApi,
    store: Map<string, ManagedSeries>,
    liveKeys: Set<string>,
  ): void => {
    for (const [key, managed] of [...store]) {
      if (!liveKeys.has(key)) {
        chart.removeSeries(managed.series);
        store.delete(key);
      }
    }
  };

  /**
   * Reference lines hang off the study's first series. That series can be
   * replaced (a plot that had no points and now does), and the lines go with
   * it - so they are only ever removed from the series they were drawn on.
   */
  const syncStudyLevels = (pane: StudyPane, result: StudyResult): void => {
    const anchor = [...pane.series.values()][0]?.series ?? null;
    const levels = result.levels ?? [];

    if (anchor === pane.levelAnchor && pane.levelLines.length === levels.length) {
      return;
    }

    if (pane.levelAnchor === anchor) {
      for (const priceLine of pane.levelLines) {
        pane.levelAnchor?.removePriceLine(priceLine);
      }
    }

    pane.levelLines = [];
    pane.levelAnchor = anchor;

    if (!anchor) {
      return;
    }

    for (const level of levels) {
      pane.levelLines.push(
        anchor.createPriceLine({
          price: level.value,
          color: level.color ?? "rgba(148, 163, 184, 0.45)",
          lineWidth: 1,
          lineStyle: level.dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: false,
          title: "",
        }),
      );
    }
  };

  const computeStudies = (): void => {
    const next = new Map<string, StudyResult>();
    const context = { bars, timespan, multiplier };

    for (const key of studyKeys) {
      const study = getStudy(key);
      if (!study) {
        continue;
      }
      next.set(key, study.compute(context));
    }

    studyResults = next;
  };

  const applyStudyData = (): void => {
    if (!priceChart) {
      return;
    }

    const overlayKeys = new Set<string>();

    for (const key of studyKeys) {
      const study = getStudy(key);
      const result = studyResults.get(key);
      if (!study || !result || study.placement !== "price") {
        continue;
      }

      applyPlots(priceChart, overlaySeries, key, result.plots);
      for (const plot of result.plots) {
        overlayKeys.add(`${key}:${plot.key}`);
      }
    }

    pruneSeries(priceChart, overlaySeries, overlayKeys);

    for (const pane of studyPanes) {
      const result = studyResults.get(pane.studyKey);
      if (!result) {
        continue;
      }

      applyPlots(pane.chart, pane.series, pane.studyKey, result.plots);
      pruneSeries(
        pane.chart,
        pane.series,
        new Set(result.plots.map((plot) => `${pane.studyKey}:${plot.key}`)),
      );
      syncStudyLevels(pane, result);
    }
  };

  const applyData = (): void => {
    if (!priceSeries || !volumeSeries) {
      return;
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

    computeStudies();
    applyStudyData();

    syncPreviousCloseLine();
    renderAllLegends(bars.length - 1);
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

  const setRangeOnAllCharts = (range: VisibleRange): void => {
    for (const chart of allCharts()) {
      chart.timeScale().setVisibleLogicalRange(range);
    }
  };

  const restoreView = (): void => {
    if (!priceChart) {
      return;
    }

    lastViewResetAtMs = Date.now();

    if (defaultVisibleRange) {
      setRangeOnAllCharts(defaultVisibleRange);
      return;
    }

    const restored = restorableRange(bars.length);
    if (restored) {
      setRangeOnAllCharts(restored);
      return;
    }

    for (const chart of allCharts()) {
      chart.timeScale().fitContent();
    }
  };

  const render = (request: ChartRenderRequest): void => {
    if (request.bars.length === 0) {
      return;
    }

    const firstRender = priceChart === null;
    if (firstRender) {
      timespan = request.timespan;
      multiplier = request.multiplier;
      createCharts();
    } else if (request.timespan !== timespan || request.multiplier !== multiplier) {
      timespan = request.timespan;
      multiplier = request.multiplier;
      applyTimeAxisOptions();
    }

    bars = request.bars;
    viewKey = request.viewKey;
    previousClose = request.previousClose;
    defaultVisibleRange = request.defaultVisibleRange;
    studyKeys = request.studyKeys;
    syncPriceSeries(request.chartType);
    syncMovingAverageSeries(request.movingAveragePeriods);
    syncStudyPanes(studyKeys);

    // setData keeps logical indices, and prepending shifts what every index
    // means - capture the window first and re-apply it shifted so the user
    // keeps looking at the same candles.
    const prepended = !firstRender && request.prependedBars ? request.prependedBars : 0;
    const preservedRange = prepended > 0
      ? priceChart!.timeScale().getVisibleLogicalRange()
      : null;

    applyData();

    if (preservedRange) {
      lastViewResetAtMs = Date.now();
      setRangeOnAllCharts({
        from: preservedRange.from + prepended,
        to: preservedRange.to + prepended,
      });
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

  /** Folds the newest indicator values into the study series. */
  const applyLiveStudies = (time: UTCTimestamp, index: number): void => {
    if (index < 0) {
      return;
    }

    for (const key of studyKeys) {
      const result = studyResults.get(key);
      const study = getStudy(key);
      if (!result || !study) {
        continue;
      }

      const store = study.placement === "price"
        ? overlaySeries
        : studyPanes.find((pane) => pane.studyKey === key)?.series;
      if (!store) {
        continue;
      }

      for (const plot of result.plots) {
        const managed = store.get(`${key}:${plot.key}`);
        const value = plot.values[index];
        if (!managed || value === null || value === undefined || !Number.isFinite(value)) {
          continue;
        }

        const color = plot.colors?.[index];
        (managed.series as ISeriesApi<"Line">).update(
          color ? { time, value, color } : { time, value },
        );
      }
    }
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

    // Indicators read the whole series, so recompute before touching any of the
    // study series - they all want the values this new candle produced.
    computeStudies();

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

      applyLiveStudies(time, index);
    }

    renderAllLegends(bars.length - 1);
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

    for (const pane of studyPanes) {
      clearSessionShading(pane.container);
      pane.legendEl.remove();
      pane.chart.remove();
      pane.container.remove();
    }
    studyPanes = [];
    studyResults = new Map();
    overlaySeries.clear();

    clearSessionShading(priceContainer);
    clearSessionShading(volumeContainer);

    legendEl?.remove();
    legendEl = null;
    overlayLegendEl?.remove();
    overlayLegendEl = null;

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

  return { render, applyLiveBars, getVisibleLogicalRange, applyPaneLayout, dispose };
}
