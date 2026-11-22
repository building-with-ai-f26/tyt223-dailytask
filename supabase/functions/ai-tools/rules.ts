// DailyQuest AI tools: pure rules for "Paste anything -> quests" and the "Weekly chronicle".
// No imports, so they run in the Edge Function (Deno) and in Node tests. The AI only suggests:
// every answer is checked here before the app sees it, and the app asks the player before adding anything.

export const CATEGORIES = ["Class", "Recruiting", "Events", "Personal"];
export const DIFFICULTIES = ["Easy", "Medium", "Hard"];
export const MAX_PASTE = 4000;
export const MAX_QUESTS = 15;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const tidy = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// ---------- Paste anything -> quests ----------
export function readPaste(body) {
  const text = body && typeof body.text === "string" ? body.text.trim() : "";
  const today = body && isDate(body.today) ? body.today : "";
  if (text.length < 10 || text.length > MAX_PASTE) return { error: "bad_text" };
  if (!today) return { error: "bad_date" };
  return { text, today };
}

export function pasteRequest(model, text, today) {
  const weekday = DAY_NAMES[new Date(today + "T00:00:00Z").getUTCDay()];
  return {
    model,
    max_completion_tokens: 1200,
    response_format: { type: "json_schema", json_schema: { name: "quests", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["quests"],
      properties: { quests: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["name", "date", "time", "category", "difficulty", "deadline"],
        properties: {
          name: { type: "string" }, date: { type: ["string", "null"] }, time: { type: ["string", "null"] },
          category: { type: "string", enum: CATEGORIES }, difficulty: { type: "string", enum: DIFFICULTIES }, deadline: { type: "boolean" },
        },
      } } },
    } } },
    messages: [
      { role: "system", content: [
        "You turn pasted text (emails, course announcements, chat messages, notes) into to-do items for a busy MBA student's quest journal.",
        `Today is ${weekday}, ${today}. Resolve relative dates ("Friday", "next week", "tomorrow") from today.`,
        "Only include things the student must actually do. Skip greetings, signatures, background and events that need no action.",
        "name: a short imperative task under 60 characters, e.g. \"Submit Problem Set 3\" or \"Reply to Bain recruiter\".",
        "date: YYYY-MM-DD for the day it is due or happens, or null if none is given. time: HH:MM (24-hour) or null.",
        "deadline: true if the date is a due date or deadline, false if it is when the thing happens.",
        "category: Class (courses, assignments), Recruiting (jobs, networking, applications), Events (clubs, social, RSVPs) or Personal.",
        "difficulty: Easy (minutes), Medium (an hour or so) or Hard (major work like exams, applications, projects).",
        `Return at most ${MAX_QUESTS} items, most important first. Return an empty list if there is nothing to do.`,
      ].join(" ") },
      { role: "user", content: text },
    ],
  };
}

// Checks and tidies the AI's quests. Anything malformed is dropped or replaced with a safe default.
export function cleanPasteQuests(raw, today) {
  let data;
  try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return []; }
  const list = data && Array.isArray(data.quests) ? data.quests : [];
  const seen = new Set(), out = [];
  for (const q of list) {
    if (!q || typeof q !== "object") continue;
    const name = tidy(q.name, 80);
    if (name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const date = isDate(q.date) && q.date >= addDays(today, -1) && q.date <= addDays(today, 366) ? q.date : null;
    const time = typeof q.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(q.time) ? q.time : null;
    out.push({
      name, date, time,
      category: CATEGORIES.includes(q.category) ? q.category : "Personal",
      difficulty: DIFFICULTIES.includes(q.difficulty) ? q.difficulty : "Medium",
      deadline: q.deadline === true && !!date,
    });
    if (out.length >= MAX_QUESTS) break;
  }
  return out;
}

// ---------- Weekly chronicle ----------
// The app sends only this week's facts. Everything is bounded so a tampered request can't send much.
export function readChronicle(body) {
  const s = body && body.stats && typeof body.stats === "object" ? body.stats : null;
  if (!s) return { error: "bad_stats" };
  const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const names = (a, n) => (Array.isArray(a) ? a : []).filter((x) => typeof x === "string").slice(0, n).map((x) => tidy(x, 60)).filter(Boolean);
  const byCat = {};
  for (const c of CATEGORIES) byCat[c] = num(s.byCategory && s.byCategory[c], 200);
  const stats = {
    weekOf: isDate(s.weekOf) ? s.weekOf : "",
    questsDone: num(s.questsDone, 500), byCategory: byCat, finished: names(s.finished, 8), stillOpen: num(s.stillOpen, 500),
    streak: num(s.streak, 1000), daysCleared: num(s.daysCleared, 7), level: num(s.level, 1000),
    boss: s.boss && typeof s.boss === "object" ? { name: tidy(s.boss.name, 40), defeated: s.boss.defeated === true, hpLeft: num(s.boss.hpLeft, 100), maxHp: num(s.boss.maxHp, 100) } : null,
    landmark: tidy(s.landmark, 40),
    weeklyGoals: (Array.isArray(s.weeklyGoals) ? s.weeklyGoals : []).slice(0, 5).map((g) => ({ name: tidy(g && g.name, 40), done: num(g && g.done, 50), target: num(g && g.target, 50) })).filter((g) => g.name),
  };
  if (!stats.weekOf) return { error: "bad_stats" };
  return { stats };
}

export function chronicleRequest(model, stats) {
  return {
    model,
    max_completion_tokens: 400,
    response_format: { type: "json_schema", json_schema: { name: "chronicle", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["entry", "focus"],
      properties: { entry: { type: "string" }, focus: { type: "string" } },
    } } },
    messages: [
      { role: "system", content: [
        "You are the enchanted quest journal of a busy MBA student, writing this week's chronicle in a warm, elegant fantasy-storybook voice.",
        "Write entry: 70 to 110 words addressed to the hero as \"you\". Celebrate what they really did, mentioning one or two finished quests by name, the weekly boss and their streak if notable.",
        "Use only the facts given; never invent quests, numbers or events. If it was a quiet week, be kind and encouraging, never guilt-inducing. No emojis, no lists.",
        "Write focus: one short, gentle, practical suggestion for next week (under 25 words), based on the facts, such as a category they neglected or open quests.",
      ].join(" ") },
      { role: "user", content: JSON.stringify(stats) },
    ],
  };
}

export function cleanChronicle(raw) {
  let data;
  try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return null; }
  const entry = tidy(data && data.entry, 900), focus = tidy(data && data.focus, 200);
  return entry.length >= 20 ? { entry, focus } : null;
}
