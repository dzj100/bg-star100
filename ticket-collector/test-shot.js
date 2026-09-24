/* 《车票收藏家》端到端走查。运行：node test-shot.js
   390×844 手机视口，走完一次 3 人一局，逐阶段截图到 shots/，收集 pageerror / console 报错。

   一条核心断言：每一轮边界上「屏幕上的数字」必须等于「引擎里的数字」。
   检查加速只许改「看到什么」，不许改「发生什么」—— 同一颗种子下，
   正常演出跑完一轮与一路快进跑完一轮，状态指纹必须逐字节相同。 */
'use strict';
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const SHOTS = path.join(DIR, 'shots');
const PAGE = pathToFileURL(path.join(DIR, 'index.html')).href;
const SEED = 20240922;

let pass = 0, fail = 0;
const fails = [];
function ok(msg, cond) {
  if (cond) pass++;
  else { fail++; fails.push(msg); console.log('  ✗ ' + msg); }
}
const ONLY = process.env.TC_ONLY || '';            /* node 前设 TC_ONLY=存档 可只跑标题含该串的段落 */
function section(t) {
  const go = !ONLY || t.indexOf(ONLY) >= 0;
  if (go) console.log('\n== ' + t + ' ==');
  return go;
}

/* 冻结时钟 → 同一颗种子；Math.random 只被装修饰性粒子用，同样钉死免得每跑一次都不一样 */
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

/* reduced:true 必须在 goto 之前设好 —— render.js 的 boot() 在页面加载时
   读一次 matchMedia 就定下 fxOn，加载完再 emulateMedia 已经晚了。 */
async function open(browser, opt) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    const t = m.type();
    if (t === 'error' || t === 'warning') errs.push(t + ': ' + m.text());
  });
  if (opt && opt.reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(FREEZE, SEED);
  /* 音效探针：数 createOscillator 的次数 —— 「有没有真的合成出声」只能这样量。
     play 吞掉全部异常，静默失败在 assert 里必须能看见（见 SPEC §6 音效同步）。 */
  if (opt && opt.audio) {
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
  await page.goto(PAGE);
  await page.waitForTimeout(300);
  page.__errs = errs;
  return page;
}

/* 截图。Windows 上旧图可能正被看图/预览进程占着句柄（报 UNKNOWN -4094），
   所以先重试几次，还写不进去就换个名字，绝不让一张图把整轮走查带崩。 */
async function shot(page, name) {
  const file = path.join(SHOTS, name + '.png');
  for (let i = 0; i < 4; i++) {
    try { return await page.screenshot({ path: file }); }
    catch (e) { await page.waitForTimeout(250); }
  }
  try { return await page.screenshot({ path: path.join(SHOTS, name + '-b.png') }); }
  catch (e) { console.log('      · 截图 ' + name + ' 写不进去：' + e.message); }
}
const S = page => page.evaluate(() => {
  const s = window.TC_UI.state();
  return { phase: s.phase, round: s.round, resolved: s.resolved, pool: s.pool, lastRound: s.lastRound, N: s.N };
});

/* 轮询一个页面内条件，超时返回 false。回调在页面里跑，别引用外面。 */
async function waitFor(page, ms, fn, arg) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() - t0 >= ms) return false;
    await page.waitForTimeout(100);
  }
}
/* 下一轮的传手机遮罩出现 = 上一轮结算演出彻底跑完（pickAll 在 animResolve 之后）；
   结算页出现 = 整局结束。两者都是干净的轮次边界，不靠猜时间。 */
const atBoundary = () => !!(document.querySelector('#curtain.on') || document.querySelector('#screen-over.on'));
/* 结算演完到下一轮之间还夹着一格「本轮战报」：它是流程的一半 —— 确认之后才散场
   （回站台 + 补票 + 下一轮），不点就永远等不到边界。所以「等边界」的页面谓词一律
   带上它，见着就点掉，别让整段测试停在那一格上。 */
const atSummary = () => !!document.querySelector('#summary.on');
async function toBoundary(page, ms) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(atBoundary)) return true;
    if (await page.evaluate(atSummary)) {             // 战报摊着：点掉它，接着等
      await page.click('#sumOk');
      await page.waitForTimeout(80);
      continue;
    }
    if (Date.now() - t0 >= ms) return false;
    await page.waitForTimeout(100);
  }
}

/* ---------- 屏幕数字 ↔ 引擎状态 对账 ---------- */
async function assertBoard(page, tag) {
  const r = await page.evaluate(() => {
    const s = window.TC_UI.state(), TC = window.TC;
    const bad = [];
    const v = TC.validate(s);
    if (!v.ok) bad.push('守恒: ' + v.errs.join('; '));
    const pool = TC.poolLeft(s);
    if (document.querySelector('#tbPool').textContent !== '票池 ' + pool) bad.push('HUD 票池 ≠ ' + pool);
    if (document.querySelector('#tbRound').textContent !== '第 ' + s.round + ' 轮') bad.push('HUD 轮次 ≠ ' + s.round);
    const figs = window.TC_UI.figs();
    const pkBadges = document.querySelectorAll('#packs .pk-badge');
    const lkBadges = document.querySelectorAll('#lockers .lk-badge');
    const lkNums = document.querySelectorAll('#lockers .li-n');
    /* 数字比对：屏幕上的徽章可能写成「7」也可能带单位，一律只取数字再比 */
    const chk = function (label, txt, want) {
      const got = String(txt).replace(/\D/g, '');
      if (got !== String(want) && !(want === 0 && got === '')) bad.push(label + ' 显示 ' + got + ' ≠ ' + want);
    };
    s.players.forEach(function (p, i) {
      const bag = TC.total(p.bag), lk = TC.total(p.locker);
      chk(p.name + ' 背包徽章', pkBadges[i].textContent, bag);
      chk(p.name + ' 柜子徽章', lkBadges[i].textContent, lk);
      chk(p.name + ' 柜内张数', lkNums[i] ? lkNums[i].textContent : '', lk);
      if (figs[i].p !== p) bad.push(p.name + ' 角色与玩家错位');
    });
    const roofs = document.querySelectorAll('.roof-total');
    const carNodes = document.querySelectorAll('.coach-car');
    s.cars.forEach(function (c, i) {
      chk(i + ' 号车顶', roofs[i].textContent, TC.total(c.tickets));
      /* 关门与「已放完」都是本轮状态：屏幕上的类必须和引擎里的旗标一致，
         而且上一轮贴上的类要能自己掉下来（曾经只 add 不 remove，关过一次的车一直熄灯） */
      if (carNodes[i].classList.contains('closed') !== !!c.closed) bad.push((i + 1) + ' 号车 无人光顾样式与状态不符');
      if (carNodes[i].classList.contains('short') !== !!c.short) bad.push((i + 1) + ' 号车 已放完样式与状态不符');
    });
    return bad;
  });
  ok(tag + '：屏幕与引擎一致', r.length === 0);
  r.slice(0, 6).forEach(x => console.log('      · ' + x));
}

/* ---------- 选择策略：每 3 位乘客轮着试一遍三个动作 ---------- */
async function doPick(page, k) {
  const btns = page.locator('#hudBtns .btn');
  const chips = page.locator('#hudList .chip-btn');
  let picked = false;
  const want = k % 3;
  if (want === 1) {                                  // 顺走
    if (!(await btns.nth(2).isDisabled())) {
      await btns.nth(2).click();
      if (await chips.count()) { await chips.first().click(); picked = true; }
    }
  } else if (want === 2) {                           // 存放
    if (!(await btns.nth(1).isDisabled())) { await btns.nth(1).click(); picked = true; }
  }
  if (!picked) {                                     // 兜底：选车厢
    await btns.nth(0).click();
    const n = await chips.count();
    await chips.nth(n ? k % n : 0).click();
  }
  const go = page.locator('#hudBtns .btn').nth(3);
  ok('提交按钮可用', !(await go.isDisabled()));
  await go.click();
}

/* 全员提交后的结算闸门：HUD 上只剩一颗【开始结算】，不点就不开演。
   返回是否真的点到（没摆出闸门 = 这一轮没走到头）。 */
async function clickSettle(page) {
  if (!(await waitFor(page, 20000, () => !!document.querySelector('#btnSettle')))) return false;
  await page.click('#btnSettle');
  await page.waitForTimeout(80);
  return true;
}

/* 按剧本走完一整轮选择：spec[i] 是第 i 位乘客怎么选 —— 数字 = 上第几节车厢，'store' = 存放。
   按座位顺序等遮罩、选、提交；收尾点掉闸门（不点的话这一轮永远停在选择阶段）。 */
async function pickRound(page, spec) {
  for (let i = 0; i < spec.length; i++) {
    if (!(await waitFor(page, 40000, () => !!document.querySelector('#curtain.on')))) return false;
    await page.click('#curtainOk');
    await page.waitForTimeout(90);
    const want = spec[i];
    if (want === 'store') await page.locator('#hudBtns .btn').nth(1).click();
    else {
      await page.locator('#hudBtns .btn').nth(0).click();
      await page.locator('#hudList .chip-btn').nth(want).click();
    }
    await page.locator('#hudBtns .btn').nth(3).click();     // 提交
    await page.waitForTimeout(120);
  }
  ok('全员提交后摆出【开始结算】闸门（' + spec.length + ' 人）', await clickSettle(page));
  return true;
}

/* 推完这一段里的所有「传手机」关口；返回本轮实际做出选择的玩家数。
   逐个推进，收尾只有两种合法结局：轮次前进，或本轮的人都问完了。
   ⚠ 不能拿「遮罩不在」当收工信号：pickAll 里两名乘客之间夹着 `await fxWait(40)`
   （render.js），这一刻遮罩是短暂消失的。1 倍速下这个 40ms 是真时间，3 倍速/静默下
   几乎归零 —— 于是同一份测试在两边数出的人数不一样，A/B 就停在不同的轮次上。
   page.__fast 为真时，趁遮罩落下的窗口按一次「快进」——顶栏在遮罩之下，
   只有这个窗口按得到；快进是时钟变速、跨轮保留，所以整局按一次就够。 */
async function settleSegment(page, waitMs) {
  if (!(await toBoundary(page, waitMs))) return 0;
  const r0 = (await S(page)).round;
  let n = 0;
  for (let guard = 0; guard < 16; guard++) {
    /* 等下一个人的遮罩立起来、全员提交后的结算闸门、或演完摊出来的本轮战报；
       轮次一旦前进就立刻收工，不白等 */
    if (!(await waitFor(page, 40000, r => !!document.querySelector('#curtain.on') ||
      document.querySelector('#btnSettle') || document.querySelector('#summary.on') ||
      window.TC_UI.state().round !== r, r0))) break;
    if ((await S(page)).round !== r0) break;
    if (await page.locator('#btnSettle').count()) {    // 人都交完了：闸门一点，这一轮才开始结算
      await page.click('#btnSettle');
      await page.waitForTimeout(80);
      continue;
    }
    if (await page.evaluate(atSummary)) {              // 结算演完了：点掉战报，回站台 + 补票
      await page.click('#sumOk');
      await page.waitForTimeout(80);
      continue;
    }
    await page.click('#curtainOk');
    await page.waitForTimeout(50);
    if (await page.locator('#curtain.on').count()) continue;   // 遮罩还在，防抖
    if (page.__fast && !page.__sped) {
      page.__sped = true;
      await page.click('#btnSpeed');
      await page.waitForTimeout(60);
    }
    const btns = await page.locator('#hudBtns .btn').count();
    const chips = await page.locator('#hudList .chip-btn').count();
    if (btns === 1 && chips === 0) {                 // 单按钮：候车阶段的「下一位 / 开始游戏」，或柜前那位的「回到站台」（点一下就是提交）
      await page.locator('#hudBtns .btn').first().click();
    } else {
      await doPick(page, n);
      n++;
    }
    await page.waitForTimeout(50);
  }
  return n;
}

/* 结算的慢放窗口只能由页面自己采样：settleSegment 会一路推过整个结算，
   等它返回再从外面读 pace() 只能读到「控制权已经交还」的 1（快进档则是 3），
   「慢放到底跑没跑、跑了多久」全漏判。所以采样必须和 settleSegment 并发跑在页面里。 */
