'use strict';
/* 牛头王 render.js 自测：临时静态服务器 + Playwright
   运行：node six-nimmt/test-e2e.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const SN = require('./game.js');

const ROOT = __dirname;
const SHOTS = path.join(os.tmpdir(), 'six-nimmt-shots');
const SAVE_KEY = 'six-nimmt-save-v1';
const STATS_KEY = 'six-nimmt-stats-v1';

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { failures += 1; console.log('  FAIL  ' + label); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      if (urlPath === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
      const file = path.join(ROOT, urlPath);
      if (!file.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function makePage(context, errors) {
  return context.newPage().then(async (page) => {
    page.setDefaultTimeout(9000);
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push('console: ' + msg.text());
    });
    page.on('pageerror', (err) => errors.push('pageerror: ' + (err && err.message)));
    page.on('requestfailed', (req) => {
      if (req.url().indexOf('favicon') >= 0) return;
      errors.push('requestfailed: ' + req.url() + ' ' + (req.failure() && req.failure().errorText));
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().indexOf('favicon') < 0) {
        errors.push('http ' + res.status() + ': ' + res.url());
      }
    });
    return page;
  });
}

async function state(page) {
  return page.evaluate(() => {
    const d = window.__SN_DEBUG__;
    return d && d.getState ? d.getState() : null;
  });
}

async function waitForState(page, fn, timeout) {
  const started = Date.now();
  const ms = timeout || 12000;
  while (Date.now() - started < ms) {
    const st = await state(page);
    if (st && fn(st)) return st;
    await page.waitForTimeout(60);
  }
  return null;
}

async function startFromMenu(page, aiCount, base) {
  await page.goto(base + '/index.html?fast=1');
  await page.waitForSelector('#screen-menu.active');
  await page.click('#btnStart');
  await page.waitForSelector('#screen-setup.active');
  await page.click('#aiCountSeg button[data-ai="' + aiCount + '"]');
  await page.fill('#inpName', '测试牧场');
  await page.click('#btnBegin');
  await page.waitForSelector('#screen-game.active');
  await waitForState(page, (s) => s.phase === 'selecting' && s.players[0].hand.length === 10);
}

async function waitForTrick(page, trick, timeout) {
  const started = Date.now();
  const ms = timeout || 20000;
  while (Date.now() - started < ms) {
    if (await page.locator('#modal-choice.open').count()) {
      await page.locator('#choiceRows .choice-row').first().click().catch(() => {});
      await page.waitForTimeout(90);
      continue;
    }
    const st = await state(page);
    if (st && st.trick >= trick && (st.phase === 'selecting' || st.phase === 'gameEnd')) return st;
    await page.waitForTimeout(80);
  }
  return null;
}

async function finishGame(page, label) {
  let handledChoice = 0;
  let swaps = 0;
  for (let i = 0; i < 500; i++) {
    const over = await page.locator('#screen-over.active').count();
    if (over) break;
    const modal = await page.locator('#modal-choice.open').count();
    if (modal) {
      handledChoice += 1;
      if (handledChoice <= 3) {
        await page.waitForTimeout(420);
        await page.screenshot({ path: path.join(SHOTS, label + '-choice.png') });
      }
      await page.locator('#choiceRows .choice-row').first().click().catch(() => {});
      await page.waitForTimeout(90);
      continue;
    }
    const st = await state(page);
    if (!st) { await page.waitForTimeout(100); continue; }
    if (st.phase === 'selecting' && st.players[0].selected === null && st.players[0].hand.length) {
      const hand = page.locator('#hand .card:not([disabled])');
      const count = await hand.count();
      if (count) {
        swaps += 1;
        const pick = swaps % 3 === 0 ? hand.last() : hand.first();
        await pick.click({ timeout: 2500 }).catch(() => {});
        const lock = page.locator('#btnLock');
        if (!(await lock.isDisabled().catch(() => true))) {
          await lock.click({ timeout: 2500 }).catch(() => {});
        }
      }
      await page.waitForTimeout(90);
    } else {
      await page.waitForTimeout(100);
    }
  }
  return { handledChoice };
}

async function injectSave(page, stateObj, base) {
  await page.goto(base + '/index.html?fast=1');
  await page.waitForSelector('#screen-menu.active');
  await page.evaluate(([key, value]) => {
    localStorage.setItem(key, value);
  }, [SAVE_KEY, JSON.stringify({ v: 1, ts: Date.now(), S: stateObj })]);
  await page.reload();
  await page.waitForSelector('#screen-menu.active');
  await page.waitForSelector('#btnContinue:not([hidden])');
  await page.click('#btnContinue');
  await page.waitForSelector('#screen-game.active');
}

/* 构造“人类被迫选行”的确定性局面 */
function buildHumanChoiceState() {
  for (let seed = 1; seed < 4000; seed++) {
    const s = SN.newGame({ aiCount: 5, humanName: '测试牧场', difficulty: 'normal', seed: seed });
    const minEnd = Math.min.apply(null, s.rows.map((r) => r.cards[0]));
    const low = s.players[0].hand.filter((c) => c < minEnd).sort((a, b) => a - b)[0];
    if (!low) continue;
    SN.selectCard(s, 0, low);
    let good = true;
    for (let seat = 1; seat < s.players.length; seat++) {
      const pick = s.players[seat].hand.slice().sort((a, b) => b - a)[0];
      if (pick <= low) { good = false; break; }
      SN.selectCard(s, seat, pick);
    }
    if (!good) continue;
    SN.beginReveal(s);
    if (s.revealQueue[0].seat !== 0 || s.revealQueue[0].card !== low) continue;
    if (!SN.validate(s).ok) continue;
    return s;
  }
  throw new Error('未找到人类选行局面');
}

