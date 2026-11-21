// DailyQuest local server: serves the app and adds optional AI typing suggestions.
//
//   node server.js           start at http://localhost:8787/app/
//   node server.js --models  list the OpenAI models your key can use
//
// Your OpenAI key is read from .env (never committed) and only ever sent to OpenAI.
// What you type is never logged. No packages to install: this uses only Node's built-ins.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "docs");
const PORT = Number(process.env.PORT) || 8787;
const OPENAI_URL = "https://api.openai.com/v1";
const MAX_TEXT = 120;            // longest task start we send
const MAX_RECENT = 15;           // how many past task names give the AI context
const PER_MINUTE_LIMIT = 60;     // protects against runaway requests
const AI_TIMEOUT_MS = 6000;

// ---------- .env ----------
// Reads KEY=VALUE lines. Values already set in the real environment win.
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
function loadEnv(file = path.join(__dirname, ".env")) {
  let fromFile = {};
  try { fromFile = parseEnv(fs.readFileSync(file, "utf8")); } catch (e) { /* no .env yet */ }
  return Object.assign({}, fromFile, process.env);
}

// ---------- AI suggestion ----------
const SYSTEM_PROMPT = [
  "You complete task names for a busy MBA student's to-do planner, like Gmail Smart Compose.",
  "You get the start of a task and a few of the student's recent tasks for context.",
  "Reply with ONLY the text that should be appended to the start to finish the task name naturally, at most 8 words.",
  "Include a leading space if the next word is a new word. Never repeat the start. No quotes, no explanations, no trailing period.",
  "If the start already looks like a complete task, reply with nothing.",
].join(" ");

// Turns the model's reply into a safe, short piece of text to append after `start`.
function cleanCompletion(start, raw) {
  let s = String(raw || "").replace(/[\r\n]+/g, " ").replace(/^["'`]+|["'`]+$/g, "");
  if (s.trim().toLowerCase().startsWith(start.trim().toLowerCase()) && start.trim()) s = s.trim().slice(start.trim().length);
  s = s.replace(/[.\s]+$/, "");
  if (!s.trim()) return "";
  if (/\s$/.test(start)) s = s.replace(/^\s+/, "");                       // start already ends with a space
  else if (/^\w/.test(s) && /\w$/.test(start) && s.length > 2 && /^[A-Z]/.test(s)) s = " " + s;   // a new capitalised word
  return s.slice(0, 60);
}

// Calls OpenAI once. `fetchImpl` is swappable so tests never spend credits.
async function suggest({ text, recent }, env, fetchImpl = fetch) {
  const start = String(text || "").slice(0, MAX_TEXT);
  const context = (Array.isArray(recent) ? recent : []).filter((r) => typeof r === "string").slice(0, MAX_RECENT).map((r) => r.slice(0, 80));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${OPENAI_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        max_completion_tokens: 300,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ start, recent_tasks: context }) },
        ],
      }),
    });
    if (!res.ok) return { completion: "", error: `openai_${res.status}` };
    const data = await res.json();
    const raw = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
    return { completion: cleanCompletion(start, raw) };
  } catch (e) {
    return { completion: "", error: e.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Limits ----------
function createLimiter(dailyLimit, now = () => Date.now()) {
  let minuteStart = now(), minuteCount = 0, day = new Date(now()).toDateString(), dayCount = 0;
  return function allow() {
    const t = now();
    if (t - minuteStart >= 60000) { minuteStart = t; minuteCount = 0; }
    const today = new Date(t).toDateString();
    if (today !== day) { day = today; dayCount = 0; }
    if (minuteCount >= PER_MINUTE_LIMIT) return "minute";
    if (dayCount >= dailyLimit) return "daily";
    minuteCount++; dayCount++;
    return "ok";
  };
}

// ---------- Static files ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };
// Maps a URL path to a file inside docs/, refusing anything that escapes it.
function safePath(root, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split("?")[0]); } catch (e) { return null; }
  const full = path.normalize(path.join(root, p));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function createServer(env, fetchImpl = fetch) {
  const aiOn = Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL);
  const allow = createLimiter(Number(env.AI_DAILY_LIMIT) || 300);
  return http.createServer(async (req, res) => {
    const url = req.url || "/";
    if (url === "/" || url === "/index.html") { res.writeHead(302, { Location: "/app/" }); return res.end(); }
    if (url.startsWith("/api/health")) return send(res, 200, { ai: aiOn });
    if (url.startsWith("/api/suggest")) {
      if (req.method !== "POST") return send(res, 405, { error: "method" });
      if (!aiOn) return send(res, 503, { completion: "", error: "ai_off" });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: "bad_request" }); }
      const text = typeof body.text === "string" ? body.text : "";
      if (text.trim().length < 3 || text.length > MAX_TEXT) return send(res, 400, { error: "bad_text" });
      const verdict = allow();
      if (verdict !== "ok") return send(res, 429, { completion: "", error: verdict === "daily" ? "daily_limit" : "slow_down" });
      return send(res, 200, await suggest(body, env, fetchImpl));
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method" });
    let file = safePath(ROOT, url);
    if (!file) return send(res, 403, "Forbidden", "text/plain");
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      const data = fs.readFileSync(file);
      return send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
    } catch (e) {
      return send(res, 404, "Not found", "text/plain");
    }
  });
}

async function listModels(env) {
  if (!env.OPENAI_API_KEY) { console.log("No OPENAI_API_KEY in .env yet."); return; }
  const res = await fetch(`${OPENAI_URL}/models`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
  if (!res.ok) { console.log(`OpenAI said ${res.status}. Check the key in .env.`); return; }
  const ids = ((await res.json()).data || []).map((m) => m.id).sort();
  console.log("Models your key can use (pick a fast, low-cost one, often named mini or nano):\n  " + ids.join("\n  "));
}

if (require.main === module) {
  const env = loadEnv();
  if (process.argv.includes("--models")) {
    listModels(env).catch((e) => console.log("Could not reach OpenAI: " + e.message));
  } else {
    createServer(env).listen(PORT, "127.0.0.1", () => {
      const ai = env.OPENAI_API_KEY && env.OPENAI_MODEL ? `on (model: ${env.OPENAI_MODEL}, daily limit: ${Number(env.AI_DAILY_LIMIT) || 300})`
        : env.OPENAI_API_KEY ? "off: set OPENAI_MODEL in .env (run: node server.js --models)" : "off: no OPENAI_API_KEY in .env";
      console.log(`DailyQuest is running at http://localhost:${PORT}/app/`);
      console.log(`AI suggestions: ${ai}`);
      console.log("Press Ctrl+C to stop.");
    });
  }
}

module.exports = { parseEnv, cleanCompletion, suggest, createLimiter, safePath, createServer, SYSTEM_PROMPT };
