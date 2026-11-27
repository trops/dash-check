"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createContext, lastJsonBlock, readHandoff, fill, get, when, valuePaths } = require("..");
const { tmpdir, cleanup, write, makeRepo, fakeFetch, answer } = require("./_util");

require("node:test").after(cleanup);

test("the handoff is read the way Dash reads it", () => {
  // the whole answer when it's JSON
  assert.deepEqual(lastJsonBlock('{"a":1}').value, { a: 1 });
  // else the last ```json (or bare ```) block; other languages are skipped
  const t = 'x\n```json\n{"a":1}\n```\nthen\n```\n{"a":2}\n```\n```bash\necho {}\n```';
  assert.deepEqual(lastJsonBlock(t).value, { a: 2 });
  // a broken last block says so
  const b = lastJsonBlock('```json\n{"a":1}\n```\n```json\n{oops}\n```');
  assert.equal(b.found, false);
  assert.equal(b.broken, true);
  // none
  assert.equal(lastJsonBlock("just text").found, false);
  // in a check input
  const h = readHandoff(answer({ files: ["a"], status: "OK " }));
  assert.deepEqual(h.handoff, { files: ["a"], status: "ok" });
  assert.equal(readHandoff(answer({ x: 1 })).handoff.status, "ok", "status defaults to ok");
  assert.deepEqual(readHandoff({ input: "no json" }).handoff, {});
  assert.deepEqual(readHandoff({ input: { answer: "[1,2]" } }).info, { found: false, list: true });
  assert.deepEqual(readHandoff({ handoff: { a: 1 } }).handoff, { a: 1, status: "ok" }, "a handoff Dash parsed is used as is");
});

test("the context's data readers are {} outside Dash", () => {
  const ctx = createContext({}, { env: {} });
  for (const k of ["handoff", "item", "picks", "row", "settings", "step", "job"]) assert.deepEqual(ctx[k], {}, k);
  assert.deepEqual(ctx.input, {});
  assert.equal(ctx.answer, "");
  const full = createContext(
    answer({ files: ["x"] }, { item: { id: "DASH-1" }, picks: { repo: "r" }, row: { repo: { baseBranch: "dev" } }, settings: { workRoot: "/w" }, job: { id: "j" }, step: { name: "Coder" } }),
    { env: { DASH_BRANCH: "feat/x", A: "1" } },
  );
  assert.equal(full.item.id, "DASH-1");
  assert.equal(full.picks.repo, "r");
  assert.equal(full.row.repo.baseBranch, "dev");
  assert.equal(full.settings.workRoot, "/w");
  assert.equal(full.job.id, "j");
  assert.equal(full.step.name, "Coder");
  assert.equal(full.env.A, "1");
  assert.equal(full.workspace.branch, "feat/x", "the branch falls back to DASH_BRANCH");
  assert.deepEqual(createContext({}, { env: { DASH_STEP: "Coder" } }).step, { name: "Coder", inputs: {} });
});

test("get, fill and when read values by path", () => {
  const ctx = createContext(answer({ files: ["a", "b"], prUrl: "" }, { item: { id: "DASH-1" }, row: { repo: { baseBranch: "dev" } }, settings: { approve: "false", workRoot: "/w", n: 3 } }), { env: { E: "x" } });
  assert.deepEqual(get(ctx, "handoff.files"), ["a", "b"]);
  assert.equal(get(ctx, "handoff.files.1"), "b");
  assert.equal(get(ctx, "handoff.files.length"), 2);
  assert.equal(get(ctx, "repo.baseBranch"), "dev", "a row by its table name");
  assert.equal(get(ctx, "workRoot"), "/w", "a team setting by its name");
  assert.equal(get(ctx, "env.E"), "x");
  assert.equal(fill(ctx, "{repo.baseBranch}"), "dev");
  assert.equal(fill(ctx, "{n}"), 3, "a lone placeholder keeps its type");
  assert.equal(fill(ctx, "{workRoot}/{item.id}"), "/w/DASH-1");
  assert.equal(fill(ctx, "{{literal}} \\d{2}"), "{literal} \\d{2}");
  assert.deepEqual(fill(ctx, { a: ["{item.id}"] }), { a: ["DASH-1"] });
  assert.throws(() => fill(ctx, "{repo.nope}"), /\{repo\.nope\} has no value here/);
  assert.throws(() => fill(ctx, "{item.title}"), /the job has no item\.title/);
  assert.equal(fill(ctx, "x{item.title}", { missing: "empty" }), "x");
  assert.equal(fill(ctx, "{item.title}", { missing: "keep" }), "{item.title}");
  assert.equal(when(ctx, "handoff.files"), true);
  assert.equal(when(ctx, "handoff.prUrl"), false);
  assert.equal(when(ctx, "{approve}"), false, '"false" is false');
  assert.equal(when(ctx, "!{approve}"), true);
  assert.equal(when(ctx, "{missing.thing}"), false);
  assert.equal(ctx.when("item.id"), true);
  const paths = valuePaths(ctx).map((p) => p.path);
  assert.ok(paths.includes("handoff.files") && paths.includes("item.id") && paths.includes("row.repo.baseBranch"), paths.join(" "));
});

