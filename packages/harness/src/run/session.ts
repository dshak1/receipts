import { Solari, SolariError } from "@solarisdk/browser";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
  private journalWrite: Promise<void> = Promise.resolve();

  constructor(
    apiKey: string,
    private readonly journalPath?: string,
  ) {
    this.solari = new Solari({ apiKey });
  }

  private async persistJournal(): Promise<void> {
    if (!this.journalPath) return;
    this.journalWrite = this.journalWrite.then(async () => {
      await mkdir(dirname(this.journalPath!), { recursive: true });
      const temp = `${this.journalPath}.${process.pid}.tmp`;
      await writeFile(
        temp,
        JSON.stringify(
          {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            sessions: [...this.openSessions],
          },
          null,
          2,
        ),
      );
      await rename(temp, this.journalPath!);
    });
    await this.journalWrite;
  }

  async openSession(env: EnvSpec): Promise<SessionHandle> {
    const deadline = Date.now() + 45_000;
    let attempt = 0;
    let browser;
    for (;;) {
      try {
        browser = await this.solari.launch({
          recording: env.recording,
          ...(env.stealth ? { stealth: true } : {}),
        });
        break;
      } catch (err) {
        if (
          !(err instanceof SolariError) ||
          err.code !== "ConcurrencyLimitExceeded" ||
          Date.now() >= deadline
        ) {
          throw err;
        }
        const delay = Math.min(750 * 2 ** attempt++, 5_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    this.openSessions.add(browser.id);
    await this.persistJournal();
    let page: Page;
    try {
      page = await browser.newPage();
      await page.setViewportSize(env.viewport);
    } catch (err) {
      await browser.close().catch(() => {});
      this.openSessions.delete(browser.id);
      await this.persistJournal();
      throw err;
    }
    const self = this;
    return {
      id: browser.id,
      page,
      async close() {
        await browser.close();
        self.openSessions.delete(browser.id);
        await self.persistJournal();
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
    // Sessions are closed by their trials in the normal path; the journal is
    // the crash-path recovery mechanism when an aborted process cannot close.
    await this.solari.close();
  }
}

export interface RecoveryResult {
  found: number;
  released: number;
  failed: { id: string; error: string }[];
}

/** Release sessions left in the local crash journal by an interrupted run. */
export async function recoverJournal(
  apiKey: string,
  journalPath: string,
): Promise<RecoveryResult> {
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(await readFile(journalPath, "utf8")) as {
      sessions?: unknown;
    };
    if (Array.isArray(parsed.sessions)) {
      ids = parsed.sessions.filter((id): id is string => typeof id === "string");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { found: 0, released: 0, failed: [] };
    throw err;
  }

  const solari = new Solari({ apiKey });
  const failed: RecoveryResult["failed"] = [];
  let released = 0;
  try {
    for (const id of ids) {
      try {
        await solari.sessions.releaseAndWait(id);
        released++;
      } catch (err) {
        failed.push({
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await solari.close();
  }

  await mkdir(dirname(journalPath), { recursive: true });
  await writeFile(
    journalPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        sessions: failed.map((entry) => entry.id),
      },
      null,
      2,
    ),
  );
  return { found: ids.length, released, failed };
}
