// Walkthrough 4. Workspace Bot: "Setup command passes".
// Lives in the repo: <repo>/.dash/checks/setup.check.js. Reads: run.
const { check, expect } = require("@trops/dash-check");

check("dependencies install", async ({ run }) => {
  const r = await run("npm ci", { timeoutSec: 900 });
  expect(r.code, "npm ci's exit code").toBe(0, `npm ci failed:\n${r.stderr.slice(-2000)}`);
});
