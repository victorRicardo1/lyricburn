"""Gera o arquivo .ass (legenda estilizada) a partir do Plan."""
from __future__ import annotations

from .plan import Plan


def _ts(s: float) -> str:
    s = max(0.0, s)
    cs = int(round(s * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    sec, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{sec:02d}.{cs:02d}"


def _color(hex_color: str, alpha: float = 1.0) -> str:
    """'#RRGGBB' + opacidade (0–1) -> '&HAABBGGRR' do ASS (alpha invertido)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    a = 255 - int(round(max(0.0, min(1.0, alpha)) * 255))
    return f"&H{a:02X}{b}{g}{r}".upper()


def _escape(text: str) -> str:
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").replace("\n", "\\N")


def _y_for(position, H: int) -> float:
    named = {"center": 0.5, "middle": 0.5, "bottom": 0.86, "top": 0.14}
    if isinstance(position, (int, float)):
        return H * float(position)
    return H * named.get(str(position).lower(), 0.5)


def _circle(r: float) -> str:
    k = 0.5523 * r
    return (f"m 0 {-r:.1f} b {k:.1f} {-r:.1f} {r:.1f} {-k:.1f} {r:.1f} 0 "
            f"b {r:.1f} {k:.1f} {k:.1f} {r:.1f} 0 {r:.1f} "
            f"b {-k:.1f} {r:.1f} {-r:.1f} {k:.1f} {-r:.1f} 0 "
            f"b {-r:.1f} {-k:.1f} {-k:.1f} {-r:.1f} 0 {-r:.1f}")


def build(plan: Plan) -> str:
    cfg, W, H = plan.cfg, plan.width, plan.height
    st, dots = cfg["style"], cfg["dots"]
    k = min(W, H) / 720.0                      # tudo foi calibrado em 720p (lado menor)
    cx, cy = W / 2, _y_for(st.get("position", "center"), H)
    size = st["size"] * k
    back_size = st["back_size"] * k
    back_dy = (size * 0.55 + back_size * 0.75)
    fade = int(st.get("line_fade_ms", 220))
    margin = int(60 * k)

    primary = _color(st.get("color", "#F5F5F5"), 1.0)
    back_col = _color(st.get("color", "#F5F5F5"), float(st.get("back_opacity", 0.8)))

    styles = [
        f"Style: Main,{st['font']},{size:.1f},{primary},&H00FFFFFF,&H80000000,&H90000000,"
        f"0,0,0,0,100,100,{st.get('spacing', 0)},0,1,{st['outline'] * k:.2f},{st['shadow'] * k:.2f},"
        f"5,{margin},{margin},0,1",
        f"Style: Back,{st['back_font']},{back_size:.1f},{back_col},&H00FFFFFF,&H90000000,&HA0000000,"
        f"0,{-1 if st.get('back_italic', True) else 0},0,0,100,100,{st.get('spacing', 0)},0,1,"
        f"{st['outline'] * 0.7 * k:.2f},{st['shadow'] * 0.75 * k:.2f},5,{margin},{margin},0,1",
    ]

    events = []
    for l in plan.lines:
        end = l.end - 0.05
        if end - l.start < 0.1:
            continue
        if l.track == "main":
            tag = f"{{\\an5\\pos({cx:.0f},{cy:.0f})\\fad({fade},{fade})}}"
            events.append(f"Dialogue: 1,{_ts(l.start)},{_ts(end)},Main,,0,0,0,,{tag}{_escape(l.text)}")
        else:
            tag = f"{{\\an5\\pos({cx:.0f},{cy + back_dy:.0f})\\fad({fade},{fade})}}"
            events.append(f"Dialogue: 0,{_ts(l.start)},{_ts(end)},Back,,0,0,0,,{tag}{_escape(l.text)}")

    events += _dots(plan, cx, cy, k)

    return "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {W}",
        f"PlayResY: {H}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        *styles,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *events,
        "",
    ])


def _dots(plan: Plan, cx: float, cy: float, k: float) -> list[str]:
    """Os '...' das pausas instrumentais. Com notas detectadas, cada nota acende o próximo ponto
    e ele pula: nota aguda pula mais alto, nota forte faz um 'pop' maior."""
    cfg = plan.cfg
    if not plan.gaps:
        return []
    r = float(cfg["dots"].get("radius", 5.5)) * k
    spacing = float(cfg["dots"].get("spacing", 26)) * k
    shape = _circle(r)
    color = _color(cfg["style"].get("color", "#F5F5F5"))[4:]  # só BBGGRR
    xs = [cx - spacing, cx, cx + spacing]

    def dot(layer, a, b, tags):
        return (f"Dialogue: {layer},{_ts(a)},{_ts(b)},Main,,0,0,0,,"
                f"{{\\an5\\bord{0.8 * k:.2f}\\shad{1 * k:.2f}\\1c&H{color}&\\3c&H000000&\\4a&HA0&"
                f"{tags}\\p1}}{shape}{{\\p0}}")

    out = []
    for gap in plan.gaps:
        a0, b0 = gap[0] + 0.05, gap[1] - 0.05
        notes = (plan.notes or {}).get(gap)
        if notes is None:
            # sem análise de áudio: "..." estático
            for x in xs:
                out.append(dot(1, a0, b0, f"\\pos({x:.0f},{cy:.0f})\\1a&H20&\\fad(300,220)"))
            continue
        # pontos-base apagadinhos, sempre visíveis
        for x in xs:
            out.append(dot(1, a0, b0, f"\\pos({x:.0f},{cy:.0f})\\1a&HC0&\\3a&HE0&\\fad(300,220)"))
        for i, (t, s, p) in enumerate(notes):
            nxt = notes[i + 3][0] if i + 3 < len(notes) else b0   # acende de novo 3 notas depois
            end = min(nxt - 0.02, b0)
            if end - t < 0.06:
                continue
            x = xs[i % 3]
            hop = (6 + 16 * p + 6 * s) * k
            pop = int(130 + 50 * s)
            life = int((end - t) * 1000)
            tags = (f"\\move({x:.0f},{cy - hop:.1f},{x:.0f},{cy:.1f},0,220)"
                    f"\\fscx{pop}\\fscy{pop}\\t(0,240,0.6,\\fscx100\\fscy100)"
                    f"\\1a&H00&\\t(240,{max(life, 260)},1.4,\\1a&H70&)"
                    f"\\fad(0,{min(180, life // 2)})")
            out.append(dot(2, t, end, tags))
    return out
