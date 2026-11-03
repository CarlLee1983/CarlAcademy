import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';

export async function verifyOutput(directory = 'dist', base = '/') {
  const root = path.resolve(directory);
  const names = await readdir(root, { recursive: true });
  const pages = new Map();
  const basePath = base.endsWith('/') ? base : `${base}/`;
  for (const name of names) {
    if (/\.(md|mdx|map)$/.test(name) || /(?:^|\/)(?:adr|agents|prototype|\.scratch)(?:\/|$)/.test(name)) {
      throw new Error(`Internal source in public output: ${name}`);
    }
    if (name.endsWith('.html')) pages.set(path.resolve(root, name), load(await readFile(path.join(root, name), 'utf8')));
  }
  if (!pages.has(path.join(root, 'index.html'))) throw new Error('Missing public homepage');
  for (const [file, $] of pages) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const route = basePath + relative.replace(/index\.html$/, '');
    const ids = new Set();
    $('[id]').each((_, node) => {
      const id = $(node).attr('id');
      if (ids.has(id)) throw new Error(`${relative}: duplicate HTML id ${id}`);
      ids.add(id);
    });
    for (const node of $('[href], [src]').toArray()) {
      for (const attr of ['href', 'src']) {
        const ref = $(node).attr(attr);
        if (!ref) continue;
        if (/^(?:https?:|mailto:|tel:|\/\/)/i.test(ref)) continue;
        const url = new URL(ref, `http://static.test${route}`);
        if (url.protocol !== 'http:' || url.origin !== 'http://static.test' || !url.pathname.startsWith(basePath)) {
          throw new Error(`${relative}: reference outside deployment base: ${ref}`);
        }
        const target = decodeURIComponent(url.pathname.slice(basePath.length));
        let targetFile = path.resolve(root, target + (url.pathname.endsWith('/') ? 'index.html' : ''));
        if (!targetFile.startsWith(root + path.sep)) throw new Error(`${relative}: unsafe reference: ${ref}`);
        if (!names.includes(path.relative(root, targetFile))) throw new Error(`${relative}: missing target: ${ref}`);
        // Ordinary static servers redirect directory URLs to their index page.
        if ((await stat(targetFile)).isDirectory()) {
          targetFile = path.join(targetFile, 'index.html');
          if (!pages.has(targetFile)) throw new Error(`${relative}: missing directory index: ${ref}`);
        }
        if (url.hash && pages.has(targetFile)) {
          const fragment = decodeURIComponent(url.hash.slice(1));
          const targetPage = pages.get(targetFile);
          const found = targetPage('[id], a[name]').toArray().some(node => targetPage(node).attr('id') === fragment || targetPage(node).attr('name') === fragment);
          if (!found) throw new Error(`${relative}: missing anchor: ${ref}`);
        }
      }
    }
  }
  console.log(`Verified ${pages.size} static pages, internal targets and anchors (base ${basePath})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await verifyOutput(process.argv[2] ?? 'dist', process.env.BASE_PATH ?? '/');
}
