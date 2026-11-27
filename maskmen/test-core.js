'use strict';
/* 《面具摔跤手》规则引擎测试：node test-core.js */
const M = require('./game.js');

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) { passed++; return true; }
  failed++;
  failures.push(name + (extra ? '  >>  ' + extra : ''));
  return false;
}

function eq(a, b, name) {
  return ok(a === b, name, 'expect ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

function deep(a, b, name) {
  return ok(JSON.stringify(a) === JSON.stringify(b), name,
    'expect ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

function emptyRel() {
  const r = [];
  for (let i = 0; i < 6; i++) r.push([false, false, false, false, false, false]);
  return r;
}

/* 固定手牌的桌面，用于精确场景 */
function setup(hands, opts) {
  opts = opts || {};
  const st = M.createGame({ playerCount: hands.length, seed: opts.seed || 4242 });
  st.phase = 'playing';
  st.season = opts.season || 1;
  st.round = 1;
  st.prevPlay = null;
  st.trickPlays = [];
  st.discards = [0, 0, 0, 0, 0, 0];
  st.relation = emptyRel();
  st.columns = [];
  st.markerUse = [0, 0, 0, 0, 0, 0];
  st.unseenCount = 60 - hands.reduce(function (s, h) { return s + h.reduce(function (x, y) { return x + y; }, 0); }, 0);
  st.nextLeader = null;
  st.seasonSummary = null;
  st.roundSummary = null;
  st.gameOver = false;
  st.result = null;
  st.seasonWins = st.seasonWins.map(function () { return 0; });
  st.leader = 0;
  st.turn = 0;
  hands.forEach(function (h, i) {
    st.players[i].hand = h.slice();
    st.players[i].passed = false;
    st.players[i].out = false;
    st.players[i].finishRank = 0;
    st.players[i].rank = 0;
    st.players[i].score = 0;
    st.players[i].belts = { gold: 0, silver: 0, black: 0 };
  });
  return st;
}

function findMove(lm, color) {
  for (const m of lm.moves) if (m.color === color) return m;
  return null;
}

function colEntries(st) {
  const n = [0, 0, 0, 0, 0, 0];
  st.columns.forEach(function (col) {
    col.forEach(function (e) { n[e.c]++; });
  });
  return n;
}

function checkStructure(st, label) {
  for (let a = 0; a < 6; a++) {
    for (let b = 0; b < 6; b++) {
      if (st.relation[a][b] && st.relation[b][a]) {
        ok(false, label + ': 关系出现双向 ' + a + '/' + b);
        return;
      }
    }
  }
  for (const col of st.columns) {
    const seen = {};
    for (let i = 0; i < col.length; i++) {
      if (seen[col[i].c]) { ok(false, label + ': 列内颜色重复 ' + col[i].c); return; }
      seen[col[i].c] = true;
      if (i > 0 && !st.relation[col[i - 1].c][col[i].c]) {
        ok(false, label + ': 列内相邻不成链 ' + col[i - 1].c + '>' + col[i].c);
        return;
      }
    }
  }
  deep(colEntries(st), st.markerUse, label + ': 标志使用数与列内标志数一致');
}

/* ---------------- 1. 发牌 ---------------- */
(function testDeal() {
  for (let n = 2; n <= 6; n++) {
    const st = M.createGame({ playerCount: n, seed: 700 + n });
    let total = 0;
    st.players.forEach(function (p) { total += M.handCount(p); });
    eq(total, n * M.HAND_SIZE[n], n + '人局发牌总数');
    eq(st.unseenCount, 60 - total, n + '人局扣置数');
    eq(st.season, 1, n + '人局从第1赛季开始');
    eq(st.round, 1, n + '人局从第1回合开始');
    eq(st.phase, 'playing', n + '人局初始阶段');
    ok(st.leader >= 0 && st.leader < n, n + '人局主持人在座次内');
    eq(st.players.filter(function (p) { return p.isAI; }).length, n - 1, n + '人局AI数量');
    checkStructure(st, n + '人局开局');
  }
})();

/* ---------------- 2. 首家只能出 1 张 ---------------- */
(function testLeader() {
  const st = setup([[2, 0, 1, 0, 0, 0], [0, 3, 0, 0, 0, 0]]);
  const lm = M.legalMoves(st);
  eq(lm.leader, true, '首家标记');
  eq(lm.canPass, false, '首家不能跳过');
  deep(lm.moves, [{ color: 0, count: 1 }, { color: 2, count: 1 }], '首家每种花色各 1 张');
  eq(M.play(st, 0).ok, true, '首家出牌成功');
  eq(st.prevPlay.count, 1, '首家只出 1 张');
  eq(st.turn, 1, '轮到下家');
})();

/* ---------------- 3. 未定花色必须多 1 张 ---------------- */
(function testUnknown() {
  const st = setup([[4, 0, 0, 0, 0, 0], [0, 3, 3, 0, 0, 0]]);
  M.play(st, 0);
  const lm = M.legalMoves(st);
  ok(findMove(lm, 1) && findMove(lm, 1).count === 2, '未定花色 +1 张');
  ok(!findMove(lm, 0), '同花色不能出');
  eq(lm.canPass, true, '非首家可跳过');
  eq(M.play(st, 1).ok, true, '未定花色出牌成功');

  const st2 = setup([[4, 0, 0, 0, 0, 0], [0, 3, 3, 0, 0, 0]]);
  M.play(st2, 0);
  eq(M.play(st2, 0).ok, false, '同花色出牌被拒绝');
})();

/* ---------------- 4. 已知强：同张数；已知弱 / 同色：非法 ---------------- */
(function testKnown() {
  const st = setup([[0, 0, 3, 0, 0, 0], [0, 3, 0, 0, 0, 0]]);
  st.prevPlay = { player: 1, color: 1, count: 2 };
  st.relation[2][1] = true;
  const lm = M.legalMoves(st);
  eq(findMove(lm, 2).count, 2, '已知强于上家：同张数即可');

  st.players[0].hand = [0, 0, 1, 0, 0, 0];
  eq(findMove(M.legalMoves(st), 2), null, '已知强但张数不够：非法');

  const st2 = setup([[0, 0, 3, 0, 0, 0], [0, 3, 0, 0, 0, 0]]);
  st2.prevPlay = { player: 1, color: 1, count: 1 };
  st2.relation[1][2] = true;
  ok(!findMove(M.legalMoves(st2), 2), '已知弱于上家：不能出');
})();

/* ---------------- 5. 3 张上限 ---------------- */
(function testCap() {
  const st = setup([[0, 5, 4, 0, 0, 0], [0, 0, 0, 3, 0, 0]]);
  st.prevPlay = { player: 1, color: 3, count: 3 };
  ok(!findMove(M.legalMoves(st), 0), '未定花色需 4 张：超过上限，非法');
  st.relation[1][3] = true;
  eq(findMove(M.legalMoves(st), 1).count, 3, '已知强于上家：3 张可用');
})();

/* ---------------- 6. 关系闭包 + 单列插入 ---------------- */
(function testClosure() {
  const st = setup([[5, 0, 3, 0, 0, 0], [0, 5, 0, 0, 0, 0]]);
  M.play(st, 0);            // 首家 赤◆
  M.play(st, 1);            // 未定 蓝●×2 → 蓝>赤
  ok(st.relation[1][0], '蓝 > 赤');
  eq(st.turn, 0, '回到首家');
  M.play(st, 2);            // 未定 毒▲×2 → 毒>蓝
  ok(st.relation[2][1], '毒 > 蓝');
  ok(st.relation[2][0], '闭包：毒 > 赤');
  deep(st.columns, [[{ c: 2 }, { c: 1 }, { c: 0 }]], '三色同列：2/1/0');
  deep(st.markerUse, [1, 1, 1, 0, 0, 0], '标志用量 1/1/1');
  checkStructure(st, '闭包后');
})();

/* ---------------- 7. 不可比时另起一列（复制弱色标志） ---------------- */
(function testNewColumn() {
  const st = setup([[0, 0, 4, 0, 0, 0], [5, 0, 0, 0, 0, 0]]);
  st.prevPlay = { player: 1, color: 0, count: 1 };
  st.relation[1][0] = true;
  st.columns = [[{ c: 1 }, { c: 0 }]];
  st.markerUse = [1, 1, 0, 0, 0, 0];
  const r = M.play(st, 2);
  eq(r.ok, true, '不可比花色出牌成功');
  eq(r.action.newColumn, true, '标记新列');
  deep(st.columns, [
    [{ c: 1 }, { c: 0 }],
    [{ c: 2 }, { c: 0 }],
  ], '另起一列并复制弱色');
  deep(st.markerUse, [2, 1, 1, 0, 0, 0], '复制弱色消耗其标志');
  ok(!st.relation[2][1] && !st.relation[1][2], '毒与蓝仍不可比');
  checkStructure(st, '新列后');
})();

/* ---------------- 8. 电子版不限制每色标志数 ---------------- */
(function testUnlimitedMarkers() {
  const st = setup([[0, 0, 2, 0, 0, 0], [4, 0, 0, 0, 0, 0]]);
  st.prevPlay = { player: 1, color: 0, count: 1 };
  st.columns = [[{ c: 0 }]];
  st.markerUse = [1, 0, 5, 0, 0, 0];
  const r = M.play(st, 2);
  eq(r.ok, true, '第 6 枚标志仍可放置');
  eq(st.markerUse[2], 6, '同色第 6 次放置计入用量');
  eq(st.columns[0][0].c, 2, '第 6 枚仍记录颜色');
  ok(!('ghost' in st.columns[0][0]), '不再生成幽灵标志');
})();

/* ---------------- 8b. 新关系补进所有可插入列（金光 > 赤焰） ---------------- */
(function testPlaceInAllColumns() {
  const st = setup([[0, 0, 0, 3, 0, 0], [0, 2, 0, 0, 0, 0]]);
  st.columns = [
    [{ c: 2 }, { c: 1 }, { c: 3 }], // 毒藤 > 蓝电 > 金光
    [{ c: 2 }, { c: 0 }, { c: 5 }], // 毒藤 > 赤焰 > 灰岩
    [{ c: 1 }, { c: 4 }],           // 蓝电 > 幻紫
    [{ c: 0 }, { c: 4 }],           // 赤焰 > 幻紫
  ];
  st.markerUse = [2, 2, 2, 1, 2, 1];
  const set = function (a, b) { st.relation[a][b] = true; };
  set(1, 3); // 蓝电 > 金光
  set(2, 1); // 毒藤 > 蓝电
  set(2, 3); // 毒藤 > 金光（闭包）
  set(0, 5); // 赤焰 > 灰岩
  set(2, 0); // 毒藤 > 赤焰
  set(2, 5); // 毒藤 > 灰岩（闭包）
  set(1, 4); // 蓝电 > 幻紫
  set(0, 4); // 赤焰 > 幻紫
  set(2, 4); // 毒藤 > 幻紫（闭包）
  st.prevPlay = { player: 1, color: 0, count: 2 };
  checkStructure(st, '多列补标志前');

  const r = M.play(st, 3); // 金光×3 > 赤焰×2（未定）
  eq(r.ok, true, '金光压赤焰成立');
  eq(r.action.newColumn, false, '已有可插入列，不新建列');
  deep(st.columns, [
    [{ c: 2 }, { c: 1 }, { c: 3 }],
    [{ c: 2 }, { c: 3 }, { c: 0 }, { c: 5 }],
    [{ c: 1 }, { c: 4 }],
    [{ c: 3 }, { c: 0 }, { c: 4 }],
  ], '金光 > 赤焰同时补进第 2、4 列');
  deep(st.markerUse, [2, 2, 2, 3, 2, 1], '多列补标志计入用量');
  checkStructure(st, '多列补标志后');
})();

/* ---------------- 8c. 旧存档读档时补齐最近一次新关系 ---------------- */
(function testRepairLastRelation() {
  const raw = setup([[0, 0, 0, 4, 0, 0], [0, 2, 0, 0, 0, 0]]);
  raw.columns = [[{ c: 0 }, { c: 4 }]];
  raw.markerUse = [1, 0, 0, 0, 1, 0];
  raw.relation[0][4] = true;
  raw.relation[3][0] = true;
  raw.lastAction = { type: 'play', player: 1, color: 3, count: 3, relationAdded: true, relationTo: 0 };
  checkStructure(raw, '旧存档读档前');

  const st = M.deserialize(M.serialize(raw));
  ok(!!st, '旧存档可读取');
  deep(st.columns, [[{ c: 3 }, { c: 0 }, { c: 4 }]], '读档后金光补到赤焰上方');
  deep(st.markerUse, [1, 0, 0, 1, 1, 0], '补齐标志计入用量');
  checkStructure(st, '旧存档读档后');

  const again = M.deserialize(M.serialize(st));
  deep(again.columns, [[{ c: 3 }, { c: 0 }, { c: 4 }]], '再次读档不重复补标志');
  deep(again.markerUse, [1, 0, 0, 1, 1, 0], '再次读档用量不变');
})();

/* ---------------- 9. 跳过 / 回合结束 / 下一家主持 ---------------- */
(function testRound() {
  const st = setup([[5, 0, 0, 0, 0, 0], [0, 3, 0, 0, 0, 0], [0, 0, 3, 0, 0, 0]]);
  M.play(st, 0);
  eq(M.pass(st).ok, true, '下家跳过');
  eq(st.turn, 2, '跳到第三家');
  const r = M.pass(st);
  eq(r.ok, true, '第三家跳过');
  eq(st.phase, 'roundEnd', '只剩一家未跳：回合结束');
  eq(st.roundSummary.lastPlayer, 0, '最后出牌者为首家');
  eq(st.roundSummary.nextLeader, 0, '下回合主持人仍为首家');
  eq(M.nextRound(st).ok, true, '进入下一回合');
  eq(st.round, 2, '回合数 +1');
  eq(st.leader, 0, '新主持人');
  eq(st.players[1].passed, false, '跳过状态已重置');
  eq(st.phase, 'playing', '回到出牌阶段');
})();

/* ---------------- 10. 最后出牌者打空 → 顺时针找有牌者 ---------------- */
(function testEmptyLeaderFallback() {
  const st = setup([
    [1, 0, 0, 0, 0, 0],
    [0, 2, 0, 0, 0, 0],
    [0, 0, 4, 0, 0, 0],
    [0, 0, 0, 4, 0, 0],
  ]);
  M.play(st, 0);            // p0 打空
  eq(st.players[0].finishRank, 1, '首家第 1 名完成');
  eq(st.turn, 1, '跳过打空者轮到 p1');
  M.play(st, 1);            // p1 用 2 张打空
  eq(st.players[1].finishRank, 2, '第二家第 2 名完成');
  eq(st.phase, 'playing', '仍有 2 家有牌，未结束赛季');
  M.pass(st);               // p2 跳过
  M.pass(st);               // p3 跳过
  eq(st.phase, 'roundEnd', '回合结束');
  eq(st.roundSummary.lastPlayer, 1, '最后出牌者为 p1');
  eq(st.roundSummary.nextLeader, 2, 'p1 已打空 → 顺时针找 p2');
})();

/* ---------------- 11. 赛季计分：3 人 +2/+1/−1 ---------------- */
(function testScoring3() {
  const st = setup([[1, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0], [0, 0, 5, 0, 0, 0]]);
  M.play(st, 0);
  M.play(st, 1);
  eq(st.phase, 'seasonEnd', '只剩一家有牌：赛季结束');
  eq(st.seasonSummary.ranking[0].seat, 0, '第 1 名 p0');
  eq(st.seasonSummary.ranking[0].delta, 2, '第 1 名 +2');
  eq(st.seasonSummary.ranking[1].delta, 1, '第 2 名 +1');
  eq(st.seasonSummary.ranking[2].delta, -1, '最后一名 −1');
  deep([st.players[0].score, st.players[1].score, st.players[2].score], [2, 1, -1], '总分 2/1/−1');
  deep([st.players[0].belts.gold, st.players[1].belts.silver, st.players[2].belts.black], [1, 1, 1], '奖章 +2金/+1银/−1黑');
  eq(st.nextLeader, 2, '最后一名主持下一赛季');
  eq(st.seasonWins[0], 1, '赛季胜场 +1');
  eq(st.gameOver, false, '第 1 赛季未结束对局');
})();

/* ---------------- 12. 4 人中间名次 0 分 ---------------- */
(function testScoring4() {
  const st = setup([
    [1, 0, 0, 0, 0, 0],
    [0, 2, 0, 0, 0, 0],
    [0, 0, 3, 0, 0, 0],
    [0, 0, 0, 4, 0, 0],
  ]);
  M.play(st, 0);
  M.play(st, 1);
  M.play(st, 2);
  eq(st.phase, 'seasonEnd', '4 人局赛季结束');
  deep([st.players[0].score, st.players[1].score, st.players[2].score, st.players[3].score],
    [2, 1, 0, -1], '4 人计分 2/1/0/−1');
  eq(st.seasonSummary.ranking[2].delta, 0, '第 3 名 0 分');
  deep(st.seasonSummary.ranking.map(function (r) { return r.seat; }), [0, 1, 2, 3], '名次顺序');
})();

/* ---------------- 13. 2 人局：无银牌，先 3 胜 ---------------- */
(function testScoring2() {
  const st = setup([[1, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0]]);
  M.play(st, 0);
  eq(st.phase, 'seasonEnd', '2 人局仅一人有牌即结束');
  deep([st.players[0].score, st.players[1].score], [2, -1], '2 人局 +2/−1');
  eq(st.players[1].belts.silver, 0, '2 人局不发银牌');
  eq(st.seasonSummary.ranking.length, 2, '2 人局两行结算');
  eq(st.gameOver, false, '2 人局 1 胜未结束');

  st.seasonWins = [2, 0];
  st.phase = 'playing';
  st.turn = 0;
  st.leader = 0;
  st.prevPlay = null;
  st.players[0].hand = [1, 0, 0, 0, 0, 0];
  st.players[1].hand = [0, 2, 0, 0, 0, 0];
  st.players[0].passed = false;
  st.players[0].out = false;
  st.players[0].finishRank = 0;
  M.play(st, 0);
  eq(st.seasonWins[0], 3, '2 人局第 3 胜');
  eq(st.gameOver, true, '2 人局 3 胜结束对局');
  eq(M.nextSeason(st).ok, false, '终局后不能开新赛季');
  const r = M.finishGame(st);
  eq(r.ok, true, '结算对局');
  eq(st.result.winnerIds[0], 0, '2 人局胜者 p0');
})();

/* ---------------- 14. 4 赛季结束 + 名次判定 ---------------- */
(function testGameEnd() {
  const st = setup([[1, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0], [0, 0, 5, 0, 0, 0]], { season: 4 });
  M.play(st, 0);
  M.play(st, 1);
  eq(st.season, 4, '第 4 赛季结束');
  eq(st.gameOver, true, '3~6 人局 4 赛季结束对局');
  eq(st.phase, 'seasonEnd', '等待终局结算');
  const r = M.finishGame(st);
  eq(r.ok, true, '终局结算成功');
  eq(st.phase, 'gameEnd', '进入终局');
  eq(st.result.winnerIds[0], 0, '按总分 p0 第一');
  eq(st.result.rows.length, 3, '终局 3 行');

  const a = M.createGame({ playerCount: 3, seed: 1 });
  a.phase = 'seasonEnd'; a.gameOver = true; a.season = 4;
  a.players[0].score = 3; a.players[0].belts.gold = 1;
  a.players[1].score = 3; a.players[1].belts.gold = 2;
  a.players[2].score = 1;
  a.lastSeasonWinner = 2;
  M.finishGame(a);
  eq(a.result.winnerIds[0], 1, '同分比金牌：p1 胜');

  const b = M.createGame({ playerCount: 3, seed: 1 });
  b.phase = 'seasonEnd'; b.gameOver = true; b.season = 4;
  b.players[0].score = 3; b.players[0].belts.gold = 1;
  b.players[1].score = 3; b.players[1].belts.gold = 1;
  b.players[2].score = 1;
  b.lastSeasonWinner = 0;
  M.finishGame(b);
  deep(b.result.winnerIds, [0], '同分同金：末季冠军 p0 胜');

  const c = M.createGame({ playerCount: 3, seed: 1 });
  c.phase = 'seasonEnd'; c.gameOver = true; c.season = 4;
  c.players[0].score = 3; c.players[0].belts.gold = 1;
  c.players[1].score = 3; c.players[1].belts.gold = 1;
  c.players[2].score = 1;
  c.lastSeasonWinner = 2;
  M.finishGame(c);
  deep(c.result.winnerIds, [0, 1], '同分同金且非末季冠军：并列');
})();

/* ---------------- 15. 安全视图不泄露 ---------------- */
(function testView() {
  const st = M.createGame({ playerCount: 4, seed: 99 });
  const cur = st.turn;
  const v = M.viewFor(st, cur);
  eq(v.hand.length, 6, '视图手牌为 6 色计数');
  eq(v.players.length, 4, '视图玩家数');
  ok(v.players.every(function (p) { return p.hand === undefined; }), '视图不含他人手牌');
  ok(v.players.every(function (p) { return typeof p.handCount === 'number'; }), '视图只有他人手牌数');
  eq(v.legal.moves.length > 0, true, '自己的合法动作可用');
  const other = (cur + 1) % 4;
  const v1 = M.viewFor(st, other);
  eq(v1.legal.moves.length, 0, '非当前玩家无合法动作');
  deep(v.unseen, v.hand.map(function (n, c) { return 10 - n - st.discards[c]; }), '未见牌数公式');
})();

/* ---------------- 16. 随机自对弈 ---------------- */
(function testSelfPlay() {
  let games = 0;
  let actions = 0;
  let bad = null;

  for (let n = 2; n <= 6 && !bad; n++) {
    for (let g = 0; g < 40 && !bad; g++) {
      const st = M.createGame({ playerCount: n, seed: 1000 * n + g });
      const rand = M.seeded(777 + n * 100 + g);
      let steps = 0;
      let guard = 0;

      while (st.phase !== 'gameEnd' && guard < 20000) {
        guard++;
        if (st.phase === 'playing') {
          const lm = M.legalMoves(st);
          if (!lm.moves.length) {
            if (!lm.canPass) { bad = 'S' + st.season + 'R' + st.round + ' 无牌可出也不能跳过'; break; }
            const r = M.pass(st);
            if (!r.ok) { bad = '跳过失败: ' + r.error; break; }
          } else if (lm.canPass && rand() < 0.22) {
            const r = M.pass(st);
            if (!r.ok) { bad = '跳过失败: ' + r.error; break; }
          } else {
            const mv = lm.moves[Math.floor(rand() * lm.moves.length)];
            const r = M.play(st, mv.color);
            if (!r.ok) { bad = '出牌失败: ' + r.error; break; }
            if (r.action.count !== mv.count) { bad = '出牌张数不符'; break; }
          }
          steps++;
          actions++;

          if (st.phase !== 'gameEnd') {
            let total = st.unseenCount;
            st.players.forEach(function (p) { total += M.handCount(p); });
            st.discards.forEach(function (d) { total += d; });
            if (total !== 60) { bad = '牌数不守恒: ' + total; break; }
            const before = failed;
            checkStructure(st, '自对弈 S' + st.season + 'R' + st.round);
            if (failed > before) { bad = failures[failures.length - 1]; break; }
          }
        } else if (st.phase === 'roundEnd') {
          if (!M.nextRound(st).ok) { bad = '无法进入下一回合'; break; }
        } else if (st.phase === 'seasonEnd') {
          if (st.gameOver) {
            if (!M.finishGame(st).ok) { bad = '无法结算终局'; break; }
          } else if (!M.nextSeason(st).ok) { bad = '无法进入下一赛季'; break; }
        } else {
          bad = '未知阶段: ' + st.phase;
          break;
        }
      }

      if (!bad && st.phase !== 'gameEnd') { bad = n + '人局超过步数上限未终局'; }
      if (!bad && !st.result) { bad = n + '人局终局结果为空'; }
      games++;
    }
  }

  ok(!bad, '随机自对弈全流程', bad || (games + ' 局 / ' + actions + ' 次行动'));
  if (bad) {
    // 避免逐条重复失败
    console.error('自对弈失败:', bad);
  }
})();

/* ---------------- 汇总 ---------------- */
console.log('');
if (failed) {
  console.log('❌ 失败 ' + failed + ' 项 / 通过 ' + passed + ' 项');
  failures.slice(-20).forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
console.log('✅ 全部通过：' + passed + ' 项断言');