import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWebViewerPackage, validateWebViewerPackage } from "../src/webViewer.js";

const lock = { artifact: "measurement-projects/demo/artifacts/demo.blend", modelHash: "a".repeat(64), sourceProjectHash: "b".repeat(64) };

describe("web viewer package", () => {
  it("atomically binds offline viewer artifacts to project and model lock", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "measured-viewer-"));
    const source = path.join(root, "source.glb");
    await writeFile(source, Buffer.concat([Buffer.from("glTF"), Buffer.alloc(24)]));
    const result = await buildWebViewerPackage({ outputRoot: root, projectId: "demo", sourceGlb: source, outputDirectory: "delivery/viewer", requestId: "request", modelLock: lock });
    expect(result.manifest.projectId).toBe("demo");
    expect(result.manifest.environment).toEqual({ execution: "local-browser", network: "forbidden", telemetry: false, fallback: "none" });
    expect(await validateWebViewerPackage(path.join(root, result.directory), "demo", lock)).toEqual(result.manifest);
    expect(await readFile(path.join(root, result.directory, "index.html"), "utf8")).toContain("Photorealistic preview");
  });

  it("rejects cross-project and corrupt artifacts causally", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "measured-viewer-corrupt-"));
    const source = path.join(root, "source.glb");
    await writeFile(source, Buffer.concat([Buffer.from("glTF"), Buffer.alloc(24)]));
    const result = await buildWebViewerPackage({ outputRoot: root, projectId: "demo", sourceGlb: source, outputDirectory: "viewer", requestId: "request", modelLock: lock });
    await expect(validateWebViewerPackage(path.join(root, result.directory), "other", lock)).rejects.toThrow("web_viewer_project_mismatch");
    await writeFile(path.join(root, result.directory, "model.glb"), "corrupt");
    await expect(validateWebViewerPackage(path.join(root, result.directory), "demo", lock)).rejects.toThrow("web_viewer_model_invalid");
  });

  it("rejects symlink-escaped output and removes failed staging state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "measured-viewer-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "measured-viewer-outside-"));
    const source = path.join(root, "source.glb");
    await writeFile(source, Buffer.from("invalid"));
    await symlink(outside, path.join(root, "escaped"));
    await expect(buildWebViewerPackage({ outputRoot: root, projectId: "demo", sourceGlb: source, outputDirectory: "escaped/viewer", requestId: "request", modelLock: lock })).rejects.toThrow("web_viewer_path_escape");
    await mkdir(path.join(root, "safe"));
    await expect(buildWebViewerPackage({ outputRoot: root, projectId: "demo", sourceGlb: source, outputDirectory: "safe/viewer", requestId: "request", modelLock: lock })).rejects.toThrow("web_viewer_model_invalid");
    await expect(readFile(path.join(root, "safe", "viewer.tmp-request", "model.glb"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
