/* ============================================================
 * 《深渊回响》Abyss Echo — 核心逻辑
 * 全局 state + phase/subPhase 状态机，事件驱动渲染
 * 联机契约：window._getOnlineState / _applyOnlineState / _olIsActor
 * state 必须整体可 JSON 序列化（禁函数/闭包入 state）
 * ============================================================ */

let state = null;
let rng = null;
const SAVE_KEY = 'abyss-save';
const META_KEY = 'abyss-meta';
const BOSS_SCALE = [1, 1.15, 1.3];
const HAND_LIMIT = 10;
const RARITY_PRICE_KEY = { common: 'cardCommon', uncommon: 'cardUncommon', rare: 'cardRare' };

/* ---------- RNG（种子化，联机可复现） ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function rnd() { return rng(); }
function rndInt(n) { return Math.floor(rng() * n); }
function pick(arr) { return arr.length ? arr[rndInt(arr.length)] : null; }
function weightedPick(items) {
  let total = 0;
  for (const it of items) total += it.w;
  let r = rng() * total;
  for (const it of items) { r -= it.w; if (r < 0) return it.item; }
  return items.length ? items[items.length - 1].item : null;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/* ---------- 存档 ---------- */
function saveState() {
  if (!state || state.phase === 'menu') return; // 菜单态不写盘：返回菜单即清除本局存档
  if (window._onlineRoomId) return; // 联机时状态由 rooms 表承载
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
/* 旧版本存档迁移：补全新增的 combat 字段，避免继续游戏时报错 */
function migrateState(s) {
  if (s && s.combat) {
    if (s.combat.multiQueue === undefined) s.combat.multiQueue = [];
    if (s.combat.pendingTide === undefined) s.combat.pendingTide = null;
    if (s.combat.tideSplash === undefined) s.combat.tideSplash = null;
    if (s.combat.playFx === undefined) s.combat.playFx = null;
    if (s.combat.playerActed === undefined) s.combat.playerActed = null;
    if (s.combat.energyFx === undefined) s.combat.energyFx = null;
    if (s.combat.hitPulse === undefined) s.combat.hitPulse = null;
  }
  if (s && s.reward && s.reward.picksLeft === undefined) s.reward.picksLeft = 1;
  return s;
}
function defaultMeta() { return { seenCards: [], wins: 0, hardMode: false }; }
function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || defaultMeta(); }
  catch (e) { return defaultMeta(); }
}
function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(state.unlock)); } catch (e) { /* ignore */ } }

/* ---------- 卡牌工具 ---------- */
function cardInst(id, upg) { return { uid: state.nextUid++, id, upg: !!upg }; }
function cdef(card) { return CARDS[card.id]; }
function ceff(card) {
  const d = cdef(card);
  return (card.upg && d.upgEffects) ? d.upgEffects : d.effects;
}
function hasRelic(id) { return state.run && state.run.relicIds.includes(id); }
function allCardPool() {
  const pool = [];
  state.party.forEach(p => {
    (CLASS_POOLS[p.classId] || []).forEach(id => { if (!pool.includes(id)) pool.push(id); });
  });
  NEUTRAL_POOL.forEach(id => { if (!pool.includes(id)) pool.push(id); });
  return pool;
}
function randomRewardCard() {
  return weightedPick(allCardPool().map(id => ({ item: id, w: CARD_RARITY_WEIGHT[CARDS[id].rarity] || 60 })));
}
function rareOnly() {
  return allCardPool().filter(id => CARDS[id].rarity === 'rare')
    .map(id => ({ item: id, w: 1 }));
}
function pickUnownedRelic() {
  const owned = new Set(state.run.relicIds);
  const avail = Object.keys(RELICS).filter(id => !owned.has(id));
  return avail.length ? pick(avail) : null;
}

/* ---------- 初始化 ---------- */
function freshMenuState() {
  return {
    version: 1, seed: 0, nextUid: 1,
    phase: 'menu', subPhase: null, gameOver: false,
    run: null, map: null, party: [], combat: null, reward: null,
    shop: null, event: null, rest: null, pendingFight: null,
    unlock: defaultMeta(),
  };
}
function init() {
  const s = loadSave();
  state = (s && s.version === 1) ? migrateState(s) : freshMenuState();
  state.unlock = loadMeta();
  rng = mulberry32(state.seed || 1);
  render();
}
function after() { saveState(); render(); }
/* 触觉反馈：渐进增强，环境不支持（iOS/桌面）时静默跳过 */
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}

/* ---------- 操作分派 ---------- */
function act(action, a, b, c) {
  switch (action) {
    case 'new-game': return newGame();
    case 'continue-run': return continueRun();
    case 'select-node': return selectNode(a);
    case 'dismiss-intro': return dismissIntro();
    case 'play-card': return playCard(a, b, c);
    case 'cancel-pending': return cancelPending();
    case 'end-turn': return endTurn();
    case 'pick-reward-card': return pickRewardCard(a);
    case 'reward-give': return rewardGive(a);
    case 'skip-reward': return skipReward();
    case 'buy-shop-item': return buyShopItem(a);
    case 'buy-confirm': return buyConfirm();
    case 'buy-cancel': return buyCancel();
    case 'buy-give': return buyGive(a);
    case 'shop-remove-card': return shopRemoveCard(a, b);
    case 'pick-event-option': return pickEventOption(a);
    case 'rest-heal': return restHeal();
    case 'rest-upgrade': return b !== undefined ? restSelectCard(a, b) : toggleRestUpgrade();
    case 'rest-upgrade-confirm': return restUpgradeConfirm();
    case 'rest-upgrade-cancel': return restUpgradeCancel();
    case 'leave-map-node': return leaveMapNode();
    case 'quit-menu': return requestQuit();
    case 'quit-cancel': return cancelQuit();
    case 'return-menu': return returnMenu();
  }
}

/* ---------- 新局 / 继续 ---------- */
function newGame() {
  const sel = (window._menuSelection || []).filter(id => CLASSES[id]);
  if (!sel.length) { showToast('请选择1-4个职业'); return; }
  state = freshMenuState();
  state.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  rng = mulberry32(state.seed);
  state.run = { floor: 1, gold: 0, relicIds: [], permanentBuffs: {}, kills: 0, elitesKilled: 0, restUsed: false, intro: true };
  state.party = sel.map(cid => {
    const cl = CLASSES[cid];
    return {
      classId: cid, name: cl.name, hp: cl.hp, maxHp: cl.hp, energy: 3,
      hand: [], drawPile: [], discardPile: [], exhaustPile: [], block: 0,
      buffs: emptyBuffs(), deck: STARTER_DECKS[cid].map(id => cardInst(id)),
      relicIds: [], dead: false,
    };
  });
  generateMap(1);
  state.transition = { floor: 1 };
  state.phase = 'map';
  after();
}
function continueRun() {
  if (state.phase !== 'menu' && state.run && !state.gameOver) {
    rng = mulberry32(state.seed || 1);
    render();
  } else showToast('没有进行中的远征');
}

