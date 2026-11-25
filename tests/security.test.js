// Security checks that can run without a browser: escaping, the Content-Security-Policy, no secrets in
// the page, pinned outside scripts, and the server-side allow-lists (calendar sites, push services).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, appHtml, importFunctionFile } = require("./helpers");

const { app } = loadApp();
const html = appHtml();

test("esc() makes any text safe to put in HTML, including attributes", () => {
  assert.equal(app.esc(`<img src=x onerror="alert(1)">&'`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
  assert.equal(app.esc(42), "42");
});

test("every value=\"${…}\" in the page is escaped, except three fixed lists from the code", () => {
  const unescaped = [...html.matchAll(/value="\$\{([^}]*)\}"/g)].map((m) => m[1]).filter((v) => !v.startsWith("esc("));
  // t.id = theme ids, v = edit-sheet menu options, d = weekday numbers: all fixed values written in the app itself.
  assert.deepEqual(unescaped.sort(), ["d", "t.id", "v"], "a new unescaped value= appeared; wrap it in esc()");
});

test("the Content-Security-Policy only allows the app's own services", () => {
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  assert.ok(csp, "the CSP <meta> tag is missing");
  for (const rule of ["object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'self'"]) assert.ok(csp.includes(rule), "missing " + rule);
  const connect = csp.match(/connect-src ([^;]+)/)[1].trim().split(/\s+/);
  assert.deepEqual(connect.sort(), ["'self'", "https://date.nager.at", "https://us-assets.i.posthog.com", "https://us.i.posthog.com", "https://vewmdwohvtruavpcsrow.supabase.co"].sort());
  assert.doesNotMatch(csp, /\*/, "no wildcards");
});

test("no secret keys in the page; only the public Supabase key", () => {
  assert.doesNotMatch(html, /sb_secret_[A-Za-z0-9]|sk-(or-v1|ant|proj)-[A-Za-z0-9]{8}|sk_live_|sk-[A-Za-z0-9]{32}|PRIVATE KEY-----|service_role"\s*:/);
  const key = (html.match(/const SUPABASE_KEY = "([^"]*)"/) || [])[1];
  assert.match(key, /^sb_publishable_/, "the app must only ever hold the publishable key");
});

test("the Supabase library is a pinned version with an integrity hash", () => {
  const m = html.match(/const SUPABASE_JS = \{ src: "([^"]+)", integrity: "([^"]+)" \}/);
  assert.ok(m, "SUPABASE_JS not found");
  assert.match(m[1], /@supabase\/supabase-js@\d+\.\d+\.\d+\//, "exact version");
  assert.match(m[2], /^sha384-/);
});

test("calendar allow-list: the server rule and the app's copy agree", async () => {
  const feeds = await importFunctionFile("fetch-calendar/feeds.ts");
  const cases = [
    ["https://brightspace.nyu.edu/d2l/feed.ics", true], ["https://nyu.brightspace.com/d2l/feed.ics", true], ["https://school.d2l.com/feed.ics", true],
    ["https://calendar.google.com/calendar/ical/x/basic.ics", true], ["https://outlook.office365.com/owa/calendar/x.ics", true],
    ["https://brightspace.attacker.com/feed.ics", false], ["https://evil.brightspace.attacker.net/x", false], ["https://brightspace.edu.attacker.com/x", false],
    ["https://notbrightspace.nyu.edu/x", false], ["http://calendar.google.com/x", false], ["https://169.254.169.254/latest/meta-data/", false],
  ];
  for (const [url, want] of cases) {
    assert.equal(!!feeds.normalizeFeedUrl(url), want, "server: " + url);
    assert.equal(!!app.normalizeFeedUrl(url), want, "app: " + url);
  }
});

test("reminders are only sent to real browser push services", async () => {
  const { pushEndpointAllowed } = await importFunctionFile("send-reminders/endpoints.ts");
  const cases = [
    ["https://fcm.googleapis.com/fcm/send/abc", true], ["https://web.push.apple.com/QK7x", true], ["https://updates.push.services.mozilla.com/wpush/v2/x", true],
    ["https://wns2-par02p.notify.windows.com/w/?token=x", true],
    ["https://evil.example/x", false], ["http://fcm.googleapis.com/fcm/send/abc", false], ["https://169.254.169.254/latest/meta-data/", false],
    ["https://fcm.googleapis.com.attacker.com/x", false], ["https://user:pw@fcm.googleapis.com/x", false], ["https://fcm.googleapis.com:8443/x", false],
    ["javascript:alert(1)", false], ["", false], [null, false],
  ];
  for (const [url, want] of cases) assert.equal(pushEndpointAllowed(url), want, url);
});
