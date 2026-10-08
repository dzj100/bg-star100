/* ============================================================
   棕榈岛 · 引擎无头测试（node test-core.js · SPEC v0.18）
   覆盖：
     1 卡表完整性（8 卡种 / 16 张 / 32 行态 / 字段不变式）
     2 洗牌确定性与起手
     3 行态操作集（四朝向 × 可用性 / 费用 / 空行态）
     4 双槽位与目标选择（R13：跳过限第 1 张）
     5 收集闭环与资源态顶卡自动复位
     6 支付口径（R12：按类覆盖 / 允许多付 / 单目标）
     7 付费收集（R15：fee 方案 OR / 自动选择）
     8 资源上限（R19：满 4 张须重置、原位、不重排）
     9 标记循环（R11：轮末仅计数、第 8 次直接结算）
    10 结算口算与 q / 行标
    11 序列化往返
    12 随机对局不变量（200 seeds fuzz）
   ============================================================ */
'use strict';
const G = require('./game.js');

let ok = 0, total = 0;
const fails = [];
function expect(msg, cond) {
  total++;
  if (cond) ok++;
  else { fails.push(msg); console.log('  ✗ ' + msg); }
}
const sec = t => console.log('\n■ ' + t);

/* 确定性 rnd（fuzz 用） */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* 白盒：把牌堆第 i 张改写成指定卡（保持总数守恒，供行态单测） */
function rigAt(S, i, id, face, row, res) {
  const c = S.deck[i];
  c.id = id; c.face = face; c.row = row; c.res = !!res;
  c.uid = id + '@' + i + '-' + face + row + (res ? 'r' : '');
  return c;
}
/* 白盒：把标记卡移到指定下标（默认牌堆顶） */
function markerAt(S, idx) {
  for (let i = 0; i < S.deck.length; i++) {
    if (S.deck[i].id === G.MARKER) {
      const m = S.deck.splice(i, 1)[0];
      S.deck.splice(idx, 0, m);
      return m;
    }
  }
  return null;
}
function markerTop(S) { return markerAt(S, 0); }
/* 白盒：某卡某行态的静态数据 */
function rowOf(id, face, row) { return G.TYPES[id].faces[face].rows[row]; }
/* 合法费用对象（正数资源 + 已知种类） */
function validCost(c) {
  if (typeof c !== 'object' || c === null) return false;
  const ks = Object.keys(c);
  if (!ks.length) return false;
  return ks.every(k => ['f', 'w', 's'].indexOf(k) >= 0 && Number.isInteger(c[k]) && c[k] > 0);
}
/* 贪心支付：按牌堆序取资源卡直至覆盖费用（覆盖不了返回 null） */
function autoPay(S, ti, cost) {
  const idxs = [];
  const got = { f: 0, w: 0, s: 0 };
  S.deck.forEach((c, i) => {
    if (G.covers(got, cost)) return;
    if (G.isCard(c) && c.res && i !== ti) {
      const m = G.rowStateOf(c).make || {};
      for (const k in m) got[k] += m[k];
      idxs.push(i);
    }
  });
  return G.covers(got, cost) ? idxs : null;
}

