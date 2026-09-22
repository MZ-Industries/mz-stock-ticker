/**
 * Technical-indicator maths for the chart studies.
 *
 * Every function here is pure and works off an `AggregateBar[]`. Results line up
 * 1:1 with the input bars and use `null` for "no value here" - warm-up periods,
 * displaced spans that fall past the newest bar, sparse pivots - which the chart
 * layer turns into gaps rather than zeros.
 *
 * The set mirrors the study list Questrade exposes (a ChartIQ chart).
 */
import type { AggregateBar } from "./types";
import { getNyParts } from "./utils";

export type Series = Array<number | null>;

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function filled(length: number): Series {
  return new Array<number | null>(length).fill(null);
}

export function closeSeries(bars: AggregateBar[]): Series {
  return bars.map((bar) => bar.c);
}

/** Typical price: (high + low + close) / 3. */
export function hlc3(bars: AggregateBar[]): Series {
  return bars.map((bar) => (bar.h + bar.l + bar.c) / 3);
}

/** Median price: (high + low) / 2. */
export function hl2(bars: AggregateBar[]): Series {
  return bars.map((bar) => (bar.h + bar.l) / 2);
}

// ---------------------------------------------------------------------------
// Smoothing and window helpers
// ---------------------------------------------------------------------------

/** Simple moving average. A null anywhere in the window restarts the window. */
export function sma(values: Series, period: number): Series {
  const out = filled(values.length);
  if (period < 1) {
    return out;
  }

  let sum = 0;
  let count = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!isNum(value)) {
      sum = 0;
      count = 0;
      continue;
    }

    sum += value;
    count += 1;

    if (count > period) {
      const dropped = values[index - period];
      sum -= isNum(dropped) ? dropped : 0;
      count = period;
    }

    if (count === period) {
      out[index] = sum / period;
    }
  }

  return out;
}

/** Exponential moving average, seeded with the first complete SMA. */
export function ema(values: Series, period: number): Series {
  const out = filled(values.length);
  if (period < 1) {
    return out;
  }

  const weight = 2 / (period + 1);
  let previous: number | null = null;
  let seedSum = 0;
  let seedCount = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!isNum(value)) {
      previous = null;
      seedSum = 0;
      seedCount = 0;
      continue;
    }

    if (previous === null) {
      seedSum += value;
      seedCount += 1;
      if (seedCount === period) {
        previous = seedSum / period;
        out[index] = previous;
      }
      continue;
    }

    previous = value * weight + previous * (1 - weight);
    out[index] = previous;
  }

  return out;
}

/** Wilder's smoothing (the 1/period variant behind RSI, ATR and ADX). */
export function wilder(values: Series, period: number): Series {
  const out = filled(values.length);
  if (period < 1) {
    return out;
  }

  let previous: number | null = null;
  let seedSum = 0;
  let seedCount = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!isNum(value)) {
      previous = null;
      seedSum = 0;
      seedCount = 0;
      continue;
    }

    if (previous === null) {
      seedSum += value;
      seedCount += 1;
      if (seedCount === period) {
        previous = seedSum / period;
        out[index] = previous;
      }
      continue;
    }

    previous = (previous * (period - 1) + value) / period;
    out[index] = previous;
  }

  return out;
}

/** Linearly weighted moving average - the newest bar carries the most weight. */
export function wma(values: Series, period: number): Series {
  const out = filled(values.length);
  if (period < 1) {
    return out;
  }

  const denominator = (period * (period + 1)) / 2;

  for (let index = period - 1; index < values.length; index += 1) {
    let weighted = 0;
    let usable = true;

    for (let offset = 0; offset < period; offset += 1) {
      const value = values[index - offset];
      if (!isNum(value)) {
        usable = false;
        break;
      }
      weighted += value * (period - offset);
    }

    if (usable) {
      out[index] = weighted / denominator;
    }
  }

  return out;
}

/** Population standard deviation over a rolling window. */
export function stdev(values: Series, period: number): Series {
  const out = filled(values.length);
  if (period < 2) {
    return out;
  }

  for (let index = period - 1; index < values.length; index += 1) {
    let sum = 0;
    let usable = true;

    for (let offset = 0; offset < period; offset += 1) {
      const value = values[index - offset];
      if (!isNum(value)) {
        usable = false;
        break;
      }
      sum += value;
    }

    if (!usable) {
      continue;
    }

    const mean = sum / period;
    let variance = 0;
    for (let offset = 0; offset < period; offset += 1) {
      variance += ((values[index - offset] as number) - mean) ** 2;
    }

    out[index] = Math.sqrt(Math.max(0, variance / period));
  }

  return out;
}

