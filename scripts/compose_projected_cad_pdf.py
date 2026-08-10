import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


IN_DIR = Path("outputs/cad-simulated-export/carport-v8-projected-line")
DATA = IN_DIR / "model_projection.json"
PAGE_W, PAGE_H = 3508, 2480
INK = (20, 20, 20)
MID = (95, 95, 95)
LIGHT = (160, 160, 160)


def font(size, bold=False):
    paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def category(name):
    lower = name.lower()
    if "kamera" in lower or "camera" in lower:
        return "skip"
    if "markplatta" in lower or "grusgolv" in lower or "floor" in lower or "golv" in lower:
        return "context"
    if "panelspår" in lower or "finish-plane-correct" in lower or "finish-detail" in lower:
        return "cladding"
    if "stenfog" in lower or "murkrön" in lower:
        return "masonry"
    if "mur" in lower or "foundation" in lower:
        return "foundation"
    if "trappa" in lower or "steg" in lower:
        return "stairs"
    if "tak" in lower or "roof" in lower:
        return "roof"
    if "stolpe" in lower or "post" in lower or "balk" in lower or "header" in lower:
        return "structure"
    return "object"


def project_point(point, view):
    x, y, z = point
    if view == "plan":
        return x, y
    if view in ("southwest", "northeast"):
        return x, z
    return y, z


def bbox_2d(obj, view):
    pts = [project_point(p, view) for p in obj["bbox"]]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def object_visible(obj, view):
    c = category(obj["name"])
    if c == "skip":
        return False
    if view == "plan" and c == "cladding":
        return False
    return True


def line_style(cat):
    if cat in ("roof", "structure", "stairs"):
        return INK, 4
    if cat == "foundation":
        return MID, 3
    if cat in ("masonry", "cladding"):
        return LIGHT, 2
    if cat == "context":
        return (190, 190, 190), 2
    return INK, 3


class Sheet:
    def __init__(self, title, objects, view):
        self.img = Image.new("RGB", (PAGE_W, PAGE_H), "white")
        self.draw = ImageDraw.Draw(self.img)
        self.title = title
        self.view = view
        self.margin = 180
        self.header = 230
        self.footer = 300
        boxes = [bbox_2d(o, view) for o in objects if object_visible(o, view)]
        self.min_x = min(b[0] for b in boxes)
        self.min_y = min(b[1] for b in boxes)
        self.max_x = max(b[2] for b in boxes)
        self.max_y = max(b[3] for b in boxes)
        pad_x = (self.max_x - self.min_x) * 0.08 + 0.2
        pad_y = (self.max_y - self.min_y) * 0.10 + 0.2
        self.min_x -= pad_x
        self.max_x += pad_x
        self.min_y -= pad_y
        self.max_y += pad_y
        usable_w = PAGE_W - self.margin * 2
        usable_h = PAGE_H - self.header - self.footer
        self.scale = min(usable_w / (self.max_x - self.min_x), usable_h / (self.max_y - self.min_y))
        self.ox = self.margin + (usable_w - (self.max_x - self.min_x) * self.scale) / 2
        self.oy = self.header + (usable_h + (self.max_y - self.min_y) * self.scale) / 2
        self.draw.text((self.margin, 78), title, fill=INK, font=font(42, True))
        self.draw.text((self.margin, 136), "2D-projektion från godkänd 3D-modell. Vit bakgrund, linjer, ingen renderad materialfyllning.", fill=INK, font=font(22))

    def sx(self, x):
        return self.ox + (x - self.min_x) * self.scale

    def sy(self, y):
        return self.oy - (y - self.min_y) * self.scale

    def rect(self, box, color, width):
        x0, y0, x1, y1 = box
        # Avoid drawing tiny non-informative rectangles as filled blobs.
        if abs(x1 - x0) * self.scale < 2 or abs(y1 - y0) * self.scale < 2:
            if abs(x1 - x0) > abs(y1 - y0):
                self.draw.line([self.sx(x0), self.sy((y0 + y1) / 2), self.sx(x1), self.sy((y0 + y1) / 2)], fill=color, width=width)
            else:
                self.draw.line([self.sx((x0 + x1) / 2), self.sy(y0), self.sx((x0 + x1) / 2), self.sy(y1)], fill=color, width=width)
            return
        self.draw.rectangle([self.sx(x0), self.sy(y1), self.sx(x1), self.sy(y0)], outline=color, width=width)

    def footer_block(self, page_no):
        y = PAGE_H - 245
        self.draw.rectangle([self.margin, y, PAGE_W - self.margin, PAGE_H - 105], outline=INK, width=2)
        self.draw.text((self.margin + 24, y + 22), "Material/kulör enligt foton: vit liggande träpanel, mörkt tak, mörk stenmur/fundament.", fill=INK, font=font(22))
        self.draw.text((self.margin + 24, y + 62), "Mått enligt ansökan/platsmätning. Modellbaserad projektion; kontrollera mot godkänd 3D-modell före inlämning.", fill=INK, font=font(20))
        self.draw.text((PAGE_W - self.margin - 370, y + 22), f"Blad {page_no}", fill=INK, font=font(24, True))
        # Scale bar visual.
        bx, by = self.margin, PAGE_H - 340
        self.draw.line([bx, by, bx + 520, by], fill=INK, width=5)
        for i in range(6):
            xx = bx + i * 104
            self.draw.line([xx, by - 18, xx, by + 18], fill=INK, width=3)
        self.draw.text((bx, by + 28), "0", fill=INK, font=font(18))
        self.draw.text((bx + 480, by + 28), "5 m", fill=INK, font=font(18))


def sort_key(obj, view):
    # Back-to-front-ish drawing order.
    c = category(obj["name"])
    order = {"context": 0, "foundation": 1, "masonry": 2, "object": 3, "roof": 4, "structure": 5, "stairs": 6, "cladding": 7}
    return order.get(c, 3)


def make_page(objects, view, title, page_no):
    sheet = Sheet(title, objects, view)
    for obj in sorted(objects, key=lambda o: sort_key(o, view)):
        if not object_visible(obj, view):
            continue
        cat = category(obj["name"])
        color, width = line_style(cat)
        sheet.rect(bbox_2d(obj, view), color, width)
    sheet.footer_block(page_no)
    return sheet.img


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    objects = data["objects"]
    views = [
        ("southwest", "Fasad sydväst"),
        ("northeast", "Fasad nordöst"),
        ("west", "Fasad väst"),
        ("east", "Fasad öst"),
        ("plan", "Plan"),
        ("section_a_a", "Sektion A-A"),
    ]
    pages = []
    for i, (view, title) in enumerate(views, start=1):
        source_view = "east" if view == "section_a_a" else view
        page = make_page(objects, source_view, title, i)
        pages.append(page)
        page.save(IN_DIR / f"{view}.png")
    pdf = IN_DIR / "carport-cad-simulated-projected-line-all-views.pdf"
    pages[0].save(pdf, save_all=True, append_images=pages[1:], resolution=300.0)
    print(pdf)


if __name__ == "__main__":
    main()
