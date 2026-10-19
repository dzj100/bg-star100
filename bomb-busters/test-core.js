/**
 * 炸弹克星 (Bomb Busters) — 核心规则测试
 * node + vm（mock DOM / localStorage），无第三方依赖
 * 运行：node test-core.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const GAME_SRC   = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
const ONLINE_SRC = fs.readFileSync(path.join(__dirname, 'online.js'), 'utf8');

/* ══════════════════════════════ 测试运行器 ══════════════════════════════ */

let passN = 0, failN = 0;
const failureList = [];

async function t(name, fn) {
  try {
    await fn();
    passN++;
    console.log('  ✅', name);
  } catch (e) {
    failN++;
    failureList.push({ name, msg: e && e.message });
    console.log('  ❌', name);
    console.log('     ', e && e.message);
  }
}

function assert(c, msg) { if (!c) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) {
    throw new Error((msg ? msg + '：' : '') + `期望 ${JSON.stringify(b)}，得到 ${JSON.stringify(a)}`);
  }
}
function includes(str, sub, msg) {
  if (String(str).indexOf(sub) < 0) {
    throw new Error((msg ? msg + '：' : '') + `应包含「${sub}」，实际「${str}」`);
  }
}

/* ══════════════════════════════ 沙箱装载 ══════════════════════════════ */

function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
  };
}

function makeEl() {
  return {
    id: '',
    textContent: '',
    innerHTML: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {},
    querySelectorAll() { return []; },
  };
}

function makeDoc() {
  const els = {};
  return {
    getElementById(id) { return (els[id] = els[id] || Object.assign(makeEl(), { id })); },
    createElement() { return makeEl(); },
    body: makeEl(),
    addEventListener() {},
  };
}

/** 装载 game.js（不加载 render.js：_render 因 render 未定义自动跳过） */
function loadGame() {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.console = console;
  ctx.localStorage = makeStorage();
  ctx.document = makeDoc();
  ctx.setTimeout = setTimeout;
  ctx.clearTimeout = clearTimeout;
  vm.createContext(ctx);
  vm.runInContext(GAME_SRC, ctx, { filename: 'game.js' });
  return ctx;
}

/** 在沙箱内求值（读取顶层 let/const 绑定） */
function ev(ctx, expr) { return vm.runInContext(expr, ctx); }

/** 装载 online.js（net 层打桩，避免真实网络） */
function loadOnline() {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.console = { log() {}, warn() {}, error() {} };
  ctx.localStorage = makeStorage();
  ctx.document = makeDoc();
  ctx.setTimeout = () => 0;
  ctx.clearTimeout = () => {};
  ctx.setInterval = () => 0;
  ctx.clearInterval = () => {};
  ctx.netGetRoom = async () => null;
  ctx.netUpdateGameState = async () => true;
  ctx.NET_CONFIG = { MAX_PLAYERS: 5 };
  ctx.showToast = () => {};
  vm.createContext(ctx);
  vm.runInContext(ONLINE_SRC, ctx, { filename: 'online.js' });
  ctx.__applied = [];
  ctx._getOnlineState = () => ({ currentPlayer: 0 });
  ctx._applyOnlineState = s => { ctx.__applied.push(s); };
  vm.runInContext(`
    _onlineRoomId = 'TEST';
    _mySeatIndex = 1;
    _isHost = false;
  `, ctx);
  return ctx;
}

/* ══════════════════════════════ 场景构造 ══════════════════════════════ */

let _cardSeq = 0;
function C(kind, num, extra) {
  return Object.assign(
    { id: 't' + (++_cardSeq), kind, num, revealed: false, info: null, fail: null, neq: null },
    extra || {}
  );
}

/**
 * 直构对局状态（绕过 dealGame，规则用例完全确定）。
 * hands: 每座位的手牌份数组，如 [[[c1, c2]], [[c3]]]
 */
function sc(pCount, hands, opts) {
  opts = opts || {};
  const players = hands.map((shares, i) => ({
    name: opts.names ? opts.names[i] : 'P' + i,
    seat: i,
    shares: shares.map(sh => sh.slice()),
    skillUsed: false,
  }));
  return {
    players,
    phase: opts.phase || 'play',
    missionId: 1,
    dealStamp: 12345,
    captainSeat: opts.captain || 0,
    currentSeat: opts.current !== undefined ? opts.current : 0,
    turnNo: 0,
    board: Object.assign(
      { redNum: 6.5, yellowNums: [3.1, 9.1], defused: Array(12).fill(false) },
      opts.board || {}
    ),
    failures: opts.failures || 0,
    pCount,
    equipment: opts.equipment || [],
    pending: null,
    scanMode: null,
    result: null,
    ready: Array(pCount).fill(false),
    markAt: {},
    log: [],
    gameOver: false,
  };
}

function use(g, S) { g.window.S = S; return S; }
function st(g) { return g.window.S; }

/* ══════════════════════════════ 用例 ══════════════════════════════ */

