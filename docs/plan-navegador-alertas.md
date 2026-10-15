# Plan: un segundo navegador sencillo con alertas tipo Waze para el Tesla

Fecha: 15 de octubre de 2026. Uso: personal, un solo coche, no comercial, educativo.

## 1. Qué quieres (y qué NO)

Un segundo navegador que corra en el navegador del Tesla, **sencillo como el de Tesla**, cuyo único objetivo es **estar atento**: avisar de policía, obras, radares, accidentes y peligros que hay delante, al estilo de las notificaciones de Waze. No hace falta planificar rutas ni navegación paso a paso; con ver tu posición en el mapa y que te avise de lo que viene, basta.

## 2. ¿Es viable? Sí, y ya funciona

El propio teslanav.com relanzado (julio 2026) hace exactamente esto hoy en España y Portugal. Lo verifiqué en vivo: su `/api/waze` devolvió atascos, peligros, cortes y **policía** en Madrid y Lisboa. La base de código de ese relanzamiento es la rama sobre la que ya estamos trabajando. Así que no partimos de cero: partimos de algo que ya hace el 80% de lo que pides.

## 3. El único problema real: de dónde salen los avisos de POLICÍA

No es un problema técnico, es de datos. Esto es lo que hay, verificado hoy:

| Fuente | Policía | Obras | Accidentes | Atascos | Radares | ¿Legal? | ¿Estable? |
|---|---|---|---|---|---|---|---|
| **DGT incidencias (oficial, DATEX II)** | ❌ No | ✅ | ✅ | ✅ | — | ✅ Sí (CC-BY) | ✅ Muy estable |
| **DGT / OSM radares** | — | — | — | — | ✅ | ✅ Sí | ✅ Estable |
| **Capa "estilo Waze"** (protocolo no oficial, ya incluido en el código del relanzamiento) | ✅ **Sí** | ✅ | ✅ | ✅ | parcial | ❌ Va contra los términos de Waze | ⚠️ Frágil, puede cortarse sin aviso |
| **Reportes de tus propios usuarios** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Sí | con 1 usuario = mapa vacío |

**La verdad incómoda:** lo que más te importa, el aviso de policía, **solo** llega por la capa no oficial de Waze. Ninguna fuente legal lo da. Waze lleva todo 2026 cerrando sus canales no oficiales (en marzo rompió el que mató a la versión original). La capa que trae el relanzamiento usa otra vía (imita la app móvil de Waze, no el mapa web), por eso sigue viva hoy, pero es igual de frágil y va contra los términos de Waze.

## 4. La decisión que es tuya

Hay dos niveles, y tú eliges hasta dónde llegar:

- **Núcleo legal y estable (recomendado como base):** mapa + tu posición + radares de España/Portugal + incidencias oficiales de la DGT (obras, accidentes, cortes, atascos) + avisos de voz. Esto es 100% legal, no depende de nadie que te pueda cortar, no necesita cuentas, y funciona el primer día. Lo que NO tiene: policía.
- **Capa "estilo Waze" opcional (tu riesgo):** activar la capa de alertas no oficial que **ya viene** en el código del relanzamiento, que añade policía y cobertura más rica. Para uso personal y educativo es una decisión tuya. Dos cosas que debes saber: (1) va contra los términos de uso de Waze, y (2) puede dejar de funcionar cualquier día si Waze cambia algo.

**Mi línea, para que la tengas clara:** monto el núcleo legal entero y, como esa capa ya existe en el código, te dejo el interruptor para encenderla y te explico el riesgo. Lo que no voy a hacer es construir ni "blindar" mecanismos para saltarme las protecciones anti-robot de Waze (el sidecar con navegador automatizado y proxies residenciales que hay en otro fork, o pelearme con su reCAPTCHA cuando bloqueen). Si Waze cierra la vía, se cierra; no entro en esa carrera.

## 5. Qué hace la comunidad (resumen de la investigación)

- **teslanav.com relanzado** (Ryan Vogel): la base que usamos. MapLibre + OpenFreeMap + SQLite + Docker, reportes propios, y la capa Waze no oficial. Código en la rama `feature/billboards` del fork `jtmaveryk/teslanav`.
- **codriver.io**: lo más pulido, pero cerrado y de pago (6 USD/mes). App registrada en la Fleet API de Tesla; lee la ruta del coche; alertas comunitarias + OSM + una capa atribuida a Waze. No reutilizable.
- **TeslaWaze**: muerto desde el corte de Waze.
- **Forks de teslanav**: 29 revisados; solo "Radar" (ShayalaW) y el sidecar de VMan228 añaden algo, y el de VMan228 es justamente la evasión que no voy a replicar.
- **Lo que pide la gente** (foros TMC, reseñas): exactamente lo tuyo, avisos de policía en pantalla sin teléfono. Nadie lo ha resuelto de forma legal y estable; todos dependen de Waze de una u otra forma.

