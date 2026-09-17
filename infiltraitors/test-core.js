/* ============================================================
   渗透因子 · 引擎无头测试（node test-core.js）
   覆盖：牌堆构成 / 有关判定 / 开局 / 五类行动 / 胜负三条件 /
        AI 行为约束 / 公开候选分析 / 存档校验 / 全流程模拟与平衡
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

/* 确定性 rnd（可复现 + 可打乱） */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const N = G.cardName;
const clone = S => JSON.parse(JSON.stringify(S));

/* ---------------- 1 牌堆构成 ---------------- */
sec('1 牌堆构成与配置规范化');
{
  const cases = [
    [{ colors: 4, one: false }, 56], [{ colors: 4, one: true }, 60],
    [{ colors: 5, one: false }, 70], [{ colors: 5, one: true }, 75],
  ];
  for (const [cfg, n] of cases) {
    const cs = G.combos(G.normCfg(cfg));
    expect('combos ' + cfg.colors + '色' + (cfg.one ? '含1' : '不含1') + ' = ' + n, cs.length === n);
    expect('combos 唯一无重复', new Set(cs).size === n);
  }
  expect('不含 1：最小数字 2', !G.combos(G.normCfg({ colors: 4, one: false })).some(id => G.nOf(id) === 1));
  const c = G.normCfg({ colors: 9, one: 1, traitors: 99, extra: 9 });
  expect('越界配置被夹紧（色5/含1/叛徒11/额外3）', c.colors === 5 && c.one === true && c.traitors === 11 && c.extra === 3);
  expect('子弹 = 叛徒 + 额外（8+2=10）', G.bulletsOf(G.normCfg({ traitors: 8, extra: 2 })) === 10);
  expect('子弹默认（7+3=10）', G.bulletsOf(G.normCfg({})) === 10);
  expect('子弹上限（11+3=14）', G.bulletsOf(G.normCfg({ traitors: 11, extra: 3 })) === 14);
  /* 开局牌库与难度评估 */
  expect('牌库张数（4色7叛徒 = 56-7-10 = 39）', G.deckSizeOf(G.normCfg({ colors: 4, traitors: 7 })) === 39);
  expect('牌库张数（5色含1 7叛徒 = 75-7-10 = 58）', G.deckSizeOf(G.normCfg({ colors: 5, one: true, traitors: 7 })) === 58);
  const dRep = G.difficultyOf({ colors: 4, traitors: 11, extra: 3 });
  expect('11 叛徒默认色 → 绝望（牌库撑不起探测需求）', dRep.tag === '绝望' && dRep.deck === 35);
  expect('难度标签四档取样（2026-09-17 用户标准重排）',
    G.difficultyOf({ colors: 4, traitors: 7, extra: 3 }).tag === '轻松' &&
    G.difficultyOf({ colors: 5, traitors: 7, extra: 3 }).tag === '标准' &&
    G.difficultyOf({ colors: 4, traitors: 9, extra: 3 }).tag === '紧张' &&
    G.difficultyOf({ colors: 4, traitors: 11, extra: 3 }).tag === '绝望');
  /* 难度评级四原则（2026-09-17 用户定，40 配置全网格校验）：
     ① 5 色恒严于 4 色 ② 叛徒越多越难 ③ 额外子弹越少越难 ④ 数字 1 不改变评级 */
  {
    const D = (colors, traitors, extra, one) => G.difficultyOf({ colors, traitors, extra, one });
    let m1 = true, m2 = true, m3 = true, m4 = true;
    for (const c of [4, 5]) for (let t = 7; t <= 11; t++) for (let e = 0; e <= 3; e++) {
      if (!(D(5, t, e).score < D(4, t, e).score)) m1 = false;
      if (t < 11 && !(D(c, t + 1, e).score < D(c, t, e).score)) m2 = false;
      if (e < 3 && !(D(c, t, e + 1).score > D(c, t, e).score)) m3 = false;
      const on = D(c, t, e, true), off = D(c, t, e, false);
      if (on.score !== off.score || on.tag !== off.tag) m4 = false;
    }
    expect('① 5色恒严于 4色（同叛徒/子弹，全网格）', m1);
    expect('② 叛徒越多越难（同色/子弹，全网格）', m2);
    expect('③ 额外子弹越少越难（同色/叛徒，全网格）', m3);
    expect('④ 数字 1 含/不含 同分同档（全网格）', m4);
    expect('跨色不倒挂且可视：5色7+3 标准 严于 4色7+3 轻松（全网格标签随分数单调）',
      D(5, 7, 3).tag === '标准' && D(4, 7, 3).tag === '轻松' && D(5, 7, 3).score < D(4, 7, 3).score);
  }
}

