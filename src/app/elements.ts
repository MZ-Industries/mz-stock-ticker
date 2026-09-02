export type AppElements = {
  watchlistEl: HTMLDivElement;
  watchlistListEl: HTMLDivElement;
  watchlistAddFormEl: HTMLFormElement;
  watchlistAddInputEl: HTMLInputElement;
  searchResultsEl: HTMLDivElement;
  rangeGroupEl: HTMLDivElement;
  intervalGroupEl: HTMLDivElement;
  typeGroupEl: HTMLDivElement;
  maGroupEl: HTMLDivElement;
  headlinePriceEl: HTMLParagraphElement;
  headlineChangeEl: HTMLParagraphElement;
  titleTickerEl: HTMLHeadingElement;
  symbolSubtitleEl: HTMLParagraphElement;
  extendedStripEl: HTMLDivElement;
  priceChartEl: HTMLDivElement;
  volumeChartEl: HTMLDivElement;
  statsStripEl: HTMLDivElement;
  newsGridEl: HTMLDivElement;
  refreshProgressEl: HTMLDivElement;
  refreshProgressFillEl: HTMLDivElement;
  providerPillEl: HTMLSpanElement;
  streamPillEl: HTMLSpanElement;
  lagPillEl: HTMLSpanElement;
  marketStatePillEl: HTMLSpanElement;
  updatePillEl: HTMLButtonElement;
};

/** Populated once by initElements() right after the template is injected. */
export let els: AppElements;

export function initElements(root: ParentNode = document): AppElements {
  els = {
    watchlistEl: root.querySelector("#watchlist") as HTMLDivElement,
    watchlistListEl: root.querySelector("#watchlist-list") as HTMLDivElement,
    watchlistAddFormEl: root.querySelector("#watchlist-add-form") as HTMLFormElement,
    watchlistAddInputEl: root.querySelector("#watchlist-add-input") as HTMLInputElement,
    searchResultsEl: root.querySelector("#search-results") as HTMLDivElement,
    rangeGroupEl: root.querySelector("#range-group") as HTMLDivElement,
    intervalGroupEl: root.querySelector("#interval-group") as HTMLDivElement,
    typeGroupEl: root.querySelector("#type-group") as HTMLDivElement,
    maGroupEl: root.querySelector("#ma-group") as HTMLDivElement,
    headlinePriceEl: root.querySelector("#headline-price") as HTMLParagraphElement,
    headlineChangeEl: root.querySelector("#headline-change") as HTMLParagraphElement,
    titleTickerEl: root.querySelector("#title-ticker") as HTMLHeadingElement,
    symbolSubtitleEl: root.querySelector("#symbol-subtitle") as HTMLParagraphElement,
    extendedStripEl: root.querySelector("#extended-strip") as HTMLDivElement,
    priceChartEl: root.querySelector("#price-chart") as HTMLDivElement,
    volumeChartEl: root.querySelector("#volume-chart") as HTMLDivElement,
    statsStripEl: root.querySelector("#stats-strip") as HTMLDivElement,
    newsGridEl: root.querySelector("#news-grid") as HTMLDivElement,
    refreshProgressEl: root.querySelector("#refresh-progress") as HTMLDivElement,
    refreshProgressFillEl: root.querySelector("#refresh-progress-fill") as HTMLDivElement,
    providerPillEl: root.querySelector("#provider-pill") as HTMLSpanElement,
    streamPillEl: root.querySelector("#stream-pill") as HTMLSpanElement,
    lagPillEl: root.querySelector("#lag-pill") as HTMLSpanElement,
    marketStatePillEl: root.querySelector("#market-state-pill") as HTMLSpanElement,
    updatePillEl: root.querySelector("#update-pill") as HTMLButtonElement,
  };

  return els;
}
