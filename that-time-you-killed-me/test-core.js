/* ============================================================
   煞有其时 · 规则引擎单测（node test-core.js）
   覆盖：开局 / 推挤撞墙(例1) / 悖论(例2) / 双穿越分身(例3) /
        穿越占用 / 分身备用耗尽 / 己子目标禁止 / 结束行动 /
        强制2次行动 / 行动结束即判胜负与平局 / 空过 / 随机与AI对局不变量
   ============================================================ */
'use strict';
const G = require('./game.js');
require('./mods/growth.js');     // 注册生长模组（仅 S.mods 含 'growth' 时生效）
const assert = require('assert');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}

function fresh() {
  const S = G.newGame('local2p', () => 0);
  S.__placed = [0, 0];                       // 手工场景摆上的子数（覆盖写时增减）
  for (const b of S.boards) b.cell.fill(null);
  S.spares = [4, 4]; S.dead = [0, 0];
  S.stage = 'select'; S.sel = null; S.acted = 0; S.over = null; S.log.length = 0;
  S.turn = 0; S.turnNo = 1;
  return S;
}
const put = (S, e, i, c) => {
  const old = S.boards[e].cell[i];
  if (old && old.c !== c) S.__placed[old.c]--;
  if (!old || old.c !== c) S.__placed[c]++;
  S.boards[e].cell[i] = { c };
};
const color = (S, e, i) => { const p = S.boards[e].cell[i]; return p ? p.c : null; };
function inv(S) {
  for (let c = 0; c < 2; c++) {
    const want = S.__placed ? S.__placed[c] + 4 : 7;  // fresh 场景：摆 N 子+4 备用；真实对局 3+4
    const n = G.countOn(S, c) + S.spares[c] + S.dead[c];
    assert.strictEqual(n, want, '子数不变量被破坏: c=' + c + ' n=' + n + ' 期望 ' + want);
  }
}
function hasMove(acts, d, to) { return acts.some(a => a.t === 'move' && a.d === d && a.to === to); }
function hasTravel(acts, e2) { return acts.some(a => a.t === 'travel' && a.e2 === e2); }

/* ---- 生长模组 helpers（newGame 第三参带 mods:['growth'] 的场景） ---- */
function freshG() {
  const S = G.newGame('local2p', () => 0, ['growth']);
  S.__placed = [0, 0];
  for (const b of S.boards) { b.cell.fill(null); b.pl.fill(null); b.sd.fill(0); }
  S.seeds = 5; S.spares = [4, 4]; S.dead = [0, 0];
  S.stage = 'select'; S.sel = null; S.acted = 0; S.over = null; S.log.length = 0;
  S.turn = 0; S.turnNo = 1;
  return S;
}
const putPl = (S, e, i, k, down) => { S.boards[e].pl[i] = (k === 'tree') ? { k, down: down ? 1 : 0 } : { k }; };
const putSd = (S, e, i) => { if (!S.boards[e].sd[i]) { S.boards[e].sd[i] = 1; S.seeds--; } };
const plAt = (S, e, i) => S.boards[e].pl[i] || null;
const seedAt = (S, e, i) => !!S.boards[e].sd[i];
const hasSow = (acts, to) => acts.some(a => a.t === 'sow' && a.to === to);
const hasPluck = (acts, to) => acts.some(a => a.t === 'pluck' && a.to === to);
function invG(S) {
  inv(S);
  let sdN = 0;
  for (const b of S.boards) if (b.sd) for (const v of b.sd) sdN += v;
  assert.strictEqual(sdN + S.seeds, 5, '种子守恒被破坏: 盘上' + sdN + ' 池' + S.seeds);
  for (let e = 0; e < 3; e++) {
    const b = S.boards[e];
    for (let i = 0; i < 16; i++) {
      const pl = b.pl[i];
      if (pl) assert.ok(!b.cell[i], '棋子与植物同格 e=' + e + ' i=' + i);
      if (pl && pl.k !== 'tree') assert.ok(!b.sd[i], '种子与活植物同格 e=' + e + ' i=' + i);
    }
  }
}

console.log('— 开局 —');
test('开局布子与焦点（白1号格/黑16号格，黑焦点未来）', () => {
  const S = G.newGame('local2p', () => 0);
  assert.strictEqual(S.turn, 0);
  for (let e = 0; e < 3; e++) {
    assert.strictEqual(color(S, e, 0), 1);   // 白子 1 号格
    assert.strictEqual(color(S, e, 15), 0);  // 黑子 16 号格
  }
  assert.deepStrictEqual(S.spares, [4, 4]);
  assert.deepStrictEqual(S.focus, [2, 0]);   // [黑焦点=未来, 白焦点=过去]
  assert.ok(G.selectablePieces(S).length >= 1);
  // 黑方焦点在未来：16 号格黑子仅可上/左（下/右是墙）
  const actsB = G.legalActions(S, 2, 15);
  assert.ok(hasMove(actsB, 'up', 11) && hasMove(actsB, 'left', 14));
  assert.ok(!hasTravel(actsB, 1));          // 现在 16 号格被自己的黑子占据
  // 白方焦点在过去：轮到白方时 1 号格白子可右/下
  S.turn = 1;
  const actsW = G.legalActions(S, 0, 0);
  assert.ok(hasMove(actsW, 'right', 1) && hasMove(actsW, 'down', 4));
  assert.ok(!hasTravel(actsW, 1));          // 现在 1 号格被自己的白子占据
  S.turn = 0;
  assert.strictEqual(S.log.length, 1);            // 开局默认插入一条 log
  assert.deepStrictEqual(S.log[0], { no: 1, p: 0, text: '对局开始，黑方先手' });
  inv(S);
});
test('白方先手时开局 log 归属正确', () => {
  const S = G.newGame('local2p', () => 0.9);
  assert.strictEqual(S.first, 1);
  assert.strictEqual(S.log.length, 1);
  assert.deepStrictEqual(S.log[0], { no: 1, p: 1, text: '对局开始，白方先手' });
  inv(S);
});

console.log('— 示例1：推挤撞墙（己子可误杀）—');
test('黑3→2 推白2与己黑1，己黑撞墙死；再推白出局', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 0, 0); put(S, 0, 1, 1); put(S, 0, 2, 0);
  put(S, 1, 10, 0); put(S, 1, 5, 1); put(S, 2, 5, 1); // 双方在别处仍有子 → 不触发终局
  assert.ok(G.selectPiece(S, 0, 2));
  const r = G.applyAction(S, { t: 'move', d: 'left', to: 1 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 0), 1); // 白被推到1号格
  assert.strictEqual(color(S, 0, 1), 0); // 黑落2号格
  assert.strictEqual(color(S, 0, 2), null);
  assert.strictEqual(S.dead[0], 1);      // 己方黑撞墙
  assert.ok(r.evs.some(e => e.k === 'die' && e.why === 'wall' && e.idx === 0));
  assert.strictEqual(S.acted, 1);
  // 第2次行动：同子再左移 → 白撞墙出局
  const r2 = G.applyAction(S, { t: 'move', d: 'left', to: 0 });
  assert.ok(r2.ok);
  assert.strictEqual(color(S, 0, 0), 0);
  assert.strictEqual(S.dead[1], 1);
  assert.strictEqual(S.stage, 'focus');  // 两次行动完成
  // 事件日志：两条纯叙事条目，回合/玩家归属正确，不带引导语
  assert.strictEqual(S.log.length, 2);
  assert.deepStrictEqual({ no: S.log[0].no, p: S.log[0].p }, { no: 1, p: 0 });
  assert.ok(S.log[0].text.includes('撞墙出局'));
  assert.ok(S.log[1].text.startsWith('黑子2→1') && !S.log[1].text.includes('请移动焦点'));
  inv(S);
});

