# Verification: Tests, Evals & User Feedback

Review agent changes and verify that the product works throughout the course. Use automated tests for application behavior when useful, model evals for output quality, and manual checks for the user experience. A test shows what it checked; record its limits.

## Build 4: choose one track

**Track A — Domain quality**

Define 3–4 rules for good output. Evaluate 10 cases: 5 normal, 3 messy, and 2 adversarial. Compare results before and after improvements, and ask one outside target user to review the result.

**Track B — User friction**

Watch 3–5 outside users try the product without coaching. Review PostHog replays, identify the top three friction points, and document fixes with before/after evidence. The app can still run locally.

Both tracks update PRD v4 and the build log on `docs/index.html`. Follow [Icerynk Build 4](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content/build-4-test-py-tests-model-evals) for the rubric. You do not need to complete both tracks.

## Automated tests (DailyQuest)

Run everything with one command (Node 20 or newer, nothing to install):

```
node tests/run.js
```

One file: `node --test tests/logic.test.js`. About 60 checks run in under 10 seconds.

| File | What it checks |
| --- | --- |
| `logic.test.js` | XP, the daily chest, streaks and shields, levels, rewards, weekly goals, routines, cleared days, rescheduling, editing, login sync choices, login form checks, typing suggestions |
| `parser.test.js` | Typed quests in plain English: times, due dates, days, weekly goals, routines, categories, templates |
| `game.test.js` | Weekly boss HP and loot, buying and wearing gear, adventure map steps, landmark rewards |
| `calendar.test.js` | `.ics` import (folded lines, repeats, skipped and moved sessions), allowed calendar sites, calendar to quests, removing a calendar, US holidays, reminder timing |
| `friends.test.js` | Friend codes, hero names, weekly XP, Tavern standings, that friends never see quest names, code-only adding |
| `security.test.js` | `esc()`, every `value="…"` escaped, the Content-Security-Policy, no secret keys in the page, the pinned Supabase library, calendar and push-service allow-lists |
| `ai.test.js` | AI input checks and answer cleaning (suggestions, paste notes, chronicle) and `server.js` with a **fake** OpenAI: no real AI calls, no cost |
| `browser.test.js` | The real app in headless Edge or Chrome: add and finish a quest, every tab opens, and the Tavern friend flow against a **fake** Supabase. Skipped if no browser is found (`BROWSER=/path/to/browser` to choose one) |

**Limits:** nothing here talks to the real Supabase or OpenAI, so database rules (Row Level Security, the friend functions) are tested separately inside the database, as recorded in `SECURITY.md`. Visual design is checked with screenshots, not by these tests.

**Proof the tests catch bugs:** changing Easy quests from 10 to 11 XP makes 3 tests fail (checked Nov 25, 2026).
