/**
 * Test utilities: temp folders, temp git repos (with an origin) and a fake
 * GitHub. Every temp folder is removed by cleanup().
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const made = [];

function tmpdir(prefix = "dash-check-test-") {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(d);
  return d;
}

function cleanup() {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: os.tmpdir(),
};

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(dir, files) {
  for (const [p, body] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
}

/**
 * A repo with an origin: main has `files` committed and pushed, and
 * origin/HEAD points at main. Gives { root, dir, git(...args), write, commit }.
 */
function makeRepo(files = { "README.md": "# test\n" }) {
  const root = tmpdir("dash-check-repo-");
  const origin = path.join(root, "origin.git");
  const dir = path.join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: GIT_ENV });
  execFileSync("git", ["clone", "-q", origin, dir], { env: GIT_ENV, stdio: "ignore" });
  git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  git(dir, "push", "-q", "-u", "origin", "main");
  git(dir, "remote", "set-head", "origin", "main");
  const repo = {
    root,
    dir,
    git: (...args) => git(dir, ...args),
    write: (f) => write(dir, f),
    commit: (f, message = "change") => {
      write(dir, f);
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", message);
    },
  };
  return repo;
}

/**
 * A fake fetch for GitHub: routes map an API path ("repos/o/r/pulls/1") to
 * { status, body } or a body (status 200). Records the calls.
 */
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    const p = String(url).replace(/^https:\/\/api\.github\.com\//, "");
    calls.push({ path: p, headers: (init && init.headers) || {} });
    let r = routes[p];
    if (typeof r === "function") r = r(calls.length);
    if (r === undefined) r = { status: 404, body: { message: "Not Found" } };
    const res = r && typeof r === "object" && "status" in r ? r : { status: 200, body: r };
    return { status: res.status, json: async () => res.body };
  };
  f.calls = calls;
  return f;
}

/** A check input whose answer ends with this handoff. */
const answer = (handoff, extra = {}) => ({ input: { answer: `Done.\n\n\`\`\`json\n${JSON.stringify(handoff)}\n\`\`\`` }, ...extra });

module.exports = { tmpdir, cleanup, git, write, makeRepo, fakeFetch, answer, GIT_ENV };
