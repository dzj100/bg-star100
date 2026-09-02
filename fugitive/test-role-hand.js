const { chromium } = require('playwright');
const URL = 'file:///E:/www_self/bg-star100/fugitive/index.html';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(URL);

  // 人类扮演大盗
  await page.evaluate(() => newGame('fugitive'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/rh1-fug-own.png' });
  // 点自己的 role-tag（大盗）
  await page.click('.role-tag.role-fug');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'shots/rh2-fug-own-drawer.png' });
  const title1 = await page.evaluate(() => document.getElementById('sheet-title').textContent);
  console.log('[own-fug] title =', title1);
  await page.evaluate(() => closeSheet());

  // 人类扮演大盗：自己手牌按数字升序展示（便于规划出牌路线）
  await page.evaluate(() => { state.fug.hand = [3, 42, 1, 2]; });
  await page.evaluate(() => closeSheet());
  await page.click('.role-tag.role-fug');
  await page.waitForTimeout(250);
  const ownFug = await page.evaluate(() =>
    [...document.querySelectorAll('#sheet .rh-card:not(.rh-hide)')].map(el => el.textContent));
  console.log('[own-fug] 手牌顺序 =', ownFug.join(','));
  if(ownFug.join(',') !== '1,2,3,42') throw new Error('大盗自己手牌应数字升序 1,2,3,42，实际 ' + ownFug.join(','));
  await page.evaluate(() => closeSheet());

  // 点 AI 警探的 role-tag（对方手牌 → 仅牌背）；开局警探空手，注入几张牌模拟中局
  await page.evaluate(() => { state.mar.hand = [7, 19, 31]; });
  await page.click('.role-tag.role-mar');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'shots/rh3-ai-mar-drawer.png' });
  const title2 = await page.evaluate(() => document.getElementById('sheet-title').textContent);
  const backs2 = await page.evaluate(() => document.querySelectorAll('.rh-card.rh-hide').length);
  console.log('[ai-mar] title =', title2, '| 牌背数 =', backs2);
  if(backs2 !== 3) throw new Error('AI 警探手牌应渲染 3 个牌背，实际 ' + backs2);
  await page.evaluate(() => closeSheet());

  // 人类扮演警探 → 点 AI 大盗 role-tag（保密 → 只显示张数 + ?）
  await page.evaluate(() => newGame('marshal'));
  await page.waitForTimeout(300);
  await page.click('.role-tag.role-fug');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'shots/rh4-ai-fug-drawer.png' });
  const title3 = await page.evaluate(() => document.getElementById('sheet-title').textContent);
  const backs3 = await page.evaluate(() => document.querySelectorAll('.rh-card.rh-hide').length);
  console.log('[ai-fug] title =', title3, '| 牌背数 =', backs3);
  if(backs3 !== 9) throw new Error('AI 大盗手牌应渲染 9 个牌背，实际 ' + backs3);
  await page.evaluate(() => closeSheet());

  // 人类扮演警探 → 点自己的 role-tag：手牌按摸牌顺序展示（不打乱为数字升序）
  await page.evaluate(() => { state.mar.hand = [19, 7, 31]; });
  await page.click('.role-tag.role-mar');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'shots/rh5-own-mar-drawer.png' });
  const ownMar = await page.evaluate(() =>
    [...document.querySelectorAll('#sheet .rh-card:not(.rh-hide)')].map(el => el.textContent));
  console.log('[own-mar] 手牌顺序 =', ownMar.join(','));
  if(ownMar.join(',') !== '19,7,31') throw new Error('警探自己手牌应按摸牌顺序 19,7,31，实际 ' + ownMar.join(','));
  await page.evaluate(() => closeSheet());

  await browser.close();
  console.log('done');
})();
