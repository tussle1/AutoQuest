/* Store + Actions + bootstrap.
 *
 * The "automation" here is intentionally limited to what Discord itself
 * supports without falsification: enroll, poll, notify, and claim a reward
 * that Discord has already marked complete.
 */

const Store = {
  quests: [],
  excluded: [],
  log: [],
  syncCount: 0,
  focusId: null,
  hydrated: false,
  enrollmentBlockedUntil: 0,

  session: {
    running: false,
    startedAt: 0,
    accumulated: 0,
    lastSync: 0,
    loading: false,
    error: null,
  },

  _timer: null,
  _sum: null,
  _sumFor: null,
  _enrollTries: new Set(),
  _claimTries: new Set(),
  _expiryWarned: new Set(),
  _hidden: false,

  get source() {
    return Config.get('demo') ? DemoApi : Api;
  },

  init() {
    Bus.on('notify:log', (entry) => this.pushLog(entry));

    Bus.on('config:change', ({ key, patch }) => {
      const demoChanged = key === 'demo' || (patch && 'demo' in patch);
      if (demoChanged) {
        this.hardReset();
        return;
      }
      if (key === 'refreshSeconds' && this.session.running) this.schedule(0);
      if (key === 'showExpired' || key === 'showClaimed') UI.render?.();
    });

    document.addEventListener('visibilitychange', () => this.onVisibility());

    if (ON_DISCORD || Config.get('demo')) {
      this.refresh({ silent: true });
    } else {
      this.session.error = 'Open discord.com to load your quests.';
      Bus.emit('data:error', new Error(this.session.error));
    }
  },

  /* ── session clock ─────────────────────────────────────────── */
  elapsedSeconds() {
    const live = this.session.running ? Date.now() - this.session.startedAt : 0;
    return Math.max(0, Math.floor((this.session.accumulated + live) / 1000));
  },

  start() {
    if (this.session.running) {
      this.refresh({ manual: true });
      return;
    }
    this.session.running = true;
    this.session.startedAt = Date.now();
    this.pushLog({ tone: 'info', title: 'Monitoring started', body: `Refresh every ${Config.get('refreshSeconds')}s` });
    Bus.emit('session:change');
    this.refresh({ manual: true });
  },

  pause() {
    if (!this.session.running) return;
    this.session.accumulated += Date.now() - this.session.startedAt;
    this.session.startedAt = 0;
    this.session.running = false;
    this.clearTimer();
    this.pushLog({ tone: 'info', title: 'Monitoring paused' });
    Bus.emit('session:change');
  },

  stop() {
    this.session.running = false;
    this.session.startedAt = 0;
    this.session.accumulated = 0;
    this.clearTimer();
    this.pushLog({ tone: 'info', title: 'Monitoring stopped', body: 'Session timer reset' });
    Bus.emit('session:change');
  },

  hardReset() {
    this.clearTimer();
    this.quests = [];
    this.excluded = [];
    this.hydrated = false;
    this.session.lastSync = 0;
    this.session.error = null;
    this.session.loading = false;
    this.syncCount = 0;
    this._sum = null;
    this._sumFor = null;
    this.enrollmentBlockedUntil = 0;
    this._expiryWarned.clear();
    this._enrollTries.clear();
    this._claimTries.clear();
    this.pushLog({ tone: 'info', title: Config.get('demo') ? 'Demo mode on' : 'Demo mode off' });
    Bus.emit('data:updated');
    if (ON_DISCORD || Config.get('demo')) this.refresh({ silent: true });
  },

  /* ── polling ───────────────────────────────────────────────── */
  clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  },

  schedule(delay) {
    this.clearTimer();
    if (!this.session.running) return;
    if (this._hidden && Config.get('pauseWhenHidden')) return;
    const wait = typeof delay === 'number' ? delay : Config.get('refreshSeconds') * 1000 + Math.random() * 2500;
    this._timer = setTimeout(() => this.refresh(), wait);
  },

  onVisibility() {
    this._hidden = document.visibilityState === 'hidden';
    if (this._hidden) {
      if (Config.get('pauseWhenHidden')) this.clearTimer();
      return;
    }
    if (this.session.running) {
      const stale = Date.now() - this.session.lastSync > Config.get('refreshSeconds') * 1000;
      if (stale) this.refresh();
      else this.schedule();
    }
  },

  async refresh({ manual = false, silent = false } = {}) {
    if (this.session.loading) return;
    if (!ON_DISCORD && !Config.get('demo')) {
      this.session.error = 'Open discord.com to load your quests.';
      Bus.emit('data:updated');
      return;
    }

    this.session.loading = true;
    Bus.emit('data:loading');

    try {
      const { quests, excluded, enrollBlockedUntil } = await this.source.listQuests();
      const normalized = quests.map((q) => normalizeQuest(q)).filter((q) => q.id);
      this.excluded = excluded || [];
      this.enrollmentBlockedUntil = enrollBlockedUntil || 0;
      this.ingest(normalized);
      this.session.lastSync = Date.now();
      this.session.error = null;
      this.syncCount += 1;
    } catch (err) {
      this.session.error = err && err.message ? err.message : 'Unknown sync error.';
      this.pushLog({ tone: 'warn', title: 'Sync failed', body: this.session.error });
      if (err && err.fatal) this.pause();
    } finally {
      this.session.loading = false;
      Bus.emit('data:updated');
      if (this.session.running) this.schedule();
      if (manual && !this.session.error && !this.quests.length) {
        UI.toast({ tone: 'info', title: 'No quests found', body: 'Your account has no eligible quests right now.' });
      }
      this.autoActions();
    }
  },

  /** Diff old vs new and emit transitions once each. */
  ingest(next) {
    const prev = new Map(this.quests.map((q) => [q.id, q]));
    const notify = this.hydrated;
    const lead = Config.get('notifyLeadMinutes');

    for (const q of next) {
      if (!notify) continue;
      const old = prev.get(q.id);

      if (!old) {
        if (q.state !== 'expired') Bus.emit('quest:new', q);
        continue;
      }
      if (!old.completedAt && q.completedAt) Bus.emit('quest:completed', q);
      if (!old.claimedAt && q.claimedAt) Bus.emit('quest:claimed', q);
      if (old.state !== 'expired' && q.state === 'expired') Bus.emit('quest:expired', q);

      const threshold = Config.get('progressAlertPercent');
      if (
        q.state === 'in_progress' &&
        q.percent >= threshold &&
        old.percent < threshold
      ) {
        Bus.emit('quest:progress', { quest: q, milestone: threshold });
      }

      if (lead > 0 && q.expiresAt && !q.completedAt && !this._expiryWarned.has(q.id)) {
        const minutes = (q.expiresAt - Date.now()) / 60_000;
        if (minutes > 0 && minutes <= lead) {
          this._expiryWarned.add(q.id);
          Bus.emit('quest:expiring', q);
        }
      }
    }

    this.quests = next;
    this.hydrated = true;
    this._sumFor = null;

    if (!notify && next.length) {
      this.pushLog({
        tone: 'info',
        title: 'Quest list loaded',
        body: `${next.length} quest${next.length === 1 ? '' : 's'} visible`,
      });
    }
  },

  /* ── automatic (non-falsifying) actions ────────────────────── */
  async autoActions() {
    if (!this.session.lastSync) return;
    if (!ON_DISCORD && !Config.get('demo')) return;

    if (Config.get('autoEnroll') && !(this.enrollmentBlockedUntil > Date.now())) {
      const targets = this.quests
        .filter((q) => q.canEnroll && !this._enrollTries.has(q.id))
        .slice(0, 3);
      for (const q of targets) {
        this._enrollTries.add(q.id);
        try {
          await this.source.enroll(q.id, q.sealed);
          this._enrollTries.delete(q.id);
          this.pushLog({ tone: 'success', title: 'Enrolled', body: q.name });
          await sleep(350);
        } catch (err) {
          this.pushLog({ tone: 'warn', title: 'Enroll failed', body: `${q.name}: ${err.message}` });
        }
      }
      if (targets.length) {
        setTimeout(() => this.refresh({ silent: true }), 900);
      }
    }

    if (Config.get('autoClaim')) {
      const delayMs = Config.get('autoClaimDelaySeconds') * 1000;
      const targets = this.quests.filter(
        (q) =>
          q.canClaim &&
          !this._claimTries.has(q.id) &&
          Date.now() - (q.completedAt || 0) >= delayMs,
      );
      for (const q of targets) {
        this._claimTries.add(q.id);
        try {
          await this.source.claim(q.id, q.sealed);
          this.pushLog({ tone: 'success', title: 'Reward claimed', body: `${q.name} · ${q.reward}` });
          await sleep(350);
        } catch (err) {
          this.pushLog({ tone: 'warn', title: 'Claim failed', body: `${q.name}: ${err.message}` });
        }
      }
      if (targets.length) setTimeout(() => this.refresh({ silent: true }), 900);
    }
  },

  /* ── selectors ─────────────────────────────────────────────── */
  isTracked(id) {
    return (Config.get('trackedIds') || []).includes(id);
  },

  summary() {
    if (this._sumFor !== this.quests) {
      this._sum = summarize(this.quests);
      this._sumFor = this.quests;
    }
    return this._sum;
  },

  pushLog(entry) {
    this.log.unshift({ at: Date.now(), tone: 'info', ...entry });
    if (this.log.length > 60) this.log.length = 60;
  },
};

