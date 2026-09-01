import { describe, expect, it } from "vitest";
import {
  computeStats,
  evaluateGate,
  wilson95,
  type TrialForStats,
} from "../src/run/stats.js";

function t(
  verdict: TrialForStats["verdict"],
  claim: TrialForStats["claim"] = "success",
): TrialForStats {
  return { verdict, claim, costUsd: 0.1, wallMs: 1000 };
}

describe("wilson95", () => {
  it("is [0,1] for n=0", () => {
    expect(wilson95(0, 0)).toEqual([0, 1]);
  });
  it("brackets the point estimate", () => {
    const [lo, hi] = wilson95(8, 10);
    expect(lo).toBeLessThan(0.8);
    expect(hi).toBeGreaterThan(0.8);
    expect(lo).toBeGreaterThan(0.4);
    expect(hi).toBeLessThan(1);
  });
  it("known value: 13/20 is about [0.43, 0.82]", () => {
    const [lo, hi] = wilson95(13, 20);
    expect(lo).toBeCloseTo(0.433, 2);
    expect(hi).toBeCloseTo(0.819, 2);
  });
});

describe("computeStats", () => {
  it("separates claimed from verified and counts false positives", () => {
    const stats = computeStats([
      t("verified_success"),
      t("verified_success"),
      t("false_positive"),
      t("agent_failure", "failure"),
      t("silent_success", "gave_up"),
    ]);
    expect(stats.counted).toBe(5);
    expect(stats.verified).toBe(3); // 2 verified + 1 silent
    expect(stats.claimedSuccesses).toBe(3); // three claimed success
    expect(stats.falsePositives).toBe(1);
    expect(stats.falsePositiveRate).toBeCloseTo(1 / 3);
  });

  it("excludes env_error from the denominator but keeps its cost", () => {
    const stats = computeStats([t("verified_success"), t("env_error")]);
    expect(stats.counted).toBe(1);
    expect(stats.verifiedRate).toBe(1);
    expect(stats.envErrors).toBe(1);
    expect(stats.totalUsd).toBeCloseTo(0.2);
  });
});

describe("evaluateGate", () => {
  const base = { minVerifiedRate: 0.8, maxFalsePositiveRate: 0.1 };
  it("passes a clean run", () => {
    const stats = computeStats(Array.from({ length: 10 }, () => t("verified_success")));
    expect(evaluateGate(stats, base)).toEqual({ passed: true, failures: [] });
  });
  it("fails on verified rate", () => {
    const stats = computeStats([
      ...Array.from({ length: 7 }, () => t("verified_success")),
      ...Array.from({ length: 3 }, () => t("false_positive")),
    ]);
    const gate = evaluateGate(stats, base);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.includes("verified rate"))).toBe(true);
    expect(gate.failures.some((f) => f.includes("false-positive rate"))).toBe(true);
  });
  it("fails when everything is env_error", () => {
    const stats = computeStats([t("env_error")]);
    const gate = evaluateGate(stats, base);
    expect(gate.passed).toBe(false);
    expect(gate.failures[0]).toContain("no counted trials");
  });
});
