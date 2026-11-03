// Panel del dueño (/admin/): login, lista de autos, alta/edición/baja, fotos y datos del negocio.
// Los permisos los pone la base compartida: solo los usuarios de la tabla admins de esta automotora pueden escribir.
// La web pública no lee de acá en vivo: al guardar, Supabase dispara la publicación (scripts/generar.js).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const C = window.RC_CONFIG;
const RC = window.RC;
const BUCKET = 'fotos';
// Base compartida: esta web solo ve y edita los autos de su automotora.
const CONCESIONARIA = C.concesionaria;
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const $ = (s) => document.querySelector(s);
const esc = RC.esc;

const form = $('#f-auto');
const fNegocio = $('#f-negocio');
let sb;
let autos = [];
let filtro = 'todos';
let negocio = null;
// Editor: auto que se edita (null = nuevo), fotos actuales (rutas en el bucket),
// las subidas en esta edición (se borran si se cancela) y las quitadas (se borran al guardar).
let actual = null;
let fotos = [];
let nuevas = [];
let quitadas = [];
let equip = [];
let subiendo = 0;

// "Mantener la sesión abierta": si está apagado, la sesión se guarda solo mientras dure la pestaña.
const recordar = () => { try { return localStorage.getItem('rc-recordar') !== 'no'; } catch { return true; } };
const almacen = {
  getItem: (k) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => {
    try {
      const [usar, otro] = recordar() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
      usar.setItem(k, v);
      otro.removeItem(k);
    } catch { /* navegación privada */ }
  },
  removeItem: (k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* idem */ } }
};

sb = createClient(C.supabaseUrl, C.supabaseKey, { auth: { storage: almacen } });
$('#rem').checked = recordar();
iniciar();

async function iniciar() {
  const { data } = await sb.auth.getSession();
  $('#cargando').hidden = true;
  if (data.session) await entrar();
  else mostrarLogin();
}

// GitHub Pages deja que el navegador guarde cada página 10 minutos: desde el panel,
// los links a la web agregan ?v=<hora> para abrir siempre lo recién publicado.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-fresco]');
  if (!a) return;
  const url = new URL(a.href, location.href);
  url.searchParams.set('v', Date.now());
  a.href = url.toString();
});

// Navegación: data-ir="lista" | "nuevo" | "negocio".
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ir]');
  if (!b) return;
  e.preventDefault();
  irA(b.dataset.ir);
});

async function irA(ir) {
  // Si se sale del editor sin guardar, las fotos subidas en esta edición no quedaron en ningún auto: se borran.
  if (!$('#v-editor').hidden) {
    await borrarArchivos(nuevas);
    nuevas = [];
  }
  if (ir === 'nuevo') abrir(null);
  else if (ir === 'negocio') abrirNegocio();
  else vista('lista');
}

function mostrarLogin() {
  $('#app').hidden = true;
  $('#v-login').hidden = false;
}

function vista(nombre) {
  $('#v-login').hidden = true;
  $('#app').hidden = false;
  for (const v of ['lista', 'editor', 'negocio']) $('#v-' + v).hidden = v !== nombre;
  $('#m-lista').hidden = nombre !== 'lista';
  const menu = nombre === 'editor' ? (actual ? 'lista' : 'nuevo') : nombre;
  document.querySelectorAll('.pn-side [data-ir], .pn-bottom [data-ir]').forEach((a) => {
    const on = a.dataset.ir === menu || (menu === 'nuevo' && a.dataset.ir === 'lista' && a.closest('.pn-bottom'));
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

function aviso(texto) {
  const t = $('#toast');
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => { t.hidden = true; }, 5000);
}

function error(el, texto) {
  el.textContent = texto || '';
  el.hidden = !texto;
}

// ---- Login ----

$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  error($('#login-error'));
  try { localStorage.setItem('rc-recordar', $('#rem').checked ? 'si' : 'no'); } catch { /* navegación privada */ }
  $('#entrar').disabled = true;
  const { error: err } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  $('#entrar').disabled = false;
  if (err) return error($('#login-error'), 'Correo o contraseña incorrectos.');
  await entrar();
});

