export {};

const readingNavigation = document.querySelector<HTMLElement>('.reading-navigation');
const body = document.querySelector<HTMLElement>('#article-body');
const masthead = document.querySelector<HTMLElement>('.article-masthead');
if (readingNavigation && body && masthead) {
  const progress = readingNavigation.querySelector<HTMLElement>('.reading-progress')!;
  const headings = [...body.querySelectorAll<HTMLElement>('h2[id],h3[id],h4[id],h5[id],h6[id]')];
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-article-toc] a, .toc-sheet a')];
  const bar = readingNavigation.querySelector<HTMLElement>('.reading-bar')!;
  const label = readingNavigation.querySelector<HTMLElement>('.reading-bar-section')!;
  const trigger = readingNavigation.querySelector<HTMLButtonElement>('.reading-bar-toc')!;
  const sheet = readingNavigation.querySelector<HTMLDialogElement>('.toc-sheet')!;
  const phone = matchMedia('(max-width: 700px)');
  progress.hidden = false;
  bar.hidden = false;
  trigger.addEventListener('click', () => {
    sheet.showModal();
    trigger.setAttribute('aria-expanded', 'true');
  });
  sheet.querySelector<HTMLButtonElement>('.toc-sheet-close')!.addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
  });
  sheet.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
    link.addEventListener('click', event => {
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (!target) return;
      event.preventDefault();
      sheet.close();
      history.pushState(null, '', link.hash);
      // A heading is the keyboard continuation point after leaving the modal.
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
      schedule();
    });
  });
  phone.addEventListener('change', () => { if (!phone.matches && sheet.open) sheet.close(); });
  let frame = 0;
  const update = () => {
    frame = 0;
    const box = body.getBoundingClientRect();
    const read = Math.min(1, Math.max(0, -box.top / Math.max(1, box.height - innerHeight * 0.6)));
    readingNavigation.style.setProperty('--read', String(read));
    progress.setAttribute('aria-valuenow', String(Math.round(read * 100)));
    let current: HTMLElement | undefined;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= 120) current = heading;
      else break;
    }
    bar.classList.toggle('is-visible', masthead.getBoundingClientRect().bottom < 0);
    label.textContent = current?.textContent ?? '開頭';
    for (const link of links) {
      if (decodeURIComponent(link.hash.slice(1)) === current?.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(body);
  document.fonts.ready.then(schedule);
  update();
}
