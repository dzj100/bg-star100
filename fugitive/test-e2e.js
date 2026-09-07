/* 神探缉凶 v2 端到端测试（新规则：掩护标记 / 任意数字猜测 / 42 约束 / 搜捕） */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(__dirname, 'shots');
if(!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, {recursive:true});

let failures = 0;
function assert(cond, msg){ if(!cond){ throw new Error('ASSERT FAIL: ' + msg); } }
async function shot(page, name){
  try { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
  catch(e){ console.log('  [shot err]', name, e.message); }
}
const stateOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(state)));
async function waitFor(page, fn, timeout, label, ...args){
  const t0 = Date.now();
  const limit = timeout || 20000;
  while(Date.now()-t0 < limit){
    let ok = false;
    try { ok = await page.evaluate(fn, ...args); } catch(e){ ok = false; }
    if(ok) return;
    await page.waitForTimeout(150);
  }
  throw new Error('TIMEOUT waiting: ' + (label || fn.toString()));
}
async function logs(page){ return page.evaluate(() => state.log.map(l => l.msg)); }
// 点击手牌卡（数字精确匹配，忽略掩护标记点）
async function clickHandCard(page, n){
  const ok = await page.evaluate((num) => {
    const btns = [...document.querySelectorAll('#hand .h-card')];
    const b = btns.find(x => parseInt(x.textContent, 10) === num);
    if(!b) return false;
    b.click();
    return true;
  }, n);
  assert(ok, '手牌卡 ' + n + ' 未找到');
  await page.waitForTimeout(60);
}
async function clickGrid(page, n){
  const sel = '.g-cell[data-n="' + n + '"]';
  const disabled = await page.$eval(sel, el => el.disabled).catch(() => null);
  assert(disabled !== null, '网格 ' + n + ' 不存在');
  assert(!disabled, '网格 ' + n + ' 应可点（当前 disabled）');
  await page.click(sel);
  await page.waitForTimeout(60);
}
async function freshGame(page, role){
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.evaluate((r) => newGame(r), role);
  await page.waitForTimeout(120);
}
async function freshGameMode(page, role, mode){
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.evaluate((a) => newGame(a.role, a.mode), { role, mode });
  await page.waitForTimeout(120);
}
async function setup(page, patch){
  await page.evaluate((p) => {
    if(p.route !== undefined) state.fug.route = p.route;
    if(p.hand !== undefined) state.fug.hand = p.hand;
    if(p.marHand !== undefined) state.mar.hand = p.marHand;
    if(p.turn !== undefined) state.turn = p.turn;
    if(p.firstTurn !== undefined) state.firstTurn = p.firstTurn;
    if(p.needDraw !== undefined) state.needDraw = p.needDraw;
    if(p.phase !== undefined) state.phase = p.phase;
    if(p.humanRole !== undefined) state.humanRole = p.humanRole;
    if(p.missed !== undefined) state.marMissed = p.missed;
    if(p.piles !== undefined) state.piles = p.piles;
    save(); render();
  }, patch);
  await page.waitForTimeout(80);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const t0 = Date.now();

  try {
    /* ============ A. 登录页 ============ */
    console.log('A. 登录页');
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await waitFor(page, () => !!document.querySelector('#landing'), 5000, '登录页');
    await shot(page, '1-landing');

    /* ============ B. 大盗首回合放 1 张 ============ */
    console.log('B. 大盗首回合放 1 张');
    await page.click('#landing .role-btn >> nth=0'); // 扮演大盗
    // 初始手牌直接全部展示，无发牌动画
    await page.waitForTimeout(120);
    let handCount = await page.evaluate(() => document.querySelectorAll('#hand .h-card:not(.ph)').length);
    assert(handCount === 9, '大盗 9 张手牌全部展示（实际 ' + handCount + '）');
    await shot(page, '2-fug-hand');
    let st = await stateOf(page);
    assert(st.phase === 'playing' && st.turn === 'fugitive' && st.firstTurn, '开局大盗回合');
    assert(st.fug.hand.length === 9, '大盗 9 张手牌');
    await clickHandCard(page, 1); // 主牌 1（起点 0 → 差 1）
    await page.click('#actions .btn-primary'); // 放置
    st = await stateOf(page);
    assert(st.fug.route.length === 1 && st.fug.route[0].num === 1 && st.fug.route[0].hidden, '首回合第 1 张暗放');
    assert(st.turn === 'fugitive', '首回合放 1 张后仍在大盗回合');
    await shot(page, '2-fug-first-1');
    await page.click('#actions >> text=结束回合');
    st = await stateOf(page);
    assert(!st.firstTurn && st.turn === 'marshal', '结束回合后轮到警探');

    /* ============ C. AI 警探首回合（抽 2 + 必猜） ============ */
    console.log('C. AI 警探首回合');
    await freshGame(page, 'fugitive');
    await setup(page, {
      route: [
        { num:1, hidden:true, cover:[] },
        { num:2, hidden:true, cover:[] },
      ],
      marHand: [],
      turn:'marshal', needDraw:true,
    });
    await page.evaluate(() => {
      state.mar.firstDraw = true; state.mar.drawCount = 0;
      save(); scheduleAI();
    });
    await waitFor(page, () => state.mar.hand.length === 2, 20000, 'AI 警探抽 2 张');
    st = await stateOf(page);
    assert(st.needDraw === false, '警探抽完进入猜测');
    await waitFor(page, () => state.turn === 'fugitive', 20000, 'AI 警探完成猜测');
    const lgC = await logs(page);
    assert(lgC.some(l => l.includes('猜中') || l.includes('未命中')), 'AI 警探必须猜测');
    await shot(page, '3-fug-after-ai');

    /* ============ D. 掩护机制：差 7 用 4+6 掩护打出 12 ============ */
    console.log('D. 掩护机制');
    await setup(page, {
      route: [{ num:5, hidden:true, cover:[] }],
      hand: [4,6,12,15,20,30,35,42],
      turn:'fugitive', needDraw:false, firstTurn:false,
    });
    await clickHandCard(page, 12); // 主牌
    await clickHandCard(page, 4);  // 掩护（偶数 2 标记）
    await clickHandCard(page, 6);  // 掩护（偶数 2 标记）
    await shot(page, '4-fug-cover-select');
    await page.click('#actions .btn-primary');
    st = await stateOf(page);
    const last = st.fug.route[st.fug.route.length-1];
    assert(last.num === 12 && last.hidden, '掩护打出 12');
    assert(JSON.stringify(last.cover) === JSON.stringify([4,6]), '掩护牌 4,6 记录');
    assert(st.turn === 'marshal', '放置后轮到警探');
    // 掩护不足场景：差 7 只有 1 个掩护标记 → 放置按钮禁用 + 被拒
    await setup(page, {
      route: [{ num:5, hidden:true, cover:[] }],
      hand: [9,12,15,20,30,35,42], // 9 是奇数 1 标记 → 上限 5+3+1=9 <12
      turn:'fugitive', needDraw:false, firstTurn:false,
    });
    await clickHandCard(page, 12);
    await clickHandCard(page, 9);
    const denied = JSON.parse(await page.evaluate(() => {
      const b = document.querySelector('#actions .btn-primary');
      const res = fugPlace(ui.selMain, ui.selCover);
      return JSON.stringify({ wasDisabled: b ? b.disabled : 'NO BTN', ok: res.ok, reason: res.reason, len: state.fug.route.length });
    }));
    assert(denied.wasDisabled === true, '掩护不足时放置按钮禁用');
    assert(denied.ok === false, '掩护不足时放置被拒: ' + denied.reason);
    assert(denied.len === 1, '掩护不足不能放置（路线不变）');
    await shot(page, '4b-cover-insufficient');

    /* ============ E. 大盗跳过 ============ */
    console.log('E. 大盗跳过');
    await setup(page, {
      route: [{ num:5, hidden:true, cover:[] }],
      hand: [20,21,22,42], // 全部差 >3 且掩护标记不足
      turn:'fugitive', needDraw:false, firstTurn:false,
    });
    await page.click('#actions >> text=跳过');
    st = await stateOf(page);
    assert(st.turn === 'marshal', '跳过结束回合');

    /* ============ F. 42 受约束：last=38 需 1 掩护标记 ============ */
    console.log('F. 42 约束');
    await setup(page, {
      route: [{ num:38, hidden:false, cover:[] }],
      hand: [41,42],
      turn:'fugitive', needDraw:false, firstTurn:false,
    });
    await clickHandCard(page, 42);
    // 无掩护直接放：上限 41 <42 → 按钮禁用 + 被拒
    const fRej = JSON.parse(await page.evaluate(() => {
      const b = document.querySelector('#actions .btn-primary');
      const res = fugPlace(ui.selMain, ui.selCover);
      return JSON.stringify({ wasDisabled: b ? b.disabled : 'NO BTN', ok: res.ok, reason: res.reason, len: state.fug.route.length });
    }));
    assert(fRej.wasDisabled === true, '42 无掩护放置按钮禁用');
    assert(fRej.ok === false, '42 无掩护被拒: ' + fRej.reason);
    assert(fRej.len === 1, '42 无掩护不可放（38+3=41<42）');
    await clickHandCard(page, 41); // 掩护（奇数 1 标记）
    await page.click('#actions .btn-primary');
    st = await stateOf(page);
    const r42 = st.fug.route[st.fug.route.length-1];
    assert(r42.num === 42 && r42.hidden === false, '42 面朝上打出');
    assert(r42.cover.length === 1, '42 带掩护');
    assert(st.phase === 'over' && st.winner === 'fugitive', 'maxOpen=38≥30 → 直接逃脱');
    await shot(page, '5-over-fug-42');

    /* ============ G. 搜捕：maxOpen<30 触发，AI 警探依次猜中获胜 ============ */
    console.log('G. 搜捕触发 + AI 警探搜捕胜');
    await freshGame(page, 'fugitive');
    await setup(page, {
      route: [
        { num:25, hidden:false, cover:[] },
        { num:27, hidden:true, cover:[] },
      ],
      hand: [26,28,30,32,34,36,38,40,42], // 掩护 7 张偶数 = 14 标记 → 25+3+14=42
      turn:'fugitive', needDraw:false, firstTurn:false,
    });
    await clickHandCard(page, 42);
    for(const c of [26,28,30,32,34,36,38]) await clickHandCard(page, c);
    await page.click('#actions .btn-primary');
    st = await stateOf(page);
    assert(st.phase === 'manhunt', 'maxOpen=25<30 → 搜捕');
    await shot(page, '6-manhunt-start');
    // AI 警探：唯一候选 27（26/28 已作为掩护公开）→ 猜中 → 全翻 → 警探胜
    await waitFor(page, () => state.phase === 'over', 20000, '搜捕结束');
    st = await stateOf(page);
    assert(st.winner === 'marshal', '搜捕中 AI 全猜对 → 警探胜');
    await shot(page, '7-over-mar-manhunt');

    /* ============ H. 警探身份：AI 大盗首回合 + 数字网格 ============ */
    console.log('H. 警探视角');
    await freshGame(page, 'marshal');
    await waitFor(page, () => state.turn === 'marshal', 20000, 'AI 大盗首回合结束');
    st = await stateOf(page);
    assert(st.fug.route.length >= 1 && st.fug.route.length <= 2, 'AI 首回合放 1~2 张');
    // 玩家警探抽 2 张
    await waitFor(page, () => state.needDraw && state.turn === 'marshal', 5000, '警探抽牌');
    // 摸牌阶段点击网格 → 吐司提示「先进行摸牌」
    await page.click('.g-cell[data-n="35"]');
    const toastTxt = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t ? t.textContent + '|' + t.className : 'NO TOAST';
    });
    assert(toastTxt.includes('先进行摸牌') && toastTxt.includes('show'), '摸牌阶段点击网格显示吐司（' + toastTxt + '）');
    await page.waitForTimeout(1900); // 等吐司消失
    // 标记模式是私人笔记：摸牌前也可先标「怀疑」（猜测仍须先摸牌，H 上方已验）
    await page.evaluate(() => document.querySelector('.grid-mode-btn').click()); // 猜测 → 标记
    await page.click('.g-cell[data-n="30"]');
    st = await stateOf(page);
    assert(st.mar.marks && st.mar.marks[30] === 1, '标记模式：摸牌前可先标怀疑');
    assert(st.needDraw === true && st.mar.hand.length === 0, '标记不改变摸牌阶段状态');
    const markToast = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t ? t.textContent + '|' + t.className : 'NO TOAST';
    });
    assert(!markToast.includes('show'), '摸牌前标记不弹吐司（' + markToast + '）');
    await shot(page, '8b-mark-predraw');
    await page.evaluate(() => document.querySelector('.grid-mode-btn').click()); // 标记 → 猜测，继续后续摸牌流程
    await page.evaluate(() => marDrawClick('A'));
    await page.evaluate(() => marDrawClick('B'));
    st = await stateOf(page);
    assert(st.mar.hand.length === 2 && !st.needDraw, '警探抽 2 张');
    await shot(page, '8-mar-grid');

    /* ============ I. 猜错不消耗 + 任意数字 + 手牌排除 ============ */
    console.log('I. 猜错不消耗');
    st = await stateOf(page);
    const handBefore = [...st.mar.hand];
    // 从 2 起选，避免与日志中的猜测张数「1 张」撞车；须排除路线内所有数字（含暗牌）
    const notInHand = [2,3,4,5,6,7,8,9,10].find(n => !handBefore.includes(n) && !st.fug.route.some(r => r.num===n) && !st.marMissed.includes(n));
    const handNum = handBefore[0];
    // 手牌数字应置灰（已知不在暗牌）
    const handDisabled = await page.$eval('.g-cell[data-n="' + handNum + '"]', el => el.disabled);
    assert(handDisabled, '手牌数字置灰不可猜');
    await clickGrid(page, notInHand); // 猜手牌外的数字
    await page.click('#actions .btn-primary');
    // 猜测流程已异步化（气泡 600ms + 回应 500ms）→ 用 waitFor 等结算
    await waitFor(page, (n) => state.marMissed.includes(n), 15000, '猜错记入统计', notInHand);
    // 固定 AI 大盗无法再放牌（清空手牌 → 只会摸牌后跳过），保证断言确定性
    await page.evaluate(() => { state.fug.hand = []; save(); });
    st = await stateOf(page);
    assert(st.mar.hand.length === 2, '猜错不消耗手牌');
    const lgI = await logs(page);
    assert(lgI.some(l => l.includes('未命中') && l.includes(String(notInHand))), '未命中日志保留数字');
    // 猜过未中的数字不置灰（大盗日后可能打出），先等 AI 大盗行动、回警探回合并抽 1 张
    await waitFor(page, () => state.turn === 'marshal' && state.needDraw, 20000, 'AI 大盗行动后回警探');
    await page.evaluate(() => marDrawClick('A'));
    st = await stateOf(page);
    assert(st.mar.hand.length === 3, '警探再抽 1 张');
    const missedDisabled = await page.$eval('.g-cell[data-n="' + notInHand + '"]', el => el.disabled);
    assert(!missedDisabled, '猜过未中的数字不置灰（可再猜）');
    await shot(page, '9-mar-missed');

    /* ============ J. 多猜：全中才翻，否则一张不翻 ============ */
    console.log('J. 多猜全中才翻');
    await setup(page, {
      route: [
        { num:25, hidden:false, cover:[] },
        { num:27, hidden:true, cover:[] },
        { num:30, hidden:true, cover:[] },
      ],
      hand: [], // AI 大盗无手牌 → 只会跳过，不改变路线
      piles: { A:[], B:[], C:[] }, // 无堆可抽 → 无手牌 → 必跳过
      marHand: [5,6,7],
      turn:'marshal', needDraw:false, humanRole:'marshal', missed: [],
    });
    await clickGrid(page, 27);
    await clickGrid(page, 29); // 29 不在暗牌
    await page.click('#actions .btn-primary');
    await waitFor(page, () => state.turn === 'fugitive', 15000, '多猜失败后回合结束');
    st = await stateOf(page);
    assert(st.fug.route[1].hidden === true && st.fug.route[2].hidden === true, '多猜含错 → 一张不翻');
    await waitFor(page, () => state.turn === 'marshal', 20000, 'AI 大盗行动后回警探');
    await setup(page, { turn:'marshal', needDraw:false });
    await clickGrid(page, 27);
    await clickGrid(page, 30);
    await page.click('#actions .btn-primary');
    await waitFor(page, () => state.phase === 'over', 15000, '多猜全中结算');
    st = await stateOf(page);
    assert(st.fug.route[1].hidden === false && st.fug.route[2].hidden === false, '多猜全中 → 全翻');
    assert(st.winner === 'marshal', '全翻 → 警探胜');
    await shot(page, '10-over-mar-multi');

    /* ============ K. 玩家警探搜捕：猜中翻完胜 / 猜错败 ============ */
    console.log('K. 玩家警探搜捕');
    await freshGame(page, 'marshal');
    await setup(page, {
      phase:'manhunt',
      route: [
        { num:25, hidden:false, cover:[] },
        { num:27, hidden:true, cover:[] },
      ],
      marHand: [3,4,5],
      turn:'marshal', needDraw:false, humanRole:'marshal', missed: [],
    });
    await shot(page, '11-manhunt-human');
    await clickGrid(page, 27);
    await page.click('#actions .btn-primary');
    await waitFor(page, () => state.phase === 'over', 15000, '搜捕猜中结算');
    st = await stateOf(page);
    assert(st.winner === 'marshal', '搜捕猜中全部 → 警探胜');
    await shot(page, '12-over-mar-manhunt-win');

    // 搜捕猜错 → 大盗胜
    await freshGame(page, 'marshal');
    await setup(page, {
      phase:'manhunt',
      route: [
        { num:25, hidden:false, cover:[] },
        { num:27, hidden:true, cover:[] },
      ],
      marHand: [3,4,5],
      turn:'marshal', needDraw:false, humanRole:'marshal', missed: [],
    });
    await clickGrid(page, 29);
    await page.click('#actions .btn-primary');
    await waitFor(page, () => state.phase === 'over', 15000, '搜捕猜错结算');
    st = await stateOf(page);
    assert(st.winner === 'fugitive', '搜捕猜错 → 大盗胜');
    await shot(page, '13-over-fug-manhunt-lose');

    /* ============ L. 大盗首回合放 2 张 ============ */
    console.log('L. 首回合 2 张');
    await freshGame(page, 'fugitive');
    st = await stateOf(page);
    const p1 = Math.min(...st.fug.hand.filter(v => v>=1 && v<=3));
    await clickHandCard(page, p1);
    await page.click('#actions .btn-primary');
    st = await stateOf(page);
    assert(st.turn === 'fugitive' && st.fug.route.length === 1, '第 1 张后仍在大盗回合');
    const p2 = Math.min(...st.fug.hand.filter(v => v - st.fug.route[0].num >= 1 && v - st.fug.route[0].num <= 3));
    await clickHandCard(page, p2);
    await page.click('#actions .btn-primary');
    st = await stateOf(page);
    assert(st.fug.route.length === 2 && st.turn === 'marshal', '第 2 张后自动结束回合');
    await shot(page, '14-fug-first-2');

    /* ============ M. 猜测气泡对话 + 翻面动画 ============ */
    console.log('M. 气泡 + 翻面');
    await freshGame(page, 'marshal');
    await setup(page, {
      route: [
        { num:25, hidden:false, cover:[] },
        { num:27, hidden:true, cover:[] },
      ],
      marHand: [3,4,5],
      turn:'marshal', needDraw:false, humanRole:'marshal', missed: [],
    });
    await clickGrid(page, 27);
    await page.click('#actions .btn-primary');
    // 警探气泡先出现
    await waitFor(page, () => {
      const b = document.querySelector('#bubble-layer .bubble-mar');
      return b && b.textContent.includes('27');
    }, 5000, '警探气泡');
    await shot(page, '15-bubble');
    // 600ms 后大盗回应气泡
    await waitFor(page, () => {
      const b = document.querySelector('#bubble-layer .bubble-fug');
      return b && b.textContent.includes('猜对了');
    }, 6000, '大盗回应气泡');
    await shot(page, '15-bubble-reply');
    // 500ms 后翻面：暗牌翻开 → 警探胜
    await waitFor(page, () => state.phase === 'over' && state.fug.route[1].hidden === false, 15000, '猜中翻面结算');
    st = await stateOf(page);
    assert(st.winner === 'marshal', '气泡流程后警探胜');
    await shot(page, '15-bubble-flip');

    // 猜错回应气泡
    await freshGame(page, 'marshal');
    await setup(page, {
      route: [
        { num:25, hidden:false, cover:[] },
        { num:27, hidden:true, cover:[] },
      ],
      marHand: [3,4,5],
      turn:'marshal', needDraw:false, humanRole:'marshal', missed: [],
    });
    await clickGrid(page, 29);
    await page.click('#actions .btn-primary');
    await waitFor(page, () => {
      const b = document.querySelector('#bubble-layer .bubble-fug');
      return b && b.textContent.includes('猜错了');
    }, 6000, '猜错回应气泡');
    await waitFor(page, () => state.marMissed.includes(29), 15000, '猜错记入');

    /* ============ N. 大盗检查暗置牌 / 翻开牌查看掩护牌 ============ */
    console.log('N. 大盗检查暗牌');
    await freshGame(page, 'fugitive');
    await setup(page, {
      route: [
        { num:5, hidden:true, cover:[3] },
        { num:9, hidden:false, cover:[7,8] },
      ],
      turn:'fugitive', needDraw:false, firstTurn:false,
    });
    const chkCount = await page.evaluate(() => document.querySelectorAll('#track .t-card.chk').length);
    assert(chkCount === 2, '大盗视角：暗牌 + 已翻开带掩护牌均可点（2 张 chk）');
    // 暗牌检查抽屉
    await page.click('#track .t-card[data-i="0"]');
    await waitFor(page, () => document.getElementById('sheet').classList.contains('show'), 5000, '检查抽屉弹出');
    const chkBody = await page.evaluate(() => document.getElementById('sheet-body').textContent);
    assert(chkBody.includes('5'), '检查抽屉显示地点牌数字');
    assert(chkBody.includes('3'), '检查抽屉显示掩护牌数字');
    await page.waitForTimeout(400); // 等抽屉滑入动画完成
    await shot(page, '16-fug-check');
    await page.evaluate(() => closeSheet());
    // 已翻开牌查看掩护牌抽屉
    await page.click('#track .t-card[data-i="1"]');
    await waitFor(page, () => document.getElementById('sheet').classList.contains('show'), 5000, '翻开牌抽屉弹出');
    const openBody = await page.evaluate(() => document.getElementById('sheet-body').textContent);
    assert(openBody.includes('9'), '抽屉显示翻开牌数字');
    assert(openBody.includes('7') && openBody.includes('8'), '抽屉显示掩护牌数字');
    await page.evaluate(() => closeSheet());
    // 警探视角：暗牌不可检查，但已翻开带掩护牌仍可查看
    await page.evaluate(() => { state.humanRole = 'marshal'; render(); });
    const chkMar = await page.evaluate(() => document.querySelectorAll('#track .t-card.chk').length);
    assert(chkMar === 1, '警探视角仅已翻开带掩护牌可点（1 张 chk）');
    const hiddenClickable = await page.evaluate(() => !!document.querySelector('#track .t-card[data-i="0"]').getAttribute('onclick'));
    assert(!hiddenClickable, '警探视角暗牌不可点击');
    await page.click('#track .t-card[data-i="1"]');
    await waitFor(page, () => document.getElementById('sheet').classList.contains('show'), 5000, '警探查看翻开牌抽屉');
    const marOpenBody = await page.evaluate(() => document.getElementById('sheet-body').textContent);
    assert(marOpenBody.includes('7'), '警探抽屉显示掩护牌');
    await page.evaluate(() => closeSheet());

    /* ============ O. 警探 1~42 标记网格 ============ */
    console.log('O. 标记网格');
    await freshGame(page, 'marshal');
    await setup(page, {
      route: [
        { num:25, hidden:false, cover:[22] },
        { num:27, hidden:true, cover:[] },
      ],
      marHand: [5,6],
      turn:'marshal', needDraw:false, humanRole:'marshal', missed: [],
    });
    const gCells = await page.evaluate(() => document.querySelectorAll('.g-cell').length);
    assert(gCells === 42, '网格共 42 格（实际 ' + gCells + '）');
    const gCols = await page.evaluate(() => getComputedStyle(document.querySelector('.num-grid')).gridTemplateColumns.split(' ').length);
    assert(gCols === 7, '网格 7 列（实际 ' + gCols + '）');
    const autoCls = await page.evaluate(() => ({
      open: document.querySelector('.g-cell[data-n="25"]').className,
      cover: document.querySelector('.g-cell[data-n="22"]').className,
      hand: document.querySelector('.g-cell[data-n="5"]').className,
    }));
    assert(autoCls.open.includes('m-open'), '已翻开 → 绿色');
    assert(autoCls.cover.includes('m-cover'), '掩护牌 → 浅绿');
    assert(autoCls.hand.includes('m-hand'), '手牌 → 蓝色');
    // 切标记模式手动标记
    await page.evaluate(() => toggleGridMode());
    const modeBtn = await page.evaluate(() => document.querySelector('.grid-mode-btn').textContent);
    assert(modeBtn.includes('标记模式'), '切到标记模式');
    await clickGrid(page, 29);
    const marked = await page.evaluate(() => ({
      cls: document.querySelector('.g-cell[data-n="29"]').className,
      marks: state.mar.marks[29],
    }));
    assert(marked.cls.includes('m-suspect') && marked.marks === 1, '点击标记怀疑（黄色）');
    await clickGrid(page, 29); // 再点取消
    const unmarked = await page.evaluate(() => state.mar.marks[29] === undefined);
    assert(unmarked, '再点取消标记');
    // 标记模式下点击暗牌数字不加入猜测选择
    await clickGrid(page, 27);
    const noSel = await page.evaluate(() => ui.gridSel.length === 0 && state.mar.marks[27] === 1);
    assert(noSel, '标记模式不进入猜测选择');
    await shot(page, '17-mar-grid-marks');
    await page.evaluate(() => toggleGridMode()); // 切回猜测模式

    /* ============ P. 单行日志 + 抽屉倒序 ============ */
    console.log('P. 日志抽屉');
    await freshGame(page, 'marshal');
    await setup(page, {
      route: [
        { num:25, hidden:false, cover:[] },
        { num:27, hidden:true, cover:[] },
      ],
      marHand: [3,4,5],
      turn:'marshal', needDraw:false, humanRole:'marshal', missed: [],
    });
    const logLineCount = await page.evaluate(() => document.querySelectorAll('#log .ld-msg').length);
    assert(logLineCount === 1, '日志仅一行');
    const lastMsg = await page.evaluate(() => state.log[state.log.length-1].msg);
    await page.click('#log');
    await waitFor(page, () => document.getElementById('sheet').classList.contains('show'), 5000, '日志抽屉弹出');
    const drawerTitle = await page.evaluate(() => document.getElementById('sheet-title').textContent);
    assert(drawerTitle.includes('操作日志'), '抽屉标题含操作日志');
    const firstItem = await page.evaluate(() => document.querySelector('#sheet-body .ld-item').textContent);
    assert(firstItem.includes(lastMsg), '抽屉首条为最新日志');
    const drawerCount = await page.evaluate(() => document.querySelectorAll('#sheet-body .ld-item').length);
    const curLog = await stateOf(page);
    assert(drawerCount === curLog.log.length, '抽屉条数 = 日志条数');
    await page.waitForTimeout(400); // 等抽屉滑入动画完成
    await shot(page, '18-log-drawer');

    /* ============ Q. 怪盗模式：登录页开关 + 开局 12 张 + 再来一局保持 ============ */
    console.log('Q. 怪盗模式 · 登录页与开局');
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await waitFor(page, () => !!document.querySelector('#landing'), 5000, '登录页');
    const defNormal = await page.evaluate(() => {
      const sels = document.querySelectorAll('.mp-opt.sel');
      return sels.length === 1 && sels[0].textContent.includes('普通');
    });
    assert(defNormal, '登录页默认选中普通模式');
    await shot(page, 'q1-landing-mode');
    await page.click('.mp-opt >> nth=1'); // 切到怪盗
    const pickedPhantom = await page.evaluate(() => {
      const sels = document.querySelectorAll('.mp-opt.sel');
      return sels.length === 1 && sels[0].textContent.includes('怪盗');
    });
    assert(pickedPhantom, '选中怪盗模式');
    await shot(page, 'q1b-landing-mode-phantom');
    await page.click('#landing .role-btn >> nth=0'); // 扮演大盗
    await page.waitForTimeout(150);
    let ph = await stateOf(page);
    assert(ph.mode === 'phantom', 'state.mode = phantom');
    assert(ph.fug.hand.length === 12, '怪盗开局大盗 12 张（实际 ' + ph.fug.hand.length + '）');
    for(const fixed of [1,2,3,42]) assert(ph.fug.hand.includes(fixed), '手牌含固定牌 ' + fixed);
    assert(ph.piles.A.length === 7 && ph.piles.B.length === 11 && ph.piles.C.length === 12,
      '三堆余量 A7/B11/C12（实际 ' + ph.piles.A.length + '/' + ph.piles.B.length + '/' + ph.piles.C.length + '）');
    const aCnt = ph.fug.hand.filter(n=>n>=4&&n<=14).length;  // A 范围（4~14）抽 4
    const bCnt = ph.fug.hand.filter(n=>n>=15&&n<=28).length; // B 范围（15~28）抽 3
    const cCnt = ph.fug.hand.filter(n=>n>=29&&n<=41).length; // C 范围（29~41）抽 1
    assert(aCnt === 4 && bCnt === 3 && cCnt === 1, '抽取分布 A4/B3/C1（实际 ' + aCnt + '/' + bCnt + '/' + cCnt + '）');
    assert(new Set(ph.fug.hand).size === 12, '手牌无重复');
    const chipQ = await page.evaluate(() => { const el = document.querySelector('.mode-chip'); return el ? el.textContent.trim() : null; });
    assert(chipQ && chipQ.includes('怪盗'), '顶栏显示怪盗徽标');
    const handShownQ = await page.evaluate(() => document.querySelectorAll('#hand .h-card:not(.ph)').length);
    assert(handShownQ === 12, '手牌区展示 12 张');
    await shot(page, 'q2-phantom-fug-hand');
    // 再来一局保持怪盗（补到结算页点按钮触发）
    await page.evaluate(() => { state.phase='over'; state.winner='fugitive'; save(); render(); });
    await page.click('#actions >> text=再来一局');
    await page.waitForTimeout(150);
    ph = await stateOf(page);
    assert(ph.phase === 'playing' && ph.mode === 'phantom' && ph.fug.hand.length === 12, '再来一局保持怪盗 12 张');

    /* ============ R. 怪盗模式：人类警探 vs AI 大盗（AI 12 张正常行动） ============ */
    console.log('R. 怪盗模式 · 人类警探 vs AI 大盗');
    await freshGameMode(page, 'marshal', 'phantom');
    let sr = await stateOf(page);
    assert(sr.mode === 'phantom' && sr.turn === 'fugitive' && sr.firstTurn, '开局 AI 大盗回合 · 怪盗');
    assert(sr.fug.hand.length === 12 && sr.piles.A.length === 7, 'AI 大盗 12 张开局');
    await waitFor(page, () => state.turn === 'marshal', 20000, 'AI 大盗完成首回合');
    sr = await stateOf(page);
    assert(sr.fug.route.length >= 1 && sr.fug.route.length <= 2, 'AI 大盗首回合放置 1~2 张');
    assert(sr.fug.route[0].num >= 1 && sr.fug.route[0].num <= 3, '首张暗牌在 1~3');
    const spent = sr.fug.route.reduce((s, r) => s + 1 + (r.cover || []).length, 0); // 主牌 + 掩护都离开手牌
    assert(sr.fug.hand.length === 12 - spent, 'AI 手牌随放置相应减少（剩 ' + sr.fug.hand.length + '，共打出 ' + spent + '）');
    const chipR = await page.evaluate(() => { const el = document.querySelector('.mode-chip'); return el ? el.textContent.trim() : null; });
    assert(chipR && chipR.includes('怪盗'), '警探视角顶栏同样显示怪盗徽标');
    await shot(page, 'q3-phantom-mar-vs-ai');

    /* ============ S. 怪盗模式：存档恢复 + 旧档迁移 ============ */
    console.log('S. 怪盗模式 · 存档与迁移');
    await freshGameMode(page, 'fugitive', 'phantom');
    await page.evaluate(() => { state.turn = 'fugitive'; state.firstTurn = false; state.needDraw = false; save(); }); // 刷新后轮到人类大盗，避免调度 AI
    await page.goto(URL);
    await page.waitForTimeout(150);
    let ss = await stateOf(page);
    assert(ss.mode === 'phantom' && ss.fug.hand.length === 12, '刷新恢复怪盗存档（12 张）');
    const chipS = await page.evaluate(() => { const el = document.querySelector('.mode-chip'); return el ? el.textContent.trim() : null; });
    assert(chipS && chipS.includes('怪盗'), '恢复后顶栏徽标仍在');
    await shot(page, 'q4-phantom-reload');
    // 旧 v2 存档（无 mode 字段）→ 迁移为普通模式
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      delete s.mode;
      localStorage.setItem('fugitive-state', JSON.stringify(s));
    });
    await page.goto(URL);
    await page.waitForTimeout(150);
    const sm = await stateOf(page);
    assert(sm.mode === 'normal', '旧存档缺 mode → 迁移普通模式');
    const noChipS = await page.evaluate(() => !document.querySelector('.mode-chip'));
    assert(noChipS, '普通模式不显示怪盗徽标');

    /* ============ T. AI 大盗虚张掩护：老死牌小步虚张（stub Math.random 确定性） ============ */
    console.log('T. AI 大盗虚张掩护');
    await freshGameMode(page, 'marshal', 'normal');
    await waitFor(page, () => state.turn === 'marshal', 20000, 'AI 大盗首回合结束');
    const baseRouteT = [{ num:10, hidden:true, cover:[] }];
    // 场景均为「唯一小步」：顶格垫(≥2 小步)/效率跳跃(距 last+5~7 目标)分支不触发，纯测老死牌虚张
    // (a) roll 命中（0.01）：死牌 6/7/8 ≥2 → 唯一可走 11（差 1）也挂 1 张掩护（死牌 6）
    await setup(page, { route: baseRouteT, hand: [6,7,8,11,20,21], turn:'fugitive', firstTurn:false, needDraw:false });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.01; scheduleAI(); });
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 2, 10000, 'AI 行动(a)');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    const rA = st.fug.route[1];
    assert(rA.num - st.fug.route[0].num >= 1 && rA.num - st.fug.route[0].num <= 3, '虚张主牌仍是小步（差 ' + (rA.num - st.fug.route[0].num) + '）');
    assert(rA.cover.length === 1 && rA.cover[0] === 6, '命中 roll：小步也挂掩护（掩护 ' + JSON.stringify(rA.cover) + '）');
    await shot(page, '9b-ai-bluff');
    // (b) roll 未命中（0.9）：裸打最大可走牌 13
    await setup(page, { route: baseRouteT, hand: [6,7,8,11,12,13], turn:'fugitive', firstTurn:false, needDraw:false });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.9; scheduleAI(); });
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 2, 10000, 'AI 行动(b)');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    assert(st.fug.route[1].num === 13 && st.fug.route[1].cover.length === 0, '未命中：裸打 13 无掩护');
    // (c) 死牌 <2（即使 roll 命中）→ 永不虚张
    await setup(page, { route: baseRouteT, hand: [11,20,21,22], turn:'fugitive', firstTurn:false, needDraw:false });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.01; scheduleAI(); });
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 2, 10000, 'AI 行动(c)');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    assert(st.fug.route[1].num === 11 && st.fug.route[1].cover.length === 0, '死牌 <2 不虚张');
    // (d) 死牌 ≥4 + roll 全中：升级垫 2 张（5+6 = 3 标记）
    await setup(page, { route: baseRouteT, hand: [5,6,7,8,11,19], turn:'fugitive', firstTurn:false, needDraw:false });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.01; scheduleAI(); });
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 2, 10000, 'AI 行动(d)');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    assert(st.fug.route[1].num === 11 && st.fug.route[1].cover.length === 2 && st.fug.route[1].cover[0] === 5 && st.fug.route[1].cover[1] === 6, '死牌 ≥4：升级 2 张掩护（' + JSON.stringify(st.fug.route[1].cover) + '）');

    /* ============ U. AI 大盗 42 冲刺：梭哈延迟 + 搜捕虚张 ============ */
    console.log('U. AI 大盗 42 冲刺策略');
    await freshGameMode(page, 'marshal', 'normal');
    await waitFor(page, () => state.turn === 'marshal', 20000, 'AI 大盗首回合结束');
    // U1 将触发搜捕（无公开牌）且掩护需整手梭哈 → 延迟：pass 不冲 42，手牌原样
    await setup(page, {
      route: [{ num:20, hidden:true, cover:[] }],
      hand: [1,2,4,6,8,10,12,14,16,18,42], // need=19：整手 19 标记恰够 = 梭哈
      turn:'fugitive', firstTurn:false, needDraw:false, phase:'playing',
    });
    await page.evaluate(() => scheduleAI());
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 1 && state.fug.hand.includes(42), 10000, '梭哈延迟：pass 不冲');
    st = await stateOf(page);
    assert(st.fug.hand.length === 11, '延迟回合 pass 后手牌原样（剩 ' + st.fug.hand.length + '）');
    // U2 延迟后下回合：掩护代价可接受 → 恢复冲 42 进搜捕
    await setup(page, {
      route: [{ num:20, hidden:true, cover:[] }],
      hand: [2,4,6,8,10,12,14,16,18,20,22,24,26,42], // cover 10 张偶 = 20 标记 ≥19，打后剩 3 → 不梭哈
      turn:'fugitive', firstTurn:false, needDraw:false, phase:'playing',
    });
    await page.evaluate(() => scheduleAI());
    await waitFor(page, () => state.fug.route.length === 2 && state.phase === 'manhunt', 10000, '恢复冲 42');
    st = await stateOf(page);
    assert(st.fug.route[1].num === 42 && st.fug.route[1].cover.length === 10, '恢复冲刺：42 + 10 张必需掩护（实际 ' + st.fug.route[1].cover.length + '）');
    // U3 将搜捕 + 不梭哈 + 剩余死牌富余（stub roll 全中）→ 冲 42 且额外押 2 张虚张
    await setup(page, {
      route: [
        { num:25, hidden:false, cover:[] },
        { num:26, hidden:true, cover:[] },
      ],
      hand: [2,4,6,8,10,12,14,16,18,20,22,24,28,30,42], // need=13：cover=[2..14] 7 张，剩余死牌 16~24
      turn:'fugitive', firstTurn:false, needDraw:false, phase:'playing',
    });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.01; scheduleAI(); });
    await waitFor(page, () => state.fug.route.length === 3 && state.phase === 'manhunt', 10000, '加戏冲 42');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    const rU = st.fug.route[2];
    assert(rU.num === 42 && rU.cover.length === 9, '42 掩护 = 必需 7 + 虚张 2（实际 ' + rU.cover.length + '）');
    assert(rU.cover[7] === 16 && rU.cover[8] === 18, '虚张为剩余最小死牌 16,18');
    await page.waitForTimeout(2800); // 等缉凶时刻横幅淡出再截图
    await shot(page, '9c-42-manhunt-bluff');
    // U4 公开 >29：无条件冲（即使近乎整手梭哈）且不加戏
    await setup(page, {
      route: [{ num:38, hidden:false, cover:[] }],
      hand: [3,42], // need=1：唯一掩护牌 3 → 打后剩 0；公开 38>29 仍直接冲
      turn:'fugitive', firstTurn:false, needDraw:false, phase:'playing',
    });
    await page.evaluate(() => scheduleAI());
    await waitFor(page, () => state.fug.route.length === 2 && state.phase === 'over', 10000, '公开>29 直接冲');
    st = await stateOf(page);
    assert(st.fug.route[1].num === 42 && st.fug.route[1].cover.length === 1 && st.winner === 'fugitive', '直接胜利：42 + 1 掩护');

    /* ============ V. AI 大盗拟人加戏：顶格垫 + 效率跳跃（stub 0.01 = roll 全中） ============ */
    console.log('V. AI 大盗拟人加戏（顶格垫/效率跳跃）');
    await freshGameMode(page, 'marshal', 'normal');
    await waitFor(page, () => state.turn === 'marshal', 20000, 'AI 大盗首回合结束');
    // V1 顶格小步 + 顺手垫：last=10，小步 11/12/13 尚存（无 5~7 距目标）→ 打顶格 13，垫被跳过的 11+12
    await setup(page, { route: [{ num:10, hidden:true, cover:[] }], hand: [6,7,8,11,12,13], turn:'fugitive', firstTurn:false, needDraw:false });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.01; scheduleAI(); });
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 2, 10000, 'AI 顶格垫');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    const v1 = st.fug.route[1];
    assert(v1.num === 13 && v1.cover.length === 2 && v1.cover[0] === 11 && v1.cover[1] === 12, '顶格垫：打 13 垫 11,12（实际 ' + JSON.stringify({num:v1.num, cover:v1.cover}) + '）');
    await shot(page, '9d-top-pad');
    // V2 效率跳跃：last=20，小步 21/22/23 尚存 → 跳 26，垫 1+22 恰好 3 标记（非贪心 1+21+22 三张）
    await setup(page, { route: [{ num:20, hidden:true, cover:[] }], hand: [1,21,22,23,26,29,30,39], turn:'fugitive', firstTurn:false, needDraw:false });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.01; scheduleAI(); });
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 2, 10000, 'AI 效率跳跃');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    const v2 = st.fug.route[1];
    assert(v2.num === 26 && v2.cover.length === 2 && v2.cover[0] === 1 && v2.cover[1] === 22, '效率跳跃：小步尚存跳 26，垫恰好 3 标记（' + JSON.stringify(v2.cover) + '）');
    await shot(page, '9e-eff-jump');
    // V3 42 在手但冲刺不可行（need 19 > 手牌 7 标记）→ 收窄规则允许加戏：跳 26，42 保留（旧「42 在手一律禁」已废弃）
    await setup(page, { route: [{ num:20, hidden:true, cover:[] }], hand: [1,21,22,23,26,42], turn:'fugitive', firstTurn:false, needDraw:false });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.01; scheduleAI(); });
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 2, 10000, '42 不可冲仍加戏');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    const v3 = st.fug.route[1];
    assert(v3.num === 26 && v3.cover.length === 2 && st.fug.hand.includes(42), '42 不可冲 → 允许跳 26（42 保留手牌）');
    // V4 延迟冲刺（42 可冲但梭哈被按 + 将触发搜捕）→ 禁一切加戏：裸打唯一小步 28
    await setup(page, {
      route: [
        { num:25, hidden:false, cover:[] },
        { num:26, hidden:true, cover:[] },
      ],
      hand: [1,21,22,23,24,28,30,32,34,42], // need=13：贪心 8 张恰够（打后剩 1）→ 梭哈延迟
      turn:'fugitive', firstTurn:false, needDraw:false, phase:'playing',
    });
    await page.evaluate(() => { window.__origRand = Math.random; Math.random = () => 0.01; scheduleAI(); });
    await waitFor(page, () => state.turn === 'marshal' && state.fug.route.length === 3, 10000, '延迟状态裸小步');
    await page.evaluate(() => { Math.random = window.__origRand; delete window.__origRand; });
    st = await stateOf(page);
    const v4 = st.fug.route[2];
    assert(v4.num === 28 && v4.cover.length === 0 && st.fug.hand.includes(42), '延迟冲刺：裸打 28 不加戏（32 距 6 可跳也不跳），42 仍在手');

    /* ============ W. AI 警探掩护感知：跳张命中重锚 ============ */
    console.log('W. AI 警探掩护感知（跳张命中重锚）');
    // 大盗从 20 跳 26 垫 1+22（3 标记）→ 警探只见「掩护×2」→ 窗口放宽到 20+3+2×2=27
    // stub 0.9（15% 随机不触发）→ 从窗口最低位 21 逐发探测，第 6 发命中 26 → 全翻 → 警探胜
    await freshGameMode(page, 'fugitive', 'normal');
    await setup(page, {
      route: [
        { num:20, hidden:false, cover:[] },
        { num:26, hidden:true, cover:[1,22] },
      ],
      hand: [], marHand: [], piles: { A:[], B:[], C:[] },
      turn:'marshal', needDraw:false, firstTurn:false,
    });
    await page.evaluate(() => {
      window.__origRand = Math.random; Math.random = () => 0.9;
      window.__wPass = setInterval(() => {
        if(state.phase==='playing' && state.turn==='fugitive' && !ui.lock) fugPass();
      }, 80);
      save(); scheduleAI();
    });
    await waitFor(page, () => state.phase==='over' && state.winner==='marshal', 45000, 'AI 警探宽窗口命中跳张 26');
    await page.evaluate(() => {
      clearInterval(window.__wPass); delete window.__wPass;
      Math.random = window.__origRand; delete window.__origRand;
    });
    st = await stateOf(page);
    assert(st.fug.route[1].hidden === false, '跳张 26 被 AI 猜中翻开重锚');
    const lgW = await logs(page);
    assert(lgW.some(l => l.includes('猜中') && l.includes('26')), '日志含「猜中 26」');
    await shot(page, 'w1-catch-jump');

    /* ============ X. AI 警探批量猜：双唯一窗口一次全猜 ============ */
    console.log('X. AI 警探批量猜（双唯一窗口一次全猜）');
    // 两个无掩护暗格各自夹在相邻公开锚点之间（20..22 → 21、24..26 → 25）：窗口封顶使两窗均为唯一
    // stub 0.9（15% 随机不触发）→ AI 同回合批量猜 21 与 25 → 全翻 → 整条路线翻开 → 警探胜、零猜错
    await freshGameMode(page, 'fugitive', 'normal');
    await setup(page, {
      route: [
        { num:20, hidden:false, cover:[] },
        { num:21, hidden:true,  cover:[] },
        { num:22, hidden:false, cover:[] },
        { num:24, hidden:false, cover:[] },
        { num:25, hidden:true,  cover:[] },
        { num:26, hidden:false, cover:[] },
      ],
      hand: [], marHand: [], piles: { A:[], B:[], C:[] },
      turn:'marshal', needDraw:false, firstTurn:false,
    });
    await page.evaluate(() => {
      window.__origRand = Math.random; Math.random = () => 0.9;
      window.__xPass = setInterval(() => {
        if(state.phase==='playing' && state.turn==='fugitive' && !ui.lock) fugPass();
      }, 80);
      save(); scheduleAI();
    });
    await waitFor(page, () => state.phase==='over' && state.winner==='marshal', 45000, 'AI 警探批量猜双唯一窗口后翻全胜');
    await page.evaluate(() => {
      clearInterval(window.__xPass); delete window.__xPass;
      Math.random = window.__origRand; delete window.__origRand;
    });
    st = await stateOf(page);
    assert(st.fug.route.every(r => !r.hidden), '批量猜后整条路线翻开');
    assert(!st.marMissed.length, '批量必中：零猜错');
    const lgX = await logs(page);
    assert(lgX.some(l => l.includes('猜中') && l.includes('21, 25')), '日志含同一条「猜中 21, 25」（单回合批量）');
    await shot(page, 'x1-batch-guess');

    console.log('✅ ALL TESTS PASSED in ' + ((Date.now()-t0)/1000).toFixed(1) + 's');
  } catch(e) {
    failures++;
    console.error('❌ TEST FAILED:', e.message);
    try { await shot(page, 'FAILURE'); } catch(e2){}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
