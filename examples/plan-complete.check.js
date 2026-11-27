// Walkthrough 2. Triage: "The plan is complete".
// Lives in the shared package. Reads: handoff, picks, settings (the Repos table).
const { check, expect } = require("@trops/dash-check");

check("the plan has a cause, a fix and a test", ({ handoff }) => {
  for (const part of ["cause", "fix", "test"]) {
    expect(handoff.plan?.[part], `handoff.plan.${part}`).toBeNonEmptyString(`The plan has no ${part}`);
  }
});

check("the plan picks one of the team's repos", ({ picks, settings }) => {
  const keys = (settings.repo || []).map((r) => r.key);
  expect(picks.repo, "picks.repo").toBeOneOf(keys, `"${picks.repo}" isn't in the Repos table (${keys.join(", ")})`);
});
