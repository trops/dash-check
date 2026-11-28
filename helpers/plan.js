/**
 * Plan helpers: the plan a planning bot hands on. Built only from Layer 0.
 */
"use strict";

const { defineHelper, expect, fail, note } = require("..");
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

/**
 * Whether to judge this handoff: only when its status is one of `when`
 * (empty: always). Otherwise it notes "No plan (<status>)" and passes.
 */
function judges(ctx, when) {
  if (!when.length) return true;
  const s = ctx.handoff && ctx.handoff.status;
  if (when.includes(s)) return true;
  note(`No plan (${s === undefined ? "no status" : s})`);
  return false;
}

const NOT_READ = /not read|didn.t read|wasn.t read|unread/i;

const evidenceForAcceptance = defineHelper({
  id: "plan.evidenceForAcceptance",
  group: "Handoff",
  label: "It checked the work isn't already done",
  description: "Plan: it searched for finished work, and for each acceptance item says what it read and why it's still missing",
  sentence: "handoff.{key} has a search and, for every item in handoff.{acceptanceKey}, what was read and why it's missing",
  params: {
    key: { type: "text", label: "Evidence key", default: "notYetDone", description: "Holds searchedDone and missing: [{ acceptance, read, why }]" },
    acceptanceKey: { type: "text", label: "Acceptance key", default: "acceptance" },
    requireSearch: { type: "boolean", label: "Needs a search", default: true, description: "The evidence must say what it searched for done work (searchedDone)" },
    when: { type: "list", label: "Only when status is", default: ["ok"], description: "Other statuses pass; empty judges every handoff" },
  },
  reads: ["handoff"],
  run(ctx, { key, acceptanceKey, requireSearch, when }) {
    if (!needHandoff(ctx)) return;
    if (!judges(ctx, when)) return;
    const nd = ctx.get(`handoff.${key}`);
    if (!nd || typeof nd !== "object" || Array.isArray(nd)) {
      fail(
        `No ${key}: before planning, ${requireSearch ? "search for done work like this (searchedDone) and, " : ""}for each ${acceptanceKey} item, read the code that would do it and say why it is still missing (missing)`
      );
      return;
    }
    if (requireSearch && !String(nd.searchedDone || "").trim()) {
      fail(`${key}.searchedDone is empty: search for done tickets like this one and say what you searched and found`);
    }
    const acc = ctx.get(`handoff.${acceptanceKey}`);
    const items = Array.isArray(acc) ? acc : [];
    const miss = Array.isArray(nd.missing) ? nd.missing : [];
    const lacking = items.filter(
      (a) => !miss.some((m) => m && m.acceptance === a && String(m.read || "").trim() && String(m.why || "").trim())
    );
    if (lacking.length) {
      fail(
        `No evidence it is still missing for: ${lacking.join("; ")}. For each, name the file and function you read (read) and why it does not already do it (why).`
      );
    }
    if (NOT_READ.test(JSON.stringify(nd))) fail(`${key} says some code was not read: read it before planning`);
    note(`${requireSearch ? "Searched for done work, and evidence" : "Evidence"} for ${items.length} ${acceptanceKey} item${items.length === 1 ? "" : "s"}`);
  },
});

const noOpenDecisions = defineHelper({
  id: "plan.noOpenDecisions",
  group: "Handoff",
  label: "Nothing is left for the user to decide",
  description: "Plan: it lists the decisions still open, and there are none",
  sentence: "handoff.{key} is an empty list",
  params: {
    key: { type: "text", label: "Decisions key", default: "openDecisions" },
    when: { type: "list", label: "Only when status is", default: ["ok"], description: "Other statuses pass; empty judges every handoff" },
  },
  reads: ["handoff"],
  run(ctx, { key, when }) {
    if (!needHandoff(ctx)) return;
    if (!judges(ctx, when)) return;
    const list = ctx.get(`handoff.${key}`);
    if (!Array.isArray(list)) {
      fail(`No ${key}: list every choice the ticket or your plan leaves open (approach, design, scope, work outside the repos), or [] if there are none`);
      return;
    }
    if (list.length) {
      const text = list.map((d) => (typeof d === "string" ? d : JSON.stringify(d))).join("; ");
      fail(`The plan leaves decisions open: ${text}. Don't plan: answer status ask with the question for the user.`);
      return;
    }
    note("No open decisions");
  },
});

module.exports = { hasSections, acceptanceEachHasTest, evidenceForAcceptance, noOpenDecisions };
