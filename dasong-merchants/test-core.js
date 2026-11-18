/* 大宋百商图 · 核心规则自测（node test-core.js） */
'use strict';

const assert = require('assert');
const DSM = require('./game.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (error) {
    console.error('  ✗ ' + name);
    throw error;
  }
}

function fresh(options) {
  DSM.rng = Math.random;
  return DSM.startGame(Object.assign({ playerCount: 1, startingCash: 30, victoryCash: 999, victoryShops: 8, events: false }, options || {}));
}

function state() {
  return DSM.getState();
}

function player(i) {
  return state().players[i || 0];
}

function clearMarketOfEvents() {
  const game = state();
  game.customerDeck = game.customerDeck.filter((card) => card.kind !== 'event');
  game.customerMarket = game.customerMarket.filter((card) => card.kind !== 'event');
}

function injectShop(shopId) {
  const game = state();
  game.shopMarket.push({ uid: 'shop_manual_' + shopId, kind: 'shop', id: shopId });
  return game.shopMarket[game.shopMarket.length - 1].uid;
}

function buildOn(game, landIndex, shopId) {
  const p = game.players[0];
  const land = p.lands[landIndex];
  land.cleared = true;
  land.reservedShopId = shopId;
  land.shopId = shopId;
}

console.log('大宋百商图 · 核心测试');

test('开局：人数、起始菜、候客区、展示区', () => {
  const game = fresh({ playerCount: 2 });
  assert.strictEqual(game.players.length, 2);
  assert.strictEqual(game.players[0].cash, 30);
  assert.strictEqual(game.players[1].cash, 31);
  assert.strictEqual(game.players[0].prep.length, 8);
  assert.strictEqual(DSM.composition(game.players[0].prep).byRank[4], 6);
  assert.strictEqual(DSM.composition(game.players[0].prep).byRank[3], 2);
  assert.strictEqual(game.customerMarket.length, 4);
  assert.strictEqual(game.shopMarket.length, 4);
  assert.strictEqual(game.phase, 'phase1');
});

test('起始菜品数量受库存限制', () => {
  const game = fresh({ playerCount: 4, startingLowMenus: 8, startingMidMenus: 8 });
  assert.strictEqual(game.starter.dish_rank_4, 8);
  assert.strictEqual(game.starter.dish_rank_3, 6);
  assert.strictEqual(game.players[0].prep.length, 14);
});

test('土地必须按顺序清理，清地后认购店铺', () => {
  const game = fresh();
  let result = DSM.clearAndReserve('land_2', null);
  assert.strictEqual(result.ok, false);
  const uid = injectShop('porcelain_shop');
  result = DSM.clearAndReserve('land_1', uid);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(player().lands[0].cleared, true);
  assert.strictEqual(player().lands[0].reservedShopId, 'porcelain_shop');
  assert.strictEqual(game.phase1ActionDone, true);
  assert.strictEqual(game.shopMarket.some((card) => card.uid === uid), false);
  assert.strictEqual(DSM.clearAndReserve('land_2', null).ok, false);
});

test('展示区有牌时清地必须认购，空展示区才可只清地', () => {
  const game = fresh();
  assert.strictEqual(DSM.clearAndReserve('land_1', null).ok, false);
  assert.strictEqual(player().lands[0].cleared, false);
  game.shopMarket = [];
  assert.strictEqual(DSM.clearAndReserve('land_1', null).ok, true);
  assert.strictEqual(player().lands[0].cleared, true);
  assert.strictEqual(player().lands[0].reservedShopId, null);
});

test('清地费与建造费扣除', () => {
  const game = fresh({ startingCash: 20 });
  const uid = injectShop('porcelain_shop');
  assert.strictEqual(DSM.clearAndReserve('land_1', uid).ok, true);
  const before = player().cash;
  assert.strictEqual(DSM.buildShop('land_1').ok, true);
  assert.strictEqual(player().cash, before - 9);
  assert.strictEqual(player().lands[0].shopId, 'porcelain_shop');
  assert.strictEqual(DSM.countBuiltShops(player()), 1);
});

