"""Lista e serve as fontes disponíveis.

A UI precisa dos nomes de família de verdade (é o que vai em `style.font` e o que o
libass procura), então lê a tabela `name` do .ttf/.otf direto — sem depender do fontTools.
"""
from __future__ import annotations

import struct
from pathlib import Path

from ..render import PKG_FONTS
from . import settings

SUFFIXES = (".ttf", ".otf", ".ttc")
MEDIA_TYPES = {".ttf": "font/ttf", ".otf": "font/otf", ".ttc": "font/collection"}

# nameID da tabela `name` do OpenType
_FAMILY, _SUBFAMILY, _FULL, _TYPO_FAMILY, _TYPO_SUBFAMILY = 1, 2, 4, 16, 17


def _tables(data: bytes, base: int = 0) -> dict[bytes, tuple[int, int]]:
    num = struct.unpack_from(">H", data, base + 4)[0]
    out = {}
    for i in range(num):
        tag, _, offset, length = struct.unpack_from(">4sIII", data, base + 12 + i * 16)
        out[tag] = (offset, length)
    return out


def _decode(raw: bytes, platform_id: int) -> str:
    if platform_id == 3 or (platform_id == 0 and len(raw) > 1 and raw[0] == 0):
        return raw.decode("utf-16-be", errors="replace")
    return raw.decode("latin-1", errors="replace")


def _names(data: bytes, table: tuple[int, int]) -> dict[int, str]:
    offset, _ = table
    _fmt, count, string_offset = struct.unpack_from(">HHH", data, offset)
    strings = offset + string_offset
    found: dict[int, str] = {}
    for i in range(count):
        plat, _enc, _lang, name_id, length, str_off = struct.unpack_from(
            ">HHHHHH", data, offset + 6 + i * 12)
        if name_id not in (_FAMILY, _SUBFAMILY, _FULL, _TYPO_FAMILY, _TYPO_SUBFAMILY):
            continue
        raw = data[strings + str_off:strings + str_off + length]
        value = _decode(raw, plat).strip()
        # platform 3 (Windows) é o que o libass prefere; não deixa um nome Mac sobrescrever
        if value and (name_id not in found or plat == 3):
            found[name_id] = value
    return found


def read_font(path: Path) -> dict:
    """Nomes e estilo de um arquivo de fonte. Nunca levanta: arquivo quebrado vira fallback."""
    info = {
        "file": path.name,
        "family": path.stem,
        "full_name": None,
        "subfamily": None,
        "typographic_family": None,
        "italic": False,
        "bold": False,
        "weight": None,
        "bytes": path.stat().st_size,
    }
    try:
        data = path.read_bytes()
        base = 0
        if data[:4] == b"ttcf":   # coleção: lê só a primeira fonte
            base = struct.unpack_from(">I", data, 12)[0]
        tables = _tables(data, base)

        if b"name" in tables:
            names = _names(data, tables[b"name"])
            info["family"] = names.get(_FAMILY) or info["family"]
            info["full_name"] = names.get(_FULL)
            info["subfamily"] = names.get(_TYPO_SUBFAMILY) or names.get(_SUBFAMILY)
            typo = names.get(_TYPO_FAMILY)
            info["typographic_family"] = typo if typo and typo != info["family"] else None

        if b"head" in tables:
            mac_style = struct.unpack_from(">H", data, tables[b"head"][0] + 44)[0]
            info["bold"] = bool(mac_style & 1)
            info["italic"] = bool(mac_style & 2)

        if b"OS/2" in tables:
            info["weight"] = struct.unpack_from(">H", data, tables[b"OS/2"][0] + 4)[0]
    except Exception:
        pass   # fonte ilegível ainda aparece na lista, com o nome do arquivo
    return info


def _dirs() -> list[tuple[str, Path]]:
    out = [("builtin", PKG_FONTS)]
    if settings.EXTRA_FONTS_DIR:
        out.append(("extra", settings.EXTRA_FONTS_DIR))
    return out


def listing() -> dict:
    """Fontes disponíveis + as famílias que podem ir em `style.font`."""
    fonts, families = [], []
    for source, directory in _dirs():
        if not directory.is_dir():
            continue
        for path in sorted(directory.iterdir()):
            if path.suffix.lower() not in SUFFIXES or not path.is_file():
                continue
            info = read_font(path)
            info["source"] = source
            info["url"] = f"/fonts/{path.name}"
            fonts.append(info)
            for name in (info["family"], info["typographic_family"]):
                if name and name not in families:
                    families.append(name)
    return {"fonts": fonts, "families": sorted(families)}


def resolve(name: str) -> Path | None:
    """Caminho de uma fonte pelo nome do arquivo. Recusa qualquer coisa com separador."""
    if not name or "/" in name or "\\" in name or name != Path(name).name or name.startswith("."):
        return None
    if Path(name).suffix.lower() not in SUFFIXES:
        return None
    for _source, directory in _dirs():
        candidate = directory / name
        if candidate.is_file() and candidate.parent.resolve() == directory.resolve():
            return candidate
    return None


def media_type(path: Path) -> str:
    return MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