console.log('— 示例2：悖论 —');
test('下推 [5白,9白]：同色相邻段全死，即使9后有空格', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 0, 0); put(S, 0, 4, 1); put(S, 0, 8, 1);
  put(S, 1, 10, 0); put(S, 1, 5, 1); put(S, 2, 5, 1); // 双方在别处仍有子 → 不触发终局
  assert.ok(G.selectPiece(S, 0, 0));
  const r = G.applyAction(S, { t: 'move', d: 'down', to: 4 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 4), 0);
  assert.strictEqual(color(S, 0, 8), null);
  assert.strictEqual(S.dead[1], 2);
  assert.strictEqual(r.evs.filter(e => e.k === 'die' && e.why === 'paradox').length, 2);
  // 同子第2次行动可继续下移入空位
  const r2 = G.applyAction(S, { t: 'move', d: 'down', to: 8 });
  assert.ok(r2.ok);
  assert.strictEqual(color(S, 0, 8), 0);
  assert.strictEqual(S.stage, 'focus');
  inv(S);
});
test('推链3连同色整段悖论死，身后异色撞墙死', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 0, 0); put(S, 0, 1, 1); put(S, 0, 2, 1); put(S, 0, 3, 0);
  assert.ok(G.selectPiece(S, 0, 0));
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 1 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 1), 0);
  assert.strictEqual(color(S, 0, 2), null);
  assert.strictEqual(color(S, 0, 3), null);
  assert.strictEqual(S.dead[1], 2); // 白2、白3 悖论
  assert.strictEqual(S.dead[0], 1); // 己黑4 撞墙
  inv(S);
});

console.log('— 示例3：穿越与分身 —');
test('未来→现在→过去 双穿越双分身', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 2;
  put(S, 2, 5, 1);
  put(S, 1, 12, 0); put(S, 2, 12, 0);               // 黑在别处仍有子 → 不触发终局
  assert.ok(G.selectPiece(S, 2, 5));
  const acts = G.legalActions(S, 2, 5);
  assert.ok(hasTravel(acts, 1));
  const r1 = G.applyAction(S, { t: 'travel', e2: 1 });
  assert.ok(r1.ok);
  assert.strictEqual(color(S, 2, 5), 1); // 分身
  assert.strictEqual(color(S, 1, 5), 1);
  assert.strictEqual(S.spares[1], 3);
  assert.ok(r1.evs.some(e => e.k === 'clone'));
  const r2 = G.applyAction(S, { t: 'travel', e2: 0 });
  assert.ok(r2.ok);
  assert.strictEqual(color(S, 1, 5), 1);
  assert.strictEqual(color(S, 0, 5), 1);
  assert.strictEqual(S.spares[1], 2);
  assert.strictEqual(S.stage, 'focus');
  inv(S);
});
test('穿越目标格有任何子（敌/己）均不可穿', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 2;
  put(S, 2, 5, 1); put(S, 1, 5, 0);
  let acts = G.legalActions(S, 2, 5);
  assert.ok(!hasTravel(acts, 1));
  assert.ok(G.applyAction(S, { t: 'travel', e2: 1 }).ok === false);
  put(S, 1, 5, 1); // 己方子也挡
  acts = G.legalActions(S, 2, 5);
  assert.ok(!hasTravel(acts, 1));
  inv(S);
});
test('分身备用耗尽后不可逆时穿越', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 2;
  put(S, 2, 5, 1);
  S.spares[1] = 0;
  let acts = G.legalActions(S, 2, 5);
  assert.ok(!hasTravel(acts, 1));
  assert.ok(G.applyAction(S, { t: 'travel', e2: 1 }).ok === false);
  S.spares[1] = 4; // 恢复备用后再验证穿越恢复
  acts = G.legalActions(S, 2, 5);
  assert.ok(hasTravel(acts, 1));
  inv(S);
});

console.log('— 移动合法性 —');
test('不能主动走入己子格（即使可推）', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 0, 0); put(S, 0, 1, 0);
  let acts = G.legalActions(S, 0, 0);
  assert.ok(!hasMove(acts, 'right', 1));
  assert.ok(G.applyAction(S, { t: 'move', d: 'right', to: 1 }).ok === false);
  inv(S);
});
test('只能选焦点时空内、且至少1次合法行动的己子', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 1, 0);          // 焦点时空己子（可动）
  put(S, 1, 1, 0);          // 非焦点时空己子
  const selAll = G.selectablePieces(S).map(p => p.era);
  assert.strictEqual(selAll.length, 1);
  assert.ok(!selAll.includes(1));
  // 焦点时空的己子被完全封死（右/下为己子，上/左为墙，穿越目标被占）→ 不在可选列表、选不中
  const U = fresh(); U.focus[0] = 0;
  put(U, 0, 0, 0); put(U, 0, 1, 0); put(U, 0, 4, 0);
  put(U, 1, 0, 1);
  assert.strictEqual(G.legalActions(U, 0, 0).length, 0);
  assert.ok(!G.selectablePieces(U).some(p => p.i === 0));
  assert.ok(!G.selectPiece(U, 0, 0));
});

console.log('— 结束行动（新增规则）—');
test('仅有1次行动的棋子可选；执行后无合法行动可结束行动', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 2;
  put(S, 2, 10, 1);
  put(S, 2, 6, 1); put(S, 2, 9, 1); put(S, 2, 11, 1); put(S, 2, 14, 1); // 四邻皆己方
  put(S, 0, 10, 0); put(S, 1, 5, 0); put(S, 2, 5, 0); // 黑三时空各有子 → 不触发终局
  assert.strictEqual(G.legalActions(S, 2, 10).length, 1); // 仅逆时穿越到现在
  assert.ok(G.selectPiece(S, 2, 10));
  const r = G.applyAction(S, { t: 'travel', e2: 1 });
  assert.ok(r.ok);
  assert.strictEqual(S.spares[1], 3);
  assert.strictEqual(color(S, 2, 10), 1); // 分身留未来
  put(S, 1, 6, 1); put(S, 1, 9, 1); put(S, 1, 11, 1); put(S, 1, 14, 1); // 现在四邻己方
  assert.strictEqual(G.legalActions(S, 1, 10).length, 0);
  assert.ok(G.canEnd(S));
  assert.ok(G.endActions(S));
  assert.strictEqual(S.stage, 'focus');
  inv(S);
});
test('仍有第2次合法行动时不可提前结束，且必须执行满2次', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 0, 0);
  put(S, 1, 10, 0); put(S, 1, 5, 1); put(S, 2, 5, 1); // 双方在别处仍有子 → 不触发终局
  assert.ok(G.selectPiece(S, 0, 0));
  const r1 = G.applyAction(S, { t: 'move', d: 'right', to: 1 });
  assert.ok(r1.ok);
  assert.strictEqual(G.canEnd(S), false); // 右移后仍可行动? 1号位右邻2空
  assert.ok(G.legalActions(S, 0, 1).length >= 1);
  assert.strictEqual(G.endActions(S), false);
  const r2 = G.applyAction(S, { t: 'move', d: 'right', to: 2 });
  assert.ok(r2.ok);
  assert.strictEqual(S.stage, 'focus');
});

console.log('— 胜负（行动结束即判）—');
test('第2次行动杀死对方唯一子 → 当场终局，无需再移焦点', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 0, 1);  // 白唯一子
  put(S, 0, 1, 0);  // 黑推子
  put(S, 1, 10, 0); // 黑在现在还有子 → 只有白满足负条件
  assert.ok(G.selectPiece(S, 0, 1));
  const r1 = G.applyAction(S, { t: 'move', d: 'left', to: 0 }); // 白撞墙死
  assert.ok(r1.ok);
  assert.strictEqual(G.colorEmptyEras(S, 1), 3);
  assert.strictEqual(S.over, null);         // 第1次行动后不判
  assert.strictEqual(S.stage, 'act');
  const r2 = G.applyAction(S, { t: 'move', d: 'right', to: 1 }); // 第2次行动结束即判
  assert.ok(r2.ok);
  assert.strictEqual(S.stage, 'over');
  assert.strictEqual(S.over.winner, 0);
  assert.ok(!G.moveFocus(S, 1).ok);         // 终局后移焦点被拒
  inv(S);
});
test('己方悖论自毁 → 第2次行动结束当场判负', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 0, 0); put(S, 0, 1, 1); put(S, 0, 2, 0); put(S, 0, 3, 0);
  put(S, 1, 5, 1);                          // 白仍占现在 → 不满足负条件
  assert.ok(G.selectPiece(S, 0, 0));
  const r1 = G.applyAction(S, { t: 'move', d: 'right', to: 1 }); // 推链[白,己黑2,己黑3]悖论双死
  assert.ok(r1.ok);
  assert.strictEqual(S.dead[0], 2);
  assert.strictEqual(S.over, null);
  const r2 = G.applyAction(S, { t: 'move', d: 'right', to: 2 });
  assert.ok(r2.ok);
  assert.strictEqual(S.stage, 'over');
  assert.strictEqual(S.over.winner, 1);     // 黑只剩过去一子
  inv(S);
});
test('双方同时 ≥2 时空无子 → 平局（不分胜负）', () => {
  const S = fresh(); S.turn = 0;
  S.focus[0] = 1;
  S.stage = 'focus'; // 直接构造已停手局面，移焦点兜底判定
  put(S, 0, 0, 0); put(S, 0, 5, 1); // 双方都只存在于过去
  const mf = G.moveFocus(S, 2);
  assert.ok(mf.ok && mf.over);
  assert.strictEqual(S.over.winner, undefined);
  assert.strictEqual(S.over.draw, true);
});
test('第2次行动结束双方同时仅存1时空 → 当场平局', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 0, 0, 0); put(S, 0, 1, 1); put(S, 0, 2, 0); put(S, 0, 3, 0);
  assert.ok(G.selectPiece(S, 0, 0));
  const r1 = G.applyAction(S, { t: 'move', d: 'right', to: 1 }); // 己黑2、3悖论双死
  assert.ok(r1.ok);
  assert.strictEqual(S.dead[0], 2);
  assert.strictEqual(S.over, null);
  const r2 = G.applyAction(S, { t: 'move', d: 'right', to: 2 }); // 双方都只剩过去一子
  assert.ok(r2.ok);
  assert.strictEqual(S.stage, 'over');
  assert.strictEqual(S.over.draw, true);
  assert.strictEqual(S.over.winner, undefined);
  inv(S);
});

