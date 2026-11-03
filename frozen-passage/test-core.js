/* 流冰航路 — 规则引擎单元测试：node test-core.js */
'use strict';

var assert = require('assert');
var FP = require('./game.js');

var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failed++;
    failures.push({ name: name, error: e });
    console.log('  \u2717 ' + name);
    console.log('    ' + e.message);
  }
}

function fresh(difficulty, seed) {
  return FP.createGame({ seed: seed == null ? 1234 : seed, difficulty: difficulty || 'novice' });
}

function clearBoard(s) {
  s.board.slots.forEach(function (slot) { slot.cardId = null; });
  s.phase = 'place';
  s.wisdom = false;
  s.turn = 1;
  s.lossReason = null;
  s.lossHint = false;
}

function put(s, row, index, cardId) {
  FP.slotByPos(s, row, index).cardId = cardId;
}

function setGoals(s, colors) {
  s.board.goals.forEach(function (g, i) {
    g.color = colors[i];
    g.faceUp = true;
  });
}

function setItems(s, types) {
  s.items = types.map(function (t, i) {
    return { id: 'item-' + (i + 1), type: t, used: false };
  });
}

function setHand(s, ids) {
  s.hand = ids.slice();
}

function cardNotIn(s, avoid) {
  var all = Object.keys(FP.CARDS);
  for (var i = 0; i < all.length; i++) {
    if (avoid.indexOf(all[i]) < 0) return all[i];
  }
  return null;
}

function fillVictoryBoard(s) {
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-6');
  put(s, 2, 2, 'black-7');
  put(s, 3, 1, 'blue-5');
  put(s, 3, 2, 'black-6');
  put(s, 3, 3, 'black-9');
  put(s, 4, 1, 'blue-3');
  put(s, 4, 2, 'red-4');
  put(s, 4, 3, 'black-5');
  put(s, 4, 4, 'red-7');
  put(s, 5, 1, 'blue-1');
  put(s, 5, 2, 'blue-2');
  put(s, 5, 3, 'red-5');
  put(s, 5, 4, 'black-8');
  put(s, 5, 5, 'red-9');
}

function stuckFixture() {
  var s = fresh('expert', 77);
  clearBoard(s);
  setGoals(s, ['blue', 'red', 'red', 'black', 'blue']);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-6');
  put(s, 2, 2, 'black-7');
  put(s, 3, 1, 'blue-5');
  put(s, 3, 2, 'black-6');
  put(s, 3, 3, 'black-9');
  put(s, 4, 1, 'blue-3');
  put(s, 4, 2, 'red-4');
  put(s, 4, 3, 'black-5');
  put(s, 4, 4, 'red-7');
  put(s, 5, 1, 'blue-1');
  put(s, 5, 2, 'red-5');
  put(s, 5, 4, 'black-8');
  put(s, 5, 5, 'blue-9');
  setHand(s, ['red-1', 'red-2', 'red-3', 'red-4']);
  s.phase = 'refill';
  s.turn = 8;
  s.supply = ['red-7', 'blue-6'];
  s.draw = [];
  return s;
}

/* ---------------- 1. 设置 ---------------- */

console.log('\n[1] 设置与组件');

test('27 张冰山卡唯一，3 色 × 1~9', function () {
  var ids = Object.keys(FP.CARDS);
  assert.strictEqual(ids.length, 27);
  assert.strictEqual(new Set(ids).size, 27);
  FP.COLORS.forEach(function (color) {
    for (var n = 1; n <= 9; n++) {
      assert.ok(FP.CARDS[color + '-' + n], color + '-' + n + ' 应存在');
    }
  });
});

test('单人开局：手牌 4、供应 3、抽牌 20、物品 3、目标 5', function () {
  var s = fresh('novice', 42);
  var all = s.hand.concat(s.supply, s.draw);
  assert.strictEqual(all.length, 27);
  assert.strictEqual(new Set(all).size, 27);
  assert.strictEqual(s.hand.length, 4);
  assert.strictEqual(s.supply.length, 3);
  assert.strictEqual(s.draw.length, 20);
  assert.strictEqual(s.items.length, 3);
  assert.strictEqual(s.board.goals.length, 5);
  assert.strictEqual(s.board.slots.length, 15);
  assert.deepStrictEqual(
    s.board.slots.map(function (x) { return x.row; }),
    [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5]
  );
  assert.ok(s.items.every(function (it) {
    return FP.ITEM_TYPES.indexOf(it.type) >= 0 && !it.used;
  }));
});

test('起始手牌按数字升序', function () {
  var s = fresh('novice', 99);
  for (var i = 1; i < s.hand.length; i++) {
    assert.ok(FP.CARDS[s.hand[i - 1]].number <= FP.CARDS[s.hand[i]].number);
  }
});

test('目标卡位于第 5 行下方，起始卡对应 r1-1', function () {
  var s = fresh('novice', 5);
  assert.strictEqual(s.board.starter.slotId, 'r1-1');
  assert.deepStrictEqual(
    s.board.goals.map(function (g) { return g.slotId; }),
    ['r5-1', 'r5-2', 'r5-3', 'r5-4', 'r5-5']
  );
  s.board.slots.filter(function (x) { return x.row === 5; }).forEach(function (slot, i) {
    assert.strictEqual(slot.goalId, s.board.goals[i].id);
  });
});

/* ---------------- 2. 难度 ---------------- */

console.log('\n[2] 难度');

test('新手 0 张目标卡正面', function () {
  var s = fresh('novice', 42);
  assert.deepStrictEqual(s.board.goals.map(function (g) { return g.faceUp; }), [false, false, false, false, false]);
});

test('中等翻开 1/3/5', function () {
  var s = fresh('medium', 42);
  assert.deepStrictEqual(s.board.goals.map(function (g) { return g.faceUp; }), [true, false, true, false, true]);
});

test('专家 5 张全正面', function () {
  var s = fresh('expert', 42);
  assert.ok(s.board.goals.every(function (g) { return g.faceUp; }));
});

test('同一 seed 下不同难度的目标颜色顺序一致', function () {
  var n = fresh('novice', 2024);
  var m = fresh('medium', 2024);
  var e = fresh('expert', 2024);
  var colors = n.board.goals.map(function (g) { return g.color; });
  assert.deepStrictEqual(m.board.goals.map(function (g) { return g.color; }), colors);
  assert.deepStrictEqual(e.board.goals.map(function (g) { return g.color; }), colors);
});

/* ---------------- 3. 规则① 支撑 ---------------- */

console.log('\n[3] 规则① 支撑');

test('第 1 行无支撑要求', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  assert.ok(FP.canPlace(s, 'blue-5', 'r1-1').ok);
});

test('第 2 行左右端各需下方 1 张', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  assert.strictEqual(FP.canPlace(s, 'blue-5', 'r2-1').ok, false);
  assert.strictEqual(FP.canPlace(s, 'blue-5', 'r2-1').code, 'support');
  assert.strictEqual(FP.canPlace(s, 'blue-5', 'r2-2').ok, false);
  put(s, 1, 1, 'blue-4');
  assert.ok(FP.canPlace(s, 'blue-5', 'r2-1').ok);
  assert.ok(FP.canPlace(s, 'blue-5', 'r2-2').ok);
});

test('第 3 行中间需下方 2 张，缺一不可', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-5');
  assert.strictEqual(FP.canPlace(s, 'blue-6', 'r3-2').ok, false);
  assert.strictEqual(FP.canPlace(s, 'blue-6', 'r3-2').code, 'support');
  put(s, 2, 2, 'blue-7');
  assert.ok(FP.canPlace(s, 'blue-6', 'r3-2').ok);
});

/* ---------------- 4. 规则② 颜色 ---------------- */

console.log('\n[4] 规则② 颜色 / 航线');

