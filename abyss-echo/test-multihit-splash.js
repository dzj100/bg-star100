/* 多段伤害分步飘字视觉验证：node test-multihit-splash.js */
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
  await new Promise(r => server.listen(8209, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8209/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(3) input'); // 深渊猎手
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await page.evaluate(() => {
      const node = state.map.nodes.find(n => n.state === 'available');
      selectNode(node.id);
    });
    await page.waitForSelector('.combat-screen');

    // 打出双刃鱼叉，记录 HP 变化时间线（第一段立即，第二段约350ms后）
    await page.evaluate(() => {
      state.combat.enemyGroup.forEach(e => { if (Number(e.hp) < 60) e.hp = 60; });
      const p = state.party[0];
      p.hand = [{ uid: state.nextUid++, id: 'hunter_twin' }];
      p.energy = 3;
      window.__hpLog = [];
      const t0 = performance.now();
      window.__rec = setInterval(() => {
        const hp = state.combat.enemyGroup.map(e => e.hp).join(',');
        const last = window.__hpLog[window.__hpLog.length - 1];
        if (!last || last.hp !== hp) window.__hpLog.push({ t: Math.round(performance.now() - t0), hp });
      }, 15);
      playCard(0, 0, 0);
    });
    // 等待第二段结算（>350ms）后再截图第二段飘字
    await sleep(650);
    await page.evaluate(() => clearInterval(window.__rec));
    const log = await page.evaluate(() => window.__hpLog);
    console.log('HP变化时间线:', JSON.stringify(log));

    // 第一段飘字截图（重新触发一次，取两段之间：第一段立即，第二段350ms后）
    await page.evaluate(() => {
      const p = state.party[0];
      p.hand = [{ uid: state.nextUid++, id: 'hunter_twin' }];
      p.energy = 3;
      playCard(0, 0, 0);
    });
    await sleep(80);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'm1-multihit-first.png'), fullPage: true });
    await sleep(280);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'm2-multihit-second.png'), fullPage: true });

    const changes = log.filter(x => x.t > 5); // 跳过首帧初始化噪音
    const gap = changes.length >= 2 ? changes[1].t - changes[0].t : 0;
    const errs = errors.filter(e => !e.includes('favicon'));
    console.log('两段间隔:', gap + 'ms');
    if (changes.length < 2) { console.log('FAIL: 未观察到两段独立HP变化'); process.exitCode = 1; }
    else if (gap < 200) { console.log('FAIL: 两段间隔过短 (' + gap + 'ms)'); process.exitCode = 1; }
    else if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('MULTIHIT-SPLASH OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