/* ---------------- 1 卡表完整性 ---------------- */
sec('1 卡表完整性');
{
  expect('RULES.CARDS = 16（岛卡）', G.RULES.CARDS === 16);
  expect('RULES.ROUNDS = 8', G.RULES.ROUNDS === 8);
  expect('RULES.RES_LIMIT = 4', G.RULES.RES_LIMIT === 4);
  expect('卡型 8 种', G.CARDS.length === 8);
  expect('印量登记与本表一致', G.TOTAL_COPIES === G.CARDS.reduce((a, c) => a + c.copies, 0));
  expect('岛卡共 16 张', G.TOTAL_COPIES === 16);

  let cells = 0;
  for (const t of G.CARDS) {
    expect(t.id + ' 有名字/美术', typeof t.name === 'string' && typeof t.art === 'string');
    expect(t.id + ' 印量 ≥1 整数', Number.isInteger(t.copies) && t.copies >= 1);
    expect(t.id + ' 双面', Array.isArray(t.faces) && t.faces.length === 2);
    for (const f of t.faces) {
      expect(t.id + ' 每面两行', Array.isArray(f.rows) && f.rows.length === 2);
      for (const r of f.rows) {
        cells++;
        expect(t.id + ' ⭐ 非负整数', Number.isInteger(r.star) && r.star >= 0);
        expect(t.id + ' ⬆ 非负整数', Number.isInteger(r.lv) && r.lv >= 0);
        expect(t.id + ' spin 布尔', typeof r.spin === 'boolean');
        expect(t.id + ' make/null 与 spin 相互印证', (r.make !== null) === r.spin);
        if (r.make !== null) expect(t.id + ' make 为合法产出', validCost(r.make));
        for (const k of ['to180', 'flip']) {
          expect(t.id + '.' + k + ' null 或合法费用', r[k] === null || validCost(r[k]));
        }
        if (r.fee !== undefined) {
          expect(t.id + ' fee 为 OR 方案数组', Array.isArray(r.fee) && r.fee.length > 0 && r.fee.every(validCost));
        }
      }
    }
  }
  expect('行态总数 32 格', cells === 32);
  console.log('  · 卡型 ' + G.CARDS.length + '/8 · 印量 ' + G.TOTAL_COPIES + '/16 张 · 行态 ' + cells + '/32 格');

  expect('船屋 · 全行态 0⭐', G.TYPES.boathouse.faces.every(f => f.rows.every(r => r.star === 0)));
  let r = rowOf('woodcutter', 1, 0);
  expect('樵夫 · 背0° 空行态 5⭐3⬆', r.make === null && r.spin === false && r.to180 === null && r.flip === null && r.star === 5 && r.lv === 3);
  r = rowOf('quarry', 0, 0);
  expect('采石场 · 正0° 无收集/无产出', r.make === null && r.spin === false && r.to180.w === 2);
  r = rowOf('market', 0, 0);
  expect('集市 · 正0° 费用方案 1🪵|1🐟', Array.isArray(r.fee) && r.fee.length === 2 && r.fee[0].w === 1 && r.fee[1].f === 1);
  r = rowOf('storehouse', 1, 1);
  expect('货栈 · 背180° 回退操作', r.to180 !== null && r.to180.s === 1 && r.flip !== null && r.flip.s === 1);
  expect('货栈 · 背180° 产出 3🪨（v0.18 修订）', r.make !== null && r.make.s === 3);
  r = rowOf('warehouse', 0, 1);
  expect('仓库 · 正180° 空行态 4⭐', r.make === null && r.spin === false && r.star === 4 && r.lv === 3);
  expect('仓库 · 仅正180° 计分', rowOf('warehouse', 0, 0).star === 0 && rowOf('warehouse', 1, 0).star === 0 && rowOf('warehouse', 1, 1).star === 0);
  r = rowOf('house', 1, 0);
  expect('房屋 · 背0° 6⭐', r.make === null && r.spin === false && r.star === 6);
  r = rowOf('temple', 1, 0);
  expect('神殿 · 背0° 10⭐（最高分）', r.make === null && r.spin === false && r.star === 10);
  r = rowOf('temple', 0, 0);
  expect('神殿 · 正0° 🟡 = 1🐟1🪵2🪨', r.to180.f === 1 && r.to180.w === 1 && r.to180.s === 2 && r.star === 0);
}

/* ---------------- 2 洗牌确定性与起手 ---------------- */
sec('2 洗牌确定性与起手');
{
  const A = G.newGame(42), B = G.newGame(42), C = G.newGame(43);
  const seq = s => s.deck.map(c => c.uid || '#M').join(',');
  expect('同种子同序（可复现）', seq(A) === seq(B));
  expect('异种子异序', seq(A) !== seq(C));
  expect('牌堆 17 席（16 岛卡 + 标记）', A.deck.length === 17);
  expect('标记卡在牌堆底 n=0（R6）', A.deck[16].id === G.MARKER && G.markerOf(A).n === 0);
  expect('开局日志：第 1 轮开始', A.log.length === 1 && A.log[0].s === '第 1 轮开始');
  const d = G.draw(A);
  expect('起手 kind=card · 第 1 轮', d.kind === 'card' && d.round === 1 && d.n === 0);
  expect('起手计数 16/0', d.counts.cards === 16 && d.counts.bank === 0);
  expect('可见最上 2 张（R13）', d.slots.length === 2);
  expect('槽位 0 可操作', d.slots[0].actionable === true && d.slots[0].kind === 'card');
  expect('槽位 1 可见但不可跳过', d.slots[1].actionable === true && d.slots[1].ops.skip.ok === false);
  expect('起手无资源 · 上限 4 暴露', d.res.totals.f === 0 && d.res.totals.w === 0 && d.res.totals.s === 0 && d.res.limit === 4 && d.res.list.length === 0);
  expect('validate 干净', G.validate(A).length === 0);
}

