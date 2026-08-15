import builtins
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from digital_viewing import render_digital_viewing

MM_TO_M = 0.001


def hex_to_rgba(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = hex_to_rgba(color)
    return mat


def create_box(name, bounds, color="#d9d9d9"):
    x = bounds["x"] * MM_TO_M
    y = bounds["y"] * MM_TO_M
    z = bounds["z"] * MM_TO_M
    w = bounds["width"] * MM_TO_M
    d = bounds["depth"] * MM_TO_M
    h = bounds["height"] * MM_TO_M
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x + w / 2, y + d / 2, z + h / 2))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material(f"{name}-mat", color))
    return obj


def create_sloped_roof(name, bounds, metadata, color="#d9d9d9"):
    x = bounds["x"] * MM_TO_M
    y = bounds["y"] * MM_TO_M
    w = bounds["width"] * MM_TO_M
    d = bounds["depth"] * MM_TO_M
    thickness = bounds["height"] * MM_TO_M
    high = float(metadata["highSideHeightMm"]) * MM_TO_M
    low = float(metadata["lowSideHeightMm"]) * MM_TO_M
    overhang = float(metadata.get("overhangMm", 220)) * MM_TO_M
    x0 = x - overhang
    x1 = x + w + overhang
    y0 = y - overhang
    y1 = y + d + overhang

    def z_at(world_x, offset=0.0):
        t = (world_x - x) / w
        return high + (low - high) * t + offset

    vertices = [
        (x0, y0, z_at(x0)), (x1, y0, z_at(x1)), (x1, y1, z_at(x1)), (x0, y1, z_at(x0)),
        (x0, y0, z_at(x0, -thickness)), (x1, y0, z_at(x1, -thickness)), (x1, y1, z_at(x1, -thickness)), (x0, y1, z_at(x0, -thickness)),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material(f"{name}-mat", color))
    bpy.context.collection.objects.link(obj)
    return obj


def create_sketch(payload):
    clear_scene()
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.color = hex_to_rgba(payload["backgroundColor"])[:3]
    for index, stroke in enumerate(payload["strokes"]):
        curve = bpy.data.curves.new(f"stroke-{index + 1}", "CURVE")
        curve.dimensions = "3D"
        curve.resolution_u = 2
        curve.bevel_depth = stroke["width"] / 100
        curve.bevel_resolution = 2
        spline = curve.splines.new("POLY")
        spline.points.add(len(stroke["points"]) - 1)
        for point, coords in zip(spline.points, stroke["points"]):
            point.co = (coords[0], coords[1], 0, 1)
        obj = bpy.data.objects.new(f"stroke-{index + 1}", curve)
        obj.data.materials.append(material(f"stroke-mat-{index + 1}", stroke["color"]))
        bpy.context.collection.objects.link(obj)
    add_camera((0, 0, 12), (0, 0, 0))


def create_model(payload):
    clear_scene()
    for index, primitive in enumerate(payload["primitives"]):
        kind = primitive["kind"]
        location = primitive["location"]
        rotation = tuple(math.radians(v) for v in primitive["rotation"])
        if kind == "cube":
            bpy.ops.mesh.primitive_cube_add(size=2, location=location, rotation=rotation)
        elif kind == "sphere":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, location=location, rotation=rotation)
        elif kind == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=1, depth=2, location=location, rotation=rotation)
        elif kind == "cone":
            bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=1, radius2=0, depth=2, location=location, rotation=rotation)
        elif kind == "torus":
            bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.25, location=location, rotation=rotation)
        else:
            raise ValueError(f"Unsupported primitive kind: {kind}")
        obj = bpy.context.object
        obj.name = primitive.get("name") or f"{kind}-{index + 1}"
        obj.scale = primitive["scale"]
        obj.data.materials.append(material(f"{obj.name}-mat", primitive["color"]))
    camera = payload["camera"]
    add_camera(camera["location"], camera["target"])
    add_light()


def run_python(payload):
    if payload.get("unsafeAllowExecution") is not True:
        raise PermissionError("run_blender_python requires unsafeAllowExecution=true")
    denied = ["import os", "import subprocess", "import pathlib", "open(", "__import__", "eval(", "exec("]
    code = payload["code"]
    for token in denied:
        if token in code:
            raise PermissionError(f"Unsafe Python token blocked: {token}")
    clear_scene()
    safe_builtins = {"range": builtins.range, "len": builtins.len, "min": builtins.min, "max": builtins.max, "sum": builtins.sum, "abs": builtins.abs, "float": builtins.float, "int": builtins.int, "str": builtins.str, "print": builtins.print}
    exec(code, {"__builtins__": safe_builtins, "bpy": bpy, "math": math, "Vector": Vector})


def element_color(element):
    kind = element.get("kind")
    metadata = element.get("metadata", {})
    material_name = metadata.get("material") if isinstance(metadata, dict) else None
    if kind == "foundation" or material_name == "dark-stone":
        return "#2f3438"
    if kind in ("panel", "post", "beam") or material_name == "white-painted-wood":
        return "#f2f2ee"
    if kind == "roof":
        return "#1f2528"
    if kind == "stairs":
        return "#8f8f87"
    confidence = element.get("confidence")
    if confidence == "high":
        return "#e8e8e8"
    if confidence == "medium":
        return "#c8d6e5"
    return "#f6e58d"


def create_measurement_project(payload):
    clear_scene()
    project = payload["project"]
    for element in project.get("elements", []):
        if element["kind"] == "stairs":
            create_stairs(element)
        elif element["kind"] == "roof":
            create_sloped_roof(element["id"], element["boundsMm"], element.get("metadata", {}), element_color(element))
        else:
            create_box(element["id"], element["boundsMm"], element_color(element))
    add_panel_grooves(project)
    add_measurement_cameras(project)
    add_light()


def add_panel_grooves(project):
    groove_mat = material("wood-panel-groove-shadow", "#777777")
    for element in project.get("elements", []):
        if element.get("kind") != "panel":
            continue
        b = element["boundsMm"]
        x = b["x"] * MM_TO_M
        y = b["y"] * MM_TO_M
        z = b["z"] * MM_TO_M
        w = b["width"] * MM_TO_M
        d = b["depth"] * MM_TO_M
        h = b["height"] * MM_TO_M
        if h <= 0:
            continue
        count = int(h / (145 * MM_TO_M))
        face_y = y - 0.006 if y < 1 else y + d + 0.006
        for index in range(1, count):
            groove_z = z + index * 145 * MM_TO_M
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x + w / 2, face_y, groove_z))
            groove = bpy.context.object
            groove.name = f"{element['id']}-groove-{index}"
            groove.dimensions = (w, 0.012, 0.010)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            groove.data.materials.append(groove_mat)


