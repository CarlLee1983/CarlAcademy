import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import remarkDocumentLinks from './src/utils/remark-document-links';
import rehypeTables from './src/utils/rehype-tables';
import { normalizeBase } from './src/utils/urls';

const base = normalizeBase(process.env.BASE_PATH ?? '/');
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  base,
  markdown: {
    processor: unified({
      gfm: false,
      smartypants: false,
      remarkPlugins: [remarkCjkFriendly, [remarkGfm, { singleTilde: false }], [remarkDocumentLinks, { base }]],
      rehypePlugins: [rehypeTables],
    }),
    syntaxHighlight: false,
  },
});