console.log('— 空过 —');
test('焦点时空无己子 → 空过仅移焦点，回合继续', () => {
  const S = fresh(); S.focus[0] = 0;
  put(S, 1, 3, 0); put(S, 2, 0, 0);
  put(S, 0, 0, 1); put(S, 2, 15, 1);   // 白在「过去」（焦点）与「未来」各有子 → 白下回合可行动
  assert.strictEqual(G.selectablePieces(S).length, 0);
  assert.ok(G.needPass(S));
  assert.ok(G.doPass(S));
  assert.strictEqual(S.stage, 'focus');
  assert.deepStrictEqual(G.focusTargets(S), [1, 2]);
  const mf = G.moveFocus(S, 1);
  assert.ok(mf.ok && !mf.over);
  assert.strictEqual(S.turn, 1);
  assert.strictEqual(S.stage, 'select'); // 白方焦点在过去有子可行动
  inv(S);
});

console.log('— 大规模模拟（不变量）—');
test('AI vs AI 20局 + 随机20局：无崩溃、子数不变量恒成立', () => {
  for (let g = 0; g < 20; g++) {
    const S = G.newGame('local2p', () => Math.random());
    let steps = 0;
    try {
      while (!S.over && S.turnNo < 400 && steps < 1200) {
        const ops = G.aiPlan(S);
        assert.ok(ops.length >= 1);
        G.execOps(S, ops);
        inv(S);
        steps++;
      }
    } catch (e) {
      console.log('    CRASH game=' + g + ' step=' + steps + ' turnNo=' + S.turnNo + ' stage=' + S.stage);
      console.log('    ' + (e.stack || e.message));
      throw e;
    }
    if (g === 0) console.log('    [AI对局结束回合 turnNo=' + S.turnNo + ' over=' + !!S.over + ']');
  }
  for (let g = 0; g < 20; g++) {
    const S = G.newGame('local2p', () => Math.random());
    let steps = 0;
    try {
      while (!S.over && S.turnNo < 500 && steps < 1500) {
        const ops = G.randomPlan(S);
        G.execOps(S, ops);
        inv(S);
        steps++;
      }
    } catch (e) {
      console.log('    CRASH-R game=' + g + ' step=' + steps + ' turnNo=' + S.turnNo + ' stage=' + S.stage + ' sel=' + JSON.stringify(S.sel));
      console.log('    ops=' + JSON.stringify(ops));
      console.log('    ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n'));
      throw e;
    }
  }
  console.log('    全部模拟通过（含最坏 400/500 回合上限保护）');
});

console.log('— aiPlan 断点续跑（存档恢复：act 中途）—');
test('断点 acted=0（AI 已选子未行动）：续排第1次行动并走完回合', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 2;
  put(S, 0, 0, 0); put(S, 1, 0, 0); put(S, 2, 0, 0);   // 黑三时空各1子
  put(S, 2, 5, 1);                                     // 白方未来6号
  assert.ok(G.selectPiece(S, 2, 5));                   // 恢复点：已选未动
  assert.strictEqual(S.stage, 'act');
  assert.strictEqual(S.acted, 0);
  const ops = G.aiPlan(S, () => 0);
  assert.ok(ops.length >= 2 && ops.every(o => o.op !== 'select'));  // 不再重选子
  assert.strictEqual(ops[0].op, 'act');
  assert.strictEqual(ops[ops.length - 1].op, 'focus');
  G.execOps(S, ops);
  assert.ok(S.over || (S.turn === 0 && S.stage === 'select' && S.turnNo === 2));
  assert.ok(S.acted === 2 || S.stage === 'select');    // 行动满2次或已换手
  inv(S);
});
test('断点 acted=1（AI 已行1次行动）：续排第2次行动/结束行动并移焦点', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 2;
  put(S, 0, 0, 0); put(S, 1, 0, 0); put(S, 2, 0, 0);
  put(S, 2, 5, 1);
  assert.ok(G.selectPiece(S, 2, 5));
  const r1 = G.applyAction(S, { t: 'travel', e2: 1 }); // 已穿越到 现在6号（acted=1）
  assert.ok(r1.ok);
  assert.strictEqual(S.stage, 'act');
  assert.strictEqual(S.acted, 1);
  const ops = G.aiPlan(S, () => 0);
  assert.ok(ops.length >= 2 && ops[0].op !== 'select');
  assert.strictEqual(ops[0].op, 'act');                // 现在6号仍有行动 → 续第2次
  assert.strictEqual(ops[ops.length - 1].op, 'focus');
  G.execOps(S, ops);
  assert.ok(S.over || (S.turn === 0 && S.stage === 'select' && S.turnNo === 2));
  inv(S);
});
test('断点 acted=1 且棋子无路：续排【结束行动】+移焦点', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 2;
  put(S, 0, 0, 0); put(S, 1, 0, 0); put(S, 2, 0, 0);
  put(S, 2, 10, 1);
  put(S, 2, 6, 1); put(S, 2, 9, 1); put(S, 2, 11, 1); put(S, 2, 14, 1); // 未来四邻己方（只余前穿）
  put(S, 0, 10, 0);                                     // 过去10号被黑占 → 无穿越
  assert.ok(G.selectPiece(S, 2, 10));
  assert.strictEqual(G.legalActions(S, 2, 10).length, 1);
  const r1 = G.applyAction(S, { t: 'travel', e2: 1 });  // 逆时穿越留分身，落到现在10号
  assert.ok(r1.ok);
  put(S, 1, 6, 1); put(S, 1, 9, 1); put(S, 1, 11, 1); put(S, 1, 14, 1); // 现在四邻也己方
  assert.ok(G.canEnd(S));
  const ops = G.aiPlan(S, () => 0);
  assert.strictEqual(ops[0].op, 'end');                 // 无路可走 → 结束行动
  assert.strictEqual(ops[ops.length - 1].op, 'focus');
  G.execOps(S, ops);
  assert.ok(S.over || (S.turn === 0 && S.stage === 'select' && S.turnNo === 2));
  inv(S);
});

console.log('— 焦点启发（避免落入己方无子时空的空过）—');
test('两目标一个有己子一个空：必选有己子的时空', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 1;
  S.stage = 'focus'; S.acted = 2;                  // 白方刚完成行动，焦点在「现在」
  put(S, 0, 0, 0); put(S, 1, 0, 0); put(S, 2, 0, 0);   // 黑三时空各1子
  put(S, 1, 9, 1);                                   // 白子在「现在」（当前焦点时空）
  put(S, 2, 5, 1); put(S, 2, 6, 1);                  // 白子也在「未来」（可选目标）
  // 焦点目标 = 过去(无白子) / 未来(有白子)，需落在未来
  const ops = G.aiPlan(S, () => 0);
  assert.strictEqual(ops.length, 1);
  assert.deepStrictEqual(ops[0], { op: 'focus', e: 2 });
  G.execOps(S, ops);
  assert.strictEqual(S.focus[1], 2);
  assert.ok(!S.over);
  inv(S);
});
test('两个目标都无己子（被迫空过）：仍能选出一个不崩溃', () => {
  const S = fresh(); S.turn = 1; S.focus[1] = 2;
  S.stage = 'focus'; S.acted = 2;
  put(S, 2, 5, 1);                                   // 白子全在未来（当前焦点时空）
  const ops = G.aiPlan(S, () => 0);
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].op, 'focus');
  assert.ok(ops[0].e === 0 || ops[0].e === 1);       // 过去/现在二选一
  inv(S);
});

