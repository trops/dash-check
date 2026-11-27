# @trops/dash-check

Write checks that prove a bot (or a person) did the job: tests pass, the work is committed, every acceptance item has a test, the PR's CI is green. If you know Jest, you already know most of it.

- **Deterministic.** No AI. The same input gives the same result, and a failure says exactly what to fix.
- **Made of building blocks.** Pick a ready-made helper, compose your own check in a file or as JSON, or write your own helper once and reuse it.
- **Runs anywhere Node runs:** in [Dash](https://github.com/trops/dash-electron), in CI and on your laptop.
- **No dependencies.** Node 18 or later.

## Install

```sh
npm install --save-dev @trops/dash-check
```

## Your first check in 2 minutes

**1. Make one.** In your repo:

```sh
npx dash-check new ready
```

That writes two files:

- `.dash/checks/ready.check.js`, the check;
- `.dash/checks/ready.sample.json`, a sample input to try it on.

**2. Read it.** It looks like a Jest test:

```js
const { check, expect } = require("@trops/dash-check");
const { handoff } = require("@trops/dash-check/helpers");

check("ready", async (ctx) => {
  await handoff.has(ctx, { keys: ["summary"] });
  expect(ctx.handoff.files, "handoff.files").toHaveLengthAtLeast(1, "The handoff lists no changed files");
});
```

`ctx` holds everything a check can look at (the bot's handoff, the work item, git, the files…). The last argument of a matcher, `"The handoff lists no changed files"`, is what the failure says. Write it as the fix.

**3. Run it.**

```sh
npx dash-check ready
# ✓ ready: The handoff has summary
```

**4. Make it fail.** Edit the sample so `"files": []` and run it again:

```
  ✗ ready
      ● The handoff lists no changed files
✗ ready: The handoff lists no changed files
```

A good check passes on good input **and** fails on bad input with a reason that says what to fix. Always try both.

## How a check runs

A check gets an **input**: Dash's check input, or a sample file. The input is JSON with the bot's answer, the work item, the workspace and the team's settings:

```json
{
  "input": { "answer": "Done.\n\n```json\n{ \"files\": [\"src/index.js\"] }\n```" },
  "item": { "id": "DASH-97", "title": "Title-case board names" },
  "workspace": { "dir": ".", "branch": "feat/DASH-97-titlecase" },
  "row": { "repo": { "baseBranch": "main" } },
  "settings": { "mergeWhenGreen": true }
}
```

It gives a **result**:

```js
{ pass: false,
  reason: "The handoff lists no changed files",
  checks: [{ name: "ready", pass: false, reason: "…", failures: [{ message, at?, expected, received }] }] }
```

Run as a file, it prints a report, then one last line of JSON, `{"reason": "…", "details": {…}}`. That's Dash's check contract: exit 0 passes, and the last line says why.

Every failing `expect` is **collected**, and the check goes on, so a check lists *all* the gaps, not just the first. A matcher returns `true` or `false`, so you can guard code that needs the value:

```js
if (expect(handoff.tests, "handoff.tests").toBeArray()) {
  for (const t of handoff.tests) expect(t.file, `${t.acceptance}'s file`).toBeNonEmptyString(`No file for: ${t.acceptance}`);
}
```

## The layers

dash-check has three layers. Each is built only from the one below it, so anything a helper or a recipe does, you can do in code.

### Layer 0: primitives (`@trops/dash-check`)

**The runner.** `check(name, fn)`, `check.skip`, `check.only` and `describe(name, fn)`. `fn` gets `ctx` and may be async.

**`expect(value, label?)`.** `label` names the value in a failure. Every matcher takes an optional last argument, `message`, which is the fix shown on failure:

| Kind | Matchers |
|---|---|
| Equality and type | `toBe`, `toEqual`, `toBeDefined`, `toBeTruthy`, `toBeArray`, `toBeString`, `toBeNonEmptyString`, `toBeNumber` |
| Size | `toBeEmpty`, `toHaveLength(n)`, `toHaveLengthAtLeast(n)` |
| Membership | `toContain(item)`, `toBeOneOf(list)`, `toHaveKeys(keys)` |
| Text and numbers | `toMatch(regex or string)`, `toBeGreaterThan(n)`, `toBeLessThan(n)` |
| Modifiers | `.not`, `.resolves`, `.rejects` (`await expect(p).resolves.toBe(1)`) |

You can also call `fail(message, { at })` to fail with a message and a location, and `note(text)` to say how a check passed.

**The context (`ctx`).**

| Reader | What it gives |
|---|---|
| `ctx.input` | The raw check input (Dash's `$DASH_INPUT`) |
| `ctx.answer` | The bot's whole answer |
| `ctx.handoff` | The bot's handoff: its answer's last ```` ```json ```` block, parsed. `{}` when there's none |
| `ctx.item`, `ctx.picks`, `ctx.row`, `ctx.settings`, `ctx.step`, `ctx.job` | Dash's job data. Each is `{}` outside Dash |
| `ctx.workspace` | `{ dir, branch, exists(p), read(p), file(p), dirExists() }` |
| `ctx.env` | The environment, `DASH_*` included |
| `ctx.fs` | `exists(p)`, `read(p)`, `readJson(p)`, `list(glob)`, `dirExists(p)`, relative to the workspace |
| `ctx.run(cmd, { timeoutSec })` | Runs a command in the workspace: `{ code, stdout, stderr, timedOut }` |
| `ctx.git` | `branch()`, `isClean()`, `uncommitted()`, `commitsSince(ref)`, `changedFiles(ref)`, `lastCommitMessage()`, `remoteHas(branch)`, `defaultBranch()`, `fileAt(ref, path)` |
| `ctx.github` | `pr(urlOrNumber)`, `checksFor(sha)`, `waitForChecks(sha, { timeoutSec, noChecksAfterSec })`, using `GH_TOKEN`. A failure says the HTTP code and what to do |
| `ctx.tool(provider, name, args)` | A read-only call to one of the bot's providers (Jira, …). Only Dash can answer it, so outside Dash it fails and says so |
| `ctx.get(path)`, `ctx.fill(text)`, `ctx.when(expr)` | Read a value by path (`"handoff.files"`), fill `"{placeholders}"`, test a `when` |

In a test, give the context what it can't have outside Dash:

```js
const { createContext } = require("@trops/dash-check");
const ctx = createContext(sampleInput, { cwd: repoDir, fetch: fakeFetch, tool: fakeTool });
```

### Layer 1: helpers (`@trops/dash-check/helpers`)

A helper is a few lines of Layer 0 plus a description: a label, a sentence and typed params. Call one with `ctx` and its params:

```js
const { check } = require("@trops/dash-check");
const { git, node, files } = require("@trops/dash-check/helpers");

check("the work is ready for review", async (ctx) => {
  await git.committedSince(ctx, { base: "{repo.baseBranch}" });
  await node.testsPass(ctx);
  await files.noneMatch(ctx, { glob: "src/**/*.js", pattern: "console\\.log", message: "Remove console.log from src" });
});
```

| Group | Helpers |
|---|---|
| handoff | `has({ keys })`, `status({ is })`, `eachHas({ list, keys })` |
| plan | `hasSections({ key, sections })`, `acceptanceEachHasTest({ acceptance, tests })` |
| git | `onBranch({ branch })`, `committedSince({ base, min })`, `clean()`, `changedOnly({ globs, base })`, `noChangesTo({ globs, base })` |
| files | `exist({ paths })`, `contain({ path, text })`, `noneMatch({ glob, pattern })` |
| commands | `passes({ command, timeoutSec })`, `outputMatches({ command, pattern })` |
| node | `testsPass({ command })`, `lintPasses({ command })`, `noNewDependencies({ base, allow })` |
| github | `prOpen({ prKey })`, `ciPassed({ prKey, timeoutSec, noChecksAfterSec, ifNoChecks })` |
| tracker | `ticketExists({ provider, tool, idArg, id })`, `ticketHasLabel({ label, … })` (these need Dash's `ctx.tool`) |

`npx dash-check --list-helpers` lists each one with its params and defaults.

A few things every helper does for you:

- **Placeholders.** A param can hold `{placeholders}`: `{repo.baseBranch}` is the picked row's `baseBranch`, `{workRoot}` is a team setting, and `{item.id}` is the work item's id. A default whose placeholder has no value counts as empty: with no `repo` row, `git.committedSince` uses the repo's default branch.
- **`message`.** Every helper takes `message`, which replaces its failure text. Where the failure was (`src/index.js:12`) is kept.
- **Errors become failures.** If a helper throws (the folder isn't a git repo, GitHub says 404), the failure says why, and the check goes on to the next step.

### Writing your own helper

Put a file in `.dash/checks/helpers/` in your repo. Build it only from `ctx` and `expect`, never from `fs`, `child_process` or `fetch` directly:

```js
// .dash/checks/helpers/changelog.js
const { defineHelper, expect, note } = require("@trops/dash-check");

module.exports = defineHelper({
  id: "team.changelogUpdated",        // "group.name"
  group: "Your helpers",
  label: "Changelog updated",
  description: "CHANGELOG.md changed on this branch",
  sentence: "{file} changed since {base}",
  params: {
    file: { type: "path", label: "Changelog", default: "CHANGELOG.md" },
    base: { type: "text", label: "Base branch", default: "{repo.baseBranch}" },
  },
  reads: ["git"],
  async run(ctx, { file, base }) {
    const ref = `origin/${base || (await ctx.git.defaultBranch()) || "main"}`;
    const changed = await ctx.git.changedFiles(ref);
    expect(changed, `files changed since ${ref}`).toContain(file, `${file} isn't updated: add a line for ${ctx.item.id || "this change"}`);
    note(`${file} is updated`);
  },
});
```

Param types are `text`, `number`, `boolean`, `select` (with `options`), `path`, `glob`, `regex` and `list`. Values are converted to the type before `run` gets them: a `list` given as `"a, b"` arrives as `["a", "b"]`, and a `regex` arrives as a `RegExp`.

Then use it from code with `helper("team.changelogUpdated")(ctx, { … })`, or from a recipe with `{ "use": "team.changelogUpdated" }`. It also shows in `dash-check --list-helpers`, and so in Dash's check composer.

**Sharing helpers in a package:** list them in its `package.json`:

```json
{ "name": "@acme/dash-checks", "dashCheck": { "helpers": ["./helpers/changelog.js"] } }
```

Any repo that has the package in `dependencies` or `devDependencies` picks them up. If a helper file won't load, `--list-helpers` reports its error, and the other helpers still load.

### Layer 2: recipes (`@trops/dash-check/recipe`)

A recipe is a check as JSON. It holds no code, so it's safe to store on a bot, share and edit in a UI. Save it as `.dash/checks/<name>.check.json`:

```json
{
  "name": "The work is ready for review",
  "steps": [
    { "use": "git.committedSince", "with": { "base": "{repo.baseBranch}", "min": 1 } },
    { "use": "node.testsPass", "with": { "command": "npm test" } },
    { "use": "files.noneMatch", "with": { "glob": "src/**/*.js", "pattern": "console\\.log" },
      "message": "Remove console.log from src" },
    { "expect": "handoff.files", "matcher": "toHaveLengthAtLeast", "args": [1],
      "message": "The handoff lists no changed files" }
  ]
}
```

- `use` names a helper, and `with` holds its params.
- `expect` names a value by path (`handoff.files`, `item.id`, `env.DASH_BRANCH`, `repo.baseBranch`). Add a `matcher`, its `args`, and `"not": true` to expect the opposite.
- `when` skips the step unless a value is truthy: a path (`"handoff.prUrl"`) or a placeholder (`"{mergeWhenGreen}"`). A `!` in front turns it around.
- `message` replaces the step's failure text.
- `label` renames the row.

```js
const { validateRecipe, runRecipe, recipeToCode, explain, schema } = require("@trops/dash-check/recipe");

