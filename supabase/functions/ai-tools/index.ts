// Supabase Edge Function: AI tools for DailyQuest.
//   { action: "paste", text, today }   -> { quests: [...] }   turn pasted text into quests (the player reviews them)
//   { action: "chronicle", stats }     -> { entry, focus }    write this week's journal chronicle
//
// Safety: signed-in users only; inputs bounded (rules.ts); the AI's answer is checked before it's returned;
// per-user daily limits (20 pastes, 3 chronicles) and a shared daily AI cap for everyone (429 when exceeded);
// pasted text and quest names are never logged. The OpenAI key lives only in Supabase's secrets.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { readPaste, pasteRequest, cleanPasteQuests, readChronicle, chronicleRequest, cleanChronicle } from "./rules.ts";

const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const KEY = Deno.env.get("OPENAI_API_KEY") || "", MODEL = Deno.env.get("OPENAI_MODEL") || "";
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT")) || 300;   // shared with the suggest function ("ai:" rows)
const PER_USER_PER_DAY = { paste: 20, chronicle: 3 };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function askOpenAI(request, timeoutMs) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify(request),
  });
  if (!res.ok) { console.log("openai status", res.status); return null; }
  const data = await res.json();
  return data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "method" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(token);
  if (!who || !who.user) return reply(401, { error: "login_required" });
  if (!KEY || !MODEL) return reply(503, { error: "ai_off" });

  const body = await req.json().catch(() => ({}));
  const action = body.action === "paste" || body.action === "chronicle" ? body.action : "";
  if (!action) return reply(400, { error: "bad_action" });
  const input = action === "paste" ? readPaste(body) : readChronicle(body);
  if (input.error) return reply(400, { error: input.error });

  // Limits, recorded in the server-only push_log table (cleaned up after 3 days).
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const prefix = "ai:" + action + ":";
  const { count: mine } = await db.from("push_log").select("key", { count: "exact", head: true }).eq("user_id", who.user.id).like("key", prefix + "%").gte("sent_at", dayAgo);
  if ((mine || 0) >= PER_USER_PER_DAY[action]) return reply(429, { error: "slow_down" });
  const startOfDay = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
  const { count: today } = await db.from("push_log").select("key", { count: "exact", head: true }).like("key", "ai:%").gte("sent_at", startOfDay);
  if ((today || 0) >= DAILY_LIMIT) return reply(429, { error: "daily_limit" });
  await db.from("push_log").insert({ user_id: who.user.id, key: prefix + Date.now() + ":" + crypto.randomUUID().slice(0, 8) });

  try {
    if (action === "paste") {
      const raw = await askOpenAI(pasteRequest(MODEL, input.text, input.today), 20000);
      if (raw == null) return reply(502, { error: "ai_unavailable" });
      return reply(200, { quests: cleanPasteQuests(raw, input.today) });
    }
    const raw = await askOpenAI(chronicleRequest(MODEL, input.stats), 15000);
    const chronicle = raw == null ? null : cleanChronicle(raw);
    return chronicle ? reply(200, chronicle) : reply(502, { error: "ai_unavailable" });
  } catch (e) {
    return reply(504, { error: "timeout" });
  }
});
