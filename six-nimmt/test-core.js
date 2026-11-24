'use strict';
/* 《牛头王》规则引擎 + AI 单元测试（Node，无依赖）
   运行：node six-nimmt/test-core.js */

const SN = require('./game.js');
const AI = require('./ai.js');

let pass = 0;
const fails = [];

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + '：' : '') + '期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}
function deepEq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg ? msg + '：' : '') + '期望 ' + sb + '，实际 ' + sa);
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(threw, msg || '应当抛错');
}
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(name + ' → ' + (e && e.message ? e.message : e)); }
}

/* 手工造状态（用于精确构造规则场景；不参与 validate） */
function mk(rows, hands) {
  const players = hands.map(function (h, i) {
    return {
      seat: i, name: 'P' + i, ai: i !== 0, avatar: i,
      hand: h.slice(), selected: null, taken: [], score: 0, rowsTaken: 0
    };
  });
  return {
    v: 1, seed: 1, rngState: 0, phase: 'selecting', trick: 1,
    players: players,
    rows: rows.map(function (r, i) { return { index: i, cards: r.slice() }; }),
    unused: [], revealQueue: [], revealIndex: 0, pendingChoice: null,
    lastEvent: null, log: [], rev: 1, seq: 0,
    settings: { playerCount: players.length, aiCount: players.length - 1, difficulty: 'normal', seed: 1 }
  };
}
function pickAll(S, cards) {
  cards.forEach(function (c, seat) { SN.selectCard(S, seat, c); });
  return SN.beginReveal(S);
}
function resolveAll(S, chooseFn) {
  const evs = [];
  for (let guard = 0; guard < 40; guard++) {
    if (S.phase === 'revealing') evs.push(SN.resolveNext(S));
    else if (S.phase === 'chooseRow') {
      const pc = S.pendingChoice;
      evs.push(SN.chooseRow(S, pc.seat, chooseFn ? chooseFn(pc, S) : 0));
    } else break;
  }
  return evs;
}

/* ================= 1. 牛头值 ================= */

test('1. 牛头值单点', function () {
  eq(SN.bullsOf(1), 1, '1');
  eq(SN.bullsOf(5), 2, '5');
  eq(SN.bullsOf(10), 3, '10');
  eq(SN.bullsOf(11), 5, '11');
  eq(SN.bullsOf(55), 7, '55');
  eq(SN.bullsOf(100), 3, '100');
  eq(SN.bullsOf(104), 1, '104');
  eq(SN.bullsOf(45), 2, '45');
  eq(SN.bullsOf(99), 5, '99');
  eq(SN.bullsOf(50), 3, '50');
  eq(SN.bullsOf(15), 2, '15');
  eq(SN.rowBulls([55, 11, 10, 5, 1]), 7 + 5 + 3 + 2 + 1, 'rowBulls');
});

test('1b. 牛头值分布', function () {
  const cnt = { 1: 0, 2: 0, 3: 0, 5: 0, 7: 0 };
  let sum = 0;
  for (let c = 1; c <= 104; c++) { const b = SN.bullsOf(c); cnt[b] = (cnt[b] || 0) + 1; sum += b; }
  eq(cnt[1], 76, '1 牛头张数');
  eq(cnt[2], 9, '2 牛头张数');
  eq(cnt[3], 10, '3 牛头张数');
  eq(cnt[5], 8, '5 牛头张数');
  eq(cnt[7], 1, '7 牛头张数');
  eq(cnt[1] + cnt[2] + cnt[3] + cnt[5] + cnt[7], 104, '总张数');
  eq(sum, 171, '牛头总和');
});

/* ================= 2. 开局 ================= */

test('2. 2..10 人开局', function () {
  for (let n = 2; n <= 10; n++) {
    const S = SN.newGame({ playerCount: n, seed: 1000 + n, difficulty: 'normal' });
    eq(S.players.length, n, '人数');
    eq(S.phase, 'selecting', '阶段');
    eq(S.trick, 1, '首墩');
    eq(S.settings.playerCount, n, 'settings.playerCount');
    eq(S.settings.aiCount, n - 1, 'settings.aiCount');
    for (const p of S.players) {
      eq(p.hand.length, 10, '手牌数 seat' + p.seat);
      eq(p.avatar, p.seat, 'avatar');
      eq(p.ai, p.seat !== 0, 'ai 标记');
      eq(p.score, 0, '初始分');
      const sorted = p.hand.slice().sort(function (a, b) { return a - b; });
      deepEq(p.hand, sorted, '手牌升序');
    }
    eq(S.rows.length, 4, '4 行');
    for (let i = 0; i < 4; i++) { eq(S.rows[i].cards.length, 1, '起始行各 1 张'); eq(S.rows[i].index, i, '行号'); }
    for (let i = 1; i < 4; i++) {
      ok(S.rows[i - 1].cards[0] < S.rows[i].cards[0], '起始行按行尾升序 n=' + n);
    }
    eq(S.unused.length, 104 - 10 * n - 4, '未使用牌数 n=' + n);
    ok(S.revealQueue.length === 0 && S.revealIndex === 0 && S.pendingChoice === null, '初始队列/待选为空');
    eq(S.rev, 1, 'rev');
    eq(S.seq, 0, 'seq');
    const v = SN.validate(S);
    ok(v.ok, 'validate n=' + n + '：' + v.errs.join(';'));

    /* 所有在场牌互不重复 */
    const seen = {};
    const all = [];
    for (const p of S.players) for (const c of p.hand) all.push(c);
    for (const r of S.rows) for (const c of r.cards) all.push(c);
    for (const c of all) { ok(!seen[c], '牌重复 ' + c); seen[c] = 1; }
    eq(new Set(all).size, all.length, '无重复');
  }
});

