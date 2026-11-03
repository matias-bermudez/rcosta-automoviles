// Helpers compartidos. Se usan en el navegador y también en scripts/generar.js,
// que arma las páginas con estas mismas funciones. Todo se expone en window.RC.
(function () {
  var C = window.RC_CONFIG;
  var AUTOS = window.RC_AUTOS || [];
  var EN_NAVEGADOR = typeof document !== 'undefined';
  // Prefijo relativo hasta la raíz del sitio ('./', '../', '../../'), lo pone el generador en <body data-raiz>.
  var RAIZ = EN_NAVEGADOR && document.body ? document.body.getAttribute('data-raiz') || './' : './';
  var MSG_GENERICO = 'Hola R.Costa, les escribo desde la web.';
  // Carrocerías del panel y del filtro "Tipo", en este orden.
  var CARROCERIAS = ['SUV', 'Pick-up', 'Sedán', 'Hatchback', 'Coupé', 'Familiar', 'Convertible', 'Furgón'];
  var COMBUSTIBLES = ['Nafta', 'Híbrido', 'Diésel', 'Eléctrico'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function raiz(r) { return r == null ? RAIZ : r; }
  function miles(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  // moneda: 'USD' (por defecto) o 'UYU'.
  function precio(a) { return a.precio ? (a.moneda === 'UYU' ? '$ ' : 'U$S ') + miles(a.precio) : 'Consultar'; }
  // Para ordenar y filtrar autos con precios en distintas monedas.
  function dolares(a) { return a.precio ? (a.moneda === 'UYU' ? a.precio / ((C && C.dolar) || 40) : a.precio) : null; }
  function nombre(a) { return a.marca + ' ' + a.modelo; }
  // "Ford Ranger Raptor 2024" (sin año si no se sabe).
  function titulo(a) { return nombre(a) + (a.anio ? ' ' + a.anio : ''); }
  function anio(a) { return a.anio || 'Año a consultar'; }
  function km(a) { return a.sinKm ? 'Km a consultar' : miles(a.km || 0) + ' km'; }
  function datos(a) { return [anio(a), km(a), a.combustible, a.transmision].filter(Boolean).join(' · '); }
  function numero(a) { return a.numero ? 'N.º ' + (a.numero < 10 ? '0' : '') + a.numero : ''; }
  function autoUrl(a, r) { return raiz(r) + 'autos/' + encodeURIComponent(a.id) + '/'; }
  function waUrl(text) { return 'https://wa.me/' + C.whatsapp + '?text=' + encodeURIComponent(text || MSG_GENERICO); }
  function buscar(id) { return AUTOS.filter(function (a) { return a.id === id; })[0]; }

  // Mensaje del botón "Me interesa": texto plano, con el link a la ficha al final.
  function mensajeInteres(a) {
    var auto = titulo(a);
    var url = C.sitio + 'autos/' + a.id + '/';
    if (a.reservado) {
      return 'Hola R.Costa, vi en la web el ' + auto + (a.precio ? ' (' + precio(a) + ')' : '') +
        ', que figura como reservado. Si se libera, ¿me avisan?\n' + url;
    }
    return 'Hola R.Costa, me interesa el ' + auto + ' que vi en la web' +
      (a.precio ? ', publicado a ' + precio(a) + '. ¿Sigue disponible?' : '. ¿Sigue disponible? ¿Cuál es el precio?') +
      ' ¿Cuándo lo puedo ver?\n' + url;
  }

  // Foto i del auto, o el dibujo del auto del logo si todavía no tiene. o: { raiz, alt, eager, chica, texto }
  function foto(a, i, o) {
    o = o || {};
    var lista = o.chica && a.miniaturas && a.miniaturas.length ? a.miniaturas : a.fotos;
    var src = lista && lista[i || 0];
    if (!src) {
      return '<div class="ph"><img src="' + raiz(o.raiz) + 'img/linea.svg" alt="">' +
        (o.texto ? '<span>' + esc(o.texto) + '</span>' : '') + '</div>';
    }
    return '<img src="' + esc(raiz(o.raiz) + src) + '" alt="' + esc(o.alt || nombre(a)) + '"' +
      (o.eager ? ' fetchpriority="high"' : ' loading="lazy"') + '>';
  }

  // Tarjeta del auto, como una pieza de exhibición. o: { raiz, h ('h2' | 'h3') }
  function lot(a, o) {
    o = o || {};
    var h = o.h || 'h3';
    var alt = nombre(a) + (a.reservado ? ', reservado' : '');
    return '<a class="lot' + (a.reservado ? ' res' : '') + '" href="' + autoUrl(a, o.raiz) + '">' +
      '<div class="lot-photo">' + foto(a, 0, { raiz: o.raiz, chica: true, alt: alt }) +
      (a.reservado ? '<span class="tag">Reservado</span>' : '') + '</div>' +
      '<div class="lot-plaque">' +
      '<div class="lot-no"><span>' + esc([numero(a), a.marca].filter(Boolean).join(' · ')) + '</span><span>' + esc(a.carroceria || '') + '</span></div>' +
      '<' + h + ' class="lot-title">' + esc(a.modelo) + '</' + h + '>' +
      '<div class="lot-price">' + esc(precio(a)) + '</div>' +
      (a.version ? '<div class="lot-ver">' + esc(a.version) + '</div>' : '') +
      '<div class="lot-data">' + esc(datos(a)) + '</div>' +
      (a.ubicacion ? '<div class="lot-data muted">Se ve en ' + esc(a.ubicacion) + '</div>' : '') +
      '</div></a>';
  }

  // Más nuevos primero.
  function recientes() {
    return AUTOS.slice().sort(function (a, b) { return (b.ingreso || '').localeCompare(a.ingreso || ''); });
  }

  window.RC = {
    config: C, autos: AUTOS, CARROCERIAS: CARROCERIAS, COMBUSTIBLES: COMBUSTIBLES, MSG_GENERICO: MSG_GENERICO,
    esc: esc, miles: miles, precio: precio, dolares: dolares, nombre: nombre, titulo: titulo,
    anio: anio, km: km, datos: datos, numero: numero, autoUrl: autoUrl, waUrl: waUrl, buscar: buscar,
    mensajeInteres: mensajeInteres, foto: foto, lot: lot, recientes: recientes
  };
})();
