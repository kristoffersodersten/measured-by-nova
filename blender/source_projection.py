import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


FACE_NORMALS = {
    "front": Vector((0, -1, 0)),
    "rear": Vector((0, 1, 0)),
    "left": Vector((-1, 0, 0)),
    "right": Vector((1, 0, 0)),
    "top": Vector((0, 0, 1)),
    "bottom": Vector((0, 0, -1)),
}


def resolve_under_output_root(payload, relative_path):
    candidate = Path(relative_path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"Path must be relative and stay inside output root: {relative_path}")
    output_root = Path(payload["outputRoot"]).resolve()
    resolved = (output_root / candidate).resolve()
    if output_root != resolved and output_root not in resolved.parents:
        raise ValueError(f"Path escapes output root: {relative_path}")
    return resolved


def file_identity(relative_path, resolved_path):
    contents = resolved_path.read_bytes()
    return {"path": relative_path, "sizeBytes": len(contents), "sha256": hashlib.sha256(contents).hexdigest()}


def geometry_hash(obj):
    coordinates = [[round(value, 12) for value in vertex.co] for vertex in obj.data.vertices]
    return hashlib.sha256(json.dumps(coordinates, separators=(",", ":")).encode("utf-8")).hexdigest()


def projected_uv(matrix, x_value, y_value):
    denominator = matrix[2][0] * x_value + matrix[2][1] * y_value + matrix[2][2]
    if abs(denominator) < 1e-10:
        raise ValueError("Source projection transform maps target geometry to infinity")
    u_value = (matrix[0][0] * x_value + matrix[0][1] * y_value + matrix[0][2]) / denominator
    v_value = (matrix[1][0] * x_value + matrix[1][1] * y_value + matrix[1][2]) / denominator
    if not math.isfinite(u_value) or not math.isfinite(v_value) or u_value < -0.001 or u_value > 1.001 or v_value < -0.001 or v_value > 1.001:
        raise ValueError(f"Source projection UV leaves declared photo bounds: ({u_value:.6f}, {v_value:.6f})")
    return (max(0.0, min(1.0, u_value)), max(0.0, min(1.0, v_value)))


def projection_axes(face):
    if face in ("front", "rear"):
        return (0, 2)
    if face in ("left", "right"):
        return (1, 2)
    return (0, 1)


def projection_normal_axis(face):
    if face in ("front", "rear"):
        return 1
    if face in ("left", "right"):
        return 0
    return 2


def source_projection_material(photo_path, manifest_hash):
    image = bpy.data.images.load(str(photo_path), check_existing=False)
    image.pack()
    material = bpy.data.materials.new(f"SourceProjection-{manifest_hash[:12]}")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "CLIP"
    texture.interpolation = "Linear"
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material, image


