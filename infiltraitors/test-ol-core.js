/* ============================================================
   渗透因子 · 联机引擎无头测试（node test-ol-core.js）
   覆盖：牌堆构成 / 有关判定 / 2~5 人开局（座位与守恒）/ 五类行动按座位合法性 /
        通讯后的摸牌子阶段（pending=draw 与换手时机）/ 铲除命中与拾牌子阶段 /
        胜负三条件 / validate / 公开候选分析 / 2~5 人整局模拟与不变量
   ============================================================ */
'use strict';
const G = require('./game_ol.js');

let ok = 0, total = 0;
const fails = [];
function expect(msg, cond) {
  total++;
  if (cond) ok++;
  else { fails.push(msg); console.log('  ✗ ' + msg); }
}
const sec = t => console.log('\n■ ' + t);

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const clone = S => JSON.parse(JSON.stringify(S));
const seatsOf = n => Array.from({ length: n }, (_, i) => ({ name: '玩家' + (i + 1) }));
/* 全场牌张守恒：牌库 + 叛徒区 + 各盯梢 + 各手牌 + 各情报区 + 明弃 + 暗弃 = 全组合数
   （caughtCards 只是记录，牌本身已洗回牌库，不重复计入） */
const conserved = S => S.deck.length + S.traitorPile.length + S.watches.filter(w => w != null).length +
  S.hands.reduce((a, h) => a + h.length, 0) +
  S.intel.reduce((a, z) => a + z.rel.length + z.unrel.length, 0) +
  S.discardUp.length + S.discardDown.length;

/* ---------------- 1 牌堆构成与配置 ---------------- */
sec('1 牌堆构成与配置规范化');
{
  const cases = [
    [{ colors: 4, one: false }, 56], [{ colors: 4, one: true }, 60],
    [{ colors: 5, one: false }, 70], [{ colors: 5, one: true }, 75],
  ];
  for (const [cfg, n] of cases) {
    const cs = G.combos(G.normCfg(cfg));
    expect('combos ' + cfg.colors + '色' + (cfg.one ? '含1' : '不含1') + ' = ' + n, cs.length === n && new Set(cs).size === n);
  }
  const c = G.normCfg({ colors: 9, one: 1, traitors: 99, extra: 9 });
  expect('越界配置被夹紧（色5/含1/叛徒11/额外3）', c.colors === 5 && c.one === true && c.traitors === 11 && c.extra === 3);
  expect('子弹 = 叛徒 + 额外（7+3=10 / 11+3=14）',
    G.bulletsOf(G.normCfg({})) === 10 && G.bulletsOf(G.normCfg({ traitors: 11, extra: 3 })) === 14);
  expect('牌库随人数缩水（4色7叛徒：2人 39 / 5人 24）',
    G.deckSizeOf(G.normCfg({ colors: 4, traitors: 7 }), 2) === 39 &&
    G.deckSizeOf(G.normCfg({ colors: 4, traitors: 7 }), 5) === 24);
  expect('difficultyOf 牌库读数与 deckSizeOf 同口径',
    [2, 3, 4, 5].every(n => G.difficultyOf({ colors: 5, one: true, traitors: 7 }, n).deck === G.deckSizeOf(G.normCfg({ colors: 5, one: true, traitors: 7 }), n)));
}

/* ---------------- 2 有关判定 ---------------- */
sec('2 有关 / 无关判定（与单机共用牌模型）');
{
  const mk = G.mk;
  const R = (a, b) => G.related(mk(a[0], a[1]), mk(b[0], b[1]));
  expect('同色 / 同数 / 倍数 / 因数 有关', R([0, 3], [0, 9]) && R([0, 7], [3, 7]) && R([0, 12], [3, 4]) && R([0, 4], [3, 12]));
  expect('无关（红3 vs 蓝10 / 红5 vs 蓝7 / 红8 vs 蓝9）', !R([0, 3], [3, 10]) && !R([0, 5], [3, 7]) && !R([0, 8], [3, 9]));
  expect('含1：1 只认同色/同数（异色异数无关、倍数关系不算）',
    R([0, 1], [0, 11]) && R([0, 1], [3, 1]) && !R([0, 1], [3, 11]) && !R([0, 11], [3, 1]));
}

