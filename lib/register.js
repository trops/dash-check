/**
 * register.js: make `require("@trops/dash-check")` (and its subpaths) give
 * this copy, so a check or helper file run by this CLI works even where the
 * package isn't installed (npx), and shares one registry and one runner.
 *
 *   node -r @trops/dash-check/lib/register.js my.check.js
 */
"use strict";

const Module = require("module");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const NAME = "@trops/dash-check";
const MAP = {
  "": "index.js",
  "/helpers": "helpers/index.js",
  "/recipe": "recipe/index.js",
  "/cli": "cli/index.js",
  "/package.json": "package.json",
};

if (!Module.__dashCheckRegistered) {
  Module.__dashCheckRegistered = true;
  const orig = Module._resolveFilename;
  Module._resolveFilename = function resolve(request, ...rest) {
    if (typeof request === "string" && (request === NAME || request.startsWith(`${NAME}/`))) {
      const sub = request.slice(NAME.length);
      if (MAP[sub] !== undefined) return path.join(ROOT, MAP[sub]);
    }
    return orig.call(this, request, ...rest);
  };
}

module.exports = { ROOT };
