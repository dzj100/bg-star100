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
  render(); // 清除手牌上的 sel 高亮
}

// ========================================
// 区域定位（6区域环形，区域1在正上方，顺时针）
// ========================================

function segPos(i) {
  const ang = (-90 + i * 60) * Math.PI / 180;
  return { x: 50 + 30 * Math.cos(ang) - 15, y: 50 + 30 * Math.sin(ang) - 15 };
}

/** 结算时区域展示值：第6章区域取值为两牌之差，其余章节为总和 */
function segShowVal(i) {
  const seg = S.segments[i];
  const lib = CHALLENGE_LIB[S.challenge.id];
  if (lib && lib.chapter === 6 && seg.cards.length === 2) {
    return Math.abs(seg.cards[0].v - seg.cards[1].v);
  }
  return S.sums ? S.sums[i] : 0;
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

/** 区域条件标签（定首类关卡：先手选定后每个区域显示其条件） */
function segCondHTML(i) {
  if (!S.segCond || !S.segCond[i]) return '';
  const cond = S.segCond[i];
  let cls = 'seg-cond';
  if (cond.key === 'free') cls += ' free';
  else if (cond.key === 'blocked') cls += ' blocked';
  else if (cond.key === 'cw' || cond.key === 'ccw') cls += ' rot';
  return `<div class="${cls}">${esc(cond.short || cond.label)}</div>`;
}

function segHTML(i) {
  const seg = S.segments[i];
  const pos = segPos(i);
  const visibleSum = seg.cards.filter(c => c.revealed).reduce((a, c) => a + c.v, 0);
  let body = '';
  if (S.settled) {
    body = `<div class="seg-sum">${segShowVal(i)}</div>
      <div class="seg-cards">${seg.cards.map(cardMiniHTML).join('')}</div>`;
  } else {
    if (seg.cards.length) {
      body += `<div class="seg-cards">${seg.cards.map(c => c.revealed ? cardMiniHTML(c) : cardBackMiniHTML(c)).join('')}</div>`;
    }
    //if (visibleSum > 0) body += `<div class="seg-vis">${visibleSum}</div>`;
  }
  let cls = '';
  if (!S.settled && segBlocked(i)) cls += ' seg-blocked';
  if (S.settled) {
    // 自定义关卡用 check.segBad，否则用基础检查
    cls += S.check.segBad ? (S.check.segBad[i] ? ' seg-bad' : '') : (!(S.check.segOK[i] && S.check.sumOK[i]) ? ' seg-bad' : '');
  }
  return `<div class="seg${cls}" data-i="${i}" style="left:${pos.x}%;top:${pos.y}%">
    <div class="seg-idx">${segNumber(i)}</div>
    ${body}
    ${segCondHTML(i)}
  </div>`;
}

function clockHTML() {
  const ch = S.challenge;
  const ruleText = ch.desc || challengeDesc(ch);
  const ruleDisplay = esc(ruleText).replace(/\n/g, '<br>');
  return `
  <div class="clock-rule">📜 ${ruleDisplay}</div>
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
// 第8章：区域规则旋转动画
// 各端收到同一个 rotAnim.seq 后，只播放一次：
// 新落到每个区域的条件标签，从旋转前所在的区域沿钟面弧线飞入。
// ========================================

let _rotSeenStartAt = null;
let _rotSeenSeq = 0;
let _rotAnims = [];

function playCondRotateAnim() {
  if (!S) return;
  const rot = S.rotAnim;
  if (S.startAt !== _rotSeenStartAt) {
    // 新一局 / 中途加入 / 刷新恢复：把状态里已有的旋转事件视为已播，避免重放历史动画
    _rotSeenStartAt = S.startAt;
    _rotSeenSeq = rot ? (rot.seq || 0) : 0;
  }
  if (!rot || !S.segCond) return;
  if (!rot.seq || rot.seq === _rotSeenSeq) return;
  _rotSeenSeq = rot.seq;
  if (typeof document.querySelector !== 'function' || typeof document.querySelectorAll !== 'function') return;
  const wrap = document.querySelector('.clock-wrap');
  const segEls = Array.from(document.querySelectorAll('.seg'));
  if (!wrap || segEls.length !== 6) return;
  const wr = wrap.getBoundingClientRect();
  if (!wr.width) return;
  const cx = wr.left + wr.width / 2;
  const cy = wr.top + wr.height / 2;
  const centers = segEls.map(el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const R = Math.hypot(centers[0].x - cx, centers[0].y - cy);
  if (!isFinite(R) || R <= 0) return;

  _rotAnims.forEach(a => { try { a.cancel(); } catch (e) {} });
  _rotAnims = [];
  const span = (Math.PI * 2) / 6;
  for (let i = 0; i < 6; i++) {
    // 规则标签与区域编号一起沿弧线转到新位置（牌不动）
    const parts = [segEls[i].querySelector('.seg-cond'), segEls[i].querySelector('.seg-idx')];
    const aEnd = Math.atan2(centers[i].y - cy, centers[i].x - cx);
    // 顺时针：本区域的新条件/编号从上一区域（i-1）转来；逆时针从下一区域（i+1）转来
    const aStart = aEnd + (rot.dir === 'cw' ? -span : span);
    const frames = [];
    const steps = 4;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const a = aStart + (aEnd - aStart) * t;
      const x = cx + R * Math.cos(a);
      const y = cy + R * Math.sin(a);
      const sc = 1 - Math.sin(Math.PI * t) * 0.16;
      frames.push({
        offset: t,
        transform: `translate(${x - centers[i].x}px, ${y - centers[i].y}px) scale(${sc})`,
      });
    }
    for (const chip of parts) {
      if (!chip || typeof chip.animate !== 'function') continue;
      chip.classList.add('cond-rot-fly');
      const anim = chip.animate(frames, { duration: 460, easing: 'cubic-bezier(.25,.8,.3,1)' });
      anim.onfinish = () => chip.classList.remove('cond-rot-fly');
      anim.oncancel = () => chip.classList.remove('cond-rot-fly');
      _rotAnims.push(anim);
    }
  }

  const center = wrap.querySelector('.clock-center');
  if (center) {
    const flash = document.createElement('div');
    flash.className = 'rot-flash';
    flash.textContent = rot.dir === 'cw' ? '↻' : '↺';
    center.appendChild(flash);
    setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 700);
  }
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
      <span class="p-hand">${p.hand.filter(c => c.color === 'sun').length}☀、${p.hand.filter(c => c.color === 'moon').length}☾</span>
      ${tag ? `<span class="p-tag">${tag}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ========================================
// 手牌区（只显示自己）
// ========================================

function handHTML() {
  const me = actionSeat();
  if (me === null) return '';
  const p = S.players[me];
  if (!p.hand.length) return ''; // 已全部打出（进入结算环节），隐藏手牌区
  const canSee = S.phase === 'reveal' || S.phase === 'spin' || S.phase === 'play' || S.phase === 'result';
  const myTurn = isMyTurn();
  const locked = handLockedIndexes();
  const chLocked = chapterLockedIndexes();
  const taking = me !== mySeat();
  const lib = CHALLENGE_LIB[S.challenge.id];
  let title = taking ? `⚑ 接管 ${esc(p.name)} 的手牌` : '我的手牌';
  if (S.phase === 'discuss') title = '我的手牌（未看牌，牌面向下）';
  else if (locked.size > 0) title = '我的手牌（后2张暂锁定：双方各出2张后解锁）';
  else if (S.phase === 'play' && lib) {
    if (lib.playOrder === 'desc') title = '我的手牌（从大到小）';
    else if (lib.playOrder === 'asc') title = '我的手牌（从小到大）';
    else if (lib.playLock) title = '我的手牌（按顺序从左到右）';
  }

  const cards = p.hand.map((c, i) => {
    // 牌背：按日/月显示 ☀/☾ 与对应底色（隐藏数字）
    if (!canSee || locked.has(i)) return `<div class="card back ${c.color}"><span class="c-icon">${c.color === 'sun' ? '☀' : '☾'}</span></div>`;
    const sel = pendingPlay && pendingPlay.cardIndex === i ? ' sel' : '';
    const dim = chLocked.has(i) ? ' dimmed' : '';
    const draggable = myTurn && !chLocked.has(i) ? `onpointerdown="cardDragStart(event, ${i})"` : '';
    return `<div class="card ${c.color}${sel}${dim}" ${draggable}>
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
  const sumChips = Array.from({ length: SEG_COUNT }, (_, i) => i)
    .sort((a, b) => segNumber(a) - segNumber(b))
    .map(i => `<span class="sum-chip ${chk.segOK[i] && chk.sumOK[i] ? 'ok' : 'bad'}">${segNumber(i)}:${segShowVal(i)}</span>`).join('');
  // 自定义关卡展示 check.items，否则展示默认三项
  const checks = (chk.items && chk.items.length)
    ? chk.items
    : [
        { label: '每区域至少1张', ok: chk.segOK.every(Boolean) },
        { label: '每区域总和≤24', ok: chk.sumOK.every(Boolean) },
        { label: '区域1→6递增', ok: chk.ascOK },
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
      ? `<div class="result-actions">${pass
          ? `<button class="btn-full btn-primary" onclick="restartChallenge()">🔄 重试本关</button>
             <button class="btn-full btn-secondary" onclick="nextChallenge()">⏭ 下一关</button>`
          : `<button class="btn-full btn-primary" onclick="restartChallenge()">🔄 重试本关</button>`}
      </div>`
      : `<div class="wait-text" style="margin-top:12px;">等待房主开始下一局…</div>`}
  </div>`;
}

/** 通关所有章节提示弹窗 */
function showAllDoneModal() {
  const box = document.getElementById('modalContent');
  box.innerHTML = `
    <h2>🎉 恭喜通关！</h2>
    <div class="rules-body"><p style="text-align:center;">你已通关所有章节，后续内容敬请期待！</p></div>
    <button class="btn-full btn-secondary" onclick="closeModal('modalOverlay')" style="margin-top:14px;">知道了</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}

// ========================================
// 操作区（按阶段）
// ========================================

function actionHTML() {
  switch (S.phase) {
    case 'discuss': {
      const lib = CHALLENGE_LIB[S.challenge.id] || {};
      const isRotate = !!lib.rotate;
      const previewed = !!S.segCond;
      if (isHost()) {
        if (isRotate) {
          return `
            <button class="btn-full btn-primary" onclick="openCondPicker()">🎯 ${previewed ? '调整' : '选择'} 1 号位条件</button>
            <button class="btn-full btn-primary" onclick="hostReveal()">🔍 看牌（所有人可查看自己手牌）</button>
            <div class="wait-text">${previewed
              ? '条件已预览，所有玩家可见区域规则；看牌后将锁定'
              : '先预览 1 号位条件，所有玩家可见后再看牌'}</div>`;
        }
        return `<button class="btn-full btn-primary" onclick="hostReveal()">🔍 看牌（所有人可查看自己手牌）</button>
           <div class="wait-text">💬 看牌前请先讨论策略</div>`;
      }
      if (isRotate) {
        return previewed
          ? `<div class="wait-text">区域条件已由房主预览<br>📜 上方各区已标注规则，等待房主看牌…</div>`
          : `<div class="wait-text">房主正在预览 1 号位条件…<br>📜 预览后区域规则立即可见</div>`;
      }
      return `<div class="wait-text">等待房主操作…<br>💬 看牌前请先讨论策略</div>`;
    }
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
        return isHost()
          ? `<button class="btn-full btn-primary" onclick="settle()">🧮 翻开所有牌结算</button>
             <div class="wait-text">所有手牌已放置，点击按钮翻开结算</div>`
          : `<div class="wait-text">所有手牌已放置，等待房主翻开结算…</div>`;
      }
      if (isMyTurn()) {
        const seat = actionSeat();
        const taking = seat !== mySeat();
        if (seat !== null && S.players[seat].hand.length === 0) {
          return `<button class="btn-full btn-primary" onclick="skipEmptyTurn()">⏭ 跳过回合（无手牌）</button>
            <div class="wait-text">${taking ? `⚑ 正在接管 ${esc(S.players[seat].name)}，其` : '👆 轮到你，但'}已无手牌，点击跳过回合</div>`;
        }
        return `<div class="turn-tip">${taking ? `⚑ 已接管 ${esc(S.players[actionSeat()].name)}，代其` : '👆 轮到你出牌，'}拖拽上方手牌到钟面区域<br><span class="forbid">🔇 已看牌，禁止交流</span></div>`;
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
    ov.setAttribute('onclick', "if(event.target===this)closeModal('logModalOverlay')");
    ov.innerHTML = `
      <div class="modal-box">
        <h2 class="log-modal-title">📋 对局日志</h2>
        <div id="logModalList" class="log-list"></div>
        <button class="btn-full btn-secondary" onclick="closeModal('logModalOverlay')" style="margin-top:14px;">关闭</button>
      </div>`;
    document.body.appendChild(ov);
  }
  document.getElementById('logModalList').innerHTML = [...S.log].reverse().map(l =>
    `<div class="log-item ${l.cls}">${esc(l.msg)}</div>`).join('');
  void ov.offsetHeight; // 首次创建时强制初始帧，抽屉过渡才会触发
  ov.classList.add('show');
}

// ========================================
// 出牌弹层（底部 sheet）
// ========================================

function cardBigHTML(c) {
  return `<span class="card-big ${c.color}"><span class="c-icon">${c.color === 'sun' ? '☀' : '☾'}</span><span class="c-num">${c.v}</span></span>`;
}

// ========================================
// 拖拽出牌（按住手牌拖到区域，松开弹确认）
// ========================================

let _drag = null;
const DRAG_THRESHOLD = 8;
const GHOST_W = 64, GHOST_H = 96; // 与 .drag-ghost 尺寸一致

function dragGhostHTML(c) {
  return `<div class="drag-ghost ${c.color}"><span class="c-icon">${c.color === 'sun' ? '☀' : '☾'}</span><span class="c-num">${c.v}</span></div>`;
}

function cardDragStart(e, i) {
  if (!isMyTurn() || !isActor()) return;
  const seat = actionSeat();
  if (seat === null || !S.players[seat].hand[i]) return;
  if (handLockedIndexes().has(i)) return;
  if (chapterLockedIndexes().has(i)) return;
  e.preventDefault();
  // 缓存 6 个区域圆（屏内固定），拖拽中用纯几何命中检测，避免每帧 DOM 查询
  const segs = document.querySelectorAll('.seg');
  const circles = [];
  for (const s of segs) {
    const r = s.getBoundingClientRect();
    circles.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 });
  }
  _drag = { cardIndex: i, startX: e.clientX, startY: e.clientY, moved: false, seg: -1, ghost: null, circles };
  document.addEventListener('pointermove', cardDragMove);
  document.addEventListener('pointerup', cardDragEnd);
  document.addEventListener('pointercancel', cardDragEnd);
}

function cardDragMove(e) {
  if (!_drag) return;
  const dx = e.clientX - _drag.startX;
  const dy = e.clientY - _drag.startY;
  if (!_drag.moved) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    _drag.moved = true;
    const me = actionSeat();
    const card = S.players[me].hand[_drag.cardIndex];
    _drag.ghost = document.createElement('div');
    _drag.ghost.innerHTML = dragGhostHTML(card);
    _drag.ghost = _drag.ghost.firstElementChild;
    document.body.appendChild(_drag.ghost);
    const src = document.querySelectorAll('.hand-row .card')[_drag.cardIndex];
    if (src) src.classList.add('dragging');
  }
  // transform 定位（像素偏移，不用百分比）：合成层移动，不触发布局
  _drag.ghost.style.transform = `translate(${e.clientX - GHOST_W / 2}px, ${e.clientY - GHOST_H / 2}px) rotate(-4deg)`;
  // 几何命中：指针在哪个区域圆内（已放满/无法放牌的区域不可作为落点）
  let segIdx = -1;
  for (let k = _drag.circles.length - 1; k >= 0; k--) {
    const c = _drag.circles[k];
    const d = Math.hypot(e.clientX - c.cx, e.clientY - c.cy);
    if (d <= c.r * 1.1 && !segFull(k) && !segBlocked(k)) { segIdx = k; break; }
  }
  if (segIdx !== _drag.seg) {
    const segs = document.querySelectorAll('.seg');
    if (_drag.seg >= 0 && segs[_drag.seg]) segs[_drag.seg].classList.remove('drag-hover');
    _drag.seg = segIdx;
    if (segIdx >= 0 && segs[segIdx]) segs[segIdx].classList.add('drag-hover');
  }
}

function cardDragEnd() {
  if (!_drag) return;
  document.removeEventListener('pointermove', cardDragMove);
  document.removeEventListener('pointerup', cardDragEnd);
  document.removeEventListener('pointercancel', cardDragEnd);
  const drag = _drag;
  _drag = null;
  if (drag.ghost) drag.ghost.remove();
  const segs = document.querySelectorAll('.seg');
  if (drag.seg >= 0 && segs[drag.seg]) segs[drag.seg].classList.remove('drag-hover');
  if (!drag.moved || drag.seg < 0) { render(); return; } // 落空/轻触：牌保持手牌区
  selectCard(drag.cardIndex);
  if (pendingPlay) pendingPlay.seg = drag.seg;
  render();
}

function renderPlaySheet() {
  const sheet = document.getElementById('playSheet');
  if (!sheet) return;
  const content = document.getElementById('playSheetContent');
  if (!pendingPlay) { sheet.classList.remove('show'); return; }
  const me = actionSeat();
  if (me === null) { sheet.classList.remove('show'); return; }
  const card = S.players[me].hand[pendingPlay.cardIndex];
  if (!card) { sheet.classList.remove('show'); return; }

  const left = eyeLeft();
  const segGrid = pendingPlay.seg >= 0 ? '' : `<div class="seg-grid">${S.segments.map((seg, i) => {
    const visibleSum = seg.cards.filter(c => c.revealed).reduce((a, c) => a + c.v, 0);
    const sel = pendingPlay.seg === i ? ' sel' : '';
    const full = segFull(i);
    const blocked = segBlocked(i);
    const sub = blocked
      ? `无法放牌${seg.cards.length ? '·' + seg.cards.length + '张' : ''}`
      : `${seg.cards.length}张${full ? '·已满' : ''}${!full && visibleSum ? '·' + visibleSum : ''}`;
    return `<button class="seg-btn${sel}${blocked ? ' blocked' : ''}" onclick="pickSeg(${i})" ${full || blocked ? 'disabled' : ''}>
      区域${segNumber(i)}<span class="sg-sub">${sub}</span>
    </button>`;
  }).join('')}</div>`;
  const title = pendingPlay.seg >= 0
    ? `是否将 ${cardBigHTML(card)} 放置到 <b>${segNumber(pendingPlay.seg)}号区域</b>？`
    : `将 ${cardBigHTML(card)} 放置到哪个区域？`;

  const eyeChip = left > 0
    ? `<label class="eye-opt" onclick="toggleEye()"><span class="eye-box">${pendingPlay.useEye ? '☑' : '☐'}</span> 明置此牌（消耗1眼标记，剩${left}）</label>`
    : `<div class="eye-opt off">👁 眼标记已用完，此牌将暗置打出</div>`;

  // 第7章「摸1张」：目标区域放置后放牌玩家会摸1张备用牌
  const segCondNow = pendingPlay.seg >= 0 && S.segCond ? S.segCond[pendingPlay.seg] : null;
  const drawHint = segCondNow && segCondNow.key === 'draw1'
    ? `<div class="wait-text">该区域「摸1张」：放置后从未加入游戏的备用牌堆摸 1 张到手牌</div>`
    : '';
  // 第8章旋转区域：放置后区域编号与规则一起旋转
  const rotHint = segCondNow && (segCondNow.key === 'cw' || segCondNow.key === 'ccw')
    ? `<div class="wait-text">该区域「${segCondNow.key === 'cw' ? '顺时针旋转' : '逆时针旋转'}」：放置后 6 个区域的编号与规则一起${segCondNow.key === 'cw' ? '顺' : '逆'}时针旋转 1 格（牌留在原位）</div>`
    : '';

  content.innerHTML = `
    <h3>${title}</h3>
    ${segGrid}
    ${eyeChip}
    ${drawHint}
    ${rotHint}
    <button class="btn-full btn-primary" onclick="placeCard()" ${pendingPlay.seg === -1 ? 'disabled' : ''}>确认放置</button>
    <button class="btn-full btn-secondary" onclick="closePlaySheet()">取消</button>`;
  sheet.classList.add('show');
}

// ========================================
// 1号位条件选择器（顶部选中滚轮：6 个条件全部可见，选中项固定第一行）
// ========================================

const COND_ITEM_H = 58;      // 单项高度（与 .wheel-item 一致）
const COND_ROUNDS = 3;       // 渲染 3 轮实现循环滚动
let _wheel = null;           // { index, topItem, offset, dragging, startY, baseOffset, velocity, lastY, lastT, list }

function condItems() {
  const lib = CHALLENGE_LIB[S.challenge.id];
  return lib && lib.conds ? lib.conds : [];
}

function condClamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function openCondPicker() {
  if (S.phase !== 'discuss' || !isHost()) return;
  const lib = CHALLENGE_LIB[S.challenge.id];
  if (!lib || !lib.rotate) return;
  let ov = document.getElementById('condOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'condOverlay';
    ov.className = 'cond-overlay';
    document.body.appendChild(ov);
  }
  const conds = condItems();
  const items = Array.from({ length: COND_ROUNDS * conds.length }, (_, k) => {
    const c = conds[k % conds.length];
    return `<div class="wheel-item${c.key === 'free' ? ' free' : ''}">${esc(c.label)}</div>`;
  }).join('');
  const previewing = !!S.segCond;
  ov.innerHTML = `
    <div class="cond-sheet">
      <h3>${previewing ? '调整' : '选择'} 1 号位的条件</h3>
      <div class="wheel-sub">选中的条件放到 1 号位，其余按下方顺序顺延</div>
      <div class="wheel-view" id="wheelView">
        <div class="wheel-list" id="wheelList">${items}</div>
        <div class="wheel-line"></div>
      </div>
      <div class="wheel-current" id="wheelCurrent"></div>
      <div class="wheel-tip">${previewing ? '当前为预览：可反复调整，看牌后锁定' : '预览后所有玩家可见区域规则，看牌前可反复调整'}</div>
      <button class="btn-full btn-primary" onclick="confirmCondPick()">预览</button>
      <button class="btn-full btn-secondary" onclick="closeCondPicker()">取消</button>
    </div>`;
  _wheel = {
    index: 0, topItem: conds.length, offset: -conds.length * COND_ITEM_H,
    dragging: false, velocity: 0, list: document.getElementById('wheelList'),
  };
  _wheel.list.style.transform = `translateY(${_wheel.offset}px)`; // 初始定位：conds[0] 对准顶部选中线
  void ov.offsetHeight; // 强制初始帧（sheet 处于 translateY(100%)），否则过渡不触发、抽屉变成直接出现
  ov.classList.add('show');
  bindWheelEvents();
  updateWheelRender();
}

function closeCondPicker() {
  const ov = document.getElementById('condOverlay');
  if (ov) ov.classList.remove('show');
  _wheel = null;
}

function confirmCondPick() {
  if (!_wheel) return;
  const idx = _wheel.index;
  closeCondPicker();
  chooseFirstCond(idx);
}

/** 循环归一到 [0, n) */
function normIdx(v, n) {
  return ((v % n) + n) % n;
}

/** 吸附：raw 为 18 项内的目标下标（无边界，可无限循环） */
function snapWheel(raw) {
  _wheel.index = normIdx(raw, condItems().length);
  _wheel.topItem = raw;
  _wheel.offset = -raw * COND_ITEM_H;
  reflowList();
}

/**
 * 无限循环：topItem 越过中间轮（[n, 2n)）时，把整轮 DOM 平移到另一端，
 * 并同步 offset，视觉上无缝衔接，保证任意位置下 6 项都可见。
 */
function reflowList() {
  const n = condItems().length;
  const list = _wheel.list;
  while (_wheel.topItem >= 2 * n) {
    _wheel.topItem -= n;
    _wheel.offset += n * COND_ITEM_H;
    if (_wheel.dragging) _wheel.baseOffset += n * COND_ITEM_H;
    for (let k = 0; k < n; k++) list.appendChild(list.children[0]);
  }
  while (_wheel.topItem < n) {
    _wheel.topItem += n;
    _wheel.offset -= n * COND_ITEM_H;
    if (_wheel.dragging) _wheel.baseOffset -= n * COND_ITEM_H;
    for (let k = 0; k < n; k++) list.prepend(list.children[list.children.length - 1]);
  }
  list.style.transform = `translateY(${_wheel.offset}px)`;
}

function bindWheelEvents() {
  const view = document.getElementById('wheelView');
  if (!view || !_wheel) return;
  const list = _wheel.list;
  const n = condItems().length;
  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  view.onpointerdown = (e) => {
    if (!_wheel) return;
    _wheel.dragging = true;
    _wheel.startY = e.clientY;
    _wheel.baseOffset = _wheel.offset;
    _wheel.velocity = 0;
    _wheel.lastY = e.clientY;
    _wheel.lastT = now();
    if (view.setPointerCapture) view.setPointerCapture(e.pointerId);
    list.style.transition = 'none';
  };
  view.onpointermove = (e) => {
    if (!_wheel || !_wheel.dragging) return;
    const t = now();
    const dt = t - _wheel.lastT;
    const inst = dt > 0 ? (e.clientY - _wheel.lastY) / dt : 0;
    _wheel.velocity = 0.75 * _wheel.velocity + 0.25 * inst;
    _wheel.lastY = e.clientY;
    _wheel.lastT = t;
    _wheel.offset = _wheel.baseOffset + (e.clientY - _wheel.startY);
    list.style.transform = `translateY(${_wheel.offset}px)`;
    // 高亮顶部对准项（仅在变化时更新 DOM，避免拖动卡顿）
    const t2 = Math.round(-_wheel.offset / COND_ITEM_H);
    if (t2 !== _wheel.topItem) {
      _wheel.topItem = t2;
      _wheel.index = normIdx(t2, n);
      reflowList();
      updateWheelRender();
    }
  };
  const endDrag = () => {
    if (!_wheel || !_wheel.dragging) return;
    _wheel.dragging = false;
    const start = _wheel.offset;
    const glide = condClamp(_wheel.velocity * 160, -2.2 * COND_ITEM_H, 2.2 * COND_ITEM_H);
    const raw = Math.round(-(start + glide) / COND_ITEM_H);
    // 先按吸附目标归位 DOM：transform 瞬时换算到新坐标系（视觉不变），
    // 再启用过渡吸附，动画起点与目标同坐标系，内容不会往回倒（回弹）
    _wheel.topItem = raw;
    _wheel.offset = start;
    reflowList();
    void list.offsetHeight; // 强制提交瞬时位移，过渡从该位置开始
    list.style.transition = 'transform .3s cubic-bezier(.18,.85,.3,1.05)';
    snapWheel(raw);
    updateWheelRender();
  };
  view.onpointerup = endDrag;
  view.onpointercancel = endDrag;
}

/** 更新列表高亮与当前选中文案（仅顶部对准项变化时调用） */
function updateWheelRender() {
  const list = _wheel && _wheel.list;
  const cur = document.getElementById('wheelCurrent');
  if (!list || !_wheel) return;
  const items = list.children;
  // 拖动中隐藏高亮框：半透明金色背景随列表 transform 移动会产生残影重影，
  // 顶部选中线 + 下方文案已实时指明对准项，松手吸附后再显示高亮
  const show = !_wheel.dragging;
  for (let i = 0; i < items.length; i++) items[i].classList.toggle('active', show && i === _wheel.topItem);
  const c = condItems()[_wheel.index];
  if (cur && c) cur.innerHTML = `1号位：<b>${esc(c.label)}</b>（其余按下方顺序顺延）`;
}

// ========================================
// 着陆页
// ========================================

/** 首页右上角规则弹层 */
function showRulesModal() {
  const box = document.getElementById('modalContent');
  box.innerHTML = `
    <h2 class="log-modal-title">📖 游戏规则</h2>
    <div class="rules-body">
      <p>🕰️ 支持 2~4 人合作的游戏，桌上有一个 1~6 号的钟面，玩家轮流将手牌的一张放进区域，所有手牌打出后翻开结算</p>
      <p>🃏 <b>牌库</b>：☀ 太阳牌、☾ 月亮牌数字各 1~12，每局随机抽 12 张均分给玩家（2人各6张 / 3人各4张 / 4人各3张）</p>
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
        <tr><td>3. 各区域总和<b>不大于 24</b>（第 1 章前三关除外）</td></tr>
      </table>
      <p>👁 <b>眼标记</b>：初始数量 = 玩家人数；未通关则额外增加 1 个（至多 3 个），通关后清零。</p>
      <p class="rules-note"> 2 人局特殊规则：每人 6 张牌，看牌时只展示前 4 张；双方各打出 2 张后，后 2 张才解锁可见。</p>
    </div>
    <button class="btn-full btn-secondary" onclick="closeModal('modalOverlay')" style="margin-top:14px;">知道了</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}

/* 首页主视觉：金色天文钟盘 + 月相徽章 + 蜻蜓/荷叶（纯 SVG） */
function _landingHeroSVG() {
  const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  let ticks = '';
  for (let k = 0; k < 72; k++) {
    const major = k % 6 === 0;
    ticks += `<line x1="220" y1="${major ? 45 : 46}" x2="220" y2="${major ? 33 : 41}" transform="rotate(${k * 5} 220 220)" stroke="url(#ttHeroGold)" stroke-width="${major ? 1.6 : .8}" opacity="${major ? .9 : .4}" stroke-linecap="round"/>`;
  }
  const marks = numerals.map((n, i) =>
    `<g transform="rotate(${i * 30} 220 220)"><text x="220" y="68" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="17.5" font-weight="700" letter-spacing="1.5" fill="url(#ttHeroGold)">${n}</text></g>`
  ).join('');

  return `
  <svg class="tt-hero" viewBox="0 0 440 440" aria-hidden="true">
    <defs>
      <radialGradient id="ttHeroDial" cx="44%" cy="34%" r="74%">
        <stop offset="0" stop-color="#3fc6a7"/>
        <stop offset=".3" stop-color="#178d82"/>
        <stop offset=".6" stop-color="#0b4e59"/>
        <stop offset=".85" stop-color="#082b3e"/>
        <stop offset="1" stop-color="#061b2b"/>
      </radialGradient>
      <radialGradient id="ttHeroGlow" cx="42%" cy="32%" r="62%">
        <stop offset="0" stop-color="#6be0bd" stop-opacity=".5"/>
        <stop offset=".45" stop-color="#21998d" stop-opacity=".16"/>
        <stop offset="1" stop-color="#08283a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ttHeroGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff3c6"/>
        <stop offset=".26" stop-color="#eacd83"/>
        <stop offset=".52" stop-color="#b9862f"/>
        <stop offset=".76" stop-color="#f4dc99"/>
        <stop offset="1" stop-color="#c79a42"/>
      </linearGradient>
      <linearGradient id="ttHeroBand" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7d5524"/>
        <stop offset=".28" stop-color="#c79e51"/>
        <stop offset=".5" stop-color="#eed48b"/>
        <stop offset=".72" stop-color="#9a6d2d"/>
        <stop offset="1" stop-color="#573b18"/>
      </linearGradient>
      <radialGradient id="ttHeroCoin" cx="34%" cy="28%" r="78%">
        <stop offset="0" stop-color="#f9eab7"/>
        <stop offset=".55" stop-color="#ccA55a"/>
        <stop offset="1" stop-color="#7f5a24"/>
      </radialGradient>
      <linearGradient id="ttHeroLily" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5cb99c"/>
        <stop offset=".55" stop-color="#2e8a78"/>
        <stop offset="1" stop-color="#155b56"/>
      </linearGradient>
      <linearGradient id="ttHeroWing" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#a9eee0" stop-opacity=".9"/>
        <stop offset="1" stop-color="#2f9295" stop-opacity=".35"/>
      </linearGradient>
      <path id="ttHeroSpark" d="M0,-6 L1.6,-1.6 L6,0 L1.6,1.6 L0,6 L-1.6,1.6 L-6,0 L-1.6,-1.6 Z"/>
      <!-- 俯视荷叶：椭圆盘面 + 楔形缺口 + 叶脉 -->
      <g id="ttHeroPad">
        <path d="M0 0 L12 -22.9 A 40 24 0 1 1 -12 -22.9 Z" fill="url(#ttHeroLily)" stroke="#e6c780" stroke-width="1.1"/>
        <g fill="none" stroke="#c9efda" stroke-width=".7" opacity=".32">
          <path d="M0 0 L-37 -4 M0 0 L-30 12 M0 0 L-12 22 M0 0 L12 22 M0 0 L29 14 M0 0 L37 -3"/>
        </g>
        <path d="M-31 -13 A 34 20 0 0 1 -1 -23" fill="none" stroke="#e8f7e4" stroke-width="1" opacity=".22"/>
      </g>
    </defs>

    <!-- 外圈光晕与星轨 -->
    <circle class="tt-halo" cx="220" cy="220" r="211" fill="none" stroke="url(#ttHeroGold)" stroke-width="1" opacity=".3"/>
    <circle cx="220" cy="220" r="203" fill="none" stroke="url(#ttHeroGold)" stroke-width="1" opacity=".5" stroke-dasharray="1 6" stroke-linecap="round"/>
    <path d="M336 42 A 203 203 0 0 1 421 148" fill="none" stroke="url(#ttHeroGold)" stroke-width=".8" opacity=".5" stroke-dasharray="2 7"/>
    <circle cx="421" cy="148" r="2.2" fill="#f7e6ad" opacity=".8"/>
    <path d="M24 298 A 206 206 0 0 0 106 419" fill="none" stroke="url(#ttHeroGold)" stroke-width=".7" opacity=".25"/>

    <!-- 罗盘尖角 -->
    <g fill="url(#ttHeroGold)">
      <path d="M220 2 L226.5 17 L220 24 L213.5 17 Z"/>
      <path d="M220 438 L226.5 423 L220 416 L213.5 423 Z" opacity=".8"/>
      <path d="M2 220 L17 213.5 L24 220 L17 226.5 Z" opacity=".8"/>
      <path d="M438 220 L423 213.5 L416 220 L423 226.5 Z" opacity=".8"/>
    </g>

    <!-- 刻度 / 铜金环带 / 罗马数字 -->
    <g>${ticks}</g>
    <circle cx="220" cy="220" r="160" fill="none" stroke="url(#ttHeroBand)" stroke-width="30" opacity=".96"/>
    <circle cx="220" cy="220" r="175" fill="none" stroke="url(#ttHeroGold)" stroke-width="2.2"/>
    <circle cx="220" cy="220" r="145" fill="none" stroke="url(#ttHeroGold)" stroke-width="1.6"/>
    <circle cx="220" cy="220" r="140.5" fill="none" stroke="#f2dda0" stroke-width=".8" opacity=".55" stroke-dasharray="2 5"/>
    <g>${marks}</g>

    <!-- 内盘 -->
    <circle cx="220" cy="220" r="135" fill="url(#ttHeroDial)" stroke="#061825" stroke-width="3"/>
    <circle cx="220" cy="220" r="135" fill="url(#ttHeroGlow)"/>
    <circle cx="220" cy="220" r="124" fill="none" stroke="#f0d99c" stroke-width=".8" opacity=".34" stroke-dasharray="1 6"/>
    <circle cx="220" cy="220" r="105" fill="none" stroke="#f0d99c" stroke-width=".6" opacity=".18"/>
    <g fill="url(#ttHeroGold)" opacity=".55">
      <path d="M220 104 l2.6 4.4 -2.6 4.4 -2.6 -4.4 Z"/>
      <path d="M336 220 l4.4 2.6 -4.4 2.6 -4.4 -2.6 Z"/>
      <path d="M220 336 l2.6 4.4 -2.6 4.4 -2.6 -4.4 Z"/>
      <path d="M104 220 l4.4 2.6 -4.4 2.6 -4.4 -2.6 Z"/>
    </g>

    <!-- 盘中星图 -->
    <g stroke="url(#ttHeroGold)" stroke-width=".8" opacity=".5" fill="none">
      <path d="M104 158 L122 133 L146 143 L137 168"/>
    </g>
    <g fill="#f7e6ad">
      <circle cx="104" cy="158" r="1.7"/><circle cx="122" cy="133" r="1.2"/>
      <circle cx="146" cy="143" r="1.5"/><circle cx="137" cy="168" r="1"/>
      <circle cx="304" cy="130" r="1.3" opacity=".8"/>
      <circle cx="326" cy="292" r="1.6" opacity=".7"/>
      <circle cx="128" cy="296" r="1.1" opacity=".6"/>
      <circle cx="272" cy="332" r="1.2" opacity=".7"/>
    </g>
    <use href="#ttHeroSpark" class="tt-twinkle" transform="translate(292 118) scale(.7)" fill="#ffeebc"/>
    <use href="#ttHeroSpark" class="tt-twinkle tt-tw2" transform="translate(320 258) scale(.5)" fill="#ffeebc"/>
    <use href="#ttHeroSpark" class="tt-twinkle tt-tw3" transform="translate(132 248) scale(.55)" fill="#ffeebc"/>

    <!-- 盘中旧式指针（压低存在感，只作纹理） -->
    <g opacity=".16" stroke="url(#ttHeroGold)" stroke-linecap="round">
      <path d="M220 220 L166 158" stroke-width="3"/>
      <path d="M220 220 L272 176" stroke-width="1.6"/>
      <circle cx="220" cy="220" r="5" fill="url(#ttHeroGold)" stroke="none"/>
    </g>

    <!-- 月相徽章 -->
    <g class="tt-coin" transform="translate(58 110) rotate(-8)">
      <circle r="23" fill="url(#ttHeroCoin)" stroke="#6d4c20" stroke-width="1.2"/>
      <circle r="18.5" fill="#0c2a38" stroke="#efd99f" stroke-width="1"/>
      <circle r="15" fill="none" stroke="#c9a558" stroke-width=".6" stroke-dasharray="2 2"/>
      <circle cx="-2" cy="-1" r="8" fill="url(#ttHeroGold)"/>
      <circle cx="4" cy="3" r="7" fill="#0c2a38"/>
      <circle cx="10" cy="-11" r="1.3" fill="#f7e6ad"/>
    </g>
    <g class="tt-coin" transform="translate(382 110) rotate(8)">
      <circle r="23" fill="url(#ttHeroCoin)" stroke="#6d4c20" stroke-width="1.2"/>
      <circle r="18.5" fill="#0c2a38" stroke="#efd99f" stroke-width="1"/>
      <circle r="15" fill="none" stroke="#c9a558" stroke-width=".6" stroke-dasharray="2 2"/>
      <rect x="-9.5" y="-10" width="19" height="3" rx="1.5" fill="url(#ttHeroGold)"/>
      <rect x="-9.5" y="7" width="19" height="3" rx="1.5" fill="url(#ttHeroGold)"/>
      <path d="M-7 -7 H7 L1 0 L7 7 H-7 L-1 0 Z" fill="url(#ttHeroGold)"/>
      <circle cx="10" cy="-11" r="1.3" fill="#f7e6ad"/>
    </g>

    <!-- 蜻蜓 -->
    <g transform="translate(390 300) rotate(12)">
      <g class="tt-dragonfly">
        <path d="M0,-4 C-24,-30 -42,-26 -30,-6 C-20,8 -6,6 0,2 Z" fill="url(#ttHeroWing)" stroke="#efd99f" stroke-width=".9"/>
        <path d="M0,0 C-28,2 -40,16 -22,24 C-10,29 -2,18 0,8 Z" fill="url(#ttHeroWing)" stroke="#efd99f" stroke-width=".9"/>
        <path d="M2,-4 C26,-30 44,-26 32,-6 C22,8 8,6 2,2 Z" fill="url(#ttHeroWing)" stroke="#efd99f" stroke-width=".9"/>
        <path d="M2,0 C30,2 42,16 24,24 C12,29 4,18 2,8 Z" fill="url(#ttHeroWing)" stroke="#efd99f" stroke-width=".9"/>
        <rect x="-1.5" y="-10" width="3" height="40" rx="1.5" fill="url(#ttHeroGold)"/>
        <circle cx="0" cy="-11" r="3" fill="#0b2433" stroke="#efd99f" stroke-width=".8"/>
        <path d="M-1,-14 L-5,-20 M1,-14 L5,-20" stroke="#efd99f" stroke-width=".7" stroke-linecap="round" fill="none"/>
      </g>
    </g>

    <!-- 荷叶 -->
    <g class="tt-lilies">
      <use href="#ttHeroPad" transform="translate(60 372) rotate(-8)"/>
      <use href="#ttHeroPad" transform="translate(24 412) rotate(16) scale(.62)" opacity=".95"/>
      <use href="#ttHeroPad" transform="translate(114 428) rotate(-30) scale(.44)" opacity=".85"/>
      <ellipse cx="62" cy="396" rx="52" ry="11" fill="none" stroke="#efd99f" stroke-width=".7" opacity=".16"/>
      <path d="M2 430 Q 44 416 96 430" fill="none" stroke="#efd99f" stroke-width=".7" opacity=".18"/>
    </g>

    <!-- 右下弦月 + 星屑 -->
    <g transform="translate(366 370)">
      <path d="M2 -10 A10 10 0 1 1 -7 7 A7.6 7.6 0 1 0 2 -10 Z" fill="url(#ttHeroGold)"/>
      <circle cx="15" cy="-11" r="1.4" fill="#f7e6ad" opacity=".9"/>
      <use href="#ttHeroSpark" class="tt-twinkle tt-tw4" transform="translate(10 14) scale(.45)" fill="#ffeebc"/>
    </g>

    <!-- 左上星图 -->
    <g stroke="url(#ttHeroGold)" stroke-width=".8" opacity=".45" fill="none">
      <path d="M30 58 L56 38 L80 50 L72 74"/>
    </g>
    <g fill="#f7e6ad" opacity=".8">
      <circle cx="30" cy="58" r="1.5"/><circle cx="56" cy="38" r="1.1"/>
      <circle cx="80" cy="50" r="1.4"/><circle cx="72" cy="74" r="1"/>
    </g>
  </svg>`;
}

function renderLandingHTML() {
  return `
  <div class="landing">
    <div class="rules-corner"><button class="icon-btn landing-rules" onclick="showRulesModal()">规则</button></div>
    <div class="landing-main">
      <div class="landing-hero">
        ${_landingHeroSVG()}
        <div class="hero-copy">
          <h1>时序谜局</h1>
          <span class="hero-en">TAKE TIME</span>
          <span class="hero-ornament" aria-hidden="true"><i></i></span>
        </div>
      </div>
      <p class="landing-subtitle"><span>2~4 人</span><i aria-hidden="true"></i><span>合作默契解谜</span></p>
      <div class="landing-actions">
        <!--ONLINE_BTN-->
      </div>
    </div>
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
    <div class="header-title">🕰️ 时序谜局 <span class="ch-tag">第${ch.chapter}章·第${ch.test}关</span></div>
    <div class="header-btns"><button class="icon-btn" onclick="showRulesModal()">📖 规则</button></div>
  </div>
  ${logHTML()}
  ${clockHTML()}
  ${playersBarHTML()}
  ${handHTML()}
  <div class="action-box">${actionHTML()}</div>
  `;

  renderPlaySheet();
  playCondRotateAnim();

  // 入场动效只播一次：渲染后清除 fresh，避免后续 render（点选手牌等）重播动画
  S.segments.forEach(seg => seg.cards.forEach(c => { c.fresh = false; }));

  // 聚光灯本地动画（不推送）
  if (S.phase === 'spin' && S.spin.running) {
    if (!spinTimer) spinTimer = setInterval(spinTick, 170);
  } else if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }

  if (typeof onlineAfterRender === 'function') onlineAfterRender();

  // 成员侧接收房主推送的 allDone 状态后弹出「恭喜通关」
  if (S.allDone && typeof showAllDoneModal === 'function') showAllDoneModal();
}
