/**
 * helper.js: defineHelper, a building block made only from Layer 0 and
 * described well enough for a UI to list it, render its form and read it
 * back as a sentence.
 *
 *   defineHelper({ id, group, label, description, sentence, params, reads, run })
 *
 * The result is a function, `await helper(ctx, params)`, with its metadata
 * on `.meta`. Calling it:
 *   - fills each param's default, then "{placeholders}" from the context
 *     (a default whose placeholder has no value counts as empty);
 *   - checks and converts each param to its type;
 *   - runs it; anything it throws becomes a failure, so the check goes on;
 *   - with `message`, its failures say that instead (where they were stays).
 */
"use strict";

const { isObj, fmt, DashCheckError } = require("./util");
const { collect, record, CheckFailure, current, note } = require("./scope");
const values = require("./values");

const TYPES = ["text", "number", "boolean", "select", "path", "glob", "regex", "list"];
const ID_RE = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;
const REGISTRY = new Map();

function normParams(id, params) {
  if (params === undefined) return {};
  if (!isObj(params)) throw new TypeError(`${id}: params must be an object of { name: { type, label, default } }`);
  const out = {};
  for (const [name, p] of Object.entries(params)) {
    if (name === "message") throw new TypeError(`${id}: "message" is every helper's own param; don't declare it`);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new TypeError(`${id}: "${name}" can't be a param's name`);
    const def = isObj(p) ? p : { type: p };
    const type = def.type || "text";
    if (!TYPES.includes(type)) throw new TypeError(`${id}: param ${name} has type "${type}"; use one of ${TYPES.join(", ")}`);
    if (type === "select" && (!Array.isArray(def.options) || !def.options.length)) {
      throw new TypeError(`${id}: select param ${name} needs options`);
    }
    out[name] = {
      type,
      label: def.label || name,
      ...(def.description ? { description: def.description } : {}),
      ...(def.default !== undefined ? { default: def.default } : {}),
      ...(def.required ? { required: true } : {}),
      ...(def.options ? { options: def.options.slice() } : {}),
      ...(def.placeholder ? { placeholder: def.placeholder } : {}),
    };
  }
  return out;
}

/** "a, b" → ["a", "b"], leaving commas in a glob's {a,b} alone. */
function splitList(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "{") depth++;
    else if (c === "}" && depth > 0) depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** A param's value, converted to its type, or throws saying what's wrong. */
function coerce(id, name, p, v) {
  const bad = (what) => new DashCheckError(`${id}: ${p.label} (${name}) ${what}`, { fix: `got ${fmt(v)}` });
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (p.required) throw new DashCheckError(`${id}: set ${p.label} (${name})`, { fix: "it has no value" });
    return p.type === "list" ? [] : undefined;
  }
  switch (p.type) {
    case "number": {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) throw bad("must be a number");
      return n;
    }
    case "boolean":
      if (typeof v === "boolean") return v;
      if (["true", "yes", "on", "1"].includes(String(v).toLowerCase())) return true;
      if (["false", "no", "off", "0"].includes(String(v).toLowerCase())) return false;
      throw bad("must be true or false");
    case "select":
      if (!p.options.map(String).includes(String(v))) throw bad(`must be one of ${p.options.join(", ")}`);
      return p.options.find((o) => String(o) === String(v));
    case "list": {
      const list = Array.isArray(v) ? v : splitList(String(v));
      return list.map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== "" && x !== undefined && x !== null);
    }
    case "regex":
      if (v instanceof RegExp) return v;
      try {
        return new RegExp(String(v));
      } catch (e) {
        throw bad(`isn't a valid pattern (${e.message})`);
      }
    default:
      if (typeof v === "object") throw bad("must be text");
      return String(v);
  }
}

/** Fill and convert a call's params (exported for recipes and tests). */
function resolveParams(meta, ctx, given = {}) {
  const out = {};
  const g = isObj(given) ? given : {};
  for (const k of Object.keys(g)) {
    if (k !== "message" && !meta.params[k]) {
      throw new DashCheckError(`${meta.id} has no param "${k}"`, { fix: `use ${Object.keys(meta.params).join(", ") || "no params"}` });
    }
  }
  for (const [name, p] of Object.entries(meta.params)) {
    let v;
    if (g[name] !== undefined) v = ctx ? values.fill(ctx, g[name]) : g[name];
    else if (p.default !== undefined) v = ctx ? values.fill(ctx, p.default, { missing: "empty" }) : p.default;
    out[name] = coerce(meta.id, name, p, v);
  }
  return out;
}

