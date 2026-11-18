"""Reencuadre automático: encuentra a quien habla y decide dónde recortar.

Método (sin modelos de pago):
1. Muestrea el tramo a ~5 fps a 640 px de ancho.
2. Detecta caras (YuNet de OpenCV; Haar como respaldo).
3. Une detecciones en "pistas" por cercanía.
4. Mide el movimiento de la boca de cada pista (diferencia entre fotogramas en la mitad
   inferior de la cara). La pista que más se mueve en cada ventana es quien habla.
5. Fija el recorte en esa cara y solo lo cambia si cambia el que habla o la cara se
   desplaza mucho: cortes limpios, sin bailes de cámara.

Salida: {"layout": "fill"|"fit", "crop": [{"t": seg, "cx": 0..1}]}
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from . import config
from .media import read_frames

SAMPLE_FPS = 5.0
SAMPLE_W = 640

_detector = None
_haar = None


def _detect(frame: np.ndarray) -> list[tuple[float, float, float, float, float]]:
    """Devuelve caras como (x, y, w, h, confianza) en píxeles del fotograma."""
    global _detector, _haar
    h, w = frame.shape[:2]
    model = config.MODELS_DIR / "yunet.onnx"
    if _detector is None and model.exists():
        _detector = cv2.FaceDetectorYN.create(str(model), "", (w, h), 0.7, 0.3, 50)
    if _detector is not None:
        _detector.setInputSize((w, h))
        _, faces = _detector.detect(frame)
        if faces is None:
            return []
        return [(float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[14])) for f in faces]
    if _haar is None:
        _haar = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    rects = _haar.detectMultiScale(gray, 1.1, 5, minSize=(int(w * 0.05), int(w * 0.05)))
    return [(float(x), float(y), float(fw), float(fh), 0.8) for (x, y, fw, fh) in rects]


class Track:
    def __init__(self, tid: int):
        self.id = tid
        self.points: dict[int, tuple[float, float, float, float]] = {}  # idx -> x,y,w,h
        self.motion: dict[int, float] = {}

    def last(self):
        k = max(self.points)
        return k, self.points[k]


def analyze(src: Path, start: float, end: float, out_aspect: float, src_w: int, src_h: int) -> dict:
    """out_aspect = ancho/alto de la salida (9/16, 1, 16/9)."""
    src_aspect = src_w / src_h
    if out_aspect >= src_aspect - 0.01:
        return {"layout": "fit", "crop": [{"t": 0.0, "cx": 0.5}], "faces_ratio": 0.0}

    tracks: list[Track] = []
    prev_gray = None
    n = 0
    frames_with_faces = 0
    scale = None
    for i, (_, frame) in enumerate(read_frames(src, start, end - start, SAMPLE_FPS, SAMPLE_W)):
        n += 1
        fh, fw = frame.shape[:2]
        scale = fw
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = [f for f in _detect(frame) if f[2] > fw * 0.04]
        if faces:
            frames_with_faces += 1
        for (x, y, w, h, _conf) in faces:
            cx, cy = x + w / 2, y + h / 2
            best, best_d = None, 1e9
            for tr in tracks:
                k, (tx, ty, tw, th) = tr.last()
                if i - k > int(SAMPLE_FPS * 2):
                    continue
                d = np.hypot(cx - (tx + tw / 2), cy - (ty + th / 2))
                if d < max(w, tw) * 0.8 and d < best_d:
                    best, best_d = tr, d
            if best is None:
                best = Track(len(tracks))
                tracks.append(best)
            best.points[i] = (x, y, w, h)
            if prev_gray is not None:
                x0, y0 = int(max(0, x + w * 0.2)), int(max(0, y + h * 0.6))
                x1, y1 = int(min(fw, x + w * 0.8)), int(min(fh, y + h * 1.0))
                if x1 > x0 and y1 > y0:
                    a = gray[y0:y1, x0:x1].astype(np.float32)
                    b = prev_gray[y0:y1, x0:x1].astype(np.float32)
                    best.motion[i] = float(np.mean(np.abs(a - b)))
        prev_gray = gray

    faces_ratio = frames_with_faces / max(1, n)
    tracks = [t for t in tracks if len(t.points) >= max(3, n * 0.05)]
    if not tracks or faces_ratio < 0.35 or scale is None:
        return {"layout": "fit", "crop": [{"t": 0.0, "cx": 0.5}], "faces_ratio": faces_ratio}

    # ventanas de 1 s: quién habla (más movimiento de boca, con preferencia por caras grandes)
    win = int(SAMPLE_FPS)
    choice: list[int | None] = []
    for w0 in range(0, n, win):
        best, best_v = None, -1.0
        for tr in tracks:
            idx = [k for k in range(w0, w0 + win) if k in tr.points]
            if not idx:
                continue
            size = np.mean([tr.points[k][2] for k in idx]) / scale
            mot = np.mean([tr.motion.get(k, 0.0) for k in idx])
            v = mot * (0.6 + size) + size * 2.0 + 0.05 * len(idx)
            if v > best_v:
                best, best_v = tr.id, v
        choice.append(best)

    # suaviza: un cambio de hablante solo cuenta si dura >= 2 s
    smooth: list[int | None] = []
    current = next((c for c in choice if c is not None), None)
    for j, c in enumerate(choice):
        if c is not None and c != current:
            ahead = choice[j:j + 2]
            if len(ahead) == 2 and all(a == c for a in ahead):
                current = c
        smooth.append(current)

    by_id = {t.id: t for t in tracks}
    keys: list[dict] = []
    crop_w_rel = (src_h * out_aspect) / src_w  # ancho del recorte relativo al ancho de la fuente
    for j, tid in enumerate(smooth):
        if tid is None:
            continue
        tr = by_id[tid]
        idx = [k for k in range(j * win, (j + 1) * win) if k in tr.points]
        if not idx:
            k = min(tr.points, key=lambda k: abs(k - j * win))
            idx = [k]
        cx = float(np.median([(tr.points[k][0] + tr.points[k][2] / 2) / scale for k in idx]))
        t = j * win / SAMPLE_FPS
        if not keys:
            keys.append({"t": 0.0, "cx": cx, "tid": tid})
            continue
        last = keys[-1]
        if tid != last["tid"] or abs(cx - last["cx"]) > crop_w_rel * 0.35:
            keys.append({"t": t, "cx": cx, "tid": tid})
    for k in keys:
        k.pop("tid", None)
        half = crop_w_rel / 2
        k["cx"] = round(min(max(k["cx"], half), 1 - half), 4)
    return {"layout": "fill", "crop": keys, "faces_ratio": round(faces_ratio, 3)}