/* ---------------- 3 开局 2~5 人 ---------------- */
sec('3 开局：2~5 人座位 / 手牌 / 叛徒区 / 守恒');
{
  for (let n = G.SEAT_MIN; n <= G.SEAT_MAX; n++) {
    const S = G.newGame({ colors: 4, one: false, traitors: 7, extra: 3 }, seatsOf(n), seeded(40 + n));
    const all = G.combos(S.cfg).length;
    expect(n + ' 人：手牌各 5 张', S.hands.length === n && S.hands.every(h => h.length === 5));
    expect(n + ' 人：叛徒区 = ' + 7, S.traitorPile.length === 7);
    expect(n + ' 人：牌库 = 56-7-5×' + n + ' = ' + (all - 7 - 5 * n), S.deck.length === all - 7 - 5 * n);
    expect(n + ' 人：盯梢位全空 · 情报区全空', S.watches.every(w => w === null) && S.intel.every(z => !z.rel.length && !z.unrel.length));
    expect(n + ' 人：先手在座内且 turnSeat 同步', S.firstSeat >= 0 && S.firstSeat < n && S.turnSeat === S.firstSeat && S.turnNo === 1 && S.round === 1);
    expect(n + ' 人：牌张守恒', conserved(S) === all);
    expect(n + ' 人：子弹 10 发（7+3）', S.bullets === 10 && S.bulletsMax === 10);
    expect(n + ' 人：validate 通过', G.validate(S));
    expect(n + ' 人：开局日志含人数', S.log.some(l => l.text.includes(n + ' 人协作')));
    expect(n + ' 人：座位名带序号', S.seats.every((s, i) => s.seatIndex === i && s.name === '玩家' + (i + 1)));
  }
  const A = G.newGame({ traitors: 7 }, seatsOf(3), seeded(9));
  const B = G.newGame({ traitors: 7 }, seatsOf(3), seeded(9));
  expect('同种子局面完全一致', JSON.stringify(A) === JSON.stringify(B));
  expect('不同种子先手/牌序可不同（非退化）', JSON.stringify(A) !== JSON.stringify(G.newGame({ traitors: 7 }, seatsOf(3), seeded(10))));
  expect('最多 5 人（第 6 个座位被截断）', G.newGame({ traitors: 7 }, seatsOf(6), seeded(1)).n === 5);
}

/* ---------------- 4 行动合法性（按座位） ---------------- */
sec('4 合法性：通讯不含自己 · 铲除仅面向他人盯梢 · 潜伏上限');
{
  const S = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(2024));
  S.turnSeat = 0;
  const a0 = G.legal(S, 0);
  expect('开局：可盯梢 · 不可情报/通讯/铲除（场上无盯梢）',
    a0.stake && !a0.intel && !a0.comm && !a0.eliminate && a0.commTargets.length === 0 && a0.elimTargets.length === 0);
  expect('潜伏上限 = min(3, 7-5, 牌库-1) = 2', a0.lurkMax === 2);
  G.stake(S, 0);                                   // 玩家 1 布控
  const a1 = G.legal(S, 1), a0b = G.legal(S, 0);
  expect('盯梢后：自己可情报 / 别人可通讯给他', a0b.intel && a1.comm);
  expect('通讯目标不含自己', a1.commTargets.includes(0) && !a0b.commTargets.includes(0));
  expect('铲除目标只含他人盯梢（自己的一人布控时不可铲除）',
    !a0b.eliminate && a0b.elimTargets.length === 0 &&
    a1.eliminate && a1.elimTargets.length === 1 && a1.elimTargets[0] === 0);
  G.stake(S, 1);                                   // 玩家 2 也布控
  const a2 = G.legal(S, 2);
  expect('两人布控后：通讯/铲除目标各 2 个', a2.commTargets.length === 2 && a2.elimTargets.length === 2);
  expect('0 号的铲除目标只剩 1 号（不含自己）', G.legal(S, 0).elimTargets.length === 1 && G.legal(S, 0).elimTargets[0] === 1);
  S.turnSeat = 0;
  const b0 = S.bullets;
  expect('铲除自己的盯梢目标被拒（不耗弹）',
    !G.eliminate(S, 0, 0, G.cOf(S.watches[0]), G.nOf(S.watches[0])).ok && S.bullets === b0);
  S.turnSeat = 2;
  expect('重复盯梢被拒', !G.stake(S, 0).ok);
  expect('错座位行动被拒（非当前行动方）', !G.intel(S, 1, 0).ok);
  S.pending = 'draw'; S.pendingSeat = 2;
  expect('子阶段中一切常规行动被拒', !G.stake(S, 2).ok && !G.intel(S, 0, 0).ok && !G.lurk(S, 0, 1).ok);
  S.pending = null; S.pendingSeat = null;
  expect('hasAction：可盯梢即有行动', G.hasAction(S, 2));
  const T = clone(S); T.traitorPile = []; T.watches = [null, null, null]; T.hands = [[], [], []];
  T.deck = [];
  expect('无盯梢无手牌无牌库无叛徒区 → 无行动', !G.hasAction(T, 0));
}

