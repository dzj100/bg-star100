/**
 * 时序谜局 (Take Time) - 渲染层
 * 负责：钟面环形布局、手牌区、玩家条、阶段操作区、结算面板、出牌弹层、着陆页
 * 依赖：game.js（全局 S、pendingPlay、mySeat、isHost、isMyTurn、eyeLeft）
 */

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

function closeSheet() {
  const sheet = document.getElementById('playSheet');
  if (sheet) sheet.classList.remove('show');
  pendingPlay = null;
}

// ========================================
// 扇区定位（6扇区环形，扇区1在正上方，顺时针）
// ========================================

function segPos(i) {
  const ang = (-90 + i * 60) * Math.PI / 180;
  return { x: 50 + 30 * Math.cos(ang) - 15, y: 50 + 30 * Math.sin(ang) - 15 };
}

function cardMiniHTML(c) {
  const cls = `mini-card ${c.color}${c.revealed ? ' lit' : ''}${c.fresh ? ' anim' : ''}`;
  return `<span class="${cls}"><span class="c-icon">${c.color === 'sun' ? '☀' : '☾'}</span><span class="c-num">${c.v}</span></span>`;
}

// ========================================
// 钟面
// ========================================

function cardBackMiniHTML(c) {
  // 牌背：按日/月显示 ☀/☾ 与对应底色（隐藏数字）
  const cls = `mini-card back ${c.color}${c.fresh ? ' anim' : ''}`;
  return `<span class="${cls}"><span class="c-icon">${c.color === 'sun' ? '☀' : '☾'}</span></span>`;
}

function segHTML(i) {
  const seg = S.segments[i];
  const pos = segPos(i);
  const visibleSum = seg.cards.filter(c => c.revealed).reduce((a, c) => a + c.v, 0);
  let body = '';
  if (S.settled) {
    body = `<div class="seg-sum">${S.sums[i]}</div>
      <div class="seg-cards">${seg.cards.map(cardMiniHTML).join('')}</div>`;
  } else {
    if (seg.cards.length) {
      body += `<div class="seg-cards">${seg.cards.map(c => c.revealed ? cardMiniHTML(c) : cardBackMiniHTML(c)).join('')}</div>`;
    }
    if (visibleSum > 0) body += `<div class="seg-vis">${visibleSum}</div>`;
  }
  let cls = '';
  if (S.settled) {
    // 自定义关卡用 check.segBad，否则用基础检查
    cls = S.check.segBad ? (S.check.segBad[i] ? ' seg-bad' : '') : (!(S.check.segOK[i] && S.check.sumOK[i]) ? ' seg-bad' : '');
  }
  return `<div class="seg${cls}" style="left:${pos.x}%;top:${pos.y}%">
    <div class="seg-idx">${i + 1}</div>
    ${body}
  </div>`;
}

function clockHTML() {
  const ch = S.challenge;
  const ruleText = ch.desc || challengeDesc(ch);
  return `
  <div class="clock-rule">📜 ${esc(ruleText)}</div>
  <div class="clock-wrap">
    <div class="clock-ring"></div>
    ${S.segments.map((_, i) => segHTML(i)).join('')}
    <div class="clock-center">
      <div class="cc-ch">第${ch.chapter}章·第${ch.test}关</div>
      <div class="cc-eye">👁 <b>${eyeLeft()}</b><span class="cc-eye-sub">基础${S.eyeBase}+赠${S.eyeBonus}</span></div>
    </div>
  </div>`;
}

// ========================================
// 玩家条
// ========================================

