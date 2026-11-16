# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** DailyQuest, a gamified task planner for busy MBA students. Users type tasks in plain English, see only today's quests, and earn XP, levels, streaks and real-life rewards for finishing them.
- **Primary user & core workflow:** First-year NYU Stern MBA students checking in on their phones. Full PRD in `docs/index.html`; durable product facts in `PRODUCT.md`.
- **Tech stack:** One static HTML file with plain CSS and JavaScript (no framework, no build step, no packages). Data in the browser's `localStorage`. Hosted free on GitHub Pages from the `docs/` folder. External calls from the browser: Nager.Date public holidays API (free, no key), PostHog analytics, Google Fonts. No AI model and no server.
- **Live URLs:** Product Page https://building-with-ai-f26.github.io/tyt223-dailytask/ · App https://building-with-ai-f26.github.io/tyt223-dailytask/app/
- **Firm constraint:** must stay free to run ($0). See `PRODUCT.md`.

### Project structure
| Path | What it is |
| --- | --- |
| `docs/app/index.html` | The whole app: styles, the sample data, the typed-task parser, game logic, `.ics` import, holiday import, rendering and PostHog events, in that order inside one `<script>` |
| `docs/index.html` | Public Product Page: pitch, living PRD and weekly build log. Has its own PostHog snippet |
| `docs/prototype.png` | Screenshot used on the Product Page and README |
| `PRODUCT.md` | Product context for design work (users, positioning, constraints); read by the Impeccable plugin |
| `.impeccable/config.json` | Impeccable design-hook settings (`config.local.json` is per-developer and ignored) |
| `README.md` | Public project overview and how to try it |
| `Intent.md`, `Plan.md`, `journal/`, `tests/README.md`, `SPONSOR_MEMO.md` | Course templates; mostly unfilled |

### How the app code is organized (`docs/app/index.html`)
- **Game numbers** (`XP_BY_DIFFICULTY`, bonuses, `XP_PER_LEVEL`) sit at the top of the script; several are placeholders.
- **Pure logic** (`parseEntry`, `parseIcs`, `holidaysToEvents`, `completeQuest`, `checkInGoal`, `claimReward`, `applyEdit` and others) never touches the page, so it can be tested in Node.
- **Page code** starts at `// ---------- Page code ----------`: `render*` functions build each tab, and one `click`, `submit` and `change` listener each route actions by `data-action`.
- **Storage key** is `dailyquest.v2`. Changing the saved data shape needs a migration, or users lose their data.
- **Analytics:** `track(event, props)` sends PostHog events. Never send task or reward names. Session replay masks all text in the app.

## 2. Commands
- **Install dependencies:** None. The prototype is one static page with no packages.
- **Run locally:** Double-click `docs/app/index.html`, or run `start docs/app/index.html` (Windows) / `open docs/app/index.html` (Mac). It opens with sample data. Holiday import, PostHog and fonts need internet; everything else works offline.
- **Deploy:** Push to `main`. GitHub Pages republishes `docs/` in about a minute; browsers may cache the old page for up to 10 minutes.
- **Reset the demo:** Profile tab → **Reload sample data** or **Start empty**. **Simulate next day** tests rollover and streaks.
- **Run deterministic tests:** No automated test suite is committed yet. Before pushing, manually check: add a typed quest (e.g. `exercise 3 times a week`, `coffee chat at 3pm`), use a template chip, complete a quest, claim a reward, import a `.ics` file, tap **Add US holidays** in Schedule, and check a phone-width window (about 390px).
- **Run model evals:** Not applicable. The app has no AI model.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
