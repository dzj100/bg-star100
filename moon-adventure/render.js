/**
 * 月面探险 (Moon Adventure) - 渲染模块
 * 
 * 负责：所有UI渲染函数
 * 依赖：game.js（状态 S 和游戏逻辑函数）
 */

// ========================================
// 主渲染入口
// ========================================

/** 主渲染函数，根据游戏阶段分发渲染 */
function render() {
  const app = document.getElementById('app');

  // 捕获旧 dice-area 高度
  const oldDice = app.querySelector('.dice-area');
  const oldH = oldDice ? oldDice.offsetHeight : null;

  if (S.phase === 'landing') {
    app.innerHTML = renderLanding();
  } else if (S.phase === 'setup') {
    app.innerHTML = renderSetup();
  } else {
    app.innerHTML = renderGame();
  }

  // 动画过渡 dice-area 高度
  const newDice = app.querySelector('.dice-area');
  if (newDice && oldH !== null) {
    const newH = newDice.scrollHeight;
    if (Math.abs(oldH - newH) > 2) {
      newDice.style.height = oldH + 'px';
      requestAnimationFrame(() => {
        newDice.style.height = newH + 'px';
        newDice.addEventListener('transitionend', () => {
          newDice.style.height = '';
        }, { once: true });
      });
    }
  }

  // 玩家条吸顶缩小监听（render重建DOM后重新绑定）
  observePlayerStrip();

  // 悬浮窗保持打开时按新按钮位置重新摆放
  if (moreOpen) positionMoreSheet();
}

// ========================================
// 玩家条吸顶无极缩小（滚动驱动）
// ========================================

let psScrollHandler = null;

/** 玩家条吸顶后随下滑距离连续缩小至50%（左上角），回滚恢复 */
function observePlayerStrip() {
  if (psScrollHandler) {
    window.removeEventListener('scroll', psScrollHandler);
    psScrollHandler = null;
  }
  const oldSentinel = document.getElementById('ps-sentinel');
  if (oldSentinel) oldSentinel.remove();

  const strip = document.querySelector('.player-strip');
  if (!strip) return;

  // 哨兵：贴在玩家条正上方（不吸顶），其视口位置反映玩家条文档位置
  const sentinel = document.createElement('div');
  sentinel.id = 'ps-sentinel';
  sentinel.style.cssText = 'position:absolute;left:0;width:1px;height:1px;pointer-events:none;';
  strip.parentElement.insertBefore(sentinel, strip);

  function update() {
    const range = Math.max(150, window.innerHeight * 0.25);
    // 吸顶点：哨兵顶部距视口顶8px（与sticky top一致）
    const p = Math.min(1, Math.max(0, (8 - sentinel.getBoundingClientRect().top) / range));
    strip.style.transformOrigin = 'top left';
    strip.style.transform = `scale(${1 - 0.5 * p})`;
    strip.style.opacity = 1 - 0.5 * p;
    strip.style.boxShadow = `0 4px 10px rgba(0,0,0,.35))`;
  }

  update();
  psScrollHandler = update;
  window.addEventListener('scroll', update, { passive: true });
}

// ========================================
// 着陆页（选择人数）
// ========================================

/** 渲染着陆页 */
function renderLanding() {
  return `
    <div class="landing">
      <div class="rules-corner"><button onclick="showRules()">📖 规则</button></div>
      <span class="moon-icon">🌕️</span>
      <h1>月面探险</h1>
      <p class="subtitle">Moon Adventure</p>
      <button class="start-btn" onclick="showSetup()">🚀 开始游戏</button>
      <div class="credit">@imStar100</div>
    </div>`;
}

// ========================================
// 设置页（玩家昵称）
// ========================================

/** 渲染玩家设置页面 */
function renderSetup() {
  const chips = setupNames.map((n, i) =>
    `<span class="setup-chip">
      <span class="setup-dot" style="background:${PLAYER_COLORS[i]}"></span>
      ${n}
      <span class="setup-rm" onclick="removePlayer(${i})">✕</span>
    </span>`
  ).join('');

  return `
    <div class="setup">
      <div class="setup-header">
        <h1>🌕️ 月面探险</h1>
        <button class="back-btn" onclick="showLanding()">← 返回</button>
      </div>
      <h2>添加玩家</h2>
      <p class="setup-hint">2~5 名玩家，输入昵称后添加</p>
      <div class="setup-input-row">
        <input id="name-input" placeholder="玩家昵称" maxlength="8"
          onkeydown="if(event.key==='Enter')addPlayer()">
        <button onclick="addPlayer()">添加</button>
      </div>
      <div class="setup-chips">${chips}</div>
      <button class="btn-full btn-primary" onclick="startGame()"
        ${setupNames.length < 2 ? 'disabled style="opacity:.4"' : ''}>
        开始探险（${setupNames.length}人）
      </button>
    </div>`;
}

/** 从设置页返回着陆页 */
function showLanding() {
  S.phase = 'landing';
  render();
}

/** 开始游戏（从设置页） */
function startGame() {
  if (setupNames.length < 2) return;
  dealGame([...setupNames]);
  render();
}

// ========================================
// 游戏主界面
// ========================================

/** 渲染游戏主界面 */
function renderGame() {
  let h = '';

  // 游戏标题栏
  h += renderHeader();

  // 统计面板
  h += renderStatsPanel();  

  // 玩家列表
  h += renderPlayerStrip();
  
  // 胜利/失败横幅
  if (S.gameOver) {
    h += renderEndBanner();
  }

  // 骰子/行动区域（游戏结束后隐藏）
  if (!S.gameOver) {
    h += renderDiceArea();
  }

  // 月面地图
  h += renderBoard();

  return h;
}

// ========================================
// 标题栏
// ========================================

function renderHeader() {
  return `
    <div class="game-header">
      <h2>🌕️ 月面探险</h2>
      <div style="display:flex;gap:6px">
        <button class="icon-btn" onclick="resetGame()">🔄 重置</button>
        <button class="icon-btn" onclick="showRules()">📖 规则</button>
      </div>
    </div>`;
}

// ========================================
// 胜利/失败横幅
// ========================================

function renderEndBanner() {
  if (S.gameResult === 'win') {
    const { total } = countIntactSupplies();
    const target = WIN_CONDITIONS[S.playerCount];
    return `
      <div class="victory-banner">
        <h2>🎉 任务成功！</h2>
        <p>完好物资 ${total} 个 ≥ 目标 ${target} 个</p>
      </div>`;
  } else {
    return `
      <div class="failure-banner">
        <h2>💀 任务失败</h2>
        <p>完好物资不足或氧气耗尽</p>
      </div>`;
  }
}

// ========================================
// 玩家列表条（顶部）
// ========================================

