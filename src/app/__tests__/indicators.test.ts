import { describe, expect, it } from "vitest";
import {
  atr,
  bollingerBands,
  ema,
  macd,
  parabolicSar,
  rsi,
  sma,
  stochastic,
  vwap,
  wilder,
  williamsR,
  wma,
  zigZag,
} from "../indicators";
import { STUDIES, normalizeStudyKeys } from "../studies";
import type { AggregateBar } from "../types";

function bar(close: number, extras: Partial<AggregateBar> = {}): AggregateBar {
  return {
    t: 0,
    o: close,
    h: close + 1,
    l: close - 1,
    c: close,
    v: 1000,
    ...extras,
  };
}

/** A deterministic random walk on a real intraday clock, for the sweep test. */
function syntheticBars(count: number): AggregateBar[] {
  const bars: AggregateBar[] = [];
  let seed = 1337;
  let price = 100;
  // 2026-01-05 was a Monday; step an hour at a time so several NY sessions and
  // both session-anchored studies (VWAP, pivots) have something to work with.
  let cursor = Date.UTC(2026, 0, 5, 14, 30);

  for (let index = 0; index < count; index += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const drift = (seed / 2147483648 - 0.5) * 2;
    const open = price;
    price = Math.max(1, price + drift);
    const high = Math.max(open, price) + Math.abs(drift) / 2;
    const low = Math.min(open, price) - Math.abs(drift) / 2;

    bars.push({
      t: cursor,
      o: open,
      h: high,
      l: low,
      c: price,
      v: 10_000 + (seed % 5000),
    });

    cursor += 3_600_000;
  }

  return bars;
}

