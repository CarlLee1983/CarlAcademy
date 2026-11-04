import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { sampleDocsRoot } from './helpers.mjs';

// Expected values for UI tests are read from the sample Markdown, never typed into the tests.

export function sampleSource(relative) {
  return readFile(path.join(sampleDocsRoot, relative), 'utf8');
}

const parser = unified().use(remarkParse).use(remarkGfm);

// H1 text of a Markdown file, the title the site publishes.
export async function h1Of(file) {
  const tree = parser.parse(await readFile(file, 'utf8'));
  return toString(tree.children.find(node => node.type === 'heading' && node.depth === 1)).trim();
}

// Intentionally independent restatement of the product rule in src/utils/documents.ts: every relative link in the whole topic README, deduplicated, first occurrence first.
// Articles of a topic in reading order as { title, source, route } (source and route have no docs root or base).
export async function readingOrder(topic = 'linux', docsRoot = sampleDocsRoot) {
  const directory = path.resolve(docsRoot, topic);
  const links = [];
  visit(parser.parse(await readFile(path.join(directory, 'README.md'), 'utf8')), 'link', node => { links.push(node.url); });
  const files = [];
  for (const link of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link)) continue;
    const file = path.resolve(directory, decodeURIComponent(link.split(/[?#]/)[0]));
    if (!file.startsWith(directory + path.sep) || !file.endsWith('.md') || file === path.join(directory, 'README.md')) continue;
    if (!files.includes(file)) files.push(file);
  }
  return Promise.all(files.map(async file => {
    const relative = path.relative(path.resolve(docsRoot), file).split(path.sep).join('/');
    return { title: await h1Of(file), source: relative, route: `${relative.slice(0, -3)}/` };
  }));
}

// Markdown tables in a sample file as { header, rows }, outside code fences.
export async function markdownTables(relative) {
  const lines = (await sampleSource(relative)).replace(/```[\s\S]*?```/g, '').split('\n');
  const tables = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith('|') || lines[index - 1]?.startsWith('|')) continue;
    const block = [];
    while (lines[index]?.startsWith('|')) block.push(lines[index++].slice(1, -1).split('|').map(cell => cell.trim()));
    tables.push({ header: block[0], rows: block.slice(2) });
  }
  return tables;
}

// Body of the n-th fenced block with the given language, exactly as written (whitespace included).
export async function codeBlock(relative, language, nth = 0) {
  const blocks = [...(await sampleSource(relative)).matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))];
  return blocks[nth][1];
}
