for (const frame of document.querySelectorAll<HTMLElement>('.code-frame')) {
  const pre = frame.querySelector<HTMLPreElement>('pre')!;
  const code = pre.querySelector('code')!;
  const original = code.textContent ?? '';
  const copy = frame.querySelector<HTMLButtonElement>('[data-code-action="copy"]')!;
  const wrap = frame.querySelector<HTMLButtonElement>('[data-code-action="wrap"]');
  const status = frame.querySelector<HTMLElement>('[role="status"]')!;
  const edge = () => frame.classList.toggle('has-more', pre.scrollWidth - pre.clientWidth - pre.scrollLeft > 2);
  const measure = () => {
    // Measure unwrapped content so the reader can always switch wrapping off.
    const wrapped = frame.classList.contains('is-wrapped');
    frame.classList.remove('is-wrapped');
    const overflowing = pre.scrollWidth > pre.clientWidth + 1;
    frame.classList.toggle('is-wrapped', wrapped && overflowing);
    if (wrap) {
      wrap.hidden = !overflowing;
      wrap.setAttribute('aria-pressed', String(wrapped && overflowing));
    }
    edge();
  };
  copy.disabled = false;
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(original);
      copy.textContent = '已複製';
      status.textContent = '已複製程式碼';
    } catch {
      copy.textContent = '無法複製';
      status.textContent = '無法複製，請選取程式碼手動複製';
    } finally {
      copy.disabled = false;
    }
  });
  if (wrap) {
    wrap.disabled = false;
    wrap.addEventListener('click', () => {
      frame.classList.toggle('is-wrapped');
      pre.scrollLeft = 0;
      measure();
    });
  }
  pre.addEventListener('scroll', edge, { passive: true });
  new ResizeObserver(measure).observe(pre);
  document.fonts.ready.then(measure);
  measure();
}
