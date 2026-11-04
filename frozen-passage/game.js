/* 流冰航路 The Frozen Passage — 纯规则引擎（无 DOM，可在浏览器与 Node 中运行） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrozenPassage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 2;
  var COLORS = ['blue', 'red', 'black'];
  var COLOR_NAME = { blue: '蓝', red: '红', black: '黑' };
  var COLOR_EN = { blue: 'Blue', red: 'Red', black: 'Black' };
  var DIFFICULTIES = ['novice', 'medium', 'expert'];
  /* 联机使用 12 张物品卡（6 类各 2 张）中随机抽 3 张；单人物品池只从 inuit / sled / log 中抽 3 个 */
  var ITEM_TYPES = ['inuit', 'sled', 'log', 'radio', 'lifeboat', 'canned'];
  var ITEM_POOL = ['inuit', 'inuit', 'sled', 'sled', 'log', 'log'];
  var ONLINE_ITEM_POOL = [
    'inuit', 'inuit', 'sled', 'sled', 'log', 'log',
    'radio', 'radio', 'lifeboat', 'lifeboat', 'canned', 'canned'
  ];
  var ITEM_NAME = {
    inuit: '因纽特智慧',
    sled: '狗拉雪橇',
    log: '航海日志',
    radio: '无线电广播',
    lifeboat: '救生艇',
    canned: '罐头食品'
  };
  var ITEM_DESC = {
    inuit: '本回合放置时，你可以在已放置的卡牌旁边放置数字相同的卡牌',
    sled: '将一张手牌放回抽牌堆底部，再从供应堆取一张',
    log: '用一张手牌替换一张已放置的卡牌',
    radio: '补牌时改为从另一位玩家处取走一张牌，该玩家随后从供应堆补一张',
    lifeboat: '每位玩家同时将一张手牌传给左手边的玩家',
    canned: '跳过你的这个回合，不放置也不补牌'
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

  /* 种子随机数：推进 rng 并返回 [0,1) */
  function nextFloat(state) {
    var t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
    var r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  /* 用种子随机数洗牌，返回新数组 */
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

  /* 深拷贝对局状态，规则函数统一返回新状态 */
  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  /* 按 id 查找棋盘位置 */
  function slotById(state, id) {
    for (var i = 0; i < state.board.slots.length; i++) {
      if (state.board.slots[i].id === id) return state.board.slots[i];
    }
    return null;
  }

  /* 按行、列查找棋盘位置 */
  function slotByPos(state, row, index) {
    return slotById(state, 'r' + row + '-' + index);
  }

  /* 按 id 取卡牌定义 */
  function getCard(cardId) {
    return CARDS[cardId] || null;
  }

  /* 查某个位置上的目标卡 */
  function goalForSlot(state, slot) {
    for (var i = 0; i < state.board.goals.length; i++) {
      if (state.board.goals[i].slotId === slot.id) return state.board.goals[i];
    }
    return null;
  }

  /* 该位置下方提供支撑的 1~2 个位置 */
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

  /* 同行最近的已放置卡牌；dir 为 -1 向左、1 向右 */
  function nearestOccupiedInRow(state, row, index, dir) {
    for (var i = index + dir; i >= 1 && i <= row; i += dir) {
      var slot = slotByPos(state, row, i);
      if (slot && slot.cardId) return slot;
    }
    return null;
  }

  /* 某类物品是否还有未使用的 */
  function hasUnusedItem(state, type) {
    return state.items.some(function (it) { return it.type === type && !it.used; });
  }

  /* 把一张该类物品标记为已使用 */
  function markItemUsed(state, type) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].type === type && !state.items[i].used) {
        state.items[i].used = true;
        return state.items[i];
      }
    }
    return null;
  }

  /* 15 个位置是否已经放满 */
  function isFull(state) {
    return state.board.slots.every(function (s) { return !!s.cardId; });
  }

  /* 一组手牌按数字、再按颜色排序（就地排序并返回） */
  function sortCards(list) {
    list.sort(function (a, b) {
      var ca = CARDS[a], cb = CARDS[b];
      if (ca.number !== cb.number) return ca.number - cb.number;
      return COLORS.indexOf(ca.color) - COLORS.indexOf(cb.color);
    });
    return list;
  }

  /* 手牌按数字、再按颜色排序 */
  function sortHand(state) {
    sortCards(state.hand);
  }

  /* 从手牌移除一张卡 */
  function removeFromHand(state, cardId) {
    var i = state.hand.indexOf(cardId);
    if (i >= 0) state.hand.splice(i, 1);
  }

  /* ---------------- 联机通用 ---------------- */

  /* 是否联机状态 */
  function isOnline(state) {
    return !!state && state.mode === 'online';
  }

  /* 按座位取玩家对象 */
  function playerAt(state, seat) {
    if (!isOnline(state) || !Array.isArray(state.players)) return null;
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].seat === seat) return state.players[i];
    }
    return null;
  }

  /* 当前玩家手牌写到 players[currentSeat]（state.hand 是工作副本） */
  function syncHandToPlayer(state) {
    if (!isOnline(state)) return;
    var p = playerAt(state, state.currentSeat);
    if (p) p.hand = state.hand.slice();
  }

  /* players[currentSeat] 写回 state.hand 镜像 */
  function syncHandFromPlayer(state) {
    if (!isOnline(state)) return;
    var p = playerAt(state, state.currentSeat);
    state.hand = p ? p.hand.slice() : [];
  }

  /* 联机每次成功状态变更 rev +1 */
  function bump(state) {
    if (isOnline(state)) state.rev = (state.rev || 0) + 1;
    return state;
  }

  /* 操作者信息：联机日志/提示需要“谁做了什么” */
  function actorMeta(state, seat) {
    if (!isOnline(state)) return {};
    var s = seat == null ? state.currentSeat : seat;
    var p = playerAt(state, s);
    return { seat: s, name: p ? p.name : '' };
  }

  /* 写入操作日志，联机时附带座位与昵称 */
  function pushLog(state, entry, seat) {
    var meta = actorMeta(state, seat);
    if (meta.seat != null) {
      if (entry.seat == null) entry.seat = meta.seat;
      if (entry.name == null) entry.name = meta.name;
    }
    state.log.push(entry);
    return entry;
  }

  /* 生成最近操作提示，联机时附带座位与昵称 */
  function setLastAction(state, action, seat) {
    var meta = actorMeta(state, seat);
    if (meta.seat != null) {
      if (action.seat == null) action.seat = meta.seat;
      if (action.name == null) action.name = meta.name;
    }
    state.lastAction = action;
    return action;
  }

  /* 全员是否都已为救生艇选牌 */
  function allLifeboatPicked(state) {
    if (!state.pending || state.pending.type !== 'lifeboat') return false;
    var picks = state.pending.picks || {};
    for (var i = 0; i < state.players.length; i++) {
      if (!picks[state.players[i].seat]) return false;
    }
    return true;
  }

  /*
   * 救生艇结算：每人选中的牌同时传给左手边 (seat + 1) % N，
   * 即座位 s 收到座位 (s - 1 + N) % N 的牌。只改手牌与阶段，不做权限判定。
   */
  function applyLifeboatTransfer(state) {
    var n = state.players.length;
    var picks = state.pending.picks;
    var nextHands = state.players.map(function (p) {
      var incoming = picks[(p.seat - 1 + n) % n];
      var outgoing = picks[p.seat];
      var hand = p.hand.filter(function (c) { return c !== outgoing; });
      if (incoming) hand.push(incoming);
      return sortCards(hand);
    });
    state.players.forEach(function (p, i) { p.hand = nextHands[i]; });
    state.pending = null;
    state.activeSeat = state.currentSeat;
    syncHandFromPlayer(state);
    state.phase = hasAnyLegalPlacement(state) ? 'place' : 'stuck';
    if (state.phase === 'stuck') state.lossHint = true;
    return state;
  }

  /* 联机回合结束：座位轮转、turn +1，再按新玩家手牌判定阶段 */
  function finishOnlineTurn(state) {
    state.turn += 1;
    state.wisdom = false;
    state.pending = null;
    if (state.players.length > 0) {
      state.currentSeat = (state.currentSeat + 1) % state.players.length;
    }
    state.activeSeat = state.currentSeat;
    syncHandFromPlayer(state);
    if (state.hand.length === 0) {
      state.phase = 'lost';
      state.lossReason = 'no-hand';
      pushLog(state, { turn: state.turn, type: 'lost', reason: 'no-hand' });
      return;
    }
    state.phase = hasAnyLegalPlacement(state) ? 'place' : 'stuck';
    if (state.phase === 'stuck') state.lossHint = true;
  }

  /* 指定座位的手牌（返回副本；单人只有座位 0 有手牌） */
  function handForSeat(state, seat) {
    if (!isOnline(state)) {
      return (seat == null || seat === 0) ? state.hand.slice() : [];
    }
    var p = playerAt(state, seat);
    return p ? p.hand.slice() : [];
  }

  /*
   * 统一操作权判定：
   * - 普通阶段只有 currentSeat；
   * - 无线电补牌阶段只有 pending.toSeat；
   * - 救生艇阶段任何合法座位都可以修改自己的选择；
   * - 终局 false。
   */
  function canSeatAct(state, seat) {
    if (!state) return false;
    if (state.phase === 'won' || state.phase === 'lost') return false;
    if (!isOnline(state)) return seat == null || seat === 0;
    if (state.phase === 'lifeboat' || (state.pending && state.pending.type === 'lifeboat')) {
      return typeof seat === 'number' && seat >= 0 && seat < state.players.length;
    }
    if (state.pending && state.pending.type === 'radio') {
      return seat === state.pending.toSeat;
    }
    return seat === state.currentSeat;
  }

  /* 当前真正的操作者座位；救生艇阶段为 -1（全员可操作） */
  function actorSeat(state) {
    if (!state) return -1;
    if (!isOnline(state)) return 0;
    if (state.pending && state.pending.type === 'radio') return state.pending.toSeat;
    if (state.phase === 'lifeboat') return -1;
    return state.currentSeat;
  }

  /* ---------------- 放置判定 ---------------- */

  /* 核心判定：卡牌能否放到指定位置，返回结果与失败原因 */
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

    /*
     * 因纽特智慧：本回合的这次放置，可以在同行已放置卡牌的紧邻位置
     * 放下相同数字的牌。隔空的同数字不算“旁边”，仍按严格递增判定，
     * 否则中间空位会永远无法填入。航海日志换牌不享受该放宽。
     */
    var wisdom = opts.wisdom != null ? !!opts.wisdom : !!state.wisdom;

    if (leftCard) {
      var leftSame = wisdom && left.index === slot.index - 1 && card.number === leftCard.number;
      if (!leftSame && card.number <= leftCard.number) {
        return {
          ok: false,
          code: 'number-left',
          message: wisdom
            ? '需大于同行左侧卡牌，或与紧邻的卡牌同数字'
            : '需大于同行左侧最近的卡牌'
        };
      }
    }

    if (rightCard) {
      var rightSame = wisdom && right.index === slot.index + 1 && card.number === rightCard.number;
      if (!rightSame && card.number >= rightCard.number) {
        return {
          ok: false,
          code: 'number-right',
          message: wisdom
            ? '需小于同行右侧卡牌，或与紧邻的卡牌同数字'
            : '需小于同行右侧最近的卡牌'
        };
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

  /* 列出某张手牌的全部合法落点 */
  function legalPlacements(state, cardId, opts) {
    var out = [];
    state.board.slots.forEach(function (slot) {
      var r = canPlace(state, cardId, slot.id, opts);
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

  /* 手牌中是否还存在任意合法落点 */
  function hasAnyLegalPlacement(state) {
    for (var i = 0; i < state.hand.length; i++) {
      if (legalPlacements(state, state.hand[i]).length > 0) return true;
    }
    return false;
  }

  /* ---------------- 物品选项 ---------------- */

  /* 使用因纽特智慧后才会变为合法的落点（依赖紧邻同数字） */
  function inuitPlacements(state) {
    var out = [];
    if (!hasUnusedItem(state, 'inuit')) return out;
    state.hand.forEach(function (cardId) {
      legalPlacements(state, cardId, { wisdom: true }).forEach(function (p) {
        if (canPlace(state, cardId, p.slotId, { wisdom: false }).ok) return;
        out.push({
          cardId: cardId,
          slotId: p.slotId,
          row: p.row,
          index: p.index,
          colorMatches: p.colorMatches,
          newRoute: p.newRoute
        });
      });
    });
    return out;
  }

  /* 当前能否使用因纽特智慧 */
  function canUseInuit(state) {
    return (state.phase === 'place' || state.phase === 'stuck') &&
      !state.wisdom && hasUnusedItem(state, 'inuit') &&
      inuitPlacements(state).length > 0;
  }

  /* 航海日志可用的「替换位置 × 手牌」组合 */
  function logOptions(state) {
    var out = [];
    if (state.hand.length === 0) return out;
    state.board.slots.forEach(function (slot) {
      if (!slot.cardId) return;
      state.hand.forEach(function (cardId) {
        var r = canPlace(state, cardId, slot.id, {
          ignoreOccupied: true,
          requireUpperColor: true,
          wisdom: false
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

  /* 当前能否使用狗拉雪橇 */
  function canUseSled(state) {
    return (state.phase === 'place' || state.phase === 'stuck') &&
      hasUnusedItem(state, 'sled') && state.hand.length > 0 && state.supply.length > 0;
  }

  /* 当前能否使用航海日志 */
  function canUseLog(state) {
    return (state.phase === 'place' || state.phase === 'stuck') &&
      hasUnusedItem(state, 'log') && logOptions(state).length > 0;
  }

  /* ---------------- 航线分析（提示用，不参与胜负） ---------------- */

  /* 按同色相连把已放置卡牌归并为航线（仅用于提示与调试） */
  function analyzeRoutes(state) {
    var placed = [];
    state.board.slots.forEach(function (s) {
      if (s.cardId) placed.push(s);
    });
    var parent = {};
    placed.forEach(function (s) { parent[s.id] = s.id; });
    /* 并查集：找根节点 */
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    /* 并查集：合并两个集合 */
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

  /* 统一的失败返回结构 */
  function fail(code, message) {
    return { ok: false, code: code, message: message };
  }

  /* 放置后进入补牌；供应堆为空则直接进入下一回合 */
  function toRefillOrNext(state) {
    if (state.supply.length > 0) {
      state.phase = 'refill';
    } else if (isOnline(state)) {
      finishOnlineTurn(state);
    } else {
      startNextTurn(state);
    }
  }

  /* 回合结束：单人原地续局，联机交给下一位座位 */
  function endTurn(state) {
    if (isOnline(state)) finishOnlineTurn(state);
    else startNextTurn(state);
  }

  /* 回合数 +1，并根据手牌判断新阶段 */
  function startNextTurn(state) {
    state.turn += 1;
    state.wisdom = false;
    if (state.hand.length === 0) {
      state.phase = 'lost';
      state.lossReason = 'no-hand';
      return;
    }
    state.phase = hasAnyLegalPlacement(state) ? 'place' : 'stuck';
    if (state.phase === 'stuck') state.lossHint = true;
  }

  /* 构建基础状态：棋盘、目标卡（单人/联机共用，随机顺序一致） */
  function createBaseState(seed, mode, difficulty) {
    var state = {
      version: VERSION,
      seed: seed,
      rng: seed,
      mode: mode,
      difficulty: difficulty,
      phase: 'place',
      turn: 1,
      board: { slots: [], goals: [], starter: { slotId: 'r1-1' } },
      hand: [],
      supply: [],
      draw: [],
      items: [],
      wisdom: false,
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

    return state;
  }

  /* 开新局：发目标卡、手牌、供应堆与物品 */
  function createGame(opts) {
    opts = opts || {};
    var difficulty = opts.difficulty || 'novice';
    if (DIFFICULTIES.indexOf(difficulty) < 0) throw new Error('未知难度: ' + difficulty);
    var seed = (opts.seed == null ? Date.now() : opts.seed) >>> 0;

    var state = createBaseState(seed, 'solo', difficulty);

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

  /*
   * 联机开局：2~4 人，轮流发牌（2 人各 4 张，3/4 人各 3 张），
   * 供应堆 3 张，其余进抽牌堆；先手由种子 PRNG 随机决定并写入日志。
   */
  function createOnlineGame(opts) {
    opts = opts || {};
    var difficulty = opts.difficulty || 'novice';
    if (DIFFICULTIES.indexOf(difficulty) < 0) throw new Error('未知难度: ' + difficulty);
    var names = Array.isArray(opts.names) ? opts.names.slice() : [];
    if (names.length < 2 || names.length > 4) {
      throw new Error('联机模式需要 2~4 位玩家');
    }
    var seed = (opts.seed == null ? Date.now() : opts.seed) >>> 0;
    var n = names.length;
    var handLimit = n === 2 ? 4 : 3;

    var state = createBaseState(seed, 'online', difficulty);
    state.players = names.map(function (name, seat) {
      return {
        seat: seat,
        name: String(name == null || name === '' ? '玩家' + (seat + 1) : name),
        hand: []
      };
    });
    state.currentSeat = 0;
    state.activeSeat = 0;
    state.handLimit = handLimit;
    state.rev = 0;
    state.pending = null;

    state.draw = shuffle(state, Object.keys(CARDS));
    for (var round = 0; round < handLimit; round++) {
      for (var s = 0; s < n; s++) state.players[s].hand.push(state.draw.pop());
    }
    state.players.forEach(function (p) { sortCards(p.hand); });
    for (var k = 0; k < 3; k++) state.supply.push(state.draw.pop());

    var itemPool = shuffle(state, ONLINE_ITEM_POOL);
    for (var i = 0; i < 3; i++) {
      state.items.push({ id: 'item-' + (i + 1), type: itemPool[i], used: false });
    }

    state.currentSeat = Math.floor(nextFloat(state) * n) % n;
    state.activeSeat = state.currentSeat;
    state.hand = state.players[state.currentSeat].hand.slice();

    var meta = actorMeta(state, state.currentSeat);
    state.log.push({ turn: 1, type: 'start', seat: meta.seat, name: meta.name });
    state.lastAction = { type: 'start', turn: 1, seat: meta.seat, name: meta.name };

    return state;
  }

  /* 放置一张手牌，并推进胜负与补牌流程 */
  function placeCard(state, cardId, slotId) {
    if (state.phase !== 'place') return fail('phase', '当前不能放置卡牌');
    if (isOnline(state) && !canSeatAct(state, actorSeat(state))) {
      return fail('seat', '还没轮到你放置卡牌');
    }
    if (state.hand.indexOf(cardId) < 0) return fail('hand', '手牌中没有这张卡牌');
    var check = canPlace(state, cardId, slotId);
    if (!check.ok) return check;

    var usedWisdom = !!state.wisdom;
    var next = clone(state);
    var meta = actorMeta(next);
    removeFromHand(next, cardId);
    slotById(next, slotId).cardId = cardId;
    next.wisdom = false;
    syncHandToPlayer(next);
    bump(next);

    setLastAction(next, {
      type: 'place',
      cardId: cardId,
      slotId: slotId,
      turn: next.turn,
      newRoute: check.newRoute,
      wisdom: usedWisdom
    }, meta.seat);
    pushLog(next, {
      turn: next.turn,
      type: 'place',
      cardId: cardId,
      slotId: slotId,
      newRoute: check.newRoute,
      wisdom: usedWisdom
    }, meta.seat);

    if (isFull(next)) {
      next.phase = 'won';
      pushLog(next, { turn: next.turn, type: 'won' }, meta.seat);
      return { ok: true, state: next };
    }

    toRefillOrNext(next);
    return { ok: true, state: next };
  }

  /* 使用因纽特智慧：本回合允许紧邻同数字 */
  function useInuit(state) {
    if (state.phase !== 'place' && state.phase !== 'stuck') {
      return fail('phase', '因纽特智慧要在本回合放置前使用');
    }
    if (isOnline(state) && !canSeatAct(state, actorSeat(state))) {
      return fail('seat', '还没轮到你使用物品');
    }
    if (state.wisdom) return fail('item', '本回合已经使用了因纽特智慧');
    if (!hasUnusedItem(state, 'inuit')) return fail('item', '因纽特智慧已用完');
    if (inuitPlacements(state).length === 0) {
      return fail('target', '当前没有可与紧邻卡牌同数字的落点');
    }

    var next = clone(state);
    var meta = actorMeta(next);
    markItemUsed(next, 'inuit');
    next.wisdom = true;
    pushLog(next, { turn: next.turn, type: 'inuit' }, meta.seat);
    setLastAction(next, { type: 'inuit', turn: next.turn }, meta.seat);
    if (next.phase === 'stuck') next.phase = 'place';
    bump(next);
    return { ok: true, state: next };
  }

  /* 补牌阶段从供应堆取一张，然后开始下一回合 */
  function chooseSupply(state, cardId) {
    if (state.phase !== 'refill') return fail('phase', '当前不是补充手牌阶段');
    if (isOnline(state) && !canSeatAct(state, actorSeat(state))) {
      return fail('seat', '还没轮到你补牌');
    }
    var i = state.supply.indexOf(cardId);
    if (i < 0) return fail('supply', '供应堆中没有这张卡牌');
    var next = clone(state);
    var meta = actorMeta(next);
    next.supply.splice(i, 1);
    next.hand.push(cardId);
    sortHand(next);
    if (next.draw.length > 0) next.supply.push(next.draw.pop());
    syncHandToPlayer(next);
    /* 联机补牌只公开颜色：其他玩家不应从日志得知摸到了什么数字 */
    pushLog(next, isOnline(next)
      ? { turn: next.turn, type: 'refill', color: CARDS[cardId].color }
      : { turn: next.turn, type: 'refill', cardId: cardId }, meta.seat);
    setLastAction(next, { type: 'refill', cardId: cardId, turn: next.turn }, meta.seat);
    bump(next);
    endTurn(next);
    return { ok: true, state: next };
  }

  /* 狗拉雪橇：手牌与供应堆互换一张 */
  function useSled(state, handCardId, supplyCardId) {
    if (state.phase !== 'place' && state.phase !== 'stuck') {
      return fail('phase', '当前不能使用狗拉雪橇');
    }
    if (isOnline(state) && !canSeatAct(state, actorSeat(state))) {
      return fail('seat', '还没轮到你使用物品');
    }
    if (!hasUnusedItem(state, 'sled')) return fail('item', '狗拉雪橇已用完');
    if (state.hand.indexOf(handCardId) < 0) return fail('hand', '手牌中没有这张卡牌');
    if (state.supply.indexOf(supplyCardId) < 0) return fail('supply', '供应堆中没有这张卡牌');

    var next = clone(state);
    var meta = actorMeta(next);
    removeFromHand(next, handCardId);
    var si = next.supply.indexOf(supplyCardId);
    next.supply.splice(si, 1);
    next.hand.push(supplyCardId);
    sortHand(next);
    if (next.draw.length > 0) next.supply.push(next.draw.pop());
    next.draw.unshift(handCardId);
    markItemUsed(next, 'sled');
    syncHandToPlayer(next);
    /* 联机日志只公开颜色：换回牌堆的手牌与摸走的供应堆牌都不应泄露数字 */
    pushLog(next, isOnline(next)
      ? {
          turn: next.turn,
          type: 'sled',
          handColor: CARDS[handCardId].color,
          supplyColor: CARDS[supplyCardId].color
        }
      : {
          turn: next.turn,
          type: 'sled',
          handCardId: handCardId,
          supplyCardId: supplyCardId
        }, meta.seat);
    setLastAction(next, {
      type: 'sled',
      handCardId: handCardId,
      supplyCardId: supplyCardId,
      turn: next.turn
    }, meta.seat);

    if (next.phase === 'stuck' && hasAnyLegalPlacement(next)) next.phase = 'place';
    bump(next);
    return { ok: true, state: next };
  }

  /* 航海日志：用手牌替换一张已放置的卡牌 */
  function useLog(state, slotId, handCardId) {
    if (state.phase !== 'place' && state.phase !== 'stuck') {
      return fail('phase', '当前不能使用航海日志');
    }
    if (isOnline(state) && !canSeatAct(state, actorSeat(state))) {
      return fail('seat', '还没轮到你使用物品');
    }
    if (!hasUnusedItem(state, 'log')) return fail('item', '航海日志已用完');
    var slot = slotById(state, slotId);
    if (!slot || !slot.cardId) return fail('slot', '请选择一张已放置的卡牌');
    if (state.hand.indexOf(handCardId) < 0) return fail('hand', '手牌中没有这张卡牌');
    var check = canPlace(state, handCardId, slotId, {
      ignoreOccupied: true,
      requireUpperColor: true,
      wisdom: false
    });
    if (!check.ok) return check;

    var next = clone(state);
    var meta = actorMeta(next);
    var target = slotById(next, slotId);
    var outCardId = target.cardId;
    target.cardId = handCardId;
    removeFromHand(next, handCardId);
    next.hand.push(outCardId);
    sortHand(next);
    markItemUsed(next, 'log');
    syncHandToPlayer(next);
    pushLog(next, {
      turn: next.turn,
      type: 'log',
      slotId: slotId,
      inCardId: handCardId,
      outCardId: outCardId
    }, meta.seat);
    setLastAction(next, {
      type: 'log',
      slotId: slotId,
      inCardId: handCardId,
      outCardId: outCardId,
      turn: next.turn
    }, meta.seat);

    if (next.phase === 'stuck' && hasAnyLegalPlacement(next)) next.phase = 'place';
    bump(next);
    return { ok: true, state: next };
  }

  /* 卡住时主动宣告失败（联机只有当前玩家可以宣告） */
  function declareLoss(state, seat) {
    if (state.phase !== 'stuck') return fail('phase', '当前不能宣告失败');
    if (isOnline(state) && seat != null && seat !== state.currentSeat) {
      return fail('seat', '只有当前玩家可以宣告失败');
    }
    var next = clone(state);
    var meta = actorMeta(next);
    next.phase = 'lost';
    next.lossReason = 'declared';
    pushLog(next, { turn: next.turn, type: 'lost' }, meta.seat);
    bump(next);
    return { ok: true, state: next };
  }

  /* ---------------- 联机专属物品 ---------------- */

  /* 无线电广播：仅在补牌阶段，且供应堆非空、有手牌非空的队友 */
  function canUseRadio(state) {
    if (!isOnline(state) || state.phase !== 'refill') return false;
    if (!canSeatAct(state, state.currentSeat)) return false;
    if (!hasUnusedItem(state, 'radio')) return false;
    if (state.supply.length === 0) return false;
    return state.players.some(function (p) {
      return p.seat !== state.currentSeat && p.hand.length > 0;
    });
  }

  /*
   * 无线电广播：当前玩家从目标玩家手牌中自选 1 张移入自己手牌，
   * 随后由目标玩家从供应堆补 1 张，再结束当前玩家的回合。
   */
  function useRadio(state, toSeat, cardId) {
    if (!isOnline(state)) return fail('mode', '无线电广播只在联机模式可用');
    if (state.phase !== 'refill') return fail('phase', '无线电广播要在补牌阶段使用');
    if (!canSeatAct(state, state.currentSeat)) return fail('seat', '还没轮到你使用物品');
    if (!hasUnusedItem(state, 'radio')) return fail('item', '无线电广播已用完');
    if (state.supply.length === 0) return fail('supply', '供应堆为空，无法使用无线电广播');
    var target = playerAt(state, toSeat);
    if (!target) return fail('seat', '目标玩家不存在');
    if (toSeat === state.currentSeat) return fail('seat', '请选择另一位玩家');
    if (target.hand.length === 0) return fail('hand', '目标玩家没有手牌');
    if (target.hand.indexOf(cardId) < 0) return fail('card', '目标玩家手牌中没有这张卡牌');

    var next = clone(state);
    var meta = actorMeta(next);
    var t = playerAt(next, toSeat);
    var ti = t.hand.indexOf(cardId);
    t.hand.splice(ti, 1);
    next.hand.push(cardId);
    sortHand(next);
    syncHandToPlayer(next);
    markItemUsed(next, 'radio');
    next.phase = 'radio';
    next.pending = {
      type: 'radio',
      fromSeat: next.currentSeat,
      toSeat: toSeat,
      cardId: cardId,
      stage: 'supply'
    };
    next.activeSeat = toSeat;
    pushLog(next, {
      turn: next.turn,
      type: 'radio',
      fromSeat: next.currentSeat,
      toSeat: toSeat,
      toName: t.name,
      color: CARDS[cardId].color
    }, meta.seat);
    setLastAction(next, {
      type: 'radio',
      fromSeat: next.currentSeat,
      toSeat: toSeat,
      toName: t.name,
      cardId: cardId,
      turn: next.turn
    }, meta.seat);
    bump(next);
    return { ok: true, state: next };
  }

  /* 无线电广播：被取牌的玩家从供应堆补 1 张，然后当前玩家回合结束 */
  function chooseRadioSupply(state, seat, cardId) {
    if (!isOnline(state)) return fail('mode', '无线电广播只在联机模式可用');
    if (state.phase !== 'radio' || !state.pending || state.pending.type !== 'radio') {
      return fail('phase', '当前没有等待无线电补牌');
    }
    if (seat !== state.pending.toSeat) {
      return fail('seat', '只有被广播的玩家可以补牌');
    }
    var pending = state.pending;
    if (state.supply.indexOf(cardId) < 0) return fail('supply', '供应堆中没有这张卡牌');

    var next = clone(state);
    var p = playerAt(next, pending.toSeat);
    var meta = actorMeta(next, pending.toSeat);
    next.supply.splice(next.supply.indexOf(cardId), 1);
    p.hand.push(cardId);
    sortCards(p.hand);
    if (next.draw.length > 0) next.supply.push(next.draw.pop());
    pushLog(next, {
      turn: next.turn,
      type: 'radio-refill',
      fromSeat: pending.fromSeat,
      toSeat: pending.toSeat,
      color: CARDS[cardId].color
    }, meta.seat);
    setLastAction(next, {
      type: 'radio-refill',
      fromSeat: pending.fromSeat,
      toSeat: pending.toSeat,
      cardId: cardId,
      turn: next.turn
    }, meta.seat);
    next.pending = null;
    next.phase = 'refill';
    bump(next);
    endTurn(next);
    return { ok: true, state: next };
  }

  /* 救生艇：放置/卡住阶段，所有玩家都有手牌时可用 */
  function canUseLifeboat(state) {
    if (!isOnline(state)) return false;
    if (state.phase !== 'place' && state.phase !== 'stuck') return false;
    if (!canSeatAct(state, state.currentSeat)) return false;
    if (!hasUnusedItem(state, 'lifeboat')) return false;
    return state.players.every(function (p) { return p.hand.length > 0; });
  }

  /* 救生艇：进入全员暗选阶段 */
  function useLifeboat(state) {
    if (!isOnline(state)) return fail('mode', '救生艇只在联机模式可用');
    if (state.phase !== 'place' && state.phase !== 'stuck') {
      return fail('phase', '当前不能使用救生艇');
    }
    if (!canSeatAct(state, state.currentSeat)) return fail('seat', '还没轮到你使用物品');
    if (!hasUnusedItem(state, 'lifeboat')) return fail('item', '救生艇已用完');
    if (!state.players.every(function (p) { return p.hand.length > 0; })) {
      return fail('hand', '需要所有玩家都有手牌');
    }

    var next = clone(state);
    var meta = actorMeta(next);
    markItemUsed(next, 'lifeboat');
    var picks = {};
    next.players.forEach(function (p) { picks[p.seat] = null; });
    next.phase = 'lifeboat';
    next.pending = { type: 'lifeboat', picks: picks };
    next.activeSeat = -1;
    pushLog(next, { turn: next.turn, type: 'lifeboat' }, meta.seat);
    setLastAction(next, { type: 'lifeboat', turn: next.turn }, meta.seat);
    bump(next);
    return { ok: true, state: next };
  }

  /*
   * 救生艇选牌：每位玩家只能设置/修改自己的选择；
   * 当前玩家选完且全员就绪时自动结算，避免多端重复传牌。
   */
  function lifeboatPick(state, seat, cardId) {
    if (!isOnline(state) || state.phase !== 'lifeboat' ||
      !state.pending || state.pending.type !== 'lifeboat') {
      return fail('phase', '当前没有等待选牌的救生艇');
    }
    var p = playerAt(state, seat);
    if (!p) return fail('seat', '座位不存在');
    if (!canSeatAct(state, seat)) return fail('seat', '只能修改自己的选择');
    if (cardId != null && p.hand.indexOf(cardId) < 0) {
      return fail('hand', '这张卡牌不在你的手牌中');
    }

    var next = clone(state);
    next.pending.picks[seat] = cardId == null ? null : cardId;
    pushLog(next, {
      turn: next.turn,
      type: 'lifeboat-pick',
      cardId: cardId == null ? null : cardId
    }, seat);
    setLastAction(next, {
      type: 'lifeboat-pick',
      cardId: cardId == null ? null : cardId,
      turn: next.turn
    }, seat);
    bump(next);

    if (seat === next.currentSeat && allLifeboatPicked(next)) {
      applyLifeboatTransfer(next);
      bump(next);
      pushLog(next, { turn: next.turn, type: 'lifeboat-done' }, next.currentSeat);
    }
    return { ok: true, state: next };
  }

  /* 救生艇结算：只有当前玩家可以执行，每人传给左手边 */
  function completeLifeboat(state, seat) {
    if (!isOnline(state)) return fail('mode', '救生艇只在联机模式可用');
    if (state.phase !== 'lifeboat' || !state.pending || state.pending.type !== 'lifeboat') {
      return fail('phase', '当前没有待结算的救生艇');
    }
    if (seat != null && seat !== state.currentSeat) {
      return fail('seat', '只有当前玩家可以结算救生艇');
    }
    if (!allLifeboatPicked(state)) return fail('picks', '还有玩家没有选牌');

    var next = clone(state);
    applyLifeboatTransfer(next);
    bump(next);
    pushLog(next, { turn: next.turn, type: 'lifeboat-done' }, next.currentSeat);
    setLastAction(next, { type: 'lifeboat-done', turn: next.turn }, next.currentSeat);
    return { ok: true, state: next };
  }

  /* 罐头食品：放置/卡住阶段跳过当前回合 */
  function canUseCanned(state) {
    if (!isOnline(state)) return false;
    if (state.phase !== 'place' && state.phase !== 'stuck') return false;
    if (!canSeatAct(state, state.currentSeat)) return false;
    return hasUnusedItem(state, 'canned');
  }

  function useCanned(state) {
    if (!isOnline(state)) return fail('mode', '罐头食品只在联机模式可用');
    if (state.phase !== 'place' && state.phase !== 'stuck') {
      return fail('phase', '当前不能使用罐头食品');
    }
    if (!canSeatAct(state, state.currentSeat)) return fail('seat', '还没轮到你使用物品');
    if (!hasUnusedItem(state, 'canned')) return fail('item', '罐头食品已用完');

    var next = clone(state);
    var meta = actorMeta(next);
    markItemUsed(next, 'canned');
    pushLog(next, { turn: next.turn, type: 'canned', skipped: true }, meta.seat);
    setLastAction(next, { type: 'canned', skipped: true, turn: next.turn }, meta.seat);
    bump(next);
    endTurn(next);
    return { ok: true, state: next };
  }

  /* ---------------- 序列化 ---------------- */

  /* 状态序列化为 JSON 字符串 */
  function serialize(state) {
    return JSON.stringify(state);
  }

  /* 校验并还原存档（兼容单人存档与联机快照）；失败返回 null */
  function deserialize(json) {
    try {
      var s = typeof json === 'string' ? JSON.parse(json) : json;
      if (!s || s.version !== VERSION || !s.board || !Array.isArray(s.board.slots)) return null;
      if (s.board.slots.length !== 15 || !Array.isArray(s.board.goals)) return null;
      if (!Array.isArray(s.supply) || !Array.isArray(s.draw) || !Array.isArray(s.items)) return null;

      if (s.mode === 'online') {
        if (!Array.isArray(s.players) || s.players.length < 2 || s.players.length > 4) return null;
        for (var i = 0; i < s.players.length; i++) {
          var p = s.players[i];
          if (!p || typeof p.seat !== 'number' || !Array.isArray(p.hand)) return null;
          for (var h = 0; h < p.hand.length; h++) {
            if (!CARDS[p.hand[h]]) return null;
          }
        }
        if (typeof s.currentSeat !== 'number' || !playerAt(s, s.currentSeat)) return null;
        if (typeof s.rev !== 'number' || typeof s.handLimit !== 'number') return null;
        /* hand 镜像可能缺失或不一致，统一从 players[currentSeat] 重建 */
        s.hand = playerAt(s, s.currentSeat).hand.slice();
        if (typeof s.activeSeat !== 'number') s.activeSeat = s.currentSeat;
        if (s.pending === undefined) s.pending = null;
        return s;
      }

      if (!Array.isArray(s.hand)) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  /* 键名排序的稳定序列化，保证哈希一致 */
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

  /* 对完整状态做 32 位哈希，便于调试比对 */
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
    ONLINE_ITEM_POOL: ONLINE_ITEM_POOL,
    createGame: createGame,
    createOnlineGame: createOnlineGame,
    canPlace: canPlace,
    legalPlacements: legalPlacements,
    hasAnyLegalPlacement: hasAnyLegalPlacement,
    inuitPlacements: inuitPlacements,
    canUseInuit: canUseInuit,
    logOptions: logOptions,
    canUseSled: canUseSled,
    canUseLog: canUseLog,
    analyzeRoutes: analyzeRoutes,
    placeCard: placeCard,
    useInuit: useInuit,
    chooseSupply: chooseSupply,
    useSled: useSled,
    useLog: useLog,
    canUseRadio: canUseRadio,
    useRadio: useRadio,
    chooseRadioSupply: chooseRadioSupply,
    canUseLifeboat: canUseLifeboat,
    useLifeboat: useLifeboat,
    lifeboatPick: lifeboatPick,
    completeLifeboat: completeLifeboat,
    canUseCanned: canUseCanned,
    useCanned: useCanned,
    declareLoss: declareLoss,
    handForSeat: handForSeat,
    canSeatAct: canSeatAct,
    actorSeat: actorSeat,
    playerAt: playerAt,
    isOnline: isOnline,
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