/* ---------------- 3 行态操作集（四朝向） ---------------- */
sec('3 行态操作集（四朝向）');
{
  const mk = (id, face, row, resList) => {
    const S = G.newGame(7);
    rigAt(S, 0, id, face, row, false);
    (resList || []).forEach((sp, k) => rigAt(S, 2 + k, sp[0], sp[1], sp[2], true));
    return G.draw(S).slots[0].ops;
  };

  let o = mk('woodcutter', 1, 0);
  expect('樵夫 背0° 空行态 · 仅可跳过', !o.collect.ok && !o.to180.ok && !o.flip.ok && o.skip.ok);
  expect('空行态原因 = 当前行未印出', o.collect.reason === '当前行未印出' && o.to180.reason === '当前行未印出' && o.flip.reason === '当前行未印出');

  o = mk('quarry', 0, 0);
  expect('采石场 正0° · 不可收集', !o.collect.ok && o.collect.reason === '当前行未印出');
  expect('采石场 正0° · 无资源时费用暴露且不可用', !o.to180.ok && o.to180.reason === '资源不足' && o.to180.cost.w === 2 && !o.flip.ok && o.flip.cost.f === 2);

  o = mk('warehouse', 0, 1);
  expect('仓库 正180° 空行态 · 仅可跳过', !o.collect.ok && !o.to180.ok && !o.flip.ok && o.skip.ok);

  o = mk('boathouse', 0, 0, [['boathouse', 0, 0]]);
  expect('船屋 正0° · 免费收集', o.collect.ok === true && o.collect.fee === null);
  expect('船屋 正0° · 🟡1🐟 / 🔵1🐟 可用', o.to180.ok && o.to180.cost.f === 1 && o.flip.ok && o.flip.cost.f === 1);

  o = mk('woodcutter', 0, 1, [['woodcutter', 0, 0], ['quarry', 0, 1]]);
  expect('樵夫 正180° · 无🟡 / 🔵1🪵1🪨 可用', !o.to180.ok && o.to180.reason === '当前行未印出' && o.flip.ok && o.flip.cost.w === 1 && o.flip.cost.s === 1);

  o = mk('quarry', 0, 0, [['woodcutter', 1, 1], ['boathouse', 0, 1]]);
  expect('采石场 正0° · 🟡2🪵 / 🔵2🐟（资源齐）', o.to180.ok && o.to180.cost.w === 2 && o.flip.ok && o.flip.cost.f === 2);

  o = mk('warehouse', 1, 1, [['quarry', 1, 1], ['boathouse', 1, 1], ['woodcutter', 1, 1]]);
  expect('仓库 背180° · 🔵2🪨2🐟2🪵 可用', o.flip.ok && o.flip.cost.s === 2 && o.flip.cost.f === 2 && o.flip.cost.w === 2);

  o = mk('market', 0, 0);
  expect('集市 正0° · 无资源 → 不可收集且暴露费用方案', !o.collect.ok && o.collect.reason === '资源不足' && Array.isArray(o.collect.fee) && o.collect.fee.length === 2);

  o = mk('market', 0, 0, [['woodcutter', 1, 1], ['boathouse', 0, 1]]);
  expect('集市 正0° · 资源齐（2🪵+2🐟）→ 🟢/🟡/🔵 全可用', o.collect.ok && o.to180.ok && o.flip.ok);

  o = mk('storehouse', 0, 0, [['woodcutter', 1, 1], ['boathouse', 0, 0]]);
  expect('货栈 正0° · 付费收集 2🪵|2🐟', o.collect.ok && o.collect.fee.length === 2 && o.collect.fee[0].w === 2 && o.collect.fee[1].f === 2);
  expect('货栈 正0° · 🟡1🐟 / 🔵1🪵 可用', o.to180.ok && o.to180.cost.f === 1 && o.flip.ok && o.flip.cost.w === 1);
}