(async () => {
console.log('\n═══ 炸弹克星 核心规则测试 ═══\n');

/* ──────────────────────────── 发牌与开局 ──────────────────────────── */

console.log('── 发牌与开局 ──');

await t('5 人局：51 张 / 每人 1 份 / 份内升序 / 黄 2 / 道具 5 张不重复', () => {
  const g = loadGame();
  g.dealGame(['A', 'B', 'C', 'D', 'E']);
  const S = st(g);
  eq(S.pCount, 5);
  eq(S.phase, 'mark');
  eq(S.currentSeat, -1, '标记阶段无行动者');
  let total = 0;
  for (const p of S.players) {
    eq(p.shares.length, 1, '5 人局每人 1 份');
    const sh = p.shares[0];
    total += sh.length;
    for (let i = 1; i < sh.length; i++) assert(sh[i].num >= sh[i - 1].num, '份内应升序');
  }
  eq(total, 51, '48 蓝 + 1 红 + 2 黄');
  eq(S.board.yellowNums.length, 2);
  assert(ev(g, 'RED_NUMS').includes(S.board.redNum), '红牌数字应在 1.5~11.5');
  eq(S.equipment.length, 5);
  eq(new Set(S.equipment.map(e => e.no)).size, 5, '道具编号不重复');
  assert(S.equipment.every(e => !e.unlocked && !e.used), '开局道具均锁定');
});

await t('2 人局：53 张 / 各 2 份 / 黄 4', () => {
  const g = loadGame();
  g.dealGame(['A', 'B']);
  const S = st(g);
  eq(S.players[0].shares.length, 2);
  eq(S.players[1].shares.length, 2);
  let total = 0;
  for (const p of S.players) for (const sh of p.shares) {
    total += sh.length;
    for (let i = 1; i < sh.length; i++) assert(sh[i].num >= sh[i - 1].num);
  }
  eq(total, 53, '48 蓝 + 1 红 + 4 黄');
  eq(S.board.yellowNums.length, 4);
});

await t('3 人局：队长 2 份，其余各 1 份，共 51 张', () => {
  const g = loadGame();
  g.dealGame(['A', 'B', 'C']);
  const S = st(g);
  eq(S.players[S.captainSeat].shares.length, 2, '队长 2 份');
  const others = [0, 1, 2].filter(s => s !== S.captainSeat);
  for (const s of others) eq(S.players[s].shares.length, 1);
  let total = 0;
  for (const p of S.players) for (const sh of p.shares) total += sh.length;
  eq(total, 51);
});

await t('牌库构成：蓝色每个数字 4 张', () => {
  const g = loadGame();
  g.dealGame(['A', 'B', 'C', 'D']);
  const counts = ev(g, `(function(){
    var c = {};
    _eachCard(function(x){ var k = x.kind + '-' + x.num; c[k] = (c[k]||0)+1; });
    return c;
  })()`);
  for (let n = 1; n <= 12; n++) eq(counts['blue-' + n], 4, `蓝色 ${n} 应 4 张`);
  let redTotal = 0, yellowTotal = 0, total = 0;
  for (const k in counts) {
    if (k.startsWith('red-')) redTotal += counts[k];
    if (k.startsWith('yellow-')) yellowTotal += counts[k];
    total += counts[k];
  }
  eq(redTotal, 1);
  eq(yellowTotal, 2);
  eq(total, 51);
});

await t('洗牌：蓝色数字应跨玩家分布（回归：deck 未被洗牌的错误）', () => {
  // 未修复的 bug 稳定产生「唯一跨位数字」的牌局（数字连续切块分份）；
  // 正确洗牌下每局期望 ~10 个跨位数字，20 局内低于 4 的概率 < 1e-8
  for (let r = 0; r < 20; r++) {
    const g = loadGame();
    g.dealGame(['A', 'B']);
    const S = st(g);
    const owners = {};
    S.players.forEach((p, seat) => {
      for (const sh of p.shares) for (const c of sh) {
        if (c.kind !== 'blue') continue;
        (owners[c.num] = owners[c.num] || new Set()).add(seat);
      }
    });
    let split = 0;
    for (const n of Object.keys(owners)) if (owners[n].size > 1) split++;
    assert(split >= 4, `第 ${r + 1} 局跨玩家数字仅 ${split} 个，疑似牌库未洗牌`);
  }
});

/* ──────────────────────────── 关卡与多红导线 ──────────────────────────── */

console.log('── 关卡与多红导线 ──');

/** 按关卡开局（联机时关卡来自房间 pendingChallenge） */
function dealMission(id, names) {
  const g = loadGame();
  g.window._olPendingChallenge = { missionId: id };
  g.dealGame(names);
  return g;
}

function boardTotals(g) {
  let total = 0;
  for (const p of st(g).players) for (const sh of p.shares) total += sh.length;
  return total;
}

/** 本局实际进入牌库（手牌）的红/黄数字 */
function handWireNums(g) {
  const out = { red: [], yellow: [] };
  for (const p of st(g).players) for (const sh of p.shares) for (const c of sh) {
    if (c.kind === 'red' || c.kind === 'yellow') out[c.kind].push(c.num);
  }
  out.red.sort((a, b) => a - b);
  out.yellow.sort((a, b) => a - b);
  return out;
}

function subsetOf(nums, pool) {
  return nums.every(n => pool.indexOf(n) >= 0);
}

await t('关卡默认 #4：实心标记、无括号备注、红 1 黄 2（51 张）', () => {
  const g = loadGame();
  eq(g.currentMissionId(), 1, '未选关时默认第一关');
  g.dealGame(['A', 'B', 'C']);
  const S = st(g);
  eq(S.missionId, 1);
  eq(boardTotals(g), 51, '48 蓝 + 1 红 + 2 黄');
  eq(S.board.redNums.length, 1);
  eq(S.board.yellowNums.length, 2);
  const hand = handWireNums(g);
  eq(hand.red.length, 1);
  eq(hand.yellow.length, 2);
  eq(S.board.redMark, 'solid');
  eq(S.board.yellowMark, 'solid');
  eq(S.board.redNote, '');
  eq(S.board.yellowNote, '');
  eq(S.board.orderNums.length, 0, '非 #9 无顺序剪线');
  includes(S.log[0].msg, '#4 实地练习第一天');
});

await t('#5 三人局：抽 1 红 + 3 黄全标板，牌库 3选2（51 张），黄线空心', () => {
  const g = dealMission(2, ['A', 'B', 'C']);
  const S = st(g);
  eq(S.missionId, 2);
  eq(boardTotals(g), 51, '48 蓝 + 1 红 + 2 黄（实际入库）');
  eq(S.board.redNums.length, 1);
  eq(S.board.yellowNums.length, 3, '抽出的 3 根黄线全部标到数轴');
  const hand = handWireNums(g);
  eq(hand.red.length, 1);
  eq(hand.yellow.length, 2, '牌库只混入 3选2 的 2 根');
  assert(subsetOf(hand.red, S.board.redNums), '入库红线应来自板上候选');
  assert(subsetOf(hand.yellow, S.board.yellowNums), '入库黄线应来自板上候选');
  eq(S.board.yellowMark, 'hollow', '黄线空心标记');
  eq(S.board.redMark, 'solid', '红线仍实心');
  eq(S.board.yellowNote, '3选2');
  eq(S.board.redNote, '');
  assert(S.board.redNums.every(n => Number.isInteger(n - 0.5)), '红线应取自 1.5~11.5');
  assert(S.board.yellowNums.every(n => Math.abs(n % 1 - 0.1) < 1e-9), '黄线应取自 1.1~11.1');
  includes(S.log[0].msg, '#5 实地练习第二天');
  includes(S.log[0].msg, '3 条黄导线（3选2）');
});

await t('#5 双人局：2 红 + 3 黄候选，牌库 2 红 + 3选2 黄（52 张）', () => {
  const g = dealMission(2, ['A', 'B']);
  const S = st(g);
  eq(boardTotals(g), 52, '48 蓝 + 2 红 + 2 黄（实际入库）');
  eq(S.board.redNums.length, 2);
  eq(S.board.yellowNums.length, 3);
  const hand = handWireNums(g);
  eq(hand.red.length, 2);
  eq(hand.yellow.length, 2);
  assert(subsetOf(hand.yellow, S.board.yellowNums));
  eq(S.board.yellowMark, 'hollow');
});

await t('#6 双人局：2 红 + 4 黄（54 张），实心标记无备注', () => {
  const g = dealMission(3, ['A', 'B']);
  const S = st(g);
  eq(S.missionId, 3);
  eq(boardTotals(g), 54, '48 蓝 + 2 红 + 4 黄');
  eq(S.board.redNums.length, 2);
  eq(S.board.yellowNums.length, 4);
  const hand = handWireNums(g);
  eq(hand.red.length, 2);
  eq(hand.yellow.length, 4);
  eq(S.board.redMark, 'solid');
  eq(S.board.yellowMark, 'solid');
  eq(S.board.redNote, '');
  eq(S.board.yellowNote, '');
  includes(S.log[0].msg, '#6 实地练习第三天');
});

await t('#7 双人局：3 个红候选全标板、牌库 3选1（49 张），红线空心', () => {
  const g = dealMission(4, ['A', 'B']);
  const S = st(g);
  eq(S.missionId, 4);
  eq(boardTotals(g), 49, '48 蓝 + 1 红（实际入库）');
  eq(S.board.redNums.length, 3, '抽出的 3 根红线全部标到数轴');
  eq(S.board.yellowNums.length, 0);
  const hand = handWireNums(g);
  eq(hand.red.length, 1, '牌库只混入 3选1 的 1 根');
  assert(subsetOf(hand.red, S.board.redNums), '入库红线应来自板上候选');
  eq(S.board.redMark, 'hollow', '红线空心标记');
  eq(S.board.redNote, '3选1');
  eq(S.board.yellowNote, '');
  includes(S.log[0].msg, '3 条红导线（3选1）');
});

await t('#8 五人局：抽 2 红 + 3 黄全标板，牌库 2选1 / 3选2（51 张），红黄均空心', () => {
  const g = dealMission(5, ['A', 'B', 'C', 'D', 'E']);
  const S = st(g);
  eq(S.missionId, 5);
  eq(boardTotals(g), 51, '48 蓝 + 1 红 + 2 黄（实际入库）');
  eq(S.board.redNums.length, 2, '抽出的 2 根红线全部标到数轴');
  eq(S.board.yellowNums.length, 3, '抽出的 3 根黄线全部标到数轴');
  const hand = handWireNums(g);
  eq(hand.red.length, 1);
  eq(hand.yellow.length, 2);
  assert(subsetOf(hand.red, S.board.redNums));
  assert(subsetOf(hand.yellow, S.board.yellowNums));
  eq(S.board.redMark, 'hollow');
  eq(S.board.yellowMark, 'hollow');
  eq(S.board.redNote, '2选1');
  eq(S.board.yellowNote, '3选2');
  includes(S.log[0].msg, '2 条红导线（2选1） + 3 条黄导线（3选2）');
});

await t('#8 双人局：3 红 + 4 黄候选全标板，牌库 3选1 + 4 黄（53 张）', () => {
  const g = dealMission(5, ['A', 'B']);
  const S = st(g);
  eq(boardTotals(g), 53, '48 蓝 + 1 红 + 4 黄（实际入库）');
  eq(S.board.redNums.length, 3);
  eq(S.board.yellowNums.length, 4);
  const hand = handWireNums(g);
  eq(hand.red.length, 1);
  eq(hand.yellow.length, 4);
  assert(subsetOf(hand.red, S.board.redNums));
  eq(S.board.redNote, '3选1');
  eq(S.board.yellowNote, '');
  eq(S.board.yellowMark, 'hollow');
});

await t('#9 三人局：1 红 + 2 黄（51 张），公开 3 个不重复的蓝线顺序', () => {
  const g = dealMission(6, ['A', 'B', 'C']);
  const S = st(g);
  eq(S.missionId, 6);
  eq(boardTotals(g), 51, '48 蓝 + 1 红 + 2 黄');
  eq(S.board.redNums.length, 1);
  eq(S.board.yellowNums.length, 2);
  eq(S.board.orderNums.length, 3);
  eq(new Set(S.board.orderNums).size, 3, '顺序数字应互不重复');
  S.board.orderNums.forEach(n => assert(Number.isInteger(n) && n >= 1 && n <= 12, '顺序数字应在 1~12'));
  includes(S.log[0].msg, '#9 轻重缓急');
  const orderText = S.board.orderNums.map(n => '蓝色 ' + n).join(' → ');
  assert(S.log.some(l => l.msg.includes('剪线顺序') && l.msg.includes(orderText)), '开局日志应公开剪线顺序');
});

await t('#9 双人局：2 红 + 4 黄（54 张），同样 3 个蓝线顺序', () => {
  const g = dealMission(6, ['A', 'B']);
  const S = st(g);
  eq(boardTotals(g), 54, '48 蓝 + 2 红 + 4 黄');
  eq(S.board.redNums.length, 2);
  eq(S.board.yellowNums.length, 4);
  eq(S.board.orderNums.length, 3);
  eq(new Set(S.board.orderNums).size, 3);
});

await t('#9 顺序数字：多局洗牌后始终为 1~12 的 3 个不同数字', () => {
  for (let r = 0; r < 15; r++) {
    const g = dealMission(6, ['A', 'B', 'C']);
    const order = st(g).board.orderNums;
    eq(order.length, 3, '第 ' + (r + 1) + ' 局顺序长度');
    eq(new Set(order).size, 3, '第 ' + (r + 1) + ' 局不应重复');
    assert(order.every(n => Number.isInteger(n) && n >= 1 && n <= 12), '第 ' + (r + 1) + ' 局数字范围');
  }
});

await t('#9 未满足前置：双人剪线命中后续数字 → 立即爆炸（boom-order）', () => {
  const g = loadGame();
  const own10 = C('blue', 10), target10 = C('blue', 10);
  const S = use(g, sc(2, [[[own10]], [[target10]]], { board: { orderNums: [5, 10, 3] } }));
  const r = g.doPairCut(1, target10.id, { kind: 'blue', num: 10 }, own10.id);
  assert(r.ok);
  eq(S.phase, 'over');
  eq(S.result.reason, 'boom-order');
  assert(!own10.revealed && !target10.revealed, '违规牌不应公开');
  assert(S.log.some(l => l.msg.includes('须先公开 2 根蓝色 5')), '日志应说明缺失的前置');
});

await t('#9 已满足前置：公开 2 根蓝色 5 后可公开蓝色 10', () => {
  const g = loadGame();
  const f1 = C('blue', 5, { revealed: true }), f2 = C('blue', 5, { revealed: true });
  const own10 = C('blue', 10), target10 = C('blue', 10);
  const S = use(g, sc(2, [[[own10]], [[target10, f1, f2, C('blue', 9)]]], { board: { orderNums: [5, 10, 3] } }));
  const r = g.doPairCut(1, target10.id, { kind: 'blue', num: 10 }, own10.id);
  assert(r.ok && r.hit, '前置满足应命中');
  assert(own10.revealed && target10.revealed);
  eq(S.result, null);
});

await t('#9 第一个数字与未列入顺序的蓝线不受限制', () => {
  const g = loadGame();
  const own5 = C('blue', 5), target5 = C('blue', 5);
  const S = use(g, sc(2, [[[own5]], [[target5, C('blue', 9)]]], { board: { orderNums: [5, 10, 3] } }));
  assert(g.doPairCut(1, target5.id, { kind: 'blue', num: 5 }, own5.id).ok, '第一个数字应可直接公开');
  assert(own5.revealed && target5.revealed);
  eq(S.result, null, '仍有未公开牌，对局继续');

  const own7 = C('blue', 7), target7 = C('blue', 7);
  const S2 = use(g, sc(2, [[[own7]], [[target7, C('blue', 9)]]], { board: { orderNums: [5, 10, 3] } }));
  assert(g.doPairCut(1, target7.id, { kind: 'blue', num: 7 }, own7.id).ok, '非顺序数字不受限制');
  assert(own7.revealed && target7.revealed);
  eq(S2.result, null);
});

await t('#9 单人剪线未解锁数字 → 立即爆炸', () => {
  const g = loadGame();
  const cs = [C('blue', 10), C('blue', 10), C('blue', 10), C('blue', 10)];
  const S = use(g, sc(2, [[cs], [[C('blue', 9)]]], { board: { orderNums: [5, 10, 3] } }));
  assert(g.doSoloCut({ kind: 'all', num: 10 }).ok);
  eq(S.result.reason, 'boom-order');
  assert(cs.every(c => !c.revealed), '违规牌不应公开');
});

await t('#9 探测器命中未解锁数字 → 立即爆炸，不进入待选', () => {
  const g = loadGame();
  const own10 = C('blue', 10);
  const a = C('blue', 10), b = C('blue', 9);
  const S = use(g, sc(2, [[[own10, C('blue', 12)]], [[a, b]]], { board: { orderNums: [5, 10, 3] } }));
  assert(g.useSkill().ok);
  assert(g.doScan([a.id, b.id], 10, own10.id, 'skill').ok);
  eq(S.result.reason, 'boom-order');
  eq(S.pending, null, '不应进入待选公开');
  assert(!own10.revealed && !a.revealed);
});

await t('#9 超级探测器 / X/Y射线命中未解锁数字 → 立即爆炸', () => {
  const g = loadGame();
  const own10a = C('blue', 10);
  const target10a = C('blue', 10);
  const S = use(g, sc(2, [[[own10a]], [[target10a]]], {
    board: { orderNums: [5, 10, 3] },
    equipment: [{ no: 5, unlocked: true, used: false }],
  }));
  assert(g.doSuperScan(1, 0, 10, own10a.id).ok);
  eq(S.result.reason, 'boom-order');
  eq(S.pending, null);

  const own10b = C('blue', 10), ownY = C('yellow', 2.1);
  const target10b = C('blue', 10);
  const S2 = use(g, sc(2, [[[own10b, ownY]], [[target10b]]], {
    board: { orderNums: [5, 10, 3] },
    equipment: [{ no: 10, unlocked: true, used: false }],
  }));
  assert(g.doRayCut(1, target10b.id, { kind: 'blue', num: 10 }, { kind: 'yellow' }, own10b.id, ownY.id).ok);
  eq(S2.result.reason, 'boom-order');
  assert(!own10b.revealed && !target10b.revealed);
});

await t('X选Y：多局洗牌后，牌库导线始终是板上候选的随机子集', () => {
  for (let r = 0; r < 15; r++) {
    const g = dealMission(5, ['A', 'B', 'C', 'D']);
    const S = st(g);
    eq(S.board.redNums.length, 2);
    eq(S.board.yellowNums.length, 3);
    const hand = handWireNums(g);
    eq(hand.red.length, 1, '第 ' + (r + 1) + ' 局实际入库红线');
    eq(hand.yellow.length, 2, '第 ' + (r + 1) + ' 局实际入库黄线');
    assert(subsetOf(hand.red, S.board.redNums), '第 ' + (r + 1) + ' 局红线应来自候选');
    assert(subsetOf(hand.yellow, S.board.yellowNums), '第 ' + (r + 1) + ' 局黄线应来自候选');
  }
});

await t('公开红线：多红关卡仅剩红线时可一次公开全部', () => {
  const g = loadGame();
  const r1 = C('red', 4.5), r2 = C('red', 9.5);
  use(g, sc(2, [[[r1, r2]], [[C('blue', 3)]]], { current: 0 }));
  assert(g.canRevealRed(0), '仅剩红牌应可公开');
  const plan = g._planRevealRed();
  assert(plan.ok);
  eq(plan.count, 2);
  assert(g._applyRevealRed(plan).ok);
  assert(r1.revealed && r2.revealed, '两张红线应同时公开');
  assert(st(g).log.some(l => l.msg.includes('2 张红色导线')));
});

await t('公开红线拒绝：仍有未公开蓝/黄线时不可公开', () => {
  const g = loadGame();
  const red = C('red', 6.5), blue = C('blue', 7), y = C('yellow', 2.1);
  use(g, sc(2, [[[red, blue]], [[y]]], { current: 0 }));
  assert(!g.canRevealRed(0), '有蓝线时不可公开');
  includes(g.doRevealRed().msg, '只有持红者');
  // 双人局也要看本玩家全部份：另一份仍有未公开牌时同样不可公开
  const red2 = C('red', 8.5);
  use(g, sc(2, [[[red2], [C('blue', 11)]], [[y]]], { current: 0 }));
  assert(!g.canRevealRed(0), '其他份有未公开牌时不可公开');
});

await t('选关同步：_olGetPendingChallenge 返回当前关卡；selectMission 上报并刷新卡片', () => {
  const g = loadGame();
  let refreshed = 0;
  g.window._olRefreshWaitingRoom = () => { refreshed++; };
  eq(JSON.stringify(g._olGetPendingChallenge()), JSON.stringify({ missionId: 1 }), '默认上报 #4');

  includes(g.waitingExtrasHTML(), '#4 实地练习第一天');
  includes(g.waitingExtrasHTML(), 'data-testid="mission-switch"', '房主应看到切换按钮');

  const r = g.selectMission(2);
  assert(r.ok);
  eq(JSON.stringify(g.window._olPendingChallenge), JSON.stringify({ missionId: 2 }));
  eq(JSON.stringify(g._olGetPendingChallenge()), JSON.stringify({ missionId: 2 }));
  eq(refreshed, 1, '应立即上报等候室');
  const html = g.waitingExtrasHTML();
  includes(html, '#5 实地练习第二天');
  includes(html, '3选2');
  includes(html, '3 条黄导线（3选2）', '文案按抽出的候选数描述');
  includes(html, '（2 人局：2 条红导线 + 3 条黄导线（3选2））', '双人局说明');
  includes(html, '具体是哪几条保密', 'X选Y 保密提示');

  g.openMissionSheet();
  const sheet = g.document.getElementById('sheetContent').innerHTML;
  includes(sheet, 'data-testid="mission-item-2"', '抽屉应包含关卡列表项');
  includes(sheet, 'data-mission-id="6"', '抽屉应列出全部 6 关');
  includes(sheet, 'mi-tag current', '当前关卡应有标记');
  includes(sheet, '>#8<');
  includes(sheet, '最终测试');
  includes(sheet, '>#9<');
  includes(sheet, '轻重缓急');
});

await t('#9 选关卡片：显示“3 个蓝线数字顺序剪线”追加规则', () => {
  const g = loadGame();
  g.window._olIsHost = () => true;
  assert(g.selectMission(6).ok);
  const html = g.waitingExtrasHTML();
  includes(html, '#9 轻重缓急');
  includes(html, '3 个蓝线数字的剪线顺序');
  includes(html, '前一个数字公开 ≥2 根');
  includes(html, '违者立即爆炸');
  eq(JSON.stringify(g._olGetPendingChallenge()), JSON.stringify({ missionId: 6 }));
});

await t('选关守卫：非房主 / 对局中 / 无效关卡均被拒绝', () => {
  const g = loadGame();
  includes(g.selectMission(99).msg, '无效的关卡');
  g.window._olIsHost = () => false;
  includes(g.selectMission(2).msg, '只有房主');
  assert(!g.waitingExtrasHTML().includes('mission-switch'), '非房主不显示切换按钮');
  g.window._olIsHost = () => true;
  g.window.S.phase = 'play';
  includes(g.selectMission(2).msg, '对局中不能切换关卡');
});

await t('进度：按实际关卡记录，#5 通关不覆盖 #4', () => {
  const g = dealMission(2, ['A', 'B', 'C']);
  g.updateLocalProgress(true);
  const prog = JSON.parse(g.localStorage.getItem('bomb-progress'));
  assert(prog['2'] && prog['2'].passed, '#5 应记录为通关');
  assert(!prog['1'], '不应写入 #4');
});

await t('再来一局：沿用本局关卡（刷新后选关丢失也不回退 #4）', () => {
  const g = dealMission(5, ['A', 'B', 'C']);
  const S = st(g);
  S.phase = 'over';
  S.result = { win: true };
  g.window._olPendingChallenge = null;   // 模拟刷新后等候室选关尚未恢复
  assert(g.restartGame().ok);
  const S2 = st(g);
  eq(S2.missionId, 5);
  eq(S2.phase, 'mark');
  eq(S2.board.redNums.length, 2, '#8 三人局候选红线 2 个');
  eq(S2.board.yellowNums.length, 3, '#8 三人局候选黄线 3 个');
  const hand = handWireNums(g);
  eq(hand.red.length, 1);
  eq(hand.yellow.length, 2);
});

/* ──────────────────────────── 信息标记阶段 ──────────────────────────── */

console.log('── 信息标记阶段 ──');
await t('标记：座位守卫——只能标自己未公开的蓝色导线', () => {
  const g = loadGame();
  const b0 = C('blue', 5), y0 = C('yellow', 3.1), rev = C('blue', 6, { revealed: true });
  const S = use(g, sc(3, [[[b0, y0, rev]], [[C('blue', 8)]], [[C('blue', 2)]]],
    { phase: 'mark', current: -1, names: ['A', 'B', 'C'] }));
  g.window._olSeatIndex = () => 0;

  includes(g.placeInfoToken('nope').msg, '无效的牌');
  includes(g.placeInfoToken(S.players[2].shares[0][0].id).msg, '只能标记自己的导线', '不能标记他人的牌');
  includes(g.placeInfoToken(y0.id).msg, '只能标记蓝色导线', '不能标记黄线');
  includes(g.placeInfoToken(rev.id).msg, '只能标记未公开的导线', '已公开牌不可标记');

  const r1 = g.placeInfoToken(b0.id);
  assert(r1.ok, '标记自己的蓝牌应成功');
  assert(S.ready[0], 'ready[0] 应为 true');
  eq(S.markAt[0], b0.id, 'markAt 应绑定该牌');
  eq(b0.info.num, 5, 'info 应为该牌数字');
  eq(S.phase, 'mark', '未全员就绪仍在标记阶段');
  includes(g.placeInfoToken(b0.id).msg, '该玩家已完成标记', '同一玩家不能重复标记');
});

await t('标记：全员就绪进入对局（由队长开始）', () => {
  const g = loadGame();
  g.dealGame(['A', 'B', 'C']);
  const S = st(g);
  const blueOf = s => S.players[s].shares.flat().find(c => c.kind === 'blue' && !c.revealed);
  const blue0 = blueOf(0);

  const yellow = S.players.flatMap(p => p.shares.flat()).find(c => c.kind === 'yellow');
  includes(g.placeInfoToken(yellow.id).msg, '只能标记蓝色导线', '不能标记黄线');
  assert(!g.placeInfoToken(blueOf(0).id + 'x').ok, '无效牌 id 应被拒绝');

  const r1 = g.placeInfoToken(blue0.id);
  assert(r1.ok, '标记自己的蓝牌应成功');
  assert(S.ready[0], 'ready[0] 应为 true');
  eq(S.markAt[0], blue0.id, 'markAt 应绑定该牌');
  eq(blue0.info.num, blue0.num, 'info 应为该牌数字');
  eq(S.phase, 'mark', '未全员就绪仍在标记阶段');
  assert(!g.placeInfoToken(blue0.id).ok, '同一玩家不能重复标记');

  assert(g.placeInfoToken(blueOf(1).id).ok);
  const r4 = g.placeInfoToken(blueOf(2).id);
  assert(r4.ok, '最后一名标记应成功');
  eq(S.phase, 'play', '全员就绪进入对局');
  eq(S.currentSeat, S.captainSeat, '由队长开始');
});

/* ──────────────────────────── 双人剪线 ──────────────────────────── */

console.log('── 双人剪线 ──');

await t('合法猜测集合：仅含自己持有的未公开类型', () => {
  const g = loadGame();
  const own7a = C('blue', 7), own7b = C('blue', 7), ownY = C('yellow', 3.1);
  const S = use(g, sc(2, [[[own7a, own7b, ownY]], [[C('blue', 2), C('red', 6.5)]]]));
  const opts = g.legalGuessOptions(0);
  eq(JSON.stringify(opts.nums), JSON.stringify([7]));
  eq(opts.yellow, true);
  // 该数字一旦全部公开，即从可猜集合中消失
  own7a.revealed = true; own7b.revealed = true;
  const opts2 = g.legalGuessOptions(0);
  eq(opts2.nums.length, 0);
});

await t('双人剪线命中：双方各公开一张同数字蓝牌，回合结束', () => {
  const g = loadGame();
  const t0 = C('blue', 7), tt = C('blue', 7);
  const S = use(g, sc(2, [
    [[t0, C('blue', 8)]],
    [[tt, C('blue', 9)]],
  ]));
  const r = g.doPairCut(1, tt.id, { kind: 'blue', num: 7 }, t0.id);
  assert(r.ok && r.hit, '应命中');
  assert(t0.revealed && tt.revealed, '两张同数字牌都应公开');
  eq(S.failures, 0);
  eq(S.currentSeat, 1, '行动后回合流转');
});

await t('双人剪线失误：失误 +1、真实身份被标记、回合结束', () => {
  const g = loadGame();
  const own = C('blue', 5), tt = C('blue', 8);
  const S = use(g, sc(2, [
    [[own, C('blue', 12)]],
    [[tt, C('yellow', 9.1)]],
  ]));
  const r = g.doPairCut(1, tt.id, { kind: 'blue', num: 5 }, own.id);
  assert(r.ok && !r.hit, '应失误');
  eq(S.failures, 1);
  assert(tt.fail && tt.fail.type === 'blue' && tt.fail.num === 8, '身份标记应为蓝 8');
  assert(!tt.revealed, '牌面仍隐藏');
  eq(S.currentSeat, 1);
});

await t('指认到红线：立即爆炸（boom-red）', () => {
  const g = loadGame();
  const own = C('yellow', 3.1), red = C('red', 6.5);
  const S = use(g, sc(2, [
    [[own, C('blue', 4)]],
    [[red, C('blue', 5)]],
  ]));
  const r = g.doPairCut(1, red.id, { kind: 'yellow' }, own.id);
  assert(r.ok && !r.hit);
  eq(S.phase, 'over');
  eq(S.result.win, false);
  eq(S.result.reason, 'boom-red');
  assert(!red.revealed, '红色导线不应被公开');
});

await t('失误上限优先于红牌：第 P 次失误即 boom-failures', () => {
  const g = loadGame();
  const own = C('yellow', 3.1), red = C('red', 6.5);
  const S = use(g, sc(2, [
    [[own, C('blue', 4)]],
    [[red, C('blue', 5)]],
  ], { failures: 1 }));
  g.doPairCut(1, red.id, { kind: 'yellow' }, own.id);
  eq(S.phase, 'over');
  eq(S.result.reason, 'boom-failures', '第 2 次失误（P=2）应先判定失败上限');
});

await t('3 人局第 3 次失误爆炸', () => {
  const g = loadGame();
  const own = C('blue', 5), tt = C('blue', 6);
  const S = use(g, sc(3, [
    [[own]],
    [[tt]],
    [[C('blue', 7)]],
  ], { failures: 2 }));
  g.doPairCut(1, tt.id, { kind: 'blue', num: 5 }, own.id);
  eq(S.phase, 'over');
  eq(S.result.reason, 'boom-failures');
});

await t('猜自己没有的类型被拒绝', () => {
  const g = loadGame();
  const own = C('blue', 5), tt = C('blue', 8);
  use(g, sc(2, [[[own]], [[tt, C('blue', 12)]]]));
  const r = g.doPairCut(1, tt.id, { kind: 'blue', num: 11 }, own.id);
  assert(!r.ok, '未持有该数字应被拒绝');
  includes(r.msg, '没有未公开的蓝色 11');
});

await t('自选牌与猜测不符被拒绝', () => {
  const g = loadGame();
  const own = C('blue', 5), wrong = C('blue', 6), tt = C('blue', 8);
  use(g, sc(2, [[[own, wrong]], [[tt, C('blue', 12)]]]));
  const r = g.doPairCut(1, tt.id, { kind: 'blue', num: 5 }, wrong.id);
  assert(!r.ok);
  includes(r.msg, '不符');
});

/* ──────────────────────────── 单人剪线 ──────────────────────────── */

console.log('── 单人剪线 ──');

await t('单人剪线·条件①：已公开 2 张 + 剩余 2 张都在手上 → 公开两张并 4/4 拆除', () => {
  const g = loadGame();
  const a = C('blue', 7), b = C('blue', 7);
  const r1 = C('blue', 7, { revealed: true }), r2 = C('blue', 7, { revealed: true });
  const S = use(g, sc(2, [
    [[a, b]],
    [[r1, r2, C('blue', 9)]],
  ], { equipment: [{ no: 7, unlocked: false, used: false }] }));
  const opts = g.soloOptions(0);
  assert(opts.some(o => o.kind === 'pair' && o.num === 7), '应出现 pair-7 选项');
  const r = g.doSoloCut({ kind: 'pair', num: 7 });
  assert(r.ok);
  assert(a.revealed && b.revealed, '两张都应公开');
  eq(S.board.defused[6], true, '7 号数字应盖拆除章');
  eq(S.equipment[0].unlocked, true, '7 号道具应解锁');
  eq(S.currentSeat, 1, '回合结束');
});

await t('单人剪线·条件②：4 张全在手上 → 全部公开', () => {
  const g = loadGame();
  const cs = [C('blue', 2), C('blue', 2), C('blue', 2), C('blue', 2)];
  const S = use(g, sc(2, [[cs], [[C('blue', 9)]]]));
  const opts = g.soloOptions(0);
  assert(opts.some(o => o.kind === 'all' && o.num === 2));
  assert(g.doSoloCut({ kind: 'all', num: 2 }).ok);
  assert(cs.every(c => c.revealed));
  eq(S.board.defused[1], true);
});

await t('单人剪线·条件③：全部未公开黄线都在手上 → 清收', () => {
  const g = loadGame();
  const myY = C('yellow', 3.1);
  const theirY = C('yellow', 9.1, { revealed: true });
  use(g, sc(2, [[[myY, C('blue', 4)]], [[theirY, C('blue', 5)]]]));
  assert(g.doSoloCut({ kind: 'yellow' }).ok);
  assert(myY.revealed, '黄线应被公开');
});

await t('单人剪线条件不满足被拒绝', () => {
  const g = loadGame();
  use(g, sc(2, [[[C('blue', 7), C('blue', 7)]], [[C('blue', 7), C('blue', 7)]]]));
  const r = g.doSoloCut({ kind: 'pair', num: 7 });
  assert(!r.ok, '已公开 0 张不满足 pair 条件');
  const r2 = g.doSoloCut({ kind: 'all', num: 7 });
  assert(!r2.ok, '场上两处各有 2 张不满足 all 条件');
});

/* ──────────────────────────── 探测器（技能 / 道具3） ──────────────────────────── */

console.log('── 探测器 ──');

await t('双重探测器命中：扫描相邻 2 张 → 待选公开 → 回合结束', () => {
  const g = loadGame();
  const own4 = C('blue', 4);
  const a = C('blue', 4), b = C('blue', 9), c = C('yellow', 5.1);
  const S = use(g, sc(2, [[[own4, C('blue', 12)]], [[a, b, c]]]));
  assert(g.useSkill().ok, '启动探测器');
  eq(S.scanMode.src, 'skill');
  eq(S.players[0].skillUsed, true);
  const r = g.doScan([a.id, b.id], 4, own4.id, 'skill');
  assert(r.ok && r.hit, '应命中');
  assert(S.pending && S.pending.type === 'scanPick', '进入待选公开');
  eq(S.pending.cards.length, 1, '只有 a 是蓝色 4');
  eq(S.currentSeat, 1, '临时移交被扫描玩家');
  const r2 = g.resolveScanPick(a.id);
  assert(r2.ok);
  assert(a.revealed && own4.revealed, '双方各公开一张');
  eq(S.pending, null);
  eq(S.scanMode, null);
  eq(S.currentSeat, 1, '技能扫描命中后回合结束（0→1）');
  S.currentSeat = 0; // 回看 0 号发起者是否可复用技能
  const rReuse = g.useSkill();
  assert(!rReuse.ok, '同一玩家每局仅一次');
  includes(rReuse.msg, '已使用过');
});

await t('双重探测器未命中：失误 +1，对方自选非红牌放置身份标记', () => {
  const g = loadGame();
  const own11 = C('blue', 11);
  const a = C('blue', 4), b = C('blue', 9);
  const S = use(g, sc(2, [[[own11, C('blue', 12)]], [[a, b]]]));
  g.useSkill();
  const r = g.doScan([a.id, b.id], 11, own11.id, 'skill');
  assert(r.ok && !r.hit);
  eq(S.failures, 1);
  assert(S.pending && S.pending.type === 'scanMark', '两张可标记 → 待选择');
  eq(S.currentSeat, 1);
  assert(g.resolveScanMark(b.id).ok);
  assert(b.fail && b.fail.type === 'blue' && b.fail.num === 9);
  eq(S.currentSeat, 1, '回合结束流转到 1');
});

await t('探测器未命中且含红牌：红线自动避开（可标记仅 1 张时自动落标，不爆炸）', () => {
  const g = loadGame();
  const own11 = C('blue', 11);
  const red = C('red', 6.5), b = C('blue', 9);
  const S = use(g, sc(2, [[[own11, C('blue', 12)]], [[red, b]]]));
  g.useSkill();
  const r = g.doScan([red.id, b.id], 11, own11.id, 'skill');
  assert(r.ok && !r.hit);
  eq(S.failures, 1);
  assert(!red.fail, '红线不应被标记');
  assert(b.fail && b.fail.type === 'blue', '自动标记唯一的非红牌');
  eq(S.phase, 'play', '扫描未命中永不因红线爆炸');
  eq(S.currentSeat, 1, '技能扫描后回合结束');
});

await t('探测器相邻校验：非相邻 / 跨玩家 / 已公开 均被拒绝', () => {
  const g = loadGame();
  const own11 = C('blue', 11);
  const a = C('blue', 4), b = C('blue', 9), c = C('blue', 2);
  const d = C('blue', 5, { revealed: true });
  const S = use(g, sc(2, [[[own11, C('blue', 12)]], [[a, b, c, d]]]));
  g.useSkill();
  includes(g.doScan([a.id, c.id], 11, own11.id, 'skill').msg, '相邻', '跳过 b 非相邻');
  includes(g.doScan([a.id, C('blue', 5).id], 11, own11.id, 'skill').msg, '相邻', '不存在/跨玩家');
  includes(g.doScan([c.id, d.id], 11, own11.id, 'skill').msg, '未公开', '已公开牌不可扫描');
  includes(g.doScan([a.id, b.id], 3, own11.id, 'skill').msg, '没有未公开的蓝色 3', '未持有该数字');
});

await t('三重探测器：3 张相邻扫描；命中生效；本回合行动（结算后结束回合）', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const a = C('blue', 7), b = C('blue', 3), c = C('blue', 2);
  const S = use(g, sc(2, [[[own7, C('blue', 12)]], [[a, b, c]]],
    { equipment: [{ no: 3, unlocked: true, used: false }] }));
  const r = g.doScan([a.id, b.id, c.id], 7, own7.id, 'eq3');
  assert(r.ok && r.hit);
  eq(S.equipment[0].used, true, '道具应标记已用');
  assert(S.pending && S.pending.type === 'scanPick' && S.pending.src === 'eq3');
  assert(g.resolveScanPick(a.id).ok);
  assert(a.revealed && own7.revealed);
  eq(S.currentSeat, 1, '探测器类道具 = 本回合行动：结算即结束回合');
  eq(S.scanMode, null);
});

await t('三重探测器：2 张不足 / 已启动技能时被拒绝', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const a = C('blue', 7), b = C('blue', 3);
  const S = use(g, sc(2, [[[own7, C('blue', 12)]], [[a, b]]],
    { equipment: [{ no: 3, unlocked: true, used: false }] }));
  const r = g.doScan([a.id, b.id], 7, own7.id, 'eq3');
  assert(!r.ok);
  includes(r.msg, '3 张');
  g.useSkill();
  const r2 = g.doScan([a.id, b.id], 7, own7.id, 'eq3');
  assert(!r2.ok);
  includes(r2.msg, '技能扫描');
});

