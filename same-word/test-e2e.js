/**
 * 同词相遇 · 端到端联机测试（Playwright / Chromium / 390x844 移动视口）
 *
 * 依赖：项目根 node_modules 里的 playwright（无需安装别的包）
 * 运行：node same-word/test-e2e.js
 * 前置：E:/www_self/bg-star100/take-time/serve.js 在 8123 端口服务项目根
 *
 * 覆盖：
 *  A 着陆页 + 规则弹层（无 pageerror / 无严重 console error）
 *  B 双人撞词：建房 → 加入 → 开局 → 同时提交同一个词 → 撞词结算
 *  C 双人认证：不同词 → 揭晓双方词 → 双方「意思一样」→ agree 结算
 *  D 双人下一轮 + 刷新恢复：单方 next 停留揭晓，双方 next → 第 2 轮 → 刷新回到原座位 → 放弃结算
 *  E 多人营地同频：2 人不可开局 → 第 3 人加入 → 开局 → 揭晓 → 互认 → 全员准备 → 下一局 → 提前结束
 *  F 320px 窄屏：首页/创建弹层/规则弹层无横向溢出
 *
 * 真实 Supabase 共享房间表：昵称带随机后缀，结束后房主主动离开关闭房间。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8123/same-word/index.html';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEW = { width: 390, height: 844 };
const problems = [];   // {tag, kind, text}
const appLog = [];     // 应用内 [SWN]/[SWR] 日志（失败时打印，便于定位实时问题）
let shotSeq = 0;

async function newClient(browser, tag, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || VIEW, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => problems.push({ tag, kind: 'pageerror', text: e.message }));
  page.on('console', m => {
    const t = m.text();
    if (/\[SWN\]|\[SWR\]/.test(t)) appLog.push(tag + ' ' + m.type() + ': ' + t.slice(0, 220));
    if (m.type() === 'error') problems.push({ tag, kind: 'console', text: t.slice(0, 300) });
  });
  page.on('response', r => {
    if (r.status() >= 400) problems.push({ tag, kind: 'http', text: r.status() + ' ' + r.url().slice(0, 160) });
  });
  page.on('dialog', d => d.accept());
  return { ctx, page, tag };
}

async function shot(page, name) {
  shotSeq += 1;
  const file = path.join(SHOTS, 'e2e-' + String(shotSeq).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: file });
  return file;
}

async function boot(client) {
  await client.page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await client.page.waitForSelector('.landing', { timeout: 25000 });
  await client.page.waitForFunction(() => document.body.classList.contains('is-ready'));
}

async function createRoom(client, opts) {
  const p = client.page;
  await p.click('[data-act="open-create"]');
  await p.waitForSelector('#createName');
  await p.fill('#createName', opts.name);
  if (opts.mode === 'party') {
    await p.click('[data-act="pick-mode"][data-mode="party"]');
    await p.click('[data-act="pick-round"][data-v="10"]');
  }
  if (opts.timeLimit) await p.click('[data-act="pick-time"][data-v="' + opts.timeLimit + '"]');
  await p.click('[data-act="create-submit"]');
  await p.waitForSelector('.screen.waiting [data-act="start-game"]', { timeout: 25000 });
  const code = (await p.textContent('.room-code')).replace(/\s/g, '');
  if (!/^\d{4}$/.test(code)) throw new Error('房间号异常: ' + code);
  return code;
}

async function joinRoom(client, code, name) {
  const p = client.page;
  await p.click('[data-act="open-join"]');
  await p.waitForSelector('#joinCode');
  await p.fill('#joinCode', code);
  await p.fill('#joinName', name);
  await p.click('[data-act="join-submit"]');
  await p.waitForSelector('.screen.waiting', { timeout: 25000 });
}

async function startGame(client) {
  const p = client.page;
  await p.waitForFunction(() => {
    const b = document.querySelector('[data-act="start-game"]');
    return b && !b.disabled;
  }, null, { timeout: 30000 });
  await p.click('[data-act="start-game"]');
  await p.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
}

async function submitWord(client, word) {
  const p = client.page;
  await p.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
  await p.fill('#wordInput', word);
  await p.click('[data-act="submit-word"]');
  await p.waitForSelector('.screen.playing .sealed-card', { timeout: 15000 });
}

async function waitReveal(client) {
  await client.page.waitForSelector('.screen.reveal', { timeout: 35000 });
}

async function vote(client, value) {
  const p = client.page;
  await p.waitForSelector('[data-act="duel-vote"][data-v="' + value + '"]', { timeout: 25000 });
  await p.click('[data-act="duel-vote"][data-v="' + value + '"]');
}

async function waitFinished(client, text, timeout) {
  const p = client.page;
  await p.waitForSelector('.screen.finished', { timeout: timeout || 40000 });
  if (text) await p.waitForFunction(t => document.body.innerText.includes(t), text, { timeout: 15000 });
}

async function leaveRoom(client) {
  const p = client.page;
  try {
    const el = await p.$('[data-act="leave-room"]');
    if (!el) return;
    await el.click();
    await p.waitForSelector('[data-act="confirm-ok"]', { timeout: 6000 });
    await p.click('[data-act="confirm-ok"]');
    await p.waitForTimeout(600);
  } catch (e) { /* 清理失败不阻塞 */ }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function assertNoOverflow(page, label) {
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    win: window.innerWidth,
  }));
  assert(m.doc <= m.win + 1 && m.body <= m.win + 1,
    label + ' 出现横向溢出: ' + JSON.stringify(m));
}