/* ---------------- 5 盯梢 / 情报 ---------------- */
sec('5 盯梢（随机抽 1 名 + 暗弃 1）与情报（打给自己目标）');
{
  const S = G.newGame({ traitors: 7, extra: 3 }, seatsOf(4), seeded(11));
  S.turnSeat = 0;
  const pile0 = S.traitorPile.slice(), deck0 = S.deck.length;
  const r = G.stake(S, 0);
  expect('盯梢成功且目标取自叛徒区', r.ok && S.traitorPile.length === 6 && pile0.includes(S.watches[0]) && !S.traitorPile.includes(S.watches[0]));
  expect('盯梢附带暗弃 1（牌库 -1 / 暗弃 +1）', S.deck.length === deck0 - 1 && S.discardDown.length === 1);
  expect('盯梢后轮到下一家', S.turnSeat === 1 && S.stat.stakes === 1);
  expect('盯梢事件流 stake+mill', r.evs[0].k === 'stake' && r.evs[1].k === 'mill');
  /* 情报：由 1 号玩家对自己目标打牌 */
  G.stake(S, 1);
  S.turnSeat = 1;                                  // 盯梢已换手，手动交回 1 号
  const hand0 = S.hands[1].length, card = S.hands[1][2];
  const zone = G.related(card, S.watches[1]) ? 'rel' : 'unrel';
  const ir = G.intel(S, 1, 2);
  expect('情报成功：手牌 -1 且入自己情报区', ir.ok && S.hands[1].length === hand0 - 1 && S.intel[1][zone].includes(card));
  expect('情报判定与 related 一致', S.intel[1].rel.length + S.intel[1].unrel.length === 1 && ir.evs[0].to === 1);
  expect('情报后轮到下一家（3 号）', S.turnSeat === 2 && S.stat.intels === 1);
  expect('无盯梢者的情报被拒', !G.intel(S, 2, 0).ok);
  S.turnSeat = 1;
  expect('越界下标被拒', !G.intel(S, 1, 99).ok);
  const U = clone(S); U.turnSeat = 0; U.watches[0] = null; U.traitorPile = [];
  expect('叛徒区空时不可盯梢', !G.stake(U, 0).ok && !G.legal(U, 0).stake);
}

