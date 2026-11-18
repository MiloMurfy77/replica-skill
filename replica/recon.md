# Recon map: Opus Clip + Choppity — "Long to shorts" (web)

Alcance: SOLO la herramienta que convierte un vídeo largo (podcast, entrevista, webinar, stream) en decenas de clips verticales listos para publicar: subtítulos animados, reencuadre 9:16 siguiendo al que habla, título/hashtags, puntuación viral, editor ligero y exportación. Fuera de alcance: screen recorder, Ideas board, analytics, editor de vídeo en blanco, Agent Opus, dubbing.
Para: (supuesto, confírmalo) producto SaaS propio para creadores / agencias de contenido hispanohablantes.
Fecha: 2026-11-18
Método: solo fuentes públicas (help centers, pricing, páginas de producto, reviews). Sin cuenta, sin bundles JS, sin APIs privadas.

## Fuentes

| # | fuente | URL | notas |
| --- | --- | --- | --- |
| 1 | Opus help center (índice) | https://help.opus.pro/ | lista completa de artículos del editor |
| 2 | Opus: cómo usar ClipAnything | https://help.opus.pro/docs/article/how-to-use-clipanything.md | modelo, género, prompt, captions |
| 3 | Opus: fuentes soportadas | https://help.opus.pro/docs/article/video-sources-supported.md | YouTube, Drive, Zoom, Vimeo, Twitch… |
| 4 | Opus: duración máxima | https://help.opus.pro/docs/article/video-length.md | hasta 10 h |
| 5 | Opus: página de resultados | https://help.opus.pro/docs/article/get-clips-faq-1 | like/dislike, ordenar, reprompt |
| 6 | Opus: programar clips | https://help.opus.pro/docs/article/schedule-clips.md | calendario |
| 7 | Opus: export XML a Premiere | https://help.opus.pro/docs/article/import-to-adobe-premiere.md | zip con XML+SRT+raw |
| 8 | Opus: planes y créditos | https://help.opus.pro/docs/article/plans-and-credits.md | 1 crédito = 1 min de fuente |
| 9 | Opus: keywords | https://help.opus.pro/docs/article/select-keywords.md | ClipBasic |
| 10 | Opus pricing | https://www.opus.pro/pricing | tabla de gates por plan |
| 11 | Opus ClipAnything | https://www.opus.pro/clipanything | pitch multimodal |
| 12 | Choppity help (índice) | https://help.choppity.com/ | |
| 13 | Choppity: generar clips paso a paso | https://help.choppity.com/articles/0376723-generating-clips-step-by-step | flujo core |
| 14 | Choppity: tour del dashboard | https://help.choppity.com/articles/0833676-a-tour-of-the-choppity-dashboard | rutas y navegación |
| 15 | Choppity: editor | https://help.choppity.com/articles/2881707-the-choppity-editor-an-overview-of-the-interface | layout editor |
| 16 | Choppity: guardar/exportar | https://help.choppity.com/articles/2555543-saving-previewing-and-exporting-your-edits | |
| 17 | Choppity: duración de clip | https://help.choppity.com/articles/2996326-choosing-target-clip-duration-15s-30s-60s | 15 s–3 min, default 60 s |
| 18 | Choppity: límites de archivo | https://help.choppity.com/articles/7590915-maximum-file-size-and-video-length-limits-per-plan | 4 GB, 3 h |
| 19 | Choppity: cuotas | https://help.choppity.com/articles/7642282-quotas-uploads-render-minutes-and-clips-per-month | horas de análisis |
| 20 | Choppity: qué plan | https://help.choppity.com/articles/0295996-which-plan-is-right-for-me-free-starter-pro-and | tabla de planes |
| 21 | Review Opus (TheCMO) | https://thecmo.com/tools/opusclip-review/ | virality 0–99 (hook, flow, value, trend) |
| 22 | Pricing Opus 2026 (eesel) | https://eesel.ai/blog/opusclip-pricing | ~0,10 $/min |

## Core loop

Pegas un enlace o subes un vídeo largo → eliges duración/formato/estilo de subtítulos → la IA devuelve 10–50 clips verticales ya subtitulados, reencuadrados y ordenados por "viralidad" → revisas, retocas y descargas/programas.

## Cómo funciona por dentro (ingeniería inversa del pipeline)

Inferido de las funciones públicas y de cómo se comportan (límites, cobro por minuto, export XML). Esto es lo que hay que construir; el UI es fino encima.