/* ---------- 地图 ---------- */
function dismissIntro() {
  if (state.run) state.run.intro = false;
  after();
}
function generateMap(floor) {
  const rows = floor === 3 ? [2, 3, 3, 1] : [2, 3, 3, 2];
  const nodes = [];
  const edges = [];
  let id = 1;
  for (let r = 0; r < rows.length; r++) {
    const rowNodes = [];
    for (let c = 0; c < rows[r]; c++) {
      const node = { id, type: pickNodeType(floor, r, c, nodes), row: r, col: c, state: r === 0 ? 'available' : 'locked' };
      nodes.push(node);
      rowNodes.push(node);
      id++;
    }
    if (r > 0) {
      const prevRow = nodes.filter(n => n.row === r - 1);
      prevRow.forEach(pn => {
        for (let dc = -1; dc <= 1; dc++) {
          const cn = rowNodes.find(n => n.col === pn.col + dc);
          if (cn) edges.push([pn.id, cn.id]);
        }
      });
    }
  }
  const lastRow = nodes.filter(n => n.row === rows.length - 1);
  if (floor === 3) {
    lastRow.forEach(n => { n.type = 'boss'; });
  } else {
    const eliteCol = Math.floor(lastRow.length / 2);
    lastRow.forEach((n, i) => { n.type = i === eliteCol ? 'elite' : 'combat'; });
  }
  const preLast = nodes.filter(n => n.row === rows.length - 2);
  if (preLast.length && !preLast.some(n => n.type === 'rest')) preLast[0].type = 'rest';
  state.map = { floor, rows, nodes, edges };
  state.run.floor = floor;
  state.run.restUsed = false;
  state.run.currentNodeId = null;
}
function pickNodeType(floor, r, c, nodes) {
  if (r === 0) return 'combat';
  const opts = [];
  for (const [t, w] of Object.entries(NODE_WEIGHTS)) {
    const prev = nodes.find(n => n.row === r - 1 && n.col === c);
    if (prev && prev.type === t) continue;
    opts.push({ item: t, w });
  }
  return weightedPick(opts);
}
function currentNode() { return state.map.nodes.find(n => n.id === state.run.currentNodeId); }
function selectNode(id) {
  const node = state.map.nodes.find(n => n.id === id);
  if (!node || node.state !== 'available') return;
  node.state = 'visited';
  state.run.currentNodeId = id;
  switch (node.type) {
    case 'combat': startCombat(pick(ENCOUNTERS[Math.min(state.run.floor - 1, ENCOUNTERS.length - 1)])); break;
    case 'elite': startCombat(pick(ELITES)); break;
    case 'boss': startCombat([floorBossId()]); break;
    case 'event':
      state.event = { defId: pick(Object.keys(EVENTS)), chosen: null };
      state.phase = 'event';
      break;
    case 'shop':
      state.shop = genShop();
      state.phase = 'shop';
      break;
    case 'rest':
      state.rest = { upgradeMode: false, confirmCard: null, usedHeal: false, usedUpgrade: false };
      state.phase = 'rest';
      break;
  }
  after();
}
function floorBossId() {
  return state.run.floor === 3 ? 'abyssal_will' : (state.run.floor === 2 ? 'tide_matron' : 'great_eye');
}
function completeNode() {
  const node = currentNode();
  if (node) node.state = 'cleared';
  if (node && node.row >= state.map.rows.length - 1) {
    /* 第 1、2 层必须击败本层精英才能进入下一层 */
    if (state.run.floor < 3) {
      const elite = state.map.nodes.find(n => n.type === 'elite');
      if (elite && elite.state !== 'cleared') {
        if (elite.state === 'locked') elite.state = 'available'; // 打开回头路
        showToast('深渊拦路者尚未击破，必须先击败精英！');
        state.phase = 'map';
        after();
        return;
      }
    }
    if (state.run.floor >= 3) { victory(); return; }
    generateMap(state.run.floor + 1);
    state.transition = { floor: state.run.floor };
    state.phase = 'map';
    after();
    return;
  }
  if (node) {
    state.map.edges.forEach(([f, t]) => {
      if (f === node.id) {
        const n2 = state.map.nodes.find(n => n.id === t);
        if (n2 && n2.state === 'locked') n2.state = 'available';
      }
    });
  }
  state.phase = 'map';
  after();
}