async function entrar() {
  const { data: puede } = await sb.rpc('puede_editar', { c: CONCESIONARIA });
  if (!puede) {
    await sb.auth.signOut();
    mostrarLogin();
    return error($('#login-error'), 'Este usuario todavía no tiene permiso para editar R.Costa Automóviles.');
  }
  await Promise.all([cargarLista(), leerNegocio()]);
}

$('#salir').addEventListener('click', async () => {
  await sb.auth.signOut();
  mostrarLogin();
});

// ---- Lista ----

async function cargarLista() {
  const [{ data, error: err }] = await Promise.all([
    sb.from('autos').select('*').eq('concesionaria', CONCESIONARIA).order('created_at', { ascending: false }),
    leerPublicacion()
  ]);
  if (err) return aviso('No se pudo cargar la lista: ' + err.message);
  autos = data;
  pintarLista();
  vista('lista');
}

// Cuándo se generó la web publicada (estado.json lo escribe scripts/generar.js).
// Un auto modificado después de eso todavía no se ve en la web.
let publicadoEn = null;
async function leerPublicacion() {
  try {
    const r = await fetch(C.sitio + 'estado.json?t=' + Date.now(), { cache: 'no-store' });
    publicadoEn = r.ok ? new Date((await r.json()).generado) : null;
  } catch {
    publicadoEn = null;
  }
}
const pendiente = (a) => publicadoEn && new Date(a.updated_at) > publicadoEn;

// Mientras haya cambios sin publicar, se vuelve a mirar cada 20 segundos.
let revision;
function revisarPublicacion() {
  clearTimeout(revision);
  if (!autos.some(pendiente)) return;
  revision = setTimeout(async () => {
    await leerPublicacion();
    if (!$('#v-lista').hidden) pintarLista();
    else revisarPublicacion();
  }, 20000);
}

function urlFoto(ruta, chica) {
  return sb.storage.from(BUCKET).getPublicUrl(chica ? ruta.replace(/\.jpg$/, '_m.jpg') : ruta).data.publicUrl;
}

const enWeb = (a) => a.publicado && a.estado !== 'vendido';
const titulo = (a) => [a.marca, a.modelo, a.anio].filter(Boolean).join(' ');
const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);

