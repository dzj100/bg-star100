/* 《车票收藏家》规则引擎无头测试。运行：node test-core.js */
'use strict';
const G = require('./game.js');

let pass = 0, fail = 0;
const fails = [];
function ok(msg, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg); console.log('  ✗ ' + msg); }
}
function eq(msg, a, b) { ok(msg + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b)); }
function section(t) { console.log('\n== ' + t + ' =='); }

function mk(N, seed) {
  const names = [];
  for (let i = 0; i < N; i++) names.push('P' + i);
  return G.newGame({ names: names }, G.seeded(seed || 7));
}
/* 从票池挪票到任意持有者（车厢 / 背包 / 储物柜），保证票数守恒不被测试自己破坏 */
function put(S, target, t) {
  for (let c = 0; c < 4; c++) {
    const n = Math.min(t[c], S.pool[c]);
    target[c] += n; S.pool[c] -= n;
  }
  return target;
}
/* 把票池抽干到只剩 keep，其余塞进 P0 的储物柜 —— 同样保持守恒 */
function drain(S, keep) {
  for (let c = 0; c < 4; c++) {
    const left = keep[c] || 0;
    S.players[0].locker[c] += S.pool[c] - left;
    S.pool[c] = left;
  }
}

/* ---------- 1. 版面几何（纵向鸟瞰透视） ---------- */
section('版面几何');

