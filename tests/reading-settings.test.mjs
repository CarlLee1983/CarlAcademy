import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { baseline, serve } from './helpers.mjs';

const defaults = { size: 18, lineHeight: 1.8, width: 680 };
const storageKey = 'academy-reading';
const articlePath = 'linux/files-and-directories/';

async function typography(page, { size, lineHeight, width }, { column = true } = {}) {
  const article = page.locator('#article-body');
  await expect(article).toHaveCSS('font-size', `${size}px`);
  const metrics = await article.evaluate(node => {
    const style = getComputedStyle(node);
    return { lineHeight: parseFloat(style.lineHeight), width: node.getBoundingClientRect().width };
  });
  assert.ok(Math.abs(metrics.lineHeight - size * lineHeight) < 0.1, `line height: ${metrics.lineHeight}`);
  if (column) assert.ok(Math.abs(metrics.width - width) < 1, `column width: ${metrics.width}`);
}

async function previewMatchesArticle(page, dialog) {
  const preview = dialog.getByRole('region', { name: '閱讀排版預覽', exact: true });
  await expect(preview).toBeVisible();
  const metrics = await page.evaluate(() => {
    const preview = getComputedStyle(document.querySelector('.reading-preview-text'));
    const article = getComputedStyle(document.querySelector('#article-body'));
    return { preview: [preview.fontSize, preview.lineHeight], article: [article.fontSize, article.lineHeight] };
  });
  assert.deepEqual(metrics.preview, metrics.article, 'preview uses the article font size and line height');
}

async function saved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
}

