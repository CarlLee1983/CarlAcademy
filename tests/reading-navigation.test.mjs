import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { fixture, build, serve } from './helpers.mjs';

test('閱讀進度與目前章節跟隨正式文章的捲動位置', async t => {
  const directory = await fixture(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const result = build(directory, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme, reducedMotion: 'reduce' });
      await page.goto(url + 'relational-databases/transactions-and-isolation/');
      const progress = page.getByRole('progressbar', { name: '本文閱讀進度', includeHidden: true });
      await expect(progress).toHaveAttribute('aria-valuenow', '0');
      const heading = page.locator('#article-body h2').nth(2);
      const id = await heading.getAttribute('id');
      await heading.evaluate(node => node.scrollIntoView());
      await expect(page.locator('.article-sidebar .article-toc a[aria-current="location"]')).toHaveAttribute('href', '#' + id);
      assert.ok(Number(await progress.getAttribute('aria-valuenow')) > 0);
      assert.equal((await progress.boundingBox()).height, 3);
      assert.equal(Math.round((await page.locator('.article-sidebar').boundingBox()).y), 24);
      await page.screenshot({ path: `/tmp/ticket06-desktop-${base === '/' ? 'root' : 'academy'}-${colorScheme}.png` });
      await page.locator('.article-next').scrollIntoViewIfNeeded();
      const sidebar = await page.locator('.article-sidebar').boundingBox();
      const closing = await page.locator('.article-next').boundingBox();
      assert.ok(sidebar.y + sidebar.height <= closing.y);
      await page.close();
    }
  }
});

test('手機章節面板支援鍵盤返回與跳至標題後接續閱讀', async t => {
  const directory = await fixture(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const result = build(directory, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 664 }, colorScheme, reducedMotion: 'reduce' });
      await page.goto(url + 'aws/container-orchestration-and-compute-capacity/');
      const trigger = page.getByRole('button', { name: '目錄', exact: true });
      await expect(trigger).toBeHidden();
      await page.locator('.article-masthead').evaluate(node => scrollTo(0, node.offsetTop + node.offsetHeight + 1));
      await expect(trigger).toBeVisible();
      const label = page.locator('.reading-bar-section');
      assert.equal(await label.evaluate(node => getComputedStyle(node).textOverflow), 'ellipsis');
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '本文目錄' });
      await expect(dialog).toBeVisible();
      assert.equal(await dialog.locator(':focus').count(), 1);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Enter');
      const links = dialog.getByRole('link');
      const staticLinks = await page.locator('.mobile-chapters .article-toc a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      assert.deepEqual(await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), staticLinks);
      await page.screenshot({ path: `/tmp/ticket06-panel-${base === '/' ? 'root' : 'academy'}-${colorScheme}.png` });
      const selected = links.nth(2);
      const hash = await selected.getAttribute('href');
      await selected.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      const heading = page.locator('[id="' + decodeURIComponent(hash.slice(1)) + '"]');
      await expect(heading).toBeFocused();
      const top = (await heading.boundingBox()).y;
      assert.ok(top >= 71 && top <= 73, String(top));
      await expect(label).toHaveText(await heading.textContent());
      await expect(page.locator('.toc-sheet a[aria-current="location"]')).toHaveAttribute('href', hash);
      assert.equal(await page.locator('.reading-bar').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
      assert.equal(await page.locator('.reading-bar-meter').evaluate(node => getComputedStyle(node).height), '2px');
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.reading-bar button:focus').count(), 0, 'Keyboard continues in the document');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Enter');
      await dialog.getByRole('button', { name: '關閉' }).click();
      await expect(trigger).toBeFocused();
      await page.screenshot({ path: `/tmp/ticket06-${base === '/' ? 'root' : 'academy'}-${colorScheme}.png` });
      await page.close();
    }
    const staticPage = await browser.newPage({ viewport: { width: 390, height: 664 }, javaScriptEnabled: false });
    await staticPage.goto(url + 'aws/container-orchestration-and-compute-capacity/');
    await staticPage.locator('#article-body h2').nth(2).scrollIntoViewIfNeeded();
    await expect(staticPage.locator('.reading-bar')).toBeHidden();
    await expect(staticPage.locator('.toc-sheet')).toBeHidden();
    await staticPage.locator('.mobile-chapters > summary').click();
    await staticPage.locator('.mobile-chapters .article-toc a').nth(2).click();
    assert.ok(new URL(staticPage.url()).hash);
    await staticPage.close();
  }
});
