/* 意图词条显示最终伤害（楼层缩放+力量）验证：node test-intent-scale.js */
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
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); if (!cond) fails++; };

async function main() {
  await new Promise(r => server.listen(8199, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  try {
    await page.goto('http://localhost:8199/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');

    /* 正规开局（创建 party），跳过开场叙事，进入第1层地图 */
    await page.evaluate(() => { window._menuSelection = ['warder']; render(); });
    await page.click('.start-btn');
    await page.waitForSelector('.intro-screen');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen', { timeout: 10000 });
    await page.evaluate(() => { state.transition = null; });

    /* 第1层：deep_one 攻击 6 → 不缩放 */
    await page.evaluate(() => {
      state.run.floor = 1;
      startCombat(['deep_one']);
      render();
    });
    await page.waitForSelector('.combat-screen');
    let intent = await page.$eval('.enemy-card .intent', el => el.innerText);
    ok(intent.includes('攻击 6'), '第1层意图词条显示 攻击 6（实际: ' + intent + ')');

    /* 第2层：潮汐领主 全体6→8 / 攻击10→13，循环词条同步缩放 */
    await page.evaluate(() => {
      state.run.floor = 2;
      startCombat(['tide_lord']);
      render();
    });
    await page.waitForSelector('.combat-screen');
    intent = await page.$eval('.enemy-card .intent', el => el.innerText);
    ok(intent.includes('全体攻击 8'), '第2层潮汐领主意图显示 全体攻击 8（实际: ' + intent + ')');
    const cycle = await page.$eval('.enemy-cycle', el => el.innerText);
    ok(cycle.includes('全体攻击 8') && cycle.includes('攻击 13') && cycle.includes('强化力量+2'), '技能循环词条同步缩放且显示力量数值（实际: ' + cycle + ')');

    /* 真实结算：执行 buff（+2力量）后，下一轮单体攻击显示 13+2=15 */
    await page.evaluate(() => {
      const e = state.combat.enemyGroup[0];
      e.intentIdx = 1; // buff 回合
      computeIntents();
      executeEnemyIntent(e, e.intent); // 力量 +2
      e.intentIdx = 2; // 下一轮：单体攻击
      computeIntents();
      render();
    });
    intent = await page.$eval('.enemy-card .intent', el => el.innerText);
    ok(intent.includes('攻击 15'), 'buff(+2力量)结算后单体攻击显示 15（实际: ' + intent + ')');

    /* 再下一轮：全体攻击含力量加成 8+2=10 */
    await page.evaluate(() => {
      state.combat.enemyGroup[0].intentIdx = 3; // 循环回全体攻击
      computeIntents();
      render();
    });
    intent = await page.$eval('.enemy-card .intent', el => el.innerText);
    ok(intent.includes('全体攻击 10'), 'buff(+2力量)结算后全体攻击显示 10（实际: ' + intent + ')');

    /* 第3层 Boss 阶段意图同样缩放 */
    await page.evaluate(() => {
      state.run.floor = 3;
      startCombat(['great_eye']);
      render();
    });
    await page.waitForSelector('.combat-screen');
    intent = await page.$eval('.enemy-card .intent', el => el.innerText);
    ok(intent !== '' && !intent.includes('undefined'), '第3层Boss意图无异常（实际: ' + intent + '）');

    if (errors.length) { console.log('页面错误:'); errors.forEach(e => console.log('  ' + e)); fails++; }
    console.log(fails === 0 ? '\n全部通过' : '\n失败 ' + fails + ' 项');
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(fails ? 1 : 0);
}
main();
