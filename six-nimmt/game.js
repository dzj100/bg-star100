'use strict';
/* 《牛头王》6 nimmt! —— 纯规则引擎
   不碰 DOM、不用 Math.random；洗牌一律走注入的 seeded rng。
   牌 = 数字 1..104（全局唯一）。单局制：每人 10 张，10 墩打完即终局。
   行位置固定 0..3，开局后不再重排；行内牌始终升序。
   → window.SixNimmt + module.exports */
(function (root) {
  const SN = {};

  /* ================= 常量 ================= */

  SN.DECK_SIZE = 104;
  SN.HAND_SIZE = 10;
  SN.ROWS = 4;
  SN.TRICKS = 10;            /* 单局制：一墩一张手牌 → 10 墩正好打空 */
  SN.MIN_PLAYERS = 2;
  SN.MAX_PLAYERS = 10;
  SN.AI_NAMES = ['铁角', '花斑', '小蛮', '老麦', '黑蹄', '铜铃', '雪球', '阿黄', '大角'];

  const LOG_CAP = 200;
  const PHASES = { selecting: 1, revealing: 1, chooseRow: 1, trickEnd: 1, gameEnd: 1 };

  /* ================= 牌面 ================= */

  /* 判定优先级：55 → 11 的倍数 → 整十 → 个位 5 → 其余 */
  SN.bullsOf = function (card) {
    if (card === 55) return 7;
    if (card % 11 === 0) return 5;
    if (card % 10 === 0) return 3;
    if (card % 10 === 5) return 2;
    return 1;
  };

  SN.rowBulls = function (cards) {
    let s = 0;
    for (let i = 0; i < cards.length; i++) s += SN.bullsOf(cards[i]);
    return s;
  };

  /* ================= 随机 ================= */

  /* mulberry32；额外带 state()/set() 便于存档后接着用同一条随机流 */
  SN.seeded = function (seed) {
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

  /* 返回“洗好的副本”，不改动入参 */
  SN.shuffle = function (arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  };

  SN.clone = function (S) { return JSON.parse(JSON.stringify(S)); };

  /* ================= 放牌预判（纯计算，不改状态） ================= */

  /* rows 可以是 [[..], ..]，也可以是状态里的 [{index,cards}, ..] */
  function cardsOf(row) { return Array.isArray(row) ? row : row.cards; }

  /* 返回：
     比所有行尾都小 → {mustChoose:true, options:[0,1,2,3]}
     正常落下       → {rowIndex, full:false, took:[], bulls:0}
     行已满 5 张    → {rowIndex, full:true, took:[5 张], bulls} */
  SN.simulatePlacement = function (rows, card) {
    let best = -1, bestLast = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const cs = cardsOf(rows[i]);
      const last = cs[cs.length - 1];
      if (last < card && last > bestLast) { bestLast = last; best = i; }
    }
    if (best < 0) {
      const options = [];
      for (let i = 0; i < rows.length; i++) options.push(i);
      return { mustChoose: true, options: options };
    }
    const cs = cardsOf(rows[best]);
    if (cs.length >= 5) {
      const took = cs.slice();
      return { rowIndex: best, full: true, took: took, bulls: SN.rowBulls(took) };
    }
    return { rowIndex: best, full: false, took: [], bulls: 0 };
  };

  /* ================= 序列化 ================= */

  SN.serialize = function (S) { return JSON.stringify(S); };
  SN.deserialize = function (str) { return JSON.parse(str); };

  /* FNV-1a（32 位），输出 8 位十六进制 */
  SN.stateHash = function (S) {
    const s = typeof S === 'string' ? S : JSON.stringify(S);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  };

  /* ================= 排名 ================= */

  /* winners = 获胜座位号数组（可能多人共享） */
  SN.rankings = function (S) {
    const order = S.players.map(function (p) {
      return {
        seat: p.seat, name: p.name, ai: !!p.ai, score: p.score,
        rowsTaken: p.rowsTaken, takenCount: p.taken.length,
        rank: 0, shared: false, winner: false
      };
    });
    order.sort(function (a, b) { return a.score - b.score || a.seat - b.seat; });
    let prevScore = null, prevRank = 0;
    for (let i = 0; i < order.length; i++) {
      if (prevScore !== null && order[i].score === prevScore) order[i].rank = prevRank;
      else { order[i].rank = i + 1; prevRank = i + 1; }
      prevScore = order[i].score;
    }
    const min = order.length ? order[0].score : 0;
    const winners = [];
    for (const e of order) {
      e.winner = e.score === min;
      if (e.winner) winners.push(e.seat);
    }
    for (const e of order) e.shared = e.winner && winners.length > 1;
    return { order: order, winners: winners };
  };

  /* ================= 校验 ================= */

  SN.validate = function (S) {
    const errs = [];
    if (!S || typeof S !== 'object') return { ok: false, errs: ['状态不存在'] };
    if (!PHASES[S.phase]) errs.push('非法阶段 ' + S.phase);
    if (!(S.trick >= 1 && S.trick <= SN.TRICKS)) errs.push('墩数越界 ' + S.trick);
    if (!Array.isArray(S.players) || S.players.length < SN.MIN_PLAYERS || S.players.length > SN.MAX_PLAYERS) {
      errs.push('玩家数非法 ' + (S.players && S.players.length));
    }
    if (!Array.isArray(S.rows) || S.rows.length !== SN.ROWS) errs.push('行数不是 ' + SN.ROWS);

    const cards = {};
    function account(card, where) {
      if (!(typeof card === 'number' && card === (card | 0) && card >= 1 && card <= SN.DECK_SIZE)) {
        errs.push(where + ' 出现非法牌 ' + card);
        return;
      }
      cards[card] = (cards[card] || 0) + 1;
    }

    for (const r of S.rows || []) {
      const cs = r && r.cards;
      if (!Array.isArray(cs) || cs.length < 1 || cs.length > 5) errs.push('行 ' + (r && r.index) + ' 长度非法 ' + (cs && cs.length));
      for (const c of cs || []) account(c, '行' + r.index);
    }

    for (const p of S.players || []) {
      if (!Array.isArray(p.hand)) errs.push('座位 ' + p.seat + ' 手牌非法');
      else for (const c of p.hand) account(c, '座位' + p.seat + ' 手牌');
      if (p.selected !== null && p.selected !== undefined) account(p.selected, '座位' + p.seat + ' 已选');
      if (!Array.isArray(p.taken)) errs.push('座位 ' + p.seat + ' 收缴堆非法');
      else for (const c of p.taken) account(c, '座位' + p.seat + ' 收缴');
      const want = SN.rowBulls(p.taken || []);
      if (p.score !== want) errs.push('座位 ' + p.seat + ' 分数 ' + p.score + ' ≠ 收缴牛头 ' + want);
      if (!(p.score >= 0)) errs.push('座位 ' + p.seat + ' 分数为负');
      if (!(p.rowsTaken >= 0)) errs.push('座位 ' + p.seat + ' rowsTaken 为负');
      if ((p.taken || []).length > 0 && !(p.rowsTaken >= 1)) errs.push('座位 ' + p.seat + ' 有收缴但 rowsTaken=0');
    }

    const selSeen = {};
    for (const p of S.players || []) {
      if (p.selected === null || p.selected === undefined) continue;
      if (selSeen[p.selected]) errs.push('已选牌重复 ' + p.selected);
      selSeen[p.selected] = 1;
    }

    for (const c of S.unused || []) account(c, '未使用');

    let total = 0, dup = 0;
    for (const k in cards) {
      total += cards[k];
      if (cards[k] > 1) dup += 1;
    }
    if (dup) errs.push('有 ' + dup + ' 张牌重复出现');
    if (total !== SN.DECK_SIZE) errs.push('在场/未使用牌数 ' + total + ' ≠ ' + SN.DECK_SIZE);

    const q = S.revealQueue || [];
    const qSeen = {};
    for (const it of q) {
      if (qSeen[it.card]) errs.push('亮牌队列重复 ' + it.card);
      qSeen[it.card] = 1;
    }
    if (!(S.revealIndex >= 0 && S.revealIndex <= q.length)) errs.push('revealIndex 越界 ' + S.revealIndex);

    if (S.phase === 'chooseRow') {
      const pc = S.pendingChoice;
      if (!pc) errs.push('chooseRow 阶段缺少 pendingChoice');
      else {
        if (!(pc.seat >= 0 && pc.seat < (S.players || []).length)) errs.push('pendingChoice 座位非法');
        if (!Array.isArray(pc.options) || pc.options.length !== SN.ROWS) errs.push('pendingChoice options 非法');
        const cur = q[S.revealIndex];
        if (!cur) errs.push('chooseRow 时亮牌队列已耗尽');
        else {
          if (cur.card !== pc.card) errs.push('pendingChoice 牌号与队列不一致');
          if (cur.seat !== pc.seat) errs.push('pendingChoice 座位与队列不一致');
        }
      }
    } else if (S.pendingChoice) {
      errs.push('非 chooseRow 阶段残留 pendingChoice');
    }

    return { ok: errs.length === 0, errs: errs };
  };

  /* ================= 开局 ================= */

  function clampInt(v, a, b) {
    let n = Math.floor(Number(v));
    if (!isFinite(n)) n = a;
    return n < a ? a : (n > b ? b : n);
  }

  SN.newGame = function (opts) {
    opts = opts || {};
    let total, aiCount;
    if (opts.playerCount !== undefined && opts.playerCount !== null) {
      total = clampInt(opts.playerCount, SN.MIN_PLAYERS, SN.MAX_PLAYERS);
      aiCount = total - 1;
    } else {
      const want = (opts.aiCount !== undefined && opts.aiCount !== null)
        ? clampInt(opts.aiCount, 0, SN.MAX_PLAYERS - 1) : 4;
      total = clampInt(want + 1, SN.MIN_PLAYERS, SN.MAX_PLAYERS);
      aiCount = total - 1;
    }
    const difficulty = (opts.difficulty === 'easy' || opts.difficulty === 'hard') ? opts.difficulty : 'normal';
    const seed = (opts.seed !== undefined && opts.seed !== null)
      ? (opts.seed >>> 0)
      : ((typeof Date !== 'undefined' ? Date.now() : 1) >>> 0);
    const rng = SN.seeded(seed);
    const pool = (opts.aiNames && opts.aiNames.length) ? opts.aiNames : SN.AI_NAMES;

    const players = [];
    for (let i = 0; i < total; i++) {
      const name = i === 0
        ? (opts.humanName || '你')
        : (pool[i - 1] || SN.AI_NAMES[(i - 1) % SN.AI_NAMES.length]);
      players.push({
        seat: i, name: name, ai: i !== 0, avatar: i,
        hand: [], selected: null, taken: [], score: 0, rowsTaken: 0
      });
    }

    const deck = [];
    for (let c = 1; c <= SN.DECK_SIZE; c++) deck.push(c);
    const shuffled = SN.shuffle(deck, rng);

    for (let k = 0; k < SN.HAND_SIZE; k++) {
      for (const p of players) p.hand.push(shuffled.shift());
    }
    for (const p of players) p.hand.sort(function (a, b) { return a - b; });

    const drawn = [];
    for (let i = 0; i < SN.ROWS; i++) drawn.push([shuffled.shift()]);
    drawn.sort(function (a, b) { return a[a.length - 1] - b[b.length - 1]; });
    const rows = drawn.map(function (cs, i) { return { index: i, cards: cs }; });

    return {
      v: 1,
      seed: seed,
      rngState: rng.state(),
      phase: 'selecting',
      trick: 1,
      players: players,
      rows: rows,
      unused: shuffled,                 /* 本局不再发牌 */
      revealQueue: [],
      revealIndex: 0,
      pendingChoice: null,
      lastEvent: null,
      log: [],
      rev: 1,
      seq: 0,
      settings: { playerCount: total, aiCount: aiCount, difficulty: difficulty, seed: seed }
    };
  };

  /* ================= 内部：日志 / 结算 ================= */

  function pushLog(S, type, extra) {
    S.seq += 1;
    const e = { seq: S.seq, trick: S.trick, type: type };
    if (extra) for (const k in extra) e[k] = extra[k];
    S.log.push(e);
    if (S.log.length > LOG_CAP) S.log.splice(0, S.log.length - LOG_CAP);
    return e;
  }

  function applyPlace(S, seat, card, rowIndex) {
    S.rows[rowIndex].cards.push(card);
    S.players[seat].selected = null;
    S.revealIndex += 1;
    const queueDone = S.revealIndex >= S.revealQueue.length;
    S.phase = queueDone ? 'trickEnd' : 'revealing';
    S.lastEvent = pushLog(S, 'place', { seat: seat, card: card, rowIndex: rowIndex, took: [], bulls: 0, viaChoice: false });
    S.rev += 1;
    return {
      type: 'place', seat: seat, card: card, rowIndex: rowIndex,
      took: [], bulls: 0, viaChoice: false, queueDone: queueDone, trick: S.trick
    };
  }

  function applyTake(S, seat, card, rowIndex, viaChoice) {
    const p = S.players[seat];
    const row = S.rows[rowIndex];
    const took = row.cards.slice();
    const bulls = SN.rowBulls(took);
    p.score += bulls;
    p.rowsTaken += 1;
    for (const c of took) p.taken.push(c);
    row.cards = [card];
    p.selected = null;
    S.pendingChoice = null;
    S.revealIndex += 1;
    const queueDone = S.revealIndex >= S.revealQueue.length;
    S.phase = queueDone ? 'trickEnd' : 'revealing';
    S.lastEvent = pushLog(S, 'take', {
      seat: seat, card: card, rowIndex: rowIndex, took: took, bulls: bulls, viaChoice: !!viaChoice
    });
    S.rev += 1;
    return {
      type: 'take', seat: seat, card: card, rowIndex: rowIndex,
      took: took, bulls: bulls, viaChoice: !!viaChoice, queueDone: queueDone, trick: S.trick
    };
  }

  /* ================= 选牌 ================= */

  SN.selectCard = function (S, seat, card) {
    if (S.phase !== 'selecting') throw new Error('selectCard: phase=' + S.phase);
    if (!(typeof seat === 'number' && seat === (seat | 0) && seat >= 0 && seat < S.players.length)) {
      throw new Error('selectCard: 非法座位 ' + seat);
    }
    const p = S.players[seat];
    if (p.selected !== null && p.selected !== undefined) throw new Error('selectCard: 座位 ' + seat + ' 已选牌');
    if (!(typeof card === 'number' && card === (card | 0))) throw new Error('selectCard: 非法牌 ' + card);
    const at = p.hand.indexOf(card);
    if (at < 0) throw new Error('selectCard: 牌 ' + card + ' 不在座位 ' + seat + ' 手上');
    p.hand.splice(at, 1);
    p.selected = card;
    S.rev += 1;
    /* 亮牌前不把牌面写进日志 */
    pushLog(S, 'select', { seat: seat });
    return { seat: seat, card: card };
  };

  SN.allSelected = function (S) {
    if (!S.players.length) return false;
    for (const p of S.players) if (p.selected === null || p.selected === undefined) return false;
    return true;
  };

  SN.beginReveal = function (S) {
    if (S.phase !== 'selecting') throw new Error('beginReveal: phase=' + S.phase);
    if (!SN.allSelected(S)) throw new Error('beginReveal: 还有玩家没选牌');
    const q = S.players.map(function (p) { return { seat: p.seat, card: p.selected }; });
    q.sort(function (a, b) { return a.card - b.card || a.seat - b.seat; });
    S.revealQueue = q;
    S.revealIndex = 0;
    S.phase = 'revealing';
    S.rev += 1;
    return q.map(function (e) { return { seat: e.seat, card: e.card }; });
  };

  /* ================= 结算 ================= */

  SN.resolveNext = function (S) {
    if (S.phase === 'chooseRow') throw new Error('resolveNext: 需要先 chooseRow');
    if (S.phase !== 'revealing') throw new Error('resolveNext: phase=' + S.phase);
    if (S.revealIndex >= S.revealQueue.length) {
      S.phase = 'trickEnd';
      S.rev += 1;
      return { type: 'trickEnd', trick: S.trick };
    }

    const entry = S.revealQueue[S.revealIndex];
    const seat = entry.seat, card = entry.card;

    let best = -1, bestLast = -Infinity;
    for (let i = 0; i < S.rows.length; i++) {
      const cs = S.rows[i].cards;
      const last = cs[cs.length - 1];
      if (last < card && last > bestLast) { bestLast = last; best = i; }
    }

    if (best < 0) {
      /* 比所有行尾都小：由出牌者自己选行，暂停结算（不动 revealIndex） */
      const options = [];
      for (let i = 0; i < S.rows.length; i++) options.push(i);
      S.phase = 'chooseRow';
      S.pendingChoice = { seat: seat, card: card, options: options.slice() };
      S.rev += 1;
      S.lastEvent = pushLog(S, 'choice', { seat: seat, card: card, options: options.slice() });
      return { type: 'choice', seat: seat, card: card, options: options.slice(), queueDone: false };
    }

    const row = S.rows[best];
    if (row.cards.length >= 5) return applyTake(S, seat, card, best, false);
    return applyPlace(S, seat, card, best);
  };

  SN.chooseRow = function (S, seat, rowIndex) {
    if (S.phase !== 'chooseRow') throw new Error('chooseRow: phase=' + S.phase);
    if (!S.pendingChoice) throw new Error('chooseRow: 没有待选行');
    if (S.pendingChoice.seat !== seat) throw new Error('chooseRow: 不是座位 ' + seat + ' 的选行');
    if (!(typeof rowIndex === 'number' && rowIndex === (rowIndex | 0) && rowIndex >= 0 && rowIndex < S.rows.length)) {
      throw new Error('chooseRow: 非法行号 ' + rowIndex);
    }
    return applyTake(S, seat, S.pendingChoice.card, rowIndex, true);
  };

  SN.startNextTrick = function (S) {
    if (S.phase !== 'trickEnd') throw new Error('startNextTrick: phase=' + S.phase);
    if (S.trick >= SN.TRICKS) {
      S.phase = 'gameEnd';
      S.rev += 1;
      S.lastEvent = pushLog(S, 'gameEnd', {});
      return { type: 'gameEnd' };
    }
    S.trick += 1;
    for (const p of S.players) p.selected = null;
    S.phase = 'selecting';
    S.rev += 1;
    return { type: 'trickStart', trick: S.trick };
  };

  SN.isGameOver = function (S) { return S.phase === 'gameEnd'; };

  /* ================= AI 安全视图（不含他人手牌 / 已选牌面 / unused） ================= */

  SN.viewFor = function (S, seat) {
    const me = (typeof seat === 'number' && seat >= 0 && seat < S.players.length) ? S.players[seat] : null;
    const pc = S.pendingChoice;
    return {
      me: seat,
      trick: S.trick,
      phase: S.phase,
      difficulty: S.settings ? S.settings.difficulty : 'normal',
      hand: me ? me.hand.slice() : [],
      rows: S.rows.map(function (r) { return r.cards.slice(); }),
      players: S.players.map(function (p) {
        return {
          seat: p.seat, name: p.name, ai: !!p.ai, score: p.score,
          handCount: p.hand.length,
          selectedFlag: p.selected !== null && p.selected !== undefined,
          takenCount: p.taken.length, rowsTaken: p.rowsTaken
        };
      }),
      taken: S.players.map(function (p) { return p.taken.slice(); }),
      pendingChoice: (pc && pc.seat === seat)
        ? { seat: pc.seat, card: pc.card, options: pc.options.slice() }
        : null
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SN;
  if (root) root.SixNimmt = SN;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));