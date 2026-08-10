import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def make_white_emission():
    mat = bpy.data.materials.get("CAD_White_Emission") or bpy.data.materials.new("CAD_White_Emission")
    mat.diffuse_color = (1, 1, 1, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new(type="ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1, 1, 1, 1)
    emission.inputs["Strength"].default_value = 1.0
    out = nodes.new(type="ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def bounds():
    verts = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if obj.name.startswith(("Camera", "Kamera", "Verify", "Orbit")):
            continue
        verts.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return min_v, max_v, (min_v + max_v) / 2


def prepare_scene():
    white = make_white_emission()
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_render = False
            obj.data.materials.clear()
            obj.data.materials.append(white)
        elif obj.type in {"LIGHT", "CAMERA"}:
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
    for ls in list(fs.linesets):
        fs.linesets.remove(ls)
    ls = fs.linesets.new("CAD visible outlines")
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.select_edge_mark = False
    ls.select_material_boundary = False
    style = bpy.data.linestyles.get("LineStyle")
    if style:
        style.color = (0, 0, 0)
        style.thickness = 1.35


def make_camera(name, loc, rot, scale):
    bpy.ops.object.camera_add(location=loc, rotation=rot)
    cam = bpy.context.object
    cam.name = name
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = scale
    return cam


def render_views(out_dir):
    min_v, max_v, center = bounds()
    width = max_v.x - min_v.x
    depth = max_v.y - min_v.y
    height = max_v.z - min_v.z
    z = center.z + 0.5
    views = [
        ("plan", "Plan", (center.x, center.y, max_v.z + 12), (0, 0, 0), max(width, depth) * 1.18),
        ("southwest", "Fasad sydväst", (center.x, min_v.y - 12, z), (math.radians(90), 0, 0), max(width, height) * 1.16),
        ("northeast", "Fasad nordöst", (center.x, max_v.y + 12, z), (math.radians(90), 0, math.radians(180)), max(width, height) * 1.16),
        ("west", "Fasad väst", (min_v.x - 12, center.y, z), (math.radians(90), 0, math.radians(-90)), max(depth, height) * 1.20),
        ("east", "Fasad öst", (max_v.x + 12, center.y, z), (math.radians(90), 0, math.radians(90)), max(depth, height) * 1.20),
        ("section_a_a", "Sektion A-A", (max_v.x + 12, center.y, z), (math.radians(90), 0, math.radians(90)), max(depth, height) * 1.20),
    ]
    manifest = []
    for key, title, loc, rot, scale in views:
        cam = make_camera("FreestyleCAD_" + key, loc, rot, scale)
        cam.hide_render = False
        bpy.context.scene.camera = cam
        path = out_dir / f"{key}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        cam.hide_render = True
        manifest.append((key, title, path.name))
    (out_dir / "rendered_views.tsv").write_text(
        "\n".join(f"{key}\t{title}\t{name}" for key, title, name in manifest),
        encoding="utf-8",
    )


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python export_freestyle_white_line_views.py -- output_dir")
    out_dir = Path(sys.argv[sys.argv.index("--") + 1])
    out_dir.mkdir(parents=True, exist_ok=True)
    prepare_scene()
    render_views(out_dir)
    print(f"FREESTYLE_WHITE_LINE_EXPORT={out_dir}")


if __name__ == "__main__":
    main()
