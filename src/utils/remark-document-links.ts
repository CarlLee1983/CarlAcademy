import path from 'node:path';
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { documentLink } from './urls';

const remarkDocumentLinks: Plugin<[{ base?: string }?], Root> = ({ base = '/' } = {}) => {
  return (tree, file) => {
    const source = path.relative(process.cwd(), file.path).split(path.sep).join('/');
    visit(tree, node => {
      if (node.type === 'link' || node.type === 'definition' || node.type === 'image') {
        try {
          node.url = documentLink(node.url, source, base);
        } catch (error) {
          file.fail(`${source}: ${node.url}: ${error instanceof Error ? error.message : String(error)}`, node);
        }
      }
    });
  };
};

export default remarkDocumentLinks;
