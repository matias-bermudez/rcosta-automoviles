// Formulario "Vendé, permutá o consigná": arma el mensaje de WhatsApp a medida que se completa.
(function () {
  var RC = window.RC;
  var form = document.getElementById('f-vende');
  var preview = document.getElementById('preview');
  var enviar = document.getElementById('enviar');
  var enviarM = document.getElementById('enviar-m');
  var falta = document.getElementById('falta');
  var REQUERIDOS = [['marca', 'marca'], ['modelo', 'modelo'], ['anio', 'año'], ['km', 'kilómetros']];
  var VERBOS = { vender: 'vender mi auto', permutar: 'permutar mi auto', consignar: 'dejar mi auto en consignación' };

  // ?modo=permutar&auto=<id> viene del botón "Entregar mi auto como parte de pago" de la ficha;
  // ?modo=consignar, de los botones de consignación.
  var params = new URLSearchParams(location.search);
  var estado = { modo: VERBOS[params.get('modo')] ? params.get('modo') : 'vender', deuda: 'No' };
  var interes = RC.buscar(params.get('auto'));
  if (interes) {
    var box = document.getElementById('interes');
    box.textContent = 'Auto que te interesa: ' + RC.titulo(interes) + ' · ' + RC.precio(interes);
    box.hidden = false;
  }

  function val(nombre) { return String(form.elements[nombre].value || '').trim(); }
  function km(v) {
    v = v.replace(/\s*km$/i, '');
    return /^[\d.]+$/.test(v) && v.replace(/\D/g, '') ? RC.miles(Number(v.replace(/\D/g, ''))) : v;
  }
  function o(v, ph) { return v || '[' + ph + ']'; }

  function mensaje() {
    var lineas = ['Hola R.Costa, quiero ' + VERBOS[estado.modo] + '.'];
    if (interes) lineas.push('Me interesa: ' + RC.titulo(interes) + ' (' + RC.precio(interes) + ')');
    lineas.push(
      '',
      'Auto: ' + o(val('marca'), 'marca') + ' ' + o(val('modelo'), 'modelo'),
      'Año: ' + o(val('anio'), 'año'),
      'Kilómetros: ' + o(km(val('km')), 'km'),
      'Deuda: ' + estado.deuda
    );
    if (estado.modo === 'permutar' && (val('busca') || !interes)) lineas.push('Busco a cambio: ' + o(val('busca'), 'qué buscás'));
    else if (estado.modo !== 'permutar' && val('busca')) lineas.push('Comentarios: ' + val('busca'));
    var yo = [val('nombre') && 'Soy ' + val('nombre'), val('cel') && 'mi celular es ' + val('cel')].filter(Boolean);
    if (yo.length) lineas.push('', yo.join(', ').replace(/^mi/, 'Mi') + '.');
    return lineas.join('\n');
  }

  function faltantes() {
    return REQUERIDOS.filter(function (r) { return !val(r[0]); });
  }

  function render() {
    var msg = mensaje();
    preview.textContent = msg;
    var f = faltantes().map(function (r) { return r[1]; });
    enviar.hidden = f.length > 0;
    falta.hidden = f.length === 0;
    if (f.length) falta.textContent = 'Para enviarlo, completá ' + (f.length > 1 ? f.slice(0, -1).join(', ') + ' y ' + f[f.length - 1] : f[0]) + '.';
    enviar.href = enviarM.href = RC.waUrl(msg);
    var permuta = estado.modo === 'permutar';
    document.getElementById('busca-label').textContent = permuta ? '¿Qué buscás a cambio?' : 'Algo más que quieras contarnos (opcional)';
    form.elements.busca.placeholder = permuta ? 'Ej.: una pick-up diésel, hasta U$S 40.000' : 'Ej.: service al día, un solo dueño';
    marcar('modo', estado.modo);
    marcar('deuda', estado.deuda);
  }

  function marcar(grupo, valor) {
    document.querySelectorAll('#' + grupo + ' [data-v]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === valor));
    });
  }
  ['modo', 'deuda'].forEach(function (grupo) {
    document.getElementById(grupo).addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      estado[grupo] = b.getAttribute('data-v');
      render();
    });
  });

  // Si falta algo, el botón del celular lleva al primer campo vacío en vez de abrir WhatsApp.
  function irAlQueFalta(e) {
    var primero = faltantes()[0];
    if (!primero) return false;
    if (e) e.preventDefault();
    form.elements[primero[0]].focus();
    return true;
  }
  enviarM.addEventListener('click', irAlQueFalta);

  // "Quiero consignar mi auto": elige Consignar y sube al formulario.
  document.getElementById('a-consignar').addEventListener('click', function (e) {
    e.preventDefault();
    estado.modo = 'consignar';
    render();
    document.getElementById('form').scrollIntoView({ behavior: 'smooth' });
    form.elements.marca.focus({ preventScroll: true });
  });

  form.addEventListener('input', render);
  // Enter en un campo: si está todo, envía; si no, lleva al primer campo que falta.
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!irAlQueFalta()) enviar.click();
  });

  render();
})();
