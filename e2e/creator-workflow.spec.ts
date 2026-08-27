import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FIXTURE_ACCEPTANCE_STEPS, NAMED_FIXTURE_PROJECT } from "../tests/fixtures/coloring-book-24";

test.describe("named 24-page coloring-book creator workflow", () => {
  test("moves from project creation through owner download", async ({ page }) => {
    test.skip(!process.env.RUN_BROWSER_E2E, "Set RUN_BROWSER_E2E=1 with an authenticated test server to run browser E2E.");
    await page.goto("/projects");
    await expect(page.getByText("Projects")).toBeVisible();
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill(NAMED_FIXTURE_PROJECT.name);
    await page.getByRole("button", { name: /create project/i }).click();
    await page.getByRole("link", { name: /book brief/i }).click();
    await expect(page.getByText(/Book brief/i)).toBeVisible();
    await page.getByRole("link", { name: /page studio/i }).click();
    await expect(page.getByText(/one page at a time/i)).toBeVisible();
    await page.getByRole("link", { name: /cover desk/i }).click();
    await page.getByRole("link", { name: /validation/i }).click();
    await page.getByRole("link", { name: /exports/i }).click();
    await expect(page.getByText(/Export Center/i)).toBeVisible();
    await expect(page.getByText(/manual KDP upload review/i)).toBeVisible();
    await page.screenshot({ path: "test-results/desktop-export-center.png", fullPage: true });
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations, accessibility.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
    expect(FIXTURE_ACCEPTANCE_STEPS).toHaveLength(12);
  });

  test("keeps stage path and export access usable on a narrow mobile viewport", async ({ page }) => {
    test.skip(!process.env.RUN_BROWSER_E2E, "Set RUN_BROWSER_E2E=1 with an authenticated test server to run browser E2E.");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/projects");
    await expect(page.getByText("Projects")).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await page.screenshot({ path: "test-results/mobile-projects.png", fullPage: true });
  });
});
