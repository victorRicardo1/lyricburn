"""`python -m lyricburn.server` — sobe o uvicorn sem precisar decorar o caminho do app."""
from __future__ import annotations

import argparse


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="python -m lyricburn.server",
                                 description="API local da UI web do lyricburn")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reload", action="store_true", help="recarrega ao salvar (desenvolvimento)")
    args = ap.parse_args(argv)

    try:
        import uvicorn
    except ImportError:
        raise SystemExit('uvicorn não instalado. Rode: pip install -e ".[web]"')

    print(f"docs: http://{args.host}:{args.port}/docs")
    uvicorn.run("lyricburn.server:app" if args.reload else app_obj(),
                host=args.host, port=args.port, reload=args.reload)


def app_obj():
    from .app import app
    return app


if __name__ == "__main__":
    main()
