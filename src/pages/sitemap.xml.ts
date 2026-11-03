import type { APIRoute } from 'astro';
import { getDocuments } from '../utils/collections';
import { withBase } from '../utils/urls';

export const GET: APIRoute = async ({ site }) => {
  const routes = site ? ['/', ...(await getDocuments()).map(entry => entry.data.route)] : [];
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const urls = routes.map(route => `<url><loc>${escape(new URL(withBase(route, import.meta.env.BASE_URL), site).href)}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
