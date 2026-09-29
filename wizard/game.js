'use strict';
/* 《巫师牌》Wizard —— 纯规则引擎 + 版面几何
   不碰 DOM、不用 Math.random；随机一律经注入的 rng（WZ.seeded）。
   牌一律存 id 数组：0..51 彩色（c = id/13|0，r = id%13+1）、52..55 巫师、56..59 小丑。
   → window.WZ + module.exports */
(function (root) {
  const G = {};

  /* ================= 常量 ================= */

  G.DECK = 60;
  G.WIZARD0 = 52;   /* 52..55 */
  G.JESTER0 = 56;   /* 56..59 */
  G.COLORS = ['red', 'yellow', 'blue', 'green'];
  G.CN = ['红', '黄', '蓝', '绿'];
  G.GLYPH = ['◆', '★', '▲', '■'];

  /* 版面几何（世界单位 360×640，见 SPEC §5.2） */
  G.CENTER = { x: 180, y: 296 };
  G.RX = 138;
  G.RY = 148;
  G.SLOT_K = 0.42;          /* trick 槽位 = 环心 + 0.42 × 半径 */

  /* ================= 牌 ================= */

  G.isWizard = function (id) { return id >= G.WIZARD0 && id < G.JESTER0; };
  G.isJester = function (id) { return id >= G.JESTER0 && id < G.DECK; };
  G.isColor = function (id) { return id >= 0 && id < G.WIZARD0; };

  G.card = function (id) {
    if (G.isWizard(id)) return { id: id, kind: 'wizard' };
    if (G.isJester(id)) return { id: id, kind: 'jester' };
    return { id: id, kind: 'color', color: (id / 13) | 0, rank: id % 13 + 1 };
  };

  G.label = function (id) {
    if (G.isWizard(id)) return '巫师';
    if (G.isJester(id)) return '小丑';
    const c = G.card(id);
    return G.CN[c.color] + ' ' + c.rank;
  };

  /* 色名 + 形符成对出现（色盲冗余，SPEC §1） */
  G.labelColor = function (color) { return G.CN[color] + ' ' + G.GLYPH[color]; };

  /* 手牌展示序：小丑 → 红/黄/蓝/绿各按 1..13 → 巫师（SPEC §5.3） */
  G.sortHand = function (ids) {
    return ids.slice().sort(function (a, b) {
      const ka = G.isColor(a) ? 1 : (G.isJester(a) ? 0 : 2);
      const kb = G.isColor(b) ? 1 : (G.isJester(b) ? 0 : 2);
      if (ka !== kb) return ka - kb;
      return a - b;
    });
  };

  /* ================= 轮次 ================= */

  G.roundsFor = function (N) { return Math.floor(G.DECK / N); };

  /* ================= 开局 ================= */

  G.newGame = function (o) {
    o = o || {};
    const N = Math.max(3, Math.min(6, o.N || 3));
    const players = [];
    for (let i = 0; i < N; i++) {
      const name = i === 0
        ? (o.humanName || '你')
        : ((o.aiNames && o.aiNames[i - 1]) || ('玩家 ' + (i + 1)));
      const avatar = i === 0
        ? (o.humanAvatar !== undefined ? o.humanAvatar : (o.avatars && o.avatars[0]) || i)
        : ((o.aiAvatars && o.aiAvatars[i - 1]) !== undefined ? o.aiAvatars[i - 1]
          : (o.avatars && o.avatars[i] !== undefined ? o.avatars[i] : i));
      players.push({
        pid: i, name: name, ai: i !== 0, avatar: avatar,
        hand: [], bid: null, won: 0, score: 0
      });
    }
    return {
      v: 1, N: N, rounds: G.roundsFor(N), round: 0, k: 0,
      phase: 'deal',                   /* deal | trump | bid | play | trick | rshow | over */
      players: players,
      leader: 0, turn: 0,
      trumps: { mode: 'none', color: null },
      indicator: null, deck: [],
      table: [],                       /* [{ pid, card }]，按出牌顺序 */
      bidQueue: [],
      played: [],                      /* [[id]]，逐墩牌史（公开） */
      hist: []                         /* [{ round, rows, tricks }] */
    };
  };

  /* ================= 每轮开始：重洗 + 发牌 + 翻指示牌 ================= */

  G.startRound = function (S, rng) {
    if (S.phase !== 'deal') throw new Error('startRound: phase=' + S.phase);
    S.round += 1;
    S.k = S.round;

    /* 重洗全部 60 张（轮与轮之间没有残留状态） */
    const deck = [];
    for (let i = 0; i < G.DECK; i++) deck.push(i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }

    S.played = [];
    S.table = [];
    S.indicator = null;
    for (const p of S.players) { p.hand = []; p.bid = null; p.won = 0; }

    /* 发牌（从谁起无所谓，均匀轮转即可）；发牌在前、翻牌在后 */
    for (let i = 0; i < S.k; i++) {
      for (const p of S.players) p.hand.push(deck.shift());
    }

    /* 第 1 轮先手：发牌后立即随机（选色要先手先看手牌） */
    if (S.round === 1) S.leader = (rng() * S.N) | 0;

    /* 翻指示牌 */
    let trump;
    if (deck.length > 0) {
      S.indicator = deck.shift();
      if (G.isWizard(S.indicator)) trump = { mode: 'choose', color: null };
      else if (G.isJester(S.indicator)) trump = { mode: 'none', color: null };
      else trump = { mode: 'color', color: G.card(S.indicator).color };
    } else {
      trump = { mode: 'none', color: null };       /* 最后一轮：60 张全部发完 */
    }
    S.trumps = trump;
    S.deck = deck;

    S.bidQueue = [];
    for (let i = 0; i < S.N; i++) S.bidQueue.push((S.leader + i) % S.N);
    S.turn = S.leader;
    S.phase = trump.mode === 'choose' ? 'trump' : 'bid';

    const deal = S.players.map(function (p) { return { pid: p.pid, n: p.hand.length }; });
    return { k: S.k, leader: S.leader, deal: deal, indicator: S.indicator, trump: trump };
  };

  /* 指示牌为巫师：先手指定一色（必须红黄蓝绿） */
  G.chooseTrump = function (S, pid, color) {
    if (S.phase !== 'trump') throw new Error('chooseTrump: phase=' + S.phase);
    if (pid !== S.leader) throw new Error('chooseTrump: 只有先手能选色');
    if (!(color >= 0 && color <= 3 && color === (color | 0))) throw new Error('chooseTrump: 非法颜色 ' + color);
    S.trumps = { mode: 'color', color: color };
    S.phase = 'bid';
    return { pid: pid, color: color, trump: { mode: 'color', color: color } };
  };

  /* ================= 预判 ================= */

  G.placeBid = function (S, pid, n) {
    if (S.phase !== 'bid') throw new Error('placeBid: phase=' + S.phase);
    if (S.bidQueue[0] !== pid) throw new Error('placeBid: 还没轮到 ' + pid);
    if (!(n >= 0 && n <= S.k && n === (n | 0))) throw new Error('placeBid: 越界 ' + n);
    S.players[pid].bid = n;
    S.bidQueue.shift();
    if (S.bidQueue.length === 0) { S.phase = 'play'; S.turn = S.leader; }
    return { pid: pid, n: n };
  };

  G.bidSum = function (S, exceptPid) {
    let s = 0;
    for (const p of S.players) {
      if (p.pid === exceptPid) continue;
      if (p.bid !== null) s += p.bid;
    }
    return s;
  };

  /* ================= 出牌与合法性 ================= */

  G.legalPlays = function (S, pid) {
    if (S.phase !== 'play' || pid !== S.turn) return [];
    const p = S.players[pid];
    if (S.table.length === 0) return p.hand.slice();
    const led = G.card(S.table[0].card);
    if (led.kind !== 'color') return p.hand.slice();     /* 先手巫师/小丑 → 任意出 */
    let has = false;
    for (const id of p.hand) {
      if (G.isColor(id) && G.card(id).color === led.color) { has = true; break; }
    }
    if (!has) return p.hand.slice();
    /* 有跟色必须跟；巫师/小丑永远可出 */
    return p.hand.filter(function (id) {
      return !G.isColor(id) || G.card(id).color === led.color;
    });
  };

  G.isLegal = function (S, pid, id) {
    if (S.phase !== 'play' || pid !== S.turn) return false;
    if (S.players[pid].hand.indexOf(id) < 0) return false;
    return G.legalPlays(S, pid).indexOf(id) >= 0;
  };

  G.playCard = function (S, pid, id) {
    if (S.phase !== 'play') throw new Error('playCard: phase=' + S.phase);
    if (pid !== S.turn) throw new Error('playCard: 不是 ' + pid + ' 的回合');
    if (!G.isLegal(S, pid, id)) throw new Error('playCard: 非法出牌 ' + G.label(id));
    const p = S.players[pid];
    p.hand.splice(p.hand.indexOf(id), 1);
    S.table.push({ pid: pid, card: id });
    if (S.table.length >= S.N) S.phase = 'trick';
    else S.turn = (pid + 1) % S.N;
    return { pid: pid, card: id };
  };

  /* 当前必须跟的颜色（无义务时 null）——UI 的「必须跟 红 ◆」提示条 */
  G.mustFollow = function (S, pid) {
    if (S.phase !== 'play' || pid !== S.turn || S.table.length === 0) return null;
    const led = G.card(S.table[0].card);
    if (led.kind !== 'color') return null;
    const p = S.players[pid];
    for (const id of p.hand) {
      if (G.isColor(id) && G.card(id).color === led.color) return led.color;
    }
    return null;
  };

  /* ================= 得墩判定（SPEC §3.4，严格依序短路） ================= */

  /* cards = id 数组、index 0 = 先手；返回 { idx, kind }。trickWinner 的唯一实现 */
  G.winnerOf = function (cards, trumps) {
    const n = cards.length;
    let i;
    /* 1) 第一个巫师 */
    for (i = 0; i < n; i++) if (G.isWizard(cards[i])) return { idx: i, kind: 'wizard' };
    /* 2) 王牌色数字最大 */
    if (trumps.mode === 'color') {
      let best = -1, bestR = 0;
      for (i = 0; i < n; i++) {
        const c = G.card(cards[i]);
        if (c.kind === 'color' && c.color === trumps.color && c.rank > bestR) { bestR = c.rank; best = i; }
      }
      if (best >= 0) return { idx: best, kind: 'trump' };
    }
    const led = G.card(cards[0]);
    /* 3) 先手彩色 → 先手色最大（先手自己必在集合内） */
    if (led.kind === 'color') {
      let best = 0, bestR = 0;
      for (i = 0; i < n; i++) {
        const c = G.card(cards[i]);
        if (c.kind === 'color' && c.color === led.color && c.rank > bestR) { bestR = c.rank; best = i; }
      }
      return { idx: best, kind: 'led' };
    }
    /* 4) 先手小丑 → 其后第一张彩色牌定跟色；全是小丑 → 第一个（先手）赢 */
    for (i = 0; i < n; i++) {
      if (G.isColor(cards[i])) {
        const suit = G.card(cards[i]).color;
        let best = i, bestR = 0;
        for (let j = 0; j < n; j++) {
          const c = G.card(cards[j]);
          if (c.kind === 'color' && c.color === suit && c.rank > bestR) { bestR = c.rank; best = j; }
        }
        return { idx: best, kind: 'jesterLed' };
      }
    }
    return { idx: 0, kind: 'jesterAll' };
  };

  G.trickWinner = function (S) {
    const cards = S.table.map(function (t) { return t.card; });
    const w = G.winnerOf(cards, S.trumps);
    return { pid: S.table[w.idx].pid, kind: w.kind };
  };

  G.resolveTrick = function (S) {
    if (S.phase !== 'trick') throw new Error('resolveTrick: phase=' + S.phase);
    const plays = S.table.slice();
    const win = G.trickWinner(S);
    S.played.push(plays.map(function (t) { return t.card; }));
    S.players[win.pid].won += 1;
    S.leader = win.pid;
    S.table = [];
    if (S.played.length >= S.k) S.phase = 'rshow';
    else { S.turn = win.pid; S.phase = 'play'; }
    return { plays: plays, winner: win.pid, kind: win.kind };
  };

  /* ================= 本轮结算 ================= */

  G.roundPts = function (bid, won) {
    return bid === won ? 20 + 10 * won : -10 * Math.abs(bid - won);
  };

  G.endRound = function (S) {
    if (S.phase !== 'rshow') throw new Error('endRound: phase=' + S.phase);
    const rows = S.players.map(function (p) {
      const exact = p.bid === p.won;
      return { pid: p.pid, bid: p.bid, won: p.won, pts: G.roundPts(p.bid, p.won), exact: exact };
    });
    for (const r of rows) S.players[r.pid].score += r.pts;
    S.hist.push({
      round: S.round,
      rows: rows,
      tricks: S.played.map(function (t) { return t.slice(); })
    });
    S.phase = S.round >= S.rounds ? 'over' : 'deal';
    return {
      rows: rows,
      totals: S.players.map(function (p) { return { pid: p.pid, score: p.score }; }),
      leaderNext: S.leader
    };
  };

  G.checkEnd = function (S) { return S.phase === 'over'; };

  /* 竞争名次：并列同名次 */
  G.rank = function (S) {
    const arr = S.players.map(function (p) { return { pid: p.pid, total: p.score, place: 1, tied: false }; });
    arr.sort(function (a, b) { return b.total - a.total || a.pid - b.pid; });
    for (let i = 0; i < arr.length; i++) {
      if (i > 0 && arr[i].total !== arr[i - 1].total) arr[i].place = i + 1;
      else if (i > 0) arr[i].place = arr[i - 1].place;
    }
    for (const a of arr) {
      a.tied = arr.some(function (b) { return b.pid !== a.pid && b.total === a.total; });
    }
    return arr;
  };

  /* 计分榜唯一数据源（SPEC §5.6）：行 = 轮次，列 = 座位序 */
  G.scoreTable = function (S) {
    const rounds = [];
    const run = S.players.map(function () { return 0; });
    for (const h of S.hist) {
      const pts = h.rows.map(function (r) { return r.pts; });
      for (let i = 0; i < pts.length; i++) run[i] += pts[i];
      rounds.push({ r: h.round, pts: pts, totals: run.slice(), live: false });
    }
    const lastDone = S.hist.length ? S.hist[S.hist.length - 1].round : 0;
    if (S.phase !== 'over' && S.round > lastDone) {
      rounds.push({ r: S.round, pts: null, totals: run.slice(), live: true });
    }
    return {
      rounds: rounds,
      totals: S.players.map(function (p) { return p.score; }),
      round: S.round
    };
  };

  /* ================= 不变量 ================= */

  G.validate = function (S) {
    const errs = [];
    const cnt = new Array(G.DECK).fill(0);
    const take = function (ids, what) {
      for (const id of ids) {
        if (!(id >= 0 && id < G.DECK && id === (id | 0))) { errs.push(what + ' 出现非法牌 id=' + id); continue; }
        cnt[id] += 1;
      }
    };
    for (const p of S.players) take(p.hand, '手牌');
    take(S.table.map(function (t) { return t.card; }), '桌面');
    take(S.deck, '牌堆');
    if (S.indicator !== null && S.indicator !== undefined) take([S.indicator], '指示牌');
    for (const t of S.played) take(t, '牌史');
    let total = 0, dup = 0;
    for (let id = 0; id < G.DECK; id++) {
      total += cnt[id];
      if (cnt[id] > 1) dup += 1;
    }
    if (dup) errs.push('有 ' + dup + ' 张牌重复出现');
    if (total !== G.DECK) errs.push('牌数合计 ' + total + '，应为 60');

    let wins = 0;
    for (const p of S.players) {
      wins += p.won;
      if (p.won > S.k) errs.push('玩家 ' + p.pid + ' 赢墩 ' + p.won + ' 超过 k=' + S.k);
      if (p.bid !== null && !(p.bid >= 0 && p.bid <= S.k)) errs.push('玩家 ' + p.pid + ' 预判越界 ' + p.bid);
    }
    if (wins !== S.played.length) errs.push('赢墩合计 ' + wins + ' ≠ 完成墩数 ' + S.played.length);
    if (S.played.length > S.k) errs.push('完成墩数 ' + S.played.length + ' 超过 k=' + S.k);
    if (S.table.length > S.N) errs.push('桌面牌数 ' + S.table.length + ' 超过 N=' + S.N);

    if (S.phase === 'bid') {
      for (const p of S.players) {
        const queued = S.bidQueue.indexOf(p.pid) >= 0;
        if (queued && p.bid !== null) errs.push('待宣布的 ' + p.pid + ' 已有预判');
        if (!queued && p.bid === null) errs.push('已宣布的 ' + p.pid + ' 预判为空');
      }
    }
    if (S.phase === 'trick' && S.table.length !== S.N) errs.push('trick 阶段桌面应为 N 张');
    return { ok: errs.length === 0, errs: errs };
  };

  /* ================= 版面几何 ================= */

  G.seatPos = function (i, N) {
    const phi = Math.PI / 2 + i * 2 * Math.PI / N;
    return {
      x: Math.round((G.CENTER.x + G.RX * Math.cos(phi)) * 100) / 100,
      y: Math.round((G.CENTER.y + G.RY * Math.sin(phi)) * 100) / 100,
      phi: phi,
      deg: phi * 180 / Math.PI
    };
  };

  /* trick 槽位：环心 + 0.42 × 半径；rot = 参数角 − 90°（纯几何量——
     UI 已改成打出的牌一律正立，不再按它旋转，保留供测试与其它视图用） */
  G.slotPos = function (i, N) {
    const phi = Math.PI / 2 + i * 2 * Math.PI / N;
    return {
      x: Math.round((G.CENTER.x + G.SLOT_K * G.RX * Math.cos(phi)) * 100) / 100,
      y: Math.round((G.CENTER.y + G.SLOT_K * G.RY * Math.sin(phi)) * 100) / 100,
      rot: Math.round((phi * 180 / Math.PI - 90) * 100) / 100
    };
  };

  /* ================= 工具 ================= */

  G.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  G.chunked = function (arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  /* 确定性随机源：mulberry32。state/set 为了存档 —— 只存种子的话，
     读档后随机流会从头再来一遍。 */
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
  if (root) root.WZ = G;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
