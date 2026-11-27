/**
 * @trops/dash-check/recipe: checks as data.
 *
 *   { "name": "the work is ready for review",
 *     "steps": [
 *       { "use": "git.committedSince", "with": { "base": "{repo.baseBranch}" } },
 *       { "expect": "handoff.files", "matcher": "toHaveLengthAtLeast", "args": [1],
 *         "message": "The handoff lists no changed files" } ] }
 *
 * validateRecipe, compileRecipe, runRecipe (a result per step),
 * recipeToCode (the same check as a .check.js file) and explain (sentences).
 * A recipe makes the same calls a file makes: helpers and expect.
 */
"use strict";

const core = require("..");
require("../helpers");
const schema = require("./schema.json");

const { expect, getHelper, sentenceOf, createContext, collect, fill, when, get, valuePaths } = core;
const { summarize } = require("../lib/runner");
const { coerce } = require("../lib/helper");
const { display } = require("../lib/scope");
const { isObj, fmt } = require("../lib/util");
const { hasPlaceholder } = require("../lib/values");

const PATH_RE = /^[A-Za-z_$][\w$-]*(\.[\w$-]+)*$/;
const HELPER_ID_RE = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;
const USE_KEYS = ["use", "with", "when", "message", "label"];
const EXPECT_KEYS = ["expect", "matcher", "args", "not", "when", "message", "label"];
const TOP_KEYS = ["$schema", "name", "description", "version", "steps"];

/**
 * What's wrong with a recipe.
 * @param {object} recipe
 * @param {{ getHelper?: (id: string) => any }} [opts]  where helpers are found
 * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }> }}
 */
function validateRecipe(recipe, opts = {}) {
  const find = opts.getHelper || getHelper;
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isObj(recipe)) {
    err("", "A recipe is a JSON object: { \"name\": …, \"steps\": [ … ] }");
    return { valid: false, errors };
  }
  for (const k of Object.keys(recipe)) if (!TOP_KEYS.includes(k)) err(k, `"${k}" isn't part of a recipe (use ${TOP_KEYS.slice(1).join(", ")})`);
  if (typeof recipe.name !== "string" || !recipe.name.trim()) err("name", "Give the recipe a name: what it proves");
  if (recipe.description !== undefined && typeof recipe.description !== "string") err("description", "description must be text");
  if (recipe.version !== undefined && recipe.version !== 1) err("version", "This dash-check reads recipe version 1");
  if (!Array.isArray(recipe.steps) || !recipe.steps.length) {
    err("steps", "Add at least one step: { \"use\": \"helper.id\" } or { \"expect\": \"handoff.key\", \"matcher\": \"toBeDefined\" }");
    return { valid: false, errors };
  }
  recipe.steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!isObj(s)) return err(at, "A step is an object");
    const isUse = s.use !== undefined;
    const isExpect = s.expect !== undefined;
    if (isUse === isExpect) return err(at, 'A step has either "use" (a helper) or "expect" (a value), not both or neither');
    const keys = isUse ? USE_KEYS : EXPECT_KEYS;
    for (const k of Object.keys(s)) if (!keys.includes(k)) err(`${at}.${k}`, `"${k}" isn't part of a${isUse ? " use" : "n expect"} step`);
    if (s.message !== undefined && typeof s.message !== "string") err(`${at}.message`, "message must be text");
    if (s.label !== undefined && typeof s.label !== "string") err(`${at}.label`, "label must be text");
    if (s.when !== undefined && typeof s.when !== "string" && typeof s.when !== "boolean") err(`${at}.when`, "when is a value path or a {placeholder}");
    if (isUse) {
      if (typeof s.use !== "string" || !HELPER_ID_RE.test(s.use)) return err(`${at}.use`, `"${s.use}" isn't a helper id (e.g. git.committedSince)`);
      const h = find(s.use);
      if (!h) return err(`${at}.use`, `There's no helper ${s.use}`);
      if (s.with !== undefined && !isObj(s.with)) return err(`${at}.with`, "with is an object of the helper's params");
      const given = s.with || {};
      const params = h.meta.params;
      for (const k of Object.keys(given)) {
        if (k === "message") err(`${at}.with.message`, 'Put message on the step, next to "use"');
        else if (!params[k]) err(`${at}.with.${k}`, `${s.use} has no param "${k}" (it has ${Object.keys(params).join(", ") || "none"})`);
      }
      for (const [k, p] of Object.entries(params)) {
        const v = given[k];
        if (v === undefined) {
          if (p.required && p.default === undefined) err(`${at}.with.${k}`, `${s.use} needs ${p.label} (${k})`);
          continue;
        }
        if (typeof v === "string" && hasPlaceholder(v)) continue;
        if (p.type === "list" && Array.isArray(v) && v.some((x) => typeof x === "string" && hasPlaceholder(x))) continue;
        try {
          coerce(s.use, k, p, v);
        } catch (e) {
          err(`${at}.with.${k}`, e.message);
        }
      }
    } else {
      if (typeof s.expect !== "string" || !PATH_RE.test(s.expect)) err(`${at}.expect`, `"${s.expect}" isn't a value path (e.g. handoff.files)`);
      const m = typeof s.matcher === "string" ? expect.meta(s.matcher) : null;
      if (!m) {
        err(`${at}.matcher`, `There's no matcher ${fmt(s.matcher)} (use one of ${expect.matchers().map((x) => x.id).join(", ")})`);
        return;
      }
      if (s.args !== undefined && !Array.isArray(s.args)) return err(`${at}.args`, "args is a list of the matcher's params");
      const n = (s.args || []).length;
      if (n !== m.params.length) {
        err(`${at}.args`, `${s.matcher} takes ${m.params.length} arg${m.params.length === 1 ? "" : "s"}${m.params.length ? ` (${m.params.map((p) => p.name).join(", ")})` : ""}, not ${n}`);
      }
      (s.args || []).forEach((a, j) => {
        const p = m.params[j];
        if (!p) return;
        if (p.type === "number" && typeof a !== "number" && !(typeof a === "string" && hasPlaceholder(a))) err(`${at}.args[${j}]`, `${p.label} must be a number`);
        if (p.type === "list" && !Array.isArray(a) && !(typeof a === "string" && hasPlaceholder(a))) err(`${at}.args[${j}]`, `${p.label} must be a list`);
        if (p.type === "regex" && typeof a === "string" && !hasPlaceholder(a)) {
          try {
            new RegExp(a);
          } catch (e) {
            err(`${at}.args[${j}]`, `${p.label} isn't a valid pattern (${e.message})`);
          }
        }
      });
      if (s.not !== undefined && typeof s.not !== "boolean") err(`${at}.not`, "not is true or false");
    }
  });
  return { valid: errors.length === 0, errors };
}

