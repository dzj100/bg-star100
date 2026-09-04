/* ============================================================
   煞有其时 · 「生长」模组（mods/growth.js，独立模组文件）
   启用方式：newGame(mode, rnd, ['growth'])（S.mods 含 id 即启用；
   数据层 hydrate 补齐于 newGame / 存档恢复）

   模组规则：
   - 公共 5 粒种子（S.seeds 池 + 各板 sd 层 0/1，盘上种子 + 池 ≡ 5）
   - 新行动「播种」：在己子脚下格播 1 粒种子（脚下必然可播），或播在
     完全空置的上/下/左/右邻格（邻格站任何棋子/种子/植物都不可播）；
     若下一时空同号格全空
     立即长出灌木丛，灌木丛长出后再下一时空同号格全空则立即长出大树
   - 新行动「拨除」：在己子所在格或上/下/左/右格回收 1 粒种子
     （可拨任意玩家播的种子）；只消**本种子长出**的植物——(E+1,i) 灌木、
     (E+2,i) 立树，以及被推倒后已不在原列的大树（倒树记原生长列 o，
     沿推力方向四邻格循 o 追消）；槽位上别家来源的植物一律不动；种子回公共池
   - 种子透明：不影响移动/穿越/推挤，棋子可与种子同格
   - 灌木丛/倒树 = 墙体：不可入、不可穿越落点、被推链顶到前端撞墙死
   - 站立树：可被直接推倒/被推链推倒（domino）；倒向格有棋子 → 压垮出局；
     落点为墙/灌木丛/倒树时：直推禁止、推链顶住 → 接触棋子挤死（树不动）
   - 悖论死者不触发树倒（仅幸存接触者触发）
   ============================================================ */
