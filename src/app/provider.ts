import * as api from "./api";
import { BARS_REFRESH_BASELINE_MS } from "./constants";
import { els } from "./elements";
import { debugLog, state } from "./store";

export async function loadProviderStatus(): Promise<void> {
  try {
    state.providerStatus = await api.getProviderStatus();
    debugLog("provider:status", state.providerStatus);
    renderProviderStatus();
  } catch (error) {
    debugLog("provider:status-failed", String(error));
  }
}

export function renderProviderStatus(): void {
  const provider = state.providerStatus?.provider ?? "yahoo";
  const streaming = state.providerStatus?.streaming ?? false;
  const pollSeconds = Math.round((state.providerStatus?.poll_interval_ms ?? 0) / 1000);

  els.providerPillEl.textContent = `Provider: ${provider.toUpperCase()}`;
  els.streamPillEl.textContent = streaming ? `Live: every ${pollSeconds}s` : "Live: off";
  els.streamPillEl.classList.toggle("muted", !streaming);
}

export function updateLagPill(referenceMs?: number): void {
  if (!Number.isFinite(referenceMs)) {
    els.lagPillEl.textContent = "Lag: --";
    els.lagPillEl.classList.add("muted");
    return;
  }

  const lagSec = Math.max(0, Math.floor((Date.now() - (referenceMs as number)) / 1000));
  if (lagSec >= 120) {
    const lagMin = Math.round(lagSec / 60);
    els.lagPillEl.textContent = `Lag: ${lagMin}m`;
  } else {
    els.lagPillEl.textContent = `Lag: ${lagSec}s`;
  }

  els.lagPillEl.classList.toggle("muted", lagSec < 15);
}

export function barsRefreshCadenceMs(): number {
  // The live poller keeps the trailing candle current, so this full refetch only
  // has to repair history (splits, late volume) - it can afford to be lazy.
  return document.hidden ? BARS_REFRESH_BASELINE_MS * 3 : BARS_REFRESH_BASELINE_MS;
}
