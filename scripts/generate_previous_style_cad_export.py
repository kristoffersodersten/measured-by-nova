from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT_DIR = Path("outputs/cad-simulated-export/carport-v8-previous-style")

WIDTH = 7676.0
DEPTH = 6240.0
HIGH = 3455.0
LOW = 3174.0
ROOF_FASCIA = 360.0
FOUNDATION_SW = 695.0
FOUNDATION_NE = 630.0
PANEL_H = 1320.0
POST = 145.0
STEP_DEPTH = 295.0
STEP_HEIGHT = 140.0
ROAD_STEPS = 4

PAGE_W = 3508
PAGE_H = 2480
INK = (18, 18, 18)
MID = (90, 90, 90)
LIGHT = (145, 145, 145)


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


def roof_z(x):
    return HIGH + (LOW - HIGH) * (x / WIDTH)


class Sheet:
    def __init__(self, title, model_w, model_min_z, model_max_z):
        self.title = title
        self.img = Image.new("RGB", (PAGE_W, PAGE_H), "white")
        self.draw = ImageDraw.Draw(self.img)
        self.margin = 190
        self.title_h = 260
        self.footer_h = 300
        usable_w = PAGE_W - self.margin * 2
        usable_h = PAGE_H - self.title_h - self.footer_h
        self.scale = min(usable_w / model_w, usable_h / (model_max_z - model_min_z))
        self.ox = self.margin + (usable_w - model_w * self.scale) / 2
        self.oy = self.title_h + (usable_h + model_max_z * self.scale) / 2
        self.draw.text((self.margin, 82), title, fill=INK, font=font(42, True))
        self.draw.text((self.margin, 140), "CAD-simulated linjeritning - vit bakgrund - skiss enligt fasadritningskrav", fill=INK, font=font(22))

    def x(self, v):
        return self.ox + v * self.scale

    def y(self, v):
        return self.oy - v * self.scale

    def line(self, x1, z1, x2, z2, color=INK, width=3):
        self.draw.line([self.x(x1), self.y(z1), self.x(x2), self.y(z2)], fill=color, width=width)

    def rect(self, x, z, w, h, color=INK, width=3):
        self.draw.rectangle([self.x(x), self.y(z + h), self.x(x + w), self.y(z)], outline=color, width=width)

    def text_model(self, text, x, z, size=22):
        self.draw.text((self.x(x), self.y(z)), text, fill=INK, font=font(size))

    def finish(self, page_no):
        y = PAGE_H - 245
        self.draw.rectangle([self.margin, y, PAGE_W - self.margin, PAGE_H - 105], outline=INK, width=2)
        self.draw.text((self.margin + 24, y + 22), "Material/kulör: vit liggande träpanel, mörkt tak, mörk stenmur/fundament", fill=INK, font=font(22))
        self.draw.text((self.margin + 24, y + 62), "Skala: 1:100 vid A3 | Mått enligt ansökan/platsmätning | Foton visar material och fasadindelning", fill=INK, font=font(20))
        self.draw.text((PAGE_W - self.margin - 380, y + 22), f"Blad {page_no}", fill=INK, font=font(24, True))
        # scale bar
        bx, by = self.margin, PAGE_H - 340
        self.draw.line([bx, by, bx + 520, by], fill=INK, width=5)
        for i in range(6):
            xx = bx + i * 104
            self.draw.line([xx, by - 18, xx, by + 18], fill=INK, width=3)
        self.draw.text((bx, by + 28), "0", fill=INK, font=font(18))
        self.draw.text((bx + 480, by + 28), "5 m", fill=INK, font=font(18))
        return self.img


def cladding(sheet, ranges, z0=220, z1=PANEL_H - 80):
    z = z0
    while z < z1:
        for x0, x1 in ranges:
            sheet.line(x0, z, x1, z, LIGHT, 2)
        z += 145


def masonry(sheet, width, foundation):
    sheet.rect(0, -foundation, width, foundation, MID, 3)
    sheet.line(0, -foundation / 2, width, -foundation / 2, LIGHT, 2)
    block = 560
    x = 0
    while x <= width:
        sheet.line(x, -foundation, x, 0, LIGHT, 2)
        x += block


def roof_band(sheet, width, mirrored=False):
    left = roof_z(WIDTH if mirrored else 0)
    right = roof_z(0 if mirrored else WIDTH)
    sheet.line(0, left, width, right, INK, 4)
    sheet.line(0, left - ROOF_FASCIA, width, right - ROOF_FASCIA, INK, 3)
    sheet.line(0, left, 0, left - ROOF_FASCIA, INK, 3)
    sheet.line(width, right, width, right - ROOF_FASCIA, INK, 3)
    return left - ROOF_FASCIA, right - ROOF_FASCIA


def draw_center_steps(sheet, center_x, foundation=FOUNDATION_SW):
    count = max(4, round(foundation / STEP_HEIGHT))
    step_w = 980
    for i in range(count):
        w = step_w + (count - i - 1) * 130
        x = center_x - w / 2
        z0 = -(count - i) * (foundation / count)
        z1 = z0 + foundation / count
        sheet.rect(x, z0, w, z1 - z0, INK, 2)
        sheet.line(x, z1, x + w, z1, INK, 3)


def draw_left_road_steps(sheet):
    step_w = 1450
    step_h = FOUNDATION_SW / ROAD_STEPS
    for i in range(ROAD_STEPS):
        x = -180
        w = step_w + i * STEP_DEPTH
        z0 = -(i + 1) * step_h
        z1 = z0 + step_h
        sheet.rect(x, z0, w, z1 - z0, MID, 2)


