import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readDocuments } from './utils/documents';

const documents = defineCollection({
  loader: {
    name: 'public-markdown-documents',
    async load(context) {
      const sync = async () => {
        const documents = await readDocuments();
        context.store.clear();
        for (const document of documents) {
          const { body, links: _links, ...metadata } = document;
          const data = await context.parseData({ id: document.source, data: metadata, filePath: document.source });
          const rendered = await context.renderMarkdown(body, { fileURL: pathToFileURL(path.resolve(document.source)) });
          context.store.set({ id: document.source, data, body, filePath: document.source, rendered });
        }
      };
      await sync();
      if (context.watcher) {
        let pending = Promise.resolve();
        const onChange = (file: string) => {
          if (file.endsWith('.md') && path.resolve(file).startsWith(path.resolve('docs') + path.sep)) {
            // A single queue owns the collection store, including rapid editor saves.
            pending = pending.then(sync).catch(error => { context.logger.error(String(error)); });
          }
        };
        context.watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
      }
    },
  },
  schema: z.object({
    source: z.string().min(1), topic: z.string().min(1), route: z.string().min(1),
    title: z.string().min(1), summary: z.string(), isIndex: z.boolean(), order: z.number().int(),
  }),
});
export const collections = { documents };