test('2b. 开局参数钳制与种子复现', function () {
  const a = SN.newGame({ aiCount: 4, seed: 7 });
  eq(a.players.length, 5, 'aiCount=4 → 5 人');
  const b = SN.newGame({ aiCount: 99, seed: 7 });
  eq(b.players.length, 10, 'aiCount 上限');
  const c = SN.newGame({ playerCount: 1, seed: 7 });
  eq(c.players.length, 2, 'playerCount 下限');
  const d = SN.newGame({ playerCount: 42, seed: 7 });
  eq(d.players.length, 10, 'playerCount 上限');
  eq(d.settings.aiCount, 9, 'AI 数随之');
  const e = SN.newGame({ playerCount: 6, seed: 7 });
  const f = SN.newGame({ playerCount: 6, seed: 7 });
  deepEq(e.players.map(function (p) { return p.hand; }), f.players.map(function (p) { return p.hand; }), '同种子发牌一致');
  deepEq(e.rows, f.rows, '同种子行一致');
  eq(e.name, f.name, '无名');
  eq(e.seed, f.seed, '种子');
  eq(typeof e.rngState, 'number', 'rngState');
  const g = SN.newGame({ playerCount: 6, seed: 8 });
  ok(JSON.stringify(e.players[0].hand) !== JSON.stringify(g.players[0].hand), '不同种子发牌不同');
  eq(SN.newGame({ playerCount: 4, seed: 3 }).players[0].name, '你', '默认昵称');
  eq(SN.newGame({ playerCount: 4, seed: 3, humanName: '阿牛' }).players[0].name, '阿牛', '自定义昵称');
  const custom = SN.newGame({ playerCount: 3, seed: 3, aiNames: ['甲', '乙'] });
  eq(custom.players[1].name, '甲', '自定义 AI 名');
  eq(custom.players[2].name, '乙', '自定义 AI 名');
  eq(SN.AI_NAMES.length, 9, 'AI_NAMES 数量');
  eq(new Set(SN.AI_NAMES).size, 9, 'AI_NAMES 唯一');
});

/* ================= 3. 普通放置 ================= */

test('3. 放到“行尾小于它且最大”的行', function () {
  const S = mk([[10], [40], [70], [100]], [[50], [65]]);
  const q = pickAll(S, [50, 65]);
  deepEq(q, [{ seat: 0, card: 50 }, { seat: 1, card: 65 }], '按牌面升序亮牌');
  const e1 = SN.resolveNext(S);
  eq(e1.type, 'place', '类型');
  eq(e1.rowIndex, 1, '50 落在 40 那行');
  deepEq(S.rows[1].cards, [40, 50], '行内容');
  const e2 = SN.resolveNext(S);
  eq(e2.rowIndex, 1, '65 也落在这一行（行尾已变 50 — 但 70 更大）');
  deepEq(S.rows[1].cards, [40, 50, 65], '行内容 2');
  eq(S.phase, 'trickEnd', '一墩结束');
  eq(S.players[0].score, 0, '未收牌');
  eq(S.players[0].selected, null, '结算后清空已选');

  const S2 = mk([[10], [40], [70], [100]], [[45], [95]]);
  pickAll(S2, [45, 95]);
  eq(SN.resolveNext(S2).rowIndex, 1, '45 → 40 行');
  /* 45 落下后行尾变成 45，95 的最接近下界是 70，而不是 100 */
  eq(SN.resolveNext(S2).rowIndex, 2, '95 → 70 行');
  deepEq(S2.rows[2].cards, [70, 95], '行尾更新');
});

/* ================= 4. 行满 5 张，第 6 张收走 ================= */

