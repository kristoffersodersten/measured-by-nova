import { z } from "zod";
import {
  ConfidenceSchema,
  MaterialColorReferenceSchema,
  MaterialPbrPreviewSchema,
  MaterialSourceSchema,
  type MaterialNote
} from "./measurementContracts.js";

const MaterialScopeShape = {
  facade: z.enum(["north", "south", "east", "west", "all"]).optional(),
  elementId: z.string().min(1).max(80).optional()
};

export const PermitMaterialMetadataSchema = z.object({
  ...MaterialScopeShape,
  material: z.string().min(1).max(120),
  colorNote: z.string().min(1).max(160).optional(),
  colorReference: MaterialColorReferenceSchema.optional(),
  confidence: ConfidenceSchema,
  source: MaterialSourceSchema,
  verified: z.boolean()
}).strict().refine((value) => value.facade !== undefined || value.elementId !== undefined, {
  message: "Material metadata must target a facade or element."
});

export const PreviewMaterialMetadataSchema = z.object({
  ...MaterialScopeShape,
  material: z.string().min(1).max(120),
  colorNote: z.string().min(1).max(160).optional(),
  colorReference: MaterialColorReferenceSchema.optional(),
  confidence: ConfidenceSchema,
  source: MaterialSourceSchema,
  verified: z.boolean(),
  outputClassification: z.literal("photorealistic-preview"),
  geometryAuthority: z.literal(false),
  pbrPreview: MaterialPbrPreviewSchema.optional()
}).strict().refine((value) => value.facade !== undefined || value.elementId !== undefined, {
  message: "Material metadata must target a facade or element."
});

export function buildPermitMaterialMetadata(notes: MaterialNote[]): Array<z.infer<typeof PermitMaterialMetadataSchema>> {
  return notes.map((note) => PermitMaterialMetadataSchema.parse({
    facade: note.facade,
    elementId: note.elementId,
    material: note.material,
    colorNote: note.colorNote,
    colorReference: note.colorReference,
    confidence: note.confidence,
    source: note.source,
    verified: note.verified
  }));
}

export function buildPreviewMaterialMetadata(notes: MaterialNote[]): Array<z.infer<typeof PreviewMaterialMetadataSchema>> {
  return notes.map((note) => PreviewMaterialMetadataSchema.parse({
    ...note,
    outputClassification: "photorealistic-preview",
    geometryAuthority: false
  }));
}
