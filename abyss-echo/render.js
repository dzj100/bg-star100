/* ============================================================
 * 《深渊回响》Abyss Echo — 渲染模块
 * 纯静态渲染：读取全局 state（game.js 提供），全量重建 #app 内 HTML。
 * 所有交互通过全局 act(action, ...args)（game.js 提供）。
 * ============================================================ */

window._menuSelection = window._menuSelection || [];
let _combatHandFocus = 0;  // 移动端多角色手牌模式下，当前展示的角色索引
let _bossIntroUntil = 0;       // Boss 登场动画：时间戳守卫，开场 3.4s 内 re-render 不截断演出
let _bossIntroFight = null;    // 当前播放过登场的 combat 对象（每场战斗只播一次）
let _bossIntroTimer = null;    // 窗口到期后重渲染移除 overlay
let _bossDeathPlaying = false; // Boss 死亡动画：防止 setTimeout 重复叠加
let _hpPrev = {};              // 血条动画：单位 key -> 上次渲染的 hp 百分比
let _hpBattleKey = null;       // 血条动画：当前战斗标识，换战斗时重置 _hpPrev
let _enemyTimer = null;        // 敌人分步行动：逐个攻击的间隔定时器守卫
function setHandFocus(pi) { _combatHandFocus = pi; render(); }

/* ---------- 工具 ---------- */

function getState() {
  try {
    if (typeof state !== 'undefined' && state) return state;
  } catch (e) {}
  return window.state || null;
}

function clsCard(id) {
  return CLASSES[id] || { name: id, title: '', hp: 0, color: '#4da6ff', desc: '', mechanic: '', mechanicDesc: '' };
}
function cardDef(id) {
  return CARDS[id] || { id: id, name: id, cost: 0, type: '', target: '', desc: '' };
}
function relicDef(id) {
  return RELICS[id] || { id: id, name: id, desc: '' };
}
function typeName(t) {
  return { attack: '攻击', skill: '技能', power: '能力' }[t] || '';
}
function isPersistentEffect(t) {
  return ['applyStatus','allStatus','buff','allBuff','guard'].includes(t);
}
function hasPersistent(def) {
  if (!def || !def.effects) return false;
  if (def.type === 'power') return true;
  return def.effects.some(e => isPersistentEffect(e.t));
}
function statusName(k) {
  const m = BUFF_META[k];
  return m ? m.name : k;
}
function nodeLabel(n) {
  if (n.type === 'boss') {
    const def = ENEMIES[n.enemyId];
    if (def) return def.name;
    const s = getState();
    const floor = (s && s.run && s.run.floor) || 1;
    const bossId = floor === 3 ? 'abyssal_will' : floor === 2 ? 'tide_matron' : 'great_eye';
    const bdef = ENEMIES[bossId];
    return bdef ? bdef.name : '首领';
  }
  return { combat: '战斗', elite: '精英', event: '事件', shop: '商店', rest: '休息' }[n.type] || n.type || '?';
}

function hpBar(cur, max) {
  cur = Number(cur) || 0;
  max = Number(max) || 1;
  const pct = Math.max(0, Math.min(100, (cur / max) * 100));
  return `<div class="hp-bar"><div class="hp-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
}
/* 战斗用血条：与上次渲染的百分比有差异时播平滑动画（CSS keyframes 引用 --prev-w） */
function hpBarAnim(cur, max, key) {
  cur = Number(cur) || 0;
  max = Number(max) || 1;
  const pct = Math.max(0, Math.min(100, (cur / max) * 100));
  const prev = _hpPrev[key];
  _hpPrev[key] = pct;
  const low = pct < 25;
  if (prev === undefined || Math.abs(prev - pct) < 0.05) {
    return `<div class="hp-bar${low ? ' low' : ''}"><div class="hp-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
  }
  return `<div class="hp-bar anim${low ? ' low' : ''}"><div class="hp-fill" style="--prev-w:${prev.toFixed(1)}%;--cur-w:${pct.toFixed(1)}%;width:${pct.toFixed(1)}%"></div></div>`;
}
function blockBadge(block) {
  block = Number(block) || 0;
  return block > 0 ? `<span class="block-badge">${block}</span>` : '';
}
function buffChips(buffs, only) {
  if (!buffs) return '';
  return Object.keys(buffs)
    .filter(k => Number(buffs[k]) > 0)
    .filter(k => !only || (BUFF_META[k] || { kind: 'buff' }).kind === only)
    .map(k => {
      const meta = BUFF_META[k] || { name: k, kind: 'buff' };
      const val = buffs[k];
      const html = `<div class="tip-title">${meta.name} ${val}</div><div class="tip-body">${(meta.desc || '').replace(/X/g, val)}</div>`;
      return `<span class="buff-chip ${meta.kind === 'debuff' ? 'debuff' : 'buff'}"${tipAttrs(html)}>${meta.name} ${val}</span>`;
    })
    .join('');
}

function mechProgressHtml(p, playerIdx) {
  const c = state.combat;
  if (!c) return '';
  if (p.classId === 'scholar') {
    const prog = (c.spellsPlayed[playerIdx] || 0) % 3;
    const dots = [0, 1, 2].map(d => `<i class="mech-dot${d < prog ? ' on' : ''}"></i>`).join('');
    return `<span class="mech-progress" title="潮汐进度 ${prog}/3">${dots}</span>`;
  }
  if (p.classId === 'hunter') {
    const combo = c.cardsPlayed[playerIdx] || 0;
    return `<span class="combo-badge" title="下张攻击牌伤害+${combo}">×${combo}</span>`;
  }
  return '';
}

/* ---------- 卡牌与牌组 ---------- */

/* 升级卡的描述：把基础数值逐个替换为升级数值 */
function cardDesc(def, inst) {
  if (!inst.upg || !def.upgEffects || !def.effects) return def.desc || '';
  const effects = def.effects, upgs = def.upgEffects;
  let desc = def.desc;
  if (effects.length === 1 && upgs[0] && upgs[0].n !== undefined && upgs[0].n !== effects[0].n) {
    return desc.split(String(effects[0].n)).join(String(upgs[0].n));
  }
  let pos = 0;
  effects.forEach((eff, i) => {
    const upg = upgs[i];
    if (!upg || upg.n === undefined) return;
    const from = String(eff.n);
    const idx = desc.indexOf(from, pos);
    if (idx < 0) return;
    const to = String(upg.n);
    if (to !== from) desc = desc.slice(0, idx) + to + desc.slice(idx + from.length);
    pos = idx + to.length;
  });
  return desc;
}

function cardHTML(inst) {
  const def = cardDef(inst.id);
  const name = def.name || inst.id;
  const disp = inst.upg ? name + '+' : name;
  const cost = typeof def.cost === 'number' ? def.cost : 0;
  const tn = typeName(def.type);
  const persist = hasPersistent(def);
  const desc = cardDesc(def, inst);
  const long = desc.length > 10;
  return `
    <div class="card ${def.type || ''}${long ? ' desc-long' : ''} rarity-${def.rarity || 'common'}">
      <div class="card-cost">${cost}</div>
      <div class="card-art"><span class="art-runeball"></span></div>
      <div class="card-body">
        <div class="card-name">${disp}${persist ? '<span class="card-persist">持续</span>' : ''}</div>
        ${tn ? `<div class="card-type">${tn}</div>` : ''}
        <div class="card-desc">${desc}</div>
      </div>
    </div>`;
}

function dedupDeck(deck) {
  const map = new Map();
  (deck || []).forEach(inst => {
    const e = map.get(inst.id) || { id: inst.id, count: 0, upg: false };
    e.count++;
    if (inst.upg) e.upg = true;
    map.set(inst.id, e);
  });
  return Array.from(map.values());
}

/* 去重后的牌组 chips；upgMode=true 时用于休息升级，否则用于商店删卡。
 * 以卡牌 id 字符串传参（game.js 的 rest-upgrade / shop-remove-card 均支持
 * id 字符串，避免去重索引与牌组实际索引不一致）。 */
function upgradeDiffText(def) {
  if (!def || !def.upgEffects) return '';
  const base = (def.effects || []).map(e => `${e.t}${e.n || ''}`).join(', ');
  const upg = def.upgEffects.map(e => `${e.t}${e.n || ''}`).join(', ');
  if (base === upg) return '升级后数值增强';
  return '';
}
function deckChipsHTML(playerIdx, deck, upgMode) {
  const dedup = dedupDeck(deck);
  if (!dedup.length) return '<div class="deck-empty">无卡牌</div>';
  return dedup.map(d => {
    const def = cardDef(d.id);
    const name = def.name || d.id;
    const action = upgMode
      ? `act('rest-upgrade',${playerIdx},'${d.id}')`
      : `act('shop-remove-card',${playerIdx},'${d.id}')`;
    let tip = `<div class="tip-title">${name}</div><div class="tip-body">${def.desc || ''}</div>`;
    if (upgMode && def.upgEffects) {
      const baseVals = (def.effects || []).filter(e => typeof e.n === 'number').map(e => e.n);
      const upgVals = def.upgEffects.filter(e => typeof e.n === 'number').map(e => e.n);
      if (baseVals.length && upgVals.length) {
        tip += `<div class="tip-upg">升级效果：${baseVals.join('/')} → ${upgVals.join('/')}</div>`;
      } else {
        tip += '<div class="tip-upg">可升级强化</div>';
      }
    }
    return `<div class="deck-chip ${upgMode ? 'upg' : ''}" onclick="${action}"${tipAttrs(tip)}>${name}${d.upg ? '+' : ''} ×${d.count}</div>`;
  }).join('');
}

