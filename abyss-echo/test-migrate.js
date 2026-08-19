/* 旧存档迁移兼容验证：node test-migrate.js */
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

/* 构造旧版本存档：新开局并进入战斗，然后删掉后来新增的字段 */
window._menuSelection = ['warder'];
init();
act('new-game');
state.party.forEach(p => { p.dead = false; p.hp = p.maxHp; });
startCombat(['deep_one']);
delete state.combat.multiQueue;
delete state.combat.pendingTide;
delete state.combat.tideSplash;
mem['abyss-save'] = JSON.stringify(state);

/* 重新加载：应触发迁移补全 */
init();
assert(state.combat && Array.isArray(state.combat.multiQueue), '旧存档迁移补全 multiQueue');
assert(state.combat.pendingTide === null, '旧存档迁移补全 pendingTide');

/* 迁移后打牌不应报错 */
const p = state.party[0];
p.hand = [{ uid: 9100, id: 'warder_strike' }];
p.energy = 3;
const hp = state.combat.enemyGroup[0].hp;
let threw = false;
try { playCard(0, 0, 0); } catch (e) { threw = true; console.error('抛错:', e.message); }
assert(!threw, '旧存档恢复后 playCard 不抛错');
assert(state.combat.enemyGroup[0].hp < hp, `攻击正常结算 (${hp}→${state.combat.enemyGroup[0].hp})`);

/* 结束回合也不应报错 */
threw = false;
try { endTurn(); } catch (e) { threw = true; console.error('抛错:', e.message); }
assert(!threw && state.subPhase === 'enemy', '旧存档恢复后 endTurn 正常');

console.log('MIGRATE TEST DONE');