/* ---------------- 4 双槽位与目标选择（R13） ---------------- */
sec('4 双槽位与目标选择（R13）');
{
  const S = G.newGame(51);
  rigAt(S, 0, 'boathouse', 0, 0, false);
  rigAt(S, 1, 'boathouse', 0, 0, false);
  let r = G.act(S, 'skip', { target: 1 });
  expect('跳过第 2 张被拒', !r.ok && r.err === '只能跳过第 1 张卡');
  r = G.act(S, 'collect', { target: 2 });
  expect('目标越界被拒', !r.ok && r.err === '无效的目标');
  r = G.act(S, 'skip');
  expect('负载省略 → 默认目标 0', r.ok === true);

  const S2 = G.newGame(52);
  const u0 = rigAt(S2, 0, 'boathouse', 0, 0, false).uid;
  const u1 = rigAt(S2, 1, 'woodcutter', 0, 0, false).uid;
  r = G.act(S2, 'collect', { target: 1 });
  expect('target=1 收集成功', r.ok === true);
  expect('evs 记录 target=1', r.evs[0].t === 'collect' && r.evs[0].target === 1);
  expect('被操作卡按最终样式入底', S2.deck[16].uid === u1 && S2.deck[16].res === true);
  expect('其余卡片顺序不动', S2.deck[0].uid === u0);

  const S3 = G.newGame(53);
  rigAt(S3, 0, 'boathouse', 0, 0, false);
  rigAt(S3, 1, 'boathouse', 0, 0, true);
  let d = G.draw(S3);
  expect('槽位 1 资源卡仅可见', d.slots[1].kind === 'res' && d.slots[1].actionable === false);
  r = G.act(S3, 'collect', { target: 1 });
  expect('资源卡不可被操作', !r.ok && r.err === '资源态卡不可操作');
  r = G.act(S3, 'reset', { target: 0 });
  expect('非资源态顶卡 → 未知操作', !r.ok && r.err === '未知操作');

  const S4 = G.newGame(54);
  rigAt(S4, 0, 'boathouse', 0, 0, false);
  markerAt(S4, 1);
  d = G.draw(S4);
  expect('槽位 1 标记卡仅可见', d.slots[1].kind === 'marker' && d.slots[1].actionable === false);
  r = G.act(S4, 'collect', { target: 1 });
  expect('标记卡不可被操作', !r.ok && r.err === '回合标记卡不可操作');
}

/* ---------------- 5 收集闭环与资源态顶卡自动复位 ---------------- */
sec('5 收集闭环与自动复位');
{
  const S = G.newGame(41);
  const c = rigAt(S, 0, 'boathouse', 0, 0, false);
  const d0 = G.draw(S);
  expect('行态产出 1🐟', d0.rowState.make.f === 1);
  let r = G.act(S, 'collect', { target: 0 });
  expect('收集成功', r.ok === true);
  expect('res=true · qOf=1（正0°收集）', c.res === true && G.qOf(c) === 1);
  expect('同一对象回牌堆底', S.deck[16] === c);
  expect('evs = collect + move', r.evs.map(e => e.t).join() === 'collect,move' && r.evs[0].make.f === 1 && r.evs[1].uid === c.uid);
  let d = G.draw(S);
  expect('收集后仍为卡牌视图', d.kind === 'card');
  expect('资源计数 1', d.counts.bank === 1 && G.resCount(S) === 1);
  expect('资源合计 1🐟', d.res.totals.f === 1 && d.res.totals.w === 0 && d.res.totals.s === 0);

  const c2 = rigAt(S, 0, 'woodcutter', 0, 1, true);
  d = G.draw(S);
  expect('资源态顶卡 → kind=res（单槽位）', d.kind === 'res' && d.slots.length === 1 && d.rowState.make.w === 1);
  r = G.act(S, 'collect', { target: 0 });
  expect('资源态顶卡拒绝其他操作', !r.ok && r.err === '资源态顶卡自动复位');
  r = G.act(S, 'reset');
  expect('复位成功', r.ok === true);
  expect('复位保行态（正180°）· 回牌堆底', c2.res === false && c2.face === 0 && c2.row === 1 && G.qOf(c2) === 2 && S.deck[16] === c2);
  expect('资源计数 −1', G.resCount(S) === 1);
  expect('validate 干净', G.validate(S).length === 0);
}

