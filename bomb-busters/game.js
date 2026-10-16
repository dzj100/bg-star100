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

/** 关卡配置（本版固定第一关；后续按任务卡扩展） */
const MISSIONS = {
  1: { id: 1, name: '第一关 · 初见端倪', red: 1, yellow: 2, yellow2p: 4 },
};
const CURRENT_MISSION = 1;

/** 道具注册表（编号 1~12；解锁 = 蓝 N 4/4，编号 N） */
const EQUIPMENT_LIB = {
  1:  { no: 1,  name: '≠标签',    icon: '≠',  desc: '选择自己同一份内相邻的 2 张导线（编号不同、至少含 1 张蓝色，可含已公开牌）标记【≠】，向全场宣告两张编号不同。' },
  2:  { no: 2,  name: '对讲机',   icon: '📻', desc: '与另一名玩家各选 1 张未公开导线交换；被交换牌的标记自动废弃，双方立即重排。' },
  3:  { no: 3,  name: '三重探测器', icon: '🔍', desc: '立即进入剪线环节（本回合行动）：选择另一名玩家同一份内相邻的 3 张未公开导线，猜「其中至少 1 张为蓝色 N」。' },
  4:  { no: 4,  name: '便利贴',   icon: '📝', desc: '再标记自己 1 张未公开且无信息标记的蓝色导线，向全场宣告其数字。' },
  5:  { no: 5,  name: '超级探测器', icon: '🛰️', desc: '立即进入剪线环节（本回合行动）：选择另一名玩家的一整份手牌，猜「其中有蓝色 N」；命中者自选 1 张公开。' },
  6:  { no: 6,  name: '抑制器',   icon: '🧯', desc: '当前失败数 −1，起爆器指针回退一格（失败数为 0 时不可使用）。' },
  7:  { no: 7,  name: '备用电池', icon: '🔋', desc: '指定 1~2 名本局已使用过「双重探测器」的玩家（可含自己），恢复其技能使用次数。' },
  8:  { no: 8,  name: '通用雷达', icon: '📡', desc: '选择 1~12 一个数字：系统自动公布每名玩家每份手牌是否还有未公开的该数字蓝线。' },
  9:  { no: 9,  name: '稳定剂',   icon: '🧪', desc: '进入稳定状态（不锁定行动）：本回合剪线失误不计失败、指向红线不引爆；可取消，剪线结算时消耗。' },
  10: { no: 10, name: 'X/Y射线',  icon: '🩻', desc: '立即进入剪线环节（本回合行动）：指定他人 1 张未公开牌，猜「蓝 A 或蓝 B / 蓝 A 或黄」两个选项之一。' },
  11: { no: 11, name: '咖啡瓶',   icon: '☕', desc: '跳过自己本回合（不执行行动），指定 1 名仍有未公开手牌的其他玩家从其开始继续。' },
  12: { no: 12, name: '＝标签',   icon: '＝', desc: '选择自己同一份内相邻的 2 张牌（蓝蓝同数字 / 黄黄 / 红红，至少 1 张未公开）标记【＝】，宣告两张编号相同。' },
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

function hiddenBlueCards(seat, num) {
  return hiddenCards(seat).filter(c => c.kind === 'blue' && c.num === num);
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

function _canAct() {
  return S.phase === 'play' && !S.pending && !S.result && !S.fx && isActor();
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) {}
}

/**
 * 发牌开局（房主）：随机队长 → 抽红/黄并标记板 → 全牌洗混分份排序
 * → 抽道具 → 进入信息标记阶段。
 * @param {string[]} names 2~5 名玩家昵称（按座位序）
 */
function dealGame(names) {
  const pCount = names.length;
  if (pCount < 2 || pCount > 5) return;

  const mission = MISSIONS[CURRENT_MISSION];
  const yellowCount = pCount === 2 ? mission.yellow2p : mission.yellow;

  // 抽红 / 黄并公开标记
  const redNum = shuffle(RED_NUMS)[0];
  const yellowNums = shuffle(YELLOW_NUMS).slice(0, yellowCount).sort((a, b) => a - b);

  // 构造牌库：48 蓝 + 1 红 + 黄
  let seq = 0;
  const mk = (kind, num) => ({
    id: 'c' + (++seq), kind, num,
    revealed: false, info: null, fail: null, neq: null, eqp: null,
  });
  let deck = [];
  for (const n of BLUE_NUMS) for (let k = 0; k < 4; k++) deck.push(mk('blue', n));
  deck.push(mk('red', redNum));
  for (const n of yellowNums) deck.push(mk('yellow', n));

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

  // 道具：12 张抽 N 张上桌（锁定）
  const eqNos = shuffle(Array.from({ length: 12 }, (_, i) => i + 1)).slice(0, pCount);

  // turnNo 全局单调（联机快照新鲜度依赖）：新一局延续旧局计数，不得归零
  const prevTurnNo = (typeof S === 'object' && S && typeof S.turnNo === 'number') ? S.turnNo : 0;

  S = {
    players,
    phase: 'mark',
    missionId: CURRENT_MISSION,
    dealStamp: Date.now(),           // 每局唯一（结算弹窗按此去重展示）
    captainSeat,
    currentSeat: -1,                 // 标记阶段无行动者
    turnNo: prevTurnNo,
    board: { redNum, yellowNums, defused: Array(12).fill(false) },
    failures: 0,
    pCount,
    equipment: eqNos.sort((a, b) => a - b).map(no => ({ no, unlocked: false, used: false })),
    pending: null,
    scanMode: null,
    cutMods: { stabilize: null },    // 稳定剂准备态（道具 9）
    radar: null,                     // 通用雷达瞬态结果（道具 8）
    result: null,
    fx: null,                        // 猜测气泡宣告（瞬态，结算前各端同步播放）
    ready: Array(pCount).fill(false),
    markAt: {},
    log: [],
    gameOver: false,
  };

  addLog(`🧨 ${mission.name} 开始！${pCount} 人局：1 条红导线 + ${yellowCount} 条黄导线已标记到板上`);
  addLog(`🎖 随机队长：${names[captainSeat]}。请所有人放置信息标记（标记 1 张自己的蓝色导线）`);
  saveStateDirect();
  _render();
}

/** 房主：再来一局（结算后） */
function restartGame() {
  if (S.phase !== 'over') return { ok: false, msg: '当前不在结算阶段' };
  if (!isHost()) return { ok: false, msg: '等待房主开始下一局' };
  dealGame(S.players.map(p => p.name));
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
  const found = _findCardOwner(cardId);
  if (!found) return { ok: false, msg: '无效的牌' };
  const { seat, card } = found;
  if (!canActAs(seat)) return { ok: false, msg: '只能标记自己的导线' };
  if (S.ready[seat]) return { ok: false, msg: '该玩家已完成标记' };
  if (card.kind !== 'blue') return { ok: false, msg: '只能标记蓝色导线' };
  if (card.revealed) return { ok: false, msg: '只能标记未公开的导线' };

  card.info = { num: card.num };
  S.ready[seat] = true;
  S.markAt[seat] = card.id;
  addLog(`📌 ${S.players[seat].name} 放置了信息标记：蓝色 ${card.num}`);

  if (S.ready.every(Boolean)) {
    S.phase = 'play';
    S.currentSeat = S.captainSeat;
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
  const actor = S.currentSeat;
  if (toSeat === actor || !S.players[toSeat]) return { ok: false, msg: '请选择其他玩家' };

  const card = _findCardById(cardId);
  if (!card || !_isInShares(card, S.players[toSeat].shares)) return { ok: false, msg: '无效的目标牌' };
  if (card.revealed) return { ok: false, msg: '只能猜测未公开的牌' };

  let hit;
  let label;
  if (guess && guess.kind === 'blue') {
    if (!(Number.isInteger(guess.num) && guess.num >= 1 && guess.num <= 12)) return { ok: false, msg: '无效的数字' };
    if (hiddenBlueCount(actor, guess.num) === 0) return { ok: false, msg: `你没有未公开的蓝色 ${guess.num}` };
    hit = card.kind === 'blue' && card.num === guess.num;
    label = `蓝色 ${guess.num}`;
  } else {
    if (hiddenYellowCount(actor) === 0) return { ok: false, msg: '你没有未公开的黄导线' };
    hit = card.kind === 'yellow';
    label = '黄色导线';
  }

  const own = _findCardById(ownCardId);
  if (!own || !_isInShares(own, S.players[actor].shares) || own.revealed) return { ok: false, msg: '请选择你的自选导线' };
  const ownMatch = (guess.kind === 'blue')
    ? (own.kind === 'blue' && own.num === guess.num)
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
    card.revealed = true;
    own.revealed = true;
    addLog(`✂️ ${aName} 指出 ${tName} 的导线为${label}，命中！双方各公开 1 张`, 'good');
    _consumeStabilize(false);            // 稳定状态随本次剪线结算消耗（未触发保护）
    if (guess.kind === 'blue') _updateDefused(guess.num);
    if (_checkVictory()) return { ok: true, hit: true };
    endTurn();
  } else {
    const stable = _consumeStabilize(true);
    if (!stable) {
      S.failures++;
      addLog(`❌ ${aName} 猜测 ${tName} 的导线为${label}，错误（失误 ${S.failures}/${S.pCount}）`, 'bad');
      if (S.failures >= S.pCount) { _boom('boom-failures'); return { ok: true, hit: false }; }
      if (card.kind === 'red') { _boom('boom-red'); return { ok: true, hit: false }; }
    }
    if (card.kind !== 'red') {
      card.fail = card.kind === 'blue' ? { type: 'blue', num: card.num } : { type: 'yellow' };
      addLog('🔖 该牌真实身份已被标记公开（牌面仍未公开，可再次猜测）');
    }
    endTurn();
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
  if (S.scanMode) return { ok: false, msg: '已启动探测器，本回合须执行扫描' };
  const actor = S.currentSeat;

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

  cards.forEach(c => { c.revealed = true; });
  if (kind === 'yellow') {
    addLog(`✂️ ${name} 单人剪线：清收全部黄导线 ×${cards.length}`, 'good');
  } else {
    addLog(`✂️ ${name} 单人剪线：公开蓝色 ${num} ×${cards.length}`, 'good');
    _updateDefused(num);
  }

  if (_checkVictory()) return { ok: true };
  endTurn();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//  行动 3：公开红线
// ════════════════════════════════════════════════════════════════

/** 持红者自己仅剩红线未公开时可公开 */
function canRevealRed(seat) {
  if (S.phase !== 'play' || S.pending || S.scanMode || S.result) return false;
  const hidden = hiddenCards(seat);
  return hidden.length === 1 && hidden[0].kind === 'red';
}

function doRevealRed() {
  const plan = _planRevealRed();
  if (!plan.ok) return { ok: false, msg: plan.msg };
  return _applyRevealRed(plan);
}

/** 校验并生成公开红线计划（纯校验，无状态改动）；UI 层可在气泡对话后调用 _applyRevealRed */
function _planRevealRed() {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器，本回合须执行扫描' };
  const actor = S.currentSeat;
  if (!canRevealRed(actor)) return { ok: false, msg: '只有持红者在自己其余牌全部公开时才能公开红线' };
  return { ok: true, actor, card: hiddenCards(actor)[0], count: 1, label: '红色导线' };
}

/** 执行公开红线结算（气泡对话结束后由 UI 层调用） */
function _applyRevealRed(plan) {
  plan.card.revealed = true;
  addLog(`🚨 ${S.players[plan.actor].name} 公开了红色导线！`, 'warn');
  if (_checkVictory()) return { ok: true };
  endTurn();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//  双重探测器（技能）/ 三重探测器（道具 3）
// ════════════════════════════════════════════════════════════════

/** 启动双重探测器：本回合的双人剪线升级为「扫描相邻 2 张」 */
function useSkill() {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  const actor = S.currentSeat;
  const p = S.players[actor];
  if (p.skillUsed) return { ok: false, msg: '本局已使用过双重探测器' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器' };
  p.skillUsed = true;
  S.scanMode = { count: 2, src: 'skill' };
  addLog(`🔎 ${p.name} 启动双重探测器：本回合须扫描相邻 2 张手牌`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 取消已启动的双重探测器（尚未执行扫描 = 未消耗，可反悔） */
function cancelSkill() {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  const p = S.players[S.currentSeat];
  if (!S.scanMode || S.scanMode.src !== 'skill') return { ok: false, msg: '未启动双重探测器' };
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
  const actor = S.currentSeat;
  const count = src === 'skill' ? 2 : 3;

  if (src === 'skill') {
    if (!S.scanMode || S.scanMode.src !== 'skill') return { ok: false, msg: '请先启动双重探测器' };
  } else {
    if (S.scanMode) return { ok: false, msg: '已启动技能扫描，请直接执行扫描' };
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
  if (targetSeat === null) return { ok: false, msg: '须为同一名玩家的同一份内相邻牌' };

  const targetCards = loc.idxs.map(i => S.players[targetSeat].shares[loc.si][i]);
  if (targetCards.some(c => c.revealed)) return { ok: false, msg: '只能扫描未公开的牌' };

  if (!(Number.isInteger(num) && num >= 1 && num <= 12)) return { ok: false, msg: '无效的数字' };
  if (hiddenBlueCount(actor, num) === 0) return { ok: false, msg: `你没有未公开的蓝色 ${num}` };
  const own = _findCardById(ownCardId);
  if (!own || !_isInShares(own, S.players[actor].shares) || own.revealed
      || own.kind !== 'blue' || own.num !== num) {
    return { ok: false, msg: '自选牌须为同数字的未公开蓝导线' };
  }

  const matched = targetCards.filter(c => c.kind === 'blue' && c.num === num);
  return { ok: true, actor, targetSeat, targetCards, count, num, ownCardId, src, eq3, matched, label: `蓝色 ${num}`, hit: matched.length > 0 };
}

/** 执行扫描结算（气泡对话结束后由 UI 层调用） */
function _applyScan(plan) {
  const { actor, targetSeat, targetCards, count, num, ownCardId, src, eq3, matched } = plan;
  if (eq3) eq3.used = true;

  const aName = S.players[actor].name;
  const tName = S.players[targetSeat].name;

  if (matched.length > 0) {
    addLog(`🔎 ${aName} 扫描 ${tName} 的相邻 ${count} 张手牌，命中蓝色 ${num}！`, 'good');
    _consumeStabilize(false);
    S.pending = {
      type: 'scanPick', fromSeat: actor, toSeat: targetSeat,
      cards: matched.map(c => c.id), guessNum: num, ownCardId, src,
    };
    S.currentSeat = targetSeat;         // 临时移交给待选择方（使其推送通过行动者守卫）
    saveStateDirect();
    _render();
    return { ok: true, hit: true };
  }

  const stable = _consumeStabilize(true);
  if (!stable) {
    S.failures++;
    addLog(`❌ ${aName} 扫描 ${count} 张未命中（失误 ${S.failures}/${S.pCount}）`, 'bad');
    if (S.failures >= S.pCount) { _boom('boom-failures'); return { ok: true, hit: false }; }
  }

  const markable = targetCards.filter(c => c.kind !== 'red');
  if (markable.length === 1) {
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
  if (!card || card.revealed || !own || own.revealed) return { ok: false, msg: '状态已变化，请重试' };

  card.revealed = true;
  own.revealed = true;
  addLog(`🔎 ${S.players[pd.toSeat].name} 公开了蓝色 ${card.num}；${S.players[pd.fromSeat].name} 同步公开蓝色 ${own.num}`, 'good');
  S.pending = null;
  S.currentSeat = pd.fromSeat;          // 回合先归还发起者，再走 endTurn 结算流转
  _updateDefused(card.num);
  if (_checkVictory()) return { ok: true };
  // 探测器类（技能/三重/超级）皆为「本回合行动」：结算即结束回合
  endTurn();
  return { ok: true };
}

/** 被扫描玩家选择非红牌放置身份标记（scanMark=双重/三重/超级探测器共用） */
function resolveScanMark(cardId) {
  const pd = S.pending;
  if (!pd || (pd.type !== 'scanMark' && pd.type !== 'superMark')) return { ok: false, msg: '没有待处理的扫描' };
  if (!canActAs(pd.toSeat)) return { ok: false, msg: '等待被扫描玩家选择' };
  if (!pd.cards.includes(cardId)) return { ok: false, msg: '请从可选牌中选择' };
  const card = _findCardById(cardId);
  if (!card || card.kind === 'red') return { ok: false, msg: '必须选择非红色导线' };

  const fromSeat = pd.fromSeat;
  const src = pd.src;
  S.pending = null;
  S.currentSeat = fromSeat;
  _placeScanMark(card, pd.toSeat, fromSeat, src);
  return { ok: true };
}

function _placeScanMark(card, targetSeat, fromSeat, src) {
  card.fail = card.kind === 'blue' ? { type: 'blue', num: card.num } : { type: 'yellow' };
  addLog(`🔖 ${S.players[targetSeat].name} 放置身份标记：${card.fail.type === 'blue' ? '蓝色 ' + card.fail.num : '黄色'}（真实身份公开，红线避开）`);
  // 探测器类皆为「本回合行动」：标记落定即结束回合
  endTurn();
}

// ════════════════════════════════════════════════════════════════
//  道具 1【≠标签】/ 道具 2【对讲机】
// ════════════════════════════════════════════════════════════════

/** 【≠标签】：同一份内相邻 2 张（编号不同、至少 1 张蓝色，可含已公开牌） */
function useNeqTag(shareIdx, cardId1, cardId2) {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  const actor = S.currentSeat;
  const eq = S.equipment.find(e => e.no === 1);
  if (!eq || !eq.unlocked || eq.used) return { ok: false, msg: '【≠标签】不可用' };

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
  addLog(`≠ ${p.name} 标记了两张相邻导线【≠】：编号不同`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 【对讲机】：我选 1 张未公开牌，指定他人；对方选出后交换 */
function useWalkie(fromCardId, toSeat) {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  const actor = S.currentSeat;
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

  // 被交换牌的标记自动废弃（信息/失败/≠ 均不随牌移动）
  _voidCardMarkers(fromCard);
  _voidCardMarkers(toCard);
  _validateNeqPairs();

  S.pending = null;
  S.currentSeat = pd.fromSeat;          // 回合归还发起者（道具不占行动，继续本回合）
  addLog(`📻 ${a.name} 与 ${b.name} 交换了一张导线（挑出与落点位置可见，牌面保持隐藏）`, 'warn');
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
//  道具 4~12（解锁 = 蓝 N 4/4；使用时机 = 自己回合行动结算前）
// ════════════════════════════════════════════════════════════════

/** 取道具并做通用可用性校验（未解锁 / 已使用 / 探测器启动中封锁道具） */
function _equipUsable(no) {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  if (S.scanMode) return { ok: false, msg: '已启动探测器，本回合须执行扫描' };
  const eq = S.equipment.find(e => e.no === no);
  if (!eq || !eq.unlocked || eq.used) {
    return { ok: false, msg: `【${(EQUIPMENT_LIB[no] || {}).name || '道具 ' + no}】不可用` };
  }
  return { ok: true, eq };
}

/** 【便利贴】：再标记自己 1 张未公开且无信息标记的蓝线（绑定于牌，交换废弃） */
function useStickyNote(cardId) {
  const g = _equipUsable(4);
  if (!g.ok) return g;
  const actor = S.currentSeat;
  const card = _findCardById(cardId);
  if (!card || !_isInShares(card, S.players[actor].shares)) return { ok: false, msg: '请选择自己的导线' };
  if (card.kind !== 'blue') return { ok: false, msg: '只能标记蓝色导线' };
  if (card.revealed) return { ok: false, msg: '只能标记未公开的导线' };
  if (card.info) return { ok: false, msg: '该牌已有信息标记' };

  card.info = { num: card.num };
  g.eq.used = true;
  addLog(`📝 ${S.players[actor].name} 使用便利贴，标记：蓝色 ${card.num}`, 'good');
  saveState();
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
  const actor = S.currentSeat;
  if (toSeat === actor || !S.players[toSeat]) return { ok: false, msg: '请选择其他玩家' };
  const share = (S.players[toSeat].shares || [])[shareIdx];
  if (!share) return { ok: false, msg: '无效的份' };
  const hidden = share.filter(c => !c.revealed);
  if (hidden.length === 0) return { ok: false, msg: '该份手牌已全部公开' };
  if (!(Number.isInteger(num) && num >= 1 && num <= 12)) return { ok: false, msg: '无效的数字' };
  if (hiddenBlueCount(actor, num) === 0) return { ok: false, msg: `你没有未公开的蓝色 ${num}` };
  const own = _findCardById(ownCardId);
  if (!own || !_isInShares(own, S.players[actor].shares) || own.revealed
      || own.kind !== 'blue' || own.num !== num) {
    return { ok: false, msg: '自选牌须为同数字的未公开蓝导线' };
  }
  const matched = hidden.filter(c => c.kind === 'blue' && c.num === num);
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
    addLog(`🛰️ ${aName} 用超级探测器扫描 ${tName} 的整份手牌，命中蓝色 ${num}！`, 'good');
    _consumeStabilize(false);
    S.pending = {
      type: 'superPick', fromSeat: actor, toSeat,
      cards: matched.map(c => c.id), guessNum: num, ownCardId, src: 'eq5',
    };
    S.currentSeat = toSeat;
    saveStateDirect();
    _render();
    return { ok: true, hit: true };
  }

  const stable = _consumeStabilize(true);
  if (!stable) {
    S.failures++;
    addLog(`❌ ${aName} 的超级探测器未命中「有蓝色 ${num}」（失误 ${S.failures}/${S.pCount}）`, 'bad');
    if (S.failures >= S.pCount) { _boom('boom-failures'); return { ok: true, hit: false }; }
  }

  const markable = targetCards.filter(c => c.kind === 'blue');
  if (markable.length === 0) {
    addLog('🔖 该份没有未公开蓝线，跳过身份标记', 'warn');
    endTurn();
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

  S.failures--;
  g.eq.used = true;
  addLog(`🧯 ${S.players[S.currentSeat].name} 使用抑制器：失误 −1（当前 ${S.failures}/${S.pCount}）`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 【备用电池】：指定 1~2 名本局已使用双重探测器的玩家（可含自己），恢复其技能 */
function useBattery(seats) {
  const g = _equipUsable(7);
  if (!g.ok) return g;
  const actor = S.currentSeat;
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

  const actor = S.currentSeat;
  const rows = [];
  for (let s = 0; s < S.pCount; s++) {
    const per = (S.players[s].shares || []).map(sh =>
      sh.some(c => !c.revealed && c.kind === 'blue' && c.num === num));
    rows.push({ seat: s, per });
  }
  S.radar = { num, rows, by: actor };
  g.eq.used = true;
  const desc = rows.map(r =>
    `${S.players[r.seat].name}：${r.per.map(b => b ? '有' : '无').join('、')}`).join('；');
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

  S.cutMods = S.cutMods || { stabilize: null };
  S.cutMods.stabilize = S.currentSeat;
  addLog(`🧪 ${S.players[S.currentSeat].name} 使用稳定剂：本回合剪线失误不计、红线不爆`, 'good');
  saveState();
  _render();
  return { ok: true };
}

/** 取消稳定剂（未消耗，可反悔） */
function cancelStabilizer() {
  if (!_canAct()) return { ok: false, msg: '现在不能行动' };
  if (!S.cutMods || S.cutMods.stabilize === null || S.cutMods.stabilize === undefined) {
    return { ok: false, msg: '未启动稳定剂' };
  }
  S.cutMods.stabilize = null;
  addLog(`↩️ ${S.players[S.currentSeat].name} 取消使用稳定剂`, 'warn');
  saveState();
  _render();
  return { ok: true };
}

/** 消耗稳定剂（剪线结算时调用）；applied=是否实际触发保护（未命中） */
function _consumeStabilize(applied) {
  if (!S.cutMods || S.cutMods.stabilize === null || S.cutMods.stabilize === undefined) return false;
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
  const actor = S.currentSeat;
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
    && (o.kind === 'blue' ? (own.kind === 'blue' && own.num === o.num) : own.kind === 'yellow');
  if (!ownMatches(ownA, na)) return { ok: false, msg: '自选牌 A 与选项不符' };
  if (!ownMatches(ownB, nb)) return { ok: false, msg: '自选牌 B 与选项不符' };
  if (ownA.id === ownB.id) return { ok: false, msg: '两个选项的自选牌不能相同' };

  const hitA = na.kind === 'blue' ? (card.kind === 'blue' && card.num === na.num) : card.kind === 'yellow';
  const hitB = nb.kind === 'blue' ? (card.kind === 'blue' && card.num === nb.num) : card.kind === 'yellow';
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
    card.revealed = true;
    plan.matchedOwn.revealed = true;
    addLog(`✂️ ${aName} 用 X/Y 射线指出 ${tName} 的导线为「${label}」之一，命中！`, 'good');
    _consumeStabilize(false);
    if (plan.matchedOwn.kind === 'blue') _updateDefused(plan.matchedOwn.num);
    if (_checkVictory()) return { ok: true, hit: true };
    endTurn();
  } else {
    const stable = _consumeStabilize(true);
    if (!stable) {
      S.failures++;
      addLog(`❌ ${aName} 的 X/Y 射线猜测「${label}」错误（失误 ${S.failures}/${S.pCount}）`, 'bad');
      if (S.failures >= S.pCount) { _boom('boom-failures'); return { ok: true, hit: false }; }
      if (card.kind === 'red') { _boom('boom-red'); return { ok: true, hit: false }; }
    }
    if (card.kind !== 'red') {
      card.fail = card.kind === 'blue' ? { type: 'blue', num: card.num } : { type: 'yellow' };
      addLog('🔖 该牌真实身份已被标记公开（牌面仍未公开，可再次猜测）');
    }
    endTurn();
  }
  return { ok: true, hit };
}

/** 【咖啡瓶】：跳过自己回合（不行动），从指定玩家（须仍有未公开手牌）继续 */
function useCoffee(targetSeat) {
  const g = _equipUsable(11);
  if (!g.ok) return g;
  const actor = S.currentSeat;
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
  const g = _equipUsable(12);
  if (!g.ok) return g;
  const p = S.players[S.currentSeat];
  const share = (p.shares || [])[shareIdx];
  if (!share) return { ok: false, msg: '无效的份' };
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
  addLog(`＝ ${p.name} 标记了两张相邻导线【＝】：${desc}`, 'good');
  saveState();
  _render();
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//  结算：拆除 / 胜利 / 爆炸 / 回合流转
// ════════════════════════════════════════════════════════════════

/** 某蓝数字全场 4/4 公开 → 标记板盖「已拆除」并解锁对应道具（如有） */
function _updateDefused(num) {
  if (blueRevealedCount(num) >= 4 && !S.board.defused[num - 1]) {
    S.board.defused[num - 1] = true;
    addLog(`✅ 蓝色 ${num} 全部拆除！`, 'good');
    const eq = S.equipment.find(e => e.no === num);
    if (eq && !eq.unlocked) {
      eq.unlocked = true;
      addLog(`🎁 道具解锁：【${(EQUIPMENT_LIB[num] || {}).name || num}】`, 'good');
    }
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
  S.scanMode = null;
  S.cutMods = { stabilize: null };
  S.radar = null;
  S.result = win ? { win: true } : { win: false, reason: reason || 'boom-failures' };
  updateLocalProgress(win);
  if (win) {
    addLog('🎉 全场导线全部公开——拆弹成功！', 'good');
  } else if (reason === 'boom-red') {
    addLog('💥 指向了红色导线——炸弹起爆！', 'bad');
  } else {
    addLog('💥 失误达到上限——炸弹起爆！', 'bad');
  }
  saveStateDirect();                    // 终局一次送达（含被动方结算的场合）
  _render();
}

/** 回合收尾：稳定剂未消耗则退还（记日志），清空雷达瞬态结果 */
function _clearTurnEffects() {
  if (S.cutMods && S.cutMods.stabilize !== null && S.cutMods.stabilize !== undefined) {
    addLog(`↩️ ${S.players[S.cutMods.stabilize].name} 的稳定剂未触发，已退还（未消耗）`, 'warn');
  }
  S.cutMods = { stabilize: null };
  S.radar = null;
}

/** 行动结算完成 → 回合立即结束（手牌已全部公开的玩家无牌可动，自动跳过） */
function endTurn() {
  if (S.phase !== 'play') return;
  S.pending = null;
  S.scanMode = null;
  _clearTurnEffects();
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
//  本地进度（仅第一关；供等候室展示 / 退出时重置未通关记录）
// ════════════════════════════════════════════════════════════════

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { return {}; }
}

function updateLocalProgress(win) {
  const prog = loadProgress();
  prog[CURRENT_MISSION] = { passed: !!win, ts: Date.now() };
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog)); } catch (e) {}
}

/** 联机层退出房间前调用：重置本关未通关的进度（已通关保留，防刷） */
window._olResetProgress = function () {
  if (!S || (S.phase !== 'mark' && S.phase !== 'play')) return;
  const prog = loadProgress();
  if (prog[CURRENT_MISSION] && !prog[CURRENT_MISSION].passed) {
    delete prog[CURRENT_MISSION];
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog)); } catch (e) {}
  }
};

// ════════════════════════════════════════════════════════════════
//  联机状态应用
// ════════════════════════════════════════════════════════════════

/**
 * 应用远端快照。
 * 标记阶段各端只写自己的标记位：若本端已完成标记而快照中尚无（并发推送互相覆盖），
 * 合并保留本端标记并补推，直至收敛；全员就绪时由任一端推进 phase='play'。
 */
function applyOnlineState(state) {
  const prev = S;
  let repush = false;

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
      state.currentSeat = state.captainSeat;
      state.log.push({ t: Date.now(), msg: '✅ 全员信息标记完成，开始拆弹！', cls: 'good' });
      repush = true;
    }
  }

  if (state && state.phase === 'over' && state.result && (!prev || prev.phase !== 'over')) {
    updateLocalProgress(state.result.win);
  }

  S = state;
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
//  等候室（房主选关区展示：本版固定第一关）
// ════════════════════════════════════════════════════════════════

function waitingExtrasHTML() {
  const mission = MISSIONS[CURRENT_MISSION];
  const prog = loadProgress()[CURRENT_MISSION] || {};
  return `
    <div class="waiting-extras">
      <div class="we-title">💣 ${mission.name}</div>
      <div class="we-line">开局：1 条红导线 + 2 条黄导线（2 人局 4 条）标记到板上</div>
      <div class="we-line">失误上限：人数 − 1 次（第 N 次失误，N = 人数，即爆炸）</div>
      <div class="we-line">本关进度：${prog.passed ? '已通关 ✓' : '未通关'}</div>
    </div>`;
}
