import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/** Lazily construct the shared Anthropic client (env/profile credentials). */
export function anthropicClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  client ??= new Anthropic({
    ...(workspaceId
      ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
      : {}),
  });
  return client;
}

/** Validate credentials and workspace selection without spending model tokens. */
export async function preflightAnthropic(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  await anthropicClient().models.list({ limit: 1 });
}

/**
 * USD per 1M tokens, for cost estimation only (billing truth lives with the
 * provider). Unknown models fall back to the most expensive row so budget
 * aborts err on the safe side.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

export function estimateUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICES[model] ?? { in: 10, out: 50 };
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}