describe("moving averages", () => {
  it("averages a full window and leaves the warm-up empty", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("seeds the EMA with the first complete SMA", () => {
    const values = ema([1, 2, 3, 4, 5], 3);
    expect(values[0]).toBeNull();
    expect(values[1]).toBeNull();
    expect(values[2]).toBe(2);
    // 4 * 0.5 + 2 * 0.5
    expect(values[3]).toBe(3);
    expect(values[4]).toBe(4);
  });

  it("smooths by 1/period in the Wilder variant", () => {
    const values = wilder([1, 2, 3, 4], 2);
    expect(values[1]).toBe(1.5);
    // (1.5 * 1 + 3) / 2
    expect(values[2]).toBe(2.25);
  });

  it("weights the newest bar most in the WMA", () => {
    // (1*1 + 2*2 + 3*3) / 6
    expect(wma([1, 2, 3], 3)?.[2]).toBeCloseTo(14 / 6, 10);
  });

  it("restarts a window that contains a gap", () => {
    expect(sma([1, 2, null, 4, 5, 6], 3)).toEqual([null, null, null, null, null, 5]);
  });
});

describe("rsi", () => {
  it("pins to 100 when every bar closes higher", () => {
    const bars = Array.from({ length: 30 }, (_value, index) => bar(100 + index));
    const values = rsi(bars, 14);
    expect(values[13]).toBeNull();
    expect(values[20]).toBe(100);
  });

  it("pins to 0 when every bar closes lower", () => {
    const bars = Array.from({ length: 30 }, (_value, index) => bar(200 - index));
    expect(rsi(bars, 14)[20]).toBe(0);
  });

  it("hovers around the midpoint when gains and losses alternate", () => {
    const bars = Array.from({ length: 60 }, (_value, index) => bar(100 + (index % 2)));
    const value = rsi(bars, 14)[50] as number;
    expect(value).toBeGreaterThan(45);
    expect(value).toBeLessThan(55);
  });
});

describe("macd", () => {
  it("is flat at zero for a flat series", () => {
    const bars = Array.from({ length: 80 }, () => bar(100));
    const { macd: line, signal, histogram } = macd(bars);
    expect(line[79] as number).toBeCloseTo(0, 10);
    expect(signal[79] as number).toBeCloseTo(0, 10);
    expect(histogram[79] as number).toBeCloseTo(0, 10);
  });
});

describe("bollinger bands", () => {
  it("collapses onto the basis when price does not move", () => {
    const bars = Array.from({ length: 40 }, () => bar(50));
    const { middle, upper, lower, percentB } = bollingerBands(bars, 20, 2);
    expect(middle[39]).toBe(50);
    expect(upper[39]).toBe(50);
    expect(lower[39]).toBe(50);
    // Upper and lower coincide, so %b has no meaningful value.
    expect(percentB[39]).toBeNull();
  });
});

describe("stochastic and williams %r", () => {
  const bars = Array.from({ length: 30 }, (_value, index) =>
    bar(100 + index, { h: 100 + index, l: 90 + index }));

  it("reads 100 when the close sits on the window high", () => {
    expect(stochastic(bars, 14, 1, 3).k[20]).toBe(100);
  });

  it("reads 0 when the close sits on the window high", () => {
    expect(williamsR(bars, 14)[20]).toBe(0);
  });
});

describe("atr", () => {
  it("equals the bar range when there are no gaps", () => {
    const bars = Array.from({ length: 20 }, () => bar(100, { h: 101, l: 99 }));
    expect(atr(bars, 14)[19] as number).toBeCloseTo(2, 10);
  });
});

describe("parabolic sar", () => {
  it("stays under price through an uninterrupted rally", () => {
    const bars = Array.from({ length: 40 }, (_value, index) => bar(100 + index * 2));
    const values = parabolicSar(bars);
    expect(values[30] as number).toBeLessThan(bars[30].l);
  });
});

describe("vwap", () => {
  it("re-anchors on each New York session", () => {
    const day1 = Date.UTC(2026, 0, 5, 15, 0);
    const day2 = Date.UTC(2026, 0, 6, 15, 0);
    const bars: AggregateBar[] = [
      { t: day1, o: 10, h: 10, l: 10, c: 10, v: 100 },
      { t: day1 + 3_600_000, o: 20, h: 20, l: 20, c: 20, v: 100 },
      { t: day2, o: 50, h: 50, l: 50, c: 50, v: 100 },
    ];

    const anchored = vwap(bars, true);
    expect(anchored[1]).toBe(15);
    expect(anchored[2]).toBe(50);

    const cumulative = vwap(bars, false);
    expect(cumulative[2] as number).toBeCloseTo(80 / 3, 10);
  });
});

describe("zig zag", () => {
  it("marks only the reversal pivots", () => {
    const closes = [100, 105, 110, 104, 99, 96, 101, 107, 115];
    const bars = closes.map((close) => bar(close));
    const values = zigZag(bars, 5);
    const marked = values
      .map((value, index) => (value === null ? null : index))
      .filter((index): index is number => index !== null);

    // The 110 top and the 96 bottom are the confirmed pivots; the last leg is
    // provisional and tracks the running high.
    expect(marked).toEqual([0, 2, 5, 8]);
  });
});

describe("study catalogue", () => {
  const bars = syntheticBars(320);

  it("covers the Questrade study list", () => {
    expect(STUDIES.length).toBeGreaterThanOrEqual(45);
    expect(new Set(STUDIES.map((study) => study.key)).size).toBe(STUDIES.length);
    expect(STUDIES.some((study) => study.key === "rsi")).toBe(true);
  });

  it.each(STUDIES.map((study) => [study.label, study] as const))(
    "%s produces finite values aligned to the bars",
    (_label, study) => {
      const result = study.compute({ bars, timespan: "hour", multiplier: 1 });

      expect(result.plots.length).toBeGreaterThan(0);

      for (const plot of result.plots) {
        expect(plot.values).toHaveLength(bars.length);

        const numbers = plot.values.filter((value): value is number => value !== null);
        expect(numbers.length).toBeGreaterThan(0);
        expect(numbers.every((value) => Number.isFinite(value))).toBe(true);

        if (plot.colors) {
          expect(plot.colors).toHaveLength(bars.length);
        }
      }
    },
  );

  it("drops unknown and duplicate study keys", () => {
    expect(normalizeStudyKeys(["rsi", "rsi", "not-a-study", 7])).toEqual(["rsi"]);
    expect(normalizeStudyKeys("rsi")).toEqual([]);
  });
});
