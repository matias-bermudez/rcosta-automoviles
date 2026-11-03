// Arma el sitio estático en _site/ a partir de src/ y los datos de los autos.
// Cada auto tiene su propia página (/autos/<id>/) con su título, descripción y datos
// estructurados para Google. GitHub Actions lo corre en cada push a main y cada 15 minutos.
//
// Los autos y los datos del negocio salen de Supabase (los carga el dueño desde /admin/).
// Las fotos se bajan y se publican junto con la web, así las visitas no consumen el plan de Supabase.
//
//   node scripts/generar.js                       → para publicar
//   node scripts/generar.js --local               → para probar: python3 -m http.server 8831 -d _site
//   node scripts/generar.js --local --ejemplos    → igual, con los autos de ejemplo de js/autos.js
//   SOLO_SI_CAMBIO=1 node scripts/generar.js      → no hace nada si nada cambió desde la última publicación
//
// Sin dependencias, solo Node 18+.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const SALIDA = path.join(RAIZ, '_site');
const ESTATICOS = ['css', 'js', 'img', 'fonts'];

// Se cargan los mismos archivos que usa el navegador.
const ctx = vm.createContext({ window: {} });
const correr = (f) => vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
correr('js/config.js');
const C = ctx.window.RC_CONFIG;
const EJEMPLOS = process.argv.includes('--ejemplos');
const SUPABASE = !EJEMPLOS && !!(C.supabaseUrl && C.supabaseKey);

const SITIO = C.sitio.replace(/\/?$/, '/');
const BASE = process.argv.includes('--local') ? '/' : new URL(SITIO).pathname;
const HOY = new Date().toISOString().slice(0, 10);
const TIPOS = ['auto', 'camioneta', 'utilitario'];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

let RC, AUTOS, esc;

async function main() {
  // ---- Datos ----
  let filas = null;
  let negocio = null;
  if (SUPABASE) {
    negocio = await leerNegocio();
    Object.assign(C, configDeNegocio(negocio));
    filas = await leerSupabase();
    ctx.window.RC_AUTOS = deFilas(filas);
  } else {
    correr('js/autos.js');
  }
  correr('js/common.js');
  RC = ctx.window.RC;
  esc = RC.esc;
  if (!SUPABASE) validar(RC.autos);

  const hash = crypto.createHash('sha256').update(JSON.stringify({ autos: filas || RC.autos, negocio })).digest('hex').slice(0, 16);
  if (process.env.SOLO_SI_CAMBIO) {
    const anterior = await fetch(SITIO + 'estado.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (anterior && anterior.hash === hash) {
      console.log('Los autos y los datos del negocio no cambiaron desde la última publicación, no hay nada para publicar.');
      salida('cambio', 'false');
      return;
    }
  }

  fs.rmSync(SALIDA, { recursive: true, force: true });
  for (const dir of ESTATICOS) fs.cpSync(path.join(RAIZ, dir), path.join(SALIDA, dir), { recursive: true });
  if (SUPABASE) {
    // Las fotos de ejemplo de img/autos/ no se publican: ahí van las que se bajan de la base.
    fs.rmSync(path.join(SALIDA, 'img/autos'), { recursive: true, force: true });
    // Los datos del negocio de la base también los usa el navegador (formularios, mensajes de WhatsApp).
    // Se reescribe entero para que el número viejo no quede en ningún archivo.
    escribir('js/config.js', '// Generado por scripts/generar.js: js/config.js + datos del negocio de Supabase.\nwindow.RC_CONFIG = ' + JSON.stringify(C, null, 2) + ';\n');
    await bajarFotos(RC.autos);
    // El navegador (filtros del catálogo, galería, formulario) usa estos mismos datos.
    escribir('js/autos.js', '// Generado por scripts/generar.js desde Supabase.\nwindow.RC_AUTOS = ' +
      JSON.stringify(RC.autos.map(({ _fotos, ...a }) => a), null, 1) + ';\n');
  }
  AUTOS = RC.recientes();

  generarPaginas();
  escribir('estado.json', JSON.stringify({ hash, generado: new Date().toISOString(), autos: AUTOS.length }) + '\n');
  salida('cambio', 'true');
  console.log(`Listo: ${AUTOS.length} autos (${SUPABASE ? 'Supabase' : 'js/autos.js'}). indexar=${C.indexar} → _site/`);
}

// ---- Supabase ----

