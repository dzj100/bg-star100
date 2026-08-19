/* 连击/条件加伤专项测试：node test-hunter-combo.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mem = {};
global.window = global;
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; },
};
global.document = { getElementById: () => ({ innerHTML: '' }) };
global.showToast = () => {};
global.render = () => {};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'), { filename: 'game.js' });

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.error('FAIL: ' + name + (extra !== undefined ? ' —— ' + extra : '')); }
}

function setupCombat(classes) {
  window._menuSelection = classes;
  newGame();
  state.map.nodes.forEach(n => { n.state = 'cleared'; });
  startCombat(['deep_one']);
  state.combat.log = [];
}

/* 1. 猎手连击机制：先打2张技能，再打攻击牌 → +2 伤害 */
setupCombat(['hunter']);
{
  const p = state.party[0];
  // 手牌里塞固定牌：2 张技能（暗影步）+ 1 张鱼叉刺击（基础5伤）
  const defs = ['hunter_step', 'hunter_step', 'hunter_strike'];
  p.hand = defs.map(id => ({ uid: state.nextUid++, id }));
  p.energy = 10;
  const e = state.combat.enemyGroup[0];
  playCard(0, 0, 0); // 暗影步（技能）
  playCard(0, 0, 0); // 暗影步（技能）
  const hpMid = e.hp;
  playCard(0, 0, 0); // 鱼叉刺击 5 伤 + 连击 2 = 7
  assert('猎手连击: 2张牌后攻击 基础5+连击2=7', hpMid - e.hp === 7, `第3张实际 ${hpMid - e.hp}`);
}

/* 2. 致命连击 hunter_lethal：职业连击(2) + 每张已打牌+2(3×2) = 4+6+2 = 12 */
setupCombat(['hunter']);
{
  const p = state.party[0];
  p.hand = ['hunter_step', 'hunter_step', 'hunter_lethal'].map(id => ({ uid: state.nextUid++, id }));
  p.energy = 10;
  const e = state.combat.enemyGroup[0];
  playCard(0, 0, 0);
  playCard(0, 0, 0);
  const hpMid = e.hp;
  playCard(0, 0, 0); // 4 + 3×2 + 2 = 12
  const dmg = hpMid - e.hp;
  assert('致命连击: 4 + 3×2 + 连击2 = 12', dmg === 12, `实际 ${dmg}`);
}

/* 3. 守望者复仇深渊：本回合受过伤 → 追加 8 */
setupCombat(['warder']);
{
  const p = state.party[0];
  p.hand = [{ uid: state.nextUid++, id: 'warder_venge' }];
  p.energy = 10;
  const e = state.combat.enemyGroup[0];
  state.combat.hurtThisTurn[0] = true;
  const hpBefore = e.hp;
  playCard(0, 0, 0); // 8 + 8 = 16
  assert('复仇深渊(受过伤): 8+8=16', hpBefore - e.hp === 16, `实际 ${hpBefore - e.hp}`);
  // 未受伤时不追加
  setupCombat(['warder']);
  const p2 = state.party[0];
  p2.hand = [{ uid: state.nextUid++, id: 'warder_venge' }];
  p2.energy = 10;
  const e2 = state.combat.enemyGroup[0];
  const h2 = e2.hp;
  playCard(0, 0, 0);
  assert('复仇深渊(未受伤): 仅8', h2 - e2.hp === 8, `实际 ${h2 - e2.hp}`);
}

/* 4. 圣者裁决：目标中毒 → 额外 6 */
setupCombat(['healer']);
{
  const p = state.party[0];
  p.hand = [{ uid: state.nextUid++, id: 'healer_verdict' }];
  p.energy = 10;
  const e = state.combat.enemyGroup[0];
  e.buffs.poison = 3;
  const hpBefore = e.hp;
  playCard(0, 0, 0); // 12 + 6 = 18
  assert('圣者裁决(中毒): 12+6=18', hpBefore - e.hp === 18, `实际 ${hpBefore - e.hp}`);
  // 未中毒不追加
  setupCombat(['healer']);
  const p2 = state.party[0];
  p2.hand = [{ uid: state.nextUid++, id: 'healer_verdict' }];
  p2.energy = 10;
  const e2 = state.combat.enemyGroup[0];
  const h2 = e2.hp;
  playCard(0, 0, 0);
  assert('圣者裁决(未中毒): 仅12', h2 - e2.hp === 12, `实际 ${h2 - e2.hp}`);
}

/* 5. 连击跨回合重置：cardsPlayed 每回合归零？验证 endTurn 后归零 */
setupCombat(['hunter']);
{
  const p = state.party[0];
  p.hand = [{ uid: state.nextUid++, id: 'hunter_strike' }];
  p.energy = 10;
  playCard(0, 0, 0);
  const playedAfter = state.combat.cardsPlayed[0];
  endTurn();
  stepEnemyAct(); // 同步模拟定时器：敌人行动完回到 play
  const playedNext = state.combat.cardsPlayed[0];
  assert('连击计数跨回合重置', playedAfter > 0 && playedNext === 0, `打出后 ${playedAfter}，下回合 ${playedNext}`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
