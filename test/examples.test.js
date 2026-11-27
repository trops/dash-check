"use strict";

/**
 * Every example in examples/ passes on its .sample.json and fails, with a
 * reason that says what to fix, on its .bad.json. Examples that look at the
 * workspace, GitHub or a tracker get a temp repo, a fake GitHub or a fake
 * tool here.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { runFile } = require("..");
const { tmpdir, cleanup, write, makeRepo, fakeFetch } = require("./_util");

require("node:test").after(cleanup);

const DIR = path.join(__dirname, "..", "examples");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const fileOf = (name) => path.join(DIR, fs.existsSync(path.join(DIR, `${name}.check.js`)) ? `${name}.check.js` : `${name}.check.json`);

/** Run an example on its pass and fail samples; `env(kind)` gives createContext options. */
async function both(name, { env = () => ({}), bad: badRe }) {
  const good = await runFile(fileOf(name), read(`${name}.sample.json`), await env("good"));
  assert.equal(good.pass, true, `${name} should pass on its sample: ${good.reason}`);
  const bad = await runFile(fileOf(name), read(`${name}.bad.json`), await env("bad"));
  assert.equal(bad.pass, false, `${name} should fail on its bad sample`);
  if (badRe) assert.match(bad.reason, badRe);
  return { good, bad };
}

test("every example has a check, a passing sample and a failing one, and a test here", () => {
  const names = fs.readdirSync(DIR).filter((f) => /\.check\.(js|json)$/.test(f)).map((f) => f.replace(/\.check\.(js|json)$/, ""));
  assert.equal(names.length, 13);
  const src = fs.readFileSync(__filename, "utf8");
  for (const n of names) {
    assert.ok(fs.existsSync(path.join(DIR, `${n}.sample.json`)), `${n}.sample.json`);
    assert.ok(fs.existsSync(path.join(DIR, `${n}.bad.json`)), `${n}.bad.json`);
    assert.ok(src.includes(`both("${n}"`), `a test for ${n}`);
  }
});

test("1. ticket-has-acceptance", () => both("ticket-has-acceptance", { bad: /^The ticket has no acceptance items: add them/ }));

test("2. plan-complete", async () => {
  const { bad } = await both("plan-complete", {});
  assert.equal(bad.reason, `The plan has no fix; The plan has no test; "some-other-repo" isn't in the Repos table (code-factory-sandbox)`);
});

test("3. on-branch", () => {
  const repo = makeRepo();
  repo.git("checkout", "-q", "-b", "feat/DASH-97-titlecase");
  return both("on-branch", { env: () => ({ cwd: repo.dir }), bad: /^The workspace is on another branch, not feat\/DASH-97-somewhere-else$/ });
});

test("4. setup (npm ci)", () => {
  const lock = { name: "s", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "s", version: "1.0.0" } } };
  const good = tmpdir();
  write(good, { "package.json": { name: "s", version: "1.0.0" }, "package-lock.json": lock });
  const bad = tmpdir();
  write(bad, { "package.json": { name: "s", version: "1.0.0" } });
  return both("setup", { env: (k) => ({ cwd: k === "good" ? good : bad }), bad: /^npm ci failed:\n/ });
});

test("5. every-acceptance-has-a-test", async () => {
  const dir = tmpdir();
  write(dir, { "package.json": "{}" });
  const { bad } = await both("every-acceptance-has-a-test", { env: () => ({ cwd: dir }) });
  assert.equal(bad.reason, "No test for: Dashes are kept; No test for: Empty names stay empty; The plan names src/invented.js, which isn't in the repo (list new files in newFiles)");
});

test("6. validate (lint and tests)", async () => {
  const good = tmpdir();
  write(good, { "package.json": { name: "v", scripts: { lint: "node -e \"\"", test: "node -e \"\"" } } });
  const bad = tmpdir();
  write(bad, { "package.json": { name: "v", scripts: { lint: "node -e \"\"", test: "node -e \"console.log('1 test failed'); process.exit(1)\"" } } });
  const r = await both("validate", { env: (k) => ({ cwd: k === "good" ? good : bad }), bad: /1 test failed/ });
  assert.deepEqual(r.bad.checks.map((c) => [c.name, c.pass]), [["lint passes", true], ["tests pass", false]], "each part is reported apart");
});

