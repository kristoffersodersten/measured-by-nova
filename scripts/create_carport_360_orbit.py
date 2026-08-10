import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def scene_bounds():
    verts = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        verts.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
    if not verts:
        return Vector((0, 0, 0)), 8.0
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    center = (min_v + max_v) / 2
    radius = max((max_v - min_v).x, (max_v - min_v).y, (max_v - min_v).z) * 0.85
    return center, max(radius, 5.5)


def ensure_material_lights():
    if not any(o.type == 'LIGHT' for o in bpy.context.scene.objects):
        bpy.ops.object.light_add(type='AREA', location=(3.8, -4.5, 6.0))
        light = bpy.context.object
        light.name = 'Orbit_Area_Key_Light'
        light.data.energy = 450
        light.data.size = 5
        bpy.ops.object.light_add(type='AREA', location=(-4.0, 5.5, 4.2))
        fill = bpy.context.object
        fill.name = 'Orbit_Area_Fill_Light'
        fill.data.energy = 120
        fill.data.size = 6


def main():
    if '--' not in sys.argv:
        raise SystemExit('Usage: blender source.blend --background --python create_carport_360_orbit.py -- output.blend output.mp4')
    args = sys.argv[sys.argv.index('--') + 1:]
    output_blend = Path(args[0])
    output_video = Path(args[1])

    center, radius = scene_bounds()
    target = (center.x, center.y, max(center.z + 0.8, 1.25))
    ensure_material_lights()

    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 120
    scene.frame_set(1)
    scene.render.fps = 30
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.engine = 'BLENDER_EEVEE'
    scene.world.color = (0.78, 0.78, 0.78)

    bpy.ops.object.camera_add(location=(center.x, center.y - radius * 1.85, center.z + radius * 0.45))
    cam = bpy.context.object
    cam.name = 'Camera_360_smooth_orbit'
    cam.data.lens = 38
    scene.camera = cam

    orbit = bpy.data.objects.new('Orbit_Target_Center', None)
    orbit.empty_display_type = 'PLAIN_AXES'
    orbit.empty_display_size = 0.5
    orbit.location = target
    bpy.context.collection.objects.link(orbit)

    cam.parent = orbit
    cam.location = (0, -radius * 1.85, radius * 0.45)
    look_at(cam, target)

    orbit.rotation_euler = (0, 0, 0)
    orbit.keyframe_insert(data_path='rotation_euler', frame=1)
    orbit.rotation_euler = (0, 0, math.radians(360))
    orbit.keyframe_insert(data_path='rotation_euler', frame=120)

    output_blend.parent.mkdir(parents=True, exist_ok=True)
    output_video.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))

    frames_dir = output_video.with_suffix('')
    frames_dir.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(frames_dir / 'frame_')
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(animation=True)


if __name__ == '__main__':
    main()
