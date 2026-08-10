/**
 * cinematic.js - Boss 登场全屏演出
 * 仅对"倒数第二个 Boss"与"最后一个 Boss"播放，根据 Boss 花色切换主题。
 *
 * 主题：
 *   ♠ s  暗月降临
 *   ♥ h  烈焰燃烧
 *   ♣ c  剧毒侵蚀
 *   ♦ d  万剑归宗
 *
 * 通过 playSuitCinematic(suit) 调用；外部也可调用 skipSuitCinematic() 提前结束。
 */

let _cinematicEl = null;
let _cinematicTimer = null;
let _cinematicPlaying = false;

const CINEMATIC_DURATION = 3000;

/**
 * 播放 Boss 登场演出
 * @param {string} suit 花色 's' | 'h' | 'c' | 'd'
 */
function playSuitCinematic(suit) {
  // 上一次演出若仍在进行，立刻清理（不等待淡出），避免 DOM 重叠
  if (_cinematicPlaying) {
    _cinematicPlaying = false;
    if (_cinematicTimer) { clearTimeout(_cinematicTimer); _cinematicTimer = null; }
    if (_cinematicEl && _cinematicEl.parentNode) {
      _cinematicEl.parentNode.removeChild(_cinematicEl);
    }
    _cinematicEl = null;
  }
  _cinematicPlaying = true;

  const el = document.createElement('div');
  el.className = 'suit-cinematic suit-cinematic--' + suit;

  switch (suit) {
    case 's':
      _buildSuitSpades(el);
      break;
    case 'h':
      _buildSuitHearts(el);
      break;
    case 'd':
      _buildSuitDiamonds(el);
      break;
    case 'c':
      _buildSuitClubs(el);
      break;
    default:
      _buildSuitSpades(el);
  }

  document.body.appendChild(el);
  _cinematicEl = el;

  // 点击 / 按键可提前跳过
  const skipHandler = (e) => {
    if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Escape') return;
    skipSuitCinematic();
    document.removeEventListener('click', skipHandler);
    document.removeEventListener('keydown', skipHandler);
  };
  setTimeout(() => {
    document.addEventListener('click', skipHandler);
    document.addEventListener('keydown', skipHandler);
  }, 400); // 延迟绑定，避免触发演出的那次点击立刻关闭

  _cinematicTimer = setTimeout(skipSuitCinematic, CINEMATIC_DURATION);
}

/** 提前结束演出 */
function skipSuitCinematic() {
  if (!_cinematicPlaying) return;
  if (_cinematicTimer) { clearTimeout(_cinematicTimer); _cinematicTimer = null; }
  if (_cinematicEl && _cinematicEl.parentNode) {
    _cinematicEl.style.transition = 'opacity .25s ease-out';
    _cinematicEl.style.opacity = '0';
    setTimeout(() => {
      if (_cinematicEl && _cinematicEl.parentNode) _cinematicEl.parentNode.removeChild(_cinematicEl);
      _cinematicEl = null;
    }, 260);
  }
  _cinematicPlaying = false;
}

/** 查询当前是否正在演出 */
function isSuitCinematicPlaying() { return _cinematicPlaying; }

/* ============================================================
   ♠ 暗月降临
   ============================================================ */
function _buildSuitSpades(root) {
  // 背景
  const backdrop = document.createElement('div');
  backdrop.className = 'sc-backdrop';
  root.appendChild(backdrop);

  // 星尘：30 个随机小白点
  for (let i = 0; i < 30; i++) {
    const star = document.createElement('div');
    star.className = 'sc-s-star';
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const delay = Math.random() * 2;
    const dur = 1.5 + Math.random() * 1.5;
    const opa = .2 + Math.random() * .6;
    const size = 1 + Math.random() * 2;
    star.style.cssText =
      'left:' + x + '%;top:' + y + '%;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      'animation-delay:' + delay + 's;' +
      '--dur:' + dur + 's;--opa:' + opa + ';';
    root.appendChild(star);
  }

  // 月晕（3 层错开）
  for (let i = 0; i < 3; i++) {
    const halo = document.createElement('div');
    halo.className = 'sc-s-halo';
    root.appendChild(halo);
  }

  // 月亮本体
  const moon = document.createElement('div');
  moon.className = 'sc-s-moon';
  root.appendChild(moon);

  // 标题
  const title = document.createElement('div');
  title.className = 'sc-title';
  title.textContent = '暗月降临';
  root.appendChild(title);
}

