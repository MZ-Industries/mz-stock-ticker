import { TickMarkType, type UTCTimestamp } from "lightweight-charts";
import { describe, expect, it } from "vitest";
import {
  clamp,
  escapeHtml,
  fmtCompact,
  fmtPct,
  formatAxisTime,
  isRateLimitError,
  lowerPaneHeights,
  normalizeChartLinesByTicker,
  normalizeLowerPaneWeights,
  normalizeMovingAveragePeriods,
  normalizeStoredRatio,
  normalizeTicker,
  normalizeVisibleRangesByViewKey,
  normalizeWatchlistSymbols,
  parseRetryAfterSeconds,
  splitPaneWeights,
} from "../utils";

describe("parseRetryAfterSeconds", () => {
  it("extracts the retry hint from a backend rate-limit error", () => {
    expect(parseRetryAfterSeconds("RATE_LIMITED:quote:retry_after=120")).toBe(120);
  });

  it("caps absurd retry hints at ten minutes", () => {
    expect(parseRetryAfterSeconds("retry_after=86400")).toBe(600);
  });

  it("returns null when no hint is present", () => {
    expect(parseRetryAfterSeconds("Network error")).toBeNull();
    expect(parseRetryAfterSeconds("retry_after=0")).toBeNull();
  });
});

describe("isRateLimitError", () => {
  it("matches both the sentinel and a raw 429", () => {
    expect(isRateLimitError("RATE_LIMITED:aggs:retry_after=90")).toBe(true);
    expect(isRateLimitError("Yahoo API error: HTTP 429")).toBe(true);
    expect(isRateLimitError("HTTP 500")).toBe(false);
  });
});

describe("normalizeTicker", () => {
  it("uppercases and trims valid symbols", () => {
    expect(normalizeTicker(" brk-b ")).toBe("BRK-B");
    expect(normalizeTicker("aapl")).toBe("AAPL");
  });

  it("rejects invalid symbols", () => {
    expect(normalizeTicker("")).toBeNull();
    expect(normalizeTicker("TOO_LONG_SYMBOL")).toBeNull();
    expect(normalizeTicker("<script>")).toBeNull();
  });
});

describe("normalizeWatchlistSymbols", () => {
  it("dedupes, validates, and caps the list", () => {
    expect(normalizeWatchlistSymbols(["aapl", "AAPL", "msft", 42, "bad ticker"]))
      .toEqual(["AAPL", "MSFT"]);
    expect(normalizeWatchlistSymbols("nope")).toEqual([]);
  });
});

describe("normalizeMovingAveragePeriods", () => {
  it("keeps only allowed periods, sorted", () => {
    expect(normalizeMovingAveragePeriods([200, 20, 999], [20, 50, 200])).toEqual([20, 200]);
  });

  it("falls back when nothing valid remains", () => {
    expect(normalizeMovingAveragePeriods([999], [20, 50, 200], [200])).toEqual([200]);
    expect(normalizeMovingAveragePeriods(undefined, [20, 50, 200], [200])).toEqual([200]);
  });
});

describe("normalizeVisibleRangesByViewKey", () => {
  it("drops malformed entries", () => {
    expect(normalizeVisibleRangesByViewKey({
      "AAPL:1D": { from: 1, to: 5 },
      "MSFT:1W": { from: "x", to: 5 },
      "NVDA:1M": null,
    })).toEqual({ "AAPL:1D": { from: 1, to: 5 } });
  });
});

describe("normalizeStoredRatio", () => {
  it("converts legacy pixel values into ratios", () => {
    expect(normalizeStoredRatio(500, 1000, 0.4, 0.9)).toBeCloseTo(0.5);
  });

  it("clamps ratios into the allowed band", () => {
    expect(normalizeStoredRatio(0.95, 1000, 0.4, 0.9)).toBeCloseTo(0.9);
    expect(normalizeStoredRatio(0.1, 1000, 0.4, 0.9)).toBeCloseTo(0.4);
  });
});

describe("escapeHtml", () => {
  it("escapes all HTML metacharacters", () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')" & more>`))
      .toBe("&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot; &amp; more&gt;");
  });
});

describe("fmtCompact", () => {
  it("scales into K/M/B/T", () => {
    expect(fmtCompact(1_234)).toBe("1.2K");
    expect(fmtCompact(45_600_000)).toBe("45.60M");
    expect(fmtCompact(7_890_000_000)).toBe("7.89B");
    expect(fmtCompact(1_230_000_000_000)).toBe("1.23T");
    expect(fmtCompact(Number.NaN)).toBe("--");
  });
});

describe("fmtPct / clamp", () => {
  it("signs percentages", () => {
    expect(fmtPct(1.234)).toBe("+1.23%");
    expect(fmtPct(-0.5)).toBe("-0.50%");
  });

  it("clamps", () => {
    expect(clamp(0, 1, 5)).toBe(1);
    expect(clamp(0, 1, -5)).toBe(0);
  });
});

