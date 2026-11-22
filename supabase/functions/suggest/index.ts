// Supabase Edge Function: AI typing suggestions for the live DailyQuest app.
// The app sends the start of a quest (and recent quest names); this function asks a small OpenAI
// model to finish it and returns only the suggested ending. The OpenAI key never reaches the browser.
//
// Safety: signed-in users only; input checked (3-120 characters); 30 suggestions per hour per user and
// a daily total cap for everyone (429 when exceeded); 6-second timeout; typed text is never logged.
//
// Secrets (Supabase -> Edge Functions -> Secrets; never in code):
//   OPENAI_API_KEY, OPENAI_MODEL (a cheap "mini"/"nano" model), optional AI_DAILY_LIMIT (default 300)
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { readInput, openAiRequest, cleanCompletion } from "./rules.ts";

const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const KEY = Deno.env.get("OPENAI_API_KEY") || "", MODEL = Deno.env.get("OPENAI_MODEL") || "";
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT")) || 300;
const PER_USER_PER_HOUR = 30;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "method" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(token);
  if (!who || !who.user) return reply(401, { error: "login_required" });
  if (!KEY || !MODEL) return reply(503, { completion: "", error: "ai_off" });

  const input = readInput(await req.json().catch(() => ({})));
  if (input.error) return reply(400, { error: input.error });

  // Rate limits, recorded in the server-only push_log table (cleaned up after 3 days).
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: mine } = await db.from("push_log").select("key", { count: "exact", head: true }).eq("user_id", who.user.id).like("key", "ai:%").gte("sent_at", hourAgo);
  if ((mine || 0) >= PER_USER_PER_HOUR) return reply(429, { completion: "", error: "slow_down" });
  const startOfDay = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
  const { count: today } = await db.from("push_log").select("key", { count: "exact", head: true }).like("key", "ai:%").gte("sent_at", startOfDay);
  if ((today || 0) >= DAILY_LIMIT) return reply(429, { completion: "", error: "daily_limit" });
  await db.from("push_log").insert({ user_id: who.user.id, key: "ai:" + Date.now() + ":" + crypto.randomUUID().slice(0, 8) });

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(6000),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify(openAiRequest(MODEL, input.text, input.recent)),
    });
    if (!res.ok) { console.log("openai status", res.status); return reply(502, { completion: "", error: "ai_unavailable" }); }
    const data = await res.json();
    const raw = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
    return reply(200, { completion: cleanCompletion(input.text, raw) });
  } catch (e) {
    return reply(504, { completion: "", error: "timeout" });
  }
});
