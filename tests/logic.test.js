// Game rules: XP, streaks, shields, levels, rewards, weekly goals, routines, rescheduling, editing, sync choice.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, plain } = require("./helpers");

const { app, run } = loadApp();
run("random = () => 0");          // the daily loot chest always pays the minimum (5 coins)
const TODAY = "2026-11-25";       // a Wednesday
const day = (n) => app.addDays(TODAY, n);
const quest = (s, extra) => app.addQuest(s, Object.assign({ name: "Pay bill", category: "Personal", difficulty: "Easy", date: TODAY, dateType: "day" }, extra), TODAY);

test("XP per quest: 10 / 25 / 50, plus 10 for Recruiting", () => {
  assert.equal(app.questXp({ difficulty: "Easy", category: "Personal" }), 10);
  assert.equal(app.questXp({ difficulty: "Medium", category: "Class" }), 25);
  assert.equal(app.questXp({ difficulty: "Hard", category: "Events" }), 50);
  assert.equal(app.questXp({ difficulty: "Easy", category: "Recruiting" }), 20);
});

test("completing a quest pays XP and the daily chest, starts a streak, and can't be repeated", () => {
  const s = app.newState(), q = quest(s);
  const r = app.completeQuest(s, q.id, TODAY);
  assert.equal(r.xp, 10);
  assert.equal(r.chest, 5);
  assert.equal(s.lifetimeXp, 10);
  assert.equal(s.spendableXp, 15, "XP plus chest coins");
  assert.equal(s.streak, 1);
  assert.equal(q.done, true);
  assert.equal(q.completedOn, TODAY);
  assert.equal(q.xpEarned, 10);
  assert.equal(app.completeQuest(s, q.id, TODAY), null, "a finished quest can't be finished again");
});

test("only the day's first quest opens the chest and pays the streak bonus", () => {
  const s = app.newState();
  Object.assign(s, { streak: 3, bestStreak: 3, lastCompletedOn: day(-1) });
  const first = app.completeQuest(s, quest(s).id, TODAY);
  assert.equal(first.bonus, 5);
  assert.equal(first.xp, 15);
  assert.equal(s.streak, 4);
  assert.equal(s.bestStreak, 4);
  const second = app.completeQuest(s, quest(s).id, TODAY);
  assert.equal(second.bonus, 0);
  assert.equal(second.chest, 0);
  assert.equal(s.streak, 4, "the streak counts days, not quests");
});

test("a streak shield covers one missed day; a longer gap restarts the streak", () => {
  const s = app.newState();
  Object.assign(s, { streak: 6, bestStreak: 6, lastCompletedOn: day(-2), shields: 1 });
  assert.equal(app.currentStreak(s, TODAY), 6, "still alive thanks to the shield");
  const r = app.completeQuest(s, quest(s).id, TODAY);
  assert.equal(r.shieldUsed, true);
  assert.equal(s.shields, 0);
  assert.equal(s.streak, 7);

  const t = app.newState();
  Object.assign(t, { streak: 6, lastCompletedOn: day(-3) });
  assert.equal(app.currentStreak(t, TODAY), 0);
  app.completeQuest(t, quest(t).id, TODAY);
  assert.equal(t.streak, 1);
});

test("levels: every 100 lifetime XP; spending coins never lowers the level", () => {
  assert.equal(app.levelOf(0), 1);
  assert.equal(app.levelOf(99), 1);
  assert.equal(app.levelOf(100), 2);
  const s = app.newState();
  s.lifetimeXp = 95;
  const r = app.completeQuest(s, quest(s).id, TODAY);
  assert.deepEqual([r.levelBefore, r.levelAfter], [1, 2]);
  const reward = app.addReward(s, "Boba run", 10);
  assert.equal(app.claimReward(s, reward.id, TODAY), true);
  assert.equal(app.levelOf(s.lifetimeXp), 2);
});

test("rewards: can't claim without enough coins; claiming records it", () => {
  const s = app.newState();
  const r = app.addReward(s, "Fancy NYC brunch", 100);
  assert.equal(r.art, "pancake", "brunch gets the pancake picture");
  assert.equal(app.claimReward(s, r.id, TODAY), false);
  s.spendableXp = 120;
  assert.equal(app.claimReward(s, r.id, TODAY), true);
  assert.equal(s.spendableXp, 20);
  assert.deepEqual(plain(s.claims), [{ name: "Fancy NYC brunch", cost: 100, date: TODAY }]);
});

test("streak shields cost 150 coins and you can hold at most 2", () => {
  const s = app.newState();
  s.spendableXp = 1000;
  assert.equal(app.buyShield(s, TODAY), true);
  assert.equal(app.buyShield(s, TODAY), true);
  assert.equal(app.buyShield(s, TODAY), false);
  assert.equal(s.shields, 2);
  assert.equal(s.spendableXp, 700);
});

test("new quests: past dates land on today; 'due' sets a due date", () => {
  const s = app.newState();
  assert.equal(quest(s, { date: day(-3) }).day, TODAY);
  const due = quest(s, { date: day(2), dateType: "due" });
  assert.equal(due.day, day(2));
  assert.equal(due.dueDate, day(2));
  assert.equal(app.isOverdue(Object.assign({}, due, { dueDate: day(-1) }), TODAY), true);
});

test("unfinished quests roll over to today; finished ones stay put", () => {
  const s = app.newState();
  const open = quest(s), done = quest(s);
  open.day = day(-2); done.day = day(-2); done.done = true;
  assert.equal(app.rollOver(s, TODAY), true);
  assert.equal(open.day, TODAY);
  assert.equal(done.day, day(-2));
  assert.equal(app.rollOver(s, TODAY), false, "nothing left to move");
});