ok('玩家数 3..6 时车厢数为 N-1', [3, 4, 5, 6].every(N => G.carCount(N) === N - 1));
ok('深度 ↔ 屏幕 y 严格可逆（站位、飞行落点都靠它换算）', (function () {
  for (let k = 0; k <= 40; k++) {
    const d = k / 40;
    if (Math.abs(G.depthAt(G.depthY(d)) - d) > 1e-9) return false;
  }
  return Math.abs(G.depthY(0) - 112) < 1e-9 && Math.abs(G.depthY(1) - 672) < 1e-9;
})());
ok('纵深缩放 0.62 → 1.00 单调递增（近大远小）', (function () {
  if (Math.abs(G.depthScale(0) - 0.62) > 1e-9 || Math.abs(G.depthScale(1) - 1) > 1e-9) return false;
  for (let k = 1; k <= 40; k++) if (G.depthScale(k / 40) <= G.depthScale((k - 1) / 40)) return false;
  return Math.abs(G.figScale(G.depthY(0.5)) - 0.81) < 1e-9;
})());
ok('站台是近宽远窄的梯形，整片落在画布内', (function () {
  if (!(G.edgeAt(0).w > 60 && G.edgeAt(1).w > G.edgeAt(0).w)) return false;
  return [0, 0.25, 0.5, 0.75, 1].every(function (d) {
    const e = G.edgeAt(d);
    return e.l > 0 && e.r < G.WORLD.w && e.y > 0 && e.y < G.WORLD.h;
  });
})());
ok('ground(u,d)：u=−1/+1 正好贴站台两边，中点居中', (function () {
  return [0, 0.37, 1].every(function (d) {
    const e = G.edgeAt(d);
    return Math.abs(G.ground(-1, d).x - e.l) < 1e-9
      && Math.abs(G.ground(1, d).x - e.r) < 1e-9
      && Math.abs(G.ground(0, d).x - (e.l + e.r) / 2) < 1e-9;
  });
})());
ok('clampWalk 把任意越界点收回站台地面', (function () {
  const pts = [[-999, 0], [999, 0], [-999, 4000], [999, 4000], [180, -500], [180, 5000], [-50, 300], [400, 640]];
  return pts.every(function (q) {
    const p = G.clampWalk(q[0], q[1]);
    const e = G.edgeAt(p.d);
    return p.x >= e.l - 1e-9 && p.x <= e.r + 1e-9 && p.y === e.y
      && p.d >= G.WALK.d0 - 1e-9 && p.d <= G.WALK.d1 + 1e-9;
  });
})());
ok('自由活动区四角本身就在站台里（不被 clamp 改写）', (function () {
  return [G.WALK.d0, (G.WALK.d0 + G.WALK.d1) / 2, G.WALK.d1].every(function (d) {
    return [G.WALK.u0, G.WALK.u1].every(function (u) {
      const g = G.ground(u, d), p = G.clampWalk(g.x, g.y);
      return Math.abs(p.x - g.x) < 1e-6 && Math.abs(p.d - d) < 1e-6;
    });
  });
})());
ok('车厢沿纵深首尾相接、1 号车紧接车头', [3, 4, 5, 6].every(function (N) {
  const M = G.carCount(N);
  if (Math.abs(G.carLane(N, 0).d1 - (1 - G.TRAIN.locoD)) > 1e-9) return false;      // 1 号车贴车头
  for (let i = 0; i < M; i++) {
    const c = G.carLane(N, i);
    if (!(c.d1 > c.d0)) return false;
    if (i + 1 < M && Math.abs(c.d0 - G.carLane(N, i + 1).d1) > 1e-9) return false;  // 号越大越远
  }
  return true;
}));
ok('车厢是朝消失点收敛的梯形，四角都在画布内', [3, 6].every(function (N) {
  const M = G.carCount(N);
  for (let i = 0; i < M; i++) {
    const c = G.carLane(N, i), q = c.quad;
    if (!(Math.abs(q[0][0] - q[3][0]) > 1 && Math.abs(q[1][0] - q[2][0]) > 1)) return false;  // 上窄下宽
    if (!q.every(p => p[0] >= 0 && p[0] <= G.WORLD.w && p[1] >= 0 && p[1] <= G.WORLD.h)) return false;
  }
  return true;
}));
ok('6 人局 5 节车也不挤：每节都有足够宽度与长度', (function () {
  const N = 6, M = G.carCount(N);
  for (let i = 0; i < M; i++) {
    const c = G.carLane(N, i);
    if (c.box.w < 86 || c.h < 72) return false;
    if (c.inner.w < 70 || c.inner.h < 52) return false;
  }
  return true;
})());
ok('车头露在画面近端、紧贴 1 号车、不会掉出画布', [3, 6].every(function (N) {
  const L = G.locoBox(), c = G.carLane(N, 0);
  return Math.abs(L.d0 - c.d1) < 1e-9
    && L.box.h >= 60                                   // 至少露得出一个完整的车头脸
    && L.box.y + L.box.h <= G.WORLD.h + 1e-9
    && L.quad.every(p => p[0] >= 0 && p[0] <= G.WORLD.w);
}));
ok('整列贴着站台右侧，中间留出轨道走廊（不压站台）', [3, 6].every(function (N) {
  const M = G.carCount(N);
  const bands = [];
  for (let i = 0; i < M; i++) bands.push(G.carLane(N, i));
  bands.push(G.locoBox());
  return bands.every(function (b) {
    return b.quad.every(function (p) {
      return p[0] - G.ground(1, G.depthAt(p[1])).x >= 12;
    });
  });
}));
ok('背包一只只靠在左墙上，纵向不重叠、横向不越出画布', [3, 4, 5, 6].every(function (N) {
  let prevY = -1e9;
  for (let i = 0; i < N; i++) {
    const p = G.packSpot(N, i), e = G.edgeAt(p.d);
    const half = p.w * p.s / 2;
    if (p.y <= prevY) return false;
    if (i && p.y - prevY < 44) return false;
    if (p.x < e.l || p.x > e.l + 0.08 * e.w) return false;   // 底边压在站台左缘
    if (p.x - half < 0) return false;                        // 包身靠墙，但不掉出画布
    prevY = p.y;
  }
  return true;
}));
ok('顺走站位在背包前方、落在站台里', [3, 6].every(function (N) {
  for (let i = 0; i < N; i++) {
    const b = G.packSpot(N, i), s = G.packStand(N, i), e = G.edgeAt(s.d);
    if (!(s.x > b.x && s.y > b.y)) return false;
    if (s.x < e.l || s.x > e.r) return false;
  }
  return true;
}));
ok('储物柜一排等宽居中，压在远端墙上（不占地面）', [3, 4, 5, 6].every(function (N) {
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const b = G.lockerSpot(N, i);
    if (i && Math.abs(b.w - G.lockerSpot(N, i - 1).w) > 1e-9) return false;
    if (b.x - b.w / 2 < G.LOCKERS.l - 1e-9 || b.x + b.w / 2 > G.LOCKERS.r + 1e-9) return false;
    sum += b.w;
  }
  return Math.abs(sum - (G.LOCKERS.r - G.LOCKERS.l)) < 1e-9 && G.LOCKERS.bot < G.depthY(0);
}));
ok('柜前站位投在站台上、横向照着柜门排（走上去是一条斜线）', [3, 6].every(function (N) {
  let prevX = -1e9;
  for (let i = 0; i < N; i++) {
    const b = G.lockerSpot(N, i), s = G.lockerStand(N, i), e = G.edgeAt(s.d);
    if (Math.abs(s.x - b.x) > 14) return false;
    if (s.x <= prevX) return false;
    if (s.x < e.l || s.x > e.r) return false;
    prevX = s.x;
  }
  return true;
}));
ok('候车站位彼此不重叠：相邻错列、同列拉开纵深', [3, 4, 5, 6].every(function (N) {
  for (let i = 0; i < N; i++) {
    const a = G.homeSpot(N, i), e = G.edgeAt(a.d);
    if (a.x < e.l || a.x > e.r || a.y < G.depthY(0) || a.y > G.depthY(1)) return false;
    for (let j = i + 1; j < N; j++) {
      const b = G.homeSpot(N, j);
      if (Math.abs(b.y - a.y) < 42 && Math.abs(b.x - a.x) < 26) return false;
    }
  }
  return true;
}));
ok('同车厢站位铺在车厢内且按序排开', [3, 5, 6].every(function (N) {
  for (let c = 0; c < G.carCount(N); c++) {
    const L = G.carLane(N, c), n = N;
    for (let k = 0; k < n; k++) {
      const p = G.boardSpot(N, c, k, n);
      if (p.x < L.inner.x - 1e-6 || p.x > L.inner.x + L.inner.w + 1e-6) return false;
      if (p.d < L.d0 - 1e-9 || p.d > L.d1 + 1e-9) return false;
      if (k && p.x <= G.boardSpot(N, c, k - 1, n).x) return false;
    }
  }
  return true;
}));
ok('拥挤车厢自动错开纵深分两排（6 人挤一节车也能分清）', (function () {
  const N = 6, n = 6, a = G.boardSpot(N, 0, 0, n), b = G.boardSpot(N, 0, 1, n);
  return a.crowd === true && a.y !== b.y;
})());
ok('不拥挤的车厢所有人站在同一条纵深线上', (function () {
  const N = 3, n = 2, a = G.boardSpot(N, 0, 0, n), b = G.boardSpot(N, 0, 1, n);
  return a.crowd === false && a.y === b.y;
})());

/* 走路时长：速度 = WALK_V × 该处 figScale，逐段积分。
   用户看到「上面（远处）的人走得比近处快」就是这里出过问题：写死时长 + clamp 的旧法里，
   入场六个人同 620ms，最远的走 417 单位、最近的走 191 —— 远处自然显得快。 */
