/* 事件战斗遗物入账验证：node test-event-relic.js */
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

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('PASS: ' + msg);
}

/* 模拟事件战斗：摧毁祭坛 → 精英战 → 胜利后获得遗物+金币 */
function eventFightWin() {
  state.pendingFight = { reward: 'relic' };
  startCombat(['abomination']);
  const e = state.combat.enemyGroup[0];
  e.hp = 1; e.block = 0;
  dealDamage(e, 999, { playerIdx: 0 });
  if (allEnemiesDead()) state.combat.pendingWin = true; // playCard 的击杀检查逻辑
  assert(state.combat.pendingWin, '击杀后进入击杀演出（pendingWin）');
  stepKillSettle();
  assert(state.phase === 'reward', '击杀演出结束后进入奖励界面');
}

window._menuSelection = ['warder'];
act('new-game');
state.map.nodes.forEach(n => { n.state = 'cleared'; });

/* 场景1：奖励界面直接点「离开」→ 遗物必须入账 */
eventFightWin();
assert(state.reward.relics.length === 1, `奖励界面展示 1 个遗物（${state.reward.relics[0]}）`);
const rid1 = state.reward.relics[0];
act('skip-reward');
assert(state.run.relicIds.includes(rid1), `离开后遗物【${rid1}】已入账 run.relicIds`);
assert(state.phase === 'map', '回到地图');

/* 场景2：选卡后离开 → 遗物同样入账 */
eventFightWin();
const rid2 = state.reward.relics[0];
assert(!state.run.relicIds.includes(rid2), `场景2遗物【${rid2}】为未拥有遗物`);
act('pick-reward-card', 0);
act('reward-give', 0);
assert(state.run.relicIds.includes(rid2), `选卡后遗物【${rid2}】也已入账`);
assert(state.phase === 'map', '选卡后回到地图');

/* 场景3：遗物不重复入账 */
const before = state.run.relicIds.length;
eventFightWin();
const rid3 = state.reward.relics[0];
act('skip-reward');
assert(state.run.relicIds.includes(rid3), `场景3遗物【${rid3}】已入账`);
assert(state.run.relicIds.length === before + 1, `无重复入账（${before} → ${state.run.relicIds.length}）`);

/* 场景4：已拥有【深渊护符】，事件「抵抗」点击被拒（不消耗选项），可改选其他选项 */
state.run.relicIds.push('abyss_charm');
state.event = { defId: 'abyss_whisper', chosen: null };
const nBefore = state.run.relicIds.length;
act('pick-event-option', 1); // 抵抗：原为硬发 abyss_charm
assert(state.event.chosen === null, '场景4 已拥有时点击「抵抗」不消耗选项（chosen 仍为 null）');
assert(state.run.relicIds.length === nBefore, '场景4 遗物未发放（数量不变）');
act('pick-event-option', 0); // 接受：可正常改选
assert(state.event.chosen === 0, '场景4 改选「接受」成功');
assert(state.run.permanentBuffs.strength === 1, '场景4 「接受」效果生效（永久力量+1）');

/* 场景5：遗物全收集后，点击「抵抗」同样被拒，改选其他选项正常 */
Object.keys(RELICS).forEach(id => { if (!state.run.relicIds.includes(id)) state.run.relicIds.push(id); });
const nAll = state.run.relicIds.length;
state.event = { defId: 'abyss_whisper', chosen: null };
act('pick-event-option', 1);
assert(state.event.chosen === null, '场景5 全收集后「抵抗」被拒（chosen 仍为 null）');
assert(state.run.relicIds.length === nAll, '场景5 遗物数量不变');
act('pick-event-option', 0);
assert(state.event.chosen === 0, '场景5 改选「接受」成功');
assert(state.run.permanentBuffs.strength === 2, '场景5 「接受」效果生效（永久力量+1）');

console.log(state.run.relicIds.length >= 2 ? 'EVENT RELIC OK' : 'EVENT RELIC FAIL');
if (state.run.relicIds.length < 2) process.exitCode = 1;
