/* ============================================================
   渗透因子 · 联机模式（2~5 人协作）规则引擎（纯逻辑，浏览器 + Node 通用）
   与单人版 game.js 共用牌模型与「有关 / 无关」判定，差异在行动分工：
   - 无 AI：每名玩家各有手牌 / 盯梢目标 / 情报区（自己的目标只有自己知道，他人的保密）
   - 五类行动对所有玩家开放：盯梢 / 情报 / 通讯 / 潜伏 / 铲除
   - 情报 = 打自己的手牌，判定计入「自己盯梢目标」的情报区
   - 通讯 = 打自己的手牌，判定计入「别人盯梢目标」的情报区（多目标时由发起者选）
   - 铲除 = 只能指认「他人盯梢目标」（不含自己的）；子弹、牌库、叛徒区、已铲除名单全队共享
   胜负同单机：全歼 = 胜；未铲除叛徒 > 剩余子弹 = 负；轮到者五类行动全不可执行 = 负
   ============================================================ */
'use strict';
const GO = (() => {
  const COLORS = ['红', '黄', '绿', '蓝', '黑'];
  const GLYPH = ['◆', '●', '▲', '■', '★'];
  const HAND_MAX = 7;
  const LOGMAX = 80;
  const TRAIT_MIN = 7, TRAIT_MAX = 11, EXTRA_MAX = 3;
  const SEAT_MIN = 2, SEAT_MAX = 5;

  const cOf = id => id >> 4;
  const nOf = id => id & 15;
  const mk = (c, n) => (c << 4) | n;
  const cardName = id => COLORS[cOf(id)] + nOf(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---- 配置规范化：颜色 4/5，含 1 与否，叛徒 7~11，额外子弹 0~3 ---- */
  function normCfg(cfg) {
    cfg = cfg || {};
    return {
      colors: cfg.colors > 4 ? 5 : 4,
      one: !!cfg.one,
      traitors: clamp(Math.round(cfg.traitors != null ? cfg.traitors : 7), TRAIT_MIN, TRAIT_MAX),
      extra: clamp(Math.round(cfg.extra != null ? cfg.extra : 3), 0, EXTRA_MAX),
    };
  }
  const bulletsOf = cfg => cfg.traitors + cfg.extra;
  function combos(cfg) {
    const out = [];
    for (let c = 0; c < cfg.colors; c++) for (let n = cfg.one ? 1 : 2; n <= 15; n++) out.push(mk(c, n));
    return out;
  }
  /* 开局牌库 = 入局牌 − 叛徒 − 每人 5 张手牌 */
  const deckSizeOf = (cfg, n) => combos(cfg).length - cfg.traitors - 5 * (n || 2);
  /* 难度评级与单人版同口径（基础牌库按 2 人算，子弹各顶 1 次终局探测） */
  function difficultyOf(cfgIn, n) {
    const cfg = normCfg(cfgIn);
    const base = 14 * cfg.colors - cfg.traitors - 10;
    const per = 5 * (cfg.colors >= 5 ? 1.5 : 1);
    const need = per * cfg.traitors;
    const score = (base + cfg.extra) / need;
    return {
      deck: deckSizeOf(cfg, n), need, score,
      tag: score >= 1.15 ? '轻松' : score >= 1.0 ? '标准' : score >= 0.8 ? '紧张' : '绝望',
    };
  }
  /* 提示牌 a 与目标 b 是否「有关」：同色 | 同数 | 倍数 | 因数（数字 1 只认同色/同数） */
  function related(a, b) {
    const ac = cOf(a), bc = cOf(b), an = nOf(a), bn = nOf(b);
    if (ac === bc || an === bn) return true;
    if (an === 1 || bn === 1) return false;
    return an % bn === 0 || bn % an === 0;
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  const drawTop = (S, n) => S.deck.splice(Math.max(0, S.deck.length - n), n);   // 末尾为顶部；不足则全拿
  const mill = (S, n) => { const c = drawTop(S, n); S.discardDown.push(...c); return c; };

  const nameOf = (S, seat) => (S.seats[seat] && S.seats[seat].name) || ('座位 ' + (seat + 1));
  function logPush(S, who, text) {
    S.log.push({ no: S.round, who, text });
    if (S.log.length > LOGMAX) S.log.splice(0, S.log.length - LOGMAX);
  }
  /* 未铲除的叛徒 = 各玩家盯梢中的 + 叛徒区 */
  const traitorsLeft = S => S.watches.filter(w => w != null).length + S.traitorPile.length;
  const watchSeats = S => S.watches.map((w, i) => w != null ? i : -1).filter(i => i >= 0);

  /* ---- 公开候选分析（推论板；只依赖公开信息 + 自己的手牌，不含真相） ----
     viewer: 分析者座位（手牌是私有信息，只有本人能拿来排除）
     target: 分析哪名玩家的盯梢目标（各人盯梢目标的情报区相互独立）
     located: 已被公开定位、不可能仍是任何盯梢目标的牌（我的手牌 / 全部情报区 / 明弃堆）
     judge:   与该目标历史判定矛盾而排除的牌（auto 模式才计算） */
  function analyze(S, target, viewer, auto = true) {
    const total = combos(S.cfg);
    const intelAll = [];
    for (const z of S.intel) intelAll.push(...z.rel, ...z.unrel);
    const located = new Set([...(S.hands[viewer] || []), ...intelAll, ...S.discardUp]);
    const zone = S.intel[target] || { rel: [], unrel: [] };
    const judge = new Set(), cand = [];
    for (const id of total) {
      if (located.has(id)) continue;
      if (auto) {
        let ok = true;
        for (const k of zone.rel) if (!related(k, id)) { ok = false; break; }
        if (ok) for (const k of zone.unrel) if (related(k, id)) { ok = false; break; }
        if (!ok) { judge.add(id); continue; }
      }
      cand.push(id);
    }
    return { total, cand, located, judge };
  }
  const publicCandidates = (S, target, viewer) => analyze(S, target, viewer, true).cand;

  /* ---- 发牌与开局 ---- */
  function newGame(cfgIn, seatsIn, rnd = Math.random) {
    const cfg = normCfg(cfgIn);
    const seats = (seatsIn || []).slice(0, SEAT_MAX).map((s, i) => ({
      seatIndex: i, name: (s && s.name) || ('座位 ' + (i + 1)),
    }));
    const n = seats.length;
    const deck = shuffle(combos(cfg), rnd);
    const traitorPile = deck.splice(Math.max(0, deck.length - cfg.traitors), cfg.traitors);
    const hands = [];
    for (let i = 0; i < n; i++) hands.push(deck.splice(Math.max(0, deck.length - 5), 5));
    const firstSeat = Math.floor(rnd() * n);
    const S = {
      cfg, seats, n,
      firstSeat, turnSeat: firstSeat, turnNo: 1, round: 1,
      deck, traitorPile, hands,
      watches: new Array(n).fill(null),
      intel: Array.from({ length: n }, () => ({ rel: [], unrel: [] })),
      discardDown: [], discardUp: [],
      bulletsMax: bulletsOf(cfg), bullets: bulletsOf(cfg), caught: 0, caughtCards: [],
      pending: null, pendingSeat: null, over: null, log: [],
      introId: 'g' + Date.now().toString(36) + '-' + Math.floor(rnd() * 1e6).toString(36),
      stat: { shots: 0, hits: 0, misses: 0, stakes: 0, intels: 0, comms: 0, lurks: 0 },
    };
    logPush(S, 'sys', '任务开始：' + cfg.colors + ' 色 · ' + (cfg.one ? '含 1' : '不含 1') +
      ' · 叛徒 ' + cfg.traitors + ' 名 · 子弹 ' + S.bullets + ' 发 · ' + n + ' 人协作');
    logPush(S, 'sys', '先手：' + nameOf(S, firstSeat) + '（每人各持 5 张手牌）');
    return S;
  }

  /* ---- 行动合法性（按座位） ---- */
  function legal(S, seat) {
    const hand = S.hands[seat] || [];
    const watching = watchSeats(S);
    const commTargets = watching.filter(j => j !== seat);        // 通讯 = 帮别人判定，不含自己
    const elimTargets = watching.filter(j => j !== seat);        // 铲除 = 只能指认他人盯梢的目标
    return {
      stake: S.watches[seat] == null && S.traitorPile.length > 0,
      intel: S.watches[seat] != null && hand.length > 0,
      comm: hand.length > 0 && commTargets.length > 0,
      commTargets,
      lurkMax: Math.max(0, Math.min(3, HAND_MAX - hand.length, S.deck.length - 1)),
      eliminate: elimTargets.length > 0,
      elimTargets,
    };
  }
  const hasAction = (S, seat) => {
    const a = legal(S, seat);
    return !!(a.stake || a.intel || a.comm || a.lurkMax > 0 || a.eliminate);
  };

  /* ---- 行动：盯梢（随机抽 1 名叛徒成为自己的目标 → 牌库顶 1 张暗弃） ---- */
  function stake(S, seat, rnd = Math.random) {
    if (S.over || S.pending || S.turnSeat !== seat) return { ok: false, evs: [] };
    if (S.watches[seat] != null || !S.traitorPile.length) return { ok: false, evs: [] };
    const i = Math.floor(rnd() * S.traitorPile.length);
    S.watches[seat] = S.traitorPile.splice(i, 1)[0];
    S.stat.stakes++;
    const milled = mill(S, 1);
    logPush(S, seat, nameOf(S, seat) + ' 盯梢：锁定 1 名目标（剩 ' + S.traitorPile.length + ' 名待查）' +
      (milled.length ? '，牌库顶 1 张置入暗弃堆' : ''));
    const evs = [{ k: 'stake', seat, card: S.watches[seat] }, { k: 'mill', n: milled.length }];
    finishAction(S, evs);
    return { ok: true, evs };
  }

  /* ---- 行动：情报（打自己的手牌 → 判定计入自己盯梢目标的情报区） ---- */
  function intel(S, seat, idx) {
    if (S.over || S.pending || S.turnSeat !== seat) return { ok: false, evs: [] };
    if (S.watches[seat] == null) return { ok: false, evs: [] };
    if (idx < 0 || idx >= S.hands[seat].length) return { ok: false, evs: [] };
    const card = S.hands[seat].splice(idx, 1)[0];
    const zone = related(card, S.watches[seat]) ? 'rel' : 'unrel';
    S.intel[seat][zone].push(card);
    S.stat.intels++;
    logPush(S, seat, nameOf(S, seat) + ' 情报【' + cardName(card) + '】：' + (zone === 'rel' ? '有关' : '无关'));
    const evs = [{ k: 'play', seat, card, to: seat, zone }];
    finishAction(S, evs);
    return { ok: true, evs };
  }

  /* ---- 行动：通讯（打自己的手牌 → 判定计入所选玩家盯梢目标的情报区） ---- */
  function comm(S, seat, idx, targetSeat) {
    if (S.over || S.pending || S.turnSeat !== seat) return { ok: false, evs: [] };
    if (targetSeat === seat || S.watches[targetSeat] == null) return { ok: false, evs: [] };
    if (idx < 0 || idx >= S.hands[seat].length) return { ok: false, evs: [] };
    const card = S.hands[seat].splice(idx, 1)[0];
    const zone = related(card, S.watches[targetSeat]) ? 'rel' : 'unrel';
    S.intel[targetSeat][zone].push(card);
    S.stat.comms++;
    logPush(S, seat, nameOf(S, seat) + ' 通讯 → ' + nameOf(S, targetSeat) +
      '【' + cardName(card) + '】：' + (zone === 'rel' ? '有关' : '无关'));
    const evs = [{ k: 'play', seat, card, to: targetSeat, zone }];
    if (S.deck.length && S.hands[seat].length < HAND_MAX) {
      S.pending = 'draw'; S.pendingSeat = seat;   // 摸牌选择子阶段：摸或不摸后才轮到下一家
    } else {
      if (!S.deck.length) logPush(S, seat, '牌库已空，无可摸牌');
      finishAction(S, evs);
    }
    return { ok: true, evs };
  }

  /* ---- 行动：潜伏（摸 1~3 → 牌库顶 1 张暗弃；暗弃是必弃，故摸 k 张须牌库 ≥ k+1） ---- */
  function lurk(S, seat, k) {
    if (S.over || S.pending || S.turnSeat !== seat) return { ok: false, evs: [] };
    const hand = S.hands[seat];
    const max = Math.min(3, HAND_MAX - hand.length, S.deck.length - 1);
    if (max <= 0) return { ok: false, evs: [] };
    k = clamp(Math.round(k), 1, max);
    const got = drawTop(S, k);
    hand.push(...got);
    const milled = mill(S, 1);
    S.stat.lurks++;
    logPush(S, seat, nameOf(S, seat) + ' 潜伏：摸 ' + got.length + ' 张' +
      (milled.length ? '，牌库顶 1 张置入暗弃堆' : ''));
    const evs = [{ k: 'draw', cards: got, to: seat }, { k: 'mill', n: milled.length }];
    finishAction(S, evs);
    return { ok: true, evs };
  }

  /* ---- 行动：铲除（指认某名玩家盯梢目标的色 + 数；无论成败耗 1 发） ---- */
  function eliminate(S, seat, targetSeat, c, n) {
    if (S.over || S.pending || S.turnSeat !== seat) return { ok: false, evs: [] };
    if (targetSeat === seat) return { ok: false, evs: [] };      // 只能铲除他人盯梢的目标
    if (S.watches[targetSeat] == null) return { ok: false, evs: [] };
    if (c == null || n == null) return { ok: false, evs: [] };
    S.bullets--; S.stat.shots++;
    const guess = mk(c, n);
    const traitor = S.watches[targetSeat];
    const hit = guess === traitor;
    const evs = [{ k: 'shot', seat, target: targetSeat, hit, guess }];
    let won = false, reward = null;
    if (hit) {
      S.stat.hits++;
      evs.push({ k: 'reveal', seat: targetSeat, card: traitor });
      /* 该目标的情报区两区 → 明弃堆（正面向上） */
      const swept = [...S.intel[targetSeat].rel, ...S.intel[targetSeat].unrel];
      if (swept.length) { S.discardUp.push(...swept); evs.push({ k: 'sweep', seat: targetSeat, cards: swept }); }
      S.intel[targetSeat] = { rel: [], unrel: [] };
      S.watches[targetSeat] = null; S.caught++; S.caughtCards.push(traitor);
      S.deck.push(traitor); shuffle(S.deck, Math.random);       // 叛徒洗回牌库，重新混入人群
      evs.push({ k: 'back', card: traitor });
      logPush(S, seat, nameOf(S, seat) + ' 铲除成功！【' + cardName(traitor) + '】已清除' +
        '（' + nameOf(S, targetSeat) + ' 的盯梢目标）' +
        (S.caught < S.cfg.traitors ? '，该牌洗回牌库，剩 ' + traitorsLeft(S) + ' 名' : ''));
      if (S.caught >= S.cfg.traitors) {
        won = true;
        logPush(S, 'sys', '全部 ' + S.cfg.traitors + ' 名叛徒已铲除 —— 任务成功！');
        S.over = { win: true, why: 'done', stats: statLine(S) };
        S.pending = null; S.pendingSeat = null;
      } else if (S.hands[seat].length < HAND_MAX && (S.discardUp.length || S.discardDown.length)) {
        S.pending = 'reward'; S.pendingSeat = seat;
        reward = { up: S.discardUp.length, down: S.discardDown.length, seat };
      }
    } else {
      S.stat.misses++;
      logPush(S, seat, nameOf(S, seat) + ' 铲除落空：指认【' + cardName(guess) + '】不符（' +
        nameOf(S, targetSeat) + ' 的目标），耗 1 发（剩 ' + Math.max(0, S.bullets) + ' 发）');
      evs.push({ k: 'miss', seat, guess });
    }
    if (!won) checkEnd(S);
    if (!S.over && !S.pending) endTurn(S);
    return { ok: true, evs, hit, reward };
  }

  /* ---- 子阶段：通讯后的摸牌选择 ---- */
  function drawPick(S, seat, take) {
    if (S.over || S.pending !== 'draw' || S.pendingSeat !== seat) return { ok: false, evs: [] };
    const evs = [];
    if (take) {
      const got = drawTop(S, 1);
      if (got.length) {
        S.hands[seat].push(...got);
        logPush(S, seat, nameOf(S, seat) + ' 从牌库摸到【' + cardName(got[0]) + '】');
        evs.push({ k: 'draw', cards: got, to: seat });
      }
    } else {
      logPush(S, seat, nameOf(S, seat) + ' 选择不摸牌');
    }
    S.pending = null; S.pendingSeat = null;
    finishAction(S, evs);
    return { ok: true, evs };
  }

  /* ---- 子阶段：铲除成功后的拾牌（可选） ---- */
  function rewardPick(S, seat, pile, idx) {
    if (S.over || S.pending !== 'reward' || S.pendingSeat !== seat) return { ok: false, evs: [] };
    if (S.hands[seat].length >= HAND_MAX) return { ok: false, evs: [] };
    let card = null;
    if (pile === 'up' && idx >= 0 && idx < S.discardUp.length) card = S.discardUp.splice(idx, 1)[0];
    else if (pile === 'down' && S.discardDown.length) card = S.discardDown.splice(Math.floor(Math.random() * S.discardDown.length), 1)[0];
    if (card == null) return { ok: false, evs: [] };
    S.hands[seat].push(card);
    logPush(S, seat, pile === 'up'
      ? nameOf(S, seat) + ' 从明弃堆拾取【' + cardName(card) + '】'
      : nameOf(S, seat) + ' 从暗弃堆盲抽 1 张');
    S.pending = null; S.pendingSeat = null;
    endTurn(S);
    return { ok: true, evs: [{ k: 'pick', seat, card, from: pile }] };
  }
  function rewardSkip(S, seat) {
    if (S.over || S.pending !== 'reward' || S.pendingSeat !== seat) return { ok: false, evs: [] };
    logPush(S, seat, nameOf(S, seat) + ' 跳过了弃牌拾取');
    S.pending = null; S.pendingSeat = null;
    endTurn(S);
    return { ok: true, evs: [] };
  }

  /* ---- 结算收尾 ---- */
  function statLine(S) {
    return { rounds: S.round, shots: S.stat.shots, hits: S.stat.hits, misses: S.stat.misses,
      bullets: S.bullets, caught: S.caught, traitors: S.cfg.traitors, deck: S.deck.length };
  }
  function checkEnd(S) {
    if (S.over) return true;
    if (S.caught >= S.cfg.traitors) { S.over = { win: true, why: 'done', stats: statLine(S) }; return true; }
    if (traitorsLeft(S) > S.bullets) {
      logPush(S, 'sys', '弹药告急：剩 ' + traitorsLeft(S) + ' 名叛徒 > 剩余 ' + Math.max(0, S.bullets) + ' 发子弹 —— 任务失败');
      S.over = { win: false, why: 'bullets', stats: statLine(S) };
      return true;
    }
    return false;
  }
  function finishAction(S, evs) {
    if (checkEnd(S)) return;
    endTurn(S);
  }
  /* 死局：刚接手回合的一方五类行动全都不可执行 —— 任务失败 */
  function checkStuck(S) {
    if (S.over) return true;
    if (hasAction(S, S.turnSeat)) return false;
    logPush(S, 'sys', '任务陷入僵局：' + nameOf(S, S.turnSeat) + ' 已无任何行动可执行 —— 任务失败');
    S.over = { win: false, why: 'stuck', stats: statLine(S) };
    return true;
  }
  function endTurn(S) {
    if (S.over) return;
    S.turnSeat = (S.turnSeat + 1) % S.n;
    S.turnNo++;
    if (S.turnSeat === S.firstSeat) S.round++;
    checkStuck(S);
  }

  /* ---- 状态校验（联机收包 / 重连时用；不过即拒收） ---- */
  const isIntArr = a => Array.isArray(a) && a.every(x => Number.isInteger(x) && x >= 0 && x < 80);
  function validate(S) {
    if (!S || typeof S !== 'object') return false;
    const cfg = S.cfg;
    if (!cfg || (cfg.colors !== 4 && cfg.colors !== 5) || typeof cfg.one !== 'boolean') return false;
    if (!Number.isInteger(cfg.traitors) || cfg.traitors < TRAIT_MIN || cfg.traitors > TRAIT_MAX) return false;
    if (!Number.isInteger(cfg.extra) || cfg.extra < 0 || cfg.extra > EXTRA_MAX) return false;
    if (!Array.isArray(S.seats) || S.seats.length < SEAT_MIN || S.seats.length > SEAT_MAX) return false;
    const n = S.seats.length;
    if (S.n !== n) return false;
    for (const k of ['deck', 'traitorPile', 'discardDown', 'discardUp', 'caughtCards']) if (!isIntArr(S[k])) return false;
    if (!Array.isArray(S.hands) || S.hands.length !== n || !S.hands.every(isIntArr)) return false;
    if (!Array.isArray(S.watches) || S.watches.length !== n ||
        !S.watches.every(w => w === null || Number.isInteger(w))) return false;
    if (!Array.isArray(S.intel) || S.intel.length !== n ||
        !S.intel.every(z => z && isIntArr(z.rel) && isIntArr(z.unrel))) return false;
    if (![S.bullets, S.bulletsMax, S.caught, S.turnSeat, S.firstSeat, S.round].every(Number.isInteger)) return false;
    if (S.turnSeat < 0 || S.turnSeat >= n || S.firstSeat < 0 || S.firstSeat >= n) return false;
    if (S.pending !== null && S.pending !== 'reward' && S.pending !== 'draw') return false;
    if (S.over && typeof S.over.win !== 'boolean') return false;
    if (!Array.isArray(S.log)) return false;
    return true;
  }

  return {
    COLORS, GLYPH, HAND_MAX, TRAIT_MIN, TRAIT_MAX, EXTRA_MAX, SEAT_MIN, SEAT_MAX,
    cOf, nOf, mk, cardName, normCfg, bulletsOf, combos, deckSizeOf, difficultyOf, related,
    newGame, analyze, publicCandidates, traitorsLeft, watchSeats, nameOf, legal, hasAction,
    stake, intel, comm, lurk, eliminate, drawPick, rewardPick, rewardSkip,
    checkEnd, checkStuck, statLine, validate, logPush,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GO;
if (typeof window !== 'undefined') window.INFIL_OL = GO;
