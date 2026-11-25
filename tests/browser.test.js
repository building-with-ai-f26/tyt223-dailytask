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
    r.cardHasOnlyGameNumbers = __db.inserts[0] && Object.keys(__db.inserts[0]).sort().join() === "avatar,code,level,name,searchable,streak,user_id,week,week_xp";
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
