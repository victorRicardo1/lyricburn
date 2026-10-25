"""Leitura de letras sincronizadas: .lrc, .srt e .vtt -> lista de Line (tempo da música)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Line:
    start: float
    end: float
    text: str
    track: str = "main"   # "main" ou "back" (backing vocal, linha inteira entre parênteses)


def _read(path: str) -> str:
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _track(text: str) -> tuple[str, str]:
    t = text.strip()
    if len(t) > 2 and t.startswith("(") and t.endswith(")"):
        return t[1:-1].strip(), "back"
    return t, "main"


# ---------- LRC ----------
_LRC_TS = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\]")
_LRC_WORD_TS = re.compile(r"<\d+:\d+(?:[.:]\d+)?>")
_LRC_OFFSET = re.compile(r"\[offset:\s*([+-]?\d+)\]", re.I)


def parse_lrc(content: str, hold: float = 4.0) -> list[Line]:
    offset = 0.0
    m = _LRC_OFFSET.search(content)
    if m:  # no padrão LRC, offset positivo faz a letra aparecer antes
        offset = int(m.group(1)) / 1000.0

    stamps: list[tuple[float, str]] = []
    for raw in content.splitlines():
        found = _LRC_TS.findall(raw)
        if not found:
            continue
        text = _LRC_WORD_TS.sub("", _LRC_TS.sub("", raw)).strip()
        for mm, ss in found:
            t = int(mm) * 60 + float(ss.replace(":", "."))
            stamps.append((t - offset, text))
    stamps.sort(key=lambda x: x[0])

    lines: list[Line] = []
    for i, (t, txt) in enumerate(stamps):
        if not txt:
            continue
        text, track = _track(txt)
        end = None
        # a linha dura até a próxima da mesma "faixa" (principal/backing) ou até uma pausa (linha vazia)
        for t2, txt2 in stamps[i + 1:]:
            if t2 <= t:
                continue
            if not txt2 or _track(txt2)[1] == track:
                end = t2
                break
        lines.append(Line(t, end if end is not None else t + hold, text, track))
    return lines


# ---------- SRT / VTT ----------
_SUB_TS = re.compile(
    r"(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})"
)
_TAGS = re.compile(r"<[^>]+>|\{\\[^}]*\}")


def _ts(h, m, s, ms) -> float:
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


def parse_srt(content: str) -> list[Line]:
    """Serve pra .srt e .vtt (blocos separados por linha em branco)."""
    lines: list[Line] = []
    blocks = re.split(r"\n\s*\n", content.replace("\r\n", "\n").replace("\r", "\n"))
    for block in blocks:
        rows = [r for r in block.split("\n") if r.strip()]
        for i, row in enumerate(rows):
            m = _SUB_TS.search(row)
            if not m:
                continue
            g = m.groups()
            start, end = _ts(*g[0:4]), _ts(*g[4:8])
            text_rows = [_TAGS.sub("", r).strip() for r in rows[i + 1:]]
            text_rows = [r for r in text_rows if r]
            if not text_rows or end <= start:
                break
            # cada linha do bloco pode ser principal ou backing vocal
            main = [r for r in text_rows if _track(r)[1] == "main"]
            back = [_track(r)[0] for r in text_rows if _track(r)[1] == "back"]
            if main:
                lines.append(Line(start, end, "\n".join(main), "main"))
            if back:
                lines.append(Line(start, end, "\n".join(back), "back"))
            break
    lines.sort(key=lambda l: l.start)
    return lines


def load(path: str) -> list[Line]:
    ext = Path(path).suffix.lower()
    content = _read(path)
    if ext == ".lrc":
        return parse_lrc(content)
    if ext in (".srt", ".vtt"):
        return parse_srt(content)
    # sem extensão conhecida: tenta detectar pelo conteúdo
    if _LRC_TS.search(content):
        return parse_lrc(content)
    if _SUB_TS.search(content):
        return parse_srt(content)
    raise SystemExit(f"Formato de letra não reconhecido: {path} (use .lrc, .srt ou .vtt)")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", s.lower())).strip()


def find_lines(lines: list[Line], query: str) -> list[Line]:
    """Todas as linhas principais que contêm o texto (ignora pontuação e maiúsculas)."""
    q = _norm(query)
    return [l for l in lines if l.track == "main" and q in _norm(l.text)]
