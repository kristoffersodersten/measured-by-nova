import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def scene_bounds():
    verts = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if obj.name.startswith(("Camera", "Kamera", "Verify", "Orbit")):
            continue
        verts.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    if not verts:
        raise RuntimeError("No mesh geometry found")
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return min_v, max_v, (min_v + max_v) / 2


def make_camera(name, location, rotation, ortho_scale):
    cam = bpy.data.objects.get(name)
    if cam is None:
        bpy.ops.object.camera_add(location=location, rotation=rotation)
        cam = bpy.context.object
        cam.name = name
    cam.location = location
    cam.rotation_euler = rotation
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho_scale
    cam.hide_render = False
    bpy.context.scene.camera = cam
    return cam


def prepare_wire_scene():
    scene = bpy.context.scene
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1600
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.color = (1, 1, 1)
    scene.display.shading.type = "WIREFRAME"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (1, 1, 1)
    scene.display.shading.show_xray = False
    scene.display.shading.show_object_outline = False
    scene.display.shading.show_cavity = False
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (1, 1, 1)
    for obj in scene.objects:
        if obj.type == "MESH":
            obj.hide_render = False
            obj.hide_viewport = False
            obj.color = (0, 0, 0, 1)
        elif obj.type in {"LIGHT"}:
            obj.hide_render = True


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python export_blender_native_wire_test.py -- output_dir")
    out_dir = Path(sys.argv[sys.argv.index("--") + 1])
    out_dir.mkdir(parents=True, exist_ok=True)
    prepare_wire_scene()
    min_v, max_v, center = scene_bounds()
    width = max_v.x - min_v.x
    height = max_v.z - min_v.z
    make_camera(
        "CAD_Wire_Southwest",
        (center.x, min_v.y - 12.0, center.z),
        (math.radians(90), 0, 0),
        max(width, height) * 1.12,
    )
    path = out_dir / "southwest_blender_wire_test.png"
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.opengl(write_still=True, view_context=False)
    print(f"BLENDER_NATIVE_WIRE_TEST={path}")


if __name__ == "__main__":
    main()