const walkT = (x0, y0, x1, y1) => G.walkProfile(x0, y0, x1, y1, 56).total;
ok('走路时长随路程单调增长（没有 820ms 那种硬顶把长短程拍平）', (function () {
  const t1 = walkT(100, 600, 200, 600), t2 = walkT(100, 600, 300, 600), t3 = walkT(100, 600, 500, 600);
  return t2 > t1 * 1.9 && t2 < t1 * 2.1 && t3 > t2 * 1.9 && t3 < t2 * 2.1;
})());
ok('同一段路，远的人走得更久（时长比 = 1 / 缩放比）', (function () {
  const near = walkT(60, 620, 160, 620), far = walkT(60, 160, 160, 160);
  const want = G.figScale(160) / G.figScale(620);          // 远处 scale 小 → 同一个时长要除以它
  return Math.abs(far / near - 1 / want) < 0.02;
})());
ok('入场：远的人时长更久，不再六个人同一个数', (function () {
  const N = 6, t = [];
  for (let i = 0; i < N; i++) {
    const h = G.homeSpot(N, i);
    t.push(walkT(h.x, G.WORLD.h + 8 + i * 16, h.x, h.y));
  }
  for (let i = 1; i < N; i++) if (!(t[i - 1] > t[i])) return false;   // 越远（号越小）越久，严格递减
  return t[0] > t[N - 1] * 2.2;                                       // 最远那位要走两倍以上的时间
})());
ok('每秒身长一致：路程 ÷ 时长 = WALK_V × 时间加权的平均缩放', (function () {
  /* 表里的每段时间就是 ds/(WALK_V·scale)，所以反过来解出的 scale 必须与沿途的加权平均吻合 */
  const p = G.walkProfile(100, 620, 100, 160, 56);
  let ds = 0, inv = 0, py = 620;
  for (let i = 1; i <= 56; i++) {
    const y = 620 + (160 - 620) * i / 56;
    const d = Math.abs(y - py);
    ds += d; inv += d / G.figScale((y + py) / 2); py = y;
  }
  const eff = ds / inv;
  return Math.abs(ds / p.total / eff - G.WALK_V) / G.WALK_V < 0.01;
})());
/* ---------- 2. 开局与补票 ---------- */
section('开局与补票');

(function () {
  const S = mk(3);
  ok('开局票池为 18/18/18/6', JSON.stringify(S.pool) === JSON.stringify([18, 18, 18, 6]));
  ok('开局 validate 通过', G.validate(S).ok);
  ok('开局无人有票', S.players.every(p => G.total(p.bag) === 0));
})();

(function () {
  const S = mk(4), rng = G.seeded(3);
  const ev = G.placeTickets(S, rng);
  ok('首轮全部车厢为空 → 每节补 2 枚', ev.adds.length === 3 && ev.adds.every(a => a.tokens.reduce((x, y) => x + y, 0) === 2));
  ok('补票后票池减少 6 枚', G.poolLeft(S) === 54);
  ok('票数与车厢一致', S.cars.every(c => G.total(c.tickets) === 2));
  ok('首轮 validate 通过', G.validate(S).ok);
  ok('首轮不是最后一轮', ev.lastRound === false && S.lastRound === false);
})();

(function () {
  const S = mk(3), rng = G.seeded(11);
  put(S, S.cars[0].tickets, [3, 1, 0, 0]);        // 非空 → 补 1
  const before = G.poolLeft(S);
  const ev = G.placeTickets(S, rng);
  ok('非空车补 1 枚', G.total(S.cars[0].tickets) === 5);
  ok('空车补 2 枚', G.total(S.cars[1].tickets) === 2);
  ok('票池恰好扣 3 枚', before - G.poolLeft(S) === 3);
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  /* 票池不足：按车厢顺序优先满足前面的车厢，不超放、不倒欠 */
  const S = mk(5);                                  // 4 节车厢，需求 2+2+2+2
  drain(S, [1, 1, 1, 0]);                           // 只剩 3 枚
  const ev = G.placeTickets(S, G.seeded(5));
  eq('车厢0 补满 2 枚', G.total(S.cars[0].tickets), 2);
  eq('车厢1 补到剩余的 1 枚', G.total(S.cars[1].tickets), 1);
  eq('车厢2 一枚未补', G.total(S.cars[2].tickets), 0);
  eq('车厢3 一枚未补', G.total(S.cars[3].tickets), 0);
  eq('票池抽干', G.poolLeft(S), 0);
  ok('未补满的车厢进入 short 列表', ev.short.length === 3 && ev.short.every(s => s.placed < s.need));
  eq('状态里标了 short 的节数', S.cars.filter(c => c.short).length, 3);
  ok('补满的那节 short 为假', S.cars[0].short === false);
  ok('票池见底 → 最后一轮', ev.lastRound === true && S.lastRound === true);
  ok('不超放：票数守恒未被破坏', G.validate(S).ok);
})();

(function () {
  const S = mk(4);
  drain(S, [0, 0, 0, 0]);
  const ev = G.placeTickets(S, G.seeded(1));
  ok('票池空时不补票', ev.adds.length === 0 && ev.short.length === 3);
  ok('票数守恒', G.validate(S).ok);
})();

/* ---------- 3. 选择合法性 ---------- */
section('选择合法性');

(function () {
  const S = mk(3);
  ok('开局可自由选车厢', G.legalBoard(S, 0, 1) && !G.legalBoard(S, 0, 2));
  ok('背包为空时不能存放', !G.legalStore(S, 0));
  ok('背包为空时不能被顺走', !G.legalSwipe(S, 1, 0) && G.pickableTargets(S, 1).length === 0);
  put(S, S.players[0].bag, [1, 0, 0, 0]);
  ok('有票后可被顺走', G.legalSwipe(S, 1, 0));
  ok('不能顺走自己', !G.legalSwipe(S, 0, 0));
  ok('有票后可存放', G.legalStore(S, 0));
  ok('提交后不可重复提交', G.submitPick(S, 0, { type: 'car', car: 0 }) && !G.submitPick(S, 0, { type: 'car', car: 1 }));
  ok('重复提交不改写原选择', S.picks[0].car === 0);
})();

(function () {
  /* 提交那一刻目标可选，之后背包变空也不能改写已提交的选择 */
  const S = mk(4);
  put(S, S.players[1].bag, [2, 0, 0, 0]);
  G.submitPick(S, 2, { type: 'swipe', target: 1 });
  S.players[1].bag = [0, 0, 0, 0];
  const ev = G.resolveRound(S);
  ok('目标结算时背包已空 → 顺走失败', ev.swipe.length === 1 && ev.swipe[0].ok === false && ev.swipe[0].reason === 'empty');
})();

/* ---------- 4. 结算：车厢 ---------- */
section('结算 — 车厢');