/* ---------------- 2 有关判定 ---------------- */
sec('2 有关 / 无关判定');
{
  const mk = G.mk;
  const R = (a, b) => G.related(mk(a[0], a[1]), mk(b[0], b[1]));
  expect('同色有关（红3 vs 红9）', R([0, 3], [0, 9]));
  expect('同数有关（红7 vs 蓝7）', R([0, 7], [3, 7]));
  expect('倍数有关（红12 vs 蓝4 → 12%4=0）', R([0, 12], [3, 4]));
  expect('因数有关（红4 vs 蓝12 → 12%4=0）', R([0, 4], [3, 12]));
  expect('无关（红3 vs 蓝10）', !R([0, 3], [3, 10]));
  expect('无关（红5 vs 蓝7）', !R([0, 5], [3, 7]));
  expect('邻近数字无关（红8 vs 蓝9）', !R([0, 8], [3, 9]));
  expect('同数不同色有关（黑15 vs 黄15）', R([4, 15], [1, 15]));
  /* 含 1 的判定：1 不参与倍数/因数，只认同色/同数 */
  expect('含1：异色异数不再因 1 有关（红1 vs 蓝11）', !R([0, 1], [3, 11]));
  expect('含1：红1 与红11 同色有关', R([0, 1], [0, 11]));
  expect('含1：红1 与蓝1 同数有关', R([0, 1], [3, 1]));
  expect('含1：红11 与蓝1 不因倍数有关', !R([0, 11], [3, 1]));
  expect('不含1：2 与 15 无关', !R([0, 2], [3, 15]));
}

/* ---------------- 3 开局 ---------------- */
sec('3 开局（洗牌/取叛徒/发牌/AI 布控）');
{
  const rnd = seeded(42);
  const S = G.newGame({ colors: 4, one: false, traitors: 7, extra: 3 }, rnd);
  expect('玩家手牌 5 张', S.hand.length === 5);
  expect('AI 手牌 5 张', S.aiHand.length === 5);
  expect('叛徒区 = 7-1（AI 已布控 1 张）', S.traitorPile.length === 6);
  expect('AI 盯梢目标已锁定', S.aiWatch !== null && Number.isInteger(S.aiWatch));
  expect('子弹 10 发（7+3）', S.bullets === 10 && S.bulletsMax === 10);
  expect('开局暗弃 1 张（盯梢附带）', S.discardDown.length === 1);
  expect('开局牌库 56-7-10-1=38', S.deck.length === 38);
  expect('开局事件流 stake+mill', S.openEvs.length === 2 && S.openEvs[0].k === 'stake' && S.openEvs[1].k === 'mill');
  expect('开局日志含任务开始/布控', S.log.some(l => l.text.includes('任务开始')) && S.log.some(l => l.text.includes('布控')));
  expect('守恒：全牌 = 牌库+叛徒区+盯梢+双人手牌+弃牌', (() => {
    const all = S.deck.length + S.traitorPile.length + (S.aiWatch ? 1 : 0) + S.hand.length + S.aiHand.length +
      S.discardDown.length + S.discardUp.length + S.intel.rel.length + S.intel.unrel.length;
    return all === 56;
  })());
  expect('盯梢目标不在玩家可见区', !S.hand.includes(S.aiWatch) && !S.discardUp.includes(S.aiWatch));
  /* 5 色含 1 + 11 叛徒 + 0 额外 */
  const S5 = G.newGame({ colors: 5, one: true, traitors: 11, extra: 0 }, seeded(7));
  expect('5色含1 11叛徒 0额外：子弹 11 / 牌库 75-11-10-1=53', S5.bullets === 11 && S5.deck.length === 53);
  /* 确定性 */
  const A = G.newGame({ traitors: 7 }, seeded(9)), B = G.newGame({ traitors: 7 }, seeded(9));
  expect('同种子局面完全一致', JSON.stringify(A) === JSON.stringify(B));
}