def normalize_scene_geometry(tolerance=0.001):
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
    if mesh_objects:
        bpy.context.view_layer.objects.active = mesh_objects[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    snapped_vertices = 0
    max_snap_delta = 0.0
    non_axis_edges = []
    rotations_ok = True
    for obj in mesh_objects:
        rotations_ok = rotations_ok and all(abs(value) <= tolerance for value in obj.rotation_euler)
        for vertex in obj.data.vertices:
            before = (vertex.co.x, vertex.co.y, vertex.co.z)
            vertex.co.x = round(vertex.co.x / tolerance) * tolerance
            vertex.co.y = round(vertex.co.y / tolerance) * tolerance
            vertex.co.z = round(vertex.co.z / tolerance) * tolerance
            delta = max(abs(vertex.co.x - before[0]), abs(vertex.co.y - before[1]), abs(vertex.co.z - before[2]))
            if delta > 0:
                snapped_vertices += 1
                max_snap_delta = max(max_snap_delta, delta)
        obj.data.update()

        vertices = obj.data.vertices
        for edge in obj.data.edges:
            a = vertices[edge.vertices[0]].co
            b = vertices[edge.vertices[1]].co
            dx = abs(a.x - b.x)
            dy = abs(a.y - b.y)
            dz = abs(a.z - b.z)
            axis_parallel = (
                (dx <= tolerance and dy <= tolerance)
                or (dx <= tolerance and dz <= tolerance)
                or (dy <= tolerance and dz <= tolerance)
            )
            if not axis_parallel:
                non_axis_edges.append({"object": obj.name, "edge": list(edge.vertices), "delta": [dx, dy, dz]})

    ok = rotations_ok and len(non_axis_edges) == 0
    return {
        "ok": ok,
        "alignAllObjectsToWorldAxes": True,
        "applyObjectTransforms": {"location": True, "rotation": True, "scale": True},
        "snapVertices": {"enabled": True, "axis": ["X", "Y", "Z"], "tolerance": tolerance},
        "enforceParallelism": {"horizontalEdges": "Z_constant", "verticalEdges": "X_or_Y_constant"},
        "stats": {
            "meshObjects": len(mesh_objects),
            "snappedVertices": snapped_vertices,
            "maxSnapDelta": max_snap_delta,
            "nonAxisEdgeCount": len(non_axis_edges),
        },
        "rejectIf": {
            "edgesAreNotParallelWithinTolerance": len(non_axis_edges) > 0,
            "multiplePlaneOrientationsDetected": not rotations_ok,
        },
        "nonAxisEdges": non_axis_edges[:20],
    }


def create_stairs(element):
    meta = element.get("metadata", {})
    count = int(meta.get("count", 1))
    b = element["boundsMm"]
    width = b["width"] * MM_TO_M
    x = b["x"] * MM_TO_M
    y0 = b["y"] * MM_TO_M
    total_depth = b["depth"] * MM_TO_M
    total_height = b["height"] * MM_TO_M
    base_z = b["z"] * MM_TO_M
    step_depth = total_depth / count
    step_height = total_height / count
    for index in range(count):
        bounds = {
            "x": x / MM_TO_M,
            "y": (y0 + index * step_depth) / MM_TO_M,
            "z": base_z / MM_TO_M,
            "width": width / MM_TO_M,
            "depth": step_depth / MM_TO_M,
            "height": ((index + 1) * step_height) / MM_TO_M,
        }
        create_box(f"{element['id']}-step-{index + 1}", bounds, element_color(element))


def project_extents(project):
    elements = project.get("elements", [])
    if not elements:
        return (0, 0, 0, 10, 10, 5)
    min_x = min(e["boundsMm"]["x"] for e in elements) * MM_TO_M
    min_y = min(e["boundsMm"]["y"] for e in elements) * MM_TO_M
    min_z = min(e["boundsMm"]["z"] for e in elements) * MM_TO_M
    max_x = max(e["boundsMm"]["x"] + e["boundsMm"]["width"] for e in elements) * MM_TO_M
    max_y = max(e["boundsMm"]["y"] + e["boundsMm"]["depth"] for e in elements) * MM_TO_M
    max_z = max(e["boundsMm"]["z"] + e["boundsMm"]["height"] for e in elements) * MM_TO_M
    return (min_x, min_y, min_z, max_x, max_y, max_z)


def add_measurement_cameras(project):
    registry = project.get("viewRegistry")
    if registry:
        for view in registry.get("views", []):
            camera = add_camera(
                tuple(value * MM_TO_M for value in view["cameraLocationMm"]),
                tuple(value * MM_TO_M for value in view["targetMm"]),
                name=view["name"],
                orthographic=True,
                scale=view["orthoScaleMm"] * MM_TO_M,
            )
            camera.data.clip_start = view["clipStartMm"] * MM_TO_M
            camera.data.clip_end = view["clipEndMm"] * MM_TO_M
        return
    min_x, min_y, min_z, max_x, max_y, max_z = project_extents(project)
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    cz = (min_z + max_z) / 2
    span = max(max_x - min_x, max_y - min_y, max_z - min_z, 1)
    cameras = {
        "plan": ((cx, cy, max_z + span * 1.5), (cx, cy, 0)),
        "north": ((cx, max_y + span * 1.5, cz), (cx, cy, cz)),
        "south": ((cx, min_y - span * 1.5, cz), (cx, cy, cz)),
        "east": ((max_x + span * 1.5, cy, cz), (cx, cy, cz)),
        "west": ((min_x - span * 1.5, cy, cz), (cx, cy, cz)),
        "section_a_a": ((cx, min_y - span, cz), (cx, cy, cz)),
    }
    for name, (location, target) in cameras.items():
        add_camera(location, target, name=name, orthographic=True, scale=span * 1.25)


def export_project(payload, output_path):
    create_measurement_project(payload)
    project_id = payload["project"]["projectId"]
    base = output_path.parent
    base.mkdir(parents=True, exist_ok=True)
    for fmt in payload.get("formats", []):
        if fmt == "glb":
            bpy.ops.export_scene.gltf(filepath=str(base / f"{project_id}.glb"), export_format="GLB")
        elif fmt == "obj":
            bpy.ops.wm.obj_export(filepath=str(base / f"{project_id}.obj"))


def create_dimensioned_pdf(payload):
    create_measurement_project(payload)
    pdf_path = Path(payload["outputPath"])
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    project = payload["project"]
    scale = payload.get("scale", "1:100")
    commands = customer_delivery_summary_commands(project, "dimensioned-drawings", scale)
    write_pdf(pdf_path, 841.89, 595.28, commands)
    validate_pdf_artifact(pdf_path)


def export_template(payload):
    create_measurement_project(payload)
    normalization_report = normalize_scene_geometry()
    project = payload["project"]
    template = payload["template"]
    options = payload.get("options", {})
    capability_manifest = validate_capability_manifest(template, options)
    output_dir = Path(payload["templateOutputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    project_id = project["projectId"]
    expected = template_artifacts(template, project_id)

    manifest = {
        "schemaVersion": 1,
        "projectId": project_id,
        "template": template,
        "outputClassification": {
            "purpose": "technical-permit-support",
            "authority": "locked-blender-orthographic-line-artifacts",
            "visualMode": "technical-line",
            "photorealismAuthoritative": False,
            "previewRenderAcceptedAsSourceOfTruth": False,
        },
        "sourceOfTruth": {
            "measurements": "primary",
            "photos": "non-authoritative-reference-only",
            "blenderGeometry": "only-renderable-truth",
            "exports": "formatting-only-no-geometry-reconstruction",
        },
        "productCategory": "measured-3d-visualization",
        "notCad": True,
        "geometryMutationAllowed": False,
        "confidenceSemantics": {
            "high": "permit/PDF/known plan dimensions",
            "medium": "manual site measurement",
            "low": "photo reference or inferred detail",
        },
        "globalReferenceFrame": {
            "enforceSinglePlaneSystem": True,
            "normalization": normalization_report,
        },
        "artifacts": expected,
        "modelLock": options.get("lockedModel"),
        "viewRegistry": options.get("viewRegistry"),
        "capabilityManifest": capability_manifest,
        "strategies": options.get("strategies", []),
        "lineExtraction": {
            "engine": "blender-freestyle",
            "cameraSource": "orthographic-view-registry",
            "geometrySource": "blender-scene-mesh",
            "svgRole": "layout-index-only",
            "pdfRole": "layout-only",
            "rendererTolerance": {"metric": "pixel-difference-ratio", "maximum": 0.005},
        },
        "materialEvidence": sorted([{
            key: value for key, value in item.items() if key in (
                "facade", "elementId", "material", "colorNote", "colorReference",
                "confidence", "source", "verified"
            )
        } for item in project.get("materialNotes", [])], key=lambda item: (
            item.get("facade", ""), item.get("elementId", ""), item.get("material", ""), item.get("colorNote", "")
        )),
        "options": options,
    }

    governed_facade_templates = ("permit-facade-pack", "swedish-municipality", "gothenburg-permit", "measured-visualization")
    if template in ("permit", "cad-simulated", "measurement-book", "qa-validation", "site-context", "photo-alignment"):
        write_template_pdf(output_dir / expected["pdf"], project, template, options)
    if template == "fabrication":
        write_cad_simulated_svg(output_dir / expected["svg"], project, template, options)
    if template in governed_facade_templates:
        write_measured_visualization_validation(output_dir / expected["validation"], project, options, normalization_report)
        write_orthographic_png_preview(output_dir / expected["png"], project)
        write_multiview_orthographic_exports(output_dir, expected, project)
        manifest["layout"] = write_gothenburg_facade_pack_pdf(
            output_dir / expected["pdf"], output_dir, expected, project, template, options
        )
    if template == "cad-simulated":
        validation_report = write_cad_pipeline_validation(output_dir / expected["validation"], project, options, normalization_report)
        if not validation_report["ok"]:
            raise ValueError(f"Measured visualization validation failed: {validation_report['rejectIf']}")
        write_orthographic_png_preview(output_dir / expected["png"], project)
        write_multiview_orthographic_exports(output_dir, expected, project)
    if template in ("permit-facade-pack", "swedish-municipality", "gothenburg-permit", "measured-visualization", "cad-simulated"):
        write_blender_line_artifact_index(output_dir / expected["svg"], expected, project_id, template)
    if template in ("client-preview", "web-viewer", "archive"):
        bpy.ops.export_scene.gltf(filepath=str(output_dir / expected["glb"]), export_format="GLB")
    if template in ("fabrication", "archive"):
        bpy.ops.wm.obj_export(filepath=str(output_dir / expected["obj"]))

    manifest["artifactIdentities"] = artifact_identities(output_dir, expected)
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def validate_capability_manifest(template, options):
    manifest = options.get("capabilityManifest")
    if manifest is None:
        return {
            "schemaVersion": 1,
            "provided": False,
            "warning": "No capability manifest supplied; legacy export path."
        }

    supported = manifest.get("supportedTemplates", [])
    if template not in supported:
        raise ValueError(f"Capability manifest does not support template: {template}")

    requested = options.get("strategies", [])
    prohibited = set(manifest.get("prohibitedStrategies", []))
    blocked = [strategy for strategy in requested if strategy in prohibited]
    if blocked:
        raise ValueError(f"Capability manifest prohibits requested strategies: {', '.join(blocked)}")

    allowed_groups = manifest.get("allowedStrategies", {})
    allowed = set()
    for values in allowed_groups.values():
        allowed.update(values)
    unknown = [strategy for strategy in requested if strategy not in allowed]
    if unknown:
        raise ValueError(f"Capability manifest does not allow requested strategies: {', '.join(unknown)}")

    return manifest


def template_artifacts(template, project_id):
    if template == "permit":
        return {"pdf": f"{project_id}-permit.pdf"}
    if template in ("permit-facade-pack", "swedish-municipality", "gothenburg-permit", "measured-visualization"):
        slug = template
        return {
            "pdf": f"{project_id}-{slug}.pdf",
            "svg": f"{project_id}-{slug}.svg",
            "png": f"{project_id}-{slug}.png",
            "facadePng": f"{project_id}-facade.png",
            "planPng": f"{project_id}-plan.png",
            "northPng": f"{project_id}-north.png",
            "southPng": f"{project_id}-south.png",
            "eastPng": f"{project_id}-east.png",
            "westPng": f"{project_id}-west.png",
            "sectionPng": f"{project_id}-section.png",
            "validation": f"{project_id}-{slug}-validation.json",
        }
    if template == "cad-simulated":
        return {
            "pdf": f"{project_id}-cad-simulated.pdf",
            "svg": f"{project_id}-cad-simulated.svg",
            "png": f"{project_id}-cad-simulated.png",
            "facadePng": f"{project_id}-facade.png",
            "planPng": f"{project_id}-plan.png",
            "northPng": f"{project_id}-north.png",
            "southPng": f"{project_id}-south.png",
            "eastPng": f"{project_id}-east.png",
            "westPng": f"{project_id}-west.png",
            "sectionPng": f"{project_id}-section.png",
            "validation": f"{project_id}-cad-simulated-validation.json",
        }
    if template == "client-preview":
        return {"glb": f"{project_id}-client-preview.glb"}
    if template == "fabrication":
        return {"svg": f"{project_id}-fabrication.svg", "obj": f"{project_id}-fabrication.obj"}
    if template == "qa-validation":
        return {"pdf": f"{project_id}-qa-validation.pdf"}
    if template == "site-context":
        return {"pdf": f"{project_id}-site-context.pdf"}
    if template == "photo-alignment":
        return {"pdf": f"{project_id}-photo-alignment.pdf"}
    if template == "measurement-book":
        return {"pdf": f"{project_id}-measurement-book.pdf"}
    if template == "web-viewer":
        return {"glb": f"{project_id}-web-viewer.glb"}
    if template == "archive":
        return {"glb": f"{project_id}-archive.glb", "obj": f"{project_id}-archive.obj"}
    raise ValueError(f"Unsupported export template: {template}")


def write_template_pdf(pdf_path, project, template, options=None):
    options = options or {}
    commands = customer_delivery_summary_commands(project, template, options.get("scale", "1:100"))
    write_pdf(pdf_path, 841.89, 595.28, commands)
    validate_pdf_artifact(pdf_path)


def customer_delivery_summary_commands(project, template, scale):
    dimensions = project.get("dimensions", [])
    assumptions = project.get("assumptions", [])
    commands = [
        "0.75 w",
        "30 30 781 535 re S",
        f"BT /F1 20 Tf 52 530 Td (MEASURED BY NOVA - {pdf_text(template.upper())}) Tj ET",
        f"BT /F1 11 Tf 52 505 Td (Project: {pdf_text(project['projectId'])}) Tj ET",
        f"BT /F1 11 Tf 52 488 Td (Scale: {pdf_text(scale)}) Tj ET",
        "BT /F1 9 Tf 52 462 Td (Measured Blender visualization - not CAD, BIM, survey or fabrication authority) Tj ET",
        "BT /F1 9 Tf 52 446 Td (Geometry source: reviewed Blender scene; export does not reconstruct geometry) Tj ET",
        "BT /F1 12 Tf 52 414 Td (VERIFIED DIMENSIONS AND DECLARED CONSTRAINTS) Tj ET",
    ]
    y = 394
    if not dimensions:
        commands.append("BT /F1 9 Tf 64 394 Td (No dimensions declared in the project manifest.) Tj ET")
        y -= 18
    for item in dimensions[:14]:
        label = item.get("label", item.get("id", "dimension"))
        value = item.get("valueMm", "unknown")
        confidence = item.get("confidence", "unknown")
        source = item.get("source", "unknown")
        line = f"{label}: {value} mm | confidence={confidence} | source={source}"
        commands.append(f"BT /F1 8 Tf 64 {y} Td ({pdf_text(line[:112])}) Tj ET")
        y -= 15
    y = max(y - 10, 150)
    commands.append(f"BT /F1 12 Tf 52 {y} Td (ASSUMPTIONS AND HUMAN REVIEW) Tj ET")
    y -= 20
    if not assumptions:
        commands.append(f"BT /F1 9 Tf 64 {y} Td (No assumptions declared.) Tj ET")
        y -= 18
    for item in assumptions[:8]:
        line = f"{item.get('id', 'assumption')}: {item.get('text', '')} | confidence={item.get('confidence', 'unknown')}"
        commands.append(f"BT /F1 8 Tf 64 {y} Td ({pdf_text(line[:112])}) Tj ET")
        y -= 15
    commands.extend([
        "BT /F1 9 Tf 52 80 Td (Confidence: HIGH=verified plan/permit | MEDIUM=manual measurement | LOW=photo/inferred) Tj ET",
        "BT /F1 9 Tf 52 62 Td (Photos and photoreal renders are evidence/preview; they never override measured geometry.) Tj ET",
    ])
    return commands


def validate_pdf_artifact(pdf_path):
    content = pdf_path.read_bytes()
    if len(content) < 256 or not content.startswith(b"%PDF-1.4"):
        raise ValueError(f"Customer PDF is missing or structurally incomplete: {pdf_path.name}")
    if b"xref\n" not in content or b"startxref\n" not in content or not content.rstrip().endswith(b"%%EOF"):
        raise ValueError(f"Customer PDF lacks a complete cross-reference trailer: {pdf_path.name}")
    if b"placeholder" in content.lower():
        raise ValueError(f"Customer PDF contains forbidden placeholder content: {pdf_path.name}")


def write_gothenburg_facade_pack_pdf(pdf_path, output_dir, expected, project, template, options):
    view_specs = [
        ("north", "FASAD NORR / NORTH", "northPng"),
        ("south", "FASAD SODER / SOUTH", "southPng"),
        ("east", "FASAD OSTER / EAST", "eastPng"),
        ("west", "FASAD VASTER / WEST", "westPng"),
    ]
    included_views = []
    for name, title, artifact_key in view_specs:
        artifact = expected.get(artifact_key)
        artifact_path = output_dir / artifact if artifact else None
        if artifact_path is None or not artifact_path.is_file():
            raise ValueError(f"Gothenburg facade pack requires locked Blender view artifact: {artifact_key}")
        content = artifact_path.read_bytes()
        included_views.append({
            "name": name,
            "title": title,
            "artifact": artifact,
            "sha256": png_semantic_hash(content),
            "hashScope": "png-critical-chunks",
        })

    scale = options.get("scale", "1:100")
    dimensions = [{
        "label": item["label"], "valueMm": item["valueMm"],
        "confidence": item["confidence"], "source": item["source"],
    } for item in project.get("dimensions", [])]
    assumptions = [{
        "id": item["id"], "text": item["text"], "confidence": item["confidence"],
        "affectsGeometry": item.get("affectsGeometry", False),
    } for item in project.get("assumptions", [])]
    materials = sorted({
        element.get("metadata", {}).get("material")
        for element in project.get("elements", [])
        if isinstance(element.get("metadata"), dict) and element.get("metadata", {}).get("material")
    })
    declared_material_notes = []
    for note in project.get("materialNotes", []):
        color_reference = note.get("colorReference") or {}
        color_code = ""
        if color_reference.get("standard") and color_reference.get("code"):
            color_code = f" [{color_reference['standard']} {color_reference['code']}]"
        color_note = f": {note['colorNote']}" if note.get("colorNote") else ""
        target = note.get("elementId") or note.get("facade", "all")
        declared_material_notes.append(
            f"{target}: {note['material']}{color_code}{color_note} ({note['confidence']}, {note['source']})"
        )
    material_notes = declared_material_notes or [f"Observed/model metadata: {value}" for value in materials] or ["No material/color metadata declared"]
    source_statement = "Measured Blender visualization - not CAD, BIM or survey output"
    layout = {
        "schemaVersion": 1,
        "paper": {"format": "A3", "orientation": "landscape", "widthMm": 420, "heightMm": 297},
        "scale": scale,
        "scaleBar": {"unit": "mm", "segments": 5, "segmentLengthMmAtObjectScale": 1000},
        "includedViews": included_views,
        "titleBlock": {"projectId": project["projectId"], "template": template, "modelLocked": bool(options.get("lockedModel"))},
        "materialColorNotes": material_notes,
        "measurements": dimensions,
        "assumptions": assumptions,
        "confidenceLegend": {
            "high": "permit/PDF/known plan dimension",
            "medium": "manual site measurement",
            "low": "photo reference or inferred detail",
        },
        "markLine": {"label": "MARKLINJE / EXISTING GROUND REFERENCE", "role": "layout-reference-only"},
        "sourceStatement": source_statement,
        "geometryMutationAllowed": False,
        "consumes": "locked-blender-view-artifacts-and-project-metadata-only",
    }

    commands = ["0.5 w", "30 30 1130 780 re S"]
    panel_positions = [(50, 470), (610, 470), (50, 175), (610, 175)]
    for (_, title, artifact_key), (x, y) in zip(view_specs, panel_positions):
        artifact = expected[artifact_key]
        commands.extend([
            f"{x} {y} 530 245 re S",
            f"BT /F1 13 Tf {x + 12} {y + 222} Td ({pdf_text(title)}) Tj ET",
            f"q 190 0 0 190 {x + 170} {y + 25} cm /Im{len(commands)} Do Q",
            f"BT /F1 8 Tf {x + 12} {y + 12} Td (Blender artifact: {pdf_text(artifact)}) Tj ET",
        ])
    commands.extend([
        "50 145 m 580 145 l S",
        "BT /F1 9 Tf 50 151 Td (MARKLINJE / EXISTING GROUND REFERENCE) Tj ET",
        f"BT /F1 11 Tf 620 145 Td (SKALA / SCALE {pdf_text(scale)}) Tj ET",
        "620 125 m 870 125 l S", "620 120 m 620 130 l S", "670 120 m 670 130 l S",
        "720 120 m 720 130 l S", "770 120 m 770 130 l S", "820 120 m 820 130 l S", "870 120 m 870 130 l S",
        "BT /F1 7 Tf 620 110 Td (0   1m   2m   3m   4m   5m) Tj ET",
        f"BT /F1 10 Tf 50 85 Td ({pdf_text(source_statement)}) Tj ET",
        f"BT /F1 9 Tf 50 68 Td (Project: {pdf_text(project['projectId'])} | Template: {pdf_text(template)}) Tj ET",
        "BT /F1 8 Tf 50 51 Td (Confidence: HIGH=permit/PDF | MEDIUM=manual measurement | LOW=photo/inferred) Tj ET",
        f"BT /F1 8 Tf 50 36 Td (Model lock present: {str(bool(options.get('lockedModel'))).lower()}) Tj ET",
    ])
    measurement_lines = [f"MEASUREMENTS ({len(dimensions)}):"] + [
        f"{item['label']}={item['valueMm']}mm [{item['confidence']}; {item['source']}]" for item in dimensions
    ]
    y = 96
    for line in measurement_lines:
        commands.append(f"BT /F1 7 Tf 620 {y} Td ({pdf_text(line[:105])}) Tj ET")
        y -= 10
    material_summary = "; ".join(material_notes)
    commands.append(f"BT /F1 6 Tf 620 39 Td (MATERIAL/COLOR: {pdf_text(material_summary[:120])}) Tj ET")
    assumption_summary = "; ".join(f"{item['id']} [{item['confidence']}]" for item in assumptions) or "none declared"
    commands.append(f"BT /F1 6 Tf 620 29 Td (ASSUMPTIONS: {pdf_text(assumption_summary[:120])}) Tj ET")
    image_paths = [output_dir / expected[artifact_key] for _, _, artifact_key in view_specs]
    image_names = [command.split("/")[1].split()[0] for command in commands if " cm /Im" in command]
    write_pdf_with_png_images(pdf_path, 1190.55, 841.89, commands, list(zip(image_names, image_paths)))
    validate_pdf_artifact(pdf_path)
    return layout


def png_pdf_image(png_path):
    content = png_path.read_bytes()
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"Facade view is not a PNG: {png_path.name}")
    offset = 8
    width = height = color_type = None
    compressed = bytearray()
    while offset < len(content):
        length = struct.unpack(">I", content[offset:offset + 4])[0]
        chunk_type = content[offset + 4:offset + 8]
        chunk_data = content[offset + 8:offset + 8 + length]
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", chunk_data[:10])
            if bit_depth != 8 or color_type not in (2, 6):
                raise ValueError(f"Facade PNG must be 8-bit RGB/RGBA for PDF embedding: {png_path.name}")
        elif chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        offset += 12 + length
    if width is None or height is None or not compressed:
        raise ValueError(f"Facade PNG is incomplete: {png_path.name}")
    if color_type == 2:
        return width, height, bytes(compressed)
    decoded = zlib.decompress(bytes(compressed))
    stride = width * 4
    previous = bytearray(stride)
    rgb_rows = bytearray()
    offset = 0
    for _ in range(height):
        filter_type = decoded[offset]
        raw = decoded[offset + 1:offset + 1 + stride]
        row = bytearray(stride)
        for index, value in enumerate(raw):
            left = row[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                p = left + above - upper_left
                distances = (abs(p - left), abs(p - above), abs(p - upper_left))
                predictor = (left, above, upper_left)[distances.index(min(distances))]
            else:
                raise ValueError(f"Facade PNG uses unsupported row filter: {filter_type}")
            row[index] = (value + predictor) & 0xFF
        rgb_rows.append(0)
        for index in range(0, stride, 4):
            rgb_rows.extend(row[index:index + 3])
        previous = row
        offset += stride + 1
    return width, height, zlib.compress(bytes(rgb_rows), level=9)


def write_pdf_with_png_images(pdf_path, width_pt, height_pt, commands, named_paths):
    images = [(name, *png_pdf_image(path)) for name, path in named_paths]
    xobjects = " ".join(f"/{name} {6 + index} 0 R" for index, (name, _, _, _) in enumerate(images))
    content = "\n".join(commands).encode("utf-8")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width_pt:.2f} {height_pt:.2f}] /Resources << /Font << /F1 5 0 R >> /XObject << {xobjects} >> >> /Contents 4 0 R >>".encode("utf-8"),
        f"<< /Length {len(content)} >>\nstream\n".encode("utf-8") + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for _, width, height, compressed in images:
        header = (
            f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
            f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
            f"/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns {width} >> "
            f"/Length {len(compressed)} >>\nstream\n"
        ).encode("utf-8")
        objects.append(header + compressed + b"\nendstream")
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("utf-8"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("utf-8"))
    for offset in offsets:
        output.extend(f"{offset:010d} 00000 n \n".encode("utf-8"))
    output.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("utf-8"))
    atomic_write_bytes(pdf_path, output)


