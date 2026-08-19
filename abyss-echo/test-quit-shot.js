/* 返回菜单确认弹窗视觉验证：node test-quit-shot.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function main() {
  await new Promise(r => server.listen(8215, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8215/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.evaluate(() => { window._menuSelection = ['warder']; render(); });
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await page.evaluate(() => { state.run.gold = 37; state.run.relicIds.push('abyss_eye'); render(); });
    await page.click('.map-quit-btn');
    await page.waitForSelector('.shop-confirm-overlay');
    await page.screenshot({ path: path.join(__dirname, 'shots', 'q1-quit-confirm.png'), fullPage: true });
    const visible = await page.evaluate(() => {
      const m = document.querySelector('.shop-confirm-modal');
      const r = m.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), txt: m.textContent.replace(/\s+/g, ' ').trim() };
    });
    console.log('modal:', JSON.stringify(visible));
    await page.click('text=继续远征');
    await page.waitForSelector('.shop-confirm-overlay', { state: 'detached' });
    const stillMap = await page.evaluate(() => state.phase === 'map' && !state.quitConfirm);
    console.log(stillMap ? 'CANCEL OK' : 'CANCEL FAIL');
    if (!stillMap) process.exitCode = 1;
    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('QUIT SHOT OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
