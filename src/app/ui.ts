import {
  CANDLE_INTERVAL_OPTIONS,
  CHART_TYPES,
  MOVING_AVERAGE_PERIOD_OPTIONS,
  RANGES,
} from "./constants";
import { els } from "./elements";
import { getExtendedStripFromBars, isCandleIntervalRelevant } from "./market";
import { state } from "./store";
import { escapeHtml, fmtCompact, fmtNumber, fmtPct, formatRelativeTime } from "./utils";
import type { NewsItem } from "./types";

export function updateHeadline(): void {
  const {
    selectedTicker,
    latestSnapshotsByTicker,
    latestBars,
    latestSymbolDetail,
  } = state;

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

  const barStrip = snapshotHasExtended
    ? null
    : getExtendedStripFromBars({
      selectedRange: state.selectedRange,
      latestBars,
      activeSessionDate: state.activeSessionDate,
      selectedTicker,
      latestSnapshotsByTicker,
    });

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

  els.titleTickerEl.textContent = selectedTicker;

  const detail = latestSymbolDetail?.ticker === selectedTicker ? latestSymbolDetail : null;
  const subtitleParts = [
    detail?.name ?? snapshot?.name,
    detail?.exchange,
    detail?.currency,
  ].filter((part): part is string => Boolean(part));
  els.symbolSubtitleEl.textContent = subtitleParts.length > 0 ? subtitleParts.join(" · ") : " ";

  if (stripData) {
    els.headlinePriceEl.classList.remove("hidden");
    els.headlinePriceEl.textContent = fmtNumber(stripData.closePrice);
    els.headlineChangeEl.classList.remove("hidden");
    els.headlineChangeEl.textContent = `${stripData.closeChangePct >= 0 ? "+" : ""}${fmtPct(stripData.closeChangePct)}`;
    els.headlineChangeEl.className = `subtle ${stripData.closeChangePct >= 0 ? "up" : "down"}`;

    const afterLabel = stripData.isPreMarket ? "Pre" : "After";
    const afterDelta = stripData.afterPrice - stripData.closePrice;
    els.extendedStripEl.classList.remove("hidden");
    els.extendedStripEl.innerHTML = `
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

  if (!Number.isFinite(displayPrice) || !Number.isFinite(displayPct) || !Number.isFinite(displayDelta)) {
    return;
  }

  els.headlinePriceEl.classList.remove("hidden");
  els.headlinePriceEl.textContent = fmtNumber(displayPrice);
  els.headlineChangeEl.classList.remove("hidden");
  els.headlineChangeEl.textContent = `${displayDelta >= 0 ? "+" : ""}${fmtNumber(displayDelta)} (${fmtPct(displayPct)})`;
  els.headlineChangeEl.className = `subtle ${displayDelta >= 0 ? "up" : "down"}`;
  els.extendedStripEl.classList.add("hidden");
}

export function renderControls(): void {
  els.rangeGroupEl.innerHTML = RANGES.map((item) => {
    const active = item.label === state.selectedRange.label ? "active" : "";
    return `<button class="pill ${active}" data-range="${item.label}">${item.label}</button>`;
  }).join("");

  if (isCandleIntervalRelevant(state.selectedChartType, state.selectedRange)) {
    els.intervalGroupEl.classList.remove("hidden");
    els.intervalGroupEl.innerHTML = CANDLE_INTERVAL_OPTIONS.map((item) => {
      const active = item.key === state.selectedCandleIntervalKey ? "active" : "";
      return `<button class="pill ${active}" data-candle-interval="${item.key}">${item.label}</button>`;
    }).join("");
  } else {
    els.intervalGroupEl.classList.add("hidden");
    els.intervalGroupEl.innerHTML = "";
  }

  els.maGroupEl.innerHTML = MOVING_AVERAGE_PERIOD_OPTIONS.map((period) => {
    const active = state.selectedMovingAveragePeriods.includes(period) ? "active" : "";
    return `<button class="pill ${active}" data-ma-period="${period}">MA ${period}</button>`;
  }).join("");

  els.typeGroupEl.innerHTML = CHART_TYPES.map((type) => {
    const active = type === state.selectedChartType ? "active" : "";
    return `<button class="pill ${active}" data-type="${type}">${type}</button>`;
  }).join("");
}

const MARKET_STATE_LABELS: Record<string, string> = {
  REGULAR: "Market Open",
  PRE: "Pre-Market",
  POST: "After Hours",
};

export function renderStats(): void {
  const detail = state.latestSymbolDetail;
  const matches = detail?.ticker === state.selectedTicker;

  if (!detail || !matches) {
    els.statsStripEl.innerHTML = "";
    els.marketStatePillEl.classList.add("hidden");
    return;
  }

  const num = (value: number | undefined): string =>
    Number.isFinite(value) ? fmtNumber(value as number) : "--";
  const compact = (value: number | undefined): string =>
    Number.isFinite(value) ? fmtCompact(value as number) : "--";

  const items: Array<[string, string]> = [
    ["Open", num(detail.open)],
    ["High", num(detail.day_high)],
    ["Low", num(detail.day_low)],
    ["Prev Close", num(detail.previous_close)],
    ["Volume", compact(detail.volume)],
    ["Avg Vol", compact(detail.average_volume_3m)],
    ["52W H", num(detail.fifty_two_week_high)],
    ["52W L", num(detail.fifty_two_week_low)],
    ["Mkt Cap", compact(detail.market_cap)],
    ["P/E", Number.isFinite(detail.trailing_pe) ? (detail.trailing_pe as number).toFixed(2) : "--"],
    ["EPS", num(detail.eps_ttm)],
    ["Yield", Number.isFinite(detail.dividend_yield_percent) ? `${(detail.dividend_yield_percent as number).toFixed(2)}%` : "--"],
  ];

  els.statsStripEl.innerHTML = items.map(([label, value]) => `
    <div class="stat-cell">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${escapeHtml(value)}</span>
    </div>
  `).join("");

  const marketState = detail.market_state ?? "";
  const stateLabel = MARKET_STATE_LABELS[marketState]
    ?? (marketState ? "Market Closed" : "");
  if (stateLabel) {
    els.marketStatePillEl.textContent = stateLabel;
    els.marketStatePillEl.classList.remove("hidden");
    els.marketStatePillEl.classList.toggle("muted", marketState !== "REGULAR");
  } else {
    els.marketStatePillEl.classList.add("hidden");
  }
}

let lastRenderedNewsKey = "";

export function renderNewsItems(items: NewsItem[]): void {
  const key = `${state.selectedTicker}:${items.map((item) => item.id).join(",")}`;
  if (key === lastRenderedNewsKey) {
    return;
  }
  lastRenderedNewsKey = key;

  if (items.length === 0) {
    els.newsGridEl.innerHTML = `<p class="subtle">No recent stories for ${escapeHtml(state.selectedTicker)}.</p>`;
    return;
  }

  els.newsGridEl.innerHTML = items.map((item) => {
    const publishedMs = Number(item.published_utc) * 1000;
    const timeLabel = Number.isFinite(publishedMs) && publishedMs > 0
      ? formatRelativeTime(publishedMs)
      : "";
    const safeUrl = /^https?:\/\//i.test(item.article_url) ? escapeHtml(item.article_url) : "";
    const thumb = /^https?:\/\//i.test(item.image_url)
      ? `<div class="news-thumb"><img src="${escapeHtml(item.image_url)}" alt="" loading="lazy" /></div>`
      : "";

    return `
      <article class="news-card${safeUrl ? " clickable" : ""}" ${safeUrl ? `data-url="${safeUrl}"` : ""}>
        ${thumb}
        <div class="news-body">
          <p class="subtle news-meta">${escapeHtml(item.source || "News")}${timeLabel ? ` · ${timeLabel}` : ""}</p>
          <h3>${escapeHtml(item.title)}</h3>
          <p class="news-desc">${escapeHtml(item.description || "")}</p>
        </div>
      </article>
    `;
  }).join("");
}

export function renderNewsMessage(message: string): void {
  lastRenderedNewsKey = "";
  els.newsGridEl.innerHTML = `<p class="subtle">${escapeHtml(message)}</p>`;
}
