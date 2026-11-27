/**
 * Git helpers: the state of the workspace's repo. Built only from Layer 0
 * (ctx.git), never git directly.
 */
"use strict";

const { defineHelper, expect, fail, note, matchGlob, globToRegExp, DashCheckError } = require("..");
const { needHandoff } = require("./handoff");
const { runOrFail } = require("./commands");

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

// ---- the plan: the files a handoff names ------------------------------------

const PLAN_KEYS = { type: "list", label: "Plan keys", default: ["files", "newFiles", "tests"], description: "Handoff keys that list files: a path, a list of paths, or a list of { file } (or { path })" };
const ALSO_ALLOW = { type: "list", label: "Also allowed", description: "Globs that may change without being in the plan, e.g. CHANGELOG.md" };
const LOCKFILES = {
  type: "list",
  label: "Lockfiles",
  default: ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"],
  description: "Allowed outside the plan only when node.lockfileExplained passes for them",
};
const norm = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "");

/** The files the handoff's plan names (deduplicated, as written). */
function planFiles(ctx, keys) {
  const out = new Set();
  const add = (v) => {
    if (typeof v === "string" && v.trim()) out.add(norm(v));
    else if (v && typeof v === "object" && !Array.isArray(v)) add(v.file !== undefined ? v.file : v.path);
  };
  for (const k of keys) {
    const v = ctx.get(`handoff.${k}`);
    if (Array.isArray(v)) v.forEach(add);
    else add(v);
  }
  return [...out];
}

