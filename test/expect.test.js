"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { expect, collect, CheckFailure, defineMatcher } = require("..");

/** The failures one block of expects records. */
async function failuresOf(fn) {
  return (await collect(fn)).failures;
}
async function passes(fn) {
  const f = await failuresOf(fn);
  assert.deepEqual(f.map((x) => x.message), [], "expected no failures");
}
async function fails(fn, re) {
  const f = await failuresOf(fn);
  assert.equal(f.length, 1, `expected one failure, got ${f.length}`);
  if (re) assert.match(f[0].message, re);
  return f[0];
}

// Each matcher: values that pass it, values that fail it.
const CASES = {
  toBe: { pass: [["a", "a"], [1, 1], [null, null], [NaN, NaN]], fail: [["a", "b"], [{}, {}], [1, "1"]] },
  toEqual: { pass: [[{ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }], [[1, 2], [1, 2]], [/x/, /x/]], fail: [[{ a: 1 }, { a: 2 }], [[1], [1, 2]], [[1], { 0: 1 }]] },
  toBeDefined: { pass: [[0], [null], [""]], fail: [[undefined]] },
  toBeTruthy: { pass: [[1], ["x"], [[]]], fail: [[0], [""], [null], [undefined]] },
  toBeArray: { pass: [[[]], [[1]]], fail: [[{}], ["[]"], [undefined]] },
  toBeString: { pass: [[""], ["x"]], fail: [[1], [undefined]] },
  toBeNonEmptyString: { pass: [["x"]], fail: [[""], ["   "], [1], [undefined]] },
  toBeNumber: { pass: [[0], [1.5]], fail: [["1"], [NaN], [undefined]] },
  toBeEmpty: { pass: [[[]], [""], ["  "], [{}], [undefined], [null]], fail: [[[1]], ["x"], [{ a: 1 }], [0]] },
  toHaveLength: { pass: [[[1, 2], 2], ["abc", 3], [{ a: 1 }, 1]], fail: [[[1], 2], [undefined, 0], [5, 1]] },
  toHaveLengthAtLeast: { pass: [[[1, 2], 1], [[1], 1], ["ab", 2]], fail: [[[], 1], [undefined, 1], [{}, 1]] },
  toContain: { pass: [["hello", "ell"], [[1, { a: 2 }], { a: 2 }], [new Set([1]), 1]], fail: [["hello", "x"], [[1], 2], [5, 5]] },
  toBeOneOf: { pass: [["a", ["a", "b"]], [{ k: 1 }, [{ k: 1 }]]], fail: [["c", ["a", "b"]], [undefined, ["a"]]] },
  toHaveKeys: { pass: [[{ a: 1, b: { c: 2 } }, ["a", "b.c"]]], fail: [[{ a: 1 }, ["a", "b"]], [null, ["a"]], ["x", ["a"]]] },
  toMatch: { pass: [["abc", /b/], ["abc", "^a"], [new Error("boom"), /boom/]], fail: [["abc", /x/], [1, /1/], [undefined, /x/]] },
  toBeGreaterThan: { pass: [[2, 1]], fail: [[1, 1], ["2", 1], [undefined, 0]] },
  toBeLessThan: { pass: [[1, 2]], fail: [[2, 2], [null, 3]] },
};

test("every built-in matcher has a case here, and metadata", () => {
  const ids = expect.matchers().map((m) => m.id).sort();
  assert.deepEqual(ids, Object.keys(CASES).sort());
  for (const m of expect.matchers()) {
    assert.ok(m.label && m.sentence.includes("{value}") && m.notSentence.includes("{value}"), m.id);
    for (const p of m.params) assert.ok(p.name && p.type && p.label, `${m.id}.${p.name}`);
    for (const p of m.params) assert.ok(m.sentence.includes(`{${p.name}}`), `${m.id}'s sentence names {${p.name}}`);
  }
});

