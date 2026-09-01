import { describe, expect, it } from "vitest";
import { isGating, taskSpecSchema } from "../src/spec/schema.js";

const minimal = {
  id: "demo",
  goal: "do the thing",
  env: { kind: "browser", startUrl: "https://example.com" },
  agent: { adapter: "computer-use" },
  checks: [{ type: "url", matches: "done" }],
};

describe("taskSpecSchema", () => {
  it("fills defaults", () => {
    const spec = taskSpecSchema.parse(minimal);
    expect(spec.trials.n).toBe(10);
    expect(spec.trials.concurrency).toBe(5);
    expect(spec.trials.positiveControl).toBe(true);
    expect(spec.env.recording).toBe(true);
    expect(spec.env.viewport).toEqual({ width: 1280, height: 800 });
    expect(spec.agent.maxSteps).toBe(25);
    expect(spec.gate.minVerifiedRate).toBe(0.8);
    expect(spec.budget.maxUsd).toBe(3);
  });

  it("rejects bad ids", () => {
    expect(() => taskSpecSchema.parse({ ...minimal, id: "Bad Id" })).toThrow();
  });

  it("rejects empty checks", () => {
    expect(() => taskSpecSchema.parse({ ...minimal, checks: [] })).toThrow();
  });

  it("parses every check type", () => {
    const spec = taskSpecSchema.parse({
      ...minimal,
      checks: [
        { type: "url", matches: "/complete/" },
        { type: "dom", selector: ".ok", textContains: "Thanks" },
        {
          type: "http",
          url: "https://api.example.com/orders/latest",
          expect: { status: 200, jsonPath: "$.zip", equals: "94105" },
          optional: true,
        },
        { type: "judge", rubric: "Did it work?", weight: "advisory" },
      ],
    });
    expect(spec.checks).toHaveLength(4);
  });
});

describe("isGating", () => {
  it("optional never gates; advisory judge never gates; required judge gates", () => {
    const spec = taskSpecSchema.parse({
      ...minimal,
      checks: [
        { type: "url", matches: "x" },
        { type: "url", matches: "x", optional: true },
        { type: "judge", rubric: "r", weight: "advisory" },
        { type: "judge", rubric: "r", weight: "required" },
      ],
    });
    expect(spec.checks.map(isGating)).toEqual([true, false, false, true]);
  });
});
