/* 战斗怪物图片验证：node test-enemy-img.js */
'use strict';
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
  await page.click('.node.available');
  await page.waitForSelector('.enemy-card', { timeout: 8000 });

  // 检查敌人图片是否已渲染
  const imgCount = await page.evaluate(() => document.querySelectorAll('.enemy-img').length);
  console.log('敌人图片数量:', imgCount);
  const imgSrcs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.enemy-img')).map(i => i.src);
  });
  imgSrcs.forEach(s => console.log('图片:', s));

  // 检查图片是否实际加载成功
  const loaded = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.enemy-img')).every(i => i.complete && i.naturalWidth > 0);
  });
  console.log('图片加载完成:', loaded);

  const errs = errors.filter(e => !e.includes('favicon'));
  if (errs.length || !loaded) {
    console.error('问题:', errs, '加载状态:', loaded);
    process.exitCode = 1;
  } else {
    console.log('敌人图片测试 OK');
  }
  await page.screenshot({ path: path.join(__dirname, 'shots', 'enemy-combat.png') });
  await browser.close();
})();