test('4. 满行溢出收 5 张', function () {
  const S = mk([[10, 20, 30, 40, 50], [60], [70], [100]], [[55], [90]]);
  pickAll(S, [55, 90]);
  const ev = SN.resolveNext(S);
  eq(ev.type, 'take', '类型为 take');
  eq(ev.rowIndex, 0, '收第 0 行');
  eq(ev.bulls, 15, '牛头 3+3+3+3+3');
  deepEq(ev.took, [10, 20, 30, 40, 50], '收走的牌');
  eq(S.players[0].score, 15, '计分');
  eq(S.players[0].rowsTaken, 1, 'rowsTaken');
  deepEq(S.players[0].taken, [10, 20, 30, 40, 50], '收缴堆');
  deepEq(S.rows[0].cards, [55], '新行首');
  eq(S.rows[0].cards.length, 1, '行变回 1 张');
  const ev2 = SN.resolveNext(S);
  eq(ev2.type, 'place', '90 正常落下（新行首 55 < 70）');
  eq(ev2.rowIndex, 2, '90 落在 70 那行');
  eq(S.phase, 'trickEnd', '一墩结束');

  /* 满行收走后阶段仍是 revealing（队列未走完） */
  const S3 = mk([[10, 20, 30, 40, 50], [60], [70], [100]], [[55], [56]]);
  pickAll(S3, [55, 56]);
  const e4 = SN.resolveNext(S3);
  eq(e4.queueDone, false, '收行后队列未走完');
  eq(S3.phase, 'revealing', '继续 revealing');
  const e5 = SN.resolveNext(S3);
  eq(e5.type, 'place', '56 落到新行首 55 那行');
  eq(e5.rowIndex, 0, '行 0');
  eq(e5.queueDone, true, '队列走完');
  eq(S3.phase, 'trickEnd', '一墩结束');
});

/* ================= 5. 比所有行尾都小 → 选行 ================= */

test('5. 选行收 1..5 张', function () {
  const S = mk([[40], [45, 50], [60], [70]], [[10], [90]]);
  pickAll(S, [10, 90]);
  const ev = SN.resolveNext(S);
  eq(ev.type, 'choice', '进入选行');
  eq(S.phase, 'chooseRow', '阶段');
  throws(function () { SN.resolveNext(S); }, 'chooseRow 阶段 resolveNext 应抛错');
  throws(function () { SN.chooseRow(S, 1, 0); }, '非本人选行应抛错');
  throws(function () { SN.chooseRow(S, 0, 4); }, '行号越界应抛错');
  throws(function () { SN.chooseRow(S, 0, 1.5); }, '非整数行号应抛错');
  eq(S.pendingChoice.seat, 0, 'pendingChoice.seat');
  eq(S.pendingChoice.card, 10, 'pendingChoice.card');
  deepEq(S.pendingChoice.options, [0, 1, 2, 3], 'options');

  const ev2 = SN.chooseRow(S, 0, 1);
  eq(ev2.type, 'take', '选行结算');
  eq(ev2.viaChoice, true, 'viaChoice');
  eq(ev2.bulls, 5, '45(2) + 50(3)');
  deepEq(S.players[0].taken, [45, 50], '收走 2 张');
  eq(S.players[0].score, 5, '分数');
  eq(S.players[0].rowsTaken, 1, 'rowsTaken');
  deepEq(S.rows[1].cards, [10], '新行首为打出的牌');
  eq(S.pendingChoice, null, '清除 pendingChoice');
  eq(S.phase, 'revealing', '回到 revealing');
  const ev3 = SN.resolveNext(S);
  eq(ev3.type, 'place', '90 正常放置');
  eq(S.phase, 'trickEnd', '结束');

  const S2 = mk([[40], [45, 50], [60], [70]], [[10], [90]]);
  pickAll(S2, [10, 90]);
  SN.resolveNext(S2);
  const ev4 = SN.chooseRow(S2, 0, 3);
  eq(ev4.bulls, 3, '70 → 3');
  deepEq(S2.players[0].taken, [70], '收走 1 张');
  deepEq(S2.rows[3].cards, [10], '行 3 重置');
  eq(S2.players[0].score, 3, '分数');
});

/* ================= 6. 同墩多次选行，按升序依次处理 ================= */

test('6. 同墩多人选行按升序且互相影响', function () {
  const S = mk([[40], [50], [60], [70]], [[5], [8], [3]]);
  pickAll(S, [5, 8, 3]);
  const ev1 = SN.resolveNext(S);
  eq(ev1.type, 'choice', '最小牌 3 先选行');
  eq(ev1.seat, 2, '由座位 2 选');
  SN.chooseRow(S, 2, 3);                    /* 收走 70，行 3 变 [3] */
  deepEq(S.rows[3].cards, [3], '行 3 重置为 3');
  eq(S.players[2].score, 3, '70 的 3 个牛头');
  const ev2 = SN.resolveNext(S);
  eq(ev2.type, 'place', '之后 5 不再需要选行');
  eq(ev2.seat, 0, '座位 0');
  eq(ev2.rowIndex, 3, '因为出现了行尾 3');
  deepEq(S.rows[3].cards, [3, 5], '接在 3 后');
  const ev3 = SN.resolveNext(S);
  eq(ev3.rowIndex, 3, '8 也接这一行');
  deepEq(S.rows[3].cards, [3, 5, 8], '行内容');
  eq(S.phase, 'trickEnd', '结束');
  eq(S.players[0].score + S.players[1].score, 0, '其他人未收牌');
});

/* ================= 7. 升序结算：收行改变后续牌的目标 ================= */