/* ============================================================
   ♥ 烈焰燃烧 —— 爆炸风格（酝酿 → 爆炸 → 余烬）
   ============================================================ */
function _buildSuitHearts(root) {
  // 背景
  const backdrop = document.createElement('div');
  backdrop.className = 'sc-backdrop';
  root.appendChild(backdrop);

  // === 酝酿阶段 (T=0~0.5s) ===
  // const buildup = document.createElement('div');
  // buildup.className = 'sc-h-buildup';
  // root.appendChild(buildup);

  // 8 颗向内汇聚的小火星，蓄力感
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('div');
    s.className = 'sc-h-buildup-spark';
    const ang = (i / 8) * 360 + Math.random() * 20;
    const r = 60 + Math.random() * 40;          // 60~100px 半径
    const rad = ang * Math.PI / 180;
    const dx = Math.cos(rad) * r;
    const dy = Math.sin(rad) * r;
    const delay = Math.random() * 0.15;
    s.style.cssText =
      '--dx:' + dx.toFixed(1) + 'px;' +
      '--dy:' + dy.toFixed(1) + 'px;' +
      '--delay:' + delay + 's;';
    root.appendChild(s);
  }

  // === 爆炸阶段 (T=0.5s 起) ===
  const flash = document.createElement('div');
  flash.className = 'sc-h-flash';
  root.appendChild(flash);

  const shock = document.createElement('div');
  shock.className = 'sc-h-shock';
  root.appendChild(shock);

  const ember = document.createElement('div');
  ember.className = 'sc-h-ember';
  root.appendChild(ember);

  // 18 块火块：从中心向外辐射
  for (let i = 0; i < 18; i++) {
    const c = document.createElement('div');
    c.className = 'sc-h-chunk';
    const ang = Math.random() * 360;
    const dist = 220 + Math.random() * 180;
    const start = 10 + Math.random() * 40;
    const size = 45 + Math.random() * 75;
    const delay = Math.random() * 0.25;
    c.style.cssText =
      'width:' + size + 'px;height:' + size + 'px;' +
      'margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px;' +
      '--ang:' + ang + 'deg;' +
      '--start:-' + start + 'px;' +
      '--end:-' + dist + 'px;' +
      '--delay:' + delay + 's;';
    root.appendChild(c);
  }

  // 50 颗火星：小点向四面八方飞出
  for (let i = 0; i < 30; i++) {
    const s = document.createElement('div');
    s.className = 'sc-h-spark';
    const ang = Math.random() * 360;
    const dist = 60 + Math.random() * 40;
    const delay = Math.random() * 0.4;
    s.style.cssText =
      '--ang:' + ang + 'deg;' +
      '--dist:-' + dist + 'vh;' +
      '--delay:' + delay + 's;';
    root.appendChild(s);
  }

  // === 四周余烬阶段 (T≈1.4s 起) ===
  for (let i = 0; i < 30; i++) {
    const e = document.createElement('div');
    e.className = 'sc-h-linger';
    // 偏边缘分布：35% 顶 / 35% 底 / 15% 左 / 15% 右，部分延伸到中部
    const side = Math.floor(Math.random() * 4);
    let x, y;
    switch (side) {
      case 0: x = Math.random() * 100; y = Math.random() * 35; break;           // 上
      case 1: x = Math.random() * 100; y = 65 + Math.random() * 35; break;      // 下
      case 2: x = Math.random() * 35;  y = 20 + Math.random() * 60; break;      // 左
      default: x = 65 + Math.random() * 35; y = 20 + Math.random() * 60; break; // 右
    }
    const size = 25 + Math.random() * 18;  // 14~32px
    const opa = 0.8 + Math.random() * 0.2; // 0.8~1.0
    const delay = 1.0 + Math.random() * 0.4; // 1.0~1.4s 错开
    e.style.cssText =
      'left:' + x + '%;top:' + y + '%;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      'margin-left:' + (-size / 2) + 'px;' +
      'margin-top:' + (-size / 2) + 'px;' +
      '--opa:' + opa.toFixed(2) + ';' +
      '--delay:' + delay + 's;';
    root.appendChild(e);
  }

  // 标题
  const title = document.createElement('div');
  title.className = 'sc-title';
  title.textContent = '烈焰燃烧';
  root.appendChild(title);
}