```
1 INGESTA       upload directo a storage (presigned/multipart) | URL → yt-dlp/worker de import
                ffprobe: duración, resolución, fps → valida contra plan → descuenta minutos
2 PROXY         ffmpeg: audio 16 kHz mono + proxy 720p para análisis/preview
3 ASR           transcripción con timestamps por PALABRA + diarización (quién habla)
                (Whisper-large/WhisperX, Deepgram, AssemblyAI). 97+ idiomas.
4 ESCENAS       detección de cortes (PySceneDetect) + muestreo de frames 1–2 fps
5 SELECCIÓN     LLM sobre la transcripción en ventanas (chunks con solape):
  ("ClipBasic")   - propone segmentos [inicio,fin] de duración objetivo (p.ej. 30–90 s)
                  - que empiecen con gancho y terminen en frase completa
                  - respeta prompt del usuario ("todos los momentos donde habla de X")
  ("ClipAnything") + descripciones visuales de frames (VLM) y señales de audio
                  (risas, aplausos, picos de energía) para vídeo con poco diálogo
                ajuste fino: snap a límites de palabra/silencio, dedupe de solapes
6 SCORING       LLM puntúa cada clip 0–99 con sub-scores (hook, flow, value, trend)
                + genera título, descripción, hashtags, gancho de texto (auto hook)
7 REENCUADRE    detección de caras (MediaPipe/RetinaFace) + active speaker detection
                (labios en movimiento ↔ diarización) → trayectoria de crop 9:16
                suavizada (filtro Kalman/EMA); layouts: fill, fit+blur, split 2 hablantes,
                screenshare (pantalla arriba, cara abajo); tracking de objetos (Pro)
8 PALABRAS      keywords a resaltar + emojis (LLM), relleno/silencios ("um", pausas)
                marcados para quitar, palabrotas a censurar (pitido/asteriscos)
9 COMPOSICIÓN   un "clip" es un JSON de edición (timeline): segmentos fuente, crop por
                keyframe, pistas de subtítulos con estilo, overlays, B-roll, música
10 RENDER       bajo demanda (preview / descarga): ffmpeg o Remotion/MLT en workers;
                subtítulos animados quemados (ASS/libass o render de frames) → MP4 1080x1920
11 SALIDA       MP4, SRT, XML (FCPXML/Premiere) con segmentos+crop, publicación vía
                APIs oficiales (YouTube, TikTok, IG, LinkedIn…)
```

Clave de arquitectura: el análisis (pasos 1–8) es caro y se hace una vez por fuente; el clip es solo un documento JSON editable; el render es otro job barato y repetible. Por eso Opus cobra por minuto de fuente y Choppity por "horas de análisis" + "minutos de render".

## Pantallas

| ID | pantalla | ruta / cómo se llega | propósito | componentes clave | estados vistos |
| --- | --- | --- | --- | --- | --- |
| S01 | Landing + "pega tu enlace" | `/` (público) | captar: pegar URL sin registrarse | input URL, botón "Get clips", social proof | vacío, URL inválida |
| S02 | Login / registro | `/auth` | email + Google | form, OAuth | error, magic link enviado |
| S03 | Home / proyectos | `/projects` | lista de vídeos fuente procesados | grid/lista, chip de uso (minutos restantes), toggle grid/list | vacío (primer uso), procesando, lleno |
| S04 | Nuevo proyecto: fuente | `/projects/new` o panel en Home | subir archivo, pegar link, elegir existente | dropzone, input URL, tabs Nuevo/Existente, barra de subida | subiendo %, importando URL, error formato/tamaño, límite de plan |
| S05 | Ajustes de clipping | paso 2 tras fuente | configurar generación | modelo (Basic/Anything), género, duración (15 s–3 min, presets 30/45/60/90/120; Opus: 0–1m,1–3m,3–5m…), rango de tiempo (timeframe slider sobre la línea del vídeo), prompt opcional, aspect ratio 9:16/1:1/16:9, estilo de subtítulos (presets / ninguno), plantilla de marca, auto hook, idioma, coste estimado en minutos | por defecto, prompt vacío, plan insuficiente (candado), sin minutos |
| S06 | Procesando | proyecto con banner | esperar el análisis | barra de progreso por etapas (subida → transcripción → análisis → clips), ETA, aviso por email | en cola, en progreso, fallo, atascado |
| S07 | Resultados (lista de clips) | `/projects/:id` | revisar los N clips | tarjetas con preview vertical, score 0–99 + sub-scores, título, transcripción, like/dislike/estrella, ordenar (score/cronológico), filtrar, reprompt, seleccionar varios, descargar/exportar en lote | procesando parcial (aparecen poco a poco), lleno, 0 clips encontrados, disliked ocultos |
| S08 | Editor de clip | `/clips/:id/edit` | retocar un clip | player 9:16, panel transcripción editable (borrar palabra = cortar), timeline (vídeo, subtítulos, música, overlays), trim/extender, layout/reencuadre, estilo de subtítulos, keywords/emoji, quitar muletillas/silencios, B-roll, texto, música, undo/redo, guardar | guardando/guardado, render preview, error |
| S09 | Modal exportar | botón Download en S07/S08 | renderizar y bajar | resolución (720/1080/4K), MP4/XML/SRT, progreso en botón, "Done" | renderizando %, listo, bloqueado (free → upgrade), marca de agua |
| S10 | Publicar / programar | botón "Post or schedule" | enviar a redes | cuentas conectadas, título/desc/hashtags generados, fecha-hora, por plataforma | sin cuentas, programado, error de API |
| S11 | Calendario | `/calendar` | ver posts programados | vista mes/semana, arrastrar, eliminar | vacío, lleno |
| S12 | Plantillas de marca | `/templates` | estilo guardado aplicado a todos los clips | fuente (subir custom), colores, posición/tamaño subtítulos, logo/marca de agua, intro/outro, layout por defecto | vacío, límite de plantillas |
| S13 | Cuentas sociales | `/social-profiles` | conectar TikTok, YT, IG, LinkedIn, X… | lista + botón conectar (OAuth) | desconectado, token caducado |
| S14 | Plan y uso | `/settings/billing` | minutos usados, upgrade, comprar extra | barras de uso, tabla de planes, Stripe portal | free, pago, sin minutos |
| S15 | Paywall / upgrade | modal | al tocar función bloqueada | comparativa planes, CTA | — |

