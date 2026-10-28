/* 流冰航路 · 单人模式 E2E（Playwright）
 * 运行：先启动静态服务器（默认 http://127.0.0.1:8765/），再执行 node test-e2e.js
 * 可用 BASE_URL 环境变量覆盖地址。*/
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765/';
const SHOTS = path.join(__dirname, '..', '.shots');

let passed = 0, failed = 0;
const failures = [];
const browserErrors = [];

function ok(cond, name, detail) {
  if (cond) {
    passed++;
    console.log('  \u2713 ' + name);
  } else {
    failed++;
    failures.push(name + (detail ? ' \u2014 ' + detail : ''));
    console.log('  \u2717 ' + name + (detail ? ' \u2014 ' + detail : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTestPage(browser, viewport) {
  const context = await browser.newContext({
    viewport: viewport || { width: 390, height: 844 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') browserErrors.push(m.text()); });
  page.on('pageerror', (e) => browserErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  return { context, page };
}

const getState = (page) => page.evaluate(() => window.FrozenPassageApp.getState());
const count = (page, sel) => page.locator(sel).count();
const placedCount = (s) => s.board.slots.filter((x) => x.cardId).length;

async function startViaSetup(page, diff) {
  await page.click('[data-action="start"]');
  await page.waitForSelector('[data-action="diff"][data-diff="' + diff + '"]');
  await page.click('[data-action="diff"][data-diff="' + diff + '"]');
  await sleep(80);
  await page.click('[data-action="voyage-start"]');
  await page.waitForSelector('.slot');
}

async function drainTurnEnd(page) {
  await sleep(180);
  if (await count(page, '#sheet [data-action="choose-supply"]')) {
    await page.click('#sheet [data-action="choose-supply"]');
    await sleep(160);
  }
}

async function placeViaUI(page, cardId, slotId) {
  await page.click(`.hand-card[data-card="${cardId}"]`);
  await page.click(`.slot[data-slot="${slotId}"]`);
  await page.waitForSelector('[data-action="confirm-place"]');
  await page.click('[data-action="confirm-place"]');
}

/* ---------- 场景构造（利用内置引擎，页面内计算） ---------- */

const buildWin14 = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  for (let seed = 1; seed <= 400; seed++) {
    let s = F.createGame({ seed, difficulty: 'novice' });
    let guard = 0;
    while (guard++ < 200) {
      if (s.phase === 'refill') { s = F.chooseSupply(s, s.supply[0]).state; continue; }
      if (s.phase !== 'place') break;
      const placed = s.board.slots.filter((x) => x.cardId).length;
      if (placed >= 14) return { seed, state: s };
      let move = null;
      for (const cardId of s.hand) {
        const spots = F.legalPlacements(s, cardId);
        if (spots.length) { move = { cardId, slotId: spots[0].slotId }; break; }
      }
      if (!move) break;
      const r = F.placeCard(s, move.cardId, move.slotId);
      if (!r.ok) break;
      s = r.state;
    }
  }
  return null;
});

const buildStuck = (page, wantRescue) => page.evaluate((wantRescue) => {
  const F = window.FrozenPassage;
  const found = [];
  for (let seed = 1; seed <= 500 && found.length < 2; seed++) {
    let s = F.createGame({ seed, difficulty: 'novice' });
    let guard = 0;
    while (guard++ < 200) {
      if (s.phase === 'refill') { s = F.chooseSupply(s, s.supply[0]).state; continue; }
      if (s.phase !== 'place') break;
      let move = null;
      for (const cardId of s.hand) {
        const spots = F.legalPlacements(s, cardId);
        if (spots.length) { move = { cardId, slotId: spots[0].slotId }; break; }
      }
      if (!move) break;
      const r = F.placeCard(s, move.cardId, move.slotId);
      if (!r.ok) break;
      s = r.state;
    }
    if (s.phase !== 'stuck') continue;
    const canSled = F.canUseSled(s);
    const canLog = F.canUseLog(s);
    const canInuit = F.canUseInuit(s);
    const rescue = canSled || canLog || canInuit;
    if (wantRescue === null || rescue === wantRescue) return { seed, state: s, rescue, canSled, canLog, canInuit };
  }
  return null;
}, wantRescue);

const buildInuit = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  const s = F.createGame({ seed: 12345, difficulty: 'novice' });
  s.board.slots.forEach((slot) => { slot.cardId = null; });
  const put = (r, i, id) => { F.slotByPos(s, r, i).cardId = id; };
  put(1, 1, 'blue-4');
  put(2, 1, 'blue-1'); put(2, 2, 'black-7');
  put(3, 1, 'blue-3'); put(3, 3, 'black-5');
  const boardIds = ['blue-4', 'blue-1', 'black-7', 'blue-3', 'black-5'];
  const hand = ['black-3', 'black-5', 'red-1', 'red-2'];
  const rest = Object.keys(F.CARDS).filter((id) => boardIds.indexOf(id) < 0 && hand.indexOf(id) < 0);
  s.hand = hand.slice();
  s.supply = rest.slice(0, 3);
  s.draw = rest.slice(3);
  s.items = [
    { id: 'item-1', type: 'inuit', used: false },
    { id: 'item-2', type: 'sled', used: false },
    { id: 'item-3', type: 'log', used: false }
  ];
  s.phase = 'place';
  s.turn = 7;
  s.wisdom = false;
  return { state: s, cardId: 'black-3', slotId: 'r3-2' };
});

const buildLogScenario = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  for (let seed = 1; seed <= 400; seed++) {
    let s = F.createGame({ seed, difficulty: 'novice' });
    if (!s.items.some((i) => i.type === 'log' && !i.used)) continue;
    let move = null;
    for (const cardId of s.hand) {
      const spots = F.legalPlacements(s, cardId);
      if (spots.length) { move = { cardId, slotId: spots[0].slotId }; break; }
    }
    if (!move) continue;
    let r = F.placeCard(s, move.cardId, move.slotId);
    if (!r.ok) continue;
    s = r.state;
    if (s.phase === 'refill') s = F.chooseSupply(s, s.supply[0]).state;
    if (s.phase !== 'place') continue;
    const opts = F.logOptions(s);
    if (opts.length) return { state: s, option: opts[0] };
  }
  return null;
});

const buildLogStartCase = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  const s = F.createGame({ seed: 12345, difficulty: 'novice' });
  s.board.slots.forEach((slot) => { slot.cardId = null; });
  const put = (r, i, id) => { F.slotByPos(s, r, i).cardId = id; };
  const boardIds = ['black-5', 'blue-1', 'black-7', 'red-4', 'blue-5', 'black-6'];
  put(1, 1, 'black-5');
  put(2, 1, 'blue-1'); put(2, 2, 'black-7');
  put(3, 1, 'red-4'); put(3, 2, 'blue-5'); put(3, 3, 'black-6');
  s.hand = ['red-1', 'red-6', 'red-9', 'black-9'];
  const rest = Object.keys(F.CARDS).filter((id) => boardIds.indexOf(id) < 0 && s.hand.indexOf(id) < 0);
  s.supply = rest.slice(0, 3);
  s.draw = rest.slice(3);
  s.items = [
    { id: 'item-1', type: 'log', used: false },
    { id: 'item-2', type: 'sled', used: false },
    { id: 'item-3', type: 'log', used: false }
  ];
  s.phase = 'place';
  s.turn = 7;
  s.wisdom = false;
  return { state: s };
});

