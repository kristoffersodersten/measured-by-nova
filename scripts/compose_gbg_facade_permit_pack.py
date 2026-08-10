from pathlib import Path
import sys
import unicodedata

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps


A3_LANDSCAPE_150 = (2480, 1754)


SOURCE_FILES = [
    ("Fasad mot söder", "carport_fasad_syd.jpeg"),
    ("Fasad mot sydväst", "carport_fasad_sydväst.jpeg"),
    ("Fasad mot norr", "carport_fasad_nord.jpeg"),
    ("Fasad mot nordost", "carport_fasad_nordost.jpeg"),
]


def font(size: int, bold: bool = False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def normalize_drawing(path: Path) -> Image.Image:
    im = Image.open(path).convert("L").filter(ImageFilter.MedianFilter(3))
    background = im.filter(ImageFilter.GaussianBlur(18))
    line_signal = ImageChops.subtract(background, im)
    # Preserve anti-aliased linework, remove camera/paper texture.
    alpha = line_signal.point(lambda p: 0 if p < 4 else min(255, int((p - 4) * 28)))
    alpha = alpha.filter(ImageFilter.MedianFilter(3))
    rgb = Image.new("RGB", im.size, "white")
    rgb.paste(Image.new("RGB", im.size, "black"), mask=alpha)
    return rgb


def fit(im: Image.Image, box: tuple[int, int]) -> Image.Image:
    return ImageOps.contain(im, box, Image.Resampling.LANCZOS)


def draw_scale_bar(draw: ImageDraw.ImageDraw, x: int, y: int):
    # Layout scale bar only; source geometry is from Blender export.
    bar_w = 420
    draw.line((x, y, x + bar_w, y), fill="black", width=3)
    for i, label in enumerate(("0", "2,5", "5 m")):
        tx = x + i * bar_w // 2
        draw.line((tx, y - 15, tx, y + 15), fill="black", width=3)
        draw.text((tx - 12, y + 22), label, fill="black", font=font(20))
    draw.text((x, y + 55), "Skallinjal", fill="black", font=font(20))


def draw_title_block(draw: ImageDraw.ImageDraw, page_no: int, total: int, title: str):
    x0, y0, x1, y1 = 90, 1495, 2390, 1688
    draw.rectangle((x0, y0, x1, y1), outline="black", width=2)
    draw.line((1370, y0, 1370, y1), fill="black", width=1)
    draw.line((1745, y0, 1745, y1), fill="black", width=1)
    draw.line((2050, y0, 2050, y1), fill="black", width=1)
    small = font(22)
    draw.text((110, 1518), "Åtgärd: Carport - kompletterande fasadritningar", fill="black", font=small)
    draw.text((110, 1556), "Material/kulör: vit liggande träpanel, mörk stenmur/sockel, mörkt tak.", fill="black", font=small)
    draw.text((110, 1594), "Underlag: Blender-exporterade fasader, foton och platsmätta mått.", fill="black", font=small)
    draw.text((1390, 1518), "Ritning: " + title, fill="black", font=small)
    draw.text((1390, 1556), "Skala: 1:100 på A3", fill="black", font=small)
    draw.text((1765, 1518), "Ritn.nr: A-40-" + str(page_no).zfill(2), fill="black", font=small)
    draw.text((1765, 1556), f"Blad: {page_no}/{total}", fill="black", font=small)
    draw.text((2070, 1518), "Datum: 2026-04-29", fill="black", font=small)
    draw.text((2070, 1556), "Status: Bygglovskomplettering", fill="black", font=small)


def draw_measure_notes(draw: ImageDraw.ImageDraw, x: int, y: int):
    small = font(21)
    lines = [
        "Huvudmått carport: bredd 7676 mm, djup 6240 mm.",
        "Taklutning: 3,7 %. Höjd väst/hög sida 3455 mm, öst/låg sida 3174 mm.",
        "Trappa: plansteg 295 mm, sättsteg 140 mm.",
        "Mur/sockel: sydväst ca 685-695 mm, nordost ca 500-630 mm enligt platsmätning.",
        "Marknivå: heldragen marklinje redovisar mark mot berörd fasad.",
    ]
    for i, line in enumerate(lines):
        draw.text((x, y + i * 32), line, fill="black", font=small)


def make_page(title: str, source: Path, page_no: int, total: int) -> Image.Image:
    page = Image.new("RGB", A3_LANDSCAPE_150, "white")
    draw = ImageDraw.Draw(page)
    draw.text((90, 60), title, fill="black", font=font(46, bold=True))
    draw.text((90, 118), "Fasadritning sedd rakt framifrån enligt bygglovskomplettering", fill="black", font=font(24))

    drawing = normalize_drawing(source)
    drawing = fit(drawing, (1880, 1030))
    dx = (A3_LANDSCAPE_150[0] - drawing.width) // 2
    dy = 225
    page.paste(drawing, (dx, dy))

    # Marklinje required by Göteborg examples. Kept separate from source drawing to avoid altering geometry.
    mark_y = dy + drawing.height - 48
    draw.line((dx + 80, mark_y, dx + drawing.width - 80, mark_y), fill="black", width=3)
    draw.text((dx + drawing.width - 260, mark_y + 12), "Marklinje", fill="black", font=font(20))

    draw_scale_bar(draw, 135, 1322)
    draw_measure_notes(draw, 680, 1295)
    draw_title_block(draw, page_no, total, title)
    return page


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python compose_gbg_facade_permit_pack.py source_dir output_pdf")
    source_dir = Path(sys.argv[1])
    output_pdf = Path(sys.argv[2])
    files_by_normalized_name = {
        unicodedata.normalize("NFC", path.name): path for path in source_dir.iterdir() if path.is_file()
    }
    missing = [name for _, name in SOURCE_FILES if unicodedata.normalize("NFC", name) not in files_by_normalized_name]
    if missing:
        raise FileNotFoundError("Missing source files: " + ", ".join(missing))
    pages = [
        make_page(title, files_by_normalized_name[unicodedata.normalize("NFC", filename)], index + 1, len(SOURCE_FILES))
        for index, (title, filename) in enumerate(SOURCE_FILES)
    ]
    page_dir = output_pdf.parent / (output_pdf.stem + "-pages")
    page_dir.mkdir(parents=True, exist_ok=True)
    for index, page in enumerate(pages, start=1):
        page.save(page_dir / f"page-{index:02d}.png")
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(output_pdf, save_all=True, append_images=pages[1:], resolution=150)
    print(output_pdf)


if __name__ == "__main__":
    main()
