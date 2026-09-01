import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "patchright-core";
import { anthropicClient, estimateUsd } from "./providers/anthropic.js";
import type { AgentAdapter, AgentResult, TrialContext } from "./types.js";
import type { AgentClaim } from "../verify/types.js";

/**
 * Computer-use adapter: Claude drives the Solari browser page through the
 * computer toolset (screenshot, click, type, ...), mapped onto Playwright.
 *
 * The agent must end by calling report_result. What it reports there is its
 * CLAIM; the harness verifies independently afterward. That separation is the
 * whole point of this tool.
 */

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_result",
  description:
    "Report the final outcome of the task. Call this exactly once, as your last action, after verifying on screen what you can.",
  input_schema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        enum: ["success", "failure", "gave_up"],
        description:
          "success only if you completed the goal; failure if you tried and it did not work; gave_up if you stopped early.",
      },
      reason: { type: "string", description: "One-sentence justification." },
    },
    required: ["status", "reason"],
    additionalProperties: false,
  },
  strict: true,
};

interface ComputerUseInput {
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  scroll_direction?: "up" | "down" | "left" | "right";
  scroll_amount?: number;
  duration?: number;
  region?: [number, number, number, number];
  repeat?: number;
}

/** Map X11-style key names the toolset emits onto Playwright key names. */
function mapKey(text: string): string {
  const table: Record<string, string> = {
    Return: "Enter",
    KP_Enter: "Enter",
    BackSpace: "Backspace",
    space: " ",
    Escape: "Escape",
    Tab: "Tab",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    Page_Up: "PageUp",
    Page_Down: "PageDown",
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    super: "Meta",
    ctrl: "Control",
    alt: "Alt",
    shift: "Shift",
  };
  return text
    .split("+")
    .map((part) => table[part] ?? (part.length === 1 ? part : part))
    .join("+");
}

async function executeAction(
  page: Page,
  name: string,
  input: ComputerUseInput,
): Promise<{ text?: string; imagePng?: Buffer }> {
  switch (name) {
    case "screenshot":
      return { imagePng: await page.screenshot({ type: "png" }) };
    case "zoom": {
      if (!input.region) throw new Error("zoom requires region");
      const [x0, y0, x1, y1] = input.region;
      return {
        imagePng: await page.screenshot({
          type: "png",
          clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        }),
      };
    }
    case "left_click": {
      const [x, y] = input.coordinate ?? [0, 0];
      await page.mouse.click(x, y);
      return { text: "OK" };
    }
    case "double_click": {
      const [x, y] = input.coordinate ?? [0, 0];
      await page.mouse.click(x, y, { clickCount: 2 });
      return { text: "OK" };
    }
    case "triple_click": {
      const [x, y] = input.coordinate ?? [0, 0];
      await page.mouse.click(x, y, { clickCount: 3 });
      return { text: "OK" };
    }
    case "right_click": {
      const [x, y] = input.coordinate ?? [0, 0];
      await page.mouse.click(x, y, { button: "right" });
      return { text: "OK" };
    }
    case "middle_click": {
      const [x, y] = input.coordinate ?? [0, 0];
      await page.mouse.click(x, y, { button: "middle" });
      return { text: "OK" };
    }
    case "left_click_drag": {
      const [sx, sy] = input.start_coordinate ?? [0, 0];
      const [ex, ey] = input.coordinate ?? [0, 0];
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(ex, ey, { steps: 10 });
      await page.mouse.up();
      return { text: "OK" };
    }
    case "mouse_move": {
      const [x, y] = input.coordinate ?? [0, 0];
      await page.mouse.move(x, y);
      return { text: "OK" };
    }
    case "left_mouse_down":
      await page.mouse.down();
      return { text: "OK" };
    case "left_mouse_up":
      await page.mouse.up();
      return { text: "OK" };
    case "scroll": {
      const amount = (input.scroll_amount ?? 3) * 100;
      const dir = input.scroll_direction ?? "down";
      const [dx, dy] =
        dir === "down" ? [0, amount] : dir === "up" ? [0, -amount] : dir === "right" ? [amount, 0] : [-amount, 0];
      if (input.coordinate) {
        const [x, y] = input.coordinate;
        await page.mouse.move(x, y);
      }
      await page.mouse.wheel(dx, dy);
      return { text: "OK" };
    }
    case "type":
      await page.keyboard.type(input.text ?? "");
      return { text: "OK" };
    case "key": {
      const key = mapKey(input.text ?? "");
      const repeat = input.repeat ?? 1;
      for (let i = 0; i < repeat; i++) await page.keyboard.press(key);
      return { text: "OK" };
    }
    case "hold_key": {
      const key = mapKey(input.text ?? "");
      await page.keyboard.down(key);
      await page.waitForTimeout((input.duration ?? 1) * 1000);
      await page.keyboard.up(key);
      return { text: "OK" };
    }
    case "wait":
      await page.waitForTimeout((input.duration ?? 1) * 1000);
      return { text: "OK" };
    case "cursor_position":
      return { text: "unknown" };
    default:
      throw new Error(`unsupported computer action: ${name}`);
  }
}