test('与下方任一张同色即可（另一张由上方邻牌接续）', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-5');
  put(s, 2, 2, 'black-7');
  put(s, 3, 1, 'blue-6');
  var r = FP.canPlace(s, 'black-8', 'r3-2');
  assert.ok(r.ok);
  assert.strictEqual(r.newRoute, false);
  assert.strictEqual(r.colorMatches.length, 1);
});

test('两侧上方都为空时可先放不同色，颜色义务延后补验', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-5');
  put(s, 2, 2, 'black-7');
  var r = FP.canPlace(s, 'red-8', 'r3-2');
  assert.ok(r.ok);
  assert.strictEqual(r.newRoute, true);
  assert.strictEqual(r.colorMatches.length, 0);

  put(s, 3, 1, 'blue-6');
  assert.ok(FP.canPlace(s, 'red-8', 'r3-2').ok);
  put(s, 3, 2, 'red-8');
  var blue = FP.canPlace(s, 'blue-9', 'r3-3');
  assert.strictEqual(blue.ok, false);
  assert.strictEqual(blue.code, 'color');
  assert.ok(FP.canPlace(s, 'black-9', 'r3-3').ok, '黑 7 的上方必须补黑色');
});

test('端位与唯一支撑同色时不是新航线', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-4');
  var r = FP.canPlace(s, 'blue-2', 'r2-2');
  assert.ok(r.ok);
  assert.strictEqual(r.newRoute, false);
});

test('规则②书中示例：蓝 2 已由蓝 5 接续，空位必须补黑色', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-2');
  put(s, 2, 2, 'black-5');
  put(s, 3, 1, 'blue-5');
  put(s, 3, 3, 'red-8');
  var blue = FP.canPlace(s, 'blue-6', 'r3-2');
  assert.strictEqual(blue.ok, false);
  assert.strictEqual(blue.code, 'color');
  var black = FP.canPlace(s, 'black-6', 'r3-2');
  assert.ok(black.ok);
});

test('规则②：下方蓝 9 的上方已有红 8 时，黑 9 不得压上', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-3');
  put(s, 2, 1, 'red-3');
  put(s, 2, 2, 'blue-6');
  put(s, 3, 1, 'black-1');
  put(s, 3, 2, 'red-5');
  put(s, 3, 3, 'blue-9');
  put(s, 4, 1, 'blue-1');
  put(s, 4, 2, 'black-4');
  put(s, 4, 3, 'red-8');
  var r = FP.canPlace(s, 'black-9', 'r4-4');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'color');
});

/* ---------------- 5. 规则③ 数字 ---------------- */

console.log('\n[5] 规则③ 数字');

test('同一行严格递增：右端必须更大', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-4');
  assert.strictEqual(FP.canPlace(s, 'red-4', 'r2-2').ok, false);
  assert.strictEqual(FP.canPlace(s, 'red-3', 'r2-2').ok, false);
  assert.ok(FP.canPlace(s, 'red-5', 'r2-2').ok);
});

test('中间空位只与最近左右邻比较', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'red-4');
  put(s, 2, 1, 'red-2');
  put(s, 2, 2, 'red-8');
  put(s, 3, 1, 'red-3');
  put(s, 3, 3, 'red-9');
  assert.ok(FP.canPlace(s, 'red-5', 'r3-2').ok);
  assert.strictEqual(FP.canPlace(s, 'red-3', 'r3-2').ok, false);
  assert.strictEqual(FP.canPlace(s, 'red-9', 'r3-2').ok, false);
});

test('不同行允许相同数字（斜向相邻）', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-5');
  var r = FP.canPlace(s, 'red-5', 'r2-1');
  assert.ok(r.ok);
});

test('因纽特智慧：左右紧邻 3/5 时中间 3、4、5 都可放', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-1');
  put(s, 2, 2, 'red-9');
  put(s, 3, 1, 'blue-3');
  put(s, 3, 3, 'red-5');

  assert.ok(FP.canPlace(s, 'black-4', 'r3-2').ok, '原本只有 4 合法');
  assert.strictEqual(FP.canPlace(s, 'black-3', 'r3-2').ok, false);
  assert.strictEqual(FP.canPlace(s, 'black-5', 'r3-2').ok, false);

  assert.ok(FP.canPlace(s, 'black-3', 'r3-2', { wisdom: true }).ok);
  assert.ok(FP.canPlace(s, 'black-4', 'r3-2', { wisdom: true }).ok);
  assert.ok(FP.canPlace(s, 'black-5', 'r3-2', { wisdom: true }).ok);
  assert.strictEqual(FP.canPlace(s, 'black-2', 'r3-2', { wisdom: true }).ok, false);
  assert.strictEqual(FP.canPlace(s, 'black-6', 'r3-2', { wisdom: true }).ok, false);
});

test('因纽特智慧不能跨越空位配对同数字', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-8');
  put(s, 2, 1, 'blue-4');
  put(s, 2, 2, 'red-7');
  put(s, 3, 1, 'black-1');
  put(s, 3, 2, 'blue-2');
  put(s, 3, 3, 'red-5');
  put(s, 4, 1, 'blue-3');
  put(s, 4, 4, 'red-6');

  assert.strictEqual(FP.canPlace(s, 'black-3', 'r4-3').ok, false);
  assert.strictEqual(
    FP.canPlace(s, 'black-3', 'r4-3', { wisdom: true }).ok,
    false,
    '左邻 3 隔着空位，不算“旁边”'
  );
  assert.strictEqual(FP.canPlace(s, 'black-6', 'r4-3').ok, false);
  assert.ok(
    FP.canPlace(s, 'black-6', 'r4-3', { wisdom: true }).ok,
    '右邻 6 紧邻时可以同数字'
  );
});

test('因纽特智慧不适用于航海日志换牌', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  setItems(s, ['log']);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-1');
  put(s, 2, 2, 'red-9');
  put(s, 3, 1, 'blue-3');
  put(s, 3, 2, 'black-4');
  put(s, 3, 3, 'red-5');
  setHand(s, ['black-3', 'black-8']);
  s.wisdom = true;

  assert.strictEqual(
    FP.logOptions(s).some(function (o) { return o.slotId === 'r3-2' && o.cardId === 'black-3'; }),
    false
  );
  var r = FP.useLog(s, 'r3-2', 'black-3');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'number-left');
});

/* ---------------- 6. 规则④ 目标卡 ---------------- */

console.log('\n[6] 规则④ 目标卡');

test('正面目标卡强制颜色', function () {
  var s = fresh('expert', 1);
  clearBoard(s);
  setGoals(s, ['blue', 'red', 'black', 'blue', 'red']);
  put(s, 4, 1, 'blue-3');
  assert.ok(FP.canPlace(s, 'blue-1', 'r5-1').ok);
  assert.strictEqual(FP.canPlace(s, 'red-1', 'r5-1').code, 'goal');
});

test('背面目标卡不限制颜色', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  s.board.goals.forEach(function (g) { g.faceUp = false; g.color = 'blue'; });
  put(s, 4, 1, 'blue-3');
  assert.ok(FP.canPlace(s, 'red-1', 'r5-1').ok);
});

test('中等仅 1/3/5 位置受目标卡约束', function () {
  var s = fresh('medium', 1);
  clearBoard(s);
  s.board.goals.forEach(function (g, i) {
    g.faceUp = i % 2 === 0;
    g.color = 'blue';
  });
  put(s, 4, 1, 'red-3');
  put(s, 4, 2, 'red-4');
  put(s, 4, 3, 'red-5');
  put(s, 4, 4, 'red-6');
  assert.strictEqual(FP.canPlace(s, 'red-1', 'r5-1').code, 'goal');
  assert.ok(FP.canPlace(s, 'red-2', 'r5-2').ok);
  assert.strictEqual(FP.canPlace(s, 'red-4', 'r5-3').code, 'goal');
  assert.ok(FP.canPlace(s, 'red-6', 'r5-4').ok);
  assert.strictEqual(FP.canPlace(s, 'red-8', 'r5-5').code, 'goal');
});

