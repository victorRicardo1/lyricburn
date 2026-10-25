"""Linha de comando do lyricburn."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from . import config, lyrics, render


def _common(p: argparse.ArgumentParser) -> None:
    p.add_argument("config", nargs="?", help="arquivo .toml (opcional se passar os arquivos direto)")
    p.add_argument("--video")
    p.add_argument("--audio")
    p.add_argument("--lyrics", help=".lrc, .srt ou .vtt")
    p.add_argument("--start", help='de onde a música começa, ex: "2:26"')
    p.add_argument("--set", action="append", default=[], metavar="CHAVE=VALOR",
                   help="sobrescreve qualquer opção, ex: --set style.size=52")


def _load(args) -> dict:
    sets = list(args.set)
    for key, attr in (("input.video", "video"), ("input.audio", "audio"), ("input.lyrics", "lyrics")):
        val = getattr(args, attr)
        if val:
            sets.append(f"{key}={Path(val).resolve()}")
    if args.start:
        sets.append(f"timing.music_start={args.start}")
    return config.load(args.config, sets)


def _default_out(cfg: dict, suffix: str = ".mp4") -> str:
    if cfg["output"].get("path"):
        return cfg["output"]["path"]
    v = Path(cfg["input"]["video"])
    return str(v.with_name(v.stem + "_lyrics" + suffix))


def cmd_render(args) -> None:
    cfg = _load(args)
    out = args.output or _default_out(cfg)
    plan, ws = render.prepare(cfg)
    try:
        print(plan.summary(), "\n")
        if args.keep_ass:
            dst = Path(out).with_suffix(".ass")
            dst.write_text((ws.dir / "lyrics.ass").read_text(encoding="utf-8"), encoding="utf-8")
            print(f"legenda salva em {dst}")
        render.render(plan, ws, out, fast=args.fast)
        print(f"\npronto: {out}")
    finally:
        ws.close()


def cmd_preview(args) -> None:
    cfg = _load(args)
    times = [config.parse_time(t) for t in args.at.split(",")]
    prefix = args.output or str(Path(_default_out(cfg)).with_suffix(""))
    plan, ws = render.prepare(cfg)
    try:
        for p in render.stills(plan, ws, times, prefix):
            print(p)
    finally:
        ws.close()


def cmd_info(args) -> None:
    cfg = _load(args)
    plan, ws = render.prepare(cfg, analyze_notes=not args.no_notes)
    try:
        print(plan.summary())
    finally:
        ws.close()


def cmd_lines(args) -> None:
    """Lista as linhas da letra com o tempo, pra escolher o ponto de início."""
    for i, l in enumerate(lyrics.load(args.lyrics), 1):
        if args.grep and lyrics._norm(args.grep) not in lyrics._norm(l.text):
            continue
        m, s = divmod(l.start, 60)
        tag = " (backing)" if l.track == "back" else ""
        print(f"{i:3d}  {int(m)}:{s:05.2f}  {l.text.replace(chr(10), ' / ')}{tag}")


def cmd_init(args) -> None:
    path = Path(args.path)
    if path.exists() and not args.force:
        raise SystemExit(f"{path} já existe (use --force pra sobrescrever)")
    path.write_text(config.EXAMPLE, encoding="utf-8")
    print(f"criado {path}")


def cmd_fetch(args) -> None:
    """Baixa a letra sincronizada do LRCLIB (lrclib.net)."""
    q = {"artist_name": args.artist, "track_name": args.title}
    headers = {"User-Agent": "lyricburn/0.1 (https://github.com/)"}

    def get(url):
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))

    data = None
    try:
        data = get("https://lrclib.net/api/get?" + urllib.parse.urlencode(q))
    except Exception:
        pass
    if not data or not data.get("syncedLyrics"):
        results = get("https://lrclib.net/api/search?" + urllib.parse.urlencode(q))
        data = next((r for r in results if r.get("syncedLyrics")), None)
    if not data:
        raise SystemExit("Não achei letra sincronizada no LRCLIB pra essa música.")
    out = Path(args.output or f"{args.artist} - {args.title}.lrc")
    out.write_text(data["syncedLyrics"], encoding="utf-8")
    print(f"salvo em {out}")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="lyricburn",
                                 description="Queima letra sincronizada em cima de vídeo de gameplay.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("render", help="renderiza o vídeo final")
    _common(p)
    p.add_argument("-o", "--output")
    p.add_argument("--fast", action="store_true", help="render rápido, qualidade menor (pra testar)")
    p.add_argument("--keep-ass", action="store_true", help="salva também o .ass gerado")
    p.set_defaults(func=cmd_render)

    p = sub.add_parser("preview", help="gera frames .png com a legenda em instantes específicos")
    _common(p)
    p.add_argument("--at", required=True, help='instantes do vídeo, ex: "3,10,0:22"')
    p.add_argument("-o", "--output", help="prefixo dos arquivos")
    p.set_defaults(func=cmd_preview)

    p = sub.add_parser("info", help="mostra o que foi detectado (duração, pausas, notas)")
    _common(p)
    p.add_argument("--no-notes", action="store_true", help="pula a análise de notas (mais rápido)")
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("lines", help="lista as linhas da letra com tempo")
    p.add_argument("lyrics")
    p.add_argument("--grep", help="filtra por um trecho")
    p.set_defaults(func=cmd_lines)

    p = sub.add_parser("init", help="cria um arquivo de configuração de exemplo")
    p.add_argument("path", nargs="?", default="lyricburn.toml")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("fetch", help="baixa o .lrc do LRCLIB")
    p.add_argument("artist")
    p.add_argument("title")
    p.add_argument("-o", "--output")
    p.set_defaults(func=cmd_fetch)

    args = ap.parse_args(argv)
    try:
        args.func(args)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
