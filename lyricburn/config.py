"""Configuração: defaults + arquivo TOML + overrides da linha de comando."""
from __future__ import annotations

import copy
import re
import tomllib
from pathlib import Path

DEFAULTS: dict = {
    "input": {
        "video": "",
        "audio": "",
        "lyrics": "",            # .lrc, .srt ou .vtt
    },
    "timing": {
        "music_start": 0.0,      # de onde a música começa ("2:26", "146", 146.0)
        "start_at_lyric": "",    # alternativa: começa N segundos antes da 1ª linha que contém esse texto
        "lead_in": 2.0,          # segundos antes da linha escolhida em start_at_lyric
        "occurrence": 1,         # qual ocorrência da linha (1 = primeira vez que aparece)
        "video_offset": 0.0,     # em que segundo do vídeo a música entra
        "lyrics_offset": 0.0,    # ajuste fino de sync (+ atrasa a letra, - adianta)
        "end": "auto",           # auto = termina no que acabar primeiro (vídeo ou música) | "video" | "music"
        "max_duration": 0.0,     # 0 = sem limite
    },
    "audio": {
        "game_volume": 0.30,
        "music_volume": 1.0,
        "music_fade_in": 0.8,
        "duck": False,           # abaixa o jogo só quando a música está forte (sidechain)
    },
    "video": {
        "resolution": 720,       # lado menor do vídeo (720 = 720p, 1080 = 1080p); vale pra horizontal e vertical
        "fade_in": 1.2,
        "fade_out": 2.5,
        "crf": 22,
        "preset": "slow",
    },
    "style": {
        "font": "Space Grotesk Medium",
        "size": 48,              # tamanho em px num vídeo de 720p (escala sozinho)
        "spacing": 0.2,
        "color": "#F5F5F5",
        "outline": 1.4,
        "shadow": 1.6,
        "position": "center",    # center | bottom | top | número de 0 a 1 (altura relativa)
        "line_fade_ms": 220,
        "back_font": "Space Grotesk",
        "back_size": 32,
        "back_italic": True,
        "back_opacity": 0.8,
        "fonts_dir": "",         # pasta extra com .ttf/.otf
    },
    "dots": {
        "enabled": True,
        "min_gap": 1.2,          # pausa mínima sem voz pra mostrar os pontos
        "reactive": True,        # reage às notas (precisa do librosa)
        "radius": 5.5,
        "spacing": 26,
    },
    "output": {
        "path": "",
    },
}


def parse_time(v) -> float:
    """Aceita 146, 146.5, "146", "2:26", "2:26.5", "1:02:26"."""
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return 0.0
    parts = s.split(":")
    total = 0.0
    for p in parts:
        total = total * 60 + float(p)
    return total


def _merge(base: dict, extra: dict) -> dict:
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def _coerce(value: str):
    low = value.lower()
    if low in ("true", "false"):
        return low == "true"
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if re.fullmatch(r"-?\d*\.\d+", value):
        return float(value)
    return value


def load(path: str | None, overrides: list[str] | None = None) -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    base_dir = Path.cwd()
    if path:
        p = Path(path)
        with open(p, "rb") as f:
            _merge(cfg, tomllib.load(f))
        base_dir = p.resolve().parent

    for item in overrides or []:
        if "=" not in item:
            raise SystemExit(f"--set espera chave=valor, recebi: {item}")
        key, value = item.split("=", 1)
        node = cfg
        *parents, leaf = key.strip().split(".")
        for name in parents:
            node = node.setdefault(name, {})
        node[leaf] = _coerce(value.strip())

    # caminhos relativos ao arquivo de config
    for key in ("video", "audio", "lyrics"):
        val = cfg["input"].get(key)
        if val and not Path(val).is_absolute():
            cfg["input"][key] = str((base_dir / val).resolve())
    fd = cfg["style"].get("fonts_dir")
    if fd and not Path(fd).is_absolute():
        cfg["style"]["fonts_dir"] = str((base_dir / fd).resolve())
    out = cfg["output"].get("path")
    if out and not Path(out).is_absolute():
        cfg["output"]["path"] = str((base_dir / out).resolve())
    return cfg


EXAMPLE = '''# lyricburn — configuração de um vídeo
# Caminhos são relativos a este arquivo.

[input]
video  = "gameplay.mp4"
audio  = "musica.mp3"
lyrics = "musica.lrc"          # .lrc, .srt ou .vtt

[timing]
music_start = "2:26"           # de onde a música começa (mm:ss)
# start_at_lyric = "they got it"   # ou: começa por uma linha da letra...
# occurrence = 5                   # ...a 5ª vez que ela aparece (veja com `lyricburn lines`)
# lead_in = 2.0                    # ...N segundos antes dela
video_offset  = 0              # em que segundo do vídeo a música entra
lyrics_offset = 0              # ajuste fino de sync: +0.2 atrasa a letra, -0.2 adianta
end = "auto"                   # auto | video | music

[audio]
game_volume  = 0.30
music_volume = 1.0
duck = false                   # true = abaixa o jogo só quando a música está forte

[video]
resolution = 720           # 720p ou 1080p (lado menor; funciona em vídeo vertical)
fade_in  = 1.2
fade_out = 2.5

[style]
font      = "Space Grotesk Medium"
size      = 48
position  = "center"           # center | bottom | top | 0.0–1.0
color     = "#F5F5F5"
back_font = "Space Grotesk"
back_size = 32

[dots]
enabled  = true
reactive = true                # pontinhos dançam com as notas do instrumental

[output]
path = "saida.mp4"
'''