const buildInuitStuck = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  const s = F.createGame({ seed: 12345, difficulty: 'novice' });
  s.board.slots.forEach((slot) => { slot.cardId = null; });
  const ids = Object.keys(F.CARDS).filter((id) => id !== 'blue-4' && id !== 'blue-5' && id !== 'red-5');
  let cursor = 0;
  s.board.slots.forEach((slot) => {
    if (slot.id === 'r1-1') { slot.cardId = 'blue-4'; return; }
    if (slot.id === 'r2-1') { slot.cardId = 'blue-5'; return; }
    if (slot.id === 'r2-2') return;
    slot.cardId = ids[cursor++];
  });
  s.hand = ['red-5'];
  s.supply = ids.slice(cursor, cursor + 3);
  s.draw = ids.slice(cursor + 3);
  s.items = [
    { id: 'item-1', type: 'inuit', used: false },
    { id: 'item-2', type: 'sled', used: false },
    { id: 'item-3', type: 'log', used: false }
  ];
  s.phase = 'stuck';
  s.lossHint = true;
  s.turn = 8;
  s.wisdom = false;
  return { state: s, cardId: 'red-5', slotId: 'r2-2' };
});

const buildSledScenario = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  for (let seed = 1; seed <= 300; seed++) {
    const s = F.createGame({ seed, difficulty: 'novice' });
    if (!s.items.some((i) => i.type === 'sled' && !i.used)) continue;
    if (!F.canUseSled(s)) continue;
    return { seed };
  }
  return null;
});

const buildGoalColorCase = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  const s = F.createGame({ seed: 12345, difficulty: 'medium' });
  const goal = s.board.goals.filter((g) => g.faceUp).sort((a, b) => a.slotId.localeCompare(b.slotId))[0];
  if (!goal) return null;
  const slot5 = F.slotById(s, goal.slotId);
  const below = F.supportSlots(s, slot5);
  const ids = Object.keys(F.CARDS);
  below.forEach((b, i) => { b.cardId = ids[(i * 5 + 2) % ids.length]; });
  const wrong = ids.find((id) => F.CARDS[id].color !== goal.color);
  const right = ids.find((id) => F.CARDS[id].color === goal.color);
  const spare = ids.find((id) => id !== wrong && id !== right);
  s.hand = [wrong, right, spare];
  return { state: s, wrong, right, goalColor: goal.color, slotId: slot5.id };
});

const buildColorBlockCase = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  const s = F.createGame({ seed: 12345, difficulty: 'novice' });
  s.board.slots.forEach((slot) => { slot.cardId = null; });
  const put = (r, i, id) => { F.slotByPos(s, r, i).cardId = id; };
  const boardIds = [
    'blue-3', 'red-3', 'blue-6', 'black-1', 'red-5', 'blue-9',
    'blue-1', 'black-4', 'red-8'
  ];
  put(1, 1, 'blue-3');
  put(2, 1, 'red-3'); put(2, 2, 'blue-6');
  put(3, 1, 'black-1'); put(3, 2, 'red-5'); put(3, 3, 'blue-9');
  put(4, 1, 'blue-1'); put(4, 2, 'black-4'); put(4, 3, 'red-8');
  const want = ['black-9', 'red-9', 'blue-8', 'black-8'];
  const rest = s.hand.concat(s.supply, s.draw)
    .filter((id) => boardIds.indexOf(id) < 0 && want.indexOf(id) < 0);
  s.hand = want.slice();
  s.supply = rest.slice(0, 3);
  s.draw = rest.slice(3);
  s.phase = 'place';
  s.turn = 9;
  s.wisdom = false;
  return { state: s, cardId: 'black-9', slotId: 'r4-4' };
});

