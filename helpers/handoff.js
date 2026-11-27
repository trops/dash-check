/**
 * Handoff helpers: what the bot's handoff (its last json block) says.
 * Built only from Layer 0.
 */
"use strict";

const { defineHelper, expect, fail, note } = require("..");

/** Fails (and says why) when the answer has no handoff. */
function needHandoff(ctx) {
  const info = ctx.handoffInfo || {};
  if (info.found) return true;
  if (info.broken) fail(`The answer's last \`\`\`json block doesn't parse (${info.error}): end the answer with one JSON object`);
  else if (info.list) fail('The handoff is a JSON list: it must be one JSON object, e.g. { "summary": "…" }');
  else fail("The answer has no handoff: end it with a ```json block holding a JSON object");
  return false;
}

const has = defineHelper({
  id: "handoff.has",
  group: "Handoff",
  label: "Handoff has keys",
  description: "The bot's handoff includes these, not empty",
  sentence: "the handoff has {keys}",
  params: {
    keys: { type: "list", label: "Keys", required: true, description: 'e.g. prUrl, or plan.cause to reach in' },
  },
  reads: ["handoff"],
  run(ctx, { keys }) {
    if (!needHandoff(ctx)) return;
    for (const k of keys) {
      expect(ctx.get(`handoff.${k}`), `handoff.${k}`).not.toBeEmpty(`The handoff has no ${k}`);
    }
    note(`The handoff has ${keys.join(", ")}`);
  },
});

const status = defineHelper({
  id: "handoff.status",
  group: "Handoff",
  label: "Handoff status is",
  description: "The handoff's status (ok, none, ask or split)",
  sentence: "the handoff's status is {is}",
  params: {
    is: { type: "select", label: "Status", options: ["ok", "none", "ask", "split"], default: "ok" },
  },
  reads: ["handoff"],
  run(ctx, { is }) {
    if (!needHandoff(ctx)) return;
    const s = ctx.handoff.status;
    expect(s, "handoff.status").toBe(is, `The handoff's status is "${s}", not "${is}"`);
  },
});

const eachHas = defineHelper({
  id: "handoff.eachHas",
  group: "Handoff",
  label: "Each item in a list has keys",
  description: "Every entry of a handoff list has these, not empty",
  sentence: "each of handoff.{list} has {keys}",
  params: {
    list: { type: "text", label: "List", required: true, description: "e.g. tests" },
    keys: { type: "list", label: "Keys", required: true },
  },
  reads: ["handoff"],
  run(ctx, { list, keys }) {
    if (!needHandoff(ctx)) return;
    const items = ctx.get(`handoff.${list}`);
    if (!expect(items, `handoff.${list}`).toBeArray(`The handoff's ${list} isn't a list`)) return;
    items.forEach((it, i) => {
      for (const k of keys) {
        const v = it && typeof it === "object" ? ctx.get(`handoff.${list}.${i}.${k}`) : undefined;
        expect(v, `handoff.${list}[${i}].${k}`).not.toBeEmpty(`${list}[${i}] has no ${k}`);
      }
    });
    note(`${items.length} in ${list}, each with ${keys.join(", ")}`);
  },
});

module.exports = { has, status, eachHas, needHandoff };
