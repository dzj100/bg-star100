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
    departedPlayers: [],
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

await t('三重探测器：3 张相邻扫描；命中生效；道具不占回合（结束后继续行动）', () => {
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
  eq(S.currentSeat, 0, '道具不占回合：归还行动者继续行动');
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
});

await t('对讲机拒绝：交换已公开牌 / 指定自己', () => {
  const g = loadGame();
  const shown = C('blue', 3, { revealed: true }), h = C('blue', 8);
  use(g, sc(2, [[[shown, h]], [[C('blue', 9)]]],
    { equipment: [{ no: 2, unlocked: true, used: false }] }));
  includes(g.useWalkie(shown.id, 1).msg, '未公开');
  includes(g.useWalkie(h.id, 0).msg, '其他玩家');
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
  o._handleRemoteState({ state: { currentPlayer: 0, _ts: 6000, _pushId: 'p-new', departedPlayers: [] } });
  eq(o.__applied.length, 1, '新状态应被应用');
  eq(ev(o, '_gameStarted'), true, '应用后进入对局态');

  // 同一条状态重复投递（重订阅/重同步重复拉取）
  o._handleRemoteState({ state: { currentPlayer: 0, _ts: 6000, _pushId: 'p-new', departedPlayers: [] } });
  eq(o.__applied.length, 1, '相同 pushId 重复投递应去重');

  // 早于已应用水位 3s 以上的过期快照（留时钟偏差余量）
  o._handleRemoteState({ state: { currentPlayer: 3, _ts: 1000, _pushId: 'p-old', departedPlayers: [] } });
  eq(o.__applied.length, 1, '陈旧快照应被拒绝');

  // 更新的快照正常应用
  o._handleRemoteState({ state: { currentPlayer: 3, _ts: 7000, _pushId: 'p-new2', departedPlayers: [] } });
  eq(o.__applied.length, 2, '更新的快照应正常应用');
  eq(ev(o, '_lastAppliedTs'), 7000, '新鲜度水位应推进');
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

