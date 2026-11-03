// Autos de EJEMPLO para probar en local (node scripts/generar.js --local --ejemplos).
// La web publicada usa los autos que el dueño carga en el panel (Supabase) y reescribe este archivo.
//
// id          único, va en la URL (/autos/<id>/). Minúsculas y guiones: marca-modelo-año.
// numero      n.º de exhibición (lo asigna el panel al cargar el auto)
// carroceria  'SUV' | 'Pick-up' | 'Coupé' | 'Hatchback' | 'Sedán' | …  (filtro "Tipo" del catálogo)
// anio, km    anio: null = "Año a consultar"; sinKm: true = "Km a consultar"
// precio      entero, sin puntos. null = "Consultar". moneda: 'USD' | 'UYU'
// fotos       rutas a las fotos (4:3), la primera es la portada
window.RC_AUTOS = [
  {
    id: 'mercedes-benz-gle-coupe-2019', numero: 5,
    marca: 'Mercedes-Benz', modelo: 'GLE Coupé', version: 'AMG 43 4MATIC', anio: 2019, km: 58000,
    carroceria: 'Coupé', tipo: 'auto', combustible: 'Nafta', transmision: 'Automática', marchas: 9,
    motor: '3.0 V6 biturbo', traccion: 'AWD', color: 'Negro', puertas: 5, duenos: 2, service: 'Al día',
    precio: 74000, moneda: 'USD', destacado: true, reservado: false, ingreso: '2026-10-30',
    aceptaPermuta: true, financiable: false,
    equipamiento: ['Tapizado de cuero', 'Techo solar', 'Cámara 360°', 'Sensores delanteros y traseros', 'Faros full LED', 'Arranque sin llave'],
    descripcion: 'Muy cuidada, siempre en garaje. Services al día. Se entrega con las dos llaves y el manual.',
    fotos: ['img/autos/mercedes-benz-gle-coupe-2019/1.jpg']
  },
  {
    id: 'ford-ranger-raptor-2024', numero: 1,
    marca: 'Ford', modelo: 'Ranger Raptor', version: '3.0 V6 biturbo', anio: 2024, km: 12000,
    carroceria: 'Pick-up', tipo: 'camioneta', combustible: 'Nafta', transmision: 'Automática', marchas: 10,
    motor: '3.0 V6 biturbo', traccion: '4x4', color: 'Gris oscuro', puertas: 4, duenos: 1,
    precio: 79900, moneda: 'USD', destacado: true, reservado: true, ingreso: '2026-10-20',
    aceptaPermuta: true, financiable: false,
    equipamiento: ['Suspensión FOX', 'Climatizador bizona', 'Apple CarPlay / Android Auto', '7 airbags'],
    descripcion: '',
    fotos: []
  },
  {
    id: 'toyota-corolla-cross', numero: 2,
    marca: 'Toyota', modelo: 'Corolla Cross', version: 'XEI Hybrid', anio: null, km: 0, sinKm: true,
    carroceria: 'SUV', tipo: 'auto', combustible: 'Híbrido', transmision: 'Automática',
    precio: null, moneda: 'USD', destacado: false, reservado: false, ingreso: '2026-10-25',
    aceptaPermuta: true, financiable: false, ubicacion: 'Solymar, Canelones',
    equipamiento: [],
    descripcion: '',
    fotos: []
  }
];
