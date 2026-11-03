import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { baseline, serve } from './helpers.mjs';

test('正式靜態搜尋可找到中文標題及英文正文，保留部署路徑', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const { directory, result } = await baseline(t, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);
    const page = await browser.newPage();
    await page.goto(url);
    await page.getByRole('button', {name: '搜尋文件', exact: true}).click();
    const input = page.getByRole('searchbox', {name: '搜尋關鍵字'});
    await expect(input).toBeFocused();
    await input.fill('容器編排');
    const chinese = page.getByRole('link', {name: /容器編排與運算容量/}).last();
    await expect(chinese).toBeVisible();
    assert.equal(await chinese.getAttribute('href'), `${base}aws/container-orchestration-and-compute-capacity/`);
    await expect(chinese.locator('.result-topic')).toHaveText('AWS');
    await expect(chinese.locator('.result-excerpt')).not.toBeEmpty();
    await input.fill('停止訊號');
    await expect(page.locator('.search-results a').filter({hasText: '容器編排與運算容量'})).toBeVisible();
    await input.fill('GraphQL');
    await expect(page.locator('.search-results a').filter({hasText: 'GraphQL 的型別與執行模型'})).toBeVisible();
    await input.fill('CannotPullContainerError');
    await expect(page.locator('.search-results a').filter({hasText: '容器編排與運算容量'})).toBeVisible();
    await input.fill('龘');
    await expect(page.getByRole('status')).toContainText('找不到');
    await input.fill('');
    await expect(page.getByRole('status')).toContainText('輸入關鍵字');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', {name: '搜尋文件', exact: true})).toBeFocused();
    await page.close();
  }
});

test('搜尋可從首次模組與索引請求失敗重試，並支援首頁表單與手機鍵盤', async (t) => {
  const { directory, result } = await baseline(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const url = await serve(t, directory);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const failure of ['**/pagefind.js?*', '**/pagefind-entry.json?*', '**/*.pf_meta', '**/*.pf_fragment']) {
    const page = await browser.newPage({viewport: {width:390,height:664}});
    let aborted = 0;
    await page.route(failure, route => { aborted++; return route.abort(); });
    await page.goto(url);
    await page.getByRole('searchbox', {name:'查找概念、服務與問題'}).fill('CannotPullContainerError');
    await page.getByRole('button', {name:'搜尋',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('載入失敗', {timeout:15000});
    assert.ok(aborted > 0, `the real ${failure} request was aborted`);
    await page.unroute(failure);
    await page.getByRole('button', {name:'重試搜尋'}).click();
    await expect(page.locator('.search-results a').filter({hasText:'容器編排與運算容量'})).toBeVisible();
    await expect(page.locator('.search-results mark')).not.toHaveCount(0);
    await page.getByRole('searchbox', {name:'搜尋關鍵字'}).fill('<img src=x onerror=alert(1)>');
    await expect(page.locator('.search-results img')).toHaveCount(0);
    await page.getByRole('searchbox', {name:'搜尋關鍵字'}).fill('CannotPullContainerError');
    const link = page.locator('.search-results a').filter({hasText:'容器編排與運算容量'});
    await expect(link).toBeVisible();
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme=theme, theme);
      await page.screenshot({path:`/tmp/carlacademy-search-mobile-${theme}.png`});
      await page.setViewportSize({width:1440,height:900});
      await page.screenshot({path:`/tmp/carlacademy-search-desktop-${theme}.png`});
      await page.setViewportSize({width:390,height:664});
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('searchbox', {name:'搜尋關鍵字'}).focus();
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    assert.notEqual(await link.evaluate(node=>getComputedStyle(node).outlineStyle),'none');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/aws/container-orchestration-and-compute-capacity/');
    await page.close();
  }
});

test('較早的非同步查詢不會蓋掉目前的輸入結果，停用腳本仍能閱讀', async (t) => {
  const { directory, result } = await baseline(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const url = await serve(t, directory);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let observed;
  const intercepted = new Promise(resolve => { observed = resolve; });
  await page.route('**/*.pf_meta', async route => {
    observed();
    await pending;
    await route.continue();
  }, {times:1});
  await page.goto(url);
  await page.getByRole('button', {name:'搜尋文件',exact:true}).click();
  const input = page.getByRole('searchbox', {name:'搜尋關鍵字'});
  await input.fill('CannotPullContainerError');
  await intercepted;
  await input.fill('GraphQL');
  release();
  await expect(page.locator('.search-results a').filter({hasText:'GraphQL 的型別與執行模型'})).toBeVisible();
  await expect(page.locator('.search-results a').filter({hasText:'容器編排與運算容量'})).toHaveCount(0);
  await page.close();
  const noScript = await browser.newPage({javaScriptEnabled:false});
  await noScript.goto(url+'aws/container-orchestration-and-compute-capacity/');
  await expect(noScript.locator('h1')).toHaveText('容器編排與運算容量');
  await expect(noScript.getByRole('button', {name:'搜尋文件',exact:true})).toHaveCount(0);
  await expect(noScript.locator('main')).toContainText('CannotPullContainerError');
  await noScript.close();
});
