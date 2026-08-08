/**
 * 月面探险 (Moon Adventure) - 游戏逻辑
 * 
 * 负责：状态管理、初始化、发牌、行动逻辑、胜负判定
 * 依赖：render.js（渲染函数）
 */

// ========================================
// 常量定义
// ========================================

/** localStorage 存储键 */
const STORAGE_KEY = 'moon-adv-v4';

/** 玩家颜色 */
const PLAYER_COLORS = ['#e94560', '#42a5f5', '#66bb6a', '#ffb74d', '#ce93d8'];

/** 角色定义 */
const ROLES = [
  { id: 'engineer',    name: '工程师', icon: '🔧', ability: '每回合可免费移动机器人0-2格', slots: 5 },
  { id: 'laborer',     name: '搬运工', icon: '📦', ability: '拥有6个存储槽',             slots: 6 },
  { id: 'inventor',    name: '发明家', icon: '💡', ability: '每回合首次放置加速标记仅需1AP，且可停在加速标记上',        slots: 5 },
  { id: 'atmosphere',  name: '气氛组', icon: '🎉', ability: '掷出点数均相同+3AP',          slots: 5 },
  { id: 'veteran',     name: '老兵',   icon: '🎖️', ability: '资源回收仅需2AP',           slots: 5 },
];

/** 区域定义（形状、完好/损坏物资数量、背面数字） */
const ZONES = [
  { id: 1, shape: 'triangle', intact: 3, broken: 4, backNum: 3, color: '#928694', fill: 'rgba(146, 134, 148,.3)' },
  { id: 2, shape: 'square',   intact: 4, broken: 3, backNum: 4, color: '#796f7b', fill: 'rgba(121, 111, 123,.3)' },
  { id: 3, shape: 'pentagon', intact: 5, broken: 2, backNum: 5, color: '#564e55', fill: 'rgba(86, 78, 85,.3)' },
];

/** 获胜条件：人数 → 所需完好物资数 */
const WIN_CONDITIONS = { 2: 5, 3: 7, 4: 8, 5: 9 };

/** 每行板块数 */
const COLS = 7;

/** 地图布局参数（坐标系：板块宽度百分比，与海底探险一致） */
const BOARD = {
  maxTilt: 5.5,   // 每行最大纵向倾斜
  rowGap: 15,     // 行间距
  y0: 6,          // 首行Y偏移
  tileW: 12,     // 板块宽度(%)
  margin: 5,     // 左右边距(%)
  height: 52,     // 路径板高度(%)，对应 CSS aspect-ratio 100/52
};

/** OGS芯片宽度（板宽百分比单位），与板块等大 */
const OGS_TILE_W = BOARD.tileW;

// ========================================
// 工具函数
// ========================================

/**
 * Fisher-Yates 洗牌
 * @param {Array} arr - 待洗牌的数组
 * @returns {Array} 洗牌后的新数组
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
 * 掷骰子（骰面1,1,2,2,3,3）
 * @param {number} count - 骰子数量
 * @returns {number[]} 每个骰子的结果
 */
function rollDice(count) {
  const faces = [1, 1, 2, 2, 3, 3];
  return Array.from({ length: count }, () => faces[Math.floor(Math.random() * 6)]);
}

/** 获取当前时间字符串 HH:MM */
function timeStr() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ========================================
// 全局游戏状态
// ========================================

/** @type {Object} 游戏状态对象 */
let S = {
  phase: 'landing',       // 'landing' | 'setup' | 'playing' | 'gameover'
  playerCount: 0,         // 玩家人数 (2-5)
  players: [],            // 玩家数组
  drawPile: [],           // 抽牌堆（氧气卡）
  discardPile: [],        // 弃牌堆（氧气卡+磁暴卡）
  stormReserve: 0,        // 备用磁暴卡数量
  currentPlayer: 0,       // 当前行动玩家索引
  ap: 0,                  // 当前剩余AP
  turnPhase: 'idle',      // 'idle' | 'spent' | 'ogs' | 'done'
  dice: [],               // 当前骰子结果
  diceTotal: 0,           // 骰子总和
  tiles: [],              // 地图板块数组
  path: [],               // 路径数组（板块/OGS/丢弃物资元素）
  ogsCount: 0,            // 已建立的OGS芯片数
  roverPos: -1,           // 月球车位置（板块索引），-1=未被人驾驶
  roverUsed: false,       // 月球车是否已有人登上
  robotPos: -1,           // 机器人位置（-1=基地）
  hasEngineer: false,     // 是否有工程师角色
  robotMoved: false,      // 本回合是否已移动机器人
  accelMarks: [],         // 加速标记位置（路径位置数组，可在板块或损毁OGS上）
  accelPlacedThisTurn: false, // 本回合是否已放置过加速标记
  drawnThisTurn: [],      // 本回合OGS抽取的卡
  isDrawing: false,       // 是否正在OGS抽取中
  isRescue: false,        // 是否处于紧急救援模式
  rescueDebt: false,      // 救援后本回合需扣除1AP
  log: [],                // 事件日志
  gameOver: false,        // 游戏是否结束
  gameResult: null,       // 'win' | 'lose' | null
};

// ========================================
// 状态持久化
// ========================================

/** 保存游戏状态到 localStorage */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
  } catch (e) {
    console.warn('Save failed:', e);
  }
}

/**
 * 从 localStorage 加载游戏状态
 * @returns {Object|null} 有效的状态对象或 null
 */
function loadState() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && data.players && data.players.length >= 2 && data.tiles && data.tiles.length >= 22 && data.path) return data;
  } catch (e) {}
  return null;
}

/** 清除保存的游戏状态 */
function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

// ========================================
// 日志系统
// ========================================

/**
 * 记录事件日志
 * @param {string} msg - 日志消息
 * @param {string} cls - CSS类名（'storm-log' | 'draw-log' | 'action-log' | ''）
 */
function addLog(msg, cls = '') {
  S.log.unshift({ t: timeStr(), msg, cls });
  if (S.log.length > 60) S.log.length = 60;
  console.log(`[${cls || 'LOG'}] ${msg}`);
}

// ========================================
// 地图构建
// ========================================

