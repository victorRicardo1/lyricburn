"""UI web local do lyricburn (fase 2a: só a API).

    uvicorn lyricburn.server:app --reload
    python -m lyricburn.server --port 8000
"""
from .app import app

__all__ = ["app"]
