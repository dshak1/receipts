import { describe, expect, it } from "vitest";
import { decideVerdict, countsTowardRate, isVerifiedSuccess } from "../src/verify/verdict.js";
import type { CheckResult } from "../src/verify/types.js";
import type { Check } from "../src/spec/schema.js";

function result(passed: boolean, check: Partial<Check> = {}): CheckResult {
  return {
    check: {
      type: "dom",
      selector: "#x",
      optional: false,
      ...check,
    } as Check,
    label: "test",
    passed,
    detail: "",
    evidenceRefs: [],
    durationMs: 0,
  };
}

describe("decideVerdict", () => {
  it("claim success + all gating pass = verified_success", () => {
    expect(decideVerdict("success", [result(true), result(true)])).toBe(
      "verified_success",
    );
  });

  it("claim success + any gating fail = false_positive", () => {
    expect(decideVerdict("success", [result(true), result(false)])).toBe(
      "false_positive",
    );
  });

  it("claim failure + all pass = silent_success", () => {
    expect(decideVerdict("failure", [result(true)])).toBe("silent_success");
    expect(decideVerdict("gave_up", [result(true)])).toBe("silent_success");
  });

  it("claim failure + fail = agent_failure", () => {
    expect(decideVerdict("failure", [result(false)])).toBe("agent_failure");
  });

  it("optional checks never gate", () => {
    expect(
      decideVerdict("success", [result(true), result(false, { optional: true })]),
    ).toBe("verified_success");
  });

  it("advisory judge never gates; required judge gates", () => {
    const advisory = result(false, {
      type: "judge",
      rubric: "r",
      evidence: ["finalScreenshot"],
      weight: "advisory",
    } as Partial<Check>);
    expect(decideVerdict("success", [result(true), advisory])).toBe(
      "verified_success",
    );
    const required = result(false, {
      type: "judge",
      rubric: "r",
      evidence: ["finalScreenshot"],
      weight: "required",
    } as Partial<Check>);
    expect(decideVerdict("success", [result(true), required])).toBe(
      "false_positive",
    );
  });

  it("no gating checks at all means the claim stands", () => {
    expect(decideVerdict("success", [result(false, { optional: true })])).toBe(
      "verified_success",
    );
  });
});

describe("verdict helpers", () => {
  it("env_error is excluded from rate denominators", () => {
    expect(countsTowardRate("env_error")).toBe(false);
    expect(countsTowardRate("false_positive")).toBe(true);
  });
  it("silent_success counts as verified", () => {
    expect(isVerifiedSuccess("silent_success")).toBe(true);
    expect(isVerifiedSuccess("false_positive")).toBe(false);
  });
});
