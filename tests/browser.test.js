// Real-browser checks (headless Edge or Chrome). Skipped automatically when neither is installed.
// Set BROWSER=/path/to/browser to use another Chromium-based browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const { findBrowser, runInBrowser } = require("./browser/harness");

const skip = findBrowser() ? false : "no Edge or Chrome found (set BROWSER=/path/to/browser)";
const allTrue = (out) => {
  assert.ok(out, "no result");
  const bad = Object.entries(out).filter(([k, v]) => v === false || k === "error");
  assert.deepEqual(bad, [], "failed steps: " + JSON.stringify(bad));
};

test("the app opens with sample data; adding and finishing a quest works; every tab renders", { skip, timeout: 120000 }, async () => {
  const out = await runInBrowser({ accounts: "off", driver: `
    const r = {};
    localStorage.clear();
    await until(() => !!q("#captureInput"));
    const sample = q('[data-action="welcome-sample"]'); if (sample) sample.click();
    r.sampleLoaded = await until(() => state.quests.length >= 5);
    const box = q("#captureInput"); box.value = "coffee chat with Jane at 3pm"; box.dispatchEvent(new Event("input", { bubbles: true }));
    q("#captureForm").requestSubmit();
    r.questAdded = await until(() => state.quests.some((x) => x.name === "Coffee chat with Jane" && x.time === "15:00"));
    const xpBefore = state.lifetimeXp;
    const added = state.quests.find((x) => x.name === "Coffee chat with Jane");
    q('[data-action="complete"][data-id="' + added.id + '"]').click();
    r.questCompleted = await until(() => added.done && state.lifetimeXp > xpBefore);
    for (const t of ["week", "tavern", "shop", "profile", "today"]) {
      q('[data-tab="' + t + '"]').click(); await w(80);
      r["tab_" + t] = q('[data-tab="' + t + '"]').classList.contains("active") && q("#view").textContent.trim().length > 20;
    }
    r.tavernWithoutAccounts = (q('[data-tab="tavern"]').click(), await w(50), q("#view").textContent.includes("Friends need accounts"));
    r.noHorizontalScroll = document.documentElement.scrollWidth <= window.innerWidth;
    return r;` });
  allTrue(out);
});

// A pretend Supabase that plays the friends server: one other hero, Ana (code ANA234).
const FAKE_FRIENDS = `
window.__db = { me: null, friends: [], updates: [], inserts: [], rpcs: [] };
window.supabase = { createClient() {
  let cb = null; const session = { user: { id: "u1", email: "me@example.com", app_metadata: { provider: "email" } } };
  setTimeout(() => cb && cb("INITIAL_SESSION", session), 0);
  const ok = (d) => Promise.resolve(Object.assign({ error: null }, d || {}));
  const clone = (x) => x == null ? x : JSON.parse(JSON.stringify(x));
  return {
    auth: { onAuthStateChange(f) { cb = f; return { data: { subscription: { unsubscribe() {} } } }; }, signOut() { setTimeout(() => cb("SIGNED_OUT", null), 0); return ok(); } },
    from(t) { return {
      select() { return { eq() { return { maybeSingle() { return ok({ data: t === "profiles" ? clone(__db.me) : null }); } }; } }; },
      upsert(row) { return { select() { return { single() { return ok({ data: { updated_at: row.updated_at } }); } }; } }; },
      insert(row) { __db.inserts.push(clone(row)); return { select() { return { single() { __db.me = clone(row); return ok({ data: clone(row) }); } }; } }; },
      update(o) { return { eq() { __db.updates.push(clone(o)); Object.assign(__db.me, o); return ok(); } }; },
    }; },
    rpc(name, args) {
      __db.rpcs.push(name + " " + JSON.stringify(args || {}));
      const wk = weekDays(getToday())[0];
      const view = (f) => Object.assign({}, f, f.status === "accepted" ? { week: wk } : { streak: null, week_xp: null, week: null });
      if (name === "friend_list") return ok({ data: __db.friends.map(view) });
      if (name === "find_players") return ok({ data: args.q === "ANA234" ? [{ name: "Ana", code: "ANA234", avatar: "berry", level: 5 }] : [] });
      if (name === "request_friend") { __db.friends.push({ id: 1, status: "pending", incoming: false, name: "Ana", code: "ANA234", avatar: "berry", level: 5, streak: 4, week_xp: 120 }); return ok({ data: "sent" }); }
      if (name === "respond_friend") { const f = __db.friends.find((x) => x.id === args.request_id && x.incoming); if (f) f.status = "accepted"; return ok({ data: !!f }); }
      if (name === "remove_friend") { __db.friends = __db.friends.filter((x) => x.id !== args.request_id); return ok({ data: true }); }
      return ok({ data: null });
    },
  };
} };`;