/* ---------------- 6 通讯 + 摸牌子阶段 ---------------- */
sec('6 通讯：判定入他人情报区 + 摸牌选择子阶段（pending=draw）');
{
  const S = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(1234));
  S.turnSeat = 0;
  G.stake(S, 0);                                   // 0 号布控，供 1 号通讯
  S.turnSeat = 1;
  const deck0 = S.deck.length, hand0 = S.hands[1].length, card = S.hands[1][1];
  const zone = G.related(card, S.watches[0]) ? 'rel' : 'unrel';
  const r = G.comm(S, 1, 1, 0);
  expect('通讯成功：手牌 -1 且判定入目标情报区', r.ok && S.hands[1].length === hand0 - 1 && S.intel[0][zone].includes(card));
  expect('通讯后进入摸牌子阶段（pending=draw · pendingSeat=1）', S.pending === 'draw' && S.pendingSeat === 1);
  expect('摸牌前不换手（turnSeat 仍为通讯者）', S.turnSeat === 1);
  expect('通讯后牌库未动（摸牌为可选）', S.deck.length === deck0 && S.discardDown.length === 1);
  expect('子阶段中状态仍合法', G.validate(S));
  expect('错座位 / 无子阶段时 drawPick 被拒', !G.drawPick(S, 0, true).ok && !G.drawPick(S, 2, true).ok);
  /* 选择不摸 */
  const dr = G.drawPick(S, 1, false);
  expect('不摸：手牌/牌库不变 · 子阶段结束', dr.ok && S.hands[1].length === hand0 - 1 && S.deck.length === deck0 && S.pending === null);
  expect('不摸后换手（→ 2 号）', S.turnSeat === 2 && S.log.some(l => l.text.includes('不摸牌')));
  /* 选择摸 1 张 */
  const T = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(1235));
  T.turnSeat = 0; G.stake(T, 0);
  T.turnSeat = 1;
  const td = T.deck.length, th = T.hands[1].length;
  G.comm(T, 1, 0, 0);
  const tr = G.drawPick(T, 1, true);
  expect('摸 1 张：手牌回 ' + th + ' · 牌库 -1 · 事件含 draw',
    T.hands[1].length === th && T.deck.length === td - 1 && tr.evs.some(e => e.k === 'draw'));
  expect('摸牌后换手（→ 2 号）', T.turnSeat === 2 && T.pending === null);
  /* 日志全员可见：暗摸的牌面（色 + 数）不得写进日志，只记数量 */
  const drew = T.hands[1][T.hands[1].length - 1];
  const dl = T.log.filter(l => l.text.includes('从牌库摸到')).pop();
  expect('摸牌日志只记数量，不暴露摸到的牌面',
    !!dl && dl.text === G.nameOf(T, 1) + ' 从牌库摸到 1 张' && !T.log.some(l => l.text.includes(G.cardName(drew))));
  /* 通讯非法路径 */
  const U = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(1236));
  U.turnSeat = 0; G.stake(U, 0);
  U.turnSeat = 1;
  expect('通讯给自己被拒', !G.comm(U, 1, 0, 1).ok);
  expect('通讯给无盯梢者被拒', !G.comm(U, 1, 0, 2).ok);
  /* 牌库空：通讯直接收尾、无摸牌子阶段 */
  const V = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(1237));
  V.turnSeat = 0; G.stake(V, 0);
  V.turnSeat = 1; V.deck = [];
  const vr = G.comm(V, 1, 0, 0);
  expect('牌库空：通讯不进摸牌子阶段且直接换手', vr.ok && V.pending === null && V.turnSeat === 2);
  expect('牌库空提示入日志', V.log.some(l => l.text.includes('牌库已空')));
}

/* ---------------- 7 潜伏 ---------------- */
sec('7 潜伏：摸 1~3（上限钳制）→ 必暗弃 1');
{
  const S = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(77));
  S.turnSeat = 0;
  const d0 = S.deck.length;
  const r = G.lurk(S, 0, 3);
  expect('潜伏摸 2 张（手牌 5 → 上限 7）· 牌库 -3（2 摸 + 1 暗弃）',
    r.ok && S.hands[0].length === 7 && S.deck.length === d0 - 3 && S.discardDown.length === 1);
  expect('潜伏后换手', S.turnSeat === 1 && S.stat.lurks === 1);
  expect('潜伏事件流 draw+mill', r.evs[0].k === 'draw' && r.evs[1].k === 'mill');
  const T = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(78));
  T.turnSeat = 0;
  const tr = G.lurk(T, 0, 9);
  expect('摸牌数按上限钳制（请求 9 → 实摸 2）', tr.ok && T.hands[0].length === 7 && T.deck.length === G.combos(T.cfg).length - 7 - 15 - 3);
  const U = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(79));
  U.turnSeat = 0; U.deck = U.deck.slice(-1);
  expect('牌库 1 张：潜伏不可用（摸 k 须牌库 ≥ k+1）', !G.lurk(U, 0, 1).ok && G.legal(U, 0).lurkMax === 0);
  U.deck = [];
  expect('牌库空：潜伏不可用', !G.lurk(U, 0, 1).ok);
  const W = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(80));
  W.turnSeat = 0; W.hands[0] = W.hands[0].concat(W.deck.splice(0, 2));
  expect('手牌 7 张：潜伏不可用', W.hands[0].length === 7 && !G.lurk(W, 0, 1).ok && G.legal(W, 0).lurkMax === 0);
}

