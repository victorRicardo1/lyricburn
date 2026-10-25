"""Análise de mídia com ffprobe/ffmpeg e (opcionalmente) librosa."""
from __future__ import annotations

import json
import re
import shutil
import subprocess


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"'{tool}' não encontrado no PATH. Instale o ffmpeg primeiro.")


def probe(path: str) -> dict:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation:format=duration",
         "-of", "json", path])
    return json.loads(out)


def duration(path: str) -> float:
    return float(probe(path)["format"]["duration"])


def has_audio(path: str) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(path).get("streams", []))


def video_size(path: str) -> tuple[int, int]:
    for s in probe(path).get("streams", []):
        if s.get("codec_type") == "video":
            w, h = int(s["width"]), int(s["height"])
            rot = s.get("tags", {}).get("rotate")
            if rot is None:
                for sd in s.get("side_data_list", []) or []:
                    if "rotation" in sd:
                        rot = sd["rotation"]
            if rot is not None and abs(int(float(rot))) % 180 == 90:
                w, h = h, w   # vídeo de celular gravado em pé
            return w, h
    raise SystemExit(f"Nenhum stream de vídeo em {path}")


def music_end(path: str, start: float) -> float:
    """Duração útil da música a partir de `start`, ignorando o silêncio no fim do arquivo."""
    total = duration(path) - start
    log = subprocess.run(
        ["ffmpeg", "-hide_banner", "-ss", str(start), "-i", path, "-vn",
         "-af", "silencedetect=n=-45dB:d=0.5", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    if starts:
        tail_open = len(ends) < len(starts)
        tail_at_eof = ends and ends[-1] >= total - 0.15
        if tail_open or tail_at_eof:
            return max(0.5, starts[-1] + 0.2)
    return total


def extract_wav(path: str, start: float, length: float, out_wav: str) -> None:
    # passa pelo ffmpeg: aceita qualquer formato (inclusive "mp3" que na verdade é AAC)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", f"{length:.3f}",
                    "-i", path, "-vn", "-ac", "1", "-ar", "22050", out_wav], check=True)


def detect_notes(wav: str, gaps: list[tuple[float, float]]) -> dict | None:
    """Para cada pausa (em segundos do wav), lista de (tempo, força 0–1, altura 0–1).
    Retorna None se o librosa não estiver instalado."""
    try:
        import numpy as np
        import librosa
    except ImportError:
        return None

    y, sr = librosa.load(wav, sr=22050)
    hop = 256
    result = {}
    for a, b in gaps:
        seg = y[int(max(a, 0) * sr):int(b * sr)]
        notes = []
        if len(seg) > 2048:
            env = librosa.onset.onset_strength(y=seg, sr=sr, hop_length=hop)
            frames = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop,
                                                delta=0.15, wait=6)
            if len(frames):
                S = np.abs(librosa.stft(seg, n_fft=2048, hop_length=hop))
                cent = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
                strength = env[frames] / (env[frames].max() + 1e-9)
                pitch = np.log(np.array([np.median(cent[f:f + 6]) + 1 for f in frames]))
                pn = (pitch - pitch.min()) / (pitch.max() - pitch.min() + 1e-9)
                last = -1.0
                for f, s, p in zip(frames, strength, pn):
                    t = max(a, 0) + librosa.frames_to_time(f, sr=sr, hop_length=hop)
                    if s < 0.3 or t - last < 0.11:
                        continue
                    notes.append((float(t), float(s), float(p)))
                    last = t
        result[(a, b)] = notes
    return result
