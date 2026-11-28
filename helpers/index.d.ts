// Types for @trops/dash-check/helpers: the starter helpers.
import type { Helper } from "..";

type H = Helper<Record<string, any>>;
/** A list param: an array, or text split on commas ("a, b"; a glob's {a,b} stays whole). */
type List = string[] | string;

/** Shared by the git and node helpers: empty means the repo's default branch. Default "{repo.baseBranch}". */
interface Base {
  base?: string;
}

export interface ChangesMatchPlanParams extends Base {
  /** Handoff keys listing files (a path, paths, or [{ file }] / [{ path }]). Default files, newFiles, tests. */
  planKeys?: List;
  /** Globs that may change outside the plan, e.g. CHANGELOG.md. */
  alsoAllow?: List;
  /** Allowed outside the plan only when node.lockfileExplained passes. Default package-lock.json, npm-shrinkwrap.json, yarn.lock, pnpm-lock.yaml. */
  lockfiles?: List;
}
export interface CommitsScopedParams extends ChangesMatchPlanParams {
  /** Text every commit message must have. Default "{item.id}"; empty skips it. planKeys "" skips the file check. */
  mentions?: string;
}
export interface SourceHasTestsParams extends Base {
  sources?: List;
  tests?: List;
  /** Where a source's test is, with <dir>, <name> and <ext>. */
  testPattern?: List;
  mode?: "paired" | "any";
  exempt?: List;
}
export interface NoNewMatchesParams extends Base {
  glob: List;
  pattern: string | RegExp;
}
export interface ValidateLeavesTreeCleanParams {
  /** Default "npm test". */
  command?: string;
  /** Default 1800. */
  timeoutSec?: number;
  /** Judge only the files the command changes. Default false. */
  allowDirtyBefore?: boolean;
}
export interface MaxGrowthParams extends Base {
  glob?: List;
  /** Default 800. */
  maxLines?: number;
  /** Default 50. */
  maxAdded?: number;
  exempt?: List;
}
export interface LockfileExplainedParams extends Base {
  /** Default package-lock.json. */
  lockfile?: string;
  /** Default: package.json next to the lockfile, and any changed package.json below it. */
  manifest?: string;
}
export interface TestScriptIsRealParams {
  /** Default "test". */
  script?: string;
  /** Also run it and count the tests. Default false. */
  run?: boolean;
  /** Default 1; 0 skips the count. */
  minTests?: number;
  timeoutSec?: number;
}
export interface NewTestsAreRunParams extends Base {
  tests?: List;
  /** Default package.json. */
  runnerFiles?: List;
  /** Tests the runner finds by itself, e.g. src/**\/*.test.js. */
  autoGlobs?: List;
}

export interface EvidenceForAcceptanceParams {
  /** The evidence: { searchedDone, missing: [{ acceptance, read, why }] }. Default "notYetDone". */
  key?: string;
  /** Default "acceptance". */
  acceptanceKey?: string;
  /** Needs searchedDone. Default true. */
  requireSearch?: boolean;
  /** Judge only when the handoff's status is one of these; others pass. Default ["ok"]; empty judges every handoff. */
  when?: List;
}
export interface NoOpenDecisionsParams {
  /** Default "openDecisions". */
  key?: string;
  /** Judge only when the handoff's status is one of these; others pass. Default ["ok"]; empty judges every handoff. */
  when?: List;
}

export const handoff: { has: H; status: H; eachHas: H };
export const plan: {
  hasSections: H;
  acceptanceEachHasTest: H;
  evidenceForAcceptance: Helper<EvidenceForAcceptanceParams>;
  noOpenDecisions: Helper<NoOpenDecisionsParams>;
};
export const git: {
  onBranch: H;
  committedSince: H;
  clean: H;
  changedOnly: H;
  noChangesTo: H;
  changesMatchPlan: Helper<ChangesMatchPlanParams>;
  commitsScoped: Helper<CommitsScopedParams>;
  sourceHasTests: Helper<SourceHasTestsParams>;
  noNewMatches: Helper<NoNewMatchesParams>;
  validateLeavesTreeClean: Helper<ValidateLeavesTreeCleanParams>;
};
export const files: { exist: H; contain: H; noneMatch: H; maxGrowth: Helper<MaxGrowthParams> };
export const commands: { passes: H; outputMatches: H };
export const node: {
  testsPass: H;
  lintPasses: H;
  noNewDependencies: H;
  lockfileExplained: Helper<LockfileExplainedParams>;
  testScriptIsReal: Helper<TestScriptIsRealParams>;
  newTestsAreRun: Helper<NewTestsAreRunParams>;
};
export const github: { prOpen: H; ciPassed: H };
export const tracker: { ticketExists: H; ticketHasLabel: H };
/** Every starter helper. */
export const all: H[];
