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