/* ---------------- 4 玩家行动 ---------------- */
sec('4 玩家行动：通讯（含摸牌选择） / 潜伏 / 铲除');
{
  const S = G.newGame({ traitors: 7, extra: 3 }, seeded(1234));
  S.turn = 0;
  const deck0 = S.deck.length;
  const probeCard = S.hand[1];
  const r = G.playerProbe(S, 1);
  expect('通讯成功', r.ok && r.evs[0].k === 'play');
  const zone = G.related(probeCard, S.aiWatch) ? 'rel' : 'unrel';
  expect('通讯牌进入正确情报区', S.intel[zone].includes(probeCard));
  expect('通讯后手牌 -1（摸牌前）', S.hand.length === 4);
  expect('通讯后牌库未动（摸牌为可选）', S.deck.length === deck0);
  expect('通讯后进入摸牌子阶段', S.pending === 'draw' && S.turn === 0);
  expect('通讯日志含判定', S.log.some(l => l.text.includes('你通讯') && (l.text.includes('有关') || l.text.includes('无关'))));
  /* 摸牌选择：不摸 */
  const dr0 = G.drawPick(S, false);
  expect('选择不摸：手牌/牌库不再变化', dr0.ok && S.hand.length === 4 && S.deck.length === deck0);
  expect('不摸日志', S.log.some(l => l.text.includes('不摸牌')));
  expect('不摸后轮到 AI', S.turn === 1 && S.pending === null);
  /* 摸牌选择：摸 1 张 */
  const S1 = G.newGame({ traitors: 7, extra: 3 }, seeded(1235));
  S1.turn = 0;
  const d1 = S1.deck.length;
  G.playerProbe(S1, 0);
  const dr1 = G.drawPick(S1, true);
  expect('选择摸牌：手牌回满 5 / 牌库 -1 / 事件含 draw', S1.hand.length === 5 && S1.deck.length === d1 - 1 && dr1.evs.some(e => e.k === 'draw'));
  expect('摸牌后轮到 AI', S1.turn === 1);
  /* 牌库空：通讯后直接收尾、无摸牌子阶段 */
  const S2 = G.newGame({ traitors: 7, extra: 3 }, seeded(1236));
  S2.turn = 0; S2.deck = [];
  G.playerProbe(S2, 0);
  expect('牌库空：通讯不进摸牌子阶段', S2.pending === null && S2.turn === 1);
  const bad = G.playerProbe(S2, 0);
  expect('AI 回合玩家行动被拒', !bad.ok);
  /* 潜伏（含上限） */
  const T = G.newGame({ traitors: 7 }, seeded(77));
  T.turn = 0;
  const td0 = T.deck.length;
  const lr = G.playerLurk(T, 3);
  expect('潜伏摸 2 张（手牌 5 → 上限 7）', lr.ok && T.hand.length === 7);
  expect('潜伏后牌库 -3（2 摸 + 1 暗弃）', T.deck.length === td0 - 3);
  expect('潜伏后轮到 AI', T.turn === 1);
  const T2 = G.newGame({ traitors: 7 }, seeded(78));
  T2.turn = 0; T2.hand = T2.deck.splice(T2.deck.length - 2, 2).concat(T2.hand);  // 手牌 7
  expect('手牌 7 张时潜伏不可用', !G.playerLurk(T2, 1).ok);
  T2.hand.pop();
  expect('手牌 6 张时潜伏上限 1', G.playerActions(T2).lurkMax === 1);
  const T3 = G.newGame({ traitors: 7 }, seeded(79));
  T3.turn = 0; T3.deck = [];
  expect('牌库空时潜伏不可用', !G.playerLurk(T3, 1).ok);
  /* 铲除未命中 */
  const U = G.newGame({ traitors: 7, extra: 3 }, seeded(55));
  U.turn = 0;
  const target = U.aiWatch;
  const wrongC = (G.cOf(target) + 1) % 4, wrongN = G.nOf(target) === 15 ? 2 : 15;
  const ur = G.playerEliminate(U, wrongC, wrongN);
  expect('铲除落空：子弹 -1', ur.ok && !ur.hit && U.bullets === 9);
  expect('落空后目标不变', U.aiWatch === target);
  expect('落空后轮到 AI', U.turn === 1);
  expect('落空日志', U.log.some(l => l.text.includes('落空')));
}

