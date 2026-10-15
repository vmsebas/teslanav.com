# TeslaNav: qué hace la comunidad, qué permite la API de Tesla y qué podemos construir

Fecha del análisis: 15 de octubre de 2026. Repositorio analizado: `vmsebas/teslanav.com` (fork de `R44VC0RP/teslanav.com`).

> Las secciones marcadas con **[pendiente]** se completan con la investigación todavía en curso.

---

## 0. Resumen ejecutivo

1. **Tu fork es la versión "muerta".** Es idéntico, commit a commit, al `main` público de Ryan Vogel, que se congeló el 21-mar-2026 con el modo *shutdown* activado por defecto. Tal cual, no arranca la app ni funcionan las alertas.
2. **Por qué murió:** las alertas salían de un endpoint no documentado de Waze (`/live-map/api/georss`). Desde marzo de 2026 el propio frontend de Waze adjunta una cabecera `X-Recaptcha-Token` (reCAPTCHA Enterprise) a cada llamada; sin ese token el endpoint devuelve `403`. Lo he comprobado hoy. Además, Mapbox costaba ~1.500 USD/mes con ~20.000 usuarios.
3. **Alguien sí encontró la forma: tres caminos distintos.**
   - Ryan relanzó teslanav.com en julio de 2026 con una **reescritura cerrada**: MapLibre + tiles gratuitos de OpenFreeMap + satélite de ArcGIS + **reportes propios de usuarios** (`/api/reports`). Coste de mapas ≈ 0. No usa la API de Tesla.
   - **codriver.io** (empresa de Québec) es una **app oficial de la Tesla Fleet API** (publica su clave en `/.well-known/appspecific/com.tesla.3p.public-key.pem`), usa **Fleet Telemetry** para leer la ruta activa del coche ("Car route", Premium), reportes comunitarios, radares de **OpenStreetMap**, y una capa de incidentes **atribuida a Waze** que sigue viva hoy. Mapa base propio con Protomaps.
   - El fork **ShayalaW/teslanav.com ("Radar")** añadió reportes comunitarios con 15 tipos, navegación guiada por voz, límite de velocidad y wake lock (37 commits, sep-2026), pero sigue atado a Mapbox y al endpoint muerto de Waze.
4. **La API de Tesla permite las dos cosas que preguntas.** Leer posición/ruta (vehicle_data o Fleet Telemetry) y **enviar un destino a la navegación nativa** (`navigation_gps_request`, `navigation_request`, `navigation_waypoints_request`). codriver solo lee por decisión propia; enviar destinos es técnicamente posible y oficial.
5. **El propio Ryan ya escribió la integración con la Fleet API** y está en el PR #10 del repo público (ago-2026, sin fusionar): OAuth de Tesla, emparejamiento de *virtual key* por QR desde la pantalla del coche, proxy `vehicle-command`, receptor de Fleet Telemetry con la ruta del coche, y una guía de 370 líneas. Es reutilizable.
6. **Coste de la API de Tesla:** para un coche propio es gratis en la práctica (crédito de 10 €/mes por cuenta; un envío de destino cuesta 0,001 $). Para 20.000 usuarios, entre ~600 $/mes (solo enviar destinos) y ~1.100-3.000 $/mes (con telemetría de ruta). Despertar coches dormidos (0,02 $) y el *polling* de `vehicle_data` son lo que arruina el presupuesto.
7. **Radares:** hay datos oficiales (DGT: dataset DATEX II CC-BY de radares fijos + PDF de puntos y tramos actualizado el 03-ago-2026; ANSR Portugal: 123 locales SINCRO en PDF) y OSM tiene cobertura decente en Lisboa/Madrid. Avisar de radares con una app es legal en España y Portugal; detectores e inhibidores no.
8. **Lo que no hay que hacer:** saltarse el reCAPTCHA de Waze (viola sus términos, es frágil y te expone legalmente), hacer *polling* de `vehicle_data`, o volver a Mapbox para tiles.
9. **Recomendación:** revivir el fork en tres fases: (A) mapa gratuito + radares oficiales/OSM + reportes propios; (B) conexión con la Fleet API para enviar destinos al navegador del coche y, opcionalmente, pintar la ruta nativa del Tesla; (C) si se quiere abrir al público, modelo legal/GDPR y de pago. Detalle en la sección 8.

---

## 1. Qué tienes exactamente en el repositorio

