/* 英雄立绘验证：node test-hero-img.js */
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await new Promise(r => server.listen(8213, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = name => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8213/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    const imgCount = await page.$$eval('.class-img', els => els.length);
    const natural = await page.$$eval('.class-img', els => els.map(e => e.naturalWidth > 0));
    console.log(`menu class-img: ${imgCount} 张，自然加载: ${natural.every(Boolean) ? 'OK' : 'FAIL ' + JSON.stringify(natural)}`);
    await shot('h1-menu-classes.png');

    // 全选 4 人进战斗（checkbox 连点会被重渲染打断，直接注入选择）
    await page.evaluate(() => {
      window._menuSelection = ['warder', 'scholar', 'hunter', 'healer'];
      render();
    });
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      render();
    });
    await sleep(2500);
    const pCount = await page.$$eval('.party-img', els => els.length);
    const pNatural = await page.$$eval('.party-img', els => els.map(e => e.naturalWidth > 0));
    console.log(`combat party-img: ${pCount} 张，自然加载: ${pNatural.every(Boolean) ? 'OK' : 'FAIL ' + JSON.stringify(pNatural)}`);
    const overlap = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.party-card')];
      return cards.map(c => {
        const img = c.querySelector('.party-img');
        if (!img) return null;
        const r = img.getBoundingClientRect();
        const name = c.querySelector('.party-name');
        const nr = name.getBoundingClientRect();
        return { name: c.querySelector('.party-name').textContent, imgH: Math.round(r.height), overlap: r.bottom > nr.top };
      });
    });
    console.log('party-card 立绘与姓名重叠检查:', JSON.stringify(overlap));
    await shot('h2-combat-party.png');

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else if (imgCount !== 4 || pCount !== 4) { console.error('FAIL: 立绘数量不符'); process.exitCode = 1; }
    else console.log('HERO IMG OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
