# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

First-year NYU Stern MBA students juggling classes, recruiting, events and personal life, starting with the builder's Pod 13 classmates, who can be interviewed and test the product weekly. More broadly: people with busy, multitasking lives who are exhausted by managing their schedule across several apps.

Primary situation: **quick check-ins on a phone**, between classes or on the go, to see what to do today, tick things off, and capture a new task the moment it comes up. Weekly planning also happens, but the phone check-in is the moment the product is designed around.

## Product Purpose

DailyQuest is a gamified task planner. Users add tasks whenever something comes up, or in one quick weekly session; each day they open the app, see only today's quests, and follow the list without re-planning. Finishing quests earns XP, levels, streaks and coins they spend on real-life rewards they choose themselves.

It exists because MBA students piece their day together from five or more places (calendar, Brightspace, email and LinkedIn, Slack and club pages, personal notes), things slip (a missed thank-you note after a coffee chat, a forgotten deadline), and managing life feels like another job.

Success: users open it daily, keep their streaks, and stop losing tasks between apps.

## Positioning

Three things together, confirmed by the builder as core:

1. **Game rewards that feel earned.** XP, levels, streaks, badges and a self-stocked reward shop make staying on top of life feel like progress instead of pressure. Lifetime XP (levels) is separate from spendable coins, so claiming a reward never lowers a level.
2. **One place, not five apps.** Today's quests, weekly goals, and imported calendar events live together.
3. **Type it like you'd say it.** One box; plain English such as "exercise 3 times a week" or "coffee chat at 3pm" becomes the right kind of quest, with no form to fill in.

MBA-specific templates (recruiting follow-ups, thank-you notes, class prep) support the target user but were not chosen as a core differentiator.

## Operating Context

- Used on a phone for quick check-ins; laptop use is secondary but must still work.
- Users capture tasks in the moment: after a coffee chat, when an assignment is posted, when an event is announced.
- Users export their Google Calendar as a `.ics` file and import it so class and recruiting events appear on the day's schedule.
- Built for the NYU Stern course Building with AI (Fall 2026), with weekly builds, a public Product Page with a living PRD (`docs/index.html`), and user testing in Build 4.

## Capabilities and Constraints

**Current capabilities** (prototype at `docs/app/index.html`, live at https://building-with-ai-f26.github.io/tyt223-dailytask/app/):
- Type-to-add with rule-based parsing of dates, times, categories, difficulty and repeats (no AI).
- Quick templates with a fill-in blank; users can save their own.
- Today's Quests with overdue items on top; tap a circle to complete.
- Weekly goals ("N times a week") and repeating quests (daily or chosen weekdays); unfinished quests roll over.
- Schedule timeline with timed quests and read-only calendar events; `.ics` import in the browser.
- Reward shop, badges, themes, level-up and "Day cleared!" moments.
- Bottom tabs: Today, Week, Shop, Profile.
- PostHog analytics and session replay, with all text masked in the app.

**Terminology:** quests; categories Class, Recruiting, Events, Personal; difficulty Easy / Medium / Hard; XP and lifetime XP (levels); coins (spendable XP); streak; weekly goals; repeating quests; reward shop; Day cleared.

**Firm constraints:**
- **Free to run ($0).** Static hosting on GitHub Pages; no paid servers or paid AI calls.

**Current state, not commitments** (the builder did not mark these firm):
- No sign-up or login.
- Data stays in the user's browser (`localStorage`), so it does not sync across devices.

**Out of scope for v1:** live Google Calendar sync (`.ics` import only; planned later), automatic imports from Brightspace, Gmail, LinkedIn or Slack, and social or team features.

**Undecided:** final XP numbers (recruiting bonus, streak bonus, weekly goal bonus and level size are placeholders); the riskiest assumption and architecture sections of the PRD.

## Brand Commitments

- Name: **DailyQuest**.
- **The playful RPG look is binding**, not a phase: a cozy quest-board feel, the crowned pixel mascot, and the game feel of earning XP, leveling up and claiming rewards.

## Evidence on Hand

- Living PRD and weekly build log: `docs/index.html` (public Product Page).
- Working prototype: `docs/app/index.html`, with pre-loaded sample quests, rewards and calendar events for demos.
- Prototype screenshot: `docs/prototype.png` (Week tab, sample data).
- PostHog analytics installed on November 15–16, 2026; no meaningful usage data yet.
- **No user testing results, testimonials, customer names or usage numbers exist yet.** Do not invent any.

## Product Principles

1. **Today first.** Opening the app answers "what do I do now?" in one glance on a phone.
2. **Capture in seconds.** Adding a task should never take more than a sentence or a couple of taps.
3. **Progress you can feel.** Every completion should visibly pay off, and rewards should be the user's own.
4. **One place.** Prefer bringing a user's scattered tasks and events together over adding new places to check.
5. **Free and simple to run.** New features must work within static hosting at $0.
