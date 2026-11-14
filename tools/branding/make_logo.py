#!/usr/bin/env python3
"""
Amethyst wordmark generator.

Type: Aller Bold — the face used by osu! for its logo and (pre-Torus) UI.
      See tools/branding/README.md for provenance.

Everything is drawn at SS× resolution and box-filtered down, so edges stay clean.

Usage:
    python3 tools/branding/make_logo.py
    python3 tools/branding/make_logo.py --text "Amethyst" --out assets/branding
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SS = 4  # supersample factor

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

INK = (18, 14, 26)          # near-black plum, for previews
PAPER = (246, 244, 250)     # off-white, for previews

# Crystal palette (light → deep)
GEM_LIGHT = (233, 213, 255)
GEM_MID = (168, 85, 247)
GEM_DARK = (109, 40, 217)
GEM_DEEP = (76, 29, 149)

# Gradient chosen to hold up on both dark and light backgrounds:
# the top stop is deep enough to stay legible on white.
TYPE_TOP = (203, 166, 255)
TYPE_MID = (158, 96, 246)
TYPE_BOTTOM = (116, 68, 224)


# ── helpers ──────────────────────────────────────────────────────────────

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def diagonal_gradient(size, stops, angle_deg=118):
    """Small gradient image, upscaled by the caller — cheap and smooth."""
    w, h = size
    small = (max(8, w // 12), max(8, h // 12))
    img = Image.new("RGB", small)
    px = img.load()
    a = math.radians(angle_deg)
    ca, sa = math.cos(a), math.sin(a)
    span = abs(ca) * small[0] + abs(sa) * small[1]
    for y in range(small[1]):
        for x in range(small[0]):
            t = ((x - small[0] / 2) * ca + (y - small[1] / 2) * sa) / span + 0.5
            t = min(1.0, max(0.0, t))
            seg = t * (len(stops) - 1)
            i = min(int(seg), len(stops) - 2)
            px[x, y] = lerp(stops[i], stops[i + 1], seg - i)
    return img.resize(size, Image.BICUBIC)


def resolve_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if not path.exists():
        raise SystemExit(
            f"Font not found: {path}\nSee tools/branding/README.md to fetch Aller Bold."
        )
    return ImageFont.truetype(str(path), size)


def cap_ratio(font: ImageFont.FreeTypeFont) -> float:
    """Cap height as a fraction of the em size, measured from the font itself."""
    box = font.getbbox("H")
    return (box[3] - box[1]) / font.size


# ── crystal mark ─────────────────────────────────────────────────────────

def gem_polygon(box, points):
    """Map unit-space (0..100 × 0..120) points into a pixel box."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    return [(x0 + px / 100 * w, y0 + py / 120 * h) for px, py in points]


def make_gem(height_px, outline=True):
    """Brilliant-cut gemstone: six facets, each its own flat tone.

    Unit space is 100 × 120. A top table, two crown triangles, three pavilion
    triangles — enough structure to read as a cut stone from 24 px upward.
    """
    h = height_px
    w = max(1, int(round(h * 100 / 120)))  # silhouette is 100 × 120 units
    box = (0, 0, w, h)

    A, B = (30, 0), (70, 0)
    C, D, E = (100, 36), (50, 120), (0, 36)
    L, R = (20, 36), (80, 36)

    facets = [
        # points              top colour   bottom colour
        ([A, B, R, L], (237, 219, 255), (208, 172, 250)),   # table
        ([E, A, L], (201, 147, 255), (176, 116, 244)),      # crown left
        ([B, C, R], (176, 116, 244), (150, 90, 228)),       # crown right
        ([E, L, D], (143, 94, 238), (104, 56, 200)),        # pavilion left
        ([L, R, D], (183, 126, 255), (146, 89, 238)),       # pavilion centre
        ([R, C, D], (124, 62, 214), (88, 36, 172)),         # pavilion right
    ]

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for pts, top, bottom in facets:
        poly = gem_polygon(box, pts)
        f_mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(f_mask).polygon(poly, fill=255)
        fill = diagonal_gradient((w, h), [top, bottom], angle_deg=100).convert("RGBA")
        fill.putalpha(f_mask)
        img = Image.alpha_composite(img, fill)

    d = ImageDraw.Draw(img, "RGBA")
    lw = max(1, int(w * 0.006))

    # glints: table edge + girdle, kept very light so they don't read as outlines
    for a, b in ((L, R), (A, L), (B, R), (L, D), (R, D)):
        p1, p2 = gem_polygon(box, [a, b])
        d.line([p1, p2], fill=(255, 255, 255, 46), width=lw)

    if outline:
        edge = gem_polygon(box, [A, B, C, D, E])
        d.line(edge + [edge[0]], fill=(255, 255, 255, 60), width=lw)

    # specular star on the table, upper-left
    sx, sy = w * 0.34, h * 0.13
    r = w * 0.062
    d.polygon(
        [
            (sx, sy - r), (sx + r * 0.2, sy - r * 0.2), (sx + r, sy),
            (sx + r * 0.2, sy + r * 0.2), (sx, sy + r),
            (sx - r * 0.2, sy + r * 0.2), (sx - r, sy),
            (sx - r * 0.2, sy - r * 0.2),
        ],
        fill=(255, 255, 255, 225),
    )
    return img


