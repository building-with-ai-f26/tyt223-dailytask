// Typed quests in plain English -> name, date, time, repeat, category, difficulty (no AI involved).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, plain } = require("./helpers");

const { app } = loadApp();
const TODAY = "2026-11-25";   // a Wednesday
const parse = (text) => plain(app.parseEntry(text, TODAY));

test("time: 'at 3pm', and 'at 3' means the afternoon", () => {
  const p = parse("coffee chat at 3pm");
  assert.equal(p.name, "Coffee chat");
  assert.equal(p.time, "15:00");
  assert.equal(p.category, "Recruiting");
  assert.equal(p.kind, "quest");
  assert.equal(p.date, TODAY);
  assert.equal(parse("call dad at 3").time, "15:00");
  assert.equal(parse("standup 9:30am").time, "09:30");
});

test("impossible times are left in the name instead of guessed", () => {
  const p = parse("meeting at 25:00");
  assert.equal(p.time, null);
});

test("weekly goals: '3 times a week', 'twice a week', 'weekly'", () => {
  const p = parse("exercise 3 times a week");
  assert.equal(p.kind, "goal");
  assert.equal(p.name, "Exercise");
  assert.equal(p.target, 3);
  assert.equal(p.days, null);
  assert.equal(parse("call home twice a week").target, 2);
  assert.equal(parse("laundry weekly").target, 1);
});

test("routines: daily, every weekday, every Monday and Wednesday", () => {
  assert.deepEqual(parse("read daily").days, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parse("gym every weekday").days, [1, 2, 3, 4, 5]);
  const p = parse("call mom every monday and wednesday");
  assert.equal(p.name, "Call mom");
  assert.deepEqual(p.days, [1, 3]);
});

test("due dates: 'due friday', 'by 12/1', with difficulty at the end", () => {
  const p = parse("problem set due friday hard");
  assert.equal(p.name, "Problem set");
  assert.equal(p.dateType, "due");
  assert.equal(p.date, "2026-11-27");
  assert.equal(p.difficulty, "Hard");
  assert.equal(p.category, "Class");
  const q = parse("submit essay by 12/1");
  assert.equal(q.date, "2026-12-01");
  assert.equal(q.dateType, "due");
});

test("days: tomorrow, 'on dec 3', 'next monday', and past months roll to next year", () => {
  const t = parse("dinner with team tomorrow at 7");
  assert.equal(t.date, "2026-11-26");
  assert.equal(t.time, "19:00");
  assert.equal(t.category, "Events");
  assert.equal(parse("pay rent on dec 3").date, "2026-12-03");
  const n = parse("next monday team sync");
  assert.equal(n.date, "2026-11-30");
  assert.equal(n.name, "Team sync");
  assert.equal(parse("dentist jan 5").date, "2027-01-05");
});

test("categories are guessed from words; everything else is Personal", () => {
  assert.equal(parse("update resume").category, "Recruiting");
  assert.equal(parse("study for midterm").category, "Class");
  assert.equal(parse("rsvp to gala").category, "Events");
  assert.equal(parse("buy groceries").category, "Personal");
});

test("templates fill the blank; the preview's edits override the guess", () => {
  const t = plain(app.fromTemplate({ text: "Send thank-you note to ___", category: "Recruiting", difficulty: "Easy" }, "Priya", TODAY));
  assert.equal(t.name, "Send thank-you note to Priya");
  assert.equal(t.category, "Recruiting");
  const o = plain(app.applyOverrides(app.parseEntry("read", TODAY), { repeat: "x2", difficulty: "Hard" }));
  assert.deepEqual([o.kind, o.target, o.difficulty], ["goal", 2, "Hard"]);
});