/* ---------------- 场景 ---------------- */

async function scnBootLanding(browser) {
  const c = await newClient(browser, 'A', VIEW);
  await boot(c);
  const title = await c.page.title();
  assert(/同词相遇/.test(title), '标题不含「同词相遇」: ' + title);
  const txt = await c.page.evaluate(() => document.getElementById('app').innerText);
  ['创建房间', '加入房间', '规则'].forEach(t => assert(txt.includes(t), '首页缺少: ' + t));
  await c.page.click('[data-act="open-rules"]');
  await c.page.waitForSelector('#modalPanel .rules-body', { timeout: 8000 });
  await c.page.waitForTimeout(400);
  const rules = await c.page.evaluate(() => document.getElementById('modalPanel').innerText);
  ['同心小径', '营地同频', '判同'].forEach(t => assert(rules.includes(t), '规则缺少: ' + t));
  await shot(c.page, 'landing-rules');
  await c.page.click('#modalPanel [data-act="sheet-close"]');
  await c.page.waitForTimeout(300);
  await c.page.click('[data-act="open-create"]');
  await c.page.waitForSelector('#createName');
  const hasCreate = await c.page.evaluate(() => document.querySelectorAll('[data-act="pick-mode"]').length);
  assert(hasCreate === 2, '创建弹层玩法选项数异常: ' + hasCreate);
  await c.page.waitForTimeout(400);
  await shot(c.page, 'create-sheet');
  await c.page.click('#sheetPanel [data-act="sheet-close"]');
  await c.page.screenshot({ path: path.join(SHOTS, 'e2e-landing.png') });
  await c.ctx.close();
  console.log('[A] 着陆页 / 规则 / 创建弹层 OK');
}

async function scnDuelMatch(browser, sfx) {
  const host = await newClient(browser, 'B-host', VIEW);
  const guest = await newClient(browser, 'B-guest', VIEW);
  try {
    await boot(host);
    const code = await createRoom(host, { name: '甲' + sfx, mode: 'duel' });
    console.log('[B] 房间号', code);
    await boot(guest);
    await joinRoom(guest, code, '乙' + sfx);
    await host.page.waitForFunction(() => !document.querySelector('[data-act="start-game"]').disabled, null, { timeout: 30000 });
    const seatText = await host.page.evaluate(() => document.querySelector('.seat-grid').innerText);
    assert(seatText.includes('甲' + sfx) && seatText.includes('乙' + sfx), '等候室座位列表不完整: ' + seatText);
    await shot(host.page, 'duel-waiting-2p');
    await startGame(host);
    await guest.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    await submitWord(host, '夏天');
    await submitWord(guest, '夏天');
    await waitFinished(host, '同一个词', 40000);
    await shot(host.page, 'duel-match-result-host');
    await waitFinished(guest, '同一个词', 40000);
    const res = await host.page.evaluate(() => document.querySelector('.screen.finished').innerText);
    assert(res.includes('灵魂双胞胎'), '第 1 轮撞词称号应为「灵魂双胞胎」: ' + res.slice(0, 120));
    await shot(guest.page, 'duel-match-result-guest');

    // 分享长图：等庆祝层收起后生成 Canvas
    await host.page.waitForTimeout(2900);
    await host.page.click('[data-act="share-result"]');
    await host.page.waitForSelector('#sheetPanel .share-img-wrap img', { timeout: 20000 });
    const canvas = await host.page.evaluate(() => {
      const img = document.querySelector('#sheetPanel .share-wrap img');
      return { w: img.naturalWidth, h: img.naturalHeight };
    });
    assert(canvas.w === 900 && canvas.h > 500, '分享长图尺寸异常: ' + JSON.stringify(canvas));
    await shot(host.page, 'duel-share-image');
    await host.page.click('#sheetPanel [data-act="sheet-close"]');
    await host.page.waitForTimeout(400);
    await leaveRoom(host);
    await host.page.waitForTimeout(1200);
    console.log('[B] 双人同词 → 撞词结算 OK');
  } finally {
    await host.ctx.close(); await guest.ctx.close();
  }
}

