import { TickMarkType, type UTCTimestamp } from "lightweight-charts";
import { describe, expect, it } from "vitest";
import {
  clamp,
  escapeHtml,
  fmtCompact,
  fmtPct,
  formatAxisTime,
  isRateLimitError,
  normalizeMovingAveragePeriods,
  normalizeStoredRatio,
  normalizeTicker,
  normalizeVisibleRangesByViewKey,
  normalizeWatchlistSymbols,
  parseRetryAfterSeconds,
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