/**
 * 计算板块在S形路径上的位置
 * @param {number} idx - 板块索引 (0-20)
 * @returns {{ x: number, y: number }} 百分比坐标
 */
function tilePos(idx) {
  const row = Math.floor(idx / COLS);
  const col = idx % COLS;
  // S形路径：偶数行从左到右，奇数行从右到左
  const dir = row % 2 === 0 ? 1 : -1;
  const c = dir === 1 ? col : (COLS - 1 - col);
  // 水平间距
  const dx = (100 - 2 * BOARD.margin) / (COLS - 1);
  const x = BOARD.margin + c * dx;
  // 使用缓动函数实现平滑倾斜
  const t = col / (COLS - 1);
  const eased = t + 0.4 * Math.pow(Math.sin(Math.PI * t), 2) * (1 - 2 * t);
  const tiltY = eased * BOARD.maxTilt;
  const y = BOARD.y0 + row * (BOARD.maxTilt + BOARD.rowGap) + tiltY;
  return { x, y };
}

/**
 * 构建21个物资板块
 * 每个区域7个板块，完好/损坏随机排列
 * @returns {Array} 板块数组
 */
function buildTiles() {
  const tiles = [];
  let idx = 0;
  ZONES.forEach(zone => {
    // 构建该区域的完好/损坏列表并洗牌
    const contents = [];
    for (let i = 0; i < zone.intact; i++) contents.push(true);
    for (let i = 0; i < zone.broken; i++) contents.push(false);
    const shuffled = shuffle(contents);
    shuffled.forEach(intact => {
      tiles.push({
        idx,
        zone: zone.id,
        shape: zone.shape,
        backNum: zone.backNum,
        intact,           // 是否完好（正面，仅结算时显示）
        picked: false,    // 是否已被拾取
      });
      idx++;
    });
  });
  // 第22个板块：月球车专用板块
  tiles.push({
    idx: 21,
    zone: 0,
    shape: 'rover',
    backNum: 0,
    intact: false,
    picked: false,
    isRover: true,
  });
  return tiles;
}

/** 构建初始路径（22个板块元素） */
function buildPath() {
  const path = [];
  for (let i = 0; i < 22; i++) {
    path.push({ type: 'tile', tileIdx: i });
  }
  return path;
}

// ========================================
// 路径位置辅助函数
// ========================================

/** 插入/删除元素后批量偏移所有存储的位置 */
function shiftPositions(fromIdx, delta) {
  S.players.forEach(p => {
    if (p.pos >= fromIdx && p.pos >= 0) p.pos += delta;
  });
  if (S.hasEngineer && S.robotPos >= fromIdx) S.robotPos += delta;
  S.accelMarks = S.accelMarks.map(pos => pos >= fromIdx ? pos + delta : pos);
}

/** tileIdx → path索引 */
function tilePathIdx(tileIdx) {
  return S.path.findIndex(el => el.type === 'tile' && el.tileIdx === tileIdx);
}

/** path索引 → tileIdx（非板块返回null） */
function pathToTileIdx(pathIdx) {
  if (pathIdx >= 0 && pathIdx < S.path.length && S.path[pathIdx].type === 'tile') {
    return S.path[pathIdx].tileIdx;
  }
  return null;
}

/** path索引是否为板块 */
function isPathTile(pathIdx) {
  return pathIdx >= 0 && pathIdx < S.path.length && S.path[pathIdx].type === 'tile';
}

/** path索引是否为OGS芯片 */
function isPathOGS(pathIdx) {
  return pathIdx >= 0 && pathIdx < S.path.length && S.path[pathIdx].type === 'ogs';
}

/** path索引是否为丢弃物资 */
function isPathDiscarded(pathIdx) {
  return pathIdx >= 0 && pathIdx < S.path.length && S.path[pathIdx].type === 'discarded';
}

/** 获取当前位置的显示名称 */
function posLabel(pathIdx) {
  if (pathIdx < 0) return '基地';
  const el = S.path[pathIdx];
  if (!el) return '?';
  if (el.type === 'tile') return `板块${el.tileIdx + 1}`;
  if (el.type === 'ogs') return el.active ? 'OGS' : '损毁OGS';
  if (el.type === 'discarded') return '丢弃物资';
  return '?';
}

/** 获取玩家前后两个插入点（用于放置OGS/丢弃物资） */
function getAdjacentInsertPoints(pathPos) {
  const points = [];
  if (pathPos > 0) points.push(pathPos);
  if (pathPos < S.path.length) points.push(pathPos + 1);
  return points;
}

// ========================================
// 发牌 / 游戏初始化
// ========================================

// ========================================
// 玩家设置
// ========================================

/** @type {string[]} 设置阶段暂存的玩家昵称列表 */
let setupNames = [];

/** 月球车乘坐确认弹窗中暂存的待执行移动 */
let pendingRoverMove = null;

/** 打开玩家设置页面 */
function showSetup() {
  S.phase = 'setup';
  render();
}

/** 添加玩家昵称 */
function addPlayer() {
  const inp = document.getElementById('name-input');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) return;
  if (setupNames.length >= 5) { console.warn('最多5名玩家'); return; }
  setupNames.push(name);
  inp.value = '';
  render();
  document.getElementById('name-input').focus();
}

/** 移除玩家昵称 */
function removePlayer(idx) {
  setupNames.splice(idx, 1);
  render();
}

// ========================================
// 游戏初始化
// ========================================

/**
 * 初始化新一局游戏
 * @param {string[]} names - 玩家昵称数组 (2-5人)
 */