function cabeceras() {
  // Las claves nuevas (sb_publishable_...) van solo en apikey; las viejas (anon, JWT) también en Authorization.
  const headers = { apikey: C.supabaseKey };
  if (!C.supabaseKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + C.supabaseKey;
  return headers;
}

async function leerSupabase() {
  const res = await fetch(`${C.supabaseUrl}/rest/v1/autos?select=*&concesionaria=eq.${encodeURIComponent(C.concesionaria)}&order=created_at.desc`, { headers: cabeceras() });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  return res.json();
}

// Datos del negocio que el dueño edita desde el panel (WhatsApp, dirección, horarios, redes...).
// Si no hay fila, se usa js/config.js tal cual.
async function leerNegocio() {
  const res = await fetch(`${C.supabaseUrl}/rest/v1/negocios?select=*&concesionaria=eq.${encodeURIComponent(C.concesionaria)}`, { headers: cabeceras() });
  if (!res.ok) {
    console.warn(`Aviso: no se pudieron leer los datos del negocio (${res.status}), se usa config.js.`);
    return null;
  }
  return (await res.json())[0] || null;
}

// Fila de negocios → claves de RC_CONFIG (solo las que tienen valor).
// Las columnas fijas van directo; teléfonos extra, localidad, mapa, horarios por día,
// Mercado Libre y otros locales van en `extra`.
function configDeNegocio(n) {
  if (!n) return {};
  const c = {};
  const columnas = { whatsapp: 'whatsapp', telefono: 'whatsappLabel', direccion: 'direccion', horario: 'horario', instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook' };
  for (const [k, clave] of Object.entries(columnas)) if (n[k]) c[clave] = n[k];
  // Las redes y la dirección se pueden borrar desde el panel: vacío en la base = vacío en la web.
  for (const k of ['direccion', 'horario', 'instagram', 'tiktok', 'facebook']) if (n[k] === null || n[k] === '') c[columnas[k]] = '';
  const x = n.extra || {};
  for (const k of ['telLlamadas', 'telOtro', 'localidad', 'departamento', 'mapa', 'mercadolibre']) if (typeof x[k] === 'string') c[k] = x[k];
  if (!c.localidad) delete c.localidad;
  if (!c.departamento) delete c.departamento;
  if (Array.isArray(x.horarios)) c.horarios = x.horarios;
  if (Array.isArray(x.sedes)) c.sedes = x.sedes.filter((s) => s && s.nombre);
  return c;
}

// Filas de la base → mismo formato que js/autos.js. Si a un auto le falta algo, se saltea (no rompe la web).
function deFilas(filas) {
  // N.º de exhibición: lo pone el panel al cargar el auto (extra.numero); si falta, por orden de llegada.
  const porLlegada = filas.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  return filas.map((r) => deFila(r, porLlegada.indexOf(r) + 1)).filter(Boolean);
}

function deFila(r, orden) {
  const falta = ['slug', 'marca', 'modelo', 'combustible', 'transmision'].filter((k) => r[k] === null || r[k] === '');
  if (falta.length || !TIPOS.includes(r.tipo)) {
    console.warn(`Aviso: se saltea el auto ${r.id} (${r.marca} ${r.modelo}), falta: ${falta.join(', ') || 'tipo'}`);
    return null;
  }
  const x = r.extra || {};
  // `modelo` en la base es modelo + versión; la versión sola queda en extra.version.
  const version = typeof x.version === 'string' ? x.version.trim() : '';
  const modelo = version && r.modelo.endsWith(' ' + version) ? r.modelo.slice(0, -version.length - 1) : r.modelo;
  const dir = `img/autos/${r.slug}/`;
  const sedes = (C.sedes || []).map((s) => s.nombre).concat(C.localidad);
  return {
    id: r.slug,
    numero: Number(x.numero) || orden,
    marca: r.marca, modelo, version,
    // El año puede faltar (el dueño no lo sabe): "Año a consultar". extra.sin_km: km vacío en el panel.
    anio: r.anio || null, km: r.km || 0, sinKm: x.sin_km === true,
    carroceria: r.carroceria || (r.tipo === 'camioneta' ? 'Pick-up' : r.tipo === 'utilitario' ? 'Furgón' : ''),
    tipo: r.tipo,
    combustible: r.combustible, transmision: r.transmision, marchas: r.marchas || null,
    traccion: r.traccion || null, motor: r.motor || null, color: r.color || null,
    puertas: r.puertas || null, duenos: r.duenos || null, service: x.service || null,
    precio: r.precio || null,
    moneda: r.moneda || 'USD',
    reservado: r.estado === 'reservado',
    destacado: r.destacado,
    ingreso: r.created_at.slice(0, 10),
    actualizado: r.updated_at.slice(0, 10),
    aceptaPermuta: r.acepta_permuta, financiable: x.financiable === true,
    ubicacion: typeof x.ubicacion === 'string' ? x.ubicacion.trim() : '',
    sede: sedes.includes(x.sede) ? x.sede : '',
    equipamiento: r.equipamiento || [],
    descripcion: r.descripcion || '',
    fotos: [], miniaturas: [],
    // Rutas en el bucket; bajarFotos() completa fotos/miniaturas con las que se pudieron bajar.
    _fotos: (r.fotos || []).map((p) => ({ p, archivo: dir + path.posix.basename(p) }))
  };
}

// Las fotos no cambian nunca (nombre = uuid): se guardan en .cache/fotos/ y solo se bajan las nuevas.
// GitHub Actions conserva esa carpeta entre publicaciones (actions/cache), así no se gasta cupo de Supabase.
const CACHE_FOTOS = path.join(RAIZ, '.cache', 'fotos');

async function bajarFotos(autos) {
  const url = (p) => `${C.supabaseUrl}/storage/v1/object/public/fotos/${p.split('/').map(encodeURIComponent).join('/')}`;
  const bajar = async (p, destino) => {
    const cache = path.join(CACHE_FOTOS, p);
    if (!fs.existsSync(cache)) {
      const res = await fetch(url(p));
      if (!res.ok) return false;
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      fs.writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
    }
    const f = path.join(SALIDA, destino);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.copyFileSync(cache, f);
    return true;
  };
  const tareas = autos.flatMap((a) => a._fotos.map((f) => async () => {
    const chica = f.archivo.replace(/\.jpg$/, '_m.jpg');
    f.ok = await bajar(f.p, f.archivo);
    f.chica = f.ok && (await bajar(f.p.replace(/\.jpg$/, '_m.jpg'), chica)) ? chica : f.archivo;
    if (!f.ok) console.warn(`Aviso: no se pudo bajar la foto ${f.p} de ${a.id}`);
  }));
  // De a 6 descargas a la vez.
  const cola = tareas.slice();
  await Promise.all(Array.from({ length: 6 }, async () => { while (cola.length) await cola.shift()(); }));
  for (const a of autos) {
    const ok = a._fotos.filter((f) => f.ok);
    a.fotos = ok.map((f) => f.archivo);
    a.miniaturas = ok.map((f) => f.chica);
  }
}

function salida(clave, valor) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${clave}=${valor}\n`);
}

// ---- Plantillas: {{ clave.sub }} y {{> parcial }} ----

const parciales = {};
for (const f of fs.readdirSync(path.join(SRC, '_partials'))) {
  parciales[path.basename(f, '.html')] = fs.readFileSync(path.join(SRC, '_partials', f), 'utf8');
}

function render(tpl, datos) {
  return tpl.replace(/\{\{\s*(>\s*)?([\w.-]+)\s*\}\}/g, (_, parcial, clave) => {
    if (parcial) {
      if (!(clave in parciales)) throw new Error(`No existe el parcial ${clave}`);
      return render(parciales[clave], datos);
    }
    const v = clave.split('.').reduce((o, k) => (o == null ? undefined : o[k]), datos);
    if (v === undefined) throw new Error(`Falta el dato {{${clave}}}`);
    return String(v);
  });
}

function jsonld(...objs) {
  return objs.map((o) => '<script type="application/ld+json">' +
    JSON.stringify(o).replace(/</g, '\\u003c') + '</script>').join('\n');
}

// ?v=<hash del archivo>: cuando cambia un css/js, el navegador no usa la copia vieja (Pages cachea 10 min).
const versiones = {};
function v(rel) {
  versiones[rel] = versiones[rel] || crypto.createHash('sha1').update(fs.readFileSync(path.join(SALIDA, rel))).digest('hex').slice(0, 8);
  return versiones[rel];
}

function scripts(raiz, nombres) {
  return nombres.map((n) => `<script src="${raiz}js/${n}.js?v=${v(`js/${n}.js`)}" defer></script>`).join('\n');
}

// ---- Datos del negocio para las plantillas ----

// "095 407 252" → "tel:+59895407252"; "2303 6119" → "tel:+59823036119".
function telHref(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.startsWith('598')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return 'tel:+598' + d;
}
function urlRed(valor, base) {
  return /^https?:\/\//.test(valor) ? valor : base + valor.replace(/^@/, '');
}
const direccionCompleta = () => [C.direccion, C.localidad, C.departamento].filter(Boolean).join(', ');
const mapsHref = () => C.mapa || 'https://www.google.com/maps/search/?api=1&query=' +
  encodeURIComponent(C.direccion ? direccionCompleta() + ', Uruguay' : `R.Costa Automóviles ${C.localidad}`);

// Días seguidos con el mismo horario se juntan: "Lunes a viernes", "Sábados", "Domingos".
function filasHorarios() {
  const hs = (C.horarios || []).filter((h) => DIAS.includes(h.dia));
  if (!hs.length) return [];
  const texto = (h) => (h.abierto ? `${h.desde} a ${h.hasta}` : 'Cerrado');
  const plural = { 'Sábado': 'Sábados', 'Domingo': 'Domingos' };
  const grupos = [];
  for (const d of DIAS) {
    const h = hs.find((x) => x.dia === d);
    if (!h) continue;
    const ult = grupos[grupos.length - 1];
    if (ult && ult.texto === texto(h)) ult.dias.push(d);
    else grupos.push({ dias: [d], texto: texto(h) });
  }
  return grupos.map((g) => [g.dias.length === 1 ? plural[g.dias[0]] || g.dias[0] : `${g.dias[0]} a ${g.dias[g.dias.length - 1].toLowerCase()}`, g.texto]);
}
function horarioSchema() {
  const cod = { Lunes: 'Mo', Martes: 'Tu', 'Miércoles': 'We', Jueves: 'Th', Viernes: 'Fr', 'Sábado': 'Sa', Domingo: 'Su' };
  return (C.horarios || []).filter((h) => h.abierto && cod[h.dia] && /^\d\d:\d\d$/.test(h.desde) && /^\d\d:\d\d$/.test(h.hasta))
    .map((h) => `${cod[h.dia]} ${h.desde}-${h.hasta}`);
}

const fila = (k, v) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`;

function redes() {
  return [
    C.instagram && ['Instagram', urlRed(C.instagram, 'https://www.instagram.com/'), '@' + C.instagram.replace(/^@/, '')],
    C.facebook && ['Facebook', urlRed(C.facebook, 'https://www.facebook.com/'), /^https?:/.test(C.facebook) ? 'Facebook' : C.facebook.replace(/^@/, '')],
    C.tiktok && ['TikTok', urlRed(C.tiktok, 'https://www.tiktok.com/@'), '@' + C.tiktok.replace(/^@/, '')],
    C.mercadolibre && ['Mercado Libre', urlRed(C.mercadolibre, 'https://'), 'Tienda en Mercado Libre']
  ].filter(Boolean);
}

// El mapa: embebido si hay dirección; si no, el dibujo del diseño con el logo.
function mapa(raiz, alto) {
  const estilo = alto ? ` style="min-height: ${alto}px"` : '';
  if (C.direccion) {
    return `<div class="map"${estilo}><iframe title="Mapa: ${esc(direccionCompleta())}" src="https://www.google.com/maps?q=${esc(encodeURIComponent(direccionCompleta() + ', Uruguay'))}&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
  }
  return `<div class="map" role="img" aria-label="${esc(C.localidad + ', ' + C.departamento)}"${estilo}>
<div class="road a"></div><div class="road b"></div>
<div class="pin"><img src="${raiz}img/logo.png" alt=""><span></span></div>
<div class="map-label">${esc(C.localidad + ' · ' + C.departamento)}</div>
</div>`;
}

// ruta: '' (inicio), 'autos/', 'autos/<id>/', '404.html'...
function pagina(plantilla, ruta, datos) {
  const prof = ruta.endsWith('/') ? ruta.split('/').length - 1 : 0;
  // El 404 se sirve en cualquier URL, por eso usa rutas absolutas.
  const raiz = ruta === '404.html' ? BASE : prof ? '../'.repeat(prof) : './';
  const generico = esc(RC.waUrl());
  const tel = C.telLlamadas || C.whatsappLabel;
  const d = Object.assign({
    raiz,
    v: { css: v('css/styles.css'), admin: v('js/admin.js') },
    canonical: SITIO + ruta,
    robots: C.indexar ? '<meta name="robots" content="index, follow, max-image-preview:large">' : '<meta name="robots" content="noindex">',
    ogTipo: 'website',
    ogImagen: SITIO + 'img/og.jpg',
    jsonld: '',
    nav: { catalogo: '', vende: '', consignacion: '', donde: '' },
    wa: { href: generico, label: esc(C.whatsappLabel) },
    negocio: {
      localidad: esc(C.localidad),
      departamento: esc(C.departamento),
      strip: esc([C.localidad, 'Uruguay', C.whatsappLabel].join(' · ')),
      telHref: esc(telHref(tel)),
      direccionCompleta: esc(direccionCompleta()),
      mapsHref: esc(mapsHref()),
      redesPie: redes().map(([red, href, label]) => `<li><a href="${esc(href)}" target="_blank" rel="noopener">${red === 'Instagram' ? 'Instagram ' + esc(label) : esc(red)}</a></li>`).join('')
    }
  }, datos);
  d.scripts = scripts(raiz, d.js || ['config', 'autos', 'common']);
  const html = render(fs.readFileSync(path.join(SRC, plantilla), 'utf8'), d);
  escribir(ruta === '' || ruta.endsWith('/') ? ruta + 'index.html' : ruta, html);
}

function escribir(rel, contenido) {
  const f = path.join(SALIDA, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenido);
}

// ---- Datos estructurados (schema.org) ----

const NEGOCIO_ID = SITIO + '#negocio';
function negocioLd() {
  const horas = horarioSchema();
  const sameAs = redes().map(([, href]) => href);
  return {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    '@id': NEGOCIO_ID,
    name: 'R.Costa Automóviles',
    description: `Automotora en ${C.localidad}, ${C.departamento}. Compra, venta, permuta y consignación de autos seleccionados.`,
    url: SITIO,
    logo: SITIO + 'img/logo.png',
    image: SITIO + 'img/og.jpg',
    telephone: '+' + C.whatsapp,
    address: {
      '@type': 'PostalAddress',
      streetAddress: C.direccion || undefined,
      addressLocality: C.localidad,
      addressRegion: C.departamento,
      addressCountry: 'UY'
    },
    areaServed: { '@type': 'Country', name: 'Uruguay' },
    openingHours: horas.length ? horas : undefined,
    sameAs: sameAs.length ? sameAs : undefined
  };
}

function migas(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item }))
  };
}

function autoLd(a, url) {
  const fotos = (a.fotos || []).map((f) => SITIO + f);
  return {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: RC.titulo(a),
    url,
    image: fotos.length ? fotos : undefined,
    description: a.descripcion || undefined,
    brand: { '@type': 'Brand', name: a.marca },
    model: a.modelo,
    vehicleConfiguration: a.version || undefined,
    bodyType: a.carroceria || undefined,
    vehicleModelDate: a.anio ? String(a.anio) : undefined,
    itemCondition: 'https://schema.org/UsedCondition',
    mileageFromOdometer: a.sinKm ? undefined : { '@type': 'QuantitativeValue', value: a.km, unitCode: 'KMT' },
    fuelType: a.combustible,
    vehicleTransmission: a.transmision,
    vehicleEngine: a.motor ? { '@type': 'EngineSpecification', name: a.motor } : undefined,
    driveWheelConfiguration: /4x4|awd|4matic|xdrive|quattro/i.test(a.traccion || '') ? 'https://schema.org/FourWheelDriveConfiguration' : undefined,
    color: a.color || undefined,
    numberOfDoors: a.puertas || undefined,
    numberOfPreviousOwners: a.duenos || undefined,
    offers: a.precio ? {
      '@type': 'Offer',
      price: a.precio,
      priceCurrency: a.moneda === 'UYU' ? 'UYU' : 'USD',
      availability: a.reservado ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/UsedCondition',
      availableAtOrFrom: a.ubicacion ? { '@type': 'Place', name: a.ubicacion } : undefined,
      url,
      seller: { '@type': 'AutoDealer', '@id': NEGOCIO_ID, name: 'R.Costa Automóviles', url: SITIO }
    } : undefined
  };
}

// ---- Bloques que se repiten ----

// Sin autos publicados: invita a mirar Instagram o a contar qué busca.
function salaVacia(raiz) {
  const ig = C.instagram ? `<a class="btn" href="${esc(urlRed(C.instagram, 'https://www.instagram.com/'))}" target="_blank" rel="noopener">Ver @${esc(C.instagram.replace(/^@/, ''))}</a>` : '';
  return `<div class="empty">
<img src="${raiz}img/linea.svg" alt="">
<p class="eyebrow">Sala en recambio</p>
<h2 class="h2">Estamos preparando <span class="it">los próximos autos.</span></h2>
<p class="lead">Mientras tanto, mirá lo último en Instagram o contanos qué estás buscando.</p>
<div class="row" style="justify-content: center">${ig}<a class="btn btn-line" href="${esc(RC.waUrl(MSG_BUSCO))}">Contanos qué buscás</a></div>
</div>`;
}
const MSG_BUSCO = 'Hola R.Costa, estoy buscando un auto así: (marca, modelo, año, presupuesto). ¿Me avisan si entra uno?';

const seguidores = () => (C.instagram ? '@' + C.instagram.replace(/^@/, '') + (C.seguidores ? ` (${C.seguidores} seguidores)` : '') : '');

// ---- Páginas ----

function generarPaginas() {
  generarInicio();
  generarCatalogo();
  for (const a of AUTOS) generarAuto(a);
  generarVende();
  generarDonde();

  // 404 (GitHub Pages lo sirve para cualquier URL que no exista, ej. un auto vendido)
  pagina('404.html', '404.html', {
    titulo: 'Página no encontrada | R.Costa Automóviles',
    descripcion: 'La página que buscás no existe. Mirá el catálogo de R.Costa Automóviles.',
    robots: '<meta name="robots" content="noindex">',
    js: []
  });

  // Panel del dueño
  pagina('admin.html', 'admin/', {
    titulo: 'Panel · R.Costa Automóviles',
    descripcion: 'Panel de R.Costa Automóviles.',
    robots: '<meta name="robots" content="noindex, nofollow">',
    js: ['config', 'common'],
    soporte: C.soporte ? `<p class="hint">¿Te olvidaste la contraseña? Escribile a ${esc(C.soporte)}.</p>` : ''
  });

  // sitemap.xml y robots.txt
  const urls = [
    [SITIO, HOY, '1.0'],
    [SITIO + 'autos/', HOY, '0.9'],
    ...AUTOS.map((a) => [SITIO + `autos/${a.id}/`, a.actualizado || a.ingreso || HOY, '0.8']),
    [SITIO + 'vende-tu-auto/', HOY, '0.7'],
    [SITIO + 'donde-estamos/', HOY, '0.6']
  ];
  escribir('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(([loc, lastmod, prio]) => `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><priority>${prio}</priority></url>`).join('\n') +
    '\n</urlset>\n');
  escribir('robots.txt', `User-agent: *\nAllow: /\nDisallow: ${BASE}admin/\n\nSitemap: ${SITIO}sitemap.xml\n`);
}

function generarInicio() {
  const raiz = './';
  // Destacados primero, después los más nuevos.
  const sala = AUTOS.filter((a) => a.destacado).concat(AUTOS.filter((a) => !a.destacado)).slice(0, 6);
  const portada = sala.find((a) => a.fotos.length && !a.reservado) || sala.find((a) => a.fotos.length);
  const hero = portada
    ? `<figure class="hero-photo" style="margin: 0"><a href="${RC.autoUrl(portada, raiz)}">
${RC.foto(portada, 0, { raiz, eager: true, alt: RC.titulo(portada) })}
<figcaption class="caption"><span>${esc([RC.numero(portada), RC.nombre(portada)].filter(Boolean).join(' · '))}</span><span>${portada.reservado ? 'Reservado' : 'En exhibición'}</span></figcaption>
</a></figure>`
    : `<figure class="hero-photo" style="margin: 0">
${RC.foto({}, 0, { raiz })}
<figcaption class="caption"><span>R.Costa Automóviles</span><span>${esc(C.localidad)}</span></figcaption>
</figure>`;

  const filas = [];
  if (C.direccion) filas.push(fila('Dirección', esc(C.direccion)));
  for (const [k, h] of filasHorarios()) filas.push(fila(esc(k), esc(h)));
  filas.push(fila('Teléfono y WhatsApp', `<a href="${esc(RC.waUrl())}">${esc(C.whatsappLabel)}</a>`));

  pagina('index.html', '', {
    titulo: `R.Costa Automóviles | Autos seleccionados en ${esc(C.localidad)}`,
    descripcion: esc(`Automotora en ${C.localidad}, ${C.departamento}. Compramos, vendemos, permutamos y consignamos autos seleccionados. Consultas por WhatsApp.`),
    jsonld: jsonld(negocioLd(), { '@context': 'https://schema.org', '@type': 'WebSite', name: 'R.Costa Automóviles', url: SITIO, inLanguage: 'es-UY' }),
    ogImagen: portada ? SITIO + portada.fotos[0] : SITIO + 'img/og.jpg',
    js: [],
    hero,
    verCatalogo: AUTOS.length ? `<a class="link" href="${raiz}autos/">${AUTOS.length === 1 ? 'Ver el auto del catálogo' : `Ver los ${AUTOS.length} autos del catálogo`}</a>` : '',
    destacados: sala.length ? `<div class="lots rail">${sala.map((a) => RC.lot(a, { raiz })).join('')}</div>` : salaVacia(raiz),
    difusion: C.instagram
      ? esc(`Publicado en @${C.instagram.replace(/^@/, '')}${C.seguidores ? `, ante ${C.seguidores} seguidores,` : ''} y en esta web.`)
      : 'Publicado en esta web y en nuestras redes.',
    condiciones: esc([C.consignacion.comision && 'Comisión: ' + C.consignacion.comision, C.consignacion.plazo && 'Plazo: ' + C.consignacion.plazo, C.consignacion.dondeQueda]
      .filter(Boolean).join(' · ') || 'Te las contamos por WhatsApp, según tu auto.'),
    financiacion: C.financiacion ? `<section class="wall sec-sm" aria-labelledby="fin-t">
<div class="wrap split" style="align-items: center">
<div class="stack g16">
<p class="eyebrow">Financiación</p>
<h2 id="fin-t" class="h2">Pagalo en partes.</h2>
</div>
<div class="stack g24">
<p class="body">${esc(C.financiacion)} Tu usado también puede ser parte del pago.</p>
<div class="row"><a class="btn btn-line" href="${esc(RC.waUrl('Hola R.Costa, quiero consultar por financiación.'))}">Consultar financiación</a><a class="link" href="${raiz}vende-tu-auto/?modo=permutar#form">Entregar mi auto</a></div>
</div>
</div>
</section>
` : '',
    mapa: mapa(raiz),
    filasInicio: filas.join('\n'),
    waVisita: esc(RC.waUrl('Hola R.Costa, quiero coordinar una visita.'))
  });
}

function generarCatalogo() {
  // Solo se ofrecen los filtros que tienen autos.
  const opciones = (lista, valores) => lista.filter((x) => valores.includes(x)).concat([...new Set(valores)].filter((x) => x && !lista.includes(x)));
  const grupo = (titulo, clave, todos, ops) => (ops.length < 2 ? '' : `<fieldset class="fgroup"><legend>${titulo}</legend><div class="seg" data-filtro="${clave}">
<button class="chip" type="button" data-v="" aria-pressed="true">${todos}</button>${ops.map((o) => `<button class="chip" type="button" data-v="${esc(o)}" aria-pressed="false">${esc(o)}</button>`).join('')}
</div></fieldset>`);
  const locales = [C.localidad].concat((C.sedes || []).map((s) => s.nombre));
  const filtros = [
    grupo('Tipo', 'tipo', 'Todos', opciones(RC.CARROCERIAS, AUTOS.map((a) => a.carroceria))),
    grupo('Combustible', 'comb', 'Todos', opciones(RC.COMBUSTIBLES, AUTOS.map((a) => a.combustible))),
    grupo('Caja', 'caja', 'Todas', opciones(['Automática', 'Manual'], AUTOS.map((a) => a.transmision))),
    (C.sedes || []).length ? grupo('Local', 'sede', 'Todos', opciones(locales, AUTOS.map((a) => a.sede))) : ''
  ].filter(Boolean).join('\n');
  const vacio = AUTOS.length === 0;

  pagina('autos.html', 'autos/', {
    titulo: `Catálogo de autos en ${esc(C.localidad)} | R.Costa Automóviles`,
    descripcion: esc(`Autos seleccionados en venta en ${C.localidad}, ${C.departamento}. Fotos reales, precios en dólares y consultas por WhatsApp. Aceptamos permutas.`),
    jsonld: jsonld(migas([['Inicio', SITIO], ['Catálogo', SITIO + 'autos/']])),
    nav: { catalogo: ' aria-current="page"', vende: '', consignacion: '', donde: '' },
    js: ['config', 'autos', 'common', 'catalogo'],
    conteo: vacio ? 'Sin autos por ahora' : AUTOS.length === 1 ? '1 auto en exhibición' : AUTOS.length + ' autos en exhibición',
    ocultoSinStock: vacio ? ' hidden' : '',
    filtros,
    grilla: AUTOS.map((a) => RC.lot(a, { raiz: '../', h: 'h2' })).join(''),
    waBusco: esc(RC.waUrl(MSG_BUSCO)),
    sinStock: vacio ? salaVacia('../') : ''
  });
}

function generarAuto(a) {
  const ruta = `autos/${a.id}/`;
  const url = SITIO + ruta;
  const raiz = '../../';
  const nombre = RC.nombre(a);
  const titulo = RC.titulo(a);
  const fotos = a.fotos || [];
  const chicas = a.miniaturas || fotos;
  const total = Math.max(fotos.length, 1);

  const thumbs = fotos.map((f, i) => `<button class="thumb" type="button" role="listitem" data-i="${i}" aria-label="Foto ${i + 1}" aria-current="${i === 0}"><img src="${esc(raiz + (chicas[i] || f))}" alt="" loading="lazy"></button>`).join('');

  const caja = a.transmision + (a.marchas ? ` ${a.marchas} vel.` : '');
  const ficha = [
    ['Año', RC.anio(a)], ['Kilómetros', a.sinKm ? 'A consultar' : RC.miles(a.km)], ['Combustible', a.combustible], ['Caja', caja],
    ['Motor', a.motor], ['Tracción', a.traccion], ['Color', a.color], ['Puertas', a.puertas], ['Dueños', a.duenos], ['Service', a.service],
    ['Dónde se ve', a.ubicacion || (a.sede && (C.sedes || []).length ? a.sede : '')]
  ].filter(([, val]) => val !== undefined && val !== null && val !== '')
    .map(([l, val]) => `<div><dt>${l}</dt><dd>${esc(val)}</dd></div>`).join('\n');

  // El equipamiento se reparte en hasta 3 columnas.
  const eq = a.equipamiento || [];
  const cols = eq.length > 8 ? 3 : eq.length > 3 ? 2 : 1;
  const porCol = Math.ceil(eq.length / cols);
  const equipamiento = eq.length ? `<section class="sec-sm" aria-labelledby="eq-t">
<h2 id="eq-t" class="h3" style="margin-bottom: 24px">Equipamiento</h2>
<div class="equip">
${Array.from({ length: cols }, (_, c) => `<div><ul>${eq.slice(c * porCol, (c + 1) * porCol).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`).join('\n')}
</div>
</section>` : '';

  // Parecidos: primero los de la misma carrocería.
  const otros = AUTOS.filter((o) => o.id !== a.id)
    .sort((x, y) => (y.carroceria === a.carroceria) - (x.carroceria === a.carroceria))
    .slice(0, 3);

  const mensaje = RC.mensajeInteres(a);
  const consulta = esc(RC.waUrl(mensaje));
  const notas = [a.aceptaPermuta && 'Acepta permuta', a.financiable && 'Financiación disponible'].filter(Boolean).join(' · ');

  const descKm = a.sinKm ? '' : `${RC.km(a)}, `;
  pagina('auto.html', ruta, {
    titulo: esc(`${titulo} · ${RC.precio(a)} | R.Costa Automóviles`),
    descripcion: esc(`${titulo}${a.version ? ' ' + a.version : ''} en venta en ${C.localidad}: ${descKm}${a.combustible}, ${a.transmision}. ${RC.precio(a)}.` +
      (a.ubicacion ? ` Se ve en ${a.ubicacion}.` : '') + (a.aceptaPermuta ? ' Aceptamos tu usado en parte de pago.' : '')),
    ogTipo: 'product',
    ogImagen: fotos.length ? SITIO + fotos[0] : SITIO + 'img/og.jpg',
    jsonld: jsonld(autoLd(a, url), migas([['Inicio', SITIO], ['Catálogo', SITIO + 'autos/'], [titulo, url]])),
    nav: { catalogo: ' aria-current="page"', vende: '', consignacion: '', donde: '' },
    js: ['config', 'autos', 'common', 'ficha'],
    consulta,
    mensaje: esc(mensaje),
    a: {
      id: esc(a.id), nombre: esc(nombre), modelo: esc(a.modelo), marca: esc(a.marca), anioSr: a.anio || '',
      migaTipo: a.carroceria ? `<a href="${raiz}autos/?tipo=${esc(encodeURIComponent(a.carroceria))}">${esc(a.carroceria)}</a><span aria-hidden="true">/</span>` : '',
      eyebrow: esc([RC.numero(a), a.marca, a.carroceria].filter(Boolean).join(' · ')),
      version: a.version ? `<p class="lead" style="font-size: 17px">${esc([a.version, a.traccion && !a.version.includes(a.traccion) ? a.traccion : ''].filter(Boolean).join(' · '))}</p>` : '',
      datos: esc(RC.datos(a)),
      precio: esc(RC.precio(a)),
      notaPrecio: notas ? `<p class="hint">${esc(notas)}</p>` : '',
      reservado: a.reservado ? '<p class="msg" style="white-space: normal">Este auto está reservado. Si la reserva se cae, te avisamos primero.</p>' : '',
      cta: a.reservado ? 'Avisame si se libera' : 'Me interesa'
    },
    galeria: {
      principal: RC.foto(a, 0, { raiz, eager: true, alt: `${nombre}, foto 1`, texto: 'Fotos a pedido por WhatsApp' }),
      tag: a.reservado ? '<span class="tag">Reservado</span>' : '',
      total,
      thumbs,
      ocultas: total < 2 ? ' hidden' : ''
    },
    ficha,
    vendedor: a.descripcion ? `<div class="stack g24">
<h2 class="h3">Lo que cuenta el vendedor</h2>
<p class="body" style="font-size: 17px; white-space: pre-line">${esc(a.descripcion)}</p>
</div>` : '',
    equipamiento,
    tituloParecidos: otros.length ? 'Autos parecidos' : 'Mirá el resto de la sala',
    parecidos: otros.length ? `<div class="lots rail">${otros.map((o) => RC.lot(o, { raiz })).join('')}</div>`
      : `<p class="lead">Por ahora es el único auto en exhibición. Si buscás otra cosa, <a href="${esc(RC.waUrl(MSG_BUSCO))}">contanos qué estás buscando</a>.</p>`
  });
}

function generarVende() {
  const k = C.consignacion || {};
  const cond = [['Comisión', k.comision], ['Plazo', k.plazo], ['Dónde queda el auto', k.dondeQueda]].filter(([, val]) => val);
  pagina('vende.html', 'vende-tu-auto/', {
    titulo: 'Vendé, permutá o consigná tu auto | R.Costa Automóviles',
    descripcion: esc(`Te compramos el auto, lo tomamos como parte de pago o lo vendemos por vos en consignación, en ${C.localidad}. Completá los datos y te contestamos por WhatsApp.`),
    jsonld: jsonld(migas([['Inicio', SITIO], ['Vendé, permutá o consigná', SITIO + 'vende-tu-auto/']])),
    nav: { catalogo: '', vende: ' aria-current="page"', consignacion: '', donde: '' },
    js: ['config', 'autos', 'common', 'vende'],
    publicacion: C.instagram ? `En ${esc(seguidores())} y en el catálogo de esta web.` : 'En el catálogo de esta web y en nuestras redes.',
    filaPapeles: k.papeles ? `<li><span class="k">Papeles</span><span class="v">${esc(k.papeles)}</span></li>` : '',
    condiciones: cond.length
      ? cond.map(([l, val]) => `<li><span class="k">${l}</span><span class="v">${esc(val)}</span></li>`).join('\n')
      : '<li><span class="k">Comisión y plazos</span><span class="v">Te los contamos por WhatsApp, según tu auto.</span></li>'
  });
}

function generarDonde() {
  const horas = filasHorarios();
  const tel = C.telLlamadas || C.whatsappLabel;
  const sedes = (C.sedes || []).filter((s) => s.nombre);
  pagina('donde.html', 'donde-estamos/', {
    titulo: `Dónde estamos: ${esc(C.localidad)}, ${esc(C.departamento)} | R.Costa Automóviles`,
    descripcion: esc(`Dirección, horarios y teléfonos de R.Costa Automóviles en ${C.localidad}, ${C.departamento}. Coordiná tu visita por WhatsApp.`),
    jsonld: jsonld(negocioLd(), migas([['Inicio', SITIO], ['Dónde estamos', SITIO + 'donde-estamos/']])),
    nav: { catalogo: '', vende: '', consignacion: '', donde: ' aria-current="page"' },
    js: [],
    mapa: mapa('../', 560),
    filasHorario: (horas.length ? horas.map(([d, h]) => fila(esc(d), esc(h))) : [fila('Horario', 'Consultanos por WhatsApp')]).join('\n'),
    filasTelefonos: [
      fila('WhatsApp', `<a href="${esc(RC.waUrl())}">${esc(C.whatsappLabel)}</a>`),
      fila('Llamadas', `<a href="${esc(telHref(tel))}">${esc(tel)}</a>`),
      C.telOtro ? fila('Otro teléfono', `<a href="${esc(telHref(C.telOtro))}">${esc(C.telOtro)}</a>`) : ''
    ].filter(Boolean).join('\n'),
    redes: redes().length ? `<div class="stack g16">
<h2 class="h3">Redes</h2>
<table class="hours">
<tbody>
${redes().map(([red, href, label]) => fila(red, `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`)).join('\n')}
</tbody>
</table>
</div>` : '',
    otrosLocales: sedes.length ? `<div class="stack g16">
<h2 class="h3">Otros locales</h2>
<table class="hours">
<tbody>
${sedes.map((s) => fila(esc(s.nombre), `<span class="otros-locales"><span>${esc(s.direccion || 'Dirección a confirmar')}</span>${s.horario ? `<span class="muted">${esc(s.horario)}</span>` : ''}</span>`)).join('\n')}
</tbody>
</table>
</div>` : '',
    waVisita: esc(RC.waUrl('Hola R.Costa, quiero coordinar una visita.'))
  });
}

// ---- Validación de js/autos.js: mejor que falle acá y no que se publique roto ----

function validar(autos) {
  const ids = new Set();
  for (const a of autos) {
    const quien = a.id || `${a.marca} ${a.modelo}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id || '')) throw new Error(`${quien}: el id tiene que ser minúsculas y guiones (ej. ford-ranger-raptor-2024)`);
    if (ids.has(a.id)) throw new Error(`${a.id}: id repetido`);
    ids.add(a.id);
    for (const campo of ['marca', 'modelo', 'combustible', 'transmision']) {
      if (a[campo] === undefined || a[campo] === '') throw new Error(`${a.id}: falta "${campo}"`);
    }
    if (!TIPOS.includes(a.tipo)) throw new Error(`${a.id}: tipo tiene que ser ${TIPOS.join(', ')}`);
    for (const f of a.fotos || []) {
      if (!fs.existsSync(path.join(RAIZ, f))) throw new Error(`${a.id}: no existe la foto ${f}`);
    }
  }
}

main().catch((e) => {
  console.error('Error: ' + e.message);
  process.exit(1);
});
