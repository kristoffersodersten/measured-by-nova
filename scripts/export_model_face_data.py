import json
import sys
from pathlib import Path

import bpy


def category(name):
    lower = name.lower()
    if "markplatta" in lower or "grus" in lower or "floor" in lower or "golv" in lower:
        return "context"
    if "panelspår" in lower or "finish-plane-correct" in lower or "finish-detail" in lower:
        return "cladding"
    if "stenfog" in lower or "murkrön" in lower:
        return "masonry"
    if "mur" in lower or "foundation" in lower:
        return "foundation"
    if "trappa" in lower or "steg" in lower:
        return "stairs"
    if "tak" in lower or "roof" in lower:
        return "roof"
    if "stolpe" in lower or "post" in lower or "balk" in lower or "header" in lower:
        return "structure"
    return "object"


def main():
    if "--" not in sys.argv:
        raise SystemExit("Usage: blender model.blend --background --python export_model_face_data.py -- output.json")
    output = Path(sys.argv[sys.argv.index("--") + 1])
    faces = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if obj.name.startswith(("Camera", "Kamera", "Verify", "Orbit")):
            continue
        mesh = obj.data
        world_vertices = [obj.matrix_world @ vertex.co for vertex in mesh.vertices]
        for poly in mesh.polygons:
            pts = [world_vertices[index] for index in poly.vertices]
            faces.append(
                {
                    "object": obj.name,
                    "category": category(obj.name),
                    "points": [[p.x, p.y, p.z] for p in pts],
                    "center": [sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), sum(p.z for p in pts) / len(pts)],
                }
            )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"faces": faces}, ensure_ascii=False), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