(function () {
  const S = mk(3);                                   // 2 节车厢
  put(S, S.cars[0].tickets, [2, 1, 0, 1]);
  put(S, S.cars[1].tickets, [0, 0, 3, 0]);
  G.submitPick(S, 0, { type: 'car', car: 0 });
  G.submitPick(S, 1, { type: 'car', car: 1 });
  G.submitPick(S, 2, { type: 'car', car: 1 });
  const ev = G.resolveRound(S);
  ok('单人车厢：独享车内全部车票', G.total(S.players[0].bag) === 4);
  ok('单人车厢被清空', G.total(S.cars[0].tickets) === 0);
  ok('单人车厢 deal 记 winner', ev.deal.find(d => d.car === 0).winner === 0);
  ok('多人车厢：全员空手', G.total(S.players[1].bag) === 0 && G.total(S.players[2].bag) === 0);
  ok('多人车厢：车票原地留下（滚雪球）', G.total(S.cars[1].tickets) === 3);
  ok('多人车厢 deal 记 contested', ev.deal.find(d => d.car === 1).contested.length === 2);
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  const S = mk(4);                                   // 3 节车厢
  put(S, S.cars[1].tickets, [1, 1, 0, 0]);
  G.submitPick(S, 0, { type: 'car', car: 0 });
  G.submitPick(S, 1, { type: 'car', car: 0 });       // 0 号车两人争抢
  G.submitPick(S, 2, { type: 'car', car: 2 });
  G.submitPick(S, 3, { type: 'car', car: 2 });
  const ev = G.resolveRound(S);
  ok('车厢1 无人选择 → 关门', S.cars[1].closed === true && ev.close.some(c => c.car === 1));
  ok('关门车厢车票不流失', G.total(S.cars[1].tickets) === 2);
  ok('有人选择的车厢不关门', S.cars[0].closed === false && S.cars[2].closed === false);
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  /* 关门只是本轮表现：下一轮重新开门，且按「非空」只补 1 枚 */
  const S = mk(4);
  put(S, S.cars[0].tickets, [2, 0, 0, 0]);
  S.cars[0].closed = true;
  S.cars[1].short = true;                 // 上一轮票池见底时标过
  const before = G.poolLeft(S);
  G.placeTickets(S, G.seeded(9));
  ok('上一轮关门的车厢重新开门', S.cars[0].closed === false);
  ok('上一轮标记的 short 被重算清掉', S.cars[1].short === false);
  ok('关门遗留的车票使该车算「非空」→ 只补 1 枚', G.total(S.cars[0].tickets) === 3);
  ok('其余空车照旧补 2 枚', G.total(S.cars[1].tickets) === 2 && G.total(S.cars[2].tickets) === 2);
  ok('累计消耗 5 枚', before - G.poolLeft(S) === 5);
  ok('validate 通过', G.validate(S).ok);
})();

/* ---------- 5. 结算：顺走 ---------- */
section('结算 — 顺走');

(function () {
  const S = mk(4);
  put(S, S.players[3].bag, [2, 1, 0, 1]);
  G.submitPick(S, 0, { type: 'swipe', target: 3 });
  G.submitPick(S, 1, { type: 'car', car: 0 });
  G.submitPick(S, 2, { type: 'car', car: 1 });
  G.submitPick(S, 3, { type: 'car', car: 0 });
  const ev = G.resolveRound(S);
  ok('单人顺走 → 拿走目标全部车票', JSON.stringify(S.players[0].bag) === JSON.stringify([2, 1, 0, 1]));
  ok('被顺走者背包清空', G.total(S.players[3].bag) === 0);
  ok('swipe 事件标记成功', ev.swipe.length === 1 && ev.swipe[0].ok === true);
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  const S = mk(4);
  put(S, S.players[3].bag, [3, 0, 0, 0]);
  G.submitPick(S, 0, { type: 'swipe', target: 3 });
  G.submitPick(S, 3, { type: 'store' });
  G.submitPick(S, 1, { type: 'car', car: 0 });
  G.submitPick(S, 2, { type: 'car', car: 1 });
  const ev = G.resolveRound(S);
  ok('存放反制顺走：顺走者空手', G.total(S.players[0].bag) === 0);
  ok('失败原因标记为 stored', ev.swipe[0].ok === false && ev.swipe[0].reason === 'stored');
  ok('存放者的票安全进入储物柜', JSON.stringify(S.players[3].locker) === JSON.stringify([3, 0, 0, 0]));
  ok('存放者当回合免疫顺走（背包空）', G.total(S.players[3].bag) === 0);
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  const S = mk(5);
  put(S, S.players[4].bag, [2, 2, 2, 0]);
  G.submitPick(S, 0, { type: 'swipe', target: 4 });
  G.submitPick(S, 1, { type: 'swipe', target: 4 });
  G.submitPick(S, 2, { type: 'car', car: 0 });
  G.submitPick(S, 3, { type: 'car', car: 1 });
  G.submitPick(S, 4, { type: 'car', car: 2 });
  const ev = G.resolveRound(S);
  ok('多人抢同一背包 → 全部空手', G.total(S.players[0].bag) === 0 && G.total(S.players[1].bag) === 0);
  ok('目标背包毫发无伤', JSON.stringify(S.players[4].bag) === JSON.stringify([2, 2, 2, 0]));
  ok('失败原因标记为 crowd', ev.swipe.every(s => s.ok === false && s.reason === 'crowd'));
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  /* 互偷：A 偷 B、B 偷 C —— 各自成功，结果与处理顺序无关 */
  const S = mk(4);
  put(S, S.players[1].bag, [2, 0, 0, 0]);
  put(S, S.players[2].bag, [0, 3, 0, 0]);
  G.submitPick(S, 0, { type: 'swipe', target: 1 });
  G.submitPick(S, 1, { type: 'swipe', target: 2 });
  G.submitPick(S, 2, { type: 'car', car: 0 });
  G.submitPick(S, 3, { type: 'car', car: 1 });
  G.resolveRound(S);
  ok('A 拿到 B 的票', JSON.stringify(S.players[0].bag) === JSON.stringify([2, 0, 0, 0]));
  ok('B 拿到 C 的票（不是被 A 掏空后的空包）', JSON.stringify(S.players[1].bag) === JSON.stringify([0, 3, 0, 0]));
  ok('C 被掏空', G.total(S.players[2].bag) === 0);
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  /* 环形互偷：B↔C 同时互偷 —— 等价于交换，谁都不空手 */
  const S = mk(3);
  put(S, S.players[1].bag, [1, 0, 0, 0]);
  put(S, S.players[2].bag, [0, 0, 0, 2]);
  G.submitPick(S, 1, { type: 'swipe', target: 2 });
  G.submitPick(S, 2, { type: 'swipe', target: 1 });
  G.submitPick(S, 0, { type: 'car', car: 0 });
  G.resolveRound(S);
  ok('互偷等价于交换', JSON.stringify(S.players[1].bag) === JSON.stringify([0, 0, 0, 2]) &&
    JSON.stringify(S.players[2].bag) === JSON.stringify([1, 0, 0, 0]));
  ok('validate 通过', G.validate(S).ok);
})();

