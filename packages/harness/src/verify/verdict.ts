import { isGating } from "../spec/schema.js";
import type { AgentClaim, CheckResult, Verdict } from "./types.js";

/**
 * Combine the agent's own claim with independent check results into a typed
 * verdict. Pure function; exhaustively unit-tested.
 *
 * Rules:
 * - Only gating checks (non-optional, non-advisory-judge) decide pass/fail.
 * - claim success + all gating pass  -> verified_success
 * - claim success + any gating fail  -> false_positive
 * - claim failure/gave_up + all pass -> silent_success (it did the job and
 *   did not know it)
 * - claim failure/gave_up + any fail -> agent_failure
 */
export function decideVerdict(
  claim: AgentClaim,
  checkResults: CheckResult[],
): Verdict {
  const gating = checkResults.filter((r) => isGating(r.check));
  const allPassed = gating.every((r) => r.passed);
  if (claim === "success") {
    return allPassed ? "verified_success" : "false_positive";
  }
  return allPassed ? "silent_success" : "agent_failure";
}

/** Verdicts that count toward the success-rate denominator. */
export function countsTowardRate(v: Verdict): boolean {
  return v !== "env_error";
}

export function isVerifiedSuccess(v: Verdict): boolean {
  return v === "verified_success" || v === "silent_success";
}

export function isClaimedSuccess(claim: AgentClaim): boolean {
  return claim === "success";
}
