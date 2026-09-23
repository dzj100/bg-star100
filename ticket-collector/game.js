/* 《车票收藏家》纯规则引擎 + 版面几何
   不碰 DOM、无计时器、无 Math.random —— 随机数一律由调用方注入 rng，保证可复现。
   浏览器：window.TC ／ Node 测试：module.exports */
'use strict';
(function (root) {
  const G = {};

  /* ================= 版面几何（世界坐标，单位 = 1 SVG 用户单位） =================
     纵向鸟瞰：站台沿画面纵深铺开，d = 0 最远（上）→ d = 1 最近（下）。
     列车贴着站台右侧竖排，列车头在近端（下）；储物柜在远端墙上一排，背包沿左墙一列。
     近大远小全部由 depthScale(d) 承担：站在地上的东西按它缩放；
     站位坐标与徽章不缩 —— 所以越往远处走角色越小，而票数始终看得清。 */

  G.WORLD = { w: 360, h: 680 };

  const VP = { x: 150, y: -900 };          // 消失点：所有纵深线朝它收敛，站台随之收窄
  const Y_FAR = 112, Y_NEAR = 672;         // 地面最远 / 最近处的屏幕 y

  /* 深度 → 屏幕 y：用二次式而不是直线，远端才挤得密（近大远小的一半功劳在这里） */
  G.depthY = function (d) {
    const u = G.clamp(d, 0, 1);
    return Y_FAR + (Y_NEAR - Y_FAR) * (0.75 * u + 0.25 * u * u);
  };
  /* 屏幕 y → 深度（上式的反函数，解 0.25u² + 0.75u − t = 0 的正根） */
  G.depthAt = function (y) {
    const t = G.clamp((y - Y_FAR) / (Y_NEAR - Y_FAR), 0, 1);
    return (-0.75 + Math.sqrt(0.5625 + t)) / 0.5;
  };
  /* 纵深缩放：远端 0.62 → 近端 1.0。角色、背包、车厢里的筹码都吃这一个数 */
  G.depthScale = function (d) { return 0.62 + 0.38 * G.clamp(d, 0, 1); };
  /* 纵深线：近端某个屏幕 x，在屏幕 y 处收敛到哪里 */
  const lean = function (xNear, y) {
    return VP.x + (xNear - VP.x) * ((y - VP.y) / (Y_NEAR - VP.y));
  };
  G.lean = lean;

  /* 站台地面（梯形）：近端两条边定死，远端朝消失点收 */
  G.PLAT = { nearL: 16, nearR: 200 };
  G.edgeAt = function (d) {
    const y = G.depthY(d);
    const l = lean(G.PLAT.nearL, y), r = lean(G.PLAT.nearR, y);
    return { y: y, l: l, r: r, w: r - l };
  };
  /* (u, d) → 世界坐标：u = −1 贴左墙，u = +1 站台右缘（列车侧） */
  G.ground = function (u, d) {
    const e = G.edgeAt(d);
    return { x: e.l + (u + 1) / 2 * e.w, y: e.y, d: d, s: G.depthScale(d) };
  };
  /* 世界 x → 该深度上的横向比例（lockerStand 用它把柜门投回地面） */
  G.groundU = function (x, d) {
    const e = G.edgeAt(d);
    return (x - e.l) / e.w * 2 - 1;
  };
  /* 自由活动边界（候车拖动与「走回站台」共用） */
  G.WALK = { u0: -0.84, u1: 0.78, d0: 0.05, d1: 0.93 };
  G.clampWalk = function (x, y) {
    const d = G.clamp(G.depthAt(y), G.WALK.d0, G.WALK.d1);
    const e = G.edgeAt(d);
    const x0 = e.l + (G.WALK.u0 + 1) / 2 * e.w, x1 = e.l + (G.WALK.u1 + 1) / 2 * e.w;
    return { x: G.clamp(x, x0, x1), y: e.y, d: d };
  };
  G.figScale = function (y) { return G.depthScale(G.depthAt(y)); };

  /* —— 走路：速度乘该处的 figScale —— */
  /* 名义速度（世界单位 / 演出毫秒，近端 figScale=1 处）。实际速度 = 名义 × 该处 figScale：
     远景的人画得小、脚下也慢，全场每秒走过的「身长」才一样。此前用定长时长（clamp(dist*5.2,…)）
     或写死的 dur，同 620ms 里最远的人要走 417 单位、最近的人只走 191 —— 远处的人于是显得比近处快。 */
  G.WALK_V = 0.42;
  /* 走路时间表：把直线路程切 N 段，逐段按该处速度积分，返回每段末的累计时间。
     演出层用它把「时间进度」换成「路程进度」，于是往远处走会眼看着慢下来（与缩小同步）。 */
  G.walkProfile = function (x0, y0, x1, y1, N) {
    const n = N || 14, t = new Array(n + 1);
    t[0] = 0;
    let acc = 0, px = x0, py = y0;
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      const dx = x - px, dy = y - py;
      acc += Math.sqrt(dx * dx + dy * dy) / (G.WALK_V * G.figScale((y + py) / 2));
      t[i] = acc; px = x; py = y;
    }
    return { t: t, total: acc };
  };

  /* —— 列车：贴站台右侧竖排，近端锚定列车头，号越大越远 —— */
  G.TRAIN = { nearIn: 226, nearOut: 352, locoD: 0.13, maxCarD: 0.26 };
  G.carCount = function (N) { return N - 1; };

  /* 1 号车紧挨车头。车少时每节更长，但封顶；省下的纵深露出空轨与隧道 */
  const CARW = { l: 9, r: 11, t: 8, b: 9 };        // 车厢四壁厚（世界单位）
  G.carLane = function (N, i) {
    const M = G.carCount(N);
    const span = Math.min(G.TRAIN.maxCarD, (1 - G.TRAIN.locoD) / M);
    const dFar = 1 - G.TRAIN.locoD - span * M;
    const d0 = dFar + (M - 1 - i) * span, d1 = d0 + span;
    const y0 = G.depthY(d0), y1 = G.depthY(d1);
    const iT = lean(G.TRAIN.nearIn, y0), iB = lean(G.TRAIN.nearIn, y1);
    const oT = lean(G.TRAIN.nearOut, y0), oB = lean(G.TRAIN.nearOut, y1);
    /* 地板 = 车体梯形内缩一圈（左右两条边跟着纵深线斜，与车壁平行） */
    const yT = y0 + CARW.t, yB = y1 - CARW.b;
    const fT0 = iT + CARW.l, fT1 = oT - CARW.r, fB0 = iB + CARW.l, fB1 = oB - CARW.r;
    const lane = {
      i: i, M: M, d0: d0, d1: d1, dMid: (d0 + d1) / 2, y0: y0, y1: y1, h: y1 - y0,
      s: G.depthScale((d0 + d1) / 2),
      x: (iT + oT) / 2,                      // 车厢中点：补票飞行的落点
      quad: [[iT, y0], [oT, y0], [oB, y1], [iB, y1]],
      box: { x: iT, y: y0, w: oB - iT, h: y1 - y0 },
      floor: {
        quad: [[fT0, yT], [fT1, yT], [fB1, yB], [fB0, yB]],
        /* 某一深度上的地板横截面：l/r 是左右内壁，塞站位与筹码都按它算 */
        at: function (d) {
          const y = G.depthY(d), t = (y - yT) / (yB - yT);
          const l = fT0 + (fB0 - fT0) * t, r = fT1 + (fB1 - fT1) * t;
          return { y: y, l: l, r: r, w: r - l, t: t };
        },
      },
      inner: { x: fT0, y: yT, w: fB1 - fT0, h: yB - yT },
      label: (i + 1) + ' 号车',
    };
    return lane;
  };
  G.locoBox = function () {
    const d0 = 1 - G.TRAIN.locoD, y0 = G.depthY(d0), y1 = G.depthY(1);
    const iT = lean(G.TRAIN.nearIn, y0), oT = lean(G.TRAIN.nearOut, y0);
    return {
      d0: d0, d1: 1, y0: y0, y1: y1, h: y1 - y0, s: G.depthScale((d0 + 1) / 2),
      quad: [[iT, y0], [oT, y0], [G.TRAIN.nearOut, y1], [G.TRAIN.nearIn, y1]],
      box: { x: iT, y: y0, w: G.TRAIN.nearOut - iT, h: y1 - y0 },
    };
  };

  /* 背包：一只只靠在左墙上（底边压在站台左缘），不占站台地面 */
  G.packSpot = function (N, i) {
    const k = N > 1 ? i / (N - 1) : 0.5;
    const d = 0.30 + k * 0.58;
    const e = G.edgeAt(d);
    return { x: e.l + 0.03 * e.w, y: e.y, d: d, s: G.depthScale(d), w: 40, h: 52 };
  };
  /* 站在自己背包前方（顺走的目标位） */
  G.packStand = function (N, i) {
    const b = G.packSpot(N, i);
    const e = G.edgeAt(b.d);
    return { x: b.x + 0.20 * e.w, y: b.y + 10, d: b.d };
  };
  /* 储物柜：远端墙上一排，横向正好压在站台远端的宽度上 */
  G.LOCKERS = { l: 62, r: 186, top: 54, bot: 110 };
  G.lockerSpot = function (N, i) {
    const W = G.LOCKERS, dw = (W.r - W.l) / N;
    return { x: W.l + (i + 0.5) * dw, y: (W.top + W.bot) / 2, w: dw, h: W.bot - W.top };
  };
  /* 柜前站位：把柜门的横向比例投回站台远端的地面，走上去是一条斜线 */
  G.lockerStand = function (N, i) {
    const b = G.lockerSpot(N, i);
    const u = ((b.x - G.LOCKERS.l) / (G.LOCKERS.r - G.LOCKERS.l)) * 2 - 1;
    return G.ground(u * 0.9, 0.09);
  };
  /* 候车站位：背包前方一列，隔位错开横向，互不重叠 */
  G.homeSpot = function (N, i) {
    const k = N > 1 ? i / (N - 1) : 0.5;
    const d = 0.34 + k * 0.52;
    const e = G.edgeAt(d);
    return { x: e.l + (0.40 + (i % 2) * 0.20) * e.w, y: e.y, d: d, s: G.depthScale(d) };
  };
  /* 车厢内第 k / 共 n 个站位：站车厢「近半幅」（远半幅被车内筹码占着），
     沿着地板横截面铺开。挤不下（间距不足 20）时错开纵深分两排 */
  G.boardSpot = function (N, car, k, n) {
    const L = G.carLane(N, car);
    const yMid = L.y0 + L.h * 0.78;
    const dMid = G.depthAt(yMid);
    const mid = L.floor.at(dMid);
    const step0 = n > 1 ? Math.min(26, mid.w * 0.86 / (n - 1)) : 0;
    const crowd = step0 < 20 && n > 1;
    const d = crowd ? G.depthAt(yMid + (k % 2 ? -0.05 : 0.05) * L.h) : dMid;
    const f = L.floor.at(d);
    const st = n > 1 ? Math.min(26, f.w * 0.86 / (n - 1)) : 0;
    return {
      x: (f.l + f.r) / 2 + (n > 1 ? (k - (n - 1) / 2) * st : 0), y: f.y,
      d: d, s: G.depthScale(d), step: st, crowd: crowd,
    };
  };

  /* ================= 车票 ================= */

  G.TC_COLOR = ['红', '黄', '绿', '紫'];
  G.TC_GLYPH = ['◆', '■', '▲', '★'];
  G.TC_COUNT = [18, 18, 18, 6];
  G.COLOR_HEX = ['#d2483c', '#e8b53a', '#3f9e54', '#8a5cd6'];

  G.total = function (t) { return t[0] + t[1] + t[2] + t[3]; };
  G.poolLeft = function (S) { return G.total(S.pool); };
  G.expand = function (t) {
    const out = [];
    for (let c = 0; c < 4; c++) for (let k = 0; k < t[c]; k++) out.push(c);
    return out;
  };

  /* ================= 造型配色 ================= */

  G.PALETTE = {
    top: ['#e0503f', '#e8734a', '#e8a53a', '#e8d24a', '#7fbf4d', '#3fae6b', '#3fb0b8', '#3f8fd8', '#5a6fd8', '#9b5fd0', '#d45fa0', '#f2f4f7'],
    bottom: ['#2b3b4e', '#3a4a5e', '#5a6472', '#8a8478', '#4a5a3a', '#6b4a2f', '#7a2f3a', '#2f2f38', '#9aa3ae', '#c8bfa8'],
    shoes: ['#1d2027', '#f2f4f7', '#e0503f', '#3f8fd8', '#c8a06a', '#3fae6b'],
    hat: ['#e0503f', '#e8a53a', '#3fae6b', '#3f8fd8', '#9b5fd0', '#d45fa0', '#f2f4f7', '#2b3b4e', '#e8d24a', '#3fb0b8'],
    bag: ['#3fc7b8', '#e0503f', '#e8a53a', '#3f8fd8', '#9b5fd0', '#7fbf4d', '#f2f4f7', '#2b3b4e', '#d45fa0', '#8a6a3a'],
  };
  G.SKIN = ['#e4dad3','#f2c9a0', '#e0a878', '#c88a58', '#af7a55'];

  /* 包身颜色 → 压在上面的名字该用什么墨色。
     白字只在暗包上成立；浅包（近白 / 黄 / 绿 / 橙 / 青）上白字糊成一片，
     而配色是玩家可选的，不能赌他一定挑深色。
     阈值取「白字与深字对比度相等」的那一点（不是拍脑袋的 0.5）：
     白字 1.05/(L+0.05)，深字 #1b2733 的 (L+0.05)/0.0693，相等在 L ≈ 0.22 处，
     低于它两边都比 3.6:1 差 —— 取 0.22 就是让最坏那一侧也还有 3.6:1。
     解析不出颜色时按白字返回（深色包占多数，退化成老样子而不是崩）。 */
  G.INK_DARK = '#1b2733';
  G.inkOn = function (hex) {
    const h = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(h)) return { ink: '#ffffff', halo: 'rgba(10,20,30,.45)' };
    const chan = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * chan(parseInt(h.slice(0, 2), 16)) +
      0.7152 * chan(parseInt(h.slice(2, 4), 16)) + 0.0722 * chan(parseInt(h.slice(4, 6), 16));
    return L > 0.22
      ? { ink: G.INK_DARK, halo: 'rgba(255,255,255,.5)' }
      : { ink: '#ffffff', halo: 'rgba(10,20,30,.45)' };
  };

  /* 随机配色：保证帽子与上衣不同色、包包与下装不同色 */
  G.randPalette = function (rng) {
    const pick = (arr, miss) => {
      for (let k = 0; k < 24; k++) {
        const v = arr[Math.floor(rng() * arr.length) % arr.length];
        if (v !== miss) return v;
      }
      return arr[0];
    };
    const top = pick(G.PALETTE.top);
    return {
      top: top,
      bottom: pick(G.PALETTE.bottom),
      shoes: pick(G.PALETTE.shoes),
      hat: pick(G.PALETTE.hat, top),
      bag: pick(G.PALETTE.bag),
      skin: G.SKIN[Math.floor(rng() * G.SKIN.length) % G.SKIN.length],
    };
  };

  /* ================= 开局 ================= */

  G.newGame = function (cfg, rng) {
    const names = cfg.names.slice();
    const N = names.length;
    const players = names.map(function (name, i) {
      return {
        id: i, seat: i, name: name,
        colors: (cfg.colors && cfg.colors[i]) || G.randPalette(rng),
        at: 'platform',
        bag: [0, 0, 0, 0],
        locker: [0, 0, 0, 0],
        pos: G.homeSpot(N, i),
      };
    });
    const cars = [];
    for (let i = 0; i < G.carCount(N); i++) {
      /* closed / short 都是「本轮」的舞台状态，每轮补票时重算 —— 不是永久属性 */
      cars.push({ id: i, tickets: [0, 0, 0, 0], closed: false, short: false });
    }
    return {
      phase: 'lobby', round: 0, N: N,
      names: names, players: players, cars: cars,
      pool: G.TC_COUNT.slice(),
      picks: {}, submitted: [], lastRound: false,
      resolved: 0, hist: [],
    };
  };

  /* ================= 补票 ================= */

  G.drawOne = function (S, rng) {
    const left = G.poolLeft(S);
    if (left <= 0) return -1;
    let r = Math.floor(rng() * left);
    if (r >= left) r = left - 1;
    for (let c = 0; c < 4; c++) {
      if (r < S.pool[c]) { S.pool[c]--; return c; }
      r -= S.pool[c];
    }
    return -1;
  };

  /* 空车补 2、非空车补 1；票池见底后按车厢顺序优先满足前面的车厢，不超放 */
  G.placeTickets = function (S, rng) {
    const ev = { adds: [], short: [], lastRound: false };
    for (let i = 0; i < S.cars.length; i++) {
      const car = S.cars[i];
      car.closed = false;
      const need = G.total(car.tickets) > 0 ? 1 : 2;
      const got = [0, 0, 0, 0];
      let placed = 0;
      while (placed < need && G.poolLeft(S) > 0) {
        const c = G.drawOne(S, rng);
        if (c < 0) break;
        got[c]++; car.tickets[c]++; placed++;
      }
      if (placed > 0) ev.adds.push({ car: car.id, tokens: got, need: need, full: placed === need });
      /* short = 「票池见底，这节没补满」——也是本轮的舞台状态，下一轮重算 */
      car.short = placed < need;
      if (car.short) ev.short.push({ car: car.id, need: need, placed: placed });
    }
    ev.lastRound = G.poolLeft(S) === 0;
    S.lastRound = ev.lastRound;
    S.round++;
    return ev;
  };

  /* ================= 选择 ================= */

  G.player = function (S, pid) { return S.players[pid]; };
  /* 「能不能动」与「站在哪儿」拆成两个问句：站在柜前的人**也有回合**，
     只是那个回合里唯一能做的事是走回站台（`onPlatform` 才是「在站台上」）。 */
  G.atLocker = function (S, pid) { const p = S.players[pid]; return !!p && p.at === 'locker'; };
  G.onPlatform = function (S, pid) { const p = S.players[pid]; return !!p && p.at === 'platform'; };
  G.canAct = function (S, pid) { return G.atLocker(S, pid) || G.onPlatform(S, pid); };
  G.activePlayers = function (S) {
    const out = [];
    for (let i = 0; i < S.players.length; i++) if (G.canAct(S, i)) out.push(i);
    return out;
  };
  G.legalBoard = function (S, pid, carId) {
    if (!G.onPlatform(S, pid)) return false;
    return typeof carId === 'number' && carId >= 0 && carId < S.cars.length;
  };
  G.legalStore = function (S, pid) {
    return G.onPlatform(S, pid) && G.total(S.players[pid].bag) > 0;
  };
  /* 目标必须此刻在站台、且背包里有票（结算时的落差由玩家自己承担）。
     站在柜前的人不能被顺走：票在柜子里，背包是空的。 */
  G.legalSwipe = function (S, pid, targetId) {
    if (!G.onPlatform(S, pid)) return false;
    if (targetId === pid || targetId == null) return false;
    const t = S.players[targetId];
    return !!t && t.at === 'platform' && G.total(t.bag) > 0;
  };
  /* 上回合存放的人本回合唯一可提交的动作。它没有可选项 —— 就是「走回站台」这件事本身，
     结算第 0 步执行，演出第 1 步（存放）里与这一轮去存放的人对向走路。 */
  G.legalReturn = function (S, pid) { return G.atLocker(S, pid); };
  G.legalPick = function (S, pid, pick) {
    if (!pick) return false;
    if (pick.type === 'car') return G.legalBoard(S, pid, pick.car);
    if (pick.type === 'store') return G.legalStore(S, pid);
    if (pick.type === 'swipe') return G.legalSwipe(S, pid, pick.target);
    if (pick.type === 'return') return G.legalReturn(S, pid);
    return false;
  };
  G.submitPick = function (S, pid, pick) {
    if (S.submitted.indexOf(pid) >= 0) return false;
    if (!G.legalPick(S, pid, pick)) return false;
    S.picks[pid] = { type: pick.type, car: pick.car, target: pick.target };
    S.submitted.push(pid);
    return true;
  };
  G.pickableTargets = function (S, pid) {
    const out = [];
    for (let i = 0; i < S.players.length; i++) if (G.legalSwipe(S, pid, i)) out.push(i);
    return out;
  };
  G.allSubmitted = function (S) {
    const act = G.activePlayers(S);
    for (let i = 0; i < act.length; i++) if (S.submitted.indexOf(act[i]) < 0) return false;
    return true;
  };

  /* ================= 结算 =================
     会就地改写 S（车票/背包/柜子/位置），并返回一份纯演出事件表供渲染层编排动画。
     渲染层约定：调用后立刻用事件表演动画，DOM 仍停留在结算前的状态，演完再整体重绘。 */

  G.resolveRound = function (S) {
    const ev = { store: [], close: [], board: [], swipe: [], deal: [], ret: [], warn: null };
    let i, k, c;
    const n = S.players.length;

    /* ---- 0. 上回合留在柜前的人走回站台（这就是他们本回合提交的那个动作） ----
       无条件执行：哪怕因为读档之类的原因这人没提交，也不能被永久锁在柜前。 */
    for (i = 0; i < n; i++) {
      if (S.players[i].at === 'locker') { S.players[i].at = 'platform'; ev.ret.push(i); }
    }

    /* ---- 1. 存放 ---- */
    const storedIds = {};
    for (i = 0; i < n; i++) {
      const p = S.players[i], pk = S.picks[i];
      if (!pk || pk.type !== 'store') continue;
      if (G.total(p.bag) === 0) continue;
      ev.store.push({ p: i, tokens: p.bag.slice(), total: G.total(p.bag) });
      for (c = 0; c < 4; c++) p.locker[c] += p.bag[c];
      p.bag = [0, 0, 0, 0];
      p.at = 'locker';
      storedIds[i] = true;
    }

    /* ---- 2. 无人选择的车厢关门 ---- */
    const chosen = {};
    for (i = 0; i < n; i++) {
      const pk = S.picks[i];
      if (pk && pk.type === 'car') chosen[pk.car] = true;
    }
    for (i = 0; i < S.cars.length; i++) {
      const car = S.cars[i];
      car.closed = !chosen[car.id];
      if (car.closed) ev.close.push({ car: car.id, tokens: car.tickets.slice() });
    }

    /* ---- 3a. 顺走（先快照背包，保证互偷与多人抢同一目标的结果与顺序无关） ---- */
    const snap = [], gain = [], zeroed = [];
    for (i = 0; i < n; i++) { snap.push(S.players[i].bag.slice()); gain.push([0, 0, 0, 0]); zeroed.push(false); }
    const byTarget = {};
    for (i = 0; i < n; i++) {
      const pk = S.picks[i];
      if (pk && pk.type === 'swipe') {
        if (!byTarget[pk.target]) byTarget[pk.target] = [];
        byTarget[pk.target].push(i);
      }
    }
    const targetKeys = Object.keys(byTarget).map(Number).sort(function (a, b) { return a - b; });
    for (k = 0; k < targetKeys.length; k++) {
      const t = targetKeys[k], list = byTarget[t];
      if (list.length === 1 && G.total(snap[t]) > 0) {
        zeroed[t] = true;
        for (c = 0; c < 4; c++) gain[list[0]][c] += snap[t][c];
        ev.swipe.push({ p: list[0], target: t, ok: true, reason: '', tokens: snap[t].slice() });
      } else {
        const why = list.length > 1 ? 'crowd' : (storedIds[t] ? 'stored' : 'empty');
        for (let j = 0; j < list.length; j++) {
          ev.swipe.push({ p: list[j], target: t, ok: false, reason: why, tokens: [0, 0, 0, 0] });
        }
      }
    }
    for (i = 0; i < n; i++) {
      const nb = zeroed[i] ? [0, 0, 0, 0] : snap[i].slice();
      for (c = 0; c < 4; c++) nb[c] += gain[i][c];
      S.players[i].bag = nb;
    }

    /* ---- 3b. 进车厢 ---- */
    const byCar = {};
    for (i = 0; i < n; i++) {
      const pk = S.picks[i];
      if (pk && pk.type === 'car') {
        if (!byCar[pk.car]) byCar[pk.car] = [];
        byCar[pk.car].push(i);
      }
    }
    for (i = 0; i < S.cars.length; i++) {
      const list = byCar[i] || [];
      for (k = 0; k < list.length; k++) {
        const spot = G.boardSpot(S.N, i, k, list.length);
        ev.board.push({ p: list[k], car: i, slot: k, n: list.length, x: spot.x, y: spot.y });
      }
    }

    /* ---- 4. 获得 / 未获得 ---- */
    for (i = 0; i < S.cars.length; i++) {
      const car = S.cars[i], list = byCar[i] || [];
      if (list.length === 0) continue;
      if (list.length === 1) {
        const pid = list[0];
        const got = car.tickets.slice();
        car.tickets = [0, 0, 0, 0];
        for (c = 0; c < 4; c++) S.players[pid].bag[c] += got[c];
        ev.deal.push({ car: i, winner: pid, contested: [], tokens: got, gain: G.total(got) });
      } else {
        ev.deal.push({ car: i, winner: null, contested: list.slice(), tokens: [0, 0, 0, 0], gain: 0 });
      }
    }

    /* ---- 收尾 ---- */
    S.picks = {}; S.submitted = [];
    S.resolved++;
    S.hist.push(ev);
    return ev;
  };

  /* ================= 结束与计分 ================= */

  /* 必须等最后一轮结算完毕才结束，否则补票那一刻就会提前判定 */
  G.checkEnd = function (S) {
    if (S.lastRound && S.round > 0 && S.resolved >= S.round) { S.phase = 'over'; return true; }
    return false;
  };

  /* 碎票=0；紫票每枚 2 分；red/yellow/green 取满 min 套每套 5 分；散票同色每 2 枚 2 分。
     贪心取满套数恒为最优：拆一套最多让三色各损 1 分配对价值（合计 3 分）< 成套的 5 分。 */
  G.score = function (t) { return G.breakdown(t).total; };

  G.breakdown = function (t) {
    const sets = Math.min(t[0], t[1], t[2]);
    const rr = t[0] - sets, yy = t[1] - sets, gg = t[2] - sets;
    const rows = [];
    if (t[3]) rows.push({ k: '紫票', n: t[3], expr: t[3] + ' 枚 × 2 分', pts: t[3] * 2 });
    if (sets) rows.push({ k: '成套', n: sets, expr: '红黄绿各 1 枚为 1 套 × 5 分', pts: sets * 5 });
    const pairRow = function (label, cnt) {
      const p = Math.floor(cnt / 2) * 2;
      if (p) rows.push({ k: label, n: Math.floor(cnt / 2), expr: cnt + ' 枚 ÷ 2 × 2 分', pts: p });
      if (cnt % 2) rows.push({ k: label, n: 0, expr: cnt + ' 枚，单张不成对', pts: 0 });
    };
    pairRow('散红', rr); pairRow('散黄', yy); pairRow('散绿', gg);
    let total = 0;
    for (let i = 0; i < rows.length; i++) total += rows[i].pts;
    return { rows: rows, total: total, sets: sets };
  };

  G.rank = function (S) {
    const list = S.players.map(function (p) {
      const lb = G.score(p.locker), bb = G.score(p.bag);
      return {
        id: p.id, name: p.name, seat: p.seat, colors: p.colors,
        lockerScore: lb, bagScore: bb, total: lb + bb,
        locker: p.locker.slice(), bag: p.bag.slice(),
      };
    });
    list.sort(function (a, b) { return b.total - a.total || a.seat - b.seat; });
    for (let i = 0; i < list.length; i++) {
      list[i].place = i + 1;
      list[i].tied = (i > 0 && list[i].total === list[i - 1].total) ||
        (i < list.length - 1 && list[i].total === list[i + 1].total);
    }
    return list;
  };

  /* ================= 自检 ================= */

  /* 票数守恒：票池 + 各车厢 + 各背包 + 各储物柜 必须恒等于 18/18/18/6 */
  G.validate = function (S) {
    const sum = [0, 0, 0, 0], errs = [];
    const add = function (t, where) {
      for (let c = 0; c < 4; c++) {
        if (t[c] < 0) errs.push(where + ' 出现负数 ' + G.TC_COLOR[c]);
        sum[c] += t[c];
      }
    };
    add(S.pool, '票池');
    for (let i = 0; i < S.cars.length; i++) add(S.cars[i].tickets, '车厢' + i);
    for (let i = 0; i < S.players.length; i++) {
      add(S.players[i].bag, S.players[i].name + '背包');
      add(S.players[i].locker, S.players[i].name + '储物柜');
    }
    for (let c = 0; c < 4; c++) {
      if (sum[c] !== G.TC_COUNT[c]) {
        errs.push(G.TC_COLOR[c] + '票共 ' + sum[c] + ' 枚，应为 ' + G.TC_COUNT[c]);
      }
    }
    return { ok: errs.length === 0, errs: errs, sum: sum };
  };

  /* ================= 工具 ================= */

  G.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  G.chunked = function (arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };
  /* 确定性随机源：mulberry32。state/set 是为了存档 —— 只存种子的话，
     读档后随机流会从头再来一遍，第 2 轮的补票会重复第 1 轮。 */
  G.seeded = function (seed) {
    let a = seed >>> 0;
    const f = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.state = function () { return a; };
    f.set = function (v) { a = v >>> 0; };
    return f;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
  if (root) root.TC = G;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
