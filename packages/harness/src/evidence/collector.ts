import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

export interface TrialEvent {
  t: string; // ISO timestamp
  kind:
    | "trial_start"
    | "agent_step"
    | "agent_claim"
    | "check"
    | "screenshot"
    | "error"
    | "trial_end";
  detail: string;
  data?: Record<string, unknown>;
}

export interface EvidenceManifest {
  dir: string; // run-relative trial dir, e.g. "trial-003"
  screenshots: { file: string; label: string; t: string }[];
  attachments: string[];
  events: number;
}

/**
 * Append-only evidence for one trial. Layout under the run dir:
 *   trial-NNN/
 *     events.jsonl     append-only action log
 *     shot-NNN-<label>.jpg
 *     <attachments>
 *     manifest.json
 */
export class EvidenceCollector {
  private shotIndex = 0;
  private screenshots: EvidenceManifest["screenshots"] = [];
  private attachments: string[] = [];
  private eventCount = 0;
  private readonly absDir: string;

  constructor(
    private readonly runDir: string,
    private readonly trialDirName: string,
  ) {
    this.absDir = join(runDir, trialDirName);
  }

  async init(): Promise<void> {
    await mkdir(this.absDir, { recursive: true });
  }

  async screenshot(label: string, data: Buffer): Promise<string> {
    const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const file = `shot-${String(this.shotIndex++).padStart(3, "0")}-${safe}.jpg`;
    await writeFile(join(this.absDir, file), data);
    const t = new Date().toISOString();
    this.screenshots.push({ file, label, t });
    await this.event({ t, kind: "screenshot", detail: label, data: { file } });
    return file;
  }

  async event(e: TrialEvent): Promise<void> {
    this.eventCount++;
    await appendFile(join(this.absDir, "events.jsonl"), JSON.stringify(e) + "\n");
  }

  async attach(name: string, data: Buffer | string): Promise<string> {
    await writeFile(join(this.absDir, name), data);
    this.attachments.push(name);
    return name;
  }

  async finalize(): Promise<EvidenceManifest> {
    const manifest: EvidenceManifest = {
      dir: this.trialDirName,
      screenshots: this.screenshots,
      attachments: this.attachments,
      events: this.eventCount,
    };
    await writeFile(
      join(this.absDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    return manifest;
  }

  get dir(): string {
    return this.absDir;
  }
}