test('7. 收行改变后续牌的目标行', function () {
  const S = mk([[90], [95], [100], [103]], [[5], [98]]);
  pickAll(S, [5, 98]);
  /* 若没有前一张收行，98 会落到行尾 95 的行 1 */
  const probe = [90, 95, 100, 103];
  eq(SN.simulatePlacement([[90], [95], [100], [103]], 98).rowIndex, 1, '基准：98 → 行 1');
  ok(probe.length === 4, 'probe');
  const ev1 = SN.resolveNext(S);
  eq(ev1.type, 'choice', '5 比所有行尾都小');
  SN.chooseRow(S, 0, 1);                    /* 收走 95，行 1 变 [5] */
  eq(S.players[0].score, 2, '95 → 2 个牛头');
  const ev2 = SN.resolveNext(S);
  eq(ev2.type, 'place', '98 变成普通放置');
  eq(ev2.rowIndex, 0, '目标行由 1 变成 0（行尾 90）');
  deepEq(S.rows[0].cards, [90, 98], '行 0 接上 98');
});

/* ================= 8. 计分累计与 rowsTaken ================= */

test('8. 一墩内多次收牌计分', function () {
  const S = mk([[10, 20, 30, 40, 50], [60, 61, 62, 63, 64], [70], [100]], [[55], [66]]);
  pickAll(S, [55, 66]);
  const e1 = SN.resolveNext(S);
  eq(e1.type, 'take', '第一张收行 0');
  eq(e1.bulls, 15, '行 0 牛头');
  const e2 = SN.resolveNext(S);
  eq(e2.type, 'take', '第二张收行 1');
  eq(e2.bulls, 7, '60..64 = 3+1+1+1+1');
  eq(S.players[0].score, 15, '座位 0 分数');
  eq(S.players[1].score, 7, '座位 1 分数');
  eq(S.players[0].rowsTaken, 1, '座位 0 rowsTaken');
  eq(S.players[1].rowsTaken, 1, '座位 1 rowsTaken');
  eq(S.players[0].taken.length, 5, '座位 0 收 5 张');
  eq(S.players[1].taken.length, 5, '座位 1 收 5 张');
  deepEq(S.rows[0].cards, [55], '行 0 新行首');
  deepEq(S.rows[1].cards, [66], '行 1 新行首');
  eq(S.phase, 'trickEnd', '结束');
  eq(SN.validate(S).ok, false, '手工状态不应通过全量校验（牌数不为 104）');
});

/* ================= 9. 10 墩推进与终局 ================= */

test('9. 10 墩打完终局，每人打满 10 张', function () {
  const S = SN.newGame({ playerCount: 3, seed: 4242 });
  const played = [0, 0, 0];
  for (let k = 1; k <= 10; k++) {
    eq(S.phase, 'selecting', '第 ' + k + ' 墩开始阶段');
    eq(S.trick, k, '墩号');
    for (const p of S.players) {
      const c = Math.min.apply(null, p.hand);
      SN.selectCard(S, p.seat, c);
      played[p.seat] += 1;
    }
    ok(SN.allSelected(S), '全部已选');
    SN.beginReveal(S);
    eq(S.revealQueue.length, 3, '亮牌队列长度');
    resolveAll(S, function () { return 0; });
    eq(S.phase, 'trickEnd', '第 ' + k + ' 墩结束');
    ok(SN.validate(S).ok, '第 ' + k + ' 墩 validate：' + SN.validate(S).errs.join(';'));
    const ev = SN.startNextTrick(S);
    if (k < 10) {
      eq(ev.type, 'trickStart', '继续下一墩');
      eq(S.trick, k + 1, '墩号 +1');
      eq(S.phase, 'selecting', '回到选牌');
      for (const p of S.players) eq(p.selected, null, 'selected 清空');
    } else {
      eq(ev.type, 'gameEnd', '终局');
      ok(SN.isGameOver(S), 'isGameOver');
      throws(function () { SN.startNextTrick(S); }, '终局后不能继续');
    }
  }
  deepEq(played, [10, 10, 10], '每人 10 张');
  for (const p of S.players) { eq(p.hand.length, 0, '手牌已空'); }
  eq(S.phase, 'gameEnd', '最终阶段');
  ok(SN.validate(S).ok, '终局 validate：' + SN.validate(S).errs.join(';'));
});

/* ================= 10. 排名 ================= */

