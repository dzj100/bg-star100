'use strict';
const { chromium } = require('playwright');
const path = require('path');
const G = require('./game.js');
const URL = 'file://' + path.join(__dirname, 'index.html').replace(/\\/g, '/');
const seeded = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

function scene(patch) {
  const S = G.newGame({ colors: 4, one: false, traitors: 7, extra: 3 }, seeded(11));
  S.turn = 0; S.turnNo = 3; S.round = 2;
  S.pending = null; S.over = null; S.openEvs = [];
  S.log.length = 0;
  S.aiWatch = G.mk(0, 3);
  S.traitorPile = [G.mk(1, 5), G.mk(2, 8), G.mk(3, 11), G.mk(0, 14), G.mk(1, 2), G.mk(2, 6)];
  S.hand = [G.mk(0, 9), G.mk(1, 4), G.mk(2, 12), G.mk(3, 7), G.mk(1, 10)];
  S.aiHand = [G.mk(0, 15), G.mk(2, 3), G.mk(3, 5)];
  S.intel = { rel: [G.mk(0, 9)], unrel: [G.mk(1, 4)] };
  S.discardUp = [G.mk(2, 2), G.mk(3, 6)];
  S.discardDown = [G.mk(1, 7)];
  S.bullets = 10; S.bulletsMax = 10; S.caught = 0;
  const used = new Set([...S.hand, ...S.aiHand, ...S.intel.rel, ...S.intel.unrel,
    ...S.traitorPile, S.aiWatch, ...S.discardUp, ...S.discardDown]);
  S.deck = G.combos(S.cfg).filter(id => !used.has(id));
  S.stat = { shots: 1, hits: 0, misses: 1, probes: 2, hints: 2, lurks: 1 };
  G.logPush(S, 'you', '你通讯【红9】：有关');
  G.logPush(S, 'ai', '夜枭情报【黄4】：无关');
  Object.assign(S, patch);
  return JSON.parse(JSON.stringify(S));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(URL);
  await page.waitForTimeout(420);
  await page.click('#btnStart');
  await page.waitForTimeout(200);
  await page.click('#btnCfgGo');
  await page.waitForFunction(() => !window.INFIL_UI.busy(), null, { timeout: 9000 });

  /* 情报区有关行塞满：新打出的牌落到屏幕最右缘 */
  const S = scene();
  const used2 = new Set([...S.hand, ...S.aiHand, ...S.intel.rel, ...S.intel.unrel,
    ...S.traitorPile, S.aiWatch, ...S.discardUp, ...S.discardDown]);
  const extra = G.combos(S.cfg).filter(id => !used2.has(id)).slice(0, 5);
  S.intel.rel = [...S.intel.rel, ...extra];
  S.deck = S.deck.filter(id => !extra.includes(id));
  await page.evaluate(s => window.INFIL_UI.setState(s, null), S);
  await page.waitForTimeout(160);

  const where = await page.evaluate(() => {
    const row = document.querySelector('#relCards');
    const r = row.getBoundingClientRect();
    return { rowRight: Math.round(r.right), vw: innerWidth, n: row.children.length };
  });
  console.log('rel 行:', JSON.stringify(where));

  await page.click('#hand .card:first-child');
  await page.click('#btnProbe');
  await page.waitForSelector('#fx .stampFx', { timeout: 4000 });
  await page.waitForTimeout(320);
  const m = await page.evaluate(() => {
    const el = document.querySelector('#fx .stampFx');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(el);
    const lines = [...range.getClientRects()].length;
    const cs = getComputedStyle(el);
    return {
      text: el.textContent, lines,
      w: Math.round(r.width), h: Math.round(r.height),
      cx: Math.round(r.left + r.width / 2), right: Math.round(r.right), vw: innerWidth,
      ws: cs.whiteSpace, fs: cs.fontSize,
    };
  });
  console.log('stamp:', JSON.stringify(m));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'tmp-stamp-wrap.png') });
  await browser.close();
})();
