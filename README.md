# Ropero

App web (mobile-first) para vender ropa usada: sacas una foto, pones el precio,
la IA mejora la foto y escribe una descripción corta. La gente navega el catálogo desde el celular y reserva con
un botón que abre WhatsApp directo contigo — el trato final lo cierras por
fuera de la app.

- **`index.html`** — catálogo público (lo que ve la gente).
- **`admin.html`** — panel privado para subir/gestionar prendas.
- **`supabase/`** — esquema de base de datos y la función que llama a Gemini.
- **`SETUP.md`** — estado del despliegue y lo poco que falta. **Empieza por ahí.**

Stack: HTML/CSS/JS sin build step, Supabase (base de datos + auth + storage +
edge functions, mismo proyecto que Launch Control en un schema separado
`ropero`), auto-corrección de imagen local (gratis) para las fotos y
Gemini (texto, gratis) para la descripción — mismo patrón que Launch
Control y Fambase.
