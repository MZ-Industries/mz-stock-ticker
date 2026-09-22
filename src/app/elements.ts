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
  studyToggleEl: HTMLButtonElement;
  studyMenuEl: HTMLDivElement;
  studyFilterEl: HTMLInputElement;
  studyListEl: HTMLDivElement;
  chartStackEl: HTMLDivElement;
  lowerPanesEl: HTMLDivElement;
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
  prefsOverlayEl: HTMLDivElement;
  prefsFormEl: HTMLFormElement;
  prefsCloseEl: HTMLButtonElement;
  prefsCancelEl: HTMLButtonElement;
  prefsSaveEl: HTMLButtonElement;
  prefsStatusEl: HTMLSpanElement;
  prefsYahooBaseEl: HTMLInputElement;
  prefsYahooNewsBaseEl: HTMLInputElement;
  prefsBackfillKeyEl: HTMLInputElement;
  prefsBackfillBaseEl: HTMLInputElement;
  prefsPollMsEl: HTMLInputElement;
  prefsDebugEl: HTMLInputElement;
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
    studyToggleEl: root.querySelector("#study-toggle") as HTMLButtonElement,
    studyMenuEl: root.querySelector("#study-menu") as HTMLDivElement,
    studyFilterEl: root.querySelector("#study-filter") as HTMLInputElement,
    studyListEl: root.querySelector("#study-list") as HTMLDivElement,
    chartStackEl: root.querySelector("#chart-stack") as HTMLDivElement,
    lowerPanesEl: root.querySelector("#lower-panes") as HTMLDivElement,
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
    prefsOverlayEl: root.querySelector("#prefs-overlay") as HTMLDivElement,
    prefsFormEl: root.querySelector("#prefs-form") as HTMLFormElement,
    prefsCloseEl: root.querySelector("#prefs-close") as HTMLButtonElement,
    prefsCancelEl: root.querySelector("#prefs-cancel") as HTMLButtonElement,
    prefsSaveEl: root.querySelector("#prefs-save") as HTMLButtonElement,
    prefsStatusEl: root.querySelector("#prefs-status") as HTMLSpanElement,
    prefsYahooBaseEl: root.querySelector("#prefs-yahoo-base") as HTMLInputElement,
    prefsYahooNewsBaseEl: root.querySelector("#prefs-yahoo-news-base") as HTMLInputElement,
    prefsBackfillKeyEl: root.querySelector("#prefs-backfill-key") as HTMLInputElement,
    prefsBackfillBaseEl: root.querySelector("#prefs-backfill-base") as HTMLInputElement,
    prefsPollMsEl: root.querySelector("#prefs-poll-ms") as HTMLInputElement,
    prefsDebugEl: root.querySelector("#prefs-debug") as HTMLInputElement,
  };

  return els;
}