def southwest():
    s = Sheet("Fasad sydväst", WIDTH + 360, -FOUNDATION_SW - 420, HIGH + 420)
    masonry(s, WIDTH, FOUNDATION_SW)
    left_under, right_under = roof_band(s, WIDTH)
    # posts
    open_l, open_r = WIDTH * 0.48, WIDTH * 0.60
    for x, h in [(0, left_under), (WIDTH - POST, right_under), (open_l, roof_z(open_l) - ROOF_FASCIA), (open_r, roof_z(open_r) - ROOF_FASCIA)]:
        s.rect(x, 0, POST if x in (0, WIDTH - POST) else 110, h, INK, 3)
    # panels left/right
    left_panel = (POST, open_l)
    right_panel = (open_r + 110, WIDTH - POST)
    s.rect(left_panel[0], 0, left_panel[1] - left_panel[0], PANEL_H, INK, 3)
    s.rect(right_panel[0], 0, right_panel[1] - right_panel[0], PANEL_H, INK, 3)
    cladding(s, [left_panel, right_panel])
    draw_center_steps(s, (open_l + open_r + 110) / 2)
    draw_left_road_steps(s)
    s.line(-80, -FOUNDATION_SW - 260, WIDTH + 80, -FOUNDATION_SW - 260, MID, 3)
    return s.finish(1)


def northeast():
    s = Sheet("Fasad nordöst", WIDTH + 360, -FOUNDATION_NE - 360, HIGH + 420)
    masonry(s, WIDTH, FOUNDATION_NE)
    left_under, right_under = roof_band(s, WIDTH, mirrored=True)
    # photo logic: left passage/opening, middle wall to roof, right opening/low panel
    pass_end = WIDTH * 0.30
    wall_start = pass_end
    wall_end = WIDTH * 0.74
    for x in [0, pass_end, wall_end, WIDTH - POST]:
        h = min(left_under, right_under)
        s.rect(x, 0, POST if x in (0, WIDTH - POST) else 110, h, INK, 3)
    s.rect(wall_start, 0, wall_end - wall_start, min(left_under, right_under), INK, 3)
    cladding(s, [(wall_start, wall_end)], 220, min(left_under, right_under) - 120)
    s.rect(wall_end + 110, 0, WIDTH - POST - wall_end - 110, PANEL_H, INK, 3)
    cladding(s, [(wall_end + 110, WIDTH - POST)])
    s.line(-80, -FOUNDATION_NE - 230, WIDTH + 80, -FOUNDATION_NE - 230, MID, 3)
    return s.finish(2)


def short_side(title, page_no, height, foundation, large_opening=True):
    s = Sheet(title, DEPTH + 360, -foundation - 320, height + 420)
    masonry(s, DEPTH, foundation)
    top = height
    s.line(0, top, DEPTH, top, INK, 4)
    s.line(0, top - ROOF_FASCIA, DEPTH, top - ROOF_FASCIA, INK, 3)
    s.line(0, top, 0, top - ROOF_FASCIA, INK, 3)
    s.line(DEPTH, top, DEPTH, top - ROOF_FASCIA, INK, 3)
    for x in [0, DEPTH - POST]:
        s.rect(x, 0, POST, top - ROOF_FASCIA, INK, 3)
    if large_opening:
        panel = (0, DEPTH * 0.46)
        s.rect(panel[0], 0, panel[1] - panel[0], PANEL_H, INK, 3)
        cladding(s, [panel])
        s.rect(DEPTH * 0.64, 0, POST, top - ROOF_FASCIA, INK, 3)
    else:
        panel = (POST, DEPTH * 0.55)
        s.rect(panel[0], 0, panel[1] - panel[0], PANEL_H, INK, 3)
        cladding(s, [panel])
    s.line(-80, -foundation - 210, DEPTH + 80, -foundation - 210, MID, 3)
    return s.finish(page_no)


def plan():
    s = Sheet("Plan", WIDTH + 500, -450, DEPTH + 450)
    s.rect(0, 0, WIDTH, DEPTH, INK, 4)
    # roof/outer outline
    s.rect(-260, -260, WIDTH + 520, DEPTH + 520, MID, 2)
    # posts
    for x, y in [(0, 0), (WIDTH - POST, 0), (0, DEPTH - POST), (WIDTH - POST, DEPTH - POST)]:
        s.rect(x, y, POST, POST, INK, 3)
    # panels as plan strips
    s.rect(POST, 0, WIDTH * 0.40, 70, INK, 2)
    s.rect(WIDTH * 0.62, 0, WIDTH * 0.36 - POST, 70, INK, 2)
    s.rect(WIDTH * 0.30, DEPTH - 70, WIDTH * 0.44, 70, INK, 2)
    s.text_model("7676 mm", WIDTH * 0.42, -260, 22)
    s.text_model("6240 mm", WIDTH + 120, DEPTH * 0.45, 22)
    return s.finish(5)


def section():
    img = short_side("Sektion A-A", 6, (HIGH + LOW) / 2, FOUNDATION_SW, large_opening=False)
    return img


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pages = [
        southwest(),
        northeast(),
        short_side("Fasad väst", 3, HIGH, FOUNDATION_SW, large_opening=False),
        short_side("Fasad öst", 4, LOW, FOUNDATION_NE, large_opening=True),
        plan(),
        section(),
    ]
    names = ["southwest", "northeast", "west", "east", "plan", "section_a_a"]
    for name, img in zip(names, pages):
        img.save(OUT_DIR / f"{name}.png")
    pdf = OUT_DIR / "carport-cad-simulated-previous-style-all-views.pdf"
    pages[0].save(pdf, save_all=True, append_images=pages[1:], resolution=300.0)
    print(pdf)


if __name__ == "__main__":
    main()