def make_gem_mono(height_px, color=(255, 255, 255)):
    """One-colour gem: white shards separated by transparent seams."""
    h = height_px
    w = max(1, int(round(h * 100 / 120)))
    box = (0, 0, w, h)
    A, B = (30, 0), (70, 0)
    C, D, E = (100, 36), (50, 120), (0, 36)
    L, R = (20, 36), (80, 36)

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(gem_polygon(box, [A, B, C, D, E]), fill=255)

    seam = ImageDraw.Draw(mask)
    lw = max(2, int(w * 0.011))
    for a, b in ((A, L), (B, R), (L, R), (L, D), (R, D)):
        p1, p2 = gem_polygon(box, [a, b])
        seam.line([p1, p2], fill=0, width=lw)

    img = Image.new("RGBA", (w, h), (*color, 255))
    img.putalpha(mask)
    return img


# ── wordmark ─────────────────────────────────────────────────────────────

def text_layer(text, font, fill_stops=None, flat=None, angle=112, tracking_em=0.0):
    """Render text to an RGBA layer with a gradient (or flat) fill.

    Drawn per glyph so the lockup can be tracked optically tight the way a
    wordmark wants; Aller's default sidebearings are generous for display use.
    """
    ascent, descent = font.getmetrics()
    tracking = tracking_em * font.size
    advances = [font.getlength(ch) for ch in text]
    width = int(math.ceil(sum(advances) + tracking * (len(text) - 1))) + 8
    height = ascent + descent
    mask = Image.new("L", (width, height), 0)
    pen = ImageDraw.Draw(mask)
    x = 4.0
    for ch, adv in zip(text, advances):
        pen.text((x, ascent), ch, font=font, fill=255, anchor="ls")
        x += adv + tracking

    if flat:
        layer = Image.new("RGBA", (width, height), (*flat, 255))
    else:
        layer = diagonal_gradient((width, height), fill_stops, angle_deg=angle).convert("RGBA")
    layer.putalpha(mask)
    return layer, mask, (width, height)


def glow(mask, color, radius, strength=0.55):
    blur = mask.filter(ImageFilter.GaussianBlur(radius))
    if strength != 1.0:
        blur = blur.point(lambda v: int(v * strength))
    layer = Image.new("RGBA", mask.size, (*color, 255))
    layer.putalpha(blur)
    return layer