function pintarLista() {
  const cuenta = (e) => autos.filter((a) => a.estado === e).length;
  $('#resumen').textContent = `${autos.filter(enWeb).length} en la web · ${plural(cuenta('reservado'), 'reservado', 'reservados')}`;
  const tabs = [['todos', 'Todos', autos.length], ['disponible', 'Disponibles', cuenta('disponible')], ['reservado', 'Reservados', cuenta('reservado')], ['vendido', 'Vendidos', cuenta('vendido')]];
  const borradores = autos.filter((a) => !a.publicado).length;
  if (borradores) tabs.push(['borrador', 'Borradores', borradores]);
  $('#tabs').innerHTML = tabs.map(([k, l, n]) => `<button class="tab" type="button" data-f="${k}" aria-pressed="${filtro === k}">${l} ${n}</button>`).join('');

  const q = $('#buscar').value.trim().toLowerCase();
  const lista = autos.filter((a) => (filtro === 'todos' || (filtro === 'borrador' ? !a.publicado : a.estado === filtro)) &&
    (!q || titulo(a).toLowerCase().includes(q)));
  $('#lista').innerHTML = lista.map((a) => {
    const x = a.extra || {};
    const media = a.fotos.length
      ? `<img src="${esc(urlFoto(a.fotos[0], true))}" alt="" loading="lazy">`
      : '<div class="noimg ph" style="font-size: 9px">Sin foto</div>';
    const meta = [x.numero && RC.numero({ numero: x.numero }), a.anio || 'Año a consultar', x.sin_km ? 'Km a consultar' : RC.miles(a.km) + ' km', a.combustible, a.transmision === 'Automática' ? 'Aut.' : a.transmision].filter(Boolean).join(' · ');
    const chips = [
      a.destacado && '<span class="state" style="min-height: 22px; font-size: 10px">Destacado</span>',
      !a.publicado && '<span class="pn-pend">Borrador</span>',
      enWeb(a) && pendiente(a) && '<span class="pn-pend">Publicándose…</span>'
    ].filter(Boolean).join('');
    return `<div class="car-row" data-id="${a.id}">
${media}
<div class="stack g4" style="min-width: 0">
<p class="car-name">${esc(titulo(a))}</p>
<p class="car-meta">${esc(meta)}</p>
<div class="row" style="gap: 8px; margin-top: 4px"><span class="car-price">${esc(RC.precio(a))}</span>${chips}</div>
</div>
<div class="stcol stack g4">
<label class="flabel" for="estado-${a.id}">Estado</label>
<select id="estado-${a.id}" class="sel" data-estado>
${['disponible', 'reservado', 'vendido'].map((e) => `<option value="${e}"${a.estado === e ? ' selected' : ''}>${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}
</select>
</div>
<div class="actions row" style="gap: 8px; flex-wrap: nowrap">
<button class="btn btn-line btn-sm" type="button" data-editar style="flex: 1">Editar</button>
<button class="chip" type="button" aria-pressed="${!!a.destacado}" data-destacar style="flex: 1; justify-content: center">Destacar</button>
</div>
</div>`;
  }).join('') || `<div class="empty" style="padding: 56px 24px">
<img src="${RC.esc(document.body.dataset.raiz)}img/linea.svg" alt="" style="width: 200px">
<p style="font: 600 24px/1.2 var(--serif); margin: 0">${autos.length ? 'No hay autos acá.' : 'Todavía no cargaste autos.'}</p>
<p class="hint">${autos.length ? 'Cambiá el filtro o cargá uno nuevo.' : 'Tocá “+ Cargar auto” y sacale las fotos desde el celular.'}</p>
</div>`;
  revisarPublicacion();
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  filtro = b.dataset.f;
  pintarLista();
});
$('#buscar').addEventListener('input', pintarLista);

// Estado y destacado se cambian desde la lista, sin abrir el auto.
async function cambiar(a, datos) {
  const { data, error: err } = await sb.from('autos').update(datos).eq('id', a.id).select().single();
  if (err) {
    aviso('No se pudo guardar: ' + err.message);
    return pintarLista();
  }
  Object.assign(a, data);
  aviso('Guardado. En un par de minutos se ve en la web.');
  pintarLista();
}

// La fecha de venta queda en extra.vendido_el (fecha local; en sueco el formato es AAAA-MM-DD).
function conEstado(a, estado) {
  const extra = Object.assign({}, a.extra);
  if (estado === 'vendido') extra.vendido_el = extra.vendido_el || new Date().toLocaleDateString('sv');
  else delete extra.vendido_el;
  return { estado, extra };
}

$('#lista').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-estado]');
  if (!sel) return;
  const a = autos.find((x) => String(x.id) === sel.closest('.car-row').dataset.id);
  cambiar(a, conEstado(a, sel.value));
});
$('#lista').addEventListener('click', (e) => {
  const fila = e.target.closest('.car-row');
  if (!fila) return;
  const a = autos.find((x) => String(x.id) === fila.dataset.id);
  if (e.target.closest('[data-editar]')) abrir(a);
  else if (e.target.closest('[data-destacar]')) cambiar(a, { destacado: !a.destacado });
});

// ---- Datos del negocio ----
// Se guardan en la tabla `negocios`; al publicar pisan a config.js en toda la web.
// Columnas: whatsapp, telefono, direccion, horario, instagram, facebook, tiktok.
// En extra: telLlamadas, telOtro, localidad, departamento, mapa, horarios (por día), mercadolibre y sedes.

const EXTRA_NEGOCIO = ['telLlamadas', 'telOtro', 'localidad', 'departamento', 'mapa', 'mercadolibre'];
const REDES = ['instagram', 'facebook', 'tiktok'];

async function leerNegocio() {
  const { data } = await sb.from('negocios').select('*').eq('concesionaria', CONCESIONARIA).maybeSingle();
  negocio = data;
  if (data && data.extra && Array.isArray(data.extra.sedes)) C.sedes = data.extra.sedes;
}

async function abrirNegocio() {
  error($('#neg-error'));
  await leerNegocio();
  const n = negocio;
  const x = (n && n.extra) || {};
  const el = fNegocio.elements;
  // Sin fila todavía: se muestra lo que hoy publica la web (config.js).
  el.whatsapp.value = (n && n.telefono) || C.whatsappLabel || '';
  el.direccion.value = (n ? n.direccion : C.direccion) || '';
  for (const k of REDES) el[k].value = (n ? n[k] : C[k]) || '';
  if (el.instagram.value) el.instagram.value = '@' + el.instagram.value.replace(/^@/, '');
  for (const k of EXTRA_NEGOCIO) el[k].value = (typeof x[k] === 'string' ? x[k] : C[k]) || '';
  pintarDias(Array.isArray(x.horarios) ? x.horarios : C.horarios || []);
  pintarSedes(Array.isArray(x.sedes) ? x.sedes : C.sedes || []);
  vista('negocio');
}

function pintarDias(horarios) {
  $('#dias').innerHTML = DIAS.map((dia, i) => {
    const h = horarios.find((x) => x.dia === dia) || { abierto: i < 6, desde: '09:00', hasta: i === 5 ? '13:00' : '18:00', nuevo: true };
    return `<div class="dia" data-dia="${dia}" style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 16px; align-items: center; padding: 12px 0; border-bottom: 1px solid #DAD8D3">
<span style="font-weight: 600">${dia}</span>
<label class="row" style="gap: 10px; font-size: 14px; flex-wrap: nowrap" for="sw-${i}">Abierto<input id="sw-${i}" class="sw" type="checkbox"${h.abierto ? ' checked' : ''}></label>
<div class="horas" style="grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px"${h.abierto ? '' : ' hidden'}>
<div class="field"><label for="a-${i}">Abre</label><input id="a-${i}" class="input" type="time" value="${esc(h.desde || '')}" style="font-family: var(--mono)"></div>
<div class="field"><label for="c-${i}">Cierra</label><input id="c-${i}" class="input" type="time" value="${esc(h.hasta || '')}" style="font-family: var(--mono)"></div>
</div>
</div>`;
  }).join('');
  // Sin horarios cargados se proponen unos, pero no se guardan hasta que el dueño toque algo.
  $('#dias').dataset.sinCargar = horarios.length ? '' : '1';
}
$('#dias').addEventListener('change', (e) => {
  $('#dias').dataset.sinCargar = '';
  const sw = e.target.closest('.sw');
  if (sw) sw.closest('.dia').querySelector('.horas').hidden = !sw.checked;
});

function pintarSedes(sedes) {
  $('#sedes').innerHTML = sedes.map((s, i) => sedeHtml(s, i)).join('');
}
function sedeHtml(s, i) {
  return `<div class="sede-box" data-sede>
<div class="row" style="justify-content: space-between"><p class="card-h" style="margin: 0">Otro local</p><button class="btn btn-line btn-sm" type="button" data-quitar-sede>Quitar</button></div>
<div class="form-grid">
<div class="field"><label for="s-n-${i}">Nombre (barrio o ciudad)</label><input id="s-n-${i}" class="input" data-k="nombre" type="text" autocomplete="off" value="${esc(s.nombre || '')}" placeholder="Ej.: Solymar"></div>
<div class="field"><label for="s-d-${i}">Calle y número</label><input id="s-d-${i}" class="input" data-k="direccion" type="text" autocomplete="off" value="${esc(s.direccion || '')}"></div>
<div class="field span2"><label for="s-h-${i}">Horario</label><input id="s-h-${i}" class="input" data-k="horario" type="text" autocomplete="off" value="${esc(s.horario || '')}" placeholder="Ej.: Lunes a sábado 9:00 a 18:00"></div>
</div>
</div>`;
}
$('#agregar-sede').addEventListener('click', () => {
  $('#sedes').insertAdjacentHTML('beforeend', sedeHtml({}, Date.now()));
  $('#sedes').lastElementChild.querySelector('input').focus();
});
$('#sedes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-quitar-sede]');
  if (b) b.closest('[data-sede]').remove();
});

// "095 407 252", "+598 95 407 252" o "2303 6119" → { whatsapp: '59895407252', telefono: '095 407 252' }.
function telefonoUY(texto) {
  let d = texto.replace(/\D/g, '');
  if (d.startsWith('598')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^[0-9]{8}$/.test(d)) return null;
  const telefono = d.startsWith('9') ? `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` : `${d.slice(0, 4)} ${d.slice(4)}`;
  return { whatsapp: '598' + d, telefono };
}

// Resumen para la columna `horario`: "Lunes a viernes 09:00 a 18:00 · Sábado 09:00 a 13:00".
function resumenHorario(hs) {
  const grupos = [];
  for (const h of hs) {
    const t = h.abierto ? `${h.desde} a ${h.hasta}` : 'Cerrado';
    const ult = grupos[grupos.length - 1];
    if (ult && ult.t === t) ult.dias.push(h.dia);
    else grupos.push({ dias: [h.dia], t });
  }
  return grupos.filter((g) => g.t !== 'Cerrado')
    .map((g) => (g.dias.length > 1 ? `${g.dias[0]} a ${g.dias[g.dias.length - 1].toLowerCase()}` : g.dias[0]) + ' ' + g.t).join(' · ');
}

fNegocio.addEventListener('submit', async (e) => {
  e.preventDefault();
  error($('#neg-error'));
  const el = fNegocio.elements;
  const tel = telefonoUY(el.whatsapp.value);
  if (!tel) return error($('#neg-error'), 'El WhatsApp tiene que ser un número de Uruguay, por ejemplo 099 123 456.');
  const extra = Object.assign({}, negocio && negocio.extra);
  for (const k of EXTRA_NEGOCIO) extra[k] = el[k].value.trim();
  // Los teléfonos se guardan con el mismo formato que el WhatsApp.
  for (const k of ['telLlamadas', 'telOtro']) {
    if (!extra[k]) continue;
    const t = telefonoUY(extra[k]);
    if (!t) return error($('#neg-error'), 'Revisá el teléfono: tiene que ser un número de Uruguay, por ejemplo 2682 0000 o 099 123 456.');
    extra[k] = t.telefono;
  }
  if (extra.mapa && !/^https?:\/\//.test(extra.mapa)) return error($('#neg-error'), 'El enlace de Google Maps tiene que empezar con https://');
  const horarios = DIAS.map((dia, i) => ({ dia, abierto: $('#sw-' + i).checked, desde: $('#a-' + i).value, hasta: $('#c-' + i).value }));
  if (horarios.some((h) => h.abierto && (!h.desde || !h.hasta))) return error($('#neg-error'), 'Completá la hora de apertura y de cierre de los días abiertos.');
  if (!$('#dias').dataset.sinCargar) extra.horarios = horarios;
  extra.sedes = [...document.querySelectorAll('[data-sede]')]
    .map((b) => Object.fromEntries([...b.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()])))
    .filter((s) => s.nombre);
  const fila = {
    concesionaria: CONCESIONARIA,
    ...tel,
    direccion: el.direccion.value.trim() || null,
    horario: extra.horarios ? resumenHorario(extra.horarios).slice(0, 200) || null : (negocio && negocio.horario) || null,
    extra
  };
  for (const k of REDES) fila[k] = el[k].value.trim().replace(/^@/, '') || null;

  $('#guardar-negocio').disabled = true;
  const { data, error: err } = await sb.from('negocios').upsert(fila, { onConflict: 'concesionaria' }).select().single();
  $('#guardar-negocio').disabled = false;
  if (err) return error($('#neg-error'), 'No se pudo guardar: ' + err.message);
  negocio = data;
  C.sedes = extra.sedes;
  Object.assign(C, { whatsapp: tel.whatsapp, whatsappLabel: tel.telefono });
  aviso('Guardado. En un par de minutos se actualiza en toda la web.');
  vista('lista');
});

// ---- Editor ----

const SELECCION = ['transmision', 'moneda', 'estado'];
const CHECKS = ['publicado', 'destacado', 'acepta_permuta'];
// Se escriben como en Uruguay ("64.000", "U$S 14.500"): se toman solo los dígitos.
const ENTEROS = ['anio', 'km', 'precio', 'marchas', 'puertas', 'duenos'];
const MONTOS = ['km', 'precio'];
const TEXTOS = ['marca', 'carroceria', 'combustible', 'motor', 'traccion', 'color', 'descripcion'];
const EXTRA = ['version', 'service', 'ubicacion', 'sede'];

$('#e-carroceria').innerHTML = RC.CARROCERIAS.map((c) => `<option>${c}</option>`).join('');

function elegir(grupo, valor) {
  form.querySelectorAll(`[data-grupo="${grupo}"] [data-v]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === valor)));
}
const elegido = (grupo) => form.querySelector(`[data-grupo="${grupo}"] [aria-pressed="true"]`).dataset.v;
form.addEventListener('click', (e) => {
  const b = e.target.closest('[data-grupo] [data-v]');
  if (b) elegir(b.closest('[data-grupo]').dataset.grupo, b.dataset.v);
});

