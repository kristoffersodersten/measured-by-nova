import sys
from pathlib import Path

import bpy


MM = 0.001
PREFIX = "finish-detail-"
CLADDING_SPACING = 145 * MM
GROOVE_THICKNESS = 8 * MM
GROOVE_PROJECTION = 10 * MM
TRIM_WIDTH = 70 * MM
TRIM_DEPTH = 34 * MM


def material(name, color, roughness=0.75):
    existing = bpy.data.materials.get(name)
    mat = existing or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


WOOD = material("finish vitmålad träpanel - lätt struktur", (0.92, 0.92, 0.87, 1), 0.86)
WOOD_GROOVE = material("finish skuggspår i träpanel", (0.42, 0.42, 0.39, 1), 0.9)
STONE = material("finish mörk stenmur", (0.08, 0.09, 0.09, 1), 0.92)
STONE_JOINT = material("finish ljusare stenfog", (0.34, 0.34, 0.31, 1), 0.9)
ROOF = material("finish mörkt tak", (0.02, 0.025, 0.025, 1), 0.8)
FLOOR = material("finish körbar grusyta", (0.48, 0.47, 0.42, 1), 0.95)
STAIR = material("finish grå stentrappa", (0.42, 0.42, 0.38, 1), 0.9)


def cube(name, location, dimensions, mat):
    dx, dy, dz = (dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2)
    vertices = [
        (-dx, -dy, -dz),
        (dx, -dy, -dz),
        (dx, dy, -dz),
        (-dx, dy, -dz),
        (-dx, -dy, dz),
        (dx, -dy, dz),
        (dx, dy, dz),
        (-dx, dy, dz),
    ]
    faces = [
        (0, 1, 2, 3),
        (4, 7, 6, 5),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (3, 7, 4, 0),
    ]
    mesh = bpy.data.meshes.new(name + "-mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    return obj


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def remove_previous_finish():
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        lower = obj.name.lower()
        if obj.name.startswith(PREFIX) or "panelspår" in lower or "groove" in lower:
            bpy.data.objects.remove(obj, do_unlink=True)


def classify_materials():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        if "tak" in name or "roof" in name:
            set_material(obj, ROOF)
        elif "mur" in name or "foundation" in name:
            set_material(obj, STONE)
        elif "stenfog" in name:
            set_material(obj, STONE_JOINT)
        elif "trappa" in name or "steps" in name:
            set_material(obj, STAIR)
        elif "grus" in name or "golv" in name or "markplatta" in name or "floor" in name:
            set_material(obj, FLOOR)
        elif "kamera" not in name:
            set_material(obj, WOOD)


def panel_objects():
    panels = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        if any(key in name for key in ("träpanel", "panel", "trävägg", "wood-wall")):
            if obj.dimensions.z > 0.6 and max(obj.dimensions.x, obj.dimensions.y) > 0.25:
                panels.append(obj)
    return panels


def face_axis(obj):
    return "y" if obj.dimensions.x >= obj.dimensions.y else "x"


def exterior_sign(obj, axis):
    if axis == "y":
        return 1 if obj.location.y > 3.0 else -1
    return 1 if obj.location.x > 3.8 else -1


def add_horizontal_cladding_bars(obj):
    axis = face_axis(obj)
    z_bottom = obj.location.z - obj.dimensions.z / 2
    length_axis = obj.dimensions.x if axis == "y" else obj.dimensions.y
    count = int(obj.dimensions.z / CLADDING_SPACING)
    if count <= 1:
        return

    for i in range(1, count):
        z = z_bottom + i * CLADDING_SPACING
        if axis == "y":
            dim = (length_axis, GROOVE_THICKNESS, GROOVE_THICKNESS)
            for sign, side in ((-1, "fram"), (1, "bak")):
                loc = (obj.location.x, obj.location.y + sign * (obj.dimensions.y / 2 + GROOVE_PROJECTION), z)
                cube(f"{PREFIX}{obj.name}-horisontell-panel-list-{side}-{i:02d}", loc, dim, WOOD_GROOVE)
        else:
            dim = (GROOVE_THICKNESS, length_axis, GROOVE_THICKNESS)
            for sign, side in ((-1, "vänster"), (1, "höger")):
                loc = (obj.location.x + sign * (obj.dimensions.x / 2 + GROOVE_PROJECTION), obj.location.y, z)
                cube(f"{PREFIX}{obj.name}-horisontell-panel-list-{side}-{i:02d}", loc, dim, WOOD_GROOVE)


def add_vertical_trim_bars(obj):
    axis = face_axis(obj)
    sign = exterior_sign(obj, axis)
    z = obj.location.z
    h = obj.dimensions.z
    if axis == "y":
        y = obj.location.y + sign * (obj.dimensions.y / 2 + TRIM_DEPTH / 2)
        x0 = obj.location.x - obj.dimensions.x / 2
        x1 = obj.location.x + obj.dimensions.x / 2
        for suffix, x in (("vänster", x0), ("höger", x1)):
            cube(f"{PREFIX}{obj.name}-vertikal-täcklist-{suffix}", (x, y, z), (TRIM_WIDTH, TRIM_DEPTH, h), WOOD)
    else:
        x = obj.location.x + sign * (obj.dimensions.x / 2 + TRIM_DEPTH / 2)
        y0 = obj.location.y - obj.dimensions.y / 2
        y1 = obj.location.y + obj.dimensions.y / 2
        for suffix, y in (("yttre", y0), ("inre", y1)):
            cube(f"{PREFIX}{obj.name}-vertikal-täcklist-{suffix}", (x, y, z), (TRIM_DEPTH, TRIM_WIDTH, h), WOOD)


def add_stone_joints():
    walls = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and ("mur" in obj.name.lower() or "foundation" in obj.name.lower())
    ]
    for wall in walls:
        if wall.dimensions.x >= wall.dimensions.y:
            face_y = wall.location.y + (1 if wall.location.y > 3.0 else -1) * (wall.dimensions.y / 2 + 0.012)
            cube(f"{PREFIX}{wall.name}-murkrön", (wall.location.x, face_y, wall.location.z + wall.dimensions.z / 2 + 0.025), (wall.dimensions.x, 0.036, 0.050), STONE_JOINT)
            rows = max(2, int(wall.dimensions.z / (220 * MM)))
            for row in range(1, rows):
                z = wall.location.z - wall.dimensions.z / 2 + row * wall.dimensions.z / rows
                cube(f"{PREFIX}{wall.name}-horisontell-stenfog-{row}", (wall.location.x, face_y, z), (wall.dimensions.x, 0.010, 0.010), STONE_JOINT)
        else:
            face_x = wall.location.x + (1 if wall.location.x > 3.8 else -1) * (wall.dimensions.x / 2 + 0.012)
            cube(f"{PREFIX}{wall.name}-murkrön", (face_x, wall.location.y, wall.location.z + wall.dimensions.z / 2 + 0.025), (0.036, wall.dimensions.y, 0.050), STONE_JOINT)


def add_finish_details():
    panels = panel_objects()
    print(f"finish: panels={len(panels)}", flush=True)
    for obj in panels:
        print(f"finish: panel {obj.name} dims={tuple(round(v, 3) for v in obj.dimensions)}", flush=True)
        add_horizontal_cladding_bars(obj)
        add_vertical_trim_bars(obj)
    print("finish: stone joints", flush=True)
    add_stone_joints()


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender source.blend --background --python apply_carport_finish_details.py -- output.blend")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    print("finish: remove previous", flush=True)
    remove_previous_finish()
    print("finish: classify materials", flush=True)
    classify_materials()
    print("finish: add details", flush=True)
    add_finish_details()
    print("finish: save", flush=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print("finish: done", flush=True)


if __name__ == "__main__":
    main()