## Flujos

```
F01 Convertir un vídeo largo en clips (CORE)
    S01/S03 -> S04 pegar link -> S05 ajustes (defaults) -> "Get clips" -> S06 -> S07
    happy path clicks: 3 (pegar, continuar, get clips) + espera
    edge: link privado/no soportado, >10 h (Opus) / >3 h (Choppity), >4–30 GB,
          4K >60 min (Choppity), sin minutos, idioma no detectado, vídeo sin voz,
          0 clips encontrados, fallo a mitad (reintento sin volver a cobrar)

F02 Encontrar un momento concreto
    S05 prompt "todas las veces que habla de Figma"  ó  S07 reprompt
    edge: el tema no aparece -> mensaje "no encontrado" y no cobrar de nuevo

F03 Revisar y elegir
    S07 ordenar por score -> like/estrella -> dislike oculta -> seleccionar 10
    clicks: ~1 por clip

F04 Retocar un clip
    S07 -> S08 borrar palabras en transcripción / ampliar inicio -> cambiar layout a split
    -> corregir palabra mal transcrita -> guardar
    edge: extender más allá del borde del vídeo fuente, dos caras y una habla

F05 Exportar
    S07 (lote) o S08 -> S09 -> MP4 | XML+SRT para Premiere/DaVinci
    edge: free = marca de agua o bloqueado, render falla, fuente expirada (3 días en free)

F06 Publicar / programar
    S13 conectar cuenta -> S08/S07 -> S10 -> fecha -> S11
    edge: token caducado, límites de la API de TikTok, vídeo >60 s para Shorts

F07 Aplicar marca a todo
    S12 crear plantilla -> S05 elegirla al generar | S07 "aplicar a todos los clips"

F08 Pagar
    S15 -> Stripe checkout -> S14 minutos actualizados
```

Número a batir: 3 clics desde pegar el enlace hasta la lista de clips.

## Componentes

| componente | variantes | estados | usado en |
| --- | --- | --- | --- |
| Button | primario, secundario, ghost, peligro, icono | default, hover, focus, disabled, loading, con progreso (%) | todas |
| URL/Upload dropzone | link, archivo, existente | vacío, drag-over, subiendo %, error | S01, S04 |
| Segmented / Select | modelo, género, aspect ratio, resolución | default, bloqueado (candado + plan) | S05, S09 |
| Duration picker | slider + chips presets | — | S05 |
| Timeframe range slider | sobre miniaturas del vídeo | — | S05 |
| Caption style picker | grid de presets animados | seleccionado, hover-preview | S05, S08, S12 |
| Progress stepper | etapas de procesamiento | en cola, activo, hecho, error | S06 |
| Clip card | grid / lista | procesando, listo, liked, disliked, seleccionado | S07 |
| Score badge | 0–99 con color + tooltip sub-scores | — | S07 |
| Video player vertical | 9:16, 1:1, 16:9 | cargando, play, pausa | S07, S08 |
| Transcript editor | palabras clicables, tachado = cortado, resaltado = keyword | seleccionado, editando, hablante A/B | S08 |
| Timeline | pistas vídeo/subtítulos/audio/overlay, zoom | arrastrando, trim handles | S08 |
| Layout picker | fill, fit+blur, split, screenshare | — | S08 |
| Toast | éxito, error, info | — | todas |
| Modal / Sheet | export, paywall, publicar | — | S09, S10, S15 |
| Usage chip | minutos/horas restantes | normal, bajo, agotado | sidebar |
| Sidebar nav | expandido, colapsado, barra inferior móvil | activo | todas |
| Calendar | mes, semana | vacío, con posts | S11 |

