/**
 * game.js — 炸弹克星（Bomb Busters）规则引擎
 *
 * 2~5 人联机合作推理拆弹。纯前端，Supabase Realtime 同步（见 net.js / online.js）。
 *
 * ── 引擎与联机层的契约（对齐 take-time 方案）────────────────────────
 *  · saveState()           本地存档 + onlinePushState()（行动者推送通道）
 *  · saveStateDirect()     本地存档 + 强制底推送（标记阶段/被动选择/补推等非行动者场景，
 *                          onlinePushState 的行动者守卫会拦截这类推送）
 *  · getOnlineState()      快照（镜像 currentSeat → currentPlayer，供联机层判断行动者）
 *  · applyOnlineState(s)   应用远端快照（含标记阶段合并保留本端标记 + 补推）
 *  · clearState()          回到 landing（online.js 退出/解散时调用）
 *  · window._olResetProgress()  退出房间前重置未通关的本地进度（对齐 take-time 语义）
 *  · 依赖 window._olSeatIndex/_olIsHost/_olIsActor（online.js 注册；单机/测试环境缺省可用）
 *
 * ── 状态机 ─────────────────────────────────────────
 *  phase: 'landing'（首页）→ 'mark'（信息标记）→ 'play'（对局）→ 'over'（结算）
 *  phase==='mark' 时 currentSeat = -1（无行动者，联机推送守卫不命中任何人）
 *  S.pending !== null 时 currentSeat 临时指向「待选择方」（scanPick/scanMark/walkie），
 *  使被动方设备的推送通过行动者守卫；结算后归还给发起者。
 */

// ════════════════════════════════════════════════════════════════
//  常量与配置
// ════════════════════════════════════════════════════════════════

const STORAGE_KEY  = 'bomb-state';
const PROGRESS_KEY = 'bomb-progress';

const PLAYER_COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#A855F7', '#EC4899'];

const BLUE_NUMS   = Array.from({ length: 12 }, (_, i) => i + 1);          // 1..12
const RED_NUMS    = Array.from({ length: 11 }, (_, i) => i + 1.5);        // 1.5..11.5
const YELLOW_NUMS = Array.from({ length: 11 }, (_, i) => i + 1.1);        // 1.1..11.1

/**
 * 关卡配置（默认 #4；房主可在等候室切换）。
 * draw = 随机抽出张数，use = 实际加入导线库张数（其余放回盒中不参与本局）；
 * note = 文字说明中的括号备注（如 3选2 / 2选1）；marks = 数轴标记样式（hollow = 空心黄色圆圈）。
 */
const DEFAULT_MISSION_ID = 1;
const MISSIONS = {
  1: {
    id: 1, name: '#4 实地练习第一天',
    setup: {
      standard: { red: { draw: 1, use: 1 }, yellow: { draw: 2, use: 2 } },
      two:      { red: { draw: 1, use: 1 }, yellow: { draw: 4, use: 4 } },
    },
  },
  2: {
    id: 2, name: '#5 实地练习第二天',
    setup: {
      standard: { red: { draw: 1, use: 1 }, yellow: { draw: 3, use: 2, note: '3选2' } },
      two:      { red: { draw: 2, use: 2 }, yellow: { draw: 3, use: 2, note: '3选2' } },
    },
    marks: { yellow: 'hollow' },
  },
  3: {
    id: 3, name: '#6 实地练习第三天',
    setup: {
      standard: { red: { draw: 1, use: 1 }, yellow: { draw: 4, use: 4 } },
      two:      { red: { draw: 2, use: 2 }, yellow: { draw: 4, use: 4 } },
    },
  },
  4: {
    id: 4, name: '#7 练习结课日',
    setup: {
      standard: { red: { draw: 2, use: 1, note: '2选1' }, yellow: { draw: 0, use: 0 } },
      two:      { red: { draw: 3, use: 1, note: '3选1' }, yellow: { draw: 0, use: 0 } },
    },
    marks: { red: 'hollow' },
  },
  5: {
    id: 5, name: '#8 最终测试',
    setup: {
      standard: { red: { draw: 2, use: 1, note: '2选1' }, yellow: { draw: 3, use: 2, note: '3选2' } },
      two:      { red: { draw: 3, use: 1, note: '3选1' }, yellow: { draw: 4, use: 4 } },
    },
    marks: { red: 'hollow', yellow: 'hollow' },
  },
  6: {
    id: 6, name: '#9 轻重缓急',
    setup: {
      standard: { red: { draw: 1, use: 1 }, yellow: { draw: 2, use: 2 } },
      two:      { red: { draw: 2, use: 2 }, yellow: { draw: 4, use: 4 } },
    },
    orderCount: 3,
  },
  7: {
    id: 7, name: '#10 困境',
    setup: {
      standard: { red: { draw: 1, use: 1 }, yellow: { draw: 4, use: 4 } },
      two:      { red: { draw: 1, use: 1 }, yellow: { draw: 4, use: 4 } },
    },
    freeCut: true,
    timerSec: 900,
    timerSecTwo: 720,
    excludeEquip: [11],
  },
  8: {
    id: 8, name: '#11 又蓝又红，这可如何是好',
    setup: {
      standard: { red: { draw: 0, use: 0 }, yellow: { draw: 2, use: 2 } },
      two:      { red: { draw: 0, use: 0 }, yellow: { draw: 4, use: 4 } },
    },
    redBlueCount: 1,
    twoCaptainNoMark: true,
  },
  9: {
    id: 9, name: '#12 失踪的装备',
    setup: {
      standard: { red: { draw: 1, use: 1 }, yellow: { draw: 4, use: 4 } },
      two:      { red: { draw: 2, use: 2 }, yellow: { draw: 4, use: 4 } },
    },
    equipLocks: true,
  },
};

/** 按人数展开关卡的开局参数 */
function missionSetup(mission, pCount) {
  const cfg = (pCount === 2 ? mission.setup.two : mission.setup.standard);
  return {
    redDraw: cfg.red.draw || 0,
    redUse: cfg.red.use || 0,
    redNote: cfg.red.note || '',
    yellowDraw: cfg.yellow.draw || 0,
    yellowUse: cfg.yellow.use || 0,
    yellowNote: cfg.yellow.note || '',
    redMark: (mission.marks && mission.marks.red) || 'solid',
    yellowMark: (mission.marks && mission.marks.yellow) || 'solid',
    orderCount: mission.orderCount || 0,
    freeCut: !!mission.freeCut,
    timerSec: pCount === 2 ? (mission.timerSecTwo || mission.timerSec || 0) : (mission.timerSec || 0),
    excludeEquip: mission.excludeEquip || [],
    redBlueCount: mission.redBlueCount || 0,
    twoCaptainNoMark: !!(pCount === 2 && mission.twoCaptainNoMark),
    equipLocks: !!mission.equipLocks,
  };
}

/** 当前选关：联机时以房间状态 pendingChallenge 为准；新建房间未选关时默认 #4 */
function currentMissionId() {
  const ch = (typeof window !== 'undefined') ? window._olPendingChallenge : null;
  const id = (ch && typeof ch === 'object') ? ch.missionId : ch;
  return MISSIONS[id] ? id : DEFAULT_MISSION_ID;
}

function currentMission() { return MISSIONS[currentMissionId()]; }

/** 等候室选关同步给联机层（online.js 的 _olRefreshWaitingRoom 调用） */
window._olGetPendingChallenge = function () {
  return { missionId: currentMissionId() };
};

/**
 * 开局红/黄导线文字（带关卡括号备注）。
 * 数字取「抽出的全部候选」X：X选Y 时板上标 X 个位置，牌库只混入随机 Y 个，
 * 玩家不知道具体是哪 Y 个，因此说明里不能用实际入库数。
 */
function missionWiresText(setup) {
  const parts = [];
  if (setup.redDraw > 0) parts.push(`${setup.redDraw} 条红导线${setup.redNote ? '（' + setup.redNote + '）' : ''}`);
  if (setup.yellowDraw > 0) parts.push(`${setup.yellowDraw} 条黄导线${setup.yellowNote ? '（' + setup.yellowNote + '）' : ''}`);
  return parts.join(' + ');
}

/** 本关是否存在「抽 X 用 Y」的保密选择 */
function missionHasHiddenPick(mission) {
  return ['standard', 'two'].some(key => {
    const cfg = mission.setup[key];
    return (cfg.red.draw || 0) > (cfg.red.use || 0) || (cfg.yellow.draw || 0) > (cfg.yellow.use || 0);
  });
}

/** 道具注册表（编号 1~12；解锁 = 对应编号蓝线公开 ≥2 张） */
const EQUIPMENT_LIB = {
  1:  { no: 1,  name: '≠标签',    icon: '≠',  desc: '任意玩家回合可用（操作期间全场等待）：选择自己同一份内相邻的 2 张导线（编号不同、至少含 1 张蓝色，可含已公开牌）标记【≠】，向全场宣告两张编号不同。' },
  2:  { no: 2,  name: '对讲机',   icon: '📻', desc: '与另一名玩家各选 1 张未公开导线交换；被交换牌的标记自动废弃，双方立即重排。' },
  3:  { no: 3,  name: '三重探测器', icon: '🔍', desc: '立即进入剪线环节（本回合行动）：选择另一名玩家同一份内相邻的 3 张未公开导线，猜「其中至少 1 张为蓝色 N」。' },
  4:  { no: 4,  name: '便利贴',   icon: '📃', desc: '任意玩家回合可用（操作期间全场等待）：再标记自己 1 张未公开且无信息标记的蓝色导线，向全场宣告其数字。' },
  5:  { no: 5,  name: '超级探测器', icon: '🛰️', desc: '立即进入剪线环节（本回合行动）：选择另一名玩家的一整份手牌，猜「其中有蓝色 N」；命中者自选 1 张公开。' },
  6:  { no: 6,  name: '抑制器',   icon: '🧯', desc: '当前失败数 −1，起爆器指针回退一格（失败数为 0 时不可使用）。' },
  7:  { no: 7,  name: '备用电池', icon: '🔋', desc: '指定 1~2 名本局已使用过「双重探测器」的玩家（可含自己），恢复其技能使用次数。' },
  8:  { no: 8,  name: '通用雷达', icon: '📡', desc: '选择 1~12 一个数字：系统自动公布每名玩家每份手牌是否还有未公开的该数字蓝线。' },
  9:  { no: 9,  name: '稳定剂',   icon: '🧪', desc: '进入稳定状态（不锁定行动）：本回合剪线失误不计失败、指向红线不引爆。' },
  10: { no: 10, name: 'X/Y射线',  icon: '➿', desc: '立即进入剪线环节（本回合行动）：指定他人 1 张未公开牌，进行 2 个选项猜测「（蓝A/蓝B）或（蓝A/黄）」' },
  11: { no: 11, name: '咖啡瓶',   icon: '☕', desc: '跳过自己本回合（不执行行动），指定 1 名仍有未公开手牌的其他玩家从其开始继续。' },
  12: { no: 12, name: '＝标签',   icon: '＝', desc: '任意玩家回合可用（操作期间全场等待）：选择自己同一份内相邻的 2 张牌（蓝蓝同数字 / 黄黄 / 红红，至少 1 张未公开）标记【＝】，宣告两张编号相同。' },
};

let S = { phase: 'landing', players: [], log: [], gameOver: false };
/** 通过 window.S 暴露（联机层与测试均依赖） */
Object.defineProperty(window, 'S', { get: () => S, set: (v) => { S = v; } });

// ════════════════════════════════════════════════════════════════
//  工具
// ════════════════════════════════════════════════════════════════

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _numCmp(a, b) { return a.num - b.num; }

function _eachCard(cb) {
  if (!S.players) return;
  for (const p of S.players) {
    for (const share of (p.shares || [])) {
      for (const c of share) cb(c, p);
    }
  }
}

function _findCardById(id) {
  let out = null;
  _eachCard(c => { if (c.id === id) out = c; });
  return out;
}

function _findCardOwner(id) {
  if (!S.players) return null;
  for (let s = 0; s < S.players.length; s++) {
    for (const share of (S.players[s].shares || [])) {
      if (share.some(c => c.id === id)) return { seat: s, card: _findCardById(id) };
    }
  }
  return null;
}