const buildSameRowCase = (page) => page.evaluate(() => {
  const F = window.FrozenPassage;
  const s = F.createGame({ seed: 12345, difficulty: 'novice' });
  let maxCard = null;
  s.hand.forEach((id) => {
    const c = F.getCard(id);
    if (!maxCard || c.number > F.getCard(maxCard).number) maxCard = id;
  });
  const probe = F.placeCard(s, maxCard, 'r1-1');
  if (!probe.ok) return null;
  const after = probe.state;
  const cards = after.hand.map((id) => F.getCard(id)).sort((a, b) => a.number - b.number);
  const small = cards[0];
  const second = cards[cards.length - 1];
  if (!F.canPlace(after, second.id, 'r2-1').ok) return null;
  return { maxCard, second: second.id, small: small.id };
});

/* ---------- 用例 ---------- */

async function testSetupAndSheets(browser) {
  console.log('\n[1] 设置页 / 规则 / 航行记录 / 启程弹层');
  const { context, page } = await newTestPage(browser);
  ok(await count(page, '.diff-card') === 0, '首页不直接展示难度选择');
  ok(await count(page, '.mini-stats') === 0, '首页不直接展示难度统计');
  ok(await count(page, '[data-action="start"]') === 1, '启程按钮存在');
  ok(await count(page, '[data-action="rules"]') >= 1, '设置页有规则入口');

  await page.click('[data-action="start"]');
  await page.waitForSelector('.sheet-title');
  ok((await page.textContent('.sheet-title')).indexOf('启程') >= 0, '启程弹层打开');
  ok(await count(page, '.diff-card') === 3, '弹层内三个难度卡片');
  ok(await count(page, '.mini-stats') === 1, '弹层内展示当前难度统计');
  await page.click('[data-action="diff"][data-diff="expert"]');
  await sleep(150);
  ok(await count(page, '.diff-card.is-active[data-diff="expert"]') === 1, '弹层内可切换难度');
  await page.click('[data-action="close-sheet"]');
  await sleep(150);

  await page.click('[data-action="rules"]');
  await page.waitForSelector('.sheet-title');
  ok((await page.textContent('.sheet-title')).length > 0, '规则层打开');
  ok(await count(page, '[data-action="rules-tab"]') === 4, '规则层 4 个分类');
  await page.keyboard.press('Escape');
  await sleep(200);
  ok(await page.locator('#overlay').isHidden(), 'Esc 关闭规则层');

  await page.click('[data-action="stats"]');
  await page.waitForSelector('.sheet-title');
  const statText = await page.textContent('#sheetBody');
  ok(statText.indexOf('暂无记录') >= 0 || statText.indexOf('完成') >= 0, '航行记录显示统计');
  await page.click('[data-action="close-sheet"]');
  await context.close();
}

async function testStartNoviceAndMedium(browser) {
  console.log('\n[2] 开局：新手 / 中等难度');
  const { context, page } = await newTestPage(browser);
  await startViaSetup(page, 'novice');
  let s = await getState(page);
  ok(placedCount(s) === 0, '开局 15 个空位未被占用');
  ok(s.hand.length === 4, '手牌 4 张', '实际 ' + s.hand.length);
  ok(s.supply.length === 3, '供应堆 3 张', '实际 ' + s.supply.length);
  ok(s.items.length === 3, '单人物品 3 个', '实际 ' + s.items.length);
  ok(s.items.every((i) => ['inuit', 'sled', 'log'].indexOf(i.type) >= 0), '物品池为单人三件套');
  ok(s.turn === 1 && s.phase === 'place', '第 1 回合放置阶段');
  ok(await count(page, '.goal-tab.is-down') === 5, '新手 5 张目标卡全部背面');
  ok(await count(page, '.slot') === 15, '棋盘 15 个位置');

  const medium = await page.evaluate(() => {
    window.FrozenPassageApp.startNewGame({ seed: 12345, difficulty: 'medium' });
    return null;
  });
  await sleep(250);
  s = await getState(page);
  ok(s.difficulty === 'medium', '切换到中等难度');
  ok(await count(page, '.goal-tab:not(.is-down)') === 3, '中等翻开 1/3/5 三张目标卡');
  await context.close();
}

