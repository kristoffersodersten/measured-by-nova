import math
import sys
from pathlib import Path

import bpy


MM = 0.001


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
ROOF = mat("dark-roof-fascia", (0.03, 0.04, 0.04, 1))
STAIR = mat("grey-stone-stairs", (0.42, 0.42, 0.38, 1))
GENERATED_PREFIXES = (
    "rear-facade-",
    "front-facade-",
    "opening-trim-",
    "generated-",
)


def cube(name, location, dimensions, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def cleanup_generated_details():
    for obj in list(bpy.context.scene.objects):
        if any(obj.name.startswith(prefix) for prefix in GENERATED_PREFIXES):
            bpy.data.objects.remove(obj, do_unlink=True)


def set_materials():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        if obj.name.startswith("foundation"):
            obj.data.materials.append(STONE)
        elif obj.name.startswith("steps"):
            obj.data.materials.append(STAIR)
        elif obj.name == "roof":
            obj.data.materials.append(ROOF)
        elif "wood-panel" in obj.name or obj.name.startswith(("p", "north-beam", "south-beam")):
            obj.data.materials.append(WOOD)


def add_wood_cladding(obj, spacing=145 * MM):
    x, y, z = obj.location
    dx, dy, dz = obj.dimensions
    if dz <= spacing:
        return
    front_axis = "y" if dy <= dx else "x"
    line_count = int(dz / spacing)
    for i in range(1, line_count):
        line_z = z - dz / 2 + i * spacing
        if front_axis == "y":
            cube(
                f"{obj.name}-cladding-{i}",
                (x, y - dy / 2 - 0.003, line_z),
                (dx, 0.006, 0.010),
                WOOD_SHADOW,
            )
            cube(
                f"{obj.name}-cladding-back-{i}",
                (x, y + dy / 2 + 0.003, line_z),
                (dx, 0.006, 0.010),
                WOOD_SHADOW,
            )
        else:
            cube(
                f"{obj.name}-cladding-{i}",
                (x - dx / 2 - 0.003, y, line_z),
                (0.006, dy, 0.010),
                WOOD_SHADOW,
            )
            cube(
                f"{obj.name}-cladding-back-{i}",
                (x + dx / 2 + 0.003, y, line_z),
                (0.006, dy, 0.010),
                WOOD_SHADOW,
            )


def add_foundation_joints(obj, block_w=560 * MM):
    x, y, z = obj.location
    dx, dy, dz = obj.dimensions
    if obj.name in {"foundation-southwest", "foundation-rear"}:
        face_y = y - dy / 2 - 0.004 if obj.name == "foundation-southwest" else y + dy / 2 + 0.004
        cube(f"{obj.name}-horizontal-joint", (x, face_y, z), (dx, 0.008, 0.010), STONE_JOINT)
        count = max(1, int(dx / block_w))
        start = x - dx / 2
        for i in range(1, count):
            joint_x = start + i * block_w
            cube(f"{obj.name}-vertical-joint-{i}", (joint_x, face_y, z), (0.010, 0.008, dz), STONE_JOINT)
    elif obj.name in {"foundation-west-side", "foundation-northeast"}:
        face_x = x - dx / 2 - 0.004 if obj.name == "foundation-west-side" else x + dx / 2 + 0.004
        cube(f"{obj.name}-horizontal-joint", (face_x, y, z), (0.008, dy, 0.010), STONE_JOINT)
        count = max(1, int(dy / block_w))
        start = y - dy / 2
        for i in range(1, count):
            joint_y = start + i * block_w
            cube(f"{obj.name}-vertical-joint-{i}", (face_x, joint_y, z), (0.008, 0.010, dz), STONE_JOINT)


def add_opening_edge_posts():
    wood_panels = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and "wood-panel" in obj.name]
    for panel in wood_panels:
        x, y, z = panel.location
        dx, dy, dz = panel.dimensions
        post_w = 45 * MM
        if dy <= dx:
            face_y = y - dy / 2 - 0.012 if "front" in panel.name else y + dy / 2 + 0.012
            cube(f"{panel.name}-left-opening-trim", (x - dx / 2, face_y, z + dz / 2), (post_w, 0.035, dz), WOOD)
            cube(f"{panel.name}-right-opening-trim", (x + dx / 2, face_y, z + dz / 2), (post_w, 0.035, dz), WOOD)
        else:
            face_x = x - dx / 2 - 0.012 if "west" in panel.name else x + dx / 2 + 0.012
            cube(f"{panel.name}-front-opening-trim", (face_x, y - dy / 2, z + dz / 2), (0.035, post_w, dz), WOOD)
            cube(f"{panel.name}-rear-opening-trim", (face_x, y + dy / 2, z + dz / 2), (0.035, post_w, dz), WOOD)


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


