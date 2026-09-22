import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  listenMenuAutoUpdateCheck,
  listenMenuCheckForUpdates,
  setAutoUpdateCheckMenuItem,
} from "./api";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_STARTUP_DELAY_MS,
  UPDATE_PILL_REVERT_MS,
} from "./constants";
import { els } from "./elements";
import { debugLog, persistPrefs, state } from "./store";

let pendingUpdate: Update | null = null;
let checking = false;
let installing = false;
let revertTimer: number | null = null;
let autoCheckTimer: number | null = null;

function clearRevertTimer(): void {
  if (revertTimer !== null) {
    window.clearTimeout(revertTimer);
    revertTimer = null;
  }
}

function setPill(text: string, opts: { clickable?: boolean; highlight?: boolean } = {}): void {
  clearRevertTimer();

  els.updatePillEl.textContent = text;
  els.updatePillEl.disabled = opts.clickable !== true;
  els.updatePillEl.classList.toggle("highlight", opts.highlight === true);
  els.updatePillEl.classList.remove("hidden");
}

/** The status line only speaks up when there is something to report. */
function hidePill(): void {
  clearRevertTimer();

  els.updatePillEl.textContent = "";
  els.updatePillEl.disabled = true;
  els.updatePillEl.classList.remove("highlight");
  els.updatePillEl.classList.add("hidden");
}

/** Transient outcomes ("Up to date") clear themselves after a beat. */
function schedulePillRevert(): void {
  revertTimer = window.setTimeout(() => {
    revertTimer = null;
    if (!pendingUpdate && !installing) {
      hidePill();
    }
  }, UPDATE_PILL_REVERT_MS);
}

async function checkForUpdate(manual: boolean): Promise<void> {
  if (checking || installing || pendingUpdate) {
    return;
  }

  // The dev build is not an installed bundle, so there is nothing to replace.
  if (import.meta.env.DEV) {
    if (manual) {
      setPill("Updates are disabled in dev");
      schedulePillRevert();
    }
    return;
  }

  checking = true;
  if (manual) {
    setPill("Checking…");
  }

  try {
    const update = await check();
    if (update) {
      pendingUpdate = update;
      setPill(`Update v${update.version} — install & restart`, { clickable: true, highlight: true });
    } else if (manual) {
      setPill("Up to date");
      schedulePillRevert();
    }
  } catch (error) {
    // Offline, GitHub unreachable, or no published release yet.
    debugLog("updater:check-failed", String(error));
    if (manual) {
      setPill("Update check failed");
      schedulePillRevert();
    }
  } finally {
    checking = false;
  }
}

async function installPendingUpdate(): Promise<void> {
  const update = pendingUpdate;
  if (!update || installing) {
    return;
  }

  installing = true;
  try {
    let totalBytes = 0;
    let receivedBytes = 0;

    setPill("Downloading update…", { highlight: true });
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength ?? 0;
          break;
        case "Progress":
          receivedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setPill(`Downloading update… ${Math.round((receivedBytes / totalBytes) * 100)}%`, {
              highlight: true,
            });
          }
          break;
        case "Finished":
          setPill("Installing update…", { highlight: true });
          break;
      }
    });

    setPill("Restarting…", { highlight: true });
    await relaunch();
  } catch (error) {
    debugLog("updater:install-failed", String(error));
    installing = false;
    setPill(`Update v${update.version} failed — click to retry`, { clickable: true, highlight: true });
  }
}

/**
 * Single path for the automatic-check preference: persist it, mirror it into
 * the menu's checkbox, and start or stop the background timer.
 */
function applyAutoCheck(enabled: boolean, opts: { checkNow?: boolean } = {}): void {
  state.prefs.autoUpdateCheck = enabled;
  persistPrefs();

  void setAutoUpdateCheckMenuItem(enabled).catch((error) => {
    debugLog("updater:menu-sync-failed", String(error));
  });

  if (autoCheckTimer !== null) {
    window.clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }

  if (!enabled) {
    return;
  }

  autoCheckTimer = window.setInterval(() => {
    void checkForUpdate(false);
  }, UPDATE_CHECK_INTERVAL_MS);

  if (opts.checkNow) {
    void checkForUpdate(false);
  }
}

async function registerMenuHandlers(): Promise<void> {
  try {
    await listenMenuCheckForUpdates(() => {
      if (pendingUpdate) {
        void installPendingUpdate();
        return;
      }

      void checkForUpdate(true);
    });

    await listenMenuAutoUpdateCheck((enabled) => {
      applyAutoCheck(enabled, { checkNow: enabled });
    });
  } catch (error) {
    debugLog("updater:menu-listen-failed", String(error));
  }
}

/**
 * Updates are driven from the application menu: "Check for Updates…" runs an
 * on-demand check, and the checkbox beside it decides whether the app also
 * checks shortly after startup and every few hours. The status-line pill
 * reports whatever a check turned up and installs a waiting update, which
 * downloads the signed bundle, applies it, and relaunches the app.
 */
export function initUpdater(): void {
  els.updatePillEl.addEventListener("click", () => {
    if (pendingUpdate) {
      void installPendingUpdate();
    }
  });

  hidePill();
  void registerMenuHandlers();
  applyAutoCheck(state.prefs.autoUpdateCheck !== false);

  window.setTimeout(() => {
    if (state.prefs.autoUpdateCheck !== false) {
      void checkForUpdate(false);
    }
  }, UPDATE_CHECK_STARTUP_DELAY_MS);
}
