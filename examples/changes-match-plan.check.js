// Walkthrough 8. Before the Reviewer: "Only the planned files changed".
// Lives in the shared package. Reads: git, fs, handoff, row.
// A lockfile the plan didn't name passes only when node.lockfileExplained
// does: a dependency changed, or only its version did. (git.changesMatchPlan
// does all of this in one step.)
const { check, expect } = require("@trops/dash-check");
const { node } = require("@trops/dash-check/helpers");

check("only the planned files changed", async (ctx) => {
  const { git, handoff, row } = ctx;
  const changed = await git.changedFiles(`origin/${row.repo?.baseBranch || "main"}`);
  const allowed = new Set([...(handoff.files ?? []), ...(handoff.newFiles ?? []), ...(handoff.tests ?? []).map((t) => t.file)]);
  const extra = changed.filter((f) => !allowed.has(f));
  const lockfiles = extra.filter((f) => /(^|\/)package-lock\.json$/.test(f));
  for (const lockfile of lockfiles) await node.lockfileExplained(ctx, { lockfile });
  const rest = extra.filter((f) => !lockfiles.includes(f));
  expect(rest, "files the plan didn't name").toBeEmpty(`Changed files the plan didn't name: ${rest.join(", ")}`);
});
