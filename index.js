/**
 * @trops/dash-check: compose deterministic checks from small, described
 * building blocks.
 *
 *   const { check, expect } = require("@trops/dash-check");
 *   check("the ticket has acceptance items", ({ handoff }) => {
 *     expect(handoff.acceptance, "handoff.acceptance").not.toBeEmpty("Add acceptance items to the ticket");
 *   });
 *
 * Layer 0 (this module): the runner, expect, the context, defineHelper.
 * Layer 1: require("@trops/dash-check/helpers").
 * Layer 2: require("@trops/dash-check/recipe").
 */
"use strict";

const runner = require("./lib/runner");
const { expect, defineMatcher } = require("./lib/expect");
const { createContext } = require("./lib/context");
const { defineHelper, helper, getHelper, listHelpers, register, sentenceOf, resolveParams } = require("./lib/helper");
const { fail, note, collect, CheckFailure } = require("./lib/scope");
const { lastJsonBlock, readHandoff } = require("./lib/handoff");
const { matchGlob, globToRegExp } = require("./lib/glob");
const values = require("./lib/values");
const { DashCheckError, isEmpty, deepEqual } = require("./lib/util");
const { loadHelpers } = require("./lib/discover");

/**
 * Run a check file in this process: a .check.js file's checks, or a
 * .check.json recipe. The file's require("@trops/dash-check") must give this
 * copy (lib/register.js makes sure of it).
 * @param {string} file
 * @param {object} [input]  the check input
 * @param {object} [opts]   createContext options (cwd, env, fetch, tool, …)
 */
async function runFile(file, input = {}, opts = {}) {
  require("./lib/register");
  if (/\.json$/i.test(file)) {
    const r = JSON.parse(require("fs").readFileSync(file, "utf8"));
    return require("./recipe").runRecipe(r, input, opts);
  }
  const checks = runner.loadChecks(file);
  return runner.runChecks(checks, opts.ctx || createContext(input, opts), opts);
}

module.exports = {
  runFile,
  // the runner
  check: runner.check,
  describe: runner.describe,
  run: runner.run,
  runChecks: runner.runChecks,
  loadChecks: runner.loadChecks,
  takeChecks: runner.takeChecks,
  lastLine: runner.lastLine,
  report: runner.report,
  // expect
  expect,
  defineMatcher,
  fail,
  note,
  collect,
  // the context
  createContext,
  readHandoff,
  lastJsonBlock,
  get: values.get,
  fill: values.fill,
  when: values.when,
  valuePaths: values.valuePaths,
  // helpers
  defineHelper,
  helper,
  getHelper,
  listHelpers,
  registerHelpers: register,
  loadHelpers,
  sentenceOf,
  resolveParams,
  // small tools
  matchGlob,
  globToRegExp,
  isEmpty,
  deepEqual,
  CheckFailure,
  DashCheckError,
};