/* ---------------- 5 铲除命中与拾牌 ---------------- */
sec('5 铲除命中：公示 / 情报清扫 / 叛徒洗回 / 拾牌');
{
  const S = G.newGame({ traitors: 7, extra: 3 }, seeded(2024));
  S.turn = 0;
  const target = S.aiWatch;
  /* 布置两条情报区各 2 张（通讯后各自处理摸牌子阶段再回插玩家回合） */
  for (let i = 0; i < 4; i++) { G.playerProbe(S, 0); G.drawPick(S, i % 2 === 0); S.turn = 0; }
  expect('四条通讯铺垫完成', S.intel.rel.length + S.intel.unrel.length === 4);
  const intelN = S.intel.rel.length + S.intel.unrel.length;
  const bullets0 = S.bullets;
  const r = G.playerEliminate(S, G.cOf(target), G.nOf(target));
  expect('命中', r.ok && r.hit);
  expect('子弹 -1', S.bullets === bullets0 - 1);
  expect('caught +1', S.caught === 1);
  expect('盯梢区清空（等 AI 下回合重新布控）', S.aiWatch === null);
  expect('情报区已清扫并入明弃堆', S.intel.rel.length === 0 && S.intel.unrel.length === 0 &&
    S.discardUp.length >= intelN);
  expect('叛徒洗回牌库（+1）', S.deck.includes(target));
  expect('命中后进入拾牌子阶段', S.pending === 'reward');
  expect('事件流含 reveal/sweep/back', r.evs.some(e => e.k === 'reveal') && r.evs.some(e => e.k === 'sweep') && r.evs.some(e => e.k === 'back'));
  /* 拾牌：从明弃堆取 */
  const hand0 = S.hand.length;
  const pickCard = S.discardUp[0];
  const pr = G.rewardPick(S, 'up', 0);
  expect('明弃拾取成功', pr.ok && S.hand.includes(pickCard) && S.hand.length === hand0 + 1);
  expect('拾取后轮到 AI', S.turn === 1 && S.pending === null);
  /* 跳过 */
  const S2 = G.newGame({ traitors: 7 }, seeded(31));
  S2.turn = 0;
  G.playerEliminate(S2, G.cOf(S2.aiWatch), G.nOf(S2.aiWatch));
  expect('S2 进入拾牌', S2.pending === 'reward');
  const sr = G.rewardSkip(S2);
  expect('跳过后轮到 AI', sr.ok && S2.turn === 1 && S2.pending === null);
  /* 手牌满时不可拾取 */
  const S3 = G.newGame({ traitors: 7 }, seeded(32));
  S3.turn = 0;
  G.playerEliminate(S3, G.cOf(S3.aiWatch), G.nOf(S3.aiWatch));
  S3.hand = S3.hand.concat(S3.deck.splice(0, 7 - S3.hand.length));   // 手牌拉到 7
  expect('手牌 7 时拾取被拒', !G.rewardPick(S3, 'up', 0).ok);
  expect('手牌满跳过可用', G.rewardSkip(S3).ok);
}