// Local del auto: solo si hay más de un local.
function pintarSedesAuto(valor) {
  const locales = (C.sedes || []).map((s) => s.nombre).filter(Boolean);
  $('#campo-sede').hidden = !locales.length;
  $('#e-sede').innerHTML = ['<option value="">Sin indicar</option>', ...[C.localidad, ...locales].map((n) => `<option>${esc(n)}</option>`)].join('');
  $('#e-sede').value = valor || '';
}

function abrir(a) {
  actual = a;
  form.reset();
  error($('#ed-error'));
  fotos = a ? a.fotos.slice() : [];
  nuevas = [];
  quitadas = [];
  equip = a ? (a.equipamiento || []).slice() : [];
  const x = (a && a.extra) || {};
  const el = form.elements;
  elegir('transmision', a ? a.transmision : 'Manual');
  elegir('moneda', a ? a.moneda : 'USD');
  elegir('estado', a ? a.estado : 'disponible');
  el.carroceria.value = 'SUV';
  if (a) {
    for (const k of TEXTOS) if (a[k] != null && a[k] !== '') el[k].value = String(a[k]);
    for (const k of ENTEROS) el[k].value = a[k] == null ? '' : MONTOS.includes(k) ? (a[k] ? RC.miles(a[k]) : '') : String(a[k]);
    for (const k of CHECKS) el[k].checked = !!a[k];
    for (const k of EXTRA) el[k].value = typeof x[k] === 'string' ? x[k] : '';
    // `modelo` en la base es modelo + versión; acá se muestran separados.
    el.modelo.value = x.version && a.modelo.endsWith(' ' + x.version) ? a.modelo.slice(0, -x.version.length - 1) : a.modelo;
    // Km vacío = "a consultar" (extra.sin_km); si no, se muestra aunque sea 0.
    el.km.value = x.sin_km ? '' : RC.miles(a.km || 0);
    el.financiable.checked = x.financiable === true;
    if (!RC.CARROCERIAS.includes(el.carroceria.value)) el.carroceria.value = a.tipo === 'camioneta' ? 'Pick-up' : a.tipo === 'utilitario' ? 'Furgón' : 'Sedán';
  }
  pintarSedesAuto(x.sede);
  $('#ed-titulo').textContent = a ? titulo(a) : 'Cargar un auto';
  $('#ed-meta').hidden = !a;
  if (a) {
    const fecha = new Date(a.updated_at).toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' });
    $('#ed-meta').textContent = [x.numero && RC.numero({ numero: x.numero }), 'Última edición ' + fecha].filter(Boolean).join(' · ');
  }
  $('#ed-ver').hidden = !a || !enWeb(a);
  if (a) $('#ed-ver').href = C.sitio + 'autos/' + a.slug + '/';
  $('#borrar-box').hidden = !a;
  $('#guardar').textContent = a ? 'Guardar' : 'Publicar auto';
  pintarFotos();
  pintarEquip();
  vista('editor');
}

