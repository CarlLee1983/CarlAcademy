import { readingPreferences } from '../utils/reading-preferences';

const dialog = document.querySelector<HTMLDialogElement>('#reading-settings');
const body = document.querySelector<HTMLElement>('#article-body');
if (dialog && body) {
  const root = document.documentElement;
  const size = dialog.querySelector<HTMLInputElement>('#reading-font-size')!;
  const lineHeight = dialog.querySelector<HTMLSelectElement>('#reading-line-height')!;
  const width = dialog.querySelector<HTMLSelectElement>('#reading-column-width')!;
  const output = dialog.querySelector<HTMLOutputElement>('#reading-size-output')!;
  const status = dialog.querySelector<HTMLElement>('[role="status"]')!;
  const summary = document.querySelector<HTMLElement>('.reading-settings-summary')!;
  const triggers = [...document.querySelectorAll<HTMLButtonElement>('[data-reading-settings]')];
  let opener: HTMLButtonElement | undefined;
  let state = {
    size: Number(root.dataset.readingSize) || readingPreferences.defaults.size,
    lineHeight: Number(root.dataset.readingLineHeight) || readingPreferences.defaults.lineHeight,
    width: Number(root.dataset.readingWidth) || readingPreferences.defaults.width,
  };

  function apply(persist = false) {
    // Anchor the first visible content block, rather than the document's scroll ratio.
    const anchor = [...body!.children].find(node => node.getBoundingClientRect().bottom > 80);
    const top = anchor?.getBoundingClientRect().top;
    const isReading = anchor && top !== undefined && top < innerHeight && body!.getBoundingClientRect().top < 80;
    root.style.setProperty('--reading-font-size', `${state.size / 16}rem`);
    root.style.setProperty('--reading-line-height', String(state.lineHeight));
    root.style.setProperty('--reading-column-width', `${state.width}px`);
    root.dataset.readingSize = String(state.size);
    root.dataset.readingLineHeight = String(state.lineHeight);
    root.dataset.readingWidth = String(state.width);
    size.value = String(state.size);
    lineHeight.value = String(state.lineHeight);
    width.value = String(state.width);
    output.value = `${state.size}px`;
    summary.textContent = `${state.size}px · ${state.lineHeight === 1.8 ? '寬鬆' : '標準'}行距`;
    if (!persist) return;
    if (isReading) scrollBy({ top: anchor.getBoundingClientRect().top - top, behavior: 'instant' });
    try {
      localStorage.setItem(readingPreferences.key, JSON.stringify(state));
      status.textContent = '已儲存在此瀏覽器';
    } catch {
      status.textContent = '本次已套用；瀏覽器無法儲存這次調整。';
    }
  }

  for (const trigger of triggers) {
    trigger.hidden = false;
    trigger.addEventListener('click', () => {
      opener = trigger;
      dialog.showModal();
      trigger.setAttribute('aria-expanded', 'true');
    });
  }
  dialog.querySelectorAll<HTMLButtonElement>('[data-reading-settings-close]').forEach(button => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('close', () => {
    triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
    // A layout change can hide the mobile trigger while its dialog is open.
    const target = opener?.checkVisibility({ visibilityProperty: true }) ? opener : triggers.find(trigger => trigger.checkVisibility({ visibilityProperty: true }));
    target?.focus({ preventScroll: true });
  });
  size.addEventListener('input', () => { state.size = Number(size.value); apply(true); });
  lineHeight.addEventListener('change', () => { state.lineHeight = Number(lineHeight.value); apply(true); });
  width.addEventListener('change', () => { state.width = Number(width.value); apply(true); });
  dialog.querySelector<HTMLButtonElement>('#reading-settings-reset')!.addEventListener('click', () => {
    state = { ...readingPreferences.defaults };
    apply(true);
  });
  apply();
}