/* ---------- 战斗 ---------- */
function startCombat(enemyIds) {
  const floor = state.run.floor;
  const scale = FLOOR_SCALE[floor - 1];
  state.combat = {
    enemyGroup: enemyIds.map(eid => {
      const def = ENEMIES[eid];
      const s = def.boss ? BOSS_SCALE[floor - 1] : scale;
      const partyScale = def.boss ? [1, 1.15, 1.3, 1.5][state.party.length - 1] : [1, 1.8, 2.5, 3.2][state.party.length - 1];
      return {
        id: state.nextUid++, defId: eid, name: def.name,
        hp: Math.round(def.hp * s * partyScale), maxHp: Math.round(def.hp * s * partyScale),
        block: 0, buffs: emptyBuffs(), intent: null, intentIdx: 0,
        isBoss: !!def.boss, elite: !!def.elite,
      };
    }),
    turn: 1, pendingCard: null, log: ['战斗开始——深渊注视着你'],
    cardsPlayed: state.party.map(() => 0), spellsPlayed: state.party.map(() => 0),
    hurtThisTurn: state.party.map(() => false), over: false,
    hits: [], finalKill: null, enemyActed: [], actQueue: [],
    pendingTide: null, tideSplash: null, multiQueue: [],
    playFx: null, playerActed: null, energyFx: null, hitPulse: null,
  };
  const _bossId = enemyIds.find(eid => ENEMIES[eid] && ENEMIES[eid].boss);
  state.combat.bossName = _bossId ? ENEMIES[_bossId].name : null;
  state.party.forEach((p, i) => {
    p.dead = false;
    p.block = 0;
    p.buffs = emptyBuffs();
    const pb = state.run.permanentBuffs || {};
    for (const k of Object.keys(pb)) p.buffs[k] = (p.buffs[k] || 0) + pb[k];
    p.hand = [];
    p.drawPile = shuffle(p.deck.slice());
    p.discardPile = [];
    p.exhaustPile = [];
    p.energy = 3 + (p.buffs.energy || 0) + (hasRelic('abyss_eye') ? 1 : 0);
    drawCards(i, 4 + (p.buffs.draw || 0) + (hasRelic('tide_compass') ? 1 : 0));
  });
  if (hasRelic('abyss_charm')) state.party.forEach(p => { p.block += 8; });
  if (hasRelic('coral_heart')) state.party.forEach(p => { p.hp = Math.min(p.maxHp, p.hp + 5); });
  computeIntents();
  state.phase = 'combat';
  state.subPhase = 'play';
}
function computeIntents() {
  state.combat.enemyGroup.forEach(e => {
    const def = ENEMIES[e.defId];
    if (def.phaseIntents) {
      const ratio = e.hp / e.maxHp;
      const phaseIdx = ratio > 2 / 3 ? 0 : ratio > 1 / 3 ? 1 : 2;
      const group = def.phaseIntents[phaseIdx];
      e.intent = group[e.intentIdx % group.length];
    } else {
      e.intent = def.intents[e.intentIdx % def.intents.length];
    }
  });
}
function allEnemiesDead() { return state.combat.enemyGroup.every(e => e.dead); }
function pickAliveEnemy() { return pick(state.combat.enemyGroup.filter(e => !e.dead)); }
function log(msg) {
  state.combat.log.push(msg);
  if (state.combat.log.length > 50) state.combat.log.shift();
}
function drawCards(playerIdx, n) {
  const p = state.party[playerIdx];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (p.hand.length >= HAND_LIMIT) break;
    if (!p.drawPile.length) {
      if (!p.discardPile.length) break;
      p.drawPile = shuffle(p.discardPile);
      p.discardPile = [];
    }
    p.hand.push(p.drawPile.pop());
    drawn++;
  }
  if (drawn > 0 && state.combat) log(`${p.name} 抽了 ${drawn} 张牌`);
}

