/* 新 UI 视觉验证：node test-ui-shot.js */
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
  await new Promise(r => server.listen(8204, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = name => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8204/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(1) input');
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');

    // 直接注入 Boss 战
    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      state.run.floor = 3;
      startCombat(['abyssal_will']);
      render();
    });
    await page.waitForSelector('.boss-intro-overlay');
    await sleep(350);
    await shot('u1-boss-intro.png');

    // 等待入场动画结束，打出一张攻击牌看飘字
    await sleep(2200);
    await page.evaluate(() => {
      const p = state.party[0];
      const hi = p.hand.findIndex(h => { const d = cdef(h); return d.type === 'attack' && d.cost <= p.energy; });
      if (hi >= 0) playCard(0, hi, 0);
      else endTurn();
    });
    await sleep(250);
    await shot('u2-damage-float.png');

    // 直接杀死 Boss 看死亡演出
    await page.evaluate(() => {
      const e = state.combat.enemyGroup[0];
      e.hp = 1; e.block = 0;
      dealDamage(e, 999, { playerIdx: 0 });
      if (allEnemiesDead()) combatWon();
    });
    await page.waitForSelector('.boss-death-overlay');
    await sleep(600);
    await shot('u3-boss-death.png');
    await sleep(2200);
    await page.waitForSelector('.reward-screen');
    await shot('u4-reward-after-death.png');

    // 直接跳到胜利页
    await page.evaluate(() => { victory(); });
    await page.waitForSelector('.end-screen.victory');
    await shot('u5-victory.png');

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('UI SHOT OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
