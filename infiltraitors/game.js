/* ============================================================
   渗透因子 Infiltraitors · 规则引擎（纯逻辑，浏览器 + Node 通用）
   牌: 整数 id = (色 << 4) | 数字；色 0红 1黄 2绿 3蓝 4黑；数字 1~15
   人机分工: 玩家 = 通讯/潜伏/铲除；AI(夜枭) = 盯梢/情报/潜伏
   有关判定: 同色 | 同数 | 倍数 | 因数（1 不参与倍数/因数，只认同色/同数）
   胜负: 全歼叛徒 = 胜；未铲除叛徒 > 剩余子弹 = 负；轮到的一方五类行动全不可执行（死局）= 负
   ============================================================ */
'use strict';
const G = (() => {
  const COLORS = ['红', '黄', '绿', '蓝', '黑'];
  const GLYPH = ['◆', '●', '▲', '■', '★'];       // 色盲冗余：卡片/色块都带几何符号
  const NAMES = { you: '你', ai: '夜枭' };
  const HAND_MAX = 7;
  const LOGMAX = 80;
  const TRAIT_MIN = 7, TRAIT_MAX = 11, EXTRA_MAX = 3;

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
  /* 子弹总数 = 叛徒数量 + 额外子弹数（用户确认口径；11 叛徒 + 3 额外 = 14 = 盒中上限） */
  const bulletsOf = cfg => cfg.traitors + cfg.extra;
  /* 入局牌空间 */
  function combos(cfg) {
    const out = [];
    for (let c = 0; c < cfg.colors; c++) for (let n = cfg.one ? 1 : 2; n <= 15; n++) out.push(mk(c, n));
    return out;
  }
  /* 开局牌库张数 = 入局牌 - 叛徒 - 双方各 5 张手牌 */
  const deckSizeOf = cfg => combos(cfg).length - cfg.traitors - 10;
  /* 难度评级（2026-09-17 按用户标准重写，四原则）：① 5 色恒严于 4 色；② 叛徒越多越难；
     ③ 额外子弹越少越难；④ 数字 1 不改变评级。评级基准用「不含 1」牌库（= 每色 14 张 − 叛徒
     − 10），数字 1 的 +5 张只进实际牌库（deck 字段，展示用）不进评级；每名叛徒探测需求
     per = 5 ×（5 色 ? 1.5 : 1）——5 色候选空间 70 vs 56 且需沿 5 条色轴排除，1.5 倍系数
     保证任意叛徒/子弹组合下 5 色分数恒低于 4 色（需 > 1.4，最紧角 11 叛徒 +0 弹取到）。
     score = (基准牌库 + 额外子弹) / (per × 叛徒)：标签四档为粗粒度，同档内严格分序、跨色永不倒挂 */
  function difficultyOf(cfgIn) {
    const cfg = normCfg(cfgIn);
    const base = 14 * cfg.colors - cfg.traitors - 10;
    const per = 5 * (cfg.colors >= 5 ? 1.5 : 1);
    const need = per * cfg.traitors;
    const score = (base + cfg.extra) / need;
    return {
      deck: deckSizeOf(cfg), need, score,
      tag: score >= 1.15 ? '轻松' : score >= 1.0 ? '标准' : score >= 0.8 ? '紧张' : '绝望',
    };
  }
  /* 提示牌 a 与叛徒 b 是否「有关」：同色 | 同数 | 倍数 | 因数
     （数字 1 不参与倍数/因数匹配，只认同色/同数） */
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

  function logPush(S, who, text) {
    S.log.push({ no: S.round, who, text });
    if (S.log.length > LOGMAX) S.log.splice(0, S.log.length - LOGMAX);
  }
  const traitorsLeft = S => (S.aiWatch ? 1 : 0) + S.traitorPile.length;

  /* ---- 公开候选分析（AI 情报选牌 + 推论板共用；只依赖公开信息，不含真相） ---- */
  /* located: 已被公开定位、不可能仍是当前盯梢叛徒的牌（玩家手牌/情报区/明弃堆）
     judge:   与历史判定矛盾而排除的牌（auto 模式才计算） */
  function analyze(S, auto = true) {
    const total = combos(S.cfg);
    const located = new Set([...S.hand, ...S.intel.rel, ...S.intel.unrel, ...S.discardUp]);
    const judge = new Set(), cand = [];
    for (const id of total) {
      if (located.has(id)) continue;
      if (auto) {
        let ok = true;
        for (const k of S.intel.rel) if (!related(k, id)) { ok = false; break; }
        if (ok) for (const k of S.intel.unrel) if (related(k, id)) { ok = false; break; }
        if (!ok) { judge.add(id); continue; }
      }
      cand.push(id);
    }
    return { total, cand, located, judge };
  }
  /* 公开候选集（AI 用；恒包含真相，因为真相不位于任何公开位置且判定由它自身产生） */
  const publicCandidates = S => analyze(S, true).cand;

  /* ---- 发牌与开局 ---- */
  function newGame(cfgIn, rnd = Math.random) {
    const cfg = normCfg(cfgIn);
    const deck = shuffle(combos(cfg), rnd);
    const traitorPile = deck.splice(Math.max(0, deck.length - cfg.traitors), cfg.traitors);
    const hand = deck.splice(Math.max(0, deck.length - 5), 5);
    const aiHand = deck.splice(Math.max(0, deck.length - 5), 5);
    const S = {
      cfg, deck, traitorPile, hand, aiHand,
      aiWatch: null,
      intel: { rel: [], unrel: [] },
      discardDown: [], discardUp: [],
      bulletsMax: bulletsOf(cfg), bullets: bulletsOf(cfg), caught: 0, caughtCards: [],
      turn: 0, turnNo: 1, round: 1,
      pending: null, over: null, log: [], openEvs: [],
      stat: { shots: 0, hits: 0, misses: 0, probes: 0, hints: 0, lurks: 0 },
    };
    logPush(S, 'sys', '任务开始：' + cfg.colors + ' 色 · ' + (cfg.one ? '含 1' : '不含 1') +
      ' · 叛徒 ' + cfg.traitors + ' 名 · 子弹 ' + S.bullets + ' 发');
    /* 开局布控（Q2 已确认）：AI 先锁 1 名目标并暗弃 1 张，玩家第 1 回合选择完整 */
    const evs = doStake(S, rnd);
    S.openEvs = evs;
    return S;
  }

  /* ---- AI 盯梢：叛徒区随机抽 1 张 → 盯梢区；牌库顶 1 张 → 暗弃堆 ---- */
  function doStake(S, rnd = Math.random) {
    if (S.aiWatch || !S.traitorPile.length) return [];
    const i = Math.floor(rnd() * S.traitorPile.length);
    S.aiWatch = S.traitorPile.splice(i, 1)[0];
    const milled = mill(S, 1);
    logPush(S, 'ai', '夜枭已布控：锁定 1 名目标（剩 ' + S.traitorPile.length + ' 名待查）' +
      (milled.length ? '，牌库顶 1 张置入暗弃堆' : ''));
    return [{ k: 'stake', card: S.aiWatch }, { k: 'mill', n: milled.length }];
  }

  /* ---- AI 情报：从手牌选信息量最大的一张打出（最小化剩余公开候选） ---- */
  function chooseHintIdx(S, rnd = Math.random) {
    if (!S.aiHand.length) return -1;
    if (rnd() < 0.12) return Math.floor(rnd() * S.aiHand.length);   // 12% 拟人抖动
    const cands = publicCandidates(S);
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < S.aiHand.length; i++) {
      const h = S.aiHand[i], out = related(h, S.aiWatch);
      let n = 0;
      for (const c of cands) if (related(h, c) === out) n++;
      const score = n + rnd() * 1.2;          // 平局抖动
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  function doHint(S, idx) {
    if (idx < 0 || idx >= S.aiHand.length || !S.aiWatch) return [];
    const card = S.aiHand.splice(idx, 1)[0];
    const zone = related(card, S.aiWatch) ? 'rel' : 'unrel';
    S.intel[zone].push(card);
    S.stat.hints++;
    logPush(S, 'ai', '夜枭情报【' + cardName(card) + '】：' + (zone === 'rel' ? '有关' : '无关'));
    return [{ k: 'play', card, from: 'aiHand', zone }];
  }

  /* ---- 摸牌（含上限与牌库不足处理） ---- */
  function doDraw(S, n, to) {
    const cards = drawTop(S, n);
    if (to === 'aiHand') S.aiHand.push(...cards); else S.hand.push(...cards);
    return cards;
  }
  function doLurkDraw(S, to) {
    const cur = to === 'aiHand' ? S.aiHand.length : S.hand.length;
    /* 摸 k 张后还须暗弃 1 张：k 至多留 1 张给暗弃 */
    const k = Math.max(0, Math.min(3, HAND_MAX - cur, S.deck.length - 1));
    const got = k > 0 ? doDraw(S, k, to) : [];
    const milled = mill(S, 1);
    S.stat.lurks++;
    return { got, milled, k };
  }

  /* ---- 玩家行动 ---- */
  const playerActions = S => ({
    probe: !!(S.aiWatch && S.hand.length),
    /* 摸 k 张须给必弃的 1 张留余量：k ≤ 牌库 - 1 */
    lurkMax: Math.max(0, Math.min(3, HAND_MAX - S.hand.length, S.deck.length - 1)),
    eliminate: !!S.aiWatch,
  });

  /* 死局判定：轮到的一方五类行动全都不可执行才判负 */
  /* 玩家：盯梢/情报属夜枭；通讯需手牌+盯梢，潜伏需牌库≥2+未满手，铲除需盯梢 */
  const playerHasAction = S =>
    !!(S.aiWatch && (S.hand.length || S.bullets > 0)) ||
    !!(S.deck.length >= 2 && S.hand.length < HAND_MAX);
  /* 夜枭：盯梢需尚未布控且叛徒区有牌；情报需手牌；潜伏需牌库≥2+未满手 */
  const aiHasAction = S =>
    !!(!S.aiWatch && S.traitorPile.length) ||
    !!(S.aiWatch && S.aiHand.length) ||
    !!(S.deck.length >= 2 && S.aiHand.length < HAND_MAX);

  /* 通讯：手牌 → 判定 → 情报区；牌库有牌时进入「是否摸 1 张」选择 */
  function playerProbe(S, idx) {
    if (S.over || S.turn !== 0 || S.pending || !S.aiWatch) return { ok: false, evs: [] };
    if (idx < 0 || idx >= S.hand.length) return { ok: false, evs: [] };
    const card = S.hand.splice(idx, 1)[0];
    const zone = related(card, S.aiWatch) ? 'rel' : 'unrel';
    S.intel[zone].push(card);
    S.stat.probes++;
    logPush(S, 'you', '你通讯【' + cardName(card) + '】：' + (zone === 'rel' ? '有关' : '无关'));
    const evs = [{ k: 'play', card, from: 'hand', zone }];
    if (S.deck.length && S.hand.length < HAND_MAX) {
      S.pending = 'draw';                     // 摸牌选择子阶段：摸或不摸后才轮到 AI
    } else {
      if (!S.deck.length) logPush(S, 'you', '牌库已空，无可摸牌');
      finishAction(S, evs);
    }
    return { ok: true, evs };
  }

  /* 通讯后的摸牌选择：take=true 摸 1 张，否则不摸；随后结算回合 */
  function drawPick(S, take) {
    if (S.over || S.pending !== 'draw') return { ok: false, evs: [] };
    const evs = [];
    if (take) {
      const got = doDraw(S, 1, 'hand');
      if (got.length) {
        logPush(S, 'you', '你从牌库摸到【' + cardName(got[0]) + '】');
        evs.push({ k: 'draw', cards: got, to: 'hand' });
      }
    } else {
      logPush(S, 'you', '你选择不摸牌');
    }
    S.pending = null;
    finishAction(S, evs);
    return { ok: true, evs };
  }

  /* 潜伏：摸 1~3（上限 7）→ 牌库顶 1 张暗弃；摸 k 张须牌库 ≥ k+1 */
  function playerLurk(S, k) {
    if (S.over || S.turn !== 0 || S.pending) return { ok: false, evs: [] };
    const max = Math.min(3, HAND_MAX - S.hand.length, S.deck.length - 1);
    if (max <= 0) return { ok: false, evs: [] };
    k = clamp(Math.round(k), 1, max);
    const got = doDraw(S, k, 'hand');
    const milled = mill(S, 1);
    S.stat.lurks++;
    logPush(S, 'you', '你潜伏：摸 ' + got.length + ' 张' + (milled.length ? '，牌库顶 1 张置入暗弃堆' : ''));
    const evs = [{ k: 'draw', cards: got, to: 'hand' }, { k: 'mill', n: milled.length }];
    finishAction(S, evs);
    return { ok: true, evs };
  }

  /* 铲除：指认色 + 数；无论成败耗 1 发 */
  function playerEliminate(S, c, n) {
    if (S.over || S.turn !== 0 || S.pending || !S.aiWatch) return { ok: false, evs: [] };
    if (c == null || n == null) return { ok: false, evs: [] };
    S.bullets--; S.stat.shots++;
    const guess = mk(c, n);
    const hit = guess === S.aiWatch;
    const evs = [{ k: 'shot', hit, guess }];
    let won = false, reward = null;
    if (hit) {
      S.stat.hits++;
      const traitor = S.aiWatch;
      evs.push({ k: 'reveal', card: traitor });
      /* 情报区两区 → 明弃堆（正面向上） */
      const swept = [...S.intel.rel, ...S.intel.unrel];
      if (swept.length) { S.discardUp.push(...swept); evs.push({ k: 'sweep', cards: swept }); }
      S.intel = { rel: [], unrel: [] };
      S.aiWatch = null; S.caught++; S.caughtCards.push(traitor);
      /* 叛徒洗回牌库（重新混入人群） */
      S.deck.push(traitor); shuffle(S.deck, Math.random);
      evs.push({ k: 'back', card: traitor });
      logPush(S, 'you', '铲除成功！【' + cardName(traitor) + '】已被清除，' +
        (S.caught < S.cfg.traitors ? '该牌加入牌库并洗混，剩 ' + traitorsLeft(S) + ' 名' : ''));
      if (S.caught >= S.cfg.traitors) {
        won = true;
        logPush(S, 'sys', '全部 ' + S.cfg.traitors + ' 名叛徒已铲除 —— 任务成功！');
        S.over = { win: true, why: 'done', stats: statLine(S) };
        S.pending = null;
      } else if (S.hand.length < HAND_MAX && (S.discardUp.length || S.discardDown.length)) {
        S.pending = 'reward';                 // 拾牌子阶段：拾取或跳过后才轮到 AI
        reward = { up: S.discardUp.length, down: S.discardDown.length, full: false };
      }
    } else {
      S.stat.misses++;
      logPush(S, 'you', '铲除落空：指认【' + cardName(guess) + '】不符，消耗 1 发（剩 ' + Math.max(0, S.bullets) + ' 发）');
      evs.push({ k: 'miss', guess });
    }
    if (!won) checkEnd(S);
    if (!S.over && !S.pending) endTurn(S);
    return { ok: true, evs, hit, reward };
  }

  /* 拾牌（铲除成功的奖励，可选）：up 指定明弃堆下标 / down 盲抽 / skip 跳过 */
  function rewardPick(S, pile, idx) {
    if (S.over || S.pending !== 'reward') return { ok: false, evs: [] };
    if (S.hand.length >= HAND_MAX) return { ok: false, evs: [] };
    let card = null;
    if (pile === 'up' && idx >= 0 && idx < S.discardUp.length) card = S.discardUp.splice(idx, 1)[0];
    else if (pile === 'down' && S.discardDown.length) card = S.discardDown.splice(Math.floor(Math.random() * S.discardDown.length), 1)[0];
    if (card == null) return { ok: false, evs: [] };
    S.hand.push(card);
    logPush(S, 'you', (pile === 'up' ? '你从明弃堆拾取【' + cardName(card) + '】' : '你从暗弃堆盲抽 1 张'));
    S.pending = null;
    endTurn(S);
    return { ok: true, evs: [{ k: 'pick', card, from: pile }] };
  }
  function rewardSkip(S) {
    if (S.over || S.pending !== 'reward') return { ok: false, evs: [] };
    logPush(S, 'you', '你跳过了弃牌拾取');
    S.pending = null;
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
    if (S.caught >= S.cfg.traitors) {
      S.over = { win: true, why: 'done', stats: statLine(S) };
      return true;
    }
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
  /* 死局：刚接手回合的一方五类行动全都不可执行 —— 任务失败（取代旧的「牌库摸空即负」） */
  function checkStuck(S) {
    if (S.over) return true;
    if (S.turn === 0 ? playerHasAction(S) : aiHasAction(S)) return false;
    logPush(S, 'sys', '任务陷入僵局：' + (S.turn === 0 ? NAMES.you : NAMES.ai) + '已无任何行动可执行 —— 任务失败');
    S.over = { win: false, why: 'stuck', stats: statLine(S) };
    return true;
  }
  function endTurn(S) {
    if (S.over) return;
    S.turn = 1 - S.turn;
    S.turnNo++;
    if (S.turn === 0) S.round++;
    checkStuck(S);
  }

  /* ---- AI 回合：盯梢 / 情报 / 潜伏 三选一（必须行动，无「按兵不动」） ---- */
  function aiTakeTurn(S, rnd = Math.random) {
    if (S.over || S.turn !== 1) return { op: null, evs: [] };
    let op, evs;
    if (!S.aiWatch) { evs = doStake(S, rnd); op = { k: 'stake' }; if (!evs.length) { checkEnd(S); if (!S.over) endTurn(S); return { op, evs }; } }
    else if (S.aiHand.length) {
      const idx = chooseHintIdx(S, rnd);
      evs = doHint(S, idx);
      op = { k: 'hint', idx };
    } else if (S.deck.length >= 2) {
      const r = doLurkDraw(S, 'aiHand');
      logPush(S, 'ai', '夜枭潜伏：补 ' + r.got.length + ' 张手牌' + (r.milled.length ? '，牌库顶 1 张置入暗弃堆' : ''));
      evs = [{ k: 'draw', cards: r.got, to: 'aiHand' }, { k: 'mill', n: r.milled.length }];
      op = { k: 'lurk' };
    } else {
      op = { k: 'none' };                    // 无任何行动可执行：立即死局判负
      evs = [];
      checkStuck(S);
      return { op, evs };
    }
    checkEnd(S);
    if (!S.over) endTurn(S);
    return { op, evs };
  }

  /* 代打玩家（平衡模拟用的参考打法）：能省牌就省牌，子弹该花就花，绝不无谓潜伏 */
  function autoPlayerAct(S, rnd = Math.random) {
    if (S.over || S.turn !== 0) return null;
    if (S.pending === 'reward') return null;
    if (S.pending === 'draw') {
      /* 摸牌余量：留下「查清剩余叛徒」的探测预算（约 4 张/名）才摸 */
      return { act: 'draw', take: S.deck.length > 4 * traitorsLeft(S) };
    }
    const cands = publicCandidates(S);
    const left = traitorsLeft(S);
    const spare = Math.max(0, S.bullets - left);            // 还能浪费几发
    if (S.aiWatch && cands.length) {
      /* 候选已可被子弹排空（含容错）就直接排空：子弹是死的，牌库才是活的时钟 */
      const tight = S.deck.length <= 3 * left + 2;
      if (cands.length <= spare + 1 && (cands.length <= 3 || tight)) {
        return { act: 'elim', c: cOf(cands[0]), n: nOf(cands[0]) };
      }
    }
    if (S.hand.length && cands.length > 1) {
      /* 选最均衡切分候选的牌做试探 */
      let best = 0, bestScore = Infinity;
      for (let i = 0; i < S.hand.length; i++) {
        let r = 0;
        for (const c of cands) if (related(S.hand[i], c)) r++;
        const score = Math.max(r, cands.length - r) + rnd() * 0.8;
        if (score < bestScore) { bestScore = score; best = i; }
      }
      return { act: 'probe', idx: best };
    }
    if (S.hand.length && S.aiWatch && cands.length) {
      return { act: 'elim', c: cOf(cands[0]), n: nOf(cands[0]) };
    }
    if (S.deck.length >= 2 && S.hand.length < HAND_MAX) return { act: 'lurk', k: Math.min(3, HAND_MAX - S.hand.length, S.deck.length - 1) };
    /* 手牌枯竭且牌库见底：孤注一掷按候选开火 */
    if (S.aiWatch && cands.length) return { act: 'elim', c: cOf(cands[0]), n: nOf(cands[0]) };
    return null;
  }
  function applyPlayerAct(S, a, rnd = Math.random) {
    if (!a) return { ok: false, evs: [] };
    if (a.act === 'draw') return drawPick(S, a.take);
    if (a.act === 'probe') return playerProbe(S, a.idx);
    if (a.act === 'lurk') return playerLurk(S, a.k);
    if (a.act === 'elim') return playerEliminate(S, a.c, a.n);
    return { ok: false, evs: [] };
  }

  /* ---- 存档结构校验（恢复时用；不过即清档） ---- */
  const isIntArr = a => Array.isArray(a) && a.every(x => Number.isInteger(x) && x >= 0 && x < 80);
  function validate(S) {
    if (!S || typeof S !== 'object') return false;
    const cfg = S.cfg;
    if (!cfg || (cfg.colors !== 4 && cfg.colors !== 5) || typeof cfg.one !== 'boolean') return false;
    if (!Number.isInteger(cfg.traitors) || cfg.traitors < TRAIT_MIN || cfg.traitors > TRAIT_MAX) return false;
    if (!Number.isInteger(cfg.extra) || cfg.extra < 0 || cfg.extra > EXTRA_MAX) return false;
    for (const k of ['deck', 'traitorPile', 'hand', 'aiHand', 'discardDown', 'discardUp']) if (!isIntArr(S[k])) return false;
    if (!S.intel || !isIntArr(S.intel.rel) || !isIntArr(S.intel.unrel)) return false;
    if (S.aiWatch !== null && !Number.isInteger(S.aiWatch)) return false;
    if (!Number.isInteger(S.bullets) || !Number.isInteger(S.bulletsMax)) return false;
    if (!Number.isInteger(S.caught) || !Number.isInteger(S.turn) || !Number.isInteger(S.round)) return false;
    /* caughtCards（已铲除的叛徒牌，UI 讲真相用）为后加字段：旧档按铲除数从牌库顺位补出 */
    if (!Array.isArray(S.caughtCards) || S.caughtCards.length !== S.caught || !S.caughtCards.every(Number.isInteger))
      S.caughtCards = S.deck.slice(0, S.caught);
    if (S.pending !== null && S.pending !== 'reward' && S.pending !== 'draw') return false;
    if (S.over && typeof S.over.win !== 'boolean') return false;
    if (!Array.isArray(S.log)) return false;
    return true;
  }

  return {
    COLORS, GLYPH, NAMES, HAND_MAX, TRAIT_MIN, TRAIT_MAX, EXTRA_MAX,
    cOf, nOf, mk, cardName, normCfg, bulletsOf, combos, deckSizeOf, difficultyOf, related,
    newGame, analyze, publicCandidates, traitorsLeft, playerActions, playerHasAction, aiHasAction,
    playerProbe, drawPick, playerLurk, playerEliminate, rewardPick, rewardSkip,
    aiTakeTurn, chooseHintIdx, autoPlayerAct, applyPlayerAct,
    checkEnd, checkStuck, statLine, validate, logPush,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = G;
if (typeof window !== 'undefined') window.INFIL = G;