function _isInShares(card, shares) {
  return (shares || []).some(sh => sh.some(c => c.id === card.id));
}

/** 在若干「份」中定位 cardIds 是否构成同一份内连续相邻的 count 张 */
function _adjacentRun(shares, cardIds, count) {
  for (let si = 0; si < shares.length; si++) {
    const share = shares[si];
    const idxs = cardIds.map(id => share.findIndex(c => c.id === id));
    if (idxs.some(i => i < 0)) continue;
    if (new Set(idxs).size !== count) continue;
    const sorted = idxs.slice().sort((a, b) => a - b);
    let ok = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) { ok = false; break; }
    }
    if (ok) return { si, idxs: sorted };
  }
  return null;
}

/** 定位牌在其所有者手牌中的份与位置 */
function _locate(card, shares) {
  for (let si = 0; si < shares.length; si++) {
    const idx = shares[si].findIndex(c => c.id === card.id);
    if (idx >= 0) return { si, idx };
  }
  return null;
}

// ── 查询 ──────────────────────────────────────────

function hiddenCards(seat) {
  return (S.players[seat].shares || []).flat().filter(c => !c.revealed);
}

/** #11：该数字的蓝色导线本局视为红色导线 */
function isRedBlueNum(num) {
  const arr = (S && S.board && Array.isArray(S.board.redBlueNums)) ? S.board.redBlueNums : [];
  return arr.indexOf(num) >= 0;
}

/** 牌是否按红色导线处理（真红 + #11 视为红的蓝线） */
function isRedLikeCard(card) {
  return !!card && (card.kind === 'red' || (card.kind === 'blue' && isRedBlueNum(card.num)));
}

/** 可猜测/可剪线的蓝线：排除视为红线的蓝线 */
function hiddenBlueCards(seat, num) {
  return hiddenCards(seat).filter(c => c.kind === 'blue' && c.num === num && !isRedLikeCard(c));
}

function hiddenBlueCount(seat, num) { return hiddenBlueCards(seat, num).length; }

function hiddenYellowCount(seat) {
  return hiddenCards(seat).filter(c => c.kind === 'yellow').length;
}

function blueRevealedCount(num) {
  let n = 0;
  _eachCard(c => { if (c.kind === 'blue' && c.num === num && c.revealed) n++; });
  return n;
}

/**
 * #9 顺序剪线：检查本次即将公开的蓝色数字是否违反解锁顺序。
 * 规则：序列中第 k 个数字须在第 k-1 个数字已公开 ≥2 根后才能公开。
 * @returns {null|{num:number, prev:number, have:number, need:number, idx:number}}
 */
function orderRevealViolation(nums) {
  const order = (S && S.board && Array.isArray(S.board.orderNums)) ? S.board.orderNums : [];
  if (!order.length) return null;
  const seen = new Set();
  for (const num of nums) {
    if (!Number.isInteger(num) || seen.has(num)) continue;
    seen.add(num);
    const idx = order.indexOf(num);
    if (idx <= 0) continue;
    const prev = order[idx - 1];
    const have = blueRevealedCount(prev);
    if (have < 2) return { num, prev, have, need: 2, idx };
  }
  return null;
}

/** 违反顺序：立即爆炸（不消耗稳定剂） */
function _boomOrder(v) {
  addLog(`💥 剪线顺序错误：蓝色 ${v.num} 须先公开 2 根蓝色 ${v.prev}（当前 ${v.have} 根）`, 'bad');
  _boom('boom-order');
}

/** 检查顺序；违规时立即爆炸并返回 true */
function _checkOrderOrBoom(nums) {
  const v = orderRevealViolation(nums);
  if (!v) return false;
  _boomOrder(v);
  return true;
}

function _hiddenYellowAll() {
  const out = [];
  _eachCard(c => { if (c.kind === 'yellow' && !c.revealed) out.push(c); });
  return out;
}

function _allRevealed() {
  let all = true;
  _eachCard(c => { if (!c.revealed) all = false; });
  return all;
}

// ════════════════════════════════════════════════════════════════
//  座位与身份（联机层缺省时本地可玩）
// ════════════════════════════════════════════════════════════════

function mySeat() {
  return (typeof window !== 'undefined' && typeof window._olSeatIndex === 'function')
    ? window._olSeatIndex() : null;
}

function isHost() {
  return (typeof window !== 'undefined' && typeof window._olIsHost === 'function')
    ? window._olIsHost() : true;
}

function isActor() {
  return (typeof window !== 'undefined' && typeof window._olIsActor === 'function')
    ? window._olIsActor() : true;
}

/** 本设备是否可代表某个座位操作（本人 / 本地调试） */
function canActAs(seat) {
  const s = mySeat();
  if (s === null) return true;
  return s === seat;
}

/** 道具 1/4/12 的跨回合操作锁时长：持有者提交/取消前，全场行动暂停 */
const EQUIP_LOCK_MS = 60000;

/** 当前有效的道具操作锁；过期或道具已失效时顺带清理本地锁 */
function _equipLockActive() {
  const l = S && S.equipLock;
  if (!l) return null;
  const eq = (S.equipment || []).find(e => e.no === l.no);
  const invalid = !(l.at > 0) || Date.now() - l.at > EQUIP_LOCK_MS
    || !S.players || !S.players[l.seat] || !eq || eq.used || !eq.unlocked;
  if (invalid) { S.equipLock = null; return null; }
  return l;
}

function _equipLockOwnedBy(seat, lock) {
  const l = lock || (S && S.equipLock);
  if (!l) return false;
  if (seat === null || seat === undefined) return canActAs(l.seat);
  return l.seat === seat;
}

/** 释放道具锁并推进版本：远程端凭 equipRev 识别这是新状态，迟到的旧锁快照会被忽略 */
function _releaseEquipLock() {
  if (S.equipLock) S.equipRev = (S.equipRev || 0) + 1;
  S.equipLock = null;
}

/** 仅道具 1/4/12 可在其他玩家回合使用 */
function _canUseEquipAnytime(no) {
  return no === 1 || no === 4 || no === 12;
}

function _canAct() {
  if (S.phase !== 'play' || S.pending || S.result || S.fx) return false;
  if (timeoutGameIfNeeded()) return false;
  if (_equipLockActive()) return false;
  if (S.freeCut && _actionSeat() === null) return false;
  return isActor();
}

/** #10 自由剪线：本座是否还能发起剪线（>2 人时不能连续两次） */
function _freeCutEligible(seat) {
  if (!S || !S.players || !S.players[seat]) return false;
  if (hiddenCards(seat).length === 0) return false;
  if (S.pCount > 2 && S.lastCutterSeat === seat) return false;
  return true;
}

/** 当前本设备要代表的操作座位（自由剪线时取自己；单机由座位上选择器指定） */
function _actionSeat() {
  if (!S || S.phase !== 'play') return null;
  if (!S.freeCut) return S.currentSeat;
  const mine = mySeat();
  if (mine !== null) return _freeCutEligible(mine) ? mine : null;
  if (S.currentSeat >= 0 && _freeCutEligible(S.currentSeat)) return S.currentSeat;
  return null;
}

/** #10 倒计时是否已结束；结束时立即判负（任意端触发，结果一致） */
function timeoutGameIfNeeded() {
  if (!S || (S.phase !== 'mark' && S.phase !== 'play')) return false;
  const deadline = S.board && S.board.deadline;
  if (!deadline || Date.now() < deadline) return false;
  _finish(false, 'boom-timeout');
  return true;
}

// ════════════════════════════════════════════════════════════════
//  持久化与推送
// ════════════════════════════════════════════════════════════════

function _persistState() {
  if (typeof S.turnNo === 'number') S.turnNo++;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) {}
}

/** 常规存档 + 行动者通道推送（online.js: onlinePushState） */
function saveState() {
  _persistState();
  if (typeof onlinePushState === 'function') onlinePushState();
}

/** 非行动者合法推送（标记阶段 / 被动选择 / 合并补推 / 终局）：
 *  onlinePushState 的行动者守卫会拦截（如标记阶段 currentPlayer=-1），直接走底层通道送达房间 */
function saveStateDirect() {
  _persistState();
  if (typeof _onlineRoomId === 'string' && _onlineRoomId
      && typeof _markPushAndSend === 'function'
      && typeof window !== 'undefined' && typeof window._getOnlineState === 'function') {
    try { _markPushAndSend(window._getOnlineState()); return; } catch (e) {}
  }
  if (typeof onlinePushState === 'function') onlinePushState();
}

// ════════════════════════════════════════════════════════════════
//  日志 / 提示
// ════════════════════════════════════════════════════════════════

function addLog(msg, cls) {
  S.log = S.log || [];
  S.log.push({ t: Date.now(), msg, cls: cls || '' });
  if (S.log.length > 60) S.log = S.log.slice(-60);
  console.log('[bomb]', msg);
}

/** 轻量吐司提示（1.6s 自动消失） */
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1600);
}

function _render() {
  if (typeof render === 'function') render();
}

// ════════════════════════════════════════════════════════════════
//  开局 / 清理
// ════════════════════════════════════════════════════════════════

function clearState() {
  S = { phase: 'landing', players: [], log: [], gameOver: false };
  _seenEquipRev = 0;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) {}
}

/**
 * 发牌开局（房主）：随机队长 → 抽红/黄并标记板 → 全牌洗混分份排序
 * → 抽道具 → 进入信息标记阶段。
 * @param {string[]} names 2~5 名玩家昵称（按座位序）
 */
