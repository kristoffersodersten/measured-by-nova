from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps


A3_LANDSCAPE_150DPI = (2480, 1754)


def font(size):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def clean_render(src):
    im = Image.open(src).convert("RGB")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = px[x, y]
            if abs(r - g) < 4 and abs(g - b) < 4 and 40 <= r <= 225:
                px[x, y] = (255, 255, 255)
            elif r > 235 and g > 235 and b > 235:
                px[x, y] = (255, 255, 255)
            elif r < 45 and g < 45 and b < 45:
                px[x, y] = (0, 0, 0)
    gray = im.convert("L")
    mask = gray.point(lambda p: 0 if p > 248 else 255, "L")
    bbox = mask.getbbox()
    if bbox:
        im = im.crop(bbox)
    return im


def fit_image(im, box):
    x, y, w, h = box
    im = ImageOps.contain(im, (w, h), Image.Resampling.LANCZOS)
    out = Image.new("RGB", (w, h), "white")
    out.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return out


def page_for_view(title, source_name, im):
    page = Image.new("RGB", A3_LANDSCAPE_150DPI, "white")
    draw = ImageDraw.Draw(page)
    title_font = font(42)
    small = font(24)
    note = font(20)
    draw.text((90, 70), title, fill="black", font=title_font)
    draw.text((90, 124), "CAD-simulated export från verifierad Blender-modell", fill="black", font=small)
    drawing = fit_image(im, (110, 200, 2260, 1160))
    page.paste(drawing, (110, 200))
    # Scale bar / drawing frame / title block. Geometry remains Blender-derived.
    draw.line((140, 1420, 540, 1420), fill="black", width=3)
    for x in (140, 340, 540):
        draw.line((x, 1405, x, 1435), fill="black", width=3)
    draw.text((140, 1445), "Skallinjal 0-5 m (indikativ layout, modell i mm)", fill="black", font=note)
    draw.rectangle((90, 1510, 2390, 1680), outline="black", width=2)
    draw.line((1500, 1510, 1500, 1680), fill="black", width=1)
    draw.line((1900, 1510, 1900, 1680), fill="black", width=1)
    draw.text((110, 1530), "Material/kulör: vit liggande träpanel, mörk stenmur/sockel, mörkt tak.", fill="black", font=note)
    draw.text((110, 1570), "Underlag: sparad 3D-modell + foton som visuell/materialreferens.", fill="black", font=note)
    draw.text((1520, 1530), "Skala: 1:100 på A3", fill="black", font=note)
    draw.text((1920, 1530), "Källa: " + source_name, fill="black", font=note)
    draw.text((1920, 1570), "Export: Blender ortografisk vy", fill="black", font=note)
    return page


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python compose_blender_native_cad_pdf.py input_dir output_pdf")
    input_dir = Path(sys.argv[1])
    output_pdf = Path(sys.argv[2])
    rows = []
    for line in (input_dir / "views.tsv").read_text(encoding="utf-8").splitlines():
        key, title, filename = line.split("\t")
        rows.append((key, title, filename))
    cleaned_dir = input_dir / "cleaned"
    cleaned_dir.mkdir(exist_ok=True)
    pages = []
    for key, title, filename in rows:
        cleaned = clean_render(input_dir / filename)
        cleaned_path = cleaned_dir / f"{key}.png"
        cleaned.save(cleaned_path)
        pages.append(page_for_view(title, filename, cleaned))
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(output_pdf, save_all=True, append_images=pages[1:], resolution=150)
    print(output_pdf)


if __name__ == "__main__":
    main()
