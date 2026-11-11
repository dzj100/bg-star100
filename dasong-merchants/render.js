/* 大宋百商图 · 界面渲染与交互 */
(function () {
  'use strict';

  var DSM = window.DSM;
  var $ = function (id) { return document.getElementById(id); };
  var esc = DSM.escapeHtml;

  var SETUP_KEY = 'dsm:setup:v1';
  var DEFAULTS = {
    playerCount: 2,
    startingCash: 5,
    startingLowMenus: 6,
    startingMidMenus: 2,
    victoryCash: 50,
    victoryShops: 8,
    names: ['', '', '', '']
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
      '<path d="M3 11 12 4l9 7" fill="none" stroke="#7f3a2b" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M5.5 10.5V20h13v-9.5" fill="#f3e7d0" stroke="#7f3a2b" stroke-width="1.4"/>' +
      '<rect x="10" y="13" width="4" height="7" fill="#7f3a2b" opacity=".72"/>' +
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

  /* ------------------------------ 首页 ------------------------------ */

  function scenePerson(x, y, robe, hat) {
    var hatSVG = hat === 'straw'
      ? '<ellipse cx="0" cy="-25" rx="8.2" ry="1.7" fill="#cba05c" stroke="#8a6544" stroke-width=".9"/>' +
        '<path d="M-5.6 -25.4 Q0 -30.8 5.6 -25.4 Z" fill="#d3aa66" stroke="#8a6544" stroke-width=".8"/>'
      : '<path d="M-5.2 -25 Q0 -28.8 5.2 -25 L5.2 -23.8 L-5.2 -23.8 Z" fill="#4a3a28"/>';
    return '<g transform="translate(' + x + ' ' + y + ')">' +
      '<path d="M-3.6 -19 L3.6 -19 L4.6 -13 L6.6 -1 L-6.6 -1 L-4.6 -13 Z" fill="' + robe + '" stroke="#4a3b2c" stroke-opacity=".45" stroke-width=".9"/>' +
      '<path d="M-4.2 -12.8 L4.2 -12.8" stroke="#4a3b2c" stroke-opacity=".28" stroke-width=".8"/>' +
      '<path d="M-3.6 -18.4 L-6.6 -10.4 M3.6 -18.4 L6.6 -10.4" stroke="' + robe + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="0" cy="-22.4" r="3" fill="#e8c9a6" stroke="#4a3b2c" stroke-opacity=".4" stroke-width=".8"/>' +
      hatSVG +
      '</g>';
  }

  function landingHeroHTML() {
    return '' +
      '<div class="landing-hero" aria-hidden="true">' +
      '<svg class="hero-scene" viewBox="0 0 720 420" fill="none">' +

        '<defs>' +
          '<linearGradient id="sceneFadeX" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0"/>' +
            '<stop offset=".045" stop-color="#fff"/>' +
            '<stop offset=".955" stop-color="#fff"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<linearGradient id="sceneFadeY" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#fff"/>' +
            '<stop offset=".97" stop-color="#fff"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<mask id="sceneMaskX" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="420"><rect width="720" height="420" fill="url(#sceneFadeX)"/></mask>' +
          '<mask id="sceneMaskY" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="420"><rect width="720" height="420" fill="url(#sceneFadeY)"/></mask>' +
          '<linearGradient id="sceneWater" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#a9c4bc" stop-opacity=".5"/>' +
            '<stop offset=".55" stop-color="#8fb4ac" stop-opacity=".6"/>' +
            '<stop offset="1" stop-color="#6f9a93" stop-opacity=".66"/>' +
          '</linearGradient>' +
          '<linearGradient id="sceneBank" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0" stop-color="#c9b48c" stop-opacity=".5"/>' +
            '<stop offset="1" stop-color="#c9b48c" stop-opacity=".8"/>' +
          '</linearGradient>' +
          '<linearGradient id="sceneEaveL" x1="0" y1="0" x2="0" y2="80" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0" stop-color="#9d9889"/>' +
            '<stop offset="1" stop-color="#c6bfad"/>' +
          '</linearGradient>' +
          '<linearGradient id="sceneEaveR" x1="0" y1="0" x2="0" y2="80" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0" stop-color="#9d9889"/>' +
            '<stop offset="1" stop-color="#c6bfad"/>' +
          '</linearGradient>' +
          '<filter id="sceneSoft" x="-20%" y="-80%" width="140%" height="260%">' +
            '<feGaussianBlur stdDeviation="5"/>' +
          '</filter>' +
        '</defs>' +

        /* 天光、淡云、雁阵 */
        '<circle cx="596" cy="72" r="54" fill="#e8c98c" opacity=".09"/>' +
        '<circle cx="596" cy="72" r="25" fill="#e6c47f" opacity=".28"/>' +
        '<g mask="url(#sceneMaskX)">' +
          '<ellipse cx="330" cy="92" rx="150" ry="9" fill="#fbf6ea" opacity=".5" filter="url(#sceneSoft)"/>' +
          '<ellipse cx="530" cy="124" rx="120" ry="7" fill="#fbf6ea" opacity=".4" filter="url(#sceneSoft)"/>' +
          '<ellipse cx="140" cy="138" rx="110" ry="6" fill="#fbf6ea" opacity=".35" filter="url(#sceneSoft)"/>' +
        '</g>' +
        '<g fill="none" stroke="#c4ae83" stroke-opacity=".48" stroke-linecap="round">' +
          '<path stroke-width="1.3" d="M186 84 C 198 70 220 68 234 78 C 244 70 264 72 270 84"/>' +
          '<path stroke-width="1.1" d="M232 78 C 242 82 250 82 258 78"/>' +
          '<path stroke-width="1.1" d="M352 96 C 362 90 374 89 382 93 C 388 89 398 90 402 96"/>' +
        '</g>' +
        '<g fill="none" stroke="#6b5a45" stroke-opacity=".35" stroke-linecap="round">' +
          '<path stroke-width="1.5" d="M483 62 q4.6 -5.6 9.2 0 q4.6 -5.6 9.2 0"/>' +
          '<path stroke-width="1.35" d="M458 47 q4.2 -5.2 8.4 0 q4.2 -5.2 8.4 0"/>' +
          '<path stroke-width="1.25" d="M433 37 q3.8 -4.7 7.6 0 q3.8 -4.7 7.6 0"/>' +
          '<path stroke-width="1.15" d="M409 31 q3.4 -4.2 6.8 0 q3.4 -4.2 6.8 0"/>' +
          '<path stroke-width="1.35" d="M458 77 q4.2 -5.2 8.4 0 q4.2 -5.2 8.4 0"/>' +
          '<path stroke-width="1.25" d="M433 87 q3.8 -4.7 7.6 0 q3.8 -4.7 7.6 0"/>' +
          '<path stroke-width="1.15" d="M409 93 q3.4 -4.2 6.8 0 q3.4 -4.2 6.8 0"/>' +
        '</g>' +

        /* 左上探入的飞檐 */
        '<g>' +
          '<path d="M180 26 C 156 34 120 46 88 57 C 56 68 24 76 0 80" stroke="#4a4438" stroke-opacity=".22" stroke-width="8" stroke-linecap="round"/>' +
          '<path d="M0 0 L146 0 C 158 8 170 18 180 26 C 156 34 120 46 88 57 C 56 68 24 76 0 80 Z" fill="url(#sceneEaveL)"/>' +
          '<g stroke="#5f574b" stroke-opacity=".34" stroke-width=".9">' +
            '<path d="M10 75 L14 10M36 70 L41 6M62 64 L67 3M88 56 L93 0M114 46 L119 0M140 34 L144 0M164 31 L167 8"/>' +
          '</g>' +
          '<path d="M4 44 C 40 36 82 24 122 10" stroke="#5f574b" stroke-opacity=".18" stroke-width="1"/>' +
          '<path d="M147 1 C 159 9 170 18 178 24" stroke="#4f463a" stroke-opacity=".45" stroke-width="1.2" stroke-linecap="round"/>' +
          '<path d="M180 26 C 156 34 120 46 88 57 C 56 68 24 76 0 80" stroke="#4f463a" stroke-width="3.8" stroke-linecap="round"/>' +
          '<path d="M179 24.2 C 155 32.2 119 44.2 87 55.2 C 55 66.2 23 74 1 78" stroke="#ddd6c3" stroke-opacity=".65" stroke-width="1.3"/>' +
          '<path d="M180 28 C 156 36 120 48 88 59 C 56 70 24 78 0 82" stroke="#6a6557" stroke-width="3.4" stroke-dasharray="0 15" stroke-linecap="round"/>' +
          '<path d="M180 26 C 186 22 190 14 189 6" stroke="#4f463a" stroke-width="2.2" stroke-linecap="round"/>' +
          '<g stroke="#4f463a" stroke-opacity=".4" stroke-width="1.1" stroke-linecap="round">' +
            '<path d="M20 82 L17 88M56 71 L53 77M92 60 L89 66M128 46 L125 52M158 38 L155 44"/>' +
          '</g>' +
        '</g>' +
        '<g>' +
          '<path d="M104 50 L104 64" stroke="#6b5a45" stroke-opacity=".5" stroke-width="1"/>' +
          '<path d="M97.6 64 L110.4 64" stroke="#8d3f2f" stroke-width="1.6" stroke-linecap="round"/>' +
          '<ellipse cx="104" cy="72" rx="6.4" ry="7.6" fill="#b1543f" stroke="#8d3f2f" stroke-width=".8"/>' +
          '<path d="M104 64.6 L104 79.4" stroke="#e0b273" stroke-opacity=".35" stroke-width=".9"/>' +
          '<path d="M97.6 80 L110.4 80" stroke="#8d3f2f" stroke-width="1.6" stroke-linecap="round"/>' +
          '<path d="M104 80 L104 87" stroke="#c4a25a" stroke-width="1.2" stroke-linecap="round"/>' +
        '</g>' +

        /* 右上探入的飞檐 */
        '<g>' +
          '<path d="M540 26 C 564 34 600 46 632 57 C 664 68 696 76 720 80" stroke="#4a4438" stroke-opacity=".22" stroke-width="8" stroke-linecap="round"/>' +
          '<path d="M720 0 L574 0 C 562 8 550 18 540 26 C 564 34 600 46 632 57 C 664 68 696 76 720 80 Z" fill="url(#sceneEaveR)"/>' +
          '<g stroke="#5f574b" stroke-opacity=".34" stroke-width=".9">' +
            '<path d="M710 75 L706 10M684 70 L679 6M658 64 L653 3M632 56 L627 0M606 46 L601 0M580 34 L576 0M556 31 L553 8"/>' +
          '</g>' +
          '<path d="M716 44 C 680 36 638 24 598 10" stroke="#5f574b" stroke-opacity=".18" stroke-width="1"/>' +
          '<path d="M573 1 C 561 9 550 18 542 24" stroke="#4f463a" stroke-opacity=".45" stroke-width="1.2" stroke-linecap="round"/>' +
          '<path d="M540 26 C 564 34 600 46 632 57 C 664 68 696 76 720 80" stroke="#4f463a" stroke-width="3.8" stroke-linecap="round"/>' +
          '<path d="M541 24.2 C 565 32.2 601 44.2 633 55.2 C 665 66.2 697 74 719 78" stroke="#ddd6c3" stroke-opacity=".65" stroke-width="1.3"/>' +
          '<path d="M540 28 C 564 36 600 48 632 59 C 664 70 696 78 720 82" stroke="#6a6557" stroke-width="3.4" stroke-dasharray="0 15" stroke-linecap="round"/>' +
          '<path d="M540 26 C 534 22 530 14 531 6" stroke="#4f463a" stroke-width="2.2" stroke-linecap="round"/>' +
          '<g stroke="#4f463a" stroke-opacity=".4" stroke-width="1.1" stroke-linecap="round">' +
            '<path d="M700 82 L703 88M664 71 L667 77M628 60 L631 66M592 46 L595 52M562 38 L565 44"/>' +
          '</g>' +
        '</g>' +
        '<g>' +
          '<path d="M650 62 L650 76" stroke="#6b5a45" stroke-opacity=".5" stroke-width="1"/>' +
          '<path d="M643.6 76 L656.4 76" stroke="#8d3f2f" stroke-width="1.6" stroke-linecap="round"/>' +
          '<ellipse cx="650" cy="84" rx="6.4" ry="7.6" fill="#b1543f" stroke="#8d3f2f" stroke-width=".8"/>' +
          '<path d="M650 76.6 L650 91.4" stroke="#e0b273" stroke-opacity=".35" stroke-width=".9"/>' +
          '<path d="M643.6 92 L656.4 92" stroke="#8d3f2f" stroke-width="1.6" stroke-linecap="round"/>' +
          '<path d="M650 92 L650 99" stroke="#c4a25a" stroke-width="1.2" stroke-linecap="round"/>' +
        '</g>' +

        /* 远山、对岸街市、河水 */
        '<g mask="url(#sceneMaskX)"><g mask="url(#sceneMaskY)">' +
          '<path d="M0 224 C 54 202 104 208 156 218 C 214 229 258 196 316 204 C 372 212 414 194 470 204 C 526 214 570 198 626 208 C 668 215 700 206 720 210 L720 300 L0 300 Z" fill="#a3b79b" opacity=".12"/>' +
          '<ellipse cx="360" cy="244" rx="380" ry="10" fill="#f7f1e2" opacity=".4" filter="url(#sceneSoft)"/>' +
          '<path d="M0 246 C 70 216 130 224 190 232 C 250 240 300 218 360 224 C 430 231 490 214 550 222 C 610 230 670 218 720 224 L720 300 L0 300Z" fill="#a3b79b" opacity=".2"/>' +
          '<path d="M0 268 C 80 252 150 262 220 266 C 300 270 360 252 440 258 C 520 264 590 250 660 258 C 690 261 706 258 720 256 L720 302 L0 302Z" fill="#7e9a74" opacity=".15"/>' +
          '<path d="M0 290 C 80 288 160 292 240 290 C 320 288 400 292 480 290 C 560 288 640 292 720 290 L720 300 L0 300 Z" fill="#d8c39c" opacity=".45"/>' +

          /* 对岸树影（衬在屋后） */
          '<g fill="#7d9a72" opacity=".42">' +
            '<ellipse cx="282" cy="260" rx="16" ry="12"/><ellipse cx="270" cy="268" rx="10" ry="8"/><ellipse cx="294" cy="268" rx="10" ry="7"/>' +
            '<ellipse cx="532" cy="262" rx="13" ry="10"/><ellipse cx="521" cy="269" rx="8" ry="6"/>' +
            '<ellipse cx="604" cy="254" rx="18" ry="13"/><ellipse cx="590" cy="264" rx="10" ry="7"/><ellipse cx="618" cy="264" rx="9" ry="6"/>' +
          '</g>' +
          '<g stroke="#5d6b50" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round">' +
            '<path d="M282 262 L282 298"/><path d="M532 264 L532 298"/><path d="M604 258 L604 298"/>' +
          '</g>' +

          /* 对岸小铺 */
          '<g>' +
            '<path d="M198 298 L256 298 L256 276 L198 278 Z" fill="#efe3c8" stroke="#8a7550" stroke-opacity=".28" stroke-width="1"/>' +
            '<path d="M190 278 C 204 266 236 264 264 274 L262 281 C 244 274 218 274 202 283 L196 281 Z" fill="#5f6b5c" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M196 281 C 214 274 242 274 262 281" stroke="#3f4a3c" stroke-opacity=".5" stroke-width="2.4"/>' +
            '<path d="M205 270 C 221 264 242 264 256 271" stroke="#8b9682" stroke-opacity=".45" stroke-width="1"/>' +
            '<path d="M190 278 Q185 277 183 273 M264 274 Q268 273 270 269" stroke="#46503f" stroke-width="1.2" stroke-linecap="round"/>' +
            '<path d="M196 281 C 214 274 242 274 262 281" stroke="#46503f" stroke-opacity=".35" stroke-width="1"/>' +
            '<path d="M206 286 L226 286 L226 298 L206 298 Z" fill="#e6d6b6" stroke="#8a6544" stroke-opacity=".35" stroke-width=".8"/>' +
            '<rect x="238" y="282" width="9" height="15" fill="#b1543f" opacity=".85"/>' +
            '<path d="M300 298 L352 298 L352 284 L300 286 Z" fill="#efe3c8" stroke="#8a7550" stroke-opacity=".28" stroke-width="1"/>' +
            '<path d="M292 286 C 306 274 336 272 360 282 L358 289 C 338 281 314 281 300 290 L296 288 Z" fill="#66715f" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M298 289 C 316 282 340 282 358 288" stroke="#3f4a3c" stroke-opacity=".45" stroke-width="2.2"/>' +
            '<path d="M306 280 C 320 274 340 274 352 280" stroke="#8b9682" stroke-opacity=".42" stroke-width="1"/>' +
            '<path d="M292 286 Q287 285 285 281 M360 282 Q363 281 365 277" stroke="#46503f" stroke-width="1.1" stroke-linecap="round"/>' +
            '<path d="M298 290 L356 288 L356 294 L298 296 Z" fill="#c9a05a" opacity=".5"/>' +
            '<path d="M306 290 L306 295 M318 290 L318 295 M330 290 L330 295 M342 289 L342 294" stroke="#f3e8d1" stroke-opacity=".6" stroke-width="2"/>' +
            '<path d="M312 292 L324 292 L324 298 L312 298 Z" fill="#6b5236"/>' +
            '<path d="M362 298 L414 298 L414 266 L362 268 Z" fill="#efe3c8" stroke="#8a7550" stroke-opacity=".28" stroke-width="1"/>' +
            '<path d="M354 268 C 370 256 400 252 422 264 L420 271 C 400 262 374 262 360 274 L356 272 Z" fill="#556252" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M360 272 C 378 264 402 264 420 271" stroke="#3f4a3c" stroke-opacity=".5" stroke-width="2.4"/>' +
            '<path d="M368 262 C 384 256 404 256 416 261" stroke="#8b9682" stroke-opacity=".45" stroke-width="1"/>' +
            '<path d="M354 268 Q349 267 347 263 M422 264 Q426 263 428 259" stroke="#46503f" stroke-width="1.1" stroke-linecap="round"/>' +
            '<path d="M370 276 L384 276 L384 288 L370 288 Z" fill="#f9f2e2" stroke="#8a6544" stroke-opacity=".45" stroke-width=".8"/>' +
            '<path d="M392 276 L406 276 L406 288 L392 288 Z" fill="#f9f2e2" stroke="#8a6544" stroke-opacity=".45" stroke-width=".8"/>' +
            '<rect x="398" y="266" width="9" height="13" fill="#b1543f" opacity=".85"/>' +
            '<path d="M468 298 L520 298 L520 282 L468 284 Z" fill="#efe3c8" stroke="#8a7550" stroke-opacity=".28" stroke-width="1"/>' +
            '<path d="M460 284 C 474 272 504 270 528 280 L526 287 C 506 278 480 278 466 288 L462 286 Z" fill="#5f6b5c" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M466 287 C 482 280 506 280 526 287" stroke="#3f4a3c" stroke-opacity=".45" stroke-width="2.2"/>' +
            '<path d="M474 276 C 488 270 508 270 520 276" stroke="#8b9682" stroke-opacity=".42" stroke-width="1"/>' +
            '<path d="M460 284 Q455 283 453 279 M528 280 Q531 279 533 275" stroke="#46503f" stroke-width="1.1" stroke-linecap="round"/>' +
            '<path d="M466 288 L524 284 L524 291 L466 295 Z" fill="#c9a05a" opacity=".45"/>' +
            '<path d="M474 288 L474 294 M486 287 L486 293 M498 287 L498 293 M510 286 L510 292" stroke="#f3e8d1" stroke-opacity=".55" stroke-width="2"/>' +
            '<path d="M480 296 L494 296 L494 298 L480 298 Z" fill="#6b5236"/>' +
            '<path d="M544 298 L590 298 L590 286 L544 288 Z" fill="#efe3c8" stroke="#8a7550" stroke-opacity=".28" stroke-width="1"/>' +
            '<path d="M536 288 C 550 278 576 276 598 284 L596 290 C 578 283 556 284 544 292 L540 291 Z" fill="#66715f" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M542 290 C 556 285 578 285 596 290" stroke="#3f4a3c" stroke-opacity=".45" stroke-width="2.2"/>' +
            '<path d="M550 281 C 564 277 580 277 592 281" stroke="#8b9682" stroke-opacity=".42" stroke-width="1"/>' +
            '<path d="M536 288 Q531 287 529 283 M598 284 Q601 283 603 279" stroke="#46503f" stroke-width="1.1" stroke-linecap="round"/>' +
            '<path d="M552 292 L566 292 L566 298 L552 298 Z" fill="#e6d6b6" stroke="#8a6544" stroke-opacity=".3" stroke-width=".8"/>' +
          '</g>' +

          /* 对岸小塔 */
          '<g>' +
            '<path d="M432 298 L454 298 L452 290 L434 290 Z" fill="#e6d6b6" stroke="#8a7550" stroke-opacity=".35" stroke-width=".9"/>' +
            '<path d="M435 290 L451 290 L449 278 L437 278 Z" fill="#f0e2c4" stroke="#8a7550" stroke-opacity=".3" stroke-width=".8"/>' +
            '<path d="M424 279 Q434 273 443 273 Q452 273 462 279 L460 282 Q452 277 443 277 Q434 277 426 282 Z" fill="#5f6b5c" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M424 279 Q420 277 419 272 M462 279 Q466 277 467 272" fill="none" stroke="#46503f" stroke-width="1" stroke-linecap="round"/>' +
            '<path d="M438 278 L448 278 L447 268 L439 268 Z" fill="#f0e2c4" stroke="#8a7550" stroke-opacity=".3" stroke-width=".8"/>' +
            '<path d="M427 269 Q436 264 443 264 Q450 264 459 269 L457 272 Q450 267 443 267 Q436 267 429 272 Z" fill="#5f6b5c" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M427 269 Q423 267 422 263 M459 269 Q463 267 464 263" fill="none" stroke="#46503f" stroke-width="1" stroke-linecap="round"/>' +
            '<path d="M440 268 L446 268 L445 259 L441 259 Z" fill="#f0e2c4" stroke="#8a7550" stroke-opacity=".3" stroke-width=".8"/>' +
            '<path d="M431 260 Q437 256 443 256 Q449 256 455 260 L453 262 Q449 258 443 258 Q437 258 433 262 Z" fill="#5f6b5c" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M431 260 Q428 258 427 255 M455 260 Q458 258 459 255" fill="none" stroke="#46503f" stroke-width="1" stroke-linecap="round"/>' +
            '<path d="M441 259 L445 259 L445 251 L441 251 Z" fill="#f0e2c4" stroke="#8a7550" stroke-opacity=".3" stroke-width=".8"/>' +
            '<path d="M434 252 Q438 249 443 248 Q448 249 452 252 L450 254 Q447 251 443 250 Q439 251 436 254 Z" fill="#5f6b5c" stroke="#46503f" stroke-width="1"/>' +
            '<path d="M434 252 Q431 250 430 247 M452 252 Q455 250 456 247" fill="none" stroke="#46503f" stroke-width="1" stroke-linecap="round"/>' +
            '<path d="M442 250 L444 250 L444 244 L442 244 Z" fill="#f0e2c4"/>' +
            '<path d="M443 244 L443 233" stroke="#8a6544" stroke-opacity=".8" stroke-width="1"/>' +
            '<circle cx="443" cy="231.6" r="2.1" fill="#b1543f"/>' +
          '</g>' +

          /* 对岸灯火 */
          '<g fill="#b1543f" opacity=".85">' +
            '<circle cx="209" cy="285" r="1.7"/><circle cx="344" cy="291" r="1.6"/>' +
            '<circle cx="382" cy="279" r="1.7"/><circle cx="486" cy="291" r="1.6"/>' +
            '<circle cx="556" cy="295" r="1.5"/>' +
          '</g>' +

          '<path d="M0 298 C 90 294 180 300 270 297 C 360 294 440 299 540 296 C 620 294 680 297 720 295 L720 420 L0 420 Z" fill="url(#sceneWater)"/>' +
          '<ellipse cx="330" cy="318" rx="330" ry="10" fill="#f7f1e2" opacity=".45" filter="url(#sceneSoft)"/>' +
          '<ellipse cx="560" cy="340" rx="200" ry="7" fill="#f7f1e2" opacity=".35" filter="url(#sceneSoft)"/>' +
          '<ellipse cx="378" cy="336" rx="168" ry="13" fill="#5f827c" opacity=".16" filter="url(#sceneSoft)"/>' +
          '<g stroke="#b1543f" stroke-opacity=".12" stroke-width="3" stroke-linecap="round">' +
            '<path d="M302 328 q22 4 44 0"/><path d="M356 342 q26 4 52 0"/><path d="M422 332 q20 4 40 0"/>' +
          '</g>' +
          '<g stroke="#5f8b86" stroke-opacity=".25" stroke-width="1.3" stroke-linecap="round">' +
            '<path d="M90 340 q14 -4 28 0"/><path d="M196 352 q16 -4 32 0"/>' +
            '<path d="M300 336 q12 -3 24 0"/><path d="M408 366 q16 -4 32 0"/>' +
            '<path d="M520 352 q14 -4 28 0"/><path d="M612 386 q16 -4 32 0"/>' +
            '<path d="M120 392 q18 -4 36 0"/><path d="M356 396 q16 -4 32 0"/>' +
            '<path d="M664 340 q12 -3 24 0"/><path d="M250 382 q14 -4 28 0"/>' +
          '</g>' +
          '<g stroke="#7d9a72" stroke-opacity=".35" stroke-width="1.2" stroke-linecap="round">' +
            '<path d="M88 300 l1 -6 M92 300 l3 -5"/><path d="M280 297 l1 -5 M284 297 l3 -4"/>' +
            '<path d="M620 296 l1 -5 M624 296 l3 -4"/>' +
          '</g>' +

          /* 远处小船 */
          '<g stroke="#5c3d22" stroke-opacity=".7" stroke-width="1">' +
            '<path d="M296 316 q12 7 26 2 l3 3 q-15 6 -31 -1 Z" fill="#8a5a34"/>' +
            '<path d="M314 306 L314 316" stroke-width="1.2"/>' +
            '<path d="M314 306 L322 310 L314 313 Z" fill="#e9dcc0" stroke="none"/>' +
            '<path d="M482 324 q10 6 22 2 l2 2 q-13 5 -27 -1 Z" fill="#8a5a34"/>' +
          '</g>' +

          /* 莲叶、水禽 */
          '<g fill="#6f8f5f" opacity=".5">' +
            '<ellipse cx="500" cy="366" rx="9" ry="4"/>' +
            '<ellipse cx="517" cy="374" rx="7" ry="3.4"/>' +
            '<ellipse cx="479" cy="380" rx="8" ry="3.4"/>' +
            '<ellipse cx="392" cy="366" rx="7" ry="3.2"/>' +
          '</g>' +
          '<path d="M509 360 q4 -9 8 0 q-4 6 -8 0Z" fill="#d98f8a" opacity=".8"/>' +
          '<path d="M487 375 q3 -7 6 0 q-3 5 -6 0Z" fill="#d98f8a" opacity=".7"/>' +
          '<g stroke="#6b5a45" stroke-opacity=".5" stroke-width="1">' +
            '<ellipse cx="552" cy="368" rx="7.5" ry="4.2" fill="#f7f2e4"/>' +
            '<circle cx="558.5" cy="363.5" r="2.6" fill="#f7f2e4"/>' +
            '<path d="M561 363.5 l4 1 l-4 1.6Z" fill="#d98f4a" stroke="none"/>' +
            '<ellipse cx="538" cy="375" rx="4.6" ry="2.8" fill="#f7f2e4"/>' +
            '<circle cx="541.5" cy="372.4" r="1.8" fill="#f7f2e4"/>' +
          '</g>' +
        '</g></g>' +

        /* 虹桥：桥面 */
        '<path d="M150 296 Q375 68 600 288 L600 308 Q375 88 150 316 Z" fill="#d2ab74" stroke="#7a5634" stroke-opacity=".55" stroke-width="1.4"/>' +
        '<path d="M150 296 Q375 68 600 288 L600 292 Q375 73 150 301 Z" fill="#8a6544" opacity=".16"/>' +
        '<path d="M150 306 Q375 78 600 298" stroke="#b9905c" stroke-opacity=".45" stroke-width="1"/>' +
        '<path d="M150 296 Q375 68 600 288" stroke="#8a6544" stroke-opacity=".68" stroke-width="1.6"/>' +
        '<path d="M150 316 Q375 88 600 308" stroke="#7a5634" stroke-opacity=".32" stroke-width="1.4"/>' +
        '<g stroke="#8a6544" stroke-opacity=".28" stroke-width="1">' +
          '<path d="M218 241 L218 249M263 213 L263 221M308 195 L308 203M353 185 L353 193M398 184 L398 192M443 192 L443 200M488 209 L488 217M533 235 L533 243"/>' +
        '</g>' +
        '<g stroke="#b9905c" stroke-opacity=".3" stroke-width=".9">' +
          '<path d="M180 270 L180 280M240 231 L240 242M300 203 L300 214M360 188 L360 199M420 189 L420 200M480 207 L480 218M540 240 L540 251"/>' +
        '</g>' +

        /* 朱漆栏杆 */
        '<path d="M150 285 Q375 57 600 277 L600 288 Q375 68 150 296 Z" fill="#b1543f" fill-opacity=".94"/>' +
        '<path d="M150 285 Q375 57 600 277" stroke="#7f3a2b" stroke-width="2.2"/>' +
        '<path d="M150 288 Q375 61 600 280" stroke="#d3876a" stroke-opacity=".35" stroke-width="1.2"/>' +
        '<path d="M150 290 Q375 62 600 282" stroke="#7f3a2b" stroke-opacity=".35" stroke-width="1"/>' +
        '<g stroke="#9b4232" stroke-opacity=".5" stroke-width="1">' +
          '<path d="M162 274.7 L162 283.2M173 264.4 L173 272.9M184 254.6 L184 263.1M206 236.7 L206 245.2M217 228.5 L217 237.0M228 220.9 L228 229.4M250 207.3 L250 215.8M261 201.3 L261 209.8M272 195.8 L272 204.3M283 190.9 L283 199.4M294 186.5 L294 195.0M305 182.6 L305 191.1M316 179.3 L316 187.8M327 176.5 L327 185.0M338 174.2 L338 182.7M349 172.5 L349 181.0M360 171.3 L360 179.8M371 170.6 L371 179.1M382 170.5 L382 179.0M393 170.9 L393 179.4M404 171.8 L404 180.3M415 173.3 L415 181.8M426 175.3 L426 183.8M437 177.9 L437 186.4M448 181.0 L448 189.5M459 184.6 L459 193.1M470 188.8 L470 197.3M481 193.5 L481 202.0M492 198.7 L492 207.2M503 204.5 L503 213.0M514 210.8 L514 219.3M525 217.6 L525 226.1M536 225.0 L536 233.5M547 232.9 L547 241.4M558 241.3 L558 249.8M569 250.3 L569 258.8M580 259.8 L580 268.3"/>' +
        '</g>' +
        '<g stroke="#8f3529" stroke-opacity=".85" stroke-width="1.6">' +
          '<path d="M195 244 L195 260M240 212 L240 228M285 189 L285 205M330 174 L330 190M375 169 L375 185M420 173 L420 189M465 185 L465 201M510 207 L510 223M555 238 L555 254"/>' +
        '</g>' +
        '<g fill="#d8ae62" opacity=".95">' +
          '<circle cx="195" cy="244" r="1.5"/><circle cx="240" cy="212" r="1.5"/><circle cx="285" cy="189" r="1.5"/>' +
          '<circle cx="330" cy="174" r="1.5"/><circle cx="375" cy="169" r="1.5"/><circle cx="420" cy="173" r="1.5"/>' +
          '<circle cx="465" cy="185" r="1.5"/><circle cx="510" cy="207" r="1.5"/><circle cx="555" cy="238" r="1.5"/>' +
        '</g>' +

        /* 桥上：花轿 */
        '<g transform="translate(375 180) scale(.68)">' +
          scenePerson(-44, 3, '#6d8ba0', 'straw') +
          scenePerson(44, 3, '#7b8f6a', 'straw') +
          '<path d="M-40 -16 L42 -16" stroke="#7a5634" stroke-width="2.6" stroke-linecap="round"/>' +
          '<path d="M-22 -33 Q0 -50 22 -33 L19 -31 L-19 -31 Z" fill="#6f8f72" stroke="#4a5f4e" stroke-width="1.2"/>' +
          '<path d="M-22 -33 Q-26 -35 -27 -38 M22 -33 Q26 -35 27 -38" stroke="#4a5f4e" stroke-width="1.2" stroke-linecap="round"/>' +
          '<circle cx="0" cy="-45" r="2" fill="#d8ae62"/>' +
          '<rect x="-19" y="-33" width="38" height="17" fill="#b1543f" stroke="#7f3a2b" stroke-width="1.2"/>' +
          '<rect x="-11" y="-29.5" width="22" height="10" rx="1" fill="#f7efdc" stroke="#8a6544" stroke-width=".9"/>' +
          '<path d="M0 -29.5 L0 -19.5 M-11 -24.5 L11 -24.5" stroke="#8a6544" stroke-opacity=".6" stroke-width=".8"/>' +
          '<path d="M-20 -16 L20 -16" stroke="#7f3a2b" stroke-width="1.6"/>' +
          '<path d="M-17 -16 L-17 -11 M17 -16 L17 -11" stroke="#d8ae62" stroke-width="1.3"/>' +
        '</g>' +

        /* 桥上：纸鸢 */
        '<g class="scene-kite">' +
          '<path d="M280 130 C 300 142 318 156 332 172" stroke="#6b5a45" stroke-opacity=".42" stroke-width=".9"/>' +
          '<path d="M280 130 C 286 139 276 146 282 155 C 287 162 279 168 284 176" stroke="#8d3f2f" stroke-opacity=".55" stroke-width="1"/>' +
          '<path d="M284 141 l4 -2.2 l2.2 4 l-4 2.2 Z" fill="#c9704f" opacity=".75"/>' +
          '<path d="M281 158 l4 -2.2 l2.2 4 l-4 2.2 Z" fill="#c9704f" opacity=".75"/>' +
          '<path d="M280 94 L295 112 L280 130 L265 112 Z" fill="#c9704f" stroke="#8d3f2f" stroke-width="1"/>' +
          '<path d="M280 94 L280 130 M265 112 L295 112" stroke="#f6e8ce" stroke-opacity=".8" stroke-width="1.1"/>' +
          '<path d="M280 94 L295 112 L280 112 Z" fill="#d8875f" opacity=".45"/>' +
        '</g>' +

        /* 桥上：行人 */
        '<g transform="translate(330 185) scale(.66)">' + scenePerson(0, 0, '#7b8f9a', 'straw') + '</g>' +
        '<g transform="translate(420 184) scale(.66)">' + scenePerson(0, 0, '#8a6f8f', 'cap') + '</g>' +
        '<g transform="translate(240 223) scale(.66)">' + scenePerson(0, 0, '#b98a5a', 'straw') + '</g>' +
        '<g transform="translate(510 218) scale(.7)">' + scenePerson(0, 0, '#7b8f6a', 'cap') + '</g>' +

        /* 桥上：骑马人 */
        '<g transform="translate(465 196) scale(.72)">' +
          '<ellipse cx="-1" cy="-16.5" rx="17" ry="7.5" fill="#96682f" stroke="#4a3b2c" stroke-opacity=".55" stroke-width="1.1"/>' +
          '<path d="M-12 -21 L-24 -32 L-31 -31 L-32 -25 L-22 -14 Z" fill="#96682f" stroke="#4a3b2c" stroke-opacity=".55" stroke-width="1.1"/>' +
          '<path d="M-29 -33 Q-38 -33 -41 -27 L-40 -23 Q-36 -21 -32 -24 L-27 -28 Z" fill="#96682f" stroke="#4a3b2c" stroke-opacity=".55" stroke-width="1.1"/>' +
          '<path d="M-29 -33 L-30 -38" stroke="#4a3b2c" stroke-opacity=".6" stroke-width="1.2" stroke-linecap="round"/>' +
          '<circle cx="-37" cy="-27.6" r=".9" fill="#3b3126"/>' +
          '<path d="M-12 -10 L-13 0 M-7 -9 L-7 0 M5 -9 L5 0 M11 -10 L13 0" stroke="#6b5a45" stroke-opacity=".8" stroke-width="2" stroke-linecap="round"/>' +
          '<path d="M15 -20 Q24 -18 22 -8 Q26 -10 27 -16" stroke="#6b5a45" stroke-opacity=".7" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
          '<path d="M-8 -22 L4 -22 L3 -14 L-7 -14 Z" fill="#b1543f" stroke="#7f3a2b" stroke-width=".9"/>' +
          '<path d="M-5 -35 L1 -35 L2 -24 L-6 -24 Z" fill="#7f8f6a" stroke="#4a3b2c" stroke-opacity=".4" stroke-width=".9"/>' +
          '<circle cx="-2" cy="-38.4" r="3.1" fill="#e8c9a6" stroke="#4a3b2c" stroke-opacity=".45" stroke-width=".8"/>' +
          '<path d="M-7.2 -40.6 Q-2 -44.6 3.2 -40.6 L3.2 -39.4 L-7.2 -39.4 Z" fill="#4a3a28"/>' +
          '<path d="M-5 -31 L-10 -26 M2 -31 L7 -27" stroke="#4a3b2c" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/>' +
          '<path d="M-9 -27 Q-20 -26 -30 -24" stroke="#6b5a45" stroke-opacity=".5" stroke-width="1"/>' +
        '</g>' +

        /* 左岸石埠 */
        '<path d="M0 304 L150 298 C 176 298 194 306 206 320 C 226 344 238 374 246 420 L0 420 Z" fill="#dcc7a0" opacity=".78"/>' +
        '<path d="M0 304 L150 298 C 176 298 194 306 206 320 C 226 344 238 374 246 420" stroke="#8a7550" stroke-opacity=".32" stroke-width="1.4"/>' +
        '<path d="M162 310 L172 320 M176 318 L188 330 M190 330 L204 344" stroke="#8a7550" stroke-opacity=".3" stroke-width="1.2"/>' +
        '<path d="M40 352 L40 420 M96 356 L96 420 M150 360 L150 420 M196 372 L196 420" stroke="#8a7550" stroke-opacity=".14" stroke-width="1"/>' +

        /* 左岸水阁 */
        '<g>' +
          '<path d="M-12 270 C 2 250 16 234 32 228 L112 228 C 126 234 140 250 152 268 L144 280 C 130 262 118 252 110 250 L34 250 C 20 254 4 266 -4 280 Z" fill="#8a8478" stroke="#4f463a" stroke-width="1.2"/>' +
          '<path d="M-4 280 C 4 266 20 254 34 250 L110 250 C 118 252 130 262 144 280" stroke="#4f463a" stroke-opacity=".55" stroke-width="2.4"/>' +
          '<path d="M-12 270 C 2 250 16 234 32 228 L112 228 C 126 234 140 250 152 268" stroke="#b3ab9b" stroke-opacity=".5" stroke-width="1.2"/>' +
          '<path d="M-12 270 Q-16 267 -15 262 M152 268 Q156 265 155 260" fill="none" stroke="#4f463a" stroke-width="1.6" stroke-linecap="round"/>' +
          '<path d="M30 226 L114 226" stroke="#4f463a" stroke-width="2.6"/>' +
          '<path d="M30 226 Q20 226 16 222 M114 226 Q124 226 128 222" stroke="#4f463a" stroke-width="1.8" stroke-linecap="round"/>' +
          '<g stroke="#5f574b" stroke-opacity=".45" stroke-width="1">' +
            '<path d="M40 230 Q36 240 32 248"/><path d="M58 230 Q56 240 54 248"/><path d="M76 230 Q75 240 75 248"/>' +
            '<path d="M94 230 Q95 240 97 248"/><path d="M108 230 Q111 239 114 246"/>' +
          '</g>' +
          '<path d="M4 250 L138 250 L138 330 L4 330 Z" fill="#f3e8d1" stroke="#6b5a45" stroke-opacity=".32" stroke-width="1.2"/>' +
          '<path d="M4 250 L138 250 L138 258 L4 258 Z" fill="#4a3b2c" opacity=".12"/>' +
          '<rect x="4" y="250" width="5" height="84" fill="#a9513b"/>' +
          '<rect x="132" y="250" width="5" height="84" fill="#a9513b"/>' +
          '<rect x="26" y="262" width="52" height="40" fill="#f9f2e2" stroke="#8a6544" stroke-width="1.4"/>' +
          '<path d="M26 275 L78 275 M26 289 L78 289 M43 262 L43 302 M60 262 L60 302" stroke="#8a6544" stroke-opacity=".7" stroke-width="1"/>' +
          '<rect x="96" y="252" width="26" height="64" fill="#b1543f" stroke="#7f3a2b" stroke-width="1.2"/>' +
          '<path d="M96 252 L122 252" stroke="#7a5634" stroke-width="2"/>' +
          '<path d="M100 256 L118 256" stroke="#e8c98c" stroke-opacity=".5" stroke-width=".8"/>' +
          '<text x="109" y="294" font-family="Songti SC, STSong, SimSun, serif" font-size="17" font-weight="700" fill="#f7efdc" text-anchor="middle">酒</text>' +
          '<path d="M-6 330 L146 330 L146 338 L-6 338 Z" fill="#8a5a34" stroke="#6b4a2a" stroke-width="1"/>' +
          '<g stroke="#7a5634" stroke-width="1.6">' +
            '<path d="M-4 320 L146 320 M-4 318 L-4 330 M20 318 L20 330 M44 318 L44 330 M68 318 L68 330 M92 318 L92 330 M116 318 L116 330 M146 318 L146 330"/>' +
          '</g>' +
          '<path d="M8 338 L134 338 L134 420 L8 420 Z" fill="#ecdfc6" stroke="#6b5a45" stroke-opacity=".28" stroke-width="1.2"/>' +
          '<path d="M8 338 L134 338 L134 346 L8 346 Z" fill="#4a3b2c" opacity=".12"/>' +
          '<rect x="18" y="350" width="40" height="34" fill="#4a3b2c" opacity=".55"/>' +
          '<path d="M18 364 L58 364 M18 376 L58 376" stroke="#8a6544" stroke-opacity=".3" stroke-width="1"/>' +
          '<path d="M12 342 L64 342 L60 354 L16 354 Z" fill="#e4d0a4" stroke="#8a6544" stroke-width="1"/>' +
          '<path d="M20 343 L23 353 M29 343 L31 353 M38 343 L39 353 M47 343 L47 353 M56 343 L54 353" stroke="#b1543f" stroke-opacity=".45" stroke-width="2"/>' +
          '<rect x="14" y="382" width="48" height="7" fill="#8a5a34" stroke="#6b4a2a" stroke-width="1"/>' +
          '<path d="M14 382 L62 382" stroke="#b98a5a" stroke-width="1.3"/>' +
          '<path d="M22 375 q-2 4 0 7 h7 q2 -3 0 -7 Z" fill="#cba86a" stroke="#8a6544" stroke-width=".8"/>' +
          '<path d="M35 374 q-2 4 0 8 h8 q2 -4 0 -8 Z" fill="#d9b878" stroke="#8a6544" stroke-width=".8"/>' +
          '<path d="M50 375 q-2 4 0 7 h6 q2 -3 0 -7 Z" fill="#cba86a" stroke="#8a6544" stroke-width=".8"/>' +
          '<path d="M22 374 L29 374 M35 373 L43 373 M50 374 L56 374" stroke="#7a5634" stroke-opacity=".55" stroke-width="1"/>' +
          '<rect x="70" y="356" width="30" height="64" fill="#6b5236" stroke="#7f3a2b" stroke-width="1.4"/>' +
          '<path d="M85 356 L85 420" stroke="#4a3b2c" stroke-opacity=".4" stroke-width="1"/>' +
          '<circle cx="92" cy="388" r="1.4" fill="#d8ae62"/>' +
          '<rect x="106" y="352" width="24" height="32" fill="#f9f2e2" stroke="#8a6544" stroke-width="1.2"/>' +
          '<path d="M106 368 L130 368 M118 352 L118 384" stroke="#8a6544" stroke-opacity=".65" stroke-width="1"/>' +
          '<path d="M16 256 L16 262" stroke="#7a5634" stroke-width="1.2"/>' +
          '<ellipse cx="16" cy="269" rx="5.4" ry="7" fill="#b1543f" stroke="#7f3a2b" stroke-width="1"/>' +
          '<path d="M12 262 L20 262 M12 276 L20 276" stroke="#d8ae62" stroke-width="1.4"/>' +
          '<path d="M16 276 L16 282 M13 282 L19 282" stroke="#d8ae62" stroke-width="1.2"/>' +
          '<path d="M144 268 L144 274" stroke="#7a5634" stroke-width="1.2"/>' +
          '<ellipse cx="144" cy="281" rx="5" ry="6.4" fill="#b1543f" stroke="#7f3a2b" stroke-width="1"/>' +
          '<path d="M140 274 L148 274 M140 288 L148 288" stroke="#d8ae62" stroke-width="1.3"/>' +
          '<path d="M144 288 L144 293" stroke="#d8ae62" stroke-width="1.1"/>' +
        '</g>' +

        /* 岸边垂柳 */
        '<g>' +
          '<ellipse cx="196" cy="350" rx="26" ry="6.5" fill="#8a7550" opacity=".13"/>' +
          '<path d="M204 352 C 198 330 192 308 186 290 C 183 281 181 275 179 268" fill="none" stroke="#6b4a2a" stroke-opacity=".85" stroke-width="5.2" stroke-linecap="round"/>' +
          '<path d="M182 286 C 168 278 156 274 146 276 M184 282 C 198 272 210 268 220 270 M188 292 C 178 288 168 288 160 292" fill="none" stroke="#6b4a2a" stroke-opacity=".65" stroke-width="2.2" stroke-linecap="round"/>' +
          '<g fill="#6f8f5f" opacity=".42">' +
            '<ellipse cx="152" cy="268" rx="10" ry="6"/><ellipse cx="164" cy="262" rx="11" ry="6.5"/>' +
            '<ellipse cx="178" cy="258" rx="12" ry="7"/><ellipse cx="192" cy="258" rx="11" ry="6.5"/>' +
            '<ellipse cx="206" cy="262" rx="10" ry="6"/><ellipse cx="218" cy="268" rx="7" ry="5"/>' +
            '<ellipse cx="172" cy="272" rx="8" ry="5"/><ellipse cx="200" cy="272" rx="8" ry="5"/>' +
          '</g>' +
          '<g fill="none" stroke="#5f7f52" stroke-opacity=".5" stroke-width="1.5" stroke-linecap="round">' +
            '<path d="M148 274 C 142 300 134 322 128 336"/>' +
            '<path d="M156 266 C 152 298 150 326 150 348"/>' +
            '<path d="M170 261 C 168 296 168 326 169 354"/>' +
            '<path d="M184 259 C 185 298 186 328 186 352"/>' +
            '<path d="M198 261 C 202 294 206 320 209 340"/>' +
            '<path d="M212 266 C 220 288 226 302 231 312"/>' +
          '</g>' +
          '<g fill="#6f8f5f" opacity=".33">' +
            '<ellipse cx="140" cy="298" rx="5" ry="17" transform="rotate(-9 140 298)"/>' +
            '<ellipse cx="151" cy="310" rx="6" ry="21" transform="rotate(-3 151 310)"/>' +
            '<ellipse cx="163" cy="314" rx="6.5" ry="24"/>' +
            '<ellipse cx="176" cy="316" rx="7" ry="26"/>' +
            '<ellipse cx="190" cy="312" rx="6.5" ry="23"/>' +
            '<ellipse cx="203" cy="298" rx="5.5" ry="19" transform="rotate(5 203 298)"/>' +
            '<ellipse cx="214" cy="284" rx="4.5" ry="14" transform="rotate(9 214 284)"/>' +
          '</g>' +
          '<g fill="#5f7f52" opacity=".2">' +
            '<ellipse cx="170" cy="298" rx="3" ry="14"/><ellipse cx="186" cy="296" rx="3" ry="13"/>' +
          '</g>' +
        '</g>' +

        /* 放鞭炮的孩童 */
        '<g transform="translate(222 360) scale(.92)">' +
          scenePerson(0, 0, '#bf5f45', 'straw') +
        '</g>' +
        '<path d="M226 346 L234 338" stroke="#bf5f45" stroke-width="2.6" stroke-linecap="round"/>' +
        '<path d="M230 343 L252 298" stroke="#b98a45" stroke-width="1.9" stroke-linecap="round"/>' +
        '<g class="scene-crackers" stroke-linecap="round">' +
          '<path d="M252 300 L253 347" stroke="#7f3a2b" stroke-opacity=".5" stroke-width="1"/>' +
          '<g stroke="#7f3a2b" stroke-width="1">' +
            '<rect x="247" y="302" width="10" height="11" rx="1.8" fill="#bf5f45"/>' +
            '<rect x="248" y="313" width="10" height="11" rx="1.8" fill="#a9513b"/>' +
            '<rect x="247" y="324" width="10" height="11" rx="1.8" fill="#bf5f45"/>' +
            '<rect x="248" y="335" width="10" height="11" rx="1.8" fill="#a9513b"/>' +
          '</g>' +
          '<path d="M253 346 L253 352 M249 352 L257 352" stroke="#b98a45" stroke-width="1.6"/>' +
          '<path d="M258 338 l3 -3 M259 340 l5 0" stroke="#d8ae62" stroke-width="1.1"/>' +
        '</g>' +

        /* 右岸石埠 */
        '<path d="M620 300 C 660 296 690 297 720 294 L720 420 L620 420 Z" fill="#dcc7a0" opacity=".78"/>' +
        '<path d="M620 300 C 660 296 690 297 720 294" stroke="#8a7550" stroke-opacity=".32" stroke-width="1.4"/>' +
        '<path d="M640 304 L640 420 M676 302 L676 420" stroke="#8a7550" stroke-opacity=".14" stroke-width="1"/>' +

        /* 右岸茶铺 */
        '<g>' +
          '<path d="M622 288 L720 276 L720 420 L622 420 Z" fill="#f3e8d1" stroke="#6b5a45" stroke-opacity=".3" stroke-width="1.2"/>' +
          '<path d="M612 294 C 640 272 666 252 694 240 L720 234 L720 254 L696 260 C 668 272 642 294 620 312 Z" fill="#8a8478" stroke="#4f463a" stroke-width="1.2"/>' +
          '<path d="M620 312 C 642 294 668 272 696 260 L720 254" stroke="#4f463a" stroke-opacity=".55" stroke-width="2.4"/>' +
          '<path d="M612 294 C 640 272 666 252 694 240 L720 234" stroke="#b3ab9b" stroke-opacity=".5" stroke-width="1.2"/>' +
          '<path d="M612 294 Q606 291 604 285" stroke="#4f463a" stroke-width="1.6" stroke-linecap="round"/>' +
          '<path d="M694 240 L720 234" stroke="#4f463a" stroke-width="2.4"/>' +
          '<g stroke="#5f574b" stroke-opacity=".4" stroke-width="1">' +
            '<path d="M640 272 Q634 282 628 292"/><path d="M664 261 Q658 272 652 282"/>' +
            '<path d="M688 251 Q684 260 678 270"/><path d="M710 244 Q708 251 704 260"/>' +
          '</g>' +
          '<path d="M622 288 L720 276 L720 286 L622 298 Z" fill="#4a3b2c" opacity=".1"/>' +
          '<rect x="628" y="290" width="5" height="130" fill="#a9513b"/>' +
          '<rect x="702" y="278" width="5" height="142" fill="#a9513b"/>' +
          '<rect x="636" y="302" width="40" height="28" fill="#f9f2e2" stroke="#8a6544" stroke-width="1.3"/>' +
          '<path d="M636 316 L676 316 M656 302 L656 330" stroke="#8a6544" stroke-opacity=".65" stroke-width="1"/>' +
          '<rect x="630" y="350" width="36" height="32" fill="#4a3b2c" opacity=".55"/>' +
          '<path d="M630 364 L666 364 M630 376 L666 376" stroke="#8a6544" stroke-opacity=".3" stroke-width="1"/>' +
          '<path d="M626 342 L672 340 L668 352 L630 354 Z" fill="#e4d0a4" stroke="#8a6544" stroke-width="1"/>' +
          '<path d="M634 343 L636 353 M644 343 L645 353 M654 342 L654 352 M664 342 L662 352" stroke="#b1543f" stroke-opacity=".45" stroke-width="2"/>' +
          '<rect x="628" y="382" width="40" height="7" fill="#8a5a34" stroke="#6b4a2a" stroke-width="1"/>' +
          '<path d="M628 382 L668 382" stroke="#b98a5a" stroke-width="1.3"/>' +
          '<path d="M638 374 q-2 4 0 8 h7 q2 -4 0 -8 Z" fill="#cba86a" stroke="#8a6544" stroke-width=".8"/>' +
          '<ellipse cx="655" cy="377.4" rx="7" ry="4.6" fill="#c46a4a" stroke="#8a3f2c" stroke-width=".8"/>' +
          '<path d="M648 374 Q655 371 662 374" fill="none" stroke="#8a3f2c" stroke-width=".9"/>' +
          '<path d="M662 376 Q667 376 667 379" fill="none" stroke="#c46a4a" stroke-width="1.3"/>' +
          '<path d="M655 371 L655 368" stroke="#8a3f2c" stroke-width="1"/>' +
          '<path d="M649 366 Q652 362 649 358 M659 367 Q662 363 659 358" fill="none" stroke="#f7f1e2" stroke-opacity=".65" stroke-width="1.1"/>' +
          '<rect x="690" y="346" width="26" height="74" fill="#6b5236" stroke="#7f3a2b" stroke-width="1.3"/>' +
          '<path d="M703 346 L703 420" stroke="#4a3b2c" stroke-opacity=".4" stroke-width="1"/>' +
          '<circle cx="711" cy="384" r="1.4" fill="#d8ae62"/>' +
          '<path d="M640 292 L640 298" stroke="#7a5634" stroke-width="1.2"/>' +
          '<ellipse cx="640" cy="305" rx="5" ry="6.4" fill="#b1543f" stroke="#7f3a2b" stroke-width="1"/>' +
          '<path d="M636 299 L644 299 M636 311 L644 311" stroke="#d8ae62" stroke-width="1.3"/>' +
          '<path d="M640 311 L640 316" stroke="#d8ae62" stroke-width="1.1"/>' +
          '<path d="M690 290 L690 298" stroke="#7a5634" stroke-width="1.2"/>' +
          '<path d="M688 290 L716 290 L716 296 L688 296 Z" fill="#7a5634"/>' +
          '<rect x="692" y="296" width="20" height="62" fill="#b1543f" stroke="#7f3a2b" stroke-width="1.2"/>' +
          '<path d="M696 300 L708 300" stroke="#e8c98c" stroke-opacity=".5" stroke-width=".8"/>' +
          '<text x="702" y="332" font-family="Songti SC, STSong, SimSun, serif" font-size="15" font-weight="700" fill="#f7efdc" text-anchor="middle">茶</text>' +
          '<path d="M676 392 L690 390 L690 398 L676 400 Z" fill="#b98a5a" stroke="#7a5634" stroke-width="1"/>' +
          '<ellipse cx="683" cy="390" rx="4" ry="2.4" fill="#d9b878" stroke="#8a6544" stroke-width=".8"/>' +
        '</g>' +

        /* 右岸木栈台 */
        '<g>' +
          '<path d="M508 342 L624 336 L624 354 L508 360 Z" fill="#b98a5a" stroke="#7a5634" stroke-width="1.2"/>' +
          '<path d="M530 341 L530 358 M556 340 L556 357 M582 339 L582 356 M608 338 L608 355" stroke="#8a6544" stroke-opacity=".5" stroke-width="1"/>' +
          '<path d="M514 358 L514 404 M548 356 L548 402 M586 355 L586 401 M618 354 L618 400" stroke="#7a5634" stroke-width="2.4" stroke-linecap="round"/>' +
          '<path d="M514 404 q6 3 12 0 M548 402 q6 3 12 0 M586 401 q6 3 12 0 M618 400 q6 3 12 0" stroke="#5f8b86" stroke-opacity=".4" stroke-width="1.2"/>' +
        '</g>' +
        '<g>' +
          '<path d="M522 316 Q566 272 610 316 Q602 310 594 316 Q586 308 578 316 Q570 308 562 316 Q554 308 546 316 Q538 308 522 316 Z" fill="#bf5a42" stroke="#7f3a2b" stroke-width="1.4"/>' +
          '<path d="M566 294 L534 313 M566 294 L546 314 M566 294 L566 314 M566 294 L586 314 M566 294 L598 313" stroke="#a04a35" stroke-opacity=".5" stroke-width="1"/>' +
          '<path d="M566 316 L566 344" stroke="#7a5634" stroke-width="2.2"/>' +
          '<circle cx="566" cy="292" r="2.2" fill="#d8ae62"/>' +
          scenePerson(570, 344, '#6d8ba0', 'cap') +
          '<ellipse cx="534" cy="343" rx="9" ry="4.4" fill="#c9a05a" stroke="#8a6544" stroke-width="1"/>' +
          '<ellipse cx="534" cy="339.6" rx="9" ry="3.6" fill="#d9b878" stroke="#8a6544" stroke-width="1"/>' +
          '<path d="M528 338 L540 338 M529 342 L539 342" stroke="#9a6a3e" stroke-opacity=".7" stroke-width="1"/>' +
          '<ellipse cx="548" cy="349" rx="8" ry="4" fill="#c9a05a" stroke="#8a6544" stroke-width="1"/>' +
          '<rect x="600" y="336" width="20" height="15" fill="#b98a5a" stroke="#7a5634" stroke-width="1"/>' +
          '<path d="M600 341 L620 341 M600 346 L620 346" stroke="#8a6544" stroke-opacity=".5" stroke-width="1"/>' +
          '<path d="M604 336 Q612 329 620 336 Z" fill="#b1543f" stroke="#7f3a2b" stroke-width=".9"/>' +
        '</g>' +

        /* 乌篷船 */
        '<g class="scene-boat-a">' +
          '<path d="M278 388 Q334 412 420 384 L428 390 Q356 420 270 394 Z" fill="#8a5a34" stroke="#4a3b2c" stroke-opacity=".6" stroke-width="1.4"/>' +
          '<path d="M283 391 Q336 406 417 387" stroke="#5c3d22" stroke-opacity=".38" stroke-width="1.5"/>' +
          '<path d="M274 397 Q336 416 424 391" stroke="#4a3b2c" stroke-opacity=".25" stroke-width="1.4"/>' +
          '<path d="M310 388 Q310 356 340 352 L370 352 Q400 356 400 388 Z" fill="#6f8f72" stroke="#4a5f4e" stroke-width="1.2"/>' +
          '<path d="M318 388 Q320 362 340 357 M332 388 Q333 360 350 355 M348 388 Q350 360 366 355 M380 388 Q382 362 392 358" stroke="#5a7a5c" stroke-opacity=".5" stroke-width="1"/>' +
          '<path d="M302 387 L412 387" stroke="#5c3d22" stroke-opacity=".45" stroke-width="1.2"/>' +
          '<path d="M288 382 Q288 370 292 366" stroke="#7a5634" stroke-width="1.6"/>' +
          '<ellipse cx="291" cy="369" rx="4.6" ry="5.6" fill="#b1543f" stroke="#7f3a2b" stroke-width=".9"/>' +
          '<path d="M291 375 L291 379" stroke="#d8ae62" stroke-width="1.2"/>' +
          scenePerson(422, 384, '#8a6f5f', 'straw') +
          '<path d="M426 382 L448 410" stroke="#6b5a45" stroke-opacity=".75" stroke-width="1.8" stroke-linecap="round"/>' +
        '</g>' +

        /* 小舟 */
        '<g class="scene-boat-b">' +
          '<path d="M452 396 Q496 414 538 392 L544 397 Q500 420 444 401 Z" fill="#9a6a3e" stroke="#4a3b2c" stroke-opacity=".6" stroke-width="1.3"/>' +
          '<path d="M457 399 Q498 413 534 394" stroke="#6b4a2a" stroke-opacity=".35" stroke-width="1.4"/>' +
          '<path d="M462 396 L536 393" stroke="#6b4a2a" stroke-opacity=".4" stroke-width="1"/>' +
          '<path d="M474 394 L486 388 L498 392 L486 397 Z" fill="#c9a05a" stroke="#7a5634" stroke-width="1"/>' +
          scenePerson(536, 389, '#8a6f5f', 'straw') +
          '<path d="M540 386 L518 414" stroke="#6b5a45" stroke-opacity=".75" stroke-width="1.7" stroke-linecap="round"/>' +
        '</g>' +

      '</svg>' +
      '</div>';
  }

  function renderLanding() {
    landingEl.innerHTML = '' +
      '<div class="landing">' +
        '<div class="landing-head">' +
          '<div class="landing-seal" aria-hidden="true">汴</div>' +
          '<p class="landing-eyebrow">汴京 · 虹桥商街</p>' +
          '<h1 class="landing-title">大宋百商图</h1>' +
          '<p class="landing-sub">清地置业，买菜待客，<br>把一条冷清街巷经营成你的钱袋子。</p>' +
          '<div class="landing-tags"><span>1~4 人</span><span>同屏轮流</span><span>约 45 分钟</span></div>' +
        '</div>' +
        landingHeroHTML() +
        '<div class="landing-btns">' +
          '<button type="button" class="btn btn-primary btn-lg" data-action="landing-start">开始游戏</button>' +
          '<button type="button" class="btn btn-ghost" data-action="rules">查看规则</button>' +
        '</div>' +
        '<p class="landing-credit">@imStar100</p>' +
      '</div>';
    landingEl.hidden = false;
    setupEl.hidden = true;
    gameEl.hidden = true;
    document.body.classList.add('is-landing');
  }

  /* ------------------------------ 设置页 ------------------------------ */

  function renderSetup() {
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

        '<section class="setup-block">' +
          '<div class="block-head"><h2>起始资源</h2><span>后位玩家多 1 铜钱</span></div>' +
          '<div class="stepper-grid">' +
            stepper('startingCash', '起始铜钱', c.startingCash, 0, 20) +
            stepper('startingLowMenus', '初始四品菜', c.startingLowMenus, 0, 8) +
            stepper('startingMidMenus', '初始三品菜', c.startingMidMenus, 0, 8) +
          '</div>' +
          '<p class="tiny">默认每人 6 张四品菜、2 张三品菜，洗混后放入雅阁。</p>' +
        '</section>' +

        '<section class="setup-block">' +
          '<div class="block-head"><h2>胜利条件</h2><span>同时满足</span></div>' +
          '<div class="stepper-grid two">' +
            stepper('victoryCash', '铜钱数', c.victoryCash, 0, 200) +
            stepper('victoryShops', '房屋数', c.victoryShops, 0, 8) +
          '</div>' +
          '<p class="tiny">任意一项为 0 则不计入；两项都为 0 时按 8 间店铺计算。</p>' +
        '</section>' +

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

  function renderGame() {
    var game = DSM.state;
    if (!game) { UI.screen = 'setup'; renderSetup(); return; }
    var p = game.players[game.currentPlayerIndex];
    var phase = game.phase;
    var next = DSM.nextClearableLand(p);
    var buildable = DSM.canBuild(p);
    var preview = phase === 'phase3' ? DSM.previewServe() : null;

    var html = '' +
      '<header class="topbar">' +
        '<a class="back-btn" href="../index.html" aria-label="返回合集">‹</a>' +
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
            resourceCell('雅阁', p.prep.length, compositionText(p.prep), '牌库') +
            resourceCell('后厨', p.kitchen.length, compositionText(p.kitchen), '弃牌堆') +
            resourceCell('弃菜', p.abandoned.length, '本局已弃', '移出') +
          '</div>' +
          '<div class="sub-head"><h3>自家地契</h3><span>' + (next ? '下一块：第 ' + next.index + ' 块 · 清地 ' + next.clearCost + ' 铜钱' : '八块地已全部清理') + '</span></div>' +
          '<div class="land-grid">' +
            p.lands.map(function (land, index) {
              return landTile(land, index, next);
            }).join('') +
          '</div>' +
          (buildable.length ?
            '<div class="build-row"><span class="build-label">待修建 ' + buildable.length + ' 间</span><button type="button" class="btn btn-small btn-outline" data-action="build">去修建</button></div>' :
            '<div class="build-row empty"><span class="build-label">暂无待修建店铺</span></div>') +
        '</section>' +

        '<div class="right-col">' +
          '<section class="panel customer-panel">' +
            '<div class="panel-head"><h2>候客区</h2><span class="panel-note">当前客人必招待</span></div>' +
            '<div class="customer-list' + (game.customerMarket.length >= 5 ? ' dense' : '') + '" style="--cust-slots:' + Math.max(4, game.customerMarket.length) + '">' +
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
                  '<span class="customer-shops">' + customer.visitShopIds.map(function (id) { return esc(DSM.shopById[id].name); }).join(' · ') + '</span>' +
                '</button>';
              }).join('') +
            '</div>' +
            '<p class="panel-tip">按序号排队，首位必招待；付 1 铜钱可跳过。</p>' +
          '</section>' +

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
    setTimeout(scheduleModal, 40);
  }

  function compositionText(menuIds) {
    var comp = DSM.composition(menuIds);
    return comp.list.length ? comp.list.map(function (item) { return item.count + ' ' + item.name; }).join(' · ') : '空';
  }

  function resourceCell(label, value, detail, tag) {
    return '<div class="res-cell">' +
      '<div class="res-top"><span>' + label + '</span><small>' + tag + '</small></div>' +
      '<strong>' + value + '</strong>' +
      '<p>' + esc(detail) + '</p>' +
    '</div>';
  }

  function landTile(land, index, next) {
    var classes = ['land-tile'];
    if (land.shopId) classes.push('built');
    else if (land.cleared) classes.push('reserved');
    else classes.push('uncleared');
    if (next && next.id === land.id && !land.cleared) classes.push('next');
    var body;
    if (land.shopId) {
      var shop = DSM.shopById[land.shopId];
      body = '<span class="land-shop">' + esc(shop.name) + '</span><span class="land-note">' + shopIncomeText(shop) + '</span>';
    } else if (land.cleared) {
      var reserved = DSM.shopById[land.reservedShopId];
      body = '<span class="land-shop">' + (reserved ? esc(reserved.name) : '空地') + '</span>' +
        '<span class="land-note">' + (reserved ? '待建 ' + reserved.buildCost + ' 铜' : '未认购') + '</span>';
    } else {
      body = '<span class="land-cost">' + (land.clearCost === 0 ? '免费' : '清地 ' + land.clearCost) + '</span>' +
        '<span class="land-note">未清理</span>';
    }
    return '<div class="' + classes.join(' ') + '">' +
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
    var body = '' +
      '<div class="rule-list">' +
        '<div class="rule-item"><b>目标</b><p>率先同时达成「' + victoryLine() + '」的玩家获胜。</p></div>' +
        '<div class="rule-item"><b>购买</b><p>每回合二选一：买 1 张菜单，或按顺序清 1 块地并认购展示区 1 家店铺（展示区无牌时只能清地）。修建已认购的店铺不占行动，可修任意多间。</p></div>' +
        '<div class="rule-item"><b>备菜</b><p>可花 3 铜钱从后厨弃 1 张菜（可不弃），用于精简牌库。</p></div>' +
        '<div class="rule-item"><b>招待</b><p>必须招待候客区首位客人，或付 1 铜钱跳过（最后一位不能跳）。被跳过的客人会带着这笔钱，谁招待归谁。</p></div>' +
        '<div class="rule-item"><b>吃菜</b><p>客人按牌面吃掉若干张雅阁菜品；雅阁空了会把后厨洗回雅阁。被吃掉的菜按品级产生收益：四品 1、三品 2、二品 3、一品 1 骰 +2。</p></div>' +
        '<div class="rule-item"><b>逛店</b><p>客人随后会去他能去的已建店铺消费，每家店、每份都产生收益；店铺联动与事件加成照常结算。</p></div>' +
        '<div class="rule-item"><b>事件</b><p>事件牌混在客人牌堆中，抽到立即生效。长期公告会持续影响全场，直到被新公告替换。</p></div>' +
        '<div class="rule-item"><b>选址</b><p>清地费依次为 0 / 2 / 3 / 4 / 7 / 8 / 9 / 10 铜钱；土地必须按顺序清理。</p></div>' +
      '</div>';
    openModal('rules', '玩法要诀', body, '<button type="button" class="btn btn-primary" data-action="close-modal">知道了</button>');
  }

  function victoryLine() {
    var game = DSM.state;
    if (!game) return '50 铜钱 + 8 间店铺';
    var parts = [];
    if (game.victory.cash) parts.push(game.victory.cash + ' 铜钱');
    if (game.victory.shops) parts.push(game.victory.shops + ' 间店铺');
    return parts.join(' + ');
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
    }).concat((summary.shopResults || []).map(function (item) {
      return '<li class="shop-break"><span>' + esc(item.shopName) + ' ' + item.parts.map(function (p) { return esc(p.label) + '+' + p.value; }).join('、') + '</span><b>+' + item.total + '</b></li>';
    })).join('');

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
      '<a class="btn btn-ghost" href="../index.html">返回合集</a>', { dismissible: false });
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

  function openShop(uid) {
    var game = DSM.state;
    var card = game.shopMarket.filter(function (item) { return item.uid === uid; })[0];
    if (!card) return;
    var shop = DSM.shopById[card.id];
    var effect = shopEffectText(shop);
    var body = '<div class="shop-detail">' +
        '<span class="shop-detail-seal">' + sealChar(shop.name) + '</span>' +
        '<h3>' + esc(shop.name) + '</h3>' +
        '<div class="detail-stats">' +
          '<span>建造费 <b>' + coin(13) + shop.buildCost + '</b></span>' +
          '<span>基础收益 <b>' + shopIncomeText(shop) + '</b></span>' +
        '</div>' +
        (shopBonusText(shop) ? '<p class="detail-line">联动：' + esc(shopBonusText(shop)) + '</p>' : '') +
        (effect ? '<p class="detail-line">效果：' + esc(effect) + '</p>' : '') +
        '<p class="tiny">清地时可以从展示区认购这家店铺，建造后才会产生收益。</p>' +
      '</div>';
    openModal('shop', '店铺详情', body, '<button type="button" class="btn btn-ghost" data-action="close-modal">收起</button>');
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
    if (game.eventQueue.length) { openEvent(); return; }
    if (game.pendingSummary && UI.summaryShown !== game.pendingSummary.id) { openSummary(game.pendingSummary); return; }
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
        UI.screen = 'setup';
        renderSetup();
        break;
      case 'landing-back':
        UI.screen = 'landing';
        renderLanding();
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
      case 'inspect-customer':
        toast('招待时才会结算这位客人');
        break;
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
    else renderGame();
  }

  render();
})();
