/* Headless smoke test: loads the built userscript in jsdom against demo data
 * and exercises mount → render → start → enroll → tab switching → settings. */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../dist/discord-quest-manager.user.js', import.meta.url), 'utf8');
const errors = [];

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'https://discord.com/channels/@me',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

const { window } = dom;
window.__DQM_DEMO__ = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, media: '' });
window.CSS = window.CSS || {};
window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve() });
window.Element.prototype.scrollIntoView = () => {};

// Seed settings: auto-enroll off so manual enrollment can be observed on first paint.
window.localStorage.setItem(
  'dqm:settings:v1',
  JSON.stringify({ autoEnroll: false, refreshSeconds: 15, demo: true, monitorOnLoad: false }),
);

window.eval(code);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = [];
const check = (label, cond, extra = '') => {
  if (!cond) fail.push(`${label}${extra ? ` — ${extra}` : ''}`);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` (${extra})` : ''}`);
};

await wait(2200);

const host = window.document.getElementById('dqm-overlay-host');
check('overlay host mounted', !!host);
const shadow = host && host.shadowRoot;
check('shadow root present', !!shadow);

const $ = (sel) => shadow.querySelector(sel);
const $$ = (sel) => [...shadow.querySelectorAll(sel)];

check('titlebar renders', !!$('.titlebar'));
check('hero renders', !!$('.hero'));
check('deck has 4 sliders', $$('[data-slider]').length === 4, `${$$('[data-slider]').length}`);
check('deck has toggles', $$('.deck .switch input').length >= 5);
check('4 tabs', $$('.tab').length === 4);
check('quest cards rendered', $$('.quest').length >= 5, `${$$('.quest').length}`);
check('progress bars have width', $$('.q-fill').every((el) => /%$/.test(el.style.width)));

const heroText = $('[data-el="heroMain"]').textContent.replace(/\s+/g, ' ').trim();
check('hero shows active count', /active/.test(heroText), heroText);
check('status pill not empty', $('[data-el="statusText"]').textContent.trim().length > 0);

// monitorOnLoad is off in the seeded config.
check('idle before start', $('.dqm').getAttribute('data-running') === '0');
check('status pill reads Ready before any session', /ready|idle/i.test($('[data-el="statusText"]').textContent), $('[data-el="statusText"]').textContent);

$('[data-act="toggle"]').click();
await wait(900);
check('start sets running flag', $('.dqm').getAttribute('data-running') === '1');
check('pause button enabled', !$('[data-el="pauseBtn"]').disabled);

// Filters
$('[data-act="more"]').click();
await wait(60);
check('filter panel opens', $('.dqm').getAttribute('data-more') === '1');
const search = $('[data-setting="search"]');
search.value = 'rust';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(60);
check('search narrows list', $$('.quest').length === 1, `${$$('.quest').length} cards`);
search.value = '';
search.dispatchEvent(new window.Event('input', { bubbles: true }));

const availableBefore = $$('.quest').filter((c) => c.getAttribute('data-state') === 'available').length;
check('un-enrolled quests visible with auto-enroll off', availableBefore > 0, `${availableBefore} available`);

const available = $$('.quest').find((c) => c.getAttribute('data-state') === 'available');
check('found un-enrolled quest', !!available);
if (available) {
  const enrollBtn = available.querySelector('[data-act="enroll"]');
  check('enroll button present', !!enrollBtn);
  enrollBtn.click();
  await wait(1800);
  const stillAvailable = $$('.quest').filter((c) => c.getAttribute('data-state') === 'available').length;
  check('enroll transitions exactly one quest', stillAvailable === availableBefore - 1, `${availableBefore} → ${stillAvailable}`);
}

// Auto-enroll: turn it on, force a refresh with the R shortcut.
const enrollSwitch = $('[data-setting="autoEnroll"]');
enrollSwitch.checked = true;
enrollSwitch.dispatchEvent(new window.Event('change', { bubbles: true }));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r', bubbles: true }));
await wait(2200);
const availableAfter = $$('.quest').filter((c) => c.getAttribute('data-state') === 'available').length;
check('auto-enroll consumes available quests', availableAfter < availableBefore, `${availableBefore} → ${availableAfter}`);

// Claim flow
const claimable = $$('.quest').find((c) => c.getAttribute('data-state') === 'completed');
check('claimable quest present', !!claimable);
if (claimable) {
  claimable.querySelector('[data-act="claim"]').click();
  await wait(1500);
  check('claim toast appears', $$('.toast').length > 0, `${$$('.toast').length} toasts`);
}

// Tabs
for (const tab of ['queue', 'stats', 'settings']) {
  const btn = $$('.tab').find((b) => b.dataset.tab === tab);
  btn.click();
  await wait(80);
  const content = $('[data-el="content"]').innerHTML;
  check(`tab "${tab}" renders content`, content.length > 200, `${content.length} chars`);
}
check('settings has theme swatches', $$('.swatch').length === 5);
check('settings has colour inputs', $$('input[type="color"]').length === 2);
check('integrity note present', /never fakes presence/i.test($('[data-el="content"]').textContent));

// Theme change
const before = $('.dqm').style.getPropertyValue('--accent');
$$('.swatch')[1].click();
await wait(60);
const after = $('.dqm').style.getPropertyValue('--accent');
check('accent updates on theme click', before !== after, `${before} → ${after}`);

// Slider
const slider = $('[data-slider="progressAlertPercent"]');
slider.value = '90';
slider.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(400);
check('slider value label updates', $('[data-sval="progressAlertPercent"]').textContent === '90%');
check('settings persisted to storage', (window.localStorage.getItem('dqm:settings:v1') || '').includes('progressAlertPercent'));

// Minimise / restore
$('[data-act="minimize"]').click();
await wait(60);
check('minimise hides window', $('.dqm').getAttribute('data-minimized') === '1');
$('[data-act="restore"]').click();
await wait(60);
check('launcher restores window', $('.dqm').getAttribute('data-minimized') === '0');

// Pause + stop
if ($('.dqm').getAttribute('data-running') !== '1') {
  $('[data-act="toggle"]').click();
  await wait(300);
}
$('[data-act="pause"]').click();
await wait(80);
check('pause stops running flag', $('.dqm').getAttribute('data-running') === '0');
$('[data-act="toggle"]').click(); // stop (was paused → click starts, so force stop)
$('[data-act="toggle"]').click();
await wait(120);
check('stop resets session clock', /session 0:00/.test($('[data-session-clock]').textContent), $('[data-session-clock]').textContent);

// Empty-state path
const stateSel = $('[data-setting="filterState"]');
stateSelect: {
  stateSel.value = 'needs_action';
  stateSel.dispatchEvent(new window.Event('change', { bubbles: true }));
}
await wait(80);
check('needs-action filter works', $$('.quest').length <= 2, `${$$('.quest').length} cards`);

console.log('\n--- console errors ---');
if (errors.length) errors.forEach((e) => console.log(e));
check('no runtime errors', errors.filter((e) => !/Not implemented: HTMLCanvas/.test(e)).length === 0);

console.log('\n--- failures ---');
if (fail.length) {
  fail.forEach((f) => console.log('✗', f));
  process.exit(1);
}
console.log('all checks passed');

process.exit(0);
