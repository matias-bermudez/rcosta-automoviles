# R.Costa Automóviles — web

Sitio de R.Costa Automóviles (Ciudad de la Costa, Canelones): catálogo, ficha de cada auto y formulario para vender, permutar o dejar el auto en consignación, todo coordinado por WhatsApp. El dueño carga los autos desde un panel (`/admin/`).

**Web:** https://matias-bermudez.github.io/rcosta-automoviles/

## Cómo funciona

- La web es estática. `scripts/generar.js` (Node, sin dependencias) arma todas las páginas, una por auto, con SEO.
- Los autos, las fotos y los datos del negocio viven en Supabase. La web no lo consulta en vivo: GitHub Actions regenera y publica en cada push, cada vez que se guarda algo en el panel y, como respaldo, cada 15 minutos si hubo cambios.

## Probar en local

```sh
node scripts/generar.js --local --ejemplos   # con los autos de ejemplo de js/autos.js
python3 -m http.server 8831 -d _site          # → http://localhost:8831
```