/* 构造“AI 被迫选行”的确定性局面 */
function buildAiChoiceState() {
  for (let seed = 1; seed < 4000; seed++) {
    const s = SN.newGame({ aiCount: 5, humanName: '测试牧场', difficulty: 'normal', seed: seed });
    const minEnd = Math.min.apply(null, s.rows.map((r) => r.cards[0]));
    const aiLow = s.players[1].hand.slice().sort((a, b) => a - b)[0];
    if (!(aiLow < minEnd)) continue;
    const humanHigh = s.players[0].hand.slice().sort((a, b) => b - a)[0];
    if (humanHigh <= aiLow) continue;
    SN.selectCard(s, 0, humanHigh);
    let good = true;
    for (let seat = 1; seat < s.players.length; seat++) {
      const pick = seat === 1 ? aiLow : s.players[seat].hand.slice().sort((a, b) => b - a)[0];
      if (seat !== 1 && pick <= aiLow) { good = false; break; }
      SN.selectCard(s, seat, pick);
    }
    if (!good) continue;
    SN.beginReveal(s);
    if (s.revealQueue[0].seat !== 1 || s.revealQueue[0].card !== aiLow) continue;
    if (!SN.validate(s).ok) continue;
    return s;
  }
  throw new Error('未找到 AI 选行局面');
}

/* 构造“亮牌结算中”的续局状态 */
function buildRevealState() {
  for (let seed = 1; seed < 4000; seed++) {
    const s = SN.newGame({ aiCount: 5, humanName: '测试牧场', difficulty: 'normal', seed: seed });
    for (const p of s.players) SN.selectCard(s, p.seat, p.hand[0]);
    SN.beginReveal(s);
    let guard = 0;
    while ((s.phase === 'revealing' || s.phase === 'chooseRow') && s.revealIndex < 2 && guard++ < 40) {
      if (s.phase === 'chooseRow') SN.chooseRow(s, s.pendingChoice.seat, 0);
      else SN.resolveNext(s);
    }
    if (s.phase === 'revealing' && s.revealIndex >= 2 && SN.validate(s).ok) return s;
  }
  throw new Error('未找到亮牌中局面');
}

