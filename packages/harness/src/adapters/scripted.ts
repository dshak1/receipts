import { pathToFileURL } from "node:url";
import type { Page } from "patchright-core";
import type { AgentAdapter, AgentResult, TrialContext } from "./types.js";

export interface ScriptedFlowModule {
  /**
   * A deterministic Playwright flow. Throwing means the flow failed. The
   * return value, if any, becomes the claim reason.
   */
  flow(page: Page): Promise<string | void>;
}

/**
 * The deterministic baseline adapter. Also runs as trial 0 (the positive
 * control): if a hand-written Playwright flow cannot complete the task, the
 * environment is broken and no agent should be judged against it.
 */
export class ScriptedAdapter implements AgentAdapter {
  readonly name = "scripted";

  async run(ctx: TrialContext): Promise<AgentResult> {
    if (!ctx.flowPath) {
      throw new Error(
        `Spec ${ctx.spec.id}: scripted adapter requires agent.scriptedFlow`,
      );
    }
    const mod = (await import(
      pathToFileURL(ctx.flowPath).href
    )) as ScriptedFlowModule;
    if (typeof mod.flow !== "function") {
      throw new Error(`${ctx.flowPath} does not export a flow(page) function`);
    }
    try {
      const reason = await mod.flow(ctx.page);
      return {
        claim: "success",
        ...(reason ? { claimReason: reason } : {}),
        steps: 1,
      };
    } catch (err) {
      return {
        claim: "failure",
        claimReason: err instanceof Error ? err.message : String(err),
        steps: 1,
      };
    }
  }
}
