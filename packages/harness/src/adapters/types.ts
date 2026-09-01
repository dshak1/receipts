import type { Page } from "patchright-core";
import type { TaskSpec } from "../spec/schema.js";
import type { EvidenceCollector } from "../evidence/collector.js";
import type { AgentClaim } from "../verify/types.js";

export interface TrialContext {
  runId: string;
  trialIndex: number;
  spec: TaskSpec;
  page: Page;
  sessionId: string;
  evidence: EvidenceCollector;
  signal: AbortSignal;
  /** Absolute path to the scripted flow module, when the spec has one. */
  flowPath?: string;
}

export interface AgentResult {
  claim: AgentClaim;
  claimReason?: string;
  steps: number;
  usage?: { inputTokens: number; outputTokens: number; usd: number };
}

export interface AgentAdapter {
  readonly name: string;
  run(ctx: TrialContext): Promise<AgentResult>;
}
