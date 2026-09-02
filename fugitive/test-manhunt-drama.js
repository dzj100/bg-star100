/* 搜捕开场「缉凶时刻」戏剧提示 e2e：出现 → ~2.6s 自动消失 → 搜捕对局照常推进 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const SHOTS = path.join(__dirname, 'shots');
if(!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, {recursive:true});

function assert(cond, msg){ if(!cond){ throw new Error('ASSERT FAIL: ' + msg); } }
async function shot(page, name){
  try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
  catch(e){ console.log('  [shot err]', name, e.message); }
}
async function waitFor(page, fn, timeout, label, ...args){
  const t0 = Date.now();
  const limit = timeout || 15000;
  while(Date.now()-t0 < limit){
    let ok = false;
    try { ok = await page.evaluate(fn, ...args); } catch(e){ ok = false; }
    if(ok) return;
    await page.waitForTimeout(120);
  }
  throw new Error('TIMEOUT waiting: ' + (label || fn.toString()));
}
const stateOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(state)));
const dramaVisible = () => {
  const el = document.getElementById('manhunt-drama');
  return !!el && el.classList.contains('on');
};

// 逼真中局站位：17 已翻开、19 暗置、22 已翻开 → 打 42 需 42-22-3 = 17 个掩护标记（8 偶 + 1 奇）
const ROUTE = [
  { num:17, hidden:false, cover:[] },
  { num:19, hidden:true,  cover:[] },
  { num:22, hidden:false, cover:[] },
];
const COVERS = [2,4,5,6,8,10,12,14,16]; // 掩护合计 17
const HAND = COVERS.concat([42]);

async function freshGame(page, role){
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.evaluate((r) => newGame(r), role);
  await page.waitForTimeout(100);
}
async function patchMidgame(page, role){
  await freshGame(page, role);
  await page.evaluate(([route, hand]) => {
    state.fug.route = route;
    state.fug.hand = hand;
    state.firstTurn = false;
    state.needDraw = false;
    state.turn = 'fugitive';
    save(); render();
  }, [ROUTE, HAND]);
  await page.waitForTimeout(80);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    /* ===== A. 人当大盗：自己打出 42 → 提示出现 → 自动消失 → AI 警探照常搜捕 ===== */
    console.log('A. 人当大盗：打出 42 触发搜捕');
    await patchMidgame(page, 'fugitive');
    const r1 = await page.evaluate((covers) => {
      const res = fugPlace(42, covers);
      return { ok: res.ok, phase: state.phase };
    }, COVERS);
    assert(r1.ok, '放置 42 应成功');
    assert(r1.phase === 'manhunt', '打出 42 且已翻开 ≤30 → phase 应为 manhunt');
    await waitFor(page, dramaVisible, 3000, '戏剧提示出现(.on)');
    await page.waitForTimeout(1000);
    assert(await page.evaluate(dramaVisible), '提示应仍在屏');
    await shot(page, 'd1-manhunt-drama-mid');        // 42 落地 + 印章
    await page.waitForTimeout(950);
    await shot(page, 'd2-manhunt-drama-full');       // 全部元素可见
    await waitFor(page, () => !document.getElementById('manhunt-drama'), 8000, '提示自动消失');
    console.log('  ✓ 提示约 2.6s 后自动消失，DOM 已移除');
    await page.waitForTimeout(600);
    await shot(page, 'd3-after-dismiss-fug-view');
    // 掩护列表多行换行显示（用户选择，不单行省略）；超长仍可点卡片弹抽屉查看
    const cov = await page.evaluate(() => {
      const el = document.querySelector('#track .t-card[data-i="3"] .cov');
      if(!el) return null;
      const cs = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      return { whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow, lines: range.getClientRects().length };
    });
    assert(cov && cov.whiteSpace === 'normal' && cov.textOverflow === 'clip' && cov.lines > 1,
      '主对局 .cov 应多行换行显示，实际 ' + JSON.stringify(cov));
    console.log('  ✓ 掩护列表多行换行（', cov.lines, '行）');
    // AI 警探搜捕：推断候选 {18,19,20} 猜最小 18（非真实 19）→ 猜错 → 大盗逃脱
    await waitFor(page, () => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      return s && s.phase === 'over';
    }, 20000, '搜捕推进到终局');
    const over1 = await stateOf(page);
    console.log('  ✓ AI 搜捕照常推进，winner =', over1.winner);
    assert(over1.winner === 'fugitive', 'AI 猜 18 未中 → 大盗应逃脱');

    /* ===== B. 人当警探：AI 大盗真实出牌打出 42 → 提示出现 → 消失 → 玩家搜捕至胜利 ===== */
    console.log('B. 人当警探：AI 大盗打出 42 触发搜捕');
    await patchMidgame(page, 'marshal');
    await page.evaluate(() => scheduleAI());
    await waitFor(page, dramaVisible, 8000, 'AI 打出 42 后提示出现');
    await page.waitForTimeout(1100);
    await shot(page, 'd4-manhunt-drama-ai-mid');
    await waitFor(page, () => !document.getElementById('manhunt-drama'), 8000, '提示自动消失');
    console.log('  ✓ AI 大盗路径提示同样自动消失');
    const b1 = await stateOf(page);
    assert(b1.phase === 'manhunt' && b1.turn === 'marshal', '搜捕阶段 + 轮到警探（人等输入）');
    await page.waitForTimeout(500);
    await shot(page, 'd5-manhunt-wait-mar-view');
    // 玩家按从小到大猜 19 → 全部翻开 → 警探获胜
    await page.evaluate(() => { document.querySelector('.g-cell[data-n="19"]').click(); });
    await page.waitForTimeout(80);
    await page.evaluate(() => { document.querySelector('#actions .btn-primary').click(); });
    await waitFor(page, () => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      return s && s.phase === 'over';
    }, 15000, '玩家搜捕至终局');
    const over2 = await stateOf(page);
    console.log('  ✓ 玩家搜捕照常推进，winner =', over2.winner);
    assert(over2.winner === 'marshal', '按序猜中 19 → 警探应获胜');
    await shot(page, 'd6-manhunt-victory-mar-view');

    /* ===== C. prefers-reduced-motion：静态降级展示（无动画、同样自动消失） ===== */
    console.log('C. prefers-reduced-motion：静态降级展示');
    await patchMidgame(page, 'fugitive');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate((covers) => { fugPlace(42, covers); }, COVERS);
    await waitFor(page, () => {
      const el = document.getElementById('manhunt-drama');
      return !!el && el.classList.contains('calm') && el.classList.contains('on');
    }, 3000, 'calm 提示出现');
    const calmAnim = await page.evaluate(() => {
      const el = document.getElementById('manhunt-drama');
      return getComputedStyle(el.querySelector('.d-42wrap')).animationName;
    });
    assert(calmAnim === 'none', 'calm 模式下 42 卡不应有砸落动画（当前 ' + calmAnim + '）');
    await waitFor(page, () => !document.getElementById('manhunt-drama'), 6000, 'calm 提示自动消失');
    console.log('  ✓ calm 降级路径正常且自动消失');

    /* ===== D. AI 警探行动中点刷新：恢复后应续跑 AI 回合（不会卡死/跳过） ===== */
    console.log('D. AI 警探猜测前刷新：恢复后 AI 应续跑');
    await freshGame(page, 'fugitive');
    await page.evaluate(() => {
      state.fug.route = [{ num:17, hidden:true, cover:[] }];
      state.fug.hand = [];
      state.firstTurn = false;
      state.needDraw = false;
      state.turn = 'marshal'; // 轮到 AI 警探但尚未调度（模拟"行动被打断"的存档）
      save(); render();
    });
    await page.waitForTimeout(80);
    await page.reload();
    await page.waitForTimeout(400);
    // AI 重新被调度：应完成一次猜测（必然未命中 17）并把回合交还大盗
    await waitFor(page, () => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      return s && s.phase === 'playing' && s.turn === 'fugitive' && s.marMissed && s.marMissed.length === 1;
    }, 15000, '刷新后 AI 完成猜测并交还回合');
    const d1 = await stateOf(page);
    console.log('  ✓ AI 续跑完成：marMissed =', d1.marMissed.join(','), 'turn =', d1.turn);
    assert(d1.marMissed.length === 1 && d1.turn === 'fugitive', '刷新后 AI 应照常猜测而不是卡死');

    /* ===== E. AI 大盗行动回合中刷新：恢复后应续跑（抽牌/补出牌），不跳过 ===== */
    console.log('E. AI 大盗行动中刷新：恢复后 AI 应续跑补牌');
    // E1 窗口：已抽牌（needDraw=false、手牌含 19）但尚未打出 → 刷新 → AI 应补出 19 并交还回合
    await freshGame(page, 'marshal');
    await page.evaluate(() => {
      state.fug.route = [{ num:17, hidden:false, cover:[] }];
      state.fug.hand = [19];
      state.firstTurn = false;
      state.needDraw = false;
      state.turn = 'fugitive'; // 轮到 AI 大盗、已抽完牌（模拟抽牌与出牌之间的存档点）
      save(); render();
    });
    await page.reload();
    await waitFor(page, () => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      return s && s.phase === 'playing' && s.turn === 'marshal' && s.fug.route.length === 2 &&
             s.fug.route[1].num === 19 && s.fug.route[1].hidden === true && s.marMissed.length === 0;
    }, 15000, 'E1 刷新后 AI 大盗补出 19 并交还回合');
    const e1 = await stateOf(page);
    console.log('  ✓ E1 已抽未打窗口：route =', e1.fug.route.map(r => r.num + (r.hidden ? '(?)' : '')).join(' > '), 'turn =', e1.turn);
    assert(e1.turn === 'marshal' && e1.fug.route[1].num === 19, '刷新后 AI 大盗应补出 19 而不是卡死');

    // E2 窗口：尚未摸牌（needDraw=true）→ 刷新 → AI 应摸 A 堆 19 再补出
    await freshGame(page, 'marshal');
    await page.evaluate(() => {
      state.fug.route = [{ num:17, hidden:false, cover:[] }];
      state.fug.hand = [];
      state.piles = { A:[19], B:[], C:[] };
      state.firstTurn = false;
      state.needDraw = true;
      state.turn = 'fugitive'; // 轮到 AI 大盗且需摸牌（模拟回合开始处被打断的存档）
      save(); render();
    });
    await page.reload();
    await waitFor(page, () => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      return s && s.phase === 'playing' && s.turn === 'marshal' && s.fug.route.length === 2 &&
             s.fug.route[1].num === 19 && s.marMissed.length === 0;
    }, 15000, 'E2 刷新后 AI 大盗摸牌并补出 19');
    const e2 = await stateOf(page);
    console.log('  ✓ E2 未抽牌窗口：route =', e2.fug.route.map(r => r.num + (r.hidden ? '(?)' : '')).join(' > '), 'turn =', e2.turn);
    assert(e2.turn === 'marshal' && e2.fug.route[1].num === 19, '刷新后 AI 大盗应摸牌补出而不是卡死');

    /* ===== F. 「猜错次数」统计口径：多选整组未中 + 搜捕致命猜错都要计入 ===== */
    console.log('F. 猜错次数统计：多选未中与搜捕致命猜错均计入');
    // F1 多选整组未中：playing 阶段一次猜 [19,20]（均未公开、不在手牌）→ 动作本身应计 1 次（0 占位）
    await freshGame(page, 'marshal');
    await page.evaluate(() => {
      state.fug.route = [];
      state.fug.hand = [];
      state.mar.hand = [];
      state.firstTurn = false;
      state.needDraw = false;
      state.turn = 'marshal';
      save(); render();
    });
    await page.evaluate(() => { marGuess([19, 20]); });
    await waitFor(page, () => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      return s && s.marMissed && s.marMissed.includes(0);
    }, 10000, '多选整组未中计入猜错次数');
    const f1 = await stateOf(page);
    console.log('  ✓ F1 多选未中：marMissed =', f1.marMissed.join(','), '→ 计', f1.marMissed.length, '次');
    assert(f1.marMissed.length === 1 && f1.marMissed[0] === 0, '多选整组未中应计 1 次（0 占位）');

    // F2 搜捕致命猜错：最小暗牌 17，猜 19（错序/错数）→ 应记 19 且大盗逃脱
    await freshGame(page, 'marshal');
    await page.evaluate(() => {
      state.fug.route = [
        { num:17, hidden:true,  cover:[] },
        { num:22, hidden:false, cover:[] },
      ];
      state.fug.hand = [];
      state.mar.hand = [];
      state.phase = 'manhunt';
      state.needDraw = false;
      state.turn = 'marshal';
      save(); render();
    });
    await page.evaluate(() => { manhuntGuess(19); });
    await waitFor(page, () => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      return s && s.phase === 'over' && s.winner === 'fugitive' && s.marMissed &&
             s.marMissed.length === 1 && s.marMissed[0] === 19;
    }, 10000, '搜捕致命猜错计入猜错次数');
    const f2 = await stateOf(page);
    console.log('  ✓ F2 搜捕猜错即败：marMissed =', f2.marMissed.join(','), 'winner =', f2.winner);
    assert(f2.winner === 'fugitive' && f2.marMissed[0] === 19, '搜捕猜 19（非最小暗牌 17）应计入且大盗逃脱');

    /* ===== G. 警探摸牌动画：弹出展示摸到的牌（数字一致）→ 自动消失；reduced-motion 跳过 ===== */
    console.log('G. 警探摸牌动画');
    await page.emulateMedia({ reducedMotion: null }); // 清除场景 C 残留的 reduce，恢复动效
    await freshGame(page, 'marshal');
    await page.evaluate(() => {
      state.fug.route = [];
      state.fug.hand = [];
      state.firstTurn = false;
      state.needDraw = true;
      state.turn = 'marshal';
      save(); render();
    });
    const g0 = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.pile-pick .btn')].find(b => !b.disabled);
      if(!btn) return false;
      btn.click();
      return true;
    });
    assert(g0, '摸牌按钮应存在且可点');
    await waitFor(page, () => {
      const el = document.getElementById('draw-pop');
      return el && el.classList.contains('on');
    }, 3000, '摸牌弹出出现');
    await page.waitForTimeout(160); // 略等入场回弹，牌面清晰可读
    const g1 = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      const drawn = s.mar.hand[s.mar.hand.length - 1];
      const b = document.querySelector('#draw-pop .dp-card b');
      return { drawn, shown: b ? b.textContent : null };
    });
    console.log('  ✓ 弹出展示摸到的牌：drawn =', g1.drawn, 'shown =', g1.shown);
    assert(g1.shown === String(g1.drawn), '弹出牌面应与实际摸到的数字一致');
    const gPos = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.pile-pick .btn')].find(b => !b.disabled);
      if(!btn) return null;
      const r = btn.getBoundingClientRect();
      const a = document.querySelector('#draw-pop .dp-anchor');
      if(!a) return null;
      const ar = a.getBoundingClientRect();
      return { btnCx: r.left + r.width / 2, aCx: ar.left + ar.width / 2, btnBottom: r.bottom, aTop: ar.top };
    });
    assert(gPos && Math.abs(gPos.aCx - gPos.btnCx) < 2 && gPos.aTop >= gPos.btnBottom - 1,
      '弹出应锚定所点牌堆：水平对按钮中线、垂直在按钮下方，实际 ' + JSON.stringify(gPos));
    console.log('  ✓ 弹出锚定所点牌堆按钮（下方居中，中心偏差',
      (gPos.aCx - gPos.btnCx).toFixed(1), 'px）');
    await shot(page, 'd7-mar-draw-pop');
    await waitFor(page, () => !document.getElementById('draw-pop'), 4000, '摸牌弹出自动消失');
    console.log('  ✓ 摸牌弹出约 0.5s 后自动消失');
    // reduced-motion：不弹动画，但摸牌照常入账（首回合第一摸后 needDraw 仍为 true，可再摸）
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.pile-pick .btn')].find(b => !b.disabled);
      if(btn) btn.click();
    });
    await page.waitForTimeout(500);
    const g2 = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('fugitive-state'));
      return { hasPop: !!document.getElementById('draw-pop'), hand: s.mar.hand.length, needDraw: s.needDraw };
    });
    console.log('  ✓ reduced-motion 跳过弹出（hasPop =', g2.hasPop, '手牌 =', g2.hand, '）');
    assert(!g2.hasPop && g2.hand === 2, '弱动效模式下摸牌不弹动画但照常入账');

    console.log('ALL PASS');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
