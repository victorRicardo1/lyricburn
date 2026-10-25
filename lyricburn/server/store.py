"""Projetos em disco: um id, os três arquivos de entrada e o que foi detectado neles."""
from __future__ import annotations

import json
import secrets
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

from .. import lyrics as lyrics_mod
from . import media, settings

LYRICS_SUFFIXES = (".lrc", ".srt", ".vtt", ".txt")
VIDEO_SUFFIXES = (".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg", ".ts", ".flv")
AUDIO_SUFFIXES = (".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma", ".aiff")

_CHUNK = 1024 * 1024


@dataclass
class Project:
    id: str
    created: float
    files: dict             # {"video": {...}, "audio": {...}, "lyrics": {...}}
    meta: dict              # {"video": {...}, "audio": {...}}
    lines: list             # linhas da letra, em tempo da MÚSICA
    peaks: dict
    warnings: list = field(default_factory=list)

    @property
    def dir(self) -> Path:
        return settings.PROJECTS_DIR / self.id

    def path(self, kind: str) -> Path:
        return self.dir / "input" / self.files[kind]["stored"]

    @property
    def work_dir(self) -> Path:
        d = self.dir / "work"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def out_dir(self) -> Path:
        d = self.dir / "out"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "created": self.created,
            "files": self.files,
            "meta": self.meta,
            "lines": self.lines,
            "peaks": self.peaks,
            "warnings": self.warnings,
        }

    def save(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "project.json").write_text(
            json.dumps(self.as_dict(), ensure_ascii=False, indent=1), encoding="utf-8")


def _safe_suffix(name: str, allowed: tuple[str, ...], default: str) -> str:
    suffix = Path(name or "").suffix.lower()
    return suffix if suffix in allowed else default


async def _save_upload(upload, dest: Path) -> int:
    """Grava o upload em pedaços: vídeo é grande, não cabe tudo na memória."""
    size = 0
    with open(dest, "wb") as fh:
        while chunk := await upload.read(_CHUNK):
            fh.write(chunk)
            size += len(chunk)
    await upload.close()
    return size


async def create(video, audio_file, lyrics_file, peak_buckets: int | None = None) -> Project:
    """Recebe os três uploads, analisa e devolve o projeto pronto."""
    project_id = secrets.token_hex(8)
    base = settings.PROJECTS_DIR / project_id
    inp = base / "input"
    inp.mkdir(parents=True, exist_ok=True)

    try:
        uploads = (
            ("video", video, VIDEO_SUFFIXES, ".mp4"),
            ("audio", audio_file, AUDIO_SUFFIXES, ".mp3"),
            ("lyrics", lyrics_file, LYRICS_SUFFIXES, ".lrc"),
        )
        files = {}
        for kind, upload, allowed, default in uploads:
            stored = kind + _safe_suffix(upload.filename, allowed, default)
            size = await _save_upload(upload, inp / stored)
            files[kind] = {
                "original": Path(upload.filename or stored).name,
                "stored": stored,
                "bytes": size,
                "content_type": upload.content_type,
            }

        warnings: list[str] = []
        video_meta = media.video_info(str(inp / files["video"]["stored"]))
        audio_meta = media.audio_info(str(inp / files["audio"]["stored"]))
        if not video_meta["has_audio"]:
            warnings.append("o vídeo não tem áudio: audio.game_volume não vai ter efeito")

        parsed = lyrics_mod.load(str(inp / files["lyrics"]["stored"]))
        lines = [
            {"index": i, "start": round(l.start, 3), "end": round(l.end, 3),
             "text": l.text, "track": l.track}
            for i, l in enumerate(parsed, 1)
        ]
        if not lines:
            warnings.append("nenhuma linha reconhecida na letra")

        peaks = media.peaks(str(inp / files["audio"]["stored"]), peak_buckets)
        project = Project(project_id, time.time(), files,
                          {"video": video_meta, "audio": audio_meta},
                          lines, peaks, warnings)
        project.save()
        return project
    except BaseException:
        shutil.rmtree(base, ignore_errors=True)
        raise


def load(project_id: str) -> Project | None:
    if not project_id or project_id != Path(project_id).name or not project_id.isalnum():
        return None
    meta = settings.PROJECTS_DIR / project_id / "project.json"
    if not meta.is_file():
        return None
    data = json.loads(meta.read_text(encoding="utf-8"))
    return Project(data["id"], data["created"], data["files"], data["meta"],
                   data["lines"], data["peaks"], data.get("warnings", []))