async function openSettings(page, trigger = page.locator('.reading-settings-entry').getByRole('button', { name: '閱讀設定', exact: true })) {
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '閱讀設定', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function maximumSize(dialog) {
  const slider = dialog.getByLabel('字體大小');
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveValue('22');
}

test('閱讀設定在根目錄與子路徑保留偏好、鍵盤操作與漸進增強', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const { directory, result } = await baseline(t, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const url = await serve(t, directory, base);

    await t.test(`${base} 預設、即時調整、跨文件與重新載入、還原`, async t => {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
      t.after(() => context.close());
      const page = await context.newPage();
      await page.goto(url + articlePath);
      await typography(page, defaults);
      const triggers = page.getByRole('button', { name: '閱讀設定', exact: true, includeHidden: true });
      await expect(triggers).toHaveCount(2);
      for (const trigger of await triggers.all()) await expect(trigger).toHaveAttribute('aria-controls', 'reading-settings');
      const dialog = await openSettings(page);
      await expect(dialog).toHaveAttribute('id', 'reading-settings');
      await previewMatchesArticle(page, dialog);
      await page.screenshot({ path: `/tmp/carl-reading-settings-${base === '/' ? 'root' : 'academy'}-desktop.png` });
      const slider = dialog.getByLabel('字體大小');
      await expect(slider).toHaveAttribute('min', '16');
      await expect(slider).toHaveAttribute('max', '22');
      await expect(slider).toHaveAttribute('step', '2');
      await expect(slider).toHaveValue('18');
      await expect(dialog.getByLabel('行距', { exact: true })).toHaveValue('1.8');
      await expect(dialog.getByLabel('桌面欄寬', { exact: true })).toHaveValue('680');
      assert.deepEqual(await dialog.getByLabel('行距', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['1.7', '1.8']);
      assert.deepEqual(await dialog.getByLabel('桌面欄寬', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['680', '800']);
      await maximumSize(dialog);
      await typography(page, { ...defaults, size: 22 });
      assert.deepEqual(await saved(page), { ...defaults, size: 22 }, 'range changes save before closing');
      await dialog.getByLabel('行距', { exact: true }).selectOption('1.7');
      await dialog.getByLabel('桌面欄寬', { exact: true }).selectOption('800');
      const adjusted = { size: 22, lineHeight: 1.7, width: 800 };
      await typography(page, adjusted);
      await previewMatchesArticle(page, dialog);
      assert.deepEqual(await saved(page), adjusted);
      await dialog.getByRole('button', { name: '完成', exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.locator('#article-body').getByRole('link', { name: '認識 Linux', exact: true }).first().click();
      await expect(page).toHaveURL(url + 'linux/what-is-linux/');
      await typography(page, adjusted);
      await page.reload();
      await typography(page, adjusted);
      const reopened = await openSettings(page);
      await expect(reopened.getByLabel('字體大小')).toHaveValue('22');
      await reopened.getByRole('button', { name: '還原預設', exact: true }).click();
      await typography(page, defaults);
      await previewMatchesArticle(page, reopened);
      assert.deepEqual(await saved(page), defaults);
      await page.reload();
      await typography(page, defaults);
    });

    await t.test(`${base} 原生對話框限制焦點，Escape、關閉與完成返回開啟按鈕`, async t => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      t.after(() => context.close());
      const page = await context.newPage();
      await page.goto(url + articlePath);
      const trigger = page.locator('.reading-settings-entry').getByRole('button', { name: '閱讀設定', exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '閱讀設定', exact: true });
      await expect(dialog).toBeVisible();
      assert.equal(await dialog.evaluate(node => node instanceof HTMLDialogElement && node.matches(':modal')), true);
      const controls = dialog.locator('button, input, select');
      await controls.last().focus();
      await page.keyboard.press('Tab');
      // Chromium can visit browser chrome between the last and first modal control.
      if (!await page.evaluate(() => document.hasFocus())) await page.keyboard.press('Tab');
      assert.equal(await dialog.locator(':focus').count(), 1, 'Tab returns to modal controls without entering page content');
      await controls.first().focus();
      await page.keyboard.press('Shift+Tab');
      if (!await page.evaluate(() => document.hasFocus())) await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.locator(':focus').count(), 1, 'Shift+Tab returns to modal controls without entering page content');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      for (const name of ['關閉', '完成']) {
        await page.keyboard.press('Enter');
        await dialog.getByRole('button', { name, exact: true }).click();
        await expect(trigger).toBeFocused();
      }
    });

    await t.test(`${base} 毀損與超出允許範圍的儲存值安全回到預設`, async t => {
      const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      t.after(() => context.close());
      const page = await context.newPage();
      await page.goto(url + articlePath);
      for (const value of ['{broken', 'null', '[]', '{"size":99,"lineHeight":0,"width":9999}', '{"size":"22","lineHeight":"1.7","width":"800"}']) {
        await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value });
        await page.reload();
        await typography(page, defaults);
        const dialog = await openSettings(page);
        await expect(dialog.getByLabel('字體大小')).toHaveValue('18');
        await expect(dialog.getByLabel('行距', { exact: true })).toHaveValue('1.8');
        await expect(dialog.getByLabel('桌面欄寬', { exact: true })).toHaveValue('680');
        await dialog.getByRole('button', { name: '完成', exact: true }).click();
      }
    });

    await t.test(`${base} 儲存遭拒時仍可調整並顯示無法儲存狀態`, async t => {
      for (const denied of [['setItem'], ['getItem', 'setItem']]) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        t.after(() => context.close());
        await context.addInitScript(methods => {
          for (const method of methods) Storage.prototype[method] = function () { throw new DOMException('Storage denied by test', 'SecurityError'); };
        }, denied);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url + articlePath);
        await typography(page, defaults);
        const dialog = await openSettings(page);
        await maximumSize(dialog);
        await typography(page, { ...defaults, size: 22 });
        await expect(dialog.locator('[role="status"]')).toContainText(/無法.*(?:儲存|保存|記住)/);
        await dialog.getByRole('button', { name: '完成', exact: true }).click();
        await expect(dialog).toBeHidden();
        assert.deepEqual(errors, []);
        await context.close();
      }
    });

    await t.test(`${base} 手機最大字級、局部捲動與根字級 200% 模擬`, async t => {
      const context = await browser.newContext({ viewport: { width: 390, height: 664 }, reducedMotion: 'reduce' });
      t.after(() => context.close());
      const page = await context.newPage();
      await page.goto(url + articlePath);
      const mobileTrigger = page.locator('.reading-bar').getByRole('button', { name: '閱讀設定', exact: true });
      await page.locator('.article-masthead').evaluate(node => scrollTo(0, node.offsetTop + node.offsetHeight + 1));
      await expect(mobileTrigger).toBeVisible();
      const dialog = await openSettings(page, mobileTrigger);
      await maximumSize(dialog);
      await page.screenshot({ path: `/tmp/carl-reading-settings-${base === '/' ? 'root' : 'academy'}-mobile.png` });
      await dialog.getByLabel('桌面欄寬', { exact: true }).selectOption('800');
      await typography(page, { size: 22, lineHeight: 1.8, width: 800 }, { column: false });
      await page.keyboard.press('Escape');
      await expect(mobileTrigger).toBeFocused();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'maximum settings do not widen the page');
      for (const toggle of await page.locator('#article-body .table-toggle').all()) await toggle.click();
      for (const selector of ['#article-body pre', '#article-body table']) {
        assert.ok(await page.locator(selector).count() > 0, `article contains ${selector}`);
        const scrollsLocally = await page.locator(selector).evaluateAll(nodes => nodes.every(node => {
          let current = node;
          while (current && current.id !== 'article-body') {
            if (['auto', 'scroll'].includes(getComputedStyle(current).overflowX)) return true;
            current = current.parentElement;
          }
          return false;
        }));
        assert.equal(scrollsLocally, true, `${selector} retains a local horizontal scroll container`);
      }
      // Simulates a 200% root text size; this does not emulate browser zoom.
      await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
      await typography(page, { size: 44, lineHeight: 1.8, width: 800 }, { column: false });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% root text simulation keeps page within viewport');
      const enlarged = await openSettings(page);
      await enlarged.getByRole('button', { name: '完成', exact: true }).scrollIntoViewIfNeeded();
      await expect(enlarged.getByRole('button', { name: '完成', exact: true })).toBeInViewport();
      await enlarged.getByRole('button', { name: '完成', exact: true }).click();
      await expect(enlarged).toBeHidden();
    });

    await t.test(`${base} 手機預覽可鍵盤捲動、設定可達且底部操作保持可見`, async t => {
      for (const width of [360, 390]) {
        for (const colorScheme of ['light', 'dark']) {
          const context = await browser.newContext({ viewport: { width, height: 664 }, colorScheme, reducedMotion: 'reduce' });
          t.after(() => context.close());
          const page = await context.newPage();
          await page.goto(url + articlePath);
          const dialog = await openSettings(page);
          await maximumSize(dialog);
          await dialog.getByLabel('行距', { exact: true }).selectOption('1.7');
          await previewMatchesArticle(page, dialog);
          const preview = dialog.getByRole('region', { name: '閱讀排版預覽', exact: true });
          await preview.focus();
          await preview.press('End');
          await expect.poll(() => preview.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
          const done = dialog.getByRole('button', { name: '完成', exact: true });
          await expect(done).toBeInViewport();
          const before = await done.boundingBox();
          const column = dialog.getByLabel('桌面欄寬', { exact: true });
          await column.focus();
          await expect(column).toBeInViewport();
          const after = await done.boundingBox();
          assert.ok(Math.abs(after.y - before.y) < 1, 'scrolling settings leaves footer in place');
          await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
          await previewMatchesArticle(page, dialog);
          for (const control of [dialog.getByLabel('字體大小'), dialog.getByLabel('行距', { exact: true }), column, done]) {
            await control.focus();
            await expect(control).toBeInViewport();
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'preview does not widen the page at 200% root text size');
          await done.click();
          await expect(dialog).toBeHidden();
          await context.close();
        }
      }
    });

    await t.test(`${base} 停用 JavaScript 仍可閱讀預設本文且不顯示設定入口`, async t => {
      const context = await browser.newContext({ viewport: { width: 390, height: 664 }, javaScriptEnabled: false });
      t.after(() => context.close());
      const page = await context.newPage();
      await page.goto(url + articlePath);
      await typography(page, defaults, { column: false });
      await expect(page.locator('#article-body')).toBeVisible();
      const triggers = page.getByRole('button', { name: '閱讀設定', exact: true, includeHidden: true });
      await expect(triggers).toHaveCount(2);
      for (const trigger of await triggers.all()) await expect(trigger).toBeHidden();
      await page.locator('#article-body').getByRole('link', { name: '認識 Linux', exact: true }).first().click();
      await expect(page).toHaveURL(url + 'linux/what-is-linux/');
      await typography(page, defaults, { column: false });
    });
  }
});
