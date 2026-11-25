// The game layer: weekly boss, adventurer gear, adventure map and landmark rewards.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, plain } = require("./helpers");

const { app, run } = loadApp();
run("random = () => 0");
const TODAY = "2026-11-25";   // a Wednesday; the week starts Monday 2026-11-23

test("a new boss appears each Monday with HP between 8 and 40", () => {
  const s = app.newState();
  const boss = app.ensureBoss(s, TODAY);
  assert.equal(boss.week, "2026-11-23");
  assert.equal(boss.hp, 8, "an empty week gets the minimum HP");
  assert.equal(app.ensureBoss(s, "2026-11-29"), boss, "same boss all week");
  assert.equal(app.ensureBoss(s, "2026-11-30").week, "2026-11-30", "new boss next Monday");

  const busy = app.newState();
  for (let i = 0; i < 30; i++) app.addQuest(busy, { name: "Q" + i, category: "Class", difficulty: "Hard", date: TODAY, dateType: "day" }, TODAY);
  assert.equal(app.ensureBoss(busy, TODAY).maxHp, 40, "a huge week is capped at 40");
});

test("finished quests hit the boss (1/2/3 damage); beating it pays 40 coins once", () => {
  const s = app.newState();
  app.ensureBoss(s, TODAY);
  const q = app.addQuest(s, { name: "Exam", category: "Class", difficulty: "Hard", date: TODAY, dateType: "day" }, TODAY);
  const r = app.completeQuest(s, q.id, TODAY);
  assert.equal(r.boss.damage, 3);
  assert.equal(s.boss.hp, 5);
  s.boss.hp = 1;
  const coins = s.spendableXp;
  const hit = app.hitBoss(s, "Easy", TODAY);
  assert.equal(hit.defeated, true);
  assert.equal(hit.loot, 40);
  assert.equal(s.spendableXp, coins + 40);
  assert.equal(s.bossesDefeated, 1);
  assert.equal(app.hitBoss(s, "Easy", TODAY), null, "a beaten boss can't be hit again");
});

test("gear: buy with coins, can't buy twice or without enough, equip toggles", () => {
  const s = app.newState();
  s.spendableXp = 100;
  assert.equal(app.buyGear(s, "owl"), false, "costs 120");
  assert.equal(app.buyGear(s, "slime"), true);
  assert.equal(s.spendableXp, 20);
  assert.equal(s.gear.pet, "slime", "bought gear is put on");
  assert.equal(app.buyGear(s, "slime"), false, "already owned");
  assert.equal(app.buyGear(s, "dragonslayer"), false, "journey-only title isn't for sale");
  assert.equal(app.equipGear(s, "slime"), true);
  assert.equal(s.gear.pet, null, "tapping again takes it off");
  assert.equal(app.equipGear(s, "owl"), false, "can't wear what you don't own");
});

test("the map: one step per cleared day, a landmark every 5 steps, 30 steps per journey", () => {
  const p = plain(app.mapProgress(7));
  assert.deepEqual([p.lap, p.step, p.reached.name, p.next.name, p.toNext], [1, 7, "Whispering Forest", "Moonlit River", 3]);
  const lap2 = plain(app.mapProgress(31));
  assert.deepEqual([lap2.lap, lap2.step], [2, 1]);
});

test("landmark rewards pay once per journey; owned gear pays 50 coins instead", () => {
  const s = app.newState();
  s.daysCleared = 10;
  const paid = plain(app.claimLandmarks(s));
  assert.deepEqual(paid.map((x) => x.name), ["Whispering Forest", "Moonlit River"]);
  assert.ok(s.gear.owned.includes("slime"));
  assert.equal(s.spendableXp, 50);
  assert.deepEqual(plain(app.claimLandmarks(s)), [], "already paid");
  s.daysCleared = 35;   // second journey reaches the forest again; the slime is already owned
  const again = plain(app.claimLandmarks(s));
  assert.ok(again.some((x) => x.name === "Whispering Forest" && /50 coins/.test(x.label)));
});
