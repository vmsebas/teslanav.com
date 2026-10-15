# TeslaNav: qué hace la comunidad, qué permite la API de Tesla y qué podemos construir

Fecha del análisis: 15 de octubre de 2026. Repositorio analizado: `vmsebas/teslanav.com` (fork de `R44VC0RP/teslanav.com`).

> Informe completo. Metodología: lectura directa del repositorio y de los PRs y forks de upstream, inspección del código cliente público de teslanav.com, codriver.io y del live-map de Waze, descarga de los ficheros oficiales (DGT, ANSR, data.gouv.fr, BOE, TJUE), documentación oficial de Tesla y seis investigaciones web independientes con fuentes citadas. Lo no verificado se señala como tal.

---

## 0. Resumen ejecutivo

1. **Tu fork es la versión "muerta".** Es idéntico, commit a commit, al `main` público de Ryan Vogel, que se congeló el 21-mar-2026 con el modo *shutdown* activado por defecto. Tal cual, no arranca la app ni funcionan las alertas.
2. **Por qué murió:** las alertas salían de un endpoint no documentado de Waze (`/live-map/api/georss`). Desde marzo de 2026 el propio frontend de Waze adjunta una cabecera `X-Recaptcha-Token` (reCAPTCHA Enterprise) a cada llamada; sin ese token el endpoint devuelve `403`. Lo he comprobado hoy. Además, Mapbox costaba ~1.500 USD/mes con ~20.000 usuarios.
3. **Alguien sí encontró la forma: tres caminos distintos.**
   - Ryan relanzó teslanav.com en julio de 2026 con una reescritura: MapLibre + tiles gratuitos de OpenFreeMap + satélite Esri + **reportes propios de usuarios** + radares desde datos abiertos, todo en un contenedor Docker sin servicios de pago. Coste de mapas ≈ 0. No usa la API de Tesla. **Su código está en la rama `feature/billboards` del fork `jtmaveryk/teslanav`** (23 commits de Ryan). Sus alertas de Waze salen de un canal no oficial que va contra los términos de Waze; esa parte no es reutilizable con seguridad.
   - **codriver.io** (empresa de Québec) es una **app oficial de la Tesla Fleet API** (publica su clave en `/.well-known/appspecific/com.tesla.3p.public-key.pem`), usa **Fleet Telemetry** para leer la ruta activa del coche ("Car route", Premium), reportes comunitarios, radares de **OpenStreetMap**, y una capa de incidentes **atribuida a Waze** que sigue viva hoy. Mapa base propio con Protomaps.
   - El fork **ShayalaW/teslanav.com ("Radar")** añadió reportes comunitarios con 15 tipos, navegación guiada por voz, límite de velocidad y wake lock (37 commits, sep-2026), pero sigue atado a Mapbox y al endpoint muerto de Waze.