await t('双重探测器可取消：未扫描前恢复技能；执行/结算后不可取消', () => {
  const g = loadGame();
  const own4 = C('blue', 4);
  const a = C('blue', 4), b = C('blue', 9);
  const S = use(g, sc(2, [[[own4, C('blue', 12)]], [[a, b]]]));

  const r0 = g.cancelSkill();
  assert(!r0.ok, '未启动时无可取消对象');
  includes(r0.msg, '未启动');

  assert(g.useSkill().ok);
  assert(g.cancelSkill().ok, '启动后可取消');
  eq(S.scanMode, null);
  eq(S.players[0].skillUsed, false, '技能恢复未使用（未消耗）');
  assert(S.log.some(l => l.msg.includes('取消使用双重探测器')), '取消写入日志');

  assert(g.useSkill().ok, '取消后可重新启动');
  const r = g.doScan([a.id, b.id], 4, own4.id, 'skill');
  assert(r.ok && r.hit);
  assert(!g.cancelSkill().ok, '扫描执行中（待选公开）不可取消');
  assert(g.resolveScanPick(a.id).ok);
  eq(S.scanMode, null);
  eq(S.players[0].skillUsed, true, '扫描结算后技能保持已消耗');
  assert(!g.cancelSkill().ok, '结算后不可取消');
});

