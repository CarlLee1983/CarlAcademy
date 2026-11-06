import path from 'node:path';

export const topics = ['linux', 'aws', 'api', 'relational-databases', 'web-security', 'networking', 'distributed-systems', 'event-driven-architecture', 'caching'] as const;

export function normalizeBase(base = '/') {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*\/?$/.test(base)) {
    throw new Error(`Invalid base path: ${base}. Use / or /segment/.`);
  }
  return base === '/' ? '/' : `/${base.split('/').filter(Boolean).join('/')}/`;
}

export function withBase(route: string, base = '/') {
  return normalizeBase(base) + route.replace(/^\//, '');
}

export function sourceRoute(source: string): string {
  if (source === 'README.md') return '/';
  const parts = source.split('/');
  if (parts[0] !== 'docs' || !topics.some(topic => topic === parts[1]) || !source.endsWith('.md')) {
    throw new Error(`Not a public document: ${source}`);
  }
  const route = parts.slice(1).join('/').replace(/\.md$/, '').replace(/(?:^|\/)README$/, '');
  if (!route.split('/').filter(Boolean).every(part => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))) {
    throw new Error(`Public document needs an English source path: ${source}`);
  }
  return `/${route.replace(/\/$/, '')}/`;
}

// Resolve source paths before adding the deployment base, so Markdown remains portable.
export function documentLink(href: string, source: string, base: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || href.startsWith('#')) return href;
  const match = href.match(/^([^?#]*)(.*)$/);
  if (!match) throw new Error(`Invalid link in ${source}: ${href}`);
  const [, pathname, suffix] = match;
  if (pathname.startsWith('/')) return withBase(pathname, base) + suffix;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), decodeURIComponent(pathname)));
  return withBase(sourceRoute(target), base) + suffix;
}