test("Tavern: add a friend by code only; requests wait for acceptance; nothing private leaves; script names stay text", { skip, timeout: 120000 }, async () => {
  const out = await runInBrowser({ accounts: "fake", fake: FAKE_FRIENDS, query: "?friend=ANA234", driver: `
    const r = {}; const text = () => q("#view").textContent; const toastText = () => q("#toast").textContent;
    r.oldInviteLinkIgnored = tab === "today";
    q('[data-tab="tavern"]').click();
    r.createForm = await until(() => !!q("#heroForm"));
    q("#heroName").value = "  Sabrina   T. "; q("#heroForm").requestSubmit();
    r.cardMade = await until(() => !!q(".code-tag"));
    r.nameTidied = __db.me && __db.me.name === "Sabrina T.";
    r.newCardNotSearchable = __db.inserts[0] && __db.inserts[0].searchable === false;
    r.cardHasOnlyGameNumbers = __db.inserts[0] && Object.keys(__db.inserts[0]).sort().join() === "avatar,code,last_week,last_week_xp,level,name,searchable,streak,user_id,week,week_xp";
    r.noLinkOrNameSearch = !/invite link|find me by/i.test(text());
    q("#friendQuery").value = "Ana"; q("#friendSearch").requestSubmit(); await w(150);
    r.namesRefused = !__db.rpcs.some((x) => x.startsWith("find_players")) && /6 letters/.test(toastText());
    q("#friendQuery").value = __db.me.code; q("#friendSearch").requestSubmit(); await w(150);
    r.ownCodeRefused = /your own code/.test(toastText());
    q("#friendQuery").value = " ana234 "; q("#friendSearch").requestSubmit();
    r.found = await until(() => !!q('[data-action="friend-add"][data-code="ANA234"]'));
    q('[data-action="friend-add"]').click();
    r.requestWaits = await until(() => text().includes("waiting for them to accept") && document.querySelectorAll(".lb-row").length === 1);
    __db.friends.push({ id: 2, status: "pending", incoming: true, name: "<img src=x onerror=window.__xss=1>", code: "EVL777", avatar: "\\"><script>window.__xss=2<\\/script>", level: 2, streak: 1, week_xp: 30 });
    await loadSocial();
    r.redDot = await until(() => !document.getElementById("tavernDot").hidden);
    r.scriptNameIsText = window.__xss === undefined && !q("#view img") && text().includes("<img src=x onerror=window.__xss=1>");
    q('[data-action="friend-accept"]').click();
    r.accepted = await until(() => document.querySelectorAll(".lb-row").length === 2 && document.getElementById("tavernDot").hidden);
    const before = __db.updates.length, today = getToday();
    state.quests.push({ id: 9999, name: "secret quest name", day: today, done: false, category: "Class", difficulty: "Hard", time: null, dueDate: null, xpEarned: 0, completedOn: null });
    completeQuest(state, 9999, today); save();
    r.cardSyncedAfterQuest = await until(() => __db.updates.length > before && __db.updates[__db.updates.length - 1].week_xp > 0, 8000);
    r.questNamesNeverSent = !JSON.stringify(__db.updates).includes("secret quest name");
    r.profileHasThreeChapters = (() => { tab = "profile"; render(); const n = document.querySelectorAll(".ptab").length; tab = "tavern"; render(); return n === 3; })();
    account.client.auth.signOut();
    r.sealedAfterLogout = await until(() => text().includes("The tavern is for members"));
    return r;` });
  allTrue(out);
});

