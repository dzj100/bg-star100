/* 地图 UI 验证（节点放大/箭头/步数/图例）：node test-map-shot.js */
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
  await new Promise(r => server.listen(8206, r));
  const browser = await chromium.launch();
  const errors = [];

  async function runViewport(label, viewport) {
    const page = await browser.newPage({ viewport, isMobile: viewport.width <= 720, hasTouch: viewport.width <= 720, deviceScaleFactor: 2 });
    page.on('pageerror', e => errors.push(label + ' PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(label + ' CONSOLE: ' + m.text()); });
    const shot = name => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });
    await page.goto('http://localhost:8206/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(1) input');
    await page.click('.class-card:nth-child(2) input');
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await sleep(350);
    await shot(label + '-map-start.png');

    // 走两步：模拟已走 2 个节点（第1步→第2步），验证金色步数线
    await page.evaluate(() => {
      const nodes = state.map.nodes;
      const top = nodes.filter(n => n.row === 0).sort((a, b) => a.col - b.col);
      top[0].state = 'cleared';
      const mid = state.map.edges.filter(([f]) => f === top[0].id).map(([, t]) => nodes.find(n => n.id === t))[0];
      mid.state = 'cleared';
      state.run.currentNodeId = mid.id;
      state.map.edges.forEach(([f, t]) => {
        if (f === mid.id) {
          const n2 = nodes.find(n => n.id === t);
          if (n2 && n2.state === 'locked') n2.state = 'available';
        }
      });
      render();
    });
    await sleep(350);
    await shot(label + '-map-progress.png');
    await page.close();
  }

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await runViewport('m', { width: 390, height: 844 });
    await runViewport('d', { width: 1280, height: 900 });

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('MAP SHOT OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
