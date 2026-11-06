import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { topics } from "../src/utils/urls.ts";
import { baseline, sampleBaseline, sampleDocsRoot, serve } from "./helpers.mjs";
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
  assert.equal(await page.locator(".paper-cover").count(), topics.length);
  const desktopSizes = await page.locator(".topic-row").first().evaluate(card => ({
    title: parseFloat(getComputedStyle(card.querySelector(".topic-name")).fontSize),
    summary: parseFloat(getComputedStyle(card.querySelector(".topic-description")).fontSize),
  }));
  assert.ok(desktopSizes.title >= 24 && desktopSizes.summary >= 16, "desktop cards retain readable type");
  await page.locator(".topic-start").first().hover();
  assert.equal(await page.locator(".topic-start").first().evaluate(node => getComputedStyle(node).textDecorationLine), "none");
  assert.equal(await page.locator(".reading-label").first().evaluate(node => getComputedStyle(node).textDecorationLine), "none");
  await page.setViewportSize({ width: 360, height: 780 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "mobile home has no page overflow");
  assert.ok(await page.locator(".topic-start").first().evaluate(node => node.getBoundingClientRect().height >= 44), "reading entry retains touch target");
  await page.setViewportSize({ width: 1440, height: 900 });
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

test("API 主題與文件的概念圖解在各種外觀下保持可讀", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const { directory } = await baseline(t);
  const url = await serve(t, directory);
  const page = await browser.newPage({ colorScheme: "light" });

  for (const route of ["api/", "api/resources-representations-and-messages/"]) {
    await page.goto(url + route);
    const figure = page.locator("figure.concept-diagram");
    const diagram = figure.getByRole("img");
    assert.equal(await diagram.isVisible(), true, route);
    assert.match(await diagram.getAttribute("aria-label"), /\S.{5,}/u);
    assert.match(await figure.locator("figcaption").textContent(), /\S.{5,}/u);

    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      const sizes = await diagram.locator("text").evaluateAll(nodes => nodes.map(node => {
        const matrix = node.getScreenCTM();
        return parseFloat(getComputedStyle(node).fontSize) * Math.hypot(matrix.a, matrix.b);
      }));
      assert.ok(sizes.every(size => size >= 14), `${route} at ${width}px: rendered label sizes ${sizes}`);
      if (route === "api/") {
        const heights = await page.locator('nav[aria-label="本主題文件"] h2 a').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
        assert.ok(heights.every(height => height >= 44), `${width}px: document touch targets >=44px`);
      }
    }

    for (const choice of ["light", "dark", "system"]) {
      await page.getByLabel("外觀", { exact: true }).selectOption(choice);
      await page.reload();
      assert.equal(await page.getByLabel("外觀", { exact: true }).inputValue(), choice);
      const schemes = choice === "system" ? ["light", "dark"] : [choice];
      for (const scheme of schemes) {
        if (choice === "system") await page.emulateMedia({ colorScheme: scheme });
        await page.waitForFunction(
          (theme) => document.documentElement.dataset.theme === theme,
          scheme,
        );
        const labels = await diagram.evaluate((svg) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          const rgba = (color) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
          };
          const over = (front, back) => [
            ...front.slice(0, 3).map((channel, index) =>
              channel * front[3] / 255 + back[index] * (1 - front[3] / 255)),
            255,
          ];
          const luminance = (color) => color.slice(0, 3).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
          let surface = [255, 255, 255, 255];
          const ancestors = [];
          for (let node = svg; node; node = node.parentElement) ancestors.unshift(node);
          for (const node of ancestors) surface = over(rgba(getComputedStyle(node).backgroundColor), surface);
          return [...svg.querySelectorAll("text")].map((text) => {
            const bounds = text.getBoundingClientRect();
            const x = bounds.x + bounds.width / 2;
            const y = bounds.y + bounds.height / 2;
            let background = surface;
            for (const rect of svg.querySelectorAll("rect")) {
              if (!(rect.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
              const box = rect.getBoundingClientRect();
              if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
                background = over(rgba(getComputedStyle(rect).fill), background);
              }
            }
            const foreground = over(rgba(getComputedStyle(text).fill), background);
            const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
            return { text: text.textContent.trim(), contrast: (values[0] + 0.05) / (values[1] + 0.05) };
          });
        });
        assert.ok(labels.length >= 3, `${route}: meaningful diagram labels`);
        for (const label of labels) {
          assert.ok(label.text, `${route}: nonempty diagram label`);
          assert.ok(label.contrast >= 4.5,
            `${route} ${choice}/${scheme}: ${label.text} contrast ${label.contrast.toFixed(2)} < 4.5`);
        }
      }
    }
  }
  const fallback = await browser.newPage({ javaScriptEnabled: false, colorScheme: "dark" });
  await fallback.goto(url + "api/");
  const fallbackLabel = fallback.locator(".concept-diagram text").first();
  assert.equal(await fallbackLabel.isVisible(), true);
  assert.equal(await fallback.locator("html").getAttribute("data-theme"), null);
  const darkFill = await fallbackLabel.evaluate(node => getComputedStyle(node).fill);
  await fallback.emulateMedia({ colorScheme: "light" });
  const lightFill = await fallbackLabel.evaluate(node => getComputedStyle(node).fill);
  assert.notEqual(darkFill, lightFill, "no-JavaScript diagram labels follow system appearance");

});