/** A step's row label ("Work is committed", "Expect handoff.files"). */
function stepLabel(step, find = getHelper) {
  if (step.label) return step.label;
  if (step.use) {
    const h = find(step.use);
    return h ? h.meta.label : step.use;
  }
  return `Expect ${step.expect}`;
}

function matcherArgs(ctx, step) {
  const args = (step.args || []).map((a) => fill(ctx, a));
  const meta = expect.meta(step.matcher);
  return args.map((a, i) => (meta.params[i] && meta.params[i].type === "regex" && typeof a === "string" ? new RegExp(a) : a));
}

/**
 * A recipe as functions: { name, steps: [{ index, label, when, run(ctx) }], check(ctx) }.
 * `check(ctx)` runs every step the way a .check.js file would.
 * Throws when the recipe isn't valid, listing every problem.
 */
function compileRecipe(recipe, opts = {}) {
  const v = validateRecipe(recipe, opts);
  if (!v.valid) {
    const e = new Error(`The recipe isn't valid: ${v.errors.map((x) => `${x.path ? `${x.path}: ` : ""}${x.message}`).join("; ")}`);
    e.errors = v.errors;
    throw e;
  }
  const find = opts.getHelper || getHelper;
  const steps = recipe.steps.map((step, index) => {
    let run;
    if (step.use) {
      const h = find(step.use);
      run = (ctx) => h(ctx, { ...(step.with || {}), ...(step.message ? { message: step.message } : {}) });
    } else {
      run = (ctx) => {
        const args = matcherArgs(ctx, step);
        const e = expect(get(ctx, step.expect), step.expect);
        const m = step.not ? e.not : e;
        return m[step.matcher](...args, ...(step.message ? [fill(ctx, step.message, { missing: "keep" })] : []));
      };
    }
    return { index, label: stepLabel(step, find), when: step.when, run, step };
  });
  async function check(ctx) {
    for (const s of steps) {
      if (s.when !== undefined && !when(ctx, s.when)) continue;
      await s.run(ctx);
    }
  }
  return { name: recipe.name.trim(), steps, check };
}

