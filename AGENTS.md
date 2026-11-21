# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** DailyQuest, a gamified task planner for busy MBA students. Users type tasks in plain English, see only today's quests, and earn XP, levels, streaks and real-life rewards for finishing them.
- **Primary user & core workflow:** First-year NYU Stern MBA students checking in on their phones. Full PRD in `docs/index.html`; durable product facts in `PRODUCT.md`.
- **Tech stack:** One static HTML file with plain CSS and JavaScript (no framework, no build step, no packages). Data in the browser's `localStorage`, plus optional accounts (Supabase Auth: email + password) that sync each user's save to a Supabase `saves` table protected by Row Level Security; `supabase-js` loads from jsDelivr (pinned version with an integrity hash) only when accounts are configured. Hosted free on GitHub Pages from the `docs/` folder. External calls from the browser: Nager.Date public holidays API (free, no key), PostHog analytics, Google Fonts. Optional local `server.js` (Node built-ins, no packages) serves the app and calls OpenAI for typing suggestions; the public site has no server and no AI.
- **Live URLs:** Product Page https://building-with-ai-f26.github.io/tyt223-dailytask/ · App https://building-with-ai-f26.github.io/tyt223-dailytask/app/
- **Firm constraint:** free hosting ($0); AI must stay optional, capped, and off on the public site. See `PRODUCT.md`.