test("ctx.fs reads the workspace", async () => {
  const dir = tmpdir();
  write(dir, { "src/a.js": "a", "src/deep/b.js": "b", "src/c.ts": "c", "data.json": '{"k":1}', "bad.json": "{", "node_modules/x/i.js": "" });
  const { fs: f, workspace } = createContext({}, { cwd: dir });
  assert.equal(await f.exists("src/a.js"), true);
  assert.equal(await f.exists("nope"), false);
  assert.equal(await f.dirExists("src"), true);
  assert.equal(await f.dirExists("src/a.js"), false);
  assert.equal(await f.read("src/a.js"), "a");
  assert.deepEqual(await f.readJson("data.json"), { k: 1 });
  await assert.rejects(() => f.read("nope.txt"), /Can't read nope\.txt: the file isn't there/);
  await assert.rejects(() => f.readJson("bad.json"), /bad\.json isn't valid JSON/);
  assert.deepEqual(await f.list("src/**/*.js"), ["src/a.js", "src/deep/b.js"]);
  assert.deepEqual(await f.list(["**/*.js", "!src/deep/**"]), ["src/a.js"], "node_modules is skipped, ! leaves out");
  assert.deepEqual(await f.list("src/*.{js,ts}"), ["src/a.js", "src/c.ts"]);
  assert.equal(await workspace.exists("data.json"), true);
  assert.equal(await workspace.dirExists(), true);
  const gone = createContext({ workspace: { dir: path.join(dir, "gone") } }, { cwd: dir });
  assert.equal(await gone.workspace.dirExists(), false);
});

test("ctx.run runs a command in the workspace", async () => {
  const dir = tmpdir();
  const { run } = createContext({}, { cwd: dir, env: { ...process.env, X: "hi" } });
  const ok = await run('echo "$X" && pwd');
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.split("\n")[0], "hi");
  assert.equal(fs.realpathSync(ok.stdout.split("\n")[1].trim()), dir);
  const bad = await run("echo oops >&2; exit 3");
  assert.equal(bad.code, 3);
  assert.equal(bad.stderr.trim(), "oops");
  const slow = await run("sleep 5", { timeoutSec: 0.3 });
  assert.equal(slow.timedOut, true);
  assert.match(slow.stderr, /Stopped after 0\.3 seconds/);
});

