"""Beats da música inteira (librosa.beat.beat_track), pro snap da timeline.

É a mesma ideia do cache de notas: a análise é cara (alguns segundos numa música
de 4 minutos) e o resultado só depende do arquivo de áudio, que nunca muda depois
do upload. Então roda uma vez por projeto e fica em `<projeto>/beats.json`.
"""
from __future__ import annotations

import json
import threading

from .. import audio
from .store import Project

_LOCK = threading.Lock()


def get(project: Project) -> dict | None:
    """{"tempo": bpm, "beats": [segundos...]} ou None se o librosa não estiver instalado.

    Bloqueante — chame numa thread. O lock evita duas análises simultâneas do
    mesmo arquivo quando a UI pede duas vezes seguidas.
    """
    cache = project.dir / "beats.json"
    with _LOCK:
        if cache.is_file():
            return json.loads(cache.read_text(encoding="utf-8"))

        try:
            import librosa
        except ImportError:
            return None

        # passa pelo ffmpeg como o resto: aceita qualquer formato, inclusive "mp3" que é AAC
        wav = project.work_dir / "beats.wav"
        length = project.meta["audio"]["duration"] + 0.5
        audio.extract_wav(str(project.path("audio")), 0.0, length, str(wav))
        try:
            y, sr = librosa.load(str(wav), sr=22050)
            tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
        finally:
            wav.unlink(missing_ok=True)

        tempo = float(tempo[0] if getattr(tempo, "ndim", 0) else tempo)
        result = {"tempo": round(tempo, 2), "beats": [round(float(t), 3) for t in beats]}
        cache.write_text(json.dumps(result), encoding="utf-8")
        return result