await t('手牌全公开的玩家自动跳过回合（3 人局 0→2）', () => {
  const g = loadGame();
  const own5 = C('blue', 5);
  const t5 = C('blue', 5), z9 = C('blue', 9, { revealed: true });
  const p2a = C('blue', 2), p2b = C('blue', 3);
  const S = use(g, sc(3, [
    [[own5, C('blue', 12)]],
    [[t5, z9]],
    [[p2a, p2b]],
  ]));
  const r = g.doPairCut(1, t5.id, { kind: 'blue', num: 5 }, own5.id);
  assert(r.ok && r.hit, '双人剪线命中');
  assert(t5.revealed && z9.revealed, 'P1 手牌应全部公开');
  eq(S.currentSeat, 2, '全公开的 P1 被跳过，轮到 P2');
  assert(S.log.some(l => l.msg.includes('自动跳过')), '记录自动跳过日志');
});

await t('2 人局：对手全公开时回合绕回自己（不卡死）', () => {
  const g = loadGame();
  const own5 = C('blue', 5);
  const t5 = C('blue', 5), yz = C('yellow', 3.1, { revealed: true });
  const S = use(g, sc(2, [
    [[own5, C('blue', 12)]],
    [[t5, yz]],
  ]));
  const r = g.doPairCut(1, t5.id, { kind: 'blue', num: 5 }, own5.id);
  assert(r.ok && r.hit);
  eq(S.currentSeat, 0, 'P1 全公开 → 绕回 P0 继续行动');
});

await t('三重探测器：发起者扫描后全公开则结束回合（道具不占回合也不例外）', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const a = C('blue', 7), b = C('blue', 3), c = C('blue', 2);
  const S = use(g, sc(2, [
    [[own7]],
    [[a, b, c]],
  ], { equipment: [{ no: 3, unlocked: true, used: false }] }));
  const r = g.doScan([a.id, b.id, c.id], 7, own7.id, 'eq3');
  assert(r.ok && r.hit);
  eq(S.equipment[0].used, true);
  assert(S.pending && S.pending.type === 'scanPick');
  assert(g.resolveScanPick(a.id).ok);
  assert(own7.revealed, '发起者自选牌公开');
  eq(S.players[0].shares.flat().filter(c => !c.revealed).length, 0, '发起者已全公开');
  eq(S.currentSeat, 1, '发起者全公开 → 回合结束轮到 P1');
});

/* ──────────────────────────── 道具：≠ 标签 / 对讲机 ──────────────────────────── */

console.log('── 道具 ──');

await t('≠标签：同一份相邻 2 张（编号不同、含蓝色）→ 双方成对标记', () => {
  const g = loadGame();
  const c1 = C('blue', 4), c2 = C('yellow', 5.1), c3 = C('blue', 5);
  use(g, sc(2, [[[c1, c2, c3]], [[C('blue', 9)]]],
    { equipment: [{ no: 1, unlocked: true, used: false }] }));
  const r = g.useNeqTag(0, c1.id, c2.id);
  assert(r.ok);
  assert(c1.neq && c1.neq === c2.neq, '两张牌应共享 pairId');
  eq(c3.neq, null);
  assert(!g.useNeqTag(0, c2.id, c3.id).ok, '道具仅一次');
});