export function highest(values: Series, period: number): Series {
  const out = filled(values.length);

  for (let index = period - 1; index < values.length; index += 1) {
    let best = -Infinity;
    let usable = true;

    for (let offset = 0; offset < period; offset += 1) {
      const value = values[index - offset];
      if (!isNum(value)) {
        usable = false;
        break;
      }
      best = Math.max(best, value);
    }

    if (usable) {
      out[index] = best;
    }
  }

  return out;
}

export function lowest(values: Series, period: number): Series {
  const out = filled(values.length);

  for (let index = period - 1; index < values.length; index += 1) {
    let best = Infinity;
    let usable = true;

    for (let offset = 0; offset < period; offset += 1) {
      const value = values[index - offset];
      if (!isNum(value)) {
        usable = false;
        break;
      }
      best = Math.min(best, value);
    }

    if (usable) {
      out[index] = best;
    }
  }

  return out;
}

/** Element-wise maths. Either operand being null makes the result null. */
export function subtract(left: Series, right: Series): Series {
  return left.map((value, index) => {
    const other = right[index];
    return isNum(value) && isNum(other) ? value - other : null;
  });
}

export function add(left: Series, right: Series): Series {
  return left.map((value, index) => {
    const other = right[index];
    return isNum(value) && isNum(other) ? value + other : null;
  });
}

export function scale(values: Series, factor: number): Series {
  return values.map((value) => (isNum(value) ? value * factor : null));
}

/**
 * Displaces a series forward by `offset` bars: the value computed at bar i is
 * read at bar i + offset. Values that would land past the newest bar are
 * dropped, because the chart owns no timestamps beyond the data it holds.
 */
export function shiftForward(values: Series, offset: number): Series {
  const out = filled(values.length);
  for (let index = offset; index < values.length; index += 1) {
    out[index] = values[index - offset];
  }
  return out;
}

/** Displaces a series backward by `offset` bars (Ichimoku's lagging span). */
export function shiftBackward(values: Series, offset: number): Series {
  const out = filled(values.length);
  for (let index = 0; index + offset < values.length; index += 1) {
    out[index] = values[index + offset];
  }
  return out;
}

/** Percentage change against the value `period` bars back. */
export function rateOfChange(values: Series, period: number): Series {
  return values.map((value, index) => {
    const previous = values[index - period];
    if (!isNum(value) || !isNum(previous) || previous === 0) {
      return null;
    }
    return ((value - previous) / previous) * 100;
  });
}

// ---------------------------------------------------------------------------
// Volatility and range
// ---------------------------------------------------------------------------

export function trueRange(bars: AggregateBar[]): Series {
  return bars.map((bar, index) => {
    if (index === 0) {
      return bar.h - bar.l;
    }
    const previousClose = bars[index - 1].c;
    return Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - previousClose),
      Math.abs(bar.l - previousClose),
    );
  });
}

export function atr(bars: AggregateBar[], period = 14): Series {
  return wilder(trueRange(bars), period);
}

/** Chaikin Volatility: rate of change of a smoothed high-low spread. */
export function chaikinVolatility(bars: AggregateBar[], period = 10, rocPeriod = 10): Series {
  const spread: Series = bars.map((bar) => bar.h - bar.l);
  return rateOfChange(ema(spread, period), rocPeriod);
}

/** Annualised standard deviation of log returns, in percent. */
export function historicalVolatility(
  bars: AggregateBar[],
  period = 20,
  barsPerYear = 252,
): Series {
  const logReturns = filled(bars.length);
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1].c;
    logReturns[index] = previous > 0 ? Math.log(bars[index].c / previous) : null;
  }

  return scale(stdev(logReturns, period), Math.sqrt(barsPerYear) * 100);
}

/** Dorsey's Relative Volatility Index: RSI maths applied to standard deviation. */
export function relativeVolatilityIndex(
  bars: AggregateBar[],
  stdevPeriod = 10,
  smoothingPeriod = 14,
): Series {
  const deviation = stdev(closeSeries(bars), stdevPeriod);
  const up = filled(bars.length);
  const down = filled(bars.length);

  for (let index = 1; index < bars.length; index += 1) {
    const spread = deviation[index];
    if (!isNum(spread)) {
      continue;
    }
    const change = bars[index].c - bars[index - 1].c;
    up[index] = change > 0 ? spread : 0;
    down[index] = change < 0 ? spread : 0;
  }

  const averageUp = wilder(up, smoothingPeriod);
  const averageDown = wilder(down, smoothingPeriod);

  return averageUp.map((value, index) => {
    const loss = averageDown[index];
    if (!isNum(value) || !isNum(loss)) {
      return null;
    }
    const total = value + loss;
    return total === 0 ? 50 : (value / total) * 100;
  });
}

