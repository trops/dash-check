/**
 * Tracker helpers: the work item in its tracker, through ctx.tool (so they
 * run only in Dash, which supplies the provider). Built only from Layer 0.
 * The defaults are Jira's; for another tracker set provider, tool and idArg.
 */
"use strict";

const { defineHelper, expect, fail, note } = require("..");

const TRACKER = {
  provider: { type: "text", label: "Provider", default: "jira" },
  tool: { type: "text", label: "Tool", default: "getJiraIssue" },
  idArg: { type: "text", label: "Id argument", default: "issueIdOrKey" },
  id: { type: "text", label: "Item id", default: "{item.id}" },
};

async function fetchTicket(ctx, { provider, tool, idArg, id }) {
  if (!id) {
    fail("The job has no work item id: run it on a job with an item, or set the item id");
    return null;
  }
  const t = await ctx.tool(provider, tool, { [idArg]: id });
  if (!t || (typeof t === "object" && !Object.keys(t).length)) {
    fail(`${id} isn't in ${provider}: check the id`);
    return null;
  }
  return t;
}

const ticketExists = defineHelper({
  id: "tracker.ticketExists",
  group: "Tracker",
  label: "The ticket exists",
  description: "The work item is in the tracker",
  sentence: "{id} exists in {provider}",
  params: TRACKER,
  reads: ["tool", "item"],
  async run(ctx, p) {
    if (await fetchTicket(ctx, p)) note(`${p.id} is in ${p.provider}`);
  },
});

const ticketHasLabel = defineHelper({
  id: "tracker.ticketHasLabel",
  group: "Tracker",
  label: "The ticket has a label",
  description: "The work item carries a label",
  sentence: "{id} has the label {label}",
  params: { label: { type: "text", label: "Label", required: true }, ...TRACKER },
  reads: ["tool", "item"],
  async run(ctx, p) {
    const t = await fetchTicket(ctx, p);
    if (!t) return;
    const raw = (t.fields && t.fields.labels) || t.labels || [];
    const labels = raw.map((l) => (l && typeof l === "object" ? l.name : l));
    expect(labels, `${p.id}'s labels`).toContain(p.label, `${p.id} has no label "${p.label}": add it`);
  },
});

module.exports = { ticketExists, ticketHasLabel };