## Modelo de datos inferido

```
User         id, email, name, plan, minutes_balance, created_at
             evidence: S14, plans article. confidence: high
Workspace    id, owner_id, name, seats   (equipos Pro)            confidence: medium
SourceVideo  id, workspace_id, origin (upload|youtube|drive|url…), origin_url,
             storage_key, duration_s, width, height, fps, language, status
             (uploading|importing|queued|analyzing|ready|failed), expires_at
             evidence: S04, S06, límites, caducidad 3/30 días. confidence: high
Transcript   source_id, words jsonb [{w, start, end, speaker, conf}], speakers
             evidence: edición por transcripción, SRT export. confidence: high
AnalysisJob  id, source_id, settings jsonb (model, genre, target_len, timeframe,
             prompt, aspect, caption_preset, brand_template_id, auto_hook),
             stage, progress, minutes_charged, error
             evidence: S05, S06, reprompt. confidence: high
Clip         id, job_id, source_id, start_s, end_s, title, description, hashtags[],
             score, sub_scores jsonb {hook, flow, value, trend}, reason,
             feedback (like|dislike|null), starred, edit jsonb (ver abajo), version
             evidence: S07, S08. confidence: high (sub_scores: medium)
Clip.edit    { aspect, layout, segments:[{src_in,src_out}], crop_keyframes:[{t,x,y,w,h}],
               captions:{style, words, keywords[], emojis[]}, removed_words[],
               overlays[], broll[], music, hook_text, brand_template_id }
             confidence: guess (forma típica de un EDL; el XML export lo confirma)
BrandTemplate id, workspace_id, name, font, colors, caption_position, logo_key,
             watermark, intro_key, outro_key, default_layout      confidence: medium
RenderJob    id, clip_id, format (mp4|xml|srt), resolution, status, output_key
             evidence: botón con progreso → "Done". confidence: high
SocialAccount id, workspace_id, platform, external_id, tokens(enc), status   high
ScheduledPost id, clip_id, social_account_id, caption, publish_at, status, external_post_id   high
UsageLedger  id, user_id, delta_minutes, reason (analysis|refund|topup|monthly_reset)   medium
```

Relaciones: User 1-n Workspace; Workspace 1-n SourceVideo; SourceVideo 1-1 Transcript; SourceVideo 1-n AnalysisJob (reprompts); AnalysisJob 1-n Clip; Clip 1-n RenderJob; Clip 1-n ScheduledPost n-1 SocialAccount; Workspace 1-n BrandTemplate.

## Matriz de funciones

Ver `features.csv`. Must: 22, should: 17, could: 12, skip: 5.

## Fuera de alcance (no se puede o no se debe clonar)

- Los modelos propios de Opus (ClipAnything) y su dataset de "vídeos virales": se sustituyen por modelos públicos (Whisper/Deepgram + LLM + VLM). El score será nuestro, no el suyo.
- Su biblioteca de stock B-roll / música licenciada: usar APIs con licencia propia (Pexels, Pixabay) o generación.
- Marca, nombres ("ClipAnything", "Virality Score"), presets de subtítulos concretos y su diseño visual.
- Acuerdos con plataformas (cuotas de API de TikTok/IG ya aprobadas): hay que pasar la auditoría de cada API por nuestra cuenta.
- Descarga de YouTube: posible técnicamente, pero choca con los ToS de YouTube; alternativa segura = subir archivo, Drive/Dropbox, o que el usuario verifique que es su canal (OAuth de YouTube Data API).

## Tamaño

Pantallas 15, flujos 8, entidades 11.

Partes difíciles:
1. **Selección de buenos momentos** (prompting del LLM, ventanas, snap a frase, dedupe, score que de verdad correlacione). Es el producto; requiere iterar con vídeos reales.
2. **Reencuadre con active speaker** suave y sin tirones (caras + diarización + suavizado), más layouts split/screenshare.
3. **Render de subtítulos animados** palabra a palabra idéntico en preview (navegador) y export (servidor): una sola fuente de verdad (p. ej. Remotion o un renderer propio de ASS) y una cola de workers GPU/CPU con costes controlados.
4. Ingesta de vídeos de horas (subida multipart, reanudable, límites), colas y reintentos sin doble cobro.
5. Publicación en redes (OAuth + revisiones de app de TikTok/Meta).

Tamaño: **L** (un trimestre para un MVP sólido con 1–2 devs). Un MVP "S/M" (sube archivo → clips 9:16 con subtítulos y crop a la cara → descarga) cabe en 3–4 semanas.
