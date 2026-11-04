import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyOutput } from '../scripts/verify-output.mjs';

// A small hand-written dist directory: `files` maps relative paths to contents.
async function dist(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'carlacademy-dist-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  return root;
}

const page = body => `<!doctype html><html><body>${body}</body></html>`;
const bases = ['/', '/academy/'];
const prefix = base => base.slice(0, -1);

async function rejects(directory, base, message) {
  await assert.rejects(() => verifyOutput(directory, base), message);
}

test('輸出驗證器接受參照、目錄網址與段落錨點都正確的產物', async t => {
  for (const base of bases) {
    const root = await dist(t, {
      'index.html': page(`<a href="${prefix(base)}/linux/#intro">linux</a><img src="${prefix(base)}/logo.svg">`),
      'linux/index.html': page('<h1 id="intro">Linux</h1><a href="../">home</a>'),
      'logo.svg': '<svg/>',
    });
    await verifyOutput(root, base);
  }
});

test('輸出驗證器拒絕公開輸出中的內部來源', async t => {
  // A forbidden directory is reported by its own name, which is the first entry readdir lists.
  for (const [internal, reported] of [['notes.md', 'notes.md'], ['index.js.map', 'index.js.map'], ['adr/0001.html', 'adr'], ['agents/x.txt', 'agents']]) {
    const root = await dist(t, { 'index.html': page(''), [internal]: 'x' });
    await rejects(root, '/', new RegExp(`Internal source in public output: ${reported.replace('.', '\\.')}$`));
  }
});

test('輸出驗證器拒絕缺少網站首頁的產物', async t => {
  const root = await dist(t, { 'linux/index.html': page('') });
  await rejects(root, '/', /Missing public homepage/);
});

test('輸出驗證器拒絕重複的 HTML id 並指出頁面', async t => {
  const root = await dist(t, { 'index.html': page('<a href="/linux/">l</a>'), 'linux/index.html': page('<h2 id="dup">a</h2><h2 id="dup">b</h2>') });
  await rejects(root, '/', /linux\/index\.html: duplicate HTML id dup/);
});

test('輸出驗證器拒絕部署路徑以外的參照', async t => {
  const outside = await dist(t, { 'index.html': page('<a href="/other/">x</a>') });
  await rejects(outside, '/academy/', /index\.html: reference outside deployment base: \/other\//);
  const protocol = await dist(t, { 'index.html': page('<a href="ftp://host/file">x</a>') });
  await rejects(protocol, '/', /index\.html: reference outside deployment base: ftp:\/\/host\/file/);
});

test('輸出驗證器拒絕逃出輸出目錄的參照', async t => {
  for (const base of bases) {
    const root = await dist(t, { 'index.html': page(`<a href="${prefix(base)}/..%2F..%2Fsecret">x</a>`) });
    await rejects(root, base, /index\.html: unsafe reference: .*secret/);
  }
});

test('輸出驗證器拒絕指向不存在文章的連結', async t => {
  for (const base of bases) {
    const root = await dist(t, { 'index.html': page(`<a href="${prefix(base)}/linux/missing-document/">不存在</a>`), 'linux/index.html': page('') });
    await rejects(root, base, /index\.html: missing target: .*\/linux\/missing-document\//);
  }
});

test('輸出驗證器拒絕缺少索引頁的目錄網址', async t => {
  for (const base of bases) {
    const root = await dist(t, { 'index.html': page(`<a href="${prefix(base)}/guide">指南</a>`), 'guide/page.html': page('') });
    await rejects(root, base, /index\.html: missing directory index: .*\/guide/);
  }
});

test('輸出驗證器拒絕指向不存在段落的連結', async t => {
  for (const base of bases) {
    const root = await dist(t, {
      'index.html': page(`<a href="${prefix(base)}/linux/terminal/#absent-section">不存在的段落</a>`),
      'linux/index.html': page(''),
      'linux/terminal/index.html': page('<h2 id="present">x</h2>'),
    });
    await rejects(root, base, /index\.html: missing anchor: .*\/linux\/terminal\/#absent-section/);
  }
});

test('目錄網址也檢查實際索引頁的段落錨點', async t => {
  for (const base of bases) {
    const files = { 'linux/index.html': page('<h1 id="reading-order">建議閱讀</h1>') };
    await verifyOutput(await dist(t, { ...files, 'index.html': page(`<a href="${prefix(base)}/linux#reading-order">ok</a>`) }), base);
    const broken = await dist(t, { ...files, 'index.html': page(`<a href="${prefix(base)}/linux#absent-section">bad</a>`) });
    await rejects(broken, base, /index\.html: missing anchor: .*linux#absent-section/);
  }
});