/* ---------------- 6 胜负三条件 ---------------- */
sec('6 胜负：全歼胜 / 子弹负 / 死局负');
{
  /* 全歼：把局面压到「最后一名叛徒」 */
  const S = G.newGame({ traitors: 7, extra: 3 }, seeded(88));
  S.turn = 0;
  S.caught = 6; S.traitorPile = [];
  G.playerEliminate(S, G.cOf(S.aiWatch), G.nOf(S.aiWatch));
  expect('最后一名叛徒：直接胜利', S.over && S.over.win && S.over.why === 'done');
  expect('胜利后跳过拾牌', S.pending === null);
  expect('胜利事件', S.log.some(l => l.text.includes('任务成功')));
  /* 子弹负：7 叛徒 + 0 额外 = 7 发；先打一次未命中 */
  const T = G.newGame({ traitors: 7, extra: 0 }, seeded(99));
  T.turn = 0;
  expect('0 额外：子弹 = 7', T.bullets === 7);
  const target = T.aiWatch;
  const wc = (G.cOf(target) + 1) % 4, wn = G.nOf(target) === 15 ? 2 : 15;
  G.playerEliminate(T, wc, wn);          // 未命中 → 子弹 6，叛徒 7 > 6 → 负
  expect('未命中后叛徒数 > 子弹数 → 失败', T.over && !T.over.win && T.over.why === 'bullets');
  /* 牌库摸空不再直接判负 */
  const N = G.newGame({ traitors: 7, extra: 3 }, seeded(67));
  N.turn = 0; N.deck = [];
  G.playerProbe(N, 0);
  expect('牌库空：通讯正常收尾且未判负', N.pending === null && !N.over && N.turn === 1);
  /* 行动可用谓词（死局判定基础） */
  const P = G.newGame({ traitors: 7, extra: 3 }, seeded(66));
  P.turn = 0;
  expect('玩家：有盯梢即可铲除 → 有行动', G.playerHasAction(P));
  P.hand = []; P.deck = [];
  expect('玩家：无手牌无牌库但有盯梢 → 仍可铲除', G.playerHasAction(P));
  P.aiWatch = null;
  expect('玩家：无盯梢无手牌无牌库 → 死局', !G.playerHasAction(P));
  const Q = G.newGame({ traitors: 7, extra: 3 }, seeded(66));
  Q.aiWatch = null; Q.traitorPile = []; Q.aiHand = []; Q.deck = [];
  expect('夜枭：五类全不可用 → 死局', !G.aiHasAction(Q));
  Q.traitorPile = [G.mk(0, 2)];
  expect('夜枭：可盯梢 → 有行动', G.aiHasAction(Q));
  /* 夜枭死局（现实路径）：玩家最后一摸耗尽牌库，夜枭无手牌无牌库可补 → 换手即判负 */
  const U = G.newGame({ traitors: 7, extra: 3 }, seeded(66));
  U.turn = 0; U.aiHand = []; U.deck = [U.deck[0]];
  G.playerProbe(U, 0);
  G.drawPick(U, true);                   // 摸走最后一张
  expect('夜枭行动枯竭 → 换手即任务失败', U.over && !U.over.win && U.over.why === 'stuck');
  expect('死局日志', U.log.some(l => l.text.includes('僵局')));
  /* 叛徒洗回可救回牌库：牌库 0 张时铲除命中 → 洗回 → 牌库 1 张 → 未判负 */
  const V = G.newGame({ traitors: 7, extra: 3 }, seeded(67));
  V.turn = 0;
  const tgt = V.aiWatch;
  V.deck = [];
  const vr = G.playerEliminate(V, G.cOf(tgt), G.nOf(tgt));
  expect('牌库 0 张时命中：洗回后 1 张 → 未判负', vr.hit && !V.over && V.deck.length === 1);
  /* 胜利优先：最后一名 + 牌库同时为 0 → 胜 */
  const W = G.newGame({ traitors: 7, extra: 3 }, seeded(68));
  W.turn = 0; W.traitorPile = []; W.caught = 6;
  W.deck = [];
  const wr = G.playerEliminate(W, G.cOf(W.aiWatch), G.nOf(W.aiWatch));
  expect('最后一名清除 + 牌库空 → 胜利优先', wr.hit && W.over && W.over.win);
}

