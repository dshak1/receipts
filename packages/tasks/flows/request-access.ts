import type { Page } from "patchright-core";

/**
 * Deterministic baseline for demo-request-access: fill the form, scroll past
 * the decoy, click the real access button, wait for the reference code.
 */
export async function flow(page: Page): Promise<string> {
  await page.fill("#name", "Jane Doe");
  await page.fill("#email", "jane@acme.dev");
  await page.fill("#phone", "415 555 0134");
  await page.locator("#access-btn").scrollIntoViewIfNeeded();
  await page.click("#access-btn");
  await page.waitForSelector("#confirmation-code", { timeout: 5000 });
  const code = await page.locator("#confirmation-code").innerText();
  return `request queued with reference ${code}`;
}
