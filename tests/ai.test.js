// AI helpers: input checks and answer cleaning for the Edge Functions, and the local server.js.
// No real OpenAI calls: the server test uses a fake `fetch`, so it never spends credits.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { importFunctionFile } = require("./helpers");
const server = require("../server.js");

const TODAY = "2026-11-25";

test("suggest: input limits and tidy completions", async () => {
  const s = await importFunctionFile("suggest/rules.ts");
  assert.deepEqual(s.readInput({ text: "ab" }), { error: "bad_text" });
  assert.deepEqual(s.readInput({ text: "x".repeat(121) }), { error: "bad_text" });
  assert.equal(s.readInput({ text: "send th", recent: new Array(40).fill("a") }).recent.length, 15);
  assert.equal(s.cleanCompletion("send th", '"ank-you note to Priya."'), "ank-you note to Priya", "quotes and the period go");
  assert.equal(s.cleanCompletion("send th", "send thank-you note"), "ank-you note", "never repeats what was typed");
  assert.equal(s.cleanCompletion("email", "\n"), "");
  assert.ok(s.cleanCompletion("x", "y".repeat(200)).length <= 60);
  assert.equal(s.openAiRequest("gpt-4o-mini", "a", []).max_completion_tokens, 40);
});

test("paste notes: only well-formed quests come back, at most 15", async () => {
  const r = await importFunctionFile("ai-tools/rules.ts");
  assert.deepEqual(r.readPaste({ text: "short", today: TODAY }), { error: "bad_text" });
  assert.deepEqual(r.readPaste({ text: "a long enough paste", today: "nope" }), { error: "bad_date" });
  const out = r.cleanPasteQuests(JSON.stringify({ quests: [
    { name: "Submit Problem Set 3", date: "2026-11-27", time: "23:59", category: "Class", difficulty: "Medium", deadline: true },
    { name: "submit problem set 3", date: null, time: null, category: "Class", difficulty: "Medium", deadline: false },   // duplicate
    { name: "Reply to recruiter\u0000", date: "\"><img src=x onerror=alert(1)>", time: "25:99", category: "Hacker", difficulty: "Extreme", deadline: true },
    { name: "Way in the past", date: "2020-01-01", time: null, category: "Personal", difficulty: "Easy", deadline: false },
    ...Array.from({ length: 30 }, (_, i) => ({ name: "Task " + i, date: null, time: null, category: "Personal", difficulty: "Easy", deadline: false })),
  ] }), TODAY);
  assert.equal(out.length, 15);
  assert.deepEqual(out[0], { name: "Submit Problem Set 3", date: "2026-11-27", time: "23:59", category: "Class", difficulty: "Medium", deadline: true });
  assert.deepEqual(out[1], { name: "Reply to recruiter", date: null, time: null, category: "Personal", difficulty: "Medium", deadline: false }, "bad date, time, category, difficulty are dropped");
  assert.equal(out[2].date, null, "dates far in the past are dropped");
  assert.deepEqual(r.cleanPasteQuests("not json", TODAY), []);
});

test("weekly chronicle: numbers are clamped, names trimmed, short answers refused", async () => {
  const r = await importFunctionFile("ai-tools/rules.ts");
  assert.deepEqual(r.readChronicle({}), { error: "bad_stats" });
  const { stats } = r.readChronicle({ stats: { weekOf: "2026-11-23", questsDone: 99999, streak: -5, finished: ["A", 7, "B".repeat(100)], byCategory: { Class: 3 } } });
  assert.equal(stats.questsDone, 500);
  assert.equal(stats.streak, 0);
  assert.deepEqual(stats.finished, ["A", "B".repeat(60)]);
  assert.equal(r.cleanChronicle(JSON.stringify({ entry: "Too short", focus: "x" })), null);
  assert.ok(r.cleanChronicle(JSON.stringify({ entry: "A quiet but steady week, brave hero.", focus: "Rest." })));
});

test("server.js: static files can't escape docs/, and the limiter counts per minute and per day", () => {
  const root = require("node:path").join(__dirname, "..", "docs");
  assert.ok(server.safePath(root, "/app/index.html"));
  assert.equal(server.safePath(root, "/../.env"), null);
  assert.equal(server.safePath(root, "/%2e%2e/.env"), null);
  let now = Date.parse("2026-11-25T12:00:00");
  const allow = server.createLimiter(3, () => now);
  assert.deepEqual([allow(), allow(), allow(), allow()], ["ok", "ok", "ok", "daily"]);
});

test("server.js: /api/suggest with a fake OpenAI, the daily cap, and AI off without a key", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "ank-you note to Priya" } }] }) });
  const env = { OPENAI_API_KEY: "test-placeholder-not-a-key", OPENAI_MODEL: "gpt-4o-mini", AI_DAILY_LIMIT: "1" };
  const call = (srv, path, body) => new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const req = http.request({ host: "127.0.0.1", port: srv.address().port, path, method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } }, (res) => {
        let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => { srv.close(); resolve({ status: res.statusCode, body: data }); });
      });
      req.end(body ? JSON.stringify(body) : undefined);
    });
  });
  const on = server.createServer(env, fakeFetch);
  const first = await call(on, "/api/suggest", { text: "send th", recent: [] });
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).completion, "ank-you note to Priya");
  const capped = await call(on, "/api/suggest", { text: "send th", recent: [] });
  assert.equal(capped.status, 429, "AI_DAILY_LIMIT=1");
  const off = server.createServer({}, fakeFetch);
  assert.deepEqual(JSON.parse((await call(off, "/api/health")).body), { ai: false });
  assert.equal((await call(server.createServer({}, fakeFetch), "/api/suggest", { text: "send th" })).status, 503);
});
