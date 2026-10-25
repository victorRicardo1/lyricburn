"""Renders em background, com progresso lido do `ffmpeg -progress pipe:1`.

O ffmpeg roda numa thread (Popen) em vez de subprocess do asyncio: no Windows isso
não depende de qual event loop o uvicorn escolheu. O estado do job fica em memória —
a UI acompanha por polling em `GET /jobs/{id}`.
"""
from __future__ import annotations

import asyncio
import secrets
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

from .. import render as render_mod
from . import planning, settings
from .store import Project

_SLOTS = threading.BoundedSemaphore(max(1, settings.MAX_RENDERS))
_JOBS: dict[str, "Job"] = {}
_LOCK = threading.Lock()


@dataclass
class Job:
    id: str
    project_id: str
    fast: bool
    status: str = "queued"          # queued | preparing | rendering | done | error
    progress: float = 0.0           # 0–1
    out_time: float = 0.0           # segundo do vídeo que o ffmpeg já escreveu
    duration: float = 0.0
    frame: int = 0
    fps: float | None = None
    speed: float | None = None
    eta: float | None = None
    size_bytes: int = 0
    message: str | None = None
    filename: str | None = None     # nome sugerido no download
    summary: dict | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    _path: Path | None = None
    _log: deque = field(default_factory=lambda: deque(maxlen=40))

    def as_dict(self) -> dict:
        data = {
            "id": self.id,
            "project_id": self.project_id,
            "status": self.status,
            "fast": self.fast,
            "progress": round(self.progress, 4),
            "out_time": round(self.out_time, 3),
            "duration": round(self.duration, 3),
            "frame": self.frame,
            "fps": self.fps,
            "speed": self.speed,
            "eta": round(self.eta, 1) if self.eta is not None else None,
            "size_bytes": self.size_bytes,
            "message": self.message,
            "filename": self.filename,
            "summary": self.summary,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "elapsed": round((self.finished_at or time.time()) - (self.started_at or self.created_at), 2),
            "download_url": f"/jobs/{self.id}/download" if self.status == "done" else None,
        }
        return data

    @property
    def output(self) -> Path | None:
        return self._path if self._path and self._path.is_file() else None


def get(job_id: str) -> Job | None:
    with _LOCK:
        return _JOBS.get(job_id)


def start(project: Project, cfg: dict, fast: bool = False) -> Job:
    """Cria o job e solta a execução em background. Volta na hora."""
    job = Job(secrets.token_hex(8), project.id, fast)
    job.filename = _suggest_name(project, fast)
    with _LOCK:
        _JOBS[job.id] = job
    asyncio.get_running_loop().run_in_executor(None, _run, job, project, cfg)
    return job


def _suggest_name(project: Project, fast: bool) -> str:
    stem = Path(project.files["video"]["original"]).stem or "video"
    return f"{stem}_lyrics{'_fast' if fast else ''}.mp4"


def _run(job: Job, project: Project, cfg: dict) -> None:
    workspace = None
    with _SLOTS:
        job.started_at = time.time()
        try:
            job.status = "preparing"
            plan = planning.build_plan(project, cfg)
            job.summary = planning.summarize(plan)
            job.duration = plan.duration

            workspace = render_mod.Workspace(cfg)
            ass_text = planning.build_ass(plan)
            workspace.write_ass(ass_text)

            out = project.out_dir / f"{job.id}.mp4"
            job._path = out
            # guarda o .ass do render ao lado da saída: serve pra conferir no Aegisub
            (project.out_dir / f"{job.id}.ass").write_text(ass_text, encoding="utf-8")

            job.status = "rendering"
            code = _ffmpeg(job, plan, out, workspace)
            if code != 0:
                raise RuntimeError(_error_text(job, code))

            job.size_bytes = out.stat().st_size if out.is_file() else 0
            job.progress = 1.0
            job.out_time = job.duration
            job.eta = 0.0
            job.status = "done"
        except BaseException as exc:   # SystemExit do núcleo também é erro de usuário
            job.status = "error"
            job.message = str(exc) or exc.__class__.__name__
            if isinstance(exc, (KeyboardInterrupt, MemoryError)):
                raise
        finally:
            job.finished_at = time.time()
            if workspace is not None:
                workspace.close()


def _ffmpeg(job: Job, plan, out: Path, workspace) -> int:
    cmd = render_mod.build_command(plan, str(out), fast=job.fast)
    # mesmo comando da CLI, só trocando as estatísticas por progresso legível
    cmd[3:3] = ["-v", "error", "-nostats", "-progress", "pipe:1"]

    proc = subprocess.Popen(cmd, cwd=workspace.dir, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, bufsize=1)
    drain = threading.Thread(target=_drain, args=(proc.stderr, job._log), daemon=True)
    drain.start()
    for line in proc.stdout:
        _progress(job, line.strip())
    proc.stdout.close()
    code = proc.wait()
    drain.join(timeout=2)
    return code


def _drain(stream, log: deque) -> None:
    for line in stream:
        line = line.strip()
        if line:
            log.append(line)
    stream.close()


def _progress(job: Job, line: str) -> None:
    key, _, value = line.partition("=")
    value = value.strip()
    if value in ("", "N/A"):
        return
    try:
        if key == "out_time_us" or key == "out_time_ms":
            # out_time_ms do ffmpeg vem em microssegundos (bug histórico); os dois batem
            job.out_time = int(value) / 1_000_000
            if job.duration > 0:
                job.progress = max(0.0, min(1.0, job.out_time / job.duration))
                left = max(0.0, job.duration - job.out_time)
                job.eta = left / job.speed if job.speed else None
        elif key == "frame":
            job.frame = int(value)
        elif key == "fps":
            job.fps = float(value)
        elif key == "total_size":
            job.size_bytes = int(value)
        elif key == "speed":
            job.speed = float(value.rstrip("x")) or None
        elif key == "progress" and value == "end":
            job.progress = 1.0
    except ValueError:
        pass


def _error_text(job: Job, code: int) -> str:
    tail = " | ".join(list(job._log)[-6:])
    return f"ffmpeg saiu com código {code}" + (f": {tail}" if tail else "")
