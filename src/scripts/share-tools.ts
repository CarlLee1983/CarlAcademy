for (const tools of document.querySelectorAll<HTMLElement>('[data-share-tools]')) {
  const url = new URL(tools.dataset.url || window.location.href);
  url.search = '';
  url.hash = '';
  const shareUrl = url.href;
  const title = tools.dataset.title ?? '';
  const description = tools.dataset.description ?? '';
  const status = tools.querySelector<HTMLElement>('[role="status"]')!;
  const fallback = tools.querySelector<HTMLLabelElement>('.share-fallback')!;
  const input = fallback.querySelector<HTMLInputElement>('input')!;
  input.value = shareUrl;
  const links = tools.querySelector<HTMLElement>('[data-share-links]')!;
  // Without a configured canonical origin, resolve outbound links in the browser.
  if (!tools.dataset.url) {
    for (const [label, href] of [
      ['LINE', `https://social-plugins.line.me/lineit/share?${new URLSearchParams({ url: shareUrl })}`],
      ['Facebook', `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: shareUrl })}`],
      ['X', `https://twitter.com/intent/tweet?${new URLSearchParams({ text: title, url: shareUrl })}`],
    ]) {
      const link = links.querySelector<HTMLAnchorElement>(`[data-share-platform="${label}"]`)!;
      link.href = href;
    }
    links.hidden = false;
  }
  const copy = tools.querySelector<HTMLButtonElement>('[data-share-copy]')!;
  copy.hidden = false;
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    status.textContent = '';
    fallback.hidden = true;
    try {
      await navigator.clipboard.writeText(shareUrl);
      status.textContent = '已複製本文連結';
    } catch {
      fallback.hidden = false;
      status.textContent = '無法自動複製，請選取下方連結手動複製。';
      input.focus();
      input.select();
    } finally {
      copy.disabled = false;
    }
  });
  const native = tools.querySelector<HTMLButtonElement>('[data-share-native]')!;
  if (typeof navigator.share === 'function') {
    native.hidden = false;
    native.addEventListener('click', async () => {
      native.disabled = true;
      status.textContent = '';
      try {
        await navigator.share({ title, text: description, url: shareUrl });
        status.textContent = '已完成分享';
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          status.textContent = '無法開啟分享，請使用複製連結或下方平台連結。';
        }
      } finally {
        native.disabled = false;
      }
    });
  }
}