test("ctx.git reads the repo", async () => {
  const repo = makeRepo({ "README.md": "x\n", "package.json": '{"name":"t"}' });
  repo.git("checkout", "-q", "-b", "feat/DASH-1");
  repo.commit({ "src/a.js": "a" }, "DASH-1: add a");
  const { git } = createContext({}, { cwd: repo.dir });
  assert.equal(await git.branch(), "feat/DASH-1");
  assert.equal(await git.isClean(), true);
  assert.equal(await git.commitsSince("origin/main"), 1);
  assert.equal(await git.lastCommitMessage(), "DASH-1: add a");
  assert.equal(await git.defaultBranch(), "main");
  assert.equal(await git.remoteHas("main"), true);
  assert.equal(await git.remoteHas("feat/DASH-1"), false);
  assert.match(await git.fileAt("origin/main", "package.json"), /"name"/);
  assert.equal(await git.fileAt("origin/main", "nope"), null);
  repo.write({ "src/b.js": "b", "README.md": "changed\n" });
  assert.equal(await git.isClean(), false);
  assert.deepEqual((await git.uncommitted()).sort(), ["README.md", "src/b.js"]);
  assert.deepEqual(await git.changedFiles("origin/main"), ["README.md", "src/a.js", "src/b.js"]);
  await assert.rejects(() => git.commitsSince("origin/nope"), /origin\/nope isn't there: fetch it \(git fetch origin nope\)/);
  const notRepo = createContext({}, { cwd: tmpdir() }).git;
  await assert.rejects(() => notRepo.branch(), /isn't a git repo/);
});

test("ctx.git.addedLines: committed, uncommitted and untracked lines, numbered as the file is now", async () => {
  const repo = makeRepo({ "src/a.js": "one\ntwo\nthree\n", "img.bin": "\0\x01" });
  repo.git("checkout", "-q", "-b", "feat/DASH-2");
  repo.commit({ "src/a.js": "one\nTODO two\nthree\n++ looks like a header\n" }, "DASH-2: a");
  repo.write({ "src/a.js": "zero\none\nTODO two\nthree\n++ looks like a header\n", "new dir/b.js": "b1\nb2", "bin.dat": "\0x" });
  repo.git("rm", "-q", "img.bin");
  const { git } = createContext({}, { cwd: repo.dir });
  assert.deepEqual(await git.addedLines("origin/main"), [
    { file: "src/a.js", line: 1, text: "zero" },
    { file: "src/a.js", line: 3, text: "TODO two" },
    { file: "src/a.js", line: 5, text: "++ looks like a header" },
    { file: "new dir/b.js", line: 1, text: "b1" },
    { file: "new dir/b.js", line: 2, text: "b2" },
  ]);
  await assert.rejects(() => git.addedLines("origin/nope"), /origin\/nope isn't there/);
  assert.deepEqual(await createContext({}, { cwd: makeRepo().dir }).git.addedLines("origin/main"), []);
});

test("ctx.git.commits: each commit past a ref, oldest first, with its files", async () => {
  const repo = makeRepo({ "README.md": "x\n" });
  repo.git("checkout", "-q", "-b", "feat/DASH-3");
  repo.commit({ "src/a.js": "a\n" }, "DASH-3: add a\n\nWith a body.");
  repo.commit({ "src/b.js": "b\n", "README.md": "y\n" }, "fix lint");
  const { git } = createContext({}, { cwd: repo.dir });
  const list = await git.commits("origin/main");
  assert.deepEqual(list.map((c) => [c.subject, c.message, c.files, c.parents.length]), [
    ["DASH-3: add a", "DASH-3: add a\n\nWith a body.", ["src/a.js"], 1],
    ["fix lint", "fix lint", ["README.md", "src/b.js"], 1],
  ]);
  assert.match(list[0].sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(await git.commits("HEAD"), []);
  await assert.rejects(() => git.commits("origin/nope"), /origin\/nope isn't there/);
});

test("ctx.github uses GH_TOKEN and says the HTTP code on failure", async () => {
  const f = fakeFetch({
    "repos/o/r/pulls/12": { number: 12, state: "open", merged: false, head: { sha: "abc" } },
    "repos/o/r/commits/abc/check-runs?per_page=100": { check_runs: [{ name: "test", status: "completed", conclusion: "success" }] },
    "repos/o/r/pulls/13": { status: 404, body: {} },
    "repos/o/r/pulls/14": { status: 401, body: {} },
  });
  const { github } = createContext({}, { env: { GH_TOKEN: "t0k" }, fetch: f });
  const pr = await github.pr("https://github.com/o/r/pull/12");
  assert.equal(pr.state, "open");
  assert.equal(pr.slug, "o/r");
  assert.equal(f.calls[0].headers.Authorization, "Bearer t0k");
  const checks = await github.checksFor("abc");
  assert.deepEqual(checks.runs.map((r) => r.name), ["test"]);
  await assert.rejects(() => github.pr("https://github.com/o/r/pull/13"), /GitHub said HTTP 404 for PR #13 on o\/r: .*check the link and the token's repo access/);
  await assert.rejects(() => github.pr("https://github.com/o/r/pull/14"), /HTTP 401.*GH_TOKEN is wrong or expired/);
  await assert.rejects(() => github.pr("not a link"), /isn't a GitHub PR link/);
  const pr2 = await github.pr(12, { repo: "o/r" });
  assert.equal(pr2.number, 12);
  const noRepo = createContext({}, { env: {}, fetch: f, cwd: tmpdir() }).github;
  await assert.rejects(() => noRepo.pr(5), /Don't know which GitHub repo/);
});

test("ctx.github falls back to Actions runs, and waitForChecks waits with a deadline", async () => {
  let t = 0;
  const clock = { now: () => t, sleep: async (ms) => (t += ms) };
  let polls = 0;
  const f = fakeFetch({
    "repos/o/r/commits/s1/check-runs?per_page=100": { status: 403, body: {} },
    "repos/o/r/actions/runs?head_sha=s1&per_page=100": { workflow_runs: [{ name: "CI", status: "completed", conclusion: "failure" }] },
    "repos/o/r/commits/s2/check-runs?per_page=100": () => {
      polls++;
      return { check_runs: polls < 3 ? [{ name: "t", status: "in_progress" }] : [{ name: "t", status: "completed", conclusion: "success" }] };
    },
    "repos/o/r/commits/s3/check-runs?per_page=100": { check_runs: [] },
    "repos/o/r/commits/s4/check-runs?per_page=100": { check_runs: [{ name: "slow", status: "queued" }] },
    "repos/o/r/commits/s5/check-runs?per_page=100": { status: 500, body: {} },
    "repos/o/r/actions/runs?head_sha=s5&per_page=100": { status: 404, body: {} },
  });
  const { github } = createContext({}, { env: { GITHUB_REPOSITORY: "o/r" }, fetch: f, ...clock });
  const a = await github.checksFor("s1");
  assert.equal(a.source, "actions");
  const failed = await github.waitForChecks("s1");
  assert.deepEqual(failed.failed.map((r) => r.name), ["CI"]);
  const done = await github.waitForChecks("s2", { pollSec: 10 });
  assert.equal(done.passed.length, 1);
  assert.equal(polls, 3);
  const none = await github.waitForChecks("s3", { noChecksAfterSec: 60, pollSec: 15 });
  assert.equal(none.noChecks, true);
  assert.ok(none.waitedSec >= 60);
  const slow = await github.waitForChecks("s4", { timeoutSec: 100, pollSec: 15 });
  assert.equal(slow.timedOut, true);
  assert.deepEqual(slow.pending.map((r) => r.name), ["slow"]);
  await assert.rejects(() => github.checksFor("s5"), /HTTP 500 for check runs and HTTP 404 for Actions runs on o\/r: give GH_TOKEN read access/);
});

test("ctx.tool fails clearly outside Dash, and can be given in a test", async () => {
  const out = createContext({}, { env: {} });
  await assert.rejects(() => out.tool("jira", "getJiraIssue", {}), /only works when Dash runs the check/);
  const fake = createContext({}, { tool: async (p, n, a) => ({ p, n, a }) });
  assert.deepEqual(await fake.tool("jira", "getJiraIssue", { k: 1 }), { p: "jira", n: "getJiraIssue", a: { k: 1 } });
});

test("ctx.tool talks to Dash over DASH_TOOL_SOCKET", async () => {
  const net = require("net");
  const sock = path.join(tmpdir(), "tool.sock");
  const server = net.createServer((c) => {
    c.on("data", (d) => {
      const req = JSON.parse(d.toString());
      if (req.tool === "boom") c.write(`${JSON.stringify({ id: req.id, error: "no such tool" })}\n`);
      else c.write(`${JSON.stringify({ id: req.id, result: { key: req.args.issueIdOrKey, provider: req.provider } })}\n`);
    });
  });
  await new Promise((r) => server.listen(sock, r));
  try {
    const { tool } = createContext({}, { env: { DASH_TOOL_SOCKET: sock } });
    assert.deepEqual(await tool("jira", "getJiraIssue", { issueIdOrKey: "DASH-1" }), { key: "DASH-1", provider: "jira" });
    await assert.rejects(() => tool("jira", "boom"), /jira\.boom failed \(no such tool\)/);
  } finally {
    server.close();
  }
});