// A pretend Supabase with one friend (Ana) for battles. Dates follow the app's own "today".
const FAKE_BATTLES = `
window.__db = { battles: [], rpcs: [], updates: [], reports: [] };
window.supabase = { createClient() {
  let cb = null; const session = { user: { id: "u1", email: "me@example.com", app_metadata: { provider: "email" } } };
  setTimeout(() => cb && cb("INITIAL_SESSION", session), 0);
  const ok = (d) => Promise.resolve(Object.assign({ error: null }, d || {}));
  const clone = (x) => x == null ? x : JSON.parse(JSON.stringify(x));
  const T = () => getToday(), lastMon = () => addDays(weekDays(T())[0], -7);
  const me = () => ({ user_id: "u1", name: "Sabrina", code: "SAB234", avatar: "mint", level: 4, streak: 2, week_xp: 0, week: weekDays(T())[0], last_week_xp: 40, last_week: lastMon(), searchable: false, duels_open: true });
  window.__me = null;
  return {
    auth: { onAuthStateChange(f) { cb = f; return { data: { subscription: { unsubscribe() {} } } }; }, signOut() { return ok(); } },
    from(t) { return {
      select() { return { eq() { return { maybeSingle() { if (t !== "profiles") return ok({ data: null }); __me = __me || me(); return ok({ data: clone(__me) }); } }; } }; },
      upsert(row) { return { select() { return { single() { return ok({ data: { updated_at: row.updated_at } }); } }; } }; },
      update(o) { return { eq() { __db.updates.push(clone(o)); Object.assign(__me, o); return ok(); } }; },
    }; },
    rpc(name, args) {
      __db.rpcs.push(name);
      if (name === "friend_list") return ok({ data: [{ id: 7, status: "accepted", incoming: false, name: "Ana", code: "ANA234", avatar: "berry", level: 5, streak: 4, week_xp: 0, week: weekDays(T())[0], duels_open: true, last_week_xp: 300, last_week: lastMon() }] });
      if (name === "my_battles") return ok({ data: clone(__db.battles) });
      if (name === "start_battle") {
        __db.battles.unshift({ id: 1, status: "waiting", start_day: null, end_day: null, created_at: new Date().toISOString(), mine: true, my_status: "accepted", claimed: false,
          players: [{ name: "Sabrina", avatar: "mint", status: "accepted", xp: 0, me: true, creator: true }, { name: "Ana", avatar: "berry", status: "invited", xp: 0, me: false, creator: false }] });
        return ok({ data: args.friend_ids.length === 1 && args.friend_ids[0] === 7 ? "started" : "not_friends" });
      }
      if (name === "respond_battle") {
        const b = __db.battles.find((x) => x.id === args.p_battle);
        if (!b || b.my_status !== "invited") return ok({ data: "not_invited" });
        b.my_status = args.p_accept ? "accepted" : "declined"; b.players.find((p) => p.me).status = b.my_status;
        if (args.p_accept && b.status === "waiting") Object.assign(b, { status: "active", start_day: addDays(args.p_today, 1), end_day: addDays(args.p_today, 3) });
        return ok({ data: args.p_accept ? "accepted" : "declined" });
      }
      if (name === "report_battle_xp") { __db.reports.push(clone(args)); for (const b of __db.battles) if (b.status === "active" && b.my_status === "accepted") b.players.find((p) => p.me).xp = Math.min(150, args.p_days[args.p_today] || 0); return ok({ data: 1 }); }
      if (name === "claim_battle_prize") { const b = __db.battles.find((x) => x.id === args.p_battle); b.claimed = true; return ok({ data: { ok: true, place: 1, players: 2, coins: 50, trophy: true, xp: 120 } }); }
      return ok({ data: null });
    },
  };
} };`;

