/* 《巫师牌》端到端走查。运行：node test-shot.js
   390×844 手机视口，真点真打，逐阶段截图到 shots/，收集 pageerror / console 报错。

   核心断言：
   1. 每一轮对账摊开时，「屏幕上的数字」必须逐格等于「引擎里的数字」——
      对账行、座位徽章（预 / 墩 / 总分）、手牌张数、小榜总分，一处对不上就是有一处写错了。
   2. 演出只许改「看到什么」，不许改「发生什么」—— 同一颗种子、同一串代打点击，
      1 倍速与「快速思考」档跑完同样轮数后，引擎状态与 rng 状态必须逐字节相同。
   3. 舞台内的字 ≥ 6.4 世界单位、舞台外的字 ≥ 12px、座位与墩位不出舞台边界、
      顶栏在 390px 下不横向溢出 —— 版面在手机这一档上不许塌。

   真人决策由测试脚本代打（面板一冒出来就点），所以每张图都是「真人真的能点出来」的样子。 */
'use strict';
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const SHOTS = path.join(DIR, 'shots');
const SEED = 20240922;
const page_url = q => pathToFileURL(path.join(DIR, 'index.html')).href + (q || '');

let pass = 0, fail = 0;
const fails = [];
function ok(msg, cond) {
  if (cond) pass++;
  else { fail++; fails.push(msg); console.log('  ✗ ' + msg); }
}
const ONLY = process.env.WZ_ONLY || '';         /* node 前设 WZ_ONLY=对账 可只跑标题含该串的段落 */
function section(t) {
  const go = !ONLY || t.indexOf(ONLY) >= 0;
  if (go) console.log('\n== ' + t + ' ==');
  return go;
}

/* 冻结时钟 → 同一颗种子；Math.random 只被装修饰性粒子与 think() 的抖动用，同样钉死 */
const FREEZE = function (seed) {
  const t = Date.parse('2026-09-22T09:00:00+08:00');
  Date.now = function () { return t; };
  let a = seed >>> 0;
  Math.random = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

/* reduced:true 必须在 goto 之前设好 —— render.js 的 boot() 在页面加载时读一次 matchMedia 就定下 fxOn */
async function open(browser, opt) {
  opt = opt || {};
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    const t = m.type();
    if (t === 'error' || t === 'warning') errs.push(t + ': ' + m.text());
  });
  if (opt.reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(FREEZE, SEED);
  /* 音效探针：数 createOscillator —— 「有没有真的合成出声」只能这样量 */
  if (opt.audio) {
    await page.addInitScript(function () {
      window.__osc = 0;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const Wrapped = function () {
        const c = new AC();
        window.__ctx = c;
        const o = c.createOscillator.bind(c);
        c.createOscillator = function () { window.__osc++; return o(); };
        return c;
      };
      Wrapped.prototype = AC.prototype;
      window.AudioContext = Wrapped;
      try { window.webkitAudioContext = Wrapped; } catch (e) { /* 忽略 */ }
    });
  }
  await page.goto(page_url(opt.q));
  await page.waitForTimeout(300);
  page.__errs = errs;
  return page;
}

/* 截图。Windows 上旧图可能正被看图进程占着句柄（UNKNOWN -4094），重试几次，绝不让一张图带崩整轮 */
async function shot(page, name) {
  const file = path.join(SHOTS, name + '.png');
  for (let i = 0; i < 4; i++) {
    try { return await page.screenshot({ path: file }); }
    catch (e) { await page.waitForTimeout(250); }
  }
  try { return await page.screenshot({ path: path.join(SHOTS, name + '-b.png') }); }
  catch (e) { console.log('      · 截图 ' + name + ' 写不进去：' + e.message); }
}

async function waitFor(page, ms, fn, arg) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() - t0 >= ms) return false;
    await page.waitForTimeout(100);
  }
}
const st = page => page.evaluate(() => {
  const S = window.WZUI.state();
  return {
    phase: S ? S.phase : 'none', round: S ? S.round : 0, rounds: S ? S.rounds : 0,
    k: S ? S.k : 0, N: S ? S.N : 0, turn: S ? S.turn : -1,
    hand: S ? S.players[0].hand.length : 0, hist: S ? S.hist.length : 0,
    score: S ? S.players.map(p => p.score) : [],
    menu: !!document.querySelector('#screen-menu.on'),
    setup: !!document.querySelector('#screen-setup.on'),
    game: !!document.querySelector('#screen-game.on'),
    over: !!document.querySelector('#screen-over.on'),
    bid: !!document.querySelector('#bidpanel.on'),
    trump: !!document.querySelector('#trumppanel.on'),
    sum: !!document.querySelector('#summary.on'),
    pv: !document.querySelector('#preview').classList.contains('off'),
    playable: document.querySelectorAll('#hand .hc.playable').length,
  };
});

/* ---------- 真人代打：面板一冒出来就点 ----------
   bid 用「第几次预判」定档 → 同一局里逐轮轮换，A/B 两边点的是同一串；
   出牌永远点第一张亮着的（顺序由 sortHand 定死），确定性照样成立。
   maxSum 一到就收工（A/B 只跑三轮，别为一局里的 210 墩买单）；
   stopWhen 是另一把闸刀：代打到某个状态就停手、不点 —— 要趁「对账摊着」
   或「轮到自己出牌」这种中途状态做断言（刷新续玩、A/B 指纹）时用它。 */
