/**
 * context.js: createContext(input, opts) builds the `ctx` every check gets.
 *
 * Plain data (each `{}` when Dash didn't give it):
 *   input     the raw check input (Dash's $DASH_INPUT), always there
 *   answer    the bot's whole answer (text)
 *   handoff   the answer's last json block, parsed (`{}` when there's none)
 *   item, picks, row, settings, step, job
 *   workspace { dir, branch, exists(p), read(p), file(p), dirExists() }
 *   env       the environment, DASH_* included
 * Read-only adapters, all in the workspace (`cwd`):
 *   fs, run, git, github, tool
 * And small tools:
 *   get(path), fill(text), when(expr), note(text)
 *
 * Nothing here imports Dash: Dash's inputs are just data.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { isObj } = require("./util");
const { readHandoff, answerOf } = require("./handoff");
const values = require("./values");
const { note } = require("./scope");
const { makeFs, expand } = require("./adapters/fs");
const { makeRun, execArgs } = require("./adapters/run");
const { makeGit } = require("./adapters/git");
const { makeGithub } = require("./adapters/github");
const { makeTool } = require("./adapters/tool");

const obj = (v) => (isObj(v) ? v : {});

/**
 * @param {object} [input]  the check input (Dash's standard input)
 * @param {{ cwd?: string, env?: object, fetch?: Function, tool?: Function,
 *           now?: () => number, sleep?: (ms: number) => Promise<void> }} [opts]
 */
function createContext(input, opts = {}) {
  const raw = isObj(input) ? input : {};
  const env = { ...(opts.env || process.env) };
  const cwd = path.resolve(opts.cwd || process.cwd());
  const { handoff, info } = readHandoff(raw);
  const files = makeFs(cwd);
  const git = makeGit({ cwd, env });
  const w = obj(raw.workspace);
  const wsDir = typeof w.dir === "string" && w.dir ? path.resolve(cwd, expand(w.dir)) : cwd;
  const stepName = env.DASH_STEP;

  const ctx = {
    input: raw,
    answer: answerOf(raw),
    handoff,
    handoffInfo: info,
    item: obj(raw.item),
    picks: obj(raw.picks),
    row: obj(raw.row || raw.rows),
    settings: obj(raw.settings),
    step: isObj(raw.step) ? raw.step : stepName ? { name: stepName, inputs: obj(raw.check && raw.check.inputs) } : {},
    job: obj(raw.job),
    workspace: {
      ...w,
      dir: wsDir,
      branch: typeof w.branch === "string" ? w.branch : env.DASH_BRANCH || undefined,
      file: (p) => files.path(p),
      exists: (p) => files.exists(p),
      read: (p) => files.read(p),
      dirExists: async () => {
        try {
          return fs.statSync(wsDir).isDirectory();
        } catch (_e) {
          return false;
        }
      },
    },
    env,
    cwd,
    fs: files,
    run: makeRun({ cwd, env }),
    git,
    github: makeGithub({
      env,
      fetch: opts.fetch,
      now: opts.now,
      sleep: opts.sleep,
      repo: async () => {
        const r = obj(raw.row && raw.row.repo);
        if (r.url) return r.url;
        const remote = await execArgs("git", ["remote", "get-url", "origin"], { cwd, env });
        return remote.ok ? remote.out.trim() : null;
      },
    }),
    tool: makeTool({ env, tool: opts.tool }),
  };
  ctx.get = (p) => values.get(ctx, p);
  ctx.fill = (text, o) => values.fill(ctx, text, o);
  ctx.when = (expr) => values.when(ctx, expr);
  ctx.note = note;
  return ctx;
}

module.exports = { createContext };