function playCard(playerIdx, handIdx, target) {
  if (state.phase !== 'combat' || state.subPhase !== 'play' || state.combat.over) return;
  if (state.combat.pendingWin) return; // 击杀演出中，锁定操作
  if ((state.combat.multiQueue || []).length) { showToast('多段伤害结算中……'); return; }
  const p = state.party[playerIdx];
  if (!p || p.dead) return;
  const card = p.hand[handIdx];
  if (!card) return;
  const def = cdef(card);
  const needTarget = def.target === 'enemy' || def.target === 'ally';
  if (needTarget && (target === undefined || target < 0)) {
    state.combat.pendingCard = { playerIdx, handIdx };
    after();
    return;
  }
  if (def.cost > p.energy) { showToast('能量不足'); return; }
  if (def.target === 'enemy' && !state.combat.enemyGroup[target]) return;
  if (def.target === 'ally' && (!state.party[target] || state.party[target].dead)) return;
  state.combat.pendingCard = null;
  p.hand.splice(handIdx, 1);
  p.energy -= def.cost;
  state.combat.energyFx = playerIdx;
  if (def.type === 'attack') state.combat.playFx = { cardId: card.id, upg: !!card.upg, type: def.type };
  log(`${p.name} 打出【${def.name}${card.upg ? '+' : ''}】`);
  const comboBefore = state.combat.cardsPlayed[playerIdx];
  state.combat.cardsPlayed[playerIdx]++;
  if (def.type === 'attack' && p.classId === 'scholar') {
    state.combat.spellsPlayed[playerIdx]++;
    if (state.combat.spellsPlayed[playerIdx] % 3 === 0) {
      state.combat.pendingTide = { playerIdx };
      log(`【潮汐】${p.name} 的潮汐蓄势待发`);
    }
  }
  const ctx = { playerIdx, target, card, comboBefore, pierce: ceff(card).some(e => e.t === 'pierce') };
  for (const eff of ceff(card)) resolveEffect(eff, ctx);
  if (def.type === 'attack' && (p.buffs.curse || 0) > 0) {
    const c = p.buffs.curse;
    p.hp -= c;
    if (state.combat) state.combat.hits.push({ unit: 'p' + playerIdx, hpDmg: c });
    log(`${p.name} 被诅咒侵蚀，损失${c}点生命`);
    if (p.hp <= 0) { p.dead = true; p.block = 0; log(`${p.name} 倒下了`); }
  }
  if (def.exhaust) p.exhaustPile.push(card); else p.discardPile.push(card);
  if (allEnemiesDead()) { state.combat.pendingWin = true; after(); } // 击杀演出后再结算奖励
  else if (state.party.every(x => x.dead)) { defeat(); }
  else after();
}
function cancelPending() {
  if (state.combat && state.combat.pendingCard) {
    state.combat.pendingCard = null;
    after();
  }
}
function getTarget(ctx) {
  const def = cdef(ctx.card);
  if (def.target === 'enemy') return state.combat.enemyGroup[ctx.target];
  if (def.target === 'ally') return state.party[ctx.target];
  return state.party[ctx.playerIdx];
}
function resolveEffect(eff, ctx) {
  switch (eff.t) {
    case 'damage': {
      const tgt = getTarget(ctx);
      if (tgt) dealDamage(tgt, eff.n, ctx);
      break;
    }
    case 'multiHit': {
      const tgt = getTarget(ctx);
      if (!tgt) break;
      /* 第一段立即结算，后续段入队由渲染层定时器逐个驱动，制造多段飘字节奏 */
      dealDamage(tgt, eff.n, ctx);
      for (let i = 1; i < eff.times; i++) {
        state.combat.multiQueue.push({ playerIdx: ctx.playerIdx, target: tgt.id, n: eff.n, comboBefore: ctx.comboBefore, pierce: !!ctx.pierce, card: ctx.card });
      }
      break;
    }
    case 'allDamage': {
      state.combat.enemyGroup.slice().forEach(e => dealDamage(e, eff.n, ctx));
      break;
    }
    case 'damageRandom': {
      for (let i = 0; i < (eff.times || 1); i++) {
        const e = pickAliveEnemy();
        if (e) dealDamage(e, eff.n, ctx);
      }
      break;
    }
    case 'block': {
      const p = state.party[ctx.playerIdx];
      const gain = eff.n + (p.buffs.dexterity || 0);
      p.block += gain;
      log(`${p.name} 获得 ${gain} 点护甲`);
      break;
    }
    case 'allBlock': {
      const bp = state.party[ctx.playerIdx];
      const dex = bp.buffs.dexterity || 0;
      state.party.forEach(p => {
        if (p.dead) return;
        const gain = eff.n + (p === bp ? dex : 0);
        p.block += gain;
        log(`${p.name} 获得 ${gain} 点护甲`);
      });
      break;
    }
    case 'draw': {
      drawCards(ctx.playerIdx, eff.n);
      break;
    }
    case 'energy': {
      const p = state.party[ctx.playerIdx];
      p.energy += eff.n;
      log(`${p.name} 获得 ${eff.n} 点能量`);
      break;
    }
    case 'heal': {
      const tgt = getTarget(ctx);
      if (tgt) healUnit(tgt, eff.n);
      break;
    }
    case 'allHeal': state.party.forEach(p => { if (!p.dead) healUnit(p, eff.n); }); break;
    case 'applyStatus': {
      const tgt = getTarget(ctx);
      if (tgt) addStatus(tgt, eff.status, eff.n);
      break;
    }
    case 'allStatus': {
      const def = cdef(ctx.card);
      if (def.target === 'allEnemies') state.combat.enemyGroup.forEach(e => addStatus(e, eff.status, eff.n));
      else state.party.forEach(p => { if (!p.dead) addStatus(p, eff.status, eff.n); });
      break;
    }
    case 'buff': {
      const p = state.party[ctx.playerIdx];
      p.buffs[eff.buff] = (p.buffs[eff.buff] || 0) + eff.n;
      const nm = BUFF_META[eff.buff] ? BUFF_META[eff.buff].name : eff.buff;
      log(`${p.name} 获得 ${eff.n} 层${nm}`);
      break;
    }
    case 'allBuff': {
      state.party.forEach(p => {
        if (p.dead) return;
        p.buffs[eff.buff] = (p.buffs[eff.buff] || 0) + eff.n;
        const nm = BUFF_META[eff.buff] ? BUFF_META[eff.buff].name : eff.buff;
        log(`${p.name} 获得 ${eff.n} 层${nm}`);
      });
      break;
    }
    case 'guard': {
      const tgt = getTarget(ctx);
      if (tgt) {
        tgt.buffs.guard = (tgt.buffs.guard || 0) + eff.n;
        log(`${tgt.name} 获得 ${eff.n} 层守护`);
      }
      break;
    }
    case 'loseHp': {
      const p = state.party[ctx.playerIdx];
      p.hp -= eff.n;
      log(`${p.name} 失去了${eff.n}点生命`);
      break;
    }
    case 'removeDebuff': {
      const tgt = getTarget(ctx);
      if (tgt) removeDebuff(tgt, eff.n, ctx, true);
      break;
    }
    case 'removeDebuffAll': {
      let rewarded = false;
      state.party.forEach(p => {
        if (p.dead) return;
        if (removeDebuff(p, eff.n, ctx, !rewarded)) rewarded = true;
      });
      break;
    }
    case 'pierce': break; // 修饰符，已在 playCard 收集
    case 'exhaust': break; // 修饰符，由卡牌字段 exhaust 处理
  }
}
function addStatus(tgt, status, n) {
  tgt.buffs[status] = (tgt.buffs[status] || 0) + n;
  const nm = BUFF_META[status] ? BUFF_META[status].name : status;
  log(`${tgt.name} 获得${n}层${nm}`);
}
function removeDebuff(tgt, n, ctx, reward) {
  const keys = BUFF_KEYS.filter(k => BUFF_META[k].kind === 'debuff' && (tgt.buffs[k] || 0) > 0);
  keys.sort((a, b) => (tgt.buffs[b] || 0) - (tgt.buffs[a] || 0));
  let removed = 0;
  for (const k of keys) {
    if (n <= 0) break;
    const take = Math.min(tgt.buffs[k], n);
    tgt.buffs[k] -= take;
    n -= take;
    removed += take;
  }
  if (removed > 0) {
    const caster = state.party[ctx.playerIdx];
    if (caster && caster.classId === 'healer' && reward) {
      caster.energy += 1;
      log(`【净化】${caster.name} 移除了${removed}层负面状态，获得1点能量`);
    } else {
      log(`${tgt.name} 移除了 ${removed} 层负面状态`);
    }
  }
  return removed;
}
function healUnit(tgt, n) {
  if (tgt.isBoss !== undefined) return;
  let v = n;
  if (hasRelic('tide_chalice')) v += 5;
  const before = tgt.hp;
  tgt.hp = Math.min(tgt.maxHp, tgt.hp + v);
  const healed = tgt.hp - before;
  if (healed > 0) {
    log(`${tgt.name} 恢复 ${healed} 点生命`);
    if (state.combat) state.combat.hits.push({ unit: hitUnitKey(tgt), heal: healed });
  }
}
function hitUnitKey(tgt) {
  if (tgt.isBoss !== undefined) return 'e' + tgt.id;
  return 'p' + state.party.indexOf(tgt);
}
function removeEnemy(e) {
  if (e.dead) return;
  e.dead = true;
  state.combat.killedId = e.id; // 记录最后一次击杀，渲染层播放死亡动画
  buzz([30, 40, 30]); // 击杀触觉反馈
  log(`${e.name} 被消灭了`);
}
function dealDamage(tgt, n, ctx) {
  ctx = ctx || {};
  const src = ctx.playerIdx !== undefined ? state.party[ctx.playerIdx] : (ctx.enemy || null);
  if (ctx.playerIdx !== undefined && state.combat) state.combat.playerActed = ctx.playerIdx;
  const steps = [`基础 ${n}`];
  if (tgt.isBoss !== undefined) {
    const atk = state.party[ctx.playerIdx];
    if (atk && !atk.dead) {
      if (atk.buffs.strength) { n += atk.buffs.strength; steps.push(`力量+${atk.buffs.strength}`); }
      if (atk.buffs.weak) { const mult = Math.max(0.2, 1 - 0.2 * atk.buffs.weak); n = Math.floor(n * mult); steps.push(`虚弱×${mult}`); }
      /* 条件加伤（cond 效果）：无视效果声明顺序，统一在伤害结算时计算 */
      const cd = ctx.card ? cdef(ctx.card) : null;
      if (cd) {
        for (const ce of cd.effects) {
          if (ce.t !== 'cond') continue;
          if (ce.cond === 'combo') {
            const played = state.combat.cardsPlayed[ctx.playerIdx];
            if (played > 0) { const b = played * (ce.n || 0); n += b; steps.push(`连击×${played}+${b}`); }
          } else if (ce.cond === 'poisoned' && (tgt.buffs.poison || 0) > 0) {
            n += ce.n || 0; steps.push(`毒蚀+${ce.n}`);
          } else if (ce.cond === 'hurt' && state.combat.hurtThisTurn[ctx.playerIdx]) {
            n += ce.n || 0; steps.push(`复仇+${ce.n}`);
          }
        }
      }
      /* 深渊猎手·连击：本回合每打出1张牌，下一张攻击牌伤害+1 */
      if (atk.classId === 'hunter' && cd && cd.type === 'attack' && ctx.comboBefore > 0) {
        n += ctx.comboBefore;
        steps.push(`连击机制+${ctx.comboBefore}`);
      }
    }
  } else {
    const e = ctx.enemy;
    if (e) {
      if (e.buffs.strength) { n += e.buffs.strength; steps.push(`力量+${e.buffs.strength}`); }
      if (e.buffs.rage) { n += e.buffs.rage; steps.push(`愤怒+${e.buffs.rage}`); }
      if (e.buffs.weak) { const mult = Math.max(0.2, 1 - 0.2 * e.buffs.weak); n = Math.floor(n * mult); steps.push(`虚弱×${mult}`); }
    }
  }
  if (tgt.buffs.vulnerable) { const mult = 1 + 0.5 * tgt.buffs.vulnerable; n = Math.floor(n * mult); steps.push(`易伤×${mult}`); }
  console.log(`[伤害结算] ${src ? src.name : '?'} → ${tgt.name}: ${steps.join(' → ')} = ${n}`);
  let target = tgt;
  if (tgt.isBoss === undefined) {
    const guard = state.party.find(x => !x.dead && x !== tgt && (x.buffs.guard || 0) > 0);
    if (guard) {
      guard.buffs.guard--;
      target = guard;
      log(`${guard.name} 替 ${tgt.name} 承受了攻击`);
    }
  }
  if (!ctx.pierce && target.block > 0) {
    const absorbed = Math.min(target.block, n);
    target.block -= absorbed;
    n -= absorbed;
    if (absorbed > 0) {
      log(`${target.name} 的护甲抵挡了${absorbed}点伤害`);
      if (state.combat) state.combat.hits.push({ unit: hitUnitKey(target), blockAbsorbed: absorbed });
    }
  }
  if (n > 0) {
    if (tgt.isBoss !== undefined) buzz(15); // 命中触觉反馈
    if (target.isBoss === undefined && hasRelic('deep_one_scale')) n = Math.max(0, n - 2);
    target.hp -= n;
    log(`${target.name} 受到 ${n} 点伤害`);
    if (state.combat) state.combat.hits.push({ unit: hitUnitKey(target), hpDmg: n });
    if (target.isBoss === true) target.buffs.rage = Math.min(30, (target.buffs.rage || 0) + 1);
    else state.combat.hurtThisTurn[state.party.indexOf(target)] = true;
  }
  if (target.hp <= 0) {
    if (target.isBoss !== undefined) removeEnemy(target);
    else {
      target.dead = true;
      target.block = 0;
      log(`${target.name} 倒下了`);
    }
  }
}
/* 潮汐爆发延迟结算：由渲染层定时器在攻击卡动画结束后调用 */
function resolveTide() {
  if (!state.combat || !state.combat.pendingTide) return;
  const pt = state.combat.pendingTide;
  state.combat.pendingTide = null;
  if (state.phase !== 'combat') { after(); return; }
  const p = state.party[pt.playerIdx];
  const tgt = pickAliveEnemy();
  if (!p || p.dead || !tgt) { after(); return; }
  state.combat.tideSplash = tgt.id;
  dealDamage(tgt, 6, { playerIdx: pt.playerIdx });
  log(`【潮汐】${p.name} 的潮汐爆发对 ${tgt.name} 造成6点伤害`);
  if (allEnemiesDead()) state.combat.pendingWin = true;
  after();
  setTimeout(() => {
    if (state.combat && state.combat.tideSplash === tgt.id) {
      state.combat.tideSplash = null;
      render();
    }
  }, 900);
}
/* 多段伤害后续段结算：目标可能已在段间倒下，自动重选；全部敌人阵亡则清队进入击杀演出 */
function stepMultiHit() {
  if (!state.combat || state.phase !== 'combat') return;
  if (state.combat.pendingWin) { state.combat.multiQueue.length = 0; after(); return; }
  const item = state.combat.multiQueue.shift();
  if (!item) { after(); return; }
  let tgt = state.combat.enemyGroup.find(e => e.id === item.target && !e.dead && Number(e.hp) > 0);
  if (!tgt) tgt = pickAliveEnemy();
  if (tgt) {
    dealDamage(tgt, item.n, { playerIdx: item.playerIdx, comboBefore: item.comboBefore, pierce: item.pierce, card: item.card });
    state.combat.hitPulse = tgt.id; // 逐段命中回弹
  }
  if (allEnemiesDead()) {
    state.combat.multiQueue.length = 0;
    state.combat.pendingWin = true;
  }
  after();
}
function endTurn() {
  if (state.phase !== 'combat' || state.subPhase !== 'play') return;
  if (state.combat.pendingWin) return; // 击杀演出中，锁定操作
  if (state.combat.pendingTide) { showToast('潮汐正在积蓄，稍候……'); return; }
  if ((state.combat.multiQueue || []).length) { showToast('多段伤害结算中……'); return; }
  state.combat.pendingCard = null;
  state.party.forEach(p => { p.energy = 0; });
  state.combat.hurtThisTurn = state.party.map(() => false);
  log('我方结束了回合');
  if (hasRelic('ink_sac')) state.party.forEach(p => { if (!p.dead) p.block += 4; });
  state.subPhase = 'enemy';
  state.combat.actQueue = state.combat.enemyGroup.map(e => e.id);
  stepEnemyAct(); // 立即执行第一个敌人，后续由 render 定时器逐个驱动
}
/* 执行一个敌人的行动；队列走完则结算回合 */
function stepEnemyAct() {
  if (state.phase !== 'combat' || state.subPhase !== 'enemy') return;
  const queue = state.combat.actQueue || [];
  if (!queue.length) { finishEnemyTurns(); return; }
  const id = queue.shift();
  const e = state.combat.enemyGroup.find(x => x.id === id);
  if (!e || e.dead) { stepEnemyAct(); return; } // 敌人已被消灭，继续下一个
  e.block = 0; // 敌人护甲在行动前清除，挡的是玩家上一回合的攻击
  const fear = e.buffs.fear || 0;
  if (fear > 0 && rng() < fear * 0.2) {
    log(`${e.name} 因恐惧而僵住了`);
    e.intentIdx++;
  } else {
    executeEnemyIntent(e, e.intent);
    if (e.intent && (e.intent.t === 'attack' || e.intent.t === 'multi' || e.intent.t === 'allAttack')) {
      state.combat.enemyActed.push('e' + e.id);
    }
    e.intentIdx++;
  }
  after(); // 渲染本次攻击动画（含最后一个敌人），由定时器驱动下一步或回合结算
}
function finishEnemyTurns() {
  computeIntents();
  state.combat.turn++;
  log(`第 ${state.combat.turn} 回合开始`);
  state.combat.cardsPlayed = state.party.map(() => 0); // 连击计数每回合重置
  state.subPhase = 'roundEnd';
  state.combat.enemyGroup.forEach(e => {
    if (e.dead) return;
    if (e.buffs.poison > 0) {
      e.hp -= e.buffs.poison;
      log(`${e.name} 受到 ${e.buffs.poison} 点中毒伤害`);
      state.combat.hits.push({ unit: 'e' + e.id, hpDmg: e.buffs.poison });
      if (e.hp <= 0) removeEnemy(e);
    }
  });
  state.party.forEach((p, i) => {
    if (p.dead) return;
    if (p.buffs.poison > 0) {
      p.hp -= p.buffs.poison;
      log(`${p.name} 受到 ${p.buffs.poison} 点中毒伤害`);
      state.combat.hits.push({ unit: 'p' + i, hpDmg: p.buffs.poison });
    }
    if (p.buffs.regen > 0) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + p.buffs.regen);
      p.buffs.regen--;
      if (p.hp > before) {
        log(`${p.name} 恢复 ${p.hp - before} 点生命`);
        state.combat.hits.push({ unit: 'p' + i, heal: p.hp - before });
      }
    }
    if (p.hp <= 0) {
      p.dead = true;
      p.block = 0;
      log(`${p.name} 阵亡了`);
    }
    if (!p.dead) {
      p.energy = 3 + (p.buffs.energy || 0) + (hasRelic('abyss_eye') ? 1 : 0);
      drawCards(i, 3 + (p.buffs.draw || 0) + (hasRelic('tide_compass') ? 1 : 0));
    }
  });
  // 护甲已用于抵挡敌人攻击，回合结束清除
  state.party.forEach(p => { p.block = 0; });
  state.subPhase = 'play';
  if (state.party.every(x => x.dead)) { defeat(); return; }
  if (allEnemiesDead()) { state.combat.pendingWin = true; after(); return; } // 击杀演出后再结算奖励
  after();
}
function executeEnemyIntent(e, intent) {
  if (!intent) return;
  const alivePlayers = state.party.filter(p => !p.dead);
  if (!alivePlayers.length) return;
  const atkScale = FLOOR_SCALE[state.run.floor - 1] || 1;
  const ctx = { enemy: e };
  switch (intent.t) {
    case 'attack': {
      const tgt = pick(alivePlayers);
      log(`${e.name} 攻击 ${tgt.name}`);
      dealDamage(tgt, Math.round(intent.n * atkScale), ctx);
      buzz(40); // 受击触觉反馈
      break;
    }
    case 'multi': {
      const tgt = pick(alivePlayers);
      log(`${e.name} 连续攻击 ${tgt.name}`);
      for (let i = 0; i < intent.times; i++) dealDamage(tgt, Math.round(intent.n * atkScale), ctx);
      buzz(40); // 受击触觉反馈
      break;
    }
    case 'allAttack': {
      log(`${e.name} 发动全体攻击`);
      alivePlayers.forEach(p => dealDamage(p, Math.round(intent.n * atkScale), ctx));
      buzz(40); // 受击触觉反馈
      break;
    }
    case 'block':
      e.block += intent.n;
      log(`${e.name} 获得了${intent.n}点护甲`);
      break;
    case 'buff': {
      e.buffs[intent.buff] = (e.buffs[intent.buff] || 0) + intent.n;
      const nm = BUFF_META[intent.buff] ? BUFF_META[intent.buff].name : intent.buff;
      log(`${e.name} 强化了${nm}`);
      break;
    }
    case 'debuff': {
      const tgt = pick(alivePlayers);
      tgt.buffs[intent.status] = (tgt.buffs[intent.status] || 0) + intent.n;
      const nm = BUFF_META[intent.status] ? BUFF_META[intent.status].name : intent.status;
      log(`${tgt.name} 获得${intent.n}层${nm}`);
      break;
    }
    case 'allDebuff': {
      const nm = BUFF_META[intent.status] ? BUFF_META[intent.status].name : intent.status;
      alivePlayers.forEach(p => { p.buffs[intent.status] = (p.buffs[intent.status] || 0) + intent.n; });
      log(`全体队员获得${intent.n}层${nm}`);
      break;
    }
    case 'summon': {
      const def = ENEMIES[intent.enemy];
      if (!def) break;
      const scale = FLOOR_SCALE[state.run.floor - 1];
      const ne = {
        id: state.nextUid++, defId: intent.enemy, name: def.name,
        hp: Math.round(def.hp * scale), maxHp: Math.round(def.hp * scale),
        block: 0, buffs: emptyBuffs(), intent: null, intentIdx: 0,
        isBoss: false, elite: false,
      };
      state.combat.enemyGroup.push(ne);
      log(`${e.name} 召唤了 ${def.name}`);
      break;
    }
    case 'heal': {
      e.hp = Math.min(e.maxHp, e.hp + intent.n);
      log(`${e.name} 恢复了${intent.n}点生命`);
      break;
    }
  }
  state.party.forEach(p => { if (p.hp <= 0 && !p.dead) { p.dead = true; p.block = 0; log(`${p.name} 倒下了`); } });
}

