"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createContext, collect, defineHelper, expect, listHelpers, resolveParams, CheckFailure, sentenceOf } = require("..");
const helpers = require("../helpers");
const { tmpdir, cleanup, write, makeRepo, fakeFetch, answer } = require("./_util");

require("node:test").after(cleanup);

/** Run one helper call: { failures (messages), notes, raw }. */
async function call(h, ctx, params) {
  const s = await collect(() => h(ctx, params));
  return { failures: s.failures.map((f) => (f.at ? `${f.message}: ${f.at}` : f.message)), notes: s.notes, raw: s.failures };
}
async function ok(h, ctx, params) {
  const r = await call(h, ctx, params);
  assert.deepEqual(r.failures, [], `${h.meta.id} should pass`);
  return r;
}
async function bad(h, ctx, params, ...res) {
  const r = await call(h, ctx, params);
  assert.ok(r.failures.length > 0, `${h.meta.id} should fail`);
  res.forEach((re, i) => assert.match(r.failures[i] || "", re));
  return r;
}

test("the starter helpers are all there, described, and only use Layer 0", () => {
  const ids = helpers.all.map((h) => h.meta.id).sort();
  assert.deepEqual(ids, [
    "commands.outputMatches", "commands.passes",
    "files.contain", "files.exist", "files.maxGrowth", "files.noneMatch",
    "git.changedOnly", "git.changesMatchPlan", "git.clean", "git.commitsScoped", "git.committedSince",
    "git.noChangesTo", "git.noNewMatches", "git.onBranch", "git.sourceHasTests", "git.validateLeavesTreeClean",
    "github.ciPassed", "github.prOpen",
    "handoff.eachHas", "handoff.has", "handoff.status",
    "node.lintPasses", "node.lockfileExplained", "node.newTestsAreRun", "node.noNewDependencies", "node.testScriptIsReal", "node.testsPass",
    "plan.acceptanceEachHasTest", "plan.hasSections",
    "tracker.ticketExists", "tracker.ticketHasLabel",
  ]);
  for (const h of helpers.all) {
    const m = h.meta;
    assert.ok(m.label && m.group && m.description && m.sentence, m.id);
    for (const [k, p] of Object.entries(m.params)) assert.ok(p.type && p.label, `${m.id}.${k}`);
  }
  const dir = path.join(__dirname, "..", "helpers");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /require\("(child_process|fs|net|https?)"\)|\bfetch\(/, `${f} must go through ctx`);
  }
  const listed = listHelpers().map((h) => h.id);
  for (const id of ids) assert.ok(listed.includes(id), id);
});

