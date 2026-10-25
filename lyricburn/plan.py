"""Monta a linha do tempo do vídeo: o que é detectado automaticamente a partir dos arquivos."""
from __future__ import annotations

from dataclasses import dataclass, field

from . import audio, lyrics
from .config import parse_time


@dataclass
class Plan:
    cfg: dict
    music_start: float          # segundo da música onde o vídeo começa a tocar
    video_offset: float         # segundo do vídeo onde a música entra
    duration: float             # duração final do vídeo
    width: int
    height: int
    has_game_audio: bool
    lines: list = field(default_factory=list)   # Line em tempo do VÍDEO, já recortadas
    gaps: list = field(default_factory=list)    # (início, fim) sem voz, em tempo do vídeo
    notes: dict | None = None                   # notas detectadas em cada pausa
    warnings: list = field(default_factory=list)

    def summary(self) -> str:
        def mmss(t):
            return f"{int(t // 60)}:{t % 60:05.2f}"
        out = [
            f"Música a partir de   {mmss(self.music_start)}",
            f"Entra no vídeo em    {mmss(self.video_offset)}",
            f"Duração final        {mmss(self.duration)}",
            f"Resolução            {self.width}x{self.height}",
            f"Som do jogo          {'sim' if self.has_game_audio else 'não (vídeo sem áudio)'}",
            f"Linhas de letra      {len(self.lines)}",
            "Pausas instrumentais " + (", ".join(f"{mmss(a)}–{mmss(b)}" for a, b in self.gaps) or "nenhuma"),
        ]
        if self.notes is not None:
            n = sum(len(v) for v in self.notes.values())
            out.append(f"Notas detectadas     {n}")
        for w in self.warnings:
            out.append(f"aviso: {w}")
        return "\n".join(out)


def resolve_start(cfg: dict, all_lines: list) -> tuple[float, list[str]]:
    t = cfg["timing"]
    warnings = []
    query = str(t.get("start_at_lyric") or "").strip()
    if query:
        matches = lyrics.find_lines(all_lines, query)
        if not matches:
            raise SystemExit(f'Nenhuma linha da letra contém "{query}".')
        occ = int(t.get("occurrence", 1))
        if occ < 1 or occ > len(matches):
            raise SystemExit(f'"{query}" aparece {len(matches)}x na letra; occurrence={occ} não existe.')
        line = matches[occ - 1]
        start = max(0.0, line.start - float(t.get("lead_in", 2.0)))
        if len(matches) > 1:
            warnings.append(f'"{query}" aparece {len(matches)}x na letra; usando a {occ}ª '
                            f'(mude com timing.occurrence — veja `lyricburn lines arquivo.lrc --grep "..."`)')
        return start, warnings
    return parse_time(t.get("music_start", 0)), warnings


def build(cfg: dict, analyze_notes: bool = True, work_wav: str | None = None) -> Plan:
    audio.require_ffmpeg()
    inp, t, st = cfg["input"], cfg["timing"], cfg["style"]
    for k in ("video", "audio", "lyrics"):
        if not inp.get(k):
            raise SystemExit(f"Falta o arquivo de entrada: input.{k}")

    all_lines = lyrics.load(inp["lyrics"])
    music_start, warnings = resolve_start(cfg, all_lines)
    video_offset = parse_time(t.get("video_offset", 0))
    lyrics_offset = float(t.get("lyrics_offset", 0))

    vid_dur = audio.duration(inp["video"])
    music_len = audio.music_end(inp["audio"], music_start)
    music_until = video_offset + music_len

    mode = str(t.get("end", "auto"))
    if mode == "video":
        dur = vid_dur
    elif mode == "music":
        dur = min(music_until, vid_dur)
        if music_until > vid_dur:
            warnings.append("a música passa do fim do vídeo; cortando no fim do vídeo")
    else:
        dur = min(vid_dur, music_until)
    max_d = parse_time(t.get("max_duration", 0))
    if max_d > 0:
        dur = min(dur, max_d)

    vw, vh = audio.video_size(inp["video"])
    res = int(cfg["video"].get("resolution", cfg["video"].get("height", 720)))
    if vw >= vh:   # horizontal: altura = resolução
        H = res // 2 * 2
        W = int(round(vw * H / vh / 2)) * 2
    else:          # vertical (Reels/TikTok): largura = resolução
        W = res // 2 * 2
        H = int(round(vh * W / vw / 2)) * 2

    shift = video_offset - music_start + lyrics_offset
    lines = []
    for l in all_lines:
        a, b = l.start + shift, l.end + shift
        if b <= max(video_offset, 0) or a >= dur:
            continue
        lines.append(lyrics.Line(max(a, video_offset, 0), min(b, dur), l.text, l.track))

    gaps = []
    if cfg["dots"].get("enabled", True):
        min_gap = float(cfg["dots"].get("min_gap", 1.2))
        cur = max(video_offset, 0.0)
        for a, b in sorted((l.start, l.end) for l in lines):
            if a - cur >= min_gap:
                gaps.append((cur, a))
            cur = max(cur, b)
        if dur - cur >= min_gap:
            gaps.append((cur, dur))

    plan = Plan(cfg, music_start, video_offset, dur, W, H, audio.has_audio(inp["video"]),
                lines, gaps, None, warnings)

    if gaps and analyze_notes and cfg["dots"].get("reactive", True) and work_wav:
        # analisa o wav no tempo da música e devolve no tempo do vídeo
        audio.extract_wav(inp["audio"], music_start, dur - video_offset + 0.5, work_wav)
        local = [(a - video_offset, b - video_offset) for a, b in gaps]
        found = audio.detect_notes(work_wav, local)
        if found is None:
            warnings.append("librosa não instalado: pontinhos ficam estáticos (pip install librosa)")
        else:
            plan.notes = {
                (a + video_offset, b + video_offset): [(nt + video_offset, s, p) for nt, s, p in found[(a, b)]]
                for a, b in local
            }
    return plan
