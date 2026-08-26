import type { TickMarkType, Time } from "lightweight-charts";
import type { AggregateBar, RangePreset } from "./types";

export function parseRetryAfterSeconds(error: unknown): number | null {
  const text = String(error);
  const match = text.match(/retry_after=(\d+)/i);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return Math.min(seconds, 600);
}

export function isRateLimitError(error: unknown): boolean {
  const text = String(error);
  return text.includes("RATE_LIMITED") || text.includes("429");
}

export function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeStoredRatio(
  stored: number,
  containerSizePx: number,
  minRatio: number,
  maxRatio: number,
): number {
  if (!Number.isFinite(stored) || stored <= 0) {
    return clamp(minRatio, maxRatio, (minRatio + maxRatio) / 2);
  }

  // Backward compatibility: old values were saved as pixels.
  const ratio = stored > 1 ? stored / Math.max(1, containerSizePx) : stored;
  return clamp(minRatio, maxRatio, ratio);
}

export function normalizeTicker(raw: string): string | null {
  const ticker = raw.trim().toUpperCase();
  if (!ticker) {
    return null;
  }

  const valid = ticker.length <= 12 && /^[A-Z0-9.-]+$/.test(ticker);
  return valid ? ticker : null;
}

export function normalizeWatchlistSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized = input
    .map((value) => (typeof value === "string" ? normalizeTicker(value) : null))
    .filter((value): value is string => Boolean(value));

  return [...new Set(normalized)].slice(0, 60);
}

export function normalizeMovingAveragePeriods(
  input: unknown,
  allowedPeriods: readonly number[],
  fallbackPeriods: readonly number[] = [],
): number[] {
  const allowedSet = new Set(allowedPeriods.filter((period) => Number.isFinite(period) && period > 1));
  const fallback = fallbackPeriods.filter((period) => allowedSet.has(period));

  if (!Array.isArray(input)) {
    return [...fallback];
  }

  const normalized = input
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && allowedSet.has(value));

  if (normalized.length === 0) {
    return [...fallback];
  }

  return [...new Set(normalized)].sort((a, b) => a - b);
}

export function parseStoredJson(key: string): unknown | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function normalizeVisibleRange(value: unknown): { from: number; to: number } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { from?: number; to?: number };
  const from = Number(candidate.from);
  const to = Number(candidate.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  return {
    from,
    to,
  };
}

export function normalizeVisibleRangesByViewKey(input: unknown): Record<string, { from: number; to: number }> {
  if (!input || typeof input !== "object") {
    return {};
  }

  const entries = Object.entries(input as Record<string, unknown>);
  const normalizedEntries = entries
    .map(([key, value]) => {
      const normalized = normalizeVisibleRange(value);
      return normalized ? ([key, normalized] as const) : null;
    })
    .filter((entry): entry is readonly [string, { from: number; to: number }] => Boolean(entry));

  return Object.fromEntries(normalizedEntries);
}

export function fmtNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** All provider-supplied text goes through this before landing in innerHTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Compact volume / market-cap style formatting: 12.3K, 45.6M, 7.89B, 1.23T. */
export function fmtCompact(value: number): string {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const abs = Math.abs(value);
  if (abs >= 1e12) {
    return `${(value / 1e12).toFixed(2)}T`;
  }
  if (abs >= 1e9) {
    return `${(value / 1e9).toFixed(2)}B`;
  }
  if (abs >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  if (abs >= 1e3) {
    return `${(value / 1e3).toFixed(1)}K`;
  }
  return fmtNumber(value);
}

export function formatRelativeTime(timestampMs: number): string {
  const deltaSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (deltaSec < 60) {
    return "just now";
  }
  if (deltaSec < 3600) {
    return `${Math.floor(deltaSec / 60)}m ago`;
  }
  if (deltaSec < 86_400) {
    return `${Math.floor(deltaSec / 3600)}h ago`;
  }
  const days = Math.floor(deltaSec / 86_400);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(timestampMs));
}

export function fmtPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatAxisTime(time: Time, _tickType: TickMarkType, timespan: RangePreset["timespan"]): string | null {
  if (typeof time === "string") {
    return time;
  }

  if (typeof time !== "number") {
    return `${String(time.month).padStart(2, "0")}/${String(time.day).padStart(2, "0")}`;
  }

  const date = new Date(time * 1000);

  if (timespan === "day") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatTooltipTime(time: Time, timespan: RangePreset["timespan"]): string {
  if (typeof time === "string") {
    return time;
  }

  if (typeof time !== "number") {
    return `${String(time.month).padStart(2, "0")}/${String(time.day).padStart(2, "0")}`;
  }

  const date = new Date(time * 1000);
  if (timespan === "day") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function toNyIsoDate(daysBack: number): string {
  const now = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function getNyParts(timestampMs: number): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestampMs));

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

export function isRegularMarketHour(bar: AggregateBar): boolean {
  const ny = getNyParts(bar.t);
  const totalMinutes = ny.hour * 60 + ny.minute;
  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  return totalMinutes >= marketOpen && totalMinutes < marketClose;
}

export function isAfterHoursBar(bar: AggregateBar): boolean {
  const ny = getNyParts(bar.t);
  const totalMinutes = ny.hour * 60 + ny.minute;
  const marketClose = 16 * 60;
  return totalMinutes >= marketClose;
}

export function isPreMarketBar(bar: AggregateBar): boolean {
  const ny = getNyParts(bar.t);
  const totalMinutes = ny.hour * 60 + ny.minute;
  const marketOpen = 9 * 60 + 30;
  return totalMinutes < marketOpen;
}

export function formatEt(tsMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(tsMs));
}

export function formatUtc(tsMs: number): string {
  return new Date(tsMs).toISOString();
}
