import {
  CANDLE_INTERVAL_OPTIONS,
  CHART_TYPE_LABELS,
  CHART_TYPES,
  CUSTOM_MOVING_AVERAGE_MAX_PERIOD,
  CUSTOM_MOVING_AVERAGE_MIN_PERIOD,
  CUSTOM_MOVING_AVERAGE_SUGGESTIONS,
  MOVING_AVERAGE_PERIOD_OPTIONS,
  RANGES,
} from "./constants";
import { els } from "./elements";
import { getExtendedStripFromBars, getRangeChange, isCandleIntervalRelevant } from "./market";
import { currentChartViewKey, state } from "./store";
import { STUDIES } from "./studies";
import { escapeHtml, fmtCompact, fmtNumber, fmtPct, formatRelativeTime } from "./utils";
import type { NewsItem } from "./types";

/**
 * Dropdowns hang right-aligned off their button, which runs them off the left
 * of the controls when the chart tools wrap onto a row of their own. Flip those
 * to left-aligned. Call after unhiding the menu, so it can be measured.
 */
export function alignDropdown(menu: HTMLElement): void {
  menu.classList.remove("align-start");
  const bounds = els.controlsEl.getBoundingClientRect();
  if (menu.getBoundingClientRect().left < bounds.left) {
    menu.classList.add("align-start");
  }
}

export function updateHeadline(): void {
  const {
    selectedTicker,
    latestSnapshotsByTicker,
    latestBars,
    latestSymbolDetail,
  } = state;

  const snapshot = latestSnapshotsByTicker.get(selectedTicker);
  // Extended-hours quotes only mean anything against today's session, so the
  // strip is a 1D thing; longer ranges show the change across the range.
  const isIntraday = state.selectedRange.label === "1D";
  const hasPostMarket = isIntraday
    && Number.isFinite(snapshot?.post_market_price)
    && Number.isFinite(snapshot?.post_market_change_percent)
    && Number.isFinite(snapshot?.price)
    && Number.isFinite(snapshot?.change_percent);
  const hasPreMarket = isIntraday
    && !hasPostMarket
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
    els.headlineChangeEl.textContent = fmtPct(stripData.closeChangePct);
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

  if (!isIntraday) {
    // Until the new range's bars land, `latestBars` still belongs to the old
    // selection; leave the headline alone rather than measure the wrong window.
    if (state.loadedViewKey !== currentChartViewKey()) {
      return;
    }
    const rangePrice = Number.isFinite(displayPrice) ? displayPrice : (latestBars[latestBars.length - 1]?.c ?? Number.NaN);
    const rangeChange = getRangeChange({ selectedRange: state.selectedRange, latestBars, currentPrice: rangePrice });
    if (rangeChange) {
      renderHeadlineChange(rangePrice, rangeChange.delta, rangeChange.pct);
      return;
    }
  }

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

  renderHeadlineChange(displayPrice, displayDelta, displayPct);
}

function renderHeadlineChange(price: number, delta: number, pct: number): void {
  els.headlinePriceEl.classList.remove("hidden");
  els.headlinePriceEl.textContent = fmtNumber(price);
  els.headlineChangeEl.classList.remove("hidden");
  els.headlineChangeEl.textContent = `${delta >= 0 ? "+" : ""}${fmtNumber(delta)} (${fmtPct(pct)})`;
  els.headlineChangeEl.className = `subtle ${delta >= 0 ? "up" : "down"}`;
  els.extendedStripEl.classList.add("hidden");
}

/**
 * The custom MA comes first, where MA 20 used to be, then the fixed periods.
 * The group is built once and then only restyled: rebuilding it would throw
 * away the custom field mid-edit whenever anything else re-renders controls.
 */