/* ---------------- 7. 回合与补牌 ---------------- */

console.log('\n[7] 回合与补牌');

test('放置 → 补牌 → 下一回合，手牌数恒定', function () {
  var s = fresh('novice', 2024);
  var first = s.hand[0];
  var r = FP.placeCard(s, first, 'r1-1');
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.phase, 'refill');
  assert.strictEqual(s.hand.length, 3);
  assert.strictEqual(s.supply.length, 3);
  assert.strictEqual(s.draw.length, 20);

  var pick = s.supply[0];
  var r2 = FP.chooseSupply(s, pick);
  assert.ok(r2.ok);
  s = r2.state;
  assert.strictEqual(s.hand.length, 4);
  assert.ok(s.hand.indexOf(pick) >= 0);
  assert.strictEqual(s.supply.indexOf(pick), -1);
  assert.strictEqual(s.supply.length, 3);
  assert.strictEqual(s.draw.length, 19);
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.phase, 'place');
  for (var i = 1; i < s.hand.length; i++) {
    assert.ok(FP.CARDS[s.hand[i - 1]].number <= FP.CARDS[s.hand[i]].number);
  }
});

test('抽牌堆为空时供应堆只减不补', function () {
  var s = fresh('novice', 8);
  var keep = s.supply.slice(0, 2);
  s.supply = keep.slice();
  s.draw = [];
  var r = FP.placeCard(s, s.hand[0], 'r1-1');
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.phase, 'refill');
  var r2 = FP.chooseSupply(s, s.supply[0]);
  assert.ok(r2.ok);
  s = r2.state;
  assert.strictEqual(s.supply.length, 1);
  assert.strictEqual(s.draw.length, 0);
  assert.strictEqual(s.turn, 2);
});

test('供应堆为空时跳过补牌直接进入下一回合', function () {
  var s = fresh('novice', 9);
  s.supply = [];
  s.draw = [];
  var r = FP.placeCard(s, s.hand[0], 'r1-1');
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.phase, 'place');
  assert.strictEqual(s.turn, 2);
});

/* ---------------- 8. 胜利 ---------------- */

console.log('\n[8] 胜利');

test('填满 15 位立即胜利，不再补牌', function () {
  var s = fresh('expert', 31);
  clearBoard(s);
  setGoals(s, ['blue', 'blue', 'red', 'black', 'red']);
  fillVictoryBoard(s);
  FP.slotByPos(s, 5, 1).cardId = null;
  setHand(s, ['blue-1', 'red-1', 'red-2', 'red-3']);
  s.supply = ['black-9'];
  s.draw = [];
  var supplyBefore = s.supply.slice();
  var r = FP.placeCard(s, 'blue-1', 'r5-1');
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.phase, 'won');
  assert.ok(FP.isFull(s));
  assert.deepStrictEqual(s.supply, supplyBefore);
  assert.strictEqual(s.hand.length, 3);
});

test('书中胜利牌型 15 张全部合法', function () {
  var s = fresh('expert', 32);
  clearBoard(s);
  setGoals(s, ['blue', 'blue', 'red', 'black', 'red']);
  var order = [
    [1, 1, 'blue-4'],
    [2, 1, 'blue-6'], [2, 2, 'black-7'],
    [3, 1, 'blue-5'], [3, 2, 'black-6'], [3, 3, 'black-9'],
    [4, 1, 'blue-3'], [4, 2, 'red-4'], [4, 3, 'black-5'], [4, 4, 'red-7'],
    [5, 1, 'blue-1'], [5, 2, 'blue-2'], [5, 3, 'red-5'], [5, 4, 'black-8'], [5, 5, 'red-9']
  ];
  order.forEach(function (item) {
    var slot = FP.slotByPos(s, item[0], item[1]);
    var r = FP.canPlace(s, item[2], slot.id);
    assert.ok(r.ok, 'r' + item[0] + '-' + item[1] + ' 放 ' + item[2] + ' 应合法，实际 ' + (r.code || ''));
    slot.cardId = item[2];
  });
  assert.ok(FP.isFull(s));
  var routes = FP.analyzeRoutes(s);
  assert.ok(routes.length >= 3);
  routes.forEach(function (route) {
    assert.ok(route.reachesRow5, route.color + ' 航线应到达第 5 行');
  });
});

/* ---------------- 9. 卡住 / 失败 ---------------- */

console.log('\n[9] 卡住 / 失败');

test('无可放置手牌时进入 stuck', function () {
  var s = stuckFixture();
  var r = FP.chooseSupply(s, 'blue-6');
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.phase, 'stuck');
  assert.ok(s.lossHint);
  assert.strictEqual(FP.hasAnyLegalPlacement(s), false);
});

test('宣告失败进入 lost', function () {
  var s = stuckFixture();
  s = FP.chooseSupply(s, 'blue-6').state;
  var r = FP.declareLoss(s);
  assert.ok(r.ok);
  assert.strictEqual(r.state.phase, 'lost');
  assert.strictEqual(r.state.lossReason, 'declared');
});

test('狗拉雪橇可在 stuck 中解救', function () {
  var s = stuckFixture();
  setItems(s, ['sled']);
  s = FP.chooseSupply(s, 'blue-6').state;
  assert.strictEqual(s.phase, 'stuck');
  var r = FP.useSled(s, 'red-1', 'red-7');
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.phase, 'place');
  assert.ok(s.hand.indexOf('red-7') >= 0);
  assert.strictEqual(s.items[0].used, true);
  var w = FP.placeCard(s, 'red-7', 'r5-3');
  assert.ok(w.ok);
  assert.strictEqual(w.state.phase, 'won');
});

/* ---------------- 10. 物品 ---------------- */

console.log('\n[10] 物品');

test('因纽特智慧：使用后本回合可与紧邻卡牌同数字，且只放 1 补 1', function () {
  var s = fresh('novice', 61);
  clearBoard(s);
  setItems(s, ['inuit']);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-5');
  setHand(s, ['red-5', 'black-1', 'black-2', 'black-3']);
  s.phase = 'place';
  var drawBefore = s.draw.length;

  assert.strictEqual(FP.canPlace(s, 'red-5', 'r2-2').ok, false, '未使用时不能放同数字');
  var opts = FP.inuitPlacements(s);
  assert.ok(opts.some(function (o) { return o.cardId === 'red-5' && o.slotId === 'r2-2'; }));
  assert.strictEqual(FP.canUseInuit(s), true);

  var u = FP.useInuit(s);
  assert.ok(u.ok);
  s = u.state;
  assert.strictEqual(s.wisdom, true);
  assert.strictEqual(s.items[0].used, true);
  assert.strictEqual(s.phase, 'place');
  assert.strictEqual(FP.canUseInuit(s), false, '同一回合不可重复使用');
  assert.strictEqual(FP.useInuit(s).ok, false);

  var r = FP.placeCard(s, 'red-5', 'r2-2');
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.wisdom, false, '放置后加成结束');
  assert.strictEqual(s.phase, 'refill');
  assert.strictEqual(FP.slotByPos(s, 2, 2).cardId, 'red-5');

  s = FP.chooseSupply(s, s.supply[0]).state;
  assert.strictEqual(s.phase, 'place');
  assert.strictEqual(s.hand.length, 4);
  assert.strictEqual(s.draw.length, drawBefore - 1, '整回合只从抽牌堆补 1 张');
});

