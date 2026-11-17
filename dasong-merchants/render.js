/* 大宋百商图 · 界面渲染与交互 */
(function () {
  'use strict';

  var DSM = window.DSM;
  var $ = function (id) { return document.getElementById(id); };
  var esc = DSM.escapeHtml;

  var SETUP_KEY = 'dsm:setup:v1';
  var GAME_KEY = 'dsm:game:v1';
  var DEFAULTS = {
    playerCount: 2,
    startingCash: 5,
    startingLowMenus: 6,
    startingMidMenus: 2,
    victoryCash: 50,
    victoryShops: 8,
    names: ['', '', '', '']
  };

  var BLOCK_SUMMARY = {
    resources: function (c) {
      return '铜钱 ' + c.startingCash + ' · 四品菜 ' + c.startingLowMenus + ' · 三品菜 ' + c.startingMidMenus;
    },
    victory: function (c) {
      return '铜钱 ' + c.victoryCash + ' · 房屋 ' + c.victoryShops;
    }
  };

  var UI = {
    screen: 'landing',
    config: loadConfig(),
    modal: null,
    dismissible: false,
    summaryShown: null,
    resultShown: false,
    eventOpen: false,
    logOpen: false,
    openBlocks: { resources: false, victory: false },
    deckIndex: 0,
    advanceAfterEvents: false,
    lastOptions: null
  };

  var landingEl = $('landingScreen');
  var setupEl = $('setupScreen');
  var gameEl = $('gameScreen');
  var modalRoot = $('modalRoot');
  var toastEl = $('toast');
  var toastTimer = null;

  function loadConfig() {
    try {
      var saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        return Object.assign({}, DEFAULTS, saved, { names: (saved.names || DEFAULTS.names).slice(0, 4) });
      }
    } catch (error) { /* ignore */ }
    return Object.assign({}, DEFAULTS, { names: DEFAULTS.names.slice() });
  }

  function saveConfig() {
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(UI.config)); } catch (error) { /* ignore */ }
  }

  /* 对局存档：state 为纯数据，整体序列化即可 */
  function saveGame() {
    if (!DSM.state) return;
    if (DSM.state.phase === 'over') { clearGame(); return; }
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify({
        v: 1,
        at: Date.now(),
        options: UI.lastOptions,
        state: DSM.state
      }));
    } catch (error) { /* ignore */ }
  }

  function loadGame() {
    try {
      var saved = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
      if (saved && saved.v === 1 && saved.state && Array.isArray(saved.state.players) && saved.state.players.length) {
        return saved;
      }
    } catch (error) { /* ignore */ }
    return null;
  }

  function clearGame() {
    try { localStorage.removeItem(GAME_KEY); } catch (error) { /* ignore */ }
  }

  /* 未打完的存档；已结束的对局在下次进入时直接作废 */
  function savedGame() {
    var saved = loadGame();
    if (!saved) return null;
    if (saved.state.phase === 'over') { clearGame(); return null; }
    return saved;
  }

  function resumeGame() {
    var saved = savedGame();
    if (!saved) return false;
    DSM.state = saved.state;
    if (saved.options) UI.lastOptions = saved.options;
    UI.screen = 'game';
    UI.summaryShown = null;
    UI.resultShown = false;
    UI.eventOpen = false;
    UI.logOpen = false;
    UI.deckIndex = 0;
    if (UI.modal) closeModal();
    render();
    window.scrollTo(0, 0);
    return true;
  }

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function coin(size) {
    var s = size || 16;
    return '<svg class="coin" width="' + s + '" height="' + s + '" viewBox="0 0 20 20" aria-hidden="true">' +
      '<circle cx="10" cy="10" r="8.6" fill="#cfa14a" stroke="#9a7228" stroke-width="1.3"/>' +
      '<circle cx="10" cy="10" r="6.4" fill="none" stroke="#f4dda6" stroke-width=".8" opacity=".75"/>' +
      '<rect x="7.4" y="7.4" width="5.2" height="5.2" rx=".7" fill="#6d4a1f"/>' +
      '</svg>';
  }

  function house(size) {
    var s = size || 18;
    return '<svg class="house" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 11 12 4l9 7" fill="none" stroke="#6f2b1f" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M5.5 10.5V20h13v-9.5" fill="#f3e7d0" stroke="#6f2b1f" stroke-width="1.4"/>' +
      '<rect x="10" y="13" width="4" height="7" fill="#6f2b1f" opacity=".72"/>' +
      '</svg>';
  }

  function sealChar(name) {
    return (name || '客').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 1) || '客';
  }

  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];

  function rankIncome(card) {
    if (!card) return '';
    if (card.income.type === 'fixed') return '收益 ' + card.income.value;
    if (card.income.type === 'dice_plus') return '收益 骰+2';
    return '';
  }

  function shopIncomeText(shop) {
    var base = shop.baseIncome;
    if (base.type === 'fixed') return '收益 ' + base.value;
    if (base.type === 'dice') return '收益 1 骰';
    if (base.type === 'built_shop_count') return '收益 = 店铺数';
    if (base.type === 'consumed_menu_count_plus') return '收益 = 菜数+' + base.value;
    return '特殊收益';
  }

  function shopBonusText(shop) {
    var list = (shop.builtShopBonuses || []).map(function (bonus) {
      return (DSM.shopById[bonus.targetShopId] ? DSM.shopById[bonus.targetShopId].name : '店铺') + ' +' + bonus.incomeBonus;
    });
    return list.length ? '联动 ' + list.join('、') : '';
  }

  function shopEffectText(shop) {
    return (shop.visitEffects || []).map(function (effect) {
      if (effect.type === 'extra_menu_cost') return '客人多吃 ' + effect.value + ' 道';
      return '';
    }).filter(Boolean).join(' ');
  }

  function ruleMenuCost(card) {
    return card.purchaseCost == null ? '不可购买' : card.purchaseCost + ' 铜';
  }

  function ruleMenuIncome(card) {
    if (card.income.type === 'fixed') return card.income.value + ' 铜';
    if (card.income.type === 'dice_plus') return '1 骰 +' + card.income.value;
    return '—';
  }

  function ruleShopIncome(shop) {
    var base = shop.baseIncome;
    if (base.type === 'fixed') return base.value + ' 铜';
    if (base.type === 'dice') return '1 骰';
    if (base.type === 'built_shop_count') return '= 已建店铺数';
    if (base.type === 'consumed_menu_count_plus') return '= 本次吃菜数 +' + base.value;
    return '—';
  }

  function ruleShopExtra(shop) {
    var parts = (shop.builtShopBonuses || []).map(function (bonus) {
      var target = DSM.shopById[bonus.targetShopId];
      return target ? target.name + ' +' + bonus.incomeBonus : '';
    }).filter(Boolean);
    var effect = shopEffectText(shop);
    if (effect) parts.push(effect);
    return parts.length ? parts.join('、') : '—';
  }

  function ruleTable(headers, rows) {
    return '<div class="rule-table-wrap"><table class="rule-table">' +
      '<thead><tr>' + headers.map(function (text) { return '<th>' + text + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function ruleSection(no, title, lead, inner) {
    return '<section class="rule-sec">' +
      '<h3><span class="rule-sec-no">' + no + '</span>' + title + '</h3>' +
      (lead ? '<p class="rule-sec-lead">' + lead + '</p>' : '') +
      inner +
    '</section>';
  }

  /* ------------------------------ 首页：无边界 · 散点小品 ------------------------------ */

  var LND_SERIF = "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'SimSun', serif";

  function lndLantern(x, y, s) {
    s = s || 1;
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<path d="M0 -16 L0 0" stroke="#6b5a45" stroke-opacity=".55" stroke-width="1.1"/>' +
      '<path d="M-6.5 0 L6.5 0" stroke="#b98a45" stroke-width="1.6" stroke-linecap="round"/>' +
      '<ellipse cx="0" cy="10.5" rx="8" ry="10.5" fill="#b03f2c" stroke="#6f2b1f" stroke-width="1.1"/>' +
      '<path d="M-5 2 Q0 -1 5 2 M-6.8 10.5 Q0 7 6.8 10.5 M-5 19 Q0 22 5 19" fill="none" stroke="#e8c98c" stroke-opacity=".5" stroke-width=".8"/>' +
      '<path d="M0 1 L0 20" stroke="#e8c98c" stroke-opacity=".22" stroke-width=".7"/>' +
      '<path d="M-6.5 20.5 L6.5 20.5" stroke="#b98a45" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M0 20.5 L0 26 M-3 26 L3 26" stroke="#b98a45" stroke-width="1.1"/>' +
      '</g>';
  }

  function lndVase(x, y, s, tone) {
    var fill = tone === 'blue' ? '#dfeef0' : '#dcebe4';
    var line = tone === 'blue' ? '#4f7d84' : '#4f6f64';
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + (s || 1) + ')">' +
      '<ellipse cx="0" cy="40" rx="15" ry="4" fill="#8a6544" opacity=".14"/>' +
      '<path d="M-8 -24 L8 -24 L8 -16 C8 -10 18 -3 18 12 C18 30 8 40 0 40 C-8 40 -18 30 -18 12 C-18 -3 -8 -10 -8 -16 Z" fill="' + fill + '" stroke="' + line + '" stroke-width="1.2"/>' +
      '<ellipse cx="0" cy="-24" rx="8" ry="2.6" fill="' + fill + '" stroke="' + line + '" stroke-width="1"/>' +
      '<path d="M-13 4 Q0 0 13 4 M-16 20 Q0 14 16 20" fill="none" stroke="' + line + '" stroke-opacity=".55" stroke-width=".9"/>' +
      '<path d="M-7 -2 q4 -4 7 0 q3 4 7 0" fill="none" stroke="' + line + '" stroke-opacity=".7" stroke-width="1"/>' +
      '</g>';
  }

  function lndTeaPot(x, y, s) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + (s || 1) + ')">' +
      '<ellipse cx="0" cy="10" rx="16" ry="4" fill="#8a6544" opacity=".16"/>' +
      '<path d="M-13 0 C-15 9 -8 14 0 14 C8 14 15 9 13 0 C11 -6 -11 -6 -13 0 Z" fill="#dcebe4" stroke="#4f6f64" stroke-width="1.2"/>' +
      '<path d="M12 2 Q21 2 21 -6" fill="none" stroke="#4f6f64" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M-13 2 Q-21 2 -19 -4" fill="none" stroke="#4f6f64" stroke-width="2.4" stroke-linecap="round"/>' +
      '<ellipse cx="0" cy="-5" rx="7.5" ry="2.6" fill="#b9d2c9" stroke="#4f6f64" stroke-width=".9"/>' +
      '<circle cx="0" cy="-8" r="1.7" fill="#b03f2c"/>' +
      '<path d="M-6 2 Q0 -1 6 2" stroke="#5e8388" stroke-opacity=".55" stroke-width="1" fill="none"/>' +
      '</g>';
  }

  function lndSilkBolt(x, y, s, color, rot) {
    return '<g transform="translate(' + x + ' ' + y + ') rotate(' + (rot || 0) + ') scale(' + (s || 1) + ')">' +
      '<rect x="-20" y="-7" width="40" height="14" rx="7" fill="' + color + '" stroke="#6f2b1f" stroke-opacity=".45" stroke-width=".9"/>' +
      '<ellipse cx="-20" cy="0" rx="4" ry="7" fill="#f3e6cd" stroke="#8a6544" stroke-width=".8"/>' +
      '<ellipse cx="20" cy="0" rx="4" ry="7" fill="#f3e6cd" stroke="#8a6544" stroke-width=".8"/>' +
      '<path d="M-12 -4 Q0 -7 12 -4 M-12 4 Q0 7 12 4" stroke="#fff" stroke-opacity=".28" stroke-width="1.2" fill="none"/>' +
      '</g>';
  }

  function lndHzWalkerHTML(cls) {
    return '<g class="lnd-hz-walker' + (cls ? ' ' + cls : '') + '">' +
      '<ellipse cx="0" cy="0" rx="4.4" ry="1.3" fill="#5a4630" opacity=".26"/>' +
      '<path d="M-3.4 0 L-2.4 -12 Q0 -13.6 2.4 -12 L3.4 0 Z" fill="#6b5a45"/>' +
      '<path d="M-2.2 -11 Q-4.6 -8 -4.8 -5" stroke="#6b5a45" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
      '<circle cx="0" cy="-15.2" r="2.5" fill="#6b5a45"/>' +
      '<path d="M-3.7 -16.6 H3.7" stroke="#4a3a28" stroke-width="1.3" stroke-linecap="round"/>' +
      '</g>';
  }

  function lndHzBoatHTML() {
    return '<g class="lnd-hz-boat">' +
      '<path d="M-33 4 Q0 13 33 4 L26 11 Q0 16 -26 11 Z" fill="#6b5a45"/>' +
      '<path d="M-33 4 Q-38 3 -41 -1" stroke="#6b5a45" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
      '<path d="M33 4 Q38 3 41 -1" stroke="#6b5a45" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
      '<path d="M-17 3 Q-13 -9 0 -9 Q13 -9 17 3 Z" fill="#5a4630"/>' +
      '<path d="M-15 2 Q0 6 15 2" stroke="#e8c98c" stroke-opacity=".32" stroke-width="1" fill="none"/>' +
      '<path d="M18 -12 Q22 -15 26 -12 L24 -9 H20 Z" fill="#8a6a42"/>' +
      '<circle cx="22" cy="-7.4" r="2" fill="#5a4630"/>' +
      '<path d="M22 -7 L20 2" stroke="#5a4630" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M26 -1 L44 8" stroke="#7a5634" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M-30 12 Q0 16 30 12" stroke="#5f827c" stroke-opacity=".2" stroke-width="1.4" fill="none"/>' +
      '</g>';
  }

  function lndHzLampHTML(cls) {
    return '<g class="lnd-hz-lamp' + (cls ? ' ' + cls : '') + '">' +
      '<ellipse cx="0" cy="1" rx="6.5" ry="2" fill="#b03f2c" opacity=".3"/>' +
      '<path d="M-5.5 0 Q-4 -4.4 0 -4.4 Q4 -4.4 5.5 0 Z" fill="#e8c98c"/>' +
      '<path d="M-5.5 0 Q0 2.4 5.5 0" stroke="#b03f2c" stroke-width="1.1" fill="none"/>' +
      '<circle cx="0" cy="-5.2" r="1.5" fill="#f6d99a"/>' +
      '</g>';
  }

  function lndHzFlagHTML(x, y, ch, cls) {
    return '<g transform="translate(' + x + ' ' + y + ')">' +
      '<g class="lnd-hz-flag' + (cls ? ' ' + cls : '') + '">' +
      '<path d="M0 0 V-30" stroke="#7a5634" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M0 -28 H15 V-4 H0 Z" fill="#b03f2c" stroke="#6f2b1f" stroke-width=".7"/>' +
      '<text x="7.5" y="-11" text-anchor="middle" font-family="' + LND_SERIF + '" font-size="8.4" font-weight="700" fill="#fdf2d8">' + ch + '</text>' +
      '</g>' +
      '</g>';
  }

  function lndHzDefs(p) {
    return '<defs>' +
      '<linearGradient id="' + p + 'HzSun" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#eab873" stop-opacity=".5"/><stop offset=".5" stop-color="#f0d296" stop-opacity=".16"/><stop offset="1" stop-color="#f0d296" stop-opacity="0"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + p + 'HzRiver" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#9fc4b4" stop-opacity=".62"/><stop offset=".6" stop-color="#a9cbbb" stop-opacity=".4"/><stop offset="1" stop-color="#c6d8cd" stop-opacity=".1"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + p + 'HzHill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#7d987e" stop-opacity=".3"/><stop offset="1" stop-color="#7d987e" stop-opacity="0"/>' +
      '</linearGradient>' +
      '<radialGradient id="' + p + 'HzWinGlow" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0" stop-color="#f4d79a" stop-opacity=".5"/><stop offset="1" stop-color="#f4d79a" stop-opacity="0"/>' +
      '</radialGradient>' +
      '<filter id="' + p + 'HzBlur" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>' +
      '</defs>';
  }

  function lndHzPagodaHTML() {
    return '<g class="lnd-hz-pagoda" opacity=".4" fill="#6b7d66">' +
      '<path d="M196 338 H236 L232 310 H200 Z"/>' +
      '<path d="M188 312 Q216 302 244 312 L240 316 Q216 308 192 316 Z"/>' +
      '<path d="M200 310 H232 L229 286 H203 Z"/>' +
      '<path d="M193 288 Q216 279 239 288 L236 292 Q216 284 196 292 Z"/>' +
      '<path d="M204 286 H228 L226 264 H206 Z"/>' +
      '<path d="M198 266 Q216 258 234 266 L231 270 Q216 263 201 270 Z"/>' +
      '<path d="M208 264 H224 L223 246 H209 Z"/>' +
      '<path d="M202 248 Q216 241 230 248 L228 251 Q216 245 204 251 Z"/>' +
      '<path d="M216 246 V226" stroke="#6b7d66" stroke-width="2"/>' +
      '</g>';
  }

  function lndHzTownHTML(p, shops) {
    shops = shops || 4;
    var body =
      '<path d="M1260 340 V314 H1330 V340 Z"/><path d="M1252 316 L1295 300 L1338 316 L1334 320 L1295 306 L1256 320 Z"/>' +
      '<path d="M1332 340 V302 H1412 V340 Z"/><path d="M1324 304 L1372 284 L1420 304 L1416 309 L1372 291 L1328 309 Z"/>' +
      '<path d="M1414 340 V318 H1472 V340 Z"/><path d="M1406 320 L1443 306 L1480 320 L1476 324 L1443 312 L1410 324 Z"/>';
    var wins =
      '<rect class="lnd-hz-lit" x="1272" y="322" width="7" height="9" rx="1" opacity=".42"/>' +
      '<rect x="1290" y="322" width="7" height="9" rx="1" opacity=".26"/>' +
      '<rect class="lnd-hz-lit lnd-hz-lit--b" x="1348" y="314" width="8" height="10" rx="1" opacity=".48"/>' +
      '<rect x="1368" y="314" width="8" height="10" rx="1" opacity=".3"/>' +
      '<rect x="1390" y="314" width="8" height="10" rx="1" opacity=".24"/>' +
      '<rect class="lnd-hz-lit" x="1432" y="326" width="7" height="8" rx="1" opacity=".36"/>';
    var glow = '<ellipse cx="1352" cy="330" rx="30" ry="10" fill="url(#' + p + 'HzWinGlow)"/>';
    var flags = lndHzFlagHTML(1298, 320, '酒') +
      lndHzFlagHTML(1378, 306, '茶', 'lnd-hz-flag--b') +
      (shops === 3 ? lndHzFlagHTML(1438, 314, '布', 'lnd-hz-flag--c') : lndHzFlagHTML(1490, 310, '布', 'lnd-hz-flag--c'));
    if (shops !== 3) {
      body += '<path d="M1470 340 V306 H1560 V340 Z"/><path d="M1462 308 L1515 288 L1568 308 L1564 313 L1515 295 L1466 313 Z"/>';
      wins += '<rect class="lnd-hz-lit lnd-hz-lit--b" x="1500" y="316" width="8" height="10" rx="1" opacity=".44"/>' +
        '<rect x="1524" y="316" width="8" height="10" rx="1" opacity=".26"/>';
      glow += '<ellipse cx="1504" cy="332" rx="26" ry="9" fill="url(#' + p + 'HzWinGlow)"/>';
    }
    return '<g class="lnd-hz-town" opacity=".36" fill="#6b7d66">' + body + '</g>' +
      '<g class="lnd-hz-wins" fill="#e7b865">' + wins + '</g>' +
      '<g class="lnd-hz-glow" opacity=".5">' + glow + '</g>' + flags;
  }

  function lndHzBridgeHTML() {
    var posts = '';
    var xs = [624, 700, 776, 852, 928, 978];
    var ys = [348, 316, 292, 292, 320, 346];
    for (var i = 0; i < xs.length; i++) {
      posts += '<path d="M' + xs[i] + ' ' + (ys[i] + 4) + ' L' + xs[i] + ' ' + (ys[i] + 26) + '"/>';
    }
    return '<g class="lnd-hz-bridge" opacity=".55">' +
      '<path d="M560 372 Q800 210 1040 372 L1040 386 Q800 232 560 386 Z" fill="#b08a5c"/>' +
      '<path d="M560 372 Q800 210 1040 372" stroke="#8a6a42" stroke-width="2.4"/>' +
      '<path d="M592 356 Q800 218 1008 356" stroke="#8a6a42" stroke-opacity=".5" stroke-width="1.2"/>' +
      '<g stroke="#8a6a42" stroke-width="1.1" opacity=".5">' + posts + '</g>' +
      '</g>';
  }

  function lndHzWillowLeftHTML() {
    return '<g class="lnd-hz-willow-left" opacity=".32" stroke="#5f7a58" stroke-linecap="round">' +
      '<path d="M36 460 C 44 404 40 356 56 314" stroke-width="5" stroke="#5a4630" opacity=".8"/>' +
      '<path d="M56 320 C 30 330 18 350 10 376" stroke-width="1.4"/>' +
      '<path d="M56 320 C 50 350 46 380 48 414" stroke-width="1.4"/>' +
      '<path d="M58 318 C 76 340 86 366 92 396" stroke-width="1.4"/>' +
      '<path d="M58 318 C 90 326 110 342 122 364" stroke-width="1.4"/>' +
      '<g stroke="none" fill="#6f8f5f" opacity=".5">' +
      '<ellipse cx="16" cy="362" rx="7" ry="3" transform="rotate(-34 16 362)"/>' +
      '<ellipse cx="26" cy="382" rx="7" ry="3" transform="rotate(-18 26 382)"/>' +
      '<ellipse cx="46" cy="396" rx="7" ry="3" transform="rotate(-6 46 396)"/>' +
      '<ellipse cx="70" cy="382" rx="8" ry="3" transform="rotate(24 70 382)"/>' +
      '<ellipse cx="92" cy="362" rx="7" ry="3" transform="rotate(34 92 362)"/>' +
      '<ellipse cx="106" cy="342" rx="7" ry="3" transform="rotate(28 106 342)"/>' +
      '</g>' +
      '</g>';
  }

  function lndHzWillowRightHTML() {
    return '<g class="lnd-hz-willow-right" opacity=".3" stroke="#5f7a58" stroke-linecap="round">' +
      '<path d="M1564 460 C 1556 404 1560 356 1544 314" stroke-width="5" stroke="#5a4630" opacity=".8"/>' +
      '<path d="M1544 320 C 1570 330 1582 350 1590 376" stroke-width="1.4"/>' +
      '<path d="M1544 320 C 1550 350 1554 380 1552 414" stroke-width="1.4"/>' +
      '<path d="M1542 318 C 1524 340 1514 366 1508 396" stroke-width="1.4"/>' +
      '<path d="M1542 318 C 1510 326 1490 342 1478 364" stroke-width="1.4"/>' +
      '<g stroke="none" fill="#6f8f5f" opacity=".5">' +
      '<ellipse cx="1584" cy="362" rx="7" ry="3" transform="rotate(34 1584 362)"/>' +
      '<ellipse cx="1574" cy="382" rx="7" ry="3" transform="rotate(18 1574 382)"/>' +
      '<ellipse cx="1554" cy="396" rx="7" ry="3" transform="rotate(6 1554 396)"/>' +
      '<ellipse cx="1530" cy="382" rx="8" ry="3" transform="rotate(-24 1530 382)"/>' +
      '<ellipse cx="1508" cy="362" rx="7" ry="3" transform="rotate(-34 1508 362)"/>' +
      '<ellipse cx="1494" cy="342" rx="7" ry="3" transform="rotate(-28 1494 342)"/>' +
      '</g>' +
      '</g>';
  }

  function landingHorizonHTML() {
    return '<svg class="lnd-horizon-svg lnd-horizon-svg--wide" viewBox="0 0 1600 460" preserveAspectRatio="xMidYMax slice" fill="none" aria-hidden="true">' +
      lndHzDefs('lnd') +

      '<circle cx="1330" cy="250" r="86" fill="url(#lndHzSun)"/>' +
      '<circle cx="1330" cy="250" r="17" fill="#e0b070" opacity=".22"/>' +
      '<circle cx="1330" cy="250" r="11" fill="#d99a5a" opacity=".24"/>' +

      '<path d="M0 300 C 160 264 300 282 430 292 C 560 302 650 268 790 278 C 930 288 1030 262 1180 276 C 1330 290 1470 272 1600 284 L1600 380 L0 380 Z" fill="url(#lndHzHill)"/>' +
      '<path d="M0 326 C 180 302 320 316 470 322 C 620 328 720 304 880 314 C 1040 324 1160 302 1320 314 C 1440 322 1530 312 1600 318 L1600 390 L0 390 Z" fill="#6f8a72" opacity=".14"/>' +

      '<g class="lnd-mist-a"><ellipse cx="420" cy="332" rx="300" ry="20" fill="#fffaf0" opacity=".5" filter="url(#lndHzBlur)"/></g>' +
      '<g class="lnd-mist-b"><ellipse cx="1120" cy="340" rx="260" ry="16" fill="#fffaf0" opacity=".45" filter="url(#lndHzBlur)"/></g>' +

      '<g class="lnd-hz-cloud lnd-hz-cloud--a" fill="#fffaf0" opacity=".5" filter="url(#lndHzBlur)">' +
      '<ellipse cx="330" cy="236" rx="130" ry="13"/><ellipse cx="412" cy="226" rx="86" ry="10"/>' +
      '</g>' +
      '<g class="lnd-hz-cloud lnd-hz-cloud--b" fill="#fffaf0" opacity=".45" filter="url(#lndHzBlur)">' +
      '<ellipse cx="1230" cy="246" rx="150" ry="12"/><ellipse cx="1320" cy="236" rx="80" ry="9"/>' +
      '</g>' +

      '<g opacity=".42">' +
      '<path d="M0 336 H1600 V352 H0 Z" fill="#c9b48e" opacity=".5"/>' +
      '<path d="M0 336 H1600" stroke="#8f7b58" stroke-width="2"/>' +
      '<path d="M0 330 H1600" stroke="#b5a07a" stroke-width="6" stroke-dasharray="16 22" opacity=".55"/>' +
      '</g>' +

      lndHzPagodaHTML() +
      lndHzTownHTML('lnd') +
      lndHzBridgeHTML() +

      '<g opacity=".75">' +
      '<g transform="translate(560 372)">' + lndHzWalkerHTML('lnd-hz-walker--a') + '</g>' +
      '<g transform="translate(560 372)">' + lndHzWalkerHTML('lnd-hz-walker--b') + '</g>' +
      '<g transform="translate(640 328)">' + lndHzWalkerHTML('lnd-hz-walker--still lnd-hz-walker--still-b') + '</g>' +
      '<g transform="translate(884 299)">' + lndHzWalkerHTML('lnd-hz-walker--still') + '</g>' +
      '</g>' +

      '<path d="M0 372 C 220 360 380 376 560 370 C 800 362 1000 378 1600 366 L1600 460 L0 460 Z" fill="url(#lndHzRiver)"/>' +
      '<g stroke="#fdf6e4" stroke-opacity=".42" stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M640 394 h44"/><path d="M700 406 h32"/><path d="M1150 392 h50"/><path d="M1216 404 h30"/>' +
      '</g>' +
      '<g stroke="#5f827c" stroke-opacity=".18" stroke-width="1.2" stroke-linecap="round">' +
      '<path d="M240 400 q20 -4 40 0"/><path d="M420 420 q22 -4 44 0"/><path d="M920 408 q20 -4 40 0"/><path d="M1360 414 q22 -4 44 0"/>' +
      '</g>' +

      '<g opacity=".78">' +
      '<g transform="translate(700 420) scale(1.06)">' + lndHzBoatHTML() + '</g>' +
      '<g transform="translate(392 432) scale(.7)" opacity=".55">' + lndHzBoatHTML() + '</g>' +
      '<g transform="translate(944 430) scale(.92)">' + lndHzBoatHTML() + '</g>' +
      '</g>' +
      '<g opacity=".72">' +
      '<g transform="translate(760 446)">' + lndHzLampHTML() + '</g>' +
      '<g transform="translate(880 438) scale(.85)">' + lndHzLampHTML('lnd-hz-lamp--b') + '</g>' +
      '<g transform="translate(1010 452) scale(.95)">' + lndHzLampHTML('lnd-hz-lamp--c') + '</g>' +
      '</g>' +
      '<g stroke="#e7b865" stroke-opacity=".15" stroke-linecap="round" stroke-width="3">' +
      '<path d="M1352 374 v9"/><path d="M1504 376 v7"/>' +
      '</g>' +

      lndHzWillowLeftHTML() +
      lndHzWillowRightHTML() +

      '<g class="lnd-hz-birds" stroke="#a08a62" stroke-opacity=".55" stroke-linecap="round">' +
      '<path class="lnd-hz-bird" stroke-width="1.5" d="M236 198 q5 -6.2 10 0 q5 -6.2 10 0"/>' +
      '<path class="lnd-hz-bird lnd-hz-bird--b" stroke-width="1.3" d="M282 184 q4.4 -5.6 8.8 0 q4.4 -5.6 8.8 0"/>' +
      '<path class="lnd-hz-bird lnd-hz-bird--c" stroke-width="1.2" d="M322 202 q4 -5 8 0 q4 -5 8 0"/>' +
      '</g>' +
      '</svg>';
  }

  /* 竖构图长卷：窄屏用，塔 / 酒楼茶楼 / 虹桥 都在画内 */
  function landingHorizonTallHTML() {
    return '<svg class="lnd-horizon-svg lnd-horizon-svg--tall" viewBox="0 0 800 520" preserveAspectRatio="xMidYMax slice" fill="none" aria-hidden="true">' +
      lndHzDefs('m') +

      '<circle cx="600" cy="246" r="82" fill="url(#mHzSun)"/>' +
      '<circle cx="600" cy="246" r="15" fill="#e0b070" opacity=".22"/>' +
      '<circle cx="600" cy="246" r="10" fill="#d99a5a" opacity=".24"/>' +

      '<path d="M0 312 C 90 286 170 296 250 304 C 340 313 400 290 480 298 C 570 307 640 286 730 296 C 760 300 785 298 800 300 L800 392 L0 392 Z" fill="url(#mHzHill)"/>' +
      '<path d="M0 336 C 110 316 200 326 300 330 C 400 334 470 318 570 324 C 670 330 740 316 800 322 L800 400 L0 400 Z" fill="#6f8a72" opacity=".14"/>' +

      '<g class="lnd-mist-a"><ellipse cx="250" cy="342" rx="190" ry="14" fill="#fffaf0" opacity=".5" filter="url(#mHzBlur)"/></g>' +
      '<g class="lnd-mist-b"><ellipse cx="630" cy="346" rx="170" ry="12" fill="#fffaf0" opacity=".45" filter="url(#mHzBlur)"/></g>' +

      '<g class="lnd-hz-cloud lnd-hz-cloud--a" fill="#fffaf0" opacity=".5" filter="url(#mHzBlur)">' +
      '<ellipse cx="238" cy="180" rx="86" ry="10"/><ellipse cx="302" cy="172" rx="58" ry="8"/>' +
      '</g>' +
      '<g class="lnd-hz-cloud lnd-hz-cloud--b" fill="#fffaf0" opacity=".45" filter="url(#mHzBlur)">' +
      '<ellipse cx="552" cy="154" rx="96" ry="9"/><ellipse cx="616" cy="146" rx="54" ry="7"/>' +
      '</g>' +

      '<g opacity=".42">' +
      '<path d="M0 366 H800 V382 H0 Z" fill="#c9b48e" opacity=".5"/>' +
      '<path d="M0 366 H800" stroke="#8f7b58" stroke-width="2"/>' +
      '<path d="M0 360 H800" stroke="#b5a07a" stroke-width="6" stroke-dasharray="14 20" opacity=".55"/>' +
      '</g>' +

      '<g transform="translate(96 366) translate(-188 -338)">' + lndHzPagodaHTML() + '</g>' +
      '<g transform="translate(440 366) scale(1.12) translate(-1252 -340)">' + lndHzTownHTML('m', 3) + '</g>' +
      '<g transform="translate(158 374) scale(.58) translate(-560 -372)">' + lndHzBridgeHTML() + '</g>' +

      '<g opacity=".75">' +
      '<g transform="translate(297 327) scale(.95)">' + lndHzWalkerHTML('lnd-hz-walker--still') + '</g>' +
      '<g transform="translate(236 338) scale(.85)">' + lndHzWalkerHTML('lnd-hz-walker--still lnd-hz-walker--still-b') + '</g>' +
      '<g transform="translate(358 341) scale(.9)">' + lndHzWalkerHTML('lnd-hz-walker--still') + '</g>' +
      '</g>' +

      '<path d="M0 374 C 140 366 250 380 400 374 C 560 367 690 380 800 370 L800 520 L0 520 Z" fill="url(#mHzRiver)"/>' +
      '<g stroke="#fdf6e4" stroke-opacity=".42" stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M300 410 h44"/><path d="M520 404 h34"/><path d="M660 426 h40"/>' +
      '</g>' +
      '<g stroke="#5f827c" stroke-opacity=".18" stroke-width="1.2" stroke-linecap="round">' +
      '<path d="M180 432 q20 -4 40 0"/><path d="M430 444 q22 -4 44 0"/><path d="M620 458 q20 -4 40 0"/>' +
      '</g>' +

      '<g opacity=".78">' +
      '<g transform="translate(330 436) scale(.92)">' + lndHzBoatHTML() + '</g>' +
      '<g transform="translate(556 454) scale(.78)">' + lndHzBoatHTML() + '</g>' +
      '<g transform="translate(168 462) scale(.55)" opacity=".55">' + lndHzBoatHTML() + '</g>' +
      '</g>' +
      '<g opacity=".72">' +
      '<g transform="translate(420 470)">' + lndHzLampHTML() + '</g>' +
      '<g transform="translate(492 460) scale(.85)">' + lndHzLampHTML('lnd-hz-lamp--b') + '</g>' +
      '<g transform="translate(640 480) scale(.95)">' + lndHzLampHTML('lnd-hz-lamp--c') + '</g>' +
      '</g>' +
      '<g stroke="#e7b865" stroke-opacity=".15" stroke-linecap="round" stroke-width="3">' +
      '<path d="M596 380 v9"/><path d="M668 382 v7"/>' +
      '</g>' +

      '<g transform="translate(26 520) scale(.92) translate(-56 -460)">' + lndHzWillowLeftHTML() + '</g>' +
      '<g transform="translate(796 520) scale(.92) translate(-1564 -460)">' + lndHzWillowRightHTML() + '</g>' +

      '<g class="lnd-hz-birds" stroke="#a08a62" stroke-opacity=".55" stroke-linecap="round">' +
      '<path class="lnd-hz-bird" stroke-width="1.5" d="M206 176 q4.6 -5.8 9.2 0 q4.6 -5.8 9.2 0"/>' +
      '<path class="lnd-hz-bird lnd-hz-bird--b" stroke-width="1.3" d="M250 162 q4.2 -5.2 8.4 0 q4.2 -5.2 8.4 0"/>' +
      '<path class="lnd-hz-bird lnd-hz-bird--c" stroke-width="1.2" d="M288 180 q3.8 -4.8 7.6 0 q3.8 -4.8 7.6 0"/>' +
      '</g>' +
      '</svg>';
  }

  function landingPropsHTML() {
    return '' +

      /* 钱串 */
      '<svg class="lnd-prop lnd-prop--coin" viewBox="0 0 140 210" aria-hidden="true">' +
      '<defs><radialGradient id="lndPropCoin" cx="36%" cy="30%" r="76%"><stop offset="0" stop-color="#f0d79a"/><stop offset=".55" stop-color="#d8ae62"/><stop offset="1" stop-color="#9a6a2e"/></radialGradient></defs>' +
      '<path d="M70 8 V186" stroke="#a9513b" stroke-width="2.2" stroke-linecap="round" opacity=".75"/>' +
      '<g transform="rotate(-8 70 74)"><circle cx="70" cy="74" r="30" fill="url(#lndPropCoin)" stroke="#8a5f2a" stroke-width="2.4"/><circle cx="70" cy="74" r="23" fill="none" stroke="#f4dda6" stroke-width="1.6" opacity=".7"/><rect x="60" y="64" width="20" height="20" rx="2.5" fill="#8a5f2a"/><circle cx="56" cy="56" r="4" fill="#fff" opacity=".4"/></g>' +
      '<g transform="rotate(7 70 126)"><circle cx="70" cy="126" r="26" fill="url(#lndPropCoin)" stroke="#8a5f2a" stroke-width="2.2"/><rect x="61" y="117" width="18" height="18" rx="2" fill="#8a5f2a"/><circle cx="58" cy="112" r="3.4" fill="#fff" opacity=".36"/></g>' +
      '<g transform="rotate(-5 70 170)"><circle cx="70" cy="170" r="21" fill="url(#lndPropCoin)" stroke="#8a5f2a" stroke-width="2"/><rect x="63" y="163" width="14" height="14" rx="2" fill="#8a5f2a"/></g>' +
      '<path d="M70 190 V198" stroke="#a9513b" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M70 197 C64 203 58 207 52 208 M70 197 C76 203 82 207 88 208" stroke="#a9513b" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>' +

      /* 纸鸢 */
      '<svg class="lnd-prop lnd-prop--kite" viewBox="0 0 120 170" aria-hidden="true">' +
      '<path d="M60 14 L98 54 L60 94 L22 54 Z" fill="#bf5f45" stroke="#6f2b1f" stroke-width="1.6"/>' +
      '<path d="M60 14 V94 M22 54 H98" stroke="#f3e6cd" stroke-opacity=".6" stroke-width="1.4"/>' +
      '<path d="M60 94 C56 116 66 128 60 150" stroke="#8a6544" stroke-width="1.3"/>' +
      '<path d="M57 108 L48 104 M63 122 L72 118" stroke="#b03f2c" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M60 150 C58 158 61 164 60 168" stroke="#8a6544" stroke-width="1" opacity=".6"/>' +
      '</svg>' +

      /* 灯笼 */
      '<svg class="lnd-prop lnd-prop--lantern" viewBox="0 0 120 150" aria-hidden="true">' +
      '<path d="M60 0 V44" stroke="#6b5a45" stroke-width="1.6" opacity=".55"/>' +
      lndLantern(60, 76, 2.2) +
      '</svg>' +

      /* 茶壶 */
      '<svg class="lnd-prop lnd-prop--tea" viewBox="0 0 190 170" aria-hidden="true">' +
      '<ellipse cx="95" cy="150" rx="64" ry="8" fill="#8a6544" opacity=".12"/>' +
      '<ellipse cx="95" cy="142" rx="54" ry="12" fill="#f6ebd6" stroke="#b98a45" stroke-width="1.4"/>' +
      lndTeaPot(88, 120, 2.05) +
      '<g class="lnd-steam" stroke="#b9a88c" stroke-linecap="round">' +
      '<path d="M74 96 Q68 84 74 72" stroke-width="2.2" opacity=".55"/>' +
      '<path d="M88 92 Q94 78 88 64" stroke-width="2" opacity=".4"/>' +
      '</g>' +
      '<ellipse cx="146" cy="136" rx="10" ry="3.4" fill="#e6f1ec" stroke="#4f6f64" stroke-width="1"/>' +
      '<ellipse cx="160" cy="140" rx="8" ry="3" fill="#e6f1ec" stroke="#4f6f64" stroke-width="1"/>' +
      '</svg>' +

      '<svg class="lnd-spark lnd-spark--1" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 14.4 9.6 22.5 12 14.4 14.4 12 22.5 9.6 14.4 1.5 12 9.6 9.6Z" fill="#d8ae62" stroke="#8a5f2a" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
      '<svg class="lnd-spark lnd-spark--2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 14.4 9.6 22.5 12 14.4 14.4 12 22.5 9.6 14.4 1.5 12 9.6 9.6Z" fill="#f3e6cd" stroke="#b98a45" stroke-width="1.4" stroke-linejoin="round"/></svg>' +
      '<svg class="lnd-spark lnd-spark--3" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="#b03f2c" opacity=".7"/></svg>' +
      '<svg class="lnd-spark lnd-spark--4" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="#d8ae62" opacity=".75"/></svg>';
  }

  function landingShoresHTML() {
    return '' +
      /* 近岸：左芦苇坡 */
      '<svg class="lnd-shore lnd-shore--l" viewBox="0 0 300 150" preserveAspectRatio="xMinYMax meet" aria-hidden="true">' +
      '<path d="M-8 150 V88 H58 C 96 92 130 110 166 128 C 196 143 232 149 268 150 Z" fill="#7f9375" opacity=".2"/>' +
      '<path d="M-8 88 H58 C 96 92 130 110 166 128 C 196 143 232 149 268 150" stroke="#6f8266" stroke-opacity=".3" stroke-width="1.6" fill="none"/>' +
      '<g stroke="#5f7a58" stroke-linecap="round" fill="none" opacity=".4">' +
      '<path d="M14 88 C 9 64 16 46 24 30" stroke-width="2.4"/>' +
      '<path d="M30 88 C 31 62 39 45 50 31" stroke-width="2.2"/>' +
      '<path d="M45 88 C 50 68 59 55 72 45" stroke-width="2"/>' +
      '<path d="M56 88 C 66 74 80 66 96 61" stroke-width="1.7"/>' +
      '</g>' +
      '<g fill="#5f7a58" opacity=".34">' +
      '<ellipse cx="24" cy="26" rx="2.6" ry="7" transform="rotate(-12 24 26)"/>' +
      '<ellipse cx="51" cy="27" rx="2.4" ry="6.4" transform="rotate(8 51 27)"/>' +
      '<ellipse cx="74" cy="42" rx="2.2" ry="5.6" transform="rotate(22 74 42)"/>' +
      '<ellipse cx="98" cy="59" rx="2" ry="5" transform="rotate(34 98 59)"/>' +
      '</g>' +
      '<path d="M86 132 q14 -8 28 -1 q-12 9 -28 1 Z" fill="#6f8266" opacity=".3"/>' +
      '<g fill="#6f8f5f" opacity=".36">' +
      '<ellipse cx="132" cy="138" rx="19" ry="5.6"/>' +
      '<ellipse cx="164" cy="146" rx="13" ry="4"/>' +
      '<ellipse cx="196" cy="149" rx="9" ry="3"/>' +
      '</g>' +
      '</svg>' +
      /* 近岸：右石阶与酒坛货箱 */
      '<svg class="lnd-shore lnd-shore--r" viewBox="0 0 300 150" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">' +
      '<path d="M308 150 V88 H236 C 200 92 168 110 132 128 C 102 143 66 149 30 150 Z" fill="#7f9375" opacity=".2"/>' +
      '<path d="M308 88 H236 C 200 92 168 110 132 128 C 102 143 66 149 30 150" stroke="#6f8266" stroke-opacity=".3" stroke-width="1.6" fill="none"/>' +
      '<g opacity=".34">' +
      '<rect x="230" y="72" width="34" height="17" rx="2" fill="#8a6a44" stroke="#6b4f31" stroke-width="1.2"/>' +
      '<path d="M231 76 H263 M231 85 H263 M241 73 V88 M254 73 V88" stroke="#6b4f31" stroke-width="1" opacity=".7"/>' +
      '</g>' +
      '<g transform="translate(276 88) scale(.95)" opacity=".42">' +
      '<ellipse cx="0" cy="4" rx="13" ry="4" fill="#5a4630" opacity=".2"/>' +
      '<path d="M-10 -10 C-14 -2 -15 2 0 6 C15 2 14 -2 10 -10 Z" fill="#8a5a34" stroke="#5a3a20" stroke-width="1.1"/>' +
      '<path d="M-10 -10 H10" stroke="#5a3a20" stroke-width="1.6"/>' +
      '<path d="M-6 -15 H6 L8 -10 H-8 Z" fill="#c2604a" stroke="#7a3124" stroke-width="1"/>' +
      '</g>' +
      '<g stroke="#5f7a58" stroke-linecap="round" fill="none" opacity=".4">' +
      '<path d="M292 88 C 296 64 289 46 281 32" stroke-width="2.4"/>' +
      '<path d="M276 88 C 275 62 267 46 256 33" stroke-width="2.2"/>' +
      '<path d="M262 88 C 257 68 248 56 236 47" stroke-width="1.9"/>' +
      '</g>' +
      '<g fill="#5f7a58" opacity=".34">' +
      '<ellipse cx="281" cy="28" rx="2.6" ry="7" transform="rotate(12 281 28)"/>' +
      '<ellipse cx="255" cy="29" rx="2.4" ry="6.4" transform="rotate(-8 255 29)"/>' +
      '<ellipse cx="234" cy="44" rx="2.2" ry="5.6" transform="rotate(-22 234 44)"/>' +
      '</g>' +
      '<g fill="#6f8f5f" opacity=".36">' +
      '<ellipse cx="176" cy="138" rx="17" ry="5.2"/>' +
      '<ellipse cx="146" cy="147" rx="11" ry="3.6"/>' +
      '</g>' +
      '</svg>';
  }

  function lndDeedIcon(kind) {
    if (kind === 'land') {
      return '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">' +
        '<path d="M9 51 H55" stroke="#6d5d49" stroke-width="1.8" stroke-linecap="round" opacity=".5"/>' +
        '<path d="M14 51 V37 M50 51 V37" stroke="#8a6544" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M14 39 C24 44 40 44 50 39" stroke="#b98a45" stroke-width="1.4" stroke-dasharray="3 3"/>' +
        '<path d="M27 51 V37 L32 32 L37 37 V51 Z" fill="#f6ebd6" stroke="#8a6544" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<path d="M30 41 H34" stroke="#a9513b" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M21 51 q2 -6 0 -10 M43 51 q-2 -6 0 -10" stroke="#5d7d58" stroke-width="1.4" stroke-linecap="round"/>' +
        '</svg>';
    }
    if (kind === 'shop') {
      return '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">' +
        '<path d="M11 52 H53" stroke="#6d5d49" stroke-width="1.8" stroke-linecap="round" opacity=".5"/>' +
        '<path d="M17 52 V29 H47 V52" stroke="#6d5d49" stroke-width="1.8"/>' +
        '<path d="M13 29 Q22 17 32 15 Q42 17 51 29" fill="#f6ebd6" stroke="#8a6544" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<path d="M13 29 Q9 30 7 26 M51 29 Q55 30 57 26" stroke="#8a6544" stroke-width="1.8" stroke-linecap="round"/>' +
        '<path d="M25 52 V41 H39 V52" fill="#f3e6cd" stroke="#8a6544" stroke-width="1.6"/>' +
        '<path d="M28 44 H36" stroke="#b03f2c" stroke-width="1.6" stroke-linecap="round"/>' +
        '<path d="M20 35 H23 M41 35 H44" stroke="#5e8388" stroke-width="1.8" stroke-linecap="round"/>' +
        '<path d="M48 26 V20" stroke="#7a5634" stroke-width="1.6" stroke-linecap="round"/>' +
        '<path d="M48 20 H58 V30 H48 Z" fill="#b03f2c" stroke="#6f2b1f" stroke-width="1"/>' +
        '</svg>';
    }
    return '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">' +
      '<circle cx="23" cy="20" r="6" fill="#f6ebd6" stroke="#6d5d49" stroke-width="1.8"/>' +
      '<path d="M17.5 17.5 H28.5" stroke="#4a3a28" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M13 48 Q13 32 23 32 Q33 32 33 48" fill="#f3e6cd" stroke="#6d5d49" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M23 38 V44" stroke="#a9513b" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M42 50 H59" stroke="#6d5d49" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>' +
      '<path d="M45 42 H55 V45.5 Q55 49.5 50 49.5 Q45 49.5 45 45.5 Z" fill="#e6f1ec" stroke="#4f6f64" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M55.4 43 Q58.8 44 55.4 47" stroke="#4f6f64" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path d="M50 39 q-2.2 -3 0 -6 q2.2 -3 0 -6" stroke="#b9a88c" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>' +
      '</svg>';
  }

  function lndDeedHTML(stamp, icon, title, note) {
    return '<div class="lnd-deed" role="listitem">' +
      '<span class="lnd-deed-icon" aria-hidden="true">' + lndDeedIcon(icon) + '</span>' +
      '<span class="lnd-deed-body"><b><i class="lnd-deed-stamp">' + stamp + '</i>' + title + '</b>' +
      '<small>' + note + '</small></span>' +
      '</div>';
  }

  function renderLanding() {
    destroyDeckSwiper();
    var saved = savedGame();
    landingEl.innerHTML = '' +
      '<div class="landing">' +
      '<div class="lnd-paper" aria-hidden="true"></div>' +
      '<div class="lnd-horizon" aria-hidden="true">' + landingHorizonHTML() + landingHorizonTallHTML() + '</div>' +
      '<div class="lnd-props" aria-hidden="true">' + landingPropsHTML() + landingShoresHTML() + '</div>' +
      '<header class="lnd-top">' +
      '<div class="lnd-brand">' +
      '<span class="lnd-seal" aria-hidden="true">汴</span>' +
      '<span class="lnd-brand-text"><b>大宋百商图</b><small>汴京商街 · 模拟经营</small></span>' +
      '</div>' +
      '<div class="lnd-top-right">' +
      '<span class="lnd-top-meta">1~4 人 · 同屏热座</span>' +
      '<button type="button" class="lnd-rules-btn" data-action="rules">' +
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 5.6A2.6 2.6 0 0 1 7.1 3H11v15.5H7.1a2.6 2.6 0 0 0-2.6 2.6V5.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19.5 5.6A2.6 2.6 0 0 0 16.9 3H13v15.5h3.9a2.6 2.6 0 0 1 2.6 2.6V5.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
      '<span>玩法</span>' +
      '</button>' +
      '</div>' +
      '</header>' +
      '<main class="lnd-main">' +
      '<div class="lnd-content">' +
      '<section class="lnd-copy">' +
      '<p class="lnd-eyebrow">汴京 · 虹桥商街</p>' +
      '<div class="lnd-title-wrap">' +
      '<h1 class="lnd-title">大宋百商图</h1>' +
      '<aside class="lnd-colophon" aria-hidden="true">' +
      '<span class="lnd-colophon-text">汴京风华</span>' +
      '<span class="lnd-colophon-text">百肆争流</span>' +
      '<span class="lnd-colophon-seal">商</span>' +
      '</aside>' +
      '</div>' +
      '<p class="lnd-tagline">清地置业，买菜待客，<br><em>把一条冷清街巷，经营成你的钱袋子。</em></p>' +
      '<div class="lnd-tags">' +
      '<span><b>1~4</b> 人</span><span>同屏轮流</span><span>约 <b>45</b> 分钟</span><span>无需注册</span>' +
      '</div>' +
      '</section>' +
      '<div class="lnd-actions">' +
      '<button type="button" class="lnd-cta" data-action="landing-start">' +
      '<span class="lnd-cta-seal" aria-hidden="true">商</span>' +
      '<span class="lnd-cta-text"><b>' + (saved ? '继续经营' : '开始经营') + '</b></span>' +
      '<span class="lnd-cta-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '</button>' +
      (saved ? '<button type="button" class="lnd-newgame" data-action="landing-new">新开一局</button>' : '') +
      '<div class="lnd-flow" aria-label="一局三步：清地、置业、待客">' +
      '<span class="lnd-flow-label" aria-hidden="true">一局三步 · 白手起家</span>' +
      '<div class="lnd-deeds" role="list">' +
      lndDeedHTML('壹', 'land', '清地', '清出荒地 · 立下标界') +
      lndDeedHTML('贰', 'shop', '置业', '认购店铺 · 挂上招牌') +
      lndDeedHTML('叁', 'guest', '待客', '备好菜式 · 迎来送往') +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</main>' +
      '<footer class="lnd-foot"><span class="lnd-foot-line" aria-hidden="true"></span><span>@imStar100</span><span class="lnd-foot-line" aria-hidden="true"></span></footer>' +
      '</div>';
    landingEl.hidden = false;
    setupEl.hidden = true;
    gameEl.hidden = true;
    document.body.classList.add('is-landing');
  }

  /* ------------------------------ 设置页 ------------------------------ */

/* ------------------------------ 设置页 ------------------------------ */

  function renderSetup() {
    destroyDeckSwiper();
    var c = UI.config;
    var count = c.playerCount;
    var html = '' +
      '<button type="button" class="setup-back" data-action="landing-back"><span aria-hidden="true">‹</span> 首页</button>' +
      '<header class="brand">' +
        '<div class="brand-seal">汴</div>' +
        '<div class="brand-text">' +
          '<p class="eyebrow">汴京 · 虹桥商街</p>' +
          '<h1>大宋百商图</h1>' +
          '<p class="brand-sub">清地、置业、买菜待客，把一条冷清街巷经营成你的钱袋子。</p>' +
        '</div>' +
      '</header>' +

      '<div class="setup-card">' +
        '<section class="setup-block">' +
          '<div class="block-head"><h2>开局玩家</h2><span>同屏轮流操作</span></div>' +
          '<div class="segment" role="group" aria-label="玩家人数">' +
            [1, 2, 3, 4].map(function (n) {
              return '<button type="button" class="seg-btn' + (n === count ? ' active' : '') + '" data-action="player-count" data-count="' + n + '">' + n + ' 人</button>';
            }).join('') +
          '</div>' +
          '<div class="name-grid">' +
            [0, 1, 2, 3].map(function (i) {
              return '<label class="name-field' + (i >= count ? ' hidden' : '') + '">' +
                '<span>玩家 ' + (i + 1) + '</span>' +
                '<input type="text" maxlength="12" data-name="' + i + '" value="' + esc(c.names[i] || '') + '" placeholder="玩家 ' + (i + 1) + '">' +
              '</label>';
            }).join('') +
          '</div>' +
        '</section>' +

        setBlock('resources', '起始资源', '后位玩家多 1 铜钱',
          '<div class="stepper-grid">' +
            stepper('startingCash', '起始铜钱', c.startingCash, 0, 20) +
            stepper('startingLowMenus', '初始四品菜', c.startingLowMenus, 0, 8) +
            stepper('startingMidMenus', '初始三品菜', c.startingMidMenus, 0, 8) +
          '</div>' +
          '<p class="tiny">默认每人 6 张四品菜、2 张三品菜，洗混后放入雅阁。</p>') +

        setBlock('victory', '胜利条件', '同时满足',
          '<div class="stepper-grid two">' +
            stepper('victoryCash', '铜钱数', c.victoryCash, 0, 200) +
            stepper('victoryShops', '房屋数', c.victoryShops, 0, 8) +
          '</div>' +
          '<p class="tiny">任意一项为 0 则不计入；两项都为 0 时按 8 间店铺计算。</p>') +

        '<div class="setup-actions">' +
          '<button type="button" class="btn btn-primary btn-lg" data-action="start">开张营业</button>' +
          '<button type="button" class="btn btn-ghost" data-action="rules">先看规则</button>' +
        '</div>' +
      '</div>' +

      '<p class="setup-foot">本地同屏 · 无需登录 · 1~4 人 · 约 45 分钟</p>' +
      '<div class="setup-cards">' +
        '<div class="setup-tip"><b>一</b><span>清地认购</span><small>土地按顺序清理，清地时从展示区认购店铺。</small></div>' +
        '<div class="setup-tip"><b>二</b><span>买菜待客</span><small>菜品被客人吃掉时产生收益，再用店铺赚第二笔。</small></div>' +
        '<div class="setup-tip"><b>三</b><span>建成商街</span><small>率先凑齐铜钱与店铺数的人赢下汴京。</small></div>' +
      '</div>';

    setupEl.innerHTML = html;
    setupEl.hidden = false;
    gameEl.hidden = true;
    landingEl.hidden = true;
    document.body.classList.remove('is-landing');
  }

  function setBlock(key, title, note, body) {
    var open = !!UI.openBlocks[key];
    return '<section class="setup-block setup-fold' + (open ? ' is-open' : '') + '">' +
      '<div class="block-head">' +
        '<h2>' + title + '</h2>' +
        '<span class="block-note">' + note + '</span>' +
        '<span class="block-summary">' + BLOCK_SUMMARY[key](UI.config) + '</span>' +
        '<button type="button" class="block-edit" data-action="toggle-block" data-block="' + key + '"' +
          ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="block-' + key + '"' +
          ' aria-label="' + (open ? '收起' : '编辑') + title + '">' +
          '<svg class="block-edit-icon block-edit-icon--edit" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
          '<path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5v3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
          '<path d="M14.6 7.4l2.9 2.9" stroke="currentColor" stroke-width="1.7"/></svg>' +
          '<svg class="block-edit-icon block-edit-icon--done" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
          '<path d="M6 14.6l6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="block-body" id="block-' + key + '">' + body + '</div>' +
      '</section>';
  }

  function stepper(field, label, value, min, max) {
    return '<div class="stepper">' +
      '<span class="stepper-label">' + label + '</span>' +
      '<div class="stepper-control">' +
        '<button type="button" data-action="step" data-field="' + field + '" data-delta="-1" aria-label="减少">−</button>' +
        '<input type="number" inputmode="numeric" data-config="' + field + '" value="' + value + '" min="' + min + '" max="' + max + '">' +
        '<button type="button" data-action="step" data-field="' + field + '" data-delta="1" aria-label="增加">+</button>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------ 对局页 ------------------------------ */

  var deckSwiper = null;
  var deckMq = window.matchMedia ? window.matchMedia('(max-width: 920px)') : null;

  function deckTab(index, label) {
    var active = UI.deckIndex === index;
    return '<button type="button" class="deck-tab' + (active ? ' active' : '') + '" data-action="deck-tab" data-deck="' + index + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '" aria-controls="deck-panel-' + index + '"' + (active ? '' : ' tabindex="-1"') + '>' + label + '</button>';
  }

  function syncDeckTabs(index) {
    var tabs = gameEl.querySelectorAll('.deck-tab');
    for (var i = 0; i < tabs.length; i++) {
      var active = i === index;
      tabs[i].classList.toggle('active', active);
      tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
      tabs[i].tabIndex = active ? 0 : -1;
    }
  }

  function destroyDeckSwiper() {
    if (deckSwiper) {
      try { deckSwiper.destroy(true, true); } catch (error) { /* ignore */ }
      deckSwiper = null;
    }
    var clones = gameEl.querySelectorAll('.deck-clone');
    for (var i = 0; i < clones.length; i++) {
      if (clones[i].parentNode) clones[i].parentNode.removeChild(clones[i]);
    }
  }

  function deckClone(slide) {
    var clone = slide.cloneNode(true);
    clone.classList.add('deck-clone');
    clone.removeAttribute('id');
    clone.removeAttribute('role');
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');
    return clone;
  }

  function deckRealIndex(index) {
    return (index + 2) % 3;
  }

  function initDeckSwiper() {
    destroyDeckSwiper();
    var deck = gameEl.querySelector('.deck-swiper');
    if (!deck) return;
    UI.deckIndex = Math.max(0, Math.min(2, UI.deckIndex || 0));
    syncDeckTabs(UI.deckIndex);
    if (!deckMq || !deckMq.matches || !window.Swiper) return;
    var wrapper = deck.querySelector('.swiper-wrapper');
    if (!wrapper || wrapper.children.length !== 3) return;
    var first = wrapper.firstElementChild;
    var last = wrapper.lastElementChild;
    wrapper.insertBefore(deckClone(last), first);
    wrapper.appendChild(deckClone(first));
    deckSwiper = new window.Swiper(deck, {
      slidesPerView: 1,
      spaceBetween: 10,
      autoHeight: true,
      speed: 280,
      initialSlide: UI.deckIndex + 1,
      touchStartPreventDefault: false,
      on: {
        slideChange: function () {
          UI.deckIndex = deckRealIndex(this.realIndex);
          syncDeckTabs(UI.deckIndex);
        },
        slideChangeTransitionEnd: function () {
          if (this.realIndex === 4) this.slideTo(1, 0);
          else if (this.realIndex === 0) this.slideTo(3, 0);
        }
      }
    });
  }

  if (deckMq) {
    var onDeckBreakpoint = function () {
      if (UI.screen === 'game') initDeckSwiper();
    };
    if (deckMq.addEventListener) deckMq.addEventListener('change', onDeckBreakpoint);
    else if (deckMq.addListener) deckMq.addListener(onDeckBreakpoint);
  }

  function renderGame() {
    var game = DSM.state;
    if (!game) { UI.screen = 'setup'; renderSetup(); return; }
    destroyDeckSwiper();
    var p = game.players[game.currentPlayerIndex];
    var phase = game.phase;
    var next = DSM.nextClearableLand(p);
    var buildable = DSM.canBuild(p);
    var builtShopIds = DSM.builtShopIds(p);
    var preview = phase === 'phase3' ? DSM.previewServe() : null;

    var html = '' +
      '<header class="topbar">' +
        '<button type="button" class="back-btn" data-action="game-home" aria-label="返回首页">‹</button>' +
        '<div class="top-title">' +
          '<h1>大宋百商图</h1>' +
          '<p>第 <b>' + game.round + '</b> 轮 · <b>' + esc(p.name) + '</b> 的回合</p>' +
        '</div>' +
        '<div class="top-actions">' +
          '<button type="button" class="icon-btn event-btn' + (game.activeEvent ? ' has-active' : '') + '" data-action="events" aria-label="事件回看" title="事件回看">事件' + (game.activeEvent ? '<i class="event-dot"></i>' : '') + '</button>' +
          '<button type="button" class="icon-btn icon-round" data-action="rules" aria-label="玩法规则" title="玩法规则">?</button>' +
          '<button type="button" class="icon-btn icon-round" data-action="restart" aria-label="重开一局" title="重开一局">↻</button>' +
        '</div>' +
      '</header>' +

      '<div class="players-strip" aria-label="玩家列表">' +
        game.players.map(function (item, index) {
          var active = index === game.currentPlayerIndex;
          return '<button type="button" class="player-chip' + (active ? ' active' : '') + '" data-action="inspect-player" data-id="' + item.id + '">' +
            '<span class="chip-seal">' + (index + 1) + '</span>' +
            '<span class="chip-body"><b>' + esc(item.name) + '</b><small>' + coin(11) + item.cash + ' · ' + DSM.countBuiltShops(item) + ' 店</small></span>' +
            (active ? '<span class="chip-turn">行动中</span>' : '') +
          '</button>';
        }).join('') +
      '</div>' +

      '<div class="board">' +
        '<section class="panel merchant-panel">' +
          '<div class="panel-head">' +
            '<div class="merchant-id"><span class="seat-seal">' + (game.currentPlayerIndex + 1) + '</span><div><h2>' + esc(p.name) + '</h2><p>第 ' + (game.currentPlayerIndex + 1) + ' 位掌柜</p></div></div>' +
            '<div class="cash-pill">' + coin(18) + '<strong>' + p.cash + '</strong><span>铜钱</span></div>' +
          '</div>' +
          '<div class="resource-row">' +
            resourceCell('雅阁', p.prep.length, compositionText(p.prep), '牌库', 'prep') +
            resourceCell('后厨', p.kitchen.length, compositionText(p.kitchen), '弃牌堆', 'kitchen') +
          '</div>' +
          '<div class="sub-head"><h3>自家地契</h3><span>' + (next ? '下一块：第 ' + next.index + ' 块 · 清地 ' + next.clearCost + ' 铜钱' : '八块地已全部清理') + '</span></div>' +
          '<div class="land-grid">' +
            p.lands.map(function (land, index) {
              return landTile(land, index, next);
            }).join('') +
          '</div>' +
        '</section>' +

        '<div class="info-deck">' +
          '<div class="deck-tabs" role="tablist" aria-label="经营信息">' +
            deckTab(0, '候客区') +
            deckTab(1, '店铺展示区') +
            deckTab(2, '菜单行情') +
          '</div>' +
          '<div class="right-col deck-swiper swiper">' +
            '<div class="swiper-wrapper">' +
              '<div class="swiper-slide" id="deck-panel-0" role="tabpanel">' +
                '<section class="panel customer-panel">' +
            '<div class="panel-head"><h2>候客区</h2><span class="panel-note">当前客人必招待</span></div>' +
            '<div class="customer-list">' +
              game.customerMarket.map(function (card, index) {
                var customer = DSM.customerById[card.id];
                if (!customer) return '';
                var isCurrent = index === game.focusIndex;
                return '<button type="button" class="customer-card' + (isCurrent ? ' current' : '') + '" data-action="inspect-customer" data-uid="' + card.uid + '" aria-label="第 ' + (index + 1) + ' 位客人 ' + esc(customer.name) + '">' +
                  '<span class="customer-top">' +
                    '<span class="customer-order">' + (index + 1) + '</span>' +
                    (card.tip ? '<span class="tip-badge">' + coin(10) + '+' + card.tip + '</span>' : '') +
                  '</span>' +
                  '<span class="customer-seal">' + sealChar(customer.name) + '</span>' +
                  '<span class="customer-name">' + esc(customer.name) + '</span>' +
                  '<span class="customer-cost">吃 ' + customer.menuCost + ' 道</span>' +
                  '<span class="customer-shops">' + customer.visitShopIds.map(function (id) {
                    var shop = DSM.shopById[id];
                    if (!shop) return '';
                    var name = esc(shop.name);
                    return builtShopIds.indexOf(id) >= 0 ? '<span class="shop-owned">' + name + '</span>' : name;
                  }).join(' · ') + '</span>' +
                '</button>';
              }).join('') +
            '</div>' +
            '<p class="panel-tip">按序号排队，首位必招待；付 1 铜钱可跳过。</p>' +
                '</section>' +
              '</div>' +
              '<div class="swiper-slide" id="deck-panel-1" role="tabpanel">' +
                '<section class="panel shop-panel">' +
            '<div class="panel-head"><h2>店铺展示区</h2><span class="panel-note">清地时认购</span></div>' +
            '<div class="shop-list">' +
              game.shopMarket.map(function (card) {
                var shop = DSM.shopById[card.id];
                if (!shop) return '';
                return '<button type="button" class="shop-card" data-action="inspect-shop" data-uid="' + card.uid + '">' +
                  '<span class="shop-cost">' + coin(11) + shop.buildCost + '</span>' +
                  '<span class="shop-income">' + shopIncomeText(shop) + '</span>' +
                  '<strong class="shop-name">' + esc(shop.name) + '</strong>' +
                  '<span class="shop-extra">' + esc(shopBonusText(shop) || shopEffectText(shop) || '无联动') + '</span>' +
                '</button>';
              }).join('') +
            '</div>' +
          '</section>' +
              '</div>' +
              '<div class="swiper-slide" id="deck-panel-2" role="tabpanel">' +
                '<section class="panel menu-panel">' +
            '<div class="panel-head"><h2>菜单行情</h2><span class="panel-note">四品菜只随事件获得</span></div>' +
            '<div class="menu-list">' +
              DSM.MENU_CARDS.map(function (card) {
                var left = game.menuSupply[card.id] || 0;
                return '<button type="button" class="menu-row" data-action="buy">' +
                  '<span class="rank-seal rank-' + card.rank + '">' + card.rank + '</span>' +
                  '<span class="menu-name">' + card.name + '</span>' +
                  '<span class="menu-left">余 ' + left + '</span>' +
                  '<span class="menu-price">' + (card.purchaseCost == null ? '不可购' : coin(10) + card.purchaseCost) + '</span>' +
                  '<span class="menu-income">' + rankIncome(card) + '</span>' +
                '</button>';
              }).join('') +
            '</div>' +
          '</section>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<section class="log-panel">' +
        '<button type="button" class="log-toggle" data-action="toggle-log"><span>账房记录</span><small>' + (UI.logOpen ? '收起' : '展开') + '</small></button>' +
        '<ul class="log-list' + (UI.logOpen ? '' : ' collapsed') + '">' +
          game.log.slice(0, UI.logOpen ? 16 : 4).map(function (entry) { return '<li>' + esc(entry) + '</li>'; }).join('') +
        '</ul>' +
      '</section>' +

      '<div class="dock">' +
        '<div class="phase-track">' +
          phaseStep(1, '购买', phase === 'phase1') +
          phaseStep(2, '备菜', phase === 'phase2') +
          phaseStep(3, '招待', phase === 'phase3') +
        '</div>' +
        '<p class="dock-hint">' + dockHint(game, p, next, preview) + '</p>' +
        '<div class="dock-actions">' +
          dockActions(game, p, next, buildable, preview) +
        '</div>' +
      '</div>';

    gameEl.innerHTML = html;
    gameEl.hidden = false;
    setupEl.hidden = true;
    landingEl.hidden = true;
    document.body.classList.remove('is-landing');
    if (UI.screen !== 'game') UI.screen = 'game';
    initDeckSwiper();
    setTimeout(scheduleModal, 40);
  }

  function compositionText(menuIds) {
    var comp = DSM.composition(menuIds);
    return comp.list.length ? comp.list.map(function (item) { return item.count + ' ' + item.name; }).join(' · ') : '空';
  }

  function resourceCell(label, value, detail, tag, pile) {
    return '<button type="button" class="res-cell" data-action="inspect-pile" data-pile="' + pile + '" aria-label="查看' + label + '菜品组成">' +
      '<span class="res-top"><span>' + label + '</span><small>' + tag + '</small><strong>' + value + '</strong></span>' +
      '<p>' + esc(detail) + '</p>' +
    '</button>';
  }

  function landTile(land, index, next) {
    var classes = ['land-tile'];
    if (land.shopId) classes.push('built');
    else if (land.cleared) classes.push('reserved');
    else classes.push('uncleared');
    if (next && next.id === land.id && !land.cleared) classes.push('next');
    var shop = DSM.shopById[land.shopId || land.reservedShopId];
    if (shop) classes.push('inspectable');
    var body;
    if (land.shopId) {
      body = '<span class="land-shop">' + esc(shop.name) + '</span><span class="land-note">' + shopIncomeText(shop) + '</span>';
    } else if (land.cleared) {
      body = '<span class="land-shop">' + (shop ? esc(shop.name) : '空地') + '</span>' +
        '<span class="land-note">' + (shop ? '待建 ' + shop.buildCost + ' 铜' : '未认购') + '</span>';
    } else {
      body = '<span class="land-cost">' + (land.clearCost === 0 ? '免费' : '清地 ' + land.clearCost) + '</span>' +
        '<span class="land-note">未清理</span>';
    }
    return '<div class="' + classes.join(' ') + '"' + (shop ? ' data-action="inspect-land" data-land="' + index + '"' : '') + '>' +
      '<span class="land-no">' + CN_NUM[index] + '</span>' +
      (land.shopId ? '<span class="land-house">' + house(20) + '</span>' : '') +
      '<div class="land-body">' + body + '</div>' +
      (land.shopId ? '' : '<span class="land-state">' + (land.cleared ? '认购' : '荒地') + '</span>') +
    '</div>';
  }

  function phaseStep(step, label, active) {
    return '<span class="phase-step' + (active ? ' active' : '') + '"><i>' + step + '</i>' + label + '</span>';
  }

  function dockHint(game, p, next, preview) {
    if (game.phase === 'over') return '本局收官，看看谁先建成商街。';
    if (game.phase === 'turnDone') return '收益已入账，交给下一位掌柜。';
    if (game.phase === 'phase1') {
      if (game.phase1ActionDone) return '购买已完成，还可继续修建店铺。';
      if (!next) return '八块地已清完，可买菜单或直接备菜。';
      return '二选一：买 1 张菜单，或清地认购；修建不占行动。';
    }
    if (game.phase === 'phase2') return '可花 3 铜钱弃 1 张菜，也可直接进入招待。';
    if (game.phase === 'phase3' && preview) {
      return '招待' + preview.customerName + '：吃 ' + preview.menuCost.total + ' 道菜' + (preview.tip ? '，随身 ' + preview.tip + ' 铜' : '') + '。';
    }
    return '';
  }

  function dockActions(game, p, next, buildable, preview) {
    if (game.phase === 'over') {
      return '<button type="button" class="btn btn-primary" data-action="show-result">查看结算</button>';
    }
    if (game.phase === 'turnDone') {
      return '<button type="button" class="btn btn-primary" data-action="next-turn">下一位掌柜</button>';
    }
    if (game.phase === 'phase1') {
      var buyDisabled = game.phase1ActionDone ? ' disabled' : '';
      var clearDisabled = (game.phase1ActionDone || !next || p.cash < next.clearCost) ? ' disabled' : '';
      return '<button type="button" class="btn btn-soft" data-action="buy"' + buyDisabled + '>买菜单</button>' +
        '<button type="button" class="btn btn-soft" data-action="clear"' + clearDisabled + '>清地认购</button>' +
        '<button type="button" class="btn btn-soft" data-action="build"' + (buildable.length ? '' : ' disabled') + '>修建' + (buildable.length ? ' ' + buildable.length : '') + '</button>' +
        '<button type="button" class="btn btn-primary" data-action="advance-2">进入备菜</button>';
    }
    if (game.phase === 'phase2') {
      var discardDisabled = (p.kitchen.length === 0 || p.cash < 3) ? ' disabled' : '';
      return '<button type="button" class="btn btn-soft" data-action="discard"' + discardDisabled + '>花 3 弃菜</button>' +
        '<button type="button" class="btn btn-primary" data-action="advance-3">跳过，进入招待</button>';
    }
    if (game.phase === 'phase3') {
      var visible = Math.min(DSM.marketSize(), game.customerMarket.length);
      var canSkip = game.focusIndex < visible - 1 && p.cash >= 1;
      return '<button type="button" class="btn btn-soft" data-action="skip-customer"' + (canSkip ? '' : ' disabled') + '>付 1 跳过</button>' +
        '<button type="button" class="btn btn-primary" data-action="serve" data-uid="' + (preview ? preview.customerId : '') + '">' + (preview ? '招待 ' + esc(preview.customerName) : '招待客人') + '</button>';
    }
    return '';
  }

  /* ------------------------------ 弹窗 ------------------------------ */

  function openModal(kind, title, body, actions, options) {
    options = options || {};
    UI.modal = kind;
    UI.dismissible = options.dismissible !== false;
    modalRoot.innerHTML = '<div class="sheet' + (options.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">' +
      '<header class="sheet-head">' +
        '<h2 id="sheetTitle">' + title + '</h2>' +
        (UI.dismissible ? '<button type="button" class="sheet-close" data-action="close-modal" aria-label="关闭">×</button>' : '') +
      '</header>' +
      '<div class="sheet-body">' + body + '</div>' +
      (actions ? '<footer class="sheet-actions">' + actions + '</footer>' : '') +
    '</div>';
    modalRoot.hidden = false;
    document.body.classList.add('modal-open');
    if (options.dice) animateDice(modalRoot);
  }

  function closeModal() {
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    UI.modal = null;
    UI.dismissible = false;
    document.body.classList.remove('modal-open');
  }

  function openRules() {
    var flowRows = [
      ['购买', '二选一：买 1 张菜单；或按顺序清 1 块地，并从展示区认购 1 家店铺。', '每回合行动只能二选一；修建已认购的店铺不占行动，铜钱够就能一次修多间。'],
      ['备菜', '可花 3 铜钱从后厨弃 1 张菜，用来精简牌库。', '每回合最多弃 1 张，也可以直接跳过。'],
      ['招待', '招待候客区首位客人，或付 1 铜钱跳过当前客人。', '最后一位客人必须招待；跳过的铜钱留在客人身上，谁招待归谁。'],
      ['交接', '结算收益，客人进弃牌堆，候客区补满，然后交给下一位掌柜。', '所有玩家都行动过一次，即完成一轮。']
    ].map(function (row) {
      return '<tr><td><b>' + row[0] + '</b></td><td>' + row[1] + '</td><td>' + row[2] + '</td></tr>';
    }).join('');

    var settleSteps = [
      '<b>吃菜</b>：客人按牌面吃掉若干张雅阁菜品；雅阁不足时把后厨洗回雅阁继续消耗（每次最多回洗一次）。',
      '<b>菜品收益</b>：被吃掉的菜按品级结算——四品 1、三品 2、二品 3、一品 1 骰 +2 铜钱。',
      '<b>逛店收益</b>：客人会去他能去的每家已建店铺消费；同种店铺每多一间，就多结算一次。',
      '<b>联动与公告</b>：店铺联动加成、长期公告的加减成照常结算。',
      '<b>随身铜钱</b>：之前跳过客人留下的铜钱一并入账。'
    ].map(function (text) { return '<li>' + text + '</li>'; }).join('');

    var menuRows = DSM.MENU_CARDS.map(function (card) {
      return '<tr><td><b>' + card.name + '</b></td><td>' + card.count + ' 张</td><td>' + ruleMenuCost(card) + '</td><td>' + ruleMenuIncome(card) + '</td></tr>';
    }).join('');

    var shopRows = DSM.SHOPS.map(function (shop) {
      return '<tr><td><b>' + esc(shop.name) + '</b></td><td>' + shop.buildCost + ' 铜</td><td>' + ruleShopIncome(shop) + '</td><td>' + ruleShopExtra(shop) + '</td></tr>';
    }).join('');

    var costGroups = {};
    DSM.CUSTOMERS.forEach(function (customer) {
      (costGroups[customer.menuCost] = costGroups[customer.menuCost] || []).push(customer);
    });
    var customerRows = Object.keys(costGroups).sort(function (a, b) { return Number(a) - Number(b); }).map(function (cost) {
      var list = costGroups[cost];
      var groupHead = '<tr class="rule-group"><th colspan="2">吃 ' + cost + ' 道菜 · ' + list.length + ' 位</th></tr>';
      var rows = list.map(function (customer) {
        var shops = customer.visitShopIds.map(function (id) {
          return DSM.shopById[id] ? esc(DSM.shopById[id].name) : '';
        }).filter(Boolean).join('、');
        return '<tr><td><b>' + esc(customer.name) + '</b></td><td>' + shops + '</td></tr>';
      }).join('');
      return groupHead + rows;
    }).join('');

    var eventRows = DSM.EVENTS.map(function (event) {
      return '<tr><td><b>' + esc(event.name) + '</b></td><td class="rule-nowrap">' + (event.eventType === 'persistent' ? '长期公告' : '即时') + '</td>' +
        '<td>' + esc(event.notice) + (event.note ? '<small>' + esc(event.note) + '</small>' : '') + '</td></tr>';
    }).join('');

    var glossary = [
      ['雅阁', '手牌中的菜品区，招待时从这里吃菜。'],
      ['后厨', '新买的菜先放这里；雅阁不足时洗回雅阁，备菜阶段从这里弃菜。'],
      ['候客区', '等待招待的客人队列，默认 4 位，按编号从左往右招待。'],
      ['展示区', '可供认购的店铺牌，固定保留 4 张。'],
      ['认购', '清地时选定的店铺，此时尚未产生收益。'],
      ['修建', '支付建造费把认购的店铺落成，之后才产生收益。'],
      ['联动', '建成某店后，其关联店铺每次结算额外加钱。'],
      ['随身铜钱', '跳过客人留下的 1 铜钱，谁招待这位客人就归谁。'],
      ['清地费', '按地块顺序支付 0 / 2 / 3 / 4 / 7 / 8 / 9 / 10 铜钱，必须从左往右清理。']
    ].map(function (item) {
      return '<p class="rule-term"><b>' + item[0] + '</b>' + item[1] + '</p>';
    }).join('');

    var body = '<div class="rule-book">' +
      '<div class="rule-hero">' +
        '<p class="rule-intro">1~4 位掌柜同屏轮流经营：从一条荒地起步，买菜单、清地置业、招待客人赚取铜钱，率先同时达成「' + victoryLine() + '」的掌柜获胜。</p>' +
        '<div class="rule-chips"><span>1~4 人</span><span>同屏轮流</span><span>约 45 分钟</span></div>' +
        '<p class="rule-note">起始铜钱与菜牌可在设置页调整；第 2 / 3 / 4 位玩家分别多 1 / 2 / 3 铜钱作为后手补偿。</p>' +
      '</div>' +
      ruleSection('壹', '经营流程', '每回合依次经历三个阶段，然后交给下一位掌柜。',
        ruleTable(['阶段', '怎么进行', '要点'], flowRows)) +
      ruleSection('贰', '招待结算', '招待一位客人后，按以下顺序结算收益：',
        '<ol class="rule-steps">' + settleSteps + '</ol>') +
      ruleSection('叁', '菜品卡', '购买阶段花铜钱买入后放入后厨；四品菜不可购买，只能由开局发放或事件获得。',
        ruleTable(['品级', '牌数', '购买价', '单张收益'], menuRows)) +
      ruleSection('肆', '房屋卡', '清地时认购，支付建造费后才落成并产生收益。联动：建成该店后，其列出的店铺每次结算额外加钱，可叠加。',
        ruleTable(['店铺', '建造费', '基础收益', '联动 · 特殊'], shopRows)) +
      ruleSection('伍', '客人卡', '客人只会去下列「已建」店铺消费；没有建成的店铺不结算。',
        ruleTable(['客人', '会去的店铺'], customerRows)) +
      ruleSection('陆', '事件卡', '事件牌混在客人牌堆中，补位抽到即宣读生效。即时事件结算后进弃牌堆；长期公告持续影响全场，直到被新公告替换。',
        ruleTable(['事件', '类型', '效果'], eventRows)) +
      ruleSection('柒', '名词解释', '牌面与流程中出现的说法：',
        '<div class="rule-glossary">' + glossary + '</div>') +
    '</div>';
    openModal('rules', '玩法规则', body, '<button type="button" class="btn btn-primary" data-action="close-modal">知道了</button>', { wide: true });
  }

  function victoryLine() {
    var game = DSM.state;
    var cash = game ? game.victory.cash : UI.config.victoryCash;
    var shops = game ? game.victory.shops : UI.config.victoryShops;
    var parts = [];
    if (cash) parts.push(cash + ' 铜钱');
    if (shops) parts.push(shops + ' 间店铺');
    return parts.join(' + ') || '8 间店铺';
  }

  function openBuyMenu() {
    var game = DSM.state;
    var p = game.players[game.currentPlayerIndex];
    var body = '<p class="modal-lead">每回合限买 1 张，买入后放入后厨。' + (game.phase1ActionDone ? '<b class="warn">本回合购买行动已用。</b>' : '') + '</p>' +
      '<div class="buy-list">' +
        DSM.MENU_CARDS.map(function (card) {
          var left = game.menuSupply[card.id] || 0;
          var unavailable = card.purchaseCost == null;
          var disabled = unavailable || left <= 0 || p.cash < card.purchaseCost || game.phase1ActionDone;
          var reason = unavailable ? '只随事件获得' : left <= 0 ? '已售罄' : p.cash < card.purchaseCost ? '铜钱不足' : '';
          return '<button type="button" class="buy-row' + (disabled ? ' disabled' : '') + '" data-action="do-buy" data-id="' + card.id + '"' + (disabled ? ' disabled' : '') + '>' +
            '<span class="rank-seal rank-' + card.rank + '">' + card.rank + '</span>' +
            '<span class="buy-main"><b>' + card.name + '</b><small>' + rankIncome(card) + ' · 余 ' + left + ' 张</small></span>' +
            '<span class="buy-price">' + (unavailable ? reason : coin(12) + card.purchaseCost) + '</span>' +
          '</button>';
        }).join('') +
      '</div>';
    openModal('buy', '购买菜单', body, '<button type="button" class="btn btn-ghost" data-action="close-modal">算了</button>');
  }

  function openClearFlow() {
    var game = DSM.state;
    var p = game.players[game.currentPlayerIndex];
    var next = DSM.nextClearableLand(p);
    if (!next) { toast('八块地都已清理'); return; }
    if (p.cash < next.clearCost) { toast('铜钱不够支付清地费'); return; }
    var shops = game.shopMarket;
    var body = '<p class="modal-lead">清理第 <b>' + next.index + '</b> 块地，支付 <b>' + next.clearCost + '</b> 铜钱。</p>' +
      '<p class="modal-sub">清地时须从展示区认购一家店铺；认购不额外付费，建造时才付建造费。</p>' +
      (shops.length ? '<div class="reserve-list">' +
        shops.map(function (card) {
          var shop = DSM.shopById[card.id];
          return '<button type="button" class="reserve-row" data-action="reserve-shop" data-uid="' + card.uid + '">' +
            '<span class="reserve-name"><b>' + esc(shop.name) + '</b><small>' + shopIncomeText(shop) + (shopBonusText(shop) ? ' · ' + esc(shopBonusText(shop)) : '') + '</small></span>' +
            '<span class="reserve-cost">建 ' + shop.buildCost + coin(11) + '</span>' +
          '</button>';
        }).join('') + '</div>' :
        '<p class="empty-note">展示区暂时没有店铺，只能先清地。</p>') +
      '<p class="tiny">认购的店铺留在土地上，可等到铜钱足够时再修建。</p>';
    openModal('clear', '清地认购', body, shops.length
      ? '<button type="button" class="btn btn-ghost" data-action="close-modal">算了</button>'
      : '<button type="button" class="btn btn-ghost" data-action="reserve-none">只清地</button>');
  }

  function openBuild() {
    var game = DSM.state;
    var p = game.players[game.currentPlayerIndex];
    var lands = DSM.canBuild(p);
    if (!lands.length) { toast('没有待修建的店铺'); return; }
    var body = '<p class="modal-lead">修建不占用本回合购买行动，可一次修任意多间。</p><div class="build-list">' +
      lands.map(function (land) {
        var shop = DSM.shopById[land.reservedShopId];
        var can = p.cash >= shop.buildCost;
        return '<button type="button" class="build-item' + (can ? '' : ' disabled') + '" data-action="do-build" data-land="' + land.id + '"' + (can ? '' : ' disabled') + '>' +
          '<span class="build-land">第 ' + Number(land.id.replace('land_', '')) + ' 块地</span>' +
          '<span class="build-main"><b>' + esc(shop.name) + '</b><small>' + shopIncomeText(shop) + (shopBonusText(shop) ? ' · ' + esc(shopBonusText(shop)) : '') + '</small></span>' +
          '<span class="build-cost">' + (can ? coin(12) + shop.buildCost : '铜钱不足') + '</span>' +
        '</button>';
      }).join('') + '</div>';
    openModal('build', '修建店铺', body, '<button type="button" class="btn btn-ghost" data-action="close-modal">稍后再建</button>');
  }

  function openDiscard() {
    var game = DSM.state;
    var p = game.players[game.currentPlayerIndex];
    var groups = {};
    var order = [];
    p.kitchen.forEach(function (menuId) {
      if (!groups[menuId]) { groups[menuId] = 0; order.push(menuId); }
      groups[menuId] += 1;
    });
    var body = '<p class="modal-lead">花 <b>3</b> 铜钱从后厨弃掉 1 张菜，本回合只能弃一次。</p>' +
      '<div class="discard-list">' +
        order.map(function (menuId) {
          var card = DSM.menuById[menuId];
          return '<button type="button" class="discard-row" data-action="do-discard" data-id="' + menuId + '">' +
            '<span class="rank-seal rank-' + card.rank + '">' + card.rank + '</span>' +
            '<span class="buy-main"><b>' + card.name + '</b><small>后厨有 ' + groups[menuId] + ' 张</small></span>' +
            '<span class="discard-cost">弃 1 张</span>' +
          '</button>';
        }).join('') +
      '</div>';
    openModal('discard', '备菜弃牌', body, '<button type="button" class="btn btn-ghost" data-action="close-modal">不弃了</button>');
  }

  function openPile(kind) {
    var game = DSM.state;
    if (!game) return;
    var p = game.players[game.currentPlayerIndex];
    var isPrep = kind !== 'kitchen';
    var cards = isPrep ? p.prep : p.kitchen;
    var comp = DSM.composition(cards);
    var body = '<p class="modal-lead">' + (isPrep
        ? '雅阁是招待客人时吃菜的牌库，吃空后会把后厨的菜洗回雅阁。'
        : '新买的菜先放入后厨；雅阁不足时会洗回雅阁，备菜阶段也可花 3 铜钱从这里弃菜。') + '</p>' +
      '<div class="pile-summary">共 <b>' + comp.total + '</b> 张菜品</div>' +
      '<div class="pile-list">' +
        (comp.list.length ? comp.list.map(function (item) {
          var card = DSM.menuById['dish_rank_' + item.rank];
          return '<div class="pile-row">' +
            '<span class="rank-seal rank-' + item.rank + '">' + item.rank + '</span>' +
            '<span class="pile-main"><b>' + card.name + '</b><small>' + rankIncome(card) + '</small></span>' +
            '<span class="pile-count">' + item.count + ' 张</span>' +
          '</div>';
        }).join('') : '<p class="empty-note">这里还没有菜品。</p>') +
      '</div>';
    openModal('pile', isPrep ? '雅阁' : '后厨', body, '<button type="button" class="btn btn-ghost" data-action="close-modal">收起</button>');
  }

  function openServeChoice(preview) {
    var body = '<p class="modal-lead">【门可罗雀】生效中：' + esc(preview.customerName) + ' 只会去其中一家店铺消费。</p>' +
      '<div class="reserve-list">' +
        preview.uniqueVisits.map(function (shopId) {
          var shop = DSM.shopById[shopId];
          return '<button type="button" class="reserve-row" data-action="serve-shop" data-shop="' + shopId + '">' +
            '<span class="reserve-name"><b>' + esc(shop.name) + '</b><small>' + shopIncomeText(shop) + '</small></span>' +
            '<span class="reserve-cost">选它</span>' +
          '</button>';
        }).join('') +
      '</div>';
    openModal('serve-choice', '选择生效店铺', body, '');
  }

  function openSummary(summary) {
    var diceHtml = '';
    var allDice = (summary.menuDice || []).concat((summary.shopResults || []).reduce(function (list, item) { return list.concat(item.dice || []); }, []));
    if (allDice.length) {
      diceHtml = '<div class="dice-row">' + allDice.map(function (die) {
        return '<span class="die" data-face="' + die.value + '">' + die.value + '</span><span class="die-label">' + esc(die.label) + '</span>';
      }).join('') + '</div>';
    }
    var breakdown = (summary.menuParts || []).map(function (part) {
      return '<li><span>' + esc(part.label) + '</span><b>+' + part.value + '</b></li>';
    }).concat((summary.menuDice || []).map(function (die) {
      var rollText = die.bonus ? '骰 ' + die.roll + ' + ' + die.bonus : '骰 ' + die.roll;
      return '<li><span>' + esc(die.label) + '（' + rollText + '）</span><b>+' + die.value + '</b></li>';
    })).concat((summary.shopResults || []).map(function (item) {
      return '<li class="shop-break"><span>' + esc(item.shopName) + ' ' + item.parts.map(function (p) { return esc(p.label) + '+' + p.value; }).join('、') + '</span><b>+' + item.total + '</b></li>';
    })).concat(summary.tip ? ['<li><span>随身</span><b>+' + summary.tip + '</b></li>'] : []).join('');

    var body = '' +
      '<div class="summary-hero">' +
        '<span class="summary-customer">' + esc(summary.customerName) + ' 的消费</span>' +
        '<strong>+' + summary.total + ' ' + coin(20) + '</strong>' +
        '<small>' + summary.cashBefore + ' → ' + summary.cashAfter + ' 铜钱</small>' +
      '</div>' +
      diceHtml +
      '<div class="summary-grid">' +
        '<div><span>吃菜</span><b>' + summary.spentCount + ' / ' + summary.cost.total + ' 道</b></div>' +
        '<div><span>菜品</span><b>+' + summary.menuIncome + '</b></div>' +
        '<div><span>店铺</span><b>+' + summary.shopIncome + '</b></div>' +
        '<div><span>随身</span><b>+' + summary.tip + '</b></div>' +
      '</div>' +
      (summary.missed ? '<p class="warn">雅阁与后厨菜不够，少吃了 ' + summary.missed + ' 道。</p>' : '') +
      (breakdown ? '<details class="breakdown"><summary>收益明细</summary><ul>' + breakdown + '</ul></details>' : '') +
      '<p class="summary-total">合计入账 <b>' + summary.total + '</b> 铜钱</p>';
    openModal('summary', '招待结算', body, '<button type="button" class="btn btn-primary" data-action="next-turn">下一位掌柜</button>', { dismissible: false, dice: true });
    UI.summaryShown = summary.id;
  }

  function openEvent() {
    var game = DSM.state;
    if (!game.eventQueue.length) { UI.eventOpen = false; return; }
    var event = game.eventQueue[0];
    UI.eventOpen = true;
    var remaining = game.eventQueue.length - 1;
    var body = '<div class="event-banner ' + (event.eventType === 'persistent' ? 'persistent' : 'instant') + '">' +
        '<span class="event-type">' + (event.eventType === 'persistent' ? '长期公告' : '即时事件') + '</span>' +
        '<h3>' + esc(event.name) + '</h3>' +
        '<p>' + esc(event.notice) + '</p>' +
        (event.note ? '<small>' + esc(event.note) + '</small>' : '') +
      '</div>' +
      '<p class="event-applied">此事件已经生效，可在顶栏「事件」中回看。</p>';
    openModal('event', '接旨', body, '<button type="button" class="btn btn-primary" data-action="ack-event">接旨' + (remaining > 0 ? '（还有 ' + remaining + ' 张）' : '') + '</button>', { dismissible: false });
  }

  function openEvents() {
    var game = DSM.state;
    if (!game) return;
    var active = game.activeEvent;
    var history = (game.eventHistory || []).slice().reverse();
    var body = '<div class="event-active">' +
        '<div class="panel-head"><h2>当前公告</h2><span class="panel-note">' + (active ? '持续生效' : '无') + '</span></div>' +
        (active
          ? '<div class="event-banner persistent compact">' +
              '<span class="event-type">长期公告</span>' +
              '<h3>' + esc(active.name) + '</h3>' +
              '<p>' + esc(active.notice) + '</p>' +
              (active.note ? '<small>' + esc(active.note) + '</small>' : '') +
            '</div>'
          : '<p class="empty-note">当前没有生效的长期公告。</p>') +
      '</div>' +
      '<div class="panel-head event-history-head"><h2>本局事件</h2><span class="panel-note">共 ' + history.length + ' 张</span></div>' +
      (history.length
        ? '<div class="event-history">' + history.map(function (item) {
            return '<div class="event-row">' +
              '<div class="event-row-head">' +
                '<span class="event-type' + (item.eventType === 'persistent' ? ' persistent' : '') + '">' + (item.eventType === 'persistent' ? '长期' : '即时') + '</span>' +
                '<b>' + esc(item.name) + '</b>' +
                '<small>第 ' + item.round + ' 轮</small>' +
              '</div>' +
              '<p>' + esc(item.notice) + '</p>' +
              (item.note ? '<small>' + esc(item.note) + '</small>' : '') +
            '</div>';
          }).join('') + '</div>'
        : '<p class="empty-note">本局还没有触发过事件。</p>');
    openModal('events', '事件回看', body, '<button type="button" class="btn btn-primary" data-action="close-modal">知道了</button>');
  }

  function openResult() {
    var game = DSM.state;
    var ranked = DSM.ranking();
    var winner = ranked[0];
    var body = '<div class="result-crown">' + (winner ? '<span class="crown-seal">' + (winner.name || '商').slice(0, 1) + '</span>' : '') + '</div>' +
      '<p class="result-title">' + (winner ? esc(winner.name) + ' 建成了汴京最旺的商街' : '本局结束') + '</p>' +
      '<p class="result-sub">胜利条件：' + victoryLine() + '</p>' +
      '<div class="rank-list">' +
        ranked.map(function (item, index) {
          return '<div class="rank-row' + (index === 0 ? ' winner' : '') + '">' +
            '<span class="rank-no">' + item.rank + '</span>' +
            '<span class="rank-name">' + esc(item.name) + '</span>' +
            '<span class="rank-stats">' + coin(12) + item.cash + ' · ' + house(14) + item.shops + ' 店</span>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="fireworks" aria-hidden="true">' + Array.from({ length: 10 }).map(function (_, index) {
        return '<i style="--i:' + index + '"></i>';
      }).join('') + '</div>';
    openModal('result', '结算', body,
      '<button type="button" class="btn btn-primary" data-action="play-again">再来一局</button>' +
      '<button type="button" class="btn btn-ghost" data-action="game-home">返回首页</button>', { dismissible: false });
    UI.resultShown = true;
  }

  function openPlayer(id) {
    var game = DSM.state;
    var p = game.players.filter(function (item) { return item.id === id; })[0];
    if (!p) return;
    var body = '<div class="player-detail-head"><span class="seat-seal">' + p.seat + '</span><div><h3>' + esc(p.name) + '</h3><p>' + coin(13) + ' ' + p.cash + ' 铜钱 · ' + DSM.countBuiltShops(p) + ' 间店铺</p></div></div>' +
      '<div class="mini-res">' +
        '<span>雅阁 <b>' + p.prep.length + '</b></span>' +
        '<span>后厨 <b>' + p.kitchen.length + '</b></span>' +
        '<span>弃菜 <b>' + p.abandoned.length + '</b></span>' +
      '</div>' +
      '<div class="detail-lands">' +
        p.lands.map(function (land, index) {
          var label = land.shopId ? DSM.shopById[land.shopId].name : land.cleared ? (land.reservedShopId ? DSM.shopById[land.reservedShopId].name + '（待建）' : '空地') : '未清理';
          return '<div class="detail-land' + (land.shopId ? ' built' : land.cleared ? ' reserved' : '') + '"><span>' + CN_NUM[index] + '</span><b>' + esc(label) + '</b></div>';
        }).join('') +
      '</div>';
    openModal('player', '掌柜详情', body, '<button type="button" class="btn btn-ghost" data-action="close-modal">收起</button>');
  }

  function shopDetailBody(shop, status) {
    var effect = shopEffectText(shop);
    var note = status === 'built'
      ? '已建成，基础收益与联动加成均已生效。'
      : status === 'reserved'
        ? '已认购但尚未修建，支付 ' + shop.buildCost + ' 铜钱建成后才会产生收益。'
        : '清地时可以从展示区认购这家店铺，建造后才会产生收益。';
    return '<div class="shop-detail">' +
        '<span class="shop-detail-seal">' + sealChar(shop.name) + '</span>' +
        '<h3>' + esc(shop.name) + '</h3>' +
        '<div class="detail-stats">' +
          '<span>建造费 <b>' + coin(13) + shop.buildCost + '</b></span>' +
          '<span>基础收益 <b>' + shopIncomeText(shop) + '</b></span>' +
        '</div>' +
        (shopBonusText(shop) ? '<p class="detail-line">联动：' + esc(shopBonusText(shop)) + '</p>' : '') +
        (effect ? '<p class="detail-line">效果：' + esc(effect) + '</p>' : '') +
        '<p class="tiny">' + note + '</p>' +
      '</div>';
  }

  function openShop(uid) {
    var game = DSM.state;
    var card = game.shopMarket.filter(function (item) { return item.uid === uid; })[0];
    if (!card) return;
    var shop = DSM.shopById[card.id];
    openModal('shop', '店铺详情', shopDetailBody(shop, 'market'), '<button type="button" class="btn btn-ghost" data-action="close-modal">收起</button>');
  }

  function openLandShop(index) {
    var game = DSM.state;
    if (!game) return;
    var land = game.players[game.currentPlayerIndex].lands[index];
    if (!land) return;
    var shop = DSM.shopById[land.shopId || land.reservedShopId];
    if (!shop) return;
    var status = land.shopId ? 'built' : 'reserved';
    openModal('shop', '店铺详情', shopDetailBody(shop, status), '<button type="button" class="btn btn-ghost" data-action="close-modal">收起</button>');
  }

  function openCustomer(uid) {
    var game = DSM.state;
    if (!game) return;
    var index = -1;
    var card = null;
    game.customerMarket.forEach(function (item, i) {
      if (item.uid === uid) { card = item; index = i; }
    });
    if (!card) return;
    var customer = DSM.customerById[card.id];
    if (!customer) return;
    var p = game.players[game.currentPlayerIndex];
    var cost = DSM.customerMenuCost(p, customer);
    var owned = DSM.builtShopIds(p);
    var statusText = index < game.focusIndex
      ? '已跳过，随身 +' + (card.tip || 0)
      : index === game.focusIndex
        ? (game.phase === 'phase3' ? '当前待招待' : '下一位待招待')
        : '排队中';
    var effects = (cost.effects || []).map(function (effect) {
      return effect.label + (effect.amount >= 0 ? '+' : '') + effect.amount;
    }).join('，');
    var body = '<div class="shop-detail customer-detail">' +
        '<span class="shop-detail-seal">' + sealChar(customer.name) + '</span>' +
        '<h3>' + esc(customer.name) + '</h3>' +
        '<div class="detail-stats">' +
          '<span>吃菜 <b>' + cost.total + ' 道</b></span>' +
          (card.tip ? '<span>随身 <b>' + coin(13) + card.tip + '</b></span>' : '') +
        '</div>' +
        '<p class="detail-line">会去：' + customer.visitShopIds.map(function (id) {
          var shop = DSM.shopById[id];
          if (!shop) return '';
          return owned.indexOf(id) >= 0 ? '<span class="shop-owned">' + esc(shop.name) + '</span>' : esc(shop.name);
        }).join(' · ') + '</p>' +
        (effects ? '<p class="detail-line">加成：基础 ' + cost.base + ' 道，' + esc(effects) + '</p>' : '') +
        '<p class="detail-line">状态：' + statusText + '（候客区第 ' + (index + 1) + ' 位）</p>' +
        '<p class="tiny">招待时消耗 ' + cost.total + ' 道菜，菜品与客人所访店铺共同产生收益。' +
          (card.tip ? '随身铜钱会在招待后一并入账。' : '') + '</p>' +
      '</div>';
    openModal('customer', '客人详情', body, '<button type="button" class="btn btn-ghost" data-action="close-modal">收起</button>');
  }

  function animateDice(root) {
    var dice = Array.prototype.slice.call(root.querySelectorAll('.die'));
    if (!dice.length) return;
    dice.forEach(function (die, index) {
      var finalFace = Number(die.getAttribute('data-face')) || 1;
      var ticks = 0;
      var timer = setInterval(function () {
        ticks += 1;
        die.textContent = String(1 + Math.floor(Math.random() * 6));
        die.classList.add('rolling');
        if (ticks >= 6) {
          clearInterval(timer);
          die.textContent = String(finalFace);
          die.classList.remove('rolling');
          die.classList.add('settled');
        }
      }, 65 + index * 12);
    });
  }

  function scheduleModal() {
    var game = DSM.state;
    if (!game || UI.screen !== 'game' || UI.modal) return;
    if (game.pendingSummary && UI.summaryShown !== game.pendingSummary.id) { openSummary(game.pendingSummary); return; }
    if (game.eventQueue.length) { openEvent(); return; }
    if (game.phase === 'over' && !UI.resultShown) { openResult(); }
  }

  /* ------------------------------ 操作 ------------------------------ */

  function startGame() {
    var names = [];
    [0, 1, 2, 3].forEach(function (i) {
      var input = setupEl.querySelector('[data-name="' + i + '"]');
      names.push(input ? input.value.trim() : '');
    });
    var options = {
      playerCount: UI.config.playerCount,
      startingCash: UI.config.startingCash,
      startingLowMenus: UI.config.startingLowMenus,
      startingMidMenus: UI.config.startingMidMenus,
      victoryCash: UI.config.victoryCash,
      victoryShops: UI.config.victoryShops,
      names: names,
      events: true
    };
    if (!options.victoryCash && !options.victoryShops) {
      toast('铜钱与店铺条件不能同时为 0');
      return;
    }
    UI.lastOptions = Object.assign({}, options);
    UI.config.names = names;
    saveConfig();
    DSM.startGame(options);
    UI.screen = 'game';
    UI.summaryShown = null;
    UI.resultShown = false;
    UI.eventOpen = false;
    UI.logOpen = false;
    UI.deckIndex = 0;
    UI.advanceAfterEvents = false;
    if (UI.modal) closeModal();
    render();
    window.scrollTo(0, 0);
  }

  function restartGame() {
    var options = UI.lastOptions;
    if (!options) { startGame(); return; }
    DSM.startGame(options);
    UI.screen = 'game';
    UI.summaryShown = null;
    UI.resultShown = false;
    UI.eventOpen = false;
    UI.logOpen = false;
    UI.deckIndex = 0;
    UI.advanceAfterEvents = false;
    if (UI.modal) closeModal();
    render();
    window.scrollTo(0, 0);
    toast('新的一局开张了');
  }

  function executeServe(selectedShopId) {
    var result = DSM.serveCustomer(selectedShopId);
    if (result.needChoice) {
      var preview = DSM.previewServe();
      openServeChoice(preview);
      return;
    }
    if (!result.ok) { toast(result.error || '现在不能招待'); return; }
    if (UI.modal) closeModal();
    render();
  }

  function handleNextTurn() {
    var game = DSM.state;
    if (!game) return;
    if (game.phase === 'over') {
      closeModal();
      UI.resultShown = false;
      setTimeout(scheduleModal, 30);
      return;
    }
    if (game.eventQueue.length) {
      if (game.pendingSummary) UI.summaryShown = game.pendingSummary.id;
      UI.advanceAfterEvents = true;
      closeModal();
      render();
      return;
    }
    var result = DSM.nextTurn();
    if (!result.ok) { toast(result.error || '还不能结束回合'); return; }
    closeModal();
    UI.summaryShown = null;
    render();
  }

  function handleAction(action, el) {
    var game = DSM.state;
    switch (action) {
      case 'landing-start':
        if (resumeGame()) break;
        UI.screen = 'setup';
        renderSetup();
        break;
      case 'landing-new':
        UI.screen = 'setup';
        renderSetup();
        break;
      case 'landing-back':
        UI.screen = 'landing';
        renderLanding();
        break;
      case 'game-home':
        UI.screen = 'landing';
        if (UI.modal) closeModal();
        render();
        window.scrollTo(0, 0);
        break;
      case 'player-count':
        UI.config.playerCount = Number(el.dataset.count);
        saveConfig();
        renderSetup();
        break;
      case 'step': {
        var field = el.dataset.field;
        var delta = Number(el.dataset.delta);
        var input = el.parentNode.querySelector('input');
        var min = Number(input.min);
        var max = Number(input.max);
        var value = Math.min(max, Math.max(min, Number(input.value || 0) + delta));
        input.value = value;
        UI.config[field] = value;
        saveConfig();
        break;
      }
      case 'toggle-block': {
        var blockKey = el.dataset.block;
        var block = el.closest('.setup-block');
        var open = !block.classList.contains('is-open');
        UI.openBlocks[blockKey] = open;
        block.classList.toggle('is-open', open);
        el.setAttribute('aria-expanded', open ? 'true' : 'false');
        el.setAttribute('aria-label', (open ? '收起' : '编辑') + block.querySelector('h2').textContent);
        block.querySelector('.block-summary').textContent = BLOCK_SUMMARY[blockKey](UI.config);
        break;
      }
      case 'start':
        startGame();
        break;
      case 'rules':
        openRules();
        break;
      case 'events':
        openEvents();
        break;
      case 'close-modal':
        if (UI.dismissible) closeModal();
        break;
      case 'inspect-player':
        openPlayer(el.dataset.id);
        break;
      case 'inspect-shop':
        openShop(el.dataset.uid);
        break;
      case 'inspect-land':
        openLandShop(Number(el.dataset.land));
        break;
      case 'inspect-customer':
        openCustomer(el.dataset.uid);
        break;
      case 'inspect-pile':
        openPile(el.dataset.pile);
        break;
      case 'deck-tab': {
        var deckIndex = Number(el.dataset.deck);
        if (isNaN(deckIndex)) break;
        UI.deckIndex = Math.max(0, Math.min(2, deckIndex));
        if (deckSwiper) deckSwiper.slideTo(UI.deckIndex + 1);
        else syncDeckTabs(UI.deckIndex);
        break;
      }
      case 'buy':
        if (game && game.phase === 'phase1') openBuyMenu();
        break;
      case 'do-buy': {
        var buy = DSM.buyMenu(el.dataset.id);
        if (!buy.ok) { toast(buy.error); return; }
        closeModal();
        toast('菜单已放入后厨');
        render();
        break;
      }
      case 'clear':
        openClearFlow();
        break;
      case 'reserve-shop': {
        var next = DSM.nextClearableLand(game.players[game.currentPlayerIndex]);
        var clear = DSM.clearAndReserve(next.id, el.dataset.uid);
        if (!clear.ok) { toast(clear.error); return; }
        closeModal();
        toast('清地完成，店铺已认购');
        render();
        break;
      }
      case 'reserve-none': {
        var land = DSM.nextClearableLand(game.players[game.currentPlayerIndex]);
        var bare = DSM.clearAndReserve(land.id, null);
        if (!bare.ok) { toast(bare.error); return; }
        closeModal();
        toast('已清地，展示区暂无店铺');
        render();
        break;
      }
      case 'build':
        openBuild();
        break;
      case 'do-build': {
        var built = DSM.buildShop(el.dataset.land);
        if (!built.ok) { toast(built.error); return; }
        if (UI.modal === 'build') {
          var left = DSM.canBuild(game.players[game.currentPlayerIndex]);
          if (left.length) { openBuild(); } else { closeModal(); }
        }
        render();
        if (game.phase === 'over') { UI.resultShown = false; }
        break;
      }
      case 'advance-2': {
        var p2 = DSM.advanceToPhase2();
        if (!p2.ok) toast(p2.error);
        render();
        break;
      }
      case 'discard':
        openDiscard();
        break;
      case 'do-discard': {
        var p = game.players[game.currentPlayerIndex];
        var index = p.kitchen.indexOf(el.dataset.id);
        if (index < 0) { toast('后厨没有这张菜'); return; }
        var discard = DSM.discardMenu(index);
        if (!discard.ok) { toast(discard.error); return; }
        closeModal();
        toast('已弃菜，进入招待阶段');
        render();
        break;
      }
      case 'advance-3': {
        var p3 = DSM.advanceToPhase3();
        if (!p3.ok) toast(p3.error);
        render();
        break;
      }
      case 'serve': {
        var preview = DSM.previewServe();
        if (!preview) { toast('现在没有可招待的客人'); return; }
        if (preview.needChoice) { openServeChoice(preview); return; }
        executeServe(null);
        break;
      }
      case 'serve-shop':
        executeServe(el.dataset.shop);
        break;
      case 'skip-customer': {
        var skip = DSM.skipCustomer();
        if (!skip.ok) { toast(skip.error); return; }
        render();
        break;
      }
      case 'next-turn':
        handleNextTurn();
        break;
      case 'ack-event': {
        DSM.acknowledgeEvent();
        closeModal();
        UI.eventOpen = false;
        if (!game.eventQueue.length && UI.advanceAfterEvents) {
          UI.advanceAfterEvents = false;
          handleNextTurn();
          break;
        }
        render();
        break;
      }
      case 'show-result':
        openResult();
        break;
      case 'play-again':
        closeModal();
        restartGame();
        break;
      case 'restart':
        openModal('restart', '重开一局', '<p class="modal-lead">当前对局进度将丢失，确定重新开张吗？</p>',
          '<button type="button" class="btn btn-ghost" data-action="close-modal">再想想</button>' +
          '<button type="button" class="btn btn-primary" data-action="play-again">确定重开</button>');
        break;
      case 'toggle-log':
        UI.logOpen = !UI.logOpen;
        render();
        break;
      default:
        break;
    }
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-action]');
    if (target) {
      handleAction(target.dataset.action, target);
      return;
    }
    if (event.target === modalRoot && UI.dismissible) closeModal();
  });

  document.addEventListener('input', function (event) {
    var target = event.target;
    if (target.matches('[data-config]')) {
      var min = Number(target.min);
      var max = Number(target.max);
      var value = Math.min(max, Math.max(min, Number(target.value || 0)));
      UI.config[target.dataset.config] = value;
      saveConfig();
    }
    if (target.matches('[data-name]')) {
      UI.config.names[Number(target.dataset.name)] = target.value.slice(0, 12);
      saveConfig();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && UI.modal && UI.dismissible) closeModal();
  });

  function render() {
    if (UI.screen === 'landing') { renderLanding(); return; }
    if (UI.screen === 'setup' || !DSM.state) renderSetup();
    else { renderGame(); saveGame(); }
  }

  render();
})();
