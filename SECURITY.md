# DailyQuest security audit (Build 3, Nov 21–22, 2026)

**Lane:** Beginner · **Live app:** https://building-with-ai-f26.github.io/tyt223-dailytask/app/

## What kind of app this is

**An app with sign-in.** DailyQuest is a static site on GitHub Pages. Guests keep their quests in their own browser. Signed-in users (Supabase Auth, email + password with email confirmation) also sync one save per user to a Supabase Postgres database. Two Supabase Edge Functions run on the server: `fetch-calendar` (downloads a user's calendar subscription link) and `send-reminders` (push notifications, run every 15 minutes by `pg_cron`). There is **no AI on the live site** and no paid API. The optional OpenAI helper (`server.js`) only runs on the builder's own computer.

| Piece | Where | Who can reach it |
| --- | --- | --- |
| App (HTML/JS) | GitHub Pages | Everyone |
| `saves` (each user's quests, settings, calendar links) | Supabase Postgres, RLS on | The signed-in owner only |
| `push_subscriptions` (devices with reminders on) | Supabase Postgres, RLS on | The signed-in owner only |
| `push_log` (reminders sent, rate-limit records) | Supabase Postgres, RLS on, no policies | Server functions only (`service_role`) |
| `fetch-calendar`, `send-reminders` | Supabase Edge Functions, JWT required | Signed-in users (the scheduled run uses the public key) |
| Secrets (`VAPID_PRIVATE_KEY`, service role key) | Supabase Edge Function secrets / provided by Supabase | Server only |

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
- **No paid API runs on the live site.** The optional local OpenAI helper has a daily cap (`AI_DAILY_LIMIT`) and a per-minute cap in `server.js`. **Action for the owner:** set a hard monthly budget in the OpenAI dashboard anyway.
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
| Call `fetch-calendar` and `send-reminders` without a login, and ask `fetch-calendar` for an internal cloud address | **Blocked:** 401 (`login_required`) |
| Calendar fetcher as an open downloader (other sites, `http://`, `user:pass@`, odd ports, look-alike hosts such as `calendar.google.com.evil.example`) | **Blocked** by an allow-list of calendar sites, checked again after redirects (40 unit checks) |
| Anyone triggering the scheduled reminder run with the public key | **Allowed but harmless:** each reminder is claimed once in `push_log`, so no duplicates are sent. **Fixed:** the reply no longer reveals how many users have reminders on |

**Supabase security advisor:**
- `push_log` has RLS with no policy (INFO): intentional, server-only.
- `pg_net` extension installed in the `public` schema (WARN): created there when setting up the reminder schedule. See *Remaining issues*.
- Leaked-password protection is off (WARN). See *Remaining issues*.

## What I fixed
1. Added per-user rate limits to `fetch-calendar` (30/hour) and test notifications (5/hour), with friendly messages in the app.
2. Removed user counts from the scheduled reminder run's reply.
3. Made a manual database backup and git-ignored the `backups/` folder.
4. Added the Shipping section, the "Ask me first" list and rules from real agent mistakes to AGENTS.md.
5. Earlier in Build 3 (found while building): granted logged-in users and the server exactly the table access they need. New Supabase projects grant none, and anonymous access stays at zero.

## Remaining issues
- **`pg_net` in the `public` schema** (advisor warning). Fixing it means dropping and re-creating the extension in the `extensions` schema and re-creating the 15-minute job, which is a production database change. It's on the "Ask me first" list and waiting for the owner's OK.
- **Leaked-password protection** (blocks passwords found in data breaches) is a Supabase Auth setting that may need a paid plan; the minimum password length is 8.
- **No Content-Security-Policy header:** GitHub Pages can't set response headers, and the app uses inline scripts, so a CSP would need `unsafe-inline`. Mitigated by escaping all user text (tested above). Supabase stores the login session in `localStorage`, so an XSS bug would expose it, which is why escaping is tested.
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

Expected: **1 → 0 rows, 2 → 1 row (my own), 3 → 0 changed, 4 → 0 deleted, 5 → blocked, 6 → blocked.** (The same rules already passed the two-user test inside the database.) Observed on the live site: _to be filled in from the screenshot submitted with the Build 3 assignment._
