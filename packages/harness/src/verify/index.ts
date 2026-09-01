import type { Page } from "patchright-core";
import type { Check, TaskSpec } from "../spec/schema.js";
import type { EvidenceCollector } from "../evidence/collector.js";
import { runDomCheck, runHttpCheck, runUrlCheck } from "./deterministic.js";
import { runJudgeCheck } from "./judge.js";
import type { CheckResult } from "./types.js";

/**
 * Run every check, cheapest first, no short-circuit: a rich failure taxonomy
 * is worth more than a fast one. Deterministic checks run in-session against
 * the final page state; the judge runs last over collected evidence.
 */
export async function verifyAll(
  spec: TaskSpec,
  page: Page,
  evidence: EvidenceCollector,
  finalScreenshotJpeg: Buffer | undefined,
  onCost?: (usd: number) => void,
): Promise<CheckResult[]> {
  const order = (c: Check): number =>
    c.type === "url" ? 0 : c.type === "dom" ? 1 : c.type === "http" ? 2 : 3;
  const checks = [...spec.checks].sort((a, b) => order(a) - order(b));

  const results: CheckResult[] = [];
  for (const check of checks) {
    let result: CheckResult;
    switch (check.type) {
      case "url":
        result = await runUrlCheck(page, check);
        break;
      case "dom":
        result = await runDomCheck(page, check);
        break;
      case "http":
        result = await runHttpCheck(check);
        break;
      case "judge":
        result = await runJudgeCheck(check, evidence, finalScreenshotJpeg, onCost);
        break;
    }
    await evidence.event({
      t: new Date().toISOString(),
      kind: "check",
      detail: `${result.label}: ${result.passed ? "pass" : "fail"} (${result.detail})`,
    });
    results.push(result);
  }
  return results;
}
