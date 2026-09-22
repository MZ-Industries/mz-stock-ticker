/**
 * The study catalogue.
 *
 * Each entry turns a bar array into plot specs; the chart layer knows nothing
 * about what an indicator means, only whether it is drawn over the price series
 * or in its own pane beneath the volume chart.
 *
 * The catalogue mirrors the study list Questrade offers, minus "Volume Chart" -
 * this app already keeps a volume pane on screen at all times.
 */
import * as ind from "./indicators";
import type { Series } from "./indicators";
import type { AggregateBar } from "./types";

export type StudyPlacement = "price" | "pane";

/** `dots` is a line series with the line hidden - used for Parabolic SAR. */
export type StudyPlotType = "line" | "histogram" | "dots";

export type StudyPlot = {
  key: string;
  label: string;
  type: StudyPlotType;
  color: string;
  values: Series;
  lineWidth?: 1 | 2;
  dashed?: boolean;
  /** Per-point histogram colours, aligned with `values`. */
  colors?: Array<string | null>;
  /** Draw on a hidden scale pinned to the bottom of the price pane. */
  underlay?: boolean;
};

export type StudyLevel = {
  value: number;
  color?: string;
  dashed?: boolean;
};

export type StudyResult = {
  plots: StudyPlot[];
  /** Horizontal reference lines drawn inside the study's pane. */
  levels?: StudyLevel[];
  /** Large counts (volume, cumulative lines) read better abbreviated. */
  compact?: boolean;
  /** Decimals shown in the study legend. */
  precision?: number;
};

export type StudyContext = {
  bars: AggregateBar[];
  timespan: "minute" | "hour" | "day";
  multiplier: number;
};

export type StudyDefinition = {
  key: string;
  label: string;
  placement: StudyPlacement;
  compute: (context: StudyContext) => StudyResult;
};

const BLUE = "#60a5fa";
const TEAL = "#2dd4bf";
const AMBER = "#f59e0b";
const VIOLET = "#a78bfa";
const ROSE = "#fb7185";
const SLATE = "#94a3b8";
const UP = "#34d399";
const DOWN = "#f87171";

function line(
  key: string,
  label: string,
  values: Series,
  color: string,
  options: { lineWidth?: 1 | 2; dashed?: boolean } = {},
): StudyPlot {
  return { key, label, type: "line", color, values, ...options };
}

/** Colours a histogram by the sign of each value. */
function signColors(values: Series): Array<string | null> {
  return values.map((value) => (value === null ? null : value >= 0 ? UP : DOWN));
}

/** Colours a histogram by whether each value rose or fell against the last one. */
function directionColors(values: Series): Array<string | null> {
  let previous: number | null = null;
  return values.map((value) => {
    if (value === null) {
      return null;
    }
    const colour = previous === null || value >= previous ? UP : DOWN;
    previous = value;
    return colour;
  });
}

/** How many bars of this size make up a trading year, for annualisation. */
function barsPerYear(context: StudyContext): number {
  const multiplier = Math.max(1, context.multiplier);
  switch (context.timespan) {
    case "minute":
      return (252 * 390) / multiplier;
    case "hour":
      return (252 * 6.5) / multiplier;
    default:
      return 252 / multiplier;
  }
}

/**
 * The study list, in the order the picker shows it (alphabetical, as Questrade
 * lists them).
 */
