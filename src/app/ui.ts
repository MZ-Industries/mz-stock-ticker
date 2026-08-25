import { fmtNumber, fmtPct } from "./utils";
import type { AggregateBar, ChartType, RangePreset, SnapshotItem } from "./types";

type ExtendedStrip = {
  closePrice: number;
  closeChangePct: number;
  afterPrice: number;
  afterChangePct: number;
  isPreMarket: boolean;
};

export function updateHeadlineView(params: {
  selectedTicker: string;
  latestSnapshotsByTicker: Map<string, SnapshotItem>;
  latestBars: AggregateBar[];
  getExtendedStripFromBars: () => ExtendedStrip | null;
  titleTickerEl: HTMLHeadingElement;
  headlinePriceEl: HTMLDivElement;
  headlineChangeEl: HTMLDivElement;
  extendedStripEl: HTMLDivElement;
}): void {
  const {
    selectedTicker,
    latestSnapshotsByTicker,
    latestBars,
    getExtendedStripFromBars,
    titleTickerEl,
    headlinePriceEl,
    headlineChangeEl,
    extendedStripEl,
  } = params;

  const snapshot = latestSnapshotsByTicker.get(selectedTicker);
  const hasPostMarket = Number.isFinite(snapshot?.post_market_price)
    && Number.isFinite(snapshot?.post_market_change_percent)
    && Number.isFinite(snapshot?.price)
    && Number.isFinite(snapshot?.change_percent);
  const hasPreMarket = !hasPostMarket
    && Number.isFinite(snapshot?.pre_market_price)
    && Number.isFinite(snapshot?.pre_market_change_percent)
    && Number.isFinite(snapshot?.price)
    && Number.isFinite(snapshot?.change_percent);
  const snapshotHasExtended = hasPostMarket || hasPreMarket;

  const barStrip = snapshotHasExtended ? null : getExtendedStripFromBars();

  const stripData = snapshotHasExtended
    ? {
      closePrice: snapshot?.price as number,
      closeChangePct: snapshot?.change_percent as number,
      afterPrice: hasPostMarket ? (snapshot?.post_market_price as number) : (snapshot?.pre_market_price as number),
      afterChangePct: hasPostMarket
        ? (snapshot?.post_market_change_percent as number)
        : (snapshot?.pre_market_change_percent as number),
      isPreMarket: hasPreMarket,
    }
    : barStrip;

  titleTickerEl.textContent = selectedTicker;

  if (stripData) {
    headlinePriceEl.classList.remove("hidden");
    headlinePriceEl.textContent = fmtNumber(stripData.closePrice);
    headlineChangeEl.classList.remove("hidden");
    headlineChangeEl.textContent = `${stripData.closeChangePct >= 0 ? "+" : ""}${fmtPct(stripData.closeChangePct)}`;
    headlineChangeEl.className = `subtle ${stripData.closeChangePct >= 0 ? "up" : "down"}`;

    const afterLabel = stripData.isPreMarket ? "Pre" : "After";
    const afterDelta = stripData.afterPrice - stripData.closePrice;
    extendedStripEl.classList.remove("hidden");
    extendedStripEl.innerHTML = `
      <span>${afterLabel}: ${fmtNumber(stripData.afterPrice)}</span>
      <span class="${afterDelta >= 0 ? "up" : "down"}">${afterDelta >= 0 ? "+" : ""}${fmtNumber(afterDelta)} (${fmtPct(stripData.afterChangePct)})</span>
    `;
    return;
  }

  let displayPrice: number = Number.isFinite(snapshot?.price) ? (snapshot?.price as number) : Number.NaN;
  let displayPct: number = Number.isFinite(snapshot?.change_percent)
    ? (snapshot?.change_percent as number)
    : Number.NaN;
  let displayDelta: number = Number.isFinite(displayPrice) && Number.isFinite(displayPct)
    ? (displayPrice * displayPct) / 100
    : Number.NaN;

  if ((!Number.isFinite(displayPrice) || !Number.isFinite(displayPct) || !Number.isFinite(displayDelta)) && latestBars.length >= 1) {
    const close = latestBars[latestBars.length - 1].c;
    const previousClose = latestBars[0].o;
    displayPrice = close;
    displayDelta = displayPrice - previousClose;
    displayPct = (displayDelta / previousClose) * 100;
  }

  if ((!Number.isFinite(displayPrice) || !Number.isFinite(displayPct) || !Number.isFinite(displayDelta)) && latestBars.length >= 2) {
    const first = latestBars[0].o;
    const last = latestBars[latestBars.length - 1].c;
    const delta = last - first;
    const pct = (delta / first) * 100;

    displayPrice = last;
    displayPct = pct;
    displayDelta = delta;
  }

  if (!Number.isFinite(displayPrice) || !Number.isFinite(displayPct) || !Number.isFinite(displayDelta)) {
    return;
  }

  headlinePriceEl.classList.remove("hidden");
  headlinePriceEl.textContent = fmtNumber(displayPrice);
  headlineChangeEl.classList.remove("hidden");
  headlineChangeEl.textContent = `${displayDelta >= 0 ? "+" : ""}${fmtNumber(displayDelta)} (${fmtPct(displayPct)})`;
  headlineChangeEl.className = `subtle ${displayDelta >= 0 ? "up" : "down"}`;
  extendedStripEl.classList.add("hidden");
}

export function renderControlsView(params: {
  ranges: RangePreset[];
  selectedRange: RangePreset;
  rangeGroupEl: HTMLDivElement;
  isCandleIntervalRelevant: () => boolean;
  intervalGroupEl: HTMLDivElement;
  candleIntervalOptions: Array<{ key: string; label: string }>;
  selectedCandleIntervalKey: string;
  movingAveragePeriodOptions: readonly number[];
  selectedMovingAveragePeriods: readonly number[];
  maGroupEl: HTMLDivElement;
  chartTypes: ChartType[];
  selectedChartType: ChartType;
  typeGroupEl: HTMLDivElement;
}): void {
  const {
    ranges,
    selectedRange,
    rangeGroupEl,
    isCandleIntervalRelevant,
    intervalGroupEl,
    candleIntervalOptions,
    selectedCandleIntervalKey,
    movingAveragePeriodOptions,
    selectedMovingAveragePeriods,
    maGroupEl,
    chartTypes,
    selectedChartType,
    typeGroupEl,
  } = params;

  rangeGroupEl.innerHTML = ranges.map((item) => {
    const active = item.label === selectedRange.label ? "active" : "";
    return `<button class="pill ${active}" data-range="${item.label}">${item.label}</button>`;
  }).join("");

  if (isCandleIntervalRelevant()) {
    intervalGroupEl.classList.remove("hidden");
    intervalGroupEl.innerHTML = candleIntervalOptions.map((item) => {
      const active = item.key === selectedCandleIntervalKey ? "active" : "";
      return `<button class="pill ${active}" data-candle-interval="${item.key}">${item.label}</button>`;
    }).join("");
  } else {
    intervalGroupEl.classList.add("hidden");
    intervalGroupEl.innerHTML = "";
  }

  maGroupEl.innerHTML = movingAveragePeriodOptions.map((period) => {
    const active = selectedMovingAveragePeriods.includes(period) ? "active" : "";
    return `<button class="pill ${active}" data-ma-period="${period}">MA ${period}</button>`;
  }).join("");

  typeGroupEl.innerHTML = chartTypes.map((type) => {
    const active = type === selectedChartType ? "active" : "";
    return `<button class="pill ${active}" data-type="${type}">${type}</button>`;
  }).join("");
}
