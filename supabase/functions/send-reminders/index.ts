// Supabase Edge Function: sends DailyQuest reminder notifications.
//
// Called every 15 minutes by a database schedule (pg_cron). For each phone that turned on
// reminders, it reads that user's saved quests, works out what's due (reminders.ts), records
// each reminder in push_log so it's never sent twice, and sends it through the phone's push service.
// A signed-in user can also POST { "test": true } to get a test notification on their own devices.
//
// Secrets (Supabase -> Edge Functions -> Secrets; never in code):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { remindersFor } from "./reminders.ts";

const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT"), Deno.env.get("VAPID_PUBLIC_KEY"), Deno.env.get("VAPID_PRIVATE_KEY"));

const TESTS_PER_HOUR = 5;   // test notifications per signed-in user
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Sends one notification to one device. Removes devices the push service says are gone.
async function push(sub, note) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: note.title, body: note.body, tag: note.key, url: "./" }), { TTL: 3600 });
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) await db.from("push_subscriptions").delete().eq("id", sub.id);
    console.log("push failed", e.statusCode || e.message);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "method" });
  const body = await req.json().catch(() => ({}));

  // Test notification for the signed-in user only.
  if (body.test) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who || !who.user) return reply(401, { error: "login_required" });
    // Per-user rate limit on test notifications (recorded in the server-only push_log table).
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from("push_log").select("key", { count: "exact", head: true }).eq("user_id", who.user.id).like("key", "test:%").gte("sent_at", since);
    if ((count || 0) >= TESTS_PER_HOUR) return reply(429, { error: "slow_down" });
    await db.from("push_log").insert({ user_id: who.user.id, key: "test:" + Date.now() + ":" + crypto.randomUUID().slice(0, 8) });
    const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", who.user.id);
    let sent = 0;
    for (const s of subs || []) if (await push(s, { key: "test", title: "Reminders are on", body: "DailyQuest will remind you at 8:00 AM and 30 minutes before timed quests." })) sent++;
    return reply(200, { sent });
  }

  // Scheduled run: everyone with reminders on.
  const { data: subs, error } = await db.from("push_subscriptions").select("*");
  if (error) return reply(500, { error: "subscriptions" });
  const userIds = [...new Set((subs || []).map((s) => s.user_id))];
  if (!userIds.length) return reply(200, { ok: true });
  const { data: saves } = await db.from("saves").select("user_id, data").in("user_id", userIds);
  const saveOf = new Map((saves || []).map((s) => [s.user_id, s.data]));

  const now = Date.now();
  let sent = 0;
  for (const userId of userIds) {
    const state = saveOf.get(userId);
    if (!state) continue;
    const devices = subs.filter((s) => s.user_id === userId);
    const notes = remindersFor(state, now, devices[0].tz || "America/New_York");
    for (const note of notes) {
      // Claim the reminder first; if it was already claimed (sent before), skip it.
      const { data: claimed } = await db.from("push_log").insert({ user_id: userId, key: note.key }).select("key");
      if (!claimed || !claimed.length) continue;
      for (const d of devices) if (await push(d, note)) sent++;
    }
  }
  await db.from("push_log").delete().lt("sent_at", new Date(now - 3 * 86400000).toISOString());   // keep the log small
  return reply(200, { ok: true });   // no counts: anyone with the public key can trigger a run, so don't reveal how many users there are
});
