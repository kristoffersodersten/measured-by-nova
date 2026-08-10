import math
import shutil
import sys
from datetime import datetime
from pathlib import Path

import bpy


MM = 0.001
REAR_PREFIX = "rear-photo-layout-"
FRONT_PREFIX = "front-open-layout-"


def mat(name, color):
    existing = bpy.data.materials.get(name)
    if existing:
        existing.diffuse_color = color
        return existing
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    return material


WOOD = mat("white-painted-horizontal-wood", (0.93, 0.93, 0.89, 1))
WOOD_SHADOW = mat("wood-panel-groove-shadow", (0.50, 0.50, 0.47, 1))
STONE = mat("dark-stone-foundation", (0.10, 0.11, 0.12, 1))
STONE_JOINT = mat("stone-masonry-joint", (0.36, 0.36, 0.34, 1))


def cube(name, location, dimensions, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def remove_generated_rear_layout():
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith(REAR_PREFIX) or obj.name.startswith(FRONT_PREFIX):
            bpy.data.objects.remove(obj, do_unlink=True)


def remove_conflicting_panels():
    remove_names = (
        "front-left-wood-panel",
        "front-right-wood-panel",
        "rear-center-wood-panel",
    )
    for obj in list(bpy.context.scene.objects):
        if any(obj.name.startswith(name) for name in remove_names):
            bpy.data.objects.remove(obj, do_unlink=True)


def roof_under_z_at_x(x):
    roof = bpy.data.objects.get("roof")
    if roof is None:
        return 3.05
    world_vertices = [roof.matrix_world @ vertex.co for vertex in roof.data.vertices]
    min_x = min(vertex.x for vertex in world_vertices)
    max_x = max(vertex.x for vertex in world_vertices)
    top_left = max(vertex.z for vertex in world_vertices if abs(vertex.x - min_x) < 0.001)
    top_right = max(vertex.z for vertex in world_vertices if abs(vertex.x - max_x) < 0.001)
    thickness = roof.dimensions.z
    t = 0 if max_x == min_x else (x - min_x) / (max_x - min_x)
    return top_left + (top_right - top_left) * t - thickness


def add_cladding(name, x_center, y_face, z_center, width, height):
    groove_count = max(1, int(height / (145 * MM)))
    for i in range(1, groove_count):
        z = z_center - height / 2 + i * 145 * MM
        cube(f"{name}-groove-{i}", (x_center, y_face + 0.019, z), (width, 0.012, 0.012), WOOD_SHADOW)


def add_horizontal_cladding_on_face(prefix, x_center, y_face, z_base, width, height):
    cube(f"{prefix}-wood-face", (x_center, y_face, z_base + height / 2), (width, 0.055, height), WOOD)
    add_cladding(prefix, x_center, y_face, z_base + height / 2, width, height)


def add_masonry_joints(wall, rear_face_y):
    x, _y, z = wall.location
    dx, _dy, dz = wall.dimensions
    cube(f"{REAR_PREFIX}stone-cap", (x, rear_face_y, z + dz / 2 + 0.025), (dx, 0.050, 0.050), STONE_JOINT)
    cube(f"{REAR_PREFIX}stone-horizontal-joint", (x, rear_face_y + 0.004, z), (dx, 0.012, 0.014), STONE_JOINT)
    for i in range(1, 14):
        joint_x = x - dx / 2 + i * (dx / 14)
        cube(f"{REAR_PREFIX}stone-vertical-joint-{i}", (joint_x, rear_face_y + 0.004, z), (0.012, 0.012, dz), STONE_JOINT)


def apply_rear_layout():
    rear_wall = bpy.data.objects.get("foundation-rear")
    if rear_wall is None:
        raise RuntimeError("Missing foundation-rear")

    wall_x, wall_y, wall_z = rear_wall.location
    wall_w, wall_d, wall_h = rear_wall.dimensions
    facade_left = wall_x - wall_w / 2
    facade_right = wall_x + wall_w / 2
    rear_face_y = wall_y + wall_d / 2 + 0.018
    top_of_wall = wall_z + wall_h / 2
    roof_bottom = min(roof_under_z_at_x(facade_left), roof_under_z_at_x(facade_right))

    # Northeast facade from photo: wood wall to roof on the left, one large opening on the right.
    opening_start = facade_left + wall_w * 0.68
    wood_start = facade_left + 145 * MM
    wood_end = opening_start

    full_wall_x = (wood_start + wood_end) / 2
    full_wall_w = wood_end - wood_start
    full_wall_h = max(0.1, roof_bottom - top_of_wall)
    full_wall_z = top_of_wall + full_wall_h / 2
    cube(f"{REAR_PREFIX}full-height-wood-wall-to-roof", (full_wall_x, rear_face_y, full_wall_z), (full_wall_w, 0.055, full_wall_h), WOOD)
    add_cladding(f"{REAR_PREFIX}full-height-wood-wall-to-roof", full_wall_x, rear_face_y, full_wall_z, full_wall_w, full_wall_h)

    post_h = roof_bottom
    cube(f"{REAR_PREFIX}left-corner-post-to-roof", (facade_left + 55 * MM, rear_face_y + 0.012, post_h / 2), (110 * MM, 0.090, post_h), WOOD)
    cube(f"{REAR_PREFIX}large-opening-left-post-to-roof", (opening_start, rear_face_y + 0.012, post_h / 2), (110 * MM, 0.090, post_h), WOOD)
    cube(f"{REAR_PREFIX}large-opening-right-post-to-roof", (facade_right - 55 * MM, rear_face_y + 0.012, post_h / 2), (110 * MM, 0.090, post_h), WOOD)
    cube(f"{REAR_PREFIX}missing-inner-opening-post-to-roof", (opening_start + 0.72, rear_face_y + 0.012, post_h / 2), (95 * MM, 0.080, post_h), WOOD)
    cube(f"{REAR_PREFIX}large-opening-header", ((opening_start + facade_right) / 2, rear_face_y + 0.014, roof_bottom - 45 * MM), (facade_right - opening_start, 0.080, 90 * MM), WOOD)
    cube(f"{REAR_PREFIX}large-opening-threshold", ((opening_start + facade_right) / 2, rear_face_y + 0.010, top_of_wall + 25 * MM), (facade_right - opening_start, 0.060, 50 * MM), STONE_JOINT)

    # Make the rear masonry read as one continuous wall behind the layout.
    rear_wall.data.materials.clear()
    rear_wall.data.materials.append(STONE)
    add_masonry_joints(rear_wall, rear_face_y)


def add_open_front_drive_floor():
    front_wall = bpy.data.objects.get("foundation-southwest")
    rear_wall = bpy.data.objects.get("foundation-rear")
    if front_wall is None or rear_wall is None:
        return
    width = front_wall.dimensions.x
    x = front_wall.location.x
    front_y = front_wall.location.y + front_wall.dimensions.y / 2
    rear_y = rear_wall.location.y - rear_wall.dimensions.y / 2
    floor_depth = max(0.1, rear_y - front_y)
    floor_y = front_y + floor_depth / 2
    floor_z = max(front_wall.location.z + front_wall.dimensions.z / 2, rear_wall.location.z + rear_wall.dimensions.z / 2) + 0.018
    gravel = mat("drive-in-gravel-floor", (0.52, 0.52, 0.48, 1))
    cube(f"{FRONT_PREFIX}open-drive-in-gravel-floor", (x, floor_y, floor_z), (width - 0.32, floor_depth, 0.035), gravel)
    cube(f"{FRONT_PREFIX}front-threshold-edge", (x, front_y - 0.025, floor_z + 0.020), (width - 0.32, 0.050, 0.040), STONE_JOINT)


def add_southwest_photo_facade():
    front_wall = bpy.data.objects.get("foundation-southwest")
    if front_wall is None:
        return
    wall_x, wall_y, wall_z = front_wall.location
    wall_w, wall_d, wall_h = front_wall.dimensions
    facade_left = wall_x - wall_w / 2
    facade_right = wall_x + wall_w / 2
    front_face_y = wall_y - wall_d / 2 - 0.018
    top_of_wall = wall_z + wall_h / 2
    roof_bottom_left = roof_under_z_at_x(facade_left)
    roof_bottom_right = roof_under_z_at_x(facade_right)
    roof_bottom_mid = min(roof_bottom_left, roof_bottom_right)

    # From southwest photo: low wood panels left/right, open center, two posts up to roof.
    left_panel_start = facade_left + 145 * MM
    left_panel_end = facade_left + wall_w * 0.38
    right_panel_start = facade_left + wall_w * 0.60
    right_panel_end = facade_right - 145 * MM
    low_panel_h = 1320 * MM
    add_horizontal_cladding_on_face(FRONT_PREFIX + "southwest-left-low-panel", (left_panel_start + left_panel_end) / 2, front_face_y, top_of_wall, left_panel_end - left_panel_start, low_panel_h)
    add_horizontal_cladding_on_face(FRONT_PREFIX + "southwest-right-low-panel", (right_panel_start + right_panel_end) / 2, front_face_y, top_of_wall, right_panel_end - right_panel_start, low_panel_h)

    post_h = roof_bottom_mid
    for name, x in (
        ("left-corner-post", facade_left + 55 * MM),
        ("left-opening-post", left_panel_end),
        ("right-opening-post", right_panel_start),
        ("right-corner-post", facade_right - 55 * MM),
    ):
        cube(f"{FRONT_PREFIX}southwest-{name}-to-roof", (x, front_face_y - 0.012, post_h / 2), (110 * MM, 0.090, post_h), WOOD)

    # Continuous fascia/header and visible underside beam lines.
    cube(f"{FRONT_PREFIX}southwest-open-center-header", ((left_panel_end + right_panel_start) / 2, front_face_y - 0.014, roof_bottom_mid - 45 * MM), (right_panel_start - left_panel_end, 0.080, 90 * MM), WOOD)
    for i, x in enumerate((facade_left + wall_w * 0.28, facade_left + wall_w * 0.50, facade_left + wall_w * 0.72), start=1):
        cube(f"{FRONT_PREFIX}southwest-under-roof-beam-{i}", (x, front_face_y + 1.35, roof_bottom_mid - 120 * MM), (90 * MM, 2.7, 120 * MM), WOOD)

    # Stair aligned with the opening, not drifting to the panel.
    stair_objs = [obj for obj in bpy.context.scene.objects if obj.name.startswith("steps-")]
    stair_center_x = (left_panel_end + right_panel_start) / 2
    for obj in stair_objs:
        obj.location.x = stair_center_x
        obj.location.y = front_wall.location.y - wall_d / 2 - obj.dimensions.y / 2 - 0.020

    # Masonry joints on the southwest wall face.
    front_wall.data.materials.clear()
    front_wall.data.materials.append(STONE)
    cube(f"{FRONT_PREFIX}southwest-stone-cap", (wall_x, front_face_y, top_of_wall + 0.025), (wall_w, 0.050, 0.050), STONE_JOINT)
    for i in range(1, 14):
        joint_x = facade_left + i * (wall_w / 14)
        cube(f"{FRONT_PREFIX}southwest-stone-vertical-joint-{i}", (joint_x, front_face_y - 0.004, wall_z), (0.012, 0.012, wall_h), STONE_JOINT)
    cube(f"{FRONT_PREFIX}southwest-stone-horizontal-joint", (wall_x, front_face_y - 0.004, wall_z), (wall_w, 0.012, 0.014), STONE_JOINT)


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender source.blend --background --python apply_rear_facade_layout.py -- output.blend")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    source = Path(bpy.data.filepath)
    backup_dir = output.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    if source.exists():
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(source, backup_dir / f"{source.stem}-{timestamp}.blend")

    remove_generated_rear_layout()
    remove_conflicting_panels()
    apply_rear_layout()
    add_open_front_drive_floor()
    add_southwest_photo_facade()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))


if __name__ == "__main__":
    main()