for (const [id, { pass, fail }] of Object.entries(CASES)) {
  test(`${id}: passes, fails, and .not turns it around`, async () => {
    for (const [v, ...args] of pass) {
      await passes(() => assert.equal(expect(v, "v")[id](...args), true));
      await fails(() => expect(v, "v").not[id](...args));
    }
    for (const [v, ...args] of fail) {
      const f = await fails(() => assert.equal(expect(v, "v")[id](...args), false));
      assert.equal(f.matcher, id);
      assert.match(f.message, /^Expected v /, `${id}'s default message names the value`);
      await passes(() => expect(v, "v").not[id](...args));
    }
  });
}

test("a matcher's last argument is the failure message (the fix)", async () => {
  const f = await fails(() => expect([], "handoff.files").toHaveLengthAtLeast(1, "The handoff lists no changed files"));
  assert.equal(f.message, "The handoff lists no changed files");
  assert.equal(f.expected, 1);
  assert.deepEqual(f.received, []);
  const g = await fails(() => expect(undefined).not.toBeEmpty("No acceptance items"));
  assert.equal(g.message, "No acceptance items");
  await fails(() => expect(undefined).toBeDefined("Set it"), /^Set it$/);
});

test("default messages read as sentences", async () => {
  await fails(() => expect([1], "handoff.files").toHaveLengthAtLeast(2), /^Expected handoff\.files has at least 2 item\(s\), but handoff\.files is \[1\] \(1 item\)$/);
  await fails(() => expect(undefined, "handoff.acceptance").not.toBeEmpty(), /^Expected handoff\.acceptance is not empty, but handoff\.acceptance is missing$/);
  await fails(() => expect({ a: 1 }, "h").toHaveKeys(["a", "b"]), /but it has no b$/);
  await fails(() => expect("x").toBe("y"), /^Expected the value is "y", but the value is "x"/);
});

test("failures are collected: every one is listed and the code goes on", async () => {
  let reached = false;
  const f = await failuresOf(() => {
    expect(1).toBe(2, "one");
    expect(2).toBe(3, "two");
    reached = true;
  });
  assert.deepEqual(f.map((x) => x.message), ["one", "two"]);
  assert.ok(reached);
});

test("outside a check, a failing expect throws a CheckFailure", () => {
  assert.throws(() => expect(1).toBe(2, "nope"), (e) => e instanceof CheckFailure && e.message === "nope");
  assert.equal(expect(1).toBe(1), true);
});

test(".resolves and .rejects (and .not with them)", async () => {
  await passes(async () => {
    assert.equal(await expect(Promise.resolve(3)).resolves.toBe(3), true);
    await expect(Promise.resolve([1])).resolves.not.toBeEmpty();
    await expect(Promise.reject(new Error("boom"))).rejects.toMatch(/boom/);
    await expect(() => Promise.reject(new Error("x"))).rejects.not.toMatch(/y/);
  });
  await fails(() => expect(Promise.reject(new Error("boom")), "p").resolves.toBe(1), /^Expected p to resolve, but it rejected: boom/);
  await fails(() => expect(Promise.resolve(1), "p").rejects.toMatch(/x/), /^Expected p to reject, but it resolved with 1/);
  await fails(() => expect(Promise.resolve(2)).resolves.toBe(3, "want 3"), /^want 3$/);
});

test("a matcher that can't run fails both ways, saying why", async () => {
  await fails(() => expect("x").toMatch("("), /couldn't be checked/);
  await fails(() => expect("x").not.toMatch("("), /couldn't be checked/);
});

test("expect.extend adds a described matcher", async () => {
  defineMatcher({ id: "toBeEven", label: "is even", sentence: "{value} is even", notSentence: "{value} is odd", test: (r) => r % 2 === 0 });
  assert.ok(expect.has("toBeEven"));
  await passes(() => expect(2).toBeEven());
  await fails(() => expect(3, "n").toBeEven(), /^Expected n is even/);
  assert.equal(expect.sentence("toHaveLengthAtLeast", "handoff.files", [1]), "handoff.files has at least 1 item(s)");
  assert.throws(() => defineMatcher({ id: "bad id", test: () => true, sentence: "x" }), /letters and digits/);
});
