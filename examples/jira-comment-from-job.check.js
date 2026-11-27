// Walkthrough 12. Reporter: "The ticket got its comment", checked in Jira itself.
// Lives in a tracker package (@dash-checks/jira). Reads: item, tool, job.
// ctx.tool only works when Dash runs the check (it supplies the provider).
const { check, expect } = require("@trops/dash-check");

check("the ticket has this job's comment", async ({ item, tool, job }) => {
  const { comments } = await tool("jira", "listJiraIssueComments", { issueIdOrKey: item.id, orderBy: "-created", maxResults: 5 });
  expect(comments.some((c) => new Date(c.created) >= new Date(job.startedAt)), "a comment since the job started")
    .toBe(true, `No comment on ${item.id} since this job started`);
});
