'use strict';
/* 《巫师牌》AI —— normal 一档（SPEC §7）
   红线 §9：只读公开信息 —— 自己的手牌、已打出的牌、公开预判、座位/轮次。
   别人的手牌内容一律不可见（只经 view() 取张数），由 test-core.js 的「盲测」钉住。
   → window.WZAI + module.exports */
(function (root) {
  const A = {};
  const WZ = root.WZ || (typeof require === 'function' ? require('./game.js') : null);

  /* ================= 视图（红线 §9 的机器化边界） ================= */

  function view(S, pid) {
    return {
      N: S.N, round: S.round, k: S.k, phase: S.phase,
      trumps: S.trumps, indicator: S.indicator,
      table: S.table.slice(),
      played: S.played,
      leader: S.leader, turn: S.turn,
      me: pid,
      hand: S.players[pid].hand.slice(),          /* 只有自己的手牌内容 */
      bids: S.players.map(function (p) { return p.bid; }),
      wons: S.players.map(function (p) { return p.won; }),
      handCounts: S.players.map(function (p) { return p.hand.length; })
    };
  }

  /* ================= 牌力 / 权重 ================= */

  /* 估「期望赢墩」（SPEC §7.1） */
  function handValue(hand, trumps) {
    const hasTrump = trumps.mode === 'color';
    const tc = hasTrump ? trumps.color : -1;
    const suitCnt = [0, 0, 0, 0];
    for (const id of hand) if (WZ.isColor(id)) suitCnt[WZ.card(id).color]++;
    let est = 0;
    for (const id of hand) {
      if (WZ.isWizard(id)) { est += 1.00; continue; }
      if (WZ.isJester(id)) continue;
      const c = WZ.card(id);
      if (hasTrump && c.color === tc) {
        est += c.rank >= 11 ? 0.90 : c.rank >= 8 ? 0.65 : c.rank >= 4 ? 0.45 : 0.30;
      } else if (hasTrump) {
        if (c.rank === 13) est += suitCnt[c.color] >= 3 ? 0.55 : 0.45;
        else if (c.rank === 12) est += 0.40;
        else if (c.rank === 11) est += 0.30;
      } else {
        if (c.rank === 13) est += 0.70;
        else if (c.rank === 12) est += 0.50;
        else if (c.rank === 11) est += 0.35;
      }
    }
    if (hasTrump) {
      for (let c = 0; c < 4; c++) if (c !== tc && suitCnt[c] <= 1) est += 0.20;
    }
    return est;
  }

  /* 出牌成本（越大越舍不得）：与牌力表同构 ×100，外加小丑当弃牌垫子 */
  function weight(id, trumps) {
    if (WZ.isJester(id)) return -10;
    if (WZ.isWizard(id)) return 100;
    const c = WZ.card(id);
    if (trumps.mode === 'color' && c.color === trumps.color) {
      return c.rank >= 11 ? 90 : c.rank >= 8 ? 65 : c.rank >= 4 ? 45 : 30;
    }
    if (c.rank === 13) return 55;
    if (c.rank === 12) return 40;
    if (c.rank === 11) return 30;
    return c.rank * 2;
  }

  /* ================= 公开记账 ================= */

  function seenSet(v) {
    const seen = {};
    for (const id of v.hand) seen[id] = 1;
    for (const t of v.played) for (const id of t) seen[id] = 1;
    for (const t of v.table) seen[t.card] = 1;
    if (v.indicator !== null && v.indicator !== undefined) seen[v.indicator] = 1;
    return seen;
  }

  /* 比我大、没露面过的同色牌数（可能藏在别人手里，也可能根本没发出去 —— 保守 = 都算威胁） */
  function higherLeft(v, color, rank) {
    const seen = seenSet(v);
    let n = 0;
    for (let r = rank + 1; r <= 13; r++) {
      const id = color * 13 + (r - 1);
      if (!seen[id]) n++;
    }
    return n;
  }

  function wizardsLeft(v) {
    const seen = seenSet(v);
    let n = 0;
    for (let id = 52; id < 56; id++) if (!seen[id]) n++;
    return n;
  }

  /* ================= 局面判定 ================= */

  function winsWith(v, card) {
    const cards = v.table.map(function (t) { return t.card; });
    cards.push(card);
    return WZ.winnerOf(cards, v.trumps).idx === cards.length - 1;
  }

  function winKindFor(v, card) {
    const cards = v.table.map(function (t) { return t.card; });
    cards.push(card);
    const w = WZ.winnerOf(cards, v.trumps);
    return w.idx === cards.length - 1 ? w.kind : null;
  }

  /* 稳赢：后面的人翻不出能压住我的牌 */
  function safe(v, card) {
    const kind = winKindFor(v, card);
    if (!kind) return false;
    const last = v.table.length === v.N - 1;
    if (kind === 'wizard') return true;                      /* 第一个巫师必赢 */
    if (kind === 'jesterAll') return last;                   /* 全小丑才成立，且必须轮到我收尾 */
    const c = WZ.card(card);
    const suit = kind === 'trump' ? v.trumps.color : c.color;
    if (higherLeft(v, suit, c.rank) > 0) return false;
    return last || wizardsLeft(v) === 0;
  }

  function byWeight(v) {
    return function (a, b) { return weight(a, v.trumps) - weight(b, v.trumps) || a - b; };
  }

  /* ================= 预判（SPEC §7.1） ================= */

  A.bid = function (S, pid, rng) {
    const v = view(S, pid);
    let est = handValue(v.hand, v.trumps);
    /* 整数化：距 .5 超过 0.15 常规四舍五入，边缘带 rng 进/退 */
    const fl = Math.floor(est), frac = est - fl;
    let n;
    if (frac < 0.35) n = fl;
    else if (frac > 0.65) n = fl + 1;
    else n = rng() < 0.5 ? fl : fl + 1;
    /* 公开修正：已宣布合计明显溢出就收一手 */
    const announced = v.bids.reduce(function (s, b) { return s + (b === null ? 0 : b); }, 0);
    if (announced + n > v.k + 0.5 && n >= 1) n -= 1;
    return Math.max(0, Math.min(v.k, n));
  };

  /* ================= 选色（SPEC §7.2） ================= */

  A.trump = function (S, pid) {
    const v = view(S, pid);
    let best = 0, bestScore = -1, bestSum = -1;
    for (let c = 0; c < 4; c++) {
      let cnt = 0, high = 0, sum = 0, wiz = 0;
      for (const id of v.hand) {
        if (WZ.isWizard(id)) { wiz++; continue; }
        const k = WZ.card(id);
        if (k.kind === 'color' && k.color === c) { cnt++; sum += k.rank; if (k.rank >= 10) high++; }
      }
      const sc = cnt + 0.5 * high + 0.3 * (wiz * 0.5);
      if (sc > bestScore || (sc === bestScore && sum > bestSum)) { bestScore = sc; bestSum = sum; best = c; }
    }
    return best;
  };

  /* ================= 出牌（SPEC §7.3） ================= */

  A.play = function (S, pid) {
    const v = view(S, pid);
    const legal = WZ.legalPlays(S, pid);
    if (!legal.length) throw new Error('AI: 没有合法牌可出');
    const bid = v.bids[pid] === null ? 0 : v.bids[pid];
    const need = bid - v.wons[pid];
    const remain = v.k - v.played.length;
    const mode = need >= remain ? 'MUST' : need <= 0 ? 'DUCK' : 'NEUTRAL';
    return v.table.length === 0
      ? lead(v, legal, mode)
      : follow(v, legal, mode, remain - need);
  };

  function lead(v, legal, mode) {
    const cmp = byWeight(v);
    if (mode === 'MUST') {
      /* 能压住全场 → 出「恰好稳赢的最低牌」；没有稳的 → 出最强 */
      const asc = legal.slice().sort(cmp);
      for (const c of asc) if (safe(v, c)) return c;
      return asc[asc.length - 1];
    }
    if (mode === 'DUCK') {
      /* 最低非巫师牌（小丑优先当垫子） */
      const nc = legal.filter(function (id) { return !WZ.isWizard(id); });
      const pool = nc.length ? nc : legal;
      return pool.slice().sort(cmp)[0];
    }
    /* NEUTRAL：最长非王牌色的最小牌 */
    const tc = v.trumps.mode === 'color' ? v.trumps.color : -1;
    let bestC = -1, bestN = 0;
    const bySuit = [[], [], [], []];
    for (const id of legal) {
      const c = WZ.card(id);
      if (c.kind !== 'color' || c.color === tc) continue;
      bySuit[c.color].push(id);
      if (bySuit[c.color].length > bestN) { bestN = bySuit[c.color].length; bestC = c.color; }
    }
    if (bestC >= 0) {
      return bySuit[bestC].sort(function (a, b) { return WZ.card(a).rank - WZ.card(b).rank; })[0];
    }
    const nc = legal.filter(function (id) { return !WZ.isWizard(id); });
    const pool = nc.length ? nc : legal;
    return pool.slice().sort(cmp)[0];
  }

  function follow(v, legal, mode, slack) {
    const cmp = byWeight(v);
    const winners = legal.filter(function (id) { return winsWith(v, id); });
    if (mode === 'MUST') {
      if (winners.length) {
        const asc = winners.slice().sort(cmp);
        for (const c of asc) if (safe(v, c)) return c;
        return asc[0];                              /* 没稳的：最便宜的赢牌硬上 */
      }
      return legal.slice().sort(cmp)[0];            /* 压不过 → 最低牌保留火力 */
    }
    if (mode === 'DUCK') {
      const non = legal.filter(function (id) { return !winsWith(v, id); });
      if (non.length) return non.sort(cmp)[0];
      return legal.slice().sort(cmp)[0];            /* 全都会赢 → 出最低 */
    }
    /* NEUTRAL：便宜能赢就赢（代价 ≤ 阈值），否则放水 */
    if (winners.length) {
      const asc = winners.slice().sort(cmp);
      const th = slack >= 2 ? 42 : 62;
      if (weight(asc[0], v.trumps) <= th) return asc[0];
    }
    const non = legal.filter(function (id) { return !winsWith(v, id); });
    if (non.length) return non.sort(cmp)[0];
    return legal.slice().sort(cmp)[0];
  }

  A.view = view;        /* 供测试与调试 */
  A.handValue = handValue;

  if (typeof module !== 'undefined' && module.exports) module.exports = A;
  if (root) root.WZAI = A;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
