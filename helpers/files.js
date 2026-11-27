/**
 * Files helpers: what's in the workspace. Built only from Layer 0 (ctx.fs).
 */
"use strict";

const { defineHelper, expect, fail, note, matchGlob } = require("..");
const { baseRef } = require("./git");

const exist = defineHelper({
  id: "files.exist",
  group: "Files",
  label: "Files exist",
  description: "Paths in the workspace",
  sentence: "{paths} exist",
  params: { paths: { type: "list", label: "Paths", required: true } },
  reads: ["fs"],
  async run(ctx, { paths }) {
    for (const p of paths) expect(await ctx.fs.exists(p), p).toBe(true, `${p} isn't there: add it`);
    note(`${paths.join(", ")} exist`);
  },
});

const contain = defineHelper({
  id: "files.contain",
  group: "Files",
  label: "File contains text",
  description: "A file has some text in it",
  sentence: "{path} contains {text}",
  params: {
    path: { type: "path", label: "File", required: true },
    text: { type: "text", label: "Text", required: true },
  },
  reads: ["fs"],
  async run(ctx, { path, text }) {
    if (!(await ctx.fs.exists(path))) {
      fail(`${path} isn't there: add it`);
      return;
    }
    const body = await ctx.fs.read(path);
    if (!body.includes(text)) fail(`${path} doesn't contain ${JSON.stringify(text)}: add it`);
    else note(`${path} contains it`);
  },
});

const noneMatch = defineHelper({
  id: "files.noneMatch",
  group: "Files",
  label: "No file matches a pattern",
  description: "e.g. no console.log in src",
  sentence: "in {glob} no match for {pattern}",
  params: {
    glob: { type: "glob", label: "Files", required: true, placeholder: "src/**/*.js" },
    pattern: { type: "regex", label: "Pattern", required: true, placeholder: "console\\.log" },
  },
  reads: ["fs"],
  async run(ctx, { glob, pattern }) {
    const files = await ctx.fs.list(glob);
    const hits = [];
    for (const f of files) {
      const lines = (await ctx.fs.read(f)).split(/\r?\n/);
      lines.forEach((line, i) => {
        pattern.lastIndex = 0;
        if (pattern.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    if (hits.length) {
      fail(`${glob} has ${hits.length} match${hits.length === 1 ? "" : "es"} for /${pattern.source}/: remove them`, {
        at: `${hits.slice(0, 10).join(", ")}${hits.length > 10 ? `, and ${hits.length - 10} more` : ""}`,
        received: hits,
      });
    } else note(`No match in ${files.length} file${files.length === 1 ? "" : "s"}`);
  },
});

/** Lines in a text ("a\nb\n" is 2), or null for binary. */
const lineCount = (text) => {
  if (text === null || text === undefined) return null;
  const t = String(text);
  if (t.includes("\0")) return null;
  if (!t) return 0;
  return t.split(/\r?\n/).length - (/\r?\n$/.test(t) ? 1 : 0);
};

const maxGrowth = defineHelper({
  id: "files.maxGrowth",
  group: "Files",
  label: "No file grows too big",
  description: "A changed file stays under a size, and a big file doesn't grow much",
  sentence: "no changed {glob} file since {base} grows past {maxLines} lines, or by more than {maxAdded} when already past",
  params: {
    glob: { type: "list", label: "Files", default: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"] },
    maxLines: { type: "number", label: "Most lines", default: 800 },
    maxAdded: { type: "number", label: "Most added to a big file", default: 50 },
    exempt: { type: "list", label: "Exempt", description: "Files that may grow, e.g. generated ones" },
    base: { type: "text", label: "Base branch", default: "{repo.baseBranch}", description: "Empty: the repo's default branch" },
  },
  reads: ["git", "fs"],
  async run(ctx, { glob, maxLines, maxAdded, exempt, base }) {
    const ref = await baseRef(ctx, base);
    const files = (await ctx.git.changedFiles(ref)).filter((f) => matchGlob(glob, f) && !(exempt.length && matchGlob(exempt, f)));
    let seen = 0;
    let big = 0;
    for (const f of files) {
      if (!(await ctx.fs.exists(f))) continue;
      const now = lineCount(await ctx.fs.read(f));
      if (now === null) continue;
      seen++;
      if (now <= maxLines) continue;
      big++;
      const before = lineCount(await ctx.git.fileAt(ref, f));
      if (before === null) {
        fail(`${f} is new and has ${now} lines (most: ${maxLines}): split it into smaller modules`, { received: now, expected: maxLines });
      } else if (before <= maxLines) {
        fail(`${f} grew past ${maxLines} lines (${before} → ${now}): put the new code in its own module`, { received: now, expected: maxLines });
      } else if (now - before > maxAdded) {
        fail(`${f} already has ${before} lines and grew by ${now - before} (most: ${maxAdded}): put the new code in its own module`, { received: now - before, expected: maxAdded });
      }
    }
    if (!big) note(`${seen} changed file${seen === 1 ? "" : "s"} checked, none past ${maxLines} lines`);
    else note(`${seen} changed file${seen === 1 ? "" : "s"} checked; ${big} past ${maxLines} lines grew ${maxAdded} or fewer`);
  },
});

module.exports = { exist, contain, noneMatch, maxGrowth, lineCount };
