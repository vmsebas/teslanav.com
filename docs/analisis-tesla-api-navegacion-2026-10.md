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

**[pendiente]** Tabla de precios y límites (OpenFreeMap, MapTiler, Mapbox 2026, TomTom/HERE/ORS routing, geocoding) y dos arquitecturas con coste mensual estimado para 20.000 usuarios.

Impacto en este repo: `components/Map.tsx` usa `setTerrain` con `mapbox-terrain-dem-v1`, `fill-extrusion` de edificios, `mapbox-traffic-v1` y estilos `mapbox://`. Migrar a MapLibre es directo para el mapa 2D; el terreno 3D y el tráfico necesitan fuentes alternativas o desaparecen (el relanzamiento los quitó).

---

## 7. Navegador del Tesla y funciones nativas

- Hechos confirmados: `navigator.geolocation` funciona hoy (teslanav.com y codriver dependen de ello); 2026.26 = Chromium 148 y nueva densidad de píxeles; 2026.20 = controles parentales; codriver soporta MCU2 y MCU3 y ha tenido que reescribir su renderer 3D por rendimiento en MCU2.
- **[pendiente]** Disponibilidad del navegador en marcha en España/Portugal frente a EE. UU., y detalles de wake lock, audio y pantalla completa.
- **[pendiente]** Si Tesla ya avisa de radares de serie en Europa, estado de CarPlay en Tesla (octubre 2026) y novedades de navegación 2026.x.

---

## 8. Qué podemos hacer (propuesta por fases)

### Fase A — Revivir el fork sin costes fijos (1-2 semanas de trabajo)

1. `NEXT_PUBLIC_PROJECT_SHUTDOWN=false` y limpiar el modo shutdown.
2. Sustituir `mapbox-gl` por **MapLibre GL** con tiles de **OpenFreeMap** (o PMTiles propios en R2 si se quiere independencia total) y satélite de ArcGIS. Eliminar el proxy de tiles de Vercel Blob (ya no hace falta) o reutilizarlo para la capa de cámaras.
3. Radares: generar un GeoJSON estático **OSM + DGT (DATEX II) + ANSR**, servido desde `/public` o CDN; eliminar la dependencia de Overpass en vivo. Añadir radares de tramo con sus dos extremos.
4. Alertas: portar el sistema de **reportes comunitarios** (el fork "Radar" ya tiene tipos, votos y expiración; el PR #11 tiene velocidad y límite). Para uso personal se puede añadir la capa de codriver vía su API pública mientras no sea comercial.
5. Voz y avisos: reutilizar `alert-sound.mp3`, añadir `SpeechSynthesis` en español/portugués, umbral por distancia y rumbo como ya hace `isAlertAhead`.
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
5. **[pendiente]** Disponibilidad del navegador en marcha en Europa y funciones nativas de Tesla que puedan solapar.

---

## 10. Fuentes principales

- Repo: https://github.com/R44VC0RP/teslanav.com (PRs #9, #10, #11; forks) · Fork "Radar": https://github.com/ShayalaW/teslanav.com
- Ryan Vogel: https://ryan.ceo/blog/teslanav-api-shutdown-map-costs · https://x.com/ryanvogel/status/2035471193520640058
- Waze live-map: https://www.waze.com/live-map/ (bundle `livemap-614ec638785637a7c045.js`, interceptor `X-Recaptcha-Token`)
- codriver: https://codriver.io/ · /features/car-route · /developers · /terms · /changelog · /compare/teslanav · /guides/tesla-browser-summer-2026-update · https://app.codriver.io/v2/sources
- Tesla: https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands · /fleet-telemetry/available-data · /virtual-keys/developer-guide · /billing-and-limits · /getting-started/regions-countries · Fleet API Agreement (PDF, 21-mar-2025) · https://github.com/teslamotors/vehicle-command
- Radares: https://nap.dgt.es/dataset/radares-fijos-dgt · https://www.dgt.es/conoce-el-estado-del-trafico/vigilancia-y-control/equipos-y-tramos-de-vigilancia/ · https://radaresavista.pt/ · https://revista.dgt.es/es/reportajes/2019/08AGOSTO/0806-Avisar-legal-detectar-no.shtml
- Comunidad: https://codriver.io/guides/best-tesla-browser-apps · https://teslamotorsclub.com/tmc/threads/teslawaze-updates-was-teslawaze-is-done.115461/ · https://www.cybertruckownersclub.com/forum/threads/ryan-vogel-built-the-waze-app-tesla-should%E2%80%99ve-made.51933/
