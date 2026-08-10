import sys
from pathlib import Path
import bpy

MM = 0.001
PREFIX = "finish-detail-"
FIX_PREFIX = "finish-plane-correct-"
CLADDING_SPACING = 145 * MM
LINE_THICK = 10 * MM
LINE_OFFSET = 8 * MM


def mat(name, color):
    existing = bpy.data.materials.get(name)
    if existing:
        existing.diffuse_color = color
        return existing
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    return m

WOOD_GROOVE = mat("plane-correct panel shadow lines", (0.36, 0.36, 0.33, 1))
WOOD_TRIM = mat("plane-correct white trim", (0.92, 0.92, 0.88, 1))


def cube(name, loc, dim, material):
    x, y, z = loc
    dx, dy, dz = dim[0] / 2, dim[1] / 2, dim[2] / 2
    verts = [
        (-dx, -dy, -dz), (dx, -dy, -dz), (dx, dy, -dz), (-dx, dy, -dz),
        (-dx, -dy, dz), (dx, -dy, dz), (dx, dy, dz), (-dx, dy, dz),
    ]
    faces = [(0,1,2,3), (4,7,6,5), (0,4,5,1), (1,5,6,2), (2,6,7,3), (3,7,4,0)]
    mesh = bpy.data.meshes.new(name + "-mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


def remove_old_decoration():
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        lower = obj.name.lower()
        if obj.name.startswith(PREFIX) or obj.name.startswith(FIX_PREFIX) or "panelspår" in lower:
            bpy.data.objects.remove(obj, do_unlink=True)


def panel_targets():
    targets = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        lower = obj.name.lower()
        if "panelspår" in lower or obj.name.startswith((PREFIX, FIX_PREFIX)):
            continue
        if not any(k in lower for k in ("träpanel", "trävägg", "panel")):
            continue
        if obj.dimensions.z < 0.5:
            continue
        targets.append(obj)
    return targets


def add_lines_on_y_face(obj, sign, tag):
    # Main facade plane is X/Z, line direction must be X.
    z0 = obj.location.z - obj.dimensions.z / 2
    y = obj.location.y + sign * (obj.dimensions.y / 2 + LINE_OFFSET)
    x = obj.location.x
    length = obj.dimensions.x
    count = int(obj.dimensions.z / CLADDING_SPACING)
    for i in range(1, count):
        z = z0 + i * CLADDING_SPACING
        cube(f"{FIX_PREFIX}{obj.name}-{tag}-x-line-{i:02d}", (x, y, z), (length, LINE_THICK, LINE_THICK), WOOD_GROOVE)


def add_lines_on_x_face(obj, sign, tag):
    # Main facade plane is Y/Z, line direction must be Y.
    z0 = obj.location.z - obj.dimensions.z / 2
    x = obj.location.x + sign * (obj.dimensions.x / 2 + LINE_OFFSET)
    y = obj.location.y
    length = obj.dimensions.y
    count = int(obj.dimensions.z / CLADDING_SPACING)
    for i in range(1, count):
        z = z0 + i * CLADDING_SPACING
        cube(f"{FIX_PREFIX}{obj.name}-{tag}-y-line-{i:02d}", (x, y, z), (LINE_THICK, length, LINE_THICK), WOOD_GROOVE)


def add_edge_trim(obj):
    if obj.dimensions.x >= obj.dimensions.y:
        # X-running facade: vertical trims at left/right, on exterior/readable face only.
        sign = -1 if obj.location.y < 3.0 else 1
        y = obj.location.y + sign * (obj.dimensions.y / 2 + 18 * MM)
        z = obj.location.z
        for suffix, x in (("left", obj.location.x - obj.dimensions.x / 2), ("right", obj.location.x + obj.dimensions.x / 2)):
            cube(f"{FIX_PREFIX}{obj.name}-vertical-trim-{suffix}", (x, y, z), (65 * MM, 28 * MM, obj.dimensions.z), WOOD_TRIM)
    else:
        sign = 1 if obj.location.x > 3.8 else -1
        x = obj.location.x + sign * (obj.dimensions.x / 2 + 18 * MM)
        z = obj.location.z
        for suffix, y in (("outer", obj.location.y - obj.dimensions.y / 2), ("inner", obj.location.y + obj.dimensions.y / 2)):
            cube(f"{FIX_PREFIX}{obj.name}-vertical-trim-{suffix}", (x, y, z), (28 * MM, 65 * MM, obj.dimensions.z), WOOD_TRIM)


def add_corrected_decoration():
    for obj in panel_targets():
        lower = obj.name.lower()
        if obj.dimensions.x >= obj.dimensions.y:
            # Front/back facades. Put lines only on the exterior face, not on both sides.
            sign = -1 if obj.location.y < 3.0 else 1
            add_lines_on_y_face(obj, sign, "exterior")
        else:
            # Side facades. Put lines only on the exterior side face, running along Y.
            sign = 1 if obj.location.x > 3.8 else -1
            add_lines_on_x_face(obj, sign, "exterior")
        add_edge_trim(obj)


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender source.blend --background --python fix_panel_decoration_planes.py -- output.blend")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    remove_old_decoration()
    add_corrected_decoration()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))


if __name__ == "__main__":
    main()
