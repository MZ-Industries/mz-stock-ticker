import { describe, expect, it } from "vitest";
import { CANDLE_INTERVAL_OPTIONS, RANGES } from "../constants";
import {
  backfillChunkDays,
  collectRegularSessions,
  effectiveAggregationPreset,
  getBarDateRange,
  isCandleIntervalRelevant,
} from "../market";
import type { AggregateBar, RangePreset } from "../types";

function preset(label: string): RangePreset {
  const found = RANGES.find((range) => range.label === label);
  if (!found) {
    throw new Error(`no preset ${label}`);
  }
  return found;
}

// Timestamps inside a regular NY session (2026-08-21 was a Friday).
const NY_1000 = Date.UTC(2026, 7, 21, 14, 0); // 10:00 ET
const NY_1030 = Date.UTC(2026, 7, 21, 14, 30);
const PREV_DAY_1000 = Date.UTC(2026, 7, 20, 14, 0);
const SAT_0800 = Date.UTC(2026, 7, 22, 12, 0); // Saturday, pre-market-hours clock

function bar(t: number): AggregateBar {
  return { t, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 };
}

describe("isCandleIntervalRelevant", () => {
  it("only applies to OHLC chart types on minute-based ranges", () => {
    expect(isCandleIntervalRelevant("candlestick", preset("1D"))).toBe(true);
    expect(isCandleIntervalRelevant("bar", preset("1W"))).toBe(true);
    expect(isCandleIntervalRelevant("line", preset("1D"))).toBe(false);
    expect(isCandleIntervalRelevant("candlestick", preset("1Y"))).toBe(false);
  });
});

describe("effectiveAggregationPreset", () => {
  it("uses the chosen candle interval when relevant", () => {
    expect(effectiveAggregationPreset("candlestick", preset("1D"), "15m", CANDLE_INTERVAL_OPTIONS))
      .toEqual({ multiplier: 15, timespan: "minute" });
  });

  it("falls back to the range preset otherwise", () => {
    expect(effectiveAggregationPreset("line", preset("1Y"), "15m", CANDLE_INTERVAL_OPTIONS))
      .toEqual({ multiplier: 1, timespan: "day" });
  });
});

describe("getBarDateRange", () => {
  it("starts YTD at January 1 of the current NY year", () => {
    const { from, to } = getBarDateRange(preset("YTD"));
    expect(from).toMatch(/^\d{4}-01-01$/);
    expect(Number(to.slice(0, 4))).toBeGreaterThanOrEqual(Number(from.slice(0, 4)));
  });

  it("looks back a few days for 1D so weekends still resolve a session", () => {
    const { from, to } = getBarDateRange(preset("1D"));
    expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime());
  });
});

describe("collectRegularSessions", () => {
  it("finds one open/close pair per trading day, skipping extended-hours bars", () => {
    const preMarket = Date.UTC(2026, 7, 21, 12, 0); // 08:00 ET
    const sessions = collectRegularSessions([
      bar(PREV_DAY_1000),
      bar(preMarket),
      bar(NY_1000),
      bar(NY_1030),
    ]);

    expect(sessions).toEqual([
      { openMs: PREV_DAY_1000, closeMs: PREV_DAY_1000 },
      { openMs: NY_1000, closeMs: NY_1030 },
    ]);
  });

  it("returns no sessions for a pre-market-only series", () => {
    expect(collectRegularSessions([bar(SAT_0800)])).toEqual([]);
  });

  it("handles an empty series", () => {
    expect(collectRegularSessions([])).toEqual([]);
  });
});

describe("backfillChunkDays", () => {
  it("keeps intraday chunks inside Yahoo's per-request limits", () => {
    expect(backfillChunkDays({ multiplier: 1, timespan: "minute" })).toBe(5);
    expect(backfillChunkDays({ multiplier: 5, timespan: "minute" })).toBe(15);
    expect(backfillChunkDays({ multiplier: 1, timespan: "hour" })).toBe(60);
    expect(backfillChunkDays({ multiplier: 1, timespan: "day" })).toBe(730);
  });
});
