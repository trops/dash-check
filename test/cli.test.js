"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { tmpdir, cleanup, write, answer } = require("./_util");

require("node:test").after(cleanup);

const BIN = path.join(__dirname, "..", "cli", "bin.js");
const env = () => {
  const e = { ...process.env };
  delete e.NODE_TEST_CONTEXT;
  delete e.GH_TOKEN;
  return e;
};
function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: env(), encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const PASSING = `const { check, expect } = require("@trops/dash-check");
check("has files", ({ handoff }) => { expect(handoff.files, "handoff.files").not.toBeEmpty("The handoff lists no files"); });
`;
const RECIPE = { name: "has a summary", steps: [{ use: "handoff.has", with: { keys: ["summary"] } }, { expect: "item.id", matcher: "toBeDefined", message: "No work item" }] };

function repoWithChecks() {
  const dir = tmpdir();
  write(dir, {
    ".dash/checks/files.check.js": PASSING,
    ".dash/checks/files.sample.json": answer({ files: ["a.js"] }),
    ".dash/checks/summary.check.json": RECIPE,
    ".dash/checks/summary.sample.json": answer({ summary: "s" }, { item: { id: "DASH-1" } }),
    ".dash/checks/README.md": "notes, not a check",
    "bad.json": answer({}),
  });
  return dir;
}

test("with no checks it says so and how to start", () => {
  const r = cli(tmpdir());
  assert.equal(r.code, 0);
  assert.match(r.out, /No \.dash\/checks here: nothing to run\. Start one with: dash-check new <name>/);
});

test("runs every .check.js and .check.json, each with its sample", () => {
  const dir = repoWithChecks();
  const r = cli(dir);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, "✓ files: Passed: has files\n✓ summary: has a summary: The handoff has summary\n");
});

test("one check with --input; a failure prints what to fix and exits 1", () => {
  const dir = repoWithChecks();
  const r = cli(dir, "files", "--input", "bad.json");
  assert.equal(r.code, 1);
  assert.match(r.out, /✗ has files\n\s+● The handoff lists no files\n✗ files: The handoff lists no files\n$/);
  const s = cli(dir, "summary", "--input", "bad.json");
  assert.equal(s.code, 1);
  assert.match(s.out, /✗ Handoff has keys\n\s+● The handoff has no summary\n\s+✗ Expect item\.id\n\s+● No work item\n✗ summary: The handoff has no summary; No work item/);
  assert.equal(cli(dir, "summary").code, 0, "the sample is the default input");
});

