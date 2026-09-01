import { z } from "zod";

/**
 * TaskSpec is the single contract shared by the CLI, the runner, the
 * verifier, the report, and the GitHub Action. YAML on disk, zod here.
 */

export const viewportSchema = z.object({
  width: z.number().int().min(320).max(3840).default(1280),
  height: z.number().int().min(240).max(2160).default(800),
});

export const envSchema = z.object({
  kind: z.literal("browser"), // "desktop" and "sandbox" join in later weeks
  startUrl: z.string().url(),
  viewport: viewportSchema.default({ width: 1280, height: 800 }),
  recording: z.boolean().default(true),
  stealth: z.boolean().default(false),
});

export const agentSchema = z.object({
  adapter: z.enum(["scripted", "computer-use"]),
  // Model id for LLM adapters; ignored by scripted.
  model: z.string().default("claude-opus-5"),
  // Hard cap on agent steps. The primary cost control for LLM adapters.
  maxSteps: z.number().int().min(1).max(100).default(25),
  // Path to a TS module exporting `flow(page)` , relative to the spec file.
  // Required when adapter is "scripted", and for the positive control trial.
  scriptedFlow: z.string().optional(),
});

const checkBase = {
  // Optional checks inform the report but never gate the verdict.
  optional: z.boolean().default(false),
  // Short label shown in the report; defaults to a generated one.
  label: z.string().optional(),
};

export const urlCheckSchema = z.object({
  type: z.literal("url"),
  matches: z.string(), // substring or /regex/ against the final page URL
  ...checkBase,
});

export const domCheckSchema = z.object({
  type: z.literal("dom"),
  selector: z.string(),
  // At least one of these; all present must hold.
  exists: z.boolean().optional(),
  textContains: z.string().optional(),
  ...checkBase,
});

export const httpCheckSchema = z.object({
  type: z.literal("http"),
  method: z.enum(["GET", "POST"]).default("GET"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  expect: z.object({
    status: z.number().int().default(200),
    // Dot-path into the JSON body, e.g. "order.zip". Optional.
    jsonPath: z.string().optional(),
    equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    bodyContains: z.string().optional(),
  }),
  ...checkBase,
});

export const judgeCheckSchema = z.object({
  type: z.literal("judge"),
  rubric: z.string(),
  evidence: z
    .array(z.enum(["finalScreenshot", "actionLog"]))
    .default(["finalScreenshot", "actionLog"]),
  // advisory: annotates the report, never gates. required: counts as a check.
  weight: z.enum(["advisory", "required"]).default("advisory"),
  ...checkBase,
});

export const checkSchema = z.discriminatedUnion("type", [
  urlCheckSchema,
  domCheckSchema,
  httpCheckSchema,
  judgeCheckSchema,
]);

export const trialsSchema = z.object({
  n: z.number().int().min(1).max(100).default(10),
  concurrency: z.number().int().min(1).max(20).default(5),
  // Trial 0 always runs the scripted flow as a deterministic baseline.
  // If it fails, the whole run is voided as ENV_ERROR: the environment is
  // broken and the agent was never actually judged.
  positiveControl: z.boolean().default(true),
});

export const timeoutsSchema = z.object({
  trialSeconds: z.number().int().min(10).max(1800).default(180),
  stepSeconds: z.number().int().min(5).max(300).default(30),
});

export const budgetSchema = z.object({
  // Estimated LLM + browser spend at which remaining trials are aborted.
  maxUsd: z.number().min(0).default(3),
  maxTotalMinutes: z.number().min(1).default(20),
});

export const gateSchema = z.object({
  minVerifiedRate: z.number().min(0).max(1).default(0.8),
  maxFalsePositiveRate: z.number().min(0).max(1).default(0.1),
});

export const taskSpecSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case id"),
  goal: z.string().min(1),
  env: envSchema,
  agent: agentSchema,
  checks: z.array(checkSchema).min(1),
  trials: trialsSchema.default({}),
  timeouts: timeoutsSchema.default({}),
  budget: budgetSchema.default({}),
  gate: gateSchema.default({}),
});

export type Viewport = z.infer<typeof viewportSchema>;
export type EnvSpec = z.infer<typeof envSchema>;
export type AgentSpec = z.infer<typeof agentSchema>;
export type UrlCheck = z.infer<typeof urlCheckSchema>;
export type DomCheck = z.infer<typeof domCheckSchema>;
export type HttpCheck = z.infer<typeof httpCheckSchema>;
export type JudgeCheck = z.infer<typeof judgeCheckSchema>;
export type Check = z.infer<typeof checkSchema>;
export type TaskSpec = z.infer<typeof taskSpecSchema>;

/** A gating check is any non-optional check that is not an advisory judge. */
export function isGating(check: Check): boolean {
  if (check.optional) return false;
  if (check.type === "judge") return check.weight === "required";
  return true;
}
