export const APP_TEMPLATE = `
  <div id="refresh-progress" class="refresh-progress" aria-hidden="true">
    <div id="refresh-progress-fill" class="refresh-progress-fill"></div>
  </div>
  <div class="app-shell">
    <aside class="watchlist" id="watchlist">
      <div class="watchlist-header">
        <h2>Symbols</h2>
        <form class="watchlist-add-form" id="watchlist-add-form">
          <input id="watchlist-add-input" type="text" maxlength="32" placeholder="Search symbol or name" aria-label="Add symbol" autocomplete="off" spellcheck="false" />
          <button type="submit" class="watchlist-add-button">Add</button>
        </form>
        <div class="search-results hidden" id="search-results" role="listbox"></div>
      </div>
      <div class="watchlist-list" id="watchlist-list"></div>
    </aside>
    <div class="splitter vertical" id="sidebar-splitter" role="separator" aria-orientation="vertical"></div>
    <section class="main-panel">
      <header class="topbar">
        <div>
          <h1 id="title-ticker">AAPL</h1>
          <p class="subtle" id="symbol-subtitle">&nbsp;</p>
        </div>
        <div class="price-headline">
          <p id="headline-price">-</p>
          <p id="headline-change" class="subtle">-</p>
          <div id="extended-strip" class="extended-strip hidden" aria-label="Extended hours pricing"></div>
        </div>
      </header>
      <div class="controls">
        <div class="range-group" id="range-group"></div>
        <div class="interval-group hidden" id="interval-group"></div>
        <div class="ma-group" id="ma-group"></div>
        <div class="type-group" id="type-group"></div>
      </div>
      <div class="chart-stack" id="chart-stack">
        <div class="price-chart" id="price-chart"></div>
        <div class="splitter horizontal" id="volume-splitter" role="separator" aria-orientation="horizontal"></div>
        <div class="volume-chart" id="volume-chart"></div>
      </div>
      <div class="stats-strip" id="stats-strip" aria-label="Key statistics"></div>
      <div class="splitter horizontal" id="news-splitter" role="separator" aria-orientation="horizontal"></div>
      <section class="news-panel">
        <div class="news-header">
          <h2>Business News</h2>
          <span class="subtle">from Yahoo Finance</span>
        </div>
        <div class="news-grid" id="news-grid"></div>
      </section>
    </section>
  </div>
  <section class="provider-toolbar status-line" id="provider-toolbar" aria-label="Data provider status">
    <div class="provider-summary">
      <span id="provider-pill" class="provider-pill">Provider: Yahoo</span>
      <span id="stream-pill" class="provider-pill muted">Live: off</span>
      <span id="lag-pill" class="provider-pill muted">Lag: --</span>
      <span id="market-state-pill" class="provider-pill muted hidden"></span>
    </div>
  </section>
`;
