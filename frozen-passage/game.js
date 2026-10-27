/* 流冰航路 The Frozen Passage — 纯规则引擎（无 DOM，可在浏览器与 Node 中运行） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrozenPassage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var COLORS = ['blue', 'red', 'black'];
  var COLOR_NAME = { blue: '蓝', red: '红', black: '黑' };
  var COLOR_EN = { blue: 'Blue', red: 'Red', black: 'Black' };
  var DIFFICULTIES = ['novice', 'medium', 'expert'];
  var ITEM_TYPES = ['inuit', 'sled', 'log'];
  var ITEM_POOL = ['inuit', 'inuit', 'sled', 'sled', 'log', 'log'];
  var ITEM_NAME = { inuit: '因纽特智慧', sled: '狗拉雪橇', log: '航海日志' };
  var ITEM_DESC = {
    inuit: '放置后，可在其旁边追加一张同数字手牌',
    sled: '将一张手牌放回抽牌堆底部，再从供应堆取一张',
    log: '用一张手牌替换一张已放置的卡牌'
  };

  var CARDS = {};
  COLORS.forEach(function (color) {
    for (var n = 1; n <= 9; n++) {
      var id = color + '-' + n;
      CARDS[id] = { id: id, color: color, number: n };
    }
  });

  var GOALS = {};
  COLORS.forEach(function (color) {
    for (var v = 1; v <= 2; v++) {
      var id = 'goal-' + color + '-' + v;
      GOALS[id] = { id: id, color: color, variant: v };
    }
  });

  /* ---------------- 随机数 ---------------- */

  function nextFloat(state) {
    var t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
    var r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(state, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(nextFloat(state) * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /* ---------------- 查询 ---------------- */

  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function slotById(state, id) {
    for (var i = 0; i < state.board.slots.length; i++) {
      if (state.board.slots[i].id === id) return state.board.slots[i];
    }
    return null;
  }

  function slotByPos(state, row, index) {
    return slotById(state, 'r' + row + '-' + index);
  }

  function getCard(cardId) {
    return CARDS[cardId] || null;
  }

  function goalForSlot(state, slot) {
    for (var i = 0; i < state.board.goals.length; i++) {
      if (state.board.goals[i].slotId === slot.id) return state.board.goals[i];
    }
    return null;
  }

  function supportSlots(state, slot) {
    if (slot.row === 1) return [];
    if (slot.index === 1) return [slotByPos(state, slot.row - 1, 1)];
    if (slot.index === slot.row) return [slotByPos(state, slot.row - 1, slot.row - 1)];
    return [
      slotByPos(state, slot.row - 1, slot.index - 1),
      slotByPos(state, slot.row - 1, slot.index)
    ];
  }

  /* 某张下方卡牌对应的两个上方位置（每张下方牌都被恰好两张上方牌压住） */
  function upperSlots(state, slot) {
    if (slot.row >= 5) return [];
    return [
      slotByPos(state, slot.row + 1, slot.index),
      slotByPos(state, slot.row + 1, slot.index + 1)
    ].filter(Boolean);
  }

  function nearestOccupiedInRow(state, row, index, dir) {
    for (var i = index + dir; i >= 1 && i <= row; i += dir) {
      var slot = slotByPos(state, row, i);
      if (slot && slot.cardId) return slot;
    }
    return null;
  }

  function hasUnusedItem(state, type) {
    return state.items.some(function (it) { return it.type === type && !it.used; });
  }

  function markItemUsed(state, type) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].type === type && !state.items[i].used) {
        state.items[i].used = true;
        return state.items[i];
      }
    }
    return null;
  }

  function isFull(state) {
    return state.board.slots.every(function (s) { return !!s.cardId; });
  }

  function sortHand(state) {
    state.hand.sort(function (a, b) {
      var ca = CARDS[a], cb = CARDS[b];
      if (ca.number !== cb.number) return ca.number - cb.number;
      return COLORS.indexOf(ca.color) - COLORS.indexOf(cb.color);
    });
  }

  function removeFromHand(state, cardId) {
    var i = state.hand.indexOf(cardId);
    if (i >= 0) state.hand.splice(i, 1);
  }

  /* ---------------- 放置判定 ---------------- */

  function canPlace(state, cardId, slotId, opts) {
    opts = opts || {};
    var card = CARDS[cardId];
    if (!card) return { ok: false, code: 'card', message: '卡牌不存在' };
    var slot = slotById(state, slotId);
    if (!slot) return { ok: false, code: 'slot', message: '位置不存在' };
    if (slot.cardId && !opts.ignoreOccupied) {
      return { ok: false, code: 'occupied', message: '该位置已有卡牌' };
    }

    var below = supportSlots(state, slot);
    var missing = below.filter(function (s) { return !s.cardId; });
    if (missing.length) {
      return {
        ok: false,
        code: 'support',
        message: '下方支撑不足',
        missing: missing.map(function (s) { return s.id; })
      };
    }

    if (slot.row === 5) {
      var goal = goalForSlot(state, slot);
      if (goal && goal.faceUp && goal.color !== card.color) {
        return {
          ok: false,
          code: 'goal',
          message: '与正面目标卡颜色不符',
          goalColor: goal.color
        };
      }
    }

    var left = nearestOccupiedInRow(state, slot.row, slot.index, -1);
    var right = nearestOccupiedInRow(state, slot.row, slot.index, 1);
    var leftCard = left ? CARDS[left.cardId] : null;
    var rightCard = right ? CARDS[right.cardId] : null;

    if (leftCard) {
      if (opts.inuitPairWith === left.id) {
        if (card.number !== leftCard.number) {
          return { ok: false, code: 'pair', message: '因纽特配对必须是相同数字' };
        }
      } else if (card.number <= leftCard.number) {
        return { ok: false, code: 'number-left', message: '需大于同行左侧最近的卡牌' };
      }
    }

    if (rightCard) {
      if (opts.inuitPairWith === right.id) {
        if (card.number !== rightCard.number) {
          return { ok: false, code: 'pair', message: '因纽特配对必须是相同数字' };
        }
      } else if (card.number >= rightCard.number) {
        return { ok: false, code: 'number-right', message: '需小于同行右侧最近的卡牌' };
      }
    }

    /*
     * 规则②：下方每张牌，其上方的两张牌中至少一张要与它同色。
     * 另一张上方牌尚未放置时，颜色义务延后到那张牌落下时再校验。
     */
    for (var b = 0; b < below.length; b++) {
      var belowSlot = below[b];
      var belowCard = CARDS[belowSlot.cardId];
      if (!belowCard || belowCard.color === card.color) continue;
      var sibling = upperSlots(state, belowSlot).filter(function (s) {
        return s.id !== slot.id;
      })[0];
      if (!sibling || !sibling.cardId) continue;
      if (CARDS[sibling.cardId].color === belowCard.color) continue;
      return {
        ok: false,
        code: 'color',
        message: '需接续下方' + COLOR_NAME[belowCard.color] + ' ' + belowCard.number + ' 的颜色',
        supportId: belowCard.id,
        supportColor: belowCard.color,
        supportNumber: belowCard.number
      };
    }

    /*
     * 换牌时新牌还要反向接续上方已放置的牌：上方两张都已就位时，
     * 至少一张必须与新牌同色；有空位则把义务延后到那张牌落下时。
     */
    if (opts.requireUpperColor) {
      var placedUpper = upperSlots(state, slot).filter(function (s) { return !!s.cardId; });
      if (placedUpper.length === 2) {
        var upperMatch = placedUpper.some(function (s) {
          return CARDS[s.cardId].color === card.color;
        });
        if (!upperMatch) {
          return {
            ok: false,
            code: 'color',
            message: '需与上方' + placedUpper.map(function (s) {
              var c = CARDS[s.cardId];
              return COLOR_NAME[c.color] + ' ' + c.number;
            }).join('、') + ' 中的一张同色',
            upperCardIds: placedUpper.map(function (s) { return s.cardId; }),
            upperColors: placedUpper.map(function (s) { return CARDS[s.cardId].color; })
          };
        }
      }
    }

    var belowCards = below.map(function (s) { return CARDS[s.cardId]; }).filter(Boolean);
    var colorMatches = belowCards.filter(function (c) { return c.color === card.color; });
    var newRoute = belowCards.length > 0 && colorMatches.length === 0;

    return {
      ok: true,
      colorMatches: colorMatches,
      newRoute: newRoute,
      left: left ? left.id : null,
      right: right ? right.id : null
    };
  }

  function legalPlacements(state, cardId) {
    var out = [];
    state.board.slots.forEach(function (slot) {
      var r = canPlace(state, cardId, slot.id);
      if (r.ok) {
        out.push({
          slotId: slot.id,
          row: slot.row,
          index: slot.index,
          colorMatches: r.colorMatches,
          newRoute: r.newRoute
        });
      }
    });
    return out;
  }

  function hasAnyLegalPlacement(state) {
    for (var i = 0; i < state.hand.length; i++) {
      if (legalPlacements(state, state.hand[i]).length > 0) return true;
    }
    return false;
  }

  /* ---------------- 物品选项 ---------------- */

  function inuitOptions(state) {
    var p = state.pendingInuit;
    if (!p) return [];
    var placedSlot = slotById(state, p.placedSlotId);
    if (!placedSlot || !placedSlot.cardId) return [];
    if (!hasUnusedItem(state, 'inuit')) return [];
    var placedCard = CARDS[placedSlot.cardId];
    var out = [];
    state.hand.forEach(function (cardId) {
      var card = CARDS[cardId];
      if (!card || card.number !== placedCard.number) return;
      [-1, 1].forEach(function (d) {
        var idx = placedSlot.index + d;
        if (idx < 1 || idx > placedSlot.row) return;
        var target = slotByPos(state, placedSlot.row, idx);
        if (!target || target.cardId) return;
        var r = canPlace(state, cardId, target.id, { inuitPairWith: placedSlot.id });
        if (r.ok) {
          out.push({
            cardId: cardId,
            slotId: target.id,
            row: target.row,
            index: target.index,
            newRoute: r.newRoute
          });
        }
      });
    });
    return out;
  }

  function logOptions(state) {
    var out = [];
    if (state.hand.length === 0) return out;
    state.board.slots.forEach(function (slot) {
      if (!slot.cardId) return;
      state.hand.forEach(function (cardId) {
        var r = canPlace(state, cardId, slot.id, {
          ignoreOccupied: true,
          requireUpperColor: true
        });
        if (r.ok) {
          out.push({
            slotId: slot.id,
            cardId: cardId,
            outCardId: slot.cardId,
            newRoute: r.newRoute
          });
        }
      });
    });
    return out;
  }

  function canUseSled(state) {
    return (state.phase === 'place' || state.phase === 'stuck') &&
      hasUnusedItem(state, 'sled') && state.hand.length > 0 && state.supply.length > 0;
  }

  function canUseLog(state) {
    return (state.phase === 'place' || state.phase === 'stuck') &&
      hasUnusedItem(state, 'log') && logOptions(state).length > 0;
  }

  /* ---------------- 航线分析（提示用，不参与胜负） ---------------- */

  function analyzeRoutes(state) {
    var placed = [];
    state.board.slots.forEach(function (s) {
      if (s.cardId) placed.push(s);
    });
    var parent = {};
    placed.forEach(function (s) { parent[s.id] = s.id; });
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    placed.forEach(function (s) {
      var card = CARDS[s.cardId];
      supportSlots(state, s).forEach(function (below) {
        if (!below.cardId) return;
        if (CARDS[below.cardId].color === card.color) union(s.id, below.id);
      });
    });
    var groups = {};
    placed.forEach(function (s) {
      var r = find(s.id);
      if (!groups[r]) groups[r] = { color: CARDS[s.cardId].color, slots: [], reachesRow5: false };
      groups[r].slots.push(s.id);
      if (s.row === 5) groups[r].reachesRow5 = true;
    });
    return Object.keys(groups).map(function (k) {
      return {
        color: groups[k].color,
        slots: groups[k].slots,
        reachesRow5: groups[k].reachesRow5,
        size: groups[k].slots.length
      };
    });
  }

  /* ---------------- 流程 ---------------- */

  function fail(code, message) {
    return { ok: false, code: code, message: message };
  }

  function toRefillOrNext(state) {
    state.pendingInuit = null;
    if (state.supply.length > 0) {
      state.phase = 'refill';
    } else {
      startNextTurn(state);
    }
  }

  function startNextTurn(state) {
    state.turn += 1;
    state.pendingInuit = null;
    if (state.hand.length === 0) {
      state.phase = 'lost';
      state.lossReason = 'no-hand';
      return;
    }
    state.phase = hasAnyLegalPlacement(state) ? 'place' : 'stuck';
    if (state.phase === 'stuck') state.lossHint = true;
  }

  function createGame(opts) {
    opts = opts || {};
    var difficulty = opts.difficulty || 'novice';
    if (DIFFICULTIES.indexOf(difficulty) < 0) throw new Error('未知难度: ' + difficulty);
    var seed = (opts.seed == null ? Date.now() : opts.seed) >>> 0;

    var state = {
      version: VERSION,
      seed: seed,
      rng: seed,
      mode: 'solo',
      difficulty: difficulty,
      phase: 'place',
      turn: 1,
      board: { slots: [], goals: [], starter: { slotId: 'r1-1' } },
      hand: [],
      supply: [],
      draw: [],
      items: [],
      pendingInuit: null,
      log: [],
      lastAction: null,
      lossReason: null,
      lossHint: false
    };

    for (var row = 1; row <= 5; row++) {
      for (var index = 1; index <= row; index++) {
        state.board.slots.push({
          id: 'r' + row + '-' + index,
          row: row,
          index: index,
          cardId: null,
          goalId: null
        });
      }
    }

    var goalIds = shuffle(state, Object.keys(GOALS)).slice(0, 5);
    var reveal = {
      novice: [false, false, false, false, false],
      medium: [true, false, true, false, true],
      expert: [true, true, true, true, true]
    }[difficulty];

    goalIds.forEach(function (gid, i) {
      var slot = slotByPos(state, 5, i + 1);
      var goal = {
        id: gid,
        color: GOALS[gid].color,
        faceUp: reveal[i],
        slotId: slot.id
      };
      slot.goalId = gid;
      state.board.goals.push(goal);
    });

    state.draw = shuffle(state, Object.keys(CARDS));
    for (var h = 0; h < 4; h++) state.hand.push(state.draw.pop());
    sortHand(state);
    for (var s = 0; s < 3; s++) state.supply.push(state.draw.pop());

    var itemPool = shuffle(state, ITEM_POOL);
    for (var i = 0; i < 3; i++) {
      state.items.push({ id: 'item-' + (i + 1), type: itemPool[i], used: false });
    }

    return state;
  }

  function placeCard(state, cardId, slotId) {
    if (state.phase !== 'place') return fail('phase', '当前不能放置卡牌');
    if (state.hand.indexOf(cardId) < 0) return fail('hand', '手牌中没有这张卡牌');
    var check = canPlace(state, cardId, slotId);
    if (!check.ok) return check;

    var next = clone(state);
    removeFromHand(next, cardId);
    slotById(next, slotId).cardId = cardId;

    next.lastAction = {
      type: 'place',
      cardId: cardId,
      slotId: slotId,
      turn: next.turn,
      newRoute: check.newRoute
    };
    next.log.push({
      turn: next.turn,
      type: 'place',
      cardId: cardId,
      slotId: slotId,
      newRoute: check.newRoute
    });

    if (isFull(next)) {
      next.phase = 'won';
      next.pendingInuit = null;
      next.log.push({ turn: next.turn, type: 'won' });
      return { ok: true, state: next };
    }

    next.pendingInuit = { placedSlotId: slotId, cardId: cardId };
    if (inuitOptions(next).length > 0) {
      next.phase = 'afterPlace';
    } else {
      toRefillOrNext(next);
    }
    return { ok: true, state: next };
  }

  function skipInuit(state) {
    if (state.phase !== 'afterPlace') return fail('phase', '当前没有因纽特智慧的追加放置');
    var next = clone(state);
    next.log.push({ turn: next.turn, type: 'skip-inuit' });
    toRefillOrNext(next);
    return { ok: true, state: next };
  }

  function useInuit(state, cardId, slotId) {
    if (state.phase !== 'afterPlace') return fail('phase', '当前不能使用因纽特智慧');
    if (!state.pendingInuit) return fail('phase', '没有刚放置的卡牌');
    if (!hasUnusedItem(state, 'inuit')) return fail('item', '因纽特智慧已用完');
    var placedSlot = slotById(state, state.pendingInuit.placedSlotId);
    if (!placedSlot || !placedSlot.cardId) return fail('state', '刚放置的卡牌不存在');
    var placedCard = CARDS[placedSlot.cardId];
    var card = CARDS[cardId];
    if (!card) return fail('card', '卡牌不存在');
    if (state.hand.indexOf(cardId) < 0) return fail('hand', '手牌中没有这张卡牌');
    if (card.number !== placedCard.number) return fail('pair', '必须使用与刚放置卡牌相同数字的手牌');
    var target = slotById(state, slotId);
    if (!target || target.row !== placedSlot.row || Math.abs(target.index - placedSlot.index) !== 1) {
      return fail('adjacent', '必须放在刚放置卡牌同一行的左右相邻空位');
    }
    var check = canPlace(state, cardId, slotId, { inuitPairWith: placedSlot.id });
    if (!check.ok) return check;

    var next = clone(state);
    removeFromHand(next, cardId);
    slotById(next, slotId).cardId = cardId;
    markItemUsed(next, 'inuit');
    next.log.push({
      turn: next.turn,
      type: 'inuit',
      cardId: cardId,
      slotId: slotId,
      pairSlotId: placedSlot.id
    });
    next.lastAction = { type: 'inuit', cardId: cardId, slotId: slotId, turn: next.turn };

    if (isFull(next)) {
      next.phase = 'won';
      next.pendingInuit = null;
      next.log.push({ turn: next.turn, type: 'won' });
      return { ok: true, state: next };
    }

    toRefillOrNext(next);
    return { ok: true, state: next };
  }

  function chooseSupply(state, cardId) {
    if (state.phase !== 'refill') return fail('phase', '当前不是补充手牌阶段');
    var i = state.supply.indexOf(cardId);
    if (i < 0) return fail('supply', '供应堆中没有这张卡牌');
    var next = clone(state);
    next.supply.splice(i, 1);
    next.hand.push(cardId);
    sortHand(next);
    if (next.draw.length > 0) next.supply.push(next.draw.pop());
    next.log.push({ turn: next.turn, type: 'refill', cardId: cardId });
    next.lastAction = { type: 'refill', cardId: cardId, turn: next.turn };
    startNextTurn(next);
    return { ok: true, state: next };
  }

  function useSled(state, handCardId, supplyCardId) {
    if (state.phase !== 'place' && state.phase !== 'stuck') {
      return fail('phase', '当前不能使用狗拉雪橇');
    }
    if (!hasUnusedItem(state, 'sled')) return fail('item', '狗拉雪橇已用完');
    if (state.hand.indexOf(handCardId) < 0) return fail('hand', '手牌中没有这张卡牌');
    if (state.supply.indexOf(supplyCardId) < 0) return fail('supply', '供应堆中没有这张卡牌');

    var next = clone(state);
    removeFromHand(next, handCardId);
    var si = next.supply.indexOf(supplyCardId);
    next.supply.splice(si, 1);
    next.hand.push(supplyCardId);
    sortHand(next);
    if (next.draw.length > 0) next.supply.push(next.draw.pop());
    next.draw.unshift(handCardId);
    markItemUsed(next, 'sled');
    next.log.push({
      turn: next.turn,
      type: 'sled',
      handCardId: handCardId,
      supplyCardId: supplyCardId
    });
    next.lastAction = { type: 'sled', handCardId: handCardId, supplyCardId: supplyCardId, turn: next.turn };

    if (next.phase === 'stuck' && hasAnyLegalPlacement(next)) next.phase = 'place';
    return { ok: true, state: next };
  }

  function useLog(state, slotId, handCardId) {
    if (state.phase !== 'place' && state.phase !== 'stuck') {
      return fail('phase', '当前不能使用航海日志');
    }
    if (!hasUnusedItem(state, 'log')) return fail('item', '航海日志已用完');
    var slot = slotById(state, slotId);
    if (!slot || !slot.cardId) return fail('slot', '请选择一张已放置的卡牌');
    if (state.hand.indexOf(handCardId) < 0) return fail('hand', '手牌中没有这张卡牌');
    var check = canPlace(state, handCardId, slotId, {
      ignoreOccupied: true,
      requireUpperColor: true
    });
    if (!check.ok) return check;

    var next = clone(state);
    var target = slotById(next, slotId);
    var outCardId = target.cardId;
    target.cardId = handCardId;
    removeFromHand(next, handCardId);
    next.hand.push(outCardId);
    sortHand(next);
    markItemUsed(next, 'log');
    next.log.push({
      turn: next.turn,
      type: 'log',
      slotId: slotId,
      inCardId: handCardId,
      outCardId: outCardId
    });
    next.lastAction = {
      type: 'log',
      slotId: slotId,
      inCardId: handCardId,
      outCardId: outCardId,
      turn: next.turn
    };

    if (next.phase === 'stuck' && hasAnyLegalPlacement(next)) next.phase = 'place';
    return { ok: true, state: next };
  }

  function declareLoss(state) {
    if (state.phase !== 'stuck') return fail('phase', '当前不能宣告失败');
    var next = clone(state);
    next.phase = 'lost';
    next.lossReason = 'declared';
    next.log.push({ turn: next.turn, type: 'lost' });
    return { ok: true, state: next };
  }

  /* ---------------- 序列化 ---------------- */

  function serialize(state) {
    return JSON.stringify(state);
  }

  function deserialize(json) {
    try {
      var s = typeof json === 'string' ? JSON.parse(json) : json;
      if (!s || s.version !== VERSION || !s.board || !Array.isArray(s.board.slots)) return null;
      if (s.board.slots.length !== 15 || !Array.isArray(s.hand)) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map(stableStringify).join(',') + ']';
    }
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(value[k]);
    }).join(',') + '}';
  }

  function stateHash(state) {
    var str = stableStringify(state);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  return {
    VERSION: VERSION,
    COLORS: COLORS,
    COLOR_NAME: COLOR_NAME,
    COLOR_EN: COLOR_EN,
    CARDS: CARDS,
    GOALS: GOALS,
    DIFFICULTIES: DIFFICULTIES,
    ITEM_TYPES: ITEM_TYPES,
    ITEM_NAME: ITEM_NAME,
    ITEM_DESC: ITEM_DESC,
    createGame: createGame,
    canPlace: canPlace,
    legalPlacements: legalPlacements,
    hasAnyLegalPlacement: hasAnyLegalPlacement,
    inuitOptions: inuitOptions,
    logOptions: logOptions,
    canUseSled: canUseSled,
    canUseLog: canUseLog,
    analyzeRoutes: analyzeRoutes,
    placeCard: placeCard,
    skipInuit: skipInuit,
    useInuit: useInuit,
    chooseSupply: chooseSupply,
    useSled: useSled,
    useLog: useLog,
    declareLoss: declareLoss,
    getCard: getCard,
    slotById: slotById,
    slotByPos: slotByPos,
    supportSlots: supportSlots,
    upperSlots: upperSlots,
    nearestOccupiedInRow: nearestOccupiedInRow,
    hasUnusedItem: hasUnusedItem,
    isFull: isFull,
    serialize: serialize,
    deserialize: deserialize,
    stateHash: stateHash
  };
});
