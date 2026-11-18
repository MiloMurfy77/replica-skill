# Arquitectura: Clipper (nombre provisional) — clon de la función "long to shorts" de Opus Clip / Choppity

Basado en `replica/recon.md` y `replica/features.csv`. Código en `clipper/`.

## Stack

| capa | elección | por qué |
| --- | --- | --- |
| web + API | Next.js 15 (App Router) + TypeScript | un solo proyecto para páginas y endpoints; despliegue trivial |
| estilos | Tailwind CSS | rápido; los tokens llegan con /replica-design |
| base de datos | Postgres 16 (Neon o Supabase en prod, local en dev) | una sola base para datos **y** cola de trabajos |
| acceso a datos (web) | `postgres` (porsager), SQL a mano | el esquema es pequeño; sin capa ORM que aprender |
| auth | propia: email + contraseña (scrypt) + cookie de sesión httpOnly | cero dependencias externas para el MVP; Google OAuth después |
| cola de trabajos | tabla `tasks` + `SELECT … FOR UPDATE SKIP LOCKED` | sin Redis ni servicios extra; reintentos y bloqueo seguros |
| worker de vídeo | Python 3 + ffmpeg (libass) + OpenCV | el ecosistema de vídeo/visión está en Python |
| transcripción | `faster-whisper` local (dev) / Deepgram (prod) | timestamps por palabra; Deepgram es rápido y diariza |
| selección de clips | API de Claude (`claude-opus-5-5`, salida estructurada JSON) | elige momentos y puntúa; si no hay clave, heurística local |
| reencuadre | detector de caras de OpenCV (YuNet, con Haar de respaldo) + energía de labios | encuentra a quien habla sin modelos de pago |
| subtítulos | archivo ASS generado + filtro `subtitles` de ffmpeg | animación palabra a palabra con calidad de render real |
| archivos | disco local (`STORAGE_DIR`) en dev; Cloudflare R2 (S3) en prod | R2 no cobra salida de datos, clave para vídeo |
| pagos | ninguno (decisión del proyecto) | uso libre; solo se registran los minutos analizados |
| email | Resend (hito 2): "tus clips están listos" | |
| hosting | web en Vercel; worker en una máquina con CPU/GPU (Fly.io, Hetzner o Modal) | el worker necesita ffmpeg y minutos de CPU largos |

Un solo Postgres, un web y un tipo de worker. Nada de microservicios.

## Esquema

Tablas: 8 en el MVP (`users`, `sessions`, `sources`, `transcripts`, `jobs`, `clips`, `renders`, `tasks`) + `usage_ledger`. Ver `clipper/db/migrations/001_init.sql`.

Reglas de acceso: **comprobaciones en la capa de datos**. Cada consulta del web filtra por `user_id` de la sesión (`clipper/web/lib/data.ts`); el worker es de confianza y solo toca filas por id de tarea.

Restricciones duras:
- `clips.end_s > clips.start_s`.
- El uso de un análisis se registra una sola vez: `usage_ledger` tiene `unique (job_id, reason)`.
- Una tarea solo la toma un worker: `FOR UPDATE SKIP LOCKED` + `locked_until` (si un worker muere, la tarea vuelve a la cola).

## API

| método ruta | hace | quién | entrada | salida | flujo |
| --- | --- | --- | --- | --- | --- |
| POST /api/auth/signup | crea usuario + sesión | público | email, password | cookie | — |
| POST /api/auth/login | abre sesión | público | email, password | cookie | — |
| POST /api/auth/logout | cierra sesión | usuario | — | — | — |
| POST /api/sources | sube un vídeo (stream a disco) | usuario | binario + `x-filename` | `{id}` | F01 |
| POST /api/sources/url | importa un MP4 público por URL | usuario | `{url}` | `{id}` | F01 |
| POST /api/jobs | lanza análisis con ajustes | usuario dueño de la fuente | `{source_id, target_len, aspect, caption_style, prompt, range}` | `{id}` | F01, F02 |
| GET /api/jobs/:id | estado + progreso + clips | dueño | — | job + clips | F01 (sondeo) |
| PATCH /api/clips/:id | like/dislike/estrella, recorte, estilo, layout, título | dueño | parcial | clip | F03, F04 |
| POST /api/clips/:id/render | encola render MP4 | dueño | — | `{render_id}` | F05 |
| GET /api/renders/:id | estado del render | dueño | — | render | F05 |
| GET /api/files/:kind/:id | sirve preview/descarga con comprobación de dueño | dueño | — | vídeo (Range) | F05 |

Trabajos (tabla `tasks`): `ingest` (ffprobe/validación), `analyze` (transcribir → elegir → reencuadrar → render de previews), `render` (MP4 final). Limpieza diaria de fuentes caducadas (hito 2).

## Lo que muerde

- **Archivos grandes:** subida en streaming (nunca a memoria); en prod, subida directa a R2 con URL prefirmada multipart.
- **Idempotencia:** las tareas pueden ejecutarse dos veces si un worker muere; cada paso escribe con `on conflict` o borra y rehace lo suyo; el cobro va en el ledger con clave única.
- **Carreras:** el usuario edita un clip mientras se renderiza → el render guarda `clip_version` y la UI avisa si quedó viejo.
- **Coste de IA:** la transcripción se guarda una vez por fuente; los reprompts reutilizan transcript y la caché de prompt de Claude (transcripción al principio del prompt, petición variable al final).
- **Límites de tasa:** reintentos con backoff en Claude/Deepgram (el SDK ya reintenta 429/5xx).
- **Seguridad:** importar por URL solo `https`, sin IPs privadas (SSRF), tamaño máximo; ffmpeg se llama con lista de argumentos, nunca por shell.
- **Derechos:** no se descarga de YouTube (ToS); subida o enlace directo a MP4.
- **Borrado (RGPD):** borrar usuario borra en cascada filas y archivos.

## Orden de construcción

1. **Rebanada vertical (este hito):** registro → subir vídeo (S04) → ajustes (S05) → progreso (S06) → lista de clips con score (S07) → descarga MP4 (S09). Tablas: todas las del MVP. Rutas: auth, sources, jobs, clips, renders, files.
2. **Must restantes:** edición del texto de subtítulos (S08), email de aviso. Sin pagos (S14/S15 fuera).
3. **Should:** reprompt, edición por transcripción, layouts split/screenshare, quitar muletillas, plantillas de marca, descarga en lote, SRT, publicación en YouTube/TikTok/IG.
4. **Arreglos** que encuentre /replica-entrepreneur.
