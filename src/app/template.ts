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
        <div class="chart-type-switch" id="type-group" role="group" aria-label="Chart type"></div>
        <div class="chart-tools">
          <div class="line-picker" id="line-picker">
            <button type="button" class="pill line-toggle" id="line-toggle" aria-haspopup="menu" aria-expanded="false">Lines</button>
            <div class="line-dropdown hidden" id="line-dropdown" role="menu" aria-label="Chart lines">
              <button type="button" class="line-option" role="menuitem" data-line-kind="horizontal"><span class="line-glyph horizontal" aria-hidden="true"></span>Horizontal line</button>
              <button type="button" class="line-option" role="menuitem" data-line-kind="vertical"><span class="line-glyph vertical" aria-hidden="true"></span>Vertical line</button>
              <div class="line-divider" role="separator"></div>
              <button type="button" class="line-option danger" role="menuitem" data-line-clear-all>Clear all lines</button>
            </div>
          </div>
          <div class="study-picker" id="study-picker">
            <button type="button" class="pill study-toggle" id="study-toggle" aria-haspopup="dialog" aria-expanded="false">Studies</button>
            <div class="study-menu hidden" id="study-menu" role="dialog" aria-label="Chart studies">
              <div class="study-menu-header">
                <input id="study-filter" type="text" class="study-filter" placeholder="Filter studies" aria-label="Filter studies" autocomplete="off" spellcheck="false" />
                <button type="button" class="study-clear" data-study-clear>Clear</button>
              </div>
              <div class="study-list" id="study-list" role="group"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="chart-stack" id="chart-stack">
        <div class="price-chart" id="price-chart"></div>
        <div class="splitter horizontal" id="volume-splitter" role="separator" aria-orientation="horizontal"></div>
        <div class="lower-panes" id="lower-panes">
          <div class="volume-chart" id="volume-chart"></div>
        </div>
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
  <div class="line-context-menu hidden" id="line-context-menu" role="menu" aria-label="Line options">
    <div class="line-swatches" id="line-swatches" role="group" aria-label="Line colour"></div>
    <div class="line-divider" role="separator"></div>
    <button type="button" class="line-option danger" role="menuitem" data-line-remove>Clear line</button>
  </div>
  <div class="prefs-overlay hidden" id="prefs-overlay">
    <form class="prefs-panel" id="prefs-form" role="dialog" aria-modal="true" aria-labelledby="prefs-title">
      <header class="prefs-header">
        <h2 id="prefs-title">Settings</h2>
        <button type="button" class="prefs-close" id="prefs-close" aria-label="Close settings">&times;</button>
      </header>
      <div class="prefs-body">
        <label class="prefs-field">
          <span class="prefs-label">Market data endpoint</span>
          <input id="prefs-yahoo-base" type="text" spellcheck="false" autocomplete="off" placeholder="https://query1.finance.yahoo.com" />
          <span class="prefs-hint">Quotes, charts, and sparklines.</span>
        </label>
        <label class="prefs-field">
          <span class="prefs-label">News &amp; search endpoint</span>
          <input id="prefs-yahoo-news-base" type="text" spellcheck="false" autocomplete="off" placeholder="https://query2.finance.yahoo.com" />
          <span class="prefs-hint">Business news and symbol search.</span>
        </label>
        <label class="prefs-field">
          <span class="prefs-label">Volume backfill API key</span>
          <input id="prefs-backfill-key" type="password" spellcheck="false" autocomplete="off" placeholder="Off" />
          <span class="prefs-hint">Optional. Fills in volume for candles Yahoo reports as zero, mostly pre- and post-market.</span>
        </label>
        <label class="prefs-field">
          <span class="prefs-label">Volume backfill endpoint</span>
          <input id="prefs-backfill-base" type="text" spellcheck="false" autocomplete="off" placeholder="https://api.massive.com" />
          <span class="prefs-hint">Any Polygon-compatible aggregates API.</span>
        </label>
        <label class="prefs-field">
          <span class="prefs-label">Live poll interval</span>
          <input id="prefs-poll-ms" type="number" min="1000" step="1000" autocomplete="off" placeholder="Automatic" />
          <span class="prefs-hint">Milliseconds between live updates. Blank follows the session &mdash; 15s in extended hours, 120s outside them.</span>
        </label>
        <label class="prefs-field prefs-field-check">
          <input id="prefs-debug" type="checkbox" />
          <span class="prefs-label">Write backend debug logs to stderr</span>
        </label>
      </div>
      <footer class="prefs-footer">
        <span class="prefs-status" id="prefs-status" role="status"></span>
        <div class="prefs-actions">
          <button type="button" class="prefs-button" id="prefs-cancel">Cancel</button>
          <button type="submit" class="prefs-button primary" id="prefs-save">Save</button>
        </div>
      </footer>
    </form>
  </div>
  <div class="update-overlay hidden" id="update-overlay">
    <div class="update-panel" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <header class="update-header">
        <h2 id="update-title">Software Update</h2>
        <button type="button" class="update-close" id="update-close" aria-label="Close">&times;</button>
      </header>
      <div class="update-body">
        <p class="update-message" id="update-message" role="status"></p>
        <div class="update-progress hidden" id="update-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100">
          <div class="update-progress-fill" id="update-progress-fill"></div>
        </div>
        <div class="update-notes hidden" id="update-notes"></div>
      </div>
      <footer class="update-footer" id="update-footer">
        <button type="button" class="update-button" id="update-dismiss">Close</button>
        <button type="button" class="update-button primary hidden" id="update-action"></button>
      </footer>
    </div>
  </div>
  <section class="provider-toolbar status-line" id="provider-toolbar" aria-label="Data provider status">
    <div class="provider-summary">
      <span id="provider-pill" class="provider-pill">Provider: Yahoo</span>
      <span id="stream-pill" class="provider-pill muted">Live: off</span>
      <span id="lag-pill" class="provider-pill muted">Lag: --</span>
      <span id="market-state-pill" class="provider-pill muted hidden"></span>
      <button id="update-pill" class="provider-pill update-pill hidden" type="button"></button>
    </div>
  </section>
`;
