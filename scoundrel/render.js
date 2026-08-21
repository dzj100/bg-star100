/* ============================================================
   无赖勇者 Scoundrel - 渲染与交互（含打击感/动画）
   ============================================================ */
(function () {
  'use strict';

  var G = window.Scoundrel;
  var SAVE_KEY = 'scoundrel-save-v1';
  // 卡面主题图标：按类型与数值分档（怪物/武器/血瓶 各 3 档强弱）
  var cardIcon = {
    H: ['assets/icons/potion-1.png', 'assets/icons/potion-2.png', 'assets/icons/potion-3.png'],
    D: ['assets/icons/weapon-1.png', 'assets/icons/weapon-2.png', 'assets/icons/weapon-3.png'],
    S: ['assets/icons/monster-1.png', 'assets/icons/monster-2.png', 'assets/icons/monster-3.png'],
    C: ['assets/icons/monster-1.png', 'assets/icons/monster-2.png', 'assets/icons/monster-3.png']
  };
  function cardIconTier(card) {
    var r = card.rank;
    if (card.suit === 'H' || card.suit === 'D') return r <= 4 ? 0 : r <= 7 ? 1 : 2;
    return r <= 5 ? 0 : r <= 9 ? 1 : 2;
  }

  var state = null;
  var busy = false;
  var weaponPop = false;
  // 房间 Grid 槽位追踪：保留消耗后卡牌位置，仅在进新房间时紧凑补位
  var prevSlotRefs = [null, null, null, null];

  // 屏幕震动（trauma 模型）
  var trauma = 0;
  var shakeRaf = null;
  var shakeT = 0;
  var lastShakeT = 0;

  function $(id) { return document.getElementById(id); }
  var roomEl = $('room');
  var hpBarEl = $('hpBar');
  var fxLayer = $('fxLayer');

  /* ================= 特效 ================= */

  function addTrauma(a) {
    trauma = Math.min(1, trauma + a);
    if (!shakeRaf) {
      lastShakeT = performance.now();
      shakeRaf = requestAnimationFrame(shakeTick);
    }
  }

  function shakeTick(t) {
    if (trauma <= 0.002) {
      trauma = 0;
      shakeRaf = null;
      $('shakeRoot').style.transform = '';
      return;
    }
    var dt = Math.min(0.05, (t - lastShakeT) / 1000);
    lastShakeT = t;
    trauma = Math.max(0, trauma - 1.5 * dt);
    shakeT += dt * 30;
    var s = trauma * trauma;
    var sx = 9 * s * Math.sin(shakeT * 1.7);
    var sy = 7 * s * Math.sin(shakeT * 2.3 + 1.2);
    var rot = 0.9 * s * Math.sin(shakeT * 1.1);
    $('shakeRoot').style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) rotate(' + rot.toFixed(3) + 'deg)';
    shakeRaf = requestAnimationFrame(shakeTick);
  }

  function flash(cls) {
    var f = $('flashOverlay');
    f.className = '';
    void f.offsetWidth;
    f.className = cls;
    setTimeout(function () { if (f.className === cls) f.className = ''; }, 340);
  }

  function floatText(x, y, text, cls) {
    var el = document.createElement('div');
    el.className = 'fx-float ' + (cls || '');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    fxLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  function burst(x, y, n, colors) {
    for (var i = 0; i < n; i++) {
      (function () {
        var p = document.createElement('div');
        p.className = 'fx-particle';
        var size = 4 + Math.random() * 6;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.setProperty('--dx', ((Math.random() * 2 - 1) * 80).toFixed(0) + 'px');
        p.style.setProperty('--dy', (-Math.random() * 100 - 10).toFixed(0) + 'px');
        fxLayer.appendChild(p);
        setTimeout(function () { p.remove(); }, 660);
      })();
    }
  }

  function ghostCard(el, gx, gy) {
    var g = el.cloneNode(true);
    g.classList.remove('deal', 'kick-out', 'pressing');
    g.classList.add('fx-ghost');
    var r = el.getBoundingClientRect();
    g.style.left = r.left + 'px';
    g.style.top = r.top + 'px';
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    g.style.setProperty('--gx', gx + 'px');
    g.style.setProperty('--gy', gy + 'px');
    fxLayer.appendChild(g);
    setTimeout(function () { g.remove(); }, 520);
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'fx-toast';
    el.textContent = msg;
    fxLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 1700);
  }

  function center(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function jolt(el) {
    el.classList.remove('jolt');
    void el.offsetWidth;
    el.classList.add('jolt');
  }

  /* ================= 渲染 ================= */

  function cardEl(card, idx) {
    var el = document.createElement('div');
    el.className = 'card ' + (card.suit === 'H' || card.suit === 'D' ? 'red' : 'black');
    var rankTxt = G.rankLabel(card.rank);
    var suitTxt = G.suitLabel[card.suit];
    var typeTxt = card.suit === 'H' ? '血瓶' : card.suit === 'D' ? '装备' : '怪物';
    var tier = cardIconTier(card);
    el.innerHTML =
      '<div class="corner"><span class="crank">' + rankTxt + '</span><span class="csuit">' + suitTxt + '</span></div>' +
      '<div class="cface"><img class="fsuit fsuit-t' + (tier + 1) + '" src="' + cardIcon[card.suit][tier] + '" alt="' + typeTxt + '"><span class="frank">' + rankTxt + '</span></div>' +
      '<div class="ctype">' + typeTxt + '</div>';
    var w = state.weapon;
    if (card.suit !== 'H' && card.suit !== 'D' && w && w.enabled && w.lastFight !== null && card.rank >= w.lastFight) {
      var b = document.createElement('span');
      b.className = 'unarmed-badge';
      b.textContent = '空手';
      el.appendChild(b);
    }
    // 按压反馈用 JS 类管理，避免重渲染后 :active 残留导致新牌保持缩放
    var clearPress = function () { el.classList.remove('pressing'); };
    el.addEventListener('pointerdown', function () { el.classList.add('pressing'); });
    el.addEventListener('pointerup', clearPress);
    el.addEventListener('pointerleave', clearPress);
    el.addEventListener('pointercancel', clearPress);
    el.addEventListener('click', function () { clearPress(); UI.onCard(idx); });
    return el;
  }

  function assignSlots(cards, compact) {
    var slots = Array(4).fill(null);
    if (compact) {
      cards.forEach(function (c, i) { slots[i] = c; });
    } else {
      cards.forEach(function (c) {
        var ps = prevSlotRefs.indexOf(c);
        if (ps >= 0) slots[ps] = c;
      });
      var s = 0;
      cards.forEach(function (c) {
        if (slots.indexOf(c) >= 0) return;
        while (s < 4 && slots[s] !== null) s++;
        if (s < 4) { slots[s] = c; s++; }
      });
    }
    return slots;
  }

  /* ================= 渲染 ================= */

  function renderRoom(opts) {
    var compact = opts && opts.compact;
    var cards = (opts && opts.cards) || state.room;
    var slots = assignSlots(cards, compact);
    var oldRefs = prevSlotRefs;
    var step = 0;
    if (opts && opts.slide) {
      var first = roomEl.querySelector('.card');
      step = first ? first.getBoundingClientRect().width + 8 : 90;
    }
    roomEl.innerHTML = '';
    var newCount = 0;
    slots.forEach(function (c, slot) {
      if (!c) return;
      var idx = state.room.indexOf(c);
      var el = cardEl(c, idx);
      el.style.gridColumn = String(slot + 1);
      if (opts && opts.slide) {
        var os = oldRefs.indexOf(c);
        if (os >= 0 && os !== slot) {
          el.style.setProperty('--sx', ((os - slot) * step).toFixed(0) + 'px');
          el.classList.add('slot-shift');
        }
      }
      if (oldRefs.indexOf(c) < 0) {
        el.classList.add('deal');
        el.style.animationDelay = (newCount * 70) + 'ms';
        newCount++;
      }
      roomEl.appendChild(el);
    });
    prevSlotRefs = slots.slice();
    if (newCount > 0) SFX.deal();
  }

  function renderWeapon() {
    var panel = $('weaponPanel');
    var w = state.weapon;
    if (!w) {
      panel.className = 'weapon-panel empty';
      panel.innerHTML = '🛡️ 暂无武器 —— 找到方片即可装备';
      return;
    }
    panel.className = 'weapon-panel';
    panel.innerHTML = '';

    var wc = document.createElement('div');
    wc.className = 'weapon-card' + (w.enabled ? '' : ' sheathed');
    var rankTxt = G.rankLabel(w.card.rank);
    var suitTxt = G.suitLabel[w.card.suit];
    wc.innerHTML =
      '<div class="w-corner"><span class="crank">' + rankTxt + '</span><span class="csuit">' + suitTxt + '</span></div>' +
      '<div class="w-face">' + suitTxt + '</div>';
    if (weaponPop) { wc.classList.add('pop'); weaponPop = false; }
    panel.appendChild(wc);

    var info = document.createElement('div');
    info.className = 'weapon-info';

    var nameRow = document.createElement('div');
    nameRow.className = 'weapon-name-row';
    var name = document.createElement('div');
    name.className = 'weapon-name';
    name.textContent = '武器 · ' + rankTxt + ' ' + suitTxt + (w.enabled ? '' : '（已收起）');
    var sw = document.createElement('label');
    sw.className = 'switch';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = w.enabled;
    cb.addEventListener('change', function () { UI.onToggle(); });
    var track = document.createElement('span');
    track.className = 'track';
    sw.appendChild(cb);
    sw.appendChild(track);
    nameRow.appendChild(name);
    nameRow.appendChild(sw);
    info.appendChild(nameRow);

    var rec = document.createElement('div');
    rec.className = 'weapon-record';
    if (w.lastFight === null) {
      rec.classList.add('ready');
      rec.innerHTML = '<span class="rec-line">未对决 · 首击无限制</span>';
    } else {
      var line = document.createElement('span');
      line.className = 'rec-line';
      line.textContent = '上次对决 ' + w.lastFight + ' · 下次需 < ' + w.lastFight;
      rec.appendChild(line);
      if (!w.enabled) rec.classList.add('dead');
      else if (w.lastFight <= 3) rec.classList.add('dead');
      else rec.classList.add('ready');
      var kills = w.kills || [];
      if (kills.length > 0) {
        var row = document.createElement('div');
        row.className = 'kill-row';
        kills.forEach(function (k, i) {
          var kc = document.createElement('span');
          kc.className = 'kill-card ' + (k.suit === 'S' || k.suit === 'C' ? 'kc-black' : 'kc-red');
          kc.innerHTML = '<b>' + G.rankLabel(k.rank) + '</b><i>' + G.suitLabel[k.suit] + '</i>';
          if (i === kills.length - 1) kc.classList.add('pop');
          row.appendChild(kc);
        });
        rec.appendChild(row);
      }
    }
    info.appendChild(rec);
    panel.appendChild(info);
  }

  function renderHP() {
    var maxHp = state.maxHp || G.MAX_HP;
    var pct = Math.max(0, Math.round(state.hp / maxHp * 100));
    var fill = $('hpFill');
    fill.style.width = pct + '%';
    fill.className = 'hp-fill' + (pct > 50 ? '' : pct > 25 ? ' mid' : ' low');
    $('hpText').textContent = state.hp + '/' + maxHp;
  }

  function renderBottom() {
    $('deckCount').textContent = state.deck.length;
    var kick = $('kickBtn');
    var can = G.canKick(state);
    kick.disabled = !can;
    if (!can) {
      if (state.kickBanned) kick.title = '刚踢过门，下一房间才能再次踢门';
      else if (state.deck.length === 0) kick.title = '牌堆已空';
      else kick.title = '需要房间满 4 张';
    } else {
      kick.title = '洗回牌堆底并重翻 4 张';
    }
    $('roomNum').textContent = state.stats.rooms;
    $('roomStats').textContent = '击杀 ' + state.stats.kills + ' · 踢门 ' + state.stats.kicks;
    var hint = '';
    if (state.weapon && state.weapon.enabled && state.weapon.lastFight !== null) {
      hint = '武器只能对决小于 ' + state.weapon.lastFight + ' 的怪物';
    } else if (state.weapon && state.weapon.enabled) {
      hint = '武器已就绪，首击无限制';
    } else if (state.weapon) {
      hint = '武器已收起，空手对决损失全额';
    } else {
      hint = '空手对决损失全额 —— 找到方片装备武器';
    }
    $('hintLine').textContent = hint;
  }

  function render(opts) {
    renderRoom(opts || {});
    renderWeapon();
    renderBottom();
    renderHP();
  }

  /* ================= 操作 ================= */

  function doAct(idx) {
    if (busy || !state || state.phase !== 'playing') return;
    var card = state.room[idx];
    if (!card) return;
    SFX.unlock();
    var els = roomEl.querySelectorAll('.card');
    if (!els[idx]) return;
    var c = center(els[idx]);
    var prevLen = state.room.length;
    var oldRefs = prevSlotRefs.slice();
    var willCompact = prevLen === 2;
    var r = G.act(state, idx);
    if (!r.ok) return;

    switch (r.action) {
      case 'fight':
        ghostCard(els[idx], c.x > window.innerWidth / 2 ? 90 : -90, 120);
        if (r.weaponUsed && r.blocked) {
          floatText(c.x, c.y - 30, '0', 'block');
          burst(c.x, c.y, 6, ['#ffd166', '#ffe9a8', '#ffffff']);
          SFX.block();
          addTrauma(0.12);
          flash('gold');
        } else if (r.weaponUsed) {
          floatText(c.x, c.y - 30, '-' + r.dmg, 'dmg');
          burst(c.x, c.y, 9, ['#ff7a5a', '#ffb26a', '#c8342a']);
          SFX.fight(false);
          addTrauma(0.24);
          flash('red');
          jolt(roomEl);
        } else {
          floatText(c.x, c.y - 30, '-' + r.dmg, 'dmg');
          burst(c.x, c.y, 13, ['#ff5a5a', '#ff8a6a', '#c8342a', '#8a1f1f']);
          SFX.hurt();
          addTrauma(0.42);
          flash('red');
          jolt(roomEl);
        }
        if (r.hpLost > 0) {
          hpBarEl.classList.remove('damaged');
          void hpBarEl.offsetWidth;
          hpBarEl.classList.add('damaged');
        }
        break;

      case 'potion':
        ghostCard(els[idx], 0, -80);
        if (r.hpGain > 0) {
          floatText(c.x, c.y - 30, '+' + r.hpGain, 'heal');
          burst(c.x, c.y, 8, ['#6ee77e', '#a8f5b0', '#3aa94b']);
          SFX.heal();
          flash('green');
          addTrauma(0.06);
          hpBarEl.classList.remove('healed');
          void hpBarEl.offsetWidth;
          hpBarEl.classList.add('healed');
        } else {
          floatText(c.x, c.y - 30, '无效', 'small');
          SFX.tick();
          toast('本房间的血瓶已经失效了…');
        }
        break;

      case 'equip':
        ghostCard(els[idx], 0, -70);
        floatText(c.x, c.y - 30, '装备', 'info');
        burst(c.x, c.y, 6, ['#ffd166', '#e8b64c', '#ffffff']);
        SFX.equip();
        addTrauma(0.05);
        weaponPop = true;
        if (state.weapon) toast('装备 ' + G.cardLabel(state.weapon.card) + '，旧武器已弃用');
        break;
    }

    if (willCompact && state.phase === 'playing') {
      // 房间剩 1 张：先补位动画，动画完成后引擎已补牌，再渲染新牌
      save();
      busy = true;
      var keep = state.room.filter(function (c) { return oldRefs.indexOf(c) >= 0; });
      render({ cards: keep, compact: true, slide: true });
      setTimeout(function () {
        busy = false;
        render({});
        checkEnd();
      }, 340);
    } else {
      render({});
      save();
      checkEnd();
    }
  }

  function doKick() {
    if (busy || !state || !G.canKick(state)) return;
    SFX.unlock();
    busy = true;
    var cards = roomEl.querySelectorAll('.card');
    cards.forEach(function (el) { el.classList.add('kick-out'); });
    jolt(roomEl);
    var kb = center($('kickBtn'));
    burst(kb.x, kb.y, 12, ['#ffd166', '#e8b64c', '#ffffff']);
    SFX.kick();
    addTrauma(0.5);
    flash('gold');
    setTimeout(function () {
      G.kick(state);
      render({compact: true});
      save();
      busy = false;
      toast('踢门！重翻 4 张新牌');
    }, 330);
  }

  function onToggle() {
    if (busy || !state || !state.weapon) return;
    SFX.unlock();
    var wasEnabled = state.weapon.enabled;
    G.toggleWeapon(state);
    render();
    save();
    SFX.tick();
    toast(wasEnabled ? '武器已收起，只能空手对决' : '武器已启用');
  }

  /* ================= 存档 / 流程 ================= */

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state: G.serialize(state) })); } catch (e) {}
  }

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return G.deserialize(JSON.parse(raw).state);
    } catch (e) { return null; }
  }

  function showGame() {
    $('landing').style.display = 'none';
    $('game').style.display = 'flex';
  }

  function goLanding() {
    $('game').style.display = 'none';
    $('landing').style.display = 'flex';
    var s = loadSave();
    $('btnContinue').style.display = (s && s.phase === 'playing') ? '' : 'none';
  }

  function startNew() {
    busy = false;
    prevSlotRefs = [null, null, null, null];
    state = G.newGame(null, $('easyMode').checked);
    showGame();
    render(0);
    save();
  }

  function continueGame() {
    var s = loadSave();
    if (!s) { toast('没有找到存档'); return; }
    prevSlotRefs = [null, null, null, null];
    state = s;
    busy = false;
    showGame();
    render(0);
  }

  function checkEnd() {
    if (state.phase === 'won' || state.phase === 'lost') {
      setTimeout(showOver, 520);
    }
  }

  var WIN_TITLES = ['闯关成功！', '胜利凯旋！', '深渊见底，勇者不败！', '清空牌堆，全身而退！'];
  var LOSE_TITLES = ['冒险失败…', '勇者倒下了…', '命丧于此，再接再厉！', '血量归零，故事暂歇…'];

  var WIN_DESC = [
    '斩尽了所有敌人，你的英勇将载入史册！',
    '每个敌人都倒在你的剑下，和平重归大地…',
    '血与火的试炼落幕，你是真正的传奇！',
    '最后一声哀嚎在黑暗中消散，你赢得了胜利！',
    '从此酒馆的吟游诗人将传唱你的名字…',
    '敌人尽数倒下，你是无可争议的冠军！',
    '以勇气为盾、利刃为笔，你写下了自己的史诗！',
    '敌人灰飞烟灭，你带着荣耀凯旋而归！',
    '满身伤痕是你荣耀的勋章，恭喜你，勇者！',
    '这场战斗结束了，但你的传奇才刚刚开始…'
  ];

  var LOSE_DESC = [
    '斩落了无数怪物，但邪恶终究还是吞没了你…',
    '黑暗淹没了最后的喘息，冒险在此落幕…',
    '剑刃崩断，你的传说留在了地牢深处…',
    '离胜利只差一步，命运却没有眷顾你…',
    '鲜血染红了牌桌，你倒在冰冷的石板地上…',
    '耳边的怪物低语渐渐模糊，你闭上了眼睛…',
    '英雄也会倒下，今天恰好轮到了你…',
    '胜败乃兵家常事，勇士请重新来过…'
  ];

  function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function showOver() {
    var win = state.phase === 'won';
    if (win) {
      SFX.win();
      addTrauma(0.3);
      flash('gold');
      burst(window.innerWidth / 2, window.innerHeight * 0.3, 26, ['#ffd166', '#ffe9a8', '#ffffff', '#e8b64c']);
    } else {
      SFX.lose();
      addTrauma(0.6);
      flash('red');
    }
    var m = $('overModal');
    m.innerHTML =
      '<div class="over-icon">' + (win ? '🎉' : '💀') + '</div>' +
      '<div class="over-title ' + (win ? 'win' : 'lose') + '">' + (win ? randomPick(WIN_TITLES) : randomPick(LOSE_TITLES)) + '</div>' +
      '<div class="over-desc">' + (win ? randomPick(WIN_DESC) : randomPick(LOSE_DESC)) + '</div>' +
      '<div class="over-stats">' +
        (win ? '剩余血量 <b>' + state.hp + '</b><br>' : '') +
        '击杀怪物 <b>' + state.stats.kills + '</b><br>' +
        '闯入房间 <b>' + state.stats.rooms + '</b> · 踢门 <b>' + state.stats.kicks + '</b>' +
      '</div>' +
      '<div class="modal-btns">' +
        '<button class="btn" onclick="UI.hideOver()">返回首页</button>' +
        '<button class="btn btn-primary" onclick="UI.replay()">⚔️ 再来一局</button>' +
      '</div>';
    $('overOverlay').classList.add('show');
  }

  function hideOver() {
    $('overOverlay').classList.remove('show');
    goLanding();
  }

  function replay() {
    hideOver();
    startNew();
  }

  /* ================= 弹窗 ================= */

  function confirmBox(text, onYes) {
    $('confirmText').textContent = text;
    $('confirmYes').onclick = function () { closeConfirm(); onYes(); };
    $('confirmOverlay').classList.add('show');
  }

  function closeConfirm() {
    $('confirmOverlay').classList.remove('show');
  }

  function showRules() { SFX.unlock(); $('rulesOverlay').classList.add('show'); }
  function hideRules() { $('rulesOverlay').classList.remove('show'); }

  function quit() {
    confirmBox('当前进度已自动保存，返回首页？', goLanding);
  }

  function confirmReset() {
    confirmBox('重新开始？当前进度将丢失。', startNew);
  }

  function toggleMute() {
    SFX.unlock();
    SFX.toggle();
    $('muteBtn').textContent = SFX.muted ? '🔇' : '🔊';
  }

  function init() {
    $('btnStart').addEventListener('click', function () {
      SFX.unlock();
      var s = loadSave();
      if (s && s.phase === 'playing') confirmBox('已有进行中的冒险，开始新游戏将覆盖存档，确定？', startNew);
      else startNew();
    });
    $('btnContinue').addEventListener('click', function () { SFX.unlock(); continueGame(); });
    $('muteBtn').textContent = SFX.muted ? '🔇' : '🔊';
    var easyEl = $('easyMode');
    easyEl.checked = localStorage.getItem('scoundrel-easy') === '1';
    easyEl.addEventListener('change', function () {
      try { localStorage.setItem('scoundrel-easy', easyEl.checked ? '1' : '0'); } catch (e) {}
    });
    goLanding();
  }

  var UI = window.UI = {
    init: init,
    onCard: doAct,
    onToggle: onToggle,
    doKick: doKick,
    quit: quit,
    confirmReset: confirmReset,
    toggleMute: toggleMute,
    confirm: confirmBox,
    closeConfirm: closeConfirm,
    showRules: showRules,
    hideRules: hideRules,
    hideOver: hideOver,
    replay: replay
  };

  // ?debug 时暴露测试钩子
  if (/\bdebug\b/.test(location.search)) {
    window.__scoundrel = {
      getState: function () { return state; },
      setState: function (s) { state = s; busy = false; },
      render: render,
      doAct: doAct,
      doKick: doKick,
      checkEnd: checkEnd,
      startNew: startNew
    };
  }

  init();
})();
