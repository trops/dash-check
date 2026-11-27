// Types for @trops/dash-check/cli.
export function main(argv: string[], io?: { log?: (s: string) => void; err?: (s: string) => void; signal?: AbortSignal }): Promise<number>;
export function parseArgs(argv: string[]): Record<string, any>;
export function listChecks(cwd: string): Array<{ name: string; file: string; type: "js" | "recipe" | "exec"; sample?: string }>;
export function runEntry(entry: { name: string; file: string; type: "js" | "recipe" | "exec" }, opts: { cwd: string; input: Record<string, any>; timeoutSec?: number }): Promise<any>;
export function lastProof(output: string): { proof: { reason?: string; details?: any }; index: number; lines: string[] } | null;
export const CHECKS_DIR: string;