/* ---------- 战斗结束 ---------- */
/* 击杀演出结束：进入奖励结算（由渲染层定时器在死亡动画后调用） */
function stepKillSettle() {
  if (state.phase !== 'combat' || !state.combat || !state.combat.pendingWin) return;
  state.combat.pendingWin = false;
  combatWon();
}
function combatWon() {
  state.combat.over = true;
  state.subPhase = null;
  if (state.combat.bossName && !state.combat.finalKill) state.combat.finalKill = state.combat.bossName;
  state.run.kills++;
  let extraRelic = false;
  if (state.pendingFight) {
    if (state.pendingFight.reward === 'relic') extraRelic = true;
    if (state.pendingFight.gold) state.run.gold += state.pendingFight.gold;
    state.pendingFight = null;
  }
  const node = currentNode();
  if (node && (node.type === 'elite' || node.type === 'boss')) {
    state.run.elitesKilled++;
    extraRelic = true;
  }
  let gold = 8 + state.run.floor * 4 + rndInt(8);
  if (hasRelic('pearl_necklace')) gold = Math.round(gold * 1.2);
  state.run.gold += gold;
  const poolSize = 2 + state.party.length + (hasRelic('abyss_beacon') ? 1 : 0);
  const cards = genRewardCards(Math.min(8, poolSize));
  const relics = extraRelic ? [pickUnownedRelic()].filter(Boolean) : [];
  const picksLeft = state.party.filter(p => !p.dead).length;
  state.reward = { gold, cards, relics, pendingCardIdx: null, picksLeft };
  state.party.forEach(p => { if (p.dead) { p.dead = false; p.hp = 1; } });
  log(`战斗胜利！获得 ${gold} 金币`);
  state.phase = 'reward';
  after();
}
function genRewardCards(n) {
  const pool = allCardPool();
  const out = [];
  const used = new Set();
  let guard = 0;
  while (out.length < n && guard++ < 200) {
    const id = weightedPick(pool.map(cid => ({ item: cid, w: CARD_RARITY_WEIGHT[CARDS[cid].rarity] || 60 })));
    if (used.has(id)) continue;
    used.add(id);
    out.push(id);
  }
  return out;
}
function defeat() {
  state.phase = 'defeat';
  state.gameOver = true;
  saveMeta();
  clearSave();
  after();
}
function victory() {
  state.phase = 'victory';
  state.gameOver = true;
  state.unlock.wins = (state.unlock.wins || 0) + 1;
  state.unlock.hardMode = true;
  saveMeta();
  clearSave();
  after();
}