/** 渲染顶部玩家列表条 */
function renderPlayerStrip() {
  const playerItems = S.players.map((p, i) => {
    const isActive = i === S.currentPlayer;
    const slotsHtml = renderSlotBar(p);
    return `
      <div class="ps-player ${isActive ? 'active' : ''} ${p.returned ? 'returned' : ''}"
           onclick="showPlayerDetail(${i})">
        <div class="ps-color" style="background:${p.color}"></div>
        <span class="ps-name">${p.name}</span>
        <span class="ps-role"><!--${p.role.icon} -->${p.role.name}</span>
        <div class="ps-slots">${slotsHtml}</div>
      </div>`;
  }).join('');

  return `
    <div class="player-strip">
      <div class="player-strip-title">
        👥 玩家列表 · 当前回合: 
        <strong style="color:${currentPlayer().color}">${currentPlayer().name}</strong>
        ${currentPlayer().returned ? ' (已返回基地)' : ''}
      </div>
      ${playerItems}
    </div>`;
}

/** 根据物资的区域生成对应的 SVG 形状图标 */
function supplyIcon(supply, size, colorOverride) {
  const z = ZONES.find(zone => zone.id === supply.zone);
  if (!z) return '?';
  const fill = colorOverride || z.fill;
  const stroke = colorOverride ? colorOverride : darken(z.color);
  return shapeSVG(z.shape, fill, stroke);
}

/** 渲染单个玩家的存储槽指示器 */
function renderSlotBar(player) {
  let h = '';
  for (let i = 0; i < player.slots; i++) {
    if (i < player.oxygen.length) {
      h += '<div class="ps-slot filled-o2">O</div>';
    } else if (i < player.oxygen.length + player.supplies.length) {
      const sup = player.supplies[i - player.oxygen.length];
      const color = S.gameOver ? (sup.intact ? '#4caf50' : '#f44336') : undefined;
      h += `<div class="ps-slot filled-sup">${supplyIcon(sup, 14, color)}</div>`;
    } else {
      h += '<div class="ps-slot empty"></div>';
    }
  }
  return h;
}

// ========================================
// 骰子/行动区域（中部）
// ========================================

/** 渲染骰子和行动面板 */
function renderDiceArea() {
  const p = currentPlayer();
  let h = '<div class="dice-area">';
  h += `<h3><span style="color:${p.color}">●</span> ${p.name} 的回合</h3>`;

  if (p.returned) {
    // 已返回基地，跳过
    h += `<p class="dice-prompt">${p.name} 已返回基地，跳过回合</p>`;
    h += `<button class="act-btn btn-end" style="width:100%;margin-top:8px" onclick="endTurn()">下一位玩家</button>`;
  } else if (p.oxygen.length === 0 && S.turnPhase === 'idle' && !S.isRescue) {
    // 无氧气，等待救援面板
    h += `<p class="dice-prompt text-danger">⚠ 氧气耗尽！等待 <span class="rescue-link" onclick="showRescueSelect()">紧急救援</span> ...</p>`;
  } else if (S.turnPhase === 'idle') {
    // 等待打出氧气卡
    // 工程师：移动机器人（掷骰前可选）
    if (p.role.id === 'engineer' && !S.robotMoved) {
      h += `<button class="act-btn btn-robot" style="width:100%;margin-bottom:8px;background:linear-gradient(135deg,#1b5e20,#2e7d32);border:2px solid #4caf50"
        onclick="openRobotMoveSheet()">
        🤖 移动机器人 <span class="cost">免费</span></button>`;
    }
    h += `<p class="dice-prompt">选择一张氧气卡打出</p>`;
    h += '<div class="dice-o2-select">';
    p.oxygen.forEach((c, i) => {
      h += `<div class="dice-o2-card ${c.val === 3 ? 'val3' : 'val2'}"
             onclick="discardOxygen(${i})">O₂ ×${c.val}</div>`;
    });
    h += '</div>';
    if (p.oxygen.length === 0) {
      h += '<p class="dice-prompt text-danger">⚠ 无氧气卡！检查失败条件</p>';
      h += `<button class="act-btn btn-end" style="width:100%;margin-top:8px" onclick="endTurn()">结束回合</button>`;
    }
  } else if (S.turnPhase === 'spent' && !S.isDrawing) {
    // 已掷骰子，显示结果和行动按钮
    h += renderDiceResult();
    h += renderActionPanel();
  }

  // OGS抽取状态
  if (S.isDrawing) {
    h += renderOGSDrawArea();
  }

  h += '</div>';
  return h;
}

/** 渲染骰子结果 */
function dieSVG(val) {
  if (!val) return '<div class="die blank"></div>';
  const pips = {
    1: [[50, 50]],
    2: [[30, 30], [70, 70]],
    3: [[28, 28], [50, 50], [72, 72]],
  }[val] || [];
  return `<div class="die">${pips.map(([x, y]) => `<span class="pip" style="left:${x}%;top:${y}%"></span>`).join('')}</div>`;
}

function renderDiceResult() {
  const diceHtml = S.dice.map(d => dieSVG(d)).join('');
  const p = currentPlayer();
  const hasBonus = p.role.id === 'atmosphere' && S.ap > S.dice.reduce((a, b) => a + b, 0);

  return `
    <div class="dice-row">${diceHtml}</div>
    <!-- <div class="dice-total">行动点: ${S.diceTotal} AP</div> -->
    ${hasBonus ? '<div class="dice-bonus">🎉 气氛组加成 +3 !</div>' : ''}
    <div class="ap-display">剩余 AP: <strong>${S.ap}</strong></div>`;
}

// ========================================
// 行动按钮面板
// ========================================