test('因纽特智慧：没有紧邻同数字落点时不可使用', function () {
  var s = fresh('novice', 62);
  clearBoard(s);
  setItems(s, ['inuit']);
  put(s, 1, 1, 'blue-4');
  setHand(s, ['blue-5', 'red-6', 'black-1', 'black-2']);
  s.phase = 'place';

  assert.strictEqual(FP.inuitPlacements(s).length, 0);
  assert.strictEqual(FP.canUseInuit(s), false);
  var u = FP.useInuit(s);
  assert.strictEqual(u.ok, false);
  assert.strictEqual(u.code, 'target');
  assert.strictEqual(s.items[0].used, false, '失败不消耗物品');
  assert.strictEqual(FP.placeCard(s, 'blue-5', 'r2-1').ok, true, '普通放置不受影响');
});

test('因纽特智慧可在 stuck 中解救', function () {
  var s = fresh('novice', 68);
  clearBoard(s);
  setItems(s, ['inuit']);
  var ids = Object.keys(FP.CARDS).filter(function (id) {
    return id !== 'blue-4' && id !== 'blue-5' && id !== 'red-5';
  });
  var cursor = 0;
  s.board.slots.forEach(function (slot) {
    if (slot.id === 'r1-1') { slot.cardId = 'blue-4'; return; }
    if (slot.id === 'r2-1') { slot.cardId = 'blue-5'; return; }
    if (slot.id === 'r2-2') return;
    slot.cardId = ids[cursor++];
  });
  setHand(s, ['red-5']);
  s.phase = 'stuck';
  s.lossHint = true;

  assert.strictEqual(FP.hasAnyLegalPlacement(s), false);
  assert.strictEqual(FP.canUseInuit(s), true);
  var u = FP.useInuit(s);
  assert.ok(u.ok);
  s = u.state;
  assert.strictEqual(s.phase, 'place');
  var r = FP.placeCard(s, 'red-5', 'r2-2');
  assert.ok(r.ok);
  assert.strictEqual(FP.slotByPos(r.state, 2, 2).cardId, 'red-5');
  assert.strictEqual(r.state.phase, 'won');
});

test('狗拉雪橇：手牌回抽牌堆底部，取走供应堆并补足', function () {
  var s = fresh('novice', 63);
  clearBoard(s);
  setItems(s, ['sled']);
  var handCard = s.hand[0];
  var supplyCard = s.supply[0];
  var handBefore = s.hand.length;
  var supplyBefore = s.supply.length;
  var drawBefore = s.draw.length;
  var r = FP.useSled(s, handCard, supplyCard);
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.hand.length, handBefore);
  assert.ok(s.hand.indexOf(supplyCard) >= 0);
  assert.strictEqual(s.hand.indexOf(handCard), -1);
  assert.strictEqual(s.supply.length, supplyBefore);
  assert.strictEqual(s.draw.length, drawBefore);
  assert.strictEqual(s.draw[0], handCard, '回到底部');
  assert.strictEqual(s.items[0].used, true);
});

test('航海日志：换牌成功并校验目标卡颜色', function () {
  var s = fresh('expert', 64);
  clearBoard(s);
  setItems(s, ['log']);
  setGoals(s, ['blue', 'blue', 'red', 'black', 'red']);
  put(s, 1, 1, 'blue-4');
  put(s, 4, 1, 'blue-3');
  put(s, 5, 1, 'red-1');
  setHand(s, ['red-2', 'blue-2', 'black-1', 'black-2']);

  var bad = FP.useLog(s, 'r5-1', 'red-2');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'goal');

  var good = FP.useLog(s, 'r5-1', 'blue-2');
  assert.ok(good.ok);
  s = good.state;
  assert.strictEqual(FP.slotByPos(s, 5, 1).cardId, 'blue-2');
  assert.ok(s.hand.indexOf('red-1') >= 0);
  assert.strictEqual(s.items[0].used, true);
});

test('已用物品不可再用', function () {
  var s = fresh('novice', 65);
  clearBoard(s);
  setItems(s, ['log']);
  put(s, 1, 1, 'blue-4');
  setHand(s, ['red-7', 'red-8', 'red-9', 'black-1']);
  s = FP.useLog(s, 'r1-1', 'red-7').state;
  assert.strictEqual(FP.hasUnusedItem(s, 'log'), false);
  assert.strictEqual(FP.canUseLog(s), false);
  var again = FP.useLog(s, 'r1-1', 'red-8');
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.code, 'item');
});

test('航海日志：起点换牌必须接续上方航路颜色', function () {
  var s = fresh('novice', 66);
  clearBoard(s);
  setItems(s, ['log']);
  put(s, 1, 1, 'black-5');
  put(s, 2, 1, 'blue-1');
  put(s, 2, 2, 'black-7');
  setHand(s, ['red-1', 'red-6', 'red-9', 'black-9']);

  var redOpts = FP.logOptions(s).filter(function (o) {
    return o.slotId === 'r1-1' && FP.CARDS[o.cardId].color === 'red';
  });
  assert.strictEqual(redOpts.length, 0, '红牌不能放在只有蓝/黑接续的起点');

  var black = FP.logOptions(s).filter(function (o) {
    return o.slotId === 'r1-1' && o.cardId === 'black-9';
  });
  assert.strictEqual(black.length, 1);

  var bad = FP.useLog(s, 'r1-1', 'red-9');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'color');
  assert.deepStrictEqual(bad.upperCardIds, ['blue-1', 'black-7']);

  var good = FP.useLog(s, 'r1-1', 'black-9');
  assert.ok(good.ok);
  assert.strictEqual(FP.slotByPos(good.state, 1, 1).cardId, 'black-9');
  assert.ok(good.state.hand.indexOf('black-5') >= 0);
});

test('航海日志：起点上方还有空位时颜色义务延后', function () {
  var s = fresh('novice', 67);
  clearBoard(s);
  setItems(s, ['log']);
  put(s, 1, 1, 'black-5');
  put(s, 2, 2, 'black-7');
  setHand(s, ['red-9']);

  var opt = FP.logOptions(s).filter(function (o) {
    return o.slotId === 'r1-1' && o.cardId === 'red-9';
  })[0];
  assert.ok(opt);
  assert.ok(FP.useLog(s, 'r1-1', 'red-9').ok);
});

test('航海日志：非起点同样校验上下两侧颜色', function () {
  var s = fresh('novice', 68);
  clearBoard(s);
  setItems(s, ['log']);
  put(s, 1, 1, 'black-5');
  put(s, 2, 1, 'blue-1');
  put(s, 2, 2, 'black-7');
  put(s, 3, 1, 'red-4');
  put(s, 3, 2, 'blue-5');
  setHand(s, ['red-6', 'black-2']);

  var red = FP.logOptions(s).filter(function (o) {
    return o.slotId === 'r2-1' && o.cardId === 'red-6';
  })[0];
  assert.ok(red, '上方红 4 可接续红 6');

  var bad = FP.useLog(s, 'r2-1', 'black-2');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'color');
  assert.deepStrictEqual(bad.upperCardIds, ['red-4', 'blue-5']);
});

test('单人物品池只含三种可用物品，且允许重复类型', function () {
  var seenDuplicate = false;
  for (var seed = 1; seed <= 300; seed++) {
    var s = fresh('novice', seed);
    var types = s.items.map(function (it) { return it.type; });
    types.forEach(function (t) {
      assert.ok(['inuit', 'sled', 'log'].indexOf(t) >= 0);
    });
    if (new Set(types).size < 3) seenDuplicate = true;
  }
  assert.ok(seenDuplicate, '300 局中应出现重复物品类型');
});

/* ---------------- 11. 种子复现 ---------------- */

console.log('\n[11] 种子复现');

test('相同 seed 生成相同开局', function () {
  var a = fresh('medium', 123456);
  var b = fresh('medium', 123456);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(FP.stateHash(a), FP.stateHash(b));
});