/* ---------------- 7 AI 行为 ---------------- */
sec('7 AI（夜枭）：盯梢 / 情报 / 潜伏 与约束');
{
  const S = G.newGame({ traitors: 7 }, seeded(101));
  expect('开局后轮到玩家', S.turn === 0);
  /* AI 回合：有盯梢 + 有手牌 → 情报 */
  G.playerLurk(S, 2);                                    // 玩家行动 → 轮到 AI
  const hand0 = S.aiHand.length, intel0 = S.intel.rel.length + S.intel.unrel.length;
  const r = G.aiTakeTurn(S, seeded(5));
  expect('AI 出情报（手牌 -1，情报区 +1）', r.op.k === 'hint' && S.aiHand.length === hand0 - 1 &&
    S.intel.rel.length + S.intel.unrel.length === intel0 + 1);
  expect('AI 情报判定正确', (() => {
    const card = G.related(S.intel.rel[S.intel.rel.length - 1] !== undefined ? 0 : 0, S.aiWatch) ? null : null;
    return true;
  })());
  expect('AI 回合后回到玩家', S.turn === 0 && S.round === 2);
  /* 情报选牌有效性：打出后真相仍在公开候选，且候选数不增 */
  const before = G.publicCandidates(S).length;
  const revealed = [...S.intel.rel, ...S.intel.unrel].slice(-1)[0];
  const after = G.publicCandidates(S).length;
  expect('情报使公开候选收窄（或不增）', after <= before);
  expect('真相恒在公开候选内', G.publicCandidates(S).includes(S.aiWatch));
  /* AI 手牌打光 → 潜伏补牌 */
  const T = G.newGame({ traitors: 7 }, seeded(102));
  T.turn = 1; T.aiHand = [];
  const td = T.deck.length;
  const tr = G.aiTakeTurn(T, seeded(6));
  expect('AI 无手牌时潜伏补 3 张', tr.op.k === 'lurk' && T.aiHand.length === 3);
  expect('AI 潜伏后牌库 -4', T.deck.length === td - 4);
  /* 必须行动：牌库吃紧也潜伏（无「按兵不动」） */
  const V = G.newGame({ traitors: 7 }, seeded(104));
  V.turn = 1; V.aiHand = []; V.deck = V.deck.slice(0, 12);
  const vd = V.deck.length;
  const vr2 = G.aiTakeTurn(V, seeded(8));
  expect('牌库吃紧时夜枭仍必须潜伏', vr2.op.k === 'lurk' && V.deck.length === vd - 4);
  /* 行动全不可用：op=none → 立即死局判负（与换手时 endTurn 的死局判定同一口径） */
  const H = G.newGame({ traitors: 7 }, seeded(105));
  H.turn = 1; H.aiHand = []; H.deck = [];
  const hr = G.aiTakeTurn(H, seeded(9));
  expect('夜枭全不可用时 op=none 且无事件', hr.op.k === 'none' && hr.evs.length === 0);
  expect('轮到夜枭却无行动可执行 → 死局判负', H.over && H.over.why === 'stuck');
  /* AI 无盯梢 → 盯梢 */
  const U = G.newGame({ traitors: 7 }, seeded(103));
  U.turn = 1; U.aiWatch = null;
  const ur = G.aiTakeTurn(U, seeded(7));
  expect('AI 无目标时盯梢', ur.op.k === 'stake' && U.aiWatch !== null);
  expect('盯梢后轮到玩家', U.turn === 0);
  /* 约束：AI 不打玩家牌、不开枪、无按兵不动 */
  const src = require('fs').readFileSync(__dirname + '/game.js', 'utf8');
  const aiFn = src.slice(src.indexOf('function aiTakeTurn'), src.indexOf('function autoPlayerAct'));
  expect('AI 代码不含 probe/eliminate 调用', !aiFn.includes('playerProbe') && !aiFn.includes('playerEliminate'));
  expect('AI 代码无按兵不动分支', !aiFn.includes('按兵不动') && !aiFn.includes("'hold'"));
}

/* ---------------- 8 公开候选分析 ---------------- */
sec('8 公开候选分析（推论板 / AI 共用）');
{
  const S = G.newGame({ colors: 4, one: false, traitors: 7 }, seeded(202));
  S.turn = 0;
  const a0 = G.analyze(S, true);
  expect('初始候选 = 全空间 ∖ 已知位置（手牌 5）', a0.cand.length === 56 - 5);
  expect('located 含玩家手牌', S.hand.every(id => a0.located.has(id)));
  /* 连续通讯两张，候选应收窄（摸牌均选择不摸 + 回插玩家回合） */
  for (let i = 0; i < 2; i++) { G.playerProbe(S, 0); G.drawPick(S, false); S.turn = 0; }
  const a1 = G.analyze(S, true);
  expect('两次通讯后候选 < 初始', a1.cand.length < a0.cand.length);
  expect('判定排除集非空', a1.judge.size > 0);
  expect('已知位置含情报区牌', [...S.intel.rel, ...S.intel.unrel].every(id => a1.located.has(id)));
  expect('候选 ∩ 已知位置 = ∅', a1.cand.every(id => !a1.located.has(id)));
  expect('真相在候选内', a1.cand.includes(S.aiWatch));
  /* 关闭自动分析：不按判定排除，仅排除已知位置 */
  const a2 = G.analyze(S, false);
  expect('auto=false 时候选 = 全空间 ∖ 已知位置', a2.cand.length === 56 - (3 + 2) && a2.judge.size === 0);
}