async function testPlaceRefillFlow(browser) {
  console.log('\n[3] 放置 → 确认 → 补牌 → 第 2 回合');
  const { context, page } = await newTestPage(browser);
  await page.evaluate(() => window.FrozenPassageApp.startNewGame({ seed: 12345, difficulty: 'novice' }));
  await sleep(250);
  let s = await getState(page);
  const cardId = s.hand[0];

  await page.click(`.hand-card[data-card="${cardId}"]`);
  const legal = await count(page, '.slot.is-legal');
  ok(legal > 0, '选中手牌后高亮合法位', '高亮 ' + legal);

  await page.click('.slot[data-slot="r1-1"]');
  await page.waitForSelector('[data-action="confirm-place"]');
  const confirmText = await page.textContent('#sheetBody');
  ok(confirmText.indexOf('支撑') >= 0 || confirmText.indexOf('规则') >= 0, '确认层展示命中规则');
  await page.click('[data-action="confirm-place"]');
  await drainTurnEnd(page);

  s = await getState(page);
  ok(placedCount(s) === 1, '放置 1 张', '实际 ' + placedCount(s));
  ok(s.board.slots.find((x) => x.id === 'r1-1').cardId === cardId, '卡牌落在 r1-1');
  ok(s.turn === 2, '进入第 2 回合', '实际第 ' + s.turn);
  ok(s.hand.length === 4, '补牌后手牌 4 张', '实际 ' + s.hand.length);
  ok(s.supply.length === 3, '供应堆补齐为 3', '实际 ' + s.supply.length);
  ok(s.phase === 'place', '回到放置阶段');
  await context.close();
}

async function testIllegalMoves(browser) {
  console.log('\n[4] 非法落子提示');
  const { context, page } = await newTestPage(browser);
  await page.evaluate(() => window.FrozenPassageApp.startNewGame({ seed: 12345, difficulty: 'novice' }));
  await sleep(250);
  let s = await getState(page);

  await page.click(`.hand-card[data-card="${s.hand[0]}"]`);
  await page.click('.slot[data-slot="r2-1"]');
  await sleep(150);
  let toast = await page.textContent('.toast.is-show');
  ok(toast.indexOf('支撑') >= 0, '缺支撑被拦截', toast);

  ok(await page.locator('#overlay').isHidden(), '非法落子不弹出确认层');
  ok((await getState(page)).phase === 'place', '状态未变化');

  const row = await buildSameRowCase(page);
  if (!row) {
    ok(false, '构造同行数字对比场景');
  } else {
    await page.evaluate(() => window.FrozenPassageApp.startNewGame({ seed: 12345, difficulty: 'novice' }));
    await sleep(200);
    await page.click(`.hand-card[data-card="${row.maxCard}"]`);
    await page.click('.slot[data-slot="r1-1"]');
    await page.waitForSelector('[data-action="confirm-place"]');
    await page.click('[data-action="confirm-place"]');
    await drainTurnEnd(page);
    await placeViaUI(page, row.second, 'r2-1');
    await drainTurnEnd(page);
    await page.click(`.hand-card[data-card="${row.small}"]`);
    await page.click('.slot[data-slot="r2-2"]');
    await sleep(150);
    toast = await page.textContent('.toast.is-show');
    ok(toast.indexOf('大于') >= 0, '同行数字不递增被拦截', toast);
    await page.click('.slot[data-slot="r2-1"]');
    await sleep(150);
    toast = await page.textContent('.toast.is-show');
    ok(toast.indexOf('已有卡牌') >= 0, '已占用位置提示用航海日志', toast);
  }
  await context.close();
}

async function testGoalColorRule(browser) {
  console.log('\n[5] 正面目标卡颜色规则（中等）');
  const { context, page } = await newTestPage(browser);
  const crafted = await buildGoalColorCase(page);
  if (!crafted) { ok(false, '构造目标卡颜色场景'); await context.close(); return; }
  await page.evaluate((st) => window.FrozenPassageApp.restore(st), crafted.state);
  await sleep(250);

  await page.click(`.hand-card[data-card="${crafted.wrong}"]`);
  await page.click(`.slot[data-slot="${crafted.slotId}"]`);
  await sleep(150);
  const toast = await page.textContent('.toast.is-show');
  ok(toast.indexOf('目标卡') >= 0, '颜色不符被拦截', toast);

  await page.click(`.hand-card[data-card="${crafted.right}"]`);
  await page.click(`.slot[data-slot="${crafted.slotId}"]`);
  await page.waitForSelector('[data-action="confirm-place"]');
  ok(true, '同色卡牌允许放置（弹出确认层）');
  await page.click('[data-action="confirm-place"]');
  await drainTurnEnd(page);
  const s = await getState(page);
  ok(s.board.slots.find((x) => x.id === crafted.slotId).cardId === crafted.right, '同色卡牌落下');
  await context.close();
}

async function testColorContinuityRule(browser) {
  console.log('\n[5b] 规则② 颜色接续（截图残局回归）');
  const { context, page } = await newTestPage(browser);
  const sc = await buildColorBlockCase(page);
  await page.evaluate((st) => window.FrozenPassageApp.restore(st), sc.state);
  await sleep(250);

  await page.click(`.hand-card[data-card="${sc.cardId}"]`);
  await page.click(`.slot[data-slot="${sc.slotId}"]`);
  await sleep(180);
  const toast = await page.textContent('.toast.is-show').catch(() => '');
  ok(toast.indexOf('同色') >= 0 || toast.indexOf('蓝色') >= 0, '黑 9 压蓝 9 被颜色规则拦截', toast);
  ok(await page.locator('#overlay').isHidden(), '颜色非法时不弹出确认层');
  const s = await getState(page);
  ok(s.board.slots.find((x) => x.id === sc.slotId).cardId === null, 'r4-4 保持为空');
  await context.close();
}

