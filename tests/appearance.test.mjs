import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { topics } from "../src/utils/urls.ts";
import { sampleBaseline, sampleDocsRoot, serve } from "./helpers.mjs";
import { h1Of, readingOrder } from "./sample-content.mjs";

const base = "/academy/";

test("首頁與主題頁提供實際閱讀起點及可持續的外觀選擇", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const order = await readingOrder();
  const { directory } = await sampleBaseline(t);
  const url = await serve(t, directory, base);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  await page.goto(url);
  assert.match(await page.locator("h1").textContent(), /工程與技術/);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").textContent(), "跳至內容");
  assert.equal(await page.locator(".topic-row").count(), topics.length);
  assert.equal(
    (await page.locator(".topic-start").first().textContent()).trim(),
    `從 ${order[0].title} 開始`,
  );
  await page.locator(".topic-start").first().click();
  assert.equal(new URL(page.url()).pathname, base + order[0].route);
  await page.goto(url);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByLabel("外觀", { exact: true }).selectOption("light");
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.getByLabel("外觀", { exact: true }).focus();
  assert.notEqual(
    await page
      .locator(":focus")
      .evaluate((node) => getComputedStyle(node).outlineStyle),
    "none",
  );
  await page.getByLabel("外觀", { exact: true }).selectOption("system");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.equal(
    await page
      .locator("h1")
      .evaluate((node) => getComputedStyle(node).animationName),
    "none",
  );
  await page.goto(url + "linux/");
  assert.deepEqual(
    await page.locator('nav[aria-label="本主題文件"] ol a').allTextContents(),
    order.map((article) => article.title),
  );
  await page.setViewportSize({ width: 390, height: 664 });
  const chooser = page.getByLabel("切換主題", { exact: true });
  const apiName = await chooser.locator(`option[value="${base}api/"]`).textContent();
  await chooser.selectOption(`${base}api/`);
  await page.waitForURL("**/api/");
  assert.equal(await page.locator("h1").textContent(), apiName);
  assert.match(await h1Of(path.join(sampleDocsRoot, "api/README.md")), new RegExp("^" + apiName));
  await page.close();
});
