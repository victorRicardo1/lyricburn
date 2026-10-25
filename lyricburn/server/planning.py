"""Ponte entre a config que vem da UI e o núcleo `plan` → `ass`.

Duas camadas de cache, porque mexer num slider de estilo não deveria re-analisar áudio:

* **notas do librosa** — em disco, por projeto + `music_start` + as pausas detectadas.
  Mudar só o estilo não muda as pausas, então o cache acerta.
* **Plan** — em memória, pela parte da config que o `plan.build` realmente usa
  (entradas, `timing`, `video.resolution`, `dots`), evitando ffprobe e silencedetect a cada chamada.
"""
from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
import threading

from .. import ass as ass_mod
from .. import audio
from .. import config as config_mod
from .. import plan as plan_mod
from . import settings
from .store import Project

# seções que o cliente pode mandar; `input`/`output` são sempre do servidor
CLIENT_SECTIONS = ("timing", "audio", "video", "style", "dots")
# `fonts_dir` apontaria pra qualquer pasta da máquina: fica fora do alcance do cliente
LOCKED_KEYS = {"style": ("fonts_dir",)}

_PLAN_CACHE: dict[str, plan_mod.Plan] = {}
_PLAN_CACHE_MAX = 32
_PLAN_LOCK = threading.Lock()
_NOTES_LOCK = threading.Lock()

NO_LIBROSA = "librosa não instalado: pontinhos ficam estáticos (pip install librosa)"


def merge_config(project: Project, overrides: dict | None) -> tuple[dict, list[str]]:
    """Defaults + o que a UI mandou. Devolve também as chaves ignoradas (typo não passa calado)."""
    cfg = copy.deepcopy(config_mod.DEFAULTS)
    ignored: list[str] = []
    for section, given in (overrides or {}).items():
        if section not in CLIENT_SECTIONS or not isinstance(given, dict):
            ignored.append(section)
            continue
        for key, value in given.items():
            if key in cfg[section] and key not in LOCKED_KEYS.get(section, ()):
                cfg[section][key] = value
            else:
                ignored.append(f"{section}.{key}")

    cfg["input"] = {kind: str(project.path(kind)) for kind in ("video", "audio", "lyrics")}
    cfg["output"] = {"path": ""}
    cfg["style"]["fonts_dir"] = str(settings.EXTRA_FONTS_DIR or "")
    return cfg, ignored


def _digest(payload) -> str:
    return hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _plan_key(project: Project, cfg: dict) -> str:
    dots = cfg["dots"]
    return _digest([project.id, cfg["input"], cfg["timing"],
                    cfg["video"].get("resolution"),
                    [dots.get("enabled"), dots.get("min_gap"), dots.get("reactive")]])


def build_plan(project: Project, cfg: dict) -> plan_mod.Plan:
    """Plan pronto pra virar .ass, com as notas anexadas. Bloqueante — rode numa thread."""
    key = _plan_key(project, cfg)
    with _PLAN_LOCK:
        cached = _PLAN_CACHE.get(key)
    if cached is None:
        cached = plan_mod.build(cfg, analyze_notes=False)
        with _PLAN_LOCK:
            if len(_PLAN_CACHE) >= _PLAN_CACHE_MAX:
                _PLAN_CACHE.pop(next(iter(_PLAN_CACHE)))
            _PLAN_CACHE[key] = cached

    # cópia por requisição: o estilo é só do .ass, e o Plan em cache é compartilhado
    plan = dataclasses.replace(cached, cfg=cfg, warnings=list(cached.warnings), notes=None)
    _attach_notes(project, cfg, plan)
    return plan