### Project structure
| Path | What it is |
| --- | --- |
| `docs/app/index.html` | The whole app: styles, the sample data, the typed-task parser, game logic, `.ics` import, holiday import, rendering and PostHog events, in that order inside one `<script>` |
| `docs/app/manifest.webmanifest`, `docs/app/sw.js`, `docs/app/icons/` | Home-screen app: name, colors and icons (drawn from the Sprout mascot), and a service worker that caches the app's files for offline use. The page is fetched network-first, so pushes show up whenever there's a connection; Supabase, PostHog, the holidays API and `/api/` are never cached |
| `server.js` | Optional local server: serves `docs/`, keeps the OpenAI key from `.env`, exposes `/api/health` and `/api/suggest`, enforces a per-minute and daily cap (`AI_DAILY_LIMIT`), never logs typed text |
| `.env.example` | Names of the variables `server.js` reads (`OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_DAILY_LIMIT`), plus the reminder key names (`VAPID_*`, which go into Supabase secrets, not the app); copy to the git-ignored `.env` |
| `supabase/functions/send-reminders/` | Edge Function (Deno) that sends reminder notifications: `reminders.ts` holds the pure rules (8:00 AM summary in the user's time zone, 30 minutes before timed quests), `index.ts` reads subscriptions and saves as `service_role`, claims each reminder in `push_log` so it's sent once, and pushes with `web-push`. Secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` live in Supabase → Edge Functions → Secrets |
| `supabase/reminders.sql`, `supabase/reminders-schedule.sql` | Reminder tables (`push_subscriptions` with RLS, `push_log` server-only) and the pg_cron job that calls the function every 15 minutes |
| `supabase/schema.sql`, `supabase/README.md` | The `saves` table and its Row Level Security policies, and the click-by-click Supabase setup and test guide |
| `docs/index.html` | Public Product Page: pitch, living PRD and weekly build log. Has its own PostHog snippet |
| `docs/journal-desktop.png`, `docs/journal-phone.png` | Current screenshots (sample data) used on the Product Page and README |
| `docs/holiday.png`, `docs/holiday2.png`, `docs/prototype.png` | Earlier screenshots kept for the build log (pre-redesign) |
| `PRODUCT.md` | Product context for design work (users, positioning, constraints); read by the Impeccable plugin |
| `.impeccable/config.json` | Impeccable design-hook settings (`config.local.json` is per-developer and ignored) |
| `README.md` | Public project overview and how to try it |
| `Intent.md`, `Plan.md`, `journal/`, `tests/README.md`, `SPONSOR_MEMO.md` | Course templates; mostly unfilled |

### How the app code is organized (`docs/app/index.html`)
- **Design tokens** (colors, fonts, shadows, corner ornaments) are CSS variables at the top of the `<style>` block; journal themes override `--accent` and the `--leather`/`--sky` colors. The look is an elegant fantasy quest journal (see `PRODUCT.md` → Brand Commitments): paper panels with torn edges come from the `#paper-edge` SVG filter applied to `::before` backgrounds only, so text stays crisp.
- **Game numbers** (`XP_BY_DIFFICULTY`, bonuses, `XP_PER_LEVEL`, `SHIELD_PRICE`, `CHEST_MIN`/`CHEST_MAX`, `ACHIEVEMENT_COINS`) sit at the top of the script; several are placeholders.
- **Pure logic** (`parseEntry`, `parseIcs`, `holidaysToEvents`, `completeQuest`, `checkInGoal`, `claimReward`, `applyEdit` and others) never touches the page, so it can be tested in Node.
- **Page code** starts at `// ---------- Page code ----------`: `render*` functions build each tab, and one `click`, `submit` and `change` listener each route actions by `data-action`.
- **Smart compose:** `historySuggestion` (pure) matches what's typed against `suggestionSources` (newest quests and routines, then templates). The page code (`updateSuggestion`, `askAi`, `acceptSuggestion`) asks `/api/suggest` only when history has no match, after a 350 ms pause, and only if `detectAi` found `server.js` on localhost.
- **Storage key** is `dailyquest.v2`. Changing the saved data shape needs a migration, or users lose their data (in the browser and in Supabase, which stores the same object).
- **Accounts:** `SUPABASE_URL` and `SUPABASE_KEY` (the public publishable key; never the secret/service_role key) sit under `// ---------- Accounts`. Empty means accounts are off. `save()` calls `markChanged()`, which uploads the save about a second later (`pushNow`). Sync bookkeeping lives in a separate key, `dailyquest.sync` (`{ user, syncedAt, pending }`). At login the pure `syncPlan()` picks upload, download, none or ask. Logging out clears the browser copy.
- **Reminders:** `PUSH_PUBLIC_KEY` (public half of the VAPID pair) and `remindersPanel`, `pushOn`, `pushOff`, `pushTest` sit under `// ---------- Reminders`. Turning on saves the device's push subscription and time zone to `push_subscriptions`; logout calls `pushOff(true)`. `sw.js` shows pushes and opens the app on tap. Newer Supabase projects grant no table access by default, so new tables need explicit grants (see `reminders.sql`).
- **Analytics:** `track(event, props)` sends PostHog events. Never send task or reward names, or emails (account events: `login`, `signup`, `logout`, `sync_choice`; reminders: `reminders_on`, `reminders_off`). Session replay masks all text in the app.

## 2. Commands
- **Install dependencies:** None. The prototype is one static page with no packages.
- **Run locally:** Double-click `docs/app/index.html`, or run `start docs/app/index.html` (Windows) / `open docs/app/index.html` (Mac). It opens with sample data. Holiday import, PostHog and fonts need internet; everything else works offline.
- **Run with accounts:** works by double-clicking or with `node server.js`; email links (confirm, reset) return to the Site URL set in Supabase. Setup in `supabase/README.md`.
- **Run with AI suggestions:** set up `.env` from `.env.example`, then `node server.js` and open http://localhost:8787/app/. `node server.js --models` lists the models the key can use. Without a key the server still serves the app with AI off.
- **Deploy:** Push to `main`. GitHub Pages republishes `docs/` in about a minute; browsers may cache the old page for up to 10 minutes. Installed home-screen apps pick up the new page on their next launch with a connection; bump `CACHE` in `sw.js` only if a device must drop its old copy.
- **Reset the demo:** Profile tab → **Reload sample data** or **Start empty**. **Simulate next day** tests rollover and streaks.
- **Run deterministic tests:** No automated test suite is committed yet. Before pushing, manually check: add a typed quest (e.g. `exercise 3 times a week`, `coffee chat at 3pm`), use a template chip, complete a quest, claim a reward, import a `.ics` file, tap **Add US holidays** in Schedule, type `send th` and press Tab to accept the suggestion, and check a phone-width window (about 390px). Server tests should use a fake `fetch` (`createServer(env, fakeFetch)`) so they never spend OpenAI credits.
- **Run model evals:** Not set up yet. The only model use is optional local typing suggestions; judge them by hand from `node server.js` and PostHog's `suggestion_shown` / `suggestion_accepted` (property `source`: history or ai).

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
