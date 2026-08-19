/* 攻击动画/受击/血条动画/层间过渡 视觉验证：node test-attack-anim.js */
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
  await new Promise(r => server.listen(8205, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = name => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8205/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(1) input');
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');

    // 注入一场普通战斗（1 敌人攻击意图）
    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      render();
    });
    await page.waitForSelector('.combat-screen');
    await sleep(400);
    await shot('v1-combat-start.png');

    // 结束回合 → 敌人攻击：突进 + 我方受击震动 + 血条动画 + 飘字
    await page.evaluate(() => { endTurn(); });
    await page.waitForSelector('.enemy-card.attacking');
    await sleep(120);
    await shot('v2-enemy-attacking.png');
    const partyHit = await page.$('.party-card.just-hit[data-hp-dmg]');
    if (!partyHit) throw new Error('玩家受击动画 class 未出现');
    await sleep(1200);
    await shot('v3-after-hit.png');

    // 玩家打一张攻击牌 → 敌人受击后仰 + 敌人血条动画
    await page.evaluate(() => {
      const p = state.party[0];
      const hi = p.hand.findIndex(h => { const d = cdef(h); return d.type === 'attack' && d.cost <= p.energy; });
      if (hi >= 0) playCard(0, hi, 0);
      else endTurn();
    });
    await sleep(250);
    await shot('v4-player-attack.png');

    // 中毒掉血同样触发玩家受击动画（回合结算阶段结算毒伤）
    await page.evaluate(() => {
      if (state.subPhase === 'enemy') window.stepEnemyAct(); // 若上一步走了 endTurn 分支，先推进回 play
      state.party[0].buffs.poison = 3;
      endTurn();
    });
    await page.waitForFunction(() => state.subPhase === 'play', null, { timeout: 8000 });
    const poisonHit = await page.evaluate(() => !!document.querySelector('.party-card.just-hit[data-hp-dmg]'));
    if (!poisonHit) throw new Error('中毒掉血未触发受击动画');
    await shot('v4b-poison-hit.png');

    // 击杀演出：最后一击后先播死亡动画（停留在战斗界面），1s 后才进奖励结算
    await page.evaluate(() => {
      if (state.subPhase === 'enemy') window.stepEnemyAct();
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      state.combat.enemyGroup[0].hp = 1; // 一击必杀
      const p = state.party[0];
      p.hand = [{ uid: state.nextUid++, id: 'warder_hammer' }]; // 固定注入攻击牌
      p.energy = 9;
      playCard(0, 0, 0);
    });
    const killState = await page.evaluate(() => ({ phase: state.phase, pw: state.combat.pendingWin }));
    if (killState.phase !== 'combat' || !killState.pw) throw new Error('击杀后未停留在战斗界面播放演出');
    const killedCard = await page.$('.enemy-card.just-killed');
    if (!killedCard) throw new Error('击杀动画 class 未出现');
    await sleep(150);
    await shot('v5-kill-anim.png');
    await page.waitForFunction(() => state.phase === 'reward', null, { timeout: 4000 });
    console.log('OK 击杀演出结束后自动进入奖励');
    await shot('v6-kill-reward.png');

    // 层间过渡：模拟完层后进入第 2 层（与 completeNode 真实流程一致）
    await page.evaluate(() => {
      state.run.floor = 2;
      generateMap(2);
      state.transition = { floor: state.run.floor };
      state.phase = 'map';
      render();
    });
    await page.waitForSelector('.transition-screen');
    await sleep(700);
    await shot('v5-transition.png');
    await sleep(4200);
    const transCleared = await page.evaluate(() => !state.transition);
    await shot('v6-after-transition.png');
    if (!transCleared) throw new Error('transition 未自动清除');

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('ATTACK ANIM SHOT OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
