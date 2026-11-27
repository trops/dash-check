// Walkthrough 6. Coder: "Validate command passes".
// Lives in the repo: <repo>/.dash/checks/validate.check.js. Reads: run.
// Dash runs the base branch's copy, so the Coder can't edit it to pass.
const { check, expect } = require("@trops/dash-check");

check("lint passes", async ({ run }) => {
  const r = await run("npm run lint");
  expect(r.code, "npm run lint's exit code").toBe(0, r.stdout.slice(-2000));
});

check("tests pass", async ({ run }) => {
  const r = await run("npm test", { timeoutSec: 900 });
  expect(r.code, "npm test's exit code").toBe(0, r.stdout.slice(-3000));
});
