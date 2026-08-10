import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


OUTPUT = Path("outputs/renders/photoreal/carport_photoreal_site_southwest_v2.png").resolve()
RESOLUTION = (2200, 1400)
SAMPLES = 128
RANDOM_SEED = 42


def clear_render_helpers():
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith("Render_"):
            bpy.data.objects.remove(obj, do_unlink=True)


def principled_material(name, color, roughness=0.65, metallic=0.0, noise_bump=False, bump_strength=0.04, bump_scale=32):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes.get("Principled BSDF")
    if bsdf:
        if "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = color
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = roughness
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = metallic
        if noise_bump and "Normal" in bsdf.inputs:
            noise = tree.nodes.new("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = bump_scale
            noise.inputs["Detail"].default_value = 9
            noise.inputs["Roughness"].default_value = 0.62
            bump = tree.nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = bump_strength
            bump.inputs["Distance"].default_value = 0.05
            tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
            tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    mat.diffuse_color = color
    return mat


def assign_material(obj, mat):
    if obj.type != "MESH":
        return
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def scene_extents():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.name.startswith("Render_")]
    if not meshes:
        return Vector((0, 0, 0)), Vector((8, 6, 3.5))
    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, world.x)
            mins.y = min(mins.y, world.y)
            mins.z = min(mins.z, world.z)
            maxs.x = max(maxs.x, world.x)
            maxs.y = max(maxs.y, world.y)
            maxs.z = max(maxs.z, world.z)
    return mins, maxs


def add_box(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, mat)
    return obj


def setup_materials():
    materials = {
        "white_wood": principled_material("Render_weathered_white_painted_wood", (0.82, 0.82, 0.76, 1), 0.86, noise_bump=True, bump_strength=0.035, bump_scale=55),
        "underside": principled_material("Render_warm_shadowed_roof_underside", (0.22, 0.21, 0.18, 1), 0.84, noise_bump=True, bump_strength=0.025, bump_scale=42),
        "dark_roof": principled_material("Render_dark_matte_roof_felt", (0.015, 0.019, 0.019, 1), 0.88, noise_bump=True, bump_strength=0.025, bump_scale=80),
        "dark_post": principled_material("Render_dark_structural_posts", (0.035, 0.039, 0.038, 1), 0.76, noise_bump=True, bump_strength=0.018, bump_scale=45),
        "stone": principled_material("Render_dark_split_stone", (0.08, 0.085, 0.08, 1), 0.95, noise_bump=True, bump_strength=0.085, bump_scale=24),
        "mortar": principled_material("Render_mortar_lines", (0.30, 0.30, 0.27, 1), 0.94, noise_bump=True, bump_strength=0.02, bump_scale=35),
        "gravel": principled_material("Render_compacted_gravel", (0.48, 0.47, 0.40, 1), 0.98, noise_bump=True, bump_strength=0.075, bump_scale=120),
        "concrete": principled_material("Render_grey_stone_steps", (0.33, 0.34, 0.31, 1), 0.94, noise_bump=True, bump_strength=0.065, bump_scale=65),
        "shadow_line": principled_material("Render_panel_groove_shadow", (0.34, 0.33, 0.29, 1), 0.92),
        "asphalt": principled_material("Render_asphalt_road", (0.10, 0.105, 0.105, 1), 0.96, noise_bump=True, bump_strength=0.045, bump_scale=95),
        "road_marking": principled_material("Render_worn_road_marking", (0.86, 0.84, 0.78, 1), 0.91, noise_bump=True, bump_strength=0.012, bump_scale=40),
        "rock": principled_material("Render_background_granite_rock", (0.30, 0.31, 0.29, 1), 0.96, noise_bump=True, bump_strength=0.13, bump_scale=20),
        "soil": principled_material("Render_brown_planting_soil", (0.16, 0.11, 0.08, 1), 0.98, noise_bump=True, bump_strength=0.08, bump_scale=85),
        "plant": principled_material("Render_dark_evergreen", (0.025, 0.07, 0.035, 1), 0.82),
        "lamp": principled_material("Render_black_lantern_metal", (0.015, 0.013, 0.011, 1), 0.45, metallic=0.4),
    }
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        mats = " ".join(mat.name.lower() for mat in obj.data.materials if mat)
        haystack = f"{name} {mats}"
        if "stenfog" in haystack or "mortar" in haystack or "fog" in haystack:
            assign_material(obj, materials["mortar"])
        elif "line" in haystack or "shadow" in haystack:
            assign_material(obj, materials["shadow_line"])
        elif "mur" in haystack or "stenmur" in haystack:
            assign_material(obj, materials["stone"])
        elif "trappa" in haystack or "step" in haystack:
            assign_material(obj, materials["concrete"])
        elif "grus" in haystack or "golv" in haystack or "markplatta" in haystack:
            assign_material(obj, materials["gravel"])
        elif "tak" in haystack:
            assign_material(obj, materials["dark_roof"])
        elif "balk" in haystack:
            assign_material(obj, materials["underside"])
        elif "stolpe" in haystack:
            assign_material(obj, materials["white_wood"] if "nordöst inre" in haystack else materials["dark_post"])
        elif "panel" in haystack or "trä" in haystack or "v\u00e4gg" in haystack or "trim" in haystack:
            assign_material(obj, materials["white_wood"])
        else:
            assign_material(obj, materials["white_wood"])
    return materials