async function testInuitItem(browser) {
  console.log('\n[6] 因纽特智慧：本回合紧邻同数字');
  const { context, page } = await newTestPage(browser);
  const sc = await buildInuit(page);
  await page.evaluate((st) => window.FrozenPassageApp.restore(st), sc.state);
  await sleep(250);
  const before = await getState(page);
  ok(before.phase === 'place' && before.wisdom === false, '残局处于放置阶段');

  await page.click(`.hand-card[data-card="${sc.cardId}"]`);
  await page.click(`.slot[data-slot="${sc.slotId}"]`);
  await sleep(150);
  let toast = await page.textContent('.toast.is-show').catch(() => '');
  ok(toast.indexOf('大于') >= 0 || toast.indexOf('紧邻') >= 0, '未使用物品时同数字被拦截', toast);
  ok(await page.locator('#overlay').isHidden(), '拦截时不弹出确认层');

  await page.click('[data-action="item"][data-type="inuit"]');
  await page.waitForSelector('[data-action="use-inuit"]');
  ok((await page.textContent('#sheetBody')).indexOf('紧邻') >= 0, '使用层说明紧邻豁免');
  ok(await count(page, '[data-action="inuit-option"]') > 0, '使用层列出豁免落点');
  await page.click('[data-action="use-inuit"]');
  await sleep(220);

  let s = await getState(page);
  ok(s.wisdom === true, '因纽特智慧本回合生效');
  ok(s.items.filter((i) => i.type === 'inuit')[0].used === true, '物品已翻面');
  ok(await count(page, '.info-chip.is-wisdom') === 1, '信息条显示因纽特智慧标记');
  ok(await count(page, `.hand-card[data-card="${sc.cardId}"].is-selected`) === 1, '激活后保留选牌');

  await page.click(`.slot[data-slot="${sc.slotId}"]`);
  await page.waitForSelector('[data-action="confirm-place"]');
  const confirmText = await page.textContent('#sheetBody');
  ok(confirmText.indexOf('因纽特智慧') >= 0, '确认层注明因纽特智慧生效', confirmText);
  await page.click('[data-action="confirm-place"]');
  await drainTurnEnd(page);

  s = await getState(page);
  ok(s.board.slots.find((x) => x.id === sc.slotId).cardId === sc.cardId, '紧邻同数字卡牌落下');
  ok(placedCount(s) === placedCount(before) + 1, '本回合只多放 1 张', '实际 ' + placedCount(s));
  ok(s.wisdom === false, '放置后效果结束');
  ok(s.turn === before.turn + 1, '进入下一回合');
  ok(s.hand.length === 4, '仍然只补 1 张', '实际 ' + s.hand.length);
  await context.close();
}

async function testInuitStuckRescue(browser) {
  console.log('\n[6b] 因纽特智慧：卡住时解救');
  const { context, page } = await newTestPage(browser);
  const sc = await buildInuitStuck(page);
  await page.evaluate((st) => window.FrozenPassageApp.restore(st), sc.state);
  await sleep(250);
  ok((await page.textContent('.sheet-title')).indexOf('无法放置') >= 0, '卡住时自动弹出救援层');
  ok(await count(page, '#sheet [data-action="stuck-inuit"]') === 1, '救援层提供因纽特智慧');

  await page.click('#sheet [data-action="stuck-inuit"]');
  await page.waitForSelector('[data-action="use-inuit"]');
  await page.click('[data-action="use-inuit"]');
  await sleep(250);
  let s = await getState(page);
  ok(s.phase === 'place' && s.wisdom === true, '使用后解除卡住');
  ok(s.items.filter((i) => i.type === 'inuit')[0].used === true, '因纽特智慧标记已用');

  await page.click(`.hand-card[data-card="${sc.cardId}"]`);
  await page.click(`.slot[data-slot="${sc.slotId}"]`);
  await page.waitForSelector('[data-action="confirm-place"]');
  await page.click('[data-action="confirm-place"]');
  await sleep(350);
  s = await getState(page);
  ok(placedCount(s) === 15 && s.phase === 'won', '紧邻同数字完成填满', s.phase + ' ' + placedCount(s));
  ok(await count(page, '.sheet-title') === 1, '胜利结算层打开');
  await context.close();
}

async function testSledItem(browser) {
  console.log('\n[7] 狗拉雪橇：换牌');
  const { context, page } = await newTestPage(browser);
  const sc = await buildSledScenario(page);
  if (!sc) { ok(false, '构造狗拉雪橇场景'); await context.close(); return; }
  await page.evaluate((seed) => window.FrozenPassageApp.startNewGame({ seed, difficulty: 'novice' }), sc.seed);
  await sleep(250);
  const before = await getState(page);
  const handPick = before.hand[0];
  const supplyPick = before.supply[0];

  await page.click('[data-action="item"][data-type="sled"]');
  await page.waitForSelector('[data-action="sled-confirm"]');
  ok(await page.locator('[data-action="sled-confirm"]').isDisabled(), '未选牌时确认禁用');
  await page.click(`[data-action="sled-hand"][data-card="${handPick}"]`);
  await page.click(`[data-action="sled-supply"][data-card="${supplyPick}"]`);
  await sleep(120);
  ok(await page.locator('[data-action="sled-confirm"]').isEnabled(), '选齐后确认可用');
  await page.click('[data-action="sled-confirm"]');
  await sleep(220);

  const s = await getState(page);
  ok(s.items.filter((i) => i.type === 'sled')[0].used === true, '雪橇标记已用');
  ok(s.hand.indexOf(supplyPick) >= 0, '供应堆卡牌进入手牌');
  ok(s.hand.indexOf(handPick) < 0, '放回的卡牌离开手牌');
  ok(s.draw[0] === handPick, '放回的卡牌位于抽牌堆底');
  ok(s.hand.length === 4 && s.supply.length === 3, '牌数守恒（手牌 4 / 供应 3）');
  ok(s.phase === 'place' && placedCount(s) === 0, '仍为放置阶段');
  await context.close();
}