// ---------------------------------------------------------------------------
// Bands and channels
// ---------------------------------------------------------------------------

export function bollingerBands(
  bars: AggregateBar[],
  period = 20,
  deviations = 2,
): { middle: Series; upper: Series; lower: Series; percentB: Series; bandwidth: Series } {
  const close = closeSeries(bars);
  const middle = sma(close, period);
  const deviation = stdev(close, period);

  const upper = middle.map((value, index) => {
    const spread = deviation[index];
    return isNum(value) && isNum(spread) ? value + spread * deviations : null;
  });
  const lower = middle.map((value, index) => {
    const spread = deviation[index];
    return isNum(value) && isNum(spread) ? value - spread * deviations : null;
  });

  const percentB = close.map((value, index) => {
    const top = upper[index];
    const bottom = lower[index];
    if (!isNum(value) || !isNum(top) || !isNum(bottom) || top === bottom) {
      return null;
    }
    return ((value - bottom) / (top - bottom)) * 100;
  });

  const bandwidth = middle.map((value, index) => {
    const top = upper[index];
    const bottom = lower[index];
    if (!isNum(value) || !isNum(top) || !isNum(bottom) || value === 0) {
      return null;
    }
    return ((top - bottom) / value) * 100;
  });

  return { middle, upper, lower, percentB, bandwidth };
}

export function keltnerChannel(
  bars: AggregateBar[],
  period = 20,
  multiplier = 2,
  atrPeriod = 10,
): { middle: Series; upper: Series; lower: Series } {
  const middle = ema(closeSeries(bars), period);
  const range = atr(bars, atrPeriod);

  return {
    middle,
    upper: middle.map((value, index) => {
      const spread = range[index];
      return isNum(value) && isNum(spread) ? value + spread * multiplier : null;
    }),
    lower: middle.map((value, index) => {
      const spread = range[index];
      return isNum(value) && isNum(spread) ? value - spread * multiplier : null;
    }),
  };
}

/** Moving-average envelope: a percentage band around an SMA. */
export function envelope(
  bars: AggregateBar[],
  period = 20,
  percent = 2.5,
): { middle: Series; upper: Series; lower: Series } {
  const middle = sma(closeSeries(bars), period);
  const factor = percent / 100;
  return {
    middle,
    upper: middle.map((value) => (isNum(value) ? value * (1 + factor) : null)),
    lower: middle.map((value) => (isNum(value) ? value * (1 - factor) : null)),
  };
}

export function ichimoku(
  bars: AggregateBar[],
  conversionPeriod = 9,
  basePeriod = 26,
  spanPeriod = 52,
): { conversion: Series; base: Series; spanA: Series; spanB: Series; lagging: Series } {
  const midpoint = (period: number): Series => {
    const highs = highest(bars.map((bar) => bar.h), period);
    const lows = lowest(bars.map((bar) => bar.l), period);
    return highs.map((value, index) => {
      const low = lows[index];
      return isNum(value) && isNum(low) ? (value + low) / 2 : null;
    });
  };

  const conversion = midpoint(conversionPeriod);
  const base = midpoint(basePeriod);
  const rawSpanA = conversion.map((value, index) => {
    const other = base[index];
    return isNum(value) && isNum(other) ? (value + other) / 2 : null;
  });

  return {
    conversion,
    base,
    spanA: shiftForward(rawSpanA, basePeriod),
    spanB: shiftForward(midpoint(spanPeriod), basePeriod),
    lagging: shiftBackward(closeSeries(bars), basePeriod),
  };
}

/** Bill Williams' Alligator: three Wilder-smoothed medians, each displaced. */
export function alligator(bars: AggregateBar[]): { jaw: Series; teeth: Series; lips: Series } {
  const median = hl2(bars);
  return {
    jaw: shiftForward(wilder(median, 13), 8),
    teeth: shiftForward(wilder(median, 8), 5),
    lips: shiftForward(wilder(median, 5), 3),
  };
}

