/* ============================================================
   煞有其时 That Time You Killed Me · 规则引擎（纯逻辑，浏览器+Node 通用）
   时空 e: 0=过去 1=现在 2=未来（相邻互通，0 与 2 不相邻）
   格子 i: 0..15 行主序（0=1号格左上，15=16号格右下）
   棋子: {c:0|1} 0=黑方 1=白方；每方 7 子 = 开局3(盘上) + 4(备用分身)
   阶段: select(选子) → act(行动) → focus(移焦点) → over
   规则要点：
     - 选焦点时空内己子(须≥1合法行动)，同一棋子连续行动，至多2次
     - 执行1次后无合法行动 → 可结束行动(canEnd/endActions)
     - 移动撞对方子触发推链：撞墙前端死、同色相邻段悖论死；己子可被推死
     - 穿越仅相邻时空同编号格，目标有子不可穿；逆时穿越(未来→现在→过去)留分身耗备用
     - 行动结束(两次行动/提前结束/空过)与移焦点后即判：一方在≥2时空无子判负，双方同时满足判平局
   ============================================================ */
'use strict';
const G = (() => {
  const ERAS = ['过去', '现在', '未来'];
  const CN = ['黑', '白'];          // 子色单字
  const NAMES = ['黑方', '白方'];    // 玩家名
  const DI = { up: -4, down: 4, left: -1, right: 1 };
  const row = i => i >> 2;
  const col = i => i & 3;
  const ok = (i, d) => d === 'up' ? row(i) > 0 : d === 'down' ? row(i) < 3
    : d === 'left' ? col(i) > 0 : col(i) < 3;
  const newBoard = () => ({ cell: Array(16).fill(null), pl: Array(16).fill(null), sd: Array(16).fill(0) });
  // pl = 植物层（模组用，如 {k:'bush'}/{k:'tree',down:0|1}），sd = 种子层（模组用，0/1）
  const cloneState = S => structuredClone(S);
  const LOGMAX = 60;
  function logPush(S, text) {                       // 事件日志（纯叙事，无引导语）
    S.log.push({ no: S.turnNo, p: S.turn, text });
    if (S.log.length > LOGMAX) S.log.splice(0, S.log.length - LOGMAX);
  }

  /* ---- 模组注册表：一个模组一个文件，regMod 注入钩子（见 mods/*.js）。
     基础玩法不启用任何模组时，全部委托点直接落到本文件的基础实现，行为逐字节不变。
     模组钩子（均可选）：legalActions / applyAction / evalState / sameLayout / hydrate
     hydrate(S)：newGame 与存档恢复后补齐模组数据层（pl/sd/种子池等） ---- */
  const MODULES = [];
  const MOD_MAP = {};
  function regMod(m) { if (!MOD_MAP[m.id]) { MOD_MAP[m.id] = m; MODULES.push(m); } }
  const hookOf = (S, name) => {
    for (const id of S.mods || []) { const m = MOD_MAP[id]; if (m && m[name]) return m; }
    return null;
  };
  function hydrateMods(S) {
    if (!S.mods) S.mods = [];
    for (const id of S.mods) { const m = MOD_MAP[id]; if (m && m.hydrate) m.hydrate(S); }
  }

  function newGame(mode = 'local2p', rnd = Math.random, mods) {
    const first = rnd() < 0.5 ? 0 : 1;
    const S = {
      mode, first, turn: first, turnNo: 1,
      mods: mods ? mods.slice() : [],
      focus: [2, 0],                       // [黑焦点时空=未来, 白焦点时空=过去]
      boards: [newBoard(), newBoard(), newBoard()],
      spares: [4, 4], dead: [0, 0],        // 备用分身 / 阵亡（盘上+备用+阵亡=7）
      stage: 'select', sel: null, acted: 0,
      over: null, log: [],                       // 事件日志 {no:回合,p:玩家,text}，UI 展示最新一条/抽屉
    };
    for (let e = 0; e < 3; e++) { S.boards[e].cell[0] = { c: 1 }; S.boards[e].cell[15] = { c: 0 }; } // 白1号格/黑16号格
    hydrateMods(S);
    logPush(S, '对局开始，' + NAMES[first] + '先手');
    return S;
  }

  const pc = (S, e, i) => S.boards[e].cell[i];
  function countOn(S, c) { let n = 0; for (const b of S.boards) for (const p of b.cell) if (p && p.c === c) n++; return n; }
  function colorEmptyEras(S, c) {
    let n = 0;
    for (let e = 0; e < 3; e++) {
      let has = false;
      for (const p of S.boards[e].cell) if (p && p.c === c) { has = true; break; }
      if (!has) n++;
    }
    return n;
  }

  /* 某格的合法行动（须是当前行动方的子）。模组委托：启用模组时由模组全量计算 */
  function legalActions(S, era, i) {
    const m = hookOf(S, 'legalActions');
    return m ? m.legalActions(S, era, i) : baseLegalActions(S, era, i);
  }
  function baseLegalActions(S, era, i) {
    const me = S.turn, p = pc(S, era, i);
    if (!p || p.c !== me) return [];
    const b = S.boards[era], out = [];
    for (const d of Object.keys(DI)) {
      if (!ok(i, d)) continue;
      const to = i + DI[d], t = b.cell[to];
      if (!t || t.c !== me) out.push({ t: 'move', d, to });   // 空格 or 推挤对方（含推链里有己子）
    }
    for (const e2 of [era - 1, era + 1]) {
      if (e2 < 0 || e2 > 2) continue;
      if (S.boards[e2].cell[i]) continue;                     // 目标格有任何子不可穿
      if (e2 < era && S.spares[me] <= 0) continue;            // 逆时需要分身备用
      out.push({ t: 'travel', e2 });
    }
    return out;
  }

  function selectablePieces(S) {
    const me = S.turn, e = S.focus[me], out = [];
    for (let i = 0; i < 16; i++) {
      const p = pc(S, e, i);
      if (p && p.c === me && legalActions(S, e, i).length) out.push({ era: e, i });
    }
    return out;
  }
  const needPass = S => S.stage === 'select' && selectablePieces(S).length === 0;
  const canEnd = S => S.stage === 'act' && S.sel && S.acted >= 1 && S.acted < 2
    && legalActions(S, S.sel.era, S.sel.i).length === 0;

  /* 胜负判定：行动结束(两次行动/提前结束/空过)与移焦点后立即结算。
     双方同时 ≥2 时空无子 → 平局；否则行动方(当前回合方)在后者判负。终局返回 true */
  function judgeEnd(S) {
    if (S.over) return true;
    const cur = S.turn, opp = 1 - cur;
    const curGone = colorEmptyEras(S, cur) >= 2, oppGone = colorEmptyEras(S, opp) >= 2;
    if (oppGone && curGone) {
      S.over = { draw: true }; S.stage = 'over';
      logPush(S, '平局｜黑白双方在 ≥2 个时空都已没有棋子');
      return true;
    }
    if (oppGone) {
      S.over = { winner: cur }; S.stage = 'over';
      logPush(S, NAMES[cur] + '获胜｜' + NAMES[opp] + '在 ≥2 个时空已无棋子');
      return true;
    }
    if (curGone) {
      S.over = { winner: opp }; S.stage = 'over';
      logPush(S, NAMES[opp] + '获胜｜' + NAMES[cur] + '在 ≥2 个时空已无棋子');
      return true;
    }
    return false;
  }
  const focusTargets = S => [0, 1, 2].filter(e => e !== S.focus[S.turn]); // 合法焦点：除当前外另两时空（UI 仅在 focus 阶段展示）

  function selectPiece(S, era, i) {
    if (S.stage !== 'select') return false;
    if (era !== S.focus[S.turn]) return false;
    const p = pc(S, era, i);
    if (!p || p.c !== S.turn || !legalActions(S, era, i).length) return false;
    S.sel = { era, i }; S.acted = 0; S.stage = 'act';
    return true;
  }

  /* ---- 移动 + 推挤结算（基础版，返回事件流供演出；模组内部经 plan 裁决后调用） ---- */
  function baseDoMove(S, era, from, d) {
    const me = S.turn, b = S.boards[era], to = from + DI[d];
    const evs = [];
    const mover = b.cell[from];
    b.cell[from] = null;
    // 推链：目标格被占时才成链，沿方向连续被占格；目标为空则无链（仅落脚）
    const chain = [];
    if (b.cell[to]) {
      chain.push(to);
      let x = to;
      while (ok(x, d) && b.cell[x + DI[d]]) { x += DI[d]; chain.push(x); }
    }
    const pairDead = new Set(), deathSet = new Set();
    for (let k = 0; k < chain.length - 1; k++) {
      if (b.cell[chain[k]].c === b.cell[chain[k + 1]].c) { pairDead.add(k); pairDead.add(k + 1); deathSet.add(k); deathSet.add(k + 1); }
    }
    const wallLast = chain.length && !ok(chain[chain.length - 1], d) ? chain.length - 1 : -1;
    if (wallLast >= 0 && !deathSet.has(wallLast)) deathSet.add(wallLast);
    // 先移除死者
    for (const k of deathSet) {
      const p = b.cell[chain[k]]; if (!p) continue;
      evs.push({ k: 'die', era, idx: chain[k], c: p.c, why: pairDead.has(k) ? 'paradox' : 'wall' });
      b.cell[chain[k]] = null; S.dead[p.c]++;
    }
    // 幸存链整体推进（自前向后腾位）
    for (let k = chain.length - 1; k >= 0; k--) {
      if (deathSet.has(k)) continue;
      const p = b.cell[chain[k]]; if (!p) continue;
      const nxt = chain[k] + DI[d];
      b.cell[nxt] = p; b.cell[chain[k]] = null;
      evs.push({ k: 'step', era, c: p.c, from: chain[k], to: nxt });
    }
    b.cell[to] = mover;
    evs.push({ k: 'move', era, c: me, from, to });
    return evs;
  }

  function baseDoTravel(S, era, i, e2) {
    const me = S.turn, evs = [];
    const mover = S.boards[era].cell[i];
    S.boards[era].cell[i] = null;
    if (e2 < era) {                       // 逆时穿越：出发格留分身
      S.spares[me]--;
      S.boards[era].cell[i] = { c: me };
      evs.push({ k: 'clone', era, idx: i, c: me });
    }
    S.boards[e2].cell[i] = mover;
    evs.push({ k: 'travel', era, c: me, from: era, toEra: e2, idx: i });
    return evs;
  }

  const actEq = (a, b) => a.t === b.t && (a.t === 'move' ? a.d === b.d && a.to === b.to : a.e2 === b.e2);

  /* 模组委托：启用模组时由模组全量执行（含播种/拨除等新行动） */
  function applyAction(S, act) {
    const m = hookOf(S, 'applyAction');
    return m ? m.applyAction(S, act) : baseApplyAction(S, act);
  }
  function baseApplyAction(S, act) {
    if (S.stage !== 'act' || !S.sel) return { ok: false, evs: [] };
    const { era, i } = S.sel;
    const legal = legalActions(S, era, i);
    if (!legal.some(a => actEq(a, act))) return { ok: false, evs: [] };
    const evs = act.t === 'move' ? baseDoMove(S, era, i, act.d) : baseDoTravel(S, era, i, act.e2);
    const nera = act.t === 'move' ? era : act.e2;
    const ni = act.t === 'move' ? act.to : i;
    S.acted++;
    logPush(S, baseSummarize(S, evs));
    if (S.acted >= 2) {
      S.sel = null;
      if (!judgeEnd(S)) S.stage = 'focus';   // 两次行动结束即判，未终局才进入移焦点
    } else {
      S.sel = { era: nera, i: ni };   // 无后续行动时由 UI 提供【结束行动】（canEnd）
    }
    return { ok: true, evs };
  }

  function baseSummarize(S, evs) {
    const cname = c => CN[c];
    const move = evs.find(e => e.k === 'move');
    const parts = [];
    if (move) parts.push(cname(move.c) + '子' + (move.from + 1) + '→' + (move.to + 1));
    const died = evs.filter(e => e.k === 'die');
    if (died.length) {
      const byWhy = {};
      for (const e of died) (byWhy[e.why] = byWhy[e.why] || []).push(cname(e.c) + (e.idx + 1));
      for (const why of ['paradox', 'wall']) if (byWhy[why]) parts.push(byWhy[why].join('、') + (why === 'paradox' ? ' 悖论出局' : ' 撞墙出局'));
    }
    const trav = evs.find(e => e.k === 'travel');
    if (trav) {
      const clone = evs.find(e => e.k === 'clone');
      parts.push(cname(trav.c) + '子穿越→' + ERAS[trav.toEra] + (trav.idx + 1) + '格' + (clone ? '（分身留' + ERAS[trav.era] + '）' : ''));
    }
    return parts.join('，');
  }

  function endActions(S) {
    if (!canEnd(S)) return false;
    S.sel = null;
    logPush(S, NAMES[S.turn] + '提前结束行动');
    if (!judgeEnd(S)) S.stage = 'focus';
    return true;
  }

  function doPass(S) {
    if (!needPass(S)) return false;
    logPush(S, NAMES[S.turn] + '焦点时空无子可行动，本回合空过');
    if (!judgeEnd(S)) S.stage = 'focus';
    return true;
  }

  /* 移焦点 → 换手；终点结算交由 judgeEnd（行动结束处已判，此处兜底旧存档） */
  function moveFocus(S, e) {
    if (S.stage !== 'focus') return { ok: false, over: false };
    if (e !== 0 && e !== 1 && e !== 2 || e === S.focus[S.turn]) return { ok: false, over: false };
    const cur = S.turn, opp = 1 - cur;
    S.focus[cur] = e;
    if (judgeEnd(S)) return { ok: true, over: true };
    S.turn = opp; S.turnNo++; S.sel = null; S.acted = 0;
    if (selectablePieces(S).length) {
      S.stage = 'select';
    } else {
      S.stage = 'focus'; // 新回合方也空过，交由其移动焦点（UI 自动 doPass）
      logPush(S, NAMES[opp] + '新回合焦点时空无子，将自动空过');
    }
    return { ok: true, over: false };
  }

  /* ============ 人机（轻启发）：返回操作序列，UI 负责分步执行 ============ */
  /* 模组委托：启用的模组可在基础估值上叠加自己的权重 */
  function evalState(S, me, rnd) {
    const m = hookOf(S, 'evalState');
    return m ? m.evalState(S, me, rnd) : baseEvalState(S, me, rnd);
  }
  function baseEvalState(S, me, rnd) {
    const opp = 1 - me;
    const oe = colorEmptyEras(S, opp), meE = colorEmptyEras(S, me);
    if (oe >= 2 && meE >= 2) return -1e6;   // 平局：比任何活局差，但优于判负（-1e7）
    if (oe >= 2) return 1e7;
    if (meE >= 2) return -1e7;
    let v = 0;
    v += 120 * (oe - meE);                          // 时空控制
    v += 26 * (countOn(S, me) - countOn(S, opp));   // 子力差
    v += 4 * (S.spares[me] - S.spares[opp]);
    return v;
  }

  function bestFocus(S, me, rnd) {
    let best = -1, bestV = -Infinity;
    for (const e of focusTargets(S)) {
      // 焦点 = 己方下一回合的出发点：落在无己子时空 → 下回合必空过（白丢行动回合），重罚；
      // 有己子时空按机动性（己子数 + 合法行动数）加分，偏向下一步更灵活的落点
      let mob = 0;
      for (let i = 0; i < 16; i++) {
        const p = S.boards[e].cell[i];
        if (p && p.c === me) mob += 1 + legalActions(S, e, i).length;
      }
      const T = cloneState(S);
      const r = moveFocus(T, e);
      const v = evalState(T, me, rnd) + 25 * mob + (rnd() * 4 - 2);
      if (v > bestV) { bestV = v; best = e; }
    }
    return best;
  }

  /* 三盘面布子是否逐格完全相同（识别"折返一趟 = 净零"的行动对）。
     模组委托：启用的模组追加比较自己的数据层 */
  function sameLayout(A, B) {
    const m = hookOf(A, 'sameLayout');
    return m ? m.sameLayout(A, B) : baseSameLayout(A, B);
  }
  function baseSameLayout(A, B) {
    for (let e = 0; e < 3; e++) {
      const ca = A.boards[e].cell, cb = B.boards[e].cell;
      for (let i = 0; i < 16; i++) {
        const a = ca[i] ? ca[i].c : -1, b = cb[i] ? cb[i].c : -1;
        if (a !== b) return false;
      }
    }
    return true;
  }

  function aiPlan(S, rnd = Math.random) {
    const me = S.turn;
    // 上回合换手后新回合方无子可动（moveFocus 已自动置 focus）→ 仅需移焦点
    if (S.stage === 'focus') return [{ op: 'focus', e: bestFocus(S, me, rnd) }];
    // 断点续跑：存档恢复时 AI 可能停在 act 中途（已选子，第1次行动执行前后）→ 从当前子收尾
    if (S.stage === 'act' && S.sel) {
      const firsts = S.acted === 0 ? legalActions(S, S.sel.era, S.sel.i) : [null];
      let best = null, bestV = -Infinity;
      for (const a1 of firsts) {
        const T = cloneState(S);
        if (a1) applyAction(T, a1);
        const rest = T.stage === 'act' ? legalActions(T, T.sel.era, T.sel.i) : [];
        const tails = rest.length ? rest.map(a => ({ a2: a })) : [{ a2: null }];
        for (const tail of tails) {
          const U = cloneState(T);
          if (tail.a2) applyAction(U, tail.a2);
          else if (!endActions(U)) continue;
          const wasted = !!tail.a2 && sameLayout(U, S);
          const v = evalState(U, me, rnd) + rnd() * 3 - (wasted ? 12 : 0);
          if (v > bestV) {
            bestV = v;
            best = (a1 ? [{ op: 'act', act: a1 }] : [])
              .concat(tail.a2 ? [{ op: 'act', act: tail.a2 }] : [{ op: 'end' }]);
            best.push({ op: 'focus', e: bestFocus(U, me, rnd) });
          }
        }
      }
      return best || [{ op: 'end' }, { op: 'focus', e: bestFocus(S, me, rnd) }];
    }
    if (needPass(S)) return [{ op: 'pass' }, { op: 'focus', e: bestFocus(S, me, rnd) }];
    let bestOps = null, bestV = -Infinity;
    for (const p of selectablePieces(S)) {
      for (const a1 of legalActions(S, p.era, p.i)) {
        const T = cloneState(S);
        selectPiece(T, p.era, p.i); applyAction(T, a1);
        const rest = T.stage === 'act' ? legalActions(T, T.sel.era, T.sel.i) : [];
        const tails = rest.length ? rest.map(a => ({ a2: a })) : [{ a2: null }];
        for (const tail of tails) {
          const U = cloneState(T);
          if (tail.a2) applyAction(U, tail.a2); else if (!endActions(U)) continue;
          // 折返判定：两动后布子与回合初完全一致 = 先左再右式净零空耗。
          // 罚 12：> 抖动噪声 rnd()*3 打破平局，< 子力差 26，宁可空耗也不自损
          const wasted = !!tail.a2 && sameLayout(U, S);
          const fe = bestFocus(U, me, rnd);
          const v = evalState(U, me, rnd) + rnd() * 3 - (wasted ? 12 : 0);
          if (v > bestV) {
            bestV = v;
            bestOps = [{ op: 'select', era: p.era, i: p.i }, { op: 'act', act: a1 }]
              .concat(tail.a2 ? [{ op: 'act', act: tail.a2 }] : [{ op: 'end' }])
              .concat([{ op: 'focus', e: fe }]);
          }
        }
      }
    }
    return bestOps || [{ op: 'pass' }, { op: 'focus', e: bestFocus(S, me, rnd) }];
  }

  function randomPlan(S, rnd = Math.random) {
    const me = S.turn;
    if (S.stage === 'focus') return [{ op: 'focus', e: focusTargets(S)[Math.floor(rnd() * 2)] }];
    if (needPass(S)) return [{ op: 'pass' }, { op: 'focus', e: focusTargets(S)[Math.floor(rnd() * 2)] }];
    const pieces = selectablePieces(S);
    const p = pieces[Math.floor(rnd() * pieces.length)];
    const a1 = legalActions(S, p.era, p.i);
    const act1 = a1[Math.floor(rnd() * a1.length)];
    const T = cloneState(S);
    selectPiece(T, p.era, p.i); applyAction(T, act1);
    const rest = T.stage === 'act' ? legalActions(T, T.sel.era, T.sel.i) : [];
    const ops = [{ op: 'select', era: p.era, i: p.i }, { op: 'act', act: act1 }];
    if (rest.length) {
      const act2 = rest[Math.floor(rnd() * rest.length)];
      ops.push({ op: 'act', act: act2 });
    } else {
      ops.push({ op: 'end' });
    }
    ops.push({ op: 'focus', e: focusTargets(S)[Math.floor(rnd() * 2)] });
    return ops;
  }

  /* 按操作序列执行（测试/模拟用；UI 会自己分步+演出） */
  function execOps(S, ops) {
    for (const op of ops) {
      let r = true;
      if (op.op === 'select') r = selectPiece(S, op.era, op.i);
      else if (op.op === 'act') { const x = applyAction(S, op.act); r = x.ok; }
      else if (op.op === 'end') r = endActions(S);
      else if (op.op === 'pass') r = doPass(S);
      else if (op.op === 'focus') { const x = moveFocus(S, op.e); r = x.ok; }
      if (!r || S.stage === 'over') break;
    }
    return S.stage === 'over';
  }

  return {
    ERAS, CN, NAMES, DI, ok, newGame, pc, countOn, colorEmptyEras, legalActions,
    selectablePieces, needPass, canEnd, focusTargets, selectPiece, applyAction,
    endActions, doPass, moveFocus, aiPlan, randomPlan, execOps, cloneState,
    judgeEnd, logPush, hydrateMods,
    /* 模组注册与基础实现（供 mods/*.js 调用与委托） */
    regMod, MODULES, baseLegalActions, baseDoMove, baseDoTravel, baseSummarize,
    baseEvalState, baseSameLayout,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = G;
if (typeof window !== 'undefined') window.TTYKM = G;
