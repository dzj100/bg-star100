/* ============================================================
   Scoundrel（无赖勇者）— 规则引擎（纯函数，不依赖 DOM）
   可直接在浏览器与 node 中使用
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Scoundrel = factory();
})(this, function () {
  'use strict';

  var MAX_HP = 20;

  // 花色: H 红桃(血瓶) / D 方片(装备) / S 黑桃(怪物) / C 梅花(怪物)
  function makeCard(suit, rank) {
    return { suit: suit, rank: rank };
  }

  // 54 张中去掉红桃/方片 JQKA 与大小王，剩 44 张
  function buildDeck() {
    var deck = [];
    for (var r = 2; r <= 10; r++) {
      deck.push(makeCard('H', r), makeCard('D', r));
    }
    for (var r2 = 2; r2 <= 14; r2++) {
      deck.push(makeCard('S', r2), makeCard('C', r2));
    }
    return deck;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var r = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function freshState() {
    return {
      hp: MAX_HP,
      deck: [],
      room: [],
      weapon: null,          // { card, enabled, lastFight: number|null }
      potionUsed: false,     // 本房间是否已喝过有效血瓶
      kickBanned: false,     // 踢门后，下一个房间禁止踢门
      phase: 'playing',      // playing | won | lost
      stats: { kills: 0, rooms: 0, kicks: 0 }
    };
  }

  // 进入新房间：消耗踢门禁令；补牌到 4 张；重置血瓶计数
  function enterRoom(state) {
    if (state.kickBanned) state.kickBanned = false;
    while (state.room.length < 4 && state.deck.length > 0) {
      state.room.push(state.deck.shift());
    }
    state.potionUsed = false;
    state.stats.rooms++;
  }

  function newGame(seed) {
    var state = freshState();
    var rng = (seed !== undefined && seed !== null) ? mulberry32(seed) : Math.random;
    state.deck = shuffle(buildDeck(), rng);
    enterRoom(state); // 开局即第一间房，可踢门（kickBanned 初始 false）
    return state;
  }

  function canKick(state) {
    return state.phase === 'playing' &&
      state.room.length === 4 &&
      !state.kickBanned &&
      state.deck.length > 0;
  }

  function kick(state) {
    if (!canKick(state)) return { ok: false };
    shuffle(state.room);
    state.deck.push.apply(state.deck, state.room); // 洗混后放入牌堆底部
    state.room = [];
    state.kickBanned = true;
    while (state.room.length < 4 && state.deck.length > 0) {
      state.room.push(state.deck.shift());
    }
    state.potionUsed = false;
    state.stats.kicks++;
    state.stats.rooms++;
    return { ok: true };
  }

  function toggleWeapon(state) {
    if (!state.weapon) return { ok: false };
    state.weapon.enabled = !state.weapon.enabled;
    return { ok: true, enabled: state.weapon.enabled };
  }

  function afterConsume(state) {
    if (state.room.length === 1) enterRoom(state);
    if (state.deck.length === 0 && state.room.length === 0) state.phase = 'won';
  }

  // 处理房间中的一张牌（index 为 room 下标）
  function act(state, index) {
    if (state.phase !== 'playing') return { ok: false, reason: 'game-over' };
    var card = state.room[index];
    if (!card) return { ok: false, reason: 'no-card' };

    var result = { ok: true, card: card, roomIndex: index, action: null, hpLost: 0, hpGain: 0, weaponUsed: false, blocked: false };

    if (card.suit === 'H') {
      result.action = 'potion';
      var before = state.hp;
      var heal = state.potionUsed ? 0 : card.rank;
      state.hp = Math.min(MAX_HP, state.hp + heal);
      result.hpGain = state.hp - before;
      state.potionUsed = true;
      state.room.splice(index, 1);
    } else if (card.suit === 'D') {
      result.action = 'equip';
      state.weapon = { card: card, enabled: true, lastFight: null, kills: [] };
      state.room.splice(index, 1);
    } else {
      result.action = 'fight';
      var w = state.weapon;
      var weaponFight = w && w.enabled && (w.lastFight === null || card.rank < w.lastFight);
      if (weaponFight) {
        result.weaponUsed = true;
        result.dmg = Math.max(0, card.rank - w.card.rank); // 部分减伤
        result.blocked = w.card.rank >= card.rank;
        w.lastFight = card.rank; // 实际使用武器才更新记录
        (w.kills = w.kills || []).push(card);
      } else {
        result.dmg = card.rank;
      }
      state.hp -= result.dmg;
      result.hpLost = result.dmg;
      state.room.splice(index, 1);
      state.stats.kills++;
      if (state.hp <= 0) {
        state.phase = 'lost';
        return result;
      }
    }

    afterConsume(state);
    return result;
  }

  function serialize(state) {
    return JSON.stringify(state);
  }

  function deserialize(json) {
    var s = JSON.parse(json);
    if (!s || typeof s.hp !== 'number' || !Array.isArray(s.deck) || !Array.isArray(s.room)) return null;
    s.phase = s.phase || 'playing';
    s.potionUsed = !!s.potionUsed;
    s.kickBanned = !!s.kickBanned;
    if (s.weapon && !Array.isArray(s.weapon.kills)) s.weapon.kills = [];
    s.stats = s.stats || { kills: 0, rooms: 1, kicks: 0 };
    return s;
  }

  var suitLabel = { H: '♥', D: '♦', S: '♠', C: '♣' };
  function rankLabel(r) { return r === 14 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r); }
  function cardLabel(c) { return suitLabel[c.suit] + rankLabel(c.rank); }

  return {
    MAX_HP: MAX_HP,
    buildDeck: buildDeck,
    shuffle: shuffle,
    newGame: newGame,
    enterRoom: enterRoom,
    canKick: canKick,
    kick: kick,
    toggleWeapon: toggleWeapon,
    act: act,
    serialize: serialize,
    deserialize: deserialize,
    cardLabel: cardLabel,
    rankLabel: rankLabel,
    suitLabel: suitLabel,
    _internal: { makeCard: makeCard, freshState: freshState }
  };
});
