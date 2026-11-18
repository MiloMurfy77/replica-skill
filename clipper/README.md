# Clipper (nombre provisional)

Convierte un vídeo largo (podcast, entrevista, webinar) en decenas de clips verticales listos para publicar: subtítulos animados palabra a palabra, encuadre automático en quien habla, gancho de texto, título, descripción, hashtags y puntuación de viralidad.

Es la versión mínima (MVP) del plan en `../replica/` (recon, arquitectura).

## Cómo funciona

```
web (Next.js)  ── sube el vídeo ──▶  disco / R2
     │                                  ▲
     └─ crea tareas en Postgres ──▶  worker (Python + ffmpeg)
                                        1. ffprobe: valida el vídeo
                                        2. transcripción con tiempos por palabra (Whisper local o Deepgram)
                                        3. elige momentos (Claude; heurística si no hay clave)
                                        4. detecta caras y quién habla → recorte 9:16
                                        5. subtítulos ASS animados + gancho → MP4
```

- Cola de trabajos en la propia base de datos (`tasks` + `FOR UPDATE SKIP LOCKED`): sin Redis.
- La transcripción se hace una vez por vídeo; volver a generar clips del mismo vídeo es gratis.
- Cobro por minutos de vídeo analizado (60 min gratis al registrarse); si el análisis falla, se devuelven.

## Arrancar en local

Requisitos: Node 22 + pnpm, Python 3.11+, ffmpeg (con libass), Postgres 16.

```bash
scripts/setup.sh      # dependencias + detector de caras
scripts/dev.sh        # base de datos, worker y web en http://localhost:3000
```

Variables útiles (worker):

| variable | por defecto | qué hace |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://clipper@localhost:5433/clipper` | Postgres |
| `STORAGE_DIR` | `clipper/.data/storage` | dónde se guardan vídeos y clips (la web usa la misma) |
| `ANTHROPIC_API_KEY` | — | activa la selección de momentos con Claude |
| `CLAUDE_MODEL` | `claude-opus-5-5` | modelo para elegir momentos |
| `ASR_PROVIDER` | `whisper` | `whisper` (local, CPU) o `deepgram` (+ `DEEPGRAM_API_KEY`) |
| `WHISPER_MODEL` | `small` | tamaño del modelo local (`base`, `small`, `medium`, `large-v3`) |

## Prueba de humo

Con la web y el worker en marcha:

```bash
node e2e/smoke.mjs ruta/a/un/video.mp4 e2e-shots
```

Se registra, sube el vídeo, genera clips, abre el editor y descarga un MP4.

## Estado

Hecho: registro, subida (hasta 4 GB) e importación por enlace https, ajustes (duración, formato, estilo de subtítulos, búsqueda por texto, tramo), progreso por etapas, lista de clips con puntuación y sub-puntuaciones, me gusta / descartar / destacar, editor (título, descripción, recorte, encuadre, subtítulos, gancho), descarga MP4 y SRT.

Siguiente: pagos con Stripe, email de "clips listos", subida directa a R2, edición por transcripción, plantillas de marca, publicación en redes.
