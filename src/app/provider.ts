import type { ProviderStatus } from "./types";

export function renderProviderStatusView(params: {
  providerStatus: ProviderStatus | null;
  providerPillEl: HTMLSpanElement;
  streamPillEl: HTMLSpanElement;
}): void {
  const { providerStatus, providerPillEl, streamPillEl } = params;

  const provider = providerStatus?.provider ?? "yahoo";
  const streaming = providerStatus?.streaming ?? false;
  const pollSeconds = Math.round((providerStatus?.poll_interval_ms ?? 0) / 1000);

  providerPillEl.textContent = `Provider: ${provider.toUpperCase()}`;
  streamPillEl.textContent = streaming ? `Live: every ${pollSeconds}s` : "Live: off";
  streamPillEl.classList.toggle("muted", !streaming);
}

export function updateLagPillView(params: {
  referenceMs?: number;
  lagPillEl: HTMLSpanElement;
}): void {
  const { referenceMs, lagPillEl } = params;

  if (!Number.isFinite(referenceMs)) {
    lagPillEl.textContent = "Lag: --";
    lagPillEl.classList.add("muted");
    return;
  }

  const lagSec = Math.max(0, Math.floor((Date.now() - (referenceMs as number)) / 1000));
  if (lagSec >= 120) {
    const lagMin = Math.round(lagSec / 60);
    lagPillEl.textContent = `Lag: ${lagMin}m`;
  } else {
    lagPillEl.textContent = `Lag: ${lagSec}s`;
  }

  lagPillEl.classList.toggle("muted", lagSec < 15);
}

export function barsRefreshCadenceMsView(params: {
  baselineMs: number;
  isDocumentHidden: boolean;
}): number {
  const { baselineMs, isDocumentHidden } = params;
  // The live poller keeps the trailing candle current, so this full refetch only
  // has to repair history (splits, late volume) - it can afford to be lazy.
  return isDocumentHidden ? baselineMs * 3 : baselineMs;
}

export function scheduleAdaptiveBarsRefreshView(params: {
  getBarsRefreshTimer: () => number | null;
  setBarsRefreshTimer: (value: number | null) => void;
  barsRefreshCadenceMs: () => number;
  isApiCooldownActive: () => boolean;
  loadBars: () => Promise<void>;
  loadWatchlist?: () => Promise<void>;
}): void {
  const {
    getBarsRefreshTimer,
    setBarsRefreshTimer,
    barsRefreshCadenceMs,
    isApiCooldownActive,
    loadBars,
    loadWatchlist,
  } = params;

  const currentTimer = getBarsRefreshTimer();
  if (currentTimer !== null) {
    window.clearTimeout(currentTimer);
    setBarsRefreshTimer(null);
  }

  const cadence = barsRefreshCadenceMs();
  const timer = window.setTimeout(async () => {
    setBarsRefreshTimer(null);
    if (!isApiCooldownActive()) {
      const refreshTasks: Array<Promise<unknown>> = [loadBars()];
      if (loadWatchlist) {
        refreshTasks.push(loadWatchlist());
      }
      await Promise.allSettled(refreshTasks);
    }
    scheduleAdaptiveBarsRefreshView(params);
  }, cadence);

  setBarsRefreshTimer(timer);
}