/* ---------------- 6 支付口径（R12） ---------------- */
sec('6 支付口径（R12）');
{
  const S = G.newGame(61);
  const focus = rigAt(S, 0, 'quarry', 1, 0, false);      // 采石场 背0°：🟡 {w:1,f:2}
  const payA = rigAt(S, 2, 'woodcutter', 0, 0, true);    // w:1
  const payB = rigAt(S, 3, 'boathouse', 0, 1, true);     // f:2

  let r = G.act(S, 'to180', { target: 0, pay: [2] });
  expect('支付不足被拒', !r.ok && r.err === '资源不足');
  r = G.act(S, 'to180', { target: 0, pay: [4] });
  expect('非资源卡支付被拒', !r.ok && r.err === '只能选择资源卡支付');
  r = G.act(S, 'to180', { target: 0, pay: [0] });
  expect('目标卡自身不可支付', !r.ok && r.err === '只能选择资源卡支付');
  r = G.act(S, 'to180', { target: 0, pay: [3] });
  expect('按类覆盖：有🐟无🪵仍被拒', !r.ok && r.err === '资源不足');
  r = G.act(S, 'to180', { target: 0, pay: [] });
  expect('空支付不覆盖', !r.ok && r.err === '资源不足');
  expect('拒绝后状态不变', payA.res === true && payB.res === true && focus.row === 0 && S.deck[0] === focus);

  const rowOnesBefore = S.deck.filter(x => G.isCard(x) && x.row === 1).length;
  r = G.act(S, 'to180', { target: 0, pay: [2, 3] });
  expect('按类覆盖 + 允许多付 → 成功', r.ok === true);
  expect('支付卡原位复位（剩余卡序不重排）', payA.res === false && payB.res === false && S.deck[1] === payA && S.deck[2] === payB);
  expect('升级仅作用于目标卡', S.deck.filter(x => G.isCard(x) && x.row === 1).length === rowOnesBefore + 1);
  expect('目标卡转 180° 并入底', focus.row === 1 && S.deck[16] === focus);
  expect('evs = pay→to180→move', r.evs.map(e => e.t).join() === 'pay,to180,move' && r.evs[0].idxs.join() === '2,3');

  const S2 = G.newGame(62);
  const u0 = rigAt(S2, 0, 'boathouse', 0, 0, false).uid;
  const uT = rigAt(S2, 1, 'quarry', 1, 0, false).uid;
  rigAt(S2, 2, 'woodcutter', 0, 0, true);
  rigAt(S2, 3, 'boathouse', 1, 1, true);
  r = G.act(S2, 'to180', { target: 1, pay: [2, 3] });
  expect('target=1 升级成功', r.ok === true && r.evs[1].t === 'to180' && r.evs[1].target === 1);
  expect('target=1 入底、槽位 0 未动', S2.deck[16].uid === uT && S2.deck[0].uid === u0);

  const S3 = G.newGame(63);
  const f3 = rigAt(S3, 0, 'boathouse', 0, 0, false);     // 🔵 {f:1}
  const p4 = rigAt(S3, 1, 'boathouse', 0, 0, true);
  r = G.act(S3, 'flip', { target: 0, pay: [1] });
  expect('翻面 ok（保持行）', r.ok === true && f3.face === 1 && f3.row === 0);
  expect('翻面支付复位', p4.res === false);
  expect('evs = pay→flip→move', r.evs.map(e => e.t).join() === 'pay,flip,move');
  expect('翻面后回牌堆底', S3.deck[16] === f3);
  expect('validate 干净', G.validate(S3).length === 0);
}

/* ---------------- 7 付费收集（R15） ---------------- */
sec('7 付费收集（R15）');
{
  const S = G.newGame(71);
  rigAt(S, 0, 'market', 0, 0, false);                    // 集市 正0°：fee [{w:1},{f:1}]，产出 1🪨
  let r = G.act(S, 'collect', { target: 0 });
  expect('无资源 → 付费收集被拒', !r.ok && r.err === '资源不足');

  rigAt(S, 2, 'woodcutter', 0, 0, true);                 // w:1
  let d = G.draw(S);
  expect('有🪵 → 可收集', d.slots[0].ops.collect.ok === true);
  r = G.act(S, 'collect', { target: 0, fee: 5 });
  expect('不存在的支付方案被拒', !r.ok && r.err === '不存在的支付方案');
  r = G.act(S, 'collect', { target: 0, fee: 0, pay: [2] });
  expect('方案 0（1🪵）成功', r.ok === true);
  expect('集市横置为资源态入底', S.deck[16].id === 'market' && S.deck[16].res === true);
  expect('付费卡复位（净剩 1 张资源）', G.resCount(S) === 1);
  const lg = S.log.filter(e => e.k === 'good').pop();
  expect('日志记录费用与产出', !!lg && lg.cost.w === 1 && lg.res.s === 1);

  const S2 = G.newGame(72);
  rigAt(S2, 0, 'market', 0, 0, false);
  rigAt(S2, 2, 'boathouse', 0, 0, true);                 // f:1
  r = G.act(S2, 'collect', { target: 0, fee: 0, pay: [2] });
  expect('方案 0（1🪵）以🐟支付被拒', !r.ok && r.err === '资源不足');
  r = G.act(S2, 'collect', { target: 0, fee: 1, pay: [2] });
  expect('方案 1（1🐟）成功', r.ok === true);

  const S3 = G.newGame(73);
  rigAt(S3, 0, 'market', 1, 1, false);                   // 集市 背180°：fee [{w:1},{f:1},{s:1}]
  rigAt(S3, 2, 'quarry', 1, 1, true);                    // s:2
  d = G.draw(S3);
  expect('三方案 OR · 有🪨 → 可收集', d.slots[0].ops.collect.ok === true && d.slots[0].ops.collect.fee.length === 3);
  r = G.act(S3, 'collect', { target: 0, pay: [2] });
  expect('自动选择可负担方案成功', r.ok === true);
  const lg3 = S3.log.filter(e => e.k === 'good').pop();
  expect('自动方案 = 1🪨', !!lg3 && lg3.cost.s === 1 && !lg3.cost.w && !lg3.cost.f);

  const S4 = G.newGame(74);
  rigAt(S4, 0, 'storehouse', 1, 1, false);               // 货栈 背180°：🟡1🪨 / 🔵1🪨 / fee [{w:2},{f:2}]
  rigAt(S4, 2, 'quarry', 1, 1, true);                    // s:2
  rigAt(S4, 3, 'woodcutter', 1, 1, true);                // w:2
  d = G.draw(S4);
  const o = d.slots[0].ops;
  expect('货栈终态 · 收集/🟡/🔵 三操作并存', o.collect.ok && o.to180.ok && o.flip.ok);
  r = G.act(S4, 'collect', { target: 0, fee: 0, pay: [3] });
  expect('货栈付费收集（2🪵）成功', r.ok === true && S4.deck[16].res === true);
}

