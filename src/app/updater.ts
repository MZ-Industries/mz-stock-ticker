import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_STARTUP_DELAY_MS,
  UPDATE_PILL_REVERT_MS,
} from "./constants";
import { els } from "./elements";
import { debugLog } from "./store";

const IDLE_LABEL = "Check for updates";

let pendingUpdate: Update | null = null;
let checking = false;
let installing = false;
let revertTimer: number | null = null;

function setPill(text: string, opts: { clickable?: boolean; highlight?: boolean } = {}): void {
  if (revertTimer !== null) {
    window.clearTimeout(revertTimer);
    revertTimer = null;
  }

  els.updatePillEl.textContent = text;
  els.updatePillEl.disabled = opts.clickable !== true;
  els.updatePillEl.classList.toggle("highlight", opts.highlight === true);
  els.updatePillEl.classList.remove("hidden");
}

/** Transient outcomes ("Up to date") fall back to the idle label after a beat. */
function schedulePillRevert(): void {
  revertTimer = window.setTimeout(() => {
    revertTimer = null;
    if (!pendingUpdate && !installing) {
      setPill(IDLE_LABEL, { clickable: true });
    }
  }, UPDATE_PILL_REVERT_MS);
}

async function checkForUpdate(manual: boolean): Promise<void> {
  if (checking || installing || pendingUpdate) {
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
      setPill("Check failed — click to retry", { clickable: true });
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
 * Status-line pill offering on-demand update checks against GitHub Releases;
 * automatic checks run shortly after startup and every few hours. Installing
 * downloads the signed update, applies it, and relaunches the app. Skipped in
 * dev, where the running app is not an installed bundle.
 */
export function initUpdater(): void {
  if (import.meta.env.DEV) {
    return;
  }

  els.updatePillEl.addEventListener("click", () => {
    if (pendingUpdate) {
      void installPendingUpdate();
    } else {
      void checkForUpdate(true);
    }
  });

  setPill(IDLE_LABEL, { clickable: true });

  window.setTimeout(() => {
    void checkForUpdate(false);
  }, UPDATE_CHECK_STARTUP_DELAY_MS);

  window.setInterval(() => {
    void checkForUpdate(false);
  }, UPDATE_CHECK_INTERVAL_MS);
}
