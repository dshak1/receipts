import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { anthropicClient, estimateUsd } from "../adapters/providers/anthropic.js";
import type { JudgeCheck } from "../spec/schema.js";
import type { EvidenceCollector } from "../evidence/collector.js";
import type { CheckResult } from "./types.js";

const JUDGE_MODEL = "claude-opus-5";

/**
 * LLM judge over the evidence bundle. Advisory by default: it annotates the
 * report but does not gate the verdict unless weight is "required". It never
 * sees the agent's claim, only the evidence.
 */
export async function runJudgeCheck(
  check: JudgeCheck,
  evidence: EvidenceCollector,
  finalScreenshotJpeg: Buffer | undefined,
  onCost?: (usd: number) => void,
): Promise<CheckResult> {
  const start = Date.now();
  const client = anthropicClient();

  const content: (
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: "image/jpeg"; data: string };
      }
  )[] = [];

  const refs: string[] = [];
  if (check.evidence.includes("finalScreenshot") && finalScreenshotJpeg) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: finalScreenshotJpeg.toString("base64"),
      },
    });
    content.push({ type: "text", text: "Above: the final screenshot of the run." });
  }
  if (check.evidence.includes("actionLog")) {
    const log = await readFile(join(evidence.dir, "events.jsonl"), "utf8").catch(
      () => "",
    );
    // Cap the log so a runaway trial cannot blow up judge cost.
    const tail = log.length > 20_000 ? log.slice(-20_000) : log;
    content.push({
      type: "text",
      text: `Action log (JSONL, possibly truncated to the tail):\n${tail}`,
    });
    refs.push("events.jsonl");
  }
  content.push({
    type: "text",
    text:
      `You are an impartial evaluator of a browser automation run. ` +
      `Judge ONLY from the evidence above; you were not told what the agent thinks happened.\n\n` +
      `Rubric: ${check.rubric}\n\n` +
      `Reply with exactly one line: PASS: <one sentence> or FAIL: <one sentence>.`,
  });

  try {
    const response = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    });
    onCost?.(
      estimateUsd(
        JUDGE_MODEL,
        response.usage.input_tokens,
        response.usage.output_tokens,
      ),
    );
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join(" ")
      .trim();
    const passed = /^\s*PASS\b/i.test(text);
    const failed = /^\s*FAIL\b/i.test(text);
    return {
      check,
      label: check.label ?? "LLM judge",
      passed,
      detail: passed || failed ? text.slice(0, 300) : `unparseable judge reply: ${text.slice(0, 200)}`,
      evidenceRefs: refs,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      check,
      label: check.label ?? "LLM judge",
      passed: false,
      detail: `judge errored: ${err instanceof Error ? err.message : String(err)}`,
      evidenceRefs: refs,
      durationMs: Date.now() - start,
    };
  }
}