async function paceWatchStart(page) {
  await page.evaluate(() => {
    const st = {
      min: 9, max: 0, slowMs: 0, slowClk: 0, maxWin: 0, cssBad: 0,
      last: 0, lastClk: 0, win: 0, windows: 0, inSlow: false, steps: 0, trace: [], timer: 0,
    };
    window.__paceWatch = st;
    const tick = () => {
      const p = window.TC_UI.pace(), now = performance.now(), clk = window.TC_UI.clock();
      if (p < st.min) st.min = p;
      if (p > st.max) st.max = p;
      if (p < 1) {
        /* 一「段」慢放 = 一次连续的 p<1（setPace(SLOW) 到 setPace(1) 之间）。
           轮数 = 段数，于是「上一轮结束后节奏是不是真还回去了」不用另测：
           finally 漏掉 setPace(1) 的话，两段会粘成一段。 */
        if (!st.inSlow) { st.windows++; st.inSlow = true; st.win = 0; }
        else if (st.last) {
          /* 同时攒墙钟与演出时钟：两者的比就是慢放的真实倍率，
             不靠「跑够多少秒」这种跟动作数挂钩的魔数。 */
          st.slowMs += now - st.last;
          st.slowClk += clk - st.lastClk;
          st.win += now - st.last;
          if (st.win > st.maxWin) st.maxWin = st.win;
        }
        st.last = now; st.lastClk = clk;
        /* 车厢熄灯 / 无人光顾药丸 / 气泡走 CSS transition，靠 --fx-pace 跟同一个节奏；
           这里顺手把它也验了 —— 只慢 JS 那半截会像丢帧 */
        const css = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fx-pace'));
        if (!(Math.abs(css - 1 / p) < 1e-6)) st.cssBad++;
      } else {
        st.inSlow = false;
        st.last = 0;            // 窗口一结束就丢掉锚点，下一段不能把两段之间的空档算进慢放
      }
      /* 顺带攒位移轨迹：每 50ms 记一次各角色的世界坐标，只统计「一小步一小步」的采样
         （0.4 < 步长 < 60；走速上限 = WALK_V × 缓动峰值 2 ≈ 0.84 单位/ms，50ms 走 42，留到 60）。
         一步跳完的瞬移是一整段路程（几百单位），照样被上限滤掉，steps 于是归零 —— 这是唯一能抓住
         「补间起点锚错 → 所有位移变闪现」的断言：终点全对，指纹比对一点看不出来。 */
      const figs = window.TC_UI.figs();
      for (let i = 0; i < figs.length; i++) {
        const f = figs[i], tr = st.trace[i] || (st.trace[i] = { x: f.wx, y: f.wy });
        const dx = f.wx - tr.x, dy = f.wy - tr.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0.4) { if (d < 60) st.steps++; tr.x = f.wx; tr.y = f.wy; }
      }
      st.timer = setTimeout(tick, 50);
    };
    tick();
  });
}
async function paceWatchStop(page) {
  return page.evaluate(() => {
    clearTimeout(window.__paceWatch.timer);
    const s = window.__paceWatch; window.__paceWatch = null;
    return {
      min: s.min, max: s.max, slowMs: s.slowMs, slowClk: s.slowClk, maxWin: s.maxWin,
      cssBad: s.cssBad, windows: s.windows, steps: s.steps,
    };
  });
}

/* 入场那一次走动：所有角色同时从站台前沿外走进画面。远近的「每秒像素」本来就一样
   （世界→屏幕是均匀映射），所以「远处的人看着更快」只能来自两件事：
     ① 路程不同却给同一个时长（曾经写死 620ms：最远的人走 417 单位，最近的人 191）；
     ② 远处的人画得小（figScale 0.62~1.0），每秒走过的「身长」就更多。
   这里按「身长/秒」判：把速度除以该处的 figScale，三个人应当基本一致。 */
async function walkWatchStart(page) {
  await page.evaluate(() => {
    const st = { figs: [], timer: 0 };
    window.__walkWatch = st;
    const tick = () => {
      const now = performance.now();
      const fs = window.TC_UI.figs();
      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        const r = st.figs[i] || (st.figs[i] = { t0: 0, t1: 0, path: 0, ySum: 0, n: 0, x: f.wx, y: f.wy });
        const d = Math.hypot(f.wx - r.x, f.wy - r.y);
        /* 上限滤掉「被瞬移摆到起跑线」（入场前那一下 >100 单位），只留一段段真实位移 */
        if (d > 0.4 && d < 30) {
          if (!r.t0) r.t0 = now;
          r.t1 = now; r.path += d; r.ySum += f.wy; r.n++;
        }
        r.x = f.wx; r.y = f.wy;
      }
      st.timer = setTimeout(tick, 25);
    };
    tick();
  });
}
async function walkWatchStop(page) {
  return page.evaluate(() => {
    clearTimeout(window.__walkWatch.timer);
    const s = window.__walkWatch; window.__walkWatch = null;
    return s.figs.map(function (r, i) {
      const dur = r.t1 - r.t0;
      const v = dur > 0 ? r.path / dur : 0;                       /* 世界单位 / 毫秒 */
      const y = r.n ? r.ySum / r.n : 0;                           /* 采样按时间加权 → 就是走路途中平均的纵深 */
      const sc = window.TC.figScale(y);
      return {
        i: i, dur: Math.round(dur), path: +r.path.toFixed(1), y: Math.round(y),
        v: +v.toFixed(4), sc: +sc.toFixed(3),
        bl: +(v * 1000 / (40 * sc)).toFixed(2),                    /* 身长 / 秒（40 = 角色身高） */
      };
    });
  });
}

/* 候车阶段：三位乘客各过一个「传手机」关口，最后一位点「开始游戏」。
   第一名乘客的回合里插一次拖拽，验证自由走动。 */
async function runLobby(page, onDrag) {
  if (!(await waitFor(page, 12000, () => !!document.querySelector('#curtain.on')))) return 0;
  let turns = 0;
  for (let guard = 0; guard < 12; guard++) {
    await page.click('#curtainOk');
    await page.waitForTimeout(70);
    if (turns === 0 && onDrag) await onDrag();
    const btn = page.locator('#hudBtns .btn').first();
    const label = await btn.textContent();
    await btn.click();
    turns++;
    if (/开始游戏/.test(label)) break;
    if (!(await waitFor(page, 12000, () => !!document.querySelector('#curtain.on')))) break;
  }
  return turns;
}

