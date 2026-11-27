/**
 * tool.js: ctx.tool(provider, name, args), a read-only call to one of the
 * bot's providers. Only Dash can answer it: it runs the check with
 * DASH_TOOL_SOCKET, a local socket that takes one JSON line
 *   { "id": 1, "provider": "jira", "tool": "getJiraIssue", "args": { … } }
 * and answers one JSON line { "id": 1, "result": … } or { "id": 1, "error": "…" }.
 * Outside Dash it fails, saying so. Tests pass `tool` to createContext.
 */
"use strict";

const net = require("net");
const { DashCheckError } = require("../util");

const TIMEOUT_MS = 60 * 1000;

function makeTool({ env, tool }) {
  if (typeof tool === "function") {
    return async (provider, name, args = {}) => tool(provider, name, args);
  }
  const socket = env && env.DASH_TOOL_SOCKET;
  if (!socket) {
    return async (provider, name) => {
      throw new DashCheckError(`ctx.tool("${provider}", "${name}") only works when Dash runs the check`, {
        fix: "run it from a bot step in Dash, or pass { tool } to createContext in a test",
      });
    };
  }
  let nextId = 1;
  return (provider, name, args = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const conn = net.createConnection(socket);
      let buf = "";
      const done = (fn, v) => {
        clearTimeout(timer);
        conn.destroy();
        fn(v);
      };
      const timer = setTimeout(
        () => done(reject, new DashCheckError(`Dash didn't answer ${provider}.${name} in time`, { fix: "check that the provider is connected" })),
        TIMEOUT_MS,
      );
      conn.on("connect", () => conn.write(`${JSON.stringify({ id, provider, tool: name, args })}\n`));
      conn.on("data", (d) => {
        buf += d.toString();
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        let msg;
        try {
          msg = JSON.parse(buf.slice(0, nl));
        } catch (e) {
          done(reject, new DashCheckError(`Dash's answer to ${provider}.${name} isn't JSON`, { fix: e.message }));
          return;
        }
        if (msg.error) done(reject, new DashCheckError(`${provider}.${name} failed (${msg.error})`, { fix: "check the tool's name, its arguments and the provider's sign-in" }));
        else done(resolve, msg.result);
      });
      conn.on("error", (e) =>
        done(reject, new DashCheckError(`Can't reach Dash for ${provider}.${name} (${e.message})`, { fix: "run the check from Dash" })),
      );
    });
}

module.exports = { makeTool };