await t('≠标签拒绝：编号相同 / 全非蓝 / 非相邻', () => {
  const g = loadGame();
  const d1 = C('blue', 5), d2 = C('blue', 5), y = C('yellow', 3.1), r0 = C('red', 6.5);
  use(g, sc(2, [[[d1, d2, y, r0]], [[C('blue', 9)]]],
    { equipment: [{ no: 1, unlocked: true, used: false }] }));
  includes(g.useNeqTag(0, d1.id, d2.id).msg, '相同', '同编号无意义');
  includes(g.useNeqTag(0, y.id, r0.id).msg, '蓝色', '至少 1 张蓝色');
  includes(g.useNeqTag(0, d1.id, y.id).msg, '相邻', '隔一张不相邻');
});

await t('≠标签：交换导致相邻关系破坏时自动废弃', () => {
  const g = loadGame();
  const c1 = C('blue', 4), c2 = C('yellow', 5.1);
  const other = C('blue', 9);
  const S = use(g, sc(2, [[[c1, c2]], [[other]]],
    { equipment: [{ no: 1, unlocked: true, used: false }] }));
  g.useNeqTag(0, c1.id, c2.id);
  assert(c1.neq && c2.neq);
  // 模拟 c1 被交换到他处：从 0 号手牌移除、放入 1 号手牌后校验
  S.players[0].shares[0].splice(0, 1);
  S.players[1].shares[0].push(c1);
  g._validateNeqPairs();
  eq(c1.neq, null, '离开原相邻位的牌应废弃');
  eq(c2.neq, null, '配对另一张同步废弃');
});

await t('对讲机：各选 1 张交换、重排升序、双方标记自动废弃、回合归还', () => {
  const g = loadGame();
  const infoCard = C('blue', 3);
  infoCard.info = { num: 3 };
  const other = C('blue', 8);
  const t9 = C('blue', 9), t10 = C('blue', 10);
  const S = use(g, sc(2, [[[infoCard, other]], [[t9, t10]]],
    { equipment: [{ no: 2, unlocked: true, used: false }] }));
  const r = g.useWalkie(infoCard.id, 1);
  assert(r.ok);
  eq(S.equipment[0].used, true);
  assert(S.pending && S.pending.type === 'walkie');
  eq(S.currentSeat, 1, '移交接收方选择');
  assert(g.resolveWalkie(t9.id).ok);
  const mine = S.players[0].shares[0];
  const theirs = S.players[1].shares[0];
  eq(mine.map(c => c.num).join(','), '8,9', '接收方交出牌落入发起方该份并重排');
  eq(theirs.map(c => c.num).join(','), '3,10', '发起方挑出牌落入接收方该份并重排');
  eq(infoCard.info, null, '被交换牌的信息标记自动废弃');
  eq(S.pending, null);
  eq(S.currentSeat, 0, '回合归还发起者（道具不占行动）');

  // 挑出/落点位次：随状态同步，供全场查看（牌面仍隐藏）
  assert(S.walkieInfo, '应记录交换位次');
  eq(S.walkieInfo.aCardId, infoCard.id);
  eq(S.walkieInfo.bCardId, t9.id);
  eq(S.walkieInfo.aOut.si, 0); eq(S.walkieInfo.aOut.idx, 0);
  eq(S.walkieInfo.bOut.si, 0); eq(S.walkieInfo.bOut.idx, 0);
  eq(S.walkieInfo.aIn.si, 0); eq(S.walkieInfo.aIn.idx, 1, 'B 交出的 9 落在发起方首位之后');
  eq(S.walkieInfo.bIn.si, 0); eq(S.walkieInfo.bIn.idx, 0, 'A 交出的 3 落在接收方首位');
  const walkieLog = S.log[S.log.length - 1].msg;
  includes(walkieLog, '交出 第 1 份 · 第 1 张');
  includes(walkieLog, '落点 第 1 份 · 第 2 张');
  includes(walkieLog, '牌面保持隐藏');
});

await t('对讲机位次：多份时落点记在各自交牌份内，且按重排后的位置计算', () => {
  const g = loadGame();
  const a4 = C('blue', 4), a8 = C('blue', 8);
  const b2 = C('blue', 2), b6 = C('blue', 6), b10 = C('blue', 10);
  const S = use(g, sc(2, [
    [[a4, a8], [C('blue', 11)]],
    [[C('blue', 12)], [b2, b6, b10]],
  ], { equipment: [{ no: 2, unlocked: true, used: false }] }));
  assert(g.useWalkie(a8.id, 1).ok);
  assert(g.resolveWalkie(b2.id).ok);
  eq(S.walkieInfo.aOut.si, 0); eq(S.walkieInfo.aOut.idx, 1);
  eq(S.walkieInfo.bOut.si, 1); eq(S.walkieInfo.bOut.idx, 0);
  eq(S.walkieInfo.aIn.si, 0); eq(S.walkieInfo.aIn.idx, 0, '收到的 2 重排到 A 第 1 份首位');
  eq(S.walkieInfo.bIn.si, 1); eq(S.walkieInfo.bIn.idx, 1, '收到的 8 重排到 B 第 2 份第 2 位');
  eq(S.players[0].shares[1].map(c => c.num).join(','), '11', '未涉及的份不受影响');
  eq(S.players[1].shares[0].map(c => c.num).join(','), '12', '未涉及的份不受影响');
});

await t('对讲机拒绝：交换已公开牌 / 指定自己', () => {
  const g = loadGame();
  const shown = C('blue', 3, { revealed: true }), h = C('blue', 8);
  use(g, sc(2, [[[shown, h]], [[C('blue', 9)]]],
    { equipment: [{ no: 2, unlocked: true, used: false }] }));
  includes(g.useWalkie(shown.id, 1).msg, '未公开');
  includes(g.useWalkie(h.id, 0).msg, '其他玩家');
});

/* ──────────────────────────── 道具 4~12 ──────────────────────────── */

console.log('── 道具 4~12 ──');

await t('便利贴：标记自己 1 张未公开且无信息标记的蓝线；不占行动', () => {
  const g = loadGame();
  const b5 = C('blue', 5), b6 = C('blue', 6);
  const S = use(g, sc(2, [[[b5, b6]], [[C('blue', 9)]]],
    { equipment: [{ no: 4, unlocked: true, used: false }] }));
  const r = g.useStickyNote(b6.id);
  assert(r.ok);
  eq(b6.info.num, 6, '信息标记绑定该牌');
  eq(S.equipment[0].used, true);
  eq(S.currentSeat, 0, '便利贴不占行动');
  assert(S.log.some(l => l.msg.includes('便利贴')));
});

await t('便利贴拒绝：黄线 / 已公开 / 已有信息标记 / 他人牌', () => {
  const g = loadGame();
  const info = C('blue', 3, { info: { num: 3 } });
  const y = C('yellow', 3.1), rev = C('blue', 4, { revealed: true });
  const o9 = C('blue', 9);
  use(g, sc(2, [[[info, y, rev]], [[o9]]],
    { equipment: [{ no: 4, unlocked: true, used: false }] }));
  includes(g.useStickyNote(y.id).msg, '蓝色');
  includes(g.useStickyNote(rev.id).msg, '未公开');
  includes(g.useStickyNote(info.id).msg, '已有信息标记');
  includes(g.useStickyNote(o9.id).msg, '自己的导线');
});

await t('超级探测器：命中所选份（整份视角）；待选公开 → 结算即结束回合', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const a7 = C('blue', 7), a2 = C('blue', 2);
  const S = use(g, sc(2, [
    [[own7, C('blue', 12)]],
    [[C('blue', 9), C('blue', 3)], [a7, a2]],
  ], { equipment: [{ no: 5, unlocked: true, used: false }] }));
  const r = g.doSuperScan(1, 1, 7, own7.id);
  assert(r.ok && r.hit);
  eq(S.equipment[0].used, true);
  assert(S.pending && S.pending.type === 'superPick' && S.pending.src === 'eq5');
  eq(S.pending.cards.length, 1, '仅该份中命中的牌可公开');
  eq(S.currentSeat, 1, '移交被猜方选择公开牌');
  assert(g.resolveScanPick(a7.id).ok);
  assert(a7.revealed && own7.revealed, '双方各公开 1 张');
  eq(S.currentSeat, 1, '探测器类 = 本回合行动：结算即结束回合（0→1）');
});

await t('超级探测器：判定以所选「一份」为准（另一份有也属未命中）', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const s0a = C('blue', 9), s0b = C('blue', 2);
  const S = use(g, sc(2, [
    [[own7, C('blue', 12)]],
    [[s0a, s0b], [C('blue', 7), C('blue', 3)]],
  ], { equipment: [{ no: 5, unlocked: true, used: false }] }));
  const r = g.doSuperScan(1, 0, 7, own7.id);
  assert(r.ok && !r.hit, '第 1 份无蓝 7 → 未命中（即使第 2 份有）');
  eq(S.failures, 1);
  assert(S.pending && S.pending.type === 'superMark' && S.pending.src === 'eq5');
  eq(S.pending.cards.length, 2, '被猜方仅可在该份未公开蓝线中选');
  eq(S.currentSeat, 1);
  assert(g.resolveScanMark(s0a.id).ok);
  assert(s0a.fail && s0a.fail.type === 'blue' && s0a.fail.num === 9, '身份标记真实公开');
  assert(!s0a.revealed, '牌面保持隐藏');
  eq(S.currentSeat, 1, '标记落定即结束回合');
});

await t('超级探测器：该份无未公开蓝线 → 跳过身份标记且不破坏回合流转', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const y1 = C('yellow', 3.1), y2 = C('yellow', 9.1);
  const S = use(g, sc(2, [
    [[own7, C('blue', 12)]],
    [[y1, y2]],
  ], { equipment: [{ no: 5, unlocked: true, used: false }] }));
  const r = g.doSuperScan(1, 0, 7, own7.id);
  assert(r.ok && !r.hit);
  eq(S.failures, 1);
  eq(S.pending, null, '无需等待标记');
  assert(!y1.fail && !y2.fail, '无蓝线不标记');
  eq(S.currentSeat, 1, '回合正常流转');
  assert(S.log.some(l => l.msg.includes('跳过身份标记')));
});

await t('超级探测器：命中不自动公开——由被猜方选择公开哪张（回归守护）', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const a7 = C('blue', 7);
  const S = use(g, sc(2, [
    [[own7, C('blue', 12)]],
    [[a7, C('blue', 3)]],
  ], { equipment: [{ no: 5, unlocked: true, used: false }] }));
  g.doSuperScan(1, 0, 7, own7.id);
  assert(!a7.revealed && !own7.revealed, '未结算前不得自动公开');
  assert(S.pending && S.pending.type === 'superPick');
  assert(g.resolveScanPick(a7.id).ok);
  assert(a7.revealed && own7.revealed);
});

await t('超级探测器拒绝：全部公开的份 / 无效份 / 未持有数字 / 自选牌不符', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const rev = C('blue', 3, { revealed: true });
  const a7 = C('blue', 7);
  use(g, sc(2, [
    [[own7, C('blue', 12)]],
    [[rev], [a7, C('blue', 9)]],
  ], { equipment: [{ no: 5, unlocked: true, used: false }] }));
  includes(g.doSuperScan(1, 0, 7, own7.id).msg, '已全部公开');
  includes(g.doSuperScan(1, 9, 7, own7.id).msg, '无效的份');
  includes(g.doSuperScan(1, 1, 11, own7.id).msg, '没有未公开的蓝色 11');
  includes(g.doSuperScan(1, 1, 7, C('blue', 11).id).msg, '自选牌');
});

await t('抑制器：失误 −1；不占行动', () => {
  const g = loadGame();
  const S = use(g, sc(2, [[[C('blue', 5), C('blue', 6)]], [[C('blue', 9)]]],
    { failures: 1, equipment: [{ no: 6, unlocked: true, used: false }] }));
  const r = g.useSuppressor();
  assert(r.ok);
  eq(S.failures, 0);
  eq(S.equipment[0].used, true);
  eq(S.currentSeat, 0, '抑制器不占行动');
});

await t('抑制器拒绝：当前无失误 / 未解锁', () => {
  const g = loadGame();
  const S = use(g, sc(2, [[[C('blue', 5)]], [[C('blue', 9)]]],
    { failures: 0, equipment: [{ no: 6, unlocked: true, used: false }] }));
  includes(g.useSuppressor().msg, '没有失误');

  const g2 = loadGame();
  use(g2, sc(2, [[[C('blue', 5)]], [[C('blue', 9)]]],
    { failures: 1, equipment: [{ no: 6, unlocked: false, used: false }] }));
  includes(g2.useSuppressor().msg, '不可用');
});

