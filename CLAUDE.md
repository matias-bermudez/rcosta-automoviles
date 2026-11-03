# R.Costa Automóviles — web

Web de **R.Costa Automóviles** (compra, venta, permuta y consignación; Ciudad de la Costa, Canelones). Hasta el lanzamiento queda con `indexar: false` (noindex).

- Repo: https://github.com/matias-bermudez/rcosta-automoviles (público: GitHub Pages en plan free no publica repos privados)
- Web: https://matias-bermudez.github.io/rcosta-automoviles/
- Seguimiento: issues del repo. Los commits cierran issues con `Closes #N`.
- Plataforma Automotoras: `~/Proyectos/plataforma-automotoras` (reglas comunes y esquema de la base). Referencia: DN (`~/Proyectos/DNAutos`).

## Stack

Sitio estático generado por `scripts/generar.js` (Node 18+, sin dependencias) → `_site/` (no se commitea).
GitHub Actions (`.github/workflows/publicar.yml`) lo publica en Pages en cada push a `main`, cuando Supabase avisa que se guardó un auto
(`workflow_dispatch`) y cada 15 min como respaldo (solo si cambió algo: compara un hash con `estado.json` de la web publicada).

Base: Supabase compartido, `concesionaria: 'rcosta'`. La web nunca lo lee en vivo: el generador baja autos, datos del negocio y fotos.
Los datos del negocio (tabla `negocios`, pantalla "Datos del negocio" del panel) pisan a `js/config.js` al publicar.
Fotos: el panel las recorta a 4:3 y sube `rcosta/<uuid>.jpg` (1600 px) y `rcosta/<uuid>_m.jpg` (640 px).

Probar en local (el resto de los puertos los usan otros proyectos):
`node scripts/generar.js --local --ejemplos && python3 -m http.server 8831 -d _site` → http://localhost:8831
(sin `--ejemplos` usa los autos reales de Supabase).

| Archivo | Qué es |
|---|---|
| `js/config.js` | WhatsApp, teléfonos, dirección, horarios, redes, textos de consignación y financiación, `sitio`, `indexar` |
| `js/autos.js` | Autos de ejemplo para probar en local (al publicar se reescribe con los de Supabase) |
| `src/*.html` | Plantillas: `{{ dato }}` y `{{> parcial }}` (parciales en `src/_partials/`) |
| `scripts/generar.js` | Arma cada página, una por auto en `/autos/<slug>/`, JSON-LD, sitemap.xml y robots.txt |
| `js/common.js` | Helpers compartidos entre navegador y generador (tarjeta del auto, precios, mensajes de WhatsApp) |
| `js/catalogo.js`, `ficha.js`, `vende.js` | Filtros del catálogo (en la URL), galería, formulario de venta/permuta/consignación |
| `src/admin.html`, `js/admin.js` | Panel del dueño: autos, fotos ("Sacar foto" en el celular), "Datos del negocio" |
| `css/styles.css`, `fonts/` | Estilos del diseño (tokens en `:root`) y fuentes alojadas (Cormorant Garamond + IBM Plex, OFL) |
| `diseno/` | Diseño original (Claude Design). `python3 -I diseno/desempaquetar.py "diseno/R.Costa Automóviles — Web.html" diseno` lo desempaqueta en `sitio.html` y `paginas/` |

URLs: `/`, `/autos/` (filtros `?tipo=&comb=&caja=&max=&orden=`), `/autos/<slug>/`, `/vende-tu-auto/` (`?modo=vender|permutar|consignar&auto=<slug>`,
`#consignacion` es la sección de consignación), `/donde-estamos/`, `404.html`, `/admin/`.

## Datos del auto que van en `extra`

`version` (la columna `modelo` guarda modelo + versión), `numero` (n.º de exhibición, lo asigna el panel), `sin_km`, `service`,
`ubicacion` ("Dónde se ve"), `sede` (si hay otros locales), `financiable`, `vendido_el`.
En `negocios.extra`: `telLlamadas`, `telOtro`, `localidad`, `departamento`, `mapa`, `horarios` (por día), `mercadolibre`, `sedes` (otros locales).

## Verificación visual

Playwright de otro proyecto: `require('/Users/matibermudez/Proyectos/TapStore-listas/node_modules/playwright')`,
`devices['iPhone 13']` para celular y 1440 px para escritorio. Chromium no emula `pointer: coarse`: "Sacar foto" se prueba en un celular real.

## Registro

- 2026-11-02: proyecto creado a partir del diseño, con la arquitectura de DN. Inicio, catálogo, ficha, vendé/permutá/consigná, dónde estamos, 404 y panel. Publicado con Actions.
