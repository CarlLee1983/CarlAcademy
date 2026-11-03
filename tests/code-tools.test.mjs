import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { chromium } from '@playwright/test';
import { fixture, build, baseline, serve } from './helpers.mjs';

const resizeSource = 'printf "resize-to-fit: preserve this moderately long command while the viewport changes"\n';
const source = 'printf "保留空白與換行"\n\t' + 'very-long-argument '.repeat(100) + '\n\n';
async function codeFixture(t) {
  const directory = await fixture(t);
  await appendFile(path.join(directory, 'docs/linux/terminal-and-shell.md'), '\n## 閱讀工具驗證\n\n```sh\n' + source + '```\n\n```sh\n' + resizeSource + '```\n\n```sh\npwd\n```\n');
  return directory;
}

test('建置產物提供程式碼標籤與工具列，無 JS 保留精確原文及局部捲動', async t => {
  const directory = await codeFixture(t);
  const result = build(directory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const $ = load(await readFile(path.join(directory, 'dist/linux/terminal-and-shell/index.html'), 'utf8'));
  const frame = $('.code-frame').filter((_, node) => $(node).find('code').text() === source);
  assert.equal(frame.length, 1);
  assert.equal(frame.find('.code-tools').attr('data-pagefind-ignore'), '');
  assert.equal(frame.find('.code-language').text(), 'SH');
  assert.ok(frame.find('button').filter((_, node) => $(node).text().includes('複製')).is('[disabled]'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const url = await serve(t, directory);
  const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 664 } });
  await page.goto(url + 'linux/terminal-and-shell/');
  const pre = page.locator('.code-frame pre').filter({ hasText: 'very-long-argument' });
  assert.equal(await pre.textContent(), source);
  assert.ok(await pre.evaluate(node => node.scrollWidth > node.clientWidth));
  await pre.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  assert.ok(await pre.evaluate(node => node.scrollLeft > 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.close();
});

test('讀者可複製精確原文、操作超寬換行並取得真實捲動及失敗狀態', async t => {
  const directory = await codeFixture(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const screenshots = '/tmp/carlacademy-ticket05-evidence';
  await mkdir(screenshots, { recursive: true });
  for (const base of ['/', '/academy/']) {
    const result = build(directory, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme, permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(url + 'linux/terminal-and-shell/');
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
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await frame.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshots, `${base === '/' ? 'root' : 'academy'}-mobile-${colorScheme}.png`) });
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('Denied')) }, configurable: true }));
      await frame.getByRole('button', { name: '已複製', exact: true }).click();
      await frame.getByRole('button', { name: '無法複製', exact: true }).waitFor();
      assert.match(await frame.getByRole('status').textContent(), /手動複製/);
      await page.setViewportSize({ width: 1440, height: 900 });
      await frame.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshots, `${base === '/' ? 'root' : 'academy'}-desktop-${colorScheme}.png`) });
      await page.setViewportSize({ width: 390, height: 664 });
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
      await context.close();
    }
  }
});

test('既有框線圖在兩種路徑與外觀下保留原排版，無 JS 可局部捲動', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const { directory, result } = await baseline(t, base);
    const markdown = await readFile(path.join(directory, 'docs/linux/what-is-linux.md'), 'utf8');
    const diagram = markdown.match(/```(?:text)?\n([\s\S]*?[┌─│][\s\S]*?)```/)[1];
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    for (const width of [390, 1440]) {
      for (const colorScheme of ['light', 'dark']) {
        const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width, height: 900 }, colorScheme });
        await page.goto(url + 'linux/what-is-linux/');
        const frame = page.locator('.code-frame.is-diagram').first();
        assert.equal(await frame.locator('code').textContent(), diagram);
        assert.equal(await frame.getByRole('button', { name: '換行' }).count(), 0);
        assert.equal(await frame.locator('code').evaluate(node => getComputedStyle(node).whiteSpace), 'pre');
        assert.equal(await frame.locator('pre').evaluate(node => getComputedStyle(node).overflowX), 'auto');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.close();
      }
    }
  }
});
