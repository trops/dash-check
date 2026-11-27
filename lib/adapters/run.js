/**
 * run.js: ctx.run(cmd, { timeoutSec }) runs a shell command in the
 * workspace and gives { code, stdout, stderr, timedOut }. It never throws
 * for a failing command: the exit code says.
 */
"use strict";

const { spawn, execFile } = require("child_process");

const DEFAULT_TIMEOUT_SEC = 120;
const MAX_OUTPUT = 4 * 1024 * 1024;

function makeRun({ cwd, env }) {
  return function run(cmd, opts = {}) {
    const timeoutSec = Number(opts.timeoutSec) > 0 ? Number(opts.timeoutSec) : DEFAULT_TIMEOUT_SEC;
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let child;
      try {
        child = spawn(String(cmd), {
          cwd: opts.cwd || cwd,
          env: { ...env, ...(opts.env || {}) },
          shell: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        resolve({ code: 127, stdout: "", stderr: e.message, timedOut: false });
        return;
      }
      const cap = (s, d) => (s.length > MAX_OUTPUT ? s : s + d);
      child.stdout.on("data", (d) => (stdout = cap(stdout, d.toString())));
      child.stderr.on("data", (d) => (stderr = cap(stderr, d.toString())));
      const kill = (sig) => {
        try {
          if (process.platform !== "win32") process.kill(-child.pid, sig);
          else child.kill(sig);
        } catch (_e) {
          // Already gone.
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill("SIGTERM");
        setTimeout(() => kill("SIGKILL"), 2000).unref();
      }, timeoutSec * 1000);
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: stderr || e.message, timedOut });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (timedOut) stderr += `${stderr ? "\n" : ""}Stopped after ${timeoutSec} seconds`;
        resolve({ code: code === null ? (signal ? 128 : 1) : code, stdout, stderr, timedOut });
      });
    });
  };
}

/** Run a program with arguments (no shell): { ok, code, out, err }. */
function execArgs(file, args, { cwd, env, maxBuffer = MAX_OUTPUT } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env, maxBuffer, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        out: String(stdout || ""),
        err: String(stderr || (err && err.message) || "").trim(),
      });
    });
  });
}

module.exports = { makeRun, execArgs, DEFAULT_TIMEOUT_SEC };
