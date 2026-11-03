export {};
interface SearchData { url: string; meta: { title?: string; topic?: string }; excerpt: string }
interface SearchModule { options: (options: { baseUrl: string }) => Promise<void>; search: (query: string) => Promise<{ results: { data: () => Promise<SearchData> }[] }> }
const dialog = document.querySelector<HTMLDialogElement>('#search-dialog')!;
const input = dialog.querySelector<HTMLInputElement>('input')!;
const status = dialog.querySelector<HTMLElement>('[role=status]')!;
const results = dialog.querySelector<HTMLOListElement>('.search-results')!;
const retry = dialog.querySelector<HTMLButtonElement>('[data-search-retry]')!;
let opener: HTMLElement | null = null;
let modulePromise: Promise<SearchModule> | undefined;
let attempt = 0;
let revision = 0;
let timer: ReturnType<typeof setTimeout>;
function loadIndex() {
  if (!modulePromise) {
    // A fresh module URL also lets the browser retry a rejected dynamic import.
    const url = `${dialog.dataset.searchModule}?attempt=${attempt++}`;
    modulePromise = import(/* @vite-ignore */ url).then(async engine => { await engine.options({ baseUrl: dialog.dataset.searchBase! }); return engine; }).catch(error => { modulePromise = undefined; throw error; });
  }
  return modulePromise!;
}
function excerptNodes(excerpt: string) {
  // Only accept Pagefind's highlight element. All other markup remains inert text.
  const fragment = document.createDocumentFragment();
  const parsed = new DOMParser().parseFromString(excerpt, 'text/html');
  function append(parent: Node, node: Node) {
    if (node.nodeType === Node.TEXT_NODE) parent.appendChild(document.createTextNode(node.textContent || ''));
    else {
      const target = node instanceof Element && node.tagName === 'MARK' ? document.createElement('mark') : parent;
      for (const child of node.childNodes) append(target, child);
      if (target !== parent) parent.appendChild(target);
    }
  }
  for (const node of parsed.body.childNodes) append(fragment, node);
  return fragment;
}
async function search() {
  const current = ++revision;
  const query = input.value.trim();
  results.replaceChildren(); retry.hidden = true;
  if (!query) { status.textContent = '輸入關鍵字，搜尋標題與正文。'; return; }
  status.textContent = '正在搜尋…';
  try {
    const engine = await loadIndex();
    const found = await engine.search(query);
    const entries = await Promise.all(found.results.map(result => result.data()));
    if (current !== revision) return;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const url = new URL(entry.url, location.origin);
      if (url.origin !== location.origin) continue;
      const li = document.createElement('li');
      const link = document.createElement('a'); link.href = url.pathname + url.hash;
      const topic = document.createElement('span'); topic.className = 'result-topic'; topic.textContent = entry.meta.topic || '所有主題';
      const title = document.createElement('span'); title.className = 'result-title'; title.textContent = entry.meta.title || '文件';
      const excerpt = document.createElement('p'); excerpt.className = 'result-excerpt'; excerpt.append(excerptNodes(entry.excerpt));
      link.append(topic, title, excerpt); li.append(link); fragment.append(li);
    }
    results.append(fragment);
    status.textContent = entries.length ? `找到 ${entries.length} 篇文件` : '找不到符合的文件，請試試其他關鍵字。';
  } catch {
    if (current !== revision) return;
    status.textContent = '搜尋索引載入失敗，請檢查連線後重試。'; retry.hidden = false;
  }
}
function open(element: HTMLElement, query = '') {
  opener = element; input.value = query; dialog.showModal(); input.focus(); void search();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-search-open]')) {
  button.hidden = false; button.addEventListener('click', () => open(button));
}
for (const form of document.querySelectorAll<HTMLFormElement>('[data-search-form]')) {
  form.hidden = false;
  form.addEventListener('submit', event => { event.preventDefault(); open(form.querySelector('button')!, String(new FormData(form).get('query') || '')); });
}
dialog.querySelector('[data-search-close]')!.addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { ++revision; clearTimeout(timer); opener?.focus(); });
input.addEventListener('input', () => { ++revision; clearTimeout(timer); timer = setTimeout(() => void search(), 120); });
retry.addEventListener('click', () => { modulePromise = undefined; void search(); });