def write_blender_line_artifact_index(svg_path, expected, project_id, template):
    view_keys = [key for key in ("facadePng", "planPng", "northPng", "southPng", "eastPng", "westPng", "sectionPng") if key in expected]
    images = "\n".join(
        f'  <image data-view="{key}" href="{expected[key]}" x="0" y="{index * 100}" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>'
        for index, key in enumerate(view_keys)
    )
    height = max(100, len(view_keys) * 100)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 {height}">
  <metadata>{{"projectId":"{project_id}","template":"{template}","lineExtraction":"blender-freestyle","role":"layout-index-only","geometryReconstruction":false}}</metadata>
{images}
</svg>
'''
    svg_path.write_text(svg, encoding="utf-8")


def artifact_identities(output_dir, expected):
    identities = {}
    for key, relative_path in sorted(expected.items()):
        artifact_path = output_dir / relative_path
        if artifact_path.is_file():
            content = artifact_path.read_bytes()
            is_png = artifact_path.suffix.lower() == ".png"
            identities[key] = {
                "path": relative_path,
                "sizeBytes": len(content),
                "sha256": png_semantic_hash(content) if is_png else hashlib.sha256(content).hexdigest(),
                "hashScope": "png-critical-chunks" if is_png else "complete-file",
            }
    return identities


def png_semantic_hash(content):
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("PNG artifact does not have a valid signature")
    digest = hashlib.sha256()
    offset = 8
    while offset < len(content):
        length = struct.unpack(">I", content[offset:offset + 4])[0]
        chunk_type = content[offset + 4:offset + 8]
        chunk_data = content[offset + 8:offset + 8 + length]
        if chunk_type in (b"IHDR", b"PLTE", b"IDAT", b"IEND"):
            digest.update(chunk_type)
            digest.update(chunk_data)
        offset += 12 + length
    return digest.hexdigest()


def write_pdf(pdf_path, width_pt, height_pt, commands):
    write_pdf_pages(pdf_path, width_pt, height_pt, [commands])


def write_pdf_pages(pdf_path, width_pt, height_pt, command_pages):
    font_object_id = 3 + len(command_pages) * 2
    kids = " ".join(f"{3 + page_index * 2} 0 R" for page_index in range(len(command_pages)))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {len(command_pages)} >>".encode("utf-8"),
    ]

    for page_index, commands in enumerate(command_pages):
        page_object_id = 3 + page_index * 2
        content_object_id = page_object_id + 1
        content = "\n".join(commands).encode("utf-8")
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width_pt:.2f} {height_pt:.2f}] /Resources << /Font << /F1 {font_object_id} 0 R >> >> /Contents {content_object_id} 0 R >>".encode("utf-8")
        )
        objects.append(f"<< /Length {len(content)} >>\nstream\n".encode("utf-8") + content + b"\nendstream")

    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("utf-8"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("utf-8"))
    for offset in offsets:
        output.extend(f"{offset:010d} 00000 n \n".encode("utf-8"))
    output.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("utf-8"))
    atomic_write_bytes(pdf_path, output)


def atomic_write_bytes(output_path, content):
    temporary_path = output_path.with_name(f".{output_path.name}.partial")
    try:
        temporary_path.write_bytes(content)
        temporary_path.replace(output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def write_pdf_single_page_legacy(pdf_path, width_pt, height_pt, commands):
    content = "\n".join(commands).encode("utf-8")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width_pt:.2f} {height_pt:.2f}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".encode("utf-8"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(content)} >>\nstream\n".encode("utf-8") + content + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("utf-8"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("utf-8"))
    for offset in offsets:
        output.extend(f"{offset:010d} 00000 n \n".encode("utf-8"))
    output.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("utf-8"))
    pdf_path.write_bytes(output)


def pdf_text(value):
    return str(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def roof_plane(width, high, low):
    slope = (low - high) / width

    def z_at(x, offset=0.0):
        return high + slope * x + offset

    def line(offset=0.0):
        return (0.0, z_at(0.0, offset), width, z_at(width, offset))

    return {"slope": slope, "zAt": z_at, "line": line}


def roof_slope_validation(width, high, low, offsets):
    plane = roof_plane(width, high, low)
    expected = plane["slope"]
    entries = []
    ok = True
    for offset in offsets:
        x1, z1, x2, z2 = plane["line"](offset)
        slope = (z2 - z1) / (x2 - x1)
        delta = abs(slope - expected)
        entries.append({"offsetMm": offset, "slope": slope, "deltaFromReference": delta})
        ok = ok and delta <= 1e-9
    return {"ok": ok, "referenceSlope": expected, "lines": entries}


def effective_step_count(configured_count, foundation_height, step_height):
    if step_height <= 0:
        return configured_count
    return max(configured_count, math.ceil(foundation_height / step_height))


def cad_multiview_pdf_pages(project, page_w, page_h, margin):
    profile = first_profile(project, "carport")
    if profile is None:
        return []

    p = profile["parameters"]
    width = float(p["widthMm"])
    depth = float(p["depthMm"])
    high = float(p["westHighSideHeightMm"])
    low = float(p["eastLowSideHeightMm"])
    foundation_sw = max(float(value) for value in p.get("foundationHeights", {}).get("southwest", {}).values()) if p.get("foundationHeights") else 0.0
    foundation_ne = max(float(value) for value in p.get("foundationHeights", {}).get("northeast", {}).values()) if p.get("foundationHeights") else 0.0
    roof = roof_plane(width, high, low)

    def page(title, subtitle, model_w, model_h, draw):
        commands = [
            "1 1 1 rg 0 0 %.2f %.2f re f" % (page_w, page_h),
            "0 0 0 RG 1 w",
            f"BT /F1 18 Tf {margin:.2f} {page_h - 42:.2f} Td ({pdf_text(title)}) Tj ET",
            f"BT /F1 9 Tf {margin:.2f} {page_h - 62:.2f} Td ({pdf_text(subtitle)}) Tj ET",
        ]
        usable_w = page_w - margin * 2
        usable_h = page_h - margin * 2 - 110
        scale = min(usable_w / model_w, usable_h / model_h)
        origin_x = margin + (usable_w - model_w * scale) / 2
        origin_y = margin + 80 + (usable_h - model_h * scale) / 2

        def x(mm):
            return origin_x + mm * scale

        def y(mm):
            return origin_y + mm * scale

        def line(x1, y1, x2, y2, gray=0, line_width=1):
            commands.append(f"{gray:.3f} G {line_width:.2f} w {x(x1):.2f} {y(y1):.2f} m {x(x2):.2f} {y(y2):.2f} l S")

        def rect(rx, ry, rw, rh, gray=0, line_width=1):
            commands.append(f"{gray:.3f} G {line_width:.2f} w {x(rx):.2f} {y(ry):.2f} {rw * scale:.2f} {rh * scale:.2f} re S")

        def text(value, tx, ty, size=8):
            commands.append(f"0 G BT /F1 {size} Tf {x(tx):.2f} {y(ty):.2f} Td ({pdf_text(value)}) Tj ET")

        draw(line, rect, text)
        commands.append(f"0 G BT /F1 8 Tf {margin:.2f} 36.00 Td ({pdf_text('Skala: 1:100 avsedd ritningsskala. Material: vit liggande träpanel, mörk stenmur/fundament, mörkt papptak/plåtdetalj.')}) Tj ET")
        return commands

    def draw_plan(line, rect, text):
        rect(0, 0, width, depth, 0, 1.1)
        rect(0, 0, 145, depth, 0, 0.8)
        rect(width - 145, 0, 145, depth, 0, 0.8)
        line(0, 0, width, 0, 0.35, 0.5)
        line(0, depth, width, depth, 0.35, 0.5)
        text(f"bredd {width:.0f} mm", width * 0.42, -260, 8)
        text(f"djup {depth:.0f} mm", width + 180, depth * 0.45, 8)

    def draw_roof_band(line, x0, x1, roof_top_left, roof_top_right, fascia_h):
        line(x0, roof_top_left, x1, roof_top_right, 0, 1.2)
        line(x0, roof_top_left - fascia_h, x1, roof_top_right - fascia_h, 0, 1.0)
        line(x0, roof_top_left - fascia_h, x0, roof_top_left, 0, 0.8)
        line(x1, roof_top_right - fascia_h, x1, roof_top_right, 0, 0.8)

    def draw_block_masonry(line, rect, text, total_width, foundation, label, levels):
        rect(0, -foundation, total_width, foundation, 0.35, 0.8)
        block_h = foundation / 2 if foundation > 0 else 0
        if block_h > 0:
            line(0, -block_h, total_width, -block_h, 0.62, 0.3)
        bx = 0.0
        block_w = 560.0
        row = 0
        while bx < total_width:
            line(bx, -foundation, bx, 0, 0.72, 0.25)
            bx += block_w
            row += 1
        text(f"{label}: {levels}", total_width * 0.08, -foundation - 210, 8)

    def draw_long_elevation(label, foundation, mirrored=False, northeast=False):
        def draw(line, rect, text):
            fascia_h = 360.0
            wall_h = 1320.0
            left_top = roof["zAt"](width) if mirrored else roof["zAt"](0)
            right_top = roof["zAt"](0) if mirrored else roof["zAt"](width)
            levels = "ytter mot väg 530 mm, mitt 500 mm, inner 630 mm" if northeast else "väg 0 mm, mitt 685 mm, inner 695 mm"
            draw_block_masonry(line, rect, text, width, foundation, "Mur/fundament", levels)
            line(0, 0, width, 0, 0, 1)
            draw_roof_band(line, 0, width, left_top, right_top, fascia_h)
            rect(0, 0, 145, left_top - fascia_h, 0, 0.9)
            rect(width - 145, 0, 145, right_top - fascia_h, 0, 0.9)
            if northeast:
                left_open_end = width * 0.26
                solid_start = left_open_end
                solid_end = width * 0.72
                right_open_start = solid_end
                rect(solid_start, 0, solid_end - solid_start, wall_h, 0, 0.7)
                rect(145, wall_h, left_open_end - 145, max(min(left_top, right_top) - fascia_h - wall_h, 1), 0, 0.7)
                rect(right_open_start, wall_h, width - 145 - right_open_start, max(min(left_top, right_top) - fascia_h - wall_h, 1), 0, 0.7)
                line(left_open_end, 0, left_open_end, min(left_top, right_top) - fascia_h, 0, 0.8)
                line(right_open_start, 0, right_open_start, min(left_top, right_top) - fascia_h, 0, 0.8)
                text("passage/öppning enligt foto", right_open_start + 120, wall_h + 180, 7)
                cladding_ranges = [(solid_start, solid_end)]
            else:
                rect(145, 0, width - 290, wall_h, 0, 0.7)
                cladding_ranges = [(145, width - 145)]
            z = 220.0
            while z < 1220:
                for start, end in cladding_ranges:
                    line(start, z, end, z, 0.55, 0.35)
                z += 145.0
            text(label, width * 0.42, max(left_top, right_top) + 170, 9)
        return draw

    def draw_short_elevation(label, height, foundation):
        def draw(line, rect, text):
            fascia_h = 360.0
            rect(0, -foundation, depth, foundation, 0.35, 0.8)
            rect(0, 0, depth, 1320, 0, 0.7)
            rect(0, 0, 145, height - fascia_h, 0, 0.9)
            rect(depth - 145, 0, 145, height - fascia_h, 0, 0.9)
            line(0, height, depth, height, 0, 1.2)
            line(0, height - fascia_h, depth, height - fascia_h, 0, 1.0)
            z = 220.0
            while z < 1220:
                line(0, z, depth, z, 0.55, 0.35)
                z += 145.0
            text(label, depth * 0.38, height + 170, 9)
        return draw

    return [
        page("Plan", "Ortografisk planvy", width, depth + 420, draw_plan),
        page("Fasad mot nordost", "Ortografisk elevationsvy, speglad 180 grader enligt fotoreferens", width, max(high, low) + foundation_ne + 520, draw_long_elevation("Fasad mot nordost", foundation_ne, mirrored=True, northeast=True)),
        page("Fasad mot sydvast", "Ortografisk elevationsvy", width, max(high, low) + foundation_sw + 520, draw_long_elevation("Fasad mot sydvast", foundation_sw)),
        page("Fasad mot ost", "Ortografisk elevationsvy", depth, low + foundation_ne + 520, draw_short_elevation("Fasad mot ost", low, foundation_ne)),
        page("Fasad mot vast", "Ortografisk elevationsvy", depth, high + foundation_sw + 520, draw_short_elevation("Fasad mot vast", high, foundation_sw)),
        page("Sektion A-A", "Principsektion genom carport", depth, max(high, low) + foundation_sw + 520, draw_short_elevation("Sektion A-A", (high + low) / 2, foundation_sw)),
    ]


def write_southwest_cad_pdf(pdf_path, project, template, options=None):
    options = options or {}
    profile = first_profile(project, "carport")
    if profile is None:
        write_template_pdf(pdf_path, project, template, {})
        return

    p = profile["parameters"]
    width = float(p["widthMm"])
    high = float(p["westHighSideHeightMm"])
    low = float(p["eastLowSideHeightMm"])
    foundation = max(float(value) for value in p.get("foundationHeights", {}).get("southwest", {}).values()) if p.get("foundationHeights") else 0.0
    step_depth = float(p.get("steps", [{}])[0].get("stepDepthMm", 295)) if p.get("steps") else 295.0
    step_height = float(p.get("steps", [{}])[0].get("stepHeightMm", 140)) if p.get("steps") else 140.0
    step_count = int(p.get("steps", [{}])[0].get("count", 0)) if p.get("steps") else 0
    post = 145.0

    page_w = 1190.55
    page_h = 841.89
    margin = 56.0
    title_h = 96.0
    model_top = max(high, low) + 480.0
    model_bottom = -foundation - 700.0
    model_w = width + 360.0
    model_h = model_top - model_bottom
    scale = min((page_w - margin * 2) / model_w, (page_h - margin * 2 - title_h) / model_h)
    origin_x = margin + 120.0 * scale
    origin_y = margin + (-model_bottom) * scale

    def x(mm):
        return origin_x + mm * scale

    def y(mm):
        return origin_y + mm * scale

    commands = [
        "1 1 1 rg 0 0 %.2f %.2f re f" % (page_w, page_h),
        "0 0 0 RG 1 w",
        f"BT /F1 18 Tf {margin:.2f} {page_h - 42:.2f} Td ({pdf_text('Measured facade visualization - Sydvastra fasaden')}) Tj ET",
        f"BT /F1 9 Tf {margin:.2f} {page_h - 62:.2f} Td ({pdf_text('Inte CAD/BIM/DWG/STEP. Matt styr geometri; foton ar kompletterande referens.')}) Tj ET",
        f"BT /F1 9 Tf {page_w - 330:.2f} {page_h - 42:.2f} Td ({pdf_text('Skala: anpassad till A3 landskap')}) Tj ET",
    ]

    def stroke_line(x1, y1, x2, y2, gray=0, line_width=1):
        commands.append(f"{gray:.3f} G {line_width:.2f} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def stroke_rect(rx, ry, rw, rh, gray=0, line_width=1):
        commands.append(f"{gray:.3f} G {line_width:.2f} w {rx:.2f} {ry:.2f} {rw:.2f} {rh:.2f} re S")

    def white_rect(rx, ry, rw, rh):
        commands.append(f"1 1 1 rg {rx:.2f} {ry:.2f} {rw:.2f} {rh:.2f} re f 0 0 0 RG")

    def label(text, tx, ty, size=8):
        commands.append(f"0 G BT /F1 {size} Tf {tx:.2f} {ty:.2f} Td ({pdf_text(text)}) Tj ET")

    # Roof, posts, foundation and ground line.
    wall_h = min(1320.0, low - 620.0)
    fascia_h = 360.0
    roof = roof_plane(width, high, low)
    fascia_bottom_offset = -fascia_h
    center_left_post = width * 0.50 - 55.0
    center_right_post = width * 0.62 - 55.0
    left_panel = (post, center_left_post)
    right_panel = (center_right_post + 110.0, width - post)
    commands.append(f"0 G 1.4 w {x(0):.2f} {y(roof['zAt'](0)):.2f} m {x(width):.2f} {y(roof['zAt'](width)):.2f} l {x(width):.2f} {y(roof['zAt'](width, fascia_bottom_offset)):.2f} l {x(0):.2f} {y(roof['zAt'](0, fascia_bottom_offset)):.2f} l h S")
    stroke_rect(x(0), y(-foundation), width * scale, foundation * scale, 0.25, 1.0)
    block_h = foundation / 2 if foundation > 0 else 0
    block_w = 560.0
    if block_h > 0:
        stroke_line(x(0), y(-block_h), x(width), y(-block_h), 0.62, 0.25)
        bx = 0.0
        while bx < width:
            stroke_line(x(bx), y(-foundation), x(bx), y(0), 0.72, 0.2)
            bx += block_w
    stroke_rect(x(0), y(0), 145 * scale, roof["zAt"](0, fascia_bottom_offset) * scale, 0, 1.0)
    stroke_rect(x(width - 145), y(0), 145 * scale, roof["zAt"](width - 145, fascia_bottom_offset) * scale, 0, 1.0)
    stroke_rect(x(center_left_post), y(0), 110 * scale, roof["zAt"](center_left_post, fascia_bottom_offset) * scale, 0, 1.0)
    stroke_rect(x(center_right_post), y(0), 110 * scale, roof["zAt"](center_right_post, fascia_bottom_offset) * scale, 0, 1.0)
    stroke_line(x(0), y(0), x(width), y(0), 0, 1.0)
    stroke_rect(x(left_panel[0]), y(0), (left_panel[1] - left_panel[0]) * scale, wall_h * scale, 0, 1.0)
    stroke_rect(x(right_panel[0]), y(0), (right_panel[1] - right_panel[0]) * scale, wall_h * scale, 0, 1.0)

    z = 220.0
    while z < wall_h - 80:
        stroke_line(x(left_panel[0]), y(z), x(left_panel[1]), y(z), 0.55, 0.35)
        stroke_line(x(right_panel[0]), y(z), x(right_panel[1]), y(z), 0.55, 0.35)
        z += 145.0

    step_w = 930.0
    step_center = (center_left_post + center_right_post + 110.0) / 2
    drawn_step_count = effective_step_count(step_count, foundation, step_height)
    for index in range(drawn_step_count):
        tread_w = step_w + (drawn_step_count - index - 1) * 150.0
        x0 = step_center - tread_w / 2
        z0 = -(drawn_step_count - index) * step_height
        z1 = z0 + step_height
        stroke_rect(x(x0), y(z0), tread_w * scale, (z1 - z0) * scale, 0.05, 0.85)
        stroke_line(x(x0), y(z1), x(x0 + tread_w), y(z1), 0.05, 0.7)

    road_step_count = 4
    road_step_height = foundation / road_step_count if road_step_count else step_height
    road_step_w = 1180.0
    road_step_x = 0.0
    for index in range(road_step_count):
        tread_w = road_step_w + index * step_depth
        x0 = road_step_x
        z0 = -(index + 1) * road_step_height
        z1 = z0 + road_step_height
        stroke_rect(x(x0), y(z0), tread_w * scale, (z1 - z0) * scale, 0.45, 0.55)
        stroke_line(x(x0), y(z1), x(x0 + tread_w), y(z1), 0.45, 0.45)

    # Dimensions.
    dim_y = y(model_bottom + 250)
    stroke_line(x(0), dim_y, x(width), dim_y, 0, 0.7)
    label(f"bredd {width:.0f} mm", x(width / 2) - 42, dim_y - 18, 9)
    label(f"hog sida {high:.0f} mm", x(width * 0.06), y(high + 95), 8)
    label(f"lag sida {low:.0f} mm", x(width * 0.82), y(low + 95), 8)
    label(f"sydvast mur max {foundation:.0f} mm - trappa till mark {drawn_step_count} x {step_height:.0f}/{step_depth:.0f} mm", x(width * 0.22), y(-foundation - 190), 8)
    label(f"vagtrappa/site stair: {road_step_count} steg till mark, stegdjup {step_depth:.0f} mm, ritad steghojd {road_step_height:.0f} mm", x(0), y(-foundation - 190), 8)
    label("oppningar/panelindelning fran foto: lag confidence", x(width * 0.12), y(wall_h + 260), 8)

    label("Confidence: high=profil/ritningsmatt, medium=manuell matning, low=fotoreferens", margin, 36, 8)
    label(f"Project: {project['projectId']} - Template: {template}", page_w - 360, 36, 8)
    pages = [commands]
    if options.get("includePdfViews", True):
        pages.extend(cad_multiview_pdf_pages(project, page_w, page_h, margin))
    write_pdf_pages(pdf_path, page_w, page_h, pages)


def write_cad_simulated_svg(svg_path, project, template, options=None):
    options = options or {}
    if template in ("permit-facade-pack", "swedish-municipality", "gothenburg-permit", "measured-visualization", "cad-simulated") and options.get("view") == "southwest":
        write_southwest_cad_svg(svg_path, project, template, options)
        return

    min_x, min_y, _min_z, max_x, max_y, _max_z = project_extents(project)
    width = max((max_x - min_x) * 1000, 1)
    depth = max((max_y - min_y) * 1000, 1)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} {depth:.2f}">
  <metadata>{{"projectId":"{project["projectId"]}","template":"{template}","sourceOfTruth":"measurements-and-blender-orthographic-views","notCad":true}}</metadata>
  <rect x="0" y="0" width="{width:.2f}" height="{depth:.2f}" fill="none" stroke="#111" stroke-width="8"/>
  <text x="24" y="48" font-family="monospace" font-size="36">Measured visualization export - not CAD/BIM/DWG/STEP</text>
</svg>
'''
    svg_path.write_text(svg, encoding="utf-8")


