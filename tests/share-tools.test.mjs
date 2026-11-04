import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { load } from 'cheerio';
import { sampleBaseline, serve } from './helpers.mjs';

const base = '/academy/';
const route = 'linux/long-article/';

test('分享工具在子路徑複製乾淨網址、提供原生分享與可選取的失敗備援', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  {
    const { directory } = await sampleBaseline(t, { siteUrl: '' });
    const origin = await serve(t, directory, base);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async value => { window.copiedUrl = value; },
      } });
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async value => { window.sharedArticle = value; } });
    });
    const page = await context.newPage();
    await page.goto(origin + route + '?source=test#article-body');
    const tools = page.locator('[data-share-tools]');
    const expected = await tools.getAttribute('data-url') || origin + route;
    assert.equal(await tools.getAttribute('data-pagefind-ignore'), '');
    const copy = tools.getByRole('button', { name: '複製連結' });
    await copy.focus();
    await page.keyboard.press('Enter');
    await tools.getByRole('status').filter({ hasText: '已複製本文連結' }).waitFor();
    assert.equal(await page.evaluate(() => window.copiedUrl), expected);
    for (const [name, parameter] of [['LINE', 'url'], ['Facebook', 'u'], ['X', 'url']]) {
      const link = tools.getByRole('link', { name: new RegExp(`^${name}`) });
      assert.equal(new URL(await link.getAttribute('href')).searchParams.get(parameter), expected);
    }
    const native = tools.getByRole('button', { name: '更多分享方式' });
    await native.click();
    await tools.getByRole('status').filter({ hasText: '已完成分享' }).waitFor();
    const shared = await page.evaluate(() => window.sharedArticle);
    assert.equal(shared.url, expected);
    assert.equal(shared.title, await tools.getAttribute('data-title'));
    assert.equal(shared.text, await tools.getAttribute('data-description'));
    await page.evaluate(() => { navigator.share = async () => { throw new DOMException('Canceled', 'AbortError'); }; });
    await native.click();
    await page.waitForFunction(() => !document.querySelector('[data-share-native]').disabled);
    assert.equal(await tools.getByRole('status', { includeHidden: true }).textContent(), '');
    await page.evaluate(() => { navigator.share = async () => { throw new Error('Unavailable'); }; });
    await native.click();
    await tools.getByRole('status').filter({ hasText: '無法開啟分享' }).waitFor();
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
    await copy.click();
    await tools.getByRole('status').filter({ hasText: '手動複製' }).waitFor();
    const fallback = tools.getByRole('textbox', { name: '本文連結' });
    assert.equal(await fallback.inputValue(), expected);
    assert.equal(await fallback.evaluate(node => node.selectionEnd - node.selectionStart), expected.length);
    assert.equal(await fallback.evaluate(node => document.activeElement === node), true);
    await page.evaluate(() => { navigator.clipboard.writeText = async value => { window.copiedUrl = value; }; });
    await copy.click();
    await tools.getByRole('status').filter({ hasText: '已複製本文連結' }).waitFor();
    assert.equal(await fallback.isVisible(), false);
    await context.close();

    const unsupported = await browser.newPage();
    await unsupported.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    await unsupported.goto(origin + route);
    assert.equal(await unsupported.locator('[data-share-native]').isVisible(), false);
    await unsupported.locator('[data-share-copy]').click();
    await unsupported.locator('.share-fallback').waitFor({ state: 'visible' });
    await unsupported.close();
  }
});

test('無 JavaScript 時，已設定正式網域的文章保留三個可直接開啟的分享連結', async t => {
  const { directory } = await sampleBaseline(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  {
    const origin = await serve(t, directory, base);
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto(origin + route);
    const tools = page.locator('[data-share-tools]');
    assert.equal(await tools.locator('button:visible').count(), 0);
    assert.equal(await tools.getByRole('link').count(), 3);
    // The default production domain is whatever the build wrote into the canonical link.
    const expected = load(await readFile(`${directory}/dist/${route}index.html`, 'utf8'))('link[rel="canonical"]').attr('href');
    assert.match(expected, new RegExp(`^https://[^/]+${base}${route}$`));
    for (const [name, parameter] of [['LINE', 'url'], ['Facebook', 'u'], ['X', 'url']]) {
      const link = tools.getByRole('link', { name: new RegExp(`^${name}`) });
      assert.equal(new URL(await link.getAttribute('href')).searchParams.get(parameter), expected);
      assert.match(await link.getAttribute('rel'), /noopener/);
    }
    await page.close();
    const enhanced = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await enhanced.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedUrl = value; } } });
    });
    await enhanced.goto(origin + route + '?source=test#article-body');
    await enhanced.locator('[data-share-copy]').click();
    await enhanced.locator('.share-status').filter({ hasText: '已複製本文連結' }).waitFor();
    assert.equal(await enhanced.evaluate(() => window.copiedUrl), expected);
    await enhanced.close();
  }
});

test('未設定正式網址且無 JavaScript 時保留瀏覽器分享提示', async t => {
  const { directory } = await sampleBaseline(t, { siteUrl: '' });
  const origin = await serve(t, directory, base);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.goto(origin + route);
  const tools = page.locator('[data-share-tools]');
  assert.equal(await tools.getByRole('link').count(), 0);
  assert.equal(await tools.locator('button:visible').count(), 0);
  assert.match(await tools.textContent(), /複製瀏覽器網址/);
});