/* ---------- 意图 ---------- */

function intentText(it, opts) {
  if (!it) return '';
  const sc = opts && opts.scale ? opts.scale : 1;
  const str = opts && opts.strength ? opts.strength : 0;
  const dmg = (it.t === 'attack' || it.t === 'multi' || it.t === 'allAttack')
    ? Math.round(it.n * sc) + str : 0;
  switch (it.t) {
    case 'attack': return `攻击 ${dmg}`;
    case 'multi': return `多重 ${dmg}×${it.times}`;
    case 'allAttack': return `全体攻击 ${dmg}`;
    case 'block': return `护盾 ${it.n}`;
    case 'heal': return `治疗 ${it.n}`;
    case 'debuff': return `${statusName(it.status)} ${it.n}`;
    case 'allDebuff': return `全体${statusName(it.status)} ${it.n}`;
    case 'buff': return `强化${statusName(it.buff)}+${it.n}`;
    case 'summon': {
      const def = ENEMIES[it.enemy];
      return `召唤${def ? def.name : '随从'}`;
    }
    default: return '准备中';
  }
}
function intentClass(it) {
  if (!it) return 'it-unknown';
  switch (it.t) {
    case 'attack':
    case 'multi': return 'it-attack';
    case 'allAttack': return 'it-all';
    case 'block': return 'it-block';
    case 'heal': return 'it-heal';
    case 'debuff':
    case 'allDebuff': return 'it-poison';
    case 'buff': return 'it-buff';
    case 'summon': return 'it-summon';
    default: return 'it-unknown';
  }
}
function intentHTML(it, opts) {
  if (!it) return '';
  return `<span class="intent ${intentClass(it)}">${intentText(it, opts)}</span>`;
}

/* ---------- 敌人技能展示 ---------- */

function enemyCycleText(def, opts) {
  if (!def) return '';
  if (def.phaseIntents) {
    return def.phaseIntents.map((phase, i) =>
      `阶段${i+1}: ${phase.map(it => intentText(it, opts)).join(' → ')}`
    ).join('  |  ');
  }
  if (def.intents) {
    return def.intents.map(it => intentText(it, opts)).join(' → ');
  }
  return '';
}

function enemyCycleTooltip(def, opts) {
  if (!def) return '';
  if (def.phaseIntents) {
    const lines = ['<div class="tip-title">技能循环（多阶段）</div>'];
    def.phaseIntents.forEach((phase, pi) => {
      const hpRange = pi === 0 ? 'HP&gt;66%' : pi === 1 ? 'HP 33%-66%' : 'HP&lt;33%';
      lines.push(`<div class="tip-phase">阶段${pi + 1}（${hpRange}）</div>`);
      phase.forEach((it, idx) => {
        lines.push(`<div class="tip-step">第${idx + 1}回合：${intentText(it, opts)}</div>`);
      });
    });
    lines.push('<div class="tip-foot">HP降至区间门槛时自动切换阶段</div>');
    return lines.join('');
  }
  if (def.intents) {
    const lines = ['<div class="tip-title">技能循环（每回合依次执行）</div>'];
    def.intents.forEach((it, idx) => {
      lines.push(`<div class="tip-step">第${idx + 1}回合：${intentText(it, opts)}</div>`);
    });
    lines.push('<div class="tip-foot">循环结束后回到第1回合</div>');
    return lines.join('');
  }
  return '';
}

/* ---------- 战斗待选目标 ---------- */

function pendingCardDef() {
  const s = getState();
  const pending = s && s.combat && s.combat.pendingCard;
  if (!pending) return null;
  const pl = (s.party || [])[pending.playerIdx];
  const inst = pl && pl.hand && pl.hand[pending.handIdx];
  return inst ? cardDef(inst.id) : null;
}
function pendingTargetsEnemy() {
  const def = pendingCardDef();
  return def ? ['enemy', 'allEnemies', 'randomEnemy'].includes(def.target) : false;
}
function pendingTargetsAlly() {
  const def = pendingCardDef();
  return def ? def.target === 'ally' : false;
}

/* ---------- 主渲染入口 ---------- */

function render() {
  cardTipHide();
  tipHide();
  const app = document.getElementById('app');
  if (!app) return;
  const s = getState();
  let html;
  if (!s || !s.phase || s.phase === 'menu') {
    html = renderMenu();
  } else if (s.phase === 'map') {
    html = renderMap();
  } else if (s.phase === 'combat') {
    html = renderCombat();
  } else if (s.phase === 'reward') {
    html = renderReward();
  } else if (s.phase === 'shop') {
    html = renderShop();
  } else if (s.phase === 'event') {
    html = renderMap() + renderEventModal();
  } else if (s.phase === 'rest') {
    html = renderRest();
  } else if (s.phase === 'defeat') {
    html = renderDefeat();
  } else if (s.phase === 'victory') {
    html = renderVictory();
  } else {
    html = renderMenu();
  }
  app.innerHTML = html;
  if (s && (s.phase === 'map' || s.phase === 'event')) drawMapEdges();
  ensureHandEdgeFade();
  ensureEnemyActLoop();
  ensureKillSettle();
  ensureTideSettle();
  ensureMultiHitLoop();
}

/* 手牌/角色标签横向滚动：两端渐隐指示器显隐（render 重建后重新绑定） */
function ensureHandEdgeFade() {
  document.querySelectorAll('.edge-fade').forEach(el => {
    const sc = el.querySelector('.hand, .player-tabs');
    if (!sc) return;
    const update = () => {
      el.classList.toggle('at-start', sc.scrollLeft > 4);
      el.classList.toggle('at-end', sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 4);
    };
    sc.addEventListener('scroll', update, { passive: true });
    update();
  });
}

/* 击杀演出：最后一个敌人被消灭后播放死亡动画，1s 后再进入奖励结算 */
let _killTimer = null;
function ensureKillSettle() {
  const s = getState();
  if (!s || s.phase !== 'combat' || !s.combat || !s.combat.pendingWin) return;
  if (_killTimer) return;
  _killTimer = setTimeout(() => {
    _killTimer = null;
    const st = getState();
    if (st && st.phase === 'combat' && st.combat && st.combat.pendingWin) window.stepKillSettle();
  }, motionReduced() ? 300 : 1000);
}

/* 潮汐爆发：攻击卡结算后延迟一步，待水花动画驱动结算 */
const TIDE_DELAY_MS = 650;
let _tideTimer = null;
function ensureTideSettle() {
  const s = getState();
  if (!s || s.phase !== 'combat' || !s.combat || !s.combat.pendingTide) return;
  if (_tideTimer) return;
  _tideTimer = setTimeout(() => {
    _tideTimer = null;
    const st = getState();
    if (st && st.phase === 'combat' && st.combat && st.combat.pendingTide) window.resolveTide();
  }, TIDE_DELAY_MS);
}

/* 多段伤害：后续段逐个间隔结算，制造多段飘字节奏 */
const MULTI_STEP_MS = 420;
let _multiTimer = null;
function ensureMultiHitLoop() {
  const s = getState();
  if (!s || s.phase !== 'combat' || !s.combat || !s.combat.multiQueue || !s.combat.multiQueue.length) return;
  if (_multiTimer) return;
  _multiTimer = setTimeout(() => {
    _multiTimer = null;
    const st = getState();
    if (st && st.phase === 'combat' && st.combat && st.combat.multiQueue.length) window.stepMultiHit();
  }, MULTI_STEP_MS);
}

/* 敌方阶段：每次渲染后若仍在 enemy 阶段，按节奏驱动下一步（逐个攻击，间隔片刻）
 * actQueue 非空：两个怪物之间的间隔；actQueue 为空：最后一个怪物行动完到回合结算（切回玩家） */
const ENEMY_STEP_MS = 950;
const ENEMY_FINISH_MS = 1500;
function ensureEnemyActLoop() {
  const s = getState();
  if (!s || s.phase !== 'combat' || s.subPhase !== 'enemy') return;
  if (_enemyTimer) return;
  _enemyTimer = setTimeout(() => {
    _enemyTimer = null;
    const st = getState();
    if (!st || st.phase !== 'combat' || st.subPhase !== 'enemy') return;
    window.stepEnemyAct(); // 队列非空走下一个敌人；队列空则内部进入回合结算
  }, (s.combat.actQueue || []).length > 0 ? ENEMY_STEP_MS : ENEMY_FINISH_MS);
}

/* ---------- 菜单 ---------- */

