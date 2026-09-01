import type { Verdict } from "../verify/types.js";
import { countsTowardRate, isVerifiedSuccess } from "../verify/verdict.js";

export interface TrialForStats {
  verdict: Verdict;
  claim: "success" | "failure" | "gave_up";
  costUsd: number;
  wallMs: number;
}

export interface RunStats {
  /** Trials counted (env_error excluded). */
  counted: number;
  verified: number;
  verifiedRate: number;
  wilson95: [number, number];
  /** Of the trials where the agent claimed success, how often it was wrong. */
  claimedSuccesses: number;
  falsePositives: number;
  falsePositiveRate: number;
  envErrors: number;
  totalUsd: number;
  totalWallMs: number;
  verdictCounts: Partial<Record<Verdict, number>>;
}

/**
 * Wilson score interval, 95 percent. Reported alongside the point estimate;
 * the gate uses the point estimate (a lower-bound gate at small N is
 * punitively strict for a first-time user).
 */
export function wilson95(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.959963984540054;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function computeStats(trials: TrialForStats[]): RunStats {
  const counted = trials.filter((t) => countsTowardRate(t.verdict));
  const verified = counted.filter((t) => isVerifiedSuccess(t.verdict)).length;
  const claimed = counted.filter((t) => t.claim === "success");
  const falsePositives = counted.filter(
    (t) => t.verdict === "false_positive",
  ).length;

  const verdictCounts: Partial<Record<Verdict, number>> = {};
  for (const t of trials) {
    verdictCounts[t.verdict] = (verdictCounts[t.verdict] ?? 0) + 1;
  }

  return {
    counted: counted.length,
    verified,
    verifiedRate: counted.length ? verified / counted.length : 0,
    wilson95: wilson95(verified, counted.length),
    claimedSuccesses: claimed.length,
    falsePositives,
    falsePositiveRate: claimed.length ? falsePositives / claimed.length : 0,
    envErrors: trials.filter((t) => t.verdict === "env_error").length,
    totalUsd: trials.reduce((s, t) => s + t.costUsd, 0),
    totalWallMs: trials.reduce((s, t) => s + t.wallMs, 0),
    verdictCounts,
  };
}

export interface GateInput {
  minVerifiedRate: number;
  maxFalsePositiveRate: number;
}

export interface GateResult {
  passed: boolean;
  failures: string[];
}

/** Threshold table in, (pass, failures[]) out. */
export function evaluateGate(stats: RunStats, gate: GateInput): GateResult {
  const failures: string[] = [];
  if (stats.counted === 0) {
    failures.push("no counted trials (all env_error)");
  }
  if (stats.verifiedRate < gate.minVerifiedRate) {
    failures.push(
      `verified rate ${fmtPct(stats.verifiedRate)} below threshold ${fmtPct(gate.minVerifiedRate)}`,
    );
  }
  if (stats.falsePositiveRate > gate.maxFalsePositiveRate) {
    failures.push(
      `false-positive rate ${fmtPct(stats.falsePositiveRate)} above threshold ${fmtPct(gate.maxFalsePositiveRate)}`,
    );
  }
  return { passed: failures.length === 0, failures };
}

export function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
