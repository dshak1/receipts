import type { Page } from "patchright-core";
import type { Check, DomCheck, HttpCheck, UrlCheck } from "../spec/schema.js";
import type { CheckResult } from "./types.js";

function label(check: Check, fallback: string): string {
  return check.label ?? fallback;
}

export async function runUrlCheck(
  page: Page,
  check: UrlCheck,
): Promise<CheckResult> {
  const start = Date.now();
  const url = page.url();
  const isRegex = check.matches.startsWith("/") && check.matches.endsWith("/");
  const passed = isRegex
    ? new RegExp(check.matches.slice(1, -1)).test(url)
    : url.includes(check.matches);
  return {
    check,
    label: label(check, `URL contains "${check.matches}"`),
    passed,
    detail: passed
      ? `final URL ${url} matches "${check.matches}"`
      : `final URL ${url} does not match "${check.matches}"`,
    evidenceRefs: [],
    durationMs: Date.now() - start,
  };
}

export async function runDomCheck(
  page: Page,
  check: DomCheck,
): Promise<CheckResult> {
  const start = Date.now();
  const loc = page.locator(check.selector);
  const count = await loc.count().catch(() => 0);
  const exists = count > 0;

  let passed: boolean;
  let detail: string;
  if (!exists) {
    passed = check.exists === false;
    detail = passed
      ? `selector "${check.selector}" absent, as required`
      : `selector "${check.selector}" not found on final page`;
  } else if (check.exists === false) {
    passed = false;
    detail = `selector "${check.selector}" present but required absent`;
  } else if (check.textContains !== undefined) {
    const text = (await loc.first().innerText().catch(() => "")).trim();
    passed = text.includes(check.textContains);
    detail = passed
      ? `"${check.selector}" text contains "${check.textContains}"`
      : `"${check.selector}" text is "${text.slice(0, 120)}", missing "${check.textContains}"`;
  } else {
    passed = true;
    detail = `selector "${check.selector}" present (${count} match${count === 1 ? "" : "es"})`;
  }
  return {
    check,
    label: label(check, `DOM ${check.selector}`),
    passed,
    detail,
    evidenceRefs: [],
    durationMs: Date.now() - start,
  };
}

function jsonPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.replace(/^\$\.?/, "").split(".").filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Side-effect probe: hit an endpoint OUTSIDE the browser session and verify
 * the real-world consequence of the task (the order exists, the lead landed).
 * This is the check that catches "the page said thank you but nothing was
 * recorded".
 */
export async function runHttpCheck(check: HttpCheck): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(check.url, {
      method: check.method,
      ...(check.headers ? { headers: check.headers } : {}),
      ...(check.body ? { body: check.body } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const bodyText = await res.text();
    const problems: string[] = [];
    if (res.status !== check.expect.status) {
      problems.push(`status ${res.status}, expected ${check.expect.status}`);
    }
    if (check.expect.bodyContains !== undefined && !bodyText.includes(check.expect.bodyContains)) {
      problems.push(`body missing "${check.expect.bodyContains}"`);
    }
    if (check.expect.jsonPath !== undefined) {
      let value: unknown;
      try {
        value = jsonPath(JSON.parse(bodyText), check.expect.jsonPath);
      } catch {
        problems.push("body is not JSON");
      }
      if (check.expect.equals !== undefined && value !== check.expect.equals) {
        problems.push(
          `${check.expect.jsonPath} is ${JSON.stringify(value)}, expected ${JSON.stringify(check.expect.equals)}`,
        );
      } else if (check.expect.equals === undefined && value === undefined) {
        problems.push(`${check.expect.jsonPath} not present in body`);
      }
    }
    const passed = problems.length === 0;
    return {
      check,
      label: label(check, `HTTP probe ${check.method} ${new URL(check.url).pathname}`),
      passed,
      detail: passed
        ? `probe returned ${res.status} and matched expectations`
        : problems.join("; "),
      evidenceRefs: [],
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      check,
      label: label(check, `HTTP probe ${check.method}`),
      passed: false,
      detail: `probe failed: ${err instanceof Error ? err.message : String(err)}`,
      evidenceRefs: [],
      durationMs: Date.now() - start,
    };
  }
}
