/**
 * @trops/dash-check/cli: `dash-check`, run a repo's checks the way Dash
 * runs them.
 *
 *   dash-check                          every check in .dash/checks/
 *   dash-check <name> [--input f.json]  one check (<name>.sample.json by default)
 *   dash-check --watch                  run again on every change
 *   dash-check --ci                     a Jest-like report, exit 1 on failure
 *   dash-check --list                   what's there
 *   dash-check --list-helpers [--json] [--input f.json]
 *                                       every helper and matcher (the composer's palette)
 *   dash-check --explain <file>         a check as sentences
 *   dash-check new <name> [--recipe]    a new check and its sample input
 *
 * A check gets Dash's contract: cwd is the repo, the input as JSON in
 * $DASH_INPUT and on stdin, DASH_ITEM_*, DASH_WORKSPACE, DASH_BRANCH and
 * DASH_STEP; exit 0 passes; a last line of {"reason", "details"} says why.
 * `.check.js` files run in their own node, `.check.json` recipes run here,
 * and any other file runs by its #! line, else its extension (.js node,
 * .sh bash, .py python3, else sh).
 *
 * Exit codes: 0 passed, 1 a check failed, 2 bad arguments or no such check.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const core = require("..");
const recipe = require("../recipe");
const { loadHelpers } = require("../lib/discover");
const { report, loadChecks } = require("../lib/runner");

const CHECKS_DIR = ".dash/checks";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const RUNNERS = { ".js": "node", ".cjs": "node", ".mjs": "node", ".sh": "bash", ".bash": "bash", ".py": "python3" };
const DEFAULT_TIMEOUT_SEC = 120;
const SAMPLE = { input: { answer: "" }, item: null, workspace: null };
const REGISTER = path.join(__dirname, "..", "lib", "register.js");

const USAGE = `Usage:
  dash-check                          run every check in ${CHECKS_DIR}/
  dash-check <name> [--input f.json]  run one (default input: <name>.sample.json)
  dash-check --watch                  run again on every change
  dash-check --ci [a,b]               a Jest-like report; exit 1 on failure
  dash-check --list                   list the checks
  dash-check --list-helpers [--json] [--input f.json]
                                      every helper and matcher, with metadata
  dash-check --explain <file>         a check as sentences
  dash-check new <name> [--recipe]    scaffold a check and its sample input
Options: --cwd <dir>, --timeout <sec>, --json (results as JSON), --no-color`;

function parseArgs(argv) {
  const a = { names: [], cwd: process.cwd(), input: null, timeout: null, color: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const val = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${v} needs a value`);
      return x;
    };
    try {
      if (v === "--input" || v === "-i") a.input = val();
      else if (v === "--cwd") a.cwd = path.resolve(val());
      else if (v === "--timeout") a.timeout = Number(val());
      else if (v === "--watch" || v === "-w") a.watch = true;
      else if (v === "--ci") {
        a.ci = true;
        if (argv[i + 1] && !argv[i + 1].startsWith("-")) a.names.push(...argv[++i].split(",").filter(Boolean));
      } else if (v === "--list") a.list = true;
      else if (v === "--list-helpers") a.listHelpers = true;
      else if (v === "--json") a.json = true;
      else if (v === "--explain") a.explain = val();
      else if (v === "--recipe") a.recipe = true;
      else if (v === "--no-color") a.color = false;
      else if (v === "--help" || v === "-h") a.help = true;
      else if (v.startsWith("-")) return { error: `Unknown option ${v}` };
      else a.names.push(v);
    } catch (e) {
      return { error: e.message };
    }
  }
  if (a.names[0] === "new" && !a.ci) {
    a.create = a.names[1] || "";
    a.names = [];
  }
  return a;
}

/** The checks in a repo: [{ name, file, type: "js" | "recipe" | "exec", sample? }]. */
function listChecks(cwd) {
  const dir = path.join(cwd, CHECKS_DIR);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const f = e.name;
    if (f.startsWith(".")) continue;
    if (e.isDirectory()) {
      if (f === "helpers") continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, f, "check.json"), "utf8"));
        if (m && typeof m.run === "string") out.push({ name: f, file: path.join(f, m.run), type: "exec", order: 2 });
      } catch (_e) {
        // A folder that isn't a check package.
      }
      continue;
    }
    let m;
    if ((m = f.match(/^(.+)\.check\.c?js$/))) out.push({ name: m[1], file: f, type: "js", order: 0 });
    else if ((m = f.match(/^(.+)\.check\.json$/))) out.push({ name: m[1], file: f, type: "recipe", order: 0 });
    else if (/\.(md|json|txt|d\.ts)$/i.test(f)) continue;
    else out.push({ name: f.replace(/\.[^.]+$/, ""), file: f, type: "exec", order: 1 });
  }
  out.sort((x, y) => x.name.localeCompare(y.name) || x.order - y.order || x.file.localeCompare(y.file));
  const seen = new Set();
  return out
    .filter((c) => (seen.has(c.name) ? false : seen.add(c.name)))
    .map((c) => {
      const sample = path.join(dir, `${c.name}.sample.json`);
      return { name: c.name, file: c.file, type: c.type, ...(fs.existsSync(sample) ? { sample } : {}) };
    });
}