4. **La API de Tesla permite las dos cosas que preguntas.** Leer posición/ruta (vehicle_data o Fleet Telemetry) y **enviar un destino a la navegación nativa** (`navigation_gps_request`, `navigation_request`, `navigation_waypoints_request`). codriver solo lee por decisión propia; enviar destinos es técnicamente posible y oficial.
5. **El propio Ryan ya escribió la integración con la Fleet API** y está en el PR #10 del repo público (ago-2026, sin fusionar): OAuth de Tesla, emparejamiento de *virtual key* por QR desde la pantalla del coche, proxy `vehicle-command`, receptor de Fleet Telemetry con la ruta del coche, y una guía de 370 líneas. Es reutilizable.
6. **Coste de la API de Tesla:** para un coche propio es gratis en la práctica (crédito de 10 €/mes por cuenta; un envío de destino cuesta 0,001 $). Para 20.000 usuarios, entre ~600 $/mes (solo enviar destinos) y ~1.100-3.000 $/mes (con telemetría de ruta). Despertar coches dormidos (0,02 $) y el *polling* de `vehicle_data` son lo que arruina el presupuesto.
7. **Radares:** hay datos oficiales con coordenadas (DGT: DATEX II CC-BY con 690 cabinas y 47 tramos; Cataluña: fichero diario; Francia: CSV oficial) y OSM tiene 2.493 radares en España y 301 en Portugal. La ANSR portuguesa solo publica PDF (su JSON interno con coordenadas requiere permiso). Avisar de radares con una app es legal en España (art. 13.6 Ley de Tráfico y art. 18.3 RGC desde 1-oct-2026) y en Portugal; prohibido en Suiza, restringido en Francia y Alemania.
7b. **Alertas de tráfico:** no hay vía legal a los datos de Waze para una app privada, y ninguna fuente legal (Waze for Cities, TomTom, HERE, DGT) entrega avisos de **policía**. La DGT publica gratis un DATEX II con cientos de incidencias por minuto (obras, cortes, accidentes, objetos en calzada); Cataluña y TomTom cubren el resto; Portugal exige pedir acceso al NAP. Los avisos de policía solo pueden venir de **reportes de tus propios usuarios** (lo que hacen codriver y el teslanav.com relanzado).
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
- **Corrección tras revisar los 29 forks: buena parte del código del relanzamiento sí está publicada**, aunque no en el repo de Ryan: la rama `feature/billboards` del fork **`jtmaveryk/teslanav`** contiene 23 commits de Ryan Vogel (22-30 de julio de 2026): reportes de policía y peligros desde el mapa, votación y caducidad de reportes, capa de radares fijos y de semáforo desde datos abiertos, unidades por idioma, tema automático por hora solar, panel de administración y despliegue Docker. Ya está descargada en tu clon local como `fork-jtmaveryk-teslanav/feature/billboards`.
- **Arquitectura reutilizable de esa rama (leída en el código):** un solo contenedor Docker con Next.js 16.2, Redis en memoria y SQLite; `maplibre-gl` 5.13 con estilos de OpenFreeMap y satélite Esri/USGS; sin Mapbox, PostHog, Vercel Blob ni LocationIQ. `/api/directions`, `/api/geocode` y el Overpass de radares quedan como "stubs vacíos intencionados": **no hay navegación ni búsqueda**. Los reportes propios tienen TTL por tipo, un reporte igual a menos de 250 m cuenta como confirmación, límites por IP y votos. El importador de radares solo trae datos abiertos de **Chicago y Washington DC** más OSM (por eso en Lisboa devuelve 0 cámaras); es el punto donde enchufar DGT, Cataluña, Francia y OSM.
- **Su capa de Waze:** las alertas que hoy sirve `teslanav.com/api/waze` (comprobado en vivo: 28 atascos en Lisboa y 34 alertas en Madrid, con 1 de policía) salen de un **canal no oficial de Waze** reimplementado en el servidor, más un *userscript* opcional que reenvía datos desde el navegador del propio usuario. Ambas vías van contra los Términos de Uso de Waze, dependen de que Waze no cambie su protocolo (el propio código prevé el caso de que deje de aceptar la versión que imita) y Waze lleva todo 2026 cerrando canales no oficiales. No voy a documentar cómo funciona ni recomiendo apoyarse en ello: es una decisión de riesgo tuya, y mi consejo es usarlo como mucho en una instancia personal y nunca como base de un producto.

**PRs abiertos en el repo público (no fusionados):**

- **#10 "Add persistent Tesla account linking and route subscriptions" (17-18 ago 2026, 49 ficheros, +3.943 líneas).** Integración completa con la Fleet API: OAuth de Tesla con scopes `openid offline_access user_data vehicle_device_data vehicle_location`; emparejamiento de *virtual key* con QR desde el coche (`https://tesla.com/_ak/teslanav.com?vin=VIN`); `docker-compose` con el proxy oficial `vehicle-command`; receptor oficial **Fleet Telemetry** (mTLS en el puerto 443 de una EC2) suscrito a `RouteLine`, `DestinationName`, `DestinationLocation`, `MilesToArrival`, `MinutesToArrival`, `RouteTrafficMinutesDelay`; forwarder a Redis; hook `useTeslaRoute` que pinta la ruta nativa del coche en el mapa; auth con Better Auth y cobro con Autumn (pensaba vender la sincronización de ruta como suscripción, igual que codriver). Incluye `docs/tesla-fleet-api-setup.md`. **No envía destinos al coche** (solo lee la ruta), pero toda la infraestructura de claves y proxy que hace falta para enviarlos está ahí.
- **#11 "Add Waze-style current speed and speed limit display" (21-ago-2026).** Velocidad actual y límite de velocidad por carretera cercana, con `maxspeed` de OSM.
- **#9** (usuario `hearhour`, mar-2026): solo invierte el flag de shutdown.

### 3.2 Los 29 forks, uno por uno (HEAD de cada rama comparado con upstream el 15-oct-2026)