test('相同 seed + 相同操作 → 相同 stateHash', function () {
  var a = fresh('novice', 777);
  var b = fresh('novice', 777);
  a = FP.placeCard(a, a.hand[0], 'r1-1').state;
  b = FP.placeCard(b, b.hand[0], 'r1-1').state;
  a = FP.chooseSupply(a, a.supply[0]).state;
  b = FP.chooseSupply(b, b.supply[0]).state;
  assert.strictEqual(FP.stateHash(a), FP.stateHash(b));
});

test('不同 seed 开局不同', function () {
  var a = fresh('novice', 1);
  var b = fresh('novice', 2);
  assert.notStrictEqual(FP.stateHash(a), FP.stateHash(b));
});

/* ---------------- 12. 序列化 ---------------- */

console.log('\n[12] 序列化');

test('serialize / deserialize 往返一致', function () {
  var s = fresh('expert', 88);
  var json = FP.serialize(s);
  var back = FP.deserialize(json);
  assert.ok(back);
  assert.strictEqual(FP.stateHash(back), FP.stateHash(s));
});

test('损坏存档与错误版本返回 null', function () {
  assert.strictEqual(FP.deserialize('{bad json'), null);
  assert.strictEqual(FP.deserialize({ version: 999 }), null);
});

/* ================= 联机模式 ================= */

function online(names, seed, difficulty) {
  return FP.createOnlineGame({
    seed: seed == null ? 2024 : seed,
    difficulty: difficulty || 'novice',
    names: names || ['阿冰', '小航']
  });
}

function assertSorted(hand, label) {
  for (var i = 1; i < hand.length; i++) {
    var prev = FP.CARDS[hand[i - 1]];
    var cur = FP.CARDS[hand[i]];
    assert.ok(prev.number < cur.number ||
      (prev.number === cur.number && FP.COLORS.indexOf(prev.color) < FP.COLORS.indexOf(cur.color)),
      (label || '') + ' 手牌未升序：' + hand.join(','));
  }
}

function assertMirror(s) {
  assert.deepStrictEqual(s.players[s.currentSeat].hand, s.hand, 'hand 应镜像当前玩家手牌');
  assertSorted(s.hand, '当前玩家');
}

function seatHands(s) {
  return s.players.map(function (p) { return p.hand.slice(); });
}

function cardCount(s) {
  var all = s.supply.concat(s.draw);
  s.players.forEach(function (p) { all = all.concat(p.hand); });
  return all;
}

/* 让 r2-2 成为唯一空位，且必须大于 6 才能落子（用于 stuck 场景） */
function makeStuckBoard(s) {
  s.board.slots.forEach(function (slot) { slot.cardId = null; });
  setGoals(s, ['blue', 'red', 'red', 'black', 'blue']);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-6');
  put(s, 2, 2, 'black-7');
  put(s, 3, 1, 'blue-5');
  put(s, 3, 2, 'black-6');
  put(s, 3, 3, 'black-9');
  put(s, 4, 1, 'blue-3');
  put(s, 4, 2, 'red-4');
  put(s, 4, 3, 'black-5');
  put(s, 4, 4, 'red-7');
  put(s, 5, 1, 'blue-1');
  put(s, 5, 2, 'red-5');
  put(s, 5, 3, 'black-8');
  put(s, 5, 4, 'blue-9');
  put(s, 5, 5, 'red-9');
}

/* ---------------- 13. 联机开局与发牌 ---------------- */

console.log('\n[13] 联机开局与发牌');

test('联机开局人数必须是 2~4 人', function () {
  assert.throws(function () { online(['独行者'], 1); });
  assert.throws(function () { online(['A', 'B', 'C', 'D', 'E'], 1); });
  assert.throws(function () { online([], 1); });
});

test('2/3/4 人发牌数量与 27 张拆分', function () {
  var cases = [
    { n: 2, hand: 4, draw: 16 },
    { n: 3, hand: 3, draw: 15 },
    { n: 4, hand: 3, draw: 12 }
  ];
  cases.forEach(function (c) {
    var names = [];
    for (var i = 0; i < c.n; i++) names.push('玩家' + i);
    var s = online(names, 4321);
    assert.strictEqual(s.mode, 'online');
    assert.strictEqual(s.players.length, c.n);
    s.players.forEach(function (p, i) {
      assert.strictEqual(p.seat, i);
      assert.strictEqual(p.hand.length, c.hand);
      assertSorted(p.hand, '座位 ' + i);
    });
    assert.strictEqual(s.handLimit, c.hand);
    assert.strictEqual(s.supply.length, 3);
    assert.strictEqual(s.draw.length, c.draw);
    var all = cardCount(s);
    assert.strictEqual(all.length, 27);
    assert.strictEqual(new Set(all).size, 27);
    assert.strictEqual(s.board.slots.length, 15);
    assert.strictEqual(s.board.goals.length, 5);
    assertMirror(s);
  });
});

test('先手由种子决定并可复现', function () {
  var a = online(['阿冰', '小航', '老舵'], 9876);
  var b = online(['阿冰', '小航', '老舵'], 9876);
  assert.strictEqual(a.currentSeat, b.currentSeat);
  assert.strictEqual(FP.stateHash(a), FP.stateHash(b), '同 seed + 同 names 应完全复现');
  assert.ok(a.currentSeat >= 0 && a.currentSeat < 3);
  assert.strictEqual(a.activeSeat, a.currentSeat);
  assert.strictEqual(a.rev, 0);
  assert.strictEqual(a.pending, null);
  assert.strictEqual(a.players[a.currentSeat].hand.length, 3);
  assertMirror(a);

  var start = a.log.filter(function (e) { return e.type === 'start'; });
  assert.strictEqual(start.length, 1, '开局日志记录先手');
  assert.strictEqual(start[0].seat, a.currentSeat);
  assert.strictEqual(start[0].name, a.players[a.currentSeat].name);

  var seats = {};
  for (var seed = 1; seed <= 40; seed++) seats[online(['A', 'B'], seed).currentSeat] = true;
  assert.strictEqual(Object.keys(seats).length, 2, '先手不应固定');
});

test('联机从 12 张物品池中随机抽 3 张', function () {
  var seenTypes = {};
  for (var seed = 1; seed <= 120; seed++) {
    var s = online(['A', 'B', 'C'], seed);
    assert.strictEqual(s.items.length, 3);
    assert.strictEqual(new Set(s.items.map(function (it) { return it.id; })).size, 3);
    s.items.forEach(function (it) {
      assert.ok(!it.used);
      assert.ok(['inuit', 'sled', 'log', 'radio', 'lifeboat', 'canned'].indexOf(it.type) >= 0);
      assert.ok(FP.ITEM_NAME[it.type] && FP.ITEM_DESC[it.type], it.type + ' 应有中文名与描述');
      seenTypes[it.type] = true;
    });
  }
  assert.strictEqual(Object.keys(seenTypes).length, 6, '多局之后 6 类物品都应能出现');
});

test('单人物品仍只抽 3 个且不含无线电/救生艇/罐头', function () {
  for (var seed = 1; seed <= 200; seed++) {
    var s = fresh('novice', seed);
    assert.strictEqual(s.items.length, 3);
    s.items.forEach(function (it) {
      assert.ok(['inuit', 'sled', 'log'].indexOf(it.type) >= 0, '单人池不应出现 ' + it.type);
    });
  }
});

/* ---------------- 14. 座次轮转与操作权 ---------------- */

console.log('\n[14] 座次轮转与操作权');

