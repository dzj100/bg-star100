/**
 * take-time 核心逻辑测试（node + vm，mock DOM）
 * 覆盖：发牌数量、出牌/眼标记、结算判定（通过/失败）、进度更新、render 不崩溃
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── mock DOM ──
function makeEl(id) {
  const el = {
    id,
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, remove() {}, querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    removeChild() {},
    children: [],
  };
  let _text = '', _html = '';
  // 模拟浏览器语义：textContent 赋值同步转义到 innerHTML（online.js 的 _esc 依赖该行为）
  Object.defineProperty(el, 'textContent', {
    get: () => _text,
    set: (v) => {
      _text = String(v);
      _html = _text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => _html,
    set: (v) => { _html = String(v); },
  });
  return el;
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
global.setTimeout = () => 0;
global.clearTimeout = () => {};
global.Date = Date;

const ctx = {
  console,
  document: global.document,
  localStorage: global.localStorage,
  alert: global.alert,
  prompt: global.prompt,
  setInterval: global.setInterval,
  clearInterval: global.clearInterval,
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
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
  const counts = {};
  allCards.forEach(c => counts[c.v] = (counts[c.v] || 0) + 1);
  assert(Object.values(counts).every(cnt => cnt <= 2), `${n}人局每数字最多2张（太阳/月亮各一）`);
  assert(allCards.every(c => c.v >= 1 && c.v <= 12), `${n}人局数字在1-12`);
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

// ── 8b. 第三章第一关「定首」：房主在看牌前指定 1 号位条件 ──
console.log('\n[第三章·定首]');
g._olSeatIndex = () => 0;
g._olIsHost = () => true;
g.dealGame(['A', 'B'], { chapter: 3, test: 1, id: 9 });
assert(g.S.phase === 'discuss', '第9关初始 discuss');
assert(g.S.segCond === null, '第9关 segCond 未定');

// 未选条件时不能看牌
g.hostReveal();
assert(g.S.phase === 'discuss', '未选1号位条件时不能看牌');
try { g.render(); assert(true, 'render discuss+未选条件 无异常'); }
catch (e) { assert(false, `render 异常: ${e.message}`); }

// 非房主不能选择
g._olIsHost = () => false;
g.chooseFirstCond(2);
assert(g.S.segCond === null, '非房主不能选择');
g._olIsHost = () => true;

// 房主选择原第3个条件（这里需要有最大的一张数字牌）作为 1 号位
g.chooseFirstCond(2);
assert(g.S.phase === 'discuss', '选择后仍在 discuss 阶段');
const conds9 = g.S.segCond;
assert(conds9.length === 6, 'segCond 6项');
assert(conds9[0].key === 'max', '选中条件到1号位', conds9[0]);
assert(conds9[1].key === 'free' && conds9[2].key === 'close20' && conds9[3].key === 'free' && conds9[4].key === 'free' && conds9[5].key === 'free', '其余按下方（循环）顺序顺延', conds9.map(c => c.key));

// 看牌前可重新预览覆盖：选 idx=0（无限制）→ 1号位变为 free
g.chooseFirstCond(0);
assert(g.S.segCond[0].key === 'free' && g.S.segCond[2].key === 'max' && g.S.segCond[4].key === 'close20', '看牌前可重新预览覆盖', g.S.segCond.map(c => c.key));

// 选定后：看牌 → 聚光灯 → 直接 play（无 cond 阶段）
try { g.render(); assert(true, 'render discuss+已选条件 无异常'); }
catch (e) { assert(false, `render 异常: ${e.message}`); }
g.hostReveal();
assert(g.S.phase === 'reveal', '已选条件后可看牌');
// 看牌后条件锁定，不可再变更
g.chooseFirstCond(1);
assert(g.S.segCond[0].key === 'free' && g.S.segCond[2].key === 'max', '看牌后条件锁定，不可再变更', g.S.segCond.map(c => c.key));
g.hostStartSpin();
g.hostStopSpin();
assert(g.S.phase === 'play', '聚光灯停止 → 直接 play');

// 结算判定（手动构造 segCond：1号位含最大牌+6号位最接近20）
g.S.segCond = [
  { key: 'max', label: '这里需要有最大的一张数字牌', short: '含最大牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'close20', label: '总和最接近20', short: '最接近20' },
];
const c9Pass = g.challengeCheck({ id: 9 }, [12, 12, 12, 13, 14, 15], [
  mkSeg([cd(12, 'sun')]), mkSeg([cd(5, 'sun'), cd(7, 'moon')]), mkSeg([cd(1, 'sun'), cd(11, 'moon')]),
  mkSeg([cd(3, 'sun'), cd(10, 'moon')]), mkSeg([cd(6, 'sun'), cd(8, 'moon')]), mkSeg([cd(2, 'sun'), cd(4, 'moon'), cd(9, 'sun')]),
]);
assert(c9Pass.pass === true, '第9关：1号位含最大牌+6号位最接近20 → 通过', c9Pass);
assert(c9Pass.items.some(it => it.label.includes('最大数字牌')), '结算项含最大牌条件');
assert(c9Pass.items.some(it => it.label.includes('最接近20')), '结算项含最接近20条件');

// close20 在 5 号位同样可达：先手选 conds[0]（无限制）放 1 号位 → max 到 3 号位、close20 到 5 号位
g.S.segCond = [
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'max', label: '这里需要有最大的一张数字牌', short: '含最大牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'close20', label: '总和最接近20', short: '最接近20' },
  { key: 'free', label: '无限制', short: '无限制' },
];
const c9Close5 = g.challengeCheck({ id: 9 }, [3, 8, 12, 14, 19, 22], [
  mkSeg([cd(3, 'sun')]), mkSeg([cd(8, 'moon')]), mkSeg([cd(12, 'sun')]),
  mkSeg([cd(10, 'moon'), cd(4, 'sun')]), mkSeg([cd(11, 'sun'), cd(6, 'moon'), cd(2, 'sun')]),
  mkSeg([cd(9, 'moon'), cd(7, 'sun'), cd(5, 'moon'), cd(1, 'sun')]),
]);
assert(c9Close5.pass === true, '第9关：3号位含最大牌+5号位最接近20（19 vs 22） → 通过', c9Close5);
g.S.segCond = [
  { key: 'max', label: '这里需要有最大的一张数字牌', short: '含最大牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'close20', label: '总和最接近20', short: '最接近20' },
];


const c9MaxFail = g.challengeCheck({ id: 9 }, [10, 12, 14, 18, 19, 22], [
  mkSeg([cd(10, 'sun')]), mkSeg([cd(12, 'sun')]), mkSeg([cd(14, 'moon')]),
  mkSeg([cd(18, 'moon')]), mkSeg([cd(19, 'sun')]), mkSeg([cd(22, 'moon')]),
]);
assert(c9MaxFail.pass === false && c9MaxFail.segBad[0] === true, '第9关：最大牌不在1号位失败');

const c9TieFail = g.challengeCheck({ id: 9 }, [12, 14, 16, 18, 19, 19], [
  mkSeg([cd(12, 'sun')]), mkSeg([cd(14, 'moon')]), mkSeg([cd(16, 'sun')]),
  mkSeg([cd(18, 'moon')]), mkSeg([cd(19, 'sun')]), mkSeg([cd(19, 'moon')]),
]);
assert(c9TieFail.pass === false && c9TieFail.segBad[5] === true, '第9关：最接近20出现平局失败');

const c9Over = g.challengeCheck({ id: 9 }, [12, 25, 16, 18, 19, 22], [
  mkSeg([cd(12, 'sun')]), mkSeg([cd(12, 'moon'), cd(13, 'sun')]), mkSeg([cd(16, 'sun')]),
  mkSeg([cd(18, 'moon')]), mkSeg([cd(19, 'sun')]), mkSeg([cd(22, 'moon')]),
]);
assert(c9Over.pass === false && c9Over.sumOK[1] === false, '第9关：硬规则≤24仍生效');

// ── 8c. 第三章第二关「双锚」：含最小牌 + 最后一张牌 ──
console.log('\n[第三章·双锚]');
g.dealGame(['A', 'B'], { chapter: 3, test: 2, id: 10 });
assert(g.S.phase === 'discuss', '第10关初始 discuss');
assert(g.S.segCond === null, '第10关 segCond 未定');

// 循环顺延：选 idx=2（无限制）→ [free, min, free, free, min, last]
g.chooseFirstCond(2);
const conds10 = g.S.segCond;
assert(conds10.length === 6, '第10关 segCond 6项');
assert(conds10[0].key === 'free' && conds10[1].key === 'min' && conds10[2].key === 'free' && conds10[3].key === 'free' && conds10[4].key === 'min' && conds10[5].key === 'last', '第10关循环顺延含双 min/last', conds10.map(c => c.key));

// 结算判定：选 idx=0 → [min, last, free, min, free, free]
g.S.segCond = [
  { key: 'min', label: '含1张数字最小/次小的牌', short: '含最小牌' },
  { key: 'last', label: '最后一张牌放这里', short: '最后一张牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'min', label: '含1张数字最小/次小的牌', short: '含最小牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
];
const c10 = g.challengeCheck({ id: 10 }, [8, 10, 12, 14, 16, 18], [
  mkSeg([cd(1, 'sun', 1), cd(7, 'moon', 2)]),                 // 8，含1 → min@1 ✓
  mkSeg([cd(4, 'sun', 12), cd(6, 'moon', 5)]),                // 10，order=12 在这 → last@2 ✓
  mkSeg([cd(12, 'sun', 3)]),                                  // 12
  mkSeg([cd(11, 'moon', 4), cd(3, 'sun', 6)]),                // 14，不含1 → min@4 ✗
  mkSeg([cd(9, 'sun', 7), cd(5, 'moon', 8), cd(2, 'sun', 9)]),// 16
  mkSeg([cd(8, 'moon', 10), cd(10, 'sun', 11)]),              // 18
]);
assert(c10.items[3].label.includes('最小') && c10.items[3].ok === true, '第10关：1号位含最小牌通过');
assert(c10.items[4].label.includes('最后一张牌') && c10.items[4].ok === true, '第10关：2号位最后一张牌通过');
assert(c10.items[5].label.includes('次小') && c10.items[5].ok === false, '第10关：4号位未含最小/次小牌失败');
assert(c10.pass === false, '第10关：4号位缺最小/次小牌 → 失败');

// 有解：最小牌（1）放1号位、次小牌（2）放4号位，顺序不限 → 通关
const c10Solve = g.challengeCheck({ id: 10 }, [1, 4, 5, 13, 15, 18], [
  mkSeg([cd(1, 'sun', 1)]),                                    // 1，含1 → 锚点@1 ✓
  mkSeg([cd(4, 'sun', 12)]),                                   // 4，order=12 → last@2 ✓
  mkSeg([cd(5, 'moon', 2)]),                                   // 5
  mkSeg([cd(2, 'moon', 3), cd(11, 'sun', 4)]),                 // 13，含2 → 锚点@4 ✓
  mkSeg([cd(7, 'moon', 5), cd(8, 'sun', 6)]),                  // 15
  mkSeg([cd(3, 'sun', 7), cd(6, 'moon', 8), cd(9, 'sun', 9)]), // 18
]);
assert(c10Solve.pass === true, '第10关：最小+次小牌各占一个锚点区域 → 通过', c10Solve);

// 例1：最小数字1有两张（月亮1+太阳1），"最小的两张牌"=两张1，次小的2不是候选
// 通过：两张1分别位于两个锚点区域
const c10Ex1Pass = g.challengeCheck({ id: 10 }, [1, 6, 9, 9, 21, 21], [
  mkSeg([cd(1, 'sun', 1)]),                                    // 1，含太阳1 → 锚点@1 ✓
  mkSeg([cd(2, 'sun', 12), cd(4, 'sun', 2)]),                  // 6，order=12 → last@2 ✓
  mkSeg([cd(6, 'sun', 3), cd(3, 'moon', 4)]),                  // 9
  mkSeg([cd(1, 'moon', 5), cd(8, 'sun', 6)]),                  // 9，含月亮1 → 锚点@4 ✓
  mkSeg([cd(9, 'moon', 7), cd(5, 'moon', 8), cd(7, 'moon', 9)]), // 21
  mkSeg([cd(10, 'sun', 10), cd(11, 'moon', 11)]),              // 21
]);
assert(c10Ex1Pass.pass === true, '第10关：最小数字两张1各占一个锚点区（太阳2非候选）→ 通过', c10Ex1Pass);

// 例1失败：锚点区4 放 5+10（无候选），另一张1在非锚点区 → 失败
const c10Ex1Fail = g.challengeCheck({ id: 10 }, [1, 6, 9, 15, 17, 19], [
  mkSeg([cd(1, 'sun', 1)]),                                    // 1，锚点@1 有候选
  mkSeg([cd(2, 'sun', 12), cd(4, 'sun', 2)]),                  // 6，order=12 → last@2 ✓
  mkSeg([cd(6, 'sun', 3), cd(3, 'moon', 4)]),                  // 9
  mkSeg([cd(5, 'moon', 5), cd(10, 'sun', 6)]),                 // 15，无候选 → 锚点@4 ✗
  mkSeg([cd(8, 'sun', 7), cd(9, 'moon', 8)]),                  // 17
  mkSeg([cd(7, 'moon', 9), cd(11, 'moon', 10), cd(1, 'moon', 11)]), // 19，另一张1在非锚点区
]);
assert(c10Ex1Fail.pass === false, '第10关：次小牌太阳2不能顶替候选（最小数字有两张时）→ 失败', c10Ex1Fail);

// 例2：最小数字1只有1张（月亮1），次小2有两张（太阳2+月亮2）→ 候选3张，任取2张但须含最小
// 通过：月亮1 + 太阳2 分别位于两个锚点区域
const c10Ex2Pass = g.challengeCheck({ id: 10 }, [1, 7, 11, 11, 15, 23], [
  mkSeg([cd(1, 'moon', 1)]),                                   // 1，含月亮1 → 锚点@1 ✓
  mkSeg([cd(4, 'sun', 12), cd(3, 'moon', 2)]),                 // 7，order=12 → last@2 ✓
  mkSeg([cd(5, 'moon', 3), cd(6, 'sun', 4)]),                  // 11
  mkSeg([cd(2, 'sun', 5), cd(9, 'moon', 6)]),                  // 11，含太阳2 → 锚点@4 ✓
  mkSeg([cd(7, 'moon', 7), cd(8, 'sun', 8)]),                  // 15
  mkSeg([cd(10, 'sun', 9), cd(11, 'moon', 10), cd(2, 'moon', 11)]), // 23，月亮2在非锚点区也可
]);
assert(c10Ex2Pass.pass === true, '第10关：最小1张+次小2张，月亮1+太阳2分放锚点区 → 通过', c10Ex2Pass);

// 例2失败：两个锚点区只放了两张2（缺最小牌月亮1）→ 失败
const c10Ex2Fail = g.challengeCheck({ id: 10 }, [2, 7, 11, 11, 15, 22], [
  mkSeg([cd(2, 'sun', 1)]),                                    // 2，锚点@1 有候选但非最小
  mkSeg([cd(4, 'sun', 12), cd(3, 'moon', 2)]),                 // 7，order=12 → last@2 ✓
  mkSeg([cd(5, 'moon', 3), cd(6, 'sun', 4)]),                  // 11
  mkSeg([cd(2, 'moon', 5), cd(9, 'moon', 6)]),                 // 11，锚点@4 有候选但非最小
  mkSeg([cd(7, 'moon', 7), cd(8, 'sun', 8)]),                  // 15
  mkSeg([cd(10, 'sun', 9), cd(11, 'moon', 10), cd(1, 'moon', 11)]), // 22，月亮1在非锚点区
]);
assert(c10Ex2Fail.pass === false, '第10关：锚点区缺最小牌（两张2不能算最小的两张牌）→ 失败', c10Ex2Fail);

// last 失败：最后一张牌（order=12）不在条件区域
const c10LastFail = g.challengeCheck({ id: 10 }, [8, 10, 12, 14, 16, 18], [
  mkSeg([cd(1, 'sun', 1), cd(7, 'moon', 2)]),
  mkSeg([cd(4, 'sun', 5), cd(6, 'moon', 6)]),
  mkSeg([cd(12, 'sun', 12)]),                                 // 最后一张在 free 的3号位
  mkSeg([cd(11, 'moon', 3), cd(3, 'sun', 4)]),
  mkSeg([cd(9, 'sun', 7), cd(5, 'moon', 8), cd(2, 'sun', 9)]),
  mkSeg([cd(8, 'moon', 10), cd(10, 'sun', 11)]),
]);
assert(c10LastFail.items[4].ok === false && c10LastFail.pass === false, '第10关：最后一张牌不在2号位失败');

// ── 8d. 第三章第三关「前二」：含最小牌 + 第1/2张牌同区 + 含最大牌 ──
console.log('\n[第三章·前二]');
g.dealGame(['A', 'B'], { chapter: 3, test: 3, id: 11 });
assert(g.S.phase === 'discuss', '第11关初始 discuss');
assert(g.S.segCond === null, '第11关 segCond 未定');

// 循环顺延：选 idx=1（第1、2张牌）→ [first2, free, free, max, free, min]
g.chooseFirstCond(1);
const conds11 = g.S.segCond;
assert(conds11.length === 6, '第11关 segCond 6项');
assert(conds11[0].key === 'first2' && conds11[1].key === 'free' && conds11[2].key === 'free' && conds11[3].key === 'max' && conds11[4].key === 'free' && conds11[5].key === 'min', '第11关循环顺延含 first2/max/min', conds11.map(c => c.key));

// 结算判定：segCond [min, first2, free, free, max, free]
g.S.segCond = [
  { key: 'min', label: '含1张数字最小的牌', short: '含最小牌' },
  { key: 'first2', label: '第1张、第2张牌放这里', short: '第1、2张牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'max', label: '含1张数字最大的牌', short: '含最大牌' },
  { key: 'free', label: '无限制', short: '无限制' },
];
const c11 = g.challengeCheck({ id: 11 }, [6, 9, 10, 11, 18, 24], [
  mkSeg([cd(1, 'sun', 5), cd(5, 'moon', 6)]),                 // 6，含1 → min@1 ✓
  mkSeg([cd(2, 'sun', 1), cd(3, 'moon', 2), cd(4, 'sun', 3)]),// 9，order1+2 → first2@2 ✓
  mkSeg([cd(7, 'moon', 4)]),                                  // 10
  mkSeg([cd(8, 'sun', 7), cd(3, 'sun', 8)]),                  // 11
  mkSeg([cd(12, 'moon', 9), cd(6, 'sun', 10)]),               // 18，含12 → max@5 ✓
  mkSeg([cd(9, 'sun', 11), cd(10, 'moon', 12), cd(5, 'sun', 13)]), // 24
]);
assert(c11.items[3].label.includes('最小数字牌') && c11.items[3].ok === true, '第11关：1号位含最小牌通过');
assert(c11.items[4].label.includes('第1张') && c11.items[4].ok === true, '第11关：2号位含第1、2张牌通过');
assert(c11.items[5].label.includes('最大数字牌') && c11.items[5].ok === true, '第11关：5号位含最大牌通过');
assert(c11.pass === true, '第11关：min+first2+max 全满足 → 通过', c11);

// first2 失败：order=1 与 order=2 不在同一区域
const c11First2Fail = g.challengeCheck({ id: 11 }, [6, 9, 10, 11, 18, 24], [
  mkSeg([cd(1, 'sun', 1), cd(5, 'moon', 6)]),                 // order1 在这里
  mkSeg([cd(2, 'sun', 2), cd(3, 'moon', 3), cd(4, 'sun', 4)]),// order2 在这里（不同区）
  mkSeg([cd(7, 'moon', 5)]),
  mkSeg([cd(8, 'sun', 7), cd(3, 'sun', 8)]),
  mkSeg([cd(12, 'moon', 9), cd(6, 'sun', 10)]),               // 含12 → max@5 ✓
  mkSeg([cd(9, 'sun', 11), cd(10, 'moon', 12), cd(5, 'sun', 13)]),
]);
assert(c11First2Fail.items[4].ok === false && c11First2Fail.pass === false, '第11关：第1、2张牌不同区失败');

// max 失败：最大牌（12）不在条件区域
const c11MaxFail = g.challengeCheck({ id: 11 }, [6, 9, 10, 11, 18, 24], [
  mkSeg([cd(1, 'sun', 5), cd(5, 'moon', 6)]),                 // 含1 → min@1 ✓
  mkSeg([cd(2, 'sun', 1), cd(3, 'moon', 2), cd(4, 'sun', 3)]),// first2@2 ✓
  mkSeg([cd(7, 'moon', 4), cd(12, 'moon', 9)]),               // 12 在 free 的3号位
  mkSeg([cd(8, 'sun', 7), cd(3, 'sun', 8)]),
  mkSeg([cd(6, 'sun', 10)]),                                  // 5号位无12 → max@5 ✗
  mkSeg([cd(9, 'sun', 11), cd(10, 'moon', 12), cd(5, 'sun', 13)]),
]);
assert(c11MaxFail.items[5].ok === false && c11MaxFail.pass === false, '第11关：最大牌不在5号位失败');

// ── 8e. 第三章第四关「双曜」：最接近6 + 最小太阳/最大月亮 + 恰好2张 ──
console.log('\n[第三章·双曜]');
g.dealGame(['A', 'B'], { chapter: 3, test: 4, id: 12 });
assert(g.S.phase === 'discuss', '第12关初始 discuss');
assert(g.S.segCond === null, '第12关 segCond 未定');

// 循环顺延：选 idx=2（无限制）→ [free, maxMoon, free, exact2, close6, minSun]
g.chooseFirstCond(2);
const conds12 = g.S.segCond;
assert(conds12.length === 6, '第12关 segCond 6项');
assert(conds12[0].key === 'free' && conds12[1].key === 'maxMoon' && conds12[2].key === 'free' && conds12[3].key === 'exact2' && conds12[4].key === 'close6' && conds12[5].key === 'minSun', '第12关循环顺延含 close6/minSun/maxMoon/exact2', conds12.map(c => c.key));

// 结算判定：segCond [close6, minSun, free, maxMoon, free, exact2]
g.S.segCond = [
  { key: 'close6', label: '总和最接近6', short: '最接近6' },
  { key: 'minSun', label: '含1张数字最小的太阳牌', short: '最小太阳' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'maxMoon', label: '含1张数字最大的月亮牌', short: '最大月亮' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'exact2', label: '必须放2张牌', short: '放2张牌' },
];
const c12 = g.challengeCheck({ id: 12 }, [6, 8, 9, 12, 18, 20], [
  mkSeg([cd(2, 'sun', 1), cd(4, 'moon', 2)]),                 // 6，最接近6（距离0）
  mkSeg([cd(1, 'sun', 3), cd(7, 'moon', 4)]),                 // 8，含最小太阳1
  mkSeg([cd(3, 'sun', 5), cd(6, 'moon', 6)]),                 // 9
  mkSeg([cd(12, 'moon', 7)]),                                 // 12，含最大月亮12
  mkSeg([cd(10, 'sun', 8), cd(8, 'moon', 9)]),                // 18
  mkSeg([cd(9, 'moon', 10), cd(11, 'sun', 11)]),              // 20，恰好2张
]);
assert(c12.items[3].label.includes('最接近6') && c12.items[3].ok === true, '第12关：1号位总和最接近6通过');
assert(c12.items[4].label.includes('最小太阳牌') && c12.items[4].ok === true, '第12关：2号位含最小太阳牌通过');
assert(c12.items[5].label.includes('最大月亮牌') && c12.items[5].ok === true, '第12关：4号位含最大月亮牌通过');
assert(c12.items[6].label.includes('恰好放2张牌') && c12.items[6].ok === true, '第12关：6号位恰好2张通过');
assert(c12.pass === true, '第12关：close6+minSun+maxMoon+exact2 全满足 → 通过', c12);

// minSun 失败：最小太阳（1）不在2号位
const c12MinSunFail = g.challengeCheck({ id: 12 }, [6, 8, 9, 12, 18, 20], [
  mkSeg([cd(2, 'sun', 1), cd(4, 'moon', 2)]),
  mkSeg([cd(7, 'moon', 4), cd(3, 'sun', 5)]),                 // 2号位无太阳1
  mkSeg([cd(1, 'sun', 3), cd(6, 'moon', 6)]),                 // 最小太阳移到3号位
  mkSeg([cd(12, 'moon', 7)]),
  mkSeg([cd(10, 'sun', 8), cd(8, 'moon', 9)]),
  mkSeg([cd(9, 'moon', 10), cd(11, 'sun', 11)]),
]);
assert(c12MinSunFail.items[4].ok === false && c12MinSunFail.pass === false, '第12关：最小太阳牌不在2号位失败');

// maxMoon 失败：最大月亮（12）不在4号位
const c12MaxMoonFail = g.challengeCheck({ id: 12 }, [6, 8, 9, 12, 18, 20], [
  mkSeg([cd(2, 'sun', 1), cd(4, 'moon', 2)]),
  mkSeg([cd(1, 'sun', 3), cd(7, 'moon', 4)]),
  mkSeg([cd(3, 'sun', 5), cd(6, 'moon', 6)]),
  mkSeg([cd(11, 'sun', 11)]),                                 // 4号位无月亮
  mkSeg([cd(12, 'moon', 7), cd(8, 'moon', 9)]),               // 最大月亮移到5号位
  mkSeg([cd(9, 'moon', 10), cd(10, 'sun', 8)]),
]);
assert(c12MaxMoonFail.items[5].ok === false && c12MaxMoonFail.pass === false, '第12关：最大月亮牌不在4号位失败');

// close6 失败：2号位与1号位距离相同（均为2），非唯一最接近6
const c12Close6Fail = g.challengeCheck({ id: 12 }, [8, 8, 9, 12, 18, 20], [
  mkSeg([cd(2, 'sun', 1), cd(6, 'moon', 6)]),                 // 8，距离2
  mkSeg([cd(1, 'sun', 3), cd(7, 'moon', 4)]),                 // 8，距离2 → 并列
  mkSeg([cd(3, 'sun', 5), cd(6, 'sun', 2)]),
  mkSeg([cd(12, 'moon', 7)]),
  mkSeg([cd(10, 'sun', 8), cd(8, 'moon', 9)]),
  mkSeg([cd(9, 'moon', 10), cd(11, 'sun', 11)]),
]);
assert(c12Close6Fail.items[3].ok === false && c12Close6Fail.pass === false, '第12关：1号位非唯一最接近6失败（并列距离）');

// exact2 失败：6号位放了3张牌
const c12Exact2Fail = g.challengeCheck({ id: 12 }, [6, 8, 9, 12, 18, 24], [
  mkSeg([cd(2, 'sun', 1), cd(4, 'moon', 2)]),
  mkSeg([cd(1, 'sun', 3), cd(7, 'moon', 4)]),
  mkSeg([cd(3, 'sun', 5), cd(6, 'moon', 6)]),
  mkSeg([cd(12, 'moon', 7)]),
  mkSeg([cd(10, 'sun', 8), cd(8, 'moon', 9)]),
  mkSeg([cd(9, 'moon', 10), cd(11, 'sun', 11), cd(4, 'sun', 12)]), // 3张，24
]);
assert(c12Exact2Fail.items[6].ok === false && c12Exact2Fail.pass === false, '第12关：6号位3张牌不满足恰好2张失败');

// ── 8f. 第四章第一关「序位」：exact1 + firstCard + 从大到小出牌 ──
console.log('\n[第四章·序位]');
g._olSeatIndex = () => 0;
g._olIsHost = () => true;
g.dealGame(['A', 'B'], { chapter: 4, test: 1, id: 13 });
assert(g.S.phase === 'discuss', '第13关初始 discuss');
assert(g.S.segCond === null, '第13关 segCond 未定');

// 选 idx=2（exact1）→ [exact1, free, free, firstCard, free, free]
g.chooseFirstCond(2);
const conds13 = g.S.segCond;
assert(conds13.length === 6, '第13关 segCond 6项');
assert(conds13[0].key === 'exact1' && conds13[1].key === 'free' && conds13[2].key === 'free' && conds13[3].key === 'firstCard' && conds13[4].key === 'free' && conds13[5].key === 'free', '第13关循环顺延含 exact1/firstCard', conds13.map(c => c.key));

// 看牌→聚光灯→play，验证 chapterLockedIndexes desc
g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
assert(g.S.phase === 'play', '第13关 play 阶段');
g._olSeatIndex = () => 0;
g.S.currentSeat = 0;
// mock 手牌 [12, 12, 8, 5, 3, 1]
g.S.players[0].hand = [
  { v: 12, color: 'sun' }, { v: 12, color: 'moon' },
  { v: 8, color: 'sun' }, { v: 5, color: 'moon' },
  { v: 3, color: 'sun' }, { v: 1, color: 'moon' },
];
const ch13Locked = g.chapterLockedIndexes();
assert(ch13Locked.has(0) === false && ch13Locked.has(1) === false, '从大到小：两张12都可选');
assert(ch13Locked.has(2) === true && ch13Locked.has(3) === true, '从大到小：8和5不可选');
// 打出一张12后，另一张12仍可选
g.S.players[0].hand.splice(1, 1); // 移除一张12
const ch13Locked2 = g.chapterLockedIndexes();
assert(ch13Locked2.has(2) === true && ch13Locked2.has(3) === true, '打出一张12后，8和5仍不可选');
assert(ch13Locked2.has(0) === false, '另一张12仍可选');

// exact1 通过：1号位恰好1张
g.S.segCond = [
  { key: 'exact1', label: '仅1张牌', short: '仅1张牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'firstCard', label: '第1张牌放这里', short: '第1张牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
];
const c13Pass = g.challengeCheck({ id: 13 }, [5, 8, 11, 13, 18, 20], [
  mkSeg([cd(5, 'sun', 5)]),                                                   // exact1 ✓ 恰好1张5
  mkSeg([cd(8, 'moon', 6)]),
  mkSeg([cd(3, 'sun', 7), cd(8, 'sun', 8)]),
  mkSeg([cd(1, 'sun', 1), cd(12, 'moon', 9)]),                               // firstCard ✓ order=1
  mkSeg([cd(10, 'sun', 10), cd(8, 'moon', 11)]),
  mkSeg([cd(7, 'sun', 12), cd(6, 'moon', 13), cd(7, 'moon', 14)]),
]);
assert(c13Pass.pass === true, '第13关：exact1+firstCard → 通过', c13Pass);

// exact1 失败：1号位放了2张牌
const c13Exact1Fail = g.challengeCheck({ id: 13 }, [10, 8, 12, 6, 18, 20], [
  mkSeg([cd(5, 'sun', 5), cd(5, 'moon', 6)]),                                // exact1 ✗ 2张
  mkSeg([cd(8, 'moon', 7)]),
  mkSeg([cd(3, 'sun', 8), cd(9, 'moon', 9)]),
  mkSeg([cd(1, 'sun', 1), cd(5, 'moon', 10)]),
  mkSeg([cd(10, 'sun', 11), cd(8, 'moon', 12)]),
  mkSeg([cd(7, 'sun', 13), cd(6, 'moon', 14), cd(7, 'moon', 15)]),
]);
assert(c13Exact1Fail.pass === false, '第13关：exact1 1号位2张牌失败');

// firstCard 失败：第1张牌不在4号位
const c13FirstFail = g.challengeCheck({ id: 13 }, [5, 8, 12, 6, 18, 20], [
  mkSeg([cd(5, 'sun', 5)]),
  mkSeg([cd(8, 'moon', 6)]),
  mkSeg([cd(3, 'sun', 7), cd(9, 'moon', 8)]),
  mkSeg([cd(5, 'moon', 9)]),                                                  // firstCard ✗ 无order=1
  mkSeg([cd(10, 'sun', 10), cd(8, 'moon', 11)]),
  mkSeg([cd(1, 'sun', 1), cd(7, 'sun', 12), cd(6, 'moon', 13)]),             // order=1 在6号位
]);
assert(c13FirstFail.pass === false, '第13关：firstCard 第1张牌不在4号位失败');

// ── 8g. 第四章第二关「极序」：firstCard + max + 从小到大出牌 ──
console.log('\n[第四章·极序]');
g.dealGame(['A', 'B'], { chapter: 4, test: 2, id: 14 });
assert(g.S.phase === 'discuss', '第14关初始 discuss');
assert(g.S.segCond === null, '第14关 segCond 未定');

// 选 idx=1（firstCard）→ [firstCard, max, free, free, free, free]
g.chooseFirstCond(1);
const conds14 = g.S.segCond;
assert(conds14.length === 6, '第14关 segCond 6项');
assert(conds14[0].key === 'firstCard' && conds14[1].key === 'max' && conds14[2].key === 'free' && conds14[3].key === 'free' && conds14[4].key === 'free' && conds14[5].key === 'free', '第14关循环顺延含 firstCard/max', conds14.map(c => c.key));

g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
g.S.currentSeat = 0;
g.S.players[0].hand = [
  { v: 1, color: 'sun' }, { v: 3, color: 'moon' },
  { v: 5, color: 'sun' }, { v: 5, color: 'moon' },
  { v: 9, color: 'sun' }, { v: 12, color: 'moon' },
];
const ch14Locked = g.chapterLockedIndexes();
assert(ch14Locked.has(0) === false, '从小到大：1可选');
assert(ch14Locked.has(1) === true && ch14Locked.has(4) === true, '从小到大：3和9不可选（当前最小=1）');
assert(ch14Locked.has(5) === true, '从小到大：12不可选（当前最小=1）');
// 打出1后，只剩 [3, 5, 5, 9, 12]，当前最小=3
g.S.players[0].hand.splice(0, 1);
const ch14Locked2 = g.chapterLockedIndexes();
assert(ch14Locked2.has(0) === false, '打出1后：3可选（index=0）');
assert(ch14Locked2.has(1) === true && ch14Locked2.has(2) === true, '打出1后：5不可选（当前最小=3）');

// 结算：firstCard + max 通过
g.S.segCond = [
  { key: 'firstCard', label: '第1张牌放这里', short: '第1张牌' },
  { key: 'max', label: '含1张数字最大的牌', short: '含最大牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
];
const c14Pass = g.challengeCheck({ id: 14 }, [6, 12, 14, 16, 18, 20], [
  mkSeg([cd(1, 'sun', 1), cd(5, 'moon', 7)]),                                // firstCard ✓
  mkSeg([cd(12, 'moon', 8)]),                                                 // max ✓
  mkSeg([cd(4, 'sun', 9), cd(10, 'moon', 10)]),
  mkSeg([cd(7, 'sun', 11), cd(9, 'moon', 12)]),
  mkSeg([cd(8, 'sun', 13), cd(10, 'moon', 14)]),
  mkSeg([cd(9, 'sun', 15), cd(11, 'moon', 16)]),
]);
assert(c14Pass.pass === true, '第14关：firstCard+max → 通过', c14Pass);

// max 失败：最大牌12不在2号位
const c14MaxFail = g.challengeCheck({ id: 14 }, [6, 8, 12, 14, 16, 18], [
  mkSeg([cd(1, 'sun', 1), cd(5, 'moon', 7)]),
  mkSeg([cd(8, 'moon', 8)]),                                                  // max ✗ 无12
  mkSeg([cd(12, 'sun', 9), cd(4, 'moon', 10)]),                              // 12在3号位
  mkSeg([cd(7, 'sun', 11), cd(7, 'moon', 12)]),
  mkSeg([cd(8, 'sun', 13), cd(8, 'moon', 14)]),
  mkSeg([cd(9, 'sun', 15), cd(9, 'moon', 16)]),
]);
assert(c14MaxFail.pass === false, '第14关：最大牌不在2号位失败');

// ── 8h. 第四章第三关「禁数」：no123 + 按顺序出牌 ──
console.log('\n[第四章·禁数]');
g.dealGame(['A', 'B'], { chapter: 4, test: 3, id: 15 });
assert(g.S.phase === 'discuss', '第15关初始 discuss');

// 选 idx=1（no123）→ [no123, free, no123, free, no123, free]
g.chooseFirstCond(1);
const conds15 = g.S.segCond;
assert(conds15.length === 6, '第15关 segCond 6项');
assert(conds15[0].key === 'no123' && conds15[1].key === 'free' && conds15[2].key === 'no123' && conds15[3].key === 'free' && conds15[4].key === 'no123' && conds15[5].key === 'free', '第15关循环顺延含 no123', conds15.map(c => c.key));

g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
g.S.currentSeat = 0;
g.S.players[0].hand = [
  { v: 5, color: 'sun' }, { v: 8, color: 'moon' },
  { v: 3, color: 'sun' }, { v: 12, color: 'moon' },
];
const ch15Locked = g.chapterLockedIndexes();
assert(ch15Locked.has(0) === false, 'playLock：index=0可选');
assert(ch15Locked.has(1) === true && ch15Locked.has(2) === true && ch15Locked.has(3) === true, 'playLock：index>0不可选');

// no123 通过
g.S.segCond = [
  { key: 'no123', label: '不含1、2、3数字牌', short: '不含1-3' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'no123', label: '不含1、2、3数字牌', short: '不含1-3' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'no123', label: '不含1、2、3数字牌', short: '不含1-3' },
  { key: 'free', label: '无限制', short: '无限制' },
];
const c15Pass = g.challengeCheck({ id: 15 }, [8, 10, 12, 14, 16, 18], [
  mkSeg([cd(8, 'sun', 1)]),                                                   // no123 ✓
  mkSeg([cd(10, 'moon', 2)]),
  mkSeg([cd(4, 'sun', 3), cd(8, 'moon', 4)]),                                // no123 ✓
  mkSeg([cd(14, 'sun', 5)]),
  mkSeg([cd(6, 'moon', 6), cd(10, 'sun', 7)]),                               // no123 ✓
  mkSeg([cd(9, 'moon', 8), cd(9, 'sun', 9)]),
]);
assert(c15Pass.pass === true, '第15关：no123 全满足 → 通过', c15Pass);

// no123 失败：某区域含1、2、3数字牌
const c15No123Fail = g.challengeCheck({ id: 15 }, [8, 5, 13, 8, 12, 9], [
  mkSeg([cd(8, 'sun', 1)]),                                                   // no123 ✓
  mkSeg([cd(5, 'moon', 2)]),
  mkSeg([cd(4, 'sun', 3), cd(3, 'moon', 4)]),                                // no123 ✗ 含3
  mkSeg([cd(8, 'moon', 5)]),
  mkSeg([cd(12, 'sun', 6)]),                                                  // no123 ✓
  mkSeg([cd(9, 'moon', 7)]),
]);
assert(c15No123Fail.pass === false, '第15关：含3数字牌在no123区域失败');

// ── 8i. 第四章第四关「均衡」：close12 + min + max + 按顺序出牌 ──
console.log('\n[第四章·均衡]');
g.dealGame(['A', 'B'], { chapter: 4, test: 4, id: 16 });
assert(g.S.phase === 'discuss', '第16关初始 discuss');

// 选 idx=3（close12）→ [close12, min, max, free, free, free]
g.chooseFirstCond(3);
const conds16 = g.S.segCond;
assert(conds16.length === 6, '第16关 segCond 6项');
assert(conds16[0].key === 'close12' && conds16[1].key === 'min' && conds16[2].key === 'max' && conds16[3].key === 'free' && conds16[4].key === 'free' && conds16[5].key === 'free', '第16关循环顺延含 close12/min/max', conds16.map(c => c.key));

g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
g.S.currentSeat = 0;
g.S.players[0].hand = [
  { v: 5, color: 'sun' }, { v: 8, color: 'moon' },
  { v: 3, color: 'sun' }, { v: 12, color: 'moon' },
];
const ch16Locked = g.chapterLockedIndexes();
assert(ch16Locked.has(0) === false, 'playLock：index=0可选');
assert(ch16Locked.has(1) === true && ch16Locked.has(3) === true, 'playLock：index>0不可选');

// close12 + min + max 通过
g.S.segCond = [
  { key: 'close12', label: '总和最接近12', short: '最接近12' },
  { key: 'min', label: '含1张数字最小的牌', short: '含最小牌' },
  { key: 'max', label: '含1张数字最大的牌', short: '含最大牌' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
  { key: 'free', label: '无限制', short: '无限制' },
];
const c16Pass = g.challengeCheck({ id: 16 }, [12, 13, 21, 21, 22, 24], [
  mkSeg([cd(5, 'sun', 1), cd(7, 'moon', 2)]),                                 // 12 最接近12（距离0）✓
  mkSeg([cd(1, 'moon', 3), cd(2, 'sun', 4), cd(10, 'moon', 5)]),              // 13，min ✓ 含最小1
  mkSeg([cd(12, 'sun', 6), cd(9, 'moon', 7)]),                                // 21，max ✓ 含最大12
  mkSeg([cd(10, 'sun', 8), cd(11, 'moon', 9)]),
  mkSeg([cd(11, 'sun', 10), cd(11, 'moon', 11)]),
  mkSeg([cd(12, 'moon', 12), cd(12, 'sun', 13)]),
]);
assert(c16Pass.pass === true, '第16关：close12+min+max → 通过', c16Pass);

// close12 失败：4号位更接近12
const c16CloseFail = g.challengeCheck({ id: 16 }, [18, 8, 12, 11, 15, 20], [
  mkSeg([cd(9, 'sun', 1), cd(9, 'moon', 2)]),                                 // 18 距离6
  mkSeg([cd(1, 'moon', 3), cd(7, 'sun', 4)]),                                 // min ✓
  mkSeg([cd(12, 'sun', 5)]),                                                   // max ✓
  mkSeg([cd(6, 'moon', 6), cd(5, 'sun', 7)]),                                 // 11 距离1 → 更接近12
  mkSeg([cd(7, 'sun', 8), cd(8, 'moon', 9)]),
  mkSeg([cd(9, 'moon', 10), cd(11, 'sun', 11)]),
]);
assert(c16CloseFail.pass === false, '第16关：close12 1号位非最接近12失败');

// min 失败：最小牌1不在2号位
const c16MinFail = g.challengeCheck({ id: 16 }, [12, 10, 12, 10, 15, 18], [
  mkSeg([cd(5, 'sun', 1), cd(7, 'moon', 2)]),
  mkSeg([cd(7, 'sun', 4)]),                                                    // min ✗ 无1
  mkSeg([cd(12, 'sun', 5), cd(1, 'moon', 3)]),                                // 最小1在3号位
  mkSeg([cd(10, 'sun', 6)]),
  mkSeg([cd(7, 'sun', 7), cd(8, 'moon', 8)]),
  mkSeg([cd(9, 'moon', 9), cd(9, 'sun', 10)]),
]);
assert(c16MinFail.pass === false, '第16关：最小牌不在2号位失败');

// max 失败：最大牌12不在3号位
const c16MaxFail = g.challengeCheck({ id: 16 }, [12, 8, 10, 12, 15, 18], [
  mkSeg([cd(5, 'sun', 1), cd(7, 'moon', 2)]),
  mkSeg([cd(1, 'moon', 3), cd(7, 'sun', 4)]),
  mkSeg([cd(10, 'sun', 5)]),                                                   // max ✗ 无12
  mkSeg([cd(12, 'moon', 6)]),                                                  // 最大12在4号位
  mkSeg([cd(7, 'sun', 7), cd(8, 'moon', 8)]),
  mkSeg([cd(9, 'moon', 9), cd(9, 'sun', 10)]),
]);
assert(c16MaxFail.pass === false, '第16关：最大牌不在3号位失败');

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
assert(g.loadProgress()[1].passed === true, '通关记录在退出房间后保留（长期进度）');
g.updateLocalProgress(1, false, 1001);
assert((g.loadProgress()[1] || {}).bonus >= 1, '失败结算写入进度（覆盖记录）');
g._olResetProgress();
assert(!g.loadProgress()[1], '退出房间后未通关进度（赠送标记）已清除');
g.dealGame(['A', 'B'], { chapter: 1, test: 1, id: 1 });
assert(g.S.eyeBonus === 0, '重置后重建房间重开同关 eyeBonus=0');

// ── 11. 结算日志展示挑战用时（从发牌起算） ──
console.log('\n[挑战计时]');
g.dealGame(['A', 'B'], { chapter: 1, test: 1, id: 1 });
assert(typeof g.S.startAt === 'number', '发牌时记录 startAt');
g.S.startAt = Date.now() - 125000; // 模拟已进行 2 分 5 秒
g.S.allPlaced = true;
g.S.settled = false;
g.settle();
let lastMsg = g.S.log[g.S.log.length - 1].msg;
assert(/挑战用时 2分5秒/.test(lastMsg), '结算日志展示 2分5秒（实测: ' + lastMsg + '）');
g.S.startAt = Date.now() - 45000; // 不足 1 分钟
g.S.allPlaced = true;
g.S.settled = false;
g.settle();
lastMsg = g.S.log[g.S.log.length - 1].msg;
assert(/挑战用时 45秒/.test(lastMsg), '不足 1 分钟显示秒数（实测: ' + lastMsg + '）');

// ── 12. 第七章「入侵/引泉/同辉/三汲」：转盘选条件 + 摸1张机制 ──
console.log('\n[第七章·摸1张]');

// 关卡库：条件集 / rotate / 文案
const ch7Keys = id => g.CHALLENGE_LIB[id].conds.map(c => c.key).join(',');
assert(ch7Keys(25) === 'draw1,free,no789,no789,free,free', '第25关条件集', ch7Keys(25));
assert(ch7Keys(26) === 'draw1,free,free,draw1,last,free', '第26关条件集', ch7Keys(26));
assert(ch7Keys(27) === 'free,free,free,maxMoonMinSun,draw1,sunMoon2', '第27关条件集', ch7Keys(27));
assert(ch7Keys(28) === 'free,draw1,free,draw1,free,draw1', '第28关条件集', ch7Keys(28));
assert([25, 26, 27, 28].every(id => g.CHALLENGE_LIB[id].rotate === true), '第7章4关均为转盘关（房主选1号位条件）');
assert(g.CHALLENGE_LIB[25].conds[0].label === '摸1张' && g.CHALLENGE_LIB[25].conds[0].short === '摸1张', '摸1张条件文案');

// 发牌：备用牌堆12张，与手牌合计24张不重复
g._olSeatIndex = () => 0;
g.dealGame(['A', 'B'], { chapter: 7, test: 1, id: 25 });
assert(g.S.phase === 'discuss' && g.S.segCond === null, '第25关初始 discuss、segCond 未定');
assert(Array.isArray(g.S.reserve) && g.S.reserve.length === 12, '备用牌堆12张', g.S.reserve && g.S.reserve.length);
const all24 = [...g.S.reserve, ...g.S.players.flatMap(p => p.hand)];
assert(all24.length === 24, '备用牌堆+手牌共24张');
assert(new Set(all24.map(c => c.color + c.v)).size === 24, '24张牌无重复');

// 转盘预览：摸1张到1号位；重新预览 → 摸1张循环顺延到2号位（no789 随之到 4/5 号位）
g.chooseFirstCond(0);
assert(g.S.segCond.map(c => c.key).join(',') === 'draw1,free,no789,no789,free,free', '预览：摸1张在1号位', g.S.segCond.map(c => c.key));
g.chooseFirstCond(5);
assert(g.S.segCond[1].key === 'draw1' && g.S.segCond[3].key === 'no789' && g.S.segCond[5].key === 'free', '循环顺延：摸1张到2号位、no789到4/5号位', g.S.segCond.map(c => c.key));
g.chooseFirstCond(0);

// 2人局锁定期第一次行动放牌即触发摸1张；摸到的牌插在锁定牌之前、立即可见
g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
g.S.phase = 'play';
g.S.currentSeat = 0;
assert(g.S.players[0].hand.length === 6 && g.handLockedIndexes().size === 2, '2人局：6张手牌、后2张锁定');
const reserveTopBefore = g.S.reserve[g.S.reserve.length - 1];
g._pendingPlay = { cardIndex: 0, seg: 0, useEye: false }; // 1号位（摸1张）
g.placeCard();
assert(g.S.reserve.length === 11, '摸1张后备用牌堆剩11张', g.S.reserve.length);
assert(g.S.players[0].hand.length === 6, '放牌-1、摸牌+1 → 手牌仍6张', g.S.players[0].hand.length);
assert(g.S.players[0].hand[3] === reserveTopBefore, '摸到的牌插在锁定牌之前（索引3）');
assert(!g.handLockedIndexes().has(3), '摸到的牌不受2人局锁定影响，立即可见');
const drawLog = g.S.log[g.S.log.length - 1].msg;
assert(drawLog.includes('摸取1张牌'), '日志记录摸牌', drawLog);
assert(!/[☀☾]/.test(drawLog), '日志不暴露颜色/数字', drawLog);

// 摸到的牌放到无限制区域：不摸牌
g.S.currentSeat = 0;
g._pendingPlay = { cardIndex: 3, seg: 4, useEye: false };
g.placeCard();
assert(g.S.reserve.length === 11, '无限制区域放牌不摸牌', g.S.reserve.length);
assert(g.S.players[0].hand.length === 5, '无限制区域放牌后手牌5张', g.S.players[0].hand.length);

// 连锁：再次放入摸1张区域，继续摸牌；回合照常轮转
g.S.currentSeat = 0;
g._pendingPlay = { cardIndex: 0, seg: 0, useEye: false };
g.placeCard();
assert(g.S.reserve.length === 10, '再次放入摸1张区域连锁摸牌', g.S.reserve.length);
assert(g.S.players[0].hand.length === 5, '连锁摸牌后手牌数不变（-1+1）', g.S.players[0].hand.length);
assert(g.S.currentSeat === 1, '放牌后轮转到下家');

// 备用牌堆耗尽：不再摸牌
g.S.reserve = [];
g.S.currentSeat = 0;
g._pendingPlay = { cardIndex: 0, seg: 0, useEye: false };
g.placeCard();
assert(g.S.players[0].hand.length === 4, '备用牌堆为空时不摸牌', g.S.players[0].hand.length);

// 结算判定：入侵（no789）
g.S.challenge = { chapter: 7, test: 1, id: 25 };
g.S.segCond = g.CHALLENGE_LIB[25].conds.slice();
const c25PassSegs = [
  mkSeg([cd(2, 'sun')]),                         // 2
  mkSeg([cd(3, 'moon')]),                        // 3
  mkSeg([cd(5, 'sun'), cd(6, 'moon')]),          // 11，无7/8/9 ✓
  mkSeg([cd(1, 'sun'), cd(10, 'moon')]),         // 11，无7/8/9 ✓
  mkSeg([cd(11, 'moon')]),                       // 11
  mkSeg([cd(9, 'sun'), cd(12, 'moon')]),         // 21
];
const c25PassSums = c25PassSegs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c25Pass = g.challengeCheck({ id: 25 }, c25PassSums, c25PassSegs);
assert(c25Pass.pass === true, '第25关：3、4号位无7/8/9 → 通过', c25Pass);
assert(c25Pass.items.some(it => it.label.includes('不含7、8、9数字牌') && it.ok === true), '结算项含不含7、8、9');
const c25FailSegs = [
  mkSeg([cd(2, 'sun')]),
  mkSeg([cd(3, 'moon')]),
  mkSeg([cd(5, 'sun'), cd(7, 'moon')]),          // 12，含7 → 失败
  mkSeg([cd(1, 'sun'), cd(11, 'moon')]),         // 12
  mkSeg([cd(12, 'sun')]),                        // 12
  mkSeg([cd(9, 'sun'), cd(10, 'moon')]),         // 19
];
const c25FailSums = c25FailSegs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c25Fail = g.challengeCheck({ id: 25 }, c25FailSums, c25FailSegs);
assert(c25Fail.pass === false && c25Fail.segBad[2] === true, '第25关：3号位含7 → 失败');
assert(c25Fail.items.some(it => it.label.includes('（含7）') && it.ok === false), '结算项标注违规数字');

// 结算判定：引泉（last 最后一张牌）
g.S.segCond = g.CHALLENGE_LIB[26].conds.slice();
const c26PassSegs = [
  mkSeg([cd(2, 'sun', 1)]),
  mkSeg([cd(3, 'moon', 2)]),
  mkSeg([cd(5, 'sun', 3)]),
  mkSeg([cd(6, 'moon', 4)]),
  mkSeg([cd(11, 'sun', 12)]),                    // 最后一张（第12张）→ 5号位 ✓
  mkSeg([cd(9, 'moon', 5), cd(12, 'sun', 6)]),   // 21
];
const c26PassSums = c26PassSegs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c26Pass = g.challengeCheck({ id: 26 }, c26PassSums, c26PassSegs);
assert(c26Pass.pass === true, '第26关：最后一张在5号位 → 通过', c26Pass);
assert(c26Pass.items.some(it => it.label.includes('最后一张牌（第12张）') && it.ok === true), '结算项含最后一张牌');
const c26FailSegs = [
  mkSeg([cd(2, 'sun', 1)]),
  mkSeg([cd(3, 'moon', 2)]),
  mkSeg([cd(5, 'sun', 3)]),
  mkSeg([cd(6, 'moon', 4)]),
  mkSeg([cd(11, 'sun', 5)]),
  mkSeg([cd(9, 'moon', 6), cd(12, 'sun', 12)]),  // 最后一张在6号位 → 5号位失败
];
const c26FailSums = c26FailSegs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c26Fail = g.challengeCheck({ id: 26 }, c26FailSums, c26FailSegs);
assert(c26Fail.pass === false && c26Fail.segBad[4] === true, '第26关：最后一张不在5号位 → 失败');

// 结算判定：同辉（最大月亮+最小太阳同区；6号位恰好2太阳+2月亮）
g.S.segCond = g.CHALLENGE_LIB[27].conds.slice();
const c27PassSegs = [
  mkSeg([cd(2, 'moon')]),                        // 2
  mkSeg([cd(3, 'sun')]),                         // 3
  mkSeg([cd(4, 'moon')]),                        // 4
  mkSeg([cd(1, 'sun'), cd(12, 'moon')]),         // 13：最小太阳1 + 最大月亮12 ✓
  mkSeg([cd(5, 'sun'), cd(9, 'moon')]),          // 14
  mkSeg([cd(2, 'sun'), cd(6, 'sun'), cd(1, 'moon'), cd(5, 'moon')]), // 14：2太阳2月亮 ✓
];
const c27PassSums = c27PassSegs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c27Pass = g.challengeCheck({ id: 27 }, c27PassSums, c27PassSegs);
assert(c27Pass.pass === true, '第27关：最大月亮+最小太阳同区、6号位2+2 → 通过', c27Pass);
assert(c27Pass.items.some(it => it.label.includes('最大月亮牌（12）与最小太阳牌（1）') && it.ok === true), '结算项含双锚文案');
assert(c27Pass.items.some(it => it.label.includes('太阳月亮各2张（日2/月2）') && it.ok === true), '结算项含各2张计数');
const c27Fail1Segs = [
  mkSeg([cd(2, 'moon')]),
  mkSeg([cd(3, 'sun')]),
  mkSeg([cd(4, 'moon')]),
  mkSeg([cd(1, 'sun'), cd(11, 'moon')]),         // 12：最大月亮12跑到6号位 → 锚点区失败
  mkSeg([cd(5, 'sun'), cd(9, 'moon')]),          // 14
  mkSeg([cd(2, 'sun'), cd(6, 'sun'), cd(1, 'moon'), cd(12, 'moon')]), // 21
];
const c27Fail1Sums = c27Fail1Segs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c27Fail1 = g.challengeCheck({ id: 27 }, c27Fail1Sums, c27Fail1Segs);
assert(c27Fail1.pass === false && c27Fail1.segBad[3] === true, '第27关：最大月亮不在锚点区 → 失败');
const c27Fail2Segs = [
  mkSeg([cd(2, 'moon')]),
  mkSeg([cd(3, 'sun')]),
  mkSeg([cd(4, 'moon')]),
  mkSeg([cd(1, 'sun'), cd(12, 'moon')]),         // 13
  mkSeg([cd(5, 'sun'), cd(9, 'moon')]),          // 14
  mkSeg([cd(2, 'sun'), cd(6, 'sun'), cd(7, 'moon')]), // 15：3张 → 各2张失败
];
const c27Fail2Sums = c27Fail2Segs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c27Fail2 = g.challengeCheck({ id: 27 }, c27Fail2Sums, c27Fail2Segs);
assert(c27Fail2.pass === false && c27Fail2.segBad[5] === true, '第27关：6号位非恰好2+2 → 失败');

// 结算判定：三汲（仅基础三项，draw1 无约束项）
g.S.segCond = g.CHALLENGE_LIB[28].conds.slice();
const c28Segs = [
  mkSeg([cd(1, 'sun')]), mkSeg([cd(2, 'moon')]), mkSeg([cd(3, 'sun')]),
  mkSeg([cd(4, 'moon')]), mkSeg([cd(5, 'sun')]), mkSeg([cd(6, 'moon')]),
];
const c28Sums = c28Segs.map(s => s.cards.reduce((a, c) => a + c.v, 0));
const c28 = g.challengeCheck({ id: 28 }, c28Sums, c28Segs);
assert(c28.pass === true, '第28关：仅基础三项 → 通过', c28);
assert(c28.items.length === 3, '第28关：结算项仅基础三条（draw1 无约束项）', c28.items.length);

// 第28关玩法：选 conds[0]（无限制）→ 摸1张在 2/4/6 号位
g.dealGame(['A', 'B'], { chapter: 7, test: 4, id: 28 });
g.chooseFirstCond(0);
assert(g.S.segCond.map(c => c.key).join(',') === 'free,draw1,free,draw1,free,draw1', '第28关预览分配（三个摸1张）', g.S.segCond.map(c => c.key));
g.hostReveal(); g.hostStartSpin(); g.hostStopSpin();
g.S.phase = 'play';
g.S.currentSeat = 0;
g._pendingPlay = { cardIndex: 0, seg: 1, useEye: false }; // 2号位（摸1张）
g.placeCard();
assert(g.S.reserve.length === 11, '第28关：2号位放牌触发摸牌');
g.S.currentSeat = 0;
g._pendingPlay = { cardIndex: 0, seg: 0, useEye: false }; // 1号位（无限制）
g.placeCard();
assert(g.S.reserve.length === 11, '第28关：1号位放牌不摸牌');
assert(g.S.currentSeat === 1, '第28关：回合照常轮转');

// ── 13. 联机健壮性（过期快照过滤 / 重同步 / 未确认推送补发 / 断线恢复） ──
(async () => {
  console.log('\n[联机健壮性]');

  // 沙箱加载 online.js（stub net 层与 window 事件）
  const flush = () => new Promise(r => setImmediate(r));
  ctx.NET_CONFIG = { MAX_PLAYERS: 4 };
  let onChange = null, onStatus = null, subscribeCalls = 0;
  ctx.netSubscribeRoom = (id, cb, st) => {
    subscribeCalls++;
    onChange = cb; onStatus = st;
    const u = () => {};
    u.getStatus = () => 'joined';
    return u;
  };
  ctx.netLeaveRoom = async () => {};
  ctx._pushCount = 0;
  ctx._pushResults = [];
  ctx.netUpdateGameState = async () => {
    ctx._pushCount++;
    return ctx._pushResults.length ? ctx._pushResults.shift() : true;
  };
  ctx._roomRow = null;
  ctx.netGetRoom = async () => ctx._roomRow;
  ctx._winListeners = {};
  ctx.addEventListener = (ev, fn) => { (ctx._winListeners[ev] = ctx._winListeners[ev] || []).push(fn); };
  // 定时轮询桩：捕获 setInterval 回调与清理调用
  let pollTickFn = null, pollDelay = 0, pollIntervalsStarted = 0;
  const pollIntervalsCleared = [];
  ctx.setInterval = (fn, ms) => { pollIntervalsStarted++; pollTickFn = fn; pollDelay = ms; return 4242; };
  ctx.clearInterval = (id) => { pollIntervalsCleared.push(id); };
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'online.js'), 'utf8'), ctx, { filename: 'online.js' });

  const applied = [];
  ctx.initOnline({
    dealGame: () => {}, render: () => {},
    renderLanding: () => '', clearState: () => {},
    getOnlineState: () => { if (g.S && typeof g.S.currentSeat === 'number') g.S.currentPlayer = g.S.currentSeat; return g.S; },
    applyOnlineState: (s) => { applied.push(s); g.S = s; },
    getPlayers: () => (g.S && g.S.players) || [],
    getCurrentPlayer: () => (g.S ? g.S.currentSeat : undefined),
    getPlayerColors: () => ['#111', '#222'],
    showLanding: () => {}, waitingExtras: () => '',
  });

  // 建立联机会话上下文：座位1、非房主、对局中
  vm.runInContext('_onlineRoomId = "TAKETIME-0001"; _mySeatIndex = 1; _myPlayerName = "B"; _isHost = false; _gameStarted = true; _knownSeatCount = 2; _channelStatus = "SUBSCRIBED";', ctx);
  vm.runInContext('_subscribeToRoom(_onlineRoomId);', ctx); // 触发订阅（捕获 onChange/onStatus）

  const mkState = (cur, ts, pushId, turnNo) => ({ currentSeat: cur, currentPlayer: cur, turnNo, _ts: ts, _pushId: pushId });
  const t0 = Date.now();

  // A. 过期快照（乱序投递）被拒绝，新快照正常应用
  g.S = { currentSeat: 0, currentPlayer: 0, turnNo: 1 };
  g._handleRemoteState({ state: mkState(0, t0, 'h-2', 2) });
  assert(applied.length === 1 && g.S.turnNo === 2, '新状态正常应用');
  g._handleRemoteState({ state: mkState(3, t0 - 5000, 'h-1', 1) });
  assert(applied.length === 1, '过期快照被拒绝（防状态倒退）');

  // B. 同一状态重复投递去重
  g._handleRemoteState({ state: mkState(0, t0, 'h-2', 2) });
  assert(applied.length === 1, '同一条状态重复投递去重');

  // C. force 重同步：权威来源跳过新鲜度过滤
  g._handleRemoteState({ state: mkState(4, t0 - 5000, 'h-0', 0) }, true);
  assert(applied.length === 2 && g.S.currentSeat === 4, '重同步 force 应用权威状态');

  // D. 未确认推送补发：房间落后 → 补发成功、标记已确认、不应用旧快照
  ctx._pushResults = [false]; // 第1次推送失败（模拟 iOS 丢包）
  ctx._pushCount = 0;
  vm.runInContext('_pendingPushSeat = 1; _lastPushVerified = false; _lastResyncAt = 0;', ctx);
  g.S = { currentSeat: 1, currentPlayer: 1, turnNo: 7 };
  g.onlinePushState();
  await flush();
  assert(ctx._pushCount === 1 && vm.runInContext('_lastPushVerified', ctx) === false, '推送失败未确认');
  ctx._roomRow = { status: 'playing', seats: [], state: mkState(0, t0 - 1000, 'x-1', 6) }; // 房间落后（6 < 7）
  vm.runInContext('_lastResyncAt = 0;', ctx);
  await g._resyncRoom();
  assert(ctx._pushCount === 2, '房间落后 → 补发未确认推送');
  assert(vm.runInContext('_lastPushVerified', ctx) === true, '补发成功标记已确认');
  assert(g.S.turnNo === 7, '补发后不应用旧快照（本地保持最新）');

  // E. 房间已被更新状态取代 → 不补发，应用房间最新状态
  ctx._pushResults = [false];
  ctx._pushCount = 0;
  vm.runInContext('_lastResyncAt = 0;', ctx);
  g.S = { currentSeat: 1, currentPlayer: 1, turnNo: 7 };
  g.onlinePushState();
  await flush();
  assert(ctx._pushCount === 1, 'E: 推送发出但未确认');
  ctx._roomRow = { status: 'playing', seats: [], state: mkState(0, t0, 'x-9', 8) }; // 房间前进（8 > 7）
  vm.runInContext('_lastResyncAt = 0;', ctx);
  const appliedBeforeE = applied.length;
  await g._resyncRoom();
  assert(ctx._pushCount === 1, '房间已前进 → 不补发');
  assert(vm.runInContext('_lastPushVerified', ctx) === true, '被更新的状态取代视为已解决');
  assert(applied.length === appliedBeforeE + 1 && g.S.turnNo === 8, '重同步应用房间最新状态');

  // F. 订阅成功（首次/重连）自动补拉最新状态
  vm.runInContext('_lastResyncAt = 0;', ctx);
  ctx._roomRow = { status: 'playing', seats: [], state: mkState(2, t0 + 10000, 'x-10', 9) };
  onStatus('SUBSCRIBED');
  await flush();
  assert(g.S.turnNo === 9, '订阅成功触发重同步拉取最新状态');

  // G. 频道错误 → 延迟重订阅
  const savedTimeout = ctx.setTimeout;
  ctx.setTimeout = (fn) => { ctx._resubFn = fn; return 1; };
  const subsBeforeG = subscribeCalls;
  onStatus('CHANNEL_ERROR');
  assert(typeof ctx._resubFn === 'function', '频道错误被捕获并安排重订阅');
  ctx._resubFn();
  assert(subscribeCalls === subsBeforeG + 1, '重订阅重建频道');
  ctx.setTimeout = savedTimeout;

  // H. 回前台（visibilitychange）→ 重建频道 + 重同步
  document.visibilityState = 'visible';
  const visHandler = (listeners['visibilitychange'] || [])[0];
  assert(typeof visHandler === 'function', '注册了 visibilitychange 恢复处理');
  assert(typeof (ctx._winListeners['online'] || [])[0] === 'function' && typeof (ctx._winListeners['pageshow'] || [])[0] === 'function', '注册了 online/pageshow 恢复处理');
  vm.runInContext('_lastRecoverAt = 0; _lastResyncAt = 0;', ctx);
  ctx._roomRow = { status: 'playing', seats: [], state: mkState(0, t0 + 20000, 'x-11', 10) };
  const subsBeforeH = subscribeCalls;
  visHandler();
  assert(subscribeCalls === subsBeforeH + 1, '回前台重建频道');
  await flush();
  assert(g.S.turnNo === 10, '回前台重同步应用最新状态');

  // I. 3s 时钟余量内的"略旧"状态正常应用（跨设备时钟偏差容忍）
  const appliedBeforeI = applied.length;
  const lastTs = vm.runInContext('_lastAppliedTs', ctx);
  g._handleRemoteState({ state: mkState(3, lastTs - 1000, 'x-12', 11) });
  assert(applied.length === appliedBeforeI + 1 && g.S.turnNo === 11, '时钟偏差余量内的状态正常应用');

  // J. 定时轮询兜底：僵尸连接（收不到任何事件）也能拉到新状态 / 自动补发 / 跳过重复 / 退出停止
  assert(typeof pollTickFn === 'function' && pollIntervalsStarted === 1, '订阅后启动定时轮询（幂等：重订阅/恢复不重复启动）');
  assert(pollDelay === vm.runInContext('ONLINE_CONFIG.POLL_GAME_MS', ctx), '对局中轮询间隔取对局节奏（POLL_GAME_MS）');

  // J0. 轮询不依赖 visibility（对齐神探缉凶/fugitive 的无条件轮询）：
  // 即便 visibilityState 滞留 'hidden'，轮询照常拉取并应用——真后台时系统本就会挂起定时器，
  // 而一旦按 hidden 跳过，visibility 滞留会让唯一兜底通道永久停摆
  document.visibilityState = 'hidden';
  vm.runInContext('_lastResyncAt = 0;', ctx);
  ctx._roomRow = { status: 'playing', seats: [], state: mkState(2, t0 + 40000, 'x-30', 30) };
  const appliedBeforeJ0 = applied.length;
  pollTickFn();
  await flush();
  await flush();
  assert(applied.length === appliedBeforeJ0 + 1 && g.S.turnNo === 30, 'hidden 状态不阻止轮询（拉取并应用前进的房间状态）');
  document.visibilityState = 'visible';

  // J2. 房间无变化（同 pushId）→ 不重复应用（避免打断拖拽/动画）
  vm.runInContext('_lastResyncAt = 0;', ctx);
  const appliedBeforeJ2 = applied.length;
  pollTickFn();
  await flush();
  await flush();
  assert(applied.length === appliedBeforeJ2, '轮询在房间无变化时不重复应用');

  // J3. 未确认推送 + 房间落后 → 轮询自动补发（无需等生命周期事件）
  ctx._pushResults = [false];
  const pushBeforeJ3 = ctx._pushCount;
  vm.runInContext('_pendingPushSeat = 1; _lastPushVerified = false; _lastResyncAt = 0;', ctx);
  g.S = { currentSeat: 1, currentPlayer: 1, turnNo: 31 };
  g.onlinePushState();
  await flush();
  assert(ctx._pushCount === pushBeforeJ3 + 1, 'J3: 推送发出（模拟 iOS 丢包）');
  vm.runInContext('_lastResyncAt = 0;', ctx);
  pollTickFn();
  await flush();
  await flush();
  assert(ctx._pushCount === pushBeforeJ3 + 2, '轮询发现未确认推送并自动补发');
  assert(vm.runInContext('_lastPushVerified', ctx) === true && g.S.turnNo === 31, '补发成功且本地状态未被旧快照覆盖');

  // J4. 等候室（未开局）：轮询按内容签名刷新、不重应用对局状态
  vm.runInContext('_gameStarted = false; _knownSeatCount = 1; _departedHandled = false; _lastWaitingSig = "";', ctx);
  ctx._roomRow = { status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }], state: null };
  const appliedBeforeJ4 = applied.length;
  pollTickFn();
  await flush();
  await flush();
  assert(applied.length === appliedBeforeJ4, '等候室轮询不重应用对局状态');
  assert(vm.runInContext('_lastWaitingSig', ctx) === '0:A|', '等候室轮询按签名刷新等候室');

  // J4a. 等候室轮询兜住漏收的成员离开（实时行丢失时）→ 提示 + 计数同步
  const savedAlertJ = ctx.alert;
  let alertMsgJ = '';
  ctx.alert = (m) => { alertMsgJ = String(m); };
  g.S = { currentSeat: 0, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
  vm.runInContext('_knownSeatCount = 3; _departedHandled = false;', ctx);
  ctx._roomRow = { status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }, { seatIndex: 1, name: 'B' }], state: null };
  pollTickFn();
  await flush();
  await flush();
  assert(vm.runInContext('_departedHandled', ctx) === true && vm.runInContext('_knownSeatCount', ctx) === 2,
    '轮询兜住漏收的成员离开并同步席位数');
  assert(alertMsgJ.includes('C'), '非房主收到离开提示（含离开者名字）');
  assert(vm.runInContext('_lastWaitingSig', ctx) === '0:A,1:B|', '成员离开后等候室按签名重绘');
  ctx.alert = savedAlertJ;

  // J4b. 等候室中房间已开局（漏收开局推送）→ 轮询补同步并把间隔切换到对局节奏
  vm.runInContext('_lastResyncAt = 0; _pollIntervalMs = ONLINE_CONFIG.POLL_WAIT_MS;', ctx);
  const pollsBeforeJ4b = pollIntervalsStarted;
  ctx._roomRow = { status: 'playing', seats: [{ seatIndex: 0, name: 'A' }, { seatIndex: 1, name: 'B' }], state: mkState(0, t0 + 50000, 'x-40', 40) };
  pollTickFn();
  await flush();
  await flush();
  assert(g.S.turnNo === 40 && vm.runInContext('_gameStarted', ctx) === true, '等候室中房间开局 → 轮询补同步进入对局');
  assert(pollIntervalsStarted === pollsBeforeJ4b + 1 && pollDelay === vm.runInContext('ONLINE_CONFIG.POLL_GAME_MS', ctx),
    '进入对局后轮询按对局节奏重启');

  // J5. 推送串行化（对齐神探缉凶）：在途期间的并发推送请求合并，完成后以最新本地状态补发；
  //     排队补发必须携带粘性状态（开局 'playing' 推送常被 dealGame 的 saveState 推送挡在队列外）
  let pushGate = null;
  const sentStates = [];
  const savedPushJ = ctx.netUpdateGameState;
  ctx.netUpdateGameState = async (roomId, st, status) => {
    ctx._pushCount++;
    sentStates.push({ turnNo: st.turnNo, status: status || '' });
    if (sentStates.length === 1) await new Promise(r => { pushGate = r; }); // 第1发挂起在途
    return true;
  };
  vm.runInContext('_pendingPushSeat = 1;', ctx);
  g.S = { currentSeat: 1, currentPlayer: 1, turnNo: 50 };
  g.onlinePushState(); // 第1发：挂起
  await flush();
  g.S = { currentSeat: 1, currentPlayer: 1, turnNo: 51 };
  g.onlinePushState(); // 在途期间 → 只记标记、不并发发送
  await flush();
  assert(sentStates.length === 1, '串行化：推送在途期间不并发发送');
  vm.runInContext('_markPushAndSend(window._getOnlineState(), "playing");', ctx); // 开局状态推送被排队
  pushGate(); // 放行第1发
  await flush();
  await flush();
  assert(sentStates.length === 2 && sentStates[1].turnNo === 51, '在途完成后补发最新状态（最后一次操作不丢）');
  assert(sentStates[1].status === 'playing', '排队补发携带粘性状态（开局 playing 不因串行化丢失）');
  ctx.netUpdateGameState = savedPushJ;

  // J6. 退出房间 → 停止轮询并复位推送/签名状态
  vm.runInContext('_cleanupOnline();', ctx);
  assert(pollIntervalsCleared.includes(4242), '退出房间后停止轮询');
  assert(vm.runInContext('_pushInFlight === false && _pushQueued === false && _lastWaitingSig === ""', ctx),
    '退出清理推送串行化与等候室签名状态');

  console.log(`\n结果: ${passCount} 通过 / ${failCount} 失败`);
  process.exit(failCount ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });