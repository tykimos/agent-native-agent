#!/usr/bin/env python3
"""웹툰 식자 — 깨끗한 원고(대사 없는 말풍선)에 대본을 얹는다.

  letter.py detect IMG [--work DIR]   말풍선 후보 검출 → <stem>.bubbles.json + 번호 붙은 검토 조각
  letter.py render LAYOUT.json ...    레이아웃대로 식자 → PNG/JPG (+ 검토 조각, 넘친 대사 경고)
  letter.py styles                    스타일·폰트 확인
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None  # 세로 스크롤 원고는 수만 px 이다

SKILL_DIR = Path(__file__).resolve().parent.parent
FONT_DIR = SKILL_DIR / "fonts"
SYSTEM_FONTS = [
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]

# size 는 원고 가로 800px 기준. 실제 크기 = size * (원고 가로 / 800)
STYLES = {
    "dialogue":  {"font": "NanumGothic-Bold.ttf", "size": 30, "color": "#111111"},
    "whisper":   {"font": "NanumGothic-Regular.ttf", "size": 24, "color": "#333333"},
    "thought":   {"font": "NanumMyeongjo-Bold.ttf", "size": 28, "color": "#222222"},
    "shout":     {"font": "BlackHanSans-Regular.ttf", "size": 40, "color": "#111111", "line_spacing": 1.12},
    "narration": {"font": "NanumMyeongjo-Bold.ttf", "size": 27, "color": "#111111", "shape": "rect"},
    "hand":      {"font": "NanumPenScript-Regular.ttf", "size": 36, "color": "#222222"},
    "sfx":       {"font": "BlackHanSans-Regular.ttf", "size": 72, "color": "#ffffff",
                  "stroke": 6, "stroke_color": "#111111", "line_spacing": 1.0},
}
BASE_STYLE = {"size": 30, "color": "#111111", "line_spacing": 1.28, "stroke": 0,
              "stroke_color": "#ffffff", "min_scale": 0.6, "shape": None}
INNER = {"ellipse": 0.72, "rect": 0.86}  # 말풍선 안에서 글자가 차지할 수 있는 비율

_font_cache = {}


def load_font(name, size):
    key = (name, size)
    if key in _font_cache:
        return _font_cache[key]
    font = None
    for p in ([Path(name)] if name and "/" in name else []) + ([FONT_DIR / name] if name else []):
        if p.is_file():
            font = ImageFont.truetype(str(p), size)
            break
    if font is None:  # 받은 폰트가 없으면 시스템 한글 폰트 (굵은 스타일이면 Bold 면을 찾는다)
        want_bold = bool(name) and any(k in name for k in ("Bold", "Black", "Heavy"))
        for sp in SYSTEM_FONTS:
            if not Path(sp).is_file():
                continue
            idx = 0
            if want_bold and sp.endswith(".ttc"):
                for i in range(20):
                    try:
                        if "Bold" in ImageFont.truetype(sp, 10, index=i).getname()[1]:
                            idx = i
                            break
                    except OSError:
                        break
            font = ImageFont.truetype(sp, size, index=idx)
            break
    if font is None:
        sys.exit("한글 폰트를 찾지 못했습니다 — scripts/setup.sh 를 먼저 실행하세요")
    _font_cache[key] = font
    return font


# ───────────────────────── detect ─────────────────────────

def detect(img, threshold=232, min_w=0.08, min_h=40, min_fill=0.5):
    W, H = img.size
    s = min(1.0, 400 / W)
    small = img.convert("L").resize((max(1, round(W * s)), max(1, round(H * s))), Image.BILINEAR)
    mask = np.asarray(small) >= threshold
    lab, n = ndimage.label(mask)
    if n == 0:
        return []
    edge = set(np.unique(np.concatenate([lab[:, 0], lab[:, -1]]))) - {0}  # 좌우 여백·배경
    areas = ndimage.sum(mask, lab, index=np.arange(1, n + 1))
    found = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None or i in edge:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        bw, bh = x1 - x0, y1 - y0
        if bw < min_w * small.width or bh < min_h * s or bw > 0.95 * small.width:
            continue
        fill = areas[i - 1] / (bw * bh)
        if fill < min_fill:
            continue
        comp = ndimage.binary_fill_holes(lab[sl] == i)
        dist = ndimage.distance_transform_edt(np.pad(comp, 1))[1:-1, 1:-1]
        cy, cx = ndimage.center_of_mass(dist >= 0.8 * dist.max())  # 꼬리를 피한 말풍선 몸통 중심
        found.append({
            "box": [round(x0 / s), round(y0 / s), round(bw / s), round(bh / s)],
            "center": [round((x0 + cx + 0.5) / s), round((y0 + cy + 0.5) / s)],
            "shape": "rect" if fill > 0.9 else "ellipse",
        })
    band = max(40, W // 20)  # 같은 높이대면 왼쪽부터
    found.sort(key=lambda b: (b["box"][1] // band, b["box"][0]))
    for k, b in enumerate(found, 1):
        b["id"] = k
    return found


def review_pieces(img, out_stem, width=800):
    """긴 원고를 보기 좋은 조각(가로 width, 세로 2*width)으로 잘라 저장한다."""
    W, H = img.size
    if W > width:
        img = img.resize((width, max(1, round(H * width / W))), Image.LANCZOS)
    piece_h = img.width * 2
    paths = []
    for k, top in enumerate(range(0, img.height, piece_h), 1):
        p = Path(f"{out_stem}-{k:02d}.png")
        img.crop((0, top, img.width, min(img.height, top + piece_h))).convert("RGB").save(p)
        paths.append(p)
    return paths


def cmd_detect(a):
    src = Path(a.image)
    img = Image.open(src).convert("RGB")
    work = Path(a.work) if a.work else src.parent.parent / "work"
    work.mkdir(parents=True, exist_ok=True)
    bubbles = detect(img, threshold=a.threshold, min_fill=a.min_fill)
    out = work / f"{src.stem}.bubbles.json"
    out.write_text(json.dumps({"image": str(src.resolve()), "size": list(img.size), "bubbles": bubbles},
                              ensure_ascii=False, indent=1))
    over = img.copy()
    d = ImageDraw.Draw(over)
    lw = max(3, img.width // 200)
    tag = load_font("NanumGothic-Bold.ttf", max(20, img.width // 22))
    for b in bubbles:
        x, y, w, h = b["box"]
        d.rectangle([x, y, x + w, y + h], outline="#ff2d55", width=lw)
        cx, cy = b["center"]
        d.ellipse([cx - lw * 2, cy - lw * 2, cx + lw * 2, cy + lw * 2], fill="#ff2d55")
        d.text((x + lw * 2, y + lw), str(b["id"]), font=tag, fill="#ff2d55", stroke_width=lw, stroke_fill="white")
    pieces = review_pieces(over, work / f"{src.stem}.detect", a.view_width)
    print(f"말풍선 {len(bubbles)}개 → {out}")
    for p in pieces:
        print(f"  검토: {p}")


# ───────────────────────── render ─────────────────────────

def wrap(text, font, max_w, stroke):
    """줄 수는 그대로 두고 폭을 최대한 좁혀 줄 길이를 고르게 한다 (마름모꼴 말풍선 식자)."""
    lines = greedy_wrap(text, font, max_w, stroke)
    lo, hi = max_w * 0.4, max_w
    while hi - lo > 2:
        mid = (lo + hi) / 2
        if len(greedy_wrap(text, font, mid, stroke)) == len(lines):
            hi = mid
        else:
            lo = mid
    return greedy_wrap(text, font, hi, stroke)


def greedy_wrap(text, font, max_w, stroke):
    def width(s):
        return font.getlength(s) + 2 * stroke
    lines = []
    for para in text.split("\n"):
        words, cur = para.split(" "), ""
        for wd in words:
            trial = wd if not cur else cur + " " + wd
            if width(trial) <= max_w:
                cur = trial
                continue
            if cur:
                lines.append(cur)
            cur = ""
            while width(wd) > max_w and len(wd) > 1:  # 한 어절이 한 줄보다 길면 글자 단위로 끊는다
                k = len(wd)
                while k > 1 and width(wd[:k]) > max_w:
                    k -= 1
                lines.append(wd[:k])
                wd = wd[k:]
            cur = wd
        lines.append(cur)
    return lines


def layout_text(text, st, size, max_w, max_h, do_wrap):
    font = load_font(st["font"], size)
    stroke = round(st["stroke_px"] * size / st["size_px"]) if st["stroke"] else 0
    lines = wrap(text, font, max_w, stroke) if do_wrap else text.split("\n")
    lh = size * st["line_spacing"]
    bw = max(font.getlength(l) for l in lines) + 2 * stroke
    bh = lh * (len(lines) - 1) + size + 2 * stroke
    return font, stroke, lines, lh, bw, bh, (bw <= max_w + 0.5 and bh <= max_h + 0.5)


def place(canvas, item, st, scale, bubbles, warn):
    text = item["text"].replace("\\n", "\n")
    size0 = round(item.get("size", st["size"]) * scale)
    st = dict(st, size_px=size0, stroke_px=st["stroke"] * scale)
    shape = item.get("shape") or st["shape"]
    if "at" in item:  # 효과음 등: 지정 좌표 중심, 줄바꿈·축소 없음
        cx, cy = item["at"]
        font, stroke, lines, lh, bw, bh, _ = layout_text(text, st, size0, 1e9, 1e9, False)
        size = size0
    else:
        if "bubble" in item:
            b = bubbles.get(item["bubble"])
            if b is None:
                warn.append(f"말풍선 #{item['bubble']} 없음: {text[:20]}")
                return
            x, y, w, h = b["box"]
            cx, cy = b.get("center", [x + w / 2, y + h / 2])
            shape = shape or b.get("shape", "ellipse")
        else:
            x, y, w, h = item["box"]
            cx, cy = x + w / 2, y + h / 2
            shape = shape or "rect"
        f = item.get("inner", INNER[shape])
        max_w = 2 * min(cx - x, x + w - cx) * f
        max_h = 2 * min(cy - y, y + h - cy) * f
        size, min_size = size0, max(8, round(size0 * st["min_scale"]))
        while True:
            font, stroke, lines, lh, bw, bh, ok = layout_text(text, st, size, max_w, max_h, True)
            if ok or size <= min_size:
                break
            size -= 1
        if not ok:
            warn.append(f"넘침 ({'#' + str(item['bubble']) if 'bubble' in item else 'box'}, {size}px): {text[:24]}")
        elif size < size0:
            warn.append(f"축소 {size0}→{size}px ({'#' + str(item['bubble']) if 'bubble' in item else 'box'}): {text[:24]}")
    dx, dy = item.get("offset", [0, 0])
    cx, cy = cx + dx, cy + dy

    pad = stroke + size
    tile = Image.new("RGBA", (int(bw) + 2 * pad, int(bh) + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    top = pad + stroke
    for i, line in enumerate(lines):
        d.text((tile.width / 2, top + i * lh + size / 2), line, font=font, anchor="mm",
               fill=item.get("color", st["color"]), stroke_width=stroke,
               stroke_fill=item.get("stroke_color", st["stroke_color"]))
    if item.get("rotate"):
        tile = tile.rotate(item["rotate"], resample=Image.BICUBIC, expand=True)
    canvas.alpha_composite(tile, (round(cx - tile.width / 2), round(cy - tile.height / 2)))


def cmd_render(a):
    for lp in a.layout:
        lp = Path(lp)
        base = lp.parent
        L = json.loads(lp.read_text())

        def rel(p):
            p = Path(p).expanduser()
            return p if p.is_absolute() else (base / p)

        img = Image.open(rel(L["image"])).convert("RGBA")
        bubbles = {}
        if L.get("bubbles"):
            bubbles = {b["id"]: b for b in json.loads(rel(L["bubbles"]).read_text())["bubbles"]}
        styles = {k: dict(BASE_STYLE, **v) for k, v in STYLES.items()}
        for k, v in L.get("styles", {}).items():
            styles[k] = dict(styles.get(k, BASE_STYLE), **v)
        scale = img.width / 800
        default = L.get("defaults", {}).get("style", "dialogue")
        warn = []
        for item in L["items"]:
            st = styles.get(item.get("style", default))
            if st is None:
                warn.append(f"모르는 스타일 '{item.get('style')}': {item['text'][:20]}")
                continue
            place(img, item, st, scale, bubbles, warn)

        out = rel(L.get("output", f"../out/{lp.stem.replace('.layout', '')}.png"))
        out.parent.mkdir(parents=True, exist_ok=True)
        final = img.convert("RGB")
        if L.get("width"):
            final = final.resize((L["width"], round(final.height * L["width"] / final.width)), Image.LANCZOS)
        jpg = out.suffix.lower() in (".jpg", ".jpeg")
        opts = {"quality": L.get("quality", 92), "subsampling": 0} if jpg else {"optimize": True}
        split = L.get("split", 0)
        if split and final.height > split:
            n = 0
            for n, top in enumerate(range(0, final.height, split), 1):
                p = out.with_name(f"{out.stem}_{n:02d}{out.suffix}")
                final.crop((0, top, final.width, min(final.height, top + split))).save(p, **opts)
            print(f"✓ {lp.name} → {out.parent}/{out.stem}_01…{n:02d}{out.suffix}")
        else:
            final.save(out, **opts)
            print(f"✓ {lp.name} → {out}")
        for p in review_pieces(img, base / f"{lp.stem.replace('.layout', '')}.review", a.view_width):
            print(f"  검토: {p}")
        for w in warn:
            print(f"  ⚠ {w}")


def cmd_styles(_):
    for k, v in STYLES.items():
        f = load_font(v["font"], 20)
        src = "fonts/" + v["font"] if (FONT_DIR / v["font"]).is_file() else "시스템 대체 " + " ".join(f.getname())
        print(f"{k:10s} {v['size']:>3}px  {src}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("detect", help="말풍선 후보 검출")
    d.add_argument("image")
    d.add_argument("--work", help="결과 폴더 (기본: 원고 폴더의 ../work)")
    d.add_argument("--threshold", type=int, default=232, help="흰색으로 볼 밝기 (0-255)")
    d.add_argument("--min-fill", type=float, default=0.5, help="박스 대비 흰 면적 비율 하한")
    d.add_argument("--view-width", type=int, default=800)
    d.set_defaults(fn=cmd_detect)
    r = sub.add_parser("render", help="레이아웃대로 식자")
    r.add_argument("layout", nargs="+")
    r.add_argument("--view-width", type=int, default=800)
    r.set_defaults(fn=cmd_render)
    s = sub.add_parser("styles", help="스타일·폰트 확인")
    s.set_defaults(fn=cmd_styles)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
