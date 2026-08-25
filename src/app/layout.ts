import { clamp } from "./utils";

export function setupSplitters(params: {
  prefs: {
    sidebarWidth: number;
    pricePaneHeight: number;
    chartAreaHeight: number;
  };
  persistPrefs: () => void;
  minPricePaneRatio: number;
  maxPricePaneRatio: number;
  minChartAreaRatio: number;
  maxChartAreaRatio: number;
}): void {
  const {
    prefs,
    persistPrefs,
    minPricePaneRatio,
    maxPricePaneRatio,
    minChartAreaRatio,
    maxChartAreaRatio,
  } = params;

  const shell = document.querySelector(".app-shell") as HTMLDivElement;
  const mainPanel = document.querySelector(".main-panel") as HTMLDivElement;
  const chartStack = document.querySelector("#chart-stack") as HTMLDivElement;
  const sidebarSplitter = document.querySelector("#sidebar-splitter") as HTMLDivElement;
  const volumeSplitter = document.querySelector("#volume-splitter") as HTMLDivElement;
  const newsSplitter = document.querySelector("#news-splitter") as HTMLDivElement;

  const drag = (move: (x: number, y: number) => void) => (event: PointerEvent) => {
    const onMove = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    event.preventDefault();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  sidebarSplitter.addEventListener(
    "pointerdown",
    drag((x) => {
      const width = Math.max(210, Math.min(420, x));
      shell.style.setProperty("--sidebar-width", `${width}px`);
      prefs.sidebarWidth = width;
      persistPrefs();
    }),
  );

  volumeSplitter.addEventListener(
    "pointerdown",
    drag((_x, y) => {
      const rect = chartStack.getBoundingClientRect();
      const priceHeight = Math.max(220, Math.min(rect.height - 120, y - rect.top));
      const ratio = clamp(minPricePaneRatio, maxPricePaneRatio, priceHeight / Math.max(1, rect.height));
      chartStack.style.setProperty("--price-pane-height", `${(ratio * 100).toFixed(3)}%`);
      prefs.pricePaneHeight = ratio;
      persistPrefs();
    }),
  );

  newsSplitter.addEventListener(
    "pointerdown",
    drag((_x, y) => {
      const panelRect = mainPanel.getBoundingClientRect();
      const chartHeight = Math.max(320, Math.min(panelRect.height - 220, y - panelRect.top - 86));
      const ratio = clamp(minChartAreaRatio, maxChartAreaRatio, chartHeight / Math.max(1, panelRect.height));
      shell.style.setProperty("--chart-area-height", `${(ratio * 100).toFixed(3)}%`);
      prefs.chartAreaHeight = ratio;
      persistPrefs();
    }),
  );
}

export function reorderWatchlistSymbolsAction(
  watchlistSymbols: string[],
  draggedTicker: string,
  targetTicker: string,
  placeAfter: boolean,
): string[] | null {
  if (draggedTicker === targetTicker) {
    return null;
  }

  const fromIndex = watchlistSymbols.indexOf(draggedTicker);
  const toIndex = watchlistSymbols.indexOf(targetTicker);

  if (fromIndex < 0 || toIndex < 0) {
    return null;
  }

  const next = [...watchlistSymbols];
  const [moved] = next.splice(fromIndex, 1);

  let insertIndex = placeAfter ? toIndex + 1 : toIndex;
  if (fromIndex < insertIndex) {
    insertIndex -= 1;
  }

  next.splice(insertIndex, 0, moved);
  return next;
}
