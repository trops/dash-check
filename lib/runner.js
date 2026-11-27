/**
 * runner.js: check(), describe() and running them.
 *
 * A run gives
 *   { pass, reason, checks: [{ name, pass, skipped?, reason, failures: [{ message, at?, expected, received }], ms }] }
 * and, run as a file, prints a report and then one last line,
 * {"reason", "details"}: Dash's check contract, so Dash needs no new parsing.
 *
 * A `.check.js` file runs itself when node runs it directly
 * (`node validate.check.js`), the way Dash runs a repo check today.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { collect, display } = require("./scope");
const { createContext } = require("./context");

const PKG_ROOT = path.resolve(__dirname, "..");

let suite = [];
let prefix = [];
let collecting = 0;
let autorunScheduled = false;
let ranByHand = false;

function add(name, fn, mode) {
  if (typeof name !== "string" || !name.trim()) throw new TypeError("check(name, fn): give the check a name");
  if (typeof fn !== "function" && mode !== "skip") throw new TypeError(`check("${name}"): give it a function, (ctx) => { … }`);
  suite.push({ name: [...prefix, name.trim()].join(" › "), fn, mode });
  maybeAutorun();
}

/**
 * Define a check. `fn` gets the context and may be async.
 * @param {string} name what it proves, said so a failure reads well
 * @param {(ctx: object) => any} fn
 */
function check(name, fn) {
  add(name, fn, null);
}
check.skip = (name, fn) => add(name, fn, "skip");
check.only = (name, fn) => add(name, fn, "only");

/** Group checks; their names are prefixed with the group's ("group › check"). */
function describe(name, fn) {
  prefix.push(String(name));
  try {
    const r = fn();
    if (r && typeof r.then === "function") throw new TypeError(`describe("${name}") can't be async: put the awaits inside check()`);
  } finally {
    prefix.pop();
  }
}

