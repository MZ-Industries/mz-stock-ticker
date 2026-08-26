import { beforeEach, describe, expect, it } from "vitest";
import { reorderWatchlistSymbols } from "../layout";
import { state } from "../store";

describe("reorderWatchlistSymbols", () => {
  beforeEach(() => {
    state.watchlistSymbols = ["AAPL", "MSFT", "NVDA", "AMZN"];
  });

  it("moves a symbol before the target", () => {
    expect(reorderWatchlistSymbols("AMZN", "MSFT", false))
      .toEqual(["AAPL", "AMZN", "MSFT", "NVDA"]);
  });

  it("moves a symbol after the target", () => {
    expect(reorderWatchlistSymbols("AAPL", "NVDA", true))
      .toEqual(["MSFT", "NVDA", "AAPL", "AMZN"]);
  });

  it("accounts for the removal shifting indices when dragging downward", () => {
    expect(reorderWatchlistSymbols("AAPL", "MSFT", true))
      .toEqual(["MSFT", "AAPL", "NVDA", "AMZN"]);
  });

  it("returns null for no-ops and unknown symbols", () => {
    expect(reorderWatchlistSymbols("AAPL", "AAPL", false)).toBeNull();
    expect(reorderWatchlistSymbols("TSLA", "AAPL", false)).toBeNull();
  });

  it("does not mutate the source list", () => {
    reorderWatchlistSymbols("AAPL", "NVDA", true);
    expect(state.watchlistSymbols).toEqual(["AAPL", "MSFT", "NVDA", "AMZN"]);
  });
});
