# Accounts with Supabase (email + password)

Logging in is optional. Without it, DailyQuest works as before and saves in one browser. With it, your quests are saved to your account and follow you between your phone and laptop.

People sign up with an email and password, confirm their email once, and can reset a forgotten password by email. Supabase's default emails are used, so no email service (SMTP) needs setting up.

```
DailyQuest page (GitHub Pages)  →  Supabase Auth (log in)  →  Supabase database: one "saves" row per user
       publishable key only          email + password           Row Level Security: you can only reach your own row
```

## Which keys go where

| Key | Where it goes | Safe in the page? |
| --- | --- | --- |
| **Project URL** (`https://xxxx.supabase.co`) | `SUPABASE_URL` in `docs/app/index.html` | Yes |
| **Publishable key** (`sb_publishable_…`, or the older "anon" key `eyJ…`) | `SUPABASE_KEY` in `docs/app/index.html` | Yes, *because* Row Level Security is on (step 2) |
| **Secret key** (`sb_secret_…`) / **service_role** key | Nowhere. DailyQuest doesn't need it | **Never.** It bypasses every rule |

## Setup

Supabase sometimes renames menus; if a label differs, look for the closest match. With the Supabase MCP connected, the coding agent can do steps 1–2 for you.

### 1. Find your project URL and publishable key
In your Supabase project, open **Project Settings** → **API Keys** (and **Data API** for the URL). Copy:
- the **Project URL**
- the **Publishable key**

### 2. Create the table and its privacy rules
1. Open **SQL Editor** → **New query**.
2. Paste all of [`schema.sql`](./schema.sql) and click **Run**.
3. Check that it worked: **Table Editor** should show a `saves` table, and **Authentication** → **Policies** should list 4 policies on `saves` with RLS **enabled**.

### 3. Tell Supabase where the app lives
This is used by the confirmation and password-reset emails. Open **Authentication** → **URL Configuration** and set:
- **Site URL:** `https://building-with-ai-f26.github.io/tyt223-dailytask/app/`
- **Redirect URLs:** add both of these:
  - `https://building-with-ai-f26.github.io/tyt223-dailytask/app/`
  - `http://localhost:8787/app/` (for testing with `node server.js`)

### 4. Email + password
Open **Authentication** → **Sign In / Providers** → **Email**:
- Make sure it's **enabled** and **Confirm email** is on.
- Set the minimum password length to **8** to match the app.

Supabase's built-in email sender only sends a few emails per hour and its templates can't be edited. That's fine for testing and a class demo. For a real launch you'd connect your own email service (**Authentication** → **Emails** → **SMTP Settings**).

### 5. Connect the app
Put the Project URL and publishable key in `docs/app/index.html`:

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_KEY = "sb_publishable_...";
```

Then commit and push. Leaving both empty turns accounts off.

## Test it

1. Run `node server.js` and open http://localhost:8787/app/, or double-click `docs/app/index.html`.
2. Go to **Profile** → **Create account**, enter your email and a password, and tap the link in the confirmation email. Then **Log in**.
3. Check **Supabase** → **Table Editor** → `saves`: there's one row with your user id.
4. Add a quest, wait two seconds, and refresh the table. `updated_at` changes.
5. Log out and log back in. Your quests come back. Try **Forgot password?** too.
6. Open the app in a different browser or on your phone and log in. Your quests appear.
7. **Privacy check:** in the browser, press F12 → **Network**, then add a quest. Requests go to `xxxx.supabase.co/rest/v1/saves` and carry only the publishable key and your own login token, never a secret key.

## Reminders (push notifications)

Logged-in users of the home-screen app can turn on **Profile → Reminders**: a summary at 8:00 AM in their own time zone, and a nudge 30 minutes before quests with a time.

```
pg_cron (every 15 min) → send-reminders Edge Function → reads saves + push_subscriptions → push_log (send once) → Apple/Google push → phone
```

Setup, already done for this project:
1. Run [`reminders.sql`](./reminders.sql) in the SQL Editor (tables, privacy rules and grants).
2. Add three secrets in **Edge Functions → Secrets**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Values come from your git-ignored `.env`; the public key must match `PUSH_PUBLIC_KEY` in `docs/app/index.html`.
3. Deploy [`functions/send-reminders`](./functions/send-reminders/) (keep **Verify JWT** on).
4. Run [`reminders-schedule.sql`](./reminders-schedule.sql) to call it every 15 minutes.

To test it, open DailyQuest from the home screen, log in, and tap **Turn on reminders** → allow → **Send a test**. Errors show in Supabase → Edge Functions → `send-reminders` → Logs.

## How syncing works
- **At login:** if the account has no save yet, this browser's quests are uploaded. If the browser is untouched, the account's quests are loaded. If both have changes, the app asks which to keep, and nothing is overwritten silently.
- **While logged in:** each change is saved to the account about a second later. Offline changes are kept and sent when you're back online.
- **Coming back to the tab** loads changes made on another device.
- **Logging out** clears that browser; your quests stay in your account.

**Limit:** if two devices are edited at the same moment, the last save wins.

## Free plan notes
- **Cost:** Supabase's free plan covers this. Each user stores one small row.
- **Pausing:** free projects pause after about a week with no activity. Open the Supabase dashboard and click **Restore** to wake it. While it's paused, the app still works in the browser and login shows as unavailable.