test('放置 → 补牌 → 下一座位；turn 只在回合完成时 +1', function () {
  var s = online(['A', 'B', 'C'], 314);
  var seat = s.currentSeat;
  var card = s.hand[0];
  var r = FP.placeCard(s, card, 'r1-1');
  assert.ok(r.ok, r.message);
  s = r.state;
  assert.strictEqual(s.phase, 'refill');
  assert.strictEqual(s.turn, 1, '放置本身不推进 turn');
  assert.strictEqual(s.currentSeat, seat, '补牌前仍是同一位玩家');
  assert.strictEqual(s.hand.length, 2);
  assertMirror(s);
  assert.strictEqual(s.players[seat].hand.indexOf(card), -1);
  assert.strictEqual(s.lastAction.seat, seat, '日志带座位');
  assert.strictEqual(s.lastAction.name, s.players[seat].name, '日志带昵称');

  var pick = s.supply[0];
  var r2 = FP.chooseSupply(s, pick);
  assert.ok(r2.ok, r2.message);
  s = r2.state;
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.currentSeat, (seat + 1) % 3);
  assert.strictEqual(s.activeSeat, s.currentSeat);
  assert.strictEqual(s.phase, 'place');
  assert.strictEqual(s.players[seat].hand.length, 3);
  assert.ok(s.players[seat].hand.indexOf(pick) >= 0);
  assertMirror(s);

  var refill = s.log.filter(function (e) { return e.type === 'refill'; })[0];
  assert.strictEqual(refill.seat, seat);
  assert.strictEqual(refill.name, s.players[seat].name);
});

test('供应堆为空时放置后直接轮到下一位', function () {
  var s = online(['A', 'B'], 315);
  s.supply = [];
  s.draw = [];
  var seat = s.currentSeat;
  var r = FP.placeCard(s, s.hand[0], 'r1-1');
  assert.ok(r.ok);
  s = r.state;
  assert.notStrictEqual(s.phase, 'refill');
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.currentSeat, (seat + 1) % 2);
  assertMirror(s);
});

test('操作权：普通阶段只有当前座位', function () {
  var s = online(['A', 'B', 'C'], 316);
  var seat = s.currentSeat;
  assert.strictEqual(FP.actorSeat(s), seat);
  assert.strictEqual(FP.canSeatAct(s, seat), true);
  assert.strictEqual(FP.canSeatAct(s, (seat + 1) % 3), false);
  assert.strictEqual(FP.canSeatAct(s, (seat + 2) % 3), false);

  // handForSeat 返回副本，不影响引擎状态
  var h = FP.handForSeat(s, (seat + 1) % 3);
  assert.strictEqual(h.length, 3);
  h.push('blue-1');
  assert.strictEqual(s.players[(seat + 1) % 3].hand.length, 3);

  // 补牌阶段仍只有当前玩家
  s = FP.placeCard(s, s.hand[0], 'r1-1').state;
  assert.strictEqual(s.phase, 'refill');
  assert.strictEqual(FP.canSeatAct(s, seat), true);
  assert.strictEqual(FP.canSeatAct(s, (seat + 1) % 3), false);

  // 终局任何人都不可以操作
  s.phase = 'lost';
  assert.strictEqual(FP.canSeatAct(s, seat), false);
  assert.strictEqual(FP.canSeatAct(s, 0), false);
});

test('非当前玩家不能放置/补牌/使用物品', function () {
  var s = online(['A', 'B'], 317);
  var seat = s.currentSeat;
  var other = 1 - seat;
  var otherHand = FP.handForSeat(s, other);

  // 引擎始终代当前玩家行动，其他端由 canSeatAct 拦截
  assert.strictEqual(FP.canSeatAct(s, other), false);
  assert.strictEqual(s.hand.indexOf(otherHand[0]) >= 0, false, '当前玩家手牌里没有对方的牌');
  var r = FP.placeCard(s, otherHand[0], 'r1-1');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'hand');

  // 补牌阶段非当前玩家不能用供应堆（操作权）
  var s2 = FP.placeCard(s, s.hand[0], 'r1-1').state;
  assert.strictEqual(s2.phase, 'refill');
  assert.strictEqual(FP.canSeatAct(s2, other), false);
});

/* ---------------- 15. 联机物品：无线电 ---------------- */

console.log('\n[15] 联机物品：无线电');

test('无线电只在补牌阶段可用，供应堆为空时不可用', function () {
  var s = online(['A', 'B'], 401);
  setItems(s, ['radio']);
  assert.strictEqual(s.phase, 'place');
  assert.strictEqual(FP.canUseRadio(s), false);
  assert.strictEqual(FP.useRadio(s, 0, 'blue-1').ok, false);

  var seat = s.currentSeat;
  s = FP.placeCard(s, s.hand[0], 'r1-1').state;
  assert.strictEqual(FP.canUseRadio(s), true);
  var to = 1 - seat;
  var target = FP.handForSeat(s, to)[0];

  var empty = Object.assign({}, s, { supply: [] });
  assert.strictEqual(FP.canUseRadio(empty), false);

  // 目标必须是有手牌的其他玩家
  assert.strictEqual(FP.useRadio(s, seat, target).ok, false, '不能选自己');
  var noHand = JSON.parse(JSON.stringify(s));
  noHand.players[to].hand = [];
  assert.strictEqual(FP.useRadio(noHand, to, target).ok, false);
  assert.strictEqual(FP.canUseRadio(noHand), false);
  assert.strictEqual(FP.useRadio(s, to, 'blue-1').ok, false, '不能拿不在目标手牌里的牌');
});

test('无线电完整流程：A 取 B 的牌 → B 从供应堆补 → 回合轮转', function () {
  var s = online(['阿冰', '小航'], 402);
  setItems(s, ['radio']);
  var seat = s.currentSeat;
  var to = 1 - seat;

  s = FP.placeCard(s, s.hand[0], 'r1-1').state;
  assert.strictEqual(s.phase, 'refill');
  var aHand = s.players[seat].hand.length;
  var bHand = s.players[to].hand.length;
  var supplyBefore = s.supply.length;
  var drawBefore = s.draw.length;
  var targetCard = s.players[to].hand[0];
  var supplyCard = s.supply[1];

  var r = FP.useRadio(s, to, targetCard);
  assert.ok(r.ok, r.message);
  s = r.state;
  assert.strictEqual(s.phase, 'radio');
  assert.strictEqual(s.currentSeat, seat, '本回合尚未结束');
  assert.strictEqual(s.turn, 1);
  assert.strictEqual(s.pending.type, 'radio');
  assert.strictEqual(s.pending.fromSeat, seat);
  assert.strictEqual(s.pending.toSeat, to);
  assert.strictEqual(s.pending.cardId, targetCard);
  assert.strictEqual(s.pending.stage, 'supply');
  assert.strictEqual(s.activeSeat, to);
  assert.strictEqual(s.players[to].hand.length, bHand - 1);
  assert.strictEqual(s.players[seat].hand.length, aHand + 1);
  assert.ok(s.players[seat].hand.indexOf(targetCard) >= 0);
  assert.strictEqual(s.supply.length, supplyBefore, '取得阶段不动供应堆');
  assertMirror(s);
  assertSorted(s.players[seat].hand, 'A');

  // 无线电补牌阶段：只有目标玩家可操作
  assert.strictEqual(FP.canSeatAct(s, to), true);
  assert.strictEqual(FP.canSeatAct(s, seat), false);
  assert.strictEqual(FP.actorSeat(s), to);
  assert.strictEqual(FP.chooseRadioSupply(s, seat, supplyCard).ok, false);
  assert.strictEqual(FP.placeCard(s, s.hand[0], 'r2-1').ok, false, '无线电阶段不能放置');
  assert.strictEqual(FP.useCanned(s).ok, false, '无线电阶段不能跳回合');
  assert.strictEqual(FP.useInuit(s).ok, false);
  assert.strictEqual(FP.useLifeboat(s).ok, false);

  var r2 = FP.chooseRadioSupply(s, to, supplyCard);
  assert.ok(r2.ok, r2.message);
  s = r2.state;
  assert.strictEqual(s.pending, null);
  assert.ok(s.phase === 'place' || s.phase === 'stuck');
  assert.strictEqual(s.currentSeat, (seat + 1) % 2, 'A 的回合结束并轮转');
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.activeSeat, s.currentSeat);
  assert.strictEqual(s.players[to].hand.length, bHand);
  assert.ok(s.players[to].hand.indexOf(supplyCard) >= 0);
  assert.strictEqual(s.supply.length, supplyBefore);
  assert.strictEqual(s.draw.length, drawBefore - 1, '供应堆从抽牌堆补足');
  assertMirror(s);
  assert.strictEqual(FP.isOnline(s), true);
});

