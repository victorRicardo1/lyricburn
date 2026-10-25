"""Renderização com ffmpeg.

O ffmpeg roda dentro de uma pasta temporária, referenciando a legenda e as fontes por caminho
relativo: o filtro `subtitles` é chato com caminhos absolutos no Windows (C:\\...)."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from . import ass as ass_mod
from . import plan as plan_mod

PKG_FONTS = Path(__file__).parent / "fonts"


class Workspace:
    def __init__(self, cfg: dict):
        self.dir = Path(tempfile.mkdtemp(prefix="lyricburn_"))
        fonts = self.dir / "fonts"
        fonts.mkdir()
        for src in (PKG_FONTS, Path(cfg["style"].get("fonts_dir") or "")):
            if src and src.is_dir() and str(src) != ".":
                for f in src.iterdir():
                    if f.suffix.lower() in (".ttf", ".otf", ".ttc"):
                        shutil.copy2(f, fonts / f.name)
        self.wav = str(self.dir / "music.wav")

    def write_ass(self, text: str) -> None:
        (self.dir / "lyrics.ass").write_text(text, encoding="utf-8")

    def close(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)


SUBS = "subtitles=lyrics.ass:fontsdir=fonts"


def prepare(cfg: dict, analyze_notes: bool = True):
    ws = Workspace(cfg)
    plan = plan_mod.build(cfg, analyze_notes=analyze_notes, work_wav=ws.wav)
    ws.write_ass(ass_mod.build(plan))
    return plan, ws


def build_command(plan, out_path: str, fast: bool = False) -> list[str]:
    """Monta o argv do ffmpeg do render final (roda com cwd na pasta do Workspace).

    Separado de `render` pra quem precisa acompanhar o progresso rodar o mesmo
    comando com `-progress` (a UI web faz isso)."""
    cfg = plan.cfg
    inp, a, v = cfg["input"], cfg["audio"], cfg["video"]
    dur = plan.duration
    fo = max(0.0, dur - float(v.get("fade_out", 0)))

    vf = f"[0:v]scale={plan.width}:{plan.height}:flags=lanczos,setsar=1,{SUBS}"
    if v.get("fade_in", 0) > 0:
        vf += f",fade=t=in:st=0:d={v['fade_in']}"
    if v.get("fade_out", 0) > 0:
        vf += f",fade=t=out:st={fo:.3f}:d={v['fade_out']}"
    vf += "[v]"

    delay_ms = int(round(plan.video_offset * 1000))
    music = f"[1:a]aresample=48000,volume={a['music_volume']}"
    if a.get("music_fade_in", 0) > 0:
        music += f",afade=t=in:st=0:d={a['music_fade_in']}"
    if delay_ms > 0:
        music += f",adelay={delay_ms}:all=1"
    graph = [vf]

    use_game = plan.has_game_audio and float(a.get("game_volume", 0)) > 0
    if use_game:
        game = f"[0:a]aresample=48000,volume={a['game_volume']}"
        if a.get("duck"):
            graph.append(music + ",asplit=2[m][msc]")
            graph.append(game + "[g0]")
            # comprime o jogo quando a música está alta
            graph.append("[g0][msc]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400[g]")
        else:
            graph.append(music + "[m]")
            graph.append(game + "[g]")
        mix = "[g][m]amix=inputs=2:duration=longest:normalize=0"
    else:
        graph.append(music + "[m]")
        mix = "[m]anull"
    if v.get("fade_out", 0) > 0:
        mix += f",afade=t=out:st={fo:.3f}:d={v['fade_out']}"
    graph.append(mix + "[a]")

    cmd = ["ffmpeg", "-y", "-hide_banner",
           "-i", str(Path(inp["video"]).resolve()),
           "-ss", f"{plan.music_start:.3f}", "-i", str(Path(inp["audio"]).resolve()),
           "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]",
           "-t", f"{dur:.3f}",
           "-c:v", "libx264", "-crf", str(26 if fast else v.get("crf", 22)),
           "-preset", "veryfast" if fast else v.get("preset", "slow"),
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
           str(Path(out_path).resolve())]
    return cmd


def render(plan, ws: Workspace, out_path: str, fast: bool = False, quiet: bool = False) -> None:
    cmd = build_command(plan, out_path, fast=fast)
    cmd[3:3] = ["-v", "error"] if quiet else ["-v", "error", "-stats"]
    subprocess.run(cmd, check=True, cwd=ws.dir)


def stills(plan, ws: Workspace, times: list[float], out_prefix: str) -> list[str]:
    """Frames de prévia com a legenda, sem renderizar o vídeo todo."""
    paths = []
    for t in times:
        out = str(Path(f"{out_prefix}_{t:g}s.png").resolve())
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}",
             "-i", str(Path(plan.cfg["input"]["video"]).resolve()), "-frames:v", "1",
             "-vf", f"scale={plan.width}:{plan.height}:flags=lanczos,setsar=1,setpts=PTS+{t:.3f}/TB,{SUBS}",
             out], check=True, cwd=ws.dir)
        paths.append(out)
    return paths