async function driveGame(page, maxMs, hooks) {
  hooks = hooks || {};
  const maxSum = hooks.maxSum || 99;
  const t0 = Date.now();
  const acts = { bid: 0, trump: 0, play: 0, sum: 0, bad: [] };
  while (Date.now() - t0 < maxMs) {
    const s = await st(page);
    if (s.over || acts.sum >= maxSum) return acts;
    if (hooks.stopWhen && hooks.stopWhen(s)) return acts;
    if (s.menu) { acts.bad.push('掉回封面了'); return acts; }
    if (s.bid) {
      const n = await page.locator('#bidChips .bid-chip').count();
      if (!n) { await page.waitForTimeout(40); continue; }
      if (hooks.onBid) await hooks.onBid(page, acts);       /* 断言与截图跑在点掉之前 */
      await page.locator('#bidChips .bid-chip').nth(acts.bid % n).click();
      await page.click('#bidOk');
      acts.bid++;
      await page.waitForTimeout(30);
      continue;
    }
    if (s.trump) {
      if (hooks.onTrump) await hooks.onTrump(page, acts);
      await page.locator('#trumpRow .trump-btn').nth(acts.trump % 4).click();
      acts.trump++;
      await page.waitForTimeout(30);
      continue;
    }
    if (s.sum) {
      if (hooks.onSum) await hooks.onSum(page, acts);       /* 断言跑在点确认之前 */
      /* 对账逐行演算期间 #sumOk 还没挂监听（humanSum 等演出完才接上）——
         这段时间点它是空点：点了没人理，但也不能当没点。点到对账真的合上
         为止，只把「真的合上」那一下计一次 —— 否则演出快慢不同的两局，
         动作次数就对不上了（1 倍速下能空点出几十次） */
      for (let i = 0; i < 80; i++) {
        await page.click('#sumOk');
        await page.waitForTimeout(i === 0 ? 40 : 120);
        const closed = await page.evaluate(() => !document.querySelector('#summary').classList.contains('on'));
        if (closed) { acts.sum++; break; }
      }
      await page.waitForTimeout(30);
      continue;
    }
    if (s.pv) {
      await page.click('#pvPlay');
      acts.play++;
      await page.waitForTimeout(30);
      continue;
    }
    if (s.playable > 0 && s.phase === 'play' && s.turn === 0) {
      if (hooks.onMyTurn) await hooks.onMyTurn(page, acts);
      /* 点卡面「露出来的那一条」：手牌一多，扇形就叠起来 —— 直接点元素中心，
         会被右邻压住（Playwright 的命中检查一路重试到超时）。点哪都不行：
         Chromium 没有 getBoxQuads（Firefox 专属），按包围盒算的点会落在转过
         的卡面之外。这里走「卡面中心 + computed transform 的线性部分」：
         AABB 中心就是形变后的卡面中心（四角对称），再沿卡面自己的横轴往左
         走 32% 宽 —— 扇形再挤，靠左这一条也永远露在外面。
         点完核对「选中的确实是这一张」：牌若正在被动画挪位，点偏到邻居身上
         就会换一张出、整局走向就变了。重试只是改选（点同一张两次才出牌），安全。 */
      const pick = () => page.evaluate(() => {
        const hc = document.querySelector('#hand .hc.playable');
        if (!hc) return null;
        const r = hc.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let a = 1, b = 0;
        try {
          const ts = getComputedStyle(hc).transform;
          const m = (!ts || ts === 'none') ? new DOMMatrix() : new DOMMatrix(ts);
          a = m.a; b = m.b;
        } catch (e) { /* 不识别的矩阵就当没转 */ }
        const lx = -hc.offsetWidth * 0.32, ly = 0;
        return { x: cx + (a * lx + b * 0), y: cy + (b * lx + a * 0), id: +hc.dataset.id };
      });
      let pt = await pick();
      let sel = -1;
      for (let tryN = 0; pt && tryN < 3; tryN++) {
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(30);
        sel = await page.evaluate(() => {
          const el = document.querySelector('#hand .hc.sel');
          return el ? +el.dataset.id : -1;
        });
        if (sel === pt.id) break;
        acts.mis = (acts.mis || 0) + 1;
        await page.waitForTimeout(80);        /* 让挪位的动画再走一会儿 */
        const np = await pick();
        if (np) pt = np;
      }
      if (pt && sel === pt.id) {
        await page.click('#pvPlay');
        acts.play++;
        acts.nosel = 0;
      } else {
        /* 连着选不中就不空转 7 分钟：报清楚点到谁、目标是谁 */
        const why = await page.evaluate(p => {
          const el = p ? document.elementFromPoint(p.x, p.y) : null;
          const hc = el && el.closest ? el.closest('.hc') : null;
          return hc ? ('点到了手牌 ' + hc.dataset.id) : ('点到了 ' + (el ? (el.className || el.tagName) : '空'));
        }, pt);
        acts.bad.push('连点 3 次没选中目标手牌（k=' + s.k + '，目标 ' + (pt && pt.id) + '，选中 ' + sel + '，' + why + '）');
        return acts;
      }
      await page.waitForTimeout(30);
      continue;
    }
    await page.waitForTimeout(30);
  }
  acts.bad.push('超时没打完');
  return acts;
}

