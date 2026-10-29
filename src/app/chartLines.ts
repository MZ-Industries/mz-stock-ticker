import {
  beginLinePlacement,
  cancelLinePlacement,
  chartedTicker,
  chartLineAt,
  chartLinesFor,
  syncChartLines,
} from "./chartPanel";
import { els } from "./elements";
import { IS_MOBILE } from "./platform";
import { currentAggregationPreset, persistPrefs, state } from "./store";
import { alignDropdown } from "./ui";
import { escapeHtml, getNyParts, nyWallTimeToMs } from "./utils";
import type { ChartLine, ChartLineAnchor, ChartLineKind } from "./types";

const LINE_COLORS = [
  { color: "#f59e0b", name: "Amber" },
  { color: "#2dd4bf", name: "Teal" },
  { color: "#60a5fa", name: "Blue" },
  { color: "#a78bfa", name: "Violet" },
  { color: "#fb7185", name: "Pink" },
  { color: "#34d399", name: "Green" },
  { color: "#f87171", name: "Red" },
  { color: "#e2e8f0", name: "White" },
] as const;

/** Keeps the context menu this far inside the window edges. */
const MENU_EDGE_MARGIN_PX = 8;
/** How long a finger must rest on a line to open its menu on touch screens. */
const LONG_PRESS_MS = 500;
/** Movement that turns a long-press into a pan. */
const LONG_PRESS_SLOP_PX = 8;
/** A fingertip is far less precise than a mouse pointer. */
const TOUCH_LINE_HIT_TOLERANCE_PX = 16;

let placingKind: ChartLineKind | null = null;
/** The line the context menu is open on, and the symbol it belongs to. */
let menuTarget: { ticker: string; id: string } | null = null;

function newLineId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Single path for changing a symbol's lines: persist, then redraw. */
function writeLines(ticker: string, lines: ChartLine[]): void {
  const next = { ...(state.prefs.chartLinesByTicker ?? {}) };
  if (lines.length > 0) {
    next[ticker] = lines;
  } else {
    delete next[ticker];
  }

  state.prefs.chartLinesByTicker = next;
  persistPrefs();
  syncChartLines();
}

/** Toolbar button label and the Clear-all row follow the charted symbol's lines. */
export function syncLineToolbar(lines: ChartLine[] = chartLinesFor(chartedTicker())): void {
  const toggle = els.lineToggleEl;
  toggle.textContent = placingKind
    ? IS_MOBILE ? "Drag on chart to place" : "Click chart to place"
    : lines.length > 0 ? `Lines (${lines.length})` : "Lines";
  toggle.classList.toggle("active", lines.length > 0 || placingKind !== null);
  toggle.classList.toggle("placing", placingKind !== null);

  const clearAll = els.lineDropdownEl.querySelector("[data-line-clear-all]") as HTMLButtonElement;
  clearAll.disabled = lines.length === 0;
}

function setDropdownOpen(open: boolean): void {
  els.lineDropdownEl.classList.toggle("hidden", !open);
  els.lineToggleEl.setAttribute("aria-expanded", String(open));
  if (open) {
    alignDropdown(els.lineDropdownEl);
  }
}

function startPlacing(kind: ChartLineKind): void {
  placingKind = kind;
  beginLinePlacement(kind);
  syncLineToolbar();
}

function stopPlacing(): void {
  if (placingKind === null) {
    return;
  }
  placingKind = null;
  cancelLinePlacement();
  syncLineToolbar();
}

export function addChartLine(anchor: ChartLineAnchor): void {
  placingKind = null;
  const ticker = chartedTicker();
  const line: ChartLine = { ...anchor, id: newLineId(), color: LINE_COLORS[0].color };
  writeLines(ticker, [...chartLinesFor(ticker), line]);
}

/** Daily and longer bars have no time of day worth editing. */
function editsDateOnly(): boolean {
  return currentAggregationPreset().timespan === "day";
}