| Aspecto | Estado |
|---|---|
| Relación con upstream | `vmsebas/main` = `R44VC0RP/main` (0 commits de diferencia). Último commit: 21-mar-2026. |
| Modo shutdown | `lib/shutdown.ts` devuelve `true` si `NEXT_PUBLIC_PROJECT_SHUTDOWN` no está definido. `proxy.ts` responde 503 en `/api/*` y redirige todo a `/`. Para arrancar hay que poner `NEXT_PUBLIC_PROJECT_SHUTDOWN=false` (el PR #9 de un usuario simplemente invierte el valor por defecto). |
| Mapa | `mapbox-gl` v3 con estilos `mapbox://styles/mapbox/{dark,light,satellite-streets}-v12`, tráfico `mapbox-traffic-v1`, terreno `mapbox-terrain-dem-v1`, edificios 3D. Proxy de tiles en `/api/tiles` con caché en Vercel Blob. Service worker que cachea tiles 7 días. |
| Rutas | Mapbox Directions `driving-traffic` con alternativas (`/api/directions`). Reruteo si te alejas más de un umbral de la ruta. |
| Búsqueda | LocationIQ (`/api/geocode`, `/api/geocode/reverse`). |
| Alertas | `/api/waze` → `https://www.waze.com/live-map/api/georss` (muerto). Caché Redis 60 s, rate limit global 60 req/min. Aviso sonoro "POLICE AHEAD" por distancia y rumbo. |
| Radares | `/api/speedcameras` → Overpass público (`highway=speed_camera`, `enforcement=maxspeed|average_speed`, semáforos con `red_light_camera`). Caché 1 h, 10 req/min. |
| GPS | `navigator.geolocation.watchPosition` del navegador del Tesla; rumbo calculado por desplazamiento cuando el GPS no lo da. Detección del coche por `userAgent` que contiene `tesla` o `qtcarbrowser`. |
| Otros | Grabación/reproducción GPX en Vercel Blob, PostHog, panel `/admin` de consumo de APIs. |
| Licencia | PolyForm Noncommercial 1.0.0: uso personal y no comercial. Vender el servicio o competir con él no está permitido con este código. |

Dependencias de pago o con límite: Mapbox (loads, tiles, directions), LocationIQ (5.000/día gratis), Upstash, Vercel Blob. Servicios gratuitos pero frágiles: Overpass público.

---

## 2. Por qué cerró y qué está roto hoy (verificado el 15-oct-2026)

- **Waze.** Petición directa a `georss` con el User-Agent del proyecto y con un User-Agent de Chrome + Referer: `403 Forbidden` en ambos casos. El bundle actual del live-map (`livemap-614ec638…js`) sigue llamando a `/live-map/api/georss` con `top/bottom/left/right/env/types`, pero un interceptor de Axios espera a `grecaptcha.enterprise`, ejecuta la acción `api` y añade `X-Recaptcha-Token` a toda llamada bajo `/live-map/api/`. Es decir: el endpoint existe, pero está protegido con reCAPTCHA Enterprise. Cualquier fork del repo sin cambios tiene las alertas muertas.
- **Mapbox.** Ryan publicó en X (21-mar-2026) que sin Waze no podía justificar 1.500 USD/mes de Mapbox, y en su blog (ryan.ceo, 09-ago-2026) que el relanzamiento "no depende de servicios externos" sin revelar la arquitectura.
- **Overpass público.** Funciona, pero es un servicio comunitario con límites estrictos; no es base para producción.

---

## 3. Qué está haciendo la comunidad

### 3.1 Ryan Vogel (autor original)

**teslanav.com relanzado (23-jul-2026).** Inspección del HTML y los bundles públicos:

- Librería de mapas: **MapLibre GL** (149 referencias en el bundle), no mapbox-gl.
- Tiles: **OpenFreeMap** (`tiles.openfreemap.org/styles/{liberty,positron,dark,bright,fiord}`) y satélite de **ArcGIS World Imagery**. Coste: 0.
- Endpoints propios: `/api/reports`, `/api/reports/vote`, `/api/suggestions`, `/api/feedback`, `/api/analytics`. Las alertas son **pines creados por los usuarios** con votos; la página de comparación de codriver lo describe igual ("alerts come from user-added pins").
- No hay clave pública de Tesla en `teslanav.com/.well-known/appspecific/...` (404): el relanzamiento **no usa la API de Tesla**.
- Donaciones por Stripe. Título SEO sigue diciendo "Waze Alerts for Tesla".
- **Ese código nuevo no está publicado.** El repo público sigue en el commit del cierre.

**PRs abiertos en el repo público (no fusionados):**

- **#10 "Add persistent Tesla account linking and route subscriptions" (17-18 ago 2026, 49 ficheros, +3.943 líneas).** Integración completa con la Fleet API: OAuth de Tesla con scopes `openid offline_access user_data vehicle_device_data vehicle_location`; emparejamiento de *virtual key* con QR desde el coche (`https://tesla.com/_ak/teslanav.com?vin=VIN`); `docker-compose` con el proxy oficial `vehicle-command`; receptor oficial **Fleet Telemetry** (mTLS en el puerto 443 de una EC2) suscrito a `RouteLine`, `DestinationName`, `DestinationLocation`, `MilesToArrival`, `MinutesToArrival`, `RouteTrafficMinutesDelay`; forwarder a Redis; hook `useTeslaRoute` que pinta la ruta nativa del coche en el mapa; auth con Better Auth y cobro con Autumn (pensaba vender la sincronización de ruta como suscripción, igual que codriver). Incluye `docs/tesla-fleet-api-setup.md`. **No envía destinos al coche** (solo lee la ruta), pero toda la infraestructura de claves y proxy que hace falta para enviarlos está ahí.
- **#11 "Add Waze-style current speed and speed limit display" (21-ago-2026).** Velocidad actual y límite de velocidad por carretera cercana, con `maxspeed` de OSM.
- **#9** (usuario `hearhour`, mar-2026): solo invierte el flag de shutdown.

### 3.2 Forks

7 forks visibles, todos con 0 estrellas. Seis son copias sin cambios. El único con trabajo real:

- **ShayalaW/teslanav.com → "Radar"** (radar-tesla.vercel.app), 37 commits entre el 10 y el 18 de septiembre de 2026, 59 ficheros: reportes comunitarios con 15 tipos (`police_hidden`, `police_visible`, `police_pulled_over`, `traffic_*`, `hazard_*`, `accident`, `road_closed`) con confirmaciones, descartes y token de borrado; navegación guiada con banner de maniobra, voz y reruteo; límite de velocidad por *map matching* de Mapbox; avisos de cortes "road ahead"; avisos de voz y de radares; wake lock; auto-zoom; soporte móvil; feedback por Web3Forms. Sigue usando Mapbox (Directions, Search Box, Matching, tilequery) y mantiene la ruta `/api/waze` apuntando al endpoint muerto.

### 3.3 codriver.io (el competidor que sí lo ha resuelto)

Empresa: 9570-6198 Québec inc. (Montréal). Datos alojados en Hetzner (Helsinki). Precios: gratis / Premium 6 $/mes o 36 $/año.

Arquitectura observada (web pública, API pública, términos y changelog):

- **App Fleet API registrada**: `codriver.io/.well-known/appspecific/com.tesla.3p.public-key.pem` devuelve una clave P-256. "Car route" (Premium) usa **Fleet Telemetry con virtual key**: el coche envía la ruta planificada, destino y odómetro; codriver declara que **no pide la posición en vivo** (la saca del GPS del navegador) y que **no envía comandos** (no puede fijar destino, despertar ni controlar el coche). Explican que la clave y el stream "tienen coste directo", por eso es de pago. Tesla permite un máximo de 5 apps leyendo datos de un coche a la vez.
- **Datos** (`GET https://app.codriver.io/v2/sources`, público):
  - `codriver-events`: reportes de sus usuarios.
  - `community-incidents`, atribución **"Waze"**, capa `incidents-bootstrap`: atascos, cierres con polilínea, policía, accidentes, baches, con campos `reliability`, `thumbs_up`, `report_rating`, subtipos `JAM_HEAVY_TRAFFIC`, `HAZARD_ON_ROAD_POT_HOLE`… (esquema del georss de Waze). Hoy, 25 km alrededor de Lisboa: 200 entidades Waze vistas por última vez hace minutos. Sus términos dicen "relayed from Waze and its community reports". No sabemos por qué vía lo obtienen ni con qué licencia; es su riesgo, no una vía que puedas copiar.
  - `community-cameras`, atribución **OpenStreetMap**: 110 radares en 25 km de Lisboa (refs tipo `PT_FIXO 70`), 145 en 25 km de Madrid.
  - `community-alpr`: lectores de matrículas de OSM + DeFlock.
  - `chargers`: Open Charge Map + OSM.
- **Mapa**: tiles propios con **Protomaps** desde OSM (desde el 20-sep-2026; antes Mapbox), renderer propio "Peregrine" para que el 3D vaya a 25-35 fps en un Model 3 de 2019; Mapbox solo para *directions* y *map matching*.
- **API para terceros**: lectura `GET /v2/entities/nearby` (60 req/min sin cuenta, 120 con cuenta; sin CORS, solo servidor) **para uso personal y no comercial**; reutilización masiva o comercial requiere acuerdo. También *feeds* de escritura (push/pull) para aportar datos.
- **Navegador del Tesla**: el software 2026.26 trae Chromium 148 y cambió la densidad de píxeles (rompió el tamaño de muchas webapps); 2026.20 permite bloquear el navegador con controles parentales; desde 2026.26 el navegador puede pedir cámara/micrófono aparcado en coches Ryzen. Compatibilidad declarada: MCU2 (Intel Atom) y MCU3 (Ryzen).

#### Lecciones técnicas del cliente público de codriver (código JS servido a cualquier navegador, sin cuenta)

- **No usa bundler**: ficheros separados (`app.js`, `nav-lib.js`, `pair.js`, `tesla-sync.js`, `telemetry.js`, `persistent-connection.js`, `peregrine.js` de 3,4 MB con three.js). Útil para depurar en el coche.
- **GPS**: `navigator.geolocation.watchPosition(..., { enableHighAccuracy, maximumAge: 1000 })`, con un "medidor" de fixes para detectar GPS congelado. Confirma que el GPS del navegador del Tesla es la fuente de posición (no la API de Tesla).
- **Densidad de píxeles**: comentarios en el código indican que 2026.26 pasó `devicePixelRatio` de 1,0 a 1,53 y que añadieron un *shim* para que la geometría del mapa no cambie. Cualquier app para el Tesla debe tratar el DPR como variable.
- **Voz**: el código contiene llamadas a `speechSynthesis`, pero su changelog aclara que en el coche está desactivada porque **el navegador del Tesla no tiene voces instaladas**; los avisos de giro y alertas son **clips de audio pregrabados**. No usan Wake Lock API (no aparece en el código).
- **Emparejamiento con Tesla desde el coche**: `/api/pair/start` genera un QR que el móvil abre; el coche hace *polling* de `pollUrl` y canjea con `/api/pair/exchange`. La sesión del coche queda ligada a la cuenta sin teclear nada en la pantalla. Es el mismo patrón que `ConnectFlow` del PR #10 de upstream.
- **Datos del coche**: `/api/tesla/destination` (recoger el destino fijado en el navegador del Tesla, flag `teslaDestHandoff`), `/api/tesla/telemetry/state`, `/v2/car-route` y `/v2/car-route/eta` (ruta nativa vía Fleet Telemetry), `/api/garage/vehicles`.
- **Capas y servicios propios**: `/v2/entities/nearby`, `/v2/observations` (confirmaciones), `/v2/speed-limits/nearby` y `/v2/speed-limit-reports` (límites de velocidad con corrección comunitaria), `/v2/closure-candidates` y `/v2/closure-span` (cortes), `/v2/route/price` (peajes). Config pública: tiles Protomaps en `tiles.codriver.io`, terreno en WebP (zoom máx. 12), capa de árboles, fuentes propias, `trafficRelay: true`, `mapMatch: true`. Sigue existiendo un token público de Mapbox en la configuración para *directions* y *map matching*.
- **Rendimiento**: `view-modes.js` distingue MCU2 para degradar el modo 3D; el renderer "Peregrine" (three.js, GLTF, WebGL) sustituye a MapLibre en 3D.

### 3.4 Qué pide la gente

- Avisos de policía son la función más demandada (es lo que hacía TeslaWaze y TeslaNav); TeslaWaze murió con el corte de Waze y no volvió.
- Que funcione **mientras se conduce**, sin teclear, con voz. codriver vende precisamente eso.
- Mantenimiento: el cambio de densidad de píxeles de 2026.26 dejó rotas las webapps abandonadas; una app para el Tesla exige seguir las actualizaciones de firmware.
- **[pendiente]** Resumen de hilos de Reddit/TMC y comunidades en español/portugués.

---

## 4. La API de Tesla: qué permite y qué cuesta

### 4.1 Leer datos del coche

- `GET /api/1/vehicles/{vin}/vehicle_data` (posición en `drive_state`, requiere scope `vehicle_location`). Se factura por petición y Tesla dice literalmente que no debe hacerse *polling* regular.
- **Fleet Telemetry** (streaming del coche a tu servidor con mTLS): señales `Location`, `VehicleSpeed`, `GpsHeading`, `Gear`, `Odometer`, y de ruta activa `OriginLocation`, `DestinationLocation`, `DestinationName`, `RouteLine` (polilínea precisión 6), `MilesToArrival`, `MinutesToArrival`, `RouteTrafficMinutesDelay`, `ExpectedEnergyPercentAtTripArrival`. Requisitos: firmware 2024.26+ (Model S/X Intel 2025.20+), *virtual key* emparejada, servidor con certificado válido en el puerto 443, máximo 5 apps por coche (`max_configs`).
- Para una web que corre **dentro** del navegador del coche, la posición ya la tienes gratis con `navigator.geolocation`. La telemetría solo aporta lo que el navegador no sabe: la **ruta nativa** del Tesla, la batería, etc.

### 4.2 Enviar destinos a la navegación nativa (lo que codriver no hace)

Comandos oficiales (`POST /api/1/vehicles/{vin}/command/...`, scope `vehicle_cmds`):

| Comando | Qué hace |
|---|---|
| `navigation_gps_request` | Navega a `lat/lon`; `order` para varias paradas. |
| `navigation_request` | Envía una dirección/texto o URL al navegador del coche (formato `share_ext_content_raw`). |
| `navigation_sc_request` | Navega a un Supercharger. |
| `navigation_waypoints_request` | Envía una lista de paradas. |

Condiciones: la app necesita *virtual key* instalada en el coche y los comandos van firmados (Vehicle Command Protocol) a través del proxy oficial `tesla-http-proxy` del repo `teslamotors/vehicle-command`; solo Model S/X anteriores a 2021 aceptan comandos sin firmar. El coche debe estar despierto; si está dormido hay que pagar un `wake_up` y esperar 10-60 s. En tu caso de uso (elegir destino en la pantalla del coche mientras conduces) el coche está despierto: **0,001 $ por envío**.

### 4.3 Flujo de alta (lo que implementa el PR #10)

1. Cuenta en developer.tesla.com (piden "legal business details" aunque sea personal; aprobación normalmente automática en minutos-horas).
2. Generar par de claves P-256 y publicar la pública en `https://TU-DOMINIO/.well-known/appspecific/com.tesla.3p.public-key.pem`.
3. Registrar la app en **cada región** con `POST /api/1/partner_accounts` (EU: `fleet-api.prd.eu.vn.cloud.tesla.com`; NA aparte).
4. El usuario hace OAuth (desde el móvil, escaneando un QR que muestra la pantalla del coche) y acepta scopes.
5. El usuario empareja la *virtual key* abriendo `https://tesla.com/_ak/TU-DOMINIO?vin=VIN` en la app de Tesla.
6. Tu servidor envía comandos a través del proxy `vehicle-command` con la clave privada montada solo ahí.

### 4.4 Precios (vigentes, developer.tesla.com, idénticos en euros)

| Concepto | Precio | Equivale a |
|---|---|---|
| Comandos | 1.000 por 1 $ | 0,001 $/comando |
| `vehicle_data` | 500 por 1 $ | 0,002 $/petición |
| Wake | 50 por 1 $ | 0,02 $/wake |
| Señales Fleet Telemetry | 150.000 por 1 $ | ~0,0000067 $/señal |
| Crédito mensual | 10 $ (10 €) por **cuenta de desarrollador** | |

Reglas que importan: se factura todo lo que responde con código < 500 (también los 4xx, p. ej. comando rechazado por falta de clave); límite de gasto por defecto 0 hasta añadir tarjeta; si superas el límite se suspende la API y **se borran** las configuraciones de telemetría; rate limits por coche: 30 comandos/min, 3 wakes/min, 60 lecturas/min.

Estimaciones:

| Escenario | Coste mensual |
|---|---|
| 1 coche: 1-2 destinos/día + telemetría de ruta 1 h/día | 0,05-0,75 $ → **0 € efectivos** (crédito) |
| 1 coche con *polling* de `vehicle_data` cada 30 s, 1 h/día | 7,20 $ (aún dentro del crédito, pero mala idea) |
| 20.000 usuarios, solo enviar destinos, GPS del navegador | ~600 $ |
| 20.000 usuarios + telemetría de ruta | ~1.100-3.000 $ |
| 20.000 usuarios si cada envío despierta el coche | +12.000 $ |
| 20.000 usuarios con *polling* | ~144.000 $ (inviable) |

### 4.5 Términos (Fleet API Agreement, versión 21-mar-2025; contraparte Tesla Motors Netherlands B.V.)

- Permite apps para usuarios que envían comandos o leen datos.
- Prohíbe: revender o ceder datos (§5.6.7); competir o **interferir con servicios actuales o previstos de Tesla** (§5.6.21, lista abierta: robotaxi, carga gestionada, VPP…); control automático del vehículo (§5.6.22); usar vías distintas de la API oficial (§5.6.28, adiós a la Owner API no oficial).
- Tesla puede suspender o terminar sin preaviso (§10.2.1).
- GDPR: tú eres responsable independiente; geolocalización precisa exige **consentimiento opt-in explícito**, indicador visible, consentimiento por categoría, revocación, y borrado en 30 días (§9.3.5-9.3.10).
- Zona gris real: una app de navegación/radares podría considerarse "competir con" la navegación de Tesla. No hay precedente público de baneo por esto, y codriver lleva meses operando como app registrada, pero conviene asumirlo como riesgo.
- Desde mayo de 2025 el propietario ve en la app de Tesla cuántos comandos envía cada app de terceros.

### 4.6 Alternativas sin registrar app propia (solo uso personal)

Teslemetry (≈2,67 $ por 2.000 créditos; 1 crédito por comando) o MyTeslaMate permiten probar `navigation_gps_request` sin montar claves ni proxy. No sirven para una app pública: cada usuario tendría que pagar su propio proxy y el Agreement impide revender el acceso.

---

## 5. Datos de alertas y radares

### 5.1 Alertas tipo Waze (policía, accidentes, atascos)

- **Waze georss**: protegido con reCAPTCHA Enterprise desde marzo de 2026 (verificado). Saltárselo viola los términos de Waze y es un blanco móvil. No es una base.
- **Canales legales de Waze** (Waze for Cities / Partner Hub): **[pendiente]** confirmar si un desarrollador privado puede acceder.
- **Reportes propios**: es lo que hacen teslanav.com relanzado, codriver y el fork "Radar". Problema de arranque en frío: con pocos usuarios el mapa está vacío. Mitigación: combinar con datos oficiales de incidencias (DGT/IP) y radares fijos, que sí tienen valor desde el día uno.
- **API pública de codriver** (`/v2/entities/nearby`): incluye su capa Waze y OSM, pero solo para **uso personal no comercial**; para una app pública habría que negociar.
- **Proveedores comerciales de incidentes (TomTom, HERE…) y datos abiertos (DGT DATEX II, Infraestruturas de Portugal)**: **[pendiente]** precios, cobertura y si incluyen avisos de policía.

### 5.2 Radares

| Fuente | Qué es | Formato | Notas |
|---|---|---|---|
| DGT "Radares fijos DGT" (nap.dgt.es) | Radares fijos de la red estatal (sin Cataluña ni País Vasco) | DATEX II, licencia CC-BY | Dataset abierto; conviene suscribirse a avisos de cambios. |
| DGT "Puntos y tramos de control de velocidad" | Fijos + tramo (y el resto de cinemómetros) | PDF (1,52 MB), actualizado 03-ago-2026 | Habría que extraer tabla a datos; no indica coordenadas sino vía y PK. |
| DGT nota de prensa 27-feb-2026 | 33 radares nuevos (20 fijos, 13 de tramo) | PDF/web | "Puestos a disposición de los operadores de navegadores". |
| ANSR / radaresavista.pt (Portugal) | 123 locales SINCRO (100 instantánea + 23 media) | Web + PDF | Sin API ni GeoJSON oficial. |
| OpenStreetMap | `highway=speed_camera`, `enforcement=*` | Overpass o extracto propio | 110 cámaras en 25 km de Lisboa, 145 en Madrid (datos vistos vía codriver). Cobertura buena en ciudades, desigual fuera. Licencia ODbL. |
| **[pendiente]** Francia (data.gouv.fr), SCDB, TomTom, Radarbot, calidad OSM por país | | | |

Recomendación técnica: dejar de consultar Overpass en vivo. Generar un **GeoJSON estático de cámaras** (OSM filtrado con `osmium tags-filter` + lista oficial DGT/ANSR georreferenciada) y servirlo desde la CDN con refresco semanal. Es lo que en la práctica hace codriver con su capa `osm-cameras`.

### 5.3 Legalidad de avisar de radares

| País | Apps que avisan de radares (posición conocida) | Detectores / inhibidores | Norma |
|---|---|---|---|
| España | **Legal** ("Avisar es legal; detectar e inhibir, no", DGT) | Detectores: 200 € y 3 puntos; inhibidores: hasta 6.000 € y 6 puntos | Ley de Tráfico (art. 13.6 y 76), reforma RGC |
| Portugal | **Legal** según fuentes especializadas (Waze, Radarbot operan) | Prohibidos: 500-2.500 € y aprehensión | Código da Estrada, art. 84 |
| Francia | Prohibido avisar de posición exacta; permitido "zonas de peligro" | Prohibidos | Code de la route R413-15 |
| Alemania | Prohibido **usarlos conduciendo** (75 €) | Prohibidos | §23 StVO |
| **[pendiente]** Italia, Suiza, Reino Unido; verificación de la noticia "la UE prepara multas para apps" | | | |

---

## 6. Mapas y rutas sin Mapbox

Lo que ya funciona en producción en el ecosistema:

- **MapLibre GL JS + OpenFreeMap** (teslanav.com relanzado): coste 0, estilos listos, sin tráfico ni terreno.
- **MapLibre + Protomaps/PMTiles autoalojado** (codriver): control total del estilo, coste de almacenamiento y CDN muy bajo.
- Satélite: ArcGIS World Imagery (teslanav.com relanzado).
- Rutas: el relanzamiento no tiene navegación; codriver y "Radar" siguen pagando Mapbox Directions. Alternativas: Valhalla/OSRM/GraphHopper autoalojados o APIs con capa gratuita.

### 6.1 Por qué Mapbox costaba 1.500 USD/mes

Precios Mapbox 2026 (mapbox.com/pricing): *map loads* web 50.000 gratis y luego 5 → 4 → 3 USD por 1.000; Directions y Map Matching 100.000 gratis y luego 2 → 1,6 USD por 1.000. Con 20.000 usuarios y ~10 sesiones por usuario salen 200-240k *map loads* (650-770 USD) y, con reruteo a 50 m, 500-600k peticiones de Directions (800-960 USD): 1.450-1.730 USD/mes. El coste no eran los tiles, así que el proxy de tiles en Vercel Blob no lo arreglaba (y Blob cobra egress: ~1 TB/mes de tiles costaría 50-60 USD).

### 6.2 Piezas gratuitas o baratas que ya funcionan (precios leídos el 15-oct-2026)

| Pieza | Opción | Coste | Notas |
|---|---|---|---|
| Renderizado | MapLibre GL JS 6.x (v6.14.0, 11-oct-2026) | 0 | v6 exige **WebGL2** y es ESM-only; si el MCU Intel no lo soporta, fijar 5.x. |
| Tiles base | OpenFreeMap (estilos liberty, bright, positron, dark, fiord) | 0 (donación recomendada) | Sin límites ni clave, uso comercial permitido, sin SLA; planeta regenerado semanalmente. Es lo que usa teslanav.com relanzado. |
| Tiles base (plan B) | Extracto Iberia en PMTiles (Protomaps) en Cloudflare R2 + Worker | ~14 USD/mes a 24M tiles | Egress gratis en R2; lo que usa codriver. |
| Terreno 3D | Mapterhorn (tiles Terrarium, también PMTiles) | 0 | Sustituye a `mapbox-terrain-dem-v1`. |
| Edificios 3D | Capa `building` de OpenMapTiles | 0 | Atributos `render_height`/`render_min_height` (no `height`/`min_height`). |
| Tráfico en mapa | TomTom Traffic Flow vector tiles | 200.000 tiles/mes gratis; ~0,08 USD/1.000 después | No hay equivalente libre de `mapbox-traffic-v1`. Limitar a zoom ≥ 12 y viewport. |
| Satélite | ArcGIS Location Platform con API key | 2M tiles/mes gratis; 0,15 USD/1.000 después | El endpoint crudo de World Imagery sin clave (lo que usa teslanav.com relanzado) está fuera de los términos de Esri para uso comercial. |
| Routing sin tráfico | Valhalla autoalojado con extracto Iberia (Geofabrik) | VPS Hetzner CPX42 (8 vCPU/16 GB) ≈ 70 €/mes | Europa entera: 32-64 GB RAM (130-280 €/mes). Rebuild semanal. |
| Routing con tráfico | TomTom Routing | 20.000 rutas/mes gratis; ~0,75 USD/1.000 después (cifra de terceros) | Google Routes con tráfico: 5.000 gratis, 10 USD/1.000. HERE exige tarjeta. |
| Routing APIs gratis | openrouteservice (~2.000/día), Geoapify (3.000 créditos/día, comercial), LocationIQ Directions (5.000/día) | 0 | Sin tráfico en vivo. GraphHopper free solo no comercial. |
| Geocoding | Photon autoalojado (dumps `es` 2 GB + `pt` 431 MB) | en el mismo VPS | Autocompletado sin límite. Nominatim público prohíbe autocompletado. LocationIQ 5.000/día y Geoapify 3.000/día como alternativas comerciales gratis. |

### 6.3 Dos arquitecturas (20.000 usuarios/mes; supuestos: 8 sesiones/usuario, 150 tiles/sesión, 2 rutas/sesión)

- **(a) Todo autoalojado, sin tráfico en vivo:** MapLibre + OpenFreeMap (o PMTiles en R2) + Mapterhorn + ArcGIS dentro de cuota + Valhalla y Photon en un VPS + Vercel Pro + Upstash ≈ **95-170 USD/mes**. Versión hobby (< 2.000 usuarios) ≈ **40 USD/mes** o menos.
- **(b) Mezcla con APIs gratuitas y tráfico real vía TomTom:** igual mapa + TomTom para ruta inicial/ETA (y Valhalla para reruteos) + capa de tráfico acotada + geocoding gratuito ≈ **160-500 USD/mes**. Versión hobby: **0-20 USD/mes**, todo dentro de las cuotas gratuitas.
- Recomendación: (a) más TomTom solo para la ruta inicial y el ETA (≈ +100 USD/mes a 20k usuarios, 0 en hobby). No hay fuente abierta de velocidades de tráfico para España/Portugal (el NAP de la DGT publica incidencias DATEX II CC-BY, no flujo).

### 6.4 Impacto en este repo (`components/Map.tsx`, `app/api/directions`)

- Sustituir `mapbox://styles/...` por los estilos de OpenFreeMap; `setTerrain` sigue igual cambiando la fuente `raster-dem` a Mapterhorn (`encoding: "terrarium"`); `setFog` → `setSky`; la capa `fill-extrusion` pasa a `render_height`/`render_min_height`; `mapbox-traffic-v1` se sustituye por TomTom o se elimina; los ids de capa usados por `hidePlaceLabels` cambian (`place_*`, `highway_*`); clases CSS `maplibregl-`.
- Eliminar el proxy `/api/tiles` y el service worker de tiles de Mapbox (ya no aportan ahorro).
- `/api/directions`: pasar a Valhalla o TomTom; reducir el reruteo (hoy a 50 m con 5 s de espera) para no disparar el número de peticiones.
- Revisar si los términos de Mapbox permiten usar su Directions sobre un mapa que no es de Mapbox antes de mantenerlo como opción.
- Fuentes: mapbox.com/pricing; openfreemap.org y su ToS (14-oct-2026); github.com/maplibre/maplibre-gl-js/releases; docs.protomaps.com/deploy/cost; mapterhorn.com/data-access; docs.tomtom.com/pricing; developers.google.com/maps/billing-and-pricing; locationiq.com/pricing; geoapify.com/pricing; github.com/komoot/photon; valhalla.github.io; location.arcgis.com/pricing; developers.cloudflare.com/r2/pricing.

---

## 7. Navegador del Tesla y funciones nativas

### 7.1 El navegador del Tesla como plataforma (verificado)

- **GPS:** `navigator.geolocation` entrega la posición que calcula el propio coche, a ~1 Hz y con ~1 s de retraso; exige HTTPS y se detiene si la página está oculta. En MCU2 (Intel) `coords.speed` suele llegar a 0 o `null`, así que velocidad y rumbo hay que derivarlos por desplazamiento (el repo ya lo hace en `useGeolocation`). Tres apps independientes (teslanav, codriver, tesbox) lo usan en producción en 2026. Historial de roturas: 2019 (sin prompt), 2020-2021 (`watchPosition` denegado), dic-2021 (2021.44.5, "Location unavailable"), 2024 (posición congelada en ABRP). Diseñar con detección de GPS congelado y aviso al usuario.
- **En marcha:** en EE. UU./Canadá y en Europa el navegador **no se cierra al poner D**; lo que Tesla bloquea en movimiento es el vídeo, la pantalla completa y los juegos. Evidencia directa en España (foro Club Tesla España, ago-2024: "puede hacer búsquedas en el navegador mientras conduce, incluso en autovía"), Bélgica (abr-2025), Alemania y Reino Unido. Portugal comparte firmware y región con España; no hay fuente específica. Regiones restringidas: Australia (solo en P), Hong Kong (sin navegador), Taiwán.
- **Conectividad:** sobre LTE el navegador exige **Conectividad Premium** (~10 €/mes); sin ella solo con Wi-Fi o hotspot del móvil. Es la pega más citada por la comunidad.
- **2026.26 "Summer Update" (Chromium 140 → 148):** `devicePixelRatio` pasa de 1,0 a 1,53 (Model 3/Y) y ~1,56 (S/X); el viewport CSS baja de 1920×1200 a 1254×784 y la ventana del navegador ya no ocupa toda la pantalla (medida: 773×601 px CSS en un Model Y); `pointer: fine`/`hover: hover`; `prefers-color-scheme: light`; sin zoom de usuario; y **el token "Tesla/…" desapareció del User-Agent**. codriver detecta ahora el coche por tamaño físico de pantalla y chip gráfico (`WEBGL_debug_renderer_info`).
- **Audio y voz:** el audio requiere un toque previo del usuario (autoplay bloqueado), el navegador se convierte en fuente de audio del coche (pausa la música) y a veces las alertas no suenan. **`speechSynthesis` no tiene voces instaladas** ("the Tesla browser has no voice engine"): codriver reproduce clips pregrabados. Para español/portugués: generar los clips con TTS en servidor y servirlos como MP3.
- **Rendimiento:** MCU2 (Atom) mueve un mapa vectorial a 5-15 fps; codriver necesitó un motor propio para 25-35 fps en 3D; MCU3 (Ryzen) va a 60 fps. Conclusión: 2D ligero por defecto, 3D solo en Ryzen.
- **Otros límites:** pantalla completa solo aparcado; sin pantalla dividida; favoritos e inicios de sesión sincronizados por perfil desde 2026.26; el navegador puede recargarse en marcha (codriver restaura el estado del viaje tras recarga); sin evidencia de Wake Lock API; cámara y micrófono para webs desde 2026.26 (solo Ryzen, cámara solo aparcado); controles parentales desde 2026.20 (opt-in, por perfil); **bloqueador de anuncios a nivel de red en 2026.32** (puede romper PostHog y scripts de terceros); 2026.38 cierra el truco del navegador en la pantalla trasera. No hay evidencia de que Tesla bloquee dominios de webapps tipo Waze.
- **Impacto en este repo:** la detección `userAgent.includes("tesla")` de `app/page.tsx` ya no funciona en Chromium 148, y el umbral `innerWidth < 768` queda a 5 px de disparar el aviso "mobile" dentro del coche (ventana de 773 px CSS). Hay que detectar el coche por pantalla/GPU, tratar el DPR como variable, exigir un toque inicial para habilitar audio y sustituir cualquier `SpeechSynthesis` por clips.
- Fuentes: github.com/Atvriders/tesbox; codriver.io/changelog (ago-sep 2026) y guía 2026.26; hilo TMC "The Summer Update changed the in-car browser's pixel density" (ago-2026); foro.clubtesla.es (hilo 10895); notateslaapp.com (2026.20, 2026.26, 2026.32, 2026.38); Leaflet issue #7157.
### 7.2 Qué ofrece Tesla de serie (verificado)

- **Radares fijos, sí, pero con condiciones.** Desde la Holiday Update de dic-2023 (2023.44.30.x) el navegador muestra iconos de radar fijo, móvil, de tramo y de semáforo y avisa del siguiente radar sobre el módulo de giro. Desde 2024.14 (abr-2024) hay aviso sonoro ("Speed Camera Chime", en el manual portugués "Aviso sonoro do radar de controlo da velocidade") y "Average Speed Zones". Requiere **Conectividad Premium + rutas en línea** y, según los propietarios españoles (Club Tesla España, jun-2024), solo funciona **con una ruta activa**, con fallos en radares de tramo (Guadarrama, A-5) y huecos de cobertura; muchos siguen usando Radarbot o Waze en paralelo.
- **"Speed Cameras on Route" (Summer Update 2026, 2026.26.x):** símbolos de radares a lo largo de la ruta, Premium obligatorio. Los trackers de flota lo observan activo en España (AT, BE, BG, CZ, DK, ES, FI, FR, GB, IT, MD, NL, NO); **Portugal, Alemania y EE. UU. no aparecen** a 15-oct-2026. El manual excluye Francia del icono de radar ("Excluding France"), lo que sugiere un modo "zonas de peligro".
- **No hay alertas colaborativas nativas** (policía, objetos en la vía, vehículos parados). A finales de agosto de 2026 varias fuentes lo señalan explícitamente, a raíz de que Rivian integrara las alertas de Waze (policía + radares) en su OTA 2026.31. Tesla muestra obras y, según referencias de código de 2024, accidentes/cortes, pero sin reportes de usuarios.
- **"Cop Mode" (InsideEVs, 27-dic-2025)** no era una función de Tesla: era **TeslaNav** abierto en el navegador del coche mostrando reportes de Waze. La prensa ya ha identificado esta propuesta de valor bajo el nombre TeslaNav.
- **CarPlay (el mayor riesgo estratégico):** Bloomberg (13-nov-2025) reveló pruebas internas de CarPlay inalámbrico en una ventana de la interfaz; retraso en feb-2026 por la sincronización Apple Maps ↔ navegación Tesla con FSD; Apple presentó "Route Sharing" en WWDC26 (jun-2026). A 15-oct-2026 **no está lanzado**, Tesla no lo ha anunciado y la prensa duda entre "Holiday Update 2026" y "cancelado". Rumor: solo MCU AMD/Ryzen. Si llega, Waze y Google Maps correrían en pantalla con sus alertas y una app de navegador perdería valor en los coches compatibles. Android Auto: ningún indicio.
- **Sin App Store ni SDK en pantalla:** la única vía oficial para interfaz de terceros sigue siendo el navegador; la Fleet API cubre datos y comandos remotos, incluido enviar destinos al navegador nativo. "Enviar al coche" desde Google/Apple Maps funciona vía la hoja de compartir de la app Tesla (manual oficial).
- **Europa:** desde jul-2024 (GSR2/ISA) los Tesla nuevos avisan con sonido al superar el límite. Grok llegó a España y Portugal el 16-feb-2026 (2026.2.6; AMD + Premium) y desde 2026.26 fija destinos por voz. Novedades 2026.26: Preferred Routes (no observado en ES/PT), Automatic Navigation (sí en ES/PT), Set Arrival Energy. FSD Supervisado sigue pendiente de aprobación en España y Portugal (voto europeo aplazado a diciembre de 2026).
- **Hueco real que Tesla no cubre:** alertas colaborativas en tiempo real (policía, accidentes, objetos, radares móviles), avisos de radares sin ruta activa y sin Premium, y cobertura/calidad de radares de tramo en España y Portugal. Fuentes: notateslaapp.com (release notes 2024.14, 2026.26.1, 2026.26.6.1; "Rivian adds Waze integration", 28-ago-2026), tesla-info.com/release/2026.26, foro.clubtesla.es (hilo 10457), insideevs.com/news/782854, macrumors.com (13-nov-2025, 16-feb-2026), 9to5mac.com (15-jun-2026, 07-ago-2026).

---

## 8. Qué podemos hacer (propuesta por fases)

### Fase A — Revivir el fork sin costes fijos (1-2 semanas de trabajo)

1. `NEXT_PUBLIC_PROJECT_SHUTDOWN=false` y limpiar el modo shutdown.
2. Sustituir `mapbox-gl` por **MapLibre GL** con tiles de **OpenFreeMap** (o PMTiles propios en R2 si se quiere independencia total) y satélite de ArcGIS. Eliminar el proxy de tiles de Vercel Blob (ya no hace falta) o reutilizarlo para la capa de cámaras.
3. Radares: generar un GeoJSON estático **OSM + DGT (DATEX II) + ANSR**, servido desde `/public` o CDN; eliminar la dependencia de Overpass en vivo. Añadir radares de tramo con sus dos extremos.
4. Alertas: portar el sistema de **reportes comunitarios** (el fork "Radar" ya tiene tipos, votos y expiración; el PR #11 tiene velocidad y límite). Para uso personal se puede añadir la capa de codriver vía su API pública mientras no sea comercial.
5. Voz y avisos: reutilizar `alert-sound.mp3` y añadir **clips pregrabados** en español/portugués (el navegador del Tesla no tiene voces de síntesis), con un toque inicial para desbloquear el audio; umbral por distancia y rumbo como ya hace `isAlertAhead`.
7. Compatibilidad 2026.26+: detectar el coche por pantalla/GPU en vez del User-Agent, tratar `devicePixelRatio` como variable, revisar el umbral de 768 px del aviso "mobile" y probar con el bloqueador de anuncios activado.
6. Localización ES/PT y unidades métricas.

Coste mensual: ≈ 0 (Vercel hobby + Upstash free + OpenFreeMap).

### Fase B — Conectar la API de Tesla (2-4 semanas más)

1. Alta en developer.tesla.com con tu dominio, clave pública en `/.well-known/...`, registro en la región EU.
2. Reutilizar del **PR #10** de upstream: OAuth de Tesla, `ConnectFlow` con QR desde el coche, almacenamiento cifrado de tokens, `docker-compose` con `vehicle-command`.
3. Añadir lo que falta: ruta `/api/tesla/navigate` que llame a `navigation_gps_request` (o `navigation_waypoints_request`) a través del proxy firmado cuando el usuario elige un destino en la búsqueda o con pulsación larga en el mapa. Resultado: **buscas en tu app y el Tesla navega con su navegador nativo** (con Autopilot/FSD, carga planificada, etc.).
4. Opcional: Fleet Telemetry para pintar la ruta nativa y el ETA del coche en tu mapa (como codriver "Car route"). Requiere un servidor con IP pública y certificado en el puerto 443 (una VPS pequeña basta; Ryan usa una EC2).
5. Comprobar `fleet_status`/estado online antes de enviar para no pagar comandos rechazados ni wakes.

Coste: 0 € para tu coche (crédito de 10 €). Scopes mínimos: `vehicle_cmds` (+ `vehicle_device_data` para listar coches; `vehicle_location` solo si usas telemetría de ruta).

### Fase C — Si se abre al público (tipo codriver)

- Licencia: el código original es PolyForm Noncommercial; para un producto comercial habría que reescribir o pedir licencia a Ryan (ofreció vender el dominio).
- Legal: política de privacidad, consentimiento opt-in de geolocalización, retención ≤ 30 días; revisar §5.6.21 del Agreement; en Francia ocultar posición exacta de radares.
- Costes: API de Tesla 600-3.000 $/mes a 20.000 usuarios (si envías destinos y telemetría), más servidor de telemetría, más routing si lo ofreces. Exige monetizar (suscripción tipo 3-6 €/mes como codriver).
- Datos de alertas: reportes propios + datos abiertos oficiales + proveedor comercial si se quiere "policía" desde el día uno.

### Lo que no recomiendo

- Saltarse el reCAPTCHA de Waze o reutilizar tokens de sesión: viola los términos de Waze, se rompe sin aviso y expone a reclamación.
- Usar la Owner API no oficial: prohibida por el Agreement (§5.6.28) y la mayoría de coches ya exigen comandos firmados.
- *Polling* de `vehicle_data` para posición: caro e innecesario dentro del coche.
- Volver a Mapbox para tiles.

---

## 9. Riesgos y preguntas abiertas

1. Que Tesla interprete una app de navegación/radares como competencia (§5.6.21). Mitigación: posicionarla como complemento (alertas) que **envía destinos al navegador nativo**, no que lo sustituye.
2. Rechazos técnicos de registro en la UE (HTTP 424 reportados en 2026 sin explicación).
3. Cambios de firmware que rompen webapps (como el de 2026.26). Mitigación: pruebas tras cada release.
4. Arranque en frío de los reportes comunitarios.
5. **CarPlay en Tesla** (no lanzado a 15-oct-2026, sin fecha): si llega en una ventana con Waze/Google Maps, el valor de una app de navegador cae en los coches compatibles (rumor: solo AMD). Mitigación: centrarse en lo que CarPlay no da dentro del coche (integración con la navegación nativa vía Fleet API, radares de tramo ES/PT, alertas sin Premium).
6. **Cambios de firmware del navegador** (UA sin "Tesla", DPR variable, bloqueador de anuncios): la app debe probarse en cada release y no depender del User-Agent.

---

## 10. Fuentes principales

- Repo: https://github.com/R44VC0RP/teslanav.com (PRs #9, #10, #11; forks) · Fork "Radar": https://github.com/ShayalaW/teslanav.com
- Ryan Vogel: https://ryan.ceo/blog/teslanav-api-shutdown-map-costs · https://x.com/ryanvogel/status/2035471193520640058
- Waze live-map: https://www.waze.com/live-map/ (bundle `livemap-614ec638785637a7c045.js`, interceptor `X-Recaptcha-Token`)
- codriver: https://codriver.io/ · /features/car-route · /developers · /terms · /changelog · /compare/teslanav · /guides/tesla-browser-summer-2026-update · https://app.codriver.io/v2/sources
- Tesla: https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands · /fleet-telemetry/available-data · /virtual-keys/developer-guide · /billing-and-limits · /getting-started/regions-countries · Fleet API Agreement (PDF, 21-mar-2025) · https://github.com/teslamotors/vehicle-command
- Radares: https://nap.dgt.es/dataset/radares-fijos-dgt · https://www.dgt.es/conoce-el-estado-del-trafico/vigilancia-y-control/equipos-y-tramos-de-vigilancia/ · https://radaresavista.pt/ · https://revista.dgt.es/es/reportajes/2019/08AGOSTO/0806-Avisar-legal-detectar-no.shtml
- Comunidad: https://codriver.io/guides/best-tesla-browser-apps · https://teslamotorsclub.com/tmc/threads/teslawaze-updates-was-teslawaze-is-done.115461/ · https://www.cybertruckownersclub.com/forum/threads/ryan-vogel-built-the-waze-app-tesla-should%E2%80%99ve-made.51933/