test("7. work-committed", async () => {
  const repo = makeRepo();
  repo.git("checkout", "-q", "-b", "feat/DASH-97");
  repo.commit({ "src/a.js": "a\n" }, "DASH-97: title case");
  const { bad } = await both("work-committed", { env: () => ({ cwd: repo.dir }) });
  assert.equal(bad.reason, "The commit message should start with DASH-98");
  repo.write({ "src/b.js": "b\n" });
  const dirty = await runFile(fileOf("work-committed"), read("work-committed.sample.json"), { cwd: repo.dir });
  assert.equal(dirty.reason, "There are uncommitted changes");
});

test("8. changes-match-plan", () => {
  const repo = makeRepo({ "src/index.js": "x\n", "package-lock.json": "{}" });
  repo.git("checkout", "-q", "-b", "feat/DASH-97");
  repo.commit({ "src/index.js": "y\n", "src/title.js": "t\n", "test/title.test.js": "t\n", "package-lock.json": "{ }" });
  return both("changes-match-plan", { env: () => ({ cwd: repo.dir }), bad: /^Changed files the plan didn't name: src\/title\.js, test\/title\.test\.js$/ });
});

const GH = "repos/trops/code-factory-sandbox";
test("9. pr-ci (fails closed)", async () => {
  const fetch = fakeFetch({
    [`${GH}/pulls/12`]: { number: 12, state: "open", head: { sha: "good" } },
    [`${GH}/pulls/13`]: { number: 13, state: "open", head: { sha: "bad" } },
    [`${GH}/commits/good/check-runs?per_page=100`]: { check_runs: [{ name: "test", status: "completed", conclusion: "success" }] },
    [`${GH}/commits/bad/check-runs?per_page=100`]: { check_runs: [{ name: "test", status: "completed", conclusion: "failure" }] },
  });
  await both("pr-ci", { env: () => ({ fetch, env: { GH_TOKEN: "x" } }), bad: /^CI failed: test \(failure\)$/ });
  // No CI at all is a failure that says what to do.
  let t = 0;
  const none = fakeFetch({ [`${GH}/pulls/12`]: { number: 12, state: "open", head: { sha: "s" } }, [`${GH}/commits/s/check-runs?per_page=100`]: { check_runs: [] } });
  const r = await runFile(fileOf("pr-ci"), read("pr-ci.sample.json"), { fetch: none, env: {}, now: () => t, sleep: async (ms) => (t += ms) });
  assert.equal(r.pass, false);
  assert.match(r.reason, /has no CI\. Enable Actions on the repo/);
});

test("10. merge-outcome", () => {
  const fetch = fakeFetch({ [`${GH}/pulls/12`]: { number: 12, state: "closed", merged: true, head: { sha: "s" } } });
  return both("merge-outcome", { env: () => ({ fetch, env: {} }), bad: /^PR #12 was merged, but Merge when green is off$/ });
});

test("11. workspace-cleaned", () => {
  const dir = tmpdir();
  return both("workspace-cleaned", { env: () => ({ cwd: dir }), bad: /is still there$/ });
});

test("12. jira-comment-from-job (a fake tool stands in for Dash)", async () => {
  const calls = [];
  const tool = async (provider, name, args) => {
    calls.push([provider, name, args]);
    return { comments: [{ created: "2026-11-26T08:01:00Z", body: "Done" }] };
  };
  await both("jira-comment-from-job", { env: () => ({ tool }), bad: /^No comment on DASH-97 since this job started$/ });
  assert.deepEqual(calls[0], ["jira", "listJiraIssueComments", { issueIdOrKey: "DASH-97", orderBy: "-created", maxResults: 5 }]);
  const outside = await runFile(fileOf("jira-comment-from-job"), read("jira-comment-from-job.sample.json"), { env: {} });
  assert.match(outside.reason, /only works when Dash runs the check/);
});

test("13. ready-for-review (the mockup's recipe)", async () => {
  const repo = makeRepo({ "package.json": { name: "t", scripts: { test: "node -e \"console.log('# pass 3')\"" } } });
  repo.git("checkout", "-q", "-b", "feat/DASH-97-titlecase");
  repo.commit({ "src/index.js": "module.exports = (s) => s;\n" });
  const r = await both("ready-for-review", { env: () => ({ cwd: repo.dir }), bad: /^The handoff lists no changed files$/ });
  assert.deepEqual(r.good.steps.map((s) => s.reason), ["1 commit past origin/main, nothing uncommitted", "3 tests passed", "No match in 1 file", "Passed"]);
});