## 6. Arquitectura

Partimos de la base del relanzamiento (ya construida y probada):

- **Frontend:** Next.js 16 + MapLibre GL + OpenFreeMap (mapa gratis, sin API key). UI mínima tipo Tesla: mapa a pantalla, tu coche, y tarjetas de aviso grandes cuando algo se acerca. Pensado para tocar poco y leerse de un vistazo.
- **Datos (capas conmutables en Ajustes):**
  - Radares: SQLite, importados de DGT + OSM + Francia (ya hecho).
  - Incidencias oficiales: nueva ruta `/api/incidencias` que lee el DATEX II de la DGT (obras, accidentes, cortes, atascos), cacheada.
  - Capa Waze opcional: la que ya existe, con un interruptor claro y una advertencia.
  - Reportes propios: ya existen; útiles si algún día lo usan más personas.
- **Avisos:** voz en español/portugués (ya hecho) + tarjeta visual, por distancia y sentido de la marcha (ya hecho para radares y policía).
- **Backend:** un solo contenedor (o Vercel) con Redis en memoria y SQLite. Sin servicios de pago.

## 7. Plan por fases

### Fase 1 — Núcleo legal y usable (sin cuentas, desplegable ya)
1. Partir de la rama `feat/relanzamiento-es-pt` (ya trae mapa, radares ES/PT, voz, detección del navegador 2026.26 arreglada).
2. Añadir `/api/incidencias`: leer el DATEX II de la DGT (y el RSS de Cataluña), normalizar a obras/accidente/corte/atasco/peligro, cachear, y pintarlas como capa de alertas con sus iconos.
3. Avisos de proximidad para incidencias (reusar la lógica de radares: solo lo que está delante).
4. Simplificar la UI al mínimo "segundo navegador": quitar lo que no uses, dejar mapa + avisos + un botón de ajustes.
5. Localización completa ES/PT y unidades métricas.
6. Validar (typecheck, build) y probar en el navegador con el viewport del Tesla.

**Resultado:** app legal, estable, con obras/accidentes/cortes/atascos/radares y voz. Sin policía.

### Fase 2 — Capa "estilo Waze" opcional (tu decisión de riesgo)
1. Dejar la capa de alertas no oficial del relanzamiento detrás de un interruptor en Ajustes, apagado por defecto, con un aviso claro de qué es y que puede dejar de funcionar.
2. Si la enciendes, añade policía y cobertura más rica. Si Waze la corta, la app sigue funcionando con la Fase 1.
3. (No incluye blindar la vía contra bloqueos.)

### Fase 3 — Opcional: un toque de navegación (Fleet API)
Si más adelante quieres algo de navegación: buscar un sitio y mandarlo a la navegación nativa del Tesla con la Fleet API (gratis para un coche). Requiere tu dominio y cuenta de desarrollador. No es necesario para el objetivo de "estar atento".

### Fase 4 — Despliegue y uso en el coche
1. Desplegar: Vercel (lo más simple) o Docker en un VPS pequeño (Hetzner ~5-16 €/mes) si quieres la capa Waze siempre activa.
2. PWA / "Añadir a favoritos" en el navegador del Tesla.
3. Pruebas reales: Conectividad Premium o hotspot del móvil; comprobar GPS, voz (con un toque inicial), y que no salte el aviso de "móvil".

## 8. Qué necesito de ti

- Para la Fase 1 y 2: nada, puedo hacerlo entero.
- Para la Fase 3 (si la quieres): dominio propio + cuenta de desarrollador de Tesla.
- Para la Fase 4: dónde quieres desplegar (Vercel o un VPS) y si usarás Premium o hotspot.

## 9. Riesgos y realidad

- **Policía depende de Waze** (no oficial, frágil). Es el núcleo de lo que quieres y es lo menos estable. Hay que asumirlo.
- **Tesla ya avisa de radares fijos** (con Premium y ruta activa): nuestra ventaja es que avisamos sin ruta, con obras/accidentes/policía, y de un vistazo.
- **Cambios de firmware** del navegador del Tesla pueden romper cosas (como pasó en 2026.26); hay que probar tras cada actualización.
- **Portugal**: radares por OSM; incidencias oficiales de la DGT solo cubren España (para Portugal habría que ver el acceso al punto nacional portugués, pendiente).
