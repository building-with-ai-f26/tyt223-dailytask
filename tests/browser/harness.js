// Runs the real app in a headless browser (Edge or Chrome) and returns what a driver script reported.
// The page is served from a tiny local server; accounts point at a FAKE Supabase, so nothing real is touched.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { appHtml, ROOT } = require("../helpers");
const APP_DIR = path.join(ROOT, "docs", "app");

const CANDIDATES = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
];
function findBrowser() { return CANDIDATES.find((p) => p && fs.existsSync(p)) || null; }

// options: { accounts: "off" | "fake", fake: "<js that defines window.supabase>", driver: "<async js body; return an object>", query: "?x=1" }
function runInBrowser(options) {
  const browser = findBrowser();
  if (!browser) return Promise.resolve(null);
  let html = appHtml().replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");   // the fake server lives on localhost
  if (options.accounts === "off") html = html.replace(/const SUPABASE_URL = "[^"]*";/, 'const SUPABASE_URL = "";');
  else html = html.replace(/const SUPABASE_URL = "[^"]*";/, 'const SUPABASE_URL = "https://fake.supabase.co";')
    .replace(/const SUPABASE_KEY = "[^"]*";/, 'const SUPABASE_KEY = "sb_publishable_fake";')
    .replace(/const SUPABASE_JS = \{[^}]*\};/, 'const SUPABASE_JS = { src: "/fake-supabase.js", integrity: "" };');
  const driver = `<script>
  (async () => {
    const w = (ms) => new Promise((r) => setTimeout(r, ms)); const q = (s) => document.querySelector(s);
    const until = async (c, ms = 6000) => { const t0 = Date.now(); while (!c() && Date.now() - t0 < ms) await w(50); await w(60); return c(); };
    let out;
    try { out = await (async () => { ${options.driver} })(); } catch (e) { out = { error: String(e && e.stack || e) }; }
    const pre = document.createElement("pre"); pre.id = "RESULT"; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
  })();
  </script></body>`;
  const page = html.replace("</body>", () => driver);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dailyquest-browser-"));
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/fake-supabase.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(options.fake || ""); }
      const file = req.url.split("?")[0].replace(/^\/app\//, "");
      if (file && !file.includes("..") && fs.existsSync(path.join(APP_DIR, file))) {   // real files next to the page (images, icons)
        res.writeHead(200, { "Content-Type": { ".jpg": "image/jpeg", ".png": "image/png", ".js": "text/javascript", ".webmanifest": "application/manifest+json" }[path.extname(file)] || "application/octet-stream" });
        return res.end(fs.readFileSync(path.join(APP_DIR, file)));
      }
      if (req.url.startsWith("/app/")) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(page); }
      res.writeHead(404); res.end();
    }).listen(0, "127.0.0.1", () => {
      const url = `http://localhost:${server.address().port}/app/${options.query || ""}`;
      execFile(browser, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--virtual-time-budget=25000", "--dump-dom", url], { maxBuffer: 1 << 26, timeout: 90000 }, (err, stdout) => {
        server.close();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* the browser may still hold a file */ }
        const m = (stdout || "").match(/<pre id="RESULT">([\s\S]*?)<\/pre>/);
        resolve(m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) : { error: "no result: " + (err && err.message) });
      });
    });
  });
}

module.exports = { findBrowser, runInBrowser };
