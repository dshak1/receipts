import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import { taskSpecSchema, type TaskSpec } from "./schema.js";

export interface LoadedSpec {
  spec: TaskSpec;
  /** Absolute path of the spec file; scriptedFlow resolves relative to it. */
  specPath: string;
  specDir: string;
}

export async function loadSpec(path: string): Promise<LoadedSpec> {
  const specPath = resolve(path);
  const raw = await readFile(specPath, "utf8");
  const parsed = YAML.parse(raw);
  const result = taskSpecSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid task spec ${specPath}:\n${issues}`);
  }
  const spec = result.data;
  if (
    (spec.agent.adapter === "scripted" || spec.trials.positiveControl) &&
    !spec.agent.scriptedFlow
  ) {
    throw new Error(
      `Spec ${spec.id}: agent.scriptedFlow is required when adapter is "scripted" or trials.positiveControl is true`,
    );
  }
  return { spec, specPath, specDir: dirname(specPath) };
}

export function resolveFlowPath(loaded: LoadedSpec): string | undefined {
  const flow = loaded.spec.agent.scriptedFlow;
  return flow ? resolve(loaded.specDir, flow) : undefined;
}