def _attach_notes(project: Project, cfg: dict, plan: plan_mod.Plan) -> None:
    """Mesmo passo de análise do `plan.build`, só que com cache.

    Mantém a mesma matemática de offset do núcleo (análise em tempo da música,
    resultado em tempo do vídeo) pro .ass sair idêntico ao da CLI.
    """
    if not plan.gaps or not cfg["dots"].get("enabled", True) or not cfg["dots"].get("reactive", True):
        return

    offset = plan.video_offset
    length = plan.duration - offset + 0.5
    local = [(a - offset, b - offset) for a, b in plan.gaps]

    found = _notes(project, plan.music_start, length, local)
    if found is None:
        plan.warnings.append(NO_LIBROSA)
        return
    plan.notes = {
        (a + offset, b + offset): [(t + offset, s, p) for t, s, p in found[(a, b)]]
        for a, b in local
    }


def _notes(project: Project, music_start: float, length: float,
           gaps: list[tuple[float, float]]) -> dict | None:
    """Notas de cada pausa, do cache em disco ou do librosa. None = librosa indisponível."""
    cache_dir = project.dir / "notes"
    cache_dir.mkdir(parents=True, exist_ok=True)
    rounded = [(round(a, 3), round(b, 3)) for a, b in gaps]
    cache_file = cache_dir / f"{_digest([round(music_start, 3), rounded])}.json"

    with _NOTES_LOCK:
        if cache_file.is_file():
            stored = json.loads(cache_file.read_text(encoding="utf-8"))
            return {gaps[i]: [tuple(n) for n in item["notes"]]
                    for i, item in enumerate(stored["gaps"])}

        wav = _music_wav(project, music_start, length)
        found = audio.detect_notes(str(wav), gaps)
        if found is None:
            return None
        cache_file.write_text(json.dumps({
            "music_start": music_start,
            "gaps": [{"gap": [a, b], "notes": found[(a, b)]} for a, b in gaps],
        }), encoding="utf-8")
        return found


def _music_wav(project: Project, music_start: float, length: float):
    """WAV mono 22 kHz da música a partir de `music_start`, reaproveitado entre chamadas.

    O librosa fatia por índice de amostra, então um wav mais longo do que o necessário
    dá exatamente o mesmo resultado — só re-extrai quando o trecho atual é curto demais.
    """
    wav = project.work_dir / f"music_{int(round(music_start * 1000))}ms.wav"
    meta = wav.with_suffix(".json")
    if wav.is_file() and meta.is_file():
        try:
            if json.loads(meta.read_text(encoding="utf-8"))["length"] >= length - 1e-6:
                return wav
        except (ValueError, KeyError):
            pass
    audio.extract_wav(str(project.path("audio")), music_start, length, str(wav))
    meta.write_text(json.dumps({"length": length}), encoding="utf-8")
    return wav


def build_ass(plan: plan_mod.Plan) -> str:
    return ass_mod.build(plan)


def summarize(plan: plan_mod.Plan, ignored: list[str] | None = None) -> dict:
    """Resumo do Plan em JSON — os mesmos números do `lyricburn info`, campo por campo."""
    notes = plan.notes or {}
    gaps = [
        {
            "start": round(a, 3),
            "end": round(b, 3),
            "notes": [[round(t, 3), round(s, 4), round(p, 4)] for t, s, p in notes.get((a, b), [])],
        }
        for a, b in plan.gaps
    ]
    return {
        "music_start": round(plan.music_start, 3),
        "video_offset": round(plan.video_offset, 3),
        "duration": round(plan.duration, 3),
        "width": plan.width,
        "height": plan.height,
        "has_game_audio": plan.has_game_audio,
        "reactive_dots": plan.notes is not None,
        "line_count": len(plan.lines),
        # em tempo do VÍDEO e já recortadas — é o que a prévia precisa
        "lines": [{"start": round(l.start, 3), "end": round(l.end, 3),
                   "text": l.text, "track": l.track} for l in plan.lines],
        "gaps": gaps,
        "note_count": sum(len(g["notes"]) for g in gaps),
        "warnings": plan.warnings,
        "ignored_config_keys": sorted(set(ignored or [])),
        "text": plan.summary(),
    }
