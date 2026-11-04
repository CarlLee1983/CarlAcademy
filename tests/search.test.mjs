import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { sampleBaseline, serve } from './helpers.mjs';
import { readingOrder, sampleSource } from './sample-content.mjs';

const base = '/academy/';

// Search terms and expected hits come from the sample articles: A is the long article, B the short one.
async function terms() {
  const [a, b] = await readingOrder();
  const markdown = await sampleSource(a.source);
  return {
    a,
    b,
    errorCode: markdown.match(/\bCannotPull\w+/)[0],
    chineseTerm: markdown.match(/\*\*(.+?)\*\*/)[1],
    englishTitleTerm: b.title.match(/[A-Za-z]+/)[0],
  };
}

test('正式靜態搜尋可找到中文標題及英文正文，保留部署路徑', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const { a, b, errorCode, chineseTerm, englishTitleTerm } = await terms();
  const { directory } = await sampleBaseline(t);
  const url = await serve(t, directory, base);
  const page = await browser.newPage();
  await page.goto(url);
  const topicLabel = await page.locator(`#topic-chooser option[value="${base}${a.route.split('/')[0]}/"]`).textContent();
  await page.getByRole('button', {name: '搜尋文件', exact: true}).click();
  const input = page.getByRole('searchbox', {name: '搜尋關鍵字'});
  await expect(input).toBeFocused();
  await input.fill(a.title);
  const result = route => page.locator(`.search-results a[href="${base}${route}"]`);
  const chinese = result(a.route);
  await expect(chinese).toBeVisible();
  await expect(chinese.locator('.result-topic')).toHaveText(topicLabel);
  await expect(chinese.locator('.result-excerpt')).not.toBeEmpty();
  await input.fill(chineseTerm);
  await expect(result(a.route)).toBeVisible();
  await input.fill(englishTitleTerm);
  await expect(result(b.route)).toBeVisible();
  await input.fill(errorCode);
  await expect(result(a.route)).toBeVisible();
  await input.fill('龘');
  await expect(page.getByRole('status')).toContainText('找不到');
  await input.fill('');
  await expect(page.getByRole('status')).toContainText('輸入關鍵字');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: '搜尋文件', exact: true})).toBeFocused();
  await page.close();
});

test('搜尋可從首次模組與索引請求失敗重試，並支援首頁表單與手機鍵盤', async (t) => {
  const { a, errorCode } = await terms();
  const { directory } = await sampleBaseline(t);
  const url = await serve(t, directory, base);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const failure of ['**/pagefind.js?*', '**/pagefind-entry.json?*', '**/*.pf_meta', '**/*.pf_fragment']) {
    const page = await browser.newPage({viewport: {width:390,height:664}});
    let aborted = 0;
    await page.route(failure, route => { aborted++; return route.abort(); });
    await page.goto(url);
    await page.getByRole('searchbox', {name:'查找概念、服務與問題'}).fill(errorCode);
    await page.getByRole('button', {name:'搜尋',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('載入失敗', {timeout:15000});
    assert.ok(aborted > 0, `the real ${failure} request was aborted`);
    await page.unroute(failure);
    await page.getByRole('button', {name:'重試搜尋'}).click();
    await expect(page.locator(`.search-results a[href="${base}${a.route}"]`)).toBeVisible();
    await expect(page.locator('.search-results mark')).not.toHaveCount(0);
    await page.getByRole('searchbox', {name:'搜尋關鍵字'}).fill('<img src=x onerror=alert(1)>');
    await expect(page.locator('.search-results img')).toHaveCount(0);
    await page.getByRole('searchbox', {name:'搜尋關鍵字'}).fill(errorCode);
    const link = page.locator(`.search-results a[href="${base}${a.route}"]`);
    await expect(link).toBeVisible();
    await page.getByRole('searchbox', {name:'搜尋關鍵字'}).focus();
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    assert.notEqual(await link.evaluate(node=>getComputedStyle(node).outlineStyle),'none');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/' + a.route);
    await page.close();
  }
});

test('較早的非同步查詢不會蓋掉目前的輸入結果，停用腳本仍能閱讀', async (t) => {
  const { a, b, errorCode, englishTitleTerm } = await terms();
  const { directory } = await sampleBaseline(t);
  const url = await serve(t, directory, base);
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
  await input.fill(englishTitleTerm);
  await intercepted;
  await input.fill(errorCode);
  release();
  const results = route => page.locator(`.search-results a[href="${base}${route}"]`);
  await expect(results(a.route)).toBeVisible();
  await expect(results(b.route)).toHaveCount(0);
  await page.close();
  const noScript = await browser.newPage({javaScriptEnabled:false});
  await noScript.goto(url+a.route);
  await expect(noScript.locator('h1')).toHaveText(a.title);
  await expect(noScript.getByRole('button', {name:'搜尋文件',exact:true})).toHaveCount(0);
  await expect(noScript.locator('main')).toContainText(errorCode);
  await noScript.close();
});
