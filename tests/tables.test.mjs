import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { baseline, serve } from './helpers.mjs';

const capacity = 'aws/container-orchestration-and-compute-capacity/';

test('手機表格在停用 JavaScript 時已有欄名、實際數量與可讀卡片', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const { directory, result } = await baseline(t, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 664 }, colorScheme });
      page.setDefaultTimeout(3000);
      await page.goto(url + capacity);
      const table = page.locator('#article-body table').first();
      const tools = page.locator('.table-tools').first();
      assert.match(await tools.textContent(), /表格・3 欄 3 列/);
      assert.equal(await tools.getAttribute('data-pagefind-ignore'), '');
      assert.equal(await tools.getByRole('button').isVisible(), false);
      assert.equal(await table.locator('tbody tr').count(), 3);
      const cell = table.locator('tbody tr').first().locator('td').nth(1);
      assert.equal(await cell.getAttribute('data-label'), '容量如何提供');
      assert.match(await cell.textContent(), /已登錄到 cluster/);
      assert.equal(await cell.evaluate(node => getComputedStyle(node, '::before').content), '"容量如何提供"');
      assert.equal(await cell.evaluate(node => getComputedStyle(node).display), 'block');
      assert.equal(await table.locator('tbody td').first().evaluate(node => getComputedStyle(node).fontWeight), '700');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.close();
    }
  }
});

