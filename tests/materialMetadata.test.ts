import { describe, expect, it } from "vitest";
import { MaterialNoteSchema } from "../src/measurementContracts.js";
import { buildPermitMaterialMetadata, buildPreviewMaterialMetadata } from "../src/materialMetadata.js";

const note = MaterialNoteSchema.parse({
  elementId: "south-cladding",
  material: "white-painted-wood",
  colorNote: "White painted horizontal cladding",
  colorReference: { standard: "NCS", code: "S 0502-Y" },
  pbrPreview: { previewOnly: true, geometryAuthority: false, baseColor: "#f4f2e8", roughness: 0.48, metallic: 0 },
  confidence: "medium",
  source: "photo_reference",
  verified: true
});

describe("material output metadata", () => {
  it("keeps structured color evidence but strips PBR fields from permit metadata", () => {
    const permit = buildPermitMaterialMetadata([note]);
    expect(permit).toEqual([expect.objectContaining({
      elementId: "south-cladding",
      colorReference: { standard: "NCS", code: "S 0502-Y" },
      confidence: "medium",
      source: "photo_reference"
    })]);
    expect(permit[0]).not.toHaveProperty("pbrPreview");
  });

  it("exposes PBR metadata only as a non-authoritative preview", () => {
    const preview = buildPreviewMaterialMetadata([note]);
    expect(preview[0]?.outputClassification).toBe("photorealistic-preview");
    expect(preview[0]?.geometryAuthority).toBe(false);
    expect(preview[0]?.pbrPreview?.previewOnly).toBe(true);
    expect(preview[0]?.pbrPreview?.geometryAuthority).toBe(false);
  });

  it("rejects unscoped material metadata and authoritative PBR fields", () => {
    expect(() => MaterialNoteSchema.parse({ ...note, facade: undefined, elementId: undefined })).toThrow();
    expect(() => MaterialNoteSchema.parse({ ...note, pbrPreview: { ...note.pbrPreview, geometryAuthority: true } })).toThrow();
  });
});
