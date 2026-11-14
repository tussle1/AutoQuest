// ==UserScript==
// @name         Discord Quest Manager
// @namespace    https://github.com/tussle1/AutoQuest
// @version      1.0.0
// @description  Discord Quest Manager — discover, prioritize, track and complete quests. Dark configurable overlay UI.
// @author       tussle1
// @match        https://discord.com/*
// @match        https://ptb.discord.com/*
// @match        https://canary.discord.com/*
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23211c2d'/%3E%3Cpath d='M16 6l8 5v10l-8 5-8-5V11z' fill='none' stroke='%23a78bfa' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='3' fill='%23ff4d94'/%3E%3C/svg%3E
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

/*
 * Discord Quest Manager v1.0.0
 * Compatible client modification — read-only quest telemetry + user-initiated
 * actions (enroll / claim). It never reports fake gameplay activity.
 * Full source: https://github.com/tussle1/AutoQuest
 */
(function () {
'use strict';

/* ─────────────────────────────────────────────────────────────
 * src/core.js
 * ───────────────────────────────────────────────────────────── */
/* Core: constants, small utilities, event bus. No dependencies. */

const APP = {
  name: 'Discord Quest Manager',
  short: 'DQM',
  version: '1.0.0',
  storageKey: 'dqm:settings:v1',
  hostId: 'dqm-overlay-host',
  launcherId: 'dqm-launcher',
  apiBase: '/api/v9',
};

/* ── tiny helpers ─────────────────────────────────────────────── */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const firstDefined = (...vl) => vl.find((v) => v !== undefined && v !== null && v !== '');

const noop = () => {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function debounce(fn, ms) {
  let t;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ── colours ──────────────────────────────────────────────────── */

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-f]{3,8}$/i.test(h)) return { r: 167, g: 139, b: 250 };
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const rgbToHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');

/** Mix two hex colours; t=0 → a, t=1 → b. */
function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

const lighten = (hex, t) => mix(hex, '#ffffff', t);
const darken = (hex, t) => mix(hex, '#000000', t);

/** Relative luminance test for picking readable text on a chip. */
function isLight(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

/* ── numbers & time ───────────────────────────────────────────── */

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 905 → "15m 5s" · 5400 → "1h 30m" · 86400 → "1d". */
function fmtDuration(seconds, opts = {}) {
  const s = Math.max(0, Math.round(num(seconds)));
  if (s < 60) return `${s}s`;
  const parts = [];
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m && (!d || parts.length < 2)) parts.push(`${m}m`);
  if (!parts.length) parts.push('0m');
  if (opts.seconds && s < 3600 && !d) {
    const rest = s % 60;
    if (rest) parts.push(`${rest}s`);
  }
  return parts.slice(0, opts.maxParts || 2).join(' ');
}

/** 905 → "15:05" · 5400 → "1:30:00". */
function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(num(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Short relative time from now: "in 3h 12m", "4d left", "expired 2h ago". */
function fmtRelative(ts, now = Date.now()) {
  if (!ts) return 'no deadline';
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  const text =
    abs < 90
      ? `${Math.max(1, Math.round(abs / 60))}m`
      : abs < 5400
        ? `${Math.round(abs / 60)}m`
        : abs < 172800
          ? fmtDuration(abs)
          : fmtDuration(abs, { maxParts: 2 });
  if (diff < 0) return `expired ${text} ago`;
  if (abs < 86400) return `in ${text}`;
  return `${text} left`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/* ── tiny event bus ───────────────────────────────────────────── */

const Bus = {
  _map: new Map(),
  on(event, fn) {
    if (!this._map.has(event)) this._map.set(event, new Set());
    this._map.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    const set = this._map.get(event);
    if (set) set.delete(fn);
  },
  emit(event, payload) {
    const set = this._map.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.warn(`[${APP.short}] listener error on "${event}"`, err);
      }
    }
  },
};

/* ── feature detection ────────────────────────────────────────── */

const ON_DISCORD = /(^|\.)discord\.com$/i.test(location.hostname);

const reducedMotion = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};


/* ─────────────────────────────────────────────────────────────
 * src/config.js
 * ───────────────────────────────────────────────────────────── */
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


/* ─────────────────────────────────────────────────────────────
 * src/api.js
 * ───────────────────────────────────────────────────────────── */
/* API client for Discord's first-party quest endpoints.
 *
 * Auth: uses the session Discord has already established in this tab. The
 * credential is read in-memory at request time, is never logged, never
 * displayed, and never persisted by this script.
 *
 * Only endpoints the official client itself calls are used:
 *   GET  /quests/@me               → quest list + Discord-verified progress
 *   GET  /quests/@me/:id           → single quest detail
 *   POST /quests/:id/enroll        → opt in (same as pressing "Enroll")
 *   POST /quests/:id/claim-reward  → claim (same as pressing "Claim")
 *
 * There is deliberately no endpoint here that writes presence, heartbeats or
 * synthetic gameplay — progress is only ever *read*.
 */

class ApiError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = detail.status ?? 0;
    this.code = detail.code ?? 0;
    this.retryAfter = detail.retryAfter ?? 0;
    this.fatal = !!detail.fatal;
  }
}