/* ---------- 奖励 ---------- */
function pickRewardCard(idx) {
  const r = state.reward;
  if (!r || !r.cards[idx]) return;
  r.pendingCardIdx = idx;
  after();
}
/* 奖励界面结束时入账遗物（展示型奖励，离开/选卡后领取） */
function grantRewardRelics() {
  const r = state.reward;
  if (!r) return;
  (r.relics || []).forEach(rid => {
    if (rid && !state.run.relicIds.includes(rid)) state.run.relicIds.push(rid);
  });
}
function rewardGive(playerIdx) {
  const r = state.reward;
  if (r.pendingCardIdx === null) return;
  const p = state.party[playerIdx];
  if (!p || p.dead) return;
  const cid = r.cards[r.pendingCardIdx];
  p.deck.push(cardInst(cid));
  state.unlock.seenCards.push(cid);
  r.picksLeft--;
  if (r.picksLeft <= 0) {
    grantRewardRelics();
    state.reward = null;
    completeNode();
  } else {
    r.cards.splice(r.pendingCardIdx, 1);
    r.pendingCardIdx = null;
    after();
  }
}
function skipReward() {
  if (!state.reward) return;
  grantRewardRelics();
  state.reward = null;
  completeNode();
}

/* ---------- 商店 ---------- */
function genShop() {
  const items = [];
  for (let i = 0; i < 2; i++) {
    const cid = randomRewardCard();
    items.push({ kind: 'card', cardId: cid, price: SHOP_PRICES[RARITY_PRICE_KEY[CARDS[cid].rarity]], sold: false });
  }
  const relicId = pickUnownedRelic();
  if (relicId) items.push({ kind: 'relic', relicId, price: SHOP_PRICES.relic, sold: false });
  items.push({ kind: 'remove', price: SHOP_PRICES.remove, sold: false });
  items.push({ kind: 'heal', price: SHOP_PRICES.heal, sold: false });
  return { items, pendingBuyIdx: null, confirmIdx: null, removeMode: false };
}
function buyShopItem(idx) {
  const s = state.shop;
  const it = s.items[idx];
  if (!it || it.sold) return;
  if (state.run.gold < it.price) { showToast('金币不足'); return; }
  s.confirmIdx = idx;
  after();
}
function buyConfirm() {
  const s = state.shop;
  if (s.confirmIdx === null) return;
  const idx = s.confirmIdx;
  s.confirmIdx = null;
  const it = s.items[idx];
  if (!it || it.sold) { after(); return; }
  if (state.run.gold < it.price) { showToast('金币不足'); after(); return; }
  if (it.kind === 'card') {
    s.pendingBuyIdx = idx;
    after();
    return;
  }
  if (it.kind === 'relic') {
    state.run.gold -= it.price;
    state.run.relicIds.push(it.relicId);
    it.sold = true;
    after();
    return;
  }
  if (it.kind === 'remove') {
    s.removeMode = true;
    after();
    return;
  }
  if (it.kind === 'heal') {
    state.run.gold -= it.price;
    state.party.forEach(p => { if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.2)); });
    it.sold = true;
    after();
    return;
  }
}
function buyCancel() {
  const s = state.shop;
  if (s.confirmIdx !== null) s.confirmIdx = null;
  if (s.pendingBuyIdx !== null) s.pendingBuyIdx = null;
  after();
}
function buyGive(playerIdx) {
  const s = state.shop;
  if (s.pendingBuyIdx === null) return;
  const it = s.items[s.pendingBuyIdx];
  if (!it || it.kind !== 'card' || it.sold) return;
  const p = state.party[playerIdx];
  if (!p || p.dead) return;
  state.run.gold -= it.price;
  p.deck.push(cardInst(it.cardId));
  state.unlock.seenCards.push(it.cardId);
  it.sold = true;
  s.pendingBuyIdx = null;
  after();
}
function shopRemoveCard(playerIdx, arg) {
  const p = state.party[playerIdx];
  if (!p) return;
  const idx = typeof arg === 'string' ? p.deck.findIndex(c => c.id === arg) : arg;
  if (idx < 0 || idx >= p.deck.length) return;
  const it = state.shop.items.find(x => x.kind === 'remove' && !x.sold);
  if (!it) return;
  state.run.gold -= it.price;
  p.deck.splice(idx, 1);
  it.sold = true;
  state.shop.removeMode = false;
  after();
}

