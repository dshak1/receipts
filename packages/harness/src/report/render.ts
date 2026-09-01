import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunReport } from "../run/orchestrator.js";
import { fmtPct } from "../run/stats.js";
import { VERDICT_LABELS, type Verdict } from "../verify/types.js";

/**
 * RunReport -> self-contained static HTML written next to the evidence.
 * No framework, no build step, opens from disk: the report must survive being
 * zipped into a CI artifact and opened years later.
 */

const VERDICT_TONE: Record<Verdict, "good" | "warning" | "serious" | "critical" | "muted"> = {
  verified_success: "good",
  silent_success: "good",
  false_positive: "critical",
  agent_failure: "serious",
  timeout: "warning",
  env_error: "muted",
  budget_stopped: "muted",
};

const VERDICT_ICON: Record<Verdict, string> = {
  verified_success: "\u2713",
  silent_success: "\u2713",
  false_positive: "\u2717",
  agent_failure: "\u2717",
  timeout: "\u23f1",
  env_error: "\u26a0",
  budget_stopped: "\u25a0",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export async function renderReport(
  report: RunReport,
  runDir: string,
): Promise<{ indexHtml: string }> {
  const { stats, spec } = report;
  const claimedRate = stats.counted
    ? stats.claimedSuccesses / stats.counted
    : 0;
  const [lo, hi] = stats.wilson95;

  const trialCard = (t: RunReport["trials"][number], isControl = false) => {
    const tone = VERDICT_TONE[t.verdict];
    const shots = t.evidence.screenshots
      .map(
        (s, i) =>
          `<img loading="lazy" src="${esc(t.evidence.dir)}/${esc(s.file)}" alt="${esc(s.label)}" data-label="${esc(s.label)}" data-idx="${i}">`,
      )
      .join("");
    const checks = t.checkResults
      .map(
        (c) => `
        <tr>
          <td class="chk ${c.passed ? "pass" : "fail"}">${c.passed ? "\u2713 pass" : "\u2717 fail"}</td>
          <td>${esc(c.label)}</td>
          <td class="detail">${esc(c.detail)}</td>
        </tr>`,
      )
      .join("");
    return `
    <details class="trial tone-${tone}" ${isControl ? "data-control" : ""}>
      <summary>
        <span class="badge tone-${tone}">${VERDICT_ICON[t.verdict]} ${VERDICT_LABELS[t.verdict]}</span>
        <span class="tname">${isControl ? "Positive control (scripted)" : `Trial ${t.index}`}</span>
        <span class="claim">claimed <strong>${esc(t.claim)}</strong></span>
        <span class="meta">${t.steps} steps &middot; ${secs(t.wallMs)} &middot; $${t.costUsd.toFixed(3)}</span>
      </summary>
      ${t.claimReason ? `<p class="reason">Agent: &ldquo;${esc(t.claimReason)}&rdquo;</p>` : ""}
      ${t.error ? `<p class="reason err">Error: ${esc(t.error)}</p>` : ""}
      ${checks ? `<table class="checks"><thead><tr><th>Result</th><th>Check</th><th>Detail</th></tr></thead><tbody>${checks}</tbody></table>` : ""}
      ${shots ? `<div class="timeline">${shots}</div>` : ""}
      ${t.recordingFile ? `<p class="meta">Session recording: <code>${esc(t.evidence.dir)}/${esc(t.recordingFile)}</code> (rrweb NDJSON)</p>` : ""}
      <p class="meta">Solari session <code>${esc(t.sessionId)}</code></p>
    </details>`;
  };

  const falsePositiveCallout =
    stats.falsePositives > 0
      ? `<div class="callout critical">
           <strong>${stats.falsePositives} false positive${stats.falsePositives === 1 ? "" : "s"}:</strong>
           the agent reported success and independent verification disagreed.
           Open the red trials below to see the screenshot where it fooled itself.
         </div>`
      : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>receipts: ${esc(spec.id)}</title>
<style>
:root {
  color-scheme: light;
  --surface: #fcfcfb; --page: #f9f9f7;
  --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
  --good: #0ca30c; --good-text: #006300;
  --warning: #fab219; --serious: #ec835a; --critical: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --page: #0d0d0d;
    --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
    --good: #0ca30c; --good-text: #0ca30c;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --page: #0d0d0d;
  --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
  --good: #0ca30c; --good-text: #0ca30c;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--page); color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
header h1 { font-size: 20px; margin: 0 0 4px; }
header .goal { color: var(--ink-2); max-width: 70ch; }
header .runmeta { color: var(--muted); font-size: 12px; margin-top: 6px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 24px 0; }
.tile {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 14px 16px;
}
.tile .v { font-size: 28px; font-weight: 650; letter-spacing: -0.01em; }
.tile .l { color: var(--ink-2); font-size: 12px; margin-top: 2px; }
.tile .s { color: var(--muted); font-size: 11px; margin-top: 2px; }
.tile.hero-claim .v { color: var(--ink-2); }
.tile.hero-verified .v { color: var(--good-text); }
.tile.hero-verified.bad .v { color: var(--critical); }
.tile.hero-fp .v { color: var(--critical); }
.tile.hero-fp.zero .v { color: var(--good-text); }
.callout {
  border: 1px solid var(--border); border-left: 4px solid var(--critical);
  background: var(--surface); border-radius: 8px; padding: 12px 16px; margin: 16px 0;
}
.callout.void { border-left-color: var(--warning); }
.gate { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.gate .badge { font-size: 13px; }
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
  border: 1px solid var(--border); background: var(--surface);
}
.badge.tone-good { color: var(--good-text); }
.badge.tone-critical { color: var(--critical); }
.badge.tone-serious { color: var(--serious); }
.badge.tone-warning { color: var(--ink-2); }
.badge.tone-muted { color: var(--muted); }
section h2 { font-size: 15px; margin: 32px 0 10px; }
.trial {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; margin: 8px 0; overflow: hidden;
}
.trial summary {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 14px; cursor: pointer; list-style: none;
}
.trial summary::-webkit-details-marker { display: none; }
.trial[open] summary { border-bottom: 1px solid var(--grid); }
.trial .tname { font-weight: 600; }
.trial .claim { color: var(--ink-2); font-size: 13px; }
.trial .meta { color: var(--muted); font-size: 12px; margin-left: auto; }
.trial > p, .trial > table, .trial > .timeline { margin: 10px 14px; }
.reason { color: var(--ink-2); font-style: italic; }
.reason.err { color: var(--critical); font-style: normal; }
table.checks { border-collapse: collapse; width: calc(100% - 28px); font-size: 13px; }
table.checks th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 4px 8px; border-bottom: 1px solid var(--grid); }
table.checks td { padding: 6px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; }
table.checks .chk.pass { color: var(--good-text); white-space: nowrap; }
table.checks .chk.fail { color: var(--critical); white-space: nowrap; }
table.checks .detail { color: var(--ink-2); }
.timeline { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; }
.timeline img {
  height: 120px; border-radius: 6px; border: 1px solid var(--border);
  cursor: zoom-in; flex: 0 0 auto;
}
.notes li { color: var(--ink-2); }
footer { margin-top: 48px; color: var(--muted); font-size: 12px; }
footer a { color: inherit; }
#lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,0.85);
  display: none; align-items: center; justify-content: center; z-index: 10;
  flex-direction: column; gap: 10px; cursor: zoom-out;
}
#lightbox.open { display: flex; }
#lightbox img { max-width: 92vw; max-height: 86vh; border-radius: 8px; }
#lightbox .cap { color: #fff; font-size: 13px; }
code { font-size: 12px; }
</style>
</head>
<body>
<main>
<header>
  <h1>receipts &middot; ${esc(spec.id)}</h1>
  <div class="goal">${esc(spec.goal.trim())}</div>
  <div class="runmeta">
    run ${esc(report.runId)} &middot; ${esc(report.createdAt)} &middot;
    adapter ${esc(spec.agent.adapter)}${spec.agent.adapter === "computer-use" ? ` (${esc(spec.agent.model)})` : ""} &middot;
    ${stats.counted} counted trial${stats.counted === 1 ? "" : "s"} on Solari browsers
  </div>
</header>

<div class="tiles">
  <div class="tile hero-claim">
    <div class="v">${stats.claimedSuccesses}/${stats.counted}</div>
    <div class="l">agent claimed success</div>
  </div>
  <div class="tile hero-verified ${stats.verifiedRate < spec.gate.minVerifiedRate ? "bad" : ""}">
    <div class="v">${stats.verified}/${stats.counted}</div>
    <div class="l">independently verified</div>
    <div class="s">${fmtPct(stats.verifiedRate)}, 95% CI ${fmtPct(lo)} to ${fmtPct(hi)}</div>
  </div>
  <div class="tile hero-fp ${stats.falsePositives === 0 ? "zero" : ""}">
    <div class="v">${stats.falsePositives}</div>
    <div class="l">false positives</div>
    <div class="s">${fmtPct(stats.falsePositiveRate)} of success claims</div>
  </div>
  <div class="tile">
    <div class="v">$${stats.totalUsd.toFixed(2)}</div>
    <div class="l">total run cost</div>
    <div class="s">${secs(stats.totalWallMs)} of trial wall time</div>
  </div>
</div>

<p class="gate">Gate (min verified ${fmtPct(spec.gate.minVerifiedRate)}, max false-positive ${fmtPct(spec.gate.maxFalsePositiveRate)}):
  <span class="badge tone-${report.gate.passed ? "good" : "critical"}">${report.gate.passed ? "\u2713 PASS" : "\u2717 FAIL"}</span>
  ${report.gate.failures.length ? `<span style="color:var(--ink-2);font-weight:400">${esc(report.gate.failures.join("; "))}</span>` : ""}
</p>

${report.voided ? `<div class="callout void"><strong>Run voided.</strong> ${esc(report.notes[0] ?? "")}</div>` : falsePositiveCallout}

${report.control ? `<section><h2>Positive control</h2>${trialCard(report.control, true)}</section>` : ""}

<section>
  <h2>Trials</h2>
  ${report.trials.map((t) => trialCard(t)).join("\n")}
</section>

${report.notes.length && !report.voided ? `<section><h2>Notes</h2><ul class="notes">${report.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>` : ""}

<footer>
  Generated by <a href="https://github.com/dshak1/receipts">receipts</a>,
  reliability CI for computer-use agents, running on
  <a href="https://www.getsolari.com">Solari</a> cloud browsers.
  A claim of success is not an outcome; these are the receipts.
</footer>
</main>

<div id="lightbox"><img alt=""><div class="cap"></div></div>
<script id="run-data" type="application/json">${JSON.stringify(report).replace(/</g, "\\u003c")}</script>
<script>
(() => {
  const lb = document.getElementById("lightbox");
  const img = lb.querySelector("img");
  const cap = lb.querySelector(".cap");
  document.querySelectorAll(".timeline img").forEach((el) => {
    el.addEventListener("click", () => {
      img.src = el.src;
      cap.textContent = el.dataset.label || "";
      lb.classList.add("open");
    });
  });
  lb.addEventListener("click", () => lb.classList.remove("open"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") lb.classList.remove("open");
  });
})();
</script>
</body>
</html>
`;

  const indexHtml = join(runDir, "report.html");
  await writeFile(indexHtml, html);
  return { indexHtml };
}
