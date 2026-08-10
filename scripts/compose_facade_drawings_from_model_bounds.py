import json
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


A3 = (2480, 1754)


@dataclass
class Obj:
    name: str
    mn: tuple[float, float, float]
    mx: tuple[float, float, float]


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def is_detail(name):
    n = name.lower()
    return any(token in n for token in ("-line-", "stenfog", "vertical-trim", "header"))


def is_ground_reference(name):
    return "markplatta" in name.lower()


def is_relevant(obj, view):
    n = obj.name.lower()
    x0, y0, z0 = obj.mn
    x1, y1, z1 = obj.mx
    if is_ground_reference(n):
        return True
    if view == "southwest":
        return y0 <= 0.13 or y1 <= 0.18 or "trappa centrerad" in n
    if view == "back":
        return y1 >= 6.05 or "baksida" in n or "nordöst/bak" in n
    if view == "northeast":
        return x1 >= 7.45 or "östra sida" in n or "nordöst långsida" in n
    if view == "opposite":
        return x0 <= 0.22 or "västra sida" in n
    return False


def project(obj, view):
    x0, y0, z0 = obj.mn
    x1, y1, z1 = obj.mx
    if view in ("southwest", "back"):
        return x0, z0, x1, z1
    # y is horizontal on side elevations.
    return y0, z0, y1, z1


def extent(objs, view):
    rects = [project(o, view) for o in objs if not is_ground_reference(o.name)]
    x0 = min(r[0] for r in rects)
    z0 = min(r[1] for r in rects)
    x1 = max(r[2] for r in rects)
    z1 = max(r[3] for r in rects)
    return x0, z0, x1, z1


def draw_object(draw, obj, view, tx, ty, scale):
    x0, z0, x1, z1 = project(obj, view)
    sx0 = tx(x0)
    sx1 = tx(x1)
    sy0 = ty(z0)
    sy1 = ty(z1)
    if abs(sx1 - sx0) < 1 and abs(sy1 - sy0) < 1:
        return
    if is_ground_reference(obj.name):
        draw.line((sx0, ty(z1), sx1, ty(z1)), fill="black", width=2)
        return
    n = obj.name.lower()
    if is_detail(obj.name):
        w = 2 if "stenfog" not in n else 1
        if abs(sy1 - sy0) <= 5:
            draw.line((sx0, (sy0 + sy1) / 2, sx1, (sy0 + sy1) / 2), fill="black", width=w)
        elif abs(sx1 - sx0) <= 5:
            draw.line(((sx0 + sx1) / 2, sy0, (sx0 + sx1) / 2, sy1), fill="black", width=w)
        else:
            draw.rectangle((sx0, sy1, sx1, sy0), outline="black", width=w)
        return
    width = 4 if any(token in n for token in ("stolpe", "balk", "tak")) else 2
    if "trappa" in n:
        width = 2
    if "mur" in n:
        width = 2
    draw.rectangle((sx0, sy1, sx1, sy0), outline="black", width=width)


def draw_dimensions(draw, page, view, ex, tx, ty):
    small = font(22)
    x0, z0, x1, z1 = ex
    base_y = ty(z0) + 45
    draw.line((tx(x0), base_y, tx(x1), base_y), fill="black", width=2)
    draw.line((tx(x0), base_y - 15, tx(x0), base_y + 15), fill="black", width=2)
    draw.line((tx(x1), base_y - 15, tx(x1), base_y + 15), fill="black", width=2)
    length_mm = round((x1 - x0) * 1000)
    label = f"{length_mm} mm" if view in ("southwest", "back") else f"{length_mm} mm djup"
    draw.text(((tx(x0) + tx(x1)) / 2 - 55, base_y + 12), label, fill="black", font=small)


def title_for(view):
    return {
        "southwest": "Fasad sydväst",
        "back": "Fasad baksida",
        "northeast": "Fasad nordöst",
        "opposite": "Fasad motsatt sida",
    }[view]


def draw_page(objects, view):
    selected = [o for o in objects if is_relevant(o, view)]
    ex = extent(selected, view)
    page = Image.new("RGB", A3, "white")
    draw = ImageDraw.Draw(page)
    title = font(42)
    note = font(22)
    draw.text((90, 70), title_for(view), fill="black", font=title)
    draw.text((90, 124), "CAD-simulated fasad från sparad Blender-modell, ortografiskt fasadplan", fill="black", font=note)
    x0, z0, x1, z1 = ex
    margin_x, top, bottom = 150, 210, 1320
    scale = min((A3[0] - 2 * margin_x) / (x1 - x0), (bottom - top) / (z1 - z0))
    cx = (x0 + x1) / 2
    cz = (z0 + z1) / 2
    center_px = A3[0] / 2
    center_py = (top + bottom) / 2
    tx = lambda x: center_px + (x - cx) * scale
    ty = lambda z: center_py - (z - cz) * scale

    # Draw large bodies first, detail lines last.
    for obj in sorted(selected, key=lambda o: (is_detail(o.name), o.mn[2], o.name)):
        draw_object(draw, obj, view, tx, ty, scale)
    draw_dimensions(draw, page, view, ex, tx, ty)

    draw.rectangle((90, 1510, 2390, 1680), outline="black", width=2)
    draw.line((1500, 1510, 1500, 1680), fill="black", width=1)
    draw.line((1900, 1510, 1900, 1680), fill="black", width=1)
    draw.text((110, 1530), "Material/kulör: vit liggande träpanel, mörk stenmur/sockel, mörkt tak.", fill="black", font=note)
    draw.text((110, 1570), "Underlag: 3D-modell + foton som material- och verklighetsreferens.", fill="black", font=note)
    draw.text((1520, 1530), "Skala: 1:100 på A3", fill="black", font=note)
    draw.text((1920, 1530), "Export: modellplan", fill="black", font=note)
    return page


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python compose_facade_drawings_from_model_bounds.py bounds.json output.pdf")
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    objects = [Obj(row["name"], tuple(row["min"]), tuple(row["max"])) for row in data["objects"]]
    views = ("southwest", "back", "northeast", "opposite")
    pages = [draw_page(objects, view) for view in views]
    out = Path(sys.argv[2])
    out.parent.mkdir(parents=True, exist_ok=True)
    image_dir = out.parent / (out.stem + "-pages")
    image_dir.mkdir(exist_ok=True)
    for view, page in zip(views, pages):
        page.save(image_dir / f"{view}.png")
    pages[0].save(out, save_all=True, append_images=pages[1:], resolution=150)
    print(out)


if __name__ == "__main__":
    main()