function pick(checks, name) {
  return checks.find((c) => c.file === name) || checks.find((c) => c.name === name) || null;
}

function gitBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_e) {
    return "";
  }
}

/** The environment Dash gives a check. */
function dashEnv(cwd, input, name, inputFile) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const item = (input && input.item) || {};
  return {
    ...env,
    DASH_INPUT: inputFile,
    DASH_CHECK_QUIET: "1",
    DASH_STEP: name,
    DASH_WORKSPACE: cwd,
    DASH_BRANCH: (input && input.workspace && input.workspace.branch) || gitBranch(cwd),
    ...(item.id ? { DASH_ITEM_ID: String(item.id) } : {}),
    ...(item.title ? { DASH_ITEM_TITLE: String(item.title) } : {}),
    ...(item.url ? { DASH_ITEM_URL: String(item.url) } : {}),
    ...(item.source ? { DASH_ITEM_SOURCE: String(item.source) } : {}),
  };
}

/** The last {"reason", "details"} line of some output, or null. */
function lastProof(out) {
  const lines = String(out || "").trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
    try {
      const v = JSON.parse(lines[i]);
      if (v && typeof v === "object" && ("reason" in v || "details" in v)) return { proof: v, index: i, lines };
    } catch (_e) {
      // Not JSON.
    }
  }
  return null;
}

function spawnP(cmd, args, { cwd, env, input, timeoutSec }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: "", error: e });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutSec * 1000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: e });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Run one check entry: { pass, reason, checks, steps?, output, file }.
 * @param {{ name, file, type }} entry
 * @param {{ cwd: string, input: object, timeoutSec?: number }} opts
 */
