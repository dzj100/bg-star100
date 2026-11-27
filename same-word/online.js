/**
 * online.js — 同词相遇 联机控制器（window.SWN）
 *
 * 只负责房间 / 座位 / 状态同步；不渲染 DOM、不拼 HTML。
 * 依赖：net.js（Supabase 通信）、game.js（SWG.mergeState / markDeparted）
 *
 * 与 take-time 的关键差异：
 *  - 移除「只有当前回合玩家可推」守卫与「本人操作时忽略远端」，任何在座玩家都可推自己的字段；
 *  - 写入前 SWG.mergeState(local, remote, {seat, isHost})，rev = remote.rev+1 + expectRev 条件更新，
 *    冲突重读重合并最多 3 次；
 *  - 离席：不做代打，房主 markDeparted 后推送；房主离开 = 房间解散；
 *  - 倒计时完全在 game/UI（hostTick + hostNow），本文件不含任何倒计时逻辑。
 */

(function () {
  'use strict';

  const POLL_MS = 2500;          // 等候室与对局统一 2.5s 兜底（对局 15s 短轮次需要更快）
  const RESUB_MS = 2000;         // 频道异常后重订阅延迟
  const RETRY_MS = [200, 500, 1000]; // rev 冲突 / 传输失败退避
  const STALE_TS_MS = 3000;      // 无 rev 时的时钟容差
  const DEFAULT_PENDING = { mode: 'duel', timeLimit: 0, roundLimit: 10 };
  const TIME_OPTIONS = [0, 15, 30, 60];
  const MIN_ROUNDS = 5;
  const MAX_ROUNDS = 50;
  const WAIT_DEBOUNCE_MS = 160;

  const _cfg = {
    sessionKey: 'sameword-online',
    prefsKey: 'sameword-prefs',
    title: '同词相遇',
    maxPlayers: 4,
  };

  const _hooks = {
    getState: null,
    onWaiting: null,
    onState: null,
    onClosed: null,
    onPlayerLeft: null,
    onNet: null,
  };

  // ── 房间 / 座位 ──
  let _room = null;            // 4 位短房号
  let _seat = null;
  let _isHost = false;
  let _name = '';
  let _status = 'waiting';
  let _lastRoom = null;        // 最近一次房间行（供 getRoomView / seats）
  let _seatNames = Object.create(null); // seatIndex → name（离席检测）
  const _leaves = new Set();   // 已处理的离席座位

  // ── 网络 ──
  let _unsub = null;
  let _channelStatus = null;
  let _resubTimer = null;
  let _pollTimer = null;
  let _netOnline = null;       // null=未知
  let _closed = false;

  // ── 新鲜度（rev 为主，_ts/_pushId 去重） ──
  let _lastRev = 0;
  let _lastTs = 0;
  let _lastPushId = null;
  const _myPushes = new Set();
  let _pushSeq = 0;

  // ── 节流 / 串行化 ──
  let _resyncing = false;
  let _lastResyncAt = 0;
  let _lastRecoverAt = 0;
  let _fixTimer = null;
  let _pushTail = Promise.resolve();
  let _waitingSig = '';
  let _waitQueued = null;
  let _waitFlush = null;
  let _lifecycleBound = false;

  /* ============================================================
     小工具
     ============================================================ */

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function _emit(name) {
    const fn = _hooks[name];
    if (typeof fn !== 'function') return;
    const args = Array.prototype.slice.call(arguments, 1);
    try { fn.apply(null, args); } catch (e) { console.error('[SWN] hook ' + name + ' threw:', e); }
  }

  function _getLocalState() {
    if (typeof _hooks.getState !== 'function') return null;
    try { return _hooks.getState() || null; } catch (e) { console.warn('[SWN] getState threw:', e); return null; }
  }

  function _merge(local, remote) {
    const G = window.SWG;
    if (!remote) return local;
    if (!local) return remote;
    if (G && typeof G.mergeState === 'function') {
      try { return G.mergeState(local, remote, { seat: _seat, isHost: _isHost }); }
      catch (e) { console.error('[SWN] SWG.mergeState failed, fallback merge:', e); }
    } else {
      console.warn('[SWN] SWG.mergeState unavailable');
    }
    // 退化：房主保留本地，成员接受远端
    return _isHost ? Object.assign({}, remote, local) : remote;
  }

  function _normTime(v) {
    const n = Number(v);
    return TIME_OPTIONS.indexOf(n) >= 0 ? n : 0;
  }

  function _normRounds(v) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return DEFAULT_PENDING.roundLimit;
    return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, n));
  }

  function _pendingFrom(state) {
    const fallback = { mode: DEFAULT_PENDING.mode, timeLimit: DEFAULT_PENDING.timeLimit, roundLimit: DEFAULT_PENDING.roundLimit };
    if (!state || typeof state !== 'object') return fallback;
    if (state.pending && typeof state.pending === 'object') {
      return {
        mode: state.pending.mode === 'party' ? 'party' : 'duel',
        timeLimit: _normTime(state.pending.timeLimit),
        roundLimit: _normRounds(state.pending.roundLimit),
      };
    }
    if (state.mode) {
      return {
        mode: state.mode === 'party' ? 'party' : 'duel',
        timeLimit: _normTime(state.settings && state.settings.timeLimit),
        roundLimit: _normRounds(state.settings && state.settings.roundLimit),
      };
    }
    return fallback;
  }

  function _sortedSeats(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter(s => s && typeof s.seatIndex === 'number')
      .map(s => ({ seatIndex: s.seatIndex, name: s.name || '' }))
      .sort((a, b) => a.seatIndex - b.seatIndex);
  }

  function _cleanName(raw) {
    const G = window.SWG;
    if (G && typeof G.validateName === 'function') {
      const r = G.validateName(raw);
      if (r && r.ok) return r.name;
      return null;
    }
    const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 12) : null;
  }

  function _makePushId(ts, rev) {
    const seat = _seat === null ? 0 : _seat;
    return seat + '-' + ts.toString(36) + '-' + (++_pushSeq) + '-' + rev;
  }

  /** 在快照上盖 rev/_ts/_pushId（返回新对象） */
  function _stamp(base, rev) {
    const ts = Date.now();
    const out = Object.assign({}, base);
    out.rev = rev;
    out._ts = ts;
    out._pushId = _makePushId(ts, rev);
    return out;
  }

  function _makeWaitingState(pending, rev, seat) {
    const ts = Date.now();
    return {
      schema: 1,
      pending: { mode: pending.mode, timeLimit: pending.timeLimit, roundLimit: pending.roundLimit },
      rev: rev,
      _ts: ts,
      _pushId: (seat || 0) + '-' + ts.toString(36) + '-w-' + rev,
    };
  }

  function _statusFor(state) {
    if (!state || !state.phase) return _status === 'waiting' ? 'waiting' : _status;
    return state.phase === 'finished' ? 'finished' : 'playing';
  }

  /* ============================================================
     会话
     ============================================================ */

  function _roomPrefix() {
    try { return (typeof NET_CONFIG !== 'undefined' && NET_CONFIG.ROOM_PREFIX) || ''; } catch (e) { return ''; }
  }

  function _saveSession() {
    if (!_room) return;
    try {
      localStorage.setItem(_cfg.sessionKey, JSON.stringify({
        room: _room, seat: _seat, name: _name, isHost: _isHost, at: Date.now(),
      }));
    } catch (e) {}
  }

  function _readSession() {
    try {
      const raw = localStorage.getItem(_cfg.sessionKey);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.room) return null;
      return s;
    } catch (e) { return null; }
  }

  function _clearSession() {
    try { localStorage.removeItem(_cfg.sessionKey); } catch (e) {}
  }

  /** 昵称/偏好另存，供创建表单预填（UI 可选读取） */
  function _savePrefs(name, pending) {
    try {
      localStorage.setItem(_cfg.prefsKey, JSON.stringify({
        name: name || _name,
        mode: pending.mode, timeLimit: pending.timeLimit, roundLimit: pending.roundLimit,
      }));
    } catch (e) {}
  }

  /* ============================================================
     生命周期 / 钩子
     ============================================================ */

  function init(opts) {
    const o = opts || {};
    if (o.sessionKey) _cfg.sessionKey = o.sessionKey;
    if (o.title) _cfg.title = o.title;
    if (typeof o.maxPlayers === 'number' && o.maxPlayers > 0) _cfg.maxPlayers = o.maxPlayers;
    _hooks.getState = o.getState || null;
    _hooks.onWaiting = o.onWaiting || null;
    _hooks.onState = o.onState || null;
    _hooks.onClosed = o.onClosed || null;
    _hooks.onPlayerLeft = o.onPlayerLeft || null;
    _hooks.onNet = o.onNet || null;
    _bindLifecycle();
  }

  function _bindLifecycle() {
    if (_lifecycleBound || typeof document === 'undefined') return;
    _lifecycleBound = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') return;
      _recover();
    });
    window.addEventListener('online', function () { _recover(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted) _recover(); });
  }

  function _recover() {
    if (!_room || _closed) return;
    const now = Date.now();
    if (now - _lastRecoverAt < 1500) return; // visibilitychange 可能连发
    _lastRecoverAt = now;
    _subscribe();
    _resync(true);
  }

  /* ============================================================
     内部状态维护
     ============================================================ */

  function _setup(code, seat, isHost, name, status, row) {
    _room = code;
    _seat = seat;
    _isHost = !!isHost;
    _name = name || '';
    _status = status || 'waiting';
    _lastRoom = row || null;
    _seatNames = Object.create(null);
    _leaves.clear();
    _lastRev = 0;
    _lastTs = 0;
    _lastPushId = null;
    _myPushes.clear();
    _pushSeq = 0;
    _waitingSig = '';
    _waitQueued = null;
    _waitFlush = null;
    _closed = false;
    if (row && Array.isArray(row.seats)) {
      row.seats.forEach(function (s) {
        if (s && typeof s.seatIndex === 'number') _seatNames[s.seatIndex] = s.name || '';
      });
    }
    if (row && row.state) {
      _lastRev = Number(row.state.rev) || 0;
      _lastTs = Number(row.state._ts) || 0;
    }
  }

  function _teardown() {
    _stopSubscription();
    _stopTimers();
    if (_fixTimer) { clearTimeout(_fixTimer); _fixTimer = null; }
    _room = null;
    _seat = null;
    _isHost = false;
    _name = '';
    _status = 'waiting';
    _lastRoom = null;
    _seatNames = Object.create(null);
    _leaves.clear();
    _channelStatus = null;
    _netOnline = null;
    _lastRev = 0;
    _lastTs = 0;
    _lastPushId = null;
    _myPushes.clear();
    _pushSeq = 0;
    _waitingSig = '';
    _waitQueued = null;
    _waitFlush = null;
    _resyncing = false;
    _lastResyncAt = 0;
    _lastRecoverAt = 0;
    _closed = false;
    // 会话结束属于主动收尾，静默复位连接状态，避免“重连中”横幅常驻
    _netOnline = true;
    _emit('onNet', true, true);
    _clearSession();
  }

  function _trackApplied(state, status) {
    if (!state) return;
    const rev = Number(state.rev) || 0;
    const ts = Number(state._ts) || 0;
    if (rev >= _lastRev) _lastRev = rev;
    if (ts > _lastTs) _lastTs = ts;
    if (state._pushId) {
      _lastPushId = state._pushId;
      _myPushes.add(state._pushId);
      if (_myPushes.size > 120) _myPushes.clear();
    }
    if (status) _status = status;
    if (_lastRoom) {
      _lastRoom.state = state;
      _lastRoom.status = _status;
    }
  }

  function _stale(remote) {
    if (!remote || typeof remote !== 'object') return true;
    if (remote._pushId && _myPushes.has(remote._pushId)) return true; // 自己的回声
    const rev = Number(remote.rev) || 0;
    if (rev && rev < _lastRev) return true;
    if (rev && rev === _lastRev && (!remote._pushId || remote._pushId === _lastPushId)) return true;
    if (!rev && remote._ts && _lastTs && (Number(remote._ts) || 0) < _lastTs - STALE_TS_MS) return true;
    return false;
  }

  function _setNet(v) {
    // 房间已结束后的迟到失败回调不再播报断线（没有可重连的对象）
    if (v === false && (!_room || _closed)) return;
    if (_netOnline === v) return;
    _netOnline = v;
    _emit('onNet', v);
  }

  /* ============================================================
     房间视图
     ============================================================ */

  function getSeats() {
    return _sortedSeats(_lastRoom && _lastRoom.seats);
  }

  function getSeat() { return _seat; }

  function isHost() { return !!(_room && _isHost); }

  function getRoomView() {
    if (!_room) return null;
    const seats = getSeats();
    const pending = _pendingFrom(_lastRoom && _lastRoom.state);
    const hostSeat = seats.filter(function (s) { return s.seatIndex === 0; })[0];
    const maxSeats = Math.min(4, _cfg.maxPlayers);
    const countsOk = pending.mode === 'duel' ? seats.length === 2 : seats.length >= 3;
    return {
      code: _room,
      seat: _seat,
      isHost: _isHost,
      status: _status,
      hostName: hostSeat ? hostSeat.name : '',
      seats: seats,
      pending: pending,
      canStart: !!_isHost && countsOk && seats.length <= maxSeats,
    };
  }

  function _viewSig(view) {
    return [
      view.code, view.seat, view.isHost ? 1 : 0, view.status, view.hostName,
      view.seats.map(function (s) { return s.seatIndex + ':' + s.name; }).join(','),
      view.pending.mode, view.pending.timeLimit, view.pending.roundLimit,
      view.canStart ? 1 : 0,
    ].join('|');
  }

  function _emitWaiting(row) {
    if (!_room) return;
    if (row) _lastRoom = row;
    const view = getRoomView();
    if (!view) return;
    const sig = _viewSig(view);
    if (sig === _waitingSig) return;
    _waitingSig = sig;
    _emit('onWaiting', view);
  }

  /* ============================================================
     远端应用
     ============================================================ */

  /** 远端覆盖了房主字段（成员用旧快照写入）→ 稍后补推 */
  function _maybeHostDrift(local, remote) {
    if (!_isHost || !local || !local.phase || !remote || !remote.phase) return;
    const keys = ['phase', 'round', 'gameNo', 'result', 'deadline'];
    let drift = false;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (local[k] !== remote[k]) { drift = true; break; }
    }
    if (drift) _scheduleRepush('host fields drifted');
  }

  function _scheduleRepush(reason) {
    if (_fixTimer || !_room || _closed) return;
    console.warn('[SWN] schedule re-push:', reason);
    _fixTimer = setTimeout(function () {
      _fixTimer = null;
      if (!_room || _closed) return;
      pushState(_getLocalState());
    }, 600);
  }

  /* 别的端用旧快照写入时，自己刚做的动作（出词/表态/认证/准备）可能从远端消失：
     本地合并后仍保留，此时补推一次把「自己的字段」写回去（按 at 比较，幂等） */
  function _ownMismatch(merged, remote) {
    if (_seat === null || !merged || !remote) return false;
    var s = _seat;
    var at = function (v) { return v && typeof v === 'object' ? (Number(v.at) || 0) : 0; };
    var keys = ['subs', 'ready', 'decisions'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var a = merged[k] && merged[k][s];
      var b = remote[k] && remote[k][s];
      if (a && at(a) > at(b)) return true;
    }
    var ca = (merged.claims && merged.claims[s]) || {};
    var cb = (remote.claims && remote.claims[s]) || {};
    var tos = Object.keys(ca);
    for (var j = 0; j < tos.length; j++) {
      var t = tos[j];
      if (ca[t] && at(ca[t]) > at(cb[t])) return true;
    }
    return false;
  }

  function _applyRemote(remote, status, force) {
    if (!remote || typeof remote !== 'object') return;

    // 远端被旧快照覆盖（降级路径下可能发生）：不应用，稍后补推本地
    const rev = Number(remote.rev) || 0;
    if (_lastRev && rev && rev < _lastRev) {
      console.warn('[SWN] remote rev', rev, '< local', _lastRev, '→ re-push local');
      _scheduleRepush('remote rev regression');
      return;
    }

    if (!force && _stale(remote)) return;

    const local = _getLocalState();
    let merged;
    if (local && local.phase) {
      merged = _merge(local, remote);
      if (_isHost) _maybeHostDrift(local, remote);
      else if (_ownMismatch(merged, remote)) _scheduleRepush('own fields missing remotely');
    } else {
      merged = remote; // 刷新恢复 / 尚无本地状态
    }
    if (!merged) return;
    if (merged._pushId && merged._pushId === _lastPushId) return; // 已应用，避免重复渲染

    _trackApplied(merged, status || _status);
    _emit('onState', merged, { status: _status });
  }

  /* ============================================================
     房间行处理：离席 / 解散 / 等待室 / 对局
     ============================================================ */

  function _handleRow(row, force) {
    if (!_room || _closed) return;
    if (!row) { _close('not-found'); return; }

    _lastRoom = row;
    if (!_syncSeats(row)) return; // 内部可能已触发 close

    if (row.status === 'finished') {
      const st = row.state;
      if (!st) { _close('host-left'); return; }            // 房主离席且状态清空
      if (st.closed) { _close(st.closed === 'host-left' ? 'host-left' : 'closed'); return; }
      _status = 'finished';
      _applyRemote(st, 'finished', !!force);
      return;
    }

    if (row.status === 'waiting') {
      if (_status !== 'waiting') _waitingSig = '';
      _status = 'waiting';
      if (row.state) _trackApplied(row.state, 'waiting');
      _emitWaiting(row);
      return;
    }

    if (row.status === 'playing') {
      _status = 'playing';
      if (row.state) _applyRemote(row.state, 'playing', !!force);
    }
  }

  /**
   * 座位跟踪（实时与轮询共用）
   * @returns {boolean} false 表示房间已按离席/解散关闭
   */
  function _syncSeats(row) {
    if (!Array.isArray(row.seats)) return true;
    const prev = _seatNames;
    const cur = Object.create(null);
    row.seats.forEach(function (s) {
      if (s && typeof s.seatIndex === 'number') cur[s.seatIndex] = s.name || '';
    });

    const removed = [];
    Object.keys(prev).forEach(function (k) {
      const idx = Number(k);
      if (!(idx in cur)) removed.push({ seat: idx, name: prev[k] });
    });
    _seatNames = cur;

    // 房主离席 = 房间解散（房主关闭写入失败、退回移除 seat0 时的兜底）
    if (!_isHost && !(0 in cur)) { _close('host-left'); return false; }
    // 自己的座位被移除（房主清房 / 房间被复用）
    if (_seat !== null && !(_seat in cur)) { _close('not-found'); return false; }

    for (let i = 0; i < removed.length; i++) {
      const it = removed[i];
      if (it.seat === _seat) continue;
      if (_leaves.has(it.seat)) continue;
      _leaves.add(it.seat);
      _onSeatLeft(it.seat, it.name);
    }
    // 座位被复用 → 允许再次触发离席
    Object.keys(cur).forEach(function (k) {
      const idx = Number(k);
      if (!(idx in prev)) _leaves.delete(idx);
    });
    return true;
  }

  function _onSeatLeft(seat, name) {
    const info = { name: name || ('座位 ' + (seat + 1)), seat: seat, isHost: seat === 0 };
    console.log('[SWN] player left:', info);
    _emit('onPlayerLeft', info);

    if (!_isHost) return;                 // 成员只 toast，由房主统一处理
    if (_status === 'waiting') return;    // 等待室：仅刷新座位即可

    const G = window.SWG;
    const st = _getLocalState();
    if (!st) return;
    if (G && typeof G.markDeparted === 'function') {
      try { G.markDeparted(st, seat, Date.now()); }
      catch (e) { console.warn('[SWN] SWG.markDeparted failed:', e); return; }
    }
    pushState(st).then(function (r) {
      if (!r || !r.ok) console.warn('[SWN] markDeparted push failed, polling will resync');
    });
  }

  /* ============================================================
     关闭 / 拉取 / 轮询 / 订阅
     ============================================================ */

  function _close(reason) {
    if (_closed) return;
    console.log('[SWN] room closed:', reason);
    _teardown();
    _closed = true;
    _emit('onClosed', reason);
  }

  async function _fetchRoom() {
    try {
      return await netGetRoom(_room);
    } catch (e) {
      const code = e && e.code;
      const msg = String((e && e.message) || '');
      if (code === 'PGRST116' || /no rows|0 rows/i.test(msg)) return null;
      throw e;
    }
  }

  async function _resync(force) {
    if (!_room || _closed || _resyncing) return;
    const now = Date.now();
    if (!force && now - _lastResyncAt < 800) return; // 限频
    _resyncing = true;
    _lastResyncAt = now;
    try {
      const room = await _fetchRoom();
      if (!_room || _closed) return;
      if (!room) { _close('not-found'); return; }
      _setNet(true);
      _handleRow(room, force);
    } catch (e) {
      console.warn('[SWN] resync failed:', (e && e.message) || e);
      _setNet(false);
    } finally {
      _resyncing = false;
    }
  }

  function _startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(function () {
      // 不按 visibility 跳过：真后台时浏览器本就节流定时器；
      // 而 visibilityState 一旦滞留 hidden 会让轮询永久停摆。
      _resync(false);
    }, POLL_MS);
  }

  function _stopTimers() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_resubTimer) { clearTimeout(_resubTimer); _resubTimer = null; }
  }

  function _stopSubscription() {
    if (_unsub) {
      try { _unsub(); } catch (e) {}
      _unsub = null;
    }
  }

  function _subscribe() {
    if (!_room) return;
    _stopSubscription();
    _channelStatus = 'CONNECTING';
    _unsub = netSubscribeRoom(_room, function (row) {
      if (_closed) return;
      _setNet(true);
      if (!row) { _close('not-found'); return; }
      _handleRow(row, false);
    }, function (status) {
      _channelStatus = status;
      if (status === 'SUBSCRIBED') {
        _setNet(true);
        _resync(false); // 断线期间的事件不会重放，订阅成功即补拉一次
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        _setNet(false);
        _scheduleResubscribe();
      }
    });
  }

  function _scheduleResubscribe() {
    if (_resubTimer || !_room || _closed) return;
    _resubTimer = setTimeout(function () {
      _resubTimer = null;
      if (!_room || _closed) return;
      if (_channelStatus === 'SUBSCRIBED') return;
      console.warn('[SWN] realtime unhealthy, resubscribe');
      _subscribe();
    }, RESUB_MS);
  }

  /* ============================================================
     创建 / 加入 / 恢复
     ============================================================ */

  async function createRoom(opts) {
    const o = opts || {};
    const name = _cleanName(o.name);
    if (!name) throw new Error('请输入1~12字的昵称');
    const mode = o.mode === 'party' ? 'party' : 'duel';
    const pending = {
      mode: mode,
      timeLimit: _normTime(o.timeLimit),
      roundLimit: _normRounds(o.roundLimit),
    };
    const waitingState = _makeWaitingState(pending, 1, 0);

    const code = await netCreateRoom(name, waitingState, 'waiting');

    _teardown();
    const row = {
      id: _roomPrefix() + code,
      host_name: name,
      status: 'waiting',
      seats: [{ name: name, seatIndex: 0 }],
      state: waitingState,
    };
    _setup(code, 0, true, name, 'waiting', row);
    _saveSession();
    _savePrefs(name, pending);
    _subscribe();
    _startPolling();
    _emitWaiting(row);
    console.log('[SWN] room created:', code);
    return { code: code, seat: 0 };
  }

  async function joinRoom(opts) {
    const o = opts || {};
    const code = String(o.code == null ? '' : o.code).trim();
    if (!/^\d{4}$/.test(code)) throw new Error('请输入4位房间号');
    const name = _cleanName(o.name);
    if (!name) throw new Error('请输入1~12字的昵称');

    const res = await netJoinRoom(code, name); // 未开局 / 未满 / 双人房已满 均在 net 层拒绝
    const row = res.room || {};

    _teardown();
    const status = row.status === 'playing' ? 'playing'
      : (row.status === 'finished' ? 'finished' : 'waiting');
    _setup(code, res.seatIndex, false, name, status, row);
    _saveSession();
    _savePrefs(name, _pendingFrom(row.state));
    _subscribe();
    _startPolling();

    if (status === 'waiting') _emitWaiting(row);
    else if (row.state) _applyRemote(row.state, status, true);
    console.log('[SWN] joined room', code, 'seat', res.seatIndex);
    return { seat: res.seatIndex };
  }

  async function tryRestore() {
    const saved = _readSession();
    if (!saved) return false;

    let room = null;
    try {
      room = await netGetRoom(saved.room);
    } catch (e) {
      console.warn('[SWN] restore: room fetch failed', (e && e.message) || e);
      if (e && (e.code === 'PGRST116' || /no rows|0 rows/i.test(String(e.message || '')))) _clearSession();
      return false; // 网络错误时保留会话，下次刷新再试
    }
    if (!room) { _clearSession(); return false; }
    if (!Array.isArray(room.seats) || !room.seats.some(function (s) { return s && s.seatIndex === saved.seat; })) {
      _clearSession();
      return false;
    }
    if (room.status === 'finished' && (!room.state || (room.state && room.state.closed))) {
      _clearSession();
      return false;
    }

    const seatRow = room.seats.filter(function (s) { return s && s.seatIndex === saved.seat; })[0];
    const name = saved.name || (seatRow && seatRow.name) || '';

    _teardown();
    const status = room.status === 'playing' ? 'playing'
      : (room.status === 'finished' ? 'finished' : 'waiting');
    _setup(saved.room, saved.seat, saved.seat === 0, name, status, room);
    _saveSession();
    _subscribe();
    _startPolling();

    console.log('[SWN] session restored', saved.room, 'seat', saved.seat, 'status', status);
    if (status === 'waiting') _emitWaiting(room);
    else if (room.state) _applyRemote(room.state, status, true);
    return true;
  }

  /* ============================================================
     写状态：merge → rev+1 → 条件更新 → 冲突重试
     ============================================================ */

  async function _pushOnce(input) {
    if (!_room || _seat === null) return { ok: false, state: input };
    const base = input || _getLocalState();
    if (!base) return { ok: false, state: base };

    const waitingMode = _status === 'waiting' || !base.phase;
    let last = base;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await _sleep(RETRY_MS[Math.min(attempt - 1, RETRY_MS.length - 1)]);

      let room;
      try { room = await _fetchRoom(); }
      catch (e) { console.warn('[SWN] push read failed:', (e && e.message) || e); _setNet(false); continue; }
      if (!room) return { ok: false, state: last };

      const remote = (room.state && typeof room.state === 'object') ? room.state : null;
      const expectRev = remote && typeof remote.rev === 'number' ? remote.rev : null;

      if (waitingMode) {
        const next = _stamp(last, (expectRev === null ? 0 : expectRev) + 1);
        // 已开局的状态不能被「等待室」推送降级（成员在 status 尚未刷新时提交）
        const wStatus = next.phase ? _statusFor(next) : 'waiting';
        const res = await netUpdateGameState(_room, next, wStatus, expectRev);
        last = next;
        if (res && res.ok) {
          _trackApplied(next, wStatus);
          return { ok: true, state: next };
        }
        if (res && !res.conflict) console.warn('[SWN] waiting push error:', res.error);
        continue;
      }

      const merged = _merge(last, remote);
      const next = _stamp(merged, (expectRev === null ? 0 : expectRev) + 1);
      const status = _statusFor(next);
      const res = await netUpdateGameState(_room, next, status, expectRev);
      last = merged;

      if (res && res.ok) {
        _trackApplied(next, status);
        return { ok: true, state: next };
      }
      if (res && !res.conflict) console.warn('[SWN] push transport error:', res.error);
      else console.log('[SWN] rev conflict, retry', attempt + 1);
    }

    console.warn('[SWN] pushState gave up after 3 attempts (polling will resync)');
    return { ok: false, state: last };
  }

  /** 推送状态（串行化：前一次写完才开始下一次，避免自竞速） */
  function pushState(state) {
    const run = function () { return _pushOnce(state); };
    const p = _pushTail.then(run, run);
    _pushTail = p.then(function () {}, function () {});
    return p;
  }

  async function startGame(state) {
    if (!_room || !_isHost) {
      console.warn('[SWN] startGame: only host can start');
      return false;
    }
    const base = state || _getLocalState();
    if (!base) return false;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await _sleep(RETRY_MS[Math.min(attempt - 1, RETRY_MS.length - 1)]);
      let room;
      try { room = await _fetchRoom(); }
      catch (e) { _setNet(false); continue; }
      if (!room) return false;
      if (room.status === 'playing') return true;   // 重复点击/已开局
      if (room.status === 'finished') return false;

      const expectRev = room.state && typeof room.state.rev === 'number' ? room.state.rev : null;
      const next = _stamp(base, (expectRev === null ? 0 : expectRev) + 1);
      const res = await netUpdateGameState(_room, next, 'playing', expectRev);
      if (res && res.ok) {
        _trackApplied(next, 'playing');
        _waitingSig = '';
        _setNet(true);
        console.log('[SWN] game started');
        return true;
      }
      if (res && !res.conflict) console.warn('[SWN] startGame error:', res.error);
    }
    console.warn('[SWN] startGame failed after retries');
    return false;
  }

  /** 合并快速点击：只在安静一小段时间后写一次，写期间的新改动随后补写 */
  function setWaiting(patch) {
    if (!_room || !_isHost) return Promise.resolve(false);
    _waitQueued = Object.assign(_waitQueued || {}, patch || {});
    if (_waitFlush) return _waitFlush;
    _waitFlush = _sleep(WAIT_DEBOUNCE_MS)
      .then(_flushWaiting)
      .then(function (ok) {
        _waitFlush = null;
        if (_waitQueued) return setWaiting({});
        return ok;
      }, function (e) {
        _waitFlush = null;
        console.warn('[SWN] setWaiting flush failed:', e);
        return false;
      });
    return _waitFlush;
  }

  async function _flushWaiting() {
    let ok = true;
    while (_waitQueued) {
      const p = _waitQueued;
      _waitQueued = null;
      ok = await _writeWaiting(p);
      if (!ok) return false;
    }
    return ok;
  }

  async function _writeWaiting(patch) {
    if (!_room || !_isHost) return false;
    const p = patch || {};

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await _sleep(RETRY_MS[Math.min(attempt - 1, RETRY_MS.length - 1)]);
      let room;
      try { room = await _fetchRoom(); }
      catch (e) { _setNet(false); continue; }
      if (!room || room.status !== 'waiting') return false;

      const cur = _pendingFrom(room.state);
      const nextPending = {
        mode: p.mode === 'party' ? 'party' : (p.mode === 'duel' ? 'duel' : cur.mode),
        timeLimit: p.timeLimit === undefined ? cur.timeLimit : _normTime(p.timeLimit),
        roundLimit: p.roundLimit === undefined ? cur.roundLimit : _normRounds(p.roundLimit),
      };
      const expectRev = room.state && typeof room.state.rev === 'number' ? room.state.rev : null;
      const next = _makeWaitingState(nextPending, (expectRev === null ? 0 : expectRev) + 1, _seat);

      const res = await netUpdateGameState(_room, next, 'waiting', expectRev);
      if (res && res.ok) {
        const row = Object.assign({}, room, { status: 'waiting', state: next });
        _lastRoom = row;
        _trackApplied(next, 'waiting');
        _savePrefs(_name, nextPending);
        _waitingSig = '';
        _emitWaiting(row);
        return true;
      }
      if (res && !res.conflict) console.warn('[SWN] setWaiting error:', res.error);
    }
    return false;
  }

  /* ============================================================
     离席
     ============================================================ */

  async function leave() {
    const room = _room;
    const seat = _seat;
    const wasHost = _isHost;
    const local = _getLocalState();

    if (!room) { _teardown(); return; }
    _closed = true; // 离席已开始，忽略在途轮询的失败回执

    _stopSubscription();
    _stopTimers();
    if (_fixTimer) { clearTimeout(_fixTimer); _fixTimer = null; }

    try {
      if (wasHost) {
        // 房主离开 = 解散：status='finished' + state.closed='host-left'
        let roomRow = null;
        try { roomRow = await netGetRoom(room); } catch (e) {}
        const rev0 = roomRow && roomRow.state && typeof roomRow.state.rev === 'number'
          ? roomRow.state.rev : 0;
        const baseSrc = (local && local.phase) ? local
          : (roomRow && roomRow.state) || { schema: 1, pending: DEFAULT_PENDING };
        let closedState = _stamp(Object.assign({}, baseSrc, { closed: 'host-left' }), rev0 + 1);

        let res = await netUpdateGameState(room, closedState, 'finished', roomRow && roomRow.state ? rev0 : null);
        if (res && res.conflict) {
          let rr = null;
          try { rr = await netGetRoom(room); } catch (e) {}
          const rev1 = rr && rr.state && typeof rr.state.rev === 'number' ? rr.state.rev : rev0 + 1;
          closedState = _stamp(closedState, rev1 + 1);
          res = await netUpdateGameState(room, closedState, 'finished', rev1);
        }
        if (!res || !res.ok) {
          console.warn('[SWN] host close write failed, removing seat 0 instead');
          await netLeaveRoom(room, 0);
        }
      } else if (typeof seat === 'number') {
        await netLeaveRoom(room, seat);
      }
    } catch (e) {
      console.warn('[SWN] leave network failed:', (e && e.message) || e);
    }

    _teardown();
    _closed = true;
    _emit('onClosed', 'left');
  }

  /* ============================================================
     导出
     ============================================================ */

  window.SWN = {
    init: init,
    createRoom: createRoom,
    joinRoom: joinRoom,
    startGame: startGame,
    setWaiting: setWaiting,
    pushState: pushState,
    getRoomView: getRoomView,
    getSeats: getSeats,
    getSeat: getSeat,
    isHost: isHost,
    leave: leave,
    tryRestore: tryRestore,
  };
})();