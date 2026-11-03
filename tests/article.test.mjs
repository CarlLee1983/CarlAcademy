import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { fixture, build, serve } from './helpers.mjs';

test('文章以靜態目錄定位實際章節，依主題閱讀順序接續文件', async t => {
  const directory = await fixture(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const result = build(directory, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto(url + 'linux/what-is-linux/');
    assert.equal(await page.locator('main h1').count(), 1);
    assert.match(await page.locator('.article-masthead').textContent(), /文件 01／14/);
    const links = page.locator('.article-sidebar nav[aria-label="本文目錄"] a');
    assert.ok(await links.count() > 0, 'Static chapter links are present without JavaScript');
    const headings = await page.locator('#article-body :is(h2,h3,h4,h5,h6)').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, id: node.id })));
    assert.deepEqual(await links.evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, id: decodeURIComponent(node.hash.slice(1)) }))), headings);
    await links.first().click();
    assert.ok(new URL(page.url()).hash);
    assert.equal(await page.locator('.article-next a[rel="prev"]').count(), 0);
    assert.equal(await page.locator('.article-next a[rel="next"]').getAttribute('href'), base + 'linux/terminal-and-shell/');
    await page.locator('.article-next a[rel="next"]').click();
    assert.equal(await page.locator('.article-next a[rel="prev"]').getAttribute('href'), base + 'linux/what-is-linux/');
    await page.locator('.article-sidebar details summary').click();
    const documents = page.locator('.article-sidebar nav[aria-label="本主題文件"] ol a');
    assert.deepEqual((await documents.allTextContents()).slice(0, 3), ['認識 Linux', '終端與 Shell', '檔案與目錄']);
    const last = await documents.last().getAttribute('href');
    await page.goto(new URL(last, url).href);
    assert.equal(await page.locator('.article-next a[rel="next"]').count(), 0);
    assert.equal(await page.locator('.article-next a[rel="prev"]').count(), 1);
    await page.setViewportSize({ width: 390, height: 664 });
    assert.equal(await page.locator('.mobile-lede').isVisible(), true);
    await page.locator('.mobile-chapters > summary').click();
    await page.locator('.mobile-chapters .article-toc a').first().click();
    assert.ok(new URL(page.url()).hash, 'Native mobile chapters work without JavaScript');
    await page.close();
  }
});

test('定稿文章在桌面首屏開始正文，手機保留精簡開場與原始導言', async t => {
  const directory = await fixture(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const result = build(directory, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme, reducedMotion: 'reduce' });
      page.setDefaultTimeout(3000);
      for (const route of ['aws/load-balancing-and-cloudfront/', 'aws/cdn-and-content-origins/']) {
        await page.goto(url + route);
        await page.evaluate(() => document.fonts.ready);
        const bodyTop = (await page.locator('#article-body').boundingBox()).y;
        assert.ok(bodyTop <= 610, `${route}: body starts at ${bodyTop}px`);
        assert.match(await page.locator('.abstract strong').textContent(), /CloudFront/);
        assert.equal(await page.locator('.mobile-lede').isVisible(), false);
        assert.doesNotMatch(await page.locator('#article-body > p').first().textContent(), /網站有多台伺服器時|一個網站可以由 S3/);
        assert.equal(Math.round((await page.locator('#article-body').boundingBox()).width), 680);
        assert.equal(await page.locator('.article-sidebar').evaluate(node => getComputedStyle(node).position), 'sticky');
        assert.equal(await page.locator('h1').evaluate(node => getComputedStyle(node).animationName), 'none');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator(':focus').textContent(), '跳至內容');
        await page.locator('.article-sidebar .article-toc a').first().focus();
        assert.equal(await page.locator(':focus').evaluate(node => getComputedStyle(node).outlineWidth), '3px');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.evaluate(() => scrollTo(0, 900));
        const sidebarTop = (await page.locator('.article-sidebar').boundingBox()).y;
        assert.ok(sidebarTop >= 23 && sidebarTop <= 25, `Sticky TOC top: ${sidebarTop}`);
        await page.locator('.article-next').scrollIntoViewIfNeeded();
        const sidebarBox = await page.locator('.article-sidebar').boundingBox();
        const nextBox = await page.locator('.article-next').boundingBox();
        assert.ok(sidebarBox.y + sidebarBox.height <= nextBox.y, 'Closing band does not overlap the TOC');
      }
      await page.setViewportSize({ width: 390, height: 664 });
      await page.goto(url + 'aws/container-orchestration-and-compute-capacity/');
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('.article-breadcrumb').isVisible(), false);
      assert.equal(await page.locator('.article-masthead .abstract').isVisible(), false);
      assert.equal(await page.locator('.mobile-lede').isVisible(), true);
      assert.equal(await page.locator('.document-position').isVisible(), false);
      assert.match(await page.locator('.mobile-lede p').first().textContent(), /希望網站有六份 task/);
      assert.equal(await page.locator('.mobile-lede').evaluate(node => getComputedStyle(node).borderBottomStyle), 'solid');
      await page.locator('.mobile-chapters > summary').click();
      const chapter = page.locator('.mobile-chapters .article-toc a').first();
      await chapter.click();
      await page.waitForTimeout(50);
      const targetTop = await page.evaluate(() => document.getElementById(decodeURIComponent(location.hash.slice(1))).getBoundingClientRect().top);
      assert.ok(targetTop >= 71 && targetTop <= 73, String(targetTop));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.close();
    }
  }
});