/* ---------------- 8 铲除：落空 / 命中 / 拾牌 ---------------- */
sec('8 铲除：落空耗弹 · 命中公示 + 情报清扫 + 叛徒洗回 + 拾牌子阶段');
{
  const S = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(55));
  S.turnSeat = 0; G.stake(S, 0);
  S.turnSeat = 1;
  const target = S.watches[0];
  const wc = (G.cOf(target) + 1) % 4, wn = G.nOf(target) === 15 ? 2 : 15;
  const mr = G.eliminate(S, 1, 0, wc, wn);
  expect('落空：子弹 -1 · 目标仍在 · 换手', mr.ok && !mr.hit && S.bullets === 9 && S.watches[0] === target && S.turnSeat === 2);
  expect('落空事件与日志', mr.evs.some(e => e.k === 'miss') && S.log.some(l => l.text.includes('落空')));
  expect('落空计入开枪数（1 号 1 枪 0 中 · 他人不受影响）',
    S.seatStat[1].shots === 1 && S.seatStat[1].hits === 0 && S.seatStat[0].shots === 0 && S.seatStat[2].shots === 0);
  /* 命中：0 号指认 1 号的目标（铲除不含自己的盯梢） */
  const T = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(56));
  T.turnSeat = 1; G.stake(T, 1);                   // 1 号布控（供 0 号铲除）
  T.turnSeat = 0;
  T.intel[1].rel.push(T.deck.pop());               // 铺两张 1 号情报区（清扫用）
  T.intel[1].unrel.push(T.deck.pop());
  T.discardUp.push(T.deck.pop());
  const tgt = T.watches[1];
  const intelN = T.intel[1].rel.length + T.intel[1].unrel.length;
  const up0 = T.discardUp.length;
  const hr = G.eliminate(T, 0, 1, G.cOf(tgt), G.nOf(tgt));
  expect('命中：子弹 -1 · 铲除 +1', hr.ok && hr.hit && T.bullets === 9 && T.caught === 1);
  expect('命中计入开枪与命中（0 号 1 枪 1 中 · 被铲目标的持有者不计）',
    T.seatStat[0].shots === 1 && T.seatStat[0].hits === 1 && T.seatStat[1].shots === 0 && T.seatStat[1].hits === 0);
  expect('命中：盯梢位清空 · 已铲除名单记牌', T.watches[1] === null && T.caughtCards.length === 1 && T.caughtCards[0] === tgt);
  expect('命中：情报区清扫进明弃堆', T.intel[1].rel.length === 0 && T.intel[1].unrel.length === 0 && T.discardUp.length === up0 + intelN);
  expect('命中：叛徒洗回牌库', T.deck.includes(tgt));
  expect('命中事件流 reveal/sweep/back', hr.evs.some(e => e.k === 'reveal') && hr.evs.some(e => e.k === 'sweep') && hr.evs.some(e => e.k === 'back'));
  expect('命中后进入拾牌子阶段（pending=reward · pendingSeat=0 · 不换手）',
    T.pending === 'reward' && T.pendingSeat === 0 && T.turnSeat === 0 && hr.reward && hr.reward.seat === 0);
  expect('命中后牌张守恒', conserved(T) === G.combos(T.cfg).length);
  expect('拾牌子阶段中常规行动被拒', !G.intel(T, 0, 0).ok && !G.lurk(T, 0, 1).ok);
  /* 拾牌：明弃 / 跳过 */
  const h0 = T.hands[0].length, upTop = T.discardUp[0];
  const pr = G.rewardPick(T, 0, 'up', 0);
  expect('明弃拾取：手牌 +1 · 明弃 -1 · 换手', pr.ok && T.hands[0].length === h0 + 1 && T.hands[0].includes(upTop) && T.discardUp.length === up0 + intelN - 1 && T.pending === null && T.turnSeat === 1);
  const V = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(57));
  V.turnSeat = 1; G.stake(V, 1);
  V.turnSeat = 0;
  const vt = V.watches[1];
  G.eliminate(V, 0, 1, G.cOf(vt), G.nOf(vt));
  expect('V 进入拾牌', V.pending === 'reward');
  const sr = G.rewardSkip(V, 0);
  expect('跳过后换手', sr.ok && V.pending === null && V.turnSeat === 1);
  const W = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(58));
  W.turnSeat = 1; G.stake(W, 1);
  W.turnSeat = 0;
  const wt = W.watches[1];
  G.eliminate(W, 0, 1, G.cOf(wt), G.nOf(wt));
  W.hands[0] = W.hands[0].concat(W.deck.splice(0, 7 - W.hands[0].length));
  expect('手牌 7 张：拾取被拒 · 跳过可用', !G.rewardPick(W, 0, 'up', 0).ok && G.rewardSkip(W, 0).ok);
  expect('无子阶段时 rewardSkip 被拒', !G.rewardSkip(V, 0).ok);
  /* 手牌满 + 无弃牌：命中不进入拾牌子阶段 */
  const X = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(59));
  X.turnSeat = 1; G.stake(X, 1);
  X.turnSeat = 0;
  X.hands[0] = X.hands[0].concat(X.deck.splice(0, 2));   // 手牌 7
  X.discardUp = []; X.discardDown = [];
  const xt = X.watches[1];
  G.eliminate(X, 0, 1, G.cOf(xt), G.nOf(xt));
  expect('手牌满且无弃牌：命中直接换手（无拾牌子阶段）', X.pending === null && X.turnSeat === 1);
}

