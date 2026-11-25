// Battles and the Tavern Champion: the display rules that mirror supabase/battles.sql.
// (Who wins and what is paid is decided in the database; that is tested there, see SECURITY.md.)
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, plain } = require("./helpers");

const { app, run } = loadApp();
const TODAY = "2026-11-25";

test("XP per battle day is capped at 150, like the server", () => {
  const s = app.newState();
  s.quests = [
    { id: 1, done: true, completedOn: "2026-11-24", xpEarned: 120 },
    { id: 2, done: true, completedOn: "2026-11-25", xpEarned: 100 },
    { id: 3, done: true, completedOn: "2026-11-25", xpEarned: 90 },
  ];
  assert.deepEqual(plain(app.battleDayXp(s, ["2026-11-25", "2026-11-24", "2026-11-23"])), { "2026-11-25": 150, "2026-11-24": 120, "2026-11-23": 0 });
  assert.equal(run("BATTLE_DAILY_CAP"), 150);
});

test("battle phases: waiting, expired invites, scheduled, active, over", () => {
  const now = Date.parse("2026-11-25T15:00:00Z");
  assert.equal(app.battlePhase({ status: "waiting", created_at: "2026-11-24T15:00:00Z" }, TODAY, now), "waiting");
  assert.equal(app.battlePhase({ status: "waiting", created_at: "2026-11-22T15:00:00Z" }, TODAY, now), "expired", "invites last 2 days");
  const b = { status: "active", start_day: "2026-11-26", end_day: "2026-11-28" };
  assert.equal(app.battlePhase(b, "2026-11-25"), "scheduled", "starts the day after the first acceptance");
  assert.equal(app.battlePhase(b, "2026-11-26"), "active");
  assert.equal(app.battleDayNumber(b, "2026-11-27"), 2);
  assert.equal(app.battlePhase(b, "2026-11-28"), "active", "the last day still counts");
  assert.equal(app.battlePhase(b, "2026-11-29"), "over");
});

test("standings: most XP first, ties share the better place, invited/declined players aren't ranked", () => {
  const st = plain(app.battleStandings([
    { name: "Ana", status: "accepted", xp: 120 }, { name: "Me", status: "accepted", xp: 80, me: true },
    { name: "Bo", status: "accepted", xp: 120 }, { name: "Cy", status: "invited", xp: 0 }, { name: "Di", status: "declined", xp: 0 },
  ]));
  assert.deepEqual(st.map((p) => [p.name, p.place]), [["Ana", 1], ["Bo", 1], ["Me", 3]]);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(app.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
});

test("Tavern Champion: last week's top XP among me and friends; nobody if everyone had 0", () => {
  const last = "2026-11-16";
  const friends = [
    { id: 1, status: "accepted", name: "Ana", last_week: last, last_week_xp: 300 },
    { id: 2, status: "accepted", name: "Bo", last_week: "2026-11-09", last_week_xp: 900 },   // an older week doesn't count
    { id: 3, status: "pending", name: "Cy", last_week: null, last_week_xp: null },
  ];
  assert.deepEqual(plain(app.tavernChampions({ name: "Me", last_week: last, last_week_xp: 120 }, friends, last)).map((p) => p.name), ["Ana"]);
  assert.deepEqual(plain(app.tavernChampions({ name: "Me", last_week: last, last_week_xp: 300 }, friends, last)).map((p) => p.name), ["Me", "Ana"], "a tie crowns both");
  assert.deepEqual(plain(app.tavernChampions({ name: "Me", last_week: last, last_week_xp: 0 }, [], last)), []);
});

test("old saves without battle wins still load with 0", () => {
  assert.equal(app.newState().battleWins, 0);
});
