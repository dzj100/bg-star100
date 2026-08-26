# 时序谜局 (Take Time) 桌游助手 — 规格说明

移动优先的单页 HTML 联机桌游助手，零外部依赖（除本地 Supabase 库）。
支持 2~4 名玩家在各自手机上实时联机协作。

## 规则模型

- 钟面分为 **6 个区域**（1→6，从左到右/顺时针方向）。
- 牌库：日牌 ☀ / 月牌 ☾ 各 1~12；每局生成 12 张牌（数字 1~12 洗牌，颜色随机），等量发给玩家：
  - 2 人局：各 6 张；3 人局：各 4 张；4 人局：各 3 张。
- **眼标记**：基础数量 = 玩家人数；另可携带本关累计的赠送标记（失败+1，上限 +3，通关清零）。
- **关卡库 `CHALLENGE_LIB`**（game.js）：40 关（10 章 × 4 关），每关可配置：
  - `name`：关卡名；`desc`：规则展示文本（钟面上方横幅 `.clock-rule` + 等候室），**不标注硬规则**（每区域≥1张、总和递增等通用判定在规则弹层统一说明）；
  - `check(sums, segments)`：自定义通关判定（返回 `{ segOK, sumOK, ascOK, pass }`）。
  - 未收录的关卡使用 `defaultCheck` 通用判定：
    1. 每个区域至少 1 张牌；
    2. 每个区域总和 ≤ 24；
    3. 区域 1→6 总和非降序（递增或相等）。
  - 第 1 章 4 关自定义规则（已实现，仅标注本关特殊/例外规则）：
    1. **孤阳**：1 号位只能放 1 张太阳牌；6 号位必须有 3 张牌；本关无总和≤24 限制。
    2. **枢衡**：3 号位数字总和必须在 8~12 之间；4 号位必须有 3 张牌；本关无总和≤24 限制。
    3. **序引**：第 1 张牌必须放在 3 号位，第 2 张牌必须放在 2 号位（按全局放置顺序 `card.order`）；6 号位数字总和必须在 20~30 之间；本关无总和≤24 限制。
    4. **近六**：1 号位数字总和必须比其他位次更接近 6（严格最小）；4 号位必须是 1 张太阳牌 + 1 张月亮牌；保留 ≤24 限制。
- **章节锁定**：当前仅开放第 1 章；等候室选择更后章节 → toast「敬请期待」。
- 进度（赠送标记/是否通过）按关卡 ID（1~40）存本地 localStorage，以房主设备为准；**退出房间时重置本关进度**（`confirmExitRoom` → `_olResetProgress`，清除当前 `challenge.id` 的赠送标记与通过状态），重建房间后从全新挑战开始（`eyeBonus=0`）；房主「重试本关」不重置。

## 流程

1. **等候室**：房主选择章节(1-10)、关卡(1-4)，按关卡库展示该关名称与规则；2~4 人齐后开始。
2. **发牌+讨论**（phase=discuss）：展示钟面，牌背面朝下发给每人；玩家通过外部语音讨论策略，不能看牌。
3. **看牌**（phase=reveal）：仅房主可点「看牌」，此后每人可见自己的手牌，并显示「已看牌，禁止交流」提示。
4. **聚光灯选先手**（phase=spin）：房主启动，高亮在各玩家间循环 3 圈后自动停止（房主可提前停止），停中的玩家为先手。
5. **轮流出牌**（phase=play）：从先手开始按座位顺序，**拖拽出牌** —— 按住手牌拖到任意区域（暗置），松开弹确认抽屉「是否将 XX 牌放置到 XX 号区域？」（含眼标记勾选，用完不可再勾）；确认放置 / 取消保持牌在手牌区。全部打完进入可结算状态。
6. **结算**（phase=result）：**仅房主**点「翻开结算」（成员侧显示「等待房主翻开结算…」，`settle()` 带 isHost 守卫），自动翻开全部牌、计算各区域总和并判定通关，展示逐项检查结果。
   - 通关：回收赠送眼标记；未通关：赠送 1 个眼标记（累计 ≤3）供下次挑战本关使用。
   - 房主：通关 →「重试本关 / 下一关」双按钮；未通关 → 仅「重试本关」（同关卡重发牌）。
   - 「下一关」按 `challenge.id + 1` 从 `CHALLENGE_LIB` 自动初始化（第 4 关 → 下一章第 1 关）；无下一关（id=40）→ 弹窗「已通关所有章节」。

## 2 人局特殊规则（手牌锁定）

