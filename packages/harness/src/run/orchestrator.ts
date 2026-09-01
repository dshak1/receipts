import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pLimit from "p-limit";
import type { LoadedSpec } from "../spec/load.js";
import type { TaskSpec } from "../spec/schema.js";
import { SolariPool } from "./session.js";
import { computeStats, evaluateGate, type GateResult, type RunStats } from "./stats.js";
import { runTrial, type TrialRecord } from "./trial.js";

export interface RunReport {
  runId: string;
  createdAt: string;
  spec: TaskSpec;
  control: TrialRecord | null;
  /** Agent trials only; the control is reported separately. */
  trials: TrialRecord[];
  stats: RunStats;
  gate: GateResult;
  /** True when the control failed and agent trials were skipped. */
  voided: boolean;
  notes: string[];
}

export interface RunOptions {
  loaded: LoadedSpec;
  outRoot: string; // e.g. ./runs
  apiKey: string;
  overrides?: { n?: number; concurrency?: number; maxUsd?: number };
  log?: (line: string) => void;
}

export async function runSuite(opts: RunOptions): Promise<RunReport> {
  const { loaded } = opts;
  const spec = loaded.spec;
  const log = opts.log ?? (() => {});
  const n = opts.overrides?.n ?? spec.trials.n;
  const concurrency = opts.overrides?.concurrency ?? spec.trials.concurrency;
  const maxUsd = opts.overrides?.maxUsd ?? spec.budget.maxUsd;

  const runId = `${spec.id}-${new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14)}`;
  const runDir = join(opts.outRoot, runId);
  await mkdir(runDir, { recursive: true });

  const pool = new SolariPool(opts.apiKey);
  const notes: string[] = [];
  let control: TrialRecord | null = null;
  let trials: TrialRecord[] = [];
  let voided = false;

  const deadline = Date.now() + spec.budget.maxTotalMinutes * 60_000;
  let spent = 0;
  let budgetStopped = false;

  try {
    if (spec.trials.positiveControl) {
      log(`[control] running scripted baseline...`);
      control = await runTrial({
        runId,
        runDir,
        index: 0,
        role: "control",
        loaded,
        pool,
      });
      spent += control.costUsd;
      log(
        `[control] ${control.verdict} in ${(control.wallMs / 1000).toFixed(1)}s`,
      );
      if (
        control.verdict !== "verified_success" &&
        control.verdict !== "silent_success"
      ) {
        voided = true;
        notes.push(
          "VOID: the scripted positive control failed, so the environment is broken. " +
            "The agent was not judged. Fix the environment or the flow and re-run.",
        );
      }
    }

    if (!voided) {
      const limit = pLimit(concurrency);
      const startIndex = control ? 1 : 0;
      log(`[run] launching ${n} agent trial${n === 1 ? "" : "s"} (concurrency ${concurrency})...`);
      trials = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          limit(async () => {
            if (budgetStopped || spent >= maxUsd || Date.now() > deadline) {
              budgetStopped = true;
              return makeBudgetStopped(startIndex + i);
            }
            const rec = await runTrial({
              runId,
              runDir,
              index: startIndex + i,
              role: "agent",
              loaded,
              pool,
            });
            spent += rec.costUsd;
            log(
              `[trial ${rec.index}] ${rec.verdict} (claim ${rec.claim}, ${rec.steps} steps, $${rec.costUsd.toFixed(3)}, ${(rec.wallMs / 1000).toFixed(0)}s)`,
            );
            return rec;
          }),
        ),
      );
      if (budgetStopped) {
        notes.push(
          `Budget stop: cap $${maxUsd.toFixed(2)} or ${spec.budget.maxTotalMinutes} min reached; remaining trials were not run.`,
        );
      }
    }
  } finally {
    const leaked = pool.leaked;
    if (leaked.length > 0) {
      notes.push(`WARNING: ${leaked.length} session(s) not closed cleanly: ${leaked.join(", ")}`);
    }
    await pool.shutdown().catch(() => {});
  }

  const stats = computeStats(
    trials.filter((t) => t.verdict !== "budget_stopped"),
  );
  const gate = voided
    ? { passed: false, failures: ["run voided: positive control failed"] }
    : evaluateGate(stats, spec.gate);

  const report: RunReport = {
    runId,
    createdAt: new Date().toISOString(),
    spec,
    control,
    trials,
    stats,
    gate,
    voided,
    notes,
  };
  await writeFile(join(runDir, "run.json"), JSON.stringify(report, null, 2));
  return report;
}

function makeBudgetStopped(index: number): TrialRecord {
  return {
    index,
    role: "agent",
    adapter: "none",
    verdict: "budget_stopped",
    claim: "gave_up",
    steps: 0,
    checkResults: [],
    evidence: { dir: "", screenshots: [], attachments: [], events: 0 },
    wallMs: 0,
    costUsd: 0,
    sessionId: "",
  };
}