def add_context(materials, mins, maxs):
    random.seed(RANDOM_SEED)
    center = (mins + maxs) / 2
    width = max(maxs.x - mins.x, 8)
    depth = max(maxs.y - mins.y, 6)
    add_box(
        "Render_gravel_yard",
        (center.x, center.y, mins.z - 0.035),
        (width + 6, depth + 5, 0.035),
        materials["gravel"],
    )
    add_box(
        "Render_asphalt_road_southwest_reference",
        (center.x - 0.4, mins.y - 2.55, mins.z - 0.027),
        (width + 9, 2.9, 0.028),
        materials["asphalt"],
    )
    for i in range(3):
        stripe = add_box(
            f"Render_worn_road_marking_{i+1}",
            (mins.x + 1.2 + i * 2.4, mins.y - 3.15, mins.z + 0.002),
            (0.85, 0.07, 0.006),
            materials["road_marking"],
        )
        stripe.rotation_euler.z = math.radians(2)

    rock = add_box(
        "Render_low_background_rock_reference",
        (mins.x - 1.9, center.y + 1.4, mins.z + 0.72),
        (1.25, depth + 3.8, 1.42),
        materials["rock"],
    )
    rock.rotation_euler.z = math.radians(6)
    rock.rotation_euler.x = math.radians(-4)

    house = add_box("Render_distant_neighbor_house_wall_reference", (mins.x - 4.2, maxs.y + 2.6, mins.z + 1.45), (0.08, 2.4, 2.6), materials["white_wood"])
    house.hide_render = True

    # Foreground pavers and soil strips echo the site photos without pretending to be surveyed geometry.
    for ix in range(4):
        for iy in range(2):
            slab = add_box(
                f"Render_irregular_foreground_paver_{ix}_{iy}",
                (mins.x + 0.9 + ix * 0.62, mins.y - 0.78 - iy * 0.46, mins.z + 0.018),
                (0.56 + random.uniform(-0.05, 0.04), 0.38 + random.uniform(-0.04, 0.05), 0.035),
                materials["concrete"],
            )
            slab.rotation_euler.z = random.uniform(-0.05, 0.05)
    add_box("Render_soil_strip_near_stairs", (mins.x + 0.42, mins.y - 0.28, mins.z + 0.02), (0.42, 1.4, 0.025), materials["soil"])

    # Simple planter/evergreen silhouette from the photos.
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.18, depth=0.32, location=(mins.x + 0.52, mins.y - 0.95, mins.z + 0.18))
    pot = bpy.context.object
    pot.name = "Render_black_planter_reference"
    assign_material(pot, materials["lamp"])
    bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=0.28, radius2=0.05, depth=0.85, location=(mins.x + 0.52, mins.y - 0.95, mins.z + 0.74))
    plant = bpy.context.object
    plant.name = "Render_evergreen_reference"
    assign_material(plant, materials["plant"])

    # A modest wall lantern on the adjacent house plane improves scale and site feel.
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.055, depth=0.42, location=(mins.x - 0.24, mins.y - 0.34, mins.z + 1.88), rotation=(math.radians(90), 0, 0))
    lamp = bpy.context.object
    lamp.name = "Render_wall_lantern_reference"
    assign_material(lamp, materials["lamp"])


def add_detail_modifiers():
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("Render_"):
            continue
        if "line" in obj.name.lower() or "fog" in obj.name.lower():
            continue
        bevel = obj.modifiers.new("Render_subtle_real_edge_bevel", "BEVEL")
        bevel.width = 0.015
        bevel.segments = 2
        bevel.affect = "EDGES"
        obj.modifiers.new("Render_weighted_normals", "WEIGHTED_NORMAL")


def setup_lighting(mins, maxs):
    center = (mins + maxs) / 2
    bpy.ops.object.light_add(type="SUN", location=(center.x - 4, center.y - 5, maxs.z + 7))
    sun = bpy.context.object
    sun.name = "Render_low_winter_sun"
    sun.data.energy = 3.1
    sun.rotation_euler = (math.radians(48), 0, math.radians(-28))
    bpy.ops.object.light_add(type="AREA", location=(center.x - 3.5, center.y - 4.3, maxs.z + 2.8))
    area = bpy.context.object
    area.name = "Render_large_soft_sky_fill"
    area.data.energy = 280
    area.data.size = 6.5
    look_at(area, center)


def setup_camera(mins, maxs):
    center = (mins + maxs) / 2
    target = Vector((center.x - 0.05, center.y - 0.05, mins.z + (maxs.z - mins.z) * 0.48))
    camera_location = Vector((mins.x - 3.7, mins.y - 5.15, mins.z + 1.62))
    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "Render_photoreal_camera_southwest"
    look_at(camera, target)
    camera.data.lens = 28
    camera.data.sensor_width = 32
    camera.data.dof.use_dof = True
    camera.data.dof.focus_distance = (camera.location - target).length
    camera.data.dof.aperture_fstop = 11
    bpy.context.scene.camera = camera


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    bpy.context.view_layer.use_freestyle = False
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x = RESOLUTION[0]
    scene.render.resolution_y = RESOLUTION[1]
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.65
    scene.view_settings.gamma = 1
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = (0.58, 0.72, 0.92)


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    clear_render_helpers()
    materials = setup_materials()
    mins, maxs = scene_extents()
    add_context(materials, mins, maxs)
    add_detail_modifiers()
    setup_lighting(mins, maxs)
    setup_camera(mins, maxs)
    setup_render()
    bpy.context.scene.render.filepath = str(OUTPUT)
    bpy.ops.render.render(write_still=True)
    print(f"RENDER_OUTPUT={OUTPUT}")


if __name__ == "__main__":
    main()