console.log('— 人机折返惩罚（禁止"先左再右"式净零空耗）—');
test('存在真推进路径时：AI 不得两动后布子与回合初完全相同', () => {
  // 白方「现在」时空 1/3/6 号子：首个合法候选"1→5 再回 1"即净零折返（同分平局最易被首个候选吃掉）；
  // 黑子占住 1/3/6 的穿越起点堵穿越、白备用分身=0 禁逆时穿越、白已占满三时空 → 无任何加分走法，
  // 只有折返与纯走位同分 → 修正后 AI 必须避开折返、改变布局
  const S = fresh(); S.turn = 1; S.focus[1] = 1;
  S.spares = [4, 0]; S.dead = [0, 4];                // 白无分身 → 逆时穿越不可用
  put(S, 1, 1, 1); put(S, 1, 3, 1); put(S, 1, 6, 1); // 白三子可动
  put(S, 0, 12, 1); put(S, 0, 13, 1); put(S, 0, 14, 1); put(S, 0, 15, 1); // 白占三时空
  put(S, 2, 15, 1);
  put(S, 0, 1, 0); put(S, 0, 3, 0); put(S, 0, 6, 0); // 黑堵穿越起点
  put(S, 2, 1, 0); put(S, 2, 3, 0); put(S, 2, 6, 0);
  const snap = () => JSON.stringify(S.boards.map(b => b.cell.map(p => (p ? p.c : -1))));
  const before = snap();
  const ops = G.aiPlan(S, () => 0);
  assert.strictEqual(ops[0].op, 'select');           // 有子可动，不许空过
  G.execOps(S, ops);
  assert.ok(!S.over);
  assert.notStrictEqual(snap(), before, 'AI 两动后回到原布局 = 折返空耗 2 行动');
  inv(S);
});

console.log('— 生长模组：播种合法性 —');
test('播种范围=己子所在格+四邻；己子站格可播、对手子不可、斜角不可', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 5, 0);
  put(S, 0, 10, 1);                       // 对手子不在范围内（仅安放）
  assert.ok(G.selectPiece(S, 0, 5));
  const acts = G.legalActions(S, 0, 5);
  assert.ok(hasSow(acts, 5) && hasSow(acts, 1) && hasSow(acts, 4) && hasSow(acts, 6) && hasSow(acts, 9));
  assert.ok(!hasSow(acts, 2) && !hasSow(acts, 10));   // 斜角 / 范围外
  invG(S);
});
test('种子池为空 → 无可播；已有种子/植物格拒播；有种子可拨', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 5, 0);
  putSd(S, 0, 1); putSd(S, 0, 9); putSd(S, 1, 3); putSd(S, 2, 7); putSd(S, 0, 13);  // 池 = 0
  putPl(S, 0, 6, 'bush');
  assert.strictEqual(S.seeds, 0);
  assert.ok(G.selectPiece(S, 0, 5));
  const acts = G.legalActions(S, 0, 5);
  assert.ok(!acts.some(a => a.t === 'sow'), '池空不应提供播种');
  assert.ok(hasPluck(acts, 1) && hasPluck(acts, 9) && !hasPluck(acts, 6));  // 种子可拨；灌木丛非种子
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 0;
  put(U, 0, 5, 0);
  putSd(U, 0, 4); putPl(U, 0, 6, 'tree', 0); put(U, 0, 9, 1);   // 己子格可播测试另置
  assert.ok(G.selectPiece(U, 0, 5));
  const uActs = G.legalActions(U, 0, 5);
  assert.ok(!hasSow(uActs, 4), '已有种子拒播');   // sd
  assert.ok(!hasSow(uActs, 6), '已有植物拒播');   // 站立树
  assert.ok(!hasSow(uActs, 9), '对手子占格拒播');
  assert.ok(hasPluck(uActs, 4), '种子上可拨');
  assert.ok(hasSow(uActs, 5), '己子站格可播');
  invG(U);
});

console.log('— 生长模组：播种级联（朝未来即时结算）—');
test('过去播种空列 → 现在长灌木+未来长大树（一次行动两段生长）', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 1, 0);
  assert.ok(G.selectPiece(S, 0, 1));
  const r = G.applyAction(S, { t: 'sow', to: 1 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.evs.map(e => e.k), ['seed', 'grow', 'grow']);
  assert.strictEqual(r.evs[1].pl, 'bush');
  assert.strictEqual(r.evs[2].pl, 'tree');
  assert.ok(seedAt(S, 0, 1));
  assert.strictEqual(plAt(S, 1, 1).k, 'bush');
  assert.deepStrictEqual(plAt(S, 2, 1), { k: 'tree', down: 0 });
  assert.strictEqual(S.seeds, 4);
  assert.strictEqual(S.stage, 'act');       // 播种不位移、不结束行动
  assert.deepStrictEqual(S.sel, { era: 0, i: 1 });
  invG(S);
});
test('现在播种 → 只长未来灌木；未来播种 → 无植物', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 1;
  put(S, 1, 5, 0);
  assert.ok(G.selectPiece(S, 1, 5));
  const r = G.applyAction(S, { t: 'sow', to: 5 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.evs.map(e => e.k), ['seed', 'grow']);
  assert.strictEqual(plAt(S, 2, 5).k, 'bush');
  assert.ok(!plAt(S, 0, 5));
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 2;
  put(U, 2, 3, 0);
  assert.ok(G.selectPiece(U, 2, 3));
  const r2 = G.applyAction(U, { t: 'sow', to: 3 });
  assert.ok(r2.ok);
  assert.deepStrictEqual(r2.evs.map(e => e.k), ['seed']);
  assert.ok(!plAt(U, 0, 3) && !plAt(U, 1, 3) && !plAt(U, 2, 3));
  invG(U);
});
test('级联位有棋子/植物则对应长不出来（其余级联不受影响）', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 1, 0);
  put(S, 1, 1, 1);                     // 现在同号格有子 → 灌木长不出（树更无从谈起）
  assert.ok(G.selectPiece(S, 0, 1));
  const r = G.applyAction(S, { t: 'sow', to: 1 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.evs.map(e => e.k), ['seed']);
  assert.ok(!plAt(S, 1, 1) && !plAt(S, 2, 1));
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 0;
  put(U, 0, 6, 0);
  put(U, 2, 6, 0);                     // 未来同号格有子 → 灌木长出、大树长不出
  assert.ok(G.selectPiece(U, 0, 6));
  const r2 = G.applyAction(U, { t: 'sow', to: 6 });
  assert.ok(r2.ok);
  assert.strictEqual(r2.evs.filter(e => e.k === 'grow').length, 1);
  assert.strictEqual(plAt(U, 1, 6).k, 'bush');
  assert.ok(!plAt(U, 2, 6));
  invG(U);
});

