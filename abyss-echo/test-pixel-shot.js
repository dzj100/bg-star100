/* 像素风全流程截图：node test-pixel-shot.js（产出 shots/pixel-*.png） */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await new Promise(r => server.listen(8243, r));
  const browser = await chromium.launch();
  const errors = [];
  const shot = (page, name) => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });
  const watch = page => {
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  };

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

    /* 桌面端：菜单 → 地图 → 战斗 → 击杀奖励 → 转场 → Boss 登场 */
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    watch(page);
    await page.goto('http://localhost:8243/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.evaluate(() => { window._menuSelection = ['warder', 'scholar', 'hunter', 'healer']; render(); });
    await shot(page, 'pixel-1-menu.png');

    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await shot(page, 'pixel-2-map.png');

    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one', 'tentacle']);
      render();
    });
    await sleep(2000);
    await shot(page, 'pixel-3-combat.png');

    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      state.combat.enemyGroup.forEach(e => { e.hp = 1; });
      const p = state.party[0];
      p.hand = [{ uid: state.nextUid++, id: 'warder_hammer' }];
      p.energy = 9;
      playCard(0, 0, 0);
    });
    await page.waitForFunction(() => state.phase === 'reward', null, { timeout: 6000 });
    await shot(page, 'pixel-4-reward.png');

    await page.evaluate(() => { state.transition = { floor: 1 }; render(); });
    await sleep(300);
    await shot(page, 'pixel-5-transition.png');

    await page.evaluate(() => {
      state.transition = null;
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['great_eye']);
      render();
    });
    await sleep(600);
    await shot(page, 'pixel-7-boss.png');

    /* 移动端：390x844 战斗页 */
    const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
    watch(mp);
    await mp.goto('http://localhost:8243/abyss-echo/index.html');
    await mp.waitForSelector('.menu-screen');
    await mp.evaluate(() => { window._menuSelection = ['warder', 'scholar', 'hunter', 'healer']; render(); });
    await mp.click('.start-btn');
    await mp.evaluate(() => act('dismiss-intro'));
    await mp.waitForSelector('.map-screen');
    await mp.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      render();
    });
    await sleep(2000);
    await shot(mp, 'pixel-6-mobile.png');

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('PIXEL SHOT OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