def build_lockup(text, font_path, cap_px, gem_scale=1.18, gap_ratio=0.27,
                 pad_ratio=0.18, with_gem=True, flat=None, text_glow=False,
                 gem_outline=True, mono_gem=False, tracking_em=-0.021):
    probe = resolve_font(font_path, 100)
    ratio = cap_ratio(probe)
    size = int(round(cap_px / ratio))
    font = resolve_font(font_path, size)

    cap = font.getbbox("H")[3] - font.getbbox("H")[1]
    ascent, descent = font.getmetrics()

    text_img, mask, (tw, th) = text_layer(
        text, font, [TYPE_TOP, TYPE_MID, TYPE_BOTTOM], flat=flat, tracking_em=tracking_em
    )

    gem_h = int(round(cap * gem_scale))
    gem_w = int(round(gem_h * 100 / 120))
    if not with_gem:
        gem = None
    elif mono_gem:
        gem = make_gem_mono(gem_h)
    else:
        gem = make_gem(gem_h, outline=gem_outline)

    gap = int(round(cap * gap_ratio)) if with_gem else 0
    pad_x = int(round(cap * pad_ratio))
    pad_y = int(round(cap * pad_ratio * 0.9))

    content_w = (gem_w + gap if with_gem else 0) + tw - 8
    content_h = max(th, gem_h)

    canvas_w = content_w + pad_x * 2
    canvas_h = content_h + pad_y * 2
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    # baseline sits so the glyph block is vertically centred
    baseline = pad_y + (content_h - th) // 2 + ascent

    tx = pad_x + (gem_w + gap if with_gem else 0)

    if text_glow and not flat:
        g = glow(mask, (167, 139, 250), max(3, int(cap * 0.12)), 0.30)
        canvas.alpha_composite(g, (tx - 4, baseline - ascent))

    canvas.alpha_composite(text_img, (tx - 4, baseline - ascent))

    if with_gem:
        gy = pad_y + (content_h - gem_h) // 2 + int(cap * 0.055)
        canvas.alpha_composite(gem, (pad_x, gy))

    return canvas


# ── icon ─────────────────────────────────────────────────────────────────

