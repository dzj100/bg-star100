/**
 * ============================================================
 * 弑君者 (Regicide) - 游戏逻辑
 * 合作制卡牌桌游发牌助手
 * ============================================================
 */

/* ============================================================
   常量定义
   ============================================================ */

/** localStorage 存储键名 */
const STORAGE_KEY = 'regicide-state';

/** 四种花色标识 */
const SUITS = ['h', 'd', 's', 'c'];

/** 花色显示名称映射 */
const SUIT_NAMES = { h: '♥', d: '♦', s: '♠', c: '♣' };

/** 花色技能名称映射 */
const SUIT_SKILL = { h: '治愈', d: '增援', s: '虚弱', c: '强力' };

/** 震慑效果描述 */
const INTIMIDATE_DESC = {
  h: '无法从弃牌堆回收卡牌',
  d: '无法从酒馆抽取卡牌',
  s: '无法降低Boss攻击力',
  c: '受到伤害不会翻倍',
};

/** 卡牌等级显示名称 */
const RANK_NAMES = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5',
  6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  J: 'J', Q: 'Q', K: 'K', joker: '🃏'
};

/** 各人数对应的手牌上限 */
const HAND_LIMIT = { 1: 8, 2: 7, 3: 6, 4: 5 };

/** Boss属性配置：J骑士/Q王后/K国王 */
const BOSS_STATS = {
  J: { hp: 20, atk: 10, name: '骑士' },
  Q: { hp: 30, atk: 15, name: '王后' },
  K: { hp: 40, atk: 20, name: '国王' }
};

/* ============================================================
   全局状态
   ============================================================ */

/** 游戏状态对象 */
let state = null;

/** 设置页当前选择的人数 */
let selectedCount = 2;

/* ============================================================
   工具函数
   ============================================================ */

/**
 * Fisher-Yates 洗牌算法
 * @param {Array} arr - 待洗牌的数组
 * @returns {Array} 洗牌后的新数组（不修改原数组）
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 生成卡牌唯一ID
 * @param {string} suit - 花色 (h/d/s/c/joker)
 * @param {number|string} rank - 点数 (1-10/J/Q/K/joker)
 * @returns {string} 卡牌ID，如 "h5", "dJ", "jokerjoker"
 */
function cardId(suit, rank) {
  return suit + rank;
}

/**
 * 获取卡牌的数值
 * J=10, Q=15, K=20, 小丑=0, 数字牌=数字本身
 * @param {number|string} rank - 卡牌等级
 * @returns {number} 卡牌数值
 */
function cardValue(rank) {
  if (rank === 'J') return 10;
  if (rank === 'Q') return 15;
  if (rank === 'K') return 20;
  if (rank === 'joker') return 0;
  return rank;
}

/**
 * 创建一张卡牌对象
 * @param {string} suit - 花色
 * @param {number|string} rank - 点数
 * @returns {Object} 卡牌对象 {id, suit, rank, value}
 */
function makeCard(suit, rank) {
  return { id: cardId(suit, rank), suit, rank, value: cardValue(rank) };
}

/* ============================================================
   持久化（localStorage）
   ============================================================ */

/**
 * 保存游戏状态到 localStorage
 * 每次状态变更后调用
 */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}

/**
 * 从 localStorage 加载游戏状态
 * @returns {Object|null} 有效的游戏状态，或 null
 */
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.phase && s.players) return s;
  } catch (e) {}
  return null;
}

/**
 * 清除 localStorage 中的游戏存档
 */
function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

/* ============================================================
   页面导航
   ============================================================ */

/**
 * 显示首页（隐藏设置和游戏界面）
 */
function showLanding() {
  document.getElementById('landing').style.display = 'flex';
  document.getElementById('setup').style.display = 'none';
  document.getElementById('game').style.display = 'none';
}

/**
 * 显示设置页（隐藏首页和游戏界面）
 */
function showSetup() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('setup').style.display = 'flex';
  document.getElementById('game').style.display = 'none';
  renderSetup();
}

/**
 * 显示游戏界面（隐藏首页和设置页）
 */
function showGame() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('setup').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
  renderGame();
}

/* ============================================================
   设置页逻辑
   ============================================================ */

/**
 * 渲染设置页：人数选择按钮和玩家名字输入框
 * 根据 selectedCount 动态生成对应数量的输入框
 */
function renderSetup() {
  const countSelect = document.getElementById('countSelect');
  countSelect.innerHTML = [1, 2, 3, 4].map(n =>
    `<button class="count-btn${n === selectedCount ? ' active' : ''}" onclick="selectCount(${n})">${n}人</button>`
  ).join('');

  const inputs = document.getElementById('playerInputs');
  inputs.innerHTML = '';
  for (let i = 0; i < selectedCount; i++) {
    const div = document.createElement('div');
    div.className = 'player-input';
    div.innerHTML = `<label>玩家${i + 1}</label><input id="pname${i}" type="text" placeholder="输入名字" maxlength="8">`;
    inputs.appendChild(div);
  }
  document.getElementById('startGameBtn').disabled = false;
}

/**
 * 选择玩家人数
 * @param {number} n - 人数 (1-4)
 */
function selectCount(n) {
  selectedCount = n;
  renderSetup();
}

/**
 * 开始游戏：收集玩家名字，初始化游戏状态
 * 如果未输入名字则使用默认名"玩家N"
 */
function startGame() {
  const players = [];
  for (let i = 0; i < selectedCount; i++) {
    const input = document.getElementById('pname' + i);
    const name = (input && input.value.trim()) || ('玩家' + (i + 1));
    players.push({ name, hand: [], handLimit: HAND_LIMIT[selectedCount] });
  }
  initState(players, selectedCount);
  saveState();
  showGame();
}

/* ============================================================
   游戏初始化
   ============================================================ */

/**
 * 初始化游戏状态
 * 创建城堡队列（J→Q→K）、洗牌酒馆、发牌（含方片保底）、翻开首个Boss
 * @param {Array} players - 玩家数组
 * @param {number} playerCount - 玩家人数
 */
function initState(players, playerCount) {
  state = {
    phase: 'playing',          // 游戏阶段: playing | game-over
    subPhase: 'play',          // 回合子阶段: play | skill | damage | boss-attack | defense | joker-pick
    playerCount,
    players,
    currentPlayerIndex: 0,     // 当前行动玩家索引
    castle: [],                // 城堡Boss队列（索引0为即将出场的Boss）
    tavern: [],                // 酒馆牌库（索引0为牌顶）
    discardPile: [],           // 弃牌堆
    killPile: [],              // 击杀牌堆
    convertedPile: [],         // 感化牌堆
    currentBoss: null,         // 当前Boss信息对象
    soloJokers: playerCount === 1 ? 2 : 0,  // 单人模式小丑牌剩余使用次数
    playedCards: [],           // 本回合打出的牌
    extraTurnPlayer: null,     // 小丑指定的额外回合玩家索引
    extraTurnIntimidate: false, // 额外回合内震慑是否失效
    jokerUser: null,           // 打出小丑牌的玩家索引（用于回合流转）
    pendingWeaken: 0,          // 被震慑封印、待小丑解封后补结算的虚弱累计值
    gameResult: null,          // 游戏结果: 'win' | 'lose' | null
    log: [],                   // 游戏日志（最新在前）
    convertedCount: 0,         // 感化Boss计数
    killedCount: 0,            // 击杀Boss计数
    selectedHandIndices: [],   // 出牌阶段选中的手牌索引
    defenseSelectedIndices: [], // 防御阶段选中的手牌索引
    skillResults: [],          // 技能结算结果数组
    turnCount: 0,              // 回合计数
    consecutivePasses: 0,      // 连续放弃出牌计数（最多2次）
  };

  // 构建城堡：J在最前（最先出场），Q在中间，K在最后
  const kings = shuffle(SUITS.map(s => makeCard(s, 'K')));
  const queens = shuffle(SUITS.map(s => makeCard(s, 'Q')));
  const jacks = shuffle(SUITS.map(s => makeCard(s, 'J')));
  state.castle = [...jacks, ...queens, ...kings];

  // 发牌（同时构建酒馆牌库，保证至少1张方片）
  dealCards();

  // 翻开第一个Boss
  revealNextBoss();
}

/**
 * 发牌：洗牌酒馆并向每位玩家发满手牌
 * 重复尝试最多100次，确保所有玩家手牌中至少有1张方片
 * 同时根据人数决定是否加入小丑牌到酒馆
 */
function dealCards() {
  const limit = HAND_LIMIT[state.playerCount];
  let attempts = 0;
  do {
    // 重置所有玩家手牌
    for (const p of state.players) p.hand = [];

    // 构建酒馆牌库：40张数字牌 + 小丑牌
    let tavernCards = [];
    for (const s of SUITS) {
      for (let r = 1; r <= 10; r++) {
        tavernCards.push(makeCard(s, r));
      }
    }
    // 3人局加1张小丑，4人局加2张小丑
    const jokerCount = state.playerCount === 3 ? 1 : state.playerCount === 4 ? 2 : 0;
    for (let i = 0; i < jokerCount; i++) {
      tavernCards.push(makeCard('joker', 'joker'));
    }
    state.tavern = shuffle(tavernCards);
    state.discardPile = [];

    // 依次给每位玩家发牌至手牌上限
    for (const p of state.players) {
      for (let i = 0; i < limit; i++) {
        if (state.tavern.length > 0) {
          p.hand.push(state.tavern.shift());
        }
      }
    }
    attempts++;

    // 检查是否至少有1张方片
    const hasDiamond = state.players.some(p => p.hand.some(c => c.suit === 'd'));
    if (hasDiamond) break;
  } while (attempts < 100);
}