function renderMenu() {
  const s = getState();
  const sel = window._menuSelection || [];
  const canContinue = !!(s && (s.saveExists || s.hasSave || s.savedRun));
  let h = '<div class="screen menu-screen">';
  h += '<h1 class="game-title">深渊回响<span class="en-title">Abyss Echo</span></h1>';
  h += '<p class="game-subtitle">深海合作肉鸽卡牌</p>';
  h += '<div class="class-grid">';
  Object.keys(CLASSES).forEach(id => {
    const c = CLASSES[id];
    const checked = sel.includes(id);
    h += `
      <div class="class-card${checked ? ' sel' : ''}" style="--cc:${c.color}">
        ${c.img ? `<img class="class-img" src="${c.img}" alt="${c.name}" loading="lazy">` : ''}
        <label class="class-check">
          <input type="checkbox"${checked ? ' checked' : ''} onchange="toggleMenuClass('${id}', this.checked)">
          <span class="class-name">${c.name}</span>
        </label>
        <div class="class-title">${c.title}</div>
        <div class="class-hp">生命 ${c.hp}</div>
        <div class="class-desc">${c.desc}</div>
        <div class="class-mech"><span class="mech-name">${c.mechanic}</span>　${c.mechanicDesc}</div>
      </div>`;
  });
  h += '</div>';
  h += `<button class="btn start-btn"${sel.length > 0 ? ` onclick="act('new-game')"` : ' disabled'}>开始远征${sel.length ? `（${sel.length}人）` : ''}</button>`;
  if (canContinue) {
    h += `<button class="btn continue-btn" onclick="act('continue-run')">继续上次远征</button>`;
  }
  h += `<button class="btn guide-btn" onclick="showRulesGuide()">📖 规则导读</button>`;
  h += '</div>';
  return h;
}

function toggleMenuClass(id, checked) {
  const arr = window._menuSelection;
  const i = arr.indexOf(id);
  if (checked && i === -1) arr.push(id);
  if (!checked && i !== -1) arr.splice(i, 1);
  render();
}

/* ---------- 地图 ---------- */

/* 系统"减少动态"偏好：演出/等待计时大幅缩短 */
function motionReduced() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let _transTimer = null;
function renderMap() {
  const s = getState();
  const run = s.run || {};
  /* 开场叙事：新局第一次进入地图时展示，点"开始下潜"进入地图 */
  if (run.intro) {
    let h = '<div class="screen intro-screen">';
    h += '<div class="intro-scroll">';
    h += '<p class="intro-title">深渊回响</p>';
    h += '<p class="intro-sub">Abyss Echo</p>';
    h += '<div class="intro-story">';
    h += '<p>烛火结社的灯火，在岸边最后一次闪烁。</p>';
    h += '<p>你们踏入了被海水淹没的先民遗迹——</p>';
    h += '<p>远古的城邦沉在黑暗之中，财富与力量被封存于深渊核心。</p>';
    h += '<p>而核心，正被沉睡的【深渊意志】所侵蚀。</p>';
    h += '<p>夺回它，净化腐化。</p>';
    h += '<p>或者……永远留在黑暗里。</p>';
    h += '</div>';
    h += `<button class="btn intro-start-btn" onclick="act('dismiss-intro')">开始下潜</button>`;
    h += '</div>';
    h += '</div>';
    return h;
  }
  if (s.transition) {
    const story = FLOOR_STORY[s.transition.floor] || '深渊在更深处等待……';
    const lines = story.split('\n');
    let h = '<div class="screen transition-screen">';
    h += '<div class="transition-scroll">';
    lines.forEach((line, li) => {
      const last = li === lines.length - 1;
      h += last ? `<p class="trans-floor">${line}</p>` : `<p>${line}</p>`;
    });
    h += '</div>';
    h += '<div class="transition-flash"></div>';
    h += '<div class="transition-hint">下潜中……</div>';
    h += '</div>';
    if (!_transTimer) {
      _transTimer = setTimeout(() => {
        _transTimer = null;
        if (s.transition) { s.transition = null; render(); }
      }, motionReduced() ? 200 : 4600);
    }
    return h;
  }
  const map = s.map || {};
  const nodes = map.nodes || [];
  const rows = {};
  nodes.forEach(n => {
    const rk = n.row || 0;
    (rows[rk] = rows[rk] || []).push(n);
  });
  const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
  let h = '<div class="screen map-screen">';
  h += '<div class="map-header">';
  h += `<h2>第${run.floor || 1}层 深渊回响</h2>`;
  h += `<span class="gold-display">金币 ${run.gold || 0}</span>`;
  h += '<div class="relic-list">' + (run.relicIds || []).map(rid => {
      const rdef = relicDef(rid);
      const rTip = `<div class="tip-title">${rdef.name}</div><div class="tip-body">${rdef.desc || ''}</div>`;
      return `<span class="relic-chip"${tipAttrs(rTip)}>${rdef.name}</span>`;
    }).join('') + '</div>';
  h += `<button class="btn map-quit-btn" onclick="act('quit-menu')">返回菜单</button>`;
  h += '</div>';
  h += '<div class="map-party">';
  (s.party || []).forEach(p => {
    h += `<div class="map-player"><span class="prow-name" style="color:${clsCard(p.classId).color}">${p.name}</span>${hpBar(p.hp, p.maxHp)}</div>`;
  });
  h += '</div>';
  h += '<div class="map-grid">';
  rowKeys.forEach(rk => {
    h += '<div class="map-row">';
    rows[rk].sort((a, b) => (a.col || 0) - (b.col || 0)).forEach(n => {
      const clickable = n.state === 'available';
      h += `<div class="node ${n.state || 'locked'} ${n.type || ''}" data-nid="${n.id}"${clickable ? ` onclick="act('select-node',${n.id})"` : ''}>`;
      h += `<span class="node-label">${nodeLabel(n)}</span>`;
      h += '</div>';
    });
    h += '</div>';
  });
  h += '<svg class="map-lines" id="map-lines"></svg>';
  h += '</div>';
  h += '<div class="map-legend">';
  h += '<span class="lg lg-open"><i></i>可前往</span>';
  h += '<span class="lg lg-done"><i></i>已走过</span>';
  h += '<span class="lg lg-lock"><i></i>未解锁</span>';
  h += '</div>';
  if (s.quitConfirm) {
    h += '<div class="shop-confirm-overlay"><div class="shop-confirm-modal">'
      + '<h3 class="screen-title">返回菜单</h3>'
      + '<p class="shop-confirm-desc">返回主菜单将结束本次远征，<br>卡组、遗物与金币进度会被清除且无法恢复。<br>确定要返回吗？</p>'
      + '<div class="shop-confirm-btns">'
      + `<button class="btn" onclick="act('return-menu')">确认返回</button>`
      + `<button class="btn" onclick="act('quit-cancel')">继续远征</button>`
      + '</div></div></div>';
  }
  h += '</div>';
  return h;
}

/* 根据节点实际位置绘制连接线（三档状态：可走/走过/未解锁），带方向箭头与步数标注 */
function drawMapEdges() {
  const grid = document.querySelector('.map-grid');
  const svg = document.getElementById('map-lines');
  if (!grid || !svg) return;
  const s = getState();
  const map = s.map;
  if (!map || !map.edges || !map.edges.length) { svg.innerHTML = ''; return; }
  const gridRect = grid.getBoundingClientRect();
  const pos = {};
  grid.querySelectorAll('.node').forEach(el => {
    const id = Number(el.dataset.nid);
    const r = el.getBoundingClientRect();
    pos[id] = { x: r.left - gridRect.left + r.width / 2, y: r.top - gridRect.top + r.height / 2, radius: r.width / 2 };
  });
  svg.setAttribute('viewBox', `0 0 ${gridRect.width} ${gridRect.height}`);
  svg.style.width = gridRect.width + 'px';
  svg.style.height = gridRect.height + 'px';

  const nodeById = {};
  map.nodes.forEach(n => { nodeById[n.id] = n; });
  const edgeKey = (f, t) => f + '->' + t;

  /* 已走路径的步数：从顶层已走节点沿 done 边 BFS */
  const steps = {};
  const doneEdges = new Set();
  map.edges.forEach(([f, t]) => {
    const fn = nodeById[f], tn = nodeById[t];
    if (fn && tn && (fn.state === 'visited' || fn.state === 'cleared') && (tn.state === 'visited' || tn.state === 'cleared')) {
      doneEdges.add(edgeKey(f, t));
    }
  });
  const queue = map.nodes
    .filter(n => n.row === 0 && (n.state === 'visited' || n.state === 'cleared'))
    .map(n => ({ id: n.id, step: 1 }));
  const seen = new Set(queue.map(q => q.id));
  while (queue.length) {
    const cur = queue.shift();
    map.edges.forEach(([f, t]) => {
      if (f !== cur.id || !doneEdges.has(edgeKey(f, t))) return;
      steps[edgeKey(f, t)] = cur.step;
      if (!seen.has(t)) { seen.add(t); queue.push({ id: t, step: cur.step + 1 }); }
    });
  }

  const parts = [
    '<defs>'
    + '<marker id="arr-open" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="rgba(77,166,255,0.9)"/></marker>'
    + '<marker id="arr-done" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="rgba(255,209,102,0.9)"/></marker>'
    + '<marker id="arr-lock" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="rgba(77,166,255,0.28)"/></marker>'
    + '</defs>'
  ];

  map.edges.forEach(([f, t]) => {
    const a = pos[f];
    const b = pos[t];
    if (!a || !b) return;
    const child = nodeById[t];
    const parent = nodeById[f];
    const isDone = doneEdges.has(edgeKey(f, t));
    const isOpen = child.state === 'available' && parent && (parent.state === 'visited' || parent.state === 'cleared');
    const cls = isDone ? 'edge-done' : isOpen ? 'edge-open' : 'edge-locked';
    /* 线段终点收缩到节点边缘，让箭头露出 */
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const bx = len > 1 ? b.x - (dx / len) * (b.radius - 8) : b.x;
    const by = len > 1 ? b.y - (dy / len) * (b.radius - 8) : b.y;
    const ax = len > 1 ? a.x + (dx / len) * Math.min(10, a.radius - 8) : a.x;
    const ay = len > 1 ? a.y + (dy / len) * Math.min(10, a.radius - 8) : a.y;
    const marker = cls === 'edge-open' ? 'url(#arr-open)' : cls === 'edge-done' ? 'url(#arr-done)' : 'url(#arr-lock)';
    parts.push(`<line class="${cls}" x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" marker-end="${marker}"/>`);
    const st = steps[edgeKey(f, t)];
    if (cls === 'edge-done' && st !== undefined) {
      const mx = (a.x + bx) / 2, my = (a.y + by) / 2;
      parts.push(`<text class="edge-step" x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${st}</text>`);
    }
  });
  svg.innerHTML = parts.join('');
}