describe("formatAxisTime", () => {
  // 2026-08-28 14:30 ET (18:30 UTC), a regular-session minute bar.
  const intradayTime = Math.floor(Date.UTC(2026, 7, 28, 18, 30) / 1000) as UTCTimestamp;

  it("labels intra-day ticks with a clock time", () => {
    expect(formatAxisTime(intradayTime, TickMarkType.Time, "minute", false)).toBe("14:30");
  });

  it("adds the date to intra-day ticks when the view spans multiple days", () => {
    expect(formatAxisTime(intradayTime, TickMarkType.Time, "minute", true)).toBe("Aug 28 14:30");
  });

  it("labels day-boundary ticks with a date even on intraday timespans", () => {
    expect(formatAxisTime(intradayTime, TickMarkType.DayOfMonth, "minute", false)).toBe("Aug 28");
  });

  it("labels month- and year-boundary ticks at coarser granularity", () => {
    expect(formatAxisTime(intradayTime, TickMarkType.Month, "minute", true)).toBe("Aug");
    expect(formatAxisTime(intradayTime, TickMarkType.Year, "hour", true)).toBe("2026");
  });

  it("never shows a clock time on the day timespan", () => {
    expect(formatAxisTime(intradayTime, TickMarkType.Time, "day", true)).toBe("Aug 28");
  });
});

describe("normalizeChartLinesByTicker", () => {
  it("keeps well-formed lines of both kinds", () => {
    const lines = {
      AAPL: [
        { id: "a", kind: "horizontal", price: 187.5, color: "#f59e0b" },
        { id: "b", kind: "vertical", timeMs: 1_700_000_000_000, color: "#60A5FA" },
      ],
    };
    expect(normalizeChartLinesByTicker(lines)).toEqual(lines);
  });

  it("drops malformed lines and symbols left empty", () => {
    expect(normalizeChartLinesByTicker({
      AAPL: [
        { id: "a", kind: "horizontal", price: "x", color: "#f59e0b" },
        { id: "b", kind: "vertical", timeMs: 1, color: "red;background:url(x)" },
        { kind: "horizontal", price: 1, color: "#f59e0b" },
        { id: "c", kind: "diagonal", price: 1, color: "#f59e0b" },
      ],
      MSFT: "nope",
    })).toEqual({});
    expect(normalizeChartLinesByTicker(null)).toEqual({});
  });
});

describe("splitPaneWeights", () => {
  const even = { heightPx: 200, weight: 1 };

  it("moves height from the pane below to the pane above", () => {
    const [above, below] = splitPaneWeights(even, even, 100, 84);
    expect(above).toBeCloseTo(1.5);
    expect(below).toBeCloseTo(0.5);
  });

  it("conserves the pair's combined weight", () => {
    const [above, below] = splitPaneWeights({ heightPx: 300, weight: 3 }, { heightPx: 100, weight: 1 }, -50, 84);
    expect(above + below).toBeCloseTo(4);
  });

  it("never shrinks either pane below the minimum", () => {
    expect(splitPaneWeights(even, even, 1000, 84)[1]).toBeCloseTo((84 / 400) * 2);
    expect(splitPaneWeights(even, even, -1000, 84)[0]).toBeCloseTo((84 / 400) * 2);
  });

  it("leaves the weights alone when there is nothing to split", () => {
    expect(splitPaneWeights({ heightPx: 0, weight: 2 }, { heightPx: 0, weight: 1 }, 50, 84)).toEqual([2, 1]);
  });
});

describe("normalizeLowerPaneWeights", () => {
  it("keeps valid weights and clamps extremes", () => {
    expect(normalizeLowerPaneWeights({ volume: 1.5, rsi: 0.01, macd: 500 })).toEqual({
      volume: 1.5,
      rsi: 0.1,
      macd: 20,
    });
  });

  it("drops junk", () => {
    expect(normalizeLowerPaneWeights({ volume: -1, rsi: "2", macd: Number.NaN })).toEqual({});
    expect(normalizeLowerPaneWeights(null)).toEqual({});
    expect(normalizeLowerPaneWeights([1, 2])).toEqual({});
  });
});

describe("lowerPaneHeights", () => {
  it("shares the space by weight", () => {
    expect(lowerPaneHeights(400, [1, 1, 2], 40, 84)).toEqual([100, 100, 200]);
  });

  it("keeps a squeezed pane at the floor and shares the rest", () => {
    const heights = lowerPaneHeights(300, [0.1, 1, 1], 40, 84);
    expect(heights[0]).toBe(40);
    expect(heights[1]).toBeCloseTo(130);
    expect(heights[2]).toBeCloseTo(130);
  });

  it("falls back to equal comfortable heights, and scrolling, when space runs out", () => {
    expect(lowerPaneHeights(200, [3, 1, 1], 40, 84)).toEqual([84, 84, 84]);
  });

  it("always fills the space it is given", () => {
    const heights = lowerPaneHeights(517, [0.2, 5, 1, 0.3], 40, 84);
    expect(heights.reduce((sum, height) => sum + height, 0)).toBeCloseTo(517);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(40);
  });
});
