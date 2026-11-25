# DailyQuest security audit (Build 3, Nov 21–22, 2026)

**Lane:** Beginner · **Live app:** https://building-with-ai-f26.github.io/tyt223-dailytask/app/

## What kind of app this is

**An app with sign-in (and AI).** DailyQuest is a static site on GitHub Pages. Guests keep their quests in their own browser. Signed-in users (Supabase Auth, email + password with email confirmation) also sync one save per user to a Supabase Postgres database. Four Supabase Edge Functions run on the server: `suggest` (AI typing suggestions from a small OpenAI model, signed-in users only), `ai-tools` (AI "paste anything → quests" and the weekly chronicle, signed-in users only), `fetch-calendar` (downloads a user's calendar subscription link) and `send-reminders` (push notifications, run every 15 minutes by `pg_cron`). The OpenAI key lives only in Supabase's Edge Function secrets. The local helper `server.js` offers the same AI on the builder's computer with the key in a git-ignored `.env`.

| Piece | Where | Who can reach it |
| --- | --- | --- |
| App (HTML/JS) | GitHub Pages | Everyone |
| `saves` (each user's quests, settings, calendar links) | Supabase Postgres, RLS on | The signed-in owner only |
| `push_subscriptions` (devices with reminders on) | Supabase Postgres, RLS on | The signed-in owner only |
| `push_log` (reminders sent, rate-limit records) | Supabase Postgres, RLS on, no policies | Server functions only (`service_role`) |
| `suggest`, `ai-tools`, `fetch-calendar`, `send-reminders` | Supabase Edge Functions, JWT required | Signed-in users (the scheduled reminder run uses the public key) |
| Secrets (`OPENAI_API_KEY`, `VAPID_PRIVATE_KEY`, service role key) | Supabase Edge Function secrets / provided by Supabase | Server only |

## What I checked and what I found

### 1. Access control: Account B trying to read Account A's data
- **Database rules:** RLS is enabled on all 3 tables. `saves` and `push_subscriptions` each have 4 policies (select, insert, update, delete) that only match rows where `user_id = auth.uid()`. `anon` has **no** table privileges; `authenticated` has only select/insert/update/delete; `push_log` has none for clients.
- **Two-user test inside the database** (temporary users A and B, then rolled back): as A, a query saw only 1 row (A's own) even though B's row existed; A could save and update its own row; **A changed 0 and deleted 0 of B's rows.**
- **Live test as Account B in the browser console** (logged in to the live site as a second account, trying to read, overwrite, delete and impersonate Account A): results and screenshot below in *Security test result*.
- **Without logging in** (public key only, against the live API): reading, inserting and deleting in `saves`, `push_subscriptions` and `push_log` all return **`permission denied` (42501)**. Both functions return **401** without a login (`fetch-calendar` refused even an internal address like `http://169.254.169.254/`).

### 2. Secret key search
Searched the repo, its **full git history on all branches**, and the live site's files (`/`, `/app/`, `/app/sw.js`, `/app/manifest.webmanifest`) for `sb_secret_`, `service_role` keys, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_`, generic `sk-…` keys, private-key blocks and a real `VAPID_PRIVATE_KEY=` value.
- **Found: nothing secret.** The only matches were the placeholder `VAPID_PRIVATE_KEY=replace-with-private-key` in `.env.example` and a code comment that says "Never put the secret / service_role key here".
- `.env` (OpenAI key, VAPID keys) is git-ignored and has **never been committed**.
- Public keys on the live site, which are meant to be public: PostHog `phc_…`, Supabase publishable `sb_publishable_…` (safe because of RLS), the VAPID **public** key.

### 3. File storage
No storage buckets exist (`storage.buckets` is empty). DailyQuest stores no files; `.ics` imports are read in the browser and never uploaded.

### 4. Protecting production from the agent
- AGENTS.md now has an **"Ask me first"** list (deleting data or changing the database; keys, secrets and permissions; anything that costs money) and a **Shipping** section.
- **Manual backup:** all three tables exported on Nov 22, 2026 to `backups/dailyquest-backup-2026-11-22.json` (git-ignored, because it contains personal quests and a private calendar link). The export query is in `backups/README.txt`.
- During this audit the agent's own attempt to read `.env` values into a temp file to compare them was **blocked by Claude Code's safety classifier**; the search was redone using key patterns only. That became a rule in AGENTS.md.

### 5. Spending caps and rate limits
- **The one paid API is OpenAI**, called only by the `suggest` and `ai-tools` functions for signed-in users. `ai-tools` allows **20 pastes and 3 chronicles per day per user** (429 `slow_down`) and shares the daily total. `suggest` allows **30 suggestions per hour per user** (429 `slow_down`) and **`AI_DAILY_LIMIT` (default 300) per day for everyone** (429 `daily_limit`); the app stops asking for the rest of the session after a 429. The local helper `server.js` has its own per-minute and daily caps. **Owner action:** a hard monthly budget in the OpenAI dashboard.
- **Added in this audit:** per-user rate limits on both server routes:
  - `fetch-calendar`: **30 fetches per hour per user**, so it can't be used as a general downloader or hammered. Returns 429 `slow_down`, shown as "Too many refreshes in the last hour."
  - `send-reminders` test notifications: **5 per hour per user**. Returns 429, shown as "You've sent several tests already."
- **Database writes** (`saves`, `push_subscriptions`) come straight from the browser, but only for signed-in users, only to their own row (RLS), and the app batches saves (one upload about a second after changes stop). Supabase Auth itself rate-limits sign-ups, logins and emails.

### 6. Dependency audit
There is no `package.json`; the app uses no npm packages. Its one browser library, `@supabase/supabase-js@2.118.0`, is loaded from jsDelivr with a pinned version and a **Subresource Integrity hash**. The Edge Functions use `web-push@3.6.7` and `@supabase/supabase-js@2.118.0`; `npm audit` on those exact versions: **found 0 vulnerabilities**.

### 7. Agent security review (trying to break the app)
| Attack | Result |
| --- | --- |
| Script injection (`<img onerror>`, `<svg onload>`) in quest, routine, template, reward and reward-emoji names, calendar event titles and locations, calendar names and calendar error text, then render every tab, Profile chapter, the edit sheet and the typing suggestion | **Blocked:** 0 injected elements, 0 scripts ran; everything rendered as text (`esc()` on all user text, `toast()` escapes) |
| Read / insert / delete every table with only the public key | **Blocked:** `permission denied` on all 3 tables |
| Call `suggest`, `fetch-calendar` and `send-reminders` without a login, and ask `fetch-calendar` for an internal cloud address | **Blocked:** 401 (`login_required`) |
| Call `ai-tools` without a login | **Blocked:** 401 (`login_required`) |
| Make the AI return junk or harmful quests (bad JSON, invented dates, unknown categories, 40 items, HTML in names) | **Contained:** strict JSON schema, then `cleanPasteQuests` drops or repairs each field, caps at 15 items, and the app escapes names. Nothing is added until the player ticks and confirms (24 unit checks plus a browser test) |
| Send a huge or tampered chronicle request | **Bounded:** `readChronicle` keeps only known fields, caps numbers and at most 8 quest names of 60 characters |
| Spend the owner's OpenAI credits: call `suggest` more than 30 times in an hour | **Blocked:** call 31 returns 429 (`slow_down`); see the AI rate-limit test below |
| Prompt injection through the typed text or recent quest names | Low impact: the reply is only a suggestion, cut to 60 characters, escaped before display, and never acted on |
| Calendar fetcher as an open downloader (other sites, `http://`, `user:pass@`, odd ports, look-alike hosts such as `calendar.google.com.evil.example`) | **Blocked** by an allow-list of calendar sites, checked again after redirects (40 unit checks) |
| Anyone triggering the scheduled reminder run with the public key | **Allowed but harmless:** each reminder is claimed once in `push_log`, so no duplicates are sent. **Fixed:** the reply no longer reveals how many users have reminders on |

**Supabase security advisor:**
- `push_log` has RLS with no policy (INFO): intentional, server-only.
- `pg_net` extension installed in the `public` schema (WARN): created there when setting up the reminder schedule. **Fixed** (see below).
- Leaked-password protection is off (WARN). See *Remaining issues*.

### 8. Second round: attacks as a signed-in user (Nov 22)
| # | Attack | Finding | Fix |
| --- | --- | --- | --- |
| F1 | Connect a calendar from `brightspace.attacker.com` | **Allowed:** the allow-list accepted any host with "brightspace" in its name, so the server would fetch an attacker's site | Only `.edu` school Brightspace hosts (e.g. `brightspace.nyu.edu`) or official `*.brightspace.com` / `*.d2l.com`; same rule in the app (35 checks) |
| F2 | A calendar site redirects the server to another address | **Possible:** redirects were followed first and checked afterwards (blind server-side request forgery) | The fetcher follows redirects itself, at most 3, checking each destination **before** requesting it |
| F3 | Save a fake "phone" push address (any URL) in `push_subscriptions`, then request a test notification | **Possible:** the reminder server would send a request to that URL | `send-reminders` only sends to real browser push services (Apple, Google, Mozilla, Microsoft) and deletes fake addresses (14 checks) |
| F4 | A crafted date such as `\"><img onerror=…>` in the paste-review list | **Script ran** in the test: the date was placed in the page unescaped (the real server already rejects such dates, so it wasn't reachable in practice) | Escaped every value placed in HTML attributes (paste review, typing preview, edit sheet), and the app re-checks the server's dates and times; re-test: 0 scripts |
| F5 | Any future script-injection bug could send the login session to another site | **No Content-Security-Policy** | Added a CSP `<meta>` tag: scripts only from the page, jsDelivr and PostHog; data only to Supabase, PostHog and the holidays API; no plugins, frames or `<base>` tricks. A real-browser run across every tab and pop-up showed **0 violations**, with Supabase, PostHog, fonts and the service worker all working |
| F6 | A signed-in user uploads a huge save | **Possible:** no size limit on `saves.data` (affects only their own row, but could fill the free database) | **Fixed:** database rules (`supabase/limits.sql`): a save over 1 MB is refused, and push addresses must be `https://` and under 1,000 characters. Backup taken first; tested in a rolled-back transaction (big save refused, `http://` address refused, both existing saves still valid); anonymous reads and writes still `permission denied` |

Re-checked as clean in this round: paste review, chronicle, landmark pop-up and settings with injected HTML (0 scripts); all four functions refuse callers who aren't logged in (401).

### 9. Friends (Build 4, Nov 24)
New tables `profiles` (each player's public hero card) and `friendships` (requests), in `supabase/friends.sql`. Backup taken first.

- **What friends can see:** only a hero name, avatar, level, streak and XP this week. The app sends just those five numbers/ids from the save; quest names, calendars, rewards and email never leave it (checked in the browser test: the uploaded card never contained a quest name).
- **Players can read and change only their own card.** Friends' cards and every friend action go through five database functions (`find_players`, `request_friend`, `respond_friend`, `remove_friend`, `friend_list`) that check who is asking. The `friendships` table has no direct access at all.
- **Before a request is accepted**, the other person sees only name, avatar and level, not streak or weekly XP.
- **Search** needs at least 3 characters, returns at most 8 players, treats `%` and `_` as plain text, and only lists players who leave **"Let classmates find me by nickname"** on. An exact friend code always works, so a player can share their code without being searchable.
- **Spam limits:** 20 unanswered requests and 200 friends per player.
- **Tested in the database** (rolled-back transaction, both real accounts): A can't create B's card; no direct friendships access; B sees only their own card row and can't change A's; a wildcard search returns nothing; requesting yourself or twice is refused; B can't accept B's own request; weekly XP is hidden until accepted; turning off search hides A while the code still works; signed-out visitors get `permission denied` on the tables and the functions.
- **Tested in the browser** (fake server): a friend named `<img src=x onerror=…>` with a script in their avatar field shows as plain text and runs nothing.
- **Supabase advisor:** warns that signed-in users can call the five functions. That is intended: they are the only way to reach friends data, and each checks the caller.

## What I fixed
1. Added per-user rate limits to `fetch-calendar` (30/hour) and test notifications (5/hour), with friendly messages in the app; built the AI `suggest` function with a login requirement, 30/hour per user and a daily cap from the start.
2. Removed user counts from the scheduled reminder run's reply.
3. Made a manual database backup and git-ignored the `backups/` folder.
4. Added the Shipping section, the "Ask me first" list and rules from real agent mistakes to AGENTS.md.
5. Moved the `pg_net` extension from `public` to the `extensions` schema, after confirming the backup was current. I then fired the reminder job's request once to confirm the schedule still works (200 `{"ok":true}`); the advisor warning is gone.
6. Earlier in Build 3 (found while building): granted logged-in users and the server exactly the table access they need. New Supabase projects grant none, and anonymous access stays at zero.

**What text goes to OpenAI:** for typing suggestions, the start of the quest being typed and up to 15 recent quest names; for "paste anything", the pasted text (up to 4,000 characters; the app warns not to paste passwords or sensitive details); for the chronicle, this week's counts, up to 8 finished quest names, the boss, streak, landmark and weekly-goal progress. None of it is logged by DailyQuest's functions.

7. Second-round fixes F1–F6 above (calendar allow-list, redirect checks, push-address check, attribute escaping, Content-Security-Policy, database size and push-address rules).

## Remaining issues
- **Leaked-password protection** (blocks passwords found in data breaches) is a Supabase Auth setting that may need a paid plan; the minimum password length is 8.
- **The CSP allows inline scripts** (`unsafe-inline`), because the app is one HTML file with inline code. It still blocks scripts from unknown sites and sending data anywhere except the app's own services. Escaping all user text remains the main defense (tested).
- **The scheduled run can be triggered by anyone with the public key.** It's harmless (no duplicate sends, no data returned) but uses free-tier function invocations; a shared secret could restrict it later.
- **Browser writes are limited by sign-in, RLS and app batching, not a server-side rate limit.** A signed-in user could write to their own row rapidly; this only affects their own data.

## Security test result
Logged in on the live site as **Account B**, running this in the browser console (DevTools → Console):

```js
(async () => {
  const db = account.client, me = account.user;
  const A = "601be6a2-f087-47f1-81ae-68ce3b9b43c2";                 // Account A's user id
  console.log("Logged in as Account B:", me.email);
  const r1 = await db.from("saves").select("user_id").eq("user_id", A);
  console.log("1. Read A's save →", r1.error ? "BLOCKED: " + r1.error.message : r1.data.length + " rows");
  const r2 = await db.from("saves").select("user_id");
  console.log("2. Read every save → visible rows:", r2.data.length, "(only my own)");
  const r3 = await db.from("saves").update({ data: { hacked: true } }).eq("user_id", A).select();
  console.log("3. Overwrite A's save → rows changed:", r3.data ? r3.data.length : 0);
  const r4 = await db.from("saves").delete().eq("user_id", A).select();
  console.log("4. Delete A's save → rows deleted:", r4.data ? r4.data.length : 0);
  const r5 = await db.from("saves").insert({ user_id: A, data: { hacked: true } });
  console.log("5. Write a save as A →", r5.error ? "BLOCKED: " + r5.error.message : "ALLOWED (bad!)");
  const r6 = await db.from("push_log").select("*");
  console.log("6. Read the server log →", r6.error ? "BLOCKED: " + r6.error.message : r6.data);
})();
```

Expected: **1 → 0 rows, 2 → 1 row (my own), 3 → 0 changed, 4 → 0 deleted, 5 → blocked, 6 → blocked.** (The same rules already passed the two-user test inside the database.) Observed on the live site (Nov 22): **matched the expected results**; screenshot submitted with the Build 3 assignment.

### AI rate-limit test
Logged in on the live site (any account), in the browser console. This makes 31 small AI calls (a fraction of a cent in total):

```js
(async () => {
  const codes = [];
  for (let i = 1; i <= 31; i++) {
    const { error } = await account.client.functions.invoke("suggest", { body: { text: "coffee chat with " + i, recent: [] } });
    codes.push(error && error.context ? error.context.status : 200);
  }
  console.log("status codes:", codes.join(" "));
  console.log("first 429 at call", codes.indexOf(429) + 1);
})();
```

Expected: calls 1–30 return 200 and **call 31 returns 429**. Without a login every call returns 401. Observed on the live site (Nov 22): **matched the expected results** (calls 1–30 succeeded, call 31 was refused with 429).