/**
 * Define a helper.
 * @param {{ id: string, group?: string, label: string, description?: string,
 *           sentence?: string, params?: object, reads?: string[],
 *           run: (ctx: object, params: object) => any }} def
 */
function defineHelper(def) {
  if (!def || typeof def !== "object") throw new TypeError("defineHelper({ id, label, run }) needs a definition");
  if (typeof def.id !== "string" || !ID_RE.test(def.id)) {
    throw new TypeError(`A helper's id is "group.name" in camelCase, e.g. "team.changelogUpdated" (got ${fmt(def.id)})`);
  }
  if (typeof def.run !== "function") throw new TypeError(`${def.id}: give it run(ctx, params)`);
  if (typeof def.label !== "string" || !def.label.trim()) throw new TypeError(`${def.id}: give it a label, e.g. "Changelog updated"`);
  const meta = Object.freeze({
    id: def.id,
    group: def.group || def.id.split(".")[0],
    label: def.label,
    description: def.description || "",
    sentence: def.sentence || "",
    params: normParams(def.id, def.params),
    reads: Array.isArray(def.reads) ? def.reads.slice() : [],
  });
  const runIt = def.run;

  async function helper(ctx, given = {}) {
    if (!ctx || typeof ctx !== "object" || !ctx.input) {
      throw new TypeError(`${meta.id}(ctx, params): pass the check's ctx first`);
    }
    const s = await collect(async () => {
      const params = resolveParams(meta, ctx, given);
      await runIt(ctx, params);
    });
    const message = isObj(given) && typeof given.message === "string" && given.message.trim()
      ? values.fill(ctx, given.message, { missing: "keep" })
      : null;
    const failures = s.failures.map((f) => (message ? { ...f, message, original: f.message } : f));
    if (!current()) {
      if (failures.length) throw new CheckFailure(failures);
      return true;
    }
    failures.forEach(record);
    s.notes.forEach(note);
    return failures.length === 0;
  }
  Object.defineProperty(helper, "name", { value: meta.id });
  helper.meta = meta;
  helper.isDashCheckHelper = true;
  return helper;
}

/** Fill a helper's sentence with values: "at least 1 commit(s) past main". */
function sentenceOf(meta, given = {}) {
  return String(meta.sentence || "").replace(/\{(\w+)\}/g, (m, k) => {
    const p = meta.params[k];
    if (!p) return m;
    const v = isObj(given) && given[k] !== undefined ? given[k] : p.default;
    if (v === undefined || v === "") return `(${p.label})`;
    if (Array.isArray(v)) return v.join(", ");
    if (v instanceof RegExp) return v.source;
    return String(v);
  });
}

/** Add helpers to the registry (built-ins and discovered ones). */
function register(helpers, { source, replace = false } = {}) {
  const added = [];
  for (const h of [].concat(helpers)) {
    if (!h || !h.isDashCheckHelper) throw new TypeError("register() takes helpers made with defineHelper");
    const had = REGISTRY.get(h.meta.id);
    if (had && had.helper !== h && !replace) {
      throw new Error(`Another helper already has the id ${h.meta.id}${had.source ? ` (${had.source})` : ""}: give this one a different id`);
    }
    REGISTRY.set(h.meta.id, { helper: h, source: source || (had && had.source) || null });
    added.push(h);
  }
  return added;
}

/** A registered helper by id, or null. */
function getHelper(id) {
  require("../helpers");
  const r = REGISTRY.get(id);
  return r ? r.helper : null;
}

/** Every registered helper's metadata, with where it came from. */
function listHelpers() {
  require("../helpers");
  return [...REGISTRY.values()].map(({ helper, source }) => ({ ...helper.meta, params: { ...helper.meta.params }, ...(source ? { source } : {}) }));
}

function unregister(id) {
  return REGISTRY.delete(id);
}

/**
 * helper(id) → the helper, to call from code: await helper("team.changelog")(ctx, {…}).
 * Built-ins are always there; a repo's own are found from ctx.cwd on first use.
 */
function helper(id) {
  return async (ctx, given) => {
    let h = getHelper(id);
    if (!h && ctx && ctx.cwd) {
      require("./discover").loadHelpers({ cwd: ctx.cwd });
      h = getHelper(id);
    }
    if (!h) throw new DashCheckError(`There's no helper ${id}`, { fix: "check its id, or add it to .dash/checks/helpers/" });
    return h(ctx, given);
  };
}

module.exports = { defineHelper, resolveParams, coerce, sentenceOf, register, getHelper, listHelpers, unregister, helper, TYPES };
