import type { Element, Root, RootContent, Text } from 'hast';

const element = (tagName: string, properties: Element['properties'], children: Element['children']): Element => ({ type: 'element', tagName, properties, children });
const text = (value: string): Text => ({ type: 'text', value });
const content = (node: RootContent): string => node.type === 'text' ? node.value : 'children' in node ? node.children.map(content).join('') : '';
const children = (node: Element, tagName: string): Element[] => node.children.filter((child): child is Element => child.type === 'element' && child.tagName === tagName);

/** Render card labels and tool structure once, before the static HTML is indexed. */
export default function rehypeTables() {
  return (tree: Root) => {
    let number = 0;
    const walk = (parent: Root | Element) => {
      parent.children = parent.children.map(node => {
        if (node.type !== 'element') return node;
        if (node.tagName !== 'table') {
          walk(node);
          return node;
        }
        const headers = children(node, 'thead').flatMap(head => children(head, 'tr')).flatMap(row => children(row, 'th'));
        const labels = headers.map(header => content(header).trim());
        const rows = children(node, 'tbody').flatMap(body => children(body, 'tr'));
        headers.forEach(header => { header.properties.scope = 'col'; });
        rows.forEach(row => children(row, 'td').forEach((cell, index) => { cell.properties.dataLabel = labels[index] ?? ''; }));
        const label = `表格・${labels.length} 欄 ${rows.length} 列`;
        const id = `document-table-${++number}`;
        const tools = element('div', { className: ['table-tools'], dataPagefindIgnore: '' }, [
          element('span', { className: ['table-label'] }, [text(label)]),
          element('button', { type: 'button', className: ['table-toggle'], hidden: true, ariaControls: [id], ariaPressed: 'false' }, [text('改以原表格比較')]),
        ]);
        const scroll = element('div', { id, className: ['table-scroll'], role: 'region', ariaLabel: label, tabIndex: 0 }, [node]);
        return element('div', { className: ['table-block'] }, [tools, scroll]);
      });
    };
    walk(tree);
  };
}
