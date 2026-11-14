/* UI: shadow-DOM overlay. Static chrome is built once; content re-renders on
 * state change. All input is delegated, so rebuilt nodes stay wired. */

const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M12 3.2l7.2 4.4v8.8L12 20.8 4.8 16.4V7.6z" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" opacity=".92"/>
  <circle cx="12" cy="12" r="2.6" fill="#fff"/>
</svg>`;

const SLIDERS = [
  { key: 'refreshSeconds', label: 'Refresh', min: 15, max: 300, step: 15, fmt: (v) => `${v}s` },
  { key: 'notifyLeadMinutes', label: 'Notify lead', min: 0, max: 120, step: 5, fmt: (v) => (v ? `${v}m` : 'off') },
  { key: 'progressAlertPercent', label: 'Alert at', min: 50, max: 100, step: 5, fmt: (v) => `${v}%` },
  { key: 'autoClaimDelaySeconds', label: 'Claim delay', min: 0, max: 120, step: 10, fmt: (v) => (v ? `${v}s` : 'now') },
];

const DECK_TOGGLES = [
  { key: 'autoEnroll', label: 'Auto-enroll' },
  { key: 'autoClaim', label: 'Auto-claim' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'desktopAlerts', label: 'Desktop alerts' },
  { key: 'showExpired', label: 'Show expired' },
];

const TABS = [
  { id: 'quests', label: 'Quests', sub: 'Search · Sort' },
  { id: 'queue', label: 'Queue', sub: 'Priority · Mode' },
  { id: 'stats', label: 'Stats', sub: 'Progress · Log' },
  { id: 'settings', label: 'Settings', sub: 'Theme · Data' },
];

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'GAME', label: 'Game' },
  { id: 'STREAM', label: 'Stream' },
  { id: 'VIDEO', label: 'Video' },
  { id: 'ACTIVITY', label: 'Activity' },
];

const SETTINGS_TOGGLES = [
  { key: 'autoEnroll', label: 'Auto-enroll', desc: 'Opt into new quests the moment they appear' },
  { key: 'autoClaim', label: 'Auto-claim rewards', desc: 'Only after Discord confirms completion' },
  { key: 'monitorOnLoad', label: 'Start monitoring on load', desc: 'Begin polling when the client opens' },
  { key: 'pauseWhenHidden', label: 'Pause polling when tab is hidden', desc: 'Saves requests; resumes when you return' },
  { key: 'showClaimed', label: 'Show claimed quests', desc: 'Keep claimed rewards in the list' },
  { key: 'compactCards', label: 'Compact cards', desc: 'Tighter spacing, more quests per screen' },
  { key: 'demo', label: 'Demo mode', desc: 'Sample data — no Discord requests are made' },
];

const UI = {
  host: null,
  shadow: null,
  root: null,
  win: null,
  parts: {},
  mounted: false,
  busy: new Set(),
  _toastSeq: 0,
  _ticks: 0,

  /* ── mount ──────────────────────────────────────────────────── */
  mount() {
    if (this.mounted) return;
    const host = document.createElement('div');
    host.id = APP.hostId;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483000;';
    // Host must not swallow page clicks; interactive children opt back in via .dqm.
    host.style.pointerEvents = 'none';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'dqm';
    root.setAttribute('data-deck', '1');
    root.setAttribute('data-more', '0');
    root.setAttribute('data-running', '0');
    root.setAttribute('data-minimized', '0');
    root.innerHTML = this.template();
    shadow.appendChild(root);
    document.documentElement.appendChild(host);

    this.host = host;
    this.shadow = shadow;
    this.root = root;
    this.win = shadow.querySelector('.win');

    this.cacheParts();
    this.buildDeck();
    this.buildFilters();
    this.bindEvents();
    this.restorePosition();
    this.applyTheme();
    this.syncChrome();
    this.render();
    this.tick();
    this.mounted = true;
  },

  template() {
    return `
      <div class="win" role="dialog" aria-label="Discord Quest Manager">
        <header class="titlebar" data-drag title="Drag to move">
          <span class="logo">${LOGO_SVG}</span>
          <h1 class="title">Quest Manager <em>v${APP.version}</em></h1>
          <span class="tb-spacer"></span>
          <span class="live-dot" title="Monitoring status"></span>
          <button class="iconbtn" data-act="refresh" title="Refresh now (R)" aria-label="Refresh quests">⟳</button>
          <button class="iconbtn" data-act="minimize" title="Minimize (M)" aria-label="Minimize">−</button>
          <button class="iconbtn close" data-act="hide" title="Hide (Esc)" aria-label="Hide">×</button>
        </header>

        <div class="hero">
          <div class="hero-art"></div>
          <div class="hero-veil"></div>
          <div class="hero-inner">
            <div class="hero-top">
              <span class="pill" data-state="idle" data-el="statusPill">
                <span class="dot"></span><span data-el="statusText">Idle</span>
              </span>
            </div>
            <div>
              <div class="hero-main" data-el="heroMain">
                <b>0</b> active <span class="sep">·</span> 0 rewards <span class="sep">·</span> 0:00
              </div>
              <div class="hero-foot">
                <div class="hero-sub" data-el="heroSub"></div>
                <span class="pill count" data-el="countPill">0</span>
              </div>
            </div>
          </div>
        </div>

        <section class="deck">
          <div class="deck-head">
            <span>Timing &amp; controls</span>
            <button class="chev" data-act="deck" aria-label="Toggle controls">▾</button>
          </div>
          <div class="deck-body" data-el="deckBody"></div>
        </section>

        <nav class="tabs" role="tablist" data-el="tabs"></nav>
        <div class="morebar">
          <button class="morebtn" data-act="more">
            <span class="tri">▶</span> More
          </button>
          <span class="hint" data-el="syncHint"></span>
        </div>
        <div class="filters" data-el="filters"></div>
        <section class="content" data-el="content" role="tabpanel"></section>

        <footer class="actions">
          <button class="bigbtn stop" data-act="pause" data-el="pauseBtn">
            Pause<small>P · pause polling</small>
          </button>
          <button class="bigbtn go" data-act="toggle" data-el="toggleBtn">
            Start monitoring<small>G · begin session</small>
          </button>
        </footer>
      </div>
      <button class="launcher" data-act="restore" aria-label="Open Quest Manager">
        <span class="logo">${LOGO_SVG}</span>
        <span>Quests</span>
        <span class="badge" data-el="launcherBadge" hidden>0</span>
      </button>
      <div class="toasts" data-el="toasts" aria-live="polite"></div>
    `;
  },

  cacheParts() {
    const q = (sel) => this.shadow.querySelector(sel);
    this.parts = {
      statusPill: q('[data-el="statusPill"]'),
      statusText: q('[data-el="statusText"]'),
      heroMain: q('[data-el="heroMain"]'),
      heroSub: q('[data-el="heroSub"]'),
      countPill: q('[data-el="countPill"]'),
      deckBody: q('[data-el="deckBody"]'),
      tabs: q('[data-el="tabs"]'),
      filters: q('[data-el="filters"]'),
      content: q('[data-el="content"]'),
      syncHint: q('[data-el="syncHint"]'),
      pauseBtn: q('[data-el="pauseBtn"]'),
      toggleBtn: q('[data-el="toggleBtn"]'),
      toasts: q('[data-el="toasts"]'),
      launcherBadge: q('[data-el="launcherBadge"]'),
    };
  },

  /* ── deck (built once, values synced) ───────────────────────── */
  buildDeck() {
    const sliders = SLIDERS.map(
      (s) => `
      <div class="srow">
        <label for="dqm-${s.key}">${esc(s.label)}</label>
        <span class="sval" data-sval="${s.key}">—</span>
        <input id="dqm-${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}"
               data-slider="${s.key}" aria-label="${esc(s.label)}" />
        <button class="sreset" data-act="reset" data-key="${s.key}" title="Reset to default" aria-label="Reset ${esc(s.label)}">↺</button>
      </div>`,
    ).join('');

    const toggles = DECK_TOGGLES.map(
      (t) => `
      <div class="trow">
        <span class="tlabel">${esc(t.label)}</span>
        <label class="switch">
          <input type="checkbox" data-setting="${t.key}" aria-label="${esc(t.label)}" />
          <span class="knob"></span>
        </label>
      </div>`,
    ).join('');

    this.parts.deckBody.innerHTML = sliders + toggles;
    this.syncDeck();
  },

  syncDeck() {
    for (const s of SLIDERS) {
      const input = this.shadow.querySelector(`[data-slider="${s.key}"]`);
      const val = this.shadow.querySelector(`[data-sval="${s.key}"]`);
      if (!input) continue;
      const v = Config.get(s.key);
      input.value = String(v);
      const pct = ((v - s.min) / (s.max - s.min)) * 100;
      input.style.setProperty('--fill', `${clamp(pct, 0, 100)}%`);
      if (val) val.textContent = s.fmt(v);
    }
    for (const t of DECK_TOGGLES) {
      const input = this.shadow.querySelector(`[data-setting="${t.key}"]`);
      if (input) input.checked = !!Config.get(t.key);
    }
  },

  /* ── filters (built once) ───────────────────────────────────── */
  buildFilters() {
    const chips = TYPE_FILTERS.map(
      (t) => `<button class="chipbtn" data-act="filterType" data-value="${t.id}" aria-pressed="false">
        ${esc(t.label)} <span class="n" data-count="${t.id}">0</span>
      </button>`,
    ).join('');

    this.parts.filters.innerHTML = `
      <div class="searchwrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>
        </svg>
        <input type="search" data-setting="search" placeholder="Search quests, games, rewards…" aria-label="Search quests" />
      </div>
      <div class="chiprow">${chips}</div>
      <div style="display:flex;gap:6px">
        <select data-setting="filterState" aria-label="Filter by status" style="flex:1">
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="needs_action">Needs action</option>
          <option value="in_progress">In progress</option>
          <option value="available">Not enrolled</option>
          <option value="explore">Claimed</option>
        </select>
        <select data-setting="sortBy" aria-label="Sort by" style="flex:1">
          ${SORT_MODES.map((m) => `<option value="${m.id}">Sort: ${esc(m.label)}</option>`).join('')}
        </select>
      </div>`;
    this.syncFilters();
  },

  syncFilters() {
    const search = this.shadow.querySelector('[data-setting="search"]');
    if (search && document.activeElement !== search) search.value = Config.get('search') || '';
    const type = Config.get('filterType');
    for (const chip of this.parts.filters.querySelectorAll('[data-act="filterType"]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.value === type));
    }
    const stateSel = this.shadow.querySelector('[data-setting="filterState"]');
    if (stateSel) stateSel.value = Config.get('filterState');
    const sortSel = this.shadow.querySelector('[data-setting="sortBy"]');
    if (sortSel) sortSel.value = Config.get('sortBy');
  },

  /* ── events ─────────────────────────────────────────────────── */
  bindEvents() {
    this.shadow.addEventListener('click', (event) => this.onClick(event));
    this.shadow.addEventListener('input', (event) => this.onInput(event));
    this.shadow.addEventListener('change', (event) => this.onChange(event));
    this.shadow.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && event.target.tagName === 'INPUT') {
        event.target.blur();
        this.parts.content.focus?.();
      }
    });
    this.bindDrag();

    Bus.on('config:change', () => {
      this.syncDeck();
      this.syncFilters();
      this.applyTheme();
      this.syncChrome();
      this.renderContent();
    });
    Bus.on('data:updated', () => this.render());
    Bus.on('data:error', () => this.render());
    Bus.on('session:change', () => {
      this.syncChrome();
      this.renderActions();
      this.tick();
    });
    Bus.on('notify:toast', (note) => this.toast(note));
    Bus.on('action:pending', ({ id, action }) => {
      this.busy.add(`${id}:${action}`);
      this.renderContent();
    });
    Bus.on('action:settled', ({ id, action }) => {
      this.busy.delete(`${id}:${action}`);
      this.renderContent();
    });
    Bus.on('ui:focusQuest', (id) => {
      Store.focusId = id;
      Config.set('activeTab', 'quests');
      this.render();
      const card = this.shadow.querySelector(`.quest[data-id="${CSS.escape(String(id))}"]`);
      if (card) {
        card.setAttribute('data-focus', '1');
        card.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    });
  },

  bindDrag() {
    const bar = this.shadow.querySelector('[data-drag]');
    let start = null;
    bar.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      if (matchMedia('(max-width: 540px)').matches) return;
      const rect = this.win.getBoundingClientRect();
      start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      bar.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    bar.addEventListener('pointermove', (event) => {
      if (!start) return;
      const w = this.win.offsetWidth;
      const h = this.win.offsetHeight;
      const left = clamp(start.left + (event.clientX - start.x), 8, Math.max(8, innerWidth - w - 8));
      const top = clamp(start.top + (event.clientY - start.y), 8, Math.max(8, innerHeight - Math.min(h, innerHeight) - 8));
      this.win.style.left = `${left}px`;
      this.win.style.top = `${top}px`;
    });
    const end = (event) => {
      if (!start) return;
      start = null;
      try {
        bar.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      Config.set('windowPos', {
        left: Math.round(parseFloat(this.win.style.left) || 0),
        top: Math.round(parseFloat(this.win.style.top) || 0),
      });
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  },

  restorePosition() {
    const pos = Config.get('windowPos');
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      this.win.style.left = `${clamp(pos.left, 8, Math.max(8, innerWidth - 200))}px`;
      this.win.style.top = `${clamp(pos.top, 8, Math.max(8, innerHeight - 120))}px`;
    } else {
      this.win.style.left = `${Math.max(12, innerWidth - 480 - 24)}px`;
      this.win.style.top = '76px';
    }
    if (Config.get('minimized')) this.root.setAttribute('data-minimized', '1');
    addEventListener('resize', () => {
      if (matchMedia('(max-width: 540px)').matches) return;
      const rect = this.win.getBoundingClientRect();
      if (rect.right > innerWidth) this.win.style.left = `${Math.max(8, innerWidth - rect.width - 8)}px`;
      if (rect.bottom > innerHeight) this.win.style.top = `${Math.max(8, innerHeight - rect.height - 8)}px`;
    });
  },

  onInput(event) {
    const slider = event.target.closest('[data-slider]');
    if (slider) {
      const key = slider.dataset.slider;
      const spec = SLIDERS.find((s) => s.key === key);
      Config.set(key, Number(slider.value));
      const val = this.shadow.querySelector(`[data-sval="${key}"]`);
      if (val && spec) val.textContent = spec.fmt(Number(slider.value));
      const pct = ((Number(slider.value) - spec.min) / (spec.max - spec.min)) * 100;
      slider.style.setProperty('--fill', `${clamp(pct, 0, 100)}%`);
      return;
    }
    const search = event.target.closest('[data-setting="search"]');
    if (search) {
      Config.set('search', search.value);
      this.renderContent();
    }
  },

  onChange(event) {
    const field = event.target.closest('[data-setting]');
    if (!field) return;
    const key = field.dataset.setting;
    if (key === 'search') return;
    const isBool = field.type === 'checkbox';
    const value = isBool ? field.checked : field.value;
    if (key === 'desktopAlerts' && value) {
      Notifier.requestPermission().then((state) => {
        if (state === 'denied') {
          this.toast({ tone: 'warn', title: 'Desktop alerts blocked', body: 'Allow notifications for discord.com in your browser settings.' });
          Config.set('desktopAlerts', false);
          this.syncDeck();
        }
      });
    }
    Config.set(key, value);
  },

  onClick(event) {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const id = target.dataset.id;

    switch (act) {
      case 'toggle': {
        const running = Store.session.running;
        if (running) Store.stop();
        else Store.start();
        break;
      }
      case 'pause':
        if (Store.session.running) Store.pause();
        else Store.start();
        break;
      case 'refresh':
        Store.refresh({ manual: true });
        target.animate?.(
          [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }],
          { duration: 520, easing: 'ease-out' },
        );
        break;
      case 'minimize':
        Config.set('minimized', !Config.get('minimized'));
        this.root.setAttribute('data-minimized', Config.get('minimized') ? '1' : '0');
        break;
      case 'hide':
        Config.set('minimized', true);
        this.root.setAttribute('data-minimized', '1');
        break;
      case 'restore':
        Config.set('minimized', false);
        this.root.setAttribute('data-minimized', '0');
        break;
      case 'deck':
        Config.set('deckOpen', !Config.get('deckOpen'));
        this.root.setAttribute('data-deck', Config.get('deckOpen') ? '1' : '0');
        break;
      case 'more':
        Config.set('moreOpen', !Config.get('moreOpen'));
        this.root.setAttribute('data-more', Config.get('moreOpen') ? '1' : '0');
        if (Config.get('moreOpen')) {
          setTimeout(() => this.shadow.querySelector('[data-setting="search"]')?.focus(), 40);
        }
        break;
      case 'tab':
        Config.set('activeTab', target.dataset.tab);
        this.render();
        break;
      case 'reset':
        Config.resetKey(target.dataset.key);
        break;
      case 'filterType':
        Config.set('filterType', target.dataset.value);
        this.renderContent();
        break;
      case 'enroll':
        Actions.enroll(id);
        break;
      case 'claim':
        Actions.claim(id);
        break;
      case 'track':
        Actions.toggleTrack(id);
        break;
      case 'howto':
        this.showHowTo(id);
        break;
      case 'mute': {
        const muted = new Set(Config.get('mutedQuestIds') || []);
        if (muted.has(id)) muted.delete(id);
        else muted.add(id);
        Config.set('mutedQuestIds', [...muted]);
        this.renderContent();
        break;
      }
      case 'theme':
        Config.applyTheme(target.dataset.theme);
        break;
      case 'export':
        Actions.exportSettings();
        break;
      case 'import':
        Actions.importSettings();
        break;
      case 'resetall':
        Actions.resetAll();
        break;
      case 'permission':
        Notifier.requestPermission().then((s) => {
          this.toast({
            tone: s === 'granted' ? 'success' : 'warn',
            title: 'Desktop alerts',
            body: s === 'granted' ? 'Permission granted.' : `Permission ${s}.`,
          });
        });
        break;
      default:
        break;
    }
  },

  /* ── theme ──────────────────────────────────────────────────── */
  applyTheme() {
    const accent = Config.get('accent');
    const accent2 = Config.get('accent2');
    const a = hexToRgb(accent);
    const b = hexToRgb(accent2);
    const set = (k, v) => this.root.style.setProperty(k, v);
    set('--accent', accent);
    set('--accent-2', accent2);
    set('--accent-soft', `rgba(${a.r}, ${a.g}, ${a.b}, .16)`);
    set('--accent-line', `rgba(${a.r}, ${a.g}, ${a.b}, .38)`);
    set('--accent-glow', `rgba(${a.r}, ${a.g}, ${a.b}, .30)`);
    set('--accent-deep', darken(accent, 0.24));
    set('--accent-2-deep', darken(accent2, 0.2));
    set('--switch-line', `rgba(${b.r}, ${b.g}, ${b.b}, .42)`);
    this.root.style.setProperty('--accent-2-soft', `rgba(${b.r}, ${b.g}, ${b.b}, .2)`);
  },

  /* ── chrome sync (hero / tabs / actions) ────────────────────── */
  syncChrome() {
    const session = Store.session;
    const started = session.accumulated > 0 || session.running;
    const state = !Store.session.lastSync && session.error
      ? 'error'
      : session.running
        ? 'running'
        : started && session.lastSync
          ? 'paused'
          : session.lastSync
            ? 'ready'
            : 'idle';
    const label = state === 'error' ? 'Error'
      : state === 'running' ? 'Monitoring'
      : state === 'paused' ? 'Paused'
      : state === 'ready' ? 'Ready'
      : 'Idle';
    this.parts.statusPill.dataset.state = state;
    this.parts.statusText.textContent = label;
    this.root.setAttribute('data-running', session.running ? '1' : '0');
    this.root.setAttribute('data-deck', Config.get('deckOpen') ? '1' : '0');
    this.root.setAttribute('data-more', Config.get('moreOpen') ? '1' : '0');
    this.root.setAttribute('data-compact', Config.get('compactCards') ? '1' : '0');

    this.parts.tabs.innerHTML = TABS.map(
      (t) => `
      <button class="tab" role="tab" data-act="tab" data-tab="${t.id}"
              aria-selected="${Config.get('activeTab') === t.id}">
        <span class="tab-label">${esc(t.label)}</span>
        <span class="tab-sub">${esc(t.sub)}</span>
      </button>`,
    ).join('');

    const hint = this.parts.syncHint;
    if (session.lastSync) {
      hint.innerHTML = `<kbd>R</kbd> refreshed ${fmtRelative(session.lastSync).replace('in ', '')} ago`;
      hint.textContent = `synced ${fmtDuration((Date.now() - session.lastSync) / 1000)} ago`;
    } else {
      hint.textContent = ON_DISCORD || Config.get('demo') ? 'not synced yet' : 'discord only';
    }
    this.renderHero();
    this.renderActions();
  },

  renderHero() {
    const summary = Store.summary();
    const s = Store.session;
    const elapsed = Store.elapsedSeconds();
    const clock = summary.remainingSeconds > 0 ? fmtClock(summary.remainingSeconds) : fmtClock(elapsed);
    this.parts.heroMain.innerHTML =
      `<b>${summary.active}</b> active <span class="sep">·</span> ` +
      `${summary.counts.completed + summary.counts.claimed} done <span class="sep">·</span> ` +
      `<span data-hero-clock>${clock}</span>`;

    const kindBits = [
      [summary.byKind.GAME, 'game'],
      [summary.byKind.STREAM, 'stream'],
      [summary.byKind.VIDEO, 'video'],
      [summary.byKind.ACTIVITY, 'activity'],
    ]
      .filter(([n]) => n > 0)
      .map(([n, label]) => `<span>${n} ${label}</span>`);
    if (!kindBits.length) kindBits.push('<span>no open quests</span>');
    this.parts.heroSub.innerHTML = [
      ...kindBits,
      `<i>·</i><span data-session-clock>session ${fmtClock(elapsed)}</span>`,
    ].join(' ');
    this.parts.countPill.textContent = String(summary.total);
    const badge = this.parts.launcherBadge;
    if (badge) {
      const needs = summary.counts.completed;
      badge.hidden = needs === 0;
      badge.textContent = String(needs);
    }
  },

  renderActions() {
    const running = Store.session.running;
    const pause = this.parts.pauseBtn;
    const toggle = this.parts.toggleBtn;
    pause.innerHTML = running
      ? `Pause<small>P · pause polling</small>`
      : `Resume<small>P · resume polling</small>`;
    pause.disabled = !Store.session.lastSync && !running && !Config.get('demo');
    toggle.innerHTML = running
      ? `Stop monitoring<small>G · end session</small>`
      : `Start monitoring<small>G · begin session</small>`;
    toggle.dataset.running = running ? '1' : '0';
  },

  /* ── filtering ──────────────────────────────────────────────── */
  filteredQuests() {
    const search = String(Config.get('search') || '').trim().toLowerCase();
    const type = Config.get('filterType');
    const stateSel = Config.get('filterState');
    const showExpired = Config.get('showExpired');
    const showClaimed = Config.get('showClaimed');

    const list = Store.quests.filter((q) => {
      if (type !== 'all' && q.kind.key !== type) return false;
      if (stateSel === 'needs_action') {
        if (q.state !== 'completed') return false;
      } else if (stateSel === 'active') {
        if (!['available', 'in_progress', 'enrolled'].includes(q.state)) return false;
      } else if (stateSel === 'explore') {
        if (q.state !== 'claimed') return false;
      } else if (stateSel !== 'all') {
        if (q.state !== stateSel) return false;
      } else {
        if (!showExpired && q.state === 'expired') return false;
        if (!showClaimed && q.state === 'claimed') return false;
      }
      if (search) {
        const hay = `${q.name} ${q.game} ${q.publisher} ${q.reward} ${q.kind.label} ${q.taskType}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    return sortQuests(list, Config.get('sortBy'));
  },

  /* ── render ─────────────────────────────────────────────────── */
  render() {
    if (!this.mounted) return;
    this.syncChrome();
    this.renderContent();
    this.syncFilters();
  },

  renderContent() {
    const tab = Config.get('activeTab');
    const content = this.parts.content;
    if (!content) return;
    const scrollTop = content.scrollTop;

    let html = '';
    const error = Store.session.error;
    if (error) {
      html += `<div class="section-note error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>
        <span><b>Couldn't sync.</b> ${esc(error)}</span>
        <button class="pillbtn ghost" data-act="refresh" style="margin-left:auto">Retry</button>
      </div>`;
    }

    if (Store.enrollmentBlockedUntil > Date.now()) {
      html += `<div class="section-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>
        <span><b>Enrollment paused by Discord.</b> This account can't enroll until
        ${esc(fmtDate(Store.enrollmentBlockedUntil))}. Monitoring and progress tracking continue.</span>
      </div>`;
    }
    if (tab === 'quests') html += this.viewQuests();
    else if (tab === 'queue') html += this.viewQueue();
    else if (tab === 'stats') html += this.viewStats();
    else html += this.viewSettings();

    content.innerHTML = html;
    content.scrollTop = scrollTop;
    this.syncCounts();
    this.renderHero();
  },

  syncCounts() {
    const counts = { all: Store.quests.length, GAME: 0, STREAM: 0, VIDEO: 0, ACTIVITY: 0 };
    for (const q of Store.quests) counts[q.kind.key] = (counts[q.kind.key] || 0) + 1;
    for (const el of this.parts.filters?.querySelectorAll('[data-count]') || []) {
      el.textContent = String(counts[el.dataset.count] ?? 0);
    }
  },

  card(q) {
    const id = esc(q.id);
    const busyEnroll = this.busy.has(`${q.id}:enroll`);
    const busyClaim = this.busy.has(`${q.id}:claim`);
    const tracked = Store.isTracked(q.id);
    const muted = (Config.get('mutedQuestIds') || []).includes(q.id);

    const greet = q.target
      ? `${fmtDuration(q.progress, { seconds: true, maxParts: 2 })} / ${fmtDuration(q.target)}`
      : q.state === 'completed'
        ? 'Requirement met'
        : '—';

    const deadline = q.expiresAt ? fmtRelative(q.expiresAt) : 'no deadline';
    const urgent = q.expiresAt && q.expiresAt - Date.now() < 86_400_000;
    const past = q.expiresAt && q.expiresAt < Date.now();

    let actRow = '';
    if (q.state === 'completed') {
      actRow = `
        <button class="pillbtn primary" data-act="claim" data-id="${id}">
          ${busyClaim ? '<span class="spin"></span>' : ''} Claim reward
        </button>
        <button class="pillbtn ghost" data-act="mute" data-id="${id}">${muted ? 'Unmute' : 'Mute'}</button>`;
    } else if (q.state === 'available') {
      actRow = `
        <button class="pillbtn primary" data-act="enroll" data-id="${id}">
          ${busyEnroll ? '<span class="spin"></span>' : ''} Enroll
        </button>
        <button class="pillbtn" data-act="track" data-id="${id}" aria-pressed="${tracked}">${tracked ? '★ Tracked' : '☆ Track'}</button>`;
    } else if (q.state === 'in_progress' || q.state === 'enrolled') {
      actRow = `
        <button class="pillbtn blue" data-act="track" data-id="${id}" aria-pressed="${tracked}">${tracked ? '★ Tracked' : '☆ Track'}</button>
        <button class="pillbtn ghost" data-act="mute" data-id="${id}">${muted ? 'Unmute' : 'Mute'}</button>`;
    } else if (q.state === 'claimed') {
      actRow = `<span class="pillbtn ghost" aria-disabled="true">✓ Claimed</span>`;
    } else if (q.state === 'expired') {
      actRow = `<span class="pillbtn ghost" aria-disabled="true">Deadline passed</span>`;
    }

    return `
    <article class="quest" data-id="${id}" data-state="${esc(q.state)}">
      <div class="q-row1">
        <span class="chip" data-kind="${esc(q.kind.key)}">${esc(q.kind.glyph)} ${esc(q.kind.short)}</span>
        <span class="q-reward" title="${esc(q.reward)}">🎁 ${esc(q.reward)}</span>
        <span class="q-state" data-tone="${esc(q.tone)}">${esc(q.stateLabel)}</span>
      </div>
      <h4 class="q-name">${esc(q.name)}</h4>
      <div class="q-sub">
        <b>${esc(q.game)}</b>
        ${q.publisher ? `<span class="d">·</span><span>${esc(q.publisher)}</span>` : ''}
        ${q.target ? `<span class="d">·</span><span>${esc(q.kind.label)}</span>` : ''}
      </div>
      <div class="q-track"><div class="q-fill" data-tone="${esc(q.tone)}" style="width:${q.percent.toFixed(1)}%"></div></div>
      <div class="q-nums">
        <span><b>${esc(greet)}</b></span>
        ${
          q.target && (q.state === 'in_progress' || q.state === 'enrolled')
            ? `<span>· ${fmtDuration(q.remaining, { seconds: true })} left</span>`
            : ''
        }
        <span class="right q-dl" data-exp="${q.expiresAt || 0}"
              data-urgent="${urgent && !past ? '1' : '0'}" data-past="${past ? '1' : '0'}">${esc(deadline)}</span>
      </div>
      <div class="q-acts">
        ${actRow}
        <span class="spacer"></span>
        <button class="pillbtn ghost" data-act="howto" data-id="${id}" title="How this quest is verified">How to</button>
      </div>
    </article>`;
  },

  viewQuests() {
    const list = this.filteredQuests();
    if (!Store.quests.length) {
      return this.emptyState(
        Store.session.loading
          ? 'Loading quests…'
          : 'No quests returned',
        Config.get('demo')
          ? 'Demo mode is on with sample data. Turn it off in Settings to use your Discord account.'
          : ON_DISCORD
            ? 'Discord returned no quests for this account. Quests appear when your account is eligible — try Refresh, or check that you are not filtering them out.'
            : 'Open discord.com to load your quests. The preview you are looking at only shows sample data when Demo mode is enabled.',
      );
    }
    if (!list.length) {
      return this.emptyState('Nothing matches those filters', 'Clear the search or switch the status filter back to “All statuses”.');
    }

    const active = list.filter((q) => ['in_progress', 'enrolled', 'available'].includes(q.state));
    const done = list.filter((q) => ['completed', 'claimed', 'expired'].includes(q.state));
    const gameFirst = active.some((q) => q.kind.key === 'GAME');

    let html = '';
    if (gameFirst) {
      html += `<div class="section-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L4.5 13.5H11l-1 8.5L19 10.5h-6.5z"/></svg>
        <span><b>Game-time quests first.</b> They need the longest window — start one now and Discord credits the minutes while you play.</span>
      </div>`;
    }
    html += `<div class="qlist">${list.map((q) => this.card(q)).join('')}</div>`;
    if (done.length && !Config.get('showExpired') && !Config.get('showClaimed')) {
      html += `<div class="section-note" style="margin-top:10px">
        <span>${done.length} finished or expired quest${done.length === 1 ? '' : 's'} hidden. Enable “Show expired” or “Show claimed” in Settings.</span>
      </div>`;
    }
    return html;
  },

  viewQueue() {
    const list = sortQuests(
      Store.quests.filter((q) => ['available', 'in_progress', 'enrolled', 'completed'].includes(q.state)),
      'priority',
    );
    if (!list.length) {
      return this.emptyState('Queue is clear', 'No active quests to prioritise right now. Finished quests stay in the Quests tab.');
    }
    const tracked = new Set(Config.get('trackedIds') || []);
    const ordered = [...list.filter((q) => tracked.has(q.id)), ...list.filter((q) => !tracked.has(q.id))];

    const rows = ordered
      .map((q, i) => {
        const isTracked = tracked.has(q.id);
        return `
        <div class="qrank" data-first="${i === 0 ? '1' : '0'}" data-id="${esc(q.id)}">
          <span class="n">${isTracked ? '★' : i + 1}</span>
          <span class="body">
            <span class="nm">${esc(q.name)}</span>
            <span class="mt">
              <span>${esc(q.kind.short)}</span><span class="d">·</span>
              <span>${q.target ? `${fmtDuration(q.remaining, { seconds: true })} left` : esc(q.stateLabel)}</span><span class="d">·</span>
              <span>${esc(q.expiresAt ? fmtRelative(q.expiresAt) : 'no deadline')}</span>
            </span>
          </span>
          <span class="side">
            <span class="right-num">${Math.round(q.percent)}%</span>
            <span class="mini-bar"><i style="width:${q.percent.toFixed(0)}%"></i></span>
            <button class="pillbtn ghost" data-act="${q.state === 'completed' ? 'claim' : 'track'}" data-id="${esc(q.id)}">
              ${q.state === 'completed' ? 'Claim' : isTracked ? 'Untrack' : 'Track'}
            </button>
          </span>
        </div>`;
      })
      .join('');

    return `
      <div class="section-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M5 8l7-5 7 5"/></svg>
        <span><b>Auto-queue.</b> Game time first, then nearest deadline, then least time remaining. Tracked quests are pinned to the top.</span>
      </div>
      ${rows}`;
  },

  viewStats() {
    const summary = Store.summary();
    const finished = summary.counts.claimed + summary.counts.completed;
    const pct = summary.total ? Math.round((finished / summary.total) * 100) : 0;
    const kinds = [
      ['GAME', 'Game', summary.byKind.GAME],
      ['STREAM', 'Stream', summary.byKind.STREAM],
      ['VIDEO', 'Video', summary.byKind.VIDEO],
      ['ACTIVITY', 'Activity', summary.byKind.ACTIVITY],
    ];
    const maxKind = Math.max(1, ...kinds.map((k) => k[2]));

    const log = Store.log.slice(0, 10);
    const logRows = log.length
      ? log
          .map(
            (entry) => `<div class="logrow" data-tone="${esc(entry.tone || 'info')}">
              <time>${new Date(entry.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
              <span>${esc(entry.title)}${entry.body ? ` — ${esc(entry.body)}` : ''}</span>
            </div>`,
          )
          .join('')
      : `<div class="logrow"><time>—</time><span>No activity yet this session.</span></div>`;

    return `
      <div class="statgrid">
        <div class="stat" data-tone="accent"><span class="v">${summary.total}</span><span class="k">Quests</span></div>
        <div class="stat"><span class="v">${summary.counts.in_progress + summary.counts.enrolled}</span><span class="k">In flight</span></div>
        <div class="stat" data-tone="ok"><span class="v">${summary.counts.completed}</span><span class="k">Claimable</span></div>
      </div>
      <div class="donutwrap">
        <div class="donut" style="--pct:${pct}%"><span>${pct}<small>%</small></span></div>
        <div class="bars">
          ${kinds
            .map(
              ([, label, n]) => `<div class="barrow">
                <span>${esc(label)}</span>
                <span class="track"><i style="width:${((n / maxKind) * 100).toFixed(0)}%"></i></span>
                <span class="n">${n}</span>
              </div>`,
            )
            .join('')}
        </div>
      </div>
      <div class="statgrid">
        <div class="stat"><span class="v">${fmtDuration(summary.remainingSeconds)}</span><span class="k">Time left</span></div>
        <div class="stat"><span class="v">${fmtClock(Store.elapsedSeconds())}</span><span class="k">Session</span></div>
        <div class="stat"><span class="v">${Store.syncCount}</span><span class="k">Syncs</span></div>
      </div>
      <div class="h3">Activity</div>
      <div class="log">${logRows}</div>
      <div class="integrity" style="margin-top:12px">
        <b>Verified progress only.</b> Every number here comes from Discord's own quest state — this tool never
        reports simulated gameplay. If a quest shows 0%, nothing has been credited yet.
      </div>`;
  },

  viewSettings() {
    const themeSwatches = THEMES.map(
      (t) => `<button class="swatch" data-act="theme" data-theme="${t.id}"
        aria-pressed="${Config.get('theme') === t.id}" title="${esc(t.name)}"
        style="background:linear-gradient(135deg, ${t.accent}, ${t.accent2})"></button>`,
    ).join('');

    const rows = SETTINGS_TOGGLES.map(
      (t) => `
      <div class="setrow">
        <span class="txt"><b>${esc(t.label)}</b><small>${esc(t.desc)}</small></span>
        <label class="switch">
          <input type="checkbox" data-setting="${t.key}" ${Config.get(t.key) ? 'checked' : ''} aria-label="${esc(t.label)}" />
          <span class="knob"></span>
        </label>
      </div>`,
    ).join('');

    return `
      <div class="h3">Accent theme</div>
      <div class="swatches">${themeSwatches}</div>
      <div class="colorpick">
        <label>Accent <input type="color" data-setting="accent" value="${esc(Config.get('accent'))}" /></label>
        <label>Secondary <input type="color" data-setting="accent2" value="${esc(Config.get('accent2'))}" /></label>
      </div>

      <div class="h3">Behaviour</div>
      ${rows}
      <div class="btnrow" style="margin-top:8px">
        <button class="ghostbtn" data-act="permission">Test desktop alert</button>
        <button class="ghostbtn" data-act="refresh">Refresh now</button>
      </div>

      <div class="h3">Data</div>
      <div class="btnrow">
        <button class="ghostbtn" data-act="export">Export settings</button>
        <button class="ghostbtn" data-act="import">Import settings</button>
        <button class="ghostbtn danger" data-act="resetall">Reset all</button>
      </div>

      <div class="h3">Shortcuts</div>
      <div class="keyrow"><kbd>G</kbd><span>Start monitoring</span></div>
      <div class="keyrow"><kbd>P</kbd><span>Pause / resume polling</span></div>
      <div class="keyrow"><kbd>X</kbd><span>Stop session</span></div>
      <div class="keyrow"><kbd>R</kbd><span>Refresh quests now</span></div>
      <div class="keyrow"><kbd>F</kbd><span>Focus search</span></div>
      <div class="keyrow"><kbd>M</kbd><span>Minimise / restore</span></div>

      <div class="integrity" style="margin-top:12px">
        <b>How this stays legitimate.</b> The manager reads your quest list with the session this tab already has —
        no password, no token is requested, stored or displayed. Enroll and Claim call the same endpoints as the
        buttons inside Discord, so every reward is confirmed by Discord before it shows as complete.
        It never fakes presence or gameplay.
      </div>
      <div class="integrity" style="margin-top:8px;background:rgba(255,255,255,.02);border-color:var(--line)">
        ${esc(APP.name)} v${esc(APP.version)} · ${ON_DISCORD ? 'live session' : Config.get('demo') ? 'demo mode' : 'not on discord.com'}
      </div>`;
  },

  emptyState(title, body) {
    return `<div class="empty">
      <span class="glyph">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" width="22" height="22">
          <path d="M12 3.5l7 4.3v8.4l-7 4.3-7-4.3V7.8z"/><path d="M9.5 12h5"/>
        </svg>
      </span>
      <h4>${esc(title)}</h4>
      <p>${esc(body)}</p>
    </div>`;
  },

  showHowTo(id) {
    const q = Store.quests.find((x) => x.id === id);
    if (!q) return;
    this.toast({
      tone: 'info',
      title: q.name,
      body: q.howTo,
      timeout: 11_000,
    });
  },

  /* ── toasts ─────────────────────────────────────────────────── */
  toast(note) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.tone = note.tone || 'info';
    const icon = note.tone === 'success' ? '✓' : note.tone === 'warn' ? '!' : '◈';
    const actions = (note.actions || [])
      .map(
        (a) =>
          `<button data-act="${esc(a.act)}" data-id="${esc(a.questId || '')}">${esc(a.label)}</button>`,
      )
      .join('');
    el.innerHTML = `
      <span class="ic">${icon}</span>
      <span>
        <span class="tt">${esc(note.title || '')}</span>
        <span class="tb">${esc(note.body || '')}</span>
        ${actions ? `<span class="act">${actions}</span>` : ''}
      </span>
      <button class="x" data-dismiss="1" aria-label="Dismiss">×</button>`;
    this.parts.toasts.appendChild(el);

    const remove = () => el.remove();
    el.querySelector('[data-dismiss]').addEventListener('click', remove);
    setTimeout(remove, note.timeout || 6500);
    while (this.parts.toasts.children.length > 3) this.parts.toasts.firstElementChild.remove();
  },

  /* ── lightweight clock ──────────────────────────────────────── */
  tick() {
    const sessionClock = this.shadow.querySelector('[data-session-clock]');
    if (sessionClock) sessionClock.textContent = `session ${fmtClock(Store.elapsedSeconds())}`;

    const hint = this.parts.syncHint;
    if (hint && Store.session.lastSync) hint.textContent = `synced ${fmtDuration((Date.now() - Store.session.lastSync) / 1000)} ago`;

    this._ticks += 1;
    if (this._ticks % 10 !== 0) return;
    for (const el of this.shadow.querySelectorAll('[data-exp]')) {
      const ts = Number(el.dataset.exp) || 0;
      if (!ts) continue;
      el.textContent = fmtRelative(ts);
      const past = ts < Date.now();
      el.dataset.past = past ? '1' : '0';
      el.dataset.urgent = !past && ts - Date.now() < 86_400_000 ? '1' : '0';
    }
    const heroClock = this.shadow.querySelector('[data-hero-clock]');
    const summary = Store.summary();
    if (heroClock) heroClock.textContent = fmtClock(summary.remainingSeconds > 0 ? summary.remainingSeconds : Store.elapsedSeconds());
  },
};
