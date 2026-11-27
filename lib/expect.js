/**
 * expect.js: `expect(value, label?)` and its matchers.
 *
 * Every matcher is registered with its metadata, so a UI can list it and
 * read a step back as a sentence:
 *
 *   { id, label, sentence, notSentence, params: [{ name, type, label }] }
 *
 * Every matcher takes an optional last argument, `message`: the fix shown
 * when it fails. A matcher returns whether it passed, so code can guard:
 *
 *   if (expect(h.tests, "handoff.tests").toBeArray()) for (const t of h.tests) …
 */
"use strict";

const { isObj, isEmpty, deepEqual, fmt, getPath } = require("./util");
const { record, makeFailure } = require("./scope");

const MATCHERS = new Map();

const sizeOf = (v) => {
  if (typeof v === "string" || Array.isArray(v)) return v.length;
  if (v instanceof Map || v instanceof Set) return v.size;
  if (isObj(v)) return Object.keys(v).length;
  return undefined;
};
const sizeText = (v) => {
  const n = sizeOf(v);
  if (n === undefined) return "";
  return typeof v === "string" ? ` (${n} characters)` : ` (${n} item${n === 1 ? "" : "s"})`;
};
const isNum = (v) => typeof v === "number" && !Number.isNaN(v);
const toRegex = (p) => (p instanceof RegExp ? p : new RegExp(String(p)));

/**
 * Register a matcher.
 * @param {{ id: string, label: string, sentence: string, notSentence?: string,
 *           params?: Array<{ name: string, type: string, label?: string }>,
 *           test: (received: any, ...args: any[]) => boolean | { pass: boolean, got?: string },
 *           description?: string }} def
 */
function defineMatcher(def) {
  if (!def || typeof def.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(def.id)) {
    throw new TypeError("A matcher needs an id made of letters and digits, e.g. toBeEven");
  }
  if (typeof def.test !== "function") throw new TypeError(`Matcher ${def.id} needs a test function`);
  if (typeof def.sentence !== "string") throw new TypeError(`Matcher ${def.id} needs a sentence, e.g. "{value} is even"`);
  const meta = {
    id: def.id,
    label: def.label || def.id,
    sentence: def.sentence,
    notSentence: def.notSentence || def.sentence.replace("{value}", "not: {value}"),
    params: (def.params || []).map((p) => ({ name: p.name, type: p.type || "text", label: p.label || p.name })),
    description: def.description || "",
  };
  MATCHERS.set(def.id, { meta, test: def.test });
  return meta;
}

/** Fill a matcher's sentence: "{value} has at least {n} item(s)". */
function sentenceFor(meta, label, args, not) {
  const tpl = not ? meta.notSentence : meta.sentence;
  return tpl.replace(/\{(\w+)\}/g, (m, k) => {
    if (k === "value") return label;
    const i = meta.params.findIndex((p) => p.name === k);
    if (i < 0) return m;
    const v = args[i];
    return Array.isArray(v) ? v.map((x) => fmt(x)).join(", ") : fmt(v);
  });
}

/** Apply one matcher; records a failure when it doesn't hold. */
function apply(id, received, label, rawArgs, not) {
  const m = MATCHERS.get(id);
  const n = m.meta.params.length;
  const args = rawArgs.slice(0, n);
  const message = rawArgs.length > n && typeof rawArgs[n] === "string" ? rawArgs[n] : null;
  let out;
  try {
    out = m.test(received, ...args);
  } catch (e) {
    out = { pass: false, got: `it couldn't be checked (${e.message})` };
    not = false; // a matcher that can't run fails both ways
  }
  const ok = typeof out === "object" && out ? !!out.pass : !!out;
  const pass = not ? !ok : ok;
  if (pass) return true;
  const label2 = label || "the value";
  const want = sentenceFor(m.meta, label2, args, not);
  const got = (out && typeof out === "object" && out.got) || `${label2} is ${fmt(received)}${typeof received !== "string" || /Length|Empty/.test(id) ? sizeText(received) : ""}`;
  record(
    makeFailure(message || `Expected ${want}, but ${got}`, {
      matcher: `${not ? "not." : ""}${id}`,
      expected: args.length === 1 ? args[0] : args.length ? args : undefined,
      received,
      label: label || undefined,
    }),
  );
  return false;
}

function matchersFor(get, label, not, mode) {
  const api = {};
  for (const id of MATCHERS.keys()) {
    api[id] = (...args) => {
      if (mode) {
        return Promise.resolve()
          .then(get)
          .then((v) => apply(id, v, label, args, not));
      }
      return apply(id, get(), label, args, not);
    };
  }
  return api;
}

/**
 * expect(value, label?) → matchers, plus .not, .resolves and .rejects.
 * @param {any} value
 * @param {string} [label] how the value is named in a failure ("handoff.files")
 */
function expect(value, label) {
  const plain = () => value;
  const api = matchersFor(plain, label, false);
  api.not = matchersFor(plain, label, true);
  const settle = (wantReject) => async () => {
    const p = typeof value === "function" ? value() : value;
    try {
      const v = await p;
      if (wantReject) {
        record(makeFailure(`Expected ${label || "the promise"} to reject, but it resolved with ${fmt(v)}`, { received: v }));
        throw SETTLED;
      }
      return v;
    } catch (e) {
      if (e === SETTLED) throw e;
      if (!wantReject) {
        record(makeFailure(`Expected ${label || "the promise"} to resolve, but it rejected: ${e && e.message ? e.message : fmt(e)}`, { received: e }));
        throw SETTLED;
      }
      return e;
    }
  };
  const asyncApi = (wantReject) => {
    const get = settle(wantReject);
    const wrap = (not) => {
      const inner = matchersFor(get, label, not, "async");
      const out = {};
      for (const id of Object.keys(inner)) {
        out[id] = (...args) => inner[id](...args).catch((e) => (e === SETTLED ? false : Promise.reject(e)));
      }
      return out;
    };
    const a = wrap(false);
    a.not = wrap(true);
    return a;
  };
  Object.defineProperty(api, "resolves", { get: () => asyncApi(false) });
  Object.defineProperty(api, "rejects", { get: () => asyncApi(true) });
  return api;
}
const SETTLED = Symbol("settled");

