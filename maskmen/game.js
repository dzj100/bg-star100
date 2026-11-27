'use strict';
/* 《面具摔跤手》Maskmen —— 纯规则引擎
   不碰 DOM、不用 Math.random；洗牌与 AI 抖动一律走注入的 seeded rng。
   牌只分 6 色（每色 10 张，同色完全等价），手牌用 6 个计数表示。
   → window.Maskmen + module.exports */
(function (root) {
  const M = {};

  /* ================= 常量 ================= */

  M.VERSION = 1;
  M.COLORS = 6;
  M.CARDS_PER_COLOR = 10;
  M.MAX_PLAY = 3;              // 单次出牌最多 3 张
  M.SEASONS = 4;               // 3~6 人局固定 4 赛季
  M.WINS_TO_TAKE = 3;          // 2 人局先赢 3 赛季
  M.MIN_PLAYERS = 2;
  M.MAX_PLAYERS = 6;
  M.HAND_SIZE = { 2: 15, 3: 15, 4: 15, 5: 12, 6: 10 };
  M.LOG_CAP = 240;

  M.COLOR_NAMES = ['赤焰', '蓝电', '毒藤', '金光', '幻紫', '灰岩'];
  M.COLOR_SYMBOLS = ['◆', '●', '▲', '★', '■', '✚'];
  M.COLOR_KEYS = ['red', 'blue', 'green', 'orange', 'purple', 'gray'];
  M.AI_NAMES = ['铁面狼', '黑旋风', '银钩骑士', '夜枭', '金钱豹'];

  /* ================= 随机 ================= */

  function next32(a) {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  M.seeded = function (seed) {
    let a = seed >>> 0;
    const f = function () {
      a = next32(a);
      return a / 4294967296;
    };
    f.state = function () { return a; };
    f.set = function (v) { a = v >>> 0; };
    return f;
  };

  /* 引擎随机流：状态存在 state.rngState，可随存档恢复 */
  M.random = function (st) {
    st.rngState = next32(st.rngState >>> 0);
    return st.rngState / 4294967296;
  };

  M.shuffle = function (arr, rand) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  };

  /* ================= 小工具 ================= */

  function zeros(n) { return new Array(n).fill(0); }

  function newRelation() {
    const r = [];
    for (let i = 0; i < M.COLORS; i++) r.push(new Array(M.COLORS).fill(false));
    return r;
  }

  M.handCount = function (p) {
    let s = 0;
    for (let i = 0; i < M.COLORS; i++) s += p.hand[i];
    return s;
  };

  M.compare = function (st, a, b) {
    if (a === b) return 0;
    if (st.relation[a][b]) return 1;
    if (st.relation[b][a]) return -1;
    return 0;
  };

  M.colorLabel = function (c) {
    return M.COLOR_NAMES[c] + M.COLOR_SYMBOLS[c];
  };

  function tag(st) {
    return 'S' + st.season + 'R' + st.round;
  }

  function log(st, text) {
    st.log.push(text);
    if (st.log.length > M.LOG_CAP) st.log.splice(0, st.log.length - M.LOG_CAP);
  }

  function activeCount(st) {
    let n = 0;
    for (const p of st.players) {
      if (M.handCount(p) > 0 && !p.passed && !p.out) n++;
    }
    return n;
  }

  function nextActive(st, from) {
    for (let i = 1; i <= st.playerCount; i++) {
      const idx = (from + i) % st.playerCount;
      const q = st.players[idx];
      if (M.handCount(q) > 0 && !q.passed && !q.out) return idx;
    }
    return from;
  }

  /* ================= 力量关系 / 标志列 ================= */

  function hasMarker(st, c) {
    for (const col of st.columns) {
      for (const e of col) if (e.c === c) return true;
    }
    return false;
  }

  function ensureColumn(st, c) {
    if (hasMarker(st, c)) return false;
    st.markerUse[c] += 1;
    st.columns.push([{ c: c }]);
    return true;
  }

  /* 新增关系 strong > weak，并维护传递闭包（加一条边不会成环，合法性已挡） */
  function addRelation(st, strong, weak) {
    st.relation[strong][weak] = true;
    const preds = [];
    const succs = [];
    for (let a = 0; a < M.COLORS; a++) {
      if (a === strong || st.relation[a][strong]) preds.push(a);
    }
    for (let b = 0; b < M.COLORS; b++) {
      if (b === weak || st.relation[weak][b]) succs.push(b);
    }
    for (const a of preds) {
      for (const b of succs) st.relation[a][b] = true;
    }
  }

  /* 把 strong 补进所有包含 weak、且 strong 能与上方颜色共存的列。
     返回是否至少有一列已经能表示这条关系。 */
  function addToColumns(st, strong, weak) {
    let represented = false;

    for (const col of st.columns) {
      const y = col.findIndex(function (e) { return e.c === weak; });
      if (y < 0) continue;
      if (col.some(function (e) { return e.c === strong; })) {
        represented = true;
        continue;
      }

      let comparable = true;
      for (let j = 0; j < y; j++) {
        const z = col[j].c;
        if (!st.relation[strong][z] && !st.relation[z][strong]) {
          comparable = false;
          break;
        }
      }
      if (!comparable) continue;

      let idx = y;
      for (let j = 0; j < y; j++) {
        if (st.relation[strong][col[j].c]) { idx = j; break; }
      }
      st.markerUse[strong] += 1;
      col.splice(idx, 0, { c: strong });
      represented = true;
    }

    return represented;
  }

  /* 把 strong 的标志放到 weak 上方；同一关系会补进所有可插入的列。
     返回是否新建了列。电子版不限制每色标志数，全部为实心标志。 */
  function placeMarker(st, strong, weak) {
    if (addToColumns(st, strong, weak)) return false;

    st.markerUse[strong] += 1;
    st.markerUse[weak] += 1;
    st.columns.push([{ c: strong }, { c: weak }]);
    return true;
  }

  /* 旧存档读档时，把最近一次新关系补进所有可插入的列（幂等）。 */
  M.repairLastRelation = function (st) {
    const a = st.lastAction;
    if (!a || a.type !== 'play' || !a.relationAdded || a.relationTo == null) return false;
    if (!st.relation[a.color] || !st.relation[a.color][a.relationTo]) return false;
    return addToColumns(st, a.color, a.relationTo);
  };

  /* ================= 建局 / 赛季 ================= */

  M.createGame = function (opts) {
    opts = opts || {};
    const playerCount = Math.max(M.MIN_PLAYERS, Math.min(M.MAX_PLAYERS, opts.playerCount | 0));
    const seed = (opts.seed >>> 0) || ((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
    const humanName = String(opts.humanName || '你').slice(0, 8) || '你';

    const players = [{
      id: 0,
      name: humanName,
      isAI: false,
      difficulty: 'normal',
      hand: zeros(M.COLORS),
      score: 0,
      belts: { gold: 0, silver: 0, black: 0 },
      finishRank: 0,
      rank: 0,
      passed: false,
      out: false,
    }];
    for (let i = 1; i < playerCount; i++) {
      players.push({
        id: i,
        name: M.AI_NAMES[(i - 1) % M.AI_NAMES.length],
        isAI: true,
        difficulty: 'normal',
        hand: zeros(M.COLORS),
        score: 0,
        belts: { gold: 0, silver: 0, black: 0 },
        finishRank: 0,
        rank: 0,
        passed: false,
        out: false,
      });
    }

    const st = {
      version: M.VERSION,
      rev: 0,
      seed: seed,
      rngState: seed >>> 0,
      playerCount: playerCount,
      handSize: M.HAND_SIZE[playerCount],
      players: players,
      season: 0,
      seasonWins: zeros(playerCount),
      round: 0,
      leader: 0,
      turn: 0,
      prevPlay: null,
      trickPlays: [],
      discards: zeros(M.COLORS),
      relation: newRelation(),
      columns: [],
      markerUse: zeros(M.COLORS),
      unseenCount: 0,
      phase: 'playing',
      log: [],
      lastAction: null,
      lastSeasonWinner: null,
      nextLeader: null,
      roundSummary: null,
      seasonSummary: null,
      result: null,
      gameOver: false,
      humanSeat: 0,
    };

    const firstLeader = Math.floor(M.random(st) * playerCount);
    M.newSeason(st, firstLeader);
    return st;
  };

  M.newSeason = function (st, leader) {
    st.season += 1;
    st.round = 1;
    st.prevPlay = null;
    st.trickPlays = [];
    st.discards = zeros(M.COLORS);
    st.relation = newRelation();
    st.columns = [];
    st.markerUse = zeros(M.COLORS);
    st.gameOver = false;
    st.result = null;
    st.seasonSummary = null;
    st.roundSummary = null;
    st.phase = 'playing';

    const deck = [];
    for (let c = 0; c < M.COLORS; c++) {
      for (let i = 0; i < M.CARDS_PER_COLOR; i++) deck.push(c);
    }
    const pile = M.shuffle(deck, function () { return M.random(st); });

    for (const p of st.players) {
      p.hand = zeros(M.COLORS);
      p.passed = false;
      p.out = false;
      p.finishRank = 0;
      p.rank = 0;
      for (let i = 0; i < st.handSize; i++) p.hand[pile.pop()] += 1;
    }
    st.unseenCount = pile.length;

    let idx = leader;
    if (idx == null || idx < 0 || idx >= st.playerCount) {
      idx = Math.floor(M.random(st) * st.playerCount);
    }
    st.leader = idx;
    st.turn = idx;
    st.nextLeader = null;

    log(st, '第 ' + st.season + ' 赛季开始 · 每人 ' + st.handSize +
      ' 张 · 本季扣置 ' + st.unseenCount + ' 张 · 主持人：' + st.players[idx].name);
    st.lastAction = { type: 'seasonStart', season: st.season, leader: idx };
    st.rev += 1;
  };

  /* ================= 合法出牌 ================= */

  M.legalMoves = function (st) {
    if (st.phase !== 'playing') return { leader: false, moves: [], canPass: false };
    const p = st.players[st.turn];
    if (!p || p.out || p.passed) return { leader: false, moves: [], canPass: false };

    if (!st.prevPlay) {
      const moves = [];
      for (let c = 0; c < M.COLORS; c++) {
        if (p.hand[c] > 0) moves.push({ color: c, count: 1 });
      }
      return { leader: true, moves: moves, canPass: false };
    }

    const prev = st.prevPlay;
    const moves = [];
    for (let c = 0; c < M.COLORS; c++) {
      if (c === prev.color || p.hand[c] === 0) continue;
      const rel = st.relation[c][prev.color] ? 1 : st.relation[prev.color][c] ? -1 : 0;
      if (rel === -1) continue;
      const need = rel === 1 ? prev.count : prev.count + 1;
      if (need > M.MAX_PLAY || p.hand[c] < need) continue;
      moves.push({ color: c, count: need });
    }
    return { leader: false, moves: moves, canPass: true };
  };

  /* ================= 行动 ================= */

  M.play = function (st, color) {
    if (st.phase !== 'playing') return { ok: false, error: '当前不能出牌' };
    const lm = M.legalMoves(st);
    let mv = null;
    for (const m of lm.moves) if (m.color === color) { mv = m; break; }
    if (!mv) return { ok: false, error: '这个颜色不能出' };

    const seat = st.turn;
    const p = st.players[seat];
    const count = mv.count;
    const prev = st.prevPlay;
    const isLeader = lm.leader;

    p.hand[color] -= count;
    st.discards[color] += count;

    let relationAdded = false;
    let relationTo = null;
    let newColumn = false;

    if (isLeader) {
      if (!hasMarker(st, color)) {
        ensureColumn(st, color);
        newColumn = true;
      }
    } else {
      const rel = st.relation[color][prev.color] ? 1 : st.relation[prev.color][color] ? -1 : 0;
      if (rel === 0) {
        addRelation(st, color, prev.color);
        relationAdded = true;
        relationTo = prev.color;
        newColumn = placeMarker(st, color, prev.color);
      }
    }

    st.trickPlays.push({ player: seat, color: color, count: count });
    st.prevPlay = { player: seat, color: color, count: count };

    let text = tag(st) + ' ' + p.name + ' 出 ' + M.colorLabel(color) + '×' + count;
    if (isLeader) text += '（首家）';
    else if (relationAdded) text += '（未定：' + M.colorLabel(color) + ' > ' + M.colorLabel(relationTo) + '）';
    else text += '（已知强于 ' + M.colorLabel(prev.color) + '，同 ' + count + ' 张）';
    log(st, text);

    let finishedRank = 0;
    if (M.handCount(p) === 0) {
      p.out = true;
      p.passed = true;
      let done = 0;
      for (const q of st.players) if (q.finishRank > 0) done++;
      p.finishRank = done + 1;
      finishedRank = p.finishRank;
      log(st, p.name + ' 打空手牌，第 ' + finishedRank + ' 名完成！');
    }

    const action = {
      type: 'play',
      player: seat,
      color: color,
      count: count,
      relationAdded: relationAdded,
      relationTo: relationTo,
      newColumn: newColumn,
      isLeader: isLeader,
      finishedRank: finishedRank,
    };

    let withCards = 0;
    for (const q of st.players) if (M.handCount(q) > 0) withCards++;

    if (withCards <= 1) {
      endSeason(st, action);
    } else if (activeCount(st) <= 1) {
      endRound(st, action);
    } else {
      st.turn = nextActive(st, seat);
      st.lastAction = action;
    }

    st.rev += 1;
    return { ok: true, action: st.lastAction, legal: M.legalMoves(st) };
  };

  M.pass = function (st) {
    if (st.phase !== 'playing') return { ok: false, error: '当前不能跳过' };
    const lm = M.legalMoves(st);
    if (!lm.canPass) return { ok: false, error: '主持人必须出牌' };
    const seat = st.turn;
    const p = st.players[seat];
    if (p.passed) return { ok: false, error: '本回合已经跳过' };

    p.passed = true;
    log(st, tag(st) + ' ' + p.name + ' 跳过');

    const action = { type: 'pass', player: seat };
    if (activeCount(st) <= 1) {
      endRound(st, action);
    } else {
      st.turn = nextActive(st, seat);
      st.lastAction = action;
    }

    st.rev += 1;
    return { ok: true, action: st.lastAction, legal: M.legalMoves(st) };
  };

  /* ================= 回合 / 赛季 / 终局 ================= */

  function endRound(st, action) {
    const lastSeat = st.prevPlay ? st.prevPlay.player : st.leader;
    let nextLeader = lastSeat;
    if (M.handCount(st.players[lastSeat]) === 0) {
      for (let i = 1; i <= st.playerCount; i++) {
        const idx = (lastSeat + i) % st.playerCount;
        if (M.handCount(st.players[idx]) > 0) { nextLeader = idx; break; }
      }
    }
    st.phase = 'roundEnd';
    st.roundSummary = {
      lastPlayer: lastSeat,
      nextLeader: nextLeader,
      lastPlay: st.prevPlay ? { player: st.prevPlay.player, color: st.prevPlay.color, count: st.prevPlay.count } : null,
    };
    action.roundEnded = true;
    action.lastPlayer = lastSeat;
    action.nextLeader = nextLeader;
    st.lastAction = action;
    log(st, '—— 第 ' + st.round + ' 回合结束 · 最后出牌：' + st.players[lastSeat].name +
      ' · 下回合主持人：' + st.players[nextLeader].name);
  }

  function endSeason(st, action) {
    const finished = st.players.filter(function (p) { return p.finishRank > 0; })
      .sort(function (a, b) { return a.finishRank - b.finishRank; });
    const remaining = st.players.filter(function (p) { return M.handCount(p) > 0; })
      .sort(function (a, b) { return M.handCount(a) - M.handCount(b); });

    const order = finished.concat(remaining);
    const n = order.length;
    order.forEach(function (p, i) { p.rank = i + 1; });

    const deltas = zeros(n);
    const first = order[0];
    const second = n >= 3 ? order[1] : null;
    const last = order[n - 1];

    first.score += 2;
    first.belts.gold += 1;
    deltas[0] += 2;

    if (second) {
      second.score += 1;
      second.belts.silver += 1;
      deltas[1] += 1;
    }
    if (last && last !== first) {
      last.score -= 1;
      last.belts.black += 1;
      deltas[n - 1] -= 1;
    }

    st.seasonWins[first.id] += 1;
    st.lastSeasonWinner = first.id;
    st.nextLeader = last.id;

    const ranking = order.map(function (p, i) {
      return {
        seat: p.id,
        name: p.name,
        rank: i + 1,
        delta: deltas[i],
        handLeft: M.handCount(p),
        score: p.score,
        gold: p.belts.gold,
        silver: p.belts.silver,
        black: p.belts.black,
        seasonWins: st.seasonWins[p.id],
      };
    });

    const gameOver = st.playerCount === 2
      ? st.seasonWins[first.id] >= M.WINS_TO_TAKE
      : st.season >= M.SEASONS;

    st.gameOver = gameOver;
    st.seasonSummary = {
      season: st.season,
      ranking: ranking,
      winner: first.id,
      lastPlace: last.id,
      gameOver: gameOver,
      seasonWins: st.seasonWins.slice(),
    };
    st.phase = 'seasonEnd';

    let line = '=== 第 ' + st.season + ' 赛季结束 · 冠军 ' + first.name + ' +2';
    if (second) line += ' · 亚军 ' + second.name + ' +1';
    line += ' · 末位 ' + last.name + ' −1';
    log(st, line);

    action.seasonEnded = true;
    action.seasonSummary = st.seasonSummary;
    st.lastAction = action;
    st.rev += 1;
  }

  M.nextRound = function (st) {
    if (st.phase !== 'roundEnd') return { ok: false, error: '当前不在回合结算' };
    const next = st.roundSummary.nextLeader;
    st.round += 1;
    for (const p of st.players) p.passed = false;
    st.trickPlays = [];
    st.prevPlay = null;
    st.leader = next;
    st.turn = next;
    st.phase = 'playing';
    st.roundSummary = null;
    st.lastAction = { type: 'roundStart', round: st.round, leader: next };
    st.rev += 1;
    return { ok: true };
  };

  M.nextSeason = function (st) {
    if (st.phase !== 'seasonEnd' || st.gameOver) return { ok: false, error: '当前不能进入下一赛季' };
    M.newSeason(st, st.nextLeader);
    return { ok: true };
  };

  M.finishGame = function (st) {
    if (st.phase !== 'seasonEnd' || !st.gameOver) return { ok: false, error: '对局尚未结束' };

    const rows = st.players.map(function (p) {
      return {
        seat: p.id,
        name: p.name,
        isAI: p.isAI,
        score: p.score,
        gold: p.belts.gold,
        silver: p.belts.silver,
        black: p.belts.black,
        wins: st.seasonWins[p.id],
        finishRank: p.finishRank,
        handLeft: M.handCount(p),
      };
    });

    let winnerIds = [];
    if (st.playerCount === 2) {
      rows.sort(function (a, b) { return b.wins - a.wins || b.score - a.score; });
      winnerIds = rows.filter(function (r) { return r.wins === rows[0].wins && r.wins >= M.WINS_TO_TAKE; })
        .map(function (r) { return r.seat; });
      if (!winnerIds.length) winnerIds = [rows[0].seat];
    } else {
      rows.sort(function (a, b) { return b.score - a.score || b.gold - a.gold || b.wins - a.wins; });
      const top = rows[0];
      const tied = rows.filter(function (r) { return r.score === top.score && r.gold === top.gold; });
      if (tied.length > 1) {
        const lastWin = tied.filter(function (r) { return r.seat === st.lastSeasonWinner; });
        winnerIds = lastWin.length === 1 ? [lastWin[0].seat] : tied.map(function (r) { return r.seat; });
      } else {
        winnerIds = [top.seat];
      }
    }

    const winners = rows.filter(function (r) { return winnerIds.indexOf(r.seat) >= 0; });
    const rest = rows.filter(function (r) { return winnerIds.indexOf(r.seat) < 0; });
    const ordered = winners.concat(rest);
    ordered.forEach(function (r, i) { r.rank = i + 1; });

    st.result = { rows: ordered, winnerIds: winnerIds, playerCount: st.playerCount };
    st.phase = 'gameEnd';
    st.lastAction = { type: 'gameEnd', result: st.result };
    st.rev += 1;
    return { ok: true, result: st.result };
  };

  /* ================= 安全视图 / 序列化 ================= */

  M.viewFor = function (st, seat) {
    const p = st.players[seat];
    const hand = p.hand.slice();
    const players = st.players.map(function (q, i) {
      return {
        seat: i,
        name: q.name,
        isAI: q.isAI,
        handCount: M.handCount(q),
        passed: q.passed,
        out: q.out,
        finishRank: q.finishRank,
        rank: q.rank,
        score: q.score,
        belts: { gold: q.belts.gold, silver: q.belts.silver, black: q.belts.black },
      };
    });

    const legal = (st.turn === seat && st.phase === 'playing')
      ? M.legalMoves(st)
      : { leader: false, moves: [], canPass: false };

    return {
      seat: seat,
      playerCount: st.playerCount,
      handSize: st.handSize,
      hand: hand,
      handTotal: M.handCount(p),
      players: players,
      relation: st.relation.map(function (r) { return r.slice(); }),
      columns: st.columns.map(function (col) {
        return col.map(function (e) { return { c: e.c }; });
      }),
      markerUse: st.markerUse.slice(),
      discards: st.discards.slice(),
      unseen: hand.map(function (n, c) {
        return Math.max(0, M.CARDS_PER_COLOR - n - st.discards[c]);
      }),
      prevPlay: st.prevPlay
        ? { player: st.prevPlay.player, color: st.prevPlay.color, count: st.prevPlay.count }
        : null,
      trickPlays: st.trickPlays.map(function (x) {
        return { player: x.player, color: x.color, count: x.count };
      }),
      leader: st.leader,
      turn: st.turn,
      round: st.round,
      season: st.season,
      seasonWins: st.seasonWins.slice(),
      legal: legal,
      phase: st.phase,
    };
  };

  M.aiSeed = function (st) {
    let h = (st.seed || 1) >>> 0;
    h = (h ^ Math.imul(st.season | 0, 0x9E3779B1)) >>> 0;
    h = (h ^ Math.imul(st.round | 0, 0x85EBCA6B)) >>> 0;
    h = (h ^ Math.imul((st.turn | 0) + 1, 0xC2B2AE35)) >>> 0;
    h = (h ^ Math.imul(st.trickPlays.length | 0, 0x27D4EB2F)) >>> 0;
    let disc = 0;
    for (let i = 0; i < st.discards.length; i++) disc += st.discards[i];
    h = (h ^ Math.imul(disc | 0, 0x165667B1)) >>> 0;
    h = (h ^ Math.imul(st.rev | 0, 0x7FEB352D)) >>> 0;
    return h >>> 0;
  };

  M.clone = function (st) { return JSON.parse(JSON.stringify(st)); };

  M.serialize = function (st) { return JSON.stringify(st); };

  M.deserialize = function (json) {
    try {
      const st = JSON.parse(json);
      if (!st || st.version !== M.VERSION) return null;
      if (!st.players || st.players.length < M.MIN_PLAYERS) return null;
      M.repairLastRelation(st);
      return st;
    } catch (e) {
      return null;
    }
  };

  root.Maskmen = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);