export function parabolicSar(bars: AggregateBar[], step = 0.02, maximum = 0.2): Series {
  const out = filled(bars.length);
  if (bars.length < 2) {
    return out;
  }

  let rising = bars[1].c >= bars[0].c;
  let acceleration = step;
  let extreme = rising ? bars[0].h : bars[0].l;
  let sar = rising ? bars[0].l : bars[0].h;
  out[0] = sar;

  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    sar += acceleration * (extreme - sar);

    if (rising) {
      // The stop may never move above the prior two lows.
      sar = Math.min(sar, bars[index - 1].l, bars[Math.max(0, index - 2)].l);
      if (bar.l < sar) {
        rising = false;
        sar = extreme;
        extreme = bar.l;
        acceleration = step;
      } else if (bar.h > extreme) {
        extreme = bar.h;
        acceleration = Math.min(maximum, acceleration + step);
      }
    } else {
      sar = Math.max(sar, bars[index - 1].h, bars[Math.max(0, index - 2)].h);
      if (bar.h > sar) {
        rising = true;
        sar = extreme;
        extreme = bar.h;
        acceleration = step;
      } else if (bar.l < extreme) {
        extreme = bar.l;
        acceleration = Math.min(maximum, acceleration + step);
      }
    }

    out[index] = sar;
  }

  return out;
}

/**
 * Volume-weighted average price, re-anchored at the start of every New York
 * session for intraday bars. Daily and longer bars have no session to anchor to,
 * so they accumulate from the first bar held.
 */
export function vwap(bars: AggregateBar[], anchorPerSession: boolean): Series {
  const out = filled(bars.length);
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  let sessionDate: string | null = null;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];

    if (anchorPerSession) {
      const date = getNyParts(bar.t).date;
      if (date !== sessionDate) {
        sessionDate = date;
        cumulativeVolume = 0;
        cumulativeValue = 0;
      }
    }

    const typical = (bar.h + bar.l + bar.c) / 3;
    cumulativeVolume += bar.v;
    cumulativeValue += typical * bar.v;
    out[index] = cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : typical;
  }

  return out;
}

/**
 * Classic floor-trader pivots derived from the previous New York session's
 * range. Needs at least two sessions of bars before anything is drawn.
 */
export function pivotPoints(bars: AggregateBar[]): {
  pivot: Series;
  r1: Series;
  r2: Series;
  s1: Series;
  s2: Series;
} {
  const pivot = filled(bars.length);
  const r1 = filled(bars.length);
  const r2 = filled(bars.length);
  const s1 = filled(bars.length);
  const s2 = filled(bars.length);

  let sessionDate: string | null = null;
  let previous: { high: number; low: number; close: number } | null = null;
  let current: { high: number; low: number; close: number } | null = null;
  let levels: { p: number; r1: number; r2: number; s1: number; s2: number } | null = null;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const date = getNyParts(bar.t).date;

    if (date !== sessionDate) {
      sessionDate = date;
      previous = current;
      current = { high: bar.h, low: bar.l, close: bar.c };

      if (previous) {
        const p = (previous.high + previous.low + previous.close) / 3;
        const span = previous.high - previous.low;
        levels = {
          p,
          r1: 2 * p - previous.low,
          r2: p + span,
          s1: 2 * p - previous.high,
          s2: p - span,
        };
      } else {
        levels = null;
      }
    } else if (current) {
      current.high = Math.max(current.high, bar.h);
      current.low = Math.min(current.low, bar.l);
      current.close = bar.c;
    }

    if (levels) {
      pivot[index] = levels.p;
      r1[index] = levels.r1;
      r2[index] = levels.r2;
      s1[index] = levels.s1;
      s2[index] = levels.s2;
    }
  }

  return { pivot, r1, r2, s1, s2 };
}

/**
 * Zig Zag: only reversal pivots carry a value, so the chart draws straight legs
 * between them. The newest leg tracks the running extreme and stays provisional
 * until a move of `percent` in the other direction confirms it.
 */
export function zigZag(bars: AggregateBar[], percent = 5): Series {
  const out = filled(bars.length);
  if (bars.length === 0) {
    return out;
  }

  const threshold = percent / 100;
  let direction: 1 | -1 | 0 = 0;
  let extremeIndex = 0;
  let extremePrice = bars[0].c;
  out[0] = extremePrice;

  for (let index = 1; index < bars.length; index += 1) {
    const price = bars[index].c;

    if (direction === 1) {
      if (price > extremePrice) {
        extremePrice = price;
        extremeIndex = index;
      } else if (price <= extremePrice * (1 - threshold)) {
        out[extremeIndex] = extremePrice;
        direction = -1;
        extremePrice = price;
        extremeIndex = index;
      }
      continue;
    }

    if (direction === -1) {
      if (price < extremePrice) {
        extremePrice = price;
        extremeIndex = index;
      } else if (price >= extremePrice * (1 + threshold)) {
        out[extremeIndex] = extremePrice;
        direction = 1;
        extremePrice = price;
        extremeIndex = index;
      }
      continue;
    }

    if (price >= extremePrice * (1 + threshold)) {
      direction = 1;
      extremePrice = price;
      extremeIndex = index;
    } else if (price <= extremePrice * (1 - threshold)) {
      direction = -1;
      extremePrice = price;
      extremeIndex = index;
    }
  }

  out[extremeIndex] = extremePrice;
  return out;
}

