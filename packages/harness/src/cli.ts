#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { loadSpec } from "./spec/load.js";
import { runSuite } from "./run/orchestrator.js";
import { renderReport } from "./report/render.js";
import { fmtPct } from "./run/stats.js";
import { recoverJournal, SolariPool } from "./run/session.js";
import { preflightAnthropic } from "./adapters/providers/anthropic.js";

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
  const needsAnthropic =
    loaded.spec.agent.adapter === "computer-use" ||
    loaded.spec.checks.some((check) => check.type === "judge");
  if (needsAnthropic) {
    try {
      await preflightAnthropic();
    } catch (err) {
      throw new Error(
        `Anthropic preflight failed before any Solari sessions were opened: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
  await writeGitHubIntegration(report, indexHtml);

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

async function writeGitHubIntegration(
  report: Awaited<ReturnType<typeof runSuite>>,
  reportPath: string,
): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    await appendFile(
      output,
      [
        `run_id=${report.runId}`,
        `verified_rate=${report.stats.verifiedRate}`,
        `false_positive_rate=${report.stats.falsePositiveRate}`,
        `gate_passed=${report.gate.passed}`,
        `report_path=${reportPath}`,
        "",
      ].join("\n"),
    );
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    await appendFile(
      summary,
      [
        "## receipts reliability gate",
        "",
        `**${report.gate.passed ? "PASS" : "FAIL"}** for \`${report.spec.id}\``,
        "",
        "| Metric | Result |",
        "| --- | ---: |",
        `| Verified | ${report.stats.verified}/${report.stats.counted} (${fmtPct(report.stats.verifiedRate)}) |`,
        `| False positives | ${report.stats.falsePositives} (${fmtPct(report.stats.falsePositiveRate)} of success claims) |`,
        `| Cost | $${report.stats.totalUsd.toFixed(2)} |`,
        `| Run | \`${report.runId}\` |`,
        "",
        report.gate.failures.length
          ? `Gate failures: ${report.gate.failures.join("; ")}`
          : "Every configured gate passed.",
        "",
      ].join("\n"),
    );
  }
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
  .command("doctor")
  .description("validate provider auth and one recorded Solari browser lifecycle")
  .option("-o, --out <dir>", "directory for the crash journal", "runs")
  .action(async (flags: { out: string }) => {
    const apiKey = requireApiKey();
    process.stdout.write("Anthropic credentials... ");
    await preflightAnthropic();
    console.log("ok");
    process.stdout.write("Solari launch, navigation, screenshot, release... ");
    const pool = new SolariPool(apiKey, resolve(flags.out, ".active-sessions.json"));
    let session;
    let replay = false;
    try {
      session = await pool.openSession({
        kind: "browser",
        startUrl: "https://example.com",
        viewport: { width: 1280, height: 800 },
        recording: true,
        stealth: false,
      });
      await session.page.goto("https://example.com", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await session.page.screenshot({ type: "jpeg", quality: 40 });
      const id = session.id;
      await session.close();
      session = undefined;
      replay = Boolean(
        await pool.downloadReplay(id, { attempts: 8, delayMs: 2_000 }),
      );
    } finally {
      await session?.close().catch(() => {});
      await pool.shutdown().catch(() => {});
    }
    console.log(replay ? "ok (replay captured)" : "ok (replay still processing)");
  });

program
  .command("recover")
  .description("release sessions recorded in a local crash journal")
  .option("-o, --out <dir>", "run output root containing the journal", "runs")
  .action(async (flags: { out: string }) => {
    const journal = resolve(flags.out ?? "runs", ".active-sessions.json");
    const result = await recoverJournal(requireApiKey(), journal);
    console.log(`journal sessions: ${result.found}`);
    console.log(`released:         ${result.released}`);
    if (result.failed.length > 0) {
      console.error(`failed:           ${result.failed.length}`);
      process.exitCode = 1;
    }
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