/* ── user-triggered actions ───────────────────────────────────── */
const Actions = {
  async enroll(id) {
    const quest = Store.quests.find((q) => q.id === id);
    if (!quest) return;
    Bus.emit('action:pending', { id, action: 'enroll' });
    try {
      await Store.source.enroll(id, quest.sealed);
      UI.toast({ tone: 'success', title: 'Enrolled', body: quest.name });
      Store.pushLog({ tone: 'success', title: 'Enrolled', body: quest.name });
      await Store.refresh({ silent: true });
      Store.autoActions();
    } catch (err) {
      UI.toast({ tone: 'warn', title: 'Enroll failed', body: err.message });
      Store.pushLog({ tone: 'warn', title: 'Enroll failed', body: `${quest.name}: ${err.message}` });
    } finally {
      Bus.emit('action:settled', { id, action: 'enroll' });
    }
  },

  async claim(id) {
    const quest = Store.quests.find((q) => q.id === id);
    if (!quest) return;
    Bus.emit('action:pending', { id, action: 'claim' });
    try {
      await Store.source.claim(id, quest.sealed);
      UI.toast({ tone: 'success', title: 'Reward claimed', body: `${quest.name} · ${quest.reward}` });
      Store.pushLog({ tone: 'success', title: 'Reward claimed', body: `${quest.name} · ${quest.reward}` });
      await Store.refresh({ silent: true });
    } catch (err) {
      UI.toast({ tone: 'warn', title: 'Claim failed', body: err.message });
      Store.pushLog({ tone: 'warn', title: 'Claim failed', body: `${quest.name}: ${err.message}` });
    } finally {
      Bus.emit('action:settled', { id, action: 'claim' });
    }
  },

  toggleTrack(id) {
    const tracked = new Set(Config.get('trackedIds') || []);
    if (tracked.has(id)) tracked.delete(id);
    else tracked.add(id);
    Config.set('trackedIds', [...tracked]);
    UI.render();
  },

  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch {
        return false;
      }
    }
  },

  async exportSettings() {
    const json = Config.exportJSON();
    const ok = await this.copy(json);
    if (ok) UI.toast({ tone: 'success', title: 'Settings copied', body: 'Your configuration JSON is on the clipboard.' });
    else window.prompt('Copy your settings JSON:', json);
  },

  importSettings() {
    const input = window.prompt('Paste settings JSON:');
    if (!input) return;
    try {
      const count = Config.importJSON(input);
      UI.toast({ tone: 'success', title: 'Settings imported', body: `${count} key${count === 1 ? '' : 's'} applied.` });
    } catch (err) {
      UI.toast({ tone: 'warn', title: 'Import failed', body: err.message });
    }
  },

  resetAll() {
    if (!window.confirm('Reset every Quest Manager setting, including tracked quests? This cannot be undone.')) return;
    Config.resetAll();
    UI.toast({ tone: 'info', title: 'Settings reset', body: 'Defaults restored.' });
  },
};