await t('备用电池：恢复 1~2 名已使用双重探测器的玩家（含自己），恢复后可再次使用', () => {
  const g = loadGame();
  const S = use(g, sc(3, [[[C('blue', 5)]], [[C('blue', 9)]], [[C('blue', 3)]]],
    { equipment: [{ no: 7, unlocked: true, used: false }] }));
  S.players[0].skillUsed = true;
  S.players[2].skillUsed = true;
  const r = g.useBattery([0, 2]);
  assert(r.ok);
  eq(S.players[0].skillUsed, false);
  eq(S.players[2].skillUsed, false);
  eq(S.equipment[0].used, true);
  assert(g.useSkill().ok, '恢复后可再次使用双重探测器');
  eq(S.players[0].skillUsed, true);
});

await t('备用电池拒绝：数量非法 / 无效玩家 / 未使用过者不可被指定', () => {
  const g = loadGame();
  const S = use(g, sc(3, [[[C('blue', 5)]], [[C('blue', 9)]], [[C('blue', 3)]]],
    { equipment: [{ no: 7, unlocked: true, used: false }] }));
  S.players[1].skillUsed = true;
  includes(g.useBattery([]).msg, '1~2');
  includes(g.useBattery([1, 2, 0]).msg, '1~2');
  includes(g.useBattery([99]).msg, '无效的玩家');
  includes(g.useBattery([0]).msg, '尚未使用过');
});

await t('通用雷达：自动公布每人每份是否还有未公开蓝 N（含自己、已公开不计数）', () => {
  const g = loadGame();
  const mineRev = C('blue', 7, { revealed: true });
  const mine2 = C('blue', 2);
  const t7 = C('blue', 7);
  const S = use(g, sc(2, [
    [[mineRev], [mine2]],
    [[t7, C('yellow', 3.1)]],
  ], { equipment: [{ no: 8, unlocked: true, used: false }] }));
  const r = g.useRadar(7);
  assert(r.ok);
  eq(S.equipment[0].used, true);
  assert(S.radar && S.radar.num === 7);
  eq(S.radar.rows.length, 2);
  eq(S.radar.rows[0].seat, 0);
  eq(S.radar.rows[0].per.length, 2, '持 2 份分份公布');
  eq(S.radar.rows[0].per[0], false, '已公开的蓝 7 不计数');
  eq(S.radar.rows[0].per[1], false);
  eq(S.radar.rows[1].per[0], true);
  assert(S.log.some(l => l.msg.includes('通用雷达')));
  eq(S.currentSeat, 0, '雷达不占行动');
  g.endTurn();
  eq(S.radar, null, '回合结束清空雷达结果');
});

await t('通用雷达拒绝：无效数字', () => {
  const g = loadGame();
  use(g, sc(2, [[[C('blue', 5)]], [[C('blue', 9)]]],
    { equipment: [{ no: 8, unlocked: true, used: false }] }));
  includes(g.useRadar(13).msg, '无效的数字');
});

await t('稳定剂：启动 / 取消（未消耗）可反复；不锁定行动', () => {
  const g = loadGame();
  const S = use(g, sc(2, [[[C('blue', 5)]], [[C('blue', 9)]]],
    { equipment: [{ no: 9, unlocked: true, used: false }] }));
  assert(!g.cancelStabilizer().ok, '未启动时无可取消对象');
  assert(g.useStabilizer().ok);
  eq(S.cutMods.stabilize, 0, '共享状态标记稳定状态归属');
  eq(S.equipment[0].used, false, '启动未消耗');
  includes(g.useStabilizer().msg, '已生效', '重复启动被拒');
  assert(g.cancelStabilizer().ok);
  eq(S.cutMods.stabilize, null);
  assert(g.useStabilizer().ok, '取消后可重新启动');
});

await t('稳定剂：受保护未命中——失误不计、蓝牌仍放身份标记、结算消耗', () => {
  const g = loadGame();
  const ownY = C('yellow', 3.1);
  const t8 = C('blue', 8);
  const S = use(g, sc(2, [
    [[ownY, C('blue', 4)]],
    [[t8, C('blue', 12)]],
  ], { equipment: [{ no: 9, unlocked: true, used: false }] }));
  assert(g.useStabilizer().ok);
  const r = g.doPairCut(1, t8.id, { kind: 'yellow' }, ownY.id);
  assert(r.ok && !r.hit);
  eq(S.failures, 0, '失误不计入');
  assert(t8.fail && t8.fail.type === 'blue' && t8.fail.num === 8, '蓝牌仍放身份标记');
  assert(!t8.revealed, '牌面保持隐藏');
  eq(S.equipment[0].used, true, '剪线结算即消耗');
  eq(S.cutMods.stabilize, null);
  eq(S.currentSeat, 1, '回合正常结束');
  assert(S.log.some(l => l.msg.includes('稳定剂生效')));
});

await t('稳定剂：受保护时指到红线也不爆炸、无标记', () => {
  const g = loadGame();
  const ownY = C('yellow', 3.1);
  const red = C('red', 6.5);
  const S = use(g, sc(2, [
    [[ownY, C('blue', 4)]],
    [[red, C('blue', 12)]],
  ], { equipment: [{ no: 9, unlocked: true, used: false }] }));
  assert(g.useStabilizer().ok);
  const r = g.doPairCut(1, red.id, { kind: 'yellow' }, ownY.id);
  assert(r.ok && !r.hit);
  eq(S.phase, 'play', '受保护：红线不引爆');
  eq(S.failures, 0);
  assert(!red.fail && !red.revealed, '红线无标记、保持隐藏');
  eq(S.equipment[0].used, true, '结算消耗');
  eq(S.currentSeat, 1);
});

await t('稳定剂：命中 → 正常结算但随剪线消耗', () => {
  const g = loadGame();
  const own7 = C('blue', 7);
  const t7 = C('blue', 7);
  const S = use(g, sc(2, [[[own7]], [[t7, C('blue', 12)]]],
    { equipment: [{ no: 9, unlocked: true, used: false }] }));
  assert(g.useStabilizer().ok);
  const r = g.doPairCut(1, t7.id, { kind: 'blue', num: 7 }, own7.id);
  assert(r.ok && r.hit);
  assert(t7.revealed && own7.revealed);
  eq(S.equipment[0].used, true, '命中时随本次剪线结算消耗');
  eq(S.cutMods.stabilize, null);
});

await t('稳定剂：本回合未剪线（单人剪线）→ 回合结束自动退还', () => {
  const g = loadGame();
  const cs = [C('blue', 2), C('blue', 2), C('blue', 2), C('blue', 2)];
  const S = use(g, sc(2, [[cs], [[C('blue', 9)]]],
    { equipment: [{ no: 9, unlocked: true, used: false }] }));
  assert(g.useStabilizer().ok);
  assert(g.doSoloCut({ kind: 'all', num: 2 }).ok);
  eq(S.equipment[0].used, false, '未发生剪线结算 → 退还未消耗');
  eq(S.cutMods.stabilize, null);
  assert(S.log.some(l => l.msg.includes('退还')));
});

await t('稳定剂 × 双重探测器：先开稳定再启动探测器，扫描未命中受保护', () => {
  const g = loadGame();
  const own11 = C('blue', 11);
  const a = C('blue', 4), b = C('blue', 9);
  const S = use(g, sc(2, [
    [[own11, C('blue', 12)]],
    [[a, b]],
  ], { equipment: [{ no: 9, unlocked: true, used: false }] }));
  assert(g.useStabilizer().ok, '先开稳定状态');
  assert(g.useSkill().ok, '稳定状态不锁定行动：仍可启动探测器');
  const r = g.doScan([a.id, b.id], 11, own11.id, 'skill');
  assert(r.ok && !r.hit);
  eq(S.failures, 0, '扫描未命中受保护');
  assert(S.pending && S.pending.type === 'scanMark');
  assert(g.resolveScanMark(a.id).ok);
  eq(S.equipment[0].used, true, '扫描结算时消耗');
});

await t('X/Y射线：命中蓝 A 项 → 被指牌公开 + 对应自选牌公开；结算即结束回合', () => {
  const g = loadGame();
  const own7 = C('blue', 7), ownY = C('yellow', 3.1);
  const t7 = C('blue', 7);
  const S = use(g, sc(2, [
    [[own7, ownY]],
    [[t7, C('blue', 12)]],
  ], { equipment: [{ no: 10, unlocked: true, used: false }] }));
  const r = g.doRayCut(1, t7.id, { kind: 'blue', num: 7 }, { kind: 'yellow' }, own7.id, ownY.id);
  assert(r.ok && r.hit);
  assert(t7.revealed && own7.revealed, '命中蓝 A → 公开 A 项自选牌');
  assert(!ownY.revealed, '未命中项自选牌不公开');
  eq(S.equipment[0].used, true);
  eq(S.currentSeat, 1, '本回合行动：结算即结束回合');
});

await t('X/Y射线：命中黄项 → 公开被指牌 + 黄自选牌', () => {
  const g = loadGame();
  const own7 = C('blue', 7), ownY = C('yellow', 3.1);
  const ty = C('yellow', 5.1);
  use(g, sc(2, [
    [[own7, ownY]],
    [[ty, C('blue', 12)]],
  ], { equipment: [{ no: 10, unlocked: true, used: false }] }));
  const r = g.doRayCut(1, ty.id, { kind: 'blue', num: 7 }, { kind: 'yellow' }, own7.id, ownY.id);
  assert(r.ok && r.hit);
  assert(ty.revealed && ownY.revealed);
  assert(!own7.revealed);
});

await t('X/Y射线：未命中 → 失误 +1、被指牌放身份标记；非红不爆炸', () => {
  const g = loadGame();
  const own7 = C('blue', 7), own9 = C('blue', 9);
  const t10 = C('blue', 10);
  const S = use(g, sc(2, [
    [[own7, own9]],
    [[t10, C('blue', 12)]],
  ], { equipment: [{ no: 10, unlocked: true, used: false }] }));
  const r = g.doRayCut(1, t10.id, { kind: 'blue', num: 7 }, { kind: 'blue', num: 9 }, own7.id, own9.id);
  assert(r.ok && !r.hit);
  eq(S.failures, 1);
  assert(t10.fail && t10.fail.type === 'blue' && t10.fail.num === 10);
  eq(S.phase, 'play');
  eq(S.currentSeat, 1);
});

await t('X/Y射线：未命中且为红线 → 立即爆炸（boom-red）', () => {
  const g = loadGame();
  const own7 = C('blue', 7), ownY = C('yellow', 3.1);
  const red = C('red', 6.5);
  const S = use(g, sc(2, [
    [[own7, ownY]],
    [[red, C('blue', 12)]],
  ], { equipment: [{ no: 10, unlocked: true, used: false }] }));
  const r = g.doRayCut(1, red.id, { kind: 'blue', num: 7 }, { kind: 'yellow' }, own7.id, ownY.id);
  assert(r.ok && !r.hit);
  eq(S.phase, 'over');
  eq(S.result.reason, 'boom-red');
});

await t('X/Y射线 × 稳定剂：未命中受保护（红线不爆、失误不计）', () => {
  const g = loadGame();
  const own7 = C('blue', 7), ownY = C('yellow', 3.1);
  const red = C('red', 6.5);
  const S = use(g, sc(2, [
    [[own7, ownY]],
    [[red, C('blue', 12)]],
  ], { equipment: [{ no: 9, unlocked: true, used: false }, { no: 10, unlocked: true, used: false }] }));
  assert(g.useStabilizer().ok);
  const r = g.doRayCut(1, red.id, { kind: 'blue', num: 7 }, { kind: 'yellow' }, own7.id, ownY.id);
  assert(r.ok && !r.hit);
  eq(S.phase, 'play', '受保护不爆');
  eq(S.failures, 0);
  eq(S.equipment.find(e => e.no === 9).used, true);
  eq(S.equipment.find(e => e.no === 10).used, true);
});

await t('X/Y射线拒绝：双黄 / 同数字 / 未持有选项 / 自选牌不符', () => {
  const g = loadGame();
  const own7 = C('blue', 7), ownY = C('yellow', 3.1);
  const t5 = C('blue', 5);
  use(g, sc(2, [
    [[own7, ownY]],
    [[t5, C('blue', 12)]],
  ], { equipment: [{ no: 10, unlocked: true, used: false }] }));
  includes(g.doRayCut(1, t5.id, { kind: 'yellow' }, { kind: 'yellow' }, ownY.id, ownY.id).msg, '不能都是黄色');
  includes(g.doRayCut(1, t5.id, { kind: 'blue', num: 7 }, { kind: 'blue', num: 7 }, own7.id, own7.id).msg, '不能相同');
  includes(g.doRayCut(1, t5.id, { kind: 'blue', num: 7 }, { kind: 'blue', num: 9 }, own7.id, own7.id).msg, '都须持有');
  includes(g.doRayCut(1, t5.id, { kind: 'blue', num: 7 }, { kind: 'yellow' }, ownY.id, own7.id).msg, '自选牌 A');
  includes(g.doRayCut(1, t5.id, { kind: 'blue', num: 7 }, { kind: 'yellow' }, own7.id, own7.id).msg, '自选牌 B');
});