console.log('— 生长模组：拨除（槽位级联回收）—');
test('播后拨除同格种子：关联灌木/大树全消、种子回池、行动结束入 focus', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 1, 0); put(S, 2, 10, 0);   // 黑占过去+未来两时空（判负兜底）
  put(S, 1, 10, 1); put(S, 2, 12, 1);  // 白占现在+未来两时空
  assert.ok(G.selectPiece(S, 0, 1));
  const r1 = G.applyAction(S, { t: 'sow', to: 1 });
  assert.ok(r1.ok);
  assert.strictEqual(plAt(S, 1, 1).k, 'bush');
  assert.strictEqual(plAt(S, 2, 1).k, 'tree');
  assert.strictEqual(S.seeds, 4);
  const r2 = G.applyAction(S, { t: 'pluck', to: 1 });
  assert.ok(r2.ok);
  assert.deepStrictEqual(r2.evs.map(e => e.k), ['poof', 'poof', 'poof']);
  assert.deepStrictEqual(r2.evs.map(e => e.pl), ['seed', 'bush', 'tree']);
  assert.ok(!seedAt(S, 0, 1) && !plAt(S, 1, 1) && !plAt(S, 2, 1));
  assert.strictEqual(S.seeds, 5);
  assert.strictEqual(S.stage, 'focus');
  assert.ok(!S.over);
  invG(S);
});
test('拨除可回收：对手子站着的种子、倒树盖住的种子（倒树不动）', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 5, 0); put(S, 2, 10, 0); put(S, 1, 10, 1); put(S, 2, 12, 1); // 判负兜底
  putSd(S, 0, 4); put(S, 0, 4, 1);            // 对手子站在种子上
  putSd(S, 0, 9); putPl(S, 0, 9, 'tree', 1);  // 种子被倒树盖住
  assert.strictEqual(S.seeds, 3);
  assert.ok(G.selectPiece(S, 0, 5));
  const acts = G.legalActions(S, 0, 5);
  assert.ok(hasPluck(acts, 4) && hasPluck(acts, 9));
  const r1 = G.applyAction(S, { t: 'pluck', to: 4 });
  assert.ok(r1.ok);
  assert.strictEqual(color(S, 0, 4), 1);      // 棋子仍在
  assert.strictEqual(S.seeds, 4);
  const r2 = G.applyAction(S, { t: 'pluck', to: 9 });
  assert.ok(r2.ok);
  assert.strictEqual(S.seeds, 5);
  assert.ok(!seedAt(S, 0, 9));
  assert.deepStrictEqual(plAt(S, 0, 9), { k: 'tree', down: 1 });  // 倒树留在原地
  assert.strictEqual(S.stage, 'focus');       // 2 次行动结束
  invG(S);
});
test('拨除现在时空种子：仅消本种子长出的未来灌木，过去植物不受影响', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 1;
  put(S, 1, 5, 0);                            // 黑棋子站种子格（同一行动棋子）
  putSd(S, 1, 5);
  putPl(S, 2, 5, 'bush');                     // 本种子播种时即时长出的未来灌木 → 将随之消逝
  putPl(S, 0, 6, 'bush');                     // 过去6号格灌木（他列，不受影响）
  assert.ok(G.selectPiece(S, 1, 5));
  const r = G.applyAction(S, { t: 'pluck', to: 5 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.evs.map(e => e.pl), ['seed', 'bush']);
  assert.ok(!seedAt(S, 1, 5) && !plAt(S, 2, 5));
  assert.strictEqual(plAt(S, 0, 6).k, 'bush');  // 过去灌木与之无关，保留
  assert.strictEqual(S.seeds, 5);
  invG(S);
});
test('别家倒树落入自家大树腾出的原槽位 → 拨除不误消（按来源判定）', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 4, 0); putSd(S, 0, 4); putPl(S, 1, 4, 'bush');
  S.boards[2].pl[8] = { k: 'tree', down: 1, o: 4 };  // 自家大树被下推 → 未来9号格（记原列 4）
  S.boards[2].pl[4] = { k: 'tree', down: 1, o: 3 };  // 别家树（原列 3）倒进腾空的槽位 (2,4)
  assert.ok(G.selectPiece(S, 0, 4));
  const r = G.applyAction(S, { t: 'pluck', to: 4 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.evs.map(e => [e.era, e.idx]), [[0, 4], [1, 4], [2, 8]]);
  assert.ok(!plAt(S, 2, 8));
  assert.deepStrictEqual(plAt(S, 2, 4), { k: 'tree', down: 1, o: 3 }, '槽位上别家来源的倒树保留');
  assert.strictEqual(S.seeds, 5);
  invG(S);
});
test('空格/活植物上无种子 → 无拨除行动', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 5, 0);
  putPl(S, 0, 6, 'bush');
  assert.ok(G.selectPiece(S, 0, 5));
  const acts = G.legalActions(S, 0, 5);
  assert.ok(!acts.some(a => a.t === 'pluck'));
  invG(S);
});
test('大树被推倒离开原列（下推 1 格）→ 拨除原列种子仍追消该倒树', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 4, 0); putSd(S, 0, 4);               // 过去5号格种子：长于 (1,4) 灌木 + (2,4) 大树
  putPl(S, 1, 4, 'bush');
  S.boards[2].pl[8] = { k: 'tree', down: 1, o: 4 };  // 大树被向下推倒 → 倒未来9号格（原列 4）
  assert.ok(G.selectPiece(S, 0, 4));
  const r = G.applyAction(S, { t: 'pluck', to: 4 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.evs.map(e => e.k), ['poof', 'poof', 'poof']);
  assert.deepStrictEqual(r.evs.map(e => [e.era, e.idx, e.pl]), [[0, 4, 'seed'], [1, 4, 'bush'], [2, 8, 'tree']]);
  assert.ok(!seedAt(S, 0, 4) && !plAt(S, 1, 4) && !plAt(S, 2, 8));
  assert.strictEqual(S.seeds, 5);
  invG(S);
});
test('原列四周邻格的别家来源倒树（o 不同）→ 拨除只消自家不误消', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 4, 0); putSd(S, 0, 4); putPl(S, 1, 4, 'bush');
  S.boards[2].pl[8] = { k: 'tree', down: 1, o: 4 };   // 自家大树向下倒在 9 号格
  S.boards[2].pl[0] = { k: 'tree', down: 1, o: 0 };   // 别家倒树落在上邻格
  S.boards[2].pl[3] = { k: 'tree', down: 1, o: 3 };   // 别家倒树落在左邻格
  S.boards[2].pl[5] = { k: 'tree', down: 1, o: 5 };   // 别家倒树落在右邻格
  assert.ok(G.selectPiece(S, 0, 4));
  const r = G.applyAction(S, { t: 'pluck', to: 4 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.evs.map(e => [e.era, e.idx]), [[0, 4], [1, 4], [2, 8]]);
  assert.ok(!plAt(S, 2, 8));
  assert.deepStrictEqual(plAt(S, 2, 0), { k: 'tree', down: 1, o: 0 }, '上邻别家倒树保留');
  assert.deepStrictEqual(plAt(S, 2, 3), { k: 'tree', down: 1, o: 3 }, '左邻别家倒树保留');
  assert.deepStrictEqual(plAt(S, 2, 5), { k: 'tree', down: 1, o: 5 }, '右邻别家倒树保留');
  invG(S);
});

console.log('— 生长模组：种子透明（行走/推挤/穿越）—');
test('棋子可行走、推链穿过种子格，种子保留在脚下', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 1, 0); putSd(S, 0, 2);
  assert.ok(G.selectPiece(S, 0, 1));
  assert.ok(hasMove(G.legalActions(S, 0, 1), 'right', 2));
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 2 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 2), 0);
  assert.ok(seedAt(S, 0, 2), '种子留在棋子脚下');
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 0;
  put(U, 0, 1, 0); put(U, 0, 2, 1); putSd(U, 0, 3);
  assert.ok(G.selectPiece(U, 0, 1));
  const r2 = G.applyAction(U, { t: 'move', d: 'right', to: 2 });  // 推白穿种子格
  assert.ok(r2.ok);
  assert.strictEqual(color(U, 0, 2), 0);
  assert.strictEqual(color(U, 0, 3), 1);
  assert.ok(seedAt(U, 0, 3), '种子被推链穿过仍保留');
  invG(U);
});
test('穿越可落种子格；落点为灌木/站立树/倒树均不可穿', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 9, 0); putSd(S, 1, 9);
  assert.ok(G.selectPiece(S, 0, 9));
  assert.ok(hasTravel(G.legalActions(S, 0, 9), 1));
  const r = G.applyAction(S, { t: 'travel', e2: 1 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 1, 9), 0);
  assert.ok(seedAt(S, 1, 9));
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 0;
  put(U, 0, 10, 0); put(U, 0, 11, 0); put(U, 0, 12, 0);
  putPl(U, 1, 10, 'bush'); putPl(U, 1, 11, 'tree', 0); putPl(U, 1, 12, 'tree', 1);
  for (const i of [10, 11, 12]) {
    const acts = G.legalActions(U, 0, i);
    assert.ok(!hasTravel(acts, 1), 'i=' + i + ' 穿越应被植物挡住');
  }
  invG(U);
});