/* ---------- 战斗 ---------- */

function renderCombat() {
  const s = getState();
  const combat = s.combat || {};
  const run = s.run || {};
  const party = s.party || [];
  const enemies = combat.enemyGroup || [];
  const pending = combat.pendingCard || null;
  const playable = s.subPhase === 'play' && !combat.pendingWin;
  const subText = combat.pendingWin ? '敌人已被消灭…'
    : s.subPhase === 'resolve' ? '结算中…'
    : s.subPhase === 'enemy' ? '敌方行动中…'
    : s.subPhase === 'roundEnd' ? '回合结束' : '';

  /* 新战斗：重置血条动画基线，避免跨战斗沿用旧百分比 */
  const battleKey = enemies.length && enemies[0] ? enemies[0].id : null;
  if (battleKey !== null && _hpBattleKey !== battleKey) {
    _hpBattleKey = battleKey;
    _hpPrev = {};
  }

  /* 本回合发动过攻击的敌人（攻击动画） */
  const acted = combat.enemyActed || [];

  /* 卡牌打出动画（瞬态，render 消费后清空） */
  const playFx = combat.playFx || null;

  /* 伤害飘字：从 state.combat.hits 中按单位取本次渲染要展示的数值（每种只取第一条） */
  const hits = combat.hits || [];
  /* 容器级震动：按本帧最大伤害分级 */
  const maxHpDmg = hits.reduce((m, hh) => (hh.hpDmg ? Math.max(m, hh.hpDmg) : m), 0);
  const fieldShakeCls = maxHpDmg > 0 ? (maxHpDmg >= 10 ? ' shake-big' : ' shake') : '';
  function hitAttrs(unit) {
    const out = {};
    for (let hi = 0; hi < hits.length; hi++) {
      const hh = hits[hi];
      if (hh.unit !== unit) continue;
      if (out.hpDmg === undefined && hh.hpDmg) out.hpDmg = hh.hpDmg;
      if (out.block === undefined && hh.blockAbsorbed) out.block = hh.blockAbsorbed;
      if (out.heal === undefined && hh.heal) out.heal = hh.heal;
    }
    return out;
  }
  function hitClass(hh) {
    return (hh.hpDmg !== undefined || hh.block !== undefined || hh.heal !== undefined) ? ' just-hit' : '';
  }
  function hitAttrsHtml(hh) {
    let out = '';
    if (hh.hpDmg !== undefined) out += ` data-hp-dmg="-${hh.hpDmg}"`;
    if (hh.block !== undefined) out += ` data-block="${hh.block}"`;
    if (hh.heal !== undefined) out += ` data-heal="${hh.heal}"`;
    return out;
  }

  let h = '<div class="screen combat-screen">';
  h += '<div class="combat-header">';
  h += `<span>第${combat.turn || 1}回合</span>`;
  h += `<span>第${run.floor || 1}层</span>`;
  h += '</div>';

  /* 战斗日志（可折叠） */
  const log = (combat.log || []).slice(-5);
  h += '<div class="combat-log">';
  h += '<div class="combat-log-body collapsed">';
  if (log.length === 0) {
    h += '<div class="log-line">战斗开始…</div>';
  } else {
    log.forEach((line, li) => {
      h += `<div class="log-line${li < log.length - 1 ? ' log-old' : ''}">${line}</div>`;
    });
  }
  h += '</div>';
  if (log.length > 1) {
    h += `<span class="log-toggle-btn" onclick="toggleCombatLog()">展开▾</span>`;
  }
  h += '</div>';

  /* 对峙区：敌人 vs 我方 */
  h += `<div class="combat-field${fieldShakeCls}">`;

  /* 敌人区 */
  h += '<div class="enemy-zone">';
  enemies.forEach((e, i) => {
    const def = ENEMIES[e.defId] || {};
    const alive = Number(e.hp) > 0;
    const targetable = playable && pending && pendingTargetsEnemy() && alive;
    const eTip = `<div class="tip-title">${e.name}${e.isBoss ? '（首领）' : e.elite ? '（精英）' : ''}</div><div class="tip-body">${def.desc || ''}</div>`;
    const eHit = hitAttrs('e' + e.id);
    h += `<div class="enemy-card${e.isBoss ? ' boss' : ''}${e.elite ? ' elite' : ''}${alive ? '' : ' dead'}${combat.killedId === e.id ? ' just-killed' : ''}${acted.indexOf('e' + e.id) >= 0 ? ' attacking' : ''}${combat.tideSplash === e.id ? ' tide-splash' : ''}${combat.hitPulse === e.id ? ' pulse-hit' : ''}${targetable ? ' targetable' : ''}${hitClass(eHit)}" data-eid="${e.id}"${hitAttrsHtml(eHit)}${targetable ? ` onclick="act('play-card',${pending.playerIdx},${pending.handIdx},${i})"` : ''}${tipAttrs(eTip)}>`;
    if (def.img) h += `<img class="enemy-img" src="${def.img}" alt="${def.name || ''}" loading="lazy">`;
    if (combat.tideSplash === e.id) h += '<span class="tide-ring" aria-hidden="true"></span>';
    h += `<div class="enemy-name">${def.name || e.name || e.defId}</div>`;
    const floorScale = FLOOR_SCALE[run.floor - 1] || 1;
    const cycText = enemyCycleText(def, { scale: floorScale });
    const cycTip = enemyCycleTooltip(def, { scale: floorScale });
    if (cycText) h += `<div class="enemy-cycle"${tipAttrs(cycTip)}>${cycText}</div>`;
    h += hpBarAnim(e.hp, e.maxHp, 'e' + e.id);
    h += `<div class="enemy-hp-num">${alive ? e.hp : 0}/${e.maxHp}</div>`;
    h += `<div class="enemy-debuffs">${buffChips(e.buffs, 'debuff')}</div>`;
    h += blockBadge(e.block) + buffChips(e.buffs, 'buff');
    h += intentHTML(e.intent, { scale: floorScale, strength: e.buffs.strength || 0 });
    h += '</div>';
  });
  h += '</div>';

  /* 玩家区 */
  h += '<div class="party-zone">';
  party.forEach((p, i) => {
    const alive = !p.dead && Number(p.hp) > 0;
    const targetable = playable && pending && pendingTargetsAlly() && alive;
    const pHit = hitAttrs('p' + i);
    h += `<div class="party-card${alive ? '' : ' dead'}${combat.playerActed === i ? ' attacking' : ''}${targetable ? ' targetable' : ''}${hitClass(pHit)}"${hitAttrsHtml(pHit)}${targetable ? ` onclick="act('play-card',${pending.playerIdx},${pending.handIdx},${i})"` : ''}>`;
    const cls = clsCard(p.classId);
    if (cls && cls.img) h += `<img class="party-img" src="${cls.img}" alt="${cls.name || ''}" loading="lazy">`;
    h += `<div class="party-name">${p.name}</div>`;
    if (cls && cls.mechanic) {
      const mTip = `<div class="tip-title">${cls.mechanic}</div><div class="tip-body">${cls.mechanicDesc || ''}</div>`;
      h += `<span class="party-mechanic"${tipAttrs(mTip)}>${cls.mechanic}${mechProgressHtml(p, i)}</span>`;
    }
    h += hpBarAnim(p.hp, p.maxHp, 'p' + i);
    h += `<div class="party-hp-num">${alive ? `${p.hp}/${p.maxHp}` : '已阵亡'}</div>`;
    h += blockBadge(p.block) + buffChips(p.buffs);
    h += '</div>';
  });
  h += '</div>';
  h += '</div>';

  /* 控制区：手牌区 + 结束回合 */
  h += '<div class="control-zone">';
  if (subText) h += `<div class="subphase-hint">${subText}</div>`;
  if (pending) {
    const def = pendingCardDef();
    const tgt = def ? def.target : '';
    const tgtText = tgt === 'ally' ? '点击下方队友' : '点击上方敌人';
    h += `<div class="target-hint">选择目标：${def ? def.name : '卡牌'}（${tgtText}，再次点击卡牌取消）</div>`;
  }

  /* 手牌区：移动端角色标签切换 / 桌面端全展开 */
  /* 移动端自动切到有 pending 牌的角色 */
  const isNarrow = window.innerWidth <= 720;
  if (isNarrow && pending) {
    const pp = party[pending.playerIdx];
    if (pp && !pp.dead && Number(pp.hp) > 0) _combatHandFocus = pending.playerIdx;
  }
  if (isNarrow) {
    const fp = party[_combatHandFocus];
    if (!fp || fp.dead || Number(fp.hp) <= 0) {
      _combatHandFocus = party.findIndex(p => !p.dead && Number(p.hp) > 0);
      if (_combatHandFocus < 0) _combatHandFocus = 0;
    }
  }

  h += '<div class="hand-bottom">';

  if (isNarrow) {
    /* --- 移动端：角色标签栏 + 单人手牌 --- */
    h += '<div class="edge-fade"><div class="player-tabs">';
    party.forEach((p, pi) => {
      const alive = !p.dead && Number(p.hp) > 0;
      const cls = clsCard(p.classId);
      const hpPct = Math.max(0, Math.min(100, (Number(p.hp) / Number(p.maxHp)) * 100));
      h += `<div class="player-tab${_combatHandFocus === pi ? ' active' : ''}${alive ? '' : ' dead'}" onclick="setHandFocus(${pi})">`;
      h += `<div class="pt-name" style="color:${alive ? cls.color : '#555'}">${p.name}</div>`;
      h += `<div class="pt-mini-hp"><div class="pt-hp-fill" style="width:${hpPct}%"></div></div>`;
      h += '<div class="pt-stats">';
      h += `<span class="pt-energy${combat.energyFx === pi ? ' energy-cost' : ''}">${p.energy || 0}/3</span>`;
      h += `<span class="pt-count">${(p.hand || []).length}张</span>`;
      h += '</div></div>';
    });
    h += '</div>';

    const ap = party[_combatHandFocus];
    if (ap && !ap.dead && Number(ap.hp) > 0) {
      h += '<div class="hand-row">';
      h += `<div class="hand-row-head"><span class="prow-piles">抽${(ap.drawPile || []).length} · 弃${(ap.discardPile || []).length}</span></div>`;
      h += '<div class="edge-fade"><div class="hand">';
      (ap.hand || []).forEach((inst, hi) => {
        const def = cardDef(inst.id);
        const cantAfford = Number(def.cost) > (ap.energy || 0);
        const clickable = playable && !pending && !cantAfford;
        const isPendingCard = pending && pending.playerIdx === _combatHandFocus && pending.handIdx === hi;
        const cancelClick = pending && isPendingCard ? `act('cancel-pending')` : '';
        const cardClick = clickable && !pending ? `act('play-card',${_combatHandFocus},${hi},-1)` : cancelClick;
        const cardHover = (clickable && !pending) ? ` onmouseenter="cardTipShow(event,this,${_combatHandFocus},${hi})" onmouseleave="cardTipHide()"` : '';
        const cardTouch = (clickable && !pending) ? ` ontouchstart="cardTipTouchStart(event,${_combatHandFocus},${hi})" ontouchend="cardTipTouchEnd(event)" ontouchmove="cardTipTouchMove(event)"` : '';
        h += `<div class="hand-card-wrap${clickable ? '' : ' locked'}${cantAfford ? ' cant-afford' : ''}${isPendingCard ? ' pending-card' : ''}"${cardClick ? ` onclick="${cardClick}"` : ''}${cardHover}${cardTouch}>`;
        h += cardHTML(inst);
        h += '</div>';
      });
      h += '</div></div>';
      h += '</div>';
    }
  } else {
    /* --- 桌面端：所有角色手牌全展开 --- */
    party.forEach((p, pi) => {
      if (p.dead || Number(p.hp) <= 0) return;
      h += '<div class="hand-row">';
      h += `<div class="hand-row-head">`;
      h += `<span class="prow-name" style="color:${clsCard(p.classId).color}">${p.name}</span>`;
      h += `<span class="prow-energy${combat.energyFx === pi ? ' energy-cost' : ''}">${p.energy || 0}/3</span>`;
      h += `<span class="prow-piles">抽${(p.drawPile || []).length} · 弃${(p.discardPile || []).length}</span>`;
      h += '</div>';
      h += '<div class="hand">';
      (p.hand || []).forEach((inst, hi) => {
        const def = cardDef(inst.id);
        const cantAfford = Number(def.cost) > (p.energy || 0);
        const clickable = playable && !pending && !cantAfford;
        const isPendingCard = pending && pending.playerIdx === pi && pending.handIdx === hi;
        const cancelClick = pending && isPendingCard ? `act('cancel-pending')` : '';
        const cardClick = clickable && !pending ? `act('play-card',${pi},${hi},-1)` : cancelClick;
        const cardHover = (clickable && !pending) ? ` onmouseenter="cardTipShow(event,this,${pi},${hi})" onmouseleave="cardTipHide()"` : '';
        const cardTouch = (clickable && !pending) ? ` ontouchstart="cardTipTouchStart(event,${pi},${hi})" ontouchend="cardTipTouchEnd(event)" ontouchmove="cardTipTouchMove(event)"` : '';
        h += `<div class="hand-card-wrap${clickable ? '' : ' locked'}${cantAfford ? ' cant-afford' : ''}${isPendingCard ? ' pending-card' : ''}"${cardClick ? ` onclick="${cardClick}"` : ''}${cardHover}${cardTouch}>`;
        h += cardHTML(inst);
        h += '</div>';
      });
      h += '</div></div>';
      h += '</div>';
    });
  }
  h += '</div>';

  h += `<button class="btn end-turn-btn"${playable && !pending ? ` onclick="act('end-turn')"` : ' disabled'}>结束回合</button>`;
  h += '</div>';
  h += '</div>';

  /* 伤害飘字与攻击动画为瞬态数据：渲染消费后清空，防止下次渲染重放 */
  if (combat.hits) combat.hits = [];
  if (combat.enemyActed) combat.enemyActed = [];
  if (combat.killedId) combat.killedId = null;
  if (combat.playFx) combat.playFx = null;
  if (combat.playerActed !== undefined) combat.playerActed = null;
  if (combat.energyFx !== undefined) combat.energyFx = null;
  if (combat.hitPulse) combat.hitPulse = null;

  /* 卡牌打出动画：飞出牌影 + 闪亮（瞬态，本地副作用） */
  if (playFx) {
    const pfd = cardDef(playFx.cardId);
    h += '<div class="play-fx"><div class="play-fx-card ' + (playFx.type || '') + '">';
    h += `<span class="play-fx-cost">${pfd ? pfd.cost : ''}</span>`;
    h += `<span class="play-fx-name">${pfd ? pfd.name : ''}${playFx.upg ? '+' : ''}</span>`;
    h += '</div></div>';
  }

  /* Boss 登场动画：开场播 3.4s，期间 re-render 不截断（以 combat 对象为锚，每场战斗只播一次） */
  const bossIntro = combat.turn === 1 && combat.bossName && !combat.over && !combat.pendingWin;
  if (bossIntro && _bossIntroFight !== combat) {
    _bossIntroFight = combat;
    _bossIntroUntil = Date.now() + 3400;
  }
  if (bossIntro && Date.now() < _bossIntroUntil) {
    const bossDef = enemies.map(e => ENEMIES[e.defId]).find(d => d && d.boss) || null;
    h += '<div class="boss-intro-overlay"><div class="boss-intro-name">' + combat.bossName + '</div>';
    if (bossDef && bossDef.title) h += `<div class="boss-intro-title">${bossDef.title}</div>`;
    if (bossDef && bossDef.lore) h += `<div class="boss-intro-quote">${bossDef.lore}</div>`;
    h += '<div class="boss-intro-sub">深渊的注视降临了</div></div>';
    if (!_bossIntroTimer) {
      _bossIntroTimer = setTimeout(() => {
        _bossIntroTimer = null;
        if (getState().phase === 'combat') render();
      }, Math.max(50, _bossIntroUntil - Date.now()));
    }
  }
  return h;
}

