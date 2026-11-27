// Walkthrough 10. Merge Bot: "The PR was merged only when allowed".
// Checks the outcome on GitHub, not the bot's word. Reads: handoff, github, settings.
const { check, expect } = require("@trops/dash-check");

check("the PR was merged only when allowed", async ({ handoff, github, settings }) => {
  const pr = await github.pr(handoff.prUrl);
  if (settings.mergeWhenGreen) expect(pr.merged, "merged").toBe(true, `PR #${pr.number} wasn't merged`);
  else expect(pr.merged, "merged").toBe(false, `PR #${pr.number} was merged, but Merge when green is off`);
});
