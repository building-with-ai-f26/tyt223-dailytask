// Friends (the Tavern): friend codes, hero names, weekly XP, the standings, and what friends can see.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, plain } = require("./helpers");

const { app, run } = loadApp();
const DB_CODE_RULE = /^[A-HJ-NP-Z2-9]{6}$/;   // same check as the profiles table in supabase/friends.sql

test("friend codes: 6 characters, no look-alikes (0/O/1/I), always valid for the database", () => {
  for (let i = 0; i < 2000; i++) assert.match(app.newFriendCode(), DB_CODE_RULE);
  assert.equal(app.newFriendCode(() => 0), "AAAAAA");
  assert.equal(app.newFriendCode(() => 0.9999), "999999");
  assert.doesNotMatch(run("FRIEND_CODE_LETTERS"), /[01OI]/);
});

test("typed codes are trimmed and capitalized; anything else is refused", () => {
  assert.equal(app.friendCodeFrom(" abc234 "), "ABC234");
  for (const bad of ["ABC23", "ABC2345", "ABC10I", "ABC 23", "<scrip", "Ana", "", null]) assert.equal(app.friendCodeFrom(bad), "", "refused: " + bad);
});

test("hero names: 2-20 characters, tidy spaces, no control characters or angle brackets", () => {
  assert.equal(app.cleanHeroName("  Sabrina   T.  "), "Sabrina T.");
  assert.equal(app.cleanHeroName("A"), "");
  assert.equal(app.cleanHeroName("<b>x</b>"), "bx/b");
  assert.equal(app.cleanHeroName("a\u0000\u0007b"), "ab");
  assert.equal(app.cleanHeroName("x".repeat(40)).length, 20);
  assert.equal(app.cleanHeroName("abcdefghijklmnopqrs tuvwxyz"), "abcdefghijklmnopqrs", "no trailing space after cutting");
  assert.equal(app.cleanHeroName("林小美"), "林小美");
});

test("weekly XP counts only quests and check-ins finished Monday to Sunday", () => {
  const s = app.newState();
  s.lifetimeXp = 250; s.avatar = "berry";
  s.quests = [
    { id: 1, done: true, completedOn: "2026-11-22", xpEarned: 40 },   // last Sunday
    { id: 2, done: true, completedOn: "2026-11-23", xpEarned: 25 },
    { id: 3, done: true, completedOn: "2026-11-25", xpEarned: 35 },
    { id: 4, done: false, completedOn: null, xpEarned: 0 },
    { id: 5, done: true, completedOn: "2026-11-30", xpEarned: 50 },   // next Monday
  ];
  s.goals = [{ id: 9, days: null, log: [{ date: "2026-11-24", xp: 10 }, { date: "2026-11-20", xp: 99 }] }];
  assert.equal(app.xpBetween(s, "2026-11-23", "2026-11-29"), 70);
  const card = plain(app.heroCardStats(s, "2026-11-25"));
  assert.deepEqual(card, { avatar: "berry", level: 3, streak: 0, week_xp: 70, week: "2026-11-23" });
});

test("the hero card friends see carries only these five values, never quest names", () => {
  const s = app.sampleState("2026-11-25");
  const card = plain(app.heroCardStats(s, "2026-11-25"));
  assert.deepEqual(Object.keys(card).sort(), ["avatar", "level", "streak", "week", "week_xp"]);
  const text = JSON.stringify(card);
  for (const q of s.quests) assert.ok(!text.includes(q.name), "quest name leaked: " + q.name);
});

test("standings: most XP this week first; old weeks count 0; pending requests aren't listed", () => {
  const board = plain(app.leaderboard({ name: "Me", level: 3, week: "2026-11-23", week_xp: 70 }, [
    { id: 1, status: "accepted", name: "Ana", level: 5, week: "2026-11-23", week_xp: 120 },
    { id: 2, status: "accepted", name: "Bo", level: 9, week: "2026-11-16", week_xp: 900 },
    { id: 3, status: "pending", name: "Cy", level: 2, week: null, week_xp: null },
    { id: 4, status: "accepted", name: "Di", level: 4, week: "2026-11-23", week_xp: 70 },
  ], "2026-11-23"));
  assert.deepEqual(board.map((p) => p.name), ["Ana", "Di", "Me", "Bo"]);
  assert.deepEqual(board.map((p) => p.xpNow), [120, 70, 70, 0]);
  assert.equal(board.find((p) => p.name === "Me").isMe, true);
});

test("adding friends is by code only: no invite links and no name search in the app", () => {
  const { html } = loadApp();
  assert.doesNotMatch(html, /captureInvite|maybeInvite|\?friend=/, "invite links were removed");
  assert.match(html, /searchable: false/, "new cards are hidden from name search");
  assert.match(html, /function findByCode/);
});
