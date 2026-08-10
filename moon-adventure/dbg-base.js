const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8123/index.html');
  await page.waitForFunction(() => typeof dealGame === 'function');
  await page.evaluate(() => {
    dealGame(['A', 'B']);
    const p = S.players[0];
    p.role = { ...ROLES.find(r => r.id === 'veteran') };
    p.pos = -1;
    p.onRover = false;
    p.returned = false;
    S.ap = 10;
    S.turnPhase = 'spent';
    S.dice = [5];
    S.diceTotal = 5;
    S.accelMarks = [];
    moveMode = null;
    render();
  });
  await page.evaluate(() => {
    moveMode = getMoveReach(-1);
    console.log('TARGETS:', JSON.stringify(moveMode.targets));
    onMoveTargetClick(2);
  });
  await page.waitForSelector('.token-ghost', { timeout: 1000 });
  const info = await page.evaluate(() => {
    const g = document.querySelector('.token-ghost');
    const numRows = Math.ceil(S.path.length / COLS);
    const boardH = BOARD.y0 + (numRows - 1) * (BOARD.maxTilt + BOARD.rowGap) + BOARD.tileW + 3;
    const { x, y } = tilePos(0);
    const left = (x + BOARD.tileW / 2).toFixed(1);
    const top = ((y - BOARD.tileW / 2) / boardH * 100).toFixed(1);
    return {
      ghost: g ? { left: g.style.left, top: g.style.top, transform: g.style.transform } : null,
      calc: { left: `calc(${left}% - 21px)`, top: `calc(${top}% - 10px)` },
      steps: S._moveSteps,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