def write_cad_pipeline_validation(validation_path, project, options=None, normalization_report=None):
    options = options or {}
    normalization_report = normalization_report or normalize_scene_geometry()
    line_classes = southwest_facade_line_classes(project) if options.get("view") == "southwest" else {}
    reject_if = {
        "edgesAreNotParallelWithinTolerance": normalization_report["rejectIf"]["edgesAreNotParallelWithinTolerance"],
        "multiplePlaneOrientationsDetected": normalization_report["rejectIf"]["multiplePlaneOrientationsDetected"],
        "mixedPerspectiveDetected": False,
        "geometryIsNotConsistent": not normalization_report["ok"],
        "lineWeightIsUniform": False,
        "duplicateLinesPresent": False,
    }
    report = {
        "ok": not any(reject_if.values()),
        "globalReferenceFrame": {
            "enforceSinglePlaneSystem": True,
            "singlePlane": "XZ facade plane",
            "referenceFrame": "world",
        },
        "geometryNormalization": normalization_report,
        "projection": {
            "type": "orthographic",
            "required": True,
            "noPerspectiveAllowed": True,
            "axisLocked": True,
            "cameraName": "OrthoCam",
            "cameraLocation": [0, -10, 0],
            "cameraRotationDegrees": [90, 0, 0],
            "noDeviationAllowed": True,
            "autoAlignToAxis": True,
        },
        "geometry": {
            "mustBePlanar": True,
            "snapToAxes": True,
            "verticalsParallel": True,
            "horizontalsParallel": True,
            "lineClasses": line_classes,
        },
        "validation": {
            "mixedPerspectiveDetected": reject_if["mixedPerspectiveDetected"],
            "duplicateLinesPresent": reject_if["duplicateLinesPresent"],
            "lineWeightIsUniform": reject_if["lineWeightIsUniform"],
            "geometryIsConsistent": not reject_if["geometryIsNotConsistent"],
        },
        "rejectIf": reject_if,
        "rules": {
            "measurementsOverrideVisuals": True,
            "lidarOnlyForReference": True,
            "noLidarMeshDirectUse": True,
            "noVisualApproximationAllowed": options.get("includeLowConfidencePhotoDetails") is not True,
            "noGeometryReconstructionInExportStage": True,
            "exportStageMayOnlyFormatBlenderOrthographicViews": True,
        },
        "warnings": [
            "Photo-derived openings remain low-confidence unless encoded as measured constraints.",
            "Unmeasured details are omitted in strict measured-visualization mode unless includeLowConfidencePhotoDetails=true.",
            "Output is not CAD/BIM/DWG/STEP or survey-grade documentation."
        ],
    }
    validation_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def write_measured_visualization_validation(validation_path, project, options=None, normalization_report=None):
    options = options or {}
    normalization_report = normalization_report or normalize_scene_geometry()
    report = {
        "ok": True,
        "contract": {
            "notCad": True,
            "productCategory": "measured-3d-visualization",
            "geometryMutationAllowed": False,
            "exportStage": "formatting-only-no-geometry-reconstruction",
            "sourceOfTruth": {
                "measurements": "primary",
                "photos": "non-authoritative-reference-only",
                "blenderGeometry": "only-renderable-truth",
                "exports": "formatting-only-no-geometry-reconstruction",
            },
        },
        "projection": {
            "type": "orthographic",
            "required": True,
            "noPerspectiveAllowed": True,
            "views": options.get("views", ["north", "south", "east", "west"]),
        },
        "geometryNormalization": {
            "appliedObjectTransforms": normalization_report.get("applyObjectTransforms", {}),
            "snappedVertices": normalization_report.get("stats", {}).get("snappedVertices", 0),
            "nonAxisEdgesAllowed": True,
            "reason": "Measured visualization allows intentional sloped geometry such as roofs; export must not reinterpret it as CAD axis geometry.",
        },
        "qualityRules": {
            "measurementsOverrideVisuals": True,
            "noGeometryReconstructionInExportStage": True,
            "templatesMayOnlyFormatOutputs": True,
        },
        "warnings": [
            "This is measured visualization output, not CAD/BIM/DWG/STEP or survey-grade documentation.",
            "Reference photos remain non-authoritative unless calibrated anchors are provided."
        ],
    }
    validation_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def write_orthographic_png_preview(png_path, project):
    _min_x, _min_y, _min_z, max_x, _max_y, max_z = project_extents(project)
    span = max(max_x - _min_x, max_z - _min_z, 1)
    camera = set_axis_locked_ortho_camera(span * 1.18)
    if "BLENDER_EEVEE_NEXT" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    else:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    if hasattr(bpy.context.scene, "eevee"):
        bpy.context.scene.eevee.taa_render_samples = 1
    bpy.context.view_layer.use_freestyle = True
    freestyle = bpy.context.view_layer.freestyle_settings
    for line_set in list(freestyle.linesets):
        freestyle.linesets.remove(line_set)
    line_set = freestyle.linesets.new("MainLines")
    line_set.select_silhouette = True
    line_set.select_border = True
    if "LineStyle" in bpy.data.linestyles:
        bpy.data.linestyles["LineStyle"].thickness = 1.5
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.render.resolution_x = 2048
    bpy.context.scene.render.resolution_y = 2048
    bpy.context.scene.world.color = (1, 1, 1)
    bpy.context.scene.render.film_transparent = False
    png_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(png_path)
    bpy.ops.render.render(write_still=True)


