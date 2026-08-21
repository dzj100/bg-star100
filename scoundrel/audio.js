/* ============================================================
   无赖勇者 Scoundrel - WebAudio 合成音效（无外部资源）
   ============================================================ */
var SFX = (function () {
  'use strict';

  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var muted = false;
  var unlocked = false;

  var MUTE_KEY = 'scoundrel-muted';

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      // 缓存白噪声
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function unlock() {
    unlocked = true;
    ensure();
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (muted || !ctx) return;
    var t0 = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq, q, delay) {
    if (muted || !ctx || !noiseBuf) return;
    var t0 = ctx.currentTime + (delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq || 2000, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, (filterFreq || 2000) * 0.12), t0 + dur);
    f.Q.value = q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // 打击：低鸣 + 噪声
  function fight(heavy) {
    var v = heavy ? 0.5 : 0.35;
    tone(150, 0.16, 'sine', v, 50);
    noise(heavy ? 0.14 : 0.09, v * 0.8, heavy ? 2600 : 1800);
  }
  function hurt() {
    tone(110, 0.3, 'sine', 0.5, 38);
    noise(0.2, 0.4, 1200, 0.8);
    tone(220, 0.22, 'sawtooth', 0.12, 90);
  }
  function block() {
    tone(950, 0.06, 'square', 0.16, 500);
    tone(1400, 0.04, 'sine', 0.1, null, 0.02);
  }
  function heal() {
    tone(520, 0.1, 'sine', 0.22, 660);
    tone(660, 0.1, 'sine', 0.2, 780, 0.09);
    tone(780, 0.16, 'sine', 0.16, 1040, 0.18);
  }
  function equip() {
    tone(320, 0.1, 'square', 0.16, 640);
    noise(0.06, 0.12, 3000, 2);
  }
  function tick() {
    tone(820, 0.05, 'sine', 0.16, 620);
  }
  function deal() {
    noise(0.05, 0.1, 3400, 3);
  }
  function kick() {
    noise(0.22, 0.5, 700, 1.2);
    tone(95, 0.26, 'sine', 0.55, 36);
    noise(0.08, 0.2, 3000, 2, 0.06);
  }
  function win() {
    var notes = [523, 659, 784, 1046];
    for (var i = 0; i < notes.length; i++) tone(notes[i], 0.22, 'triangle', 0.28, null, i * 0.13);
  }
  function lose() {
    var notes = [392, 330, 262, 196];
    for (var i = 0; i < notes.length; i++) tone(notes[i], 0.3, 'sawtooth', 0.16, null, i * 0.18);
  }

  function toggle() {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = muted ? 0 : 0.5;
    return !muted;
  }

  function loadMute() {
    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  }

  loadMute();

  return {
    unlock: unlock,
    toggle: toggle,
    fight: fight,
    hurt: hurt,
    block: block,
    heal: heal,
    equip: equip,
    tick: tick,
    deal: deal,
    kick: kick,
    win: win,
    lose: lose,
    get muted() { return muted; }
  };
})();
