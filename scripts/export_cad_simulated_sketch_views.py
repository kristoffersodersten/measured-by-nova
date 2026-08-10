import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


MM = 0.001
PROJECT_NAME = "Carport - CAD-simulated export"
MODEL_CONFIDENCE = "High: permit/PDF dimensions. Medium: manual site measurements. Low: photo-derived visual details."


def material(name, color):
    existing = bpy.data.materials.get(name)
    mat = existing or bpy.data.materials.new(name)
    mat.diffuse_color = color
    return mat


CAD_WHITE = material("cad_sketch_white_surface", (1.0, 1.0, 1.0, 1))
CAD_GREY = material("cad_sketch_light_context", (0.94, 0.94, 0.94, 1))
CAD_DARK = material("cad_sketch_light_structure", (0.88, 0.88, 0.88, 1))


def classify_materials():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        obj.data.materials.clear()
        if any(key in name for key in ("tak", "roof", "mur", "foundation", "sten", "stone")):
            obj.data.materials.append(CAD_DARK)
        elif any(key in name for key in ("mark", "grus", "floor", "golv", "trappa")):
            obj.data.materials.append(CAD_GREY)
        else:
            obj.data.materials.append(CAD_WHITE)


def bounds():
    verts = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        verts.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return min_v, max_v, (min_v + max_v) / 2


def make_camera(name, location, rotation, ortho_scale):
    cam_obj = bpy.data.objects.get(name)
    if cam_obj is None:
        bpy.ops.object.camera_add(location=location, rotation=rotation)
        cam_obj = bpy.context.object
        cam_obj.name = name
    else:
        cam_obj.location = location
        cam_obj.rotation_euler = rotation
    cam_obj.data.type = "ORTHO"
    cam_obj.data.ortho_scale = ortho_scale
    return cam_obj


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1600
    scene.render.film_transparent = False
    bpy.context.scene.world.color = (1, 1, 1)
    classify_materials()

    for obj in bpy.context.scene.objects:
        if obj.type in {"CAMERA", "LIGHT"}:
            obj.hide_render = True
    if not any(o.type == "LIGHT" for o in bpy.context.scene.objects):
        bpy.ops.object.light_add(type="AREA", location=(3.8, -4.0, 6.0))
        light = bpy.context.object
        light.name = "CAD_Sim_Area_Light"
        light.data.energy = 60
        light.data.size = 8
    for obj in bpy.context.scene.objects:
        if obj.type == "LIGHT":
            obj.hide_render = False

    view_layer = bpy.context.view_layer
    view_layer.use_freestyle = True
    fs = scene.view_layers[0].freestyle_settings
    for lineset in list(fs.linesets):
        fs.linesets.remove(lineset)
    lines = fs.linesets.new("CAD silhouette + visible edges")
    lines.select_silhouette = True
    lines.select_border = True
    lines.select_crease = True
    style = bpy.data.linestyles.get("LineStyle")
    if style:
        style.thickness = 1.6
        style.color = (0, 0, 0)


def render_views(out_dir):
    min_v, max_v, center = bounds()
    width = max_v.x - min_v.x
    depth = max_v.y - min_v.y
    height = max_v.z - min_v.z
    max_span = max(width, depth, height)
    zc = center.z + 0.55
    views = [
        ("plan", "Plan", (center.x, center.y, max_v.z + 12), (0, 0, 0), max(width, depth) * 1.22),
        ("southwest", "Fasad sydväst", (center.x, min_v.y - 12, zc), (math.radians(90), 0, 0), max(width, height) * 1.20),
        ("northeast", "Fasad nordöst", (center.x, max_v.y + 12, zc), (math.radians(90), 0, math.radians(180)), max(width, height) * 1.20),
        ("west", "Fasad väst", (min_v.x - 12, center.y, zc), (math.radians(90), 0, math.radians(-90)), max(depth, height) * 1.25),
        ("east", "Fasad öst", (max_v.x + 12, center.y, zc), (math.radians(90), 0, math.radians(90)), max(depth, height) * 1.25),
        ("section_a_a", "Sektion A-A / sidovy", (max_v.x + 12, center.y, zc), (math.radians(90), 0, math.radians(90)), max(depth, height) * 1.25),
    ]
    rendered = []
    for key, title, loc, rot, scale in views:
        cam = make_camera(f"CAD_{key}", loc, rot, scale)
        cam.hide_render = False
        bpy.context.scene.camera = cam
        path = out_dir / f"{key}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        rendered.append((key, title, path))
        cam.hide_render = True
    return rendered


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender source.blend --background --python export_cad_simulated_views.py -- output_dir")
    out_dir = Path(sys.argv[sys.argv.index("--") + 1])
    out_dir.mkdir(parents=True, exist_ok=True)
    setup_scene()
    rendered = render_views(out_dir)
    manifest = out_dir / "rendered_views.tsv"
    manifest.write_text("\n".join(f"{key}\t{title}\t{path.name}" for key, title, path in rendered), encoding="utf-8")
    print(f"CAD_SIMULATED_SKETCH_RENDERS={out_dir}")


if __name__ == "__main__":
    main()
