import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_STARTUP_DELAY_MS } from "./constants";
import { els } from "./elements";
import { debugLog } from "./store";

let pendingUpdate: Update | null = null;
let installing = false;

function showPill(text: string, clickable: boolean): void {
  els.updatePillEl.textContent = text;
  els.updatePillEl.disabled = !clickable;
  els.updatePillEl.classList.remove("hidden");
}

async function checkForUpdate(): Promise<void> {
  if (pendingUpdate || installing) {
    return;
  }

  try {
    const update = await check();
    if (update) {
      pendingUpdate = update;
      showPill(`Update v${update.version} — install & restart`, true);
    }
  } catch (error) {
    // Offline, GitHub unreachable, or no published release yet; try again next cycle.
    debugLog("updater:check-failed", String(error));
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

    showPill("Downloading update…", false);
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength ?? 0;
          break;
        case "Progress":
          receivedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            showPill(`Downloading update… ${Math.round((receivedBytes / totalBytes) * 100)}%`, false);
          }
          break;
        case "Finished":
          showPill("Installing update…", false);
          break;
      }
    });

    showPill("Restarting…", false);
    await relaunch();
  } catch (error) {
    debugLog("updater:install-failed", String(error));
    installing = false;
    showPill(`Update v${update.version} failed — click to retry`, true);
  }
}

/**
 * Checks GitHub Releases for a newer version shortly after startup and every
 * few hours after; a pill in the status line offers a one-click install.
 * Skipped in dev, where the running app is not an installed bundle.
 */
export function initUpdater(): void {
  if (import.meta.env.DEV) {
    return;
  }

  els.updatePillEl.addEventListener("click", () => {
    void installPendingUpdate();
  });

  window.setTimeout(() => {
    void checkForUpdate();
  }, UPDATE_CHECK_STARTUP_DELAY_MS);

  window.setInterval(() => {
    void checkForUpdate();
  }, UPDATE_CHECK_INTERVAL_MS);
}
