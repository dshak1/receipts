import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
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

  const allTrials = report.control
    ? [report.control, ...report.trials]
    : report.trials;
  const assets = new Map<
    number,
    { screenshots: string[]; replay?: unknown[] }
  >();
  for (const trial of allTrials) {
    const screenshots = await Promise.all(
      trial.evidence.screenshots.map(async (shot) => {
        const bytes = await readFile(join(runDir, trial.evidence.dir, shot.file));
        return `data:image/jpeg;base64,${bytes.toString("base64")}`;
      }),
    );
    let replay: unknown[] | undefined;
    if (trial.recordingFile) {
      const raw = await readFile(
        join(runDir, trial.evidence.dir, trial.recordingFile),
        "utf8",
      ).catch(() => "");
      if (raw) {
        replay = raw
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      }
    }
    assets.set(trial.index, { screenshots, ...(replay ? { replay } : {}) });
  }

  const require = createRequire(import.meta.url);
  const playerRoot = dirname(dirname(require.resolve("rrweb-player")));
  const [playerJs, playerCss] = await Promise.all([
    readFile(join(playerRoot, "umd/rrweb-player.min.js"), "utf8"),
    readFile(join(playerRoot, "dist/style.min.css"), "utf8"),
  ]);

  const trialCard = (t: RunReport["trials"][number], isControl = false) => {
    const tone = VERDICT_TONE[t.verdict];
    const embedded = assets.get(t.index);
    const shots = t.evidence.screenshots
      .map(
        (s, i) =>
          `<figure><img loading="lazy" src="${embedded?.screenshots[i] ?? ""}" alt="${esc(s.label)}" data-label="${esc(s.label)}" data-idx="${i}"><figcaption>${esc(s.label)}</figcaption></figure>`,
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
    <details class="trial tone-${tone}" data-verdict="${t.verdict}" ${isControl ? "data-control" : ""}>
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
      ${embedded?.replay ? `<div class="replay-row"><button class="replay-button" data-replay="replay-${t.index}">▶ Watch recorded session</button><span>rrweb replay embedded in this report</span></div><script type="application/json" id="replay-${t.index}">${JSON.stringify(embedded.replay).replace(/</g, "\\u003c")}</script>` : ""}
      <p class="session-ref">Evidence session <code>${esc(t.sessionId)}</code></p>
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
${playerCss}
:root {
  color-scheme: light;
  --surface: #fcfcfb; --page: #f9f9f7;
  --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
  --good: #1a9b62; --good-text: #087647;
  --warning: #e8a317; --serious: #ec835a; --critical: #d64045;
  --accent: #6c5ce7; --accent-soft: #eeebff;
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
main { max-width: 1080px; margin: 0 auto; padding: 28px 20px 80px; }
.brand { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:54px; }
.wordmark { font-weight:800; letter-spacing:-.04em; font-size:18px; }
.powered { color:var(--muted); font-size:12px; }
.eyebrow { color:var(--accent); font-size:12px; font-weight:750; letter-spacing:.12em; text-transform:uppercase; }
header h1 { font-size: clamp(32px, 6vw, 58px); line-height:1.02; letter-spacing:-.055em; margin: 10px 0 18px; max-width: 850px; }
header .goal { color: var(--ink-2); max-width: 70ch; }
header .runmeta { color: var(--muted); font-size: 12px; margin-top: 6px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 24px 0; }
.tile {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 14px 16px;
}
.gap-card { margin:18px 0 28px; padding:18px; border:1px solid var(--border); border-radius:14px; background:var(--surface); }
.gap-head { display:flex; justify-content:space-between; gap:16px; align-items:end; margin-bottom:12px; }
.gap-head strong { font-size:16px; }
.gap-track { display:flex; height:16px; border-radius:999px; overflow:hidden; background:var(--grid); }
.gap-verified { background:var(--good); }
.gap-false { background:var(--critical); }
.gap-rest { background:var(--grid); }
.legend { display:flex; flex-wrap:wrap; gap:14px; margin-top:10px; color:var(--ink-2); font-size:12px; }
.dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; }
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
.timeline figure { margin:0; flex:0 0 auto; }
.timeline img {
  height: 120px; border-radius: 6px; border: 1px solid var(--border);
  cursor: zoom-in; flex: 0 0 auto;
}
.timeline figcaption { color:var(--muted); font-size:11px; margin-top:4px; max-width:180px; }
.filters { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
.filter, .replay-button { border:1px solid var(--border); background:var(--surface); color:var(--ink); border-radius:999px; padding:7px 12px; cursor:pointer; font:inherit; font-size:12px; font-weight:650; }
.filter.active { color:#fff; background:var(--ink); }
.replay-row { display:flex; align-items:center; gap:10px; margin:14px; color:var(--muted); font-size:12px; }
.replay-button { color:#fff; background:var(--accent); border-color:transparent; }
.session-ref { color:var(--muted); font-size:11px; }
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
#replay-modal { position:fixed; inset:0; display:none; z-index:20; background:rgba(0,0,0,.88); padding:20px; }
#replay-modal.open { display:grid; place-items:center; }
.replay-shell { width:min(100%, 1040px); max-height:94vh; overflow:auto; background:#111; border-radius:12px; padding:14px; }
.replay-close { float:right; margin-bottom:10px; border:0; color:#fff; background:#333; border-radius:999px; padding:7px 12px; cursor:pointer; }
#replay-target { clear:both; display:flex; justify-content:center; min-height:200px; }
code { font-size: 12px; }
@media (max-width:600px) {
  .brand { margin-bottom:34px; }
  .tiles { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .tile .v { font-size:23px; }
  .trial .meta { margin-left:0; width:100%; }
  .timeline img { height:100px; }
}
</style>
</head>
<body>
<main>
<div class="brand"><span class="wordmark">receipts</span><span class="powered">Reliability CI · powered by Solari</span></div>
<header>
  <div class="eyebrow">Independent agent verification</div>
  <h1>Your agent made a claim.<br>Here is what actually happened.</h1>
  <div class="goal">${esc(spec.goal.trim())}</div>
  <div class="runmeta">
    ${esc(spec.id)} &middot; run ${esc(report.runId)} &middot; ${esc(report.createdAt)} &middot;
    adapter ${esc(spec.agent.adapter)}${spec.agent.adapter === "computer-use" ? ` (${esc(spec.agent.model)})` : ""} &middot;
    ${stats.counted} counted trial${stats.counted === 1 ? "" : "s"} on Solari browsers &middot; concurrency ${report.requestedConcurrency ?? spec.trials.concurrency}
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

<div class="gap-card">
  <div class="gap-head"><strong>The claim-to-reality gap</strong><span>${stats.falsePositives} false positive${stats.falsePositives === 1 ? "" : "s"}</span></div>
  <div class="gap-track" role="img" aria-label="${stats.verified} verified, ${stats.falsePositives} false positives, ${Math.max(0, stats.counted - stats.verified - stats.falsePositives)} other outcomes">
    <span class="gap-verified" style="width:${stats.counted ? (stats.verified / stats.counted) * 100 : 0}%"></span>
    <span class="gap-false" style="width:${stats.counted ? (stats.falsePositives / stats.counted) * 100 : 0}%"></span>
    <span class="gap-rest" style="flex:1"></span>
  </div>
  <div class="legend"><span><i class="dot" style="background:var(--good)"></i>independently verified</span><span><i class="dot" style="background:var(--critical)"></i>claimed success, verification failed</span><span><i class="dot" style="background:var(--grid)"></i>other outcome</span></div>
</div>

<p class="gate">Gate (min verified ${fmtPct(spec.gate.minVerifiedRate)}, max false-positive ${fmtPct(spec.gate.maxFalsePositiveRate)}):
  <span class="badge tone-${report.gate.passed ? "good" : "critical"}">${report.gate.passed ? "\u2713 PASS" : "\u2717 FAIL"}</span>
  ${report.gate.failures.length ? `<span style="color:var(--ink-2);font-weight:400">${esc(report.gate.failures.join("; "))}</span>` : ""}
</p>

${report.voided ? `<div class="callout void"><strong>Run voided.</strong> ${esc(report.notes[0] ?? "")}</div>` : falsePositiveCallout}

${report.control ? `<section><h2>Positive control</h2>${trialCard(report.control, true)}</section>` : ""}

<section>
  <h2>Trials</h2>
  <div class="filters"><button class="filter active" data-filter="all">All</button><button class="filter" data-filter="false_positive">False positives</button><button class="filter" data-filter="verified_success">Verified</button><button class="filter" data-filter="agent_failure">Failures</button><button class="filter" data-filter="env_error">Environment</button></div>
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
<div id="replay-modal"><div class="replay-shell"><button class="replay-close">Close replay</button><div id="replay-target"></div></div></div>
<script id="run-data" type="application/json">${JSON.stringify(report).replace(/</g, "\\u003c")}</script>
<script>${playerJs.replace(/<\/script/gi, "<\\/script")}</script>
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
  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      const filter = button.dataset.filter;
      document.querySelectorAll(".trial:not([data-control])").forEach((trial) => {
        trial.hidden = filter !== "all" && trial.dataset.verdict !== filter;
      });
    });
  });
  const replayModal = document.getElementById("replay-modal");
  const replayTarget = document.getElementById("replay-target");
  const closeReplay = () => { replayModal.classList.remove("open"); replayTarget.replaceChildren(); };
  document.querySelector(".replay-close").addEventListener("click", closeReplay);
  replayModal.addEventListener("click", (event) => { if (event.target === replayModal) closeReplay(); });
  document.querySelectorAll(".replay-button").forEach((button) => {
    button.addEventListener("click", () => {
      const source = document.getElementById(button.dataset.replay);
      const events = JSON.parse(source.textContent);
      replayModal.classList.add("open");
      new rrwebPlayer({ target: replayTarget, props: { events, width: Math.min(960, window.innerWidth - 70), height: Math.min(620, window.innerHeight - 150), autoPlay: false } });
    });
  });
})();
</script>
</body>
</html>
`;

  const indexHtml = join(runDir, "report.html");
  await writeFile(indexHtml, html);
  const files = await listFiles(runDir);
  const manifest = await Promise.all(
    files
      .filter((file) => file !== "evidence-manifest.json")
      .map(async (file) => {
        const bytes = await readFile(join(runDir, file));
        return {
          file,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
  );
  await writeFile(
    join(runDir, "evidence-manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        runId: report.runId,
        generatedAt: new Date().toISOString(),
        files: manifest,
      },
      null,
      2,
    ),
  );
  return { indexHtml };
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative ? join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}
