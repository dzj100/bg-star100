/* 返回菜单确认流程验证：node test-quit-confirm.js */
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

window._menuSelection = ['warder'];
act('new-game');
assert(state.phase === 'map', '开局进入地图');
assert(!!state.saveExists || !!state.hasSave || !!state.savedRun || !!localStorage.getItem('abyss-save'), '开局已写入存档');

/* 1. 点返回菜单 → 弹确认，进度保留 */
act('quit-menu');
assert(state.phase === 'map', '点击返回菜单后仍在地图（未直接退出）');
assert(state.quitConfirm === true, '进入确认状态（quitConfirm）');
assert(!!localStorage.getItem('abyss-save'), '确认期间存档仍在');

/* 2. 取消 → 恢复，存档仍在 */
act('quit-cancel');
assert(state.quitConfirm === false, '取消后退出确认状态');
assert(state.phase === 'map', '取消后仍在地图');
assert(!!localStorage.getItem('abyss-save'), '取消后存档未被清除');

/* 3. 确认返回 → 回菜单，存档清除 */
act('quit-menu');
act('return-menu');
assert(state.phase === 'menu', '确认返回后回到主菜单');
assert(localStorage.getItem('abyss-save') === null, '确认返回后存档已清除');

/* 4. 结束页（defeat/victory）直接返回，无确认 */
window._menuSelection = ['warder'];
act('new-game');
act('quit-menu');
assert(state.phase === 'map', '新一局进入地图');
state.phase = 'defeat'; state.gameOver = true; state.quitConfirm = false;
act('quit-menu');
assert(state.phase === 'menu', 'defeat 页返回菜单无需确认');

console.log('QUIT CONFIRM OK');
