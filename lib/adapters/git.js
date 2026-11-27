/**
 * git.js: ctx.git, read-only git in the workspace. Each method fails with
 * what went wrong and what to do about it.
 */
"use strict";

const { execArgs } = require("./run");
const { DashCheckError } = require("../util");

function makeGit({ cwd, env }) {
  const g = (args) => execArgs("git", args, { cwd, env });
  const must = async (args, what, fix) => {
    const r = await g(args);
    if (!r.ok) {
      if (/not a git repository/i.test(r.err)) {
        throw new DashCheckError(`${cwd} isn't a git repo`, { fix: "run the check in the repo's folder" });
      }
      throw new DashCheckError(`${what} (${r.err.split("\n")[0] || `git exit ${r.code}`})`, { fix });
    }
    return r.out;
  };
  const verify = async (ref) => (await g(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).ok;
  const needRef = async (ref) => {
    if (!ref || typeof ref !== "string") throw new DashCheckError("No git ref given", { fix: "name a branch, e.g. origin/main" });
    if (!(await verify(ref))) {
      const remote = ref.startsWith("origin/") ? ref.slice(7) : null;
      throw new DashCheckError(`${ref} isn't there`, {
        fix: remote ? `fetch it (git fetch origin ${remote}), or check the base branch's name` : "check the branch's name",
      });
    }
  };
  const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);

  const api = {
    /** The current branch ("HEAD" when detached). */
    branch: async () => (await must(["rev-parse", "--abbrev-ref", "HEAD"], "Can't read the branch")).trim(),
    /** Uncommitted files (staged, unstaged and untracked). */
    uncommitted: async () =>
      (await must(["status", "--porcelain"], "Can't read git status"))
        .split("\n")
        .filter(Boolean)
        .map((l) => l.slice(3).replace(/^"|"$/g, "")),
    isClean: async () => (await api.uncommitted()).length === 0,
    /** How many commits HEAD has past a ref (rev-list ref..HEAD). */
    commitsSince: async (ref) => {
      await needRef(ref);
      return Number((await must(["rev-list", "--count", `${ref}..HEAD`], `Can't count commits past ${ref}`)).trim()) || 0;
    },
    /**
     * Files changed since a ref: committed since where the branch left it,
     * plus uncommitted and untracked ones. Sorted, relative.
     */
    changedFiles: async (ref) => {
      await needRef(ref);
      const base = (await must(["merge-base", ref, "HEAD"], `Can't find where HEAD left ${ref}`)).trim();
      const changed = lines(await must(["diff", "--name-only", base], `Can't diff against ${ref}`));
      const untracked = lines(await must(["ls-files", "--others", "--exclude-standard"], "Can't list untracked files"));
      return [...new Set([...changed, ...untracked])].sort();
    },
    lastCommitMessage: async () => (await must(["log", "-1", "--format=%B"], "Can't read the last commit")).trim(),
    /** Does the remote (origin) have this branch? */
    remoteHas: async (branch, remote = "origin") => {
      const r = await g(["ls-remote", "--exit-code", "--heads", remote, String(branch)]);
      if (r.ok) return true;
      if (r.code === 2) return false;
      throw new DashCheckError(`Can't reach ${remote} (${r.err.split("\n")[0]})`, { fix: "check the remote and the sign-in" });
    },
    /** The default branch's name: origin/HEAD's, else main or master. null when none. */
    defaultBranch: async () => {
      const head = await g(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
      if (head.ok && head.out.trim()) return head.out.trim().replace(/^refs\/remotes\/origin\//, "");
      for (const b of ["main", "master"]) if (await verify(`origin/${b}`)) return b;
      for (const b of ["main", "master"]) if (await verify(b)) return b;
      return null;
    },
    /** A file's text at a ref, or null when it isn't there. */
    fileAt: async (ref, p) => {
      const r = await g(["show", `${ref}:${String(p).replace(/^\.\//, "")}`]);
      return r.ok ? r.out : null;
    },
    /** Does a ref exist? */
    hasRef: verify,
  };
  return api;
}

module.exports = { makeGit };
