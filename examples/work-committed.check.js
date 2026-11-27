// Walkthrough 7. Coder: "Work is committed" (Dash's git-committed).
// Reads: git, row, item.
const { check, expect } = require("@trops/dash-check");

check("the work is committed", async ({ git, row }) => {
  const base = `origin/${row.repo?.baseBranch || "main"}`;
  expect(await git.commitsSince(base), `commits past ${base}`).toBeGreaterThan(0, `No commits past ${base}`);
  expect(await git.isClean(), "the work tree is clean").toBe(true, "There are uncommitted changes");
});

check("the commit names the item", async ({ git, item }) => {
  expect(await git.lastCommitMessage(), "the last commit's message").toContain(item.id, `The commit message should start with ${item.id}`);
});