function dealGame(names) {
  const count = names.length;
  // --- 构建氧气卡牌组 ---
  const oxygenCards = [];
  for (let i = 0; i < 10; i++) oxygenCards.push({ type: 'o2', val: 2 });
  for (let i = 0; i < 5; i++) oxygenCards.push({ type: 'o2', val: 3 });

  // --- 随机分配角色 ---
  const roles = shuffle([...ROLES]);

  // --- 构建玩家数组 ---
  // 每人固定：2张2氧气 + 1张3氧气
  const players = [];
  for (let i = 0; i < count; i++) {
    const role = roles[i % roles.length];
    players.push({
      name: names[i],
      role: { ...role },
      slots: role.slots,
      color: PLAYER_COLORS[i],
      // 固定初始手牌：2张2氧气 + 1张3氧气
      oxygen: [
        { type: 'o2', val: 2 },
        { type: 'o2', val: 2 },
        { type: 'o2', val: 3 },
      ],
      supplies: [],       // 背包中的物资（面朝下，不显示正面）
      pos: -1,            // -1 = 基地
      onRover: false,     // 是否在月球车上
      returned: false,    // 是否已返回基地
    });
  }

  // --- 计算剩余氧气卡（进入弃牌堆） ---
  const remainingTwos = 10 - count * 2;   // 每人发2张O₂×2
  const remainingThrees = 5 - count;       // 每人发1张O₂×3
  const remainingOxygen = [];
  for (let i = 0; i < remainingTwos; i++) remainingOxygen.push({ type: 'o2', val: 2 });
  for (let i = 0; i < remainingThrees; i++) remainingOxygen.push({ type: 'o2', val: 3 });

  // --- 检查是否有工程师 ---
  const hasEngineer = players.some(p => p.role.id === 'engineer');

  // --- 构建地图 ---
  const tiles = buildTiles();
  const path = buildPath();

  // --- 组装完整游戏状态 ---
  S = {
    phase: 'playing',
    playerCount: count,
    players,
    drawPile: [],                           // 开局抽牌堆为空
    discardPile: [...remainingOxygen],       // 未分配的氧气卡全部在弃牌堆
    stormReserve: 4,                     // 4张备用磁暴
    currentPlayer: 0,
    ap: 0,
    turnPhase: 'idle',
    dice: [],
    diceTotal: 0,
    tiles,
    path,
    ogsCount: 0,
    roverPos: 21,            // 月球车在第22个板块（独立月球车板块）
    roverUsed: false,
    robotPos: -1,            // 机器人在基地
    hasEngineer,
    robotMoved: false,       // 本回合是否已移动机器人
    accelMarks: [],
    accelPlacedThisTurn: false,
    drawnThisTurn: [],
    isDrawing: false,
    isRescue: false,       // 是否处于紧急救援模式
    rescueDebt: false,     // 救援后本回合需扣除1AP
    log: [],
    shareState: null,        // 共享会话快照（发起共享时保存，用于取消回滚）
    rescueState: null,       // 紧急救援快照（开始救援时保存，用于取消回滚）
    gameOver: false,
    gameResult: null,
  };

  addLog(`${count}人局发牌完成 · 弃牌堆${S.discardPile.length}张待洗 · 胜利条件:${WIN_CONDITIONS[count]}+完好物资`);
  saveState();
}

// ========================================
// 玩家辅助函数
// ========================================

/** 获取玩家已使用的存储槽数 */
function usedSlots(player) {
  return player.oxygen.length + player.supplies.length;
}

/** 获取玩家空闲的存储槽数 */
function freeSlots(player) {
  return player.slots - usedSlots(player);
}

/** 获取当前行动玩家对象 */
function currentPlayer() {
  return S.players[S.currentPlayer];
}

/**
 * 获取严格相邻的板块索引（路径中紧邻的板块元素）
 * @param {number} pathPos - 当前路径位置（-1为基地）
 * @returns {number[]} 相邻板块索引数组
 */
function getAdjacentTiles(pathPos) {
  if (pathPos < 0) {
    // 基地：找路径中第一个板块
    for (let i = 0; i < S.path.length; i++) {
      if (S.path[i].type === 'tile') {
        const t = S.tiles[S.path[i].tileIdx];
        return t.picked ? [] : [S.path[i].tileIdx];
      }
    }
    return [];
  }
  const adj = [];
  // 检查前一个元素
  if (pathPos > 0) {
    const el = S.path[pathPos - 1];
    if (el.type === 'tile' && !S.tiles[el.tileIdx].picked) {
      adj.push(el.tileIdx);
    }
  }
  // 检查后一个元素
  if (pathPos < S.path.length - 1) {
    const el = S.path[pathPos + 1];
    if (el.type === 'tile' && !S.tiles[el.tileIdx].picked) {
      adj.push(el.tileIdx);
    }
  }
  return adj;
}

/**
 * 获取路径中相邻的位置
 * @param {number} pathPos - 当前路径位置
 * @returns {number[]} 相邻路径位置数组
 */
function getAdjacentSeqPositions(pathPos) {
  if (pathPos < 0) return [0]; // 基地相邻只有S.path[0]
  const adj = [];
  if (pathPos > 0) adj.push(pathPos - 1);
  if (pathPos < S.path.length - 1) adj.push(pathPos + 1);
  return adj;
}

/**
 * 获取移动可达的目标位置（路径位置系统）
 * 自动跳过：有玩家的格子、机器人、加速标记（发明家可停在加速标记上）
 * OGS芯片可停留（空位）或跳过（已有人）
 * @param {number} pathPos - 当前路径位置
 * @returns {{ forward: number, backward: number, forwardAccelStops: number[], backwardAccelStops: number[] }}
 */