test("Battles: challenge a friend, accept an invite, live score on Today, claim the prize, Tavern Champion crown", { skip, timeout: 120000 }, async () => {
  const out = await runInBrowser({ accounts: "fake", fake: FAKE_BATTLES, driver: `
    const r = {}; const text = () => q("#view").textContent; const sheet = () => document.getElementById("sheetOverlay");
    q('[data-tab="tavern"]').click();
    r.battlesPanelFirst = await until(() => q("#view .panel h3") && q("#view .panel h3").textContent === "Battles");
    r.championCrown = text().includes("Last week's Tavern Champion: Ana") && !!q(".lb-row .crown-tag");
    q('[data-action="battle-new"]').click(); await w(80);
    r.pickerShowsPrizes = !sheet().hidden && sheet().textContent.includes("winner 50 coins");
    q("#battleForm").requestSubmit(); await w(150);
    r.mustPickSomeone = !__db.rpcs.includes("start_battle");
    q('#battleForm input[name="bfriend"]').checked = true; q("#battleForm").requestSubmit();
    r.challengeSent = await until(() => sheet().hidden && text().includes("Waiting for Ana to accept"));
    // Ana challenges me back; I accept from "Waiting at the door"
    __db.battles.unshift({ id: 2, status: "waiting", start_day: null, end_day: null, created_at: new Date().toISOString(), mine: false, my_status: "invited", claimed: false,
      players: [{ name: "Ana", avatar: "berry", status: "accepted", xp: 0, me: false, creator: true }, { name: "Sabrina", avatar: "mint", status: "invited", xp: 0, me: true, creator: false }] });
    await loadSocial();
    r.inviteAtTheDoor = await until(() => text().includes("Ana challenged you") && !document.getElementById("tavernDot").hidden);
    q('[data-action="battle-accept"][data-id="2"]').click();
    r.acceptedStartsTomorrow = await until(() => text().includes("Starts tomorrow"));
    // jump to the first battle day: the duel bar shows, the app reports capped XP, Today shows the strip
    state.dayOffset = 1; const t = getToday();
    state.quests.push({ id: 9001, name: "Big quest", day: t, done: true, completedOn: t, xpEarned: 200, category: "Class", difficulty: "Hard" });
    await reportBattleXp(true); render();
    r.reportedCapped = __db.reports.length > 0 && __db.reports[__db.reports.length - 1].p_days[t] === 150;
    r.duelBar = !!q(".duel-bar") && text().includes("You're ahead by 150 XP");
    q('[data-tab="today"]').click(); await w(80);
    r.todayStrip = !!q(".battle-strip") && q(".battle-strip").textContent.includes("You 150 · Ana 0") && q(".battle-strip").textContent.includes("Day 1 of 3");
    // after the last day: claim the prize
    state.dayOffset = 4; q('[data-tab="tavern"]').click();
    r.claimButton = await until(() => !!q('[data-action="battle-claim"]'));
    const coins = state.spendableXp;
    q('[data-action="battle-claim"]').click();
    r.victory = await until(() => !sheet().hidden && sheet().textContent.includes("Victory!") && sheet().textContent.includes("+50 coins"));
    r.coinsAndTrophy = state.spendableXp === coins + 50 && state.battleWins === 1;
    q('[data-action="friend-close"]').click(); await w(60);
    r.trophyOnCard = text().includes("1 win");
    q('[data-social="battles"]').click();
    r.battlesSwitch = await until(() => __db.updates.some((u) => u.duels_open === false));
    r.noHorizontalScroll = document.documentElement.scrollWidth <= window.innerWidth;
    return r;` });
  allTrue(out);
});
