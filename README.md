# Discord Quest Manager

A Tampermonkey userscript that turns Discord's quest system into something you can actually manage: one
dark, configurable overlay that finds your quests, sorts them by what will take longest, tracks Discord's
verified progress, nudges you at the right moments, and claims rewards the moment they're earned.

The interface follows the supplied reference design — deep-violet window, banner hero, slider deck,
gradient tab rail, and the two big control buttons at the bottom. Run `npm run preview` and open
`/demo/` to see it rendered with sample data.

---

## What it does

| | |
|---|---|
| **Discovers quests** | Reads your quest list through the session Discord already has open in the tab. |
| **Explains each one** | Game, publisher, reward, requirement length, deadline, and a plain-language "how this is verified" note. |
| **Sorts by type** | Game time · Streaming · Video · Activity, with game-duration quests promoted to the top. |
| **Prioritises** | Game time first → nearest deadline → least time remaining. Tracked quests pin above the rest. |
| **Tracks progress** | Discord-reported seconds, percentage, remaining time, and a live countdown to expiry. |
| **Automates the boring parts** | Auto-enroll in eligible quests, auto-claim rewards after Discord confirms completion. |
| **Notifies** | Completion, "manual action needed", progress milestones, upcoming deadlines — in-app toasts, optional desktop alerts and sound. |
| **Organises** | Finished and expired quests are separated automatically; filters for status, type, and free-text search. |
| **Stays honest** | A quest is only ever shown as complete when Discord's own payload says it is. |

### What it deliberately does not do

It does not report fake gameplay, spoof presence, inject heartbeats, or otherwise make Discord believe a game
is running. Quest progress is verified server-side against the real game process, so simulated activity is both
against Discord's Terms of Service and ineffective — and it puts the account you actually care about at risk.
The manager automates **enrol → monitor → claim**; you play the game.

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey) in a Chromium or Firefox browser.
2. Open the dashboard → **+** (Create a new script).
3. Replace the template with the contents of [`dist/discord-quest-manager.user.js`](dist/discord-quest-manager.user.js).
4. Save, then open or reload <https://discord.com/channels/@me>.
5. The window appears top-right. Press **G** to start monitoring.

> The script refreshes itself on Discord page reloads. If the panel is closed, click the floating **Quests**
> pill in the bottom-right corner.

---

## Using it

**Start monitoring (G)** begins a session: it polls on your refresh interval, records a session clock, and
starts the auto-actions you've enabled. **Pause (P)** stops polling but keeps your session; **Stop (G again)**
ends it.

Auto-enrol is on by default, so eligible quests are opted into as soon as they appear. Auto-claim is off by
default — turn it on when you're comfortable letting the manager collect rewards for you. It only ever claims
quests Discord has already marked complete.

Each card tells you what the quest actually requires:

- **Game time** — "Launch *Rust* and play for 15m." The timer starts when the real game reports in.
- **Streaming** — go live in a voice channel with the game running.
- **Video** — watch the quest video end to end (mobile-only videos say so).
- **Activity** — start the activity from Discord and play for the required time.

The **How to** button repeats that in the moment, and the **Queue** tab gives you the running order so you can
knock out the long game-time quests first.

### Keyboard

| Key | Action |
|-----|--------|
| `G` | Start / stop monitoring |
| `P` | Pause / resume polling |
| `R` | Refresh quests now |
| `F` | Focus search |
| `M` | Minimise / restore |
| `Esc` | Hide the window |

---

## Settings

Sliders live in the deck under the hero; everything else is in **Settings**.

| Setting | Default | Purpose |
|---|---|---|
| Refresh | `45s` | Poll interval (15s–5m, jittered to stay polite). |
| Notify lead | `10m` | Warn this long before a deadline. |
| Alert at | `80%` | Progress milestone notification. |
| Claim delay | `20s` | Wait before auto-claiming, so you see the notification first. |
| Auto-enroll | on | Opt into new quests automatically. |
| Auto-claim | off | Claim rewards once Discord confirms completion. |
| Notifications / Desktop / Sound | on / off / off | Delivery channels. |
| Show expired / Show claimed | off / on | What stays in the list. |
| Compact cards | off | Denser list. |
| Start on load | on | Begin a session when Discord opens. |
| Pause when hidden | on | Stop polling while the tab is in the background. |
| Demo mode | off | Sample quests, zero requests — used by the preview page. |