/* ---------- 屏幕数字 ↔ 引擎状态 对账（对账卡摊着的时候跑） ---------- */
async function assertSummary(page, tag) {
  /* 对账卡逐行演算：每行分数从 0 滚到终值、行本身淡入。核数前先等它落定，
     否则对到的是半路数字（剧本里 sum 一摊开就断言，正好撞上滚动最凶的一段）。 */
  await waitFor(page, 12000, () => {
    const S = window.WZUI.state();
    if (!S || !S.hist.length) return false;
    const last = S.hist[S.hist.length - 1].rows;
    const rows = document.querySelectorAll('#sumRows .sum-row');
    if (rows.length !== last.length) return false;
    for (let i = 0; i < rows.length; i++) {
      const pts = rows[i].querySelector('.sr-pts');
      if (!pts) return false;
      if (pts.textContent !== (last[i].pts > 0 ? '+' : '') + last[i].pts) return false;
      if (parseFloat(rows[i].style.opacity || '1') < 1) return false;
    }
    /* 行亮完后榜才揭（roundSummary 的揭榜补间）：榜题与榜体还没亮，说明演出没走完 ——
       等到揭完再核数，顺带把「先逐行、后揭榜」的时序钉进断言 */
    if (parseFloat(document.querySelector('#sumBoard').style.opacity || '1') < 1) return false;
    if (parseFloat(document.querySelector('#summary .board-title').style.opacity || '1') < 1) return false;
    return true;
  });
  const r = await page.evaluate(() => {
    const S = window.WZUI.state(), WZ = window.WZ;
    const bad = [];
    const v = WZ.validate(S);
    if (!v.ok) bad.push('不变量: ' + v.errs.join('; '));
    const last = S.hist[S.hist.length - 1];
    const rows = [].map.call(document.querySelectorAll('#sumRows .sum-row'), n => ({
      pid: +n.dataset.pid, pts: n.querySelector('.sr-pts').textContent,
      txt: n.textContent.replace(/\s+/g, ' '),
    }));
    if (!last) bad.push('#sumRows: S.hist 是空的');
    else {
      if (rows.length !== S.N) bad.push('#sumRows 行数 ' + rows.length + ' ≠ ' + S.N);
      last.rows.forEach((d, i) => {
        const row = rows[i];
        if (!row) return;
        const want = (d.pts > 0 ? '+' : '') + d.pts;
        if (row.pid !== d.pid) bad.push('第 ' + i + ' 行 pid 错位');
        if (row.pts !== want) bad.push('第 ' + i + ' 行分数 ' + row.pts + ' ≠ ' + want);
        if (row.txt.indexOf('预判 ' + d.bid) < 0) bad.push('第 ' + i + ' 行缺「预判 ' + d.bid + '」');
        if (row.txt.indexOf('实际 ' + d.won) < 0) bad.push('第 ' + i + ' 行缺「实际 ' + d.won + '」');
        if ((d.exact ? '✓' : '✗') !== row.txt.charAt(0)) bad.push('第 ' + i + ' 行记号 ≠ ' + (d.exact ? '✓' : '✗'));
      });
    }
    /* 座位芯片：预 / 墩 / 总分 / 手牌张数，四格全对 */
    S.players.forEach((p, i) => {
      const seat = document.querySelectorAll('#seats .seat')[i];
      if (!seat) { bad.push('缺座位 ' + i); return; }
      const g = (sel) => { const n = seat.querySelector(sel); return n ? n.textContent : '∅'; };
      if (g('.sc-bid b') !== String(p.bid)) bad.push(p.name + ' 预判徽章 ' + g('.sc-bid b') + ' ≠ ' + p.bid);
      if (g('.sc-won b') !== String(p.won)) bad.push(p.name + ' 墩徽章 ' + g('.sc-won b') + ' ≠ ' + p.won);
      if (g('.sc-score i') !== String(p.score)) bad.push(p.name + ' 总分 ' + g('.sc-score i') + ' ≠ ' + p.score);
      if (i > 0 && p.hand.length > 0 && g('.sc-backs b') !== '×' + p.hand.length)
        bad.push(p.name + ' 手牌徽章 ' + g('.sc-backs b') + ' ≠ ×' + p.hand.length);
    });
    /* 小榜总分 = 引擎总分 */
    const tbl = WZ.scoreTable(S);
    const foot = [].map.call(document.querySelectorAll('#sumBoard tfoot td'), n => n.textContent);
    S.players.forEach((p, i) => {
      if (foot[i] !== String(tbl.totals[i])) bad.push('小榜总分 ' + foot[i] + ' ≠ ' + tbl.totals[i]);
    });
    /* 小榜只列最近一轮，且那一行的逐格分数 = hist */
    const cells = [].map.call(document.querySelectorAll('#sumBoard tbody tr td .bd-pts'), n => n.textContent);
    if (last && cells.length === S.N) {
      last.rows.forEach((d, i) => {
        const want = (d.pts > 0 ? '+' : '') + d.pts;
        if (cells[i] !== want) bad.push('小榜第 ' + i + ' 格 ' + cells[i] + ' ≠ ' + want);
      });
    }
    /* 台面：牌堆计数 = 引擎牌堆 */
    const dp = document.querySelector('#table .dp-n');
    if (dp && dp.textContent !== String(S.deck.length)) bad.push('牌堆计数 ' + dp.textContent + ' ≠ ' + S.deck.length);
    return bad;
  });
  ok(tag + '：屏幕与引擎逐格一致', r.length === 0);
  r.slice(0, 8).forEach(x => console.log('      · ' + x));
}