/** What the menu's value field shows for a line, in the format its input takes. */
function lineValueText(line: ChartLine): string {
  if (line.kind === "horizontal") {
    // Sub-dollar symbols need more than cents to tell levels apart.
    return String(Number(line.price.toFixed(Math.abs(line.price) < 1 ? 4 : 2)));
  }
  const ny = getNyParts(line.timeMs);
  if (editsDateOnly()) {
    return ny.date;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${ny.date}T${pad(ny.hour % 24)}:${pad(ny.minute)}`;
}

/** The anchor typed into the menu's value field, or null if it doesn't parse. */
function parseLineValue(line: ChartLine, raw: string): ChartLine | null {
  const text = raw.trim();
  if (line.kind === "horizontal") {
    const price = Number(text.replace(/,/g, ""));
    return text !== "" && Number.isFinite(price) ? { ...line, price } : null;
  }

  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(text);
  if (!match) {
    return null;
  }
  // A date alone lands at New York midday, inside that day's bar whether the
  // provider stamps it at midnight or at the open.
  const [, date, hour = "12", minute = "0"] = match;
  const timeMs = nyWallTimeToMs(date, Number(hour), Number(minute));
  return Number.isFinite(timeMs) ? { ...line, timeMs } : null;
}

function syncLineValueField(line: ChartLine): void {
  const input = els.lineValueInputEl;
  input.removeAttribute("aria-invalid");
  if (line.kind === "horizontal") {
    els.lineValueLabelEl.textContent = "Price";
    input.type = "text";
    input.inputMode = "decimal";
  } else {
    els.lineValueLabelEl.textContent = editsDateOnly() ? "Date (New York)" : "Date & time (New York)";
    input.type = editsDateOnly() ? "date" : "datetime-local";
    input.inputMode = "";
  }
  input.value = lineValueText(line);
}

/**
 * iOS lays the keyboard over the page rather than shrinking it, which would
 * bury the bottom-sheet menu while its value field is being typed into.
 */
function trackKeyboardInset(): void {
  const viewport = window.visualViewport;
  if (!viewport) {
    return;
  }
  const sync = () => {
    const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    els.lineContextMenuEl.style.setProperty("--keyboard-inset", `${inset}px`);
  };
  viewport.addEventListener("resize", sync);
  viewport.addEventListener("scroll", sync);
}

function closeContextMenu(): void {
  menuTarget = null;
  els.lineContextMenuEl.classList.add("hidden");
}

function openContextMenu(id: string, clientX: number, clientY: number): void {
  const ticker = chartedTicker();
  const line = chartLinesFor(ticker).find((item) => item.id === id);
  if (!line) {
    return;
  }

  menuTarget = { ticker, id };
  els.lineSwatchesEl.innerHTML = LINE_COLORS.map(({ color, name }) => `
    <button type="button" class="line-swatch${color === line.color ? " selected" : ""}" data-line-color="${color}"
      style="--swatch:${color}" title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}"></button>
  `).join("");
  syncLineValueField(line);

  const menu = els.lineContextMenuEl;
  menu.classList.remove("hidden");
  const maxLeft = window.innerWidth - menu.offsetWidth - MENU_EDGE_MARGIN_PX;
  const maxTop = window.innerHeight - menu.offsetHeight - MENU_EDGE_MARGIN_PX;
  menu.style.left = `${Math.max(MENU_EDGE_MARGIN_PX, Math.min(clientX, maxLeft))}px`;
  menu.style.top = `${Math.max(MENU_EDGE_MARGIN_PX, Math.min(clientY, maxTop))}px`;
}

/** Opens the menu for the line under a viewport point; false if there is none. */
function openLineMenuAt(clientX: number, clientY: number, tolerancePx?: number): boolean {
  const id = chartLineAt(clientX, clientY, tolerancePx);
  if (!id) {
    return false;
  }
  stopPlacing();
  setDropdownOpen(false);
  openContextMenu(id, clientX, clientY);
  return true;
}

/**
 * Touch screens have no right-click, so resting a finger on a line opens its
 * menu instead.
 */
function registerLongPressMenu(): void {
  let timer: number | null = null;
  let start: { x: number; y: number } | null = null;
  let suppressClickUntil = 0;

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    start = null;
  };

  els.chartStackEl.addEventListener("pointerdown", (event) => {
    cancel();
    if (!event.isPrimary || placingKind !== null) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    start = point;
    timer = window.setTimeout(() => {
      timer = null;
      if (openLineMenuAt(point.x, point.y, TOUCH_LINE_HIT_TOLERANCE_PX)) {
        // Lifting the finger fires a click, which would close the menu again.
        suppressClickUntil = Date.now() + 700;
      }
    }, LONG_PRESS_MS);
  });

  els.chartStackEl.addEventListener("pointermove", (event) => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) {
      cancel();
    }
  });
  els.chartStackEl.addEventListener("pointerup", cancel);
  els.chartStackEl.addEventListener("pointercancel", cancel);

  window.addEventListener("click", (event) => {
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      event.stopPropagation();
    }
  }, true);
}

function updateMenuTarget(change: (line: ChartLine) => ChartLine | null): void {
  if (!menuTarget) {
    return;
  }

  const { ticker, id } = menuTarget;
  const lines = chartLinesFor(ticker)
    .map((line) => (line.id === id ? change(line) : line))
    .filter((line): line is ChartLine => line !== null);
  writeLines(ticker, lines);
}

export function initChartLines(): void {
  els.lineToggleEl.addEventListener("click", () => {
    if (placingKind !== null) {
      stopPlacing();
      return;
    }
    setDropdownOpen(els.lineDropdownEl.classList.contains("hidden"));
  });

  els.lineDropdownEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const kindButton = target.closest("[data-line-kind]") as HTMLElement | null;
    const kind = kindButton?.dataset.lineKind;

    if (kind === "horizontal" || kind === "vertical") {
      setDropdownOpen(false);
      startPlacing(kind);
      return;
    }

    if (target.closest("[data-line-clear-all]")) {
      setDropdownOpen(false);
      writeLines(chartedTicker(), []);
    }
  });

  // The study toggle stops its click from reaching the document, so it has to
  // close this dropdown itself.
  els.studyToggleEl.addEventListener("click", () => setDropdownOpen(false));

  document.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("#line-picker")) {
      setDropdownOpen(false);
    }
    if (!(event.target as HTMLElement).closest("#line-context-menu")) {
      closeContextMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setDropdownOpen(false);
      closeContextMenu();
      stopPlacing();
    }
  });

  els.chartStackEl.addEventListener("contextmenu", (event) => {
    if (openLineMenuAt(event.clientX, event.clientY)) {
      event.preventDefault();
    }
  });

  if (IS_MOBILE) {
    registerLongPressMenu();
  }

  // Hints that a line can be right-clicked.
  els.chartStackEl.addEventListener("mousemove", (event) => {
    const overLine = placingKind === null
      && chartLinesFor(chartedTicker()).length > 0
      && chartLineAt(event.clientX, event.clientY) !== null;
    els.chartStackEl.classList.toggle("line-hover", overLine);
  });

  // A pan or zoom would leave the menu pointing at empty chart.
  els.chartStackEl.addEventListener("wheel", closeContextMenu, { passive: true });
  // ...but the on-screen keyboard opening for the value field resizes the
  // window too, and must not take the menu away with it.
  window.addEventListener("resize", () => {
    if (!els.lineContextMenuEl.contains(document.activeElement)) {
      closeContextMenu();
    }
  });

  els.lineValueFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const line = menuTarget && chartLinesFor(menuTarget.ticker).find((item) => item.id === menuTarget?.id);
    const edited = line ? parseLineValue(line, els.lineValueInputEl.value) : null;
    if (!edited) {
      els.lineValueInputEl.setAttribute("aria-invalid", "true");
      return;
    }
    els.lineValueInputEl.blur();
    updateMenuTarget(() => edited);
    closeContextMenu();
  });

  els.lineValueInputEl.addEventListener("input", () => {
    els.lineValueInputEl.removeAttribute("aria-invalid");
  });

  if (IS_MOBILE) {
    trackKeyboardInset();
  }

  els.lineContextMenuEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const swatch = target.closest("[data-line-color]") as HTMLElement | null;
    const color = swatch?.dataset.lineColor;

    if (color) {
      updateMenuTarget((line) => ({ ...line, color }));
    } else if (target.closest("[data-line-remove]")) {
      updateMenuTarget(() => null);
    } else {
      return;
    }

    closeContextMenu();
  });

  syncLineToolbar([]);
}
