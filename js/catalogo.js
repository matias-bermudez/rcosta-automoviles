// Filtros y orden del catálogo. La grilla ya viene armada por scripts/generar.js; acá se vuelve a pintar.
(function () {
  var RC = window.RC;
  if (!RC.autos.length) return;
  var ORDENES = {
    recientes: function (a, b) { return (b.ingreso || '').localeCompare(a.ingreso || ''); },
    // Sin precio, sin km o sin año van al final.
    'precio-asc': function (a, b) { return (RC.dolares(a) || Infinity) - (RC.dolares(b) || Infinity); },
    'precio-desc': function (a, b) { return (RC.dolares(b) || 0) - (RC.dolares(a) || 0); },
    km: function (a, b) { return (a.sinKm ? Infinity : a.km) - (b.sinKm ? Infinity : b.km); },
    anio: function (a, b) { return (b.anio || 0) - (a.anio || 0); }
  };
  var CAMPOS = { tipo: 'carroceria', comb: 'combustible', caja: 'transmision', sede: 'sede' };

  // Los filtros viven en la URL para poder compartir y volver (/autos/?tipo=SUV&max=40000).
  var params = new URLSearchParams(location.search);
  var estado = { orden: ORDENES[params.get('orden')] ? params.get('orden') : 'recientes', max: Number(params.get('max')) || 0 };
  var grupos = document.querySelectorAll('[data-filtro]');
  grupos.forEach(function (g) {
    var k = g.getAttribute('data-filtro');
    var v = params.get(k) || '';
    estado[k] = g.querySelector('[data-v="' + (window.CSS && CSS.escape ? CSS.escape(v) : v) + '"]') ? v : '';
  });

  var grid = document.getElementById('grid');
  var count = document.getElementById('count');
  var limpiar = document.getElementById('limpiar');
  var vacio = document.getElementById('sin-coincidencias');
  var orden = document.getElementById('orden');
  var tope = document.getElementById('tope');
  var filtros = document.getElementById('filtros');
  var toggle = document.getElementById('toggle-filtros');
  orden.value = estado.orden;
  tope.value = String(estado.max);
  if (tope.value !== String(estado.max)) { estado.max = 0; tope.value = '0'; }

  function activos() {
    var n = estado.max ? 1 : 0;
    grupos.forEach(function (g) { if (estado[g.getAttribute('data-filtro')]) n++; });
    return n;
  }

  function render() {
    var lista = RC.autos.filter(function (a) {
      for (var k in CAMPOS) if (estado[k] && a[CAMPOS[k]] !== estado[k]) return false;
      return !estado.max || (RC.dolares(a) !== null && RC.dolares(a) <= estado.max);
    }).sort(ORDENES[estado.orden]);

    var n = activos();
    grid.innerHTML = lista.map(function (a) { return RC.lot(a, { h: 'h2' }); }).join('');
    count.textContent = (lista.length === 1 ? '1 auto' : lista.length + ' autos') + (n ? ' con estos filtros' : ' en exhibición');
    limpiar.hidden = !n;
    vacio.hidden = lista.length > 0;
    toggle.textContent = n ? 'Filtros (' + n + ')' : 'Filtros';
    grupos.forEach(function (g) {
      var k = g.getAttribute('data-filtro');
      g.querySelectorAll('[data-v]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === estado[k])); });
    });

    var p = new URLSearchParams();
    grupos.forEach(function (g) { var k = g.getAttribute('data-filtro'); if (estado[k]) p.set(k, estado[k]); });
    if (estado.max) p.set('max', estado.max);
    if (estado.orden !== 'recientes') p.set('orden', estado.orden);
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }

  grupos.forEach(function (g) {
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      estado[g.getAttribute('data-filtro')] = b.getAttribute('data-v');
      render();
    });
  });
  orden.addEventListener('change', function () { estado.orden = orden.value; render(); });
  tope.addEventListener('change', function () { estado.max = Number(tope.value) || 0; render(); });
  function borrar() {
    grupos.forEach(function (g) { estado[g.getAttribute('data-filtro')] = ''; });
    estado.max = 0;
    tope.value = '0';
    render();
  }
  limpiar.addEventListener('click', borrar);
  document.getElementById('limpiar-2').addEventListener('click', borrar);
  toggle.addEventListener('click', function () {
    var abierto = filtros.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(abierto));
  });

  render();
})();
