/* Config: schema, defaults, persistence (GM storage w/ localStorage fallback). */

const CONFIG_SCHEMA = {
  /* refresh / timing */
  refreshSeconds: { type: 'int', def: 45, min: 15, max: 300 },
  notifyLeadMinutes: { type: 'int', def: 10, min: 0, max: 120 },
  progressAlertPercent: { type: 'int', def: 80, min: 50, max: 100 },
  autoClaimDelaySeconds: { type: 'int', def: 20, min: 0, max: 120 },

  /* behaviour */
  notifications: { type: 'bool', def: true },
  desktopAlerts: { type: 'bool', def: false },
  sound: { type: 'bool', def: false },
  autoEnroll: { type: 'bool', def: true },
  autoClaim: { type: 'bool', def: false },
  showExpired: { type: 'bool', def: false },
  showClaimed: { type: 'bool', def: true },
  compactCards: { type: 'bool', def: false },
  monitorOnLoad: { type: 'bool', def: true },
  pauseWhenHidden: { type: 'bool', def: true },
  demo: { type: 'bool', def: false },

  /* view state */
  activeTab: { type: 'str', def: 'quests' },
  deckOpen: { type: 'bool', def: true },
  moreOpen: { type: 'bool', def: false },
  listMode: { type: 'str', def: 'cards' },
  sortBy: { type: 'str', def: 'priority' },
  filterType: { type: 'str', def: 'all' },
  filterState: { type: 'str', def: 'all' },
  search: { type: 'str', def: '' },
  theme: { type: 'str', def: 'aurora' },
  accent: { type: 'str', def: '#a78bfa' },
  accent2: { type: 'str', def: '#ff4d94' },
  windowPos: { type: 'obj', def: null },
  minimized: { type: 'bool', def: false },

  /* user data */
  trackedIds: { type: 'arr', def: [] },
  mutedQuestIds: { type: 'arr', def: [] },
  hiddenQuestIds: { type: 'arr', def: [] },
  seenEvents: { type: 'arr', def: [] },
};

const THEMES = [
  { id: 'aurora', name: 'Aurora', accent: '#a78bfa', accent2: '#ff4d94' },
  { id: 'ember', name: 'Ember', accent: '#ff8a4c', accent2: '#ff4d6d' },
  { id: 'mint', name: 'Mint', accent: '#4ade9b', accent2: '#38bdf8' },
  { id: 'ice', name: 'Ice', accent: '#60a5fa', accent2: '#a78bfa' },
  { id: 'gold', name: 'Gold', accent: '#f0b429', accent2: '#f97362' },
];

const Config = {
  data: {},
  _store: null,
  _dirty: false,

  /* storage adapter — GM_* when available, else localStorage */
  storage() {
    if (this._store) return this._store;
    const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
    this._store = hasGM
      ? {
          get: (k, d) => {
            try {
              return GM_getValue(k, d);
            } catch {
              return d;
            }
          },
          set: (k, v) => {
            try {
              GM_setValue(k, v);
            } catch {
              /* quota / disabled */
            }
          },
        }
      : {
          get: (k, d) => {
            try {
              const raw = localStorage.getItem(k);
              return raw === null ? d : JSON.parse(raw);
            } catch {
              return d;
            }
          },
          set: (k, v) => {
            try {
              localStorage.setItem(k, JSON.stringify(v));
            } catch {
              /* quota / disabled */
            }
          },
        };
    return this._store;
  },

  defaults() {
    const out = {};
    for (const [key, spec] of Object.entries(CONFIG_SCHEMA)) {
      out[key] = Array.isArray(spec.def) ? [...spec.def] : isObj(spec.def) ? { ...spec.def } : spec.def;
    }
    return out;
  },

  coerce(key, value) {
    const spec = CONFIG_SCHEMA[key];
    if (!spec) return value;
    switch (spec.type) {
      case 'int': {
        const n = Math.round(num(value, spec.def));
        return clamp(n, spec.min ?? n, spec.max ?? n);
      }
      case 'bool':
        return !!value;
      case 'arr':
        return Array.isArray(value) ? value.slice() : [...spec.def];
      case 'obj':
        return isObj(value) ? { ...value } : spec.def;
      default:
        return typeof value === 'string' ? value : String(value ?? '');
    }
  },

  load() {
    const stored = this.storage().get(APP.storageKey, null);
    const merged = this.defaults();
    if (isObj(stored)) {
      for (const key of Object.keys(CONFIG_SCHEMA)) {
        if (stored[key] !== undefined) merged[key] = this.coerce(key, stored[key]);
      }
    }
    this.data = merged;
    return this.data;
  },

  save() {
    if (this._dirty) return;
    this._dirty = true;
    setTimeout(() => {
      this._dirty = false;
      this.storage().set(APP.storageKey, this.data);
    }, 250);
  },

  get(key) {
    return this.data[key];
  },

  set(key, value) {
    const next = this.coerce(key, value);
    if (this.data[key] === next) return next;
    this.data[key] = next;
    this.save();
    Bus.emit('config:change', { key, value: next });
    return next;
  },

  /** Persist without notifying the UI (used for notification bookkeeping). */
  setQuiet(key, value) {
    const next = this.coerce(key, value);
    if (this.data[key] === next) return next;
    this.data[key] = next;
    this.save();
    return next;
  },

  patch(patch = {}) {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (!CONFIG_SCHEMA[key]) continue;
      const next = this.coerce(key, value);
      if (this.data[key] !== next) {
        this.data[key] = next;
        changed = true;
      }
    }
    if (changed) {
      this.save();
      Bus.emit('config:change', { patch });
    }
  },

  resetKey(key) {
    const spec = CONFIG_SCHEMA[key];
    if (!spec) return;
    const def = Array.isArray(spec.def) ? [...spec.def] : isObj(spec.def) ? { ...spec.def } : spec.def;
    this.set(key, def);
  },

  resetAll() {
    this.data = this.defaults();
    this.save();
    Bus.emit('config:change', { all: true });
  },

  applyTheme(themeId) {
    const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
    this.patch({ theme: theme.id, accent: theme.accent, accent2: theme.accent2 });
  },

  /** Everything a user could want to export, minus anything sensitive. */
  exportJSON() {
    return JSON.stringify({ app: APP.name, version: APP.version, settings: this.data }, null, 2);
  },

  importJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('That is not valid JSON.');
    }
    const settings = isObj(parsed) && isObj(parsed.settings) ? parsed.settings : parsed;
    if (!isObj(settings)) throw new Error('No settings object found in that file.');
    const patch = {};
    let count = 0;
    for (const key of Object.keys(CONFIG_SCHEMA)) {
      if (settings[key] !== undefined) {
        patch[key] = this.coerce(key, settings[key]);
        count += 1;
      }
    }
    if (!count) throw new Error('No recognised settings in that file.');
    this.patch(patch);
    return count;
  },
};
