import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


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


def make_camera(name, loc, rot, scale):
    bpy.ops.object.camera_add(location=loc, rotation=rot)
    cam = bpy.context.object
    cam.name = name
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = scale
    return cam


def make_line_material():
    mat = bpy.data.materials.get("LineArt_Black") or bpy.data.materials.new("LineArt_Black")
    mat.diffuse_color = (0, 0, 0, 1)
    mat.use_nodes = False
    try:
        bpy.data.materials.create_gpencil_data(mat)
    except Exception:
        pass
    if getattr(mat, "grease_pencil", None):
        mat.grease_pencil.color = (0, 0, 0, 1)
        mat.grease_pencil.show_stroke = True
        mat.grease_pencil.show_fill = False
    return mat


def set_all_meshes_visible():
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_viewport = False
            obj.hide_render = False


def hide_meshes_after_bake():
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_render = True
            obj.hide_viewport = True


def add_line_art_object(name, cam):
    bpy.ops.object.grease_pencil_add(type="EMPTY", location=(0, 0, 0))
    gp = bpy.context.object
    gp.name = name
    gp.data.name = name + "_data"
    mat = make_line_material()
    gp.data.materials.append(mat)
    mod = gp.modifiers.new(name + "_modifier", "LINEART")
    mod.source_type = "SCENE"
    mod.use_custom_camera = True
    mod.source_camera = cam
    mod.use_contour = True
    mod.use_crease = True
    mod.use_intersection = False
    mod.use_material = False
    mod.use_edge_mark = False
    mod.use_loose = False
    mod.radius = 0.002
    mod.target_material = mat
    bpy.context.view_layer.objects.active = gp
    gp.select_set(True)
    bpy.ops.object.lineart_bake_strokes()
    return gp


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 1600
    scene.world.color = (1, 1, 1)
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"


def export_view(out_dir, key, title, loc, rot, scale):
    set_all_meshes_visible()
    cam = make_camera("LineArtCam_" + key, loc, rot, scale)
    bpy.context.scene.camera = cam
    gp = add_line_art_object("LineArt_" + key, cam)
    hide_meshes_after_bake()
    cam.hide_render = True
    gp.hide_render = False
    png = out_dir / f"{key}.png"
    svg = out_dir / f"{key}.svg"
    bpy.context.scene.render.filepath = str(png)
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.grease_pencil_export_svg(filepath=str(svg), selected_object_type="ACTIVE", frame_mode="ACTIVE", use_fill=False, use_clip_camera=True)
    return key, title, png.name, svg.name


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python export_blender_line_art_views.py -- output_dir")
    out_dir = Path(sys.argv[sys.argv.index("--") + 1])
    out_dir.mkdir(parents=True, exist_ok=True)
    setup_render()
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
    for view in views:
        # Remove previous view GP objects from render so each PNG is clean.
        for obj in bpy.context.scene.objects:
            if obj.type == "GREASEPENCIL":
                obj.hide_render = True
                obj.hide_viewport = True
        manifest.append(export_view(out_dir, *view))
    (out_dir / "line_art_views.tsv").write_text(
        "\n".join(f"{key}\t{title}\t{png}\t{svg}" for key, title, png, svg in manifest),
        encoding="utf-8",
    )
    print(f"LINE_ART_EXPORT={out_dir}")


if __name__ == "__main__":
    main()
