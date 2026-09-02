/* 摸牌弹出贴紧度检查：卡片顶边与按钮底边距离 + 特写截图 */
const { chromium } = require('playwright');
const path = require('path');

const URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  try {
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await page.evaluate(() => newGame('marshal'));
    await page.evaluate(() => {
      state.fug.route = [];
      state.fug.hand = [];
      state.firstTurn = false;
      state.needDraw = true;
      state.turn = 'marshal';
      save(); render();
    });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.pile-pick .btn')].find(b => !b.disabled);
      btn.click();
    });
    for(let i = 0; i < 50; i++){
      const on = await page.evaluate(() => {
        const el = document.getElementById('draw-pop');
        return !!el && el.classList.contains('on');
      });
      if(on) break;
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(240); // 回弹完成
    const m = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.pile-pick .btn')].find(b => !b.disabled);
      const r = btn.getBoundingClientRect();
      const card = document.querySelector('#draw-pop .dp-card').getBoundingClientRect();
      const tag = document.querySelector('#draw-pop .dp-tag').getBoundingClientRect();
      return {
        btnBottom: r.bottom,
        cardTop: card.top,
        cardGap: card.top - r.bottom,
        tagH: tag.height,
        popBottom: document.querySelector('#draw-pop .dp-inner').getBoundingClientRect().bottom,
      };
    });
    console.log('btnBottom =', m.btnBottom, 'cardTop =', m.cardTop,
      '| 卡片顶-按钮底 =', m.cardGap.toFixed(1), 'px | tagH =', m.tagH,
      '| 弹出整体底 =', m.popBottom);
    await page.screenshot({
      path: path.join(__dirname, 'd7d-draw-pop-tight.png'),
      clip: { x: 40, y: Math.max(0, m.btnBottom - 30), width: 310, height: 165 },
    });
  } finally {
    await browser.close();
  }
})();