function getMoveTargets(pathPos) {
  if (pathPos < 0) {
    // 基地：前进到S.path[0]，跳过玩家、机器人、加速标记（发明家可停在加速标记上）
    const p = currentPlayer();
    const isInventor = p.role.id === 'inventor';
    const robotPathPos = S.hasEngineer ? S.robotPos : -999;
    const accelStops = [];
    let target = 0;
    let changed = true;
    while (changed) {
      changed = false;
      if (target >= S.path.length) break;
      if (S.players.some(pl => pl.pos === target && !pl.returned)) {
        target++; changed = true; continue;
      }
      if (S.hasEngineer && target === robotPathPos) {
        target++; changed = true; continue;
      }
      if (S.accelMarks.includes(target)) {
        if (isInventor) accelStops.push(target);
        target++; changed = true; continue;
      }
    }
    if (target >= S.path.length) target = -1;
    return { forward: target, backward: -1, forwardAccelStops: accelStops, backwardAccelStops: [] };
  }

  const p = currentPlayer();
  const isInventor = p.role.id === 'inventor';
  const isRover = p.onRover;
  const maxPos = S.path.length - 1;
  const robotPathPos = S.hasEngineer ? S.robotPos : -999;

  function resolve(dir) {
    const accelStops = [];
    let target = pathPos + dir;
    let changed = true;

    while (changed) {
      changed = false;
      if (target < 0 || target > maxPos) break;

      // 跳过有玩家的位置
      if (S.players.some(pl => pl.pos === target && !pl.returned)) {
        target += dir; changed = true; continue;
      }

      // 跳过机器人
      if (S.hasEngineer && target === robotPathPos) {
        target += dir; changed = true; continue;
      }

      // 加速标记（板块或损毁OGS芯片上有效）
      if (S.accelMarks.includes(target)) {
        if (isInventor && !isRover) {
          accelStops.push(target);
        }
        target += dir; changed = true; continue;
      }
    }

    // 月球车：1AP移动2步，再跳一次
    if (isRover && target >= 0 && target <= maxPos) {
      target += dir;
      changed = true;
      while (changed) {
        changed = false;
        if (target < 0 || target > maxPos) break;
        if (S.players.some(pl => pl.pos === target && !pl.returned)) {
          target += dir; changed = true; continue;
        }
        if (S.hasEngineer && target === robotPathPos) {
          target += dir; changed = true; continue;
        }
        if (S.accelMarks.includes(target)) {
          target += dir; changed = true; continue;
        }
      }
    }

    if (target < 0 || target > maxPos) target = -1;
    return { target, accelStops };
  }

  const fwd = resolve(1);
  const bwd = resolve(-1);
  return {
    forward: fwd.target,
    backward: bwd.target,
    forwardAccelStops: fwd.accelStops,
    backwardAccelStops: bwd.accelStops,
  };
}

// ========================================
// 行动：打出氧气卡 → 掷骰子
// ========================================

/**
 * 打出氧气卡并掷骰子
 * @param {number} cardIdx - 氧气卡在手牌中的索引
 */
function discardOxygen(cardIdx) {
  const p = currentPlayer();
  const card = p.oxygen.splice(cardIdx, 1)[0];
  S.discardPile.push(card);

  // 掷骰子
  const dice = rollDice(card.val);
  const total = dice.reduce((sum, d) => sum + d, 0);

  // 气氛组技能：所有骰面相同 +3AP
  let bonus = 0;
  if (p.role.id === 'atmosphere' && dice.length >= 2) {
    const allSame = dice.every(v => v === dice[0]);
    if (allSame) {
      bonus = 3;
      addLog(`${p.name} 🎉气氛组技能触发！+3AP`, 'action-log');
    }
  }

  S.dice = dice;
  S.diceTotal = total + bonus;
  S.ap = S.diceTotal;

  if (S.rescueDebt) {
    S.ap = Math.max(0, S.ap - 1);
    S.rescueDebt = false;
    addLog(`🆘 救援费用：-1AP（剩余${S.ap}AP）`, 'action-log');
  }

  S.turnPhase = 'spent';

  addLog(`${p.name} 打出${card.val}氧气 → 骰子[${dice.join(',')}] = ${S.ap}AP`);
  saveState();
  render();
}

// ========================================
// 行动：移动
// ========================================

/**
 * 沿方向解析最终落点（路径位置系统）
 * @param {number} pathPos - 起始路径位置
 * @param {1|-1} dir - 方向
 * @returns {number} 最终落点（-1=不可达/基地/超出边界）
 */
function resolveMove(pathPos, dir) {
  const targets = getMoveTargets(pathPos);
  return dir === 1 ? targets.forward : targets.backward;
}

/**
 * 玩家移动一步（路径位置系统）
 * 发明家遇到连续加速标记时弹出选择面板
 * @param {'forward'|'backward'} direction - 移动方向
 */
function moveStep(direction) {
  if (S.ap < 1) return;
  const p = currentPlayer();
  const targets = getMoveTargets(p.pos);
  const dir = direction === 'forward' ? 1 : -1;
  const target = direction === 'forward' ? targets.forward : targets.backward;
  const accelStops = direction === 'forward' ? targets.forwardAccelStops : targets.backwardAccelStops;

  // 发明家遇到连续加速标记 → 弹出选择
  if (p.role.id === 'inventor' && accelStops.length > 0) {
    openAccelChoiceSheet(direction, target, accelStops);
    return;
  }

  // 无法移动
  if (target === -1 && direction === 'forward') return;

  // 返回基地 → 弹出确认
  if (target === -1 && direction === 'backward') {
    document.getElementById('returnMsg').textContent =
      `${p.name} 确定要返回基地吗？返回后后续回合均会跳过，无法再行动。`;
    openModal('returnModal');
    return;
  }

  // 月球车 → 移动后仍有剩余AP时弹出确认（AP将清零）
  const roverPathPos = tilePathIdx(S.roverPos);
  if (target === roverPathPos && !S.roverUsed && S.ap > 1) {
    pendingRoverMove = { target, direction };
    document.getElementById('roverRemainAp').textContent = S.ap - 1;
    openModal('roverConfirmModal');
    return;
  }

  // 执行移动
  executePlayerMove(target, direction);
}

/** 确认乘坐月球车（清空AP，结束行动） */
function confirmRoverBoard() {
  closeModal('roverConfirmModal');
  if (!pendingRoverMove) return;
  const { target, direction } = pendingRoverMove;
  pendingRoverMove = null;
  executePlayerMove(target, direction);
}

/** 确认返回基地 */
function confirmReturnBase() {
  closeModal('returnModal');
  const p = currentPlayer();
  p.pos = -1;
  p.returned = true;
  S.ap--;
  addLog(`${p.name} 返回基地！不再行动`, 'action-log');
  saveState();
  render();
}

/** 从加速选择面板直接触发返回基地确认（绕过moveStep避免发明家循环） */
function showReturnBaseConfirm() {
  const p = currentPlayer();
  document.getElementById('returnMsg').textContent =
    `${p.name} 确定要返回基地吗？返回后后续回合均会跳过，无法再行动。`;
  openModal('returnModal');
}

