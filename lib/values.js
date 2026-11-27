/**
 * values.js: reading a value by path, and filling "{placeholders}".
 *
 * A path starts at one of the context's data roots:
 *   input, answer, handoff, item, workspace, picks, row, settings, step, job, env
 * Any other first word is looked up in the picked table rows, then in the
 * team settings, so "{repo.baseBranch}" is row.repo.baseBranch and
 * "{workRoot}" is settings.workRoot.
 */
"use strict";

const { getPath, splitPath, isObj, isEmpty, DashCheckError } = require("./util");

const ROOTS = ["input", "answer", "handoff", "item", "workspace", "picks", "row", "settings", "step", "job", "env"];
const TOKEN = /\{\{|\}\}|\{([A-Za-z_$][\w$-]*(?:\.[\w$-]+)*)\}/g;

/** { found, value } for a path in a context. */
function lookup(ctx, p) {
  const parts = splitPath(p);
  if (!parts.length) return { found: false };
  const [first, ...rest] = parts;
  if (ROOTS.includes(first)) {
    const v = getPath(ctx[first], rest);
    return { found: v !== undefined, value: v };
  }
  for (const root of ["row", "settings"]) {
    const base = ctx[root];
    if (isObj(base) && base[first] !== undefined) {
      const v = getPath(base, parts);
      return { found: v !== undefined, value: v };
    }
  }
  return { found: false };
}

/** The value at a path ("handoff.files", "repo.baseBranch"), or undefined. */
function get(ctx, p) {
  return lookup(ctx, p).value;
}

/** Is there a placeholder in this text? */
const hasPlaceholder = (s) => typeof s === "string" && /\{[A-Za-z_$][\w$-]*(?:\.[\w$-]+)*\}/.test(s);

/**
 * Fill "{placeholders}" in a string (deep in arrays and objects).
 * A string that is only one placeholder keeps the value's type.
 * "{{" and "}}" are literal braces.
 * @param {object} ctx
 * @param {any} value
 * @param {{ missing?: "throw" | "empty" | "keep" }} [opts]
 */
function fill(ctx, value, opts = {}) {
  const missing = opts.missing || "throw";
  if (Array.isArray(value)) return value.map((v) => fill(ctx, v, opts));
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fill(ctx, v, opts);
    return out;
  }
  if (typeof value !== "string") return value;
  const whole = value.match(/^\{([A-Za-z_$][\w$-]*(?:\.[\w$-]+)*)\}$/);
  if (whole) {
    const r = lookup(ctx, whole[1]);
    if (r.found) return r.value;
    return onMissing(whole[1], value, missing);
  }
  return value.replace(TOKEN, (m, p) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    const r = lookup(ctx, p);
    if (r.found) return typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value);
    const out = onMissing(p, m, missing);
    return out === undefined ? "" : out;
  });
}

function onMissing(p, raw, missing) {
  if (missing === "keep") return raw;
  if (missing === "empty") return undefined;
  const first = splitPath(p)[0];
  const where = ROOTS.includes(first)
    ? `the job has no ${p}`
    : `there's no table row or team setting named "${first}"${p.includes(".") ? ` with ${p.slice(first.length + 1)}` : ""}`;
  throw new DashCheckError(`{${p}} has no value here (${where})`, {
    fix: "pick the row or set the setting on the team, or give the value directly",
  });
}

/**
 * Is a `when` true? A path ("handoff.prUrl") or a placeholder
 * ("{mergeWhenGreen}"); "!" in front turns it around. Empty, false,
 * "false", "no", "off" and "0" are false.
 */
function when(ctx, expr) {
  if (typeof expr === "boolean") return expr;
  if (expr === undefined || expr === null) return true;
  let s = String(expr).trim();
  let not = false;
  while (s.startsWith("!")) {
    not = !not;
    s = s.slice(1).trim();
  }
  const v = hasPlaceholder(s) ? fill(ctx, s, { missing: "empty" }) : get(ctx, s);
  return not ? !truthy(v) : truthy(v);
}

function truthy(v) {
  if (typeof v === "string") return !["", "false", "no", "off", "0"].includes(v.trim().toLowerCase());
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "boolean") return v;
  return !isEmpty(v);
}

/**
 * Every value path in a sample input's context, for a value picker:
 * [{ path, type, sample }].
 */
function valuePaths(ctx, { maxDepth = 4, max = 300 } = {}) {
  const out = [];
  const walk = (v, p, d) => {
    if (out.length >= max) return;
    const type = Array.isArray(v) ? "list" : v === null ? "null" : typeof v;
    if (p) out.push({ path: p, type, ...(type === "object" || type === "list" ? {} : { sample: v }) });
    if (d >= maxDepth) return;
    if (isObj(v)) for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k, d + 1);
  };
  for (const root of ["handoff", "item", "workspace", "picks", "row", "settings", "step", "job"]) {
    const v = ctx[root];
    if (isObj(v)) {
      const plain = {};
      for (const [k, x] of Object.entries(v)) if (typeof x !== "function") plain[k] = x;
      walk(plain, root, 0);
    }
  }
  return out;
}

module.exports = { ROOTS, lookup, get, fill, when, truthy, hasPlaceholder, valuePaths };
