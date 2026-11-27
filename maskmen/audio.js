'use strict';
/* 《面具摔跤手》WebAudio 合成音效，无外部资源 */
(function (root) {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      } catch (e) {
        ctx = null;
        return null;
      }
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, gain, delay, slideTo) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.15, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, gain, freq, delay) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq || 1200;
    f.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(gain || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const SFX = {
    tap: function () { tone(300, .05, 'square', .05); },
    deal: function () {
      for (let i = 0; i < 4; i++) noise(.05, .07, 2400, i * .055);
      tone(180, .1, 'sine', .06, .05);
    },
    play: function () {
      noise(.07, .16, 1700);
      tone(130, .16, 'sine', .3, .01, 62);
      tone(70, .2, 'triangle', .12, .02);
    },
    chip: function () {
      tone(940, .12, 'triangle', .13);
      tone(1410, .1, 'sine', .08, .045);
    },
    pass: function () {
      noise(.12, .16, 640);
      tone(95, .16, 'sine', .2, .02, 55);
    },
    round: function () {
      tone(620, .22, 'triangle', .1, 0, 180);
      noise(.1, .06, 900, .02);
    },
    season: function () {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (f, i) { tone(f, .2, 'triangle', .12, i * .12); });
      tone(1046.5, .35, 'sine', .08, .5);
      for (let i = 0; i < 6; i++) noise(.04, .05, 3200, .45 + i * .05);
    },
    win: function () {
      const notes = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach(function (f, i) { tone(f, .24, 'triangle', .13, i * .11); });
      tone(1568, .6, 'sine', .07, .62);
      for (let i = 0; i < 10; i++) noise(.05, .045, 3600, .6 + i * .05);
    },
    error: function () {
      tone(150, .1, 'square', .1);
      tone(112, .12, 'square', .08, .09);
    },
  };

  root.MaskmenAudio = {
    play: function (name) {
      if (muted) return;
      const fn = SFX[name];
      if (fn) { ensure(); fn(); }
    },
    setMuted: function (v) { muted = !!v; },
    isMuted: function () { return muted; },
    unlock: function () { ensure(); },
  };
})(window);