function datosDelForm() {
  const el = form.elements;
  const t = (k) => el[k].value.trim();
  const fila = {};
  for (const k of TEXTOS) fila[k] = t(k) || null;
  for (const k of ENTEROS) fila[k] = t(k).replace(/\D/g, '') ? Number(t(k).replace(/\D/g, '')) : null;
  for (const k of CHECKS) fila[k] = el[k].checked;
  for (const k of SELECCION) fila[k] = elegido(k);
  const sinKm = fila.km === null;
  if (sinKm) fila.km = 0;
  // `modelo` en la base es modelo + versión; la versión sola queda en extra.version.
  fila.modelo = [t('modelo'), t('version')].filter(Boolean).join(' ');
  fila.tipo = fila.carroceria === 'Pick-up' ? 'camioneta' : fila.carroceria === 'Furgón' ? 'utilitario' : 'auto';
  fila.equipamiento = equip;
  // Se conservan los datos de extra que este panel no maneja.
  const extra = Object.assign({}, actual && actual.extra);
  for (const k of EXTRA) {
    if (t(k)) extra[k] = t(k);
    else delete extra[k];
  }
  if (sinKm) extra.sin_km = true;
  else delete extra.sin_km;
  if (el.financiable.checked) extra.financiable = true;
  else delete extra.financiable;
  Object.assign(extra, conEstado({ extra }, fila.estado).extra);
  // N.º de exhibición: el siguiente al más alto.
  if (!extra.numero) extra.numero = Math.max(autos.length, ...autos.map((a) => Number(a.extra && a.extra.numero) || 0)) + 1;
  fila.extra = extra;
  fila.fotos = fotos;
  return fila;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error($('#ed-error'));
  if (subiendo) return error($('#ed-error'), 'Esperá a que terminen de subir las fotos.');
  const fila = datosDelForm();
  const falta = [['marca', 'marca'], ['modelo', 'modelo']].filter(([k]) => !fila[k]).map(([, l]) => l);
  if (falta.length) return error($('#ed-error'), 'Completá: ' + falta.join(' y ') + '.');
  const max = new Date().getFullYear() + 1;
  if (fila.anio !== null && (fila.anio < 1950 || fila.anio > max)) return error($('#ed-error'), `El año tiene que estar entre 1950 y ${max}.`);

  $('#guardar').disabled = true;
  // El slug es la URL del auto (/autos/<slug>/): marca-modelo-año. Se mantiene mientras no cambien
  // esos datos; si cambian, se actualiza. Si ya existe otro igual, se le agrega -2, -3...
  const base = slugDe([fila.marca, fila.modelo, fila.anio].filter(Boolean).join(' '));
  const mismo = actual && (actual.slug === base || (actual.slug.startsWith(base) && /^-\d+$/.test(actual.slug.slice(base.length))));
  let err;
  for (let n = 1; n < 20; n++) {
    const slug = mismo ? actual.slug : n === 1 ? base : `${base}-${n}`;
    ({ error: err } = actual
      ? await sb.from('autos').update({ ...fila, slug }).eq('id', actual.id)
      : await sb.from('autos').insert({ ...fila, slug, concesionaria: CONCESIONARIA }));
    if (!err || err.code !== '23505' || mismo) break;
  }
  $('#guardar').disabled = false;
  if (err) return error($('#ed-error'), 'No se pudo guardar: ' + err.message);

  await borrarArchivos(quitadas);
  nuevas = [];
  aviso('Guardado. En un par de minutos se ve en la web.');
  await cargarLista();
});