test('购买菜单：每回合一张，四品不可购买', () => {
  const game = fresh({ startingCash: 20 });
  const before = game.menuSupply.dish_rank_3;
  assert.strictEqual(DSM.buyMenu('dish_rank_4').ok, false);
  assert.strictEqual(DSM.buyMenu('dish_rank_3').ok, true);
  assert.strictEqual(player().cash, 17);
  assert.strictEqual(player().kitchen.length, 1);
  assert.strictEqual(game.menuSupply.dish_rank_3, before - 1);
  assert.strictEqual(DSM.buyMenu('dish_rank_2').ok, false);
});

test('备菜：花 3 铜钱从后厨弃一张，随后进入招待', () => {
  const game = fresh({ startingCash: 10 });
  player().kitchen.push('dish_rank_1');
  DSM.advanceToPhase2();
  assert.strictEqual(DSM.discardMenu(0).ok, true);
  assert.strictEqual(player().cash, 7);
  assert.strictEqual(player().kitchen.length, 0);
  assert.strictEqual(player().abandoned[0], 'dish_rank_1');
  assert.strictEqual(game.phase, 'phase3');
});

test('跳过客人：付 1 铜钱，钱留在客人身上，最后一位不能跳', () => {
  const game = fresh({ startingCash: 10 });
  clearMarketOfEvents();
  while (game.customerMarket.length < 4) {
    game.customerMarket.push({ uid: 'c' + game.customerMarket.length, kind: 'customer', id: 'zhifu', tip: 0 });
  }
  game.phase = 'phase3';
  assert.strictEqual(DSM.skipCustomer().ok, true);
  assert.strictEqual(player().cash, 9);
  assert.strictEqual(game.focusIndex, 1);
  assert.strictEqual(game.customerMarket[0].tip, 1);
  game.focusIndex = 3;
  assert.strictEqual(DSM.skipCustomer().ok, false);
});

test('招待结算：菜品收益 + 店铺收益 + 客人小费', () => {
  const game = fresh({ startingCash: 100 });
  clearMarketOfEvents();
  buildOn(game, 0, 'porcelain_shop');
  game.customerMarket = [{ uid: 'cust_test', kind: 'customer', id: 'zhifu', tip: 2 }];
  game.focusIndex = 0;
  game.phase = 'phase3';
  player().prep = ['dish_rank_2', 'dish_rank_2', 'dish_rank_2', 'dish_rank_2', 'dish_rank_2'];
  player().kitchen = [];
  const before = player().cash;
  const result = DSM.serveCustomer();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.summary.menuIncome, 6);
  assert.strictEqual(result.summary.shopIncome, 6);
  assert.strictEqual(result.summary.tip, 2);
  assert.strictEqual(result.summary.total, 14);
  assert.strictEqual(player().cash, before + 14);
  assert.strictEqual(game.phase, 'turnDone');
});

test('店铺联动：饮子铺让关扑铺 +2', () => {
  const game = fresh({ startingCash: 100 });
  clearMarketOfEvents();
  buildOn(game, 0, 'yinzi_shop');
  buildOn(game, 1, 'guanpu_shop');
  game.customerMarket = [{ uid: 'cust_test', kind: 'customer', id: 'wenpo', tip: 0 }];
  game.focusIndex = 0;
  game.phase = 'phase3';
  player().prep = ['dish_rank_4', 'dish_rank_4', 'dish_rank_4', 'dish_rank_4', 'dish_rank_4'];
  player().kitchen = [];
  const result = DSM.serveCustomer();
  assert.strictEqual(result.ok, true);
  // 稳婆：绸缎庄、关扑铺、说书场、饮子铺；已建饮子铺 + 关扑铺
  // 饮子铺 2，关扑铺 2+2 联动 = 4 → 店铺合计 6
  assert.strictEqual(result.summary.shopIncome, 6);
  assert.strictEqual(result.summary.menuIncome, 3);
  assert.strictEqual(result.summary.total, 9);
});

