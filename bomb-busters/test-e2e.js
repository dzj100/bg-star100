/**
 * 炸弹克星 端到端测试（Playwright）
 * 覆盖：着陆页+规则 → 建房/加入 → 开始 → 信息标记（跨端同步）→ 双人剪线命中 ×2（跨端同步）
 *       → 界面契约（板/道具/技能/头部/日志）→ 双重探测器扫描全流程（含被动方选牌）
 *       → 单人剪线气泡 → 公开红线气泡 → 结算弹窗（双端）→ 终局区（房主按钮/成员等待提示）
 *       → 再来一局（远端弹窗自动关闭）→ 成员退出 + 房主接管代操作
 *       → 返回房间（等候室）→ 新玩家加入 → 房主重开
 * 前置：node bomb-busters/serve.js（端口 8124）
 * 运行：node bomb-busters/test-e2e.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE  = 'http://localhost:8124/bomb-busters/index.html';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

/** 轮询页面谓词（fn 在页面内执行；arg 单一入参） */
async function waitEval(page, fn, desc, arg, timeout = 15000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await page.evaluate(fn, arg); } catch (e) { last = 'err:' + e.message; }
    if (last) return last;
    await page.waitForTimeout(300);
  }
  throw new Error(`等待超时：${desc}（最后 ${JSON.stringify(last)}）`);
}

const curSeat = page => page.evaluate(() => window._getOnlineState().currentPlayer);