/* ============================================================
   ♦ 万剑归宗 —— 冷色调剑阵汇聚（蓄力 → 万剑齐发 → 菱形闪光 → 巨剑 + 碎刃）
   ============================================================ */
function _buildSuitDiamonds(root) {
  // 背景
  const backdrop = document.createElement('div');
  backdrop.className = 'sc-backdrop';
  root.appendChild(backdrop);

  // === 环境金属微光 (T=0~0.5s) ===
  for (let i = 0; i < 15; i++) {
    const g = document.createElement('div');
    g.className = 'sc-d-ambient-glint';
    g.style.cssText =
      'left:' + (Math.random() * 100) + '%;' +
      'top:' + (Math.random() * 100) + '%;' +
      '--delay:' + (Math.random() * 0.35) + 's;';
    root.appendChild(g);
  }

  // === 蓄力 (T=0.4~0.8s) ===
  const buildup = document.createElement('div');
  buildup.className = 'sc-d-buildup';
  root.appendChild(buildup);

  // 十字光芒
  const crossH = document.createElement('div');
  crossH.className = 'sc-d-buildup-cross sc-d-buildup-cross--h';
  root.appendChild(crossH);
  const crossV = document.createElement('div');
  crossV.className = 'sc-d-buildup-cross sc-d-buildup-cross--v';
  root.appendChild(crossV);

  // 6 道散乱剑影
  for (let i = 0; i < 6; i++) {
    const g = document.createElement('div');
    g.className = 'sc-d-glint';
    const ang = Math.random() * 360;
    const h = 20 + Math.random() * 30;
    g.style.cssText =
      'left:' + (20 + Math.random() * 60) + '%;' +
      'top:' + (20 + Math.random() * 60) + '%;' +
      'height:' + h + 'px;' +
      '--ang:' + ang + 'deg;' +
      '--delay:' + (0.5 + Math.random() * 0.25) + 's;';
    root.appendChild(g);
  }

  // === 万剑齐发 (T=0.85~1.4s) ===
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('div');
    s.className = 'sc-d-sword';
    const ang = (i / 36) * 360 + (Math.random() - 0.5) * 8;
    const dist = 45 + Math.random() * 25;
    const len = 60 + Math.random() * 60;
    const delay = 0.45 + Math.random() * 0.75;
    const ox = (Math.random() - 0.5) * 30;
    const oy = (Math.random() - 0.5) * 30;
    s.style.cssText =
      'height:' + len + 'px;' +
      'margin-left:' + (-1) + 'px;' +
      '--ang:' + ang.toFixed(1) + 'deg;' +
      '--dist:-' + dist + 'vh;' +
      '--len:' + len + 'px;' +
      '--delay:' + delay + 's;' +
      '--ox:' + ox.toFixed(1) + 'px;' +
      '--oy:' + oy.toFixed(1) + 'px;';
    root.appendChild(s);
  }

  // === 汇聚闪光 + 冲击波 (T=1.4s) ===
  const flash = document.createElement('div');
  flash.className = 'sc-d-flash';
  root.appendChild(flash);

  const shock = document.createElement('div');
  shock.className = 'sc-d-shock';
  root.appendChild(shock);

  // === 余韵 (T=1.8s) ===
  const giantSword = document.createElement('div');
  giantSword.className = 'sc-d-giant-sword';
  root.appendChild(giantSword);

  // 35 枚菱形碎刃飘落
  for (let i = 0; i < 35; i++) {
    const f = document.createElement('div');
    f.className = 'sc-d-fragment';
    const size = 12 + Math.random() * 16;
    const x = 15 + Math.random() * 70;
    const y = 10 + Math.random() * 40;
    const delay = 1.8 + Math.random() * 0.6;
    const fall = 20 + Math.random() * 30;
    const rot = 180 + Math.random() * 540;
    f.style.cssText =
      'left:' + x + '%;top:' + y + '%;' +
      'width:' + size + 'px;height:' + (size * 1.5) + 'px;' +
      '--delay:' + delay + 's;' +
      '--fall:' + fall + 'vh;' +
      '--rot:' + rot + 'deg;';
    root.appendChild(f);
  }
}