test("weekly goals: the last check-in of the week pays a 25 XP bonus, then no more", () => {
  const s = app.newState();
  const g = app.addGoal(s, { name: "Exercise", category: "Personal", difficulty: "Medium", target: 3, days: null });
  const a = app.checkInGoal(s, g.id, TODAY), b = app.checkInGoal(s, g.id, TODAY), c = app.checkInGoal(s, g.id, TODAY);
  assert.deepEqual([a.xp, b.xp, c.xp], [25, 25, 50]);
  assert.equal(c.finishesWeek, true);
  assert.equal(s.weeklyGoalsDone, 1);
  assert.equal(app.checkInGoal(s, g.id, TODAY), null, "target reached for this week");
  assert.equal(app.goalWeekCount(g, day(7)), 0, "next week starts fresh");
});

test("routines are due only on their days, once per day", () => {
  const s = app.newState();
  const g = app.addGoal(s, { name: "Gym", category: "Personal", difficulty: "Easy", target: null, days: [3] });   // Wednesdays
  assert.equal(app.routineDue(g, TODAY), true);
  assert.equal(app.routineDue(g, day(1)), false);
  assert.ok(app.checkInGoal(s, g.id, TODAY));
  assert.equal(app.checkInGoal(s, g.id, TODAY), null);
  assert.equal(app.repeatLabel(g), "Every Wed");
});

test("a day is cleared once every quest and routine due today is done", () => {
  const s = app.newState();
  const q = quest(s);
  assert.equal(app.checkDayCleared(s, TODAY), false);
  app.completeQuest(s, q.id, TODAY);
  assert.equal(app.checkDayCleared(s, TODAY), true);
  assert.equal(s.daysCleared, 1);
  assert.equal(app.checkDayCleared(s, TODAY), false, "counted only once");
});

test("rescheduling: tomorrow / next week, and a due date never ends up before the quest", () => {
  assert.equal(app.rescheduleTarget("tomorrow", TODAY), day(1));
  assert.equal(app.rescheduleTarget("next-week", TODAY), "2026-11-30", "next Monday");
  const s = app.newState();
  const q = quest(s, { date: TODAY, dateType: "due" });
  assert.equal(app.rescheduleQuest(s, q.id, day(3), TODAY), true);
  assert.equal(q.day, day(3));
  assert.equal(q.dueDate, day(3));
  q.done = true;
  assert.equal(app.rescheduleQuest(s, q.id, day(4), TODAY), false, "finished quests don't move");
});

test("editing: a quest set to repeat becomes a routine, and back", () => {
  const s = app.newState();
  const q = quest(s, { name: "Read" });
  app.applyEdit(s, "quest", q.id, { name: "Read", category: "Personal", difficulty: "Easy", repeat: "daily" }, TODAY);
  assert.equal(s.quests.length, 0);
  assert.deepEqual(plain(s.goals[0].days), [0, 1, 2, 3, 4, 5, 6]);
  app.applyEdit(s, "goal", s.goals[0].id, { name: "Read", category: "Personal", difficulty: "Easy", repeat: "none" }, TODAY);
  assert.equal(s.goals.length, 0);
  assert.equal(s.quests[0].name, "Read");
});

test("login sync never overwrites both sides silently", () => {
  const cloud = { data: {}, updated_at: "t2" };
  assert.equal(app.syncPlan(null, { user: null, pending: true }, "u1"), "upload", "no account copy yet");
  assert.equal(app.syncPlan(cloud, { user: "u1", syncedAt: "t2", pending: false }, "u1"), "none");
  assert.equal(app.syncPlan(cloud, { user: "u1", syncedAt: "t1", pending: false }, "u1"), "download");
  assert.equal(app.syncPlan(cloud, { user: "u1", syncedAt: "t2", pending: true }, "u1"), "upload");
  assert.equal(app.syncPlan(cloud, { user: "u1", syncedAt: "t1", pending: true }, "u1"), "ask", "both changed: the player chooses");
  assert.equal(app.syncPlan(cloud, { user: "someone-else", pending: true }, "u1"), "download");
  assert.equal(app.syncPlan(cloud, { user: null, pending: true }, "u1"), "ask");
});

test("login form checks", () => {
  assert.equal(app.authProblem("login", "not-an-email", "x"), "Enter a valid email address.");
  assert.equal(app.authProblem("signup", "a@b.co", "short"), "Use at least 8 characters for your password.");
  assert.equal(app.authProblem("signup", "a@b.co", "longenough"), "");
  assert.equal(app.authProblem("reset", "a@b.co", ""), "");
  assert.equal(app.friendlyAuthError({ message: "Invalid login credentials" }), "That email and password don't match.");
});

test("typing suggestions from history complete only what's missing", () => {
  const names = ["Send thank-you note to Priya", "Submit Problem Set 3"];
  assert.equal(app.historySuggestion("send th", names), "ank-you note to Priya");
  assert.equal(app.historySuggestion("Sub", names), "mit Problem Set 3");
  assert.equal(app.historySuggestion("s", names), "", "needs 2+ characters");
  assert.equal(app.historySuggestion("zzz", names), "");
  const s = app.newState();
  quest(s, { name: "Older" }); quest(s, { name: "Newer" });
  assert.deepEqual(plain(app.suggestionSources(s, [{ text: "Template ___" }])), ["Newer", "Older", "Template ___"], "newest first, then templates");
});

test("sample data has quests, routines, rewards and a week of classes", () => {
  const s = app.sampleState(TODAY);
  assert.ok(s.quests.length >= 5);
  assert.ok(s.goals.length >= 2);
  assert.ok(s.rewards.length >= 4);
  assert.ok(s.events.length >= 7);
});
