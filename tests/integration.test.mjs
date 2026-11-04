import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { baseline, serve } from './helpers.mjs';

const topics = ['linux', 'aws', 'api', 'relational-databases', 'web-security', 'networking', 'distributed-systems', 'event-driven-architecture'];
const evidence = '/tmp/carlacademy-ticket08-evidence';

async function publicRoutes() {
  const articles = [];
  for (const topic of topics) {
    for (const name of await readdir(`docs/${topic}`, { recursive: true })) {
      if (name.endsWith('.md') && name !== 'README.md') articles.push(`${topic}/${name.slice(0, -3)}/`);
    }
  }
  return { articles, all: ['', ...topics.map(topic => `${topic}/`), ...articles] };
}

// The output verifier checks every local target and fragment during both builds.
// This observes the same real inventory through ordinary HTTP and actual browser layout.
test('全部公開頁面可直接 HTTP 開啟，所有文章在兩種部署、尺寸及外觀下不溢出', { timeout: 300000 }, async t => {
  const { articles, all } = await publicRoutes();
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await mkdir(evidence, { recursive: true });
  for (const base of ['/', '/academy/']) {
    const { directory, result } = await baseline(t, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`Verified ${all.length} static pages`));
    const url = await serve(t, directory, base);
    const indexPage = await browser.newPage();
    await indexPage.goto(url);
    const indexed = await indexPage.evaluate(async baseUrl => {
      const engine = await import(`${baseUrl}pagefind/pagefind.js`);
      await engine.options({ baseUrl: new URL(baseUrl).pathname });
      const found = await engine.search(null);
      return Promise.all(found.results.map(async result => {
        const data = await result.data();
        return new URL(data.url, location.origin).pathname;
      }));
    }, url);
    assert.deepEqual(indexed.sort(), all.map(route => base + route).sort(), 'Search index contains exactly the public inventory');
    await indexPage.close();
    for (const route of all) {
      const response = await fetch(url + route);
      assert.equal(response.status, 200, base + route);
      assert.match(await response.text(), /<main[ >]/);
    }
    for (const width of [390, 1440]) {
      for (const colorScheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 664 : 900 }, colorScheme, reducedMotion: 'reduce' });
        const failures = [];
        page.on('requestfailed', request => failures.push(request.url()));
        page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
        for (const route of articles) {
          assert.equal((await page.goto(url + route)).status(), 200);
          await page.evaluate(() => document.fonts.ready);
          const metrics = await page.evaluate(() => ({
            document: document.documentElement.scrollWidth,
            viewport: innerWidth,
            sans: document.fonts.check('16px "Academy Sans"'),
            display: document.fonts.check('700 40px "Academy Grotesk"'),
          }));
          assert.ok(metrics.document <= metrics.viewport, `${base}${route} ${width} ${colorScheme}: ${JSON.stringify(metrics)}`);
          assert.ok(metrics.sans && metrics.display, 'Self-hosted fonts loaded');
          if (route === 'aws/container-orchestration-and-compute-capacity/') {
            await page.screenshot({ path: `${evidence}/${base === '/' ? 'root' : 'academy'}-${width}-${colorScheme}-opening.png` });
          }
        }
        assert.deepEqual(failures, [], `${base} ${width} ${colorScheme}: resources must load`);
        await page.close();
      }
    }
  }
  t.diagnostic(`${all.length} public routes; ${articles.length * 8} article/layout combinations after document.fonts.ready`);
});

async function doubleText(page) {
  await page.evaluate(() => {
    // Restore the unscaled cascade before measuring new dynamic results, so
    // their inherited text size is not doubled a second time.
    globalThis.textResizeElements ??= new Map();
    for (const [node, originalInline] of globalThis.textResizeElements) {
      if (originalInline) node.style.fontSize = originalInline;
      else node.style.removeProperty('font-size');
    }
    const nodes = [...document.querySelectorAll('body, body *')];
    const sizes = nodes.map(node => [node, parseFloat(getComputedStyle(node).fontSize)]);
    for (const [node, size] of sizes) {
      if (!globalThis.textResizeElements.has(node)) globalThis.textResizeElements.set(node, node.style.fontSize);
      node.style.fontSize = `${size * 2}px`;
    }
  });
}

// Text-only resize approximation: double each element's original computed font size.
// This is deliberately not browser zoom, OS text scaling, or a physical device test.
test('200% 文字縮放模擬保留正文及鍵盤主要流程', { timeout: 120000 }, async t => {
  const { directory, result } = await baseline(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const url = await serve(t, directory);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await mkdir(evidence, { recursive: true });
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 664 : 900 }, reducedMotion: 'reduce' });
    await page.goto(url + 'aws/container-orchestration-and-compute-capacity/');
    await page.evaluate(() => document.fonts.ready);
    await doubleText(page);
    assert.equal(await page.locator('#article-body p').first().evaluate(node => getComputedStyle(node).fontSize), '36px');
    await page.screenshot({ path: `${evidence}/text200-${width}-opening.png` });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1 && !node.closest('pre,.table-scroll')).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().right)}`));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: enlarged text must stay within document: ${overflow.join(', ')}`);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: '跳至內容' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    const appearance = page.getByLabel('外觀', { exact: true });
    await appearance.focus();
    await expect(appearance).toBeFocused();
    assert.equal(await appearance.evaluate(node => getComputedStyle(node).outlineWidth), '3px');
    await appearance.selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const search = page.getByRole('button', { name: '搜尋文件', exact: true });
    await search.focus();
    await page.keyboard.press('Enter');
    const input = page.getByRole('searchbox', { name: '搜尋關鍵字' });
    await expect(input).toBeFocused();
    await page.keyboard.type('CannotPullContainerError');
    const found = page.locator('.search-results a').filter({ hasText: '容器編排與運算容量' });
    await expect(found).toBeVisible();
    const originalResultSize = await found.locator('.result-title').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await doubleText(page);
    assert.equal(await found.locator('.result-title').evaluate(node => parseFloat(getComputedStyle(node).fontSize)), originalResultSize * 2);
    await page.keyboard.press('Tab');
    await expect(found).toBeFocused();
    await page.screenshot({ path: `${evidence}/text200-${width}-search.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('#search-dialog').evaluate(node => node.scrollWidth <= node.clientWidth), 'Enlarged search results wrap within the dialog');
    const close = page.getByRole('button', { name: '關閉搜尋' });
    await close.focus();
    await expect(close).toBeInViewport();
    await input.focus();
    await expect(input).toBeInViewport();
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    await page.locator('h1').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/text200-${width}-opening.png` });
    if (width === 390) {
      await page.getByLabel('切換主題', { exact: true }).focus();
      await page.keyboard.type('Linux');
      await page.keyboard.press('Tab');
      await page.waitForURL(url + 'linux/');
    } else {
      await page.getByRole('navigation', { name: '知識主題', exact: true }).getByRole('link', { name: 'Linux', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(url + 'linux/');
    }
    await page.close();
  }
});