async function scnDuelAgree(browser, sfx) {
  const host = await newClient(browser, 'C-host', VIEW);
  const guest = await newClient(browser, 'C-guest', VIEW);
  try {
    await boot(host);
    const code = await createRoom(host, { name: '丙' + sfx, mode: 'duel' });
    await boot(guest);
    await joinRoom(guest, code, '丁' + sfx);
    await startGame(host);
    await guest.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    await submitWord(host, '冬天');
    await submitWord(guest, '火锅');
    await waitReveal(host);
    await waitReveal(guest);
    const hostWords = await host.page.evaluate(() => document.querySelector('.word-grid').innerText);
    assert(hostWords.includes('冬天') && hostWords.includes('火锅'), '揭晓未展示双方词: ' + hostWords);
    const title = await host.page.textContent('.reveal-title');
    assert(title.includes('差一点点'), '非撞词揭晓标题应含「差一点点」: ' + title);
    await shot(host.page, 'duel-reveal-mismatch');
    await vote(host, 'same');
    await vote(guest, 'same');
    await waitFinished(host, '意思一样', 40000);
    await shot(host.page, 'duel-agree-result');
    const r = await host.page.evaluate(() => document.querySelector('.screen.finished').innerText);
    assert(r.includes('达成「意思一样」认证'), 'agree 结算标题异常: ' + r.slice(0, 100));
    await leaveRoom(host);
    await host.page.waitForTimeout(1000);
    console.log('[C] 双人不同词 → 双方认证 → agree 结算 OK');
  } finally {
    await host.ctx.close(); await guest.ctx.close();
  }
}

