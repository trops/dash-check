// Walkthrough 9. PR Bot: "The PR's CI passes" (Dash's pr-ci). It fails closed:
// no CI is a failure that says what to do. Reads: handoff, github (GH_TOKEN).
const { check, expect } = require("@trops/dash-check");

check("the PR's CI passed", async ({ handoff, github }) => {
  const pr = await github.pr(handoff.prUrl);
  expect(pr.state, `PR #${pr.number}'s state`).toBe("open", `PR #${pr.number} isn't open`);

  const result = await github.waitForChecks(pr.head.sha, { timeoutSec: 1200, noChecksAfterSec: 180 });
  expect(result.runs, "the CI runs").not.toBeEmpty(`${handoff.prUrl} has no CI. Enable Actions on the repo, or set ifNoCI: "pass" on this step`);
  expect(result.failed, "the failed CI runs").toBeEmpty(`CI failed: ${result.failed.map((r) => `${r.name} (${r.conclusion})`).join(", ")}`);
});
