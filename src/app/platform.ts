import * as api from "./api";

/**
 * True on iOS and Android. Every mobile-only branch keys off this, so the
 * desktop code paths stay exactly as they were.
 */
export let IS_MOBILE = false;

const MOBILE_PLATFORMS = new Set(["ios", "android"]);

/** Asks the backend which OS it was built for and tags `<html>` to match. */
export async function initPlatform(): Promise<void> {
  let platform = "";
  try {
    platform = await api.appPlatform();
  } catch {
    // Outside Tauri (a plain browser) there is no backend; treat it as desktop.
  }

  IS_MOBILE = MOBILE_PLATFORMS.has(platform);
  const root = document.documentElement;
  if (platform) {
    root.dataset.platform = platform;
  }
  root.classList.toggle("is-mobile", IS_MOBILE);
}