await t('咖啡瓶：跳过自己回合，从指定玩家继续（仅限仍有未公开手牌者）', () => {
  const g = loadGame();
  const S = use(g, sc(3, [
    [[C('blue', 5)]],
    [[C('blue', 9)]],
    [[C('blue', 3)]],
  ], { equipment: [{ no: 11, unlocked: true, used: false }] }));
  const r = g.useCoffee(2);
  assert(r.ok);
  eq(S.currentSeat, 2, '从指定玩家继续');
  eq(S.equipment[0].used, true);
  assert(S.log.some(l => l.msg.includes('咖啡瓶')));
});

await t('咖啡瓶拒绝：指定自己 / 已无未公开手牌者', () => {
  const g = loadGame();
  use(g, sc(3, [
    [[C('blue', 5)]],
    [[C('blue', 9, { revealed: true })]],
    [[C('blue', 3)]],
  ], { equipment: [{ no: 11, unlocked: true, used: false }] }));
  includes(g.useCoffee(0).msg, '其他玩家');
  includes(g.useCoffee(1).msg, '没有未公开手牌');
});

await t('咖啡瓶：跳过回合时未消费的稳定剂自动退还', () => {
  const g = loadGame();
  const S = use(g, sc(3, [
    [[C('blue', 5)]],
    [[C('blue', 9)]],
    [[C('blue', 3)]],
  ], { equipment: [{ no: 9, unlocked: true, used: false }, { no: 11, unlocked: true, used: false }] }));
  assert(g.useStabilizer().ok);
  assert(g.useCoffee(2).ok);
  eq(S.cutMods.stabilize, null);
  eq(S.equipment.find(e => e.no === 9).used, false, '稳定剂退还未消耗');
  eq(S.currentSeat, 2);
});

await t('＝标签：蓝蓝同数字相邻 → 成对标记（可含已公开）', () => {
  const g = loadGame();
  const b1 = C('blue', 5), b2 = C('blue', 5, { revealed: true });
  const S = use(g, sc(2, [[[b1, b2]], [[C('blue', 9)]]],
    { equipment: [{ no: 12, unlocked: true, used: false }] }));
  const r = g.useEqTag(0, b1.id, b2.id);
  assert(r.ok);
  assert(b1.eqp && b1.eqp === b2.eqp, '两张牌共享 pairId');
  eq(S.equipment[0].used, true);
  assert(S.log.some(l => l.msg.includes('两张均为蓝色 5')));
});

await t('＝标签：黄黄 / 红红 → 成对标记', () => {
  const g1 = loadGame();
  const y1 = C('yellow', 3.1), y2 = C('yellow', 9.1);
  const S1 = use(g1, sc(2, [[[y1, y2]], [[C('blue', 9)]]],
    { equipment: [{ no: 12, unlocked: true, used: false }] }));
  assert(g1.useEqTag(0, y1.id, y2.id).ok);
  assert(y1.eqp && y1.eqp === y2.eqp);
  assert(S1.log.some(l => l.msg.includes('均为黄色')));

  const g2 = loadGame();
  const r1 = C('red', 6.5), r2 = C('red', 6.5);
  const S2 = use(g2, sc(2, [[[r1, r2]], [[C('blue', 9)]]],
    { equipment: [{ no: 12, unlocked: true, used: false }] }));
  assert(g2.useEqTag(0, r1.id, r2.id).ok);
  assert(S2.log.some(l => l.msg.includes('均为红色')));
});

await t('＝标签拒绝：蓝不同数字 / 异色 / 非相邻 / 双已公开', () => {
  const g = loadGame();
  const b5 = C('blue', 5), b6 = C('blue', 6), y = C('yellow', 3.1);
  const rev1 = C('blue', 8, { revealed: true }), rev2 = C('blue', 8, { revealed: true });
  use(g, sc(2, [[[b5, b6, y, rev1, rev2]], [[C('blue', 9)]]],
    { equipment: [{ no: 12, unlocked: true, used: false }] }));
  includes(g.useEqTag(0, b5.id, b6.id).msg, '同一数字');
  includes(g.useEqTag(0, y.id, rev1.id).msg, '同色');
  includes(g.useEqTag(0, b5.id, rev1.id).msg, '相邻');
  includes(g.useEqTag(0, rev1.id, rev2.id).msg, '未公开');
});

await t('＝标签：交换导致相邻关系破坏时自动废弃', () => {
  const g = loadGame();
  const c1 = C('blue', 5), c2 = C('blue', 5);
  const S = use(g, sc(2, [[[c1, c2]], [[C('blue', 9)]]],
    { equipment: [{ no: 12, unlocked: true, used: false }] }));
  g.useEqTag(0, c1.id, c2.id);
  assert(c1.eqp && c2.eqp);
  S.players[0].shares[0].splice(0, 1);
  S.players[1].shares[0].push(c1);
  g._validateNeqPairs();
  eq(c1.eqp, null, '离开原相邻位的牌应废弃');
  eq(c2.eqp, null, '配对另一张同步废弃');
});

await t('道具通用：已启动双重探测器时道具被封锁（须先执行扫描）', () => {
  const g = loadGame();
  use(g, sc(2, [[[C('blue', 5)]], [[C('blue', 9)]]],
    { failures: 1, equipment: [{ no: 6, unlocked: true, used: false }] }));
  assert(g.useSkill().ok);
  includes(g.useSuppressor().msg, '须执行扫描');
});

/* ──────────────────────────── 公开红线 / 胜利 / 联机合并 ──────────────────────────── */

console.log('── 红线与胜负 ──');

await t('公开红线：仅当持红者其余牌全公开', () => {
  const g = loadGame();
  const red = C('red', 6.5), stillHidden = C('blue', 3);
  const S1 = use(g, sc(2, [[[red, stillHidden]], [[C('blue', 2)]]]));
  eq(g.canRevealRed(0), false, '还有未公开牌时不可公开');
  stillHidden.revealed = true;
  eq(g.canRevealRed(0), true);
  assert(g.doRevealRed().ok);
  assert(red.revealed, '红线公开');
  eq(S1.currentSeat, 1, '回合结束');
});

await t('胜利判定：最后两张同数字牌被公开 → 拆弹成功', () => {
  const g = loadGame();
  const p0 = C('blue', 12), p1 = C('blue', 12);
  const S = use(g, sc(2, [
    [[p0, C('blue', 11, { revealed: true })]],
    [[p1, C('yellow', 9.1, { revealed: true })]],
  ]));
  const r = g.doPairCut(1, p1.id, { kind: 'blue', num: 12 }, p0.id);
  assert(r.ok && r.hit);
  eq(S.phase, 'over');
  eq(S.result.win, true);
  const prog = JSON.parse(g.localStorage.getItem('bomb-progress'));
  eq(prog[1].passed, true, '本地进度应记录通关（防刷）');
});

console.log('── 联机状态应用 ──');

await t('applyOnlineState：标记阶段合并保留本端标记 + 补推', () => {
  const g = loadGame();
  g.window._olSeatIndex = () => 0;
  g.dealGame(['A', 'B']);
  const S = st(g);
  const blue = S.players[0].shares.flat().find(c => c.kind === 'blue');
  g.placeInfoToken(blue.id);
  assert(S.ready[0], '本端已标记');

  // 模拟陈旧远端快照：本端标记丢失
  const remote = JSON.parse(JSON.stringify(st(g)));
  remote.ready = [false, false];
  remote.markAt = {};
  remote.players[0].shares.flat().forEach(c => { c.info = null; });
  g.applyOnlineState(remote);
  const S2 = st(g);
  eq(S2.ready[0], true, '本端标记应被合并保留');
  const card2 = S2.players[0].shares.flat().find(c => c.id === blue.id);
  assert(card2.info && card2.info.num === blue.num, '信息标记应恢复绑定');
  eq(S2.phase, 'mark', '未全员就绪');

  // 全员就绪的远端快照 → 推进对局
  const remote2 = JSON.parse(JSON.stringify(st(g)));
  remote2.ready = [true, true];
  remote2.phase = 'mark';
  g.applyOnlineState(remote2);
  const S3 = st(g);
  eq(S3.phase, 'play');
  eq(S3.currentSeat, S3.captainSeat);
});

await t('saveStateDirect：标记阶段走底推送通道（currentPlayer=-1 也送达）', () => {
  const g = loadGame();
  g._onlineRoomId = 'ROOM1';
  g.__pushed = [];
  g._markPushAndSend = s => { g.__pushed.push(s); };
  g.window._getOnlineState = () => g.getOnlineState();
  g.dealGame(['A', 'B']);
  eq(g.__pushed.length, 1, '开局应直接推送一次');
  eq(g.__pushed[0].currentPlayer, -1, '标记阶段镜像 currentPlayer=-1');
  ev(g, 'S.turnNo = 7');
  g.dealGame(['A', 'B']);
  eq(g.__pushed[1].turnNo, 8, '重新开局 turnNo 应延续旧局递增（联机新鲜度单调）');
});

/* ──────────────────────────── 联机层健壮性 ──────────────────────────── */

console.log('── 联机层健壮性 ──');

await t('联机：getOrderValue 以 turnNo 为新鲜度排序（无 turnNo 退化为时间戳）', () => {
  const o = loadOnline();
  eq(ev(o, 'ONLINE_CONFIG.getOrderValue({ turnNo: 5, _ts: 1 })'), 5, 'turnNo 优先');
  eq(ev(o, 'ONLINE_CONFIG.getOrderValue({ _ts: 123 })'), 123, '退化为时间戳');
  eq(ev(o, 'ONLINE_CONFIG.getOrderValue(null)'), 0);
});

await t('联机：陈旧快照拒绝 + pushId 去重（乱序/重放防倒灌）', () => {
  const o = loadOnline();
  o._handleRemoteState({ state: { currentPlayer: 0, _ts: 6000, _pushId: 'p-new' } });
  eq(o.__applied.length, 1, '新状态应被应用');
  eq(ev(o, '_gameStarted'), true, '应用后进入对局态');

  // 同一条状态重复投递（重订阅/重同步重复拉取）
  o._handleRemoteState({ state: { currentPlayer: 0, _ts: 6000, _pushId: 'p-new' } });
  eq(o.__applied.length, 1, '相同 pushId 重复投递应去重');

  // 早于已应用水位 3s 以上的过期快照（留时钟偏差余量）
  o._handleRemoteState({ state: { currentPlayer: 3, _ts: 1000, _pushId: 'p-old' } });
  eq(o.__applied.length, 1, '陈旧快照应被拒绝');

  // 更新的快照正常应用
  o._handleRemoteState({ state: { currentPlayer: 3, _ts: 7000, _pushId: 'p-new2' } });
  eq(o.__applied.length, 2, '更新的快照应正常应用');
  eq(ev(o, '_lastAppliedTs'), 7000, '新鲜度水位应推进');
});

