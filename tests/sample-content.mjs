import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sampleDocsRoot } from './helpers.mjs';

// Expected values for UI tests are read from the sample Markdown, never typed into the tests.

export function sampleSource(relative) {
  return readFile(path.join(sampleDocsRoot, relative), 'utf8');
}

export async function title(relative) {
  return (await sampleSource(relative)).match(/^# (.+)$/m)[1];
}

// Articles of a topic in the order its index recommends, as { title, source, route } (route has no base).
export async function readingOrder(topic = 'linux') {
  const readme = await sampleSource(`${topic}/README.md`);
  const section = readme.split(/^## /m).find(part => part.startsWith('建議閱讀順序'));
  return [...section.matchAll(/\[([^\]]+)\]\(([^)]+)\.md\)/g)].map(([, text, file]) => ({ title: text, source: `${topic}/${file}.md`, route: `${topic}/${file}/` }));
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
