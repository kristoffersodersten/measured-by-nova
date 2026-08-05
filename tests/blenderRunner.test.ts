import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeOutputPath, validateBlenderJobInputFiles } from "../src/blenderRunner.js";

const OnePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

async function writeFileUnderOutput(outputDir: string, relativePath: string): Promise<void> {
  const resolvedPath = path.join(outputDir, relativePath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, OnePixelPng);
}

describe("safeOutputPath", () => {
  it("keeps generated files inside outputDir", () => {
    const output = safeOutputPath("/tmp/blender-output", "model.blend");

    expect(output).toBe(path.resolve("/tmp/blender-output/model.blend"));
  });

  it("rejects path traversal", () => {
    expect(() => safeOutputPath("/tmp/blender-output", "../escape.blend")).toThrow(
      "Invalid outputFile outside outputDir"
    );
  });

  it("rejects premium digital viewing render jobs with missing texture files", async () => {
    await expect(validateBlenderJobInputFiles("/tmp/blender-output", {
      operation: "digital_viewing_render",
      renderManifest: {
        renderPreset: { deliveryTier: "premium-sales" },
        materials: [
          {
            materialId: "paint",
            textureMaps: [
              { path: "textures/missing-normal.png", type: "normal" },
              { path: "textures/missing-roughness.png", type: "roughness" }
            ]
          }
        ]
      }
    })).rejects.toThrow("Missing required digital viewing texture files: textures/missing-normal.png, textures/missing-roughness.png");
  });

  it("allows non-premium digital viewing render jobs to report texture files at render time", async () => {
    await expect(validateBlenderJobInputFiles("/tmp/blender-output", {
      operation: "digital_viewing_render",
      renderManifest: {
        renderPreset: { deliveryTier: "draft-preview" },
        materials: [
          {
            materialId: "paint",
            textureMaps: [{ path: "textures/missing-normal.png", type: "normal" }]
          }
        ]
      }
    })).resolves.toBeUndefined();
  });

  it("rejects premium digital viewing render jobs with missing reference photos", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-input-files-"));
    await writeFileUnderOutput(outputDir, "textures/normal.png");

    await expect(validateBlenderJobInputFiles(outputDir, {
      operation: "digital_viewing_render",
      renderManifest: {
        renderPreset: {
          deliveryTier: "premium-sales",
          camera: { referencePhoto: "photos/front.jpg" },
          lighting: { referencePhoto: "photos/site.jpg" }
        },
        materials: [
          {
            materialId: "paint",
            photoSources: ["photos/material.jpg"],
            appearanceCalibration: { sourcePhoto: "photos/calibration.jpg" },
            surfaceMapping: { sourcePhoto: "photos/mapping.jpg" },
            textureMaps: [{ path: "textures/normal.png", type: "normal", sourcePhoto: "photos/texture.jpg" }]
          }
        ],
        conditions: [
          { id: "scratch", photoSources: ["photos/condition.jpg"] }
        ]
      }
    })).rejects.toThrow(
      "Missing required digital viewing reference photos: photos/calibration.jpg, photos/condition.jpg, photos/front.jpg, photos/mapping.jpg, photos/material.jpg, photos/site.jpg, photos/texture.jpg"
    );
  });
});
