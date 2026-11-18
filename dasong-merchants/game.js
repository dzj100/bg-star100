/*
 * 大宋百商图 · 核心规则
 * 纯数据 + 状态机，无 DOM 依赖，可在 Node 中直接跑测试。
 */
(function (root) {
  'use strict';

  var LANDS = [
    { id: 'land_1', index: 1, clearCost: 0 },
    { id: 'land_2', index: 2, clearCost: 2 },
    { id: 'land_3', index: 3, clearCost: 3 },
    { id: 'land_4', index: 4, clearCost: 4 },
    { id: 'land_5', index: 5, clearCost: 7 },
    { id: 'land_6', index: 6, clearCost: 8 },
    { id: 'land_7', index: 7, clearCost: 9 },
    { id: 'land_8', index: 8, clearCost: 10 }
  ];

  var SHOPS = [
    { id: 'yinzi_shop', name: '饮子铺', buildCost: 5, baseIncome: { type: 'fixed', value: 2 }, builtShopBonuses: [{ targetShopId: 'guanpu_shop', incomeBonus: 2 }], visitEffects: [] },
    { id: 'guasi_shop', name: '卦肆', buildCost: 6, baseIncome: { type: 'dice', value: 0 }, builtShopBonuses: [], visitEffects: [] },
    { id: 'guanpu_shop', name: '关扑铺', buildCost: 5, baseIncome: { type: 'fixed', value: 2 }, builtShopBonuses: [{ targetShopId: 'guasi_shop', incomeBonus: 2 }], visitEffects: [] },
    { id: 'cuju_field', name: '蹴鞠场', buildCost: 6, baseIncome: { type: 'fixed', value: 0 }, builtShopBonuses: [], visitEffects: [{ type: 'extra_menu_cost', value: 2 }] },
    { id: 'porcelain_shop', name: '瓷器铺', buildCost: 9, baseIncome: { type: 'fixed', value: 6 }, builtShopBonuses: [], visitEffects: [] },
    { id: 'goulan_wasi', name: '勾栏瓦肆', buildCost: 8, baseIncome: { type: 'built_shop_count', value: 0 }, builtShopBonuses: [], visitEffects: [] },
    { id: 'silk_shop', name: '绸缎庄', buildCost: 7, baseIncome: { type: 'fixed', value: 4 }, builtShopBonuses: [], visitEffects: [] },
    { id: 'jewelry_shop', name: '首饰铺', buildCost: 5, baseIncome: { type: 'fixed', value: 2 }, builtShopBonuses: [{ targetShopId: 'storytelling_stage', incomeBonus: 1 }, { targetShopId: 'silk_shop', incomeBonus: 1 }, { targetShopId: 'porcelain_shop', incomeBonus: 1 }], visitEffects: [] },
    { id: 'tea_house', name: '茶馆', buildCost: 5, baseIncome: { type: 'fixed', value: 2 }, builtShopBonuses: [{ targetShopId: 'bookshop', incomeBonus: 2 }], visitEffects: [] },
    { id: 'tavern', name: '酒肆', buildCost: 7, baseIncome: { type: 'consumed_menu_count_plus', value: 1 }, builtShopBonuses: [], visitEffects: [] },
    { id: 'bookshop', name: '书坊', buildCost: 6, baseIncome: { type: 'fixed', value: 3 }, builtShopBonuses: [], visitEffects: [] },
    { id: 'storytelling_stage', name: '说书场', buildCost: 5, baseIncome: { type: 'fixed', value: 2 }, builtShopBonuses: [{ targetShopId: 'tea_house', incomeBonus: 1 }, { targetShopId: 'tavern', incomeBonus: 1 }, { targetShopId: 'yinzi_shop', incomeBonus: 1 }], visitEffects: [] }
  ];

  var MENU_CARDS = [
    { id: 'dish_rank_1', name: '一品菜', rank: 1, count: 4, purchaseCost: 9, income: { type: 'dice_plus', value: 2 } },
    { id: 'dish_rank_2', name: '二品菜', rank: 2, count: 12, purchaseCost: 6, income: { type: 'fixed', value: 3 } },
    { id: 'dish_rank_3', name: '三品菜', rank: 3, count: 24, purchaseCost: 3, income: { type: 'fixed', value: 2 } },
    { id: 'dish_rank_4', name: '四品菜', rank: 4, count: 36, purchaseCost: null, income: { type: 'fixed', value: 1 } }
  ];

  var CUSTOMERS = [
    { id: 'zhifu', name: '知府', menuCost: 2, visitShopIds: ['tea_house', 'bookshop', 'storytelling_stage', 'porcelain_shop', 'yinzi_shop'] },
    { id: 'runiang', name: '乳娘', menuCost: 4, visitShopIds: ['bookshop', 'jewelry_shop'] },
    { id: 'guashi', name: '卦师', menuCost: 3, visitShopIds: ['bookshop', 'guanpu_shop', 'porcelain_shop', 'yinzi_shop'] },
    { id: 'qiaofu', name: '樵夫', menuCost: 4, visitShopIds: ['yinzi_shop', 'guasi_shop'] },
    { id: 'wenpo', name: '稳婆', menuCost: 3, visitShopIds: ['silk_shop', 'guanpu_shop', 'storytelling_stage', 'yinzi_shop'] },
    { id: 'hanlin_xueshi', name: '翰林学士', menuCost: 2, visitShopIds: ['bookshop', 'goulan_wasi', 'tavern', 'cuju_field', 'storytelling_stage'] },
    { id: 'shusheng', name: '书生', menuCost: 4, visitShopIds: ['tea_house', 'storytelling_stage'] },
    { id: 'jiangren', name: '匠人', menuCost: 4, visitShopIds: ['guanpu_shop', 'yinzi_shop'] },
    { id: 'qianjin', name: '千金', menuCost: 2, visitShopIds: ['silk_shop', 'goulan_wasi', 'guanpu_shop', 'cuju_field', 'yinzi_shop'] },
    { id: 'huashi', name: '画师', menuCost: 3, visitShopIds: ['tea_house', 'bookshop', 'cuju_field', 'jewelry_shop'] },
    { id: 'chaboshi', name: '茶博士', menuCost: 3, visitShopIds: ['tea_house', 'yinzi_shop', 'bookshop'] },
    { id: 'huolang', name: '货郎', menuCost: 4, visitShopIds: ['guanpu_shop', 'yinzi_shop', 'guasi_shop'] },
    { id: 'xiuniang', name: '绣娘', menuCost: 4, visitShopIds: ['silk_shop', 'jewelry_shop'] },
    { id: 'shuoshuren', name: '说书人', menuCost: 4, visitShopIds: ['storytelling_stage', 'tea_house'] },
    { id: 'yueji', name: '乐伎', menuCost: 3, visitShopIds: ['goulan_wasi', 'tavern', 'storytelling_stage', 'silk_shop'] },
    { id: 'jiubao', name: '酒保', menuCost: 4, visitShopIds: ['tavern', 'yinzi_shop'] },
    { id: 'jiaodian_zhanggui', name: '脚店掌柜', menuCost: 3, visitShopIds: ['tavern', 'tea_house', 'guanpu_shop'] },
    { id: 'xiangke', name: '香客', menuCost: 4, visitShopIds: ['guasi_shop', 'yinzi_shop'] },
    { id: 'meipo', name: '媒婆', menuCost: 3, visitShopIds: ['jewelry_shop', 'silk_shop', 'tea_house', 'storytelling_stage'] },
    { id: 'langzhong', name: '郎中', menuCost: 3, visitShopIds: ['bookshop', 'porcelain_shop', 'tea_house'] },
    { id: 'yaopu_zhanggui', name: '药铺掌柜', menuCost: 2, visitShopIds: ['porcelain_shop', 'bookshop', 'silk_shop', 'jewelry_shop'] },
    { id: 'chouduan_shang', name: '绸缎商', menuCost: 2, visitShopIds: ['silk_shop', 'jewelry_shop', 'porcelain_shop', 'bookshop'] },
    { id: 'cishang', name: '瓷商', menuCost: 2, visitShopIds: ['porcelain_shop', 'guanpu_shop', 'yinzi_shop', 'bookshop'] },
    { id: 'jiaofu', name: '脚夫', menuCost: 4, visitShopIds: ['yinzi_shop', 'tavern'] },
    { id: 'chuanggong', name: '船工', menuCost: 4, visitShopIds: ['tavern', 'yinzi_shop'] },
    { id: 'gengfu', name: '更夫', menuCost: 4, visitShopIds: ['tea_house', 'guasi_shop'] },
    { id: 'xunpu_bing', name: '巡铺兵', menuCost: 3, visitShopIds: ['guanpu_shop', 'cuju_field', 'tavern', 'yinzi_shop'] },
    { id: 'jiren', name: '歌伎', menuCost: 3, visitShopIds: ['goulan_wasi', 'tavern', 'jewelry_shop', 'silk_shop'] },
    { id: 'xiaoniangzi', name: '小娘子', menuCost: 3, visitShopIds: ['jewelry_shop', 'yinzi_shop', 'storytelling_stage', 'guanpu_shop'] },
    { id: 'yuanwai', name: '员外', menuCost: 2, visitShopIds: ['tavern', 'silk_shop', 'porcelain_shop', 'cuju_field', 'goulan_wasi'] },
    { id: 'shushi', name: '塾师', menuCost: 4, visitShopIds: ['bookshop', 'tea_house'] },
    { id: 'senglv', name: '僧侣', menuCost: 4, visitShopIds: ['guasi_shop', 'tea_house'] },
    { id: 'daoshi', name: '道士', menuCost: 3, visitShopIds: ['guasi_shop', 'bookshop', 'porcelain_shop', 'yinzi_shop'] },
    { id: 'fanshang', name: '番商', menuCost: 2, visitShopIds: ['porcelain_shop', 'silk_shop', 'bookshop', 'guanpu_shop', 'tavern'] },
    { id: 'chuniang', name: '厨娘', menuCost: 4, visitShopIds: ['yinzi_shop', 'tavern'] },
    { id: 'taixuesheng', name: '太学生', menuCost: 3, visitShopIds: ['bookshop', 'tea_house', 'goulan_wasi', 'cuju_field'] }
  ];

  var EVENTS = [
    { id: 'lantern_festival', name: '张灯结彩', eventType: 'persistent', notice: '增加客人牌数量至 6 张，候客区保持 6 位客人。', note: '此公告失效时，将多出的客人牌置入弃牌堆。', effect: { type: 'customer_market_size', value: 6 } },
    { id: 'bumper_harvest', name: '硕果累累', eventType: 'instant', notice: '所有玩家获得四品菜单牌 2 张，置入后厨。', note: '', effect: { type: 'grant_menu_to_all', menuId: 'dish_rank_4', count: 2 } },
    { id: 'renewal', name: '辞旧迎新', eventType: 'instant', notice: '将候客区、客人牌堆、弃牌堆中的所有客人牌与事件牌洗混，重新翻出 4 位客人。', note: '', effect: { type: 'reshuffle_customer_deck' } },
    { id: 'snow_cover', name: '银装素裹', eventType: 'persistent', notice: '移除靠前的 2 位客人，候客区只保留 2 位。', note: '此公告失效时，补齐候客区至 4 位。', effect: { type: 'customer_market_size', value: 2 } },
    { id: 'frugal_virtue', name: '俭以养德', eventType: 'persistent', notice: '所有客人进店吃菜时少吃 1 张菜单牌。', note: '', effect: { type: 'menu_cost_modifier', value: -1 } },
    { id: 'taxes', name: '苛捐杂税', eventType: 'instant', notice: '所有玩家每拥有一家店铺，需支付 2 铜钱。', note: '现金不足则扣至 0。', effect: { type: 'pay_per_shop', value: 2 } },
    { id: 'sparse_visitors', name: '门可罗雀', eventType: 'persistent', notice: '所有客人结算时只选 1 家店铺生效。', note: '店铺联动加成仍然有效。', effect: { type: 'choose_one_shop_income' } },
    { id: 'sharp_merchant', name: '无尖不商', eventType: 'persistent', notice: '所有店铺获得收入时减少 1 铜钱（最低为 0）。', note: '', effect: { type: 'shop_income_modifier', value: -1 } },
    { id: 'good_harvest', name: '时和年丰', eventType: 'persistent', notice: '所有客人进店后消费的菜单牌数量增加 1 张。', note: '', effect: { type: 'menu_cost_modifier', value: 1 } }
  ];

  var RULES = {
    name: '大宋百商图',
    baseCustomerMarket: 4,
    customerCopies: 2,
    shopCopies: 3,
    discardMenuCost: 3,
    skipCustomerCost: 1,
    maxEventsPerRefill: 2,
    maxEventsOpening: 3
  };

  var byId = function (list) {
    var map = {};
    list.forEach(function (item) { map[item.id] = item; });
    return map;
  };

  var shopById = byId(SHOPS);
  var menuById = byId(MENU_CARDS);
  var customerById = byId(CUSTOMERS);
  var eventById = byId(EVENTS);

  function clamp(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function shuffle(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(G.rng() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function rollD6() {
    return Math.floor(G.rng() * 6) + 1;
  }

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 9);
  }

  var G = {
    rng: Math.random,
    state: null,
    LANDS: LANDS,
    SHOPS: SHOPS,
    MENU_CARDS: MENU_CARDS,
    CUSTOMERS: CUSTOMERS,
    EVENTS: EVENTS,
    RULES: RULES,
    shopById: shopById,
    menuById: menuById,
    customerById: customerById,
    eventById: eventById,
    rollD6: rollD6,
    shuffle: shuffle,
    startGame: startGame,
    restart: startGame,
    getState: function () { return G.state; },
    menuSupplyList: menuSupplyList,
    countBuiltShops: countBuiltShops,
    builtShopIds: builtShopIds,
    nextClearableLand: nextClearableLand,
    canBuild: canBuild,
    currentCustomer: currentCustomer,
    marketSize: marketSize,
    customerMenuCost: customerMenuCost,
    buyMenu: buyMenu,
    clearAndReserve: clearAndReserve,
    buildShop: buildShop,
    advanceToPhase2: advanceToPhase2,
    discardMenu: discardMenu,
    advanceToPhase3: advanceToPhase3,
    skipCustomer: skipCustomer,
    previewServe: previewServe,
    serveCustomer: serveCustomer,
    nextTurn: nextTurn,
    acknowledgeEvent: acknowledgeEvent,
    ranking: ranking,
    composition: composition,
    escapeHtml: escapeHtml,
    _triggerEvent: triggerEvent
  };

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function log(message) {
    var game = G.state;
    if (!game) return;
    game.log.unshift(message);
    if (game.log.length > 120) game.log.length = 120;
  }

  function makeCard(kind, id, index) {
    return { uid: kind + '_' + id + '_' + index, kind: kind, id: id };
  }

  function buildDeck(items, copies, kind) {
    var deck = [];
    items.forEach(function (item) {
      for (var i = 0; i < copies; i += 1) deck.push(makeCard(kind, item.id, i + 1));
    });
    return shuffle(deck);
  }

  function normalizedOptions(options) {
    options = options || {};
    var playerCount = clamp(options.playerCount == null ? 2 : options.playerCount, 1, 4);
    var startingCash = clamp(options.startingCash == null ? 5 : options.startingCash, 0, 999);
    var lowMenus = clamp(options.startingLowMenus == null ? 6 : options.startingLowMenus, 0, 8);
    var midMenus = clamp(options.startingMidMenus == null ? 2 : options.startingMidMenus, 0, 8);
    var victoryCash = clamp(options.victoryCash == null ? 50 : options.victoryCash, 0, 999);
    var victoryShops = clamp(options.victoryShops == null ? 8 : options.victoryShops, 0, 8);
    if (!victoryCash && !victoryShops) victoryShops = 8;
    var names = Array.isArray(options.names) ? options.names : [];
    return {
      playerCount: playerCount,
      startingCash: startingCash,
      startingLowMenus: lowMenus,
      startingMidMenus: midMenus,
      victoryCash: victoryCash,
      victoryShops: victoryShops,
      names: names,
      events: options.events !== false
    };
  }

  function startGame(options) {
    var opts = normalizedOptions(options);
    var menuSupply = {};
    MENU_CARDS.forEach(function (card) { menuSupply[card.id] = card.count; });

    var starterCounts = { dish_rank_4: opts.startingLowMenus, dish_rank_3: opts.startingMidMenus };
    var starterMenus = [];
    Object.keys(starterCounts).forEach(function (menuId) {
      var requested = starterCounts[menuId];
      var available = menuSupply[menuId] || 0;
      var perPlayer = Math.min(requested, Math.floor(available / opts.playerCount));
      menuSupply[menuId] = available - perPlayer * opts.playerCount;
      starterCounts[menuId] = perPlayer;
      for (var i = 0; i < perPlayer; i += 1) starterMenus.push(menuId);
    });

    var players = [];
    for (var i = 0; i < opts.playerCount; i += 1) {
      var name = (opts.names[i] || '').trim() || ('玩家 ' + (i + 1));
      players.push({
        id: 'player_' + (i + 1),
        seat: i + 1,
        name: name.slice(0, 12),
        cash: opts.startingCash + i,
        lands: LANDS.map(function (land) {
          return { id: land.id, index: land.index, clearCost: land.clearCost, cleared: false, reservedShopId: null, shopId: null };
        }),
        prep: shuffle(starterMenus),
        kitchen: [],
        abandoned: [],
        skippedDiscardThisTurn: false
      });
    }

    G.state = {
      version: 1,
      round: 1,
      currentPlayerIndex: 0,
      phase: 'phase1',
      phase1ActionDone: false,
      victory: { cash: opts.victoryCash, shops: opts.victoryShops },
      starter: starterCounts,
      activeEvent: null,
      eventQueue: [],
      eventHistory: [],
      customerMarket: [],
      customerDeck: buildDeck(CUSTOMERS, RULES.customerCopies, 'customer').concat(opts.events ? buildDeck(EVENTS, 1, 'event') : []),
      customerDiscard: [],
      focusIndex: 0,
      shopDeck: buildDeck(SHOPS, RULES.shopCopies, 'shop'),
      shopMarket: [],
      menuSupply: menuSupply,
      players: players,
      pendingSummary: null,
      winnerId: null,
      log: [],
      eventNesting: 0
    };
    G.state.customerDeck = shuffle(G.state.customerDeck);

    fillCustomerMarket(true);
    fillShopMarket();
    log('开局：' + opts.playerCount + ' 位玩家，每人四品菜 ' + starterCounts.dish_rank_4 + ' 张、三品菜 ' + starterCounts.dish_rank_3 + ' 张。');
    log('胜利条件：' + victoryText(G.state.victory) + '。');
    return G.state;
  }

  function victoryText(victory) {
    var parts = [];
    if (victory.cash) parts.push(victory.cash + ' 铜钱');
    if (victory.shops) parts.push(victory.shops + ' 间店铺');
    return parts.join(' + ');
  }

  function player() {
    return G.state ? G.state.players[G.state.currentPlayerIndex] : null;
  }

  function countBuiltShops(targetPlayer, shopId) {
    if (!targetPlayer) return 0;
    return targetPlayer.lands.filter(function (land) {
      return land.shopId && (!shopId || land.shopId === shopId);
    }).length;
  }

  function builtShopIds(targetPlayer) {
    return targetPlayer.lands.filter(function (land) { return land.shopId; }).map(function (land) { return land.shopId; });
  }

  function nextClearableLand(targetPlayer) {
    if (!targetPlayer) return null;
    for (var i = 0; i < targetPlayer.lands.length; i += 1) {
      if (!targetPlayer.lands[i].cleared) return targetPlayer.lands[i];
    }
    return null;
  }

  function canBuild(targetPlayer) {
    if (!targetPlayer) return [];
    return targetPlayer.lands.filter(function (land) {
      return land.cleared && land.reservedShopId && !land.shopId;
    });
  }

  function menuSupplyList() {
    return MENU_CARDS.map(function (card) {
      return {
        id: card.id,
        name: card.name,
        rank: card.rank,
        left: G.state ? (G.state.menuSupply[card.id] || 0) : 0,
        purchaseCost: card.purchaseCost,
        income: card.income
      };
    });
  }

  function composition(menuIds) {
    var result = { total: 0, byRank: {}, list: [] };
    (menuIds || []).forEach(function (id) {
      var card = menuById[id];
      if (!card) return;
      result.total += 1;
      result.byRank[card.rank] = (result.byRank[card.rank] || 0) + 1;
    });
    [4, 3, 2, 1].forEach(function (rank) {
      if (result.byRank[rank]) result.list.push({ rank: rank, name: menuById['dish_rank_' + rank].name, count: result.byRank[rank] });
    });
    return result;
  }

  function marketSize() {
    var game = G.state;
    var effect = game && game.activeEvent && game.activeEvent.effect;
    if (effect && effect.type === 'customer_market_size') return effect.value;
    return RULES.baseCustomerMarket;
  }

  function currentCustomer() {
    var game = G.state;
    if (!game) return null;
    var card = game.customerMarket[game.focusIndex] || null;
    if (!card) return null;
    return { card: card, customer: customerById[card.id] };
  }

  function drawCustomerCard() {
    var game = G.state;
    if (!game.customerDeck.length && game.customerDiscard.length) {
      game.customerDeck = shuffle(game.customerDiscard);
      game.customerDiscard = [];
    }
    return game.customerDeck.pop() || null;
  }

  function requeueEventCard(card) {
    var game = G.state;
    var index = Math.floor(G.rng() * (game.customerDeck.length + 1));
    game.customerDeck.splice(index, 0, card);
  }

  function trimMarketTo(size, mode) {
    var game = G.state;
    while (game.customerMarket.length > size) {
      var index = mode === 'front' ? 0 : game.customerMarket.length - 1;
      var removed = game.customerMarket.splice(index, 1)[0];
      if (removed) game.customerDiscard.push({ uid: removed.uid, kind: removed.kind, id: removed.id });
    }
    clampFocus();
  }

  function clampFocus() {
    var game = G.state;
    var maxIndex = Math.min(marketSize(), game.customerMarket.length) - 1;
    if (maxIndex < 0) maxIndex = 0;
    game.focusIndex = Math.min(Math.max(game.focusIndex || 0, 0), maxIndex);
  }

  function fillCustomerMarket(opening) {
    var game = G.state;
    if (!game) return;
    var eventsThisFill = 0;
    var maxEvents = opening ? RULES.maxEventsOpening : RULES.maxEventsPerRefill;
    var attempts = 0;
    while (game.customerMarket.length < marketSize()) {
      attempts += 1;
      if (attempts > 240) break;
      var card = drawCustomerCard();
      if (!card) break;
      if (card.kind === 'event') {
        if (eventsThisFill >= maxEvents) {
          requeueEventCard(card);
          continue;
        }
        eventsThisFill += 1;
        game.customerDiscard.push(card);
        triggerEvent(card.id);
        continue;
      }
      game.customerMarket.push({ uid: card.uid, kind: 'customer', id: card.id, tip: 0 });
    }
    clampFocus();
  }

  function triggerEvent(eventId) {
    var game = G.state;
    var event = eventById[eventId];
    if (!event || game.eventNesting > 3) return;
    game.eventNesting += 1;
    try {
      game.eventQueue.push({ id: event.id, eventType: event.eventType, name: event.name, notice: event.notice, note: event.note });
      game.eventHistory.push({ id: event.id, eventType: event.eventType, name: event.name, notice: event.notice, note: event.note, round: game.round });
      log('事件牌【' + event.name + '】宣读：' + event.notice);
      if (event.eventType === 'persistent') {
        setActiveEvent(event);
      } else {
        cancelActiveEvent(event);
        applyInstantEvent(event);
      }
    } finally {
      game.eventNesting -= 1;
    }
  }

  function setActiveEvent(event) {
    var game = G.state;
    var old = game.activeEvent;
    game.activeEvent = null;
    if (old && old.effect && old.effect.type === 'customer_market_size') {
      trimMarketTo(RULES.baseCustomerMarket, 'tail');
    }
    if (!event) {
      if (game.customerMarket.length < RULES.baseCustomerMarket) fillCustomerMarket(false);
      clampFocus();
      return;
    }
    game.activeEvent = event;
    if (event.effect && event.effect.type === 'customer_market_size') {
      trimMarketTo(event.effect.value, event.id === 'snow_cover' ? 'front' : 'tail');
      if (game.customerMarket.length < event.effect.value) fillCustomerMarket(false);
    } else {
      trimMarketTo(RULES.baseCustomerMarket, 'tail');
      if (game.customerMarket.length < RULES.baseCustomerMarket) fillCustomerMarket(false);
    }
    clampFocus();
  }

  function cancelActiveEvent(nextEvent) {
    var game = G.state;
    var old = game.activeEvent;
    if (!old) return;
    setActiveEvent(null);
    log('长期公告【' + old.name + '】因【' + nextEvent.name + '】失效。');
  }

  function applyInstantEvent(event) {
    var game = G.state;
    var effect = event.effect || {};
    if (effect.type === 'grant_menu_to_all') {
      game.players.forEach(function (p) {
        var left = game.menuSupply[effect.menuId] || 0;
        var amount = Math.min(effect.count, left);
        for (var i = 0; i < amount; i += 1) p.kitchen.push(effect.menuId);
        game.menuSupply[effect.menuId] = left - amount;
        log(p.name + ' 获得 ' + menuById[effect.menuId].name + ' ' + amount + ' 张。');
      });
    }
    if (effect.type === 'pay_per_shop') {
      game.players.forEach(function (p) {
        var payment = Math.min(p.cash, countBuiltShops(p) * effect.value);
        p.cash -= payment;
        log(p.name + ' 因【' + event.name + '】支付 ' + payment + ' 铜钱。');
      });
    }
    if (effect.type === 'reshuffle_customer_deck') {
      var cards = game.customerDeck.concat(game.customerMarket, game.customerDiscard);
      game.customerDeck = shuffle(cards);
      game.customerMarket = [];
      game.customerDiscard = [];
      game.focusIndex = 0;
      fillCustomerMarket(false);
      log('【' + event.name + '】客人牌与事件牌重新洗混，候客区重新发牌。');
    }
  }

  function fillShopMarket() {
    var game = G.state;
    while (game.shopMarket.length < 4 && game.shopDeck.length) {
      game.shopMarket.push(game.shopDeck.pop());
    }
  }

  function ensurePhase1() {
    return G.state && G.state.phase === 'phase1';
  }

  function buyMenu(menuId) {
    var game = G.state;
    if (!ensurePhase1()) return { ok: false, error: '现在不是购买阶段' };
    if (game.phase1ActionDone) return { ok: false, error: '本回合的购买行动已经用过了' };
    var card = menuById[menuId];
    var p = player();
    if (!card) return { ok: false, error: '没有这张菜单' };
    if (card.purchaseCost == null) return { ok: false, error: '四品菜只随事件获得，不能购买' };
    if ((game.menuSupply[menuId] || 0) <= 0) return { ok: false, error: '这道菜已经卖完了' };
    if (p.cash < card.purchaseCost) return { ok: false, error: '铜钱不够' };
    p.cash -= card.purchaseCost;
    game.menuSupply[menuId] -= 1;
    p.kitchen.push(menuId);
    game.phase1ActionDone = true;
    log(p.name + ' 花 ' + card.purchaseCost + ' 铜钱购买 ' + card.name + '，放入后厨。');
    return { ok: true };
  }

  function clearAndReserve(landId, shopUid) {
    var game = G.state;
    if (!ensurePhase1()) return { ok: false, error: '现在不是购买阶段' };
    if (game.phase1ActionDone) return { ok: false, error: '本回合的购买行动已经用过了' };
    var p = player();
    var land = p.lands.filter(function (item) { return item.id === landId; })[0];
    var next = nextClearableLand(p);
    if (!land || !next || land.id !== next.id) return { ok: false, error: '土地必须按顺序清理' };
    if (p.cash < land.clearCost) return { ok: false, error: '铜钱不够支付清地费' };
    if (!shopUid && game.shopMarket.length) return { ok: false, error: '清地时须认购一家店铺' };
    var cardIndex = -1;
    if (shopUid) {
      cardIndex = game.shopMarket.findIndex(function (card) { return card.uid === shopUid; });
      if (cardIndex < 0) return { ok: false, error: '这家店铺已不在展示区' };
    }
    p.cash -= land.clearCost;
    land.cleared = true;
    if (cardIndex >= 0) {
      var card = game.shopMarket.splice(cardIndex, 1)[0];
      land.reservedShopId = card.id;
      fillShopMarket();
      log(p.name + ' 支付 ' + land.clearCost + ' 铜钱清理第 ' + next.index + ' 块地，并认购 ' + shopById[card.id].name + '。');
    } else {
      log(p.name + ' 支付 ' + land.clearCost + ' 铜钱清理第 ' + next.index + ' 块地，展示区暂无店铺可认购。');
    }
    game.phase1ActionDone = true;
    return { ok: true };
  }

  function buildShop(landId) {
    var game = G.state;
    if (!ensurePhase1()) return { ok: false, error: '只能在购买阶段修建店铺' };
    var p = player();
    var land = p.lands.filter(function (item) { return item.id === landId; })[0];
    if (!land || !land.cleared || !land.reservedShopId || land.shopId) return { ok: false, error: '这块地没有可修建的店铺' };
    var shop = shopById[land.reservedShopId];
    if (p.cash < shop.buildCost) return { ok: false, error: '铜钱不够支付建造费' };
    p.cash -= shop.buildCost;
    land.shopId = shop.id;
    log(p.name + ' 花 ' + shop.buildCost + ' 铜钱建造 ' + shop.name + '。');
    checkVictory();
    return { ok: true };
  }

  function advanceToPhase2() {
    var game = G.state;
    if (!game || game.phase !== 'phase1') return { ok: false, error: '现在不是购买阶段' };
    game.phase = 'phase2';
    game.phase1ActionDone = true;
    log(player().name + ' 进入备菜阶段。');
    return { ok: true };
  }

  function discardMenu(kitchenIndex) {
    var game = G.state;
    if (!game || game.phase !== 'phase2') return { ok: false, error: '现在不是备菜阶段' };
    var p = player();
    if (p.skippedDiscardThisTurn) return { ok: false, error: '本回合已经弃过菜了' };
    if (p.cash < RULES.discardMenuCost) return { ok: false, error: '铜钱不够' };
    if (!Number.isInteger(kitchenIndex) || kitchenIndex < 0 || kitchenIndex >= p.kitchen.length) return { ok: false, error: '后厨没有这张菜' };
    var menuId = p.kitchen.splice(kitchenIndex, 1)[0];
    p.cash -= RULES.discardMenuCost;
    p.abandoned.push(menuId);
    p.skippedDiscardThisTurn = true;
    game.phase = 'phase3';
    game.focusIndex = 0;
    log(p.name + ' 花 ' + RULES.discardMenuCost + ' 铜钱弃掉一张' + menuById[menuId].name + '，进入招待阶段。');
    return { ok: true };
  }

  function advanceToPhase3() {
    var game = G.state;
    if (!game || game.phase !== 'phase2') return { ok: false, error: '现在不是备菜阶段' };
    game.phase = 'phase3';
    game.focusIndex = 0;
    log(player().name + ' 跳过弃菜，进入招待阶段。');
    return { ok: true };
  }

  function skipCustomer() {
    var game = G.state;
    if (!game || game.phase !== 'phase3') return { ok: false, error: '现在不是招待阶段' };
    var p = player();
    var current = currentCustomer();
    if (!current) return { ok: false, error: '候客区没有客人' };
    if (p.cash < RULES.skipCustomerCost) return { ok: false, error: '铜钱不够' };
    var visible = Math.min(marketSize(), game.customerMarket.length);
    if (game.focusIndex >= visible - 1) return { ok: false, error: '最后一位客人必须招待' };
    p.cash -= RULES.skipCustomerCost;
    current.card.tip = (current.card.tip || 0) + RULES.skipCustomerCost;
    game.focusIndex += 1;
    log(p.name + ' 付 1 铜钱跳过 ' + current.customer.name + '，这枚铜钱留在客人身上。');
    return { ok: true };
  }

  function customerMenuCost(p, customer) {
    var game = G.state;
    var base = customer.menuCost;
    var eventModifier = 0;
    var shopExtra = 0;
    var effects = [];
    if (game.activeEvent && game.activeEvent.effect && game.activeEvent.effect.type === 'menu_cost_modifier') {
      eventModifier = game.activeEvent.effect.value;
      effects.push({ label: game.activeEvent.name, amount: eventModifier });
    }
    customer.visitShopIds.forEach(function (shopId) {
      var count = countBuiltShops(p, shopId);
      if (!count) return;
      var shop = shopById[shopId];
      (shop.visitEffects || []).forEach(function (effect) {
        if (effect.type !== 'extra_menu_cost' || effect.value <= 0) return;
        var amount = effect.value * count;
        shopExtra += amount;
        effects.push({ label: shop.name + '×' + count, amount: amount });
      });
    });
    return {
      base: base,
      eventModifier: eventModifier,
      shopExtra: shopExtra,
      total: Math.max(0, base + eventModifier + shopExtra),
      effects: effects
    };
  }

  function visitList(p, customer) {
    var visits = [];
    customer.visitShopIds.forEach(function (shopId) {
      var count = countBuiltShops(p, shopId);
      for (var i = 0; i < count; i += 1) visits.push(shopId);
    });
    return visits;
  }

  function sparseActive() {
    var game = G.state;
    return Boolean(game.activeEvent && game.activeEvent.effect && game.activeEvent.effect.type === 'choose_one_shop_income');
  }

  function previewServe() {
    var game = G.state;
    if (!game || game.phase !== 'phase3') return null;
    var current = currentCustomer();
    if (!current) return null;
    var p = player();
    var customer = current.customer;
    var cost = customerMenuCost(p, customer);
    var visits = visitList(p, customer);
    var unique = [];
    visits.forEach(function (shopId) { if (unique.indexOf(shopId) < 0) unique.push(shopId); });
    return {
      customerId: customer.id,
      customerName: customer.name,
      menuCost: cost,
      visits: visits,
      uniqueVisits: unique,
      needChoice: sparseActive() && visits.length > 1,
      tip: current.card.tip || 0
    };
  }

  function spendMenus(p, count) {
    var spent = [];
    var recyclable = p.kitchen.slice();
    var recycled = false;
    var missed = 0;
    for (var i = 0; i < count; i += 1) {
      if (!p.prep.length && !recycled && recyclable.length) {
        p.prep = shuffle(recyclable);
        recyclable = [];
        recycled = true;
        log(p.name + ' 雅阁菜品不足，后厨菜品洗牌回到雅阁继续消耗。');
      }
      if (!p.prep.length) {
        missed += 1;
        continue;
      }
      var index = Math.floor(G.rng() * p.prep.length);
      spent.push(p.prep.splice(index, 1)[0]);
    }
    p.kitchen = recycled ? spent.slice() : recyclable.concat(spent);
    return { spent: spent, missed: missed, recycled: recycled };
  }

  function menuIncome(spent) {
    var total = 0;
    var parts = [];
    var dice = [];
    spent.forEach(function (menuId) {
      var card = menuById[menuId];
      if (card.income.type === 'fixed') {
        total += card.income.value;
        parts.push({ label: card.name, value: card.income.value });
      } else if (card.income.type === 'dice_plus') {
        var roll = rollD6();
        var value = roll + (card.income.value || 0);
        total += value;
        dice.push({ label: card.name, roll: roll, bonus: card.income.value || 0, value: value });
      }
    });
    return { total: total, parts: parts, dice: dice };
  }

  function shopIncome(p, shopId, consumedCount) {
    var game = G.state;
    var shop = shopById[shopId];
    var base = shop.baseIncome;
    var total = 0;
    var parts = [];
    var dice = [];
    if (base.type === 'fixed') {
      total += base.value;
      parts.push({ label: shop.name, value: base.value });
    } else if (base.type === 'dice') {
      var roll = rollD6();
      total += roll;
      dice.push({ label: shop.name, roll: roll, bonus: 0, value: roll });
    } else if (base.type === 'built_shop_count') {
      var count = countBuiltShops(p);
      total += count;
      parts.push({ label: shop.name + '（店铺数）', value: count });
    } else if (base.type === 'consumed_menu_count_plus') {
      var value = consumedCount + (base.value || 0);
      total += value;
      parts.push({ label: shop.name + '（菜品数+' + (base.value || 0) + '）', value: value });
    }
    builtShopIds(p).forEach(function (builtId) {
      var source = shopById[builtId];
      (source.builtShopBonuses || []).forEach(function (bonus) {
        if (bonus.targetShopId !== shopId) return;
        total += bonus.incomeBonus;
        parts.push({ label: source.name + '联动', value: bonus.incomeBonus });
      });
    });
    if (game.activeEvent && game.activeEvent.effect && game.activeEvent.effect.type === 'shop_income_modifier') {
      var before = total;
      total = Math.max(0, total + game.activeEvent.effect.value);
      parts.push({ label: game.activeEvent.name, value: total - before });
    }
    return { shopId: shopId, shopName: shop.name, total: total, parts: parts, dice: dice };
  }

  function serveCustomer(selectedShopId) {
    var game = G.state;
    if (!game || game.phase !== 'phase3') return { ok: false, error: '现在不是招待阶段' };
    var current = currentCustomer();
    if (!current) return { ok: false, error: '候客区没有客人' };
    var p = player();
    var customer = current.customer;
    var cost = customerMenuCost(p, customer);
    var visits = visitList(p, customer);
    if (sparseActive() && visits.length > 1) {
      if (!selectedShopId) {
        var unique = [];
        visits.forEach(function (shopId) { if (unique.indexOf(shopId) < 0) unique.push(shopId); });
        return { ok: false, needChoice: true, options: unique.map(function (shopId) { return { id: shopId, name: shopById[shopId].name }; }) };
      }
      var at = visits.indexOf(selectedShopId);
      if (at < 0) return { ok: false, error: '这位客人不会去那家店' };
      visits = [visits[at]];
    }

    var cashBefore = p.cash;
    var spentResult = spendMenus(p, cost.total);
    var mIncome = menuIncome(spentResult.spent);
    var shopResults = visits.map(function (shopId) {
      return shopIncome(p, shopId, spentResult.spent.length);
    });
    var shopTotal = shopResults.reduce(function (sum, item) { return sum + item.total; }, 0);
    var tip = current.card.tip || 0;
    var total = mIncome.total + shopTotal + tip;
    p.cash += total;

    var summary = {
      id: uid('summary'),
      playerId: p.id,
      playerName: p.name,
      customerId: customer.id,
      customerName: customer.name,
      cost: cost,
      spent: spentResult.spent,
      spentCount: spentResult.spent.length,
      missed: spentResult.missed,
      menuIncome: mIncome.total,
      menuParts: mIncome.parts,
      menuDice: mIncome.dice,
      shopIncome: shopTotal,
      shopResults: shopResults,
      tip: tip,
      total: total,
      cashBefore: cashBefore,
      cashAfter: p.cash
    };
    game.pendingSummary = summary;

    game.customerMarket.splice(game.focusIndex, 1);
    game.customerDiscard.push({ uid: current.card.uid, kind: 'customer', id: current.card.id });
    game.focusIndex = 0;
    log(p.name + ' 招待 ' + customer.name + '：吃 ' + cost.total + ' 道菜（实际 ' + spentResult.spent.length + ' 道），' +
      '菜品收益 ' + mIncome.total + '，店铺收益 ' + shopTotal + (tip ? '，客人随身 ' + tip : '') + '，合计 ' + total + ' 铜钱。');
    if (spentResult.missed) log('雅阁与后厨菜品不足，少吃了 ' + spentResult.missed + ' 道菜。');
    fillCustomerMarket(false);
    var won = checkVictory();
    if (!won) game.phase = 'turnDone';
    return { ok: true, summary: summary, victory: won };
  }

  function checkVictory() {
    var game = G.state;
    if (!game || game.winnerId) return false;
    var p = player();
    var condition = game.victory;
    if (!condition.cash && !condition.shops) return false;
    var cashOk = !condition.cash || p.cash >= condition.cash;
    var shopsOk = !condition.shops || countBuiltShops(p) >= condition.shops;
    if (cashOk && shopsOk) {
      game.winnerId = p.id;
      game.phase = 'over';
      log('【' + p.name + '】达成胜利条件：' + victoryText(condition) + '！');
      return true;
    }
    return false;
  }

  function acknowledgeEvent() {
    var game = G.state;
    if (!game || !game.eventQueue.length) return null;
    return game.eventQueue.shift();
  }

  function nextTurn() {
    var game = G.state;
    if (!game || game.phase === 'over') return { ok: false, error: '对局已经结束' };
    var previous = player();
    if (game.currentPlayerIndex === game.players.length - 1) {
      game.currentPlayerIndex = 0;
      game.round += 1;
    } else {
      game.currentPlayerIndex += 1;
    }
    game.phase = 'phase1';
    game.phase1ActionDone = false;
    game.focusIndex = 0;
    game.pendingSummary = null;
    var next = player();
    next.skippedDiscardThisTurn = false;
    if (!next.prep.length && next.kitchen.length) {
      next.prep = shuffle(next.kitchen);
      next.kitchen = [];
      log(next.name + ' 回合开始时雅阁为空，后厨菜品洗回雅阁。');
    }
    fillShopMarket();
    if (game.customerMarket.length < marketSize()) fillCustomerMarket(false);
    log('结束 ' + previous.name + ' 的回合，轮到 ' + next.name + '。');
    return { ok: true };
  }

  function ranking() {
    var game = G.state;
    if (!game) return [];
    var list = game.players.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        cash: p.cash,
        shops: countBuiltShops(p),
        lands: p.lands.filter(function (land) { return land.shopId; }).map(function (land) {
          return { landIndex: land.id, shopId: land.shopId, shopName: shopById[land.shopId].name };
        })
      };
    });
    list.sort(function (a, b) {
      if (a.id === game.winnerId) return -1;
      if (b.id === game.winnerId) return 1;
      if (b.shops !== a.shops) return b.shops - a.shops;
      return b.cash - a.cash;
    });
    list.forEach(function (item, index) { item.rank = index + 1; });
    return list;
  }

  root.DSM = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);
