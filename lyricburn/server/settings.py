"""Onde a UI web guarda as coisas. Tudo configurável por variável de ambiente."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def _env_path(name: str) -> Path | None:
    val = os.environ.get(name)
    return Path(val).expanduser().resolve() if val else None


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name) or default)
    except ValueError:
        return default


# pasta de trabalho: uploads, wav de análise, .ass e vídeos renderizados
WORK_DIR = _env_path("LYRICBURN_WORK_DIR") or Path(tempfile.gettempdir()) / "lyricburn-web"
PROJECTS_DIR = WORK_DIR / "projects"

# pasta extra de fontes (além das que vêm no pacote), igual ao style.fonts_dir do .toml
EXTRA_FONTS_DIR = _env_path("LYRICBURN_FONTS_DIR")

# waveform: quantas barras e em que taxa o áudio é decodificado pra calcular os picos
PEAK_BUCKETS = _env_int("LYRICBURN_PEAK_BUCKETS", 1600)
PEAK_RATE = 8000

# quantos renders rodam ao mesmo tempo (ffmpeg já usa todos os núcleos)
MAX_RENDERS = _env_int("LYRICBURN_MAX_RENDERS", 1)

# origens liberadas no CORS: o dev server do Angular (fase 2b) roda em outra porta
CORS_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"


def ensure_dirs() -> None:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
