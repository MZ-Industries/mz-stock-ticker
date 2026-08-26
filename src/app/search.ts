import * as api from "./api";
import { SEARCH_DEBOUNCE_MS } from "./constants";
import { els } from "./elements";
import { debugLog, isApiCooldownActive } from "./store";
import { escapeHtml } from "./utils";
import type { SearchResult } from "./types";

export type SearchDeps = {
  onPick: (symbol: string) => void;
};

let results: SearchResult[] = [];
let highlightIndex = -1;
let debounceTimer: number | null = null;
let requestSeq = 0;

function hideResults(): void {
  results = [];
  highlightIndex = -1;
  els.searchResultsEl.classList.add("hidden");
  els.searchResultsEl.innerHTML = "";
}

function renderResults(): void {
  if (results.length === 0) {
    hideResults();
    return;
  }

  els.searchResultsEl.classList.remove("hidden");
  els.searchResultsEl.innerHTML = results.map((result, index) => `
    <button type="button" class="search-result${index === highlightIndex ? " highlighted" : ""}"
      role="option" data-search-symbol="${escapeHtml(result.symbol)}">
      <span class="search-symbol">${escapeHtml(result.symbol)}</span>
      <span class="search-name">${escapeHtml(result.name)}</span>
      <span class="search-exchange">${escapeHtml([result.exchange, result.quote_type].filter(Boolean).join(" · "))}</span>
    </button>
  `).join("");
}

function moveHighlight(delta: number): void {
  if (results.length === 0) {
    return;
  }

  highlightIndex = (highlightIndex + delta + results.length) % results.length;
  renderResults();
}

async function runSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || isApiCooldownActive()) {
    hideResults();
    return;
  }

  const seq = ++requestSeq;
  try {
    const found = await api.searchSymbols(trimmed);
    if (seq !== requestSeq) {
      return; // A newer query is already in flight.
    }

    results = found.slice(0, 8);
    highlightIndex = results.length > 0 ? 0 : -1;
    renderResults();
  } catch (error) {
    debugLog("search:failed", String(error));
    hideResults();
  }
}

export function setupSymbolSearch(deps: SearchDeps): void {
  const input = els.watchlistAddInputEl;

  const pick = (symbol: string): void => {
    hideResults();
    input.value = "";
    deps.onPick(symbol);
  };

  input.addEventListener("input", () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      void runSearch(input.value);
    }, SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === "Escape") {
      hideResults();
    } else if (event.key === "Enter" && highlightIndex >= 0 && results[highlightIndex]) {
      event.preventDefault();
      pick(results[highlightIndex].symbol);
    }
  });

  input.addEventListener("blur", () => {
    // Let a click on a result land before the dropdown disappears.
    window.setTimeout(hideResults, 150);
  });

  els.searchResultsEl.addEventListener("pointerdown", (event) => {
    const row = (event.target as HTMLElement).closest("[data-search-symbol]") as HTMLButtonElement | null;
    if (!row?.dataset.searchSymbol) {
      return;
    }

    event.preventDefault();
    pick(row.dataset.searchSymbol);
  });
}

export function hideSearchResults(): void {
  hideResults();
}
