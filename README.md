# receipts

**Reliability CI for computer-use agents.** Run the task N times on [Solari](https://www.getsolari.com) cloud browsers, verify every outcome independently of what the agent claims, and get a verdict you can defend.

> The agent made a claim. The verifier checked reality.

[Open the live demo target](https://dshak1.github.io/receipts/demo-target/) · [View the source](https://github.com/dshak1/receipts) · [Run it in CI](#github-action)

[Open the product landing page](https://dshak1.github.io/receipts/) · [Landing design handoff](site/README.md)

[Agent handoff](HANDOFF-SOLARI.md) — implementation status, commands, provenance, and next steps.

> Your agent said it succeeded. Did it? Show me the receipts.

## The problem

Computer-use agents report successes they did not have. They see a toast that says "Thanks!", click the wrong button that looks right, or stop at a page that resembles done, and then report success with full confidence. A demo that works once tells you nothing; a claim of success is not an outcome.

Teams shipping browser agents need the same thing game studios and hardware labs have had for decades: run it many times, verify results independently of the thing under test, separate environment failures from real failures, and gate releases on the numbers.

## What it does

One YAML task spec in, one evidence-backed verdict out:

1. **Trial 0 is a positive control.** A deterministic Playwright flow proves the task is completable and the environment is healthy. If the control fails, the run is voided: the agent was never judged, because there was nothing fair to judge it against.
2. **N parallel trials on Solari browsers.** Fresh, hardware-isolated Chrome per trial, booting in about a second, with session recording on. Twenty trials of a three-minute task cost about a dollar of browser time. This is only practical because Solari browsers are fast and cheap to launch in parallel.
3. **The agent reports its claim; the harness verifies the outcome.** Deterministic checks (final URL, DOM state, HTTP side-effect probes against the real backend) decide the verdict. An LLM judge annotates from evidence but does not gate by default.
4. **Typed verdicts, not pass/fail.** The interesting row is `false_positive`: the agent claimed success and independent verification disagreed.
5. **A self-contained HTML report** with per-trial screenshot timelines, check results, agent claims in its own words, rrweb session recordings, cost, and a Wilson 95% confidence interval on the verified success rate.
6. **A CI gate.** `receipts gate spec.yaml` exits nonzero when the verified rate drops below your threshold or the false-positive rate rises above it.

## Verdicts

| Verdict | Meaning |
|---|---|
| `verified_success` | claimed success, all gating checks passed |
| `false_positive` | claimed success, verification disagreed. The money row. |
| `silent_success` | claimed failure, but the checks passed |
| `agent_failure` | claimed failure, and it was |
| `env_error` | infrastructure fault; excluded from the denominator |
| `timeout` / `budget_stopped` | ran out of time or budget |

`env_error` exclusion is licensed by the positive control: if a scripted flow completes the task, an infrastructure excuse is real, not cover.

## Quickstart

```bash
git clone https://github.com/dshak1/receipts
cd receipts && npm install

export SOLARI_API_KEY=slr_live_...      # console.getsolari.com
export ANTHROPIC_API_KEY=sk-ant-...     # for the computer-use adapter and judge
# Identity-linked Anthropic keys also need their Console workspace ID.
export ANTHROPIC_WORKSPACE_ID=...       # omit for ordinary API keys

# 10 trials of a checkout flow, 5 in parallel, with a scripted control
npm run cli --workspace packages/harness -- run ../tasks/demo-checkout.yaml
```

Open `runs/<run-id>/report.html` when it finishes. The report embeds screenshots and an rrweb replay player, so it remains useful when downloaded as one file. The evidence directory also contains `run.json`, per-trial `events.jsonl`, recordings, and `evidence-manifest.json` with SHA-256 digests.

## Task spec

```yaml
id: demo-checkout
goal: >
  Log in, add the Sauce Labs Backpack to the cart, and complete checkout.
  You are done when the page says "Thank you for your order!".

env:
  kind: browser
  startUrl: https://www.saucedemo.com

agent:
  adapter: computer-use        # or "scripted"
  maxSteps: 25                 # the primary cost control
  scriptedFlow: flows/checkout.ts

checks:                        # all run; optional ones never gate
  - type: url
    matches: "checkout-complete"
  - type: dom
    selector: ".complete-header"
    textContains: "Thank you for your order"
  - type: http                 # side-effect probe: did the order actually land?
    url: https://api.example.com/orders/latest
    expect: { status: 200, jsonPath: "$.zip", equals: "94105" }
    optional: true
  - type: judge                # LLM judge, advisory by default
    rubric: Did the run end on an order confirmation page?

trials:
  n: 20
  concurrency: 3
  positiveControl: true

budget:
  maxUsd: 5                    # abort remaining trials past this estimate

gate:
  minVerifiedRate: 0.8
  maxFalsePositiveRate: 0.1
```

## Commands

| Command | What it does |
|---|---|
| `receipts run <spec>` | run the suite, write evidence and the report |
| `receipts gate <spec>` | same, but exit 1 when the gate fails (CI mode) |
| `receipts report <runDir>` | re-render the HTML report from run.json |
| `receipts doctor` | validate provider auth and one recorded Solari browser lifecycle |
| `receipts recover` | release sessions left in the local crash journal |

## GitHub Action

Add the action after `actions/checkout` and provide the two provider keys as repository secrets:

```yaml
- uses: dshak1/receipts@main
  with:
    spec: tasks/demo-request-access.yaml
    trials: 20
    concurrency: 3
  env:
    SOLARI_API_KEY: ${{ secrets.SOLARI_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    ANTHROPIC_WORKSPACE_ID: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}
```

The action writes verified rate, false-positive rate, gate status, and the report path to GitHub outputs and uploads the complete evidence bundle as an artifact.

## Why Solari

The harness is a statistics machine, and statistics need samples. Samples are only affordable when a real Chrome boots in milliseconds, costs cents per hour, runs twenty-wide without a queue, and records itself. That is exactly the Solari browser product, so the harness is built on it, with desktops (full Linux VMs) and sandbox snapshot forking on the roadmap below.

## Roadmap

- Desktop trials: the same spec against a Solari Linux VM for full computer use, with the live VNC stream linked from each trial
- Hosted report gallery with shareable permalinks
- OpenAI computer-use adapter behind the same `AgentAdapter` seam
- Model vs model benchmark: verified success rate, false-positive rate, and cost per verified success across CUA models on one task suite
- Best-of-N branching on Solari sandbox snapshot forks: checkpoint before a risky step, fork the attempt, keep the verified winner
- MCP server exposing `run_reliability_check` so any agent can order its own audit

## What makes a result trustworthy

Every run records the task-spec digest and git SHA, starts with a scripted positive control, runs deterministic checks independently of the agent claim, keeps advisory model judging separate from gating checks, and leaves a recoverable session journal. Environment failures are not silently converted into agent failures.

## Origins

Built for the [Solari](https://github.com/solari-sdk/solari-cookbook) build challenge by [Diar Shakimov](https://github.com/dshak1). The methodology (positive controls, flake rates as a property of the script, typed verdicts, evidence bundles) comes from production experience running automated reliability testing against a AAA game client, where "the tool reported a success it did not have" is a bug family with a name.

MIT licensed.

## Landing design provenance

The landing page uses the three supplied CloudFront motion studies as its hero source material,
with ten selectable scene treatments and three surface recipes. Its Button, Card, Tabs, and BlurText
interactions are documented source-owned patterns from [shadcn/ui](https://ui.shadcn.com/docs/components)
and [React Bits](https://reactbits.dev/text-animations/blur-text); exact links and implementation
notes live in [`site/README.md`](site/README.md). The visual composition and Receipts tokens are
custom to this project. The public surface intentionally uses fixture language where a provider
run has not yet been completed.
