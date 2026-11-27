/**
 * handoff.js: the bot's handoff, read the way Dash reads it (dash-core
 * electron/bots/answerJson.js): the whole answer when it's JSON, else its
 * last ```json (or bare ```) block. Blocks in other languages are skipped.
 */
"use strict";

const { isObj } = require("./util");

/**
 * The JSON an answer ends with.
 * @returns {{ found: boolean, value?: any, fenced?: boolean, broken?: boolean, error?: string }}
 */
function lastJsonBlock(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return { found: false };
  const parse = (t) => {
    try {
      const v = JSON.parse(t);
      return isObj(v) || Array.isArray(v) ? { ok: true, v } : { ok: false, error: "it isn't a JSON object" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || "it isn't JSON" };
    }
  };
  const whole = parse(s);
  if (whole.ok) return { found: true, value: whole.v, fenced: false };
  let last = null;
  for (const m of s.matchAll(/```([A-Za-z0-9_+-]*)([\s\S]*?)```/g)) {
    const lang = m[1].toLowerCase();
    if (lang === "json" || lang === "jsonc" || lang === "") last = m[2];
  }
  if (last === null) return { found: false };
  const inBlock = parse(last.trim());
  if (inBlock.ok) return { found: true, value: inBlock.v, fenced: true };
  return { found: false, broken: true, error: inBlock.error };
}

/** The bot's whole answer in a check input ({ input: { answer } } or { input: "…" }). */
function answerOf(input) {
  const work = input && input.input;
  if (work && typeof work === "object" && typeof work.answer === "string") return work.answer;
  if (typeof work === "string") return work;
  return "";
}

/**
 * The handoff in a check input: `input.handoff` when Dash parsed it already,
 * else the answer's last json block. `{}` when there's none.
 * @returns {{ handoff: object, info: { found: boolean, broken?: boolean, error?: string, list?: boolean } }}
 */
function readHandoff(input) {
  if (input && isObj(input.handoff)) {
    const h = { ...input.handoff };
    if (h.status === undefined) h.status = "ok";
    return { handoff: h, info: { found: true, given: true } };
  }
  const j = lastJsonBlock(answerOf(input));
  if (!j.found) {
    return { handoff: {}, info: j.broken ? { found: false, broken: true, error: j.error } : { found: false } };
  }
  if (!isObj(j.value)) return { handoff: {}, info: { found: false, list: true } };
  const h = { ...j.value };
  if (h.status === undefined) h.status = "ok";
  else if (typeof h.status === "string") h.status = h.status.trim().toLowerCase();
  return { handoff: h, info: { found: true } };
}

module.exports = { lastJsonBlock, answerOf, readHandoff };