/* ---------- 6. 存放的两回合节奏 ---------- */
section('存放的两回合节奏');

(function () {
  const S = mk(4);
  put(S, S.players[0].bag, [1, 1, 1, 0]);
  G.submitPick(S, 0, { type: 'store' });
  G.submitPick(S, 1, { type: 'car', car: 0 });
  G.submitPick(S, 2, { type: 'car', car: 0 });
  G.submitPick(S, 3, { type: 'car', car: 1 });
  G.resolveRound(S);
  ok('存放者停在储物柜前', S.players[0].at === 'locker');
  ok('票进入储物柜', G.total(S.players[0].locker) === 3 && G.total(S.players[0].bag) === 0);

  G.placeTickets(S, G.seeded(21));
  /* 存放是两个回合的承诺：这一回合把票锁进柜子、免疫顺走，下一回合**仍然轮到他**，
     但整个回合只有「回到站台」一个动作 —— 不是跳过，也不是自动替他做。 */
  ok('下一回合仍轮到他，且只剩「回到站台」', G.activePlayers(S).indexOf(0) >= 0 && G.legalReturn(S, 0));
  ok('柜前的人上不了车 / 存不了东西 / 顺不走别人',
    !G.legalBoard(S, 0, 0) && !G.legalStore(S, 0) && !G.legalSwipe(S, 0, 1) && G.pickableTargets(S, 0).length === 0);
  ok('legalPick 只认「回到站台」这一个动作', G.legalPick(S, 0, { type: 'return' }) &&
    !G.legalPick(S, 0, { type: 'store' }) && !G.legalPick(S, 0, { type: 'car', car: 0 }));
  ok('站台上的人不能提交「回到站台」', !G.legalPick(S, 1, { type: 'return' }));
  ok('activePlayers = 站台 3 人 + 柜前 1 人', G.activePlayers(S).length === 4);
  ok('柜前那位的提交也算数：他没交之前 allSubmitted 为假', (function () {
    G.submitPick(S, 1, { type: 'car', car: 0 });
    G.submitPick(S, 2, { type: 'car', car: 1 });
    G.submitPick(S, 3, { type: 'car', car: 0 });
    const mid = G.allSubmitted(S);
    G.submitPick(S, 0, { type: 'return' });
    return !mid && G.allSubmitted(S);
  })());
  ok('储物柜阶段不可被顺走', G.pickableTargets(S, 1).indexOf(0) < 0);

  const ev2 = G.resolveRound(S);
  ok('第二回合结束后存放者走回站台', S.players[0].at === 'platform');
  ok('回站台事件被记录', ev2.ret.indexOf(0) >= 0);
  ok('回站台不算「存放」：这一轮他没有 store 事件', !ev2.store.some(function (w) { return w.p === 0; }));
  ok('存放者恢复行动权', G.canAct(S, 0));
  ok('validate 通过', G.validate(S).ok);
})();

/* ---------- 7. 计分 ---------- */
section('计分');

ok('空背包 0 分', G.score([0, 0, 0, 0]) === 0);
ok('紫票每枚 2 分', G.score([0, 0, 0, 3]) === 6);
ok('三色各 1 枚为一套 5 分', G.score([1, 1, 1, 0]) === 5);
ok('两套 10 分', G.score([2, 2, 2, 0]) === 10);
ok('散票每 2 枚 2 分', G.score([2, 0, 0, 0]) === 2 && G.score([0, 4, 0, 0]) === 4);
ok('单张散票 0 分', G.score([1, 0, 0, 0]) === 0 && G.score([3, 0, 0, 0]) === 2);
ok('成套优于散票：1红1黄1绿 5 分 > 2红 2 分', G.score([1, 1, 1, 0]) > G.score([2, 0, 0, 0]));
ok('混合计分：3红2黄2绿2紫 = 2套10 + 紫4 + 散红单张0', G.score([3, 2, 2, 2]) === 14);
ok('计分明细行合计等于总分', (function () {
  const t = [4, 3, 2, 2], b = G.breakdown(t);
  return b.rows.reduce((s, r) => s + r.pts, 0) === b.total && b.total === G.score(t);
})());
ok('单张不成对会在明细里说明', (function () {
  const b = G.breakdown([1, 0, 0, 0]);
  return b.total === 0 && b.rows.length === 1 && b.rows[0].pts === 0;
})());

/* 贪心最优性：暴力枚举「取几套」验证 G.score 取到最大值 */
(function () {
  const brute = function (r, y, g, p) {
    let best = -1;
    const mx = Math.min(r, y, g);
    for (let s = 0; s <= mx; s++) {
      const v = s * 5 + Math.floor((r - s) / 2) * 2 + Math.floor((y - s) / 2) * 2 + Math.floor((g - s) / 2) * 2 + p * 2;
      if (v > best) best = v;
    }
    return best;
  };
  let bad = 0, checked = 0, sample = null;
  for (let r = 0; r <= 6; r++) for (let y = 0; y <= 6; y++) for (let g = 0; g <= 6; g++) for (let p = 0; p <= 2; p++) {
    const got = G.score([r, y, g, p]), want = brute(r, y, g, p);
    checked++;
    if (got !== want) { bad++; if (!sample) sample = [r, y, g, p, got, want]; }
  }
  ok('贪心取满套数在 ' + checked + ' 组枚举中恒为最优' + (bad ? '（反例 ' + JSON.stringify(sample) + '）' : ''), bad === 0);
})();

