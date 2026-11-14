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
