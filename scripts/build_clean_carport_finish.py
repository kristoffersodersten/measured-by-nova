import shutil
import sys
from datetime import datetime
from pathlib import Path

import bpy


MM = 0.001
PREFIX = "clean-finish-"


def mat(name, color):
    existing = bpy.data.materials.get(name)
    if existing:
        existing.diffuse_color = color
        return existing
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    return material


WOOD = mat("white-painted-horizontal-wood", (0.93, 0.93, 0.89, 1))
WOOD_SHADOW = mat("wood-panel-groove-shadow", (0.46, 0.46, 0.43, 1))
STONE = mat("dark-stone-foundation", (0.09, 0.10, 0.11, 1))
STONE_JOINT = mat("stone-masonry-joint", (0.36, 0.36, 0.34, 1))
ROOF = mat("dark-roof", (0.03, 0.04, 0.04, 1))
FLOOR = mat("driveable-gravel-floor", (0.50, 0.50, 0.46, 1))
STAIR = mat("grey-stone-stairs", (0.42, 0.42, 0.38, 1))


def cube(name, location, dimensions, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def remove_bad_generated_layers():
    bad_prefixes = (
        "rear-photo-layout-",
        "front-open-layout-",
        "rear-facade-",
        "northeast-open-fix-",
        "clean-finish-",
    )
    bad_contains = (
        "cladding",
        "opening-trim",
    )
    remove_exact_prefixes = (
        "front-left-wood-panel",
        "front-right-wood-panel",
        "rear-center-wood-panel",
        "west-side-wood-panel",
        "east-side-wood-panel",
    )
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        if any(obj.name.startswith(prefix) for prefix in bad_prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if any(obj.name.startswith(prefix) for prefix in remove_exact_prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if any(part in obj.name for part in bad_contains):
            bpy.data.objects.remove(obj, do_unlink=True)


def set_base_materials():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        if obj.name == "roof":
            obj.data.materials.append(ROOF)
        elif obj.name.startswith("foundation"):
            obj.data.materials.append(STONE)
        elif obj.name.startswith("steps"):
            obj.data.materials.append(STAIR)
        else:
            obj.data.materials.append(WOOD)


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


def add_cladding(prefix, x_center, y_face, z_base, width, height):
    cube(f"{prefix}-face", (x_center, y_face, z_base + height / 2), (width, 0.055, height), WOOD)
    count = max(1, int(height / (145 * MM)))
    for i in range(1, count):
        z = z_base + i * 145 * MM
        cube(f"{prefix}-groove-{i}", (x_center, y_face + 0.018, z), (width, 0.012, 0.012), WOOD_SHADOW)


def add_masonry(face_name, wall, outward_sign):
    x, y, z = wall.location
    dx, dy, dz = wall.dimensions
    face_y = y + outward_sign * (dy / 2 + 0.014)
    cube(f"{PREFIX}{face_name}-stone-cap", (x, face_y, z + dz / 2 + 0.025), (dx, 0.050, 0.050), STONE_JOINT)
    cube(f"{PREFIX}{face_name}-stone-horizontal-joint", (x, face_y, z), (dx, 0.012, 0.014), STONE_JOINT)
    for i in range(1, 14):
        joint_x = x - dx / 2 + i * dx / 14
        cube(f"{PREFIX}{face_name}-stone-vertical-joint-{i}", (joint_x, face_y, z), (0.012, 0.012, dz), STONE_JOINT)


def add_driveable_floor():
    front = bpy.data.objects["foundation-southwest"]
    rear = bpy.data.objects["foundation-rear"]
    x = front.location.x
    width = front.dimensions.x - 0.32
    y0 = front.location.y + front.dimensions.y / 2
    y1 = rear.location.y - rear.dimensions.y / 2
    z = max(front.location.z + front.dimensions.z / 2, rear.location.z + rear.dimensions.z / 2) + 0.018
    cube(f"{PREFIX}driveable-gravel-floor", (x, (y0 + y1) / 2, z), (width, y1 - y0, 0.035), FLOOR)


def add_southwest_facade():
    wall = bpy.data.objects["foundation-southwest"]
    left = wall.location.x - wall.dimensions.x / 2
    right = wall.location.x + wall.dimensions.x / 2
    width = wall.dimensions.x
    y = wall.location.y - wall.dimensions.y / 2 - 0.020
    top_wall = wall.location.z + wall.dimensions.z / 2
    roof_z = min(roof_under_z_at_x(left), roof_under_z_at_x(right))

    # Southwest/front: open centre for cars, low wood panels at both sides.
    open_left = left + width * 0.38
    open_right = left + width * 0.60
    low_h = 1.32
    add_cladding(f"{PREFIX}southwest-left-low-panel", (left + 0.145 + open_left) / 2, y, top_wall, open_left - left - 0.145, low_h)
    add_cladding(f"{PREFIX}southwest-right-low-panel", (open_right + right - 0.145) / 2, y, top_wall, right - 0.145 - open_right, low_h)

    post_h = roof_z
    for name, x, w in (
        ("left-corner-post", left + 0.055, 0.110),
        ("left-opening-post", open_left, 0.110),
        ("right-opening-post", open_right, 0.110),
        ("right-corner-post", right - 0.055, 0.110),
    ):
        cube(f"{PREFIX}southwest-{name}", (x, y - 0.012, post_h / 2), (w, 0.090, post_h), WOOD)
    cube(f"{PREFIX}southwest-opening-header", ((open_left + open_right) / 2, y - 0.014, roof_z - 0.045), (open_right - open_left, 0.080, 0.090), WOOD)

    # Move stair to the opening.
    stair_center = (open_left + open_right) / 2
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.name.startswith("steps-"):
            obj.location.x = stair_center
            obj.location.y = wall.location.y - wall.dimensions.y / 2 - obj.dimensions.y / 2 - 0.020

    add_masonry("southwest", wall, -1)


def add_northeast_facade():
    wall = bpy.data.objects["foundation-rear"]
    left = wall.location.x - wall.dimensions.x / 2
    right = wall.location.x + wall.dimensions.x / 2
    width = wall.dimensions.x
    y = wall.location.y + wall.dimensions.y / 2 + 0.020
    top_wall = wall.location.z + wall.dimensions.z / 2
    roof_z = min(roof_under_z_at_x(left), roof_under_z_at_x(right))

    # Northeast: one large opening, wood section goes to roof.
    wood_end = left + width * 0.58
    opening_start = wood_end
    add_cladding(f"{PREFIX}northeast-full-height-wood", (left + 0.145 + wood_end) / 2, y, top_wall, wood_end - left - 0.145, roof_z - top_wall)

    for name, x, w in (
        ("left-corner-post", left + 0.055, 0.110),
        ("opening-left-post", opening_start, 0.110),
        ("opening-middle-post", opening_start + (right - opening_start) * 0.52, 0.095),
        ("right-corner-post", right - 0.055, 0.110),
    ):
        cube(f"{PREFIX}northeast-{name}", (x, y + 0.012, roof_z / 2), (w, 0.090, roof_z), WOOD)
    cube(f"{PREFIX}northeast-opening-header", ((opening_start + right) / 2, y + 0.014, roof_z - 0.045), (right - opening_start, 0.080, 0.090), WOOD)
    cube(f"{PREFIX}northeast-opening-threshold", ((opening_start + right) / 2, y + 0.010, top_wall + 0.025), (right - opening_start, 0.060, 0.050), STONE_JOINT)
    add_masonry("northeast", wall, 1)


def connect_floating_frame_members():
    roof_z_mid = roof_under_z_at_x(3.8)
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if obj.name.startswith(("p", "clean-finish-southwest", "clean-finish-northeast")) and "post" in obj.name:
            obj.dimensions.z = roof_z_mid


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender source.blend --background --python build_clean_carport_finish.py -- output.blend")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    source = Path(bpy.data.filepath)
    backup_dir = output.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    if source.exists():
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(source, backup_dir / f"{source.stem}-{timestamp}.blend")

    remove_bad_generated_layers()
    set_base_materials()
    add_driveable_floor()
    add_southwest_facade()
    add_northeast_facade()
    connect_floating_frame_members()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))


if __name__ == "__main__":
    main()