function slugDe(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

$('#cancelar').addEventListener('click', () => irA('lista'));

$('#borrar').addEventListener('click', async () => {
  if (!confirm(`¿Borrar ${titulo(actual)} y sus fotos para siempre?\n\nSi se vendió, mejor marcalo como Vendido.`)) return;
  const { error: err } = await sb.from('autos').delete().eq('id', actual.id);
  if (err) return error($('#ed-error'), 'No se pudo borrar: ' + err.message);
  await borrarArchivos([...actual.fotos, ...nuevas]);
  nuevas = [];
  aviso('Auto borrado.');
  await cargarLista();
});

// ---- Equipamiento ----

function pintarEquip() {
  $('#equip').innerHTML = equip.map((q, i) => `<span class="eq-chip">${esc(q)}<button type="button" aria-label="Quitar ${esc(q)}" data-i="${i}">×</button></span>`).join('') ||
    '<p class="hint">Sin equipamiento cargado.</p>';
}
function agregarEquip() {
  const v = $('#e-eq').value.trim();
  if (v && !equip.includes(v)) equip.push(v);
  $('#e-eq').value = '';
  pintarEquip();
}
$('#agregar-eq').addEventListener('click', agregarEquip);
$('#e-eq').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  agregarEquip();
});
$('#equip').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  equip.splice(Number(b.dataset.i), 1);
  pintarEquip();
});