def build_icon(font_path, size=1024):
    s = size * SS
    plate = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # vertical plate gradient, clipped to a rounded square
    plate_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(plate_mask).rounded_rectangle(
        [0, 0, s - 1, s - 1], radius=int(s * 0.235), fill=255
    )
    plate_grad = diagonal_gradient((s, s), [(44, 32, 68), (20, 14, 32)], angle_deg=95).convert("RGBA")
    plate_grad.putalpha(plate_mask)
    plate.alpha_composite(plate_grad)

    # soft violet light behind the gem
    glow_img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_img)
    r = int(s * 0.42)
    cx, cy = s // 2, int(s * 0.46)
    for i in range(20, 0, -1):
        t = i / 20
        rad = int(r * t)
        gd.ellipse(
            [cx - rad, cy - rad, cx + rad, cy + rad],
            fill=(140, 88, 235, int(26 * (1 - t) ** 1.4) + 3),
        )
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(s * 0.06))
    glow_img.putalpha(Image.composite(glow_img.getchannel("A"), Image.new("L", (s, s), 0), plate_mask))
    plate.alpha_composite(glow_img)

    # hairline
    ImageDraw.Draw(plate, "RGBA").rounded_rectangle(
        [1, 1, s - 2, s - 2], radius=int(s * 0.235), outline=(255, 255, 255, 24), width=max(2, s // 380)
    )

    gem = make_gem(int(s * 0.54), outline=False)
    plate.alpha_composite(gem, ((s - gem.width) // 2, int((s - gem.height) / 2) + int(s * 0.004)))

    return plate.resize((size, size), Image.LANCZOS)


def _fit(img, max_w, max_h):
    scale = min(max_w / img.width, max_h / img.height)
    return img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)


def _tile(sheet, box, bg, label, label_fill, art, pad=70):
    x0, y0, x1, y1 = box
    draw = ImageDraw.Draw(sheet)
    draw.rectangle(box, fill=bg)
    inner_w, inner_h = (x1 - x0) - pad * 2, (y1 - y0) - pad * 2
    art = _fit(art, inner_w, inner_h)
    ax = x0 + ((x1 - x0) - art.width) // 2
    ay = y0 + ((y1 - y0) - art.height) // 2 - 12
    sheet.paste(art, (ax, ay), art)
    label_font = resolve_font(HERE / "aller-regular.ttf", 26)
    draw.text((x0 + pad, y1 - pad + 6), label, font=label_font, fill=label_fill)


def build_preview(logo, wordmark, mono, icon, out_path):
    W, H = 2400, 1680
    sheet = Image.new("RGB", (W, H), (10, 8, 16))
    g = 24
    half = (W - g * 3) // 2
    footer_h = 52
    row = (H - g * 3 - footer_h) // 2

    _tile(sheet, (g, g, g + half, g + row), (23, 18, 34), "primary lockup · on dark", (150, 142, 170), logo)
    _tile(sheet, (half + g * 2, g, W - g, g + row), (246, 244, 250), "primary lockup · on light", (128, 120, 148), logo)
    _tile(sheet, (g, row + g * 2, g + half, H - footer_h - g), (27, 20, 40), "app icon · 1024 px", (150, 142, 170), icon)
    _tile(sheet, (half + g * 2, row + g * 2, W - g, H - footer_h - g), (42, 33, 64), "mono lockup · one colour", (196, 188, 214), mono)

    draw = ImageDraw.Draw(sheet)
    foot = resolve_font(HERE / "aller-regular.ttf", 24)
    draw.text((W // 2, H - 14), "AMETHYST  ·  SET IN ALLER BOLD (osu! wordmark face)", font=foot, fill=(96, 88, 118), anchor="mb")

    sheet.save(out_path, optimize=True)




# ── vector output ────────────────────────────────────────────────────────
# The wordmark is set as real outlines extracted from the Aller Bold outlines,
# so the SVG needs no font installed to render correctly.

def _font_units(font_path):
    from fontTools.ttLib import TTFont
    from fontTools.pens.boundsPen import BoundsPen

    tt = TTFont(str(font_path))
    gs = tt.getGlyphSet()
    cmap = tt.getBestCmap()
    upm = tt["head"].unitsPerEm
    bp = BoundsPen(gs)
    gs[cmap[ord("H")]].draw(bp)
    cap_units = bp.bounds[3] - bp.bounds[1]
    return tt, gs, cmap, upm, cap_units


def _glyph_paths(text, font_path, cap_px, tracking_em):
    """[(path_data, x_px, advance_px, scale)] in text-local coordinates."""
    from fontTools.pens.svgPathPen import SVGPathPen

    tt, gs, cmap, upm, cap_units = _font_units(font_path)
    scale = cap_px / cap_units
    track = tracking_em * upm * scale
    out, x = [], 0.0
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[name].draw(pen)
        adv = gs[name].width * scale
        out.append((pen.getCommands(), x, adv, scale))
        x += adv + track
    return out, x - track, scale


def _num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _gem_svg(box, uid, mono=False):
    """SVG for the brilliant mark. `box` is (x0,y0,x1,y1) in canvas px."""
    A, B = (30, 0), (70, 0)
    C, D, E = (100, 36), (50, 120), (0, 36)
    L, R = (20, 36), (80, 36)

    def pt(p):
        x0, y0, x1, y1 = box
        return (x0 + p[0] / 100 * (x1 - x0), y0 + p[1] / 120 * (y1 - y0))

    def poly(pts):
        return " ".join(f"{_num(pt(p)[0])},{_num(pt(p)[1])}" for p in pts)

    facets = [
        ([A, B, R, L], (237, 219, 255), (208, 172, 250)),
        ([E, A, L], (201, 147, 255), (176, 116, 244)),
        ([B, C, R], (176, 116, 244), (150, 90, 228)),
        ([E, L, D], (143, 94, 238), (104, 56, 200)),
        ([L, R, D], (183, 126, 255), (146, 89, 238)),
        ([R, C, D], (124, 62, 214), (88, 36, 172)),
    ]

    def rgb(c):
        return f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"

    if mono:
        seams = "".join(
            f'<path d="M{_num(pt(a)[0])} {_num(pt(a)[1])}L{_num(pt(b)[0])} {_num(pt(b)[1])}" '
            f'stroke="#000" stroke-width="{_num((box[2]-box[0]) * 0.011)}" stroke-linecap="square"/>'
            for a, b in ((A, L), (B, R), (L, R), (L, D), (R, D))
        )
        return (
            f'<mask id="gemseam-{uid}" maskUnits="userSpaceOnUse" x="{_num(box[0])}" y="{_num(box[1])}" '
            f'width="{_num(box[2]-box[0])}" height="{_num(box[3]-box[1])}">'
            f'<polygon points="{poly([A, B, C, D, E])}" fill="#fff"/>{seams}</mask>'
            f'<rect x="{_num(box[0])}" y="{_num(box[1])}" width="{_num(box[2]-box[0])}" '
            f'height="{_num(box[3]-box[1])}" fill="#fff" mask="url(#gemseam-{uid})"/>'
        )

    defs, shapes = [], []
    for i, (pts, top, bottom) in enumerate(facets):
        gid = f"f{uid}{i}"
        defs.append(
            f'<linearGradient id="{gid}" x1="{_num(box[0]+(box[2]-box[0])*0.42)}" y1="{_num(box[1])}" '
            f'x2="{_num(box[0]+(box[2]-box[0])*0.18)}" y2="{_num(box[3])}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{rgb(top)}"/><stop offset="1" stop-color="{rgb(bottom)}"/></linearGradient>'
        )
        shapes.append(f'<polygon points="{poly(pts)}" fill="url(#{gid})"/>')

    outline = "".join(
        f'<path d="M{_num(pt(a)[0])} {_num(pt(a)[1])}L{_num(pt(b)[0])} {_num(pt(b)[1])}" '
        f'stroke="#fff" stroke-opacity=".24" stroke-width="{_num((box[2]-box[0])*0.006)}"/>'
        for a, b in ((A, L), (B, R), (L, R), (L, D), (R, D))
    )

    w = box[2] - box[0]
    sx, sy = pt((34, 12.6))
    r = w * 0.062
    sparkle = (
        f'<path d="M{_num(sx)} {_num(sy-r)}L{_num(sx+r*0.2)} {_num(sy-r*0.2)}L{_num(sx+r)} {_num(sy)}'
        f'L{_num(sx+r*0.2)} {_num(sy+r*0.2)}L{_num(sx)} {_num(sy+r)}L{_num(sx-r*0.2)} {_num(sy+r*0.2)}'
        f'L{_num(sx-r)} {_num(sy)}L{_num(sx-r*0.2)} {_num(sy-r*0.2)}Z" fill="#fff" fill-opacity=".88"/>'
    )

    return f'<defs>{"".join(defs)}</defs><g>{"".join(shapes)}{outline}{sparkle}</g>'


def build_svg(text, font_path, cap_px=190, with_gem=True, flat=None, mono=False, tracking_em=-0.021):
    """Same geometry as the raster build, emitted as scalable outlines."""
    glyphs, text_w, scale = _glyph_paths(text, font_path, cap_px, tracking_em)

    from fontTools.ttLib import TTFont

    tt = TTFont(str(font_path))
    desc_px = -tt["hhea"].descent * scale  # generous bound for the 'y' tail
    asc_px = tt["hhea"].ascent * scale

    gem_h = cap_px * 1.18 if with_gem else 0.0
    gem_w = gem_h * 100 / 120
    gap = cap_px * 0.27 if with_gem else 0.0
    pad = cap_px * 0.20

    # lay everything out around a baseline at y=0, then shift into the canvas
    gem_top = -gem_h * 0.94
    gem_bottom = gem_top + gem_h
    content_top = min(gem_top, -cap_px) if with_gem else -cap_px
    content_bottom = max(gem_bottom, desc_px) if with_gem else desc_px
    dy = pad - content_top
    baseline = dy
    height = (content_bottom - content_top) + pad * 2
    left = pad + (gem_w + gap if with_gem else 0)
    width = left + text_w + pad

    def rgb(c):
        return f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"

    if flat:
        fill = rgb(flat)
    elif mono:
        fill = "#ffffff"
    else:
        fill = "url(#typegrad)"

    # Glyph outlines live in font units, y-up, inside one transformed group, so
    # the gradient below is defined in that same space (y is inverted there).
    defs = ""
    if not flat and not mono:
        # span the same ascent→descent window the raster build uses, so both
        # editions carry identical weight
        x1, y1 = 0.0, asc_px / scale
        x2, y2 = (text_w * 0.30) / scale, -desc_px / scale
        defs += (
            f'<linearGradient id="typegrad" x1="{_num(x1)}" y1="{_num(y1)}" '
            f'x2="{_num(x2)}" y2="{_num(y2)}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{rgb(TYPE_TOP)}"/>'
            f'<stop offset="0.55" stop-color="{rgb(TYPE_MID)}"/>'
            f'<stop offset="1" stop-color="{rgb(TYPE_BOTTOM)}"/></linearGradient>'
        )

    paths = "".join(f'<path d="{d}" transform="translate({_num(x / scale)} 0)"/>' for d, x, adv, sc in glyphs)
    glyph_group = (
        f'<g transform="translate({_num(left)} {_num(baseline)}) scale({_num(scale)} {_num(-scale)})" '
        f'fill="{fill}">{paths}</g>'
    )

    mark = ""
    if with_gem:
        gx = pad
        gy = baseline + gem_top
        mark = _gem_svg((gx, gy, gx + gem_w, gy + gem_h), "m" + ("1" if mono else "0"), mono=mono)
        if mark.startswith("<defs>"):
            close = mark.index("</defs>") + len("</defs>")
            defs += mark[:close]
            mark = mark[close:]

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_num(width)} {_num(height)}" '
        f'width="{_num(width)}" height="{_num(height)}" role="img" aria-label="{text}">'
        f"<title>{text}</title><defs>{defs}</defs>"
        f"{glyph_group}{mark}</svg>"
    )


def build_icon_svg(font_path, size=1024):
    s = size
    gw = s * 0.47
    gh = gw * 120 / 100
    gem = _gem_svg(((s - gw) / 2, (s - gh) / 2, (s + gw) / 2, (s + gh) / 2), "i0")
    close = gem.index("</defs>") + len("</defs>")
    gem_defs, gem_body = gem[:close], gem[close:]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}" width="{s}" height="{s}" '
        f'role="img" aria-label="Amethyst icon"><title>Amethyst</title>'
        f"<defs>"
        f'<linearGradient id="plate" x1="0" y1="0" x2="0.2" y2="1">'
        f'<stop offset="0" stop-color="#2c2044"/><stop offset="1" stop-color="#140e20"/></linearGradient>'
        f'<radialGradient id="halo" cx="0.5" cy="0.46" r="0.5">'
        f'<stop offset="0" stop-color="#8c58eb" stop-opacity=".26"/>'
        f'<stop offset="1" stop-color="#8c58eb" stop-opacity="0"/></radialGradient>'
        f"{gem_defs}</defs>"
        f'<rect width="{s}" height="{s}" rx="{s*0.235:.0f}" fill="url(#plate)"/>'
        f'<rect width="{s}" height="{s}" rx="{s*0.235:.0f}" fill="url(#halo)"/>'
        f'<rect x="1" y="1" width="{s-2}" height="{s-2}" rx="{s*0.235:.0f}" fill="none" '
        f'stroke="#fff" stroke-opacity=".10" stroke-width="3"/>'
        f"{gem_body}</svg>"
    )