console.log('— 生长模组：官方案例 E1–E5 —');
test('E1 移动者撞站立树 → 树倒压垮落点敌子，移动者落树的原格', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 1, 0); putPl(S, 0, 2, 'tree', 0); put(S, 0, 3, 1);
  assert.ok(G.selectPiece(S, 0, 1));
  const acts = G.legalActions(S, 0, 1);
  assert.ok(hasMove(acts, 'right', 2), '推倒合法');
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 2 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 1), null);
  assert.strictEqual(color(S, 0, 2), 0, '移动者落树的原格');
  assert.strictEqual(color(S, 0, 3), null, '敌子被压垮');
  assert.deepStrictEqual(plAt(S, 0, 2), null);
  assert.deepStrictEqual(plAt(S, 0, 3), { k: 'tree', down: 1, o: 2 }, '树倒在敌子原格（记原列）');
  assert.deepStrictEqual(S.dead, [0, 1]);
  const dies = r.evs.filter(e => e.k === 'die');
  assert.strictEqual(dies.length, 1);
  assert.strictEqual(dies[0].why, 'crush');
  const falls = r.evs.filter(e => e.k === 'fall');
  assert.strictEqual(falls.length, 1);
  assert.deepStrictEqual({ f: falls[0].from, t: falls[0].to, no: falls[0].no }, { f: 2, t: 3, no: 0 });
  invG(S);
});
test('E2 双树连排贴墙（树@3号、4号）→ 右移被禁止', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 1, 0); putPl(S, 0, 2, 'tree', 0); putPl(S, 0, 3, 'tree', 0);
  assert.ok(G.selectPiece(S, 0, 1));
  const acts = G.legalActions(S, 0, 1);
  assert.ok(!hasMove(acts, 'right', 2), '墙顶住树 → 移动不合法');
  assert.ok(!G.applyAction(S, { t: 'move', d: 'right', to: 2 }).ok);
  invG(S);
});
test('E3 双树连排可倒 → 多米诺：两树各倒一格，移动者落第一树原格', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 0, 0); putPl(S, 0, 1, 'tree', 0); putPl(S, 0, 2, 'tree', 0);
  assert.ok(G.selectPiece(S, 0, 0));
  assert.ok(hasMove(G.legalActions(S, 0, 0), 'right', 1));
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 1 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 0), null);
  assert.strictEqual(color(S, 0, 1), 0, '移动者落第一树原格');
  assert.deepStrictEqual(plAt(S, 0, 1), null);
  assert.deepStrictEqual(plAt(S, 0, 2), { k: 'tree', down: 1, o: 1 });
  assert.deepStrictEqual(plAt(S, 0, 3), { k: 'tree', down: 1, o: 2 });
  const falls = r.evs.filter(e => e.k === 'fall');
  assert.deepStrictEqual(falls.map(f => f.from + '→' + f.to + '@' + f.no), ['2→3@1', '1→2@0'], 'no 从触发侧递增');
  invG(S);
});
test('E4 树@2号格+灌木@3号格 → 右移被禁止', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 0, 0); putPl(S, 0, 1, 'tree', 0); putPl(S, 0, 2, 'bush');
  assert.ok(G.selectPiece(S, 0, 0));
  assert.ok(!hasMove(G.legalActions(S, 0, 0), 'right', 1));
  assert.ok(!G.applyAction(S, { t: 'move', d: 'right', to: 1 }).ok);
  invG(S);
});
test('E5 推链顶树被墙挡 → 树不倒、接触棋子挤死（树@3号、4号贴墙）', () => {
  const S = freshG(); S.turn = 1; S.focus[1] = 0;
  put(S, 0, 0, 1); put(S, 0, 1, 0); putPl(S, 0, 2, 'tree', 0); putPl(S, 0, 3, 'tree', 0);
  assert.ok(G.selectPiece(S, 0, 0));
  const acts = G.legalActions(S, 0, 0);
  assert.ok(hasMove(acts, 'right', 1), '推链顶树合法（树不倒则挤死）');
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 1 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 1), 1, '白移动者落目标格');
  assert.strictEqual(color(S, 0, 0), null);
  assert.deepStrictEqual(S.dead, [1, 0]);
  assert.deepStrictEqual(plAt(S, 0, 2), { k: 'tree', down: 0 }, '树原地不动');
  assert.deepStrictEqual(plAt(S, 0, 3), { k: 'tree', down: 0 });
  assert.ok(!r.evs.some(e => e.k === 'fall'), '无树倒事件');
  const dies = r.evs.filter(e => e.k === 'die');
  assert.strictEqual(dies[0].why, 'squash');
  assert.strictEqual(dies[0].idx, 1);
  invG(S);
});

console.log('— 生长模组：推倒边界 —');
test('树倒落点可有种子（树盖住种子，种子保留）；压垮己子合法', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 0, 0); putPl(S, 0, 1, 'tree', 0); putPl(S, 0, 2, 'tree', 0); putSd(S, 0, 3);
  assert.ok(G.selectPiece(S, 0, 0));
  assert.ok(hasMove(G.legalActions(S, 0, 0), 'right', 1));
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 1 });
  assert.ok(r.ok);
  assert.deepStrictEqual(plAt(S, 0, 3), { k: 'tree', down: 1, o: 2 });
  assert.ok(seedAt(S, 0, 3), '种子被倒树盖住仍保留');
  assert.strictEqual(S.seeds, 4);         // 无额外变化
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 0;
  put(U, 0, 0, 0); putPl(U, 0, 1, 'tree', 0); putPl(U, 0, 2, 'tree', 0); put(U, 0, 3, 0); // 落点己子
  assert.ok(G.selectPiece(U, 0, 0));
  assert.ok(hasMove(G.legalActions(U, 0, 0), 'right', 1), '压垮己子合法');
  const r2 = G.applyAction(U, { t: 'move', d: 'right', to: 1 });
  assert.ok(r2.ok);
  assert.deepStrictEqual(U.dead, [1, 0]);
  assert.strictEqual(color(U, 0, 3), null);
  assert.deepStrictEqual(plAt(U, 0, 3), { k: 'tree', down: 1, o: 2 });
  invG(U);
});
test('落点为倒树/墙 → 直推禁止；倒树不可再推、不可进入', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 0, 0); putPl(S, 0, 1, 'tree', 0); putPl(S, 0, 2, 'tree', 1); // 倒树堵落点
  assert.ok(G.selectPiece(S, 0, 0));
  assert.ok(!hasMove(G.legalActions(S, 0, 0), 'right', 1));
  assert.ok(!G.applyAction(S, { t: 'move', d: 'right', to: 1 }).ok);
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 0;
  put(U, 0, 0, 0); putPl(U, 0, 1, 'tree', 1);   // 倒树不可进入
  assert.ok(G.selectPiece(U, 0, 0));
  assert.ok(!hasMove(G.legalActions(U, 0, 0), 'right', 1));
  invG(U);
});
test('推链前端撞灌木丛/倒树 = 撞墙出局（植物墙语义）', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 0, 0); put(S, 0, 1, 1); putPl(S, 0, 2, 'bush');
  assert.ok(G.selectPiece(S, 0, 0));
  assert.ok(hasMove(G.legalActions(S, 0, 0), 'right', 1));
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 1 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 1), 0);
  assert.strictEqual(color(S, 0, 2), null, '白撞灌木墙出局');
  assert.deepStrictEqual(S.dead, [0, 1]);
  assert.strictEqual(r.evs.filter(e => e.k === 'die')[0].why, 'wall');
  assert.strictEqual(plAt(S, 0, 2).k, 'bush', '灌木原地不动');
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 0;
  put(U, 0, 0, 0); put(U, 0, 1, 1); putPl(U, 0, 2, 'tree', 1); // 倒树=墙
  assert.ok(G.selectPiece(U, 0, 0));
  const r2 = G.applyAction(U, { t: 'move', d: 'right', to: 1 });
  assert.ok(r2.ok);
  assert.strictEqual(color(U, 0, 2), null);
  assert.deepStrictEqual(U.dead, [0, 1]);
  assert.strictEqual(r2.evs.filter(e => e.k === 'die')[0].why, 'wall');
  invG(U);
});

console.log('— 生长模组：悖论死者不触发树倒（整局退化为基础推挤）—');
test('链末悖论对紧贴树：悖论双死、树原地不动、移动者落位同基础规则', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 0, 0); put(S, 0, 1, 1); put(S, 0, 2, 1); putPl(S, 0, 3, 'tree', 0);
  assert.ok(G.selectPiece(S, 0, 0));
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 1 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 1), 0, '移动者落位同基础');
  assert.strictEqual(color(S, 0, 2), null);
  assert.deepStrictEqual(S.dead, [0, 2], '两白悖论出局');
  assert.deepStrictEqual(plAt(S, 0, 3), { k: 'tree', down: 0 }, '树不受悖论死影响');
  assert.ok(!r.evs.some(e => e.k === 'fall'));
  assert.ok(r.evs.filter(e => e.k === 'die').every(e => e.why === 'paradox'));
  invG(S);
});
test('悖论对在链末（白方推黑对）：整局退化为基础规则，树原地不动', () => {
  const S = freshG(); S.turn = 1; S.focus[1] = 0;
  put(S, 0, 0, 1); put(S, 0, 1, 0); put(S, 0, 2, 0); putPl(S, 0, 3, 'tree', 0);
  // 白推 [黑@2号,黑@3号] 悖论对（链末2子同色）+ 树贴墙 → 挤死语义不叠加，树不动
  assert.ok(G.selectPiece(S, 0, 0));
  const r = G.applyAction(S, { t: 'move', d: 'right', to: 1 });
  assert.ok(r.ok);
  assert.strictEqual(color(S, 0, 1), 1);
  assert.deepStrictEqual(S.dead, [2, 0]);
  assert.ok(!r.evs.some(e => e.k === 'fall'));
  assert.ok(r.evs.filter(e => e.k === 'die').every(e => e.why === 'paradox'));
  invG(S);
});