const Api = {
  _token: null,
  _tokenAt: 0,
  lastError: null,

  /** Read the tab's existing session credential (transient, memory only). */
  token() {
    const fresh = Date.now() - this._tokenAt < 30_000;
    if (this._token && fresh) return this._token;

    let token = null;
    try {
      let raw = localStorage.getItem('token');
      if (raw) {
        raw = raw.trim().replace(/^"(.*)"$/, '$1');
        if (raw.startsWith('{')) {
          try {
            const parsed = JSON.parse(atob(raw));
            token = parsed && parsed.token ? parsed.token : null;
          } catch {
            token = null;
          }
        } else {
          token = raw;
        }
      }
    } catch {
      token = null;
    }

    this._token = token;
    this._tokenAt = Date.now();
    return token;
  },

  invalidate() {
    this._token = null;
    this._tokenAt = 0;
  },

  async _json(res) {
    try {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  },

  async request(path, { method = 'GET', body, attempt = 0 } = {}) {
    if (!ON_DISCORD) {
      throw new ApiError('Quest API is only reachable from discord.com.', { fatal: true });
    }
    const token = this.token();
    if (!token) {
      throw new ApiError(
        'No Discord session found in this tab. Sign in at discord.com, then reload.',
        { fatal: true, code: 'NO_SESSION' },
      );
    }

    let res;
    try {
      res = await fetch(APP.apiBase + path, {
        method,
        credentials: 'include',
        headers: {
          Authorization: token,
          Accept: '*/*',
          'Content-Type': 'application/json',
          'X-Discord-Locale': navigator.language || 'en-US',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError('Network error talking to Discord. Retrying shortly.', { code: 'NETWORK' });
    }

    if (res.status === 429) {
      const payload = await this._json(res);
      const wait = clamp(num(payload && payload.retry_after, 5), 1, 60);
      if (attempt < 1) {
        await sleep(wait * 1000 + 200);
        return this.request(path, { method, body, attempt: attempt + 1 });
      }
      throw new ApiError(`Rate limited by Discord — pausing for ${Math.ceil(wait)}s.`, {
        status: 429,
        retryAfter: wait,
      });
    }

    if (res.status === 401) {
      this.invalidate();
      throw new ApiError('Discord session expired. Reload the tab to sign back in.', {
        status: 401,
        fatal: true,
      });
    }

    if (res.status === 403) {
      throw new ApiError('Discord denied this action for your account (403).', { status: 403 });
    }

    if (!res.ok) {
      const payload = await this._json(res);
      if (payload && (payload.captcha_key || payload.captcha_service || payload.captcha_sitekey)) {
        throw new ApiError(
          'Discord is asking for a captcha on this action. Open the quest in the Discord app or web client and press Claim there.',
          { status: res.status, code: 'CAPTCHA' },
        );
      }
      const msg =
        (payload && (payload.message || payload.error)) || `Discord returned HTTP ${res.status}.`;
      throw new ApiError(msg, { status: res.status, code: payload && payload.code });
    }

    if (res.status === 204) return null;
    return this._json(res);
  },

  /** Normalised list, tolerant of both `{quests:[…]}` and bare arrays. */
  async listQuests() {
    const payload = await this.request('/quests/@me');
    const list = Array.isArray(payload) ? payload : isObj(payload) ? payload.quests || [] : [];
    const excluded = isObj(payload) && Array.isArray(payload.excluded_quests) ? payload.excluded_quests : [];
    const blockedUntil =
      Date.parse(
        firstDefined(
          isObj(payload) ? payload.quest_enrollment_blocked_until : null,
          isObj(payload) ? payload.questEnrollmentBlockedUntil : null,
          '',
        ) || '',
      ) || 0;
    this.lastError = null;
    return { quests: list.filter(isObj), excluded, enrollBlockedUntil: blockedUntil };
  },

  getQuest(id) {
    return this.request(`/quests/@me/${encodeURIComponent(id)}`);
  },

  /** `sealed` carries Discord's own attribution blobs straight back to the
   *  server — the same values the official client returns untouched. */
  enroll(id, sealed) {
    return this.request(`/quests/${encodeURIComponent(id)}/enroll`, {
      method: 'POST',
      body: {
        location: 11,
        ...(sealed && sealed.traffic ? { traffic_metadata_sealed: sealed.traffic } : {}),
        ...(sealed && sealed.metadata ? { metadata_sealed: sealed.metadata } : {}),
      },
    });
  },

  claim(id, sealed) {
    return this.request(`/quests/${encodeURIComponent(id)}/claim-reward`, {
      method: 'POST',
      body: {
        platform: 0,
        location: 11,
        ...(sealed && sealed.traffic ? { traffic_metadata_sealed: sealed.traffic } : {}),
        ...(sealed && sealed.metadata ? { metadata_sealed: sealed.metadata } : {}),
      },
    });
  },
};

/* Demo backend: lets the UI run (and be reviewed) outside Discord with
 * clearly-marked fixture data. No network, no credentials. */
const DemoApi = {
  _quests: () => DemoQuests.build(),
  async listQuests() {
    await sleep(180);
    return { quests: this._quests(), excluded: [], enrollBlockedUntil: 0 };
  },
  async enroll(id) {
    await sleep(260);
    if (!this._quests().some((x) => x.id === id)) throw new ApiError('Demo quest not found.');
    DemoQuests.enrolled[id] = true;
    return { id };
  },
  async claim(id) {
    await sleep(320);
    DemoQuests.claimed[id] = true;
    DemoQuests.enrolled[id] = true;
    return { id, claimed_at: new Date().toISOString() };
  },
  getQuest(id) {
    return Promise.resolve(this._quests().find((x) => x.id === id) || null);
  },
};


/* ─────────────────────────────────────────────────────────────
 * src/model.js
 * ───────────────────────────────────────────────────────────── */
/* Model: turn raw Discord quest payloads into stable, display-ready objects. */

const QUEST_KINDS = {
  GAME: { key: 'GAME', label: 'Game time', short: 'GAME', glyph: '◈', timed: true },
  STREAM: { key: 'STREAM', label: 'Streaming', short: 'STREAM', glyph: '▷', timed: true },
  VIDEO: { key: 'VIDEO', label: 'Video', short: 'VIDEO', glyph: '▶', timed: true },
  ACTIVITY: { key: 'ACTIVITY', label: 'Activity', short: 'ACTIVE', glyph: '◎', timed: true },
  OTHER: { key: 'OTHER', label: 'Other', short: 'OTHER', glyph: '✦', timed: false },
};

const TYPE_MAP = {
  PLAY_ON_DESKTOP: 'GAME',
  PLAY_ON_DESKTOP_V2: 'GAME',
  PLAY_ON_XBOX: 'GAME',
  PLAY_ON_PLAYSTATION: 'GAME',
  STREAM_ON_DESKTOP: 'STREAM',
  WATCH_VIDEO: 'VIDEO',
  WATCH_VIDEO_ON_MOBILE: 'VIDEO',
  PLAY_ACTIVITY: 'ACTIVITY',
};

const STATE_META = {
  claimed: { label: 'Claimed', tone: 'done', rank: 0 },
  completed: { label: 'Claim reward', tone: 'ready', rank: 1 },
  in_progress: { label: 'In progress', tone: 'live', rank: 2 },
  enrolled: { label: 'Enrolled', tone: 'live', rank: 3 },
  available: { label: 'Not enrolled', tone: 'idle', rank: 4 },
  expired: { label: 'Expired', tone: 'muted', rank: 5 },
  unavailable: { label: 'Unavailable', tone: 'muted', rank: 6 },
};

const SORT_MODES = [
  { id: 'priority', label: 'Priority' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'progress', label: 'Progress' },
  { id: 'reward', label: 'Reward' },
  { id: 'name', label: 'A–Z' },
];

function questKind(taskType) {
  return QUEST_KINDS[TYPE_MAP[String(taskType || '').toUpperCase()] || 'OTHER'];
}

/** Seconds (or count) required by a quest, tolerant of payload shape drift. */
function extractTarget(cfg) {
  const taskType = String(firstDefined(cfg.task_type, cfg.task_config && cfg.task_config.type, '')).toUpperCase();
  const tasks = (cfg.task_config && cfg.task_config.tasks) || {};
  const entry = tasks[taskType] || tasks[Object.keys(tasks)[0]] || {};
  const candidates = [
    entry.target,
    entry.duration,
    cfg.task_config && cfg.task_config.target,
    cfg.task_config && cfg.task_config.duration,
    cfg.target,
  ];
  for (const value of candidates) {
    const n = num(value, NaN);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Discord-reported progress for this quest. Never computed locally. */
function extractProgress(userStatus, appId) {
  if (!isObj(userStatus)) return 0;
  const bag = userStatus.progress;
  if (bag === undefined || bag === null) {
    const direct = num(userStatus.progress_value, 0);
    return direct > 0 ? direct : 0;
  }
  if (typeof bag === 'number') return bag;
  if (Array.isArray(bag)) {
    return bag.reduce((max, entry) => Math.max(max, num(entry && entry.value, 0)), 0);
  }
  if (isObj(bag)) {
    const own = bag[appId] || bag[String(appId)];
    if (own !== undefined) {
      return typeof own === 'number' ? own : num(own && own.value, 0);
    }
    return Object.values(bag).reduce((max, entry) => {
      if (typeof entry === 'number') return Math.max(max, entry);
      return Math.max(max, num(entry && entry.value, 0));
    }, 0);
  }
  return 0;
}

function rewardLabel(cfg) {
  const reward = isObj(cfg.reward) ? cfg.reward : {};
  const msgs = isObj(reward.messages) ? reward.messages : {};
  const alt = isObj(cfg.reward_messages) ? cfg.reward_messages : {};
  const direct = firstDefined(msgs.name, alt.name, alt.reward_name, cfg.reward_name);
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (num(reward.orb_quantity, 0) > 0) return `${num(reward.orb_quantity)} Orbs`;
  return 'Reward';
}

/**
 * Normalise one raw quest.
 * @returns {object} view model — all fields derived, nothing mutated.
 */
function normalizeQuest(raw, now = Date.now()) {
  const cfg = isObj(raw.config) ? raw.config : isObj(raw) ? raw : {};
  const app = isObj(cfg.application) ? cfg.application : isObj(raw.application) ? raw.application : {};
  const msgs = isObj(cfg.messages) ? cfg.messages : {};
  const userStatus = isObj(raw.user_status) ? raw.user_status : {};

  const taskType = String(firstDefined(cfg.task_type, cfg.task_config && cfg.task_config.type, 'OTHER')).toUpperCase();
  const kind = questKind(taskType);
  const target = extractTarget(cfg);
  const progressRaw = extractProgress(userStatus, app.id);
  const progress = target ? clamp(progressRaw, 0, target) : progressRaw;

  const expiresAt = Date.parse(firstDefined(cfg.expires_at, cfg.reward && cfg.reward.expiration_date, '') || '') || 0;
  const startsAt = Date.parse(firstDefined(cfg.starts_at, '') || '') || 0;
  const claimExpiresAt = Date.parse(firstDefined(cfg.reward && cfg.reward.expiration_date, '') || '') || 0;

  const sealed = {
    traffic: firstDefined(raw.traffic_metadata_sealed, cfg.traffic_metadata_sealed, cfg.trafficMetadataSealed) || null,
    metadata: firstDefined(raw.metadata_sealed, cfg.metadata_sealed, cfg.metadataSealed) || null,
  };

  const enrolledAt = Date.parse(userStatus.enrolled_at || '') || 0;
  const completedAt = Date.parse(userStatus.completed_at || '') || 0;
  const claimedAt = Date.parse(userStatus.claimed_at || '') || 0;

  const expired = !!expiresAt && expiresAt <= now;
  let state = 'available';
  if (claimedAt) state = 'claimed';
  else if (completedAt) state = 'completed';
  else if (expired) state = 'expired';
  else if (enrolledAt || progressRaw > 0) state = 'in_progress';
  else if (!cfg.id && !raw.id) state = 'unavailable';

  const meta = STATE_META[state] || STATE_META.unavailable;
  const percent = target > 0 ? clamp((progress / target) * 100, 0, 100) : state === 'completed' || state === 'claimed' ? 100 : 0;
  const remaining = target > 0 ? Math.max(0, target - progress) : 0;

  return {
    id: String(firstDefined(raw.id, cfg.id, '')),
    name: String(firstDefined(msgs.quest_name, msgs.game_title, app.name, 'Untitled quest')),
    game: String(firstDefined(msgs.game_title, app.name, 'Unknown game')),
    publisher: String(firstDefined(msgs.game_publisher, app.publisher && app.publisher.name, '')),
    appId: app.id || 0,
    taskType,
    kind,
    target,
    progress,
    progressRaw,
    percent,
    remaining,
    expiresAt,
    startsAt,
    claimExpiresAt,
    enrolledAt,
    completedAt,
    claimedAt,
    enrolled: !!enrolledAt || !!completedAt || !!claimedAt || progressRaw > 0,
    expired,
    state,
    stateLabel: meta.label,
    tone: meta.tone,
    rank: meta.rank,
    reward: rewardLabel(cfg),
    sealed,
    cta: String(firstDefined(cfg.cta_type, '') || ''),
    upcoming: !!startsAt && startsAt > now,
    needsManualAction: state === 'completed',
    canEnroll: state === 'available' && !expired,
    canClaim: state === 'completed',
    /* how the player is actually expected to finish it */
    howTo: howToText(taskType, app.name || msgs.game_title, target),
    raw,
  };
}

function howToText(taskType, gameName, target) {
  const game = gameName || 'the game';
  const amount = target ? fmtDuration(target) : '';
  switch (String(taskType || '').toUpperCase()) {
    case 'PLAY_ON_DESKTOP':
    case 'PLAY_ON_DESKTOP_V2':
    case 'PLAY_ON_XBOX':
    case 'PLAY_ON_PLAYSTATION':
      return `Launch ${game} and play for ${amount || 'the required time'}. Discord verifies the real running game — the timer starts once the game reports in.`;
    case 'STREAM_ON_DESKTOP':
      return `Go live in a voice channel and stream ${game} for ${amount || 'the required time'}. Discord counts streamed minutes automatically.`;
    case 'WATCH_VIDEO':
      return `Watch the quest video through to the end${amount ? ` (${amount})` : ''}. Progress is credited by Discord's player.`;
    case 'WATCH_VIDEO_ON_MOBILE':
      return `Open this quest on the Discord mobile app and watch the video${amount ? ` (${amount})` : ''} there.`;
    case 'PLAY_ACTIVITY':
      return `Start the ${game} activity from Discord and play for ${amount || 'the required time'}.`;
    default:
      return `Follow the quest's in-client instructions to complete it.`;
  }
}

function statusWeight(quest) {
  if (!quest) return 99;
  if (quest.state === 'completed') return 0;
  if (quest.state === 'in_progress') return 1;
  if (quest.state === 'enrolled') return 2;
  if (quest.state === 'available') return 3;
  if (quest.state === 'expired') return 4;
  if (quest.state === 'claimed') return 5;
  return 6;
}

const KIND_WEIGHT = { GAME: 0, STREAM: 1, VIDEO: 2, ACTIVITY: 3, OTHER: 4 };

/** Lower = act sooner. Game-time quests dominate, then nearest finish line. */
function priorityScore(quest) {
  const kind = KIND_WEIGHT[quest.kind.key] ?? 4;
  const deadline = quest.expiresAt || Number.MAX_SAFE_INTEGER;
  const remaining = quest.target ? quest.remaining : 0;
  const expiringSoon = quest.expiresAt ? (quest.expiresAt - Date.now()) / 3_600_000 < 48 : false;
  return (
    statusWeight(quest) * 100_000 +
    kind * 10_000 +
    (expiringSoon ? -5_000 : 0) +
    Math.min(9_999, remaining / 60)
  );
}

const COMPARATORS = {
  priority: (a, b) => priorityScore(a) - priorityScore(b),
  deadline: (a, b) => (a.expiresAt || Infinity) - (b.expiresAt || Infinity) || COMPARATORS.priority(a, b),
  progress: (a, b) => b.percent - a.percent || COMPARATORS.priority(a, b),
  reward: (a, b) => String(a.reward).localeCompare(String(b.reward)) || COMPARATORS.priority(a, b),
  name: (a, b) => a.name.localeCompare(b.name),
};

function sortQuests(list, mode = 'priority') {
  const cmp = COMPARATORS[mode] || COMPARATORS.priority;
  return list.slice().sort(cmp);
}

/** Summary counts used by the hero banner and stats tab. */
function summarize(quests, now = Date.now()) {
  const byKind = { GAME: 0, STREAM: 0, VIDEO: 0, ACTIVITY: 0, OTHER: 0 };
  const counts = { available: 0, in_progress: 0, completed: 0, claimed: 0, expired: 0, enrolled: 0 };
  let remainingSeconds = 0;
  let tracked = 0;

  for (const q of quests) {
    byKind[q.kind.key] = (byKind[q.kind.key] || 0) + 1;
    if (counts[q.state] !== undefined) counts[q.state] += 1;
    if ((q.state === 'in_progress' || q.state === 'enrolled') && q.target) {
      remainingSeconds += q.remaining;
      tracked += 1;
    }
  }

  const active = counts.available + counts.in_progress + counts.enrolled;
  return {
    total: quests.length,
    active,
    byKind,
    counts,
    remainingSeconds,
    tracked,
    gameSeconds: quests
      .filter((q) => q.kind.key === 'GAME' && (q.state === 'in_progress' || q.state === 'enrolled' || q.state === 'available'))
      .reduce((sum, q) => sum + (q.remaining || q.target || 0), 0),
  };
}


/* ─────────────────────────────────────────────────────────────
 * src/demo.js
 * ───────────────────────────────────────────────────────────── */
/* Demo fixtures — shaped exactly like `GET /quests/@me` so the same normaliser
 * and renderer are exercised without a live session. Used by the design
 * preview page and by Settings → Demo mode. */

const DemoQuests = {
  _tick: 0,
  enrolled: {},   // id -> true, set by DemoApi.enroll
  claimed: {},    // id -> true, set by DemoApi.claim

  build() {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const H = 3_600_000;
    const D = 86_400_000;
    this._tick += 1;
    const drift = this._tick * 7; // makes demo progress advance between polls

    const quest = (o) => ({
      id: o.id,
      config: {
        id: o.id,
        starts_at: iso(now - 2 * D),
        expires_at: iso(now + o.expiresIn),
        application: { id: o.appId, name: o.game },
        task_type: o.taskType,
        task_config: { type: o.taskType, tasks: { [o.taskType]: { target: o.target } }, target: o.target },
        messages: {
          quest_name: o.name,
          game_title: o.game,
          game_publisher: o.publisher || '',
        },
        reward: {
          type: 4,
          messages: { name: o.reward },
          expiration_date: iso(now + o.expiresIn),
        },
        cta_type: o.taskType === 'PLAY_ON_DESKTOP' ? 'PLAY_ON_DESKTOP' : 'VIEW',
      },
      user_status: o.status || this.enrolled[o.id] || this.claimed[o.id]
        ? {
            user_id: '000000000000000000',
            quest_id: o.id,
            enrolled_at:
              o.status !== 'available' || this.enrolled[o.id] || this.claimed[o.id]
                ? iso(now - 1.5 * D)
                : null,
            completed_at:
              o.status === 'completed' || o.status === 'claimed' || this.claimed[o.id]
                ? iso(now - 2 * H)
                : null,
            claimed_at: o.status === 'claimed' || this.claimed[o.id] ? iso(now - 1 * H) : null,
            progress: { [o.appId]: { value: o.progress, updated_at: iso(now - 60_000) } },
          }
        : {},
    });

    return [
      quest({
        id: 'demo-rust',
        name: 'Play Rust for 15 minutes',
        game: 'Rust',
        publisher: 'Facepunch Studios',
        appId: '252490',
        taskType: 'PLAY_ON_DESKTOP',
        target: 900,
        status: 'in_progress',
        progress: Math.min(900, 612 + drift),
        reward: 'In-Game Loot',
        expiresIn: 2 * D + 5 * H,
      }),
      quest({
        id: 'demo-genshin',
        name: 'Play Genshin Impact for 45 minutes',
        game: 'Genshin Impact',
        publisher: 'HoYoverse',
        appId: '2358720',
        taskType: 'PLAY_ON_DESKTOP',
        target: 2700,
        status: 'available',
        progress: 0,
        reward: 'Primogem Bundle',
        expiresIn: 9 * H,
      }),
      quest({
        id: 'demo-minecraft',
        name: 'Play Minecraft for 30 minutes',
        game: 'Minecraft',
        publisher: 'Mojang Studios',
        appId: '356875221078245376',
        taskType: 'PLAY_ON_DESKTOP',
        target: 1800,
        status: 'available',
        progress: 0,
        reward: 'Cosmetic Cape',
        expiresIn: 4 * D,
      }),
      quest({
        id: 'demo-apex-stream',
        name: 'Stream Apex Legends for 60 minutes',
        game: 'Apex Legends',
        publisher: 'Respawn',
        appId: '542361',
        taskType: 'STREAM_ON_DESKTOP',
        target: 3600,
        status: 'in_progress',
        progress: Math.min(3600, 1500 + drift),
        reward: 'Exclusive Badge',
        expiresIn: 1 * D + 3 * H,
      }),
      quest({
        id: 'demo-video',
        name: 'Watch the Wakfu Season 4 trailer',
        game: 'Wakfu',
        publisher: 'Ankama',
        appId: '104900',
        taskType: 'WATCH_VIDEO',
        target: 300,
        status: 'completed',
        progress: 300,
        reward: '30 Days of Nitro',
        expiresIn: 6 * D,
      }),
      quest({
        id: 'demo-valorant',
        name: 'Play VALORANT for 2 hours',
        game: 'VALORANT',
        publisher: 'Riot Games',
        appId: '700136',
        taskType: 'PLAY_ON_DESKTOP',
        target: 7200,
        status: 'available',
        progress: 0,
        reward: 'Player Card',
        expiresIn: 6 * D,
      }),
      quest({
        id: 'demo-activity',
        name: 'Play a Discord Activity for 10 minutes',
        game: 'Discord Activities',
        publisher: 'Discord',
        appId: '1090260130292203520',
        taskType: 'PLAY_ACTIVITY',
        target: 600,
        status: 'in_progress',
        progress: Math.min(600, 240 + drift),
        reward: 'Profile Effect',
        expiresIn: 3 * D,
      }),
      quest({
        id: 'demo-video-2',
        name: 'Watch the Helldivers 2 developer log',
        game: 'Helldivers 2',
        publisher: 'Arrowhead',
        appId: '553850',
        taskType: 'WATCH_VIDEO',
        target: 240,
        status: 'available',
        progress: 0,
        reward: 'Avatar Decoration',
        expiresIn: 2 * D,
      }),
      quest({
        id: 'demo-claimed',
        name: 'Play League of Legends for 30 minutes',
        game: 'League of Legends',
        publisher: 'Riot Games',
        appId: '900789',
        taskType: 'PLAY_ON_DESKTOP',
        target: 1800,
        status: 'claimed',
        progress: 1800,
        reward: 'Mystery Emote',
        expiresIn: 5 * D,
      }),
      quest({
        id: 'demo-expired',
        name: 'Play Fortnite for 20 minutes',
        game: 'Fortnite',
        publisher: 'Epic Games',
        appId: '432980',
        taskType: 'PLAY_ON_DESKTOP',
        target: 1200,
        status: 'available',
        progress: 0,
        reward: 'Wrap',
        expiresIn: -4 * H,
      }),
    ];
  },
};


/* ─────────────────────────────────────────────────────────────
 * src/notify.js
 * ───────────────────────────────────────────────────────────── */
/* Notifier: turns quest state transitions into user-facing alerts.
 * In-app toasts are rendered by the UI (Bus 'notify:toast'); desktop
 * notifications are opt-in and only fire after explicit permission. */

const Notifier = {
  _seen: new Set(),
  _audio: null,

  init() {
    this._seen = new Set(Config.get('seenEvents') || []);

    Bus.on('quest:completed', (quest) => {
      this.push({
        id: `completed:${quest.id}:${quest.completedAt}`,
        tone: 'success',
        title: `${quest.name} — complete`,
        body: 'Discord confirmed this quest. Claim your reward to finish it.',
        questId: quest.id,
        actions: [{ label: 'Claim', act: 'claim', questId: quest.id }],
      });
    });

    Bus.on('quest:claimable', (quest) => {
      this.push({
        id: `claimable:${quest.id}`,
        tone: 'warn',
        title: 'Manual action needed',
        body: `${quest.name} — open Discord to claim before it expires.`,
        questId: quest.id,
        actions: [{ label: 'Claim', act: 'claim', questId: quest.id }],
      });
    });

    Bus.on('quest:progress', (payload) => {
      this.push({
        id: `progress:${payload.quest.id}:${payload.milestone}`,
        tone: 'info',
        title: `Almost there — ${payload.quest.name}`,
        body: `${Math.round(payload.quest.percent)}% complete · ${fmtDuration(payload.quest.remaining, { seconds: true })} to go.`,
        questId: payload.quest.id,
      });
    });

    Bus.on('quest:expiring', (quest) => {
      this.push({
        id: `expiring:${quest.id}`,
        tone: 'warn',
        title: 'Quest deadline close',
        body: `${quest.name} — ${fmtRelative(quest.expiresAt)}.`,
        questId: quest.id,
      });
    });

    Bus.on('quest:new', (quest) => {
      this.push({
        id: `new:${quest.id}`,
        tone: 'info',
        title: 'New quest available',
        body: `${quest.name} · ${quest.kind.label}${quest.target ? ` · ${fmtDuration(quest.target)}` : ''}`,
        questId: quest.id,
      });
    });

    Bus.on('quest:expired', (quest) => {
      this.push({
        id: `expired:${quest.id}`,
        tone: 'muted',
        title: 'Quest expired',
        body: `${quest.name} is no longer available.`,
        questId: quest.id,
      });
    });

    Bus.on('quest:claimed', (quest) => {
      this.push({
        id: `claimed:${quest.id}:${quest.claimedAt}`,
        tone: 'success',
        title: 'Reward claimed',
        body: `${quest.name} · ${quest.reward}`,
        questId: quest.id,
      });
    });
  },

  _remember(id) {
    this._seen.add(id);
    if (this._seen.size > 400) {
      const keep = [...this._seen].slice(-250);
      this._seen = new Set(keep);
    }
    Config.setQuiet('seenEvents', [...this._seen].slice(-250));
  },

  isMuted(questId) {
    return (Config.get('mutedQuestIds') || []).includes(questId);
  },

  push(note) {
    if (!note || !note.id) return;
    if (this._seen.has(note.id)) return;
    if (note.questId && this.isMuted(note.questId)) return;
    this._remember(note.id);
    if (!Config.get('notifications')) return;

    Bus.emit('notify:toast', note);
    Bus.emit('notify:log', {
      tone: note.tone,
      title: note.title,
      body: note.body,
      at: Date.now(),
    });
    if (Config.get('desktopAlerts')) this.desktop(note);
    if (Config.get('sound')) this.beep(note.tone);
  },

  desktop(note) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const n = new Notification(note.title, {
        body: note.body,
        tag: note.id,
        silent: true,
        icon:
          'data:image/svg+xml,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#211c2d"/><path d="M16 6l8 5v10l-8 5-8-5V11z" fill="none" stroke="#a78bfa" stroke-width="2"/><circle cx="16" cy="16" r="3" fill="#ff4d94"/></svg>`,
          ),
      });
      n.onclick = () => {
        try {
          window.focus();
          n.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* notifications unavailable — silently skip */
    }
  },

  async requestPermission() {
    try {
      if (typeof Notification === 'undefined') return 'unsupported';
      if (Notification.permission === 'granted') return 'granted';
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  },

  beep(tone) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this._audio = this._audio || new Ctx();
      const ctx = this._audio;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const freq = tone === 'success' ? 660 : tone === 'warn' ? 440 : 550;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.35, ctx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.24);
    } catch {
      /* audio blocked */
    }
  },
};


/* ─────────────────────────────────────────────────────────────
 * src/styles.js
 * ───────────────────────────────────────────────────────────── */
/* Styles: the whole overlay lives in a shadow root, so this is scoped by
 * construction. Palette + geometry follow the reference design. */

const CSS = `
:host { all: initial; }

.dqm {
  --bg: #1a1622;
  --bg-2: #1f1a2b;
  --bg-3: #251f33;
  --bg-hero: #171221;
  --ink: #f0edf7;
  --ink-2: #c9c3d8;
  --ink-3: #948da8;
  --ink-4: #6f6883;
  --line: #312a41;
  --line-2: #3b3350;
  --track: #3a3350;
  --ok: #45d6a4;
  --warn: #ffb35c;
  --bad: #ff6b8b;
  --blue: #4d93c4;
  --blue-2: #2f6f9c;
  --radius: 14px;
  --accent: #a78bfa;
  --accent-2: #ff4d94;
  --accent-soft: rgba(167,139,250,.16);
  --accent-line: rgba(167,139,250,.38);
  --accent-glow: rgba(167,139,250,.30);
  --accent-deep: #6d4fd0;
  --accent-2-deep: #c9265f;

  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: "gg sans", "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.35;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.dqm *, .dqm *::before, .dqm *::after { box-sizing: border-box; }
.dqm button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; }
.dqm button:disabled { cursor: default; }
.dqm h1, .dqm h2, .dqm h3, .dqm h4, .dqm p { margin: 0; font-weight: inherit; }
.dqm :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

/* ── window shell ─────────────────────────────────────────────── */
.win {
  position: absolute;
  width: 480px;
  max-height: min(92vh, 880px);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid #2c2539;
  border-radius: var(--radius);
  box-shadow:
    0 24px 70px rgba(0,0,0,.62),
    0 2px 0 rgba(255,255,255,.05) inset,
    0 0 0 1px rgba(0,0,0,.4);
  overflow: hidden;
  pointer-events: auto;
  animation: dqm-in .22s cubic-bezier(.2,.9,.3,1);
}
@keyframes dqm-in { from { opacity: 0; transform: translateY(-8px) scale(.985); } }
.dqm[data-minimized="1"] .win { display: none; }

/* ── title bar ───────────────────────────────────────────────── */
.titlebar {
  height: 40px;
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  background: linear-gradient(180deg, #201a2c, #1a1622);
  border-bottom: 1px solid #2a2338;
  cursor: grab;
  user-select: none;
}
.titlebar:active { cursor: grabbing; }
.logo {
  width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center;
  background: radial-gradient(circle at 32% 28%, #cbb8ff, var(--accent) 42%, var(--accent-deep) 100%);
  box-shadow: 0 0 0 1px rgba(255,255,255,.16) inset, 0 2px 8px var(--accent-glow);
  flex: 0 0 auto;
}
.logo svg { width: 13px; height: 13px; display: block; }
.title { font-size: 13.5px; font-weight: 600; letter-spacing: .1px; color: #fff; }
.title em { font-style: normal; font-weight: 500; color: var(--ink-3); font-size: 12px; margin-left: 5px; }
.tb-spacer { flex: 1 1 auto; }
.live-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ink-4); margin-right: 2px;
  transition: background .2s, box-shadow .2s;
}
.dqm[data-running="1"] .live-dot { background: var(--ok); box-shadow: 0 0 8px rgba(69,214,164,.8); animation: dqm-pulse 2s infinite; }
@keyframes dqm-pulse { 50% { opacity: .45; } }
.iconbtn {
  width: 24px; height: 22px; border-radius: 5px;
  display: grid; place-items: center;
  color: var(--ink-3); font-size: 15px; line-height: 1;
  transition: background .15s, color .15s;
}
.iconbtn:hover { background: #2e2740; color: #fff; }
.iconbtn.close:hover { background: #a3344f; color: #fff; }

/* ── hero ─────────────────────────────────────────────────────── */
.hero {
  position: relative;
  height: 150px;
  flex: 0 0 auto;
  overflow: hidden;
  background: var(--bg-hero);
}
.hero-art {
  position: absolute; inset: 0;
  background:
    radial-gradient(90% 120% at 8% -10%, var(--accent-soft) 0%, transparent 58%),
    radial-gradient(85% 120% at 96% 4%, rgba(255,77,148,.30) 0%, transparent 55%),
    radial-gradient(70% 90% at 55% 118%, #2b2049 0%, #141020 72%),
    linear-gradient(140deg, #241b3a 0%, #120f1b 90%);
}
.hero-art::before {
  content: "";
  position: absolute; inset: -30% -10%;
  background-image:
    repeating-linear-gradient(118deg, rgba(255,255,255,.055) 0 1px, transparent 1px 16px),
    repeating-linear-gradient(64deg, rgba(255,255,255,.03) 0 1px, transparent 1px 22px);
  mask-image: radial-gradient(120% 100% at 50% 20%, #000 20%, transparent 78%);
  -webkit-mask-image: radial-gradient(120% 100% at 50% 20%, #000 20%, transparent 78%);
}
.hero-art::after {
  content: "";
  position: absolute;
  width: 250px; height: 250px; right: -60px; top: -110px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 0 0 26px rgba(255,255,255,.035), 0 0 0 54px rgba(255,255,255,.02);
}
.hero-veil {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(20,16,32,.10) 0%, rgba(20,16,32,.35) 46%, rgba(26,22,34,.97) 100%);
}
.hero-inner {
  position: absolute; inset: 0;
  padding: 12px 14px 12px 16px;
  display: flex; flex-direction: column; justify-content: space-between;
}
.hero-top { display: flex; align-items: flex-start; justify-content: space-between; }
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  height: 22px; padding: 0 10px; border-radius: 999px;
  background: rgba(26,22,34,.74);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,.10);
  color: #ece9f5;
  font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase;
}
.pill .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ink-3); }
.pill[data-state="running"] .dot { background: var(--ok); box-shadow: 0 0 7px var(--ok); }
.pill[data-state="paused"] .dot { background: var(--warn); }
.pill[data-state="ready"] .dot { background: var(--accent); box-shadow: 0 0 7px var(--accent-glow); }
.pill[data-state="error"] .dot { background: var(--bad); }
.pill.count {
  align-self: flex-end;
  background: rgba(26,22,34,.72);
  color: #fff; font-size: 12px; letter-spacing: 0; padding: 0 11px;
}
.hero-main {
  display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap;
  font-size: 19px; font-weight: 650; color: #fff;
  letter-spacing: -.2px;
  text-shadow: 0 2px 14px rgba(0,0,0,.55);
}
.hero-main b { font-size: 23px; font-weight: 800; letter-spacing: -.6px; }
.hero-main .sep { color: rgba(255,255,255,.42); font-weight: 400; }
.hero-sub {
  font-size: 11.5px; color: rgba(255,255,255,.66);
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  margin-top: 2px;
  text-shadow: 0 1px 8px rgba(0,0,0,.6);
}
.hero-sub span { display: inline-flex; align-items: center; gap: 4px; }
.hero-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
.hero-foot .pill.count { flex: 0 0 auto; }
.hero-sub i { font-style: normal; color: rgba(255,255,255,.34); }

/* ── deck (sliders + toggles) ─────────────────────────────────── */
.deck {
  flex: 0 0 auto;
  padding: 10px 16px 4px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}
.deck-body { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.deck-head {
  display: flex; align-items: center; gap: 8px;
  padding: 2px 0 4px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-4);
}
.deck-head .chev { margin-left: auto; color: var(--ink-3); font-size: 12px; width: 22px; height: 20px; border-radius: 5px; }
.deck-head .chev:hover { background: #2a2438; color: #fff; }
.deck-body { display: grid; gap: 1px; overflow: hidden; }
.dqm[data-deck="0"] .deck-body { display: none; }

.srow {
  display: grid;
  grid-template-columns: 96px 46px 1fr 20px;
  align-items: center;
  gap: 8px;
  height: 31px;
}
.srow > label { font-size: 13px; color: var(--ink-2); white-space: nowrap; }
.srow > .sval {
  font-size: 12.5px; color: var(--ink-3); text-align: right;
  font-variant-numeric: tabular-nums;
}
.srow > .sreset {
  width: 18px; height: 18px; border-radius: 4px;
  display: grid; place-items: center; color: var(--ink-4); font-size: 12px;
  opacity: .55; transition: opacity .15s, color .15s, background .15s;
}
.srow:hover > .sreset { opacity: 1; }
.srow > .sreset:hover { color: var(--accent); background: #2b2440; }

.dqm input[type="range"] {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 18px; background: transparent; margin: 0; cursor: pointer;
}
.dqm input[type="range"]::-webkit-slider-runnable-track {
  height: 3px; border-radius: 3px;
  background: linear-gradient(90deg, var(--accent) 0 var(--fill, 0%), var(--track) var(--fill, 0%) 100%);
}
.dqm input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px; height: 13px; margin-top: -5px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #d9cfff, var(--accent) 55%, var(--accent-deep));
  box-shadow: 0 0 0 3px rgba(26,22,34,.85), 0 0 10px var(--accent-glow);
  transition: transform .12s;
}
.dqm input[type="range"]:hover::-webkit-slider-thumb { transform: scale(1.12); }
.dqm input[type="range"]::-moz-range-track { height: 3px; border-radius: 3px; background: var(--track); }
.dqm input[type="range"]::-moz-range-progress { height: 3px; border-radius: 3px; background: var(--accent); }
.dqm input[type="range"]::-moz-range-thumb {
  width: 13px; height: 13px; border: 0; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #d9cfff, var(--accent) 60%, var(--accent-deep));
}

.trow {
  display: flex; align-items: center; gap: 10px;
  height: 32px;
}
.trow > .tlabel { font-size: 13px; color: var(--ink-2); }
.trow > .tval { margin-left: auto; font-size: 12px; color: var(--ink-4); font-variant-numeric: tabular-nums; }
.trow > .tlabel + .tval { margin-left: auto; }
.trow > .switch { margin-left: auto; }

.switch { position: relative; width: 36px; height: 20px; flex: 0 0 36px; display: inline-block; }
.switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; z-index: 2; }
.switch .knob {
  position: absolute; inset: 0; border-radius: 999px;
  background: #2c2438;
  border: 1px solid var(--switch-line, var(--accent-line));
  transition: background .18s, border-color .18s, box-shadow .18s;
  overflow: hidden;
}
.switch .knob::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #6b6482;
  transition: transform .18s cubic-bezier(.3,1.4,.5,1), background .18s;
}
.switch input:checked + .knob {
  background: linear-gradient(180deg, var(--accent-2), var(--accent-2-deep));
  border-color: transparent;
  box-shadow: 0 0 12px rgba(255,77,148,.34), 0 1px 0 rgba(255,255,255,.2) inset;
}
.switch input:checked + .knob::after { transform: translateX(16px); background: #fff; }
.switch input:focus-visible + .knob { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── tabs ─────────────────────────────────────────────────────── */
.tabs {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 10px 16px 8px;
  background: var(--bg);
}
.tab { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.tab-label {
  width: 100%; height: 27px;
  display: grid; place-items: center;
  border-radius: 7px;
  font-size: 12.5px; font-weight: 700; color: #f4f1ff;
  background: linear-gradient(180deg, #7f5fd6, #5f42ad);
  box-shadow: 0 1px 0 rgba(255,255,255,.18) inset, 0 2px 6px rgba(0,0,0,.3);
  transition: filter .15s, transform .12s;
}
.tab:hover .tab-label { filter: brightness(1.12); }
.tab:active .tab-label { transform: translateY(1px); }
.tab[aria-selected="true"] .tab-label {
  background: linear-gradient(180deg, var(--accent), var(--accent-deep));
  box-shadow: 0 1px 0 rgba(255,255,255,.25) inset, 0 0 16px var(--accent-glow);
}
.tab-sub { font-size: 9.5px; color: var(--ink-4); letter-spacing: .02em; }
.tab[aria-selected="true"] .tab-sub { color: var(--ink-2); }

/* ── more / filters ───────────────────────────────────────────── */
.morebar {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 8px;
  padding: 2px 16px 6px;
  background: var(--bg);
}
.morebtn {
  display: inline-flex; align-items: center; gap: 6px;
  margin: 0 auto;
  padding: 3px 10px; border-radius: 6px;
  font-size: 11.5px; color: var(--ink-3);
}
.morebtn:hover { color: #fff; background: #251f33; }
.morebtn .tri { font-size: 9px; transition: transform .18s; }
.dqm[data-more="1"] .morebtn .tri { transform: rotate(90deg); }
.hint {
  font-size: 10.5px; color: var(--ink-4);
  white-space: nowrap;
  display: inline-flex; align-items: center; gap: 4px;
}
.hint kbd {
  font: inherit; padding: 1px 4px; border-radius: 3px;
  background: #2b2440; color: var(--ink-3); border: 1px solid #3a3151;
}

.filters {
  display: none;
  flex: 0 0 auto;
  gap: 8px;
  padding: 0 16px 8px;
  background: var(--bg);
}
.dqm[data-more="1"] .filters { display: grid; }
.filters select { min-width: 0; }
.searchwrap { position: relative; }
.searchwrap svg { position: absolute; left: 9px; top: 8px; width: 13px; height: 13px; color: var(--ink-4); }
.dqm input[type="search"], .dqm select {
  height: 29px;
  border-radius: 7px;
  border: 1px solid var(--line-2);
  background: #221c30;
  color: var(--ink);
  font: inherit; font-size: 12.5px;
  padding: 0 9px;
  outline: none;
}
.dqm input[type="search"] { width: 100%; padding-left: 27px; }
.dqm input[type="search"]::placeholder { color: var(--ink-4); }
.dqm input[type="search"]:focus, .dqm select:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
.chiprow { display: flex; gap: 6px; flex-wrap: wrap; }
.chipbtn {
  height: 26px; padding: 0 9px; border-radius: 999px;
  border: 1px solid var(--line-2);
  font-size: 11px; font-weight: 600; color: var(--ink-3);
  display: inline-flex; align-items: center; gap: 5px;
  transition: all .15s;
}
.chipbtn:hover { border-color: var(--accent-line); color: var(--ink); }
.chipbtn[aria-pressed="true"] {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: #fff;
}
.chipbtn .n { font-size: 10px; color: var(--ink-4); font-variant-numeric: tabular-nums; }
.chipbtn[aria-pressed="true"] .n { color: var(--accent); }

/* ── content ──────────────────────────────────────────────────── */
.content {
  flex: 1 1 auto;
  min-height: 130px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px 16px 10px;
  background: var(--bg);
}
.content::-webkit-scrollbar { width: 8px; }
.content::-webkit-scrollbar-thumb { background: #342c46; border-radius: 8px; border: 2px solid var(--bg); }
.content::-webkit-scrollbar-thumb:hover { background: #453a5c; }

.section-note {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 10px; margin: 6px 0 10px;
  border-radius: 8px;
  background: #221c30;
  border: 1px solid var(--line);
  font-size: 11.5px; color: var(--ink-3);
  line-height: 1.45;
}
.section-note b { color: var(--ink-2); }
.section-note.error { border-color: rgba(255,107,139,.34); background: rgba(255,107,139,.08); color: #ffc0cd; }
.section-note.error b { color: #ffdfe6; }
.section-note svg { flex: 0 0 14px; }

/* quest cards */
.qlist { display: grid; gap: 8px; padding-bottom: 4px; }
.quest {
  position: relative;
  border-radius: 10px;
  background: linear-gradient(180deg, #221c30, #1e1829);
  border: 1px solid #2e2740;
  padding: 10px 11px 9px;
  display: grid; gap: 7px;
  transition: border-color .16s, box-shadow .16s, transform .16s;
  animation: dqm-rise .25s ease both;
}
@keyframes dqm-rise { from { opacity: 0; transform: translateY(4px); } }
.quest:hover { border-color: #41365c; box-shadow: 0 6px 20px rgba(0,0,0,.32); }
.quest[data-focus="1"] { border-color: var(--accent-line); box-shadow: 0 0 0 1px var(--accent-soft), 0 6px 22px rgba(0,0,0,.36); }
.quest[data-state="completed"] { border-color: rgba(69,214,164,.34); }
.dqm[data-compact="1"] .quest { padding: 8px 10px 7px; gap: 5px; }
.dqm[data-compact="1"] .quest .q-sub { display: none; }
.dqm[data-compact="1"] .quest .q-name { font-size: 12.5px; }
.quest[data-state="claimed"], .quest[data-state="expired"] { opacity: .62; }
.quest[data-state="expired"] .q-name { text-decoration: line-through; text-decoration-color: rgba(255,255,255,.25); }

.q-row1 { display: flex; align-items: center; gap: 6px; }
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 17px; padding: 0 6px; border-radius: 4px;
  font-size: 9px; font-weight: 800; letter-spacing: .08em;
  background: #2c2440; color: var(--ink-2);
}
.chip[data-kind="GAME"] { background: rgba(167,139,250,.16); color: #c7b6ff; }
.chip[data-kind="STREAM"] { background: rgba(255,77,148,.15); color: #ff9dc0; }
.chip[data-kind="VIDEO"] { background: rgba(77,147,196,.18); color: #8fc6e8; }
.chip[data-kind="ACTIVITY"] { background: rgba(69,214,164,.15); color: #7fe3c0; }
.q-reward {
  font-size: 10.5px; color: var(--ink-3);
  display: inline-flex; align-items: center; gap: 4px;
  max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.q-state {
  margin-left: auto;
  font-size: 9.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
  color: var(--ink-4);
  display: inline-flex; align-items: center; gap: 4px;
}
.q-state::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.q-state[data-tone="live"] { color: var(--accent); }
.q-state[data-tone="ready"] { color: var(--ok); }
.q-state[data-tone="done"] { color: var(--ink-4); }
.q-name { font-size: 13.5px; font-weight: 600; color: #fff; line-height: 1.3; }
.q-sub { font-size: 11px; color: var(--ink-4); display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.q-sub b { color: var(--ink-3); font-weight: 500; }
.q-sub .d { opacity: .5; }

.q-track {
  position: relative; height: 5px; border-radius: 4px;
  background: #322a44; overflow: hidden;
}
.q-fill {
  position: absolute; inset: 0 auto 0 0;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent-deep), var(--accent));
  transition: width .5s cubic-bezier(.3,.9,.3,1);
}
.q-fill[data-tone="ready"] { background: linear-gradient(90deg, #2f9e77, var(--ok)); }
.q-fill[data-tone="done"] { background: linear-gradient(90deg, #4a4359, #6a6183); }
.q-fill[data-tone="expired"] { background: linear-gradient(90deg, #4a3a44, #6b4a55); }
.quest[data-state="in_progress"] .q-fill::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent);
  animation: dqm-sheen 2.4s linear infinite;
}
@keyframes dqm-sheen { from { transform: translateX(-100%); } to { transform: translateX(100%); } }

.q-nums {
  display: flex; align-items: center; gap: 8px;
  font-size: 10.5px; color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}
.q-nums b { color: var(--ink-2); font-weight: 600; }
.q-nums .right { margin-left: auto; }
.q-dl[data-urgent="1"] { color: var(--warn); font-weight: 600; }
.q-dl[data-past="1"] { color: var(--bad); }

.q-acts { display: flex; gap: 6px; align-items: center; }
.pillbtn {
  height: 24px; padding: 0 10px; border-radius: 6px;
  font-size: 11.5px; font-weight: 600; color: var(--ink-2);
  background: #2c2440; border: 1px solid #3a3151;
  display: inline-flex; align-items: center; gap: 5px;
  transition: all .14s;
}
.pillbtn:hover { background: #372d4e; color: #fff; }
.pillbtn.primary {
  background: linear-gradient(180deg, var(--accent), var(--accent-deep));
  border-color: transparent; color: #fff;
  box-shadow: 0 1px 0 rgba(255,255,255,.22) inset;
}
.pillbtn.primary:hover { filter: brightness(1.1); }
.pillbtn.blue { background: linear-gradient(180deg, var(--blue), var(--blue-2)); border-color: transparent; color: #fff; }
.pillbtn.ghost { background: transparent; border-color: transparent; color: var(--ink-4); }
.pillbtn.ghost:hover { color: var(--ink-2); background: #2a2438; }
.pillbtn:disabled { opacity: .45; }
.pillbtn[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-line); color: #fff; }
.q-acts .spacer { flex: 1 1 auto; }
.pillbtn .spin {
  width: 9px; height: 9px; border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,.35); border-top-color: #fff;
  animation: dqm-spin .7s linear infinite;
}
@keyframes dqm-spin { to { transform: rotate(360deg); } }

/* empty state */
.empty {
  display: grid; gap: 8px; place-items: center;
  padding: 34px 16px 40px; text-align: center;
  color: var(--ink-4);
}
.empty .glyph {
  width: 44px; height: 44px; border-radius: 12px;
  display: grid; place-items: center;
  background: #251f33; border: 1px solid var(--line);
  color: var(--ink-3);
}
.empty h4 { font-size: 13px; color: var(--ink-2); font-weight: 600; }
.empty p { font-size: 11.5px; max-width: 280px; line-height: 1.5; }

/* queue */
.qrank {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  align-items: center; gap: 10px;
  padding: 9px 10px;
  border-radius: 9px;
  background: #221c30;
  border: 1px solid #2e2740;
  margin-bottom: 7px;
  transition: border-color .15s;
}
.qrank:hover { border-color: #42375e; }
.qrank .n {
  font-size: 12px; font-weight: 800; color: var(--ink-4);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.qrank[data-first="1"] .n { color: var(--accent); }
.qrank .body { min-width: 0; display: grid; gap: 3px; }
.qrank .nm { font-size: 12.5px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qrank .mt { font-size: 10.5px; color: var(--ink-4); display: flex; gap: 6px; flex-wrap: wrap; }
.qrank .mt .d { opacity: .45; }
.qrank .side { display: grid; gap: 4px; justify-items: end; }
.qrank .right-num { font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.mini-bar { width: 74px; height: 3px; border-radius: 3px; background: #322a44; overflow: hidden; }
.mini-bar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }

/* stats */
.statgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 4px 0 12px; }
.stat {
  background: #221c30; border: 1px solid #2e2740; border-radius: 9px;
  padding: 9px 10px; display: grid; gap: 2px;
}
.stat .v { font-size: 18px; font-weight: 750; color: #fff; font-variant-numeric: tabular-nums; letter-spacing: -.4px; }
.stat .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: .09em; color: var(--ink-4); font-weight: 700; }
.stat[data-tone="ok"] .v { color: var(--ok); }
.stat[data-tone="accent"] .v { color: var(--accent); }

.donutwrap { display: flex; align-items: center; gap: 14px; padding: 4px 2px 12px; }
.donut {
  width: 82px; height: 82px; border-radius: 50%;
  display: grid; place-items: center; flex: 0 0 auto;
  background: conic-gradient(var(--accent) var(--pct, 0%), #322a44 0);
  position: relative;
  box-shadow: 0 0 22px rgba(0,0,0,.35);
}
.donut::after {
  content: ""; position: absolute; inset: 8px; border-radius: 50%;
  background: #1e1829;
}
.donut span {
  position: relative; z-index: 1;
  font-size: 17px; font-weight: 800; color: #fff;
  letter-spacing: -.5px;
}
.donut small { position: relative; z-index: 1; font-size: 9px; color: var(--ink-4); margin-left: 1px; }
.bars { flex: 1 1 auto; display: grid; gap: 6px; }
.barrow { display: grid; grid-template-columns: 54px 1fr 26px; align-items: center; gap: 7px; font-size: 10.5px; color: var(--ink-3); }
.barrow .track { height: 5px; border-radius: 3px; background: #322a44; overflow: hidden; }
.barrow .track i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
.barrow .n { text-align: right; color: var(--ink-4); font-variant-numeric: tabular-nums; }

.log { display: grid; gap: 5px; }
.logrow {
  display: grid; grid-template-columns: 42px 1fr; gap: 8px;
  font-size: 10.5px; color: var(--ink-3);
  padding: 5px 8px; border-radius: 6px;
  background: #221c30;
}
.logrow time { color: var(--ink-4); font-variant-numeric: tabular-nums; }
.logrow[data-tone="success"] time { color: var(--ok); }
.logrow[data-tone="warn"] time { color: var(--warn); }
.h3 {
  display: flex; align-items: center; gap: 8px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink-4); margin: 12px 0 7px;
}
.h3::after { content: ""; flex: 1; height: 1px; background: var(--line); }

/* settings */
.setrow {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 0; border-bottom: 1px solid rgba(49,42,65,.6);
}
.setrow:last-child { border-bottom: 0; }
.setrow .txt { display: grid; gap: 1px; }
.setrow .txt b { font-size: 12.5px; font-weight: 500; color: var(--ink); }
.setrow .txt small { font-size: 10.5px; color: var(--ink-4); }
.setrow .switch { margin-left: auto; }
.swatches { display: flex; gap: 7px; flex-wrap: wrap; padding: 4px 0 2px; }
.swatch {
  width: 30px; height: 30px; border-radius: 8px;
  border: 2px solid transparent;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
  position: relative;
}
.swatch[aria-pressed="true"] { border-color: #fff; }
.swatch[aria-pressed="true"]::after {
  content: "✓"; position: absolute; inset: 0;
  display: grid; place-items: center;
  font-size: 12px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.6);
}
.colorpick { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.colorpick label { font-size: 11.5px; color: var(--ink-3); display: inline-flex; align-items: center; gap: 6px; }
.dqm input[type="color"] {
  width: 26px; height: 22px; padding: 0; border: 1px solid var(--line-2);
  border-radius: 6px; background: #221c30; cursor: pointer;
}
.btnrow { display: flex; gap: 7px; flex-wrap: wrap; padding: 4px 0; }
.ghostbtn {
  height: 27px; padding: 0 11px; border-radius: 7px;
  font-size: 11.5px; font-weight: 600; color: var(--ink-2);
  border: 1px solid var(--line-2); background: #251f33;
  transition: all .14s;
}
.ghostbtn:hover { border-color: var(--accent-line); color: #fff; }
.ghostbtn.danger { color: #ff9bb2; border-color: rgba(255,107,139,.3); }
.ghostbtn.danger:hover { background: rgba(255,107,139,.12); color: #fff; }
.keyrow { display: grid; grid-template-columns: 58px 1fr; gap: 8px; font-size: 11px; color: var(--ink-3); padding: 3px 0; }
.keyrow kbd {
  justify-self: start;
  font: inherit; font-size: 10px; font-weight: 700;
  padding: 2px 6px; border-radius: 4px;
  background: #2b2440; border: 1px solid #3a3151; color: var(--ink-2);
}
.integrity {
  font-size: 10.5px; line-height: 1.5; color: var(--ink-4);
  padding: 8px 10px; border-radius: 8px;
  background: rgba(167,139,250,.06);
  border: 1px solid rgba(167,139,250,.16);
}
.integrity b { color: var(--ink-2); }

/* ── footer actions ──────────────────────────────────────────── */
.actions {
  flex: 0 0 auto;
  display: grid; grid-template-columns: 1fr 1.35fr; gap: 8px;
  padding: 10px 16px 12px;
  background: linear-gradient(180deg, var(--bg) 0%, #171220 100%);
  border-top: 1px solid var(--line);
}
.bigbtn {
  position: relative;
  height: 58px;
  border-radius: 8px;
  display: grid; place-content: center; justify-items: center; gap: 1px;
  font-size: 16px; font-weight: 650; color: #fff;
  letter-spacing: .1px;
  box-shadow: 0 1px 0 rgba(255,255,255,.2) inset, 0 3px 10px rgba(0,0,0,.35);
  transition: filter .15s, transform .12s;
  overflow: hidden;
}
.bigbtn small {
  font-size: 10px; font-weight: 500;
  color: rgba(255,255,255,.66);
  letter-spacing: .02em;
}
.bigbtn:hover { filter: brightness(1.08); }
.bigbtn:active { transform: translateY(1px); }
.bigbtn.stop { background: linear-gradient(180deg, #4f97c9, #2c6d99); }
.bigbtn.go { background: linear-gradient(180deg, #e83f83, #bf1c55); }
.bigbtn.go[data-running="1"] { background: linear-gradient(180deg, #6a5a86, #4a3d63); }
.bigbtn:disabled { filter: grayscale(.5) brightness(.8); }
.bigbtn .sub2 { font-size: 9.5px; color: rgba(255,255,255,.5); }

/* ── toasts ──────────────────────────────────────────────────── */
.toasts {
  position: absolute;
  bottom: 18px; left: 50%; transform: translateX(-50%);
  width: min(440px, calc(100% - 24px));
  display: grid; gap: 7px;
  pointer-events: none;
  z-index: 5;
}
.toast {
  pointer-events: auto;
  display: grid; grid-template-columns: auto 1fr auto; gap: 9px; align-items: start;
  padding: 9px 10px;
  border-radius: 9px;
  background: #2a2338;
  border: 1px solid #3d3354;
  box-shadow: 0 10px 30px rgba(0,0,0,.5);
  animation: dqm-toast-in .22s cubic-bezier(.2,.9,.3,1);
}
@keyframes dqm-toast-in { from { opacity: 0; transform: translateY(10px) scale(.98); } }
.toast[data-tone="success"] { border-color: rgba(69,214,164,.42); }
.toast[data-tone="warn"] { border-color: rgba(255,179,92,.42); }
.toast .ic {
  width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center;
  font-size: 11px; background: rgba(167,139,250,.18); color: var(--accent);
}
.toast[data-tone="success"] .ic { background: rgba(69,214,164,.16); color: var(--ok); }
.toast[data-tone="warn"] .ic { background: rgba(255,179,92,.16); color: var(--warn); }
.toast .tt { font-size: 12px; font-weight: 600; color: #fff; }
.toast .tb { font-size: 11px; color: var(--ink-3); line-height: 1.4; margin-top: 1px; }
.toast .act { display: flex; gap: 5px; margin-top: 6px; }
.toast .act button {
  height: 21px; padding: 0 8px; border-radius: 5px;
  font-size: 10.5px; font-weight: 600;
  background: var(--accent-soft); color: #fff; border: 1px solid var(--accent-line);
}
.toast .act button:hover { background: var(--accent); color: #1a1622; }
.toast .x { color: var(--ink-4); font-size: 13px; padding: 0 2px; }
.toast .x:hover { color: #fff; }

/* ── launcher ────────────────────────────────────────────────── */
.launcher {
  position: absolute; right: 20px; bottom: 20px;
  height: 42px; padding: 0 14px 0 11px;
  border-radius: 999px;
  display: none; align-items: center; gap: 8px;
  background: linear-gradient(180deg, #2b2340, #1d1729);
  border: 1px solid #43375f;
  box-shadow: 0 10px 30px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04) inset;
  color: #fff; font-size: 12px; font-weight: 600;
  pointer-events: auto;
  transition: transform .16s, border-color .16s;
}
.dqm[data-minimized="1"] .launcher { display: inline-flex; }
.launcher:hover { transform: translateY(-1px); border-color: var(--accent-line); }
.launcher .logo { width: 22px; height: 22px; }
.launcher .badge {
  min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px;
  background: var(--accent-2); color: #fff; font-size: 10px; font-weight: 800;
  display: grid; place-items: center;
}

/* ── responsive ──────────────────────────────────────────────── */
@media (max-height: 860px) {
  .hero { height: 132px; }
  .deck-body { max-height: 33vh; }
}
@media (max-height: 740px) {
  .hero { height: 112px; }
  .hero-main { font-size: 17px; }
  .hero-main b { font-size: 20px; }
  .deck-body { max-height: 27vh; }
  .bigbtn { height: 50px; font-size: 15px; }
  .content { min-height: 118px; }
}
@media (max-width: 540px) {
  .win { width: calc(100vw - 16px) !important; left: 8px !important; top: 8px !important; max-height: 94vh; }
  .srow { grid-template-columns: 84px 42px 1fr 18px; }
  .hero { height: 132px; }
}
@media (prefers-reduced-motion: reduce) {
  .dqm *, .dqm *::before, .dqm *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
`;


/* ─────────────────────────────────────────────────────────────
 * src/ui.js
 * ───────────────────────────────────────────────────────────── */
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


/* ─────────────────────────────────────────────────────────────
 * src/app.js
 * ───────────────────────────────────────────────────────────── */
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

})();
