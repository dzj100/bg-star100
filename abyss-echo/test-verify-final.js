/* 方向1-4 视觉/机制综合验证：node test-verify-final.js
 * 覆盖：开场叙事 → 第1层过渡 → 战斗打击特效 → Boss 登场不截断 → 事件结果 → 失败/胜利结算 → 极窄屏 */
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
  await new Promise(r => server.listen(8198, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = n => page.screenshot({ path: path.join(__dirname, 'shots', n) });

  try {
    /* 1. 开场叙事 */
    await page.goto('http://localhost:8198/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.evaluate(() => { window._menuSelection = ['warder', 'scholar']; render(); });
    await page.click('.start-btn');
    await page.waitForSelector('.intro-screen');
    ok(await page.$('.intro-start-btn') !== null, '新局显示开场叙事 overlay');
    await shot('v1-intro.png');
    await page.click('.intro-start-btn');
    await page.waitForSelector('.transition-screen');
    const story = await page.$eval('.transition-screen', el => el.innerText);
    ok(story.includes('深渊之口'), '第1层过渡叙事播放（含"深渊之口"）');
    await shot('v2-floor1-story.png');
    await page.waitForSelector('.map-screen', { timeout: 10000 });
    ok(true, '过渡后进入地图');

    /* 2. 战斗打击特效：打一张攻击牌，命中瞬间检查 play-fx / shake / attacking / pulse-hit */
    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      render();
    });
    await page.waitForSelector('.combat-screen');
    await page.evaluate(() => {
      const p = state.party[0];
      p.hand = p.hand.filter(c => c.id.includes('strike'));
      p.hand.length = Math.min(p.hand.length, 1);
      p.hand = [{ uid: state.nextUid++, id: p.classId === 'warder' ? 'warder_strike' : 'scholar_strike' }];
      p.energy = 3;
      render();
    });
    await sleep(400);
    await page.locator('.hand-card-wrap').nth(0).click();
    await page.waitForSelector('.enemy-card.targetable');
    await page.locator('.enemy-card.targetable').first().click();
    await sleep(110); // 命中窗口
    const fx = await page.evaluate(() => ({
      playFx: !!document.querySelector('.play-fx'),
      shake: !!document.querySelector('.combat-field.shake'),
      attacking: !!document.querySelector('.party-card.attacking'),
      pulse: !!document.querySelector('.enemy-card.pulse-hit'),
      dmgFloat: !!document.querySelector('.enemy-card.just-hit[data-hp-dmg]'),
    }));
    ok(fx.playFx, '卡牌飞出动画 .play-fx 存在');
    ok(fx.shake, '容器级屏幕震动 .combat-field.shake');
    ok(fx.attacking, '我方角色前冲 .attacking');
    ok(fx.dmgFloat, '伤害飘字存在');
    await shot('v3-hitfx.png');
    await sleep(700);
    const cleared = await page.evaluate(() => ({
      playFx: state.combat.playFx,
      playerActed: state.combat.playerActed,
      hitPulse: state.combat.hitPulse,
      energyFx: state.combat.energyFx,
    }));
    ok(!cleared.playFx && !cleared.playerActed && !cleared.hitPulse && !cleared.energyFx, '瞬态特效 state 字段渲染后被清空');

    /* 3. Boss 登场：title/lore + 中途 re-render 不截断 */
    await page.evaluate(() => { startCombat(['great_eye']); render(); });
    await page.waitForSelector('.boss-intro-overlay');
    await sleep(1500); // 中途触发一次 re-render
    await page.evaluate(() => render());
    const bossAfterRe = await page.evaluate(() => ({
      overlay: !!document.querySelector('.boss-intro-overlay'),
      title: document.querySelector('.boss-intro-title') ? document.querySelector('.boss-intro-title').innerText : null,
      quote: document.querySelector('.boss-intro-quote') ? document.querySelector('.boss-intro-quote').innerText : null,
    }));
    ok(bossAfterRe.overlay, 'Boss 登场 1.5s 后 re-render 演出不中断');
    ok(!!bossAfterRe.title, 'Boss title 显示: ' + bossAfterRe.title);
    ok(!!bossAfterRe.quote, 'Boss lore 显示');
    await shot('v4-boss-intro.png');
    await sleep(2500);
    const bossGone = await page.evaluate(() => !!document.querySelector('.boss-intro-overlay'));
    ok(!bossGone, 'Boss 登场演出按时结束');

    /* 4. 事件结果叙事化 */
    await page.evaluate(() => {
      state.phase = 'event';
      state.event = { defId: 'sunken_temple', chosen: null, ...JSON.parse(JSON.stringify(EVENTS.sunken_temple)) };
      render();
    });
    await page.waitForSelector('.event-overlay');
    await page.evaluate(() => { act('pick-event-option', 0); });
    await page.waitForSelector('.event-result');
    const resultTxt = await page.$eval('.event-result', el => el.innerText);
    ok(resultTxt.includes('祈祷') || resultTxt.includes('恢复'), '事件结果叙事文本展示: ' + resultTxt.slice(0, 30));
    await shot('v5-event-result.png');

    /* 5. 失败结算：幸存者名单 */
    await page.evaluate(() => {
      state.phase = 'combat';
      state.party[0].hp = 0; state.party[0].dead = true;
      state.party[1].hp = 12;
      state.combat = null;
      defeat();
    });
    await page.waitForSelector('.end-screen.defeat');
    const surv = await page.evaluate(() => ({
      chips: document.querySelectorAll('.surv-chip').length,
      none: !!document.querySelector('.end-surv-none'),
      note: !!document.querySelector('.end-surv-note'),
    }));
    ok(surv.chips === 1, '失败结算显示幸存者名单（1 人存活）');
    ok(surv.note, '幸存者备注显示');
    await shot('v6-defeat.png');

    /* 6. 胜利结算：epilogue */
    await page.evaluate(() => { state.unlock = state.unlock || {}; victory(); });
    await page.waitForSelector('.end-screen.victory');
    const epi = await page.evaluate(() => {
      const el = document.querySelector('.end-epilogue');
      return el ? el.innerText : null;
    });
    ok(!!epi && epi.length > 10, '胜利结算 epilogue 显示');
    await shot('v7-victory.png');

    /* 7. 极窄屏 360px：手牌横向滚动 + 边缘指示 */
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => {
      state = freshMenuState();
      state.seed = 42; rng = mulberry32(42);
      state.run = { floor: 1, gold: 0, relicIds: [], permanentBuffs: {}, kills: 0, elitesKilled: 0, restUsed: false, intro: false };
      state.party = [{ classId: 'warder', name: '守望者', hp: 80, maxHp: 80, energy: 3, hand: [], drawPile: [], discardPile: [], exhaustPile: [], block: 0, buffs: emptyBuffs(), deck: STARTER_DECKS.warder.map(id => cardInst(id)), relicIds: [], dead: false }];
      generateMap(1);
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      const p = state.party[0];
      p.hand = Array.from({ length: 6 }, () => ({ uid: state.nextUid++, id: 'warder_strike' }));
      p.energy = 3;
      render();
    });
    await sleep(400);
    const narrow = await page.evaluate(() => {
      const hand = document.querySelector('.edge-fade .hand');
      const tabs = document.querySelector('.edge-fade .player-tabs');
      const init = {
        atStart: !!document.querySelector('.edge-fade.at-start'),
        atEnd: !!document.querySelector('.edge-fade.at-end'),
      };
      hand.scrollLeft = hand.scrollWidth;
      hand.dispatchEvent(new Event('scroll'));
      const scrolled = !!document.querySelector('.edge-fade.at-start');
      return {
        handOverflow: hand.scrollWidth > hand.clientWidth,
        init,
        scrolled,
        handTop: Math.round(hand.getBoundingClientRect().top),
        vh: window.innerHeight,
        tabsExists: !!tabs,
      };
    });
    ok(narrow.handOverflow, '360px 手牌横向滚动');
    ok(narrow.init.atEnd && !narrow.init.atStart, '初始状态：右端渐变显示（有更多内容）');
    ok(narrow.scrolled, '滚动后左端渐变 .at-start 显示');
    ok(narrow.tabsExists, '角色标签栏渲染');
    ok(narrow.handTop > 0 && narrow.handTop < narrow.vh, '手牌位于视口内（safe-area 布局正常）');
    await shot('v8-narrow360.png');

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); fails++; }
    console.log(fails ? `VERIFY FAIL (${fails})` : 'VERIFY ALL OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('VERIFY FAIL:', e.message); process.exit(1); });