export const STUDIES: StudyDefinition[] = [
  {
    key: "accumulation-distribution",
    label: "Accumulation/Distribution",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("ad", "A/D", ind.accumulationDistribution(bars), TEAL)],
      compact: true,
    }),
  },
  {
    key: "accumulative-swing-index",
    label: "Accumulative Swing Index",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("asi", "ASI", ind.accumulativeSwingIndex(bars), BLUE)],
      levels: [{ value: 0, color: SLATE }],
      compact: true,
    }),
  },
  {
    key: "adx-dms",
    label: "ADX/DMS",
    placement: "pane",
    compute: ({ bars }) => {
      const { plusDi, minusDi, adx } = ind.directionalMovement(bars, 14);
      return {
        plots: [
          line("plus", "+DI", plusDi, UP),
          line("minus", "-DI", minusDi, DOWN),
          line("adx", "ADX", adx, BLUE, { lineWidth: 2 }),
        ],
        levels: [{ value: 20, color: SLATE, dashed: true }],
      };
    },
  },
  {
    key: "alligator",
    label: "Alligator",
    placement: "price",
    compute: ({ bars }) => {
      const { jaw, teeth, lips } = ind.alligator(bars);
      return {
        plots: [
          line("jaw", "Jaw", jaw, BLUE),
          line("teeth", "Teeth", teeth, ROSE),
          line("lips", "Lips", lips, UP),
        ],
      };
    },
  },
  {
    key: "aroon",
    label: "Aroon",
    placement: "pane",
    compute: ({ bars }) => {
      const { up, down } = ind.aroon(bars, 25);
      return {
        plots: [line("up", "Up", up, UP), line("down", "Down", down, DOWN)],
        levels: [
          { value: 70, color: SLATE, dashed: true },
          { value: 30, color: SLATE, dashed: true },
        ],
      };
    },
  },
  {
    key: "average-true-range",
    label: "Average True Range",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("atr", "ATR 14", ind.atr(bars, 14), AMBER)],
    }),
  },
  {
    key: "awesome-oscillator",
    label: "Awesome Oscillator",
    placement: "pane",
    compute: ({ bars }) => {
      const values = ind.awesomeOscillator(bars);
      return {
        plots: [
          {
            key: "ao",
            label: "AO",
            type: "histogram",
            color: TEAL,
            values,
            colors: directionColors(values),
          },
        ],
        levels: [{ value: 0, color: SLATE }],
      };
    },
  },
  {
    key: "balance-of-power",
    label: "Balance of Power",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("bop", "BOP", ind.balanceOfPower(bars, 14), VIOLET)],
      levels: [{ value: 0, color: SLATE }],
    }),
  },
  {
    key: "bollinger-percent-b",
    label: "Bollinger %b",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("pb", "%b", ind.bollingerBands(bars).percentB, BLUE)],
      levels: [
        { value: 100, color: SLATE, dashed: true },
        { value: 0, color: SLATE, dashed: true },
      ],
    }),
  },
  {
    key: "bollinger-bands",
    label: "Bollinger Bands",
    placement: "price",
    compute: ({ bars }) => {
      const { middle, upper, lower } = ind.bollingerBands(bars, 20, 2);
      return {
        plots: [
          line("upper", "Upper", upper, BLUE),
          line("middle", "Basis", middle, SLATE, { dashed: true }),
          line("lower", "Lower", lower, BLUE),
        ],
      };
    },
  },
  {
    key: "bollinger-bandwidth",
    label: "Bollinger Bandwidth",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("bw", "Bandwidth", ind.bollingerBands(bars).bandwidth, VIOLET)],
    }),
  },
  {
    key: "chaikin-money-flow",
    label: "Chaikin Money Flow",
    placement: "pane",
    compute: ({ bars }) => {
      const values = ind.chaikinMoneyFlow(bars, 20);
      return {
        plots: [
          {
            key: "cmf",
            label: "CMF",
            type: "histogram",
            color: TEAL,
            values,
            colors: signColors(values),
          },
        ],
        levels: [{ value: 0, color: SLATE }],
        precision: 3,
      };
    },
  },
  {
    key: "chaikin-volatility",
    label: "Chaikin Volatility",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("cv", "Volatility", ind.chaikinVolatility(bars), AMBER)],
      levels: [{ value: 0, color: SLATE }],
    }),
  },
  {
    key: "chande-momentum",
    label: "Chande Momentum Oscillator",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("cmo", "CMO", ind.chandeMomentum(bars, 20), BLUE)],
      levels: [
        { value: 50, color: SLATE, dashed: true },
        { value: 0, color: SLATE },
        { value: -50, color: SLATE, dashed: true },
      ],
    }),
  },
  {
    key: "cci",
    label: "Commodity Channel Index",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("cci", "CCI 20", ind.cci(bars, 20), VIOLET)],
      levels: [
        { value: 100, color: SLATE, dashed: true },
        { value: -100, color: SLATE, dashed: true },
      ],
    }),
  },
  {
    key: "elder-force-index",
    label: "Elder Force Index",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("fi", "Force", ind.forceIndex(bars, 13), ROSE)],
      levels: [{ value: 0, color: SLATE }],
      compact: true,
    }),
  },
  {
    key: "historical-volatility",
    label: "Historical Volatility",
    placement: "pane",
    compute: (context) => ({
      plots: [
        line(
          "hv",
          "HV 20",
          ind.historicalVolatility(context.bars, 20, barsPerYear(context)),
          AMBER,
        ),
      ],
    }),
  },
  {
    key: "ichimoku",
    label: "Ichimoku Clouds",
    placement: "price",
    compute: ({ bars }) => {
      const { conversion, base, spanA, spanB, lagging } = ind.ichimoku(bars);
      return {
        plots: [
          line("conversion", "Tenkan", conversion, BLUE),
          line("base", "Kijun", base, ROSE),
          line("spanA", "Span A", spanA, UP),
          line("spanB", "Span B", spanB, DOWN),
          line("lagging", "Chikou", lagging, SLATE, { dashed: true }),
        ],
      };
    },
  },
  {
    key: "keltner-channel",
    label: "Keltner Channel",
    placement: "price",
    compute: ({ bars }) => {
      const { middle, upper, lower } = ind.keltnerChannel(bars);
      return {
        plots: [
          line("upper", "Upper", upper, VIOLET),
          line("middle", "Basis", middle, SLATE, { dashed: true }),
          line("lower", "Lower", lower, VIOLET),
        ],
      };
    },
  },
  {
    key: "klinger-volume-oscillator",
    label: "Klinger Volume Oscillator",
    placement: "pane",
    compute: ({ bars }) => {
      const { klinger, signal } = ind.klingerOscillator(bars);
      return {
        plots: [
          line("kvo", "KVO", klinger, BLUE),
          line("signal", "Signal", signal, AMBER),
        ],
        levels: [{ value: 0, color: SLATE }],
        compact: true,
      };
    },
  },
  {
    key: "linear-reg-slope",
    label: "Linear Reg Slope",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("slope", "Slope 14", ind.linearRegressionSlope(bars, 14), TEAL)],
      levels: [{ value: 0, color: SLATE }],
      precision: 4,
    }),
  },
  {
    key: "macd",
    label: "MACD",
    placement: "pane",
    compute: ({ bars }) => {
      const result = ind.macd(bars, 12, 26, 9);
      return {
        plots: [
          {
            key: "histogram",
            label: "Hist",
            type: "histogram",
            color: SLATE,
            values: result.histogram,
            colors: signColors(result.histogram),
          },
          line("macd", "MACD", result.macd, BLUE),
          line("signal", "Signal", result.signal, AMBER),
        ],
        levels: [{ value: 0, color: SLATE }],
        precision: 3,
      };
    },
  },
  {
    key: "market-facilitation-index",
    label: "Market Facilitation Index",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [
        {
          key: "mfi",
          label: "MFI",
          type: "histogram",
          color: VIOLET,
          values: ind.marketFacilitationIndex(bars),
        },
      ],
      precision: 8,
    }),
  },
  {
    key: "moving-average",
    label: "Moving Average (EMA 21)",
    placement: "price",
    compute: ({ bars }) => ({
      plots: [line("ema", "EMA 21", ind.ema(ind.closeSeries(bars), 21), AMBER, { lineWidth: 2 })],
    }),
  },
  {
    key: "moving-average-cross",
    label: "Moving Average Cross (50/200)",
    placement: "price",
    compute: ({ bars }) => {
      const close = ind.closeSeries(bars);
      return {
        plots: [
          line("fast", "SMA 50", ind.sma(close, 50), BLUE),
          line("slow", "SMA 200", ind.sma(close, 200), ROSE, { lineWidth: 2 }),
        ],
      };
    },
  },
  {
    key: "moving-average-envelope",
    label: "Moving Average Envelope",
    placement: "price",
    compute: ({ bars }) => {
      const { middle, upper, lower } = ind.envelope(bars, 20, 2.5);
      return {
        plots: [
          line("upper", "Upper", upper, TEAL),
          line("middle", "Basis", middle, SLATE, { dashed: true }),
          line("lower", "Lower", lower, TEAL),
        ],
      };
    },
  },
  {
    key: "on-balance-volume",
    label: "On Balance Volume",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("obv", "OBV", ind.onBalanceVolume(bars), BLUE)],
      compact: true,
    }),
  },
  {
    key: "parabolic-sar",
    label: "Parabolic SAR",
    placement: "price",
    compute: ({ bars }) => ({
      plots: [
        {
          key: "sar",
          label: "SAR",
          type: "dots",
          color: AMBER,
          values: ind.parabolicSar(bars),
        },
      ],
    }),
  },
  {
    key: "pivot-points",
    label: "Pivot Points",
    placement: "price",
    compute: ({ bars }) => {
      const { pivot, r1, r2, s1, s2 } = ind.pivotPoints(bars);
      return {
        plots: [
          line("r2", "R2", r2, DOWN, { dashed: true }),
          line("r1", "R1", r1, DOWN),
          line("p", "P", pivot, SLATE, { lineWidth: 2 }),
          line("s1", "S1", s1, UP),
          line("s2", "S2", s2, UP, { dashed: true }),
        ],
      };
    },
  },
  {
    key: "price-oscillator",
    label: "Price Oscillator",
    placement: "pane",
    compute: ({ bars }) => {
      const { oscillator, signal } = ind.priceOscillator(bars);
      return {
        plots: [
          line("po", "PPO", oscillator, BLUE),
          line("signal", "Signal", signal, AMBER),
        ],
        levels: [{ value: 0, color: SLATE }],
      };
    },
  },
  {
    key: "price-rate-of-change",
    label: "Price Rate of Change",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("roc", "ROC 12", ind.rateOfChange(ind.closeSeries(bars), 12), TEAL)],
      levels: [{ value: 0, color: SLATE }],
    }),
  },
  {
    key: "relative-volatility",
    label: "Relative Volatility",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("rvi", "RVI", ind.relativeVolatilityIndex(bars), VIOLET)],
      levels: [
        { value: 60, color: SLATE, dashed: true },
        { value: 40, color: SLATE, dashed: true },
      ],
    }),
  },
  {
    key: "rsi",
    label: "RSI",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("rsi", "RSI 14", ind.rsi(bars, 14), VIOLET, { lineWidth: 2 })],
      levels: [
        { value: 70, color: DOWN, dashed: true },
        { value: 50, color: SLATE, dashed: true },
        { value: 30, color: UP, dashed: true },
      ],
    }),
  },
  {
    key: "standard-deviation",
    label: "Standard Deviation",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("sd", "StdDev 20", ind.stdev(ind.closeSeries(bars), 20), AMBER)],
    }),
  },
  {
    key: "stochastic-momentum-index",
    label: "Stochastic Momentum Index",
    placement: "pane",
    compute: ({ bars }) => {
      const { smi, signal } = ind.stochasticMomentumIndex(bars);
      return {
        plots: [
          line("smi", "SMI", smi, BLUE, { lineWidth: 2 }),
          line("signal", "Signal", signal, AMBER),
        ],
        levels: [
          { value: 40, color: SLATE, dashed: true },
          { value: -40, color: SLATE, dashed: true },
        ],
      };
    },
  },
  {
    key: "stochastics",
    label: "Stochastics",
    placement: "pane",
    compute: ({ bars }) => {
      const { k, d } = ind.stochastic(bars, 14, 3, 3);
      return {
        plots: [line("k", "%K", k, BLUE, { lineWidth: 2 }), line("d", "%D", d, AMBER)],
        levels: [
          { value: 80, color: DOWN, dashed: true },
          { value: 20, color: UP, dashed: true },
        ],
      };
    },
  },
  {
    key: "swing-index",
    label: "Swing Index",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("si", "SI", ind.swingIndex(bars), ROSE)],
      levels: [{ value: 0, color: SLATE }],
    }),
  },
  {
    key: "trix",
    label: "TRIX",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("trix", "TRIX 15", ind.trix(bars, 15), TEAL)],
      levels: [{ value: 0, color: SLATE }],
      precision: 4,
    }),
  },
  {
    key: "true-range",
    label: "True Range",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [
        {
          key: "tr",
          label: "TR",
          type: "histogram",
          color: SLATE,
          values: ind.trueRange(bars),
        },
      ],
    }),
  },
  {
    key: "typical-price",
    label: "Typical Price",
    placement: "price",
    compute: ({ bars }) => ({
      plots: [line("tp", "Typical", ind.hlc3(bars), AMBER)],
    }),
  },
  {
    key: "ultimate-oscillator",
    label: "Ultimate Oscillator",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("uo", "UO", ind.ultimateOscillator(bars), BLUE, { lineWidth: 2 })],
      levels: [
        { value: 70, color: DOWN, dashed: true },
        { value: 30, color: UP, dashed: true },
      ],
    }),
  },
  {
    key: "volume-oscillator",
    label: "Volume Oscillator",
    placement: "pane",
    compute: ({ bars }) => {
      const values = ind.volumeOscillator(bars, 14, 28);
      return {
        plots: [
          {
            key: "vo",
            label: "VO",
            type: "histogram",
            color: TEAL,
            values,
            colors: signColors(values),
          },
        ],
        levels: [{ value: 0, color: SLATE }],
      };
    },
  },
  {
    key: "volume-underlay",
    label: "Volume Underlay",
    placement: "price",
    compute: ({ bars }) => ({
      plots: [
        {
          key: "volume",
          label: "Vol",
          type: "histogram",
          color: SLATE,
          underlay: true,
          values: bars.map((bar) => bar.v),
          colors: bars.map((bar) =>
            bar.c >= bar.o ? "rgba(52,211,153,0.35)" : "rgba(248,113,113,0.35)"),
        },
      ],
      compact: true,
    }),
  },
  {
    key: "vortex",
    label: "Vortex Indicator",
    placement: "pane",
    compute: ({ bars }) => {
      const { plus, minus } = ind.vortex(bars, 14);
      return {
        plots: [line("plus", "+VI", plus, UP), line("minus", "-VI", minus, DOWN)],
        levels: [{ value: 1, color: SLATE, dashed: true }],
        precision: 3,
      };
    },
  },
  {
    key: "vwap",
    label: "VWAP",
    placement: "price",
    compute: ({ bars, timespan }) => ({
      plots: [
        line("vwap", "VWAP", ind.vwap(bars, timespan !== "day"), AMBER, { lineWidth: 2 }),
      ],
    }),
  },
  {
    key: "williams-r",
    label: "Williams %R",
    placement: "pane",
    compute: ({ bars }) => ({
      plots: [line("wr", "%R 14", ind.williamsR(bars, 14), ROSE, { lineWidth: 2 })],
      levels: [
        { value: -20, color: DOWN, dashed: true },
        { value: -80, color: UP, dashed: true },
      ],
    }),
  },
  {
    key: "zigzag",
    label: "ZigZag",
    placement: "price",
    compute: ({ bars }) => ({
      plots: [line("zigzag", "ZigZag 5%", ind.zigZag(bars, 5), SLATE, { lineWidth: 2 })],
    }),
  },
];

const STUDIES_BY_KEY = new Map(STUDIES.map((study) => [study.key, study]));

export function getStudy(key: string): StudyDefinition | undefined {
  return STUDIES_BY_KEY.get(key);
}

/** Drops unknown keys and duplicates while keeping the user's chosen order. */
export function normalizeStudyKeys(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const keys: string[] = [];

  for (const value of input) {
    if (typeof value !== "string" || seen.has(value) || !STUDIES_BY_KEY.has(value)) {
      continue;
    }
    seen.add(value);
    keys.push(value);
  }

  return keys;
}
