// DailyQuest reminder rules: which notifications a user should get right now.
// Pure functions with no imports, so they run in the Supabase Edge Function (Deno)
// and in Node tests alike. Mirrors the app's own rules for "Today's Quests".

export const MORNING_HOUR = 8;          // 8:00 AM summary, in the user's own time zone
export const MORNING_LATEST_HOUR = 11;  // if the 8:00 run was missed, still send until 11:00
export const BEFORE_MINUTES = 30;       // remind this long before a timed quest

// The user's local date ("2026-11-21") and minutes since midnight, for a time zone like "America/New_York".
export function localNow(nowMs, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  } catch (e) {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  }
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function toMinutes(t) { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; }
export function fmtTime(t) {
  const [h, m] = String(t).split(":").map(Number);
  return ((h + 11) % 12 + 1) + ":" + String(m).padStart(2, "0") + (h < 12 ? " AM" : " PM");
}

// What's on today's list: unfinished quests for today (or rolled over from earlier days) and routines due today.
export function todaysItems(state, today) {
  const quests = (state.quests || []).filter((q) => !q.done && q.day && q.day <= today)
    .map((q) => ({ key: "q" + q.id, name: q.name, time: q.time || null, overdue: !!q.dueDate && q.dueDate < today }));
  const routines = (state.goals || []).filter((g) => Array.isArray(g.days) && g.days.includes(weekday(today)) && !(g.log || []).some((l) => l.date === today))
    .map((g) => ({ key: "g" + g.id, name: g.name, time: g.time || null, overdue: false }));
  return quests.concat(routines);
}

// Returns the notifications due now: [{ key, title, body }]. `key` is unique per day, so the
// sender can record it and never send the same reminder twice.
export function remindersFor(state, nowMs, timeZone) {
  const local = localNow(nowMs, timeZone);
  const today = addDays(local.date, Number(state.dayOffset) || 0);   // match the app's "Simulate next day"
  const items = todaysItems(state, today);
  const out = [];

  if (items.length && local.minutes >= MORNING_HOUR * 60 && local.minutes < MORNING_LATEST_HOUR * 60) {
    const overdue = items.filter((i) => i.overdue).length;
    const first = items.slice().sort((a, b) => (b.overdue - a.overdue) || ((a.time || "99") < (b.time || "99") ? -1 : (a.time || "99") > (b.time || "99") ? 1 : 0))[0];
    const count = items.length === 1 ? "1 quest today" : `${items.length} quests today`;
    out.push({
      key: "morning:" + today,
      title: "Good morning, adventurer",
      body: count + (overdue ? ` · ${overdue} overdue` : "") + `. First up: ${first.name}${first.time ? " at " + fmtTime(first.time) : ""}`,
    });
  }

  for (const item of items) {
    if (!item.time) continue;
    const at = toMinutes(item.time);
    if (local.minutes >= at - BEFORE_MINUTES && local.minutes < at) {
      out.push({ key: `soon:${item.key}:${today}:${item.time}`, title: `In ${at - local.minutes} min`, body: `${item.name} at ${fmtTime(item.time)}` });
    }
  }
  return out;
}
