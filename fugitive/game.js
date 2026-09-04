/* ================= 常量与工具 ================= */
const STORAGE_KEY = 'fugitive-state';
const A = { key:'A', lo:4, hi:14 };   // 低堆
const B = { key:'B', lo:15, hi:28 };  // 中堆
const C = { key:'C', lo:29, hi:41 };  // 高堆
const PILES = [A,B,C];
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function rng(n){ return Math.floor(Math.random()*n); }
function rangeArr(lo,hi){ const a=[]; for(let i=lo;i<=hi;i++) a.push(i); return a; }
// 掩护标记：奇数牌 1 个，偶数牌 2 个；0 与 42 无标记且不可作掩护牌
function marks(n){ if(n===0 || n===42) return 0; return n%2===1 ? 1 : 2; }
function coverMarks(covers){ return (covers||[]).reduce((s,c)=>s+marks(c),0); }
// HTML 转义：昵称等用户输入进入内联 HTML 前必须转义
function esc(s){ const d = document.createElement('div'); d.textContent = (s==null?'':String(s)); return d.innerHTML; }

let state = null;
let ui = { selMain:null, selCover:[], gridSel:[], aiBusy:false, lock:false, deal:null };
let gridMode = 'guess'; // 'guess' | 'mark'
let aiGen = 0; // 每次新游戏/重新调度递增，令旧的 AI 定时器作废
let aiMarMissed = []; // AI 警探猜过未中的数字（内部记忆，避免反复猜同一数字；对玩家 UI 不置灰）
let revealBusy = false;   // 联机翻牌补播动画进行中：到达的快照延后重绘，防打断动画
let revealQueued = false; // 动画期间到达过快照：动画结束后补一次最新渲染

/* ================= 联机模式（index_ol.html）================= */
// ONLINE_MODE 页 = 联机对战页（online.js 全权接管流程）；OL 记录本座位信息，由 online.js 维护、game.js 读取。
// 用页面标记而非 URL 判断：Cloudflare Pages 会把 index_ol.html 301 到无后缀 index_ol，路径检测会失效。
const ONLINE_MODE = typeof window !== 'undefined' && !!window.__FUGITIVE_OL__;
const OL = { active:false, isHost:false, mySeat:-1, myRole:null, oppName:'', oppSeat:-1, seats:[] };

/* ================= 新游戏 ================= */
function newGame(humanRole){
  aiGen++;
  aiMarMissed = [];
  const pileA = shuffle(rangeArr(A.lo,A.hi));
  const pileB = shuffle(rangeArr(B.lo,B.hi));
  const pileC = shuffle(rangeArr(C.lo,C.hi));
  const a3 = [pileA.pop(), pileA.pop(), pileA.pop()];
  const b2 = [pileB.pop(), pileB.pop()];
  resetUI();
  // const finalHand = shuffle([1,2,3,42, ...a3, ...b2]);
  const finalHand = [1,2,3,42, ...a3, ...b2];
  state = {
    v:2,
    phase:'playing', humanRole,
    piles:{ A:pileA, B:pileB, C:pileC },
    fug:{ hand:finalHand, route:[] },
    mar:{ hand:[], firstDraw:true, drawCount:0, marks:{} },
    marMissed:[],
    turn:'fugitive', firstTurn:true, needDraw:false,
    log:[], turns:1,
    winner:null,
  };
  log(ONLINE_MODE ? '对局开始' : '游戏开始：你扮演' + (humanRole==='fugitive'?'大盗':'警探'));
  log('大盗暗置起点 0，藏匿于城中');
  console.log('[setup] fug.hand =', finalHand.join(','), '| piles:', state.piles.A.length+'/'+state.piles.B.length+'/'+state.piles.C.length);
  save();
  render();
  scheduleAI();
}
function resetUI(){ ui = { selMain:null, selCover:[], gridSel:[], aiBusy:false, lock:false }; }

/* ================= 日志 ================= */
function log(msg, cls){ state.log.push({t:Date.now(), msg, cls}); if(state.log.length>80) state.log.splice(0,state.log.length-80); }