/**
 * Run a recipe: a result per step, and the check's result.
 * @param {object} recipe
 * @param {object} [input]   the check input (a sample, or Dash's)
 * @param {{ only?: number[], ctx?: object, getHelper?: Function } & object} [opts]
 *   only: run just these steps (by index); others createContext options
 * @returns {Promise<{ pass, reason, checks, steps: Array<{ index, label, sentence, pass, skipped?, reason, failures, ms }> }>}
 */
async function runRecipe(recipe, input, opts = {}) {
  let compiled;
  try {
    compiled = compileRecipe(recipe, opts);
  } catch (e) {
    const name = (isObj(recipe) && typeof recipe.name === "string" && recipe.name) || "recipe";
    return {
      pass: false,
      reason: e.message,
      errors: e.errors || [],
      checks: [{ name, pass: false, reason: e.message, failures: [{ message: e.message }] }],
      steps: [],
    };
  }
  const ctx = opts.ctx || createContext(input || {}, opts);
  const only = Array.isArray(opts.only) ? opts.only : null;
  const lines = explain(recipe, opts);
  const steps = [];
  const failures = [];
  const notes = [];
  let broken = null;
  const t0 = Date.now();
  for (const s of compiled.steps) {
    const base = { index: s.index, label: s.label, sentence: lines[s.index] };
    if (only && !only.includes(s.index)) {
      steps.push({ ...base, pass: true, skipped: true, reason: "Not run (only other steps were asked for)", failures: [] });
      continue;
    }
    if (broken !== null) {
      steps.push({ ...base, pass: false, skipped: true, reason: `Not run: step ${broken + 1} broke`, failures: [] });
      continue;
    }
    if (s.when !== undefined && !when(ctx, s.when)) {
      steps.push({ ...base, pass: true, skipped: true, reason: `Skipped: ${s.when} is false`, failures: [] });
      continue;
    }
    const t = Date.now();
    const r = await collect(() => s.run(ctx));
    if (r.failures.some((f) => f.error) && !s.step.use) broken = s.index;
    const pass = r.failures.length === 0;
    failures.push(...r.failures);
    notes.push(...r.notes);
    steps.push({
      ...base,
      pass,
      reason: pass ? r.notes.join("; ") || "Passed" : r.failures.map(display).join("; "),
      failures: r.failures,
      ms: Date.now() - t,
    });
  }
  const pass = failures.length === 0;
  const checkRec = {
    name: compiled.name,
    pass,
    reason: pass ? notes.join("; ") || "Passed" : failures.map(display).join("; "),
    failures,
    ms: Date.now() - t0,
  };
  return { ...summarize([checkRec]), steps };
}

// ---- recipe → code ------------------------------------------------------

const IDENT = /^[A-Za-z_$][\w$]*$/;

function jsValue(v, indent) {
  if (Array.isArray(v)) {
    const inner = v.map((x) => jsValue(x, indent));
    const one = `[${inner.join(", ")}]`;
    return one.length <= 70 ? one : `[\n${inner.map((x) => `${indent}  ${x}`).join(",\n")},\n${indent}]`;
  }
  if (isObj(v)) return jsObject(v, indent);
  return JSON.stringify(v);
}

