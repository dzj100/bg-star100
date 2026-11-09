/* 游客行为采集：进入平台 / 打开游戏 / 联机开局 / 联机结算。任何异常静默，不影响游戏。 */
(function () {
  'use strict';
  try {
    if (window.BG && window.BG.__track) return;

    var CFG = {
      url: 'https://smcplxyjjvehbizirvrw.supabase.co',
      anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtY3BseHlqanZlaGJpemlydnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTQyMDgsImV4cCI6MjA5ODYzMDIwOH0.TNkL6gOBMyZIt8mB-b-JBPe7_LgJIHXXtHwOW_Xr0qM'
    };
    var NS = 'bg-star100:';
    var VISITOR_KEY = NS + 'visitor';
    var OLD_TOKEN_KEY = NS + 'feedback-token';
    var SID_KEY = NS + 'sid';
    var SID_TS_KEY = NS + 'sid-ts';
    var SRC_KEY = NS + 'entry-source';
    var LAST_KEY = NS + 'last-game';
    var QUEUE_KEY = NS + 'track-q';
    var ROUND_KEY = NS + 'online-round';
    var SESSION_MS = 30 * 60 * 1000;
    var QUEUE_TTL = 7 * 24 * 3600 * 1000;
    var SEND_MAX = 30;
    var QUEUE_MAX = 100;
    var ROUND_MAX = 6 * 3600 * 1000;
    var DEBUG = /[?&]debug=1\b/.test(location.search || '');
    var ALLOWED = { platform_enter: 1, game_enter: 1, online_start: 1, online_end: 1 };
    var scriptEl = document.currentScript;
    var overrideGame = scriptEl && scriptEl.getAttribute('data-game');
    var overrideMode = scriptEl && scriptEl.getAttribute('data-mode');
    var sending = false;
    var timer = null;
    var fails = 0;

    function store(kind) {
      try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (e) { return null; }
    }
    function get(s, k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
    function set(s, k, v) { try { if (s) s.setItem(k, v); } catch (e) {} }
    function del(s, k) { try { if (s) s.removeItem(k); } catch (e) {} }
    function readJSON(s, k) {
      try { return JSON.parse(get(s, k) || 'null'); } catch (e) { return null; }
    }
    function writeJSON(s, k, v) {
      try { set(s, k, JSON.stringify(v)); } catch (e) {}
    }
    function log() {
      if (!DEBUG) return;
      try { console.log.apply(console, ['[track]'].concat([].slice.call(arguments))); } catch (e) {}
    }
    function http() { return /^https?:$/.test(location.protocol || ''); }
    function nowISO() {
      try { return new Date().toISOString(); } catch (e) { return ''; }
    }
    function uuid() {
      try {
        if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
        var b = new Uint8Array(16);
        window.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        var out = '';
        for (var i = 0; i < 16; i++) {
          if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
          out += ('0' + b[i].toString(16)).slice(-2);
        }
        return out;
      } catch (e) {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      }
    }
    function randomToken() {
      try {
        var b = new Uint8Array(32);
        window.crypto.getRandomValues(b);
        var out = '';
        for (var i = 0; i < b.length; i++) out += ('0' + b[i].toString(16)).slice(-2);
        return out;
      } catch (e) {
        var s = '';
        for (var j = 0; j < 64; j++) s += Math.floor(Math.random() * 16).toString(16);
        return s;
      }
    }
    function visitor() {
      var l = store('local');
      var token = get(l, VISITOR_KEY);
      if (!token || token.length < 32) {
        token = get(l, OLD_TOKEN_KEY);
        if (!token || token.length < 32) token = randomToken();
        set(l, VISITOR_KEY, token);
      }
      return token;
    }
    function session() {
      var s = store('session');
      var sid = get(s, SID_KEY);
      var ts = Number(get(s, SID_TS_KEY)) || 0;
      if (!sid || Date.now() - ts > SESSION_MS) sid = uuid();
      set(s, SID_KEY, sid);
      set(s, SID_TS_KEY, String(Date.now()));
      return sid;
    }
    function refParam() {
      try {
        var m = /[?&]ref=([^&#]+)/.exec(location.search || '');
        return m ? decodeURIComponent(m[1]).slice(0, 20) : '';
      } catch (e) { return ''; }
    }
    function pageInfo() {
      var path = location.pathname || '/';
      var segs = path.split('/').filter(function (x) { return x; });
      var file = segs.length ? segs[segs.length - 1] : 'index.html';
      var home = segs.length === 0 || (segs.length === 1 && /^index\.html$/i.test(file));
      if (home) return { home: true };
      if (!/^index(_ol)?\.html$/i.test(file)) return null;
      var game = overrideGame || (segs.length >= 2 ? segs[segs.length - 2] : '');
      if (!game) return null;
      var online = overrideMode
        ? overrideMode === 'online'
        : (/index_ol\.html$/i.test(file) || game === 'take-time' || game === 'bomb-busters');
      return { home: false, game: game, mode: online ? 'online' : 'solo' };
    }
    function currentGame() {
      var info = pageInfo();
      return info && info.game ? info.game : '';
    }
    function readQueue() {
      var arr = readJSON(store('local'), QUEUE_KEY);
      if (!arr || Object.prototype.toString.call(arr) !== '[object Array]') return [];
      var now = Date.now();
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var e = arr[i];
        if (!e || !e.id || !e.name || !e.ts) continue;
        var t = Date.parse(e.ts);
        if (!t || now - t > QUEUE_TTL) continue;
        out.push(e);
      }
      return out;
    }
    function writeQueue(arr) {
      if (arr.length > QUEUE_MAX) arr = arr.slice(arr.length - QUEUE_MAX);
      writeJSON(store('local'), QUEUE_KEY, arr);
    }
    function enqueue(name, props, game) {
      if (!ALLOWED[name]) return;
      var item = {
        id: uuid(),
        name: name,
        game: (game || '').slice(0, 40),
        props: props && typeof props === 'object' ? props : {},
        ts: nowISO(),
        sid: session()
      };
      var q = readQueue();
      q.push(item);
      writeQueue(q);
      log('queue', item);
      schedule(200);
    }
    function schedule(ms) {
      try {
        clearTimeout(timer);
        timer = setTimeout(function () { flush(false); }, ms || 200);
      } catch (e) {}
    }
    function flush(keepalive) {
      if (sending || !http() || typeof window.fetch !== 'function') return;
      var q = readQueue();
      if (!q.length) return;
      var sid = q[0].sid;
      var batch = [];
      for (var i = 0; i < q.length && batch.length < SEND_MAX; i++) {
        if (q[i].sid === sid) batch.push(q[i]);
      }
      if (!batch.length) return;
      sending = true;
      var release = setTimeout(function () { sending = false; }, 15000);
      var payload = {
        p_token: visitor(),
        p_session: sid,
        p_events: batch.map(function (e) {
          return { id: e.id, name: e.name, game: e.game, props: e.props, ts: e.ts };
        })
      };
      try {
        window.fetch(CFG.url + '/rest/v1/rpc/analytics_track', {
          method: 'POST',
          keepalive: !!keepalive,
          headers: {
            'apikey': CFG.anon,
            'Authorization': 'Bearer ' + CFG.anon,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }).then(function (res) {
          if (!res.ok) throw new Error('http ' + res.status);
          var ids = {};
          batch.forEach(function (e) { ids[e.id] = 1; });
          writeQueue(readQueue().filter(function (e) { return !ids[e.id]; }));
          fails = 0;
          log('sent', batch.length);
        }).catch(function (err) {
          fails++;
          log('send failed', err && err.message);
        }).then(function () {
          clearTimeout(release);
          sending = false;
          if (fails < 5 && readQueue().length) schedule(1500 * fails);
        });
      } catch (e) {
        clearTimeout(release);
        sending = false;
      }
    }
    function onlineRound() {
      var r = readJSON(store('session'), ROUND_KEY);
      return r && r.ts && Date.now() - r.ts < ROUND_MAX ? r : null;
    }
    function onlineStart(players) {
      try {
        if (!http()) return;
        var cur = onlineRound();
        var game = currentGame();
        if (!cur) {
          writeJSON(store('session'), ROUND_KEY, { ts: Date.now(), game: game });
          log('round start', game);
        }
        enqueue('online_start', { players: Number(players) || 0 }, (cur && cur.game) || game);
      } catch (e) {}
    }
    function onlineEnd(result) {
      try {
        var cur = onlineRound();
        if (!cur) return;
        del(store('session'), ROUND_KEY);
        enqueue('online_end', {
          result: result || 'done',
          ms: Math.max(0, Math.min(Date.now() - cur.ts, ROUND_MAX))
        }, cur.game);
        log('round end', result, cur.game);
      } catch (e) {}
    }
    function onlineState(status, state) {
      try {
        if (!state) return;
        var over = status === 'finished'
          || state.gameOver === true
          || state.over === true
          || state.phase === 'over'
          || state.phase === 'won'
          || state.phase === 'lost';
        if (over) onlineEnd('done');
      } catch (e) {}
    }
    function init() {
      try {
        if (!http()) return;
        visitor();
        var info = pageInfo();
        if (info && info.home) {
          enqueue('platform_enter', { referrer: (document.referrer || '').slice(0, 200) }, '');
        } else if (info && info.game) {
          var from = get(store('local'), LAST_KEY) || '';
          var source = get(store('session'), SRC_KEY) || refParam() || 'direct';
          del(store('session'), SRC_KEY);
          set(store('local'), LAST_KEY, info.game);
          enqueue('game_enter', {
            mode: info.mode,
            from: from.slice(0, 40),
            source: source.slice(0, 20)
          }, info.game);
        }
        flush(false);
      } catch (e) {}
    }

    window.BG = window.BG || {};
    window.BG.__track = 1;
    window.BG.track = function (name, props) {
      try { enqueue(name, props, currentGame()); } catch (e) {}
    };
    window.BG.markClick = function (source) {
      try { set(store('session'), SRC_KEY, (source || 'card').slice(0, 20)); } catch (e) {}
    };
    window.BG.onlineStart = onlineStart;
    window.BG.onlineEnd = onlineEnd;
    window.BG.onlineState = onlineState;
    window.BG.flush = function () { try { flush(true); } catch (e) {} };

    init();

    try {
      window.addEventListener('pagehide', function () {
        try {
          if (onlineRound()) onlineEnd('left');
          flush(true);
        } catch (e) {}
      });
      window.addEventListener('pageshow', function (e) {
        try {
          if (e && e.persisted) flush(false);
        } catch (err) {}
      });
    } catch (e) {}
  } catch (e) {}
})();
