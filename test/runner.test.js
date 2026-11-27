"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { check, describe, run, expect, fail, note, createContext, runChecks, loadChecks, lastLine, report, runFile, takeChecks } = require("..");
const { tmpdir, cleanup, write, answer } = require("./_util");

require("node:test").after(cleanup);

const ROOT = path.resolve(__dirname, "..");
const REGISTER = path.join(ROOT, "lib", "register.js");
const cleanEnv = () => {
  const e = { ...process.env };
  delete e.NODE_TEST_CONTEXT;
  return e;
};

test("a run gives { pass, reason, checks: [{ name, pass, reason, failures }] }", async () => {
  check("passes", () => expect(1).toBe(1));
  check("notes how it passed", () => note("3 tests passed"));
  check("fails twice", async (ctx) => {
    expect(ctx.handoff.files, "handoff.files").not.toBeEmpty("No files");
    await Promise.resolve();
    fail("Remove console.log from src", { at: "src/index.js:12" });
  });
  check("throws", () => {
    throw new Error("broke");
  });
  const r = await run(answer({ files: [] }));
  assert.equal(r.pass, false);
  assert.deepEqual(r.checks.map((c) => [c.name, c.pass]), [["passes", true], ["notes how it passed", true], ["fails twice", false], ["throws", false]]);
  assert.equal(r.checks[1].reason, "3 tests passed");
  assert.deepEqual(r.checks[2].failures.map((f) => f.message), ["No files", "Remove console.log from src"]);
  assert.equal(r.checks[2].failures[1].at, "src/index.js:12");
  assert.equal(r.checks[2].reason, "No files; Remove console.log from src: src/index.js:12");
  assert.equal(r.checks[3].failures[0].message, "broke");
  assert.equal(r.reason, "No files; Remove console.log from src: src/index.js:12; broke");
  for (const c of r.checks) assert.equal(typeof c.ms, "number");
});

test("a passing run says what passed", async () => {
  check("only one", () => note("all good"));
  assert.equal((await run({})).reason, "only one: all good");
  check("a", () => {});
  check("b", () => {});
  const r = await run({});
  assert.equal(r.pass, true);
  assert.equal(r.reason, "2 checks passed: a; b");
  assert.equal((await run({})).pass, false, "no checks fails closed");
});

test("check.skip, check.only and describe", async () => {
  describe("plan", () => {
    check("has a cause", () => {});
    check.skip("has a fix", () => expect(1).toBe(2));
  });
  let r = await run({});
  assert.deepEqual(r.checks.map((c) => c.name), ["plan › has a cause", "plan › has a fix"]);
  assert.equal(r.checks[1].skipped, true);
  assert.equal(r.pass, true);
  check("x", () => expect(1).toBe(2));
  check.only("y", () => {});
  r = await run({});
  assert.deepEqual(r.checks.map((c) => [c.name, !!c.skipped]), [["x", true], ["y", false]]);
  assert.equal(r.pass, true);
  assert.throws(() => describe("async", async () => {}), /can't be async/);
  takeChecks();
  assert.throws(() => check("", () => {}), /give the check a name/);
});

test("the last line is Dash's contract: one JSON line with reason and details", async () => {
  check("a", () => expect([1, 2], "list").toHaveLength(1, "Too many"));
  const r = await run({});
  const line = lastLine(r);
  assert.ok(!line.includes("\n"));
  const v = JSON.parse(line);
  assert.deepEqual(Object.keys(v), ["reason", "details"]);
  assert.equal(v.reason, "Too many");
  assert.deepEqual(v.details.checks, [{ name: "a", pass: false, reason: "Too many", failures: [{ message: "Too many", expected: 1, received: [1, 2] }] }]);
  assert.match(report(r, { title: "x.check.js" }), /^ FAIL  x\.check\.js\n  ✗ a\n      ● Too many$/);
});

test("a .check.js file runs itself under node, the way Dash runs a repo check", () => {
  const dir = tmpdir();
  write(dir, {
    "input.json": answer({ acceptance: ["a"] }),
    "bad.json": answer({ acceptance: [] }),
    "ok.check.js": `const { check, expect } = require("@trops/dash-check");
console.log("a line of the check's own");
check("has acceptance", ({ handoff }) => { expect(handoff.acceptance, "handoff.acceptance").not.toBeEmpty("No acceptance items"); });
`,
  });
  const go = (input) => spawnSync(process.execPath, ["-r", REGISTER, path.join(dir, "ok.check.js")], {
    cwd: dir,
    env: { ...cleanEnv(), DASH_INPUT: path.join(dir, input) },
    encoding: "utf8",
  });
  const good = go("input.json");
  assert.equal(good.status, 0, good.stderr);
  const lines = good.stdout.trim().split("\n");
  assert.equal(lines[0], "a line of the check's own");
  assert.match(lines[1], /✓ has acceptance/);
  assert.deepEqual(JSON.parse(lines[lines.length - 1]).reason, "Passed: has acceptance");
  const bad = go("bad.json");
  assert.equal(bad.status, 1);
  const last = JSON.parse(bad.stdout.trim().split("\n").pop());
  assert.equal(last.reason, "No acceptance items");
  assert.equal(last.details.checks[0].pass, false);
});

test("loadChecks and runFile run a file in this process", async () => {
  const dir = tmpdir();
  write(dir, {
    "x.check.js": `const { check, expect } = require("@trops/dash-check");
check("item is set", ({ item }) => expect(item.id, "item.id").toBeDefined("No item"));`,
  });
  const file = path.join(dir, "x.check.js");
  require("../lib/register");
  assert.deepEqual(loadChecks(file).map((c) => c.name), ["item is set"]);
  assert.equal((await runFile(file, { item: { id: "A-1" } })).pass, true);
  const r = await runFile(file, {});
  assert.equal(r.reason, "No item");
  const ctx = createContext({ item: { id: "B" } });
  assert.equal((await runChecks(loadChecks(file), ctx)).pass, true);
});