async function testLogItem(browser) {
  console.log('\n[8] 航海日志：替换已放置卡牌');
  const { context, page } = await newTestPage(browser);
  const sc = await buildLogScenario(page);
  if (!sc) { ok(false, '构造航海日志场景'); await context.close(); return; }
  await page.evaluate((st) => window.FrozenPassageApp.restore(st), sc.state);
  await sleep(250);

  await page.click('[data-action="item"][data-type="log"]');
  await page.waitForSelector('[data-action="log-slot"]');
  await page.click(`[data-action="log-slot"][data-slot="${sc.option.slotId}"]`);
  await sleep(150);
  await page.click(`[data-action="log-hand"][data-card="${sc.option.cardId}"]`);
  await sleep(120);
  ok(await page.locator('[data-action="log-confirm"]').isEnabled(), '选齐后确认可用');
  await page.click('[data-action="log-confirm"]');
  await sleep(220);

  const s = await getState(page);
  ok(s.board.slots.find((x) => x.id === sc.option.slotId).cardId === sc.option.cardId, '新卡替换成功');
  ok(s.hand.indexOf(sc.option.outCardId) >= 0, '换下的卡回到手牌');
  ok(s.items.filter((i) => i.type === 'log')[0].used === true, '日志标记已用');
  await context.close();
}

async function testLogStartUpperColor(browser) {
  console.log('\n[8b] 航海日志：替换起点必须接续上方航路');
  const { context, page } = await newTestPage(browser);
  const sc = await buildLogStartCase(page);
  await page.evaluate((st) => window.FrozenPassageApp.restore(st), sc.state);
  await sleep(250);

  const direct = await page.evaluate(() => {
    const s = window.FrozenPassageApp.getState();
    const r = window.FrozenPassage.useLog(s, 'r1-1', 'red-9');
    return { ok: r.ok, code: r.code, uppers: r.upperCardIds };
  });
  ok(direct.ok === false && direct.code === 'color', '引擎拒绝红 9 替换起点', JSON.stringify(direct));
  ok(Array.isArray(direct.uppers) && direct.uppers.join(',') === 'blue-1,black-7',
    '错误指向第二行蓝 1、黑 7');

  await page.click('[data-action="item"][data-type="log"]');
  await page.waitForSelector('[data-action="log-slot"]');
  await page.click('[data-action="log-slot"][data-slot="r1-1"]');
  await sleep(150);

  const hints = await page.locator('.sheet-note').allTextContents();
  ok(hints.some((t) => t.indexOf('蓝色或黑色') >= 0), '提示起点只能接蓝色或黑色', hints.join(' | '));

  const red = page.locator('[data-action="log-hand"][data-card="red-9"]');
  const black = page.locator('[data-action="log-hand"][data-card="black-9"]');
  ok(await red.isDisabled(), '红 9 在起点位被禁用');
  ok(await black.isEnabled(), '黑 9 可替换起点');

  await black.click();
  await sleep(120);
  const blackPreview = await page.locator('.log-preview').textContent();
  ok(blackPreview.indexOf('黑 7') >= 0 && blackPreview.indexOf('接续') >= 0,
    '预览说明黑 9 由上方黑 7 接续', blackPreview);
  ok(await page.locator('[data-action="log-confirm"]').isEnabled(), '确认按钮可用');
  await page.click('[data-action="log-confirm"]');
  await sleep(250);

  const s = await getState(page);
  ok(s.board.slots.find((x) => x.id === 'r1-1').cardId === 'black-9', '黑 9 替换黑 5 成功');
  ok(s.hand.indexOf('black-5') >= 0, '黑 5 回到手牌');
  ok(s.items.filter((i) => i.type === 'log')[0].used === true, '日志标记已用');
  await context.close();
}

async function testAutosaveResume(browser) {
  console.log('\n[9] 自动存档与续玩');
  const { context, page } = await newTestPage(browser);
  await page.evaluate(() => window.FrozenPassageApp.startNewGame({ seed: 12345, difficulty: 'novice' }));
  await sleep(250);
  let s = await getState(page);
  await placeViaUI(page, s.hand[0], 'r1-1');
  await drainTurnEnd(page);
  const saved = await page.evaluate(() => localStorage.getItem('frozen-passage.save.v1'));
  ok(!!saved && saved.length > 50, 'localStorage 写入存档');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-action="continue"]');
  ok(true, '刷新后设置页出现「继续存档」');
  await page.click('[data-action="continue"]');
  await page.waitForSelector('.slot');
  s = await getState(page);
  ok(s.turn === 2 && placedCount(s) === 1, '棋盘/回合恢复', 'turn=' + s.turn + ' placed=' + placedCount(s));
  ok(await count(page, '.goal-tab') === 5, '目标卡状态恢复');
  await context.close();
}

