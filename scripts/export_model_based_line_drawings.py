import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def white_material():
    mat = bpy.data.materials.get("cad_line_white_material") or bpy.data.materials.new("cad_line_white_material")
    mat.diffuse_color = (1, 1, 1, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
        bsdf.inputs["Roughness"].default_value = 1
    return mat


def prepare_scene():
    mat = white_material()
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.data.materials.clear()
            obj.data.materials.append(mat)
        if obj.type == "LIGHT":
            obj.hide_render = True

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1600
    scene.render.film_transparent = False
    scene.world.color = (1, 1, 1)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    layer = bpy.context.view_layer
    layer.use_freestyle = True
    fs = scene.view_layers[0].freestyle_settings
    for lineset in list(fs.linesets):
        fs.linesets.remove(lineset)
    lineset = fs.linesets.new("CAD object lines")
    lineset.select_silhouette = True
    lineset.select_border = True
    lineset.select_crease = True
    lineset.select_edge_mark = False
    linestyle = bpy.data.linestyles.get("LineStyle")
    if linestyle:
        linestyle.color = (0, 0, 0)
        linestyle.thickness = 1.8


def model_bounds():
    verts = []
    ignored_prefixes = ("Camera", "Kamera", "Verify", "Orbit")
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if obj.name.startswith(ignored_prefixes):
            continue
        verts.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return min_v, max_v, (min_v + max_v) / 2


def camera(name, loc, rot, scale):
    existing = bpy.data.objects.get(name)
    if existing:
        cam = existing
        cam.location = loc
        cam.rotation_euler = rot
    else:
        bpy.ops.object.camera_add(location=loc, rotation=rot)
        cam = bpy.context.object
        cam.name = name
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = scale
    return cam


def render_views(output_dir):
    min_v, max_v, center = model_bounds()
    width = max_v.x - min_v.x
    depth = max_v.y - min_v.y
    height = max_v.z - min_v.z
    z = center.z + 0.5
    views = [
        ("plan", "Plan", (center.x, center.y, max_v.z + 12), (0, 0, 0), max(width, depth) * 1.22),
        ("southwest", "Fasad sydväst", (center.x, min_v.y - 12, z), (math.radians(90), 0, 0), max(width, height) * 1.20),
        ("northeast", "Fasad nordöst", (center.x, max_v.y + 12, z), (math.radians(90), 0, math.radians(180)), max(width, height) * 1.20),
        ("west", "Fasad väst", (min_v.x - 12, center.y, z), (math.radians(90), 0, math.radians(-90)), max(depth, height) * 1.24),
        ("east", "Fasad öst", (max_v.x + 12, center.y, z), (math.radians(90), 0, math.radians(90)), max(depth, height) * 1.24),
        ("section_a_a", "Sektion A-A", (max_v.x + 12, center.y, z), (math.radians(90), 0, math.radians(90)), max(depth, height) * 1.24),
    ]
    rendered = []
    for key, title, loc, rot, scale in views:
        cam = camera(f"CAD_line_{key}", loc, rot, scale)
        bpy.context.scene.camera = cam
        path = output_dir / f"{key}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        rendered.append((key, title, path.name))
    (output_dir / "rendered_views.tsv").write_text(
        "\n".join(f"{key}\t{title}\t{name}" for key, title, name in rendered),
        encoding="utf-8",
    )


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python export_model_based_line_drawings.py -- output_dir")
    output_dir = Path(sys.argv[sys.argv.index("--") + 1])
    output_dir.mkdir(parents=True, exist_ok=True)
    prepare_scene()
    render_views(output_dir)
    print(f"MODEL_BASED_LINE_EXPORT={output_dir}")


if __name__ == "__main__":
    main()
