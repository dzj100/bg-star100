/* 血条动画时序验证：node test-hp-anim.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await new Promise(r => server.listen(8214, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  try {
    await page.goto('http://localhost:8214/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.evaluate(() => { window._menuSelection = ['warder']; render(); });
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await page.evaluate(() => {
      state.map.nodes.forEach(n => { n.state = 'cleared'; });
      startCombat(['deep_one']);
      render();
    });
    await sleep(2500);

    // 注入一次大伤害（80/80 → 20/80），同步渲染，然后采样血条宽度时序
    const res = await page.evaluate(async () => {
      const p = state.party[0];
      const w0 = p.hp;
      p.hp = 20;
      render();
      const bar = document.querySelector('.party-card .hp-bar.anim .hp-fill');
      if (!bar) return { err: 'no .anim bar after damage' };
      const box = bar.getBoundingClientRect();
      const full = document.querySelector('.party-card .hp-bar').getBoundingClientRect().width;
      const arr = [];
      for (const t of [0, 60, 130, 250, 400, 700, 1000]) {
        arr.push({ t, w: +bar.getBoundingClientRect().width.toFixed(1) });
        await new Promise(r => setTimeout(r, t - (arr.length > 1 ? arr[arr.length - 2].t : 0)));
      }
      return { w0, full, samples: arr };
    });
    if (res.err) throw new Error(res.err);

    const { w0, full, samples } = res;
    console.log('伤害前 hp:', w0, ' 满血宽度:', full.toFixed(1));
    console.log('采样:', samples.map(s => `t=${s.t}ms w=${s.w}`).join('  '));

    const pct = v => (v / full * 100).toFixed(0) + '%';
    const s0 = samples[0].w, s1 = samples[1].w;
    const early = samples.find(s => s.t >= 0 && s.t <= 60).w;
    const mid = samples.find(s => s.t >= 200 && s.t <= 350).w;
    const end = samples[samples.length - 1].w;
    const expectEnd = full * (20 / w0);
    const ok = early > mid && mid >= end && Math.abs(end - expectEnd) < 2
      && s0 >= s1 - 1; // 无"先变短"：t=0 时宽度应接近满血
    console.log(`early(${pct(early)}) > mid(${pct(mid)}) ≥ end(${pct(end)})? 最终=${pct(end)} 期望=${pct(expectEnd)}`);
    console.log(ok ? 'HP ANIM OK' : 'HP ANIM FAIL');

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else if (!ok) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
