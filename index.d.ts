// Types for @trops/dash-check (Layer 0: the runner, expect, the context, defineHelper).

/** One thing that went wrong, said so it can be fixed. */
export interface Failure {
  message: string;
  /** Where (a file:line, a list of names), shown after the message. */
  at?: string;
  expected?: unknown;
  received?: unknown;
  matcher?: string;
  label?: string;
  /** It was a thrown error, not an expectation. */
  error?: boolean;
  /** The helper's own text, when a step's `message` replaced it. */
  original?: string;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  skipped?: boolean;
  reason: string;
  failures: Failure[];
  ms?: number;
}

export interface RunResult {
  pass: boolean;
  reason: string;
  checks: CheckResult[];
}

// ---- the context ----------------------------------------------------------

export interface RunOutput {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface Fs {
  path(p: string): string;
  exists(p: string): Promise<boolean>;
  dirExists(p?: string): Promise<boolean>;
  read(p: string): Promise<string>;
  readJson<T = any>(p: string): Promise<T>;
  /** Files matching a glob (or globs; "!glob" leaves out), relative and sorted. */
  list(globs: string | string[]): Promise<string[]>;
}

/** A line added since a ref (ctx.git.addedLines). */
export interface AddedLine {
  file: string;
  /** Its line number in the file as it is now (1-based). */
  line: number;
  text: string;
}

/** A commit past a ref (ctx.git.commits). */
export interface Commit {
  sha: string;
  subject: string;
  message: string;
  parents: string[];
  /** The files it changed; empty for a merge commit. */
  files: string[];
}

export interface Git {
  branch(): Promise<string>;
  uncommitted(): Promise<string[]>;
  isClean(): Promise<boolean>;
  commitsSince(ref: string): Promise<number>;
  changedFiles(ref: string): Promise<string[]>;
  /** Lines added since where HEAD left ref: committed, uncommitted, and untracked files whole. Binary files left out. */
  addedLines(ref: string): Promise<AddedLine[]>;
  /** The commits in ref..HEAD, oldest first. */
  commits(ref: string): Promise<Commit[]>;
  lastCommitMessage(): Promise<string>;
  remoteHas(branch: string, remote?: string): Promise<boolean>;
  defaultBranch(): Promise<string | null>;
  fileAt(ref: string, path: string): Promise<string | null>;
  hasRef(ref: string): Promise<boolean>;
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  url: string | null;
}

export interface WaitResult {
  runs: CheckRun[];
  failed: CheckRun[];
  pending: CheckRun[];
  passed: CheckRun[];
  noChecks: boolean;
  timedOut: boolean;
  waitedSec: number;
}

export interface GitHub {
  pr(urlOrNumber: string | number, opts?: { repo?: string }): Promise<any & { slug: string }>;
  checksFor(sha: string, opts?: { repo?: string }): Promise<{ runs: CheckRun[]; source: "check-runs" | "actions" }>;
  waitForChecks(sha: string, opts?: { timeoutSec?: number; noChecksAfterSec?: number; pollSec?: number; repo?: string }): Promise<WaitResult>;
}

export interface Workspace {
  dir: string;
  branch?: string;
  file(p: string): string;
  exists(p: string): Promise<boolean>;
  read(p: string): Promise<string>;
  dirExists(): Promise<boolean>;
  [key: string]: any;
}

export interface Context {
  /** The raw check input (Dash's $DASH_INPUT). */
  input: Record<string, any>;
  /** The bot's whole answer. */
  answer: string;
  /** The answer's last json block, parsed; {} when there's none. */
  handoff: Record<string, any>;
  handoffInfo: { found: boolean; broken?: boolean; error?: string; list?: boolean; given?: boolean };
  item: Record<string, any>;
  picks: Record<string, any>;
  row: Record<string, any>;
  settings: Record<string, any>;
  step: Record<string, any>;
  job: Record<string, any>;
  workspace: Workspace;
  env: Record<string, string | undefined>;
  /** Where fs, run and git work. */
  cwd: string;
  fs: Fs;
  run(cmd: string, opts?: { timeoutSec?: number; env?: Record<string, string>; cwd?: string }): Promise<RunOutput>;
  git: Git;
  github: GitHub;
  /** A read-only provider call; only Dash can answer it (DASH_TOOL_SOCKET). */
  tool(provider: string, name: string, args?: Record<string, any>): Promise<any>;
  /** A value by path: "handoff.files", "repo.baseBranch". */
  get(path: string): any;
  /** Fill "{placeholders}" from the context. */
  fill<T = any>(value: T, opts?: FillOptions): any;
  /** Is a `when` true? A path or a {placeholder}; "!" turns it around. */
  when(expr: string | boolean | undefined): boolean;
  /** Say how the running check passed. */
  note(text: string): void;
}

export interface ContextOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  fetch?: (url: string, init?: any) => Promise<{ status: number; json(): Promise<any> }>;
  tool?: (provider: string, name: string, args: Record<string, any>) => any;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FillOptions {
  /** What a placeholder with no value does: throw (default), become empty, or stay as is. */
  missing?: "throw" | "empty" | "keep";
}

export function createContext(input?: Record<string, any>, opts?: ContextOptions): Context;

// ---- the runner -----------------------------------------------------------

export type CheckFn = (ctx: Context) => unknown | Promise<unknown>;

export interface CheckApi {
  (name: string, fn: CheckFn): void;
  skip(name: string, fn?: CheckFn): void;
  only(name: string, fn: CheckFn): void;
}
export const check: CheckApi;
export function describe(name: string, fn: () => void): void;

export interface DefinedCheck {
  name: string;
  fn: CheckFn;
  mode: null | "skip" | "only";
}

/** Run the checks defined so far. Default input: $DASH_INPUT. */
export function run(input?: Record<string, any>, opts?: ContextOptions & { ctx?: Context; filter?: (name: string) => boolean }): Promise<RunResult>;
export function runChecks(checks: DefinedCheck[], ctx: Context, opts?: { filter?: (name: string) => boolean }): Promise<RunResult>;
export function loadChecks(file: string): DefinedCheck[];
export function takeChecks(): DefinedCheck[];
/** Run a .check.js or .check.json file in this process. */
export function runFile(file: string, input?: Record<string, any>, opts?: ContextOptions & { ctx?: Context }): Promise<RunResult>;
/** {"reason", "details"}: Dash's check contract, one line. */
export function lastLine(result: RunResult): string;
export function report(result: RunResult, opts?: { title?: string; color?: boolean }): string;

// ---- expect ---------------------------------------------------------------

/** Each matcher returns whether it passed; its last argument is the failure's message. */
export interface Matchers<R = boolean> {
  toBe(expected: unknown, message?: string): R;
  toEqual(expected: unknown, message?: string): R;
  toBeDefined(message?: string): R;
  toBeTruthy(message?: string): R;
  toBeArray(message?: string): R;
  toBeString(message?: string): R;
  toBeNonEmptyString(message?: string): R;
  toBeNumber(message?: string): R;
  toBeEmpty(message?: string): R;
  toHaveLength(n: number, message?: string): R;
  toHaveLengthAtLeast(n: number, message?: string): R;
  toContain(item: unknown, message?: string): R;
  toBeOneOf(options: unknown[], message?: string): R;
  toHaveKeys(keys: string[], message?: string): R;
  toMatch(pattern: RegExp | string, message?: string): R;
  toBeGreaterThan(n: number, message?: string): R;
  toBeLessThan(n: number, message?: string): R;
  [custom: string]: any;
}

export interface Expectation extends Matchers<boolean> {
  not: Matchers<boolean>;
  resolves: Matchers<Promise<boolean>> & { not: Matchers<Promise<boolean>> };
  rejects: Matchers<Promise<boolean>> & { not: Matchers<Promise<boolean>> };
}

export interface MatcherParam {
  name: string;
  type: string;
  label: string;
}

export interface MatcherMeta {
  id: string;
  label: string;
  sentence: string;
  notSentence: string;
  params: MatcherParam[];
  description: string;
}

export interface MatcherDef {
  id: string;
  label?: string;
  sentence: string;
  notSentence?: string;
  params?: Array<{ name: string; type?: string; label?: string }>;
  description?: string;
  test(received: any, ...args: any[]): boolean | { pass: boolean; got?: string };
}

export interface ExpectFn {
  (value: unknown, label?: string): Expectation;
  matchers(): MatcherMeta[];
  extend(defs: MatcherDef | MatcherDef[]): MatcherMeta[];
  has(id: string): boolean;
  meta(id: string): MatcherMeta | null;
  sentence(id: string, label: string, args?: unknown[], not?: boolean): string | null;
}
export const expect: ExpectFn;
export function defineMatcher(def: MatcherDef): MatcherMeta;

/** Fail the running check with a message (the fix), going on with the rest. */
export function fail(message: string, extra?: { at?: string; expected?: unknown; received?: unknown }): false;
/** Say how the running check passed. */
export function note(text: string): void;
/** Run fn with its own failure list. Never throws. */
export function collect(fn: () => unknown): Promise<{ failures: Failure[]; notes: string[] }>;

export class CheckFailure extends Error {
  failures: Failure[];
}
export class DashCheckError extends Error {
  fix?: string;
  code?: number;
}

// ---- helpers --------------------------------------------------------------

export type ParamType = "text" | "number" | "boolean" | "select" | "path" | "glob" | "regex" | "list";

export interface ParamDef {
  type?: ParamType;
  label?: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: Array<string | number>;
  placeholder?: string;
}

export interface HelperMeta {
  id: string;
  group: string;
  label: string;
  description: string;
  sentence: string;
  params: Record<string, ParamDef & { type: ParamType; label: string }>;
  reads: string[];
  source?: string;
}

export interface HelperDef<P = Record<string, any>> {
  /** "group.name", e.g. "team.changelogUpdated". */
  id: string;
  group?: string;
  label: string;
  description?: string;
  /** "at least {min} commit(s) past {base}" */
  sentence?: string;
  params?: Record<string, ParamDef>;
  /** What it reads: git, fs, run, github, tool, handoff… */
  reads?: string[];
  run(ctx: Context, params: P): unknown | Promise<unknown>;
}

export interface Helper<P = Record<string, any>> {
  (ctx: Context, params?: Partial<P> & { message?: string }): Promise<boolean>;
  meta: HelperMeta;
  isDashCheckHelper: true;
}

export function defineHelper<P = Record<string, any>>(def: HelperDef<P>): Helper<P>;
/** A registered helper by id, to call from code (a repo's own are found from ctx.cwd). */
export function helper(id: string): (ctx: Context, params?: Record<string, any>) => Promise<boolean>;
export function getHelper(id: string): Helper | null;
export function listHelpers(): HelperMeta[];
export function registerHelpers(helpers: Helper | Helper[], opts?: { source?: string; replace?: boolean }): Helper[];
/** Find a repo's own helpers: .dash/checks/helpers/*.js and packages with "dashCheck": { "helpers": [...] }. */
export function loadHelpers(opts?: { cwd?: string }): { helpers: Array<{ id: string; source: string }>; errors: Array<{ source: string; error: string }> };
export function sentenceOf(meta: HelperMeta, params?: Record<string, any>): string;
export function resolveParams(meta: HelperMeta, ctx: Context | null, params?: Record<string, any>): Record<string, any>;

// ---- small tools ----------------------------------------------------------

export function readHandoff(input: Record<string, any>): { handoff: Record<string, any>; info: Context["handoffInfo"] };
export function lastJsonBlock(text: string): { found: boolean; value?: any; fenced?: boolean; broken?: boolean; error?: string };
export function get(ctx: Context, path: string): any;
export function fill(ctx: Context, value: unknown, opts?: FillOptions): any;
export function when(ctx: Context, expr: string | boolean | undefined): boolean;
export function valuePaths(ctx: Context, opts?: { maxDepth?: number; max?: number }): Array<{ path: string; type: string; sample?: unknown }>;
export function matchGlob(globs: string | string[], path: string): boolean;
export function globToRegExp(glob: string): RegExp;
export function isEmpty(value: unknown): boolean;
export function deepEqual(a: unknown, b: unknown): boolean;
