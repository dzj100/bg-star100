/**
 * 炸弹克星 (Bomb Busters) — 渲染层
 * 职责：着陆页 / 标记阶段 / 对局界面 / 行动交互弹层 / 结算面板 / 动效
 * 依赖：game.js（全局 S、doPairCut、doSoloCut、doScan、_eachCard、EQUIPMENT_LIB…；window.S 访问器）
 */

/* ============================================================
   工具
   ============================================================ */

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

/* ============================================================
   UI 本地状态（不共享）与动效快照
   ============================================================ */

let _ui = {
  mode: null,          // null | pair-target | pair-guess | pair-own | solo | scan | scan-guess | scan-own
                       // | neq | walkie-card | walkie-target | log | sticky | eqtag
                       // | super | super-guess | super-own | ray-target | ray-guess | ray-own
                       // | battery | radar | coffee
  targetSeat: null,
  targetCardId: null,
  guess: null,         // {kind:'blue',num} | {kind:'yellow'}
  ownCard: null,       // 自选公开牌 id
  scanSrc: null,       // 'skill' | 'eq3' | 'eq5'
  scanSel: [],         // 扫描/≠/＝ 选择集 [{seat, si, idx, id}]
  fromCardId: null,    // 对讲机：我挑出的牌
  superShare: null,    // 超级探测器：目标份下标
  rayOpts: [],         // X/Y射线：两个猜测选项 [{kind,num}]
  rayOwn: { a: null, b: null }, // X/Y射线：两选项对应自选牌 id
  batterySel: [],      // 备用电池：已选玩家座位
};

let _prevAnim = { first: true, dealStamp: null, failures: 0, revealed: new Set(), defused: null };

/* ============================================================
   弹窗 / 弹层
   ============================================================ */

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

function closeSheet() {
  const ov = document.getElementById('sheetOverlay');
  if (ov) ov.classList.remove('show');
  _ui.mode = null;
  _ui.targetSeat = null;
  _ui.targetCardId = null;
  _ui.guess = null;
  _ui.ownCard = null;
  _ui.scanSrc = null;
  _ui.scanSel = [];
  _ui.fromCardId = null;
  _ui.superShare = null;
  _ui.rayOpts = [];
  _ui.rayOwn = { a: null, b: null };
  _ui.batterySel = [];
  render();
}

function _openSheet() {
  const ov = document.getElementById('sheetOverlay');
  if (ov) ov.classList.add('show');
}

/** 根据 _ui.mode 刷新弹层内容（弹层在 #app 之外，render 后需独立刷新） */
function _refreshSheet() {
  const content = document.getElementById('sheetContent');
  if (!content) return;
  let html = null;
  if (_ui.mode === 'solo') html = _soloSheetHTML();
  else if (_ui.mode === 'pair-guess' || _ui.mode === 'scan-guess' || _ui.mode === 'super-guess') html = _guessSheetHTML();
  else if (_ui.mode === 'pair-own' || _ui.mode === 'scan-own' || _ui.mode === 'super-own') html = _ownPickSheetHTML();
  else if (_ui.mode === 'walkie-target') html = _walkieTargetSheetHTML();
  else if (_ui.mode === 'ray-guess') html = _rayGuessSheetHTML();
  else if (_ui.mode === 'ray-own') html = _rayOwnSheetHTML();
  else if (_ui.mode === 'battery') html = _batterySheetHTML();
  else if (_ui.mode === 'radar') html = _radarSheetHTML();
  else if (_ui.mode === 'coffee') html = _coffeeSheetHTML();
  else if (_ui.mode === 'log') html = _logListHTML();
  if (html !== null) content.innerHTML = html;
}

/* ============================================================
   基础查询
   ============================================================ */

function _actorSeat() {
  if (!S || !S.players) return null;
  if (S.freeCut) {
    if (S.phase !== 'play') return null;
    const mine = mySeat();
    if (mine !== null) return _freeCutEligible(mine) ? mine : null;
    if (typeof S.currentSeat === 'number' && S.currentSeat >= 0
        && S.players[S.currentSeat] && _freeCutEligible(S.currentSeat)) {
      return S.currentSeat;
    }
    return null;
  }
  if (typeof S.currentSeat !== 'number' || S.currentSeat < 0) return null;
  if (!S.players[S.currentSeat]) return null;
  return S.currentSeat;
}

/** 是否轮到本设备行动 */
function _myTurn() {
  if (!S || S.phase !== 'play' || S.pending || S.result || S.fx) return false;
  const a = _actorSeat();
  return a !== null && canActAs(a);
}

function _playerName(seat) {
  return (S && S.players && S.players[seat]) ? S.players[seat].name : '玩家' + (seat + 1);
}

function _locateCard(seat, cardId) {
  const p = S && S.players && S.players[seat];
  if (!p) return null;
  for (let si = 0; si < (p.shares || []).length; si++) {
    const idx = p.shares[si].findIndex(c => c.id === cardId);
    if (idx >= 0) return { si, idx };
  }
  return null;
}

/* ============================================================
   着陆页
   ============================================================ */

/** 炸药捆+定时器（着陆页装饰与对局头部共用） */
function _bombSVG(className) {
  return `
  <svg class="${className}" viewBox="0 0 170 152" aria-hidden="true">
    <g stroke="#25324e" stroke-width="3.5">
      <rect x="14" y="16" width="34" height="106" rx="17" fill="#e8402a"/>
      <rect x="68" y="10" width="34" height="112" rx="17" fill="#e8402a"/>
      <rect x="122" y="18" width="34" height="104" rx="17" fill="#e8402a"/>
    </g>
    <g stroke="#25324e" stroke-width="3">
      <ellipse cx="31" cy="26" rx="13.5" ry="7.5" fill="#ff9b76"/>
      <ellipse cx="85" cy="20" rx="13.5" ry="7.5" fill="#ff9b76"/>
      <ellipse cx="139" cy="28" rx="13.5" ry="7.5" fill="#ff9b76"/>
    </g>
    <ellipse cx="31" cy="26" rx="6" ry="3" fill="#d33222"/>
    <ellipse cx="85" cy="20" rx="6" ry="3" fill="#d33222"/>
    <ellipse cx="139" cy="28" rx="6" ry="3" fill="#d33222"/>
    <rect x="27" y="46" width="6" height="54" rx="3" fill="#ff7a5c" opacity=".75"/>
    <rect x="81" y="42" width="6" height="58" rx="3" fill="#ff7a5c" opacity=".75"/>
    <rect x="135" y="48" width="6" height="52" rx="3" fill="#ff7a5c" opacity=".75"/>
    <rect x="4" y="62" width="162" height="20" rx="9" fill="#25324e"/>
    <rect x="76" y="64" width="18" height="16" rx="4" fill="#f6b62b"/>
    <rect x="36" y="70" width="98" height="74" rx="11" fill="#1d2a44" stroke="#25324e" stroke-width="3.5"/>
    <rect x="46" y="79" width="78" height="30" rx="5" fill="#0e1a33" stroke="#3d5378" stroke-width="2.5"/>
    <text x="85" y="101" text-anchor="middle" fill="#7fd7ff" font-size="21" font-weight="800" letter-spacing="3" font-family="ui-monospace, Consolas, Menlo, monospace">00:02</text>
    <circle cx="57" cy="124" r="9.5" fill="#e8402a" stroke="#25324e" stroke-width="3"/>
    <circle cx="54" cy="121" r="3" fill="#fff" opacity=".65"/>
    <g fill="#3a4d75">
      <rect x="76" y="108" width="13" height="10" rx="3"/><rect x="92" y="108" width="13" height="10" rx="3"/><rect x="108" y="108" width="13" height="10" rx="3"/>
      <rect x="76" y="121" width="13" height="10" rx="3"/><rect x="92" y="121" width="13" height="10" rx="3"/><rect x="108" y="121" width="13" height="10" rx="3"/>
    </g>
  </svg>`;
}