/* ---------------- 16. 联机物品：救生艇 ---------------- */

console.log('\n[16] 联机物品：救生艇');

test('救生艇要求所有玩家手牌非空', function () {
  var s = online(['A', 'B', 'C'], 501);
  setItems(s, ['lifeboat']);
  assert.strictEqual(FP.canUseLifeboat(s), true);
  var victim = JSON.parse(JSON.stringify(s));
  victim.players[(s.currentSeat + 1) % 3].hand = [];
  assert.strictEqual(FP.canUseLifeboat(victim), false);
  assert.strictEqual(FP.useLifeboat(victim).ok, false);
  assert.strictEqual(FP.useLifeboat(victim).code, 'hand');
});

test('救生艇完整流程：全员选牌 → 当前玩家结算 → 左手边收到牌', function () {
  var s = online(['A', 'B', 'C'], 502);
  setItems(s, ['lifeboat']);
  var cur = s.currentSeat;
  var n = 3;
  var r = FP.useLifeboat(s);
  assert.ok(r.ok, r.message);
  s = r.state;
  assert.strictEqual(s.phase, 'lifeboat');
  assert.strictEqual(s.activeSeat, -1);
  assert.strictEqual(FP.actorSeat(s), -1);
  assert.strictEqual(s.pending.type, 'lifeboat');
  [0, 1, 2].forEach(function (seat) {
    assert.strictEqual(s.pending.picks[seat], null);
    assert.strictEqual(FP.canSeatAct(s, seat), true, '救生艇阶段全员可操作');
  });
  assert.strictEqual(FP.canSeatAct(s, 3), false);

  var picks = {};
  s.players.forEach(function (p, i) { picks[p.seat] = p.hand[i % p.hand.length]; });
  var before = seatHands(s);

  // 当前玩家先选，再由其他人选满（避免自动结算，走手动结算路径）
  s = FP.lifeboatPick(s, cur, picks[cur]).state;
  assert.strictEqual(s.phase, 'lifeboat');
  assert.strictEqual(s.pending.picks[cur], picks[cur]);
  assert.strictEqual(s.pending.picks[(cur + 1) % n], null, '不会替别人选');

  // 只能选自己手牌中的牌
  var foreign = (function () {
    for (var i = 0; i < n; i++) {
      if (i !== (cur + 1) % n) return picks[i];
    }
    return null;
  })();
  var bad = FP.lifeboatPick(s, (cur + 1) % n, foreign);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'hand');

  for (var i = 1; i < n; i++) {
    var seat = (cur + i) % n;
    var rr = FP.lifeboatPick(s, seat, picks[seat]);
    assert.ok(rr.ok, rr.message);
    s = rr.state;
  }
  assert.strictEqual(s.phase, 'lifeboat', '非当前玩家选完不会自动结算');

  // 非当前玩家不能结算
  var deny = FP.completeLifeboat(s, (cur + 1) % n);
  assert.strictEqual(deny.ok, false);
  assert.strictEqual(deny.code, 'seat');

  var done = FP.completeLifeboat(s);
  assert.ok(done.ok, done.message);
  s = done.state;
  assert.strictEqual(s.pending, null);
  assert.strictEqual(s.activeSeat, s.currentSeat);
  assert.strictEqual(s.currentSeat, cur, '救生艇后仍由当前玩家继续本回合');
  assert.strictEqual(s.phase === 'place' || s.phase === 'stuck', true);

  s.players.forEach(function (p, i) {
    var expectIn = picks[(p.seat - 1 + n) % n];
    assert.ok(p.hand.indexOf(expectIn) >= 0, '座位 ' + p.seat + ' 应收到左手边的牌 ' + expectIn);
    assert.strictEqual(p.hand.indexOf(picks[p.seat]), -1, '自己选的牌已传出');
    assert.strictEqual(p.hand.length, before[i].length);
    assertSorted(p.hand, '座位 ' + p.seat);
  });
  assertMirror(s);

  var twice = FP.completeLifeboat(s);
  assert.strictEqual(twice.ok, false, '不能重复传牌');
});

test('救生艇：当前玩家最后选牌时自动结算', function () {
  var s = online(['A', 'B'], 503);
  setItems(s, ['lifeboat']);
  var cur = s.currentSeat;
  var other = 1 - cur;
  s = FP.useLifeboat(s).state;
  var a = s.players[cur].hand[0];
  var b = s.players[other].hand[1];
  s = FP.lifeboatPick(s, other, b).state;
  var r = FP.lifeboatPick(s, cur, a);
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.pending, null, '自动完成');
  assert.ok(s.players[cur].hand.indexOf(b) >= 0, '2 人局等价互换');
  assert.ok(s.players[other].hand.indexOf(a) >= 0);
});

/* ---------------- 17. 罐头 / 卡住 / 判负 ---------------- */

console.log('\n[17] 联机罐头与判负');

test('罐头在放置阶段跳过回合（不放置不补牌）', function () {
  var s = online(['A', 'B', 'C'], 601);
  setItems(s, ['canned']);
  var cur = s.currentSeat;
  var before = seatHands(s);
  var boardBefore = s.board.slots.map(function (x) { return x.cardId; });
  var supplyBefore = s.supply.length;
  var drawBefore = s.draw.length;

  assert.strictEqual(FP.canUseCanned(s), true);
  var r = FP.useCanned(s);
  assert.ok(r.ok, r.message);
  s = r.state;
  assert.strictEqual(FP.hasUnusedItem(s, 'canned'), false);
  assert.strictEqual(s.items.filter(function (it) {
    return it.type === 'canned' && it.used;
  }).length, 1);
  assert.strictEqual(s.currentSeat, (cur + 1) % 3);
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.supply.length, supplyBefore);
  assert.strictEqual(s.draw.length, drawBefore);
  assert.deepStrictEqual(s.board.slots.map(function (x) { return x.cardId; }), boardBefore);
  assert.deepStrictEqual(s.players[cur].hand, before[cur], '不放置也不补牌');
  assertMirror(s);
});

test('罐头在卡住时可用并跳回合', function () {
  var s = online(['A', 'B'], 602);
  setItems(s, ['canned']);
  var cur = s.currentSeat;
  s.phase = 'stuck';
  s.lossHint = true;
  assert.strictEqual(FP.canUseCanned(s), true);
  var r = FP.useCanned(s);
  assert.ok(r.ok, r.message);
  s = r.state;
  assert.notStrictEqual(s.phase, 'stuck');
  assert.strictEqual(s.currentSeat, (cur + 1) % 2);
  assert.strictEqual(s.turn, 2);
  assertMirror(s);
});

test('无合法落点时轮到该玩家进入 stuck', function () {
  var s = online(['A', 'B'], 603);
  setItems(s, ['canned']);
  var cur = s.currentSeat;
  var next = 1 - cur;
  makeStuckBoard(s);
  s.players[next].hand = ['red-1', 'red-2', 'red-3', 'red-6'];
  s.hand = s.players[cur].hand.slice();
  s.phase = 'place';
  s.supply = [];
  s.draw = [];

  var r = FP.useCanned(s);
  assert.ok(r.ok, r.message);
  s = r.state;
  assert.strictEqual(s.currentSeat, next);
  assert.strictEqual(s.phase, 'stuck');
  assert.strictEqual(s.lossHint, true);
  assert.strictEqual(FP.hasAnyLegalPlacement(s), false);
  // 救生艇仍需全员有手牌，但当前玩家已卡住：可以宣告失败
  assert.strictEqual(FP.declareLoss(s, cur).ok, false, '非当前玩家不能宣告失败');
  assert.ok(FP.declareLoss(s).ok);
});

