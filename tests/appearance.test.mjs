import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { baseline, serve } from "./helpers.mjs";

test("首頁與主題頁提供實際閱讀起點及可持續的外觀選擇", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ["/", "/academy/"]) {
    const { directory, result } = await baseline(t, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
    });
    await page.goto(url);
    assert.match(await page.locator("h1").textContent(), /工程與技術/);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").textContent(), "跳至內容");
    assert.equal(await page.locator(".topic-row").count(), 6);
    assert.match(
      await page.locator(".topic-start").first().textContent(),
      /從 認識 Linux 開始/,
    );
    await page.locator(".topic-start").first().click();
    assert.equal(new URL(page.url()).pathname, `${base}linux/what-is-linux/`);
    await page.goto(url);
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.getByLabel("外觀", { exact: true }).selectOption("light");
    await page.reload();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "light",
    );
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
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "light",
    );
    assert.equal(
      await page
        .locator("h1")
        .evaluate((node) => getComputedStyle(node).animationName),
      "none",
    );
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["", "linux/"]) {
        await page.goto(url + route);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `${base}${route}@${width}`,
        );
        assert.equal(
          await page.evaluate(
            () =>
              document.fonts.check('16px "Academy Sans"') &&
              document.fonts.check('700 24px "Academy Grotesk"'),
          ),
          true,
        );
        if (route)
          assert.deepEqual(
            (
              await page
                .locator('nav[aria-label="本主題文件"] ol a')
                .allTextContents()
            ).slice(0, 3),
            ["認識 Linux", "終端與 Shell", "檔案與目錄"],
          );
      }
    }
    await page.setViewportSize({ width: 390, height: 664 });
    await page
      .getByLabel("切換主題", { exact: true })
      .selectOption(`${base}api/`);
    await page.waitForURL("**/api/");
    assert.match(await page.locator("h1").textContent(), /API/);
    await page.close();
  }
});
