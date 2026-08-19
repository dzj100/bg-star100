/* 商店详情+确认弹窗验证：node test-shop-shot.js */
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
  await page.click('text=守望者');
  await page.click('text=开始远征');
  await page.evaluate(() => act('dismiss-intro'));
  await page.waitForSelector('.map-screen', { timeout: 8000 });

  // 直接构造商店
  await page.evaluate(() => {
    state.run.gold = 300;
    state.shop = genShop();
    state.phase = 'shop';
    render();
  });
  await page.waitForSelector('.shop-screen', { timeout: 5000 });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'shop-list.png') });

  // 点击遗物商品 → 确认弹窗
  await page.evaluate(() => {
    const idx = state.shop.items.findIndex(it => it.kind === 'relic');
    act('buy-shop-item', idx);
  });
  await page.waitForSelector('.shop-confirm-overlay', { timeout: 5000 });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'shop-confirm-relic.png') });

  // 取消
  await page.click('text=取消');
  await page.waitForSelector('.shop-confirm-overlay', { state: 'detached', timeout: 5000 });

  // 点击卡牌 → 确认 → 选人
  await page.evaluate(() => {
    const idx = state.shop.items.findIndex(it => it.kind === 'card');
    act('buy-shop-item', idx);
  });
  await page.waitForSelector('.shop-confirm-overlay', { timeout: 5000 });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'shop-confirm-card.png') });
  await page.click('text=确认购买');
  await page.waitForSelector('.give-row', { timeout: 5000 });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'shop-give.png') });

  console.log('SHOP SHOT OK, errors:', errors.length ? errors : 'none');
  await browser.close();
})();
