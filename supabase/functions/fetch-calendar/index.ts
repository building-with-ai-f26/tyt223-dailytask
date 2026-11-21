// Supabase Edge Function: fetches a calendar subscription link (Google Calendar's
// "Secret address in iCal format", Outlook, iCloud, Brightspace) for the DailyQuest app.
// Browsers can't read these links directly (Google sends no CORS headers), so the app asks this
// function, which returns the .ics text. The app parses it with the same reader as file imports.
//
// Safety: signed-in users only, known calendar sites only (feeds.ts), https only, 10-second
// timeout, 3 MB cap, and the reply must actually be a calendar. Links and contents are never logged.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { normalizeFeedUrl, feedHostAllowed } from "./feeds.ts";

const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const MAX_BYTES = 3_000_000;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "method" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(token);
  if (!who || !who.user) return reply(401, { error: "login_required" });

  const body = await req.json().catch(() => ({}));
  const url = normalizeFeedUrl(body.url);
  if (!url) return reply(400, { error: "unsupported_link" });

  let res;
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1" } });
  } catch (e) {
    return reply(504, { error: "unreachable" });
  }
  if (!feedHostAllowed(new URL(res.url).hostname)) return reply(400, { error: "unsupported_link" });   // redirected somewhere else
  if (res.status === 404 || res.status === 410) return reply(404, { error: "not_found" });
  if (res.status === 401 || res.status === 403) return reply(403, { error: "private" });
  if (!res.ok) return reply(502, { error: "calendar_error" });
  if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) return reply(413, { error: "too_large" });

  const ics = await res.text();
  if (ics.length > MAX_BYTES) return reply(413, { error: "too_large" });
  if (!ics.includes("BEGIN:VCALENDAR")) return reply(422, { error: "not_a_calendar" });
  return reply(200, { ics });
});
