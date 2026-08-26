import { AUTO_REFRESH_PROGRESS_WINDOW_MS } from "./constants";
import { els } from "./elements";
import { state } from "./store";
import { clamp } from "./utils";

let refreshProgressRaf: number | null = null;

function setRefreshProgress(value: number): void {
  els.refreshProgressFillEl.style.transform = `scaleX(${clamp(0, 1, value)})`;
}

function renderRefreshProgress(): void {
  const now = Date.now();

  if (state.refreshInFlightCount > 0) {
    els.refreshProgressEl.classList.add("loading");
    const pulse = 0.9 + ((Math.sin(now / 130) + 1) / 2) * 0.1;
    setRefreshProgress(pulse);
  } else {
    els.refreshProgressEl.classList.remove("loading");
    const elapsed = now - state.lastRefreshFinishedAtMs;
    setRefreshProgress(elapsed / AUTO_REFRESH_PROGRESS_WINDOW_MS);
  }

  refreshProgressRaf = window.requestAnimationFrame(renderRefreshProgress);
}

export function startRefreshProgressLoop(): void {
  stopRefreshProgressLoop();
  refreshProgressRaf = window.requestAnimationFrame(renderRefreshProgress);
}

export function stopRefreshProgressLoop(): void {
  if (refreshProgressRaf !== null) {
    window.cancelAnimationFrame(refreshProgressRaf);
    refreshProgressRaf = null;
  }
}

/** Marks a data refresh in flight; call the returned function when it settles. */
export function trackRefreshScope(): (success: boolean) => void {
  state.refreshInFlightCount += 1;

  return (success: boolean) => {
    state.refreshInFlightCount = Math.max(0, state.refreshInFlightCount - 1);
    if (success) {
      state.lastRefreshFinishedAtMs = Date.now();
      setRefreshProgress(0);
    }
  };
}
