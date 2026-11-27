/**
 * scope.js: where a failing `expect` goes.
 *
 * Inside a running check, failures are collected (like a Jest report, every
 * one is listed) and the check goes on. Outside one, a failure throws a
 * CheckFailure straight away.
 */
"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const { safe } = require("./util");

const store = new AsyncLocalStorage();

/** Thrown by `expect` outside a running check, and by `collect` on failure. */
class CheckFailure extends Error {
  constructor(failures) {
    const list = Array.isArray(failures) ? failures : [failures];
    super(list.map(display).join("; ") || "Failed");
    this.name = "CheckFailure";
    this.failures = list;
  }
}

/** How a failure reads: its message, and where when it says. */
function display(f) {
  if (!f) return "";
  return f.at ? `${f.message}: ${f.at}` : f.message;
}

function makeFailure(message, extra = {}) {
  const f = { message: String(message || "Failed") };
  if (f.message.length > 2000) f.message = `${f.message.slice(0, 1999)}…`;
  if (extra.at) f.at = String(extra.at).slice(0, 1000);
  if ("expected" in extra && extra.expected !== undefined) f.expected = safe(extra.expected);
  if ("received" in extra) f.received = safe(extra.received);
  if (extra.matcher) f.matcher = extra.matcher;
  if (extra.label) f.label = extra.label;
  if (extra.error) f.error = true;
  return f;
}

/** Record a failure in the running check, or throw one outside a check. */
function record(failure) {
  const s = store.getStore();
  if (!s) throw new CheckFailure([failure]);
  s.failures.push(failure);
  return failure;
}

/**
 * Fail the running check with a message (the fix), going on with the rest.
 * @param {string} message what to fix
 * @param {{ at?: string, expected?: any, received?: any }} [extra]
 */
function fail(message, extra) {
  record(makeFailure(message, extra));
  return false;
}

/** Say how the running check passed (its reason, when nothing failed). */
function note(text) {
  const s = store.getStore();
  if (s && text) s.notes.push(String(text));
}

/**
 * Run `fn` with its own failure list. Resolves with { failures, notes,
 * error }; never throws.
 */
async function collect(fn) {
  const s = { failures: [], notes: [] };
  await store.run(s, async () => {
    try {
      await fn();
    } catch (e) {
      addError(s, e);
    }
  });
  return s;
}

/** An error thrown inside a check, as a failure. */
function addError(s, e) {
  if (e instanceof CheckFailure) {
    s.failures.push(...e.failures);
    return;
  }
  const msg = e && e.message ? e.message : String(e);
  const named = e && e.name && e.name !== "Error" && e.name !== "DashCheckError" ? `${e.name}: ` : "";
  s.failures.push(makeFailure(`${named}${msg}`, { error: true }));
}

const current = () => store.getStore() || null;

module.exports = {
  store,
  CheckFailure,
  makeFailure,
  record,
  fail,
  note,
  collect,
  addError,
  current,
  display,
};
