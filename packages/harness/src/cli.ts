#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { loadSpec } from "./spec/load.js";
import { runSuite } from "./run/orchestrator.js";
import { renderReport } from "./report/render.js";
import { fmtPct } from "./run/stats.js";

const program = new Command();
program
  .name("receipts")
  .description(
    "Reliability CI for computer-use agents. Run the task N times on Solari, verify every outcome independently, get a verdict you can defend.",
  );

function requireApiKey(): string {
  const key = process.env.SOLARI_API_KEY;
  if (!key) {
    console.error(
      "SOLARI_API_KEY is not set. Get a key at console.getsolari.com and export it.",
    );
    process.exit(2);
  }
  return key;
}

interface RunFlags {
  out: string;
  trials?: string;
  concurrency?: string;
  budgetUsd?: string;
}

async function doRun(specPath: string, flags: RunFlags, gateMode: boolean) {
  const apiKey = requireApiKey();
  const loaded = await loadSpec(specPath);
  const overrides = {
    ...(flags.trials !== undefined ? { n: Number(flags.trials) } : {}),
    ...(flags.concurrency !== undefined
      ? { concurrency: Number(flags.concurrency) }
      : {}),
    ...(flags.budgetUsd !== undefined ? { maxUsd: Number(flags.budgetUsd) } : {}),
  };
  const report = await runSuite({
    loaded,
    outRoot: resolve(flags.out),
    apiKey,
    overrides,
    log: (line) => console.log(line),
  });
  const { indexHtml } = await renderReport(report, resolve(flags.out, report.runId));

  const s = report.stats;
  console.log("");
  console.log(`run:       ${report.runId}`);
  console.log(`claimed:   ${s.claimedSuccesses}/${s.counted} successes`);
  console.log(
    `verified:  ${s.verified}/${s.counted} (${fmtPct(s.verifiedRate)}, 95% CI ${fmtPct(s.wilson95[0])} to ${fmtPct(s.wilson95[1])})`,
  );
  console.log(
    `false pos: ${s.falsePositives} (${fmtPct(s.falsePositiveRate)} of success claims)`,
  );
  console.log(`cost:      $${s.totalUsd.toFixed(2)}`);
  console.log(`report:    ${indexHtml}`);
  for (const note of report.notes) console.log(`note:      ${note}`);
  console.log(
    `gate:      ${report.gate.passed ? "PASS" : `FAIL (${report.gate.failures.join("; ")})`}`,
  );
  if (gateMode && !report.gate.passed) process.exit(1);
}

program
  .command("run")
  .description("run the suite and write evidence + report (never fails the process)")
  .argument("<spec>", "path to the task spec YAML")
  .option("-o, --out <dir>", "output root for run bundles", "runs")
  .option("-n, --trials <n>", "override trials.n")
  .option("-c, --concurrency <n>", "override trials.concurrency")
  .option("--budget-usd <usd>", "override budget.maxUsd")
  .action(async (spec: string, flags: RunFlags) => doRun(spec, flags, false));

program
  .command("gate")
  .description("run the suite and exit 1 if the gate fails (CI mode)")
  .argument("<spec>", "path to the task spec YAML")
  .option("-o, --out <dir>", "output root for run bundles", "runs")
  .option("-n, --trials <n>", "override trials.n")
  .option("-c, --concurrency <n>", "override trials.concurrency")
  .option("--budget-usd <usd>", "override budget.maxUsd")
  .action(async (spec: string, flags: RunFlags) => doRun(spec, flags, true));

program
  .command("report")
  .description("re-render the HTML report from an existing run.json")
  .argument("<runDir>", "path to a run directory containing run.json")
  .action(async (runDir: string) => {
    const abs = resolve(runDir);
    const report = JSON.parse(await readFile(resolve(abs, "run.json"), "utf8"));
    const { indexHtml } = await renderReport(report, abs);
    console.log(`report: ${indexHtml}`);
  });

program
  .command("sweep")
  .description("list and release any Solari sessions this key still holds")
  .action(async () => {
    requireApiKey();
    // The browser SDK exposes sessions via the client; import lazily so the
    // other commands do not pay for it.
    const { Solari } = await import("@solarisdk/browser");
    const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! });
    try {
      const sessions = await (
        solari as unknown as {
          sessions: { list(): Promise<{ id: string; status: string }[]> };
        }
      ).sessions.list();
      const active = sessions.filter((s) => s.status === "active" || s.status === "running");
      if (active.length === 0) {
        console.log("no active sessions.");
        return;
      }
      for (const s of active) {
        console.log(`releasing ${s.id} (${s.status})`);
        await (
          solari as unknown as {
            sessions: { release(id: string): Promise<void> };
          }
        ).sessions.release(s.id).catch((err: unknown) => {
          console.error(`  failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } finally {
      await solari.close();
    }
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