test('10. 排名 / 最低分获胜 / 并列共享', function () {
  const S = SN.newGame({ playerCount: 3, seed: 99 });
  S.players[0].score = 12;
  S.players[1].score = 5;
  S.players[2].score = 5;
  S.players[0].rowsTaken = 3; S.players[0].taken = [1, 5, 55];
  S.players[1].rowsTaken = 1; S.players[1].taken = [10];
  const r = SN.rankings(S);
  deepEq(r.winners, [1, 2], '并列最低获胜');
  eq(r.order.length, 3, '顺序长度');
  deepEq(r.order.map(function (e) { return e.seat; }), [1, 2, 0], '按分数升序、同分按座位');
  eq(r.order[0].rank, 1, 'rank1');
  eq(r.order[1].rank, 1, '并列 rank1');
  eq(r.order[2].rank, 3, 'rank3');
  eq(r.order[0].winner, true, 'winner');
  eq(r.order[2].winner, false, '非 winner');
  eq(r.order[0].shared, true, 'shared');
  eq(r.order[2].shared, false, 'not shared');
  eq(r.order[0].takenCount, 1, 'takenCount');
  eq(r.order[0].rowsTaken, 1, 'rowsTaken');
  eq(typeof r.order[0].name, 'string', 'name');
  eq(r.order[0].ai, true, 'ai 标记');

  const S2 = SN.newGame({ playerCount: 2, seed: 99 });
  S2.players[0].score = 9; S2.players[1].score = 4;
  const r2 = SN.rankings(S2);
  deepEq(r2.winners, [1], '单人获胜');
  eq(r2.order[0].seat, 1, '胜者座位');
  eq(r2.order[0].shared, false, '非共享');

  const S3 = SN.newGame({ playerCount: 2, seed: 99 });
  S3.players[0].score = 0; S3.players[1].score = 0;
  const r3 = SN.rankings(S3);
  deepEq(r3.winners, [0, 1], '全并列');
  eq(r3.order[0].shared && r3.order[1].shared, true, '都 shared');
});

/* ================= 11. 序列化 ================= */

test('11. 序列化/反序列化/哈希', function () {
  const S = SN.newGame({ playerCount: 5, seed: 2024, difficulty: 'hard' });
  SN.selectCard(S, 0, S.players[0].hand[3]);
  const str = SN.serialize(S);
  const T = SN.deserialize(str);
  eq(SN.stateHash(T), SN.stateHash(S), '哈希一致');
  deepEq(T, S, '内容一致');
  eq(SN.deserialize(SN.serialize(T)).players[0].selected, S.players[0].selected, '已选牌保留');
  const h1 = SN.stateHash(S);
  S.players[1].selected = null;
  S.rev += 1;
  ok(SN.stateHash(S) !== h1, '状态变化后哈希变化');
  eq(SN.stateHash('abc'), SN.stateHash('abc'), '同输入同哈希');
  ok(/^[0-9a-f]{8}$/.test(h1), '哈希格式');
  eq(typeof SN.clone(S).players[0].hand[0], 'number', 'clone');
});

/* ================= 12. validate 捕获损坏 ================= */

test('12. validate 捕获重复牌/错分/越界', function () {
  const base = SN.newGame({ playerCount: 4, seed: 77 });
  ok(SN.validate(base).ok, '正常状态应通过：' + SN.validate(base).errs.join(';'));

  const d1 = SN.clone(base);
  d1.players[0].hand[0] = d1.players[0].hand[1];
  ok(!SN.validate(d1).ok, '重复手牌应被发现');

  const d2 = SN.clone(base);
  d2.players[1].score = 99;
  ok(!SN.validate(d2).ok, '错误分数应被发现');

  const d3 = SN.clone(base);
  d3.rows[0].cards.push(999);
  ok(!SN.validate(d3).ok, '越界牌应被发现');

  const d4 = SN.clone(base);
  d4.rows[0].cards.push(d4.unused[0]);
  ok(!SN.validate(d4).ok, '重复出场牌应被发现');

  const d5 = SN.clone(base);
  d5.phase = 'lobby';
  ok(!SN.validate(d5).ok, '非法阶段应被发现');

  const d6 = SN.clone(base);
  d6.players[0].selected = d6.players[0].hand.pop();
  d6.players[1].selected = d6.players[0].selected;
  d6.players[1].hand = d6.players[1].hand.filter(function (c) { return c !== d6.players[0].selected; });
  ok(!SN.validate(d6).ok, '重复已选牌应被发现');

  const d7 = SN.clone(base);
  d7.rows[0].cards = [];
  ok(!SN.validate(d7).ok, '空行应被发现');

  const d8 = SN.clone(base);
  d8.phase = 'chooseRow';
  ok(!SN.validate(d8).ok, 'chooseRow 缺少 pendingChoice 应被发现');

  const d9 = SN.clone(base);
  d9.revealIndex = 3;
  d9.revealQueue = [{ seat: 0, card: 1 }];
  ok(!SN.validate(d9).ok, 'revealIndex 越界应被发现');
});

/* ================= 13. AI 合法性与确定性 ================= */

