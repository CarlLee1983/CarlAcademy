import type { Root, Element, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';

const text = (value: string): ElementContent => ({ type: 'text', value });
const element = (tagName: string, properties: Element['properties'], children: ElementContent[]): Element => ({ type: 'element', tagName, properties, children });
const button = (action: string, label: string) => element('button', {
  type: 'button', className: ['code-tool'], 'data-code-action': action,
  disabled: true, ...(action === 'wrap' ? { hidden: true, 'aria-pressed': 'false' } : {}),
}, [text(label)]);

/** Keep the code node untouched: it is the source of truth for copying and no-JS reading. */
export default function rehypeCodeTools() {
  return (tree: Root) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || index === undefined || !parent) return;
      const code = node.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code');
      if (!code) return;
      const language = (code.properties.className as string[] | undefined)?.find(name => name.startsWith('language-'))?.slice(9) || 'text';
      const diagram = language === 'text' && code.children.some(child => child.type === 'text' && /[─│┌┐└┘├┤┬┴┼]/u.test(child.value));
      node.properties.tabIndex = 0;
      node.properties['aria-label'] = diagram ? '圖解，可橫向捲動' : `${language.toUpperCase()} 程式碼，可橫向捲動`;
      const tools = element('div', { className: ['code-actions'] }, [
        ...(!diagram ? [button('wrap', '換行')] : []), button('copy', '複製'),
        element('span', { className: ['code-status'], role: 'status', 'aria-live': 'polite' }, []),
      ]);
      parent.children[index] = element('figure', { className: ['code-frame', ...(diagram ? ['is-diagram'] : [])] }, [
        element('figcaption', { className: ['code-tools'], 'data-pagefind-ignore': '' }, [
          element('span', { className: ['code-language'] }, [text(diagram ? '圖解' : language.toUpperCase())]), tools,
        ]), node,
      ]);
      return index + 1;
    });
  };
}