async function scnDuelNextAndRestore(browser, sfx) {
  const host = await newClient(browser, 'D-host', VIEW);
  const guest = await newClient(browser, 'D-guest', VIEW);
  try {
    await boot(host);
    const code = await createRoom(host, { name: '戊' + sfx, mode: 'duel' });
    await boot(guest);
    await joinRoom(guest, code, '己' + sfx);
    await startGame(host);
    await guest.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    await submitWord(host, '苹果');
    await submitWord(guest, '月亮');
    await waitReveal(host);
    await waitReveal(guest);
    await vote(host, 'next');
    await host.page.waitForFunction(() => {
      const d = document.querySelector('#duelDynamic');
      const b = document.querySelector('.round-pill b');
      return d && d.innerText.includes('也表态后才推进') && b && b.textContent.trim() === '1';
    }, null, { timeout: 15000 });
    await host.page.waitForTimeout(600);
    const hold = await host.page.evaluate(() => ({
      reveal: !!document.querySelector('.screen.reveal'),
      round: (document.querySelector('.round-pill b') || {}).textContent || '',
      text: (document.querySelector('#duelDynamic') || {}).innerText || '',
      seat: window.SWN && SWN.getSeat ? SWN.getSeat() : null,
      decisions: window.SWR && SWR.getState ? (SWR.getState() || {}).decisions : null
    }));
    assert(hold.reveal && hold.round.trim() === '1', '单方表态后不应推进: ' + JSON.stringify(hold));
    assert(hold.text.includes('也表态后才推进'), '缺少等待对方表态提示: ' + hold.text);
    await vote(guest, 'next');
    await host.page.waitForFunction(() => {
      const b = document.querySelector('.round-pill b');
      return b && b.textContent.trim() === '2' && document.querySelector('#wordInput');
    }, null, { timeout: 40000 });
    await guest.page.waitForFunction(() => {
      const b = document.querySelector('.round-pill b');
      return b && b.textContent.trim() === '2' && document.querySelector('#wordInput');
    }, null, { timeout: 40000 });
    await shot(host.page, 'duel-round2-host');

    // 刷新恢复：guest 中途 reload 应回到第 2 轮同一座位
    await guest.page.reload({ waitUntil: 'domcontentloaded' });
    await guest.page.waitForFunction(() => {
      const b = document.querySelector('.round-pill b');
      return !!document.querySelector('#wordInput') && b && b.textContent.trim() === '2';
    }, null, { timeout: 40000 });
    const sess = await guest.page.evaluate(() => window.SWN && SWN.getSeat());
    assert(sess === 1, '刷新后座位未恢复: ' + sess);
    await shot(guest.page, 'duel-round2-after-reload');

    // 房主放弃 → 结算（刷新后的成员也能收到）
    await host.page.click('[data-act="giveup"]');
    await host.page.waitForSelector('[data-act="confirm-ok"]', { timeout: 8000 });
    await host.page.click('[data-act="confirm-ok"]');
    await waitFinished(host, '一起坚持了', 40000);
    await waitFinished(guest, '一起坚持了', 40000);
    const r = await guest.page.evaluate(() => document.querySelector('.screen.finished').innerText);
    assert(r.includes('信号失联'), '放弃结算缺称号: ' + r.slice(0, 100));
    await shot(guest.page, 'duel-giveup-after-reload');
    await leaveRoom(host);
    await host.page.waitForTimeout(1000);
    console.log('[D] next → 第 2 轮 → 刷新恢复座位 → 放弃结算 OK');
  } finally {
    await host.ctx.close(); await guest.ctx.close();
  }
}

async function scnParty(browser, sfx) {
  const host = await newClient(browser, 'E-host', VIEW);
  const g1 = await newClient(browser, 'E-guest1', VIEW);
  const g2 = await newClient(browser, 'E-guest2', VIEW);
  try {
    await boot(host);
    const code = await createRoom(host, { name: '庚' + sfx, mode: 'party' });
    await boot(g1);
    await joinRoom(g1, code, '辛' + sfx);
    await host.page.waitForTimeout(2500);
    const gate = await host.page.evaluate(() => {
      const b = document.querySelector('[data-act="start-game"]');
      return { disabled: b.disabled, footer: document.querySelector('.wait-footer').innerText };
    });
    assert(gate.disabled, '2 人营地模式不应能开局');
    assert(gate.footer.includes('还差 1 位伙伴'), '人数不足提示缺失: ' + gate.footer);
    console.log('[E] 2 人营地模式开局按钮正确禁用');

    await boot(g2);
    await joinRoom(g2, code, '壬' + sfx);
    await host.page.waitForFunction(() => !document.querySelector('[data-act="start-game"]').disabled, null, { timeout: 30000 });
    await shot(host.page, 'party-waiting-3p');
    await startGame(host);
    await g1.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    await g2.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    await submitWord(host, '苹果');
    await submitWord(g1, '香蕉');
    await submitWord(g2, '橘子');
    await waitReveal(host);
    await waitReveal(g1);
    await waitReveal(g2);
    const cards = await host.page.evaluate(() => document.querySelector('.party-cards').innerText);
    ['苹果', '香蕉', '橘子'].forEach(w => assert(cards.includes(w), '多人揭晓缺词: ' + w));
    const claimBtns = await host.page.evaluate(() => document.querySelectorAll('[data-act="claim"]').length);
    assert(claimBtns >= 2, '揭晓页认证按钮不足: ' + claimBtns);
    assert(await host.page.$('[data-act="toggle-ready"]'), '揭晓页缺少准备按钮');
    await shot(host.page, 'party-reveal');

    // 互认：g1 → 房主，房主 → g1
    await g1.page.click('[data-act="claim"][data-seat="0"]');
    await g1.page.waitForTimeout(400);
    await host.page.waitForFunction(() => {
      const btn = document.querySelector('[data-act="claim"][data-seat="1"]');
      return btn && btn.textContent.includes('TA 觉得像');
    }, null, { timeout: 25000 });
    await host.page.click('[data-act="claim"][data-seat="1"]');
    const mutual = await host.page.waitForFunction(() => {
      const btn = document.querySelector('[data-act="claim"][data-seat="1"]');
      const card = document.querySelector('[data-pword="0"]');
      return (btn && btn.textContent.includes('互选成功')) || (card && card.className.includes('is-agree'));
    }, null, { timeout: 25000 });
    assert(mutual, '互认未在房主端生效');
    await shot(host.page, 'party-mutual-claim');

    // 全员准备 → 自动下一局
    await host.page.click('[data-act="toggle-ready"]');
    await g1.page.click('[data-act="toggle-ready"]');
    await g2.page.click('[data-act="toggle-ready"]');
    await g1.page.waitForFunction(() => {
      const b = document.querySelector('.round-pill b');
      return b && b.textContent.trim() === '2';
    }, null, { timeout: 45000 });
    await host.page.waitForFunction(() => {
      const b = document.querySelector('.round-pill b');
      return b && b.textContent.trim() === '2' && document.querySelector('#wordInput');
    }, null, { timeout: 45000 });
    await shot(host.page, 'party-round2');

    // 房主提前结束 → 结算（CP 榜/个人分）
    await host.page.waitForSelector('[data-act="force-end"]', { timeout: 20000 });
    await host.page.click('[data-act="force-end"]');
    await host.page.waitForSelector('[data-act="confirm-ok"]', { timeout: 8000 });
    await host.page.click('[data-act="confirm-ok"]');
    await waitFinished(host, '个人默契分', 40000);
    const fin = await host.page.evaluate(() => document.querySelector('.screen.finished').innerText);
    assert(/最强 CP|还没撞上任何一对/.test(fin), '结算缺 CP 榜: ' + fin.slice(0, 120));
    assert(fin.includes('提前收营'), '提前结束标题异常: ' + fin.slice(0, 80));
    await shot(host.page, 'party-finished');
    await g1.page.waitForSelector('.screen.finished', { timeout: 40000 });
    await leaveRoom(host);
    await host.page.waitForTimeout(1200);
    console.log('[E] 3 人营地：互认 → 全员准备 → 第 2 局 → 提前结束结算 OK');
  } finally {
    await host.ctx.close(); await g1.ctx.close(); await g2.ctx.close();
  }
}