async function runEntry(entry, { cwd, input, timeoutSec }) {
  const full = path.join(cwd, CHECKS_DIR, entry.file);
  const shown = `${CHECKS_DIR}/${entry.file}`;
  const limit = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : DEFAULT_TIMEOUT_SEC;
  if (entry.type === "recipe") {
    let r;
    try {
      r = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (e) {
      return fromReason(entry, false, `${shown} isn't valid JSON (${e.message})`);
    }
    const res = await recipe.runRecipe(r, input, { cwd, env: dashEnv(cwd, input, entry.name, "") });
    return { ...res, file: shown, output: "" };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dash-check-"));
  try {
    const inputFile = path.join(tmp, "input.json");
    const json = JSON.stringify(input);
    fs.writeFileSync(inputFile, json);
    const env = dashEnv(cwd, input, entry.name, inputFile);
    let cmd;
    let args;
    if (entry.type === "js") {
      cmd = process.execPath;
      args = ["-r", REGISTER, full];
    } else {
      let first = "";
      try {
        first = fs.readFileSync(full, "utf8").split(/\r?\n/, 1)[0] || "";
      } catch (_e) {
        first = "";
      }
      if (first.startsWith("#!")) {
        try {
          fs.chmodSync(full, 0o755);
        } catch (_e) {
          // Read-only: it'll fail to start and say so.
        }
        cmd = full;
        args = [];
      } else {
        const runner = RUNNERS[path.extname(full).toLowerCase()] || "sh";
        cmd = runner === "node" ? process.execPath : runner;
        args = runner === "node" ? ["-r", REGISTER, full] : [full];
      }
    }
    const r = await spawnP(cmd, args, { cwd, env, input: json, timeoutSec: limit });
    const output = `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
    if (r.timedOut) return { ...fromReason(entry, false, `Stopped after ${limit} seconds`), file: shown, output };
    if (r.error) return { ...fromReason(entry, false, `It couldn't start: ${r.error.message}`), file: shown, output };
    const found = lastProof(r.stdout);
    const pass = r.code === 0;
    const reason = (found && typeof found.proof.reason === "string" && found.proof.reason) || (pass ? "Passed (exit 0)" : `Failed (exit ${r.code})`);
    const shownOut = found ? [...found.lines.slice(0, found.index), ...found.lines.slice(found.index + 1)].join("\n") + (r.stderr ? `\n${r.stderr}` : "") : output;
    const details = found && found.proof.details;
    if (details && Array.isArray(details.checks)) {
      const checks = details.checks.map((c) => ({ ...c, failures: c.failures || [] }));
      return { pass, reason, checks, ...(details.steps ? { steps: details.steps } : {}), file: shown, output: shownOut.trim() };
    }
    return { ...fromReason(entry, pass, reason), file: shown, output: shownOut.trim() };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function fromReason(entry, pass, reason) {
  return { pass, reason, checks: [{ name: entry.name, pass, reason, failures: pass ? [] : [{ message: reason }] }] };
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Run checks and print. Gives the exit code. */
async function runAll(a, out) {
  const checks = listChecks(a.cwd);
  for (const n of a.names) {
    if (!NAME_RE.test(n) || n.includes("..")) {
      out.err(`"${n}" can't be a check's name`);
      return 2;
    }
  }
  let given = null;
  if (a.input) {
    try {
      given = readJsonFile(path.resolve(a.cwd, a.input));
    } catch (e) {
      out.err(`Can't read ${a.input}: ${e.message}`);
      return 2;
    }
  }
  const wanted = a.names.length ? a.names : checks.map((c) => c.name);
  if (!wanted.length) {
    out.log(`No ${CHECKS_DIR} here: nothing to run. Start one with: dash-check new <name>`);
    return 0;
  }
  loadHelpers({ cwd: a.cwd });
  const color = a.color === null ? !a.ci && !a.json && !!process.stdout.isTTY : a.color;
  const results = [];
  let failed = 0;
  for (const name of wanted) {
    const entry = pick(checks, name);
    if (!entry) {
      const msg = `there's no ${CHECKS_DIR}/${name}`;
      if (!a.ci && !a.json) {
        out.err(`✗ ${name}: ${msg}`);
        return 2;
      }
      failed++;
      results.push({ name, pass: false, reason: msg, checks: [], file: `${CHECKS_DIR}/${name}` });
      continue;
    }
    let input = given;
    if (!input && entry.sample) {
      try {
        input = readJsonFile(entry.sample);
      } catch (e) {
        out.err(`Can't read ${entry.sample}: ${e.message}`);
        return 2;
      }
    }
    const res = await runEntry(entry, { cwd: a.cwd, input: input || SAMPLE, timeoutSec: a.timeout });
    results.push({ name: entry.name, ...res });
    if (!res.pass) failed++;
    if (a.json) continue;
    if (a.ci) {
      out.log(report(res, { title: res.file, color }));
      if (!res.pass && res.output) out.log(indent(res.output.split("\n").slice(-30).join("\n"), "    "));
    } else if (res.pass) {
      const said = res.reason.startsWith(`${entry.name}: `) ? res.reason.slice(entry.name.length + 2) : res.reason;
      out.log(`✓ ${entry.name}: ${said}`);
    } else {
      if (res.output) out.log(res.output.split("\n").slice(-30).join("\n"));
      if (entry.type !== "exec") out.log(report(res, { color }));
      out.log(`✗ ${entry.name}: ${res.reason}`);
    }
  }
  if (a.json) {
    out.log(JSON.stringify({ pass: failed === 0, results }, null, 2));
  } else if (a.ci) {
    const all = results.flatMap((r) => r.checks || []);
    const nFail = all.filter((c) => !c.pass).length;
    const nSkip = all.filter((c) => c.skipped).length;
    const nPass = all.length - nFail - nSkip;
    const parts = [nFail ? `${nFail} failed` : null, nSkip ? `${nSkip} skipped` : null, `${nPass} passed`, `${all.length} total`].filter(Boolean);
    const files = [failed ? `${failed} failed` : null, `${results.length - failed} passed`, `${results.length} total`].filter(Boolean);
    out.log("");
    out.log(`Files:  ${files.join(", ")}`);
    out.log(`Checks: ${parts.join(", ")}`);
  }
  return failed ? 1 : 0;
}

const indent = (s, pad) => s.split("\n").map((l) => pad + l).join("\n");

function listHelpersCmd(a, out) {
  const found = loadHelpers({ cwd: a.cwd });
  const helpers = core.listHelpers();
  const matchers = core.expect.matchers();
  let values;
  if (a.input) {
    try {
      values = core.valuePaths(core.createContext(readJsonFile(path.resolve(a.cwd, a.input)), { cwd: a.cwd }));
    } catch (e) {
      out.err(`Can't read ${a.input}: ${e.message}`);
      return 2;
    }
  }
  if (a.json) {
    out.log(JSON.stringify({ helpers, matchers, errors: found.errors, ...(values ? { values } : {}) }, null, 2));
    return 0;
  }
  const groups = {};
  for (const h of helpers) (groups[h.group] = groups[h.group] || []).push(h);
  for (const [g, list] of Object.entries(groups)) {
    out.log(g);
    for (const h of list) out.log(`  ${h.id.padEnd(30)} ${h.label}${h.description ? ` (${h.description})` : ""}${h.source && h.source !== "@trops/dash-check" ? `  [${h.source}]` : ""}`);
  }
  out.log("Matchers");
  for (const m of matchers) out.log(`  ${m.id.padEnd(30)} ${m.sentence}`);
  for (const e of found.errors) out.err(`✗ ${e.source} didn't load: ${e.error}`);
  if (values) {
    out.log("Values in the sample");
    for (const v of values) out.log(`  ${v.path}${"sample" in v ? ` = ${JSON.stringify(v.sample)}` : ` (${v.type})`}`);
  }
  return 0;
}

function explainCmd(a, out) {
  const file = path.resolve(a.cwd, a.explain);
  if (!fs.existsSync(file)) {
    out.err(`There's no ${a.explain}`);
    return 2;
  }
  loadHelpers({ cwd: a.cwd });
  if (/\.json$/.test(file)) {
    let r;
    try {
      r = readJsonFile(file);
    } catch (e) {
      out.err(`${a.explain} isn't valid JSON: ${e.message}`);
      return 2;
    }
    const v = recipe.validateRecipe(r);
    out.log(r.name || path.basename(file));
    for (const line of recipe.explain(r)) out.log(`  - ${line}`);
    for (const e of v.errors) out.err(`✗ ${e.path ? `${e.path}: ` : ""}${e.message}`);
    return v.valid ? 0 : 1;
  }
  if (/\.check\.c?js$/.test(file)) {
    require("../lib/register");
    let checks;
    try {
      checks = loadChecks(file);
    } catch (e) {
      out.err(`${a.explain} didn't load: ${e.message}`);
      return 1;
    }
    out.log(`${path.basename(file)}: code, ${checks.length} check${checks.length === 1 ? "" : "s"}`);
    for (const c of checks) out.log(`  - ${c.name}${c.mode === "skip" ? " (skipped)" : c.mode === "only" ? " (only)" : ""}`);
    out.log("  (Code reads as its check names. Write it as a .check.json recipe to read every step as a sentence.)");
    return 0;
  }
  out.log(`${path.basename(file)}: a plain executable. Exit 0 passes; its last line {"reason"} says why.`);
  return 0;
}

const SAMPLE_INPUT = {
  input: { answer: 'Done.\n\n```json\n{ "status": "ok", "summary": "What the bot did", "files": ["src/index.js"] }\n```' },
  item: { id: "DASH-1", title: "An example work item" },
  workspace: { dir: ".", branch: "feat/DASH-1-example" },
};

function createCmd(a, out) {
  const name = a.create;
  if (!name || !NAME_RE.test(name) || name.includes("..") || name === "helpers") {
    out.err(`Give the check a name made of letters, numbers, ".", "-" and "_": dash-check new <name>${name ? ` ("${name}" can't be one)` : ""}`);
    return 2;
  }
  const dir = path.join(a.cwd, CHECKS_DIR);
  const file = path.join(dir, a.recipe ? `${name}.check.json` : `${name}.check.js`);
  const sample = path.join(dir, `${name}.sample.json`);
  for (const f of [file, sample]) {
    if (fs.existsSync(f)) {
      out.err(`${path.relative(a.cwd, f)} is already there: pick another name, or edit it`);
      return 2;
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const title = name.replace(/[-_.]+/g, " ");
  if (a.recipe) {
    const r = {
      name: title,
      steps: [
        { use: "handoff.has", with: { keys: ["summary"] } },
        { expect: "handoff.files", matcher: "toHaveLengthAtLeast", args: [1], message: "The handoff lists no changed files" },
      ],
    };
    fs.writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
  } else {
    fs.writeFileSync(
      file,
      `// ${CHECKS_DIR}/${name}.check.js: run it with  npx dash-check ${name}
const { check, expect } = require("@trops/dash-check");
const { handoff } = require("@trops/dash-check/helpers");

check(${JSON.stringify(title)}, async (ctx) => {
  await handoff.has(ctx, { keys: ["summary"] });
  expect(ctx.handoff.files, "handoff.files").toHaveLengthAtLeast(1, "The handoff lists no changed files");
});
`,
    );
  }
  fs.writeFileSync(sample, `${JSON.stringify(SAMPLE_INPUT, null, 2)}\n`);
  out.log(`Made ${path.relative(a.cwd, file)} and ${path.relative(a.cwd, sample)}.`);
  out.log(`Try it: npx dash-check ${name}   (then make the sample bad, and see it fail with a clear reason)`);
  return 0;
}

function listCmd(a, out) {
  const checks = listChecks(a.cwd);
  if (!checks.length) out.log(`No ${CHECKS_DIR} here.`);
  for (const c of checks) out.log(`${c.name}\t${CHECKS_DIR}/${c.file}\t${c.type}${c.sample ? "\t(sample)" : ""}`);
  return 0;
}

function watch(a, out, signal) {
  return new Promise((resolve) => {
    let timer = null;
    let running = false;
    let again = false;
    const go = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      out.log(`\n— ${new Date().toLocaleTimeString()} —`);
      await runAll(a, out);
      out.log("Watching for changes (Ctrl-C to stop)…");
      running = false;
      if (again) {
        again = false;
        go();
      }
    };
    let watcher;
    const onChange = (_e, f) => {
      const p = String(f || "");
      if (/(^|[/\\])(\.git|node_modules)([/\\]|$)/.test(p)) return;
      clearTimeout(timer);
      timer = setTimeout(go, 200);
    };
    try {
      watcher = fs.watch(a.cwd, { recursive: true }, onChange);
    } catch (_e) {
      watcher = fs.watch(path.join(a.cwd, CHECKS_DIR), onChange);
    }
    const stop = () => {
      watcher.close();
      clearTimeout(timer);
      resolve(0);
    };
    if (signal) signal.addEventListener("abort", stop, { once: true });
    else process.once("SIGINT", stop);
    go();
  });
}

/**
 * The CLI. Gives the exit code.
 * @param {string[]} argv
 * @param {{ log?: Function, err?: Function, signal?: AbortSignal }} [io]
 */
async function main(argv, io = {}) {
  const out = { log: io.log || ((s) => process.stdout.write(`${s}\n`)), err: io.err || ((s) => process.stderr.write(`${s}\n`)) };
  const a = parseArgs(argv);
  if (a.error) {
    out.err(`${a.error}\n${USAGE}`);
    return 2;
  }
  if (a.help) {
    out.log(USAGE);
    return 0;
  }
  if (a.create !== undefined) return createCmd(a, out);
  if (a.listHelpers) return listHelpersCmd(a, out);
  if (a.explain) return explainCmd(a, out);
  if (a.list) return listCmd(a, out);
  if (a.watch) return watch(a, out, io.signal);
  return runAll(a, out);
}

module.exports = { main, parseArgs, listChecks, runEntry, lastProof, CHECKS_DIR };