// ---- Fotos ----

function pintarFotos() {
  $('#n-fotos').textContent = plural(fotos.length, 'foto', 'fotos') + ' · la primera es la portada';
  $('#fotos').innerHTML = fotos.map((ruta, i) => `<div class="ph-item">
<div class="pic"><img src="${esc(urlFoto(ruta, true))}" alt="Foto ${i + 1}">${i === 0 ? '<span class="cover">Portada</span>' : ''}</div>
<div class="ctrls">
<button class="iconbtn" type="button" data-accion="izq" data-i="${i}" aria-label="Mover foto ${i + 1} a la izquierda"${i === 0 ? ' disabled' : ''}>←</button>
<button class="iconbtn" type="button" data-accion="portada" data-i="${i}" aria-label="Usar foto ${i + 1} como portada" aria-pressed="${i === 0}" style="font-size: 11px; letter-spacing: .06em">PORT.</button>
<button class="iconbtn" type="button" data-accion="der" data-i="${i}" aria-label="Mover foto ${i + 1} a la derecha"${i === fotos.length - 1 ? ' disabled' : ''}>→</button>
<button class="iconbtn" type="button" data-accion="quitar" data-i="${i}" aria-label="Quitar foto ${i + 1}">×</button>
</div>
</div>`).join('');
}

