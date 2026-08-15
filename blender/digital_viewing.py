import json
import hashlib
import math
from pathlib import Path

import bpy
from mathutils import Vector

MM_TO_M = 0.001
STRUCTURAL_REFERENCE_COMPARISON_THRESHOLD = 0.35


def hex_to_rgba(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


def resolve_under_output_root(payload, relative_path):
    if Path(relative_path).is_absolute() or ".." in Path(relative_path).parts:
        raise ValueError(f"Path must be relative and stay inside output root: {relative_path}")
    output_root = Path(payload["outputRoot"]).resolve()
    resolved = (output_root / relative_path).resolve()
    if output_root != resolved and output_root not in resolved.parents:
        raise ValueError(f"Path escapes output root: {relative_path}")
    return resolved


def declared_asset_paths(payload, asset_type):
    asset_bundle = payload.get("assetBundleManifest") or {}
    return {
        asset.get("path")
        for asset in asset_bundle.get("assets", [])
        if asset.get("assetType") == asset_type and asset.get("status") == "present"
    }


def declared_asset(payload, asset_type, relative_path):
    asset_bundle = payload.get("assetBundleManifest") or {}
    for asset in asset_bundle.get("assets", []):
        if asset.get("assetType") == asset_type and asset.get("status") == "present" and asset.get("path") == relative_path:
            return asset
    return None


def require_declared_asset(payload, asset_type, label, relative_path):
    resolved_path = resolve_under_output_root(payload, relative_path)
    if not resolved_path.exists():
        raise FileNotFoundError(f"{label} missing: {relative_path}")
    declared_paths = declared_asset_paths(payload, asset_type)
    if declared_paths and relative_path not in declared_paths:
        raise ValueError(f"{label} is not declared in asset bundle: {relative_path}")
    return resolved_path


def add_camera(location, target, name="Camera", orthographic=False, scale=10):
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.object
    camera.name = name
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if orthographic:
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = scale
    bpy.context.scene.camera = camera
    return camera


def link_texture_map_to_bsdf(mat, bsdf, texture_map, payload, texture_report):
    report_entry = texture_report_entry(texture_map)
    texture_path = require_declared_asset(payload, "texture", f"Material texture map {texture_map['type']}", texture_map["path"])
    report_entry.update(file_identity_report(texture_map["path"], texture_path))
    actual_width = report_entry.get("width")
    actual_height = report_entry.get("height")
    if actual_width is None or actual_height is None:
        raise ValueError(f"Digital viewing texture map asset file dimensions missing: {texture_map['path']}")
    if actual_width != report_entry["pixelWidth"] or actual_height != report_entry["pixelHeight"]:
        raise ValueError(
            f"Digital viewing texture map declared resolution does not match asset file: {texture_map['path']} "
            f"declared {report_entry['pixelWidth']}x{report_entry['pixelHeight']}, actual {actual_width}x{actual_height}"
        )
    image = bpy.data.images.load(str(texture_path), check_existing=True)
    image.colorspace_settings.name = report_entry["colorSpace"]
    image_node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    image_node.image = image
    texture_type = texture_map["type"]
    if texture_type == "baseColor" and "Base Color" in bsdf.inputs:
        mat.node_tree.links.new(image_node.outputs["Color"], bsdf.inputs["Base Color"])
    elif texture_type == "roughness" and "Roughness" in bsdf.inputs:
        mat.node_tree.links.new(image_node.outputs["Color"], bsdf.inputs["Roughness"])
    elif texture_type == "metallic" and "Metallic" in bsdf.inputs:
        mat.node_tree.links.new(image_node.outputs["Color"], bsdf.inputs["Metallic"])
    elif texture_type == "alpha" and "Alpha" in bsdf.inputs:
        mat.node_tree.links.new(image_node.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.blend_method = "BLEND"
    elif texture_type == "normal" and "Normal" in bsdf.inputs:
        normal_node = mat.node_tree.nodes.new("ShaderNodeNormalMap")
        mat.node_tree.links.new(image_node.outputs["Color"], normal_node.inputs["Color"])
        mat.node_tree.links.new(normal_node.outputs["Normal"], bsdf.inputs["Normal"])
    else:
        skipped = dict(report_entry)
        skipped["reason"] = "unsupported or unavailable BSDF input"
        texture_report["skipped"].append(skipped)
        return
    texture_report["applied"].append(report_entry)


def texture_report_entry(texture_map):
    scale_mm = texture_map.get("scaleMm")
    if type(scale_mm) not in (int, float) or scale_mm <= 0:
        raise ValueError(
            f"Digital viewing texture map requires scaleMm for reproducible physical material rendering: {texture_map['path']}"
        )
    color_space = texture_map.get("colorSpace")
    if color_space not in ("sRGB", "Non-Color"):
        raise ValueError(
            f"Digital viewing texture map requires explicit colorSpace for reproducible physical material rendering: {texture_map['path']}"
        )
    texture_type = texture_map["type"]
    expected_color_space = "sRGB" if texture_type == "baseColor" else "Non-Color"
    if color_space != expected_color_space:
        raise ValueError(
            f"Digital viewing texture map colorSpace does not match texture type: {texture_map['path']} expected {expected_color_space} for {texture_type}, got {color_space}"
        )
    pixel_width = texture_map.get("pixelWidth")
    pixel_height = texture_map.get("pixelHeight")
    if type(pixel_width) is not int or pixel_width <= 0 or type(pixel_height) is not int or pixel_height <= 0:
        raise ValueError(
            f"Digital viewing texture map requires declared pixelWidth and pixelHeight for reproducible material quality: {texture_map['path']}"
        )
    entry = {"path": texture_map["path"], "type": texture_map["type"], "colorSpace": color_space}
    for key in ("scaleMm", "pixelWidth", "pixelHeight"):
        if texture_map.get(key) is not None:
            entry[key] = texture_map[key]
    return entry


def first_input(bsdf, names):
    for name in names:
        if name in bsdf.inputs:
            return bsdf.inputs[name]
    return None


def rgba_to_hex(rgba):
    channels = []
    for value in rgba[:3]:
        channels.append(f"{max(0, min(255, round(float(value) * 255))):02x}")
    return f"#{''.join(channels)}"


def read_pbr_from_material(mat, declared_pbr):
    readback = {}
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
    if bsdf is not None:
        base_color_input = first_input(bsdf, ["Base Color"])
        if base_color_input is not None:
            readback["baseColor"] = rgba_to_hex(base_color_input.default_value)
        roughness_input = first_input(bsdf, ["Roughness"])
        if roughness_input is not None:
            readback["roughness"] = round(float(roughness_input.default_value), 6)
        metallic_input = first_input(bsdf, ["Metallic"])
        if metallic_input is not None:
            readback["metallic"] = round(float(metallic_input.default_value), 6)
        specular_input = first_input(bsdf, ["Specular IOR Level", "Specular"])
        if specular_input is not None:
            readback["specular"] = round(float(specular_input.default_value), 6)
        alpha_input = first_input(bsdf, ["Alpha"])
        if alpha_input is not None:
            readback["transmission"] = round(max(0.0, 1.0 - float(alpha_input.default_value)), 6)
    if declared_pbr.get("normalSource") is not None:
        readback["normalSource"] = declared_pbr["normalSource"]
    if declared_pbr.get("textureScaleMm") is not None:
        readback["textureScaleMm"] = declared_pbr["textureScaleMm"]
    return readback


def pbr_material_from_manifest(entry, payload, texture_report):
    material_id = entry["materialId"]
    pbr = entry.get("pbr", {})
    base_color = pbr.get("baseColor") or "#d9d9d9"
    mat = bpy.data.materials.new(f"measured-{material_id}")
    mat.diffuse_color = hex_to_rgba(base_color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        rgba = hex_to_rgba(base_color)
        if "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = rgba
        if "Roughness" in bsdf.inputs and pbr.get("roughness") is not None:
            bsdf.inputs["Roughness"].default_value = float(pbr["roughness"])
        if "Metallic" in bsdf.inputs and pbr.get("metallic") is not None:
            bsdf.inputs["Metallic"].default_value = float(pbr["metallic"])
        specular_input = first_input(bsdf, ["Specular IOR Level", "Specular"])
        if specular_input is not None and pbr.get("specular") is not None:
            specular_input.default_value = float(pbr["specular"])
        if "Alpha" in bsdf.inputs and pbr.get("transmission") is not None:
            bsdf.inputs["Alpha"].default_value = max(0.0, 1.0 - float(pbr["transmission"]))
            mat.blend_method = "BLEND"
        for texture_map in entry.get("textureMaps", []):
            link_texture_map_to_bsdf(mat, bsdf, texture_map, payload, texture_report)
    mat["measured_material_id"] = material_id
    if entry.get("presetId"):
        mat["measured_material_preset_id"] = entry["presetId"]
    mat["measured_provenance"] = entry.get("provenance", "unknown")
    mat["measured_confidence"] = entry.get("confidence", "low")
    return mat


def declared_photo_asset_paths(payload):
    return declared_asset_paths(payload, "photo")


def require_declared_photo_asset(payload, label, relative_path):
    return require_declared_asset(payload, "photo", label, relative_path)


def material_source_photo_identities(entry, payload):
    identities = []
    seen = set()

    def add_identity(usage, photo_path):
        if not photo_path:
            return
        key = (usage, photo_path)
        if key in seen:
            return
        seen.add(key)
        resolved_photo_path = require_declared_photo_asset(payload, f"Material source photo {usage}", photo_path)
        if usage == "material-source":
            asset = declared_asset(payload, "photo", photo_path)
            required_use = f"material:{entry['materialId']}"
            if required_use not in (asset or {}).get("usedBy", []):
                raise ValueError(
                    f"Material source photo must be declared for that material in asset bundle: {entry['materialId']} {photo_path}"
                )
        identity = file_identity_report(photo_path, resolved_photo_path)
        identity["usage"] = usage
        identities.append(identity)

    for photo_path in entry.get("photoSources", []):
        add_identity("material-source", photo_path)
    add_identity("surface-mapping", (entry.get("surfaceMapping") or {}).get("sourcePhoto"))
    add_identity("appearance-calibration", (entry.get("appearanceCalibration") or {}).get("sourcePhoto"))
    return identities


def validate_material_surface_mapping(material_id, surface_mapping):
    projection = surface_mapping.get("projection")
    if projection not in ("uv", "box", "planar"):
        raise ValueError(
            f"Digital viewing material surfaceMapping requires a supported projection for reproducible material placement: {material_id}"
        )
    faces = surface_mapping.get("faces")
    if not isinstance(faces, list) or len(faces) == 0:
        raise ValueError(
            f"Digital viewing material surfaceMapping requires at least one physical face for reproducible material placement: {material_id}"
        )
    valid_faces = {"front", "rear", "left", "right", "top", "bottom", "interior", "exterior"}
    invalid_faces = sorted({face for face in faces if face not in valid_faces})
    if invalid_faces:
        raise ValueError(
            f"Digital viewing material surfaceMapping contains unsupported physical faces for reproducible material placement: {material_id} "
            + ", ".join(invalid_faces)
        )
    scale_mm = surface_mapping.get("scaleMm")
    if type(scale_mm) not in (int, float) or not math.isfinite(float(scale_mm)) or scale_mm <= 0:
        raise ValueError(
            f"Digital viewing material surfaceMapping requires positive scaleMm for reproducible physical material placement: {material_id}"
        )
    rotation_deg = surface_mapping.get("rotationDeg", 0)
    if type(rotation_deg) not in (int, float) or not math.isfinite(float(rotation_deg)):
        raise ValueError(
            f"Digital viewing material surfaceMapping requires finite rotationDeg for reproducible material placement: {material_id}"
        )


def validate_material_appearance_calibration(material_id, material_provenance, material_photo_sources, appearance_calibration):
    method = appearance_calibration.get("method")
    if method not in ("color-chart", "white-balance-reference", "manufacturer-spec", "manual-specified"):
        raise ValueError(
            f"Digital viewing material appearanceCalibration requires a supported method for reproducible material color and finish: {material_id}"
        )
    source_photo = appearance_calibration.get("sourcePhoto")
    if method in ("color-chart", "white-balance-reference") and not source_photo:
        raise ValueError(
            f"Digital viewing material appearanceCalibration requires sourcePhoto for photo-based calibration: {material_id}"
        )
    if source_photo and source_photo not in set(material_photo_sources or []):
        raise ValueError(
            f"Digital viewing material appearanceCalibration sourcePhoto must be declared as material evidence: {material_id}"
        )
    confidence = appearance_calibration.get("confidence")
    if confidence not in ("high", "medium", "low"):
        raise ValueError(
            f"Digital viewing material appearanceCalibration requires confidence for reproducible material color and finish: {material_id}"
        )
    illuminant = appearance_calibration.get("illuminant")
    if material_provenance == "photo_observed" and not illuminant:
        raise ValueError(
            f"Digital viewing material appearanceCalibration requires illuminant for photo-observed material color and finish: {material_id}"
        )
    if illuminant is not None and illuminant not in ("daylight", "studio", "overcast", "mixed", "specified"):
        raise ValueError(
            f"Digital viewing material appearanceCalibration contains unsupported illuminant for reproducible material color and finish: {material_id}"
        )


def apply_manifest_materials(render_manifest, payload):
    material_entries = render_manifest.get("materials", [])
    applied = []
    missing_hosts = []
    texture_report = {"applied": [], "missing": [], "skipped": []}
    for entry in material_entries:
        mat = pbr_material_from_manifest(entry, payload, texture_report)
        host_id = entry.get("hostElementId")
        if not host_id:
            continue
        obj = bpy.data.objects.get(host_id)
        if obj is None:
            missing_hosts.append(host_id)
            continue
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        obj["measured_material_id"] = entry["materialId"]
        if entry.get("surfaceMapping"):
            validate_material_surface_mapping(entry["materialId"], entry["surfaceMapping"])
            obj["measured_material_surface_mapping"] = json.dumps(entry["surfaceMapping"], sort_keys=True)
            mat["measured_surface_mapping"] = json.dumps(entry["surfaceMapping"], sort_keys=True)
        if entry.get("appearanceCalibration"):
            validate_material_appearance_calibration(entry["materialId"], entry.get("provenance"), entry.get("photoSources"), entry["appearanceCalibration"])
            obj["measured_material_appearance_calibration"] = json.dumps(entry["appearanceCalibration"], sort_keys=True)
            mat["measured_appearance_calibration"] = json.dumps(entry["appearanceCalibration"], sort_keys=True)
        applied_entry = {"object": obj.name, "materialId": entry["materialId"], "presetId": entry.get("presetId")}
        source_photo_identities = material_source_photo_identities(entry, payload)
        if source_photo_identities:
            applied_entry["sourcePhotoIdentities"] = source_photo_identities
        if entry.get("pbr"):
            applied_entry["pbr"] = entry["pbr"]
            applied_entry["pbrReadback"] = {
                "sourceOfTruth": "read-from-blender-material-node-values-after-application",
                "fields": sorted(entry["pbr"].keys()),
                "values": read_pbr_from_material(mat, entry["pbr"])
            }
        if entry.get("surfaceMapping"):
            applied_entry["surfaceMapping"] = entry["surfaceMapping"]
        if entry.get("appearanceCalibration"):
            applied_entry["appearanceCalibration"] = entry["appearanceCalibration"]
        applied.append(applied_entry)
    return {"applied": applied, "missingHosts": sorted(set(missing_hosts)), "textures": texture_report}


def require_no_missing_application_hosts(report, label):
    missing_hosts = report.get("missingHosts", [])
    if missing_hosts:
        raise ValueError(f"{label} reference missing Blender host objects: " + ", ".join(missing_hosts))


def require_render_reference_photos(payload, render_manifest):
    references = []
    camera_reference_photo = render_manifest.get("renderPreset", {}).get("camera", {}).get("referencePhoto")
    if camera_reference_photo:
        references.append(("camera referencePhoto", camera_reference_photo))
    lighting_reference_photo = render_manifest.get("renderPreset", {}).get("lighting", {}).get("referencePhoto")
    if lighting_reference_photo:
        references.append(("lighting referencePhoto", lighting_reference_photo))
    camera_reference = render_manifest.get("cameraReference")
    if camera_reference and camera_reference.get("referencePhoto"):
        references.append(("cameraReference referencePhoto", camera_reference["referencePhoto"]))
    lighting_reference = render_manifest.get("lightingReference")
    if lighting_reference and lighting_reference.get("referencePhoto"):
        references.append(("lightingReference referencePhoto", lighting_reference["referencePhoto"]))

    declared_photo_paths = declared_photo_asset_paths(payload)
    missing = []
    undeclared = []
    for label, relative_path in references:
        if not resolve_under_output_root(payload, relative_path).exists():
            missing.append(f"{label} {relative_path}")
        elif declared_photo_paths and relative_path not in declared_photo_paths:
            undeclared.append(f"{label} {relative_path}")
    if missing:
        raise FileNotFoundError("Render reference photo missing: " + ", ".join(missing))
    if undeclared:
        raise ValueError("Render reference photo is not declared in asset bundle: " + ", ".join(undeclared))


def validate_declared_renderable_hosts(render_manifest):
    declared = [
        entry["id"]
        for entry in render_manifest.get("modelElements", [])
        if entry.get("renderable", True)
    ]
    missing = sorted({model_id for model_id in declared if bpy.data.objects.get(model_id) is None})
    if missing:
        raise ValueError(
            "Locked Blender scene is missing declared renderable model elements: "
            + ", ".join(missing)
        )
    return {"declaredRenderableHosts": sorted(declared)}


def material_authoring_execution_report(payload, render_manifest):
    material_authoring = payload.get("materialAuthoring")
    if not isinstance(material_authoring, dict):
        raise ValueError("Digital viewing render job must include materialAuthoring derived from the material authoring plan")
    if material_authoring.get("sourceOfTruth") != "derived-from-material-authoring-plan":
        raise ValueError("Digital viewing materialAuthoring sourceOfTruth must be derived-from-material-authoring-plan")
    plan_hash = material_authoring.get("planHash")
    expected_hash = render_manifest.get("hashes", {}).get("materialAuthoringPlanHash")
    if not plan_hash or plan_hash != expected_hash:
        raise ValueError("Digital viewing materialAuthoring planHash must match renderManifest.hashes.materialAuthoringPlanHash")
    if material_authoring.get("ready") is not True:
        raise ValueError("Digital viewing materialAuthoring must be ready before Blender rendering")
    return {
        "sourceOfTruth": material_authoring["sourceOfTruth"],
        "planHash": plan_hash,
        "ready": material_authoring["ready"],
        "blockingCount": int(material_authoring.get("blockingCount", 0)),
        "warningCount": int(material_authoring.get("warningCount", 0)),
    }


def condition_color(condition):
    kind = condition.get("type", "unknown")
    severity = condition.get("severity", "unknown")
    if kind in ("scratch", "crack", "wear"):
        base = "#2d2d2d"
    elif kind in ("dent", "repair", "seam"):
        base = "#737373"
    elif kind in ("stain", "oxidation", "patina", "fading"):
        base = "#7d7158"
    else:
        base = "#9a9a9a"
    if severity == "high":
        return base
    if severity == "low":
        return "#b0b0a8"
    return base


def create_condition_material(condition):
    mat = bpy.data.materials.new(f"condition-{condition['id']}")
    mat.diffuse_color = hex_to_rgba(condition_color(condition))
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        if "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = mat.diffuse_color
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.82
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
    mat["measured_condition_id"] = condition["id"]
    mat["measured_condition_type"] = condition.get("type", "unknown")
    return mat


def read_condition_material_from_material(mat, condition):
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
    base_color = mat.diffuse_color
    alpha = mat.diffuse_color[3]
    roughness = 1.0
    metallic = 0.0
    if bsdf is not None:
        base_color_input = first_input(bsdf, ["Base Color"])
        if base_color_input is not None:
            base_color = base_color_input.default_value
        alpha_input = first_input(bsdf, ["Alpha"])
        if alpha_input is not None:
            alpha = float(alpha_input.default_value)
        roughness_input = first_input(bsdf, ["Roughness"])
        if roughness_input is not None:
            roughness = float(roughness_input.default_value)
        metallic_input = first_input(bsdf, ["Metallic"])
        if metallic_input is not None:
            metallic = float(metallic_input.default_value)
    return {
        "sourceOfTruth": "read-from-blender-condition-material-after-application",
        "baseColor": rgba_to_hex(base_color),
        "alpha": round(float(alpha), 6),
        "roughness": round(float(roughness), 6),
        "metallic": round(float(metallic), 6),
        "conditionType": condition.get("type", "unknown"),
        "severity": condition.get("severity", "unknown"),
    }


def condition_surface_transform(host, placement):
    min_x, min_y, min_z = (float("inf"), float("inf"), float("inf"))
    max_x, max_y, max_z = (float("-inf"), float("-inf"), float("-inf"))
    for corner in host.bound_box:
        world = host.matrix_world @ Vector(corner)
        min_x = min(min_x, world.x)
        min_y = min(min_y, world.y)
        min_z = min(min_z, world.z)
        max_x = max(max_x, world.x)
        max_y = max(max_y, world.y)
        max_z = max(max_z, world.z)
    u = float(placement["u"])
    v = float(placement["v"])
    width = float(placement["widthMm"]) * MM_TO_M
    height = float(placement["heightMm"]) * MM_TO_M
    offset = 0.006
    face = placement["face"]
    if face == "front":
        location = (min_x + (max_x - min_x) * u, min_y - offset, min_z + (max_z - min_z) * v)
        rotation = (math.radians(90), 0, math.radians(float(placement.get("rotationDeg", 0))))
    elif face == "rear":
        location = (min_x + (max_x - min_x) * (1 - u), max_y + offset, min_z + (max_z - min_z) * v)
        rotation = (math.radians(90), 0, math.radians(180 + float(placement.get("rotationDeg", 0))))
    elif face == "left":
        location = (min_x - offset, min_y + (max_y - min_y) * u, min_z + (max_z - min_z) * v)
        rotation = (math.radians(90), 0, math.radians(90 + float(placement.get("rotationDeg", 0))))
    elif face == "right":
        location = (max_x + offset, min_y + (max_y - min_y) * (1 - u), min_z + (max_z - min_z) * v)
        rotation = (math.radians(90), 0, math.radians(-90 + float(placement.get("rotationDeg", 0))))
    elif face == "top":
        location = (min_x + (max_x - min_x) * u, min_y + (max_y - min_y) * v, max_z + offset)
        rotation = (0, 0, math.radians(float(placement.get("rotationDeg", 0))))
    else:
        location = (min_x + (max_x - min_x) * u, min_y + (max_y - min_y) * v, min_z - offset)
        rotation = (math.radians(180), 0, math.radians(float(placement.get("rotationDeg", 0))))
    return location, rotation, width, height


def surface_placement_matches(left, right):
    if not left or not right:
        return False
    fields = ("hostElementId", "face", "u", "v", "widthMm", "heightMm", "rotationDeg")
    return all(left.get(field) == right.get(field) for field in fields)


def validate_condition_surface_placement(condition, checklist_entry=None):
    placement = condition.get("surfacePlacement") or {}
    face = placement.get("face")
    valid_faces = {"front", "rear", "left", "right", "top", "bottom"}
    if face not in valid_faces:
        raise ValueError(f"Condition surfacePlacement requires a supported physical face: {condition['id']} {face}")
    u = placement.get("u")
    v = placement.get("v")
    if type(u) not in (int, float) or type(v) not in (int, float) or not math.isfinite(float(u)) or not math.isfinite(float(v)) or u < 0 or u > 1 or v < 0 or v > 1:
        raise ValueError(f"Condition surfacePlacement requires normalized u/v coordinates on the host surface: {condition['id']}")
    width_mm = placement.get("widthMm")
    height_mm = placement.get("heightMm")
    if type(width_mm) not in (int, float) or not math.isfinite(float(width_mm)) or width_mm <= 0:
        raise ValueError(f"Condition surfacePlacement requires positive visible dimensions: {condition['id']}")
    if type(height_mm) not in (int, float) or not math.isfinite(float(height_mm)) or height_mm <= 0:
        raise ValueError(f"Condition surfacePlacement requires positive visible dimensions: {condition['id']}")
    expected_placement = (checklist_entry or {}).get("surfacePlacement")
    if expected_placement and not surface_placement_matches(placement, expected_placement):
        raise ValueError(f"Condition surfacePlacement must match visibility checklist: {condition['id']}")


def apply_condition_overlays(render_manifest, payload):
    applied = []
    missing_hosts = []
    skipped = []
    visibility_checklist_by_condition_id = {
        entry.get("conditionId"): entry
        for entry in render_manifest.get("conditionVisibilityChecklist", [])
    }
    for condition in render_manifest.get("conditions", []):
        placement = condition.get("surfacePlacement")
        if not placement:
            skipped.append({"id": condition["id"], "reason": "surfacePlacement missing"})
            continue
        host = bpy.data.objects.get(placement["hostElementId"])
        if host is None:
            missing_hosts.append(placement["hostElementId"])
            continue
        validate_condition_surface_placement(condition, visibility_checklist_by_condition_id.get(condition["id"]))
        location, rotation, width, height = condition_surface_transform(host, placement)
        bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
        overlay = bpy.context.object
        overlay.name = f"condition-{condition['id']}"
        overlay.dimensions = (width, 0.003, height)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        condition_material = create_condition_material(condition)
        overlay.data.materials.append(condition_material)
        overlay["measured_condition_id"] = condition["id"]
        overlay["not_geometry_authority"] = True
        overlay["source"] = condition.get("source", "unknown")
        material_name = overlay.data.materials[0].name if overlay.data.materials else None
        source_photo_identities = []
        for photo_path in condition.get("photoSources", []):
            resolved_photo_path = require_declared_photo_asset(payload, "Condition source photo condition-source", photo_path)
            asset = declared_asset(payload, "photo", photo_path)
            if f"condition:{condition['id']}" not in (asset or {}).get("usedBy", []):
                raise ValueError(f"Condition source photo must be verified condition-detail evidence: {condition['id']} {photo_path}")
            identity = file_identity_report(photo_path, resolved_photo_path)
            identity["usage"] = "condition-source"
            source_photo_identities.append(identity)
        applied.append({
            "conditionId": condition["id"],
            "object": overlay.name,
            "hostElementId": placement["hostElementId"],
            "face": placement["face"],
            "sourcePhotoIdentities": source_photo_identities,
            "surfacePlacement": placement,
            "visibilityProof": {
                "sourceOfTruth": "created-visible-blender-overlay-object",
                "objectName": overlay.name,
                "materialName": material_name,
                "visibleInRender": not overlay.hide_render,
                "dimensionsMm": {
                    "widthMm": placement.get("widthMm"),
                    "heightMm": placement.get("heightMm"),
                },
                "materialReadback": read_condition_material_from_material(condition_material, condition),
            },
        })
    return {"applied": applied, "missingHosts": sorted(set(missing_hosts)), "skipped": skipped}


def scene_mesh_extents():
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_objects:
        return (-2.0, -2.0, 0.0, 2.0, 2.0, 2.0)
    xs = []
    ys = []
    zs = []
    for obj in mesh_objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            xs.append(world.x)
            ys.append(world.y)
            zs.append(world.z)
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def camera_distance_from_reference(render_manifest, default_distance):
    camera_reference = render_manifest.get("cameraReference")
    if camera_reference is None:
        return default_distance, "scene-span"
    distance_mm = camera_reference.get("cameraDistanceMm")
    if isinstance(distance_mm, (int, float)) and distance_mm > 0:
        return float(distance_mm) * MM_TO_M, "camera-reference"
    return default_distance, "scene-span"


def camera_focal_length_from_reference(render_manifest, camera_cfg):
    camera_reference = render_manifest.get("cameraReference")
    if camera_reference is not None:
        focal_length = camera_reference.get("focalLength35mmEquivalent")
        if isinstance(focal_length, (int, float)) and focal_length > 0:
            return float(focal_length), "camera-reference"
    return float(camera_cfg.get("focalLengthMm", 55)), "render-preset"


def require_perspective_camera_reference_metadata(render_manifest):
    camera_cfg = render_manifest.get("renderPreset", {}).get("camera", {})
    if camera_cfg.get("mode") != "perspective" or not camera_cfg.get("referencePhoto"):
        return
    camera_reference = render_manifest.get("cameraReference")
    if not isinstance(camera_reference, dict):
        raise ValueError("Digital viewing perspective camera referencePhoto requires renderManifest.cameraReference calibration metadata")
    required_fields = [
        "sourceOfTruth",
        "referencePhoto",
        "sector",
        "cameraMode",
        "focalLength35mmEquivalent",
        "cameraDistanceMm",
    ]
    missing_fields = [field for field in required_fields if field not in camera_reference]
    if missing_fields:
        raise ValueError(
            "Digital viewing perspective camera referencePhoto requires complete renderManifest.cameraReference calibration metadata: "
            + ", ".join(missing_fields)
        )
    if camera_reference.get("sourceOfTruth") != "derived-from-verified-capture-photo-camera-metadata":
        raise ValueError("Digital viewing perspective camera reference must be derived from verified capture photo camera metadata")
    if camera_reference.get("referencePhoto") != camera_cfg.get("referencePhoto"):
        raise ValueError("Digital viewing perspective camera referencePhoto must match renderManifest.cameraReference.referencePhoto")
    if not isinstance(camera_reference.get("focalLength35mmEquivalent"), (int, float)) or camera_reference["focalLength35mmEquivalent"] <= 0:
        raise ValueError("Digital viewing perspective camera reference requires positive focalLength35mmEquivalent")
    if not isinstance(camera_reference.get("cameraDistanceMm"), (int, float)) or camera_reference["cameraDistanceMm"] <= 0:
        raise ValueError("Digital viewing perspective camera reference requires positive cameraDistanceMm")


def rounded_vector(values):
    return [round(float(value), 6) for value in values]


def view_orientation_degrees(location, target):
    direction = Vector(target) - Vector(location)
    horizontal = math.sqrt(direction.x * direction.x + direction.y * direction.y)
    yaw = math.degrees(math.atan2(-direction.x, direction.y))
    if yaw > 180:
        yaw -= 360
    if yaw <= -180:
        yaw += 360
    pitch = math.degrees(math.atan2(direction.z, horizontal))
    yaw = round(yaw, 6)
    pitch = round(pitch, 6)
    if yaw == 0:
        yaw = 0
    return yaw, pitch


def configure_render_manifest_camera(render_manifest, payload):
    require_perspective_camera_reference_metadata(render_manifest)
    min_x, min_y, min_z, max_x, max_y, max_z = scene_mesh_extents()
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    cz = (min_z + max_z) / 2
    span = max(max_x - min_x, max_y - min_y, max_z - min_z, 1.0)
    preset = render_manifest["renderPreset"]
    camera_cfg = preset["camera"]
    sector = camera_cfg["sector"].lower()
    default_distance = span * 1.8
    if camera_cfg["mode"] == "perspective":
        distance, distance_source = camera_distance_from_reference(render_manifest, default_distance)
    else:
        distance, distance_source = default_distance, "scene-span"
    height = span * 0.35
    positions = {
        "front": ((cx, min_y - distance, cz + height), (cx, cy, cz)),
        "south": ((cx, min_y - distance, cz + height), (cx, cy, cz)),
        "rear": ((cx, max_y + distance, cz + height), (cx, cy, cz)),
        "north": ((cx, max_y + distance, cz + height), (cx, cy, cz)),
        "left": ((min_x - distance, cy, cz + height), (cx, cy, cz)),
        "west": ((min_x - distance, cy, cz + height), (cx, cy, cz)),
        "right": ((max_x + distance, cy, cz + height), (cx, cy, cz)),
        "east": ((max_x + distance, cy, cz + height), (cx, cy, cz)),
        "top": ((cx, cy, max_z + distance), (cx, cy, cz)),
        "detail": ((cx - distance * 0.75, min_y - distance * 0.75, cz + height), (cx, cy, cz)),
        "interior": ((cx, min_y - distance * 0.85, cz + height * 0.6), (cx, cy, cz)),
    }
    location, target = positions.get(sector, positions["front"])
    ortho_scale = camera_cfg.get("orthoScaleMm", span * 1200) * MM_TO_M if camera_cfg["mode"] == "orthographic" else None
    camera = add_camera(location, target, name=f"Measured_Render_{sector}", orthographic=camera_cfg["mode"] == "orthographic", scale=ortho_scale)
    if camera_cfg["mode"] == "perspective":
        camera.data.type = "PERSP"
        focal_length, focal_length_source = camera_focal_length_from_reference(render_manifest, camera_cfg)
        camera.data.sensor_width = 36.0
        camera.data.lens = focal_length
    else:
        focal_length = None
        focal_length_source = "orthographic"
    bpy.context.scene.camera = camera
    camera_report = {"cameraName": camera.name, "sector": sector, "mode": camera_cfg["mode"]}
    if camera_cfg.get("referencePhoto") is not None:
        camera_report["referencePhoto"] = camera_cfg["referencePhoto"]
        reference_photo_path = resolve_under_output_root(payload, camera_cfg["referencePhoto"])
        if reference_photo_path.exists():
            camera_report["referencePhotoIdentity"] = file_identity_report(camera_cfg["referencePhoto"], reference_photo_path)
    if render_manifest.get("cameraReference") is not None:
        camera_reference = render_manifest["cameraReference"]
        camera_report["appliedDistanceMm"] = round(distance / MM_TO_M, 6)
        camera_report["appliedDistanceSource"] = distance_source
        camera_report["appliedFocalLength35mmEquivalent"] = round(focal_length, 6)
        camera_report["appliedFocalLengthSource"] = focal_length_source
        camera_report["cameraLocationM"] = rounded_vector(location)
        camera_report["cameraTargetM"] = rounded_vector(target)
        camera_report["sensorWidthMm"] = round(float(camera.data.sensor_width), 6)
        executed_yaw, executed_pitch = view_orientation_degrees(location, target)
        camera_report["executedYawDeg"] = executed_yaw
        camera_report["executedPitchDeg"] = executed_pitch
        camera_report["cameraReference"] = {
            "sourceOfTruth": camera_reference["sourceOfTruth"],
            "referencePhoto": camera_reference["referencePhoto"],
            "sector": camera_reference["sector"],
            "cameraMode": camera_reference["cameraMode"],
            "focalLength35mmEquivalent": camera_reference["focalLength35mmEquivalent"],
            "cameraDistanceMm": camera_reference["cameraDistanceMm"],
        }
    return camera_report


def configure_photoreal_render_settings(render_manifest):
    preset = render_manifest["renderPreset"]
    renderer = preset["renderer"]
    samples = 0
    denoise = False
    if renderer == "cycles":
        bpy.context.scene.render.engine = "CYCLES"
        bpy.context.scene.cycles.samples = 64
        bpy.context.scene.cycles.use_denoising = True
        samples = int(bpy.context.scene.cycles.samples)
        denoise = bool(bpy.context.scene.cycles.use_denoising)
    else:
        if "BLENDER_EEVEE_NEXT" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items:
            bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
        else:
            bpy.context.scene.render.engine = "BLENDER_EEVEE"
        if hasattr(bpy.context.scene, "eevee"):
            bpy.context.scene.eevee.taa_render_samples = 32
            samples = int(bpy.context.scene.eevee.taa_render_samples)
    bpy.context.scene.render.resolution_x = int(preset["resolution"]["width"])
    bpy.context.scene.render.resolution_y = int(preset["resolution"]["height"])
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.view_settings.exposure = 0
    bpy.context.scene.view_settings.gamma = 1
    bpy.context.scene.world.color = (0.78, 0.82, 0.86)
    return {
        "renderer": renderer,
        "samples": samples,
        "denoise": denoise,
        "resolution": {
            "width": int(bpy.context.scene.render.resolution_x),
            "height": int(bpy.context.scene.render.resolution_y),
        },
        "filmTransparent": bool(bpy.context.scene.render.film_transparent),
        "viewTransform": bpy.context.scene.view_settings.view_transform,
        "look": bpy.context.scene.view_settings.look,
        "exposure": float(bpy.context.scene.view_settings.exposure),
        "gamma": float(bpy.context.scene.view_settings.gamma),
        "worldColor": "#c7d1db",
    }


def configure_manifest_lighting(render_manifest, payload):
    for obj in list(bpy.context.scene.objects):
        if obj.type == "LIGHT" and obj.name.startswith("Measured_Render_"):
            bpy.data.objects.remove(obj, do_unlink=True)
    preset = render_manifest["renderPreset"]
    intensity = float(preset["lighting"].get("intensity", 1))
    min_x, min_y, min_z, max_x, max_y, max_z = scene_mesh_extents()
    span = max(max_x - min_x, max_y - min_y, max_z - min_z, 1.0)
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    bpy.ops.object.light_add(type="AREA", location=(cx - span * 0.6, cy - span * 0.9, max_z + span * 0.8))
    key = bpy.context.object
    key.name = "Measured_Render_Key_Area"
    key.data.energy = 700 * intensity
    key.data.size = max(span * 0.8, 1.0)
    bpy.ops.object.light_add(type="AREA", location=(cx + span * 0.7, cy + span * 0.8, max_z + span * 0.55))
    fill = bpy.context.object
    fill.name = "Measured_Render_Fill_Area"
    fill.data.energy = 110 * intensity
    fill.data.size = max(span * 1.2, 1.0)
    lighting_report = {
        "lights": [key.name, fill.name],
        "environment": preset["lighting"]["environment"],
    }
    if preset["lighting"].get("referencePhoto") is not None:
        lighting_report["referencePhoto"] = preset["lighting"]["referencePhoto"]
        reference_photo_path = resolve_under_output_root(payload, preset["lighting"]["referencePhoto"])
        if reference_photo_path.exists():
            lighting_report["referencePhotoIdentity"] = file_identity_report(preset["lighting"]["referencePhoto"], reference_photo_path)
    lighting_reference = render_manifest.get("lightingReference")
    if lighting_reference is not None:
        lighting_report["lightingReference"] = lighting_reference["lightingReference"]
        lighting_report["colorReference"] = lighting_reference["colorReference"]
        lighting_report["whiteBalanceKelvin"] = lighting_reference["whiteBalanceKelvin"]
        lighting_report["exposureEv"] = lighting_reference["exposureEv"]
    return lighting_report


def asset_bundle_execution_report(payload):
    asset_bundle = payload.get("assetBundleManifest")
    if not asset_bundle:
        raise ValueError("Digital viewing render job must include assetBundleManifest before Blender can load photos or textures")
    quality_gates = asset_bundle.get("qualityGates", {})
    summary = asset_bundle.get("summary", {})
    hashes = asset_bundle.get("hashes", {})
    if quality_gates.get("ready") is not True:
        raise ValueError("Digital viewing asset bundle must be ready before render execution")
    verified_content_count = verify_asset_bundle_content(payload, asset_bundle)
    return {
        "manifestType": asset_bundle.get("manifestType"),
        "ready": True,
        "assetBundleHash": hashes.get("assetBundleHash"),
        "requiredCount": summary.get("requiredCount", 0),
        "missingCount": summary.get("missingCount", 0),
        "verifiedContentCount": verified_content_count,
    }


def verify_asset_bundle_content(payload, asset_bundle):
    verified_count = 0
    for asset in asset_bundle.get("assets", []):
        if not asset.get("required") or asset.get("status") != "present":
            continue
        if asset.get("assetType") not in ("photo", "texture"):
            continue
        asset_path = asset.get("path")
        if not asset_path:
            raise ValueError("Asset bundle present file has no path")
        if asset.get("sizeBytes") is None or asset.get("sha256") is None:
            raise ValueError(f"Asset bundle file identity missing: {asset_path}")
        resolved_path = resolve_under_output_root(payload, asset_path)
        if not resolved_path.exists():
            raise FileNotFoundError(f"Asset bundle file missing during render execution: {asset_path}")
        contents = resolved_path.read_bytes()
        actual_size = len(contents)
        if actual_size != int(asset["sizeBytes"]):
            raise ValueError(f"Asset bundle file size mismatch: {asset_path}")
        actual_hash = hashlib.sha256(contents).hexdigest()
        if actual_hash != asset["sha256"]:
            raise ValueError(f"Asset bundle file hash mismatch: {asset_path}")
        declared_width = asset.get("width")
        declared_height = asset.get("height")
        if declared_width is not None or declared_height is not None:
            actual_dimensions = image_dimensions(contents)
            if actual_dimensions is None:
                raise ValueError(f"Asset bundle declared image dimensions cannot be verified from asset file: {asset_path}")
            actual_width = actual_dimensions["width"]
            actual_height = actual_dimensions["height"]
            if actual_width != declared_width or actual_height != declared_height:
                raise ValueError(
                    f"Asset bundle declared image dimensions do not match asset file: {asset_path} "
                    f"declared {declared_width}x{declared_height}, actual {actual_width}x{actual_height}"
                )
        verified_count += 1
    return verified_count


def file_identity_report(relative_path, resolved_path):
    contents = resolved_path.read_bytes()
    report = {
        "path": relative_path,
        "sizeBytes": len(contents),
        "sha256": hashlib.sha256(contents).hexdigest(),
    }
    dimensions = image_dimensions(contents)
    if dimensions is not None:
        report["width"] = dimensions["width"]
        report["height"] = dimensions["height"]
    return report


def image_dimensions(contents):
    if contents.startswith(b"\x89PNG\r\n\x1a\n") and len(contents) >= 24:
        return {
            "width": int.from_bytes(contents[16:20], "big"),
            "height": int.from_bytes(contents[20:24], "big"),
        }
    if contents.startswith(b"\xff\xd8"):
        cursor = 2
        while cursor + 9 < len(contents):
            if contents[cursor] != 0xFF:
                cursor += 1
                continue
            marker = contents[cursor + 1]
            cursor += 2
            if marker in (0xD8, 0xD9):
                continue
            if cursor + 2 > len(contents):
                break
            segment_length = int.from_bytes(contents[cursor:cursor + 2], "big")
            if segment_length < 2 or cursor + segment_length > len(contents):
                break
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                return {
                    "height": int.from_bytes(contents[cursor + 3:cursor + 5], "big"),
                    "width": int.from_bytes(contents[cursor + 5:cursor + 7], "big"),
                }
            cursor += segment_length
    return None


def measurement_execution_report(render_manifest):
    missing_hosts = sorted({
        anchor["hostElementId"]
        for anchor in render_manifest.get("measurementAnchors", [])
        if bpy.data.objects.get(anchor["hostElementId"]) is None
    })
    if missing_hosts:
        raise ValueError("Measurement anchors reference missing Blender host objects: " + ", ".join(missing_hosts))

    applied = []
    for anchor in render_manifest.get("measurementAnchors", []):
        if anchor.get("geometryValidation") != "axis-extent":
            applied.append(
                {
                    "measurementId": anchor["measurementId"],
                    "hostElementId": anchor["hostElementId"],
                    "referenceFrame": anchor["referenceFrame"],
                    "value": anchor["value"],
                    "unit": anchor["unit"],
                    "tolerance": anchor.get("tolerance"),
                    "sourceOfTruth": "declared-measurement-value-used-by-blender",
                }
            )
            continue
        host = bpy.data.objects.get(anchor["hostElementId"])
        axis = anchor.get("axis")
        if axis not in ("x", "y", "z"):
            raise ValueError(f"Measurement anchor requires a supported axis: {anchor['measurementId']} {axis}")
        if anchor.get("unit") != "mm":
            raise ValueError(f"Axis-extent measurement anchor requires unit mm: {anchor['measurementId']} {anchor.get('unit')}")
        if host.parent is not None or any(abs(float(angle)) > 0.000001 for angle in host.rotation_euler):
            raise ValueError(
                "Axis-extent measurement host must be aligned to its declared reference frame: "
                f"{anchor['measurementId']} host={anchor['hostElementId']} referenceFrame={anchor['referenceFrame']}"
            )
        axis_index = {"x": 0, "y": 1, "z": 2}[axis]
        actual_mm = float(host.dimensions[axis_index]) / MM_TO_M
        expected_mm = float(anchor["value"])
        tolerance_mm = float(anchor.get("tolerance") or 0)
        difference_mm = abs(actual_mm - expected_mm)
        if difference_mm > tolerance_mm + 0.001:
            raise ValueError(
                "Locked Blender geometry does not match verified measurement: "
                f"{anchor['measurementId']} host={anchor['hostElementId']} axis={axis} "
                f"expected={expected_mm:.3f}mm actual={actual_mm:.3f}mm tolerance={tolerance_mm:.3f}mm"
            )
        applied.append(
            {
                "measurementId": anchor["measurementId"],
                "hostElementId": anchor["hostElementId"],
                "referenceFrame": anchor["referenceFrame"],
                "value": anchor["value"],
                "unit": anchor["unit"],
                "tolerance": anchor.get("tolerance"),
                "axis": axis,
                "geometryValidation": "axis-extent",
                "referenceFrameReadback": anchor["referenceFrame"],
                "actualValue": round(actual_mm, 3),
                "difference": round(difference_mm, 3),
                "withinTolerance": True,
                "sourceOfTruth": "declared-measurement-value-used-by-blender",
            }
        )
    return {"applied": applied}


def measurement_authority_report(render_manifest, measurement_report):
    anchors = render_manifest.get("measurementAnchors", [])
    geometry_hash = render_manifest.get("hashes", {}).get("geometryHash")
    if not geometry_hash:
        raise ValueError("Digital viewing render manifest must include hashes.geometryHash for measurement authority")
    return {
        "sourceOfTruth": "render-manifest-verified-measurements",
        "geometryHash": geometry_hash,
        "measurementCount": len(anchors),
        "appliedMeasurementCount": len(measurement_report.get("applied", [])),
        "geometryMutationAllowed": False,
    }


def image_pixels(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        pixels = list(image.pixels)
        if len(pixels) < 4:
            raise ValueError(f"Image has no readable pixels: {path}")
        return pixels, int(image.size[0]), int(image.size[1])
    finally:
        bpy.data.images.remove(image)


def average_rgb_for_image(path):
    pixels, _width, _height = image_pixels(path)
    red = 0.0
    green = 0.0
    blue = 0.0
    pixel_count = len(pixels) // 4
    for index in range(0, pixel_count * 4, 4):
        red += pixels[index]
        green += pixels[index + 1]
        blue += pixels[index + 2]
    return (red / pixel_count, green / pixel_count, blue / pixel_count)


def luma_grid_for_image(path, grid_size=8):
    pixels, width, height = image_pixels(path)
    cells = [0.0] * (grid_size * grid_size)
    counts = [0] * (grid_size * grid_size)
    for y in range(height):
        grid_y = min(grid_size - 1, int(y * grid_size / height))
        for x in range(width):
            grid_x = min(grid_size - 1, int(x * grid_size / width))
            pixel_index = (y * width + x) * 4
            luma = (
                0.2126 * pixels[pixel_index]
                + 0.7152 * pixels[pixel_index + 1]
                + 0.0722 * pixels[pixel_index + 2]
            )
            cell_index = grid_y * grid_size + grid_x
            cells[cell_index] += luma
            counts[cell_index] += 1
    return [
        cells[index] / counts[index] if counts[index] else 0.0
        for index in range(grid_size * grid_size)
    ]


def luma_grid_similarity(render_path, reference_path):
    render_grid = luma_grid_for_image(render_path)
    reference_grid = luma_grid_for_image(reference_path)
    distance = math.sqrt(sum((render_grid[index] - reference_grid[index]) ** 2 for index in range(len(render_grid))) / len(render_grid))
    return max(0.0, min(1.0, 1.0 - distance))


def render_reference_comparison_report(payload, render_manifest, render_path):
    reference_photo = render_manifest["renderPreset"]["camera"].get("referencePhoto")
    if reference_photo is None:
        return {
            "renderPath": render_manifest["artifacts"]["render"],
            "method": "reference-metadata-alignment",
            "score": 1,
            "threshold": 1,
        }
    reference_path = resolve_under_output_root(payload, reference_photo)
    score = luma_grid_similarity(render_path, reference_path)
    return {
        "referencePhoto": reference_photo,
        "renderPath": render_manifest["artifacts"]["render"],
        "method": "luma-grid-rmse",
        "score": round(score, 6),
        "threshold": STRUCTURAL_REFERENCE_COMPARISON_THRESHOLD,
    }


def render_digital_viewing(payload, output_path):
    render_manifest = payload["renderManifest"]
    if render_manifest.get("notGeometryAuthority") is not True:
        raise ValueError("Digital viewing render manifest must declare notGeometryAuthority=true")
    material_authoring_report = material_authoring_execution_report(payload, render_manifest)
    asset_bundle_report = asset_bundle_execution_report(payload)
    require_render_reference_photos(payload, render_manifest)
    source_blend_path = resolve_under_output_root(payload, payload["sourceBlendPath"])
    if not source_blend_path.exists():
        raise FileNotFoundError(f"Locked source Blender file does not exist: {source_blend_path}")
    bpy.ops.wm.open_mainfile(filepath=str(source_blend_path))
    host_report = validate_declared_renderable_hosts(render_manifest)
    material_report = apply_manifest_materials(render_manifest, payload)
    require_no_missing_application_hosts(material_report, "Materials")
    condition_report = apply_condition_overlays(render_manifest, payload)
    require_no_missing_application_hosts(condition_report, "Condition overlays")
    camera_report = configure_render_manifest_camera(render_manifest, payload)
    lighting_report = configure_manifest_lighting(render_manifest, payload)
    render_quality_report = configure_photoreal_render_settings(render_manifest)
    measurement_report = measurement_execution_report(render_manifest)
    measurement_authority = measurement_authority_report(render_manifest, measurement_report)
    render_path = resolve_under_output_root(payload, render_manifest["artifacts"]["render"])
    manifest_path = resolve_under_output_root(payload, render_manifest["artifacts"]["manifest"])
    render_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(render_path)
    bpy.ops.render.render(write_still=True)
    render_artifact_report = file_identity_report(render_manifest["artifacts"]["render"], render_path)
    reference_comparison_report = render_reference_comparison_report(payload, render_manifest, render_path)
    execution_report = {
        "renderedBy": "blender",
        "sourceBlendPath": payload.get("authoritySourceBlendPath", payload["sourceBlendPath"]),
        "outputBlendPath": str(output_path),
        "materialAuthoring": material_authoring_report,
        "measurementAuthority": measurement_authority,
        "hostValidation": host_report,
        "measurementApplication": measurement_report,
        "materialApplication": material_report,
        "conditionApplication": condition_report,
        "camera": camera_report,
        "lighting": lighting_report,
        "renderQuality": render_quality_report,
        "renderArtifact": render_artifact_report,
        "referenceComparison": reference_comparison_report,
    }
    if asset_bundle_report:
        execution_report["assetBundle"] = asset_bundle_report
    manifest_payload = dict(render_manifest)
    manifest_payload["blenderExecution"] = execution_report
    manifest_path.write_text(json.dumps(manifest_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
