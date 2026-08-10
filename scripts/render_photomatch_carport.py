import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


OUTPUT = Path("outputs/renders/photoreal/carport_white_realism_clean.png").resolve()
FOREGROUND = Path("outputs/renders/photoreal/carport_white_realism_clean_foreground.png").resolve()
BACKGROUND = Path("/Users/kristoffersodersten/Documents/Airdrop/IMG_2958.png")
RESOLUTION = (1920, 1440)
SAMPLES = 160
RANDOM_SEED = 2958


def clear_helpers():
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith("Photomatch_"):
            bpy.data.objects.remove(obj, do_unlink=True)


def material(name, color, roughness=0.7, bump=False, scale=40, strength=0.03):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        if bump:
            noise = tree.nodes.new("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = scale
            noise.inputs["Detail"].default_value = 10
            noise.inputs["Roughness"].default_value = 0.58
            bump_node = tree.nodes.new("ShaderNodeBump")
            bump_node.inputs["Strength"].default_value = strength
            bump_node.inputs["Distance"].default_value = 0.045
            tree.links.new(noise.outputs["Fac"], bump_node.inputs["Height"])
            tree.links.new(bump_node.outputs["Normal"], bsdf.inputs["Normal"])
    mat.diffuse_color = color
    return mat


def assign(obj, mat):
    if obj.type != "MESH":
        return
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def extents():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.name.startswith("Photomatch_")]
    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, p.x)
            mins.y = min(mins.y, p.y)
            mins.z = min(mins.z, p.z)
            maxs.x = max(maxs.x, p.x)
            maxs.y = max(maxs.y, p.y)
            maxs.z = max(maxs.z, p.z)
    return mins, maxs


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_materials():
    mats = {
        "white": material("Photomatch_weathered_white_wood", (0.80, 0.80, 0.74, 1), 0.88, True, 72, 0.035),
        "dark": material("Photomatch_dark_roof_surface", (0.018, 0.022, 0.022, 1), 0.88, True, 90, 0.025),
        "underside": material("Photomatch_shadowed_white_roof_underside", (0.56, 0.55, 0.50, 1), 0.9, True, 55, 0.02),
        "stone": material("Photomatch_dark_foundation_stone", (0.085, 0.087, 0.081, 1), 0.96, True, 30, 0.08),
        "mortar": material("Photomatch_mortar", (0.32, 0.31, 0.28, 1), 0.94, True, 40, 0.02),
        "gravel": material("Photomatch_ground_gravel", (0.45, 0.43, 0.37, 1), 0.98, True, 115, 0.055),
        "steps": material("Photomatch_grey_stone_steps", (0.34, 0.35, 0.32, 1), 0.94, True, 70, 0.06),
        "panel_line": material("Photomatch_panel_grooves", (0.35, 0.34, 0.30, 1), 0.92),
    }
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        hay = f"{obj.name.lower()} {' '.join(m.name.lower() for m in obj.data.materials if m)}"
        if "stenfog" in hay or "fog" in hay:
            assign(obj, mats["mortar"])
        elif "line" in hay or "shadow" in hay:
            assign(obj, mats["panel_line"])
        elif "mur" in hay or "stenmur" in hay:
            assign(obj, mats["stone"])
        elif "trappa" in hay:
            assign(obj, mats["steps"])
        elif "grus" in hay or "golv" in hay or "markplatta" in hay:
            assign(obj, mats["gravel"])
        elif "tak" in hay:
            assign(obj, mats["dark"])
        elif "balk" in hay:
            assign(obj, mats["underside"])
        elif "stolpe" in hay:
            assign(obj, mats["white"])
        elif "panel" in hay or "trä" in hay or "vägg" in hay or "trim" in hay:
            assign(obj, mats["white"])
        else:
            assign(obj, mats["white"])
    return mats


def add_bevels():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("Photomatch_"):
            continue
        if "line" in obj.name.lower() or "fog" in obj.name.lower():
            continue
        bevel = obj.modifiers.new("Photomatch_soft_edge_bevel", "BEVEL")
        bevel.width = 0.012
        bevel.segments = 2
        obj.modifiers.new("Photomatch_weighted_normals", "WEIGHTED_NORMAL")


def add_photo_context(mats, mins, maxs):
    random.seed(RANDOM_SEED)
    center = (mins + maxs) / 2
    width = max(maxs.x - mins.x, 8)
    depth = max(maxs.y - mins.y, 6)
    # Only local receiving geometry. Keep context quiet so the carport does not look like a low-poly scene.
    def box(name, loc, dim, mat):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.object
        obj.name = name
        obj.dimensions = dim
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign(obj, mat)
        return obj

    box("Photomatch_shadow_receiver_light_gravel", (center.x, center.y, mins.z - 0.03), (width + 4.5, depth + 3.4, 0.03), mats["gravel"])


def setup_camera(mins, maxs):
    center = (mins + maxs) / 2
    target = Vector((center.x + 0.08, center.y - 0.10, mins.z + (maxs.z - mins.z) * 0.50))
    # Approximate a southwest-side phone-camera view without overlaying the original carport photo.
    loc = Vector((mins.x - 3.45, mins.y - 5.20, mins.z + 1.42))
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    cam.name = "Photomatch_IMG_2958_camera"
    look_at(cam, target)
    cam.data.lens = 24
    cam.data.sensor_width = 32
    bpy.context.scene.camera = cam
    return cam


def setup_lighting(mins, maxs):
    center = (mins + maxs) / 2
    bpy.ops.object.light_add(type="SUN", location=(center.x - 5, center.y - 5, maxs.z + 8))
    sun = bpy.context.object
    sun.name = "Photomatch_low_sun_from_photo"
    sun.data.energy = 3.7
    sun.rotation_euler = (math.radians(50), 0, math.radians(-31))
    bpy.ops.object.light_add(type="AREA", location=(center.x - 2.5, center.y - 3.6, maxs.z + 2.7))
    area = bpy.context.object
    area.name = "Photomatch_soft_sky_fill"
    area.data.energy = 320
    area.data.size = 7
    look_at(area, center)


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    bpy.context.view_layer.use_freestyle = False
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x = RESOLUTION[0]
    scene.render.resolution_y = RESOLUTION[1]
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.72
    scene.view_settings.gamma = 1
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = (0.66, 0.78, 0.92)


def main():
    clear_helpers()
    mats = setup_materials()
    mins, maxs = extents()
    add_photo_context(mats, mins, maxs)
    add_bevels()
    setup_camera(mins, maxs)
    setup_lighting(mins, maxs)
    setup_render()
    FOREGROUND.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(FOREGROUND)
    bpy.ops.render.render(write_still=True)
    print(f"FOREGROUND={FOREGROUND}")
    print(f"BACKGROUND={BACKGROUND}")
    print(f"OUTPUT={OUTPUT}")


if __name__ == "__main__":
    main()
