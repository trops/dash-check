/**
 * fs.js: ctx.fs, read-only and relative to the workspace.
 *   exists(p), dirExists(p), read(p), readJson(p), list(glob)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { matchGlob, globBase } = require("../glob");
const { DashCheckError } = require("../util");

const SKIP_DIRS = new Set([".git", "node_modules"]);
const MAX_FILES = 20000;

const expand = (p) => (p === "~" || String(p).startsWith("~/") ? path.join(os.homedir(), String(p).slice(1)) : String(p));

function makeFs(cwd) {
  const at = (p) => path.resolve(cwd, expand(p));
  const api = {
    /** The full path of a workspace path. */
    path: (p) => at(p),
    exists: async (p) => fs.existsSync(at(p)),
    dirExists: async (p = ".") => {
      try {
        return fs.statSync(at(p)).isDirectory();
      } catch (_e) {
        return false;
      }
    },
    read: async (p) => {
      try {
        return fs.readFileSync(at(p), "utf8");
      } catch (e) {
        throw new DashCheckError(`Can't read ${p}`, {
          fix: e.code === "ENOENT" ? "the file isn't there" : e.message,
        });
      }
    },
    readJson: async (p) => {
      const text = await api.read(p);
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new DashCheckError(`${p} isn't valid JSON`, { fix: e.message });
      }
    },
    /**
     * Files matching a glob (or globs, with "!glob" to leave out), relative
     * and sorted. Skips .git and node_modules unless the glob names them.
     */
    list: async (globs) => {
      const list = (Array.isArray(globs) ? globs : [globs]).map(String).filter(Boolean);
      const wanted = list.filter((g) => !g.startsWith("!"));
      const names = new Set(list.join(" ").split(/[/\s]/));
      const bases = [...new Set(wanted.map(globBase))];
      const out = new Set();
      let count = 0;
      const walk = (rel) => {
        let entries;
        try {
          entries = fs.readdirSync(path.join(cwd, rel), { withFileTypes: true });
        } catch (_e) {
          return;
        }
        for (const e of entries) {
          if (count > MAX_FILES) return;
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name) && !names.has(e.name)) continue;
            walk(r);
          } else {
            count++;
            if (matchGlob(list, r)) out.add(r);
          }
        }
      };
      for (const b of bases) walk(b);
      return [...out].sort();
    },
  };
  return api;
}

module.exports = { makeFs, expand };
