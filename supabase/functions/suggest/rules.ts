// AI typing suggestions: pure rules, no imports, so they run in the Edge Function (Deno) and in Node tests.
// Same behavior as server.js (the local helper), so the app works the same way with either.

export const MAX_TEXT = 120;
export const MAX_RECENT = 15;
export const SYSTEM_PROMPT = [
  "You complete task names for a busy MBA student's to-do planner, like Gmail Smart Compose.",
  "You get the start of a task and a few of the student's recent tasks for context.",
  "Reply with ONLY the text that should be appended to the start to finish the task name naturally, at most 8 words.",
  "Include a leading space if the next word is a new word. Never repeat the start. No quotes, no explanations, no trailing period.",
  "If the start already looks like a complete task, reply with nothing.",
].join(" ");

// Checks what the app sent. Returns { text, recent } or { error }.
export function readInput(body) {
  const text = body && typeof body.text === "string" ? body.text : "";
  if (text.trim().length < 3 || text.length > MAX_TEXT) return { error: "bad_text" };
  const recent = (Array.isArray(body.recent) ? body.recent : []).filter((r) => typeof r === "string").slice(0, MAX_RECENT).map((r) => r.slice(0, 80));
  return { text, recent };
}

// The OpenAI request. Reasoning models (gpt-5*, o*) get minimal reasoning so suggestions stay fast and cheap.
export function openAiRequest(model, text, recent) {
  const req = {
    model,
    max_completion_tokens: /^(gpt-5|o\d)/.test(model) ? 400 : 40,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify({ start: text, recent_tasks: recent }) }],
  };
  if (/^(gpt-5|o\d)/.test(model)) req.reasoning_effort = "minimal";
  return req;
}

// Turns the model's reply into a short, safe piece of text to append after `start` (same as server.js).
export function cleanCompletion(start, raw) {
  let s = String(raw || "").replace(/[\r\n]+/g, " ").replace(/^["'`]+|["'`]+$/g, "");
  if (s.trim().toLowerCase().startsWith(start.trim().toLowerCase()) && start.trim()) s = s.trim().slice(start.trim().length);
  s = s.replace(/[.\s]+$/, "");
  if (!s.trim()) return "";
  if (/\s$/.test(start)) s = s.replace(/^\s+/, "");
  else if (/^\w/.test(s) && /\w$/.test(start) && s.length > 2 && /^[A-Z]/.test(s)) s = " " + s;
  return s.slice(0, 60);
}
