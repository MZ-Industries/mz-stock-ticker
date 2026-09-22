import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  listenMenuAutoUpdateCheck,
  listenMenuCheckForUpdates,
  setAutoUpdateCheckMenuItem,
} from "./api";
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_STARTUP_DELAY_MS } from "./constants";
import { els } from "./elements";
import { debugLog, persistPrefs, state } from "./store";

let pendingUpdate: Update | null = null;
let checking = false;
let installing = false;
let autoCheckTimer: number | null = null;
let dialogOpen = false;
let dialogAction: (() => void) | null = null;

function setPill(text: string, opts: { highlight?: boolean } = {}): void {
  els.updatePillEl.textContent = text;
  els.updatePillEl.classList.toggle("highlight", opts.highlight === true);
  els.updatePillEl.classList.remove("hidden");
}

/** The status line only speaks up when there is something to report. */
function hidePill(): void {
  els.updatePillEl.textContent = "";
  els.updatePillEl.classList.remove("highlight");
  els.updatePillEl.classList.add("hidden");
}

type DialogView = {
  title: string;
  message: string;
  /** Release notes, shown verbatim in a scrolling block. */
  notes?: string;
  /** Download progress from 0 to 1; omitted hides the bar. */
  progress?: number;
  action?: { label: string; run: () => void };
  dismissLabel?: string;
  /** Closing mid-install would strand the download, so the dialog locks. */
  locked?: boolean;
};

/** Single path for what the dialog says; every state goes through here. */
function showDialog(view: DialogView): void {
  els.updateTitleEl.textContent = view.title;
  els.updateMessageEl.textContent = view.message;

  const notes = view.notes?.trim();
  els.updateNotesEl.textContent = notes ?? "";
  els.updateNotesEl.classList.toggle("hidden", !notes);

  const hasProgress = view.progress !== undefined;
  els.updateProgressEl.classList.toggle("hidden", !hasProgress);
  if (hasProgress) {
    const percent = Math.round(Math.min(1, Math.max(0, view.progress as number)) * 100);
    els.updateProgressFillEl.style.width = `${percent}%`;
    els.updateProgressEl.setAttribute("aria-valuenow", String(percent));
  }

  dialogAction = view.action?.run ?? null;
  els.updateActionEl.textContent = view.action?.label ?? "";
  els.updateActionEl.classList.toggle("hidden", !view.action);

  els.updateDismissEl.textContent = view.dismissLabel ?? "Close";
  els.updateFooterEl.classList.toggle("hidden", view.locked === true);
  els.updateCloseEl.classList.toggle("hidden", view.locked === true);

  const wasOpen = dialogOpen;
  dialogOpen = true;
  els.updateOverlayEl.classList.remove("hidden");

  // Only on the way in: leaving focus put once keeps a progress redraw from
  // yanking it, and keeps Enter from landing on a button that just appeared.
  if (!wasOpen && view.locked !== true) {
    els.updateDismissEl.focus();
  }
}

export function isUpdateDialogOpen(): boolean {
  return dialogOpen;
}

export function closeUpdateDialog(): void {
  // An install in flight owns the dialog until it relaunches or fails.
  if (installing) {
    return;
  }

  dialogOpen = false;
  dialogAction = null;
  els.updateOverlayEl.classList.add("hidden");
}

function showAvailable(update: Update): void {
  showDialog({
    title: "Update Available",
    message: `Version ${update.version} is ready to install. You are running ${update.currentVersion}.`,
    notes: update.body,
    action: { label: "Install & Restart", run: () => void installPendingUpdate() },
    dismissLabel: "Later",
  });
}

async function showUpToDate(): Promise<void> {
  let version = "";
  try {
    version = await getVersion();
  } catch (error) {
    debugLog("updater:version-failed", String(error));
  }

  showDialog({
    title: "Software Update",
    message: version
      ? `MZ Stock Ticker ${version} is the latest version.`
      : "MZ Stock Ticker is up to date.",
  });
}

