import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { topics } from '../src/utils/urls.ts';
import { sampleBaseline, serve } from './helpers.mjs';
import { markdownTables, readingOrder } from './sample-content.mjs';

const base = '/academy/';

// Table 0 is the 3x3 table and table 1 the wide one in the sample long article.
async function sampleArticle() {
  const [article] = await readingOrder();
  const [narrow, wide] = await markdownTables(article.source);
  return { route: article.route, narrow, wide };
}

test('手機表格在停用 JavaScript 時已有欄名、實際數量與可讀卡片', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const { route, narrow } = await sampleArticle();
  const { directory } = await sampleBaseline(t);
  const url = await serve(t, directory, base);
  const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 664 } });
  page.setDefaultTimeout(3000);
  await page.goto(url + route);
  const table = page.locator('#article-body table').first();
  const tools = page.locator('.table-tools').first();
  assert.match(await tools.textContent(), new RegExp(`表格・${narrow.header.length} 欄 ${narrow.rows.length} 列`));
  assert.equal(await tools.getAttribute('data-pagefind-ignore'), '');
  assert.equal(await tools.getByRole('button').isVisible(), false);
  assert.equal(await table.locator('tbody tr').count(), narrow.rows.length);
  const cell = table.locator('tbody tr').first().locator('td').nth(1);
  assert.equal(await cell.getAttribute('data-label'), narrow.header[1]);
  assert.equal(await cell.textContent(), narrow.rows[0][1]);
  assert.equal(await cell.evaluate(node => getComputedStyle(node, '::before').content), `"${narrow.header[1]}"`);
  assert.equal(await cell.evaluate(node => getComputedStyle(node).display), 'block');
  assert.equal(await table.locator('tbody td').first().evaluate(node => getComputedStyle(node).fontWeight), '700');
  await page.close();
});

test('表格以鍵盤切換比較且工具列不跳動，桌面寬表格只在自身捲動', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const { route, wide } = await sampleArticle();
  const { directory } = await sampleBaseline(t);
  const url = await serve(t, directory, base);
  const page = await browser.newPage({ viewport: { width: 390, height: 664 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(3000);
  await page.goto(url + route);
  await page.evaluate(() => document.fonts.ready);
  const block = page.locator('.table-block').first();
  const tools = block.locator('.table-tools');
  const button = tools.getByRole('button');
  assert.equal(await button.textContent(), '改以原表格比較');
  const original = await block.locator('tbody').textContent();
  await button.focus();
  await page.evaluate(() => scrollBy(0, -120));
  const before = (await tools.boundingBox()).y;
  assert.equal(await button.evaluate(node => getComputedStyle(node).outlineWidth), '3px');
  assert.ok((await button.boundingBox()).height >= 44);
  await page.keyboard.press('Enter');
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.equal(await button.textContent(), '改以卡片閱讀');
  assert.ok(Math.abs((await tools.boundingBox()).y - before) <= 1, 'Toolbar stays at the same viewport position');
  assert.equal(await block.locator('tbody').textContent(), original);
  const scroll = block.locator('.table-scroll');
  assert.equal(await scroll.evaluate(node => node.scrollWidth > node.clientWidth), true);
  assert.equal(Math.round((await scroll.boundingBox()).width), 390);
  await scroll.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroll.evaluate(node => node.scrollLeft), { message: 'Keyboard can scroll the comparison region' }).toBeGreaterThan(0);
  await button.focus();
  const comparingTop = (await tools.boundingBox()).y;
  await page.keyboard.press('Space');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.ok(Math.abs((await tools.boundingBox()).y - comparingTop) <= 1);
  assert.equal(await block.locator('tbody').textContent(), original);
  assert.equal(await block.locator('tbody td').first().evaluate(node => getComputedStyle(node).display), 'block');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url + route);
  await page.evaluate(() => document.fonts.ready);
  const isolation = page.locator('.table-block').nth(1);
  await isolation.scrollIntoViewIfNeeded();
  const bodyWidth = (await page.locator('#article-body').boundingBox()).width;
  const tableWidth = (await isolation.boundingBox()).width;
  assert.equal(Math.round(bodyWidth), 680);
  assert.ok(tableWidth > bodyWidth && tableWidth <= 880, `Table width: ${tableWidth}`);
  assert.deepEqual(await isolation.locator('tbody td:first-child').allTextContents(), wide.rows.map(row => row[0]));
  assert.ok(await isolation.locator('th,td').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).whiteSpace === 'nowrap')));
  assert.equal(await isolation.locator('th').first().evaluate(node => getComputedStyle(node).borderBottomWidth), '2px');
  assert.equal(await isolation.locator('table').evaluate(node => getComputedStyle(node).fontVariantNumeric), 'tabular-nums');
  await page.close();
});

test('展開主題說明後，所有主題表格都有卡片與切換工具', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const { directory } = await sampleBaseline(t);
  const url = await serve(t, directory, base);
  let checked = 0;
  for (const topic of topics) {
    // A topic without a sample README has no sample tables; any other failure is real.
    const [first, ...rest] = await markdownTables(`${topic}/README.md`).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (!first) continue;
    const count = rest.length + 1;
    checked++;
    for (const javaScriptEnabled of [false, true]) {
      const page = await browser.newPage({ javaScriptEnabled, viewport: { width: 390, height: 664 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(3000);
      await page.goto(url + topic + '/');
      await page.getByText('主題說明與延伸閱讀', { exact: true }).click();
      const notes = page.locator('details[open]');
      const blocks = notes.locator('.table-block');
      assert.equal(await blocks.count(), count, topic);
      assert.equal(await blocks.first().locator('tbody tr').first().locator('td').nth(1).getAttribute('data-label'), first.header[1]);
      for (const block of await blocks.all()) {
        const button = block.locator('.table-tools').getByRole('button');
        const cells = block.locator('tbody td');
        assert.ok(await cells.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === 'block')));
        assert.equal(await cells.first().evaluate(node => getComputedStyle(node).fontWeight), '700');
        assert.equal(await cells.nth(1).evaluate(node => getComputedStyle(node, '::before').content), `"${await cells.nth(1).getAttribute('data-label')}"`);
        assert.equal(await button.isVisible(), javaScriptEnabled);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      assert.ok(await notes.locator('table').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === 'table')));
      await page.close();
    }
  }
  assert.ok(checked >= 2, 'sample topic indexes with different table counts are covered');
});
