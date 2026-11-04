import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Render a local, reproducible card with the website's licensed fonts; no remote assets.
const sans = (await readFile('public/fonts/noto-sans-tc.woff2')).toString('base64');
const grotesk = (await readFile('public/fonts/space-grotesk.woff2')).toString('base64');
const logo = (await readFile('public/logo.svg')).toString('base64');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>
    @font-face { font-family: Sans; src: url(data:font/woff2;base64,${sans}); }
    @font-face { font-family: Grotesk; src: url(data:font/woff2;base64,${grotesk}); }
    * { box-sizing: border-box; } body { margin:0; background:#f9fafc; color:#141c2e; font-family:Sans,sans-serif; }
    main { height:630px; padding:58px 72px; border-top:14px solid #1549d6; position:relative; }
    header { font:700 28px Grotesk,sans-serif; letter-spacing:2px; display:flex; align-items:center; gap:16px; }
    header img { width:36px; height:36px; }
    h1 { font-size:76px; line-height:1.22; letter-spacing:-3px; margin:58px 0 44px; font-weight:700; }
    footer { border-top:1px solid #c8ced9; padding-top:22px; color:#536074; font-size:21px; }
    .mark { position:absolute; top:120px; right:72px; font:700 240px Grotesk,sans-serif; color:#eef2fa; z-index:-1; }
    main { isolation:isolate; }
  </style><main><header><img src="data:image/svg+xml;base64,${logo}" alt="">CARLACADEMY</header><div class="mark">CA</div><h1>工程與技術<br>知識，循序累積。</h1><footer>Linux · AWS · API · 關聯式資料庫 · Web 應用資安</footer></main></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'public/social-card.png' });
} finally { await browser.close(); }
