// Types for @trops/dash-check/helpers: the starter helpers.
import type { Helper } from "..";

type H = Helper<Record<string, any>>;

export const handoff: { has: H; status: H; eachHas: H };
export const plan: { hasSections: H; acceptanceEachHasTest: H };
export const git: { onBranch: H; committedSince: H; clean: H; changedOnly: H; noChangesTo: H };
export const files: { exist: H; contain: H; noneMatch: H };
export const commands: { passes: H; outputMatches: H };
export const node: { testsPass: H; lintPasses: H; noNewDependencies: H };
export const github: { prOpen: H; ciPassed: H };
export const tracker: { ticketExists: H; ticketHasLabel: H };
/** Every starter helper. */
export const all: H[];