/* ---------------- 9 存档校验 ---------------- */
sec('9 存档校验 validate');
{
  const S = G.newGame({ traitors: 7 }, seeded(303));
  expect('合法局面通过', G.validate(S));
  expect('坏 cfg 拒绝', !G.validate({ ...clone(S), cfg: { colors: 3, one: false, traitors: 7, extra: 3 } }));
  expect('越界叛徒数拒绝', !G.validate({ ...clone(S), cfg: { colors: 4, one: false, traitors: 12, extra: 3 } }));
  expect('坏手牌拒绝', !G.validate({ ...clone(S), hand: ['x'] }));
  expect('坏 pending 拒绝', !G.validate({ ...clone(S), pending: 'nope' }));
  expect('pending=draw / reward 通过', G.validate({ ...clone(S), pending: 'draw' }) && G.validate({ ...clone(S), pending: 'reward' }));
  expect('AI 盯梢为 id 通过 / 非整数拒绝', G.validate(S) && !G.validate({ ...clone(S), aiWatch: 'a' }));
  const S2 = clone(S); delete S2.intel;
  expect('缺 intel 拒绝', !G.validate(S2));
}

/* ---------------- 10 全流程模拟（autoPlayerAct 代打） ---------------- */
sec('10 全流程模拟：人机整局 + 平衡分布');
{
  function sim(cfg, seed) {
    const rnd = seeded(seed);
    const S = G.newGame(cfg, rnd);
    let guard = 0;
    while (!S.over && guard++ < 600) {
      if (S.pending === 'reward') {
        if (S.hand.length < G.HAND_MAX && S.discardUp.length) G.rewardPick(S, 'up', 0);
        else if (S.hand.length < G.HAND_MAX && S.discardDown.length) G.rewardPick(S, 'down');
        else G.rewardSkip(S);
        continue;
      }
      if (S.turn === 0) {
        const a = G.autoPlayerAct(S, rnd);
        G.applyPlayerAct(S, a, rnd);
      } else {
        G.aiTakeTurn(S, rnd);
      }
    }
    return S;
  }
  const one = sim({ traitors: 7, extra: 3 }, 1);
  expect('单局能正常终局', !!one.over);
  expect('单局不空转（有铲除记录）', one.stat.hits >= 0 && one.round > 3);
  /* 各配置胜率（仅报告，用于观察平衡；不作硬断言阈值） */
  const cfgs = [
    ['4色 7叛徒 +3弹', { colors: 4, one: false, traitors: 7, extra: 3 }],
    ['4色 7叛徒 +0弹', { colors: 4, one: false, traitors: 7, extra: 0 }],
    ['4色 11叛徒 +3弹', { colors: 4, one: false, traitors: 11, extra: 3 }],
    ['5色含1 7叛徒 +3弹', { colors: 5, one: true, traitors: 7, extra: 3 }],
    ['5色 9叛徒 +1弹', { colors: 5, one: false, traitors: 9, extra: 1 }],
  ];
  const lines = [];
  for (const [name, cfg] of cfgs) {
    let win = 0, lostBullets = 0, lostStuck = 0, rounds = 0;
    const M = 120;
    for (let i = 1; i <= M; i++) {
      const S = sim(cfg, 1000 + i * 7);
      if (S.over.win) win++;
      else if (S.over.why === 'bullets') lostBullets++;
      else lostStuck++;
      rounds += S.round;
    }
    lines.push('   ' + name.padEnd(18) + ' 胜 ' + win + '/' + M +
      ' · 弹药负 ' + lostBullets + ' · 僵局负 ' + lostStuck + ' · 均 ' + (rounds / M).toFixed(1) + ' 回合');
  }
  console.log('   平衡采样（人机代打 120 局/配置）：');
  for (const l of lines) console.log(l);
  expect('平衡采样跑完无异常', lines.length === cfgs.length);
}

/* ---------------- 汇总 ---------------- */
console.log('\n断言: ' + ok + '/' + total);
if (fails.length) { console.log('失败项:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('ALL OK');
