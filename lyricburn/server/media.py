"""Metadados de mídia e picos de waveform pra UI.

Usa o `lyricburn.audio` do núcleo pro que ele já resolve (rotação, som no vídeo,
fim real da música) e um ffprobe próprio pros campos que só a UI precisa (fps, codec).
"""
from __future__ import annotations

import json
import math
import subprocess
from array import array
from pathlib import Path

from .. import audio
from . import settings

_FIELDS = ("codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels,"
           "duration,bit_rate")


def _ffprobe(path: str) -> dict:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error",
         "-show_entries", f"stream={_FIELDS}:format=duration,format_name,size",
         "-of", "json", path])
    return json.loads(out)


def _fps(stream: dict) -> float | None:
    rate = stream.get("r_frame_rate") or ""
    if "/" in rate:
        num, den = rate.split("/", 1)
        if float(den or 0):
            return round(float(num) / float(den), 3)
    return None


def _float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def video_info(path: str) -> dict:
    """Duração, tamanho já corrigido por rotação, fps, codec e se tem som."""
    data = _ffprobe(path)
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), {})
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    width, height = audio.video_size(path)
    duration = _float(data.get("format", {}).get("duration")) or 0.0
    return {
        "duration": round(duration, 3),
        "width": width,
        "height": height,
        "orientation": "horizontal" if width >= height else "vertical",
        "fps": _fps(v),
        "codec": v.get("codec_name"),
        "has_audio": a is not None,
        "container": data.get("format", {}).get("format_name"),
        "bytes": int(data.get("format", {}).get("size") or 0),
    }


def audio_info(path: str) -> dict:
    """Duração do arquivo e onde a música de fato acaba (ignorando silêncio no fim)."""
    data = _ffprobe(path)
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})
    duration = _float(data.get("format", {}).get("duration")) or 0.0
    return {
        "duration": round(duration, 3),
        "music_end": round(audio.music_end(path, 0.0), 3),
        "codec": a.get("codec_name"),
        "sample_rate": int(a["sample_rate"]) if a.get("sample_rate") else None,
        "channels": a.get("channels"),
        "container": data.get("format", {}).get("format_name"),
        "bytes": int(data.get("format", {}).get("size") or 0),
    }


def peaks(path: str, buckets: int | None = None) -> dict:
    """Níveis da waveform (0–1) pro timeline da UI.

    Decodifica o áudio em mono 8 kHz e guarda o RMS de cada fatia. RMS e não pico:
    música masterizada tem pico perto do máximo quase o tempo todo, e o desenho
    saía uma barra chapada. Com a média quadrática dá pra ver refrão, ponte e
    instrumental.
    """
    buckets = max(16, min(int(buckets or settings.PEAK_BUCKETS), 20000))
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1",
         "-ar", str(settings.PEAK_RATE), "-f", "s16le", "-"],
        capture_output=True, check=True).stdout

    samples = array("h")
    samples.frombytes(raw[:len(raw) // 2 * 2])
    total = len(samples)
    if not total:
        return {"sample_rate": settings.PEAK_RATE, "buckets": 0, "duration": 0.0, "values": []}

    values = _bucket_rms(samples, buckets)
    top = max(values) or 1
    return {
        "sample_rate": settings.PEAK_RATE,
        "buckets": len(values),
        "duration": round(total / settings.PEAK_RATE, 3),
        # normalizado pelo trecho mais forte: a UI desenha sem precisar reescalar
        "values": [round(v / top, 4) for v in values],
    }


def _bucket_rms(samples: array, buckets: int) -> list[float]:
    """Média quadrática de cada fatia — é o que corresponde ao volume percebido."""
    total = len(samples)
    buckets = min(buckets, total)
    edges = [i * total // buckets for i in range(buckets + 1)]

    try:
        import numpy as np
    except ImportError:
        out = []
        for a, b in zip(edges[:-1], edges[1:]):
            chunk = samples[a:b] or samples[a:a + 1]
            out.append(math.sqrt(sum(float(v) * v for v in chunk) / len(chunk)))
        return out

    squared = np.frombuffer(samples, dtype=np.int16).astype(np.float64) ** 2
    return [float(math.sqrt(squared[a:b].mean())) if b > a else 0.0
            for a, b in zip(edges[:-1], edges[1:])]


def probe_lyrics_kind(path: Path) -> str:
    return path.suffix.lower().lstrip(".") or "desconhecido"