test('13. AI 出牌合法且可复现', function () {
  const diffs = ['easy', 'normal', 'hard'];
  for (const d of diffs) {
    const S = SN.newGame({ playerCount: 6, seed: 555 + d.length, difficulty: d });
    for (const p of S.players) {
      const view = SN.viewFor(S, p.seat);
      const c1 = AI.chooseCard(view, d, SN.seeded(12345));
      const c2 = AI.chooseCard(view, d, SN.seeded(12345));
      eq(c1, c2, d + ' 同 view 同种子结果一致');
      ok(typeof c1 === 'number' && view.hand.indexOf(c1) >= 0, d + ' 必须返回手牌中的牌');
      ok(typeof AI.lastReason === 'object', 'lastReason');
      const r1 = AI.chooseRow({ rows: view.rows, pendingChoice: { seat: p.seat, card: 1, options: [0, 1, 2, 3] } }, d, SN.seeded(9));
      const r2 = AI.chooseRow({ rows: view.rows, pendingChoice: { seat: p.seat, card: 1, options: [0, 1, 2, 3] } }, d, SN.seeded(9));
      eq(r1, r2, d + ' 选行可复现');
      ok(r1 === 0 || r1 === 1 || r1 === 2 || r1 === 3, d + ' 选行合法');
    }
  }
  /* 每种难度、每一种手牌大小都要合法 */
  for (const d of diffs) {
    const S = SN.newGame({ playerCount: 4, seed: 31, difficulty: d });
    for (let k = 0; k < 10; k++) {
      const rng = SN.seeded(1000 + k);
      for (const p of S.players) {
        const view = SN.viewFor(S, p.seat);
        if (!p.hand.length) continue;
        const c = AI.chooseCard(view, d, rng);
        ok(view.hand.indexOf(c) >= 0, d + ' 手牌数 ' + view.hand.length + ' 时仍合法');
      }
      for (const p of S.players) SN.selectCard(S, p.seat, AI.chooseCard(SN.viewFor(S, p.seat), d, SN.seeded(77 + k)));
      SN.beginReveal(S);
      resolveAll(S);
      SN.startNextTrick(S);
    }
  }
  /* 空手牌 / 缺省视图不崩 */
  eq(AI.chooseCard({ hand: [], rows: [] }, 'hard', SN.seeded(1)), null, '空手返回 null');
  const c0 = AI.chooseCard({ hand: [7], rows: [] }, 'normal', SN.seeded(1));
  eq(c0, 7, '无行时仍返回手牌');
});

test('13b. AI 只依赖视图（不含隐藏信息）', function () {
  /* 两个信息完全相同、但“真实状态”不同的视图，AI 必须给出相同结果 */
  const v1 = { me: 0, trick: 1, phase: 'selecting', hand: [12, 40, 77], rows: [[10, 20], [30], [60], [90]], players: [], taken: [[], [], []], pendingChoice: null };
  const v2 = JSON.parse(JSON.stringify(v1));
  eq(AI.chooseCard(v1, 'hard', SN.seeded(3)), AI.chooseCard(v2, 'hard', SN.seeded(3)), '同视图同结果');
  eq(AI.chooseRow({ rows: v1.rows, pendingChoice: { seat: 0, card: 9, options: [0, 1, 2, 3] } }, 'hard', SN.seeded(3)),
     AI.chooseRow({ rows: v2.rows, pendingChoice: { seat: 0, card: 9, options: [0, 1, 2, 3] } }, 'hard', SN.seeded(3)), '选行同结果');
});

/* ================= 14. 视图隐私 ================= */

function numbersIn(x, out) {
  out = out || [];
  if (typeof x === 'number') out.push(x);
  else if (Array.isArray(x)) for (const v of x) numbersIn(v, out);
  else if (x && typeof x === 'object') for (const k in x) numbersIn(x[k], out);
  return out;
}

test('14. viewFor 不泄露他人手牌/已选/unused', function () {
  const S = SN.newGame({ playerCount: 5, seed: 808 });
  const own = S.players[0].hand.slice();
  /* 全员选牌，但仍处于 selecting 阶段 */
  const picks = [];
  for (const p of S.players) {
    const c = p.hand[p.hand.length - 1];
    picks.push(c);
    SN.selectCard(S, p.seat, c);
  }
  const view = SN.viewFor(S, 0);
  deepEq(view.hand, S.players[0].hand, '只有自己的手牌');
  eq(view.me, 0, 'me');
  eq(view.trick, 1, 'trick');
  eq(view.phase, 'selecting', 'phase');
  eq(view.rows.length, 4, 'rows');
  eq(view.players.length, 5, 'players');
  eq(view.taken.length, 5, 'taken 逐座位');
  eq(view.pendingChoice, null, 'pendingChoice');
  ok(!Object.prototype.hasOwnProperty.call(view, 'unused'), '不能有 unused');
  ok(!Object.prototype.hasOwnProperty.call(view, 'seed'), '不能有 seed');
  ok(!Object.prototype.hasOwnProperty.call(view, 'rngState'), '不能有 rngState');
  for (const pv of view.players) {
    ok(!Object.prototype.hasOwnProperty.call(pv, 'hand'), '玩家视图不含 hand');
    ok(!Object.prototype.hasOwnProperty.call(pv, 'selected'), '玩家视图不含 selected');
    eq(typeof pv.handCount, 'number', 'handCount');
    eq(typeof pv.selectedFlag, 'boolean', 'selectedFlag');
  }
  eq(view.players[0].selectedFlag, true, '自己已选');
  /* 他人已选牌面不得出现在视图里的任何数字中 */
  const rowCards = [];
  for (const r of S.rows) for (const c of r.cards) rowCards.push(c);
  const leaks = picks.slice(1).filter(function (c) {
    return c > 10 && c !== 104 && own.indexOf(c) < 0 && rowCards.indexOf(c) < 0;
  });
  const nums = numbersIn(view);
  for (const c of leaks) ok(nums.indexOf(c) < 0, '泄露了他人已选牌 ' + c);
  /* 他人手牌也不得出现 */
  for (let s = 1; s < S.players.length; s++) {
    for (const c of S.players[s].hand) {
      if (c > 10 && c !== 104 && own.indexOf(c) < 0 && rowCards.indexOf(c) < 0) {
        ok(nums.indexOf(c) < 0, '泄露了座位 ' + s + ' 的手牌 ' + c);
      }
    }
  }
  /* 选行阶段只有当事者能看到 pendingChoice */
  const S2 = mk([[40], [50], [60], [70]], [[10], [90]]);
  pickAll(S2, [10, 90]);
  SN.resolveNext(S2);
  eq(SN.viewFor(S2, 0).pendingChoice.seat, 0, '本人可见 pendingChoice');
  eq(SN.viewFor(S2, 1).pendingChoice, null, '他人不可见 pendingChoice');
});

