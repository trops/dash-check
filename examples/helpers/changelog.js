// A team's own helper: put it in <repo>/.dash/checks/helpers/changelog.js and
// it shows up in `dash-check --list-helpers` (the composer's "Your helpers").
// Built only from Layer 0: ctx.git, expect.
const { defineHelper, expect, note } = require("@trops/dash-check");

module.exports = defineHelper({
  id: "team.changelogUpdated",
  group: "Your helpers",
  label: "Changelog updated",
  description: "CHANGELOG.md changed on this branch",
  sentence: "{file} changed since {base}",
  params: {
    file: { type: "path", label: "Changelog", default: "CHANGELOG.md" },
    base: { type: "text", label: "Base branch", default: "{repo.baseBranch}" },
  },
  reads: ["git"],
  async run(ctx, { file, base }) {
    const ref = `origin/${base || (await ctx.git.defaultBranch()) || "main"}`;
    const changed = await ctx.git.changedFiles(ref);
    expect(changed, `files changed since ${ref}`).toContain(file, `${file} isn't updated: add a line for ${ctx.item.id || "this change"}`);
    note(`${file} is updated`);
  },
});
