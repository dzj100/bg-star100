/**
 * take-time 核心逻辑测试（node + vm，mock DOM）
 * 覆盖：发牌数量、出牌/眼标记、结算判定（通过/失败）、进度更新、render 不崩溃
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── mock DOM ──
function makeEl(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, remove() {}, querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    removeChild() {},
    children: [],
  };
}
const elements = {
  app: makeEl('app'),
  playSheet: makeEl('playSheet'),
  playSheetContent: makeEl('playSheetContent'),
  modalOverlay: makeEl('modalOverlay'),
  modalContent: makeEl('modalContent'),
  online: makeEl('online'),
  initLoadingOverlay: makeEl('init-loading-overlay'),
};
const listeners = {};
global.document = {
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  getElementById: (id) => elements[id] || null,
  createElement: () => makeEl('dyn'),
  body: makeEl('body'),
  head: { appendChild() {} },
};
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
global.window = global;
global.alert = () => {};
global.prompt = () => '';
global.requestAnimationFrame = (fn) => fn();
global.setInterval = () => 0;
global.clearInterval = () => {};
global.Date = Date;

const ctx = {
  console,
  document: global.document,
  localStorage: global.localStorage,
  alert: global.alert,
  prompt: global.prompt,
  setInterval: global.setInterval,
  clearInterval: global.clearInterval,
  Date,
  Math,
  JSON,
  Set,
};
vm.createContext(ctx);
// 沙箱内 window 指向沙箱自身
ctx.window = ctx;
ctx.globalThis = ctx;
// 联机 mock：座位0、房主、可操作
ctx._olSeatIndex = () => 0;
ctx._olIsHost = () => true;
ctx._olIsActor = () => true;
for (const f of ['game.js', 'render.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}
const g = ctx;

let passCount = 0, failCount = 0;
function assert(cond, name, detail) {
  if (cond) { passCount++; console.log('  ✓', name); }
  else { failCount++; console.log('  ✗', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}

// ── 1. 发牌 ──
console.log('\n[发牌]');
for (const n of [2, 3, 4]) {
  g.pendingChallenge = { chapter: 1, test: 1, rule: '' };
  g.dealGame(['A', 'B', 'C', 'D'].slice(0, n), { chapter: 1, test: 1, id: 1, rule: '' });
  const per = n === 2 ? 6 : n === 3 ? 4 : 3;
  const allCards = g.S.players.flatMap(p => p.hand);
  assert(allCards.length === 12, `${n}人局共12张`, allCards.length);
  assert(g.S.players.every(p => p.hand.length === per), `${n}人局每人${per}张`);
  assert(new Set(allCards.map(c => c.v)).size === 12, `${n}人局数字1-12无重复`);
  assert(allCards.every(c => c.color === 'sun' || c.color === 'moon'), '牌色合法');
  assert(g.S.segments.length === 6 && g.S.segments.every(s => s.cards.length === 0), '6个空区域');
  assert(g.S.eyeBase === n && g.S.eyeBonus === 0, `基础眼标记=${n}`);
  assert(g.S.phase === 'discuss', '初始阶段 discuss');
}

// ── 2. 看牌 / 聚光灯 ──
console.log('\n[看牌/聚光灯]');
g.S = JSON.parse(JSON.stringify(g.S));
g.hostReveal();
assert(g.S.phase === 'reveal', '看牌 → reveal');
g.hostStartSpin();
assert(g.S.phase === 'spin' && g.S.spin.running, '启动聚光灯');
g.hostStopSpin();
assert(g.S.phase === 'play' && typeof g.S.firstSeat === 'number', '停止聚光灯 → play + firstSeat');
assert(g.S.currentSeat === g.S.firstSeat, '先手为 currentSeat');

// ── 3. 出牌 + 眼标记 ──
console.log('\n[出牌]');
g.S.currentSeat = 0; // 座位0是我的回合
const handBefore = g.S.players[0].hand.length;
const eye0 = g.eyeLeft();
const seg0Before = g.S.segments[2].cards.length;
g.S.players[0].hand[0].v = 5; g.S.players[0].hand[0].color = 'sun';
g.selectCard(0);
assert(g._pendingPlay && g._pendingPlay.cardIndex === 0, '选中手牌');
g.pickSeg(2);
g._pendingPlay.useEye = true;
g.placeCard();
assert(g.S.segments[2].cards.length === seg0Before + 1, '牌已放置到区域3');
const placed = g.S.segments[2].cards[g.S.segments[2].cards.length - 1];
assert(placed.revealed === true, '眼标记出牌为明置');
assert(g.eyeLeft() === eye0 - 1, '眼标记消耗1', { eye0, left: g.eyeLeft() });
assert(g.S.players[0].hand.length === handBefore - 1, '手牌减少1张');

// 眼标记用完时不可勾选，牌只能暗置
g.S.currentSeat = 0; // placeCard 后回合推进，重置回我的回合
g._pendingPlay = { cardIndex: 0, seg: 1, useEye: false };
g.S.eyeUsed = g.S.eyeBase + g.S.eyeBonus; // 用完
g.toggleEye();
assert(g._pendingPlay.useEye === false, '眼标记用完时不可勾选明置');
g.placeCard();
const placed2 = g.S.segments[1].cards[g.S.segments[1].cards.length - 1];
assert(placed2.revealed === false, '眼标记不足时牌暗置打出');
assert(g.eyeLeft() === 0, '眼标记未额外消耗');
g.S.eyeUsed = 0;

// ── 4. 完整流程：全部出完 → 结算 ──
console.log('\n[结算]');
g.dealGame(g.S.players.map(p => p.name), { chapter: 1, test: 1, id: 1, rule: '' });
g.hostReveal(); g.hostStartSpin(); g.hostStopSpin(); // 推进到 play 阶段
// 先手0，所有玩家依次出牌：全部暗置，按放置计数循环分配到区域
let seat = 0, segIdx = 0;
const nPlayers = g.S.players.length;
while (g.S.players.some(p => p.hand.length > 0)) {
  g.S.currentSeat = seat;
  g._olSeatIndex = () => seat; // 模拟轮到谁就由谁操作
  g._pendingPlay = { cardIndex: 0, seg: segIdx % 6, useEye: false };
  g.placeCard();
  seat = (seat + 1) % nPlayers;
  segIdx++;
}
g._olSeatIndex = () => 0;
assert(g.S.allPlaced === true, '全部打出后 allPlaced=true');
g.settle();
assert(g.S.settled === true && g.S.phase === 'result', '结算完成');
assert(g.S.sums && g.S.sums.length === 6, 'sums 计算');
assert(g.S.check.segOK.every(Boolean), '每区域≥1张检查');
assert(g.S.check.ascOK === g.S.sums.every((s, i) => i === 0 || s >= g.S.sums[i - 1]), '递增检查与手算一致');
const progFail = g.loadProgress()[1];
	assert(progFail && (progFail.passed === g.S.pass) && typeof progFail.bonus === 'number', '进度已写入');

// 失败场景：清空区域3 → 破坏「每区域≥1张」，确定性失败
const bonusBefore = g.S.eyeBonus;
g.S.settled = false; g.S.phase = 'play'; g.S.allPlaced = true;
g.S.segments[2].cards = [];
g.settle();
assert(g.S.pass === false, '构造失败场景 pass=false');
assert(g.S.check.segOK[2] === false, '失败原因：区域3无牌');
	assert(g.S.eyeBonus === Math.min(bonusBefore + 1, 3) && g.S.eyeBonus >= 1, '失败后赠送1眼标记', { before: bonusBefore, after: g.S.eyeBonus });
	const progFail2 = g.loadProgress()[1];
	assert(progFail2.bonus >= 1 && progFail2.bonus <= 3, '失败后赠送眼标记上限3', progFail2.bonus);
	assert(progFail2.passed === false, '进度记录未通过');

// ── 5. render 不崩溃（各阶段） ──
console.log('\n[render]');
for (const phase of ['discuss', 'reveal', 'spin', 'play', 'result']) {
  g.S.phase = phase;
  try {
    g.render();
    assert(true, `render phase=${phase} 无异常`);
  } catch (e) {
    assert(false, `render phase=${phase} 异常: ${e.message}`);
  }
}

// ── 6. 2人局手牌锁定 ──
console.log('\n[2人局手牌锁定]');
g._olSeatIndex = () => 0;
g.dealGame(['A', 'B'], { chapter: 1, test: 1, id: 1 });
g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
assert(g.S.players.length === 2, '2人局');
let locked = g.handLockedIndexes();
assert(locked.size === 2 && locked.has(4) && locked.has(5), '看牌后仅展示前4张，后2张锁定');
g.S.currentSeat = 0;
g.selectCard(4);
assert(!g._pendingPlay, '锁定牌不可选择');
g.selectCard(0);
assert(g._pendingPlay && g._pendingPlay.cardIndex === 0, '前4张可选择');
g.closePlaySheet();
assert(!g._pendingPlay, '取消选择');

// 双方各打出2张（共4张）后解锁后2张
for (let k = 0; k < 4; k++) {
  g.S.currentSeat = k % 2;
  g._olSeatIndex = () => (k % 2);
  g._pendingPlay = { cardIndex: 0, seg: 0, useEye: false };
  g.placeCard();
}
g._olSeatIndex = () => 0;
locked = g.handLockedIndexes();
assert(locked.size === 0, '双方各出2张后后2张解锁');
assert(g.placedCount() === 4, 'placedCount=4');

// 3人局无锁定
g.dealGame(['A', 'B', 'C'], { chapter: 1, test: 1, id: 1 });
g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
assert(g.handLockedIndexes().size === 0, '3人局无锁定');

// ── 7. 关卡库 ──
console.log('\n[关卡库]');
assert(g.challengeDesc({ id: 99 }) === '每区域至少1张；每区域总和≤24；区域1→6总和递增', '未收录关卡用默认规则文案');
const dflt = g.challengeCheck({ id: 99 }, [1, 2, 3, 4, 5, 6], [{ cards: [1] }]);
assert(dflt.pass === true, '默认规则判定通过');
const dfltFail = g.challengeCheck({ id: 99 }, [25, 2, 3, 4, 5, 6], [{ cards: [1] }]);
assert(dfltFail.pass === false && dfltFail.sumOK[0] === false, '默认规则 区域>24 判失败');

g.CHALLENGE_LIB[42] = {
  chapter: 1, test: 2, name: '测试关',
  desc: '区域1总和必须为偶数',
  check: (sums) => {
    const segOK = [true, true, true, true, true, true];
    const sumOK = sums.map(s => s <= 24);
    const ascOK = true;
    const extra = sums[0] % 2 === 0;
    return { segOK, sumOK, ascOK, pass: segOK.every(Boolean) && sumOK.every(Boolean) && ascOK && extra };
  },
};
assert(g.challengeDesc({ id: 42 }) === '区域1总和必须为偶数', '关卡库规则文案');
const libPass = g.challengeCheck({ id: 42 }, [4, 0, 0, 0, 0, 0], [{ cards: [1] }]);
assert(libPass.pass === true, '关卡库规则：偶数通过');
const libFail = g.challengeCheck({ id: 42 }, [3, 0, 0, 0, 0, 0], [{ cards: [1] }]);
assert(libFail.pass === false, '关卡库规则：奇数失败');
g.dealGame(['A', 'B'], { chapter: 1, test: 2, id: 42 });
assert(g.S.challenge.desc === '区域1总和必须为偶数', 'dealGame 携带关卡规则文案');
delete g.CHALLENGE_LIB[42]; // 清理临时关卡，不碰内置关卡

// ── 8. 第1章4关内置规则 ──
console.log('\n[第1章4关规则]');
const mkSeg = cards => ({ cards });
const cd = (v, color, order) => ({ v, color, order });

// 第一关「孤阳」：1号位恰1张太阳牌；6号位恰3张；≥1张；递增；无≤24
const c1Segs = [
  mkSeg([cd(3, 'sun')]),                        // s1: 1张 sun
  mkSeg([cd(5, 'moon')]),
  mkSeg([cd(6, 'sun')]),
  mkSeg([cd(8, 'moon')]),
  mkSeg([cd(10, 'sun')]),
  mkSeg([cd(11, 'moon'), cd(12, 'sun'), cd(4, 'moon')]), // s6: 3张
];
const c1Sums = c1Segs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c1 = g.challengeCheck({ id: 1 }, c1Sums, c1Segs);
assert(c1.pass === true, '第1关：满足规则通过', c1);
assert(c1.sumOK.every(Boolean), '第1关：无≤24限制');
assert(c1.items.length === 4, '第1关：自定义检查项4条');
const c1Fail = g.challengeCheck({ id: 1 }, [8, 5, 6, 8, 10, 27],
  [mkSeg([cd(3, 'sun'), cd(5, 'moon')]), mkSeg([cd(5, 'moon')]), mkSeg([cd(6, 'sun')]), mkSeg([cd(8, 'moon')]), mkSeg([cd(10, 'sun')]), mkSeg([cd(11, 'moon'), cd(12, 'sun'), cd(4, 'moon')])]);
assert(c1Fail.pass === false && c1Fail.segBad[0] === true, '第1关：1号位非单张太阳牌失败');

// 第二关「枢衡」：3号位总和8~12；4号位恰3张；≥1张；递增；无≤24
const c2Segs = [
  mkSeg([cd(1, 'sun')]),
  mkSeg([cd(2, 'moon')]),
  mkSeg([cd(5, 'sun'), cd(6, 'moon')]),         // s3: 11
  mkSeg([cd(4, 'sun'), cd(8, 'moon'), cd(9, 'sun')]), // s4: 3张
  mkSeg([cd(10, 'sun'), cd(12, 'moon')]),
  mkSeg([cd(11, 'sun'), cd(12, 'moon')]),
];
const c2Sums = c2Segs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c2 = g.challengeCheck({ id: 2 }, c2Sums, c2Segs);
assert(c2.pass === true, '第2关：满足规则通过', c2);
assert(c2.sumOK.every(Boolean), '第2关：无≤24限制');
const c2Fail = g.challengeCheck({ id: 2 }, [1, 2, 20, 21, 22, 23],
  [mkSeg([cd(1, 'sun')]), mkSeg([cd(2, 'moon')]), mkSeg([cd(8, 'sun'), cd(12, 'moon')]), mkSeg([cd(4, 'sun'), cd(8, 'moon'), cd(9, 'sun')]), mkSeg([cd(10, 'sun'), cd(12, 'moon')]), mkSeg([cd(11, 'sun'), cd(12, 'moon')])]);
assert(c2Fail.pass === false && c2Fail.segBad[2] === true, '第2关：3号位总和越界失败');

// 第三关「序引」：第1张牌在3号位；第2张牌在2号位；6号位总和20~30；≥1张；递增；无≤24
const c3Segs = [
  mkSeg([cd(1, 'sun', 5)]),
  mkSeg([cd(2, 'sun', 2)]),                      // 第2张 → s2 ✓
  mkSeg([cd(5, 'moon', 1)]),                     // 第1张 → s3 ✓
  mkSeg([cd(6, 'moon', 4)]),
  mkSeg([cd(8, 'sun', 6)]),
  mkSeg([cd(12, 'sun', 3), cd(11, 'moon', 7)]),  // s6: 23
];
const c3Sums = c3Segs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c3 = g.challengeCheck({ id: 3 }, c3Sums, c3Segs);
assert(c3.pass === true, '第3关：满足规则通过', c3);
const c3Fail = g.challengeCheck({ id: 3 }, [1, 7, 6, 6, 8, 23],
  [mkSeg([cd(1, 'sun', 5)]), mkSeg([cd(2, 'sun', 1), cd(5, 'moon', 2)]), mkSeg([cd(6, 'moon', 4)]), mkSeg([cd(6, 'moon', 6)]), mkSeg([cd(8, 'sun', 7)]), mkSeg([cd(12, 'sun', 3), cd(11, 'moon', 8)])]);
assert(c3Fail.pass === false && c3Fail.segBad[2] === true, '第3关：第1张不在3号位失败');

// 第四关「近六」：1号位总和最接近6；4号位1太阳+1月亮；≥1张；≤24；递增
const c4Segs = [
  mkSeg([cd(5, 'sun')]),                         // s1: 5, |5-6|=1 最小
  mkSeg([cd(8, 'moon')]),                        // |8-6|=2
  mkSeg([cd(9, 'sun')]),                         // 3
  mkSeg([cd(1, 'sun'), cd(8, 'moon')]),          // s4: 1sun+1moon ✓, |9-6|=3
  mkSeg([cd(10, 'moon')]),                       // 4
  mkSeg([cd(12, 'sun')]),                        // 6
];
const c4Sums = c4Segs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c4 = g.challengeCheck({ id: 4 }, c4Sums, c4Segs);
assert(c4.pass === true, '第4关：满足规则通过', c4);
assert(c4.sumOK.every(Boolean), '第4关：保留≤24限制');
const c4Fail = g.challengeCheck({ id: 4 }, [5, 8, 9, 9, 10, 12],
  [mkSeg([cd(5, 'sun')]), mkSeg([cd(8, 'moon')]), mkSeg([cd(9, 'sun')]), mkSeg([cd(1, 'sun'), cd(8, 'sun')]), mkSeg([cd(10, 'moon')]), mkSeg([cd(12, 'sun')])]);
assert(c4Fail.pass === false && c4Fail.segBad[3] === true, '第4关：4号位非1太阳+1月亮失败');

// 放置顺序：placeCard 记录 order
g.dealGame(['A', 'B'], { chapter: 1, test: 3, id: 3 });
g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
g.S.currentSeat = 0;
g._pendingPlay = { cardIndex: 0, seg: 2, useEye: false }; // 第1张 → 3号位
g.placeCard();
g.S.currentSeat = 0;
g._pendingPlay = { cardIndex: 0, seg: 1, useEye: false }; // 第2张 → 2号位
g.placeCard();
assert(g.S.segments[2].cards[0].order === 1, '第1张牌 order=1');
assert(g.S.segments[1].cards[0].order === 2, '第2张牌 order=2');

// ── 9. 房主接管离席玩家（轮到离席玩家时房主代操作） ──
console.log('\n[房主接管离席玩家]');
g._olSeatIndex = () => 0;
g.dealGame(['房主', '小明'], { chapter: 1, test: 1, id: 1 });
g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
g.S.phase = 'play';
g.S.currentSeat = 1;          // 轮到离席玩家
g.S.departedPlayers = [1];    // 房主已点击「接管操作」
g.S.players[0].hand = [];     // 房主自己的牌已出完
const depHand = g.S.players[1].hand.length;
assert(depHand > 0, `离席玩家有手牌 ${depHand} 张`);
assert(g.isMyTurn() === true, '轮到离席玩家时房主 isMyTurn=true');
assert(g.actionSeat() === 1, 'actionSeat 返回离席座位');
g.selectCard(0);
assert(g._pendingPlay && g._pendingPlay.cardIndex === 0, '可选中离席玩家手牌');
g._pendingPlay.seg = 2;
g.placeCard();
assert(g.S.players[1].hand.length === depHand - 1, '离席玩家手牌减少1');
assert(g.S.segments[2].cards.length === 1, '代打牌放入区域3');
assert(g.S.segments[2].cards[0].by === 1, '牌归属记录为离席座位');
assert(g.S.currentSeat === 0, '代打出牌后轮转回房主');
assert(g.S.log[g.S.log.length - 1].msg.includes('小明'), '日志记录离席玩家名字');

// 轮到房主自己时仍正常操作自己的手牌
g.S.players[0].hand = [{ v: 9, color: 'sun' }];
assert(g.isMyTurn() === true && g.actionSeat() === 0, '轮到自己 actionSeat=自己');
g.selectCard(0);
g._pendingPlay.seg = 0;
g.placeCard();
assert(g.S.players[0].hand.length === 0, '房主自己的牌正常打出');
assert(g.S.segments[0].cards[0].by === 0, '房主的牌归属自己');

// 非房主成员端（座位2 观察者）在轮到离席玩家时不可操作
g._olSeatIndex = () => 2;
g._olIsHost = () => false;
g.S.currentSeat = 1;
g.S.departedPlayers = [1];
assert(g.isMyTurn() === false, '成员端轮到离席玩家时不可代操作');
assert(g.actionSeat() === 2, '成员端 actionSeat 仍为自己');
g._olSeatIndex = () => 0;
g._olIsHost = () => true;

// 非房主不能结算（「翻开所有牌」仅房主可点）
g._olSeatIndex = () => 2;
g._olIsHost = () => false;
g.S.allPlaced = true;
g.S.settled = false;
g.settle();
assert(g.S.settled === false && g.S.phase !== 'result', '非房主 settle 被拒');
g._olSeatIndex = () => 0;
g._olIsHost = () => true;
g.S.allPlaced = false;

// ── 10. 退出房间重置本关进度 ──
console.log('\n[退出重置进度]');
g.updateLocalProgress(1, false, 999);
	assert((g.loadProgress()[1] || {}).bonus >= 1, '失败结算写入进度');
g.S.challenge = { id: 1 };
g._olResetProgress();
assert(!g.loadProgress()[1], '退出房间后本关进度（赠送标记）已清除');
g.updateLocalProgress(1, true, 1000);
assert(g.loadProgress()[1].passed === true, '通关进度写入');
g._olResetProgress();
assert(!g.loadProgress()[1], '退出房间后通关进度也已清除');
g.updateLocalProgress(1, false, 1001);
g._olResetProgress();
g.dealGame(['A', 'B'], { chapter: 1, test: 1, id: 1 });
assert(g.S.eyeBonus === 0, '重置后重建房间重开同关 eyeBonus=0');

console.log(`\n结果: ${passCount} 通过 / ${failCount} 失败`);
process.exit(failCount ? 1 : 0);