async function dragStage(page) {
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.75, { steps: 14 });
  await page.waitForTimeout(320);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function playTo(page, maxRounds, shots) {
  await page.click('#btnStart');
  await page.waitForTimeout(250);
  if (shots) await shot(page, '01-setup');
  await walkWatchStart(page);                        // 入场走动：采样要赶在「开始游戏」前面装好
  await page.click('#btnBegin');
  await page.waitForTimeout(300);

  /* ---- 候车阶段 + 开局前自由走动 ---- */
  const before = await page.evaluate(() => { const f = window.TC_UI.figs()[0]; return { x: f.wx, y: f.wy }; });
  const turns = await runLobby(page, async () => {
    const ww = await walkWatchStop(page);            // 先收入场数据：下面的拖动只动 0 号，会污染他的窗口
    const spread = (a) => (Math.max.apply(null, a) - Math.min.apply(null, a)) / Math.min.apply(null, a);
    const quiet = !(await page.evaluate(() => window.TC_UI.fxOn()));
    if (quiet) {
      /* 静默演出把整段走位折成立即到位：这里反而要断言「一步没走」 */
      ok('静默演出下入场走位折成立即到位（采样窗口 ' + ww.map(r => r.dur).join('/') + 'ms）',
        ww.every(r => r.dur === 0));
    } else {
      const bls = ww.map(r => r.bl), vs = ww.map(r => r.v);
      console.log('      · 入场走动：' + ww.map(r =>
        '#' + r.i + ' ' + r.path + '单位 / ' + r.dur + 'ms（' + r.v.toFixed(3) + ' 单位/ms，纵深 ' + r.sc + '）').join('｜'));
      console.log('      · 每秒身长：' + bls.map(b => b.toFixed(2)).join(' / ') +
        '（散布 ' + Math.round(spread(bls) * 100) + '%；裸速度散布 ' + Math.round(spread(vs) * 100) + '%）');
      ok('三个角色都走着入场（窗口 ' + ww.map(r => r.dur).join('/') + 'ms）', ww.every(r => r.dur > 100));
      ok('远近角色「每秒身长」一致（散布 ' + Math.round(spread(bls) * 100) + '%，写死时长那版是 200%+）',
        spread(bls) < 0.25);
      ok('入场时长不再是一个数（远的走得更久）', ww[0].dur > ww[ww.length - 1].dur * 1.5);
    }
    await dragStage(page);
    const after = await page.evaluate(() => { const f = window.TC_UI.figs()[0]; return { x: f.wx, y: f.wy }; });
    ok('候车阶段拖动确实让角色移动了', Math.abs(after.x - before.x) > 6 || Math.abs(after.y - before.y) > 6);
    const walk = await page.evaluate(() => {
      const TC = window.TC, f = window.TC_UI.figs()[0];
      const c = TC.clampWalk(f.wx, f.wy);
      return { wx: f.wx, wy: f.wy, cx: c.x, cy: c.y };
    });
    /* 站台是梯形：判定「没越界」的办法是再过一次 clampWalk，位置不该被改动 */
    ok('走动不越出站台边缘', Math.abs(walk.wx - walk.cx) < 1 && Math.abs(walk.wy - walk.cy) < 1);
    if (shots) await shot(page, '03-lobby-walk');
  });
  ok('三名乘客各过一次候车关口', turns === 3);

  await page.waitForTimeout(650);                    // 列车滑入的中段（滑门 760ms 起，逐节错开 90ms）
  if (shots) await shot(page, '02-arrive');
  await page.waitForTimeout(2300);                   // 停稳、开滑门、补完票，第一张遮罩立起来
  ok('列车进站后仍在游戏屏', await page.locator('#screen-game.on').count() === 1);
  ok('三名角色都在场', await page.evaluate(() => window.TC_UI.figs().length) === 3);

  /* ---- 逐轮推进：快进只在第一个「传手机」窗口按一次，之后全程 3 倍速 ---- */
  page.__fast = true;
  /* 无人光顾不再有印章：整局盯着 #fx，凡是塞进来带 .stampStop 的节点就记一笔。
     印章包在 .fxc 里进 #fx（spawn 的 className 只有 fxc），得往下找一层。 */
  await page.evaluate(() => {
    window.__stopStamps = 0;
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.querySelector && n.querySelector('.stampStop')) window.__stopStamps++;
        });
      });
    }).observe(document.querySelector('#fx'), { childList: true });
  });
  let rounds = 0;
  for (let r = 0; r < maxRounds; r++) {
    const s0 = await S(page);
    if (s0.phase === 'over') break;
    const n = await settleSegment(page, 25000);
    ok('第 ' + s0.round + ' 轮至少有一位乘客做了选择', n >= 1);
    if (!n) break;
    if (!(await toBoundary(page, 25000))) { ok('第 ' + s0.round + ' 轮能走到下一轮边界', false); break; }
    const s1 = await S(page);
    rounds++;
    await assertBoard(page, '第 ' + s1.round + ' 轮开始前');
    if (rounds === 1) {
      /* ---- 无人光顾只剩一行字：门扣上时正中浮起的状态药丸（.car-stop，红底白字）。
         曾经另有一枚同字同址的印章（白底红字）叠在它上面，两行几乎同字，看着像
         「无人光顾闪了两次」—— 印章已删，药丸也就不必再等谁退场：两侧都不带延迟，
         .closed 一挂就淡进来，摘掉就立刻熄。 */
      const pill = await page.evaluate(() => {
        const node = document.querySelectorAll('.coach-car')[0];
        const p = node.querySelector('.car-stop');
        const S = window.TC_UI.state(), c0 = S.cars[0], keep = !!c0.closed;
        c0.closed = false; window.TC_UI.redraw();
        const off = parseFloat(getComputedStyle(p).transitionDelay) || 0;
        c0.closed = true; window.TC_UI.redraw();
        const on = parseFloat(getComputedStyle(p).transitionDelay) || 0;
        c0.closed = keep; window.TC_UI.redraw();
        return { off: off, on: on };
      });
      ok('药丸出场不带延迟（不再等谁退场）', pill.on === 0);
      ok('摘掉无人光顾时药丸不带延迟（下一轮开局立刻熄）', pill.off === 0);
      const lit = await page.evaluate(async () => {
        const p = document.querySelectorAll('.coach-car')[0].querySelector('.car-stop');
        const S = window.TC_UI.state(), c0 = S.cars[0], keep = !!c0.closed;
        const fx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fx-pace')) || 1;
        c0.closed = true; window.TC_UI.redraw();
        await new Promise(r => setTimeout(r, 240 * fx + 500));    // 过场走完（静默演出下是 .001ms，也算走完）
        const op = +getComputedStyle(p).opacity;
        c0.closed = keep; window.TC_UI.redraw();
        return op;
      });
      ok('药丸真的浮起来（不是一直透明）', lit > 0.9);
    }
    if (shots && rounds === 1) {
      /* 轮次边界正好是遮罩立着的时候，拍不到版面。这里只把遮罩的 .on 摘掉——
         和给下一位乘客前自己按「我准备好了」是同一件事，游戏状态一点没动。 */
      await page.evaluate(() => document.querySelector('#curtain').classList.remove('on'));
      await page.waitForTimeout(120);
      await shot(page, '04-after-round-1');
      await page.evaluate(() => document.querySelector('#curtain').classList.add('on'));
    }
    if (s1.phase === 'over') break;
  }

  const sFin = await S(page);
  ok('票池见底后确实收局了', sFin.phase === 'over');
  ok('打满了至少 6 轮', rounds >= 6);
  const stopStamps = await page.evaluate(() => window.__stopStamps);
  ok('整局一枚「无人光顾」印章都没有（' + stopStamps + ' 枚）', stopStamps === 0);

  /* ---- 无人光顾 / 已放完都是「本轮」状态：屏幕上的类得能跟着状态上下 ----
     曾经这两句只 add 不 remove，关过一次关的车会一路熄灯到重开。 */
  const cls = await page.evaluate(() => {
    const S = window.TC_UI.state(), c0 = S.cars[0];
    const node = document.querySelectorAll('.coach-car')[0];
    const keep = { closed: c0.closed, short: c0.short };
    c0.closed = true; c0.short = true;
    window.TC_UI.redraw();
    const on = { closed: node.classList.contains('closed'), short: node.classList.contains('short') };
    c0.closed = keep.closed; c0.short = keep.short;
    window.TC_UI.redraw();
    const off = { closed: node.classList.contains('closed'), short: node.classList.contains('short') };
    return { on: on, off: off, keep: keep };
  });
  ok('本轮无人光顾类能跟着状态点亮', cls.on.closed && cls.on.short);
  ok('本轮无人光顾类能跟着状态熄灭（不是只 add 不 remove）', !cls.off.closed && !cls.off.short);

  /* ---- 「车票已全部放置完」只是一句通报：药丸正落在筹码带上，一直摊着就看不见
     车里还剩什么票。摊几秒必须自己收掉（淡出），筹码跟着回到原亮度 ——
     而 `.short` 这个**状态类**不许跟着掉（屏幕与引擎仍然逐轮一致）。 */
  await page.evaluate(() => {
    const c0 = window.TC_UI.state().cars[0];
    window.__shortKeep = { closed: !!c0.closed, short: !!c0.short };
    /* 终局这节车可能本来就 short / closed（通报早收掉了）：先落回干净状态让计时从零开始，
       再只强开 short —— 验的是「短票通报会自己收、筹码回到该有的亮度」，
       别让上一轮烧完的计时或「无人光顾」的 .34 亮度混进读数。 */
    c0.closed = false;
    c0.short = false; window.TC_UI.redraw();
    c0.short = true; window.TC_UI.redraw();
  });
  await page.waitForTimeout(320);                    // 药丸淡入（.2s × --fx-pace）
  const hint = await page.evaluate(() => {
    const node = document.querySelectorAll('.coach-car')[0];
    return {
      pill: +getComputedStyle(node.querySelector('.car-short')).opacity,
      chips: +getComputedStyle(node.querySelector('.cr-chips-svg')).opacity,
    };
  });
  ok('票池见底时药丸亮着、车内筹码压暗（' + hint.pill.toFixed(2) + ' / ' + hint.chips.toFixed(2) + '）',
    hint.pill > 0.9 && hint.chips < 0.2);
  await page.waitForTimeout(3600);                   // 停留时长（SHORT_TOLD = 3.2s）过完
  const told = await page.evaluate(() => {
    const c0 = window.TC_UI.state().cars[0];
    const node = document.querySelectorAll('.coach-car')[0];
    const out = {
      pill: +getComputedStyle(node.querySelector('.car-short')).opacity,
      chips: +getComputedStyle(node.querySelector('.cr-chips-svg')).opacity,
      short: node.classList.contains('short'), told: node.classList.contains('short-told'),
      keep: window.__shortKeep,
    };
    c0.closed = out.keep.closed;                       // 还原：真实状态归位
    c0.short = out.keep.short; window.TC_UI.redraw();
    out.after = { short: node.classList.contains('short'), told: node.classList.contains('short-told') };
    return out;
  });
  ok('几秒之后药丸自己收掉（淡到 ' + told.pill.toFixed(2) + '，.short 状态留着）',
    told.pill < 0.05 && told.short && told.told);
  ok('筹码跟着回到原亮度（' + told.chips.toFixed(2) + '）：车里还剩什么票看得见了', told.chips > 0.9);
  ok('状态落回去时连通报标记一起摘掉（下一轮补票能重新通报）',
    !told.after.told && told.after.short === told.keep.short);
  if (sFin.phase === 'over') {
    await page.waitForTimeout(3600);                 // 等冠军庆祝 + 数字滚动
    if (shots) await shot(page, '05-ranking');
    const ranks = await page.evaluate(() => [].map.call(document.querySelectorAll('#overList .rank-row'), r => ({
      name: r.querySelector('.rank-name').textContent,
      score: r.querySelector('.rank-score').textContent,
      win: r.classList.contains('win'),
    })));
    ok('结算页列出了全部乘客', ranks.length === 3);
    ok('冠军标记至少有一个人', ranks.filter(r => r.win).length >= 1);
    ok('分数列已滚到终值', ranks.every(r => /^\d+$/.test(r.score)));
    const eng = await page.evaluate(() => window.TC.rank(window.TC_UI.state()).map(r => r.total).sort((a, b) => b - a));
    const dom = ranks.map(r => +r.score).sort((a, b) => b - a);
    ok('屏幕排名与引擎排名一致', JSON.stringify(dom) === JSON.stringify(eng));
    /* 榜单每行前的小圆点也是主人的**衣服色**（--cloth = colors.top），和柜门色条同源。
       期望值不进测试里写死：拿一个离屏探针把 colors.top 归一化成浏览器眼里的 rgb() 再比。 */
    const dots = await page.evaluate(() => {
      const R = window.TC.rank(window.TC_UI.state());
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      const rgb = function (c) { probe.style.background = c; return getComputedStyle(probe).backgroundColor; };
      const out = [].map.call(document.querySelectorAll('#overList .rank-row'), (row, i) => {
        const m = row.querySelector('.rank-mark');
        const t = R[i].colors.top;
        return {
          cloth: (m.style.getPropertyValue('--cloth') || '').trim(),
          top: t,
          dot: getComputedStyle(m).backgroundColor,
          want: rgb(t),
        };
      });
      probe.remove();
      return out;
    });
    ok('榜单圆点写的是主人的衣服色（' + dots.map(d => d.cloth + (d.cloth === d.top ? ' = 上衣' : ' ≠ 上衣 ' + d.top)) + '）',
      dots.length === 3 && dots.every(d => d.cloth && d.cloth === d.top));
    ok('榜单圆点**画出来**就是那个色（' + dots.map(d => d.dot + (d.dot === d.want ? ' = ' : ' ≠ ') + d.want) + '）',
      dots.length === 3 && dots.every(d => d.dot === d.want));
    await page.locator('.rank-main').first().click();
    await page.waitForTimeout(240);
    ok('点排名行能展开计分明细', await page.locator('#overList .rank-row.open').count() >= 1);
    ok('明细里写出了公式', (await page.locator('#overList .rank-row.open .score-row').count()) >= 1);
    /* 明细只有一池：标题里两个容器的张数都写着，分数一次算完 —— 按容器分两段算的话，
       柜里 3 张散黄 + 包里 1 张会各自「单张不成对」，明明是一对却白扔 2 分。 */
    const det = await page.evaluate(() => {
      const row = document.querySelectorAll('#overList .rank-row')[0];
      const subs = row.querySelectorAll('.score-sub');
      let sum = 0;
      row.querySelectorAll('.score-row').forEach(function (x) {
        sum += parseInt(x.querySelector('b').textContent, 10) || 0;
      });
      return { n: subs.length, title: subs[0] ? subs[0].textContent : '', sum: sum,
        total: window.TC.rank(window.TC_UI.state())[0].total };
    });
    ok('明细只列一池：' + det.title, det.n === 1 && det.title.indexOf('储物柜') > 0 && det.title.indexOf('背包') > 0);
    ok('明细各行相加 = 总分（' + det.sum + ' vs ' + det.total + '）', det.sum === det.total);
    if (shots) await shot(page, '06-ranking-detail');
    /* 「再来一局」的名单从哪来：发车前那份 draft（名字与配色）。中途刷新过的一局打到
       结算时，内存里的 draft 早被读档路径丢过一次，所以先刷新落回结算屏再点重开，
       把「名单照旧」钉住：人数、名字、配色都得是刚打完那局的人，行也不是空盒子。 */
    const played = await page.evaluate(() => {
      const COL = ['top', 'bottom', 'shoes', 'hat', 'bag'];
      /* 名单是**座位序**，别拿 TC.rank 去比 —— 那条是按分数重排过的 */
      return window.TC_UI.state().players.map(p => ({
        name: p.name, colors: COL.map(k => p.colors[k]),
      }));
    });
    await page.reload();
    await page.waitForTimeout(700);
    ok('结算屏刷新后原样回来（读档直达结算，不重演）',
      await page.locator('#screen-over.on').count() === 1 &&
      await page.locator('#overList .rank-row').count() === 3);
    await page.click('#btnAgain');
    await page.waitForTimeout(300);
    const roster = await page.evaluate(() => {
      const COL = ['top', 'bottom', 'shoes', 'hat', 'bag'];
      const rows = [].map.call(document.querySelectorAll('#roster .pl-row'), r => {
        const fig = r.querySelector('.pl-fig .fig');
        return {
          name: r.querySelector('.pl-name').value,
          h: Math.round(r.getBoundingClientRect().height),
          fig: Math.round(fig ? fig.getBoundingClientRect().height : 0),
        };
      });
      const sv = window.TC_UI.save();
      const dr = (sv && sv.draft) || [];
      return { rows: rows, draft: dr.map(r => ({ name: r.name, colors: COL.map(k => r.colors[k]) })) };
    });
    ok('「再来一局」回到名单且人数照旧（' + roster.rows.length + ' 行）',
      await page.locator('#screen-setup.on').count() === 1 && roster.rows.length === 3);
    const sameRoster = JSON.stringify(roster.draft) === JSON.stringify(played);
    ok('名单沿用上一局的人与配色（' + roster.draft.map(r => r.name).join('/') + '）', sameRoster);
    if (!sameRoster) {
      console.log('      · 名单 ' + JSON.stringify(roster.draft));
      console.log('      · 上一局 ' + JSON.stringify(played));
    }
    ok('名单行不是摆样子的空盒子（行高 ' + roster.rows.map(r => r.h).join('/') +
      '，小人身高 ' + roster.rows.map(r => r.fig).join('/') + '）',
      roster.rows.every(r => r.h >= 40 && r.fig >= 20));
  }
  return sFin;
}