/* ---------- 8. 排名 ---------- */
section('排名');

(function () {
  const S = mk(4);
  put(S, S.players[0].locker, [1, 1, 1, 0]);   // 5 分
  put(S, S.players[1].bag, [0, 0, 0, 3]);      // 6 分
  put(S, S.players[2].bag, [4, 0, 0, 0]);      // 4 分
  put(S, S.players[3].bag, [0, 2, 0, 0]);      // 2 分
  const r = G.rank(S);
  eq('排名顺序正确', r.map(x => x.id), [1, 0, 2, 3]);
  eq('总分含储物柜 + 背包', r[1].total, 5);
  eq('名次编号从 1 开始', r.map(x => x.place), [1, 2, 3, 4]);
  ok('无人并列时 tied 全为假', r.every(x => x.tied === false));
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  const S = mk(3);
  put(S, S.players[0].bag, [0, 0, 0, 2]);   // 4
  put(S, S.players[1].bag, [2, 2, 2, 0]);   // 1套5 + 散红2 + 散黄2 + 散绿2 = 11
  put(S, S.players[2].bag, [0, 0, 0, 2]);   // 4
  const r = G.rank(S);
  eq('并列被标记', r.map(x => x.tied), [false, true, true]);
  ok('并列按座位号稳定排序', r[1].seat === 0 && r[2].seat === 2);
  ok('validate 通过', G.validate(S).ok);
})();

/* ---------- 9. 票数守恒（整局随机对局） ---------- */
section('票数守恒');

(function () {
  let worst = null, rounds = 0;
  for (let seed = 1; seed <= 60 && !worst; seed++) {
    const rng = G.seeded(seed * 977);
    const N = 3 + (seed % 4), names = [];
    for (let i = 0; i < N; i++) names.push('P' + i);
    const S = G.newGame({ names: names }, rng);
    S.phase = 'pick';
    let guard = 0;
    while (!S.lastRound && guard++ < 200) {
      G.placeTickets(S, rng);
      const act = G.activePlayers(S);
      for (let a = 0; a < act.length; a++) {
        const pid = act[a], p = S.players[pid];
        const opts = [];
        if (p.at === 'locker') opts.push({ type: 'return' });       // 柜前只有一个动作
        else {
          for (let c = 0; c < S.cars.length; c++) opts.push({ type: 'car', car: c });
          if (G.total(p.bag) > 0) opts.push({ type: 'store' });
          const tg = G.pickableTargets(S, pid);
          for (let t = 0; t < tg.length; t++) opts.push({ type: 'swipe', target: tg[t] });
        }
        G.submitPick(S, pid, opts[Math.floor(rng() * opts.length) % opts.length]);
      }
      G.resolveRound(S);
      const v = G.validate(S);
      if (!v.ok) { worst = 'seed ' + seed + ' round ' + S.round + ': ' + v.errs.join('; '); break; }
      rounds++;
    }
  }
  ok('60 局随机对局（共 ' + rounds + ' 轮）票数始终守恒' + (worst ? '：' + worst : ''), !worst);
})();

(function () {
  /* 全员同时存放 → 下一回合人人都是「回到站台」的回合，一样要走完、不能卡死 */
  const S = mk(3);
  S.players.forEach(p => put(S, p.bag, [1, 0, 0, 0]));
  G.placeTickets(S, G.seeded(4));
  S.players.forEach((p, i) => G.submitPick(S, i, { type: 'store' }));
  G.resolveRound(S);
  ok('全员存放后都在储物柜', S.players.every(p => p.at === 'locker'));
  G.placeTickets(S, G.seeded(5));
  ok('下一回合人人都有回合，但只有「回到站台」', G.activePlayers(S).length === 3 &&
    S.players.every((p, i) => G.legalReturn(S, i) && !G.legalStore(S, i) && !G.legalBoard(S, i, 0)));
  ok('没人提交时 allSubmitted 为假（全员在柜前的这轮不是空转）', !G.allSubmitted(S));
  S.players.forEach((p, i) => G.submitPick(S, i, { type: 'return' }));
  ok('三张「回到站台」都收下了', G.allSubmitted(S));
  const ev = G.resolveRound(S);
  ok('全员回站台被记录', ev.ret.length === 3);
  ok('走回站台后恢复完整行动', S.players.every((p, i) => p.at === 'platform' && G.legalBoard(S, i, 0)));
  ok('回站台不破坏票数守恒', G.validate(S).ok);
})();

/* ---------- 10. 确定性 ---------- */
section('确定性');

(function () {
  const run = function (seed) {
    const rng = G.seeded(seed);
    const S = G.newGame({ names: ['A', 'B', 'C', 'D'] }, rng);
    const log = [];
    for (let r = 0; r < 6; r++) {
      const ev = G.placeTickets(S, rng);
      log.push(JSON.stringify(ev.adds));
      const act = G.activePlayers(S);
      for (let a = 0; a < act.length; a++) G.submitPick(S, act[a], { type: 'car', car: (act[a] + r) % S.cars.length });
      G.resolveRound(S);
    }
    return JSON.stringify(S.pool) + '|' + JSON.stringify(S.players.map(p => p.bag)) + '|' + log.join(',');
  };
  ok('同一 seed 完全可复现', run(42) === run(42));
  ok('不同 seed 结果不同', run(42) !== run(43));
})();

/* ---------- 11. 最后一轮与结束 ---------- */
section('最后一轮与结束');

(function () {
  const S = mk(3);
  drain(S, [0, 0, 0, 0]);
  S.round = 5; S.resolved = 5;
  const ev = G.placeTickets(S, G.seeded(2));
  ok('票池空时补票即最后一轮', ev.lastRound && S.lastRound);
  ok('补票那一刻尚未结束（要先打完这一轮）', G.checkEnd(S) === false);
  G.resolveRound(S);
  ok('本轮结算后对局结束', G.checkEnd(S) === true && S.phase === 'over');
  ok('validate 通过', G.validate(S).ok);
})();

