/* 多敌人逐个行动验证：node test-enemy-sequence.js
 * 1个怪物攻击结算后稍作片刻，才轮到下一个怪物攻击+结算 */
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
  await new Promise(r => server.listen(8207, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = name => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });

  const assert = (cond, msg) => {
    if (!cond) throw new Error('FAIL: ' + msg);
    console.log('PASS: ' + msg);
  };

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8207/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(1) input');
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');

    // 注入双深潜者战斗（两者都是攻击意图）
    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one', 'deep_one']);
      render();
    });
    await page.waitForSelector('.combat-screen');
    await sleep(400);

    const enemyCount = await page.evaluate(() => state.combat.enemyGroup.length);
    assert(enemyCount === 2, '战斗有 2 个敌人');

    // 结束回合，进入 enemy 阶段
    await page.evaluate(() => endTurn());
    await page.waitForFunction(() => state.subPhase === 'enemy');

    // 轮询：按 data-eid 记录攻击者切换的时间点（attacking class 是渲染驱动、逐个出现的）
    const t0 = Date.now();
    const seen = [];
    let lastId = null;
    while (Date.now() - t0 < 8000) {
      const attacking = await page.$('.enemy-card.attacking');
      if (attacking) {
        const id = await attacking.getAttribute('data-eid');
        if (id !== lastId) {
          seen.push({ id, t: Date.now() - t0 });
          lastId = id;
          if (seen.length === 1) await shot('seq-1-first-enemy.png');
          else if (seen.length === 2) await shot('seq-2-second-enemy.png');
        }
      }
      await sleep(30);
    }
    // 等整个敌人阶段走完（回到 play / 战斗结束）
    await page.waitForFunction(() => state.subPhase === 'play' || state.phase !== 'combat', null, { timeout: 8000 });

    assert(seen.length >= 2, `检测到 ${seen.length} 个攻击时刻（${seen.map(s => s.id).join(',')}）`);
    assert(seen[0].id !== seen[1].id, `两次攻击来自不同敌人（${seen[0].id} → ${seen[1].id}）`);
    const gap = seen[1].t - seen[0].t;
    assert(gap >= 550, `两段攻击间隔 ${gap}ms ≥ 550ms（逐个演出，非同时）`);

    // 双方都结算完成，伤害确实各打了一次
    const partyHp = await page.evaluate(() => state.party[0].hp);
    assert(partyHp < 80, `守望者受到两轮攻击伤害（hp=${partyHp}）`);

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('ENEMY SEQUENCE OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