test("bad arguments and missing checks exit 2", () => {
  const dir = repoWithChecks();
  let r = cli(dir, "nope");
  assert.equal(r.code, 2);
  assert.match(r.err, /✗ nope: there's no \.dash\/checks\/nope/);
  r = cli(dir, "--frobnicate");
  assert.equal(r.code, 2);
  assert.match(r.err, /Unknown option --frobnicate/);
  r = cli(dir, "../x");
  assert.equal(r.code, 2);
  r = cli(dir, "files", "--input", "missing.json");
  assert.equal(r.code, 2);
  assert.match(r.err, /Can't read missing\.json/);
  assert.equal(cli(dir, "--help").code, 0);
});

test("--ci prints a Jest-like report and exits 1 on failure", () => {
  const dir = repoWithChecks();
  let r = cli(dir, "--ci");
  assert.equal(r.code, 0);
  assert.match(r.out, /^ PASS  \.dash\/checks\/files\.check\.js\n  ✓ has files\n PASS  \.dash\/checks\/summary\.check\.json\n  ✓ Handoff has keys \(The handoff has summary\)/);
  assert.match(r.out, /Files:  2 passed, 2 total\nChecks: 2 passed, 2 total\n$/);
  r = cli(dir, "--ci", "--input", "bad.json");
  assert.equal(r.code, 1);
  assert.match(r.out, / FAIL  \.dash\/checks\/files\.check\.js\n  ✗ has files\n      ● The handoff lists no files/);
  assert.match(r.out, /Files:  2 failed, 0 passed, 2 total\nChecks: 2 failed, 0 passed, 2 total/);
  r = cli(dir, "--ci", "files,nope");
  assert.equal(r.code, 1, "a missing check is a failure in CI");
  assert.match(r.out, /Files:  1 failed, 1 passed, 2 total/);
});

test("--json gives the results as data", () => {
  const dir = repoWithChecks();
  const r = cli(dir, "--json", "--input", "bad.json");
  assert.equal(r.code, 1);
  const v = JSON.parse(r.out);
  assert.equal(v.pass, false);
  assert.deepEqual(v.results.map((x) => [x.name, x.pass]), [["files", false], ["summary", false]]);
  assert.deepEqual(v.results[1].steps.map((s) => s.pass), [false, false]);
});

test("plain executables run the way Dash runs them: #! line, else extension", () => {
  const dir = tmpdir();
  write(dir, {
    ".dash/checks/shebang": `#!/bin/sh
item=$(cat | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).item.id))')
[ "$item" = "$DASH_ITEM_ID" ] || { echo '{"reason":"stdin and DASH_ITEM_ID differ"}'; exit 1; }
[ -f "$DASH_INPUT" ] || { echo '{"reason":"no DASH_INPUT"}'; exit 1; }
echo "checked $DASH_STEP in $(basename "$DASH_WORKSPACE")"
echo '{"reason":"'"$item"' is fine","details":{"n":1}}'
`,
    ".dash/checks/fails.sh": 'echo "some output"\necho \'{"reason":"Lint failed: fix x.js"}\'\nexit 1\n',
    ".dash/checks/quiet.js": "process.exit(0)\n",
    ".dash/checks/slow.sh": "sleep 5\n",
    "in.json": answer({}, { item: { id: "DASH-3" } }),
  });
  let r = cli(dir, "shebang", "--input", "in.json");
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, "✓ shebang: DASH-3 is fine\n");
  r = cli(dir, "fails");
  assert.equal(r.code, 1);
  assert.equal(r.out, "some output\n✗ fails: Lint failed: fix x.js\n");
  r = cli(dir, "quiet");
  assert.equal(r.out, "✓ quiet: Passed (exit 0)\n");
  r = cli(dir, "slow", "--timeout", "0.5");
  assert.equal(r.code, 1);
  assert.match(r.out, /✗ slow: Stopped after 0\.5 seconds/);
  r = cli(dir, "--list");
  assert.equal(r.out, "fails\t.dash/checks/fails.sh\texec\nquiet\t.dash/checks/quiet.js\texec\nshebang\t.dash/checks/shebang\texec\nslow\t.dash/checks/slow.sh\texec\n");
});

test("--list-helpers --json is the composer's palette, with a broken helper's error", () => {
  const dir = tmpdir();
  write(dir, {
    ".dash/checks/helpers/changelog.js": fs.readFileSync(path.join(__dirname, "..", "examples", "helpers", "changelog.js"), "utf8"),
    ".dash/checks/helpers/broken.js": "throw new Error('half written')",
    "sample.json": answer({ files: ["a"] }, { item: { id: "X" } }),
  });
  const r = cli(dir, "--list-helpers", "--json", "--input", "sample.json");
  assert.equal(r.code, 0, r.err);
  const v = JSON.parse(r.out);
  const mine = v.helpers.find((h) => h.id === "team.changelogUpdated");
  assert.equal(mine.group, "Your helpers");
  assert.equal(mine.source, ".dash/checks/helpers/changelog.js");
  assert.equal(mine.params.file.type, "path");
  const builtin = v.helpers.find((h) => h.id === "git.committedSince");
  assert.deepEqual(Object.keys(builtin).sort(), ["description", "group", "id", "label", "params", "reads", "sentence", "source"]);
  assert.equal(builtin.params.min.type, "number");
  assert.ok(v.matchers.find((m) => m.id === "toHaveLengthAtLeast" && m.label === "has at least"));
  assert.deepEqual(v.errors, [{ source: ".dash/checks/helpers/broken.js", error: "half written" }]);
  assert.ok(v.values.find((x) => x.path === "handoff.files"));
  const text = cli(dir, "--list-helpers");
  assert.match(text.out, /^Handoff\n  handoff\.has\s+Handoff has keys/);
  assert.match(text.out, /Your helpers\n  team\.changelogUpdated\s+Changelog updated/);
  assert.match(text.err, /✗ \.dash\/checks\/helpers\/broken\.js didn't load: half written/);
});

test("--explain prints a check as sentences", () => {
  const dir = repoWithChecks();
  write(dir, { "broken.check.json": { name: "x", steps: [{ use: "no.such" }] } });
  let r = cli(dir, "--explain", ".dash/checks/summary.check.json");
  assert.equal(r.code, 0);
  assert.equal(r.out, 'has a summary\n  - Handoff has keys: the handoff has summary\n  - Expect item.id is set. If it fails, say: "No work item"\n');
  r = cli(dir, "--explain", ".dash/checks/files.check.js");
  assert.match(r.out, /^files\.check\.js: code, 1 check\n  - has files\n/);
  r = cli(dir, "--explain", "broken.check.json");
  assert.equal(r.code, 1);
  assert.match(r.err, /steps\[0\]\.use: There's no helper no\.such/);
  assert.equal(cli(dir, "--explain", "nope.json").code, 2);
});

test("new <name> scaffolds a check and its sample, which pass; --recipe makes a recipe", () => {
  const dir = tmpdir();
  let r = cli(dir, "new", "ready");
  assert.equal(r.code, 0);
  assert.ok(fs.existsSync(path.join(dir, ".dash/checks/ready.check.js")));
  assert.ok(fs.existsSync(path.join(dir, ".dash/checks/ready.sample.json")));
  r = cli(dir, "new", "ready");
  assert.equal(r.code, 2);
  assert.match(r.err, /is already there/);
  assert.equal(cli(dir, "new", "plan", "--recipe").code, 0);
  const recipe = JSON.parse(fs.readFileSync(path.join(dir, ".dash/checks/plan.check.json"), "utf8"));
  assert.equal(recipe.steps.length, 2);
  assert.equal(cli(dir, "new", "bad/name").code, 2);
  r = cli(dir);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /✓ plan:/);
  assert.match(r.out, /✓ ready:/);
});

test("--watch runs again when a file changes", async () => {
  const dir = repoWithChecks();
  const child = spawn(process.execPath, [BIN, "files", "--watch"], { cwd: dir, env: env() });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const waitFor = (re, ms = 15000) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (re.test(out)) return resolve();
        if (Date.now() - t0 > ms) return reject(new Error(`timed out waiting for ${re}; got:\n${out}`));
        setTimeout(tick, 50);
      };
      tick();
    });
  try {
    await waitFor(/✓ files:[\s\S]*Watching for changes/);
    fs.writeFileSync(path.join(dir, ".dash/checks/files.sample.json"), JSON.stringify(answer({ files: [] })));
    await waitFor(/✗ files: The handoff lists no files[\s\S]*Watching for changes/);
  } finally {
    child.kill("SIGINT");
  }
});
