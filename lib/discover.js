/**
 * discover.js: finding a team's own helpers.
 *
 *   - every .js file in the repo's .dash/checks/helpers/;
 *   - every installed package (dependencies and devDependencies) whose
 *     package.json says "dashCheck": { "helpers": ["./a.js", …] }.
 *
 * A file exports one helper, a list of them, or an object of them. A file
 * that won't load is reported with its error; the others still load.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { register, unregister } = require("./helper");

const HELPERS_DIR = ".dash/checks/helpers";

function helpersIn(exported) {
  if (!exported) return [];
  if (exported.isDashCheckHelper) return [exported];
  if (Array.isArray(exported)) return exported.filter((h) => h && h.isDashCheckHelper);
  if (typeof exported === "object") return Object.values(exported).filter((h) => h && h.isDashCheckHelper);
  return [];
}

function loadFile(file, source, out, loaded) {
  const shown = source;
  try {
    const full = path.resolve(file);
    // A helper file asks for the same copy of dash-check as this one, so
    // its defineHelper and expect are ours.
    require("./register");
    const prev = loaded.get(full);
    if (prev) prev.forEach((id) => unregister(id));
    delete require.cache[full];
    const list = helpersIn(require(full));
    if (!list.length) throw new Error("it exports no helper: module.exports = defineHelper({ … })");
    register(list, { source: shown, replace: !!prev });
    loaded.set(full, list.map((h) => h.meta.id));
    for (const h of list) out.helpers.push({ id: h.meta.id, source: shown });
  } catch (e) {
    out.errors.push({ source: shown, error: e && e.message ? e.message.split("\n")[0] : String(e) });
  }
}

const LOADED = new Map();

/**
 * Load a repo's helpers into the registry.
 * @param {{ cwd?: string }} [opts]
 * @returns {{ helpers: Array<{ id, source }>, errors: Array<{ source, error }> }}
 */
function loadHelpers({ cwd = process.cwd() } = {}) {
  const out = { helpers: [], errors: [] };
  const dir = path.join(cwd, HELPERS_DIR);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.c?js$/.test(f)).sort();
  } catch (_e) {
    files = [];
  }
  for (const f of files) loadFile(path.join(dir, f), `${HELPERS_DIR}/${f}`, out, LOADED);

  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch (_e) {
    pkg = null;
  }
  const deps = pkg ? Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).sort() : [];
  const self = pkg && pkg.dashCheck ? [[".", pkg]] : [];
  const found = [...self];
  for (const name of deps) {
    const at = path.join(cwd, "node_modules", name);
    try {
      const dp = JSON.parse(fs.readFileSync(path.join(at, "package.json"), "utf8"));
      if (dp.dashCheck) found.push([name, dp]);
    } catch (_e) {
      // Not installed, or no package.json: nothing to load.
    }
  }
  for (const [name, dp] of found) {
    const root = name === "." ? cwd : path.join(cwd, "node_modules", name);
    const list = dp.dashCheck && Array.isArray(dp.dashCheck.helpers) ? dp.dashCheck.helpers : null;
    if (!list) {
      out.errors.push({ source: `${name}/package.json`, error: 'its "dashCheck" needs "helpers": ["./file.js", …]' });
      continue;
    }
    for (const rel of list) {
      const full = path.resolve(root, String(rel));
      if (path.relative(root, full).startsWith("..")) {
        out.errors.push({ source: `${name}: ${rel}`, error: "a helper must be inside its package" });
        continue;
      }
      loadFile(full, name === "." ? String(rel) : `${name}/${String(rel).replace(/^\.\//, "")}`, out, LOADED);
    }
  }
  return out;
}

module.exports = { loadHelpers, HELPERS_DIR };
