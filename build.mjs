/**
 * Build: concatenates src/*.js into a single Tampermonkey userscript.
 * No dependencies — run with `node build.mjs`.
 *
 * Module order matters: later modules may reference earlier ones (they all
 * share one closure at runtime, wrapped in the dist IIFE).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'dist', 'discord-quest-manager.user.js');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Load order = dependency order. */
const MODULES = [
  'src/core.js',
  'src/config.js',
  'src/api.js',
  'src/model.js',
  'src/demo.js',
  'src/notify.js',
  'src/styles.js',
  'src/ui.js',
  'src/app.js',
];

const banner = `// ==UserScript==
// @name         ${pkg.displayName}
// @namespace    https://github.com/tussle1/AutoQuest
// @version      ${pkg.version}
// @description  ${pkg.description}
// @author       ${pkg.author}
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
 * ${pkg.displayName} v${pkg.version}
 * Compatible client modification — read-only quest telemetry + user-initiated
 * actions (enroll / claim). It never reports fake gameplay activity.
 * Full source: https://github.com/tussle1/AutoQuest
 */
`;

const body = MODULES.map((rel) => {
  let src = readFileSync(join(ROOT, rel), 'utf8');
  // Strip a leading `/* ... */` block only if it is our own module banner.
  return `\n/* ─────────────────────────────────────────────────────────────\n * ${rel}\n * ───────────────────────────────────────────────────────────── */\n${src.replace(/[ \t]+$/gm, '')}`;
}).join('\n');

const out = `${banner}(function () {\n'use strict';\n${body}\n})();\n`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log(`built ${OUT} (${kb} kB, ${out.split('\n').length} lines)`);
