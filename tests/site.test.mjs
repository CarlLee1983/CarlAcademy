import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { load } from 'cheerio';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { topics } from '../src/utils/urls.ts';
import { baseline, build, fixture, serve } from './helpers.mjs';

const parser = unified().use(remarkParse).use(remarkGfm);

async function markdownTree(file) {
  return parser.parse(await readFile(file, 'utf8'));
}

async function titleOf(file) {
  const tree = await markdownTree(file);
  return toString(tree.children.find(node => node.type === 'heading' && node.depth === 1)).trim();
}

// The reading order is the topic index's relative document links, deduplicated, as src/utils/documents.ts defines it.
async function readingOrderTitles(root, topic) {
  const directory = path.join(root, 'docs', topic);
  const links = [];
  visit(await markdownTree(path.join(directory, 'README.md')), 'link', node => { links.push(node.url); });
  const files = [];
  for (const link of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link)) continue;
    const file = path.resolve(directory, decodeURIComponent(link.split(/[?#]/)[0]));
    if (path.dirname(file) !== directory || !file.endsWith('.md') || file === path.join(directory, 'README.md')) continue;
    if (!files.includes(file)) files.push(file);
  }
  return Promise.all(files.map(titleOf));
}

async function navTitles(directory, topic) {
  const page = load(await readFile(`${directory}/dist/${topic}/index.html`, 'utf8'));
  return page('nav[aria-label="本主題文件"] ol a').map((_, node) => page(node).text()).get();
}

// Heading ids follow GitHub-style slugs: lowercase, punctuation dropped, spaces become hyphens.
function slug(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/ /g, '-');
}

test('公開文件在正式靜態產物中可直接閱讀', async t => {
  const { directory, result } = await baseline(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const home = load(await readFile(`${directory}/dist/index.html`, 'utf8'));
  assert.match(home('h1').text(), /工程與技術/);
  for (const topic of topics) {
    assert.equal(home(`a[href="/${topic}/"]`).length > 0, true, topic);
    const sources = (await readdir(`${directory}/docs/${topic}`)).filter(name => name.endsWith('.md'));
    for (const source of sources) {
      const route = source === 'README.md' ? '' : `${source.slice(0, -3)}/`;
      const html = load(await readFile(`${directory}/dist/${topic}/${route}index.html`, 'utf8'));
      assert.equal(html('main h1').length, 1, `${topic}/${source}`);
      assert.ok(html('main').text().length > 100, `${topic}/${source}`);
    }
    assert.deepEqual(await navTitles(directory, topic), await readingOrderTitles(directory, topic), `${topic}: navigation follows the index reading order`);
  }
});

const sampleDocs = 'docs/linux';

for (const scenario of [
  { name: '缺少文章標題', edit: async dir => {
    const file = `${dir}/${sampleDocs}/graphql-short.md`;
    await writeFile(file, (await readFile(file, 'utf8')).replace('# GraphQL 範例短文', 'GraphQL 範例短文'));
  }, error: /graphql-short\.md: expected exactly one nonempty H1 title/ },
  { name: '公開網址衝突', edit: async dir => {
    await mkdir(`${dir}/${sampleDocs}/graphql-short`);
    await writeFile(`${dir}/${sampleDocs}/graphql-short/README.md`, '# Duplicate route\n');
  }, error: /Public URL collision \/linux\/graphql-short\// },
  { name: '新文章未納入主題索引', edit: async dir => {
    await writeFile(`${dir}/${sampleDocs}/unlisted.md`, '# 未列入索引\n');
  }, error: /README\.md: missing document in reading order: docs\/linux\/unlisted\.md/ },
]) {
  test(`建置拒絕${scenario.name}並指出問題`, async t => {
    const dir = await fixture(t);
    await scenario.edit(dir);
    const result = build(dir, '/academy/');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, scenario.error);
  });
}

test('根路徑與子路徑的正式網站透過一般 HTTP 可直接閱讀，標題變更不改網址', async t => {
  const { chromium } = await import('@playwright/test');
  const dir = await fixture(t);
  const article = `${dir}/${sampleDocs}/graphql-short.md`;
  const renderingExamples = [
    '', '## 管線驗收', '', '前文**單次查詢只需三次 I/O。**後文', '',
    '3~4 層高，3~4 次 I/O', '',
    '| 欄位 | 數值 |', '| --- | --- |', '| 範例 | 42 |', '',
    '```text', 'echo "$HOME"', '  <tag> & value', '```', '',
    '[驗收錨點](#管線驗收)', '', '## 管線驗收', '', '重複標題仍有獨立錨點。',
  ].join('\n');
  await writeFile(article, (await readFile(article, 'utf8')).replace('# GraphQL 範例短文', '# GraphQL 範例短文與核心') + renderingExamples);
  // The fixture copy has no internal documents, so plant some: none of them may ever be published.
  await mkdir(`${dir}/docs/adr`, { recursive: true });
  await writeFile(`${dir}/docs/adr/0001-sample.md`, '# 範例決策\n');
  await writeFile(`${dir}/docs/site-design.md`, '# 範例網站設計\n');
  await writeFile(`${dir}/docs/notes.md`, '# 非主題文件\n');
  await writeFile(`${dir}/PLAN.md`, '# 範例計畫\n');
  await writeFile(`${dir}/GLOSSARY.md`, '# 範例詞彙表\n');
  const internalFiles = ['PLAN.md', 'GLOSSARY.md', 'docs/adr/0001-sample.md', 'docs/site-design.md', 'docs/notes.md', 'adr/0001-sample.md', 'linux/graphql-short.md'];
  const linuxTitle = await titleOf(`${dir}/docs/linux/README.md`);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const base of ['/', '/academy/']) {
    const result = build(dir, base);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const rendered = load(await readFile(`${dir}/dist/linux/graphql-short/index.html`, 'utf8'));
    assert.ok(rendered('strong').toArray().some(node => rendered(node).text() === '單次查詢只需三次 I/O。'));
    assert.ok(rendered('p').toArray().some(node => rendered(node).text() === '3~4 層高，3~4 次 I/O'));
    assert.ok(rendered('table').toArray().some(node => rendered(node).find('th').length === 2 && rendered(node).find('td').last().text() === '42'));
    assert.ok(rendered('pre code').toArray().some(node => rendered(node).text() === 'echo "$HOME"\n  <tag> & value\n'));
    assert.deepEqual(rendered('h2').toArray().filter(node => rendered(node).text() === '管線驗收').map(node => rendered(node).attr('id')), ['管線驗收', '管線驗收-1']);
    const url = await serve(t, dir, base);
    const origin = new URL(url).origin;
    const page = await browser.newPage({ javaScriptEnabled: false });
    const response = await page.goto(`${origin}${base}linux/graphql-short/`);
    assert.equal(response.status(), 200);
    assert.equal(await page.locator('article h1').textContent(), 'GraphQL 範例短文與核心');
    await page.reload();
    assert.match(await page.locator('article').textContent(), /重複標題仍有獨立錨點/);
    await page.getByRole('link', { name: '範例長篇文章', exact: true }).first().click();
    assert.equal(new URL(page.url()).pathname, `${base}linux/long-article/`);
    await page.goto(`${origin}${base}`);
    await page.getByRole('link', { name: linuxTitle, exact: true }).click();
    assert.equal(new URL(page.url()).pathname, `${base}linux/`);
    const order = await page.locator('nav[aria-label="本主題文件"] ol a').allTextContents();
    assert.deepEqual(order, await readingOrderTitles(dir, 'linux'));
    for (const topic of topics) {
      const fragment = slug(await titleOf(`${dir}/docs/${topic}/README.md`));
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
    for (const internal of internalFiles) {
      const response = await fetch(`${origin}${base}${internal}`);
      await response.arrayBuffer();
      assert.equal(response.status, 404, internal);
    }
    await page.close();
  }
});
