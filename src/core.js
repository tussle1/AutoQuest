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