/* ---------- 事件 ---------- */
function pickEventOption(idx) {
  const ev = state.event;
  if (!ev || ev.chosen !== null) return;
  const def = EVENTS[ev.defId];
  const opt = def.options[idx];
  if (!opt) return;
  if (opt.eff.t === 'goldPay' && state.run.gold < opt.eff.n) { showToast('金币不足'); return; }
  if (opt.eff.t === 'relic' && opt.eff.id && state.run.relicIds.includes(opt.eff.id)) { showToast('已拥有该遗物'); return; }
  ev.chosen = idx;
  executeEventEff(opt.eff);
  if (opt.result) {
    ev.result = opt.result + (state.event.result ? '（' + state.event.result + '）' : '');
  }
  after();
}
function executeEventEff(eff) {
  state.event.result = '';
  switch (eff.t) {
    case 'heal':
      state.party.forEach(p => { if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + eff.n); });
      state.event.result = `全队恢复${eff.n}点生命`;
      break;
    case 'healPercent':
      state.party.forEach(p => { if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * eff.n)); });
      state.event.result = `全队恢复${Math.round(eff.n * 100)}%生命`;
      break;
    case 'gold': {
      if (eff.risk !== undefined && rng() < eff.risk) {
        startCombat(pick(ENCOUNTERS[Math.min(state.run.floor - 1, ENCOUNTERS.length - 1)]));
        return;
      }
      state.run.gold += eff.n;
      state.event.result = `获得${eff.n}金币`;
      break;
    }
    case 'card': {
      const cid = eff.rarity === 'rare' ? weightedPick(rareOnly()) : randomRewardCard();
      const def = cdef({ id: cid });
      state.party[0].deck.push(cardInst(cid));
      state.unlock.seenCards.push(cid);
      state.event.result = `获得卡牌【${def ? def.name : cid}】`;
      break;
    }
    case 'relic': {
      const rid = eff.id || pickUnownedRelic();
      if (rid) state.run.relicIds.push(rid);
      const rdef = RELICS[rid];
      state.event.result = rid ? `获得遗物【${rdef ? rdef.name : rid}】` : '没有可获得的遗物了';
      break;
    }
    case 'allBuff': {
      state.run.permanentBuffs[eff.buff] = (state.run.permanentBuffs[eff.buff] || 0) + eff.n;
      const bm = BUFF_META[eff.buff];
      state.event.result = `全员获得${eff.n}层${bm ? bm.name : eff.buff}`;
      break;
    }
    case 'loseHp': {
      const p = state.party[0];
      p.hp -= eff.n;
      let msg = `${p.name}失去${eff.n}生命`;
      if (eff.then === 'relic') {
        const rid = pickUnownedRelic();
        if (rid) state.run.relicIds.push(rid);
        const rdef = RELICS[rid];
        msg += `，获得遗物【${rdef ? rdef.name : rid}】`;
      }
      state.event.result = msg;
      if (p.hp <= 0) {
        p.dead = true;
        if (state.party.every(x => x.dead)) { defeat(); return; }
      }
      break;
    }
    case 'goldPay': {
      state.run.gold -= eff.n;
      let msg = `支付${eff.n}金币`;
      if (eff.then === 'card') {
        const cid = weightedPick(rareOnly());
        const def = cdef({ id: cid });
        state.party[0].deck.push(cardInst(cid));
        state.unlock.seenCards.push(cid);
        msg += `，获得稀有卡牌【${def ? def.name : cid}】`;
      }
      state.event.result = msg;
      break;
    }
    case 'fight': {
      const ids = eff.elite ? pick(ELITES) : [eff.enemy || 'deep_one'];
      state.pendingFight = { reward: eff.reward || null };
      startCombat(ids);
      return;
    }
    case 'nothing': state.event.result = '什么都没有发生……'; break;
  }
}

