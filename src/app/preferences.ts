import { getSettings, listenMenuOpenPreferences, saveSettings } from "./api";
import { els } from "./elements";
import { loadProviderStatus } from "./provider";
import { debugLog } from "./store";
import type { AppSettings } from "./types";

let opened = false;
let saving = false;

export function isPreferencesOpen(): boolean {
  return opened;
}

function setStatus(message: string, isError = false): void {
  els.prefsStatusEl.textContent = message;
  els.prefsStatusEl.classList.toggle("error", isError);
}

function fillForm(settings: AppSettings): void {
  els.prefsYahooBaseEl.value = settings.yahooBaseUrl;
  els.prefsYahooNewsBaseEl.value = settings.yahooNewsBaseUrl;
  els.prefsBackfillKeyEl.value = settings.backfillApiKey;
  els.prefsBackfillBaseEl.value = settings.backfillBaseUrl;
  // Blank reads better than a literal 0 for "let the session decide".
  els.prefsPollMsEl.value = settings.livePollMs > 0 ? String(settings.livePollMs) : "";
  els.prefsDebugEl.checked = settings.debugLogging;
}

function readForm(): AppSettings {
  const pollMs = Number.parseInt(els.prefsPollMsEl.value.trim(), 10);

  return {
    yahooBaseUrl: els.prefsYahooBaseEl.value,
    yahooNewsBaseUrl: els.prefsYahooNewsBaseEl.value,
    backfillApiKey: els.prefsBackfillKeyEl.value,
    backfillBaseUrl: els.prefsBackfillBaseEl.value,
    livePollMs: Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 0,
    debugLogging: els.prefsDebugEl.checked,
  };
}

/** Always reloads from the backend, so the form shows what is actually in use. */
export async function openPreferences(): Promise<void> {
  if (opened) {
    return;
  }

  opened = true;
  setStatus("");
  els.prefsOverlayEl.classList.remove("hidden");

  try {
    fillForm(await getSettings());
  } catch (error) {
    debugLog("preferences:load-failed", String(error));
    setStatus("Could not read the stored settings.", true);
  }

  els.prefsYahooBaseEl.focus();
}

export function closePreferences(): void {
  opened = false;
  els.prefsOverlayEl.classList.add("hidden");
}

async function submitPreferences(): Promise<void> {
  if (saving) {
    return;
  }

  saving = true;
  els.prefsSaveEl.disabled = true;
  setStatus("Saving…");

  try {
    fillForm(await saveSettings(readForm()));
    // The status line quotes the poll cadence, which may have just changed.
    await loadProviderStatus();
    closePreferences();
  } catch (error) {
    debugLog("preferences:save-failed", String(error));
    setStatus("Could not save the settings.", true);
  } finally {
    saving = false;
    els.prefsSaveEl.disabled = false;
  }
}

/**
 * Settings pane for the endpoints and keys the backend talks to, opened from
 * the application menu. Saving writes them to `settings.json` and takes effect
 * on the next request; nothing here needs a restart.
 */
export function initPreferences(): void {
  els.prefsFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPreferences();
  });

  els.prefsCancelEl.addEventListener("click", closePreferences);
  els.prefsCloseEl.addEventListener("click", closePreferences);

  els.prefsOverlayEl.addEventListener("click", (event) => {
    if (event.target === els.prefsOverlayEl) {
      closePreferences();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) {
      event.stopPropagation();
      closePreferences();
    }
  });

  void listenMenuOpenPreferences(() => {
    void openPreferences();
  }).catch((error) => {
    debugLog("preferences:menu-listen-failed", String(error));
  });
}