/** Every matcher's metadata, for a palette. */
expect.matchers = () => [...MATCHERS.values()].map((m) => ({ ...m.meta, params: m.meta.params.map((p) => ({ ...p })) }));
expect.extend = (defs) => (Array.isArray(defs) ? defs : [defs]).map(defineMatcher);
expect.has = (id) => MATCHERS.has(id);
expect.meta = (id) => (MATCHERS.has(id) ? MATCHERS.get(id).meta : null);
expect.sentence = (id, label, args = [], not = false) => {
  const m = MATCHERS.get(id);
  return m ? sentenceFor(m.meta, label, args, not) : null;
};

// ---- the built-in matchers ------------------------------------------------

const B = [
  // equality and type
  { id: "toBe", label: "is", sentence: "{value} is {expected}", notSentence: "{value} is not {expected}",
    params: [{ name: "expected", type: "any", label: "Value" }], test: (r, e) => Object.is(r, e) },
  { id: "toEqual", label: "equals", sentence: "{value} equals {expected}", notSentence: "{value} does not equal {expected}",
    params: [{ name: "expected", type: "any", label: "Value" }], test: (r, e) => deepEqual(r, e) },
  { id: "toBeDefined", label: "is set", sentence: "{value} is set", notSentence: "{value} is not set",
    test: (r) => r !== undefined },
  { id: "toBeTruthy", label: "is true / set", sentence: "{value} is truthy", notSentence: "{value} is falsy",
    test: (r) => !!r },
  { id: "toBeArray", label: "is a list", sentence: "{value} is a list", notSentence: "{value} is not a list",
    test: (r) => Array.isArray(r) },
  { id: "toBeString", label: "is text", sentence: "{value} is text", notSentence: "{value} is not text",
    test: (r) => typeof r === "string" },
  { id: "toBeNonEmptyString", label: "is non-empty text", sentence: "{value} is non-empty text",
    notSentence: "{value} is not non-empty text", test: (r) => typeof r === "string" && r.trim() !== "" },
  { id: "toBeNumber", label: "is a number", sentence: "{value} is a number", notSentence: "{value} is not a number",
    test: (r) => isNum(r) },
  // size
  { id: "toBeEmpty", label: "is empty", sentence: "{value} is empty", notSentence: "{value} is not empty",
    test: (r) => isEmpty(r) },
  { id: "toHaveLength", label: "has exactly", sentence: "{value} has length {n}", notSentence: "{value} does not have length {n}",
    params: [{ name: "n", type: "number", label: "Length" }], test: (r, n) => sizeOf(r) === n },
  { id: "toHaveLengthAtLeast", label: "has at least", sentence: "{value} has at least {n} item(s)",
    notSentence: "{value} has fewer than {n} item(s)",
    params: [{ name: "n", type: "number", label: "At least" }],
    test: (r, n) => sizeOf(r) !== undefined && sizeOf(r) >= n },
  // membership
  { id: "toContain", label: "contains", sentence: "{value} contains {item}", notSentence: "{value} does not contain {item}",
    params: [{ name: "item", type: "any", label: "Item or text" }],
    test: (r, item) => {
      if (typeof r === "string") return r.includes(String(item));
      if (Array.isArray(r)) return r.some((x) => deepEqual(x, item));
      if (r instanceof Set) return r.has(item);
      return { pass: false, got: `it's ${fmt(r)}, neither text nor a list` };
    } },
  { id: "toBeOneOf", label: "is one of", sentence: "{value} is one of {options}", notSentence: "{value} is none of {options}",
    params: [{ name: "options", type: "list", label: "Options" }],
    test: (r, options) => Array.isArray(options) && options.some((o) => deepEqual(o, r)) },
  { id: "toHaveKeys", label: "has keys", sentence: "{value} has {keys}", notSentence: "{value} has none of {keys}",
    params: [{ name: "keys", type: "list", label: "Keys" }],
    test: (r, keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      if (!r || typeof r !== "object") return { pass: false, got: `it's ${fmt(r)}, not an object` };
      const missing = list.filter((k) => getPath(r, k) === undefined);
      return { pass: missing.length === 0, got: missing.length ? `it has no ${missing.join(", ")}` : "it has all of them" };
    } },
  // text and numbers
  { id: "toMatch", label: "matches", sentence: "{value} matches {pattern}", notSentence: "{value} does not match {pattern}",
    params: [{ name: "pattern", type: "regex", label: "Pattern" }],
    test: (r, p) => {
      const s = r instanceof Error ? r.message : r;
      if (typeof s !== "string") return { pass: false, got: `it's ${fmt(r)}, not text` };
      return toRegex(p).test(s);
    } },
  { id: "toBeGreaterThan", label: "is more than", sentence: "{value} is more than {n}", notSentence: "{value} is at most {n}",
    params: [{ name: "n", type: "number", label: "Number" }], test: (r, n) => isNum(r) && r > n },
  { id: "toBeLessThan", label: "is less than", sentence: "{value} is less than {n}", notSentence: "{value} is at least {n}",
    params: [{ name: "n", type: "number", label: "Number" }], test: (r, n) => isNum(r) && r < n },
];
B.forEach(defineMatcher);

module.exports = { expect, defineMatcher };
