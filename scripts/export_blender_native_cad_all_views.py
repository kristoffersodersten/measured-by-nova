import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def bounds():
    verts = []
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and not obj.name.startswith(("Camera", "Kamera", "Verify", "Orbit")):
            verts.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    if not verts:
        raise RuntimeError("No mesh geometry found")
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return min_v, max_v, (min_v + max_v) / 2


def emission_material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new(type="ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = 1.0
    out = nodes.new(type="ShaderNodeOutputMaterial")
    mat.node_tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def is_detail_line(name):
    lowered = name.lower()
    return any(token in lowered for token in ("-line-", "stenfog", "vertical-trim", "header"))


def prepare_scene():
    white = emission_material("CAD_White_Surface", (1, 1, 1, 1))
    black = emission_material("CAD_Black_Detail", (0, 0, 0, 1))
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_render = False
            obj.data.materials.clear()
            obj.data.materials.append(black if is_detail_line(obj.name) else white)
        elif obj.type in {"LIGHT", "CAMERA"}:
            obj.hide_render = True

    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 3000
    scene.render.resolution_y = 2000
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("World")
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
    ls = fs.linesets.new("CAD outlines")
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.select_edge_mark = False
    ls.visibility = "VISIBLE"
    style = bpy.data.linestyles.get("LineStyle") or bpy.data.linestyles.new("LineStyle")
    style.color = (0, 0, 0)
    style.thickness = 1.15
    ls.linestyle = style


def camera(name, location, rotation, scale):
    bpy.ops.object.camera_add(location=location, rotation=rotation)
    cam = bpy.context.object
    cam.name = name
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = scale
    bpy.context.scene.camera = cam


def render_view(out_dir, key, title, location, rotation, scale):
    camera("CAD_" + key, location, rotation, scale)
    out = out_dir / f"{key}_raw.png"
    bpy.context.scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    return key, title, out.name


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python script.py -- output_dir")
    out_dir = Path(sys.argv[sys.argv.index("--") + 1])
    out_dir.mkdir(parents=True, exist_ok=True)
    prepare_scene()
    min_v, max_v, center = bounds()
    width = max_v.x - min_v.x
    depth = max_v.y - min_v.y
    height = max_v.z - min_v.z
    z = center.z
    views = [
        ("southwest", "Fasad sydväst", (center.x, min_v.y - 12.0, z), (math.radians(90), 0, 0), max(width, height) * 1.12),
        ("back", "Fasad baksida", (center.x, max_v.y + 12.0, z), (math.radians(90), 0, math.radians(180)), max(width, height) * 1.12),
        ("northeast", "Fasad nordöst", (max_v.x + 12.0, center.y, z), (math.radians(90), 0, math.radians(90)), max(depth, height) * 1.16),
        ("opposite_side", "Fasad motsatt sida", (min_v.x - 12.0, center.y, z), (math.radians(90), 0, math.radians(-90)), max(depth, height) * 1.16),
        ("plan", "Plan", (center.x, center.y, max_v.z + 12.0), (0, 0, 0), max(width, depth) * 1.18),
    ]
    manifest = [render_view(out_dir, *view) for view in views]
    (out_dir / "views.tsv").write_text(
        "\n".join(f"{key}\t{title}\t{filename}" for key, title, filename in manifest),
        encoding="utf-8",
    )
    print(f"BLENDER_NATIVE_CAD_ALL_VIEWS={out_dir}")


if __name__ == "__main__":
    main()