/* ============================================================
   ♣ 剧毒侵蚀 —— 毒液凝聚 → 毒滴爆裂 → 毒雾蔓延 → 气泡升腾
   ============================================================ */
function _buildSuitClubs(root) {
  var backdrop = document.createElement('div');
  backdrop.className = 'sc-backdrop';
  root.appendChild(backdrop);

  // === 毒雾底层 (T=0~0.5s) ===
  var mist = document.createElement('div');
  mist.className = 'sc-c-mist';
  root.appendChild(mist);

  // === 早期气泡 (T=0.1~0.8s) ===
  for (var i = 0; i < 12; i++) {
    var b = document.createElement('div');
    b.className = 'sc-c-bubble';
    var size = 18 + Math.random() * 14;
    var delay = 0.1 + Math.random() * 0.6;
    var dur = 1.5 + Math.random() * 1.0;
    b.style.cssText =
      'left:' + (10 + Math.random() * 80) + '%;' +
      'bottom:-' + size + 'px;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      '--delay:' + delay + 's;' +
      '--dur:' + dur + 's;' +
      '--drift:' + ((Math.random() - 0.5) * 40).toFixed(1) + 'px;' +
      '--opa:' + (0.5 + Math.random() * 0.4).toFixed(2) + ';';
    root.appendChild(b);
  }

  // === 毒液脉络 (T=0.3~0.8s) ===
  for (var i = 0; i < 8; i++) {
    var v = document.createElement('div');
    v.className = 'sc-c-vein';
    var ang = (i / 8) * 360 + (Math.random() - 0.5) * 20;
    var delay = 0.3 + Math.random() * 0.35;
    v.style.cssText =
      '--ang:' + ang.toFixed(1) + 'deg;' +
      '--delay:' + delay + 's;' +
      '--len:' + (80 + Math.random() * 60) + 'px;';
    root.appendChild(v);
  }

  // === 核心毒滴 (T=0.5~1.2s) ===
  var drop = document.createElement('div');
  drop.className = 'sc-c-toxic-drop';
  root.appendChild(drop);

  // === 毒滴爆裂 (T=1.2s) ===
  var burst = document.createElement('div');
  burst.className = 'sc-c-toxic-burst';
  root.appendChild(burst);

  // 毒液飞溅 (16滴)
  for (var i = 0; i < 16; i++) {
    var s = document.createElement('div');
    s.className = 'sc-c-splash';
    var ang = (i / 16) * 360 + (Math.random() - 0.5) * 15;
    var dist = 20 + Math.random() * 30;
    var size = 12 + Math.random() * 10;
    s.style.cssText =
      'width:' + size + 'px;height:' + size + 'px;' +
      'margin-left:' + (-size / 2) + 'px;margin-top:' + (-size / 2) + 'px;' +
      '--ang:' + ang.toFixed(1) + 'deg;' +
      '--dist:' + dist + 'vmin;' +
      '--delay:' + (Math.random() * 0.1).toFixed(2) + 's;';
    root.appendChild(s);
  }

  // 毒波扩散 (3层)
  for (var i = 0; i < 7; i++) {
    var w = document.createElement('div');
    w.className = 'sc-c-wave';
    w.style.cssText = '--delay:' + (i * 0.15).toFixed(2) + 's;';
    root.appendChild(w);
  }

  // === 后期气泡 (T=1.5~2.5s) ===
  // for (var i = 0; i < 25; i++) {
  //   var b = document.createElement('div');
  //   b.className = 'sc-c-bubble';
  //   var size = 12 + Math.random() * 12;
  //   var delay = 1.5 + Math.random() * 0.8;
  //   var dur = 1.2 + Math.random() * 0.8;
  //   b.style.cssText =
  //     'left:' + (5 + Math.random() * 90) + '%;' +
  //     'bottom:-' + size + 'px;' +
  //     'width:' + size + 'px;height:' + size + 'px;' +
  //     '--delay:' + delay + 's;' +
  //     '--dur:' + dur + 's;' +
  //     '--drift:' + ((Math.random() - 0.5) * 50).toFixed(1) + 'px;' +
  //     '--opa:' + (0.4 + Math.random() * 0.4).toFixed(2) + ';';
  //   root.appendChild(b);
  // }

  // === 毒云残留 (T=1.3~2.5s) ===
  // for (var i = 0; i < 2; i++) {
  //   var c = document.createElement('div');
  //   c.className = 'sc-c-toxic-cloud';
  //   var size = 240 + Math.random() * 240;
  //   var delay = 1.1 + Math.random() * 0.5;
  //   c.style.cssText =
  //     'left:' + (10 + Math.random() * 80) + '%;' +
  //     'top:' + (15 + Math.random() * 60) + '%;' +
  //     'width:' + size + 'px;height:' + (size * 0.7) + 'px;' +
  //     '--delay:' + delay + 's;' +
  //     '--drift:' + ((Math.random() - 0.5) * 60).toFixed(1) + 'px;';
  //   root.appendChild(c);
  // }

  // 标题
  var title = document.createElement('div');
  title.className = 'sc-title';
  title.textContent = '剧毒侵蚀';
  root.appendChild(title);
}

