/**
 * util.js: small pure helpers shared by the core (no I/O).
 */
"use strict";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** An error a check's author can act on. `fix` says what to do about it. */
class DashCheckError extends Error {
  constructor(message, { fix, code } = {}) {
    super(fix ? `${message}: ${fix}` : message);
    this.name = "DashCheckError";
    if (fix) this.fix = fix;
    if (code !== undefined) this.code = code;
  }
}

/** Empty: undefined, null, "", "   ", [], {}. */
function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  if (isObj(v)) return Object.keys(v).length === 0;
  return false;
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof RegExp || b instanceof RegExp) return String(a) === String(b);
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** A value as short text for a failure message. */
function fmt(v, max = 200) {
  let s;
  if (v === undefined) return "missing";
  if (typeof v === "string") s = JSON.stringify(v);
  else if (v instanceof RegExp) s = String(v);
  else if (typeof v === "function") s = `[function ${v.name || "anonymous"}]`;
  else if (v instanceof Error) s = `${v.name}: ${v.message}`;
  else {
    try {
      s = JSON.stringify(v);
    } catch (_e) {
      s = String(v);
    }
    if (s === undefined) s = String(v);
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A JSON-safe, size-capped copy of a value (for a result's failures). */
function safe(v, depth = 0) {
  if (v === undefined) return undefined;
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 500 ? `${v.slice(0, 499)}…` : v;
  if (typeof v === "bigint") return String(v);
  if (v instanceof RegExp) return String(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "function") return `[function ${v.name || "anonymous"}]`;
  if (depth >= 4) return Array.isArray(v) ? `[${v.length} items]` : "{…}";
  if (Array.isArray(v)) {
    const out = v.slice(0, 20).map((x) => safe(x, depth + 1));
    if (v.length > 20) out.push(`… and ${v.length - 20} more`);
    return out;
  }
  if (typeof v === "object") {
    const out = {};
    const keys = Object.keys(v);
    for (const k of keys.slice(0, 30)) out[k] = safe(v[k], depth + 1);
    if (keys.length > 30) out["…"] = `${keys.length - 30} more keys`;
    return out;
  }
  return String(v);
}

/** Split "a.b.0.c" into ["a", "b", "0", "c"]. */
const splitPath = (p) => String(p).split(".").filter((s) => s !== "");

/** The value at a dotted path, or undefined. */
function getPath(obj, p) {
  let cur = obj;
  for (const k of Array.isArray(p) ? p : splitPath(p)) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** The last `n` characters of some output, on a line boundary when it can. */
function tail(text, n = 1500) {
  const s = String(text || "").trimEnd();
  if (s.length <= n) return s;
  const cut = s.slice(-n);
  const nl = cut.indexOf("\n");
  return `…${nl >= 0 && nl < 200 ? cut.slice(nl) : cut}`;
}

module.exports = {
  isObj,
  isEmpty,
  deepEqual,
  fmt,
  safe,
  splitPath,
  getPath,
  plural,
  tail,
  DashCheckError,
};