function playersBarHTML() {
  const me = mySeat();
  return `<div class="players-bar">${S.players.map((p, i) => {
    let cls = 'p-chip';
    let tag = '';
    if (S.phase === 'spin' && S.spin.running && S.spin.seat === i) { cls += ' spotlight'; tag = '🎯'; }
    else if (S.phase === 'play' && S.currentSeat === i) { cls += ' active'; tag = '👆'; }
    else if (S.phase === 'result' && S.firstSeat === i) { cls += ' first'; tag = '先手'; }
    else if (S.phase === 'play' && S.firstSeat === i) { cls += ' first'; tag = '先手'; }
    return `<div class="${cls}" style="border-color:${PLAYER_COLORS[i]}">
      <span class="dot" style="background:${PLAYER_COLORS[i]}"></span>
      <span class="p-name">${esc(p.name)}${me === i ? '（我）' : ''}</span>
      <span class="p-hand">${p.hand.length}张</span>
      ${tag ? `<span class="p-tag">${tag}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ========================================
// 手牌区（只显示自己）
// ========================================

function handHTML() {
  const me = mySeat();
  if (me === null) return '';
  const p = S.players[me];
  const canSee = S.phase === 'reveal' || S.phase === 'spin' || S.phase === 'play' || S.phase === 'result';
  const myTurn = isMyTurn();
  const locked = handLockedIndexes();
  let title = '我的手牌';
  if (S.phase === 'discuss') title = '我的手牌（未看牌，牌面向下）';
  else if (locked.size > 0) title = '我的手牌（后2张暂锁定：双方各出2张后解锁）';

  const cards = p.hand.map((c, i) => {
    // 牌背：按日/月显示 ☀/☾ 与对应底色（隐藏数字）
    if (!canSee || locked.has(i)) return `<div class="card back ${c.color}"><span class="c-icon">${c.color === 'sun' ? '☀' : '☾'}</span></div>`;
    const sel = pendingPlay && pendingPlay.cardIndex === i ? ' sel' : '';
    const clickable = myTurn ? `onclick="selectCard(${i})"` : '';
    return `<div class="card ${c.color}${sel}" ${clickable}>
      <span class="c-icon">${c.color === 'sun' ? '☀' : '☾'}</span>
      <span class="c-num">${c.v}</span>
    </div>`;
  }).join('');

  return `<div class="hand-box">
    <div class="hand-title">${title} <span class="hand-count">${p.hand.length}张</span></div>
    <div class="hand-row">${cards || '<div class="hand-empty">已全部打出</div>'}</div>
  </div>`;
}

// ========================================
// 结算面板
// ========================================

function resultHTML() {
  const chk = S.check;
  const pass = S.pass;
  const sumChips = S.sums.map((s, i) =>
    `<span class="sum-chip ${chk.segOK[i] && chk.sumOK[i] ? 'ok' : 'bad'}">${i + 1}:${s}</span>`).join('');
  // 自定义关卡展示 check.items，否则展示默认三项
  const checks = (chk.items && chk.items.length)
    ? chk.items
    : [
        { label: '每扇区至少1张', ok: chk.segOK.every(Boolean) },
        { label: '每扇区总和≤24', ok: chk.sumOK.every(Boolean) },
        { label: '扇区1→6递增', ok: chk.ascOK },
      ];
  const checkRow = checks.map(c =>
    `<div class="check-item ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.label)}</div>`).join('');
  return `
  <div class="result-panel ${pass ? 'pass' : 'fail'}">
    <h3>${pass ? '🎉 挑战成功！' : '❌ 未通关'}</h3>
    <div class="sum-row">${sumChips}</div>
    <div class="check-row">${checkRow}</div>
    <div class="result-note">${pass
      ? '👁 赠送眼标记已回收'
      : `👁 获赠 1 个眼标记（累计 ${S.eyeBonus}/${3}），下次挑战本关可用`}</div>
    ${isHost()
      ? `<button class="btn-full btn-primary" onclick="restartChallenge()" style="margin-top:12px;">🔄 再来一局</button>`
      : `<div class="wait-text" style="margin-top:12px;">等待房主开始下一局…</div>`}
  </div>`;
}

// ========================================
// 操作区（按阶段）
// ========================================

function actionHTML() {
  switch (S.phase) {
    case 'discuss':
      return isHost()
        ? `<button class="btn-full btn-primary" onclick="hostReveal()">🔍 看牌（所有人可查看自己手牌）</button>
           <div class="wait-text">💬 看牌前请先讨论策略</div>`
        : `<div class="wait-text">等待房主操作…<br>💬 看牌前请先讨论策略</div>`;
    case 'reveal':
      return isHost()
        ? `<button class="btn-full btn-primary" onclick="hostStartSpin()">🎯 启动聚光灯选先手</button>
           <div class="wait-text forbid">🔇 已看牌，禁止交流！请独自思考出牌</div>`
        : `<div class="wait-text forbid">🔇 已看牌，禁止交流！<br>等待房主启动聚光灯…</div>`;
    case 'spin':
      return isHost()
        ? `<button class="btn-full btn-danger" onclick="hostStopSpin()">⏹ 停止聚光灯</button>
           <div class="wait-text forbid">🎯 聚光灯转动中…转3圈自动停止<br>🔇 已看牌，禁止交流</div>`
        : `<div class="wait-text forbid">聚光灯转动中…🎯<br>🔇 已看牌，禁止交流</div>`;
    case 'play':
      if (S.allPlaced) {
        return `<button class="btn-full btn-primary" onclick="settle()">🧮 翻开所有牌结算</button>
          <div class="wait-text">所有手牌已放置，点击按钮翻开结算</div>`;
      }
      if (isMyTurn()) {
        return `<div class="turn-tip">👆 轮到你出牌：点击下方手牌选择一张<br><span class="forbid">🔇 已看牌，禁止交流</span></div>`;
      }
      return `<div class="wait-text forbid">🔇 已看牌，禁止交流<br>等待 <b>${esc(S.players[S.currentSeat].name)}</b> 出牌…</div>`;
    case 'result':
      return resultHTML();
    default:
      return '';
  }
}

// ========================================
// 日志
// ========================================

function logHTML() {
  if (!S.log || !S.log.length) return '';
  const last = S.log[S.log.length - 1];
  return `<div class="log-box" onclick="showLogModal()">
    <div class="log-item ${last.cls}">${esc(last.msg)}</div>
    <div class="log-more">▼</div>
  </div>`;
}

function showLogModal() {
  let ov = document.getElementById('logModalOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'logModalOverlay';
    ov.className = 'modal-overlay';
    ov.innerHTML = `
      <div class="modal-box">
        <h2>📜 对局日志</h2>
        <div id="logModalList" class="log-list"></div>
        <button class="btn-full btn-secondary" onclick="closeModal('logModalOverlay')" style="margin-top:14px;">关闭</button>
      </div>`;
    document.body.appendChild(ov);
  }
  document.getElementById('logModalList').innerHTML = S.log.map(l =>
    `<div class="log-item ${l.cls}">${esc(l.msg)}</div>`).join('');
  ov.classList.add('show');
}

// ========================================
// 出牌弹层（底部 sheet）
// ========================================

function cardBigHTML(c) {
  return `<span class="card-big ${c.color}"><span class="c-icon">${c.color === 'sun' ? '☀' : '☾'}</span><span class="c-num">${c.v}</span></span>`;
}

function renderPlaySheet() {
  const sheet = document.getElementById('playSheet');
  if (!sheet) return;
  const content = document.getElementById('playSheetContent');
  if (!pendingPlay) { sheet.classList.remove('show'); return; }
  const me = mySeat();
  if (me === null) { sheet.classList.remove('show'); return; }
  const card = S.players[me].hand[pendingPlay.cardIndex];
  if (!card) { sheet.classList.remove('show'); return; }

  const left = eyeLeft();
  const segBtns = S.segments.map((seg, i) => {
    const visibleSum = seg.cards.filter(c => c.revealed).reduce((a, c) => a + c.v, 0);
    const sel = pendingPlay.seg === i ? ' sel' : '';
    return `<button class="seg-btn${sel}" onclick="pickSeg(${i})">
      扇区${i + 1}<span class="sg-sub">${seg.cards.length}张${visibleSum ? '·' + visibleSum : ''}</span>
    </button>`;
  }).join('');

  const eyeChip = left > 0
    ? `<label class="eye-opt" onclick="toggleEye()"><span class="eye-box">${pendingPlay.useEye ? '☑' : '☐'}</span> 明置此牌（消耗1眼标记，剩${left}）</label>`
    : `<div class="eye-opt off">👁 眼标记已用完，此牌将暗置打出</div>`;

  content.innerHTML = `
    <h3>将 ${cardBigHTML(card)} 放置到哪个扇区？</h3>
    <div class="seg-grid">${segBtns}</div>
    ${eyeChip}
    <button class="btn-full btn-primary" onclick="placeCard()" ${pendingPlay.seg === -1 ? 'disabled' : ''}>确认放置</button>
    <button class="btn-full btn-secondary" onclick="closePlaySheet()">取消</button>`;
  sheet.classList.add('show');
}

// ========================================
// 着陆页
// ========================================

/** 首页右上角规则弹层 */
function showRulesModal() {
  const box = document.getElementById('modalContent');
  box.innerHTML = `
    <h2>📖 游戏规则</h2>
    <div class="rules-body">
      <p>🕰️ 支持 2~4 人合作的游戏，桌上有一个 1~6 号的钟面，玩家轮流将手牌一张张放进区域，最后翻开结算——只要满足关卡规则，则本关通关。</p>
      <p>🃏 <b>牌库</b>：☀ 太阳牌、☾ 月亮牌数字各 1~12，每局随机抽 12 张均分给玩家（2人各6张 / 3人各4张 / 4人各3张）。</p>
      <h3>🎮 玩法流程</h3>
      <table class="rules-table">
        <tr><td>1. 发牌后先<b>讨论</b>策略（此时看不到自己的牌）</td></tr>
        <tr><td>2. 房主点【看牌】后各自查看自己的牌，<b class="forbid">禁止交流</b>直到结算</td></tr>
        <tr><td>3. 随机确定先手，轮流放 1 张牌到任意区域，通常为<b>暗置</b>，也可花 1 个 👁 <b>明置</b>打出</td></tr>
        <tr><td>4. 全部放完后，点【翻开结算】进入关卡结算</td></tr>
      </table>
      <h3>🧮 结算通用规则</h3>
      <table class="rules-table">
        <tr><td>1. 每个区域都<b>至少 1 张牌</b></td></tr>
        <tr><td>2. 各区域总和从 1 号到 6 号<b>相等或递增</b></td></tr>
        <tr><td>3. 各区域总和<b>不大于 24</b>（第 1 章入门关除外）</td></tr>
      </table>
      <p>👁 <b>眼标记</b>：初始数量 = 玩家人数；未通关则额外增加 1 个（至多 3 个），通关后清零。</p>
      <p class="rules-note"> 2 人局特殊规则：每人 6 张牌，看牌时只展示前 4 张；双方各打出 2 张后，后 2 张才解锁可见。</p>
    </div>
    <button class="btn-full btn-secondary" onclick="closeModal('modalOverlay')" style="margin-top:14px;">知道了</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}

function renderLandingHTML() {
  return `
  <div class="landing">
    <div class="rules-corner"><button class="icon-btn" onclick="showRulesModal()">📖 规则</button></div>
    <div class="landing-icon">⏳</div>
    <h1>时序谜局</h1>
    <p class="subtitle">Take Time · 2~4人合作无声解谜</p>
    <!--ONLINE_BTN-->
    <div class="credit">@imStar100</div>
  </div>`;
}

// ========================================
// 主渲染
// ========================================

function render() {
  const app = document.getElementById('app');
  if (!app) return;

  if (!S || !S.players || S.players.length === 0 || S.phase === 'landing') {
    // 联机模式会包装 window.renderLanding 注入「联机模式」入口按钮
    app.innerHTML = typeof window.renderLanding === 'function' ? window.renderLanding() : renderLandingHTML();
    renderPlaySheet();
    return;
  }

  const ch = S.challenge;
  app.innerHTML = `
  <div class="game-header">
    <div class="header-title">⏳ 时序谜局 <span class="ch-tag">第${ch.chapter}章·第${ch.test}关</span></div>
    <div class="header-btns"><button class="icon-btn" onclick="showRulesModal()">📖 规则</button></div>
  </div>
  ${clockHTML()}
  ${playersBarHTML()}
  ${handHTML()}
  <div class="action-box">${actionHTML()}</div>
  ${logHTML()}
  `;

  renderPlaySheet();

  // 聚光灯本地动画（不推送）
  if (S.phase === 'spin' && S.spin.running) {
    if (!spinTimer) spinTimer = setInterval(spinTick, 170);
  } else if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }

  if (typeof onlineAfterRender === 'function') onlineAfterRender();
}
