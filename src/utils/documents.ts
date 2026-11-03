import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import { documentLink, sourceRoute, topics } from './urls';

const parser = unified().use(remarkParse).use(remarkGfm);

export async function readDocuments() {
  const documents: { source: string; topic: string; route: string; title: string; body: string; links: string[]; isIndex: boolean; order: number }[] = [];
  const routes = new Map<string, string>();
  for (const topic of topics) {
    const dir = `docs/${topic}`;
    const files = await readdir(dir, { recursive: true });
    for (const name of files.filter(name => name.endsWith('.md')).sort()) {
      const source = `${dir}/${name.split(path.sep).join('/')}`;
      const body = await readFile(source, 'utf8');
      const tree = parser.parse(body);
      const headings = tree.children.filter(node => node.type === 'heading' && node.depth === 1);
      if (headings.length !== 1 || !toString(headings[0]).trim()) {
        throw new Error(`${source}: expected exactly one nonempty H1 title`);
      }
      const title = toString(headings[0]).trim();
      const route = sourceRoute(source);
      if (routes.has(route)) throw new Error(`Public URL collision ${route}: ${routes.get(route)} and ${source}`);
      routes.set(route, source);
      const links: string[] = [];
      visit(tree, 'link', node => { links.push(node.url); });
      documents.push({ source, topic, route, title, body, links, isIndex: name === 'README.md', order: -1 });
    }
  }
  for (const topic of topics) {
    const index = documents.find(doc => doc.topic === topic && doc.isIndex);
    if (!index) throw new Error(`docs/${topic}/README.md: missing topic index`);
    const ordered = [...new Set(index.links.filter(link => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link))
      .map(link => documentLink(link, index.source, '/').split(/[?#]/)[0]))];
    for (const doc of documents.filter(doc => doc.topic === topic && !doc.isIndex)) {
      if (!ordered.includes(doc.route)) throw new Error(`${index.source}: missing document in reading order: ${doc.source}`);
    }
    for (const doc of documents.filter(doc => doc.topic === topic)) {
      doc.order = doc.isIndex ? -1 : ordered.indexOf(doc.route);
    }
  }
  return documents;
}
