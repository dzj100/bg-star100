/* ============================================================
   补位流程验收（node test-compact-check.js）
   房间剩 1 张时：先渲染补位动画（1 张牌滑动），动画完成后补牌至 4 张
   ============================================================ */
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const ROOT = __dirname;
const G = require('./game.js');
const C = G._internal.makeCard;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));

  await page.goto('file://' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?debug');
  await page.waitForTimeout(300);

  // 房间 2 张：S2(怪) + H6(血瓶)，牌堆 3 张
  const patch = {
    hp: 20, deck: [C('C', 5), C('C', 7), C('S', 8)],
    room: [C('S', 2), C('H', 6)],
    weapon: null, potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  };
  await page.evaluate(() => {
    document.getElementById('landing').style.display = 'none';
    document.getElementById('game').style.display = 'flex';
  });
  await page.evaluate(p => {
    window.__scoundrel.setState(JSON.parse(p));
    window.__scoundrel.render(0);
  }, JSON.stringify(Object.assign(G.newGame(7), patch)));
  await page.waitForTimeout(700);

  const before = await page.evaluate(() => ({
    cards: document.querySelectorAll('#room .card').length,
    roomLen: window.__scoundrel.getState().room.length
  }));
  console.log('点击前: room 卡片', before.cards, '/ state.room', before.roomLen);

  // 点击第 1 张（S2 怪）→ 房间剩 H6 一张 → H6 应从槽位2滑到槽位1
  await page.click('#room .card:nth-child(1)');
  await page.waitForTimeout(80);

  const mid = await page.evaluate(() => {
    const cards = document.querySelectorAll('#room .card');
    return {
      cards: cards.length,
      roomLen: window.__scoundrel.getState().room.length,
      hasSlide: document.querySelectorAll('#room .card.slot-shift').length,
      sx: cards[0] ? cards[0].style.getPropertyValue('--sx') : null,
      gridCol: cards[0] ? cards[0].style.gridColumn : null
    };
  });
  console.log('补位动画中: 卡片', mid.cards, '/ state.room', mid.roomLen, '/ slide:', mid.hasSlide, '/ sx:', mid.sx, '/ gridColumn:', mid.gridCol);

  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const cards = document.querySelectorAll('#room .card');
    return {
      cards: cards.length,
      roomLen: window.__scoundrel.getState().room.length,
      deals: document.querySelectorAll('#room .card.deal').length,
      slots: Array.from(cards).map(c => c.style.gridColumn)
    };
  });
  console.log('补位完成后: 卡片', after.cards, '/ state.room', after.roomLen, '/ deal:', after.deals, '/ slots:', after.slots.join(','));

  // 再点一次（房间 4 张 → 3 张）不触发补位
  await page.click('#room .card:nth-child(4)');
  await page.waitForTimeout(100);
  const after2 = await page.evaluate(() => ({
    cards: document.querySelectorAll('#room .card').length,
    roomLen: window.__scoundrel.getState().room.length,
    hasSlide: document.querySelectorAll('#room .card.slot-shift').length
  }));
  console.log('4→3 张时: 卡片', after2.cards, '/ state.room', after2.roomLen, '/ slide:', after2.hasSlide);

  await page.screenshot({ path: path.join(ROOT, 'shots', 'compact-final.png') });
  await browser.close();

  const ok =
    before.cards === 2 && before.roomLen === 2 &&
    mid.cards === 1 && mid.roomLen === 4 && mid.hasSlide === 1 &&
    after.cards === 4 && after.roomLen === 4 && after.deals === 3 &&
    after2.cards === 3 && after2.roomLen === 3 && after2.hasSlide === 0;
  console.log(ok ? '\nOK - 补位流程正确' : '\nFAIL - 补位流程异常');
  if (errors.length) { console.log('ERRORS:', errors); process.exit(1); }
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
