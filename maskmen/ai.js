'use strict';
/* 《面具摔跤手》Maskmen —— 标准档 AI
   只读 viewFor() 安全视图；随机数用传入种子，完全可复现。

   标准档思路（经 2~6 人自对弈标定）：
   - 首家只出 1 张：优先出手里最少的花色（单张最难脱手，大色组留给多张爆发）；
     同数量时优先出「未见牌」多的花色——对手更可能攥着它，压住它等于废掉对手的牌。
   - 跟牌：能出多少出多少（进度就是一切，打空手牌自然优先）；
     同张数时，优先选择能打空一个色组的花色；若都要建立新关系，优先强化已强势的花色。
   - 跳过：整轮永久退出，会留下手牌，实战中几乎总是不划算；标准档只在无合法牌时跳过。 */
(function (root) {
  const AI = {};
  const C = 6;

  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function strongCount(v, c) {
    let n = 0;
    for (let z = 0; z < C; z++) if (v.relation[c][z]) n++;
    return n;
  }

  AI.choose = function (view, seed) {
    if (!view || !view.legal) return { type: 'pass' };
    const rand = seeded((seed >>> 0) || 1);
    const moves = view.legal.moves || [];

    if (view.legal.leader) {
      if (!moves.length) {
        for (let c = 0; c < C; c++) if (view.hand[c] > 0) return { type: 'play', color: c };
        return { type: 'pass' };
      }
      let best = moves[0];
      let bestScore = -Infinity;
      for (const m of moves) {
        const c = m.color;
        const s = -view.hand[c] * 10 + view.unseen[c] * 0.8 + rand() * 0.01;
        if (s > bestScore) { bestScore = s; best = m; }
      }
      return { type: 'play', color: best.color };
    }

    if (!moves.length) return { type: 'pass' };

    const prevColor = view.prevPlay.color;
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const c = m.color;
      const k = m.count;
      const isNew = !view.relation[c][prevColor] && !view.relation[prevColor][c];

      let s = k * 100;                       // 张数优先：进度 = 一切
      if (view.hand[c] === k) s += 3;        // 顺手打空一个色组
      if (isNew) s += strongCount(view, c) * 0.5; // 同张数时优先强化已强势花色
      s += rand() * 0.01;

      if (s > bestScore) { bestScore = s; best = m; }
    }
    return { type: 'play', color: best.color };
  };

  root.MaskmenAI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);