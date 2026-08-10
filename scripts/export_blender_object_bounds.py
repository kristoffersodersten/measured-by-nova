import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def mesh_bounds(obj):
    verts = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return min_v, max_v


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python export_blender_object_bounds.py -- output.json")
    output_path = Path(sys.argv[sys.argv.index("--") + 1])
    rows = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if obj.name.startswith(("Camera", "Kamera", "Verify", "Orbit")):
            continue
        min_v, max_v = mesh_bounds(obj)
        rows.append(
            {
                "name": obj.name,
                "min": [min_v.x, min_v.y, min_v.z],
                "max": [max_v.x, max_v.y, max_v.z],
                "vertices": len(obj.data.vertices),
            }
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"objects": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output_path)


if __name__ == "__main__":
    main()