/* ---------------- 8 资源上限（R19） ---------------- */
sec('8 资源上限（R19）');
{
  const S = G.newGame(81);
  rigAt(S, 0, 'boathouse', 0, 0, false);                 // 免费收集
  rigAt(S, 2, 'woodcutter', 0, 0, true);
  rigAt(S, 3, 'boathouse', 0, 0, true);
  rigAt(S, 4, 'quarry', 1, 0, true);
  rigAt(S, 5, 'boathouse', 1, 1, true);
  expect('银行恰 4 张', G.resCount(S) === 4);
  let d = G.draw(S);
  expect('draw 暴露上限与清单', d.res.limit === 4 && d.res.list.length === 4);
  const before = S.deck.map(c => c.uid).join();
  let r = G.act(S, 'collect', { target: 0 });
  expect('满 4 未重置 → RES_LIMIT', !r.ok && r.code === 'RES_LIMIT');
  expect('拒绝后状态不变', S.deck.map(c => c.uid).join() === before && G.resCount(S) === 4);
  r = G.act(S, 'collect', { target: 0, reset: 'nope' });
  expect('非资源卡作重置被拒', !r.ok && r.err === '只能选择资源卡重置');
  r = G.act(S, 'collect', { target: 0, reset: S.deck[0].uid });
  expect('目标卡作重置被拒', !r.ok && r.err === '只能选择资源卡重置');
  const u3 = S.deck[3].uid, r4 = S.deck[4].uid, u5 = S.deck[5].uid;
  r = G.act(S, 'collect', { target: 0, reset: r4 });
  expect('携带重置 → 收集成功', r.ok === true);
  expect('evs = reset→collect→move', r.evs.map(e => e.t).join() === 'reset,collect,move');
  const i3 = S.deck.findIndex(c => c.uid === u3), i4 = S.deck.findIndex(c => c.uid === r4), i5 = S.deck.findIndex(c => c.uid === u5);
  expect('重置卡原位复位（不重排）', S.deck[i4].res === false && i3 < i4 && i4 < i5);
  expect('收集后恒 ≤4（恰 4）', G.resCount(S) === 4);

  const S2 = G.newGame(82);
  rigAt(S2, 0, 'boathouse', 0, 0, false);
  rigAt(S2, 2, 'woodcutter', 0, 0, true);
  rigAt(S2, 3, 'boathouse', 0, 0, true);
  rigAt(S2, 4, 'quarry', 1, 0, true);
  const u2 = S2.deck[2].uid;
  r = G.act(S2, 'collect', { target: 0, reset: u2 });
  expect('不满 4 张时 reset 被忽略', r.ok === true && S2.deck.find(c => c.uid === u2).res === true && G.resCount(S2) === 4);

  const S3 = G.newGame(83);
  rigAt(S3, 0, 'market', 0, 0, false);                   // fee [{w:1},{f:1}]
  rigAt(S3, 2, 'woodcutter', 0, 0, true);
  rigAt(S3, 3, 'boathouse', 0, 0, true);
  rigAt(S3, 4, 'quarry', 1, 0, true);
  rigAt(S3, 5, 'boathouse', 1, 1, true);
  r = G.act(S3, 'collect', { target: 0, fee: 0, pay: [2] });
  expect('付费消耗后跌破 4 → 免重置成功', r.ok === true && G.resCount(S3) === 4);

  const S4 = G.newGame(84);
  rigAt(S4, 0, 'quarry', 1, 0, false);                   // 🟡 {w:1,f:2}
  rigAt(S4, 2, 'woodcutter', 0, 0, true);
  rigAt(S4, 3, 'boathouse', 1, 1, true);
  rigAt(S4, 4, 'quarry', 1, 0, true);
  rigAt(S4, 5, 'boathouse', 0, 0, true);
  r = G.act(S4, 'to180', { target: 0, pay: [2, 3] });
  expect('满 4 时升级不受限（消耗 2）', r.ok === true && G.resCount(S4) === 2);
}