test('骰子收益：一品菜与卦肆', () => {
  const game = fresh({ startingCash: 100 });
  clearMarketOfEvents();
  buildOn(game, 0, 'guasi_shop');
  game.customerMarket = [{ uid: 'cust_test', kind: 'customer', id: 'qiaofu', tip: 0 }];
  game.focusIndex = 0;
  game.phase = 'phase3';
  player().prep = ['dish_rank_1', 'dish_rank_1', 'dish_rank_1', 'dish_rank_1'];
  player().kitchen = [];
  DSM.rng = () => 0.5; // d6 = 4
  const result = DSM.serveCustomer();
  // 樵夫吃 4 道：1 品菜 4×(4+2)=24；卦肆 4
  assert.strictEqual(result.summary.menuIncome, 24);
  assert.strictEqual(result.summary.shopIncome, 4);
  assert.strictEqual(result.summary.total, 28);
});

test('蹴鞠场让客人多吃 2 道菜', () => {
  const game = fresh({ startingCash: 100 });
  clearMarketOfEvents();
  buildOn(game, 0, 'cuju_field');
  game.customerMarket = [{ uid: 'cust_test', kind: 'customer', id: 'huashi', tip: 0 }];
  game.focusIndex = 0;
  game.phase = 'phase3';
  player().prep = ['dish_rank_4', 'dish_rank_4', 'dish_rank_4', 'dish_rank_4', 'dish_rank_4', 'dish_rank_4'];
  player().kitchen = [];
  const result = DSM.serveCustomer();
  // 画师基础 3 + 蹴鞠场 2 = 5 道，四品菜每道 1
  assert.strictEqual(result.summary.cost.total, 5);
  assert.strictEqual(result.summary.menuIncome, 5);
});

test('雅阁不足时后厨洗回雅阁继续吃', () => {
  const game = fresh({ startingCash: 100 });
  clearMarketOfEvents();
  game.customerMarket = [{ uid: 'cust_test', kind: 'customer', id: 'qiaofu', tip: 0 }];
  game.focusIndex = 0;
  game.phase = 'phase3';
  player().prep = ['dish_rank_3', 'dish_rank_3'];
  player().kitchen = ['dish_rank_3', 'dish_rank_3'];
  const result = DSM.serveCustomer();
  assert.strictEqual(result.summary.spentCount, 4);
  assert.strictEqual(result.summary.missed, 0);
  assert.strictEqual(player().prep.length, 0);
});

test('事件：苛捐杂税按店铺收 2 铜钱', () => {
  const game = fresh({ startingCash: 10 });
  buildOn(game, 0, 'tea_house');
  buildOn(game, 1, 'bookshop');
  DSM._triggerEvent('taxes');
  assert.strictEqual(player().cash, 6);
  assert.strictEqual(game.eventQueue.length, 1);
  assert.strictEqual(game.eventHistory.length, 1);
  assert.strictEqual(game.eventHistory[0].name, '苛捐杂税');
  assert.strictEqual(game.eventHistory[0].round, 1);
});

test('事件：硕果累累从库存发四品菜到后厨', () => {
  const game = fresh();
  const before = game.menuSupply.dish_rank_4;
  player().kitchen = [];
  DSM._triggerEvent('bumper_harvest');
  assert.strictEqual(player().kitchen.length, 2);
  assert.strictEqual(game.menuSupply.dish_rank_4, before - 2);
});

test('事件：候客区数量变化与替换', () => {
  const game = fresh();
  clearMarketOfEvents();
  DSM._triggerEvent('snow_cover');
  assert.strictEqual(DSM.marketSize(), 2);
  assert.strictEqual(game.customerMarket.length, 2);
  assert.strictEqual(game.activeEvent.id, 'snow_cover');
  DSM._triggerEvent('lantern_festival');
  assert.strictEqual(DSM.marketSize(), 6);
  assert.strictEqual(game.customerMarket.length, 6);
  assert.strictEqual(game.activeEvent.id, 'lantern_festival');
});

