/**
 * @trops/dash-check/helpers: the starter helpers, each a few lines of
 * Layer 0. Call one with the check's ctx and its params:
 *
 *   const { git, node, files } = require("@trops/dash-check/helpers");
 *   await git.committedSince(ctx, { base: "main" });
 */
"use strict";

const { registerHelpers } = require("..");

const groups = {
  handoff: require("./handoff"),
  plan: require("./plan"),
  git: require("./git"),
  files: require("./files"),
  commands: require("./commands"),
  node: require("./node"),
  github: require("./github"),
  tracker: require("./tracker"),
};

const exported = {};
const all = [];
for (const [name, mod] of Object.entries(groups)) {
  exported[name] = {};
  for (const [k, v] of Object.entries(mod)) {
    if (v && v.isDashCheckHelper) {
      exported[name][k] = v;
      all.push(v);
    }
  }
}
registerHelpers(all, { source: "@trops/dash-check" });

module.exports = { ...exported, all };
