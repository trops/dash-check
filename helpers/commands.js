/**
 * Commands helpers: run the repo's own commands. Built only from Layer 0
 * (ctx.run).
 */
"use strict";

const { defineHelper, expect, fail, note } = require("..");

const tail = (s, n = 1500) => {
  const t = String(s || "").trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
};

/** Run a command; on a non-zero exit fail with its last output. Gives the run. */
async function runOrFail(ctx, command, timeoutSec, what = command) {
  const r = await ctx.run(command, { timeoutSec });
  if (r.timedOut) {
    fail(`${what} didn't finish in ${timeoutSec} seconds: make it faster, or raise the time limit`, { at: tail(r.stdout + r.stderr, 800) || undefined });
  } else if (r.code !== 0) {
    const out = tail(`${r.stdout}\n${r.stderr}`);
    fail(`${what} failed (exit ${r.code})`, { at: out || undefined, received: r.code, expected: 0 });
  }
  return r;
}

const passes = defineHelper({
  id: "commands.passes",
  group: "Commands",
  label: "Command passes",
  description: "Exit 0",
  sentence: "{command} exits 0",
  params: {
    command: { type: "text", label: "Command", required: true },
    timeoutSec: { type: "number", label: "Time limit (s)", default: 120 },
  },
  reads: ["run"],
  async run(ctx, { command, timeoutSec }) {
    const r = await runOrFail(ctx, command, timeoutSec);
    if (r.code === 0) note(`${command} passed`);
  },
});

const outputMatches = defineHelper({
  id: "commands.outputMatches",
  group: "Commands",
  label: "Command output matches",
  description: "Its output matches a pattern",
  sentence: "the output of {command} matches {pattern}",
  params: {
    command: { type: "text", label: "Command", required: true },
    pattern: { type: "regex", label: "Pattern", required: true },
    timeoutSec: { type: "number", label: "Time limit (s)", default: 120 },
  },
  reads: ["run"],
  async run(ctx, { command, pattern, timeoutSec }) {
    const r = await ctx.run(command, { timeoutSec });
    const out = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ""}`;
    expect(out, `the output of ${command}`).toMatch(pattern, `The output of ${command} doesn't match /${pattern.source}/`);
  },
});

module.exports = { passes, outputMatches, runOrFail };
