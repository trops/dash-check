/**
 * Git helpers: the state of the workspace's repo. Built only from Layer 0
 * (ctx.git), never git directly.
 */
"use strict";

const { defineHelper, expect, fail, note, matchGlob, DashCheckError } = require("..");

const listOf = (files, n = 10) => `${files.slice(0, n).join(", ")}${files.length > n ? `, and ${files.length - n} more` : ""}`;

/**
 * The ref to compare with: "origin/<base>" when the remote has it, else the
 * local branch. With no base, the repo's default branch.
 */
async function baseRef(ctx, base) {
  let b = String(base || "").trim();
  if (!b) b = (await ctx.git.defaultBranch()) || "";
  if (!b) {
    throw new DashCheckError("No base branch to compare with", {
      fix: "set the base (e.g. main), or give the repo an origin/HEAD",
    });
  }
  if (b.startsWith("origin/") || b.startsWith("refs/")) return b;
  if (await ctx.git.hasRef(`origin/${b}`)) return `origin/${b}`;
  if (await ctx.git.hasRef(b)) return b;
  return `origin/${b}`;
}

const BASE = { type: "text", label: "Base branch", default: "{repo.baseBranch}", description: "Empty: the repo's default branch" };

const onBranch = defineHelper({
  id: "git.onBranch",
  group: "Git",
  label: "On the job's branch",
  description: "The workspace is on workspace.branch",
  sentence: "the workspace is on {branch}",
  params: { branch: { type: "text", label: "Branch", default: "{workspace.branch}" } },
  reads: ["git", "workspace"],
  async run(ctx, { branch }) {
    if (!branch) {
      fail("No branch to check: the job's workspace has none. Name it in the handoff's workspace.branch, or set the branch");
      return;
    }
    const cur = await ctx.git.branch();
    const shown = cur === "HEAD" ? "no branch (a detached HEAD)" : cur;
    expect(cur, "the branch").toBe(branch, `The workspace is on ${shown}, not ${branch}: check out ${branch}`);
    note(`On ${branch}`);
  },
});

const committedSince = defineHelper({
  id: "git.committedSince",
  group: "Git",
  label: "Work is committed",
  description: "Commits past the base, nothing uncommitted",
  sentence: "at least {min} commit(s) past {base}, and nothing uncommitted",
  params: { base: BASE, min: { type: "number", label: "At least", default: 1 } },
  reads: ["git"],
  async run(ctx, { base, min }) {
    const ref = await baseRef(ctx, base);
    const n = await ctx.git.commitsSince(ref);
    expect(n, `commits past ${ref}`).toBeGreaterThan(min - 1, n === 0 ? `No commits past ${ref}: commit the work (git add -A; git commit)` : `Only ${n} commit(s) past ${ref}; it needs ${min}`);
    const dirty = await ctx.git.uncommitted();
    if (dirty.length) fail("There are uncommitted changes: commit or discard them", { at: listOf(dirty, 5), received: dirty });
    note(`${n} commit${n === 1 ? "" : "s"} past ${ref}, nothing uncommitted`);
  },
});

const clean = defineHelper({
  id: "git.clean",
  group: "Git",
  label: "Nothing uncommitted",
  description: "No staged, unstaged or untracked changes",
  sentence: "nothing is uncommitted",
  reads: ["git"],
  async run(ctx) {
    const dirty = await ctx.git.uncommitted();
    if (dirty.length) fail("There are uncommitted changes: commit or discard them", { at: listOf(dirty, 5), received: dirty });
    else note("Nothing uncommitted");
  },
});

const changedOnly = defineHelper({
  id: "git.changedOnly",
  group: "Git",
  label: "Only these files changed",
  description: "Changed files match globs",
  sentence: "only files matching {globs} changed since {base}",
  params: { globs: { type: "list", label: "Globs", required: true, description: 'e.g. src/**, test/**, !src/generated/**' }, base: BASE },
  reads: ["git"],
  async run(ctx, { globs, base }) {
    const ref = await baseRef(ctx, base);
    const changed = await ctx.git.changedFiles(ref);
    const extra = changed.filter((f) => !matchGlob(globs, f));
    if (extra.length) fail(`Files outside ${globs.join(", ")} changed: undo them, or widen the globs`, { at: listOf(extra), received: extra });
    else note(`${changed.length} changed file${changed.length === 1 ? "" : "s"}, all in ${globs.join(", ")}`);
  },
});

const noChangesTo = defineHelper({
  id: "git.noChangesTo",
  group: "Git",
  label: "These files didn't change",
  description: "No changed file matches the globs",
  sentence: "nothing matching {globs} changed since {base}",
  params: { globs: { type: "list", label: "Globs", required: true }, base: BASE },
  reads: ["git"],
  async run(ctx, { globs, base }) {
    const ref = await baseRef(ctx, base);
    const touched = (await ctx.git.changedFiles(ref)).filter((f) => matchGlob(globs, f));
    if (touched.length) fail(`These must not change, but did: undo the changes to them`, { at: listOf(touched), received: touched });
    else note(`Nothing in ${globs.join(", ")} changed`);
  },
});

module.exports = { onBranch, committedSince, clean, changedOnly, noChangesTo, baseRef };