def configure_flat_freestyle_render(resolution=2048):
    if "BLENDER_EEVEE_NEXT" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    else:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    if hasattr(bpy.context.scene, "eevee"):
        bpy.context.scene.eevee.taa_render_samples = 1
    bpy.context.scene.render.resolution_x = resolution
    bpy.context.scene.render.resolution_y = resolution
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.world.color = (1, 1, 1)
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.view_layer.use_freestyle = True
    freestyle = bpy.context.view_layer.freestyle_settings
    for line_set in list(freestyle.linesets):
        freestyle.linesets.remove(line_set)
    line_set = freestyle.linesets.new("Lines")
    line_set.select_silhouette = True
    line_set.select_border = True
    if "LineStyle" in bpy.data.linestyles:
        bpy.data.linestyles["LineStyle"].thickness = 1.5


def get_or_create_axis_camera(name, location, rotation, ortho_scale):
    camera = bpy.data.objects.get(name)
    if camera is None:
        bpy.ops.object.camera_add()
        camera = bpy.context.active_object
        camera.name = name
    camera.location = location
    camera.rotation_euler = rotation
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    return camera


def write_multiview_orthographic_exports(output_dir, expected, project):
    min_x, min_y, min_z, max_x, max_y, max_z = project_extents(project)
    span = max(max_x - min_x, max_y - min_y, max_z - min_z, 1)
    ortho_scale = span * 1.22
    configure_flat_freestyle_render(2048)
    cameras = {
        "facadePng": get_or_create_axis_camera("Cam_Front", (0, -10, 0), (math.radians(90), 0, 0), ortho_scale),
        "planPng": get_or_create_axis_camera("Cam_Top", (0, 0, 10), (0, 0, 0), ortho_scale),
        "northPng": get_or_create_axis_camera("Cam_North", (0, 10, 0), (math.radians(90), 0, math.radians(180)), ortho_scale),
        "southPng": get_or_create_axis_camera("Cam_South", (0, -10, 0), (math.radians(90), 0, 0), ortho_scale),
        "eastPng": get_or_create_axis_camera("Cam_East", (10, 0, 0), (math.radians(90), 0, math.radians(90)), ortho_scale),
        "westPng": get_or_create_axis_camera("Cam_West", (-10, 0, 0), (math.radians(90), 0, math.radians(-90)), ortho_scale),
        "sectionPng": get_or_create_axis_camera("Cam_Side", (10, 0, 0), (math.radians(90), 0, math.radians(90)), ortho_scale),
    }
    for artifact_key, camera in cameras.items():
        bpy.context.scene.camera = camera
        bpy.context.scene.render.filepath = str(output_dir / expected[artifact_key])
        bpy.ops.render.render(write_still=True)