/* ---------- A/B：演出 vs 快进 ---------- */
function fingerprint(page) {
  return page.evaluate(() => {
    const s = window.TC_UI.state(), TC = window.TC;
    const figs = window.TC_UI.figs();
    return JSON.stringify({
      round: s.round, resolved: s.resolved, pool: s.pool, lastRound: s.lastRound,
      cars: s.cars.map(c => c.tickets),
      at: s.players.map(p => p.at),
      bags: s.players.map(p => p.bag),
      lockers: s.players.map(p => p.locker),
      pos: figs.map(f => [Math.round(f.wx * 10) / 10, Math.round(f.wy * 10) / 10]),
      rank: TC.rank(s).map(r => [r.name, r.total]),
    });
  });
}
async function oneRound(browser, fast) {
  const page = await open(browser);
  await page.click('#btnStart');
  await page.waitForTimeout(200);
  await page.click('#btnBegin');
  await page.waitForTimeout(300);
  await runLobby(page, null);                        // 候车
  await page.waitForTimeout(2900);                   // 列车进站
  page.__fast = !!fast;
  await paceWatchStart(page);                        // 采样在页面里，和 settleSegment 并发
  /* 连打两轮再收工：第 1 轮全是新人（无票可存、无可顺），演出本来就短；
     第 2 轮同样的一遍还能证明「上一轮结束后节奏确实还回去了」——
     漏掉 finally 里的 setPace(1)，两段慢放会粘成一段，windows 就少一个。 */
  const n = await settleSegment(page, 25000) + await settleSegment(page, 25000);
  const reached = await toBoundary(page, 90000);     // 第 3 轮的遮罩
  const pace = await paceWatchStop(page);            // 两轮结算的播放率画像
  const paceEnd = await page.evaluate(() => window.TC_UI.pace());
  const slow = await page.evaluate(() => window.TC_UI.slow());   // 从页面读，不写死档位
  const fp = reached ? await fingerprint(page) : '';  // 没到边界就别碰页面了
  const errs = page.__errs.slice();
  await page.close();
  return { fp, errs, n, pace, paceEnd, slow };
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS);
  const browser = await chromium.launch();
  try {
    /* ---------- 1. 封面 / 名单 ---------- */
    if (section('封面 / 名单 / 抽屉')) {
      const page = await open(browser);
      ok('开局停在封面', await page.locator('#screen-menu.on').count() === 1);
      await shot(page, '00-menu');
      await page.click('#btnRules');
      await page.waitForTimeout(200);
      ok('规则弹层能打开', await page.locator('#rules.on').count() === 1);
      await shot(page, '00b-rules');
      await page.click('#rulesClose');
      await page.waitForTimeout(150);
      ok('规则弹层能关闭', await page.locator('#rules.on').count() === 0);

      await page.click('#btnStart');
      await page.waitForTimeout(250);
      ok('默认给出 3 位乘客', await page.locator('#roster .pl-row').count() === 3);
      await page.locator('.pl-fig').first().click();
      await page.waitForTimeout(250);
      ok('配色抽屉能打开', await page.locator('#palette.on').count() === 1);
      ok('抽屉里列出了 5 个部位', await page.locator('#palBody .sw-group').count() === 5);
      await shot(page, '00c-palette');
      await page.locator('#palBody .sw').nth(1).click();
      await page.waitForTimeout(150);
      await page.click('#palClose');
      await page.waitForTimeout(200);
      ok('配色抽屉能关闭', await page.locator('#palette.on').count() === 0);

      await page.click('#btnAdd');
      await page.waitForTimeout(150);
      await page.click('#btnAdd');
      await page.waitForTimeout(150);
      await page.click('#btnAdd');
      await page.waitForTimeout(150);
      ok('加满 6 人后「添加」自动禁用', await page.locator('#btnAdd').isDisabled());
      await shot(page, '00d-roster6');
      await page.locator('.pl-del').nth(5).click();
      await page.waitForTimeout(150);
      await page.locator('.pl-del').nth(4).click();
      await page.waitForTimeout(150);
      ok('能删回 4 人', await page.locator('#roster .pl-row').count() === 4);
      /* 手机上转屏、地址栏收起都会在名单上来一发 resize —— 此刻游戏屏还是 display:none，
         fitStage 若照着 0×0 量，--k 会被钳成 0.2，头像缩成 4.8×8 且名单自己不重量、缩了回不来。 */
      await page.setViewportSize({ width: 390, height: 800 });
      await page.waitForTimeout(300);
      const rz = await page.evaluate(() => {
        const r = document.querySelector('#roster .pl-fig .fig').getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height),
                 k: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) };
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      ok('名单上改窗口，头像不缩水（' + rz.w + '×' + rz.h + '，--k ' + rz.k.toFixed(2) + '）',
        rz.w === 24 && rz.h === 40 && rz.k > 0.9);
      await page.click('#btnSetupBack');
      await page.waitForTimeout(200);
      ok('名单能返回封面', await page.locator('#screen-menu.on').count() === 1);
      await page.close();
    }

    /* ---------- 1b. 音效：解锁 + 被系统挂起后要能自己醒 ---------- */
    if (section('音效解锁')) {
      const page = await open(browser, { audio: true });
      const sp = () => page.evaluate(() => ({
        ready: window.TC_SFX.ready,
        state: window.__ctx ? window.__ctx.state : 'none',
        osc: window.__osc,
      }));
      const s0 = await sp();
      ok('没触摸过就不建 AudioContext（' + s0.state + '）', s0.state === 'none' && s0.ready === false);

      await page.click('#btnStart');
      await page.waitForTimeout(250);
      const s1 = await sp();
      ok('第一次点按解锁并出声（osc ' + s1.osc + '）', s1.ready === true && s1.osc > 0);

      /* suspend 等价于手机锁屏 / 来电 / 切后台被冻结 / 音频焦点被抢走。
         只在 boot 里做一次性解锁的话，从这里开始就是此后永久静音 —— 而且是静默失败。 */
      await page.evaluate(() => window.__ctx.suspend());
      await page.waitForTimeout(150);
      const s2 = await sp();
      ok('挂起后 ready=false（' + s2.state + '）', s2.ready === false && s2.state === 'suspended');

      await page.locator('.pl-rand').first().click();
      await page.waitForTimeout(300);
      const s3 = await sp();
      ok('挂起后下一次操作自己醒过来并补上这一发（osc ' + s2.osc + ' → ' + s3.osc + '）',
        s3.ready === true && s3.osc > s2.osc);
      ok('音效一节零报错', page.__errs.length === 0);
      if (page.__errs.length) page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 2. 六人局布局（车厢最挤的一档） ---------- */
    if (section('六人局版面')) {
      const page = await open(browser);
      await page.click('#btnStart');
      await page.waitForTimeout(200);
      await page.click('#btnAdd');
      await page.waitForTimeout(150);
      await page.click('#btnAdd');
      await page.waitForTimeout(150);
      await page.click('#btnAdd');
      await page.waitForTimeout(150);
      ok('凑齐 6 人', await page.locator('#roster .pl-row').count() === 6);
      await page.click('#btnBegin');
      await page.waitForTimeout(400);
      ok('六人局有 5 节车厢', await page.locator('.coach-car').count() === 5);
      ok('六人局有 6 个背包', await page.locator('#packs .pack').count() === 6);
      ok('六人局有 6 个储物柜', await page.locator('#lockers .locker').count() === 6);
      ok('六名角色都在场', await page.evaluate(() => window.TC_UI.figs().length) === 6);
      const st = await page.evaluate(() => {
        const TC = window.TC, s = window.TC_UI.state();
        const bad = [];
        for (let i = 0; i < s.N; i++) {
          const p = TC.packSpot(s.N, i), l = TC.lockerSpot(s.N, i), h = TC.homeSpot(s.N, i);
          if (p.x - p.w * p.s / 2 < 0 || p.x + p.w * p.s / 2 > TC.WORLD.w) bad.push('背包 ' + i + ' 越界');
          if (l.x - l.w / 2 < 0 || l.x + l.w / 2 > TC.WORLD.w) bad.push('柜 ' + i + ' 越界');
          const c = TC.clampWalk(h.x, h.y);
          if (Math.abs(c.x - h.x) > 0.5 || Math.abs(c.y - h.y) > 0.5) bad.push('站位 ' + i + ' 越界');
        }
        return { bad: bad, stage: document.querySelector('#stage').getBoundingClientRect() };
      });
      ok('6 人时背包/柜子/站位都没越界', st.bad.length === 0);
      if (st.bad.length) st.bad.forEach(x => console.log('      · ' + x));
      /* 背包名跟着纵深「近大远小」：i 越大越靠站台前沿（越近），字号必须单调变大；
         同时全场字号有可读性地板（6.6 世界单位），文字不许被包宽裁掉。 */
      const lg = await page.evaluate(() => {
        const N = window.TC_UI.state().N, TC = window.TC;
        const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k'));
        const rows = [];
        document.querySelectorAll('#packs .pack').forEach(function (pk, i) {
          const nm = pk.querySelector('.pk-name');
          const cs = getComputedStyle(nm);
          rows.push({
            i: i, s: TC.packSpot(N, i).s,
            fs: parseFloat(cs.fontSize) / k,
            clip: nm.scrollWidth - nm.clientWidth,
          });
        });
        const pill = document.querySelector('.car-no');
        const roof = document.querySelector('.roof-total');
        return { rows: rows, wu: k, pill: parseFloat(getComputedStyle(pill).fontSize) / k,
                 roof: parseFloat(getComputedStyle(roof).fontSize) / k };
      });
      const mono = lg.rows.slice().sort((a, b) => a.i - b.i);
      /* 远端两只包会被可读性地板一起抬到 6.6，所以是「不减」而不是严格递增；
         但近端必须明显比远端大 —— 那才是用户抱怨的倒挂被修好了。 */
      ok('背包名随纵深单调不变小，近端明显大于远端', mono.every((r, j) => j === 0 || r.fs >= mono[j - 1].fs - 1e-6)
        && mono[mono.length - 1].fs > mono[0].fs * 1.15);
      ok('背包名不低于可读性地板 6.6 世界单位', mono.every(r => r.fs >= 6.6 - 0.02));
      ok('背包名没被包宽裁掉（scrollWidth ≤ clientWidth）', mono.every(r => r.clip <= 1));
      ok('×号车 / 共×张 = 10 世界单位', Math.abs(lg.pill - 10) < 0.05 && Math.abs(lg.roof - 10) < 0.05);
      console.log('      · 背包名字号（远→近）：' + mono.map(r => r.fs.toFixed(2)).join(' → ') +
        '；车厢信息 ' + lg.pill.toFixed(2) + ' / ' + lg.roof.toFixed(2));
      /* 舞台之外的 HTML 界面文字（封面 / 名单 / 抽屉 / 顶栏 / 结算）不跟着纵深缩放，
         所以只有一条规矩：不许小于 12px。舞台内一律走世界单位，另外由 6.4 的地板管。 */
      const ch = await page.evaluate(() => {
        const bad = [];
        const stage = document.querySelector('#stage');
        document.querySelectorAll('body *').forEach(function (el) {
          if (stage.contains(el) || el.closest('#stage')) return;
          let direct = false;
          for (let n = el.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 3 && n.textContent.trim()) { direct = true; break; }
          }
          if (!direct) return;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 12 - 0.01) bad.push((el.className || el.id || el.tagName) + '@' + fs.toFixed(1));
        });
        const tb = document.querySelector('#topbar');
        return { bad: bad, tbOver: tb.scrollWidth - tb.clientWidth, tbText: tb.innerText.replace(/\s+/g, ' ').trim() };
      });
      ok('舞台外的界面文字一律 ≥ 12px', ch.bad.length === 0);
      if (ch.bad.length) ch.bad.slice(0, 8).forEach(x => console.log('      · 小字：' + x));
      ok('顶栏在 390px 下不横向溢出', ch.tbOver <= 1);
      console.log('      · 顶栏溢出 ' + ch.tbOver + 'px：' + ch.tbText);
      /* 头顶名牌挂在被纵深缩放的 .fig 里，所以要把 fig 的实际缩放乘回去看有效字号 */
      const ft = await page.evaluate(() => {
        const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k'));
        const out = [];
        document.querySelectorAll('#figs .fig').forEach(function (f) {
          const tag = f.querySelector('.fig-tag');
          const m = new DOMMatrix(getComputedStyle(f).transform);
          out.push({ name: tag.textContent, s: m.a,
                     eff: parseFloat(getComputedStyle(tag).fontSize) / k * m.a });
        });
        return out;
      });
      ok('头顶名牌乘上角色缩放后仍 ≥ 6.4 世界单位', ft.every(r => r.eff >= 6.4 - 0.02));
      console.log('      · 名牌有效字号（含角色缩放）：' +
        ft.map(r => r.name + ' ' + r.eff.toFixed(2) + '（×' + r.s.toFixed(2) + '）').join(' / '));
      /* 等遮罩立起来再点掉，才看得到干净版面；点掉只是开始走动，不推进游戏 */
      await waitFor(page, 12000, () => !!document.querySelector('#curtain.on'));
      await page.click('#curtainOk');
      await page.waitForTimeout(700);
      await shot(page, '07-six-players');
      ok('六人局零报错', page.__errs.length === 0);
      if (page.__errs.length) page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 2b. 候车拖动速度律（远慢近快，不是反的） ---------- */
    if (section('候车拖动速度律')) {
      const TCg = require('./game.js');
      const page = await open(browser);
      await page.click('#btnStart');
      await page.waitForTimeout(150);
      await page.click('#btnAdd');
      await page.waitForTimeout(150);
      await page.click('#btnBegin');
      ok('第一位玩家的候车遮罩立起来', await waitFor(page, 12000, () => !!document.querySelector('#curtain.on')));
      await page.click('#curtainOk');
      await page.waitForTimeout(500);

      /* 一个全程录制器：每帧记一次角色位置。绝不重启第二个循环 ——
         两个 rAF 循环往同一个数组里灌，会让时间戳成对重复、逐帧差分全成 0。 */
      await page.evaluate(function () {
        const f = window.TC_UI.figs()[0];
        window.__sp = [];
        const step = function (n) {
          window.__sp.push([n, f.wx, f.wy]);
          if (window.__sp.length < 6000) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      const drag = async function (t, ms) {
        const p = await page.evaluate(function (t) {
          const w = window.TC.ground(t.u, t.d);
          const c = window.TC.clampWalk(w.x, w.y);
          return window.TC_UI.toScreen(c.x, c.y);
        }, t);
        const from = await page.evaluate(() => window.__sp.length);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.waitForTimeout(ms);
        await page.mouse.up();
        return page.evaluate(function (from) { return window.__sp.slice(from); }, from);
      };
      /* 逐帧差商 → 世界单位 / 真实毫秒；再除以该处的纵深缩放，得到「名速」 */
      const digest = function (sp) {
        const seg = [];
        for (let i = 1; i < sp.length; i++) {
          const dt = sp[i][0] - sp[i - 1][0];
          if (dt < 2 || dt > 60) continue;
          const dx = sp[i][1] - sp[i - 1][1], dy = sp[i][2] - sp[i - 1][2];
          const v = Math.sqrt(dx * dx + dy * dy) / dt;
          if (v < 0.02) continue;                       /* 已经站定 / 纯噪声 */
          const y = (sp[i][2] + sp[i - 1][2]) / 2;
          seg.push({ v: v, y: y, s: TCg.figScale(y), vn: v / TCg.figScale(y) });
        }
        const med = function (arr) {
          if (!arr.length) return 0;
          const a = arr.slice().sort((x, y) => x - y);
          return a[(a.length - 1) >> 1];
        };
        return { n: seg.length, v: med(seg.map(x => x.v)), vn: med(seg.map(x => x.vn)),
                 y: med(seg.map(x => x.y)), s: med(seg.map(x => x.s)) };
      };

      /* u=0.78 贴着站台右缘：避开三位「候车站位」的互穿拦停（拦停会让采样掉速） */
      const FAR = { u: 0.78, d: 0.10 }, NEAR = { u: 0.78, d: 0.90 };
      await drag(FAR, 1600);                            /* 先自己走到远端（柜前那一带） */
      const a = digest(await drag(NEAR, 600));           /* 从远端起步量一段 */
      await drag(NEAR, 4200);                           /* 继续走到近端（站台前沿） */
      const b = digest(await drag(FAR, 600));            /* 从近端起步量一段 */

      ok('两段路都真的在走（采样足够）', a.n >= 12 && b.n >= 12);
      ok('远端每毫秒走过的世界单位 < 近端（不再「远处狂奔」）', a.v < b.v && b.v / Math.max(a.v, 1e-6) > 1.15);
      ok('两端都等于「名速 × 该处纵深缩放」（0.15 单位/毫秒 × figScale）',
        Math.abs(a.vn - 0.15) < 0.027 && Math.abs(b.vn - 0.15) < 0.027);
      ok('两端「每秒身长」一致：速度比 ≈ 缩放比', Math.abs(b.v / a.v - b.s / a.s) / (b.s / a.s) < 0.25);
      console.log('      · 远端 y=' + a.y.toFixed(0) + ' s=' + a.s.toFixed(3) + ' v=' + a.v.toFixed(4) +
        ' vn=' + a.vn.toFixed(4) + '（' + a.n + ' 帧）');
      console.log('      · 近端 y=' + b.y.toFixed(0) + ' s=' + b.s.toFixed(3) + ' v=' + b.v.toFixed(4) +
        ' vn=' + b.vn.toFixed(4) + '（' + b.n + ' 帧）');
      ok('候车拖动零报错', page.__errs.length === 0);
      page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 3. 完整一局 ---------- */
    if (section('三人一局走完 + 逐轮对账')) {
      const page = await open(browser);
      await playTo(page, 40, true);
      ok('全程零 pageerror / console 报错', page.__errs.length === 0);
      page.__errs.slice(0, 8).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 4. 演出 vs 快进 ---------- */
    if (section('演出 / 快进 一致性（同种子、同一轮）')) {
      const a = await oneRound(browser, false);
      const b = await oneRound(browser, true);
      ok('正常演出跑完一轮没有报错', a.errs.length === 0);
      ok('快进跑完一轮没有报错', b.errs.length === 0);
      a.errs.slice(0, 5).forEach(e => console.log('      · 演出: ' + e));
      b.errs.slice(0, 5).forEach(e => console.log('      · 快进: ' + e));
      ok('两次都做出同样数量的选择', a.n === b.n && a.n === 6);
      ok('两次都走到了轮次边界', !!a.fp && !!b.fp);
      /* ---- 慢放：结算四步按 SLOW 档播（从页面里读，改档位不必改测试），玩家一按倍速就交还控制权 ---- */
      ok('正常播放时两轮结算都按 ' + Math.round(a.slow * 100) + '% 慢放（CSS 过场同步）',
        a.pace.windows === 2 && a.pace.min === a.slow && a.pace.cssBad === 0);
      ok('快进把慢放一并顶掉（全程 3 倍速、没有一帧慢放）',
        b.pace.windows === 0 && b.pace.min === 1 && b.pace.max === 3 && b.pace.slowMs === 0);
      ok('演出结束后节奏交还给玩家设定', a.paceEnd === 1 && b.paceEnd === 3);
      /* 位移必须是走过去的：慢放下每一趟走位都该被采到很多小步。
         补间起点锚错时终点照样对，只有这一条会红。 */
      ok('角色位移是走过去的，不是闪现（' + a.pace.steps + ' 个行走采样）', a.pace.steps >= 20);
      /* 慢放不能只是「看起来慢」：窗口里花掉的墙钟时间 ÷ 时钟走掉的演出时间 = 真实倍率。
         这个比值跟「一轮里发生了几件事」无关，所以不用卡「跑够多少秒」那种会随对局漂移的魔数：
         1/0.4 = 2.5 倍；要是 rate() 没乘到 fxClock 上（慢放只写在变量里），比值就掉回 ≈1。
         留 0.3 余量给 hitStop（顿帧吃墙钟不走时钟，会略微抬高比值）与 50ms 采样抖动。 */
      const ratio = a.pace.slowClk > 0 ? a.pace.slowMs / a.pace.slowClk : 0;
      const want = 1 / a.slow;
      ok('慢放窗口里墙钟真的是演出时间的 ' + want.toFixed(1) + ' 倍（实测 ' + ratio.toFixed(2) +
        '，最长一段 ' + (a.pace.maxWin / 1000).toFixed(1) + 's）',
        Math.abs(ratio - want) < 0.3 && a.pace.maxWin > 2000);
      console.log('      · 慢放画像：正常 ' + (a.pace.slowMs / 1000).toFixed(1) + 's / ' + a.pace.windows +
        ' 段 / 行走 ' + a.pace.steps + ' 采样（最低 ' + a.pace.min + '，CSS 失配 ' + a.pace.cssBad +
        ' 次，倍率 ' + ratio.toFixed(2) + '）· 快进 ' + (b.pace.slowMs / 1000).toFixed(1) + 's / ' +
        b.pace.windows + ' 段 / 行走 ' + b.pace.steps + ' 采样（最低 ' + b.pace.min + '，最高 ' + b.pace.max + '）');
      if (a.fp && b.fp) {
        ok('两次都推进了同一轮', JSON.parse(a.fp).round === JSON.parse(b.fp).round);
        ok('加速演出不改变任何游戏状态', a.fp === b.fp);
        if (a.fp !== b.fp) {
          const x = JSON.parse(a.fp), y = JSON.parse(b.fp);
          Object.keys(x).forEach(k => {
            const p = JSON.stringify(x[k]), q = JSON.stringify(y[k]);
            if (p !== q) console.log('      · ' + k + ': 正常 ' + p + ' ≠ 快进 ' + q);
          });
        }
      }
    }

    /* ---------- 5b. 多人同时存放 ---------- */
    if (section('多人同时存放')) {
      /* 6 人 5 车：第 1 轮每人各占一节车 → 5 个人都拿到票，第 2 轮这 5 个人全部选「存放」。
         这是「多个存放者一起行动」唯一能稳定复现的场景（3 人 2 车凑不出两个有票的人）。 */
      const page = await open(browser);
      await page.click('#btnStart');
      await page.waitForTimeout(220);
      for (let i = 0; i < 3; i++) { await page.click('#btnAdd'); await page.waitForTimeout(120); }
      await page.click('#btnBegin');
      await page.waitForTimeout(300);
      const turns = await runLobby(page, null);
      ok('六人候车过了六名乘客', turns === 6);
      await page.waitForTimeout(2900);                 // 列车进站 + 开滑门 + 补票
      /* 第 1 轮：第 i 位选第 i 节车，最后一位也挤 1 号车（6 人 5 车，必有一节被抢空），
         于是第 2 轮有 4 个人背包里有票、可以一起存放 —— 3 人 2 车是凑不出这个场面的 */
      await pickRound(page, [0, 1, 2, 3, 4, 0]);
      /* 等第 1 轮演出彻底走完（下一轮的遮罩立起来）再装采样器：
         5 号车的车门站位恰好落在柜子那一带（170,151），上一轮上车的人还在走位时会骗过判据 */
      ok('第 1 轮走到了第 2 轮边界', await toBoundary(page, 60000));
      const bags = await page.evaluate(() =>
        window.TC_UI.state().players.filter(p => window.TC.total(p.bag) > 0).length);
      ok('第 1 轮结算后有 4 个人背包里有票（' + bags + ' 人）', bags === 4);
      const s1 = await S(page);
      ok('第 1 轮已结算完，没多跑', s1.resolved === 1);

      /* 第 2 轮：1~4 号（第 1 轮各自独占一节车的那四位）一起存放，另外两位照常上车。
         座位 0 和 5 上一轮挤在同一节车里空着手，这一轮没有票可存，只能去坐车 */
      await page.evaluate(() => {
        const st = { t: [], dep: [], hits: [], timer: 0 };
        window.__storeWatch = st;
        const t0 = performance.now();
        const last = [];
        const tick = () => {
          const now = performance.now() - t0;
          window.TC_UI.figs().forEach((f, i) => {
            /* 出发时刻：结算前的候场里没人动，所以「第一次位移」就是这个人出发去干活的那一刻。
               到达时刻差多少不能说明问题（四个人家在前台的排数不同，路本来就长短不一）。 */
            const p = last[i];
            if (p && st.dep[i] == null && Math.hypot(f.wx - p[0], f.wy - p[1]) > 0.4) st.dep[i] = now;
            last[i] = [f.wx, f.wy];
            /* 储物柜在**左上角**（柜体 x 62~186 / y 54~110，柜前站位 y=151），而车厢在右侧
               （x 216~352），最靠里的 5 号车车内站位 y 只有 172 —— 光卡 y 会把 5 号车的乘客算进来，
               所以 x 也要卡。站台在 y 271~577，上车的往反方向走。 */
            if (f.wy < 200 && f.wx < 210 && st.t[i] == null) { st.t[i] = now; st.hits.push([i, Math.round(now)]); }
          });
          st.timer = setTimeout(tick, 40);
        };
        tick();
      });
      /* 无人光顾那一拍：三节车**同一拍**合门，门是双倍速（130 演出 ms，别处 260）。
         量法：门叶第一次 data-open→0 是这一拍合门的起点，车厢挂上 .closed 是合门结束
         （stepCloseCars 等 doorsOf 落地才挂类，同一拍三节一起）—— 两者之差 ÷ --fx-pace
         就是门的演出时长（慢放 0.4 时它是 2.5，别把 325ms 墙钟当成 325 演出 ms）；
         三节车的起点散布 = 是不是同步关门的判据。
         本轮上车的两位用的是 1/2 号车，0/3/4 号无人光顾，够采三次。 */
      await page.evaluate(() => {
        const st = { flips: [], closes: [] };
        window.__doorWatch = st;
        const t0 = performance.now();
        const fx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fx-pace')) || 1;
        Array.prototype.forEach.call(document.querySelectorAll('.coach-car'), function (car, i) {
          Array.prototype.forEach.call(car.querySelectorAll('.cr-door'), function (leaf) {
            new MutationObserver(function () {
              if (leaf.getAttribute('data-open') === '0') st.flips.push({ car: i, t: performance.now() - t0, fx: fx() });
            }).observe(leaf, { attributes: true, attributeFilter: ['data-open'] });
          });
          new MutationObserver(function () {
            if (car.classList.contains('closed')) st.closes.push({ car: i, t: performance.now() - t0 });
          }).observe(car, { attributes: true, attributeFilter: ['class'] });
        });
      });
      await pickRound(page, [1, 'store', 'store', 'store', 'store', 2]);
      await page.waitForTimeout(1400);
      await shot(page, '09-store-parallel');           // 四人在路上
      await page.waitForTimeout(2600);
      await shot(page, '09b-store-doors');             // 并排开柜、票往里飞
      await page.waitForTimeout(6400);                 // 存放片段跑完
      const watch = await page.evaluate(() => {
        clearTimeout(window.__storeWatch.timer);
        return window.__storeWatch;
      });
      /* 关车门在存放之后：等三节车的 .closed 都挂上再判，别用「等了多久」去猜 */
      const doorOk = await waitFor(page, 40000, () => window.__doorWatch.closes.length >= 3);
      const door = await page.evaluate(() => {
        const st = window.__doorWatch, f1 = {}, c1 = {};
        /* 一辆车只认第一次翻转 / 第一次挂类：本轮收尾的「全车合拢」也在翻 data-open，
           但它排在无人光顾之后，且那条路不挂 .closed（见 animResolve 的 allDoors）。 */
        st.flips.forEach(f => { if (f1[f.car] == null) f1[f.car] = f; });
        st.closes.forEach(c => { if (c1[c.car] == null) c1[c.car] = c; });
        const flips = Object.keys(f1).map(k => f1[k]).sort((a, b) => a.t - b.t).slice(0, 3);
        return {
          cars: flips.map(f => f.car),
          spread: flips.length > 1 ? Math.round(flips[flips.length - 1].t - flips[0].t) : -1,
          ms: flips.map(f => c1[f.car] == null ? -1 : Math.round((c1[f.car].t - f.t) / f.fx)),
        };
      });
      ok('本轮三节无人光顾的车都合了门（' + door.cars.join('/') + ' 号）', doorOk && door.cars.length === 3);
      await page.waitForTimeout(700);                  // 药丸的 CSS 过场走完（慢放档 240ms × 2.5）
      /* 灭灯、合门、挂药丸是同一件事的三面：合了门的三节车各自亮一颗「本轮无人光顾」，
         没合门的两位（有人上车那两节）一颗都不许有 —— 药丸亮错车比不亮更难查。 */
      const pills = await page.evaluate(() => [].map.call(document.querySelectorAll('.coach-car'), (car, i) => ({
        car: i,
        closed: car.classList.contains('closed'),
        op: +getComputedStyle(car.querySelector('.car-stop')).opacity,
        txt: car.querySelector('.car-stop').textContent,
      })));
      const litCars = pills.filter(p => p.closed);
      ok('只有无人光顾的那三节车合了门（' + litCars.map(p => (p.car + 1) + ' 号').join('/') + '）',
        litCars.length === 3 && litCars.map(p => p.car).sort().join() === door.cars.slice().sort().join());
      ok('合了门的车都亮着「本轮无人光顾」，别的车一颗都没有（' +
        litCars.map(p => p.op.toFixed(2)).join('/') + ' vs ' + pills.filter(p => !p.closed).map(p => p.op.toFixed(2)).join('/') + '）',
        litCars.every(p => p.op > 0.9 && p.txt === '本轮无人光顾') &&
        pills.filter(p => !p.closed).every(p => p.op < 0.05));
      await shot(page, '09c-cars-closed');             // 三节车同时关着，各自一颗「本轮无人光顾」
      console.log('      · 无人光顾同步关门：起点散布 ' + door.spread + ' ms / 门时（换算回演出时间）' +
        door.ms.join(' / ') + ' ms');
      ok('三节车是同一拍合的门（起点散布 ' + door.spread + ' ms）', door.spread >= 0 && door.spread < 60);
      /* 上限放到 205：上一拍「关柜」留下的 hitStop（40 演出 ms）压在头上 —— 顿帧吃墙钟不走时钟，
         那一次会偏大约一百毫秒。改回 260 那一版量出来是 300 上下，照样红。 */
      ok('无人光顾这一拍的门是双倍速（≈130 演出 ms；别处 260）',
        door.ms.length === 3 && door.ms.every(v => v >= 95 && v <= 205));
      const went = watch.t.filter(t => t != null).map(t => Math.round(t)).sort((x, y) => x - y);
      const spread = went.length > 1 ? went[went.length - 1] - went[0] : -1;
      console.log('      · 谁在什么时候走到柜前：[座位, ms] ' + JSON.stringify(watch.hits));
      ok('四个存放者都走到了柜子前（' + went.length + ' 人）', went.length === 4);
      /* 同时行动 = 同一拍出发。排队演出的话每个人的出发要隔一整段
         （走 + 开柜 + 飞票 + 关柜 ≈ 4s 墙钟），出发时刻会排成等差数列。 */
      const deps = [1, 2, 3, 4].map(i => watch.dep[i] == null ? null : Math.round(watch.dep[i]));
      const depSpread = deps.every(t => t != null) ? Math.max.apply(null, deps) - Math.min.apply(null, deps) : -1;
      console.log('      · 四人出发时刻：' + JSON.stringify(deps));
      ok('四个存放者是同一拍出发的（出发散布 ' + depSpread + 'ms）', depSpread >= 0 && depSpread < 400);
      /* 到达有先有后是路程决定的（家在前台深处的人离柜子更远），不是谁在等谁 */
      ok('四个人到柜前不再排队（到达散布 ' + spread + 'ms，排队会是万毫秒级）', spread >= 0 && spread < 2000);
      console.log('      · 四人走到柜前的时刻：' + JSON.stringify(went));
      ok('存放这一轮没有报错', page.__errs.length === 0);
      page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 5c. 柜前停留 / 回站台动线 ---------- */
    if (section('柜前停留 / 回站台动线')) {
      /* 存放是两个回合的承诺：存放完的人**站在柜前不走**，下一回合仍然轮到他，
         但整个回合只有「回到站台」一个动作 —— 那一步放在下一轮演出的第 1 步里（存放那段），
         与这一轮去存放的人对着走。 */
      const page = await open(browser);
      await page.click('#btnStart');
      await page.waitForTimeout(220);
      await page.click('#btnBegin');
      await page.waitForTimeout(300);
      ok('三名乘客过了候车关口', (await runLobby(page, null)) === 3);
      await page.waitForTimeout(2900);                 // 列车进站 + 开滑门 + 补票
      /* 第 1 轮：0 号与 2 号挤 1 号车（两人都空手），1 号独占 2 号车拿 2 张 */
      await pickRound(page, [0, 1, 0]);
      ok('第 1 轮走到第 2 轮边界', await toBoundary(page, 60000));
      const got = await page.evaluate(() => window.TC.total(window.TC_UI.state().players[1].bag));
      ok('1 号乘客第 1 轮独得 2 张（下一步才有票可存）', got === 2);
      /* 第 2 轮：1 号存放，另外两位照常上车 */
      await pickRound(page, [0, 'store', 1]);
      ok('第 2 轮结算完、走到第 3 轮边界', await toBoundary(page, 60000));
      const stay = await page.evaluate(() => {
        const TC = window.TC, S = window.TC_UI.state(), f = window.TC_UI.figs()[1];
        const lk = TC.lockerStand(S.N, 1), h = TC.homeSpot(S.N, 1);
        return {
          at: S.players[1].at,
          dl: Math.hypot(f.wx - lk.x, f.wy - lk.y),
          dh: Math.hypot(f.wx - h.x, f.wy - h.y),
        };
      });
      ok('存放完状态标成 at=locker', stay.at === 'locker');
      ok('存放完人**停在柜前**（离柜 ' + stay.dl.toFixed(1) + ' 单位，离自己站位 ' + stay.dh.toFixed(0) + ' 单位）',
        stay.dl < 1.5 && stay.dh > 40);
      /* 柜门顶沿那条色带读的是主人的**衣服色**（--cloth = colors.top），
         不是座位身份色（--mark）—— 与结算榜每行前的小圆点同源。
         除了比字符串，再比一次**画出来的 RGB**：色条（::after）与角色上衣（.p-top）
         必须完全同色，否则「看起来像谁」这件事就又断了。 */
      const cloth = await page.evaluate(() => {
        const S = window.TC_UI.state(), F = window.TC_UI.figs();
        return [].map.call(document.querySelectorAll('#lockers .locker'), n => {
          const pid = +n.getAttribute('data-pid');
          const shirt = F[pid] && F[pid].el.querySelector('.p-top');
          return {
            pid: pid,
            cloth: (n.style.getPropertyValue('--cloth') || '').trim(),
            top: S.players[pid].colors.top,
            stripe: getComputedStyle(n, '::after').backgroundColor,
            shirt: shirt ? getComputedStyle(shirt).fill : '',
          };
        });
      });
      ok('每台柜子的色条 = 主人的衣服色（' + cloth.map(x => x.pid + '：' + x.cloth + (x.cloth === x.top ? ' = 上衣' : ' ≠ 上衣 ' + x.top)) + '）',
        cloth.length === 3 && cloth.every(x => x.cloth && x.cloth === x.top));
      ok('色条与上衣**画出来**是同一个 RGB（' + cloth.map(x => x.pid + '：' + x.stripe + (x.stripe === x.shirt ? ' = ' : ' ≠ ') + x.shirt) + '）',
        cloth.every(x => x.stripe === x.shirt && !/, 0\)$/.test(x.stripe)));

      /* 采样第 3 轮：这一轮同时有「去存放」与「回站台」两股人 —— 正是要交代的那条动线。
         0 号去存放、1 号（柜前那位）只提交「回到站台」、2 号上车。 */
      await page.evaluate(() => {
        const st = { atLocker: 0, mid: 0, home: 0, both: 0, labels: {}, timer: 0 };
        window.__retWatch = st;
        const tick = () => {
          const TC = window.TC, S = window.TC_UI.state(), F = window.TC_UI.figs();
          const r = F[1], w = F[0];
          const lk = TC.lockerStand(S.N, 1), h = TC.homeSpot(S.N, 1);
          const dl = Math.hypot(r.wx - lk.x, r.wy - lk.y), dh = Math.hypot(r.wx - h.x, r.wy - h.y);
          const rMid = !(dl < 1.5) && !(dh < 1.5);
          if (dl < 1.5) st.atLocker++;
          else if (dh < 1.5) st.home++;
          else st.mid++;
          /* 「两股人对着走」是**同一帧**上两个条件同时成立：回站台的人在路上，
             去存放的人也已经离开自己的站位、还没走到柜前。分别计数抓不到这一点。 */
          const gl = TC.lockerStand(S.N, 0), gh = TC.homeSpot(S.N, 0);
          const out = Math.hypot(w.wx - gh.x, w.wy - gh.y) > 8;
          const far = Math.hypot(w.wx - gl.x, w.wy - gl.y) > 30;
          if (rMid && out && far) st.both++;
          /* 传手机遮罩落下之后的单按钮 HUD 就是他那个回合的全部选项。
             按文案计数而不是只留最后一条：轮次边界前后还有别的单按钮瞬间，
             「最后一次读到什么」会被它们盖掉，按文案记账才分得清是谁的 HUD。 */
          const bt = document.querySelectorAll('#hudBtns .btn');
          if (bt.length === 1 && !document.querySelector('#curtain.on')) {
            const k = bt[0].textContent.trim();
            st.labels[k] = (st.labels[k] || 0) + 1;
          }
          st.timer = setTimeout(tick, 40);
        };
        tick();
      });
      /* 拍下「他留在柜前」这一刻：轮次边界正好是遮罩立着的时候，摘掉 .on 才看得见版面
         （和给下一位乘客前自己按「我准备好了」是同一件事，状态一点没动） */
      await page.evaluate(() => document.querySelector('#curtain').classList.remove('on'));
      await page.waitForTimeout(140);
      await shot(page, '10-locker-stay');
      await page.evaluate(() => document.querySelector('#curtain').classList.add('on'));

      /* 手动驱动第 3 轮（座位顺序 = activePlayers 顺序）——
         用不着 settleSegment：这一轮每一格的 HUD 长什么样本身就是断言。 */
      const plan = ['store', 'return', 'car'];
      for (let i = 0; i < plan.length; i++) {
        ok('第 ' + (i + 1) + ' 位乘客的传手机遮罩立起来了',
          await waitFor(page, 40000, () => !!document.querySelector('#curtain.on')));
        await page.click('#curtainOk');
        await page.waitForTimeout(90);
        const btns = page.locator('#hudBtns .btn');
        const cnt = await btns.count();
        const texts = [];
        for (let k = 0; k < cnt; k++) texts.push((await btns.nth(k).textContent()).trim());
        if (plan[i] === 'return') {
          ok('柜前那位只有一颗按钮，写的就是「回到站台」（HUD：' + texts.join(' / ') + '）',
            cnt === 1 && texts[0] === '回到站台');
          await btns.first().click();                        // 单按钮 = 直接提交
        } else if (plan[i] === 'store') {
          /* 别逐字钉按钮文案（「存放（N 张）」→「存放(N)」就是这么钉坏的）：
             钉住的是「第二颗就是存放」且**数字与背包一致**（0 号此刻确实有票可存）。 */
          const bagN = await page.evaluate(() => window.TC.total(window.TC_UI.state().players[0].bag));
          ok('0 号站在站台上，三选一照旧（HUD：' + texts.join(' / ') + '）',
            cnt === 4 && texts[1].indexOf('存放') === 0 && texts[1].indexOf(String(bagN)) > 0);
          /* ---- 趁「选择行动前」量两件事：背包徽章读不读得清、点背包 / 柜子看不看得了 ---- */
          const geo0 = await page.evaluate(() => {
            const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(','); };
            return { hud: r('#hud'), stage: r('#stage') };
          });
          /* 此刻 0 号 / 2 号背包里都有票（第 2 轮各占了一节车），徽章是亮的 */
          const lit = await page.evaluate(() => {
            const sr = document.querySelector('#stage').getBoundingClientRect();
            const out = [];
            document.querySelectorAll('#packs .pack').forEach(function (pack, i) {
              const b = pack.querySelector('.pk-badge .tk-badge');
              if (!b || b.classList.contains('off')) return;
              const br = pack.querySelector('.pk-badge').getBoundingClientRect();
              const nr = pack.querySelector('.pk-name').getBoundingClientRect();
              const dt = pack.querySelector('.pk-badge .dot');
              out.push({
                i: i,
                font: parseFloat(getComputedStyle(b).fontSize),
                dot: dt ? parseFloat(getComputedStyle(dt).width) : 0,
                clearName: nr.top - br.bottom,
                clipTop: br.top - sr.top,
              });
            });
            return out;
          });
          ok('亮着的背包徽章：字号 ≥ 9px、色点 ≥ 2.6px（' +
            lit.map(x => x.i + '：' + x.font.toFixed(1) + '/' + x.dot.toFixed(1)).join(' · ') + '）',
            lit.length >= 2 && lit.every(x => x.font >= 8.95 && x.dot >= 2.6));
          ok('徽章整只吊在包名之上，也没被舞台顶边裁掉（最小让位 ' +
            Math.min.apply(null, lit.map(x => x.clearName)).toFixed(1) + 'px）',
            lit.length >= 2 && lit.every(x => x.clearName >= 0 && x.clipTop >= 0));

          /* 点背包：出「看一眼」卡片。不开门、不推进回合 */
          await page.locator('#packs .pack[data-pid="0"]').click();
          await page.waitForTimeout(220);
          const pk0 = await page.evaluate(() => {
            const TC = window.TC, S = window.TC_UI.state(), $q = (s) => document.querySelector(s);
            const el = $q('#peek');
            return {
              on: el.classList.contains('on'),
              text: el.textContent.replace(/\s+/g, ' '),
              tot: String((el.textContent.match(/共 (\d+) 张/) || [])[1]),
              want: String(TC.total(S.players[0].bag)),
              gapToHud: Math.round($q('#hud').getBoundingClientRect().top - el.getBoundingClientRect().bottom),
            };
          });
          ok('点背包出卡片：写着「背包 / 共 N 张」，数字与引擎一致（' + pk0.text + '）',
            pk0.on && pk0.text.indexOf('背包') >= 0 && pk0.tot === pk0.want);
          ok('卡片浮在 HUD 正上方（间距 ' + pk0.gapToHud + 'px）', pk0.gapToHud >= 0);
          /* 点柜子：卡片换成储物柜，柜门卷起来 —— 柜里那几张票这才看得见 */
          await page.locator('#lockers .locker[data-pid="1"]').click();
          await page.waitForTimeout(460);
          const lk1 = await page.evaluate(() => {
            const TC = window.TC, S = window.TC_UI.state(), $q = (s) => document.querySelector(s);
            const g = $q('#lockers .locker[data-pid="1"] .lk-door');
            const m = /scale\(1,([\d.]+)\)/.exec(g.getAttribute('transform') || '');
            const el = $q('#peek');
            return {
              on: el.classList.contains('on'),
              text: el.textContent.replace(/\s+/g, ' '),
              tot: String((el.textContent.match(/共 (\d+) 张/) || [])[1]),
              want: String(TC.total(S.players[1].locker)),
              door: m ? parseFloat(m[1]) : -1,
            };
          });
          ok('点柜子卡片换成「储物柜」，数字与引擎一致（' + lk1.text + '）',
            lk1.on && lk1.text.indexOf('储物柜') >= 0 && lk1.tot === lk1.want);
          ok('柜门跟着卷起（scale ' + lk1.door + ' ≤ 0.1）', lk1.door >= 0 && lk1.door <= 0.1);
          /* 再点同一台柜子：卡片收起、柜门放下 */
          await page.locator('#lockers .locker[data-pid="1"]').click();
          await page.waitForTimeout(460);
          const lk2 = await page.evaluate(() => {
            const $q = (s) => document.querySelector(s);
            const g = $q('#lockers .locker[data-pid="1"] .lk-door');
            const m = /scale\(1,([\d.]+)\)/.exec(g.getAttribute('transform') || '');
            return { on: $q('#peek').classList.contains('on'), door: m ? parseFloat(m[1]) : -1 };
          });
          ok('再点一下：卡片收起、柜门放回（scale ' + lk2.door + ' ≥ 0.9）', !lk2.on && lk2.door >= 0.9);
          const geo1 = await page.evaluate(() => {
            const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(','); };
            return { hud: r('#hud'), stage: r('#stage') };
          });
          ok('看一眼卡片也是浮层：开合不动 HUD / 舞台的几何（hud ' + geo1.hud + '，stage ' + geo1.stage + '）',
            geo1.hud === geo0.hud && geo1.stage === geo0.stage);
          await btns.nth(1).click();
          await btns.nth(3).click();
        } else {
          ok('2 号也照常三选一（HUD：' + texts.join(' / ') + '）', cnt === 4 && texts[0] === '选车厢');
          const geo0 = await page.evaluate(() => {
            const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(','); };
            return { hud: r('#hud'), stage: r('#stage') };
          });
          await btns.nth(0).click();
          await page.waitForTimeout(220);                    // hudFloat 入场 160ms，落定再量
          const bub = await page.evaluate(() => {
            const $q = (s) => document.querySelector(s);
            const r = (s) => { const b = $q(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
            const li = $q('#hudList'), lb = li.getBoundingClientRect(), hb = $q('#hud').getBoundingClientRect();
            const ab = $q('#hudBtns .btn').getBoundingClientRect();       // 锚点 = 「选车厢」
            const tail = parseFloat(getComputedStyle(li).getPropertyValue('--tail-x')) || 0;
            const wb = $q('#stagewrap').getBoundingClientRect(), sb = $q('#stage').getBoundingClientRect();
            return {
              on: li.classList.contains('on'),
              hud: r('#hud').join(','), stage: r('#stage').join(','),
              gap: Math.round(hb.top - lb.bottom),
              tailC: lb.left + parseFloat(getComputedStyle(li).borderLeftWidth) + tail,
              btnC: ab.left + ab.width / 2,
              /* 舞台必须待在 stagewrap 里：溢出去就压住顶栏 / 提示行 */
              inside: Math.round(sb.top) >= Math.round(wb.top) && Math.round(sb.bottom) <= Math.round(wb.bottom),
            };
          });
          ok('车厢气泡是浮层：开合不动 HUD / 舞台的几何（hud ' + bub.hud + '，stage ' + bub.stage + '）',
            bub.on && bub.hud === geo0.hud && bub.stage === geo0.stage);
          ok('气泡展开在 HUD 正上方，尖角对着「选车厢」中心（底距 ' + bub.gap + 'px，尖角 ' +
            bub.tailC.toFixed(1) + ' vs 按钮中心 ' + bub.btnC.toFixed(1) + '）',
            bub.gap >= 0 && Math.abs(bub.tailC - bub.btnC) < 2);
          ok('舞台没有溢出 stagewrap（HUD 长高时照新空间重 fit）', bub.inside);
          await page.locator('#hudList .chip-btn').first().click();
          await btns.nth(3).click();
        }
        await page.waitForTimeout(110);
      }
      /* ---- 本轮战报：演完之后才摊出来，确认之后才散场（回站台 + 补票 + 下一轮）。
         先记下结算前的账本：卡上的增减要能逐人对上（存放 = 整个背包进柜、独得 = 背包涨的那些张）。 */
      const before = await page.evaluate(() => {
        const TC = window.TC, S = window.TC_UI.state();
        return { bag: S.players.map(p => TC.total(p.bag)), locker: S.players.map(p => TC.total(p.locker)) };
      });
      ok('全员提交后摆出【开始结算】闸门', await clickSettle(page));
      /* 「回站台」与「去存放」同时在路上 —— 就在这一刻按快门（慢放档里这一小段 ≈ 1s 墙钟） */
      ok('两股人流真的同时在路上', await waitFor(page, 8000, () => window.__retWatch && window.__retWatch.both > 0));
      await shot(page, '10b-return-traffic');

      ok('结算演完摊出本轮战报', await waitFor(page, 20000, () => !!document.querySelector('#summary.on')));
      await page.waitForTimeout(240);                    // riseIn .18s 落定再读（顺带给截图一个不透明的卡）
      const sum = await page.evaluate(() => {
        const TC = window.TC, S = window.TC_UI.state(), F = window.TC_UI.figs();
        const box = document.querySelector('#summary');
        return {
          on: box.classList.contains('on'),
          title: box.querySelector('h3').textContent.replace(/\s+/g, ' '),
          names: S.players.map(p => p.name),
          rows: [].map.call(box.querySelectorAll('.sum-row'), r => ({
            name: r.querySelector('.sum-who b').textContent,
            net: r.querySelector('.sum-net').textContent,
            text: r.textContent.replace(/\s+/g, ' '),
          })),
          bag: S.players.map(p => TC.total(p.bag)),
          locker: S.players.map(p => TC.total(p.locker)),
          cars: S.cars.map(c => TC.total(c.tickets)),
          pool: TC.poolLeft(S),
          away: S.players.map((p, i) => {
            const h = TC.homeSpot(S.N, i);
            return Math.round(Math.hypot(F[i].wx - h.x, F[i].wy - h.y));
          }),
        };
      });
      ok('战报写着「' + sum.title + '」（补票还没发生，仍是第 3 轮）', sum.on && sum.title.indexOf('第 3 轮') >= 0);
      ok('战报按座位顺序一人一行（' + sum.rows.map(r => r.name + ' ' + r.net).join(' · ') + '）',
        sum.rows.length === 3 && sum.rows.every((r, i) => r.name === sum.names[i]));
      /* 存放：整个背包进柜 —— 卡上写「入柜」而不是 0（票没丢），账上背包清零、柜子同额增加 */
      ok('0 号存放 ' + before.bag[0] + ' 张：背包清零、柜子同额增加（柜 ' + before.locker[0] + '→' + sum.locker[0] + '）',
        sum.rows[0].text.indexOf('存放') >= 0 && sum.rows[0].text.indexOf('收进储物柜') >= 0 &&
        sum.rows[0].net === '入柜' &&
        before.bag[0] > 0 && sum.bag[0] === 0 && sum.locker[0] === before.locker[0] + before.bag[0]);
      ok('1 号的回合只有「从储物柜走回站台」，战报净增 0',
        sum.rows[1].text.indexOf('从储物柜走回站台') >= 0 && sum.rows[1].net === '0');
      /* 独得：卡上写的张数必须等于背包涨的那几张 —— 同一份账在两个地方写，对不上就是有一处写错了 */
      const gain2 = sum.bag[2] - before.bag[2];
      const got2 = parseInt((sum.rows[2].text.match(/独得 \d+ 号车厢 (\d+) 张/) || [])[1] || '0', 10);
      ok('2 号独得 ' + got2 + ' 张，战报的净增与实际背包一致（+' + gain2 + '）',
        got2 > 0 && got2 === gain2 && sum.rows[2].net === '+' + gain2);
      ok('战报摊着时人还站在各自的位置上（2 号离自己站位还有 ' + sum.away[2] + ' 单位）', sum.away[2] > 20);
      /* 战报不吃「点背景关闭」（与 #curtain 同理）：确认是流程的一半，
         点背景就关等于替玩家按了确认，散场与补票被一并跳过 */
      const bd = await page.evaluate(() => {
        const box = document.querySelector('#summary');
        const pts = [[6, 6], [innerWidth - 6, 6], [6, innerHeight - 6], [innerWidth - 6, innerHeight - 6]];
        for (let i = 0; i < pts.length; i++) {
          if (document.elementFromPoint(pts[i][0], pts[i][1]) === box) return { x: pts[i][0], y: pts[i][1] };
        }
        return null;
      });
      ok('战报外还留着可点的遮罩（卡片没铺满屏）', !!bd);
      if (bd) await page.mouse.click(bd.x, bd.y);
      await page.waitForTimeout(120);
      ok('点遮罩关不掉战报（只能按「确认」）', await page.locator('#summary.on').count() === 1);
      await shot(page, '11-round-summary');
      await page.click('#sumOk');
      await page.waitForTimeout(120);
      ok('点「确认」战报收起', await page.locator('#summary.on').count() === 0);

      ok('第 3 轮结算完、走到第 4 轮边界', await toBoundary(page, 60000));
      /* 确认之后的账：散场的人回到站台（存放的 0 号照旧留在柜前），车厢按补票规则涨了数。
         补票配额在这里复刻一遍 placeTickets：空车 +2 / 非空 +1，票池见底就按车厢顺序封顶。 */
      const post = await page.evaluate(() => {
        const TC = window.TC, S = window.TC_UI.state(), F = window.TC_UI.figs();
        const lk = TC.lockerStand(S.N, 0);
        return {
          cars: S.cars.map(c => TC.total(c.tickets)),
          pool: TC.poolLeft(S),
          at: S.players.map(p => p.at),
          away: S.players.map((p, i) => {
            const h = TC.homeSpot(S.N, i);
            return Math.round(Math.hypot(F[i].wx - h.x, F[i].wy - h.y));
          }),
          dLocker: Math.round(Math.hypot(F[0].wx - lk.x, F[0].wy - lk.y)),
        };
      });
      let pool = sum.pool;
      const want = sum.cars.map(t => { const need = t > 0 ? 1 : 2; const got = Math.min(need, pool); pool -= got; return got; });
      ok('确认后补票：' + want.map((w, i) => (i + 1) + ' 号 +' + w).join('、') +
        '（' + sum.cars.map((t, i) => t + '→' + post.cars[i]).join(' / ') + '）',
        post.cars.every((v, i) => v === sum.cars[i] + want[i]) &&
        post.pool === sum.pool - want.reduce((a, b) => a + b, 0));
      ok('散场：上过车的人走回站台（2 号离站位 ' + post.away[2] + ' 单位），存放的 0 号留在柜前（离柜 ' + post.dLocker + ' 单位）',
        post.away[2] < 1.5 && post.at[0] === 'locker' && post.dLocker < 1.5);
      const ret = await page.evaluate(() => { clearTimeout(window.__retWatch.timer); return window.__retWatch; });
      console.log('      · 柜前采样：' + ret.atLocker + ' 帧在柜前 / ' + ret.mid + ' 帧在路上 / ' + ret.home +
        ' 帧到家 / ' + ret.both + ' 帧两股人对着走 · 单按钮 HUD 文案计数：' + JSON.stringify(ret.labels));
      ok('柜前那位的回合只有一个按钮，写的就是「回到站台」（' + JSON.stringify(ret.labels) + '）',
        (ret.labels['回到站台'] || 0) > 0);
      ok('他在柜前等完整个选择阶段（' + ret.atLocker + ' 帧采到柜前）', ret.atLocker >= 3);
      ok('他是走回站台的，不是闪现（路上采到 ' + ret.mid + ' 帧）', ret.mid >= 3);
      ok('「回站台」与「去存放」对着走（同帧采到 ' + ret.both + ' 帧）', ret.both >= 3);
      ok('走回站台后落在自己的站位上（' + ret.home + ' 帧采到站位）', ret.home >= 1);
      const back = await page.evaluate(() => {
        const TC = window.TC, S = window.TC_UI.state(), f = window.TC_UI.figs()[1];
        const h = TC.homeSpot(S.N, 1);
        return {
          at: S.players[1].at,
          d: Math.hypot(f.wx - h.x, f.wy - h.y),
          /* 恢复「完整行动」不是看动画：站台上的人上得了车，也不再是「只能回站台」的那个状态 */
          full: TC.legalBoard(S, 1, 0) && !TC.legalReturn(S, 1),
        };
      });
      ok('下一轮他回到站台、恢复完整行动（离站位 ' + back.d.toFixed(1) + ' 单位）',
        back.at === 'platform' && back.d < 1.5 && back.full);
      ok('柜前这一段零报错', page.__errs.length === 0);
      page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 6. 存档续玩 / 日志 / 点遮罩关弹层 ---------- */
    if (section('存档 / 日志 / 点遮罩')) {
      const page = await open(browser);
      ok('本地还没有存档', await page.evaluate(() => window.TC_UI.save()) === null);

      /* 点遮罩关弹层：落点先过 elementFromPoint 验真，免得「其实点到了卡片上」也判过 */
      const backdrop = (id, wrap) => page.evaluate(([id, wrap]) => {
        const box = document.querySelector('#' + id);
        const pts = [[6, 6], [innerWidth - 6, 6], [6, innerHeight - 6], [innerWidth - 6, innerHeight - 6]];
        for (let i = 0; i < pts.length; i++) {
          const el = document.elementFromPoint(pts[i][0], pts[i][1]);
          if (el === box || (wrap && el && el.classList.contains(wrap))) return { x: pts[i][0], y: pts[i][1] };
        }
        return null;
      }, [id, wrap]);

      await page.click('#btnRules');
      await page.waitForTimeout(200);
      const rp = await backdrop('rules', null);
      ok('规则弹层外还留着可点的遮罩', !!rp);
      if (rp) await page.mouse.click(rp.x, rp.y);
      await page.waitForTimeout(200);
      ok('点规则遮罩能关掉弹层', await page.locator('#rules.on').count() === 0);

      await page.click('#btnStart');
      await page.waitForTimeout(240);
      await page.locator('.pl-fig').first().click();
      await page.waitForTimeout(240);
      const pp = await backdrop('palette', 'sheet');
      ok('配色抽屉外还留着可点的遮罩', !!pp);
      if (pp) await page.mouse.click(pp.x, pp.y);
      await page.waitForTimeout(200);
      ok('点抽屉遮罩能关掉抽屉', await page.locator('#palette.on').count() === 0);

      /* ---- 名单就在落盘：刷新后名单要还在 ---- */
      await page.fill('#roster .pl-name', '阿布');
      await page.waitForTimeout(160);
      const sv0 = await page.evaluate(() => window.TC_UI.save());
      ok('名单阶段就已经落盘', !!sv0 && sv0.stage === 'setup');
      await page.reload();
      await page.waitForTimeout(450);
      ok('刷新后自动回到名单屏', await page.locator('#screen-setup.on').count() === 1);
      ok('刷新后填的名字还在', (await page.locator('#roster .pl-name').first().inputValue()) === '阿布');

      /* ---- 发车 → 候车 → 三名乘客各自提交 → 停在演出刚开始的那一刻 ---- */
      await page.click('#btnBegin');
      await page.waitForTimeout(320);
      ok('发车后进了对局屏', await page.locator('#screen-game.on').count() === 1);
      const turns = await runLobby(page, async () => {});
      ok('候车阶段过了三名乘客', turns === 3);
      await page.waitForTimeout(2900);                  // 列车停稳 + 开滑门 + 补票，第一张遮罩立起来
      for (let k = 0; k < 3; k++) {
        if (!(await waitFor(page, 20000, () => !!document.querySelector('#curtain.on')))) break;
        await page.click('#curtainOk');
        await page.waitForTimeout(90);
        await doPick(page, k);
        await page.waitForTimeout(90);
      }
      /* ---- 三人提交完不会自己开演：HUD 摆出【开始结算】，点了才走结算 ---- */
      ok('全员提交后摆出【开始结算】闸门', await waitFor(page, 8000, () => !!document.querySelector('#btnSettle')));
      const gate = await page.evaluate(() => {
        const S = window.TC_UI.state();
        return {
          n: document.querySelectorAll('#hudBtns .btn').length,
          label: (document.querySelector('#btnSettle') || {}).textContent || '',
          prompt: document.querySelector('#hudPrompt').textContent,
          submitted: S.submitted.length, resolved: S.resolved, round: S.round,
        };
      });
      ok('闸门是整排里唯一一颗，写的就是「开始结算」（HUD：' + gate.label + '）',
        gate.n === 1 && gate.label === '开始结算');
      ok('闸门上的提示交代了几位都交上来了（' + gate.prompt + '）',
        gate.prompt.indexOf(gate.submitted + ' 位乘客都已提交') === 0);
      await page.waitForTimeout(900);                   // 等一会儿：没人点它就不该动
      const idle = await page.evaluate(() => {
        const S = window.TC_UI.state();
        return { resolved: S.resolved, round: S.round, over: document.querySelector('#screen-over').classList.contains('on') };
      });
      ok('不点闸门就不结算（resolved 还是 ' + idle.resolved + '，第 ' + idle.round + ' 轮）',
        idle.resolved === gate.resolved && idle.round === gate.round && !idle.over);
      await page.click('#btnSettle');
      await page.waitForTimeout(320);                   // 点了闸门 → 结算已发生、演出刚开演（慢放档）
      const sv1 = await page.evaluate(() => window.TC_UI.save());
      ok('演出开演时状态已落盘且 stage=show', !!sv1 && sv1.stage === 'show');
      ok('落盘的快照里已经有本轮的结算结果',
        !!sv1 && sv1.S.resolved === 1 && sv1.S.round === 1 && sv1.S.hist.length === 1);
      const svOk = sv1 ? await page.evaluate(s => window.TC.validate(s).ok, sv1.S) : false;
      ok('落盘的快照票数守恒', svOk);

      /* ---- 演出中途刷新：结果不丢、不重复结算、直接续上 ---- */
      await page.reload();
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => {
        const S = window.TC_UI.state();
        return {
          game: document.querySelector('#screen-game').classList.contains('on'),
          menu: document.querySelector('#screen-menu').classList.contains('on'),
          round: S.round, resolved: S.resolved, hist: S.hist.length,
          ok: window.TC.validate(S).ok,
        };
      });
      ok('刷新后没有掉回封面，直接续在对局屏', after.game && !after.menu);
      ok('上一轮不重演也不重复结算', after.resolved === 1 && after.hist === 1);
      ok('续玩后补票只发生一次（票数守恒）', after.ok);
      ok('续玩后直接推进到第 2 轮', after.round === 2);

      /* ---- 日志：倒序、跨刷新保留、可清空 ---- */
      /* 用 JS click 而不是鼠标点：续玩时会立刻进入下一轮的传手机遮罩（z30）盖住顶栏，
         鼠标点会被 curtain 拦截。日志面板 z52 在遮罩之上，照样看得见。 */
      await page.evaluate(() => document.querySelector('#btnLog').click());
      await page.waitForTimeout(240);
      ok('日志面板能打开', await page.locator('#logbox.on').count() === 1);
      const rows = await page.locator('#logBody .log-row').count();
      ok('日志里有内容（' + rows + ' 行）', rows >= 8);
      await shot(page, '08-logbox');
      const newest = await page.evaluate(() => { const l = window.TC_UI.log(); return l[l.length - 1].s; });
      const first = (await page.locator('#logBody .log-row').first().textContent()) || '';
      ok('日志是倒序（第一条就是最新那条）', first.indexOf(newest) >= 0);
      ok('刷新续玩也记进了日志', await page.evaluate(() => window.TC_UI.log().some(e => e.s.indexOf('读取存档') >= 0)));
      ok('日志条数被缓冲上限压住', await page.evaluate(() => window.TC_UI.log().length <= 400));
      await page.click('#logClear');
      await page.waitForTimeout(180);
      ok('清空后只剩「已清空」那一条', await page.locator('#logBody .log-row').count() <= 1);
      await page.click('#logClose');
      await page.waitForTimeout(180);
      ok('日志面板能收起', await page.locator('#logbox.on').count() === 0);
      await page.evaluate(() => document.querySelector('#btnLog').click());
      await page.waitForTimeout(180);
      const lp = await backdrop('logbox', null);
      ok('日志面板外还留着可点的遮罩', !!lp);
      if (lp) await page.mouse.click(lp.x, lp.y);
      await page.waitForTimeout(180);
      ok('点日志遮罩也能收起', await page.locator('#logbox.on').count() === 0);

      ok('存档 / 日志这一段零报错', page.__errs.length === 0);
      page.__errs.slice(0, 6).forEach(e => console.log('      · ' + e));
      await page.close();
    }

    /* ---------- 5. 静默演出 ---------- */
    if (section('静默演出 / reduced-motion')) {
      const page = await open(browser, { reduced: true });
      ok('reduced-motion 下启动即静默', (await page.evaluate(() => window.TC_UI.fxOn())) === false);

      /* 静默下 fxWait 立即兑现，整局应该飞快跑完；选择与结算逻辑不受影响 */
      const s = await playTo(page, 40, false);
      ok('静默模式能走完整局', s.phase === 'over');
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