test('表格以鍵盤切換比較且工具列不跳動，桌面寬表格只在自身捲動', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const { directory, result } = await baseline(t, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 664 }, colorScheme, reducedMotion: 'reduce' });
      page.setDefaultTimeout(3000);
      await page.goto(url + capacity);
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
      await page.screenshot({ path: `/tmp/carlacademy-ticket04-${base === '/' ? 'root' : 'academy'}-${colorScheme}-cards.png` });
      await page.keyboard.press('Enter');
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.equal(await button.textContent(), '改以卡片閱讀');
      assert.ok(Math.abs((await tools.boundingBox()).y - before) <= 1, 'Toolbar stays at the same viewport position');
      assert.equal(await block.locator('tbody').textContent(), original);
      const scroll = block.locator('.table-scroll');
      assert.equal(await scroll.evaluate(node => node.scrollWidth > node.clientWidth), true);
      assert.equal(Math.round((await scroll.boundingBox()).width), 390);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await scroll.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      assert.ok(await scroll.evaluate(node => node.scrollLeft) > 0, 'Keyboard can scroll the comparison region');
      await page.screenshot({ path: `/tmp/carlacademy-ticket04-${base === '/' ? 'root' : 'academy'}-${colorScheme}-comparison.png` });
      await button.focus();
      const comparingTop = (await tools.boundingBox()).y;
      await page.keyboard.press('Space');
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      assert.ok(Math.abs((await tools.boundingBox()).y - comparingTop) <= 1);
      assert.equal(await block.locator('tbody').textContent(), original);
      assert.equal(await block.locator('tbody td').first().evaluate(node => getComputedStyle(node).display), 'block');

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(url + 'relational-databases/transactions-and-isolation/');
      await page.evaluate(() => document.fonts.ready);
      const isolation = page.locator('.table-block').nth(1);
      await isolation.scrollIntoViewIfNeeded();
      const bodyWidth = (await page.locator('#article-body').boundingBox()).width;
      const tableWidth = (await isolation.boundingBox()).width;
      assert.equal(Math.round(bodyWidth), 680);
      assert.ok(tableWidth > bodyWidth && tableWidth <= 880, `Table width: ${tableWidth}`);
      assert.deepEqual(await isolation.locator('tbody td:first-child').allTextContents(), ['Read Uncommitted', 'Read Committed', 'Repeatable Read', 'Serializable']);
      assert.ok(await isolation.locator('th,td').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).whiteSpace === 'nowrap')));
      assert.equal(await isolation.locator('th').first().evaluate(node => getComputedStyle(node).borderBottomWidth), '2px');
      assert.equal(await isolation.locator('table').evaluate(node => getComputedStyle(node).fontVariantNumeric), 'tabular-nums');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/carlacademy-ticket04-${base === '/' ? 'root' : 'academy'}-${colorScheme}-desktop.png` });
      await page.close();
    }
  }
});

test('展開主題說明後，所有主題表格支援無 JS 卡片與鍵盤比較', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const { directory, result } = await baseline(t, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    for (const colorScheme of ['light', 'dark']) {
      for (const [topic, count, label] of [
        ['aws', 2, '內容邊界與官方閱讀入口'],
        ['api', 4, '閱讀時要區分的概念'],
        ['relational-databases', 1, '核心問題'],
        ['web-security', 1, '要解決的問題'],
      ]) {
        for (const javaScriptEnabled of [false, true]) {
          const page = await browser.newPage({ javaScriptEnabled, viewport: { width: 390, height: 664 }, colorScheme, reducedMotion: 'reduce' });
          page.setDefaultTimeout(3000);
          await page.goto(url + topic + '/');
          await page.getByText('主題說明與延伸閱讀', { exact: true }).click();
          await page.evaluate(() => document.fonts.ready);
          const notes = page.locator('details[open]');
          const blocks = notes.locator('.table-block');
          assert.equal(await blocks.count(), count, topic);
          assert.equal(await blocks.first().locator('tbody tr').first().locator('td').nth(1).getAttribute('data-label'), label);
          for (const block of await blocks.all()) {
            const tools = block.locator('.table-tools');
            const button = tools.getByRole('button');
            const cells = block.locator('tbody td');
            assert.ok(await cells.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === 'block')));
            assert.equal(await cells.first().evaluate(node => getComputedStyle(node).fontWeight), '700');
            assert.equal(await cells.nth(1).evaluate(node => getComputedStyle(node, '::before').content), `"${await cells.nth(1).getAttribute('data-label')}"`);
            assert.equal(await button.isVisible(), javaScriptEnabled);
            const original = await block.locator('tbody').textContent();
            const evidence = `/tmp/carlacademy-review-${base === '/' ? 'root' : 'academy'}-${topic}-${colorScheme}-${javaScriptEnabled ? 'js' : 'nojs'}`;
            if (!javaScriptEnabled) {
              await tools.scrollIntoViewIfNeeded();
              await page.screenshot({ path: `${evidence}-cards.png` });
            } else {
              await button.focus();
              await page.evaluate(() => scrollBy(0, -120));
              const top = (await tools.boundingBox()).y;
              await page.screenshot({ path: `${evidence}-cards.png` });
              await page.keyboard.press('Enter');
              assert.equal(await button.getAttribute('aria-pressed'), 'true');
              assert.ok(Math.abs((await tools.boundingBox()).y - top) <= 1, `${topic}: stable comparison toolbar`);
              const scroll = block.locator('.table-scroll');
              assert.equal(await scroll.evaluate(node => node.scrollWidth > node.clientWidth), true);
              assert.equal(Math.round((await scroll.boundingBox()).width), 390);
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
              await page.screenshot({ path: `${evidence}-comparison.png` });
              await scroll.focus();
              await page.keyboard.press('ArrowRight');
              await page.waitForTimeout(200);
              assert.ok(await scroll.evaluate(node => node.scrollLeft) > 0);
              await button.focus();
              const comparingTop = (await tools.boundingBox()).y;
              await page.keyboard.press('Space');
              assert.equal(await button.getAttribute('aria-pressed'), 'false');
              assert.ok(Math.abs((await tools.boundingBox()).y - comparingTop) <= 1);
              assert.equal(await block.locator('tbody').textContent(), original);
            }
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await page.setViewportSize({ width: 1440, height: 900 });
          assert.ok(await notes.locator('table').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === 'table')));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await page.close();
        }
      }
    }
  }
});