/**
 * 执行移动并处理月球车/日志（路径位置系统）
 * @param {number} target - 目标路径位置
 * @param {'forward'|'backward'} direction - 移动方向
 */
function executePlayerMove(target, direction) {
  const p = currentPlayer();
  p.pos = target;
  S.ap--;

  // 月球车检查（roverPos是板块索引，需转换）
  const roverPathPos = tilePathIdx(S.roverPos);
  if (target === roverPathPos && !S.roverUsed) {
    p.onRover = true;
    S.roverUsed = true;
    S.ap = 0;
    addLog(`${p.name} 登上月球车！AP清零`, 'action-log');
  }

  const roverTag = p.onRover ? '🚗' : '';
  addLog(`${p.name} ${roverTag}${direction === 'forward' ? '前进' : '后退'}到${posLabel(target)}`);
  saveState();
  render();
}

/**
 * 发明家选择停在某个加速标记上
 * @param {number} accelPathPos - 加速标记的路径位置
 * @param {'forward'|'backward'} direction - 移动方向
 */
function stopOnAccelMark(accelPathPos, direction) {
  closeSheet();
  const p = currentPlayer();
  p.pos = accelPathPos;
  S.ap--;
  addLog(`${p.name} ${direction === 'forward' ? '前进' : '后退'}停在加速标记（${posLabel(accelPathPos)}）`, 'action-log');
  saveState();
  render();
}

/**
 * 执行机器人移动到目标路径位置
 * @param {number} targetPathPos - 目标路径位置（-1=返回基地）
 */
function moveRobot(targetPathPos) {
  const oldPos = S.robotPos;
  S.robotPos = targetPathPos;
  S.robotMoved = true;
  if (oldPos === targetPathPos) {
    addLog('🤖 机器人原地不动');
  } else if (targetPathPos === -1) {
    addLog('🤖 机器人返回基地', 'action-log');
  } else if (oldPos === -1) {
    addLog(`🤖 机器人出发到${posLabel(targetPathPos)}`, 'action-log');
  } else {
    const diff = targetPathPos - oldPos;
    addLog(`🤖 机器人${diff > 0 ? '前进' : '后退'}到${posLabel(targetPathPos)}`, 'action-log');
  }
  saveState();
  render();
}

// ========================================
// 行动：物资回收
// ========================================

/**
 * 拾取相邻板块的物资（路径位置系统）
 * @param {number} tileIdx - 目标板块索引
 */
function collectSupply(tileIdx) {
  const p = currentPlayer();
  const tile = S.tiles[tileIdx];
  const cost = p.role.id === 'veteran' ? 2 : 3;

  // 前置检查
  if (S.ap < cost) return;
  if (tile.picked) return;
  if (tile.isRover) return;
  if (freeSlots(p) <= 0) return;
  if (S.accelMarks.includes(tilePathIdx(tileIdx))) return;
  // 检查板块上是否有玩家
  if (S.players.some(pl => pl.pos === tilePathIdx(tileIdx) && !pl.returned)) return;
  // 检查机器人
  if (S.hasEngineer && S.robotPos === tilePathIdx(tileIdx)) return;

  // 检查是否严格相邻（序列中最近的板块）
  const adj = getAdjacentTiles(p.pos);
  if (!adj.includes(tileIdx)) return;

  // 执行拾取
  tile.picked = true;
  p.supplies.push({
    zone: tile.zone,
    intact: tile.intact,
  });
  S.ap -= cost;

  addLog(`${p.name} 拾取区域${tile.zone}物资（${cost}AP）`, 'action-log');
  saveState();
  render();
}

/** 点击丢弃物资元素 */
function onDiscardedClick(pathIdx) {
  if (S.turnPhase !== 'spent' || S.isDrawing) return;
  const p = currentPlayer();
  if (p.onRover) return;
  const el = S.path[pathIdx];
  if (!el || el.type !== 'discarded' || el.picked) return;

  const cost = p.role.id === 'veteran' ? 2 : 3;
  if (S.ap >= cost && freeSlots(p) > 0) {
    collectDiscardedSupply(pathIdx);
  }
}

/** 拾取路径中的丢弃物资 */
function collectDiscardedSupply(pathIdx) {
  const p = currentPlayer();
  const el = S.path[pathIdx];
  const cost = p.role.id === 'veteran' ? 2 : 3;

  if (S.ap < cost) return;
  if (!el || el.type !== 'discarded') return;
  if (el.picked) return;
  if (freeSlots(p) <= 0) return;

  if (S.accelMarks.includes(pathIdx)) return;
  if (S.players.some(pl => pl.pos === pathIdx && !pl.returned)) return;
  if (S.hasEngineer && S.robotPos === pathIdx) return;

  const adjSeq = getAdjacentSeqPositions(p.pos);
  if (!adjSeq.includes(pathIdx) && p.pos !== pathIdx) return;

  p.supplies.push({ zone: el.zone, intact: el.intact });
  el.picked = true;

  S.ap -= cost;

  addLog(`${p.name} 拾取丢弃物资（${cost}AP）`, 'action-log');
  saveState();
  render();
}

// ========================================
// 行动：放置加速标记
// ========================================

