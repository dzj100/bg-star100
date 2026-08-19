/* 多段伤害分步结算验证：node test-multihit.js */
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
global.showToast = msg => { global._toast = msg; };
global.render = () => {};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'), { filename: 'game.js' });

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('PASS:', msg);
}

window._menuSelection = ['hunter'];
init();
act('new-game');
const hunter = state.party[0];
assert(hunter.classId === 'hunter', '创建深渊猎手');

/* 1. 双刃鱼叉：第一段立即，第二段入队 */
state.party.forEach(p => { p.dead = false; p.hp = p.maxHp; });
startCombat(['deep_one']);
const e = state.combat.enemyGroup[0];
const hp0 = e.hp;
hunter.hand = [{ uid: 9001, id: 'hunter_twin' }];
hunter.energy = 3;
playCard(0, 0, 0);
assert(e.hp === hp0 - 4, `第一段立即结算 4 点 (${hp0}→${e.hp})`);
assert(state.combat.multiQueue.length === 1, '剩余1段进入队列');

/* 2. 结算中锁定结束回合 */
global._toast = null;
const subBefore = state.subPhase;
endTurn();
assert(state.subPhase === 'play' && state.combat.multiQueue.length === 1, '多段结算中结束回合被锁定');
assert(global._toast && global._toast.includes('多段'), `锁定提示: ${global._toast}`);

/* 3. 第二段结算 */
stepMultiHit();
assert(e.hp === hp0 - 8, `第二段结算 4 点 (${hp0}→${e.hp})`);
assert(state.combat.multiQueue.length === 0, '队列清空');

/* 4. 升级版 6×2（重置连击计数，避免上一场景遗留） */
state.combat.cardsPlayed[0] = 0;
hunter.hand = [{ uid: 9002, id: 'hunter_twin', upg: true }];
hunter.energy = 3;
const hp1 = e.hp;
playCard(0, 0, 0);
assert(e.hp === hp1 - 6, '升级双刃鱼叉第一段 6 点');
stepMultiHit();
assert(e.hp === hp1 - 12, '升级双刃鱼叉第二段 6 点');

/* 5. 连击加成：先打1张牌，鱼叉每段+1 */
startCombat(['deep_one']);
const e5 = state.combat.enemyGroup[0];
hunter.hand = [{ uid: 9003, id: 'hunter_step' }, { uid: 9004, id: 'hunter_twin' }];
hunter.energy = 3;
playCard(0, 0, 0); // 暗影步：cardsPlayed=1
assert(state.combat.cardsPlayed[0] === 1, '暗影步计入出牌数');
const hp2 = e5.hp;
playCard(0, 0, 0); // 双刃鱼叉：comboBefore=1
assert(e5.hp === hp2 - 5, `连击使第一段 +1 (${hp2}→${e5.hp})`);
stepMultiHit();
assert(e5.hp === hp2 - 10, `连击使第二段 +1 (${hp2}→${e5.hp})`);

/* 6. 段间目标死亡 → 自动重选 */
startCombat(['deep_one', 'tentacle']);
const e0 = state.combat.enemyGroup[0];
const e1 = state.combat.enemyGroup[1];
e0.hp = 2;
hunter.hand = [{ uid: 9005, id: 'hunter_twin' }];
hunter.energy = 3;
const t1hp = e1.hp;
playCard(0, 0, 0); // 第一段 4 点打死 deep_one
assert(e0.dead && e0.hp <= 0, '第一段击杀 deep_one');
stepMultiHit(); // 重选触手怪
assert(e1.hp === t1hp - 4, `段间死亡自动重选触手怪 (-4, ${t1hp}→${e1.hp})`);
assert(state.combat.multiQueue.length === 0, '重选后队列清空');

/* 7. 多段打死最后一个敌人 → 进入击杀演出，剩余段不再补刀 */
startCombat(['deep_one']);
const lone = state.combat.enemyGroup[0];
lone.hp = 2;
hunter.hand = [{ uid: 9006, id: 'hunter_twin' }];
hunter.energy = 3;
playCard(0, 0, 0); // 第一段 4 点打死唯一敌人
assert(state.combat.pendingWin === true, '唯一敌人死亡触发击杀演出');
assert(state.combat.multiQueue.length === 1, '剩余1段仍在队列');
stepMultiHit(); // 击杀演出中应清队
assert(state.combat.multiQueue.length === 0, '击杀演出中剩余段被清空');
assert(lone.hp <= 0, '不向尸体补刀');

console.log('MULTIHIT TEST DONE');
