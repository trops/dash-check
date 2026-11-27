/**
 * git.js: ctx.git, read-only git in the workspace. Each method fails with
 * what went wrong and what to do about it.
 */
"use strict";

const fs = require("fs");
const path = require("path");
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
  const mergeBase = async (ref) => {
    await needRef(ref);
    return (await must(["merge-base", ref, "HEAD"], `Can't find where HEAD left ${ref}`)).trim();
  };
  const untrackedFiles = async () => lines(await must(["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"], "Can't list untracked files"));
  // Plain diff output whatever the user's git config says.
  const DIFF = ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/"];

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
      const base = await mergeBase(ref);
      const changed = lines(await must(["-c", "core.quotePath=false", "diff", "--name-only", base], `Can't diff against ${ref}`));
      const untracked = await untrackedFiles();
      return [...new Set([...changed, ...untracked])].sort();
    },
    /**
     * Lines added since a ref, the same files as changedFiles: committed
     * since where the branch left it, uncommitted, and untracked files
     * read whole. [{ file, line, text }], line numbers in the file as it is
     * now. Binary files are left out.
     */
    addedLines: async (ref) => {
      const base = await mergeBase(ref);
      const out = [];
      let file = null;
      let header = false;
      let n = 0;
      for (const l of (await must([...DIFF, "-U0", base], `Can't diff against ${ref}`)).split("\n")) {
        if (l.startsWith("diff --git ")) {
          file = null;
          header = true;
        } else if (header && l.startsWith("+++ ")) {
          const p = l.slice(4);
          file = p === "/dev/null" ? null : p.replace(/^"?b\//, "").replace(/"$/, "");
        } else if (l.startsWith("@@")) {
          header = false;
          const m = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          n = m ? Number(m[1]) : 0;
        } else if (!header && file && l.startsWith("+")) {
          out.push({ file, line: n, text: l.slice(1) });
          n++;
        }
      }
      for (const f of await untrackedFiles()) {
        let buf;
        try {
          buf = fs.readFileSync(path.join(cwd, f));
        } catch (_e) {
          continue;
        }
        if (buf.includes(0)) continue;
        const text = buf.toString("utf8").split(/\r?\n/);
        if (text.length && text[text.length - 1] === "") text.pop();
        text.forEach((t, i) => out.push({ file: f, line: i + 1, text: t }));
      }
      return out;
    },
    /**
     * The commits HEAD has past a ref, oldest first:
     * [{ sha, subject, message, parents, files }]. A merge commit's files
     * are empty (git log names none for it).
     */
    commits: async (ref) => {
      await needRef(ref);
      const raw = await must(
        ["-c", "core.quotePath=false", "log", "--reverse", "--name-only", "--no-renames", "--format=%x1e%H%x1f%P%x1f%B%x1f", `${ref}..HEAD`],
        `Can't list the commits past ${ref}`,
      );
      return raw
        .split("\x1e")
        .filter((c) => c.trim())
        .map((c) => {
          const [sha, parents, message, names = ""] = c.split("\x1f");
          const msg = message.trim();
          return {
            sha: sha.trim(),
            subject: msg.split("\n")[0],
            message: msg,
            parents: parents.trim().split(/\s+/).filter(Boolean),
            files: lines(names),
          };
        });
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