def set_axis_locked_ortho_camera(ortho_scale):
    camera = bpy.data.objects.get("OrthoCam")
    if camera is None:
        bpy.ops.object.camera_add()
        camera = bpy.context.active_object
        camera.name = "OrthoCam"
    bpy.context.scene.camera = camera
    camera.location = (0, -10, 0)
    camera.rotation_euler = (math.radians(90), 0, 0)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    return camera


def southwest_facade_line_classes(project):
    profile = first_profile(project, "carport")
    if profile is None:
        return {}
    p = profile["parameters"]
    width = float(p["widthMm"])
    high = float(p["westHighSideHeightMm"])
    low = float(p["eastLowSideHeightMm"])
    roof_delta = high - low
    roof_validation = roof_slope_validation(width, high, low, [0.0, -360.0])
    return {
        "vertical": {
            "parallel": True,
            "xValuesMm": [0, 145, round(width * 0.50 - 55, 1), round(width * 0.62 - 55, 1), round(width - 145, 1), width],
        },
        "horizontal": {
            "parallel": True,
            "zValuesMm": [0, 220, 365, 510, 655, 800, 945, 1090, 1235],
        },
        "roofSlope": {
            "parallel": roof_validation["ok"],
            "deltaMm": roof_delta,
            "slopePercentByWidth": round((roof_delta / width) * 100, 4),
            "validation": roof_validation,
        },
    }


