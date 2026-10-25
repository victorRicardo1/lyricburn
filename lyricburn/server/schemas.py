"""Modelos de entrada/saída — é o que documenta a API no /docs."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from ..config import DEFAULTS


class ConfigIn(BaseModel):
    """As mesmas seções do .toml. Só `timing`, `audio`, `video`, `style` e `dots`:
    `input` e `output` são do servidor. Chave desconhecida é ignorada e reportada
    em `ignored_config_keys`."""

    timing: dict[str, Any] | None = None
    audio: dict[str, Any] | None = None
    video: dict[str, Any] | None = None
    style: dict[str, Any] | None = None
    dots: dict[str, Any] | None = None

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "timing": {"music_start": "0:45", "lyrics_offset": 0},
                "style": {"size": 48, "position": "center", "color": "#F5F5F5"},
                "dots": {"enabled": True, "reactive": True},
            }],
        }
    }

    def sections(self) -> dict:
        return {k: v for k, v in self.model_dump(exclude_none=True).items() if v}


class PlanRequest(ConfigIn):
    pass


class RenderRequest(ConfigIn):
    fast: bool = Field(False, description="render rápido de teste (crf 26, preset veryfast)")


class LyricLine(BaseModel):
    index: int | None = None
    start: float
    end: float
    text: str
    track: str = Field("main", description='"main" ou "back" (backing vocal)')


class Peaks(BaseModel):
    sample_rate: int
    buckets: int
    duration: float
    values: list[float] = Field(description="pico absoluto de cada fatia, 0–1")


class ProjectOut(BaseModel):
    id: str
    created: float
    files: dict[str, Any]
    meta: dict[str, Any] = Field(description="metadados do vídeo e do áudio (ffprobe)")
    lines: list[LyricLine] = Field(description="letra em tempo da MÚSICA, como veio do arquivo")
    peaks: Peaks
    warnings: list[str] = []
    media: dict[str, str] = {}


class GapOut(BaseModel):
    start: float
    end: float
    notes: list[list[float]] = Field(default=[], description="[tempo, força 0–1, altura 0–1]")


class PlanSummary(BaseModel):
    music_start: float
    video_offset: float
    duration: float
    width: int
    height: int
    has_game_audio: bool
    reactive_dots: bool
    line_count: int
    lines: list[LyricLine] = Field(description="letra em tempo do VÍDEO, já recortada")
    gaps: list[GapOut]
    note_count: int
    warnings: list[str] = []
    ignored_config_keys: list[str] = []
    text: str = Field(description="o mesmo resumo que o `lyricburn info` imprime")


class PlanOut(BaseModel):
    project_id: str
    summary: PlanSummary
    ass: str = Field(description="o .ass completo — é o que o render queima e o preview desenha")
    config: dict[str, Any] = Field(description="config efetiva (defaults + o que você mandou)")


class JobOut(BaseModel):
    id: str
    project_id: str
    status: str = Field(description="queued | preparing | rendering | done | error")
    fast: bool
    progress: float
    out_time: float
    duration: float
    frame: int
    fps: float | None = None
    speed: float | None = None
    eta: float | None = None
    size_bytes: int
    message: str | None = None
    filename: str | None = None
    summary: dict[str, Any] | None = None
    created_at: float
    started_at: float | None = None
    finished_at: float | None = None
    elapsed: float
    download_url: str | None = None


class FontOut(BaseModel):
    file: str
    family: str = Field(description="o que vai em style.font / style.back_font")
    full_name: str | None = None
    subfamily: str | None = None
    typographic_family: str | None = None
    italic: bool = False
    bold: bool = False
    weight: int | None = None
    bytes: int
    source: str
    url: str


class FontsOut(BaseModel):
    fonts: list[FontOut]
    families: list[str]


class DefaultsOut(BaseModel):
    defaults: dict[str, Any] = Field(default=DEFAULTS)
