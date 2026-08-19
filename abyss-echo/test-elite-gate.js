/* 精英通关强制验证：node test-elite-gate.js */
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
const toasts = [];
global.showToast = msg => { toasts.push(msg); };
global.render = () => {};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'), { filename: 'game.js' });

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('PASS: ' + msg);
}
/* 快进到最后一行的指定节点并完成它 */
function finishLastRow(type) {
  const lastRow = state.map.nodes.filter(n => n.row === state.map.rows.length - 1);
  const target = lastRow.find(n => n.type === type) || lastRow[0];
  target.state = 'available';
  state.run.currentNodeId = target.id;
  completeNode();
}
/* 打一场精英战并胜利结算 */
function winElite() {
  const elite = state.map.nodes.find(n => n.type === 'elite');
  elite.state = 'available';
  state.run.currentNodeId = elite.id;
  startCombat(pick(ELITES));
  const e = state.combat.enemyGroup[0];
  e.hp = 1; e.block = 0;
  dealDamage(e, 999, { playerIdx: 0 });
  if (allEnemiesDead()) state.combat.pendingWin = true;
  stepKillSettle();
  if (state.phase === 'reward') act('skip-reward');
}

window._menuSelection = ['warder'];
act('new-game');
assert(state.run.floor === 1, '开局第 1 层');
const elite1 = state.map.nodes.find(n => n.type === 'elite');
assert(!!elite1, '第 1 层有精英节点');

/* 1. 不打精英直接走完最后一行的战斗节点 → 应被拦截 */
toasts.length = 0;
finishLastRow('combat');
assert(state.run.floor === 1, '未打精英：仍停留在第 1 层');
assert(elite1.state === 'available', '精英节点被解锁为可前往（回头路）');
assert(toasts.some(t => t.includes('精英')), '弹出必须击败精英的提示');

/* 2. 回头打精英 → 进入第 2 层 */
winElite();
assert(state.run.floor === 2, '击败精英后进入第 2 层');
assert(elite1.state === 'cleared', '精英节点标记为已清除');

/* 3. 第 2 层同样强制 */
const elite2 = state.map.nodes.find(n => n.type === 'elite');
assert(!!elite2, '第 2 层有精英节点');
finishLastRow('combat');
assert(state.run.floor === 2, '第 2 层未打精英：被拦截');
winElite();
assert(state.run.floor === 3, '第 2 层击败精英后进入第 3 层');

/* 4. 第 3 层无精英，Boss 后直接胜利 */
assert(!state.map.nodes.find(n => n.type === 'elite'), '第 3 层无精英节点');
const bossNode = state.map.nodes.find(n => n.type === 'boss');
bossNode.state = 'available';
state.run.currentNodeId = bossNode.id;
startCombat(['abyssal_will']);
const b = state.combat.enemyGroup[0];
b.hp = 1; b.block = 0;
dealDamage(b, 999, { playerIdx: 0 });
if (allEnemiesDead()) state.combat.pendingWin = true;
stepKillSettle();
if (state.phase === 'reward') act('skip-reward');
assert(state.phase === 'victory', '第 3 层 Boss 胜利后通关（victory）');

console.log('ELITE GATE OK');
