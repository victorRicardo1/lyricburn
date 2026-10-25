"""Cópia leve do vídeo pra prévia no navegador.

O arquivo original pode ser qualquer coisa que o ffmpeg abra — .mkv, HEVC, AV1 — e
boa parte disso não toca em `<video>`. Aqui a gente gera sob demanda uma cópia
pequena num formato que o navegador aceita, e guarda em disco por projeto.

Dois formatos porque não existe um que sirva pra todo mundo:

* **mp4** (H.264 + AAC) — o que praticamente todo navegador instalado toca;
* **webm** (VP9 + Opus) — pra builds de Chromium sem os codecs proprietários.

Quem escolhe é o cliente, que sabe o que consegue tocar.
"""
from __future__ import annotations

import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path

from .store import Project

# lado maior da prévia: o suficiente pra conferir enquadramento sem demorar pra gerar
MAX_SIDE = 854

FORMATS: dict[str, list[str]] = {
    "mp4": [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
    ],
    "webm": [
        # VP9 em modo tempo real; o -b:v é teto, não alvo (sem ele o arquivo quadruplica)
        "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8",
        "-crf", "40", "-b:v", "1200k", "-row-mt", "1",
        "-c:a", "libopus", "-b:a", "96k",
    ],
}

MEDIA_TYPES = {"mp4": "video/mp4", "webm": "video/webm"}

# não aumenta vídeo pequeno: a caixa é limitada pelo próprio tamanho da fonte.
# setsar=1 no fim pra não sobrar aspecto anamórfico no container (sem ele o
# navegador reportava 854x481 numa fonte 16:9 e esticava um pixel)
_SCALE = (f"scale='min({MAX_SIDE},iw)':'min({MAX_SIDE},ih)'"
          ":force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1")


@dataclass
class State:
    ready: bool = False
    building: bool = False
    error: str | None = None


_LOCK = threading.Lock()
_STATE: dict[str, State] = {}


def path_for(project: Project, fmt: str) -> Path:
    return project.work_dir / f"preview.{fmt}"


def ensure(project: Project, fmt: str) -> State:
    """Cópia do vídeo de entrada do projeto."""
    return ensure_file(project.path("video"), path_for(project, fmt), fmt, f"{project.id}:{fmt}")


def ensure_file(source: Path, target: Path, fmt: str, key: str) -> State:
    """Devolve o estado da cópia, começando a gerar se ainda não existir."""
    with _LOCK:
        if target.is_file() and target.stat().st_size > 0:
            state = State(ready=True)
            _STATE[key] = state
            return state

        state = _STATE.get(key)
        if state and (state.building or state.error):
            return state

        state = State(building=True)
        _STATE[key] = state

    threading.Thread(target=_build, args=(source, fmt, target, key), daemon=True).start()
    return state


def _build(source: Path, fmt: str, target: Path, key: str) -> None:
    # grava num temporário e só então renomeia: ninguém recebe arquivo pela metade.
    # a extensão real vai no fim porque o ffmpeg escolhe o container por ela.
    partial = target.with_name(f"{target.stem}.parcial{target.suffix}")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(source),
           "-vf", _SCALE, *FORMATS[fmt], str(partial)]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True)
        if done.returncode != 0 or not partial.is_file():
            tail = (done.stderr or "").strip().splitlines()
            raise RuntimeError(tail[-1] if tail else f"ffmpeg saiu com {done.returncode}")
        partial.replace(target)
        with _LOCK:
            _STATE[key] = State(ready=True)
    except BaseException as exc:
        partial.unlink(missing_ok=True)
        with _LOCK:
            _STATE[key] = State(error=str(exc) or exc.__class__.__name__)
    finally:
        # nunca deixar "building" pendurado: quem está esperando ficaria em
        # polling eterno, e um 202 que nunca vira 200 é pior que um erro
        with _LOCK:
            if _STATE.get(key, State()).building:
                _STATE[key] = State(error="a conversão terminou sem produzir arquivo")


def media_type(fmt: str) -> str:
    return MEDIA_TYPES.get(fmt, "application/octet-stream")
