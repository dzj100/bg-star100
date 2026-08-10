var BGM = (function () {
  var bgm = null;
  var armed = false;
  var playing = false;
  var muted = false;

  function getAudio() {
    if (!bgm) {
      bgm = new Audio('music/Cursed Table Siege Long.mp3');
      // bgm = new Audio('music/Candlelit Deck.mp3');
      bgm.loop = false;
      bgm.volume = 0.4;

      const LOOP_GAP = 3;          // 间隔秒数
      bgm.addEventListener('ended', () => {
        setTimeout(() => {
          bgm.currentTime = 0;
          bgm.play();
        }, LOOP_GAP * 1000);
      });
      bgm.play();
    }
    return bgm;
  }

  function tryPlay() {
    if (!armed) return;
    var a = getAudio();
    var p = a.play();
    if (p && p.then) {
      p.then(function () {
        playing = true;
        detachListeners();
      }).catch(function () {});
    } else {
      playing = true;
      detachListeners();
    }
  }

  function onGesture() {
    if (!armed || playing) return;
    tryPlay();
  }

  function attachListeners() {
    document.addEventListener('click', onGesture);
    document.addEventListener('touchstart', onGesture);
    document.addEventListener('keydown', onGesture);
  }

  function detachListeners() {
    document.removeEventListener('click', onGesture);
    document.removeEventListener('touchstart', onGesture);
    document.removeEventListener('keydown', onGesture);
  }

  function play() {
    if (playing) return;
    armed = true;
    tryPlay();
    if (!playing) attachListeners();
  }

  function stop() {
    armed = false;
    playing = false;
    muted = false;
    detachListeners();
    if (bgm) {
      bgm.pause();
      bgm.currentTime = 0;
    }
    syncBtn();
  }

  function setVolume(v) {
    getAudio().volume = v;
  }

  function syncBtn() {
    var btn = document.getElementById('muteBtn');
    if (btn) btn.textContent = muted ? '🔇' : '🔊';
  }

  /** 喇叭开关：静音/恢复播放 */
  function toggle() {
    if (muted) {
      muted = false;
      if (bgm) bgm.play().catch(function () {});
      else play();
    } else {
      muted = true;
      if (bgm) bgm.pause();
    }
    syncBtn();
    return !muted;
  }

  return { play: play, stop: stop, setVolume: setVolume, toggle: toggle };
})();