'use strict';
(function () {
  const G = typeof window !== 'undefined' ? window.TTYKM
    : (typeof require !== 'undefined' ? require('../game.js') : null);
  if (!G) return;
  const ok = G.ok, DI = G.DI;

  /* ---------------- 数据层 ---------------- */
  const seedsOn = S => {
    let n = 0;
    for (const b of S.boards) if (b.sd) for (const v of b.sd) n += v;
    return n;
  };
  const sdOf = (S, e, i) => !!(S.boards[e].sd && S.boards[e].sd[i]);
  const plantOf = (S, e, i) => (S.boards[e].pl && S.boards[e].pl[i]) || null;
  const isBush = pl => !!(pl && pl.k === 'bush');
  const isStanding = pl => !!(pl && pl.k === 'tree' && !pl.down);
  const isFallen = pl => !!(pl && pl.k === 'tree' && pl.down);
  const solidWall = pl => isBush(pl) || isFallen(pl);   // 墙体语义（灌木丛/倒树）
  const cellEmptyG = (S, e, i) => !S.boards[e].cell[i] && !plantOf(S, e, i) && !sdOf(S, e, i);

  function hydrate(S) {
    for (const b of S.boards) {
      if (!Array.isArray(b.pl) || b.pl.length !== 16) b.pl = Array(16).fill(null);
      if (!Array.isArray(b.sd) || b.sd.length !== 16) b.sd = Array(16).fill(0);
    }
    S.seeds = 5 - seedsOn(S);                 // 池恒可由盘上种子推出（播种-1/拨除+1 自洽）
  }

  /* ---------------- 移动裁决（纯函数，legalActions 与结算共用） ---------------- */
  const chainCells = (S, era, to, d) => {     // 从目标格起沿 d 的连续棋子链（同基础规则）
    const cell = S.boards[era].cell, out = [to];
    let x = to;
    while (ok(x, d) && cell[x + DI[d]]) { x += DI[d]; out.push(x); }
    return out;
  };
  const treeRunCells = (S, era, start, d) => { // 从 start 起沿 d 的连续站立树
    const pl = S.boards[era].pl, out = [];
    let x = start;
    for (;;) {
      if (!isStanding(pl[x])) break;
      out.push(x);
      if (!ok(x, d)) break;
      x += DI[d];
    }
    return out;
  };

  /* 返回移动计划或 null（非法）：
     land 空格/种子 / push 基础推挤（撞墙由基础结算）
     frontWall 链前端撞植物墙死 / frontSquash 链前端被树顶住挤死
     topple 树倒（chain 可为空=直推；run 站立树段；crushIdx 落点被压棋子） */
  function resolveMove(S, era, from, d) {
    const b = S.boards[era];
    if (!ok(from, d)) return null;
    const to = from + DI[d];
    const t = b.cell[to];
    if (t) {
      if (t.c === S.turn) return null;        // 己子目标禁止（含链内有己子被推）
      const chain = chainCells(S, era, to, d);
      const front = chain[chain.length - 1];
      if (!ok(front, d)) return { kind: 'push', chain };          // 前端撞墙 → 基础结算
      const npl = b.pl[front + DI[d]];
      if (!npl) return { kind: 'push', chain };                   // 前端外空/种子 → 基础结算
      if (solidWall(npl)) return { kind: 'frontWall', chain, to };    // 推入灌木丛/倒树 → 前端撞墙死
      const run = treeRunCells(S, era, front + DI[d], d);         // 推链顶站立树
      const runEnd = run[run.length - 1];
      const L = ok(runEnd, d) ? runEnd + DI[d] : -1;
      const blocked = L < 0 || solidWall(b.pl[L]);
      return blocked ? { kind: 'frontSquash', chain, to }
        : { kind: 'topple', chain, run, to, crushIdx: b.cell[L] ? L : -1 };
    }
    const pl = b.pl[to];
    if (pl) {
      if (solidWall(pl)) return null;                             // 灌木丛/倒树不可入
      const run = treeRunCells(S, era, to, d);                    // 直推站立树
      const runEnd = run[run.length - 1];
      const L = ok(runEnd, d) ? runEnd + DI[d] : -1;
      if (L < 0 || solidWall(b.pl[L])) return null;               // 落点墙/灌木丛/倒树 → 该移动被禁止
      return { kind: 'topple', chain: [], run, to, crushIdx: b.cell[L] ? L : -1 };
    }
    return { kind: 'land' };
  }

  /* 树倒/挤死/植物墙结算（调用前已排除"前端悖论死"退化情形） */
  function settleTree(S, era, from, d, res) {
    const me = S.turn, b = S.boards[era];
    const frontWhy = res.kind === 'frontWall' ? 'wall' : res.kind === 'frontSquash' ? 'squash' : null;
    const evs = [];
    const mover = b.cell[from];
    b.cell[from] = null;
    const chain = res.chain || [];
    // 悖论对（与基础规则同判）
    const pairDead = new Set(), deathSet = new Set();
    for (let k = 0; k < chain.length - 1; k++) {
      if (b.cell[chain[k]].c === b.cell[chain[k + 1]].c) { pairDead.add(k); pairDead.add(k + 1); deathSet.add(k); deathSet.add(k + 1); }
    }
    if (frontWhy && !deathSet.has(chain.length - 1)) deathSet.add(chain.length - 1);
    // 压垮：树倒落点上的棋子（先于树倒移除；与悖论/挤死同时刻）
    if (res.crushIdx >= 0) {
      const p = b.cell[res.crushIdx];
      if (p) {
        evs.push({ k: 'die', era, idx: res.crushIdx, c: p.c, why: 'crush' });
        b.cell[res.crushIdx] = null; S.dead[p.c]++;
      }
    }
    for (const k of deathSet) {
      const p = b.cell[chain[k]]; if (!p) continue;
      evs.push({ k: 'die', era, idx: chain[k], c: p.c, why: pairDead.has(k) ? 'paradox' : frontWhy });
      b.cell[chain[k]] = null; S.dead[p.c]++;
    }
    // 站立树逐棵倒下（倒树状态 down=1；反向遍历避免覆盖相邻树格。
    // no 从触发侧（离移动者最近）起 0,1,2… 递增，供演出做多米诺级联）
    if (res.run && res.run.length) {
      const falls = [];
      for (let k = res.run.length - 1; k >= 0; k--) {
        const r = res.run[k];
        if (!isStanding(b.pl[r])) continue;
        const nt = r + DI[d];
        b.pl[r] = null;
        b.pl[nt] = { k: 'tree', down: 1, o: r };        // o：原生长列（拨除循源追消用）
        falls.push({ k: 'fall', era, from: r, to: nt });
      }
      for (let j = 0; j < falls.length; j++) { falls[j].no = falls.length - 1 - j; evs.push(falls[j]); }
    }
    // 幸存链整体推进（自前向后腾位，同基础规则）
    for (let k = chain.length - 1; k >= 0; k--) {
      if (deathSet.has(k)) continue;
      const p = b.cell[chain[k]]; if (!p) continue;
      const nxt = chain[k] + DI[d];
      b.cell[nxt] = p; b.cell[chain[k]] = null;
      evs.push({ k: 'step', era, c: p.c, from: chain[k], to: nxt });
    }
    b.cell[res.to] = mover;
    evs.push({ k: 'move', era, c: me, from, to: res.to });
    return evs;
  }

  function doMove(S, era, from, d) {
    const res = resolveMove(S, era, from, d);
    if (!res) return [];
    if (res.kind === 'land' || res.kind === 'push') return G.baseDoMove(S, era, from, d);
    // 前端悖论死：树/植物不参与（仅幸存接触者触发），整体退化为基础推进
    const c = res.chain || [];
    if (c.length >= 2) {
      const cell = S.boards[era].cell;
      if (cell[c[c.length - 2]].c === cell[c[c.length - 1]].c) return G.baseDoMove(S, era, from, d);
    }
    return settleTree(S, era, from, d, res);
  }

  /* ---------------- 播种 / 拨除 ---------------- */
  const around = (S, era, i) => {             // 己子所在格 + 四邻
    const out = [i];
    for (const d of Object.keys(DI)) if (ok(i, d)) out.push(i + DI[d]);
    return out;
  };
  const growable = (S, e, i) => {             // 朝未来两级是否有全空位（级联生长可行性）
    if (e >= 2) return false;
    if (!cellEmptyG(S, e + 1, i)) return false;
    return e + 2 > 2 || cellEmptyG(S, e + 2, i);
  };
  function doSow(S, to) {
    const era = S.sel.era, b = S.boards[era];
    const evs = [];
    S.seeds--; b.sd[to] = 1;
    evs.push({ k: 'seed', era, idx: to });
    const e1 = era + 1;
    if (e1 <= 2 && cellEmptyG(S, e1, to)) {           // 下一时空全空 → 长出灌木丛
      S.boards[e1].pl[to] = { k: 'bush' };
      evs.push({ k: 'grow', era: e1, idx: to, pl: 'bush' });
      const e2 = e1 + 1;
      if (e2 <= 2 && cellEmptyG(S, e2, to)) {         // 灌木丛长出后再下一时空全空 → 大树
        S.boards[e2].pl[to] = { k: 'tree', down: 0 };
        evs.push({ k: 'grow', era: e2, idx: to, pl: 'tree' });
      }
    }
    return evs;
  }
  function doPluck(S, to) {
    const era = S.sel.era, evs = [];
    const e1 = era + 1, e2 = era + 2;
    S.seeds++; S.boards[era].sd[to] = 0;
    evs.push({ k: 'poof', era, idx: to, pl: 'seed' });
    const kill = (e, j, pl) => {
      S.boards[e].pl[j] = null;
      evs.push({ k: 'poof', era: e, idx: j, pl: pl.k });
    };
    // 只消本种子长出的植物：灌木唯本种子来源（该槽位立树/倒树必属别家 → 不动）
    if (e1 <= 2 && isBush(S.boards[e1].pl[to])) kill(e1, to, S.boards[e1].pl[to]);
    if (e2 <= 2) {
      const b2 = S.boards[e2];
      // 槽位立树唯本种子来源（本种子的树被推走后别家树倒进空槽 → 倒树非立树，不误消）
      if (isStanding(b2.pl[to])) kill(e2, to, b2.pl[to]);
      // 本种子大树被推倒（沿推力方向恰 1 格，倒树记原列 o）→ 四方向邻格循 o 追消
      for (const d of Object.keys(DI)) {
        if (!ok(to, d)) continue;
        const j = to + DI[d];
        const pl = b2.pl[j];
        if (isFallen(pl) && pl.o === to) kill(e2, j, pl);
      }
    }
    return evs;
  }

  /* ---------------- 合法行动（模组全量计算：基础行动 + 树裁 + 播种/拨除） ---------------- */
  function legalActions(S, era, i) {
    const me = S.turn, p = G.pc(S, era, i);
    if (!p || p.c !== me) return [];
    const b = S.boards[era], out = [];
    for (const d of Object.keys(DI)) {
      if (!ok(i, d)) continue;
      if (resolveMove(S, era, i, d)) out.push({ t: 'move', d, to: i + DI[d] });
    }
    for (const e2 of [era - 1, era + 1]) {
      if (e2 < 0 || e2 > 2) continue;
      if (S.boards[e2].cell[i]) continue;                     // 目标格有任何子不可穿
      if (plantOf(S, e2, i)) continue;                        // 目标格有植物（灌木丛/树木）不可穿
      if (e2 < era && S.spares[me] <= 0) continue;            // 逆时需要分身备用
      out.push({ t: 'travel', e2 });
    }
    if (S.seeds > 0) {
      for (const to of around(S, era, i)) {
        if (to === i) {                                      // 脚下格必然可播（己子站在其上不阻挡）
          if (plantOf(S, era, to) || sdOf(S, era, to)) continue;   // 但脚下已有种子/植物时不可再播
          out.push({ t: 'sow', to });
        } else if (cellEmptyG(S, era, to)) {                 // 四邻仅完全空置可播（任何棋子/种子/植物皆不可）
          out.push({ t: 'sow', to });
        }
      }
    }
    for (const to of around(S, era, i)) {
      if (sdOf(S, era, to)) out.push({ t: 'pluck', to });     // 有种子可拨（含被树盖住/站子上的）
    }
    return out;
  }

  const actEq = (a, b) => a.t === b.t && (
    a.t === 'travel' ? a.e2 === b.e2
      : a.t === 'move' ? a.d === b.d && a.to === b.to
        : a.to === b.to);

  function execAction(S, act) {
    if (act.t === 'move') return doMove(S, S.sel.era, S.sel.i, act.d);
    if (act.t === 'travel') return G.baseDoTravel(S, S.sel.era, S.sel.i, act.e2);
    if (act.t === 'sow') return doSow(S, act.to);
    return doPluck(S, act.to);          // pluck（actEq 保证合法性）
  }

  function applyAction(S, act) {
    if (S.stage !== 'act' || !S.sel) return { ok: false, evs: [] };
    const { era, i } = S.sel;
    if (!legalActions(S, era, i).some(a => actEq(a, act))) return { ok: false, evs: [] };
    const evs = execAction(S, act);
    const nera = act.t === 'travel' ? act.e2 : era;    // 播种/拨除棋子不位移
    const ni = act.t === 'move' ? act.to : i;
    S.acted++;
    G.logPush(S, summarize(S, evs));
    if (S.acted >= 2) {
      S.sel = null;
      if (!G.judgeEnd(S)) S.stage = 'focus';   // 两次行动结束即判，未终局才进入移焦点
    } else {
      S.sel = { era: nera, i: ni };
    }
    return { ok: true, evs };
  }

  /* ---------------- 事件日志（基础叙事 + 模组条目，格式与基础一致） ---------------- */
  function summarize(S, evs) {
    const cname = c => G.CN[c];
    const me = S.turn;
    const parts = [];
    const move = evs.find(e => e.k === 'move');
    if (move) parts.push(cname(move.c) + '子' + (move.from + 1) + '→' + (move.to + 1));
    const trav = evs.find(e => e.k === 'travel');
    if (trav) {
      const clone = evs.find(e => e.k === 'clone');
      parts.push(cname(trav.c) + '子穿越→' + G.ERAS[trav.toEra] + (trav.idx + 1) + '格' + (clone ? '（分身留' + G.ERAS[trav.era] + '）' : ''));
    }
    for (const f of evs) if (f.k === 'fall') parts.push((f.from + 1) + '号格树木被推倒');
    const died = evs.filter(e => e.k === 'die');
    if (died.length) {
      const byWhy = {};
      for (const e of died) (byWhy[e.why] = byWhy[e.why] || []).push(cname(e.c) + (e.idx + 1));
      const suf = { paradox: '悖论出局', wall: '撞墙出局', crush: '压垮出局', squash: '挤死出局' };
      for (const why of ['paradox', 'wall', 'crush', 'squash']) {
        if (byWhy[why]) parts.push(byWhy[why].join('、') + ' ' + suf[why]);
      }
    }
    for (const e of evs) {
      if (e.k === 'seed') parts.push(G.NAMES[me] + '在' + (e.idx + 1) + '号格播下种子');
      else if (e.k === 'grow') parts.push(G.ERAS[e.era] + (e.idx + 1) + '格长出' + (e.pl === 'bush' ? '灌木丛' : '大树'));
      else if (e.k === 'poof' && e.pl === 'seed') parts.push('拨除' + (e.idx + 1) + '号格种子');
      else if (e.k === 'poof') parts.push(G.ERAS[e.era] + (e.idx + 1) + '格' + (e.pl === 'tree' ? '大树' : '灌木丛') + '随之消逝');
    }
    return parts.join('，');
  }

  /* ---------------- 人机估值 / 净零识别 ---------------- */
  /* 植物对双方都是障碍，只按"当前焦点时空"近似归属：位于对手焦点时空的植物/种子
     阻碍对手下一步 → 对我方为正；位于己方焦点时空 → 为负。权重远小于子力差 26 */
  function evalState(S, me, rnd) {
    let v = G.baseEvalState(S, me, rnd);
    const myE = S.focus[me], opE = S.focus[1 - me];
    for (let e = 0; e < 3; e++) {
      const side = e === opE ? 1 : e === myE ? -1 : 0;
      if (!side) continue;
      const b = S.boards[e];
      for (let i = 0; i < 16; i++) {
        const pl = b.pl[i];
        if (pl) v += side * (pl.k === 'bush' ? 2 : pl.down ? 3 : 5);
        else if (b.sd[i]) v += side * (growable(S, e, i) ? 1 : -2);
      }
    }
    return v;
  }

  function sameLayout(A, B) {
    if (!G.baseSameLayout(A, B)) return false;
    for (let e = 0; e < 3; e++) {
      const pa = A.boards[e].pl, pb = B.boards[e].pl;
      const sa = A.boards[e].sd, sb = B.boards[e].sd;
      for (let i = 0; i < 16; i++) {
        const a = pa[i] ? pa[i].k + ':' + (pa[i].down | 0) + ':' + (pa[i].o === undefined ? '' : pa[i].o) : null;
        const c = pb[i] ? pb[i].k + ':' + (pb[i].down | 0) + ':' + (pb[i].o === undefined ? '' : pb[i].o) : null;
        if (a !== c) return false;
        if ((sa[i] | 0) !== (sb[i] | 0)) return false;
      }
    }
    return true;
  }

  const mod = {
    id: 'growth',
    name: '生长',
    desc: '新增公共 5 粒种子：可在己子脚下格或完全空置的相邻格播种，种子在下一时空长出灌木丛、再下一时空长出大树；树木可被推倒、灌木丛与倒树如墙壁。',
    hydrate, legalActions, applyAction, evalState, sameLayout,
  };
  G.regMod(mod);
})();