export class ComputerUseAdapter implements AgentAdapter {
  readonly name = "computer-use";

  async run(ctx: TrialContext): Promise<AgentResult> {
    const client = anthropicClient();
    const { spec, page, evidence } = ctx;
    const model = spec.agent.model;

    const system =
      `You are operating a web browser to complete a task. ` +
      `The browser is already open at the starting page. ` +
      `Viewport is ${spec.env.viewport.width}x${spec.env.viewport.height}. ` +
      `Take a screenshot first to see the current state. Work efficiently; ` +
      `you have at most ${spec.agent.maxSteps} steps. When done (or stuck), ` +
      `call report_result exactly once with your honest assessment.\n\n` +
      `Task: ${spec.goal}`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Begin the task now." },
    ];
    const tools: Anthropic.ToolUnion[] = [
      { type: "computer_toolset_20260801" } as unknown as Anthropic.ToolUnion,
      REPORT_TOOL,
    ];

    let inputTokens = 0;
    let outputTokens = 0;
    let steps = 0;
    let claim: AgentClaim = "gave_up";
    let claimReason: string | undefined;

    outer: for (let turn = 0; turn < spec.agent.maxSteps; turn++) {
      if (ctx.signal.aborted) break;
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system,
        messages,
        tools,
      });
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let failedInBatch = false;

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        if (block.name === "report_result") {
          const input = block.input as { status: AgentClaim; reason: string };
          claim = input.status;
          claimReason = input.reason;
          await evidence.event({
            t: new Date().toISOString(),
            kind: "agent_claim",
            detail: `${input.status}: ${input.reason}`,
          });
          break outer;
        }

        steps++;
        const toolsetName = (block as { toolset_name?: string }).toolset_name;
        if (failedInBatch) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Not executed: an earlier computer action in this turn failed.",
            is_error: true,
            ...(toolsetName ? { toolset_name: toolsetName } : {}),
          } as Anthropic.ToolResultBlockParam);
          continue;
        }
        try {
          const input = block.input as ComputerUseInput;
          await evidence.event({
            t: new Date().toISOString(),
            kind: "agent_step",
            detail: `${block.name} ${JSON.stringify(input).slice(0, 200)}`,
          });
          const result = await executeAction(page, block.name, input);
          if (result.imagePng) {
            // Keep the evidence trail in JPEG (small) but hand PNG to the model.
            await evidence.screenshot(
              `step-${steps}-${block.name}`,
              await page.screenshot({ type: "jpeg", quality: 60 }),
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: result.imagePng.toString("base64"),
                  },
                },
              ],
              ...(toolsetName ? { toolset_name: toolsetName } : {}),
            } as Anthropic.ToolResultBlockParam);
          } else {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result.text ?? "OK",
              ...(toolsetName ? { toolset_name: toolsetName } : {}),
            } as Anthropic.ToolResultBlockParam);
          }
        } catch (err) {
          failedInBatch = true;
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
            ...(toolsetName ? { toolset_name: toolsetName } : {}),
          } as Anthropic.ToolResultBlockParam);
        }
      }

      if (toolResults.length === 0) {
        // Model stopped acting without reporting; treat its text as giving up.
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join(" ");
        claim = "gave_up";
        claimReason = text.slice(0, 300) || "stopped without report_result";
        break;
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (claim === "gave_up" && claimReason === undefined) {
      claimReason = `hit maxSteps (${spec.agent.maxSteps}) without report_result`;
    }

    return {
      claim,
      ...(claimReason !== undefined ? { claimReason } : {}),
      steps,
      usage: {
        inputTokens,
        outputTokens,
        usd: estimateUsd(model, inputTokens, outputTokens),
      },
    };
  }
}
