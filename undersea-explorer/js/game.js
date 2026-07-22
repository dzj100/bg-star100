'use strict';

/* ================= 常量配置 ================= */
const STORAGE_KEY = 'undersea-explorer-state';
// 玩家标记配色（按座位顺序分配）
const PLAYER_COLORS = ['#e94560','#4fc3f7','#66bb6a','#f5c518','#ab47bc','#ff8a65'];
// 四种宝藏板块：名称 / 主色 / 正面点数标记
const SHAPES = {
  triangle: { name:'三角形', color:'#bbeee7', dots:1 },// #66bb6a
  square:   { name:'四角形', color:'#93e6e0', dots:2 },// #4fc3f7
  pentagon: { name:'五角形', color:'#2bd0c8', dots:3 },// #ab47bc
  hexagon:  { name:'六角形', color:'#037097', dots:4 },// #f5c518
};
let state = null;      // 全局游戏状态
let setupNames = [];   // 设置阶段暂存的玩家昵称列表
let screen = 'landing'; // 无存档时的界面：'landing' 落地页 | 'setup' 玩家设置页

/* ---- S 形倾斜路径几何参数（单位：板宽百分比）---- */
const COLS = 8;                       // 每行格子数
const M = 7;                          // 行首/行尾格子中心到板边缘的距离
const S = 11;                         // 格子边长
const DX = (100 - 2*M) / (COLS-1);    // 同行相邻格子中心的水平间距
const MAX_TILT = 7.52;                // 单行首尾总落差（= 旧版 7*DX*tan(5°)）
const ROW_GAP = 13;                   // 相邻两行连接处的行间距（中心到中心）
const Y0 = 7;                         // 第一行首个格子中心的纵坐标
const BOARD_H = 84;                   // 路径板高度（板宽百分比单位），对应 CSS aspect-ratio 100/84

// 平滑缓动（快-慢-快）：t∈[0,1] → [0,1]，两端斜率大、中段斜率小
// f(t) = t + (1/3)·sin²(πt)·(1-2t)，满足 f(0)=0、f(1)=1、f(0.5)=0.5
function easeInOut(t){
  const s = Math.sin(Math.PI * t);
  return t + (0.4) * s * s * (1 - 2*t);
}

/* ================= 工具函数 ================= */

// Fisher-Yates 洗牌，返回打乱后的新数组
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
// 将当前状态持久化到 localStorage
function saveState(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){} }
// 从 localStorage 读取状态，无效则返回 null
function loadState(){ try{ const s=JSON.parse(localStorage.getItem(STORAGE_KEY)); if(s && s.players && s.players.length>=2) return s; }catch(e){} return null; }
// 清除存档
function clearState(){ try{ localStorage.removeItem(STORAGE_KEY); }catch(e){} }

// 顶部滑入一条吐司提示，约 2.2 秒后自动消失
function toast(msg){
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  c.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, 2200);
}
// 弹出底部弹窗并填充 HTML 内容（同时缓存，便于用户点击状态指示时再次弹出）
// 不调用 render()：modal 位于 #app 之外，其显示/隐藏不应打断正在进行的玩家条平滑滚动
// 仅局部刷新行动条上的"等待 xxx 操作…"文本，让 action-link 状态保持准确
let _lastModalHTML = '';
function showModal(html){
  _lastModalHTML = html;
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('show');
  refreshWaitText();
}
// 关闭底部弹窗（保留缓存，便于用户通过下划线状态再次弹出）
function hideModal(){
  document.getElementById('modal-overlay').classList.remove('show');
  refreshWaitText();
}
// 局部刷新 .wait-text：仅在弹窗开/关时切换"操作"的下划线状态，避免整页 render 打断滚动动画
function refreshWaitText(){
  const wt = document.querySelector('.wait-text');
  if(!wt || !state || state.phase!=='playing' || state.turnPhase==='roll') return;
  const p = state.players[state.currentPlayerIdx];
  const dirText = p.choseReturn ? '（本轮已选择返舱）' : '';
  const phaseLabel = state.turnPhase==='direction' ? '选择方向'
                   : state.turnPhase==='action'    ? '选择行动'
                   : '操作';
  // 只要有缓存就显示可点击的下划线（不论弹窗是否正在显示），让用户能随时重新弹出
  const cache = _lastModalHTML;
  const actionLink = cache
    ? `<span class="action-link" onclick="reopenModal()">${phaseLabel}</span>`
    : `<span>${phaseLabel}</span>`;
  wt.innerHTML = `等待 ${p.name} ${actionLink}… ${dirText}`;
}
// 重新弹出最近一次缓存的弹窗（由"等待 xxx 操作…"的下划线状态调用）
function reopenModal(){ if(_lastModalHTML) showModal(_lastModalHTML); }
// 初始化遮罩层事件：点击遮罩关闭弹窗；弹窗本体点击冒泡到遮罩时不关闭
function initModalOverlay(){
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  overlay.addEventListener('click', hideModal);
  content.addEventListener('click', e => e.stopPropagation());
}

/* ================= SVG 绘制 ================= */

