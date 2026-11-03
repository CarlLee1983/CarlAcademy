import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { load } from 'cheerio';
import { fixture, build, baseline, serve } from './helpers.mjs';

test('公開文件在正式靜態產物中可直接閱讀', async t => {
  const { directory, result } = await baseline(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const home = load(await readFile(`${directory}/dist/index.html`, 'utf8'));
  assert.match(home('h1').text(), /工程與技術/);
  for (const topic of ['linux', 'aws', 'api', 'relational-databases', 'web-security', 'networking']) {
    assert.equal(home(`a[href="/${topic}/"]`).length > 0, true, topic);
    const sources = (await readdir(`${directory}/docs/${topic}`)).filter(name => name.endsWith('.md'));
    for (const source of sources) {
      const route = source === 'README.md' ? '' : `${source.slice(0, -3)}/`;
      const html = load(await readFile(`${directory}/dist/${topic}/${route}index.html`, 'utf8'));
      assert.equal(html('main h1').length, 1, `${topic}/${source}`);
      assert.ok(html('main').text().length > 100, `${topic}/${source}`);
    }
  }
  const api = load(await readFile(`${directory}/dist/api/index.html`, 'utf8'));
  assert.deepEqual(api('nav[aria-label="本主題文件"] ol a').map((_, node) => api(node).text()).get().slice(0, 6),
    ['介面、契約與責任', '輸入、輸出與失敗語意', '相容性與演進', '文件與契約描述', 'API 測試', '資源、表示與訊息']);
});

for (const scenario of [
  { name: '缺少文章標題', edit: async dir => {
    const { writeFile } = await import('node:fs/promises');
    const file = `${dir}/docs/linux/what-is-linux.md`;
    await writeFile(file, (await readFile(file, 'utf8')).replace('# 認識 Linux', '認識 Linux'));
  }, error: /what-is-linux\.md: expected exactly one nonempty H1 title/ },
  { name: '公開網址衝突', edit: async dir => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(`${dir}/docs/linux/what-is-linux`);
    await writeFile(`${dir}/docs/linux/what-is-linux/README.md`, '# Duplicate route\n');
  }, error: /Public URL collision \/linux\/what-is-linux\// },
  { name: '連結指向不存在的文章', edit: async dir => {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(`${dir}/docs/linux/what-is-linux.md`, '\n[不存在](missing-document.md)\n');
  }, error: /missing target: \/linux\/missing-document\// },
  { name: '連結指向不存在的段落', edit: async dir => {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(`${dir}/docs/linux/what-is-linux.md`, '\n[不存在的段落](terminal-and-shell.md#absent-section)\n');
  }, error: /missing anchor: \/linux\/terminal-and-shell\/#absent-section/ },
  { name: '新文章未納入主題索引', edit: async dir => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${dir}/docs/linux/unlisted.md`, '# 未列入索引\n');
  }, error: /README\.md: missing document in reading order: docs\/linux\/unlisted\.md/ },
]) {
  test(`建置拒絕${scenario.name}並指出問題`, async t => {
    const dir = await fixture(t);
    await scenario.edit(dir);
    const result = build(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, scenario.error);
  });
}

test('根路徑與子路徑的正式網站透過一般 HTTP 可直接閱讀，標題變更不改網址', async t => {
  const { writeFile } = await import('node:fs/promises');
  const { chromium } = await import('@playwright/test');
  const dir = await fixture(t);
  const file = `${dir}/docs/linux/what-is-linux.md`;
  const renderingExamples = [
    '', '## 管線驗收', '', '前文**單次查詢只需三次 I/O。**後文', '',
    '3~4 層高，3~4 次 I/O', '',
    '| 欄位 | 數值 |', '| --- | --- |', '| 範例 | 42 |', '',
    '```text', 'echo "$HOME"', '  <tag> & value', '```', '',
    '[驗收錨點](#管線驗收)', '', '## 管線驗收', '', '重複標題仍有獨立錨點。',
  ].join('\n');
  await writeFile(file, (await readFile(file, 'utf8')).replace('# 認識 Linux', '# 認識 Linux 與核心') + renderingExamples);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const result = build(dir, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const rendered = load(await readFile(`${dir}/dist/linux/what-is-linux/index.html`, 'utf8'));
    assert.ok(rendered('strong').toArray().some(node => rendered(node).text() === '單次查詢只需三次 I/O。'));
    assert.ok(rendered('p').toArray().some(node => rendered(node).text() === '3~4 層高，3~4 次 I/O'));
    assert.ok(rendered('table').toArray().some(node => rendered(node).find('th').length === 2 && rendered(node).find('td').last().text() === '42'));
    assert.ok(rendered('pre code').toArray().some(node => rendered(node).text() === 'echo "$HOME"\n  <tag> & value\n'));
    assert.deepEqual(rendered('h2').toArray().filter(node => rendered(node).text() === '管線驗收').map(node => rendered(node).attr('id')), ['管線驗收', '管線驗收-1']);
    const url = await serve(t, dir, base);
    const origin = new URL(url).origin;
    const page = await browser.newPage({ javaScriptEnabled: false });
    const response = await page.goto(`${origin}${base}linux/what-is-linux/`);
    assert.equal(response.status(), 200);
    assert.equal(await page.locator('article h1').textContent(), '認識 Linux 與核心');
    await page.reload();
    assert.match(await page.locator('article').textContent(), /系統呼叫/);
    await page.getByRole('link', { name: '終端與 Shell', exact: true }).first().click();
    assert.equal(new URL(page.url()).pathname, `${base}linux/terminal-and-shell/`);
    await page.goto(`${origin}${base}`);
    await page.getByRole('link', { name: 'Linux 知識索引', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, `${base}linux/`);
    const order = await page.locator('nav[aria-label="本主題文件"] ol a').allTextContents();
    assert.deepEqual(order.slice(0, 3), ['認識 Linux 與核心', '終端與 Shell', '檔案與目錄']);
    for (const [topic, fragment] of [
      ['linux', 'linux-知識索引'],
      ['aws', 'aws-知識索引'],
      ['api', 'api-共通知識索引'],
      ['relational-databases', '關聯式資料庫共通知識'],
      ['web-security', 'web-應用資安知識索引'],
      ['networking', '電腦網路知識索引'],
    ]) {
      await page.goto('about:blank');
      const response = await page.goto(`${origin}${base}${topic}/#${fragment}`);
      assert.equal(response.status(), 200);
      const target = page.locator('h1');
      assert.equal(await target.count(), 1);
      assert.equal(await target.getAttribute('id'), fragment, `${topic}: original source title fragment`);
      assert.equal(await target.evaluate(node => node.matches(':target')), true);
    }
    await page.goto(`${origin}${base}linux/`);
    // Fetch all linked resources and local URLs as the static server serves them.
    const refs = await page.locator('[href], [src]').evaluateAll(nodes => nodes.flatMap(node => ['href', 'src'].map(attr => node.getAttribute(attr))).filter(Boolean));
    for (const ref of refs) {
      const url = new URL(ref, page.url());
      if (url.origin === origin) {
        const response = await fetch(url);
        await response.arrayBuffer();
        assert.equal(response.status, 200, url.href);
      }
    }
    for (const internal of ['PLAN.md', 'GLOSSARY.md', 'docs/adr/0001-public-document-urls.md', 'docs/site-design.md']) {
      const response = await fetch(`${origin}${base}${internal}`);
      await response.arrayBuffer();
      assert.equal(response.status, 404, internal);
    }
    await page.close();
  }
});

test('目錄網址也檢查實際索引頁的段落錨點', async t => {
  const { appendFile, writeFile } = await import('node:fs/promises');
  const dir = await fixture(t);
  const file = `${dir}/docs/linux/what-is-linux.md`;
  const original = await readFile(file, 'utf8');
  for (const base of ['/', '/academy/']) {
    await writeFile(file, original + '\n[建議閱讀](/linux#建議閱讀順序)\n');
    const valid = build(dir, base);
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    await appendFile(file, '\n[不存在的章節](/linux#absent-section)\n');
    const broken = build(dir, base);
    assert.notEqual(broken.status, 0, 'Directory URL must not bypass anchor validation');
    assert.match(broken.stdout + broken.stderr, /missing anchor: .*linux#absent-section/);
  }
});
