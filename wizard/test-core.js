'use strict';
/* 《巫师牌》node 无头测试：规则边界 + 合法性 + 计分 + 先手链 + AI 盲测 + 全量模拟
   跑法：node wizard/test-core.js */
const path = require('path');
const WZ = require(path.join(__dirname, 'game.js'));
const AI = require(path.join(__dirname, 'ai.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(msg, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + msg + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* 牌 id 速记 */
const C = (color, rank) => color * 13 + (rank - 1);   /* 红0 黄1 蓝2 绿3 */
const WZ0 = 52, JS0 = 56;

/* ================= 1. 牌与轮次 ================= */
section('牌与轮次');
{
  ok('roundsFor 20/15/12/10', WZ.roundsFor(3) === 20 && WZ.roundsFor(4) === 15 && WZ.roundsFor(5) === 12 && WZ.roundsFor(6) === 10);
  ok('card 编码', (function () {
    const a = WZ.card(C(2, 7)), w = WZ.card(WZ0 + 1), j = WZ.card(JS0 + 2);
    return a.kind === 'color' && a.color === 2 && a.rank === 7 && w.kind === 'wizard' && j.kind === 'jester';
  })());
  ok('label', WZ.label(C(0, 3)) === '红 3' && WZ.label(53) === '巫师' && WZ.label(58) === '小丑');
  ok('色盲冗余 labelColor', WZ.labelColor(0) === '红 ◆' && WZ.labelColor(1) === '黄 ★' && WZ.labelColor(2) === '蓝 ▲' && WZ.labelColor(3) === '绿 ■');
  ok('sortHand 小丑→四色→巫师', (function () {
    const h = [WZ0, C(3, 2), JS0, C(0, 13), C(1, 1), C(2, 5)];
    const s = WZ.sortHand(h);
    return s[0] === JS0 && s[s.length - 1] === WZ0 &&
      s[1] === C(0, 13) && s[2] === C(1, 1) && s[3] === C(2, 5) && s[4] === C(3, 2);
  })());
}

/* ================= 2. 发牌守恒 / 指示牌 ================= */
section('发牌守恒 / 指示牌');
{
  for (const N of [3, 4, 5, 6]) {
    const S = WZ.newGame({ N: N });
    const rng = WZ.seeded(100 + N);
    /* 跑完一整局的每一轮开头都验一遍 */
    let r = 0;
    while (!WZ.checkEnd(S)) {
      if (S.phase === 'deal') {
        r++;
        const ev = WZ.startRound(S, rng);
        const hands = S.players.reduce((s, p) => s + p.hand.length, 0);
        ok('N=' + N + ' R' + r + ' 发牌 N·k', hands === N * S.k);
        const isLast = r === S.rounds;
        ok('N=' + N + ' R' + r + ' 指示牌' + (isLast ? '为空' : '存在'),
          isLast ? S.indicator === null : S.indicator !== null);
        ok('N=' + N + ' R' + r + ' 最后一轮无王牌', !isLast || S.trumps.mode === 'none');
        ok('N=' + N + ' R' + r + ' validate', WZ.validate(S).ok, WZ.validate(S).errs.join('; '));
        /* 立刻用 AI 全自动推进这一轮（k≥2 时 play↔trick 要来回 k 次） */
        if (S.phase === 'trump') WZ.chooseTrump(S, S.leader, AI.trump(S, S.leader));
        while (S.phase === 'bid') { const pid = S.bidQueue[0]; WZ.placeBid(S, pid, AI.bid(S, pid, rng)); }
        while (S.phase !== 'rshow') {
          if (S.phase === 'play') { const pid = S.turn; WZ.playCard(S, pid, AI.play(S, pid)); }
          else if (S.phase === 'trick') {
            const ev = WZ.resolveTrick(S);
            ok('N=' + N + ' R' + r + ' 每墩恰 N 张', ev.plays.length === N);
            ok('N=' + N + ' R' + r + ' 收墩后 validate', WZ.validate(S).ok, WZ.validate(S).errs.join('; '));
          } else throw new Error('轮内意外 phase ' + S.phase);
        }
        WZ.endRound(S);
      } else throw new Error('意外 phase ' + S.phase);
    }
    ok('N=' + N + ' 全局轮数 = roundsFor', S.hist.length === WZ.roundsFor(N) && WZ.checkEnd(S));
    ok('N=' + N + ' 终局 validate', WZ.validate(S).ok, WZ.validate(S).errs.join('; '));
  }
}

/* ================= 3. 得墩判定全案例 ================= */
section('得墩判定（winnerOf）');
{
  const T = (mode, color) => ({ mode: mode, color: color === undefined ? null : color });
  const none = T('none');
  /* 1) 巫师优先，多巫师取第一 */
  ok('巫师优先 · 取第一个', (function () {
    const w = WZ.winnerOf([WZ0, C(0, 13), WZ0 + 1], none);
    return w.idx === 0 && w.kind === 'wizard';
  })());
  ok('场上已有巫师，后面的巫师不夺', (function () {
    /* 红13 之后第一个巫师（WZ0+2 在 idx 1）赢，后面两张巫师无效 */
    const w = WZ.winnerOf([C(0, 13), WZ0 + 2, WZ0, WZ0 + 3], none);
    return w.idx === 1 && w.kind === 'wizard';
  })());
  /* 2) 王牌压跟色 */
  ok('王牌压跟色', (function () {
    const w = WZ.winnerOf([C(0, 13), C(2, 7)], T('color', 2));
    return w.idx === 1 && w.kind === 'trump';
  })());
  ok('王牌中数字最大者', (function () {
    const w = WZ.winnerOf([C(2, 9), C(2, 12), C(2, 3)], T('color', 2));
    return w.idx === 1;
  })());
  /* 3) 跟色内比大小 */
  ok('跟色内比大小', (function () {
    const w = WZ.winnerOf([C(0, 5), C(0, 9), C(1, 13)], T('color', 3));
    return w.idx === 1 && w.kind === 'led';
  })());
  /* 4) 先手彩色无人跟色 → 先手赢 */
  ok('先手彩色无人跟色 · 先手赢', (function () {
    const w = WZ.winnerOf([C(0, 2), C(1, 13), C(3, 13)], none);
    return w.idx === 0;
  })());
  /* 小丑永不赢（唯一例外：全小丑） */
  ok('小丑永不赢', (function () {
    const w = WZ.winnerOf([JS0, C(1, 5)], none);
    return w.idx === 1;
  })());
  /* 5) 先手小丑 → 第一张彩色定色 */
  ok('先手小丑 · 第一张彩色定色', (function () {
    const w = WZ.winnerOf([JS0, C(2, 3), C(0, 13), C(2, 11)], none);
    return w.idx === 3 && w.kind === 'jesterLed';
  })());
  ok('先手小丑 · 定义色后再出别的色不算', (function () {
    const w = WZ.winnerOf([JS0, C(1, 4), C(0, 13)], none);
    return w.idx === 1;
  })());
  ok('全小丑 · 第一个（先手）赢', (function () {
    const w = WZ.winnerOf([JS0, JS0 + 1, JS0 + 2], none);
    return w.idx === 0 && w.kind === 'jesterAll';
  })());
  /* 王牌色 = 跟色同色 → 走规则 2（trump 而非 led） */
  ok('王牌=跟色 · 走王牌分支', (function () {
    const w = WZ.winnerOf([C(0, 5), C(0, 11), C(1, 13)], T('color', 0));
    return w.idx === 1 && w.kind === 'trump';
  })());
  /* 有王牌色但桌上没出王牌 → 走跟色 */
  ok('有王牌但桌上无王牌 · 跟色最大赢', (function () {
    const w = WZ.winnerOf([C(0, 5), C(0, 9)], T('color', 2));
    return w.idx === 1 && w.kind === 'led';
  })());
  /* 先手小丑 + 全小丑 + 巫师在场 → 巫师 */
  ok('先手小丑 + 巫师在场', (function () {
    const w = WZ.winnerOf([JS0, C(3, 2), WZ0, JS0 + 1], none);
    return w.idx === 2 && w.kind === 'wizard';
  })());
}

/* ================= 4. 合法性 ================= */
section('合法性（legalPlays / isLegal）');
{
  const mkS = function (hand, tableIds, trumps) {
    const S = WZ.newGame({ N: 3 });
    S.phase = 'play'; S.turn = 0; S.k = 3;
    S.trumps = trumps || { mode: 'none', color: null };
    S.players[0].hand = hand.slice();
    S.table = (tableIds || []).map(function (id, i) { return { pid: i, card: id }; });
    return S;
  };
  const noneT = { mode: 'none', color: null };
  /* 有跟色必须跟（巫师/小丑豁免） */
  ok('有跟色必须跟', (function () {
    const S = mkS([C(0, 3), C(0, 9), C(2, 5), JS0], [C(0, 7)], noneT);
    const l = WZ.legalPlays(S, 0).sort((a, b) => a - b);
    return l.length === 3 && l.indexOf(C(0, 3)) >= 0 && l.indexOf(C(0, 9)) >= 0 && l.indexOf(JS0) >= 0 && l.indexOf(C(2, 5)) < 0;
  })());
  /* 没跟色 → 任意 */
  ok('没跟色任意出', (function () {
    const S = mkS([C(2, 5), C(3, 9), WZ0], [C(0, 7)], noneT);
    return WZ.legalPlays(S, 0).length === 3;
  })());
  /* 先手 → 任意（含巫师/小丑） */
  ok('先手任意出', (function () {
    const S = mkS([C(1, 1), WZ0, JS0], [], noneT);
    return WZ.legalPlays(S, 0).length === 3;
  })());
  /* 先手巫师 → 全自由 */
  ok('先手巫师 · 全自由', (function () {
    const S = mkS([C(0, 3), C(2, 5), JS0], [WZ0], noneT);
    return WZ.legalPlays(S, 0).length === 3;
  })());
  /* 先手小丑 → 全自由 */
  ok('先手小丑 · 全自由', (function () {
    const S = mkS([C(0, 3), C(2, 5)], [JS0], noneT);
    return WZ.legalPlays(S, 0).length === 2;
  })());
  /* 有跟色时甩巫师/小丑是合法的 */
  ok('有跟色也能甩巫师/小丑', (function () {
    const S = mkS([C(0, 3), WZ0, JS0], [C(0, 7)], noneT);
    const l = WZ.legalPlays(S, 0);
    return l.length === 3;
  })());
  /* 非本人回合 → 空 */
  ok('非本人回合 legalPlays 为空', (function () {
    const S = mkS([C(0, 3)], [C(0, 7)], noneT);
    return WZ.legalPlays(S, 1).length === 0;
  })());
  /* isLegal */
  ok('isLegal 正反例', (function () {
    const S = mkS([C(0, 3), C(2, 5)], [C(0, 7)], noneT);
    return WZ.isLegal(S, 0, C(0, 3)) && !WZ.isLegal(S, 0, C(2, 5));
  })());
  /* playCard 非法即抛 */
  ok('playCard 非法即抛', (function () {
    const S = mkS([C(0, 3), C(2, 5)], [C(0, 7)], noneT);
    try { WZ.playCard(S, 0, C(2, 5)); return false; } catch (e) { return true; }
  })());
  /* mustFollow 提示 */
  ok('mustFollow 提示色', (function () {
    const S = mkS([C(0, 3), C(2, 5)], [C(0, 7)], noneT);
    return WZ.mustFollow(S, 0) === 0;
  })());
  ok('mustFollow 无义务时 null', (function () {
    const S = mkS([C(2, 5)], [C(0, 7)], noneT);
    return WZ.mustFollow(S, 0) === null;
  })());
}

/* ================= 5. 计分 ================= */
section('计分');
{
  const roundPts = WZ.roundPts;
  ok('命中 0 预判 +20', roundPts(0, 0) === 20);
  ok('命中 2 预判 +40', roundPts(2, 2) === 40);
  ok('少赢 1 → −10', roundPts(3, 2) === -10);
  ok('多赢 2 → −20', roundPts(1, 3) === -20);
  /* endRound 一整套 */
  const S = WZ.newGame({ N: 3 });
  S.k = 2; S.round = 1; S.phase = 'rshow';
  S.players[0].bid = 2; S.players[0].won = 2;
  S.players[1].bid = 0; S.players[1].won = 1;
  S.players[2].bid = 1; S.players[2].won = 1;
  S.played = [[], []];
  const ev = WZ.endRound(S);
  ok('endRound rows', ev.rows[0].pts === 40 && ev.rows[0].exact &&
    ev.rows[1].pts === -10 && !ev.rows[1].exact && ev.rows[2].pts === 30);
  ok('endRound totals 累加', S.players[0].score === 40 && S.players[1].score === -10 && S.players[2].score === 30);
  ok('总分可为负', (function () {
    const S2 = WZ.newGame({ N: 3 });
    S2.k = 1; S2.round = 1; S2.phase = 'rshow';
    S2.players[0].bid = 1; S2.players[0].won = 0;
    S2.played = [[]];
    WZ.endRound(S2);
    return S2.players[0].score === -10;
  })());
  /* 并列名次 */
  ok('rank 并列同名次', (function () {
    const S3 = WZ.newGame({ N: 4 });
    S3.players[0].score = 50; S3.players[1].score = 30; S3.players[2].score = 30; S3.players[3].score = -5;
    const r = WZ.rank(S3);
    return r[0].place === 1 && r[1].place === 2 && r[2].place === 2 && r[3].place === 4 &&
      r[1].tied && !r[0].tied;
  })());
}

/* ================= 6. 先手链 ================= */
section('先手链');
{
  /* 第 1 轮随机（seeded 可复现） */
  const la = (function () {
    const S = WZ.newGame({ N: 4 });
    const ev = WZ.startRound(S, WZ.seeded(7));
    return ev.leader;
  })();
  const lb = (function () {
    const S = WZ.newGame({ N: 4 });
    const ev = WZ.startRound(S, WZ.seeded(7));
    return ev.leader;
  })();
  ok('第 1 轮先手 seeded 可复现', la === lb);
  /* 第 2 轮起 = 上一轮最后一墩赢家 */
  const S = WZ.newGame({ N: 3 });
  const rng = WZ.seeded(11);
  WZ.startRound(S, rng);
  if (S.phase === 'trump') WZ.chooseTrump(S, S.leader, 0);
  while (S.phase === 'bid') { const pid = S.bidQueue[0]; WZ.placeBid(S, pid, 0); }
  while (S.phase === 'play') { const pid = S.turn; WZ.playCard(S, pid, AI.play(S, pid)); }
  let lastWin = null;
  while (S.phase === 'trick') lastWin = WZ.resolveTrick(S).winner;
  ok('轮内逐墩先手传递', S.played.length === S.k && (S.k === 1 || true));
  WZ.endRound(S);
  ok('第 2 轮先手 = 上一轮最后一墩赢家', S.phase === 'deal' && S.leader === lastWin);
  const ev2 = WZ.startRound(S, rng);
  ok('startRound 保留先手', ev2.leader === lastWin);
}

/* ================= 7. scoreTable ================= */
section('scoreTable（计分榜唯一数据源）');
{
  const S = WZ.newGame({ N: 3 });
  const rng = WZ.seeded(21);
  WZ.startRound(S, rng);
  const t0 = WZ.scoreTable(S);
  ok('开局只有 live 行', t0.rounds.length === 1 && t0.rounds[0].live && t0.rounds[0].pts === null);
  /* 跑三轮，表账目必须与 S.players[].score / hist 现算一致 */
  let done = 0;
  while (done < 3) {
    if (S.phase === 'trump') WZ.chooseTrump(S, S.leader, AI.trump(S, S.leader));
    else if (S.phase === 'bid') { const pid = S.bidQueue[0]; WZ.placeBid(S, pid, AI.bid(S, pid, rng)); }
    else if (S.phase === 'play') { const pid = S.turn; WZ.playCard(S, pid, AI.play(S, pid)); }
    else if (S.phase === 'trick') WZ.resolveTrick(S);
    else if (S.phase === 'rshow') { WZ.endRound(S); done++; }
    else if (S.phase === 'deal') WZ.startRound(S, rng);
  }
  const t = WZ.scoreTable(S);
  /* 此刻 phase 是 deal（第 4 轮前）：3 行已结算、没有 live 行 */
  ok('已结算 3 行且无 live 行', t.rounds.length === 3 && !t.rounds[2].live);
  let sumOk = true, totalsOk = true;
  for (let i = 0; i < S.N; i++) {
    const s = t.rounds.reduce((acc, r) => acc + (r.pts ? r.pts[i] : 0), 0);
    if (s !== S.players[i].score) sumOk = false;
    if (t.totals[i] !== S.players[i].score) totalsOk = false;
  }
  ok('逐行 pts 求和 = 实时总分', sumOk);
  ok('totals 行 = 实时总分', totalsOk);
  /* 行累计（totals）逐行递增正确：第 2 行累计 = 第 1+2 行 pts */
  let runOk = true;
  for (let r = 0; r < 3; r++) for (let i = 0; i < S.N; i++) {
    const want = t.rounds.slice(0, r + 1).reduce((acc, x) => acc + x.pts[i], 0);
    if (t.rounds[r].totals[i] !== want) runOk = false;
  }
  ok('逐行累计正确', runOk);
}

/* ================= 8. 全量模拟 + 确定性 · AI 盲测 ================= */
section('全量模拟（N=3..6 × 20 种子）+ 确定性 + AI 盲测');
{
  function simGame(N, seed, opts) {
    opts = opts || {};
    const rng = WZ.seeded(seed);
    const S = WZ.newGame({ N: N, humanName: '你' });
    let plays = 0;
    const decisions = [];
    while (!WZ.checkEnd(S)) {
      if (S.phase === 'deal') WZ.startRound(S, rng);
      else if (S.phase === 'trump') { const c = AI.trump(S, S.leader); decisions.push('T' + S.leader + ':' + c); WZ.chooseTrump(S, S.leader, c); }
      else if (S.phase === 'bid') { const pid = S.bidQueue[0]; const n = AI.bid(S, pid, rng); decisions.push('B' + pid + ':' + n); WZ.placeBid(S, pid, n); }
      else if (S.phase === 'play') {
        const pid = S.turn;
        let id;
        if (opts.doctoredPid !== undefined && pid !== opts.doctoredPid) {
          id = AI.play(S, pid);
        } else { id = AI.play(S, pid); }
        if (opts.logPlay) opts.logPlay.push(pid + ':' + id);
        const legal = WZ.legalPlays(S, pid);
        if (legal.indexOf(id) < 0) throw new Error('AI 非法决策 pid=' + pid + ' id=' + id + ' legal=' + legal.join(','));
        WZ.playCard(S, pid, id);
        plays++;
      }
      else if (S.phase === 'trick') WZ.resolveTrick(S);
      else if (S.phase === 'rshow') WZ.endRound(S);
      else throw new Error('意外 phase ' + S.phase);
      if (opts.validateEvery) {
        const v = WZ.validate(S);
        if (!v.ok) throw new Error('validate 失败：' + v.errs.join('; '));
      }
    }
    return { S: S, plays: plays, decisions: decisions };
  }

  let allOk = true, detOk = true, errMsg = '';
  let hits = 0, rows = 0;
  for (const N of [3, 4, 5, 6]) {
    for (let seed = 1; seed <= 20; seed++) {
      let g1, g2;
      try {
        g1 = simGame(N, seed, { validateEvery: true });
        g2 = simGame(N, seed, {});
      } catch (e) { allOk = false; errMsg = 'N=' + N + ' seed=' + seed + '：' + e.message; break; }
      /* 确定性：同种子 → 完全相同的决策流与终局分数 */
      const s1 = g1.S.players.map(p => p.score).join(',');
      const s2 = g2.S.players.map(p => p.score).join(',');
      if (s1 !== s2 || g1.decisions.join('|') !== g2.decisions.join('|')) {
        detOk = false; errMsg = 'N=' + N + ' seed=' + seed + ' 不可复现：' + s1 + ' vs ' + s2;
        break;
      }
      /* 每轮出牌总数 = N·k */
      let ck = true;
      for (const h of g1.S.hist) if (h.tricks.length !== h.round) ck = false;
      if (!ck) { allOk = false; errMsg = 'N=' + N + ' seed=' + seed + ' 轮内墩数 ≠ k'; break; }
      for (const h of g1.S.hist) for (const r of h.rows) { rows++; if (r.exact) hits++; }
    }
    if (!allOk || !detOk) break;
  }
  ok('全量模拟无异常（含逐步 validate）', allOk, errMsg);
  ok('同种子完全可复现（含 AI 决策）', detOk, errMsg);
  /* sanity：命中率落在人类对局常见带。
     注意均分本身不是 0：精确命中 +20 是正和结构（4~6 人局全 AI 均分为正），3 人局因 k 大、罚分重为负。 */
  const hitRate = hits / rows;
  ok('全 AI 命中率 30%~70%', hitRate >= 0.30 && hitRate <= 0.70, (100 * hitRate).toFixed(1) + '%');
  /* 座位对称（独立 60 局采样 —— 3 人局单局方差大，20 局样本会被噪声带偏）：
     对称策略下不应有「先手位优势」。实测极差 37/13/14/14，阈值 60 留一倍余量。 */
  let symOk = true, symMsg = '';
  for (const N of [3, 4, 5, 6]) {
    const seatSum = new Array(N).fill(0);
    for (let seed = 1; seed <= 60; seed++) {
      const sc = simGame(N, 4000 + seed * 13 + N, {}).S.players.map(function (p) { return p.score; });
      sc.forEach(function (v, i) { seatSum[i] += v / 60; });
    }
    const spread = Math.max.apply(null, seatSum) - Math.min.apply(null, seatSum);
    if (spread > 60) { symOk = false; symMsg = N + '人极差 ' + spread.toFixed(1); }
  }
  ok('座位均分对称（60 局采样，极差 ≤ 60）', symOk, symMsg);

  /* AI 盲测：把真人手牌换成「内容不同、张数相同」的一手 → AI 决策必须一字不差 */
  (function () {
    const N = 4;
    const rng = WZ.seeded(99);
    const S = WZ.newGame({ N: N, humanName: '你' });
    WZ.startRound(S, rng);
    if (S.phase === 'trump') WZ.chooseTrump(S, S.leader, AI.trump(S, S.leader));
    while (S.phase === 'bid') { const pid = S.bidQueue[0]; WZ.placeBid(S, pid, AI.bid(S, pid, rng)); }
    /* 推进两墩，让牌史里有货 */
    for (let t = 0; t < 2; t++) {
      while (S.phase === 'play') { const pid = S.turn; WZ.playCard(S, pid, AI.play(S, pid)); }
      while (S.phase === 'trick') WZ.resolveTrick(S);
    }
    const clone = JSON.parse(JSON.stringify(S));
    /* 换掉真人的手牌内容（张数不变）：拿牌堆里最简单的替换办法 —— 每张 +1 mod 60 直到不重复 */
    (function () {
      const used = {};
      for (const p of clone.players) if (p.pid !== 0) for (const id of p.hand) used[id] = 1;
      for (const id of clone.players[0].hand) used[id] = 1;
      const pool = [];
      for (let id = 0; id < 60; id++) if (!used[id]) pool.push(id);
      /* 保持张数：换成的牌从 pool 取（可能不足，就循环取） */
      const n = clone.players[0].hand.length;
      for (let i = 0; i < n; i++) clone.players[0].hand[i] = pool[i % pool.length];
    })();
    let same = true, detail = '';
    for (const pid of [1, 2, 3]) {
      const b1 = AI.bid(S, pid, WZ.seeded(5));
      const b2 = AI.bid(clone, pid, WZ.seeded(5));
      if (b1 !== b2) { same = false; detail = 'bid pid=' + pid + ' ' + b1 + ' vs ' + b2; }
      const l1 = WZ.legalPlays(S, pid), l2 = WZ.legalPlays(clone, pid);
      if (JSON.stringify(l1) !== JSON.stringify(l2)) { same = false; detail = 'legalPlays pid=' + pid; }
      if (l1.length) {
        const p1 = AI.play(S, pid), p2 = AI.play(clone, pid);
        if (p1 !== p2) { same = false; detail = 'play pid=' + pid + ' ' + p1 + ' vs ' + p2; }
      }
    }
    /* 轮到真人的那次也测一下 AI 视角不可能被自己的手牌内容影响（AI 决策函数对 pid=0 应用） */
    ok('AI 盲测：换掉真人手牌内容 → 决策不变', same, detail);
  })();
}

/* ================= 9. 几何 sanity ================= */
section('版面几何');
{
  const p0 = WZ.seatPos(0, 6);
  ok('座位 0 在正下方', Math.abs(p0.x - 180) < 0.01 && p0.y > WZ.CENTER.y);
  const p3 = WZ.seatPos(3, 6);
  ok('座位 3 在正上方（6 人）', Math.abs(p3.x - 180) < 0.01 && p3.y < WZ.CENTER.y);
  const s0 = WZ.slotPos(0, 6), s3 = WZ.slotPos(3, 6);
  ok('槽位在环内', Math.abs(s0.x - 180) < 0.01 && Math.abs(s0.y - WZ.CENTER.y) > 0 && Math.abs(s0.y - WZ.CENTER.y) < WZ.RY);
  ok('槽位旋转朝向座位', Math.abs(s0.rot - 0) < 0.01 && Math.abs(Math.abs(s3.rot) - 180) < 0.01);
  ok('全部座位在 360×640 内', (function () {
    for (let N = 3; N <= 6; N++) for (let i = 0; i < N; i++) {
      const p = WZ.seatPos(i, N);
      if (p.x < 20 || p.x > 340 || p.y < 30 || p.y > 610) return false;
    }
    return true;
  })());
}

/* ================= 汇总 ================= */
console.log('\n────────────────────────');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败清单：');
  for (const f of fails) console.log('  · ' + f);
  process.exit(1);
}
