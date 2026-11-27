// Walkthrough 5. Planner: "Every acceptance item has a test".
// Lives in the shared package. Reads: handoff, workspace.
// Every gap is listed, because each failing expect is collected.
const { check, expect } = require("@trops/dash-check");

check("every acceptance item has a test", ({ handoff }) => {
  expect(handoff.acceptance, "handoff.acceptance").not.toBeEmpty("No acceptance items");
  for (const a of handoff.acceptance ?? []) {
    const t = handoff.tests?.find((x) => x.acceptance === a);
    expect(t?.test, `the test for "${a}"`).toBeNonEmptyString(`No test for: ${a}`);
  }
});

check("the plan only names files in the repo", async ({ handoff, workspace }) => {
  for (const f of handoff.files ?? []) {
    if (handoff.newFiles?.includes(f)) continue;
    expect(await workspace.exists(f), f).toBe(true, `The plan names ${f}, which isn't in the repo (list new files in newFiles)`);
  }
});