def apply_source_projection(payload):
    alignment = payload["alignment"]
    target = alignment["target"]
    source = alignment["sourcePhoto"]
    source_blend_path = resolve_under_output_root(payload, payload["sourceBlendPath"])
    source_photo_path = resolve_under_output_root(payload, source["path"])
    report_path = resolve_under_output_root(payload, payload["outputReportPath"])
    if not source_blend_path.is_file():
        raise FileNotFoundError(f"Locked source Blender file missing: {payload['sourceBlendPath']}")
    if not source_photo_path.is_file():
        raise FileNotFoundError(f"Source projection photo missing: {source['path']}")
    actual_identity = file_identity(source["path"], source_photo_path)
    if actual_identity["sizeBytes"] != source["sizeBytes"] or actual_identity["sha256"] != source["sha256"]:
        raise ValueError(f"Source projection photo identity mismatch: {source['path']}")

    bpy.ops.wm.open_mainfile(filepath=str(source_blend_path))
    host = bpy.data.objects.get(target["hostElementId"])
    if host is None or host.type != "MESH":
        raise ValueError(f"Source projection host mesh missing: {target['hostElementId']}")
    source_geometry_hash = geometry_hash(host)
    duplicate = host.copy()
    duplicate.data = host.data.copy()
    duplicate.name = f"{host.name}__source_projection"
    bpy.context.collection.objects.link(duplicate)

    expected_normal = FACE_NORMALS[target["face"]]
    selected_polygons = [polygon for polygon in duplicate.data.polygons if polygon.normal.dot(expected_normal) >= 0.999]
    if not selected_polygons:
        raise ValueError(f"Source projection target face has no planar polygons: {target['face']}")
    horizontal_axis, vertical_axis = projection_axes(target["face"])
    normal_axis = projection_normal_axis(target["face"])
    vertices = [duplicate.data.vertices[index].co for polygon in selected_polygons for index in polygon.vertices]
    horizontal_values = [vertex[horizontal_axis] for vertex in vertices]
    vertical_values = [vertex[vertical_axis] for vertex in vertices]
    horizontal_min, horizontal_max = min(horizontal_values), max(horizontal_values)
    vertical_min, vertical_max = min(vertical_values), max(vertical_values)
    normal_values = [vertex[normal_axis] for vertex in vertices]
    if max(normal_values) - min(normal_values) > 1e-6:
        raise ValueError("Source projection target face spans multiple parallel planes")
    if horizontal_max - horizontal_min <= 1e-9 or vertical_max - vertical_min <= 1e-9:
        raise ValueError("Source projection target face has zero-area planar bounds")
    width_mm = (horizontal_max - horizontal_min) * 1000
    height_mm = (vertical_max - vertical_min) * 1000
    tolerance = target["dimensionToleranceMm"]
    if abs(width_mm - target["widthMm"]) > tolerance or abs(height_mm - target["heightMm"]) > tolerance:
        raise ValueError(f"Source projection target dimensions mismatch: actual {width_mm:.3f}x{height_mm:.3f}mm, declared {target['widthMm']:.3f}x{target['heightMm']:.3f}mm")

    material, image = source_projection_material(source_photo_path, alignment["manifestHash"])
    if list(image.size) != [source["pixelWidth"], source["pixelHeight"]]:
        raise ValueError(f"Source projection photo dimensions mismatch: actual {image.size[0]}x{image.size[1]}, declared {source['pixelWidth']}x{source['pixelHeight']}")
    duplicate.data.materials.append(material)
    material_index = len(duplicate.data.materials) - 1
    uv_layer = duplicate.data.uv_layers.get("SourceProjectionUV") or duplicate.data.uv_layers.new(name="SourceProjectionUV")
    uv_values = []
    matrix = alignment["transform"]["targetNormalizedToSourceUv"]
    for polygon in selected_polygons:
        polygon.material_index = material_index
        for loop_index in polygon.loop_indices:
            coordinate = duplicate.data.vertices[duplicate.data.loops[loop_index].vertex_index].co
            x_value = (coordinate[horizontal_axis] - horizontal_min) / (horizontal_max - horizontal_min)
            y_value = (coordinate[vertical_axis] - vertical_min) / (vertical_max - vertical_min)
            uv = projected_uv(matrix, x_value, y_value)
            uv_layer.data[loop_index].uv = uv
            uv_values.append(uv)

    duplicate_geometry_hash = geometry_hash(duplicate)
    if source_geometry_hash != geometry_hash(host) or source_geometry_hash != duplicate_geometry_hash:
        raise ValueError("Source projection attempted to mutate geometry coordinates")
    duplicate_name = duplicate.name
    host_name = host.name
    material_name = material.name
    image_name = image.name
    output_path = Path(payload["outputPath"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    validation_path = output_path.parent / f".{output_path.name}.{alignment['manifestHash'][:12]}.validation.blend"
    if validation_path.exists():
        raise ValueError(f"Source projection validation artifact already exists: {validation_path.name}")
    try:
        bpy.ops.wm.save_as_mainfile(filepath=str(validation_path))
        bpy.ops.wm.open_mainfile(filepath=str(validation_path))
        persisted = bpy.data.objects.get(duplicate_name)
        persisted_source = bpy.data.objects.get(host_name)
        if persisted is None or persisted.type != "MESH" or persisted.data.uv_layers.get("SourceProjectionUV") is None:
            raise ValueError("Source projection did not survive Blender save/reopen validation")
        if persisted_source is None or geometry_hash(persisted_source) != source_geometry_hash:
            raise ValueError("Locked source geometry did not survive Blender save/reopen validation")
        if geometry_hash(persisted) != duplicate_geometry_hash or not any(slot and slot.name == material_name for slot in persisted.data.materials):
            raise ValueError("Source projection material or geometry identity failed Blender save/reopen validation")
        persisted_image = bpy.data.images.get(image_name)
        if persisted_image is None or persisted_image.packed_file is None:
            raise ValueError("Source projection photo was not packed into the derived Blender artifact")
    finally:
        validation_path.unlink(missing_ok=True)
    report = {
        "schemaVersion": 1,
        "operation": "source_projection",
        "ok": True,
        "alignmentManifestHash": alignment["manifestHash"],
        "sourcePhotoIdentity": actual_identity,
        "sourcePhotoPacked": True,
        "sourceBlendPath": payload["sourceBlendPath"],
        "projectedObject": duplicate_name,
        "hostElementId": target["hostElementId"],
        "face": target["face"],
        "selectedPolygonCount": len(selected_polygons),
        "roundTripVerified": True,
        "uvRange": {"minU": round(min(value[0] for value in uv_values), 6), "maxU": round(max(value[0] for value in uv_values), 6), "minV": round(min(value[1] for value in uv_values), 6), "maxV": round(max(value[1] for value in uv_values), 6)},
        "geometry": {"sourceHashBefore": source_geometry_hash, "sourceHashAfter": geometry_hash(persisted_source), "projectedCopyHash": duplicate_geometry_hash, "mutationDetected": False},
        "authority": alignment["authority"],
        "executionPlacement": payload["executionPlacement"],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    bpy.context.scene["sourceProjectionReport"] = json.dumps(report, sort_keys=True)
    return report
