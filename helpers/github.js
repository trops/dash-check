/**
 * GitHub helpers: the PR in the handoff, checked on GitHub itself. Built
 * only from Layer 0 (ctx.github).
 */
"use strict";

const { defineHelper, expect, fail, note } = require("..");

const mins = (sec) => {
  const m = Math.max(1, Math.round(sec / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
};

function prUrlOf(ctx, prKey) {
  const url = ctx.get(`handoff.${prKey}`);
  if (url === undefined || url === null || url === "") {
    fail(`The handoff has no ${prKey}: put the PR's link in it`);
    return null;
  }
  return url;
}

const prOpen = defineHelper({
  id: "github.prOpen",
  group: "GitHub",
  label: "The PR is open",
  description: "The handoff's PR is open on GitHub",
  sentence: "the PR in handoff.{prKey} is open",
  params: { prKey: { type: "text", label: "PR key", default: "prUrl" } },
  reads: ["handoff", "github"],
  async run(ctx, { prKey }) {
    const url = prUrlOf(ctx, prKey);
    if (!url) return;
    const pr = await ctx.github.pr(url);
    expect(pr.state, `PR #${pr.number}'s state`).toBe("open", `PR #${pr.number} isn't open (it's ${pr.merged ? "merged" : pr.state})`);
    note(`PR #${pr.number} is open`);
  },
});

const ciPassed = defineHelper({
  id: "github.ciPassed",
  group: "GitHub",
  label: "The PR's CI passed",
  description: "Waits, with a deadline",
  sentence: "the CI of the PR in handoff.{prKey} passed, waiting up to {timeoutSec} seconds",
  params: {
    prKey: { type: "text", label: "PR key", default: "prUrl" },
    timeoutSec: { type: "number", label: "Wait up to (s)", default: 1200 },
    noChecksAfterSec: { type: "number", label: "No CI after (s)", default: 180 },
    ifNoChecks: { type: "select", label: "If it has no CI", options: ["fail", "pass"], default: "fail" },
  },
  reads: ["handoff", "github"],
  async run(ctx, { prKey, timeoutSec, noChecksAfterSec, ifNoChecks }) {
    const url = prUrlOf(ctx, prKey);
    if (!url) return;
    const pr = await ctx.github.pr(url);
    if (!pr.head || !pr.head.sha) {
      fail(`Couldn't read PR #${pr.number}'s last commit`);
      return;
    }
    const r = await ctx.github.waitForChecks(pr.head.sha, { timeoutSec, noChecksAfterSec, repo: pr.slug });
    if (r.noChecks) {
      if (ifNoChecks === "pass") note(`${url} has no CI checks (allowed)`);
      else fail(`${url} has no CI after ${mins(noChecksAfterSec)}: enable Actions on the repo, or set "If it has no CI" to pass`);
      return;
    }
    if (r.failed.length) {
      fail("CI failed", { at: r.failed.map((x) => `${x.name} (${x.conclusion})`).join(", "), received: r.failed });
    }
    if (r.timedOut) {
      fail(`CI is still running on ${url} after ${mins(timeoutSec)}`, { at: r.pending.map((x) => x.name).join(", ") || undefined });
    }
    if (!r.failed.length && !r.timedOut) note(`${r.passed.length} CI check${r.passed.length === 1 ? "" : "s"} passed`);
  },
});

module.exports = { prOpen, ciPassed };