function jsObject(o, indent) {
  const entries = Object.entries(o).map(([k, v]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${jsValue(v, `${indent}  `)}`);
  if (!entries.length) return "{}";
  const one = `{ ${entries.join(", ")} }`;
  if (one.length <= 72 && !one.includes("\n")) return one;
  return `{\n${entries.map((e) => `${indent}  ${e}`).join(",\n")},\n${indent}}`;
}

/** A value path as JS on ctx: handoff.plan.cause → ctx.handoff.plan?.cause. */
function pathCode(p) {
  const parts = p.split(".");
  const { ROOTS } = require("../lib/values");
  if (!ROOTS.includes(parts[0]) || parts.length === 1 || !parts.every((x) => IDENT.test(x) || /^\d+$/.test(x))) {
    return `ctx.get(${JSON.stringify(p)})`;
  }
  let out = `ctx.${parts[0]}`;
  parts.slice(1).forEach((k, i) => {
    const acc = /^\d+$/.test(k) ? `[${k}]` : `.${k}`;
    out += i === 0 ? acc : `?.${acc.replace(/^\./, "")}`;
  });
  return out;
}

function argCode(a, type) {
  if (typeof a === "string" && hasPlaceholder(a)) return `ctx.fill(${JSON.stringify(a)})`;
  if (type === "regex" && typeof a === "string") {
    try {
      return String(new RegExp(a));
    } catch (_e) {
      return JSON.stringify(a);
    }
  }
  return jsValue(a, "  ");
}

/**
 * The recipe as a .check.js file that gives the same result.
 * @param {object} recipe
 * @param {{ getHelper?: Function, file?: string }} [opts]
 */
function recipeToCode(recipe, opts = {}) {
  const compiled = compileRecipe(recipe, opts);
  const find = opts.getHelper || getHelper;
  const groups = new Set();
  let usesHelperById = false;
  let usesExpect = false;
  const body = [];
  for (const s of compiled.steps) {
    const step = s.step;
    const pad = step.when !== undefined ? "    " : "  ";
    const lines = [];
    if (step.use) {
      const h = find(step.use);
      const builtin = require("../helpers").all.includes(h);
      const params = { ...(step.with || {}), ...(step.message ? { message: step.message } : {}) };
      const arg = Object.keys(params).length ? `, ${jsObject(params, pad)}` : "";
      if (builtin) {
        const [g, ...rest] = step.use.split(".");
        groups.add(g);
        lines.push(`${pad}await ${g}.${rest.join(".")}(ctx${arg});`);
      } else {
        usesHelperById = true;
        lines.push(`${pad}await helper(${JSON.stringify(step.use)})(ctx${arg});`);
      }
    } else {
      usesExpect = true;
      const meta = expect.meta(step.matcher);
      const args = (step.args || []).map((a, i) => argCode(a, meta.params[i] && meta.params[i].type));
      if (step.message) args.push(hasPlaceholder(step.message) ? `ctx.fill(${JSON.stringify(step.message)}, { missing: "keep" })` : JSON.stringify(step.message));
      const head = `${pad}expect(${pathCode(step.expect)}, ${JSON.stringify(step.expect)})`;
      const call = `${step.not ? ".not" : ""}.${step.matcher}(${args.join(", ")});`;
      if (head.length + call.length <= 90) lines.push(head + call);
      else lines.push(head, `${pad}  ${call}`);
    }
    if (step.when !== undefined) {
      body.push(`  if (ctx.when(${JSON.stringify(step.when)})) {`, ...lines, "  }");
    } else body.push(...lines);
  }
  const coreNames = ["check", ...(usesExpect ? ["expect"] : []), ...(usesHelperById ? ["helper"] : [])];
  const file = opts.file || `.dash/checks/${slug(recipe.name)}.check.js`;
  const head = [
    `// ${file} (generated by recipeToCode)`,
    `const { ${coreNames.join(", ")} } = require("@trops/dash-check");`,
  ];
  if (groups.size) head.push(`const { ${[...groups].join(", ")} } = require("@trops/dash-check/helpers");`);
  return `${head.join("\n")}\n\ncheck(${JSON.stringify(compiled.name)}, async (ctx) => {\n${body.join("\n")}\n});\n`;
}

/** A name as a file name: "The work is ready" → "the-work-is-ready". */
function slug(name) {
  return String(name || "check").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "check";
}

// ---- explain --------------------------------------------------------------

/**
 * The recipe as sentences, one per step:
 *   "Work is committed: at least 1 commit(s) past {repo.baseBranch}, and nothing uncommitted"
 * @returns {string[]}
 */
function explain(recipe, opts = {}) {
  const find = opts.getHelper || getHelper;
  if (!isObj(recipe) || !Array.isArray(recipe.steps)) return [];
  return recipe.steps.map((s) => {
    if (!isObj(s)) return "(not a step)";
    let text;
    if (s.use) {
      const h = find(s.use);
      if (!h) text = `${s.use} (no such helper)`;
      else {
        const said = sentenceOf(h.meta, s.with || {});
        text = `${s.label || h.meta.label}${said ? `: ${said}` : ""}`;
      }
    } else {
      const said = expect.has(s.matcher) ? expect.sentence(s.matcher, s.expect, s.args || [], !!s.not) : `${s.expect} ${s.matcher}`;
      text = `${s.label ? `${s.label}: ` : ""}Expect ${said}`;
    }
    if (s.when !== undefined) text = `Only when ${s.when}: ${text}`;
    if (s.message) text += `. If it fails, say: "${s.message}"`;
    return text;
  });
}

module.exports = { schema, validateRecipe, compileRecipe, runRecipe, recipeToCode, toCode: recipeToCode, explain, valuePaths, slug, pathCode };