- 看牌（reveal）时只展示手牌**前 4 张**，后 2 张以背面显示并标注「暂锁定」。
- 双方合计打出 **4 张牌**（每边 2 张）后，后 2 张自动解锁，双方各自追加看到自己的牌。
- 锁定期间拖拽锁定牌无效（`handLockedIndexes()` 守卫 `cardDragStart`/`selectCard`）。
- 3/4 人局无锁定。

## 状态结构

```js
S = {
  players: [{ name, hand: [{ v, color:'sun'|'moon', revealed, by }] }], // by 为座位号
  phase: 'discuss' | 'reveal' | 'spin' | 'play' | 'result',
  challenge: { chapter, test, id, desc },  // desc 来自关卡库
  segments: [{ cards: [] } ×6],        // 已放置的牌
  firstSeat: null, currentSeat: 0, turnNo: 0,
  eyeBase: n, eyeBonus: 0, eyeUsed: 0, // 剩余 = base + bonus - used
  spin: { running, seat, tick },
  allPlaced: false, settled: false, pass: null,
  sums: [n×6] | null, check: { segOK[], sumOK[], ascOK } | null,
  settleStamp: number,                  // 进度防重
  log: [], gameOver: false,
}
```

本地（非共享）：`pendingPlay = { cardIndex, seg, useEye }`、聚光灯定时器。

## 联机架构

- `net.js`：Supabase 房间 CRUD + Realtime 订阅（`ROOM_PREFIX='taketime-'`，`MAX_PLAYERS=4`）。
- `online.js`：状态同步、回合锁定、房主接管、刷新重连（`SESSION_KEY='taketime-online'`）。
- 手牌随共享状态广播（朋友间信任模式），UI 层**只渲染自己的手牌**，绝不渲染他人手牌。
- 推送守卫：出牌 = 当前座位；看牌/聚光灯/重开/下一关 = 房主；结算 = 结算者（先把自己的座位写入 currentSeat 保证 canPush 通过）。
- **等候室选关同步**：房主选择关卡后写入 `pendingChallenge`（非共享，仅房主设备），经 `window._olRefreshWaitingRoom` → `room.state.pendingChallenge` → 成员端 `window._olPendingChallenge` 实时同步到等候室界面。
- **成员离开接管**：成员退出（seats 减少）→ 房主弹「接管操作 / 重置游戏」抽屉。点接管 → 离席座位写入 `S.departedPlayers` 并推送全端。此后轮到离席玩家时，房主以 `actionSeat()`（= 离席座位）代其查看/拖拽/放置手牌：`isMyTurn()` 对房主放行、`handLockedIndexes`/`selectCard`/`placeCard`/手牌区渲染/确认抽屉全部按 `actionSeat()` 取手牌，牌归属（`card.by`）与日志均记录离席玩家；成员端 `_olIsActor`/`isMyTurn` 不放行，保持观战。

## UI 布局（移动端）

```
┌──────────────────────────────┐
│ 标题 · 关卡信息        🚪退出 │
│ 规则横幅（当前关卡 desc）     │
│ ┌──────────────────────────┐ │
│ │      钟面（6区域环形）     │ │
│ │     中心: 眼标记/提示      │ │
│ └──────────────────────────┘ │
│ 玩家条（颜色点/名字/手牌数/高亮）│
│ 手牌区（仅自己；接管时显示被接管玩家手牌）│
│ 操作区（按阶段切换按钮）       │
│ 日志（仅最后一行 + ▼展开）     │
└──────────────────────────────┘
```

- **着陆页**（简化）：居中 ⏳ 图标 + 标题 + 副标题 + 联机入口按钮 + 底部 `@imStar100`；右上角「📜 规则」按钮弹出规则弹层（`showRulesModal`，含游戏说明与通关判定）。
- **卡牌配色**：太阳牌正面米金底黑字 + 金边，月亮牌正面深蓝底白字 + 蓝边；正面与牌背同底色（仅数字/图标区分）；`card` / `card-big` / `mini-card` 三处一致。
- **牌背**：手牌背面与桌面暗置牌同一套 UI —— 按日/月显示 ☀/☾ 符号 + 对应底色（太阳米金底 / 月亮深蓝底），隐藏数字；2 人局锁定牌同样显示日/月牌背。
- **桌面牌展示**：区域内已放置牌与手牌同款样式（横置），明置/暗置混合横排，多张按比例缩放并自动换行（`.seg-cards` flex wrap，`aspect-ratio:2/3`），保留 ☀/☾ 图标与数字（暗置无数字）。
- **动效（game feel）**：
  - 聚光灯：命中玩家 chip 金色呼吸光环（`spotlight-pulse`），未命中玩家变暗聚焦；转动步进 170ms（3 圈约 1~2 秒）。
  - 出牌：新放置/翻开的牌 pop 入场（squash & stretch `card-pop`，`fresh` 标记驱动，全端同步；`fresh` 在 `render()` 末尾统一清除，**只在首次入场播放一次**，后续 render 不重放）。
  - 明置牌：金色微光（`.lit`）；轮到你的提示呼吸脉冲（`turn-pulse`）。
  - 结算：面板 slide-up 进场；失败附加轻微抖动（`shake-x`），成功附加绿色光晕（`glow-pass`）。
  - 布局稳定：玩家标签（🎯/先手）绝对定位不占高度，聚光灯转动不挤压玩家条。
