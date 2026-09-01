import type { Check } from "../spec/schema.js";

export interface CheckResult {
  check: Check;
  label: string;
  passed: boolean;
  /** Human-readable outcome; rendered verbatim in the report. */
  detail: string;
  /** Bundle-relative filenames backing this result. */
  evidenceRefs: string[];
  durationMs: number;
}

/**
 * What the agent said about its own run. "gave_up" means it stopped and said
 * it could not finish; "success" is a claim, not a fact.
 */
export type AgentClaim = "success" | "failure" | "gave_up";

/**
 * The typed verdict for one trial. `false_positive` is the money row: the
 * agent claimed success and independent verification disagreed.
 * `env_error` trials are excluded from success-rate denominators; the
 * positive-control trial is what licenses that exclusion.
 */
export type Verdict =
  | "verified_success"
  | "false_positive"
  | "silent_success"
  | "agent_failure"
  | "env_error"
  | "timeout"
  | "budget_stopped";

export const VERDICT_LABELS: Record<Verdict, string> = {
  verified_success: "Verified success",
  false_positive: "False positive",
  silent_success: "Silent success",
  agent_failure: "Agent failure",
  env_error: "Environment error",
  timeout: "Timeout",
  budget_stopped: "Budget stopped",
};
