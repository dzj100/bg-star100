(function () {
  var landing = document.getElementById('landing');
  if (!landing) return;

  var svg = typeof BOSS_SVG !== 'undefined' ? BOSS_SVG : null;

  var king = document.getElementById('landingKing');
  if (king && svg && svg.K) {
    king.innerHTML = svg.K;
  }

  var court = document.getElementById('landingCourt');
  if (court && svg) {
    var seats = [
      ['J', '骑士', '♠'],
      ['Q', '王后', '♥'],
      ['K', '国王', '♣']
    ];
    var frag = document.createDocumentFragment();

    seats.forEach(function (seat, index) {
      if (index > 0) {
        var suit = document.createElement('span');
        suit.className = 'landing-suit';
        suit.textContent = seat[2];
        frag.appendChild(suit);
      }

      var figure = document.createElement('figure');
      var art = document.createElement('div');
      art.className = 'landing-court-art';
      art.innerHTML = svg[seat[0]];

      var caption = document.createElement('figcaption');
      caption.textContent = seat[0] + ' · ' + seat[1];

      figure.appendChild(art);
      figure.appendChild(caption);
      frag.appendChild(figure);
    });

    court.appendChild(frag);
  }

  var embers = document.getElementById('landingEmbers');
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (embers && !reduceMotion) {
    var ash = document.createDocumentFragment();

    for (var i = 0; i < 16; i++) {
      var ember = document.createElement('span');
      ember.className = 'landing-ember';
      ember.style.setProperty('--x', (4 + Math.random() * 92).toFixed(2) + '%');
      ember.style.setProperty('--dur', (7 + Math.random() * 7).toFixed(2) + 's');
      ember.style.setProperty('--delay', (-Math.random() * 12).toFixed(2) + 's');
      ember.style.setProperty('--drift', (Math.random() * 34 - 17).toFixed(1) + 'px');
      ash.appendChild(ember);
    }

    embers.appendChild(ash);
  }
})();