console.log('— 生长模组：行动流程集成 —');
test('仅有播种可用的棋子仍可选（选子标准=含播种在内的合法行动）', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 5, 0);
  put(S, 0, 1, 0); put(S, 0, 4, 0); put(S, 0, 6, 0); put(S, 0, 9, 0); // 四邻己方 → 无移动
  put(S, 1, 5, 0);                                                     // 穿越目标被己子占 → 无穿越
  const sel = G.selectablePieces(S).map(p => p.i);
  assert.deepStrictEqual(sel, [1, 4, 5, 6, 9], '四周己子也各只有播种可选 → 全可选');
  assert.ok(G.selectPiece(S, 0, 5));
  const acts = G.legalActions(S, 0, 5);
  assert.ok(acts.length === 1 && acts[0].t === 'sow' && acts[0].to === 5, '四邻己子皆不可播 → 仅脚下可播');
  invG(S);
});
test('播种规则：脚下格必可播；四邻站任意棋子/种子/植物皆拒播', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 5, 0);
  put(S, 0, 1, 0);                        // 己方棋子邻格 → 拒
  putSd(S, 0, 4);                          // 种子邻格 → 拒
  putPl(S, 0, 6, 'bush');                 // 植物邻格 → 拒
  put(S, 0, 9, 1);                         // 对手棋子邻格 → 拒
  assert.ok(G.selectPiece(S, 0, 5));
  const acts = G.legalActions(S, 0, 5);
  assert.ok(hasSow(acts, 5), '脚下格必可播');
  assert.ok(!hasSow(acts, 1) && !hasSow(acts, 4) && !hasSow(acts, 6) && !hasSow(acts, 9), '四邻有任何东西皆拒播');
  assert.ok(hasPluck(acts, 4), '邻格种子仍可拨');
  invG(S);
});
test('播种1次后仍可播种时不可结束行动；拨除/播种凑满2次入移焦点', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 5, 0); put(S, 2, 10, 0);       // 黑两时空
  put(S, 1, 10, 1); put(S, 2, 12, 1);      // 白两时空
  put(S, 0, 1, 0); put(S, 0, 4, 0); put(S, 0, 9, 0);  // 5号三面己方；6号留空（四邻空格，供第二次播种）
  put(S, 1, 5, 0);                         // 穿越目标被己子占 → 不可穿越
  assert.ok(G.selectPiece(S, 0, 5));
  assert.ok(G.applyAction(S, { t: 'sow', to: 5 }).ok);
  assert.strictEqual(S.acted, 1);
  assert.strictEqual(G.canEnd(S), false, '仍可播种 → 不可提前结束');
  assert.strictEqual(G.endActions(S), false);
  assert.strictEqual(S.seeds, 4);
  assert.ok(G.applyAction(S, { t: 'sow', to: 6 }).ok);
  assert.strictEqual(S.acted, 2);
  assert.strictEqual(S.stage, 'focus');
  assert.ok(!S.over);
  invG(S);
});
test('播种后棋子未位移 → 第二次行动可混搭移动；播种+移动组合正常入 focus', () => {
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  put(S, 0, 5, 0); put(S, 2, 10, 0);
  put(S, 1, 10, 1); put(S, 2, 12, 1);
  assert.ok(G.selectPiece(S, 0, 5));
  assert.ok(G.applyAction(S, { t: 'sow', to: 1 }).ok);
  assert.strictEqual(color(S, 0, 5), 0, '播种不位移');
  assert.ok(G.legalActions(S, 0, 5).some(a => a.t === 'move'));
  assert.ok(G.applyAction(S, { t: 'move', d: 'right', to: 6 }).ok);
  assert.strictEqual(S.stage, 'focus');
  invG(S);
  const U = freshG(); U.turn = 0; U.focus[0] = 0;
  put(U, 0, 5, 0); put(U, 2, 10, 0);
  put(U, 1, 10, 1); put(U, 2, 12, 1);
  assert.ok(G.selectPiece(U, 0, 5));
  assert.ok(G.applyAction(U, { t: 'move', d: 'right', to: 6 }).ok);
  assert.strictEqual(color(U, 0, 6), 0);
  assert.ok(G.applyAction(U, { t: 'sow', to: 6 }).ok);   // 落点播种
  assert.strictEqual(U.stage, 'focus');
  assert.ok(seedAt(U, 0, 6));
  assert.ok(!seedAt(U, 0, 5));
  invG(U);
});
test('行动1次后无路可走（穿越入绝地）→ 提前结束行动（canEnd）', () => {
  // 生长模组下播种/拨除/移动后总有回头路（拨回刚播的种子/退回原格），
  // canEnd 唯可达路径 = 穿越后目标格四邻全堵 + 池枯竭 + 分身耗尽
  const S = freshG(); S.turn = 0; S.focus[0] = 0;
  S.spares = [0, 4]; S.dead = [4, 0];              // 黑无分身（逆时穿越不可用）→ 阵亡预置 4 守恒
  put(S, 0, 5, 0); put(S, 0, 12, 0);                   // 黑占过去（焦点时空）
  put(S, 2, 5, 0);                                     // 未来堵穿越前进位
  put(S, 1, 1, 0); put(S, 1, 4, 0); put(S, 1, 6, 0); put(S, 1, 9, 0); // 现在时空四邻全己子
  put(S, 0, 14, 1); put(S, 1, 10, 1); put(S, 2, 14, 1);               // 白占三时空（判负兜底）
  for (const i of [12, 13, 14, 15, 2]) putSd(S, 0, i);               // 池耗尽（种子皆远离 (1,5)）
  assert.ok(G.selectPiece(S, 0, 5));                   // 过去格穿越合法（(1,5) 空）
  const r = G.applyAction(S, { t: 'travel', e2: 1 });
  assert.ok(r.ok);
  assert.strictEqual(S.acted, 1);
  assert.strictEqual(G.legalActions(S, 1, 5).length, 0, '四邻己子+穿越双堵+池枯 → 零行动');
  assert.ok(G.canEnd(S));
  assert.ok(G.endActions(S));
  assert.strictEqual(S.stage, 'focus');
  assert.ok(!S.over);
  invG(S);
});