(function () {
  const S = mk(3);
  G.placeTickets(S, G.seeded(6));
  ok('票池未空时 checkEnd 为假', G.checkEnd(S) === false);
})();

/* ---------- 12. 结算事件表 ---------- */
section('结算事件表');

(function () {
  const S = mk(5);
  put(S, S.players[4].bag, [1, 1, 1, 0]);
  G.submitPick(S, 0, { type: 'car', car: 0 });
  G.submitPick(S, 1, { type: 'car', car: 0 });
  G.submitPick(S, 2, { type: 'car', car: 1 });
  G.submitPick(S, 3, { type: 'swipe', target: 4 });
  G.submitPick(S, 4, { type: 'store' });
  const ev = G.resolveRound(S);
  ok('事件表包含全部阶段字段', ['store', 'close', 'board', 'swipe', 'deal', 'ret', 'warn'].every(k => k in ev));
  ok('store 事件带车票向量', ev.store.length === 1 && Array.isArray(ev.store[0].tokens) && ev.store[0].total === 3);
  ok('close 覆盖 2、3 号两节无人车厢', ev.close.length === 2 && ev.close.map(c => c.car).sort().join() === '2,3');
  ok('board 事件带合法站位坐标', ev.board.length === 3 && ev.board.every(b => isFinite(b.x) && isFinite(b.y)));
  ok('board 站位落在对应车厢内', ev.board.every(function (b) {
    const d = G.carLane(S.N, b.car), dep = G.depthAt(b.y);
    return b.x >= d.inner.x - 1e-6 && b.x <= d.inner.x + d.inner.w + 1e-6
      && dep >= d.d0 - 1e-9 && dep <= d.d1 + 1e-9;
  }));
  ok('swipe 与 deal 齐全', ev.swipe.length === 1 && ev.deal.length === 2);
  ok('deal 只包含有人选择的车厢', ev.deal.every(d => d.car === 0 || d.car === 1));
  ok('胜负判定正确', ev.deal.find(d => d.car === 0).winner === null && ev.deal.find(d => d.car === 1).winner === 2);
  ok('resolveRound 后选择被清空', Object.keys(S.picks).length === 0 && S.submitted.length === 0);
  ok('validate 通过', G.validate(S).ok);
})();

/* ---------- 13. 车内筹码尺寸 ---------- */
section('车内筹码尺寸');

