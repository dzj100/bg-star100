/**
 * 时序谜局 (Take Time) - 游戏逻辑
 * 负责：状态管理、发牌、看牌、聚光灯选先手、出牌、眼标记、结算判定、进度存储
 * 依赖：render.js（渲染函数）、net.js + online.js（联机层）
 */

// ========================================
// 常量
// ========================================

const STORAGE_KEY = 'taketime-state';
const PROGRESS_KEY = 'taketime-progress';
const SEG_COUNT = 6;
const MAX_EYE_BONUS = 3;
const CH_PER_CHAPTER = 4;

/** 玩家颜色（按座位顺序） */
const PLAYER_COLORS = ['#e94560', '#42a5f5', '#66bb6a', '#ffb74d'];

/** 每局每人手牌数 */
function cardsPerPlayer(n) {
  return n === 2 ? 6 : n === 3 ? 4 : 3;
}

// ========================================
// 关卡库：id = (章-1)*4 + 关
// check(sums, segments) 返回 { segOK, sumOK, ascOK, pass, items?, segBad? }
//   items  可选：自定义检查项展示 [{label, ok}]（缺省用默认三项）
//   segBad 可选：区域不满足高亮 [bool×6]（缺省 = 该区域不满足基础检查）
// 基础规则（无自定义 check 时）：每区域≥1张、每区域≤24、区域1→6递增
// ========================================

