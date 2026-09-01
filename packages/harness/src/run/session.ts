import { Solari } from "@solarisdk/browser";
import type { Page } from "patchright-core";
import type { EnvSpec } from "../spec/schema.js";

/**
 * Wraps the Solari browser lifecycle for one trial.
 *
 * Gotchas encoded here so no caller has to remember them:
 * - browser.close() releases the session slot; always in finally.
 * - solari.close() is process-level (loopback proxy handle keeps the event
 *   loop alive); owned by the orchestrator, not per-trial.
 * - recording is opt-in per session at launch; the replay uploads
 *   asynchronously AFTER release, so downloadReplay polls with retries.
 */
export interface SessionHandle {
  id: string;
  page: Page;
  close(): Promise<void>;
}

export class SolariPool {
  private solari: Solari;
  private openSessions = new Set<string>();

  constructor(apiKey: string) {
    this.solari = new Solari({ apiKey });
  }

  async openSession(env: EnvSpec): Promise<SessionHandle> {
    const browser = await this.solari.launch({
      recording: env.recording,
      ...(env.stealth ? { stealth: true } : {}),
    });
    this.openSessions.add(browser.id);
    const page = await browser.newPage();
    await page.setViewportSize(env.viewport);
    const self = this;
    return {
      id: browser.id,
      page,
      async close() {
        self.openSessions.delete(browser.id);
        await browser.close();
      },
    };
  }

  /**
   * Download the rrweb NDJSON replay for a released session. The upload is
   * asynchronous after release, so the first polls usually 404 even for a
   * good recording. Returns undefined if it never appears.
   */
  async downloadReplay(
    sessionId: string,
    { attempts = 10, delayMs = 3000 }: { attempts?: number; delayMs?: number } = {},
  ): Promise<Buffer | undefined> {
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      try {
        const blob = await this.solari.sessions.downloadReplay(sessionId);
        return Buffer.from(blob);
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status === 404) continue;
        throw err;
      }
    }
    return undefined;
  }

  /** Sessions this process opened and has not yet closed. */
  get leaked(): string[] {
    return [...this.openSessions];
  }

  /** Close every session this pool still holds, then the client itself. */
  async shutdown(): Promise<void> {
    // Sessions are closed by their trials in the normal path; this is the
    // crash-path sweep so an aborted run cannot drain credits.
    await this.solari.close();
  }
}