(function () {
  const A = require('./art.js');
  const rxW = /<svg class="tk tk-\d"[^>]*width="([\d.]+)"/g;
  const rxF = /<text class="tk-n"[^>]*font-size="([\d.]+)"/g;
  const scan = function (t, L) {
    const svg = A.carChips(t, L);
    const r = {
      w: [], f: [],
      root: /^<svg class="cr-chips-svg"/.test(svg),
      chips: (svg.match(/<svg class="tk tk-/g) || []).length,
      nums: (svg.match(/class="tk-n"/g) || []).length,
    };
    let m;
    rxW.lastIndex = 0;
    while ((m = rxW.exec(svg))) r.w.push(+m[1]);
    rxF.lastIndex = 0;
    while ((m = rxF.exec(svg))) r.f.push(+m[1]);
    return r;
  };

  let capOk = true, rootOk = true, countOk = true, fontOk = true, fitOk = true, monoOk = true, monoNumOk = true;
  let worst = 0, minFont = 99;
  for (let N = 3; N <= 6; N++) {
    for (let car = 0; car < G.carCount(N); car++) {
      const L = G.carLane(N, car);
      const cap = 23 * L.s;                                  /* 标准上限：只有一种颜色也不许越过 */
      const fy = L.floor.at(L.d0 + (L.d1 - L.d0) * 0.30).y;
      const fonts = [];
      for (let k = 1; k <= 4; k++) {
        const t = [0, 0, 0, 0];
        for (let j = 0; j < k; j++) t[j] = j + 1;
        const r = scan(t, L);
        if (!r.root) rootOk = false;
        if (r.chips !== k || r.nums !== k || r.w.length !== k || r.f.length !== k) countOk = false;
        r.w.forEach(function (w) {
          if (w > cap + 0.06) capOk = false;
          worst = Math.max(worst, w / cap);
          if (fy - w * 0.625 - 7.2 * L.s < L.box.y - 0.06) fitOk = false;      /* 票顶不能顶出车盒 */
        });
        r.f.forEach(function (f) { if (f < 6.4 - 1e-9) fontOk = false; minFont = Math.min(minFont, f); });
        if (fy > L.box.y + L.box.h + 0.06) fitOk = false;
        fonts.push(r.f[0]);
      }
      /* 单色 = 三色的展示大小（「只有一种票」不许把票画大 —— 那等于提前把情报写脸上） */
      const solo = scan([1, 0, 0, 0], L);
      const tri = scan([1, 1, 1, 0], L);
      const four = scan([1, 1, 1, 1], L);
      if (!(Math.abs(solo.w[0] - cap) < 0.06 && Math.abs(solo.w[0] - tri.w[0]) < 0.06 && solo.w[0] >= four.w[0] - 0.06)) monoOk = false;
      if (solo.nums !== 1 || solo.f[0] !== tri.f[0] || solo.f[0] !== four.f[0]) monoNumOk = false;
      if (fonts.some(f => f !== fonts[0])) fontOk = false;
      const empty = scan([0, 0, 0, 0], L);
      if (!empty.root || empty.chips !== 0 || empty.nums !== 0) countOk = false;
    }
  }
  ok('筹码根节点是 <svg>（div.innerHTML 才不会把里面的 <g> 当 HTML 解析）', rootOk);
  ok('颜色数 = 票数 = ×n 数字个数（空车零票零数字）', countOk);
  ok('任何颜色数下票宽都不超过标准上限 23×s', capOk);
  ok('单色与三色同大小、不大于四色（不再单独放大）', monoOk);
  ok('单色的 ×n 字号与多色完全一致', monoNumOk);
  ok('×n 字号在每节车厢内统一，且不低于可读性地板 6.4 单位', fontOk);
  ok('票与数字都落在车厢盒子内（svg 默认裁切，出格会被切掉）', fitOk);
  console.log('      · 最宽 / 上限 = ' + worst.toFixed(3) + '，最小 ×n 字号 = ' + minFont.toFixed(2) + ' 单位');
})();

/* ---------- 14. 柜内陈列字号 ---------- */
section('柜内陈列字号');

(function () {
  const A = require('./art.js');
  const rxTk = /<svg class="tk tk-(\d)"[^>]* x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g;
  const rxC = /<text class="li-c lk-(\d)( side)?" x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"/g;
  const rxN = /<text class="li-n"[^>]* y="([\d.-]+)" font-size="([\d.]+)"/g;
  const scanOne = function (t, B) {
    const s = A.lockerInner(t, B), r = { tk: [], c: [], n: [] };
    let m;
    rxTk.lastIndex = 0; while ((m = rxTk.exec(s))) r.tk.push({ c: +m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
    rxC.lastIndex = 0; while ((m = rxC.exec(s))) r.c.push({ c: +m[1], side: !!m[2], x: +m[3], y: +m[4], f: +m[5] });
    rxN.lastIndex = 0; while ((m = rxN.exec(s))) r.n.push({ y: +m[1], f: +m[2] });
    return r;
  };
  const VEC = [[1, 0, 0, 0], [3, 0, 0, 0], [2, 2, 0, 0], [1, 1, 1, 0], [4, 4, 4, 4], [12, 7, 3, 9]];
  let floorOk = true, underOk = true, fitOk = true, countOk = true;
  let minF = 99;
  for (let N = 3; N <= 6; N++) {
    for (let i = 0; i < N; i++) {
      const B = G.lockerSpot(N, i);
      for (let v = 0; v < VEC.length; v++) {
        const t = VEC[v], r = scanOne(t, B);
        const kinds = t.filter(x => x > 0).length;
        if (r.c.length !== kinds || r.tk.length !== kinds || r.n.length !== 1) countOk = false;
        const totTop = r.n[0].y - r.n[0].f * 0.78;              /* 总数那行的字顶 */
        r.c.forEach(function (tx, k) {
          if (tx.f < 6.4 - 1e-9) floorOk = false;
          minF = Math.min(minF, tx.f);
          const tk = r.tk[k];
          /* 两套摆法都认：宽柜「数字压票下、同列中线」，窄柜「数字挂票右、同一行」 */
          const under = !tx.side && Math.abs(tx.x - (tk.x + tk.w / 2)) <= 0.1 && tx.y >= tk.y + tk.h + 1;
          const beside = tx.side && tx.x >= tk.x + tk.w + 1 && Math.abs(tx.y - (tk.y + tk.h / 2)) <= 2.6;
          if (!under && !beside) underOk = false;
          if (tx.y + tx.f * 0.25 > totTop + 0.4) fitOk = false;  /* 不与底部的总数行叠字 */
          /* 两字宽（「12」≈1.5f）也留在柜内：吊票右是左对齐，压票下是居中 */
          const right = tx.side ? tx.x + tx.f * 1.5 : tx.x + tx.f * 0.8;
          if (tx.x - tx.f * 0.1 < -0.1 || right > B.w + 0.1) fitOk = false;
        });
        r.tk.forEach(function (tk) {
          if (tk.x < -0.05 || tk.x + tk.w > B.w + 0.05) fitOk = false;
          if (tk.y < -0.05 || tk.y + tk.h > r.n[0].y - 1) fitOk = false;
        });
      }
    }
  }
  ok('每种颜色的张数、票、总数一个不多一个不少', countOk);
  ok('柜内每一处字号都不低于 6.4 单位（旧版最窄掉到 4.6）', floorOk);
  ok('张数与票同格：宽柜压票下 / 窄柜挂票右', underOk);
  ok('票与数字都留在柜格内，不压底部的总数行', fitOk);
  console.log('      · 最小柜内字号 = ' + minF.toFixed(2) + ' 单位');
})();

/* ---------- 15. 包名墨色（浅包上的白字） ---------- */
section('包名墨色');

(function () {
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = hex => {
    const h = hex.replace('#', '');
    return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
      0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const rows = G.PALETTE.bag.map(bg => ({ bg: bg, ink: G.inkOn(bg).ink, cr: ratio(G.inkOn(bg).ink, bg) }));
  const worst = rows.reduce((m, r) => Math.min(m, r.cr), 99);
  ok('每个可选包色上的包名对比度都 ≥ 3.5:1', rows.every(r => r.cr >= 3.5));
  ok('每次都在两种墨色里挑对比度高的那个', rows.every(r => {
    const other = r.ink === '#ffffff' ? G.INK_DARK : '#ffffff';
    return r.cr >= ratio(other, r.bg) - 1e-9;
  }));
  ok('近白包换成深字（白字在 #f2f4f7 上只有 1.10:1）', G.inkOn('#f2f4f7').ink === G.INK_DARK &&
    ratio('#ffffff', '#f2f4f7') < 1.15);
  ok('暗包仍是白字', ['#2b3b4e', '#e0503f', '#9b5fd0', '#8a6a3a'].every(b => G.inkOn(b).ink === '#ffffff'));
  ok('两种墨色各自带一圈反向光晕', G.inkOn('#f2f4f7').halo !== G.inkOn('#2b3b4e').halo);
  ok('颜色解析不了也不崩，退回白字', G.inkOn('rgb(1,2,3)').ink === '#ffffff' &&
    G.inkOn(undefined).ink === '#ffffff' && G.inkOn('#abc').ink === '#ffffff');
  console.log('      · 包色对比度：' + rows.map(r => r.ink === '#ffffff' ? '白' : '深').join('') +
    '（' + G.PALETTE.bag.join(' ') + '）；最差 ' + worst.toFixed(2) + ':1（' + rows.find(r => r.cr === worst).bg + '）');
})();

/* ---------- 汇总 ---------- */
console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