/* ---------- 奖励 ---------- */

function renderReward() {
  const s = getState();
  /* Boss 死亡动画：finalKill 存在时只渲染死亡演出，2s 后清除标记并重渲染出奖励页 */
  if (s && s.combat && s.combat.finalKill) {
    if (!_bossDeathPlaying) {
      _bossDeathPlaying = true;
      setTimeout(() => {
        _bossDeathPlaying = false;
        const st = getState();
        if (st && st.combat && st.combat.finalKill) st.combat.finalKill = null;
        render();
      }, 2000);
    }
    return '<div class="screen reward-screen boss-death-screen">'
      + '<div class="boss-death-overlay">'
      + '<div class="boss-death-ring"></div>'
      + `<div class="boss-death-title">${s.combat.finalKill} 已被封印</div>`
      + '<div class="boss-death-sub">深渊归于沉寂……</div>'
      + '</div></div>';
  }
  const reward = s.reward || {};
  const run = s.run || {};
  let h = '<div class="screen reward-screen">';
  h += '<h2 class="screen-title">战斗胜利</h2>';
  if (reward.gold) h += `<p class="reward-gold">获得金币 ${reward.gold}</p>`;
  if (reward.relics && reward.relics.length) {
    h += '<div class="reward-relics"><h3>获得遗物</h3>';
    reward.relics.forEach(rid => {
      const def = relicDef(rid);
      h += `<div class="relic-row"><span class="relic-name">${def.name}</span><span class="relic-desc">${def.desc || ''}</span></div>`;
    });
    h += '</div>';
  }
  const pendingIdx = typeof reward.pendingCardIdx === 'number' ? reward.pendingCardIdx : -1;
  if (pendingIdx >= 0) {
    const cid = reward.cards && reward.cards[pendingIdx];
    const def = cid ? cardDef(cid) : null;
    h += '<h3 class="give-title">选择获得卡牌的角色</h3>';
    if (def) h += `<p class="reward-gold">已选择：${def.name}</p>`;
    h += '<p class="reward-give-hint">卡牌将加入所选角色的牌组</p>';
    if (reward.picksLeft > 1) h += `<p class="reward-give-hint">还有 ${reward.picksLeft} 位玩家需要选择</p>`;
    h += '<div class="give-row">';
    (s.party || []).forEach((p, i) => {
      if (!p.dead && Number(p.hp) > 0) h += `<button class="btn" onclick="act('reward-give',${i})">${p.name}</button>`;
    });
    h += '</div>';
  } else if (reward.cards && reward.cards.length) {
    const hint = reward.picksLeft > 1 ? `每位玩家各选一张（剩余 ${reward.picksLeft} 次选择）` : '选择一张卡牌加入牌组';
    h += `<p class="reward-hint">${hint}</p>`;
    h += '<div class="reward-cards">';
    reward.cards.forEach((cid, idx) => {
      h += `<div class="reward-card" onclick="act('pick-reward-card',${idx})">${cardHTML({ id: cid })}</div>`;
    });
    h += '</div>';
  }
  h += `<button class="btn" onclick="act('skip-reward')">离开</button>`;
  h += '</div>';
  return h;
}

