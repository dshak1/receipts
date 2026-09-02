# Solari / Receipts handoff

This is the working context for the next agent. Repository: https://github.com/dshak1/receipts
Branch: `main`. Latest commits: `8df4f1c`, `d5591c8`, `7e0942b`.

## Product

Receipts is reliability CI for computer-use agents. It runs a task repeatedly in isolated Solari
browsers, verifies the result independently of the agent's claim, classifies the outcome, and emits
a self-contained evidence report with screenshots, checks, replay, cost, and confidence intervals.

The key product principle is: a positive control proves the task/environment is viable before agent
trials are judged; `false_positive` is the important failure mode.

## What is shipped

- Solari session pool with concurrency backoff, crash journal, atomic journal persistence, and
  `recover` cleanup.
- Run metadata: schema version, git SHA, spec digest, elapsed time, requested concurrency, status.
- Anthropic preflight and optional workspace header support via `ANTHROPIC_WORKSPACE_ID`.
- SHA-256 public session references, embedded screenshots, rrweb replay player, verdict filtering,
  claim-to-reality gap visualization, and `evidence-manifest.json` digests.
- `receipts run`, `gate`, `report`, `doctor`, and `recover` CLI commands.
- GitHub Action in `action.yml` plus CI typecheck/test/build/audit/package checks.
- GitHub Pages landing page: https://dshak1.github.io/receipts/

## Landing page redesign

The React/Vite source is under `site/`; Vite builds into `docs/` with base `/receipts/`.

- Three supplied CloudFront MP4s are used as hero sources.
- Ten scene options: three source videos plus seven color treatments.
- Three surface recipes: Glass, Line, Dense.
- Components are source-owned shadcn/ui patterns: Button, Card, Badge, Tabs.
- Motion is adapted from React Bits BlurText.
- Exact provenance links and run commands: `site/README.md`.
- Do not describe the fixture report as a real provider run. The public copy intentionally avoids
  fabricated customer, success, or cost claims.

## Run locally

```bash
cd /mnt/c/Users/dshakimov/Downloads/receipts
npm ci
npm run check
npm run site:build
npm run site:dev -- --host 0.0.0.0
```

For provider work, use environment variables only; never commit them:

```bash
export SOLARI_API_KEY='...'
export ANTHROPIC_API_KEY='...'
export ANTHROPIC_WORKSPACE_ID='...' # required for identity-linked Anthropic keys
npm run cli --workspace packages/harness -- doctor
```

The Solari API key supplied during the previous session authenticated successfully, but the
account's free-plan concurrency cap was 3. The identity-linked Anthropic key still needs a valid
Console workspace ID; the local Claude config organization UUID is not necessarily that workspace
ID. `doctor` should fail before opening an agent session when this is missing.

## Immediate next work

1. Obtain the valid Anthropic Console workspace ID, run `doctor`, then run one positive-control
   agent trial and capture a replay.
2. Run the full requested suite at concurrency 3 (or lower if the account cap changes).
3. Review the generated report and replace any remaining fixture/demo language only with evidence
   from the live run.
4. Rotate the credentials that were pasted into the prior chat.

## Original transcript

The prior Claude Code session is locally recorded at:

`/home/dshakimov/.claude/projects/-mnt-c-Users-dshakimov-Downloads-knowledge-base/a04baaa0-040a-493d-870f-ef76194848b3.jsonl`

It is a local JSONL transcript, not checked into GitHub because it may contain sensitive context.