# ── main ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default="Amethyst")
    ap.add_argument("--font", default=str(HERE / "aller-bold.ttf"))
    ap.add_argument("--out", default=str(ROOT / "assets" / "branding"))
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    font_path = Path(args.font)

    CAP = 168 * SS  # logical cap height × supersample

    lockup = build_lockup(args.text, font_path, CAP)
    lockup.resize((2400, round(2400 * lockup.height / lockup.width)), Image.LANCZOS).save(
        out / "amethyst-logo.png", optimize=True
    )

    word = build_lockup(args.text, font_path, CAP, with_gem=False, text_glow=False)
    word.resize((2200, round(2200 * word.height / word.width)), Image.LANCZOS).save(
        out / "amethyst-wordmark.png", optimize=True
    )

    mono = build_lockup(
        args.text, font_path, CAP, flat=(255, 255, 255), text_glow=False,
        gem_outline=False, mono_gem=True,
    )
    mono.resize((2400, round(2400 * mono.height / mono.width)), Image.LANCZOS).save(
        out / "amethyst-logo-mono.png", optimize=True
    )

    icon = build_icon(font_path)
    icon.save(out / "amethyst-icon.png", optimize=True)

    # vector editions
    (out / "amethyst-logo.svg").write_text(build_svg(args.text, font_path), "utf8")
    (out / "amethyst-wordmark.svg").write_text(
        build_svg(args.text, font_path, with_gem=False), "utf8"
    )
    (out / "amethyst-logo-mono.svg").write_text(
        build_svg(args.text, font_path, mono=True), "utf8"
    )
    (out / "amethyst-icon.svg").write_text(build_icon_svg(font_path), "utf8")

    build_preview(
        Image.open(out / "amethyst-logo.png").convert("RGBA"),
        Image.open(out / "amethyst-wordmark.png").convert("RGBA"),
        Image.open(out / "amethyst-logo-mono.png").convert("RGBA"),
        Image.open(out / "amethyst-icon.png").convert("RGBA"),
        out / "preview.png",
    )

    for f in sorted(out.iterdir()):
        print(f"{f.name:28} {f.stat().st_size / 1024:7.1f} kB")
    print(f"\ntypeface: {font_path.name}  ·  cap ratio {cap_ratio(resolve_font(font_path, 100)):.3f}")


if __name__ == "__main__":
    main()