/* ── keyboard shortcuts ───────────────────────────────────────── */
function bindShortcuts() {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const el = event.target;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing) {
        if (event.key === 'Escape') el.blur();
        return;
      }
      if (!UI.mounted) return;

      switch (event.key.toLowerCase()) {
        case 'g':
          Store.start();
          break;
        case 'p':
          if (Store.session.running) Store.pause();
          else Store.start();
          break;
        case 'x':
          Store.stop();
          break;
        case 'r':
          Store.refresh({ manual: true });
          UI.render();
          break;
        case 'f':
          Config.set('moreOpen', true);
          UI.root.setAttribute('data-more', '1');
          setTimeout(() => UI.shadow.querySelector('[data-setting="search"]')?.focus(), 40);
          break;
        case 'm': {
          const next = !Config.get('minimized');
          Config.set('minimized', next);
          UI.root.setAttribute('data-minimized', next ? '1' : '0');
          break;
        }
        case 'escape':
          Config.set('minimized', true);
          UI.root.setAttribute('data-minimized', '1');
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    true,
  );
}

/* ── boot ─────────────────────────────────────────────────────── */
function boot() {
  if (document.getElementById(APP.hostId)) return;
  Config.load();
  if (window.__DQM_DEMO__) Config.set('demo', true);

  UI.mount();
  Notifier.init();
  Store.init();
  bindShortcuts();

  setInterval(() => {
    if (UI.mounted && !Config.get('minimized')) UI.tick();
  }, 1000);

  addEventListener('beforeunload', () => Store.clearTimer());

  // Discord is an SPA and occasionally re-renders the document root; keep the
  // overlay attached without ever duplicating it.
  setInterval(() => {
    if (UI.host && !document.getElementById(APP.hostId)) {
      document.documentElement.appendChild(UI.host);
    }
  }, 5000);

  if (Config.get('monitorOnLoad') && (ON_DISCORD || Config.get('demo'))) {
    setTimeout(() => {
      if (!Store.session.running) Store.start();
    }, 1400);
  }

  console.info(`[${APP.short}] ${APP.name} v${APP.version} ready — press G to start monitoring.`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
