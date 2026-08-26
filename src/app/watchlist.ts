import { els } from "./elements";
import { state } from "./store";
import { escapeHtml, fmtNumber, fmtPct } from "./utils";
import type { SnapshotItem } from "./types";

export type WatchlistBadgeMode = "percent" | "delta";

function currentBadgeMode(): WatchlistBadgeMode {
  return state.prefs.watchlistBadgeMode === "delta" ? "delta" : "percent";
}

function fmtDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtNumber(value)}`;
}

function getWatchlistDisplay(item?: SnapshotItem): {
  price: string;
  change: string;
  cls: string;
  sessionLabel: string;
} {
  const hasAfterHours = item
    && Number.isFinite(item.post_market_price)
    && Number.isFinite(item.post_market_change_percent);
  const hasPreMarket = !hasAfterHours
    && item
    && Number.isFinite(item.pre_market_price)
    && Number.isFinite(item.pre_market_change_percent);

  const displayPrice = hasAfterHours
    ? (item?.post_market_price as number)
    : hasPreMarket
      ? (item?.pre_market_price as number)
      : item?.price;
  const displayChangePct = hasAfterHours
    ? (item?.post_market_change_percent as number)
    : hasPreMarket
      ? (item?.pre_market_change_percent as number)
      : item?.change_percent;

  let change = "--";
  if (displayChangePct !== undefined && item) {
    if (currentBadgeMode() === "delta") {
      let delta: number | null = null;
      if (hasAfterHours || hasPreMarket) {
        // Extended-hours move is measured from the official close.
        if (Number.isFinite(item.price) && item.price > 0) {
          delta = (displayPrice as number) - item.price;
        }
      } else {
        const previousClose = Number.isFinite(item.previous_close) && (item.previous_close as number) > 0
          ? (item.previous_close as number)
          : Math.abs(100 + item.change_percent) > Number.EPSILON
            ? (item.price * 100) / (100 + item.change_percent)
            : Number.NaN;
        if (Number.isFinite(previousClose)) {
          delta = item.price - previousClose;
        }
      }

      change = delta !== null && Number.isFinite(delta) ? fmtDelta(delta) : fmtPct(displayChangePct);
    } else {
      change = fmtPct(displayChangePct);
    }
  }

  const price = displayPrice !== undefined ? fmtNumber(displayPrice) : "--";
  const cls = displayChangePct !== undefined && displayChangePct >= 0 ? "up" : "down";
  const sessionLabel = hasAfterHours ? " AH" : hasPreMarket ? " PM" : "";

  return { price, change, cls, sessionLabel };
}

export function cycleWatchlistBadgeMode(): WatchlistBadgeMode {
  const next: WatchlistBadgeMode = currentBadgeMode() === "percent" ? "delta" : "percent";
  state.prefs.watchlistBadgeMode = next;
  return next;
}

export function renderSparklineSvg(prices: number[], isPositive: boolean): string {
  if (prices.length < 2) {
    return "";
  }

  const w = 64;
  const h = 28;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((p - min) / range) * (h - 6) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = isPositive ? "#34d399" : "#f87171";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none"><polyline points="${pts}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export function patchWatchlistRow(ticker: string): void {
  const rowButton = els.watchlistListEl.querySelector(`[data-ticker="${ticker}"]`) as HTMLButtonElement | null;
  if (!rowButton) {
    return;
  }

  const display = getWatchlistDisplay(state.latestSnapshotsByTicker.get(ticker));

  const priceEl = rowButton.querySelector(".watch-price") as HTMLSpanElement | null;
  const changeEl = rowButton.querySelector(".watch-change-badge") as HTMLSpanElement | null;
  if (priceEl) {
    priceEl.textContent = display.price;
  }
  if (changeEl) {
    changeEl.textContent = `${display.change}${display.sessionLabel}`;
    changeEl.className = `watch-change-badge ${display.cls}`;
  }

  const sparklineEl = rowButton.querySelector(".watch-sparkline") as HTMLDivElement | null;
  const sparklinePrices = state.latestSparklinesByTicker.get(ticker);
  if (sparklineEl && sparklinePrices && sparklinePrices.length >= 2) {
    sparklineEl.innerHTML = renderSparklineSvg(sparklinePrices, display.cls === "up");
  }
}

export function renderWatchlistRows(): void {
  const { watchlistSymbols, selectedTicker, latestSparklinesByTicker, latestSnapshotsByTicker } = state;

  els.watchlistListEl.innerHTML = watchlistSymbols.map((ticker) => {
    const snapshot = latestSnapshotsByTicker.get(ticker);
    const display = getWatchlistDisplay(snapshot);
    const selected = ticker === selectedTicker ? "selected" : "";
    const name = snapshot?.name ?? "";

    const sparklinePrices = latestSparklinesByTicker.get(ticker);
    const sparklineSvg = sparklinePrices && sparklinePrices.length >= 2
      ? renderSparklineSvg(sparklinePrices, display.cls === "up")
      : "";

    return `
      <div class="watch-row-wrap" data-order-ticker="${ticker}" title="Drag to reorder ${ticker}">
        <button class="watch-row ${selected}" data-ticker="${ticker}">
          <div class="watch-identity">
            <span class="watch-ticker">${ticker}</span>
            ${name ? `<span class="watch-name">${escapeHtml(name)}</span>` : ""}
          </div>
          <div class="watch-sparkline">${sparklineSvg}</div>
          <div class="watch-prices">
            <span class="watch-price">${display.price}</span>
            <span class="watch-change-badge ${display.cls}" title="Click to toggle % / $ change">${display.change}${display.sessionLabel}</span>
          </div>
        </button>
        <button class="watch-remove" data-remove-ticker="${ticker}" aria-label="Remove ${ticker}">x</button>
      </div>
    `;
  }).join("");
}

export type WatchlistDragDeps = {
  watchlistListEl: HTMLDivElement;
  onReorder: (draggedTicker: string, targetTicker: string, placeAfter: boolean) => boolean;
  onSelectTicker: (ticker: string) => Promise<void>;
  onRenderRows: () => void;
  onBadgeClick: () => void;
  setSuppressWatchlistClick: (value: boolean) => void;
};

export function setupWatchlistDragAndDrop(deps: WatchlistDragDeps): void {
  const {
    watchlistListEl,
    onReorder,
    onSelectTicker,
    onRenderRows,
    onBadgeClick,
    setSuppressWatchlistClick,
  } = deps;

  let draggingTicker: string | null = null;
  let draggingPointerId: number | null = null;
  let draggingStarted = false;
  let draggingStartY = 0;
  let pointerDownOnBadge = false;
  let pendingDropInfo: { targetTicker: string; placeAfter: boolean } | null = null;

  const clearDragStyling = () => {
    watchlistListEl.querySelectorAll(".watch-row-wrap").forEach((row) => {
      row.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
    });
  };

  const getDropTargetInfo = (clientY: number): { targetTicker: string; placeAfter: boolean } | null => {
    const rows = Array.from(
      watchlistListEl.querySelectorAll("[data-order-ticker]"),
    ) as HTMLDivElement[];

    if (rows.length === 0) {
      return null;
    }

    const activeRows = rows.filter((row) => row.dataset.orderTicker !== draggingTicker);
    if (activeRows.length === 0) {
      return null;
    }

    for (const row of activeRows) {
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        const ticker = row.dataset.orderTicker;
        return ticker ? { targetTicker: ticker, placeAfter: false } : null;
      }
    }

    const lastRow = activeRows[activeRows.length - 1];
    const lastTicker = lastRow.dataset.orderTicker;
    return lastTicker ? { targetTicker: lastTicker, placeAfter: true } : null;
  };

  const renderDropIndicator = (dropInfo: { targetTicker: string; placeAfter: boolean } | null): void => {
    clearDragStyling();

    if (!draggingTicker || !dropInfo) {
      return;
    }

    const draggingRow = watchlistListEl.querySelector(
      `[data-order-ticker="${draggingTicker}"]`,
    ) as HTMLDivElement | null;
    draggingRow?.classList.add("dragging");

    const targetRow = watchlistListEl.querySelector(
      `[data-order-ticker="${dropInfo.targetTicker}"]`,
    ) as HTMLDivElement | null;
    if (!targetRow || dropInfo.targetTicker === draggingTicker) {
      return;
    }

    targetRow.classList.add(dropInfo.placeAfter ? "drag-over-bottom" : "drag-over-top");
  };

  const cleanupPointerDrag = () => {
    draggingTicker = null;
    draggingPointerId = null;
    draggingStarted = false;
    pointerDownOnBadge = false;
    pendingDropInfo = null;
    clearDragStyling();
  };

  watchlistListEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("[data-remove-ticker]")) {
      return;
    }

    const row = target.closest("[data-order-ticker]") as HTMLDivElement | null;
    if (!row) {
      return;
    }

    draggingTicker = row.dataset.orderTicker ?? null;
    if (!draggingTicker) {
      return;
    }

    draggingPointerId = event.pointerId;
    draggingStartY = event.clientY;
    draggingStarted = false;
    pointerDownOnBadge = Boolean(target.closest(".watch-change-badge"));
    pendingDropInfo = null;

    try {
      row.setPointerCapture(event.pointerId);
    } catch {
      // Ignore environments that do not support pointer capture on this element.
    }
  });

  watchlistListEl.addEventListener("pointermove", (event) => {
    if (!draggingTicker || draggingPointerId !== event.pointerId) {
      return;
    }

    const movement = Math.abs(event.clientY - draggingStartY);
    if (!draggingStarted && movement < 4) {
      return;
    }

    draggingStarted = true;
    const dropInfo = getDropTargetInfo(event.clientY);
    pendingDropInfo = dropInfo;
    renderDropIndicator(dropInfo);
    event.preventDefault();
  });

  watchlistListEl.addEventListener("pointerup", (event) => {
    if (!draggingTicker || draggingPointerId !== event.pointerId) {
      return;
    }

    if (draggingStarted && pendingDropInfo) {
      if (onReorder(draggingTicker, pendingDropInfo.targetTicker, pendingDropInfo.placeAfter)) {
        onRenderRows();
      }
      setSuppressWatchlistClick(true);
    } else if (!draggingStarted) {
      setSuppressWatchlistClick(true);
      if (pointerDownOnBadge) {
        onBadgeClick();
      } else {
        void onSelectTicker(draggingTicker);
      }
    }

    cleanupPointerDrag();
  });

  watchlistListEl.addEventListener("pointercancel", (event) => {
    if (draggingPointerId !== event.pointerId) {
      return;
    }
    cleanupPointerDrag();
  });

  watchlistListEl.addEventListener("lostpointercapture", () => {
    cleanupPointerDrag();
  });
}
