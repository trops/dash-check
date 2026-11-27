/**
 * Plan helpers: the plan a planning bot hands on. Built only from Layer 0.
 */
"use strict";

const { defineHelper, expect, note } = require("..");
const { needHandoff } = require("./handoff");

const hasSections = defineHelper({
  id: "plan.hasSections",
  group: "Handoff",
  label: "The plan has sections",
  description: "The handoff's plan has each section, not empty",
  sentence: "handoff.{key} has {sections}",
  params: {
    key: { type: "text", label: "Plan key", default: "plan" },
    sections: { type: "list", label: "Sections", default: ["cause", "fix", "test"] },
  },
  reads: ["handoff"],
  run(ctx, { key, sections }) {
    if (!needHandoff(ctx)) return;
    for (const s of sections) {
      expect(ctx.get(`handoff.${key}.${s}`), `handoff.${key}.${s}`).not.toBeEmpty(`The ${key} has no ${s}`);
    }
    note(`The ${key} has ${sections.join(", ")}`);
  },
});

const acceptanceEachHasTest = defineHelper({
  id: "plan.acceptanceEachHasTest",
  group: "Handoff",
  label: "Each acceptance item has a test",
  description: "Plan: every item is tested",
  sentence: "every item in handoff.{acceptance} has a test in handoff.{tests}",
  params: {
    acceptance: { type: "text", label: "Acceptance key", default: "acceptance" },
    tests: { type: "text", label: "Tests key", default: "tests" },
  },
  reads: ["handoff"],
  run(ctx, { acceptance, tests }) {
    if (!needHandoff(ctx)) return;
    const items = ctx.get(`handoff.${acceptance}`);
    if (!expect(items, `handoff.${acceptance}`).toBeArray(`The handoff has no ${acceptance} list`)) return;
    if (!expect(items, `handoff.${acceptance}`).not.toBeEmpty(`The handoff's ${acceptance} is empty`)) return;
    const list = ctx.get(`handoff.${tests}`);
    const all = Array.isArray(list) ? list : [];
    for (const a of items) {
      const t = all.find((x) => x && typeof x === "object" && x.acceptance === a);
      expect(t && t.test, `the test for "${a}"`).toBeNonEmptyString(`No test for: ${a}`);
    }
    note(`${items.length} acceptance item${items.length === 1 ? "" : "s"}, each with a test`);
  },
});

module.exports = { hasSections, acceptanceEachHasTest };
