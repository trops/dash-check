/**
 * Files helpers: what's in the workspace. Built only from Layer 0 (ctx.fs).
 */
"use strict";

const { defineHelper, expect, fail, note } = require("..");

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

module.exports = { exist, contain, noneMatch };