function renderMovingAverageGroup(): void {
  const group = els.maGroupEl;
  if (!group.querySelector(".ma-custom")) {
    const suggestions = CUSTOM_MOVING_AVERAGE_SUGGESTIONS.map((period) => `<option value="${period}"></option>`).join("");
    group.innerHTML = `<div class="pill ma-custom">`
      + `<button type="button" class="ma-custom-toggle" data-ma-custom-toggle aria-pressed="false" title="Show custom moving average">MA</button>`
      + `<input class="ma-custom-input" data-ma-custom-input type="text" inputmode="numeric" list="ma-custom-suggestions"`
      + ` maxlength="4" size="3" autocomplete="off" spellcheck="false" aria-label="Custom moving average period"`
      + ` title="Period: ${CUSTOM_MOVING_AVERAGE_MIN_PERIOD}-${CUSTOM_MOVING_AVERAGE_MAX_PERIOD} bars" />`
      + `<datalist id="ma-custom-suggestions">${suggestions}</datalist>`
      + `</div>`
      + MOVING_AVERAGE_PERIOD_OPTIONS.map(
        (period) => `<button class="pill" data-ma-period="${period}">MA ${period}</button>`,
      ).join("");
  }

  for (const button of group.querySelectorAll<HTMLButtonElement>("[data-ma-period]")) {
    button.classList.toggle("active", state.selectedMovingAveragePeriods.includes(Number(button.dataset.maPeriod)));
  }

  const custom = state.customMovingAverage;
  group.querySelector(".ma-custom")!.classList.toggle("active", custom.enabled);
  group.querySelector("[data-ma-custom-toggle]")!.setAttribute("aria-pressed", String(custom.enabled));
  const input = group.querySelector<HTMLInputElement>("[data-ma-custom-input]")!;
  if (document.activeElement !== input) {
    input.value = String(custom.period);
  }
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

  renderMovingAverageGroup();

  const activeTypeIndex = Math.max(0, CHART_TYPES.indexOf(state.selectedChartType));
  els.typeGroupEl.style.setProperty("--switch-index", String(activeTypeIndex));
  els.typeGroupEl.innerHTML = CHART_TYPES.map((type) => {
    const active = type === state.selectedChartType;
    return `<button type="button" class="switch-option${active ? " active" : ""}" data-type="${type}" aria-pressed="${active}">${CHART_TYPE_LABELS[type]}</button>`;
  }).join("");

  syncStudyMenuState();
}

/**
 * Builds the study checklist once. The list never changes, so later renders
 * only re-sync the checkboxes - rebuilding would wipe the filter the user is
 * typing and drop focus mid-keystroke.
 */
export function initStudyMenu(): void {
  els.studyListEl.innerHTML = STUDIES.map((study) => `
    <label class="study-item" data-study-label="${escapeHtml(study.label.toLowerCase())}">
      <input type="checkbox" data-study-key="${escapeHtml(study.key)}" />
      <span>${escapeHtml(study.label)}</span>
      <span class="study-placement">${study.placement === "price" ? "overlay" : "pane"}</span>
    </label>
  `).join("");

  syncStudyMenuState();
}

/** Reflects the enabled studies in the checkboxes and the toggle's label. */
export function syncStudyMenuState(): void {
  const enabled = new Set(state.selectedStudyKeys);

  for (const input of els.studyListEl.querySelectorAll("[data-study-key]")) {
    const checkbox = input as HTMLInputElement;
    checkbox.checked = enabled.has(checkbox.dataset.studyKey ?? "");
  }

  els.studyToggleEl.textContent = enabled.size > 0 ? `Studies (${enabled.size})` : "Studies";
  els.studyToggleEl.classList.toggle("active", enabled.size > 0);
}

/** Hides study rows that do not match the filter box. */
export function filterStudyMenu(query: string): void {
  const needle = query.trim().toLowerCase();

  for (const node of els.studyListEl.querySelectorAll(".study-item")) {
    const item = node as HTMLElement;
    const label = item.dataset.studyLabel ?? "";
    item.classList.toggle("hidden", needle.length > 0 && !label.includes(needle));
  }
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
