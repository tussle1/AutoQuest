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