/** 渲染行动按钮 */
function renderActionPanel() {
  const p = currentPlayer();
  const onRover = p.onRover;
  const targets = getMoveTargets(p.pos);
  const ogsGap = getPlayerOGS();
  const adj = getAdjacentTiles(p.pos);

  let h = '<div class="action-panel"><div class="action-btns">';

  // 后退
  const canBack = S.ap >= 1 && p.pos >= 0;
  h += `<button class="act-btn" ${canBack ? '' : 'disabled'}
    onclick="hideMoreSheet();moveStep('backward')">
    ⬆️ 后退 <span class="cost">1AP</span></button>`;

  // 更多（悬浮窗开关）
  h += `<button class="act-btn${moreOpen ? ' active' : ''}" id="moreBtn" onclick="toggleMoreSheet()">
    ⋯ 更多 <span class="cost">▾</span></button>`;

  // 前进
  const stepLabel = onRover ? '2步' : '';
  h += `<button class="act-btn" ${S.ap >= 1 && targets.forward >= 0 ? '' : 'disabled'}
    onclick="hideMoreSheet();moveStep('forward')">
    ⬇️ 前进${stepLabel} <span class="cost">1AP</span></button>`;

  // 结束回合
  h += `<button class="act-btn btn-end" onclick="hideMoreSheet();endTurn()">
    ✅ 结束回合</button>`;

  h += '</div>';

  // ===== 更多悬浮窗（低频行动，一行一个）=====
  h += `<div class="more-sheet" id="moreSheet" style="display:${moreOpen ? 'block' : 'none'}">`;

  if (!onRover) {
    // 物资回收（仅非月球车状态）
    const collectCost = p.role.id === 'veteran' ? 2 : 3;
    const canCollect = S.ap >= collectCost && freeSlots(p) > 0 &&
      adj.some(t => !S.tiles[t].picked && !S.accelMarks.includes(tilePathIdx(t)) &&
        !S.players.some(pl => pathToTileIdx(pl.pos) === t && !pl.returned) &&
        !(S.hasEngineer && pathToTileIdx(S.robotPos) === t));
    h += `<button class="act-btn" ${canCollect ? '' : 'disabled'}
      onclick="openCollectSheet()">
      📦 物资回收 <span class="cost">${collectCost}AP</span></button>`;

    // 放置加速标记（前/后的板块、损毁OGS或丢弃物资上）
    const accelCost = (p.role.id === 'inventor' && !S.accelPlacedThisTurn) ? 1 : 2;
    const accelSeq = S.path;
    const canPlaceFwd = p.pos + 1 < accelSeq.length &&
      !S.accelMarks.includes(p.pos + 1) &&
      (isPathTile(p.pos + 1) || (isPathOGS(p.pos + 1) && !S.path[p.pos + 1].active) ||
        isPathDiscarded(p.pos + 1));
    const canPlaceBwd = p.pos - 1 >= 0 &&
      !S.accelMarks.includes(p.pos - 1) &&
      (isPathTile(p.pos - 1) || (isPathOGS(p.pos - 1) && !S.path[p.pos - 1].active) ||
        isPathDiscarded(p.pos - 1));
    const canAccel = S.ap >= accelCost && !p.onRover && (canPlaceFwd || canPlaceBwd);
    h += `<button class="act-btn" ${canAccel ? '' : 'disabled'}
      onclick="placeAccelMark()">
      ⚡ 加速标记 <span class="cost">${accelCost}AP</span></button>`;

    // 建立OGS（必须在板块、损毁OGS芯片或丢弃物资上）
    const playerTile = pathToTileIdx(p.pos);
    const onOGS = playerTile === null && isPathOGS(p.pos);
    const onDiscarded = playerTile === null && isPathDiscarded(p.pos);
    const canOGS = S.ap >= 3 && (playerTile !== null || onOGS || onDiscarded) && S.ogsCount < 5;
    h += `<button class="act-btn" ${canOGS ? '' : 'disabled'}
      onclick="openOGSSheet()">
      🔵 建立OGS <span class="cost">3AP</span></button>`;
  }

  // 共享物资
  const adjSeq = getAdjacentSeqPositions(p.pos);
  const adjPlayers = S.players.filter((other, i) => {
    if (i === S.currentPlayer || other.returned) return false;
    if (p.pos >= 0 && other.pos === p.pos) return true;
    return adjSeq.includes(other.pos);
  });
  const canShare = S.ap >= 1 && adjPlayers.length > 0;
  h += `<button class="act-btn" ${canShare ? '' : 'disabled'}
    onclick="openShareSelectSheet()">
    🤝 共享 <span class="cost">1AP</span></button>`;

  // 丢弃物资
  const canDiscard = S.ap >= 1 && p.supplies.length > 0 && p.pos >= 0;
  h += `<button class="act-btn" ${canDiscard ? '' : 'disabled'}
    onclick="openDiscardSheet()">
    🗑️ 丢弃物资 <span class="cost">1AP</span></button>`;

  // OGS补给（始终展示，仅条件满足时可点击）
  const canOGS = ogsGap !== null && !S.isDrawing && freeSlots(p) > 0;
  h += `<button class="act-btn btn-ogs" ${canOGS ? '' : 'disabled'}
    onclick="tryOGSDraw()">
    🫧 OGS补给</button>`;

  h += '</div></div>';
  return h;
}

/** 更多悬浮窗是否打开（render重建后保持状态） */
let moreOpen = false;

/** 按更多按钮当前位置摆放悬浮窗（fixed跟随按钮，随滚动更新） */
function positionMoreSheet() {
  const sheet = document.getElementById('moreSheet');
  const btn = document.getElementById('moreBtn');
  if (!sheet || !btn) return;
  const rect = btn.getBoundingClientRect();
  sheet.style.position = 'fixed';
  sheet.style.top = rect.bottom + 'px';
  sheet.style.left = rect.left + 'px';
  sheet.style.width = rect.width + 'px';
  sheet.style.display = 'flex';
  btn.classList.add('active');
}

/** 切换更多悬浮窗显隐 */
function toggleMoreSheet() {
  moreOpen = !moreOpen;
  if (moreOpen) {
    positionMoreSheet();
  } else {
    hideMoreSheet();
  }
}

/** 收起更多悬浮窗 */
function hideMoreSheet() {
  moreOpen = false;
  const sheet = document.getElementById('moreSheet');
  if (sheet) sheet.style.display = 'none';
  const btn = document.getElementById('moreBtn');
  if (btn) btn.classList.remove('active');
}

// 点击面板外任意处收起悬浮窗
document.addEventListener('click', (e) => {
  if (!e.target.closest('.action-panel')) hideMoreSheet();
});

// 滚动时悬浮窗跟随更多按钮移动
window.addEventListener('scroll', () => {
  if (moreOpen) positionMoreSheet();
}, { passive: true });

// ========================================
// OGS 抽取状态
// ========================================

/** 渲染OGS抽取中的状态 */
function renderOGSDrawArea() {
  const p = currentPlayer();
  const drawn = S.drawnThisTurn;
  const last = drawn[drawn.length - 1];
  const totalOxygen = p.oxygen.length + drawn.length;
  const canContinue = totalOxygen < p.slots &&
    (S.drawPile.length > 0 || S.discardPile.some(c => c.type === 'o2'));

  if (!last) return '';

  return `
    <div class="ogs-draw-area o2-draw">
      <div class="big-icon">🫧</div>
      <div class="card-label">O₂ ×${last.val}</div>
      <div class="card-sub">（放入存储槽后，存储槽使用 ${totalOxygen}/${p.slots}）</div>
      <div class="ogs-draw-btns">
        <button class="btn-keep" ${canContinue ? '' : 'disabled'} onclick="drawFromOGS()">
          ${canContinue ? '继续抽取' : '已满'}</button>
        <button class="btn-stop" onclick="confirmOGSDraw()">确认收取</button>
      </div>
    </div>`;
}

