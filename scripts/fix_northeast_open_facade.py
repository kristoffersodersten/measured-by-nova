import shutil
import sys
from datetime import datetime
from pathlib import Path

import bpy


MM = 0.001
PREFIX = "northeast-open-fix-"


def mat(name, color):
    existing = bpy.data.materials.get(name)
    if existing:
        existing.diffuse_color = color
        return existing
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    return material


WOOD = mat("white-painted-horizontal-wood", (0.93, 0.93, 0.89, 1))
STONE_JOINT = mat("stone-masonry-joint", (0.36, 0.36, 0.34, 1))


def cube(name, location, dimensions, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def roof_under_z_at_x(x):
    roof = bpy.data.objects.get("roof")
    if roof is None:
        return 3.0
    vertices = [roof.matrix_world @ vertex.co for vertex in roof.data.vertices]
    min_x = min(vertex.x for vertex in vertices)
    max_x = max(vertex.x for vertex in vertices)
    top_left = max(vertex.z for vertex in vertices if abs(vertex.x - min_x) < 0.001)
    top_right = max(vertex.z for vertex in vertices if abs(vertex.x - max_x) < 0.001)
    t = 0 if max_x == min_x else (x - min_x) / (max_x - min_x)
    return top_left + (top_right - top_left) * t - roof.dimensions.z


def remove_wrong_northeast_geometry():
    remove_prefixes = (
        "rear-photo-layout-",
        "rear-center-wood-panel",
        "rear-facade-",
        "northeast-open-fix-",
    )
    for obj in list(bpy.context.scene.objects):
        if any(obj.name.startswith(prefix) for prefix in remove_prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)


def add_open_northeast_facade():
    wall = bpy.data.objects.get("foundation-rear")
    if wall is None:
        raise RuntimeError("Missing foundation-rear")

    wall_x, wall_y, wall_z = wall.location
    wall_w, wall_d, wall_h = wall.dimensions
    left = wall_x - wall_w / 2
    right = wall_x + wall_w / 2
    face_y = wall_y + wall_d / 2 + 0.018
    top_wall = wall_z + wall_h / 2

    # Photo-corrected principle: northeast is mostly open; only structural posts/headers are visible.
    opening_left = left + wall_w * 0.18
    opening_right = right - 145 * MM
    roof_z = min(roof_under_z_at_x(opening_left), roof_under_z_at_x(opening_right))
    post_h = roof_z

    for name, x, w in (
        ("left-corner-post", left + 55 * MM, 110 * MM),
        ("opening-left-post", opening_left, 110 * MM),
        ("middle-post", left + wall_w * 0.62, 95 * MM),
        ("right-corner-post", right - 55 * MM, 110 * MM),
    ):
        cube(f"{PREFIX}{name}", (x, face_y, post_h / 2), (w, 0.090, post_h), WOOD)

    cube(f"{PREFIX}large-opening-header", ((opening_left + opening_right) / 2, face_y, roof_z - 45 * MM), (opening_right - opening_left, 0.080, 90 * MM), WOOD)
    cube(f"{PREFIX}stone-cap-threshold", (wall_x, face_y, top_wall + 25 * MM), (wall_w, 0.055, 50 * MM), STONE_JOINT)


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender source.blend --background --python fix_northeast_open_facade.py -- output.blend")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    source = Path(bpy.data.filepath)
    backup_dir = output.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    if source.exists():
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(source, backup_dir / f"{source.stem}-{timestamp}.blend")

    remove_wrong_northeast_geometry()
    add_open_northeast_facade()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))


if __name__ == "__main__":
    main()
