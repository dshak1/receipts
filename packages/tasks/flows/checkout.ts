import type { Page } from "patchright-core";

/**
 * Deterministic baseline for demo-checkout. If this cannot complete the
 * flow, the environment is broken and no agent should be judged against it.
 */
export async function flow(page: Page): Promise<string> {
  await page.fill("#user-name", "standard_user");
  await page.fill("#password", "secret_sauce");
  await page.click("#login-button");
  await page.click("#add-to-cart-sauce-labs-backpack");
  await page.click(".shopping_cart_link");
  await page.click("#checkout");
  await page.fill("#first-name", "Jane");
  await page.fill("#last-name", "Doe");
  await page.fill("#postal-code", "94105");
  await page.click("#continue");
  await page.click("#finish");
  await page.waitForSelector(".complete-header", { timeout: 10_000 });
  return "completed checkout to the confirmation page";
}