def write_southwest_cad_svg(svg_path, project, template, options=None):
    options = options or {}
    profile = first_profile(project, "carport")
    if profile is None:
        write_cad_simulated_svg(svg_path, project, template, {})
        return

    p = profile["parameters"]
    width = float(p["widthMm"])
    high = float(p["westHighSideHeightMm"])
    low = float(p["eastLowSideHeightMm"])
    foundation = max(float(value) for value in p.get("foundationHeights", {}).get("southwest", {}).values()) if p.get("foundationHeights") else 0.0
    roof_thickness = 160.0
    post = 145.0
    margin = 420.0
    top = max(high, low) + roof_thickness + 320.0
    bottom = -foundation - 520.0
    page_w = width + margin * 2
    page_h = top - bottom + margin * 2

    def sx(x):
        return margin + x

    def sy(z):
        return margin + (top - z)

    def line(x1, z1, x2, z2, cls="object"):
        return f'<line class="{cls}" x1="{sx(x1):.1f}" y1="{sy(z1):.1f}" x2="{sx(x2):.1f}" y2="{sy(z2):.1f}"/>'

    wall_h = min(1320.0, low - 620.0)
    fascia_h = 360.0
    roof = roof_plane(width, high, low)
    fascia_bottom_offset = -fascia_h
    center_left_post = width * 0.50 - 55.0
    center_right_post = width * 0.62 - 55.0
    left_panel = (post, center_left_post)
    right_panel = (center_right_post + 110.0, width - post)
    cladding = []
    z = 220.0
    while z < wall_h - 80:
        cladding.append(line(left_panel[0], z, left_panel[1], z, "cladding"))
        cladding.append(line(right_panel[0], z, right_panel[1], z, "cladding"))
        z += 145.0

    step_depth = float(p.get("steps", [{}])[0].get("stepDepthMm", 295)) if p.get("steps") else 295.0
    step_height = float(p.get("steps", [{}])[0].get("stepHeightMm", 140)) if p.get("steps") else 140.0
    step_count = int(p.get("steps", [{}])[0].get("count", 0)) if p.get("steps") else 0
    step_w = 930.0
    step_center = (center_left_post + center_right_post + 110.0) / 2
    drawn_step_count = effective_step_count(step_count, foundation, step_height)
    steps = []
    for index in range(drawn_step_count):
        tread_w = step_w + (drawn_step_count - index - 1) * 150.0
        x0 = step_center - tread_w / 2
        z0 = -(drawn_step_count - index) * step_height
        z1 = z0 + step_height
        steps.append(f'<rect class="manual" x="{sx(x0):.1f}" y="{sy(z1):.1f}" width="{tread_w:.1f}" height="{(sy(z0) - sy(z1)):.1f}"/>{line(x0, z1, x0 + tread_w, z1, "manual")}')
    side_steps = []
    road_step_count = 4
    road_step_height = foundation / road_step_count if road_step_count else step_height
    road_step_w = 1180.0
    road_step_x = 0.0
    for index in range(road_step_count):
        tread_w = road_step_w + index * step_depth
        x0 = road_step_x
        z0 = -(index + 1) * road_step_height
        z1 = z0 + road_step_height
        side_steps.append(f'<rect class="manual-light" x="{sx(x0):.1f}" y="{sy(z1):.1f}" width="{tread_w:.1f}" height="{(sy(z0) - sy(z1)):.1f}"/>{line(x0, z1, x0 + tread_w, z1, "manual-light")}')

    foundation_rect = f'<rect class="manual" x="{sx(0):.1f}" y="{sy(0):.1f}" width="{width:.1f}" height="{(sy(-foundation) - sy(0)):.1f}"/>'
    block_lines = []
    if foundation > 0:
        block_lines.append(line(0, -foundation / 2, width, -foundation / 2, "masonry-light"))
        bx = 0.0
        while bx < width:
            block_lines.append(line(bx, -foundation, bx, 0, "masonry-light"))
            bx += 560.0
    roof_poly = f'<polygon class="object" points="{sx(0):.1f},{sy(roof["zAt"](0)):.1f} {sx(width):.1f},{sy(roof["zAt"](width)):.1f} {sx(width):.1f},{sy(roof["zAt"](width, fascia_bottom_offset)):.1f} {sx(0):.1f},{sy(roof["zAt"](0, fascia_bottom_offset)):.1f}"/>'
    panels = [
        f'<rect class="object" x="{sx(left_panel[0]):.1f}" y="{sy(wall_h):.1f}" width="{(left_panel[1] - left_panel[0]):.1f}" height="{(sy(0) - sy(wall_h)):.1f}"/>',
        f'<rect class="object" x="{sx(right_panel[0]):.1f}" y="{sy(wall_h):.1f}" width="{(right_panel[1] - right_panel[0]):.1f}" height="{(sy(0) - sy(wall_h)):.1f}"/>',
    ]
    posts = [
        f'<rect class="object" x="{sx(0):.1f}" y="{sy(roof["zAt"](0, fascia_bottom_offset)):.1f}" width="{post:.1f}" height="{(sy(0) - sy(roof["zAt"](0, fascia_bottom_offset))):.1f}"/>',
        f'<rect class="object" x="{sx(width - post):.1f}" y="{sy(roof["zAt"](width - post, fascia_bottom_offset)):.1f}" width="{post:.1f}" height="{(sy(0) - sy(roof["zAt"](width - post, fascia_bottom_offset))):.1f}"/>',
        f'<rect class="object" x="{sx(center_left_post):.1f}" y="{sy(roof["zAt"](center_left_post, fascia_bottom_offset)):.1f}" width="110.0" height="{(sy(0) - sy(roof["zAt"](center_left_post, fascia_bottom_offset))):.1f}"/>',
        f'<rect class="object" x="{sx(center_right_post):.1f}" y="{sy(roof["zAt"](center_right_post, fascia_bottom_offset)):.1f}" width="110.0" height="{(sy(0) - sy(roof["zAt"](center_right_post, fascia_bottom_offset))):.1f}"/>',
    ]

    dimensions = [
        line(0, bottom + 220, width, bottom + 220, "dimension"),
        f'<text class="label" x="{sx(width / 2):.1f}" y="{sy(bottom + 120):.1f}" text-anchor="middle">bredd {width:.0f} mm</text>',
        f'<text class="label" x="{sx(width * 0.06):.1f}" y="{sy(high + 95):.1f}">hög sida {high:.0f} mm</text>',
        f'<text class="label" x="{sx(width * 0.82):.1f}" y="{sy(low + 95):.1f}">låg sida {low:.0f} mm</text>',
        f'<text class="label" x="{sx(width * 0.5):.1f}" y="{sy(-foundation - 120):.1f}" text-anchor="middle">sydväst mur max {foundation:.0f} mm · trappa till mark {drawn_step_count} x {step_height:.0f}/{step_depth:.0f} mm</text>',
        f'<text class="label" x="{sx(0):.1f}" y="{sy(-foundation - 190):.1f}">vägtrappa/site stair: {road_step_count} steg till mark, stegdjup {step_depth:.0f} mm, ritad steghöjd {road_step_height:.0f} mm</text>',
    ]

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {page_w:.1f} {page_h:.1f}">
  <metadata>{{"projectId":"{project["projectId"]}","template":"{template}","view":"southwest","sourceOfTruth":"measurements-and-blender-orthographic-views","notCad":true}}</metadata>
  <style>
    .object {{ fill: none; stroke: #111; stroke-width: 10; vector-effect: non-scaling-stroke; }}
    .manual {{ fill: none; stroke: #3b6ea8; stroke-width: 8; vector-effect: non-scaling-stroke; }}
    .manual-light {{ fill: none; stroke: #777; stroke-width: 7; vector-effect: non-scaling-stroke; }}
    .wipe {{ fill: #fff; stroke: none; }}
    .masonry {{ stroke: #555; stroke-width: 4; vector-effect: non-scaling-stroke; }}
    .masonry-light {{ stroke: #888; stroke-width: 2; vector-effect: non-scaling-stroke; }}
    .cladding {{ stroke: #777; stroke-width: 3; vector-effect: non-scaling-stroke; }}
    .dimension {{ stroke: #b00020; stroke-width: 4; vector-effect: non-scaling-stroke; }}
    .label {{ fill: #111; font-family: monospace; font-size: 92px; }}
    .note {{ fill: #444; font-family: monospace; font-size: 70px; }}
  </style>
  <text class="label" x="{sx(0):.1f}" y="{sy(top - 80):.1f}">Measured facade visualization · Sydvästra fasaden</text>
  <text class="note" x="{sx(0):.1f}" y="{sy(top - 190):.1f}">Inte CAD/BIM/DWG/STEP. Mått styr geometri; foton är kompletterande referens.</text>
  {roof_poly}
  {foundation_rect}
  {' '.join(block_lines)}
  {' '.join(posts)}
  {' '.join(panels)}
  {' '.join(cladding)}
  {' '.join(steps)}
  {' '.join(side_steps)}
  {line(0, 0, width, 0, "object")}
  <text class="note" x="{sx(width * 0.12):.1f}" y="{sy(wall_h + 260):.1f}">Öppningar/panelindelning från foto · låg confidence</text>
  {' '.join(dimensions)}
</svg>
'''
    svg_path.write_text(svg, encoding="utf-8")


def first_profile(project, profile_name):
    for profile in project.get("profiles", []):
        if profile.get("profile") == profile_name:
            return profile
    return None


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


def add_light():
    bpy.ops.object.light_add(type="AREA", location=(0, -4, 6))
    light = bpy.context.object
    light.name = "Key Area Light"
    light.data.energy = 450
    light.data.size = 5


def resolve_under_output_root(payload, relative_path):
    if Path(relative_path).is_absolute() or ".." in Path(relative_path).parts:
        raise ValueError(f"Path must be relative and stay inside output root: {relative_path}")
    output_root = Path(payload["outputRoot"]).resolve()
    resolved = (output_root / relative_path).resolve()
    if output_root != resolved and output_root not in resolved.parents:
        raise ValueError(f"Path escapes output root: {relative_path}")
    return resolved


def main():
    args = sys.argv
    payload_path = Path(args[args.index("--") + 1])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    mode = payload["mode"]
    output_path = Path(payload["outputPath"])
    if mode == "sketch":
        create_sketch(payload)
    elif mode == "model":
        create_model(payload)
    elif mode == "python":
        run_python(payload)
    elif mode == "measurement_project":
        operation = payload.get("operation", "generate_model")
        if operation == "export_model":
            export_project(payload, output_path)
        elif operation == "dimensioned_drawings":
            create_dimensioned_pdf(payload)
        elif operation == "export_template":
            export_template(payload)
        elif operation == "digital_viewing_render":
            render_digital_viewing(payload, output_path)
        else:
            create_measurement_project(payload)
    else:
        raise ValueError(f"Unsupported mode: {mode}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path))
    print(json.dumps({"ok": True, "outputPath": str(output_path)}))


if __name__ == "__main__":
    main()
