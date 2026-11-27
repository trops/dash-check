/**
 * Node helpers: a Node repo's tests, lint and dependencies. Built only
 * from Layer 0 (ctx.run, ctx.fs, ctx.git).
 */
"use strict";

const { defineHelper, fail, note, matchGlob, deepEqual } = require("..");
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

const listOf = (xs, n = 10) => `${xs.slice(0, n).join(", ")}${xs.length > n ? `, and ${xs.length - n} more` : ""}`;
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const parseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (_e) {
    return { ok: false };
  }
};
const depsOf = (pkg) => Object.fromEntries(DEP_KEYS.map((k) => [k, (pkg && pkg[k]) || {}]));

/** A JSON lockfile without its root version fields (a release bumps those). */
function lockBody(lock) {
  const out = { ...lock };
  delete out.version;
  if (out.packages && out.packages[""]) {
    out.packages = { ...out.packages, "": { ...out.packages[""] } };
    delete out.packages[""].version;
  }
  return out;
}

/** The entries of a JSON lockfile that differ: "node_modules/foo", … */
function lockDiff(a, b) {
  const pa = (a && (a.packages || a.dependencies)) || {};
  const pb = (b && (b.packages || b.dependencies)) || {};
  const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
  const diff = keys.filter((k) => !deepEqual(pa[k], pb[k])).map((k) => k || "(root)");
  return diff.length ? diff : ["(the lockfile's other fields)"];
}

/**
 * Why a changed lockfile isn't explained, or null when it is. It is
 * explained when only its root version fields changed, or when a dependency
 * section of a package.json in its folder (or below, for workspaces)
 * changed. A lockfile git can't read as JSON (yarn.lock, pnpm-lock.yaml)
 * needs a dependency change for any change.
 *   { changed, reason, at }
 */
async function lockfileProblem(ctx, ref, lockfile, { manifest, changed } = {}) {
  const files = changed || (await ctx.git.changedFiles(ref));
  if (!files.includes(lockfile)) return { changed: false };
  const undo = `git checkout ${ref} -- ${lockfile}`;
  const dir = dirOf(lockfile);
  const manifests = manifest
    ? [manifest]
    : [...new Set([dir ? `${dir}/package.json` : "package.json", ...files.filter((f) => /(^|\/)package\.json$/.test(f) && (!dir || f.startsWith(`${dir}/`)))])];
  const depsChanged = [];
  for (const m of manifests) {
    const before = await ctx.git.fileAt(ref, m);
    const nowThere = await ctx.fs.exists(m);
    const old = before === null ? null : parseJson(before);
    const now = nowThere ? parseJson(await ctx.fs.read(m)) : null;
    if ((old && !old.ok) || (now && !now.ok) || (!old && !now)) continue;
    if (!deepEqual(depsOf(old && old.value), depsOf(now && now.value))) depsChanged.push(m);
  }
  if (depsChanged.length) return { changed: true, reason: null, why: `dependencies changed in ${depsChanged.join(", ")}` };
  if (!(await ctx.fs.exists(lockfile))) {
    return { changed: true, reason: `${lockfile} was deleted, but no dependency changed: restore it (${undo})` };
  }
  const before = await ctx.git.fileAt(ref, lockfile);
  if (before === null) {
    return { changed: true, reason: `${lockfile} is new, but no dependency changed: remove it, or add it to the plan` };
  }
  const old = parseJson(before);
  const now = parseJson(await ctx.fs.read(lockfile));
  if (old.ok && now.ok) {
    if (deepEqual(lockBody(old.value), lockBody(now.value))) return { changed: true, reason: null, why: "only its version changed" };
    return {
      changed: true,
      reason: `${lockfile} changed, but no dependency in ${manifests.join(", ")} did: undo it (${undo})`,
      at: listOf(lockDiff(lockBody(old.value), lockBody(now.value))),
    };
  }
  return { changed: true, reason: `${lockfile} changed, but no dependency in ${manifests.join(", ")} did: undo it (${undo})` };
}

const lockfileExplained = defineHelper({
  id: "node.lockfileExplained",
  group: "Node",
  label: "Lockfile change is explained",
  description: "The lockfile changed only with a dependency (or only its version)",
  sentence: "{lockfile} changed since {base} only with a dependency in package.json",
  params: {
    base: { type: "text", label: "Base branch", default: "{repo.baseBranch}", description: "Empty: the repo's default branch" },
    lockfile: { type: "path", label: "Lockfile", default: "package-lock.json" },
    manifest: { type: "path", label: "package.json", description: "Empty: package.json next to the lockfile, and any changed package.json below it" },
  },
  reads: ["git", "fs"],
  async run(ctx, { base, lockfile, manifest }) {
    const ref = await baseRef(ctx, base);
    const r = await lockfileProblem(ctx, ref, lockfile, { manifest });
    if (!r.changed) note(`${lockfile} didn't change`);
    else if (r.reason) fail(r.reason, r.at ? { at: r.at } : undefined);
    else note(`${lockfile} changed: ${r.why}`);
  },
});