/* 15 秒限时：草稿自动提交 + 房主宽限收口 */
async function scnTimerAutoSubmit(browser, sfx) {
  const host = await newClient(browser, 'G-host', VIEW);
  const guest = await newClient(browser, 'G-guest', VIEW);
  try {
    await boot(host);
    const code = await createRoom(host, { name: '癸' + sfx, mode: 'duel', timeLimit: 15 });
    await boot(guest);
    await joinRoom(guest, code, '子' + sfx);
    await startGame(host);
    await guest.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    // 两边都只打字不点提交：到点应自动提交草稿
    await host.page.fill('#wordInput', '西瓜');
    await guest.page.fill('#wordInput', '西瓜');
    await host.page.waitForFunction(
      () => document.querySelector('.screen.reveal') || document.querySelector('.screen.finished'),
      null, { timeout: 40000 });
    const phase = await host.page.evaluate(() =>
      document.querySelector('.screen.finished') ? 'finished' : 'reveal');
    if (phase !== 'finished') {
      const w = await host.page.evaluate(() => document.querySelector('.word-grid').innerText);
      throw new Error('自动提交未赶上房主宽限期（出现揭晓而非撞词结算）: ' + w.replace(/\n/g, ' '));
    }
    await waitFinished(host, '同一个词', 40000);
    const trail = await host.page.evaluate(() => document.querySelector('.screen.finished').innerText);
    assert(trail.includes('西瓜'), '自动提交的词未进入轨迹: ' + trail.slice(0, 160));
    await shot(host.page, 'timer-autosubmit-match');
    await leaveRoom(host);
    await host.page.waitForTimeout(1000);
    console.log('[G] 15s 限时：草稿自动提交 → 撞词结算 OK');
  } finally {
    await host.ctx.close(); await guest.ctx.close();
  }
}

/* 离席与「幽灵座位」：
   H1 等待室成员离开 → 座位回收 → 补人后正常开局（不应把旧座位当幽灵带上）
   H2 游戏中途关页（无法优雅离席）→ 房主 markDeparted 不触发，但可用「直接揭晓」收口 */