/* ============================================================
   ♣ 铁壁天城 —— 飞速筑城（存档，暂不使用）
   ============================================================ */
function _buildSuitClubsWall(root) {
  // 背景
  const backdrop = document.createElement('div');
  backdrop.className = 'sc-backdrop';
  root.appendChild(backdrop);

  // === 环境碎石尘土 (T=0~0.8s) ===
  for (let i = 0; i < 15; i++) {
    const d = document.createElement('div');
    d.className = 'sc-c-ambient-dust';
    const size = 2 + Math.random() * 4;
    d.style.cssText =
      'left:' + (Math.random() * 100) + '%;' +
      'top:' + (Math.random() * 50) + '%;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      '--dur:' + (0.8 + Math.random() * 0.6) + 's;' +
      '--delay:' + (Math.random() * 0.3) + 's;' +
      '--fall:' + (20 + Math.random() * 40) + 'px;';
    root.appendChild(d);
  }

  // === 飞速筑城 (T=0.4~1.2s) ===
  const cols = 5;
  const rows = 6;
  const bw = 18;  // block width in vmin
  const bh = 20;  // block height in vmin

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const block = document.createElement('div');
      block.className = 'sc-c-block';

      const cx = (c - (cols - 1) / 2) * bw;
      const cy = (r - (rows - 1) / 2) * bh;

      const distFromCenter = Math.sqrt(cx * cx + cy * cy);
      const delay = 0.4 + (distFromCenter / 45) * 0.55 + Math.random() * 0.06;

      const dir = Math.floor(Math.random() * 3);
      let fly;
      if (dir === 0) fly = '80vh';
      else if (dir === 1) fly = '-80vh';
      else fly = (Math.random() > 0.5 ? '' : '-') + '60vw';

      if (dir === 2) {
        block.style.cssText =
          'left:calc(50% + ' + (cx - bw / 2).toFixed(1) + 'vmin);' +
          'top:calc(50% + ' + (cy - bh / 2).toFixed(1) + 'vmin);' +
          'width:' + bw + 'vmin;height:' + bh + 'vmin;' +
          '--delay:' + delay.toFixed(2) + 's;' +
          '--fly:' + fly + ';' +
          'animation-name: scCBlockH;';
      } else {
        block.style.cssText =
          'left:calc(50% + ' + (cx - bw / 2).toFixed(1) + 'vmin);' +
          'top:calc(50% + ' + (cy - bh / 2).toFixed(1) + 'vmin);' +
          'width:' + bw + 'vmin;height:' + bh + 'vmin;' +
          '--delay:' + delay.toFixed(2) + 's;' +
          '--fly:' + fly + ';';
      }
      root.appendChild(block);
    }
  }

  // === 核心方块 (T=1.15s) ===
  const keystone = document.createElement('div');
  keystone.className = 'sc-c-keystone';
  root.appendChild(keystone);

  // === 矩形冲击波 (T=1.5s) ===
  const shock = document.createElement('div');
  shock.className = 'sc-c-shock';
  root.appendChild(shock);

  // === 符文能量线 (T=1.55s) — 对齐砖块接缝 ===
  const wallLeft = -((cols * bw) / 2);
  const wallTop = -((rows * bh) / 2);
  for (let i = 0; i < rows - 1; i++) {
    const rune = document.createElement('div');
    rune.className = 'sc-c-rune';
    const y = wallTop + (i + 1) * bh;
    rune.style.cssText =
      'left:calc(50% + ' + (wallLeft + 0.5).toFixed(1) + 'vmin);' +
      'top:calc(50% + ' + y.toFixed(1) + 'vmin);' +
      'width:' + (cols * bw - 1).toFixed(1) + 'vmin;' +
      '--delay:' + (1.55 + i * 0.05) + 's;';
    root.appendChild(rune);
  }
  for (let i = 0; i < cols - 1; i++) {
    const rune = document.createElement('div');
    rune.className = 'sc-c-rune-v';
    const x = wallLeft + (i + 1) * bw;
    rune.style.cssText =
      'left:calc(50% + ' + x.toFixed(1) + 'vmin);' +
      'top:calc(50% + ' + (wallTop + 0.5).toFixed(1) + 'vmin);' +
      'height:' + (rows * bh - 1).toFixed(1) + 'vmin;' +
      '--delay:' + (1.6 + i * 0.06) + 's;';
    root.appendChild(rune);
  }

  // === 铁壁光晕 (T=1.55s) ===
  const wallGlow = document.createElement('div');
  wallGlow.className = 'sc-c-wall-glow';
  root.appendChild(wallGlow);

  // === 碎石余韵 (T=1.6~2.4s) ===
  for (let i = 0; i < 20; i++) {
    const r = document.createElement('div');
    r.className = 'sc-c-rubble';
    const size = 3 + Math.random() * 7;
    r.style.cssText =
      'left:' + (25 + Math.random() * 50) + '%;' +
      'top:' + (35 + Math.random() * 30) + '%;' +
      'width:' + size + 'px;height:' + (size * 0.6) + 'px;' +
      '--delay:' + (1.6 + Math.random() * 0.6) + 's;' +
      '--dur:' + (0.7 + Math.random() * 0.5) + 's;' +
      '--fall:' + (15 + Math.random() * 25) + 'vh;' +
      '--rot:' + (90 + Math.random() * 360) + 'deg;';
    root.appendChild(r);
  }
}