/** A script that runs nothing, or hides its failures; null when it looks real. */
function noOpScript(script) {
  const s = String(script || "").trim();
  if (!s) return "is empty";
  if (/^(exit\s+0|true|:|echo\b[^&|;]*)\s*;?$/i.test(s)) return `does nothing ("${s}")`;
  if (/no test specified/i.test(s)) return `is npm's placeholder ("${s}")`;
  if (/(\|\|\s*(true|:|exit\s+0)|;\s*exit\s+0)\s*;?$/.test(s)) return `hides its failures ("${s}")`;
  return null;
}

const testScriptIsReal = defineHelper({
  id: "node.testScriptIsReal",
  group: "Node",
  label: "The test script is real",
  description: "package.json's test script isn't a no-op, and can run tests",
  sentence: "the {script} script in package.json runs tests",
  params: {
    script: { type: "text", label: "Script", default: "test" },
    run: { type: "boolean", label: "Run it", default: false, description: "Also run it and count the tests" },
    minTests: { type: "number", label: "At least (tests)", default: 1, description: "When run; 0 skips the count" },
    timeoutSec: { type: "number", label: "Time limit (s)", default: 900 },
  },
  reads: ["fs", "run"],
  async run(ctx, { script, run, minTests, timeoutSec }) {
    if (!(await ctx.fs.exists("package.json"))) {
      fail("package.json isn't in the workspace");
      return;
    }
    const pkg = await ctx.fs.readJson("package.json");
    const body = pkg && pkg.scripts ? pkg.scripts[script] : undefined;
    if (typeof body !== "string") {
      fail(`package.json has no "${script}" script: add one that runs the tests`);
      return;
    }
    const bad = noOpScript(body);
    if (bad) {
      fail(`The "${script}" script ${bad}: make it run the tests`);
      return;
    }
    if (!run) {
      note(`"${script}" is ${body}`);
      return;
    }
    const command = script === "test" ? "npm test" : `npm run ${script}`;
    const r = await runOrFail(ctx, command, timeoutSec);
    if (r.code !== 0 || r.timedOut) return;
    const n = testCount(`${r.stdout}\n${r.stderr}`);
    if (minTests > 0 && n === null) fail(`${command} passed, but its output doesn't say how many tests ran: use a runner that reports it, or set "At least" to 0`);
    else if (minTests > 0 && n < minTests) fail(`${command} ran ${n} test${n === 1 ? "" : "s"}; it needs at least ${minTests}`, { received: n, expected: minTests });
    else note(n === null ? `${command} passed` : `${n} test${n === 1 ? "" : "s"} passed`);
  },
});

/** Glob-like words in a runner's text ("test/*.test.js", "src/**"): what it finds by itself. */
function globsIn(text) {
  return [...new Set(String(text).split(/[\s"'`,=()[\]]+/).map((w) => w.replace(/^\.\//, "")).filter((w) => /[*?]/.test(w) && /[\w]/.test(w)))];
}

const newTestsAreRun = defineHelper({
  id: "node.newTestsAreRun",
  group: "Node",
  label: "New tests are run",
  description: "Every new test file is picked up by a test runner",
  sentence: "every new {tests} file since {base} is named or matched in {runnerFiles}, or matches {autoGlobs}",
  params: {
    base: { type: "text", label: "Base branch", default: "{repo.baseBranch}", description: "Empty: the repo's default branch" },
    tests: { type: "list", label: "Test files", default: ["**/*.{test,spec}.{js,cjs,mjs,jsx,ts,tsx}"] },
    runnerFiles: { type: "list", label: "Runner files", default: ["package.json"], description: "Files that name the tests to run, e.g. package.json, scripts/ci.sh" },
    autoGlobs: { type: "list", label: "Found by the runner", description: "Tests the runner finds by itself, e.g. src/**/*.test.js for jest" },
  },
  reads: ["git", "fs"],
  async run(ctx, { base, tests, runnerFiles, autoGlobs }) {
    const ref = await baseRef(ctx, base);
    const added = [];
    for (const f of await ctx.git.changedFiles(ref)) {
      if (!matchGlob(tests, f) || !(await ctx.fs.exists(f))) continue;
      if ((await ctx.git.fileAt(ref, f)) === null) added.push(f);
    }
    if (!added.length) {
      note(`No new test files since ${ref}`);
      return;
    }
    const texts = [];
    for (const r of runnerFiles) if (await ctx.fs.exists(r)) texts.push(await ctx.fs.read(r));
    const found = [...autoGlobs, ...globsIn(texts.join("\n"))];
    const missed = added.filter((f) => !(found.length && matchGlob(found, f)) && !texts.some((t) => t.includes(f)));
    if (missed.length) {
      fail(`New test files no runner runs: add them to ${runnerFiles.join(" or ")}, or say which globs the runner finds by itself`, { at: listOf(missed), received: missed });
    } else note(`${added.length} new test file${added.length === 1 ? "" : "s"}, each run`);
  },
});

module.exports = { testsPass, lintPasses, noNewDependencies, lockfileExplained, testScriptIsReal, newTestsAreRun, testCount, lockfileProblem, noOpScript };