const CHALLENGE_LIB = {
  // ── 第1章 ──
  1: {
    name: '孤阳', chapter: 1, test: 1,
    desc: '1号位只能放1张太阳牌；6号位必须3张牌；本关无总和≤24限制',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(() => true); // 本关无 ≤24 限制
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const okS1 = segs[0].cards.length === 1 && segs[0].cards[0].color === 'sun';
      const okS6 = segs[5].cards.length === 3;
      const items = [
        { label: '1号位：恰好1张太阳牌', ok: okS1 },
        { label: '6号位：恰好3张牌', ok: okS6 },
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => i === 0 ? !okS1 : i === 5 ? !okS6 : !segOK[i]);
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: okS1 && okS6 && segOK.every(Boolean) && ascOK,
      };
    },
  },
  2: {
    name: '枢衡', chapter: 1, test: 2,
    desc: '3号位数字总和8~12；4号位必须3张牌；本关无总和≤24限制',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(() => true);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const okS3 = sums[2] >= 8 && sums[2] <= 12;
      const okS4 = segs[3].cards.length === 3;
      const items = [
        { label: '3号位：总和在8~12之间', ok: okS3 },
        { label: '4号位：恰好3张牌', ok: okS4 },
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => i === 2 ? !okS3 : i === 3 ? !okS4 : !segOK[i]);
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: okS3 && okS4 && segOK.every(Boolean) && ascOK,
      };
    },
  },
  3: {
    name: '序引', chapter: 1, test: 3,
    desc: '第1张牌放3号位、第2张牌放2号位；6号位总和20~30；本关无总和≤24限制',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(() => true);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const firstInS3 = segs[2].cards.some(c => c.order === 1);
      const secondInS2 = segs[1].cards.some(c => c.order === 2);
      const okS6 = sums[5] >= 20 && sums[5] <= 30;
      const items = [
        { label: '第1张牌放在3号位', ok: firstInS3 },
        { label: '第2张牌放在2号位', ok: secondInS2 },
        { label: '6号位：总和在20~30之间', ok: okS6 },
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => i === 2 ? !firstInS3 : i === 1 ? !secondInS2 : i === 5 ? !okS6 : !segOK[i]);
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: firstInS3 && secondInS2 && okS6 && segOK.every(Boolean) && ascOK,
      };
    },
  },
  4: {
    name: '近六', chapter: 1, test: 4,
    desc: '1号位总和比其他位置更接近6；4号位必须1张太阳+1张月亮；每个位置的总和必须≤24',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const d1 = Math.abs(sums[0] - 6);
      const okClosest = segs.every((_, i) => i === 0 || Math.abs(sums[i] - 6) > d1);
      const s4 = segs[3].cards;
      const okS4 = s4.length === 2 && s4.some(c => c.color === 'sun') && s4.some(c => c.color === 'moon');
      const items = [
        { label: '1号位：总和最接近6', ok: okClosest },
        { label: '4号位：1张太阳+1张月亮', ok: okS4 },
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => i === 0 ? !okClosest : i === 3 ? !okS4 : !(segOK[i] && sumOK[i]));
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: okClosest && okS4 && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
  // ── 第2章 ──
  5: {
    name: '禁三', chapter: 2, test: 1,
    desc: '1号位不能放1/2/3；2号位不能放1/2/3；3号位不能放1/2/3',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const forbid123 = seg => seg.cards.every(c => c.v > 3);
      const okS0 = forbid123(segs[0]);
      const okS1 = forbid123(segs[1]);
      const okS2 = forbid123(segs[2]);
      const items = [
        { label: '1号位：没有1/2/3', ok: okS0 },
        { label: '2号位：没有1/2/3', ok: okS1 },
        { label: '3号位：没有1/2/3', ok: okS2 },
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => i <= 2 ? (i === 0 ? !okS0 : i === 1 ? !okS1 : !okS2) : !(segOK[i] && sumOK[i]));
      return { segOK, sumOK, ascOK, items, segBad, pass: okS0 && okS1 && okS2 && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK };
    },
  },
  6: {
    name: '禁高', chapter: 2, test: 2,
    desc: '3号位不能放7/8/9；4号位不能放7/8/9',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const forbid789 = seg => seg.cards.every(c => c.v < 7 || c.v > 9);
      const okS2 = forbid789(segs[2]);
      const okS3 = forbid789(segs[3]);
      const items = [
        { label: '3号位：没有7/8/9', ok: okS2 },
        { label: '4号位：没有7/8/9', ok: okS3 },
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => i === 2 ? !okS2 : i === 3 ? !okS3 : !(segOK[i] && sumOK[i]));
      return { segOK, sumOK, ascOK, items, segBad, pass: okS2 && okS3 && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK };
    },
  },
  7: {
    name: '四禁', chapter: 2, test: 3,
    desc: '1号位不能放1/2/3；3号位不能放4/5/6；4号位不能放7/8/9；6号位不能放10/11/12',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const okS0 = segs[0].cards.every(c => c.v > 3);
      const okS2 = segs[2].cards.every(c => c.v < 4 || c.v > 6);
      const okS3 = segs[3].cards.every(c => c.v < 7 || c.v > 9);
      const okS5 = segs[5].cards.every(c => c.v < 10 || c.v > 12);
      const items = [
        { label: '1号位：没有1/2/3', ok: okS0 },
        { label: '3号位：没有4/5/6', ok: okS2 },
        { label: '4号位：没有7/8/9', ok: okS3 },
        { label: '6号位：没有10/11/12', ok: okS5 },
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => i === 0 ? !okS0 : i === 2 ? !okS2 : i === 3 ? !okS3 : i === 5 ? !okS5 : !(segOK[i] && sumOK[i]));
      return { segOK, sumOK, ascOK, items, segBad, pass: okS0 && okS2 && okS3 && okS5 && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK };
    },
  },
  8: {
    name: '无眼', chapter: 2, test: 4,
    desc: '不能使用眼标记',
    noEye: true,
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      return { segOK, sumOK, ascOK, items, segBad, pass: segOK.every(Boolean) && sumOK.every(Boolean) && ascOK };
    },
  },
  // ── 第3章 ──
  /**
   * 定首（第3章第1关）：6 个条件的顺序固定，但房主要在看牌前
   * 把其中一个条件指定到 1 号位，其余条件按原顺序顺延到 2~6 号位。
   * rotate 标记：discuss 阶段由房主选定 1 号位条件后才能看牌。
   */
  9: {
    name: '定首', chapter: 3, test: 1,
    rotate: true,
    conds: [
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'max', label: '含1张数字最大的牌', short: '含最大牌' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'close20', label: '总和最接近20', short: '最接近20' },
      { key: 'free', label: '无限制', short: '无限制' },
    ],
    desc: '区域规则为“无限制->无限制->含1张数字最大的牌->无限制->总和最接近20->无限制”；看牌前，房主可自行将限制条件按顺序设置到对应区域',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      const conds = S.segCond || [];
      let condOK = true;
      conds.forEach((cond, i) => {
        if (cond.key === 'max') {
          const maxV = Math.max(...segs.flatMap(s => s.cards.map(c => c.v)));
          const ok = segs[i].cards.some(c => c.v === maxV);
          items.push({ label: `${i + 1}号位：包含全场最大数字牌 （${maxV}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'close20') {
          const d = Math.abs(sums[i] - 20);
          const ok = segs.every((_, j) => j === i || Math.abs(sums[j] - 20) > d);
          items.push({ label: `${i + 1}号位：总和最接近20（${sums[i]}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        }
      });
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: condOK && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
  /**
   * 双锚（第3章第2关）：两个锚点区域须分别放置全场数字最小的两张牌
   * （最小/次小，顺序不限）+ 最后一张牌条件，与定首一样
   * 由房主在看牌前指定 1 号位条件，其余循环顺延。
   */
  10: {
    name: '双锚', chapter: 3, test: 2,
    rotate: true,
    conds: [
      { key: 'min', label: '含1张数字最小/次小的牌', short: '含最小牌' },
      { key: 'last', label: '最后1张牌放这里', short: '最后1张牌' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'min', label: '含1张数字最小/次小的牌', short: '含最小牌' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
    ],
    desc: '区域规则为“含1张数字最小/次小的牌->最后1张牌放这里->无限制->含1张数字最小/次小的牌->无限制->无限制”；看牌前，房主可自行将限制条件按顺序设置到对应区域',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      const conds = S.segCond || [];
      // 候选 = 全场数字最小的两张牌（按数字排序取前2张，阈值=第2张的数字）：
      // 所有 ≤ 阈值的牌都算候选。例：最小数字1有两张时，次小的2不在候选内；
      // 最小数字只有1张时，次小数字的牌补入候选（共2~3张）。
      const allCards = segs.flatMap(s => s.cards);
      const sortedV = allCards.map(c => c.v).sort((a, b) => a - b);
      const minV = sortedV[0];
      const candMax = sortedV.length >= 2 ? sortedV[1] : sortedV[0];
      const isCandidate = c => c.v <= candMax;
      const isAnchor = c => c.key === 'min';
      const anchorIdx = conds.map((c, i) => isAnchor(c) ? i : -1).filter(i => i >= 0);
      const anchorCards = anchorIdx.flatMap(i => segs[i].cards);
      let condOK = anchorIdx.every(i => segs[i].cards.some(isCandidate)) // 每个锚点区域至少1张候选
        && anchorCards.filter(isCandidate).length >= 2                    // 合计至少2张候选
        && anchorCards.some(c => c.v === minV);                           // 必须含最小数字牌
      conds.forEach((cond, i) => {
        if (isAnchor(cond)) {
          const ok = segs[i].cards.some(isCandidate);
          items.push({ label: `${i + 1}号位：包含全场最小或次小的牌（${minV}${candMax !== minV ? '/' + candMax : ''}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'last') {
          const lastOrder = Math.max(...segs.flatMap(s => s.cards.map(c => c.order || 0)));
          const ok = segs[i].cards.some(c => c.order === lastOrder);
          items.push({ label: `${i + 1}号位：最后一张牌（第${lastOrder}张）放这里`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        }
      });
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: condOK && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
  /**
   * 前二（第3章第3关）：第1张、第2张牌必须放在同一区域，外加最小/最大牌锚点。
   */
  11: {
    name: '前二', chapter: 3, test: 3,
    rotate: true,
    conds: [
      { key: 'min', label: '含1张数字最小的牌', short: '含最小牌' },
      { key: 'first2', label: '第1张、第2张牌放这里', short: '第1、2张牌' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'max', label: '含1张数字最大的牌', short: '含最大牌' },
      { key: 'free', label: '无限制', short: '无限制' },
    ],
    desc: '区域规则为“含1张数字最小的牌->第1张、第2张牌放这里->无限制->无限制->含1张数字最大的牌->无限制”；看牌前，房主可自行将限制条件按顺序设置到对应区域',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      const conds = S.segCond || [];
      let condOK = true;
      conds.forEach((cond, i) => {
        if (cond.key === 'min') {
          const minV = Math.min(...segs.flatMap(s => s.cards.map(c => c.v)));
          const ok = segs[i].cards.some(c => c.v === minV);
          items.push({ label: `${i + 1}号位：包含全场最小数字牌（${minV}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'max') {
          const maxV = Math.max(...segs.flatMap(s => s.cards.map(c => c.v)));
          const ok = segs[i].cards.some(c => c.v === maxV);
          items.push({ label: `${i + 1}号位：包含全场最大数字牌（${maxV}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'first2') {
          const ok = segs[i].cards.some(c => c.order === 1) && segs[i].cards.some(c => c.order === 2);
          items.push({ label: `${i + 1}号位：第1张、第2张牌放这里`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        }
      });
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: condOK && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
  /**
   * 双曜（第3章第4关）：总和最接近6 + 最小太阳牌/最大月亮牌锚点 + 某区域恰好2张。
   */
  12: {
    name: '双曜', chapter: 3, test: 4,
    rotate: true,
    conds: [
      { key: 'close6', label: '总和最接近6', short: '最接近6' },
      { key: 'minSun', label: '含1张数字最小的太阳牌', short: '最小太阳' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'maxMoon', label: '含1张数字最大的月亮牌', short: '最大月亮' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'exact2', label: '必须放2张牌', short: '放2张牌' },
    ],
    desc: '区域规则为“总和最接近6->含1张数字最小的太阳牌->无限制->含1张数字最大的月亮牌->无限制->必须放2张牌”；看牌前，房主可自行将限制条件按顺序设置到对应区域',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      const conds = S.segCond || [];
      const allCards = segs.flatMap(s => s.cards);
      const suns = allCards.filter(c => c.color === 'sun');
      const moons = allCards.filter(c => c.color === 'moon');
      const minSunV = suns.length ? Math.min(...suns.map(c => c.v)) : Infinity;
      const maxMoonV = moons.length ? Math.max(...moons.map(c => c.v)) : -Infinity;
      let condOK = true;
      conds.forEach((cond, i) => {
        if (cond.key === 'close6') {
          const d = Math.abs(sums[i] - 6);
          const ok = segs.every((_, j) => j === i || Math.abs(sums[j] - 6) > d);
          items.push({ label: `${i + 1}号位：总和最接近6（${sums[i]}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'minSun') {
          const ok = segs[i].cards.some(c => c.color === 'sun' && c.v === minSunV);
          items.push({ label: `${i + 1}号位：包含全场最小太阳牌（${isFinite(minSunV) ? minSunV : '无'}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'maxMoon') {
          const ok = segs[i].cards.some(c => c.color === 'moon' && c.v === maxMoonV);
          items.push({ label: `${i + 1}号位：包含全场最大月亮牌（${isFinite(maxMoonV) ? maxMoonV : '无'}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'exact2') {
          const ok = segs[i].cards.length === 2;
          items.push({ label: `${i + 1}号位：恰好放2张牌（${segs[i].cards.length}张）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        }
      });
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: condOK && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
  // ── 第4章 ──
  13: {
    name: '序位', chapter: 4, test: 1,
    rotate: true, playOrder: 'desc',
    conds: [
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'exact1', label: '仅1张牌', short: '仅1张牌' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'firstCard', label: '第1张牌放这里', short: '第1张牌' },
    ],
    desc: '区域规则为“无限制->无限制->仅1张牌->无限制->无限制->第1张牌放这里”；看牌前，房主可自行将限制条件按顺序设置到对应区域；玩家必须从大到小出牌',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      const conds = S.segCond || [];
      let condOK = true;
      conds.forEach((cond, i) => {
        if (cond.key === 'exact1') {
          const ok = segs[i].cards.length === 1;
          items.push({ label: `${i + 1}号位：恰好放1张牌（${segs[i].cards.length}张）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'firstCard') {
          const ok = segs[i].cards.some(c => c.order === 1);
          items.push({ label: `${i + 1}号位：第1张牌放这里`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        }
      });
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: condOK && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
  14: {
    name: '极序', chapter: 4, test: 2,
    rotate: true, playOrder: 'asc',
    conds: [
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'firstCard', label: '第1张牌放这里', short: '第1张牌' },
      { key: 'max', label: '含1张数字最大的牌', short: '含最大牌' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
    ],
    desc: '区域规则为“无限制->第1张牌放这里->含1张数字最大牌->无限制->无限制->无限制”；看牌前，房主可自行将限制条件按顺序设置到对应区域；玩家必须从小到大出牌',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      const conds = S.segCond || [];
      const allCards = segs.flatMap(s => s.cards);
      const maxV = allCards.length ? Math.max(...allCards.map(c => c.v)) : 0;
      let condOK = true;
      conds.forEach((cond, i) => {
        if (cond.key === 'firstCard') {
          const ok = segs[i].cards.some(c => c.order === 1);
          items.push({ label: `${i + 1}号位：第1张牌放这里`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'max') {
          const ok = segs[i].cards.some(c => c.v === maxV);
          items.push({ label: `${i + 1}号位：包含全场最大数字牌（${maxV}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        }
      });
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: condOK && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
  15: {
    name: '禁数', chapter: 4, test: 3,
    rotate: true, playLock: true,
    conds: [
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'no123', label: '不含1、2、3数字牌', short: '不含1、2、3' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'no123', label: '不含1、2、3数字牌', short: '不含1、2、3' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'no123', label: '不含1、2、3数字牌', short: '不含1、2、3' },
    ],
    desc: '区域规则为“无限制->不含1、2、3数字牌->无限制->不含1、2、3数字牌->无限制->不含1、2、3数字牌”；看牌前，房主可自行将限制条件按顺序设置到对应区域；玩家不能改变手牌顺序，必须从左到右打出',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      const conds = S.segCond || [];
      let condOK = true;
      conds.forEach((cond, i) => {
        if (cond.key === 'no123') {
          const ok = segs[i].cards.every(c => c.v > 3);
          const banned = segs[i].cards.filter(c => c.v <= 3).map(c => c.v);
          items.push({ label: `${i + 1}号位：不含1、2、3数字牌${banned.length ? '（含' + banned.join('、') + '）' : ''}`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        }
      });
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: condOK && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
  16: {
    name: '均衡', chapter: 4, test: 4,
    rotate: true, playLock: true,
    conds: [
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'free', label: '无限制', short: '无限制' },
      { key: 'close12', label: '总和最接近12', short: '最接近12' },
      { key: 'min', label: '含1张数字最小的牌', short: '含最小牌' },
      { key: 'max', label: '含1张数字最大的牌', short: '含最大牌' },
    ],
    desc: '区域规则“无限制->无限制->无限制->总和最接近12->含1张数字最小的牌->含1张数字最大的”；看牌前，房主可自行将限制条件按顺序设置到对应区域；玩家不能改变手牌顺序，必须从左到右打出',
    check(sums, segs) {
      const segOK = segs.map(seg => seg.cards.length >= 1);
      const sumOK = sums.map(s => s <= 24);
      const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
      const items = [
        { label: '每区域至少1张', ok: segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: sumOK.every(Boolean) },
        { label: '区域1→6总和递增', ok: ascOK },
      ];
      const segBad = segs.map((_, i) => !(segOK[i] && sumOK[i]));
      const conds = S.segCond || [];
      const allCards = segs.flatMap(s => s.cards);
      const minV = allCards.length ? Math.min(...allCards.map(c => c.v)) : 0;
      const maxV = allCards.length ? Math.max(...allCards.map(c => c.v)) : 0;
      let condOK = true;
      conds.forEach((cond, i) => {
        if (cond.key === 'close12') {
          const d = Math.abs(sums[i] - 12);
          const ok = segs.every((_, j) => j === i || Math.abs(sums[j] - 12) > d);
          items.push({ label: `${i + 1}号位：总和最接近12（${sums[i]}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'min') {
          const ok = segs[i].cards.some(c => c.v === minV);
          items.push({ label: `${i + 1}号位：包含全场最小数字牌（${minV}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        } else if (cond.key === 'max') {
          const ok = segs[i].cards.some(c => c.v === maxV);
          items.push({ label: `${i + 1}号位：包含全场最大数字牌（${maxV}）`, ok });
          if (!ok) { segBad[i] = true; condOK = false; }
        }
      });
      return {
        segOK, sumOK, ascOK, items, segBad,
        pass: condOK && segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
      };
    },
  },
};

/** 通过 window 暴露（测试扩展用） */
Object.defineProperty(window, 'CHALLENGE_LIB', { get: () => CHALLENGE_LIB });

function defaultCheck(sums, segments) {
  const segOK = segments.map(seg => seg.cards.length >= 1);
  const sumOK = sums.map(s => s <= 24);
  const ascOK = sums.every((s, i) => i === 0 || s >= sums[i - 1]);
  return {
    segOK, sumOK, ascOK,
    pass: segOK.every(Boolean) && sumOK.every(Boolean) && ascOK,
  };
}

/** 关卡规则文案（未收录的关卡用默认规则描述） */
function challengeDesc(ch) {
  const lib = CHALLENGE_LIB[ch.id];
  if (lib && lib.desc) return lib.desc;
  return '每区域至少1张；每区域总和≤24；区域1→6总和递增';
}

/** 按关卡规则结算（未收录的关卡用默认规则） */
function challengeCheck(ch, sums, segments) {
  const lib = CHALLENGE_LIB[ch.id];
  if (lib && lib.check) return lib.check(sums, segments);
  return defaultCheck(sums, segments);
}

let S = { phase: 'landing', players: [] };
/** 通过 window.S 暴露（联机层与测试均依赖） */
Object.defineProperty(window, 'S', { get: () => S, set: (v) => { S = v; } });

/** 等候室选关（房主本地） */
let pendingChallenge = { chapter: 1, test: 1 };

/** 出牌弹层本地状态（不共享） */
let pendingPlay = null;
/** 通过 window 暴露（测试/调试用） */
Object.defineProperty(window, '_pendingPlay', { get: () => pendingPlay, set: (v) => { pendingPlay = v; } });

/** 聚光灯本地定时器（不共享） */
let spinTimer = null;

// ========================================
// 工具
// ========================================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function mySeat() {
  if (typeof window._olSeatIndex === 'function') {
    const s = window._olSeatIndex();
    if (typeof s === 'number') return s;
  }
  return null;
}

function isHost() {
  return typeof window._olIsHost === 'function' ? window._olIsHost() : false;
}

/** 联机模式下是否为合法操作者 */
function isActor() {
  return typeof window._olIsActor !== 'function' || window._olIsActor();
}

/**
 * 当前有效操作座位：本人；若轮到已离席玩家且本人是房主（接管中），
 * 返回离席座位，使房主能查看/拖拽/放置被接管玩家的手牌。
 */
function actionSeat() {
  const me = mySeat();
  if (me === null) return null;
  if (S.currentSeat === me) return me;
  if (isHost() && (S.departedPlayers || []).includes(S.currentSeat)) return S.currentSeat;
  return me;
}

function eyeLeft() {
  return S.eyeBase + S.eyeBonus - S.eyeUsed;
}

/** 已打出的牌总数 */
function placedCount() {
  return S.segments.reduce((a, seg) => a + seg.cards.length, 0);
}

/**
 * 2人局特殊规则：看牌后只展示前4张，双方各打出2张牌（共4张）后解锁后2张。
 * 返回当前被锁定（不可查看/选择）的手牌索引集合。
 * 锁定基于发牌时的 lock 标记（随 splice 移动），保证出牌后仍指向原后2张。
 * 接管时以被接管玩家的手牌为准（actionSeat）。
 */
function handLockedIndexes() {
  if (S.players.length !== 2) return new Set();
  if (S.phase === 'discuss' || placedCount() >= 4) return new Set();
  const me = actionSeat();
  if (me === null) return new Set();
  return new Set(S.players[me].hand.map((c, i) => c.lock ? i : -1).filter(i => i >= 0));
}

// ========================================
// 进度存储（关卡赠送眼标记 / 通过状态）
// ========================================

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    return p && typeof p === 'object' ? p : {};
  } catch (e) { return {}; }
}

function saveProgress(p) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) {}
}

/** 幂等更新本地进度（settleStamp 防重复累加） */
function updateLocalProgress(id, pass, stamp) {
  const prog = loadProgress();
  const cur = prog[id] || {};
  if (cur.lastStamp === stamp) return;
  if (pass) {
    prog[id] = { bonus: 0, passed: true, lastStamp: stamp };
  } else {
    prog[id] = { bonus: Math.min((cur.bonus || 0) + 1, MAX_EYE_BONUS), passed: false, lastStamp: stamp };
  }
  saveProgress(prog);
  console.log('[taketime] progress updated:', id, pass ? 'PASS' : 'FAIL', prog[id].bonus);
}

/** 清除某关卡进度（退出房间时调用：重建房间后从全新挑战开始） */
function resetChallengeProgress(id) {
  const prog = loadProgress();
  if (!prog[id]) return;
  delete prog[id];
  saveProgress(prog);
  console.log('[taketime] progress reset:', id);
}

/** 联机层退出房间前调用：重置本关（当前 S.challenge）的进度与赠送标记。
 *  已通过的关卡保留通关记录（长期进度），仅清除未通过的（防刷眼标记）。 */
window._olResetProgress = function() {
  if (S && S.challenge && typeof S.challenge.id === 'number') {
    const cur = loadProgress()[S.challenge.id] || {};
    if (cur.passed) return;
    resetChallengeProgress(S.challenge.id);
  }
};

// ========================================
// 日志
// ========================================

function addLog(msg, cls) {
  S.log = S.log || [];
  S.log.push({ t: Date.now(), msg, cls: cls || '' });
  if (S.log.length > 40) S.log = S.log.slice(-40);
  console.log('[taketime]', msg);
}

// ========================================
// 状态持久化（联机钩子：saveState 末尾推送）
// ========================================

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) {}
  if (typeof onlinePushState === 'function') onlinePushState();
}

function clearState() {
  clearSpinTimer();
  pendingPlay = null;
  S = { phase: 'landing', players: [], log: [], gameOver: false };
}

// ========================================
// 发牌
// ========================================

function dealGame(names, challenge) {
  const n = names.length;
  const per = cardsPerPlayer(n);
  // 牌组：1~12 每个数字各有太阳/月亮 1 张，共 24 张；每局只发 12 张（数字可能重复或缺号）
  const deck = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    .flatMap(v => [{ v, color: 'sun' }, { v, color: 'moon' }]));

  const ch = challenge || {
    ...pendingChallenge,
    id: (pendingChallenge.chapter - 1) * CH_PER_CHAPTER + pendingChallenge.test,
  };
  ch.desc = challengeDesc(ch);

  const progress = loadProgress();
  const bonus = (progress[ch.id] || {}).bonus || 0;

  const players = names.map((name, i) => ({
    name,
    hand: deck.slice(i * per, (i + 1) * per),
  }));
  // 2人局：后2张标记锁定（随出牌 splice 移动，解锁前始终指向原后2张）
  if (n === 2 && per === 6) {
    players.forEach(p => p.hand.forEach((c, i) => { if (i >= 4) c.lock = true; }));
  }

  S = {
    players,
    phase: 'discuss',
    challenge: ch,
    segments: Array.from({ length: SEG_COUNT }, () => ({ cards: [] })),
    firstSeat: null,
    currentSeat: 0,
    turnNo: 0,
    eyeBase: n,
    eyeBonus: bonus,
    eyeUsed: 0,
    spin: { running: false, seat: 0, tick: 0 },
    allPlaced: false,
    settled: false,
    pass: null,
    sums: null,
    check: null,
    settleStamp: 0,
    log: [],
    gameOver: false,
  };
  pendingPlay = null;

  // 关卡覆盖：禁止使用眼标记
  const lib = CHALLENGE_LIB[ch.id];
  if (lib && lib.noEye) { S.eyeBase = 0; S.eyeBonus = 0; }
  // 定首类关卡：先手选定前不分配区域条件（聚光灯停止后进入 cond 阶段）
  if (lib && lib.rotate) S.segCond = null;

  const eyeTotal = S.eyeBase + S.eyeBonus;
  addLog(`第${ch.chapter}章·第${ch.test}关 挑战开始：每人${per}张手牌 本关共${eyeTotal}个眼标记`);
  console.log(`[taketime] deal ${n} players x ${per} cards, eyeBase=${S.eyeBase}, eyeBonus=${S.eyeBonus}`);
  saveState();
  render();
}

// ========================================
// 看牌（仅房主）
// ========================================

function hostReveal() {
  if (!isHost() || !isActor()) return;
  if (S.phase !== 'discuss') return;
  // 定首类关卡：看牌前必须先确定 1 号位条件（讨论才有方向）
  const lib = CHALLENGE_LIB[S.challenge.id];
  if (lib && lib.rotate && !S.segCond) {
    showToast('请先选择 1 号位条件');
    return;
  }
  S.phase = 'reveal';
  addLog('房主点击看牌，所有人可以查看自己的手牌');
  saveState();
  render();
}

// ========================================
// 聚光灯选先手
// ========================================

function clearSpinTimer() {
  if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }
}

/** 房主启动聚光灯（所有客户端播放本地动画） */
function hostStartSpin() {
  if (!isHost() || !isActor()) return;
  if (S.phase !== 'reveal') return;
  S.phase = 'spin';
  S.spin = { running: true, seat: Math.floor(Math.random() * S.players.length), tick: 0 };
  addLog('聚光灯转动中…');
  saveState();
  render();
}

/** 房主停止聚光灯，确定先手 */
function hostStopSpin() {
  clearSpinTimer();
  if (!isHost() || !isActor()) return;
  if (S.phase !== 'spin') return;
  S.phase = 'play';
  S.spin.running = false;
  S.firstSeat = S.spin.seat;
  S.currentSeat = S.spin.seat;
  addLog(`${S.players[S.firstSeat].name} 成为先手，轮到他出牌`);
  saveState();
  render();
}

/** 聚光灯动画 tick（本地执行，不推送） */
function spinTick() {
  if (S.phase !== 'spin' || !S.spin.running) return;
  S.spin.seat = (S.spin.seat + 1) % S.players.length;
  S.spin.tick++;
  const rounds = Math.floor(S.spin.tick / S.players.length);
  if (rounds >= 3 && isHost()) {
    hostStopSpin();
  } else {
    render();
  }
}

// ========================================
// 定首（第3章第1关）：房主在看牌前指定 1 号位条件
// ========================================

/** 选中原顺序下标 idx 的条件作为 1 号位，其余条件从选中项之后按循环顺序填到 2~6 号位（与滚轮视觉顺序一致） */
function buildSegConds(idx) {
  const lib = CHALLENGE_LIB[S.challenge.id];
  const conds = lib.conds.map(c => ({ ...c }));
  const n = conds.length;
  return Array.from({ length: n }, (_, i) => ({ ...conds[(idx + i) % n] }));
}

/**
 * 房主在讨论阶段（看牌前）预览 1 号位条件：可反复重新预览覆盖，
 * 各区域条件实时渲染给所有玩家；一旦看牌（phase 离开 discuss）即锁定不可变更。
 */
function chooseFirstCond(idx) {
  if (S.phase !== 'discuss') return;
  if (!isHost() || !isActor()) return;
  const lib = CHALLENGE_LIB[S.challenge.id];
  if (!lib || !lib.rotate || !lib.conds || !lib.conds[idx]) return;
  const previewing = !!S.segCond;
  S.segCond = buildSegConds(idx);
  addLog(previewing
    ? `预览条件已更新：1号位 ${lib.conds[idx].label}（其余按下方顺序顺延）`
    : `预览条件：1号位 ${lib.conds[idx].label}（其余按下方顺序顺延），所有玩家可见`);
  saveState();
  render();
}

// ========================================
// 出牌
// ========================================

function isMyTurn() {
  if (S.phase !== 'play') return false;
  const me = mySeat();
  if (me === null) return false;
  if (S.currentSeat === me) return true;
  // 轮到已离席玩家时，房主可代其操作
  return isHost() && (S.departedPlayers || []).includes(S.currentSeat);
}

/**
 * 第4章：出牌顺序/手牌顺序限制
 * 返回指定手牌索引是否被 chapter 规则禁用（不可选）。
 */
function chapterLockedIndexes() {
  const lib = CHALLENGE_LIB[S.challenge.id];
  if (!lib) return new Set();
  const seat = actionSeat();
  if (seat === null) return new Set();
  const hand = S.players[seat].hand;
  const locked = handLockedIndexes();
  const disabled = new Set();

  if (lib.playOrder === 'desc') {
    // 只能出当前最大值的牌
    const visible = hand.filter((_, i) => !locked.has(i));
    if (visible.length === 0) return disabled;
    const maxV = Math.max(...visible.map(c => c.v));
    hand.forEach((_, i) => { if (!locked.has(i) && hand[i].v !== maxV) disabled.add(i); });
  } else if (lib.playOrder === 'asc') {
    // 只能出当前最小值的牌
    const visible = hand.filter((_, i) => !locked.has(i));
    if (visible.length === 0) return disabled;
    const minV = Math.min(...visible.map(c => c.v));
    hand.forEach((_, i) => { if (!locked.has(i) && hand[i].v !== minV) disabled.add(i); });
  } else if (lib.playLock) {
    // 只能出最左边的牌
    hand.forEach((_, i) => { if (i > 0 && !locked.has(i)) disabled.add(i); });
  }
  return disabled;
}

function selectCard(i) {
  if (!isMyTurn() || !isActor()) return;
  const seat = actionSeat();
  if (seat === null || !S.players[seat].hand[i]) return;
  if (handLockedIndexes().has(i)) return; // 2人局后2张未解锁，不可选择
  if (chapterLockedIndexes().has(i)) return; // 第4章出牌限制
  pendingPlay = { cardIndex: i, seg: -1, useEye: false };
  render();
}

function pickSeg(i) {
  if (!pendingPlay) return;
  if (i < 0 || i >= SEG_COUNT) return;
  pendingPlay.seg = i;
  render();
}

function toggleEye() {
  if (!pendingPlay) return;
  if (eyeLeft() <= 0) return;
  pendingPlay.useEye = !pendingPlay.useEye;
  render();
}

function closePlaySheet() {
  pendingPlay = null;
  render();
}

/** 当前玩家放置选中的牌到区域（接管时放置被接管玩家的牌） */
function placeCard() {
  if (!isMyTurn() || !isActor()) return;
  if (!pendingPlay || pendingPlay.seg === -1) return;
  if (pendingPlay.useEye && eyeLeft() <= 0) return;

  const me = actionSeat();
  if (me === null) return;
  const card = S.players[me].hand.splice(pendingPlay.cardIndex, 1)[0];
  if (!card) return;
  card.revealed = pendingPlay.useEye;
  card.by = me;
  card.fresh = true; // 新放置的牌：区域渲染时播放入场动效
  card.order = S.turnNo + 1; // 全局放置序号（第3关「第1张/第2张」规则用）
  S.segments[pendingPlay.seg].cards.push(card);
  if (pendingPlay.useEye) S.eyeUsed++;

  addLog(
    pendingPlay.useEye
      ? `${S.players[me].name} 明置 ☀${card.v} 到区域${pendingPlay.seg + 1}（用1眼标记）`
      : `${S.players[me].name} 暗置1张牌到区域${pendingPlay.seg + 1}`
  );
  console.log('[taketime] place:', card.v, '-> seg', pendingPlay.seg, 'revealed', pendingPlay.useEye);

  pendingPlay = null;
  S.turnNo++;

  if (S.players.every(p => p.hand.length === 0)) {
    S.allPlaced = true;
    addLog('所有手牌已放置，可以翻开结算');
  } else {
    S.currentSeat = (S.currentSeat + 1) % S.players.length;
  }
  saveState();
  render();
}

// ========================================
// 结算（仅房主）
// ========================================

function settle() {
  if (!S.allPlaced || S.settled) return;
  if (!isHost()) return;
  const me = mySeat();
  if (me === null) return;

  // 让结算者成为 currentSeat，保证联机 canPush 通过
  S.currentSeat = me;
  S.phase = 'result';
  S.settled = true;
  S.settleStamp = Date.now();

  // 翻开全部牌（全部播放翻开动效）
  S.segments.forEach(seg => seg.cards.forEach(c => { c.revealed = true; c.fresh = true; }));

  S.sums = S.segments.map(seg => seg.cards.reduce((a, c) => a + c.v, 0));
  S.check = challengeCheck(S.challenge, S.sums, S.segments);
  S.pass = S.check.pass;

  if (S.pass) {
    S.eyeBonus = 0;
    addLog('🎉 挑战成功！所有区域满足要求');
  } else {
    S.eyeBonus = Math.min(S.eyeBonus + 1, MAX_EYE_BONUS);
    addLog('❌ 未通关，获赠 1 个眼标记（下次挑战本关可用）');
  }
  updateLocalProgress(S.challenge.id, S.pass, S.settleStamp);
  console.log('[taketime] settle:', S.sums, 'pass=', S.pass);
  saveState();
  render();
}

// ========================================
// 再来一局（仅房主，同关卡重发牌）
// ========================================

function restartChallenge() {
  if (!isHost()) return;
  if (S.phase !== 'result') return;
  // 先把 currentSeat 改为自己，保证联机 isActor/canPush 通过
  // （结算后 currentSeat 是结算者，可能不是房主）
  const seat = mySeat();
  if (seat !== null) S.currentSeat = seat;
  if (!isActor()) return;
  const names = S.players.map(p => p.name);
  const ch = { ...S.challenge };
  dealGame(names, ch);
}

/** 下一关（仅房主，通关后进入后一关；跨章自动衔接；无下一关时弹窗提示） */
function nextChallenge() {
  if (!isHost()) return;
  if (S.phase !== 'result' || !S.pass) return;
  if (S.allDone) return; // 防重复触发
  const seat = mySeat();
  if (seat !== null) S.currentSeat = seat;
  if (!isActor()) return;
  const nextId = S.challenge.id + 1;
  const lib = CHALLENGE_LIB[nextId];
  if (!lib) {
    S.currentSeat = seat;
    S.allDone = true;
    saveState();
    showAllDoneModal();
    return;
  }
  const names = S.players.map(p => p.name);
  dealGame(names, { chapter: lib.chapter, test: lib.test, id: nextId });
}

// ========================================
// 联机状态应用
// ========================================

function applyOnlineState(state) {
  const wasSettled = S.settled;
  S = state;
  pendingPlay = null;
  clearSpinTimer();
  if (state.settled && state.challenge && !wasSettled) {
    updateLocalProgress(state.challenge.id, state.pass, state.settleStamp);
  }
  render();
}

function getOnlineState() {
  // 联机模板读取 state.currentPlayer，本游戏用 currentSeat，推送时镜像一份
  if (typeof S.currentSeat === 'number') S.currentPlayer = S.currentSeat;
  return S;
}

// ========================================
// 等候室选关（房主本地）
// ========================================

function chStep(kind, delta) {
  if (kind === 'chapter') {
    const ids = Object.keys(CHALLENGE_LIB).filter(k => !isNaN(k)).map(Number);
    const maxChapter = ids.length > 0 ? Math.ceil(Math.max(...ids) / CH_PER_CHAPTER) : 1;
    const next = pendingChallenge.chapter + delta;
    if (next > maxChapter) { showToast('敬请期待'); return; }
    if (next < 1) { showToast('已是第一章'); return; }
    pendingChallenge.chapter = next;
  } else {
    pendingChallenge.test = Math.min(CH_PER_CHAPTER, Math.max(1, pendingChallenge.test + delta));
  }
  if (typeof window._olRefreshWaitingRoom === 'function') window._olRefreshWaitingRoom();
}

/** 轻量吐司提示（1.6s 自动消失） */
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1600);
}

/** 联机层推送当前选关用 */
window._olGetPendingChallenge = () => ({ chapter: pendingChallenge.chapter, test: pendingChallenge.test });

function waitingExtrasHTML() {
  const ch = pendingChallenge;
  const id = (ch.chapter - 1) * CH_PER_CHAPTER + ch.test;
  const cur = loadProgress()[id] || {};
  const progressLine = `本关进度：${cur.passed ? '已通过 ✓' : '未通过'} · 赠送眼标记 <b>${cur.bonus || 0}/${MAX_EYE_BONUS}</b>`;
  const lib = CHALLENGE_LIB[id];
  const descLine = lib && lib.name ? `📜 ${lib.name}：${challengeDesc({ id })}` : `📜 ${challengeDesc({ id })}`;
  if (!isHost()) {
    // 成员端：只读展示房主选择的章节/关卡/规则（经房间状态同步）
    const remote = window._olPendingChallenge || ch;
    const rid = (remote.chapter - 1) * CH_PER_CHAPTER + remote.test;
    const rcur = loadProgress()[rid] || {};
    const rprogress = `本关进度：${rcur.passed ? '已通过 ✓' : '未通过'} · 赠送眼标记 <b>${rcur.bonus || 0}/${MAX_EYE_BONUS}</b>`;
    const rlib = CHALLENGE_LIB[rid];
    const rdesc = rlib && rlib.name ? `📜 ${rlib.name}：${challengeDesc({ id: rid })}` : `📜 ${challengeDesc({ id: rid })}`;
    return `
    <div class="ch-select">
      <div class="ch-row"><label>章节</label><div class="ch-step"><b>${remote.chapter}</b></div></div>
      <div class="ch-row"><label>关卡</label><div class="ch-step"><b>${remote.test}</b></div></div>
      <div class="ch-rule-desc">${esc(rdesc)}</div>
      <div class="ch-progress">房主选择：第${remote.chapter}章·第${remote.test}关（第${rid}关）<br>${rprogress}</div>
    </div>`;
  }
  return `
  <div class="ch-select">
    <div class="ch-row">
      <label>章节</label>
      <div class="ch-step">
        <button onclick="chStep('chapter',-1)">−</button>
        <b>${ch.chapter}</b>
        <button onclick="chStep('chapter',1)">+</button>
      </div>
    </div>
    <div class="ch-row">
      <label>关卡</label>
      <div class="ch-step">
        <button onclick="chStep('test',-1)">−</button>
        <b>${ch.test}</b>
        <button onclick="chStep('test',1)">+</button>
      </div>
    </div>
    <div class="ch-rule-desc">${esc(descLine)}</div>
    <div class="ch-progress">当前选择：第${ch.chapter}章·第${ch.test}关（第${id}关）<br>${progressLine}</div>
  </div>`;
}

// ========================================
// 初始化入口（联机启动见 index.html 内联脚本）
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  clearState();
  render();
});

