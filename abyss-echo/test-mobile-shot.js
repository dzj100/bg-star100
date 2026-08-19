/* 移动端 UI 截图：node test-mobile-shot.js
 * 用 390x844 视口走核心界面并截图，验证移动端适配 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await new Promise(r => server.listen(8201, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = name => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8201/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await shot('m1-menu.png');

    // 四人队
    for (let i = 1; i <= 4; i++) await page.click(`.class-card:nth-child(${i}) input`);
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await shot('m2-map.png');

    // 进战斗
    await page.click('.node.available');
    await page.waitForSelector('.combat-screen');
    await shot('m3-combat.png');

    // 打一轮牌制造状态展示
    for (let turn = 0; turn < 3; turn++) {
      let guard = 0;
      while (guard++ < 25) {
        const pending = await page.$('.target-hint');
        if (pending) {
          const t = await page.$('.enemy-card.targetable');
          if (t) { await t.click(); continue; }
          const a = await page.$('.party-card.targetable');
          if (a) { await a.click(); continue; }
          break;
        }
        const playable = await page.$('.hand-card-wrap:not(.locked):not(.cant-afford)');
        if (!playable) break;
        await playable.click();
        await sleep(50);
      }
      const btn = await page.$('.end-turn-btn:not([disabled])');
      if (!btn) break;
      await btn.click();
      // 敌方阶段逐个行动，等待回到玩家回合或战斗结束
      await page.waitForFunction(() => {
        const s = window.state;
        return !s || s.phase !== 'combat' || s.subPhase === 'play';
      }, { timeout: 15000 }).catch(() => {});
      await sleep(80);
      if (await page.$('.reward-screen')) break;
      if (await page.$('.end-screen')) break;
    }
    await shot('m4-combat-mid.png');

    // 卡牌长按 tooltip 验证
    const card = await page.$('.hand-card-wrap:not(.locked)');
    if (card) {
      await page.evaluate(() => {
        const el = document.querySelector('.hand-card-wrap:not(.locked)');
        cardTipTouchStart({ currentTarget: el }, 0, 0);
      });
      await sleep(450);
      await shot('m5-card-tip.png');
      await page.evaluate(() => cardTipTouchEnd({ preventDefault() {} }));
    }

    // 奖励界面
    if (await page.$('.reward-screen')) {
      await shot('m6-reward.png');
      const rc = await page.$('.reward-card');
      if (rc) { await rc.click(); await sleep(80); await shot('m7-reward-give.png'); }
    }

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('MOBILE SHOT OK — 无 JS 错误');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