function dealGame(names, missionId) {
  const pCount = names.length;
  if (pCount < 2 || pCount > 5) return;

  const mission = MISSIONS[missionId] || currentMission();
  const setup = missionSetup(mission, pCount);

  // 抽出的全部 X 个候选数字都标到数轴上；牌库只混入其中随机选出的 Y 个，
  // 使玩家无法从板上得知具体是哪 Y 个进入了本局。
  const redDrawNums = shuffle(RED_NUMS).slice(0, setup.redDraw).sort((a, b) => a - b);
  const yellowDrawNums = shuffle(YELLOW_NUMS).slice(0, setup.yellowDraw).sort((a, b) => a - b);
  const redUseNums = shuffle(redDrawNums).slice(0, setup.redUse).sort((a, b) => a - b);
  const yellowUseNums = shuffle(yellowDrawNums).slice(0, setup.yellowUse).sort((a, b) => a - b);
  // #9：抽出 3 个互不重复的蓝色数字，按抽出顺序解锁剪线
  const orderNums = setup.orderCount > 0 ? shuffle(BLUE_NUMS).slice(0, setup.orderCount) : [];
  // #11：抽出 1 个蓝色数字，本局该数字蓝线视为红色导线
  const redBlueNums = setup.redBlueCount > 0 ? shuffle(BLUE_NUMS).slice(0, setup.redBlueCount) : [];

  // 构造牌库：48 蓝 + 本局实际使用的红/黄导线
  let seq = 0;
  const mk = (kind, num) => ({
    id: 'c' + (++seq), kind, num,
    revealed: false, info: null, fail: null, neq: null, eqp: null,
  });
  let deck = [];
  for (const n of BLUE_NUMS) for (let k = 0; k < 4; k++) deck.push(mk('blue', n));
  for (const n of redUseNums) deck.push(mk('red', n));
  for (const n of yellowUseNums) deck.push(mk('yellow', n));

  // 分份（尽可能均分）：2 人局 4 份（每人 2 份）；3 人局 4 份（队长 2 份）；4/5 人局每人 1 份
  const shareCount = pCount <= 3 ? 4 : pCount;
  deck = shuffle(deck);
  const base = Math.floor(deck.length / shareCount);
  const rem = deck.length % shareCount;
  const shares = [];
  let off = 0;
  for (let si = 0; si < shareCount; si++) {
    const size = base + (si < rem ? 1 : 0);
    const share = deck.slice(off, off + size);
    off += size;
    share.sort(_numCmp);
    shares.push(share);
  }

  const captainSeat = Math.floor(Math.random() * pCount);
  const players = names.map((name, i) => ({ name, seat: i, shares: [], skillUsed: false }));
  if (pCount === 2) {
    players[0].shares = [shares[0], shares[1]];
    players[1].shares = [shares[2], shares[3]];
  } else if (pCount === 3) {
    players[captainSeat].shares = [shares[0], shares[1]];
    const others = [0, 1, 2].filter(s => s !== captainSeat);
    players[others[0]].shares = [shares[2]];
    players[others[1]].shares = [shares[3]];
  } else {
    for (let i = 0; i < pCount; i++) players[i].shares = [shares[i]];
  }

  // 道具：12 张抽 N 张上桌（锁定）；#10 排除咖啡瓶、#11 排除与视红数字相同的道具
  let eqPool = Array.from({ length: 12 }, (_, i) => i + 1);
  if (setup.excludeEquip.length) eqPool = eqPool.filter(n => setup.excludeEquip.indexOf(n) < 0);
  if (redBlueNums.length) eqPool = eqPool.filter(n => redBlueNums.indexOf(n) < 0);
  const eqNos = shuffle(eqPool).slice(0, pCount).sort((a, b) => a - b);
  const lockNums = setup.equipLocks ? shuffle(BLUE_NUMS).slice(0, pCount) : [];
  const equipment = eqNos.map((no, i) => {
    const eq = { no, unlocked: false, used: false };
    if (setup.equipLocks) eq.lockNum = lockNums[i];   // #12：每张道具额外锁定一个数字
    return eq;
  });

  // #11 双人局：队长不能进行蓝线信息标记（视为已完成）
  const noMarkSeats = setup.twoCaptainNoMark ? [captainSeat] : [];
  const ready = Array(pCount).fill(false);
  noMarkSeats.forEach(s => { ready[s] = true; });

  // #10：发牌即开始倒计时（标准 15 分钟 / 2 人 12 分钟）
  const timeLimitSec = setup.timerSec || 0;
  const deadline = timeLimitSec ? Date.now() + timeLimitSec * 1000 : null;

  // turnNo 全局单调（联机快照新鲜度依赖）：新一局延续旧局计数，不得归零
  const prevTurnNo = (typeof S === 'object' && S && typeof S.turnNo === 'number') ? S.turnNo : 0;

  S = {
    players,
    phase: 'mark',
    missionId: mission.id,
    dealStamp: Date.now(),           // 每局唯一（结算弹窗按此去重展示）
    captainSeat,
    currentSeat: -1,                 // 标记阶段无行动者
    turnNo: prevTurnNo,
    equipRev: 0,                     // 道具锁版本（上锁/释放各 +1；远程端据此丢弃迟到旧锁）
    equipLock: null,
    board: {
      redNum: redDrawNums.length ? redDrawNums[0] : null,   // 兼容旧快照/旧测试
      redNums: redDrawNums,                                // 抽出的全部候选（板上标记）
      yellowNums: yellowDrawNums,                          // 抽出的全部候选（板上标记）
      redMark: setup.redMark,
      yellowMark: setup.yellowMark,
      redNote: setup.redNote,
      yellowNote: setup.yellowNote,
      orderNums,                                           // #9：蓝线剪线解锁顺序（空数组=无顺序限制）
      redBlueNums,                                         // #11：本局视为红线的蓝线数字
      deadline,                                            // #10：倒计时截止时间戳（null=无倒计时）
      timeLimitSec,
      defused: Array(12).fill(false),
    },
    failures: 0,
    pCount,
    equipment,
    freeCut: setup.freeCut,          // #10：自由剪线（currentSeat=-2 表示无人被锁定）
    lastCutterSeat: null,            // #10：上一位剪线者（>2 人时不能连续剪线）
    noMarkSeats,                     // #11 双人局：不能进行蓝线信息标记的座位
    pending: null,
    scanMode: null,
    cutMods: { stabilize: null },    // 稳定剂准备态（道具 9）
    radar: null,                     // 通用雷达瞬态结果（道具 8）
    result: null,
    fx: null,                        // 猜测气泡宣告（瞬态，结算前各端同步播放）
    ready,
    markAt: {},
    log: [],
    gameOver: false,
  };

  addLog(`🧨 ${mission.name} 开始！${pCount} 人局：${missionWiresText(setup)} 已标记到板上`);
  if (orderNums.length) {
    addLog(`⏱ 本局剪线顺序：${orderNums.map(n => '蓝色 ' + n).join(' → ')}（前一个数字公开 ≥2 根后才能公开下一个）`, 'warn');
  }
  if (redBlueNums.length) {
    addLog(`🎲 本局蓝线 ${redBlueNums.join('、')} 视为红色导线：只能在自己手上只剩这些牌时用「公开红线」公开`, 'warn');
  }
  if (timeLimitSec) {
    addLog(`⏳ 倒计时 ${timeLimitSec / 60} 分钟开始！未在倒计时内公开全部导线即失败`, 'warn');
  }
  if (setup.freeCut) {
    addLog('🔓 自由剪线：任意玩家可行动；须等待上一位剪线完成，>2 人时不能连续剪线', 'warn');
  }
  if (setup.equipLocks) {
    addLog(`🔒 本关道具额外上锁：${equipment.map(e =>
      `【${(EQUIPMENT_LIB[e.no] || {}).name || e.no}】需蓝色 ${e.lockNum} 公开 ≥2`).join('；')}`, 'warn');
  }
  if (noMarkSeats.length) {
    addLog(`🎖 随机队长：${names[captainSeat]}（本关不能进行蓝线信息标记）。请其余玩家放置信息标记`, 'warn');
  } else {
    addLog(`🎖 随机队长：${names[captainSeat]}。请所有人放置信息标记（标记 1 张自己的蓝色导线）`);
  }
  saveStateDirect();
  _seenEquipRev = 0;                    // 新一局：道具锁版本重新计数
  _render();
}

/** 房主：再来一局（结算后；沿用本局关卡，避免刷新后选关丢失回退默认关） */
function restartGame() {
  if (S.phase !== 'over') return { ok: false, msg: '当前不在结算阶段' };
  if (!isHost()) return { ok: false, msg: '等待房主开始下一局' };
  dealGame(S.players.map(p => p.name), S.missionId);
  return { ok: true };
}

/** 放弃对局回到首页（联机模式该按钮被替换为「退出房间」） */
function resetGame() {
  if (S.phase === 'mark' || S.phase === 'play') {
    if (typeof window !== 'undefined' && !window.confirm('确定放弃当前对局并返回首页？')) return;
  }
  clearState();
  _render();
}

// ════════════════════════════════════════════════════════════════
//  标记阶段（信息标记：全员必须、开局一次性、绑定于牌）
// ════════════════════════════════════════════════════════════════

function placeInfoToken(cardId) {
  if (S.phase !== 'mark') return { ok: false, msg: '当前不是标记阶段' };
  if (timeoutGameIfNeeded()) return { ok: false, msg: '倒计时已结束' };
  const found = _findCardOwner(cardId);
  if (!found) return { ok: false, msg: '无效的牌' };
  const { seat, card } = found;
  if (!canActAs(seat)) return { ok: false, msg: '只能标记自己的导线' };
  if ((S.noMarkSeats || []).indexOf(seat) >= 0) return { ok: false, msg: '本关队长不能进行蓝线信息标记' };
  if (S.ready[seat]) return { ok: false, msg: '该玩家已完成标记' };
  if (card.kind !== 'blue') return { ok: false, msg: '只能标记蓝色导线' };
  if (card.revealed) return { ok: false, msg: '只能标记未公开的导线' };

  card.info = { num: card.num };
  S.ready[seat] = true;
  S.markAt[seat] = card.id;
  addLog(`📌 ${S.players[seat].name} 放置了信息标记：蓝色 ${card.num}`);

  if (S.ready.every(Boolean)) {
    S.phase = 'play';
    S.currentSeat = _startPlaySeat();
    addLog('✅ 全员信息标记完成，开始拆弹！');
  }
  saveStateDirect();
  _render();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//  行动 1：双人剪线
// ════════════════════════════════════════════════════════════════

/** 合法猜测项（猜测选择器数据）：我持有的未公开蓝数字 + 是否可猜黄色 */
function legalGuessOptions(seat) {
  const nums = [];
  for (const n of BLUE_NUMS) if (hiddenBlueCount(seat, n) > 0) nums.push(n);
  return { nums, yellow: hiddenYellowCount(seat) > 0 };
}

/**
 * 双人剪线：指认其他玩家 1 张未公开牌，猜测「蓝色 N」或「黄色」。
 * @param {number} toSeat 被指玩家座位
 * @param {string} cardId 被指牌
 * @param {{kind:'blue',num:number}|{kind:'yellow'}} guess
 * @param {string} ownCardId 命中时我（发起人）公开的自选牌（须同数字/黄色，预先选定保证原子性）
 */
function doPairCut(toSeat, cardId, guess, ownCardId) {
  const plan = _planPairCut(toSeat, cardId, guess, ownCardId);
  if (!plan.ok) return { ok: false, msg: plan.msg };
  return _applyPairCut(plan);
}

/** 校验并生成双人剪线计划（纯校验，无状态改动）；UI 层可在气泡对话后调用 _applyPairCut */
function _planPairCut(toSeat, cardId, guess, ownCardId) {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器，本回合须执行扫描' };
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  if (toSeat === actor || !S.players[toSeat]) return { ok: false, msg: '请选择其他玩家' };

  const card = _findCardById(cardId);
  if (!card || !_isInShares(card, S.players[toSeat].shares)) return { ok: false, msg: '无效的目标牌' };
  if (card.revealed) return { ok: false, msg: '只能猜测未公开的牌' };

  let hit;
  let label;
  if (guess && guess.kind === 'blue') {
    if (!(Number.isInteger(guess.num) && guess.num >= 1 && guess.num <= 12)) return { ok: false, msg: '无效的数字' };
    if (hiddenBlueCount(actor, guess.num) === 0) return { ok: false, msg: `你没有未公开的蓝色 ${guess.num}` };
    hit = card.kind === 'blue' && card.num === guess.num && !isRedLikeCard(card);
    label = `蓝色 ${guess.num}`;
  } else {
    if (hiddenYellowCount(actor) === 0) return { ok: false, msg: '你没有未公开的黄导线' };
    hit = card.kind === 'yellow';
    label = '黄色导线';
  }

  const own = _findCardById(ownCardId);
  if (!own || !_isInShares(own, S.players[actor].shares) || own.revealed) return { ok: false, msg: '请选择你的自选导线' };
  const ownMatch = (guess.kind === 'blue')
    ? (own.kind === 'blue' && own.num === guess.num && !isRedLikeCard(own))
    : own.kind === 'yellow';
  if (!ownMatch) return { ok: false, msg: '自选牌与猜测不符' };

  return { ok: true, actor, toSeat, card, own, guess, label, hit };
}

/** 执行双人剪线结算（气泡对话结束后由 UI 层调用） */
function _applyPairCut(plan) {
  const { actor, toSeat, card, own, guess, label, hit } = plan;
  const aName = S.players[actor].name;
  const tName = S.players[toSeat].name;

  if (hit) {
    if (guess.kind === 'blue' && _checkOrderOrBoom([guess.num])) return { ok: true, hit: true, boom: true };
    card.revealed = true;
    own.revealed = true;
    addLog(`✂️ ${aName} 指出 ${tName} 的导线为${label}，命中！双方各公开 1 张`, 'good');
    _consumeStabilize(false, actor);     // 稳定状态随本次剪线结算消耗（未触发保护）
    if (guess.kind === 'blue') _updateDefused(guess.num);
    if (_checkVictory()) return { ok: true, hit: true };
    endTurn(actor);
  } else {
    const stable = _consumeStabilize(true, actor);
    if (!stable) {
      S.failures++;
      addLog(`❌ ${aName} 猜测 ${tName} 的导线为${label}，错误（失误 ${S.failures}/${S.pCount}）`, 'bad');
      if (S.failures >= S.pCount) { _boom('boom-failures'); return { ok: true, hit: false }; }
      if (isRedLikeCard(card)) { _boom('boom-red'); return { ok: true, hit: false }; }
    }
    if (!isRedLikeCard(card)) {
      card.fail = card.kind === 'blue' ? { type: 'blue', num: card.num } : { type: 'yellow' };
      addLog('🔖 该牌真实信息已被标记公开');
    }
    endTurn(actor);
  }
  return { ok: true, hit };
}

// ════════════════════════════════════════════════════════════════
//  行动 2：单人剪线
// ════════════════════════════════════════════════════════════════

/** 当前可用的单人剪线选项（选择器数据） */
function soloOptions(seat) {
  const opts = [];
  for (const n of BLUE_NUMS) {
    const hidden = hiddenBlueCount(seat, n);
    const rev = blueRevealedCount(n);
    if (rev === 2 && hidden === 2) opts.push({ kind: 'pair', num: n });
    else if (rev === 0 && hidden === 4) opts.push({ kind: 'all', num: n });
  }
  const mine = hiddenYellowCount(seat);
  if (mine > 0 && mine === _hiddenYellowAll().length) opts.push({ kind: 'yellow' });
  return opts;
}

/**
 * 单人剪线 @param {{kind:'pair',num}|{kind:'all',num}|{kind:'yellow'}} opt
 */
function doSoloCut(opt) {
  const plan = _planSoloCut(opt);
  if (!plan.ok) return { ok: false, msg: plan.msg };
  return _applySoloCut(plan);
}

/** 校验并生成单人剪线计划（纯校验，无状态改动）；UI 层可在气泡对话后调用 _applySoloCut */
function _planSoloCut(opt) {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器，请执行扫描' };
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };

  if (opt && (opt.kind === 'pair' || opt.kind === 'all')) {
    const n = opt.num;
    const hidden = hiddenBlueCount(actor, n);
    const rev = blueRevealedCount(n);
    const ok = (opt.kind === 'pair') ? (rev === 2 && hidden === 2) : (rev === 0 && hidden === 4);
    if (!ok) return { ok: false, msg: '不满足单人剪线条件' };
    const cards = hiddenBlueCards(actor, n);
    return { ok: true, actor, kind: opt.kind, num: n, cards, count: cards.length, label: `蓝色 ${n}` };
  }
  if (opt && opt.kind === 'yellow') {
    const mine = hiddenCards(actor).filter(c => c.kind === 'yellow');
    if (!(mine.length > 0 && mine.length === _hiddenYellowAll().length)) return { ok: false, msg: '不满足黄线清收条件' };
    return { ok: true, actor, kind: 'yellow', num: null, cards: mine, count: mine.length, label: '黄色导线' };
  }
  return { ok: false, msg: '无效的选项' };
}

