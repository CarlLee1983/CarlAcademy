import type { APIRoute } from 'astro';
import { withBase } from '../utils/urls';

export const GET: APIRoute = ({ site }) => new Response(site
  ? `User-agent: *\nAllow: /\nSitemap: ${new URL(withBase('/sitemap.xml', import.meta.env.BASE_URL), site).href}\n`
  : 'User-agent: *\nDisallow: /\n', {
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});
