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
        if obj.hide_get():
            continue
        verts.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    if not verts:
        raise RuntimeError("No mesh geometry found")
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return min_v, max_v, (min_v + max_v) / 2


def make_white_surface_material():
    mat = bpy.data.materials.get("CAD_Surface_White") or bpy.data.materials.new("CAD_Surface_White")
    mat.diffuse_color = (1, 1, 1, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new(type="ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1, 1, 1, 1)
    emission.inputs["Strength"].default_value = 1.0
    output = nodes.new(type="ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def prepare_scene():
    white = make_white_surface_material()
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_render = False
            obj.data.materials.clear()
            obj.data.materials.append(white)
        elif obj.type in {"LIGHT", "CAMERA"}:
            obj.hide_render = True

    scene = bpy.context.scene
    # EEVEE name changed in newer Blender builds; try the current one first.
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1600
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.color = (1, 1, 1)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    layer = bpy.context.view_layer
    layer.use_freestyle = True
    freestyle = scene.view_layers[0].freestyle_settings
    for lineset in list(freestyle.linesets):
        freestyle.linesets.remove(lineset)
    lineset = freestyle.linesets.new("CAD visible geometry")
    lineset.select_silhouette = True
    lineset.select_border = True
    lineset.select_crease = True
    lineset.select_edge_mark = False
    lineset.select_material_boundary = False
    lineset.visibility = "VISIBLE"

    style = bpy.data.linestyles.get("LineStyle") or bpy.data.linestyles.new("LineStyle")
    style.color = (0, 0, 0)
    style.thickness = 1.25
    lineset.linestyle = style


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


def render_southwest(out_dir):
    min_v, max_v, center = scene_bounds()
    width = max_v.x - min_v.x
    height = max_v.z - min_v.z
    z_center = center.z
    cam = make_camera(
        "CAD_Test_Southwest",
        (center.x, min_v.y - 12.0, z_center),
        (math.radians(90), 0, 0),
        max(width, height) * 1.12,
    )
    bpy.context.scene.camera = cam
    out_path = out_dir / "southwest_blender_native_test.png"
    bpy.context.scene.render.filepath = str(out_path)
    bpy.ops.render.render(write_still=True)
    return out_path


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python export_blender_native_cad_test.py -- output_dir")
    out_dir = Path(sys.argv[sys.argv.index("--") + 1])
    out_dir.mkdir(parents=True, exist_ok=True)
    prepare_scene()
    path = render_southwest(out_dir)
    print(f"BLENDER_NATIVE_CAD_TEST={path}")


if __name__ == "__main__":
    main()