/* ================= 15/16. 全自动整局 ================= */

function playFullGame(total, difficulty, seed) {
  const S = SN.newGame({ playerCount: total, seed: seed, difficulty: difficulty });
  let v = SN.validate(S);
  ok(v.ok, '开局 validate：' + v.errs.join(';'));
  const rng = SN.seeded((seed ^ 0x9e3779b9) >>> 0);
  const played = new Array(total).fill(0);
  let tricksSeen = 0;
  let guard = 0;

  while (!SN.isGameOver(S)) {
    if (++guard > 4000) throw new Error('疑似死循环（阶段 ' + S.phase + '）');
    if (S.phase === 'selecting') {
      for (const p of S.players) {
        const view = SN.viewFor(S, p.seat);          /* 人类座位同样交给 AI 驱动 */
        const c = AI.chooseCard(view, difficulty, rng);
        ok(view.hand.indexOf(c) >= 0, 'AI 出了不在手牌里的牌');
        SN.selectCard(S, p.seat, c);
        played[p.seat] += 1;
      }
      ok(SN.allSelected(S), '全部已选');
      const q = SN.beginReveal(S);
      eq(q.length, total, '亮牌队列长度');
      for (let i = 1; i < q.length; i++) ok(q[i - 1].card < q[i].card, '亮牌升序');
    } else if (S.phase === 'revealing') {
      const ev = SN.resolveNext(S);
      ok(ev.type === 'place' || ev.type === 'take' || ev.type === 'trickEnd' || ev.type === 'choice',
        '结算事件类型 ' + ev.type);
      if (ev.type === 'choice') eq(S.phase, 'chooseRow', '选行事件后进入 chooseRow');
    } else if (S.phase === 'chooseRow') {
      const seat = S.pendingChoice.seat;
      const view = SN.viewFor(S, seat);
      ok(view.pendingChoice !== null, '选行者应看到 pendingChoice');
      const row = AI.chooseRow(view, difficulty, rng);
      ok(row === 0 || row === 1 || row === 2 || row === 3, '选行合法');
      const ev = SN.chooseRow(S, seat, row);
      eq(ev.viaChoice, true, 'viaChoice');
    } else if (S.phase === 'trickEnd') {
      tricksSeen += 1;
      const ev = SN.startNextTrick(S);
      if (tricksSeen < 10) eq(ev.type, 'trickStart', '下一墩');
      else eq(ev.type, 'gameEnd', '第 10 墩后终局');
    } else {
      throw new Error('意外阶段 ' + S.phase);
    }

    v = SN.validate(S);
    ok(v.ok, '对局中 validate：' + v.errs.join(';'));
    for (const p of S.players) {
      ok(p.score >= 0, '分数非负');
      eq(p.score, SN.rowBulls(p.taken), '分数等于收缴牛头');
    }
    eq(S.revealIndex <= S.revealQueue.length, true, 'revealIndex 不越界');
  }

  eq(tricksSeen, 10, '正好 10 墩');
  eq(S.trick, 10, '终局墩号');
  eq(S.phase, 'gameEnd', '终局阶段');
  deepEq(played, new Array(total).fill(10), '每人正好打 10 张');
  for (const p of S.players) eq(p.hand.length, 0, '手牌打空');
  const rank = SN.rankings(S);
  eq(rank.order.length, total, '排名长度');
  ok(rank.order[0].score <= rank.order[total - 1].score, '排名按分数升序');
  ok(rank.winners.length >= 1, '至少一个胜者');
  return S;
}

test('15. 3..10 人全自动整局（normal）', function () {
  for (let n = 3; n <= 10; n++) {
    const S = playFullGame(n, 'normal', 3000 + n);
    const rows = S.rows.map(function (r) { return r.cards.length; });
    for (const len of rows) ok(len >= 1 && len <= 5, '行长度始终 1..5');
  }
});

test('15b. 2..10 人全自动整局（easy/hard 抽样）', function () {
  const samples = [[2, 'easy'], [3, 'hard'], [5, 'easy'], [7, 'hard'], [9, 'normal'], [10, 'easy'], [10, 'hard']];
  for (const sm of samples) {
    playFullGame(sm[0], sm[1], 7100 + sm[0] * 3 + sm[1].length);
  }
});

