import math
from pathlib import Path

import bpy
from mathutils import Vector


OUT_DIR = Path("/Users/kristoffersodersten/Documents/New project 2/output")
BLEND_PATH = OUT_DIR / "blender" / "amhult_carport_model.blend"
RENDER_DIR = OUT_DIR / "renders"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def mat(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    return material


WHITE = mat("Vitmålad träpanel / stomme", (0.88, 0.90, 0.88, 1))
WHITE_DARK = mat("Skuggad vitmålad träpanel", (0.68, 0.70, 0.68, 1))
DARK_EDGE = mat("Mörk takkant / plåtbeslag", (0.02, 0.025, 0.025, 1))
ROOF = mat("Ljusgrå tak / undersida", (0.58, 0.60, 0.58, 1))
STONE = mat("Mörk stenmur / sockel", (0.12, 0.13, 0.13, 1))
STONE_ALT = mat("Stenblock variation", (0.22, 0.23, 0.22, 1))
STAIR = mat("Mörk stentrappa", (0.28, 0.29, 0.28, 1))
GROUND = mat("Mark / grus", (0.45, 0.45, 0.42, 1))
OPENING = mat("Öppet parti utan glas", (0.02, 0.02, 0.02, 0.18))


def cube(name, loc, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def board(name, loc, scale, material=WHITE):
    return cube(name, loc, scale, material)


def add_text(name, text, loc, rot=(math.radians(90), 0, 0), size=0.18):
    bpy.ops.object.text_add(location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.materials.append(DARK_EDGE)
    return obj


def add_horizontal_panel(name, x0, x1, y, z0, z1, thickness=0.075, board_h=0.105):
    z = z0
    idx = 1
    while z < z1:
        h = min(board_h, z1 - z)
        board(
            f"{name} panelbräda {idx}",
            ((x0 + x1) / 2, y, z + h / 2),
            (abs(x1 - x0), thickness, h * 0.82),
            WHITE,
        )
        z += board_h
        idx += 1


def add_horizontal_panel_with_opening(
    name,
    x0,
    x1,
    y,
    z0,
    z1,
    opening_x0,
    opening_x1,
    opening_z0,
    opening_z1,
    thickness=0.075,
    board_h=0.105,
):
    z = z0
    idx = 1
    while z < z1:
        h = min(board_h, z1 - z)
        segs = [(x0, x1)]
        if not (z + h <= opening_z0 or z >= opening_z1):
            segs = [(x0, opening_x0), (opening_x1, x1)]
        for sx0, sx1 in segs:
            if sx1 - sx0 > 0.03:
                board(
                    f"{name} panelbräda {idx}",
                    ((sx0 + sx1) / 2, y, z + h / 2),
                    (abs(sx1 - sx0), thickness, h * 0.82),
                    WHITE,
                )
                idx += 1
        z += board_h


def add_side_panel(name, y0, y1, x, z0, z1, thickness=0.075, board_h=0.105):
    z = z0
    idx = 1
    while z < z1:
        h = min(board_h, z1 - z)
        board(
            f"{name} panelbräda {idx}",
            (x, (y0 + y1) / 2, z + h / 2),
            (thickness, abs(y1 - y0), h * 0.82),
            WHITE,
        )
        z += board_h
        idx += 1


def add_side_panel_with_opening(
    name,
    y0,
    y1,
    x,
    z0,
    z1,
    opening_y0,
    opening_y1,
    opening_z0,
    opening_z1,
    thickness=0.075,
    board_h=0.105,
):
    z = z0
    idx = 1
    while z < z1:
        h = min(board_h, z1 - z)
        segs = [(y0, y1)]
        if not (z + h <= opening_z0 or z >= opening_z1):
            segs = [(y0, opening_y0), (opening_y1, y1)]
        for sy0, sy1 in segs:
            if sy1 - sy0 > 0.03:
                board(
                    f"{name} panelbräda {idx}",
                    (x, (sy0 + sy1) / 2, z + h / 2),
                    (thickness, abs(sy1 - sy0), h * 0.82),
                    WHITE,
                )
                idx += 1
        z += board_h


def add_stone_wall(name, x0, x1, y0, y1, height, block_axis="x"):
    cube(f"{name} sockel bas", ((x0 + x1) / 2, (y0 + y1) / 2, height / 2), (x1 - x0, y1 - y0, height), STONE)
    block_w = 0.42
    block_h = 0.22
    row = 0
    z = 0.12
    while z < height - 0.05:
        offset = 0 if row % 2 == 0 else block_w / 2
        if block_axis == "x":
            x = x0 + block_w / 2 - offset
            while x < x1:
                cube(f"{name} sten {row}-{round(x,2)}", (x, y0 - 0.012, z), (block_w * 0.92, 0.035, block_h * 0.75), STONE_ALT if row % 2 else STONE)
                x += block_w
        else:
            y = y0 + block_w / 2 - offset
            while y < y1:
                cube(f"{name} sten {row}-{round(y,2)}", (x0 - 0.012, y, z), (0.035, block_w * 0.92, block_h * 0.75), STONE_ALT if row % 2 else STONE)
                y += block_w
        row += 1
        z += block_h


def add_opening_marker(name, loc, scale):
    obj = cube(name, loc, scale, OPENING)
    obj.display_type = "WIRE"
    obj.hide_render = True
    return obj


def add_roof():
    length = 7.676
    depth = 6.240
    z_west = 3.455
    z_east = 3.174
    verts = [
        (-length / 2 - 0.20, -depth / 2 - 0.28, z_west),
        (-length / 2 - 0.20, depth / 2 + 0.28, z_west),
        (length / 2 + 0.20, depth / 2 + 0.28, z_east),
        (length / 2 + 0.20, -depth / 2 - 0.28, z_east),
        (-length / 2 - 0.20, -depth / 2 - 0.28, z_west + 0.16),
        (-length / 2 - 0.20, depth / 2 + 0.28, z_west + 0.16),
        (length / 2 + 0.20, depth / 2 + 0.28, z_east + 0.16),
        (length / 2 + 0.20, -depth / 2 - 0.28, z_east + 0.16),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new("Lutande pulpettak mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("Lutande pulpettak 3,7 procent", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(ROOF)
    cube("Mörk främre takkant", (0, -depth / 2 - 0.37, (z_west + z_east) / 2 + 0.17), (length + 0.70, 0.08, 0.07), DARK_EDGE)
    cube("Mörk bakre takkant", (0, depth / 2 + 0.37, (z_west + z_east) / 2 + 0.17), (length + 0.70, 0.08, 0.07), DARK_EDGE)


def build_model():
    clear_scene()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1

    length = 7.676
    depth = 6.240
    xw = -length / 2
    xe = length / 2
    ys = -depth / 2
    yn = depth / 2
    z_top_w = 3.455
    z_top_e = 3.174

    cube("Markplan", (0, 0, -0.035), (10.5, 8.4, 0.07), GROUND)

    add_roof()

    # Stenmur/sockel enligt mätning och foton.
    add_stone_wall("Sydväst fasad", xw, xe, ys - 0.04, ys + 0.10, 0.69, "x")
    add_stone_wall("Nordöst fasad", xw, xe, yn - 0.10, yn + 0.04, 0.56, "x")
    add_stone_wall("Västra kortsida", xw - 0.04, xw + 0.10, ys, yn, 0.69, "y")
    add_stone_wall("Östra kortsida", xe - 0.10, xe + 0.04, ys, yn, 0.56, "y")

    # Pelare och huvudbalkar.
    for x in [xw, -1.3, 1.35, xe]:
        ztop = z_top_w + (x - xw) / length * (z_top_e - z_top_w)
        for y in [ys, yn]:
            post_h = ztop - 0.55
            cube(f"Vit pelare x{x:.1f} y{y:.1f}", (x, y, 0.69 + post_h / 2), (0.16, 0.16, post_h), WHITE)

    cube("Främre vit bärlina", (0, ys, 3.02), (length, 0.16, 0.18), WHITE)
    cube("Bakre vit bärlina", (0, yn, 3.02), (length, 0.16, 0.18), WHITE)
    cube("Mittbalk längs bilplats", (0, 0, 2.80), (length, 0.14, 0.16), WHITE_DARK)

    # Sydväst/mot väg: framsidan är helt öppen enligt foton.
    add_opening_marker("Sydväst öppen infart utan glas eller port", (0, ys - 0.10, 1.85), (length - 0.45, 0.035, 2.25))

    # Nordöst/gård: panelväggar med en central öppen passage. Ingen glasning.
    add_horizontal_panel("Nordöst vänster panelvägg", xw, xw + 2.15, yn + 0.08, 0.56, 2.35)
    add_horizontal_panel("Nordöst höger panelvägg", xe - 2.25, xe, yn + 0.08, 0.56, 2.35)
    add_opening_marker("Nordöst infälld passage utan glas", (0, yn + 0.10, 1.80), (length - 4.4, 0.035, 2.20))

    # Trappan är infälld i öppningen och fortsätter in under carporttaket.
    stair_width = 2.20
    for i in range(3):
        cube(
            f"Stentrappa steg {i + 1} - stegdjup 295 mm steghöjd 140 mm",
            (0, yn - 0.30 + i * 0.295, 0.07 + i * 0.14),
            (stair_width + i * 0.28, 0.295, 0.14),
            STAIR,
        )
    cube("Infällt vilplan i carportöppning", (0, yn - 0.95, 0.43), (2.60, 0.72, 0.12), STAIR)

    # Trappa ner mot huset på sydvästra/husnära sidan enligt foto.
    for i in range(4):
        cube(
            f"Sydväst trappa ner mot hus steg {i + 1}",
            (xw - 0.70, ys + 0.75 + i * 0.295, 0.07 + i * 0.14),
            (1.35, 0.295, 0.14),
            STAIR,
        )
    cube("Sydväst trappavsats mot hus", (xw - 0.70, ys + 2.05, 0.62), (1.55, 0.55, 0.12), STAIR)

    # Långsida enligt foton: vit panel runt stor rektangulär öppning utan glas.
    add_side_panel_with_opening(
        "Västra fasaden panel runt öppning",
        ys,
        yn,
        xw - 0.08,
        0.69,
        2.55,
        ys + 2.85,
        yn - 0.55,
        1.42,
        2.45,
    )
    add_opening_marker("Väst lång öppning utan glas", (xw - 0.10, 1.10, 1.94), (0.035, 2.55, 1.03))

    # Motsatt långsida: större panelvägg och öppen sektion mot baksida.
    add_side_panel_with_opening(
        "Östra fasaden panel runt öppning",
        ys,
        yn,
        xe + 0.08,
        0.56,
        2.45,
        yn - 1.75,
        yn - 0.25,
        1.35,
        2.35,
    )
    add_opening_marker("Öst öppning utan glas", (xe + 0.10, yn - 1.0, 1.85), (0.035, 1.50, 1.00))

    add_text("Materialetikett panel", "Vit liggande träpanel", (0, ys - 0.55, 1.15), size=0.18)
    add_text("Materialetikett sten", "Mörk stenmur/sockel", (0, ys - 0.55, 0.35), size=0.18)
    add_text("Öppningsetikett", "Öppningar utan glas", (0, 0, 2.25), size=0.20)
    add_text("Trappetikett", "Trappa 295/140 mm", (0, yn + 1.25, 0.55), size=0.16)

    add_lights()
    add_cameras()


def add_lights():
    bpy.ops.object.light_add(type="AREA", location=(0, -4, 6))
    light = bpy.context.object
    light.name = "Stor mjuk arbetsbelysning"
    light.data.energy = 700
    light.data.size = 6
    bpy.context.scene.world = bpy.data.worlds.new("Ljus grå arbetsbakgrund")
    bpy.context.scene.world.color = (0.78, 0.80, 0.82)


def camera(name, loc, target, ortho_scale):
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    cam.name = name
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho_scale
    return cam


def add_cameras():
    camera("Fasad sydväst - mot väg", (0, -11, 2.0), (0, 0, 1.7), 8.8)
    camera("Fasad nordöst - mot gård", (0, 11, 2.0), (0, 0, 1.7), 8.8)
    camera("Fasad väst", (-10, 0, 2.0), (0, 0, 1.7), 7.2)
    camera("Fasad öst", (10, 0, 2.0), (0, 0, 1.7), 7.2)
    camera("Översikt perspektiv", (7.5, -8, 5.4), (0, 0, 1.5), 9.0)


def render_cameras():
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.resolution_x = 2400
    bpy.context.scene.render.resolution_y = 1600
    if hasattr(bpy.context.scene, "eevee"):
        bpy.context.scene.eevee.taa_render_samples = 64
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    for cam in [obj for obj in bpy.context.scene.objects if obj.type == "CAMERA"]:
        apply_facade_visibility(cam.name)
        bpy.context.scene.camera = cam
        safe = cam.name.lower().replace(" ", "_").replace("-", "").replace("å", "a").replace("ä", "a").replace("ö", "o")
        bpy.context.scene.render.filepath = str(RENDER_DIR / f"{safe}.png")
        bpy.ops.render.render(write_still=True)
    apply_facade_visibility("")


def apply_facade_visibility(camera_name):
    for obj in bpy.context.scene.objects:
        if obj.type == "CAMERA":
            continue
        obj.hide_render = obj.name.startswith(("Sydväst öppen", "Nordöst infälld", "Väst lång öppning", "Öst öppning"))
        if obj.type == "FONT":
            obj.hide_render = True

    hide_terms = []
    if camera_name.startswith("Fasad sydväst"):
        hide_terms = ["Nordöst", "Östra fasaden", "Västra fasaden"]
    elif camera_name.startswith("Fasad nordöst"):
        hide_terms = ["Sydväst", "Östra fasaden", "Västra fasaden"]
    elif camera_name == "Fasad väst":
        hide_terms = ["Östra", "Öst "]
    elif camera_name == "Fasad öst":
        hide_terms = ["Västra", "Väst "]

    for obj in bpy.context.scene.objects:
        if any(term in obj.name for term in hide_terms):
            obj.hide_render = True


def main():
    build_model()
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    render_cameras()
    print(f"Saved {BLEND_PATH}")


if __name__ == "__main__":
    main()
