const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://localhost:8123/take-time/index.html');
  await page.evaluate(() => {
    window._olIsHost = () => true;
    window._olIsActor = () => true;
    window._olSeatIndex = () => 0;
    window.dealGame(['A', 'B'], { chapter: 3, test: 1, id: 9 });
    window.render();
  });
  await page.waitForSelector('text=选择 1 号位条件', { timeout: 5000 });
  await page.click('text=选择 1 号位条件');
  await page.waitForSelector('#wheelView');
  const dbg = () => page.evaluate(() => {
    const view = document.getElementById('wheelView');
    const vr = view.getBoundingClientRect();
    const list = document.getElementById('wheelList');
    const it = [...list.children];
    const rows = it.map((el, i) => {
      const r = el.getBoundingClientRect();
      return `${i}:${el.textContent.trim().slice(0, 6)}@${Math.round(r.top - vr.top)}${el.classList.contains('active') ? '*' : ''}`;
    });
    return {
      offset: _wheel.offset, topItem: _wheel.topItem, index: _wheel.index,
      transform: list.style.transform, rows: rows.join(' | '),
    };
  });
  console.log('初始:', JSON.stringify(await dbg()));
  await page.evaluate(() => { snapWheel(10); updateWheelRender(); });
  console.log('snap10:', JSON.stringify(await dbg()));
  await browser.close();
})();