test('16. 人类座位也由 AI 驱动：2 人与 10 人边界', function () {
  const two = playFullGame(2, 'hard', 424242);
  eq(two.players.length, 2, '2 人');
  eq(two.players[0].ai, false, '座位 0 是“人”');
  eq(two.players[0].hand.length, 0, '人类手牌也打空');
  const ten = playFullGame(10, 'normal', 434343);
  eq(ten.players.length, 10, '10 人');
  eq(ten.unused.length, 0, '10 人时没有未使用牌');
  eq(ten.players.map(function (p) { return p.taken.length; }).reduce(function (a, b) { return a + b; }, 0) +
     ten.rows.reduce(function (a, r) { return a + r.cards.length; }, 0), 104, '所有牌各归其位');
});

/* ================= 17. simulatePlacement 边界 ================= */

test('17. simulatePlacement 边界', function () {
  const rows = [[10], [40], [70], [100]];
  const lower = SN.simulatePlacement(rows, 5);
  eq(lower.mustChoose, true, '比所有行尾都小');
  deepEq(lower.options, [0, 1, 2, 3], 'options');

  const norm = SN.simulatePlacement(rows, 45);
  ok(!norm.mustChoose, '非选行');
  eq(norm.rowIndex, 1, '行 1');
  eq(norm.full, false, '未满');
  deepEq(norm.took, [], '无收缴');
  eq(norm.bulls, 0, '无牛头');
  ok(!('mustChoose' in norm), '正常放置不返回 mustChoose');

  const full = SN.simulatePlacement([[10, 20, 30, 40, 50], [60], [70], [100]], 55);
  eq(full.rowIndex, 0, '满行行号');
  eq(full.full, true, '满行');
  eq(full.bulls, 15, '满行牛头');
  deepEq(full.took, [10, 20, 30, 40, 50], '满行收 5 张');

  eq(SN.simulatePlacement(rows, 104).rowIndex, 3, '最大牌');
  eq(SN.simulatePlacement(rows, 101).full, false, '100 行未满');
  /* 也接受状态里的 {index,cards} 行结构 */
  const objRows = rows.map(function (r, i) { return { index: i, cards: r }; });
  eq(SN.simulatePlacement(objRows, 45).rowIndex, 1, '对象行结构');
  /* 变长行：只有行尾比较 */
  eq(SN.simulatePlacement([[10, 90], [95], [96], [97]], 92).rowIndex, 0, '行尾 90 最接近');
});

/* ================= 附：非法动作 / 日志 / 时钟 ================= */

test('附. 选牌合法性、日志、rev/seq', function () {
  const S = SN.newGame({ playerCount: 3, seed: 606 });
  throws(function () { SN.selectCard(S, 0, S.players[1].hand[0]); }, '不能选别人的牌');
  throws(function () { SN.selectCard(S, 5, 1); }, '非法座位');
  throws(function () { SN.beginReveal(S); }, '未全部选牌不能亮牌');
  throws(function () { SN.resolveNext(S); }, 'selecting 阶段不能结算');
  throws(function () { SN.startNextTrick(S); }, 'selecting 阶段不能开下一墩');

  const card = S.players[0].hand[0];
  const rev0 = S.rev, seq0 = S.seq;
  SN.selectCard(S, 0, card);
  eq(S.rev, rev0 + 1, 'rev +1');
  eq(S.seq, seq0 + 1, 'seq +1');
  eq(S.players[0].selected, card, 'selected');
  ok(S.players[0].hand.indexOf(card) < 0, '已从手牌移除');
  const lastLog = S.log[S.log.length - 1];
  eq(lastLog.type, 'select', '日志类型');
  eq(lastLog.seat, 0, '日志座位');
  ok(!Object.prototype.hasOwnProperty.call(lastLog, 'card'), '日志不暴露牌面');
  throws(function () { SN.selectCard(S, 0, S.players[0].hand[0]); }, '不能重复选牌');
  eq(S.log.length, 1, '日志条数');
});

test('附. 日志上限 200 条', function () {
  const S = mk([[10], [40], [70], [100]], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 11], [12, 13, 14, 15, 16, 17, 18, 19, 21, 22]]);
  S.revealQueue = [];
  for (let i = 0; i < 260; i++) {
    S.phase = 'selecting';
    S.players[0].selected = null;
    SN.selectCard(S, 0, S.players[0].hand[0]);
    S.players[0].selected = null;
    S.players[0].hand.push(90 + (i % 10));
  }
  ok(S.log.length <= 200, '日志不超过 200 条');
  eq(S.log.length, 200, '日志被裁剪到 200');
  eq(S.log[S.log.length - 1].seq, S.seq, '最后一条与 seq 对齐');
});

/* ================= 汇总 ================= */

const totalChecks = pass + fails.length;
console.log('');
console.log('PASS ' + pass + ' / FAIL ' + fails.length + '（共 ' + totalChecks + ' 组）');
if (fails.length) {
  console.log('');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('  全部通过');
}