/* ---------- 商店 ---------- */

function shopPrice(item) {
  if (typeof item.price === 'number') return item.price;
  if (item.kind === 'remove') return SHOP_PRICES.remove;
  if (item.kind === 'heal') return SHOP_PRICES.heal;
  if (item.kind === 'relic') return SHOP_PRICES.relic;
  return null;
}
function shopItemLabel(item) {
  if (item.kind === 'card') return cardDef(item.cardId).name;
  if (item.kind === 'relic') return relicDef(item.relicId).name;
  if (item.kind === 'remove') return '删卡服务';
  if (item.kind === 'heal') return '补给治疗';
  return '未知物品';
}
function shopItemSub(item) {
  if (item.kind === 'card') {
    const d = cardDef(item.cardId);
    return `${typeName(d.type)} · ${d.desc || ''}`;
  }
  if (item.kind === 'relic') {
    const d = relicDef(item.relicId);
    return d.desc || '';
  }
  if (item.kind === 'remove') return '从牌组中删除一张卡（仅一次）';
  if (item.kind === 'heal') return '全队恢复20%生命';
  return '';
}

function renderShop() {
  const s = getState();
  const shop = s.shop || {};
  const run = s.run || {};
  let h = '<div class="screen shop-screen">';
  h += '<div class="shop-header">';
  h += '<h2 class="screen-title">深渊商店</h2>';
  h += `<span class="gold-display">金币 ${run.gold || 0}</span>`;
  h += '</div>';

  if (shop.removeMode) {
    h += `<h3 class="shop-rm-title">选择要删除的卡牌（${SHOP_PRICES.remove || 75}金）</h3>`;
    (s.party || []).forEach((p, i) => {
      if (p.dead) return;
      const chips = deckChipsHTML(i, p.deck || [], false);
      if (!chips) return;
      h += `<div class="deck-row"><span class="prow-name" style="color:${clsCard(p.classId).color}">${p.name}</span>`;
      h += `<div class="deck-cards">${chips}</div></div>`;
    });
    h += `<button class="btn" onclick="act('leave-map-node')">离开</button>`;
    h += '</div>';
    return h;
  }

  const pendingIdx = typeof shop.pendingBuyIdx === 'number' ? shop.pendingBuyIdx : -1;
  const confirmIdx = typeof shop.confirmIdx === 'number' ? shop.confirmIdx : -1;
  h += '<div class="shop-items">';
  (shop.items || []).forEach((item, idx) => {
    const price = shopPrice(item);
    const sold = !!item.sold;
    const isConfirming = confirmIdx === idx;
    h += `<div class="shop-item${sold ? ' sold' : ''}${isConfirming ? ' confirming' : ''}"${!sold && pendingIdx < 0 && confirmIdx < 0 ? ` onclick="act('buy-shop-item',${idx})"` : ''}>`;
    h += `<span class="shop-item-name">${shopItemLabel(item)}</span>`;
    h += `<span class="shop-item-sub">${shopItemSub(item)}</span>`;
    h += `<span class="shop-item-price">${price !== null ? price + '金' : ''}</span>`;
    h += '</div>';
  });
  h += '</div>';

  if (confirmIdx >= 0) {
    const item = shop.items && shop.items[confirmIdx];
    h += '<div class="shop-confirm-overlay"><div class="shop-confirm-modal">';
    if (item) {
      const price = shopPrice(item);
      h += `<h3 class="screen-title">${shopItemLabel(item)}</h3>`;
      h += `<p class="shop-confirm-desc">${shopItemSub(item)}</p>`;
      h += `<p class="shop-confirm-price">价格：${price}金币</p>`;
    }
    h += '<div class="shop-confirm-btns">';
    h += `<button class="btn" onclick="act('buy-confirm')">确认购买</button>`;
    h += `<button class="btn" onclick="act('buy-cancel')">取消</button>`;
    h += '</div></div></div>';
  }

  if (pendingIdx >= 0) {
    const item = shop.items && shop.items[pendingIdx];
    h += '<h3 class="give-title">选择获得物品的角色</h3>';
    if (item) h += `<p class="reward-gold">已选择：${shopItemLabel(item)}</p><p class="shop-item-sub">${shopItemSub(item)}</p>`;
    h += '<div class="give-row">';
    (s.party || []).forEach((p, i) => {
      if (!p.dead && Number(p.hp) > 0) h += `<button class="btn" onclick="act('buy-give',${i})">${p.name}</button>`;
    });
    h += '</div>';
  }
  h += `<button class="btn" onclick="act('leave-map-node')">离开</button>`;
  h += '</div>';
  return h;
}

/* ---------- 事件弹窗（覆盖在地图上） ---------- */