// ---------------------------------------------------------------------------
// Momentum and oscillators
// ---------------------------------------------------------------------------

export function rsi(bars: AggregateBar[], period = 14): Series {
  const gains = filled(Math.max(0, bars.length - 1));
  const losses = filled(Math.max(0, bars.length - 1));

  for (let index = 1; index < bars.length; index += 1) {
    const change = bars[index].c - bars[index - 1].c;
    gains[index - 1] = Math.max(0, change);
    losses[index - 1] = Math.max(0, -change);
  }

  const averageGain = wilder(gains, period);
  const averageLoss = wilder(losses, period);
  const out = filled(bars.length);

  for (let index = 0; index < averageGain.length; index += 1) {
    const gain = averageGain[index];
    const loss = averageLoss[index];
    if (!isNum(gain) || !isNum(loss)) {
      continue;
    }
    out[index + 1] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }

  return out;
}

export function macd(
  bars: AggregateBar[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: Series; signal: Series; histogram: Series } {
  const close = closeSeries(bars);
  const line = subtract(ema(close, fastPeriod), ema(close, slowPeriod));
  const signal = ema(line, signalPeriod);
  return { macd: line, signal, histogram: subtract(line, signal) };
}

/** Price Oscillator, expressed as a percentage of the slow average. */
export function priceOscillator(
  bars: AggregateBar[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { oscillator: Series; signal: Series } {
  const close = closeSeries(bars);
  const fast = ema(close, fastPeriod);
  const slow = ema(close, slowPeriod);

  const oscillator = fast.map((value, index) => {
    const base = slow[index];
    if (!isNum(value) || !isNum(base) || base === 0) {
      return null;
    }
    return ((value - base) / base) * 100;
  });

  return { oscillator, signal: ema(oscillator, signalPeriod) };
}

export function stochastic(
  bars: AggregateBar[],
  period = 14,
  smoothK = 3,
  smoothD = 3,
): { k: Series; d: Series } {
  const highs = highest(bars.map((bar) => bar.h), period);
  const lows = lowest(bars.map((bar) => bar.l), period);

  const raw: Series = bars.map((bar, index) => {
    const high = highs[index];
    const low = lows[index];
    if (!isNum(high) || !isNum(low)) {
      return null;
    }
    const span = high - low;
    return span === 0 ? 50 : ((bar.c - low) / span) * 100;
  });

  const k = smoothK > 1 ? sma(raw, smoothK) : raw;
  return { k, d: sma(k, smoothD) };
}

/** Blau's Stochastic Momentum Index: where price sits versus the range midpoint. */
export function stochasticMomentumIndex(
  bars: AggregateBar[],
  period = 13,
  firstSmoothing = 25,
  secondSmoothing = 2,
  signalPeriod = 3,
): { smi: Series; signal: Series } {
  const highs = highest(bars.map((bar) => bar.h), period);
  const lows = lowest(bars.map((bar) => bar.l), period);

  const distance: Series = bars.map((bar, index) => {
    const high = highs[index];
    const low = lows[index];
    return isNum(high) && isNum(low) ? bar.c - (high + low) / 2 : null;
  });
  const span: Series = highs.map((value, index) => {
    const low = lows[index];
    return isNum(value) && isNum(low) ? value - low : null;
  });

  const smoothedDistance = ema(ema(distance, firstSmoothing), secondSmoothing);
  const smoothedSpan = ema(ema(span, firstSmoothing), secondSmoothing);

  const smi = smoothedDistance.map((value, index) => {
    const divisor = smoothedSpan[index];
    if (!isNum(value) || !isNum(divisor) || divisor === 0) {
      return null;
    }
    return (value / (divisor / 2)) * 100;
  });

  return { smi, signal: ema(smi, signalPeriod) };
}

export function williamsR(bars: AggregateBar[], period = 14): Series {
  const highs = highest(bars.map((bar) => bar.h), period);
  const lows = lowest(bars.map((bar) => bar.l), period);

  return bars.map((bar, index) => {
    const high = highs[index];
    const low = lows[index];
    if (!isNum(high) || !isNum(low)) {
      return null;
    }
    const span = high - low;
    return span === 0 ? -50 : ((bar.c - high) / span) * 100;
  });
}

export function cci(bars: AggregateBar[], period = 20): Series {
  const typical = hlc3(bars);
  const average = sma(typical, period);
  const out = filled(bars.length);

  for (let index = period - 1; index < bars.length; index += 1) {
    const mean = average[index];
    if (!isNum(mean)) {
      continue;
    }

    let deviation = 0;
    for (let offset = 0; offset < period; offset += 1) {
      deviation += Math.abs((typical[index - offset] as number) - mean);
    }

    const meanDeviation = deviation / period;
    out[index] = meanDeviation === 0
      ? 0
      : ((typical[index] as number) - mean) / (0.015 * meanDeviation);
  }

  return out;
}

export function chandeMomentum(bars: AggregateBar[], period = 20): Series {
  const up = filled(bars.length);
  const down = filled(bars.length);

  for (let index = 1; index < bars.length; index += 1) {
    const change = bars[index].c - bars[index - 1].c;
    up[index] = Math.max(0, change);
    down[index] = Math.max(0, -change);
  }

  const upAverage = sma(up, period);
  const downAverage = sma(down, period);

  return upAverage.map((value, index) => {
    const loss = downAverage[index];
    if (!isNum(value) || !isNum(loss)) {
      return null;
    }
    const total = value + loss;
    return total === 0 ? 0 : ((value - loss) / total) * 100;
  });
}

export function awesomeOscillator(bars: AggregateBar[], fastPeriod = 5, slowPeriod = 34): Series {
  const median = hl2(bars);
  return subtract(sma(median, fastPeriod), sma(median, slowPeriod));
}

/** Where the close lands inside the bar's own range, smoothed. */
export function balanceOfPower(bars: AggregateBar[], period = 14): Series {
  const raw: Series = bars.map((bar) => {
    const span = bar.h - bar.l;
    return span === 0 ? 0 : (bar.c - bar.o) / span;
  });
  return sma(raw, period);
}

export function trix(bars: AggregateBar[], period = 15): Series {
  const triple = ema(ema(ema(closeSeries(bars), period), period), period);
  return rateOfChange(triple, 1);
}

export function ultimateOscillator(
  bars: AggregateBar[],
  shortPeriod = 7,
  mediumPeriod = 14,
  longPeriod = 28,
): Series {
  const buyingPressure = filled(bars.length);
  const range = filled(bars.length);

  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const previousClose = bars[index - 1].c;
    const trueLow = Math.min(bar.l, previousClose);
    const trueHigh = Math.max(bar.h, previousClose);
    buyingPressure[index] = bar.c - trueLow;
    range[index] = trueHigh - trueLow;
  }

  const averageAt = (index: number, period: number): number | null => {
    if (index - period + 1 < 1) {
      return null;
    }
    let pressure = 0;
    let span = 0;
    for (let offset = 0; offset < period; offset += 1) {
      pressure += buyingPressure[index - offset] as number;
      span += range[index - offset] as number;
    }
    return span === 0 ? null : pressure / span;
  };

  return bars.map((_bar, index) => {
    const short = averageAt(index, shortPeriod);
    const medium = averageAt(index, mediumPeriod);
    const long = averageAt(index, longPeriod);
    if (short === null || medium === null || long === null) {
      return null;
    }
    return ((4 * short + 2 * medium + long) / 7) * 100;
  });
}

/** Slope of a least-squares fit through the last `period` closes. */
export function linearRegressionSlope(bars: AggregateBar[], period = 14): Series {
  const out = filled(bars.length);
  if (period < 2) {
    return out;
  }

  const sumX = (period * (period - 1)) / 2;
  const sumXSquared = ((period - 1) * period * (2 * period - 1)) / 6;
  const denominator = period * sumXSquared - sumX * sumX;
  if (denominator === 0) {
    return out;
  }

  for (let index = period - 1; index < bars.length; index += 1) {
    let sumY = 0;
    let sumXY = 0;
    for (let offset = 0; offset < period; offset += 1) {
      const y = bars[index - (period - 1 - offset)].c;
      sumY += y;
      sumXY += offset * y;
    }
    out[index] = (period * sumXY - sumX * sumY) / denominator;
  }

  return out;
}

export function directionalMovement(
  bars: AggregateBar[],
  period = 14,
): { plusDi: Series; minusDi: Series; adx: Series } {
  const length = Math.max(0, bars.length - 1);
  const plusMovement = filled(length);
  const minusMovement = filled(length);
  const ranges = filled(length);

  for (let index = 1; index < bars.length; index += 1) {
    const upMove = bars[index].h - bars[index - 1].h;
    const downMove = bars[index - 1].l - bars[index].l;
    plusMovement[index - 1] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusMovement[index - 1] = downMove > upMove && downMove > 0 ? downMove : 0;

    const previousClose = bars[index - 1].c;
    ranges[index - 1] = Math.max(
      bars[index].h - bars[index].l,
      Math.abs(bars[index].h - previousClose),
      Math.abs(bars[index].l - previousClose),
    );
  }

  const smoothedRange = wilder(ranges, period);
  const smoothedPlus = wilder(plusMovement, period);
  const smoothedMinus = wilder(minusMovement, period);

  const plusDi = filled(bars.length);
  const minusDi = filled(bars.length);
  const directionalIndex = filled(length);

  for (let index = 0; index < length; index += 1) {
    const range = smoothedRange[index];
    const plus = smoothedPlus[index];
    const minus = smoothedMinus[index];
    if (!isNum(range) || range === 0 || !isNum(plus) || !isNum(minus)) {
      continue;
    }

    const plusValue = (plus / range) * 100;
    const minusValue = (minus / range) * 100;
    plusDi[index + 1] = plusValue;
    minusDi[index + 1] = minusValue;

    const total = plusValue + minusValue;
    directionalIndex[index] = total === 0 ? 0 : (Math.abs(plusValue - minusValue) / total) * 100;
  }

  const adx = filled(bars.length);
  const firstIndex = directionalIndex.findIndex(isNum);
  if (firstIndex >= 0) {
    const smoothed = wilder(directionalIndex.slice(firstIndex), period);
    for (let index = 0; index < smoothed.length; index += 1) {
      adx[index + firstIndex + 1] = smoothed[index];
    }
  }

  return { plusDi, minusDi, adx };
}

export function aroon(bars: AggregateBar[], period = 25): { up: Series; down: Series } {
  const up = filled(bars.length);
  const down = filled(bars.length);

  for (let index = period; index < bars.length; index += 1) {
    let highestIndex = index;
    let lowestIndex = index;

    for (let offset = 0; offset <= period; offset += 1) {
      const cursor = index - offset;
      if (bars[cursor].h > bars[highestIndex].h) {
        highestIndex = cursor;
      }
      if (bars[cursor].l < bars[lowestIndex].l) {
        lowestIndex = cursor;
      }
    }

    up[index] = ((period - (index - highestIndex)) / period) * 100;
    down[index] = ((period - (index - lowestIndex)) / period) * 100;
  }

  return { up, down };
}

export function vortex(bars: AggregateBar[], period = 14): { plus: Series; minus: Series } {
  const plusMovement = filled(bars.length);
  const minusMovement = filled(bars.length);

  for (let index = 1; index < bars.length; index += 1) {
    plusMovement[index] = Math.abs(bars[index].h - bars[index - 1].l);
    minusMovement[index] = Math.abs(bars[index].l - bars[index - 1].h);
  }

  const rangeSum = sma(trueRange(bars), period);
  const plusSum = sma(plusMovement, period);
  const minusSum = sma(minusMovement, period);

  const ratio = (numerator: Series): Series =>
    numerator.map((value, index) => {
      const range = rangeSum[index];
      if (!isNum(value) || !isNum(range) || range === 0) {
        return null;
      }
      return value / range;
    });

  return { plus: ratio(plusSum), minus: ratio(minusSum) };
}

/**
 * Wilder's Swing Index. `limitMove` is the maximum move the instrument may make
 * in a session; equities have no limit, so it stands in as a scaling constant
 * (ChartIQ exposes the same knob and defaults it to 3).
 */
export function swingIndex(bars: AggregateBar[], limitMove = 3): Series {
  const out = filled(bars.length);

  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const previous = bars[index - 1];

    const upperMove = Math.abs(bar.h - previous.c);
    const lowerMove = Math.abs(bar.l - previous.c);
    const spread = Math.abs(bar.h - bar.l);
    const openGap = Math.abs(previous.c - previous.o);

    let range: number;
    if (upperMove > lowerMove && upperMove > spread) {
      range = upperMove - lowerMove / 2 + openGap / 4;
    } else if (lowerMove > upperMove && lowerMove > spread) {
      range = lowerMove - upperMove / 2 + openGap / 4;
    } else {
      range = spread + openGap / 4;
    }

    if (range === 0 || limitMove === 0) {
      out[index] = 0;
      continue;
    }

    const numerator = (bar.c - previous.c)
      + (bar.c - bar.o) / 2
      + (previous.c - previous.o) / 4;
    const largestMove = Math.max(upperMove, lowerMove);

    out[index] = 50 * (numerator / range) * (largestMove / limitMove);
  }

  return out;
}

export function accumulativeSwingIndex(bars: AggregateBar[], limitMove = 3): Series {
  const swings = swingIndex(bars, limitMove);
  const out = filled(bars.length);
  let running = 0;

  for (let index = 0; index < swings.length; index += 1) {
    const value = swings[index];
    if (!isNum(value)) {
      continue;
    }
    running += value;
    out[index] = running;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export function accumulationDistribution(bars: AggregateBar[]): Series {
  const out = filled(bars.length);
  let running = 0;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const span = bar.h - bar.l;
    const multiplier = span === 0 ? 0 : ((bar.c - bar.l) - (bar.h - bar.c)) / span;
    running += multiplier * bar.v;
    out[index] = running;
  }

  return out;
}

export function onBalanceVolume(bars: AggregateBar[]): Series {
  const out = filled(bars.length);
  let running = 0;

  for (let index = 0; index < bars.length; index += 1) {
    if (index > 0) {
      const change = bars[index].c - bars[index - 1].c;
      running += change > 0 ? bars[index].v : change < 0 ? -bars[index].v : 0;
    }
    out[index] = running;
  }

  return out;
}

export function chaikinMoneyFlow(bars: AggregateBar[], period = 20): Series {
  const flow: Series = bars.map((bar) => {
    const span = bar.h - bar.l;
    const multiplier = span === 0 ? 0 : ((bar.c - bar.l) - (bar.h - bar.c)) / span;
    return multiplier * bar.v;
  });

  const flowAverage = sma(flow, period);
  const volumeAverage = sma(bars.map((bar) => bar.v), period);

  return flowAverage.map((value, index) => {
    const volume = volumeAverage[index];
    if (!isNum(value) || !isNum(volume) || volume === 0) {
      return null;
    }
    return value / volume;
  });
}

/** Elder's Force Index: the bar's price change weighted by its volume. */
export function forceIndex(bars: AggregateBar[], period = 13): Series {
  const raw = filled(bars.length);
  for (let index = 1; index < bars.length; index += 1) {
    raw[index] = (bars[index].c - bars[index - 1].c) * bars[index].v;
  }
  return ema(raw, period);
}

export function klingerOscillator(
  bars: AggregateBar[],
  fastPeriod = 34,
  slowPeriod = 55,
  signalPeriod = 13,
): { klinger: Series; signal: Series } {
  const volumeForce = filled(bars.length);
  let previousTrend = 0;
  let cumulativeMovement = 0;
  let previousMovement = 0;

  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const previous = bars[index - 1];

    const trend = bar.h + bar.l + bar.c > previous.h + previous.l + previous.c ? 1 : -1;
    const movement = bar.h - bar.l;

    cumulativeMovement = trend === previousTrend
      ? cumulativeMovement + movement
      : previousMovement + movement;

    const ratio = cumulativeMovement === 0 ? 0 : movement / cumulativeMovement;
    volumeForce[index] = bar.v * Math.abs(2 * ratio - 1) * trend * 100;

    previousTrend = trend;
    previousMovement = movement;
  }

  const klinger = subtract(ema(volumeForce, fastPeriod), ema(volumeForce, slowPeriod));
  return { klinger, signal: ema(klinger, signalPeriod) };
}

/** Volume Oscillator: the gap between a fast and a slow volume average, in percent. */
export function volumeOscillator(bars: AggregateBar[], fastPeriod = 14, slowPeriod = 28): Series {
  const volumes: Series = bars.map((bar) => bar.v);
  const fast = sma(volumes, fastPeriod);
  const slow = sma(volumes, slowPeriod);

  return fast.map((value, index) => {
    const base = slow[index];
    if (!isNum(value) || !isNum(base) || base === 0) {
      return null;
    }
    return ((value - base) / base) * 100;
  });
}

/** Bill Williams' Market Facilitation Index: price movement per unit of volume. */
export function marketFacilitationIndex(bars: AggregateBar[]): Series {
  return bars.map((bar) => (bar.v > 0 ? (bar.h - bar.l) / bar.v : null));
}