/* ---------------- 9 胜负三条件 ---------------- */
sec('9 胜负：全歼胜 / 弹药负 / 死局负');
{
  /* 全歼：压到「最后一名叛徒」（0 号铲除 1 号的目标） */
  const S = G.newGame({ traitors: 7, extra: 3 }, seatsOf(2), seeded(88));
  S.turnSeat = 0; S.caught = 6; S.traitorPile = [];
  S.watches[1] = G.mk(1, 7);
  const r = G.eliminate(S, 0, 1, 1, 7);
  expect('最后一名叛徒：铲除即胜利', r.ok && r.hit && S.over && S.over.win && S.over.why === 'done');
  expect('胜利后不进入拾牌', S.pending === null);
  expect('胜利日志', S.log.some(l => l.text.includes('任务成功')));
  /* 弹药负：7 叛徒 + 0 额外 = 7 发；一次落空即负 */
  const T = G.newGame({ traitors: 7, extra: 0 }, seatsOf(3), seeded(99));
  T.turnSeat = 0; G.stake(T, 0);
  T.turnSeat = 1;
  expect('0 额外：子弹 = 7', T.bullets === 7);
  const wc = (G.cOf(T.watches[0]) + 1) % 4, wn = G.nOf(T.watches[0]) === 15 ? 2 : 15;
  G.eliminate(T, 1, 0, wc, wn);
  expect('落空后叛徒数 > 子弹数 → 失败', T.over && !T.over.win && T.over.why === 'bullets');
  expect('失败日志', T.log.some(l => l.text.includes('弹药告急')));
  expect('终局后状态仍合法', G.validate(T));
  /* 死局：命中清空盯梢后，若全场再无任何可行动 → 换手即负 */
  const U = G.newGame({ traitors: 7, extra: 3 }, seatsOf(3), seeded(66));
  U.turnSeat = 0; U.watches[1] = U.traitorPile.pop();
  U.intel[1].rel.push(U.deck.pop());
  G.eliminate(U, 0, 1, G.cOf(U.watches[1]), G.nOf(U.watches[1]));   // 命中 → pending=reward（此时场上无盯梢）
  expect('命中后进入拾牌（场上已无盯梢）', U.pending === 'reward');
  U.hands = [[], [], []]; U.deck = []; U.traitorPile = []; U.discardDown = [];
  G.rewardSkip(U, 0);                                              // 换手 → 1 号无任何行动
  expect('换手后接手方五类全不可用 → 死局失败', U.over && !U.over.win && U.over.why === 'stuck');
  expect('死局日志', U.log.some(l => l.text.includes('僵局')));
  expect('checkStuck / checkEnd 对终局幂等', G.checkStuck(U) && G.checkEnd(U));
  /* 胜利优先于弹药：最后一名 + 子弹耗尽的同一枪 */
  const V = G.newGame({ traitors: 7, extra: 3 }, seatsOf(2), seeded(68));
  V.turnSeat = 0; V.caught = 6; V.traitorPile = []; V.watches[1] = G.mk(0, 11); V.bullets = 1;
  const vr = G.eliminate(V, 0, 1, 0, 11);
  expect('最后一名 + 子弹归零 → 胜利优先', vr.hit && V.over && V.over.win && V.over.why === 'done');
}

