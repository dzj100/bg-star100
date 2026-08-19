/* 潮汐学者技能牌点击链路验证：node test-scholar-click.js */
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

async function main() {
  await new Promise(r => server.listen(8216, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  try {
    await page.goto('http://localhost:8216/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.evaluate(() => { window._menuSelection = ['scholar']; render(); });
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      const p = state.party[0];
      // 固定手牌：1张技能（潮汐屏障）+ 3张攻击（深渊弹幕）
      p.hand = [
        { uid: state.nextUid++, id: 'scholar_defend' },
        { uid: state.nextUid++, id: 'scholar_strike' },
        { uid: state.nextUid++, id: 'scholar_strike' },
        { uid: state.nextUid++, id: 'scholar_strike' },
      ];
      p.energy = 4; // 潮汐屏障1费 + 3张深渊弹幕各1费 = 4费
      render();
    });
    await page.waitForSelector('.hand-card-wrap');
    await page.waitForTimeout(600);

    // 1. 点击第一张牌（潮汐屏障，技能）→ 护甲 +5
    await page.locator('.hand-card-wrap').nth(0).click();
    await page.waitForTimeout(200);
    const afterSkill = await page.evaluate(() => ({ block: state.party[0].block, hand: state.party[0].hand.length, e: state.combat.enemyGroup[0].hp }));
    console.log('技能卡后:', JSON.stringify(afterSkill));
    if (afterSkill.block !== 5) { console.log('FAIL: 技能牌未释放'); process.exitCode = 1; }
    else console.log('PASS: 潮汐屏障（技能）点击释放成功，护甲+5');

    // 2. 攻击牌流程：点卡 → pending → 点敌人 → 释放。连续 3 次 → 第 3 次触发潮汐
    for (let i = 0; i < 3; i++) {
      await page.locator('.hand-card-wrap').nth(0).click();
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => ({
        pending: state.combat.pendingCard,
        sub: state.subPhase,
        cards: state.party[0].hand.map(c => c.id),
        focus: (typeof _combatHandFocus === 'number') ? _combatHandFocus : null,
        hint: !!document.querySelector('.target-hint'),
      }));
      console.log('点击后:', JSON.stringify(st));
      if (!st.pending) { console.log('FAIL: 点击攻击牌未进入选目标'); process.exitCode = 1; return; }
      await page.locator('.enemy-card.targetable').first().click();
      await page.waitForTimeout(250);
    }
    const after3 = await page.evaluate(() => ({
      spells: state.combat.spellsPlayed[0],
      log: state.combat.log.slice(-3),
      eHp: state.combat.enemyGroup[0].hp,
    }));
    console.log('3攻击后:', JSON.stringify(after3));
    if (after3.spells !== 3) { console.log('FAIL: 攻击牌点击无效'); process.exitCode = 1; }
    else console.log('PASS: 3张攻击牌点击释放成功，潮汐计数=3');
    const tide = after3.log.find(l => l.includes('潮汐'));
    if (!tide) { console.log('FAIL: 潮汐爆发未触发'); process.exitCode = 1; }
    else console.log('PASS: 潮汐爆发触发 →', tide);

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('SCHOLAR CLICK OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