// 绘制宝藏板块正面：形状 + 对应数量的圆点标记（不显示分值）
function shapeSVG(shape, dots, size){
  const c = SHAPES[shape].color;
  let body = '';
  if(shape==='triangle') body = `<polygon points="50,16 87,79 13,79" fill="${c}" stroke="${c}" stroke-width="13" stroke-linejoin="round"/>`;
  else if(shape==='square') body = `<polygon points="50,11 89,50 50,89 11,50" fill="${c}" stroke="${c}" stroke-width="13" stroke-linejoin="round"/>`;
  else if(shape==='pentagon') body = `<polygon points="50,13 85,39 72,80 28,80 15,39" fill="${c}" stroke="${c}" stroke-width="13" stroke-linejoin="round"/>`;
  else if(shape==='hexagon') body = `<polygon points="50,7 87,28.5 87,71.5 50,93 13,71.5 13,28.5" fill="${c}" stroke="${c}" stroke-width="13" stroke-linejoin="round"/>`;
  const dotLayout = shape==='pentagon' ? [[50,35],[33,62],[67,62]] : ({1:[[50,56]],2:[[37,45],[63,67]],3:[[31,39],[50,56],[69,73]],4:[[35,41],[65,41],[35,71],[65,71]]}[dots]||[]);
  const dotsSVG = dotLayout.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="7" fill="rgba(0,0,0,.5)"/>`).join('');
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">${body}${dotsSVG}</svg>`;
}
// 绘制圆形 X 标记（宝藏被拿走后原位显示）
function xMarkSVG(size){
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
    <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="4" stroke-dasharray="8 5"/>
    <line x1="37" y1="37" x2="63" y2="63" stroke="rgba(255,255,255,.45)" stroke-width="8" stroke-linecap="round"/>
    <line x1="63" y1="37" x2="37" y2="63" stroke="rgba(255,255,255,.45)" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
}
// 绘制宝藏包（袋子）图标
function bundleSVG(size){
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
    <path d="M40 32 Q40 18 50 18 Q60 18 60 32" fill="none" stroke="#bcaaa4" stroke-width="6" stroke-linecap="round"/>
    <path d="M32 34 Q50 26 68 34 Q80 50 76 68 Q72 85 50 85 Q28 85 24 68 Q20 50 32 34 Z" fill="#8d6e63"/>
    <path d="M42 34 Q50 30 58 34 L56 40 Q50 37 44 40 Z" fill="#6d4c41"/>
    <circle cx="50" cy="58" r="7" fill="rgba(255,255,255,.4)"/>
  </svg>`;
}
// 绘制潜水艇图标（用户提供的 SVG，重新配色）
function submarineSVG(size){
  const h = Math.round(size*1024/1054);
  return `<svg viewBox="0 0 1054 1024" width="${size}" height="${h}">
    <path d="M59.640768 433.761246h135.636914v288.60903H59.640768z" fill="#45bab2"/>
    <path d="M560.020827 155.457928h36.545872v148.989673H560.020827z" fill="#45bab2"/>
    <path d="M560.020827 155.457928h95.578634v28.11095H560.020827z" fill="#45bab2"/>
    <path d="M411.031154 269.777195h333.587485v112.850698H411.031154z" fill="#45bab2"/>
    <path d="M183.330352 579.940058a397.774272 216.457357 0 1 0 795.548545 0 397.774272 216.457357 0 1 0-795.548545 0Z" fill="#45bab2"/>
    <path d="M303.271342 583.84767a88.551481 53.881075 90 1 0 107.76215 0 88.551481 53.881075 90 1 0-107.76215 0Z" fill="#10325c"/>
    <path d="M523.944991 579.940058a88.551481 53.881075 90 1 0 107.76215 0 88.551481 53.881075 90 1 0-107.76215 0Z" fill="#10325c"/>
    <path d="M744.618639 583.688652a88.551481 53.881075 90 1 0 107.762151 0 88.551481 53.881075 90 1 0-107.762151 0Z" fill="#10325c"/>
  </svg>`;
}
// 绘制单个骰子（1~3 点），val 为 0 时显示占位 "?"
function dieSVG(val){
  if(!val) return '<div class="die blank"></div>';
  const pips = {1:[[50,50]],2:[[30,30],[70,70]],3:[[28,28],[50,50],[72,72]]}[val]||[];
  return `<div class="die">${pips.map(([x,y])=>`<span class="pip" style="left:${x}%;top:${y}%"></span>`).join('')}</div>`;
}

/* ================= 游戏初始化 ================= */

// 生成 32 格路径：各分类宝藏分别洗混后按 三角→四角→五角→六角 排列
function generatePath(){
  const groups = [
    { shape:'triangle', values:[0,0,1,1,2,2,3,3] },
    { shape:'square',   values:[4,4,5,5,6,6,7,7] },
    { shape:'pentagon', values:[8,8,9,9,10,10,11,11] },
    { shape:'hexagon',  values:[12,12,13,13,14,14,15,15] },
  ];
  const path = []; let id = 0;
  for(const g of groups){
    for(const v of shuffle(g.values)){
      path.push({ id:id++, shape:g.shape, dots:SHAPES[g.shape].dots, value:v, state:'treasure', bundle:null, occupant:null });
    }
  }
  return path;
}
// 用玩家昵称列表初始化一局新游戏并进入第一轮
function initGame(names){
  state = {
    phase:'playing', round:1, oxygen:25,
    currentPlayerIdx:0, firstPlayerIdx:0,
    turnPhase:'roll', dice:[0,0], lastRoll:0, effectiveSteps:0,
    players: names.map(n=>({ name:n, position:-1, score:0, backpack:[], returned:false, choseReturn:false, roundScores:[] })),
    path: generatePath(), bundles:[], pendingBundles:0, roundResults:null,
  };
  console.log('[新游戏]', names.join(','), '路径已生成');
  startTurn();
}

/* ================= 格子辅助 ================= */

// 根据位置获取格子对象：0~31 为路径格，32+ 为宝藏包格，-1(潜水艇)返回 null
function getTile(pos){
  if(pos>=0 && pos<=31) return state.path[pos];
  if(pos>=32) return state.bundles[pos-32];
  return null;
}
// 设置某格的占据者（null 表示清空）
function setOccupant(pos, val){ const t=getTile(pos); if(t) t.occupant=val; }
// 当前可抵达的最大位置（路径末端 + 宝藏包格数量）
function maxPos(){ return 31 + state.bundles.length; }

// 计算某路径格中心的坐标（S 形倾斜布局：奇数行向右下、偶数行向左下延伸，
// 纵向落差采用 smoothstep 缓动：首尾陡峭、中段平缓）
function tilePos(idx){
  const row = Math.floor(idx / COLS);
  const col = idx % COLS;
  const ltr = row % 2 === 0;                 // 偶数行自左向右，奇数行自右向左
  const x = ltr ? M + col*DX : M + (COLS-1-col)*DX;
  const t = col / (COLS - 1);
  const tiltY = easeInOut(t) * MAX_TILT;
  const y = Y0 + row*(MAX_TILT + ROW_GAP) + tiltY;
  return { x, y };
}

// 计算潜水艇 SVG 中心在 .path-board 百分比坐标系中的位置
// 用于 token 从潜水艇出发 / 返回潜水艇时的动画起止点
function subCenterInBoard(){
  const board = document.querySelector('.path-board');
  const svg = document.querySelector('.sub-row svg');
  if(!board || !svg){
    // 回退值：大致估算潜水艇在路径板左上方
    return { x:5, y:-12 };
  }
  const bR = board.getBoundingClientRect();
  const sR = svg.getBoundingClientRect();
  const x = (sR.left + sR.width/2 - bR.left) / bR.width * 100;
  // 路径板 aspect-ratio 100/BOARD_H；1 单位 y = 板宽 × BOARD_H/100 像素
  // y 取 SVG 底部边缘再往下 2px，让 token 看起来从潜水艇底部冒出
  const y = (sR.top + sR.height + 2 - bR.top) / (bR.width * BOARD_H / 100) * 100;
  return { x, y };
}

// 判断某格是否不可落脚：被其他玩家占据，或已被移除（上一轮拾取后清空）
function isBlocked(pos, pIdx){
  const t = getTile(pos);
  if(!t) return false;                       // 潜水艇(-1)始终可落脚
  if(t.state === 'empty') return true;       // 已移除的格子
  return t.occupant !== null && t.occupant !== pIdx;
}

/* ================= 回合流程 ================= */

// 开始当前玩家的回合：先按持有宝藏数消耗氧气，氧气归零则直接结束本轮
function startTurn(){
  const p = state.players[state.currentPlayerIdx];
  state.turnPhase = 'roll';
  state.dice = [0,0]; state.lastRoll = 0; state.effectiveSteps = 0;
  const n = p.backpack.length;
  if(n > 0){
    const before = state.oxygen;
    state.oxygen = Math.max(0, state.oxygen - n);
    console.log(`[氧气] ${before} -> ${state.oxygen} (${p.name}持有${n}个宝藏)`);
    toast(`${p.name} 持有${n}个宝藏，消耗${n}点氧气（剩余${state.oxygen}）`);
    if(state.oxygen <= 0){
      saveState(); render();
      setTimeout(()=>endRound('oxygen'), 800);
      return;
    }
  }
  saveState(); render();
  // 仅在玩家真的切换时才滚动（_lastScrolledPlayerIdx 会在 render 之外保留）
  scrollToCurrentPlayer(true);
}

// 将顶部玩家条平滑滚动，使当前玩家卡片落入视口内（不强制居中）
// force=true 时强制滚动（回合切换时）；否则仅在玩家索引变化时才滚动，避免弹窗等引起的多余滚动
let _lastScrolledPlayerIdx = -1;
function scrollToCurrentPlayer(force){
  if(!force && _lastScrolledPlayerIdx === state.currentPlayerIdx) return;
  _lastScrolledPlayerIdx = state.currentPlayerIdx;
  requestAnimationFrame(()=>{
    const strip = document.querySelector('.players-strip');
    if(!strip) return;
    const card = strip.children[state.currentPlayerIdx];
    if(!card) return;
    const sR = strip.getBoundingClientRect();
    const cR = card.getBoundingClientRect();
    const rel = cR.left - sR.left;
    if(rel < 0) strip.scrollBy({ left:rel, behavior:'smooth' });
    else if(cR.right > sR.right) strip.scrollBy({ left:cR.right - sR.right, behavior:'smooth' });
  });
}

// 投掷两个骰子（面为 1/2/3），计算有效步数并进入方向选择或行动阶段
function rollDice(){
  if(state.turnPhase !== 'roll') return;
  const faces = [1,2,3];
  const d1 = faces[Math.floor(Math.random()*3)];
  const d2 = faces[Math.floor(Math.random()*3)];
  state.dice = [d1,d2];
  state.lastRoll = d1+d2;
  const p = state.players[state.currentPlayerIdx];
  const penalty = p.backpack.length;
  state.effectiveSteps = Math.max(0, state.lastRoll - penalty);
  console.log(`[投骰] ${p.name}: ${d1}+${d2}=${state.lastRoll}, 背包${penalty}, 有效${state.effectiveSteps}`);
  toast(`${p.name} 投出了 ${d1} + ${d2} = ${state.lastRoll}`);
  if(penalty>0 && state.effectiveSteps>0) toast(`携带${penalty}个宝藏，实际移动${state.effectiveSteps}格`);
  // 有效步数为 0：原地不动，若不在潜水艇仍可在脚下格子行动
  if(state.effectiveSteps===0){
    if(penalty>0) toast('宝藏太重，无法移动！');
    if(p.position===-1){ endTurn(); return; }
    state.turnPhase='action'; saveState(); render();
    setTimeout(openActionModal, 500);
    return;
  }
  state.turnPhase='direction'; saveState(); render();
  setTimeout(openDirectionModal, 500);
}

// 打开方向选择弹窗；若本轮已选过返舱则默认返舱、跳过询问
function openDirectionModal(){
  const p = state.players[state.currentPlayerIdx];
  if(p.choseReturn){ chooseDirection('return'); return; }
  showModal(`
    <h3>选择方向</h3>
    <p class="m-desc">投掷结果 ${state.lastRoll}，可移动 <b style="color:var(--ocean)">${state.effectiveSteps}</b> 格<br>下潜：向深海前进 · 返舱：朝潜水艇后退</p>
    <button class="m-btn warn" onclick="chooseDirection('return')">⬆ 返舱</button>
    <button class="m-btn go" onclick="chooseDirection('dive')">⬇ 下潜</button>
  `);
}
// 确认方向选择：选返舱后本轮后续回合不再询问；随后执行移动
function chooseDirection(dir){
  const p = state.players[state.currentPlayerIdx];
  if(dir==='return') p.choseReturn = true;
  toast(`${p.name} 选择${dir==='dive'?'下潜':'返舱'}`);
  hideModal();
  executeMove(dir);
}

// 动画：token 逐格移动（steps 包含起点到终点的每一格索引）
// fromPos = -1 表示本段移动从潜水艇出发，首帧定在潜水艇 SVG 中心
function animateToken(steps, pIdx, fromPos){
  return new Promise(resolve => {
    if(steps.length < 2){ resolve(); return; }
    const board = document.querySelector('.path-board');
    if(!board){ resolve(); return; }
    const ghost = document.createElement('div');
    ghost.className = 'token-ghost';
    ghost.innerHTML = tokenSVG(PLAYER_COLORS[pIdx]);
    board.appendChild(ghost);

    // 从潜水艇出发：第一帧定位在潜水艇 SVG 中心，再逐格前进
    const fromSub = (fromPos === -1);

    let i = 0;
    function step(){
      if(i >= steps.length){ ghost.remove(); resolve(); return; }
      let x, y;
      if(fromSub && i === 0){
        ({x, y} = subCenterInBoard());
      } else {
        ({x, y} = tilePos(steps[i]));
      }
      // 匹配 .tile .token 的定位：tile 右上角偏移 (top:-10px, right:-6px)
      // tile left = (x - S/2)%, tile width = S%, tile right = (x + S/2)%
      // token left = tile right - 21px (27px width - 6px offset)
      ghost.style.left = `calc(${x + S/2}% - 21px)`;
      ghost.style.top = `calc(${(y - S/2) / BOARD_H * 100}% - 10px)`;
      i++;
      setTimeout(step, 260);
    }
    step();
  });
}

// 执行移动：逐格前进/后退，跳过不可落脚的格（被占或已移除）且不消耗步数；
// 步数耗尽或抵达路径末端时停在最后一个可落脚格；退回潜水艇则直接结束行动
async function executeMove(dir){
  const pIdx = state.currentPlayerIdx;
  const p = state.players[pIdx];
  const from = p.position;
  const mp = maxPos();
  let pos = from;
  // 如果从潜水艇(-1)出发，动画从 tile 0 开始；否则从当前位置开始
  const steps = [from === -1 ? 0 : from];

  if(dir==='dive'){
    let remaining = state.effectiveSteps;
    for(let next=from+1; next<=mp && remaining>0; next++){
      if(isBlocked(next,pIdx)) continue;     // 跳过不可落脚格，不消耗步数
      remaining--;
      pos = next;
      steps.push(pos);
    }
  } else {
    let remaining = state.effectiveSteps;
    for(let next=from-1; next>=-1 && remaining>0; next--){
      if(next===-1){ pos=-1; steps.push(0); break; }        // 抵达潜水艇，动画到位置0
      if(isBlocked(next,pIdx)) continue;
      remaining--;
      pos = next;
      steps.push(pos);
    }
  }

  console.log(`[移动] ${p.name}: ${from} -> ${pos} (${dir}, 步数${state.effectiveSteps})`);

  if(pos===from){
    toast(`${p.name} 无法移动，原地不动`);
    state.turnPhase='action'; saveState(); render();
    setTimeout(openActionModal, 500);
    return;
  }

  // 先隐藏原 token，播放移动动画
  if(from !== -1) setOccupant(from, null);
  render();
  // 出潜时：动画还没播完，p.position 仍是 -1，render 会把该玩家的小圆点留在潜水艇上。
  // 这里局部把它摘掉，避免 ghost 起飞时舱内还残留一个同款圆点。
  if(from === -1){
    const subTokens = document.querySelector('.sub-row .sub-tokens');
    if(subTokens){
      const dotIdx = state.players.slice(0, pIdx).filter(pl => pl.position === -1).length;
      const dots = subTokens.querySelectorAll('span[style]');
      if(dots[dotIdx]) dots[dotIdx].remove();
      const anyoneLeft = state.players.some((pl, i) => i !== pIdx && pl.position === -1);
      if(!anyoneLeft && !subTokens.querySelector('.sub-label')){
        const lab = document.createElement('span');
        lab.className = 'sub-label'; lab.textContent = '潜水艇上空无一人';
        subTokens.appendChild(lab);
      }
    }
  }
  await animateToken(steps, pIdx, from);

  // 动画结束，更新最终状态
  p.position = pos;
  if(pos!==-1) setOccupant(pos, pIdx);

  if(pos===-1){
    p.returned = true;
    toast(`${p.name} 返回了潜水艇 🏠`);
    render();
    endTurn();
    return;
  }
  toast(dir==='dive' ? `${p.name} 下潜到第 ${pos+1} 格` : `${p.name} 后退到第 ${pos+1} 格`);

  state.turnPhase='action'; saveState(); render();
  setTimeout(openActionModal, 500);
}

// 打开行动弹窗：根据脚下格子状态提供 拾取/放置/不行动
function openActionModal(){
  const p = state.players[state.currentPlayerIdx];
  const tile = getTile(p.position);
  if(!tile){ endTurn(); return; }

  if(tile.state==='treasure'){
    const hasBundle = !!tile.bundle;
    if(hasBundle){
      showModal(`
        <h3>发现宝藏包！</h3>
        <div class="m-shape">${bundleSVG(72)}</div>
        <p class="m-desc">沉入海底的宝藏包，拾取后视为1个宝藏</p>
        <button class="m-btn go" onclick="doPickup()">拾取宝藏包</button>
        <button class="m-btn ghost" onclick="doNothing()">不行动</button>
      `);
    } else {
      showModal(`
        <h3>发现宝藏！</h3>
        <div class="m-shape">${shapeSVG(tile.shape, tile.dots, 72)}</div>
        <p class="m-desc">${SHAPES[tile.shape].name}宝藏（分值未知）</p>
        <button class="m-btn go" onclick="doPickup()">拾取</button>
        <button class="m-btn ghost" onclick="doNothing()">不行动</button>
      `);
    }
  } else if(tile.state==='taken'){
    if(p.backpack.length>0){
      showModal(`
        <h3>放置宝藏</h3>
        <p class="m-desc">这里的宝藏已被拿走，可以放置1个背包中的宝藏</p>
        ${p.backpack.map((t,i)=>`<button class="m-btn item" onclick="doPlace(${i})">${t.isBundle?bundleSVG(22):shapeSVG(t.shape,t.dots,22)}<span>${t.isBundle?'宝藏包':SHAPES[t.shape].name}</span></button>`).join('')}
        <button class="m-btn ghost" onclick="doNothing()">不行动</button>
      `);
    } else {
      toast('背包为空，无法放置');
      endTurn();
    }
  } else {
    toast('这里什么都没有');
    endTurn();
  }
}

// 拾取脚下宝藏（或宝藏包）放入背包，原位留下 X 标记
function doPickup(){
  const p = state.players[state.currentPlayerIdx];
  const tile = getTile(p.position);
  if(tile.bundle){
    p.backpack.push({ shape:null, dots:0, value:tile.bundle.totalValue, isBundle:true, bundleValues:[...tile.bundle.values] });
    console.log(`[拾取] ${p.name} 拾取宝藏包(价值${tile.bundle.totalValue}), 背包${p.backpack.length}个`);
    toast(`${p.name} 拾取了宝藏包（${tile.bundle.values.length}个宝藏）`);
    tile.bundle = null;
  } else {
    p.backpack.push({ shape:tile.shape, dots:tile.dots, value:tile.value, isBundle:false, bundleValues:null });
    console.log(`[拾取] ${p.name} 拾取${SHAPES[tile.shape].name}, 背包${p.backpack.length}个`);
    toast(`${p.name} 拾取了${SHAPES[tile.shape].name}宝藏`);
  }
  tile.state = 'taken';
  hideModal(); endTurn();
}
// 将背包第 i 个宝藏放置到脚下的 X 标记格（宝藏包格则合并为包）
function doPlace(i){
  const p = state.players[state.currentPlayerIdx];
  const tile = getTile(p.position);
  const t = p.backpack.splice(i,1)[0];
  if(p.position>=32){
    const vals = t.isBundle ? [...t.bundleValues] : [t.value];
    tile.bundle = { values:vals, totalValue:vals.reduce((a,b)=>a+b,0) };
  } else if(t.isBundle){
    tile.bundle = { values:[...t.bundleValues], totalValue:t.value };
  } else {
    tile.shape = t.shape; tile.dots = t.dots; tile.value = t.value; tile.bundle = null;
  }
  tile.state = 'treasure';
  console.log(`[放置] ${p.name} 放置${t.isBundle?'宝藏包':SHAPES[t.shape].name}于格${p.position}, 背包剩${p.backpack.length}个`);
  toast(`${p.name} 放置了${t.isBundle?'宝藏包':SHAPES[t.shape].name+'宝藏'}`);
  hideModal(); endTurn();
}
// 选择不行动，直接结束回合
function doNothing(){
  toast(`${state.players[state.currentPlayerIdx].name} 选择不行动`);
  hideModal(); endTurn();
}

// 结束当前回合：等待 0.5s 让玩家看到结果，然后切换到下一位未返回的玩家；全部返回则结束本轮
function endTurn(){
  setTimeout(()=>{
    const n = state.players.length;
    let next = -1;
    for(let i=1;i<=n;i++){
      const idx = (state.currentPlayerIdx+i)%n;
      if(!state.players[idx].returned){ next = idx; break; }
    }
    if(next===-1){ endRound('allReturned'); return; }
    state.currentPlayerIdx = next;
    startTurn();
  }, 500);
}

/* ================= 轮结束与结算 ================= */

// 结束本轮：已返回玩家结算得分；氧气耗尽时未返回玩家的宝藏打包沉入海底
function endRound(reason){
  const results = [];
  const bundlesCreated = [];
  state.players.forEach((p,idx)=>{
    const items = p.backpack.map(t=>({ shape:t.shape, dots:t.dots, value:t.value, isBundle:t.isBundle, bundleValues:t.bundleValues?[...t.bundleValues]:null }));
    if(p.position===-1){
      const gain = items.reduce((s,t)=>s+t.value,0);
      const before = p.score;
      p.score += gain;
      p.roundScores.push(gain);
      console.log(`[结算] ${p.name}: +${gain} (${before} -> ${p.score})`);
      results.push({ name:p.name, color:PLAYER_COLORS[idx], items, roundScore:gain, totalScore:p.score, returned:true });
      p.backpack = [];
    } else {
      p.roundScores.push(0);
      results.push({ name:p.name, color:PLAYER_COLORS[idx], items, roundScore:0, totalScore:p.score, returned:false });
      if(items.length>0){
        const vals = items.map(t=>t.value);
        const total = vals.reduce((a,b)=>a+b,0);
        state.bundles.push({ shape:null, dots:0, value:0, state:'treasure', bundle:{ values:vals, totalValue:total }, occupant:null });
        state.pendingBundles = (state.pendingBundles ?? 0) + 1;
        bundlesCreated.push({ name:p.name, count:vals.length, totalValue:total });
        console.log(`[宝藏包] ${p.name} 的${vals.length}个宝藏(价值${total})沉入海底`);
        p.backpack = [];
      }
      setOccupant(p.position, null);
      p.position = -1;
    }
  });
  state.roundResults = { reason, results, bundlesCreated };
  state.phase = 'round-end';
  state.turnPhase = 'done';
  saveState(); render();
  setTimeout(showSettlement, 400);
}

// 弹出本轮结算窗口：展示各玩家宝藏分值明细、本轮得分与累计总分
function showSettlement(){
  const rr = state.roundResults;
  const isLast = state.round>=3;
  const rows = rr.results.map(r=>`
    <div class="settle-player">
      <div class="sp-head">
        <span class="sp-name"><span class="dot" style="background:${r.color}"></span>${r.name}${r.returned?'':' <span style="color:var(--danger);font-size:11px">(未返回)</span>'}</span>
        <span class="sp-gain">+${r.roundScore}</span>
      </div>
      <div class="sp-items">
        ${r.items.length? r.items.map(t=>`<span class="sp-item">${t.isBundle?bundleSVG(18):shapeSVG(t.shape,t.dots,18)}<span class="val">${t.value}分</span></span>`).join('') : '<span style="font-size:12px;color:var(--text-dim)">背包为空</span>'}
      </div>
      <div class="sp-total">累计总分：${r.totalScore}</div>
    </div>`).join('');
  const notes = [];
  if(rr.reason==='oxygen') notes.push('⚠ 氧气耗尽！未返回玩家的宝藏已打包沉入海底。');
  rr.bundlesCreated.forEach(b=>notes.push(`🎁 ${b.name} 的 ${b.count} 个宝藏形成宝藏包（价值 ${b.totalValue} 分），位于路径末端。`));
  showModal(`
    <h3>第 ${state.round} 轮结束</h3>
    ${notes.map(n=>`<div class="settle-note">${n}</div>`).join('')}
    ${rows}
    <button class="m-btn go" onclick="nextRound()">${isLast?'查看最终结果':'开始第 '+(state.round+1)+' 轮'}</button>
  `);
}

// 进入下一轮（或第 3 轮结束后进入游戏结束页）：清理 X 标记、重置位置与氧气
function nextRound(){
  hideModal();
  if(state.round>=3){ state.phase='game-over'; saveState(); render(); return; }
  state.path.forEach(t=>{ if(t.state==='taken') t.state='empty'; });
  state.bundles.forEach(t=>{ if(t.state==='taken') t.state='empty'; });

  // 压实：path + bundles 中的非空 tile 按原顺序前移到 path 前段，
  // 避免被拾取格留下空档；bundle 并入 path，不再单独占末尾区域
  const remaining = [
    ...state.path.filter(t => t.state !== 'empty'),
    ...state.bundles.filter(t => t.state !== 'empty'),
  ];
  console.log(`[压实] 剩余 tile: ${remaining.length} 个（path + bundles 合并）`);
  for(let i=0; i<state.path.length; i++){
    if(i < remaining.length){
      state.path[i] = { ...remaining[i], occupant:null, bundle:remaining[i].bundle ?? null };
    } else {
      state.path[i] = { id:i, shape:null, dots:0, value:0, state:'empty', bundle:null, occupant:null };
    }
  }
  state.bundles = [];

  state.players.forEach(p=>{ p.position=-1; p.returned=false; p.choseReturn=false; p.backpack=[]; });
  state.oxygen = 25;
  state.firstPlayerIdx = state.currentPlayerIdx;   // 本轮最后行动者作为下轮初始玩家
  state.round++;
  state.phase = 'playing';
  console.log(`[第${state.round}轮] 初始玩家: ${state.players[state.firstPlayerIdx].name}`);
  toast(`第 ${state.round} 轮开始！${state.players[state.firstPlayerIdx].name} 先行动`);
  startTurn();
}

/* ================= 渲染 ================= */

// 渲染入口：根据状态分发到 落地页 / 游戏结束页 / 游戏主界面
// 重建 #app 前保存玩家条的滚动位置，重建后恢复，避免任何 re-render 都把 scrollLeft 重置为 0
function render(){
  const app = document.getElementById('app');
  if(!state){ app.innerHTML = screen==='setup' ? renderSetup() : renderLanding(); return; }
  if(state.phase==='game-over'){ app.innerHTML = renderGameOver(); return; }
  const oldStrip = document.querySelector('.players-strip');
  const savedLeft = oldStrip ? oldStrip.scrollLeft : 0;
  app.innerHTML = renderGame();
  const newStrip = document.querySelector('.players-strip');
  if(newStrip) newStrip.scrollLeft = savedLeft;
  refreshWaitText();
}

// 渲染落地页（标题 + 开始按钮 + 开发者署名）
function renderLanding(){
  return `<div class="landing">
    <div class="rules-corner"><button onclick="showRules()">📖 规则</button></div>
    <div class="logo-sub">${submarineSVG(110)}</div>
    <h1>海底探险</h1>
    <p class="tagline">2~6人 · 下潜寻宝<br>在氧气耗尽前返回潜水艇！</p>
    <button class="btn-primary" onclick="showSetup()">开始游戏</button>
    <div class="credit">@imStar100</div>
  </div>`;
}

// 从落地页进入玩家设置页
function showSetup(){ state=null; screen='setup'; render(); }
// 渲染玩家设置页：昵称输入 + 玩家标签 + 开始按钮
function renderSetup(){
  return `<div class="setup">
    <h2>添加玩家</h2>
    <p class="hint">2~6 名玩家，输入昵称后添加</p>
    <div class="input-row">
      <input id="name-input" placeholder="玩家昵称" maxlength="8" onkeydown="if(event.key==='Enter')addPlayer()">
      <button onclick="addPlayer()">添加</button>
    </div>
    <div class="chips">${setupNames.map((n,i)=>`
      <span class="chip"><span class="dot" style="background:${PLAYER_COLORS[i]}"></span>${n}<span class="rm" onclick="removePlayer(${i})">✕</span></span>`).join('')}
    </div>
    <button class="btn-primary" style="width:100%" onclick="startGame()" ${setupNames.length<2?'disabled style="width:100%;opacity:.4"':''}>开始探险（${setupNames.length}人）</button>
  </div>`;
}
// 添加一名玩家（最多 6 人）
function addPlayer(){
  const inp = document.getElementById('name-input');
  const name = inp.value.trim();
  if(!name) return;
  if(setupNames.length>=6){ toast('最多6名玩家'); return; }
  setupNames.push(name); inp.value=''; render();
  document.getElementById('name-input').focus();
}
// 移除指定玩家
function removePlayer(i){ setupNames.splice(i,1); render(); }
// 校验人数后开始游戏
function startGame(){
  if(setupNames.length<2) return;
  initGame(setupNames);
}

// 渲染游戏主界面：顶栏 + 玩家条 + 行动模块 + 游戏版图
function renderGame(){
  const p = state.players[state.currentPlayerIdx];
  const low = state.oxygen<=5;
  return `<div class="game">
    <div class="topbar">
      <span class="round-info">第 ${state.round} / 3 轮</span>
      <div class="topbar-btns">
        <button onclick="confirmReset()">🔄 重置</button>
        <button onclick="showRules()">📖 规则</button>
      </div>
    </div>
    ${renderPlayersStrip()}
    ${renderActionModule(p)}
    <div class="board">
      <div class="sub-row">
        ${submarineSVG(52)}
        <div>
          <div class="sub-tokens">
            ${state.players.map((pl,i)=>pl.position===-1?`<span style="width:14px;height:14px;border-radius:50%;background:${PLAYER_COLORS[i]};border:2px solid #fff;display:inline-block"></span>`:'').join('')}
            ${state.players.every(pl=>pl.position!==-1)?'<span class="sub-label">潜水艇上空无一人</span>':''}
          </div>
          <div class="sub-label">潜水艇 · 出发点</div>
        </div>
      </div>
      <div class="oxy-wrap">
        <div class="oxy-head"><span>氧气</span><b class="${low?'low':''}">${state.oxygen} / 25</b></div>
        <div class="oxy-bar">${Array.from({length:25},(_,i)=>`<div class="oxy-cell ${i<state.oxygen?'on':''} ${low&&i<state.oxygen?'low':''}"></div>`).join('')}</div>
      </div>
      ${renderBoardGrid()}
    </div>
  </div>`;
}

// 渲染顶部玩家条：昵称 / 总分 / 背包(只显示正面) / 状态
function renderPlayersStrip(){
  return `<div class="players-strip">${state.players.map((pl,i)=>`
    <div class="p-card ${i===state.currentPlayerIdx&&state.phase==='playing'?'current':''}">
      <div class="p-name"><span class="dot" style="background:${PLAYER_COLORS[i]}"></span>${pl.name}</div>
      <div class="p-score">总分 ${pl.score}</div>
      <div class="p-bag">${pl.backpack.map(t=>t.isBundle?bundleSVG(17):shapeSVG(t.shape,t.dots,17)).join('')||'<span style="font-size:10px;color:var(--text-dim)">空背包</span>'}</div>
      <div class="p-status">${pl.returned?'🏠 已返回':(i===state.currentPlayerIdx?(pl.choseReturn?'⬆ 返舱中':'🎯 行动中'):(pl.choseReturn?'⬆ 等待返舱中':'等待中'))}</div>
    </div>`).join('')}</div>`;
}

// 渲染行动模块：当前玩家 + 骰子 + 步数信息 + 投骰按钮
function renderActionModule(p){
  let body = '';
  if(state.phase!=='playing'){
    body = `<div class="wait-text"><span class="action-link" onclick="showSettlement()">本轮已结束</span></div>`;
  } else if(state.turnPhase==='roll'){
    // 投骰阶段无弹窗，清掉缓存以免后续误弹出过期内容
    _lastModalHTML = '';
    body = `<button class="roll-btn" onclick="rollDice()">🎲 投掷骰子</button>`;
  } else {
    const dirText = p.choseReturn?'（本轮已选择返舱）':'';
    // 根据当前阶段给出带下划线的可点击状态：点击后重新弹出决策弹窗
    const phaseLabel = state.turnPhase==='direction' ? '选择方向'
                     : state.turnPhase==='action'    ? '选择行动'
                     : '操作';
    const actionLink = _lastModalHTML
      ? `<span class="action-link" onclick="reopenModal()">${phaseLabel}</span>`
      : `<span>${phaseLabel}</span>`;
    body = `<div class="wait-text">等待 ${p.name} ${actionLink}… ${dirText}</div>`;
  }
  const stepInfo = state.lastRoll>0 ? `投掷 ${state.dice[0]}+${state.dice[1]}=${state.lastRoll}${p.backpack.length?` − ${p.backpack.length}个宝藏 = 移动 ${state.effectiveSteps} 格`:''}` : '';
  return `<div class="action-mod">
    <div class="turn-label">轮到 <b style="color:${PLAYER_COLORS[state.currentPlayerIdx]}">${p.name}</b> 行动</div>
    <div class="dice-row">${dieSVG(state.dice[0])}${dieSVG(state.dice[1])}</div>
    <div class="step-info">${stepInfo}</div>
    ${body}
  </div>`;
}

// 格子内容：宝藏正面 / X 标记 / 宝藏包（已移除的格子不渲染）
function tileContent(tile){
  if(tile.state==='treasure') return tile.bundle ? bundleSVG('100%') : shapeSVG(tile.shape, tile.dots, '100%');
  if(tile.state==='taken') return xMarkSVG('100%');
  return '';
}
// 将十六进制颜色按比例变暗
function darken(hex, f=0.55){
  const r = Math.round(parseInt(hex.slice(1,3),16)*f);
  const g = Math.round(parseInt(hex.slice(3,5),16)*f);
  const b = Math.round(parseInt(hex.slice(5,7),16)*f);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
// 人形 token SVG（可复用）
const TOKEN_PATH = 'M539 290.8c-19 0-37-3.8-54-11.2-17-7.4-31.8-17.4-44.2-30-12.6-12.6-22.4-27.2-30-44.2-7.4-17-11.2-35-11.2-54s3.8-37 11.2-54c7.4-17 17.4-31.8 30-44.2s27.2-22.4 44.2-30C502 15.8 520 12 539 12s37 3.8 54 11.2c17 7.4 31.8 17.4 44.2 30 12.6 12.6 22.4 27.2 29.4 44.2 7.2 17 10.8 35 10.8 54s-3.6 37-10.8 54c-7.2 17-17 31.8-29.4 44.2-12.6 12.6-27.2 22.4-44.2 30-16.8 7.4-34.8 11.2-54 11.2z m198.4 125.2c16 12 29.4 25.8 39.8 41.6s15.6 31.8 15.6 47.8v88.4c0 10.2-5.8 17.8-17.4 23.2-11.6 5.4-24.4 8-38.4 8s-26.8-2.6-38.4-7.6c-11.6-5-17.4-13.2-17.4-24.6v-37.6c0-9-2.6-15.6-8-20.2-5.4-4.4-10.8-8.2-16-11.2-6-3-12.8-1.6-20.6 4-7.8 5.6-11.6 15.4-11.6 29v236c0 14.2 4.8 27.4 14.2 39.4s21.2 23 34.8 33c12 8.4 22 16.6 30.4 25l29.4 29.4c3.6 3.6 5 9 4 16.6-0.8 7.4-3.4 15.4-7.6 23.6-4.2 8.4-9.4 16.6-15.6 25-6.2 8.4-13.2 14.8-21 19.6-7.8 4.8-15.6 7.2-23.6 7.2-8 0-15.6-3.8-22.8-11.6-10.8-11.4-19.4-20.4-26-27.2-6.6-6.8-12.4-13-17.4-18.4-5-5.4-10.2-10.4-15.6-15.2-5.4-4.8-12-11.4-19.6-19.6-15.4-15.4-28.8-35.2-39.8-59.4s-16.6-48.2-16.6-72v-72.4c-7.2 9-13.2 16-18.4 21.4-5 5.4-10.8 14.2-17.4 26.8-2.4 4.8-4.8 11-7.2 18.8-2.4 7.8-4.6 15.8-6.8 24.2s-3.8 16.6-5 25c-1.2 8.4-1.8 15.4-1.8 21.4V928c0 11.4-5.8 19.8-17.4 25.4-11.6 5.6-24.4 8.4-38.4 8-14-0.2-26.8-3.6-38.4-9.8s-17.4-15.6-17.4-28.2v-65.2c0-23.2 3.6-43.8 10.8-61.6 7.2-17.8 15.2-37 24.2-57.2 12-27.4 20.8-49.4 26.4-66.2 5.6-16.6 10-28.2 13-34.8 6-13.8 9-26 9-36.6v-28.6c-6.6 4.2-12 8-16.6 11.6-4.4 3.6-10.6 10.2-18.4 19.6-7.8 9-15.6 14.8-23.6 17.4-8 2.6-20.8 4-38 4h-58c-14.2 0-24.8-5.8-31.8-17.4-6.8-11.6-10.2-24.2-9.8-38s4-26.4 11.2-38c7.2-11.6 17.6-17.4 31.2-17.4h53.6c7.2 0 13-0.8 17.4-2.6 4.4-1.8 8.6-4.4 12.6-8 3.8-3.6 8-7.8 12.6-12.6 4.4-4.8 10-10.2 16.6-16 8.4-7.2 16.8-17.8 25.4-31.8 8.6-14 16.8-28.2 24.6-42.4 9-16.6 17.6-34.6 26-53.6 12.6 0.6 24.2 1.2 34.8 1.8 9.6 0.6 19.2 1 29 1.4 9.8 0.2 18 0.4 24.6 0.4 6.6 0 14-0.2 22.4-0.4 8.4-0.2 16.4-0.8 24.2-1.4 9-0.6 18.2-1.2 27.8-1.8 16 10.2 31.6 19.4 46.4 27.8 12.6 7.8 25 15.2 37.6 22.4 12.2 7 21.6 13 28.2 17.8z';
function tokenSVG(c){
  return `<svg viewBox="0 0 1024 1024"><path fill="${c}" stroke="${darken(c)}" stroke-width="24" d="${TOKEN_PATH}"/></svg>`;
}
// 格子上的玩家标记
function tokenHTML(tile){
  if(tile.occupant===null) return '';
  return tokenSVG(PLAYER_COLORS[tile.occupant]).replace('<svg ', '<svg class="token" ');
}
// 当前行动玩家所在格的高亮类
function hereClass(tile, pos){
  const cur = state.players[state.currentPlayerIdx];
  return (cur && cur.position===pos && state.phase==='playing') ? 'here' : '';
}

// 渲染 S 形倾斜路径（含宝藏包行）：统一用 tilePos 绝对定位到 .path-board
// idx 0..31 = 普通路径格；idx 32+ = 宝藏包格（state.bundles[idx-32]）
// 本轮刚生成的"待渲染"bundle 存在 state.bundles 末尾，下一轮开始前不参与渲染
function renderBoardGrid(){
  let cells = '';
  const visibleBundles = state.bundles.length - (state.pendingBundles ?? 0);
  const total = 32 + visibleBundles;
  for(let idx=0; idx<total; idx++){
    const tile = idx < 32 ? state.path[idx] : state.bundles[idx-32];
    if(tile.state==='empty') continue;
    const {x,y} = tilePos(idx);
    cells += `<div class="tile abs ${hereClass(tile,idx)}" style="left:${x-S/2}%;top:${(y-S/2)/BOARD_H*100}%;width:${S}%">${tileContent(tile)}${tokenHTML(tile)}</div>`;
  }
  return `<div class="path-board">${cells}</div>`;
}

// 渲染游戏结束页：按总分排名的积分榜单（含各轮得分）
function renderGameOver(){
  const sorted = state.players.map((p,i)=>({...p, color:PLAYER_COLORS[i]})).sort((a,b)=>b.score-a.score);
  const medals = ['🥇','🥈','🥉'];
  return `<div class="gameover">
    <div>${submarineSVG(80)}</div>
    <h2>探险结束</h2>
    <table class="rank-table">
      <tr><th>排名</th><th>玩家</th><th>R1</th><th>R2</th><th>R3</th><th>总分</th></tr>
      ${sorted.map((p,i)=>`<tr class="${i===0?'first':''}">
        <td class="rank-medal">${medals[i]||''}</td>
        <td><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:5px"></span>${p.name}</td>
        <td>${p.roundScores[0]??0}</td><td>${p.roundScores[1]??0}</td><td>${p.roundScores[2]??0}</td>
        <td class="total">${p.score}</td>
      </tr>`).join('')}
    </table>
    <button class="btn-primary" style="width:100%;margin-bottom:12px" onclick="playAgain()">再来一局</button>
    <button class="btn-secondary" style="width:100%" onclick="backHome()">返回首页</button>
  </div>`;
}
// 游戏结束后再来一局：清档并回到玩家设置页（保留上局昵称，便于快速开局）
function playAgain(){ clearState(); state=null; showSetup(); }
// 游戏结束后返回首页
function backHome(){ clearState(); setupNames=[]; state=null; screen='landing'; render(); }
// 弹出游戏规则弹窗
function showRules(){
  showModal(`<h3>📖 游戏规则</h3>
    <div class="rules-body">
      <h3>🎯 目标</h3>
      <p>3轮制海底寻宝，在氧气耗尽前拾取宝藏并安全返回潜水艇，累计最高分获胜。</p>
      <h3>🧩 组件</h3>
      <ul>
        <li>2个骰子（面 1/2/3，点数 2~6）</li>
        <li>32枚宝藏：三角(0~3分)、四角(4~7分)、五角(8~11分)、六角(12~15分) 各8枚</li>
        <li>25格共享氧气条</li>
      </ul>
      <h3>🔄 回合流程</h3>
      <ul>
        <li><b>氧气消耗</b>：持有N个宝藏 → 消耗N点氧气</li>
        <li><b>投骰</b>：掷2个骰子得到点数</li>
        <li><b>选方向</b>：下潜（前进）或返舱（后退）</li>
        <li><b>移动</b>：有效步数 = 骰子点数 − 持有宝藏数（≥0），跳过已有人的格</li>
        <li><b>行动</b>：拾取脚下宝藏/宝藏包，或在X标记格放置背包中的宝藏</li>
      </ul>
      <h3>⚠️ 返舱规则</h3>
      <ul>
        <li>每轮每位玩家只能选择一次"返舱"，选定后本轮后续回合默认返舱</li>
        <li>返回潜水艇后结算背包宝藏得分，清空背包</li>
      </ul>
      <h3>📦 一轮结束</h3>
      <ul>
        <li>所有玩家返回潜水艇 → 正常结算</li>
        <li>氧气耗尽 → 已返回的玩家正常结算，未返回的玩家宝藏打包为<b>宝藏包</b>沉入海底</li>
        <li>宝藏包视为1个宝藏，分值为内含宝藏分值之和</li>
      </ul>
      <h3>🏆 计分</h3>
      <p>3轮结束后，按累计总分排名。每轮得分 = 返回潜水艇时背包中所有宝藏的分值之和。</p>
    </div>
    <button class="m-btn go" onclick="hideModal()">知道了</button>`);
}
// 弹出重置确认窗口
function confirmReset(){
  showModal(`<h3>重新开始？</h3><p class="m-desc">将清除当前游戏进度</p>
    <button class="m-btn warn" onclick="doReset()">确认重置</button>
    <button class="m-btn ghost" onclick="hideModal()">取消</button>`);
}
// 确认重置：清档并回到玩家设置页
function doReset(){ hideModal(); clearState(); setupNames=[]; state=null; showSetup(); }

/* ================= 启动 ================= */

// 应用启动：有存档则恢复游戏（并补开对应弹窗），否则显示落地页
function boot(){
  initModalOverlay();
  const saved = loadState();
  if(saved){
    state = saved;
    render();
    if(state.phase==='round-end'){ setTimeout(showSettlement, 300); }
    else if(state.phase==='playing' && state.turnPhase==='direction'){ setTimeout(openDirectionModal, 300); }
    else if(state.phase==='playing' && state.turnPhase==='action'){ setTimeout(openActionModal, 300); }
  } else {
    state = null;
    render();
  }
}
document.addEventListener('DOMContentLoaded', boot);