async function scnLeaveMidGame(browser, sfx) {
  const host = await newClient(browser, 'H1-host', VIEW);
  const g1 = await newClient(browser, 'H1-guest1', VIEW);
  const g2 = await newClient(browser, 'H1-guest2', VIEW);
  const g3 = await newClient(browser, 'H1-guest3', VIEW);
  try {
    await boot(host);
    const code = await createRoom(host, { name: '丑' + sfx, mode: 'party' });
    const n1 = '寅' + sfx, n2 = '卯' + sfx, n3 = '辰' + sfx;
    await boot(g1);
    await joinRoom(g1, code, n1);
    await host.page.waitForTimeout(2800);
    assert(await host.page.evaluate(() => document.querySelector('[data-act="start-game"]').disabled),
      '2 人营地不应可开局');

    await boot(g2);
    await joinRoom(g2, code, n2);
    await host.page.waitForFunction(() => !document.querySelector('[data-act="start-game"]').disabled,
      null, { timeout: 30000 });

    // g1 从等待室离开：座位应被回收，开局按钮重新禁用
    await leaveRoom(g1);
    await g1.page.waitForSelector('.landing', { timeout: 15000 });
    await host.page.waitForFunction(name => {
      const b = document.querySelector('[data-act="start-game"]');
      const w = document.querySelector('.screen.waiting');
      return b && b.disabled && w && !w.innerText.includes(name);
    }, n1, { timeout: 30000 }).catch(() => {});
    const afterLeave = await host.page.evaluate(() => ({
      disabled: document.querySelector('[data-act="start-game"]').disabled,
      txt: document.querySelector('.screen.waiting').innerText,
    }));
    assert(afterLeave.disabled, '成员离开后开局按钮未回退禁用');
    assert(!afterLeave.txt.includes(n1), '离开的成员仍留在座位上');
    console.log('[H1] 等待室成员离开 → 座位回收、开局回退禁用');

    // 补人：新成员应复用/接管座位，3 人可开局，无幽灵空位
    await boot(g3);
    await joinRoom(g3, code, n3);
    await host.page.waitForFunction(() => !document.querySelector('[data-act="start-game"]').disabled,
      null, { timeout: 30000 });
    await startGame(host);
    await g2.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    await g3.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    await submitWord(host, '苹果');
    await submitWord(g2, '香蕉');
    await submitWord(g3, '橘子');
    await waitReveal(host);
    const cards = await host.page.evaluate(() => document.querySelector('.party-cards').innerText);
    ['苹果', '香蕉', '橘子'].forEach(w => assert(cards.includes(w), '补人后揭晓缺词: ' + w));
    await shot(host.page, 'leave-waiting-replacement');
    await host.page.waitForSelector('[data-act="force-end"]', { timeout: 20000 });
    await host.page.click('[data-act="force-end"]');
    await host.page.waitForSelector('[data-act="confirm-ok"]', { timeout: 8000 });
    await host.page.click('[data-act="confirm-ok"]');
    await waitFinished(host, '提前收营', 40000);
    await leaveRoom(host);
    await host.page.waitForTimeout(800);
    console.log('[H1] 补人开局 → 无幽灵空位 → 结算 OK');
  } finally {
    await host.ctx.close(); await g1.ctx.close(); await g2.ctx.close(); await g3.ctx.close();
  }

  // H2：关页（无优雅离席）→ 房主手动收口
  const h2host = await newClient(browser, 'H2-host', VIEW);
  const h2guest = await newClient(browser, 'H2-guest', VIEW);
  try {
    await boot(h2host);
    const code = await createRoom(h2host, { name: '巳' + sfx, mode: 'duel' });
    await boot(h2guest);
    await joinRoom(h2guest, code, '午' + sfx);
    await startGame(h2host);
    await h2guest.page.waitForSelector('.screen.playing #wordInput', { timeout: 25000 });
    await submitWord(h2host, '海边');
    await h2guest.ctx.close();          // 模拟直接关页：没有任何离开请求
    await h2host.page.waitForTimeout(3500);
    assert(await h2host.page.$('.screen.playing'), '房主不应因对方关页被卡出局');
    // 房主唯一出口：直接揭晓（未提交按超时处理）
    await h2host.page.click('[data-act="force-reveal"]');
    await h2host.page.waitForSelector('[data-act="confirm-ok"]', { timeout: 8000 });
    await h2host.page.click('[data-act="confirm-ok"]');
    await waitReveal(h2host);
    const rv = await h2host.page.evaluate(() => document.querySelector('.screen.reveal').innerText);
    assert(rv.includes('海边'), '强制揭晓未保留已提交的词: ' + rv.slice(0, 120));
    await shot(h2host.page, 'gap-force-reveal');
    await h2host.page.click('[data-act="giveup"]');
    await h2host.page.waitForSelector('[data-act="confirm-ok"]', { timeout: 8000 });
    await h2host.page.click('[data-act="confirm-ok"]');
    await waitFinished(h2host, '信号失联', 40000);
    await shot(h2host.page, 'leave-midgame-result');
    await leaveRoom(h2host);
    await h2host.page.waitForTimeout(800);
    console.log('[H2] 对方关页 → 房主「直接揭晓」→ 放弃结算 OK');
  } finally {
    await h2host.ctx.close(); await h2guest.ctx.close();
  }
}