function renderEventModal() {
  const s = getState();
  const ev = s.event || {};
  const def = EVENTS[ev.defId] || { name: '深渊事件', desc: '', options: [] };
  const chosen = typeof ev.chosen === 'number' ? ev.chosen : -1;
  let h = '<div class="event-overlay" onclick="if(event.target===this&&';
  h += chosen >= 0 ? 'true' : 'false';
  h += ')act(\'leave-map-node\')">';
  h += '<div class="event-modal">';
  h += `<h2 class="screen-title">${def.name || ev.defId}</h2>`;
  h += `<p class="event-desc">${def.desc || ''}</p>`;
  if (chosen >= 0) {
    const opt = def.options && def.options[chosen];
    h += `<p class="event-chosen">已选择：${opt ? opt.label : ''}</p>`;
    if (ev.result) h += `<p class="event-result">${ev.result}</p>`;
    h += `<button class="btn" onclick="act('leave-map-node')">离开</button>`;
  } else {
    h += '<div class="event-options">';
    const gold = (s.run || {}).gold || 0;
    (def.options || []).forEach((o, i) => {
      const poor = o.eff && o.eff.t === 'goldPay' && gold < (o.eff.n || 0);
      const cls = poor ? 'event-option poor' : 'event-option';
      h += `<div class="${cls}"${poor ? '' : ` onclick="act('pick-event-option',${i})"`}>`;
      h += `<span class="eo-label">${o.label || ''}</span>`;
      h += `<span class="eo-desc">${o.desc || ''}</span>`;
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';
  h += '</div>';
  return h;
}

/* ---------- 休息 ---------- */

function renderRest() {
  const s = getState();
  const rest = s.rest || {};
  const healOk = restHealUsable();
  const upgOk = restUpgradeUsable();
  let h = '<div class="screen rest-screen">';
  h += '<h2 class="screen-title">深渊营火</h2>';

  if (rest.upgradeMode) {
    h += '<h3 class="rest-rm-title">选择要升级的卡牌（同名卡全部升级）</h3>';
    (s.party || []).forEach((p, i) => {
      if (p.dead) return;
      const chips = deckChipsHTML(i, p.deck || [], true);
      if (!chips) return;
      h += `<div class="deck-row"><span class="prow-name" style="color:${clsCard(p.classId).color}">${p.name}</span>`;
      h += `<div class="deck-cards">${chips}</div></div>`;
    });
    h += '<div class="rest-btns">';
    h += `<button class="btn" onclick="act('rest-upgrade')">取消升级</button>`;
    h += `<button class="btn" onclick="act('leave-map-node')">离开</button>`;
    h += '</div>';

    const cc = rest.confirmCard;
    if (cc && cc.targetId) {
      const p = s.party[cc.playerIdx];
      const def = cardDef(cc.targetId);
      const cname = def ? def.name : cc.targetId;
      const baseDesc = def ? def.desc : '';
      const upgDesc = def ? cardDesc(def, { upg: true }) : '';
      h += '<div class="shop-confirm-overlay"><div class="shop-confirm-modal">';
      h += `<h3 class="screen-title">锻造：${cname}+</h3>`;
      if (p) h += `<p class="shop-confirm-desc">${p.name} 的同名卡牌将全部升级</p>`;
      h += '<div class="rest-upg-compare">';
      h += `<p class="rest-upg-base"><span class="rest-upg-tag">基础</span>${baseDesc}</p>`;
      h += `<p class="rest-upg-after"><span class="rest-upg-tag">升级后</span>${upgDesc}</p>`;
      h += '</div>';
      h += '<div class="shop-confirm-btns">';
      h += `<button class="btn" onclick="act('rest-upgrade-confirm')">确认锻造</button>`;
      h += `<button class="btn" onclick="act('rest-upgrade-cancel')">取消</button>`;
      h += '</div></div></div>';
    }
    h += '</div>';
    return h;
  }

  h += '<div class="rest-btns">';
  h += `<button class="btn rest-heal-btn"${healOk ? ` onclick="act('rest-heal')"` : ' disabled'}>休息恢复（30%生命）</button>`;
  h += `<button class="btn rest-upg-btn"${upgOk ? ` onclick="act('rest-upgrade')"` : ' disabled'}>锻造升级</button>`;
  h += '</div>';
  if (rest.lastUpgrade) h += '<p class="rest-result">已锻造：' + rest.lastUpgrade + '</p>';
  if (!healOk && !upgOk) h += '<p class="rest-hint">本休息点可选次数已用完</p>';
  h += '<div class="rest-leave">';
  h += `<button class="btn" onclick="act('leave-map-node')">离开</button>`;
  h += '</div>';
  h += '</div>';
  return h;
}

/* ---------- 结算 ---------- */

function renderDefeat() {
  const s = getState();
  const run = s.run || {};
  const party = s.party || [];
  const alive = party.filter(p => !p.dead && Number(p.hp) > 0);
  let h = '<div class="screen end-screen defeat">';
  h += '<h2 class="end-title">远征失败</h2>';
  h += '<p class="end-subtitle">深渊吞噬了你的队伍……</p>';
  if (alive.length) {
    h += '<div class="end-section-title">幸存者</div>';
    h += '<div class="end-party">';
    alive.forEach(p => {
      const cls = clsCard(p.classId);
      h += `<span class="surv-chip" style="--sc:${cls.color}">${p.name}</span>`;
    });
    h += '</div>';
    h += '<p class="end-surv-note">他们带着同伴的遗物，回到了海面。</p>';
  } else {
    h += '<p class="end-surv-none">无人归来。黑暗吞没了每一个名字。</p>';
  }
  h += '<div class="end-stats">';
  h += `<p>到达层数：${run.floor || 1}</p>`;
  h += `<p>击杀敌人：${run.kills || 0}</p>`;
  h += `<p>剩余金币：${run.gold || 0}</p>`;
  h += '</div>';
  h += `<button class="btn" onclick="act('return-menu')">返回主菜单</button>`;
  h += '</div>';
  return h;
}

function renderVictory() {
  const s = getState();
  const run = s.run || {};
  const party = s.party || [];
  const unlock = s.unlock || {};
  let h = '<div class="screen end-screen victory">';
  h += '<div class="end-card">';
  h += '<div class="end-wave"></div>';
  h += '<h2 class="end-title">深渊被封印！</h2>';
  h += '<p class="end-subtitle">深渊意志已归于永恒的寂静</p>';

  /* 团队表彰 */
  h += '<div class="end-section-title">团队表彰</div>';
  h += '<div class="end-party">';
  party.forEach(p => {
    const cls = clsCard(p.classId);
    const dead = !!p.dead || Number(p.hp) <= 0;
    h += `<div class="end-hero${dead ? ' dead' : ''}" style="--hc:${cls.color}">`;
    h += `<span class="end-hero-name">${p.name}</span>`;
    h += `<span class="end-hero-hp">${dead ? '阵亡' : `${p.hp}/${p.maxHp}`}</span>`;
    if (cls.mechanic) h += `<span class="end-hero-mech"${tipAttrs(`<div class="tip-title">${cls.mechanic}</div><div class="tip-body">${cls.mechanicDesc || ''}</div>`)}>${cls.mechanic}</span>`;
    h += '</div>';
  });
  h += '</div>';

  /* 远征数据 */
  h += '<div class="end-section-title">远征数据</div>';
  h += '<div class="end-stats">';
  h += `<p>深入层数<b>${run.floor || 1}</b></p>`;
  h += `<p>击杀敌人<b>${run.kills || 0}</b></p>`;
  h += `<p>剩余金币<b>${run.gold || 0}</b></p>`;
  h += '</div>';

  /* 获得遗物 */
  const relics = run.relicIds || [];
  if (relics.length) {
    h += '<div class="end-relics">';
    relics.forEach(rid => {
      const def = relicDef(rid);
      h += `<div class="end-relic"><span class="end-relic-name">${def.name}</span><span class="end-relic-desc">${def.desc || ''}</span></div>`;
    });
    h += '</div>';
  } else {
    h += '<p class="end-relic-none">本次远征未获得遗物</p>';
  }

  /* 解锁提示 */
  if (unlock.hardMode) h += '<div class="end-unlock">已解锁：深渊难度模式（敌人强化）</div>';
  h += `<p class="end-wins">深渊封印 × ${unlock.wins || 1} 次</p>`;

  h += '<div class="end-epilogue">';
  h += '<p>烛火结社的灯塔，在黑暗中重新亮起。</p>';
  h += '<p>你们带回的不仅是核心——还有深渊的秘密。</p>';
  h += '<p>海面之下，潮汐仍在呼吸。</p>';
  h += '</div>';

  h += '<div class="end-bubbles"></div>';
  h += `<button class="btn" onclick="act('return-menu')">返回主菜单</button>`;
  h += '</div>';
  h += '</div>';
  return h;
}

/* ---------- Toast ---------- */

let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---------- 规则导读 ---------- */

function showRulesGuide() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `
<div class="rules-overlay" onclick="if(event.target===this)hideRulesGuide()">
  <div class="rules-panel">
    <div class="rules-header">
      <h2>📖 规则导读</h2>
      <span class="rules-close" onclick="hideRulesGuide()">✕</span>
    </div>
    <div class="rules-scroll">
      <h3>🎯 游戏目标</h3>
      <p>选 1~4 名队员组成探险队，潜入深渊三层，击败最终 Boss <b>深渊意志</b>。全队阵亡则失败，可立即重开。</p>

      <h3>👥 职业选择</h3>
      <table class="rules-table">
        <tr><th>职业</th><th>HP</th><th>特色机制</th></tr>
        <tr><td style="color:#4da6ff">守望者</td><td>80</td><td><b>守护</b>：替队友承受伤害</td></tr>
        <tr><td style="color:#9b6bff">潮汐学者</td><td>55</td><td><b>潮汐</b>：每3张攻击牌触发AOE</td></tr>
        <tr><td style="color:#39d98a">深渊猎手</td><td>65</td><td><b>连击</b>：每张牌让下张攻击+1</td></tr>
        <tr><td style="color:#ffd166">圣汐医者</td><td>60</td><td><b>净化</b>：移除debuff获得能量</td></tr>
      </table>

      <h3>⚔️ 战斗规则</h3>
      <ul>
        <li><b>回合制</b>：全队共享回合，任意顺序出牌</li>
        <li><b>能量</b>：每人每回合 3 点，打牌消耗能量</li>
        <li><b>抽牌</b>：每人每回合抽 5 张，手牌上限 10</li>
        <li><b>护甲</b>：吸收伤害，<span style="color:#ff5c5c">回合结束清除</span></li>
        <li><b>意图</b>：敌人头顶显示本回合行动（红色=攻击，蓝色=护盾等）</li>
      </ul>

      <h3>🃏 卡牌类型</h3>
      <table class="rules-table">
        <tr><th>类型</th><th>边框</th><th>说明</th></tr>
        <tr><td>攻击</td><td style="color:#ff5c5c">红色</td><td>对敌人造成伤害</td></tr>
        <tr><td>技能</td><td style="color:#4da6ff">蓝色</td><td>护甲/治疗/增益/抽牌等</td></tr>
        <tr><td>能力(Power)</td><td style="color:#9b6bff">紫色</td><td>打出后整场生效</td></tr>
      </table>

      <h3>✨ 状态效果</h3>
      <table class="rules-table">
        <tr><th>状态</th><th>效果</th></tr>
        <tr><td style="color:#7cc4ff">力量</td><td>攻击伤害 +X</td></tr>
        <tr><td style="color:#7cc4ff">敏捷</td><td>获得护甲 +X</td></tr>
        <tr><td style="color:#7cc4ff">再生</td><td>回合开始回 X 血</td></tr>
        <tr><td style="color:#7cc4ff">潮汐预兆</td><td>每回合多抽 X 张</td></tr>
        <tr><td style="color:#7cc4ff">深渊之眼</td><td>每回合 +X 能量</td></tr>
        <tr><td style="color:#ff8f8f">中毒</td><td>回合开始扣 X 血，每回合 -1</td></tr>
        <tr><td style="color:#ff8f8f">易伤</td><td>受到伤害 +50%</td></tr>
        <tr><td style="color:#ff8f8f">虚弱</td><td>造成的伤害 -25%</td></tr>
        <tr><td style="color:#ff8f8f">恐惧</td><td>X% 概率跳过行动</td></tr>
        <tr><td style="color:#ff8f8f">诅咒</td><td>打出攻击牌时扣 X 血</td></tr>
      </table>

      <h3>💎 遗物</h3>
      <table class="rules-table">
        <tr><th>遗物</th><th>效果</th></tr>
        <tr><td>深渊护符</td><td>战斗开始全队 +5 护甲</td></tr>
        <tr><td>潮汐罗盘</td><td>每回合多抽 1 张</td></tr>
        <tr><td>珊瑚之心</td><td>战斗开始全队治疗 5</td></tr>
        <tr><td>深渊之眼</td><td>每回合 +1 能量</td></tr>
        <tr><td>墨鱼囊</td><td>回合结束全队 +3 护甲</td></tr>
        <tr><td>珍珠项链</td><td>获得金币 +20%</td></tr>
        <tr><td>深潜者之鳞</td><td>受到伤害 -1</td></tr>
        <tr><td>潮汐圣杯</td><td>治疗量 +3</td></tr>
        <tr><td>深渊信标</td><td>精英奖励多 1 张卡牌选择</td></tr>
        <tr><td>远古石板</td><td>休息点可同时选两个选项</td></tr>
      </table>

      <h3>🗺️ 地图节点</h3>
      <table class="rules-table">
        <tr><th>节点</th><th>说明</th></tr>
        <tr><td style="color:#ff5c5c">⚔️ 战斗</td><td>普通敌人，得金币+三选一卡牌</td></tr>
        <tr><td style="color:#9b6bff">🧊 精英</td><td>强力敌人，额外得遗物</td></tr>
        <tr><td style="color:#4da6ff">📖 事件</td><td>随机事件，多种选项</td></tr>
        <tr><td style="color:#ffd166">🛒 商店</td><td>买卡牌/遗物/治疗/删卡</td></tr>
        <tr><td style="color:#39d98a">🛌 休息</td><td>回30%血 或 升级1张卡牌</td></tr>
        <tr><td style="color:#ffd166">👑 Boss</td><td>每层最终挑战</td></tr>
      </table>

      <h3>💡 小贴士</h3>
      <ul>
        <li>护甲回合结束清零，不要省着不用</li>
        <li>全队共享回合，任意顺序出牌</li>
        <li>手牌上限 10 张，超出会丢弃</li>
        <li>Boss 前必有休息点，尽量利用</li>
        <li>商店删卡能显著提升牌组质量</li>
      </ul>
    </div>
  </div>
</div>`;
}

function hideRulesGuide() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

/* ---------- 统一悬浮详情浮窗（替换 title 属性） ----------
 * tipAttrs(html) 为元素生成悬停/触摸事件；内容按 key 缓存，
 * 桌面跟随鼠标移动，手机长按显示。 */

let _tipSeq = 0;
const _tipCache = {};

function tipAttrs(html) {
  if (!html) return '';
  const key = 't' + (++_tipSeq);
  _tipCache[key] = html;
  return ` onmouseenter="tipShow(event,this,'${key}')" onmouseleave="tipHide()" onmousemove="tipMove(event)" ontouchstart="tipTouchStart(event,this,'${key}')" ontouchend="tipTouchEnd(event)" ontouchmove="tipTouchMove(event)"`;
}

function tipRoot() {
  let root = document.getElementById('tip-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'tip-root';
    root.className = 'tip-root';
    document.body.appendChild(root);
  }
  return root;
}

function tipShow(e, el, key) {
  const root = tipRoot();
  root.innerHTML = _tipCache[key] || '';
  root.style.display = 'block';
  tipMove(e);
}

function tipMove(e) {
  const root = document.getElementById('tip-root');
  if (!root || root.style.display !== 'block') return;
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  let x = e.clientX + 16;
  let y = e.clientY + 14;
  if (x + w > window.innerWidth - 6) x = e.clientX - w - 12;
  if (y + h > window.innerHeight - 6) y = e.clientY - h - 12;
  root.style.left = Math.max(4, x) + 'px';
  root.style.top = Math.max(4, y) + 'px';
}

function tipHide() {
  const root = document.getElementById('tip-root');
  if (root) root.style.display = 'none';
}

/* 手机长按显示 */
let _tipTimer = null;
let _tipLong = false;

function tipTouchStart(e, el, key) {
  if (_tipTimer) clearTimeout(_tipTimer);
  _tipLong = false;
  el.classList.add('pressing');
  _tipTimer = setTimeout(() => {
    _tipLong = true;
    const t = e.touches[0];
    tipShow({ clientX: t.clientX, clientY: t.clientY }, el, key);
  }, 380);
}

function tipTouchEnd(e) {
  if (_tipTimer) { clearTimeout(_tipTimer); _tipTimer = null; }
  if (e.currentTarget) e.currentTarget.classList.remove('pressing');
  if (_tipLong) {
    _tipLong = false;
    tipHide();
    e.preventDefault();
  }
}

function tipTouchMove(e) {
  if (_tipTimer) {
    const t = e.touches[0];
    const r = e.currentTarget.getBoundingClientRect();
    if (Math.abs(t.clientX - r.left) > 24 || Math.abs(t.clientY - r.top) > 24) {
      clearTimeout(_tipTimer);
      _tipTimer = null;
      e.currentTarget.classList.remove('pressing');
      if (_tipLong) { _tipLong = false; tipHide(); }
    }
  } else if (_tipLong) {
    const root = document.getElementById('tip-root');
    if (root && root.style.display === 'block') tipMove(e.touches[0]);
  }
}

/* ---------- 卡片悬浮/长按提示（tooltip） ---------- */

function cardTipShow(e, el, playerIdx, handIdx) {
  const s = getState();
  if (!s) return;
  const p = s.party[playerIdx];
  if (!p) return;
  const inst = p.hand[handIdx];
  if (!inst) return;
  const def = cardDef(inst.id);
  if (!def) return;
  let root = document.getElementById('card-tooltip');
  if (!root) {
    root = document.createElement('div');
    root.id = 'card-tooltip';
    root.className = 'card-tooltip';
    document.body.appendChild(root);
  }
  root.innerHTML = cardHTML(inst);
  const rect = el.getBoundingClientRect();
  let top = rect.top - 12;
  let left = rect.left + rect.width / 2 - 65;
  if (top < 4) top = 4;
  if (left < 4) left = 4;
  if (left + 130 > window.innerWidth) left = window.innerWidth - 134;
  root.style.left = left + 'px';
  root.style.top = top + 'px';
  root.style.display = 'block';
}

function cardTipHide() {
  const root = document.getElementById('card-tooltip');
  if (root) root.style.display = 'none';
}

/* 手机端长按：短触=打出，长按=预览 */
let _cardTipTimer = null;
let _cardTipLong = false;

function cardTipTouchStart(e, playerIdx, handIdx) {
  if (_cardTipTimer) clearTimeout(_cardTipTimer);
  _cardTipLong = false;
  e.currentTarget.classList.add('pressing');
  _cardTipTimer = setTimeout(() => {
    _cardTipLong = true;
    cardTipShow(e, e.currentTarget, playerIdx, handIdx);
  }, 400);
}

function cardTipTouchEnd(e) {
  if (_cardTipTimer) { clearTimeout(_cardTipTimer); _cardTipTimer = null; }
  if (e.currentTarget) e.currentTarget.classList.remove('pressing');
  if (_cardTipLong) {
    _cardTipLong = false;
    cardTipHide();
    e.preventDefault();
  }
}

function cardTipTouchMove(e) {
  if (_cardTipTimer) {
    const t = e.touches[0];
    if (Math.abs(t.clientX - e.currentTarget.getBoundingClientRect().left) > 20 ||
        Math.abs(t.clientY - e.currentTarget.getBoundingClientRect().top) > 20) {
      clearTimeout(_cardTipTimer);
      _cardTipTimer = null;
      e.currentTarget.classList.remove('pressing');
      if (_cardTipLong) { _cardTipLong = false; cardTipHide(); }
    }
  }
}

/* ---------- 战斗日志折叠 ---------- */

let _logExpanded = false;
function toggleCombatLog() {
  _logExpanded = !_logExpanded;
  const el = document.querySelector('.combat-log-body');
  if (el) el.classList.toggle('collapsed', !_logExpanded);
  const btn = document.querySelector('.log-toggle-btn');
  if (btn) btn.textContent = _logExpanded ? '收起△' : '展开▾';
}
