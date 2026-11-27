/**
 * Node helpers: a Node repo's tests, lint and dependencies. Built only
 * from Layer 0 (ctx.run, ctx.fs, ctx.git).
 */
"use strict";

const { defineHelper, fail, note } = require("..");
const { runOrFail } = require("./commands");
const { baseRef } = require("./git");

/** How many tests passed, from common runners' summaries, or null. */
function testCount(out) {
  const s = String(out || "");
  const pats = [
    /Tests:\s+(?:\d+ \w+, )*(\d+) passed/, // jest
    /^# pass (\d+)/m, // node --test (TAP)
    /ℹ pass (\d+)/, // node --test (spec)
    /(\d+) passing/, // mocha
    /Tests\s+(\d+) passed/, // vitest
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) return Number(m[1]);
  }
  return null;
}

const testsPass = defineHelper({
  id: "node.testsPass",
  group: "Node",
  label: "Tests pass",
  description: "npm test, or a command",
  sentence: "run {command}",
  params: {
    command: { type: "text", label: "Command", default: "npm test" },
    timeoutSec: { type: "number", label: "Time limit (s)", default: 900 },
  },
  reads: ["run"],
  async run(ctx, { command, timeoutSec }) {
    const r = await runOrFail(ctx, command, timeoutSec, `${command}`);
    if (r.code === 0 && !r.timedOut) {
      const n = testCount(`${r.stdout}\n${r.stderr}`);
      note(n === null ? `${command} passed` : `${n} test${n === 1 ? "" : "s"} passed`);
    }
  },
});

const lintPasses = defineHelper({
  id: "node.lintPasses",
  group: "Node",
  label: "Lint passes",
  description: "npm run lint, or a command",
  sentence: "run {command}",
  params: {
    command: { type: "text", label: "Command", default: "npm run lint" },
    timeoutSec: { type: "number", label: "Time limit (s)", default: 300 },
  },
  reads: ["run"],
  async run(ctx, { command, timeoutSec }) {
    const r = await runOrFail(ctx, command, timeoutSec);
    if (r.code === 0 && !r.timedOut) note(`${command} passed`);
  },
});

const DEP_KEYS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

const noNewDependencies = defineHelper({
  id: "node.noNewDependencies",
  group: "Node",
  label: "No new dependencies",
  description: "package.json adds none since the base",
  sentence: "package.json adds no dependencies since {base}",
  params: {
    base: { type: "text", label: "Base branch", default: "{repo.baseBranch}" },
    allow: { type: "list", label: "Allowed", description: "Packages that may be added" },
  },
  reads: ["git", "fs"],
  async run(ctx, { base, allow }) {
    const ref = await baseRef(ctx, base);
    const before = await ctx.git.fileAt(ref, "package.json");
    if (before === null) {
      fail(`package.json isn't on ${ref}, so there's nothing to compare with`);
      return;
    }
    if (!(await ctx.fs.exists("package.json"))) {
      fail("package.json isn't in the workspace");
      return;
    }
    let old;
    try {
      old = JSON.parse(before);
    } catch (e) {
      fail(`package.json on ${ref} isn't valid JSON (${e.message})`);
      return;
    }
    const now = await ctx.fs.readJson("package.json");
    const names = (p) => new Set(DEP_KEYS.flatMap((k) => Object.keys((p && p[k]) || {})));
    const had = names(old);
    const added = [...names(now)].filter((n) => !had.has(n) && !allow.includes(n)).sort();
    if (added.length) {
      fail(`package.json adds ${added.length === 1 ? "a dependency" : "dependencies"}: remove ${added.length === 1 ? "it" : "them"}, or allow ${added.length === 1 ? "it" : "them"} on the check`, { at: added.join(", "), received: added });
    } else note(`No new dependencies since ${ref}`);
  },
});

module.exports = { testsPass, lintPasses, noNewDependencies, testCount };
