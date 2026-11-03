// Datos del negocio. Los campos vacíos no se muestran en la web.
// Después de cambiar algo hay que publicar (push a main): el sitio se regenera solo.
//
// Lo que el dueño carga en el panel (Datos del negocio → tabla `negocios` de Supabase) pisa a estos
// valores al publicar: WhatsApp, teléfonos, dirección, horarios, redes y otros locales.
//
// whatsapp: número de prueba de Matías (091 969 322). Se cambia desde el panel al lanzar.
window.RC_CONFIG = {
  whatsapp: '59891969322',      // código de país + número, sin 0 ni espacios
  whatsappLabel: '091 969 322',
  telLlamadas: '',              // vacío = el mismo del WhatsApp
  telOtro: '',
  direccion: '',                // calle y número
  localidad: 'Ciudad de la Costa',
  departamento: 'Canelones',
  mapa: '',                     // enlace de Google Maps (vacío = se busca la dirección)
  horario: '',                  // resumen, ej: 'Lunes a viernes 9:00 a 18:00 · Sábados 9:00 a 13:00'
  horarios: [],                 // por día, lo carga el panel: [{ dia: 'Lunes', abierto: true, desde: '09:00', hasta: '18:00' }, …]
  instagram: 'rcostaautomoviles',
  seguidores: '51,1 mil',       // seguidores de Instagram, como se muestra (vacío = no se muestra)
  facebook: '',
  tiktok: '',
  mercadolibre: '',
  dolar: 40,                    // pesos por dólar, aproximado: solo para ordenar y filtrar autos en pesos

  // Otros locales además del principal: [{ nombre: 'Solymar', direccion: '…', horario: '…' }].
  // Se cargan desde el panel; con alguno, el catálogo filtra por local y cada auto elige el suyo.
  sedes: [],

  // Textos a completar cuando R.Costa los confirme. Vacíos = no se muestran.
  financiacion: '',             // ej: 'Financiamos hasta el 50 % en 24 cuotas con …'
  consignacion: {
    comision: '',               // % o monto fijo
    plazo: '',                  // plazo mínimo
    dondeQueda: '',             // en la automotora o con el dueño
    papeles: ''                 // qué trámites gestionan
  },
  soporte: '',                  // a quién escribir si el dueño se olvida la contraseña del panel

  // Supabase: base compartida de la Plataforma Automotoras. `concesionaria` = id de esta automotora.
  // La clave es la pública (publishable): puede ir en el código, los permisos los pone la base.
  supabaseUrl: 'https://dfunhdfvtmsmjdzpnhas.supabase.co',
  supabaseKey: 'sb_publishable_4Q-GxNAtPB894PRurMLwkQ_2NRVIjWg',
  concesionaria: 'rcosta',

  // URL pública del sitio, con / al final. Si se compra dominio, cambiarla acá.
  sitio: 'https://matias-bermudez.github.io/rcosta-automoviles/',

  // false = Google no indexa la web (meta noindex). Pasar a true recién al lanzar.
  indexar: false
};