| Fork | Respecto a upstream | Qué aporta |
|---|---|---|
| **jtmaveryk/teslanav** (rama `feature/billboards`) | 23 commits por delante, autor Ryan Vogel (jul-2026) | **El código del relanzamiento** (ver 3.1). Lo más valioso del ecosistema. |
| **ShayalaW/teslanav.com** ("Radar") | 37 commits por delante (sep-2026) | Reportes comunitarios con 15 tipos, navegación con voz, límite de velocidad, cortes "road ahead", wake lock, soporte móvil. Sigue atado a Mapbox y al endpoint muerto de Waze. |
| VMan228/teslanav.com | 38 commits por delante (may-2026) | Un "sidecar" que automatiza un navegador real (con proxies residenciales, cookies exportadas y perfiles persistentes) para seguir sacando el `georss` de Waze. Es exactamente lo que Waze prohíbe y lo que no recomiendo. |
| cadevass/teslanav.com | 10 commits (may-2026) | Pequeñas mejoras de UI: banner de giro, aviso de radar, km en vez de millas, ajustes para Australia. |
| hearhour/teslanav.com (`main` y `patch-1`) | 1 commit cada rama (mar-2026) | Solo invierte el flag de shutdown (es el PR #9). |
| samhithpadala/teslanav.com | 1 commit (jul-2026) | Borra dos imágenes. |
| n0tadev0, olsoybakk | Idénticos (copian también las ramas de upstream) | Nada. |
| bfayers, Marzssss | Por **detrás** de upstream (instantáneas antiguas) | Nada. |
| Los otros 19 (bbb13713, ChosenZero, dreaded369, fernando-barroso, iiKline, ImJustRicky, josenadajlpm-eng, llewy, mangopudding, martinsv, MRVAPORWAVE25, Narthic, Raccity007, rusoku2, stevenlandon, TonyDeLuca, vitalikarmanov, vushnjyov, vmsebas) | Idénticos a upstream | Nada. |

Conclusión: solo dos forks tienen código que nos interesa (jtmaveryk con el relanzamiento de Ryan, y "Radar" con la capa de reportes y voz), y los dos únicos intentos de recuperar Waze (el canal no oficial de Ryan y el sidecar de VMan228) son precisamente lo que conviene no copiar.

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
- Hilos de referencia: TMC "Discover codriver.io" (beta, ago-oct 2026, usuarios de EE. UU. probándolo en trayectos reales), TMC "TeslaWaze updates (was: TeslaWaze is Done!)", Club Tesla España (hilos 10457 y 10895: radares nativos poco fiables en radares de tramo, navegador usable en autovía), foro ABRP "Send route to Tesla". No pude revisar Reddit ni foros portugueses en esta sesión (los foros bloquean la lectura automatizada y se agotó la cuota de búsquedas); queda como hueco menor.

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

Cuerpos exactos (no los publica la doc oficial; salen de la librería de Teslemetry y de Home Assistant):

- `navigation_gps_request`: `{"lat": 38.72, "lon": -9.14, "order": 0}` (`order` = REPLACE/PREPEND/APPEND; Home Assistant lo retiró porque no observó efecto en un Model 3 Highland).
- `navigation_request`: `{"type": "share_ext_content_raw", "locale": "es-ES", "timestamp_ms": <epoch ms>, "value": {"android.intent.extra.TEXT": "<dirección, 'lat,lon' o URL>"}}`.
- `navigation_sc_request`: `{"id": <id de Supercharger>, "order": 0}`. `navigation_waypoints_request`: `{"waypoints": "<cadena sin documentar>"}`.

**Matiz crítico sobre la firma (verificado en el código del 15-oct-2026):**

- El proxy oficial `tesla-http-proxy` (`teslamotors/vehicle-command`, `pkg/proxy/command.go`) **no implementa** `navigation_gps_request`, `navigation_sc_request` ni `navigation_waypoints_request` como comandos firmados: responde `400 invalid_command`. Solo contempla `navigation_request`, y lo **reenvía sin firmar** al Fleet API ("sharing options require server-side processing"). El protobuf público de Tesla no contiene mensajes de navegación.
- `navigation_request` sin firmar **funciona hoy** (proyecto tesla-fleet-voice: 23 de 24 envíos con HTTP 200 entre el 3 y el 11-oct-2026, en Norteamérica; con el coche dormido Tesla lo despertó sola). Es la vía más simple: un POST desde tu backend con el token OAuth del usuario, sin proxy. Riesgo: Tesla podría cerrarla sin aviso.
- La vía **firmada** completa existe, pero fuera de Tesla: `Teslemetry/tesla-protocol` añade los mensajes `NavigationGpsRequest` (tag 53), `NavigationRequest` (21), `NavigationSuperchargerRequest` (22), `NavigationWaypointsRequest` (90) marcados `TESLEMETRY-EXT`, y `python-tesla-fleet-api` (Apache-2.0, v1.18.0, 13-oct-2026) los envía por `signed_command` o por BLE. Es lo que usa la integración oficial `tesla_fleet` de **Home Assistant** desde el 2-oct-2026 (`navigate_to_destination`, `navigate_to_coordinates`), probada en un Model 3 Highland 2024. Riesgo: si Tesla cambia el protobuf del coche, se rompe sin aviso.
- No hay prueba publicada específica en un Model 3/Y europeo en 2025-2026, pero sí de comandos firmados en coches europeos (addon de Home Assistant probado con Model 3 y Model Y 2023 en Europa). La inferencia "funciona en la UE" es razonable, no verificada.
- Requisitos comunes: scope `vehicle_cmds`; para la vía firmada y para la telemetría, *virtual key* emparejada desde la app de Tesla del propietario (≥ 4.27.3; cuentas "conductor" necesitan keycard). El coche debe estar despierto (`408` si duerme; `wake_up` cuesta 0,02 $ y tarda 10-60 s). En tu caso de uso el coche está despierto: **0,001 $ por envío**. Límites por coche: 20 llaves, 5 apps de telemetría, 3 dispositivos BLE.

Opciones de implementación, de más simple a más robusta: (1) `navigation_request` sin firmar desde Next.js; (2) un microservicio Python con `python-tesla-fleet-api` (`VehicleSigned`) para `navigation_gps_request` firmado; (3) delegar en Tessie (`POST /{vin}/command/share`, 6,99 $/mes por usuario) o Teslemetry (~3,17 €/mes por coche), con la llave virtual de ellos, no la tuya.

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
| 20.000 usuarios, solo enviar destinos (1-2/día), GPS del navegador, sin comprobar estado antes | ~600-1.200 $ |
| 20.000 usuarios + telemetría "solo ruta" (destino, RouteLine, ETA; sin Location a 1 s) | +800-2.000 $ |
| 20.000 usuarios comprobando `fleet_status`/`vehicles` antes de cada envío | +2.400-4.800 $ (evitable: el comando rechazado cuesta la mitad que la comprobación) |
| 20.000 usuarios con telemetría "rica" (Location, velocidad, rumbo a 1 s) | +20.000-48.000 $ (innecesario: el navegador ya da el GPS) |
| 20.000 usuarios si cada envío despierta el coche | +12.000-24.000 $ |
| 20.000 usuarios con *polling* de `vehicle_data` | ~144.000 $ (inviable) |

Lectura: con buen diseño (sin wakes, sin comprobaciones previas, telemetría mínima o ninguna) una app pública cuesta del orden de 1.400-3.200 $/mes a 20.000 usuarios; con mal diseño, decenas de miles. Delegar en Teslemetry (~63.000 €/mes a esa escala) o Tessie (~140.000 $/mes) solo tiene sentido para uso personal o prototipos.

### 4.5 Términos (Fleet API Agreement, versión 21-mar-2025; contraparte Tesla Motors Netherlands B.V.)

- Permite apps para usuarios que envían comandos o leen datos.
- Prohíbe: revender o ceder datos (§5.6.7); competir o **interferir con servicios actuales o previstos de Tesla** (§5.6.21, lista abierta: robotaxi, carga gestionada, VPP…); control automático del vehículo (§5.6.22); usar vías distintas de la API oficial (§5.6.28, adiós a la Owner API no oficial).
- Tesla puede suspender o terminar sin preaviso (§10.2.1).
- GDPR: tú eres responsable independiente; geolocalización precisa exige **consentimiento opt-in explícito**, indicador visible, consentimiento por categoría, revocación, y borrado en 30 días (§9.3.5-9.3.10).
- Zona gris real: una app de navegación/radares podría considerarse "competir con" la navegación de Tesla. No hay precedente público de baneo por esto, y codriver lleva meses operando como app registrada, pero conviene asumirlo como riesgo.
- Desde mayo de 2025 el propietario ve en la app de Tesla cuántos comandos envía cada app de terceros.

### 4.6 Cómo lo hacen los terceros (oct-2026)

| App | ¿Envía destino? | Vía | UE | Coste |
|---|---|---|---|---|
| App oficial de Tesla | Sí: Location > Navigate > "Send to Car" (app ≥ 4.57.0, 2026.20) y hoja de compartir desde Google/Apple Maps; multi-parada | Backend de Tesla | Sí | Gratis |
| Tessie | Sí: `POST /{vin}/command/share?value=` (dirección, lat/lon o URL) y passthrough de cualquier endpoint Fleet API con firma automática | Fleet API (app de Tessie) | Sí (NA/EU/CN) | 6,99 $/mes, tarifas de Tesla incluidas |
| Teslemetry | Sí: `navigation_gps_request` y `navigation_request` firmados; acción `teslemetry.navigation_gps_request` en Home Assistant; BLE beta | Fleet API firmado (extensiones TESLEMETRY-EXT) | Sí | ~3,17 €/mes por coche; 1 crédito por comando, 20 por wake |
| Home Assistant `tesla_fleet` (app propia) | Sí desde 2-oct-2026 (`navigate_to_destination`, `navigate_to_coordinates`) | Tu propia app Fleet API + `python-tesla-fleet-api` | Sí | Tarifas de Tesla (crédito 10 $) |
| ABRP | Sí ("Send to Tesla"), un solo waypoint, falla en algunos modelos | App Fleet API propia (llave `abetterrouteplanner.com`) | Sí | ABRP Premium |
| codriver.io | **No** (solo lee destino y ruta) | Fleet Telemetry | Probable | Gratis / 6 $/mes |
| TeslaMate, TeslaFi, Tronity | No | — | — | — |

Para probar en tu coche sin registrar app: Teslemetry o Tessie. Para una app pública no sirven: cada usuario tendría que pagar su proxy y el Agreement impide revender el acceso.

---

## 5. Datos de alertas y radares

### 5.1 Alertas tipo Waze (policía, accidentes, atascos): qué se puede usar legalmente

**Waze, en todas sus formas, está descartado:**

- El endpoint `georss` devuelve 403 a clientes automatizados desde el 19-mar-2026 por un WAF con reCAPTCHA Enterprise, con independencia de IP, cabeceras o huella TLS (issue guberm/waze-alerts-monitor #1; README de KaraZajac/OVERWATCH). En sep-oct 2026 Waze también cerró el endpoint de routing que usaban pywaze y Home Assistant, y hasta usuarios legítimos del Live Map sufren 403 que Waze "sigue investigando" (foro Waze, último mensaje de staff 6-oct-2026).
- Los Términos de Uso de Waze (modificados 8-jul-2026, vigentes desde 1-ago-2026) prohíben el acceso automatizado, la descarga masiva, el uso comercial y la integración en otro producto sin consentimiento escrito.
- **Waze for Cities** (el canal oficial) solo admite administraciones públicas y operadores de carretera que aporten datos propios; su licencia prohíbe crear "un producto que haga funciones iguales o similares a Waze (por ejemplo, una app de navegación)" y ceder datos a terceros. Y su feed **no incluye el tipo POLICE** (solo ACCIDENT, JAM, HAZARD, MISC, CONSTRUCTION, ROAD_CLOSED).
- Los "Waze API" de marketplaces (OpenWeb Ninja, ~0,005 $/petición, ~20 min de retraso; Zyla) no declaran licencia: con toda probabilidad son scraping revendido y heredan el mismo riesgo de corte. Es la hipótesis más plausible para la capa "Waze" de codriver, que muestra policía con `reliability`/`thumbs_up`, campos que el canal legal no entrega. No es un camino a copiar.

**Lo que sí se puede usar:**

| Fuente | Cobertura | Coste | Latencia | ¿Policía? | Notas |
|---|---|---|---|---|---|
| **DGT, NAP DATEX II v3.6/3.7** (`nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml`) | España salvo País Vasco y Cataluña | Gratis, sin registro | 1 min | No | Verificado hoy: 857 situaciones activas (602 obras, 252 cortes de carril, 129 de calzada, 118 tráfico lento, 56 objetos en calzada, 35 accidentes, 30 cortes, 25 desprendimientos, niebla, inundaciones). Obligación legal europea (Reglamento 2022/670), muy estable. Confirmar por escrito el uso comercial con nap@dgt.es. |
| **Servei Català de Trànsit** (RSS/GML `gencat.cat/transit/opendata/incidenciesRSS.xml`) | Cataluña | Gratis | Continua | No | 216 incidencias hoy; reutilización con atribución. Coordenadas en la versión GML. |
| Euskadi (DT-GV, en el NAP) | País Vasco | Gratis | n/d | No | Licencia sin aclarar. |
| **Infraestruturas de Portugal / NAP portugués** (nap-portugal.imt-ip.pt) | Portugal | Gratis (presumible) | n/d | No | Punto débil: la web de IP excluye el uso comercial y el NAP exige registro y solicitud de acceso; el agregador transitoagora.pt confirma que existe una fuente máquina-legible. Pedir acceso; mientras tanto, TomTom para Portugal. |
| **TomTom Traffic Incidents** | España y Portugal | 2.500 peticiones de detalle/mes gratis; 200.000 tiles de incidentes y flujo/mes; ~0,75 €/1.000 después | ~1 min | No | 13 categorías (accidente, atasco, obras, cortes, vehículo averiado, niebla, hielo, inundación…). Refresco por minuto. |
| HERE Traffic v7 | 70+ países | Free tier no publicado | 2 min | No | 11 tipos; precio solo con cuenta. |
| Mapbox Directions `driving-traffic` | "Geografías soportadas" | Incluido en Directions | n/d | No | Devuelve `incidents[]` a lo largo de la ruta; cobertura ibérica por comprobar. |
| Google Routes | — | — | — | No expone incidentes | Solo densidad de tráfico y peajes. |
| Radarbot SDK | Mundial | Sin precio público; solo partners "de alto potencial" | Tiempo real | Sí en la app (SDK por confirmar) | SocialDrive y Flitsmeister no ofrecen API; Coyote sin verificar. |
| **Reportes comunitarios propios** | Donde haya usuarios | Infraestructura propia | Segundos | **Sí** | La única fuente legal de avisos de policía además de un acuerdo con una app comunitaria. |

**Conclusión:** ninguna fuente legal entrega avisos de policía. Arquitectura híbrida recomendada: (i) DGT + SCT (+ IP cuando se consiga acceso) como capa base gratuita y estable; (ii) TomTom para Portugal y vías no estatales; (iii) capa comunitaria propia para policía, con el modelo de codriver (reporte con un toque, confirmación al pasar a ~80 m, caducidad corta, ponderación por confianza del reportero) y sembrando el mapa con los feeds oficiales para que nunca esté vacío; (iv) opcionalmente el SDK de Radarbot si aceptan la alianza.

Fuentes: github.com/guberm/waze-alerts-monitor/issues/1; github.com/KaraZajac/OVERWATCH; github.com/home-assistant/core/issues/183802; github.com/eifinger/pywaze/issues/110; support.google.com/waze/answer/12373727 (ToU); support.google.com/waze/partners/answer/10453062 y /13458165 (Waze for Cities y especificación del feed); docs.tomtom.com/pricing y traffic-api; docs.here.com/traffic-api; docs.mapbox.com/api/navigation/directions; nap.dgt.es; transit.gencat.cat; infraestruturasdeportugal.pt (termos); transitoagora.pt; radarbot.com/desarrolladores; BOE DOUE L122/2022 (Reglamento 2022/670).

### 5.2 Radares: fuentes de datos (verificado el 15-oct-2026, ficheros descargados y analizados)

| Fuente | Cobertura | Formato | Coordenadas | Licencia | Notas |
|---|---|---|---|---|---|
| **DGT, NAP "Radares fijos DGT"** (nap.dgt.es → `/datex2/dgt/PredefinedLocationsPublication/radares/content.xml`) | España, red estatal (sin Cataluña ni País Vasco) | DATEX II XML (2 MB) | **Sí**: 690 cabinas (lat/lon, carretera, PK, sentido, provincia) + 47 tramos de velocidad media (inicio/fin) | **CC-BY**, sin token | `publicationTime` 18-dic-2025: va ~8 meses por detrás del PDF. |
| DGT, PDF "Puntos y tramos de control de velocidad" (dgt.es) | España, red estatal | PDF 32 págs., 03-ago-2026 | No (carretera + PK + sentido) | No declarada | 707 radares fijos, 126 de tramo, **1.325 tramos de radar móvil**. Es la fuente más fresca; hay que extraer la tabla y georreferenciar por PK. |
| Servei Català de Trànsit, `radars.txt` (transparenciacatalunya.cat) | Cataluña | TXT, diario | Sí (UTM 31N ETRS89) | Datos abiertos Generalitat | ~247 filas; sin sentido. |
| **ANSR / radaresavista.pt** (Portugal) | Red nacional SINCRO | PDF (jul-2026): 100 de velocidad instantánea + 23 de media | No (km) | Propiedad ANSR, sin licencia abierta | El mapa del sitio carga un JSON interno con **coordenadas de 121 locales** (ago-2025), pero sus términos prohíben reproducirlo sin autorización escrita: **pedir permiso a la ANSR** antes de usarlo. |
| Município de Lisboa (dados.gov.pt) | Lisboa | Dataset abierto | Por verificar | CC0 | Radares municipales. |
| PSP, listas mensuales de radares móviles | Portugal | Noticias/PDF | No | — | Publicadas hasta abril de 2026; una fuente afirma que el programa se canceló en mayo de 2026. La GNR no publica. |
| Ministère de l'Intérieur (data.gouv.fr) | Francia | CSV | Sí (~3.400 radares, tipo, velocidad) | Licence Ouverte 2.0 | Actualizado 30-dic-2025. Modelo a seguir. |
| MIT Italia (velox.mit.gov.it) | Italia | Tabla web | No | Pública sin descarga | 3.625 dispositivos (nov-2025). |
| **OpenStreetMap** | Mundial | PBF / GeoJSON | Sí | ODbL | `highway=speed_camera`: 2.493 nodos en España (89 % con `maxspeed`, 61 % con `direction`), 301 en Portugal, ~35.400 en 28 países europeos; relaciones `enforcement`: 2.630 en España, 174 en Portugal. Más completo que las listas oficiales (incluye municipales y semafóricos) pero sin garantía de frescura. Importar el dataset DGT a OSM está bloqueado por la licencia; **fusionarlo en tu app sí es viable** con atribución. |
| SCDB.info (misma empresa que Blitzer.de/CamSam) | 113 países | CSV/GPX/JSON/KML/OV2 | Sí | Propietaria | 9,95 €/12 meses para particulares; licencia B2B bajo solicitud sin precio público. |
| TomTom Speed Camera Services / HERE `SAFETY_ALERTS` / Radarbot SDK | Mundial | API/feed/SDK | Sí | Propietaria | Precio bajo contrato; TomTom solo opera donde es legal (en Francia solo "zonas de peligro"); Radarbot solo para partners seleccionados. |
| todo-poi.es, lufop.net | ES/PT | POI por dispositivo | Sí | Sin licencia declarada | Origen opaco; no redistribuir. |

Reino Unido, Alemania, Países Bajos y Bélgica no tienen dataset nacional geolocalizado. Referencia open source útil: `GeiserX/radares-anunciados` (GPL-3), que fusiona DGT + listas policiales + OSM con atribución.

**Recomendación técnica:** dejar de consultar Overpass en vivo y generar un **GeoJSON estático** de cámaras: `osmium tags-filter europe-latest.osm.pbf n/highway=speed_camera` + `osmium export` (≈9-13 MB para Europa sin comprimir, <1 MB para España y Portugal), fusionado con el DATEX II de la DGT, el TXT catalán y el CSV francés; refresco diario o semanal; servido desde CDN con ETag. Publicar esa base derivada bajo ODbL y atribuir a OSM, DGT y Ministère de l'Intérieur.

### 5.3 Legalidad de las apps que avisan de radares (no detectores)

| País | Apps de aviso | Norma | Sanción por detectores/inhibidores | Confianza |
|---|---|---|---|---|
| **España** | **Legal.** El art. 13.6 de la Ley de Tráfico (RDL 6/2015, red. Ley 18/2021) excluye expresamente "los mecanismos de aviso que informan de la posición de los sistemas de vigilancia"; el nuevo art. 18.3 del RGC (RD 518/2026, en vigor 1-oct-2026) repite el texto. | Art. 13.6 LTSV; art. 18.3 RGC | Detector: 200 € y 3 puntos (art. 76.g); inhibidor: 6.000 € y 6 puntos (art. 77.h); instalarlo: 3.000-20.000 € | Alta |
| **Portugal** | **Legal** en la práctica y por la lectura del precepto (prohíbe aparatos que *revelan la presencia* o *perturban* los cinemómetros, no listas de posiciones); la propia ANSR publica el mapa y la PSP publicó listas. Sin aclaración oficial sobre apps. | Art. 84.º n.º 3 y 5 Código da Estrada; DL 70/95 | 500-2.500 € y pérdida del aparato | Media |
| Francia | Solo "zonas de peligro"; la posición exacta está prohibida | Art. R413-15 Code de la route | Hasta 1.500 €, 6 puntos, confiscación | Media-alta |
| Alemania | Prohibido que el **conductor** use la función en marcha | §23 Abs. 1c StVO | 75 € y 1 punto | Alta |
| Italia | Zona gris: apps toleradas, dispositivos localizadores prohibidos | Art. 45 c. 9-bis CdS | 825-3.305 € | Media |
| Suiza | **Prohibido**, incluidas apps y servicios de aviso | Art. 98a LCR | Multa, confiscación | Alta |
| Reino Unido | Legal (la prohibición de 2006 nunca entró en vigor) | Road Safety Act 2006 s.18 | — | Alta |

**Sobre la noticia "la UE prepara multas para apps de radares"** (pplware, 27-jun-2026): es engañosa. Se refiere a la sentencia de la Gran Sala del TJUE de 16-jun-2026 (asuntos C-188/24 y C-190/24, Coyote c. Francia), que solo dice que un Estado puede prohibir a un servicio de navegación establecido en otro Estado retransmitir avisos de **determinados controles policiales**, cumpliendo la Directiva 2000/31. No habla de radares fijos ni crea sanciones; no existe iniciativa legislativa de la UE.

**Implicación de diseño:** geocercar el comportamiento por país (ocultar radares en Suiza, mostrar solo zonas en Francia, aviso de no uso en marcha en Alemania) y, en Francia, cuidado también con los avisos de policía.

Fuentes: nap.dgt.es/dataset/radares-fijos-dgt; dgt.es "Equipos y tramos de vigilancia" (PDF 20260803); analisi.transparenciacatalunya.cat (re3y-fftf); radaresavista.pt (PDF y términos); dados.gov.pt (Lisboa); data.gouv.fr "liste-des-radars-fixes-en-france"; velox.mit.gov.it; taginfo (14/15-oct-2026); community.openstreetmap.org (hilo 127051); scdb.info; tomtom.com/products/speed-camera-data; boe.es (RDL 6/2015 consolidado; RD 518/2026); curia.europa.eu (comunicado 87/26); fedlex (LCR art. 98a); dejure.org (§23 StVO).

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

0. **Punto de partida:** no arrancar desde `main` (la versión muerta) sino desde la rama del relanzamiento de Ryan (`fork-jtmaveryk-teslanav/feature/billboards`, ya en tu clon), que trae hechos MapLibre + OpenFreeMap, Docker autocontenido, reportes con confirmaciones y votos, importador de radares y tema solar. Quitar su capa de Waze no oficial y el relay, y mantener el resto. Si se prefiere Vercel en lugar de Docker, portar solo `components/Map.tsx`, `lib/map-styles.ts`, `/api/reports` y `lib/speed-cameras.ts`.
1. Limpiar el modo shutdown (si se parte de `main`: `NEXT_PUBLIC_PROJECT_SHUTDOWN=false`).
2. Mapa: **MapLibre GL** con tiles de **OpenFreeMap** (o PMTiles propios en R2 si se quiere independencia total); satélite con ArcGIS Location Platform y API key si la app no es solo personal. Eliminar el proxy de tiles de Vercel Blob.
3. Radares: generar un GeoJSON estático **OSM + DGT (DATEX II) + ANSR**, servido desde `/public` o CDN; eliminar la dependencia de Overpass en vivo. Añadir radares de tramo con sus dos extremos.
4. Alertas: portar el sistema de **reportes comunitarios** (el fork "Radar" ya tiene tipos, votos y expiración; el PR #11 tiene velocidad y límite). Para uso personal se puede añadir la capa de codriver vía su API pública mientras no sea comercial.
5. Voz y avisos: reutilizar `alert-sound.mp3` y añadir **clips pregrabados** en español/portugués (el navegador del Tesla no tiene voces de síntesis), con un toque inicial para desbloquear el audio; umbral por distancia y rumbo como ya hace `isAlertAhead`.
7. Compatibilidad 2026.26+: detectar el coche por pantalla/GPU en vez del User-Agent, tratar `devicePixelRatio` como variable, revisar el umbral de 768 px del aviso "mobile" y probar con el bloqueador de anuncios activado.
6. Localización ES/PT y unidades métricas.

Coste mensual: ≈ 0 (Vercel hobby + Upstash free + OpenFreeMap).

### Fase B — Conectar la API de Tesla (2-4 semanas más)

1. Alta en developer.tesla.com con tu dominio, clave pública en `/.well-known/...`, registro en la región EU.
2. Reutilizar del **PR #10** de upstream: OAuth de Tesla, `ConnectFlow` con QR desde el coche, almacenamiento cifrado de tokens, `docker-compose` con `vehicle-command`.
3. Añadir lo que falta: ruta `/api/tesla/navigate` que, cuando el usuario elige un destino en la búsqueda o con pulsación larga, envíe `navigation_request` (`share_ext_content_raw` con `"lat,lon"` o la dirección) con el token OAuth del usuario. Es un POST sin proxy y funciona hoy. Si Tesla lo cierra o se quiere `navigation_gps_request` con `order`, añadir un microservicio Python con `python-tesla-fleet-api` (`VehicleSigned`) que firme con la clave privada de la app (el proxy oficial `vehicle-command` no sirve para estos comandos). Resultado: **buscas en tu app y el Tesla navega con su navegador nativo** (con Autopilot/FSD, planificación de carga, etc.).
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
2b. **Fragilidad del envío de destinos:** la vía sin firmar depende de que Tesla siga procesando `navigation_request` en su backend; la vía firmada depende de extensiones del protobuf que Tesla no publica (TESLEMETRY-EXT). Ninguna de las dos tiene garantía; ambas funcionan en octubre de 2026.
3. Cambios de firmware que rompen webapps (como el de 2026.26). Mitigación: pruebas tras cada release.
4. Arranque en frío de los reportes comunitarios. Mitigación: sembrar el mapa con DGT/SCT/TomTom y radares oficiales desde el primer día.
4b. **Tentación de reutilizar la capa Waze del relanzamiento:** funciona hoy en España y Portugal, pero es un canal no oficial contrario a los términos de Waze y puede cortarse sin aviso, como pasó en marzo. Si se usa, que sea en una instancia personal y con la app preparada para vivir sin ella.
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