test("defineHelper: params are filled, typed and checked", async () => {
  const seen = [];
  const h = defineHelper({
    id: "test.params",
    label: "Params",
    sentence: "{n} of {list}",
    params: {
      n: { type: "number", default: 1 },
      on: { type: "boolean", default: "true" },
      pick: { type: "select", options: ["a", "b"], default: "a" },
      list: { type: "list", default: "x, y" },
      re: { type: "regex", default: "a+" },
      base: { type: "text", default: "{repo.baseBranch}" },
      need: { type: "path", required: true },
    },
    run(_ctx, p) {
      seen.push(p);
    },
  });
  const ctx = createContext({ row: { repo: { baseBranch: "dev" } }, item: { id: "I-1" } });
  await ok(h, ctx, { need: "{item.id}.md", n: "3" });
  assert.deepEqual({ ...seen[0], re: String(seen[0].re) }, { n: 3, on: true, pick: "a", list: ["x", "y"], re: "/a+/", base: "dev", need: "I-1.md" });
  const noRow = createContext({});
  await ok(h, noRow, { need: "x" });
  assert.equal(seen[1].base, undefined, "a default whose placeholder has no value is empty");
  await bad(h, ctx, {}, /test\.params: set need \(need\)/);
  await bad(h, ctx, { need: "x", n: "lots" }, /n \(n\) must be a number/);
  await bad(h, ctx, { need: "x", pick: "c" }, /must be one of a, b/);
  await bad(h, ctx, { need: "x", re: "(" }, /isn't a valid pattern/);
  await bad(h, ctx, { need: "x", nope: 1 }, /test\.params has no param "nope"/);
  await bad(h, noRow, { need: "{repo.x}" }, /\{repo\.x\} has no value here/);
  assert.equal(sentenceOf(h.meta, { n: 2 }), "2 of x, y");
  assert.throws(() => defineHelper({ id: "nogroup", label: "x", run() {} }), /group\.name/);
  assert.throws(() => defineHelper({ id: "a.b", label: "x", params: { p: { type: "date" } }, run() {} }), /use one of text, number/);
  assert.throws(() => defineHelper({ id: "a.b", label: "x", params: { message: {} }, run() {} }), /every helper's own param/);
  assert.deepEqual(resolveParams(h.meta, null, { need: "p" }).list, ["x", "y"]);
});

test("defineHelper: message replaces the failure text, where it was stays; throws become failures", async () => {
  const h = defineHelper({
    id: "test.fails",
    label: "Fails",
    run(_ctx, _p) {
      require("..").fail("original", { at: "src/a.js:1" });
      throw new Error("then it broke");
    },
  });
  const ctx = createContext({});
  const r = await call(h, ctx, { message: "Fix {item.id} please" });
  assert.deepEqual(r.failures, ["Fix {item.id} please: src/a.js:1", "Fix {item.id} please"]);
  assert.equal(r.raw[0].original, "original");
  // Outside a check, a helper throws a CheckFailure with all its failures.
  await assert.rejects(() => h(ctx), (e) => e instanceof CheckFailure && e.failures.length === 2);
  await assert.rejects(() => h({}), /pass the check's ctx first/);
});

test("handoff.has, handoff.status, handoff.eachHas", async () => {
  const { has, status, eachHas } = helpers.handoff;
  const ctx = createContext(answer({ prUrl: "u", plan: { cause: "c", fix: "" }, tests: [{ file: "a", test: "t" }, { file: "b" }] }));
  const r = await ok(has, ctx, { keys: ["prUrl", "plan.cause"] });
  assert.deepEqual(r.notes, ["The handoff has prUrl, plan.cause"]);
  await bad(has, ctx, { keys: "prUrl, plan.fix, summary" }, /The handoff has no plan\.fix/, /The handoff has no summary/);
  await bad(has, createContext({ input: { answer: "no json" } }), { keys: ["a"] }, /The answer has no handoff/);
  await bad(has, createContext({ input: { answer: "```json\n{bad\n```" } }), { keys: ["a"] }, /doesn't parse/);
  await ok(status, ctx, {});
  await bad(status, createContext(answer({ status: "none" })), { is: "ok" }, /The handoff's status is "none", not "ok"/);
  await bad(eachHas, ctx, { list: "tests", keys: ["file", "test"] }, /tests\[1\] has no test/);
  await ok(eachHas, ctx, { list: "tests", keys: ["file"] });
  await bad(eachHas, ctx, { list: "nope", keys: ["file"] }, /The handoff's nope isn't a list/);
});

test("plan.hasSections and plan.acceptanceEachHasTest", async () => {
  const { hasSections, acceptanceEachHasTest } = helpers.plan;
  await ok(hasSections, createContext(answer({ plan: { cause: "a", fix: "b", test: "c" } })));
  await bad(hasSections, createContext(answer({ plan: { cause: "a" } })), {}, /The plan has no fix/, /The plan has no test/);
  await bad(hasSections, createContext(answer({ design: {} })), { key: "design", sections: "goal" }, /The design has no goal/);
  const good = answer({ acceptance: ["A", "B"], tests: [{ acceptance: "A", test: "t1" }, { acceptance: "B", test: "t2" }] });
  const r = await ok(acceptanceEachHasTest, createContext(good));
  assert.deepEqual(r.notes, ["2 acceptance items, each with a test"]);
  const gaps = answer({ acceptance: ["A", "B", "C"], tests: [{ acceptance: "A", test: "t1" }, { acceptance: "B", test: " " }] });
  const g = await bad(acceptanceEachHasTest, createContext(gaps), {}, /^No test for: B$/, /^No test for: C$/);
  assert.equal(g.failures.length, 2, "every gap is listed");
  await bad(acceptanceEachHasTest, createContext(answer({ acceptance: [] })), {}, /acceptance is empty/);
});

test("git helpers, against temp repos", async () => {
  const { onBranch, committedSince, clean, changedOnly, noChangesTo } = helpers.git;
  const repo = makeRepo({ "README.md": "x\n", "src/a.js": "a\n", "package-lock.json": "{}" });
  const input = { workspace: { dir: repo.dir, branch: "feat/DASH-1" }, row: { repo: { baseBranch: "main" } } };
  const ctx = () => createContext(input, { cwd: repo.dir });

  await bad(onBranch, ctx(), {}, /The workspace is on main, not feat\/DASH-1: check out feat\/DASH-1/);
  await bad(onBranch, createContext({}, { cwd: repo.dir, env: {} }), {}, /No branch to check/);
  repo.git("checkout", "-q", "-b", "feat/DASH-1");
  await ok(onBranch, ctx());
  await ok(onBranch, ctx(), { branch: "feat/DASH-1" });

  await bad(committedSince, ctx(), {}, /No commits past origin\/main: commit the work/);
  repo.commit({ "src/a.js": "a2\n", "test/a.test.js": "t\n" }, "DASH-1: change a");
  const r = await ok(committedSince, ctx());
  assert.deepEqual(r.notes, ["1 commit past origin/main, nothing uncommitted"]);
  await ok(committedSince, createContext({}, { cwd: repo.dir }), {}, "with no base: the default branch");
  await bad(committedSince, ctx(), { min: 2 }, /Only 1 commit\(s\) past origin\/main; it needs 2/);
  await bad(committedSince, ctx(), { base: "nope" }, /origin\/nope isn't there/);
  await ok(clean, ctx());
  await ok(changedOnly, ctx(), { globs: ["src/**", "test/**"] });
  await bad(changedOnly, ctx(), { globs: "src/**" }, /Files outside src\/\*\* changed: undo them, or widen the globs: test\/a\.test\.js/);
  await ok(noChangesTo, ctx(), { globs: ["package-lock.json", ".github/**"] });
  await bad(noChangesTo, ctx(), { globs: ["test/**"] }, /These must not change, but did.*: test\/a\.test\.js/);

  repo.write({ "src/new.js": "n\n" });
  await bad(clean, ctx(), {}, /There are uncommitted changes: commit or discard them: src\/new\.js/);
  await bad(committedSince, ctx(), {}, /There are uncommitted changes/);
  await bad(changedOnly, ctx(), { globs: ["test/**", "src/a.js"] }, /src\/new\.js/);
});

test("files helpers", async () => {
  const { exist, contain, noneMatch } = helpers.files;
  const dir = tmpdir();
  write(dir, { "src/index.js": "const a = 1;\n\nconsole.log(a);\n", "src/ok.js": "x\n", "CHANGELOG.md": "## 1.0\n- DASH-1\n" });
  const ctx = createContext({}, { cwd: dir });
  await ok(exist, ctx, { paths: ["src/index.js", "CHANGELOG.md"] });
  await bad(exist, ctx, { paths: ["src/index.js", "nope.js"] }, /nope\.js isn't there: add it/);
  await ok(contain, ctx, { path: "CHANGELOG.md", text: "DASH-1" });
  await bad(contain, ctx, { path: "CHANGELOG.md", text: "DASH-2" }, /CHANGELOG\.md doesn't contain "DASH-2"/);
  await bad(contain, ctx, { path: "nope.md", text: "x" }, /nope\.md isn't there/);
  await bad(noneMatch, ctx, { glob: "src/**/*.js", pattern: "console\\.log" }, /src\/\*\*\/\*\.js has 1 match for \/console\\\.log\/: remove them: src\/index\.js:3/);
  const m = await call(noneMatch, ctx, { glob: "src/**/*.js", pattern: "console\\.log", message: "Remove console.log from src" });
  assert.deepEqual(m.failures, ["Remove console.log from src: src/index.js:3"], "the mockup's failure");
  await ok(noneMatch, ctx, { glob: "src/**/*.js", pattern: "debugger" });
});

test("commands helpers", async () => {
  const { passes, outputMatches } = helpers.commands;
  const ctx = createContext({}, { cwd: tmpdir() });
  const r = await ok(passes, ctx, { command: "echo hi" });
  assert.deepEqual(r.notes, ["echo hi passed"]);
  await bad(passes, ctx, { command: "echo nope; exit 4" }, /^echo nope; exit 4 failed \(exit 4\): nope$/);
  await bad(passes, ctx, { command: "sleep 3", timeoutSec: 0.2 }, /didn't finish in 0\.2 seconds/);
  await bad(passes, ctx, {}, /set Command/);
  await ok(outputMatches, ctx, { command: "echo version 1.2.3", pattern: "\\d+\\.\\d+\\.\\d+" });
  await bad(outputMatches, ctx, { command: "echo nothing", pattern: "^v\\d" }, /The output of echo nothing doesn't match/);
});

test("node helpers", async () => {
  const { testsPass, lintPasses, noNewDependencies, testCount } = require("../helpers/node");
  const dir = tmpdir();
  const ctx = createContext({}, { cwd: dir });
  const t = await ok(testsPass, ctx, { command: "echo '# pass 3'" });
  assert.deepEqual(t.notes, ["3 tests passed"]);
  await bad(testsPass, ctx, { command: "echo 'FAIL one'; exit 1" }, /failed \(exit 1\): FAIL one/);
  await ok(lintPasses, ctx, { command: "true" });
  await bad(lintPasses, ctx, { command: "echo 'x.js: bad' >&2; false" }, /false failed \(exit 1\): x\.js: bad/);
  assert.equal(testCount("Tests:       1 failed, 4 passed, 5 total"), 4);
  assert.equal(testCount("ℹ pass 7"), 7);
  assert.equal(testCount("  12 passing (3ms)"), 12);
  assert.equal(testCount("nothing"), null);

  const repo = makeRepo({ "package.json": { name: "x", dependencies: { a: "1" }, devDependencies: { b: "1" } } });
  const rctx = () => createContext({}, { cwd: repo.dir });
  await ok(noNewDependencies, rctx());
  repo.write({ "package.json": { name: "x", dependencies: { a: "2", left: "1" }, devDependencies: { b: "1", pad: "1" } } });
  await bad(noNewDependencies, rctx(), {}, /package\.json adds dependencies: remove them, or allow them on the check: left, pad/);
  await ok(noNewDependencies, rctx(), { allow: "left, pad" });
  // a real npm test, as a repo would run it
  write(dir, { "package.json": { name: "t", scripts: { test: "node -e \"console.log('# pass 2')\"" } } });
  const n = await ok(testsPass, ctx);
  assert.deepEqual(n.notes, ["2 tests passed"]);
});

test("github helpers, with a fake GitHub", async () => {
  const { prOpen, ciPassed } = helpers.github;
  let t = 0;
  const clock = { now: () => t, sleep: async (ms) => (t += ms) };
  const pr = (n, state, sha, merged = false) => ({ number: n, state, merged, head: { sha } });
  const f = fakeFetch({
    "repos/o/r/pulls/1": pr(1, "open", "s1"),
    "repos/o/r/pulls/2": pr(2, "closed", "s2", true),
    "repos/o/r/pulls/3": pr(3, "open", "s3"),
    "repos/o/r/pulls/4": pr(4, "open", "s4"),
    "repos/o/r/pulls/5": { status: 403, body: {} },
    "repos/o/r/commits/s1/check-runs?per_page=100": { check_runs: [{ name: "test", status: "completed", conclusion: "success" }, { name: "lint", status: "completed", conclusion: "skipped" }] },
    "repos/o/r/commits/s3/check-runs?per_page=100": { check_runs: [{ name: "test", status: "completed", conclusion: "failure" }] },
    "repos/o/r/commits/s4/check-runs?per_page=100": { check_runs: [] },
  });
  const ctx = (n) => createContext(answer({ prUrl: `https://github.com/o/r/pull/${n}` }), { env: { GH_TOKEN: "x" }, fetch: f, ...clock });
  await ok(prOpen, ctx(1));
  await bad(prOpen, ctx(2), {}, /PR #2 isn't open \(it's merged\)/);
  await bad(prOpen, createContext(answer({})), {}, /The handoff has no prUrl: put the PR's link in it/);
  await bad(prOpen, ctx(5), {}, /GitHub said HTTP 403 for PR #5 on o\/r/);
  const r = await ok(ciPassed, ctx(1));
  assert.deepEqual(r.notes, ["2 CI checks passed"]);
  await bad(ciPassed, ctx(3), {}, /^CI failed: test \(failure\)$/);
  await bad(ciPassed, ctx(4), {}, /has no CI after 3 minutes: enable Actions on the repo, or set "If it has no CI" to pass/);
  await ok(ciPassed, ctx(4), { ifNoChecks: "pass" });
});

test("tracker helpers, with a fake tool", async () => {
  const { ticketExists, ticketHasLabel } = helpers.tracker;
  const calls = [];
  const tool = async (provider, name, args) => {
    calls.push([provider, name, args]);
    if (args.issueIdOrKey === "DASH-1") return { key: "DASH-1", fields: { labels: ["dash", "voice"] } };
    if (args.number === "7") return { number: 7, labels: [{ name: "bug" }] };
    return null;
  };
  const ctx = (id) => createContext({ item: { id } }, { tool });
  await ok(ticketExists, ctx("DASH-1"));
  assert.deepEqual(calls[0], ["jira", "getJiraIssue", { issueIdOrKey: "DASH-1" }]);
  await bad(ticketExists, ctx("DASH-9"), {}, /DASH-9 isn't in jira: check the id/);
  await bad(ticketExists, createContext({}, { tool }), {}, /The job has no work item id/);
  await ok(ticketHasLabel, ctx("DASH-1"), { label: "voice" });
  await bad(ticketHasLabel, ctx("DASH-1"), { label: "slack" }, /DASH-1 has no label "slack": add it/);
  await ok(ticketHasLabel, ctx("7"), { label: "bug", provider: "github", tool: "getIssue", idArg: "number" });
  await bad(ticketExists, createContext({ item: { id: "X-1" } }, { env: {} }), {}, /only works when Dash runs the check/);
  assert.ok(expect.has("toContain"));
});

// ---- the factory checks (DASH-156) ------------------------------------------

const LOCK = (v, foo = "1.0.0") => ({
  name: "x", version: v, lockfileVersion: 3, requires: true,
  packages: { "": { name: "x", version: v, dependencies: { foo: "^1.0.0" } }, "node_modules/foo": { version: foo } },
});
const PKG = (v, deps = { foo: "^1.0.0" }) => ({ name: "x", version: v, dependencies: deps });

/** A repo on a branch, with package.json and its lockfile on main. */
function nodeRepo(files = {}) {
  const repo = makeRepo({ "package.json": PKG("1.0.0"), "package-lock.json": LOCK("1.0.0"), "src/a.js": "a\n", ...files });
  repo.git("checkout", "-q", "-b", "feat/DASH-1");
  return repo;
}
const at = (repo, input = {}) => createContext({ row: { repo: { baseBranch: "main" } }, ...input }, { cwd: repo.dir });

test("node.lockfileExplained: a lockfile may change only with a dependency, or in its version", async () => {
  const { lockfileExplained } = helpers.node;
  const repo = nodeRepo();
  const r = await ok(lockfileExplained, at(repo));
  assert.deepEqual(r.notes, ["package-lock.json didn't change"]);
  repo.commit({ "package.json": PKG("1.0.1"), "package-lock.json": LOCK("1.0.1") }, "release");
  const v = await ok(lockfileExplained, at(repo));
  assert.deepEqual(v.notes, ["package-lock.json changed: only its version changed"]);
  repo.commit({ "package-lock.json": LOCK("1.0.1", "1.2.0") }, "npm install");
  await bad(lockfileExplained, at(repo), {}, /^package-lock\.json changed, but no dependency in package\.json did: undo it \(git checkout origin\/main -- package-lock\.json\): node_modules\/foo$/);
  repo.commit({ "package.json": PKG("1.0.1", { foo: "^1.2.0" }) }, "bump foo");
  const d = await ok(lockfileExplained, at(repo));
  assert.deepEqual(d.notes, ["package-lock.json changed: dependencies changed in package.json"]);

  // A workspace's package.json explains the root lockfile too; yarn.lock needs a dependency change.
  const ws = nodeRepo({ "yarn.lock": "foo@1\n", "packages/b/package.json": PKG("1.0.0", {}) });
  ws.commit({ "yarn.lock": "foo@2\n" });
  await bad(lockfileExplained, at(ws), { lockfile: "yarn.lock" }, /^yarn\.lock changed, but no dependency in package\.json did/);
  ws.commit({ "packages/b/package.json": PKG("1.0.0", { bar: "1" }), "package-lock.json": LOCK("1.0.0", "2.0.0") });
  await ok(lockfileExplained, at(ws));
  await bad(lockfileExplained, at(ws), { manifest: "package.json" }, /no dependency in package\.json did/);
  ws.git("rm", "-q", "yarn.lock");
  await bad(lockfileExplained, at(ws), { lockfile: "yarn.lock", manifest: "package.json" }, /^yarn\.lock was deleted, but no dependency changed: restore it/);
});

test("git.changesMatchPlan: only planned files, and the lockfile only when explained", async () => {
  const { changesMatchPlan } = helpers.git;
  const plan = { files: ["src/a.js"], newFiles: "src/b.js", tests: [{ acceptance: "x", file: "./test/a.test.js" }, { path: "docs/" }] };
  const repo = nodeRepo();
  repo.commit({ "src/a.js": "a2\n", "src/b.js": "b\n", "test/a.test.js": "t\n", "docs/x.md": "d\n" });
  const r = await ok(changesMatchPlan, at(repo, answer(plan)));
  assert.deepEqual(r.notes, ["4 changed files, all in the plan"]);
  repo.commit({ "package.json": PKG("1.0.1"), "package-lock.json": LOCK("1.0.1"), "CHANGELOG.md": "c\n" });
  await bad(changesMatchPlan, at(repo, answer(plan)), {}, /^Files the plan didn't name changed: undo them, or add them to the plan: CHANGELOG\.md, package\.json$/);
  await ok(changesMatchPlan, at(repo, answer(plan)), { alsoAllow: "CHANGELOG.md, package.json" });
  repo.commit({ "package-lock.json": LOCK("1.0.1", "9.9.9"), "src/unrelated.js": "u\n" });
  const b = await bad(changesMatchPlan, at(repo, answer(plan)), { alsoAllow: "CHANGELOG.md, package.json" }, /src\/unrelated\.js$/, /^package-lock\.json changed, but no dependency in package\.json did/);
  assert.equal(b.failures.length, 2);
  await ok(changesMatchPlan, at(repo, answer({ ...plan, files: ["src/*.js", "package*.json", "CHANGELOG.md"] })));
  await bad(changesMatchPlan, at(repo, answer({ summary: "s" })), {}, /^The handoff names no files in files, newFiles, tests/);
  await bad(changesMatchPlan, at(repo, { input: { answer: "no json" } }), {}, /The answer has no handoff/);
});

test("git.commitsScoped: each commit stays in the plan and names the item", async () => {
  const { commitsScoped } = helpers.git;
  const repo = nodeRepo();
  const input = { ...answer({ files: ["src/a.js", "test/a.test.js"] }), item: { id: "DASH-1" } };
  repo.commit({ "src/a.js": "a2\n" }, "DASH-1: change a");
  repo.commit({ "test/a.test.js": "t\n" }, "DASH-1: test a");
  const r = await ok(commitsScoped, at(repo, input));
  assert.deepEqual(r.notes, ["2 commits, each scoped and mentioning DASH-1"]);
  repo.commit({ "src/other.js": "o\n" }, "fix lint");
  const b = await bad(commitsScoped, at(repo, input), {}, /^Commit [0-9a-f]{7} "fix lint" changes files outside the plan.*: src\/other\.js$/, /^Commit [0-9a-f]{7} "fix lint" doesn't mention DASH-1/);
  assert.equal(b.failures.length, 2);
  await bad(commitsScoped, at(repo, input), { planKeys: "" }, /doesn't mention DASH-1/);
  await ok(commitsScoped, at(repo, input), { planKeys: "", mentions: "" });
  await ok(commitsScoped, at(repo, { ...input, item: {} }), { alsoAllow: "src/**" });
});

test("git.sourceHasTests: paired by name, or any test", async () => {
  const { sourceHasTests, pairedTest } = require("../helpers/git");
  assert.ok(pairedTest("<dir>/<name>.{test,spec}.*", "src/x/a.js").test("src/x/a.test.js"));
  assert.ok(pairedTest("<dir>/<name>.test.<ext>", "a.js").test("a.test.js"));
  assert.ok(pairedTest("{test,tests}/**/<name>.*", "src/[id].js").test("test/pages/[id].test.js"));
  assert.ok(!pairedTest("<dir>/<name>.test.*", "src/a.js").test("src/ab.test.js"));
  const repo = nodeRepo({ "src/b.js": "b\n" });
  await ok(sourceHasTests, at(repo));
  repo.commit({ "src/a.js": "a2\n", "src/a.test.js": "t\n", "src/c.jsx": "c\n", "test/c.test.js": "t\n", "src/index.js": "i\n", "README.md": "r\n" });
  await bad(sourceHasTests, at(repo), {}, /^Changed source with no changed test next to it: add or update its test.*: src\/index\.js$/);
  const r = await ok(sourceHasTests, at(repo), { exempt: "**/index.js" });
  assert.deepEqual(r.notes, ["2 source files, each with its test"]);
  repo.commit({ "src/b.js": "b2\n" });
  await bad(sourceHasTests, at(repo), { exempt: "**/index.js" }, /: src\/b\.js$/);
  await ok(sourceHasTests, at(repo), { mode: "any" });
  const only = nodeRepo();
  only.commit({ "src/a.js": "a2\n" });
  await bad(sourceHasTests, at(only), { mode: "any" }, /^Source changed but no test did: add or update a test: src\/a\.js$/);
});

test("git.noNewMatches: only added lines count", async () => {
  const { noNewMatches } = helpers.git;
  const repo = nodeRepo({ "src/old.js": "// TODO old debt\nconsole.log(1);\n" });
  const p = { glob: "src/**/*.js, !**/*.test.js", pattern: "\\b(TODO|FIXME)\\b|console\\.log\\(" };
  await ok(noNewMatches, at(repo), p);
  repo.commit({ "src/old.js": "// TODO old debt\nconsole.log(1);\nconst x = 2;\n", "src/a.test.js": "console.log('fine in tests')\n" });
  const r = await ok(noNewMatches, at(repo), p);
  assert.deepEqual(r.notes, ["No match in 1 added line"]);
  repo.write({ "src/new.js": "ok\n// FIXME later\n", "src/old.js": "// TODO old debt\nconsole.log(1);\nconst x = 2;\nconsole.log(x);\n" });
  await bad(noNewMatches, at(repo), p, /^2 added lines match \/.*\/: remove them: src\/old\.js:4, src\/new\.js:2$/);
  await bad(noNewMatches, at(repo), { ...p, message: "Do the TODO or file a ticket" }, /^Do the TODO or file a ticket: /);
});

test("files.maxGrowth: big new files, files that cross the line, and big files that grow a lot", async () => {
  const { maxGrowth, lineCount } = require("../helpers/files");
  assert.equal(lineCount("a\nb\n"), 2);
  assert.equal(lineCount("a\nb"), 2);
  assert.equal(lineCount(""), 0);
  const lines = (n) => Array.from({ length: n }, (_, i) => `l${i}`).join("\n") + "\n";
  const repo = nodeRepo({ "src/big.js": lines(20), "src/mid.js": lines(8) });
  const p = { maxLines: 10, maxAdded: 3 };
  await ok(maxGrowth, at(repo), p);
  repo.commit({ "src/big.js": lines(23), "src/mid.js": lines(10), "src/new.js": lines(10), "data.json": lines(50) });
  const r = await ok(maxGrowth, at(repo), p);
  assert.match(r.notes[0], /^3 changed files checked/);
  repo.commit({ "src/big.js": lines(24), "src/mid.js": lines(11), "src/huge.js": lines(11) });
  const b = await bad(maxGrowth, at(repo), p,
    /^src\/big\.js already has 20 lines and grew by 4 \(most: 3\): put the new code in its own module$/,
    /^src\/huge\.js is new and has 11 lines \(most: 10\): split it/,
    /^src\/mid\.js grew past 10 lines \(8 → 11\)/);
  assert.equal(b.failures.length, 3);
  await ok(maxGrowth, at(repo), { ...p, exempt: "src/big.js, src/huge.js, src/mid.js" });
});

test("git.validateLeavesTreeClean: validation mustn't rewrite tracked files", async () => {
  const { validateLeavesTreeClean } = helpers.git;
  const repo = nodeRepo();
  const r = await ok(validateLeavesTreeClean, at(repo), { command: "true" });
  assert.deepEqual(r.notes, ["true passed and left the tree as it was"]);
  await bad(validateLeavesTreeClean, at(repo), { command: "echo formatted > src/a.js" }, /^echo formatted > src\/a\.js changed files: make it check instead of rewrite.*: src\/a\.js$/);
  await bad(validateLeavesTreeClean, at(repo), { command: "true" }, /^There are uncommitted changes before true: commit or discard them first: src\/a\.js$/);
  await ok(validateLeavesTreeClean, at(repo), { command: "true", allowDirtyBefore: true });
  repo.git("checkout", "-q", "--", ".");
  await bad(validateLeavesTreeClean, at(repo), { command: "exit 3" }, /^exit 3 failed \(exit 3\)/);
});

test("node.testScriptIsReal: no no-op test scripts", async () => {
  const { testScriptIsReal, noOpScript } = require("../helpers/node");
  for (const s of ["", "exit 0", "true", "echo no tests", 'echo "Error: no test specified" && exit 1', "jest || true", "jest; exit 0"]) {
    assert.ok(noOpScript(s), s);
  }
  for (const s of ["jest", "node --test test/*.test.js", "./scripts/ci.sh && echo done"]) assert.equal(noOpScript(s), null, s);
  const dir = tmpdir();
  const ctx = createContext({}, { cwd: dir });
  await bad(testScriptIsReal, ctx, {}, /^package\.json isn't in the workspace$/);
  write(dir, { "package.json": { name: "t", scripts: { test: "exit 0" } } });
  await bad(testScriptIsReal, ctx, {}, /^The "test" script does nothing \("exit 0"\): make it run the tests$/);
  write(dir, { "package.json": { name: "t", scripts: { lint: "x" } } });
  await bad(testScriptIsReal, ctx, {}, /^package\.json has no "test" script/);
  write(dir, { "package.json": { name: "t", scripts: { test: "node -e \"console.log('# pass 0')\"", unit: "node -e \"console.log('# pass 2')\"", quiet: "node -e \"\"" } } });
  await ok(testScriptIsReal, ctx);
  await bad(testScriptIsReal, ctx, { run: true }, /^npm test ran 0 tests; it needs at least 1$/);
  const r = await ok(testScriptIsReal, ctx, { script: "unit", run: true, minTests: 2 });
  assert.deepEqual(r.notes, ["2 tests passed"]);
  await bad(testScriptIsReal, ctx, { script: "quiet", run: "yes" }, /doesn't say how many tests ran/);
  await ok(testScriptIsReal, ctx, { script: "quiet", run: true, minTests: 0 });
});

test("node.newTestsAreRun: a new test file is named or matched by a runner", async () => {
  const { newTestsAreRun } = helpers.node;
  const repo = nodeRepo({ "scripts/ci.sh": "node --test test/old.test.js\n", "test/old.test.js": "t\n" });
  const p = { runnerFiles: "package.json, scripts/ci.sh" };
  await ok(newTestsAreRun, at(repo), p);
  repo.commit({ "test/old.test.js": "t2\n", "test/new.test.js": "n\n", "src/a.test.js": "a\n" });
  await bad(newTestsAreRun, at(repo), p, /^New test files no runner runs: add them to package\.json or scripts\/ci\.sh.*: src\/a\.test\.js, test\/new\.test\.js$/);
  await bad(newTestsAreRun, at(repo), { ...p, autoGlobs: "src/**/*.test.js" }, /: test\/new\.test\.js$/);
  repo.commit({ "scripts/ci.sh": "node --test test/old.test.js test/new.test.js\n" });
  const r = await ok(newTestsAreRun, at(repo), { ...p, autoGlobs: "src/**/*.test.js" });
  assert.deepEqual(r.notes, ["2 new test files, each run"]);
  repo.commit({ "package.json": { ...PKG("1.0.0"), scripts: { test: "node --test 'src/**/*.test.js'" } } });
  await ok(newTestsAreRun, at(repo), p);
});

test("a list param keeps the commas in a glob's {a,b}", async () => {
  const seen = [];
  const h = defineHelper({ id: "test.list", label: "List", params: { globs: { type: "list" } }, run: (_c, p) => seen.push(p.globs) });
  await ok(h, createContext({}), { globs: "**/*.{js,jsx}, !src/{a,b}/**,x" });
  assert.deepEqual(seen[0], ["**/*.{js,jsx}", "!src/{a,b}/**", "x"]);
});
