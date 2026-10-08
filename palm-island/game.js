/* 棕榈岛 · 纯逻辑引擎（无 DOM，Node 可测）
   规则口径见 SPEC.md §3-§7；行态字段：
   make=右旋产出(null=无) ｜ spin=可右转90°收集 ｜ fee=收集费用(数组=OR 任选其一；缺省=免费) ｜
   to180=花🟡转180°费用 ｜ flip=花🔵翻面费用(保持行) ｜ star=⭐ ｜ lv=⬆
   v0.17 口径：R13 可见最上 2 张（payload.target=0|1，跳过限 target=0）· R15 付费收集 ·
   R19 资源卡上限 4（满 4 收集须携带 reset=资源卡 uid，原位复位；否则 RES_LIMIT）· R11 轮末仅计数
*/
(function () {
  'use strict';

  var MARKER = '#marker';
  var RULES = {
    CARDS: 16,
    ROUNDS: 8,
    RES_LIMIT: 4,
    MARKER_POS: 'bottom',  // R6：标记卡起手在牌堆最底（第 17 席）
  };

  var CARDS = [
    { id: 'boathouse', name: '船屋', art: 'hut', copies: 3,
      faces: [
        { rows: [
          { make: { f: 1 },       spin: true,  to180: { f: 1 },       flip: { f: 1 },       star: 0, lv: 0 },
          { make: { f: 2 },       spin: true,  to180: null,           flip: { w: 1, f: 1 }, star: 0, lv: 1 },
        ] },
        { rows: [
          { make: { f: 1, w: 1 }, spin: true,  to180: { w: 1, f: 1 }, flip: null,           star: 0, lv: 1 },
          { make: { f: 2, w: 1 }, spin: true,  to180: null,           flip: null,           star: 0, lv: 2 },
        ] },
      ] },
    { id: 'woodcutter', name: '樵夫', art: 'lumber', copies: 3,
      faces: [
        { rows: [
          { make: { w: 1 },       spin: true,  to180: { w: 1, f: 1 }, flip: null,           star: 0, lv: 0 },
          { make: { w: 1 },       spin: true,  to180: null,           flip: { w: 1, s: 1 }, star: 1, lv: 1 },
        ] },
        { rows: [
          { make: null,           spin: false, to180: null,           flip: null,           star: 5, lv: 3 },  // 空行态终态
          { make: { w: 2 },       spin: true,  to180: { w: 2, s: 2 }, flip: null,           star: 2, lv: 2 },
        ] },
      ] },
    { id: 'quarry', name: '采石场', art: 'quarry', copies: 3,
      faces: [
        { rows: [
          { make: null,           spin: false, to180: { w: 2 },       flip: { f: 2 },       star: 0, lv: 0 },  // 正0°：无 Free、无产出
          { make: { s: 1 },       spin: true,  to180: null,           flip: { w: 2, f: 1 }, star: 0, lv: 1 },
        ] },
        { rows: [
          { make: { s: 1 },       spin: true,  to180: { w: 1, f: 2 }, flip: null,           star: 0, lv: 1 },
          { make: { s: 2 },       spin: true,  to180: null,           flip: null,           star: 2, lv: 2 },  // 终态：仅 Free
        ] },
      ] },
    { id: 'market', name: '集市', art: 'market', copies: 1,
      faces: [
        { rows: [
          { make: { s: 1 },         spin: true, to180: { w: 2 },     flip: { f: 2 },     star: 0, lv: 0, fee: [{ w: 1 }, { f: 1 }] },
          { make: { s: 1, f: 1 },   spin: true, to180: null,         flip: { w: 1, s: 1 }, star: 0, lv: 1, fee: [{ w: 1 }] },
        ] },
        { rows: [
          { make: { s: 1, w: 1 },   spin: true, to180: { s: 1, f: 2 }, flip: null,           star: 0, lv: 1, fee: [{ f: 1 }] },
          { make: { s: 1, f: 1, w: 1 }, spin: true, to180: null,     flip: null,           star: 0, lv: 2, fee: [{ w: 1 }, { f: 1 }, { s: 1 }] },
        ] },
      ] },
    { id: 'storehouse', name: '货栈', art: 'storehouse', copies: 1,
      faces: [
        { rows: [
          { make: { w: 1, f: 1 }, spin: true, to180: { f: 1 },     flip: { w: 1 },     star: 0, lv: 0, fee: [{ w: 2 }, { f: 2 }] },
          { make: { w: 3 },       spin: true, to180: null,         flip: { w: 1, f: 1 }, star: 0, lv: 1, fee: [{ s: 2 }, { f: 2 }] },
        ] },
        { rows: [
          { make: { f: 3 },       spin: true, to180: { w: 1, f: 1 }, flip: null,           star: 0, lv: 1, fee: [{ w: 2 }, { s: 2 }] },
          { make: { s: 3 },       spin: true, to180: { s: 1 },     flip: { s: 1 },     star: 0, lv: 2, fee: [{ w: 2 }, { f: 2 }] },  // 终态含回退
        ] },
      ] },
    { id: 'warehouse', name: '仓库', art: 'warehouse', copies: 1,
      faces: [
        { rows: [
          { make: null,           spin: false, to180: { f: 1, w: 1, s: 2 }, flip: { w: 1, f: 1 }, star: 0, lv: 0 },
          { make: null,           spin: false, to180: null,           flip: null,           star: 4, lv: 3 },  // 空行态终态（正180°）
        ] },
        { rows: [
          { make: { f: 1, w: 1 },     spin: true, to180: { w: 1, f: 1, s: 1 }, flip: null,           star: 0, lv: 1 },
          { make: { w: 1, f: 1, s: 1 }, spin: true, to180: null,           flip: { s: 2, f: 2, w: 2 }, star: 0, lv: 2 },
        ] },
      ] },
    { id: 'house', name: '房屋', art: 'house', copies: 2,
      faces: [
        { rows: [
          { make: null,           spin: false, to180: { f: 1, w: 1 },     flip: null,           star: 0, lv: 0 },
          { make: null,           spin: false, to180: null,               flip: { w: 1, f: 1, s: 1 }, star: 1, lv: 1 },
        ] },
        { rows: [
          { make: null,           spin: false, to180: null,               flip: null,           star: 6, lv: 3 },  // 空行态终态
          { make: null,           spin: false, to180: { w: 2, f: 2, s: 2 }, flip: null,         star: 2, lv: 2 },
        ] },
      ] },
    { id: 'temple', name: '神殿', art: 'temple', copies: 2,
      faces: [
        { rows: [
          { make: null,           spin: false, to180: { f: 1, w: 1, s: 2 }, flip: null,           star: 0,  lv: 0 },
          { make: null,           spin: false, to180: null,               flip: { w: 2, f: 2, s: 3 }, star: 3,  lv: 1 },
        ] },
        { rows: [
          { make: null,           spin: false, to180: null,               flip: null,           star: 10, lv: 3 },  // 空行态终态（10⭐）
          { make: null,           spin: false, to180: { w: 3, f: 3, s: 4 }, flip: null,         star: 6,  lv: 2 },
        ] },
      ] },
  ];

  var TYPES = {};
  CARDS.forEach(function (t) { TYPES[t.id] = t; });
  var TOTAL_COPIES = CARDS.reduce(function (a, c) { return a + c.copies; }, 0);

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function isCard(c) { return !!c && c.id !== MARKER; }
  function typeOf(c) { return TYPES[c.id]; }
  function rowStateOf(c) { return TYPES[c.id].faces[c.face].rows[c.row]; }
  function qOf(c) { return c.res ? (c.row === 0 ? 1 : 3) : c.row * 2; }
  function rowLabel(c) { return (c.face === 0 ? '正' : '背') + ' ' + (c.row === 0 ? '0°' : '180°') + ' 行'; }
  function markerOf(S) { for (var i = 0; i < S.deck.length; i++) if (S.deck[i].id === MARKER) return S.deck[i]; return null; }

  function newGame(seed) {
    seed = (seed == null ? (Date.now() >>> 0) : (seed >>> 0));
    var rand = mulberry32(seed);
    var cards = [];
    CARDS.forEach(function (t) {
      for (var k = 0; k < t.copies; k++) cards.push({ uid: t.id + '#' + k, id: t.id, face: 0, row: 0, res: false });
    });
    shuffle(cards, rand);
    if (RULES.MARKER_POS === 'bottom') cards.push({ id: MARKER, n: 0 });
    var S = { v: 1, seed: seed, deck: cards, phase: 'play', log: [] };
    log(S, { k: 'round', s: '第 1 轮开始' });
    return S;
  }

  function log(S, e) {
    S.log.push(e);
    if (S.log.length > 200) S.log.splice(0, S.log.length - 200);
  }

  function resTotals(S, idxs) {
    var t = { f: 0, w: 0, s: 0 };
    var list = idxs || S.deck.map(function (_, i) { return i; });
    list.forEach(function (i) {
      var c = S.deck[i];
      if (isCard(c) && c.res) {
        var m = rowStateOf(c).make || {};
        for (var k in m) t[k] += m[k];
      }
    });
    return t;
  }

  function covers(got, cost) {
    for (var k in cost) if ((got[k] || 0) < cost[k]) return false;
    return true;
  }

  function resIndices(S) {
    var out = [];
    S.deck.forEach(function (c, i) { if (isCard(c) && c.res) out.push(i); });
    return out;
  }
  function resCount(S) { return resIndices(S).length; }

  /* 可作支付的资源卡（排除目标卡；目标卡必为非资源态，此处为显式约束） */
  function payIdxs(S, ti) {
    var out = [];
    S.deck.forEach(function (c, i) { if (isCard(c) && c.res && i !== ti) out.push(i); });
    return out;
  }

  function normPay(S, raw, ti) {
    var picked = [];
    raw.forEach(function (i) { if (picked.indexOf(i) < 0) picked.push(i); });
    for (var n = 0; n < picked.length; n++) {
      var i = picked[n], c = S.deck[i];
      if (typeof i !== 'number' || i !== Math.floor(i) || !isCard(c) || !c.res || i === ti) return { err: '只能选择资源卡支付' };
    }
    return { idxs: picked };
  }

  /* 校验支付（不落盘，供 collect 在 R19 校验前使用） */
  function checkPay(S, cost, payload, ti) {
    var norm = normPay(S, (payload && payload.pay) || [], ti);
    if (norm.err) return { err: norm.err };
    if (!covers(resTotals(S, norm.idxs), cost)) return { err: '资源不足' };
    return { idxs: norm.idxs };
  }

  function applyPay(S, idxs) { idxs.forEach(function (i) { S.deck[i].res = false; }); }

  function moveCard(S, i) { S.deck.push(S.deck.splice(i, 1)[0]); }

  function anyFeeCovered(got, fee) {
    for (var i = 0; i < fee.length; i++) if (covers(got, fee[i])) return true;
    return false;
  }

  /* 行态 → 操作集；isTop=false 时跳过不可用（R13） */
  function opsOf(S, c, ti, isTop) {
    var rs = rowStateOf(c);
    var got = resTotals(S, payIdxs(S, ti));
    var collect;
    if (!rs.spin) collect = { ok: false, reason: '当前行未印出' };
    else if (rs.fee && !anyFeeCovered(got, rs.fee)) collect = { ok: false, reason: '资源不足', fee: rs.fee };
    else collect = { ok: true, fee: rs.fee || null };
    function rk(cost) {
      if (!cost) return { ok: false, reason: '当前行未印出' };
      if (!covers(got, cost)) return { ok: false, cost: cost, reason: '资源不足' };
      return { ok: true, cost: cost };
    }
    return {
      collect: collect,
      to180: rk(rs.to180),
      flip: rk(rs.flip),
      skip: isTop ? { ok: true } : { ok: false, reason: '只能跳过第 1 张卡' },
    };
  }

  function slotAt(S, pos, isTop) {
    var c = S.deck[pos];
    if (!c) return null;
    if (c.id === MARKER) return { pos: pos, kind: 'marker', card: c, rowState: null, ops: null, actionable: false };
    var rs = rowStateOf(c);
    if (c.res) return { pos: pos, kind: 'res', card: c, rowState: rs, ops: null, actionable: false };
    return { pos: pos, kind: 'card', card: c, rowState: rs, ops: opsOf(S, c, pos, isTop), actionable: true };
  }

  function resList(S) {
    var list = [];
    S.deck.forEach(function (c, i) {
      if (isCard(c) && c.res) {
        list.push({ idx: i, uid: c.uid, id: c.id, name: TYPES[c.id].name, face: c.face, row: c.row,
          label: rowLabel(c), make: rowStateOf(c).make || null });
      }
    });
    return list;
  }

  function draw(S) {
    var v = {
      phase: S.phase, kind: null, card: null, rowState: null, slots: [],
      res: null, n: 0, round: 0, counts: null, score: null, done: false,
    };
    var mk = markerOf(S);
    v.n = mk ? mk.n : 0;
    v.round = Math.min(v.n + 1, RULES.ROUNDS);
    var cards = S.deck.filter(isCard);
    var bank = cards.filter(function (c) { return c.res; });
    v.counts = { cards: cards.length, bank: bank.length };
    if (S.phase === 'settle') {
      v.kind = 'settle'; v.done = true; v.score = score(S);
      return v;
    }
    var top = S.deck[0];
    if (top.id === MARKER) {
      v.kind = 'marker'; v.card = top;
      v.slots = [slotAt(S, 0, true)];
      return v;
    }
    if (top.res) {
      v.kind = 'res'; v.card = top; v.rowState = rowStateOf(top);
      v.slots = [slotAt(S, 0, true)];
      return v;
    }
    v.kind = 'card';
    v.card = top; v.rowState = rowStateOf(top);
    v.slots = [slotAt(S, 0, true)];
    var s1 = slotAt(S, 1, false);
    if (s1) v.slots.push(s1);
    v.res = { totals: resTotals(S), list: resList(S), limit: RULES.RES_LIMIT };
    return v;
  }

  function targetOf(payload) {
    var t = payload && payload.target;
    if (t == null) return 0;
    return (t === 0 || t === 1) ? t : -1;
  }

  function act(S, action, payload) {
    var d = draw(S);
    if (d.kind === 'settle') return { ok: false, err: '航程已结束' };
    if (d.kind === 'marker') {
      if (action !== 'marker') return { ok: false, err: '回合标记卡自动结算' };
      return doMarker(S);
    }
    if (d.kind === 'res') {
      if (action !== 'reset') return { ok: false, err: '资源态顶卡自动复位' };
      return doReset(S);
    }
    if (action !== 'collect' && action !== 'to180' && action !== 'flip' && action !== 'skip') {
      return { ok: false, err: '未知操作' };
    }
    var ti = targetOf(payload);
    if (ti < 0) return { ok: false, err: '无效的目标' };
    var slot = d.slots[ti];
    if (!slot) return { ok: false, err: '无效的目标' };
    if (slot.kind === 'res') return { ok: false, err: '资源态卡不可操作' };
    if (slot.kind === 'marker') return { ok: false, err: '回合标记卡不可操作' };
    if (action === 'skip') {
      if (ti !== 0) return { ok: false, err: '只能跳过第 1 张卡' };
      return doSkip(S);
    }
    if (action === 'collect') return doCollect(S, d, ti, payload);
    if (action === 'to180') return doTo180(S, d, ti, payload);
    return doFlip(S, d, ti, payload);
  }

  function doCollect(S, d, ti, payload) {
    var slot = d.slots[ti];
    var rs = slot.rowState;
    if (!slot.ops.collect.ok) return { ok: false, err: slot.ops.collect.reason };
    var picked = { idxs: [] };
    var cost = null;
    if (rs.fee) {
      var norm = normPay(S, (payload && payload.pay) || [], ti);
      if (norm.err) return { ok: false, err: norm.err };
      var feeIdx = (payload && typeof payload.fee === 'number') ? payload.fee : null;
      if (feeIdx !== null) {
        if (feeIdx < 0 || feeIdx >= rs.fee.length) return { ok: false, err: '不存在的支付方案' };
        cost = rs.fee[feeIdx];
      } else {
        var pickedTot = resTotals(S, norm.idxs);
        for (var i = 0; i < rs.fee.length; i++) {
          if (covers(pickedTot, rs.fee[i])) { cost = rs.fee[i]; break; }
        }
        if (!cost) return { ok: false, err: '资源不足' };
      }
      if (!covers(resTotals(S, norm.idxs), cost)) return { ok: false, err: '资源不足' };
      picked = norm;
    }

    /* R19：支付后仍满 4 张 → 必须携带 reset（资源卡 uid）原位复位 */
    var resetIdx = -1;
    var bankIdx = resIndices(S).filter(function (i) { return picked.idxs.indexOf(i) < 0; });
    if (bankIdx.length >= RULES.RES_LIMIT) {
      var ruid = payload && payload.reset;
      if (ruid == null) {
        return { ok: false, code: 'RES_LIMIT', err: '资源卡已满 ' + RULES.RES_LIMIT + ' 张，须先选择 1 张资源卡重置' };
      }
      for (var k = 0; k < bankIdx.length; k++) {
        if (S.deck[bankIdx[k]].uid === ruid) { resetIdx = bankIdx[k]; break; }
      }
      if (resetIdx < 0) return { ok: false, err: '只能选择资源卡重置' };
    }

    var evs = [];
    applyPay(S, picked.idxs);
    if (picked.idxs.length) evs.push({ t: 'pay', idxs: picked.idxs.slice() });
    if (resetIdx >= 0) {
      var rc = S.deck[resetIdx];
      rc.res = false;
      log(S, { k: 'sys', s: TYPES[rc.id].name + ' 资源复位（上限 ' + RULES.RES_LIMIT + ' 张）' });
      evs.push({ t: 'reset', uid: rc.uid, id: rc.id, byLimit: true });
    }
    var c = S.deck[ti];
    c.res = true;
    var make = rs.make;
    log(S, { k: 'good', s: TYPES[c.id].name + ' 右转收集', res: make, cost: cost });
    evs.push({ t: 'collect', target: ti, uid: c.uid, id: c.id, make: make, cost: cost });
    moveCard(S, ti);
    evs.push({ t: 'move', uid: c.uid });
    return { ok: true, evs: evs };
  }

  function doTo180(S, d, ti, payload) {
    var slot = d.slots[ti];
    if (!slot.ops.to180.ok) return { ok: false, err: slot.ops.to180.reason || '当前行未印出' };
    var cost = slot.ops.to180.cost;
    var chk = checkPay(S, cost, payload, ti);
    if (chk.err) return { ok: false, err: chk.err };
    applyPay(S, chk.idxs);
    var c = S.deck[ti];
    c.row = 1 - c.row;
    log(S, { k: 'spin', s: TYPES[c.id].name + ' 旋转 180° → ' + rowLabel(c), cost: cost });
    moveCard(S, ti);
    return { ok: true, evs: [{ t: 'pay', idxs: chk.idxs }].concat([
      { t: 'to180', target: ti, uid: c.uid, id: c.id, row: c.row, cost: cost },
      { t: 'move', uid: c.uid },
    ]) };
  }

  function doFlip(S, d, ti, payload) {
    var slot = d.slots[ti];
    if (!slot.ops.flip.ok) return { ok: false, err: slot.ops.flip.reason || '当前行未印出' };
    var cost = slot.ops.flip.cost;
    var chk = checkPay(S, cost, payload, ti);
    if (chk.err) return { ok: false, err: chk.err };
    applyPay(S, chk.idxs);
    var c = S.deck[ti];
    c.face = 1 - c.face;
    log(S, { k: 'flip', s: TYPES[c.id].name + ' 翻面 → ' + rowLabel(c), cost: cost });
    moveCard(S, ti);
    return { ok: true, evs: [{ t: 'pay', idxs: chk.idxs }].concat([
      { t: 'flip', target: ti, uid: c.uid, id: c.id, face: c.face, cost: cost },
      { t: 'move', uid: c.uid },
    ]) };
  }

  function doSkip(S) {
    var c = S.deck[0];
    log(S, { k: 'sys', s: TYPES[c.id].name + ' 跳过 · 回牌堆底' });
    moveCard(S, 0);
    return { ok: true, evs: [{ t: 'skip', target: 0, uid: c.uid, id: c.id }, { t: 'move', uid: c.uid }] };
  }

  function doReset(S) {
    var c = S.deck[0];
    c.res = false;
    log(S, { k: 'sys', s: TYPES[c.id].name + ' 资源复位' });
    moveCard(S, 0);
    return { ok: true, evs: [{ t: 'reset', uid: c.uid, id: c.id }, { t: 'move', uid: c.uid }] };
  }

  function doMarker(S) {
    var mk = S.deck[0];
    mk.n += 1;
    var evs = [{ t: 'marker', n: mk.n }];
    if (mk.n >= RULES.ROUNDS) {
      S.phase = 'settle';
      log(S, { k: 'round', s: '第 ' + RULES.ROUNDS + ' 轮结束' });
      log(S, { k: 'sys', s: '第 ' + RULES.ROUNDS + ' 次回合标记 · 结算', total: score(S).total });
      evs.push({ t: 'settle', total: score(S).total });
      return { ok: true, evs: evs };
    }
    log(S, { k: 'round', s: '第 ' + mk.n + ' 轮结束' });
    moveCard(S, 0);
    log(S, { k: 'round', s: '第 ' + (mk.n + 1) + ' 轮开始' });
    evs.push({ t: 'move', marker: true });
    evs.push({ t: 'round', n: mk.n + 1 });
    return { ok: true, evs: evs };
  }

  function score(S) {
    var rows = [];
    S.deck.forEach(function (c) {
      if (!isCard(c)) return;
      var st = rowStateOf(c);
      rows.push({
        uid: c.uid, id: c.id, name: TYPES[c.id].name, face: c.face, row: c.row, res: !!c.res,
        star: st.star, lv: st.lv,
        label: rowLabel(c) + (c.res ? '（横置）' : ''),
      });
    });
    var total = rows.reduce(function (a, r) { return a + r.star; }, 0);
    return { total: total, rows: rows };
  }

  function validate(S) {
    var errs = [];
    if (!S || typeof S !== 'object') return ['状态非对象'];
    if (!Array.isArray(S.deck)) errs.push('deck 非数组');
    if (!Array.isArray(S.log)) errs.push('log 非数组');
    if (['play', 'settle'].indexOf(S.phase) < 0) errs.push('phase 非法: ' + S.phase);
    var mk = 0, cnt = 0, resN = 0;
    (S.deck || []).forEach(function (c, i) {
      if (c.id === MARKER) {
        mk += 1;
        if (typeof c.n !== 'number' || c.n < 0 || c.n > RULES.ROUNDS) errs.push('标记计数非法 @' + i + ': ' + c.n);
      } else {
        cnt += 1;
        if (!TYPES[c.id]) { errs.push('未知卡 id: ' + c.id); return; }
        if (c.face !== 0 && c.face !== 1) errs.push('face 非法 @' + i);
        if (c.row !== 0 && c.row !== 1) errs.push('row 非法 @' + i);
        if (typeof c.res !== 'boolean') errs.push('res 非布尔 @' + i);
        if (c.res) resN += 1;
      }
    });
    if (mk !== 1) errs.push('标记卡数量 ' + mk);
    if (cnt !== TOTAL_COPIES) errs.push('卡牌总数 ' + cnt + ' ≠ ' + TOTAL_COPIES);
    if (resN > RULES.RES_LIMIT) errs.push('资源卡数量 ' + resN + ' > ' + RULES.RES_LIMIT);
    return errs;
  }

  function serialize(S) { return JSON.stringify(S); }
  function deserialize(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
  }

  var api = {
    MARKER: MARKER, RULES: RULES, CARDS: CARDS, TYPES: TYPES, TOTAL_COPIES: TOTAL_COPIES,
    mulberry32: mulberry32, newGame: newGame, draw: draw, act: act, score: score,
    validate: validate, serialize: serialize, deserialize: deserialize,
    qOf: qOf, rowLabel: rowLabel, rowStateOf: rowStateOf, resTotals: resTotals,
    resCount: resCount, covers: covers, markerOf: markerOf, isCard: isCard,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PALM = api;
})();