/* ---------- 版面几何：6.4 世界单位地板 / 12px 天花板 / 不出舞台 ---------- */
async function assertGeometry(page, tag) {
  const g = await page.evaluate(() => {
    const box = document.querySelector('#stage').getBoundingClientRect();
    const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k'));
    const bad = { txt: [], seat: [], slot: [], hand: [], chrome: [] };
    /* 舞台与特效层（#fx 里的飘字也是 --wu 驱动的世界单位字）一起量地板 */
    document.querySelectorAll('#stage *, #fx *').forEach(function (el) {
      if (el.closest('#fx') && el.closest('.card')) return;   /* #fx 里的飞牌按 px 画，算装饰 */
      let direct = false;
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && n.textContent.trim()) { direct = true; break; }
      }
      if (!direct) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const fs = parseFloat(getComputedStyle(el).fontSize) / k;
      if (fs < 6.4 - 0.02) bad.txt.push((el.className || el.tagName) + '@' + fs.toFixed(1));
    });
    document.querySelectorAll('#seats .seat').forEach(function (s, i) {
      const r = s.querySelector('.seat-in').getBoundingClientRect();
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)
        bad.seat.push(i + ':' + [r.left, r.right, r.top, r.bottom].map(Math.round).join(','));
    });
    document.querySelectorAll('#table .trick-slot').forEach(function (s, i) {
      const r = s.getBoundingClientRect();
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)
        bad.slot.push(String(i));
    });
    document.querySelectorAll('#hand .hc').forEach(function (h, i) {
      const r = h.getBoundingClientRect();
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)
        bad.hand.push(i + ':' + [r.left, r.right, r.top, r.bottom].map(Math.round).join(','));
    });
    /* 舞台之外的界面文字 ≥ 12px（卡片是缩微画、#fx 是世界单位特效层，都不在此列） */
    document.querySelectorAll('body *').forEach(function (el) {
      if (el.closest('#stage') || el.closest('.card') || el.closest('#fx')) return;
      let direct = false;
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && n.textContent.trim()) { direct = true; break; }
      }
      if (!direct) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (el.closest('.hidden, .off')) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12 - 0.01) bad.chrome.push((el.className || el.id || el.tagName) + '@' + fs.toFixed(1));
    });
    const tb = document.querySelector('#topbar');
    /* 折行与否看顶栏各件「垂直中心」散不散：同一行里高度不同的件（14px 文字 / 药丸 / 带内边距按钮）
       顶边能差好几像素，但中心都贴着行中线；折行时两排中心会差出整整一行（~43px） */
    const cs = [].map.call(tb.children, function (e) {
      const r = e.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const tbSpan = cs.length > 1 ? Math.max.apply(null, cs) - Math.min.apply(null, cs) : 0;
    return { bad: bad, k: k, tbOver: tb.scrollWidth - tb.clientWidth, tbSpan: +tbSpan.toFixed(1),
             tbText: tb.innerText.replace(/\s+/g, ' ').trim() };
  });
  ok(tag + '：舞台内的字都 ≥ 6.4 世界单位', g.bad.txt.length === 0);
  g.bad.txt.slice(0, 8).forEach(x => console.log('      · 小字：' + x));
  ok(tag + '：座位芯片都待在舞台里', g.bad.seat.length === 0);
  g.bad.seat.slice(0, 6).forEach(x => console.log('      · 越界座位：' + x));
  ok(tag + '：墩位都在舞台里', g.bad.slot.length === 0);
  ok(tag + '：手牌都在舞台里', g.bad.hand.length === 0);
  g.bad.hand.slice(0, 4).forEach(x => console.log('      · 越界手牌：' + x));
  ok(tag + '：舞台外的界面文字都 ≥ 12px', g.bad.chrome.length === 0);
  g.bad.chrome.slice(0, 8).forEach(x => console.log('      · 小字：' + x));
  ok(tag + '：顶栏在 390px 下不横向溢出（' + g.tbOver + 'px：' + g.tbText + '）', g.tbOver <= 1);
  /* 折行时 scrollWidth 反而等于 clientWidth，溢出检查看不见它 —— 补一条「都在同一行」 */
  ok(tag + '：顶栏各件不折行（垂直中心跨度 ' + g.tbSpan + 'px）', g.tbSpan <= 14);
  return g;
}

/* ---------- 计分榜抽屉：逐格 = scoreTable ---------- */
async function assertScorebox(page, tag) {
  await page.click('#btnScore');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const S = window.WZUI.state(), WZ = window.WZ;
    const tbl = WZ.scoreTable(S), bad = [];
    const rows = document.querySelectorAll('#scoreBody tbody tr');
    if (rows.length !== tbl.rounds.length) bad.push('榜行数 ' + rows.length + ' ≠ ' + tbl.rounds.length);
    tbl.rounds.forEach(function (rd, i) {
      const tr = rows[i];
      if (!tr) return;
      if (tr.querySelector('th').textContent !== '第 ' + rd.r + ' 轮') bad.push('第 ' + i + ' 行轮次 ≠ ' + rd.r);
      if (rd.pts === null) {
        if (!tr.querySelector('.bd-live')) bad.push('第 ' + rd.r + ' 轮（进行中）没标出来');
        return;
      }
      const cells = tr.querySelectorAll('.bd-pts');
      if (cells.length !== S.N) { bad.push('第 ' + rd.r + ' 轮格数 ' + cells.length + ' ≠ ' + S.N); return; }
      rd.pts.forEach(function (p, j) {
        const want = (p > 0 ? '+' : '') + p;
        if (cells[j].textContent !== want) bad.push('第 ' + rd.r + ' 轮第 ' + j + ' 格 ' + cells[j].textContent + ' ≠ ' + want);
      });
    });
    const foot = [].map.call(document.querySelectorAll('#scoreBody tfoot td'), n => n.textContent);
    tbl.totals.forEach(function (t, i) {
      if (foot[i] !== String(t)) bad.push('总分列第 ' + i + ' 格 ' + foot[i] + ' ≠ ' + t);
    });
    return bad;
  });
  ok(tag + '：计分榜逐格 = WZ.scoreTable', r.length === 0);
  r.slice(0, 8).forEach(x => console.log('      · ' + x));
  await page.click('#scoreClose');
  await page.waitForTimeout(120);
}

