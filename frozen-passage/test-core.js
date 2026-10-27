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
  s.pendingInuit = null;
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

test('因纽特智慧允许配对同数字，其他邻接仍需递增', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'blue-4');
  put(s, 2, 1, 'blue-5');
  assert.strictEqual(FP.canPlace(s, 'red-5', 'r2-2').ok, false);
  assert.ok(FP.canPlace(s, 'red-5', 'r2-2', { inuitPairWith: 'r2-1' }).ok);
});

test('因纽特配对另一侧仍须严格递增', function () {
  var s = fresh('novice', 1);
  clearBoard(s);
  put(s, 1, 1, 'red-4');
  put(s, 2, 1, 'red-2');
  put(s, 2, 2, 'red-8');
  put(s, 3, 1, 'red-5');
  put(s, 3, 3, 'red-4');
  assert.strictEqual(
    FP.canPlace(s, 'red-5', 'r3-2', { inuitPairWith: 'r3-1' }).ok,
    false,
    '右侧最近卡必须大于 5，配对的等值豁免不能扩散'
  );
  put(s, 3, 3, 'red-7');
  assert.ok(FP.canPlace(s, 'red-5', 'r3-2', { inuitPairWith: 'r3-1' }).ok);
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

test('因纽特智慧：追加同数字牌，只补 1 张', function () {
  var s = fresh('novice', 61);
  clearBoard(s);
  setItems(s, ['inuit']);
  put(s, 1, 1, 'blue-4');
  setHand(s, ['blue-5', 'red-5', 'black-1', 'black-2']);
  s.phase = 'place';
  var drawBefore = s.draw.length;

  var r = FP.placeCard(s, 'blue-5', 'r2-1');
  assert.ok(r.ok);
  s = r.state;
  assert.strictEqual(s.phase, 'afterPlace');
  var opts = FP.inuitOptions(s);
  assert.ok(opts.some(function (o) { return o.cardId === 'red-5' && o.slotId === 'r2-2'; }));

  var u = FP.useInuit(s, 'red-5', 'r2-2');
  assert.ok(u.ok);
  s = u.state;
  assert.strictEqual(s.phase, 'refill');
  assert.strictEqual(s.hand.length, 2);
  assert.strictEqual(s.items[0].used, true);
  assert.strictEqual(FP.slotByPos(s, 2, 2).cardId, 'red-5');

  s = FP.chooseSupply(s, s.supply[0]).state;
  assert.strictEqual(s.hand.length, 3);
  assert.strictEqual(s.draw.length, drawBefore - 1, '整回合只从抽牌堆补 1 张');
});

test('因纽特智慧不可用于不同数字/不相邻位置', function () {
  var s = fresh('novice', 62);
  clearBoard(s);
  setItems(s, ['inuit']);
  put(s, 1, 1, 'blue-4');
  setHand(s, ['blue-5', 'red-6', 'black-1', 'black-2']);
  s.phase = 'place';
  s = FP.placeCard(s, 'blue-5', 'r2-1').state;
  assert.strictEqual(s.phase, 'refill', '没有同数字可选时不进入 afterPlace');
  assert.strictEqual(FP.useInuit(s, 'red-6', 'r2-2').ok, false);
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
