// Types for @trops/dash-check/recipe: checks as data.
import type { Context, ContextOptions, Failure, RunResult, Helper } from "..";

export interface UseStep {
  use: string;
  with?: Record<string, unknown>;
  when?: string | boolean;
  message?: string;
  label?: string;
}

export interface ExpectStep {
  expect: string;
  matcher: string;
  args?: unknown[];
  not?: boolean;
  when?: string | boolean;
  message?: string;
  label?: string;
}

export type Step = UseStep | ExpectStep;

export interface Recipe {
  $schema?: string;
  name: string;
  description?: string;
  version?: 1;
  steps: Step[];
}

export interface StepResult {
  index: number;
  label: string;
  sentence: string;
  pass: boolean;
  skipped?: boolean;
  reason: string;
  failures: Failure[];
  ms?: number;
}

export interface RecipeResult extends RunResult {
  steps: StepResult[];
  errors?: Array<{ path: string; message: string }>;
}

export interface RecipeOptions extends ContextOptions {
  getHelper?: (id: string) => Helper | null;
  /** Run only these steps (by index). */
  only?: number[];
  ctx?: Context;
}

export const schema: Record<string, any>;
export function validateRecipe(recipe: unknown, opts?: { getHelper?: (id: string) => Helper | null }): { valid: boolean; errors: Array<{ path: string; message: string }> };
export function compileRecipe(recipe: Recipe, opts?: { getHelper?: (id: string) => Helper | null }): {
  name: string;
  steps: Array<{ index: number; label: string; when?: string | boolean; run(ctx: Context): Promise<unknown>; step: Step }>;
  check(ctx: Context): Promise<void>;
};
export function runRecipe(recipe: Recipe, input?: Record<string, any>, opts?: RecipeOptions): Promise<RecipeResult>;
/** The recipe as a .check.js file that gives the same result. */
export function recipeToCode(recipe: Recipe, opts?: { getHelper?: (id: string) => Helper | null; file?: string }): string;
export const toCode: typeof recipeToCode;
/** One sentence per step. */
export function explain(recipe: Recipe, opts?: { getHelper?: (id: string) => Helper | null }): string[];
export function valuePaths(ctx: Context): Array<{ path: string; type: string; sample?: unknown }>;
export function slug(name: string): string;
export function pathCode(path: string): string;
