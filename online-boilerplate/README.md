# online-boilerplate — 联机桌游模板

基于 Supabase Realtime 的轻量联机方案，支持 2~5 人实时对战。  
从「月面探险」和「弑君者」两个项目中提取的通用模式。

## 文件结构

```
online-boilerplate/
├── net.js        # Supabase 网络通信层（复制即用，修改配置）
├── online.js     # 联机逻辑模板（实现钩子函数接入）
└── README.md
```

## 接入步骤

### 1. 复制文件

- 将 `net.js` 和 `online.js` 复制到你的项目目录
- 修改 `net.js` 中的 `NET_CONFIG`：
  ```js
  ROOM_PREFIX: 'mygame-',   // 不同游戏用不同前缀
  MAX_PLAYERS: 4,            // 最大玩家数
  ```

### 2. HTML 引入

在 `</body>` 前按顺序加载：

```html
<script src="game.js"></script>
<script src="render.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="net.js"></script>
<script src="online.js"></script>
```

添加联机大厅容器：

```html
<div id="online" style="display:none"></div>
```

### 3. 实现钩子函数

在 `online.js` 之后调用 `initOnline()`：

```js
initOnline({
  // === 必需 ===
  dealGame: (names) => {
    dealGame(names);
    S.phase = 'playing';
  },
  render: () => render(),
  renderLanding: () => renderLanding(),
  clearState: () => clearState(),
  getOnlineState: () => S,
  applyOnlineState: (state) => { S = state; },

  // === 可选 ===
  addLog: (msg, cls) => addLog(msg, cls),
  showEndModal: () => showEndModal(),
  getPlayers: () => S.players,
  getCurrentPlayer: () => S.currentPlayer,
  getPlayerColors: () => PLAYER_COLORS,
  showLanding: () => showLanding(),

  // 观战模式：禁用非当前玩家的交互
  updateDiceAreaUI: () => {
    const app = document.getElementById('app');
    if (!app) return;
    const diceArea = app.querySelector('.dice-area');
    if (!diceArea) return;
    const state = window._getOnlineState();
    const isMyTurn = state.currentPlayer === _mySeatIndex;
    diceArea.classList.toggle('online-waiting', !isMyTurn);
    // 更新 h3 显示观战/回合提示
    const h3 = diceArea.querySelector('h3');
    if (h3) {
      h3.innerHTML = (isMyTurn ? '' : '👀 观战 ') + h3.innerHTML;
    }
  },
});
```

### 4. 集成状态推送

在 `game.js` 中找到 `saveState` 函数，在末尾追加推送：

```js
// 原始 saveState 中已有 saveState() 调用
// 在其后追加：
if (typeof onlinePushState === 'function') {
  onlinePushState();
}
```

### 5. 集成渲染拦截

在 `render.js` 中找到 `render` 函数，在末尾追加：

```js
// 原始 render 中已有 render() 调用
// 在其后追加：
if (typeof onlineAfterRender === 'function') {
  onlineAfterRender();
}
```

### 6. 集成游戏结束

在 `game.js` 中找到 `endGame` 函数，在末尾追加：

```js
// 原始 endGame 中已有 endGame() 调用
// 在其后追加：
if (typeof onlineEndGame === 'function') {
  onlineEndGame();
}
```

### 7. 添加守卫逻辑

在关键操作（如按钮点击、地图点击）前添加：

```js
function someAction() {
  if (typeof window._olIsActor === 'function' && !window._olIsActor()) return;
  // ... 实际逻辑
}
```

## 数据隔离

不同游戏通过 `ROOM_PREFIX` 隔离数据库记录：

| 游戏 | 前缀 | 完整房间号示例 |
|------|------|----------------|
| 月面探险 | `ymtx-` | `ymtx-4821` |
| 弑君者 | `regi-` | `regi-4821` |
| 你的游戏 | `mygame-` | `mygame-4821` |

## 数据库表结构

Supabase 中需要一张 `rooms` 表：

```sql
create table rooms (
  id text primary key,
  host_name text not null,
  status text not null default 'waiting',
  seats jsonb not null default '[]',
  state jsonb
);
```