test('事件：即时事件会取消长期公告', () => {
  const game = fresh({ startingCash: 10 });
  clearMarketOfEvents();
  buildOn(game, 0, 'tea_house');
  DSM._triggerEvent('lantern_festival');
  assert.strictEqual(game.activeEvent.id, 'lantern_festival');
  assert.strictEqual(DSM.marketSize(), 6);
  DSM._triggerEvent('taxes');
  assert.strictEqual(game.activeEvent, null);
  assert.strictEqual(DSM.marketSize(), 4);
  assert.strictEqual(game.customerMarket.length, 4);
  assert.strictEqual(player().cash, 8);
  assert.ok(game.log.some((line) => line.indexOf('长期公告【张灯结彩】因【苛捐杂税】失效') >= 0));
});

test('事件：门可罗雀需要选择一家店铺生效', () => {
  const game = fresh({ startingCash: 100 });
  clearMarketOfEvents();
  buildOn(game, 0, 'yinzi_shop');
  buildOn(game, 1, 'guanpu_shop');
  game.customerMarket = [{ uid: 'cust_test', kind: 'customer', id: 'wenpo', tip: 0 }];
  game.focusIndex = 0;
  game.phase = 'phase3';
  DSM._triggerEvent('sparse_visitors');
  const preview = DSM.previewServe();
  assert.strictEqual(preview.needChoice, true);
  const result = DSM.serveCustomer();
  assert.strictEqual(result.needChoice, true);
  assert.strictEqual(result.options.length, 2);
  const chosen = DSM.serveCustomer('guanpu_shop');
  assert.strictEqual(chosen.ok, true);
  // 关扑铺 2 + 饮子铺联动 2 = 4
  assert.strictEqual(chosen.summary.shopIncome, 4);
});

test('胜利判定：铜钱与店铺同时达标', () => {
  const game = fresh({ startingCash: 200, victoryCash: 100, victoryShops: 8 });
  for (let i = 0; i < 7; i += 1) buildOn(game, i, 'tea_house');
  player().lands[7].cleared = true;
  player().lands[7].reservedShopId = 'tea_house';
  assert.strictEqual(DSM.buildShop('land_8').ok, true);
  assert.strictEqual(game.winnerId, player().id);
  assert.strictEqual(game.phase, 'over');
  const ranked = DSM.ranking();
  assert.strictEqual(ranked[0].id, player().id);
  assert.strictEqual(ranked[0].shops, 8);
});

test('回合推进：轮转、回合数、后厨回收', () => {
  const game = fresh({ playerCount: 2 });
  game.players[1].prep = [];
  game.players[1].kitchen = ['dish_rank_4'];
  const result = DSM.nextTurn();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(game.currentPlayerIndex, 1);
  assert.strictEqual(game.round, 1);
  assert.strictEqual(game.players[1].prep.length, 1);
  assert.strictEqual(game.players[1].kitchen.length, 0);
  DSM.nextTurn();
  assert.strictEqual(game.currentPlayerIndex, 0);
  assert.strictEqual(game.round, 2);
});

test('牌堆耗尽后弃牌堆洗回，候客区始终补满', () => {
  const game = fresh();
  clearMarketOfEvents();
  const keep = game.customerMarket.slice();
  game.customerDiscard = game.customerDiscard.concat(game.customerDeck);
  game.customerDeck = [];
  game.customerMarket = [];
  game.focusIndex = 0;
  game.customerDiscard = game.customerDiscard.concat(keep);
  // 通过跳过客人无法补牌，直接触发一次事件洗牌
  DSM._triggerEvent('renewal');
  assert.strictEqual(game.customerMarket.length, 4);
  assert.ok(game.customerDeck.length > 0);
});

console.log('\n通过 ' + passed + ' 项测试');
