/* ============================================================
   无赖勇者 Scoundrel - 截图验收（node test-shot.js）
   覆盖：首页 / 开局房间 / 空手受伤 / 武器满挡 / 血瓶 /
         装备 / 收起武器 / 踢门 / 失败 / 通关 / 桌面视图
   ============================================================ */
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'shots');
const VIEW = { width: 390, height: 844 };

const G = require('./game.js');
const C = G._internal.makeCard;

function statePatch(patch) {
  return Object.assign(G.newGame(12345), patch);
}

async function main() {
  const fs = require('fs');
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEW });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const url = 'file://' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?debug';
  await page.goto(url);
  await page.waitForTimeout(400);

  async function shot(name) {
    await page.screenshot({ path: path.join(SHOTS, name) });
    console.log('  shot:', name);
  }
  async function setState(patch, deal) {
    await page.evaluate(({ p, d }) => {
      const D = window.__scoundrel;
      D.setState(JSON.parse(p));
      D.render(d);
    }, { p: JSON.stringify(statePatch(patch)), d: deal || 0 });
    await page.waitForTimeout(250);
  }
  async function clickCard(i) {
    await page.click(`#room .card:nth-child(${i + 1})`);
  }

  // 1. 首页
  console.log('■ 首页');
  await shot('s1-landing.png');

  // 2. 开局（随机牌）
  console.log('■ 开局');
  await page.click('#btnStart');
  await page.waitForTimeout(1100);
  await shot('s2-start.png');

  // 3. 空手受伤：房间 [S9 怪, H6 血瓶, D8 装备, C4 怪]，有武器但记录6 → S9 和 C4 都有"空手"角标
  console.log('■ 空手受伤（含空手角标）');
  await setState({
    hp: 20,
    deck: [C('C', 2), C('C', 3), C('C', 5), C('C', 7)],
    room: [C('S', 9), C('H', 6), C('D', 8), C('C', 4)],
    weapon: { card: C('D', 10), enabled: true, lastFight: 6 },
    potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 2, rooms: 4, kicks: 1 }
  }, 0);
  await clickCard(0);
  await page.waitForTimeout(140); // 抓住飘字瞬间
  await shot('s3-unarmed-hit.png');
  await page.waitForTimeout(700);

  // 4. 血瓶回复
  console.log('■ 血瓶回复');
  await setState({
    hp: 9, deck: [C('C', 2)],
    room: [C('S', 2), C('H', 6), C('D', 8), C('C', 4)],
    weapon: null, potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  }, 0);
  await clickCard(1);
  await page.waitForTimeout(140);
  await shot('s4-potion.png');
  await page.waitForTimeout(700);

  // 5. 装备武器 + 新武器记录
  console.log('■ 装备武器');
  await setState({
    hp: 15, deck: [C('C', 2)],
    room: [C('S', 2), C('H', 6), C('D', 8), C('C', 4)],
    weapon: null, potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  }, 0);
  await clickCard(2);
  await page.waitForTimeout(180);
  await shot('s5-equip.png');
  await page.waitForTimeout(500);

  // 6. 武器满挡对决
  console.log('■ 武器满挡');
  await setState({
    hp: 15, deck: [C('C', 2)],
    room: [C('S', 9), C('H', 6), C('D', 8), C('C', 4)],
    weapon: { card: C('D', 8), enabled: true, lastFight: null },
    potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  }, 0);
  await clickCard(3);
  await page.waitForTimeout(150);
  await shot('s6-block.png');
  await page.waitForTimeout(700);

  // 7. 武器部分减伤（武器8 vs 怪9 → -1）
  console.log('■ 部分减伤');
  await setState({
    hp: 15, deck: [C('C', 2)],
    room: [C('S', 9), C('H', 6), C('D', 8), C('C', 4)],
    weapon: { card: C('D', 8), enabled: true, lastFight: null },
    potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  }, 0);
  await clickCard(0);
  await page.waitForTimeout(150);
  await shot('s7-partial.png');
  await page.waitForTimeout(700);

  // 8. 收起武器
  console.log('■ 收起武器');
  await setState({
    hp: 14, deck: [C('C', 2)],
    room: [C('S', 9), C('H', 6), C('D', 8), C('C', 4)],
    weapon: { card: C('D', 8), enabled: true, lastFight: 5 },
    potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  }, 0);
  await page.click('.weapon-panel .switch');
  await page.waitForTimeout(160);
  await shot('s8-sheathed.png');
  await page.waitForTimeout(700);

  // 9. 踢门动画
  console.log('■ 踢门');
  await setState({
    hp: 14, deck: [C('C', 5), C('C', 7), C('S', 8), C('H', 3)],
    room: [C('S', 2), C('H', 6), C('D', 8), C('C', 4)],
    weapon: { card: C('D', 8), enabled: true, lastFight: 5 },
    potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 0, rooms: 1, kicks: 0 }
  }, 0);
  await page.click('#kickBtn');
  await page.waitForTimeout(160);
  await shot('s9-kick-mid.png');
  await page.waitForTimeout(600);
  await shot('s9b-kick-after.png');

  // 10. 失败结算
  console.log('■ 失败');
  await setState({
    hp: 3, deck: [],
    room: [C('S', 4), C('C', 2)],
    weapon: null, potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 5, rooms: 3, kicks: 1 }
  }, 0);
  await clickCard(0);
  await page.waitForTimeout(900);
  await shot('s10-lose.png');

  // 11. 通关结算
  console.log('■ 通关');
  await page.evaluate(() => document.getElementById('overOverlay').classList.remove('show'));
  await setState({
    hp: 11, deck: [],
    room: [C('S', 2)],
    weapon: { card: C('D', 8), enabled: true, lastFight: 4 },
    potionUsed: false, kickBanned: false, phase: 'playing',
    stats: { kills: 12, rooms: 7, kicks: 2 }
  }, 0);
  await clickCard(0);
  await page.waitForTimeout(950);
  await shot('s11-win.png');

  // 12. 桌面视图
  console.log('■ 桌面视图');
  await page.evaluate(() => document.getElementById('overOverlay').classList.remove('show'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.__scoundrel.setState(JSON.parse('{"hp":18,"deck":[],"room":[{"suit":"S","rank":9},{"suit":"H","rank":6},{"suit":"D","rank":8},{"suit":"C","rank":4}],"weapon":{"card":{"suit":"D","rank":10},"enabled":true,"lastFight":7},"potionUsed":false,"kickBanned":false,"phase":"playing","stats":{"kills":3,"rooms":2,"kicks":0}}'));
    window.__scoundrel.render(0);
  });
  await page.waitForTimeout(700);
  await shot('s12-desktop.png');

  await browser.close();
  if (errors.length) {
    console.log('\nERRORS:');
    errors.forEach(e => console.log('  ' + e));
    process.exit(1);
  }
  console.log('\nOK - 全部截图完成，无页面错误');
}

main().catch(e => { console.error(e); process.exit(1); });
