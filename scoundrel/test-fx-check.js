/* 验证特效元素确实生成：飘字/粒子/幽灵牌/震动 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const G = require('./game.js');
const C = G._internal.makeCard;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('file://' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/') + '?debug');
  await page.click('#btnStart');
  await page.waitForTimeout(600);

  const setState = (patch) => page.evaluate((p) => {
    window.__scoundrel.setState(JSON.parse(p));
    window.__scoundrel.render(0);
  }, JSON.stringify(Object.assign(G.newGame(1), patch)));

  // 空手受伤：应有 1 飘字 + 13 粒子 + 1 幽灵牌 + 震动
  await setState({
    hp: 20, deck: [],
    room: [C('S', 9), C('H', 6), C('D', 8), C('C', 4)],
    weapon: null, potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  });
  await page.click('#room .card:nth-child(1)');
  await page.waitForTimeout(120);
  let r = await page.evaluate(() => ({
    floats: document.querySelectorAll('.fx-float').length,
    particles: document.querySelectorAll('.fx-particle').length,
    ghosts: document.querySelectorAll('.fx-ghost').length,
    hp: document.getElementById('hpText').textContent,
    shake: document.getElementById('shakeRoot').style.transform !== ''
  }));
  console.log('空手受伤:', JSON.stringify(r));
  if (r.floats !== 1 || r.hp !== '11/20') throw new Error('飘字/伤害异常');

  await page.waitForTimeout(900);

  // 血瓶：+6 飘字
  await setState({
    hp: 9, deck: [],
    room: [C('S', 2), C('H', 6), C('D', 8), C('C', 4)],
    weapon: null, potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  });
  await page.click('#room .card:nth-child(2)');
  await page.waitForTimeout(120);
  r = await page.evaluate(() => ({
    floats: document.querySelectorAll('.fx-float').length,
    hp: document.getElementById('hpText').textContent,
    flash: document.getElementById('flashOverlay').className
  }));
  console.log('血瓶:', JSON.stringify(r));
  if (r.hp !== '15/20') throw new Error('血瓶回复异常');
  await page.waitForTimeout(900);

  // 踢门：中段应有 kick-out 动画中的牌
  await setState({
    hp: 15, deck: [C('C', 5), C('C', 7), C('S', 8), C('H', 3)],
    room: [C('S', 2), C('H', 6), C('D', 8), C('C', 4)],
    weapon: null, potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  });
  await page.click('#kickBtn');
  await page.waitForTimeout(120);
  r = await page.evaluate(() => ({
    kicking: document.querySelectorAll('.card.kick-out').length,
    jolt: document.getElementById('room').className,
    shaking: document.getElementById('shakeRoot').style.transform !== ''
  }));
  console.log('踢门中段:', JSON.stringify(r));
  if (r.kicking !== 4) throw new Error('踢门动画异常');
  await page.waitForTimeout(500);
  r = await page.evaluate(() => ({
    roomCards: document.querySelectorAll('#room .card').length,
    deck: document.getElementById('deckCount').textContent,
    toast: document.querySelectorAll('.fx-toast').length
  }));
  console.log('踢门完成:', JSON.stringify(r));
  if (r.roomCards !== 4) throw new Error('踢门后房间异常');

  await browser.close();

  // ---- 触摸长按后重渲染，补位牌不得残留缩放 ----
  const tb = await chromium.launch();
  const tctx = await tb.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const tp = await tctx.newPage();
  const terr = [];
  tp.on('pageerror', e => terr.push(e.message));
  await tp.goto('file://' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/') + '?debug');
  await tp.click('#btnStart');
  await tp.waitForTimeout(600);
  await tp.evaluate((p) => {
    window.__scoundrel.setState(JSON.parse(p));
    window.__scoundrel.render(0);
  }, JSON.stringify(Object.assign(G.newGame(1), {
    hp: 20, deck: [],
    room: [C('S', 2), C('S', 3), C('S', 4), C('S', 5)],
    weapon: null, potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  })));
  const pt = await tp.evaluate(() => {
    const el = document.querySelectorAll('#room .card')[1];
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const cdp = await tctx.newCDPSession(tp);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
  await tp.waitForTimeout(250);
  const during = await tp.evaluate(() => {
    const el = document.querySelectorAll('#room .card')[1];
    return { pressing: el.classList.contains('pressing'), transform: getComputedStyle(el).transform };
  });
  console.log('长按中(应有缩放反馈):', JSON.stringify(during));
  if (!during.pressing || during.transform === 'none') throw new Error('按压反馈缺失');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tp.waitForTimeout(250);
  const after = await tp.evaluate(() => {
    const el = document.querySelectorAll('#room .card')[1]; // 原第3张补位
    return { pressing: el.classList.contains('pressing'), transform: getComputedStyle(el).transform };
  });
  console.log('重渲染后补位牌(应无缩放):', JSON.stringify(after));
  if (after.pressing || after.transform !== 'none') throw new Error('补位牌残留缩放');
  if (terr.length) throw new Error('页面错误: ' + terr.join('; '));
  await tb.close();

  console.log('\nOK - 特效验证通过');
})().catch(e => { console.error(e.message); process.exit(1); });