async function scnNarrow(browser) {
  const c = await newClient(browser, 'F', { width: 320, height: 844 });
  try {
    await boot(c);
    await assertNoOverflow(c.page, '320px 首页');
    await c.page.click('[data-act="open-create"]');
    await c.page.waitForSelector('#createName');
    await c.page.waitForTimeout(800); // 等底部弹层入场动画/字体布局稳定再截图
    await assertNoOverflow(c.page, '320px 创建弹层');
    await shot(c.page, 'narrow-create');
    await c.page.click('#sheetPanel [data-act="sheet-close"]');
    await c.page.waitForTimeout(250);
    await c.page.click('[data-act="open-rules"]');
    await c.page.waitForSelector('#modalPanel .rules-body');
    const modal = await c.page.evaluate(() => {
      const m = document.querySelector('#modalPanel');
      return { sw: m.scrollWidth, cw: m.clientWidth };
    });
    assert(modal.sw <= modal.cw + 1, '320px 规则弹层内部溢出: ' + JSON.stringify(modal));
    await shot(c.page, 'narrow-rules');
    console.log('[F] 320px 无横向溢出 OK');
  } finally {
    await c.ctx.close();
  }
}

/* ---------------- 主流程 ---------------- */

(async () => {
  const only = process.argv[2];   // 可选：node test-e2e.js B
  const sfx = String(Date.now() % 900 + 100);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const results = [];
  const steps = [
    ['A', scnBootLanding, []],
    ['B', scnDuelMatch, [sfx]],
    ['C', scnDuelAgree, [sfx]],
    ['D', scnDuelNextAndRestore, [sfx]],
    ['E', scnParty, [sfx]],
    ['F', scnNarrow, []],
    ['G', scnTimerAutoSubmit, [sfx]],
    ['H', scnLeaveMidGame, [sfx]],
  ];
  for (const [id, fn, args] of steps) {
    if (only && only.toUpperCase() !== id) continue;
    const t0 = Date.now();
    try {
      await fn(browser, ...args);
      results.push({ id, ok: true, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ id, ok: false, ms: Date.now() - t0, err: e.message });
      console.error('[' + id + '] FAILED:', e.message);
      console.log('页面报错记录:', JSON.stringify(problems.slice(-6), null, 1));
      console.log('应用日志(末 40):\n' + appLog.slice(-40).join('\n'));
    }
  }
  await browser.close();

  const fatal = problems.filter(p => p.kind === 'pageerror');
  const conErrs = problems.filter(p => p.kind === 'console');
  const httpErrs = problems.filter(p => p.kind === 'http');
  console.log('\n===== 结果 =====');
  results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id + '  ' + r.ms + 'ms' + (r.err ? '  ' + r.err : '')));
  console.log('pageerror 数:', fatal.length, fatal.slice(0, 5).map(f => f.tag + ': ' + f.text).join(' | '));
  console.log('console.error 数:', conErrs.length, conErrs.slice(0, 5).map(f => f.tag + ': ' + f.text).join(' | '));
  console.log('HTTP>=400 数:', httpErrs.length, httpErrs.slice(0, 8).map(f => f.tag + ': ' + f.text).join(' | '));
  const failed = results.filter(r => !r.ok);
  if (failed.length || fatal.length) process.exitCode = 1;
})().catch(e => { console.error('FATAL', e); process.exit(1); });