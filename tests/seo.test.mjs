import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { load } from 'cheerio';
import { baseline, sampleBaseline, sampleDocsRoot } from './helpers.mjs';
import { siteOrigin, descriptionText, jsonLd } from '../src/utils/seo.ts';

const origin = 'https://academy.gravito.dev';
for (const base of ['/', '/academy/']) {
  test(`SEO 與網站地圖完整涵蓋公開頁面 (${base})`, async t => {
    const { directory } = await baseline(t, base);
    const names = (await readdir(`${directory}/dist`, { recursive: true })).filter(name => name.endsWith('index.html'));
    const sitemap = load(await readFile(`${directory}/dist/sitemap.xml`, 'utf8'), { xmlMode: true });
    const locations = sitemap('loc').map((_, node) => sitemap(node).text()).get();
    assert.equal(new Set(locations).size, names.length);
    assert.equal(locations.length, names.length);
    const descriptions = new Set();
    for (const name of names) {
      const $ = load(await readFile(`${directory}/dist/${name}`, 'utf8'));
      const url = origin + base + name.replace(/index\.html$/, '');
      assert.equal($('link[rel="canonical"]').attr('href'), url, name);
      assert.ok(locations.includes(url), name);
      const description = $('meta[name="description"]').attr('content');
      assert.ok(description?.length > 10, name);
      assert.ok(Array.from(description).length <= 160, name);
      descriptions.add(description);
      assert.equal($('meta[property="og:description"]').attr('content'), description);
      assert.equal($('meta[name="twitter:description"]').attr('content'), description);
      assert.equal($('meta[property="og:title"]').attr('content'), $('title').text());
      assert.equal($('meta[property="og:url"]').attr('content'), url);
      assert.equal($('meta[property="og:image"]').attr('content'), origin + base + 'social-card.png');
      assert.equal($('meta[name="twitter:image"]').attr('content'), origin + base + 'social-card.png');
      assert.equal($('meta[name="twitter:card"]').attr('content'), 'summary_large_image');
      assert.equal($('meta[name="robots"]').length, 0);
      assert.equal($('link[rel="sitemap"]').attr('href'), base + 'sitemap.xml');
      const structured = JSON.parse($('script[type="application/ld+json"]').text());
      const page = structured['@graph'][0];
      assert.equal(page.url, url);
      assert.equal(page.description, description);
      const article = name.split('/').length > 2;
      assert.equal(page['@type'], article ? 'TechArticle' : name === 'index.html' ? 'WebSite' : 'CollectionPage');
      assert.equal($('meta[property="og:type"]').attr('content'), article ? 'article' : 'website');
      if (name !== 'index.html') {
        const crumbs = structured['@graph'][1].itemListElement;
        assert.equal(crumbs.length, article ? 3 : 2);
        assert.equal(crumbs[0].item, origin + base);
        assert.equal(crumbs.at(-1).item, url);
        assert.deepEqual(crumbs.map(crumb => crumb.position), article ? [1, 2, 3] : [1, 2]);
      }
    }
    assert.ok(descriptions.size > names.length * .9, 'Page-specific summaries');
    assert.match(await readFile(`${directory}/dist/robots.txt`, 'utf8'), new RegExp(`Sitemap: ${origin}${base}sitemap.xml`));
    const png = await readFile(`${directory}/dist/social-card.png`);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  });
}

test('未設定正式網域的預覽不產生假的 canonical、社群圖片與網站地圖 URL', async t => {
  const { directory } = await sampleBaseline(t, { siteUrl: '' });
  const [article] = (await readdir(`${sampleDocsRoot}/linux`)).filter(name => name.endsWith('.md') && name !== 'README.md');
  const $ = load(await readFile(`${directory}/dist/linux/${article.slice(0, -3)}/index.html`, 'utf8'));
  assert.equal($('link[rel="canonical"], meta[property="og:url"], meta[property="og:image"], script[type="application/ld+json"]').length, 0);
  assert.equal($('meta[name="robots"]').attr('content'), 'noindex, follow');
  assert.equal(await readFile(`${directory}/dist/robots.txt`, 'utf8'), 'User-agent: *\nDisallow: /\n');
  assert.equal(load(await readFile(`${directory}/dist/sitemap.xml`, 'utf8'), { xmlMode: true })('loc').length, 0);
});

test('網域設定拒絕模糊路徑與非 HTTP 網址；來源文字不會突破 JSON-LD script', () => {
  assert.equal(siteOrigin('https://academy.gravito.dev/'), origin);
  assert.equal(siteOrigin(''), undefined);
  for (const value of ['not-a-url', 'javascript:alert(1)', 'https://example.test/academy/', 'https://user:secret@example.test', 'https://example.test/?q=1', 'https://example.test/#hash']) {
    assert.throws(() => siteOrigin(value), /SITE_URL/);
  }
  const malicious = { name: '</script><script>alert("x")</script> & 中文' };
  assert.ok(!jsonLd(malicious).includes('<'));
  assert.deepEqual(JSON.parse(jsonLd(malicious)), malicious);
  assert.equal(Array.from(descriptionText('字'.repeat(200))).length, 160);
  assert.equal(descriptionText('  第一行\n 第二行  '), '第一行 第二行');
  assert.ok(descriptionText(' ').length > 10);
});