// ========================================
// 月面地图
// ========================================

/** 玩家站位标记：骑车的玩家显示"人+车"组合，其余仅显示token */
function playerTokenHTML(p) {
  if (p.onRover) {
    // 已驾驶：玩家token在上，月球车SVG在下，等比例缩小至80%
    return `<div class="rover-combo">
      <div class="rover-combo-token">${tokenSVG(p.color)}</div>
      <div class="rover-combo-icon">${roverSVG(p.color)}</div>
    </div>`;
  }
  return `<div class="tile-tokens">${tokenSVG(p.color)}</div>`;
}

/** 渲染月面地图（路径序列方案：物资+OGS交错排列，每行7个元素） */
function renderBoard() {
  let h = '<div class="board-wrap">';

  // 动态板高度（基于实际行数）
  const numRows = Math.ceil(S.path.length / COLS);
  const boardH = BOARD.y0 + (numRows - 1) * (BOARD.maxTilt + BOARD.rowGap) + BOARD.tileW + 3;

  // 板块索引 → 路径位置映射
  const tileSeqPos = {};
  S.path.forEach((el, pathIdx) => {
    if (el.type === 'tile') tileSeqPos[el.tileIdx] = pathIdx;
  });

  // 基地标记 + 玩家token + 标题（水平一行）
  const basePlayers = S.players.filter(p => p.pos === -1);
  h += `<div class="base-marker">
      <svg class="base-icon" viewBox="0 0 800 800"><g transform="translate(175.137577,623.832200) scale(0.057655,-0.057655)" fill="currentColor" stroke="none"><path d="M2392 7363 c-36 -52 -317 -650 -458 -976 -190 -436 -375 -962 -497 -1407 -88 -318 -194 -809 -232 -1070 -3 -25 -13 -88 -21 -140 -69 -455 -106 -909 -120 -1491 l-7 -277 -125 -118 c-204 -193 -338 -368 -451 -589 -130 -254 -201 -510 -219 -790 -4 -64 -5 -118 -3 -121 2 -2 141 -4 307 -4 l303 0 61 53 c265 226 421 328 630 412 110 44 328 110 336 102 3 -3 9 -76 15 -163 11 -187 26 -345 34 -367 4 -8 15 -17 27 -20 11 -3 219 -3 464 0 l444 6 6 36 c3 20 7 47 10 61 2 14 11 121 19 239 8 118 17 216 18 217 4 4 181 -49 263 -79 227 -82 452 -220 665 -409 l66 -58 640 0 c352 0 883 3 1181 7 l542 6 0 238 c0 203 2 240 16 253 13 13 45 16 199 16 172 0 185 -1 195 -19 6 -12 10 -112 10 -255 l0 -236 345 0 346 0 19 44 c77 181 122 416 122 641 1 421 -148 781 -447 1080 -104 105 -177 162 -292 231 -46 27 -83 52 -83 55 0 3 23 9 51 12 103 12 219 89 219 144 0 20 -37 64 -165 193 -91 92 -165 170 -165 174 0 19 201 200 253 228 32 17 67 44 78 59 43 61 33 136 -27 189 -28 24 -44 30 -81 30 -79 0 -130 -44 -153 -131 -9 -36 -29 -61 -106 -137 -52 -50 -98 -92 -102 -92 -4 0 -83 75 -175 165 -196 192 -203 195 -261 119 -79 -103 -117 -220 -117 -359 -1 -149 37 -260 126 -369 25 -31 45 -57 45 -58 0 -2 -82 -3 -183 -4 -157 0 -199 -4 -308 -27 -567 -120 -1000 -495 -1173 -1017 -38 -114 -65 -237 -67 -297 -2 -91 -11 -90 -60 5 -102 197 -285 435 -445 579 -43 39 -93 84 -111 100 l-31 28 -11 420 c-17 643 -48 993 -137 1530 -58 353 -178 884 -265 1170 -188 615 -359 1064 -632 1656 -144 311 -283 596 -295 603 -6 3 -19 -6 -30 -21z m181 -4016 c79 -36 128 -77 170 -140 108 -162 83 -369 -60 -497 -204 -181 -532 -107 -637 145 -36 86 -29 220 16 309 24 48 99 129 145 157 105 65 258 76 366 26z"/></g></svg>
      ${basePlayers.length ? `<div class="base-tokens">${basePlayers.map(p =>
        `<span class="base-token${p.returned ? ' returned' : ''}" title="${p.name}${p.returned ? '（已返回基地）' : ''}">${tokenSVG(p.color)}</span>`
      ).join('')}</div>` : ''}
    <span class="base-title">月面地图</span>
  </div>`;

  h += `<div class="path-board" style="aspect-ratio:100/${boardH.toFixed(1)}">`;

  // 渲染路径中的每个元素
  S.path.forEach((el, pathIdx) => {
    const { x, y } = tilePos(pathIdx);
    const left = (x - BOARD.tileW / 2).toFixed(1);
    const top = ((y - BOARD.tileW / 2) / boardH * 100).toFixed(1);
    const cp = currentPlayer();
    const isCurrentPos = cp && cp.pos === pathIdx && !cp.returned;
    // 第一/三/五行（奇数行）角色token垂直翻转
    const flipTok = Math.floor(pathIdx / COLS) % 2 === 0;

    if (el.type === 'tile') {
      const tile = S.tiles[el.tileIdx];

      if (tile.isRover) {
        const hasAccel = S.accelMarks.includes(pathIdx);
        h += `<div class="tile tile-rover${hasAccel ? ' accel' : ''}${isCurrentPos ? ' current-pos' : ''}${flipTok ? ' flip-tok' : ''}"
               style="left:${left}%;top:${top}%;width:${BOARD.tileW}%"
               onclick="onTileClick(${el.tileIdx})">`;
        if (S.accelMarks.includes(pathIdx)) h += '<div class="accel-mark">⚡</div>';

        if (!S.roverUsed) {
          // 未驾驶：显示大号月球车SVG
          h += `<div class="rover-icon-big">${roverSVG('#6C7A81')}</div>`;
        } else {
          S.players.forEach((p, pi) => {
            if (p.pos === pathIdx && !p.returned) {
              h += playerTokenHTML(p);
            }
          });
        }
        h += '</div>';
      } else {
        const zone = ZONES[tile.zone - 1];
        const BACK_COLORS = { triangle: '#928694', square: '#796f7b', pentagon: '#564e55' };
        const backColor = BACK_COLORS[tile.shape] || zone.color;
        const fill = tile.picked ? 'rgba(255,255,255,.05)' : backColor;
        const stroke = tile.picked ? 'rgba(255,255,255,.1)' : backColor;
        const hasAccel = S.accelMarks.includes(pathIdx);

        h += `<div class="tile ${tile.picked ? 'picked' : ''}${hasAccel ? ' accel' : ''}${isCurrentPos ? ' current-pos' : ''}${flipTok ? ' flip-tok' : ''}"
               style="left:${left}%;top:${top}%;width:${BOARD.tileW}%"
               onclick="onTileClick(${el.tileIdx})">`;
        h += `<div class="tile-shape">${shapeSVG(tile.shape, fill, stroke)}</div>`;

        if (!tile.picked) h += `<div class="tile-back-num">${tile.backNum}</div>`;
        if (tile.picked) h += '<div class="tile-x">✕</div>';
        if (S.accelMarks.includes(pathIdx)) h += '<div class="accel-mark">⚡</div>';

        S.players.forEach((p, pi) => {
          if (p.pos === pathIdx && !p.returned) {
            h += playerTokenHTML(p);
          }
        });

        h += '</div>';
      }
    } else if (el.type === 'discarded') {
      // 丢弃物资：已拾取显示X，未拾取显示背面
      const zone = ZONES[el.zone - 1] || ZONES[0];
      const BACK_COLORS = { triangle: '#928694', square: '#796f7b', pentagon: '#564e55' };
      const backColor = BACK_COLORS[zone.shape] || zone.color;
      const hasAccel = S.accelMarks.includes(pathIdx);

      h += `<div class="tile discarded-supply-tile${el.picked ? ' picked' : ''}${hasAccel ? ' accel' : ''}${isCurrentPos ? ' current-pos' : ''}${flipTok ? ' flip-tok' : ''}"
             style="left:${left}%;top:${top}%;width:${BOARD.tileW}%"
             onclick="onDiscardedClick(${pathIdx})">`;

      if (el.picked) {
        h += `<div class="tile-shape">${shapeSVG(zone.shape, 'rgba(255,255,255,.05)', 'rgba(255,255,255,.1)')}</div>`;
        h += '<div class="tile-x">✕</div>';
      } else {
        h += `<div class="tile-shape">${shapeSVG(zone.shape, backColor, backColor)}</div>`;
        h += `<div class="tile-back-num">${zone.backNum}</div>`;
      }

      if (hasAccel) h += '<div class="accel-mark">⚡</div>';

      S.players.forEach((p, pi) => {
        if (p.pos === pathIdx && !p.returned) {
          h += playerTokenHTML(p);
        }
      });

      h += '</div>';
    } else if (el.type === 'ogs') {
      // OGS 芯片（与板块等大）
      const hasAccel = S.accelMarks.includes(pathIdx);
      h += `<div class="ogs-chip ${!el.active ? 'dead' : ''}${hasAccel ? ' accel' : ''}${isCurrentPos ? ' current-pos' : ''}${flipTok ? ' flip-tok' : ''}"
             style="left:${left}%;top:${top}%;width:${BOARD.tileW}%">
        <span class="ogs-label">${!el.active ? '❌️<br>OGS' : 'OGS'}</span>`;

      if (hasAccel) h += '<div class="accel-mark">⚡</div>';

      S.players.forEach((p, pi) => {
        if (p.pos === pathIdx && !p.returned) {
          h += playerTokenHTML(p);
        }
      });

      h += '</div>';
    }
  });

  // 机器人标记（在板块上时显示）
  if (S.hasEngineer && S.robotPos >= 0) {
    const robotP = tilePos(S.robotPos);
    const robotLeft = (robotP.x - BOARD.tileW / 2).toFixed(1);
    const robotTop = ((robotP.y - BOARD.tileW / 2) / boardH * 100).toFixed(1);
    h += `<div class="robot-marker" style="left:${robotLeft}%;top:${robotTop}%;width:${BOARD.tileW}%;aspect-ratio:1/1">
      <span class="robot-icon">🤖</span></div>`;
  }

  h += '</div></div>';
  return h;
}

