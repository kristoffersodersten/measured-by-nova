import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


MM = 0.001

WIDTH = 7676 * MM
DEPTH = 6240 * MM
HIGH = 3455 * MM
LOW = 3174 * MM
ROOF_THICKNESS = 160 * MM
ROOF_OVERHANG = 260 * MM
POST = 145 * MM
INNER_POST = 110 * MM
FOUNDATION = 180 * MM
SW_FOUNDATION_H = 695 * MM
NE_FOUNDATION_H = 630 * MM
PANEL_LOW_H = 1320 * MM
CLADDING_SPACING = 145 * MM


def mat(name, color):
    existing = bpy.data.materials.get(name)
    if existing:
        existing.diffuse_color = color
        return existing
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    return material


WHITE_WOOD = mat("vit liggande träpanel", (0.92, 0.92, 0.88, 1))
WOOD_SHADOW = mat("panelspår", (0.46, 0.46, 0.43, 1))
STONE = mat("mörk stenmur", (0.08, 0.09, 0.10, 1))
STONE_JOINT = mat("stenfog", (0.34, 0.34, 0.32, 1))
ROOF = mat("mörkt tak/fascia", (0.02, 0.03, 0.03, 1))
GRAVEL = mat("körbar grus-/markyta", (0.30, 0.30, 0.28, 1))
STAIR = mat("grå stentrappa", (0.42, 0.42, 0.38, 1))
APPROX = mat("låg-konfidens kontext", (0.26, 0.26, 0.25, 1))


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def cube(name, loc, dim, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dim
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def roof_z_at_x(x, offset=0):
    return HIGH + ((LOW - HIGH) / WIDTH) * x + offset


def add_roof():
    x0 = -ROOF_OVERHANG
    x1 = WIDTH + ROOF_OVERHANG
    y0 = -ROOF_OVERHANG
    y1 = DEPTH + ROOF_OVERHANG
    vertices = [
        (x0, y0, roof_z_at_x(x0)),
        (x1, y0, roof_z_at_x(x1)),
        (x1, y1, roof_z_at_x(x1)),
        (x0, y1, roof_z_at_x(x0)),
        (x0, y0, roof_z_at_x(x0, -ROOF_THICKNESS)),
        (x1, y0, roof_z_at_x(x1, -ROOF_THICKNESS)),
        (x1, y1, roof_z_at_x(x1, -ROOF_THICKNESS)),
        (x0, y1, roof_z_at_x(x0, -ROOF_THICKNESS)),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new("tak-mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("tak - lutande enplans tak", mesh)
    obj.data.materials.append(ROOF)
    bpy.context.collection.objects.link(obj)


def add_foundation():
    cube("mur sydväst/front 695mm", (WIDTH / 2, FOUNDATION / 2, -SW_FOUNDATION_H / 2), (WIDTH, FOUNDATION, SW_FOUNDATION_H), STONE)
    cube("mur nordöst/bak 630mm", (WIDTH / 2, DEPTH - FOUNDATION / 2, -NE_FOUNDATION_H / 2), (WIDTH, FOUNDATION, NE_FOUNDATION_H), STONE)
    cube("mur västra sida ansluten", (FOUNDATION / 2, DEPTH / 2, -SW_FOUNDATION_H / 2), (FOUNDATION, DEPTH - FOUNDATION * 2, SW_FOUNDATION_H), STONE)
    cube("mur östra sida ansluten", (WIDTH - FOUNDATION / 2, DEPTH / 2, -NE_FOUNDATION_H / 2), (FOUNDATION, DEPTH - FOUNDATION * 2, NE_FOUNDATION_H), STONE)

    for y, name, height in ((-0.012, "sydväst", SW_FOUNDATION_H), (DEPTH + 0.012, "nordöst", NE_FOUNDATION_H)):
        cube(f"stenfog horisontell {name}", (WIDTH / 2, y, -height / 2), (WIDTH, 0.012, 0.014), STONE_JOINT)
        for i in range(1, 14):
            cube(f"stenfog vertikal {name} {i}", (i * WIDTH / 14, y, -height / 2), (0.012, 0.012, height), STONE_JOINT)


def add_post(name, x, y, size=POST):
    h = roof_z_at_x(x, -ROOF_THICKNESS)
    return cube(name, (x + size / 2, y + size / 2, h / 2), (size, size, h), WHITE_WOOD)


def add_posts():
    add_post("stolpe sydväst vänster hörn till tak", 0, 0)
    add_post("stolpe sydväst höger hörn till tak", WIDTH - POST, 0)
    add_post("stolpe nordöst vänster hörn till tak", 0, DEPTH - POST)
    add_post("stolpe nordöst höger hörn till tak", WIDTH - POST, DEPTH - POST)

    # Sydväst: två stolpar runt trapp-/gångöppningen.
    for x in (WIDTH * 0.42, WIDTH * 0.58):
        add_post("sydväst öppningsstolpe till tak", x - INNER_POST / 2, 0, INNER_POST)

    # Nordöst: en stor öppning, med huvudstolpe och mittstolpe enligt foto.
    opening_x = WIDTH * 0.64
    add_post("nordöst öppningsstolpe till tak", opening_x - INNER_POST / 2, DEPTH - INNER_POST, INNER_POST)
    add_post("nordöst inre stolpe i stor öppning", WIDTH * 0.80 - INNER_POST / 2, DEPTH - INNER_POST, INNER_POST)


def add_header(name, x0, x1, y):
    x = (x0 + x1) / 2
    z = roof_z_at_x(x, -ROOF_THICKNESS - 70 * MM)
    cube(name, (x, y, z), (x1 - x0, 110 * MM, 140 * MM), WHITE_WOOD)


def add_headers():
    add_header("sydväst header över öppen passage", WIDTH * 0.42, WIDTH * 0.58, -40 * MM)
    add_header("nordöst header över stor öppning", WIDTH * 0.64, WIDTH - POST, DEPTH + 40 * MM)
    cube("frontbalk sydväst under tak", (WIDTH / 2, POST / 2, roof_z_at_x(WIDTH / 2, -ROOF_THICKNESS - 110 * MM)), (WIDTH, POST, 220 * MM), WHITE_WOOD)
    cube("bakbalk nordöst under tak", (WIDTH / 2, DEPTH - POST / 2, roof_z_at_x(WIDTH / 2, -ROOF_THICKNESS - 110 * MM)), (WIDTH, POST, 220 * MM), WHITE_WOOD)


def panel(name, x0, x1, y, z0, height, outward=1):
    face_y = y
    cube(name, ((x0 + x1) / 2, face_y, z0 + height / 2), (x1 - x0, 70 * MM, height), WHITE_WOOD)
    groove_y = face_y + outward * 42 * MM
    count = int(height / CLADDING_SPACING)
    for i in range(1, count):
        z = z0 + i * CLADDING_SPACING
        cube(f"{name} panelspår {i}", ((x0 + x1) / 2, groove_y, z), (x1 - x0, 12 * MM, 10 * MM), WOOD_SHADOW)


def side_panel(name, x, y0, y1, z0, height, outward=1):
    cube(name, (x, (y0 + y1) / 2, z0 + height / 2), (70 * MM, y1 - y0, height), WHITE_WOOD)
    groove_x = x + outward * 42 * MM
    count = int(height / CLADDING_SPACING)
    for i in range(1, count):
        z = z0 + i * CLADDING_SPACING
        cube(f"{name} panelspår {i}", (groove_x, (y0 + y1) / 2, z), (10 * MM, y1 - y0, 10 * MM), WOOD_SHADOW)


def add_panels():
    # Sydväst/framsida: detta är den godkända referensvyn - låg panel vänster
    # och höger, fri mittöppning med trappa.
    panel("sydväst låg träpanel vänster", POST, WIDTH * 0.42 - INNER_POST / 2, -35 * MM, 0, PANEL_LOW_H, -1)
    panel("sydväst låg träpanel höger", WIDTH * 0.58 + INNER_POST / 2, WIDTH - POST, -35 * MM, 0, PANEL_LOW_H, -1)

    # Baksida: inte en kopia av framsidan. Vänster passage är öppen,
    # mitten är hel trävägg upp till tak och höger del har låg panel/öppning.
    back_wall_start = WIDTH * 0.32
    back_wall_end = WIDTH * 0.73
    back_full_h = roof_z_at_x((back_wall_start + back_wall_end) / 2, -ROOF_THICKNESS)
    panel("baksida hel trävägg upp till tak", back_wall_start, back_wall_end, DEPTH + 35 * MM, 0, back_full_h, 1)
    panel("baksida låg panel vid öppning", back_wall_end + INNER_POST, WIDTH - POST, DEPTH + 35 * MM, 0, PANEL_LOW_H, 1)

    # Nordöstra långsidan enligt foto: trä till tak på ena delen och EN stor
    # öppning med låg panel under öppningen på andra delen.
    ne_wall_end = DEPTH * 0.58
    ne_full_h = roof_z_at_x(WIDTH - POST, -ROOF_THICKNESS)
    side_panel("nordöst långsida träpanel upp till tak", WIDTH + 35 * MM, POST, ne_wall_end, 0, ne_full_h, 1)
    side_panel("nordöst långsida låg panel under stor öppning", WIDTH + 35 * MM, ne_wall_end + INNER_POST, DEPTH - POST, 0, PANEL_LOW_H, 1)

    # Motsatt långsida: låg panelzon men tydliga öppningar, inte en hel vägg.
    side_panel("sydväst långsida låg panel", -35 * MM, DEPTH * 0.18, DEPTH * 0.55, 0, PANEL_LOW_H, -1)


def add_floor_and_steps():
    cube("körbart grusgolv inne i carport", (WIDTH / 2, DEPTH / 2, 10 * MM), (WIDTH - FOUNDATION * 2, DEPTH - FOUNDATION * 2, 20 * MM), GRAVEL)
    step_count = 5
    step_rise = SW_FOUNDATION_H / step_count
    step_depth = 295 * MM
    step_width = 1100 * MM
    x = WIDTH / 2
    for i in range(step_count):
        h = (i + 1) * step_rise
        y = -step_depth * (step_count - i - 0.5)
        cube(f"trappa centrerad vid sydväst öppning steg {i + 1}", (x, y, -SW_FOUNDATION_H + h / 2), (step_width + i * 90 * MM, step_depth, h), STAIR)


def add_context():
    cube("ungefärlig markplatta endast referens", (WIDTH / 2, DEPTH / 2, -SW_FOUNDATION_H - 20 * MM), (WIDTH + 1100 * MM, DEPTH + 1100 * MM, 20 * MM), APPROX)


def add_cameras():
    specs = {
        "Kamera_sydväst": ((WIDTH / 2, -10, 1.4), (math.radians(90), 0, 0)),
        "Kamera_nordöst": ((WIDTH / 2, DEPTH + 10, 1.4), (math.radians(90), 0, math.radians(180))),
        "Kamera_väst": ((-10, DEPTH / 2, 1.4), (math.radians(90), 0, math.radians(-90))),
        "Kamera_öst": ((WIDTH + 10, DEPTH / 2, 1.4), (math.radians(90), 0, math.radians(90))),
        "Kamera_plan": ((WIDTH / 2, DEPTH / 2, 12), (0, 0, 0)),
    }
    for name, (loc, rot) in specs.items():
        bpy.ops.object.camera_add(location=loc, rotation=rot)
        cam = bpy.context.object
        cam.name = name
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 9
        cam.data.display_size = 0.35
    bpy.context.scene.camera = bpy.data.objects["Kamera_sydväst"]


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender --background --python build_carport_ground_truth_model.py -- output.blend")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    clear()
    add_roof()
    add_foundation()
    add_floor_and_steps()
    add_posts()
    add_headers()
    add_panels()
    add_context()
    add_cameras()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))


if __name__ == "__main__":
    main()
