'use strict';
/* 《牛头王》AI —— 只吃 SN.viewFor() 产出的“安全视图”（自己的手牌 + 公开信息），
   绝不接触完整状态，也不知道别人的手牌。
   不碰 DOM、不用 Math.random；随机一律走注入的 rng：
   同一 view + 同一 rng 序列 → 同一结果。
   → window.SixNimmtAI + module.exports */
(function (root) {
  const AI = {};

  AI.NAMES = ['铁角', '花斑', '小蛮', '老麦', '黑蹄', '铜铃', '雪球', '阿黄', '大角'];

  /* 供 UI/调试查看最近一次决策依据 */
  AI.lastReason = null;

  /* 与 SN.bullsOf 一致（AI 只拿得到视图，不依赖引擎模块） */
  function bulls(c) {
    if (c === 55) return 7;
    if (c % 11 === 0) return 5;
    if (c % 10 === 0) return 3;
    if (c % 10 === 5) return 2;
    return 1;
  }

  function total(cs) {
    let s = 0;
    for (let i = 0; i < cs.length; i++) s += bulls(cs[i]);
    return s;
  }

  function lastOf(cs) { return cs[cs.length - 1]; }

  /* ---------------- 难度参数 ---------------- */

  const LEVEL = {
    easy:   { noise: 7.0, random: 0.20, rowRandom: 0.35, look: 0.25, dump: 0.05, future: 0.10, low: 0.5 },
    normal: { noise: 2.5, random: 0.00, rowRandom: 0.00, look: 0.30, dump: 0.08, future: 0.15, low: 0.9 },
    hard:   { noise: 0.2, random: 0.00, rowRandom: 0.00, look: 0.30, dump: 0.10, future: 0.60, low: 0.7 }
  };
  function lv(d) { return LEVEL[d] || LEVEL.normal; }

  /* 暴露难度权重，便于调参与测试 */
  AI.LEVEL = LEVEL;

  let fallbackRng = null;
  function pickRng(rng) {
    if (typeof rng === 'function') return rng;
    if (!fallbackRng) {
      /* 没注入 rng 时也要确定性 */
      let a = 0x9e3779b9;
      fallbackRng = function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    return fallbackRng;
  }

  /* ---------------- 局面分析 ---------------- */

  function isRow(r) { return Array.isArray(r); }

  /* 落牌模拟：与引擎规则一致，只读 rows */
  function simulate(rows, card) {
    let idx = -1, best = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!isRow(r) || !r.length) continue;
      const e = lastOf(r);
      if (e < card && e > best) { best = e; idx = i; }
    }
    if (idx < 0) {
      const options = [];
      for (let i = 0; i < rows.length; i++) options.push(i);
      return { mustChoose: true, options: options };
    }
    const full = rows[idx].length >= 5;
    return {
      mustChoose: false, rowIndex: idx, full: full,
      bulls: full ? total(rows[idx]) : 0
    };
  }

  /* 落牌后的行副本（不收行的话这里就等价于实际结果） */
  function after(rows, card, rowIndex) {
    const out = [];
    for (let i = 0; i < rows.length; i++) out.push(isRow(rows[i]) ? rows[i].slice() : []);
    if (out[rowIndex].length >= 5) out[rowIndex] = [card];
    else out[rowIndex].push(card);
    return out;
  }

  /* 某一行“下一墩被撞上”的粗略概率：靠行尾与上一行行尾之间的空隙估 */
  function hitProb(rows, i) {
    const r = rows[i];
    if (!r.length) return 0;
    const end = lastOf(r);
    let nextEnd = 105;
    for (let j = 0; j < rows.length; j++) {
      if (j === i || !rows[j].length) continue;
      const e = lastOf(rows[j]);
      if (e > end && e < nextEnd) nextEnd = e;
    }
    const gap = Math.max(1, nextEnd - end);
    const p = gap / 70;
    return p < 0.05 ? 0.05 : (p > 0.75 ? 0.75 : p);
  }

  /* 桌面危险度：满 5 张的行是“随时会被撞的雷”，未满的行按牛头存量折算 */
  function hazard(rows) {
    let h = 0;
    for (let i = 0; i < rows.length; i++) {
      const cs = rows[i];
      if (!isRow(cs) || !cs.length) continue;
      const n = cs.length, b = total(cs), p = hitProb(rows, i);
      if (n >= 5) h += b * (0.40 + 0.60 * p);
      else h += b * (0.08 * n) * (0.5 + p);
    }
    return h;
  }

  /* 被迫选行时的最优行：付掉的牛头 + 桌面危险变化 */
  function bestRowFor(rows, card, difficulty) {
    const l = lv(difficulty);
    const base = hazard(rows);
    let bi = 0, bv = Infinity;
    for (let i = 0; i < rows.length; i++) {
      if (!isRow(rows[i]) || !rows[i].length) {
        if (bv === Infinity) { bi = i; bv = 0; }
        continue;
      }
      const paid = total(rows[i]);
      const nr = after(rows, card, i);
      let v = paid + l.look * (hazard(nr) - base);
      if (v < bv - 1e-9) { bv = v; bi = i; }
    }
    return { index: bi, cost: bv };
  }

  function minRowTotal(rows) {
    let m = Infinity;
    for (let i = 0; i < rows.length; i++) {
      if (!isRow(rows[i]) || !rows[i].length) continue;
      const t = total(rows[i]);
      if (t < m) m = t;
    }
    return isFinite(m) ? m : 0;
  }

  /* 这张牌此刻打出去会赔多少（不含长线风险） */
  function nowPain(rows, card) {
    const sim = simulate(rows, card);
    if (sim.mustChoose) return minRowTotal(rows);
    if (sim.full) return sim.bulls;
    return 0;
  }

  /* 自己剩余手牌在当前桌面上的平均痛点：
     越小说明这张桌面对“我手里这些牌”越友好（也就能避开满行地雷）。 */
  function handPain(hand, rows, skip) {
    if (!hand || !hand.length) return 0;
    let sum = 0, n = 0;
    for (let i = 0; i < hand.length; i++) {
      const c = hand[i];
      if (c === skip) continue;
      sum += nowPain(rows, c);
      n += 1;
    }
    return n ? sum / n : 0;
  }

  /* 单张牌的综合代价（越小越好） */
  function scoreCard(view, card, difficulty) {
    const rows = view.rows || [];
    const l = lv(difficulty);
    if (!rows.length) return -0.06 * (card / 104);

    const sim = simulate(rows, card);
    const base = hazard(rows);
    let imm = 0, next, target = sim.rowIndex;

    if (sim.mustChoose) {
      const pick = bestRowFor(rows, card, difficulty);
      imm = total(rows[pick.index]);
      next = after(rows, card, pick.index);
      target = pick.index;
    } else if (sim.full) {
      imm = sim.bulls;
      next = after(rows, card, sim.rowIndex);
    } else {
      next = after(rows, card, sim.rowIndex);
    }

    /* 1) 立刻吃进的牛头 */
    let cost = imm;
    /* 2) 桌面危险变化：满行 / 高牛头行越少越安全 */
    cost += l.look * (hazard(next) - base);
    /* 3) 长线：这手打完后，我手里剩下的牌平均还要赔多少 */
    cost += l.future * (handPain(view.hand, next, card) - handPain(view.hand, rows, card));
    /* 4) 把高牛头牌甩到别人难碰的行上（自己留着早晚变行尾） */
    const pTarget = rows[target] && rows[target].length ? hitProb(rows, target) : 0.5;
    cost -= l.dump * bulls(card) * (1 - pTarget);
    /* 5) 大牌先走，越晚出越容易被顶到行尾 */
    cost -= 0.06 * (card / 104);
    /* 6) 极小的牌是“选行门票”，别随手浪费 */
    if (card <= 12) cost += (13 - card) / 12 * l.low;

    return cost;
  }

  /* ---------------- 出牌 ---------------- */

  AI.chooseCard = function (view, difficulty, rng) {
    if (!view || !Array.isArray(view.hand) || !view.hand.length) {
      AI.lastReason = { card: null, why: 'no-hand' };
      return null;
    }
    const hand = view.hand.slice();
    const l = lv(difficulty);
    const rand = pickRng(rng);

    if (l.random && rand() < l.random) {
      const c = hand[(rand() * hand.length) | 0] || hand[0];
      AI.lastReason = { card: c, why: 'random' };
      return c;
    }

    let best = [hand[0]], bestV = Infinity;
    for (let i = 0; i < hand.length; i++) {
      const c = hand[i];
      const v = scoreCard(view, c, difficulty) + (rand() * 2 - 1) * l.noise;
      if (v < bestV - 1e-9) { bestV = v; best = [c]; }
      else if (v - bestV <= 1e-9) best.push(c);
    }
    const c = best[(rand() * best.length) | 0] || best[0];
    AI.lastReason = { card: c, score: Math.round(bestV * 1000) / 1000 };
    return c;
  };

  /* ---------------- 选行 ---------------- */

  AI.chooseRow = function (view, difficulty, rng) {
    const rows = (view && view.rows) || [];
    if (!rows.length) return 0;
    const l = lv(difficulty);
    const rand = pickRng(rng);
    const card = (view.pendingChoice && typeof view.pendingChoice.card === 'number')
      ? view.pendingChoice.card : null;

    if (l.rowRandom && rand() < l.rowRandom) {
      const i = (rand() * rows.length) | 0;
      AI.lastReason = { row: i, why: 'random-row' };
      return i;
    }

    let bi = 0, bv = Infinity;
    const hand = (view && Array.isArray(view.hand)) ? view.hand : [];
    const base = hazard(rows);
    for (let i = 0; i < rows.length; i++) {
      if (!isRow(rows[i]) || !rows[i].length) continue;
      let v;
      if (card !== null) {
        /* 收走哪一行 = 付多少牛头 + 桌面危险变化 + 剩余手牌的长线痛点 */
        const nr = after(rows, card, i);
        v = total(rows[i]) + l.look * (hazard(nr) - base);
        if (difficulty === 'hard') v += l.future * handPain(hand, nr, null);
        else v -= 0.02 * rows[i].length;
      } else {
        v = total(rows[i]) - 0.02 * rows[i].length;
      }
      v += (rand() * 2 - 1) * l.noise * 0.05;   /* 极小的同分扰动 */
      if (v < bv - 1e-9) { bv = v; bi = i; }
    }
    AI.lastReason = { row: bi, score: Math.round(bv * 1000) / 1000 };
    return bi;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  if (root) root.SixNimmtAI = AI;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));