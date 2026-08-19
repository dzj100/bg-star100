/* 圣汐洗涤渲染验证：node test-wash-shot.js */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 选圣汐医者进入游戏
  await page.click('text=圣汐医者');
  await page.click('text=开始远征');
  await page.evaluate(() => act('dismiss-intro'));
  await page.waitForSelector('.map-screen', { timeout: 8000 });
  await page.click('.node.available');

  // 把圣汐洗涤塞进当前英雄手牌并重渲染
  await page.evaluate(() => {
    const p = state.party[0];
    p.hand.push({ uid: 998, id: 'healer_wash' });
    render();
  });
  await page.waitForSelector('.card', { timeout: 5000 });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'wash-card.png'), fullPage: false });
  console.log('WASH SHOT OK, errors:', errors.length ? errors : 'none');
  await browser.close();
})();
