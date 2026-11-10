"""Packs the banners listed in slots.json into atlas sheets for VRChat.

Runs on GitHub (see .github/workflows/build.yml) after every change, and works locally too:

    pip install pillow
    python build.py            # writes _site/

Output (served by GitHub Pages):
    _site/atlas_0.jpg .. atlas_N.jpg   one column of banners per sheet, at most 2048 px tall
    _site/manifest.json                where every banner sits, in pixels, plus its seconds on screen
    _site/index.html                   preview page

The world bakes the URLs of manifest.json and atlas_0..atlas_{maxSheets-1}.jpg at build time,
so those names never change; only their contents do.
"""
import json
import os
import sys
from datetime import datetime, timezone

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "_site")
MAX_SIDE = 2048  # VRChat image loader limit


def fit(im, w, h):
    """Scale to cover w x h, then crop the centre - never stretches."""
    im = im.convert("RGB")
    k = max(w / im.width, h / im.height)
    nw, nh = max(w, round(im.width * k)), max(h, round(im.height * k))
    im = im.resize((nw, nh), Image.LANCZOS)
    x, y = (nw - w) // 2, (nh - h) // 2
    return im.crop((x, y, x + w, y + h))


def main():
    with open(os.path.join(ROOT, "slots.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    cw, ch = cfg["cell"]
    gutter = int(cfg.get("gutter", 32))
    per = int(cfg["perSheet"])
    max_sheets = int(cfg["maxSheets"])
    quality = int(cfg.get("quality", 92))
    if per * ch + (per - 1) * gutter > MAX_SIDE or cw > MAX_SIDE:
        sys.exit(f"perSheet {per} x {ch}px + gutters does not fit in {MAX_SIDE}px")

    live, warnings = [], []
    for s in sorted(cfg["slots"], key=lambda s: s["slot"]):
        if not s.get("on", True):
            continue
        path = os.path.join(ROOT, s.get("image", ""))
        if not s.get("image") or not os.path.isfile(path):
            warnings.append(f"slot {s['slot']}: image missing ({s.get('image')}) - skipped")
            continue
        im = Image.open(path)
        if abs(im.width / im.height - cw / ch) > 0.15:
            warnings.append(f"slot {s['slot']}: {im.width}x{im.height} is not {cw}:{ch} - centre cropped")
        live.append((s, fit(im, cw, ch)))

    if len(live) > per * max_sheets:
        sys.exit(f"{len(live)} banners on, but the world only knows {max_sheets} sheets x {per}")

    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        os.remove(os.path.join(OUT, name))

    sheets, banners = [], []
    for k in range(0, len(live), per):
        group = live[k:k + per]
        sh = len(group) * ch + (len(group) - 1) * gutter
        sheet = Image.new("RGB", (cw, sh))
        index = len(sheets)
        for i, (s, im) in enumerate(group):
            y = i * (ch + gutter)
            sheet.paste(im, (0, y))
            # Gutters repeat the banner's edge rows, so mip-mapping never bleeds a neighbour in.
            half = gutter // 2
            if i > 0:
                top = im.crop((0, 0, cw, 1)).resize((cw, gutter - half))
                sheet.paste(top, (0, y - (gutter - half)))
            if i < len(group) - 1:
                bottom = im.crop((0, ch - 1, cw, ch)).resize((cw, half))
                sheet.paste(bottom, (0, y + ch))
            banners.append({
                "slot": s["slot"], "name": s.get("name", ""), "seconds": float(s.get("seconds", 8)),
                "sheet": index, "x": 0, "y": y, "w": cw, "h": ch,
            })
        file = f"atlas_{index}.jpg"
        sheet.save(os.path.join(OUT, file), quality=quality, subsampling=0, optimize=True)
        sheets.append({"file": file, "w": cw, "h": sh})

    manifest = {
        "v": 1,
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sheets": sheets,
        "banners": banners,
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)

    rows = "".join(f'<h3>{b["slot"]}. {b["name"]} ({b["seconds"]:g} s) - sheet {b["sheet"]}</h3>' for b in banners)
    imgs = "".join(f'<p><img src="{s["file"]}" style="max-width:100%"></p>' for s in sheets)
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(f'<!doctype html><meta charset="utf-8"><title>Banners</title>'
                f'<body style="background:#111;color:#ddd;font-family:sans-serif">'
                f'<h1>{len(banners)} banners, built {manifest["built"]}</h1>{rows}{imgs}</body>')

    print(f"{len(banners)} banners on {len(sheets)} sheet(s)")
    for w in warnings:
        print("WARNING:", w)


if __name__ == "__main__":
    main()
