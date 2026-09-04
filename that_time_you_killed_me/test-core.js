/* ============================================================
   煞有其时 · 规则引擎单测（node test-core.js）
   覆盖：开局 / 推挤撞墙(例1) / 悖论(例2) / 双穿越分身(例3) /
        穿越占用 / 分身备用耗尽 / 己子目标禁止 / 结束行动 /
        强制2次行动 / 行动结束即判胜负与平局 / 空过 / 随机与AI对局不变量
   ============================================================ */
'use strict';
const G = require('./game.js');
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

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