/* ---------------- 10 公开候选分析 ---------------- */
sec('10 公开候选分析（推论板 / 按视角）');
{
  const S = G.newGame({ colors: 4, one: false, traitors: 7 }, seatsOf(3), seeded(202));
  S.turnSeat = 0; G.stake(S, 0); G.stake(S, 1);
  const a0 = G.analyze(S, 0, 0);
  expect('初始候选 = 全空间 ∖ 我的手牌', a0.cand.length === 56 - 5 && S.hands[0].every(id => a0.located.has(id)));
  expect('真相恒在候选内（自己目标 / 他人视角同样）', a0.cand.includes(S.watches[0]) && G.analyze(S, 0, 1).cand.includes(S.watches[0]));
  S.turnSeat = 2;
  G.comm(S, 2, 0, 0); G.drawPick(S, 2, false);       // 2 号通讯给 0 号目标
  S.turnSeat = 2;
  G.comm(S, 2, 0, 0); G.drawPick(S, 2, false);
  const a1 = G.analyze(S, 0, 0);
  expect('两次通讯后候选收窄且判定冲突非空', a1.cand.length < a0.cand.length && a1.judge.size > 0);
  expect('已知位置 = 手牌 + 全部情报区 + 明弃', [...S.intel[0].rel, ...S.intel[0].unrel].every(id => a1.located.has(id)));
  expect('候选 ∩ 已知位置 = ∅', a1.cand.every(id => !a1.located.has(id)));
  expect('auto=false 不做判定排除', G.analyze(S, 0, 0, false).judge.size === 0);
  expect('publicCandidates 与 analyze(auto) 同口径', G.publicCandidates(S, 0, 0).length === a1.cand.length);
}

/* ---------------- 11 validate ---------------- */
sec('11 状态校验 validate');
{
  for (let n = G.SEAT_MIN; n <= G.SEAT_MAX; n++) {
    expect(n + ' 人局面通过校验', G.validate(G.newGame({ traitors: 9, extra: 2 }, seatsOf(n), seeded(n))));
  }
  const S = G.newGame({ traitors: 7 }, seatsOf(3), seeded(303));
  expect('合法局面通过', G.validate(S));
  expect('坏 cfg 拒绝（色 3）', !G.validate({ ...clone(S), cfg: { colors: 3, one: false, traitors: 7, extra: 3 } }));
  expect('越界叛徒数拒绝', !G.validate({ ...clone(S), cfg: { colors: 4, one: false, traitors: 12, extra: 3 } }));
  expect('座位数越界拒绝（1 人 / 6 人）', !G.validate({ ...clone(S), seats: seatsOf(1), n: 1 }) && !G.validate({ ...clone(S), seats: seatsOf(6), n: 6 }));
  expect('手牌项非整数数组拒绝', !G.validate({ ...clone(S), hands: [[1], [2], [3, 'x']] }));
  expect('坏 pending 拒绝', !G.validate({ ...clone(S), pending: 'nope' }));
  expect('pending=draw / reward 通过', G.validate({ ...clone(S), pending: 'draw' }) && G.validate({ ...clone(S), pending: 'reward' }));
  expect('盯梢位非整数拒绝', !G.validate({ ...clone(S), watches: ['a', null, null] }));
  expect('缺情报区拒绝', (() => { const c = clone(S); delete c.intel; return !G.validate(c); })());
  expect('坏 over 拒绝', !G.validate({ ...clone(S), over: { win: 'yes' } }));
  expect('turnSeat 越界拒绝', !G.validate({ ...clone(S), turnSeat: 5 }));
}

