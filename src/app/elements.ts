export type AppElements = {
  watchlistEl: HTMLDivElement;
  watchlistListEl: HTMLDivElement;
  watchlistAddFormEl: HTMLFormElement;
  watchlistAddInputEl: HTMLInputElement;
  rangeGroupEl: HTMLDivElement;
  intervalGroupEl: HTMLDivElement;
  typeGroupEl: HTMLDivElement;
  maGroupEl: HTMLDivElement;
  headlinePriceEl: HTMLParagraphElement;
  headlineChangeEl: HTMLParagraphElement;
  titleTickerEl: HTMLHeadingElement;
  extendedStripEl: HTMLDivElement;
  closePriceEl: HTMLParagraphElement;
  closeChangeEl: HTMLParagraphElement;
  afterPriceEl: HTMLParagraphElement;
  afterChangeEl: HTMLParagraphElement;
  afterLabelEl: HTMLParagraphElement;
  refreshProgressEl: HTMLDivElement;
  refreshProgressFillEl: HTMLDivElement;
  providerPillEl: HTMLSpanElement;
  streamPillEl: HTMLSpanElement;
  lagPillEl: HTMLSpanElement;
};

export function getAppElements(root: ParentNode = document): AppElements {
  const afterChangeEl = root.querySelector("#after-change") as HTMLParagraphElement;

  return {
    watchlistEl: root.querySelector("#watchlist") as HTMLDivElement,
    watchlistListEl: root.querySelector("#watchlist-list") as HTMLDivElement,
    watchlistAddFormEl: root.querySelector("#watchlist-add-form") as HTMLFormElement,
    watchlistAddInputEl: root.querySelector("#watchlist-add-input") as HTMLInputElement,
    rangeGroupEl: root.querySelector("#range-group") as HTMLDivElement,
    intervalGroupEl: root.querySelector("#interval-group") as HTMLDivElement,
    typeGroupEl: root.querySelector("#type-group") as HTMLDivElement,
    maGroupEl: root.querySelector("#ma-group") as HTMLDivElement,
    headlinePriceEl: root.querySelector("#headline-price") as HTMLParagraphElement,
    headlineChangeEl: root.querySelector("#headline-change") as HTMLParagraphElement,
    titleTickerEl: root.querySelector("#title-ticker") as HTMLHeadingElement,
    extendedStripEl: root.querySelector("#extended-strip") as HTMLDivElement,
    closePriceEl: root.querySelector("#close-price") as HTMLParagraphElement,
    closeChangeEl: root.querySelector("#close-change") as HTMLParagraphElement,
    afterPriceEl: root.querySelector("#after-price") as HTMLParagraphElement,
    afterChangeEl,
    afterLabelEl: afterChangeEl.nextElementSibling as HTMLParagraphElement,
    refreshProgressEl: root.querySelector("#refresh-progress") as HTMLDivElement,
    refreshProgressFillEl: root.querySelector("#refresh-progress-fill") as HTMLDivElement,
    providerPillEl: root.querySelector("#provider-pill") as HTMLSpanElement,
    streamPillEl: root.querySelector("#stream-pill") as HTMLSpanElement,
    lagPillEl: root.querySelector("#lag-pill") as HTMLSpanElement,
  };
}
