// Runs every test: node tests/run.js
// Uses Node's built-in test runner (no packages). Browser checks are skipped if Edge/Chrome isn't installed.
// Run one file: node --test tests/logic.test.js
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort().map((f) => path.join(__dirname, f));
const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