/* 构造“本墩结算完毕”的续局状态 */
function buildTrickEndState() {
  for (let seed = 1; seed < 4000; seed++) {
    const s = SN.newGame({ aiCount: 5, humanName: '测试牧场', difficulty: 'normal', seed: seed });
    for (const p of s.players) SN.selectCard(s, p.seat, p.hand[0]);
    SN.beginReveal(s);
    let guard = 0;
    while ((s.phase === 'revealing' || s.phase === 'chooseRow') && guard++ < 100) {
      if (s.phase === 'chooseRow') SN.chooseRow(s, s.pendingChoice.seat, 0);
      else SN.resolveNext(s);
    }
    if (s.phase === 'trickEnd' && SN.validate(s).ok) return s;
  }
  throw new Error('未找到墩末局面');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const allErrors = [];

  try {
    /* ---------------- 桌面：完整一局 ---------------- */
    section('桌面 1280×900：菜单 → 设置 → 对局 → 结算');
    const deskContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const desktop = await makePage(deskContext, allErrors);
    await startFromMenu(desktop, 5, base);

    let st = await state(desktop);
    ok(st && st.players.length === 6, '5 个 AI → 共 6 名玩家');
    ok((await desktop.locator('#hand .card').count()) === 10, '手牌 10 张');
    ok((await desktop.locator('#table .row').count()) === 4, '桌面 4 行');
    ok((await desktop.locator('#revealTray .reveal-slot').count()) === 6, '亮牌托盘 6 个槽位');

    /* 等 AI 锁定，拍桌面对局中 */
    const aiLocked = await waitForState(desktop, (s) => s.players.slice(1).every((p) => p.selected !== null), 8000);
    ok(!!aiLocked, 'AI 全部自行锁定');
    ok((await desktop.locator('#revealTray .card-back').count()) >= 5, 'AI 托盘显示牌背');
    await desktop.screenshot({ path: path.join(SHOTS, 'desktop-game.png') });

    /* 弹窗：计分 / 日志 / 规则 */
    await desktop.click('#btnScores');
    await desktop.waitForSelector('#modal-scores.open');
    ok((await desktop.locator('#scoreModalBody tbody tr').count()) === 6, '计分弹窗 6 行');
    await desktop.click('#modal-scores [data-close="modal-scores"]');
    await desktop.click('#btnScores');
    await desktop.waitForSelector('#modal-scores.open');
    await desktop.mouse.click(4, 4);
    await desktop.waitForSelector('#modal-scores:not(.open)', { state: 'hidden' });
    ok(true, '点击遮罩关闭计分弹窗');
    await desktop.click('#btnLog');
    await desktop.waitForSelector('#modal-log.open');
    ok((await desktop.locator('#logModalBody').textContent()).length > 0, '日志弹窗有内容');
    await desktop.click('#logClose');
    await desktop.click('#btnHelp');
    await desktop.waitForSelector('#modal-rules.open');
    await desktop.keyboard.press('Escape');
    await desktop.waitForSelector('#modal-rules:not(.open)', { state: 'hidden' });
    ok(true, '规则弹窗可打开 / Esc 关闭');

    /* 人类锁定第一张 */
    await desktop.locator('#hand .card:not([disabled])').first().click();
    ok((await desktop.locator('#hand .card.is-selected').count()) === 1, '手牌可点选');
    ok(!(await desktop.locator('#btnLock').isDisabled()), '选中后锁定按钮可用');
    await desktop.click('#btnLock');
    ok((await desktop.locator('#hand .card').count()) === 9, '锁定后手牌少一张');
    ok((await desktop.locator('#revealTray .reveal-slot.is-human .card').count()) === 1, '人类托盘亮出自己的牌');

    /* 完成第 1 墩 */
    st = await waitForTrick(desktop, 2, 20000);
    ok(!!st, '第 1 墩结算完成并进入第 2 墩');
    ok(st && st.players[0].hand.length === 9, '第 2 墩手牌 9 张');
    ok(st && st.log.some((e) => e.type === 'place' || e.type === 'take'), '已有落牌/收牌日志');
    const tookSomething = st && st.log.some((e) => e.type === 'take');
    console.log('  INFO  首墩是否出现收行：' + (tookSomething ? '是' : '否（后续会补验）'));

    /* 存档 / 刷新 / 继续 */
    await desktop.reload();
    await desktop.waitForSelector('#screen-menu.active');
    await desktop.waitForSelector('#btnContinue:not([hidden])');
    ok(true, '刷新后首页显示「继续上局」');
    await desktop.click('#btnContinue');
    await desktop.waitForSelector('#screen-game.active');
    st = await waitForTrick(desktop, 2, 12000);
    ok(!!st, '刷新后可继续回到第 2 墩选牌');
    ok((await desktop.locator('#hand .card').count()) === 9, '继续后手牌仍是 9 张');

    /* 退出确认：取消 → 确认 → 继续 */
    await desktop.click('#btnExit');
    await desktop.waitForSelector('#modal-confirm.open');
    await desktop.click('#confirmCancel');
    await desktop.waitForSelector('#modal-confirm:not(.open)', { state: 'hidden' });
    ok(true, '退出确认可取消');
    await desktop.click('#btnExit');
    await desktop.waitForSelector('#modal-confirm.open');
    await desktop.click('#confirmOk');
    await desktop.waitForSelector('#screen-menu.active');
    await desktop.waitForSelector('#btnContinue:not([hidden])');
    await desktop.click('#btnContinue');
    await desktop.waitForSelector('#screen-game.active');
    ok(true, '退出时保存，可从首页继续');

    /* 打完 10 墩 */
    const res = await finishGame(desktop, 'desktop');
    await desktop.waitForSelector('#screen-over.active', { timeout: 90000 });
    st = await state(desktop);
    ok(st && st.phase === 'gameEnd', '第 10 墩后进入 gameEnd');
    ok((await desktop.locator('#rankList .rank-row').count()) === 6, '结算页 6 条排名');
    ok((await desktop.locator('#overStats .os-chip').count()) >= 4, '结算页统计 chip 完整');
    ok(!!(await desktop.locator('#rankList .rank-row.is-winner').count()), '结算页标记冠军');
    const statsRaw = await desktop.evaluate((key) => localStorage.getItem(key), STATS_KEY);
    ok(!!statsRaw && JSON.parse(statsRaw).games >= 1, '战绩写入 localStorage');
    const saveAfter = await desktop.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
    ok(!saveAfter, '终局后清除存档');
    await desktop.screenshot({ path: path.join(SHOTS, 'desktop-over.png') });
    console.log('  INFO  自然对局中人类选行弹窗次数：' + res.handledChoice);

    /* 再来一局 */
    await desktop.click('#btnAgain');
    await desktop.waitForSelector('#screen-game.active');
    st = await waitForState(desktop, (s) => s.phase === 'selecting' && s.trick === 1);
    ok(!!st && st.players.length === 6, '「再来一局」按原设置开局');

    /* 布局溢出检查 */
    const layout = await desktop.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      rows: document.querySelectorAll('#table .row').length
    }));
    ok(layout.sw <= layout.iw + 1, '桌面无页面级横向溢出');
    await deskContext.close();

    /* ---------------- 注入：人类选行 ---------------- */
    section('人类被迫选行（注入存档）');
    const choiceState = buildHumanChoiceState();
    const choiceContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const choicePage = await makePage(choiceContext, allErrors);
    await injectSave(choicePage, choiceState, base);
    await choicePage.waitForSelector('#modal-choice.open', { timeout: 12000 });
    await choicePage.waitForTimeout(420);
    ok(true, '人类选行弹窗自动弹出');
    ok((await choicePage.locator('#choiceRows .choice-row').count()) === 4, '选行弹窗列出 4 行');
    const fit = await choicePage.evaluate(() => {
      const card = document.querySelector('#modal-choice .modal-card').getBoundingClientRect();
      return { top: card.top, bottom: card.bottom, left: card.left, right: card.right, iw: innerWidth, ih: innerHeight };
    });
    ok(fit.top >= -1 && fit.bottom <= fit.ih + 1 && fit.left >= -1 && fit.right <= fit.iw + 1, '选行弹窗完整落在视口内');
    await choicePage.screenshot({ path: path.join(SHOTS, 'desktop-choice.png') });
    await choicePage.evaluate(() => {
      window.__eatBanner = '';
      new MutationObserver(() => {
        const n = document.querySelector('#table .row-eat');
        if (n) window.__eatBanner = n.textContent.trim();
      }).observe(document.getElementById('table'), { childList: true, subtree: true });
    });
    await choicePage.keyboard.press('2');
    await choicePage.waitForSelector('#modal-choice:not(.open)', { state: 'hidden' });
    const choiceResolved = await waitForState(choicePage, (s) => s.log.some((e) => e.type === 'take' && e.viaChoice && e.seat === 0), 8000);
    ok(!!choiceResolved, '数字键 2 选行后产生人类 viaChoice 收牌');
    const eatBanner = await choicePage.evaluate(() => window.__eatBanner);
    ok(eatBanner.indexOf('测试牧场') >= 0, '收行时在对应行显示收牌玩家昵称');
    await choiceContext.close();

    /* ---------------- 注入：AI 选行 ---------------- */
    section('AI 被迫选行（注入存档）');
    const aiChoice = buildAiChoiceState();
    const aiContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const aiPage = await makePage(aiContext, allErrors);
    await injectSave(aiPage, aiChoice, base);
    const aiResolved = await waitForState(aiPage, (s) => s.log.some((e) => e.type === 'take' && e.viaChoice && e.seat === 1), 12000);
    ok(!!aiResolved, 'AI 自动选行并收牌');
    ok((await aiPage.locator('#modal-choice.open').count()) === 0, 'AI 选行不弹人类弹窗');
    await aiContext.close();

    /* ---------------- 注入：亮牌中 / 墩末 续局 ---------------- */
    section('刷新续局：亮牌中 / 墩末');
    const revealState = buildRevealState();
    const revealContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const revealPage = await makePage(revealContext, allErrors);
    await injectSave(revealPage, revealState, base);
    st = await waitForState(revealPage, (s) => s.trick >= 2 && s.phase === 'selecting', 20000);
    ok(!!st, '亮牌中刷新后续局并完成本墩');
    ok(!!st && st.players[0].hand.length === 9, '亮牌续局后手牌 9 张');
    await revealContext.close();

    const trickEndState = buildTrickEndState();
    const trickContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const trickPage = await makePage(trickContext, allErrors);
    await injectSave(trickPage, trickEndState, base);
    st = await waitForState(trickPage, (s) => s.trick === 2 && s.phase === 'selecting', 12000);
    ok(!!st, '墩末刷新后自动进入下一墩');
    ok(!!st && st.players[0].selected === null && st.players[0].hand.length === 9, '墩末续局人类选牌已清空、手牌 9 张');
    await trickContext.close();

    /* ---------------- 移动端 390×844 ---------------- */
    section('移动端 390×844');
    const mobContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobile = await makePage(mobContext, allErrors);
    await mobile.goto(base + '/index.html?autostart=1&ai=5&level=normal&seed=42&fast=1');
    await mobile.waitForSelector('#screen-game.active');
    st = await waitForState(mobile, (s) => s.phase === 'selecting' && s.players.slice(1).every((p) => p.selected !== null), 8000);
    ok(!!st, '移动端自动开局且 AI 锁定');
    ok((await mobile.locator('#hand .card').count()) === 10, '移动端手牌 10 张');
    const mobileOverflow = await mobile.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      hb: document.getElementById('hand').scrollHeight,
      hh: document.getElementById('hand').clientHeight
    }));
    ok(mobileOverflow.sw <= mobileOverflow.iw + 1, '移动端无页面级横向溢出');
    await mobile.screenshot({ path: path.join(SHOTS, 'mobile-game.png') });

    /* 移动端打一墩 */
    await mobile.locator('#hand .card:not([disabled])').first().click();
    await mobile.click('#btnLock');
    st = await waitForTrick(mobile, 2, 25000);
    ok(!!st, '移动端完成一墩并进入下一墩');

    /* 移动端选行弹窗适配 */
    const mobileChoice = buildHumanChoiceState();
    await injectSave(mobile, mobileChoice, base);
    await mobile.waitForSelector('#modal-choice.open', { timeout: 12000 });
    await mobile.waitForTimeout(420);
    const mfit = await mobile.evaluate(() => {
      const card = document.querySelector('#modal-choice .modal-card').getBoundingClientRect();
      return { top: card.top, bottom: card.bottom, left: card.left, right: card.right, iw: innerWidth, ih: innerHeight };
    });
    ok(mfit.top >= -1 && mfit.bottom <= mfit.ih + 1 && mfit.left >= -1 && mfit.right <= mfit.iw + 1, '移动端选行弹窗不超视口');
    await mobile.screenshot({ path: path.join(SHOTS, 'mobile-choice.png') });
    await mobile.click('#choiceRows .choice-row');
    await mobile.waitForSelector('#modal-choice:not(.open)', { state: 'hidden' });
    await mobContext.close();

    /* ---------------- 汇总 ---------------- */
    section('控制台 / 资源');
    const uniq = Array.from(new Set(allErrors));
    ok(uniq.length === 0, '无 console error / pageerror / 非 favicon 资源错误' + (uniq.length ? '：\n    ' + uniq.join('\n    ') : ''));
    console.log('\n截图目录：' + SHOTS);
    console.log(failures ? '结果：FAILED (' + failures + ')' : '结果：ALL PASS');
  } catch (err) {
    failures += 1;
    console.error('\n测试异常：', err);
    console.log('截图目录：' + SHOTS);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  process.exit(failures ? 1 : 0);
})();