/* 《车票收藏家》矢量美术层（纵向鸟瞰）
   本文件只产出 SVG / HTML 模板串，不碰 DOM、不依赖 game.js：
   几何数据一律由调用方把 TC 的锚点对象（carLane / locoBox / lockerSpot）传进来，
   只有 scenery 需要读整套世界几何，于是把 G 作为参数收。
   配色一律走 CSS 变量：SVG presentation attribute 不支持 var()，图元只打类名，
   由 style.css 的 `.cr-shell { fill: var(--car-body) }` 接管。
   坐标一律是世界单位（1 单位 = 1 SVG 用户单位），尺寸交给 CSS（calc(N * var(--wu))）；
   车厢 SVG 的 viewBox 就设成这节车的盒子，所以里面写的全是世界坐标，近大远小由深度缩放 s 直接乘进数字里。 */
'use strict';
(function (root) {
  const A = {};

  /* ================= 工具 ================= */

  A.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };
  const n1 = function (v) { return Math.round(v * 10) / 10; };

  /* ================= 车票 ================= */
  /* 四重色盲冗余：形状 + 磁条点位数(1/2/3/4) + 票面明度阶梯 + 紫色双层描边，
     第五重是票边的 ×n 数字。色值全部由 .tk-0..3 上的 --tk-ink / --tk-paper 决定。 */
  const GLYPH = [
    'M0 -4.6 L4.2 0 L0 4.6 L-4.2 0 Z',
    'M-4.4 0 a4.4 4.4 0 1 0 8.8 0 a4.4 4.4 0 1 0 -8.8 0 Z',
    'M0 -4.6 L4.5 3.9 L-4.5 3.9 Z',
    'M0 -5 L1.5 -1.6 L5.2 -1.5 L2.4 1.1 L3.3 4.8 L0 2.9 L-3.3 4.8 L-2.4 1.1 L-5.2 -1.5 L-1.5 -1.6 Z',
  ];

  /* 全尺寸票：只在飞行特效里用（同时 ≤8 张），留足细节 */
  A.ticket = function (c, attrs) {
    const k = c | 0;
    const dots = k + 1;
    let d = '';
    for (let i = 0; i < dots; i++) {
      const y = 10 + (i - (dots - 1) / 2) * 4.3;
      d += '<circle class="tk-dot" cx="5.9" cy="' + y.toFixed(2) + '" r="1.1"/>';
    }
    return '<svg class="tk tk-' + k + '" viewBox="0 0 32 20"' + (attrs ? ' ' + attrs : '') + '>' +
      '<rect class="tk-paper" x=".9" y=".9" width="30.2" height="18.2" rx="2.7"/>' +
      (k === 3 ? '<rect class="tk-ring" x="2.5" y="2.5" width="27" height="15" rx="1.9"/>' : '') +
      '<rect class="tk-band" x="2.6" y="2.7" width="6.4" height="14.6" rx="1.5"/>' +
      d +
      '<rect class="tk-perf" x="21.5" y="4" width=".85" height="3.1"/>' +
      '<rect class="tk-perf" x="21.5" y="8.45" width=".85" height="3.1"/>' +
      '<rect class="tk-perf" x="21.5" y="12.9" width=".85" height="3.1"/>' +
      '<g class="tk-glyph" transform="translate(15.4,10)"><path d="' + GLYPH[k] + '"/></g>' +
      '</svg>';
  };

  /* 小票：车厢里 / 柜子里成组陈列用。纸 + 磁条 + 形状三重编码，省掉网点与虚线 */
  A.ticketMini = function (c, attrs, big) {
    const k = c | 0;
    return '<svg class="tk tk-' + k + '" viewBox="0 0 32 20"' + (attrs ? ' ' + attrs : '') + '>' +
      '<rect class="tk-paper" x=".9" y=".9" width="30.2" height="18.2" rx="2.7"/>' +
      (k === 3 ? '<rect class="tk-ring" x="2.5" y="2.5" width="27" height="15" rx="1.9"/>' : '') +
      '<rect class="tk-band" x="2.6" y="2.7" width="6.4" height="14.6" rx="1.5"/>' +
      (big ? '<circle class="tk-dot" cx="6" cy="10" r="1.3"/>' : '') +
      '<g class="tk-glyph" transform="translate(17.6,10)"><path d="' + GLYPH[k] + '"/></g>' +
      '</svg>';
  };

  /* 一排色点（徽章的辅助编码） */
  A.dots = function (t) {
    let s = '';
    for (let c = 0; c < 4; c++) {
      if (t[c] > 0) s += '<i class="dot dot-' + c + '"></i>';
    }
    return s;
  };

  /* 弹药带式徽章：总数 + 色点。off 时整块隐藏。 */
  A.badge = function (t, cls) {
    let n = 0;
    for (let c = 0; c < 4; c++) n += t[c];
    return '<b class="tk-badge ' + (cls || '') + (n ? '' : ' off') + '">' +
      '<i class="bd-n">' + n + '</i><span class="bd-dots">' + A.dots(t) + '</span></b>';
  };

  /* 「看一眼」卡片：点背包 / 柜子时贴在 HUD 上方那只气泡的内容。
     票样用 A.ticket（带打孔与色带的那张），张数写在旁边 —— 与车内筹码、柜内陈列
     同一套「容器里有什么」的语法。同一颜色只出一枚票（「只有一种颜色也不放大」那条
     在卡片里不成立：这里是台外的读表，不是茶几上的筹码，读得清优先）。 */
  A.peekCard = function (p, kind) {
    const t = kind === 'locker' ? p.locker : p.bag;
    let tot = 0;
    for (let c = 0; c < 4; c++) tot += t[c];
    let chips = '';
    for (let c = 0; c < 4; c++) {
      if (!t[c]) continue;
      chips += '<span class="pk-ch">' + A.ticket(c) + '<b>×' + t[c] + '</b></span>';
    }
    return '<div class="pk-head">' +
      '<i class="pk-mark" style="--cloth:' + A.esc(p.colors.top) + '"></i>' +
      '<b class="pk-who">' + A.esc(p.name) + '</b>' +
      '<span class="pk-kind">' + (kind === 'locker' ? '储物柜' : '背包') + '</span>' +
      '<span class="pk-tot">共 ' + tot + ' 张</span>' +
      '</div>' +
      '<div class="pk-chips">' + (chips || '<span class="pk-none">空的</span>') + '</div>';
  };

  /* ================= 车厢（车顶掀掉，露出地板、座椅与车门） ================= */
  /* 车内筹码：摊在车厢的「远半幅」地板上（近半幅留给登车的人站位），几种颜色就几列。
     票的美术是往地板线「上方」长的，所以筹码能站稳而不被车壁环挡；数字写在票下边。
     票的大小只由「车厢宽度 ÷ 颜色数」与纵深决定 —— **只有一种颜色也不放大**：
     放大过的单票会把「这车只有一种票」写在脸上，比数字本身更早泄露情报。
     返回的是整张 <svg>（viewBox = 车厢盒子），render 换票时整块换掉 —— div.innerHTML
     会把里面的 <g> 当 HTML 解析，所以必须让根节点就是 svg。 */
  A.carChips = function (t, L) {
    const head = '<svg class="cr-chips-svg" viewBox="' + n1(L.box.x) + ' ' + n1(L.box.y) + ' ' +
      n1(L.box.w) + ' ' + n1(L.box.h) + '"><g class="cr-chips">';
    const tail = '</g></svg>';
    let kinds = 0;
    for (let c = 0; c < 4; c++) if (t[c] > 0) kinds++;
    if (!kinds) return head + tail;
    const s = L.s;
    const f = L.floor.at(L.d0 + (L.d1 - L.d0) * 0.30);       // 筹码底线落在车厢远 30% 处
    const pitch = f.w * 0.86 / kinds;
    const cw = Math.min(pitch * 0.86, 23 * s);
    const ch = cw * 0.625;
    let out = '', k = 0;
    for (let c = 0; c < 4; c++) {
      if (!t[c]) continue;
      const cx = (f.l + f.r) / 2 + (k - (kinds - 1) / 2) * pitch;
      out += A.ticketMini(c, 'x="' + n1(cx - cw / 2) + '" y="' + n1(f.y - ch - 7.2 * s) +
        '" width="' + n1(cw) + '" height="' + n1(ch) + '"');
      out += '<text class="tk-n" x="' + n1(cx) + '" y="' + n1(f.y - 1.2 * s) +
        '" font-size="' + n1(Math.max(6.4, 7.6 * s)) + '">×' + t[c] + '</text>';
      k++;
    }
    return head + out + tail;
  };

  /* 一节车厢：车影 → 贯通道 → 车壁环 → 地板 → 内饰 → 门槽 / 门槛 → 两扇门叶 */
  A.carShell = function (L) {
    const q = L.quad, iT = q[0][0], oT = q[1][0], oB = q[2][0], iB = q[3][0];
    const y0 = L.y0, y1 = L.y1, s = L.s, F = L.floor.quad;
    const wallX = function (tf) { return iT + (iB - iT) * tf; };     // 内侧壁（外缘）
    const floorX = function (tf) { return F[0][0] + (F[3][0] - F[0][0]) * tf; };
    const yAt = function (tf) { return y0 + (y1 - y0) * tf; };
    const dAt = function (tf) { return L.d0 + (L.d1 - L.d0) * tf; };

    /* 内饰只画「不会和筹码 / 站位打架」的东西：两侧壁脚长凳带、地板拼缝、
       过道立柱。整排座椅画不了 —— 车厢里既要摊下筹码又要站下乘客，
       真摆上家具就成了三样东西抢同一块地板。 */
    let fix = '';
    const p0 = L.floor.at(dAt(0.015)), p1 = L.floor.at(dAt(0.985));
    const kW = 0.062;
    for (let k = 0; k < 2; k++) {
      const xA = k ? p0.r - kW * p0.w : p0.l, xA2 = k ? p0.r : p0.l + kW * p0.w;
      const xB = k ? p1.r - kW * p1.w : p1.l, xB2 = k ? p1.r : p1.l + kW * p1.w;
      fix += '<path class="cr-skirt" d="M' + n1(xA) + ' ' + n1(p0.y) + ' L' + n1(xA2) + ' ' + n1(p0.y) +
        ' L' + n1(xB2) + ' ' + n1(p1.y) + ' L' + n1(xB) + ' ' + n1(p1.y) + ' Z"/>';
    }
    const nSeam = Math.max(2, Math.min(5, Math.round(L.inner.h / 26)));
    for (let j = 1; j <= nSeam; j++) {
      const f = L.floor.at(dAt(j / (nSeam + 1)));
      fix += '<path class="cr-seam" d="M' + n1(f.l) + ' ' + n1(f.y) + ' L' + n1(f.r) + ' ' + n1(f.y) +
        '" stroke-width="' + n1(0.8 * s) + '"/>';
    }
    const nPole = L.inner.h > 74 ? 3 : 2;
    for (let j = 0; j < nPole; j++) {
      const f = L.floor.at(dAt(0.50 + 0.42 * (j + 0.5) / nPole));
      const cx = (f.l + f.r) / 2, r = Math.max(1.15, 1.7 * s);
      fix += '<circle class="cr-pole" cx="' + n1(cx) + '" cy="' + n1(f.y) + '" r="' + n1(r) + '"/>' +
        '<circle class="cr-pole-hi" cx="' + n1(cx - 0.4 * r) + '" cy="' + n1(f.y - 0.4 * r) +
        '" r="' + n1(r * 0.42) + '"/>';
    }

    /* 车门：开在靠站台那侧壁的中间段，两扇门叶各占一半，关门时盖住门槽 */
    const tA = 0.30, tB = 0.70, tM = 0.50;
    const leaf = function (t0, t1, hinge, key) {
      const yA = yAt(t0), yB = yAt(t1);
      const xA0 = wallX(t0) - 0.5, xB0 = wallX(t1) - 0.5;
      const xA1 = floorX(t0) + 0.5, xB1 = floorX(t1) + 0.5;
      return '<g class="cr-door" data-door="' + key + '" data-hy="' + n1(hinge) + '">' +
        '<path class="cr-leaf" d="M' + n1(xA0) + ' ' + n1(yA) + ' L' + n1(xA1) + ' ' + n1(yA) +
        ' L' + n1(xB1) + ' ' + n1(yB) + ' L' + n1(xB0) + ' ' + n1(yB) + ' Z"/>' +
        '<path class="cr-leaf-win" d="M' + n1(xA0 + 2.2) + ' ' + n1(yA + (yB - yA) * 0.22) +
        ' L' + n1(xA0 + 4.6) + ' ' + n1(yA + (yB - yA) * 0.22) +
        ' L' + n1(xB0 + 4.6) + ' ' + n1(yB - (yB - yA) * 0.22) +
        ' L' + n1(xB0 + 2.2) + ' ' + n1(yB - (yB - yA) * 0.22) + ' Z"/>' +
        '</g>';
    };
    const slot = 'M' + n1(wallX(tA) - 0.6) + ' ' + n1(yAt(tA)) + ' L' + n1(floorX(tA) + 0.6) + ' ' + n1(yAt(tA)) +
      ' L' + n1(floorX(tB) + 0.6) + ' ' + n1(yAt(tB)) + ' L' + n1(wallX(tB) - 0.6) + ' ' + n1(yAt(tB)) + ' Z';
    const sill = 'M' + n1(wallX(tA) - 1.6) + ' ' + n1(yAt(tA)) + ' L' + n1(wallX(tA) + 0.2) + ' ' + n1(yAt(tA)) +
      ' L' + n1(wallX(tB) + 0.2) + ' ' + n1(yAt(tB)) + ' L' + n1(wallX(tB) - 1.6) + ' ' + n1(yAt(tB)) + ' Z';

    /* 贯通道（车厢之间的软篷）开在近端：只有往车头方向还有车时才画 */
    const gang = L.i > 0
      ? '<path class="cr-gang" d="M' + n1(iB + 3) + ' ' + n1(y1 - 2.4) + ' L' + n1(oB - 5) + ' ' + n1(y1 - 2.4) +
        ' L' + n1(oB - 5) + ' ' + n1(y1 + 2.4) + ' L' + n1(iB + 3) + ' ' + n1(y1 + 2.4) + ' Z"/>'
      : '';

    return '<svg class="cr-svg" viewBox="' + n1(L.box.x) + ' ' + n1(L.box.y) + ' ' +
      n1(L.box.w) + ' ' + n1(L.box.h) + '">' +
      '<path class="cr-shadow" d="M' + n1(iT) + ' ' + n1(y0) + ' L' + n1(iT - 4.5) + ' ' + n1(y0) +
      ' L' + n1(iB - 4.5) + ' ' + n1(y1) + ' L' + n1(iB) + ' ' + n1(y1) + ' Z"/>' +
      gang +
      '<path class="cr-shell" fill-rule="evenodd" d="M' + n1(iT) + ' ' + n1(y0) + ' L' + n1(oT) + ' ' + n1(y0) +
      ' L' + n1(oB) + ' ' + n1(y1) + ' L' + n1(iB) + ' ' + n1(y1) + ' Z ' +
      'M' + n1(F[0][0]) + ' ' + n1(F[0][1]) + ' L' + n1(F[3][0]) + ' ' + n1(F[3][1]) +
      ' L' + n1(F[2][0]) + ' ' + n1(F[2][1]) + ' L' + n1(F[1][0]) + ' ' + n1(F[1][1]) + ' Z"/>' +
      '<path class="cr-floor" d="M' + n1(F[0][0]) + ' ' + n1(F[0][1]) + ' L' + n1(F[1][0]) + ' ' + n1(F[1][1]) +
      ' L' + n1(F[2][0]) + ' ' + n1(F[2][1]) + ' L' + n1(F[3][0]) + ' ' + n1(F[3][1]) + ' Z"/>' +
      '<g class="cr-fix">' + fix + '</g>' +
      '<path class="cr-slot" d="' + slot + '"/>' +
      '<path class="cr-sill" d="' + sill + '"/>' +
      leaf(tA, tM, yAt(tA), 'a') +
      leaf(tM, tB, yAt(tB), 'b') +
      '</svg>';
  };

  /* 车顶总数标签与车厢号（HTML：字形比 SVG <text> 清楚，且不随纵深缩小） */
  A.carTot = function (tot) {
    return '<div class="roof-total">共 ' + tot + ' 张</div>';
  };
  A.carNo = function (label) {
    return '<div class="car-no">' + A.esc(label) + '</div>';
  };

  /* ================= 列车头 =================
     近端被画面切掉之前，露出来的那一截：车顶 + 朝向观众的车头脸。 */
  A.loco = function (B) {
    const q = B.quad, iT = q[0][0], oT = q[1][0], iB = q[3][0], oB = q[2][0];
    const y0 = B.y0, y1 = B.y1, s = B.s;
    const hF = 30 * s;                                     // 车头脸的高度
    const fx = iB + 2, fw = oB - iB - 4;
    return '<svg class="lo-svg" viewBox="' + n1(B.box.x) + ' ' + n1(B.box.y) + ' ' +
      n1(B.box.w) + ' ' + n1(B.box.h) + '">' +
      '<path class="lo-shadow" d="M' + n1(iT) + ' ' + n1(y0) + ' L' + n1(iT - 4.5) + ' ' + n1(y0) +
      ' L' + n1(iB - 4.5) + ' ' + n1(y1) + ' L' + n1(iB) + ' ' + n1(y1) + ' Z"/>' +
      '<path class="lo-body" d="M' + n1(iT) + ' ' + n1(y0) + ' L' + n1(oT) + ' ' + n1(y0) +
      ' L' + n1(oB) + ' ' + n1(y1) + ' L' + n1(iB) + ' ' + n1(y1) + ' Z"/>' +
      '<path class="lo-stripe" d="M' + n1(iT + 6) + ' ' + n1(y0) + ' L' + n1(oT - 46) + ' ' + n1(y0) +
      ' L' + n1(oB - 46) + ' ' + n1(y1) + ' L' + n1(iB + 6) + ' ' + n1(y1) + ' Z"/>' +
      '<rect class="lo-hatch" x="' + n1(iT + 26) + '" y="' + n1(y0 + 12) + '" width="' + n1(30 * s) +
      '" height="' + n1(20 * s) + '" rx="' + n1(3 * s) + '"/>' +
      '<rect class="lo-vent" x="' + n1(iT + 62) + '" y="' + n1(y0 + 14) + '" width="' + n1(22 * s) +
      '" height="' + n1(8 * s) + '" rx="' + n1(3 * s) + '"/>' +
      '<rect class="lo-vent" x="' + n1(iT + 62) + '" y="' + n1(y0 + 28) + '" width="' + n1(22 * s) +
      '" height="' + n1(8 * s) + '" rx="' + n1(3 * s) + '"/>' +
      /* 车头脸：整块压在车顶近端上（它比车顶更靠近观众） */
      '<path class="lo-face" d="M' + n1(fx) + ' ' + n1(y1 - hF) + ' L' + n1(fx + fw) + ' ' + n1(y1 - hF) +
      ' L' + n1(fx + fw - 1.5) + ' ' + n1(y1 - 1.5) + ' L' + n1(fx + 1.5) + ' ' + n1(y1 - 1.5) + ' Z"/>' +
      '<path class="lo-glass" d="M' + n1(fx + 7) + ' ' + n1(y1 - hF + 5) + ' L' + n1(fx + fw - 7) + ' ' + n1(y1 - hF + 5) +
      ' L' + n1(fx + fw - 10) + ' ' + n1(y1 - hF * 0.46) + ' L' + n1(fx + 10) + ' ' + n1(y1 - hF * 0.46) + ' Z"/>' +
      '<rect class="lo-sign" x="' + n1(fx + 12) + '" y="' + n1(y1 - hF + 1.6) + '" width="' + n1(fw - 24) +
      '" height="' + n1(2.6 * s) + '" rx="1"/>' +
      '<circle class="lo-lamp" cx="' + n1(fx + 9) + '" cy="' + n1(y1 - hF * 0.28) + '" r="' + n1(3.4 * s) + '"/>' +
      '<circle class="lo-lamp" cx="' + n1(fx + fw - 9) + '" cy="' + n1(y1 - hF * 0.28) + '" r="' + n1(3.4 * s) + '"/>' +
      '<path class="lo-bumper" d="M' + n1(fx + 1.5) + ' ' + n1(y1 - 5.4) + ' L' + n1(fx + fw - 1.5) + ' ' + n1(y1 - 5.4) +
      ' L' + n1(fx + fw - 1.5) + ' ' + n1(y1 - 1.5) + ' L' + n1(fx + 1.5) + ' ' + n1(y1 - 1.5) + ' Z"/>' +
      '</svg>';
  };

  /* ================= 角色 =================
     viewBox 24×40，脚底在 y=40。同一份模板供所有玩家复用，
     换装 = 改 .fig 上的 6 个 CSS 变量，零重渲染。
     四肢是独立 <g data-limb>，由 render 写 transform="rotate(a,cx,cy)" 摆动。
     背包是 <g data-bag>，鼓起时写 scale。 */
  A.LIMB = {
    armL: [7.6, 14.8], armR: [16.4, 14.8],
    legL: [10.2, 27.2], legR: [13.8, 27.2],
  };
  A.BAG_PIVOT = [12, 22];
  A.FOOT = 7;          // 碰撞用的半身宽（世界单位）
  A.HEAD = 40;         // 角色总高（世界单位）

  A.FIG_SVG =
    '<svg class="fig-svg" viewBox="0 0 24 40">' +
    '<ellipse class="p-mark" cx="12" cy="39.3" rx="9.6" ry="2.9"/>' +
    '<ellipse class="p-shadow" cx="12" cy="39.3" rx="7.2" ry="2"/>' +
    '<g class="bag-wrap" data-bag>' +
    '<rect class="p-bag" x="5.3" y="14.8" width="13.4" height="14.4" rx="5"/>' +
    '<rect class="p-bag bag-pocket" x="5.3" y="24.6" width="13.4" height="4.6" rx="2.3"/>' +
    '<rect class="bag-line" x="7" y="17.4" width="1" height="8.4" rx=".5"/>' +
    '</g>' +
    '<g data-limb="legL"><rect class="p-bottom" x="8.5" y="26.6" width="3.4" height="9.4" rx="1.6"/>' +
    '<path class="p-shoe" d="M8.3 34.6 h3.8 v2.6 a1.3 1.3 0 0 1 -1.3 1.3 h-2.5 z"/></g>' +
    '<g data-limb="legR"><rect class="p-bottom" x="12.1" y="26.6" width="3.4" height="9.4" rx="1.6"/>' +
    '<path class="p-shoe" d="M12.1 34.6 h3.8 v3.9 h-2.5 a1.3 1.3 0 0 1 -1.3 -1.3 z"/></g>' +
    '<path class="p-top" d="M12 12.4 c-2.5 0 -4.4 1.3 -4.7 3 l-.9 9.6 c-.1 1.2 .7 2 1.9 2 h7.4 c1.2 0 2-.8 1.9-2 l-.9-9.6 c-.3-1.7-2.2-3-4.7-3 z"/>' +
    '<g data-limb="armL"><rect class="p-top" x="4.9" y="14.4" width="3" height="8.2" rx="1.5"/>' +
    '<circle class="p-skin" cx="6.4" cy="23.9" r="1.7"/></g>' +
    '<g data-limb="armR"><rect class="p-top" x="16.1" y="14.4" width="3" height="8.2" rx="1.5"/>' +
    '<circle class="p-skin" cx="17.6" cy="23.9" r="1.7"/></g>' +
    '<g class="bag-strap"><path d="M9.5 13.6 l-.9 9.4"/><path d="M14.5 13.6 l.9 9.4"/></g>' +
    '<rect class="p-skin" x="10.5" y="11.6" width="3" height="2.6" rx="1.1"/>' +
    '<ellipse class="p-skin" cx="12" cy="8.4" rx="4.1" ry="4.5"/>' +
    '<ellipse class="p-ink" cx="7.9" cy="8.7" rx=".75" ry="1.05"/>' +
    '<ellipse class="p-ink" cx="16.1" cy="8.7" rx=".75" ry="1.05"/>' +
    '<circle class="p-ink" cx="10.4" cy="8.7" r=".62"/>' +
    '<circle class="p-ink" cx="13.6" cy="8.7" r=".62"/>' +
    '<ellipse class="p-blush" cx="9.2" cy="10.3" rx="1.15" ry=".72"/>' +
    '<ellipse class="p-blush" cx="14.8" cy="10.3" rx="1.15" ry=".72"/>' +
    '<path class="p-ink" d="M10.6 10.6 q1.4 1.3 2.8 0" fill="none" stroke-width=".55" stroke-linecap="round"/>' +
    '<g class="p-hat">' +
    '<path d="M7.7 6.3 Q7.7 1.5 12 1.5 Q16.3 1.5 16.3 6.3 Z"/>' +
    '<rect x="7" y="5.5" width="10" height="2.3" rx="1.15"/>' +
    '<circle cx="12" cy="1.3" r="1.5"/>' +
    '</g>' +
    '</svg>';

  /* 一个角色：外层 .fig 承载配色变量与位移 transform，内层 SVG 只管画 */
  A.fig = function (p, mark) {
    const c = p.colors;
    return '<div class="fig" data-pid="' + p.id + '" style="' +
      '--top:' + A.esc(c.top) + ';--bottom:' + A.esc(c.bottom) + ';--shoe:' + A.esc(c.shoes) +
      ';--hat:' + A.esc(c.hat) + ';--bag:' + A.esc(c.bag) + ';--skin:' + A.esc(c.skin) +
      ';--mark:' + A.esc(mark) + '">' +
      A.FIG_SVG +
      '<div class="fig-bubble"></div>' +
      '<div class="fig-tag">' + A.esc(p.name) + '</div>' +
      '</div>';
  };

  /* ================= 背包 / 储物柜 ================= */

  /* 背包：底边压在锚点上（靠墙站），包身向上生长 —— 与世界地面法一致 */
  A.pack = function (p) {
    return '<div class="pack" data-pid="' + p.id + '" style="--bag:' + A.esc(p.colors.bag) + '">' +
      '<svg class="pack-svg" viewBox="0 0 40 52">' +
      '<ellipse class="pk-shadow" cx="20" cy="49.4" rx="14" ry="2.4"/>' +
      '<path class="pk-body" d="M7 13 Q7 6.5 13.5 6.5 h13 Q33 6.5 33 13 v27.5 Q33 47 26.5 47 h-13 Q7 47 7 40.5 Z"/>' +
      '<path class="pk-pocket" d="M10.5 30 Q10.5 27 13.5 27 h13 Q30 27 30 30 v9 Q30 42 26.5 42 h-13 Q10.5 42 10.5 39 Z"/>' +
      '<path class="pk-line" d="M10 34.5 h20"/>' +
      '<path class="pk-handle" d="M14 6.5 Q14 2.6 20 2.6 Q26 2.6 26 6.5"/>' +
      '<path class="pk-strap" d="M13 8.5 Q6.5 14 8 22"/><path class="pk-strap" d="M27 8.5 Q33.5 14 32 22"/>' +
      '<circle class="pk-buckle" cx="20" cy="24" r="2.6"/>' +
      '</svg>' +
      '<div class="pk-name">' + A.esc(p.name) + '</div>' +
      '<div class="pk-badge">' + A.badge(p.bag) + '</div>' +
      '</div>';
  };

  /* 柜内陈列：有几色就几格，每格一张小票 + 该色张数。
     张数原先一律挂在票右边，字号被格宽压成 tw*0.52 —— 六人局柜子只有 20.7 单位宽时
     掉到 4.6 单位（≈4.7px），肉眼读不出来。现在分两套摆法，两套都吃 6.4 的可读性地板：
       · 宽柜（N≤4，两列两行）：数字压在票正下方 —— 与车内筹码同一套语法；
       · 窄柜（N≥5，一列最多四行）：一行只有 12 单位高，压到票下会顶到底部总数行，
         于是改回「票在左、数字在右」，把票压窄给数字让位。
     底下再压一个总数（.li-n，一台柜一个）。 */
  A.lockerInner = function (t, B) {
    let kinds = 0, tot = 0;
    for (let c = 0; c < 4; c++) { if (t[c] > 0) kinds++; tot += t[c]; }
    if (!kinds) {
      return '<text class="li-empty" x="' + n1(B.w / 2) + '" y="' + n1(B.h / 2 + 2) + '">空</text>' +
        '<text class="li-n" x="' + n1(B.w / 2) + '" y="' + n1(B.h - 1.6) + '" font-size="7">0</text>';
    }
    const cols = B.w >= 30 ? 2 : 1, rows = Math.ceil(kinds / cols);
    const cw = (B.w - 4.4) / cols, chh = (B.h - 8) / rows;
    const side = cols === 1;                                   // 窄柜：数字在票右边
    const tw = Math.min(cw * (side ? 0.40 : 0.60), 13.6), th = tw * 0.625;
    let out = '', k = 0;
    for (let c = 0; c < 4; c++) {
      if (!t[c]) continue;
      const col = k % cols, row = (k / cols) | 0;
      const x0 = 2.2 + col * cw, y0 = 2.2 + row * chh;
      const cy = y0 + chh / 2;
      out += A.ticketMini(c, 'x="' + n1(side ? x0 + 1 : x0 + (cw - tw) / 2) + '" y="' + n1(cy - th / 2) +
        '" width="' + n1(tw) + '" height="' + n1(th) + '"', true);
      out += '<text class="li-c lk-' + c + (side ? ' side' : '') + '" x="' +
        n1(side ? x0 + tw + 2.2 : x0 + cw / 2) + '" y="' + n1(cy + (side ? 2.2 : th / 2 + 5.4)) +
        '" font-size="' + n1(Math.max(6.4, side ? 6.4 : tw * 0.52)) + '">' + t[c] + '</text>';
      k++;
    }
    out += '<text class="li-n" x="' + n1(B.w / 2) + '" y="' + n1(B.h - 1.6) + '" font-size="7">' + tot + '</text>';
    return out;
  };

  /* 一台储物柜：站在远端墙前，正面朝观众。门轴在门顶 —— 开柜就是「向上卷起」，从下往上露出柜内 */
  A.locker = function (p, B) {
    const W = B.w, Hh = B.h, inset = 1.6;
    const hinge = inset + 0.8;                    // data-hy：门轴压在门的上沿
    return '<div class="locker" data-pid="' + p.id + '" style="--cloth:' + A.esc(p.colors.top) + '">' +
      '<svg class="locker-svg" viewBox="0 0 ' + n1(W) + ' ' + n1(Hh) + '">' +
      '<rect class="lk-case" x="' + n1(inset * 0.5) + '" y="' + n1(inset * 0.5) + '" width="' + n1(W - inset) +
      '" height="' + n1(Hh - inset) + '" rx="2.4"/>' +
      '<rect class="lk-in" x="' + n1(inset + 0.8) + '" y="' + n1(inset + 0.8) + '" width="' + n1(W - inset * 2 - 1.6) +
      '" height="' + n1(Hh - inset * 2 - 1.6) + '" rx="1.6"/>' +
      '<g class="lk-inner">' + A.lockerInner(p.locker, B) + '</g>' +
      '<g class="lk-door" data-door="1" data-hy="' + n1(hinge) + '">' +
      '<rect class="lk-panel" x="' + n1(inset + 0.8) + '" y="' + n1(inset + 0.8) + '" width="' + n1(W - inset * 2 - 1.6) +
      '" height="' + n1(Hh - inset * 2 - 1.6) + '" rx="1.6"/>' +
      '<rect class="lk-panel-hi" x="' + n1(inset + 0.8) + '" y="' + n1(inset + 0.8) + '" width="' + n1(W - inset * 2 - 1.6) +
      '" height="1.6" rx=".8"/>' +
      '<rect class="lk-vent" x="' + n1(W / 2 - 5.4) + '" y="3.9" width="10.8" height="1.2" rx=".6"/>' +
      '<rect class="lk-vent" x="' + n1(W / 2 - 5.4) + '" y="6.5" width="10.8" height="1.2" rx=".6"/>' +
      '<rect class="lk-grip" x="' + n1(W / 2 - 3.4) + '" y="' + n1(Hh - 9.6) + '" width="6.8" height="1.7" rx=".85"/>' +
      '</g>' +
      '</svg>' +
      '<div class="lk-name">' + A.esc(p.name) + '</div>' +
      '<div class="lk-badge">' + A.badge(p.locker) + '</div>' +
      '</div>';
  };

  /* ================= 站台场景（纵向鸟瞰，静态，开局写一次） =================

     坐标复习：站台是近宽远窄的梯形，d = 0 在画面上方（最远）、d = 1 在下方（最近）。
     纵向鸟瞰里「高度」在屏幕上只能表现为「向上位移」（位移量 = 高度 × 该深度的缩放），
     横向位置则一律取该点地面深度上的纵深线 x —— 于是左墙就是一条窄带，壁灯挂在带上朝站台伸。 */
  A.scenery = function (G) {
    const W = G.WORLD.w, H = G.WORLD.h;
    const yF = G.depthY(0), yN = G.depthY(1);
    const eF = G.edgeAt(0), eN = G.edgeAt(1);
    const lean = G.lean;
    const dY = G.depthY, sAt = G.depthScale;
    const LK = G.LOCKERS;
    const WALL_H = 150;                                    // 左墙在世界里的高度
    const wallX = function (y) { return lean(G.PLAT.nearL, y); };        // 墙脚 = 站台左缘
    const wallTop = function (y) { return lean(G.PLAT.nearL, y + WALL_H); };

    /* —— 站台地砖：纵向缝朝消失点收，横向缝按深度等分（远端自然挤密） —— */
    let tiles = '';
    for (let i = 0; i <= 12; i++) {
      const xN = G.PLAT.nearL + (G.PLAT.nearR - G.PLAT.nearL) * i / 12;
      tiles += '<path d="M' + n1(lean(xN, yF)) + ' ' + n1(yF) + ' L' + n1(xN) + ' ' + n1(yN) + '"/>';
    }
    for (let k = 1; k < 16; k++) {
      const e = G.edgeAt(k / 16);
      tiles += '<path d="M' + n1(e.l) + ' ' + n1(e.y) + ' H' + n1(e.r) + '"/>';
    }

    /* —— 盲道：贴站台右缘一条，圆点随纵深缩小 —— */
    let tact = '', dots = [];
    const band = function (k) {
      const e = G.edgeAt(k);
      return { a: e.r - 17 * (e.w / 184), b: e.r - 5.5 * (e.w / 184), y: e.y };
    };
    const b0 = band(0), b1 = band(1);
    tact = '<path class="sc-tact" d="M' + n1(b0.a) + ' ' + n1(b0.y) + ' L' + n1(b0.b) + ' ' + n1(b0.y) +
      ' L' + n1(b1.b) + ' ' + n1(b1.y) + ' L' + n1(b1.a) + ' ' + n1(b1.y) + ' Z"/>';
    for (let k = 1; k <= 30; k++) {
      const d = k / 31, e = band(d), c = G.edgeAt(d);
      dots.push('<circle class="sc-dot" cx="' + n1((e.a + e.b) / 2) + '" cy="' + n1(c.y) + '" r="' +
        n1(1.7 * sAt(d) * (c.w / 184)) + '"/>');
    }

    /* —— 轨道床：从站台右缘一直铺到画面右缘，越往右越暗（那边是站舍背光处） —— */
    const rail = function (near) {
      return 'M' + n1(lean(near, yF)) + ' ' + n1(yF) + ' L' + n1(near) + ' ' + n1(yN);
    };
    let sleep = '';
    for (let k = 0; k < 26; k++) {
      const y = dY(0.012 + 0.976 * k / 25);
      sleep += '<path d="M' + n1(lean(238, y)) + ' ' + n1(y) + ' L' + n1(lean(342, y)) + ' ' + n1(y) + '"/>';
    }
    const duct = '<path class="sc-duct" d="M' + n1(lean(206, yF)) + ' ' + n1(yF) + ' L' + n1(lean(220, yF)) +
      ' ' + n1(yF) + ' L220 ' + n1(yN) + ' L206 ' + n1(yN) + ' Z"/>';

    /* —— 灯下的光池（洒在站台地面上） —— */
    let pools = '';
    const LP = [[0.14, 0.28], [0.38, 0.26], [0.62, 0.30], [0.86, 0.36]];
    for (let i = 0; i < LP.length; i++) {
      const e = G.edgeAt(LP[i][0]), s = sAt(LP[i][0]);
      pools += '<ellipse class="fl-pool" cx="' + n1(e.l + e.w * LP[i][1]) + '" cy="' + n1(e.y) +
        '" rx="' + n1(28 * s) + '" ry="' + n1(10 * s) + '"/>';
    }

    /* —— 左墙边的小件：都靠在活动边界之外（7·s < 0.08·e.w 恒成立），纯装饰 —— */
    const deco = function (d, kind) {
      const e = G.edgeAt(d), s = sAt(d), x = e.l + 7 * s;
      if (kind === 'bench') {
        return '<g class="bench" transform="translate(' + n1(x) + ',' + n1(e.y) + ') scale(' + s.toFixed(3) + ')">' +
          '<ellipse class="bn-shadow" cx="14" cy="1" rx="16" ry="2.4"/>' +
          '<rect class="bn-leg" x="2" y="-3" width="2.6" height="3.4"/><rect class="bn-leg" x="23.4" y="-3" width="2.6" height="3.4"/>' +
          '<rect class="bn-seat" x="0" y="-8.4" width="28" height="3.1" rx="1.5"/>' +
          '<rect class="bn-seat" x="0" y="-4.8" width="28" height="3.1" rx="1.5"/>' +
          '<rect class="bn-hi" x="0" y="-8.4" width="28" height="1.1" rx=".55"/>' +
          '</g>';
      }
      return '<g class="bin" transform="translate(' + n1(x) + ',' + n1(e.y) + ') scale(' + s.toFixed(3) + ')">' +
        '<ellipse class="bn-shadow" cx="7" cy="1" rx="8" ry="2"/>' +
        '<path class="bn-body" d="M0 -12 h14 l-1.6 12 h-10.8 Z"/>' +
        '<rect class="bn-lid" x="-1.2" y="-14.4" width="16.4" height="2.6" rx="1.3"/>' +
        '<rect class="bn-slot" x="4" y="-10.6" width="6" height="1.7" rx=".85"/>' +
        '</g>';
    };

    /* —— 左墙壁灯：锚在墙脚，高度换算成向上位移；灯罩朝站台一侧伸 —— */
    let lamps = '';
    const LD = [0.14, 0.38, 0.62, 0.86];
    for (let i = 0; i < LD.length; i++) {
      const y0 = dY(LD[i]), s = sAt(LD[i]);
      lamps += '<g class="sc-lamp" transform="translate(' + n1(wallX(y0)) + ',' + n1(y0 - 126 * s) +
        ') scale(' + s.toFixed(3) + ')">' +
        '<path class="lm-arm" d="M0 -1.2 h17 v2.4 h-17 Z"/>' +
        '<path class="lm-shade" d="M10.6 1.2 h10.4 l-2.2 5.6 h-6 Z"/>' +
        '<rect class="lm-bulb" x="13.2" y="6.6" width="5.6" height="2.1" rx="1"/>' +
        '<ellipse class="lm-glow" cx="16" cy="9.8" rx="20" ry="11"/>' +
        '</g>';
    }

    /* —— 远端墙上的固定设施 —— */
    const sgn = '<g class="sc-sgn">' +
      '<path class="sg-line" d="M94 0 V16 M168 0 V16"/>' +
      '<rect class="sg-case" x="76" y="16" width="110" height="26" rx="2.6"/>' +
      '<text class="sg-zh" x="86" y="29.4">车票收藏家</text>' +
      '<text class="sg-en" x="86" y="37.6">TICKET COLLECTOR</text>' +
      '</g>';
    const led = '<g class="sc-led">' +
      '<rect class="led-case" x="198" y="8" width="94" height="22" rx="2.6"/>' +
      '<circle class="led-dot" cx="207" cy="19" r="1.8"/>' +
      '<text class="led-txt" x="214" y="22.4">厦门北 → 机场站</text>' +
      '</g>';
    const tun = '<g class="sc-tun">' +
      '<path class="tn-frame" d="M194 ' + n1(yF) + ' V88 a48 26 0 0 1 96 0 V' + n1(yF) + ' Z"/>' +
      '<path class="tn-arch" d="M200 ' + n1(yF) + ' V90 a42 22 0 0 1 84 0 V' + n1(yF) + ' Z"/>' +
      '</g>';
    const ad = '<g class="sc-ad" transform="translate(292,40) scale(.698)">' +
      '<rect class="ad-case" x="0" y="0" width="86" height="70" rx="2.6"/>' +
      '<rect class="ad-sky" x="3.4" y="3.4" width="79.2" height="46" rx="1.4"/>' +
      '<circle class="ad-sun" cx="24" cy="15" r="6"/>' +
      '<path class="ad-city" d="M5 49.4 V32 h8 v17.4 M15 49.4 V24 h11 v25.4 M28 49.4 V36 h8 v13.4 ' +
      'M38 49.4 V27 h10 v22.4 M50 49.4 V38 h8 v11.4 M60 49.4 V30 h10 v19.4 M72 49.4 V36 h8 v13.4"/>' +
      '<rect class="ad-band" x="3.4" y="54" width="79.2" height="13" rx="1.4"/>' +
      '<text class="ad-txt" x="43" y="63.4">海上城市</text>' +
      '</g>';
    const clock = '<g class="sc-clock" transform="translate(322,20) scale(.8)">' +
      '<circle class="ck-case" cx="0" cy="0" r="16"/>' +
      '<circle class="ck-face" cx="0" cy="0" r="13.2"/>' +
      '<path class="ck-hand" d="M0 0 V-9.4 M0 0 L7.4 4.4"/>' +
      '<circle class="ck-pin" cx="0" cy="0" r="1.5"/>' +
      '</g>';

    return '<svg class="scenery-svg" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<defs>' +
      '<linearGradient id="tc-wallg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#dbe5f0"/><stop offset="1" stop-color="#bccbdb"/></linearGradient>' +
      '<linearGradient id="tc-void" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#243040"/><stop offset="1" stop-color="#141c26"/></linearGradient>' +
      '<linearGradient id="tc-platg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#eaf1f8"/><stop offset="1" stop-color="#ffffff"/></linearGradient>' +
      '<linearGradient id="tc-bedg" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#4d5964"/><stop offset=".7" stop-color="#333d49"/>' +
      '<stop offset="1" stop-color="#1c222b"/></linearGradient>' +
      '<linearGradient id="tc-lwg" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#c6d3e1"/><stop offset="1" stop-color="#eef4fa"/></linearGradient>' +
      '<linearGradient id="tc-mouth" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#262f3a"/><stop offset="1" stop-color="#0b1016"/></linearGradient>' +
      '<radialGradient id="tc-glow"><stop offset="0" stop-color="#ffe3ad" stop-opacity=".5"/>' +
      '<stop offset="1" stop-color="#ffe3ad" stop-opacity="0"/></radialGradient>' +
      '<pattern id="tc-wallT" width="24" height="17" patternUnits="userSpaceOnUse">' +
      '<rect width="24" height="17" fill="#e7eef6"/>' +
      '<rect y="15.8" width="24" height="1.2" fill="#cbd8e6"/><rect x="22.8" width="1.2" height="17" fill="#d5e0ec"/></pattern>' +
      '</defs>' +
      /* 底：站台左墙外侧与轨道尽头之外统一压暗 */
      '<rect class="sc-void" x="0" y="0" width="' + W + '" height="' + H + '"/>' +
      /* 轨道床 → 电缆槽 → 枕木 → 双轨（一律朝消失点收） */
      '<path class="sc-bed" d="M' + n1(eF.r) + ' ' + n1(yF) + ' L' + W + ' ' + n1(yF) + ' L' + W + ' ' + n1(yN) +
      ' L' + n1(eN.r) + ' ' + n1(yN) + ' Z"/>' +
      duct +
      '<g class="sc-sleep">' + sleep + '</g>' +
      '<path class="sc-rail" d="' + rail(250) + ' ' + rail(328) + '"/>' +
      /* 远端墙：瓷砖片 + 踢脚 + 储物柜壁龛 + 挂灯牌 / LED / 隧道口 / 广告 / 钟 */
      '<rect class="sc-wall" x="0" y="0" width="' + W + '" height="' + n1(yF) + '"/>' +
      '<rect class="sc-wallT" x="0" y="0" width="' + W + '" height="' + n1(yF) + '"/>' +
      '<rect class="sc-mold" x="0" y="' + n1(yF - 5) + '" width="' + W + '" height="5"/>' +
      '<rect class="sc-niche" x="' + n1(LK.l - 8) + '" y="' + n1(LK.top - 10) + '" width="' +
      n1(LK.r - LK.l + 16) + '" height="' + n1(yF - LK.top + 10) + '" rx="3"/>' +
      sgn + led + tun + ad + clock +
      /* 左墙：一条窄带（墙脚到墙顶），下沿就是站台左缘 —— 画在远墙之后，交角自然遮住远墙左下角 */
      '<path class="sc-lwall" d="M' + n1(wallTop(0)) + ' 0 L' + n1(wallTop(yN)) + ' ' + n1(yN) +
      ' L' + n1(wallX(yN)) + ' ' + n1(yN) + ' L' + n1(wallX(0)) + ' 0 Z"/>' +
      '<path class="sc-lwtop" d="M' + n1(wallTop(0)) + ' 0 L' + n1(wallTop(yN)) + ' ' + n1(yN) + '"/>' +
      /* 站台地面 + 地砖 + 光池 + 盲道 + 警戒线 */
      '<path class="sc-plat" d="M' + n1(eF.l) + ' ' + n1(yF) + ' L' + n1(eF.r) + ' ' + n1(yF) +
      ' L' + n1(eN.r) + ' ' + n1(yN) + ' L' + n1(eN.l) + ' ' + n1(yN) + ' Z"/>' +
      '<g class="sc-tiles">' + tiles + '</g>' +
      pools +
      tact + '<g class="sc-dots">' + dots.join('') + '</g>' +
      '<path class="sc-edge" d="M' + n1(eF.r - 3.2) + ' ' + n1(yF) + ' L' + n1(eF.r) + ' ' + n1(yF) +
      ' L' + n1(eN.r) + ' ' + n1(yN) + ' L' + n1(eN.r - 3.2) + ' ' + n1(yN) + ' Z"/>' +
      deco(0.35, 'bench') + deco(0.82, 'bin') +
      lamps +
      /* 近端台唇 */
      '<rect class="sc-lip" x="0" y="' + n1(yN) + '" width="' + W + '" height="' + n1(H - yN) + '"/>' +
      '</svg>';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = A;
  if (root) root.TC_ART = A;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