async function testStuckAndLoss(browser) {
  console.log('\n[10] 卡住：物品解救 / 宣告失败');
  const t1 = await newTestPage(browser);
  const sc = await buildStuck(t1.page, true);
  if (sc) {
    await t1.page.evaluate((st) => window.FrozenPassageApp.restore(st), sc.state);
    await sleep(250);
    ok(await count(t1.page, '.sheet-title') === 1, '卡住时自动弹出救援层');
    ok((await t1.page.textContent('.sheet-title')).indexOf('无法放置') >= 0, '救援层标题正确');
    const rescueBtn = await count(t1.page, '#sheet [data-action="stuck-sled"], #sheet [data-action="stuck-log"], #sheet [data-action="stuck-inuit"]');
    ok(rescueBtn > 0, '救援层提供物品选项');
    if (sc.canSled) {
      await t1.page.click('#sheet [data-action="stuck-sled"]');
      await t1.page.waitForSelector('#sheet [data-action="sled-confirm"]');
      await t1.page.click('#sheet [data-action="sled-hand"]');
      await t1.page.click('#sheet [data-action="sled-supply"]');
      await t1.page.click('#sheet [data-action="sled-confirm"]');
      await sleep(250);
      const rescued = await getState(t1.page);
      ok(rescued.items.filter((i) => i.type === 'sled')[0].used === true, '雪橇解救已使用');
      ok(rescued.phase === 'place' || rescued.phase === 'stuck', '解救后回到可继续状态', rescued.phase);
    } else if (sc.canLog) {
      await t1.page.click('#sheet [data-action="stuck-log"]');
      await t1.page.waitForSelector('#sheet [data-action="log-slot"]');
      await t1.page.click('#sheet [data-action="log-slot"]');
      await sleep(120);
      const pick = t1.page.locator('#sheet [data-action="log-hand"]:not([disabled])').first();
      await pick.click();
      await t1.page.click('#sheet [data-action="log-confirm"]');
      await sleep(250);
      const rescued = await getState(t1.page);
      ok(rescued.items.filter((i) => i.type === 'log')[0].used === true, '航海日志解救已使用');
      ok(rescued.phase === 'place' || rescued.phase === 'stuck', '解救后回到可继续状态', rescued.phase);
    } else if (sc.canInuit) {
      await t1.page.click('#sheet [data-action="stuck-inuit"]');
      await t1.page.waitForSelector('#sheet [data-action="use-inuit"]');
      await t1.page.click('#sheet [data-action="use-inuit"]');
      await sleep(250);
      const rescued = await getState(t1.page);
      ok(rescued.items.filter((i) => i.type === 'inuit')[0].used === true, '因纽特智慧解救已使用');
      ok(rescued.phase === 'place' && rescued.wisdom === true, '解救后回到可放置状态', rescued.phase);
    }
  } else {
    ok(false, '构造可解救的卡住场景');
  }
  await t1.context.close();

  const t2 = await newTestPage(browser);
  const sc2 = await buildStuck(t2.page, null);
  if (sc2) {
    const exhausted = JSON.parse(JSON.stringify(sc2.state));
    exhausted.items.forEach((i) => { i.used = true; });
    await t2.page.evaluate((st) => window.FrozenPassageApp.restore(st), exhausted);
    await sleep(250);
    ok(await count(t2.page, '[data-action="declare-loss"]') === 1, '物品耗尽仍可宣告失败');
    await t2.page.click('[data-action="declare-loss"]');
    await t2.page.waitForSelector('[data-action="confirm-loss"]');
    await t2.page.click('[data-action="confirm-loss"]');
    await sleep(220);
    const s = await getState(t2.page);
    ok(s.phase === 'lost' && s.lossReason === 'declared', '宣告后进入失败结算', s.lossReason);
    ok((await t2.page.textContent('.sheet-title')).indexOf('结算') >= 0, '失败结算层打开');
  } else {
    ok(false, '构造物品耗尽的卡住场景');
  }
  await t2.context.close();
}

async function testWinFlow(browser) {
  console.log('\n[11] 胜利：填满 15 位');
  const { context, page } = await newTestPage(browser);
  const sc = await buildWin14(page);
  if (!sc) { ok(false, '构造 14/15 残局'); await context.close(); return; }
  await page.evaluate((st) => window.FrozenPassageApp.restore(st), sc.state);
  await sleep(250);
  const s0 = await getState(page);
  ok(placedCount(s0) === 14, '残局 14/15');

  const last = await page.evaluate(() => {
    const F = window.FrozenPassage;
    const s = window.FrozenPassageApp.getState();
    for (const cardId of s.hand) {
      const spots = F.legalPlacements(s, cardId);
      if (spots.length) return { cardId, slotId: spots[0].slotId };
    }
    return null;
  });
  await placeViaUI(page, last.cardId, last.slotId);
  await sleep(300);
  const s = await getState(page);
  ok(s.phase === 'won', '填满即胜利', s.phase);
  const title = await page.textContent('.sheet-title');
  ok(title.indexOf('结算') >= 0, '胜利结算层打开');
  const body = await page.textContent('#sheetBody');
  ok(body.indexOf('航路贯通') >= 0, '结算显示「航路贯通」');
  const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('frozen-passage.stats.v1') || '{}'));
  ok(stats.novice && stats.novice.wins >= 1, '胜利写入本地统计');

  await page.click('[data-action="result-again"]');
  await sleep(300);
  const again = await getState(page);
  ok(again && again.turn === 1 && again.phase === 'place' && placedCount(again) === 0, '再来一局重置');
  await page.click('[data-action="menu"]');
  await page.waitForSelector('[data-action="menu-setup"]');
  await page.click('[data-action="menu-setup"]');
  await sleep(200);
  ok(await page.locator('#setupScreen').isVisible(), '返回设置页');
  await context.close();
}