await t('联机：成员离开——等候室不触发解散，对局中才提示/弹窗', () => {
  const make = () => {
    const o = loadOnline();
    o.__alerts = [];
    o.__dialogs = [];
    o.alert = m => o.__alerts.push(m);
    o._showPlayerLeftDialog = n => o.__dialogs.push(n);
    o.HOOK_getPlayers = () => [{ name: 'A' }, { name: 'B' }];
    return o;
  };

  // 等候室：成员离开只收缩席位与重绘，不提示
  const w = make();
  vm.runInContext('_gameStarted = false; _knownSeatCount = 2; _departedHandled = false;', w);
  w._syncSeatTracking({ status: 'waiting', seats: [{ seatIndex: 0 }] });
  eq(w.__alerts.length, 0, '等候室成员离开不应提示等待房主解散');
  eq(w.__dialogs.length, 0, '等候室成员离开不应弹解散弹窗');
  eq(ev(w, '_knownSeatCount'), 1, '席位计数应更新');
  eq(ev(w, '_departedHandled'), false, '等候室不应标记已处理离开');

  // 等候室：房主同样不弹解散
  const hw = make();
  vm.runInContext('_isHost = true; _gameStarted = false; _knownSeatCount = 2; _departedHandled = false;', hw);
  hw._syncSeatTracking({ status: 'waiting', seats: [{ seatIndex: 0 }] });
  eq(hw.__dialogs.length, 0, '等候室房主不应弹解散弹窗');

  // 对局中：其他成员收到等待房主解散提示
  const m = make();
  vm.runInContext('_gameStarted = true; _knownSeatCount = 2; _departedHandled = false;', m);
  m._syncSeatTracking({ status: 'playing', seats: [{ seatIndex: 0 }] });
  eq(m.__alerts.length, 1, '对局中成员离开应提示');
  assert(String(m.__alerts[0]).includes('等待房主解散'), '提示文案应为等待房主解散');
  eq(m.__dialogs.length, 0);

  // 对局中：房主收到解散弹窗
  const h = make();
  vm.runInContext('_isHost = true; _gameStarted = true; _knownSeatCount = 2; _departedHandled = false;', h);
  h._syncSeatTracking({ status: 'playing', seats: [{ seatIndex: 0 }] });
  eq(h.__dialogs.length, 1, '对局中房主应弹解散弹窗');
  eq(h.__alerts.length, 0);
});

await t('联机：推送串行化——在途只标记，完成后用最新状态补发', async () => {
  const o = loadOnline();
  o.__sent = [];
  o.__resolvers = [];
  o.netUpdateGameState = (roomId, snapshot, status) => new Promise(res => {
    o.__sent.push({ roomId, snapshot, status });
    o.__resolvers.push(res);
  });
  o.__latest = { marker: 'v1', currentPlayer: 3 };
  o._getOnlineState = () => o.__latest;

  const p1 = o._markPushAndSend({ marker: 'a', currentPlayer: 3 }, 'playing');
  eq(o.__sent.length, 1, '首次推送立即发出');
  const p2 = o._markPushAndSend({ marker: 'b', currentPlayer: 3 });
  eq(o.__sent.length, 1, '在途期间的推送不并发发出');
  eq(ev(o, '_pushQueued'), true, '应记录补发标记');
  eq(await p2, true, '被折叠的推送返回 true');

  o.__latest = { marker: 'v2-latest', currentPlayer: 3 };
  o.__resolvers[0](true);
  eq(await p1, true, '首次推送成功');
  eq(o.__sent.length, 2, '完成后应补发一次');
  eq(o.__sent[1].snapshot.marker, 'v2-latest', '补发应取最新本地状态');
  assert(o.__sent[0].snapshot._pushId !== o.__sent[1].snapshot._pushId, 'pushId 应唯一');
  eq(o.__sent[1].status, 'playing', '粘性状态应随补发一起送达');
  eq(o.__sent[1].snapshot._src, 1, '快照应携带座位来源');

  o.__resolvers[1](true);
  await new Promise(r => setImmediate(r));
  eq(ev(o, '_pushInFlight'), false, '全部完成后恢复空闲');
  eq(ev(o, '_pushQueued'), false);
});

await t('联机：新一局快照（turnNo 全局单调）不被旧局未确认推送补发倒灌', async () => {
  // 场景：旧局终局推送未确认；房主已开新一局（turnNo 延续递增）。轮询补发判定
  // 不得因「新局 turnNo 小于旧局」而误判房间落后，否则旧局态会倒灌覆盖新局。
  const o = loadOnline();
  o.__sent = [];
  o.netUpdateGameState = async (roomId, snapshot) => { o.__sent.push(snapshot); return true; };
  vm.runInContext(`
    _gameStarted = true;
    _lastPushPayload = { pushId: 'me-9', stateObj: { turnNo: 9, _ts: 1000, currentPlayer: 1 }, status: 'playing' };
    _lastPushVerified = false;
  `, o);
  o.netGetRoom = async () => ({ status: 'playing', state: { turnNo: 10, _ts: 9000, _pushId: 'host-10', currentPlayer: -1 } });
  await vm.runInContext('_resyncRoom()', o);
  eq(o.__sent.length, 0, '不应补发旧局状态');
  eq(ev(o, '_lastPushVerified'), true, '本地推送应视为已被新局取代');
  eq(o.__applied.length, 1, '应应用新局状态');
  eq(o.__applied[0].turnNo, 10, '应用的是新局快照');

  // 反向：房间确实落后于本地最后推送（同局更旧 turnNo）→ 必须补发
  const o2 = loadOnline();
  o2.__sent = [];
  o2.netUpdateGameState = async (roomId, snapshot) => { o2.__sent.push(snapshot); return true; };
  vm.runInContext(`
    _gameStarted = true;
    _lastPushPayload = { pushId: 'me-9b', stateObj: { turnNo: 9, _ts: 2000, currentPlayer: 1 }, status: 'playing' };
    _lastPushVerified = false;
  `, o2);
  o2.netGetRoom = async () => ({ status: 'playing', state: { turnNo: 8, _ts: 500, _pushId: 'old-8', currentPlayer: 0 } });
  await vm.runInContext('_resyncRoom()', o2);
  eq(o2.__sent.length, 1, '房间落后时应补发');
  eq(o2.__sent[0].turnNo, 9, '补发的是本地最新状态');
  eq(o2.__applied.length, 0, '补发后不应再应用拉到的旧快照');
});

await t('联机：返回房间（成员）——只改房间状态并切回等候室', async () => {
  const o = loadOnline();
  o.__statusCalls = [];
  o.__updateCalls = [];
  o.netSetRoomStatus = async (roomId, status) => { o.__statusCalls.push({ roomId, status }); return true; };
  o.netUpdateGameState = async (...a) => { o.__updateCalls.push(a); return true; };
  o.netGetRoom = async () => ({ status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }], state: null });
  o._getOnlineState = () => ({ phase: 'over' });
  vm.runInContext('_gameStarted = true; _lastPushPayload = { pushId: "x" }; _lastPushVerified = false;', o);
  eq(await o._olReturnToWaiting(), true, '应返回成功');
  eq(o.__statusCalls.length, 1, '成员应走 setRoomStatus 通道');
  eq(o.__statusCalls[0].status, 'waiting');
  eq(o.__updateCalls.length, 0, '成员不应改动状态载荷（避免覆盖房主 state）');
  eq(ev(o, '_gameStarted'), false, '应退出对局态');
  eq(ev(o, '_lastPushPayload'), null, '未确认推送上下文应清空（防终局快照补发倒灌）');
  eq(o.document.getElementById('online').style.display, 'flex', '应显示等候室');
  eq(o.document.getElementById('app').style.display, 'none', '应隐藏对局界面');
});

await t('联机：返回房间（房主）——重置状态载荷并保留选关', async () => {
  const o = loadOnline();
  o.__updateCalls = [];
  o.netSetRoomStatus = async () => { throw new Error('房主不应走成员通道'); };
  o.netUpdateGameState = async (roomId, state, status) => { o.__updateCalls.push({ roomId, state, status }); return true; };
  o.netGetRoom = async () => ({ status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }], state: null });
  o._getOnlineState = () => ({ phase: 'over' });
  vm.runInContext('_isHost = true; _gameStarted = true; window._olPendingChallenge = "m1";', o);
  eq(await o._olReturnToWaiting(), true, '应返回成功');
  eq(o.__updateCalls.length, 1, '房主应走 updateGameState 通道');
  eq(o.__updateCalls[0].status, 'waiting');
  eq(JSON.stringify(o.__updateCalls[0].state), JSON.stringify({ pendingChallenge: 'm1' }),
    '载荷应保留选关、丢弃旧对局快照');
  eq(ev(o, '_gameStarted'), false);
});

await t('联机：返回房间——非结算阶段拒绝且不改动房间', async () => {
  const o = loadOnline();
  o.__calls = 0;
  o.netSetRoomStatus = async () => { o.__calls++; return true; };
  o.netUpdateGameState = async () => { o.__calls++; return true; };
  o._getOnlineState = () => ({ phase: 'play' });
  vm.runInContext('_gameStarted = true;', o);
  eq(await o._olReturnToWaiting(), false, '对局中应拒绝返回');
  eq(o.__calls, 0, '不应发起任何房间更新');
  eq(ev(o, '_gameStarted'), true, '视图不应切换');
});

await t('联机：对局中收到 waiting 行（成员端返回房间）自动切回等候室', () => {
  const o = loadOnline();
  o._getOnlineState = () => ({ phase: 'over', currentPlayer: 0 });  // 结算后才可能返回房间
  o.__renders = 0;
  o.renderWaitingRoom = () => { o.__renders++; };
  vm.runInContext('_gameStarted = true; _lastWaitingSig = "stale";', o);
  const room = { status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }], state: null };
  o._renderWaitingIfChanged(room);
  eq(o.__renders, 1, '应切回并重绘等候室');
  eq(ev(o, '_gameStarted'), false, '应退出对局态');
  eq(o.document.getElementById('online').style.display, 'flex', '应显示等候室');
  eq(o.document.getElementById('app').style.display, 'none', '应隐藏对局界面');
  o._renderWaitingIfChanged(room);
  eq(o.__renders, 1, '内容未变不重复重绘');
  o._renderWaitingIfChanged({ status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }, { seatIndex: 1, name: 'B' }], state: null });
  eq(o.__renders, 2, '座位变化应重绘（新玩家加入可见）');
});

await t('联机：开局中间态 waiting 行（旧状态未切 status）不得踢出对局界面', () => {
  // dealGame 的先行动画推送带旧 status='waiting' 短暂落地，'playing' 更新随后才到
  const o = loadOnline();
  o.__renders = 0;
  o.renderWaitingRoom = () => { o.__renders++; };
  vm.runInContext('_gameStarted = true;', o);
  o._renderWaitingIfChanged({ status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }], state: { phase: 'mark', dealStamp: 1 } });
  eq(ev(o, '_gameStarted'), true, '应保持对局态');
  eq(o.__renders, 0, '不应渲染等候室');
  eq(o.document.getElementById('app').style.display, undefined, '不应隐藏对局界面');
  // 真正的返回房间（房主置空状态载荷）仍应正常切换
  o._getOnlineState = () => ({ phase: 'over' });  // 本地已结算
  o._renderWaitingIfChanged({ status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }], state: null });
  eq(ev(o, '_gameStarted'), false, '返回房间应切回等候室');
  eq(o.__renders, 1);
});

await t('联机：开局瞬间的迟到旧 waiting 行（无对局状态）不得踢出对局', () => {
  // 加入房间的实时回显 / 开局前发出的轮询响应可能在 _gameStarted 之后才落地；
  // 此类行 state 为空不满足 midStart 例外，须靠本地阶段（mark/play）兜住
  for (const phase of ['mark', 'play']) {
    const o = loadOnline();
    o.__renders = 0;
    o.renderWaitingRoom = () => { o.__renders++; };
    o._getOnlineState = () => ({ phase });
    vm.runInContext('_gameStarted = true;', o);
    o._renderWaitingIfChanged({ status: 'waiting', seats: [{ seatIndex: 0, name: 'A' }], state: null });
    eq(ev(o, '_gameStarted'), true, `本地 phase=${phase} 时应保持对局态`);
    eq(o.__renders, 0, '不应渲染等候室');
    eq(o.document.getElementById('app').style.display, undefined, '不应隐藏对局界面');
  }
});

await t('联机：成员返回房间后载荷未变，轮询兜底也切回等候室', async () => {
  const o = loadOnline();
  o._getOnlineState = () => ({ phase: 'over' });  // 本地已结算，允许切回
  o.__renders = 0;
  o.renderWaitingRoom = () => { o.__renders++; };
  vm.runInContext('_gameStarted = true; _lastAppliedPushId = "same";', o);
  o.netGetRoom = async () => ({
    status: 'waiting',
    seats: [{ seatIndex: 0, name: 'A' }],
    state: { _pushId: 'same', phase: 'over' },   // 成员端只改 status，载荷仍是旧对局快照
  });
  await vm.runInContext('_resyncRoom()', o);
  eq(o.__renders, 1, '载荷未变也应兜住界面切换');
  eq(ev(o, '_gameStarted'), false, '应退出对局态');
  eq(o.document.getElementById('online').style.display, 'flex');
});

/* ══════════════════════════════ 结果 ══════════════════════════════ */

console.log(`\n═══ 结果：${passN} 通过 / ${failN} 失败 ═══\n`);
if (failureList.length) {
  console.log('失败用例：');
  for (const f of failureList) console.log('  -', f.name, '→', f.msg);
}
process.exit(failN ? 1 : 0);
})();

