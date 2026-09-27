import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Render our SVG source; no external artwork, fonts, network or image service.
const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({ path: new URL(`../public/icon-${size}.png`, import.meta.url).pathname });
    await page.close();
  }
} finally { await browser.close(); }
