// Walkthrough 3. Workspace Bot: "On the ticket's branch" (Dash's git-on-branch).
// Reads: git, workspace, row. Run it in the job's workspace repo.
const { check, expect } = require("@trops/dash-check");

check("the workspace is on the job's branch", async ({ workspace, git }) => {
  expect(await git.branch(), "the branch").toBe(workspace.branch, `The workspace is on another branch, not ${workspace.branch}`);
});

check("the branch is new from the base", async ({ git, row }) => {
  const base = `origin/${row.repo?.baseBranch || "main"}`;
  expect(await git.commitsSince(base), `commits past ${base}`).toBe(0, `The branch already has commits past ${base}: start it fresh from ${base}`);
});