/** 板块点击处理 */
function onTileClick(tileIdx) {
  if (S.turnPhase !== 'spent' || S.isDrawing) return;
  const p = currentPlayer();
  if (p.onRover) return;
  const adj = getAdjacentTiles(p.pos);

  // 如果是相邻的未拾取板块 → 拾取物资
  if (adj.includes(tileIdx) && !S.tiles[tileIdx].picked) {
    const cost = p.role.id === 'veteran' ? 2 : 3;
    if (S.ap >= cost && freeSlots(p) > 0) {
      collectSupply(tileIdx);
    }
  }
}

// ========================================
// 统计面板
// ========================================

/** 渲染统计面板 */
function renderStatsPanel() {
  const needsReshuffle = S.drawPile.length === 0 &&
    S.discardPile.some(c => c.type === 'o2');

  let h = '<div class="stats-panel">';
  h += '<div class="stats-row">';
  h += `<div class="stat-box ${S.drawPile.length <= 2 ? 'warn' : ''}" style="cursor:pointer" onclick="showDrawPileInfo()">
    <div class="num">${S.drawPile.length}</div><div class="label">抽牌堆</div></div>`;
  h += `<div class="stat-box" style="cursor:pointer" onclick="showDiscardPile()">
    <div class="num">${S.discardPile.length}</div><div class="label">弃牌堆</div></div>`;
  h += `<div class="stat-box">
    <div class="num">${S.ogsCount}/5</div><div class="label">OGS芯片</div></div>`;
  h += `<div class="stat-box">
    <div class="num">${WIN_CONDITIONS[S.playerCount]}</div><div class="label">物资目标</div></div>`;
  h += '</div>';

  // 洗回按钮
  // if (needsReshuffle && S.turnPhase === 'spent') {
  //   h += `<button class="act-btn btn-ogs" style="width:100%;margin-top:8px"
  //     onclick="reshufflePile();render()">🔄 洗回弃牌堆</button>`;
  // }

  // 最新日志（点击展开完整列表）
  if (S.log.length > 0) {
    const last = S.log[0];
    h += `<div class="stats-log-last" onclick="showLogSheet()">
      ${last.msg}</div>`;
  }

  h += '</div>';
  return h;
}

// ========================================
// 事件日志
// ========================================