/** 着陆页散落装饰（纯 SVG，无图片）：炸药捆+定时器 / 导线 / 剪刀 / 兔子 / 猫 / 小狗 / 闪光 */
function _landingDecoHTML() {
  return `
  <svg class="deco deco-wire" viewBox="0 0 168 120" aria-hidden="true">
    <g fill="none" stroke-linecap="round">
      <path d="M14,88 C34,30 60,24 80,62 C94,90 114,94 140,58" stroke="#25324e" stroke-width="13"/>
      <path d="M8,46 C44,64 54,98 86,90 C114,84 120,44 146,42" stroke="#25324e" stroke-width="13"/>
      <path d="M18,66 C58,86 68,42 98,54 C122,64 126,86 142,76" stroke="#25324e" stroke-width="13"/>
      <path d="M14,88 C34,30 60,24 80,62 C94,90 114,94 140,58" stroke="#dc3d36" stroke-width="7.5"/>
      <path d="M8,46 C44,64 54,98 86,90 C114,84 120,44 146,42" stroke="#eac31e" stroke-width="7.5"/>
      <path d="M18,66 C58,86 68,42 98,54 C122,64 126,86 142,76" stroke="#54989e" stroke-width="7.5"/>
    </g>
    <g transform="translate(146,54) rotate(-30)">
      <rect x="-10" y="-8" width="28" height="16" rx="5" fill="#cfd8e8" stroke="#25324e" stroke-width="3.5"/>
      <rect x="-3" y="-3.5" width="14" height="7" rx="2.5" fill="#8b97ad"/>
    </g>
    <g transform="translate(142,78) rotate(16)">
      <rect x="-8" y="-6" width="20" height="12" rx="4" fill="#cfd8e8" stroke="#25324e" stroke-width="3.5"/>
    </g>
  </svg>
  <svg class="deco deco-scissors" viewBox="0 0 90 92" aria-hidden="true">
    <circle cx="30" cy="72" r="11" fill="#f6b62b" stroke="#25324e" stroke-width="3.5"/>
    <circle cx="30" cy="72" r="5" fill="#f8f2e3" stroke="#25324e" stroke-width="2.5"/>
    <circle cx="60" cy="72" r="11" fill="#f6b62b" stroke="#25324e" stroke-width="3.5"/>
    <circle cx="60" cy="72" r="5" fill="#f8f2e3" stroke="#25324e" stroke-width="2.5"/>
    <path d="M26,63 L64,14 L74,22 L36,71 Z" fill="#e7edf6" stroke="#25324e" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M64,63 L26,14 L16,22 L54,71 Z" fill="#e7edf6" stroke="#25324e" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="45" cy="43" r="4" fill="#25324e"/>
  </svg>
  <svg class="deco deco-cat" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M18,42 L26,4 L56,26 Z" fill="#8a93a8" stroke="#25324e" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M82,42 L74,4 L44,26 Z" fill="#8a93a8" stroke="#25324e" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M28,32 L32,14 L45,25 Z" fill="#ffc6d9"/>
    <path d="M72,32 L68,14 L55,25 Z" fill="#ffc6d9"/>
    <ellipse cx="50" cy="58" rx="35" ry="31" fill="#8a93a8" stroke="#25324e" stroke-width="3.5"/>
    <ellipse cx="50" cy="76" rx="21" ry="13" fill="#fff" stroke="#25324e" stroke-width="3"/>
    <ellipse cx="36" cy="55" rx="9.5" ry="10.5" fill="#fff" stroke="#25324e" stroke-width="3"/>
    <ellipse cx="64" cy="55" rx="9.5" ry="10.5" fill="#fff" stroke="#25324e" stroke-width="3"/>
    <circle cx="36" cy="56" r="4.5" fill="#25324e"/><circle cx="38" cy="53" r="1.6" fill="#fff"/>
    <circle cx="64" cy="56" r="4.5" fill="#25324e"/><circle cx="66" cy="53" r="1.6" fill="#fff"/>
    <path d="M45,68 L55,68 L50,74 Z" fill="#ff8fa8" stroke="#25324e" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="50" cy="80" rx="6.5" ry="4.5" fill="#25324e"/>
    <ellipse cx="50" cy="82.5" rx="3.2" ry="2.2" fill="#ff8fa8"/>
  </svg>
  <svg class="deco deco-bunny" viewBox="0 0 100 104" aria-hidden="true">
    <ellipse cx="33" cy="27" rx="10" ry="24" fill="#fff" stroke="#25324e" stroke-width="3.5" transform="rotate(-14 33 27)"/>
    <ellipse cx="33" cy="27" rx="4.5" ry="16" fill="#ffc6d9" transform="rotate(-14 33 27)"/>
    <ellipse cx="67" cy="27" rx="10" ry="24" fill="#fff" stroke="#25324e" stroke-width="3.5" transform="rotate(14 67 27)"/>
    <ellipse cx="67" cy="27" rx="4.5" ry="16" fill="#ffc6d9" transform="rotate(14 67 27)"/>
    <ellipse cx="50" cy="66" rx="33" ry="28" fill="#fff" stroke="#25324e" stroke-width="3.5"/>
    <circle cx="26" cy="74" r="5.5" fill="#ffc6d9"/>
    <circle cx="74" cy="74" r="5.5" fill="#ffc6d9"/>
    <path d="M30,62 q7,-9 14,0 M56,62 q7,-9 14,0" fill="none" stroke="#25324e" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M46,72 L54,72 L50,77 Z" fill="#ff8fa8" stroke="#25324e" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M50,77 q0,4 -5,5 M50,77 q0,4 5,5" fill="none" stroke="#25324e" stroke-width="2.5" stroke-linecap="round"/>
  </svg>
  <svg class="deco deco-dog" viewBox="0 0 100 100" aria-hidden="true">
    <ellipse cx="17" cy="55" rx="11" ry="20" fill="#57627a" stroke="#25324e" stroke-width="3.5" transform="rotate(14 17 55)"/>
    <ellipse cx="83" cy="55" rx="11" ry="20" fill="#57627a" stroke="#25324e" stroke-width="3.5" transform="rotate(-14 83 55)"/>
    <ellipse cx="50" cy="52" rx="32" ry="28" fill="#fff" stroke="#25324e" stroke-width="3.5"/>
    <defs><clipPath id="bbd-dog-clip"><ellipse cx="50" cy="52" rx="32" ry="28"/></clipPath></defs>
    <ellipse cx="63" cy="44" rx="16" ry="13" fill="#b9c2d4" clip-path="url(#bbd-dog-clip)"/>
    <circle cx="38" cy="48" r="4" fill="#25324e"/>
    <circle cx="63" cy="48" r="4" fill="#25324e"/>
    <ellipse cx="50" cy="68" rx="17" ry="12.5" fill="#fff" stroke="#25324e" stroke-width="3"/>
    <ellipse cx="50" cy="61" rx="7" ry="5" fill="#25324e"/>
    <path d="M50,66 v5 M50,71 q-6,5 -10,1 M50,71 q6,5 10,1" fill="none" stroke="#25324e" stroke-width="3" stroke-linecap="round"/>
    <path d="M43,73 q7,13 14,0 z" fill="#ff8fa8" stroke="#25324e" stroke-width="3" stroke-linejoin="round"/>
  </svg>
  ${_bombSVG('deco deco-bomb')}
  <svg class="deco deco-star1" viewBox="0 0 24 24" aria-hidden="true"><path d="M12,1.5 L14.6,9.4 L22.5,12 L14.6,14.6 L12,22.5 L9.4,14.6 L1.5,12 L9.4,9.4 Z" fill="#f6b62b" stroke="#25324e" stroke-width="2.2" stroke-linejoin="round"/></svg>
  <svg class="deco deco-star2" viewBox="0 0 24 24" aria-hidden="true"><g fill="#fff" stroke="#25324e" stroke-width="2"><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="17" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="17" width="6" height="6" rx="1.5"/></g></svg>
  <svg class="deco deco-star3" viewBox="0 0 24 24" aria-hidden="true"><path d="M12,1.5 L14.6,9.4 L22.5,12 L14.6,14.6 L12,22.5 L9.4,14.6 L1.5,12 L9.4,9.4 Z" fill="#f6b62b" stroke="#25324e" stroke-width="2.2" stroke-linejoin="round"/></svg>
  <svg class="deco deco-star4" viewBox="0 0 24 24" aria-hidden="true"><g fill="#fff" stroke="#25324e" stroke-width="2"><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="17" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="17" width="6" height="6" rx="1.5"/></g></svg>
  <svg class="deco deco-star5" viewBox="0 0 24 24" aria-hidden="true"><path d="M12,1.5 L14.6,9.4 L22.5,12 L14.6,14.6 L12,22.5 L9.4,14.6 L1.5,12 L9.4,9.4 Z" fill="#f6b62b" stroke="#25324e" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
}

function renderLandingHTML() {
  return `
  <div class="landing">
    ${_landingDecoHTML()}
    <h1 class="landing-title">炸弹克星</h1>
    <div class="landing-sub">2~5 人 · 合作推理桌游</div>
    <div class="landing-tags">
      <span class="landing-tag">🔍 数字推理</span>
      <span class="landing-tag">🤝 全队合作</span>
      <span class="landing-tag">✂️ 剪到红线就爆炸</span>
    </div>
    <div class="landing-btns">
      <!--ONLINE_BTN-->
      <button class="start-btn ghost" onclick="showRules()">📜 规则速览</button>
    </div>
    <div class="credit">@imStar100</div>
  </div>`;
}

/* ============================================================
   规则弹窗（着陆页与对局内共用 #modalOverlay）
   ============================================================ */

function _missionSpecialRulesHTML(mission, pCount) {
  const setup = missionSetup(mission, pCount);
  const blocks = [];
  if (setup.orderCount) {
    const order = (S && S.board && Array.isArray(S.board.orderNums)) ? S.board.orderNums : [];
    blocks.push(`<h3>⏱ 剪线顺序</h3>
      <p>开局随机抽出 ${setup.orderCount} 个蓝色数字作为剪线顺序${order.length ? `：<b>${order.join(' → ')}</b>` : ''}。必须按该顺序公开蓝色导线，前一个数字公开 ≥2 根后才能公开下一个；违反顺序立即爆炸。</p>`);
  }
  if (setup.freeCut) {
    const mins = Math.round((mission.timerSec || 0) / 60);
    const mins2 = Math.round((mission.timerSecTwo || mission.timerSec || 0) / 60);
    blocks.push(`<h3>⌛ 倒计时与自由剪线</h3>
      <p>从发牌后可查看手牌开始 ${mins} 分钟倒计时（2 人局 ${mins2} 分钟）；归零时仍有导线未公开即失败。任意玩家均可剪线，但同一时间只能一人操作；3 人及以上时，刚剪过线的玩家不能连续再剪。</p>`);
    if (setup.excludeEquip.length) {
      const names = setup.excludeEquip.map(n => `【${EQUIPMENT_LIB[n] ? EQUIPMENT_LIB[n].name : n}】`).join('、');
      blocks.push(`<p>本关不会抽到 ${names}，抽到会重抽。</p>`);
    }
  }
  if (setup.redBlueCount) {
    const nums = (S && S.board && Array.isArray(S.board.redBlueNums)) ? S.board.redBlueNums : [];
    blocks.push(`<h3>🔴 蓝线视为红导线</h3>
      <p>开局随机选出 ${setup.redBlueCount} 个数字${nums.length ? `（本局：<b>${nums.join('、')}</b>）` : ''}，这些数字的蓝导线本局视为红色导线：不能作为蓝色被猜测/扫描；只能在该玩家手上只剩这些牌时通过「公开红色导线」公开。对应数字的道具不会出现。</p>
      <p>开局蓝线信息标记仍可正常放置。2 人局：队长不能进行开局蓝线信息标记。</p>`);
  }
  if (setup.equipLocks) {
    const locks = (S && Array.isArray(S.equipment))
      ? S.equipment.filter(e => typeof e.lockNum === 'number').map(e => `道具${e.no} (🔒${e.lockNum})`)
      : [];
    blocks.push(`<h3>🔒 失踪的装备</h3>
      <p>每张道具都被锁上了${locks.length ? `（${locks.join('、 ')}）` : ''}。道具激活需同时满足：原编号蓝色导线全部公开 + 🔒数字在场上公开 ≥2 张。</p>`);
  }
  return blocks.join('');
}

/** 对局内关卡标签：查看本关规则（含本局随机结果） */
function showMissionRules() {
  if (!S || !S.missionId || !MISSIONS[S.missionId]) return;
  const mission = MISSIONS[S.missionId];
  const meta = _missionMeta(mission);
  const pCount = S.pCount || 2;
  const el = document.getElementById('modalContent');
  if (!el) return;
  const setup = missionSetup(mission, pCount);
  const hidden = missionHasHiddenPick(mission)
    ? '<p>数轴板会标出全部候选导线；牌库只随机混入其中「用」的数量，具体哪几条进入本局保密。</p>'
    : '';
  el.innerHTML = `
    <h2>📜 ${_esc(meta.code)} ${_esc(meta.name)}</h2>
    <div class="rules-scroll">
      <h3>🧵 本局导线（${pCount} 人局）</h3>
      <p>${_esc(missionWiresText(setup) || '无红/黄导线')}</p>
      ${hidden}
      ${_missionSpecialRulesHTML(mission, pCount)}
      <h3>🎯 胜利条件</h3>
      <p>全场所有导线全部公开即拆弹成功${setup.freeCut ? '；倒计时内未完成则失败' : ''}。</p>
      <h3>🔁 回合与行动</h3>
      <p>每回合可使用已解锁道具（每张限 1 次），并执行 1 次行动：双人剪线、单人剪线或公开红色导线。开局每人必须公开标记 1 张自己的蓝色导线。</p>
      <h3>💥 失误</h3>
      <p>${pCount} 人局允许 ${pCount - 1} 次失误，第 ${pCount} 次失误失败；指认到红色导线立即爆炸。</p>
    </div>
    <button class="btn-full btn-primary" data-testid="mission-rules-close" onclick="closeModal('modalOverlay')">知道了</button>
    <button class="btn-full btn-secondary" onclick="showRules()">📜 查看完整规则</button>`;
  const ov = document.getElementById('modalOverlay');
  if (ov) ov.classList.add('show');
}

function showRules() {
  const el = document.getElementById('modalContent');
  if (!el) return;
  el.innerHTML = `
    <h2>📜 规则速览</h2>
    <div class="rules-scroll">
      <h3>🎯 胜利条件</h3>
      <p>全队合作：场上所有导线（48 个蓝导线 + X 个黄导线 + X 个红导线）<b>全部公开</b> = 拆弹成功</p>
      <h3>🧩 开局导线分配</h3>
      <p>① 导线构成<u>（红/黄线开局将自动标记到数轴）</u><br>
      · 蓝线 1~12 <b>各 4 张</b>（共 48 张）<br>
      · 红线 1.5~11.5 按关卡随机抽取<br>
      · 黄线 1.1~11.1 按关卡随机抽取<br>
      ② 随机选中一名玩家成为队长，随后全部导线洗混尽可能均分给各个玩家，每份从小到大排列，发牌后每人<b>必须</b>公开标记自己 1 张蓝色导线</p>
      <table>
        <thead><tr><th>人数</th><th>手牌分配</th></tr></thead>
        <tbody>
          <tr><td>2 人</td><td>将导线分成 4 份，每人 2 份</td></tr>
          <tr><td>3 人</td><td>将导线分成 4 份，队长 2 份，其余各 1 份</td></tr>
          <tr><td>4 人</td><td>将导线分成 4 份，每人 1 份</td></tr>
          <tr><td>5 人</td><td>将导线分成 5 份，每人 1 份</td></tr>
        </tbody>
      </table>
      <h3>🔁 回合内操作</h3>
      <p>可随意使用道具、技能，并执行<b>1 次行动</b></p>
      <table>
        <thead><tr><th>行动</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td>✂️ 双人剪线</td><td>指认其他玩家 1 张未公开牌，猜「蓝色 N」或「黄色」<br>
          ✔ 命中 → 该牌与你的同数字（或黄色）牌各公开 1 张<br>
          × 失误 → 该牌真实信息将被标记，并累计 1 次失误<br>
          <b>💥若指认到红色导线 → 立即爆炸！</b></td></tr>
          <tr><td>✂️ 单人剪线</td><td>仅以下场景可以进行：<br>① 某数字已公开 2 张且剩余 2 张都在你手上 → 可公开这 2 张；<br>② 你持有某数字全部 4 张 → 可全部公开；<br>③ 全部未公开黄线都在你手上 → 可全部公开（清收）；</td></tr>
          <tr><td>🚨 公开红线</td><td>持红色导线玩家在自己其他导线全部公开后，可在回合中公开自己剩余的全部红色导线。</td></tr>
        </tbody>
      </table>
      <p>⏭️ 已公开全部手牌的玩家，轮到其回合时将<b>自动跳过</b></p>
      <h3>🔧 道具介绍</h3>
      <p>开局随机抽「人数」张道具加入游戏；某蓝色导线全部拆除时，自动解锁对应编号道具，每张每局限用 1 次</p>
      <table>
        <thead><tr><th>道具</th><th>效果</th></tr></thead>
        <tbody>
          <tr><td>① ≠标签</td><td>选自己同一份相邻 2 张（编号不同、至少 1 张蓝、可含已公开）标【≠】，宣告两张编号不同</td></tr>
          <tr><td>② 📻 对讲机</td><td>与另一名玩家各选 1 张未公开导线交换；双方拿到新导线后<b>自动按照顺序</b>加入手牌</td></tr>
          <tr><td>③ 🔍 三重探测器</td><td>立即剪线：选其他玩家同一份相邻 3 张手牌，猜「其中至少 1 张为蓝色 N」</td></tr>
          <tr><td>④ 📃 便利贴</td><td>再标记自己 1 张未标记的蓝色导线，向全场宣告其数字</td></tr>
          <tr><td>⑤ 🛰️ 超级探测器</td><td>立即剪线：选其他玩家一整份手牌，猜「其中有蓝色 N」，命中者自选 1 张公开</td></tr>
          <tr><td>⑥ 🧯 抑制器</td><td>失误 −1（失误为 0 时不可用）</td></tr>
          <tr><td>⑦ 🔋 备用电池</td><td>恢复 1~2 名本局已用过「双重探测器」者的使用次数</td></tr>
          <tr><td>⑧ 📡 通用雷达</td><td>选一个数字：自动公布每人各手牌是否还有该数字蓝线未公开</td></tr>
          <tr><td>⑨ 🧪 稳定剂</td><td>本回合剪线失误不计、红线不引爆</td></tr>
          <tr><td>⑩ ➿ X/Y射线</td><td>立即剪线：指定其他玩家 1 张牌，进行 2 个选项猜测「（蓝A/蓝B）或（蓝A/黄）」</td></tr>
          <tr><td>⑪ ☕ 咖啡瓶</td><td>跳过自己回合，指定 1 名仍有未公开手牌的玩家接续</td></tr>
          <tr><td>⑫ ＝标签</td><td>选自己同一份相邻 2 张（蓝蓝同数字 / 黄黄 / 红红，至少 1 张未公开）标【＝】，宣告两张编号相同</td></tr>
        </tbody>
      </table>
      <h3>💥 失误</h3>
      <p>允许 人数−1 次失误，第 N 次失误（N = 人数）时游戏失败。（双人剪线时，指认到红色导线时，立刻游戏失败）</p>
      <h3>🔎 双重探测器（每人每局 1 次）</h3>
      <p>本回合的双人剪线升级为：指定他人同一份内相邻 2 张，猜「其中至少 1 张是蓝色 N」。命中 → 对方自选 1 张公开、你公开同数字导线；未命中 → 对方标记 1 张非红色导线。</p>
    </div>
    <button class="btn-full btn-primary" onclick="closeModal('modalOverlay')">知道了</button>`;
  const ov = document.getElementById('modalOverlay');
  if (ov) ov.classList.add('show');
}

/* ============================================================
   日志弹层
   ============================================================ */

function showLogSheet() {
  _ui.mode = 'log';
  _openSheet();
  _refreshSheet();
}

function _lastLogHTML() {
  const list = (S && S.log) || [];
  const last = list[list.length - 1];
  if (!last) return '<span class="log-hint">💬 日志</span>';
  return `<span class="log-msg ${last.cls || ''}">${_esc(last.msg)}</span><span class="log-hint">💬 日志</span>`;
}

function _logListHTML() {
  const list = (S && S.log) ? S.log.slice().reverse() : [];
  return `
  <div class="sheet-head"><span>💬 对局日志</span><button class="sheet-close" onclick="closeSheet()">✕</button></div>
  <div class="log-list">
    ${list.map(l => `<div class="log-item ${l.cls || ''}">${_esc(l.msg)}</div>`).join('')}
  </div>`;
}

/* ============================================================
   主渲染
   ============================================================ */

function render() {
  const app = document.getElementById('app');
  if (!app) { _refreshSheet(); return; }

  if (!S || S.phase === 'landing' || !S.players || !S.players.length) {
    _clearBubbles();
    app.innerHTML = (typeof window.renderLanding === 'function')
      ? window.renderLanding() : renderLandingHTML();
    _refreshSheet();
    if (typeof onlineAfterRender === 'function') onlineAfterRender();
    return;
  }

  if (S.phase === 'mark') app.innerHTML = _gameShellHTML(_markViewHTML());
  else app.innerHTML = _gameShellHTML(_gameViewHTML());

  // 发牌后吐司提示全员进入标记操作（按局去重，联机各端各自弹出）
  if (S.phase === 'mark' && window._markToastFor !== S.dealStamp) {
    window._markToastFor = S.dealStamp;
    showToast('📌 已发牌！请点击自己的 1 张蓝色导线放置信息标记');
  }

  // 结算弹窗：按 局标识+结果 去重，每局每设备只自动弹一次
  if (S.phase === 'over' && S.result) {
    const key = (S.dealStamp || 0) + '|' + (S.result.win ? 'win' : (S.result.reason || 'boom'));
    if (window._endShownFor !== key) {
      window._endShownFor = key;
      showEndModal();
    }
  } else {
    // 新一局/回对局：关掉遗留的上一局结算弹窗（房主「再来一局」时远端设备必须自动关闭）
    const em = document.getElementById('endModal');
    if (em && em.classList.contains('show')) em.classList.remove('show');
  }

  _applyAnimations(app);
  _fitCardRows(app);
  _refreshSheet();
  if (typeof onlineAfterRender === 'function') onlineAfterRender();
}

/** 当前关卡小标签（#4 等），点击查看本关规则 */
function _missionTagHTML() {
  if (!S || !MISSIONS || !MISSIONS[S.missionId]) return '';
  const meta = _missionMeta(MISSIONS[S.missionId]);
  if (!meta.code) return '';
  return `<button class="mission-tag" data-testid="mission-tag" onclick="showMissionRules()" title="查看本关规则">${_esc(meta.code)}</button>`;
}

/** 游戏页公共外壳：头部（标题左 / 按钮右）+ 内容 */
function _gameShellHTML(core) {
  return `
  <div class="game-header">
    <span class="header-title">${_bombSVG('header-bomb')}<span>炸弹克星</span>${_missionTagHTML()}</span>
    <span class="header-btns">
      <button class="icon-btn" onclick="showRules()">📜 规则</button>
      <button class="icon-btn" onclick="resetGame()">🚪 退出</button>
    </span>
  </div>
  ${core}`;
}

/** 日志条（移至数轴板上方） */
function _logBarHTML() {
  return `<div class="log-bar" onclick="showLogSheet()">${_lastLogHTML()}</div>`;
}

/* ============================================================
   本设备可见的座位（本人）
   ============================================================ */

function _ownSeats() {
  const out = [];
  if (!S || !S.players) return out;
  for (let s = 0; s < S.pCount; s++) if (canActAs(s)) out.push(s);
  return out;
}

/* ============================================================
   标记阶段视图
   ============================================================ */

function _markViewHTML() {
  const ownSeats = _ownSeats();
  const waiting = [];
  for (let s = 0; s < S.pCount; s++) if (!S.ready[s]) waiting.push(_playerName(s));

  const rows = [];
  for (let s = 0; s < S.pCount; s++) if (!ownSeats.includes(s)) rows.push(_playerRowHTML(s));

  const allMineReady = ownSeats.every(s => S.ready[s]);

  return `
  ${_logBarHTML()}
  ${_equipRowHTML()}
  ${_boardHTML()}
  <div class="players">${rows.join('')}</div>
  <div class="own-area">${ownSeats.map(s => _ownHandHTML(s)).join('')}</div>
  <div class="action-bar">
    ${(allMineReady || !ownSeats.length)
      ? `<div class="waiting-hint">⏳ 等待 ${waiting.map(_esc).join('、')} 完成标记…</div>`
      : `<div class="waiting-hint">👉 点击你手牌中的一张蓝色导线完成标记</div>`}
  </div>`;
}

/* ============================================================
   对局视图（play / over）
   ============================================================ */

function _gameViewHTML() {
  const ownSeats = _ownSeats();
  const rows = [];
  for (let s = 0; s < S.pCount; s++) if (!ownSeats.includes(s)) rows.push(_playerRowHTML(s));

  return `
  ${_logBarHTML()}
  ${_equipRowHTML()}
  ${_boardHTML()}
  ${_radarPanelHTML()}
  ${_walkiePanelHTML()}
  <div class="players">${rows.join('')}</div>
  <div class="own-area">${ownSeats.map(s => _ownHandHTML(s)).join('')}</div>
  ${S.phase === 'over' ? _endActionHTML() : _actionBarHTML()}`;
}

/** 【通用雷达】瞬态结果面板（回合结束时清空；各端同步显示） */
function _radarPanelHTML() {
  const r = S && S.radar;
  if (!r || !r.rows) return '';
  const rows = r.rows.map(row => {
    const chips = (row.per || []).map((has, i) =>
      `<span class="radar-chip ${has ? 'yes' : 'no'}">第 ${i + 1} 份 ${has ? '有' : '无'}</span>`).join('');
    const mine = mySeat() !== null && row.seat === mySeat();
    return `<div class="radar-row${mine ? ' mine' : ''}">
      <span class="radar-name">${_esc(_playerName(row.seat))}</span>
      <span class="radar-chips">${chips}</span>
    </div>`;
  }).join('');
  return `<div class="radar-panel" data-testid="radar-panel">
    <div class="radar-head">📡 通用雷达：蓝色 ${r.num} 的未公开残留</div>
    ${rows}
  </div>`;
}

/** 【对讲机】交换结果面板：双方挑出/落点位次（牌面保持隐藏） */
function _walkiePanelHTML() {
  const w = S && S.walkieInfo;
  if (!w) return '';
  const pos = p => `第 ${p.si + 1} 份 · 第 ${p.idx + 1} 张`;
  const row = (seat, out, into) => `<div class="walkie-row">
    <span class="walkie-name">${_esc(_playerName(seat))}</span>
    <span class="walkie-line">交出 ${pos(out)} → 收到牌落点 ${pos(into)}</span>
  </div>`;
  return `<div class="walkie-panel" data-testid="walkie-panel">
    <div class="walkie-head">📻 对讲机交换完成（带 ⇄ 的为换入牌，牌面保持隐藏）</div>
    ${row(w.aSeat, w.aOut, w.aIn)}
    ${row(w.bSeat, w.bOut, w.bIn)}
  </div>`;
}

/* ============================================================
   终局按钮区（own-area 下方：再来一局 / 返回房间）
   ============================================================ */

function _endActionHTML() {
  if (!isHost()) {
    return `<div class="action-bar" data-testid="end-actions">
      <div class="bar-title">🏁 本局已结束</div>
      <div class="waiting-hint">⏳ 等待房主操作…</div>
    </div>`;
  }
  return `<div class="action-bar" data-testid="end-actions">
    <div class="bar-title">🏁 本局已结束</div>
    <div class="bar-btns">
      <button class="action-btn primary" data-testid="btn-again" onclick="onEndRestart()">🔄 再来一局</button>
      <button class="action-btn" data-testid="btn-back-room" onclick="onEndBackToRoom()">🌐 返回房间</button>
    </div>
    <div class="waiting-hint">🌐 返回房间后新玩家可加入，可再重新开始</div>
  </div>`;
}

/** 结算后「再来一局」（房主侧按钮）：重开本局 */
function onEndRestart() {
  if (!S || S.phase !== 'over') return;
  const r = restartGame();
  if (!r.ok) showToast(r.msg || '无法再来一局');
}

/** 结算后「返回房间」：房间回到等候室（各端切回，支持新玩家加入/重新选关） */
function onEndBackToRoom() {
  if (!S || S.phase !== 'over') return;
  if (typeof window._olReturnToWaiting === 'function') {
    window._olReturnToWaiting();
  } else {
    showToast('仅联机房间内支持返回房间');
  }
}

/* ============================================================
   数轴板（1~12 蓝 + 红/黄位置 + 拆除印章 + 失误计数）
   ============================================================ */

/** 倒计时 mm:ss */
function _fmtClock(msLeft) {
  const sec = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function _boardHTML() {
  const b = (S && S.board) || {};
  const yellowNums = b.yellowNums || [];
  const redNums = Array.isArray(b.redNums)
    ? b.redNums
    : (typeof b.redNum === 'number' ? [b.redNum] : []);
  const redBlueNums = Array.isArray(b.redBlueNums) ? b.redBlueNums : [];
  const redHollow = b.redMark === 'hollow';
  const yellowHollow = b.yellowMark === 'hollow';
  const redNote = b.redNote || '';
  const yellowNote = b.yellowNote || '';
  const deadline = b.deadline || 0;
  const left = deadline ? deadline - Date.now() : 0;
  const cells = [];
  for (let n = 1; n <= 12; n++) {
    const hasYellow = yellowNums.indexOf(n + 0.1) >= 0;
    const hasRed = redNums.indexOf(n + 0.5) >= 0;
    const redLike = redBlueNums.indexOf(n) >= 0;
    const defused = !!(b.defused || [])[n - 1];
    const rev = blueRevealedCount(n);
    const yellowDot = hasYellow
      ? `<span class="dot dot-y${yellowHollow ? ' dot-hollow' : ''}" title="黄导线${yellowNote ? '（' + yellowNote + '）' : ''}"></span>`
      : '';
    const redDot = hasRed
      ? `<span class="dot dot-r${redHollow ? ' dot-hollow' : ''}" title="红导线${redNote ? '（' + redNote + '）' : ''}"></span>`
      : '';
    cells.push(`<div class="cell${defused ? ' defused' : ''}${rev >= 4 ? ' full' : ''}${redLike ? ' red-blue' : ''}" data-cell="${n}"${redLike ? ' title="本局该数字蓝线视为红色导线"' : ''}>
      <span class="cell-num">${n}</span>
      <span class="cell-rev">${rev}/4</span>
      ${redLike ? '<span class="cell-rb">蓝→红</span>' : ''}
      ${(hasYellow || hasRed) ? `<span class="cell-dots">${yellowDot}${redDot}</span>` : ''}
      ${defused ? '<span class="cell-check">✓</span>' : ''}
    </div>`);
  }
  const redIcon = redHollow ? '<span class="legend-ring"></span>' : '🚨';
  const yellowIcon = yellowHollow ? '<span class="legend-ring"></span>' : '🟡';
  const orderNums = Array.isArray(b.orderNums) ? b.orderNums : [];
  let orderHTML = '';
  if (orderNums.length) {
    const steps = orderNums.map((n, i) => {
      const prev = i > 0 ? orderNums[i - 1] : null;
      const prevRev = prev === null ? 0 : blueRevealedCount(prev);
      const locked = i > 0 && prevRev < 2;
      const rev = blueRevealedCount(n);
      const sub = locked ? `🔒 先 ${prev}×2` : `${rev}/4`;
      const tip = i === 0
        ? '首个数字，无需前置'
        : locked
          ? `需先公开 2 根蓝色 ${prev}（当前 ${prevRev} 根）`
          : `已解锁：蓝色 ${prev} 已公开 ${prevRev} 根`;
      const arrow = i > 0 ? '<span class="order-arrow">→</span>' : '';
      return `${arrow}<span class="order-step${i === 0 ? ' first' : ''}${locked ? ' locked' : ''}" data-order-num="${n}" title="${tip}">
        <span class="order-num">${n}</span><span class="order-sub">${sub}</span>
      </span>`;
    }).join('');
    orderHTML = `<div class="board-order" data-testid="cut-order" data-order-nums="${orderNums.join(',')}">
      <span class="order-title">⏱ 剪线顺序</span>
      <span class="order-steps">${steps}</span>
      <span class="order-tip">前序公开 ≥2 根解锁下一数字</span>
    </div>`;
  }
  const countdownHTML = deadline
    ? `<span class="countdown${left <= 60000 ? ' urgent' : ''}${left <= 0 ? ' expired' : ''}" data-deadline="${deadline}" data-testid="countdown" title="倒计时结束仍未公开全部导线即失败">⏳ <span class="cd-time">${_fmtClock(left)}</span></span>`
    : '';
  const lastCutter = (S.freeCut && typeof S.lastCutterSeat === 'number' && S.players[S.lastCutterSeat])
    ? S.players[S.lastCutterSeat].name : '';
  const freeHTML = S.freeCut
    ? `<div class="board-free" data-testid="free-cut">
        🔓 自由剪线：任意玩家可行动${S.pCount > 2 ? '，但不能连续剪线' : ''}${lastCutter ? ` · 上一位：${_esc(lastCutter)}` : ''}
      </div>`
    : '';
  const rbLegend = redBlueNums.length
    ? `<div class="legend legend-rb">🔴 蓝线 ${redBlueNums.join('、')} 本局视为红导线：只能在自己手上只剩这些牌时用「公开红线」公开</div>`
    : '';
  return `<div class="board" id="board">
    <div class="board-head">
      <span class="board-title">数轴板</span>
      <span class="board-head-right">${countdownHTML}<span class="fail-count" data-testid="fail-count">💥 失误 ${S.failures}/${S.pCount}</span></span>
    </div>
    ${freeHTML}
    ${orderHTML}
    <div class="board-cells">${cells.join('')}</div>
    <div class="board-legend">
      <span class="legend legend-r">${redIcon} 红导线${redNote ? `（${redNote}）` : ''}：${redNums.join('、') || '—'}</span>
      <span class="legend legend-y">${yellowIcon} 黄导线${yellowNote ? `（${yellowNote}）` : ''}：${yellowNums.join('、') || '—'}</span>
      ${rbLegend}
    </div>
  </div>`;
}

/** #10 倒计时走秒：各端按同一 deadline 展示；归零时任意端触发判负 */
function _tickCountdown() {
  if (!S || (S.phase !== 'mark' && S.phase !== 'play')) return;
  const deadline = S.board && S.board.deadline;
  if (!deadline) return;
  const left = deadline - Date.now();
  document.querySelectorAll('[data-deadline]').forEach(el => {
    const t = el.querySelector('.cd-time');
    if (t) t.textContent = _fmtClock(left);
    el.classList.toggle('urgent', left > 0 && left <= 60000);
    el.classList.toggle('expired', left <= 0);
  });
  if (left <= 0 && typeof timeoutGameIfNeeded === 'function') timeoutGameIfNeeded();
}

if (typeof window !== 'undefined' && typeof setInterval === 'function') {
  setInterval(_tickCountdown, 1000);
}

/* ============================================================
   牌面 HTML
   ============================================================ */

function _fmtNum(n) { return typeof n === 'number' ? String(n) : ''; }

function _kindLabel(kind) {
  return kind === 'blue' ? '蓝' : kind === 'yellow' ? '黄' : kind === 'red' ? '红' : '';
}

function _locateCardAnywhere(cardId) {
  const own = _findCardOwner(cardId);
  if (!own) return null;
  const loc = _locate(own.card, S.players[own.seat].shares);
  return loc ? { seat: own.seat, si: loc.si, idx: loc.idx } : null;
}

function _scanCount() {
  return (S.scanMode && S.scanMode.src === 'skill') || _ui.scanSrc === 'skill' ? 2 : 3;
}

function _isSelected(cardId) {
  return _ui.scanSel.some(x => x.id === cardId)
    || _ui.targetCardId === cardId
    || _ui.fromCardId === cardId;
}

/** 处于 ≠/＝ 配对中的牌：*-l = 左侧（渲染横条）/ *-r = 右侧（徽章让位） */
function _pairSpanCls(card, share, idx) {
  if (!share) return '';
  let out = '';
  for (const [field, tag] of [['neq', 'neq'], ['eqp', 'eqp']]) {
    const pid = card[field];
    if (!pid) continue;
    if (share[idx + 1] && share[idx + 1][field] === pid) out += ' ' + tag + '-l';
    else if (idx > 0 && share[idx - 1][field] === pid) out += ' ' + tag + '-r';
  }
  return out;
}

/** 对讲机交换过的牌（全场可见的落点标记） */
function _isWalkieSwapped(card) {
  const w = S && S.walkieInfo;
  return !!(w && card && (w.aCardId === card.id || w.bCardId === card.id));
}

function _cardMarkersHTML(card, share, idx) {
  let span = '';
  let out = '';
  if (card.info) out += `<span class="marker marker-info" title="信息标记">📌 ${_fmtNum(card.info.num)}</span>`;
  if (card.fail) out += `<span class="marker marker-fail" title="信息标记">${card.fail.type === 'blue' ? '🔖 ' + _fmtNum(card.fail.num) : '🔖 黄'}</span>`;
  if (_isWalkieSwapped(card)) out += `<span class="marker marker-walkie" title="经对讲机交换的牌">⇄</span>`;
  const pairCls = _pairSpanCls(card, share, idx);
  if (pairCls.includes('neq-l')) span += `<span class="neq-span" title="编号不同">≠</span>`;
  else if (card.neq && !pairCls.includes('neq-r')) out += `<span class="marker marker-neq" title="编号不同">≠</span>`;
  if (pairCls.includes('eqp-l')) span += `<span class="eqp-span" title="编号相同">＝</span>`;
  else if (card.eqp && !pairCls.includes('eqp-r')) out += `<span class="marker marker-eqp" title="编号相同">＝</span>`;
  return span + (out ? `<span class="markers">${out}</span>` : '');
}

/** 超级探测器：点选一张即代表整份，整份未公开牌一起高亮 */
function _isSuperShareSelected(card, seat, si) {
  const m = _ui.mode;
  return (m === 'super' || m === 'super-guess' || m === 'super-own')
    && _ui.superShare !== null
    && seat === _ui.targetSeat
    && si === _ui.superShare
    && !card.revealed;
}

/** 他人牌：未公开 = 牌背；已公开 = 亮面 */
function _enemyCardHTML(card, share, idx, seat, si) {
  const sel = _ui.scanSel.some(x => x.id === card.id) || _ui.targetCardId === card.id;
  const superSel = _isSuperShareSelected(card, seat, si);
  const picked = S.pending && S.pending.type === 'walkie' && S.pending.fromCardId === card.id;
  const markers = _cardMarkersHTML(card, share, idx);
  const byMePicker = S.pending ? canActAs(S.pending.toSeat) : false;

  let selectable = false;
  if (!card.revealed && !S.result && !byMePicker && !S.pending) {
    if ((_ui.mode === 'pair-target' || _ui.mode === 'ray-target') && _myTurn()) selectable = true;
    if (_ui.mode === 'scan' || _ui.mode === 'super') selectable = true;
  }

  const cls = ['card'];
  const fxSpot = !!(S.fx && S.fx.ids && S.fx.ids.indexOf(card.id) >= 0);
  if (fxSpot) cls.push('fx-target');
  if (_isWalkieSwapped(card)) cls.push('walkie-swapped');
  _pairSpanCls(card, share, idx).trim().split(' ').forEach(c => c && cls.push(c));
  let body;
  let attrs = ` data-cardid="${card.id}"`;
  if (card.revealed) {
    cls.push('revealed', 'kind-' + card.kind);
    if (sel || superSel) cls.push('selected');
    attrs += ` data-kind="${card.kind}" data-num="${_fmtNum(card.num)}"`;
    body = `<span class="card-num">${_fmtNum(card.num)}</span><span class="card-kind">${_kindLabel(card.kind)}</span>${markers}`;
  } else {
    cls.push('card-back');
    if (sel || superSel) cls.push('selected');
    if (picked) cls.push('picked');
    if (selectable) cls.push('selectable');
    body = `${markers}`;
  }
  const onclick = selectable ? ` onclick="onEnemyCardClick('${card.id}')"` : '';
  return `<div class="${cls.join(' ')}"${attrs}${onclick}>${body}</div>`;
}

/** 本设备可见的手牌：始终亮面 */
function _ownCardHTML(seat, si, card, share, idx) {
  const sel = _isSelected(card.id);
  const selectable = _ownCardSelectable(seat, card);
  const cls = ['card', 'card-own', 'kind-' + card.kind];
  const fxSpot = !!(S.fx && S.fx.ids && S.fx.ids.indexOf(card.id) >= 0);
  if (fxSpot) cls.push('fx-target');
  if (_isWalkieSwapped(card)) cls.push('walkie-swapped');
  _pairSpanCls(card, share, idx).trim().split(' ').forEach(c => c && cls.push(c));
  if (card.revealed) cls.push('revealed');
  if (sel) cls.push('selected');
  if (selectable) cls.push('selectable');
  const onclick = selectable ? ` onclick="onOwnCardClick(${seat},${si},'${card.id}')"` : '';
  return `<div class="${cls.join(' ')}" data-cardid="${card.id}" data-kind="${card.kind}" data-num="${_fmtNum(card.num)}"${onclick}>
    <span class="card-num">${_fmtNum(card.num)}</span>
    <span class="card-kind">${_kindLabel(card.kind)}</span>
    ${_cardMarkersHTML(card, share, idx)}
  </div>`;
}

/** 本设备手牌可点选的场合（标记 / 对讲机 / ≠/＝ / 便利贴） */
function _ownCardSelectable(seat, card) {
  if (!S || S.result) return false;
  if (S.phase === 'mark') {
    return !S.ready[seat] && card.kind === 'blue' && !card.revealed;
  }
  if (S.pending) {
    return S.pending.type === 'walkie' && seat === S.pending.toSeat && canActAs(seat) && !card.revealed;
  }
  if (!_myTurn()) return false;
  if (seat !== _actorSeat()) return false;
  if (_ui.mode === 'neq') return true;                    // ≠ 标签可含已公开牌
  if (_ui.mode === 'walkie-card') return !card.revealed;
  if (_ui.mode === 'sticky') return card.kind === 'blue' && !card.revealed && !card.info;
  if (_ui.mode === 'eqtag') return true;                  // ＝ 标签可含已公开牌
  return false;
}

/* ============================================================
   其他玩家行 / 本设备手牌区
   ============================================================ */

function _playerRowHTML(seat) {
  const p = S.players && S.players[seat];
  if (!p) return '';
  const isCur = S.phase === 'play' && !S.result && seat === _actorSeat();
  const noMark = (S.noMarkSeats || []).indexOf(seat) >= 0;
  const lastCut = S.freeCut && S.phase === 'play' && S.lastCutterSeat === seat;
  const color = PLAYER_COLORS[seat % PLAYER_COLORS.length];
  const shares = (p.shares || []).map((share, si) =>
    `<div class="cards" data-share="${si}">${share.map((c, i) => _enemyCardHTML(c, share, i, seat, si)).join('')}</div>`).join('');
  const markBadge = S.phase === 'mark'
    ? (S.ready[seat]
      ? `<span class="mark-badge ok">${noMark ? '🎖 免标记' : '✅ 已标记'}</span>`
      : '<span class="mark-badge wait">⏳ 标记中</span>')
    : '';
  const lastBadge = lastCut
    ? `<span class="last-cut-badge">✂️ ${S.pCount > 2 ? '刚剪线' : '上一位'}</span>`
    : '';
  return `<div class="player-row${isCur ? ' current' : ''}" data-seat="${seat}">
    <div class="pr-head">
      <span class="p-chip${isCur ? ' active' : ''}" style="--pc:${color}">${_esc(p.name)}${seat === S.captainSeat ? ' 🎖' : ''}</span>
      ${markBadge}${lastBadge}
      <span class="pr-meta">未公开 ${hiddenCards(seat).length}</span>
    </div>
    <div class="pr-shares">${shares}</div>
  </div>`;
}

function _ownHandHTML(seat) {
  const p = S.players && S.players[seat];
  if (!p) return '';
  const mine = mySeat() === seat;
  const isCur = S.phase === 'play' && !S.result && seat === _actorSeat();
  const noMark = (S.noMarkSeats || []).indexOf(seat) >= 0;
  const color = PLAYER_COLORS[seat % PLAYER_COLORS.length];
  const shares = (p.shares || []).map((share, si) =>
    `<div class="cards" data-share="${si}">${share.map((c, i) => _ownCardHTML(seat, si, c, share, i)).join('')}</div>`).join('');
  let status = '';
  if (S.phase === 'mark') {
    status = S.ready[seat]
      ? `<span class="mark-badge ok">${noMark ? '🎖 本关免标记（队长）' : '✅ 已放置信息标记'}</span>`
      : '<span class="mark-badge wait">⏳ 请点选 1 张蓝色导线</span>';
  } else if (isCur) {
    status = `<span class="mark-badge now">${S.freeCut ? '✂️ 轮到你剪线' : '🎯 你的回合'}</span>`;
  } else if (S.phase === 'play' && S.freeCut && !S.result) {
    if (hiddenCards(seat).length === 0) {
      status = '<span class="mark-badge ok">✅ 手牌已全部公开</span>';
    } else if (S.pCount > 2 && S.lastCutterSeat === seat) {
      status = '<span class="mark-badge wait">⏳ 刚剪线，等待其他玩家</span>';
    } else {
      status = '<span class="mark-badge now">✂️ 可随时剪线</span>';
    }
  }
  return `<div class="own-hand${isCur ? ' current' : ''}" data-seat="${seat}" style="--pc:${color}">
    <div class="oh-head">
      <span class="p-chip${isCur ? ' active' : ''}">${mine ? '🙋 你' : _esc(p.name)}</span>
      ${status}
    </div>
    <div class="own-shares">${shares}</div>
  </div>`;
}

/* 手牌单行自适应：每份手牌独立占一行；不够宽时先压缩间距、再缩放牌面 */
function _fitCardRows(scope) {
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll('.pr-shares > .cards, .own-shares > .cards').forEach(row => {
    const n = row.children.length;
    if (!n) return;
    const avail = row.clientWidth;
    if (!avail) return;
    const max = row.closest('.own-shares') ? 26 : 24;
    let gap = 3;
    let w = max;
    for (const g of [3, 2, 1]) {
      gap = g;
      w = Math.floor((avail - (n - 1) * g) / n);
      if (w >= 14) break;
    }
    if (w > max) w = max;
    if (w < 8) w = 8;
    row.style.setProperty('--cw', w + 'px');
    row.style.setProperty('--cgap', gap + 'px');
  });
}

window.addEventListener('resize', () => {
  const app = document.getElementById('app');
  if (app) _fitCardRows(app);
});

/* ============================================================
   道具行 / 行动条
   ============================================================ */

function _equipRowHTML() {
  if (!S.equipment || !S.equipment.length) return '';
  const stabActive = !!(S.cutMods && S.cutMods.stabilize !== null && S.cutMods.stabilize !== undefined);
  const btns = S.equipment.map(e => {
    const lib = (typeof EQUIPMENT_LIB === 'object' && EQUIPMENT_LIB[e.no]) || null;
    const name = lib ? lib.name : '道具 ' + e.no;
    const lockNum = typeof e.lockNum === 'number' ? e.lockNum : null;
    // 该道具已进入选择流程（尚未使用）：按钮呈激活态，再点可取消
    const active = !e.used && e.unlocked && (
      (e.no === 1 && _ui.mode === 'neq') ||
      (e.no === 2 && _ui.mode === 'walkie-card') ||
      (e.no === 3 && _ui.mode === 'scan' && _ui.scanSrc === 'eq3') ||
      (e.no === 4 && _ui.mode === 'sticky') ||
      (e.no === 5 && (_ui.mode === 'super' || _ui.mode === 'super-guess' || _ui.mode === 'super-own')) ||
      (e.no === 9 && stabActive) ||
      (e.no === 10 && (_ui.mode === 'ray-target' || _ui.mode === 'ray-guess' || _ui.mode === 'ray-own')) ||
      (e.no === 12 && _ui.mode === 'eqtag'));
    let cls = 'equip-btn';
    let onclk = '';
    let disabled = '';
    if (e.used) { cls += ' used'; disabled = ' disabled'; }
    else if (e.unlocked) {
      cls += ' ready';
      if (active) cls += ' active';
      onclk = ` onclick="onEquipClick(${e.no})"`;
    } else { cls += ' locked'; disabled = ' disabled'; }
    const tipText = lib && lib.desc ? _esc(lib.desc) : '';
    const lockTip = lockNum !== null
      ? `解锁条件：蓝色 ${e.no} 全部公开（${blueRevealedCount(e.no)}/4）+ 🔒${lockNum} 公开 ≥2（${blueRevealedCount(lockNum)}/2）`
      : '';
    const tip = (tipText || lockTip)
      ? `<span class="equip-tip">${[tipText, lockTip ? _esc(lockTip) : ''].filter(Boolean).join(' ｜ ')}</span>`
      : '';
    const lockCleared = lockNum !== null && blueRevealedCount(lockNum) >= 2;
    const lockBadge = lockNum !== null
      ? `<span class="equip-lock${e.unlocked ? ' open' : ''}${lockCleared ? ' cleared' : ''}" data-testid="equip-lock-${e.no}" title="${_esc(lockTip)}">${lockCleared ? '🔓' : '🔒'}${lockNum}</span>`
      : '';
    return `<button class="${cls}" data-testid="equip-${e.no}" data-no="${e.no}"${lockNum !== null ? ` data-lock-num="${lockNum}"` : ''}${onclk}${disabled}>
      ${lockBadge}<span class="equip-no">${e.no}</span><span class="equip-name">${_esc(name)}${active ? ' ✕' : ''}</span>${tip}
    </button>`;
  }).join('');
  return `<div class="equip-row" data-testid="equipment">
    <span class="equip-label">🔧 道具</span>
    <div class="equip-btns">${btns}</div>
  </div>`;
}

function _waitHTML(msg) {
  return `<div class="action-bar"><div class="waiting-hint">${msg}</div></div>`;
}

function _cancelBtn() {
  return `<button class="action-btn cancel" data-testid="btn-cancel" onclick="cancelFlow()">取消</button>`;
}

function _modeHintBar() {
  if (!_ui.mode) return null;
  if (_ui.mode === 'pair-target') {
    return `<div class="action-bar"><div class="mode-hint">✂️ 点击其他玩家的一张未公开导线（牌背）</div>${_cancelBtn()}</div>`;
  }
  if (_ui.mode === 'scan') {
    const count = _scanCount();
    return `<div class="action-bar"><div class="mode-hint">🔎 依次点选同一份内相邻的 ${count} 张未公开牌（已选 ${_ui.scanSel.length}/${count}）</div>${_cancelBtn()}</div>`;
  }
  if (_ui.mode === 'neq') {
    return `<div class="action-bar"><div class="mode-hint">≠ 点选自己同一份内相邻的 2 张牌（已选 ${_ui.scanSel.length}/2）</div>${_cancelBtn()}</div>`;
  }
  if (_ui.mode === 'eqtag') {
    return `<div class="action-bar"><div class="mode-hint">＝ 点选自己同一份内相邻的 2 张同色牌（已选 ${_ui.scanSel.length}/2）</div>${_cancelBtn()}</div>`;
  }
  if (_ui.mode === 'walkie-card') {
    return `<div class="action-bar">
      <div class="mode-desc">📻 用法：选自己 1 张未公开导线，再指定另一名玩家；对方选定 1 张后双方交换并各自按顺序重排，被交换牌原标记自动废弃。</div>
      <div class="mode-hint">请先点选自己的 1 张未公开导线</div>
      ${_cancelBtn()}
    </div>`;
  }
  if (_ui.mode === 'sticky') {
    return `<div class="action-bar"><div class="mode-hint">📃 点选自己 1 张未公开且无信息标记的蓝色导线</div>${_cancelBtn()}</div>`;
  }
  if (_ui.mode === 'super') {
    return `<div class="action-bar"><div class="mode-hint">🛰️ 点击其他玩家某一份中的一张未公开牌（将扫描该整份手牌）</div>${_cancelBtn()}</div>`;
  }
  if (_ui.mode === 'ray-target') {
    return `<div class="action-bar"><div class="mode-hint">➿ 点击其他玩家的一张未公开导线（将猜「两个选项之一」）</div>${_cancelBtn()}</div>`;
  }
  return null;
}

function _actionBarHTML() {
  if (S.phase !== 'play' || S.result) return '';
  if (S.fx) return _waitHTML(S.fx.kind === 'solo' || S.fx.kind === 'red' ? '💬 公开结算中…' : '💬 猜测结算中…');
  if (S.pending) return _pendingHTML();

  // 技能探测器已启动：本回合只允许扫描（未执行前可取消）
  if (S.scanMode && S.scanMode.src === 'skill') {
    const scanBy = (typeof S.scanMode.by === 'number') ? S.scanMode.by : S.currentSeat;
    const canScan = canActAs(scanBy)
      && (S.freeCut ? _actorSeat() === scanBy : scanBy === S.currentSeat);
    if (canScan) {
      if (_ui.mode !== 'scan') {
        return `<div class="action-bar">
          <div class="mode-hint">🔎 已启动双重探测器：请扫描相邻 ${S.scanMode.count} 张手牌</div>
          <div class="arm-row">
            <button class="action-btn cancel" data-testid="btn-cancel-skill" onclick="cancelSkillFlow()">取消</button>
            <button class="action-btn primary" data-testid="btn-scan" onclick="startScanFlow('skill')">开始扫描</button>
          </div>
        </div>`;
      }
    } else {
      return _waitHTML(`🔎 ${_esc(_playerName(scanBy))} 正在使用探测器…`);
    }
  }

  const modeBar = _modeHintBar();
  if (modeBar) return modeBar;

  const stabSeat = (S.cutMods && S.cutMods.stabilize !== null && S.cutMods.stabilize !== undefined)
    ? S.cutMods.stabilize : null;

  // 自由剪线（本机多人）：先在可行动玩家中选择当前操作者
  if (S.freeCut && mySeat() === null && !_myTurn()) {
    const seats = [];
    for (let s = 0; s < S.pCount; s++) if (_freeCutEligible(s)) seats.push(s);
    if (!seats.length) return _waitHTML('✅ 已没有可剪线的玩家…');
    return `<div class="action-bar free-seat-bar" data-testid="free-seat-bar">
      <div class="bar-title">🔓 自由剪线：选择本机操作的玩家</div>
      <div class="bar-btns">${seats.map(s => `<button class="action-btn" data-testid="free-seat-${s}" onclick="onFreeSeatPick(${s})">${_esc(_playerName(s))}</button>`).join('')}</div>
      <div class="waiting-hint">同一时间只能一名玩家剪线${S.pCount > 2 ? '；刚剪过线的玩家需等待其他人行动' : ''}</div>
    </div>`;
  }

  if (!_myTurn()) {
    if (S.freeCut) {
      const mine = mySeat();
      if (mine !== null && hiddenCards(mine).length === 0) {
        return _waitHTML('✅ 你的手牌已全部公开，等待队友完成拆弹…');
      }
      if (mine !== null && S.pCount > 2 && S.lastCutterSeat === mine) {
        return _waitHTML('⏳ 你刚完成一次剪线，等待其他玩家剪线…');
      }
      return _waitHTML('⏳ 等待其他玩家行动…');
    }
    const stab = stabSeat !== null ? `（🧪 ${_esc(_playerName(stabSeat))} 已使用稳定剂）` : '';
    return _waitHTML(`⏳ 等待 ${_esc(_playerName(S.currentSeat))} 行动…${stab}`);
  }

  const actor = _actorSeat();
  if (actor === null) return _waitHTML('⏳ 等待其他玩家行动…');
  const soloOK = soloOptions(actor).length > 0;
  const redOK = canRevealRed(actor);
  const skillOK = !S.players[actor].skillUsed;
  return `<div class="action-bar">
    <div class="bar-title">${S.freeCut ? '🔓 自由剪线：选择 1 次行动' : '🎯 你的回合：选择 1 次行动'}（可选用道具）</div>
    ${stabSeat !== null ? '<div class="mode-hint stabilize-hint">🧪 稳定状态生效中：本回合剪线失误不计、红线不爆（点道具 9 可取消）</div>' : ''}
    <div class="bar-btns">
      <button class="action-btn" data-action="pair" data-testid="btn-pair" onclick="startPairCut()">✂️ 双人剪线</button>
      <button class="action-btn" data-action="solo" data-testid="btn-solo"${soloOK ? '' : ' disabled'} onclick="startSoloCut()">🎯 单人剪线</button>
      <button class="action-btn" data-action="red" data-testid="btn-red"${redOK ? '' : ' disabled'} onclick="startRevealRed()">🚨 公开红线</button>
      <button class="action-btn" data-action="skill" data-testid="btn-skill"${skillOK ? '' : ' disabled'} onclick="startSkill()">🔎 双重探测器</button>
    </div>
  </div>`;
}

/** 单机自由剪线：选定本机当前操作的玩家 */
function onFreeSeatPick(seat) {
  if (!S || !S.freeCut) return;
  if (!_freeCutEligible(seat)) { showToast('该玩家当前不能剪线'); return; }
  if (mySeat() !== null && mySeat() !== seat) return;
  S.currentSeat = seat;
  render();
}

/* ============================================================
   被动选择面板（scanPick / scanMark / walkie）
   ============================================================ */

function _pendingHTML() {
  const pd = S.pending;
  if (!pd) return '';
  const iAmPicker = canActAs(pd.toSeat);

  if (pd.type === 'scanPick' || pd.type === 'superPick') {
    if (iAmPicker) {
      const num = pd.guessNum;
      const icon = pd.type === 'superPick' ? '🛰️' : '🔎';
      const btns = pd.cards.map(id => {
        const loc = _locateCard(pd.toSeat, id);
        return `<button class="pick-card" data-cardid="${id}" onclick="onScanPickChoose('${id}')">
          <span class="pc-num">蓝色 ${num}</span>
          <span class="pc-pos">第 ${loc ? loc.si + 1 : '?'} 份 · 第 ${loc ? loc.idx + 1 : '?'} 张</span>
        </button>`;
      }).join('');
      return `<div class="action-bar pending">
        <div class="pending-title">${icon} 命中！请选择公开哪一张蓝色 ${num}</div>
        <div class="pick-row">${btns}</div>
      </div>`;
    }
    return _waitHTML(`🔎 等待 ${_esc(_playerName(pd.toSeat))} 选择公开的导线…`);
  }

  if (pd.type === 'scanMark' || pd.type === 'superMark') {
    if (iAmPicker) {
      const btns = pd.cards.map(id => {
        const loc = _locateCard(pd.toSeat, id);
        return `<button class="pick-card" data-cardid="${id}" onclick="onScanMarkChoose('${id}')">
          <span class="pc-num">? ? ?</span>
          <span class="pc-pos">第 ${loc ? loc.si + 1 : '?'} 份 · 第 ${loc ? loc.idx + 1 : '?'} 张</span>
        </button>`;
      }).join('');
      const title = pd.type === 'superMark'
        ? '🔖 未命中！请从该份未公开蓝线中选 1 张放置信息标记'
        : '🔖 未命中！请从下面选 1 张非红色导线放置信息标记';
      return `<div class="action-bar pending">
        <div class="pending-title">${title}</div>
        <div class="pick-row">${btns}</div>
      </div>`;
    }
    return _waitHTML(`🔖 等待 ${_esc(_playerName(pd.toSeat))} 放置信息标记…`);
  }

  if (pd.type === 'walkie') {
    if (iAmPicker) {
      return `<div class="action-bar pending">
        <div class="pending-title">📻 ${_esc(_playerName(pd.fromSeat))} 想和你交换导线</div>
        <div class="mode-hint">请在自己的手牌中点选 1 张未公开导线交给对方</div>
      </div>`;
    }
    return _waitHTML(`📻 等待 ${_esc(_playerName(pd.toSeat))} 选择交换的导线…`);
  }
  return '';
}

/* ============================================================
   弹层内容：猜测 / 自选公开 / 单人剪线 / 对讲机对象
   ============================================================ */

function _sheetHead(title) {
  return `<div class="sheet-head"><span>${title}</span><button class="sheet-close" data-testid="sheet-close" onclick="closeSheet()">✕</button></div>`;
}

function _flowTargetSeat() {
  if (_ui.mode === 'scan-guess' || _ui.mode === 'scan-own') {
    return _ui.scanSel.length ? _ui.scanSel[0].seat : null;
  }
  return _ui.targetSeat;
}

function _cardPosLabel(seat, cardId) {
  const loc = _locateCard(seat, cardId);
  return loc ? `第 ${loc.si + 1} 份 · 第 ${loc.idx + 1} 张` : '';
}

function _ownGuessCandidates(seat, guess, isScan) {
  if (!guess || seat === null) return [];
  const p = S.players[seat];
  const cards = ((p && p.shares) || []).flat().filter(c => !c.revealed);
  if (guess.kind === 'blue') return cards.filter(c => c.kind === 'blue' && c.num === guess.num && !isRedLikeCard(c));
  return isScan ? [] : cards.filter(c => c.kind === 'yellow');
}

function _orderWarnHTML() {
  const order = (S && S.board && Array.isArray(S.board.orderNums)) ? S.board.orderNums : [];
  if (!order.length) return '';
  return `<div class="order-warn">⏱ 剪线顺序：${order.join(' → ')}；命中未解锁数字会立即爆炸</div>`;
}

function _guessSheetHTML() {
  const actor = _actorSeat();
  const isSuper = _ui.mode === 'super-guess';
  const isScan = _ui.mode === 'scan-guess' || isSuper;
  const tSeat = _flowTargetSeat();
  const tName = tSeat === null ? '' : _esc(_playerName(tSeat));

  if (actor === null) {
    return `${_sheetHead('🔎 猜测')}<div class="sheet-body"><div class="sheet-empty">等待中…</div></div>`;
  }

  const opts = legalGuessOptions(actor);
  const btns = opts.nums.map(n => {
    const sel = _ui.guess && _ui.guess.kind === 'blue' && _ui.guess.num === n;
    return `<button class="guess-btn${sel ? ' selected' : ''}" data-guess="blue-${n}" onclick="onGuessPick('blue-${n}')">${isScan ? '' : '蓝 '}${n}</button>`;
  }).join('');
  const yellowBtn = (!isScan && opts.yellow)
    ? `<button class="guess-btn yellow${_ui.guess && _ui.guess.kind === 'yellow' ? ' selected' : ''}" data-guess="yellow" onclick="onGuessPick('yellow')">黄色</button>`
    : '';
  const empty = (opts.nums.length === 0 && (isScan || !opts.yellow))
    ? '<div class="sheet-empty">你没有可猜的类型</div>' : '';
  const head = isSuper ? `🛰️ 猜${tName}的整份手牌里有——` : `🔎 猜${tName}的这张牌是——`;
  const sub = isSuper ? '猜「该份手牌中至少 1 张是蓝色 N」'
    : isScan ? '猜「其中至少 1 张是蓝色 N」'
    : '仅可猜你手上持有的未公开类型';

  return `${_sheetHead(head)}
  <div class="sheet-body">
    <div class="sheet-sub">${sub}（蓝色每数字各 4 张）</div>
    ${_orderWarnHTML()}
    <div class="guess-grid">${btns}${yellowBtn}</div>
    ${empty}
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

function _ownPickSheetHTML() {
  const actor = _actorSeat();
  const isScan = _ui.mode === 'scan-own' || _ui.mode === 'super-own';
  if (actor === null) {
    return `${_sheetHead('✂️ 公开你的导线')}<div class="sheet-body"><div class="sheet-empty">等待中…</div></div>`;
  }
  const cands = _ownGuessCandidates(actor, _ui.guess, isScan);
  const btns = cands.map(c =>
    `<button class="pick-card${_ui.ownCard === c.id ? ' selected' : ''}" data-cardid="${c.id}" onclick="onOwnPick('${c.id}')">
      <span class="pc-num">${_kindLabel(c.kind)} ${_fmtNum(c.num)}</span>
      <span class="pc-pos">${_cardPosLabel(actor, c.id)}</span>
    </button>`).join('');
  const guessLabel = _ui.guess
    ? (_ui.guess.kind === 'blue' ? '蓝色 ' + _ui.guess.num : '黄色')
    : '—';
  return `${_sheetHead('✂️ 命中后公开你的导线')}
  <div class="sheet-body">
    <div class="sheet-sub">命中时你需同步公开 1 张「${guessLabel}」牌（预先选定）</div>
    <div class="pick-row">${btns}</div>
    <button class="btn-full btn-primary${_ui.ownCard ? '' : ' dim'}" data-testid="confirm" onclick="onConfirmCut()">确认${isScan ? '扫描' : '剪线'}</button>
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

function _soloSheetHTML() {
  const actor = _actorSeat();
  const opts = actor === null ? [] : soloOptions(actor);
  const btns = opts.map((o, i) => {
    let label;
    if (o.kind === 'pair') label = `公开蓝色 ${o.num} ×2（场上已公开 2 张）`;
    else if (o.kind === 'all') label = `公开蓝色 ${o.num} 全部 4 张（都在你手上）`;
    else label = '清收全部剩余黄导线';
    return `<button class="pick-card" data-testid="solo-opt" data-idx="${i}" onclick="onSoloOpt(${i})">
      <span class="pc-num">🎯</span>
      <span class="pc-pos">${label}</span>
    </button>`;
  }).join('');
  return `${_sheetHead('🎯 单人剪线')}
  <div class="sheet-body">
    <div class="sheet-sub">符合条件即可一次公开多张</div>
    ${_orderWarnHTML()}
    <div class="pick-row">${opts.length ? btns : '<div class="sheet-empty">当前没有可用的单人剪线</div>'}</div>
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

function _walkieTargetSheetHTML() {
  const actor = _actorSeat();
  const btns = [];
  for (let s = 0; s < S.pCount; s++) {
    if (s === actor) continue;
    btns.push(`<button class="pick-card" data-testid="walkie-to" data-seat="${s}" onclick="onWalkieTarget(${s})">
      <span class="pc-num">📻 ${_esc(_playerName(s))}</span>
      <span class="pc-pos">未公开 ${hiddenCards(s).length} 张</span>
    </button>`);
  }
  return `${_sheetHead('📻 对讲机：选择交换对象')}
  <div class="sheet-body">
    <div class="sheet-sub">你已挑出 1 张未公开导线，请选择与谁交换（对方再选 1 张）</div>
    <div class="pick-row">${btns.join('')}</div>
    <div class="mode-desc">📻 对方选定后立即交换，双方手牌按顺序重新排列；被交换牌原标记自动废弃。</div>
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

/* ── 道具 10【X/Y射线】/ 7【备用电池】/ 8【通用雷达】/ 11【咖啡瓶】 ── */

/** 某选项对应的自选公开候选（蓝 N 未公开牌 / 未公开黄线） */
function _ownCandsFor(seat, opt) {
  if (!opt || seat === null) return [];
  const p = S.players[seat];
  const cards = ((p && p.shares) || []).flat().filter(c => !c.revealed);
  if (opt.kind === 'blue') return cards.filter(c => c.kind === 'blue' && c.num === opt.num && !isRedLikeCard(c));
  return cards.filter(c => c.kind === 'yellow');
}

function _rayOptKey(o) { return o.kind === 'yellow' ? 'yellow' : 'blue-' + o.num; }
function _rayOptLabel(o) { return o.kind === 'blue' ? '蓝色 ' + o.num : '黄色'; }

function _rayGuessSheetHTML() {
  const actor = _actorSeat();
  const tSeat = _ui.targetSeat;
  const tName = (tSeat === null || tSeat === undefined) ? '' : _esc(_playerName(tSeat));
  if (actor === null) {
    return `${_sheetHead('➿ X/Y射线')}<div class="sheet-body"><div class="sheet-empty">等待中…</div></div>`;
  }
  const opts = legalGuessOptions(actor);
  const picked = _ui.rayOpts.map(_rayOptKey);
  const btns = opts.nums.map(n => {
    const k = 'blue-' + n;
    const sel = picked.indexOf(k) >= 0;
    const dim = !sel && picked.length >= 2;
    return `<button class="guess-btn${sel ? ' selected' : ''}${dim ? ' dim' : ''}" data-guess="${k}" onclick="onRayOptTg('${k}')">蓝 ${n}</button>`;
  }).join('');
  const ySel = picked.indexOf('yellow') >= 0;
  const yDim = !ySel && (picked.length >= 2 || !opts.yellow);
  const yellowBtn = (opts.yellow || ySel)
    ? `<button class="guess-btn yellow${ySel ? ' selected' : ''}${yDim ? ' dim' : ''}" data-guess="yellow" onclick="onRayOptTg('yellow')">黄色</button>`
    : '';
  return `${_sheetHead(`➿ 声明${tName}的这张牌是——`)}
  <div class="sheet-body">
    <div class="sheet-sub">一次声明 2 个选项：「蓝A 或 蓝B」/「蓝A 或 黄」；两个选项都须持有对应未公开导线</div>
    ${_orderWarnHTML()}
    <div class="guess-grid">${btns}${yellowBtn}</div>
    <button class="btn-full btn-primary" data-testid="ray-confirm"${_ui.rayOpts.length === 2 ? '' : ' disabled'} onclick="onRayConfirm()">确认选项（${_ui.rayOpts.length}/2）</button>
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

function _rayOwnSheetHTML() {
  const actor = _actorSeat();
  if (actor === null) {
    return `${_sheetHead('➿ 公开你的导线')}<div class="sheet-body"><div class="sheet-empty">等待中…</div></div>`;
  }
  const rowFor = (opt, which, pickedId) => {
    const cands = _ownCandsFor(actor, opt);
    const btns = cands.map(c =>
      `<button class="pick-card${pickedId === c.id ? ' selected' : ''}" data-cardid="${c.id}" onclick="onRayOwnPick('${which}','${c.id}')">
        <span class="pc-num">${_kindLabel(c.kind)} ${_fmtNum(c.num)}</span>
        <span class="pc-pos">${_cardPosLabel(actor, c.id)}</span>
      </button>`).join('');
    return `<div class="sheet-sub">选项 ${which.toUpperCase()}「${_rayOptLabel(opt)}」命中时，你公开 1 张：</div>
      <div class="pick-row">${btns || '<div class="sheet-empty">没有对应的未公开导线</div>'}</div>`;
  };
  const ok = _ui.rayOpts.length === 2 && _ui.rayOwn.a && _ui.rayOwn.b;
  return `${_sheetHead('➿ 命中时公开你的导线')}
  <div class="sheet-body">
    <div class="sheet-sub">两个选项各自预先选定 1 张（命中哪项就公开哪张）</div>
    ${_ui.rayOpts.length === 2 ? rowFor(_ui.rayOpts[0], 'a', _ui.rayOwn.a) : ''}
    ${_ui.rayOpts.length === 2 ? rowFor(_ui.rayOpts[1], 'b', _ui.rayOwn.b) : ''}
    <button class="btn-full btn-primary" data-testid="ray-settle"${ok ? '' : ' disabled'} onclick="onConfirmRay()">确认射线</button>
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

function _batterySheetHTML() {
  const actor = _actorSeat();
  const btns = [];
  for (let s = 0; s < S.pCount; s++) {
    const p = S.players[s];
    if (!p) continue;
    const sel = _ui.batterySel.indexOf(s) >= 0;
    const dis = !p.skillUsed;
    btns.push(`<button class="pick-card${sel ? ' selected' : ''}${dis ? ' dim' : ''}" data-testid="battery-p${s}" data-seat="${s}"${dis ? ' disabled' : ''} onclick="onBatteryToggle(${s})">
      <span class="pc-num">🔋 ${_esc(p.name)}${s === actor ? '（你）' : ''}</span>
      <span class="pc-pos">${p.skillUsed ? '双重探测器已使用，可恢复' : '未使用过双重探测器'}</span>
    </button>`);
  }
  const okCount = _ui.batterySel.length >= 1 && _ui.batterySel.length <= 2;
  return `${_sheetHead('🔋 备用电池：恢复双重探测器')}
  <div class="sheet-body">
    <div class="sheet-sub">选择 1~2 名本局已使用过双重探测器的玩家（可含自己）</div>
    <div class="pick-row">${btns.join('')}</div>
    <button class="btn-full btn-primary" data-testid="battery-confirm"${okCount ? '' : ' disabled'} onclick="onBatteryConfirm()">确认（${_ui.batterySel.length}/2）</button>
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

function _radarSheetHTML() {
  const btns = [];
  for (let n = 1; n <= 12; n++) {
    btns.push(`<button class="guess-btn" data-guess="radar-${n}" onclick="onRadarPick(${n})">${n}</button>`);
  }
  return `${_sheetHead('📡 通用雷达：选择探测数字')}
  <div class="sheet-body">
    <div class="sheet-sub">系统将自动公布每名玩家每份手牌「是否还有未公开的该数字蓝线」（含你自己）</div>
    <div class="guess-grid">${btns.join('')}</div>
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

function _coffeeSheetHTML() {
  const actor = _actorSeat();
  const btns = [];
  for (let s = 0; s < S.pCount; s++) {
    if (s === actor || !S.players[s]) continue;
    const hidden = hiddenCards(s).length;
    btns.push(`<button class="pick-card${hidden === 0 ? ' dim' : ''}" data-testid="coffee-to" data-seat="${s}"${hidden === 0 ? ' disabled' : ''} onclick="onCoffeePick(${s})">
      <span class="pc-num">☕ ${_esc(_playerName(s))}</span>
      <span class="pc-pos">未公开 ${hidden} 张</span>
    </button>`);
  }
  return `${_sheetHead('☕ 咖啡瓶：跳过回合，请选择交给谁？')}
  <div class="sheet-body">
    <div class="sheet-sub">你本回合不行动；从所选玩家开始继续后续回合（该玩家须仍有未公开手牌）</div>
    <div class="pick-row">${btns.join('') || '<div class="sheet-empty">没有符合条件的其他玩家</div>'}</div>
    <button class="btn-full btn-secondary" onclick="closeSheet()">取消</button>
  </div>`;
}

/* ============================================================
   交互：流程启动
   ============================================================ */

function startPairCut() {
  if (!_myTurn()) return;
  _ui.mode = 'pair-target';
  _ui.targetSeat = null; _ui.targetCardId = null;
  _ui.guess = null; _ui.ownCard = null;
  render();
}

function startSoloCut() {
  if (!_myTurn()) return;
  _ui.mode = 'solo';
  _openSheet();
  _refreshSheet();
  render();
}

function startRevealRed() {
  if (!_myTurn()) return;
  const plan = _planRevealRed();
  if (!plan.ok) { showToast(plan.msg || '无法公开红线'); return; }
  _startFxSequence('red', plan);
}

function startSkill() {
  if (!_myTurn()) return;
  const r = useSkill();
  if (r && !r.ok) { showToast(r.msg || '无法使用'); return; }
  _ui.mode = 'scan';
  _ui.scanSrc = 'skill';
  _ui.scanSel = [];
  render();
}

function startScanFlow(src) {
  if (!_myTurn()) return;
  _ui.mode = 'scan';
  _ui.scanSrc = src || (S.scanMode && S.scanMode.src) || 'eq3';
  _ui.scanSel = [];
  _ui.guess = null; _ui.ownCard = null;
  render();
}

/** 取消已启动的双重探测器（返回普通行动栏） */
function cancelSkillFlow() {
  if (!_myTurn()) return;
  const r = cancelSkill();
  if (r && !r.ok) { showToast(r.msg || '无法取消'); return; }
  _ui.mode = null;
  _ui.scanSrc = null; _ui.scanSel = [];
  _ui.guess = null; _ui.ownCard = null;
  render();
}

function onEquipClick(no) {
  if (!_myTurn()) {
    showToast((S.pending || S.fx) ? '请先完成当前操作' : '只能在自己回合使用道具');
    return;
  }
  const eq = (S.equipment || []).find(e => e.no === no);
  if (!eq) return;
  const stabArmed = !!(S.cutMods && S.cutMods.stabilize !== null && S.cutMods.stabilize !== undefined);
  // 该道具已进入选择流程但尚未真正使用：再次点击 = 取消
  const active = (no === 1 && _ui.mode === 'neq')
    || (no === 2 && _ui.mode === 'walkie-card')
    || (no === 3 && _ui.mode === 'scan' && _ui.scanSrc === 'eq3')
    || (no === 4 && _ui.mode === 'sticky')
    || (no === 5 && (_ui.mode === 'super' || _ui.mode === 'super-guess' || _ui.mode === 'super-own'))
    || (no === 10 && (_ui.mode === 'ray-target' || _ui.mode === 'ray-guess' || _ui.mode === 'ray-own'))
    || (no === 12 && _ui.mode === 'eqtag');
  if (active) { cancelFlow(); showToast('已取消使用道具'); return; }
  if (no === 9 && stabArmed) {          // 稳定剂：取消 = 撤销稳定状态（未消耗）
    const rc = cancelStabilizer();
    if (rc && !rc.ok) showToast(rc.msg || '无法取消');
    return;
  }
  if (eq.used) { showToast('该道具已使用过'); return; }
  if (!eq.unlocked) {
    showToast(typeof eq.lockNum === 'number'
      ? `该道具尚未解锁（蓝色 ${eq.no} 全部公开，且 🔒${eq.lockNum} 公开 ≥2）`
      : '该道具尚未解锁（蓝 4/4 拆除后解锁）');
    return;
  }
  if (S.scanMode) { showToast('已启动探测器，本回合只能扫描'); return; }
  const lib = (typeof EQUIPMENT_LIB === 'object' && EQUIPMENT_LIB) ? EQUIPMENT_LIB[no] : null;
  if (!lib) { showToast('该道具规则后续开放'); return; }
  if (no === 1) {
    _ui.mode = 'neq'; _ui.scanSel = [];
  } else if (no === 2) {
    _ui.mode = 'walkie-card'; _ui.fromCardId = null;
  } else if (no === 3) {
    _ui.mode = 'scan'; _ui.scanSrc = 'eq3';
    _ui.scanSel = []; _ui.guess = null; _ui.ownCard = null;
  } else if (no === 4) {
    _ui.mode = 'sticky';
  } else if (no === 5) {
    _ui.mode = 'super';
    _ui.targetSeat = null; _ui.targetCardId = null; _ui.superShare = null;
    _ui.guess = null; _ui.ownCard = null;
  } else if (no === 6) {
    const r = useSuppressor();
    if (r && !r.ok) showToast(r.msg || '无法使用');
    return;
  } else if (no === 7) {
    _ui.mode = 'battery'; _ui.batterySel = [];
    _openSheet();
  } else if (no === 8) {
    _ui.mode = 'radar';
    _openSheet();
  } else if (no === 9) {
    const r = useStabilizer();
    if (r && !r.ok) showToast(r.msg || '无法使用');
    return;
  } else if (no === 10) {
    _ui.mode = 'ray-target';
    _ui.targetSeat = null; _ui.targetCardId = null;
    _ui.rayOpts = []; _ui.rayOwn = { a: null, b: null };
  } else if (no === 11) {
    _ui.mode = 'coffee';
    _openSheet();
  } else if (no === 12) {
    _ui.mode = 'eqtag'; _ui.scanSel = [];
  }
  render();
}

function cancelFlow() {
  const ov = document.getElementById('sheetOverlay');
  if (ov) ov.classList.remove('show');
  _ui.mode = null;
  _ui.targetSeat = null; _ui.targetCardId = null;
  _ui.guess = null; _ui.ownCard = null;
  _ui.scanSrc = null; _ui.scanSel = [];
  _ui.fromCardId = null;
  _ui.superShare = null;
  _ui.rayOpts = []; _ui.rayOwn = { a: null, b: null };
  _ui.batterySel = [];
  render();
}

/* ============================================================
   交互：选牌
   ============================================================ */

function onEnemyCardClick(cardId) {
  if (_ui.mode === 'pair-target') {
    const loc = _locateCardAnywhere(cardId);
    const card = _findCardById(cardId);
    if (!loc || loc.seat === _actorSeat()) { showToast('请选择其他玩家的牌'); return; }
    if (!card || card.revealed) { showToast('只能选择未公开的牌'); return; }
    _ui.targetSeat = loc.seat;
    _ui.targetCardId = cardId;
    _ui.guess = null; _ui.ownCard = null;
    _ui.mode = 'pair-guess';
    _openSheet();
    _refreshSheet();
    render();
    return;
  }
  if (_ui.mode === 'super') {
    const loc = _locateCardAnywhere(cardId);
    const card = _findCardById(cardId);
    if (!loc || loc.seat === _actorSeat()) { showToast('请选择其他玩家的牌'); return; }
    if (!card || card.revealed) { showToast('只能选择未公开的牌'); return; }
    _ui.targetSeat = loc.seat;
    _ui.targetCardId = cardId;      // 高亮所选份中的这张（代表整份）
    _ui.superShare = loc.si;
    _ui.guess = null; _ui.ownCard = null;
    _ui.mode = 'super-guess';
    _openSheet();
    _refreshSheet();
    render();
    return;
  }
  if (_ui.mode === 'ray-target') {
    const loc = _locateCardAnywhere(cardId);
    const card = _findCardById(cardId);
    if (!loc || loc.seat === _actorSeat()) { showToast('请选择其他玩家的牌'); return; }
    if (!card || card.revealed) { showToast('只能选择未公开的牌'); return; }
    _ui.targetSeat = loc.seat;
    _ui.targetCardId = cardId;
    _ui.rayOpts = []; _ui.rayOwn = { a: null, b: null };
    _ui.mode = 'ray-guess';
    _openSheet();
    _refreshSheet();
    render();
    return;
  }
  if (_ui.mode === 'scan') {
    _scanSelect(cardId);
  }
}

function onOwnCardClick(seat, si, cardId) {
  const card = _findCardById(cardId);
  if (!card) return;

  if (S.phase === 'mark') {
    if (S.ready[seat]) { showToast('该玩家已完成标记'); return; }
    if (card.kind !== 'blue') { showToast('只能标记蓝色导线'); return; }
    if (card.revealed) { showToast('只能标记未公开的导线'); return; }
    const r = placeInfoToken(cardId);
    if (r && !r.ok) showToast(r.msg);
    return;
  }

  if (S.pending) {
    if (S.pending.type === 'walkie' && seat === S.pending.toSeat && canActAs(seat)) {
      const r = resolveWalkie(cardId);
      if (r && !r.ok) showToast(r.msg);
    }
    return;
  }

  if (!_myTurn() || seat !== _actorSeat()) return;

  if (_ui.mode === 'neq') {
    _neqSelect(seat, cardId);
    return;
  }
  if (_ui.mode === 'eqtag') {
    _eqtagSelect(seat, cardId);
    return;
  }
  if (_ui.mode === 'sticky') {
    const r = useStickyNote(cardId);
    if (r && r.ok) cancelFlow();
    else showToast((r && r.msg) || '无法使用便利贴');
    return;
  }
  if (_ui.mode === 'walkie-card') {
    if (card.revealed) { showToast('请选择未公开导线'); return; }
    _ui.fromCardId = cardId;
    _ui.mode = 'walkie-target';
    _openSheet();
    _refreshSheet();
    render();
  }
}

/** 扫描选牌：同一份内相邻、未公开、他人 */
function _scanSelect(cardId) {
  const count = _scanCount();
  const i = _ui.scanSel.findIndex(x => x.id === cardId);
  if (i >= 0) {
    _ui.scanSel.splice(i, 1);
    render();
    return;
  }
  const found = _locateCardAnywhere(cardId);
  if (!found) return;
  if (found.seat === _actorSeat()) { showToast('请选择其他玩家的牌'); return; }
  const entry = { id: cardId, seat: found.seat, si: found.si, idx: found.idx };
  const cur = _ui.scanSel;
  if (cur.length === 0) {
    cur.push(entry);
  } else if (found.seat !== cur[0].seat) {
    _ui.scanSel = [entry];
    showToast('已切换目标玩家');
  } else if (found.si !== cur[0].si) {
    _ui.scanSel = [entry];
    showToast('已切换为新的手牌');
  } else {
    const idxs = cur.map(x => x.idx).concat(found.idx).sort((a, b) => a - b);
    let contiguous = true;
    for (let k = 1; k < idxs.length; k++) if (idxs[k] !== idxs[k - 1] + 1) contiguous = false;
    if (!contiguous) { showToast('须选择相邻的牌'); return; }
    cur.push(entry);
  }
  render();
  if (_ui.scanSel.length === count) {
    _ui.mode = 'scan-guess';
    _ui.guess = null; _ui.ownCard = null;
    _openSheet();
    _refreshSheet();
  }
}

/** ≠ 标签选牌：自己同一份内相邻 2 张（可含已公开牌），满 2 张立即执行 */
function _neqSelect(seat, cardId) {
  const found = _locateCardAnywhere(cardId);
  if (!found || found.seat !== _actorSeat()) return;
  const i = _ui.scanSel.findIndex(x => x.id === cardId);
  if (i >= 0) {
    _ui.scanSel.splice(i, 1);
    render();
    return;
  }
  const cur = _ui.scanSel;
  if (cur.length === 0) {
    cur.push({ id: cardId, seat: found.seat, si: found.si, idx: found.idx });
    render();
    return;
  }
  const first = cur[0];
  if (found.si !== first.si || Math.abs(found.idx - first.idx) !== 1) {
    showToast('须选择同一份手牌内相邻的 2 张牌');
    return;
  }
  const a = first.idx < found.idx ? first.id : cardId;
  const b = first.idx < found.idx ? cardId : first.id;
  const r = useNeqTag(first.si, a, b);
  if (r && r.ok) {
    cancelFlow();
  } else {
    showToast((r && r.msg) || '无法标记');
    _ui.scanSel = [];
    render();
  }
}

/** ＝ 标签选牌：自己同一份内相邻 2 张（可含已公开牌，须同色），满 2 张立即执行 */
function _eqtagSelect(seat, cardId) {
  const found = _locateCardAnywhere(cardId);
  if (!found || found.seat !== _actorSeat()) return;
  const i = _ui.scanSel.findIndex(x => x.id === cardId);
  if (i >= 0) {
    _ui.scanSel.splice(i, 1);
    render();
    return;
  }
  const cur = _ui.scanSel;
  if (cur.length === 0) {
    cur.push({ id: cardId, seat: found.seat, si: found.si, idx: found.idx });
    render();
    return;
  }
  const first = cur[0];
  if (found.si !== first.si || Math.abs(found.idx - first.idx) !== 1) {
    showToast('须选择同一份手牌内相邻的 2 张牌');
    return;
  }
  const r = useEqTag(first.si, first.id, cardId);
  if (r && r.ok) {
    cancelFlow();
  } else {
    showToast((r && r.msg) || '无法标记');
    _ui.scanSel = [];
    render();
  }
}

/* ============================================================
   猜测对话气泡：宣告 → 回应 → 结算（各端同节奏）
   ============================================================ */

const _fx = { seen: null, timers: [] };

function _clearBubbles() {
  _fx.timers.forEach(t => clearTimeout(t));
  _fx.timers = [];
  const layer = document.getElementById('bubble-layer');
  if (layer) layer.innerHTML = '';
  document.querySelectorAll('.fx-target').forEach(el => el.classList.remove('fx-target', 'fx-hit', 'fx-miss'));
}

/** 聚光灯：高亮被指认的牌（declare=金色脉冲；reply=命中绿/失误红） */
function _spotlight(fx, phase) {
  const ids = (fx && fx.ids) || [];
  ids.forEach(id => {
    document.querySelectorAll('[data-cardid="' + id + '"]').forEach(el => {
      el.classList.add('fx-target');
      el.classList.toggle('fx-hit', phase === 'hit');
      el.classList.toggle('fx-miss', phase === 'miss');
    });
  });
}

function _bubbleText(fx, phase) {
  const mine = mySeat() !== null && fx.by === mySeat();
  if (phase === 'declare') {
    const by = mine ? '' : _playerName(fx.by) + '：';
    if (fx.kind === 'pair') return `${by}这张是「${fx.label}」！`;
    if (fx.kind === 'solo') return `${by}我公开我手上的 ${fx.count} 张「${fx.label}」！`;
    if (fx.kind === 'red') return `${by}我公开我手上最后${(fx.count || 1) > 1 ? ` ${fx.count} 张` : '一张'}红色导线！`;
    if (fx.superScan) return `${by}超级探测器扫描你整份手牌——我猜有「${fx.label}」！`;
    return `${by}扫描这 ${fx.count} 张——我猜有「${fx.label}」！`;
  }
  const toMine = mySeat() !== null && fx.to === mySeat();
  const to = toMine ? '' : _playerName(fx.to) + '：';
  if (fx.kind === 'pair') return fx.hit ? `${to}被你猜中了！` : `${to}猜错啦～`;
  if (fx.superScan) return fx.hit ? `${to}命中了！这份手牌里有「${fx.label}」` : `${to}这份手牌里没有「${fx.label}」…`;
  return fx.hit ? `${to}命中了！有「${fx.label}」` : `${to}这里没有「${fx.label}」…`;
}

function _bubbleEl(seat, phase, text, extra) {
  const mine = mySeat() !== null && seat === mySeat();
  const el = document.createElement('div');
  el.className = 'bubble ' + phase + ' ' + (mine ? 'mine' : 'theirs') + (extra ? ' ' + extra : '');
  el.textContent = text;
  return el;
}

function _playBubbles(fx) {
  _clearBubbles();
  const layer = document.getElementById('bubble-layer');
  if (!layer) return;
  const put = (seat, phase, text, extra) => {
    layer.appendChild(_bubbleEl(seat, phase, text, extra));
    while (layer.children.length > 2) layer.removeChild(layer.firstChild);
  };
  put(fx.by, 'declare', _bubbleText(fx, 'declare'));
  _spotlight(fx, 'declare');
  if (fx.kind !== 'solo' && fx.kind !== 'red') {   // 单人剪线 / 公开红线只有宣告，无回应气泡
    _fx.timers.push(setTimeout(() => {
      put(fx.to, 'reply', _bubbleText(fx, 'reply'), fx.hit ? 'hit' : 'miss');
      _spotlight(fx, fx.hit ? 'hit' : 'miss');
    }, 650));
  }
  _fx.timers.push(setTimeout(_clearBubbles, 1950));
}

/** 本端发起：写 S.fx 广播宣告（各端同节奏播放气泡），2s 后清 fx 并结算 */
function _startFxSequence(kind, plan) {
  const ids = kind === 'scan' ? plan.targetCards.map(c => c.id)
    : kind === 'solo' ? plan.cards.map(c => c.id)
    : kind === 'red' ? plan.cards.map(c => c.id)
    : [plan.card.id];                     // pair / ray：单张目标
  const fx = {
    id: 'fx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    kind,
    by: plan.actor,
    to: kind === 'pair' ? plan.toSeat : kind === 'scan' ? plan.targetSeat : plan.actor,
    label: plan.label,
    hit: !!plan.hit,
    count: kind === 'scan' || kind === 'solo' || kind === 'red' ? plan.count : 0,
    superScan: kind === 'scan' && plan.src === 'eq5',
    ids,                                  // 被指认的牌：气泡期间聚光高亮
  };
  _fx.seen = fx.id;
  if (S) S.fx = fx;
  saveStateDirect();                    // 气泡宣告先行同步
  render();                             // 立即进入等待态并点亮目标牌
  _playBubbles(fx);
  setTimeout(() => {
    if (!S || S.fx !== fx) { _clearBubbles(); return; }
    S.fx = null;
    _clearBubbles();
    if (kind === 'pair') { if (plan.src === 'eq10') _applyRayCut(plan); else _applyPairCut(plan); }
    else if (kind === 'scan') { if (plan.src === 'eq5') _applySuperScan(plan); else _applyScan(plan); }
    else if (kind === 'solo') _applySoloCut(plan);
    else _applyRevealRed(plan);
  }, 2000);
}

/** 联机层钩子：远端 fx 宣告 → 本地重放气泡；fx 清空 → 收尾 */
window._fxReplay = function (fx) {
  if (!fx) { _clearBubbles(); return; }
  if (_fx.seen === fx.id) return;
  _fx.seen = fx.id;
  _playBubbles(fx);
};

/* ============================================================
   交互：弹层选择与确认
   ============================================================ */

function onGuessPick(v) {
  if (v === 'yellow') {
    _ui.guess = { kind: 'yellow' };
  } else {
    const m = /^blue-(\d+)$/.exec(v);
    if (!m) return;
    _ui.guess = { kind: 'blue', num: parseInt(m[1], 10) };
  }
  const actor = _actorSeat();
  const isSuper = _ui.mode === 'super-guess';
  const isScan = _ui.mode === 'scan-guess' || isSuper;
  const cands = _ownGuessCandidates(actor, _ui.guess, isScan);
  _ui.ownCard = cands.length === 1 ? cands[0].id : null;
  _ui.mode = isSuper ? 'super-own' : (isScan ? 'scan-own' : 'pair-own');
  _refreshSheet();
  render();
}

function onOwnPick(cardId) {
  _ui.ownCard = cardId;
  _refreshSheet();
  render();
}

function onConfirmCut() {
  if (!_ui.ownCard) { showToast('请先选择要公开的牌'); return; }
  if (_ui.mode === 'pair-own') {
    const plan = _planPairCut(_ui.targetSeat, _ui.targetCardId, _ui.guess, _ui.ownCard);
    if (!plan.ok) { showToast(plan.msg || '无法执行'); return; }
    closeSheet();
    _startFxSequence('pair', plan);
  } else if (_ui.mode === 'scan-own') {
    const ids = _ui.scanSel.map(x => x.id);
    const src = _ui.scanSrc || (S.scanMode && S.scanMode.src) || 'eq3';
    const plan = _planScan(ids, _ui.guess.num, _ui.ownCard, src);
    if (!plan.ok) { showToast(plan.msg || '无法执行'); return; }
    closeSheet();
    _startFxSequence('scan', plan);
  } else if (_ui.mode === 'super-own') {
    const plan = _planSuperScan(_ui.targetSeat, _ui.superShare, _ui.guess.num, _ui.ownCard);
    if (!plan.ok) { showToast(plan.msg || '无法执行'); return; }
    closeSheet();
    _startFxSequence('scan', plan);
  }
}

/* ── 道具 10/7/8/11 的回调 ── */

function onRayOptTg(v) {
  const m = /^blue-(\d+)$/.exec(v);
  const opt = m ? { kind: 'blue', num: parseInt(m[1], 10) } : { kind: 'yellow' };
  const i = _ui.rayOpts.findIndex(o => o.kind === opt.kind && (o.kind !== 'blue' || o.num === opt.num));
  if (i >= 0) {
    _ui.rayOpts.splice(i, 1);
  } else {
    if (_ui.rayOpts.length >= 2) { showToast('最多选择 2 个猜测选项'); return; }
    _ui.rayOpts.push(opt);
  }
  _refreshSheet();
  render();
}

function onRayConfirm() {
  if (_ui.rayOpts.length !== 2) { showToast('请选择 2 个猜测选项'); return; }
  _ui.rayOwn = { a: null, b: null };
  const actor = _actorSeat();
  _ui.rayOpts.forEach((o, k) => {          // 仅 1 张候选时自动选中
    const cands = _ownCandsFor(actor, o);
    if (cands.length === 1) _ui.rayOwn[k === 0 ? 'a' : 'b'] = cands[0].id;
  });
  _ui.mode = 'ray-own';
  _refreshSheet();
  render();
}

function onRayOwnPick(which, cardId) {
  if (which === 'a') _ui.rayOwn.a = cardId; else _ui.rayOwn.b = cardId;
  _refreshSheet();
  render();
}

function onConfirmRay() {
  if (!_ui.rayOwn.a || !_ui.rayOwn.b) { showToast('请为两个选项各选 1 张自选牌'); return; }
  if (_ui.rayOpts.length !== 2) { showToast('请先选择 2 个猜测选项'); return; }
  const plan = _planRayCut(_ui.targetSeat, _ui.targetCardId, _ui.rayOpts[0], _ui.rayOpts[1], _ui.rayOwn.a, _ui.rayOwn.b);
  if (!plan.ok) { showToast(plan.msg || '无法执行'); return; }
  closeSheet();
  _startFxSequence('pair', plan);
}

function onBatteryToggle(seat) {
  const i = _ui.batterySel.indexOf(seat);
  if (i >= 0) _ui.batterySel.splice(i, 1);
  else {
    if (_ui.batterySel.length >= 2) { showToast('最多选择 2 名玩家'); return; }
    _ui.batterySel.push(seat);
  }
  _refreshSheet();
  render();
}

function onBatteryConfirm() {
  const r = useBattery(_ui.batterySel);
  if (r && r.ok) closeSheet();
  else showToast((r && r.msg) || '无法使用');
}

function onRadarPick(n) {
  const r = useRadar(n);
  if (r && r.ok) closeSheet();
  else showToast((r && r.msg) || '无法使用');
}

function onCoffeePick(seat) {
  const r = useCoffee(seat);
  if (r && r.ok) closeSheet();
  else showToast((r && r.msg) || '无法使用');
}

function onSoloOpt(i) {
  const actor = _actorSeat();
  if (actor === null) return;
  const opts = soloOptions(actor);
  if (!opts[i]) { showToast('选项已失效，请重新打开'); return; }
  const plan = _planSoloCut(opts[i]);
  if (!plan.ok) { showToast(plan.msg || '无法执行'); return; }
  closeSheet();
  _startFxSequence('solo', plan);
}

function onWalkieTarget(seat) {
  if (!_ui.fromCardId) { showToast('请先选择要交换出去的牌'); return; }
  const r = useWalkie(_ui.fromCardId, seat);
  if (r && r.ok) closeSheet();
  else showToast((r && r.msg) || '无法执行');
}

function onScanPickChoose(cardId) {
  const r = resolveScanPick(cardId);
  if (r && !r.ok) showToast(r.msg || '无法选择');
}

function onScanMarkChoose(cardId) {
  const r = resolveScanMark(cardId);
  if (r && !r.ok) showToast(r.msg || '无法选择');
}

/* ============================================================
   动效：发牌渐入 / 翻牌 / 拆除盖印 / 道具解锁 / 失误红闪
   ============================================================ */

function _applyAnimations(app) {
  if (!app || !S || !S.players) return;
  const first = _prevAnim.first;
  const dealChanged = _prevAnim.dealStamp !== S.dealStamp;

  if (dealChanged || first) {
    const els = app.querySelectorAll('.card-own, .card-back, .player-row, .own-hand');
    els.forEach((el, i) => {
      el.classList.add('deal-in');
      el.style.animationDelay = Math.min(i * 18, 720) + 'ms';
    });
  }

  // 翻牌：新公开的牌
  const curRev = new Set();
  _eachCard(c => { if (c.revealed) curRev.add(c.id); });
  if (!first && !dealChanged) {
    app.querySelectorAll('.card.revealed').forEach(el => {
      const id = el.getAttribute('data-cardid');
      if (id && !_prevAnim.revealed.has(id)) el.classList.add('anim-reveal');
    });
  }
  _prevAnim.revealed = curRev;

  // 拆除盖印
  const def = (S.board && S.board.defused) || [];
  if (!first && !dealChanged) {
    app.querySelectorAll('.cell[data-cell]').forEach(el => {
      const n = parseInt(el.getAttribute('data-cell'), 10);
      if (!n) return;
      const was = _prevAnim.defused && _prevAnim.defused[n - 1];
      if (def[n - 1] && !was) el.classList.add('anim-defuse');
    });
  }
  _prevAnim.defused = def.slice();

  // 道具解锁翻牌
  const unlockedNow = new Set((S.equipment || []).filter(e => e.unlocked).map(e => e.no));
  if (!first && !dealChanged && _prevAnim.unlocked) {
    app.querySelectorAll('.equip-btn[data-no]').forEach(el => {
      const no = parseInt(el.getAttribute('data-no'), 10);
      if (no && unlockedNow.has(no) && !_prevAnim.unlocked.has(no)) el.classList.add('anim-unlock');
    });
  }
  _prevAnim.unlocked = unlockedNow;

  // 失误 → 屏幕红闪
  if (!first && !dealChanged && S.failures > _prevAnim.failures) {
    document.body.classList.add('boom-flash');
    clearTimeout(_prevAnim._boomT);
    _prevAnim._boomT = setTimeout(() => document.body.classList.remove('boom-flash'), 650);
  }
  _prevAnim.failures = S.failures;

  _prevAnim.first = false;
  _prevAnim.dealStamp = S.dealStamp;
}

/* ============================================================
   结算面板（#endModal；行动入口在 own-area 下方终局按钮区）
   ============================================================ */

function showEndModal() {
  const el = document.getElementById('endModalContent');
  if (!el || !S || !S.result) return;
  const win = !!S.result.win;
  const reason = S.result.reason || '';
  const reasonText = win
    ? '全场导线全部公开，完美拆弹！'
    : reason === 'boom-red'
      ? '指认到了红色导线——炸弹起爆！'
      : reason === 'boom-order'
        ? '未按剪线顺序公开蓝色导线——炸弹起爆！'
        : reason === 'boom-timeout'
          ? '倒计时结束，仍有导线未公开——炸弹起爆！'
          : '失误达到上限——炸弹起爆！';
  let hiddenTotal = 0;
  _eachCard(c => { if (!c.revealed) hiddenTotal++; });
  const defusedN = ((S.board && S.board.defused) || []).filter(Boolean).length;

  el.innerHTML = `
  <div class="end-wrap ${win ? 'win' : 'lose'}">
    <div class="end-icon">${win ? '🎉' : '💥'}</div>
    <h2 class="end-title">${win ? '拆弹成功！' : '炸弹起爆…'}</h2>
    <div class="end-sub">${reasonText}</div>
    <div class="end-stats">
      <div class="stat"><span class="stat-num">${S.failures}/${S.pCount}</span><span class="stat-label">失误</span></div>
      <div class="stat"><span class="stat-num">${defusedN}/12</span><span class="stat-label">拆除数字</span></div>
      <div class="stat"><span class="stat-num">${hiddenTotal}</span><span class="stat-label">未公开导线</span></div>
    </div>
    ${isHost()
      ? `<button class="btn-full btn-primary" data-testid="btn-restart" onclick="closeModal('endModal');restartGame();">🔄 再来一局</button>`
      : '<div class="end-wait">⏳ 等待房主开始下一局…</div>'}
    <button class="btn-full btn-secondary" data-testid="btn-end-confirm" onclick="closeModal('endModal')">确认</button>
  </div>`;

  const ov = document.getElementById('endModal');
  if (ov) ov.classList.add('show');
}
