const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
function assert(c, m){ if(!c) throw new Error('ASSERT FAIL: ' + m); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = 'file:///' + path.resolve(__dirname, '').replace(/\\/g, '/') + '/';

(async () => {
  const browser = await chromium.launch();

  // A) 单机：短文本胶囊不被截断、单行
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(ROOT + 'index.html');
    await page.click('.role-btn:has-text("警探")');
    await page.waitForSelector('.role-tag', { timeout: 8000 });
    const tags = await page.$$eval('.role-tag', els => els.map(e => {
      const cs = getComputedStyle(e);
      return { txt: e.textContent.trim(), ws: cs.whiteSpace, h: e.clientHeight, sw: e.scrollWidth, cw: e.clientWidth, te: cs.textOverflow };
    }));
    for (const t of tags) {
      console.log('  A[' + vp.width + '] ' + JSON.stringify(t));
      assert(t.ws === 'nowrap', 'white-space 应为 nowrap');
      assert(t.h <= 36, '单行高度');
      assert(t.sw <= t.cw + 1, '短文本不应出现省略号（' + t.txt + '）');
    }
    await page.close();
  }

  // B) 联机：房主超长昵称 → 对方/自己胶囊单行 + 省略号 + 不与中间牌堆重叠
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await ctxA.newPage(), guest = await ctxB.newPage();
  host.on('dialog', d => d.dismiss().catch(()=>{}));
  guest.on('dialog', d => d.dismiss().catch(()=>{}));
  const LONG = '房主超级无敌长昵称测试一二三四五六七八九十';
  try {
    await host.goto(ROOT + 'index_ol.html', { waitUntil: 'domcontentloaded' });
    await host.click('#ol-enter-online');
    await host.waitForSelector('#ol-create', { timeout: 15000 });
    await host.click('#ol-create');
    const nickShown = await host.waitForSelector('#ol-modal-nick.show', { timeout: 4000 }).then(() => true).catch(() => false);
    if (nickShown) { await host.fill('#ol-nick-input', LONG); await host.click('#ol-nick-ok'); }
    await host.waitForSelector('.ol-code', { timeout: 15000 });
    const code = (await host.textContent('.ol-code')).trim();
    await host.click('.ol-assign >> nth=0'); // 房主=警探
    await sleep(700);
    await guest.goto(ROOT + 'index_ol.html', { waitUntil: 'domcontentloaded' });
    await guest.click('#ol-enter-online');
    await guest.waitForSelector('#ol-name', { timeout: 15000 });
    await guest.fill('#ol-name', '成员');
    await guest.fill('#ol-code', code);
    await guest.click('#ol-join');
    await guest.waitForSelector('.ol-code', { timeout: 20000 });
    await host.waitForSelector('#ol-start:not([disabled])', { timeout: 30000 });
    await sleep(400);
    await host.click('#ol-start');
    await host.waitForSelector('#app[style*="block"]', { timeout: 15000 });
    await guest.waitForSelector('#app[style*="block"]', { timeout: 15000 });
    await sleep(1800);

    for (const [tag, p] of [['host', host], ['guest', guest]]) {
      const r = await p.evaluate(() => {
        const tags = Array.from(document.querySelectorAll('.role-tag')).map(e => {
          const cs = getComputedStyle(e);
          const b = e.getBoundingClientRect();
          return { txt: e.textContent.trim(), ws: cs.whiteSpace, te: cs.textOverflow, h: b.height, sw: e.scrollWidth, cw: e.clientWidth, left: b.left, right: b.right };
        });
        const c = document.querySelector('.tb-center').getBoundingClientRect();
        const overlap = tags.filter(t => !(t.right <= c.left + 1 || c.right <= t.left + 1)).map(t => t.txt);
        return { tags, center: { left: c.left, right: c.right }, overlap };
      });
      console.log('B.' + tag + ': tags=' + JSON.stringify(r.tags));
      console.log('   center=[' + r.center.left.toFixed(0) + ',' + r.center.right.toFixed(0) + '] overlap=' + JSON.stringify(r.overlap));
      assert(r.overlap.length === 0, tag + ' 胶囊与中间牌堆重叠');
      for (const t of r.tags) {
        assert(t.ws === 'nowrap' && t.h <= 36, tag + ' 胶囊应单行');
        assert(t.te === 'ellipsis', tag + ' 应为 ellipsis');
      }
      const longTag = r.tags.find(t => t.txt.indexOf('房主超级') >= 0);
      if (tag === 'guest') assert(longTag && longTag.sw > longTag.cw, tag + ' 长昵称胶囊应触发省略号');
      else assert(!longTag || longTag.sw <= longTag.cw + 1, tag + ' 自身昵称显示为(你)不应截断');
    }
    await host.screenshot({ path: __dirname + '/__tag-long.png' });
    await guest.screenshot({ path: __dirname + '/__tag-guest.png' });
    console.log('B 双端 ✅（长昵称省略号生效，截图 __tag-long.png / __tag-guest.png）');
  } finally {
    await ctxA.close().catch(()=>{}); await ctxB.close().catch(()=>{});
    await browser.close();
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