/** 打开加速标记放置选择面板（前/后方向） */
function placeAccelMark() {
  const p = currentPlayer();
  const cost = (p.role.id === 'inventor' && !S.accelPlacedThisTurn) ? 1 : 2;

  if (S.ap < cost) return;
  if (p.onRover) return;

  const options = [];

  // 后方
  const bwdPos = p.pos - 1;
  if (bwdPos >= 0 && !S.accelMarks.includes(bwdPos)) {
    if (isPathTile(bwdPos)) {
      options.push({ pos: bwdPos, dir: '后方', label: `板块${pathToTileIdx(bwdPos) + 1}` });
    } else if (isPathOGS(bwdPos) && !S.path[bwdPos].active) {
      options.push({ pos: bwdPos, dir: '后方', label: '损毁OGS' });
    } else if (isPathDiscarded(bwdPos)) {
      options.push({ pos: bwdPos, dir: '后方', label: '丢弃物资' });
    }
  }

  // 前方
  const fwdPos = p.pos + 1;
  if (fwdPos < S.path.length && !S.accelMarks.includes(fwdPos)) {
    if (isPathTile(fwdPos)) {
      options.push({ pos: fwdPos, dir: '前方', label: `板块${pathToTileIdx(fwdPos) + 1}` });
    } else if (isPathOGS(fwdPos) && !S.path[fwdPos].active) {
      options.push({ pos: fwdPos, dir: '前方', label: '损毁OGS' });
    } else if (isPathDiscarded(fwdPos)) {
      options.push({ pos: fwdPos, dir: '前方', label: '丢弃物资' });
    }
  }

  if (options.length === 0) {
    addLog(`${p.name} 无法放置加速标记（无可用位置）`);
    return;
  }

  let h = `<h3>⚡ 放置加速标记（${cost}AP）</h3><div class="sheet-cards">`;
  options.forEach(o => {
    h += `<div class="sheet-card supply-card" onclick="closeSheet();doPlaceAccelMark(${o.pos})">
      ${o.dir === '前方' ? '⬇️' : '⬆️'} ${o.dir} · ${o.label}</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 执行放置加速标记 */
function doPlaceAccelMark(pathPos) {
  const p = currentPlayer();
  const cost = (p.role.id === 'inventor' && !S.accelPlacedThisTurn) ? 1 : 2;

  if (S.ap < cost) return;
  if (S.accelMarks.includes(pathPos)) return;

  S.accelMarks.push(pathPos);
  S.accelPlacedThisTurn = true;
  S.ap -= cost;

  addLog(`${p.name} 在${posLabel(pathPos)}放置加速标记（${cost}AP）`, 'action-log');
  saveState();
  render();
}

// ========================================
// 行动：建立OGS芯片
// ========================================

/**
 * 在路径中指定位置插入OGS芯片
 * @param {number} insertIdx - 路径插入索引（必须在玩家位置p.pos或p.pos+1）
 */
function placeOGS(insertIdx) {
  const p = currentPlayer();

  if (S.ap < 3) return;
  if (p.onRover) return;
  if (S.ogsCount >= 5) return;

  // 验证插入位置必须是玩家当前位置或紧邻后方
  if (insertIdx !== p.pos && insertIdx !== p.pos + 1) return;

  // ~~验证插入点前后不能有丢弃物资~~
  // if (insertIdx > 0 && S.path[insertIdx - 1] && S.path[insertIdx - 1].type === 'discarded') return;
  // if (insertIdx < S.path.length && S.path[insertIdx] && S.path[insertIdx].type === 'discarded') return;

  S.path.splice(insertIdx, 0, { type: 'ogs', active: true });
  shiftPositions(insertIdx, 1);
  S.ogsCount++;
  S.ap -= 3;

  addLog(`${p.name} 建立OGS芯片（路径位置${insertIdx}）`, 'action-log');
  saveState();
  render();
}

// ========================================
// 行动：共享物资
// ========================================

/**
 * 与相邻板块的玩家交换物资/氧气（路径位置系统）
 * 发起时保存快照，AP在确认交换时才扣除
 * @param {number} targetPlayerIdx - 目标玩家索引
 */
function shareWithPlayer(targetPlayerIdx) {
  const p = currentPlayer();
  const target = S.players[targetPlayerIdx];

  if (S.ap < 1) return;
  if (targetPlayerIdx === S.currentPlayer) return;
  if (target.returned) return;

  // 检查相邻：同位置（非基地）或 序列中相邻
  if (target.pos !== p.pos) {
    const adjSeq = getAdjacentSeqPositions(p.pos);
    if (!adjSeq.includes(target.pos)) return;
  } else if (p.pos < 0) {
    return; // 基地不允许同位置共享
  }

  // 保存快照（取消时回滚用）
  S.shareState = {
    fromIdx: S.currentPlayer,
    toIdx: targetPlayerIdx,
    fromOxygen: p.oxygen.map(c => ({ ...c })),
    fromSupplies: p.supplies.map(s => ({ ...s })),
    toOxygen: target.oxygen.map(c => ({ ...c })),
    toSupplies: target.supplies.map(s => ({ ...s })),
    savedAP: S.ap,
  };

  addLog(`${p.name} 与${target.name}准备共享物资`);
  openShareSheet(S.currentPlayer, targetPlayerIdx);
}

/** 确认交换：扣除AP，清除快照 */
function confirmShare() {
  const from = S.players[S.shareState.fromIdx];
  const to = S.players[S.shareState.toIdx];
  S.ap -= 1;
  S.shareState = null;
  addLog(`${from.name} 与${to.name}共享物资完成（1AP）`, 'action-log');
  closeSheet();
  saveState();
  render();
}

/** 取消交换：恢复快照，不扣AP */
function cancelShare() {
  if (!S.shareState) { closeSheet(); return; }
  const snap = S.shareState;
  const from = S.players[snap.fromIdx];
  const to = S.players[snap.toIdx];
  from.oxygen = snap.fromOxygen;
  from.supplies = snap.fromSupplies;
  to.oxygen = snap.toOxygen;
  to.supplies = snap.toSupplies;
  S.ap = snap.savedAP;
  S.shareState = null;
  addLog(`${from.name} 与${to.name}取消共享，物资已归还`, 'action-log');
  closeSheet();
  saveState();
  render();
}

/**
 * 执行物资/氧气转移
 * @param {number} fromIdx - 来源玩家索引
 * @param {number} toIdx - 目标玩家索引
 * @param {'o2'|'supply'} type - 转移类型
 * @param {number} cardIdx - 卡牌索引
 */
function transferItem(fromIdx, toIdx, type, cardIdx) {
  const from = S.players[fromIdx];
  const to = S.players[toIdx];

  if (type === 'o2') {
    if (freeSlots(to) <= 0) return;
    const card = from.oxygen.splice(cardIdx, 1)[0];
    to.oxygen.push(card);
    addLog(`${from.name} → ${to.name}: O₂ ×${card.val}`, 'draw-log');
  } else {
    if (freeSlots(to) <= 0) return;
    const sup = from.supplies.splice(cardIdx, 1)[0];
    to.supplies.push(sup);
    addLog(`${from.name} → ${to.name}: 物资×1`, 'draw-log');
  }
  saveState();
  render();
}

// ========================================
// 行动：丢弃物资
// ========================================

/**
 * 丢弃背包中的物资到路径
 * @param {number} supplyIdx - 物资在背包中的索引
 * @param {number} insertIdx - 路径插入索引
 */
function discardSupply(supplyIdx, insertIdx) {
  const p = currentPlayer();
  if (S.ap < 1) return;
  if (supplyIdx >= p.supplies.length) return;

  // 验证插入位置与玩家相邻
  if (p.pos !== insertIdx - 1 && p.pos !== insertIdx) return;

  const supply = p.supplies.splice(supplyIdx, 1)[0];
  S.path.splice(insertIdx, 0, { type: 'discarded', zone: supply.zone, intact: supply.intact });
  shiftPositions(insertIdx, 1);

  S.ap -= 1;

  addLog(`${p.name} 丢弃1个物资到路径（1AP）`);
  saveState();
  render();
}

// ========================================
// OGS 氧气补给
// ========================================

/**
 * 检查当前玩家是否站在活跃OGS芯片上
 * @returns {number|null} OGS路径位置，或null
 */
function getPlayerOGS() {
  const p = currentPlayer();
  if (p.pos < 0) return null;
  if (p.pos < S.path.length && S.path[p.pos].type === 'ogs' && S.path[p.pos].active) {
    return p.pos;
  }
  return null;
}

/**
 * 尝试开始OGS补给（入口函数）
 * AP为0时直接开始，AP>0时弹出确认（补给将清空AP）
 */
function tryOGSDraw() {
  if (S.ap <= 0) {
    drawFromOGS();
  } else {
    openModal('ogsConfirmModal');
  }
}

/** 确认OGS补给（由确认弹窗按钮调用），清空AP后开始抽牌 */
function doOGSDraw() {
  closeModal('ogsConfirmModal');
  S.ap = 0;
  drawFromOGS();
}

/** 从OGS抽取一张氧气卡 */
function drawFromOGS() {
  const p = currentPlayer();

  // 抽牌堆空时先洗回
  if (S.drawPile.length === 0) {
    reshufflePile();
  }

  if (S.drawPile.length === 0) return; // 洗回后仍然没牌

  const card = S.drawPile.pop();

  if (card.type === 'storm') {
    // 先收取本次已抽取的氧气卡
    if (S.drawnThisTurn.length > 0) {
      p.oxygen.push(...S.drawnThisTurn);
      addLog(`${p.name} 已收取${S.drawnThisTurn.length}张氧气`, 'draw-log');
    }
    // 抽到磁暴 → OGS损坏
    S.discardPile.push(card);
    const ogsPos = getPlayerOGS();
    if (ogsPos !== null) {
      S.path[ogsPos].active = false;
    }
    S.drawnThisTurn = [];
    S.isDrawing = false;
    addLog(`${p.name} 抽到磁暴！OGS损坏`, 'storm-log');
    saveState();
    render();
    showStormModal(p.name);
    return;
  }

  // 抽到氧气卡
  S.drawnThisTurn.push(card);
  addLog(`${p.name} OGS抽取：${card.val}氧气`, 'draw-log');

  // 存储槽满则自动确认（drawnThisTurn中的卡尚未入背包，需一并计算）
  const pendingSlots = p.oxygen.length + p.supplies.length + S.drawnThisTurn.length;
  if (pendingSlots >= p.slots) {
    S.ap = 0;
    confirmOGSDraw();
  } else {
    S.isDrawing = true;
    saveState();
    render();
  }
}

/** 确认收取OGS抽取的氧气卡（仅收取，不清AP） */
function confirmOGSDraw() {
  const p = currentPlayer();
  p.oxygen.push(...S.drawnThisTurn);
  addLog(`${p.name} 补氧完成，当前${p.oxygen.length}/${p.slots}`, 'draw-log');
  S.drawnThisTurn = [];
  S.isDrawing = false;
  saveState();
  render();
}

/** 停止OGS抽取（保留已抽的卡，清空AP） */
function stopOGSDraw() {
  S.ap = 0;
  confirmOGSDraw();
}

/** 洗回弃牌堆到抽牌堆，加入1张备用磁暴 */
function reshufflePile() {
  // 将弃牌堆全部洗回抽牌堆（氧气 + 已有磁暴）
  const allCards = [...S.discardPile];
  if (!allCards.some(c => c.type === 'o2')) return;

  const newPile = shuffle(allCards);

  // 加入1张备用磁暴
  if (S.stormReserve > 0) {
    newPile.push({ type: 'storm', val: 0 });
    S.stormReserve--;
    addLog(`洗回${allCards.length}张 + 1张磁暴（备用剩余${S.stormReserve}）`);
  } else {
    addLog(`洗回${allCards.length}张，无备用磁暴`);
  }

  S.discardPile = [];
  S.drawPile = shuffle(newPile);
  saveState();
}

// ========================================
// 回合管理
// ========================================

/** 结束当前玩家回合，推进到下一个玩家 */
function endTurn() {
  const p = currentPlayer();
  if (S.ap > 0 && !S.returning && !p.onRover) {
    document.getElementById('endTurnRemainAp').textContent = S.ap;
    openModal('endTurnConfirmModal');
    return;
  }
  doEndTurn();
}

/** 确认结束回合（AP未用完弹窗确认后执行） */
function confirmEndTurn() {
  closeModal('endTurnConfirmModal');
  doEndTurn();
}

/** 执行结束回合逻辑 */
function doEndTurn() {
  const p = currentPlayer();
  S.ap = 0;
  S.turnPhase = 'idle';
  S.dice = [];
  S.diceTotal = 0;
  S.drawnThisTurn = [];
  S.isDrawing = false;
  S.robotMoved = false;
  S.accelPlacedThisTurn = false;

  addLog(`${p.name} 回合结束`);

  // 寻找下一个未返回基地的玩家
  let next = S.currentPlayer;
  for (let i = 0; i < S.playerCount; i++) {
    next = (next + 1) % S.playerCount;
    if (!S.players[next].returned) break;
  }

  // 检查是否所有人都返回了基地
  if (S.players.every(p => p.returned)) {
    endGame();
    return;
  }

  S.currentPlayer = next;

  // 失败条件检查：新回合开始时该玩家是否有氧气
  checkFailureCondition();

  saveState();
  render();
}

/** 跳过已返回基地的玩家回合 */
function skipReturned() {
  endTurn();
}

// ========================================
// 胜负判定
// ========================================

/** 检查失败条件（回合开始时） */
function checkFailureCondition() {
  const p = currentPlayer();

  // 条件：无氧气卡
  if (p.oxygen.length > 0) return;

  // 检查相邻位置是否有持有氧气卡的玩家可救援
  const adjSeq = getAdjacentSeqPositions(p.pos);
  const rescuers = S.players.filter((other, i) => {
    if (i === S.currentPlayer || other.returned) return false;
    if (other.oxygen.length === 0) return false;
    if (p.pos >= 0 && other.pos === p.pos) return true;
    return adjSeq.includes(other.pos);
  });

  if (rescuers.length > 0) {
    // 可触发紧急救援
    showRescueSelect();
  } else {
    addLog('💀 失败！无氧气且无法救援', 'storm-log');
    endGame(true);
  }
}

/** 开始紧急救援（双向转移） */
function startRescue(rescuerIdx) {
  // 联机模式：仅当前回合玩家（或被房主接管的离席玩家）可发起救援
  if (typeof window._olIsActor === 'function' && !window._olIsActor()) return;

  const rescued = currentPlayer();
  const rescuer = S.players[rescuerIdx];
  // 保存快照（点击遮罩取消救援时回滚用）
  S.rescueState = {
    rescuerIdx,
    rescuedIdx: S.currentPlayer,
    rescuerOxygen: rescuer.oxygen.map(c => ({ ...c })),
    rescuerSupplies: rescuer.supplies.map(s => ({ ...s })),
    rescuedOxygen: rescued.oxygen.map(c => ({ ...c })),
    rescuedSupplies: rescued.supplies.map(s => ({ ...s })),
  };
  S.isRescue = true;
  renderRescueSheet(rescuerIdx, S.currentPlayer);
  saveState();
}

/** 取消紧急救援：回滚已转移物资，回到等待救援状态 */
function cancelRescue() {
  const snap = S.rescueState;
  if (!snap) return;
  const rescuer = S.players[snap.rescuerIdx];
  const rescued = S.players[snap.rescuedIdx];
  rescuer.oxygen = snap.rescuerOxygen;
  rescuer.supplies = snap.rescuerSupplies;
  rescued.oxygen = snap.rescuedOxygen;
  rescued.supplies = snap.rescuedSupplies;
  S.isRescue = false;
  S.rescueState = null;
  addLog(`↩️ ${rescued.name} 取消了紧急救援`, 'action-log');
  document.getElementById('actionSheet').classList.remove('show');
  saveState();
  render();
}

/** 完成紧急救援 */
function finishRescue() {
  const p = currentPlayer();
  S.isRescue = false;
  S.rescueState = null;

  if (p.oxygen.length === 0) {
    // 救援后仍然没氧气 → 游戏失败
    addLog('💀 救援后仍无氧气，任务失败', 'storm-log');
    closeSheet();
    endGame(true);
    return;
  }

  addLog(`🆘 紧急救援完成！${p.name} 获得${p.oxygen.length}张氧气（本回合-1AP）`, 'action-log');
  S.rescueDebt = true;
  closeSheet();
  saveState();
  render();
}

/** 游戏结束（全员返回基地），结算物资
 *  @param {boolean} forcedLose - 因氧气耗尽等失败条件提前结束，强制判负 */
function endGame(forcedLose) {
  const target = WIN_CONDITIONS[S.playerCount];

  // 按玩家统计完好物资
  let intactCount = 0;
  S.players.forEach(p => {
    p.supplies.forEach(s => { if (s.intact) intactCount++; });
  });

  S.gameOver = true;
  S.gameResult = intactCount >= target ? 'win' : 'lose';
  if (forcedLose) S.gameResult = 'lose';

  showEndModal();

  addLog(`🏁 游戏结束！完好物资: ${intactCount}/${target}`, S.gameResult === 'win' ? 'draw-log' : 'storm-log');
  saveState();
  render();
}

/**
 * 获取当前完好物资总数（用于实时显示）
 * @returns {{ total: number, revealed: number, unrevealed: number }}
 */
function countIntactSupplies() {
  let total = 0;
  let revealed = 0;
  let unrevealed = 0;
  S.players.forEach(p => {
    p.supplies.forEach(s => {
      if (s.intact) total++;
    });
    // 未鉴定的数量
    unrevealed += p.supplies.length;
  });
  return { total, revealed, unrevealed };
}

// ========================================
// 重置游戏
// ========================================

/** 重置到初始界面 */
function resetGame() {
  openModal('confirmModal');
}

/** 确认重置游戏（由确认弹窗按钮调用） */
function doResetGame() {
  closeModal('confirmModal');
  clearState();
  setupNames = [];
  S = {
    phase: 'landing', playerCount: 0, players: [],
    drawPile: [], discardPile: [], stormReserve: 0,
    currentPlayer: 0, ap: 0, turnPhase: 'idle',
    dice: [], diceTotal: 0,
    tiles: [], path: [], ogsCount: 0,
    roverPos: -1, roverUsed: false, robotPos: -1, hasEngineer: false, robotMoved: false,
    accelMarks: [], accelPlacedThisTurn: false,
    drawnThisTurn: [], isDrawing: false, isRescue: false, rescueDebt: false,
    log: [], shareState: null, rescueState: null, gameOver: false, gameResult: null,
  };
  render();
}

// ========================================
// 初始化入口
// ========================================

/** 应用启动入口 */
document.addEventListener('DOMContentLoaded', () => {
  initStars();

  // 尝试恢复上次游戏状态
  const cached = loadState();
  if (cached) {
    S = cached;
  }

  // 首次渲染
  render();
});
