// Walkthrough 11. Reporter: "The ticket's folder is gone". (Better still: Dash
// removes the job's workspace itself, and this check goes away.) Reads: workspace.
const { check, expect } = require("@trops/dash-check");

check("the workspace is cleaned up", async ({ workspace }) => {
  expect(await workspace.dirExists(), `${workspace.dir} exists`).toBe(false, `${workspace.dir} is still there`);
});