/** 执行单人剪线结算（气泡对话结束后由 UI 层调用） */
function _applySoloCut(plan) {
  const { actor, kind, num, cards } = plan;
  const name = S.players[actor].name;

  if (kind !== 'yellow' && _checkOrderOrBoom([num])) return { ok: true, boom: true };
  cards.forEach(c => { c.revealed = true; });
  if (kind === 'yellow') {
    addLog(`✂️ ${name} 单人剪线：清收全部黄导线 ×${cards.length}`, 'good');
  } else {
    addLog(`✂️ ${name} 单人剪线：公开蓝色 ${num} ×${cards.length}`, 'good');
    _updateDefused(num);
  }

  if (_checkVictory()) return { ok: true };
  endTurn(actor);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//  行动 3：公开红线
// ════════════════════════════════════════════════════════════════

/** 持红者自己仅剩红线未公开时可公开（含 #11 视为红线的蓝线） */
function canRevealRed(seat) {
  if (S.phase !== 'play' || S.pending || S.scanMode || S.result) return false;
  const hidden = hiddenCards(seat);
  return hidden.length > 0 && hidden.every(c => isRedLikeCard(c));
}

function doRevealRed() {
  const plan = _planRevealRed();
  if (!plan.ok) return { ok: false, msg: plan.msg };
  return _applyRevealRed(plan);
}

/** 校验并生成公开红线计划（纯校验，无状态改动）；UI 层可在气泡对话后调用 _applyRevealRed */
function _planRevealRed() {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器，请执行扫描' };
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  if (!canRevealRed(actor)) return { ok: false, msg: '只有持红者在自己其余牌全部公开时才能公开红线' };
  const cards = hiddenCards(actor);
  return { ok: true, actor, cards, card: cards[0], count: cards.length, label: '红色导线' };
}

/** 执行公开红线结算（气泡对话结束后由 UI 层调用） */
function _applyRevealRed(plan) {
  const cards = plan.cards || [plan.card];
  cards.forEach(c => { c.revealed = true; });
  const redlike = cards.filter(c => c.kind === 'blue').length;
  addLog(`🚨 ${S.players[plan.actor].name} 公开了${cards.length > 1 ? ` ${cards.length} 张` : ''}红色导线${redlike ? `（含 ${redlike} 张视为红线的蓝色导线）` : ''}！`, 'warn');
  if (_checkVictory()) return { ok: true };
  endTurn(plan.actor);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//  双重探测器（技能）/ 三重探测器（道具 3）
// ════════════════════════════════════════════════════════════════

/** 启动双重探测器：本回合的双人剪线升级为「扫描相邻 2 张」 */
function useSkill() {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  const p = S.players[actor];
  if (p.skillUsed) return { ok: false, msg: '本局已使用过双重探测器' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器' };
  p.skillUsed = true;
  S.scanMode = { count: 2, src: 'skill', by: actor };
  addLog(`🔎 ${p.name} 启动双重探测器：请扫描相邻 2 张手牌`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 取消已启动的双重探测器（尚未执行扫描 = 未消耗，可反悔） */
function cancelSkill() {
  if (!S.scanMode || S.scanMode.src !== 'skill') return { ok: false, msg: '未启动双重探测器' };
  const actor = (typeof S.scanMode.by === 'number') ? S.scanMode.by : S.currentSeat;
  if (!canActAs(actor)) return { ok: false, msg: '等待探测器使用者操作' };
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  const p = S.players[actor];
  p.skillUsed = false;
  S.scanMode = null;
  addLog(`↩️ ${p.name} 取消使用双重探测器`, 'warn');
  saveState();
  _render();
  return { ok: true };
}

/**
 * 执行扫描（技能 2 张 / 三重探测器 3 张）。
 * @param {string[]} cardIds 同一名其他玩家同一份内相邻的未公开牌（2/3 张）
 * @param {number} num 猜测的蓝色数字
 * @param {string} ownCardId 命中时公开的自选蓝牌（同数字）
 * @param {'skill'|'eq3'} src
 */
function doScan(cardIds, num, ownCardId, src) {
  const plan = _planScan(cardIds, num, ownCardId, src);
  if (!plan.ok) return { ok: false, msg: plan.msg };
  return _applyScan(plan);
}

/** 校验并生成扫描计划（纯校验，无状态改动）；UI 层可在气泡对话后调用 _applyScan */
function _planScan(cardIds, num, ownCardId, src) {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  const count = src === 'skill' ? 2 : 3;

  if (src === 'skill') {
    if (!S.scanMode || S.scanMode.src !== 'skill') return { ok: false, msg: '请先启动双重探测器' };
    if (typeof S.scanMode.by === 'number' && S.scanMode.by !== actor) return { ok: false, msg: '等待探测器使用者操作' };
  } else {
    if (S.scanMode) return { ok: false, msg: '已启动技能扫描，请执行扫描' };
  }

  let eq3 = null;
  if (src === 'eq3') {
    eq3 = S.equipment.find(e => e.no === 3);
    if (!eq3 || !eq3.unlocked || eq3.used) return { ok: false, msg: '【三重探测器】不可用' };
  }

  if (!Array.isArray(cardIds) || cardIds.length !== count) return { ok: false, msg: `请选择相邻的 ${count} 张牌` };

  let targetSeat = null;
  let loc = null;
  for (let s = 0; s < S.pCount; s++) {
    if (s === actor) continue;
    const r = _adjacentRun((S.players[s].shares || []), cardIds, count);
    if (r) { targetSeat = s; loc = r; break; }
  }
  if (targetSeat === null) return { ok: false, msg: '须为同一名玩家的同一份相邻导线' };

  const targetCards = loc.idxs.map(i => S.players[targetSeat].shares[loc.si][i]);
  if (targetCards.some(c => c.revealed)) return { ok: false, msg: '只能扫描未公开的牌' };

  if (!(Number.isInteger(num) && num >= 1 && num <= 12)) return { ok: false, msg: '无效的数字' };
  if (hiddenBlueCount(actor, num) === 0) return { ok: false, msg: `你没有未公开的蓝色 ${num}` };
  const own = _findCardById(ownCardId);
  if (!own || !_isInShares(own, S.players[actor].shares) || own.revealed
      || own.kind !== 'blue' || own.num !== num || isRedLikeCard(own)) {
    return { ok: false, msg: '自选牌须为同数字的未公开蓝导线' };
  }

  const matched = targetCards.filter(c => c.kind === 'blue' && c.num === num && !isRedLikeCard(c));
  return { ok: true, actor, targetSeat, targetCards, count, num, ownCardId, src, eq3, matched, label: `蓝色 ${num}`, hit: matched.length > 0 };
}

/** 执行扫描结算（气泡对话结束后由 UI 层调用） */
function _applyScan(plan) {
  const { actor, targetSeat, targetCards, count, num, ownCardId, src, eq3, matched } = plan;
  if (eq3) eq3.used = true;

  const aName = S.players[actor].name;
  const tName = S.players[targetSeat].name;

  if (matched.length > 0) {
    if (_checkOrderOrBoom([num])) return { ok: true, hit: true, boom: true };
    addLog(`🔎 ${aName} 扫描 ${tName} 的相邻 ${count} 张手牌，命中蓝色 ${num}！`, 'good');
    _consumeStabilize(false, actor);
    S.pending = {
      type: 'scanPick', fromSeat: actor, toSeat: targetSeat,
      cards: matched.map(c => c.id), guessNum: num, ownCardId, src,
    };
    S.currentSeat = targetSeat;         // 临时移交给待选择方（使其推送通过行动者守卫）
    saveStateDirect();
    _render();
    return { ok: true, hit: true };
  }

  const stable = _consumeStabilize(true, actor);
  if (!stable) {
    S.failures++;
    addLog(`❌ ${aName} 扫描 ${tName} 的相邻 ${count} 张手牌，未命中「蓝色 ${num}」（失误 ${S.failures}/${S.pCount}）`, 'bad');
    if (S.failures >= S.pCount) { _boom('boom-failures'); return { ok: true, hit: false }; }
  } else {
    addLog(`🔎 ${aName} 扫描 ${tName} 的相邻 ${count} 张手牌，未命中「蓝色 ${num}」`, 'warn');
  }

  const markable = targetCards.filter(c => !isRedLikeCard(c));
  if (markable.length === 0) {
    addLog(`🔖 ${tName} 该份没有可标记的非红色导线，跳过身份标记`);
    endTurn(actor);
  } else if (markable.length === 1) {
    _placeScanMark(markable[0], targetSeat, actor, src);
  } else {
    S.pending = {
      type: 'scanMark', fromSeat: actor, toSeat: targetSeat,
      cards: markable.map(c => c.id), src,
    };
    S.currentSeat = targetSeat;
    saveStateDirect();
    _render();
  }
  return { ok: true, hit: false };
}

/** 被扫描玩家选择公开哪一张命中的牌（scanPick=双重/三重/超级探测器共用） */
function resolveScanPick(cardId) {
  const pd = S.pending;
  if (!pd || (pd.type !== 'scanPick' && pd.type !== 'superPick')) return { ok: false, msg: '没有待处理的扫描' };
  if (!canActAs(pd.toSeat)) return { ok: false, msg: '等待被扫描玩家选择' };
  if (!pd.cards.includes(cardId)) return { ok: false, msg: '请选择命中的牌之一' };
  const card = _findCardById(cardId);
  const own = _findCardById(pd.ownCardId);
  if (!card || card.revealed || !own || own.revealed || isRedLikeCard(card)) {
    return { ok: false, msg: '状态已变化，请重试' };
  }

  if (_checkOrderOrBoom([card.num])) return { ok: true, boom: true };
  card.revealed = true;
  own.revealed = true;
  addLog(`🔎 ${S.players[pd.toSeat].name} 公开了蓝色 ${card.num}；${S.players[pd.fromSeat].name} 同步公开蓝色 ${own.num}`, 'good');
  S.pending = null;
  S.currentSeat = pd.fromSeat;          // 回合先归还发起者，再走 endTurn 结算流转
  _updateDefused(card.num);
  if (_checkVictory()) return { ok: true };
  // 探测器类（技能/三重/超级）皆为「本回合行动」：结算即结束回合
  endTurn(pd.fromSeat);
  return { ok: true };
}

/** 被扫描玩家选择非红牌放置身份标记（scanMark=双重/三重/超级探测器共用） */
function resolveScanMark(cardId) {
  const pd = S.pending;
  if (!pd || (pd.type !== 'scanMark' && pd.type !== 'superMark')) return { ok: false, msg: '没有待处理的扫描' };
  if (!canActAs(pd.toSeat)) return { ok: false, msg: '等待被扫描玩家选择' };
  if (!pd.cards.includes(cardId)) return { ok: false, msg: '请从可选牌中选择' };
  const card = _findCardById(cardId);
  if (!card || isRedLikeCard(card)) return { ok: false, msg: '必须选择非红色导线' };

  const fromSeat = pd.fromSeat;
  const src = pd.src;
  S.pending = null;
  S.currentSeat = fromSeat;
  _placeScanMark(card, pd.toSeat, fromSeat, src);
  return { ok: true };
}

function _placeScanMark(card, targetSeat, fromSeat, src) {
  if (isRedLikeCard(card)) return;
  card.fail = card.kind === 'blue' ? { type: 'blue', num: card.num } : { type: 'yellow' };
  addLog(`🔖 ${S.players[targetSeat].name} 放置信息标记：${card.fail.type === 'blue' ? '蓝色 ' + card.fail.num : '黄色'}`);
  // 探测器类皆为「本回合行动」：标记落定即结束回合
  endTurn(fromSeat);
}

// ════════════════════════════════════════════════════════════════
//  道具 1【≠标签】/ 道具 2【对讲机】
// ════════════════════════════════════════════════════════════════

/** 【≠标签】：同一份内相邻 2 张（编号不同、至少 1 张蓝色，可含已公开牌） */
function useNeqTag(shareIdx, cardId1, cardId2) {
  const g = _equipBasic(1);
  if (!g.ok) return g;
  const a = _equipActor(1);
  if (!a.ok) return a;
  const actor = a.seat;
  const eq = g.eq;

  const p = S.players[actor];
  const share = (p.shares || [])[shareIdx];
  if (!share) return { ok: false, msg: '无效的份' };
  const i1 = share.findIndex(c => c.id === cardId1);
  const i2 = share.findIndex(c => c.id === cardId2);
  if (i1 < 0 || i2 < 0 || Math.abs(i1 - i2) !== 1) return { ok: false, msg: '须为同一份内相邻的 2 张牌' };
  const c1 = share[Math.min(i1, i2)];
  const c2 = share[Math.max(i1, i2)];
  if (c1.neq || c2.neq) return { ok: false, msg: '该牌已有【≠】标签' };
  if (c1.num === c2.num) return { ok: false, msg: '两张牌编号相同，无标记意义' };
  if (c1.kind !== 'blue' && c2.kind !== 'blue') return { ok: false, msg: '至少需含 1 张蓝色导线' };

  const pairId = 'nq' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
  c1.neq = pairId;
  c2.neq = pairId;
  eq.used = true;
  _releaseEquipLock();
  addLog(`≠ ${p.name} 标记了两张相邻导线【≠】：编号不同`, 'good');
  saveStateDirect();
  _render();
  return { ok: true };
}

/** 【对讲机】：我选 1 张未公开牌，指定他人；对方选出后交换 */
function useWalkie(fromCardId, toSeat) {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器，请执行扫描' };
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  const eq = S.equipment.find(e => e.no === 2);
  if (!eq || !eq.unlocked || eq.used) return { ok: false, msg: '【对讲机】不可用' };
  if (toSeat === actor || !S.players[toSeat]) return { ok: false, msg: '请选择其他玩家' };
  const card = _findCardById(fromCardId);
  if (!card || !_isInShares(card, S.players[actor].shares) || card.revealed) {
    return { ok: false, msg: '请选择自己的 1 张未公开导线' };
  }

  eq.used = true;
  S.pending = { type: 'walkie', fromSeat: actor, toSeat, fromCardId };
  S.currentSeat = toSeat;               // 移交接收方选择
  addLog(`📻 ${S.players[actor].name} 使用对讲机，指定与 ${S.players[toSeat].name} 交换导线，等待对方选择…`, 'warn');
  saveStateDirect();
  _render();
  return { ok: true };
}

/** 接收方选择自己的 1 张未公开牌完成交换 */
function resolveWalkie(cardId) {
  const pd = S.pending;
  if (!pd || pd.type !== 'walkie') return { ok: false, msg: '没有待处理的交换' };
  if (!canActAs(pd.toSeat)) return { ok: false, msg: '等待接收方选择' };

  const a = S.players[pd.fromSeat];
  const b = S.players[pd.toSeat];
  const fromCard = _findCardById(pd.fromCardId);
  const toCard = _findCardById(cardId);
  if (!fromCard || fromCard.revealed) return { ok: false, msg: '发起牌状态已变化' };
  if (!toCard || toCard.id === pd.fromCardId || !_isInShares(toCard, b.shares) || toCard.revealed) {
    return { ok: false, msg: '请选择自己的 1 张未公开导线' };
  }

  const fa = _locate(fromCard, a.shares);
  const tb = _locate(toCard, b.shares);
  if (!fa || !tb) return { ok: false, msg: '状态异常，请重试' };

  // 交换：各自放入对方交出的那份，随后立即重排
  a.shares[fa.si].splice(fa.idx, 1);
  b.shares[tb.si].splice(tb.idx, 1);
  a.shares[fa.si].push(toCard);
  b.shares[tb.si].push(fromCard);
  a.shares[fa.si].sort(_numCmp);
  b.shares[tb.si].sort(_numCmp);

  // 挑出与落点位次（全网可见，牌面保持隐藏）
  const aInLoc = _locate(toCard, a.shares);    // B 交出的牌落在 A 的位次
  const bInLoc = _locate(fromCard, b.shares);  // A 交出的牌落在 B 的位次
  const posLabel = l => `第 ${l.si + 1} 份 · 第 ${l.idx + 1} 张`;
  S.walkieInfo = {
    aSeat: pd.fromSeat,
    bSeat: pd.toSeat,
    aCardId: fromCard.id,
    bCardId: toCard.id,
    aOut: { si: fa.si, idx: fa.idx },
    bOut: { si: tb.si, idx: tb.idx },
    aIn: { si: aInLoc.si, idx: aInLoc.idx },
    bIn: { si: bInLoc.si, idx: bInLoc.idx },
  };

  // 被交换牌的标记自动废弃（信息/失败/≠ 均不随牌移动）
  _voidCardMarkers(fromCard);
  _voidCardMarkers(toCard);
  _validateNeqPairs();

  S.pending = null;
  S.currentSeat = S.freeCut ? -2 : pd.fromSeat;   // 自由剪线：回到无人锁定的等待态
  addLog(`📻 ${a.name} 交出 ${posLabel(S.walkieInfo.aOut)} → ${b.name} 落点 ${posLabel(S.walkieInfo.bIn)}；`
    + `${b.name} 交出 ${posLabel(S.walkieInfo.bOut)} → ${a.name} 落点 ${posLabel(S.walkieInfo.aIn)}（牌面保持隐藏）`, 'warn');
  saveStateDirect();
  _render();
  return { ok: true };
}

function _voidCardMarkers(card) {
  card.info = null;
  card.fail = null;
  if (card.neq) {
    const pid = card.neq;
    card.neq = null;
    _eachCard(c => { if (c.neq === pid) c.neq = null; });
  }
  if (card.eqp) {
    const pid = card.eqp;
    card.eqp = null;
    _eachCard(c => { if (c.eqp === pid) c.eqp = null; });
  }
}

/** 全局校验【≠】/【＝】标签：配对双方须仍为同一玩家同一份内的相邻牌，否则自动废弃 */
function _validateNeqPairs() {
  const loc = {};
  const pairs = {};
  _eachCard((c, p) => {
    for (let si = 0; si < (p.shares || []).length; si++) {
      const i = p.shares[si].findIndex(x => x.id === c.id);
      if (i >= 0) { loc[c.id] = { seat: p.seat, si, idx: i }; break; }
    }
    for (const field of ['neq', 'eqp']) {
      if (c[field]) {
        const key = field + ':' + c[field];
        (pairs[key] = pairs[key] || []).push({ card: c, field });
      }
    }
  });
  for (const key in pairs) {
    const arr = pairs[key];
    const field = arr[0].field;
    if (arr.length === 2) {
      const a = arr[0].card;
      const b = arr[1].card;
      const la = loc[a.id];
      const lb = loc[b.id];
      const ok = la && lb && la.seat === lb.seat && la.si === lb.si && Math.abs(la.idx - lb.idx) === 1;
      if (!ok) { a[field] = null; b[field] = null; }
    } else {
      arr.forEach(x => { x.card[field] = null; });
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  道具 4~12（解锁 = 对应编号蓝线公开 ≥2；除 1/4/12 外仅自己回合可用）
// ════════════════════════════════════════════════════════════════

/** 道具基础可用性（不含回合/操作锁判定） */
function _equipBasic(no) {
  if (!S || S.phase !== 'play' || S.pending || S.result || S.fx) {
    return { ok: false, msg: '现在不能行动' };
  }
  if (S.scanMode) return { ok: false, msg: '已启动探测器，请执行扫描' };
  const eq = S.equipment.find(e => e.no === no);
  const name = (EQUIPMENT_LIB[no] || {}).name || ('道具 ' + no);
  if (!eq) return { ok: false, msg: `【${name}】不可用` };
  if (eq.used) return { ok: false, msg: `【${name}】已使用过` };
  if (!eq.unlocked) {
    const lock = (typeof eq.lockNum === 'number')
      ? `（需蓝色 ${eq.no} 公开 ≥2，且蓝色 ${eq.lockNum} 公开 ≥2）` : `（蓝色 ${eq.no} 公开 ≥2 后解锁）`;
    return { ok: false, msg: `【${name}】不可用：尚未解锁${lock}` };
  }
  return { ok: true, eq };
}

/** 取道具并做通用可用性校验（仅当前行动者；跨回合道具走 _equipBasic + _equipActor） */
function _equipUsable(no) {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  return _equipBasic(no);
}

/** 跨回合道具的提交守卫：必须持有对应操作锁；无锁时退回当前行动者（本地/旧流程） */
function _equipActor(no) {
  if (!S || S.phase !== 'play' || S.pending || S.result || S.fx) {
    return { ok: false, msg: '现在不能行动' };
  }
  if (timeoutGameIfNeeded()) return { ok: false, msg: '现在不能行动' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器，请执行扫描' };
  const lock = _equipLockActive();
  if (lock) {
    if (lock.no !== no) {
      return { ok: false, msg: `请先完成【${(EQUIPMENT_LIB[lock.no] || {}).name || ('道具 ' + lock.no)}】的操作` };
    }
    if (!_equipLockOwnedBy(mySeat())) {
      return { ok: false, msg: `等待 ${S.players[lock.seat].name} 完成道具操作` };
    }
    return { ok: true, seat: lock.seat, lock };
  }
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  return { ok: true, seat: actor, lock: null };
}

/** 开始道具操作前的统一校验；返回错误文案或 null */
function _equipStartBlock(no) {
  if (!S || S.phase !== 'play' || S.result || S.fx) return '现在不能使用道具';
  if (S.pending) return '请先完成当前操作';
  if (timeoutGameIfNeeded()) return '现在不能行动';
  if (S.scanMode) return '已启动探测器，本回合只能扫描';
  const lock = _equipLockActive();
  if (lock) {
    if (!_equipLockOwnedBy(mySeat())) {
      return `${S.players[lock.seat].name} 正在使用【${(EQUIPMENT_LIB[lock.no] || {}).name || ('道具 ' + lock.no)}】，请稍候`;
    }
    return '你正在使用道具，请先完成或取消';
  }
  if (!_canUseEquipAnytime(no) && !_myTurn()) return '只能在自己回合使用道具';
  if (_canUseEquipAnytime(no) && mySeat() === null && !_myTurn()) return '现在不能行动';
  const g = _equipBasic(no);
  if (!g.ok) return g.msg;
  return null;
}

/** 抢占跨回合道具操作锁：写入共享状态并立即推送，全场进入等待 */
function _acquireEquipLock(no) {
  const msg = _equipStartBlock(no);
  if (msg) return { ok: false, msg };
  const seat = mySeat() !== null ? mySeat() : _actionSeat();
  if (seat === null || !S.players[seat]) return { ok: false, msg: '现在不能行动' };
  const token = 'el' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  S.equipRev = (S.equipRev || 0) + 1;
  S.equipLock = { seat, no, at: Date.now(), token };
  saveStateDirect();
  _render();
  return { ok: true, seat, token };
}

/** 取消本端持有的操作锁（提交成功后也走这里清理） */
function _cancelMyEquipLock() {
  const l = _equipLockActive();
  if (!l || !_equipLockOwnedBy(mySeat())) return false;
  _releaseEquipLock();
  return true;
}

/** 【便利贴】：再标记自己 1 张未公开且无信息标记的蓝线（绑定于牌，交换废弃） */
function useStickyNote(cardId) {
  const g = _equipBasic(4);
  if (!g.ok) return g;
  const a = _equipActor(4);
  if (!a.ok) return a;
  const actor = a.seat;
  const card = _findCardById(cardId);
  if (!card || !_isInShares(card, S.players[actor].shares)) return { ok: false, msg: '请选择自己的导线' };
  if (card.kind !== 'blue') return { ok: false, msg: '只能标记蓝色导线' };
  if (card.revealed) return { ok: false, msg: '只能标记未公开的导线' };
  if (card.info) return { ok: false, msg: '该牌已有信息标记' };

  card.info = { num: card.num };
  g.eq.used = true;
  _releaseEquipLock();
  addLog(`📃 ${S.players[actor].name} 使用便利贴，标记：蓝色 ${card.num}`, 'good');
  saveStateDirect();
  _render();
  return { ok: true };
}

/**
 * 【超级探测器】：扫描其他玩家「一整份」手牌，猜「其中有蓝色 N」（本回合行动，结算即结束回合）。
 * @param {number} toSeat 目标玩家
 * @param {number} shareIdx 目标的份下标
 * @param {number} num 猜测的蓝色数字（须自己持有未公开蓝 N）
 * @param {string} ownCardId 命中时公开的自选蓝牌（同数字）
 */
function doSuperScan(toSeat, shareIdx, num, ownCardId) {
  const plan = _planSuperScan(toSeat, shareIdx, num, ownCardId);
  if (!plan.ok) return { ok: false, msg: plan.msg };
  return _applySuperScan(plan);
}

function _planSuperScan(toSeat, shareIdx, num, ownCardId) {
  const g = _equipUsable(5);
  if (!g.ok) return g;
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  if (toSeat === actor || !S.players[toSeat]) return { ok: false, msg: '请选择其他玩家' };
  const share = (S.players[toSeat].shares || [])[shareIdx];
  if (!share) return { ok: false, msg: '无效的手牌' };
  const hidden = share.filter(c => !c.revealed);
  if (hidden.length === 0) return { ok: false, msg: '该份手牌已全部公开' };
  if (!(Number.isInteger(num) && num >= 1 && num <= 12)) return { ok: false, msg: '无效的数字' };
  if (hiddenBlueCount(actor, num) === 0) return { ok: false, msg: `你没有未公开的蓝色 ${num}` };
  const own = _findCardById(ownCardId);
  if (!own || !_isInShares(own, S.players[actor].shares) || own.revealed
      || own.kind !== 'blue' || own.num !== num || isRedLikeCard(own)) {
    return { ok: false, msg: '自选牌须为同数字的未公开蓝导线' };
  }
  const matched = hidden.filter(c => c.kind === 'blue' && c.num === num && !isRedLikeCard(c));
  return {
    ok: true, actor, toSeat, shareIdx, targetCards: hidden, count: hidden.length,
    num, ownCardId, eq5: g.eq, matched, label: `蓝色 ${num}`, hit: matched.length > 0, src: 'eq5',
  };
}

function _applySuperScan(plan) {
  const { actor, toSeat, targetCards, num, ownCardId, eq5, matched } = plan;
  if (eq5) eq5.used = true;
  const aName = S.players[actor].name;
  const tName = S.players[toSeat].name;

  if (matched.length > 0) {
    if (_checkOrderOrBoom([num])) return { ok: true, hit: true, boom: true };
    addLog(`🛰️ ${aName} 用超级探测器扫描 ${tName} 的整份手牌，命中蓝色 ${num}！`, 'good');
    _consumeStabilize(false, actor);
    S.pending = {
      type: 'superPick', fromSeat: actor, toSeat,
      cards: matched.map(c => c.id), guessNum: num, ownCardId, src: 'eq5',
    };
    S.currentSeat = toSeat;
    saveStateDirect();
    _render();
    return { ok: true, hit: true };
  }

  const stable = _consumeStabilize(true, actor);
  if (!stable) {
    S.failures++;
    addLog(`❌ ${aName} 的超级探测器未命中「蓝色 ${num}」（失误 ${S.failures}/${S.pCount}）`, 'bad');
    if (S.failures >= S.pCount) { _boom('boom-failures'); return { ok: true, hit: false }; }
  }

  const markable = targetCards.filter(c => c.kind === 'blue' && !isRedLikeCard(c));
  if (markable.length === 0) {
    addLog('🔖 该份没有可标记的未公开蓝线，跳过身份标记', 'warn');
    endTurn(actor);
  } else if (markable.length === 1) {
    _placeScanMark(markable[0], toSeat, actor, 'eq5');
  } else {
    S.pending = { type: 'superMark', fromSeat: actor, toSeat, cards: markable.map(c => c.id), src: 'eq5' };
    S.currentSeat = toSeat;
    saveStateDirect();
    _render();
  }
  return { ok: true, hit: false };
}

/** 【抑制器】：失败数 −1（0 失败时不可用；已达 P 的爆炸即时触发、无法补救） */
function useSuppressor() {
  const g = _equipUsable(6);
  if (!g.ok) return g;
  if (S.failures <= 0) return { ok: false, msg: '当前没有失误可消除' };
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };

  S.failures--;
  g.eq.used = true;
  addLog(`🧯 ${S.players[actor].name} 使用抑制器：失误 −1（当前 ${S.failures}/${S.pCount}）`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 【备用电池】：指定 1~2 名本局已使用双重探测器的玩家（可含自己），恢复其技能 */
function useBattery(seats) {
  const g = _equipUsable(7);
  if (!g.ok) return g;
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  const arr = Array.isArray(seats) ? Array.from(new Set(seats)) : [];
  if (arr.length < 1 || arr.length > 2) return { ok: false, msg: '请指定 1~2 名玩家' };
  for (const s of arr) {
    if (!S.players[s]) return { ok: false, msg: '无效的玩家' };
    if (!S.players[s].skillUsed) return { ok: false, msg: `${S.players[s].name} 尚未使用过双重探测器` };
  }

  arr.forEach(s => { S.players[s].skillUsed = false; });
  g.eq.used = true;
  addLog(`🔋 ${S.players[actor].name} 使用备用电池：${arr.map(s => S.players[s].name).join('、')} 的双重探测器已恢复`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 【通用雷达】：选 1 个蓝数字，系统按真实手牌自动公布每人每份「有/无」未公开该数字蓝线 */
function useRadar(num) {
  const g = _equipUsable(8);
  if (!g.ok) return g;
  if (!(Number.isInteger(num) && num >= 1 && num <= 12)) return { ok: false, msg: '无效的数字' };

  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  const rows = [];
  for (let s = 0; s < S.pCount; s++) {
    const per = (S.players[s].shares || []).map(sh =>
      sh.some(c => !c.revealed && c.kind === 'blue' && c.num === num && !isRedLikeCard(c)));
    rows.push({ seat: s, per });
  }
  S.radar = { num, rows, by: actor };
  g.eq.used = true;
  const desc = rows.map(r => {
    const multi = r.per.length > 1;
    const per = r.per.map((b, i) =>
      `${multi ? `第${i + 1}份手牌` : '手牌'}${b ? '有' : '无'}数字${num}`).join('、');
    return `${S.players[r.seat].name}：${per}`;
  }).join('；');
  addLog(`📡 ${S.players[actor].name} 使用通用雷达探测蓝色 ${num}——${desc}`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 【稳定剂】：进入稳定状态（不锁定行动）；剪线结算时消耗，回合结束未消耗则退还 */
function useStabilizer() {
  const g = _equipUsable(9);
  if (!g.ok) return g;
  if (S.cutMods && S.cutMods.stabilize !== null && S.cutMods.stabilize !== undefined) {
    return { ok: false, msg: '稳定状态已生效' };
  }
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };

  S.cutMods = S.cutMods || { stabilize: null };
  S.cutMods.stabilize = actor;
  addLog(`🧪 ${S.players[actor].name} 使用稳定剂：本回合剪线失误不计、红线不爆`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 取消稳定剂（未消耗，可反悔） */
function cancelStabilizer() {
  if (!S.cutMods || S.cutMods.stabilize === null || S.cutMods.stabilize === undefined) {
    return { ok: false, msg: '未启动稳定剂' };
  }
  const seat = S.cutMods.stabilize;
  if (!canActAs(seat)) return { ok: false, msg: '等待稳定剂使用者操作' };
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  S.cutMods.stabilize = null;
  addLog(`↩️ ${S.players[seat].name} 取消使用稳定剂`, 'warn');
  saveState();
  _render();
  return { ok: true };
}

/** 消耗稳定剂（剪线结算时调用）；applied=是否实际触发保护（未命中）
 *  自由剪线：只有使用者本人的剪线才会消耗，其他玩家剪线不触发 */
function _consumeStabilize(applied, actor) {
  if (!S.cutMods || S.cutMods.stabilize === null || S.cutMods.stabilize === undefined) return false;
  if (S.freeCut && typeof actor === 'number' && S.cutMods.stabilize !== actor) return false;
  const eq = S.equipment.find(e => e.no === 9);
  if (eq) eq.used = true;
  S.cutMods.stabilize = null;
  addLog(applied
    ? '🧪 稳定剂生效：本次失误不计入、红线不引爆'
    : '🧪 稳定剂随本次剪线结算消耗', applied ? 'good' : 'warn');
  return true;
}

/**
 * 【X/Y射线】：指定他人 1 张未公开牌，一次声明 2 个选项「蓝A或蓝B」/「蓝A或黄」
 * （本回合行动，结算即结束回合）。
 * @param {{kind:'blue',num}|{kind:'yellow'}} a 选项 1（blue 在前）
 * @param {{kind:'blue',num}|{kind:'yellow'}} b 选项 2
 * @param {string} ownAId / @param {string} ownBId 命中对应选项时公开的自选牌
 */
function doRayCut(toSeat, cardId, a, b, ownAId, ownBId) {
  const plan = _planRayCut(toSeat, cardId, a, b, ownAId, ownBId);
  if (!plan.ok) return { ok: false, msg: plan.msg };
  return _applyRayCut(plan);
}

function _normGuessOpt(opt) {
  if (!opt) return null;
  if (opt.kind === 'yellow') return { kind: 'yellow' };
  if (opt.kind === 'blue' && Number.isInteger(opt.num) && opt.num >= 1 && opt.num <= 12) {
    return { kind: 'blue', num: opt.num };
  }
  return null;
}

function _planRayCut(toSeat, cardId, a, b, ownAId, ownBId) {
  const g = _equipUsable(10);
  if (!g.ok) return g;
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  if (toSeat === actor || !S.players[toSeat]) return { ok: false, msg: '请选择其他玩家' };
  const card = _findCardById(cardId);
  if (!card || !_isInShares(card, S.players[toSeat].shares)) return { ok: false, msg: '无效的目标牌' };
  if (card.revealed) return { ok: false, msg: '只能猜测未公开的牌' };

  const na = _normGuessOpt(a);
  const nb = _normGuessOpt(b);
  if (!na || !nb) return { ok: false, msg: '无效的猜测选项' };
  if (na.kind === 'yellow' && nb.kind === 'yellow') return { ok: false, msg: '两个选项不能都是黄色' };
  if (na.kind === 'blue' && nb.kind === 'blue' && na.num === nb.num) return { ok: false, msg: '两个蓝色数字不能相同' };

  const holds = o => o.kind === 'blue' ? hiddenBlueCount(actor, o.num) > 0 : hiddenYellowCount(actor) > 0;
  if (!holds(na) || !holds(nb)) return { ok: false, msg: '两个选项都须持有对应未公开导线' };

  const ownA = _findCardById(ownAId);
  const ownB = _findCardById(ownBId);
  const ownMatches = (own, o) => own && !own.revealed && _isInShares(own, S.players[actor].shares)
    && (o.kind === 'blue'
      ? (own.kind === 'blue' && own.num === o.num && !isRedLikeCard(own))
      : own.kind === 'yellow');
  if (!ownMatches(ownA, na)) return { ok: false, msg: '自选牌 A 与选项不符' };
  if (!ownMatches(ownB, nb)) return { ok: false, msg: '自选牌 B 与选项不符' };
  if (ownA.id === ownB.id) return { ok: false, msg: '两个选项的自选牌不能相同' };

  const hitA = na.kind === 'blue'
    ? (card.kind === 'blue' && card.num === na.num && !isRedLikeCard(card))
    : card.kind === 'yellow';
  const hitB = nb.kind === 'blue'
    ? (card.kind === 'blue' && card.num === nb.num && !isRedLikeCard(card))
    : card.kind === 'yellow';
  const label = (na.kind === 'blue' && nb.kind === 'blue')
    ? `蓝色 ${na.num} 或 蓝色 ${nb.num}`
    : `蓝色 ${na.kind === 'blue' ? na.num : nb.num} 或 黄色`;
  return {
    ok: true, actor, toSeat, card, a: na, b: nb, ownA, ownB, eq10: g.eq,
    label, hit: hitA || hitB, matchedOwn: hitA ? ownA : (hitB ? ownB : null), src: 'eq10',
  };
}

function _applyRayCut(plan) {
  const { actor, toSeat, card, eq10, label, hit } = plan;
  if (eq10) eq10.used = true;
  const aName = S.players[actor].name;
  const tName = S.players[toSeat].name;

  if (hit) {
    if (plan.matchedOwn.kind === 'blue' && _checkOrderOrBoom([plan.matchedOwn.num])) {
      return { ok: true, hit: true, boom: true };
    }
    card.revealed = true;
    plan.matchedOwn.revealed = true;
    addLog(`✂️ ${aName} 用 X/Y 射线指出 ${tName} 的导线为「${label}」之一，命中！`, 'good');
    _consumeStabilize(false, actor);
    if (plan.matchedOwn.kind === 'blue') _updateDefused(plan.matchedOwn.num);
    if (_checkVictory()) return { ok: true, hit: true };
    endTurn(actor);
  } else {
    const stable = _consumeStabilize(true, actor);
    if (!stable) {
      S.failures++;
      addLog(`❌ ${aName} 的 X/Y 射线猜测「${label}」错误（失误 ${S.failures}/${S.pCount}）`, 'bad');
      if (S.failures >= S.pCount) { _boom('boom-failures'); return { ok: true, hit: false }; }
      if (isRedLikeCard(card)) { _boom('boom-red'); return { ok: true, hit: false }; }
    }
    if (!isRedLikeCard(card)) {
      card.fail = card.kind === 'blue' ? { type: 'blue', num: card.num } : { type: 'yellow' };
      addLog('🔖 该牌真实信息已被标记公开');
    }
    endTurn(actor);
  }
  return { ok: true, hit };
}

/** 【咖啡瓶】：跳过自己回合（不行动），从指定玩家（须仍有未公开手牌）继续 */
function useCoffee(targetSeat) {
  const g = _equipUsable(11);
  if (!g.ok) return g;
  const actor = _actionSeat();
  if (actor === null) return { ok: false, msg: '现在不能行动' };
  if (targetSeat === actor || !S.players[targetSeat]) return { ok: false, msg: '请选择其他玩家' };
  if (hiddenCards(targetSeat).length === 0) return { ok: false, msg: `${S.players[targetSeat].name} 没有未公开手牌` };

  g.eq.used = true;
  _clearTurnEffects();
  S.currentSeat = targetSeat;
  addLog(`☕ ${S.players[actor].name} 使用咖啡瓶：跳过自己的回合，由 ${S.players[targetSeat].name} 继续`, 'warn');
  saveState();
  _render();
  return { ok: true };
}

/** 【＝标签】：同一份内相邻 2 张，宣告「编号相同」（蓝蓝同数字 / 黄黄 / 红红）；至少 1 张未公开 */
function useEqTag(shareIdx, cardId1, cardId2) {
  const g = _equipBasic(12);
  if (!g.ok) return g;
  const a = _equipActor(12);
  if (!a.ok) return a;
  const actor = a.seat;
  const p = S.players[actor];
  const share = (p.shares || [])[shareIdx];
  if (!share) return { ok: false, msg: '无效的手牌' };
  const i1 = share.findIndex(c => c.id === cardId1);
  const i2 = share.findIndex(c => c.id === cardId2);
  if (i1 < 0 || i2 < 0 || Math.abs(i1 - i2) !== 1) return { ok: false, msg: '须为同一份内相邻的 2 张牌' };
  const c1 = share[Math.min(i1, i2)];
  const c2 = share[Math.max(i1, i2)];
  if (c1.eqp || c2.eqp) return { ok: false, msg: '该牌已有【＝】标签' };
  if (c1.revealed && c2.revealed) return { ok: false, msg: '至少需含 1 张未公开导线' };

  let desc;
  if (c1.kind === 'blue' && c2.kind === 'blue') {
    if (c1.num !== c2.num) return { ok: false, msg: '蓝+蓝须为同一数字' };
    desc = `两张均为蓝色 ${c1.num}`;
  } else if (c1.kind === 'yellow' && c2.kind === 'yellow') {
    desc = '两张均为黄色';
  } else if (c1.kind === 'red' && c2.kind === 'red') {
    desc = '两张均为红色';
  } else {
    return { ok: false, msg: '须为同色导线（蓝蓝同数字 / 黄黄 / 红红）' };
  }

  const pairId = 'eq' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
  c1.eqp = pairId;
  c2.eqp = pairId;
  g.eq.used = true;
  _releaseEquipLock();
  addLog(`＝ ${p.name} 标记了两张相邻导线【＝】${desc ? `（${desc}）` : ''}`, 'good');
  saveStateDirect();
  _render();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//  结算：拆除 / 胜利 / 爆炸 / 回合流转
// ════════════════════════════════════════════════════════════════

/** 蓝线公开后调用：4/4 时标记板盖「已拆除」，并检查道具解锁条件 */
function _updateDefused(num) {
  if (blueRevealedCount(num) >= 4 && !S.board.defused[num - 1]) {
    S.board.defused[num - 1] = true;
    addLog(`✅ 蓝色 ${num} 全部拆除！`, 'good');
  }
  _checkEquipUnlocks();
}

/** 道具解锁：对应编号蓝线公开 ≥2；#12 还需锁数字公开 ≥2。每次蓝线公开后都要尝试（原数字可能早已达标） */
function _checkEquipUnlocks() {
  if (!S || !S.equipment) return;
  for (const eq of S.equipment) {
    if (eq.unlocked) continue;
    if (blueRevealedCount(eq.no) < 2) continue;
    if (typeof eq.lockNum === 'number' && blueRevealedCount(eq.lockNum) < 2) continue;
    eq.unlocked = true;
    const lockNote = (typeof eq.lockNum === 'number') ? `（锁数字 ${eq.lockNum} 已公开 ≥2）` : '';
    addLog(`🔧 道具解锁：【${(EQUIPMENT_LIB[eq.no] || {}).name || eq.no}】${lockNote}`, 'good');
  }
}

/** 全场导线全部公开 → 胜利（任何公开行为后调用） */
function _checkVictory() {
  if (S.phase !== 'play') return false;
  if (_allRevealed()) {
    _finish(true, null);
    return true;
  }
  return false;
}

function _boom(reason) {
  _finish(false, reason);
}

function _finish(win, reason) {
  if (S.phase === 'over') return;
  S.phase = 'over';
  S.pending = null;
  S.fx = null;                         // 终止进行中的气泡宣告（其延时回调会因 fx 不匹配而放弃结算）
  S.scanMode = null;
  _releaseEquipLock();
  S.cutMods = { stabilize: null };
  S.radar = null;
  S.walkieInfo = null;
  S.result = win ? { win: true } : { win: false, reason: reason || 'boom-failures' };
  updateLocalProgress(win);
  if (win) {
    addLog('🎉 全场导线全部公开——拆弹成功！', 'good');
  } else if (reason === 'boom-red') {
    addLog('💥 指向了红色导线——炸弹起爆！', 'bad');
  } else if (reason === 'boom-order') {
    addLog('💥 未按剪线顺序公开蓝色导线——炸弹起爆！', 'bad');
  } else if (reason === 'boom-timeout') {
    addLog('⏳ 倒计时结束，仍有导线未公开——炸弹起爆！', 'bad');
  } else {
    addLog('💥 失误达到上限——炸弹起爆！', 'bad');
  }
  saveStateDirect();                    // 终局一次送达（含被动方结算的场合）
  _render();
}

/** 回合收尾：稳定剂未消耗则退还（记日志），清空雷达/对讲机的瞬态结果
 *  自由剪线：其他玩家剪线不清除，稳定剂保留到自己下一次剪线 */
function _clearTurnEffects(actorSeat) {
  const stab = (S.cutMods && S.cutMods.stabilize !== null && S.cutMods.stabilize !== undefined)
    ? S.cutMods.stabilize : null;
  const keepStab = S.freeCut && stab !== null && typeof actorSeat === 'number' && actorSeat !== stab;
  if (stab !== null && !keepStab) {
    addLog(`↩️ ${S.players[stab].name} 的稳定剂未触发，已退还（未消耗）`, 'warn');
    S.cutMods = { stabilize: null };
  }
  if (!S.cutMods) S.cutMods = { stabilize: null };
  S.radar = null;
  S.walkieInfo = null;
}

/** 自由剪线开局/回到等待态：-2 = 没有锁定的行动者 */
function _startPlaySeat() {
  return S.freeCut ? -2 : S.captainSeat;
}

/** 行动结算完成 → 回合立即结束（手牌已全部公开的玩家无牌可动，自动跳过）
 *  #10 自由剪线：记录上一位剪线者后回到无人锁定态；>2 人时其不能连续剪线 */
function endTurn(actorSeat) {
  if (S.phase !== 'play') return;
  S.pending = null;
  S.scanMode = null;
  _releaseEquipLock();
  _clearTurnEffects(actorSeat);
  if (S.freeCut) {
    const actor = (typeof actorSeat === 'number' && actorSeat >= 0)
      ? actorSeat
      : (S.currentSeat >= 0 ? S.currentSeat : null);
    if (actor !== null) S.lastCutterSeat = actor;
    S.currentSeat = -2;
    saveState();
    _render();
    return;
  }
  let next = S.currentSeat;
  for (let i = 0; i < S.pCount; i++) {
    next = (next + 1) % S.pCount;
    if (hiddenCards(next).length > 0) break;
    addLog(`⏭️ ${S.players[next].name} 的手牌已全部公开，自动跳过其回合`, 'warn');
  }
  S.currentSeat = next;
  saveState();
  _render();
}

// ════════════════════════════════════════════════════════════════
//  本地进度（按关卡记录；供等候室展示 / 退出时重置未通关记录）
// ════════════════════════════════════════════════════════════════

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { return {}; }
}

function _activeMissionId() {
  return (S && MISSIONS[S.missionId]) ? S.missionId : currentMissionId();
}

function updateLocalProgress(win) {
  const prog = loadProgress();
  prog[_activeMissionId()] = { passed: !!win, ts: Date.now() };
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog)); } catch (e) {}
}

/** 联机层退出房间前调用：重置本关未通关的进度（已通关保留，防刷） */
window._olResetProgress = function () {
  if (!S || (S.phase !== 'mark' && S.phase !== 'play')) return;
  const id = _activeMissionId();
  const prog = loadProgress();
  if (prog[id] && !prog[id].passed) {
    delete prog[id];
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog)); } catch (e) {}
  }
};

// ════════════════════════════════════════════════════════════════
//  联机状态应用
// ════════════════════════════════════════════════════════════════

/** 当前行动者端已处理到的道具锁版本（所有锁相关快照共用一个单调水位） */
let _seenEquipRev = 0;

/**
 * 当前行动者端对道具锁的定向处理（online.js 在“我是行动者”早退前调用）：
 *  - 他人上锁：只合并锁字段，避免整包远端状态覆盖本端尚未推送的行动；
 *  - 释放锁：equipRev 更新后返回 'apply'，整包应用道具结果；
 *  - 错过了整个锁（离线/后台）：释放快照的 equipRev 同样会触发整包应用。
 * 返回 'merge'（已合并）/ 'apply'（交由联机层应用整包）/ null（无需处理）。
 */
window._olEquipLockTransition = function (remoteState) {
  if (!S || !remoteState || S.phase !== 'play') return null;
  if (remoteState.dealStamp && S.dealStamp && remoteState.dealStamp !== S.dealStamp) return null;
  const local = S.equipLock || null;
  const remote = remoteState.equipLock || null;
  const remoteRev = remoteState.equipRev || 0;
  if (local && _equipLockOwnedBy(mySeat(), local)) return null;   // 自己持有的锁以本地为准

  if (remote) {
    if (remoteRev <= _seenEquipRev) return null;                  // 已处理过的旧锁/迟到重放
    const same = local && local.seat === remote.seat && local.no === remote.no
      && local.token === remote.token;
    if (same) return null;
    _seenEquipRev = remoteRev;
    // at 用本机时间重建：跨端时钟偏差不影响本地 TTL
    S.equipLock = { seat: remote.seat, no: remote.no, at: Date.now(), token: remote.token };
    if (typeof window._olCancelLocalFlow === 'function') window._olCancelLocalFlow();
    _render();
    return 'merge';
  }

  if (local) {
    _seenEquipRev = Math.max(_seenEquipRev, remoteRev);
    return 'apply';                                               // 释放：整包应用道具结果
  }
  if (remoteRev > _seenEquipRev) {
    _seenEquipRev = remoteRev;
    return 'apply';                                               // 本端错过了上锁过程，仍需补上结果
  }
  return null;
};

/**
 * 应用远端快照。
 * 标记阶段各端只写自己的标记位：若本端已完成标记而快照中尚无（并发推送互相覆盖），
 * 合并保留本端标记并补推，直至收敛；全员就绪时由任一端推进 phase='play'。
 */
function applyOnlineState(state) {
  const prev = S;
  let repush = false;

  if (prev && state && prev.dealStamp && state.dealStamp
      && prev.dealStamp !== state.dealStamp) {
    _seenEquipRev = 0;               // 新一局：道具锁版本重新计数
  }
  // 迟到重放的旧锁快照：版本低于本地已应用的版本时不得重新上锁
  if (prev && state && state.equipLock
      && (state.equipRev || 0) < (prev.equipRev || 0)) {
    state.equipLock = null;
  }
  // 锁 TTL 按本机首次收到该锁的时间起算，避免跨端时钟偏差导致提前失效或无限等待
  if (state && state.equipLock) {
    const pl = prev && prev.equipLock;
    const sameToken = pl && pl.token && state.equipLock.token && pl.token === state.equipLock.token;
    state.equipLock = Object.assign({}, state.equipLock, { at: sameToken ? pl.at : Date.now() });
  }

  if (state && state.phase === 'mark' && prev && prev.phase === 'mark'
      && Array.isArray(state.players) && Array.isArray(prev.players)) {
    const seat = mySeat();
    if (seat !== null && prev.markAt && prev.markAt[seat] && !state.ready[seat]) {
      const rmine = state.players[seat];
      const card = rmine && (rmine.shares || []).flat().find(c => c.id === prev.markAt[seat]);
      if (card && card.kind === 'blue' && !card.revealed) {
        card.info = { num: card.num };
        state.ready[seat] = true;
        state.markAt = state.markAt || {};
        state.markAt[seat] = card.id;
        repush = true;
      }
    }
    if (state.phase === 'mark' && (state.ready || []).every(Boolean)) {
      state.phase = 'play';
      state.currentSeat = state.freeCut ? -2 : state.captainSeat;
      state.log.push({ t: Date.now(), msg: '✅ 全员信息标记完成，开始拆弹！', cls: 'good' });
      repush = true;
    }
  }

  if (state && state.phase === 'over' && state.result && (!prev || prev.phase !== 'over')) {
    updateLocalProgress(state.result.win);
  }

  S = state;
  _seenEquipRev = Math.max(_seenEquipRev, (state && state.equipRev) || 0);
  _render();
  if (window._fxReplay) window._fxReplay(state ? (state.fx || null) : null);
  if (repush) saveStateDirect();
}

function getOnlineState() {
  // 联机模板读取 state.currentPlayer，本游戏用 currentSeat，推送时镜像一份
  if (typeof S.currentSeat === 'number') S.currentPlayer = S.currentSeat;
  return S;
}

// ════════════════════════════════════════════════════════════════
//  等候室（关卡卡片 + 房主切换抽屉；点选后上报房间状态）
// ════════════════════════════════════════════════════════════════

/** '#5 实地练习第二天' → { code:'#5', name:'实地练习第二天' } */
function _missionMeta(mission) {
  const m = /^(#\d+)\s*(.*)$/.exec(mission.name);
  return m ? { code: m[1], name: m[2] } : { code: '', name: mission.name };
}

/** 当前关卡按人数展开的开局文字 */
function _missionTexts(mission) {
  const std = missionWiresText(missionSetup(mission, 5));
  const two = missionWiresText(missionSetup(mission, 2));
  return { std, two };
}

/** 房主：展开关卡列表抽屉 */
function openMissionSheet() {
  if (!isHost()) { showToast('只有房主可以切换关卡'); return; }
  const content = document.getElementById('sheetContent');
  const ov = document.getElementById('sheetOverlay');
  if (!content || !ov) return;
  const current = currentMissionId();
  const prog = loadProgress();
  const items = Object.keys(MISSIONS).map(key => {
    const m = MISSIONS[key];
    const meta = _missionMeta(m);
    const { std, two } = _missionTexts(m);
    const selected = m.id === current;
    const passed = !!(prog[m.id] && prog[m.id].passed);
    const extras = [];
    if (m.orderCount) extras.push(`⏱ ${m.orderCount} 个蓝线数字顺序剪线`);
    if (m.freeCut) extras.push(`⌛ ${Math.round((m.timerSec || 0) / 60)} 分钟倒计时（2 人 ${Math.round((m.timerSecTwo || m.timerSec || 0) / 60)} 分钟）+ 自由剪线`);
    if (m.redBlueCount) extras.push(`🎲 ${m.redBlueCount} 个数字的蓝线视为红线`);
    if (m.equipLocks) extras.push('🔒 道具额外上锁');
    return `<button type="button" class="mission-item${selected ? ' selected' : ''}"
        data-mission-id="${m.id}" data-testid="mission-item-${m.id}"
        onclick="selectMission(${m.id})">
      <span class="mi-top">
        <span class="mi-code">${meta.code}</span>
        <span class="mi-name">${meta.name}</span>
        ${selected ? '<span class="mi-tag current">当前</span>' : ''}
        ${passed ? '<span class="mi-tag passed">已通关</span>' : ''}
      </span>
      <span class="mi-desc">3~5 人：${std}${two !== std ? ` ｜ 2 人：${two}` : ''}${extras.length ? ` ｜ ${extras.join(' ｜ ')}` : ''}</span>
    </button>`;
  }).join('');
  content.innerHTML = `
    <div class="sheet-head"><span>🗂 选择关卡</span><button class="sheet-close" onclick="closeSheet()">✕</button></div>
    <div class="sheet-sub">点选关卡后，同步给房间内成员</div>
    <div class="mission-list">${items}</div>`;
  ov.classList.add('show');
}

/** 房主点选关卡：收起抽屉 → 本地刷新卡片 → 上报房间（其余成员经 Realtime/轮询同步） */
function selectMission(id) {
  if (!MISSIONS[id]) return { ok: false, msg: '无效的关卡' };
  if (!isHost()) return { ok: false, msg: '只有房主可以切换关卡' };
  if (S.phase === 'mark' || S.phase === 'play') return { ok: false, msg: '对局中不能切换关卡' };
  window._olPendingChallenge = { missionId: id };
  if (typeof closeSheet === 'function') closeSheet();
  _refreshWaitingMissionCard();
  if (typeof window._olRefreshWaitingRoom === 'function') window._olRefreshWaitingRoom();
  showToast(`已切换至 ${MISSIONS[id].name}`);
  return { ok: true };
}

/** 点选后立即更新等候室卡片（不等网络往返） */
function _refreshWaitingMissionCard() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const el = document.querySelector('#online .waiting-extras');
  if (el) el.outerHTML = waitingExtrasHTML();
}

function waitingExtrasHTML() {
  const mission = currentMission();
  const prog = loadProgress()[mission.id] || {};
  const { std, two } = _missionTexts(mission);
  return `
    <div class="waiting-extras mission-card">
      <div class="we-head">
        <div class="we-title">💣 ${mission.name}</div>
        ${isHost() ? '<button class="we-switch" type="button" data-testid="mission-switch" onclick="openMissionSheet()">切换</button>' : ''}
      </div>
      <div class="we-line">开局：${std}${two !== std ? `（2 人局：${two}）` : ''} 标记到板上</div>
      ${missionHasHiddenPick(mission) ? '<div class="we-line">数轴标出全部候选；牌库只混入其中随机选中的导线，具体是哪几条保密</div>' : ''}
      ${mission.orderCount ? `<div class="we-line">本关追加：开场公开 ${mission.orderCount} 个蓝线数字的剪线顺序；前一个数字公开 ≥2 根后才能公开下一个，违者立即爆炸</div>` : ''}
      ${mission.freeCut ? `<div class="we-line">本关追加：发牌即开始 ${Math.round((mission.timerSec || 0) / 60)} 分钟倒计时（2 人局 ${Math.round((mission.timerSecTwo || mission.timerSec || 0) / 60)} 分钟），超时失败；自由剪线（须等待上一位完成，3 人及以上不能连续剪线）</div>` : ''}
      ${mission.excludeEquip && mission.excludeEquip.length ? `<div class="we-line">本局不出现的道具：${mission.excludeEquip.map(n => (EQUIPMENT_LIB[n] || {}).name || ('道具 ' + n)).join('、')}</div>` : ''}
      ${mission.redBlueCount ? `<div class="we-line">本关追加：随机 ${mission.redBlueCount} 个数字的蓝导线视为红色导线，只能在手中只剩这些牌时通过「公开红线」公开；对应数字道具不会出现${mission.twoCaptainNoMark ? '；2 人局队长不能进行蓝线信息标记' : ''}</div>` : ''}
      ${mission.equipLocks ? '<div class="we-line">本关追加：每张道具额外 🔒 一个数字，需原数字导线公开 ≥2 且锁数字公开 ≥2 才解锁</div>' : ''}
      <div class="we-line">失误上限：人数 − 1 次（第 N 次失误，N = 人数，即爆炸）</div>
      <div class="we-line">本关进度：${prog.passed ? '已通关 ✓' : '未通关'}</div>
    </div>`;
}