$('#fotos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-accion]');
  if (!b) return;
  const i = Number(b.dataset.i);
  const accion = b.dataset.accion;
  if (accion === 'quitar') quitadas.push(...fotos.splice(i, 1));
  else if (accion === 'portada') fotos.unshift(...fotos.splice(i, 1));
  else {
    const j = accion === 'izq' ? i - 1 : i + 1;
    [fotos[i], fotos[j]] = [fotos[j], fotos[i]];
  }
  pintarFotos();
});

// Dos entradas: la galería (varias a la vez) y la cámara del celular (una por vez, se sube al sacarla).
for (const id of ['#gal', '#cam']) {
  $(id).addEventListener('change', (e) => {
    const archivos = [...e.target.files];
    e.target.value = '';
    subirFotos(archivos);
  });
}

async function subirFotos(archivos) {
  const estado = $('#subiendo');
  subiendo += archivos.length;
  $('#guardar').disabled = true;
  let hechas = 0;
  for (const archivo of archivos) {
    estado.hidden = false;
    estado.textContent = `Subiendo foto ${++hechas} de ${archivos.length}…`;
    try {
      const ruta = `${CONCESIONARIA}/${crypto.randomUUID()}.jpg`;
      const img = await decodificar(archivo);
      const [grande, chica] = await Promise.all([achicar(img, 1600, 0.82), achicar(img, 640, 0.78)]);
      for (const [r, blob] of [[ruta, grande], [ruta.replace(/\.jpg$/, '_m.jpg'), chica]]) {
        const { error: err } = await sb.storage.from(BUCKET).upload(r, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (err) throw err;
      }
      fotos.push(ruta);
      nuevas.push(ruta);
      pintarFotos();
    } catch (err) {
      aviso(`No se pudo subir ${archivo.name}: ${err.message || err}`);
    }
    subiendo--;
  }
  estado.hidden = true;
  if (!subiendo) $('#guardar').disabled = false;
}

// Recorta la foto al medio en 4:3 (como se ven en la web) y la achica a JPG de ~200 KB.
async function achicar(img, ancho, calidad) {
  let sw = img.width;
  let sh = img.height;
  if (sw / sh > 4 / 3) sw = Math.round(sh * 4 / 3);
  else sh = Math.round(sw * 3 / 4);
  const c = document.createElement('canvas');
  c.width = Math.min(ancho, sw);
  c.height = Math.round(c.width * 3 / 4);
  c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', calidad));
  if (!blob) throw new Error('formato de imagen no soportado');
  return blob;
}

// createImageBitmap con orientación no anda en todos los Safari: si falla, se usa un <img>
// (los navegadores ya lo giran según la foto).
async function decodificar(archivo) {
  try {
    return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(archivo);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function borrarArchivos(rutas) {
  if (!rutas.length) return;
  await sb.storage.from(BUCKET).remove(rutas.flatMap((r) => [r, r.replace(/\.jpg$/, '_m.jpg')]));
}