- **拖拽出牌（pointer 事件状态机）**：
  - 手牌 `.card { touch-action:none }`；`pointerdown` → 移动 >8px 阈值后创建 ghost（`cardDragStart` 缓存各区域圆心/半径，只挂一次全局 move/up 监听）。
  - ghost 为 `position:fixed; left:0; top:0` 的 64×96 浮层，`transform: translate(x,y) rotate(-4deg)` + `will-change:transform` 跟手（显式像素偏移，不依赖 left/top 与百分比 translate）；原卡缩放变暗（`.dragging`）。
  - 松手落点用**数学点圆检测**（缓存圆心 + 半径，`d <= r*1.1`）命中区域 → `.drag-hover` 金色高亮放大 → 弹确认抽屉；未命中任何区域则原样回弹（仅 render，无副作用）。
  - **性能策略**：ghost 用 transform（合成层）而非 left/top（避免 Layout），无 transition 跟随；每帧 hit-test 不查询 DOM（缓存 rects + 点圆数学），避免 `elementFromPoint`。
  - 确认抽屉（`.playSheet`）：slide-up 弹层 + 遮罩；标题含卡牌大图与「是否将 XX 牌放置到 XX 号区域？」；下方眼标记勾选 + 「确认放置/取消」；取消或遮罩关闭 → `closeSheet()` 清 `pendingPlay` 并 `render()` 清除 `sel` 高亮。
- **规则弹层**：`showRulesModal` 底部弹层 slide-up 进场，内含游戏说明与通用通关判定。
- 区域：圆形（`position:absolute; width:30%; height:30%` + `border-radius:50%`，显式等宽高保证正圆），显示编号、已放置牌（明置显示数值卡+微光，暗置显示日/月牌背）、可见总和；结算后显示最终总和与全部牌。
- **规则横幅**：`.clock-rule` 显示在 `.clock-wrap` 上方（居中，max-width 400px），内容为当前关卡 `desc`；钟面中心不再显示关卡规则。
- **日志折叠**：`.log-box` 仅显示最后一条日志，整行可点击弹抽屉（`showLogModal`，`.log-more` 箭头已隐藏）查看完整日志列表（`log-list` 纵向排列）；抽屉支持遮罩点击关闭。
- **结算隐藏手牌**：`action-box` 可见（结算环节）时隐藏 `hand-box`（此时必无手牌）。
- 看牌后各阶段显示「🔇 已看牌，禁止交流」提示；讨论阶段提示「💬 看牌前请用语音讨论策略」。
- 阶段操作：
  - discuss：房主「🔍 看牌」/ 他人提示等待
  - reveal：房主「🎯 启动聚光灯」
  - spin：房主「⏹ 停止聚光灯」
  - play：当前玩家**拖拽手牌**到区域 → 确认抽屉（确认放置/取消）；全部打完显示「🧮 翻开结算」（仅房主，成员侧显示等待文案）
  - result：逐项检查结果 + 房主「🔄 重试本关」/「⏭ 下一关」（仅通关后显示）

## 页面与命名

- 项目目录：`take-time/`（index.html / style.css / game.js / render.js / net.js / online.js / SPEC.md / supabase.min.js）
- 样式独立于 style.css（index.html 仅 `<link>` 引入）
- localStorage：`taketime-state`（游戏）、`taketime-progress`（进度）、`taketime-online`（联机会话）
- 着陆页版权：`@imStar100`

## 测试

- `node --check` 语法校验
- node + vm mock DOM 验证发牌、2人局锁定、关卡库判定、房主接管离席玩家、仅房主结算、退出重置进度（test-core.js，98 断言）
- Playwright 移动视口双端 E2E：联机全流程（含**鼠标拖拽出牌**、确认抽屉、取消恢复）+ 规则弹层 + 锁定/解锁 + 禁止交流提示 + 结算 + 重试/下一关 + **成员退出→房主接管→代打离席玩家**（test-e2e.js）
- Playwright 刷新重连 E2E：对局中途成员刷新页面，重连恢复后轮到自己出牌仍能推送到其他玩家（test-e2e-refresh.js，覆盖 `_tryReconnect` 恢复 `_lastPushedCurrentSeat` 的修复）
