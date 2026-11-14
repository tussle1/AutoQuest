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