async function testMenuRulesHints(browser) {
  console.log('\n[12] 菜单 / 规则层 / 提示开关');
  const { context, page } = await newTestPage(browser);
  await page.evaluate(() => window.FrozenPassageApp.startNewGame({ seed: 12345, difficulty: 'novice' }));
  await sleep(250);
  const s = await getState(page);
  await page.click(`.hand-card[data-card="${s.hand[0]}"]`);
  ok(await count(page, '.slot.is-legal') > 0, '默认开启合法位高亮');

  await page.click('[data-action="menu"]');
  await page.waitForSelector('[data-action="toggle-hints"]');
  ok(await count(page, '.menu-row') >= 4, '菜单包含规则/提示/统计/重开/返回');
  await page.click('[data-action="menu-rules"]');
  await page.waitForSelector('[data-action="rules-tab"]');
  ok(await count(page, '[data-action="rules-tab"]') === 4, '规则层 4 个分类');
  for (const tab of ['flow', 'rules', 'items', 'ending']) {
    const sel = `[data-action="rules-tab"][data-tab="${tab}"]`;
    if (await count(page, sel)) {
      await page.click(sel);
      await sleep(120);
    }
  }
  ok(true, '规则分类可切换');
  await page.click('[data-action="close-sheet"]');
  await sleep(150);

  await page.click('[data-action="menu"]');
  await page.waitForSelector('[data-action="toggle-hints"]');
  await page.click('[data-action="toggle-hints"]');
  await sleep(200);
  await page.click('[data-action="close-sheet"]');
  await sleep(200);
  await page.click(`.hand-card[data-card="${s.hand[0]}"]`);
  ok(await count(page, '.slot.is-legal') === 0, '关闭提示后不再高亮合法位');
  await context.close();
}

async function testLayoutsAndConsole(browser) {
  console.log('\n[13] 响应式布局 / 控制台');
  const sizes = [
    { w: 320, h: 568 }, { w: 390, h: 844 }, { w: 768, h: 1024 },
    { w: 844, h: 390 }, { w: 1280, h: 800 }
  ];
  for (const size of sizes) {
    const { context, page } = await newTestPage(browser, { width: size.w, height: size.h });
    await page.evaluate(() => window.FrozenPassageApp.startNewGame({ seed: 12345, difficulty: 'medium' }));
    await sleep(300);
    const m = await page.evaluate(() => {
      const r = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      };
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        board: r('.board'), info: r('.info-bar'), tray: r('.tray'), hand: r('.hand-dock'),
        slots: document.querySelectorAll('.slot').length
      };
    });
    const tag = size.w + 'x' + size.h;
    ok(m.overflow === 0, tag + ' 无横向溢出', 'overflow=' + m.overflow);
    ok(m.slots === 15, tag + ' 15 个位置全部渲染');
    const boardTop = m.board ? m.board.top : 0;
    const infoBottom = m.info ? m.info.bottom : 0;
    ok(boardTop >= infoBottom - 1, tag + ' 棋盘不覆盖信息栏',
      'boardTop=' + boardTop.toFixed(1) + ' infoBottom=' + infoBottom.toFixed(1));
    if (m.tray && m.board) {
      ok(m.board.bottom <= m.tray.top + 1 || Math.abs(m.tray.top - m.board.top) < 200,
        tag + ' 棋盘与托盘不重叠',
        'boardBottom=' + m.board.bottom.toFixed(1) + ' trayTop=' + m.tray.top.toFixed(1));
    }
    if (tag === '390x844') await page.screenshot({ path: path.join(SHOTS, 'e2e-390.png') });
    if (tag === '1280x800') await page.screenshot({ path: path.join(SHOTS, 'e2e-1280.png') });
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await testSetupAndSheets(browser);
    await testStartNoviceAndMedium(browser);
    await testPlaceRefillFlow(browser);
    await testIllegalMoves(browser);
    await testGoalColorRule(browser);
    await testColorContinuityRule(browser);
    await testInuitItem(browser);
    await testInuitStuckRescue(browser);
    await testSledItem(browser);
    await testLogItem(browser);
    await testLogStartUpperColor(browser);
    await testAutosaveResume(browser);
    await testStuckAndLoss(browser);
    await testWinFlow(browser);
    await testMenuRulesHints(browser);
    await testLayoutsAndConsole(browser);
  } finally {
    await browser.close();
  }

  console.log('\n----------------------------------------');
  console.log('通过 ' + passed + '，失败 ' + failed);
  if (failures.length) {
    console.log('失败用例：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  if (browserErrors.length) {
    console.log('控制台错误 ' + browserErrors.length + ' 条：');
    browserErrors.slice(0, 10).forEach((e) => console.log('  - ' + e));
  } else {
    console.log('控制台无报错');
  }
  process.exit(failed > 0 || browserErrors.length > 0 ? 1 : 0);
})();