/* ---------- 指纹：引擎状态 + rng 状态（A/B 逐字节） ---------- */
function fingerprint(page) {
  return page.evaluate(() => {
    const sv = window.WZUI.save() || {};
    return JSON.stringify({ S: window.WZUI.state(), rng: sv.rng });
  });
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS);
  const browser = await chromium.launch();
  try {
    /* ---------- 1. 封面 / 规则 / 名单 ---------- */
    if (section('封面 / 规则 / 名单')) {
      const page = await open(browser);
      ok('开局停在封面', await page.locator('#screen-menu.on').count() === 1);
      await page.waitForTimeout(260);                 /* 等封面入场动画（≤450ms）落定再拍 */
      await shot(page, '00-menu');
      await page.click('#btnRules');
      await page.waitForTimeout(220);
      ok('规则弹层能打开', await page.locator('#rules.on').count() === 1);
      await shot(page, '00b-rules');
      await page.click('#rulesClose');
      await page.waitForTimeout(150);
      ok('规则弹层能关闭', await page.locator('#rules.on').count() === 0);

      await page.click('#btnStart');
      await page.waitForTimeout(250);
      ok('进名单，默认 4 人', await page.locator('#screen-setup.on').count() === 1 &&
        await page.locator('#roster .roster-row').count() === 4);
      await page.locator('#cntSeg .seg-btn').first().click();       // 3 人
      await page.waitForTimeout(200);
      const foot = await page.locator('#menuFoot').textContent();
      ok('切到 3 人：名单跟着变、脚注点了「20 轮」（' + foot + '）',
        await page.locator('#roster .roster-row').count() === 3 &&
        foot.indexOf('3 人局') >= 0 && foot.indexOf('20 轮') >= 0);
      await page.fill('#inpName', '阿星');
      /* 先 blur：不然点帽子时那一 blur 会触发 change → 名单重画，
         mousedown/mouseup 分落在两个节点上，这一下点击直接被吞掉 */
      await page.locator('#inpName').blur();
      await page.waitForTimeout(180);
      await page.locator('#avRow .sw').nth(2).click();
      await page.waitForTimeout(200);
      ok('选中的巫师帽唯一高亮', await page.locator('#avRow .sw.on').count() === 1 &&
        await page.locator('#avRow .sw').nth(2).getAttribute('class') === 'sw on');
      const roster = await page.evaluate(() => [].map.call(document.querySelectorAll('#roster .roster-row'), r => ({
        name: r.querySelector('.rr-name').textContent,
        tag: r.querySelector('.rr-tag').textContent,
        hat: !!r.querySelector('.rr-hat svg'),
      })));
      ok('名单第一行是自己、其余是 AI（' + roster.map(r => r.name + '/' + r.tag).join(' · ') + '）',
        roster.length === 3 && roster[0].name === '阿星' && roster[0].tag === '你' &&
        roster[1].name === '学徒' && roster[2].name === '术士' && roster.every(r => r.hat));
      await shot(page, '00c-setup');
      ok('名单阶段就落盘（stage=setup）',
        await page.evaluate(() => (window.WZUI.save() || {}).stage) === 'setup');
      /* 名单上改窗口：游戏屏还是 display:none，fitStage 不许照着 0×0 量出个 0.2 来 */
      await page.setViewportSize({ width: 390, height: 800 });
      await page.waitForTimeout(280);
      const rz = await page.evaluate(() => ({
        k: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')),
      }));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(280);
      ok('名单上改窗口不把 --k 钳坏（--k ' + rz.k.toFixed(2) + '）', rz.k > 0.5);
      await page.click('#btnSetupBack');
      await page.waitForTimeout(200);
      ok('名单能返回封面', await page.locator('#screen-menu.on').count() === 1);
      await page.close();
    }

    /* ---------- 1b. 音效：解锁 + 挂起后自己醒 ---------- */
    if (section('音效解锁')) {
      const page = await open(browser, { audio: true });
      const sp = () => page.evaluate(() => ({
        osc: window.__osc || 0,
        state: window.__ctx ? window.__ctx.state : 'none',
      }));
      const s0 = await sp();
      ok('没触摸过就不建 AudioContext（' + s0.state + '）', s0.state === 'none' && s0.osc === 0);
      await page.click('#btnStart');
      await page.waitForTimeout(250);
      const s1 = await sp();
      ok('第一次点按解锁并出声（osc ' + s1.osc + '）', s1.osc > 0);
      /* suspend 等价于锁屏 / 来电 / 切后台 —— 只在 boot 里解锁的话，此后就是永久静音 */
      await page.evaluate(() => window.__ctx.suspend());
      await page.waitForTimeout(150);
      await page.locator('#cntSeg .seg-btn').nth(1).click();
      await page.waitForTimeout(300);
      const s2 = await sp();
      ok('挂起后下一次操作自己醒过来并补上这一发（osc ' + s1.osc + ' → ' + s2.osc + '）', s2.osc > s1.osc);
      ok('音效一节零报错', page.__errs.length === 0);
      page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 2. 四人一局走完 + 逐轮对账 ---------- */
    if (section('四人一局走完 + 逐轮对账')) {
      const page = await open(browser, { q: '?n=4&seed=42&fast=1' });
      await page.click('#btnStart');
      await page.waitForTimeout(220);
      ok('dev 参数把名单定成 4 人', await page.locator('#roster .roster-row').count() === 4);
      await page.click('#btnBegin');
      await page.waitForTimeout(700);                 /* 发牌中段 */
      await shot(page, '01-deal');
      await page.click('#btnSpeed');                  /* 3 倍速：整局走查不磨叽（加速只许改演出） */
      await page.waitForTimeout(200);
      ok('进了对局屏且顶栏已经写着轮次与张数',
        await page.locator('#screen-game.on').count() === 1 &&
        /^第 \d+\/\d+ 轮$/.test(await page.locator('#tbRound').textContent()));

      let firstTurnShot = false, clusterShot = false;
      const acts = await driveGame(page, 420000, {
        onBid: async (p, a) => {
          /* 最后一轮手牌最多（15 张）：扇面边界 + 顶栏最宽一刻（两位数轮次 + 彩色药丸）
             都趁这时候量，别让「手牌都在舞台里」「顶栏不折行」两条断言永远只见过小牌量 */
          const s = await st(p);
          if (s.round === s.rounds) await assertGeometry(p, '第 ' + s.round + ' 轮满手牌（' + s.k + ' 张）');
          if (a.bid > 0) return;
          const r = await p.evaluate(() => ({ k: window.WZUI.state().k, chips: document.querySelectorAll('#bidChips .bid-chip').length }));
          ok('预判面板给出 0 ~ ' + r.k + ' 共 ' + (r.k + 1) + ' 颗筹码（实际 ' + r.chips + ' 颗）', r.chips === r.k + 1);
          await p.waitForTimeout(240);     /* 等面板入场动画（riseIn .2s）落定再拍，别拍下残影 */
          await shot(p, '02-bid');
        },
        onMyTurn: async (p, a) => {
          if (!firstTurnShot) {
            firstTurnShot = true;
            const r = await p.evaluate(() => {
              const S = window.WZUI.state(), WZ = window.WZ;
              const legal = WZ.legalPlays(S, 0);
              const hcs = [].map.call(document.querySelectorAll('#hand .hc'), n => +n.dataset.id);
              const lit = [].map.call(document.querySelectorAll('#hand .hc.playable'), n => +n.dataset.id);
              return {
                hand: S.players[0].hand.slice().sort((x, y) => x - y), hcs: hcs, legal: legal, lit: lit,
                locked: document.querySelectorAll('#hand .hc.locked').length,
                hint: document.querySelector('#followHint').classList.contains('off') ? 'off' : document.querySelector('#fhColor').textContent,
              };
            });
            ok('手牌张数 = 引擎手牌（' + r.hcs.length + ' 张）', r.hcs.length === r.hand.length);
            ok('手牌与引擎同序（sortHand）', JSON.stringify(r.hcs) === JSON.stringify(r.hand));
            ok('亮着可出的牌 = 引擎合法出牌（' + r.lit.length + ' / ' + r.legal.length + '）',
              JSON.stringify(r.lit.slice().sort((x, y) => x - y)) === JSON.stringify(r.legal.slice().sort((x, y) => x - y)));
            ok('不可出的牌 = 手牌 − 可出（' + r.locked + ' 张，跟色提示「' + r.hint + '」）',
              r.locked === r.hand.length - r.legal.length);
            await assertScorebox(p, '第 1 轮开局');
            await shot(p, '03-my-turn');
            return;
          }
          /* 打出过至少一张后：剩余手牌必须收拢成等距扇形、并重新居中 ——
             曾经的 bug 是「原位不动，原来那张的坑还空着」。等 k≥3 的轮次里
             自己第二手时测（n = k−1 ≥ 2）；每局只测一次。 */
          if (clusterShot) return;
          const c = await p.evaluate(() => {
            const S = window.WZUI.state();
            const n = S.players[0].hand.length;
            if (n < 2 || n >= S.k) return null;          /* 还没打出去 / 已经换轮重新发牌 */
            const hcs = [].slice.call(document.querySelectorAll('#hand .hc'));
            if (hcs.length !== n) return { bad: 'DOM 手牌 ' + hcs.length + ' 张 ≠ 引擎 ' + n + ' 张' };
            const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k'));
            const xs = hcs.map(function (el) {
              const ts = getComputedStyle(el).transform;
              const m = (!ts || ts === 'none') ? new DOMMatrix() : new DOMMatrix(ts);
              return m.m41 / k;                          /* 还原成世界坐标（牌左缘 − 半宽 23） */
            });
            return { n: n, xs: xs };
          });
          if (!c) return;
          clusterShot = true;
          if (c.bad) { ok('打出后剩余手牌收拢：' + c.bad, false); return; }
          const CW = 46;
          const want = Math.min(30, (300 - CW) / (c.n - 1));   /* c.n ≥ 2，除以 0 不会发生 */
          const gaps = c.xs.slice(1).map((x, i) => x - c.xs[i]);
          const dev = Math.max.apply(null, gaps.map(g => Math.abs(g - want)));
          const mid = c.xs.reduce((s, x) => s + x, 0) / c.n;
          ok('打出一张后剩余 ' + c.n + ' 张收拢成等距扇形（间距应 ' + want.toFixed(1) + '，实测最大偏差 ' + dev.toFixed(2) + 'px）', dev <= 1.5);
          ok('收拢后的扇形重新居中于舞台（中线实测 ' + mid.toFixed(1) + ' / 应为 ' + (180 - CW / 2) + '）', Math.abs(mid - (180 - CW / 2)) <= 2);
          await shot(p, '03b-hand-cluster');
        },
        onSum: async (p, a) => {
          await assertSummary(p, '第 ' + (await p.evaluate(() => window.WZUI.state().round)) + ' 轮对账');
          if (a.sum === 0) await shot(p, '04-round-summary');
          if (a.sum === 1 && await p.locator('#sumRows .sum-row.exact').count()) await shot(p, '04b-summary-hit');
        },
      });
      ok('4 人 15 轮整局打完（预判 ' + acts.bid + ' 次 / 出牌 ' + acts.play + ' 次 / 对账 ' + acts.sum + ' 次' +
        (acts.mis ? ' · 点偏重试 ' + acts.mis + ' 次' : '') + '）',
        acts.bad.length === 0 && acts.sum === 15);
      acts.bad.slice(0, 4).forEach(x => console.log('      · ' + x));
      const fin = await st(page);
      ok('终局屏摊开', fin.over && fin.phase === 'over');
      /* 名次逐行滚动是挂在 fx 时钟上的，机器忙时走得比墙钟慢 —— 等「行数到齐、
         每行分数停在引擎总分上」再拍，别拿一个固定毫秒数赌它演完了 */
      const wantTotals = await page.evaluate(() => window.WZ.rank(window.WZUI.state()).map(r => String(r.total)));
      const settled = await waitFor(page, 20000, exp => {
        const rows = document.querySelectorAll('#rankList .rank-row');
        if (rows.length !== exp.length) return false;
        return [].every.call(rows, (r, i) => r.querySelector('.rk-score').textContent === exp[i]);
      }, wantTotals);
      if (!settled) console.log('      · 终局名次 20s 没落定：只摊出 ' +
        await page.evaluate(() => document.querySelectorAll('#rankList .rank-row').length) + ' 行');
      await page.waitForTimeout(250);                 /* 最后一行分数停下后的收尾余量 */
      await shot(page, '05-final');
      const rk = await page.evaluate(() => {
        const S = window.WZUI.state(), WZ = window.WZ;
        const eng = WZ.rank(S);
        const rows = [].map.call(document.querySelectorAll('#rankList .rank-row'), r => ({
          place: r.querySelector('.rk-place').textContent,
          name: r.querySelector('.rk-name').textContent,
          score: r.querySelector('.rk-score').textContent,
          champ: r.classList.contains('champ'),
        }));
        const boardRows = document.querySelectorAll('#overBoard tbody tr').length;
        const foot = [].map.call(document.querySelectorAll('#overBoard tfoot td'), n => n.textContent);
        return { rows: rows, champN: document.querySelectorAll('#rankList .rank-row.champ').length,
          eng: eng.map(r => ({ name: S.players[r.pid].name, total: r.total, place: r.place, tied: r.tied })),
          boardRows: boardRows, histN: S.hist.length, foot: foot,
          totals: WZ.scoreTable(S).totals };
      });
      ok('排名行数 = 人数', rk.rows.length === rk.eng.length);
      ok('排名逐行 = WZ.rank（' + rk.rows.map(r => r.place + ':' + r.name + ' ' + r.score).join(' · ') + '）',
        rk.rows.every((r, i) => r.name === rk.eng[i].name && +r.score === rk.eng[i].total &&
          r.place === String(rk.eng[i].place) + (rk.eng[i].tied ? '=' : '')));
      ok('冠军行只有一条且排在最前', rk.champN === 1 && rk.rows[0].champ);
      ok('终局计分榜列全 ' + rk.histN + ' 轮', rk.boardRows === rk.histN);
      ok('终局总分列 = 引擎总分（屏幕 ' + rk.foot.join('/') + ' · 引擎 ' + rk.totals.join('/') + '）',
        JSON.stringify(rk.foot) === JSON.stringify(rk.totals.map(String)));
      ok('日志里没有一条不变量报错',
        await page.evaluate(() => window.WZUI.log().filter(e => e.k === 'err').length) === 0);
      /* 「再来一局」照旧回到名单且名字还在 */
      await page.click('#btnAgain');
      await page.waitForTimeout(400);
      ok('再来一局回到对局屏第 1 轮', await page.locator('#screen-game.on').count() === 1 &&
        await page.evaluate(() => window.WZUI.state().round) === 1);
      ok('整局零 pageerror / console 报错', page.__errs.length === 0);
      page.__errs.slice(0, 8).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 3. 六人局版面（座位最挤的一档） ---------- */
    if (section('六人局版面')) {
      const page = await open(browser, { q: '?n=6&seed=7&fast=1' });
      await page.click('#btnStart');
      await page.waitForTimeout(220);
      ok('dev 参数把它定成 6 人', await page.locator('#roster .roster-row').count() === 6);
      await page.click('#btnBegin');
      /* 第 1 轮的指示牌可能先冒出「巫师 → 先手选色」；两个面板都可能是第一个关口 */
      await waitFor(page, 20000, () => !!document.querySelector('#bidpanel.on, #trumppanel.on'));
      await page.evaluate(() => {
        document.querySelector('#bidpanel').classList.remove('on');
        document.querySelector('#trumppanel').classList.remove('on');
      });
      await page.waitForTimeout(200);
      ok('六人局有 6 个座位芯片 / 6 个墩位', await page.locator('#seats .seat').count() === 6 &&
        await page.locator('#table .trick-slot').count() === 6);
      await assertGeometry(page, '六人局');
      await shot(page, '06-six-seats');
      ok('六人局零报错', page.__errs.length === 0);
      page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 4. 存档 / 日志 / 刷新续玩 ---------- */
    if (section('存档 / 日志 / 刷新续玩')) {
      const page = await open(browser, { q: '?n=4&seed=99&fast=1', audio: true });
      ok('本地还没有存档', await page.evaluate(() => window.WZUI.save()) === null);
      await page.click('#btnStart');
      await page.waitForTimeout(220);
      await page.click('#btnBegin');
      await page.waitForTimeout(300);
      ok('开桌后进了对局屏', await page.locator('#screen-game.on').count() === 1);

      /* 先把第 1 轮打完、停在「对账」那一刻：结果必须先落盘、再开演。
         代打在这里不许点确认 —— 要的正是「对账摊着还没确认」的存档。 */
      const acts1 = await driveGame(page, 90000, { stopWhen: s => s.sum && s.hist === 1 });
      ok('第 1 轮打到对账（预判 ' + acts1.bid + ' 次 / 出牌 ' + acts1.play + ' 次）',
        acts1.bad.length === 0 && acts1.sum === 0);
      const sv1 = await page.evaluate(() => window.WZUI.save());
      ok('对账摊开时已经是 stage=show', sv1 && sv1.stage === 'show');
      ok('落盘的快照里已经有这一轮的结果（hist ' + (sv1 && sv1.S.hist.length) + ' 条）',
        sv1 && sv1.S.hist.length === 1 && sv1.S.round === 1);
      ok('落盘的快照通过不变量检查',
        await page.evaluate(s => window.WZ.validate(s).ok, sv1.S));
      const sum1 = await page.evaluate(() => ({
        rows: document.querySelectorAll('#sumRows .sum-row').length,
        title: document.querySelector('#sumTitle').textContent,
      }));
      await page.reload();
      await page.waitForTimeout(800);
      const back = await page.evaluate(() => {
        const S = window.WZUI.state();
        return { game: !!document.querySelector('#screen-game.on'),
          menu: !!document.querySelector('#screen-menu.on'),
          sum: !!document.querySelector('#summary.on'),
          rows: document.querySelectorAll('#sumRows .sum-row').length,
          title: document.querySelector('#sumTitle').textContent,
          round: S.round, hist: S.hist.length, scores: S.players.map(p => p.score),
          ok: window.WZ.validate(S).ok };
      });
      ok('刷新后没掉回封面，直接续在对账这一格', back.game && !back.menu);
      ok('刷新后对账卡原样摊回来（' + back.title + '，' + back.rows + ' 行）',
        back.sum && back.rows === sum1.rows && back.title === sum1.title);
      ok('刷新不重演也不重复计分（hist 仍是 1 条，总分 ' + back.scores.join('/') + '）',
        back.hist === 1 && back.round === 1 && back.ok);

      /* 确认 → 第 2 轮 → 停在自己出牌那一刻，再刷新一次（确认这一下交给代打） */
      const acts2 = await driveGame(page, 90000, {
        stopWhen: s => s.round === 2 && s.phase === 'play' && s.turn === 0 && s.playable > 0,
      });
      ok('第 2 轮轮到自己出牌（墩 ' + (await st(page)).k + ' 张）', acts2.bad.length === 0);
      acts2.bad.slice(0, 4).forEach(x => console.log('      · ' + x));
      const mid = await page.evaluate(() => {
        const S = window.WZUI.state();
        return { round: S.round, scores: S.players.map(p => p.score), hand: S.players[0].hand.slice().sort((a, b) => a - b),
          deck: S.deck.length, table: S.table.length, bidQueue: S.bidQueue.length };
      });
      await page.reload();
      await page.waitForTimeout(800);
      const mid2 = await page.evaluate(() => {
        const S = window.WZUI.state();
        return { round: S.round, scores: S.players.map(p => p.score), hand: S.players[0].hand.slice().sort((a, b) => a - b),
          deck: S.deck.length, table: S.table.length, ok: window.WZ.validate(S).ok,
          playable: document.querySelectorAll('#hand .hc.playable').length,
          sameUI: document.querySelectorAll('#hand .hc').length };
      });
      ok('轮中刷新：轮次/总分/手牌/牌堆一点不差',
        mid2.round === mid.round && JSON.stringify(mid2.scores) === JSON.stringify(mid.scores) &&
        JSON.stringify(mid2.hand) === JSON.stringify(mid.hand) && mid2.deck === mid.deck && mid2.ok);
      ok('轮中刷新后手牌又亮起来、接着打（' + mid2.playable + ' 张可出）',
        mid2.playable > 0 && mid2.sameUI === mid.hand.length);
      await assertGeometry(page, '续玩后');
      await shot(page, '07-resume-mid');

      /* 日志：倒序、跨刷新保留、能清空 */
      await page.click('#btnLog');
      await page.waitForTimeout(240);
      /* 刷新续玩不经过菜单、上下文从没建过 —— 第一发手势音必须能把音频补活（以前整段是哑的） */
      const snd = await page.evaluate(() => ({
        osc: window.__osc || 0, state: window.__ctx ? window.__ctx.state : 'none',
      }));
      ok('刷新续玩后第一发手势音补活音频（osc ' + snd.osc + '，' + snd.state + '）',
        snd.osc > 0 && snd.state === 'running');
      ok('日志面板能打开', await page.locator('#logbox.on').count() === 1);
      const rows = await page.locator('#logBody .log-row').count();
      ok('日志里有内容（' + rows + ' 行）', rows >= 8);
      const newest = await page.evaluate(() => { const l = window.WZUI.log(); return l[l.length - 1].s; });
      const firstRow = (await page.locator('#logBody .log-row').first().textContent()) || '';
      ok('日志是倒序（第一条就是最新那条）', firstRow.indexOf(newest) >= 0);
      ok('刷新续玩也记进了日志',
        await page.evaluate(() => window.WZUI.log().some(e => e.s.indexOf('读档') >= 0)));
      await shot(page, '08-logbox');
      await page.click('#logClose');
      await page.waitForTimeout(150);
      /* 清空存档并回到封面 */
      await page.click('#btnLog');
      await page.waitForTimeout(200);
      await page.click('#logWipe');
      await page.waitForTimeout(300);
      ok('清空存档并回封面', await page.locator('#screen-menu.on').count() === 1 &&
        await page.evaluate(() => window.WZUI.save()) === null);
      await page.reload();
      await page.waitForTimeout(500);
      ok('存档清掉后刷新停在封面（不诈尸）', await page.locator('#screen-menu.on').count() === 1);
      ok('存档 / 日志这一段零报错', page.__errs.length === 0);
      page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 5. 演出速度不改变游戏状态（同种子 A/B，各打三轮） ---------- */
    if (section('快进 / 正常 一致（同种子三轮）')) {
      const run = async (fast) => {
        const page = await open(browser, { q: '?n=3&seed=1234' + (fast ? '&fast=1' : '') });
        await page.click('#btnStart');
        await page.waitForTimeout(200);
        await page.click('#btnBegin');
        if (!fast) await page.click('#btnSpeed');       /* 3 倍速 = 「快进」档 */
        await page.waitForTimeout(200);
        /* 停在「第 3 轮对账摊开」这一刻取指纹：endRound 已跑完、rng 停在确定位置，
           此刻页面在等确认、不会再动引擎（停 maxSum 会撞上下一轮洗牌的时间差）。 */
        const acts = await driveGame(page, 240000, { stopWhen: s => s.sum && s.hist === 3 });
        const fp = await fingerprint(page);
        const round = (await st(page)).round;
        const errs = page.__errs.slice();
        await page.close();
        return { fp, acts, round, errs };
      };
      const a = await run(false);                        /* 3 倍速「快进」 */
      const b = await run(true);                         /* fast=1：表演间隔压到最短 */
      ok('两次都停在同一格（第 ' + a.round + ' / ' + b.round + ' 轮对账）', a.round === b.round && a.round === 3);
      ok('两次做了同样次数的动作（预 ' + a.acts.bid + '/' + b.acts.bid + '，出 ' +
        a.acts.play + '/' + b.acts.play + '，对账 ' + a.acts.sum + '/' + b.acts.sum + '）',
        a.acts.bid === b.acts.bid && a.acts.play === b.acts.play && a.acts.sum === b.acts.sum);
      ok('两次都没有报错', a.errs.length === 0 && b.errs.length === 0);
      a.errs.slice(0, 4).forEach(e => console.log('      · 演出: ' + e));
      b.errs.slice(0, 4).forEach(e => console.log('      · 快进: ' + e));
      ok('演出速度不改变任何游戏状态与 rng（引擎指纹逐字节相同）', a.fp === b.fp);
      if (a.fp !== b.fp) {
        const x = JSON.parse(a.fp), y = JSON.parse(b.fp);
        console.log('      · S  演出 ' + JSON.stringify(x.S).slice(0, 160));
        console.log('      · S  快进 ' + JSON.stringify(y.S).slice(0, 160));
        console.log('      · rng ' + JSON.stringify(x.rng) + ' vs ' + JSON.stringify(y.rng));
      }
    }

    /* ---------- 6. 静默演出（reduced-motion）：6 人局最短，整局只要 55 墩 ---------- */
    if (section('静默演出 / reduced-motion')) {
      const page = await open(browser, { q: '?n=6&seed=5&fast=1', reduced: true });
      ok('reduced-motion 下启动即静默', (await page.evaluate(() => window.WZUI.fxOn())) === false);
      await page.click('#btnStart');
      await page.waitForTimeout(200);
      await page.click('#btnBegin');
      await page.waitForTimeout(300);
      const acts = await driveGame(page, 300000, {
        onSum: async (p, a) => { if (a.sum === 1) await assertSummary(p, '静默第 1 轮对账'); },
      });
      const fin = await st(page);
      ok('静默模式能走完整局（' + acts.sum + ' 轮）', fin.over && acts.bad.length === 0);
      acts.bad.slice(0, 3).forEach(x => console.log('      · ' + x));
      ok('静默整局零报错', page.__errs.length === 0);
      page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
