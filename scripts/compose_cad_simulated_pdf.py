from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


PROJECT_NAME = "Carport - CAD-simulated export"
MODEL_CONFIDENCE = "High: permit/PDF dimensions. Medium: manual site measurements. Low: photo-derived visual details."


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def draw_title_block(draw, page_w, page_h, title, page_no):
    margin = 80
    block_h = 170
    y = page_h - margin - block_h
    draw.rectangle([margin, y, page_w - margin, page_h - margin], outline=(0, 0, 0), width=2)
    draw.line([margin, y + 55, page_w - margin, y + 55], fill=(0, 0, 0), width=1)
    draw.line([page_w - 760, y, page_w - 760, page_h - margin], fill=(0, 0, 0), width=1)
    draw.text((margin + 24, y + 15), title, fill=(0, 0, 0), font=font(30, True))
    draw.text((margin + 24, y + 78), "CAD-simulated export - ortografisk vy", fill=(0, 0, 0), font=font(22))
    draw.text((page_w - 730, y + 15), "Skala: 1:100 vid A3", fill=(0, 0, 0), font=font(22, True))
    draw.text((page_w - 730, y + 50), "Format: A3 liggande", fill=(0, 0, 0), font=font(20))
    draw.text((page_w - 730, y + 84), f"Blad: {page_no}", fill=(0, 0, 0), font=font(20))
    draw.text((page_w - 730, y + 118), "Material: vit träpanel, mörk stenmur, mörkt tak", fill=(0, 0, 0), font=font(18))


def draw_scale_bar(draw, x, y):
    px = 520
    draw.line([x, y, x + px, y], fill=(0, 0, 0), width=4)
    for i in range(6):
        xx = x + i * px / 5
        draw.line([xx, y - 18, xx, y + 18], fill=(0, 0, 0), width=3)
    draw.text((x, y + 28), "0", fill=(0, 0, 0), font=font(18))
    draw.text((x + px - 35, y + 28), "5 m", fill=(0, 0, 0), font=font(18))
    draw.text((x, y - 52), "Skalstock", fill=(0, 0, 0), font=font(18, True))


def annotate(draw, view_key, image_box):
    x0, _y0, _x1, y1 = image_box
    notes = {
        "plan": ["Bredd carport: 7676 mm", "Djup carport: 6240 mm", "Avstånd till granngräns: 7692 mm från yttersta sydvästra stolpe"],
        "southwest": ["Fasad sydväst", "Murhöjd: ca 685-695 mm", "Trappa: stegdjup 295 mm, steghöjd 140 mm"],
        "northeast": ["Fasad nordöst", "Murhöjd: 530 / 500 / 630 mm", "Öppningar och panel enligt fotoreferens"],
        "west": ["Fasad väst", "Taklutning: 3,7 %", "Hög sida: 3455 mm"],
        "east": ["Fasad öst", "Låg sida: 3174 mm", "Träpanel/öppningar enligt fotoreferens"],
        "section_a_a": ["Sektion A-A", "Taklutning: 3,7 %", "Stegdjup: 295 mm, steghöjd: 140 mm"],
    }.get(view_key, [])
    tx = x0 + 20
    ty = y1 + 18
    for note in notes:
        draw.text((tx, ty), note, fill=(0, 0, 0), font=font(21))
        ty += 30


def main():
    out_dir = Path("outputs/cad-simulated-export/carport-v8-all-views")
    manifest = out_dir / "rendered_views.tsv"
    rendered = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        key, title, filename = line.split("\t")
        rendered.append((key, title, out_dir / filename))

    page_w, page_h = 3508, 2480
    pages = []
    for index, (key, title, path) in enumerate(rendered, start=1):
        page = Image.new("RGB", (page_w, page_h), "white")
        draw = ImageDraw.Draw(page)
        margin = 80
        draw.text((margin, 54), PROJECT_NAME, fill=(0, 0, 0), font=font(38, True))
        draw.text((margin, 104), MODEL_CONFIDENCE, fill=(0, 0, 0), font=font(18))
        img = Image.open(path).convert("RGB")
        target_w, target_h = page_w - margin * 2, 1570
        img.thumbnail((target_w, target_h), Image.Resampling.LANCZOS)
        x = (page_w - img.width) // 2
        y = 190
        page.paste(img, (x, y))
        image_box = (x, y, x + img.width, y + img.height)
        draw.rectangle(image_box, outline=(190, 190, 190), width=1)
        annotate(draw, key, image_box)
        draw_scale_bar(draw, margin, page_h - 330)
        draw_title_block(draw, page_w, page_h, title, index)
        pages.append(page)

    pdf_path = out_dir / "carport-cad-simulated-export-all-views.pdf"
    pages[0].save(pdf_path, save_all=True, append_images=pages[1:], resolution=300.0)
    print(pdf_path)


if __name__ == "__main__":
    main()