/* ---------------- 12 2~5 人整局模拟 ---------------- */
sec('12 整局模拟：2~5 人协作（含不变量与守恒）');
{
  /* 代打策略：优先推进（作弊式看真相开枪，保证终局），其余随机；
     每步校验状态合法 + 牌张守恒 + 「已铲除 + 未铲除 = 叛徒总数」 */
  function sim(cfg, n, seed) {
    const rnd = seeded(seed);
    const S = G.newGame(cfg, seatsOf(n), rnd);
    const all = G.combos(S.cfg).length;
    let guard = 0, bad = null;
    const check = tag => {
      if (!G.validate(S)) return tag + ':validate';
      if (conserved(S) !== all) return tag + ':conservation ' + conserved(S) + '≠' + all;
      if (S.caught + G.traitorsLeft(S) !== S.cfg.traitors) return tag + ':tally ' + S.caught + '+' + G.traitorsLeft(S);
      if (S.pending && (S.pendingSeat == null || S.pendingSeat < 0 || S.pendingSeat >= S.n)) return tag + ':pendingSeat';
      if (!S.pending && S.pendingSeat !== null) return tag + ':pendingSeatStray';
      return null;
    };
    while (!S.over && guard++ < 4000) {
      bad = check('step' + guard);
      if (bad) break;
      const seat = S.turnSeat;
      if (S.pending === 'draw') { G.drawPick(S, seat, rnd() < 0.5); continue; }
      if (S.pending === 'reward') {
        const can = S.hands[seat].length < G.HAND_MAX;
        if (can && S.discardUp.length && rnd() < 0.6) G.rewardPick(S, seat, 'up', Math.floor(rnd() * S.discardUp.length));
        else if (can && S.discardDown.length && rnd() < 0.4) G.rewardPick(S, seat, 'down');
        else G.rewardSkip(S, seat);
        continue;
      }
      const a = G.legal(S, seat);
      const shoot = () => {
        const t = a.elimTargets[Math.floor(rnd() * a.elimTargets.length)];
        G.eliminate(S, seat, t, G.cOf(S.watches[t]), G.nOf(S.watches[t]));   // 看真相指认 → 必中
      };
      if (a.eliminate && rnd() < 0.5) { shoot(); continue; }
      if (a.lurkMax > 0 && (S.hands[seat].length < 2 || rnd() < 0.3)) { G.lurk(S, seat, 1 + Math.floor(rnd() * a.lurkMax)); continue; }
      if (a.stake) { G.stake(S, seat, rnd); continue; }
      if (a.intel) { G.intel(S, seat, Math.floor(rnd() * S.hands[seat].length)); continue; }
      if (a.comm) { G.comm(S, seat, Math.floor(rnd() * S.hands[seat].length), a.commTargets[Math.floor(rnd() * a.commTargets.length)]); continue; }
      if (a.eliminate) { shoot(); continue; }
      bad = 'step' + guard + ':noAction'; break;
    }
    if (!bad) bad = check('final');
    return { S, bad, steps: guard };
  }
  const lines = [];
  for (let n = 2; n <= 5; n++) {
    let win = 0, lostBullets = 0, lostStuck = 0, rounds = 0, worst = 0, allGood = true;
    const M = 60;
    for (let i = 1; i <= M; i++) {
      const { S, bad, steps } = sim({ colors: 4, one: false, traitors: 7, extra: 3 }, n, 4000 + i * 13 + n);
      if (bad) { allGood = false; console.log('    ✗ ' + n + ' 人第 ' + i + ' 局：' + bad); break; }
      if (!S.over) { allGood = false; console.log('    ✗ ' + n + ' 人第 ' + i + ' 局：未终局'); break; }
      if (S.over.win) win++; else if (S.over.why === 'bullets') lostBullets++; else lostStuck++;
      rounds += S.round; worst = Math.max(worst, steps);
    }
    expect(n + ' 人：60 局全部正常终局且不变量通过', allGood);
    lines.push('   ' + n + ' 人协作  胜 ' + win + '/60 · 弹药负 ' + lostBullets + ' · 僵局负 ' + lostStuck +
      ' · 均 ' + (rounds / M).toFixed(1) + ' 轮 · 最长 ' + worst + ' 步');
  }
  console.log('   平衡采样（代打 60 局/人数，配置 4色7叛徒+3弹）：');
  for (const l of lines) console.log(l);
  expect('平衡采样跑完无异常', lines.length === 4);
}

/* ---------------- 汇总 ---------------- */
console.log('\n断言: ' + ok + '/' + total);
if (fails.length) { console.log('失败项:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('ALL OK');