/**
 * 从城堡翻开下一个Boss
 * 如果城堡为空则判定胜利
 * 重置Boss相关的子阶段和选择状态
 */
function revealNextBoss() {
  if (state.castle.length === 0) {
    state.gameResult = 'win';
    state.phase = 'game-over';
    return;
  }
  const card = state.castle.shift();
  const rank = card.rank;
  const stats = BOSS_STATS[rank];
  state.currentBoss = {
    card,
    maxHp: stats.hp,
    hp: stats.hp,
    attack: stats.atk,
    currentAttack: stats.atk,    // 受黑桃虚弱影响的当前攻击力
    suit: card.suit,
    intimidateActive: true,      // 震慑是否有效
    name: stats.name,
  };
  state.pendingWeaken = 0;       // 新Boss登场，前一个Boss的"虚弱欠条"作废
  state.subPhase = 'play';
  state.playedCards = [];
  state.selectedHandIndices = [];
  state.defenseSelectedIndices = [];
  addLog(`新Boss出现: ${SUIT_NAMES[card.suit]}${rank} ${stats.name} (${stats.hp}血/${stats.atk}攻)`);
}

/**
 * 添加一条日志（最新在前，最多保留50条）
 * @param {string} msg - 日志内容
 */
function addLog(msg) {
  state.log.unshift(msg);
  if (state.log.length > 50) state.log.pop();
}

/* ============================================================
   游戏渲染主函数
   ============================================================ */

/**
 * 渲染游戏主界面
 * 根据当前 subPhase 分发渲染不同的阶段内容
 * 每次状态变更后调用
 */
function renderGame() {
  if (!state) return;
  if (state.phase === 'game-over') {
    renderGameOver();
    return;
  }
  const content = document.getElementById('gameContent');

  let topHTML = renderInfoBar() + renderLogToggle();
  let centerHTML = renderBossArea();
  let bottomHTML = '';

  switch (state.subPhase) {
    case 'play': bottomHTML = renderPlayPhase(); break;
    case 'skill': bottomHTML = renderSkillPhase(); break;
    case 'damage': bottomHTML = renderDamagePhase(); break;
    case 'boss-attack': bottomHTML = renderBossAttackPhase(); break;
    case 'defense': bottomHTML = renderDefensePhase(); break;
    case 'joker-pick': bottomHTML = renderJokerPickPhase(); break;
  }

  let sidebarHTML = renderPlayerSidebar();

  content.innerHTML = `
    <div class="top-section">${topHTML}</div>
    <div class="center-section">${centerHTML}</div>
    <div class="bottom-section">${bottomHTML}</div>
    ${sidebarHTML}
  `;

  // 血条/攻击条过渡动画：先用旧宽度渲染，再更新到新宽度
  if (state.currentBoss) {
    const b = state.currentBoss;
    const newHp = Math.max(0, (b.hp / b.maxHp) * 100);
    const newAtk = Math.max(0, (b.currentAttack / b.attack) * 100);
    requestAnimationFrame(() => {
      const hpBar = content.querySelector('.bar-fill.hp');
      const atkBar = content.querySelector('.bar-fill:not(.hp)');
      if (hpBar) hpBar.style.width = newHp + '%';
      if (atkBar) atkBar.style.width = newAtk + '%';
    });
    _prevBarWidths = { hp: newHp, atk: newAtk };
  }
}

/* ============================================================
   渲染 - Boss区域
   ============================================================ */

/**
 * 渲染Boss信息卡片
 * 包含Boss卡牌、名称、震慑状态、血量条和攻击力条
 * @returns {string} HTML字符串
 */
