"""API local da UI web do lyricburn.

Um projeto = os três arquivos de entrada (vídeo, música, letra) já analisados.
A partir dele a UI pede quantos `/plan` quiser (barato, com cache) e, quando estiver
satisfeita, um `/render` (job em background com progresso).

    uvicorn lyricburn.server:app --reload      # ou: python -m lyricburn.server

A CLI não é tocada: as rotas chamam os mesmos `plan.build` → `ass.build` → ffmpeg.
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
import subprocess
from contextlib import asynccontextmanager, contextmanager
from typing import Literal

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from ..audio import require_ffmpeg
from ..config import DEFAULTS
from . import fonts as fonts_mod
from . import beats as beats_mod
from . import jobs, media, planning, preview, settings, store
from .schemas import (DefaultsOut, FontsOut, JobOut, PlanOut, PlanRequest, ProjectOut,
                      RenderRequest)

DESCRIPTION = """
UI local pra queimar letra sincronizada em vídeo.

1. `POST /projects` — sobe vídeo, música e letra; devolve metadados, as linhas e a waveform.
2. `POST /projects/{id}/plan` — manda a config, recebe o `.ass` e o resumo do que foi detectado.
3. `POST /projects/{id}/render` — renderiza em background; acompanhe em `GET /jobs/{id}`.
"""

@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.ensure_dirs()
    yield


app = FastAPI(
    title="lyricburn",
    version="0.1.0",
    description=DESCRIPTION,
    lifespan=lifespan,
    openapi_tags=[
        {"name": "projetos", "description": "entradas e o que foi detectado nelas"},
        {"name": "plan", "description": "config → legenda .ass + resumo"},
        {"name": "jobs", "description": "render em background e progresso"},
        {"name": "fontes", "description": "fontes disponíveis pro style.font e pro preview"},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Content-Disposition"],
)


@contextmanager
def _core_errors():
    """O núcleo usa `SystemExit` pra erro de usuário — aqui isso é 400, não queda do servidor."""
    try:
        yield
    except HTTPException:
        raise
    except SystemExit as exc:
        raise HTTPException(400, str(exc) or "entrada inválida") from None
    except subprocess.CalledProcessError as exc:
        raise HTTPException(400, f"ffmpeg falhou ({exc.returncode}) ao ler os arquivos de entrada") from None
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(400, f"config inválida: {exc}") from None


def project_dep(project_id: str) -> store.Project:
    project = store.load(project_id)
    if project is None:
        raise HTTPException(404, f"projeto {project_id} não existe")
    return project


CurrentProject = Depends(project_dep)


# ---------- projetos ----------

@app.post("/projects", response_model=ProjectOut, tags=["projetos"],
          summary="Sobe os três arquivos e analisa")
async def create_project(
    video: UploadFile = File(..., description="vídeo de fundo (gameplay, clipe...)"),
    audio: UploadFile = File(..., description="música"),
    lyrics: UploadFile = File(..., description="letra .lrc, .srt ou .vtt"),
    peaks: int = Query(settings.PEAK_BUCKETS, ge=16, le=20000,
                       description="quantas barras na waveform"),
):
    with _core_errors():
        require_ffmpeg()
        project = await store.create(video, audio, lyrics, peak_buckets=peaks)
    return _project_out(project)


@app.get("/projects/{project_id}", response_model=ProjectOut, tags=["projetos"],
         summary="Relê um projeto já analisado")
def read_project(project: store.Project = CurrentProject):
    return _project_out(project)


def _project_out(project: store.Project) -> dict:
    data = project.as_dict()
    data["media"] = {
        "video": f"/projects/{project.id}/media/video",
        "audio": f"/projects/{project.id}/media/audio",
    }
    return data


@app.get("/projects/{project_id}/media/{kind}", tags=["projetos"],
         summary="Serve o vídeo ou a música (aceita Range, pra dar seek no <video>)")
def project_media(kind: Literal["video", "audio"], project: store.Project = CurrentProject):
    path = project.path(kind)
    if not path.is_file():
        raise HTTPException(404, f"arquivo {kind} não está mais no disco")
    guess, _ = mimetypes.guess_type(path.name)
    return FileResponse(path, media_type=guess or "application/octet-stream",
                        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-cache"})


@app.api_route("/projects/{project_id}/preview", methods=["GET", "HEAD"], tags=["projetos"],
               summary="Cópia leve do vídeo que o navegador toca",
               responses={200: {"content": {"video/mp4": {}, "video/webm": {}}},
                          202: {"description": "ainda sendo gerada — tente de novo em instantes"}})
def project_preview(
    fmt: Literal["mp4", "webm"] = Query("mp4", alias="format",
                                        description="mp4 = H.264/AAC · webm = VP9/Opus"),
    project: store.Project = CurrentProject,
):
    """Pro caso do original ser .mkv/HEVC (ou de o navegador não ter H.264).

    Gera na primeira chamada e guarda em disco. Enquanto isso responde 202 —
    um HEAD aqui serve pra saber se já está pronta sem baixar nada.
    """
    with _core_errors():
        state = preview.ensure(project, fmt)
    if state.error:
        raise HTTPException(500, f"não consegui gerar a prévia: {state.error}")
    if not state.ready:
        return JSONResponse({"status": "building", "format": fmt}, status_code=202)
    return FileResponse(preview.path_for(project, fmt), media_type=preview.media_type(fmt),
                        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-cache"})


@app.get("/projects/{project_id}/peaks", tags=["projetos"],
         summary="Waveform em outra resolução (a timeline pede mais barras pro zoom)")
async def project_peaks(
    buckets: int = Query(8000, ge=16, le=20000, description="quantas barras"),
    project: store.Project = CurrentProject,
):
    """O `POST /projects` devolve uma waveform leve; com zoom ela vira blocos. Esta
    rota decodifica de novo na resolução pedida e guarda em disco por tamanho."""
    cache = project.work_dir / f"peaks_{buckets}.json"
    if cache.is_file():
        return json.loads(cache.read_text(encoding="utf-8"))
    with _core_errors():
        result = await asyncio.to_thread(media.peaks, str(project.path("audio")), buckets)
    cache.write_text(json.dumps(result), encoding="utf-8")
    return result


@app.get("/projects/{project_id}/beats", tags=["projetos"],
         summary="Beats da música inteira (pro snap da timeline)")
async def project_beats(project: store.Project = CurrentProject):
    """`librosa.beat.beat_track` no áudio todo, em segundos da música.

    A primeira chamada analisa (alguns segundos); as seguintes vêm do cache em disco.
    """
    with _core_errors():
        result = await asyncio.to_thread(beats_mod.get, project)
    if result is None:
        raise HTTPException(501, "librosa não instalado: pip install librosa")
    return result


# ---------- plan ----------

@app.post("/projects/{project_id}/plan", response_model=PlanOut, tags=["plan"],
          summary="Config → .ass + resumo do que foi detectado")
async def make_plan(body: PlanRequest, project: store.Project = CurrentProject):
    with _core_errors():
        cfg, ignored = planning.merge_config(project, body.sections())
        plan = await asyncio.to_thread(planning.build_plan, project, cfg)
        ass_text = planning.build_ass(plan)
    return {
        "project_id": project.id,
        "summary": planning.summarize(plan, ignored),
        "ass": ass_text,
        "config": cfg,
    }


# ---------- render ----------

@app.post("/projects/{project_id}/render", response_model=JobOut, status_code=202, tags=["jobs"],
          summary="Começa o render em background")
async def start_render(body: RenderRequest, project: store.Project = CurrentProject):
    with _core_errors():
        cfg, _ignored = planning.merge_config(project, body.sections())
    job = jobs.start(project, cfg, fast=body.fast)
    return job.as_dict()


@app.get("/jobs/{job_id}", response_model=JobOut, tags=["jobs"],
         summary="Progresso do render")
def read_job(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id} não existe")
    return job.as_dict()


@app.api_route("/jobs/{job_id}/video", methods=["GET", "HEAD"], tags=["jobs"],
               summary="Toca o vídeo pronto no navegador (sem baixar)",
               responses={202: {"description": "convertendo pra webm"}})
def job_video(
    job_id: str,
    fmt: Literal["mp4", "webm"] = Query("mp4", alias="format",
                                        description="mp4 = o arquivo renderizado · webm = cópia leve"),
):
    """Mesmo arquivo do download, mas servido pra tocar embutido.

    O `/download` manda `Content-Disposition: attachment`, que é o certo pra baixar
    e atrapalha quem só quer ver. `format=webm` devolve uma cópia pequena, pra
    navegador sem H.264 — a mesma máquina da prévia do vídeo de entrada.
    """
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id} não existe")
    if job.status != "done":
        raise HTTPException(409, job.message or f"job ainda está em {job.status}")
    source = job.output
    if source is None:
        raise HTTPException(410, "o arquivo renderizado não está mais no disco")

    if fmt == "mp4":
        return FileResponse(source, media_type="video/mp4",
                            headers={"Accept-Ranges": "bytes", "Cache-Control": "no-cache"})

    target = source.with_suffix(".webm")
    state = preview.ensure_file(source, target, "webm", f"job:{job_id}:webm")
    if state.error:
        raise HTTPException(500, f"não consegui converter o vídeo pronto: {state.error}")
    if not state.ready:
        return JSONResponse({"status": "building", "format": fmt}, status_code=202)
    return FileResponse(target, media_type="video/webm",
                        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-cache"})


@app.get("/jobs/{job_id}/download", tags=["jobs"], summary="Baixa o vídeo pronto")
def download_job(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id} não existe")
    if job.status != "done":
        detail = job.message or f"job ainda está em {job.status}"
        raise HTTPException(409, detail)
    path = job.output
    if path is None:
        raise HTTPException(410, "o arquivo renderizado não está mais no disco")
    return FileResponse(path, media_type="video/mp4", filename=job.filename,
                        headers={"Accept-Ranges": "bytes"})


# ---------- fontes ----------

@app.get("/fonts", response_model=FontsOut, tags=["fontes"],
         summary="Fontes disponíveis e os nomes de família pro style.font")
def list_fonts():
    return fonts_mod.listing()


@app.get("/fonts/{nome}", tags=["fontes"],
         summary="Baixa o arquivo da fonte (o preview carrega daqui)")
def get_font(nome: str):
    path = fonts_mod.resolve(nome)
    if path is None:
        raise HTTPException(404, f"fonte {nome} não encontrada")
    return FileResponse(path, media_type=fonts_mod.media_type(path),
                        headers={"Cache-Control": "public, max-age=86400"})


# ---------- config ----------

@app.get("/config/defaults", response_model=DefaultsOut, tags=["plan"],
         summary="Defaults do lyricburn, pra UI montar o formulário")
def config_defaults():
    return {"defaults": DEFAULTS}
