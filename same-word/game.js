/* 同词相遇 · 纯游戏逻辑：校验 / 状态迁移 / 判定 / 计分 / 称号 / 合并
 * 无 DOM、无存储、无网络；加载时不执行任何逻辑。 */
(function (root) {
  'use strict';

  var MODES = { DUEL: 'duel', PARTY: 'party' };
  var SEAT_COLORS = ['#2F6B4F', '#2A9D8F', '#E8733A', '#8C5A9E'];
  var TIME_OPTIONS = [0, 15, 30, 60];
  var PARTY_ROUNDS = [10, 15, 20];
  var LIMITS = { WORD: 10, NAME: 12, MIN_PARTY_ROUNDS: 5, MAX_PARTY_ROUNDS: 50 };
  // 房主在真正截止后再等一拍：成员按本机校准的时钟提交，
  // 会因收到开轮状态的网络延迟而晚到，宽限期要覆盖这段延迟
  var GRACE_MS = 3000;

  var RE_STRIP = /[\s\p{P}~\uFF5E\u00B7\u2026]/gu;
  var RE_ALNUM = /[\p{L}\p{N}]/u;
  var RE_SPACE = /\s+/g;

  /* ---------- 基础工具 ---------- */

  function nowMs(v) {
    var n = Number(v);
    return isFinite(n) ? n : Date.now();
  }

  function str(v) {
    return v == null ? '' : String(v);
  }

  function seatNum(v) {
    var n = Number(v);
    return isFinite(n) ? Math.floor(n) : -1;
  }

  function codeLen(s) {
    return Array.from(s).length;
  }

  function wordOf(S, seat) {
    var sub = S && S.subs ? S.subs[seat] : null;
    if (!sub) return '';
    if (sub.round != null && S.round != null && sub.round !== S.round) return '';
    return str(sub.word);
  }

  function lastHistory(S) {
    var h = S && S.history;
    return h && h.length ? h[h.length - 1] : null;
  }

  /* ---------- 词 / 昵称校验 ---------- */

  function normalizeWord(raw) {
    var s = str(raw);
    if (s.normalize) s = s.normalize('NFKC');
    return s.toLowerCase().replace(RE_STRIP, '');
  }

  function charLen(raw) {
    return codeLen(str(raw));
  }

  function validateWord(raw) {
    var s = str(raw).trim();
    if (!s) return { ok: false, error: 'EMPTY' };
    var display = s.replace(RE_SPACE, ' ');
    var word = normalizeWord(display);
    if (!word || !RE_ALNUM.test(word)) return { ok: false, error: 'ONLY_SYMBOL' };
    if (codeLen(word) > LIMITS.WORD) return { ok: false, error: 'TOO_LONG' };
    return { ok: true, word: word, display: display };
  }

  function validateName(raw) {
    var s = str(raw).trim().replace(RE_SPACE, ' ');
    if (!s) return { ok: false, error: 'EMPTY' };
    if (codeLen(s) > LIMITS.NAME) return { ok: false, error: 'TOO_LONG' };
    return { ok: true, name: s };
  }

  /* ---------- 人员 ---------- */

  function minPlayers(mode) {
    return mode === MODES.DUEL ? 2 : 3;
  }

  function isActive(S, seat) {
    if (!S) return false;
    var s = seatNum(seat);
    var n = (S.seatNames || []).length;
    if (s < 0 || s >= n) return false;
    return (S.departed || []).indexOf(s) < 0;
  }

  function activeSeats(S) {
    var out = [];
    var n = S && S.seatNames ? S.seatNames.length : 0;
    for (var i = 0; i < n; i++) if (isActive(S, i)) out.push(i);
    return out;
  }

  function allDone(S) {
    if (!S || S.phase !== 'playing') return false;
    var seats = activeSeats(S);
    if (!seats.length) return false;
    return seats.every(function (s) {
      var sub = S.subs && S.subs[s];
      return !!(sub && sub.done && (sub.round == null || sub.round === S.round));
    });
  }

  function allReady(S) {
    if (!S || S.phase !== 'reveal' || S.mode !== MODES.PARTY) return false;
    var seats = activeSeats(S);
    if (!seats.length) return false;
    return seats.every(function (s) {
      var r = S.ready && S.ready[s];
      return !!(r && r.on);
    });
  }

  function allRematch(S) {
    if (!S) return false;
    var seats = activeSeats(S);
    if (!seats.length) return false;
    return seats.every(function (s) {
      var r = S.rematch && S.rematch[s];
      return !!(r && r.on);
    });
  }

  /* ---------- 生命周期 ---------- */

  function clampRoundLimit(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return PARTY_ROUNDS[0];
    n = Math.floor(n);
    return Math.min(Math.max(n, LIMITS.MIN_PARTY_ROUNDS), LIMITS.MAX_PARTY_ROUNDS);
  }

  function deadlineFor(S, now) {
    var limit = Number(S.settings && S.settings.timeLimit) || 0;
    return limit > 0 ? now + limit * 1000 : null;
  }

  function createState(opts) {
    opts = opts || {};
    var mode = opts.mode === MODES.PARTY ? MODES.PARTY : MODES.DUEL;
    var now = nowMs(opts.now);
    var st = opts.settings || {};
    var timeLimit = TIME_OPTIONS.indexOf(Number(st.timeLimit)) >= 0 ? Number(st.timeLimit) : 0;
    var seatNames = (opts.seatNames || []).map(function (n) { return str(n); });
    return {
      schema: 1,
      mode: mode,
      settings: { timeLimit: timeLimit, roundLimit: clampRoundLimit(st.roundLimit) },
      seatNames: seatNames,
      phase: 'playing',
      gameNo: 1,
      round: 1,
      subs: {},
      deadline: timeLimit > 0 ? now + timeLimit * 1000 : null,
      hostNow: now,
      history: [],
      decisions: {},
      claims: {},
      ready: {},
      rematch: {},
      result: null,
      resultBy: null,
      departed: [],
      rev: 1,
      _ts: now,
      _pushId: '0-' + now + '-1'
    };
  }

  function startRound(S, now) {
    if (!S) return S;
    var t = nowMs(now);
    S.round = (S.round || 0) + 1;
    S.phase = 'playing';
    S.subs = {};
    S.decisions = {};
    S.claims = {};
    S.ready = {};
    S.result = null;
    S.resultBy = null;
    S.hostNow = t;
    S.deadline = deadlineFor(S, t);
    return S;
  }

  function restartGame(S, now) {
    if (!S) return S;
    var t = nowMs(now);
    S.gameNo = (S.gameNo || 0) + 1;
    S.round = 1;
    S.phase = 'playing';
    S.subs = {};
    S.decisions = {};
    S.claims = {};
    S.ready = {};
    S.rematch = {};
    S.history = [];
    S.result = null;
    S.resultBy = null;
    S.departed = S.departed || [];
    S.hostNow = t;
    S.deadline = deadlineFor(S, t);
    return S;
  }

  function finish(S, result, by, now) {
    if (!S || S.phase === 'finished') return false;
    S.phase = 'finished';
    S.result = result || 'giveup';
    S.resultBy = by == null ? null : seatNum(by);
    S.deadline = null;
    S.hostNow = nowMs(now);
    return true;
  }

  /* ---------- 提交 ---------- */

  function submit(S, seat, rawWord, at) {
    if (!S) return { ok: false, error: 'NO_STATE' };
    if (S.phase !== 'playing') return { ok: false, error: 'NOT_PLAYING' };
    var s = seatNum(seat);
    if (!isActive(S, s)) return { ok: false, error: 'INACTIVE' };
    var v = validateWord(rawWord);
    if (!v.ok) return v;
    S.subs = S.subs || {};
    S.subs[s] = { word: v.display, at: nowMs(at), done: true, round: S.round };
    return { ok: true, word: v.display };
  }

  function submitEmpty(S, seat, at) {
    if (!S || S.phase !== 'playing') return { ok: false, error: 'NOT_PLAYING' };
    var s = seatNum(seat);
    S.subs = S.subs || {};
    S.subs[s] = { word: '', at: nowMs(at), done: true, round: S.round };
    return { ok: true, word: '' };
  }

  /* 撤回重写：写 at 更新的墓碑，避免合并时旧词被找回 */
  function withdraw(S, seat, at) {
    if (!S || S.phase !== 'playing') return { ok: false, error: 'NOT_PLAYING' };
    var s = seatNum(seat);
    if (!isActive(S, s)) return { ok: false, error: 'INACTIVE' };
    S.subs = S.subs || {};
    S.subs[s] = { word: '', at: nowMs(at), done: false, round: S.round };
    return { ok: true };
  }

  function fillMissing(S, at) {
    var filled = [];
    if (!S) return filled;
    var t = nowMs(at);
    activeSeats(S).forEach(function (s) {
      var sub = S.subs && S.subs[s];
      if (sub && sub.done && (sub.round == null || sub.round === S.round)) return;
      S.subs = S.subs || {};
      S.subs[s] = { word: '', at: t, done: true, round: S.round };
      filled.push(s);
    });
    return filled;
  }

  function markDeparted(S, seat, at) {
    if (!S) return false;
    var s = seatNum(seat);
    var n = (S.seatNames || []).length;
    if (s < 0 || s >= n) return false;
    S.departed = S.departed || [];
    if (S.departed.indexOf(s) >= 0) return false;
    S.departed.push(s);
    if (S.phase === 'playing') submitEmpty(S, s, at);
    if (S.decisions) delete S.decisions[s];
    if (S.ready) delete S.ready[s];
    if (S.rematch) delete S.rematch[s];
    if (S.claims) delete S.claims[s];
    return true;
  }

  /* ---------- 判定与计分 ---------- */

  function isDuelAgreed(S) {
    if (!S || S.mode !== MODES.DUEL) return false;
    var seats = activeSeats(S);
    if (seats.length < 2) return false;
    var w0 = wordOf(S, 0), w1 = wordOf(S, 1);
    if (!w0 || !w1) return false;
    return seats.every(function (s) {
      var d = S.decisions && S.decisions[s];
      return !!(d && d.value === 'same');
    });
  }

  /* 双人揭晓必须双方都表过态（same/next），才允许推进 */
  function duelAllDecided(S) {
    if (!S || S.mode !== MODES.DUEL) return false;
    var seats = activeSeats(S);
    if (seats.length < 2) return false;
    return seats.every(function (s) {
      var d = S.decisions && S.decisions[s];
      return !!(d && (d.value === 'same' || d.value === 'next'));
    });
  }

  /* 重算末条历史的 exact + 双向 agree（duel 的 agree 由双方 same 表态决定） */
  function syncPairs(S) {
    var entry = lastHistory(S);
    if (!entry) return null;
    var seats = activeSeats(S);
    var norm = {};
    seats.forEach(function (s) { norm[s] = normalizeWord(wordOf(S, s)); });
    var exact = {};
    var pairs = [];
    for (var i = 0; i < seats.length; i++) {
      for (var j = i + 1; j < seats.length; j++) {
        var a = seats[i], b = seats[j];
        if (norm[a] && norm[a] === norm[b]) {
          pairs.push({ a: a, b: b, kind: 'exact' });
          exact[a + ':' + b] = true;
        }
      }
    }
    if (S.mode === MODES.DUEL) {
      if (isDuelAgreed(S)) pairs.push({ a: 0, b: 1, kind: 'agree' });
    } else {
      var claims = S.claims || {};
      for (var x = 0; x < seats.length; x++) {
        for (var y = x + 1; y < seats.length; y++) {
          var p = seats[x], q = seats[y];
          if (!norm[p] || !norm[q]) continue;
          if (exact[p + ':' + q]) continue;
          var ab = claims[p] && claims[p][q];
          var ba = claims[q] && claims[q][p];
          if (ab && ab.on && ba && ba.on) pairs.push({ a: p, b: q, kind: 'agree' });
        }
      }
    }
    pairs.sort(function (m, n) {
      return m.a - n.a || m.b - n.b || (m.kind < n.kind ? -1 : m.kind > n.kind ? 1 : 0);
    });
    entry.pairs = pairs;
    return entry;
  }

  function finalizeRound(S, now) {
    if (!S || S.phase !== 'playing') return null;
    var t = nowMs(now);
    // 幂等保护：旧快照回灌可能把已结算的轮次又拉回 playing，
    // 同一轮只允许进 history 一次
    var hist = S.history || [];
    var prev = hist.length ? hist[hist.length - 1] : null;
    if (prev && prev.round === S.round) {
      S.decisions = {};
      if (S.mode === MODES.DUEL && (prev.pairs || []).some(function (p) { return p.kind === 'exact'; })) {
        finish(S, 'match', null, t);
      } else if (S.mode === MODES.PARTY && prev.all) {
        finish(S, 'allmatch', null, t);
      } else {
        S.phase = 'reveal';
        S.deadline = null;
        S.hostNow = t;
      }
      return prev;
    }
    var seats = activeSeats(S);
    var words = [];
    var norm = {};
    (S.seatNames || []).forEach(function (_, i) {
      var w = isActive(S, i) ? wordOf(S, i) : '';
      words[i] = w;
      norm[i] = normalizeWord(w);
    });
    var pairs = [];
    for (var i = 0; i < seats.length; i++) {
      for (var j = i + 1; j < seats.length; j++) {
        var a = seats[i], b = seats[j];
        if (norm[a] && norm[a] === norm[b]) pairs.push({ a: a, b: b, kind: 'exact' });
      }
    }
    var sameAll = seats.length >= 2 && seats.every(function (s) {
      return !!norm[s] && norm[s] === norm[seats[0]];
    });
    var entry = { round: S.round, words: words, pairs: pairs, all: S.mode === MODES.PARTY && sameAll };
    S.history = S.history || [];
    S.history.push(entry);
    S.decisions = {};
    if (S.mode === MODES.DUEL && pairs.length) {
      finish(S, 'match', null, t);
    } else if (S.mode === MODES.PARTY && entry.all) {
      finish(S, 'allmatch', null, t);
    } else {
      S.phase = 'reveal';
      S.deadline = null;
      S.hostNow = t;
    }
    return entry;
  }

  function duelDecide(S, seat, value, at) {
    if (!S || S.mode !== MODES.DUEL) return { resolved: null, error: 'WRONG_MODE' };
    if (S.phase !== 'reveal') return { resolved: null, error: 'NOT_REVEAL' };
    var s = seatNum(seat);
    if (!isActive(S, s)) return { resolved: null, error: 'INACTIVE' };
    if (value !== 'same' && value !== 'next') return { resolved: null, error: 'BAD_VALUE' };
    if (value === 'same' && (!wordOf(S, 0) || !wordOf(S, 1))) {
      return { resolved: null, error: 'EMPTY_WORD' };
    }
    S.decisions = S.decisions || {};
    S.decisions[s] = { value: value, at: nowMs(at) };

    if (!duelAllDecided(S)) return { resolved: null };
    if (isDuelAgreed(S)) {
      syncPairs(S);
      return { resolved: 'agree' };
    }
    return { resolved: 'next' };
  }

  function toggleClaim(S, from, to, at) {
    if (!S || S.mode !== MODES.PARTY) return { ok: false, error: 'WRONG_MODE' };
    if (S.phase !== 'reveal') return { ok: false, error: 'NOT_REVEAL' };
    var a = seatNum(from), b = seatNum(to);
    if (a === b) return { ok: false, error: 'SELF' };
    if (!isActive(S, a) || !isActive(S, b)) return { ok: false, error: 'INACTIVE' };
    var wa = wordOf(S, a), wb = wordOf(S, b);
    if (!wa || !wb) return { ok: false, error: 'EMPTY_WORD' };
    if (normalizeWord(wa) === normalizeWord(wb)) return { ok: false, error: 'EXACT' };
    S.claims = S.claims || {};
    if (!S.claims[a]) S.claims[a] = {};
    var cur = S.claims[a][b];
    var on = !(cur && cur.on);
    S.claims[a][b] = { on: on, at: nowMs(at) };
    syncPairs(S);
    return { ok: true, on: on };
  }

  function setReady(S, seat, on, at) {
    if (!S || S.mode !== MODES.PARTY) return { ok: false, error: 'WRONG_MODE' };
    if (S.phase !== 'reveal') return { ok: false, error: 'NOT_REVEAL' };
    var s = seatNum(seat);
    if (!isActive(S, s)) return { ok: false, error: 'INACTIVE' };
    S.ready = S.ready || {};
    S.ready[s] = { on: !!on, at: nowMs(at) };
    return { ok: true, on: !!on };
  }

  function toggleRematch(S, seat, at) {
    if (!S) return { ok: false, error: 'NO_STATE' };
    if (S.phase !== 'finished') return { ok: false, error: 'NOT_FINISHED' };
    var s = seatNum(seat);
    if (!isActive(S, s)) return { ok: false, error: 'INACTIVE' };
    S.rematch = S.rematch || {};
    var on = !(S.rematch[s] && S.rematch[s].on);
    S.rematch[s] = { on: on, at: nowMs(at) };
    return { ok: true, on: on };
  }

  function disableRematch(S, seat) {
    if (!S || !S.rematch) return false;
    var s = seatNum(seat);
    if (!(s in S.rematch)) return false;
    delete S.rematch[s];
    return true;
  }

  /* 房主自动推进入口：幂等，每次只走一步 */
  function hostTick(S, now) {
    if (!S) return false;
    var t = nowMs(now);
    var seats = activeSeats(S);

    if (S.phase !== 'finished' && seats.length < minPlayers(S.mode)) {
      return finish(S, 'giveup', 0, t);
    }

    if (S.phase === 'playing') {
      var done = allDone(S);
      var timedOut = !!S.deadline && t >= S.deadline + GRACE_MS;
      if (!done && !timedOut) return false;
      if (!done) fillMissing(S, t);
      finalizeRound(S, t);
      return true;
    }

    if (S.phase === 'reveal') {
      if (S.mode === MODES.DUEL) {
        if (!duelAllDecided(S)) return false;
        if (isDuelAgreed(S)) {
          syncPairs(S);
          finish(S, 'agree', null, t);
          return true;
        }
        startRound(S, t);
        return true;
      }
      if (allReady(S)) {
        var limit = Number(S.settings && S.settings.roundLimit) || PARTY_ROUNDS[0];
        if (S.round >= limit) finish(S, 'limit', null, t);
        else startRound(S, t);
        return true;
      }
      return false;
    }

    if (S.phase === 'finished') {
      if (allRematch(S) && seats.length >= minPlayers(S.mode)) {
        restartGame(S, t);
        return true;
      }
      return false;
    }
    return false;
  }

  /* ---------- 称号 / 统计 ---------- */

  function duelLevel(rounds, result) {
    var n = Math.max(0, Math.floor(Number(rounds) || 0));
    if (result === 'giveup') return { t: '信号失联', q: '今天的脑电波没对上频道，换个时间再战！' };
    if (n <= 1) return { t: '灵魂双胞胎', q: '第一轮就撞上？你们是不是共用一个脑子！' };
    if (n === 2) return { t: '脑电波同频', q: '只绕了一个弯就会合，这默契可以上综艺了' };
    if (n === 3) return { t: '心有灵犀', q: '一点就通，好搭子认证 ✓' };
    if (n <= 5) return { t: '默契搭子', q: '绕了点路，但终究想到一块儿去了' };
    if (n <= 8) return { t: '渐入佳境', q: '兜兜转转，最后还是想到了一起' };
    if (n <= 12) return { t: '脑内环游', q: '你们的脑回路绕了地球一圈才碰头' };
    return { t: '平行宇宙重逢', q: '跨越了 ' + n + ' 轮，终于在同一个宇宙相遇' };
  }

  function partyStats(S, meSeat) {
    var seats = activeSeats(S);
    var scoreMap = {};
    var pairMap = {};
    ((S && S.history) || []).forEach(function (entry) {
      (entry.pairs || []).forEach(function (p) {
        var key = p.a + ':' + p.b;
        pairMap[key] = (pairMap[key] || 0) + 1;
        scoreMap[p.a] = (scoreMap[p.a] || 0) + 1;
        scoreMap[p.b] = (scoreMap[p.b] || 0) + 1;
      });
    });
    var scores = seats.map(function (s) { return { seat: s, score: scoreMap[s] || 0 }; });
    var pairs = Object.keys(pairMap).map(function (k) {
      var parts = k.split(':');
      var n = pairMap[k];
      return { a: Number(parts[0]), b: Number(parts[1]), n: n, count: n };
    }).sort(function (x, y) {
      return y.n - x.n || x.a - y.a || x.b - y.b;
    });
    var me = seatNum(meSeat);
    var myBest = null;
    if (me >= 0) {
      for (var i = 0; i < pairs.length; i++) {
        if (pairs[i].a === me || pairs[i].b === me) { myBest = pairs[i]; break; }
      }
    }
    return {
      scores: scores,
      pairs: pairs,
      best: pairs.length ? pairs[0] : null,
      topSeats: pairs.length ? [pairs[0].a, pairs[0].b] : [],
      myScore: me >= 0 ? (scoreMap[me] || 0) : 0,
      myBest: myBest,
      rounds: ((S && S.history) || []).length
    };
  }

  var RANK_TITLES = {
    3: ['万人迷', '比较标准的脑回路', '独立寒秋的脑回路'],
    4: ['万人迷', '比较标准的脑回路', '有点特色的脑回路', '独立寒秋的脑回路']
  };

  function rankTitles(scores) {
    var arr = (scores || []).map(function (x) {
      var sc = Number(x && x.score);
      return { seat: seatNum(x && x.seat), score: isFinite(sc) ? sc : 0 };
    });
    var n = arr.length;
    if (!n) return { special: null, tag: null, list: [] };
    var first = arr[0].score;
    var allSame = arr.every(function (x) { return x.score === first; });
    if (allSame) {
      if (first === 0) return { special: '各自美丽', tag: '都这样了还能做朋友吗！？', list: [] };
      var names = { 2: '双胞胎', 3: '三胞胎', 4: '四胞胎' };
      return { special: names[n] || n + '胞胎', tag: '可以去驾驶EVA了', list: [] };
    }
    var titles = RANK_TITLES[n] || (n > 4 ? RANK_TITLES[4] : RANK_TITLES[3]);
    var list = [];
    arr.slice().sort(function (a, b) { return a.seat - b.seat; }).forEach(function (x) {
      var higher = 0;
      arr.forEach(function (y) { if (y.score > x.score) higher++; });
      var rank = 1 + higher;
      var group = null;
      for (var i = 0; i < list.length; i++) if (list[i].rank === rank) group = list[i];
      if (!group) {
        group = { rank: rank, title: titles[Math.min(rank - 1, titles.length - 1)], tag: null, seats: [] };
        list.push(group);
      }
      group.seats.push(x.seat);
    });
    list.sort(function (a, b) { return a.rank - b.rank; });
    list.forEach(function (g) { g.seats.sort(function (a, b) { return a - b; }); });
    return { special: null, tag: null, list: list };
  }

  function cpTitle(count) {
    var n = Math.floor(Number(count) || 0);
    if (n >= 6) return '天选 CP';
    if (n >= 4) return '默契老夫老妻';
    if (n >= 2) return '心有灵犀 CP';
    if (n >= 1) return '一撞钟情';
    return null;
  }

  /* ---------- 合并（纯函数，不 mutate 入参） ---------- */

  var HOST_FIELDS = ['mode', 'settings', 'seatNames', 'phase', 'round', 'history',
    'deadline', 'hostNow', 'result', 'resultBy', 'departed', 'gameNo'];

  function cloneMap(m) {
    var o = {};
    if (!m) return o;
    Object.keys(m).forEach(function (k) {
      var v = m[k];
      o[k] = v && typeof v === 'object' ? Object.assign({}, v) : v;
    });
    return o;
  }

  function atOf(v) {
    var n = Number(v && v.at);
    return isFinite(n) ? n : NaN;
  }

  /* 同轮按 at 比较，相等取 remote（远端为准） */
  function mergeSeatMap(localMap, remoteMap) {
    var o = cloneMap(remoteMap);
    Object.keys(localMap || {}).forEach(function (k) {
      var a = localMap[k];
      var b = (remoteMap || {})[k];
      if (!a) return;
      if (!b) { o[k] = Object.assign({}, a); return; }
      var aa = atOf(a), bb = atOf(b);
      if (isFinite(aa) && (!isFinite(bb) || aa > bb)) o[k] = Object.assign({}, a);
    });
    return o;
  }

  /* claims 为 from→to 双层，逐对比较 at */
  function mergeClaims(localClaims, remoteClaims) {
    var out = {};
    var froms = {};
    Object.keys(remoteClaims || {}).forEach(function (f) { froms[f] = 1; });
    Object.keys(localClaims || {}).forEach(function (f) { froms[f] = 1; });
    Object.keys(froms).forEach(function (f) {
      var l = (localClaims || {})[f] || {};
      var r = (remoteClaims || {})[f] || {};
      var row = mergeSeatMap(l, r);
      if (Object.keys(row).length) out[f] = row;
    });
    return out;
  }

  function mergeState(local, remote, opts) {
    local = local || {};
    remote = remote || {};
    opts = opts || {};
    var src = opts.isHost ? local : remote; // 房主字段以权威侧为准
    var out = {};

    HOST_FIELDS.forEach(function (k) {
      out[k] = src[k] !== undefined ? src[k] : remote[k];
    });
    out.schema = remote.schema !== undefined ? remote.schema : local.schema;

    // 轮次字段：轮次变了就整块丢本地（含旧词/旧表态）
    var staleRound = local.gameNo !== remote.gameNo || local.round !== remote.round;
    ['subs', 'decisions', 'claims', 'ready', 'rematch'].forEach(function (k) {
      if (staleRound) out[k] = cloneMap(src[k]);
      else if (k === 'claims') out[k] = mergeClaims(local.claims, remote.claims);
      else out[k] = mergeSeatMap(local[k], remote[k]);
    });

    // 残留在其它轮次的提交不参与本轮
    if (out.round != null) {
      Object.keys(out.subs).forEach(function (k) {
        var v = out.subs[k];
        if (v && v.round != null && v.round !== out.round) delete out.subs[k];
      });
    }

    // 同步元数据统一用 remote（由 SWN 递增后写入）
    out.rev = remote.rev;
    out._ts = remote._ts;
    out._pushId = remote._pushId;

    return out;
  }

  /* ---------- 导出 ---------- */

  var SWG = {
    MODES: MODES,
    SEAT_COLORS: SEAT_COLORS,
    TIME_OPTIONS: TIME_OPTIONS,
    PARTY_ROUNDS: PARTY_ROUNDS,
    LIMITS: LIMITS,
    HOST_FIELDS: HOST_FIELDS,
    GRACE_MS: GRACE_MS,

    minPlayers: minPlayers,
    normalizeWord: normalizeWord,
    charLen: charLen,
    validateWord: validateWord,
    validateName: validateName,

    createState: createState,
    startRound: startRound,
    restartGame: restartGame,

    submit: submit,
    submitEmpty: submitEmpty,
    withdraw: withdraw,
    fillMissing: fillMissing,
    allDone: allDone,
    allReady: allReady,
    allRematch: allRematch,
    isActive: isActive,
    activeSeats: activeSeats,
    markDeparted: markDeparted,

    finalizeRound: finalizeRound,
    duelDecide: duelDecide,
    toggleClaim: toggleClaim,
    syncPairs: syncPairs,
    setReady: setReady,
    toggleRematch: toggleRematch,
    disableRematch: disableRematch,

    hostTick: hostTick,
    finish: finish,

    duelLevel: duelLevel,
    partyStats: partyStats,
    rankTitles: rankTitles,
    cpTitle: cpTitle,

    mergeState: mergeState
  };

  root.SWG = SWG;
})(typeof window !== 'undefined' ? window : globalThis);