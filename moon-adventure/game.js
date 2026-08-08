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
 * 工程师打开机器人移动选择面板（路径位置系统）
 * 机器人移动0-2个板块，不受任何限制
 */
function openRobotMoveSheet() {
  let h = '<h3>🤖 移动机器人</h3><div class="sheet-cards">';
  const options = [];

  if (S.robotPos === -1) {
    for (let step = 1; step <= 2; step++) {
      const targetPos = step - 1;
      if (targetPos < S.path.length) {
        options.push({ pathPos: targetPos, label: `⬇️ 前进${step}格`, desc: `到${posLabel(targetPos)}` });
      }
    }
  } else {
    for (let step = -2; step <= 2; step++) {
      const targetPos = S.robotPos + step;
      if (targetPos < -1 || targetPos >= S.path.length) continue;
      if (targetPos === -1) {
        options.push({ pathPos: -1, label: '⬆️ 返回基地', desc: '基地' });
      } else if (step === 0) {
        options.push({ pathPos: targetPos, label: '⏸ 原地不动', desc: `留在${posLabel(targetPos)}` });
      } else if (step > 0) {
        options.push({ pathPos: targetPos, label: `⬇️ 前进${step}格`, desc: `到${posLabel(targetPos)}` });
      } else {
        options.push({ pathPos: targetPos, label: `⬆️ 后退${Math.abs(step)}格`, desc: `到${posLabel(targetPos)}` });
      }
    }
  }
  options.forEach(o => {
    h += `<div class="sheet-card supply-card" onclick="closeSheet();moveRobot(${o.pathPos})">
      ${o.label}<br><span class="text-dim">${o.desc}</span></div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
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
  if (p.pos < 0) return;
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

/** 显示紧急救援选择面板 */
function showRescueSelect() {
  // 联机模式：仅当前回合玩家（或被房主接管的离席玩家）可弹出救援面板
  if (typeof window._olIsActor === 'function' && !window._olIsActor()) return;

  const p = currentPlayer();
  const adjSeq = getAdjacentSeqPositions(p.pos);
  const rescuers = S.players.filter((other, i) => {
    if (i === S.currentPlayer || other.returned) return false;
    if (other.oxygen.length === 0) return false;
    if (p.pos >= 0 && other.pos === p.pos) return true;
    return adjSeq.includes(other.pos);
  });

  addLog(`⚠️ ${p.name} 氧气耗尽！请求紧急救援`, 'storm-log');

  let h = '<h3>🆘 紧急救援</h3>';
  h += `<p style="font-size:.8em;color:var(--danger);text-align:center;margin-bottom:10px">
    ${p.name} 氧气耗尽！选择相邻玩家进行救援</p>`;
  h += '<div class="sheet-cards">';
  rescuers.forEach(r => {
    const idx = S.players.indexOf(r);
    h += `<div class="sheet-card o2-card" onclick="closeSheet();startRescue(${idx})">
      <span style="color:${r.color}">●</span> ${r.name}（${r.oxygen.length}张氧气）</div>`;
  });
  h += '</div>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
  render();
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

/** 渲染紧急救援面板（救援双方可互相转移氧气和物资，免费） */
function renderRescueSheet(rescuerIdx, rescuedIdx) {
  const rescuer = S.players[rescuerIdx];
  const rescued = S.players[rescuedIdx];

  let h = `<h3>🆘 紧急救援</h3>`;
  h += '<div style="font-size:.75em;color:var(--text-dim);text-align:center;margin-bottom:10px">' +
    '救援双方可互相转移氧气和物资</div>';

  // rescuer 的物品（可转给被救者）
  h += `<div style="font-size:.8em;margin-bottom:4px;color:${rescuer.color}">● ${rescuer.name} 的物品:</div>`;
  h += '<div class="sheet-cards">';
  rescuer.oxygen.forEach((c, i) => {
    h += `<div class="sheet-card o2-card ${c.val === 3 ? 'val3' : ''}"
      onclick="transferItem(${rescuerIdx},${rescuedIdx},'o2',${i});renderRescueSheet(${rescuerIdx},${rescuedIdx})">
      O₂×${c.val} →</div>`;
  });
  rescuer.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;gap:8px"
      onclick="transferItem(${rescuerIdx},${rescuedIdx},'supply',${i});renderRescueSheet(${rescuerIdx},${rescuedIdx})">
      <span style="width:20px;height:20px;display:inline-flex">${shapeSVG(z.shape, z.fill, darken(z.color))}</span> →</div>`;
  });
  h += '</div>';

  // rescued 的物品（可反向转给救援者）
  h += `<div style="font-size:.8em;margin:8px 0 4px;color:${rescued.color}">● ${rescued.name} 的物品:</div>`;
  h += '<div class="sheet-cards">';
  rescued.oxygen.forEach((c, i) => {
    h += `<div class="sheet-card o2-card ${c.val === 3 ? 'val3' : ''}"
      onclick="transferItem(${rescuedIdx},${rescuerIdx},'o2',${i});renderRescueSheet(${rescuerIdx},${rescuedIdx})">
      ← O₂×${c.val}</div>`;
  });
  rescued.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;gap:8px"
      onclick="transferItem(${rescuedIdx},${rescuerIdx},'supply',${i});renderRescueSheet(${rescuerIdx},${rescuedIdx})">
      ← <span style="width:20px;height:20px;display:inline-flex">${shapeSVG(z.shape, z.fill, darken(z.color))}</span></div>`;
  });
  h += '</div>';

  h += `<button class="sheet-confirm" style="width:100%;margin-top:12px" onclick="finishRescue()">
    完成救援</button>`;

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
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

/** 生成并填充结算弹窗内容并打开（联机接收方也会调用） */
function showEndModal() {
  const target = WIN_CONDITIONS[S.playerCount];

  let intactCount = 0;
  let detailHtml = '';
  S.players.forEach(p => {
    let playerIntact = 0;
    const supplyIcons = p.supplies.map(s => {
      if (s.intact) playerIntact++;
      const z = ZONES.find(zone => zone.id === s.zone);
      if (!z) return '';
      const color = s.intact ? '#4caf50' : '#f44336';
      return `<span style="width:18px;height:18px;display:inline-flex;vertical-align:middle">${shapeSVG(z.shape, color, color)}</span>`;
    }).join('');
    intactCount += playerIntact;
    const supPart = p.supplies.length > 0
      ? `<span style="display:inline-flex;gap:3px;margin-left:4px">${supplyIcons}</span>`
      : '<span class="text-dim" style="margin-left:4px">· 无物资</span>';
    detailHtml += `<div style="margin:8px 0;font-size:.85em;display:flex;align-items:center;gap:6px">
      <span style="color:${p.color}">●</span> ${p.name} (${playerIntact}/${p.supplies.length})
      ${supPart}
    </div>`;
  });

  const icon = S.gameResult === 'win' ? '🎉' : '💀';
  const title = S.gameResult === 'win' ? '任务成功！' : '任务失败';
  const titleClass = S.gameResult === 'win' ? 'text-safe' : 'text-danger';

  const content = document.getElementById('endModalContent');
  content.innerHTML = `
    <div class="modal-icon">${icon}</div>
    <h3 class="${titleClass}">${title}</h3>
    <p style="font-size:1.1em;font-weight:700">完好物资: ${intactCount} / ${target}</p>
    <div style="text-align:left;padding:8px 0;border-top:1px solid rgba(255,255,255,.1);margin-top:8px">
      ${detailHtml}
    </div>
    <button class="btn-full btn-primary" onclick="closeModal('endModal')">确认</button>`;

  openModal('endModal');
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
// 弹窗/面板管理
// ========================================

/** 打开模态弹窗 */
function openModal(id) {
  document.getElementById(id).classList.add('show');
}

/** 打开游戏规则弹窗 */
function showRules() {
  openModal('rulesModal');
}

/** 关闭模态弹窗 */
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

/** 打开底部操作面板 */
function openSheet() {
  document.getElementById('actionSheet').classList.add('show');
}

/** 关闭底部操作面板 */
function closeSheet() {
  // 救援进行中：关闭（点击遮罩）视为取消救援并回滚
  if (S.isRescue) {
    cancelRescue();
    return;
  }
  // 共享进行中关闭面板视为取消
  if (S.shareState) {
    cancelShare();
    return;
  }
  document.getElementById('actionSheet').classList.remove('show');
}

/** 显示磁暴弹窗 */
function showStormModal(playerName) {
  document.getElementById('stormMsg').textContent =
    `${playerName} 所在的OGS已被磁暴摧毁！该芯片无法再使用。`;
  // 重新触发 shake 动画（CSS 动画只会在元素首次渲染时播放）
  const box = document.querySelector('#stormModal .modal-box');
  if (box) {
    box.classList.remove('shake-anim');
    void box.offsetWidth; // 强制重排
    box.classList.add('shake-anim');
  }
  openModal('stormModal');
}

/** 显示弃牌堆弹窗 */
function showDrawPileInfo() {
  const stormCount = S.drawPile.filter(c => c.type === 'storm').length;
  const o2Count = S.drawPile.length - stormCount;
  let h = '<h3>📋 抽牌堆</h3><div style="padding:8px 4px;font-size:0.95em">';
  h += `<p>共 <b>${S.drawPile.length}</b> 张牌</p>`;
  h += `<p style="color:var(--o2-light)">🫧 氧气卡：${o2Count} 张</p>`;
  h += `<p style="color:var(--danger)">💥 磁暴卡：${stormCount} 张</p>`;
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">关闭</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

function showDiscardPile() {
  let h = '<h3>📋 弃牌堆</h3><div style="padding:8px 4px;font-size:0.95em">';
  if (S.discardPile.length === 0) {
    h += '<p class="text-dim">弃牌堆为空</p>';
  } else {
    h += `<p>共 <b>${S.discardPile.length}</b> 张牌</p>`;
    S.discardPile.forEach((c, i) => {
      if (c.type === 'storm') {
        h += `<p style="color:var(--danger)">${i + 1}. ⚡ 磁暴</p>`;
      } else {
        h += `<p style="color:var(--o2-light)">${i + 1}. O₂ ×${c.val}</p>`;
      }
    });
  }
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">关闭</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 显示共享交换面板 */
function openShareSheet(fromIdx, toIdx) {
  // 由 render.js 中的 renderShareSheet 实现
  if (typeof renderShareSheet === 'function') {
    renderShareSheet(fromIdx, toIdx);
  }
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
// SVG 形状生成
// ========================================

/** 将十六进制颜色按比例变暗 */
function darken(hex, f = 0.55) {
  const r = Math.round(parseInt(hex.slice(1,3),16)*f);
  const g = Math.round(parseInt(hex.slice(3,5),16)*f);
  const b = Math.round(parseInt(hex.slice(5,7),16)*f);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/** 人形 token SVG 路径 */
const TOKEN_PATH = 'M539 290.8c-19 0-37-3.8-54-11.2-17-7.4-31.8-17.4-44.2-30-12.6-12.6-22.4-27.2-30-44.2-7.4-17-11.2-35-11.2-54s3.8-37 11.2-54c7.4-17 17.4-31.8 30-44.2s27.2-22.4 44.2-30C502 15.8 520 12 539 12s37 3.8 54 11.2c17 7.4 31.8 17.4 44.2 30 12.6 12.6 22.4 27.2 29.4 44.2 7.2 17 10.8 35 10.8 54s-3.6 37-10.8 54c-7.2 17-17 31.8-29.4 44.2-12.6 12.6-27.2 22.4-44.2 30-16.8 7.4-34.8 11.2-54 11.2z m198.4 125.2c16 12 29.4 25.8 39.8 41.6s15.6 31.8 15.6 47.8v88.4c0 10.2-5.8 17.8-17.4 23.2-11.6 5.4-24.4 8-38.4 8s-26.8-2.6-38.4-7.6c-11.6-5-17.4-13.2-17.4-24.6v-37.6c0-9-2.6-15.6-8-20.2-5.4-4.4-10.8-8.2-16-11.2-6-3-12.8-1.6-20.6 4-7.8 5.6-11.6 15.4-11.6 29v236c0 14.2 4.8 27.4 14.2 39.4s21.2 23 34.8 33c12 8.4 22 16.6 30.4 25l29.4 29.4c3.6 3.6 5 9 4 16.6-0.8 7.4-3.4 15.4-7.6 23.6-4.2 8.4-9.4 16.6-15.6 25-6.2 8.4-13.2 14.8-21 19.6-7.8 4.8-15.6 7.2-23.6 7.2-8 0-15.6-3.8-22.8-11.6-10.8-11.4-19.4-20.4-26-27.2-6.6-6.8-12.4-13-17.4-18.4-5-5.4-10.2-10.4-15.6-15.2-5.4-4.8-12-11.4-19.6-19.6-15.4-15.4-28.8-35.2-39.8-59.4s-16.6-48.2-16.6-72v-72.4c-7.2 9-13.2 16-18.4 21.4-5 5.4-10.8 14.2-17.4 26.8-2.4 4.8-4.8 11-7.2 18.8-2.4 7.8-4.6 15.8-6.8 24.2s-3.8 16.6-5 25c-1.2 8.4-1.8 15.4-1.8 21.4V928c0 11.4-5.8 19.8-17.4 25.4-11.6 5.6-24.4 8.4-38.4 8-14-0.2-26.8-3.6-38.4-9.8s-17.4-15.6-17.4-28.2v-65.2c0-23.2 3.6-43.8 10.8-61.6 7.2-17.8 15.2-37 24.2-57.2 12-27.4 20.8-49.4 26.4-66.2 5.6-16.6 10-28.2 13-34.8 6-13.8 9-26 9-36.6v-28.6c-6.6 4.2-12 8-16.6 11.6-4.4 3.6-10.6 10.2-18.4 19.6-7.8 9-15.6 14.8-23.6 17.4-8 2.6-20.8 4-38 4h-58c-14.2 0-24.8-5.8-31.8-17.4-6.8-11.6-10.2-24.2-9.8-38s4-26.4 11.2-38c7.2-11.6 17.6-17.4 31.2-17.4h53.6c7.2 0 13-0.8 17.4-2.6 4.4-1.8 8.6-4.4 12.6-8 3.8-3.6 8-7.8 12.6-12.6 4.4-4.8 10-10.2 16.6-16 8.4-7.2 16.8-17.8 25.4-31.8 8.6-14 16.8-28.2 24.6-42.4 9-16.6 17.6-34.6 26-53.6 12.6 0.6 24.2 1.2 34.8 1.8 9.6 0.6 19.2 1 29 1.4 9.8 0.2 18 0.4 24.6 0.4 6.6 0 14-0.2 22.4-0.4 8.4-0.2 16.4-0.8 24.2-1.4 9-0.6 18.2-1.2 27.8-1.8 16 10.2 31.6 19.4 46.4 27.8 12.6 7.8 25 15.2 37.6 22.4 12.2 7 21.6 13 28.2 17.8z';

/** 人形 token SVG */
function tokenSVG(c) {
  return `<svg viewBox="0 0 1024 1024"><path fill="${c}" stroke="${darken(c)}" stroke-width="24" d="${TOKEN_PATH}"/></svg>`;
}

/**
 * 生成三角形SVG（区域1）
 * @param {string} fill - 填充颜色
 * @param {string} stroke - 描边颜色
 * @returns {string} SVG HTML字符串
 */
function triSVG(fill, stroke) {
  return `<svg viewBox="0 0 100 100"><polygon points="50,16 87,79 13,79" fill="${fill}" stroke="${stroke}" stroke-width="13" stroke-linejoin="round"/></svg>`;
}

/** 生成四边形SVG（区域2） */
function sqSVG(fill, stroke) {
  return `<svg viewBox="0 0 100 100"><polygon points="50,11 89,50 50,89 11,50" fill="${fill}" stroke="${stroke}" stroke-width="13" stroke-linejoin="round"/></svg>`;
}

/** 生成五边形SVG（区域3） */
function pentSVG(fill, stroke) {
  return `<svg viewBox="0 0 100 100"><polygon points="50,13 85,39 72,80 28,80 15,39" fill="${fill}" stroke="${stroke}" stroke-width="13" stroke-linejoin="round"/></svg>`;
}

/**
 * 根据形状名生成对应SVG
 * @param {string} shape - 'triangle' | 'square' | 'pentagon'
 * @param {string} fill - 填充色
 * @param {string} stroke - 描边色
 * @returns {string} SVG HTML
 */
function shapeSVG(shape, fill, stroke) {
  if (shape === 'triangle') return triSVG(fill, stroke);
  if (shape === 'square') return sqSVG(fill, stroke);
  return pentSVG(fill, stroke);
}

/** 月球车SVG */
function roverSVG(fill) {
  return `<svg viewBox="0 0 1641 1024"><path fill="${fill}" d="M292.864 442.368a290.816 290.816 0 1 0 293.888 290.816 291.84 291.84 0 0 0-293.888-290.816z m0 422.912a133.12 133.12 0 1 1 134.144-133.12 133.12 133.12 0 0 1-134.144 134.144zM1331.2 442.368a290.816 290.816 0 1 0 293.888 290.816A291.84 291.84 0 0 0 1331.2 442.368z m0 422.912a133.12 133.12 0 1 1 134.144-133.12A133.12 133.12 0 0 1 1331.2 866.304z m204.8-667.648h-283.648c-76.8 0-26.624 128-291.84 128s-122.88-128-358.4-128H375.808L512 66.56h161.792V0h-204.8L279.552 204.8C102.4 220.16 102.4 429.056 102.4 429.056s539.648-136.192 539.648 294.912h358.4a294.912 294.912 0 0 1 295.936-328.704H1638.4s31.744-196.608-102.4-196.608z"/></svg>`;
}

// ========================================
// 初始化入口
// ========================================

/** 初始化星空背景 */
function initStars() {
  const container = document.getElementById('stars');
  let html = '';
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const dur = 1.5 + Math.random() * 3;
    html += `<div class="star" style="left:${x}%;top:${y}%;--dur:${dur}s"></div>`;
  }
  container.innerHTML = html;
}

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
