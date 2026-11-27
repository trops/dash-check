// Walkthrough 8. Before the Reviewer: "Only the planned files changed".
// Lives in the shared package. Reads: git, handoff, row.
const { check, expect } = require("@trops/dash-check");

check("only the planned files changed", async ({ git, handoff, row }) => {
  const changed = await git.changedFiles(`origin/${row.repo?.baseBranch || "main"}`);
  const allowed = new Set([...(handoff.files ?? []), ...(handoff.newFiles ?? []), ...(handoff.tests ?? []).map((t) => t.file)]);
  const extra = changed.filter((f) => !allowed.has(f) && !/package-lock\.json$/.test(f));
  expect(extra, "files the plan didn't name").toBeEmpty(`Changed files the plan didn't name: ${extra.join(", ")}`);
});
