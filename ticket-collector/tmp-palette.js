/* 一次性目检：把配色提案页截成一张对照图。跑完即删。 */
'use strict';
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1940, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(__dirname, 'tmp-palette.html')).href);
  await page.waitForTimeout(250);
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1940, height: Math.ceil(h) });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'palette-proposal.png'), fullPage: true });
  console.log('height=' + h);
  await browser.close();
})();
