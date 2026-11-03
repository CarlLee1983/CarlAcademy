export const siteName = 'CarlAcademy';
export const siteDescription = 'Linux、AWS、API、關聯式資料庫與 Web 應用資安知識，從基礎概念循序閱讀，也能直接查找工程與技術問題。';

// Deployment paths belong to BASE_PATH; rejecting them here prevents silently lost prefixes.
export function siteOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('SITE_URL must be an absolute HTTP(S) origin.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SITE_URL must be an HTTP(S) origin without credentials, path, query or fragment; use BASE_PATH for a subpath.');
  }
  return url.origin;
}

export function descriptionText(summary = siteDescription) {
  const text = summary.replace(/\s+/g, ' ').trim() || siteDescription;
  const characters = Array.from(text);
  return characters.length > 160 ? characters.slice(0, 159).join('') + '…' : text;
}

export function jsonLd(value: unknown) {
  // Content titles and summaries are source text, never executable script markup.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