/* ================= 气泡与动画 ================= */
function wait(ms){ return new Promise(res => setTimeout(res, ms)); }
function gameAlive(gen){ return gen !== undefined ? gen === aiGen : true; }
function stale(gen){ return !gameAlive(gen); }
function bubbleLayer(){ return document.getElementById('bubble-layer'); }
function addBubble(role, text){
  const layer = bubbleLayer();
  if(!layer) return;
  const el = document.createElement('div');
  // 气泡左右位置以玩家视角：本人右侧、对方左侧（与扮演角色解耦）
  const mine = role === (state.humanRole==='fugitive' ? 'fug' : 'mar');
  el.className = 'bubble bubble-' + role + (mine ? ' mine' : ' theirs');
  el.textContent = text;
  layer.appendChild(el);
}
async function hideBubbles(){
  await wait(60);
  const layer = bubbleLayer();
  if(layer) layer.innerHTML = '';
}
let toastTimer = null;
function toast(msg){
  let el = document.getElementById('toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}
/* ===== 搜捕开场「缉凶时刻」戏剧提示：全屏展示约 2.6s 后淡出并自动移除 ===== */
const MANHUNT_DRAMA_MS = 2600;
function prefersReducedMotion(){
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch(e){ return false; }
}
async function showManhuntDrama(){
  const calm = prefersReducedMotion();
  const node = document.createElement('div');
  node.id = 'manhunt-drama';
  if(calm) node.classList.add('calm');
  node.setAttribute('role', 'alert');
  node.innerHTML =
    '<div class="d-flash d-f1"></div><div class="d-flash d-f2"></div><div class="d-heart"></div>' +
    '<div class="d-shake"><div class="d-pop"><div class="d-inner">' +
      '<div class="d-kicker">缉凶时刻 MANHUNT</div>' +
      '<div class="d-42wrap"><div class="d-42">42</div><div class="d-stamp">搜捕开始</div></div>' +
      '<div class="d-sub">警探必须从小到大依次单猜所有暗牌</div>' +
      '<div class="d-chips"><span class="d-chip d-chip-fail">猜错则大盗逃脱</span><span class="d-chip d-chip-win">全对则警探获胜</span></div>' +
    '</div></div></div>';
  document.body.appendChild(node);
  node.getBoundingClientRect(); // 强制 reflow，随后入场动画才会播放
  node.classList.add('on');
  if(!calm && navigator.vibrate){ try { navigator.vibrate([60,40,90]); } catch(e){} }
  await wait(calm ? 1700 : MANHUNT_DRAMA_MS);
  node.classList.remove('on'); // 淡出；同时立刻放行点击（pointer-events 关闭）
  await wait(320);
  if(node.parentNode) node.remove();
}
/* ===== 警探摸牌展示：在所点牌堆按钮下方弹出摸到的牌（数字可见，驻留 0.5s 后淡出移除） ===== */
function showDrawPop(card, rect){
  if(prefersReducedMotion()) return; // 弱动效：网格标蓝即是反馈，跳过弹出
  const old = document.getElementById('draw-pop');
  if(old) old.remove(); // 连摸两牌时直接替换
  const node = document.createElement('div');
  node.id = 'draw-pop';
  node.setAttribute('role', 'status');
  node.innerHTML =
    '<div class="dp-anchor"><div class="dp-inner">' +
      // '<div class="dp-tag">摸 到</div>' +
      '<div class="dp-card"><b></b></div>' +
    '</div></div>';
  node.querySelector('.dp-card b').textContent = card;
  document.body.appendChild(node);
  const anchor = node.querySelector('.dp-anchor');
  const inner = node.querySelector('.dp-inner');
  // 锚定到所点牌堆按钮：水平贴按钮中线，垂直落在按钮正下方（标签贴缝，卡片尽量上提）
  const cx = rect ? rect.left + rect.width / 2 : innerWidth / 2;
  const top = rect ? rect.bottom + 2 : (innerHeight - inner.offsetHeight) / 2;
  anchor.style.left = cx + 'px';
  anchor.style.top = top + 'px';
  node.getBoundingClientRect(); // 强制 reflow，随后入场动画才会播放
  node.classList.add('on');
  setTimeout(() => {
    node.classList.remove('on');
    setTimeout(() => { if(node.parentNode) node.remove(); }, 200);
  }, 500);
}
async function flipOut(target){
  target.classList.add('flip-out');
  await wait(300);
}
async function flipIn(target){
  target.classList.remove('flip-out');
  target.classList.add('flip-in');
  await wait(320);
  target.classList.remove('flip-in');
}
// 警探猜测的完整动画流程：警探气泡 → 600ms 后大盗回应气泡（叠加）→ 翻面
async function guessBubbles(nums, allHit, gen){
  ui.lock = true;
  ui.aiBusy = true;
  ui.lockGen = gen;
  render();
  addBubble('mar', '我猜地点有 ' + nums.join('、'));
  await wait(600);
  if(stale(gen)) return;
  addBubble('fug', allHit ? '你猜对了！' : '你猜错了');
  await wait(1400);
  if(stale(gen)) return;
  await hideBubbles();
}
// 联机：大盗端收到警探猜测宣言后，本地同步重放气泡（纯展示，不改状态、不推送）
async function replayGuessFx(fx){
  // 猜测必然发生在警探回合；若结算已先到（turn 已离开 marshal），气泡节拍已过，跳过
  if(!state || state.turn !== 'marshal' ||
     (state.phase !== 'playing' && state.phase !== 'manhunt')) return;
  ui.lock = true;
  ui.aiBusy = true;
  render();
  addBubble('mar', '我猜地点有 ' + (fx.nums || []).join('、'));
  await wait(600);
  addBubble('fug', fx.allHit ? '你猜对了！' : '你猜错了');
  await wait(1400);
  await hideBubbles();
  // 命中：同一节拍补播「翻开地点牌」动画，与警探端本地编排保持一致
  if(fx.allHit) await replayRevealFx(fx.nums || []);
  // 不主动解锁：随后到达的结算推送会 resetUI；若对方迟迟未推（异常），轮到自己回合时仍能操作
}

// 联机翻牌补播：把仍为暗置的命中牌先 flipOut（背面转出），再翻明渲染 + flipIn。
// 编排期间到达的结算/移交快照被 revealBusy 门控延后重绘，避免渲染重建打断动画；
// 快照本身照常更新 state，故动画结束时统一渲染即为最新状态。
async function replayRevealFx(nums){
  const targets = [];
  for(const n of nums){
    const idx = state.fug.route.findIndex(r => r.num === n && r.hidden);
    if(idx < 0) return; // 结算已先行翻明（极端时序）：无需补播
    const el = document.querySelector('#track .t-card[data-i="' + idx + '"]');
    if(el) targets.push({ idx, el });
  }
  if(!targets.length) return;
  revealBusy = true;
  try {
    await Promise.all(targets.map(t => flipOut(t.el)));
    targets.forEach(t => { const r = state.fug.route[t.idx]; if(r) r.hidden = false; });
    render();
    const fresh = targets
      .map(t => document.querySelector('#track .t-card[data-i="' + t.idx + '"]'))
      .filter(Boolean);
    if(fresh.length) await Promise.all(fresh.map(el => flipIn(el)));
  } finally {
    revealBusy = false;
    if(revealQueued){ revealQueued = false; render(); }
  }
}

/* ================= 抽牌 ================= */
function drawFrom(pileKey, who){
  const pile = state.piles[pileKey];
  if(!pile || !pile.length) return null;
  const card = pile.pop();
  if(who==='fugitive'){
    state.fug.hand.push(card);
    log('大盗从 ' + pileKey + ' 堆摸 1 张', 'lg-fug');
    console.log('[fug] draw', card, 'from', pileKey);
  }
  else {
    state.mar.hand.push(card);
    state.mar.drawCount = (state.mar.drawCount||0) + 1;
    if(state.mar.firstDraw && state.mar.drawCount < 2){
      state.needDraw = anyPileLeft(); // 首回合第二张：牌库已空则不再要求摸牌
    } else {
      state.mar.firstDraw = false;
      state.needDraw = false;
    }
    log('警探从 ' + pileKey + ' 堆摸 1 张', 'lg-mar');
    console.log('[mar] draw', card, 'from', pileKey, '→ hand:', state.mar.hand.join(','));
  }
  save();
  return card;
}
function pileCount(pileKey){ return state.piles[pileKey].length; }
function anyPileLeft(){ return PILES.some(p => state.piles[p.key].length > 0); }

/* ================= 大盗：放置与掩护 ================= */
function lastRouteNum(){
  if(!state.fug.route.length) return 0;
  return state.fug.route[state.fug.route.length-1].num;
}
// 放置地点牌（covers 为掩护牌）。返回 {ok, reason}
function fugPlace(mainCard, coverCards){
  if(state.phase!=='playing' || state.turn!=='fugitive') return { ok:false, reason:'不在你的回合' };
  const last = lastRouteNum();
  const diff = mainCard - last;
  if(diff < 1) return { ok:false, reason:'地点牌必须比上一张更大' };
  const covers = coverCards || [];
  const maxAllowed = last + 3 + coverMarks(covers);
  if(mainCard > maxAllowed) return { ok:false, reason:'超出上限 ' + maxAllowed + '（需要更多掩护标记）' };
  if(covers.some(c => c===42)) return { ok:false, reason:'42 不能作为掩护牌' };
  state.fug.hand = state.fug.hand.filter(c => c!==mainCard);
  covers.forEach(c => { state.fug.hand = state.fug.hand.filter(x => x!==c); });
  const item = { num:mainCard, hidden:mainCard!==42, cover:covers };
  state.fug.route.push(item);
  if(mainCard === 42){
    log('大盗打出 <b>42 号</b>，直接面朝上！', 'lg-fug');
    console.log('[fug] ESCAPE 42 with cover', covers.join(','));
    save(); render(); triggerEscape();
    return { ok:true };
  }
  if(diff > 3){
    console.log('[fug] JUMP main=', mainCard, 'cover=', covers.join(','), 'maxAllowed=', maxAllowed);
  } else {
    console.log('[fug] place', mainCard, 'diff=', diff);
  }
  log('大盗暗放地点牌（第 ' + state.fug.route.length + ' 张）' + (covers.length ? ' 掩护' + covers.length + ' 张' : ''), 'lg-fug');
  if(state.firstTurn && state.fug.route.length < 2){
    // 首回合：放 1 张后可继续放第 2 张，或点「结束回合」；清空选择以便选下一张主牌
    resetUI();
  } else {
    endFugTurn();
  }
  save();
  render();
  return { ok:true };
}
function fugEndFirstTurn(){
  if(ui.lock || !state.firstTurn || state.turn!=='fugitive' || state.phase!=='playing') return;
  log('大盗结束首回合（只放了 ' + state.fug.route.length + ' 张）', 'lg-fug');
  endFugTurn();
}
function fugPass(){
  if(ui.lock || state.turn!=='fugitive' || state.phase!=='playing') return;
  log('大盗按兵不动（跳过）', 'lg-fug');
  save(); endFugTurn();
}
function endFugTurn(){
  state.firstTurn = false;
  state.turn = 'marshal';
  state.needDraw = anyPileLeft(); // 牌库全空 → 跳过摸牌阶段，直接可猜
  resetUI();
  save(); render(); scheduleAI();
}

/* ================= 警探：猜测 ================= */
// 已公开数字：所有已翻开的路线卡（主牌 + 掩护牌）
function openNums(){
  const set = new Set();
  state.fug.route.forEach(r => {
    if(!r.hidden){ set.add(r.num); r.cover.forEach(c=>set.add(c)); }
  });
  return set;
}
function marDrawClick(pileKey, btn){
  if(ui.lock || state.turn!=='marshal' || !state.needDraw || state.phase!=='playing') return;
  const rect = btn ? btn.getBoundingClientRect() : null; // 渲染重建前取锚点
  const card = drawFrom(pileKey,'marshal');
  if(!card){
    if(!anyPileLeft()){ state.needDraw = false; save(); render(); }
    return;
  }
  save(); render();
  showDrawPop(card, rect); // 在所点牌堆下方弹出摸到的牌：短暂展示后自动消失
}
async function marGuess(nums, gen){
  if(state.phase!=='playing' || state.turn!=='marshal' || state.needDraw) return;
  if(!nums || !nums.length) return;
  const open = openNums();
  if(nums.some(n => open.has(n))){
    log('已公开的数字不可再猜', 'lg-mar');
    console.log('[mar] guess rejected: public number in', nums.join(','));
    render();
    return;
  }
  const hidden = state.fug.route.filter(r=>r.hidden);
  const hiddenNums = hidden.map(r=>r.num);
  const allHit = nums.every(n => hiddenNums.includes(n));
  // 联机：猜测宣言即上报（带瞬态标记），对方端同步播放气泡，不等本端气泡结束
  if(ONLINE_MODE && typeof onlinePushGuessFx === 'function') onlinePushGuessFx(nums, allHit, false);
  await guessBubbles(nums, allHit, gen);
  if(stale(gen)) return;
  if(allHit){
    const els = [];
    for(const n of nums){
      const idx = state.fug.route.findIndex(r=>r.num===n && r.hidden);
      const el = document.querySelector('#track .t-card[data-i="' + idx + '"]');
      if(el) els.push(el);
    }
    await Promise.all(els.map(el => flipOut(el)));
    if(stale(gen)) return;
    nums.forEach(n => {
      const hit = hidden.find(r=>r.num===n);
      if(hit){ hit.hidden = false; }
    });
    log('警探猜中 <b>' + nums.join(', ') + '</b>，翻开地点牌！', 'lg-hit');
    console.log('[mar] guess', nums.join(','), '→ ALL HIT');
    ui.lock = false; ui.aiBusy = false;
    save(); render();
    const fresh = [];
    for(const n of nums){
      const idx = state.fug.route.findIndex(r=>r.num===n);
      const el = document.querySelector('#track .t-card[data-i="' + idx + '"]');
      if(el) fresh.push(el);
    }
    await Promise.all(fresh.map(el => flipIn(el)));
  } else {
    if(nums.length === 1){
      state.marMissed.push(nums[0]); // 仅统计猜错次数；不影响后续可猜性
      if(state.humanRole === 'fugitive') aiMarMissed.push(nums[0]); // AI 内部排除，避免反复猜同一数字
      console.log('[mar] guess', nums[0], '→ MISS, missed stats:', state.marMissed.join(','));
    } else {
      state.marMissed.push(0); // 多选整组未中：无法归因错误项，0 占位仅计入「猜错次数」
      console.log('[mar] guess', nums.join(','), '→ MISS (multi, unsure which)');
    }
    log('警探猜 <b>' + nums.join(', ') + '</b>：未命中', 'lg-miss');
    ui.lock = false; ui.aiBusy = false;
    save(); render();
  }
  if(stale(gen)) return;
  resetUI();
  render();
  checkMarshalWin();
}
function endMarTurn(){
  state.turn = 'fugitive';
  state.needDraw = anyPileLeft(); // 牌库全空 → 跳过摸牌阶段，直接可出牌
  state.turns++;
  resetUI();
  save(); render(); scheduleAI();
}
function checkMarshalWin(){
  const allRevealed = state.fug.route.every(r=>!r.hidden);
  if(allRevealed){
    endGame('marshal');
    return;
  }
  endMarTurn();
}

/* ================= 逃脱与搜捕 ================= */
async function triggerEscape(){
  // 搜捕判定只看除 42 外已翻开的地点牌（42 刚打出，不能算作"已翻开 ≥30"）
  const maxOpen = Math.max(0, ...state.fug.route.filter(r=>!r.hidden && r.num!==42).map(r=>r.num));
  if(maxOpen >= 30){
    console.log('[escape] maxOpen =', maxOpen, '≥30 → 直接逃脱');
    endGame('fugitive');
    return;
  }
  state.phase = 'manhunt';
  state.turn = 'marshal';
  state.needDraw = false;
  log('搜捕开始！警探依次单猜所有暗置地点牌，猜错即失败', 'lg-mar');
  console.log('[escape] maxOpen =', maxOpen, '<30 → 搜捕');
  save(); render();
  const gen = aiGen;
  await showManhuntDrama(); // 「缉凶时刻」戏剧提示：展示期间全屏锁定，结束自动移除
  if(stale(gen) || state.phase !== 'manhunt') return; // 提示期间退出/重开 → 不再调度 AI
  scheduleAI();
}
async function manhuntGuess(n, gen){
  if(state.phase!=='manhunt' || state.turn!=='marshal') return;
  const hidden = state.fug.route.filter(r=>r.hidden);
  const smallestHidden = Math.min(...hidden.map(r=>r.num));
  // 搜捕必须从小到大依次猜；猜测数字不等于当前最小暗牌 → 跳过/猜错即败
  if(n !== smallestHidden){
    if(ONLINE_MODE && typeof onlinePushGuessFx === 'function') onlinePushGuessFx([n], false, true);
    await guessBubbles([n], false, gen); // 搜捕失败同样先气泡对话
    if(stale(gen)) return;
    log('搜捕：须按顺序猜最小暗牌 <b>' + smallestHidden + '</b>（你猜了 ' + n + '），大盗逃脱！', 'lg-fug');
    console.log('[manhunt] guess', n, '→ ORDER FAIL (smallest hidden is', smallestHidden + ')');
    state.marMissed.push(n); // 搜捕致命猜错同样计入「猜错次数」
    ui.lock = false; ui.aiBusy = false;
    resetUI();
    save(); render();
    endGame('fugitive');
    return;
  }
  // 走到这里必然命中（guaranteed hit）
  const hit = hidden.find(r=>r.num===n);
  if(ONLINE_MODE && typeof onlinePushGuessFx === 'function') onlinePushGuessFx([n], true, true);
  await guessBubbles([n], true, gen);
  if(stale(gen)) return;
  const idx = state.fug.route.findIndex(r=>r.num===n && r.hidden);
  const el = document.querySelector('#track .t-card[data-i="' + idx + '"]');
  if(el) await flipOut(el);
  if(stale(gen)) return;
  hit.hidden = false;
  log('搜捕：猜中 <b>' + n + '</b>，翻开地点牌！', 'lg-hit');
  console.log('[manhunt] guess', n, '→ HIT');
  ui.lock = false; ui.aiBusy = false;
  resetUI();
  save(); render();
  const fresh = document.querySelector('#track .t-card[data-i="' + idx + '"]');
  if(fresh) await flipIn(fresh);
  if(stale(gen)) return;
  if(state.fug.route.every(r=>!r.hidden)){ endGame('marshal'); return; }
  scheduleAI(); // AI 警探继续；玩家警探直接再选
}

/* ================= 结束 ================= */
function endGame(winner){
  state.phase = 'over';
  state.winner = winner;
  log(winner==='fugitive' ? '大盗成功逃脱！' : '警探成功抓捕！', winner==='fugitive'?'lg-fug':'lg-mar');
  console.log('[end] winner =', winner, '| route =', state.fug.route.map(r=>r.num+(r.hidden?'(?)':'')+(r.cover.length?'[掩'+r.cover.join(',')+']':'')).join(' > '));
  save(); render();
}

/* ================= AI 调度 ================= */
function scheduleAI(){
  if(ONLINE_MODE) return; // 联机：无 AI，双方玩家手动行动
  if(state.phase==='over') return;
  const aiRole = state.humanRole==='fugitive' ? 'marshal' : 'fugitive';
  const current = state.turn === 'fugitive' ? 'fugitive' : 'marshal';
  if(current !== aiRole) return;
  if(state.phase==='manhunt' && aiRole!=='marshal') return;
  ui.aiBusy = true;
  const gen = ++aiGen;
  setTimeout(()=>{ aiAct(gen); }, 750);
}
function aiAct(gen){
  if(gen !== aiGen) return; // 过期定时器：已开新局或重新调度
  const aiRole = state.humanRole==='fugitive' ? 'marshal' : 'fugitive';
  if(state.phase==='over'){ ui.aiBusy=false; render(); return; }
  const current = state.turn === 'fugitive' ? 'fugitive' : 'marshal';
  if(current !== aiRole){ ui.aiBusy=false; render(); return; } // 非 AI 回合（如测试 patch 后残留定时器）
  if(state.phase==='manhunt'){
    if(aiRole==='marshal') aiManhunt(gen);
    else { ui.aiBusy=false; render(); }
    return;
  }
  if(aiRole==='fugitive') aiFugitiveTurn(gen);
  else aiMarshalTurn(gen);
}

/* ================= AI 大盗 ================= */
function aiFugitiveTurn(gen){
  if(state.phase!=='playing'){ ui.aiBusy=false; render(); return; }
  // 首回合：放 1~2 张（不抽牌）
  if(state.firstTurn){
    if(state.fug.route.length >= 2){ endFugTurn(); return; }
    const plan = planFugMove();
    if(plan){ fugPlace(plan.main, plan.cover); }
    else { endFugTurn(); } // 理论不会发生（手牌必有 1/2/3）
    if(state.phase==='playing' && state.turn==='fugitive' && state.fug.route.length < 2){
      setTimeout(()=>aiAct(gen), 600);
    }
    return;
  }
  // 后续回合：抽牌
  if(state.needDraw){
    const pileKey = aiFugPickPile();
    const card = drawFrom(pileKey,'fugitive');
    if(!card) log('牌堆已空，大盗无法摸牌', 'lg-fug');
    state.needDraw = false;
    save(); render();
    setTimeout(()=>aiAct(gen), 600);
    return;
  }
  // 行动
  const plan = planFugMove();
  if(plan){ fugPlace(plan.main, plan.cover); }
  else { fugPass(); }
}
function aiFugPickPile(){
  // 权重摸牌：与警探威胁优先对称——摸「推进路线最需要」的堆
  // last+1~last+3 立即可打 3 分；last+4~last+8 需少量掩护 2 分；更远 1 分；≤last 只配当掩护 0 分
  const last = lastRouteNum();
  const score = { A:0, B:0, C:0 };
  for(const k of ['A','B','C']){
    for(const n of state.piles[k]){
      if(n > last + 8) score[k] += 1;
      else if(n > last + 3) score[k] += 2;
      else if(n > last) score[k] += 3;
    }
  }
  let best = null, bestS = -1;
  for(const k of ['C','B','A']){ if(score[k] > bestS){ best = k; bestS = score[k]; } }
  if(best !== null && state.piles[best].length) return best;
  // 兜底：无可推进牌（路线近 42 或堆已空）→ 从大到小摸任意非空堆
  for(const k of ['C','B','A']){ if(state.piles[k].length) return k; }
  return 'A'; // 三堆全空：终局，由 drawFrom 返回 null 兜底
}
// 掩护组合：从手牌（排除主牌与 42）贪心收集最小牌凑足 need 个标记
function pickCovers(hand, main, need){
  const pads = hand.filter(c => c!==main && c!==42).sort((a,b)=>a-b);
  const chosen = [];
  let sum = 0;
  for(const c of pads){
    if(sum >= need) break;
    chosen.push(c);
    sum += marks(c);
  }
  if(sum >= need) return chosen;
  return null;
}
function planFugMove(){
  const last = lastRouteNum();
  const hand = state.fug.hand;
  // 直接胜利：42 在手且能一步打出（裸打或凑掩护），优先于一切推进
  if(hand.includes(42) && 42 - last >= 1){
    const need = 42 - last - 3;
    if(need <= 0) return { main:42, cover:[] };
    const cover = pickCovers(hand, 42, need);
    if(cover) return { main:42, cover };
  }
  // 普通移动：差 1~3
  const moves = hand.filter(v => v-last>=1 && v-last<=3);
  if(moves.length){
    moves.sort((a,b)=>a-b);
    const mid = Math.floor(moves.length/2);
    const pool = moves.length>=3 ? moves.slice(Math.max(0,mid-1), mid+2) : moves;
    const pick = pool[rng(pool.length)];
    return { main:pick, cover:[] };
  }
  // 跳跃：最小可行主牌 + 最小掩护组合
  const candidates = hand.filter(v => v-last>3);
  candidates.sort((a,b)=>a-b);
  for(const v of candidates){
    const need = v - last - 3;
    const cover = pickCovers(hand, v, need);
    if(cover) return { main:v, cover };
  }
  return null;
}

/* ================= AI 警探 ================= */
async function aiMarshalTurn(gen){
  if(state.phase!=='playing'){ ui.aiBusy=false; render(); return; }
  if(state.needDraw){
    const k = aiMarPickPile();
    if(!drawFrom(k,'marshal')){ state.needDraw = false; save(); render(); }
    else save(); render();
    if(state.needDraw){ setTimeout(()=>aiAct(gen), 600); return; } // 首回合抽第二张
    setTimeout(()=>aiAct(gen), 500); // 抽完 → 猜测
    return;
  }
  const guess = aiMarChooseGuess();
  console.log('[mar-ai] choose guess =', guess);
  await marGuess([guess], gen);
}
function aiMarPickPile(){
  // 威胁优先：摸走「大盗推断候选集」最密集的堆（摸走 = 大盗打不出，压缩路线）；平局按 C→B→A
  const score = { A:0, B:0, C:0 };
  for(const c of marshalInference()){
    if(!c) continue;
    for(const n of c){
      const k = n>=4 && n<=14 ? 'A' : (n>=15 && n<=28 ? 'B' : (n>=29 && n<=41 ? 'C' : null));
      if(k && state.piles[k].length) score[k]++;
    }
  }
  let best = null, bestF = -1;
  for(const k of ['C','B','A']){
    if(state.piles[k].length && score[k] > bestF){ best = k; bestF = score[k]; }
  }
  if(best !== null) return best; // 有威胁堆 → 摸它
  for(const k of ['C','B','A']){ if(state.piles[k].length) return k; } // 无威胁（如首张暗牌候选 1~3）：从大到小
  return 'A';
}
// 警探已知排除集：已公开 ∪ 手牌（猜过未中的数字不排除——大盗日后可能打出）
function knownNums(){
  const set = openNums();
  state.mar.hand.forEach(c=>set.add(c));
  return set;
}
// AI 警探排除集：公开 ∪ 手牌 ∪ AI 已猜未中（避免反复猜同一数字）
function aiKnownNums(){
  const set = knownNums();
  aiMarMissed.forEach(n=>set.add(n));
  return set;
}
// 对每个暗置位置枚举候选（严格 +1~+3，忽略掩护放宽——AI 天然弱点）
function marshalInference(){
  const route = state.fug.route;
  const known = aiKnownNums();
  const cands = [];
  let prevSet = new Set([0]); // 起点 0
  let lastPublic = 0;
  for(let i=0;i<route.length;i++){
    if(!route[i].hidden){
      prevSet = new Set([route[i].num]);
      lastPublic = route[i].num;
      cands.push(null);
      continue;
    }
    let cur = new Set();
    for(const p of prevSet){
      for(let d=1;d<=3;d++){
        const x = p+d;
        if(x>=1 && x<=41 && !known.has(x)) cur.add(x);
      }
    }
    if(cur.size === 0){
      // 兜底：约束推导断链时，候选 = 最后公开牌之后的未排除数字（路线严格递增，暗牌必 > 最后公开牌）
      cur = new Set();
      for(let n=lastPublic+1;n<=41;n++){ if(!known.has(n)) cur.add(n); }
    }
    cands.push(cur);
    prevSet = cur;
  }
  return cands;
}
function aiMarChooseGuess(){
  const cands = marshalInference();
  const uniques = [];
  for(const c of cands){
    if(c && c.size===1){ uniques.push([...c][0]); }
  }
  if(uniques.length){
    const pick = rng(100)<15 ? uniques[rng(uniques.length)] : uniques[0];
    return pick;
  }
  const freq = new Map();
  for(const c of cands){
    if(!c) continue;
    for(const n of c){ freq.set(n, (freq.get(n)||0)+1); }
  }
  let best=[], bestF=0;
  for(const [n,f] of freq){
    if(f>bestF){ bestF=f; best=[n]; }
    else if(f===bestF){ best.push(n); }
  }
  if(best.length){
    const pick = rng(100)<15 ? best[rng(best.length)] : best[0];
    return pick;
  }
  const pool = [];
  for(let n=1;n<=41;n++){ if(!aiKnownNums().has(n)) pool.push(n); }
  if(pool.length) return pool[rng(pool.length)];
  // 全部数字都猜过：从已猜未中盲选（仍比固定猜 1 好）
  return aiMarMissed.length ? aiMarMissed[rng(aiMarMissed.length)] : 1;
}
async function aiManhunt(gen){
  if(state.phase!=='manhunt'){ ui.aiBusy=false; render(); return; }
  // 搜捕必须从小到大依次猜：用推断推导第一个暗置位置（= 当前最小暗牌）的候选，猜最可能值
  const cands = marshalInference();
  let guess = 1;
  for(const c of cands){
    if(!c) continue; // 已翻开的（cands 为 null）
    guess = [...c][0]; // Set 升序 → 最小候选；唯一候选即准确推断
    break;
  }
  console.log('[manhunt-ai] guess =', guess, '(inferred smallest hidden)');
  await manhuntGuess(guess, gen);
}

/* ================= 存储 ================= */
function save(){
  if(ONLINE_MODE){
    // 联机：状态实时推送房间，不写单机存档（避免污染人机版进度）
    if(typeof onlinePushState === 'function') onlinePushState();
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function load(){
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(s && s.v===2 && s.phase && s.fug && s.mar){
      if(!s.mar.marks) s.mar.marks = {}; // 旧存档迁移：警探标记网格
      return s;
    }
  } catch(e){}
  return null;
}

/* ================= 渲染 ================= */
// 联机：应用房主广播的房间状态（online.js 收到实时推送时调用）。
// 关键点：每个座位只渲染自己的身份视角 → 覆盖 state.humanRole 为本座位角色。
function applyOnlineState(s){
  if(!s) return;
  const prevPhase = state ? state.phase : null;
  const fx = s._guessFx || null; // 瞬态猜测宣言：本端消费一次即从状态摘除，防再次推送重放
  if(fx) delete s._guessFx;
  state = s;
  if(OL.active && Array.isArray(state.seats)){
    OL.seats = state.seats;
    const me = state.seats.find(x => x.seatIndex === OL.mySeat);
    if(me) OL.myRole = me.role;
    const opp = state.seats.find(x => x.seatIndex !== OL.mySeat);
    OL.oppSeat = opp ? opp.seatIndex : -1;
    OL.oppName = opp ? opp.name : '';
    if(OL.myRole) state.humanRole = OL.myRole; // 对方发来的 humanRole（发送者视角）覆盖为本座位角色
  }
  resetUI();
  aiGen++;
  closeSheet();
  if(revealBusy){
    revealQueued = true; // 翻牌补播动画进行中：快照照常更新 state，重绘延后到动画结束，防打断翻面
  } else {
    render();
  }
  // 对方端补播猜测气泡：警探宣言（猜测事件）→ 大盗侧同步播放
  if(fx && OL.active && OL.myRole === 'fugitive' &&
     (state.phase === 'playing' || state.phase === 'manhunt')){
    replayGuessFx(fx);
  }
  // 对方端补播「缉凶时刻」开场：打出 42 的客户端已本地播放，此处仅在远程进入搜捕时补一次
  if(s.phase === 'manhunt' && prevPhase !== 'manhunt' &&
     OL.active && OL.myRole === 'marshal' && typeof showManhuntDrama === 'function'){
    showManhuntDrama();
  }
}
function render(){
  if(!state){ return; }
  const app = document.getElementById('app');
  if(state.phase==='over'){ app.innerHTML = renderOver(); bindOver(); return; }
  if(state.phase==='manhunt'){ app.innerHTML = renderManhunt(); bindManhunt(); return; }
  app.innerHTML = renderGame();
  bindGame();
}

function roleWho(role){
  const me = state.humanRole === role;
  if(!OL.active) return me ? ' (你)' : ' (AI)';
  if(me) return ' (你)';
  return OL.oppName ? ' ' + esc(OL.oppName) : '';
}
function roleTag(role){
  if(role==='fugitive') return '<span class="role-tag role-fug" onclick="showRoleHand(\'fugitive\')">大盗' + roleWho('fugitive') + '</span>';
  return '<span class="role-tag role-mar" onclick="showRoleHand(\'marshal\')">警探' + roleWho('marshal') + '</span>';
}
function showRoleHand(role){
  const isHuman = state.humanRole === role;
  const name = role==='fugitive' ? '大盗' : '警探';
  const who = OL.active ? (isHuman ? '你' : (OL.oppName || '对方')) : (isHuman ? '你' : 'AI');
  const hand = (role==='fugitive' ? state.fug.hand : state.mar.hand) || [];
  // 自己的角色可见数字；对方手牌一律保密，仅显示张数与牌背
  // 警探自己的手牌按摸牌顺序展示（与摸牌日志对应）；大盗按数字升序便于规划出牌
  const chips = (role==='marshal' && isHuman ? hand.slice() : hand.slice().sort((a,b)=>a-b)).map(n =>
    '<span class="rh-card' + (isHuman?'':' rh-hide') + '">' + (isHuman?n:'?') + '</span>').join('');
  openSheet(name + '（' + who + '）手牌 ' + hand.length + ' 张',
    (chips || '<div class="rh-empty">空手</div>') +
    '<div class="sheet-foot">' + (isHuman ? '牌面数字' : '对方手牌保密，仅显示张数') + '</div>');
}
function turnLabel(){
  if(ui.lock) return '第 ' + state.turns + ' 回合 · 结算中…';
  const cur = state.turn==='fugitive' ? '大盗' : '警探';
  const isHuman = state.humanRole === state.turn;
  if(OL.active){
    return '第 ' + state.turns + ' 回合 · ' + cur + (isHuman ? '（你的回合）' : '（等待 ' + (OL.oppName || '对方') + '…）');
  }
  const busy = ui.aiBusy && !isHuman;
  return '第 ' + state.turns + ' 回合 ' + cur + (busy ? '（AI 思考中…）' : (isHuman ? '（你的回合）' : ''));
}
function trackHTML(showHidden){
  const cards = ['<div class="t-card t-start"><b>0</b><div class="idx">起点</div></div>'];
  state.fug.route.forEach((r,i)=>{
    let body, cls;
    if(r.hidden){
      cls = 't-hidden';
      if(showHidden){
        cls += ' chk';
        body = '<b>' + r.num + '</b>' + (r.cover.length ? '<span class="chk-hint">掩护×' + r.cover.length + '<br>点击检查</span>' : '');
      } else {
        body = '<span class="q">?</span>' + (r.cover.length ? '<span class="cov">掩护×' + r.cover.length + '</span>' : '');
      }
    } else {
      cls = 't-open';
      if(r.cover.length) cls += ' chk';
      body = '<b>' + r.num + '</b>' + (r.cover.length ? '<span class="cov">掩 ' + r.cover.join(',') + '</span>' : '');
    }
    const onClick = r.hidden ? (cls.indexOf('chk')>=0 ? ' onclick="checkFugCard(' + i + ')"' : '') : (cls.indexOf('chk')>=0 ? ' onclick="viewRouteCard(' + i + ')"' : '');
    cards.push('<div class="t-card ' + cls + '" data-i="' + i + '"' + onClick + '><div class="idx">第' + (i+1) + '张</div>' + body + '</div>');
  });
  // return cards.join('<span class="t-arrow">›</span>');
  return cards.join('');
}
function logLineHTML(){
  const last = state.log[state.log.length-1];
  return '<div id="log" onclick="openLogDrawer()"><span class="ld-msg">' +
    (last ? '<span class="' + (last.cls||'') + '">' + last.msg + '</span>' : '暂无操作') +
    '</span><span class="log-more">日志 ›</span></div>';
}
function openLogDrawer(){
  const items = state.log.slice().reverse().map(l =>
    '<div class="ld-item"><span class="ld-time">' + fmtTime(l.t) + '</span><span class="' + (l.cls||'') + '">' + l.msg + '</span></div>').join('');
  openSheet('📅 操作日志', items + '<div class="sheet-foot">共 ' + state.log.length + ' 条</div>');
}
function fmtTime(t){
  if(!t) return '';
  const d = new Date(t);
  const p = x => (x<10?'0':'')+x;
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function openSheet(title, bodyHTML){
  const ov = document.getElementById('sheet');
  if(!ov) return;
  document.getElementById('sheet-title').innerHTML = title;
  document.getElementById('sheet-body').innerHTML = bodyHTML;
  ov.classList.add('show');
}
function closeSheet(){
  const ov = document.getElementById('sheet');
  if(ov) ov.classList.remove('show');
}
function checkFugCard(i){
  const r = state.fug.route[i];
  if(!r || !r.hidden || state.humanRole!=='fugitive') return;
  openSheet('第 ' + (i+1) + ' 张暗置地点牌',
    '<p>地点牌：<b style="color:var(--gold)">' + r.num + '</b></p>' +
    (r.cover.length
      ? '<p>掩护牌（面朝下）：<b style="color:var(--gold)">' + r.cover.join('、') + '</b></p>'
      : '<p>无掩护牌</p>') +
    '<p style="font-size:11px;opacity:.7">掩护标记合计 ' + coverMarks(r.cover) + '，上限放宽 +' + coverMarks(r.cover) + '</p>' +
    '<button class="btn btn-ghost" onclick="closeSheet()">关闭</button>');
}
function pilePickHTML(onclickFn, label){
  return (label ? '<div class="pick-label">' + label + '</div>' : '') +
    '<div class="pile-pick">' + PILES.map(p =>
    '<button class="btn" onclick="' + onclickFn + '(\'' + p.key + '\', this)" ' + (state.piles[p.key].length?'':'disabled') + '>' +
    p.key + ' 堆 ' + p.lo + '-' + p.hi + '（剩 ' + state.piles[p.key].length + '）</button>'
  ).join('') + '</div>';
}

/* ===== 主界面 ===== */
function renderGame(){
  const humanIsFug = state.humanRole==='fugitive';
  let handArea, actions = '';
  if(humanIsFug){
    handArea = renderFugHand();
    actions = renderFugActions();
  } else {
    handArea = renderMarArea();
    actions = '';
  }
  let body;
  if(humanIsFug && state.needDraw){
    // 摸牌阶段：抽牌 UI 在整个手牌区上方，状态行在最后
    body = actions + handArea + renderFugStatus();
  } else {
    body = handArea + (humanIsFug ? renderFugStatus() + actions : '');
  }
  return '' +
    '<div id="topbar">' +
      '<div class="tb-row">' +
        '<h2 class="tb-title">🕵️ 神探缉凶</h2>' +
        '<div class="tb-btns">' +
          '<button class="icon-btn" onclick="quitGame()">🚪 退出</button>' +
          '<button class="icon-btn" onclick="showModal(\'rules\')">📖 规则</button>' +
        '</div>' +
      '</div>' +
      '<div class="tb-row tb-tri">' +
        '<div class="tb-left">' + roleTag(state.humanRole==='fugitive'?'marshal':'fugitive') + '</div>' +
        '<div class="tb-center">' +
          '<div class="pile-box">' + PILES.map(p => '<span class="pile">' + p.key + ' <b>' + state.piles[p.key].length + '</b></span>').join('') + '</div>' +
        '</div>' +
        '<div class="tb-right">' + roleTag(state.humanRole) + '</div>' +
      '</div>' +
    '</div>' +
    logLineHTML() +
    '<div class="hint">' + turnLabel() + '</div>' +
    '<div id="track">' + trackHTML(humanIsFug) + '</div>' +
    body;
}

/* ===== 大盗视角 ===== */
function renderFugStatus(){
  const last = lastRouteNum();
  const m = ui.selMain;
  const covers = ui.selCover;
  const marksTotal = coverMarks(covers);
  const maxAllowed = m ? last + 3 + marksTotal : last + 3;
  const diff = m ? m - last : 0;
  let status;
  if(!m){ status = '未选主牌（上限 ' + maxAllowed + '）'; }
  else if(diff < 1){ status = '主牌 ' + m + '：必须比 ' + last + ' 更大'; }
  else if(diff <= 3){ status = '主牌 ' + m + '：差 ' + diff + '，无需掩护'; }
  else { status = '主牌 ' + m + '：差 ' + diff + '，掩护标记 ' + marksTotal + ' → 上限 ' + maxAllowed + (diff<=maxAllowed?' ✓':'（不够！）'); }
  return '<div class="hint">' + status + '</div>';
}
function renderFugHand(){
  const cards = state.fug.hand.map(n => {
    const selMain = ui.selMain===n ? ' sel-main' : '';
    const selCover = ui.selCover.includes(n) ? ' sel-cover' : '';
    return '<button class="h-card' + selMain + selCover + '" onclick="toggleFugCard(' + n + ')">' + n +
      (marks(n) ? '<span class="mk">' + '●'.repeat(marks(n)) + '</span>' : '') + '</button>';
  }).join('');
  return '' +
    '<div class="section-title">你的手牌 <span style="font-size:11px">掩护标记：奇 ● / 偶 ●●</span></div>' +
    '<div id="hand">' + cards + '</div>';
}
function renderFugActions(){
  if(state.turn !== 'fugitive' || ui.lock) return '';
  let html = '<div id="actions">';
  if(state.needDraw){
    return '<div class="hint">抽 1 张牌，选择一堆：</div>' + pilePickHTML('fugDrawClick');
  }
  const m = ui.selMain;
  const covers = ui.selCover;
  const last = lastRouteNum();
  const diff = m ? m-last : 0;
  const canPlace = m && diff>=1 && m <= last+3+coverMarks(covers);
  html += '<button class="btn btn-primary" onclick="doFugPlace()" ' + (canPlace?'':'disabled') + '>放置' + (m?'（' + m + '）':'') + '</button>';
  if(state.firstTurn && state.fug.route.length>=1){
    html += '<button class="btn btn-ghost" onclick="fugEndFirstTurn()">结束回合</button>';
  }
  if(!state.firstTurn){
    html += '<button class="btn btn-ghost" onclick="fugPass()">跳过</button>';
  }
  html += '</div>';
  return html;
}
function toggleFugCard(n){
  if(ui.lock || state.turn!=='fugitive' || state.phase!=='playing') return;
  if(state.needDraw){
    if(anyPileLeft()){ toast('先进行摸牌'); return; }
    state.needDraw = false; save(); render(); // 牌库全空 → 自愈清除，直接可选牌
  }
  if(ui.selMain === null){
    ui.selMain = n;
  } else if(ui.selMain === n){
    ui.selMain = null;
    ui.selCover = [];
  } else {
    if(ui.selCover.includes(n)) ui.selCover = ui.selCover.filter(x=>x!==n);
    else ui.selCover.push(n);
  }
  render();
}
function doFugPlace(){
  if(ui.lock || ui.selMain === null) return;
  const res = fugPlace(ui.selMain, ui.selCover);
  if(!res.ok){
    log(res.reason, 'lg-miss');
    render();
  }
}
function fugDrawClick(pileKey){
  if(ui.lock || state.turn!=='fugitive' || !state.needDraw || state.phase!=='playing') return;
  if(!drawFrom(pileKey,'fugitive')){
    if(!anyPileLeft()){ state.needDraw = false; save(); render(); }
    return;
  }
  state.needDraw = false;
  save(); render();
}

/* ===== 警探视角 ===== */
function renderMarArea(){
  const myTurn = state.turn === 'marshal' && !ui.lock;
  let html = '';
  if(!myTurn){
    html += '<div class="hint">' + (state.turn==='fugitive' ? '大盗行动中…' : '结算中…') + '</div>' + gridAreaHTML();
  } else if(state.needDraw){
    const remain = state.mar.firstDraw ? Math.max(1, 2 - (state.mar.drawCount||0)) : 1;
    html += pilePickHTML('marDrawClick', '还可抽 ' + remain + ' 张') + gridAreaHTML();
  } else {
    html += '<div class="hint">手牌已自动标蓝于网格（其数字不可能在暗牌中）。猜测模式：点选数字（可多选）→ 猜；单猜命中即翻开，多猜须全部命中才翻开。标记模式：点击单元格标记「怀疑」。</div>' +
      gridAreaHTML() +
      '<div id="actions"><button class="btn btn-primary" onclick="doMarGuess()" ' + (ui.gridSel.length?'':'disabled') + '>猜（' + ui.gridSel.length + '）</button></div>';
  }
  return html;
}
function coverNums(){
  const set = new Set();
  state.fug.route.forEach(r => {
    if(!r.hidden){ r.cover.forEach(c=>set.add(c)); }
  });
  return set;
}
function gridAreaHTML(){
  return '<div class="grid-tools">' +
    '<button class="btn btn-ghost grid-mode-btn" onclick="toggleGridMode()">' + (gridMode==='mark' ? '✓ 标记模式' : '猜测模式') + '</button>' +
    '<div class="grid-legend">' +
      '<span><span class="gd gd-open"></span>已翻开</span>' +
      '<span><span class="gd gd-cover"></span>掩护</span>' +
      '<span><span class="gd gd-hand"></span>手牌</span>' +
      '<span><span class="gd gd-suspect"></span>怀疑</span>' +
    '</div>' +
  '</div>' +
  '<div class="num-grid">' + gridHTML() + '</div>';
}
function gridHTML(){
  const open = openNums();
  const covers = coverNums();
  const handSet = new Set(state.mar.hand);
  const marks = state.mar.marks || {};
  let html = '';
  for(let n=1;n<=42;n++){
    const sel = ui.gridSel.includes(n);
    let cls = '', off = false;
    // 自动标记色：任何模式下都显示（帮助排除）；掩护牌比主牌更具体，优先
    if(covers.has(n)) cls = ' m-cover';
    else if(open.has(n)) cls = ' m-open';
    else if(handSet.has(n)) cls = ' m-hand';
    else if(marks[n]) cls = ' m-suspect';
    if(gridMode==='mark'){
      if(sel) cls += ' sel';
    } else {
      off = open.has(n) || handSet.has(n);
      if(sel) cls = ' sel';
    }
    html += '<button class="g-cell' + cls + '" data-n="' + n + '" onclick="toggleGrid(' + n + ')" ' + (off?'disabled':'') + '>' + n + '</button>';
  }
  return html;
}
function toggleGridMode(){
  gridMode = gridMode==='mark' ? 'guess' : 'mark';
  ui.gridSel = [];
  render();
}
function cycleMark(n){
  const marks = state.mar.marks || (state.mar.marks = {});
  if(marks[n]) delete marks[n];
  else marks[n] = 1;
  save(); render();
}
function toggleGrid(n){
  if(ui.lock) return;
  if(state.turn!=='marshal' || (state.phase!=='playing' && state.phase!=='manhunt')) return;
  if(state.needDraw){
    if(anyPileLeft()){ toast('先进行摸牌'); return; }
    state.needDraw = false; save(); render(); // 牌库全空 → 自愈清除，直接可猜
  }
  if(gridMode==='mark'){ cycleMark(n); return; }
  if(ui.gridSel.includes(n)) ui.gridSel = ui.gridSel.filter(x=>x!==n);
  else ui.gridSel.push(n);
  render();
}
function doMarGuess(){
  if(ui.lock || !ui.gridSel.length) return;
  marGuess([...ui.gridSel]);
}

/* ===== 搜捕视图 ===== */
function renderManhunt(){
  const humanIsFug = state.humanRole==='fugitive';
  let grid = '';
  if(!humanIsFug){
    grid = '<div class="hint">搜捕：每次只能猜 1 个数字，必须从小到大依次猜，猜错顺序/数字即失败。在网格中选一个数字后点「猜」。</div>' +
      gridAreaHTML() +
      '<div id="actions"><button class="btn btn-primary" onclick="doManhuntGuess()" ' + (ui.gridSel.length===1?'':'disabled') + '>猜（' + (ui.gridSel[0]||'') + '）</button></div>';
  } else {
    grid = '<div class="hint" style="text-align:center">⏳ 警探搜捕中…</div>';
  }
  return '' +
    '<div id="topbar">' +
      '<div class="tb-row">' +
        '<h2 class="tb-title">🕵️ 神探缉凶</h2>' +
        '<div class="tb-btns">' +
          '<button class="icon-btn" onclick="quitGame()">🚪 退出</button>' +
          '<button class="icon-btn" onclick="showModal(\'rules\')">📖 规则</button>' +
        '</div>' +
      '</div>' +
      '<div class="tb-row tb-tri">' +
        '<div class="tb-left">' + roleTag(state.humanRole==='fugitive'?'marshal':'fugitive') + '</div>' +
        '<div class="tb-center">' +
          '<div class="pile-box">' + PILES.map(p => '<span class="pile">' + p.key + ' <b>' + state.piles[p.key].length + '</b></span>').join('') + '</div>' +
        '</div>' +
        '<div class="tb-right">' + roleTag(state.humanRole) + '</div>' +
      '</div>' +
    '</div>' +
    logLineHTML() +
    '<div class="hint">第 ' + state.turns + ' 回合 · 警探 🔥 搜捕中</div>' +
    '<div id="track">' + trackHTML(humanIsFug) + '</div>' +
    grid;
}
function doManhuntGuess(){
  if(ui.lock || ui.gridSel.length !== 1) return;
  manhuntGuess(ui.gridSel[0]);
}

function overActionsHTML(){
  if(!OL.active){
    return '<button class="btn btn-primary" onclick="playAgain()">再来一局</button>' +
      '<button class="btn btn-ghost" onclick="backToLanding()">重选身份</button>';
  }
  if(OL.isHost){
    return '<button class="btn btn-primary" onclick="olRematch()">再来一局</button>' +
      '<button class="btn btn-ghost" onclick="olBackToRoom()">重选身份</button>';
  }
  // 成员侧：没有再来一局权限，仅提示等待房主；顶部 🚪 退出 按钮已覆盖退出入口，底部不再重复
  return '<div class="hint" style="width:100%;text-align:center">对局结束，等待房主发起下一局…</div>';
}

/* ===== 结算视图 ===== */
function renderOver(){
  const humanWin = state.humanRole === state.winner;
  const revealCount = state.fug.route.filter(r=>!r.hidden).length;
  const fugCards = state.fug.route.filter(r=>r.num!==42).length;
  return '' +
    '<div id="topbar">' +
      '<div class="tb-row">' +
        '<h2 class="tb-title">🕵️ 神探缉凶</h2>' +
        '<div class="tb-btns">' +
          '<button class="icon-btn" onclick="quitGame()">🚪 退出</button>' +
          '<button class="icon-btn" onclick="showModal(\'rules\')">📖 规则</button>' +
        '</div>' +
      '</div>' +
      '<div class="tb-row tb-tri">' +
        '<div class="tb-left">' + roleTag(state.humanRole==='fugitive'?'marshal':'fugitive') + '</div>' +
        '<div class="tb-center">' +
          '<div class="pile-box">' + PILES.map(p => '<span class="pile">' + p.key + ' <b>' + state.piles[p.key].length + '</b></span>').join('') + '</div>' +
        '</div>' +
        '<div class="tb-right">' + roleTag(state.humanRole) + '</div>' +
      '</div>' +
    '</div>' +
    logLineHTML() +
    '<div class="win-banner win-' + (state.winner==='fugitive'?'fug':'mar') + '">' +
      '<div class="big">' + (humanWin ? '😎你赢了' : '😵你输了…') + '</div>' +
      '<div class="sub">' + (state.winner==='fugitive' ? '大盗成功逃脱！' : '警探成功抓捕大盗！') +
        // ' · 你扮演 ' + (state.humanRole==='fugitive'?'大盗':'警探') +
        // ' · 共 ' + state.turns + ' 回合 · 翻开 ' + revealCount + ' 张地点牌</div>' +
    '</div>' +
    '<div id="final-track">' +
      '<div class="t-card t-start"><b>0</b><div class="idx">起点</div></div>' +
      (state.fug.route.length ? '<span class="t-arrow">›</span>' : '') +
      state.fug.route.map((r,i)=>{
      const cls = r.hidden ? 't-hidden' : 't-open';
      const body = r.hidden
        ? ('<span class="q">?</span>' + (r.cover.length ? '<span class="cov">掩护×' + r.cover.length + '</span>' : ''))
        : ('<b>' + r.num + '</b>' + (r.cover.length?'<span class="cov">掩 ' + r.cover.join(',') + '</span>':''));
      const chk = r.cover.length ? ' chk' : '';
      // 结算页：未猜到的暗牌可点击复盘（？→弹窗显示确切数字与掩护牌）
      const clickable = chk || r.hidden;
      return '<div class="t-card ' + cls + chk + '"' + (clickable ? ' onclick="viewRouteCard(' + i + ')"' : '') + '><div class="idx">第' + (i+1) + '张</div>' + body + '</div>';
    }).join('<span class="t-arrow">›</span>') + '</div>' +
    '<div id="stats">' +
      '<div class="s"><b>' + state.turns + '</b><span>回合数</span></div>' +
      '<div class="s"><b>' + (state.fug.route.length) + '</b><span>地点牌</span></div>' +
      '<div class="s"><b>' + revealCount + '</b><span>被翻开</span></div>' +
      '<div class="s"><b>' + state.marMissed.length + '</b><span>猜错次数</span></div>' +
    '</div>' +
    '<div id="actions">' + overActionsHTML() + '</div>';
}
function bindOver(){}
function viewRouteCard(i){
  const r = state.fug.route[i];
  if(!r) return;
  // 对局中仅已翻开牌可查看（暗牌走 checkFugCard）；结算页暗牌也可复盘
  if(r.hidden && state.phase !== 'over') return;
  const label = r.hidden ? '暗置（未被猜中）' : '';
  openSheet('第 ' + (i+1) + ' 张地点牌' + (label ? ' <span style="opacity:.7">' + label + '</span>' : ''),
    '<p>地点牌：<b style="color:var(--gold)">' + r.num + '</b></p>' +
    (r.cover.length
      ? '<p>掩护牌：<b style="color:var(--gold)">' + r.cover.join('、') + '</b></p>'
      : '<p>无掩护牌</p>') +
    '<p style="font-size:11px;opacity:.7">掩护标记合计 ' + coverMarks(r.cover) + '，上限放宽 +' + coverMarks(r.cover) + '</p>' +
    '<button class="btn btn-ghost" onclick="closeSheet()">关闭</button>');
}
function bindManhunt(){}
function bindGame(){}

function playAgain(){ newGame(state.humanRole); }
function backToLanding(){
  localStorage.removeItem(STORAGE_KEY);
  state = null;
  showLanding();
}

/* ================= 登录页 ================= */
function showLanding(){
  document.getElementById('app').innerHTML =
    '<div id="landing">' +
      '<div class="rules-corner"><button onclick="showModal(\'rules\')">📖 规则</button></div>' +
      '<div class="hero-icon">🕵️</div>' +
      '<h1>神探缉凶</h1>' +
      '<div class="sub">Fugitive · 人机对战</div>' +
      '<div class="badge">🏙️ 大盗藏匿 警探追捕</div>' +
      '<button class="btn btn-fug role-btn" onclick="newGame(\'fugitive\')"><span class="em">🕶️</span><span class="rt"><b>扮演 大盗</b><span class="de">暗放地点牌，冲刺到 42 逃脱</span></span></button>' +
      '<button class="btn btn-mar role-btn" onclick="newGame(\'marshal\')"><span class="em">🕵️</span><span class="rt"><b>扮演 警探</b><span class="de">猜数字，翻开全部藏身处</span></span></button>' +
      '<button class="btn btn-random role-btn" id="btn-random"><span class="em">🎲</span><span class="rt"><b>随机身份</b><span class="de">系统替你决定</span></span></button>' +
      '<div class="credit">@imStar100</div>' +
    '</div>';
  document.getElementById('btn-random').onclick = function(){
    newGame(Math.random()<0.5 ? 'fugitive' : 'marshal');
  };
}

/* ================= 模态框 ================= */
function showModal(id){
  const overlay = document.getElementById('modal-' + id);
  if(overlay) overlay.classList.add('show');
}
function closeModal(id){
  const overlay = document.getElementById('modal-' + id);
  if(overlay) overlay.classList.remove('show');
}
function modalHTML(){
  return '' +
  '<div class="modal-overlay" id="modal-rules" onclick="if(event.target===this)closeModal(\'rules\')"><div class="modal">' +
    '<h3>规则说明</h3>' +
    '<ul>' +
      '<li><b>目标</b>：<u>大盗</u>暗放地点牌（必须递增，且 ≤ 上一张 +3），率先打出 42 则逃脱；<u>警探</u>抽牌并猜测数字，猜对则翻开地点牌，全部地点牌翻出则获胜。</li>' +
      '<li><b>牌堆</b>：<table class="pile-table"><tr><th>牌堆</th><th>范围</th><th>张数</th></tr><tr><td>A</td><td>4 ~ 14</td><td>11</td></tr><tr><td>B</td><td>15 ~ 28</td><td>14</td></tr><tr><td>C</td><td>29 ~ 41</td><td>13</td></tr></table>剩牌数在顶栏中部显示。</li>' +
      '<li><b>初始手牌</b>：大盗起始 9 张——固定 <b>1、2、3、42</b> + A 堆抽 3 张 + B 堆抽 2 张。警探起始空手。</li>' +
      '<li><b>掩护</b>：每张 1~41 牌自带掩护标记（奇数 1 个、偶数 2 个；42 不能作掩护）。打出地点牌时可追加任意数量掩护牌（正面朝下），每 1 个标记可放宽上限 +1。</li>' +
      '<li><b>回合流程</b>：<table class="pile-table"><tr><th></th><th>大盗</th><th>警探</th></tr><tr><td>第一回合</td><td>放 1~2 张地点牌</td><td>抽 2 张后必须猜测</td></tr><tr><td>后续回合</td><td>抽 1 张，可放 1 张或跳过</td><td>抽 1 张后必须猜测</td></tr></table></li>' +
      '<li><b>猜测</b>：可猜任意 1~41 数字。单猜命中即翻开（掩护牌一并翻开）；多猜须全部命中才翻。</li>' +
      '<li><b>搜捕</b>：大盗打出 42 时，若已翻开地点牌均不大于 29，警探进入搜捕：依次单猜全部暗牌，猜错即大盗胜，全对则警探反败为胜。</li>' +
    '</ul>' +
    '<button class="btn btn-primary" onclick="closeModal(\'rules\')">知道了</button>' +
  '</div></div>' +
  '<div class="modal-overlay" id="modal-quit" onclick="if(event.target===this)closeModal(\'quit\')"><div class="modal">' +
    '<h3>退出本局？</h3>' +
    '<p>当前进度会清除，重新选择身份。</p>' +
    '<button class="btn btn-primary" onclick="confirmQuit()">确认退出</button>' +
    '<button class="btn btn-ghost" onclick="closeModal(\'quit\')">继续游戏</button>' +
  '</div></div>';
}
function quitGame(){
  if(ONLINE_MODE && typeof olConfirmQuit === 'function'){ olConfirmQuit(); return; }
  const ov = document.getElementById('modal-quit');
  if(ov) ov.classList.add('show');
}
function confirmQuit(){
  closeModal('quit');
  backToLanding();
}

/* ================= 启动 ================= */
(function boot(){
  document.body.insertAdjacentHTML('beforeend', modalHTML());
  document.body.insertAdjacentHTML('beforeend',
    '<div id="bubble-layer"></div>' +
    '<div class="modal-overlay" id="sheet" onclick="if(event.target===this)closeSheet()"><div class="modal">' +
      '<h3 id="sheet-title"></h3>' +
      '<div id="sheet-body"></div>' +
    '</div></div>');
  if(ONLINE_MODE) return; // 联机页：由 online.js 全权接管（不读单机存档、不显示人机登录页）
  const saved = load();
  if(saved){
    state = saved;
    render();
    scheduleAI(); // 刷新恢复：若轮到 AI 则续跑其回合（气泡/延时属瞬态不入档，AI 可能从存档点重演当前行动）
  } else {
    showLanding();
  }
})();
