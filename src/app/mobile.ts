import { resetChartView } from "./chartPanel";
import { openPreferences } from "./preferences";

/**
 * The phone layout shows one region at a time; `mobile.css` reads the active
 * tab off the shell. On wider screens (iPad landscape) the tab bar is hidden
 * and every region shows, as on desktop.
 */
export type MobileTab = "watchlist" | "chart" | "news";

const TABS: Array<{ tab: MobileTab; label: string }> = [
  { tab: "watchlist", label: "Symbols" },
  { tab: "chart", label: "Chart" },
  { tab: "news", label: "News" },
];

let shellEl: HTMLDivElement | null = null;
let tabBarEl: HTMLElement | null = null;

export function showMobileTab(tab: MobileTab): void {
  if (!shellEl || !tabBarEl) {
    return;
  }

  shellEl.dataset.tab = tab;
  tabBarEl.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

/** Adds the tab bar and the touch-only controls. Called only on mobile. */
export function initMobileShell(): void {
  shellEl = document.querySelector(".app-shell") as HTMLDivElement;
  const app = document.querySelector("#app") as HTMLDivElement;

  tabBarEl = document.createElement("nav");
  tabBarEl.className = "mobile-tabbar";
  tabBarEl.setAttribute("role", "tablist");
  tabBarEl.innerHTML = `
    ${TABS.map(({ tab, label }) => `
      <button type="button" class="mobile-tab" role="tab" data-tab="${tab}">${label}</button>
    `).join("")}
    <button type="button" class="mobile-tab" data-open-settings>Settings</button>
  `;
  app.appendChild(tabBarEl);

  tabBarEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) {
      return;
    }
    if (button.hasAttribute("data-open-settings")) {
      void openPreferences();
      return;
    }
    const tab = button.dataset.tab as MobileTab | undefined;
    if (tab) {
      showMobileTab(tab);
    }
  });

  // Double-tapping is unreliable on iOS, so the desktop double-click reset
  // gets a button.
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "pill mobile-reset";
  reset.textContent = "Reset";
  reset.addEventListener("click", resetChartView);
  document.querySelector(".chart-tools")?.appendChild(reset);

  showMobileTab("chart");
}
