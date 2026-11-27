'use strict';
/* 《面具摔跤手》Maskmen —— 界面渲染与交互（单机人机） */
(function (root) {
  const M = root.Maskmen;
  const AI = root.MaskmenAI;
  const SFX = root.MaskmenAudio || { play: function () {}, setMuted: function () {}, isMuted: function () { return false; } };

  const $ = function (sel, r) { return (r || document).querySelector(sel); };
  const $$ = function (sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); };

  const LS = { state: 'maskmen-state', config: 'maskmen-config', stats: 'maskmen-stats' };
  const SEAT_PROPS = ['prop-1', 'prop-2', 'prop-3', 'prop-4', 'prop-5', 'prop-6'];

  const app = {
    st: null,
    screen: 'home',
    busy: false,
    timer: null,
    dealTimer: null,
    freshTimer: null,
    toastTimer: null,
    focus: null,
    freshColor: null,
    dealSeason: null,
    lastRev: 0,
    setupCount: 1,
    config: { name: '你', aiCount: 1, muted: false },
    stats: { games: 0, wins: 0, seasons: 0, byCount: {} },
    modalOnClose: null,
  };

  /* ================= 存储 ================= */

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 忽略 */ }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(LS.state);
      if (!raw) return null;
      return M.deserialize(raw);
    } catch (e) { return null; }
  }

  function saveGame() {
    if (!app.st) return;
    try { localStorage.setItem(LS.state, M.serialize(app.st)); } catch (e) { /* 忽略 */ }
  }

  function clearGameSave() {
    try { localStorage.removeItem(LS.state); } catch (e) { /* 忽略 */ }
  }

  /* ================= 小工具 ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function cvar(c) { return 'var(--c-' + M.COLOR_KEYS[c] + ')'; }
  function seatPropKey(i) { return SEAT_PROPS[((i | 0) % SEAT_PROPS.length + SEAT_PROPS.length) % SEAT_PROPS.length]; }
  function label(c) { return M.COLOR_NAMES[c] + M.COLOR_SYMBOLS[c]; }
  function plus(n) { return n > 0 ? '+' + n : String(n); }

  function seatIconSvg(i, cls) {
    return '<svg class="' + (cls || 'prop') + '" aria-hidden="true"><use href="#' + seatPropKey(i) + '"/></svg>';
  }

  function maskSvg(key, cls, style) {
    return '<svg class="' + (cls || 'mask') + '"' + (style ? ' style="' + style + '"' : '') +
      ' aria-hidden="true"><use href="#mask-' + key + '"/></svg>';
  }

  function sanitizeName(v) {
    const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 8);
    return s || '你';
  }

  function show(name) {
    app.screen = name;
    $('#app').dataset.screen = name;
    $$('.screen').forEach(function (el) { el.hidden = el.dataset.screen !== name; });
    window.scrollTo(0, 0);
  }

  function toast(text) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('is-on');
    clearTimeout(app.toastTimer);
    app.toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2200);
  }

  function clearTimer() {
    if (app.timer) { clearTimeout(app.timer); app.timer = null; }
    app.busy = false;
  }

  function confettiHTML(n) {
    let h = '<div class="confetti" aria-hidden="true">';
    for (let i = 0; i < n; i++) {
      const left = (i * 37) % 100;
      const dx = ((i * 53) % 180) - 90;
      const dur = (1.2 + ((i * 37) % 90) / 100).toFixed(2);
      const delay = (((i * 29) % 70) / 100).toFixed(2);
      h += '<i style="left:' + left + '%;--dx:' + dx + 'px;animation-duration:' + dur +
        's;animation-delay:' + delay + 's"></i>';
    }
    return h + '</div>';
  }

  /* ================= 弹窗 ================= */

  function openModal(opts) {
    const ov = $('#overlay');
    $('#modal-title').textContent = opts.title || '';
    $('#modal-body').innerHTML = opts.body || '';
    $('#modal-foot').innerHTML = opts.foot || '';
    const closable = opts.closable !== false;
    $('#modal-close').hidden = !closable;
    ov.hidden = false;
    ov.dataset.closable = closable ? '1' : '0';
    app.modalOnClose = closable ? (opts.onClose || null) : null;
    const body = $('#modal-body');
    body.scrollTop = 0;
    const firstBtn = $('#modal-foot button') || $('#modal-close');
    setTimeout(function () { if (firstBtn && firstBtn.offsetParent !== null) firstBtn.focus(); }, 30);
  }

  function closeModal(skipOnClose) {
    const ov = $('#overlay');
    if (!ov || ov.hidden) { app.modalOnClose = null; return; }
    const cb = app.modalOnClose;
    app.modalOnClose = null;
    ov.hidden = true;
    $('#modal-body').innerHTML = '';
    $('#modal-foot').innerHTML = '';
    if (!skipOnClose && typeof cb === 'function') cb();
  }

  function closeFoot(text) {
    return '<button class="btn btn-ghost" data-close>' + (text || '关闭') + '</button>';
  }

  /* ================= 首页 / 设置 ================= */

  function renderHome() {
    const saved = loadSaved();
    const cont = $('#btn-continue');
    const sub = $('#home-save');
    if (saved) {
      cont.hidden = false;
      cont.textContent = '继续上局 · 第 ' + saved.season + ' 赛季';
      sub.hidden = false;
      sub.textContent = saved.players[0].name + ' · ' + saved.playerCount + ' 人局 · 第 ' + saved.round + ' 回合';
    } else {
      cont.hidden = true;
      sub.hidden = true;
      sub.textContent = '';
    }
    const s = app.stats;
    $('#home-stats').textContent = s.games
      ? '战绩：' + s.games + ' 场 · 夺冠 ' + s.wins + ' 次'
      : '战绩：还没有完整打完的比赛';
  }

  function goSetup() {
    app.setupCount = Math.max(1, Math.min(5, app.config.aiCount || 1));
    $('#player-name').value = app.config.name || '你';
    renderSetup();
    show('setup');
  }

  function renderSetup() {
    $$('#ai-count button').forEach(function (b) {
      b.classList.toggle('is-on', Number(b.dataset.count) === app.setupCount);
    });
    const total = app.setupCount + 1;
    const hs = M.HAND_SIZE[total];
    const mode = total === 2 ? '先赢 3 个赛季' : '打完 4 个赛季，总分最高者获胜';
    $('#ai-hint').textContent = '共 ' + total + ' 人 · 每人 ' + hs + ' 张 · ' + mode;
    renderRoster();
  }

  function renderRoster() {
    const total = app.setupCount + 1;
    const you = sanitizeName($('#player-name').value);
    const names = [you].concat(M.AI_NAMES.slice(0, total - 1));
    $('#roster').innerHTML = names.map(function (name, i) {
      const youRow = i === 0;
      return '<li class="' + (youRow ? 'is-you' : '') + '">' +
        '<span class="r-avatar">' + seatIconSvg(i) + '</span>' +
        '<span class="r-name">' + esc(name) + '</span>' +
        '<span class="r-tag">' + (youRow ? '你' : 'AI') + '</span>' +
        '</li>';
    }).join('');
  }

  function beginFromSetup() {
    const name = sanitizeName($('#player-name').value);
    $('#player-name').value = name;
    const count = app.setupCount;
    app.config.name = name;
    app.config.aiCount = count;
    writeJSON(LS.config, app.config);
    if (loadSaved()) {
      openModal({
        title: '开始新比赛？',
        body: '<p>这台设备上还有一局没打完。开始新比赛会覆盖那份进度。</p>',
        foot: '<button class="btn btn-ghost" data-close>先去继续</button>' +
          '<button class="btn btn-primary" id="m-overwrite">覆盖并开赛</button>',
      });
      const ok = document.getElementById('m-overwrite');
      ok.onclick = function () { closeModal(true); startNewGame(count, name); };
      return;
    }
    startNewGame(count, name);
  }

  /* ================= 开局 / 存档 ================= */

  function startNewGame(aiCount, name) {
    const ai = Math.max(1, Math.min(5, aiCount | 0));
    const total = ai + 1;
    const seed = ((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0) || 1;
    clearTimer();
    closeModal(true);
    app.st = M.createGame({ playerCount: total, seed: seed, humanName: sanitizeName(name) });
    app.config.name = sanitizeName(name);
    app.config.aiCount = ai;
    writeJSON(LS.config, app.config);
    app.focus = null;
    app.freshColor = null;
    app.dealSeason = null;
    app.lastRev = 0;
    saveGame();
    show('game');
    renderGame();
    SFX.play('deal');
    schedule(560);
  }

  function resumeGame() {
    const st = loadSaved();
    if (!st) {
      renderHome();
      toast('没有可继续的对局');
      return;
    }
    clearTimer();
    app.st = st;
    app.focus = null;
    app.freshColor = null;
    app.dealSeason = st.season;
    app.lastRev = st.rev;
    show('game');
    renderGame();
    SFX.play('tap');
    if (st.phase === 'seasonEnd') {
      app.timer = setTimeout(showSeason, 260);
    } else if (st.phase === 'gameEnd') {
      showResult();
    } else {
      schedule(320);
    }
  }

  function resumeFlow() {
    if (!app.st) return;
    const st = app.st;
    if (st.phase === 'playing' || st.phase === 'roundEnd') {
      schedule(360);
    } else if (st.phase === 'seasonEnd') {
      showSeason();
    } else if (st.phase === 'gameEnd') {
      showResult();
    }
  }

  function toHome() {
    clearTimer();
    closeModal(true);
    app.st = null;
    app.focus = null;
    app.freshColor = null;
    app.busy = false;
    renderHome();
    show('home');
    SFX.play('tap');
  }

  function confirmExit() {
    const st = app.st;
    if (!st || st.phase === 'gameEnd') { toHome(); return; }
    clearTimer();
    openModal({
      title: '退出比赛？',
      body: '<p>当前进度会自动保存在这台设备上。回到首页后点「继续上局」，就能从原地接着打。</p>',
      foot: '<button class="btn btn-ghost" data-close>继续比赛</button>' +
        '<button class="btn btn-primary" id="m-exit-ok">退出到首页</button>',
      closable: true,
      onClose: resumeFlow,
    });
    const ok = document.getElementById('m-exit-ok');
    ok.onclick = function () { closeModal(true); saveGame(); toHome(); };
  }

  /* ================= 对局渲染 ================= */

  function renderGame() {
    const st = app.st;
    if (!st) return;
    renderHud(st);
    renderBoard(st);
    renderSeats(st);
    renderTurn(st);
    renderHand(st);
    renderActions(st);
    announce(st);
  }

  function renderHud(st) {
    $('#hud-season').textContent = st.playerCount === 2
      ? '第 ' + st.season + ' 赛季'
      : '第 ' + st.season + '/' + M.SEASONS + ' 赛季';
    $('#hud-round').textContent = '第 ' + st.round + ' 回合';
  }

  function renderBoard(st) {
    const board = $('#board');
    const foot = $('#board-foot');
    if (!st.columns.length) {
      board.innerHTML = '<div class="board-empty">第一张牌会放下第一枚力量标志<br>同列越靠上越强 · 点按标志查看关系</div>';
      foot.innerHTML = '同色不能相压；关系未定时，多出 1 张来确立强弱。';
      return;
    }

    board.innerHTML = st.columns.map(function (col) {
      return '<div class="col">' + col.map(function (e) {
        let cls = 'marker';
        if (app.focus != null) {
          if (e.c === app.focus) cls += ' is-focus';
          else if (st.relation[app.focus][e.c]) cls += ' is-strong';
          else if (st.relation[e.c][app.focus]) cls += ' is-weak';
          else cls += ' is-dim';
        }
        if (st.prevPlay && st.prevPlay.color === e.c) cls += ' is-last';
        if (app.freshColor === e.c) cls += ' is-fresh';
        const name = M.COLOR_NAMES[e.c] + M.COLOR_SYMBOLS[e.c];
        return '<button type="button" class="' + cls + '" data-color="' + e.c +
          '" style="--cc:' + cvar(e.c) + '" aria-label="' + name +
          '" aria-pressed="' + (app.focus === e.c) + '">' +
          '<span aria-hidden="true">' + M.COLOR_SYMBOLS[e.c] + '</span>' +
          '<span class="mk-name" aria-hidden="true">' + M.COLOR_NAMES[e.c] + '</span>' +
          '</button>';
      }).join('') + '</div>';
    }).join('');

    if (app.focus != null) {
      const c = app.focus;
      const strong = [];
      const weak = [];
      for (let z = 0; z < M.COLORS; z++) {
        if (st.relation[c][z]) strong.push(label(z));
        else if (st.relation[z][c]) weak.push(label(z));
      }
      foot.innerHTML = '<b>' + label(c) + '</b> 强于：' + (strong.join('、') || '—') +
        ' · 弱于：' + (weak.join('、') || '—') + ' · 其余未定' +
        ' <button type="button" class="focus-clear">取消</button>';
    } else {
      foot.innerHTML = '同列上强下弱；不同列且无传递关系 = 未定。点按任一标志查看两两关系。';
    }
  }

  function renderSeats(st) {
    const seats = $('#seats');
    seats.innerHTML = st.players.map(function (p, i) {
      const count = M.handCount(p);
      let cls = 'seat';
      if (i === 0) cls += ' is-human';
      if (st.phase === 'playing' && st.turn === i && !p.passed && !p.out) cls += ' is-current';
      if (p.passed && !p.out) cls += ' is-passed';
      if (p.out) cls += ' is-out';

      const belts = ['gold', 'silver', 'black'].filter(function (k) { return p.belts[k] > 0; })
        .map(function (k) {
          return '<svg class="belt belt-' + k + '" viewBox="0 0 64 40" aria-hidden="true"><use href="#belt"/></svg>' +
            '<span class="belt-count">' + p.belts[k] + '</span>';
        }).join('') || '<span class="belt-count" style="opacity:.32">—</span>';

      const tags = [];
      if (p.out && p.finishRank) tags.push('<span class="tag done">第 ' + p.finishRank + ' 名</span>');
      const hostTag = st.phase === 'playing' && st.leader === i
        ? '<span class="tag host">主持</span>' : '';

      let stamp = '';
      if (p.out) stamp = '<span class="seat-done">第 ' + p.finishRank + ' 名</span>';
      else if (p.passed && (st.phase === 'playing' || st.phase === 'roundEnd')) {
        stamp = '<span class="seat-stamp">跳过</span>';
      }

      return '<article class="' + cls + '" aria-label="' + esc(p.name) + '，' + count + ' 张手牌，' +
        plus(p.score) + ' 分">' +
        '<div class="seat-top">' +
        '<span class="seat-avatar">' + seatIconSvg(i) + '</span>' +
        '<span class="seat-name">' + esc(p.name) + '</span>' + hostTag +
        '</div>' +
        '<div class="seat-meta"><span class="seat-count">' + count + '<small>张</small></span>' +
        '<span class="seat-score">' + plus(p.score) + '</span></div>' +
        '<div class="seat-belts">' + belts + '</div>' +
        '<div class="seat-tags">' + tags.join('') + '</div>' +
        stamp +
        '</article>';
    }).join('');

    if (window.matchMedia && window.matchMedia('(max-width: 899px)').matches) {
      const cur = seats.querySelector('.seat.is-current');
      if (cur) {
        const sr = seats.getBoundingClientRect();
        const cr = cur.getBoundingClientRect();
        if (cr.left < sr.left + 4) seats.scrollLeft -= (sr.left - cr.left) + 6;
        else if (cr.right > sr.right - 4) seats.scrollLeft += (cr.right - sr.right) + 6;
      }
    }
  }

  function renderTurn(st) {
    const av = $('#turn-avatar');
    const title = $('#turn-title');
    const sub = $('#turn-sub');
    const trick = $('#trick');

    let seat = st.turn;
    let t = '';
    let s = '';

    if (st.phase === 'roundEnd' && st.roundSummary) {
      const rs = st.roundSummary;
      seat = rs.lastPlayer;
      t = '回合结束';
      const lp = rs.lastPlay;
      s = '最后出牌：<b>' + esc(st.players[seat].name) + '</b>' +
        (lp ? '（' + label(lp.color) + '×' + lp.count + '）' : '') +
        ' · 下回合主持人：<b>' + esc(st.players[rs.nextLeader].name) + '</b>';
    } else if (st.phase === 'seasonEnd' && st.seasonSummary) {
      const win = st.players[st.seasonSummary.winner];
      seat = win.id;
      t = '第 ' + st.season + ' 赛季结束';
      s = '本季冠军：<b>' + esc(win.name) + '</b> · 结算中…';
    } else if (st.phase === 'gameEnd') {
      const wid = st.result && st.result.winnerIds.length ? st.result.winnerIds[0] : st.turn;
      seat = wid;
      t = '比赛结束';
      s = '最终排名已产生。';
    } else {
      const p = st.players[seat];
      if (seat === 0) {
        if (p.out) {
          t = '你已完成 · 第 ' + p.finishRank + ' 名';
          s = '等待本回合结束。';
        } else if (p.passed) {
          t = '你已跳过';
          s = '本回合不再行动，等待其他人出完。';
        } else if (!st.prevPlay) {
          t = '轮到你 · 主持人';
          s = '先出 <b>1 张</b>，为这个颜色放下第一枚力量标志。';
        } else {
          const lm = M.legalMoves(st);
          if (!lm.moves.length) {
            t = '轮到你 · 无法跟牌';
            s = followHint(st, true);
          } else {
            t = '轮到你 · 跟牌';
            s = followHint(st, false);
          }
        }
      } else {
        t = esc(p.name) + ' 正在思考<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
        if (!st.prevPlay) s = '首家出牌：先出 1 张，放下力量标志。';
        else s = followHint(st, false, p.name);
      }
    }

    title.innerHTML = t;
    sub.innerHTML = s;
    av.innerHTML = seatIconSvg(seat);

    if (!st.trickPlays.length) {
      trick.innerHTML = '<span class="trick-empty">本回合还没有人出牌</span>';
    } else {
      trick.innerHTML = st.trickPlays.map(function (tp, idx) {
        const last = idx === st.trickPlays.length - 1;
        return '<span class="trick-chip' + (last ? ' is-last' : '') + '" style="--cc:' + cvar(tp.color) + '">' +
          '<span class="tc-avatar">' + seatIconSvg(tp.player) + '</span>' +
          '<span>' + esc(st.players[tp.player].name) + '</span>' +
          '<span class="tc-color">' + M.COLOR_SYMBOLS[tp.color] + '×' + tp.count + '</span>' +
          '</span>';
      }).join('');
      trick.scrollLeft = trick.scrollWidth;
    }
  }

  function followHint(st, noMoves, aiName) {
    const prev = st.prevPlay;
    if (!prev) return aiName ? '首家出牌中。' : '先出 1 张。';
    const pc = label(prev.color) + '×' + prev.count;
    const who = st.players[prev.player] ? st.players[prev.player].name : '';
    if (noMoves) {
      return '上一手 ' + pc + '（' + esc(who) + '）。没有合法牌，只能跳过本回合。';
    }
    if (aiName) {
      return '上一手 ' + pc + '（' + esc(who) + '）· 正在寻找能压过的颜色。';
    }
    const lm = M.legalMoves(st);
    const known = lm.moves.filter(function (m) { return st.relation[m.color][prev.color]; });
    const unknown = lm.moves.filter(function (m) { return !st.relation[m.color][prev.color]; });
    const parts = [];
    if (known.length) {
      parts.push('已知强色 ' + known.map(function (m) { return label(m.color); }).join('、') + ' 出 ' + prev.count + ' 张');
    }
    if (unknown.length) {
      parts.push('未定色 ' + unknown.map(function (m) { return label(m.color); }).join('、') + ' 出 ' + (prev.count + 1) + ' 张');
    }
    return '上一手 ' + pc + '（' + esc(who) + '）。' + parts.join('；') + '。';
  }

  function handStatus(st, me, c, lm) {
    if (!st || !me) return { text: '—', cls: 'is-waiting' };
    const n = me.hand[c];
    if (st.phase !== 'playing') {
      if (n === 0) return { text: '无牌', cls: 'is-empty' };
      if (me.out) return { text: '已完成', cls: 'is-waiting' };
      return { text: '结算中', cls: 'is-waiting' };
    }
    if (me.out) return { text: '已完成', cls: 'is-waiting' };
    if (me.passed) return { text: '已跳过', cls: 'is-waiting is-passed' };
    if (st.turn !== 0) {
      if (n === 0) return { text: '无牌', cls: 'is-empty' };
      return { text: '等待', cls: 'is-waiting' };
    }
    if (n === 0) return { text: '无牌', cls: 'is-empty' };
    if (!st.prevPlay) return { text: '可出 1 张', cls: 'is-playable' };

    const prev = st.prevPlay;
    if (c === prev.color) return { text: '同色 · 不可出', cls: 'is-illegal' };
    const rel = st.relation[c][prev.color] ? 1 : st.relation[prev.color][c] ? -1 : 0;
    if (rel === -1) return { text: '已知弱 · 不可出', cls: 'is-illegal' };
    const need = rel === 1 ? prev.count : prev.count + 1;
    if (need > M.MAX_PLAY) return { text: '需 4 张 · 超上限', cls: 'is-illegal' };
    if (n < need) {
      return { text: (rel === 1 ? '需 ' : '未定 · 需 ') + need + ' 张 · 不足', cls: 'is-illegal' };
    }
    return {
      text: rel === 1 ? '可出 ' + need + ' 张' : '未定 · 出 ' + need + ' 张',
      cls: 'is-playable',
    };
  }

  function renderHand(st) {
    const me = st.players[0];
    const handEl = $('#hand');
    const lm = (st.phase === 'playing' && st.turn === 0 && !me.passed && !me.out) ? M.legalMoves(st) : null;

    if (app.dealSeason !== st.season) {
      app.dealSeason = st.season;
      handEl.classList.remove('is-dealt');
      void handEl.offsetWidth;
      handEl.classList.add('is-dealt');
      clearTimeout(app.dealTimer);
      app.dealTimer = setTimeout(function () { handEl.classList.remove('is-dealt'); }, 950);
    }

    $('#hand-count').innerHTML = '共 <b>' + M.handCount(me) + '</b> 张';
    $('#hand-wrap').classList.toggle('is-myturn',
      st.phase === 'playing' && st.turn === 0 && !me.passed && !me.out);

    handEl.innerHTML = M.COLOR_KEYS.map(function (key, c) {
      const stt = handStatus(st, me, c, lm);
      const cls = stt.cls + (app.focus === c ? ' is-focus' : '');
      const aria = M.COLOR_NAMES[c] + M.COLOR_SYMBOLS[c] + '，' + me.hand[c] + ' 张，' + stt.text;
      return '<button type="button" class="hand-card ' + cls + '" data-color="' + c +
        '" style="--cc:' + cvar(c) + '" aria-label="' + esc(aria) + '" aria-disabled="' +
        (cls.indexOf('is-playable') < 0) + '">' +
        '<i class="hc-bar" aria-hidden="true"></i>' +
        '<span class="hc-top"><span class="hc-symbol">' + M.COLOR_SYMBOLS[c] + '</span>' +
        '<span class="hc-count">' + me.hand[c] + '<small>张</small></span></span>' +
        maskSvg(key, 'hc-mask') +
        '<span class="hc-name">' + M.COLOR_NAMES[c] + '</span>' +
        '<span class="hc-status">' + stt.text + '</span>' +
        '</button>';
    }).join('');

    renderSoundIcon();
  }

  function renderActions(st) {
    const btn = $('#btn-pass');
    let enabled = false;
    let title = '';
    if (!st || st.phase !== 'playing') {
      title = '现在不能跳过';
    } else if (st.turn !== 0) {
      title = '还没轮到你';
    } else if (st.players[0].out) {
      title = '你已经完成';
    } else if (st.players[0].passed) {
      title = '本回合已经跳过';
    } else {
      const lm = M.legalMoves(st);
      enabled = !!lm.canPass;
      title = enabled ? '跳过本回合，之后本回合不再行动' : '主持人必须出牌';
    }
    btn.disabled = !enabled;
    btn.title = title;
    btn.setAttribute('aria-disabled', String(!enabled));
  }

  function renderSoundIcon() {
    const b = $('#btn-sound');
    if (!b) return;
    b.innerHTML = '<svg aria-hidden="true"><use href="#ico-' + (app.config.muted ? 'mute' : 'sound') + '"/></svg>';
    b.setAttribute('aria-label', app.config.muted ? '开启声音' : '关闭声音');
    b.setAttribute('aria-pressed', String(!!app.config.muted));
  }

  function announce(st) {
    if (!st || app.lastRev === st.rev) return;
    app.lastRev = st.rev;
    const a = st.lastAction;
    if (!a) return;
    const nm = function (seat) { return st.players[seat] ? st.players[seat].name : ''; };
    let text = '';
    if (a.type === 'seasonStart') {
      text = '第 ' + a.season + ' 赛季开始，每人 ' + st.handSize + ' 张，' + nm(a.leader) + ' 主持';
    } else if (a.type === 'roundStart') {
      text = '第 ' + a.round + ' 回合开始，' + nm(a.leader) + ' 主持';
    } else if (a.type === 'play') {
      text = nm(a.player) + ' 出了 ' + label(a.color) + ' ' + a.count + ' 张';
      if (a.relationAdded) text += '，确立 ' + label(a.color) + ' 强于 ' + label(a.relationTo);
      if (a.finishedRank) text += '，打空手牌，第 ' + a.finishedRank + ' 名完成';
      if (a.seasonEnded) text += '。第 ' + st.season + ' 赛季结束';
      else if (a.roundEnded) text += '。本回合结束，下回合由 ' + nm(a.nextLeader) + ' 主持';
    } else if (a.type === 'pass') {
      text = nm(a.player) + ' 跳过';
      if (a.roundEnded) text += '。本回合结束，下回合由 ' + nm(a.nextLeader) + ' 主持';
    } else if (a.type === 'gameEnd') {
      text = '比赛结束';
    }
    if (!text) return;
    const live = $('#live');
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  /* ================= 玩家操作 ================= */

  function shakeCard(c) {
    const el = document.querySelector('#hand .hand-card[data-color="' + c + '"]');
    if (!el) return;
    el.classList.remove('is-shake');
    void el.offsetWidth;
    el.classList.add('is-shake');
    setTimeout(function () { el.classList.remove('is-shake'); }, 340);
  }

  function shakeApp() {
    const el = $('#app');
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
    setTimeout(function () { el.classList.remove('is-shaking'); }, 340);
  }

  function illegalReason(st, c) {
    const p = st.players[0];
    if (p.hand[c] === 0) return '你手里没有这个颜色。';
    if (!st.prevPlay) return '主持人必须出 1 张。';
    const prev = st.prevPlay;
    if (c === prev.color) return '跟牌不能使用同一种颜色。';
    const rel = st.relation[c][prev.color] ? 1 : st.relation[prev.color][c] ? -1 : 0;
    if (rel === -1) return '这个颜色已知弱于 ' + label(prev.color) + '，不能出。';
    const need = rel === 1 ? prev.count : prev.count + 1;
    if (need > M.MAX_PLAY) return '未定颜色需要 4 张，超过单次 3 张上限。';
    return '需要 ' + need + ' 张，你只有 ' + p.hand[c] + ' 张。';
  }

  function humanPlay(color) {
    const st = app.st;
    if (!st) return;
    if (st.phase !== 'playing') return toast('现在不能出牌');
    if (st.turn !== 0) return toast('还没轮到你');
    const me = st.players[0];
    if (me.passed) return toast('你本回合已经跳过');
    if (me.out) return toast('你已完成，等待本回合结束');

    const lm = M.legalMoves(st);
    const ok = lm.moves.some(function (m) { return m.color === color; });
    if (!ok) {
      shakeCard(color);
      SFX.play('error');
      return toast(illegalReason(st, color));
    }

    clearTimer();
    app.focus = null;
    app.freshColor = null;
    const res = M.play(st, color);
    if (!res.ok) { SFX.play('error'); return toast(res.error); }
    afterAction(res.action);
  }

  function humanPass() {
    const st = app.st;
    if (!st) return;
    if (st.phase !== 'playing') return toast('现在不能跳过');
    if (st.turn !== 0) return toast('还没轮到你');
    const lm = M.legalMoves(st);
    if (!lm.canPass) { SFX.play('error'); return toast('主持人必须出牌'); }
    clearTimer();
    app.focus = null;
    const res = M.pass(st);
    if (!res.ok) { SFX.play('error'); return toast(res.error); }
    afterAction(res.action);
  }

  function afterAction(action) {
    const st = app.st;
    if (!st) return;
    saveGame();

    if (action) {
      if (action.type === 'play') {
        if (action.relationAdded || action.newColumn) {
          app.freshColor = action.color;
          clearTimeout(app.freshTimer);
          app.freshTimer = setTimeout(function () {
            app.freshColor = null;
            if (app.st) renderBoard(app.st);
          }, 900);
        }
        SFX.play('play');
        if (action.relationAdded || action.isLeader) SFX.play('chip');
        shakeApp();
      } else if (action.type === 'pass') {
        SFX.play('pass');
      }
      if (action.roundEnded) SFX.play('round');
    }

    renderGame();

    if (!app.st) return;
    if (st.phase === 'seasonEnd') {
      app.timer = setTimeout(showSeason, 520);
      return;
    }
    if (st.phase === 'roundEnd') {
      schedule(1150);
      return;
    }
    if (st.phase === 'gameEnd') {
      showResult();
      return;
    }
    schedule();
  }

  function schedule(delay) {
    clearTimer();
    const st = app.st;
    if (!st) return;

    if (st.phase === 'roundEnd') {
      app.timer = setTimeout(function () {
        if (!app.st || app.st.phase !== 'roundEnd') return;
        const res = M.nextRound(app.st);
        if (!res.ok) return;
        saveGame();
        app.focus = null;
        SFX.play('round');
        renderGame();
        schedule();
      }, delay == null ? 1100 : delay);
      return;
    }

    if (st.phase === 'seasonEnd') {
      app.timer = setTimeout(showSeason, delay == null ? 450 : delay);
      return;
    }

    if (st.phase === 'gameEnd') { showResult(); return; }

    if (st.turn === 0) {
      app.busy = false;
      renderGame();
      return;
    }

    app.busy = true;
    renderGame();
    const wait = delay == null ? (520 + (M.aiSeed(st) % 460)) : delay;
    app.timer = setTimeout(function () {
      const cur = app.st;
      if (!cur || cur.phase !== 'playing' || cur.turn === 0) return;
      const seat = cur.turn;
      const view = M.viewFor(cur, seat);
      const act = AI.choose(view, M.aiSeed(cur));
      let res;
      if (act && act.type === 'play') res = M.play(cur, act.color);
      else res = M.pass(cur);
      if (!res.ok) {
        const lm = M.legalMoves(cur);
        if (lm.canPass) res = M.pass(cur);
        if (!res.ok) {
          app.busy = false;
          toast('AI 行动失败：' + (res.error || '未知错误'));
          return;
        }
      }
      afterAction(res.action);
    }, wait);
  }

  /* ================= 赛季 / 终局 ================= */

  function showSeason() {
    const st = app.st;
    if (!st || st.phase !== 'seasonEnd' || !st.seasonSummary) return;
    clearTimer();
    renderGame();
    const s = st.seasonSummary;

    const rows = s.ranking.map(function (r) {
      const p = st.players[r.seat];
      const dcls = r.delta > 0 ? 'plus' : r.delta < 0 ? 'minus' : 'zero';
      return '<div class="rank-row' + (r.seat === 0 ? ' is-me' : '') + (r.rank === 1 ? ' is-winner' : '') + '">' +
        '<span class="rank-num">' + r.rank + '</span>' +
        '<span class="rank-avatar">' + seatIconSvg(r.seat) + '</span>' +
        '<span class="rank-name">' + esc(p.name) +
        '<small>' + (p.isAI ? 'AI' : '你') + ' · 剩 ' + r.handLeft + ' 张 · 本季胜场 ' + r.seasonWins + '</small></span>' +
        '<span class="rank-delta ' + dcls + '">' + (r.delta > 0 ? '+' + r.delta : String(r.delta)) + '</span>' +
        '<span class="rank-total">' + r.score + '<small>总分</small></span>' +
        '</div>';
    }).join('');

    const winner = st.players[s.winner];
    const last = st.players[s.lastPlace];
    const sub = st.gameOver
      ? '本季结束后，整场比赛结束。'
      : '下赛季主持人：<b>' + esc(last.name) + '</b>（本季最后一名）。';

    const body = '<div class="season-hero">' + confettiHTML(12) +
      '<div class="sh-kicker">SEASON ' + s.season + ' RESULT</div>' +
      '<div class="sh-title">第 ' + s.season + ' 赛季结算</div>' +
      '<div class="sh-sub">本季冠军：<b>' + esc(winner.name) + '</b></div>' +
      '</div>' +
      '<div class="rank-list">' + rows + '</div>' +
      '<p class="season-note">第 1 名 +2 金 · 第 2 名 +1 银 · 最后一名 −1 黑；中间名次 0 分。' +
      (st.playerCount === 2 ? '2 人局没有银牌。' : '') + '<br>' + sub + '</p>';

    const foot = st.gameOver
      ? '<button class="btn btn-primary" id="m-finish">查看终局</button>'
      : '<button class="btn btn-primary" id="m-next">进入第 ' + (st.season + 1) + ' 赛季</button>';

    openModal({ title: '赛季结算', body: body, foot: foot, closable: false });

    const next = document.getElementById('m-next');
    if (next) {
      next.onclick = function () {
        const cur = app.st;
        if (!cur) return;
        const res = M.nextSeason(cur);
        if (!res.ok) return toast(res.error);
        closeModal(true);
        saveGame();
        app.focus = null;
        app.dealSeason = null;
        SFX.play('deal');
        renderGame();
        schedule(300);
      };
    }
    const fin = document.getElementById('m-finish');
    if (fin) fin.onclick = function () { closeModal(true); finishAndShow(); };

    SFX.play('season');
  }

  function recordStats() {
    const st = app.st;
    if (!st || !st.result) return;
    const won = st.result.winnerIds.indexOf(0) >= 0;
    const s = app.stats;
    s.games += 1;
    if (won) s.wins += 1;
    s.seasons += st.season;
    const key = String(st.playerCount);
    if (!s.byCount[key]) s.byCount[key] = { games: 0, wins: 0 };
    s.byCount[key].games += 1;
    if (won) s.byCount[key].wins += 1;
    writeJSON(LS.stats, s);
  }

  function finishAndShow() {
    const st = app.st;
    if (!st) return;
    const res = M.finishGame(st);
    if (!res.ok) return toast(res.error);
    recordStats();
    clearGameSave();
    renderGame();
    showResult();
  }

  function showResult() {
    const st = app.st;
    if (!st || st.phase !== 'gameEnd' || !st.result) return;
    clearTimer();
    const r = st.result;
    const iWin = r.winnerIds.indexOf(0) >= 0;
    const names = r.winnerIds.map(function (id) { return st.players[id].name; }).join(' / ');
    const title = r.winnerIds.length > 1 ? '并列冠军' : (iWin ? '你赢下了比赛' : '比赛结束');
    const champSub = r.winnerIds.length > 1 ? names : (iWin ? names + ' · 面具腰带得主' : '冠军：' + names);

    const rows = r.rows.map(function (row) {
      return '<tr class="' + (row.seat === 0 ? 'is-me' : '') + '">' +
        '<td class="num">' + row.rank + '</td>' +
        '<td><span class="rt-name"><span class="rt-avatar">' +
        seatIconSvg(row.seat) + '</span>' + esc(row.name) + '</span></td>' +
        '<td class="num">' + row.score + '</td>' +
        '<td class="num">' + row.gold + '/' + row.silver + '/' + row.black + '</td>' +
        '<td class="num">' + row.wins + '</td>' +
        '</tr>';
    }).join('');

    const body = '<div class="champ">' + confettiHTML(26) +
      '<svg class="champ-belt" viewBox="0 0 64 40" aria-hidden="true"><use href="#belt"/></svg>' +
      '<div class="champ-title">' + esc(title) + '</div>' +
      '<div class="champ-sub">' + esc(champSub) + '</div>' +
      '</div>' +
      '<table class="result-table">' +
      '<thead><tr><th>#</th><th>经纪人</th><th>总分</th><th>金/银/黑</th><th>赛季胜</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="season-note">3~6 人局先比总分，再比金牌，再比最后赛季冠军，仍相同则并列；2 人局先赢 3 个赛季。</p>';

    const foot = '<button class="btn btn-ghost" id="m-result-setup">调整人数</button>' +
      '<button class="btn btn-ghost" id="m-result-home">返回首页</button>' +
      '<button class="btn btn-primary" id="m-result-again">再来一局</button>';

    openModal({ title: '比赛结束', body: body, foot: foot, closable: false });

    document.getElementById('m-result-again').onclick = function () {
      const cur = app.st;
      const count = cur ? cur.playerCount - 1 : app.config.aiCount;
      const name = cur ? cur.players[0].name : app.config.name;
      closeModal(true);
      startNewGame(count, name);
    };
    document.getElementById('m-result-setup').onclick = function () {
      if (app.st) app.config.name = app.st.players[0].name;
      closeModal(true);
      clearTimer();
      app.st = null;
      goSetup();
    };
    document.getElementById('m-result-home').onclick = function () {
      closeModal(true);
      toHome();
    };

    SFX.play(iWin ? 'win' : 'season');
  }

  /* ================= 弹窗内容 ================= */

  function openRules() {
    const colors = M.COLOR_KEYS.map(function (k, i) {
      return '<span class="rule-color" style="--cc:var(--c-' + k + ')">' +
        maskSvg(k, 'rc-mask', 'color:var(--c-' + k + ')') +
        '<span>' + M.COLOR_NAMES[i] + '</span>' +
        '<span class="rc-sym">' + M.COLOR_SYMBOLS[i] + '</span></span>';
    }).join('');

    const body = '<p>你扮演<b>经纪人</b>，安排六色摔跤手上场。</p>' +
      '<h3>目标</h3>' +
      '<p>赛季结束时，<b>最先打空手牌</b>的经纪人名次最高。只剩一人还留有手牌时，赛季结束。</p>' +
      '<h3>六种颜色</h3><div class="rule-colors">' + colors + '</div>' +
      '<h3>每回合怎么打</h3><ul>' +
      '<li><b>主持人</b>先出 <b>1 张</b>，并给这个颜色放下力量标志。同色完全等价，没有花色大小。</li>' +
      '<li>其他人<b>不能出同色</b>，按顺时针跟牌或跳过；跳过本回合后不再行动。</li>' +
      '<li>已知强于台面颜色：出<b>同样张数</b>；关系未定：多出 <b>1 张</b>，并确立「你强于它」。</li>' +
      '<li>一次最多出 <b>3 张</b>；跟不了就跳过。最后出牌的人主持下一回合。</li>' +
      '</ul>' +
      '<h3>力量关系怎么界定</h3>' +
      '<p>第一次出现的颜色单独成列；新关系会把强者放到弱者上方。跨列且没有传递关系 = 未定。' +
      '传递关系一旦建立，会同时更新所有相关比较。</p>' +
      '<h3>赛季与计分</h3><ul>' +
      '<li>每季第 1 名 <b>+2 金</b>，第 2 名 <b>+1 银</b>（2 人局没有银），最后一名 <b>−1 黑</b>；中间名次 0 分。</li>' +
      '<li>最后一名在下季先出（主持）。</li>' +
      '<li>2 人局：先赢 <b>3 个赛季</b>。3~6 人局：<b>4 个赛季</b>后总分最高者胜；平局比金牌，金牌一致则看谁最后赛季冠军，都不是则并列第一。</li>' +
      '<li>手牌：2~4 人 15 张，5 人 12 张，6 人 10 张；发剩的牌本季不参与。</li>' +
      '</ul>';

    openModal({ title: '玩法规则', body: body, foot: closeFoot('知道了') });
  }

  function openMatrix() {
    const st = app.st;
    if (!st) {
      openModal({
        title: '力量关系表',
        body: '<p>还没有对局。第一张牌落下后，这里会记录所有已知的两两关系。</p>',
        foot: closeFoot('知道了'),
      });
      return;
    }
    const head = M.COLOR_KEYS.map(function (k, i) {
      return '<th style="color:var(--c-' + k + ')" title="' + M.COLOR_NAMES[i] + '">' + M.COLOR_SYMBOLS[i] + '</th>';
    }).join('');
    const rows = M.COLOR_KEYS.map(function (k, i) {
      const cells = M.COLOR_KEYS.map(function (_, j) {
        if (i === j) return '<td class="self">—</td>';
        if (st.relation[i][j]) return '<td class="yes">✓</td>';
        if (st.relation[j][i]) return '<td class="no">✗</td>';
        return '<td class="maybe">?</td>';
      }).join('');
      return '<tr' + (app.focus === i ? ' class="is-focus"' : '') + '>' +
        '<th style="color:var(--c-' + k + ')" title="' + M.COLOR_NAMES[i] + '">' + M.COLOR_SYMBOLS[i] + '</th>' +
        cells + '</tr>';
    }).join('');

    const body = '<div class="matrix-wrap"><table class="matrix">' +
      '<thead><tr><th class="corner">行 &gt; 列</th>' + head + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="matrix-legend">' +
      '<span><i class="yes">✓</i> 行强于列</span>' +
      '<span><i class="no">✗</i> 行弱于列</span>' +
      '<span><i>?</i> 未定</span>' +
      '</div>' +
      '<p class="season-note">关系具有传递性：若 A &gt; B 且 B &gt; C，则 A &gt; C。空白只代表还没被打出来。</p>';

    openModal({ title: '力量关系表', body: body, foot: closeFoot('关闭') });
  }

  function openLog() {
    const st = app.st;
    if (!st || !st.log.length) {
      openModal({
        title: '对局日志',
        body: '<div class="log-empty">还没有对局记录。</div>',
        foot: closeFoot('关闭'),
      });
      return;
    }
    const body = '<div class="log-list" id="log-list">' + st.log.map(function (line) {
      let cls = '';
      if (line.indexOf('赛季') >= 0) cls = 'is-season';
      else if (line.indexOf('回合') >= 0) cls = 'is-round';
      else if (line.indexOf('未定：') >= 0) cls = 'is-rel';
      if (line.indexOf('打空手牌') >= 0) cls = 'is-finish';
      if (/跳过$/.test(line)) cls = 'is-pass';
      return '<div class="log-line ' + cls + '">' + esc(line) + '</div>';
    }).join('') + '</div>';
    openModal({ title: '对局日志', body: body, foot: closeFoot('关闭') });
    const list = document.getElementById('log-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  function openStats() {
    const s = app.stats;
    const rate = s.games ? Math.round(s.wins / s.games * 100) : 0;
    const boxes = '<div class="stats-grid">' +
      '<div class="stat-box"><b>' + s.games + '</b><span>完整对局</span></div>' +
      '<div class="stat-box"><b>' + s.wins + '</b><span>夺冠次数</span></div>' +
      '<div class="stat-box"><b>' + rate + '%</b><span>夺冠率</span></div>' +
      '</div>';

    const keys = Object.keys(s.byCount).filter(function (k) { return s.byCount[k] && s.byCount[k].games > 0; })
      .sort(function (a, b) { return Number(a) - Number(b); });
    const rows = keys.map(function (k) {
      const b = s.byCount[k];
      const r = b.games ? Math.round(b.wins / b.games * 100) : 0;
      return '<tr><td>' + k + ' 人局</td><td>' + b.games + '</td><td>' + b.wins + '</td><td>' + r + '%</td></tr>';
    }).join('');

    const body = boxes +
      (keys.length
        ? '<h3>按人数</h3><table class="count-table"><thead><tr><th>人数</th><th>局数</th><th>夺冠</th><th>胜率</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p>还没有完整打完的比赛。打完一局后，这里会累积你的战绩。</p>') +
      '<p class="season-note">只统计完整结束的比赛；数据保存在这台设备上。累计完成 ' + (s.seasons || 0) + ' 个赛季。</p>';

    openModal({ title: '战绩', body: body, foot: closeFoot('关闭') });
  }

  /* ================= 事件 ================= */

  function bindEvents() {
    $('#btn-start').addEventListener('click', function () { SFX.play('tap'); goSetup(); });
    $('#btn-continue').addEventListener('click', function () { SFX.play('tap'); resumeGame(); });

    $('#ai-count').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-count]');
      if (!b) return;
      app.setupCount = Number(b.dataset.count);
      SFX.play('tap');
      renderSetup();
    });

    $('#player-name').addEventListener('input', renderRoster);
    $('#player-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); beginFromSetup(); }
    });

    $('#btn-setup-back').addEventListener('click', function () {
      SFX.play('tap');
      renderHome();
      show('home');
    });
    $('#btn-setup-start').addEventListener('click', function () { SFX.play('tap'); beginFromSetup(); });

    $('#btn-home').addEventListener('click', confirmExit);
    $('#btn-exit').addEventListener('click', confirmExit);

    $('#btn-sound').addEventListener('click', function () {
      app.config.muted = !app.config.muted;
      writeJSON(LS.config, app.config);
      SFX.setMuted(app.config.muted);
      renderSoundIcon();
      if (!app.config.muted) SFX.play('tap');
    });

    $('#hand').addEventListener('click', function (e) {
      const card = e.target.closest('.hand-card');
      if (!card) return;
      humanPlay(Number(card.dataset.color));
    });

    $('#board').addEventListener('click', function (e) {
      const mk = e.target.closest('.marker');
      if (!mk) return;
      setFocus(Number(mk.dataset.color));
    });

    $('#board-foot').addEventListener('click', function (e) {
      if (e.target.closest('.focus-clear')) setFocus(null);
    });

    $('#btn-pass').addEventListener('click', humanPass);

    document.addEventListener('click', function (e) {
      const el = e.target.closest('[data-open]');
      if (!el) return;
      SFX.play('tap');
      const name = el.dataset.open;
      if (name === 'rules') openRules();
      else if (name === 'matrix') openMatrix();
      else if (name === 'log') openLog();
      else if (name === 'stats') openStats();
    });

    $('#modal-close').addEventListener('click', function () { closeModal(); });
    $('#modal-foot').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
    });
    $('#overlay').addEventListener('click', function (e) {
      const ov = $('#overlay');
      if (e.target === ov && ov.dataset.closable === '1') closeModal();
    });

    document.addEventListener('keydown', function (e) {
      const ov = $('#overlay');
      if (!ov.hidden) {
        if (e.key === 'Escape' && ov.dataset.closable === '1') {
          e.preventDefault();
          closeModal();
        }
        return;
      }
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const st = app.st;
      if (app.screen !== 'game' || !st) return;

      if (e.key === 'r' || e.key === 'R') { openRules(); return; }
      if (e.key === 'l' || e.key === 'L') { openLog(); return; }
      if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
        if (st.phase === 'playing' && st.turn === 0 && !st.players[0].passed && !st.players[0].out) {
          e.preventDefault();
          humanPass();
        }
        return;
      }
      if (/^[1-6]$/.test(e.key)) {
        if (st.phase === 'playing' && st.turn === 0 && !st.players[0].passed && !st.players[0].out) {
          e.preventDefault();
          humanPlay(parseInt(e.key, 10) - 1);
        }
      }
    });
  }

  function setFocus(c) {
    app.focus = (c == null || app.focus === c) ? null : c;
    if (app.st) {
      renderBoard(app.st);
      renderHand(app.st);
    }
    SFX.play('tap');
  }

  /* ================= 启动 ================= */

  function init() {
    const cfg = readJSON(LS.config);
    if (cfg && typeof cfg === 'object') {
      app.config.name = sanitizeName(cfg.name);
      app.config.aiCount = Math.max(1, Math.min(5, cfg.aiCount | 0)) || 1;
      app.config.muted = !!cfg.muted;
    }
    const stt = readJSON(LS.stats);
    if (stt && typeof stt === 'object') {
      app.stats.games = Math.max(0, stt.games | 0);
      app.stats.wins = Math.max(0, stt.wins | 0);
      app.stats.seasons = Math.max(0, stt.seasons | 0);
      app.stats.byCount = stt.byCount && typeof stt.byCount === 'object' ? stt.byCount : {};
    }
    SFX.setMuted(app.config.muted);
    bindEvents();
    renderSoundIcon();
    renderHome();
    show('home');
    root.__maskmen = {
      app: app, M: M, AI: AI, renderGame: renderGame, humanPlay: humanPlay, humanPass: humanPass,
      showSeason: showSeason, showResult: showResult, openRules: openRules, openMatrix: openMatrix,
      openLog: openLog, openStats: openStats,
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);