test('手牌为空轮到该玩家时判负 no-hand', function () {
  var s = online(['A', 'B'], 604);
  var cur = s.currentSeat;
  var next = 1 - cur;
  s.players[next].hand = [];
  s.hand = s.players[cur].hand.slice();
  s.phase = 'refill';
  var r = FP.chooseSupply(s, s.supply[0]);
  assert.ok(r.ok, r.message);
  s = r.state;
  assert.strictEqual(s.currentSeat, next);
  assert.strictEqual(s.phase, 'lost');
  assert.strictEqual(s.lossReason, 'no-hand');
});

test('联机因纽特/雪橇/航海日志只作用于当前玩家', function () {
  var s = online(['A', 'B'], 605);
  setItems(s, ['inuit']);
  var cur = s.currentSeat;
  var other = 1 - cur;
  var otherBefore = FP.handForSeat(s, other);

  // 因纽特智慧：用手牌摆出“紧邻同数字”的落点
  s.board.slots.forEach(function (slot) { slot.cardId = null; });
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-5');
  s.players[cur].hand = ['red-5', 'black-1', 'black-2', 'black-3'];
  s.hand = s.players[cur].hand.slice();
  s.phase = 'place';

  assert.ok(FP.inuitPlacements(s).some(function (o) { return o.cardId === 'red-5'; }));
  var u = FP.useInuit(s);
  assert.ok(u.ok, u.message);
  s = u.state;
  assert.strictEqual(s.wisdom, true);
  assert.deepStrictEqual(FP.handForSeat(s, other), otherBefore, '队友手牌不受影响');
  assert.strictEqual(s.players[cur].hand.indexOf('red-5') >= 0, true);

  s = FP.placeCard(s, 'red-5', 'r2-2').state;
  assert.strictEqual(FP.slotByPos(s, 2, 2).cardId, 'red-5');
  assert.deepStrictEqual(FP.handForSeat(s, other), otherBefore);

  // 狗拉雪橇：作用于当前玩家手牌
  var s2 = online(['A', 'B'], 606);
  setItems(s2, ['sled']);
  var c2 = s2.currentSeat;
  var o2 = 1 - c2;
  var o2Before = FP.handForSeat(s2, o2);
  var handCard = s2.hand[0];
  var supplyCard = s2.supply[0];
  var sled = FP.useSled(s2, handCard, supplyCard);
  assert.ok(sled.ok, sled.message);
  s2 = sled.state;
  assert.ok(s2.hand.indexOf(supplyCard) >= 0);
  assert.strictEqual(s2.hand.indexOf(handCard), -1);
  assert.deepStrictEqual(FP.handForSeat(s2, o2), o2Before);
  assertMirror(s2);

  // 航海日志：作用于共享棋盘
  var s3 = online(['A', 'B'], 607);
  setItems(s3, ['log']);
  var c3 = s3.currentSeat;
  s3.board.slots.forEach(function (slot) { slot.cardId = null; });
  put(s3, 1, 1, 'blue-4');
  var swapIn = null;
  var swapOut = 'blue-4';
  for (var i = 0; i < s3.players[c3].hand.length; i++) {
    var id = s3.players[c3].hand[i];
    if (FP.canPlace(s3, id, 'r1-1', { ignoreOccupied: true, requireUpperColor: true, wisdom: false }).ok) {
      swapIn = id;
      break;
    }
  }
  assert.ok(swapIn, '应存在可换入的牌');
  var lg = FP.useLog(s3, 'r1-1', swapIn);
  assert.ok(lg.ok, lg.message);
  s3 = lg.state;
  assert.strictEqual(FP.slotByPos(s3, 1, 1).cardId, swapIn);
  assert.ok(s3.players[c3].hand.indexOf(swapOut) >= 0);
  assertMirror(s3);
});

/* ---------------- 18. 联机新鲜度与序列化 ---------------- */

console.log('\n[18] 联机新鲜度与序列化');

test('rev 随每次成功操作单调递增（含 lifeboatPick）', function () {
  var s = online(['A', 'B', 'C'], 701);
  setItems(s, ['radio', 'lifeboat']);
  var revs = [s.rev];
  var push = function (st) {
    assert.ok(st.rev > revs[revs.length - 1], 'rev 应递增：' + revs[revs.length - 1] + ' → ' + st.rev);
    revs.push(st.rev);
    return st;
  };

  s = push(FP.placeCard(s, s.hand[0], 'r1-1').state);
  s = push(FP.chooseSupply(s, s.supply[0]).state);
  // 无线电（补牌 → 目标补 supply）
  s = FP.placeCard(s, s.hand[0], 'r2-1').state;
  var revBeforeRadio = s.rev;
  var to = (s.currentSeat + 1) % 3;
  s = push(FP.useRadio(s, to, s.players[to].hand[0]).state);
  s = push(FP.chooseRadioSupply(s, to, s.supply[0]).state);
  assert.ok(s.rev > revBeforeRadio);

  // 救生艇：每个 pick 都递增
  s = FP.useLifeboat(s).state;
  var revBeforePicks = s.rev;
  s.players.forEach(function (p) { s = push(FP.lifeboatPick(s, p.seat, p.hand[0]).state); });
  assert.ok(s.rev >= revBeforePicks + 3);
  for (var i = 1; i < revs.length; i++) assert.ok(revs[i] > revs[i - 1]);
});

test('联机状态 serialize / deserialize 往返，hand 镜像可重建', function () {
  var s = online(['A', 'B', 'C'], 702, 'medium');
  setItems(s, ['lifeboat']);
  s = FP.placeCard(s, s.hand[0], 'r1-1').state;
  s = FP.chooseSupply(s, s.supply[0]).state;
  s = FP.useLifeboat(s).state;

  var back = FP.deserialize(FP.serialize(s));
  assert.ok(back);
  assert.strictEqual(back.mode, 'online');
  assert.strictEqual(back.players.length, 3);
  assert.strictEqual(FP.stateHash(back), FP.stateHash(s));

  // hand 镜像缺失时从 players 重建
  var broken = JSON.parse(FP.serialize(s));
  delete broken.hand;
  var fixed = FP.deserialize(broken);
  assert.ok(fixed);
  assert.deepStrictEqual(fixed.hand, fixed.players[fixed.currentSeat].hand);
});

test('损坏的联机快照返回 null', function () {
  var s = online(['A', 'B'], 703);
  assert.strictEqual(FP.deserialize(Object.assign({}, s, { players: [] })), null);
  assert.strictEqual(FP.deserialize(Object.assign({}, s, {
    players: [{ seat: 0, name: 'A' }, { seat: 1, name: 'B', hand: [] }]
  })), null);
  assert.strictEqual(FP.deserialize(Object.assign({}, s, { currentSeat: 5 })), null);
  assert.strictEqual(FP.deserialize(Object.assign({}, s, { rev: 'x' })), null);
  var badCard = JSON.parse(JSON.stringify(s));
  badCard.players[0].hand.push('purple-1');
  assert.strictEqual(FP.deserialize(badCard), null);
});

/* ---------------- 汇总 ---------------- */

console.log('\n————————————————');
console.log('通过 ' + passed + '，失败 ' + failed);
if (failed) {
  failures.forEach(function (f) {
    console.log('\n失败：' + f.name);
    console.log(f.error.stack);
  });
  process.exitCode = 1;
}
