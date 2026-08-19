# bg-star100 — 桌游助手合集

多人聚会桌游在线助手合集，部署于 [bg-star100.pages.dev](https://bg-star100.pages.dev/)。

## 项目一览

| 游戏 | 说明 | 位置 |
|------|------|------|
| 🌕 月面探险 | 2~5人合作角色扮演，收集物资返回基地 | `moon-adventure/` |
| ⚔️ 弑君者 | 1~4人合作扑克闯关 | `regicide/` |
| 🐙 深渊回响 | 深海克苏鲁合作肉鸽卡牌构筑 | `abyss-echo/` |
| 🏔️ 登山家 | 2人叠棋策略 | `mountaineer/` |
| 🐠 海底探险 | 2~6人骰子聚会冒险 | `undersea-explorer/` |
| 🃏 UNO | 1人手牌管理 | `uno_single_player/` |
| 🐺 狼人真言 | 4~10人欢乐聚会猜词 | 外部部署 |
| 🐶 夺狗囧事 | 2~5人吹牛博弈 | 外部部署 |
| 💎 印加宝藏 | 3~8人赌狗冒险 | 外部部署 |
| 🐱 捉虫猫日记 | 2人策略竞争 | 外部部署 |

**联机对战版**（基于 Supabase Realtime）：
- 弑君者OL — `regicide/index_ol.html`
- 月面探险OL — `moon-adventure/index_ol.html`

## 共享模块

- `online-boilerplate/` — 联机模板，封装 Supabase Realtime 房间管理，新游戏接入复制即可
- `.shots/` — 截图存档

## 技术栈

- 纯前端 HTML/CSS/JS，无框架依赖
- Supabase Realtime 实现联机同步
- Cloudflare Pages 部署