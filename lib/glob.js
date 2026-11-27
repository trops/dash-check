/**
 * glob.js: a small glob matcher (no dependencies).
 *
 *   *      anything but "/"
 *   **     any number of folders ("src/**\/*.js" matches src/a.js and src/a/b.js)
 *   ?      one character but "/"
 *   {a,b}  either
 *   [abc]  one of
 *   !glob  (in a list) not this
 *
 * Paths are matched with "/" separators, relative, without a leading "./".
 */
"use strict";

const cache = new Map();

function globToRegExp(glob) {
  const g = String(glob).replace(/^\.\//, "");
  if (cache.has(g)) return cache.get(g);
  let re = "";
  let depth = 0;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        const before = i === 0 || g[i - 1] === "/";
        const after = g[i + 2] === "/" || i + 2 === g.length;
        if (before && after) {
          i += 1;
          if (g[i + 1] === "/") {
            i += 1;
            re += "(?:.*/)?";
          } else re += ".*";
          continue;
        }
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      depth++;
      re += "(?:";
    } else if (c === "}" && depth > 0) {
      depth--;
      re += ")";
    } else if (c === "," && depth > 0) re += "|";
    else if (c === "[") {
      const end = g.indexOf("]", i + 1);
      if (end < 0) re += "\\[";
      else {
        let body = g.slice(i + 1, end).replace(/\\/g, "\\\\");
        if (body[0] === "!") body = `^${body.slice(1)}`;
        re += `[${body}]`;
        i = end;
      }
    } else if ("\\^$.|+()".includes(c)) re += `\\${c}`;
    else re += c;
  }
  const out = new RegExp(`^${re}$`);
  cache.set(g, out);
  return out;
}

const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "");

/** Does a path match a glob, or a list of globs (with "!glob" to leave out)? */
function matchGlob(globs, p) {
  const list = (Array.isArray(globs) ? globs : [globs]).map(String).filter(Boolean);
  const file = norm(p);
  let hit = false;
  for (const g of list) {
    if (g.startsWith("!")) {
      if (globToRegExp(g.slice(1)).test(file)) return false;
    } else if (globToRegExp(g).test(file)) hit = true;
  }
  return hit;
}

/** The fixed folder a glob starts in ("src/**\/*.js" → "src"), to walk less. */
function globBase(glob) {
  const parts = norm(glob).split("/");
  const fixed = [];
  for (const part of parts.slice(0, -1)) {
    if (/[*?{[]/.test(part)) break;
    fixed.push(part);
  }
  return fixed.join("/");
}

module.exports = { globToRegExp, matchGlob, globBase };