validateRecipe(recipe);           // { valid, errors: [{ path: "steps[1].with.min", message }] }
await runRecipe(recipe, input, { cwd, only: [0, 2] });
                                  // { pass, reason, checks, steps: [{ index, label, sentence, pass, reason, failures }] }
recipeToCode(recipe);             // the same check as a .check.js file ("View as code")
explain(recipe);                  // ["Work is committed: at least 1 commit(s) past {repo.baseBranch}, …", …]
```

`recipeToCode` gives a file that produces the same result as the recipe. The tests check this.

## The CLI

| Command | What it does |
|---|---|
| `dash-check` | Runs every `.check.js` and `.check.json` in `.dash/checks/`, plus plain executables, the way Dash does |
| `dash-check <name> --input sample.json` | Runs one check. With no `--input`, `<name>.sample.json` next to it is used |
| `dash-check --watch` | Reruns on every change |
| `dash-check --ci` | Prints a Jest-like report. A missing check counts as a failure |
| `dash-check --json` | Gives the results as JSON |
| `dash-check --list` | Lists the checks |
| `dash-check --list-helpers [--json] [--input f]` | Every helper and matcher with its metadata (the composer's palette). With `--input`, it also lists the value paths in that sample |
| `dash-check --explain <file>` | Prints a recipe as sentences, or a code file's check names |
| `dash-check new <name> [--recipe]` | Scaffolds a check and its sample input |

Options: `--cwd <dir>`, `--timeout <sec>` (2 minutes by default), and `--no-color`.

**Exit codes:** 0 when everything passed, 1 when a check failed, and 2 for bad arguments or a missing check.

A check gets the same contract as in Dash:

- `cwd` is the repo;
- the input is JSON in `$DASH_INPUT` and on stdin;
- the environment has `DASH_ITEM_*`, `DASH_WORKSPACE`, `DASH_BRANCH` and `DASH_STEP`.

A `.check.js` file runs in its own `node`. A `.check.json` recipe runs in the CLI. Any other file in `.dash/checks/` runs by its `#!` line, or else by its extension: `.js` with node, `.sh` with bash, `.py` with python3, and anything else with sh.