/** The checks defined so far (and forget them). */
function takeChecks() {
  const out = suite;
  suite = [];
  prefix = [];
  return out;
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Run a list of checks against a context.
 * @param {Array<{ name, fn, mode }>} checks
 * @param {object} ctx  from createContext
 * @param {{ filter?: (name: string) => boolean }} [opts]
 */
async function runChecks(checks, ctx, opts = {}) {
  const hasOnly = checks.some((c) => c.mode === "only");
  const results = [];
  for (const c of checks) {
    const skip = c.mode === "skip" || (hasOnly && c.mode !== "only") || (opts.filter && !opts.filter(c.name));
    if (skip) {
      results.push({ name: c.name, pass: true, skipped: true, reason: "Skipped", failures: [], ms: 0 });
      continue;
    }
    const t0 = Date.now();
    const s = await collect(() => c.fn(ctx));
    const pass = s.failures.length === 0;
    results.push({
      name: c.name,
      pass,
      reason: pass ? s.notes.join("; ") || "Passed" : cut(s.failures.map(display).join("; "), 2000),
      failures: s.failures,
      ms: Date.now() - t0,
    });
  }
  return summarize(results);
}

/** The run's pass and reason, from its checks. */
function summarize(checks) {
  const ran = checks.filter((c) => !c.skipped);
  if (!checks.length) {
    return { pass: false, reason: "There are no checks here: add one with check(name, fn)", checks };
  }
  const failed = ran.filter((c) => !c.pass);
  if (!failed.length) {
    if (!ran.length) return { pass: true, reason: `Skipped all ${checks.length}`, checks };
    if (ran.length === 1) {
      const c = ran[0];
      return { pass: true, reason: c.reason && c.reason !== "Passed" ? `${c.name}: ${c.reason}` : `Passed: ${c.name}`, checks };
    }
    return { pass: true, reason: cut(`${ran.length} checks passed: ${ran.map((c) => c.name).join("; ")}`, 500), checks };
  }
  const all = failed.flatMap((c) => c.failures.map(display));
  const shown = all.slice(0, 3).join("; ");
  const more = all.length > 3 ? ` (and ${all.length - 3} more)` : "";
  return { pass: false, reason: cut(`${shown}${more}`, 1500), checks };
}

/** A result's last line: {"reason", "details"} (Dash's contract). */
function lastLine(result) {
  const details = {
    checks: (result.checks || []).map((c) => ({
      name: c.name,
      pass: c.pass,
      ...(c.skipped ? { skipped: true } : {}),
      reason: c.reason,
      ...(c.failures && c.failures.length
        ? { failures: c.failures.slice(0, 10).map((f) => ({ message: f.message, ...(f.at ? { at: f.at } : {}), ...("expected" in f ? { expected: f.expected } : {}), ...("received" in f ? { received: f.received } : {}) })) }
        : {}),
    })),
    ...(result.steps ? { steps: result.steps.map((s) => ({ index: s.index, label: s.label, pass: s.pass, ...(s.skipped ? { skipped: true } : {}), reason: s.reason })) } : {}),
  };
  let line = JSON.stringify({ reason: result.reason, details });
  if (line.length > 60000) line = JSON.stringify({ reason: result.reason, details: { cut: true } });
  return line;
}

/** A Jest-like report of a result. */
function report(result, { title, color = false } = {}) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const lines = [];
  if (title) lines.push(`${result.pass ? c("42;30", " PASS ") : c("41;37", " FAIL ")} ${title}`);
  const items = result.steps || result.checks || [];
  for (const it of items) {
    const name = it.label || it.name;
    if (it.skipped) lines.push(`  ${c(33, "○")} ${name} ${c(2, "(skipped)")}`);
    else if (it.pass) lines.push(`  ${c(32, "✓")} ${name}${it.reason && it.reason !== "Passed" ? c(2, ` (${it.reason})`) : ""}${it.ms ? c(2, ` ${it.ms} ms`) : ""}`);
    else {
      lines.push(`  ${c(31, "✗")} ${name}`);
      for (const f of it.failures || []) lines.push(`      ${c(31, "●")} ${display(f)}`);
    }
  }
  return lines.join("\n");
}

/** Read a check input file (Dash's $DASH_INPUT). `{}` when there's none. */
function readInput(file) {
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_e) {
    return {};
  }
}

/**
 * Run the checks defined so far (in this file).
 * @param {object} [input]  the check input; default: $DASH_INPUT
 * @param {object} [opts]   createContext options, plus { ctx } to give your own
 */
async function run(input, opts = {}) {
  ranByHand = true;
  const ctx = opts.ctx || createContext(input === undefined ? readInput(process.env.DASH_INPUT) : input, opts);
  return runChecks(takeChecks(), ctx, opts);
}

/** Load a .check.js file's checks without running them. */
function loadChecks(file) {
  const full = path.resolve(file);
  const before = takeChecks();
  collecting++;
  try {
    delete require.cache[full];
    require(full);
    return takeChecks();
  } finally {
    collecting--;
    suite = before;
  }
}

function isInside(file, dir) {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function shouldAutorun() {
  if (collecting || autorunScheduled || process.env.DASH_CHECK_NO_AUTORUN) return false;
  const main = require.main && require.main.filename;
  if (!main) return false;
  return /\.check\.c?js$/.test(main) || !isInside(main, PKG_ROOT);
}

function maybeAutorun() {
  if (!shouldAutorun()) return;
  autorunScheduled = true;
  setImmediate(async () => {
    if (ranByHand) return;
    const result = await runChecks(takeChecks(), createContext(readInput(process.env.DASH_INPUT)));
    const text = process.env.DASH_CHECK_QUIET ? "" : report(result);
    if (text) process.stdout.write(`${text}\n`);
    process.stdout.write(`${lastLine(result)}\n`);
    process.exitCode = result.pass ? 0 : 1;
  });
}

module.exports = { check, describe, run, runChecks, summarize, takeChecks, loadChecks, lastLine, report, readInput };