def add_rear_facade_finish():
    rear_wall = bpy.data.objects.get("foundation-rear")
    rear_panel = bpy.data.objects.get("rear-center-wood-panel")
    if rear_wall is None or rear_panel is None:
        return

    wall_x, wall_y, wall_z = rear_wall.location
    wall_w, wall_d, wall_h = rear_wall.dimensions
    rear_face_y = wall_y + wall_d / 2 + 0.010
    top_of_wall = wall_z + wall_h / 2

    panel_x, panel_y, panel_z = rear_panel.location
    panel_w, _panel_d, panel_h = rear_panel.dimensions
    panel_left = panel_x - panel_w / 2
    panel_right = panel_x + panel_w / 2
    facade_left = wall_x - wall_w / 2
    facade_right = wall_x + wall_w / 2
    rear_y = panel_y + rear_panel.dimensions.y / 2 + 0.018
    under_roof_left = roof_under_z_at_x(facade_left)
    under_roof_right = roof_under_z_at_x(facade_right)
    under_roof_mid = min(under_roof_left, under_roof_right)

    # Stone cap and wall joints make the rear foundation read as real masonry.
    cube("rear-facade-stone-cap", (wall_x, rear_face_y, top_of_wall + 0.025), (wall_w, 0.050, 0.050), STONE_JOINT)
    for i in range(1, 14):
        joint_x = facade_left + i * (wall_w / 14)
        cube(f"rear-facade-stone-vertical-joint-{i}", (joint_x, rear_face_y + 0.004, wall_z), (0.012, 0.012, wall_h), STONE_JOINT)
    cube("rear-facade-stone-horizontal-joint", (wall_x, rear_face_y + 0.004, wall_z), (wall_w, 0.012, 0.014), STONE_JOINT)

    # Central wood face, explicit because this side is the user's current focus.
    cube("rear-facade-center-wood-face", (panel_x, rear_y, panel_z), (panel_w, 0.032, panel_h), WOOD)
    groove_count = int(panel_h / (145 * MM))
    for i in range(1, groove_count):
        z = panel_z - panel_h / 2 + i * 145 * MM
        cube(f"rear-facade-center-cladding-groove-{i}", (panel_x, rear_y + 0.018, z), (panel_w, 0.012, 0.012), WOOD_SHADOW)

    trim_w = 70 * MM
    trim_h = under_roof_mid
    for name, x in (
        ("left-corner", facade_left + trim_w / 2),
        ("left-opening", panel_left),
        ("right-opening", panel_right),
        ("right-corner", facade_right - trim_w / 2),
    ):
        cube(f"rear-facade-{name}-vertical-trim", (x, rear_y + 0.035, trim_h / 2), (trim_w, 0.070, trim_h), WOOD)

    # Header rail ties openings to the roof/fascia so the roof does not read as floating.
    header_z = under_roof_mid - 80 * MM
    cube("rear-facade-left-opening-header", ((facade_left + panel_left) / 2, rear_y + 0.035, header_z), (panel_left - facade_left, 0.070, 90 * MM), WOOD)
    cube("rear-facade-right-opening-header", ((panel_right + facade_right) / 2, rear_y + 0.035, header_z), (facade_right - panel_right, 0.070, 90 * MM), WOOD)
    cube("rear-facade-full-fascia-face", (wall_x, rear_y + 0.055, under_roof_mid + 80 * MM), (wall_w, 0.080, 160 * MM), WOOD)

    # Low-confidence opening markers as thin floor/threshold edges, not filled walls.
    cube("rear-facade-left-opening-threshold", ((facade_left + panel_left) / 2, rear_y + 0.040, top_of_wall + 0.025), (panel_left - facade_left, 0.055, 0.050), STONE_JOINT)
    cube("rear-facade-right-opening-threshold", ((panel_right + facade_right) / 2, rear_y + 0.040, top_of_wall + 0.025), (facade_right - panel_right, 0.055, 0.050), STONE_JOINT)


def add_context_planes():
    gravel = mat("approx-gravel-context", (0.46, 0.46, 0.42, 1))
    road = mat("approx-road-context", (0.22, 0.22, 0.22, 1))
    cube("approx-gravel-surface-low-confidence", (3.8, 3.2, -0.704), (8.8, 7.4, 0.018), gravel)
    cube("approx-road-edge-low-confidence", (3.8, -2.35, -0.705), (8.8, 1.2, 0.020), road)


def add_axis_cameras():
    span = 9.2
    cameras = {
        "View_Southwest_Front": ((3.8, -10.5, 1.45), (math.radians(90), 0, 0)),
        "View_Northeast_Rear": ((3.8, 16.5, 1.45), (math.radians(90), 0, math.radians(180))),
        "View_West": ((-8.5, 3.1, 1.45), (math.radians(90), 0, math.radians(-90))),
        "View_East": ((16.2, 3.1, 1.45), (math.radians(90), 0, math.radians(90))),
        "View_Plan": ((3.8, 3.1, 12.0), (0, 0, 0)),
    }
    for name, (location, rotation) in cameras.items():
        cam = bpy.data.objects.get(name)
        if cam is None:
            bpy.ops.object.camera_add()
            cam = bpy.context.object
            cam.name = name
        cam.location = location
        cam.rotation_euler = rotation
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = span


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender input.blend --background --python refine_carport_ground_truth.py -- output.blend")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    cleanup_generated_details()
    set_materials()
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and "wood-panel" in obj.name:
            add_wood_cladding(obj)
        if obj.type == "MESH" and obj.name.startswith("foundation"):
            add_foundation_joints(obj)
    add_opening_edge_posts()
    add_rear_facade_finish()
    add_context_planes()
    add_axis_cameras()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))


if __name__ == "__main__":
    main()
