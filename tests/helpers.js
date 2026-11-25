// Shared test helpers. No packages: only Node's built-in modules.
//
// loadApp() runs the app's <script> from docs/app/index.html inside a sandbox (no browser, no page),
// so the "pure" game functions (parseEntry, completeQuest, ...) can be called directly:
//   const { app, run } = loadApp();
//   const s = app.newState();             // functions are on `app`
//   run("random = () => 0");             // `run` evaluates code inside the app (for const/let values)
//
// Objects made inside the sandbox come from a different JavaScript "realm", so deepStrictEqual can't
// compare them directly; wrap them in plain() first.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const APP_FILE = path.join(ROOT, "docs", "app", "index.html");

function appHtml() { return fs.readFileSync(APP_FILE, "utf8"); }

function loadApp() {
  const html = appHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const code = scripts[scripts.length - 1][1];   // the app's own script is the last inline one
  const app = vm.createContext({ console, URL, URLSearchParams, setTimeout, clearTimeout });
  vm.runInContext(code, app, { filename: "docs/app/index.html" });
  const run = (src) => vm.runInContext(src, app);
  return { app, run, html };
}

const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// Imports one of the Supabase Edge Function rule files (plain JavaScript in a .ts file).
async function importFunctionFile(rel) {
  const { pathToFileURL } = require("node:url");
  return import(pathToFileURL(path.join(ROOT, "supabase", "functions", rel)).href);
}

module.exports = { ROOT, APP_FILE, appHtml, loadApp, plain, importFunctionFile };
