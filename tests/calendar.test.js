// Calendars: .ics import, connected-calendar rules, calendar -> quests, holidays, reminder timing.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, plain, importFunctionFile } = require("./helpers");

const { app } = loadApp();
const TODAY = "2026-11-25";   // a Wednesday
const ics = (...events) => ["BEGIN:VCALENDAR", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

test(".ics: a timed event, an all-day event, escapes and folded lines", () => {
  const text = ics(
    ["UID:a1", "SUMMARY:Problem Set", "  3 - Due", "LOCATION:KMC 2-60\\, NYU", "DTSTART:20261201T150000", "DTEND:20261201T160000"],
    ["UID:a2", "SUMMARY:Thanksgiving break", "DTSTART;VALUE=DATE:20261126"],
  );
  const events = plain(app.parseIcs(text, TODAY));
  const ps = events.find((e) => e.key.startsWith("a1"));
  assert.equal(ps.title, "Problem Set 3 - Due", "a folded line is joined");
  assert.equal(ps.location, "KMC 2-60, NYU", "\\, becomes a comma");
  assert.deepEqual([ps.date, ps.start, ps.end], ["2026-12-01", "15:00", "16:00"]);
  const allDay = events.find((e) => e.key.startsWith("a2"));
  assert.deepEqual([allDay.date, allDay.start], ["2026-11-26", null]);
});

test(".ics: past and cancelled events are skipped", () => {
  const events = plain(app.parseIcs(ics(
    ["UID:old", "SUMMARY:Old", "DTSTART:20260101T090000"],
    ["UID:gone", "SUMMARY:Cancelled", "STATUS:CANCELLED", "DTSTART:20261201T090000"],
    ["UID:ok", "SUMMARY:Upcoming", "DTSTART:20261201T090000"],
  ), TODAY));
  assert.deepEqual(events.map((e) => e.title), ["Upcoming"]);
});

test(".ics: weekly classes with COUNT, skipped dates and one moved session", () => {
  const events = plain(app.parseIcs(ics(
    ["UID:cls", "SUMMARY:Valuation", "DTSTART:20261118T180000", "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE:20261125T180000"],
    ["UID:cls", "SUMMARY:Valuation (moved)", "RECURRENCE-ID:20261202T180000", "DTSTART:20261203T180000"],
  ), TODAY));
  const cls = events.find((e) => e.title === "Valuation");
  assert.equal(cls.rule.until, "2026-12-09", "COUNT=4 from Nov 18 ends Dec 9");
  assert.ok(cls.exdates.includes("2026-11-25"), "skipped date");
  assert.ok(cls.exdates.includes("2026-12-02"), "the moved session is removed from the series");
  assert.equal(app.occursOn(cls, "2026-12-09"), true);
  assert.equal(app.occursOn(cls, "2026-11-25"), false);
  assert.equal(app.occursOn(cls, "2026-12-16"), false, "after the 4th session");
});

test("connected calendars: only known calendar sites, https only; webcal links are accepted", () => {
  assert.equal(app.normalizeFeedUrl("webcal://p01-calendars.icloud.com/x.ics"), "https://p01-calendars.icloud.com/x.ics");
  assert.ok(app.normalizeFeedUrl("https://calendar.google.com/calendar/ical/x/basic.ics"));
  assert.ok(app.normalizeFeedUrl("https://brightspace.nyu.edu/d2l/le/calendar/feed/user/feed.ics"));
  for (const bad of ["http://calendar.google.com/x", "https://evil.example/x.ics", "https://brightspace.attacker.com/x", "https://user:pw@calendar.google.com/x", "https://calendar.google.com:8443/x", "javascript:alert(1)", ""]) {
    assert.equal(app.normalizeFeedUrl(bad), "", "refused: " + bad);
  }
});

test("deadline names become quests; start dates and normal events don't", () => {
  assert.equal(app.deadlineName("Problem Set 3 - Due"), "Submit Problem Set 3");
  assert.equal(app.deadlineName("Quiz 2 - Availability Ends"), "Finish Quiz 2");
  assert.equal(app.deadlineName("Quiz 2 - Availability Starts"), "");
  assert.equal(app.deadlineName("Lunch with Sam"), "");
  assert.equal(app.followUpPerson("Coffee chat with Jane Doe"), "Jane Doe");
  assert.equal(app.followUpPerson("Interview with Bain @ 3pm"), "Bain");
  assert.equal(app.followUpPerson("Marketing Strategy"), "");
});

test("calendar -> quests: created once, deleted ones stay deleted, moved deadlines move", () => {
  const s = app.newState(), feed = { id: "f1" };
  const ev = (key, title, date, extra) => Object.assign({ key, title, date, start: null, rule: null }, extra);
  let events = [ev("k1", "Problem Set 3 - Due", "2026-11-27"), ev("k2", "Coffee chat with Jane", "2026-11-26"),
    ev("k3", "Valuation", "2026-11-25", { rule: { freq: "WEEKLY" } }), ev("k4", "Final Paper - Due", "2027-03-01")];
  let r = plain(app.syncAutoQuests(s, feed, events, TODAY));
  assert.equal(r.created, 2, "repeating classes and deadlines beyond 60 days are ignored");
  const names = s.quests.map((q) => q.name);
  assert.ok(names.includes("Submit Problem Set 3"));
  assert.ok(names.includes("Send thank-you note to Jane"));
  assert.equal(s.quests.find((q) => q.name.startsWith("Send")).day, "2026-11-27", "thank-you the day after");

  assert.equal(plain(app.syncAutoQuests(s, feed, events, TODAY)).created, 0, "no duplicates on refresh");

  events = [ev("k1", "Problem Set 3 - Due", "2026-11-30"), events[1]];
  r = plain(app.syncAutoQuests(s, feed, events, TODAY));
  assert.equal(r.updated, 1);
  assert.equal(s.quests.find((q) => q.autoKey === "k1").dueDate, "2026-11-30", "deadline moved");

  s.autoDismissed = ["k1"];
  s.quests = s.quests.filter((q) => q.autoKey !== "k1");
  assert.equal(plain(app.syncAutoQuests(s, feed, events, TODAY)).created, 0, "a deleted quest never comes back");

  r = plain(app.syncAutoQuests(s, feed, [], TODAY));
  assert.ok(s.quests.some((q) => q.name.startsWith("Send thank-you")), "thank-you notes stay even if the chat is gone");
});

test("removing a calendar keeps finished auto-quests and drops its events", () => {
  const s = app.newState();
  s.feeds = [{ id: "f1" }];
  s.events = [{ key: "a", source: "feed:f1" }, { key: "b", source: "import" }];
  s.quests = [{ id: 1, autoFrom: "f1", done: true }, { id: 2, autoFrom: "f1", done: false }];
  app.removeFeed(s, "f1");
  assert.deepEqual(plain(s.quests).map((q) => q.id), [1]);
  assert.deepEqual(plain(s.events).map((e) => e.key), ["b"]);
});

test("US holidays: national and New York ones, no duplicates", () => {
  const out = plain(app.holidaysToEvents([
    { date: "2026-11-26", name: "Thanksgiving Day", global: true },
    { date: "2026-11-26", name: "Thanksgiving Day", global: true },
    { date: "2026-02-12", name: "Lincoln's Birthday", global: false, counties: ["US-NY", "US-CT"] },
    { date: "2026-03-02", name: "Texas Independence Day", global: false, counties: ["US-TX"] },
  ]));
  assert.deepEqual(out.map((e) => e.title), ["Thanksgiving Day", "Lincoln's Birthday"]);
  assert.equal(out[0].source, "holiday");
});

test("reminders: 8 AM summary and 30 minutes before timed quests, in the user's time zone", async () => {
  const { remindersFor } = await importFunctionFile("send-reminders/reminders.ts");
  const state = { dayOffset: 0, goals: [], quests: [
    { id: 1, name: "Coffee chat", day: TODAY, time: "09:00", done: false },
    { id: 2, name: "Pay bill", day: TODAY, time: null, done: false },
    { id: 3, name: "Done already", day: TODAY, time: "09:00", done: true },
  ] };
  const at = (utc) => remindersFor(state, Date.parse(utc), "America/New_York").map((n) => n.key.split(":")[0]);
  assert.deepEqual(at("2026-11-25T13:40:00Z"), ["morning", "soon"], "8:40 AM in New York");
  assert.deepEqual(at("2026-11-25T17:00:00Z"), [], "noon: nothing due");
  const morning = remindersFor(state, Date.parse("2026-11-25T13:10:00Z"), "America/New_York")[0];
  assert.match(morning.body, /^2 quests today/, "finished quests aren't counted");
});