/* ---------------- 9 标记循环（R11） ---------------- */
sec('9 标记循环（R11）');
{
  const S = G.newGame(91);
  let allOk = true;
  for (let i = 0; i < 16; i++) { if (!G.act(S, 'skip').ok) allOk = false; }
  expect('16 次跳过全部成功', allOk === true);
  let d = G.draw(S);
  expect('标记卡登顶', d.kind === 'marker' && d.card.id === G.MARKER && d.slots.length === 1);
  expect('首见标记 · round=1 / n=0', d.round === 1 && d.n === 0);
  let r = G.act(S, 'collect', { target: 0 });
  expect('标记卡拒绝卡牌操作', !r.ok && r.err === '回合标记卡自动结算');
  r = G.act(S, 'marker');
  expect('标记计数 → n=1', r.ok === true && G.markerOf(S).n === 1);
  expect('标记放回牌堆底', S.deck[16].id === G.MARKER);
  expect('牌堆恒 17 席（轮末仅计数、无入库）', S.deck.length === 17 && S.stored === undefined);
  expect('evs = marker→move→round', r.evs.map(e => e.t).join() === 'marker,move,round');
  expect('轮次推进 1 → 2', r.evs[2].n === 2);
  expect('日志含轮末 + 轮初', S.log.some(e => e.s === '第 1 轮结束') && S.log.some(e => e.s === '第 2 轮开始'));
  expect('validate 干净', G.validate(S).length === 0);

  const S2 = G.newGame(92);
  G.markerOf(S2).n = 7;
  markerTop(S2);
  const d2 = G.draw(S2);
  expect('n=7 时 round=8', d2.kind === 'marker' && d2.round === 8 && d2.n === 7);
  const r2 = G.act(S2, 'marker');
  expect('第 8 次 → 直接结算', r2.ok === true && S2.phase === 'settle');
  expect('标记不离场（仍置顶）', S2.deck[0].id === G.MARKER && S2.deck.length === 17);
  expect('evs 含 settle 总分', r2.evs[1].t === 'settle' && typeof r2.evs[1].total === 'number');
  expect('日志含结算行', S2.log.some(e => e.s.indexOf('结算') >= 0));
  const ds = G.draw(S2);
  expect('结算视图 · 16 行', ds.kind === 'settle' && ds.done === true && ds.score.rows.length === 16);
  expect('结算分与 evs 一致', ds.score.total === r2.evs[1].total);
  expect('结算行无 where 字段', ds.score.rows.every(x => x.where === undefined));
  expect('结算后拒绝一切操作', G.act(S2, 'skip').err === '航程已结束' && G.act(S2, 'marker').err === '航程已结束');
  expect('settle 态 validate 干净', G.validate(S2).length === 0);
}

/* ---------------- 10 结算口算与 q / 行标 ---------------- */
sec('10 结算口算与 q / 行标');
{
  const S = G.newGame(101);
  for (let i = 0; i < 16; i++) rigAt(S, i, 'woodcutter', 1, 0, false);
  let sc = G.score(S);
  expect('16×樵夫背0° = 80', sc.total === 80 && sc.rows.length === 16);
  rigAt(S, 0, 'woodcutter', 1, 0, true);
  expect('资源态按底层行态计分', G.score(S).total === 80);
  expect('分项 ⭐ 合计 = 总分', sc.rows.reduce((a, x) => a + x.star, 0) === sc.total);

  const S2 = G.newGame(102);
  for (let i = 0; i < 16; i++) rigAt(S2, i, 'boathouse', i % 2, (i >> 1) % 2, false);
  expect('船屋全行态 = 0', G.score(S2).total === 0);

  const S3 = G.newGame(103);
  for (let i = 0; i < 16; i++) rigAt(S3, i, 'boathouse', 0, 0, false);
  rigAt(S3, 0, 'temple', 1, 0, false);                   // 10⭐
  rigAt(S3, 1, 'house', 1, 0, false);                    // 6⭐
  rigAt(S3, 2, 'warehouse', 0, 1, false);                // 4⭐
  expect('神殿10 + 房屋6 + 仓库4 = 20', G.score(S3).total === 20);

  expect('q 域：非资源 = row×2', [[0, false, 0], [1, false, 2]].every(([rw, rs, q]) => G.qOf({ face: 0, row: rw, res: rs }) === q));
  expect('q 域：资源态 = 右转 90°/270°', G.qOf({ row: 0, res: true }) === 1 && G.qOf({ row: 1, res: true }) === 3);
  expect('rowLabel', G.rowLabel({ face: 1, row: 1 }) === '背 180° 行' && G.rowLabel({ face: 0, row: 0 }) === '正 0° 行');
}

