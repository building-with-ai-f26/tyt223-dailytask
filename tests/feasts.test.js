// Tavern feasts and the Tavern Champion: the display rules that mirror supabase/feasts.sql.
// (The score and rewards are decided in the database; that is tested there, see SECURITY.md.)
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, plain } = require("./helpers");

const { app, run } = loadApp();
const TODAY = "2026-11-25";

test("XP per feast day is capped at 150 per person, like the server", () => {
  const s = app.newState();
  s.quests = [
    { id: 1, done: true, completedOn: "2026-11-24", xpEarned: 120 },
    { id: 2, done: true, completedOn: "2026-11-25", xpEarned: 100 },
    { id: 3, done: true, completedOn: "2026-11-25", xpEarned: 90 },
  ];
  assert.deepEqual(plain(app.feastDayXp(s, ["2026-11-25", "2026-11-24", "2026-11-23"])), { "2026-11-25": 150, "2026-11-24": 120, "2026-11-23": 0 });
  assert.equal(run("FEAST_DAILY_CAP"), 150);
});

test("feast phases: waiting, expired invitations, scheduled, active, over", () => {
  const now = Date.parse("2026-11-25T15:00:00Z");
  assert.equal(app.feastPhase({ status: "waiting", created_at: "2026-11-24T15:00:00Z" }, TODAY, now), "waiting");
  assert.equal(app.feastPhase({ status: "waiting", created_at: "2026-11-22T15:00:00Z" }, TODAY, now), "expired", "invitations last 2 days");
  const f = { status: "active", start_day: "2026-11-26", end_day: "2026-11-28" };
  assert.equal(app.feastPhase(f, "2026-11-25"), "scheduled", "begins the day after the first yes");
  assert.equal(app.feastPhase(f, "2026-11-26"), "active");
  assert.equal(app.feastDayNumber(f, "2026-11-27"), 2);
  assert.equal(app.feastPhase(f, "2026-11-28"), "active", "the last day still counts");
  assert.equal(app.feastPhase(f, "2026-11-29"), "over");
});

test("the shared table: everyone's XP adds up toward 60 XP per person per day", () => {
  const two = plain(app.feastTable([{ name: "Me", status: "accepted", xp: 105, me: true }, { name: "Ana", status: "accepted", xp: 140 }, { name: "Cy", status: "invited", xp: 0 }]));
  assert.deepEqual([two.total, two.goal, two.plates, two.dishes, two.full], [245, 360, 6, 4, false], "invited guests don't count yet");
  const three = plain(app.feastTable([{ status: "accepted", xp: 200 }, { status: "accepted", xp: 200 }, { status: "accepted", xp: 200 }]));
  assert.deepEqual([three.goal, three.plates, three.dishes, three.full], [540, 9, 9, true]);
});

test("rewards are the same for everyone: full 40, half 15, otherwise 5", () => {
  assert.equal(app.feastReward(360, 360), 40);
  assert.equal(app.feastReward(180, 360), 15);
  assert.equal(app.feastReward(179, 360), 5);
});

test("the thank-you line lists what each guest brought, biggest first", () => {
  assert.equal(app.feastThanks([{ name: "Jordan", status: "accepted", xp: 95 }, { name: "Me", status: "accepted", xp: 105, me: true }, { name: "Ana", status: "accepted", xp: 140 }, { name: "Cy", status: "invited", xp: 0 }]),
    "Ana brought 140 XP · you 105 · Jordan 95");
  assert.equal(app.feastThanks([{ name: "Me", status: "accepted", xp: 50, me: true }, { name: "Ana", status: "accepted", xp: 10 }]), "You brought 50 XP · Ana 10");
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

test("the app no longer talks about battles, and new saves count feast badges", () => {
  const { html } = loadApp();
  assert.doesNotMatch(html.replace(/p_battle/g, ""), /battle/i, "battle wording or code left in the app");
  assert.equal(app.newState().feastBadges, 0);
});
