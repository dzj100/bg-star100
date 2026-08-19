/* 端到端冒烟测试：node test-e2e.js
 * 启动本地静态服务器，用 playwright 在浏览器中走完一局核心流程并截图 */
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
  await new Promise(r => server.listen(8199, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = name => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8199/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await shot('1-menu.png');

    // 选职业（守望者+医者）
    await page.click('.class-card:nth-child(1) input');
    await page.click('.class-card:nth-child(4) input');
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    console.log('OK 进入地图');
    await shot('2-map.png');

    // 进入第一个可用节点（战斗）
    await page.click('.node.available');
    await page.waitForSelector('.combat-screen');
    console.log('OK 进入战斗');
    await shot('3-combat.png');

    // 打牌循环：出所有可打的牌，然后结束回合
    for (let turn = 0; turn < 6; turn++) {
      let guard = 0;
      while (guard++ < 30) {
        const pending = await page.$('.target-hint');
        if (pending) {
          // 待选目标：优先敌人
          const t = await page.$('.enemy-card.targetable');
          if (t) { await t.click(); continue; }
          const a = await page.$('.party-card.targetable');
          if (a) { await a.click(); continue; }
          break;
        }
        const playable = await page.$('.hand-card-wrap:not(.locked):not(.cant-afford)');
        if (!playable) break;
        await playable.click();
        await sleep(40);
      }
      const btn = await page.$('.end-turn-btn:not([disabled])');
      if (!btn) break;
      await btn.click();
      // 敌方阶段逐个行动，等待回到玩家回合或战斗结束
      await page.waitForFunction(() => {
        const s = window.state;
        return !s || s.phase !== 'combat' || s.subPhase === 'play';
      }, { timeout: 15000 }).catch(() => {});
      await sleep(60);
      if (await page.$('.reward-screen')) break;
      if (await page.$('.end-screen')) break;
    }
    console.log('OK 战斗回合循环完成，当前界面:', await page.$eval('.screen', el => el.className));

    // 处理奖励（如有）
    if (await page.$('.reward-screen')) {
      const card = await page.$('.reward-card');
      if (card) {
        await card.click();
        await page.waitForSelector('.give-row .btn', { timeout: 3000 }).catch(() => {});
        const give = await page.$('.give-row .btn');
        if (give) {
          await give.click();
          console.log('OK 领取奖励（选人发卡，直接返回地图）');
        } else {
          await page.click('.reward-screen .btn:has-text("离开")');
          console.log('OK 跳过奖励返回地图');
        }
      } else {
        await page.click('.reward-screen .btn:has-text("离开")');
        console.log('OK 无卡牌直接离开');
      }
      await page.waitForSelector('.map-screen');
    }

    // 存档恢复：刷新页面
    await page.reload();
    await page.waitForSelector('.map-screen, .combat-screen');
    console.log('OK 刷新后存档恢复（仍在局中）');
    await shot('4-reload.png');

    // 返回菜单
    await page.evaluate(() => act('return-menu'));
    await page.waitForSelector('.menu-screen');
    console.log('OK 返回菜单');

    // 菜单 → 四人队 → 商店/休息/事件界面截图
    await page.click('.class-card:nth-child(1) input');
    await page.click('.class-card:nth-child(2) input');
    await page.click('.class-card:nth-child(3) input');
    await page.click('.class-card:nth-child(4) input');
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await shot('5-map-4party.png');
    // 依次进入前两个可用节点（战斗后可能出奖励）
    for (let i = 0; i < 2; i++) {
      const node = await page.$('.node.available');
      if (!node) break;
      await node.click();
      await sleep(120);
      if (await page.$('.combat-screen')) {
        const btn = await page.$('.end-turn-btn:not([disabled])');
        if (btn) {
          await btn.click();
          await page.waitForFunction(() => {
            const s = window.state;
            return !s || s.phase !== 'combat' || s.subPhase === 'play';
          }, { timeout: 15000 }).catch(() => {});
          await sleep(80);
        }
      }
    }
    await shot('6-state.png');

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('E2E SMOKE OK — 无 JS 错误');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('E2E FAIL:', e.message); process.exit(1); });