/* ---------------- 11 序列化往返 ---------------- */
sec('11 序列化往返');
{
  const S = G.newGame(111);
  rigAt(S, 0, 'boathouse', 0, 0, false);
  rigAt(S, 1, 'woodcutter', 0, 0, false);
  const r = G.act(S, 'collect', { target: 1 });
  expect('前置操作成功', r.ok === true);
  const str = G.serialize(S);
  const S2 = G.deserialize(str);
  expect('往返 JSON 相等', G.serialize(S2) === str);
  expect('往返后牌堆一致', S2.deck.map(c => c.uid).join() === S.deck.map(c => c.uid).join());
  expect('往返后 validate 干净', G.validate(S2).length === 0);
  expect('往返后 draw 一致', JSON.stringify(G.draw(S2)) === JSON.stringify(G.draw(S)));
  expect('坏 JSON → null', G.deserialize('{oops') === null);
}

/* ---------------- 12 随机对局不变量（fuzz） ---------------- */
sec('12 随机对局不变量（200 seeds）');
{
  let settled = 0, viol = 0, stepsMax = 0, scoreSum = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = seeded(9000 + seed);
    const S = G.newGame(seed);
    let steps = 0;
    while (steps < 400 && S.phase === 'play') {
      steps++;
      const d = G.draw(S);
      let r;
      if (d.kind === 'marker') { r = G.act(S, 'marker'); }
      else if (d.kind === 'res') { r = G.act(S, 'reset'); }
      else {
        const cands = [];
        d.slots.forEach((s, si) => {
          if (!s || !s.ops) return;
          if (s.ops.collect.ok) cands.push({ a: 'collect', target: si, fee: s.ops.collect.fee });
          if (s.ops.to180.ok) cands.push({ a: 'to180', target: si, cost: s.ops.to180.cost });
          if (s.ops.flip.ok) cands.push({ a: 'flip', target: si, cost: s.ops.flip.cost });
          if (s.ops.skip.ok) cands.push({ a: 'skip', target: si });
        });
        const pick = cands.length ? cands[Math.floor(rnd() * cands.length)] : { a: 'skip', target: 0 };
        const payload = { target: pick.target };
        if (pick.cost) {
          const pay = autoPay(S, pick.target, pick.cost);
          if (pay) payload.pay = pay;
        }
        if (pick.fee) {
          for (let fi = 0; fi < pick.fee.length; fi++) {
            const pay = autoPay(S, pick.target, pick.fee[fi]);
            if (pay) { payload.pay = pay; payload.fee = fi; break; }
          }
        }
        r = G.act(S, pick.a, payload);
        if (!r.ok && r.code === 'RES_LIMIT') {
          const paid = payload.pay || [];
          const banks = [];
          S.deck.forEach((c, i) => {
            if (G.isCard(c) && c.res && i !== pick.target && paid.indexOf(i) < 0) banks.push(c.uid);
          });
          payload.reset = banks[Math.floor(rnd() * banks.length)];
          r = G.act(S, pick.a, payload);
        }
      }
      if (!r || !r.ok) { viol++; console.log('   seed ' + seed + ' 步 ' + steps + ' 失败: ' + (r && r.err)); break; }
      if (steps % 10 === 0 && G.validate(S).length) { viol++; break; }
      if (S.deck.length !== 17) { viol++; break; }
      if (G.resCount(S) > G.RULES.RES_LIMIT) { viol++; break; }
      if (S.deck.some(c => G.isCard(c) && [0, 1, 2, 3].indexOf(G.qOf(c)) < 0)) { viol++; break; }
    }
    if (S.phase === 'settle') {
      const end = G.draw(S);
      if (end.score.rows.length === 16) { settled++; scoreSum += end.score.total; }
      else viol++;
    }
    if (steps > stepsMax) stepsMax = steps;
  }
  expect('200 局全部到达结算', settled === 200);
  expect('无非法动作 / 状态不变式破坏', viol === 0);
  expect('步数上限安全（max ' + stepsMax + ' ≤ 400）', stepsMax <= 400);
  console.log('  · 采样：平均得分 ' + (settled ? (scoreSum / settled).toFixed(1) : '-') + ' · 最长 ' + stepsMax + ' 步（仅供参考）');
}

/* ---------------- 汇总 ---------------- */
console.log('\n断言: ' + ok + '/' + total);
if (fails.length) { console.log('失败项:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('ALL OK');
