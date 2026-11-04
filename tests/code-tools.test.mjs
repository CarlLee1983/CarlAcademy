import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { chromium } from '@playwright/test';
import { sampleBaseline, serve } from './helpers.mjs';
import { codeBlock, readingOrder } from './sample-content.mjs';

const base = '/academy/';

// Code blocks of the sample long article that tests compare against, read from its Markdown.
async function sampleCode() {
  const [article] = await readingOrder();
  return {
    route: article.route,
    source: await codeBlock(article.source, 'bash'),
    diagram: await codeBlock(article.source, 'text'),
  };
}

test('建置產物提供程式碼標籤與工具列，無 JS 保留精確原文及局部捲動', async t => {
  const { route, source } = await sampleCode();
  const { directory } = await sampleBaseline(t);
  const $ = load(await readFile(path.join(directory, 'dist', route, 'index.html'), 'utf8'));
  const frame = $('.code-frame').filter((_, node) => $(node).find('code').text() === source);
  assert.equal(frame.length, 1);
  assert.equal(frame.find('.code-tools').attr('data-pagefind-ignore'), '');
  assert.equal(frame.find('.code-language').text(), 'BASH');
  assert.ok(frame.find('button').filter((_, node) => $(node).text().includes('複製')).is('[disabled]'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const url = await serve(t, directory, base);
  const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 664 } });
  await page.goto(url + route);
  const pre = page.locator('.code-frame pre').filter({ hasText: 'very-long-argument' });
  assert.equal(await pre.textContent(), source);
  assert.ok(await pre.evaluate(node => node.scrollWidth > node.clientWidth));
  await pre.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  assert.ok(await pre.evaluate(node => node.scrollLeft > 0));
  await page.close();
});

test('讀者可複製精確原文、操作超寬換行並取得真實捲動及失敗狀態', async t => {
  const { route, source } = await sampleCode();
  const { directory } = await sampleBaseline(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const url = await serve(t, directory, base);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(url + route);
  await page.evaluate(() => document.fonts.ready);
  const frame = page.locator('.code-frame').filter({ hasText: 'very-long-argument' });
  const pre = frame.locator('pre');
  const wrap = frame.getByRole('button', { name: '換行' });
  const copy = frame.getByRole('button', { name: '複製', exact: true });
  await wrap.waitFor({ state: 'visible' });
  assert.equal(Math.round((await frame.boundingBox()).width), 880);
  assert.equal(await frame.evaluate(node => getComputedStyle(node, '::after').content), '""');
  assert.equal(await page.locator('.code-frame').last().getByRole('button', { name: '換行' }).isVisible(), false);
  await copy.focus();
  assert.equal(await copy.evaluate(node => getComputedStyle(node).outlineWidth), '3px');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '已複製', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
  await pre.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await page.waitForTimeout(50);
  assert.equal(await frame.evaluate(node => getComputedStyle(node, '::after').content), 'none');
  await wrap.focus();
  await page.keyboard.press('Space');
  assert.equal(await wrap.getAttribute('aria-pressed'), 'true');
  assert.equal(await pre.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.equal(await frame.evaluate(node => getComputedStyle(node, '::after').content), 'none');
  assert.equal(await pre.textContent(), source);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.waitForTimeout(100);
  assert.equal(await wrap.isVisible(), true, 'Wrapped overflow remains reversible after resize');
  await wrap.click();
  assert.equal(await wrap.getAttribute('aria-pressed'), 'false');
  assert.ok(await pre.evaluate(node => node.scrollWidth > node.clientWidth));
  const box = await frame.boundingBox();
  assert.equal(Math.round(box.x), 0);
  assert.equal(Math.round(box.width), 390);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('Denied')) }, configurable: true }));
  await frame.getByRole('button', { name: '已複製', exact: true }).click();
  await frame.getByRole('button', { name: '無法複製', exact: true }).waitFor();
  assert.match(await frame.getByRole('status').textContent(), /手動複製/);
  const resizing = page.locator('.code-frame').filter({ hasText: 'resize-to-fit' });
  const resizeWrap = resizing.getByRole('button', { name: '換行', includeHidden: true });
  await resizeWrap.waitFor({ state: 'visible' });
  await resizeWrap.click();
  assert.equal(await resizeWrap.getAttribute('aria-pressed'), 'true');
  await page.setViewportSize({ width: 1440, height: 900 });
  await resizeWrap.waitFor({ state: 'hidden' });
  assert.equal(await resizeWrap.getAttribute('aria-pressed'), 'false');
  assert.equal(await resizing.locator('code').evaluate(node => getComputedStyle(node).whiteSpace), 'pre');
  assert.equal(await resizing.evaluate(node => getComputedStyle(node, '::after').content), 'none');
});

test('既有框線圖在兩種寬度下保留原排版，無 JS 可局部捲動', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const { route, diagram } = await sampleCode();
  const { directory } = await sampleBaseline(t);
  const url = await serve(t, directory, base);
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width, height: 900 } });
    await page.goto(url + route);
    const frame = page.locator('.code-frame.is-diagram').first();
    assert.equal(await frame.locator('code').textContent(), diagram);
    assert.equal(await frame.getByRole('button', { name: '換行' }).count(), 0);
    assert.equal(await frame.locator('code').evaluate(node => getComputedStyle(node).whiteSpace), 'pre');
    assert.equal(await frame.locator('pre').evaluate(node => getComputedStyle(node).overflowX), 'auto');
    await page.close();
  }
});