/* ---------- 休息 ---------- */
/* 每个休息点：无石板二选一；有石板（远古石板）可同时选两个（各一次） */
function restHealUsable() {
  const r = state.rest || {};
  return !r.usedHeal && (!r.usedUpgrade || hasRelic('ancient_tablet'));
}
function restUpgradeUsable() {
  const r = state.rest || {};
  return !r.usedUpgrade && (!r.usedHeal || hasRelic('ancient_tablet'));
}
function restHeal() {
  if (!restHealUsable()) { showToast('本休息点已使用'); return; }
  if (!state.party.some(p => !p.dead && p.hp < p.maxHp)) { showToast('全队生命已满'); return; }
  state.party.forEach(p => { if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.3)); });
  state.rest.usedHeal = true;
  after();
}
function toggleRestUpgrade() {
  if (!restUpgradeUsable()) { showToast('本休息点已使用'); return; }
  state.rest.upgradeMode = !state.rest.upgradeMode;
  after();
}
function restSelectCard(playerIdx, arg) {
  if (!restUpgradeUsable()) return;
  const p = state.party[playerIdx];
  if (!p) return;
  let targetId = null;
  if (typeof arg === 'string') targetId = arg;
  else {
    const d = p.deck[arg];
    if (d) targetId = d.id;
  }
  if (!targetId) return;
  if (p.deck.filter(c => c.id === targetId).every(c => c.upg)) { showToast('该卡牌已经锻造过'); return; }
  state.rest.confirmCard = { playerIdx, targetId };
  after();
}
function restUpgradeConfirm() {
  const cc = state.rest.confirmCard;
  if (!cc) return;
  if (!restUpgradeUsable()) { state.rest.confirmCard = null; after(); return; }
  const p = state.party[cc.playerIdx];
  if (!p) { state.rest.confirmCard = null; after(); return; }
  const def = cdef({ id: cc.targetId });
  const cname = def ? def.name : cc.targetId;
  p.deck.forEach(c => { if (c.id === cc.targetId) c.upg = true; });
  state.rest.usedUpgrade = true;
  state.rest.upgradeMode = false;
  state.rest.confirmCard = null;
  state.rest.lastUpgrade = `${cname}+`;
  showToast(`锻造成功：${cname}+`);
  after();
}
function restUpgradeCancel() {
  state.rest.confirmCard = null;
  after();
}

/* ---------- 节点离开 / 返回菜单 ---------- */
function leaveMapNode() {
  if (state.phase === 'event' && state.event && state.event.chosen === null) return;
  completeNode();
}
/* 返回菜单会清除本局进度，地图页需二次确认；结束页（defeat/victory）无进度可丢，直接返回 */
function requestQuit() {
  if (state.phase !== 'map') { returnMenu(); return; }
  state.quitConfirm = true;
  after();
}
function cancelQuit() {
  if (!state.quitConfirm) return;
  state.quitConfirm = false;
  after();
}
function returnMenu() {
  clearSave();
  const meta = state.unlock;
  state = freshMenuState();
  state.unlock = meta;
  after();
}

/* ---------- 联机契约（阶段二接入 online-boilerplate） ---------- */
window._getOnlineState = () => state;
window._applyOnlineState = function (s) {
  state = s;
  rng = mulberry32(state.seed || 1);
  render();
};
window._olIsActor = () => true;
/* 敌人分步行动：render.js 定时器驱动，每步间隔一个敌人 */
window.stepEnemyAct = stepEnemyAct;
window.stepKillSettle = stepKillSettle;
