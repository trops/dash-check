"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadHelpers, listHelpers, getHelper, createContext, collect } = require("..");
const { tmpdir, cleanup, write, makeRepo } = require("./_util");

require("node:test").after(cleanup);

const helperFile = (id, label) => `const { defineHelper, expect } = require("@trops/dash-check");
module.exports = defineHelper({
  id: "${id}", group: "Your helpers", label: "${label}", description: "d", sentence: "s",
  params: { word: { type: "text", default: "hi" } },
  run(ctx, { word }) { expect(word, "word").toBe("hi", "Say hi"); },
});
`;

test("helpers in .dash/checks/helpers/ and in packages are found; a broken one says why", async () => {
  const dir = tmpdir();
  write(dir, {
    ".dash/checks/helpers/greet.js": helperFile("team.greet", "Greets"),
    ".dash/checks/helpers/two.js": `const { defineHelper } = require("@trops/dash-check");
module.exports = [
  defineHelper({ id: "team.one", label: "One", run() {} }),
  defineHelper({ id: "team.two", label: "Two", run() {} }),
];`,
    ".dash/checks/helpers/broken.js": "module.exports = defineHelper({ ;",
    ".dash/checks/helpers/empty.js": "module.exports = {};",
    ".dash/checks/helpers/notes.txt": "not a helper",
    "package.json": { name: "app", devDependencies: { "@acme/checks": "1.0.0", plain: "1.0.0", "@acme/bad": "1.0.0", missing: "1.0.0" } },
    "node_modules/@acme/checks/package.json": { name: "@acme/checks", dashCheck: { helpers: ["./h/size.js"] } },
    "node_modules/@acme/checks/h/size.js": helperFile("acme.size", "Size is fine"),
    "node_modules/plain/package.json": { name: "plain" },
    "node_modules/@acme/bad/package.json": { name: "@acme/bad", dashCheck: { helpers: "nope" } },
  });
  const found = loadHelpers({ cwd: dir });
  assert.deepEqual(found.helpers.map((h) => h.id).sort(), ["acme.size", "team.greet", "team.one", "team.two"]);
  const errs = Object.fromEntries(found.errors.map((e) => [e.source, e.error]));
  assert.match(errs[".dash/checks/helpers/broken.js"], /Unexpected token|SyntaxError/);
  assert.match(errs[".dash/checks/helpers/empty.js"], /exports no helper/);
  assert.match(errs["@acme/bad/package.json"], /needs "helpers"/);
  assert.equal(Object.keys(errs).length, 3);

  const listed = listHelpers();
  const greet = listed.find((h) => h.id === "team.greet");
  assert.equal(greet.source, ".dash/checks/helpers/greet.js");
  assert.equal(greet.group, "Your helpers");
  assert.equal(listed.find((h) => h.id === "acme.size").source, "@acme/checks/h/size.js");
  assert.ok(listed.find((h) => h.id === "git.committedSince"), "the built-ins are still there");

  const s = await collect(() => getHelper("team.greet")(createContext({}), { word: "bye" }));
  assert.deepEqual(s.failures.map((f) => f.message), ["Say hi"]);

  // Loading again (after an edit) replaces, without a duplicate-id error.
  fs.writeFileSync(path.join(dir, ".dash/checks/helpers/greet.js"), helperFile("team.greet", "Greets again"));
  const again = loadHelpers({ cwd: dir });
  assert.equal(again.errors.length, 3);
  assert.equal(getHelper("team.greet").meta.label, "Greets again");
});

test("a helper can't take a built-in's id", () => {
  const dir = tmpdir();
  write(dir, { ".dash/checks/helpers/clash.js": helperFile("git.clean", "Mine") });
  const found = loadHelpers({ cwd: dir });
  assert.equal(found.helpers.length, 0);
  assert.match(found.errors[0].error, /Another helper already has the id git\.clean/);
});

test("the example user helper (Changelog updated) works from a repo", async () => {
  const repo = makeRepo({ "CHANGELOG.md": "# Changes\n" });
  write(repo.dir, { ".dash/checks/helpers/changelog.js": fs.readFileSync(path.join(__dirname, "..", "examples", "helpers", "changelog.js"), "utf8") });
  repo.git("checkout", "-q", "-b", "feat/x");
  const found = loadHelpers({ cwd: repo.dir });
  assert.deepEqual(found.errors, []);
  const h = getHelper("team.changelogUpdated");
  const ctx = createContext({ item: { id: "DASH-5" } }, { cwd: repo.dir });
  let s = await collect(() => h(ctx));
  assert.deepEqual(s.failures.map((f) => f.message), ["CHANGELOG.md isn't updated: add a line for DASH-5"]);
  repo.commit({ "CHANGELOG.md": "# Changes\n- DASH-5\n" });
  s = await collect(() => h(ctx));
  assert.deepEqual(s.failures, []);
});