function renderBossArea() {
  const b = state.currentBoss;
  if (!b) { _prevBarWidths = { hp: null, atk: null }; return '<div class="boss-area"><p>城堡已清空!</p></div>'; }
  const hpPct = Math.max(0, (b.hp / b.maxHp) * 100);
  const atkPct = Math.max(0, (b.currentAttack / b.attack) * 100);
  const renderHp = _prevBarWidths.hp !== null ? _prevBarWidths.hp : hpPct;
  const renderAtk = _prevBarWidths.atk !== null ? _prevBarWidths.atk : atkPct;
  const suitSymbol = SUIT_NAMES[b.suit];
  const intimidateClass = b.intimidateActive ? '' : 'disabled';
  const intimidateSkill = SUIT_SKILL[b.suit] || '';
  const intimidateDesc = INTIMIDATE_DESC[b.suit] || '';
  const hitClass = state.bossAnim === 'dying' ? ' boss-dying'
    : state.bossAnim === 'entering' ? ' boss-entering'
    : state.subPhase === 'damage' ? ' boss-hit'
    : state.subPhase === 'boss-attack'
      ? (b.currentAttack > 10 ? ' boss-heavy-attack-anim' : ' boss-attack-anim')
      : '';
  return `
    <div class="boss-area${hitClass}">
      <div class="boss-card">
        ${BOSS_SVG[b.card.rank]
          ? `<div class="boss-svg">${BOSS_SVG[b.card.rank]}</div>`
          : `<div class="boss-suit">${suitSymbol}</div>
             <div class="boss-rank">${b.card.rank}</div>
             <div class="boss-name">${b.name}</div>`}
      </div>
      <div class="boss-info">
        <div class="boss-title">${suitSymbol}${b.card.rank} ${b.name}</div>
        <div class="intimidate-tag ${intimidateClass}">震慑 #${intimidateSkill}（${intimidateDesc}）</div>
        <div class="bar-container">
          <span class="bar-label">血量</span>
          <div class="bar-track"><div class="bar-fill hp" style="width:${renderHp}%"></div></div>
          <span class="bar-value">${b.hp}/${b.maxHp}</span>
        </div>
        <div class="bar-container">
          <span class="bar-label">攻击</span>
          <div class="bar-track"><div class="bar-fill" style="width:${renderAtk}%;background:var(--gold)"></div></div>
          <span class="bar-value">${b.currentAttack}/${b.attack}</span>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   渲染 - 信息栏
   ============================================================ */

/**
 * 渲染顶部信息栏：城堡剩余、酒馆剩余、弃牌数量
 * 单人模式额外显示小丑牌剩余使用次数
 * @returns {string} HTML字符串
 */
function renderInfoBar() {
  return `
    <div class="info-bar">
      <div class="info-item" onclick="showCastleInfo()" style="cursor:pointer">
        <div class="info-label">城堡</div>
        <div class="info-value">${state.castle.length}张</div>
      </div>
      <div class="info-item">
        <div class="info-label">酒馆</div>
        <div class="info-value">${state.tavern.length}张</div>
      </div>
      <div class="info-item" onclick="showDiscardPile()" style="cursor:pointer">
        <div class="info-label">弃牌</div>
        <div class="info-value">${state.discardPile.length}张</div>
      </div>
      ${state.playerCount === 1 && state.soloJokers > 0 && (state.subPhase === 'play' || state.subPhase === 'defense') ? `<div class="info-item info-joker" onclick="useSoloJoker()"><div class="info-label">🃏 换牌</div><div class="info-value">${state.soloJokers}次</div></div>` : ''}
    </div>`;
}

/* ============================================================
   渲染 - 卡牌HTML
   ============================================================ */

/**
 * 生成单张卡牌的HTML
 * @param {Object} card - 卡牌对象
 * @param {string} extraClass - 额外CSS类名（如 'selected'）
 * @param {string} onclick - 点击事件的JS代码
 * @returns {string} HTML字符串
 */
function renderCardHTML(card, extraClass = '', onclick = '') {
  const suitClass = 'suit-' + card.suit;
  const isJoker = card.suit === 'joker';
  const skillName = !isJoker ? (SUIT_SKILL[card.suit] || '') : '';
  const skillAttr = (skillName || isJoker) ? `data-skill="${card.suit}" data-value="${card.value}" data-rank="${card.rank}"` : '';
  const centerContent = HAND_CARD_SVG[card.rank]
    ? `<span class="card-svg">${HAND_CARD_SVG[card.rank]}</span>`
    : `<span class="card-center${isJoker ? ' joker-center' : ''}">${SUIT_NAMES[card.suit] || '🃏'}</span>`;
  const bottomLabel = isJoker ? '<span class="card-skill">小丑牌</span>' : (skillName ? `<span class="card-skill">${skillName}</span>` : '');
  return `<div class="card ${suitClass} ${extraClass}" ${onclick ? `onclick="${onclick}"` : ''} ${skillAttr}
    ontouchstart="onCardTouchStart(event)" ontouchend="onCardTouchEnd(event)"
    onmousedown="onCardMouseDown(event)" onmouseup="onCardMouseUp(event)"
    onmouseenter="onCardMouseEnter(event)" onmouseleave="onCardMouseLeave(event)">
    ${isJoker ? '' : `<span class="card-suit">${SUIT_NAMES[card.suit]}</span><span class="card-rank">${RANK_NAMES[card.rank]}</span>`}
    ${centerContent}
    ${bottomLabel}
  </div>`;
}

/** 长按计时器和tooltip元素 */
let _longPressTimer = null;
let _tooltipEl = null;
let _tooltipShown = false;
let _recentTouch = 0; // 最近一次 touchstart 时间戳，用于屏蔽后续幻影鼠标事件

/** 血条/攻击条上一次渲染的宽度百分比，用于过渡动画 */
let _prevBarWidths = { hp: null, atk: null };

/** 防止 resolveBossDamage 在动画期间被重复调用 */
let _resolvingBoss = false;

/**
 * 获取花色技能的详细描述
 * @param {string} suit 花色标识
 * @param {number} value 卡牌数值
 * @returns {{title: string, desc: string}}
 */
function getSkillDescription(suit, value, rank) {
  const name = SUIT_SKILL[suit] || '';
  const isFace = rank === 'J' || rank === 'Q' || rank === 'K';
  const valSuffix = isFace ? ` (数值${value})` : '';
  switch (suit) {
    case 'h': return { title: `♥ 治愈 ${value}`, desc: '从弃牌堆随机取' + value + '张牌，放回酒馆（牌库）底部' + valSuffix };
    case 'd': return { title: `♦ 增援 ${value}`, desc: '玩家轮流从酒馆摸1张牌，如持有手牌上限则跳过，累计摸' + value + '张牌' + valSuffix };
    case 's': return { title: `♠ 虚弱 ${value}`, desc: 'Boss本回合攻击力减少' + value + '点' + valSuffix };
    case 'c': return { title: `♣ 强力`, desc: '本次出牌造成的伤害翻倍' + valSuffix };
    case 'joker': return { title: '🃏 小丑牌', desc: '打出后Boss的震慑失效，指定一名玩家立即执行一个额外回合' };
    default: return { title: '', desc: '' };
  }
}

function showSkillTooltip(el, suit, value, rank) {
  hideSkillTooltip();
  if (!el.isConnected) return;
  _tooltipShown = true;
  const info = getSkillDescription(suit, value, rank);
  if (!info.title) return;
  const tip = document.createElement('div');
  tip.className = 'skill-tooltip';
  tip.innerHTML = `<div class="tip-title ${suit}">${info.title}</div><div>${info.desc}</div>`;
  document.body.appendChild(tip);
  _tooltipEl = tip;
  const rect = el.getBoundingClientRect();
  let top = rect.top - tip.offsetHeight - 8;
  let left = rect.left + rect.width / 2 - tip.offsetWidth / 2;
  if (top < 8) top = rect.bottom + 8;
  if (left < 8) left = 8;
  if (left + tip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - tip.offsetWidth - 8;
  tip.style.top = top + 'px';
  tip.style.left = left + 'px';
}

function hideSkillTooltip() {
  if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
  if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  setTimeout(() => { _tooltipShown = false; }, 200);
}

function onCardTouchStart(e) {
  _recentTouch = Date.now();
  const el = e.currentTarget;
  const suit = el.dataset.skill;
  const value = parseInt(el.dataset.value) || 0;
  const rank = el.dataset.rank;
  if (!suit) return;
  _longPressTimer = setTimeout(() => { showSkillTooltip(el, suit, value, rank); }, 400);
}
function onCardTouchEnd() { hideSkillTooltip(); }
function onCardMouseDown(e) {
  if (Date.now() - _recentTouch < 500) return; // 屏蔽触屏触发的幻影 mousedown
  const el = e.currentTarget;
  const suit = el.dataset.skill;
  const value = parseInt(el.dataset.value) || 0;
  const rank = el.dataset.rank;
  if (!suit) return;
  _longPressTimer = setTimeout(() => { showSkillTooltip(el, suit, value, rank); }, 400);
}
function onCardMouseUp() {
  if (Date.now() - _recentTouch < 500) return;
  hideSkillTooltip();
}
function onCardMouseEnter(e) {
  if (Date.now() - _recentTouch < 500) return;
  const el = e.currentTarget;
  const suit = el.dataset.skill;
  const value = parseInt(el.dataset.value) || 0;
  const rank = el.dataset.rank;
  if (!suit) return;
  _longPressTimer = setTimeout(() => { showSkillTooltip(el, suit, value, rank); }, 400);
}
function onCardMouseLeave() {
  if (Date.now() - _recentTouch < 500) return;
  hideSkillTooltip();
}

/* ============================================================
   出牌阶段（subPhase: 'play'）
   ============================================================ */

/**
 * 渲染出牌阶段界面
 * 显示手牌、已选牌、已出牌区域和操作按钮
 * 包含单人模式的小丑换牌按钮
 * @returns {string} HTML字符串
 */
function renderPlayPhase() {
  const player = state.players[state.currentPlayerIndex];
  const selected = state.selectedHandIndices || [];

  // 渲染手牌
  const jokerPrefix = state.extraTurnPlayer !== null && state.extraTurnIntimidate
    ? '<span class="extra-turn-tag">额外回合</span> ' : '';
  let handHTML = `<div class="hand-section"><div class="hand-label">${jokerPrefix}${player.name} 的手牌 (${player.hand.length}/${player.handLimit})</div><div class="hand-cards">`;
  player.hand.forEach((card, i) => {
    const isSelected = selected.includes(i);
    handHTML += renderCardHTML(card, isSelected ? 'selected' : '', `toggleCardSelect(${i})`);
  });
  handHTML += '</div></div>';

  // 出牌合法性校验
  const validation = validatePlay();
  const canConfirm = validation.valid && selected.length > 0;

  // 操作按钮
  const passes = state.consecutivePasses || 0;
  const passLimit = Math.max(1, state.playerCount - 1);
  const canPass = passes < passLimit;
  let actionsHTML = `<div class="action-bar">`;
  if (selected.length > 0) {
    actionsHTML += `<button class="clear-btn" onclick="clearSelection()">清空选择</button>`;
    actionsHTML += `<button class="confirm-btn" onclick="confirmPlay()" ${canConfirm ? '' : 'disabled'}>确认出牌${validation.valid ? '' : ' <br>(' + validation.reason + ')'}</button>`;
  } else {
    actionsHTML += `<button class="clear-btn" onclick="passPlay()" ${canPass ? '' : 'disabled'}>跳过出牌${canPass ? '' : ` (已连续${passLimit}次，无法跳过)`}</button>`;
  }
  actionsHTML += '</div>';

  // 手牌为空且已无法跳过 → 只能接受失败
  if (player.hand.length === 0 && !canPass) {
    actionsHTML += `<div style="text-align:center;font-size:.85rem;color:var(--danger);margin-top:8px;">无牌可出，且无法继续跳过</div>`;
    actionsHTML += `<div class="action-bar" style="margin-top:8px;"><button class="confirm-btn" style="background:var(--danger)" onclick="gameLose()">接受失败</button></div>`;
  }

  // 无效组合提示
  if (!validation.valid && selected.length > 0) {
    // actionsHTML += `<div style="text-align:center;font-size:.75rem;color:var(--danger);margin-top:4px;">${validation.reason}</div>`;
  }

  return handHTML + actionsHTML;
}

/**
 * 切换手牌选中状态
 * @param {number} index - 手牌数组中的索引
 */
function toggleCardSelect(index) {
  if (_tooltipShown) return;
  if (state.playedCards.length > 0) return;
  if (!state.selectedHandIndices) state.selectedHandIndices = [];
  const idx = state.selectedHandIndices.indexOf(index);
  if (idx >= 0) {
    state.selectedHandIndices.splice(idx, 1);
  } else {
    state.selectedHandIndices.push(index);
  }
  renderGame();
}

/**
 * 清空所有选中的手牌
 */
function clearSelection() {
  state.selectedHandIndices = [];
  renderGame();
}

/**
 * 校验当前选中的手牌是否构成合法出牌组合
 * 合法组合：
 *   - 单张 1~10 或 J/Q/K（感化的Boss牌）
 *   - 对子 1~5（同数字）
 *   - 三条 1~3（同数字）
 *   - 四个1或四个2
 *   - 1+X（1张1 + 1张2~10或J/Q/K）
 *   - 1+对子（1张1 + 2张同数字2~5）
 *   - 1+三条（1张1 + 3张同数字2~3）
 *   - 小丑牌（单独打出）
 * J/Q/K（感化的Boss牌）可单独打出，也可作为X参与1+X组合
 *
 * @returns {Object} {valid: boolean, reason?: string, type?: string}
 */
function validatePlay() {
  const player = state.players[state.currentPlayerIndex];
  const selected = state.selectedHandIndices || [];
  if (selected.length === 0) return { valid: false, reason: '请选择卡牌' };

  const cards = selected.map(i => player.hand[i]);

  // 小丑牌必须单独打出
  const hasJoker = cards.some(c => c.suit === 'joker');
  if (hasJoker) {
    if (cards.length === 1) return { valid: true, type: 'joker' };
    return { valid: false, reason: '小丑牌必须单独打出' };
  }

  const hasFaceCard = cards.some(c => c.rank === 'J' || c.rank === 'Q' || c.rank === 'K');

  const n = cards.length;
  const ranks = cards.map(c => c.rank);
  const allSame = ranks.every(r => r === ranks[0]);
  const firstRank = ranks[0];

  // 单张：1~10 或 J/Q/K
  if (n === 1) {
    if (typeof firstRank === 'number' && firstRank >= 1 && firstRank <= 10) return { valid: true, type: 'single' };
    if (firstRank === 'J' || firstRank === 'Q' || firstRank === 'K') return { valid: true, type: 'single' };
    return { valid: false, reason: '无效的出牌' };
  }

  // 辅助函数：判断卡牌是否可作为X（2~10的数字牌或J/Q/K）
  const isXCard = (c) => {
    if (typeof c.rank === 'number' && c.rank >= 2 && c.rank <= 10) return true;
    if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') return true;
    return false;
  };
  // 辅助函数：判断数字是否可作为对子（2~5）
  const isPairRank = (r) => typeof r === 'number' && r >= 2 && r <= 5;
  // 辅助函数：判断数字是否可作为三条（2~3）
  const isTripleRank = (r) => r === 2 || r === 3;

  // 2张组合：对子(1~5) 或 1+X
  if (n === 2) {
    if (!hasFaceCard && allSame && (firstRank === 1 || isPairRank(firstRank))) return { valid: true, type: 'pair' };
    const ones = cards.filter(c => c.rank === 1);
    const xs = cards.filter(c => c.rank !== 1);
    if (ones.length === 1 && xs.length === 1 && isXCard(xs[0])) return { valid: true, type: '1plus' };
    return { valid: false, reason: '无效的2张组合' };
  }

  // 3张组合：三条(1~3) 或 1+对子(2~5)
  if (n === 3) {
    if (!hasFaceCard && allSame && (firstRank === 1 || isTripleRank(firstRank))) return { valid: true, type: 'three' };
    const ones = cards.filter(c => c.rank === 1);
    const others = cards.filter(c => c.rank !== 1);
    if (ones.length === 1 && others.length === 2) {
      const oRanks = others.map(c => c.rank);
      if (oRanks[0] === oRanks[1] && isPairRank(oRanks[0])) return { valid: true, type: '1plus' };
    }
    return { valid: false, reason: '无效的3张组合' };
  }

  // 4张组合：四个1或四个2 或 1+三条(2~3)
  if (n === 4) {
    if (!hasFaceCard && allSame && (firstRank === 1 || firstRank === 2)) return { valid: true, type: 'four' };
    const ones = cards.filter(c => c.rank === 1);
    const others = cards.filter(c => c.rank !== 1);
    if (ones.length === 1 && others.length === 3) {
      const oRanks = others.map(c => c.rank);
      if (oRanks.every(r => r === oRanks[0]) && isTripleRank(oRanks[0])) return { valid: true, type: '1plus' };
    }
    return { valid: false, reason: '无效的4张组合' };
  }

  return { valid: false, reason: '出牌数量过多' };
}

/**
 * 确认出牌
 * 将选中的手牌从手中移除，进入技能结算阶段
 * 如果是小丑牌则走小丑牌特殊流程
 */
function confirmPlay() {
  const player = state.players[state.currentPlayerIndex];
  const selected = [...state.selectedHandIndices].sort((a, b) => b - a);
  const cards = selected.map(i => player.hand[i]);

  // 震慑花色预警（未勾选"不再提示"时）
  const boss = state.currentBoss;
  const skipTip = sessionStorage.getItem('regicide-skip-intimidate-tip');
  if (boss && boss.intimidateActive && !state.extraTurnIntimidate && !skipTip) {
    const intimidated = cards.filter(c => c.suit === boss.suit && c.suit !== 'joker');
    if (intimidated.length > 0) {
      const suitName = SUIT_NAMES[boss.suit];
      const names = intimidated.map(c => suitName + RANK_NAMES[c.rank]).join('、');
      const content = `
        <h2>⚠️ 震慑预警</h2>
        <p style="text-align:center;color:var(--text-dim);margin:12px 0;">
          当前Boss为 <strong>${suitName}${boss.card.rank} ${boss.name || ''}</strong>，震慑花色 ${suitName}。<br>
          选中的 <strong style="color:var(--danger)">${names}</strong> 技能将失效，仅计入数值。
        </p>
        <p style="text-align:center;margin:8px 0 16px;">
          <label class="chk">
            <input type="checkbox" id="skipIntimidateTip">
            <span class="box"></span>
            本局不再提示
          </label>
        </p>
        <button class="modal-btn primary" onclick="proceedAfterIntimidateTip()">继续出牌</button>
        <button class="modal-btn secondary" onclick="cancelIntimidateTip()">返回更换</button>`;
      openModal(content);
      return;
    }
  }

  doConfirmPlay(cards, selected);
}

/**
 * 真正执行出牌：移出手牌、重置跳过计数、进入技能结算或小丑流程
 * 由 confirmPlay 直接调用，或被震慑预警确认后调用
 */
function doConfirmPlay(cards, selected) {
  const player = state.players[state.currentPlayerIndex];

  // 从手牌中移除（倒序避免索引偏移）
  for (const i of selected) {
    player.hand.splice(i, 1);
  }

  state.playedCards = cards;
  state.selectedHandIndices = [];
  state.consecutivePasses = 0;

  // 小丑牌走特殊流程
  if (cards[0].suit === 'joker') {
    handleJokerPlay();
    return;
  }

  // 在出牌瞬间锁定震慑状态（之后即使小丑移除震慑，本批次的技能仍按当时的震慑判定）
  const boss = state.currentBoss;
  const lockIntimidate = !!(boss && boss.intimidateActive && !state.extraTurnIntimidate);
  const intimidatedSuits = lockIntimidate && boss ? new Set([boss.suit]) : new Set();

  // 进入技能结算阶段
  state.subPhase = 'skill';
  resolveSkills(cards, intimidatedSuits);
  saveState();
  renderGame();
  triggerPendingAnims();
}

/**
 * 震慑预警弹窗 → 继续出牌
 */
function proceedAfterIntimidateTip() {
  const cb = document.getElementById('skipIntimidateTip');
  if (cb && cb.checked) sessionStorage.setItem('regicide-skip-intimidate-tip', '1');
  const player = state.players[state.currentPlayerIndex];
  const selected = [...state.selectedHandIndices].sort((a, b) => b - a);
  const cards = selected.map(i => player.hand[i]);
  closeModal();
  doConfirmPlay(cards, selected);
}

/**
 * 震慑预警弹窗 → 返回更换
 */
function cancelIntimidateTip() {
  const cb = document.getElementById('skipIntimidateTip');
  if (cb && cb.checked) sessionStorage.setItem('regicide-skip-intimidate-tip', '1');
  closeModal();
}

/**
 * 放弃出牌：跳过出牌/技能/伤害/结算阶段，直接进入Boss攻击
 * 连续放弃最多2次，第3次必须出牌
 */
function passPlay() {
  const player = state.players[state.currentPlayerIndex];
  const content = `
    <h2>跳过出牌</h2>
    <p style="text-align:center;color:var(--text-dim);margin:12px 0;">${player.name} 确认跳过本回合出牌？<br>仍需接受Boss攻击</p>
    <button class="modal-btn primary" onclick="confirmPassPlay()">确认跳过</button>
    <button class="modal-btn secondary" onclick="closeModal()">取消</button>`;
  openModal(content);
}

function confirmPassPlay() {
  closeModal();
  state.consecutivePasses = (state.consecutivePasses || 0) + 1;
  const player = state.players[state.currentPlayerIndex];
  addLog(`${player.name} 放弃出牌 (${state.consecutivePasses}/${state.playerCount - 1})`);

  const boss = state.currentBoss;
  if (boss && boss.currentAttack <= 0) {
    addLog(`${SUIT_NAMES[boss.suit]}${boss.card.rank} 攻击力为0，跳过攻击`);
    nextTurn();
    return;
  }

  state.subPhase = 'boss-attack';
  state.selectedHandIndices = [];
  saveState();
  renderGame();
}

/* ============================================================
   技能结算阶段（subPhase: 'skill'）
   ============================================================ */

/**
 * 结算打出卡牌的花色技能
 * 多张牌时先求数字总和，再对每种花色分别按总和结算
 * Boss震慑会阻止对应花色技能触发
 *
 * ♥治愈：从弃牌堆随机取N张放入酒馆底部
 * ♦增援：从当前玩家开始轮流抽牌直到总数达标
 * ♠虚弱：降低Boss当前攻击力
 * ♣强力：标记本次伤害翻倍
 *
 * @param {Array} cards - 打出的卡牌数组
 */
function resolveSkills(cards, intimidatedSuits = new Set()) {
  const totalValue = cards.reduce((sum, c) => sum + c.value, 0);
  const playedSuits = new Set(cards.map(c => c.suit));
  const suitsPresent = ['h', 'd', 's', 'c', 'joker'].filter(s => playedSuits.has(s));
  const boss = state.currentBoss;
  const results = [];

  for (const suit of suitsPresent) {
    // 使用出牌瞬间锁定的震慑状态（避免后续小丑移除震慑时回溯）
    const isIntimidated = intimidatedSuits.has(suit);

    if (isIntimidated) {
      // 黑桃虚弱特殊处理：被震慑时不立即生效，累计到 pendingWeaken，等小丑解封后补结算
      if (suit === 's') {
        state.pendingWeaken = (state.pendingWeaken || 0) + totalValue;
      }
      results.push({ suit, value: totalValue, skill: SUIT_SKILL[suit], blocked: true, detail: `${SUIT_NAMES[suit]}震慑 - 技能失效` });
      continue;
    }
    let detail = '';
    switch (suit) {
      case 'h': {
        // ♥治愈：从弃牌堆随机取N张牌放回酒馆底部
        const n = Math.min(totalValue, state.discardPile.length);
        const healed = [];
        const shuffledDiscard = shuffle(state.discardPile);
        for (let i = 0; i < n; i++) {
          const card = shuffledDiscard[i];
          healed.push(card);
          state.tavern.push(card);
          const idx = state.discardPile.findIndex(c => c.id === card.id);
          if (idx >= 0) state.discardPile.splice(idx, 1);
        }
        detail = `从弃牌堆随机取${n}张牌放入酒馆底部`;
        break;
      }
      case 'd': {
        // ♦增援：从当前玩家开始按座位顺序轮流抽牌（酒馆抽空则停止，不判输）
        let drawn = 0;
        let pIdx = state.currentPlayerIndex;
        const drawnDetails = [];
        let stalled = 0;
        // 防死循环：最大迭代次数 = 目标数 × 人数 + 人数
        let maxIter = totalValue * state.playerCount + state.playerCount;
        while (drawn < totalValue && maxIter-- > 0) {
          const p = state.players[pIdx];
          if (p.hand.length < p.handLimit) {
            if (state.tavern.length === 0) {
              // 酒馆已空，无法继续增援
              stalled = totalValue - drawn;
              break;
            }
            const card = state.tavern.shift();
            p.hand.push(card);
            drawn++;
            drawnDetails.push(`${p.name}抽1张`);
          }
          pIdx = (pIdx + 1) % state.playerCount;
        }
        if (stalled > 0) {
          drawnDetails.push(`酒馆已空(少抽${stalled}张)`);
        }
        detail = drawnDetails.length > 0 ? drawnDetails.join(', ') + ` (共${drawn}张)` : `所有玩家手牌已满`;
        break;
      }
      case 's': {
        // ♠虚弱：降低Boss攻击力，最低到0
        if (boss) {
          const oldAtk = boss.currentAttack;
          boss.currentAttack = Math.max(0, boss.currentAttack - totalValue);
          detail = `Boss攻击力 ${oldAtk} → ${boss.currentAttack}`;
          if (oldAtk !== boss.currentAttack) {
            state._weakenAnim = { value: totalValue, from: oldAtk, to: boss.currentAttack };
          }
        }
        break;
      }
      case 'c': {
        // ♣强力：标记本次伤害翻倍
        detail = `本次伤害翻倍`;
        break;
      }
    }

    results.push({ suit, value: totalValue, skill: SUIT_SKILL[suit], blocked: false, detail });
    addLog(`${state.players[state.currentPlayerIndex].name} ${SUIT_NAMES[suit]}${SUIT_SKILL[suit]}(${totalValue}): ${detail}`);
  }

  state.skillResults = results;
  state.subPhase = 'skill';
}

/**
 * 渲染技能结算结果界面
 * 显示打出的牌、数字总和、每种花色技能的结算详情
 * 被震慑的技能显示为划线样式
 * @returns {string} HTML字符串
 */
function renderSkillPhase() {
  let html = '<div class="skill-result fade-in"><h3>技能结算</h3>';
  const totalValue = state.playedCards.reduce((s, c) => s + c.value, 0);

  html += `<div style="font-size:.85rem;margin-bottom:8px;">打出: ${state.playedCards.map(c => SUIT_NAMES[c.suit] + RANK_NAMES[c.rank]).join(' + ')} = ${totalValue}</div>`;

  for (const r of state.skillResults) {
    html += `<div class="skill-line ${r.blocked ? 'blocked' : ''}">
      <span class="skill-icon">${SUIT_NAMES[r.suit]}</span>
      <span>${r.skill}(${r.value})${r.blocked ? '' : ': ' + r.detail}</span>
    </div>`;
  }

  html += '</div>';
  html += `<div class="action-bar" style="margin-top:8px;"><button class="confirm-btn" onclick="proceedToDamage()">继续 → 造成伤害</button></div>`;
  return html;
}

/* ============================================================
   伤害阶段（subPhase: 'damage'）
   ============================================================ */

/**
 * 进入伤害计算：对Boss造成伤害
 * 伤害 = 牌面数字之和，有梅花则×2
 * 打出的牌移入弃牌堆
 */
function proceedToDamage() {
  const totalValue = state.playedCards.reduce((s, c) => s + c.value, 0);
  const clubNotBlocked = state.skillResults.some(r => r.suit === 'c' && !r.blocked);
  const damage = clubNotBlocked ? totalValue * 2 : totalValue;

  const boss = state.currentBoss;
  boss.hp -= damage;
  addLog(`${state.players[state.currentPlayerIndex].name} 造成 ${damage} 点伤害${clubNotBlocked ? '(梅花双倍)' : ''}! Boss血量: ${boss.hp + damage} → ${boss.hp}`);

  // 打出的牌移入弃牌堆
  for (const c of state.playedCards) {
    state.discardPile.push(c);
  }
  state.playedCards = [];

  state.subPhase = 'damage';
  state.damageDealt = damage;
  state.hasClub = clubNotBlocked;
  state._damageAnim = { value: damage, club: clubNotBlocked };
  saveState();
  renderGame();
  triggerPendingAnims();
}

/**
 * 渲染伤害结算界面
 * 显示伤害数值和Boss剩余血量/击杀/感化状态
 * @returns {string} HTML字符串
 */
function renderDamagePhase() {
  const boss = state.currentBoss;
  const damage = state.damageDealt;
  let html = '<div class="skill-result fade-in"><h3>伤害结算</h3>';
  html += `<div class="skill-line">造成 <strong>${damage}</strong> 点伤害${state.hasClub ? ' (♣强力×2)' : ''}</div>`;

  if (boss.hp < 0) {
    html += `<div class="skill-line" style="color:var(--danger)">Boss被击杀!</div>`;
  } else if (boss.hp === 0) {
    html += `<div class="skill-line" style="color:var(--safe)">Boss被感化! 放回酒馆顶部</div>`;
  } else {
    html += `<div class="skill-line">Boss剩余血量: ${boss.hp}/${boss.maxHp}</div>`;
  }

  html += '</div>';
  html += `<div class="action-bar" style="margin-top:8px;"><button class="confirm-btn" onclick="resolveBossDamage()">继续</button></div>`;
  return html;
}

/**
 * 处理Boss伤害结果
 * - 血量<0：击杀，Boss进入击杀牌堆，翻开下一个Boss
 * - 血量=0：感化，Boss牌放回酒馆顶部，翻开下一个Boss
 * - 血量>0：Boss存活，进入Boss攻击阶段
 * 击杀/感化后当前玩家继续行动（跳过阶段5）
 */
function resolveBossDamage() {
  if (_resolvingBoss) return;
  _resolvingBoss = true;

  const boss = state.currentBoss;
  if (!boss) {
    _resolvingBoss = false;
    state.gameResult = 'win';
    state.phase = 'game-over';
    saveState();
    renderGameOver();
    return;
  }

  if (boss.hp > 0) {
    // Boss存活：进入Boss攻击阶段
    _resolvingBoss = false;
    state.subPhase = 'boss-attack';
    saveState();
    renderGame();
    return;
  }

  // Boss被击杀或感化：播放退场动画
  const isKill = boss.hp < 0;
  state.bossAnim = 'dying';
  saveState();
  renderGame();

  setTimeout(() => {
    // 处理Boss变更
    if (isKill) {
      state.killPile.push(boss.card);
      state.killedCount = (state.killedCount || 0) + 1;
      addLog(`${SUIT_NAMES[boss.suit]}${boss.card.rank} ${boss.name} 被击杀!`);
    } else {
      state.convertedPile = state.convertedPile || [];
      state.convertedPile.push(boss.card);
      state.convertedCount = (state.convertedCount || 0) + 1;
      addLog(`${SUIT_NAMES[boss.suit]}${boss.card.rank} ${boss.name} 被感化!`);
      state.tavern.unshift(boss.card);
    }
    addLog('─────────');
    state.currentBoss = null;
    revealNextBoss();
    if (state.gameResult === 'win') {
      _resolvingBoss = false;
      state.bossAnim = null;
      saveState();
      renderGameOver();
      return;
    }

    // 新Boss入场动画
    state.bossAnim = 'entering';
    state.subPhase = 'play';
    saveState();
    renderGame();
    triggerPendingAnims();

    setTimeout(() => {
      state.bossAnim = null;
      saveState();
      renderGame();
      _resolvingBoss = false;
    }, 1300);
  }, 600);
}

/* ============================================================
   Boss攻击阶段（subPhase: 'boss-attack'）
   ============================================================ */

/**
 * 渲染Boss攻击提示
 * 如果Boss攻击力已被削弱到0，提供跳过按钮
 * 否则引导玩家进入防御阶段
 * @returns {string} HTML字符串
 */
function renderBossAttackPhase() {
  const boss = state.currentBoss;
  let html = `<div class="defense-info fade-in">
    <div class="defense-title">⚔️ Boss攻击!</div>
    <div class="defense-value">${SUIT_NAMES[boss.suit]}${boss.card.rank} ${boss.name} 攻击力: ${boss.currentAttack}${boss.currentAttack < boss.attack ? ` (原${boss.attack})` : ''}</div>
  </div>`;

  if (boss.currentAttack <= 0) {
    html += `<div class="action-bar" style="margin-top:8px;"><button class="confirm-btn" onclick="skipBossAttack()">Boss无力攻击，继续</button></div>`;
  } else {
    html += `<div class="action-bar" style="margin-top:8px;"><button class="confirm-btn" onclick="startDefense()">进入防御</button></div>`;
  }

  return html;
}

/**
 * 跳过Boss攻击（攻击力为0时）
 */
function skipBossAttack() {
  addLog(`${SUIT_NAMES[state.currentBoss.suit]}${state.currentBoss.card.rank} 攻击力为0，跳过攻击`);
  nextTurn();
}

/**
 * 进入防御阶段
 */
function startDefense() {
  state.subPhase = 'defense';
  state.defenseSelectedIndices = [];
  saveState();
  renderGame();
}

/* ============================================================
   防御阶段（subPhase: 'defense'）
   ============================================================ */

/**
 * 渲染防御阶段界面
 * 显示Boss攻击力和当前已选防御牌的数值总和
 * 如果手牌总和不足以防御，显示失败提示
 * 单人模式可使用小丑牌换牌
 * @returns {string} HTML字符串
 */
function renderDefensePhase() {
  const player = state.players[state.currentPlayerIndex];
  const boss = state.currentBoss;
  const selected = state.defenseSelectedIndices || [];
  const selectedCards = selected.map(i => player.hand[i]);
  const defenseValue = selectedCards.reduce((s, c) => s + c.value, 0);
  const isEnough = defenseValue >= boss.currentAttack;

  let html = `<div class="defense-info">
    <div class="defense-title">防御 ${SUIT_NAMES[boss.suit]}${boss.card.rank} ${boss.name}</div>
    <div class="defense-value">需要打出 ≥ ${boss.currentAttack} 的牌</div>
  </div>`;

  // 已选防御牌
  html += `<div class="defense-selected">
    <span style="font-size:.8rem;color:var(--text-dim)">已选: </span>`;
  if (selectedCards.length > 0) {
    html += selectedCards.map(c => SUIT_NAMES[c.suit] + RANK_NAMES[c.rank]).join(' + ');
    html += ` = <span class="def-value ${isEnough ? 'valid' : 'invalid'}">${defenseValue}</span>`;
  } else {
    html += '<span style="color:var(--text-dim)">未选择</span>';
  }
  html += '</div>';

  // 手牌
  const jokerPrefix = state.extraTurnPlayer !== null && state.extraTurnIntimidate
    ? '<span class="extra-turn-tag">额外回合</span> ' : '';
  html += `<div class="hand-section"><div class="hand-label">${jokerPrefix}手牌 (点击选择防御牌)</div><div class="hand-cards">`;
  player.hand.forEach((card, i) => {
    const isSelected = selected.includes(i);
    const isJoker = card.suit === 'joker';
    const extra = (isSelected ? 'selected ' : '') + (isJoker ? 'disabled' : '');
    html += renderCardHTML(card, extra.trim(), isJoker ? '' : `toggleDefenseSelect(${i})`);
  });
  html += '</div></div>';

  // 操作按钮
  html += '<div class="action-bar">';
  if (selected.length > 0) {
    html += `<button class="clear-btn" onclick="clearDefense()">清空</button>`;
    html += `<button class="confirm-btn" onclick="confirmDefense()" ${isEnough ? '' : 'disabled'}>确认防御</button>`;
  }
  html += '</div>';

  if (!isEnough && selected.length > 0) {
    html += `<div style="text-align:center;font-size:.75rem;color:var(--danger);margin-top:4px;">防御值不足</div>`;
  }

  // 检测是否完全无法防御
  const totalHand = player.hand.reduce((s, c) => s + c.value, 0);
  if (totalHand < boss.currentAttack) {
    html += `<div style="text-align:center;font-size:.85rem;color:var(--danger);margin-top:8px;">无法防御! 所有手牌之和(${totalHand}) < 所需(${boss.currentAttack})</div>`;
    html += `<div class="action-bar" style="margin-top:8px;"><button class="confirm-btn" style="background:var(--danger)" onclick="gameLose()">接受失败</button></div>`;
  }

  return html;
}

/**
 * 切换防御牌选中状态
 * @param {number} index - 手牌数组中的索引
 */
function toggleDefenseSelect(index) {
  if (_tooltipShown) return;
  const player = state.players[state.currentPlayerIndex];
  const card = player.hand[index];
  if (card && card.suit === 'joker') return; // 小丑不可用于防御
  if (!state.defenseSelectedIndices) state.defenseSelectedIndices = [];
  const idx = state.defenseSelectedIndices.indexOf(index);
  if (idx >= 0) {
    state.defenseSelectedIndices.splice(idx, 1);
  } else {
    state.defenseSelectedIndices.push(index);
  }
  renderGame();
}

/**
 * 清空已选的防御牌
 */
function clearDefense() {
  state.defenseSelectedIndices = [];
  renderGame();
}

/**
 * 确认防御：打出选中的牌作为防御
 * 防御牌进入弃牌堆，不触发花色技能
 * 防御成功后进入下一回合
 */
function confirmDefense() {
  const player = state.players[state.currentPlayerIndex];
  const selected = [...state.defenseSelectedIndices].sort((a, b) => b - a);
  const cards = selected.map(i => player.hand[i]);
  const defenseValue = cards.reduce((s, c) => s + c.value, 0);

  addLog(`${player.name} 防御: ${cards.map(c => SUIT_NAMES[c.suit] + RANK_NAMES[c.rank]).join('+')} = ${defenseValue}`);

  // 防御牌移入弃牌堆
  for (const i of selected) {
    state.discardPile.push(player.hand[i]);
  }
  player.hand = player.hand.filter((_, i) => !selected.includes(i));

  state.defenseSelectedIndices = [];
  nextTurn();
}

/**
 * 游戏失败：无法防御Boss攻击
 */
function gameLose() {
  state.gameResult = 'lose';
  state.phase = 'game-over';
  addLog('无法防御Boss攻击，讨伐失败!');
  saveState();
  renderGameOver();
}

/* ============================================================
   小丑牌处理
   ============================================================ */

/**
 * 处理小丑牌打出
 * 效果：
 *   1. 当前Boss永久失去震慑
 *   2. 跳过本回合阶段3/4/5（不造成伤害、不Boss攻击）
 *   3. 多人模式：指定一名其他玩家执行额外回合（震慑失效）
 *   4. 单人模式：直接进入下一回合
 * 记录 jokerUser 以便额外回合结束后回到正确的下一个玩家
 */
function handleJokerPlay() {
  const boss = state.currentBoss;
  if (boss) {
    boss.intimidateActive = false;
    state._intimidateShatter = true;
    addLog(`${state.players[state.currentPlayerIndex].name} 🃏 小丑牌! ${SUIT_NAMES[boss.suit]}${boss.card.rank} 永久失去震慑!`);

    // 解封后补结算此前被震慑封印的虚弱累计值
    const pending = state.pendingWeaken || 0;
    if (pending > 0) {
      const oldAtk = boss.currentAttack;
      boss.currentAttack = Math.max(0, boss.currentAttack - pending);
      addLog(`🃏 解封虚弱! Boss攻击力补扣 ${pending} 点 (${oldAtk} → ${boss.currentAttack})`);
      state._weakenAnim = { value: pending, from: oldAtk, to: boss.currentAttack, isUnseal: true };
      state.pendingWeaken = 0;
    }
  }

  // 小丑牌移入弃牌堆
  state.discardPile.push(state.playedCards[0]);
  state.playedCards = [];
  state.jokerUser = state.currentPlayerIndex;

  if (state.playerCount > 1) {
    // 多人模式：进入玩家选择阶段
    state.subPhase = 'joker-pick';
  } else {
    // 单人模式：直接下一回合
    state.jokerUser = null;
    nextTurn();
  }
  saveState();
  renderGame();
  triggerPendingAnims();
}

/**
 * 渲染小丑牌玩家选择界面（多人模式）
 * 显示所有玩家按钮，当前玩家（自己）置灰不可选
 * @returns {string} HTML字符串
 */
function renderJokerPickPhase() {
  let html = '<div class="skill-result fade-in"><h3>指定一名玩家执行额外回合</h3>';
  html += '<div class="player-pick">';
  state.players.forEach((p, i) => {
    const isCurrent = i === state.currentPlayerIndex;
    html += `<button class="${isCurrent ? 'current' : ''}" onclick="pickJokerPlayer(${i})">${p.name}${isCurrent ? ' (自己)' : ''}</button>`;
  });
  html += '</div></div>';
  return html;
}

/**
 * 选择执行额外回合的玩家
 * 设置 extraTurnIntimidate=true 使该回合内Boss震慑失效
 * @param {number} index - 被选中玩家的索引
 */
function pickJokerPlayer(index) {
  if (index === state.currentPlayerIndex) return;
  state.extraTurnPlayer = index;
  state.extraTurnIntimidate = true;
  addLog(`指定 ${state.players[index].name} 执行额外回合 (震慑失效)`);
  state.currentPlayerIndex = index;
  state.subPhase = 'play';
  state.playedCards = [];
  state.selectedHandIndices = [];
  saveState();
  renderGame();
}

/* ============================================================
   单人模式小丑换牌
   ============================================================ */

/**
 * 单人模式使用小丑牌换牌
 * 效果：弃掉所有手牌 → 从酒馆摸8张新牌
 * 不受震慑影响，一局最多使用2次
 * 如果酒馆不足以摸8张则游戏失败
 */
function useSoloJoker() {
  if (state.soloJokers <= 0) return;
  const player = state.players[0];
  const content = `
    <h2>🃏 小丑换牌</h2>
    <p style="text-align:center;color:var(--text-dim);margin:12px 0;">弃掉当前 ${player.hand.length} 张手牌，从酒馆摸 8 张新牌<br>（剩余 ${state.soloJokers} 次）</p>
    <button class="modal-btn primary" onclick="confirmSoloJoker()">确认换牌</button>
    <button class="modal-btn secondary" onclick="closeModal()">取消</button>`;
  openModal(content);
}

function confirmSoloJoker() {
  closeModal();
  if (state.soloJokers <= 0) return;
  const player = state.players[0];
  addLog(`${player.name} 🃏 使用小丑牌换牌! 弃掉${player.hand.length}张手牌，摸8张新牌`);

  // 弃掉所有手牌
  for (const c of player.hand) {
    state.discardPile.push(c);
  }
  player.hand = [];

  // 摸8张新牌（酒馆不足则摸光，不判输）
  const drawCount = Math.min(8, state.tavern.length);
  for (let i = 0; i < drawCount; i++) {
    player.hand.push(state.tavern.shift());
  }
  if (drawCount < 8) {
    addLog(`酒馆仅余${drawCount}张，换牌摸${drawCount}张`);
  }

  state.soloJokers--;
  state.playedCards = [];
  state.selectedHandIndices = [];
  state.defenseSelectedIndices = [];
  saveState();
  renderGame();
}

/* ============================================================
   回合管理
   ============================================================ */

/**
 * 进入下一回合
 * 回合流转规则：
 *   - 正常回合：currentPlayer → currentPlayer+1
 *   - 小丑额外回合结束后：回到 jokerUser+1（小丑使用者的下一家）
 * 重置所有回合相关的临时状态
 * 检查下一位玩家是否还有牌可用
 */
function nextTurn() {
  if (state.extraTurnPlayer !== null) {
    // 额外回合结束，回到小丑使用者的下一家
    state.currentPlayerIndex = (state.jokerUser + 1) % state.playerCount;
    state.extraTurnPlayer = null;
    state.extraTurnIntimidate = false;
    state.jokerUser = null;
  } else {
    // 正常轮转到下一位玩家
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.playerCount;
  }

  // 重置回合临时状态
  state.subPhase = 'play';
  state.playedCards = [];
  state.selectedHandIndices = [];
  state.defenseSelectedIndices = [];
  state.skillResults = [];
  state.turnCount++;

  saveState();
  renderGame();
}

/* ============================================================
   游戏结束
   ============================================================ */

/**
 * 渲染游戏结束弹窗
 * 显示胜利/失败结果和统计数据（击杀数、感化数、回合数、剩余Boss）
 */
function renderGameOver() {
  const overlay = document.getElementById('gameover-overlay');
  const card = document.getElementById('gameoverCard');
  const isWin = state.gameResult === 'win';

  card.innerHTML = `
    <div class="go-icon">${isWin ? '👑' : '💀'}</div>
    <div class="go-title ${isWin ? 'win' : 'lose'}">${isWin ? '讨伐成功!' : '讨伐失败...'}</div>
    <div class="go-stats">
      击杀: ${state.killedCount || 0} / 感化: ${state.convertedCount || 0}<br>
      回合数: ${state.turnCount}<br>
      剩余Boss: ${state.castle.length}
    </div>
    <div class="go-btns">
      <button class="primary" onclick="restartGame()">再来一局</button>
      <button class="secondary" onclick="backToLanding()">返回首页</button>
    </div>`;
  overlay.classList.add('show');
}

/**
 * 重新开始游戏：关闭结束弹窗，返回设置页
 */
function restartGame() {
  document.getElementById('gameover-overlay').classList.remove('show');
  const keepCount = state && state.playerCount;
  const keepNames = state && state.players ? state.players.map(p => p.name) : [];
  clearState();
  state = null;
  showSetup();
  if (keepCount) {
    selectedCount = keepCount;
    renderSetup();
    keepNames.forEach((name, i) => {
      const input = document.getElementById('pname' + i);
      if (input) input.value = name;
    });
  }
}

/**
 * 返回首页：关闭结束弹窗，清除存档，显示首页
 */
function backToLanding() {
  document.getElementById('gameover-overlay').classList.remove('show');
  clearState();
  state = null;
  showLanding();
}

/* ============================================================
   游戏日志渲染
   ============================================================ */

/**
 * 渲染游戏日志区域（最近15条）
 * @returns {string} HTML字符串，无日志时返回空字符串
 */
function renderLogToggle() {
  if (!state.log || state.log.length === 0) return '';
  const last = state.log.find(l => !l.startsWith('───')) || state.log[0];
  return `<div class="log-toggle" onclick="showFullLog()"><span class="log-last">${last}</span><span class="log-more">▾</span></div>`;
}

/** 弹窗展示全部游戏日志 */
function showFullLog() {
  if (!state.log || state.log.length === 0) return;
  const content = state.log.map(l =>
    l.startsWith('───') ? `<div class="log-sep">${l}</div>` : `<div>${l}</div>`
  ).join('');
  openModal(`<h2>游戏日志</h2><div class="log-area">${content}</div>`);
}

/* ============================================================
   玩家侧边栏
   ============================================================ */

function renderPlayerSidebar() {
  if (state.playerCount <= 1) return '';
  let html = '<div class="player-sidebar">';
  state.players.forEach((p, i) => {
    if (i === state.currentPlayerIndex) return;
    html += `<div class="player-widget" onclick="showPlayerHand(${i})">
      <div class="widget-avatar">👤</div>
      <div class="widget-name">${p.name}</div>
      <div class="widget-count">${p.hand.length}张</div>
    </div>`;
  });
  html += '</div>';
  return html;
}

function showPlayerHand(index) {
  const p = state.players[index];
  if (!p) return;
  let html = `<h2>${p.name} 的手牌 (${p.hand.length})</h2>`;
  html += '<div class="hand-cards" style="flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px;">';
  p.hand.forEach(c => { html += renderCardHTML(c); });
  html += '</div>';
  openModal(html);
}

/* ============================================================
   弹窗管理
   ============================================================ */

/**
 * 显示规则弹窗：展示游戏核心规则摘要
 */
function showRules() {
  const content = `
    <h2>📖 游戏规则</h2>
    <div class="rules-content">
      <h3>目标</h3>
      <p>合作击败城堡中的12个Boss（4骑士→4王后→4国王）</p>

      <h3>手牌上限</h3>
      <table style="width:100%;text-align:center;font-size:.85rem;margin:4px 0;">
        <tr style="color:var(--gold)"><td>1人</td><td>2人</td><td>3人</td><td>4人</td></tr>
        <tr><td>8张</td><td>7张</td><td>6张</td><td>5张</td></tr>
      </table>

      <h3>Boss属性</h3>
      <table style="width:100%;text-align:center;font-size:.85rem;margin:4px 0;">
        <tr style="color:var(--gold)"><td>Boss</td><td>血量</td><td>攻击</td><td>感化后数值</td></tr>
        <tr><td>J 骑士</td><td>20</td><td>10</td><td>10</td></tr>
        <tr><td>Q 王后</td><td>30</td><td>15</td><td>15</td></tr>
        <tr><td>K 国王</td><td>40</td><td>20</td><td>20</td></tr>
      </table>
      <p style="font-size:.75rem;color:var(--text-dim)">感化：恰好将血量扣到0时，Boss牌放入酒馆顶部，后续可被摸起当手牌使用</p>

      <h3>回合阶段</h3>
      <p><strong>① 出牌</strong>：选择合法卡牌组合打出（可跳过，单人限1次、多人至多连续「人数-1」人次）</p>
      <p><strong>② 技能结算</strong>：按花色触发技能效果</p>
      <p><strong>③ 造成伤害</strong>：牌面数字之和扣减Boss血量（梅花×2）</p>
      <p><strong>④ Boss处理</strong>：血量&lt;0击杀 / 恰好=0感化(放入酒馆) / &gt;0进入攻击</p>
      <p><strong>⑤ Boss攻击</strong>：玩家打出手牌≥Boss攻击力进行防御</p>
      <p style="font-size:.75rem;color:var(--text-dim)">Boss被击杀/感化后跳过⑤，下一位Boss登场，当前玩家继续新一回合</p>

      <h3>花色技能</h3>
      <p>♥ <strong>治愈</strong>: 从弃牌堆随机取牌放回酒馆底部</p>
      <p>♦ <strong>增援</strong>: 玩家轮流从酒馆抽牌</p>
      <p>♠ <strong>虚弱</strong>: 降低Boss攻击力</p>
      <p>♣ <strong>强力</strong>: 伤害翻倍</p>

      <h3>Boss震慑</h3>
      <p>Boss花色相同的卡牌技能无法触发</p>
      <p style="font-size:.75rem;color:var(--text-dim)">♥无法回收弃牌 / ♦无法抽牌 / ♠无法降攻 / ♣伤害不翻倍</p>

      <h3>出牌规则</h3>
      <p>单张1~10/J/Q/K / 对子1~5 / 三条1~3 / 四个1或2</p>
      <p>数字1可单独打出、多张组合、或搭配其他牌（1+X）</p>
      <p>多张结算：数字求和，每种花色按总和触发一次（同花色不重复）</p>

      <h3>小丑牌</h3>
      <p>多人：数值视为0，打出后Boss永久失去震慑，指定一名玩家额外回合（2人游戏没有小丑牌; 3人游戏加入1张; 4人游戏加入2张）</p>
      <p>单人：点击顶部🃏换牌按钮，弃掉所有手牌摸8张新牌（限2次）</p>

      <h3>失败条件</h3>
      <p>无法防御Boss攻击 / 既无手牌也无法跳过</p>
    </div>
    <button class="modal-btn primary" onclick="closeModal()">知道了</button>`;
  openModal(content);
}

/**
 * 显示重置确认弹窗
 */
function showReset() {
  const content = `
    <h2>🔄 确认重置</h2>
    <p style="text-align:center;color:var(--text-dim);margin:12px 0;">当前游戏进度将丢失</p>
    <button class="modal-btn primary" onclick="confirmReset()">确认重置</button>
    <button class="modal-btn secondary" onclick="closeModal()">取消</button>`;
  openModal(content);
}

/**
 * 确认重置：关闭弹窗，清除存档，返回首页
 */
function confirmReset() {
  closeModal();
  clearState();
  state = null;
  showLanding();
}

/**
 * 查看城堡信息：击杀/感化的Boss列表
 */
function showCastleInfo() {
  const killPile = state.killPile || [];
  const convertedPile = state.convertedPile || [];
  let html = '<h2>城堡</h2>';
  html += `<div style="text-align:center;font-size:.85rem;color:var(--text-dim);margin:8px 0;">剩余 ${state.castle.length} 张</div>`;

  if (killPile.length > 0) {
    html += `<div style="margin-top:12px;"><div style="font-size:.8rem;color:var(--danger);margin-bottom:6px;">击杀 (${killPile.length})</div>`;
    html += '<div class="hand-cards" style="flex-wrap:wrap;gap:6px;">';
    killPile.forEach(c => { html += renderCardHTML(c); });
    html += '</div></div>';
  }

  if (convertedPile.length > 0) {
    html += `<div style="margin-top:12px;"><div style="font-size:.8rem;color:var(--safe);margin-bottom:6px;">感化 (${convertedPile.length})</div>`;
    html += '<div class="hand-cards" style="flex-wrap:wrap;gap:6px;">';
    convertedPile.forEach(c => { html += renderCardHTML(c); });
    html += '</div></div>';
  }

  if (killPile.length === 0 && convertedPile.length === 0) {
    html += '<p style="text-align:center;color:var(--text-dim);padding:20px;">尚未击败任何Boss</p>';
  }

  openModal(html);
}

/**
 * 查看弃牌堆
 * 以一叠卡片形式展示，最新一张完整显示，后面的以虚影层叠
 */
function showDiscardPile() {
  const pile = state.discardPile;
  if (pile.length === 0) {
    openModal('<h2>弃牌堆</h2><p style="text-align:center;color:var(--text-dim);padding:20px;">暂无弃牌</p>');
    return;
  }
  const showCount = Math.min(pile.length, 6);
  const topCards = pile.slice(-showCount).reverse();
  let stackHTML = '<div class="discard-stack">';
  topCards.forEach((card, i) => {
    const offset = i * 4;
    const opacity = i === 0 ? 1 : Math.max(0.15, 0.5 - i * 0.08);
    const suitClass = 'suit-' + card.suit;
    const ghost = i > 0 ? 'ghost' : '';
    stackHTML += `<div class="stack-card ${suitClass} ${ghost}" style="top:${offset}px;left:${offset}px;z-index:${showCount - i};opacity:${opacity}">
      <span class="card-suit">${SUIT_NAMES[card.suit] || '🃏'}</span>
      <span class="card-rank">${RANK_NAMES[card.rank]}</span>
      <span class="card-center">${SUIT_NAMES[card.suit] || '🃏'}</span>
    </div>`;
  });
  stackHTML += '</div>';
  openModal(`<h2>弃牌堆 (${pile.length}张)</h2>${stackHTML}<p style="text-align:center;color:var(--text-dim);font-size:.75rem;margin-top:12px;">只能查看弃牌堆最上面的1张</p>`);
}

function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
}

/**
 * 关闭弹窗
 */
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}

/* ============================================================
   虚弱动画触发器（renderGame 后调用）
   ============================================================ */

/**
 * 在 renderGame 完成后调用：
 *   - state._weakenAnim → 触发紫色脉冲 + 飘字（isUnseal=true 时飘 "🃏 -N" 金色）
 *   - state._damageAnim → 飘红色伤害数字（-N 或 -N(×2)）
 * 一次性消费 flag，避免重复触发。两者同帧触发时各自独立飘字。
 */
function triggerPendingAnims() {
  const weaken = state && state._weakenAnim;
  const damage = state && state._damageAnim;
  const shatter = state && state._intimidateShatter;
  if (weaken) state._weakenAnim = null;
  if (damage) state._damageAnim = null;
  if (shatter) state._intimidateShatter = null;
  const entering = state && state.bossAnim === 'entering';
  if (!weaken && !damage && !shatter && !entering) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const bossArea = document.querySelector('.boss-area');
      const bossCard = document.querySelector('.boss-card');
      if (!bossArea || !bossCard) return;

      if (weaken) {
        bossArea.classList.remove('boss-weaken-anim');
        void bossArea.offsetWidth;
        bossArea.classList.add('boss-weaken-anim');
        const text = weaken.isUnseal ? `-${weaken.value}` : `-${weaken.value}`;
        const type = weaken.isUnseal ? 'unseal' : 'weaken';
        addFloatNumber(bossCard, text, type);
        bossCard.addEventListener('animationend', () => bossArea.classList.remove('boss-weaken-anim'), { once: true });
      }

      if (damage) {
        const text = damage.club ? `-${damage.value}` : `-${damage.value}`;
        addFloatNumber(bossCard, text, 'damage');
      }

      if (shatter) {
        playIntimidateShatterAnim();
      }

      if (entering) {
        setTimeout(() => {
          const game = document.getElementById('game');
          if (game) {
            game.classList.add('screen-shake');
            setTimeout(() => game.classList.remove('screen-shake'), 600);
          }
        }, 650);
      }
    });
  });
}

/**
 * 在 boss-card 上方插入一个飘浮数字元素，动画结束后自动移除
 * @param {HTMLElement} bossCard
 * @param {string} text - 显示文本，如 "-5" 或 "🃏 -10"
 * @param {'weaken'|'unseal'} type
 */
function addFloatNumber(bossCard, text, type) {
  const el = document.createElement('div');
  el.className = 'boss-float-num ' + type;
  el.textContent = text;
  bossCard.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/**
 * 震慑瓦解释放动画：抖动 → 碎片飞散 + 金色冲击波 + 横幅文字
 * 由 triggerPendingAnims 在 state._intimidateShatter 时调用
 */
function playIntimidateShatterAnim() {
  const tag = document.querySelector('.intimidate-tag');
  if (!tag) return;

  tag.classList.remove('intimidate-shake');
  void tag.offsetWidth;
  tag.classList.add('intimidate-shake');

  setTimeout(() => {
    tag.classList.remove('intimidate-shake');
    tag.style.position = 'relative';
    const rect = tag.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    for (let i = 0; i < 10; i++) {
      const piece = document.createElement('div');
      piece.className = 'shatter-piece';
      const angle = (Math.PI * 2 * i) / 10 + (Math.random() - .5) * .6;
      const dist = 40 + Math.random() * 50;
      piece.style.setProperty('--sx', Math.cos(angle) * dist + 'px');
      piece.style.setProperty('--sy', Math.sin(angle) * dist + 'px');
      piece.style.setProperty('--sr', (Math.random() * 720 - 360) + 'deg');
      piece.style.left = (rect.left + Math.random() * rect.width) + 'px';
      piece.style.top = (rect.top + Math.random() * rect.height) + 'px';
      piece.style.width = (4 + Math.random() * 4) + 'px';
      piece.style.height = (3 + Math.random() * 3) + 'px';
      document.body.appendChild(piece);
      piece.addEventListener('animationend', () => piece.remove());
    }

    const wave = document.createElement('div');
    wave.className = 'intimidate-shockwave';
    wave.style.left = cx + 'px';
    wave.style.top = cy + 'px';
    wave.style.position = 'fixed';
    document.body.appendChild(wave);
    wave.addEventListener('animationend', () => wave.remove());
  }, 350);

  setTimeout(() => {
    const banner = document.createElement('div');
    banner.className = 'intimidate-banner';
    banner.textContent = '破!!';
    document.body.appendChild(banner);
    banner.addEventListener('animationend', () => banner.remove());
  }, 200);
}

/* ============================================================
   调试入口（浏览器控制台调用）
   ============================================================ */

/**
 * 在 window 上挂出调试函数：
 *   debugWeaken(n = 5)           → 模拟一次普通虚弱（紫色脉冲 + 飘 "-n"）
 *   debugWeaken(n, true)         → 模拟一次小丑解封虚弱（紫色脉冲 + 飘 "🃏 -n"）
 *   debugDamage(n = 10, club)    → 模拟一次伤害飘字（红色 "-n"，club=true 时显示 "-n(×2)"）
 *   debugWeakenLive(n = 5, isUnseal) → 真实修改当前 Boss 攻击力并触发对应动画（需在游戏内）
 * 调用示例：debugWeaken(5) / debugWeaken(10, true) / debugDamage(14, true) / debugWeakenLive(7)
 */
if (typeof window !== 'undefined') {
  window.debugWeaken = (n = 5, isUnseal = false) => {
    const bossArea = document.querySelector('.boss-area');
    const bossCard = document.querySelector('.boss-card');
    if (!bossArea || !bossCard) return console.warn('未找到 .boss-card / .boss-area，请先进入游戏界面');
    bossArea.classList.remove('boss-weaken-anim');
    void bossArea.offsetWidth;
    bossArea.classList.add('boss-weaken-anim');
    const text = isUnseal ? `-${n}` : `-${n}`;
    const type = isUnseal ? 'unseal' : 'weaken';
    addFloatNumber(bossCard, text, type);
    bossCard.addEventListener('animationend', () => bossArea.classList.remove('boss-weaken-anim'), { once: true });
    return isUnseal ? `模拟解封脉冲 -${n}` : `模拟虚弱脉冲 -${n}`;
  };
  window.debugDamage = (n = 10, club = false) => {
    const bossCard = document.querySelector('.boss-card');
    if (!bossCard) return console.warn('未找到 .boss-card，请先进入游戏界面');
    const text = club ? `-${n}` : `-${n}`;
    addFloatNumber(bossCard, text, 'damage');
    return `模拟伤害飘字 ${text}`;
  };
  window.debugWeakenLive = (n = 5, isUnseal = false) => {
    if (!state || !state.currentBoss) return console.warn('当前无 Boss');
    const boss = state.currentBoss;
    const oldAtk = boss.currentAttack;
    boss.currentAttack = Math.max(0, boss.currentAttack - n);
    state._weakenAnim = { value: n, from: oldAtk, to: boss.currentAttack, isUnseal };
    saveState();
    renderGame();
    triggerPendingAnims();
    return `真实虚弱：攻击力 ${oldAtk} → ${boss.currentAttack}`;
  };
}

/* ============================================================
   启动入口
   ============================================================ */

/**
 * 页面加载完成后自动执行
 * 有存档 → 恢复游戏；无存档 → 显示首页
 */
document.addEventListener('DOMContentLoaded', () => {
  const saved = loadState();
  if (saved && saved.phase !== 'game-over') {
    state = saved;
    showGame();
  } else {
    if (saved) clearState();
    showLanding();
  }
});
