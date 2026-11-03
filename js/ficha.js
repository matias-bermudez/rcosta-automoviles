// Galería de la ficha. El resto de la página ya viene armado por scripts/generar.js.
(function () {
  var RC = window.RC;
  var foto = document.getElementById('foto');
  var a = RC.buscar(foto.getAttribute('data-auto'));
  if (!a || !a.fotos || a.fotos.length < 2) return;

  var nombre = RC.nombre(a);
  var total = a.fotos.length;
  var actual = 0;
  var thumbs = document.getElementById('thumbs');

  function mostrar(i) {
    actual = (i + total) % total;
    var img = foto.querySelector('img');
    img.src = (document.body.getAttribute('data-raiz') || './') + a.fotos[actual];
    img.alt = nombre + ', foto ' + (actual + 1);
    document.getElementById('contador').textContent = (actual + 1) + ' / ' + total;
    thumbs.querySelectorAll('.thumb').forEach(function (t, j) { t.setAttribute('aria-current', String(j === actual)); });
  }

  document.getElementById('ant').addEventListener('click', function () { mostrar(actual - 1); });
  document.getElementById('sig').addEventListener('click', function () { mostrar(actual + 1); });
  thumbs.addEventListener('click', function (e) {
    var t = e.target.closest('.thumb');
    if (t) mostrar(Number(t.getAttribute('data-i')));
  });
  document.addEventListener('keydown', function (e) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') mostrar(actual + 1);
    if (e.key === 'ArrowLeft') mostrar(actual - 1);
  });
  // En el celular se pasa de foto deslizando.
  var x0 = null;
  foto.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  foto.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) mostrar(actual + (dx < 0 ? 1 : -1));
    x0 = null;
  });
})();