A `.check.js` file also runs by itself, `node .dash/checks/validate.check.js`, the way Dash runs a repo check.

**In CI**, add a step:

```yaml
- run: npx dash-check --ci
```

## Use in Dash

- **A repo check.** Commit `.dash/checks/<name>.check.js` (or `.check.json`) in a PR. A bot step `{ "kind": "repo", "name": "<name>" }` runs it from the repo's **base branch**, so a bot working on a branch can't change the check that judges it.
- **What the check sees.** Dash passes the job's item, workspace, picked rows and settings in the input. Those are `ctx.item`, `ctx.workspace`, `ctx.row` and `ctx.settings`.
- **`ctx.tool`.** Dash answers `ctx.tool` through `DASH_TOOL_SOCKET`, a local socket that takes one JSON line `{ "id", "provider", "tool", "args" }` and answers `{ "id", "result" }` or `{ "id", "error" }`.
- **The composer.** Dash's composer lists the palette from `dash-check --list-helpers --json`. It runs a recipe on a sample with `runRecipe` (Try it), and shows it as code with `recipeToCode` (View as code).

## Examples

[`examples/`](examples) holds the Code Factory's checks, written with dash-check. Each has a `.sample.json` that passes and a `.bad.json` that fails:

| Example | Proves | Reads |
|---|---|---|
| `ticket-has-acceptance` | The ticket has acceptance items | handoff |
| `plan-complete` | The plan has a cause, fix and test, and picks a known repo | handoff, picks, settings |
| `on-branch` | The workspace is on the job's branch, fresh from the base | git, workspace, row |
| `setup` | `npm ci` passes | run |
| `every-acceptance-has-a-test` | Every acceptance item has a test; the plan names real files | handoff, workspace |
| `validate` | Lint and tests pass, reported apart | run |
| `work-committed` | The work is committed, and the commit names the item | git, item |
| `changes-match-plan` | Only the planned files changed | git, handoff, row |
| `pr-ci` | The PR's CI passed (no CI is a failure) | github |
| `merge-outcome` | The PR was merged only when allowed | github, settings |
| `workspace-cleaned` | The job's folder is gone | workspace |
| `jira-comment-from-job` | The ticket got this job's comment | tool, job |
| `ready-for-review.check.json` | The composer mockup's recipe | git, run, fs, handoff |
| `helpers/changelog.js` | A team's own helper | git |

## License

MIT © trops
