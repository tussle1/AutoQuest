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
