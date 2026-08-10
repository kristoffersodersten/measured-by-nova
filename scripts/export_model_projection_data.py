import json
import sys
from pathlib import Path

import bpy


def object_record(obj):
    points = [obj.matrix_world @ corner for corner in obj.bound_box]
    return {
        "name": obj.name,
        "type": obj.type,
        "bbox": [[p.x, p.y, p.z] for p in points],
        "location": [obj.location.x, obj.location.y, obj.location.z],
        "dimensions": [obj.dimensions.x, obj.dimensions.y, obj.dimensions.z],
    }


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python export_model_projection_data.py -- output.json")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    objects = [
        object_record(obj)
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and not obj.name.startswith(("Camera", "Kamera", "Verify", "Orbit"))
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"objects": objects}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