(async () => {
const browser = await chromium.launch();

const mkPage = async (tag, name) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${tag} error]`, e.message));
  page.on('console', m => { const s = m.text(); if (s.includes('[bomb]') || s.includes('[online]')) return; console.log(`[${tag}]`, m.type(), s.slice(0, 160)); });
  page.on('requestfailed', r => console.log(`[${tag} requestfailed]`, r.url().slice(0, 120), r.failure() && r.failure().errorText));
  if (name) page.on('dialog', d => d.accept(name));
  await page.goto(BASE);
  await page.waitForSelector('text=联机模式', { timeout: 20000 });
  return page;
};

console.log('== 大厅 ==');
const p1 = await mkPage('P1', '房主');
await p1.waitForTimeout(500);
await p1.screenshot({ path: SHOTS + '/e2e-1-landing.png' });

await p1.click('button:has-text("规则")');
await p1.waitForSelector('#modalOverlay.show', { timeout: 5000 });
const rulesText = await p1.evaluate(() => document.getElementById('modalContent').textContent);
if (!rulesText.includes('胜利条件') || !rulesText.includes('双重探测器')) throw new Error('规则弹层内容缺失');
await p1.click('button:has-text("知道了")');
await p1.waitForTimeout(300);

await p1.click('text=联机模式');
await p1.waitForTimeout(400);
await p1.click('text=创建房间');
await p1.waitForTimeout(2500);
await p1.screenshot({ path: SHOTS + '/e2e-2-waiting-host.png' });
const code = (await p1.textContent('.setup-header h1')).match(/\d{4}/)[0];
console.log('房间号:', code);
const extras = await p1.textContent('.waiting-extras');
if (!extras.includes('初见端倪')) throw new Error('等候室选关信息缺失: ' + extras);

console.log('== 加入房间 ==');
const p2 = await mkPage('P2');
await p2.click('text=联机模式');
await p2.fill('#joinRoomInput', code);
await p2.fill('#joinNameInput', '小明');
await p2.click('text=加入房间');
await p2.waitForTimeout(2500);
await p1.waitForTimeout(1500);
await p1.screenshot({ path: SHOTS + '/e2e-3-waiting-2p-host.png' });
await p2.screenshot({ path: SHOTS + '/e2e-4-waiting-2p-p2.png' });

await p1.click('text=开始游戏');
// 发牌后吐司提示全员标记（每端各自弹出，1.6s 自动消失 → 实时抓取文案）
const toastP1 = await waitEval(p1, () => { const t = document.getElementById('toast'); return (t && t.classList.contains('show')) ? t.textContent : ''; }, '房主开局吐司', undefined, 6000);
if (!toastP1.includes('标记')) throw new Error('开局吐司文案应提示标记操作: ' + toastP1);
const toastP2 = await waitEval(p2, () => { const t = document.getElementById('toast'); return (t && t.classList.contains('show')) ? t.textContent : ''; }, '成员开局吐司', undefined, 6000);
if (!toastP2.includes('标记')) throw new Error('成员开局吐司文案应提示标记操作: ' + toastP2);
if (await p1.evaluate(() => window._markToastFor !== window.S.dealStamp)) throw new Error('吐司应按局触发（dealStamp 去重标记缺失）');
console.log('开局标记吐司 OK:', toastP1.trim());
await p1.waitForTimeout(2500);
await p2.waitForTimeout(2500);

console.log('== 信息标记阶段 ==');
await waitEval(p1, () => window.S && window.S.phase === 'mark', 'P1 进入标记阶段');
await waitEval(p2, () => window.S && window.S.phase === 'mark', 'P2 进入标记阶段');
await p1.screenshot({ path: SHOTS + '/e2e-5-mark-host.png' });
await p2.screenshot({ path: SHOTS + '/e2e-6-mark-p2.png' });

for (const [page, tag] of [[p1, 'P1'], [p2, 'P2']]) {
  const cells = await page.evaluate(() => document.querySelectorAll('#board .cell').length);
  if (cells !== 12) throw new Error(`${tag} 数轴格数应为 12，得到 ${cells}`);
  if (await page.evaluate(() => !!document.querySelector('.mark-banner'))) throw new Error(`${tag} 不应再出现 mark-banner（改用吐司+行动条提示）`);
  const hint = await page.evaluate(() => (document.querySelector('.action-bar .waiting-hint') || {}).textContent || '');
  if (!hint.includes('标记')) throw new Error(`${tag} 标记阶段行动条提示缺失: ${hint}`);
}

await p1.waitForSelector('.own-hand[data-seat="0"] .card-own.kind-blue.selectable', { timeout: 5000 });
await p1.click('.own-hand[data-seat="0"] .card-own.kind-blue.selectable');
await p1.waitForTimeout(600);
if (!(await p1.evaluate(() => window.S.ready[0]))) throw new Error('P1 标记后 ready[0] 应为 true');
await waitEval(p2, () => window.S.ready && window.S.ready[0] === true, 'P2 同步收到 P1 的标记');

await p2.waitForSelector('.own-hand[data-seat="1"] .card-own.kind-blue.selectable', { timeout: 5000 });
await p2.click('.own-hand[data-seat="1"] .card-own.kind-blue.selectable');
await p2.waitForTimeout(600);
await waitEval(p1, () => window.S.phase === 'play', 'P1 进入对局');
await waitEval(p2, () => window.S.phase === 'play', 'P2 进入对局');
const cap = await p1.evaluate(() => window.S.captainSeat);
const cs1 = await curSeat(p1), cs2 = await curSeat(p2);
if (cs1 !== cs2) throw new Error(`回合不同步：P1=${cs1} P2=${cs2}`);
if (cs1 !== cap) throw new Error(`应由队长开始：current=${cs1} captain=${cap}`);
console.log('对局开始，先手座位:', cs1);
await p1.screenshot({ path: SHOTS + '/e2e-7-play-host.png' });
await p2.screenshot({ path: SHOTS + '/e2e-8-play-p2.png' });

console.log('== 双人剪线（命中）==');
/** 构造必定命中的剪线组合并在行动者页面执行 UI 操作（含气泡序列断言） */
async function pairCutHit(page, peer, tag, shotTag) {
  const plan = await page.evaluate(() => {
    const s = window.S;
    const actor = s.currentSeat;
    const mine = s.players[actor].shares.flat().filter(c => c.kind === 'blue' && !c.revealed);
    for (let k = 0; k < s.pCount; k++) {
      if (k === actor) continue;
      for (const sh of (s.players[k].shares || [])) {
        for (const c of sh) {
          if (!c.revealed && c.kind === 'blue') {
            const m = mine.find(x => x.num === c.num);
            if (m) return { targetSeat: k, targetId: c.id, ownId: m.id, num: c.num };
          }
        }
      }
    }
    return null;
  });
  if (!plan) throw new Error(tag + ': 构造不出必定命中的剪线组合');
  await page.click('[data-testid="btn-pair"]');
  await page.waitForTimeout(400);
  await page.click(`.player-row[data-seat="${plan.targetSeat}"] .card-back[data-cardid="${plan.targetId}"]`);
  await page.waitForSelector('#sheetOverlay.show', { timeout: 5000 });
  await page.click(`.guess-btn[data-guess="blue-${plan.num}"]`);
  await page.waitForTimeout(400);
  const pick = page.locator(`.pick-card[data-cardid="${plan.ownId}"]`);
  if (await pick.count()) await pick.first().click();
  await page.click('[data-testid="confirm"]');
  // 气泡序列：宣告 → 回应 → 结算（约 2s）
  await waitEval(page, () => !!document.querySelector('#bubble-layer .bubble.declare'), tag + ': 猜测宣告气泡出现');
  await waitEval(page, (p) => { const el = document.querySelector(`[data-cardid="${p.targetId}"]`); return !!(el && el.classList.contains('fx-target')); }, tag + ': 目标牌聚光', plan);
  if (shotTag) { await page.waitForTimeout(250); await page.screenshot({ path: SHOTS + `/${shotTag}.png` }); }
  if (peer) await waitEval(peer, (p) => { const el = document.querySelector(`[data-cardid="${p.targetId}"]`); return !!(el && el.classList.contains('fx-target')); }, '远端同步目标牌聚光', plan);
  if (peer) await waitEval(peer, () => !!document.querySelector('#bubble-layer .bubble'), '远端同步出现对话气泡');
  await waitEval(page, () => !!document.querySelector('#bubble-layer .bubble.reply'), tag + ': 回应气泡出现');
  await waitEval(page, (p) => { const el = document.querySelector(`[data-cardid="${p.targetId}"]`); return !!(el && el.classList.contains('fx-hit')); }, tag + ': 回应后聚光转命中色', plan);
  await waitEval(page, (p) => {
    if (window.S.fx) return false;
    const t = window.S.players[p.targetSeat].shares.flat().find(c => c.id === p.targetId);
    return !!t && t.revealed;
  }, tag + ': 气泡结束后命中公开', plan);
  const fxLeft = await page.evaluate(() => document.querySelectorAll('.fx-target').length);
  if (fxLeft) throw new Error(tag + ': 结算后聚光应清除，残留 ' + fxLeft);
  return plan;
}

const seatA = cs1;
const devA = seatA === 0 ? p1 : p2;
const devB = devA === p1 ? p2 : p1;
const tagA = devA === p1 ? 'P1' : 'P2';
const tagB = devB === p1 ? 'P1' : 'P2';
const nextSeat = 1 - seatA;

const plan1 = await pairCutHit(devA, devB, tagA, 'e2e-9a-bubble-actor');
const afterCut = await devA.evaluate((p) => {
  const s = window.S;
  const t = s.players[p.targetSeat].shares.flat().find(c => c.id === p.targetId);
  const o = s.players.flatMap(x => x.shares.flat()).find(c => c.id === p.ownId);
  return { t: !!t && t.revealed, o: !!o && o.revealed, cf: s.currentSeat };
}, plan1);
if (!afterCut.t || !afterCut.o) throw new Error('命中后双方牌面应立即公开');
if (afterCut.cf !== nextSeat) throw new Error(`回合应流转到座位 ${nextSeat}，得到 ${afterCut.cf}`);
await waitEval(devB, (p) => {
  const t = window.S.players[p.targetSeat].shares.flat().find(c => c.id === p.targetId);
  return !!t && t.revealed;
}, '远端同步命中公开', plan1);
await waitEval(devB, (sn) => window.S.currentSeat === sn, '远端同步回合', nextSeat);
console.log(tagA, '剪线命中 OK；', tagB, '已同步');
await devA.screenshot({ path: SHOTS + '/e2e-9-cut1-actor.png' });
await devB.screenshot({ path: SHOTS + '/e2e-10-cut1-peer.png' });

const plan2 = await pairCutHit(devB, devA, tagB, 'e2e-11a-bubble-actor2');
await waitEval(devA, (p) => {
  const t = window.S.players[p.targetSeat].shares.flat().find(c => c.id === p.targetId);
  return !!t && t.revealed;
}, '远端同步第二回合命中', plan2);
await waitEval(devA, (sn) => window.S.currentSeat === sn, '回合归还', seatA);
const f1 = await devA.evaluate(() => window.S.failures);
const f2 = await devB.evaluate(() => window.S.failures);
if (f1 !== f2) throw new Error(`失败数不同步: ${f1} vs ${f2}`);
console.log(tagB, '剪线命中 OK；两次行动后回合回到座位', seatA);
await devA.screenshot({ path: SHOTS + '/e2e-11-cut2-actor.png' });
await devB.screenshot({ path: SHOTS + '/e2e-12-cut2-peer.png' });

console.log('== 界面契约 ==');
const ui = await devA.evaluate(() => {
  const h = document.querySelector('.game-header');
  const t = h.querySelector('.header-title').getBoundingClientRect();
  const b = h.querySelector('.header-btns').getBoundingClientRect();
  return {
    titleLeft: Math.round(t.left),
    btnsRight: Math.round(b.right),
    btns: [...h.querySelectorAll('button')].map(x => x.textContent.trim()),
    cells: document.querySelectorAll('#board .cell').length,
    equipBtns: document.querySelectorAll('[data-testid="equipment"] .equip-btn').length,
    equipState: (window.S.equipment || []).length,
    failText: document.querySelector('[data-testid="fail-count"]').textContent,
    logTop: Math.round(document.querySelector('.log-bar').getBoundingClientRect().top),
    equipTop: Math.round(document.querySelector('[data-testid="equipment"]').getBoundingClientRect().top),
    boardTop: Math.round(document.querySelector('#board').getBoundingClientRect().top),
    pairBtn: !!document.querySelector('[data-testid="btn-pair"]'),
    soloBtn: !!document.querySelector('[data-testid="btn-solo"]'),
    redBtn: !!document.querySelector('[data-testid="btn-red"]'),
    skillBtn: !!document.querySelector('[data-testid="btn-skill"]'),
    exitBtn: !!document.getElementById('exitRoomBtn'),
  };
});
if (ui.titleLeft > ui.btnsRight) throw new Error('头部布局错误：标题应在左、按钮应在右');
if (!ui.btns.some(x => x.includes('退出')) || !ui.btns.some(x => x.includes('规则'))) throw new Error('头部按钮缺失: ' + JSON.stringify(ui.btns));
if (ui.cells !== 12) throw new Error('数轴格数应为 12，得到 ' + ui.cells);
if (!(ui.logTop < ui.equipTop && ui.equipTop < ui.boardTop)) throw new Error(`布局顺序应为 日志→道具→数轴板，得到 log=${ui.logTop} equip=${ui.equipTop} board=${ui.boardTop}`);
if (ui.equipBtns !== ui.equipState) throw new Error(`道具位数量不符: DOM ${ui.equipBtns} vs 状态 ${ui.equipState}`);
if (!ui.failText.includes('失误')) throw new Error('失误计数缺失: ' + ui.failText);
if (!ui.pairBtn || !ui.soloBtn || !ui.redBtn || !ui.skillBtn) throw new Error('行动按钮缺失: ' + JSON.stringify(ui));
if (!ui.exitBtn) throw new Error('联机退出按钮缺失');
console.log('界面契约 OK:', JSON.stringify(ui));

if (!(await devB.evaluate(() => !!document.querySelector('.waiting-hint')))) throw new Error('等待端缺 waiting-hint');

console.log('== 手牌分行契约（一份一行 / 多份上下分行虚线分隔）==');
const hands = await devA.evaluate(() => {
  const groups = [];
  document.querySelectorAll('.pr-shares, .own-shares').forEach(g => {
    const rows = [...g.querySelectorAll(':scope > .cards')].map((r, i) => {
      const b = r.getBoundingClientRect();
      const cs = getComputedStyle(r);
      return {
        i,
        top: Math.round(b.top),
        left: Math.round(b.left),
        overflow: r.scrollWidth - r.clientWidth,
        divider: i === 0 ? '' : cs.borderTopStyle,
        cw: parseInt(r.style.getPropertyValue('--cw'), 10) || 0,
        count: r.children.length,
      };
    });
    const stacked = rows.every((r, i) => i === 0 || (r.top >= rows[i - 1].top + 40 && Math.abs(r.left - rows[i - 1].left) <= 1));
    groups.push({ kind: g.classList.contains('own-shares') ? 'own' : 'pr', n: rows.length, rows, stacked });
  });
  return groups;
});
if (!hands.length) throw new Error('未找到手牌行容器');
for (const g of hands) {
  if (g.n >= 2 && !g.stacked) throw new Error('多份手牌应上下分行: ' + JSON.stringify(g));
  for (const r of g.rows) {
    if (r.i > 0 && r.divider !== 'dashed') throw new Error('多份手牌行间应为虚线分隔: ' + JSON.stringify(g));
    if (r.overflow > 1) throw new Error(`手牌一行溢出: ${g.kind} overflow=${r.overflow} ${JSON.stringify(r)}`);
    if (r.cw < 12) throw new Error(`手牌缩放过度: cw=${r.cw} ${JSON.stringify(r)}`);
  }
}
console.log('手牌分行契约 OK:', hands.map(g => `${g.kind}x${g.n}[${g.rows.map(r => `${r.count}张/${r.cw}px`).join(',')}] stacked=${g.stacked}`).join(' | '));

console.log('== 道具点击未使用时取消 ==');
const eqBefore = await devA.evaluate(() => JSON.stringify(window.S.equipment));
await devA.evaluate(() => {
  window.S.equipment = [{ no: 1, unlocked: true, used: false }, { no: 2, unlocked: true, used: false }, { no: 3, unlocked: true, used: false }];
  window.saveStateDirect();
  window.render();
});
await devA.waitForTimeout(300);

// ① 点击道具3（三重探测器）→ 进入扫描态 + 按钮激活；再次点击同一道具 → 取消
await devA.click('[data-testid="equip-3"]');
await waitEval(devA, () => { const h = document.querySelector('.mode-hint'); return !!(h && h.textContent.includes('依次点选')); }, '点击道具3进入扫描态');
const eq3Active = await devA.evaluate(() => document.querySelector('[data-testid="equip-3"]').classList.contains('active'));
if (!eq3Active) throw new Error('道具3使用中应呈激活态');
await devA.waitForTimeout(300);
await devA.screenshot({ path: SHOTS + '/e2e-12b-equip-active.png' });
await devA.click('[data-testid="equip-3"]');
await waitEval(devA, () => !document.querySelector('.mode-hint') && !document.querySelector('[data-testid="equip-3"]').classList.contains('active'), '再次点击道具3取消');

// ② 点击道具1（≠标签）→ 取消按钮退出
await devA.click('[data-testid="equip-1"]');
await waitEval(devA, () => { const h = document.querySelector('.mode-hint'); return !!(h && h.textContent.includes('相邻的 2 张')); }, '点击道具1进入≠选择态');
await devA.click('[data-testid="btn-cancel"]');
await waitEval(devA, () => !document.querySelector('.mode-hint'), '取消按钮退出≠选择态');

// ③ 对讲机：选自己的牌 → 对象弹层 → 弹层取消 → 弹层关闭且未消耗道具
await devA.click('[data-testid="equip-2"]');
await waitEval(devA, () => { const h = document.querySelector('.mode-hint'); return !!(h && h.textContent.includes('点选自己的 1 张未公开导线')); }, '点击道具2进入对讲机选牌态');
await devA.click(`.own-hand[data-seat="${seatA}"] .card-own:not(.revealed)`);
await devA.waitForSelector('#sheetOverlay.show', { timeout: 5000 });
await devA.waitForTimeout(300);
await devA.screenshot({ path: SHOTS + '/e2e-12c-walkie-cancel.png' });
await devA.click('#sheetContent .btn-secondary');
await devA.waitForTimeout(400);
if (await devA.evaluate(() => document.getElementById('sheetOverlay').classList.contains('show'))) throw new Error('取消后对讲机弹层未关闭');
const eqAfter = await devA.evaluate(() => ({
  used: window.S.equipment.map(e => e.used),
  pending: window.S.pending,
  cur: window.S.currentSeat,
  modeHint: !!document.querySelector('.mode-hint'),
}));
if (eqAfter.used.some(Boolean) || eqAfter.pending !== null || eqAfter.cur !== seatA || eqAfter.modeHint) {
  throw new Error('取消后不应消耗道具/不产生残留: ' + JSON.stringify(eqAfter));
}
await devA.evaluate((orig) => { window.S.equipment = JSON.parse(orig); window.saveStateDirect(); window.render(); }, eqBefore);
await devA.waitForTimeout(300);
// 聚光失误色路径（自然对局难以构造 guaranteed-miss）：直接调用 _spotlight 验证类切换
const spotProbe = await devA.evaluate(() => {
  const id = window.S.players[window.S.currentSeat].shares[0][0].id;
  _spotlight({ ids: [id] }, 'miss');
  const el = document.querySelector(`[data-cardid="${id}"]`);
  const ok = !!el && el.classList.contains('fx-target') && el.classList.contains('fx-miss') && !el.classList.contains('fx-hit');
  if (el) el.classList.remove('fx-target', 'fx-hit', 'fx-miss');
  return ok;
});
if (!spotProbe) throw new Error('fx-miss 聚光类切换异常');
console.log('道具取消 OK（再次点击 / 取消按钮 / 弹层取消 三条路径，未消耗道具；聚光 miss 色路径 OK）');

await devA.click('.log-bar');
await devA.waitForSelector('#sheetOverlay.show', { timeout: 5000 });
const logItems = await devA.evaluate(() => document.querySelectorAll('#sheetContent .log-item').length);
if (logItems < 3) throw new Error('日志条目过少: ' + logItems);
await devA.click('#sheetContent .sheet-close');
await devA.waitForTimeout(400);

console.log('== 双重探测器扫描 ==');
await devA.click('[data-testid="btn-skill"]');
await waitEval(devA, () => {
  const h = document.querySelector('.mode-hint');
  return !!(h && h.textContent.includes('依次点选'));
}, '行动端进入扫描选择态');

// 未消耗可反悔：退出选择 → 面板提供【取消】→ 技能恢复未使用 → 重新启动
await devA.click('[data-testid="btn-cancel"]');
await waitEval(devA, () => {
  const h = document.querySelector('.action-bar .mode-hint');
  const c = document.querySelector('[data-testid="btn-cancel-skill"]');
  return !!(h && h.textContent.includes('已启动双重探测器') && c);
}, '退出选择后出现 取消/开始扫描 面板');
await devA.screenshot({ path: SHOTS + '/e2e-12d-skill-cancel-panel.png' });
await devA.click('[data-testid="btn-cancel-skill"]');
await waitEval(devA, () => {
  const sn = window.S.currentSeat;
  return !window.S.scanMode && !window.S.players[sn].skillUsed;
}, '取消探测器：扫描态清除、技能恢复未使用');
await devA.click('[data-testid="btn-skill"]');
await waitEval(devA, () => {
  const h = document.querySelector('.mode-hint');
  return !!(h && h.textContent.includes('依次点选'));
}, '取消后可重新启动探测器');

const scanPlan = await devA.evaluate(() => {
  const s = window.S;
  const actor = s.currentSeat;
  const mine = s.players[actor].shares.flat().filter(c => c.kind === 'blue' && !c.revealed);
  for (let k = 0; k < s.pCount; k++) {
    if (k === actor) continue;
    for (const sh of (s.players[k].shares || [])) {
      for (let i = 0; i + 1 < sh.length; i++) {
        const a = sh[i], b = sh[i + 1];
        if (a.revealed || b.revealed) continue;
        for (const c of [a, b]) {
          if (c.kind === 'blue') {
            const m = mine.find(x => x.num === c.num);
            if (m) return { seat: k, ids: [a.id, b.id], ownId: m.id, num: c.num };
          }
        }
      }
    }
  }
  for (let k = 0; k < s.pCount; k++) {
    if (k === actor) continue;
    for (const sh of (s.players[k].shares || [])) {
      for (let i = 0; i + 1 < sh.length; i++) {
        if (sh[i].revealed || sh[i + 1].revealed) continue;
        return { seat: k, ids: [sh[i].id, sh[i + 1].id], ownId: mine[0].id, num: mine[0].num };
      }
    }
  }
  return null;
});
if (!scanPlan) throw new Error('构造不出扫描组合');
await devA.click(`.player-row[data-seat="${scanPlan.seat}"] .card-back[data-cardid="${scanPlan.ids[0]}"]`);
await devA.waitForTimeout(350);
await devA.click(`.player-row[data-seat="${scanPlan.seat}"] .card-back[data-cardid="${scanPlan.ids[1]}"]`);
await devA.waitForSelector('#sheetOverlay.show', { timeout: 5000 });
await devA.screenshot({ path: SHOTS + '/e2e-13-scan-guess.png' });
await devA.click(`.guess-btn[data-guess="blue-${scanPlan.num}"]`);
await devA.waitForTimeout(350);
const pickS = devA.locator(`.pick-card[data-cardid="${scanPlan.ownId}"]`);
if (await pickS.count()) await pickS.first().click();
await devA.click('[data-testid="confirm"]');
await waitEval(devA, () => !!document.querySelector('#bubble-layer .bubble.declare'), '扫描宣告气泡出现');
await waitEval(devA, (p) => p.ids.every(id => {
  const el = document.querySelector(`[data-cardid="${id}"]`);
  return !!(el && el.classList.contains('fx-target'));
}), '扫描目标双牌聚光', scanPlan);
await devA.waitForTimeout(250);
await devA.screenshot({ path: SHOTS + '/e2e-13a-scan-fx-gold.png' });
await waitEval(devA, () => {
  const t = document.querySelector('.fx-target');
  const reply = document.querySelector('#bubble-layer .bubble.reply');
  if (!t || !reply) return false;
  return reply.classList.contains('hit') ? t.classList.contains('fx-hit') : t.classList.contains('fx-miss');
}, '扫描聚光颜色与回应一致');
await devA.waitForTimeout(350);
await devA.screenshot({ path: SHOTS + '/e2e-13b-scan-bubble.png' });
await waitEval(devA, () => !window.S.fx, '扫描气泡结束（fx 清理）');
const scanFxLeft = await devA.evaluate(() => document.querySelectorAll('.fx-target').length);
if (scanFxLeft) throw new Error('扫描结算后聚光应清除，残留 ' + scanFxLeft);

const scanRes = await devA.evaluate(() => {
  const s = window.S;
  return { pending: s.pending ? s.pending.type : null, fails: s.failures };
});
console.log('扫描结算:', JSON.stringify(scanRes));
if (scanRes.pending === 'scanPick' || scanRes.pending === 'scanMark') {
  await devB.waitForSelector('.action-bar.pending .pick-card[data-cardid]', { timeout: 12000 });
  await devB.screenshot({ path: SHOTS + '/e2e-14-scan-pending.png' });
  await devB.click('.action-bar.pending .pick-card[data-cardid]');
  await devB.waitForTimeout(600);
} else if (scanRes.pending === null) {
  if (scanRes.fails !== 1) throw new Error('未命中应失误 +1，得到 ' + scanRes.fails);
}
await waitEval(devA, (sn) => window.S.currentSeat === sn, '扫描后回合流转', scanPlan.seat);
await waitEval(devB, (sn) => window.S.currentSeat === sn, '目标端同步回合', scanPlan.seat);
await waitEval(devA, () => !window.S.scanMode && window.S.pending === null, '扫描结算完毕（扫描态清理）');
await waitEval(devB, (sa) => !!window.S.players[sa].skillUsed, '远端同步技能已使用', seatA);
console.log('双重探测器全流程 OK（被动方端选牌完成）');
await devA.screenshot({ path: SHOTS + '/e2e-15-after-scan-actor.png' });
await devB.screenshot({ path: SHOTS + '/e2e-16-after-scan-peer.png' });

console.log('== 单人剪线气泡 ==');
await waitEval(devB, () => window._olSeatIndex() === window.S.currentSeat, '单人剪线前 devB 为当前行动者');
const soloPlan = await devB.evaluate(() => {
  const s = window.S;
  const actor = s.currentSeat;
  const counts = {};
  (s.players[actor].shares || []).forEach(sh => sh.forEach(c => {
    if (c.kind === 'blue') counts[c.num] = (counts[c.num] || 0) + 1;
  }));
  const num = Number(Object.keys(counts).find(n => counts[n] >= 2 && !s.board.defused[Number(n) - 1]));
  if (!num) return null;
  const ids = [];
  let took = 0;
  // 构造 pair 条件：本手留 2 张未公开，全场上该数字其余牌全部公开
  s.players.forEach((pl, k) => (pl.shares || []).forEach(sh => sh.forEach(c => {
    if (c.kind === 'blue' && c.num === num) {
      if (k === actor && took < 2) { c.revealed = false; ids.push(c.id); took++; }
      else c.revealed = true;
    }
  })));
  window.saveStateDirect();
  window.render();
  return { num, ids };
});
if (!soloPlan) throw new Error('构造不出单人剪线组合（无未拆除且手牌 ≥2 张的蓝色数字）');
await devB.screenshot({ path: SHOTS + '/e2e-16a-solo-ready.png' });
await devB.click('[data-testid="btn-solo"]');
await devB.waitForSelector('#sheetOverlay.show', { timeout: 5000 });
const soloIdx = await devB.evaluate((n) => {
  const btns = Array.from(document.querySelectorAll('[data-testid="solo-opt"]'));
  return btns.findIndex(b => b.textContent.includes('蓝色 ' + n));
}, soloPlan.num);
if (soloIdx < 0) throw new Error('单人剪线面板缺少蓝色 ' + soloPlan.num + ' 选项');
await devB.screenshot({ path: SHOTS + '/e2e-16b-solo-sheet.png' });
await devB.click(`[data-testid="solo-opt"][data-idx="${soloIdx}"]`);
await waitEval(devB, () => {
  const b = document.querySelector('#bubble-layer .bubble.declare');
  return !!(b && b.textContent.includes('我公开我手上的'));
}, '单人剪线宣告气泡出现');
await waitEval(devB, (p) => p.ids.every(id => {
  const el = document.querySelector(`[data-cardid="${id}"]`);
  return !!(el && el.classList.contains('fx-target'));
}), '发起端目标双牌聚光', soloPlan);
const soloMid = await devB.evaluate((p) => {
  const s = window.S;
  const all = [];
  s.players.forEach(pl => (pl.shares || []).forEach(sh => sh.forEach(c => all.push(c))));
  return {
    fx: !!s.fx,
    reply: !!document.querySelector('#bubble-layer .bubble.reply'),
    revealed: p.ids.every(id => { const c = all.find(x => x.id === id); return !!(c && c.revealed); }),
  };
}, soloPlan);
if (!soloMid.fx) throw new Error('单人剪线宣告的 fx 应仍在进行');
if (soloMid.reply) throw new Error('单人剪线不应出现回应气泡');
if (soloMid.revealed) throw new Error('气泡期间不应提前公开牌');
await devB.waitForTimeout(250);
await devB.screenshot({ path: SHOTS + '/e2e-16c-solo-declare-actor.png' });
await waitEval(devA, (p) => p.ids.every(id => {
  const el = document.querySelector(`[data-cardid="${id}"]`);
  return !!(el && el.classList.contains('fx-target'));
}), '被动端同步聚光', soloPlan);
await devA.screenshot({ path: SHOTS + '/e2e-16d-solo-declare-peer.png' });
await waitEval(devB, () => !window.S.fx, '单人剪线气泡结束（fx 清理）');
const soloFxLeft = await devB.evaluate(() => document.querySelectorAll('.fx-target').length);
if (soloFxLeft) throw new Error('单人剪线结算后聚光应清除，残留 ' + soloFxLeft);
const soloRes = await devB.evaluate((p) => {
  const s = window.S;
  const all = [];
  s.players.forEach(pl => (pl.shares || []).forEach(sh => sh.forEach(c => all.push(c))));
  return {
    revealed: p.ids.every(id => { const c = all.find(x => x.id === id); return !!(c && c.revealed); }),
    defused: !!s.board.defused[p.num - 1],
    cur: s.currentSeat,
  };
}, soloPlan);
if (!soloRes.revealed) throw new Error('气泡结束后两张牌应公开');
if (!soloRes.defused) throw new Error('4/4 公开后蓝色 ' + soloPlan.num + ' 应盖拆除章');
await waitEval(devA, (p) => {
  const s = window.S;
  const all = [];
  s.players.forEach(pl => (pl.shares || []).forEach(sh => sh.forEach(c => all.push(c))));
  return !s.fx && p.ids.every(id => { const c = all.find(x => x.id === id); return !!(c && c.revealed); });
}, '被动端同步公开结果', soloPlan);
await waitEval(devB, (sn) => window.S.currentSeat === sn, '单人剪线后回合流转到 devA', seatA);
await devB.screenshot({ path: SHOTS + '/e2e-16e-solo-done.png' });
console.log('单人剪线气泡全流程 OK:', JSON.stringify(soloRes));

console.log('== 公开红线气泡 ==');
await waitEval(devA, () => window._olSeatIndex() === window.S.currentSeat, '公开红线前 devA 为当前行动者');
const redPlan = await devA.evaluate(() => {
  const s = window.S;
  const actor = s.currentSeat;
  let red = null, redSeat = -1;
  s.players.forEach((pl, k) => (pl.shares || []).forEach(sh => sh.forEach(c => {
    if (c.kind === 'red') { red = c; redSeat = k; }
  })));
  if (!red) return null;
  if (redSeat !== actor) {
    // 注入：红牌不在当前行动者手上时，与行动者一张非红牌对调（保持各份张数不变）
    let donor = null;
    s.players[redSeat].shares.forEach((sh, si) => sh.forEach((c, i) => { if (c.id === red.id) donor = { si, i }; }));
    let dst = null;
    s.players[actor].shares.forEach((sh, si) => sh.forEach((c, i) => { if (!dst && c.kind !== 'red') dst = { si, i }; }));
    if (!donor || !dst) return null;
    const tmp = s.players[actor].shares[dst.si][dst.i];
    s.players[actor].shares[dst.si][dst.i] = red;
    s.players[redSeat].shares[donor.si][donor.i] = tmp;
  }
  // 行动者其余牌全部公开，红牌保持未公开
  s.players[actor].shares.forEach(sh => sh.forEach(c => { c.revealed = c.id !== red.id; }));
  window.saveStateDirect();
  window.render();
  return { id: red.id, seat: actor };
});
if (!redPlan) throw new Error('注入红色导线失败');
await devA.waitForSelector('[data-testid="btn-red"]:not([disabled])', { timeout: 5000 });
await devA.screenshot({ path: SHOTS + '/e2e-17a-red-ready.png' });
await devA.click('[data-testid="btn-red"]');
await waitEval(devA, () => {
  const b = document.querySelector('#bubble-layer .bubble.declare');
  return !!(b && b.textContent.includes('最后一张红色导线'));
}, '公开红线宣告气泡出现');
await waitEval(devA, (p) => {
  const el = document.querySelector(`[data-cardid="${p.id}"]`);
  return !!(el && el.classList.contains('fx-target'));
}, '红线聚光', redPlan);
const redMid = await devA.evaluate((p) => {
  const s = window.S;
  const all = [];
  s.players.forEach(pl => (pl.shares || []).forEach(sh => sh.forEach(c => all.push(c))));
  const c = all.find(x => x.id === p.id);
  return {
    fx: !!s.fx,
    reply: !!document.querySelector('#bubble-layer .bubble.reply'),
    revealed: !!(c && c.revealed),
  };
}, redPlan);
if (!redMid.fx) throw new Error('公开红线宣告的 fx 应仍在进行');
if (redMid.reply) throw new Error('公开红线不应出现回应气泡');
if (redMid.revealed) throw new Error('气泡期间不应提前公开红线');
await devA.waitForTimeout(250);
await devA.screenshot({ path: SHOTS + '/e2e-17b-red-declare-actor.png' });
await waitEval(devB, (p) => {
  const b = document.querySelector('#bubble-layer .bubble.declare');
  const el = document.querySelector(`[data-cardid="${p.id}"]`);
  return !!(b && b.textContent.includes('最后一张红色导线') && el && el.classList.contains('fx-target'));
}, '被动端同步红线气泡与聚光', redPlan);
await devB.screenshot({ path: SHOTS + '/e2e-17c-red-declare-peer.png' });
await waitEval(devA, () => !window.S.fx, '公开红线气泡结束（fx 清理）');
const redFxLeft = await devA.evaluate(() => document.querySelectorAll('.fx-target').length);
if (redFxLeft) throw new Error('公开红线结算后聚光应清除，残留 ' + redFxLeft);
const redRes = await devA.evaluate((p) => {
  const s = window.S;
  const all = [];
  s.players.forEach(pl => (pl.shares || []).forEach(sh => sh.forEach(c => all.push(c))));
  const c = all.find(x => x.id === p.id);
  return { revealed: !!(c && c.revealed), cur: s.currentSeat, over: s.phase === 'over' };
}, redPlan);
if (!redRes.revealed) throw new Error('气泡结束后红色导线应公开');
if (redRes.over) throw new Error('公开红线不应直接终局');
await waitEval(devB, (p) => {
  const b = document.querySelector('.log-bar');
  return !!b && b.textContent.includes('公开了红色导线');
}, '被动端同步红线日志', redPlan);
await devA.screenshot({ path: SHOTS + '/e2e-17d-red-done.png' });
console.log('公开红线气泡全流程 OK:', JSON.stringify(redRes));

console.log('== 结算弹窗 + 再来一局 ==');
// 状态注入（UI 层契约验证）：模拟胜利，检验结算弹窗双端渲染与联机按钮。
// 终局快照必须由「当前行动者」推送：联机层守卫（iAmAlreadyOperator）会跳过
// 自己回合里的远端快照，非行动者注入会被另一端拒收。公开红线后回合已流转到 devB。
const injectDev = (await devB.evaluate(() => window._olSeatIndex() === window.S.currentSeat)) ? devB : devA;
await waitEval(injectDev, () => window._olSeatIndex() === window.S.currentSeat, '注入端为当前行动者');
await injectDev.evaluate(() => {
  window.S.phase = 'over';
  window.S.result = { win: true };
  window.saveStateDirect();
  window.render();
});
await p1.waitForSelector('#endModal.show', { timeout: 12000 });
await p2.waitForSelector('#endModal.show', { timeout: 12000 });
const hostView = await p1.evaluate(() => {
  const c = document.getElementById('endModalContent');
  return {
    win: !!c.querySelector('.end-wrap.win'),
    title: c.querySelector('.end-title').textContent,
    restart: !!c.querySelector('[data-testid="btn-restart"]'),
  };
});
const memberView = await p2.evaluate(() => {
  const c = document.getElementById('endModalContent');
  return {
    wait: c.textContent.includes('等待房主'),
    restart: !!c.querySelector('[data-testid="btn-restart"]'),
  };
});
if (!hostView.win || !hostView.title.includes('拆弹成功')) throw new Error('房主结算面板异常: ' + JSON.stringify(hostView));
if (!hostView.restart) throw new Error('房主结算面板缺「再来一局」');
if (memberView.restart || !memberView.wait) throw new Error('成员结算面板应只等待房主: ' + JSON.stringify(memberView));
console.log('结算弹窗（双端）OK:', JSON.stringify(hostView));
await p1.screenshot({ path: SHOTS + '/e2e-17-end-host.png' });
await p2.screenshot({ path: SHOTS + '/e2e-18-end-member.png' });

// own-area 下方终局区：房主渲染按钮（再来一局 + 返回房间），成员仅等待提示
const areaOf = page => page.evaluate(() => {
  const a = document.querySelector('[data-testid="end-actions"]');
  const own = document.querySelector('.own-area');
  if (!a || !own) return null;
  return {
    belowOwn: !!(own.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING),
    again: !!a.querySelector('[data-testid="btn-again"]'),
    back: !!a.querySelector('[data-testid="btn-back-room"]'),
    text: a.textContent,
  };
});
const areaP1 = await areaOf(p1);
const areaP2 = await areaOf(p2);
if (!areaP1 || !areaP1.belowOwn || !areaP1.again || !areaP1.back) throw new Error('房主终局按钮区异常: ' + JSON.stringify(areaP1));
if (!areaP2 || !areaP2.belowOwn || areaP2.again || areaP2.back) throw new Error('成员侧不应渲染终局按钮: ' + JSON.stringify(areaP2));
if (!areaP2.text.includes('等待房主操作')) throw new Error('成员侧应提示等待房主操作: ' + areaP2.text);
console.log('终局区（房主按钮 / 成员等待提示，own-area 下方）OK');

// 关闭弹窗后截图终局区（own-area 下方）
await p1.evaluate(() => closeModal('endModal'));
await p2.evaluate(() => closeModal('endModal'));
await p1.waitForTimeout(400);
await p1.screenshot({ path: SHOTS + '/e2e-17b-end-area-host.png' });
await p2.screenshot({ path: SHOTS + '/e2e-17c-end-area-member.png' });

// 房主点「再来一局」→ 本局重开（双端进入标记阶段）
await p1.click('[data-testid="btn-again"]');
await p1.waitForTimeout(800);
await waitEval(p1, () => window.S.phase === 'mark', '房主进入新一局标记阶段');
await waitEval(p2, () => window.S.phase === 'mark', '成员进入新一局标记阶段');
if (await p2.evaluate(() => document.getElementById('endModal').classList.contains('show'))) {
  throw new Error('新一局开始后成员端结算弹窗未自动关闭');
}
if (await p1.evaluate(() => !!document.querySelector('[data-testid="end-actions"]'))) {
  throw new Error('新一局开始后终局按钮区应消失');
}
if (await p2.evaluate(() => !!document.querySelector('[data-testid="end-actions"]'))) {
  throw new Error('新一局开始后成员端等待提示区应消失');
}
if (!(await p1.evaluate(() => window.S.ready.every(x => x === false)))) throw new Error('新一局就绪位应重置');
console.log('再来一局 OK（远端弹窗自动关闭、按钮区消失）');
await p1.screenshot({ path: SHOTS + '/e2e-19-restart-host.png' });

console.log('== 成员退出 + 房主接管 ==');
await p2.click('#exitRoomBtn');
await p2.waitForTimeout(500);
await p2.click('button:has-text("确认退出")');
await p1.waitForSelector('#modalOverlay.show', { timeout: 15000 });
const departText = await p1.evaluate(() => document.getElementById('modalContent').textContent);
if (!departText.includes('玩家离开')) throw new Error('房主未收到玩家离开弹窗');
await p1.screenshot({ path: SHOTS + '/e2e-20-depart-dialog.png' });
await p1.click('button:has-text("接管操作")');
await p1.waitForTimeout(1000);
const dep = await p1.evaluate(() => ({
  d: window.S.departedPlayers || [],
  ownHands: document.querySelectorAll('.own-hand').length,
}));
if (dep.d.indexOf(1) < 0) throw new Error('接管后 departedPlayers 应含座位1: ' + JSON.stringify(dep.d));
if (dep.ownHands !== 2) throw new Error('接管后房主应可见两名玩家的手牌，得到 ' + dep.ownHands);

await p1.waitForSelector('.own-hand[data-seat="0"] .card-own.kind-blue.selectable', { timeout: 5000 });
await p1.click('.own-hand[data-seat="0"] .card-own.kind-blue.selectable');
await p1.waitForTimeout(400);
await p1.click('.own-hand[data-seat="1"] .card-own.kind-blue.selectable');
await p1.waitForTimeout(600);
await waitEval(p1, () => window.S.phase === 'play', '接管代操作完成双人标记进入对局');
console.log('接管代操作 OK（房主完成自己与离席玩家标记）');
await p1.screenshot({ path: SHOTS + '/e2e-21-takeover-mark.png' });

await waitEval(p2, () => !!document.querySelector('.landing'), '成员回到着陆页');
await p2.screenshot({ path: SHOTS + '/e2e-22-p2-back-landing.png' });

console.log('== 返回房间 → 新玩家加入 → 房主重开 ==');
// 此时房间仅剩房主 1 座（成员已退出）。注入终局态后点「返回房间」：
// 房间回到 waiting（支持新玩家加入），新玩家入座后由房主重开
await p1.evaluate(() => {
  window.S.phase = 'over';
  window.S.result = { win: false, reason: 'boom-red' };
  window.saveStateDirect();
  window.render();
});
await p1.waitForSelector('#endModal.show', { timeout: 8000 });
await p1.evaluate(() => closeModal('endModal'));
await p1.click('[data-testid="btn-back-room"]');
await waitEval(p1, () => document.getElementById('online').style.display === 'flex'
  && document.getElementById('app').style.display === 'none', '房主切回等候室');
const backTitle = await waitEval(p1, (c) => {
  const h = document.querySelector('#online .setup-header h1');
  return (h && h.textContent.includes(c)) ? h.textContent : '';
}, '等候室显示原房间号', code);
if (await p1.evaluate(() => document.getElementById('endModal').classList.contains('show'))) {
  throw new Error('返回房间后结算弹窗应关闭');
}
await waitEval(p1, () => document.querySelectorAll('#online .setup-chip').length === 1, '返回房间后保留房主 1 座');
await p1.screenshot({ path: SHOTS + '/e2e-23-back-waiting-host.png' });

const p3 = await mkPage('P3', '小刚');
await p3.click('text=联机模式');
await p3.fill('#joinRoomInput', code);
await p3.fill('#joinNameInput', '小刚');
await p3.click('text=加入房间');
await waitEval(p1, () => document.querySelectorAll('#online .setup-chip').length === 2, '房主看到新成员加入');
await p3.waitForTimeout(2000);
await p1.screenshot({ path: SHOTS + '/e2e-24-p3-joined-host.png' });
await p3.screenshot({ path: SHOTS + '/e2e-25-p3-waiting.png' });

await p1.click('text=开始游戏');
await waitEval(p1, () => window.S && window.S.phase === 'mark' && window.S.pCount === 2, '房主重开进入标记阶段');
await waitEval(p3, () => window.S && window.S.phase === 'mark', '新玩家进入新局');
const p3Names = await p3.evaluate(() => window.S.players.map(p => p.name).join(','));
if (!p3Names.includes('小刚')) throw new Error('新玩家应入座新局: ' + p3Names);
console.log('返回房间 + 新玩家加入 + 房主重开 OK:', backTitle.trim(), '→', p3Names);
await p1.screenshot({ path: SHOTS + '/e2e-26-reopen-host.png' });
await p3.screenshot({ path: SHOTS + '/e2e-27-reopen-p3.png' });

console.log('E2E 完成');
await browser.close();
})().catch(e => { console.error('E2E FAIL:', e); process.exit(1); });
