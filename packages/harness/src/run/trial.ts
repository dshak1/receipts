import { ScriptedAdapter } from "../adapters/scripted.js";
import { ComputerUseAdapter } from "../adapters/computer-use.js";
import type { AgentAdapter, AgentResult } from "../adapters/types.js";
import { EvidenceCollector, type EvidenceManifest } from "../evidence/collector.js";
import type { LoadedSpec } from "../spec/load.js";
import { resolveFlowPath } from "../spec/load.js";
import { verifyAll } from "../verify/index.js";
import type { AgentClaim, CheckResult, Verdict } from "../verify/types.js";
import { decideVerdict } from "../verify/verdict.js";
import type { SolariPool } from "./session.js";

export interface TrialRecord {
  index: number;
  role: "control" | "agent";
  adapter: string;
  verdict: Verdict;
  claim: AgentClaim;
  claimReason?: string;
  steps: number;
  checkResults: CheckResult[];
  evidence: EvidenceManifest;
  wallMs: number;
  costUsd: number;
  sessionId: string;
  recordingFile?: string;
  error?: string;
}

function pickAdapter(name: string): AgentAdapter {
  switch (name) {
    case "scripted":
      return new ScriptedAdapter();
    case "computer-use":
      return new ComputerUseAdapter();
    default:
      throw new Error(`unknown adapter: ${name}`);
  }
}

export interface TrialOptions {
  runId: string;
  runDir: string;
  index: number;
  role: "control" | "agent";
  loaded: LoadedSpec;
  pool: SolariPool;
}

/**
 * One trial, end to end: session up, agent runs, final screenshot, checks,
 * verdict, evidence finalized, session released. Never throws; every failure
 * mode maps onto a verdict so the orchestrator's aggregation stays total.
 */
export async function runTrial(opts: TrialOptions): Promise<TrialRecord> {
  const { loaded, pool, index, role } = opts;
  const spec = loaded.spec;
  const started = Date.now();
  const trialDirName = `trial-${String(index).padStart(3, "0")}`;
  const evidence = new EvidenceCollector(opts.runDir, trialDirName);
  await evidence.init();

  const adapterName = role === "control" ? "scripted" : spec.agent.adapter;
  const adapter = pickAdapter(adapterName);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    spec.timeouts.trialSeconds * 1000,
  );

  let costUsd = 0;
  let sessionId = "";
  let verdict: Verdict;
  let claim: AgentClaim = "gave_up";
  let claimReason: string | undefined;
  let steps = 0;
  let checkResults: CheckResult[] = [];
  let errorMsg: string | undefined;

  await evidence.event({
    t: new Date().toISOString(),
    kind: "trial_start",
    detail: `trial ${index} (${role}, adapter ${adapterName})`,
  });

  let session;
  try {
    session = await pool.openSession(spec.env);
  } catch (err) {
    // Could not even get a browser: infrastructure fault, not agent fault.
    clearTimeout(timer);
    errorMsg = `session launch failed: ${err instanceof Error ? err.message : String(err)}`;
    await evidence.event({ t: new Date().toISOString(), kind: "error", detail: errorMsg });
    const manifest = await evidence.finalize();
    return {
      index,
      role,
      adapter: adapterName,
      verdict: "env_error",
      claim,
      steps,
      checkResults,
      evidence: manifest,
      wallMs: Date.now() - started,
      costUsd,
      sessionId: "",
      error: errorMsg,
    };
  }

  sessionId = session.id;
  let finalShotJpeg: Buffer | undefined;
  try {
    const { page } = session;
    await page.goto(spec.env.startUrl, {
      timeout: spec.timeouts.stepSeconds * 1000,
      waitUntil: "domcontentloaded",
    });
    await evidence.screenshot(
      "start",
      await page.screenshot({ type: "jpeg", quality: 60 }),
    );

    const flowPath = resolveFlowPath(loaded);
    let agentResult: AgentResult;
    try {
      agentResult = await adapter.run({
        runId: opts.runId,
        trialIndex: index,
        spec,
        page,
        sessionId,
        evidence,
        signal: controller.signal,
        ...(flowPath ? { flowPath } : {}),
      });
    } catch (err) {
      // Adapter blew up (SDK error, page crash): env_error, not agent_failure.
      throw new Error(
        `adapter crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    claim = agentResult.claim;
    if (agentResult.claimReason !== undefined) claimReason = agentResult.claimReason;
    steps = agentResult.steps;
    costUsd += agentResult.usage?.usd ?? 0;

    finalShotJpeg = await page.screenshot({ type: "jpeg", quality: 70 });
    await evidence.screenshot("final", finalShotJpeg);

    checkResults = await verifyAll(spec, page, evidence, finalShotJpeg, (usd) => {
      costUsd += usd;
    });

    verdict = controller.signal.aborted
      ? "timeout"
      : decideVerdict(claim, checkResults);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    await evidence.event({ t: new Date().toISOString(), kind: "error", detail: errorMsg });
    verdict = controller.signal.aborted ? "timeout" : "env_error";
  } finally {
    clearTimeout(timer);
    await session.close().catch(() => {});
  }

  // Recording uploads asynchronously after release; harvest it into evidence.
  let recordingFile: string | undefined;
  if (spec.env.recording) {
    const replay = await pool
      .downloadReplay(sessionId, { attempts: 8, delayMs: 3000 })
      .catch(() => undefined);
    if (replay) {
      recordingFile = await evidence.attach("replay.ndjson", replay);
    }
  }

  await evidence.event({
    t: new Date().toISOString(),
    kind: "trial_end",
    detail: `verdict ${verdict} (claim ${claim})`,
  });
  const manifest = await evidence.finalize();

  return {
    index,
    role,
    adapter: adapterName,
    verdict,
    claim,
    ...(claimReason !== undefined ? { claimReason } : {}),
    steps,
    checkResults,
    evidence: manifest,
    wallMs: Date.now() - started,
    costUsd,
    sessionId,
    ...(recordingFile !== undefined ? { recordingFile } : {}),
    ...(errorMsg !== undefined ? { error: errorMsg } : {}),
  };
}