Themes: five presets (Aurora, Ember, Mint, Ice, Gold) plus independent accent and secondary colour pickers.
Settings export/import as JSON; **Reset all** restores defaults.

---

## How it talks to Discord

Only first-party endpoints that the official client itself calls:

| Call | Endpoint | Used for |
|---|---|---|
| `GET` | `/api/v9/quests/@me` | Quest list and Discord-verified progress |
| `GET` | `/api/v9/quests/@me/:id` | Single quest detail (available for future views) |
| `POST` | `/api/v9/quests/:id/enroll` | Same action as pressing **Enroll** in Discord |
| `POST` | `/api/v9/quests/:id/claim-reward` | Same action as pressing **Claim** in Discord |

**Nothing about your credentials.** The script never asks for your password or token, never displays one, and
never writes one to storage or the console. It reads the session that the already-signed-in Discord tab holds,
in memory, at the moment a request is made — exactly as Discord's own client does. Close the tab and that
access is gone. Settings storage contains only your preferences and quest IDs.

Newer clients require Discord's own sealed attribution metadata on enroll and claim calls; the script echoes
those values back verbatim from the quest payload rather than generating anything. Enrollment blocks reported
by `/quests/@me` are detected and shown as a banner, with auto-enroll suspended until they lapse.

**Error handling.** Rate limits are respected with backoff and retry (`retry_after`), captcha-gated claims get a
specific message instead of a raw 400, expired sessions surface a single clear message and stop polling,
network failures leave the last known quest list on screen with a retry control, and expired/unavailable quests
are shown as such rather than silently dropped.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No Discord session found" | Sign in at discord.com in this tab, then reload. |
| "Discord returned no quests" | Your account may not be eligible for any current quests. Quests appear in waves; press `R` later. |
| Panel missing | Check the 🐵 Tampermonkey menu shows the script enabled for `discord.com`. A hard reload helps after Discord deploys a big update. |
| Progress stuck at 0% | Discord hasn't credited any time yet. Play the game with the real process running — the number is Discord's, not ours. |
| Enroll/claim fails with 403 | Your account can't perform that action (region, age, or quest eligibility). |
| "Discord is asking for a captcha" | Rewards are sometimes captcha-gated. Claim it in the Discord client's own Quests page; monitoring carries on. |
| "Enrollment paused by Discord" | Discord has temporarily blocked quest enrollment for the account. The banner shows until when; polling continues. |
| Desktop alerts never appear | Allow notifications for `discord.com` in browser site settings, then toggle **Desktop alerts** again. |

---

## Development

No dependencies are needed to build; the layout is a small module set concatenated into one userscript.

```bash
node build.mjs          # src/*.js → dist/discord-quest-manager.user.js
node test/smoke.mjs     # jsdom smoke test (needs `npm i jsdom`)
python3 -m http.server 8080 --bind 0.0.0.0   # then open /demo/
```

```
src/
  core.js     constants, formatting, event bus
  config.js   settings schema, defaults, persistence, themes
  api.js      Discord client (auth-in-memory, retry/backoff) + demo backend
  model.js    quest normalisation, categorisation, priority, summaries
  demo.js     fixtures shaped like real quest payloads
  notify.js   transition → notification pipeline
  styles.js   scoped CSS (shadow root)
  ui.js       chrome, cards, queue, stats, settings, toasts
  app.js      store, scheduler, actions, shortcuts, boot
assets/branding/  Amethyst logo (Aller Bold wordmark + faceted gem) — see its README
demo/         design preview page (demo data)
test/         headless smoke test
```

The overlay lives in a shadow root, so Discord's stylesheet can't leak in and ours can't leak out. Payload
shapes are parsed defensively across the known quest variants (`PLAY_ON_DESKTOP`, `STREAM_ON_DESKTOP`,
`WATCH_VIDEO`, `PLAY_ACTIVITY`, console variants) and degrade to an "Other" card rather than throwing.

## License

MIT.