/** Is a file in the plan? A plan entry is a path, a folder ("src/x/") or a glob. */
const inPlan = (plan, f) =>
  plan.some((p) => p === f || (p.endsWith("/") && f.startsWith(p)) || (/[*?{[]/.test(p) && matchGlob(p, f)));

const isLockfile = (lockfiles, f) => lockfiles.some((l) => l === f || l === f.split("/").pop() || (/[*?{[]/.test(l) && matchGlob(l, f)));

/**
 * The changed files outside the plan, with lockfiles judged by
 * node.lockfileExplained's rule: { extra, lockProblems: [{ file, reason, at }], lockOk: [file] }.
 */
async function outsidePlan(ctx, ref, files, { plan, alsoAllow, lockfiles, changed }) {
  const { lockfileProblem } = require("./node");
  const extra = [];
  const lockProblems = [];
  const lockOk = [];
  const judged = new Map();
  for (const f of files) {
    if (inPlan(plan, f) || (alsoAllow.length && matchGlob(alsoAllow, f))) continue;
    if (isLockfile(lockfiles, f)) {
      if (!judged.has(f)) judged.set(f, await lockfileProblem(ctx, ref, f, { changed }));
      const r = judged.get(f);
      if (!r.changed || !r.reason) lockOk.push(f);
      else lockProblems.push({ file: f, reason: r.reason, at: r.at });
      continue;
    }
    extra.push(f);
  }
  return { extra, lockProblems, lockOk };
}

const changesMatchPlan = defineHelper({
  id: "git.changesMatchPlan",
  group: "Git",
  label: "Only the planned files changed",
  description: "Every changed file is named in the handoff's plan",
  sentence: "every file changed since {base} is in handoff {planKeys}, or matches {alsoAllow}",
  params: { base: BASE, planKeys: PLAN_KEYS, alsoAllow: ALSO_ALLOW, lockfiles: LOCKFILES },
  reads: ["git", "fs", "handoff"],
  async run(ctx, { base, planKeys, alsoAllow, lockfiles }) {
    if (!needHandoff(ctx)) return;
    const plan = planFiles(ctx, planKeys);
    if (!plan.length) {
      fail(`The handoff names no files in ${planKeys.join(", ")}: list the files the work changes`);
      return;
    }
    const ref = await baseRef(ctx, base);
    const changed = await ctx.git.changedFiles(ref);
    const { extra, lockProblems } = await outsidePlan(ctx, ref, changed, { plan, alsoAllow, lockfiles, changed });
    if (extra.length) fail("Files the plan didn't name changed: undo them, or add them to the plan", { at: listOf(extra), received: extra });
    for (const p of lockProblems) fail(p.reason, p.at ? { at: p.at } : undefined);
    if (!extra.length && !lockProblems.length) note(`${changed.length} changed file${changed.length === 1 ? "" : "s"}, all in the plan`);
  },
});

const commitsScoped = defineHelper({
  id: "git.commitsScoped",
  group: "Git",
  label: "Each commit is scoped",
  description: "Every commit touches only planned files and names the item",
  sentence: "each commit past {base} changes only files in handoff {planKeys} and mentions {mentions}",
  params: {
    base: BASE,
    planKeys: { ...PLAN_KEYS, description: `${PLAN_KEYS.description}. Empty: don't check the files` },
    alsoAllow: ALSO_ALLOW,
    lockfiles: LOCKFILES,
    mentions: { type: "text", label: "Message mentions", default: "{item.id}", description: "Text every commit message must have. Empty: don't check messages" },
  },
  reads: ["git", "fs", "handoff", "item"],
  async run(ctx, { base, planKeys, alsoAllow, lockfiles, mentions }) {
    let plan = null;
    if (planKeys.length) {
      if (!needHandoff(ctx)) return;
      plan = planFiles(ctx, planKeys);
      if (!plan.length) {
        fail(`The handoff names no files in ${planKeys.join(", ")}: list the files the work changes`);
        return;
      }
    }
    const ref = await baseRef(ctx, base);
    const commits = (await ctx.git.commits(ref)).filter((c) => c.parents.length < 2);
    if (!commits.length) {
      note(`No commits past ${ref}`);
      return;
    }
    const changed = plan ? await ctx.git.changedFiles(ref) : [];
    let bad = 0;
    for (const c of commits) {
      const name = `${c.sha.slice(0, 7)} "${c.subject}"`;
      if (plan) {
        const { extra, lockProblems } = await outsidePlan(ctx, ref, c.files, { plan, alsoAllow, lockfiles, changed });
        const out = [...extra, ...lockProblems.map((p) => p.file)];
        if (out.length) {
          bad++;
          fail(`Commit ${name} changes files outside the plan: move them to their own branch, or add them to the plan`, { at: listOf(out), received: out });
        }
      }
      if (mentions && !c.message.includes(mentions)) {
        bad++;
        fail(`Commit ${name} doesn't mention ${mentions}: reword it (git commit --amend, or rebase -i before pushing)`);
      }
    }
    if (!bad) note(`${commits.length} commit${commits.length === 1 ? "" : "s"}, each scoped${mentions ? ` and mentioning ${mentions}` : ""}`);
  },
});

// ---- tests next to the source ------------------------------------------------

const RE_ESC = /[.*+?^${}()|[\]\\]/g;
const SENT = { dir: "\u0001D\u0001", name: "\u0001N\u0001", ext: "\u0001E\u0001" };

/** A test pattern ("<dir>/<name>.test.*") for one source file, as a RegExp. */
function pairedTest(pattern, src) {
  const slash = src.lastIndexOf("/");
  const dir = slash < 0 ? "" : src.slice(0, slash);
  const file = src.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const parts = { dir, name: dot > 0 ? file.slice(0, dot) : file, ext: dot > 0 ? file.slice(dot + 1) : "" };
  let g = String(pattern).replace(/<(dir|name|ext)>/g, (_m, k) => SENT[k]);
  if (!dir) g = g.replace(new RegExp(`^${SENT.dir}/`), "");
  let src2 = globToRegExp(g).source;
  for (const k of Object.keys(SENT)) src2 = src2.split(SENT[k]).join(parts[k].replace(RE_ESC, "\\$&"));
  return new RegExp(src2);
}

const sourceHasTests = defineHelper({
  id: "git.sourceHasTests",
  group: "Git",
  label: "Changed source has tests",
  description: "Each changed source file has a changed test (paired by name, or any)",
  sentence: "each changed {sources} file since {base} has a changed test ({mode})",
  params: {
    sources: {
      type: "list",
      label: "Source files",
      default: ["src/**/*.{js,jsx,ts,tsx,mjs,cjs}", "lib/**/*.{js,jsx,ts,tsx,mjs,cjs}", "!**/*.{test,spec}.*", "!**/__tests__/**", "!**/*.stories.*", "!**/*.d.ts"],
    },
    tests: { type: "list", label: "Test files", default: ["**/*.{test,spec}.*", "**/__tests__/**", "test/**", "tests/**"], description: "What counts as a test in any mode" },
    testPattern: {
      type: "list",
      label: "Paired test",
      default: ["<dir>/<name>.{test,spec}.*", "<dir>/__tests__/<name>.*", "{test,tests}/**/<name>.{test,spec}.*", "{test,tests}/**/<name>.*"],
      description: "Where a source's test is, in paired mode: <dir>, <name> and <ext> are the source's",
    },
    mode: { type: "select", label: "Mode", options: ["paired", "any"], default: "paired", description: "paired: each source has its own test; any: some test changed" },
    exempt: { type: "list", label: "Exempt", description: "Sources that need no test, e.g. **/index.js" },
    base: BASE,
  },
  reads: ["git", "fs"],
  async run(ctx, { sources, tests, testPattern, mode, exempt, base }) {
    const ref = await baseRef(ctx, base);
    const changed = [];
    for (const f of await ctx.git.changedFiles(ref)) if (await ctx.fs.exists(f)) changed.push(f);
    const srcs = changed.filter((f) => matchGlob(sources, f) && !(exempt.length && matchGlob(exempt, f)));
    if (!srcs.length) {
      note(`No source file changed since ${ref}`);
      return;
    }
    const changedTests = changed.filter((f) => matchGlob(tests, f));
    if (mode === "any") {
      if (!changedTests.length) fail("Source changed but no test did: add or update a test", { at: listOf(srcs), received: srcs });
      else note(`${srcs.length} source file${srcs.length === 1 ? "" : "s"} and ${changedTests.length} test${changedTests.length === 1 ? "" : "s"} changed`);
      return;
    }
    const others = changed.filter((f) => !srcs.includes(f));
    const missing = srcs.filter((s) => {
      const res = testPattern.map((p) => pairedTest(p, s));
      return !others.some((f) => res.some((re) => re.test(f)));
    });
    if (missing.length) {
      fail(`Changed source with no changed test next to it: add or update ${missing.length === 1 ? "its test" : "their tests"} (${testPattern[0] || "a test"})`, { at: listOf(missing), received: missing });
    } else note(`${srcs.length} source file${srcs.length === 1 ? "" : "s"}, each with its test`);
  },
});

// ---- the lines the work added --------------------------------------------------

const noNewMatches = defineHelper({
  id: "git.noNewMatches",
  group: "Git",
  label: "No added line matches a pattern",
  description: "e.g. no new TODO or console.log; lines already there don't count",
  sentence: "no line added since {base} in {glob} matches {pattern}",
  params: {
    glob: { type: "list", label: "Files", required: true, placeholder: "src/**/*.js, !**/*.test.js" },
    pattern: { type: "regex", label: "Pattern", required: true, placeholder: "\\b(TODO|FIXME)\\b" },
    base: BASE,
  },
  reads: ["git"],
  async run(ctx, { glob, pattern, base }) {
    const ref = await baseRef(ctx, base);
    const added = (await ctx.git.addedLines(ref)).filter((l) => matchGlob(glob, l.file));
    const hits = added.filter((l) => {
      pattern.lastIndex = 0;
      return pattern.test(l.text);
    });
    if (hits.length) {
      const where = hits.map((h) => `${h.file}:${h.line}`);
      fail(`${hits.length} added line${hits.length === 1 ? "" : "s"} match${hits.length === 1 ? "es" : ""} /${pattern.source}/: remove ${hits.length === 1 ? "it" : "them"}`, { at: listOf(where), received: where });
    } else note(`No match in ${added.length} added line${added.length === 1 ? "" : "s"}`);
  },
});

// ---- validation doesn't rewrite the tree ---------------------------------------

const validateLeavesTreeClean = defineHelper({
  id: "git.validateLeavesTreeClean",
  group: "Git",
  label: "Validate doesn't rewrite files",
  description: "Running the validate command leaves no file changed (no formatter --write, no npm install --save)",
  sentence: "{command} passes and leaves nothing uncommitted",
  params: {
    command: { type: "text", label: "Command", default: "npm test" },
    timeoutSec: { type: "number", label: "Time limit (s)", default: 1800 },
    allowDirtyBefore: { type: "boolean", label: "Allow changes before", default: false, description: "Judge only files the command changes" },
  },
  reads: ["git", "run"],
  async run(ctx, { command, timeoutSec, allowDirtyBefore }) {
    const before = await ctx.git.uncommitted();
    if (before.length && !allowDirtyBefore) {
      fail(`There are uncommitted changes before ${command}: commit or discard them first`, { at: listOf(before, 5), received: before });
      return;
    }
    const r = await runOrFail(ctx, command, timeoutSec);
    const rewritten = (await ctx.git.uncommitted()).filter((f) => !before.includes(f));
    if (rewritten.length) {
      fail(`${command} changed files: make it check instead of rewrite (e.g. prettier --check, npm ci), and don't commit them`, { at: listOf(rewritten), received: rewritten });
    } else if (r.code === 0 && !r.timedOut) note(`${command} passed and left the tree as it was`);
  },
});

module.exports = {
  onBranch, committedSince, clean, changedOnly, noChangesTo,
  changesMatchPlan, commitsScoped, sourceHasTests, noNewMatches, validateLeavesTreeClean,
  baseRef, planFiles, inPlan, pairedTest,
};