/** 打开日志列表抽屉 */
function showLogSheet() {
  let h = '<h3>📋 事件日志</h3><div class="log-list">';
  S.log.slice(0, 30).forEach(item => {
    h += `<div class="log-item ${item.cls}">
      <span class="log-time">${item.t}</span>${item.msg}</div>`;
  });
  h += '</div>';
  h += '<button class="sheet-cancel" onclick="closeSheet()">关闭</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

// ========================================
// 玩家详情卡片
// ========================================

/** 渲染单个玩家详情卡片 */
function renderPlayerCard(player, idx) {
  const isCurrent = idx === S.currentPlayer;
  const used = usedSlots(player);
  const free = freeSlots(player);

  let h = `<div class="player-card ${isCurrent ? 'active-card' : ''}">`;

  // 头部
  h += `<div class="pc-header">
    <div class="pc-name"><span style="color:${player.color}">●${idx + 1}</span> ${player.name}</div>
    <div class="pc-role">${player.role.icon} ${player.role.name}</div>
  </div>`;

  // 返回基地标记
  if (player.returned) {
    h += '<div style="font-size:.7em;color:var(--safe);margin-bottom:6px">✅ 已返回基地</div>';
  }

  // 月球车标记
  if (player.onRover) {
    h += '<div style="font-size:.7em;color:var(--o2-light);margin-bottom:6px">🚗 驾驶月球车中</div>';
  }

  // 氧气卡
  h += `<div class="pc-section"><div class="pc-label">
    <span>🫧 氧气卡 (${player.oxygen.length}张)</span></div>
    <div class="pc-row">`;
  if (player.oxygen.length === 0) {
    h += '<span class="chip empty-slot">无氧气 ⚠</span>';
  } else {
    player.oxygen.forEach(c => {
      h += `<span class="chip o2 ${c.val === 3 ? 'val3' : ''}">O₂ ×${c.val}</span>`;
    });
  }
  h += '</div></div>';

  // 物资
  h += `<div class="pc-section"><div class="pc-label">
    <span>📦 物资 (${player.supplies.length}个)</span></div>
    <div class="pc-row">`;
  if (player.supplies.length === 0) {
    h += '<span class="chip empty-slot">空</span>';
  } else {
    player.supplies.forEach(s => {
      const z = ZONES.find(zone => zone.id === s.zone);
      const label = z ? `区域${s.zone}` : '?';
      const color = S.gameOver ? (s.intact ? '#4caf50' : '#f44336') : undefined;
      h += `<span class="chip supply-chip">${supplyIcon(s, 18, color)}<!--<span class="chip-label">${label}</span>--></span>`;
    });
  }
  h += '</div></div>';

  // 存储槽
  // h += `<div class="pc-section"><div class="pc-label">
  //   <span>🔲 存储槽</span><span style="color:var(--o2-light)">${used}/${player.slots}</span></div>
  //   <div class="slot-bar">`;
  // for (let i = 0; i < player.slots; i++) {
  //   if (i < player.oxygen.length) {
  //     h += '<div class="slot filled-o2">O</div>';
  //   } else if (i < used) {
  //     const sup = player.supplies[i - player.oxygen.length];
  //     const color = sup.intact ? '#4caf50' : '#f44336';
  //     h += `<div class="slot filled-sup">${supplyIcon(sup, 16, color)}</div>`;
  //   } else {
  //     h += '<div class="slot empty"></div>';
  //   }
  // }
  // h += `<span class="slot-info">空${free}格</span></div></div>`;

  // 位置
  const roverSeqPos = tilePathIdx(S.roverPos);
  const posText = player.pos === -1 ? '基地' :
    `${posLabel(player.pos)}${player.pos === roverSeqPos && player.onRover ? ' (月球车)' : ''}`;
  h += `<div class="pos-tag">📍 ${posText}</div>`;

  // 角色技能
  h += `<div class="pc-section"><div class="pc-label"><span>⭐ ${player.role.name}</span></div>
    <div style="font-size:.7em;color:var(--text-dim);padding:2px 0">
    ${player.role.icon} ${player.role.ability}</div></div>`;

  h += '</div>';
  return h;
}

/** 弹出玩家详情抽屉 */
function showPlayerDetail(idx) {
  const content = document.getElementById('sheetContent');
  content.innerHTML = renderPlayerCard(S.players[idx], idx)
    + '<button class="btn-full btn-primary" onclick="closeSheet()">关闭</button>';
  openSheet();
}

// ========================================
// 底部操作面板（Bottom Sheets）
// ========================================

/** 打开物资回收选择面板 */
function openCollectSheet() {
  const p = currentPlayer();
  const adj = getAdjacentTiles(p.pos);
  const cost = p.role.id === 'veteran' ? 2 : 3;
  const targets = adj.filter(t =>
    !S.tiles[t].picked &&
    !S.accelMarks.includes(tilePathIdx(t)) &&
    !S.players.some(pl => pathToTileIdx(pl.pos) === t && !pl.returned) &&
    !(S.hasEngineer && pathToTileIdx(S.robotPos) === t));

  let h = '<h3>📦 选择要拾取的物资</h3><div class="sheet-cards">';
  targets.forEach(t => {
    const dir = tilePathIdx(t) > p.pos ? '前方' : '后方';
    h += `<div class="sheet-card supply-card" onclick="closeSheet();collectSupply(${t})">
      ${dir === '前方' ? '⬇️' : '⬆️'} ${dir} · 板块${t + 1}</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 打开OGS建立选择面板 */
function openOGSSheet() {
  const p = currentPlayer();
  const available = getAdjacentInsertPoints(p.pos);

  let h = '<h3>🔵 选择OGS放置位置</h3><div class="sheet-cards">';
  available.forEach(insIdx => {
    const dir = insIdx > p.pos ? '⬇️ 前方' : '⬆️ 后方';
    h += `<div class="sheet-card o2-card" onclick="closeSheet();placeOGS(${insIdx})">
      ${dir} (3AP)</div>`;
  });
  if (available.length === 0) {
    h += '<p class="text-dim" style="padding:12px">没有可用的放置位置</p>';
  }
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/**
 * 打开发明家加速标记选择面板
 * @param {'forward'|'backward'} direction - 移动方向
 * @param {number} skipTarget - 跳过所有加速标记后的落点（seqPos）
 * @param {number[]} accelStops - 连续加速标记的序列位置数组
 */
function openAccelChoiceSheet(direction, skipTarget, accelStops) {
  const dirLabel = direction === 'forward' ? '⬇️ 前进' : '⬆️ 后退';
  let h = `<h3>⚡ 发现加速标记</h3>`;
  h += `<p style="font-size:.75em;color:var(--text-dim);text-align:center;margin-bottom:10px">
    发明家可选择停在加速标记上，或跳过全部</p>`;
  h += '<div class="sheet-cards">';

  accelStops.forEach(seqPos => {
    h += `<div class="sheet-card o2-card"
      onclick="closeSheet();stopOnAccelMark(${seqPos},'${direction}')">
      ⚡ 停在${posLabel(seqPos)}</div>`;
  });

  if (skipTarget >= 0) {
    h += `<div class="sheet-card supply-card"
      onclick="closeSheet();executePlayerMove(${skipTarget},'${direction}')">
      ${dirLabel}到${posLabel(skipTarget)}</div>`;
  } else if (direction === 'backward') {
    h += `<div class="sheet-card supply-card"
      onclick="closeSheet();showReturnBaseConfirm()">
      📡 ${dirLabel}返回基地</div>`;
  } else {
    h += `<div class="sheet-card supply-card" style="opacity:.4">
      ⬇️ 前方无可落脚板块</div>`;
  }

  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 打开共享目标选择面板 */
function openShareSelectSheet() {
  const p = currentPlayer();
  const adjSeq = getAdjacentSeqPositions(p.pos);
  const targets = S.players.filter((other, i) => {
    if (i === S.currentPlayer || other.returned) return false;
    if (p.pos >= 0 && other.pos === p.pos) return true;
    return adjSeq.includes(other.pos);
  }).sort((a, b) => a.pos - b.pos);

  let h = '<h3>🤝 选择共享对象</h3><div class="sheet-cards">';
  targets.forEach((t, i) => {
    const realIdx = S.players.indexOf(t);
    h += `<div class="sheet-card o2-card" onclick="closeSheet();shareWithPlayer(${realIdx})">
      <span style="color:${t.color}">●</span> ${t.name} (1AP)</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 渲染共享交换面板 */
function renderShareSheet(fromIdx, toIdx) {
  const from = S.players[fromIdx];
  const to = S.players[toIdx];

  let h = `<h3>🤝 ${from.name} ↔ ${to.name}</h3>`;
  h += '<div style="font-size:.75em;color:var(--text-dim);text-align:center;margin-bottom:10px">点击物品进行转移</div>';

  // from的物品
  h += `<div style="font-size:.8em;margin-bottom:4px;color:${from.color}">● ${from.name}（发起人） 的物品:</div>`;
  h += '<div class="sheet-cards">';
  from.oxygen.forEach((c, i) => {
    h += `<div class="sheet-card o2-card ${c.val === 3 ? 'val3' : ''}"
      onclick="transferItem(${fromIdx},${toIdx},'o2',${i});renderShareSheet(${fromIdx},${toIdx})">
      O₂×${c.val} ↓</div>`;
  });
  from.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;justify-content:center;gap:8px"
      onclick="transferItem(${fromIdx},${toIdx},'supply',${i});renderShareSheet(${fromIdx},${toIdx})">
      <span style="width:20px;height:20px;display:inline-flex">${shapeSVG(z.shape, z.fill, darken(z.color))}</span> ↓</div>`;
  });
  h += '</div>';

  // to的物品
  h += `<div style="font-size:.8em;margin:8px 0 4px;color:${to.color}">● ${to.name} 的物品:</div>`;
  h += '<div class="sheet-cards">';
  to.oxygen.forEach((c, i) => {
    h += `<div class="sheet-card o2-card ${c.val === 3 ? 'val3' : ''}"
      onclick="transferItem(${toIdx},${fromIdx},'o2',${i});renderShareSheet(${fromIdx},${toIdx})">
      ↑ O₂×${c.val}</div>`;
  });
  to.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;justify-content:center;gap:8px"
      onclick="transferItem(${toIdx},${fromIdx},'supply',${i});renderShareSheet(${fromIdx},${toIdx})">
      ↑ <span style="width:20px;height:20px;display:inline-flex">${shapeSVG(z.shape, z.fill, darken(z.color))}</span></div>`;
  });
  h += '</div>';

  h += '<div style="display:flex;gap:10px;margin-top:12px">';
  h += '<button class="sheet-cancel" style="flex:1" onclick="cancelShare()">取消</button>';
  h += '<button class="sheet-confirm" style="flex:1" onclick="confirmShare()">完成交换</button>';
  h += '</div>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 打开丢弃物资选择面板 */
function openDiscardSheet() {
  const p = currentPlayer();
  if (p.pos < 0) return; // 必须在路径上
  const adjacentGaps = getAdjacentInsertPoints(p.pos);

  let h = '<h3>🗑️ 选择要丢弃的物资</h3><div class="sheet-cards">';
  p.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;justify-content:center;gap:8px"
      onclick="closeSheet();openDiscardGapSheet(${i})">
      <span style="width:20px;height:20px;display:inline-flex">${shapeSVG(z.shape, z.fill, darken(z.color))}</span></div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 选择丢弃目标间隙 */
function openDiscardGapSheet(supplyIdx) {
  const p = currentPlayer();
  if (p.pos < 0) return;
  const insertPoints = getAdjacentInsertPoints(p.pos);

  let h = '<h3>📍 选择丢弃位置</h3><div class="sheet-cards">';
  insertPoints.forEach(insIdx => {
    const dir = insIdx > p.pos ? '⬇️ 前方' : '⬆️ 后方';
    h += `<div class="sheet-card supply-card"
      onclick="closeSheet();discardSupply(${supplyIdx},${insIdx})">
      ${dir}</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

// ========================================
// 弹窗/面板管理
// ========================================

/**
 * 打开模态弹窗
 * @param {string} id - 弹窗元素的ID
 */
function openModal(id) {
  document.getElementById(id).classList.add('show');
}

/**
 * 关闭模态弹窗
 * @param {string} id - 弹窗元素的ID
 */
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

/** 打开游戏规则弹窗 */
function showRules() {
  openModal('rulesModal');
}

/** 打开底部操作面板 */
function openSheet() {
  document.getElementById('actionSheet').classList.add('show');
}

/** 关闭底部操作面板（救援/共享进行中视为取消并回滚） */
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

/**
 * 显示磁暴弹窗
 * @param {string} playerName - 被磁暴摧毁OGS的玩家名称
 */
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

/** 显示抽牌堆信息弹窗 */
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

/** 显示弃牌堆弹窗 */
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

/**
 * 显示共享交换面板（委托 renderShareSheet 实现）
 * @param {number} fromIdx - 发起方玩家索引
 * @param {number} toIdx - 接收方玩家索引
 */
function openShareSheet(fromIdx, toIdx) {
  renderShareSheet(fromIdx, toIdx);
}

// ========================================
// 紧急救援面板
// ========================================

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

/**
 * 渲染紧急救援面板（救援双方可互相转移氧气和物资，免费）
 * @param {number} rescuerIdx - 救援方玩家索引
 * @param {number} rescuedIdx - 被救援方玩家索引
 */
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

// ========================================
// 机器人移动面板
// ========================================

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
      ${o.label} · ${o.desc}</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

// ========================================
// SVG 形状生成
// ========================================

/**
 * 将十六进制颜色按比例变暗
 * @param {string} hex - 十六进制颜色值，如 "#ff8800"
 * @param {number} [f=0.55] - 变暗比例（0~1）
 * @returns {string} 变暗后的十六进制颜色
 */
function darken(hex, f = 0.55) {
  const r = Math.round(parseInt(hex.slice(1,3),16)*f);
  const g = Math.round(parseInt(hex.slice(3,5),16)*f);
  const b = Math.round(parseInt(hex.slice(5,7),16)*f);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/** 人形 token SVG 路径 */
const TOKEN_PATH = 'M539 290.8c-19 0-37-3.8-54-11.2-17-7.4-31.8-17.4-44.2-30-12.6-12.6-22.4-27.2-30-44.2-7.4-17-11.2-35-11.2-54s3.8-37 11.2-54c7.4-17 17.4-31.8 30-44.2s27.2-22.4 44.2-30C502 15.8 520 12 539 12s37 3.8 54 11.2c17 7.4 31.8 17.4 44.2 30 12.6 12.6 22.4 27.2 29.4 44.2 7.2 17 10.8 35 10.8 54s-3.6 37-10.8 54c-7.2 17-17 31.8-29.4 44.2-12.6 12.6-27.2 22.4-44.2 30-16.8 7.4-34.8 11.2-54 11.2z m198.4 125.2c16 12 29.4 25.8 39.8 41.6s15.6 31.8 15.6 47.8v88.4c0 10.2-5.8 17.8-17.4 23.2-11.6 5.4-24.4 8-38.4 8s-26.8-2.6-38.4-7.6c-11.6-5-17.4-13.2-17.4-24.6v-37.6c0-9-2.6-15.6-8-20.2-5.4-4.4-10.8-8.2-16-11.2-6-3-12.8-1.6-20.6 4-7.8 5.6-11.6 15.4-11.6 29v236c0 14.2 4.8 27.4 14.2 39.4s21.2 23 34.8 33c12 8.4 22 16.6 30.4 25l29.4 29.4c3.6 3.6 5 9 4 16.6-0.8 7.4-3.4 15.4-7.6 23.6-4.2 8.4-9.4 16.6-15.6 25-6.2 8.4-13.2 14.8-21 19.6-7.8 4.8-15.6 7.2-23.6 7.2-8 0-15.6-3.8-22.8-11.6-10.8-11.4-19.4-20.4-26-27.2-6.6-6.8-12.4-13-17.4-18.4-5-5.4-10.2-10.4-15.6-15.2-5.4-4.8-12-11.4-19.6-19.6-15.4-15.4-28.8-35.2-39.8-59.4s-16.6-48.2-16.6-72v-72.4c-7.2 9-13.2 16-18.4 21.4-5 5.4-10.8 14.2-17.4 26.8-2.4 4.8-4.8 11-7.2 18.8-2.4 7.8-4.6 15.8-6.8 24.2s-3.8 16.6-5 25c-1.2 8.4-1.8 15.4-1.8 21.4V928c0 11.4-5.8 19.8-17.4 25.4-11.6 5.6-24.4 8.4-38.4 8-14-0.2-26.8-3.6-38.4-9.8s-17.4-15.6-17.4-28.2v-65.2c0-23.2 3.6-43.8 10.8-61.6 7.2-17.8 15.2-37 24.2-57.2 12-27.4 20.8-49.4 26.4-66.2 5.6-16.6 10-28.2 13-34.8 6-13.8 9-26 9-36.6v-28.6c-6.6 4.2-12 8-16.6 11.6-4.4 3.6-10.6 10.2-18.4 19.6-7.8 9-15.6 14.8-23.6 17.4-8 2.6-20.8 4-38 4h-58c-14.2 0-24.8-5.8-31.8-17.4-6.8-11.6-10.2-24.2-9.8-38s4-26.4 11.2-38c7.2-11.6 17.6-17.4 31.2-17.4h53.6c7.2 0 13-0.8 17.4-2.6 4.4-1.8 8.6-4.4 12.6-8 3.8-3.6 8-7.8 12.6-12.6 4.4-4.8 10-10.2 16.6-16 8.4-7.2 16.8-17.8 25.4-31.8 8.6-14 16.8-28.2 24.6-42.4 9-16.6 17.6-34.6 26-53.6 12.6 0.6 24.2 1.2 34.8 1.8 9.6 0.6 19.2 1 29 1.4 9.8 0.2 18 0.4 24.6 0.4 6.6 0 14-0.2 22.4-0.4 8.4-0.2 16.4-0.8 24.2-1.4 9-0.6 18.2-1.2 27.8-1.8 16 10.2 31.6 19.4 46.4 27.8 12.6 7.8 25 15.2 37.6 22.4 12.2 7 21.6 13 28.2 17.8z';

/**
 * 生成人形 token SVG
 * @param {string} c - 填充颜色
 * @returns {string} SVG HTML字符串
 */
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

/**
 * 生成四边形SVG（区域2）
 * @param {string} fill - 填充颜色
 * @param {string} stroke - 描边颜色
 * @returns {string} SVG HTML字符串
 */
function sqSVG(fill, stroke) {
  return `<svg viewBox="0 0 100 100"><polygon points="50,11 89,50 50,89 11,50" fill="${fill}" stroke="${stroke}" stroke-width="13" stroke-linejoin="round"/></svg>`;
}

/**
 * 生成五边形SVG（区域3）
 * @param {string} fill - 填充颜色
 * @param {string} stroke - 描边颜色
 * @returns {string} SVG HTML字符串
 */
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

/**
 * 生成月球车SVG
 * @param {string} fill - 填充颜色
 * @returns {string} SVG HTML字符串
 */
function roverSVG(fill) {
  return `<svg viewBox="0 0 1641 1024"><path fill="${fill}" d="M292.864 442.368a290.816 290.816 0 1 0 293.888 290.816 291.84 291.84 0 0 0-293.888-290.816z m0 422.912a133.12 133.12 0 1 1 134.144-133.12 133.12 133.12 0 0 1-134.144 134.144zM1331.2 442.368a290.816 290.816 0 1 0 293.888 290.816A291.84 291.84 0 0 0 1331.2 442.368z m0 422.912a133.12 133.12 0 1 1 134.144-133.12A133.12 133.12 0 0 1 1331.2 866.304z m204.8-667.648h-283.648c-76.8 0-26.624 128-291.84 128s-122.88-128-358.4-128H375.808L512 66.56h161.792V0h-204.8L279.552 204.8C102.4 220.16 102.4 429.056 102.4 429.056s539.648-136.192 539.648 294.912h358.4a294.912 294.912 0 0 1 295.936-328.704H1638.4s31.744-196.608-102.4-196.608z"/></svg>`;
}

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