async function checkForUpdate(manual: boolean): Promise<void> {
  if (checking || installing) {
    return;
  }

  // A check already found something; re-open the offer rather than re-asking.
  if (pendingUpdate) {
    if (manual) {
      showAvailable(pendingUpdate);
    }
    return;
  }

  // The dev build is not an installed bundle, so there is nothing to replace.
  if (import.meta.env.DEV) {
    if (manual) {
      showDialog({
        title: "Software Update",
        message: "Updates are disabled in this development build.",
      });
    }
    return;
  }

  checking = true;
  if (manual) {
    showDialog({ title: "Software Update", message: "Checking for updates…" });
  }

  try {
    const update = await check();
    if (update) {
      pendingUpdate = update;
      setPill(`Update v${update.version}`, { highlight: true });
      if (manual) {
        showAvailable(update);
      }
    } else if (manual) {
      await showUpToDate();
    }
  } catch (error) {
    // Offline, GitHub unreachable, or no published release yet.
    debugLog("updater:check-failed", String(error));
    if (manual) {
      showDialog({
        title: "Software Update",
        message: "Could not check for updates. Check your connection and try again.",
        notes: String(error),
        action: { label: "Try Again", run: () => void checkForUpdate(true) },
      });
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

    const report = (message: string, progress?: number): void => {
      setPill(message, { highlight: true });
      showDialog({ title: "Installing Update", message, progress, locked: true });
    };

    report(`Downloading version ${update.version}…`, 0);
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength ?? 0;
          break;
        case "Progress":
          receivedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            const fraction = receivedBytes / totalBytes;
            report(`Downloading update… ${Math.round(fraction * 100)}%`, fraction);
          }
          break;
        case "Finished":
          report("Installing update…", 1);
          break;
      }
    });

    report("Restarting…", 1);
    await relaunch();
  } catch (error) {
    debugLog("updater:install-failed", String(error));
    installing = false;
    setPill(`Update v${update.version} failed`, { highlight: true });
    showDialog({
      title: "Update Failed",
      message: `Version ${update.version} could not be installed.`,
      notes: String(error),
      action: { label: "Try Again", run: () => void installPendingUpdate() },
    });
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
      void checkForUpdate(true);
    });

    await listenMenuAutoUpdateCheck((enabled) => {
      applyAutoCheck(enabled, { checkNow: enabled });
    });
  } catch (error) {
    debugLog("updater:menu-listen-failed", String(error));
  }
}

function registerDialogHandlers(): void {
  els.updateActionEl.addEventListener("click", () => {
    dialogAction?.();
  });

  els.updateDismissEl.addEventListener("click", closeUpdateDialog);
  els.updateCloseEl.addEventListener("click", closeUpdateDialog);

  els.updateOverlayEl.addEventListener("click", (event) => {
    if (event.target === els.updateOverlayEl) {
      closeUpdateDialog();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialogOpen) {
      event.stopPropagation();
      closeUpdateDialog();
    }
  });
}

/**
 * Updates are driven from the application menu: "Check for Updates…" opens a
 * dialog that reports what the check turned up — up to date, a new version
 * with its release notes, or why the check failed — and installs from there,
 * which downloads the signed bundle, applies it, and relaunches the app. The
 * checkbox beside the menu item decides whether the app also checks shortly
 * after startup and every few hours; those background checks stay quiet and
 * only raise the status-line pill, which reopens the dialog on a click.
 */
export function initUpdater(): void {
  // The pill is the same door as the menu item: it reopens a waiting offer,
  // and otherwise runs a check.
  els.updatePillEl.addEventListener("click", () => {
    void checkForUpdate(true);
  });

  hidePill();
  registerDialogHandlers();
  void registerMenuHandlers();
  applyAutoCheck(state.prefs.autoUpdateCheck !== false);

  window.setTimeout(() => {
    if (state.prefs.autoUpdateCheck !== false) {
      void checkForUpdate(false);
    }
  }, UPDATE_CHECK_STARTUP_DELAY_MS);
}