console.log('— 生长模组：开启但无植物时与基础规则逐字节一致 —');
test('生长开启+纯棋子局面：推链悖论+撞墙场景结果与基础完全相同', () => {
  const B = fresh(); B.focus[0] = 0;                      // 基础参考局（无模组）
  put(B, 0, 0, 0); put(B, 0, 1, 1); put(B, 0, 2, 1); put(B, 0, 3, 0);
  assert.ok(G.selectPiece(B, 0, 0));
  const rb = G.applyAction(B, { t: 'move', d: 'right', to: 1 });
  assert.ok(rb.ok);
  const M = freshG(); M.focus[0] = 0;                     // 同场景但 mods 开启（无任何植物）
  put(M, 0, 0, 0); put(M, 0, 1, 1); put(M, 0, 2, 1); put(M, 0, 3, 0);
  assert.ok(G.selectPiece(M, 0, 0));
  const rm = G.applyAction(M, { t: 'move', d: 'right', to: 1 });
  assert.ok(rm.ok);
  assert.deepStrictEqual(rm.evs, rb.evs, '事件流一致');
  for (let e = 0; e < 3; e++) {
    const cb = B.boards[e].cell.map(p => p ? p.c : -1);
    const cm = M.boards[e].cell.map(p => p ? p.c : -1);
    assert.deepStrictEqual(cm, cb, '盘面一致 e=' + e);
    assert.ok(M.boards[e].pl.every(x => !x) && M.boards[e].sd.every(x => !x), '无植物/种子副作用');
  }
  assert.deepStrictEqual([M.dead, M.spares], [B.dead, B.spares]);
  assert.strictEqual(M.seeds, 5);
  invG(M);
});
test('生长开启+纯棋子局面：双穿越分身的落子与备用消耗与基础相同', () => {
  const B = fresh(); B.turn = 1; B.focus[1] = 2;
  put(B, 2, 5, 1); put(B, 1, 12, 0); put(B, 2, 12, 0);
  assert.ok(G.selectPiece(B, 2, 5));
  const r1b = G.applyAction(B, { t: 'travel', e2: 1 });
  assert.ok(r1b.ok);
  const r2b = G.applyAction(B, { t: 'travel', e2: 0 });
  assert.ok(r2b.ok);
  const M = freshG(); M.turn = 1; M.focus[1] = 2;
  put(M, 2, 5, 1); put(M, 1, 12, 0); put(M, 2, 12, 0);
  assert.ok(G.selectPiece(M, 2, 5));
  const r1m = G.applyAction(M, { t: 'travel', e2: 1 });
  assert.ok(r1m.ok);
  assert.deepStrictEqual(r1m.evs, r1b.evs);
  const r2m = G.applyAction(M, { t: 'travel', e2: 0 });
  assert.ok(r2m.ok);
  assert.deepStrictEqual(r2m.evs, r2b.evs);
  assert.deepStrictEqual([M.dead, M.spares, M.focus], [B.dead, B.spares, B.focus]);
  for (let e = 0; e < 3; e++) {
    const cb = B.boards[e].cell.map(p => p ? p.c : -1);
    const cm = M.boards[e].cell.map(p => p ? p.c : -1);
    assert.deepStrictEqual(cm, cb, '盘面一致 e=' + e);
  }
  invG(M);
});

console.log('— 生长模组：sameLayout 感知植物/种子层（净零识别）—');
test('sameLayout：种子差、植物差、树倒差、棋子差均判异；播种+拨除净零判同', () => {
  const gmod = G.MODULES.find(m => m.id === 'growth');
  const sl = gmod.sameLayout;
  const base = () => {
    const S = freshG();
    S.focus[0] = 0;                                   // 黑棋子放过去时空 → 焦点须指过去才能选子
    put(S, 0, 5, 0); put(S, 1, 5, 0); put(S, 2, 5, 0);
    put(S, 1, 10, 1); put(S, 2, 12, 1);   // 白两时空（判负兜底，不影响比较列）
    return S;
  };
  const A = base();
  assert.ok(sl(A, base()), '完全同布局判同');
  const B = base(); putSd(B, 0, 2);
  assert.ok(!sl(A, B), '种子差判异');
  const C = base(); putPl(C, 1, 6, 'bush');
  assert.ok(!sl(A, C), '植物差判异');
  const D = base(); putPl(D, 2, 7, 'tree', 1);
  const E = base(); putPl(E, 2, 7, 'tree', 0);
  assert.ok(!sl(D, E), '树倒/站立差判异');
  const F = base(); put(F, 0, 9, 1);
  assert.ok(!sl(A, F), '棋子差判异（基础比较仍生效）');
  // 播种→拨除净零：行动后布局与初始相同 → sameLayout 识别为同（供 AI 折返罚分）
  const G1 = base();
  const G2 = base();
  assert.ok(G.selectPiece(G2, 0, 5));
  assert.ok(G.applyAction(G2, { t: 'sow', to: 5 }).ok);
  assert.ok(G.applyAction(G2, { t: 'pluck', to: 5 }).ok);
  assert.strictEqual(G2.stage, 'focus');   // 两次行动结束但未终局（白仍有子）
  assert.ok(sl(G1, G2), '播种+拨除后判为净零同布局');
  invG(G2);
});
test('净零判定不因焦点移动的副产物误报：换位后布局不同则判异', () => {
  const gmod = G.MODULES.find(m => m.id === 'growth');
  const sl = gmod.sameLayout;
  const A = freshG(); put(A, 0, 5, 0); put(A, 1, 5, 0); put(A, 2, 5, 0);
  const B = freshG(); put(B, 0, 5, 0); put(B, 1, 5, 0); put(B, 2, 5, 0);
  B.focus[0] = 1;                                   // 仅焦点不同（非布局维度）
  assert.ok(sl(A, B), '焦点差异不算布局差异');
  assert.ok(sl(B, B));
});

console.log('— 生长模组：evalState 加权 sanity（植物按焦点时空归属）—');
test('对手焦点时空的植物为正、己方焦点时空为负；站立树 > 倒树 > 灌木', () => {
  const gmod = G.MODULES.find(m => m.id === 'growth');
  const ev = (S) => gmod.evalState(S, 1, () => 0);   // 以白方视角：myE=focus[1]=0, opE=focus[0]=2
  const mk = () => {
    const S = freshG();
    S.focus = [2, 0];
    put(S, 0, 0, 1); put(S, 1, 0, 1);                 // 白占过去+现在
    put(S, 1, 15, 0); put(S, 2, 15, 0);               // 黑占现在+未来
    return S;
  };
  const baseV = ev(mk());
  const opBush = mk(); putPl(opBush, 2, 9, 'bush');               // 未来=黑焦点时空 → 对白有利
  assert.ok(ev(opBush) > baseV, '对手焦点时空灌木为正');
  const myBush = mk(); putPl(myBush, 0, 9, 'bush');               // 过去=白焦点时空 → 障碍
  assert.ok(ev(myBush) < baseV, '己方焦点时空灌木为负');
  const opTree = mk(); putPl(opTree, 2, 10, 'tree', 0);
  const opFallen = mk(); putPl(opFallen, 2, 11, 'tree', 1);
  assert.ok(ev(opTree) > ev(opFallen) && ev(opFallen) > ev(opBush), '站立树>倒树>灌木');
  // 真实播种两态对比：长成大树的播位（树在对手焦点时空 +5+…）显著优于被堵死播位
  const fullSow = mk(); putSd(fullSow, 0, 2); putPl(fullSow, 1, 2, 'bush'); putPl(fullSow, 2, 2, 'tree', 0);
  const stuckSeed = mk(); put(stuckSeed, 1, 2, 0); putSd(stuckSeed, 0, 2);   // 黑子堵级联 + 黑子力惩罚
  assert.ok(ev(fullSow) > ev(stuckSeed), '长成大树的播位优于被黑子堵死的播位');
});

console.log('— 生长模组：AI 稳定性（每步守恒+出现过播种）—');
test('AI vs AI 10 局 + 随机 10 局：不崩溃、种子守恒、全程出现过播种/拨除', () => {
  let sawSeedAct = false;
  const runGame = (plan, label) => {
    const S = G.newGame('local2p', () => 0.618, ['growth']);
    let steps = 0;
    try {
      while (!S.over && S.turnNo < 400 && steps < 900) {
        const ops = plan(S);
        assert.ok(ops.length >= 1);
        G.execOps(S, ops);
        invG(S);
        if (S.log.some(l => l.text.indexOf('播下种子') >= 0)) sawSeedAct = true;
        steps++;
      }
    } catch (e) {
      console.log('    CRASH-' + label + ' step=' + steps + ' turnNo=' + S.turnNo + ' stage=' + S.stage);
      throw e;
    }
  };
  for (let g = 0; g < 10; g++) runGame(G.aiPlan, 'ai');
  for (let g = 0; g < 10; g++) runGame(G.randomPlan, 'rand');
  assert.ok(sawSeedAct, '生长对局中应至少出现过一次播种（池在动）');
  console.log('    20 局生长模组模拟通过，出现过播种/拨除事件');
});
test('AI 从存档断点续排（生长开启）：续走含播种的局面不崩溃', () => {
  const S = G.newGame('local2p', () => 0, ['growth']);
  S.__placed = [0, 0];
  S.turn = 0; S.focus[0] = 1;
  for (const b of S.boards) b.cell.fill(null);
  put(S, 0, 1, 1); put(S, 1, 1, 1); put(S, 2, 1, 1);   // 白三时空（免判负）
  put(S, 1, 5, 0);                                     // 黑现在5号
  assert.ok(G.selectPiece(S, 1, 5));
  assert.ok(G.applyAction(S, { t: 'sow', to: 5 }).ok); // 断点：已播1次，池=4
  assert.strictEqual(S.stage, 'act');
  const ops = G.aiPlan(S, () => 0);
  assert.ok(ops.length >= 2);
  G.execOps(S, ops);
  assert.ok(S.over || (S.turn === 1 && S.stage === 'select'));
  invG(S);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
