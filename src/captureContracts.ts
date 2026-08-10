import { z } from "zod";

export const CaptureRequirementKindSchema = z.enum(["required", "optional", "assumption"]);
export const CaptureImpactSchema = z.enum(["geometry", "perception", "none"]);
export const CaptureVerificationSchema = z.enum(["verified", "missing", "assumed"]);

export const CaptureRequirementSchema = z.object({
  id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/),
  label: z.string().min(1).max(160),
  kind: CaptureRequirementKindSchema,
  impact: CaptureImpactSchema,
  verification: CaptureVerificationSchema,
  source: z.enum(["measurement", "drawing", "photo", "user", "system"]),
  notes: z.string().min(1).max(500).optional()
}).strict();
export type CaptureRequirement = z.infer<typeof CaptureRequirementSchema>;

export const CaptureContractSchema = z.object({
  schemaVersion: z.literal(1),
  contractId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/),
  projectType: z.enum(["carport", "simple-shed", "generic-structure"]),
  requirements: z.array(CaptureRequirementSchema).min(1),
  exportPolicy: z.object({
    blockUnverifiedGeometry: z.literal(true),
    allowPerceptionAssumptions: z.boolean().default(true),
    photosAuthoritative: z.literal(false)
  }).strict().default({
    blockUnverifiedGeometry: true,
    allowPerceptionAssumptions: true,
    photosAuthoritative: false
  })
}).strict();
export type CaptureContract = z.infer<typeof CaptureContractSchema>;

export const CaptureValidationResultSchema = z.object({
  ok: z.boolean(),
  blocking: z.array(z.object({
    id: z.string(),
    code: z.enum(["geometry_not_verified", "required_capture_missing"]),
    message: z.string()
  }).strict()),
  warnings: z.array(z.object({
    id: z.string(),
    code: z.enum(["perception_not_verified"]),
    message: z.string()
  }).strict())
}).strict();
export type CaptureValidationResult = z.infer<typeof CaptureValidationResultSchema>;

export function validateCaptureContract(contract: CaptureContract): CaptureValidationResult {
  const blocking: CaptureValidationResult["blocking"] = [];
  const warnings: CaptureValidationResult["warnings"] = [];

  for (const requirement of contract.requirements) {
    if (
      contract.exportPolicy.blockUnverifiedGeometry
      && requirement.impact === "geometry"
      && requirement.verification !== "verified"
    ) {
      blocking.push({
        id: requirement.id,
        code: "geometry_not_verified",
        message: "Geometry-impacting capture fields must be verified before export."
      });
    }
    if (requirement.kind === "required" && requirement.verification === "missing") {
      blocking.push({
        id: requirement.id,
        code: "required_capture_missing",
        message: "Required capture field is missing."
      });
    }
    if (requirement.impact === "perception" && requirement.verification !== "verified") {
      warnings.push({
        id: requirement.id,
        code: "perception_not_verified",
        message: "Perception-only field is not verified; output must label it as reference or assumption."
      });
    }
  }

  return CaptureValidationResultSchema.parse({
    ok: blocking.length === 0,
    blocking,
    warnings
  });
}

export const CarportCaptureContractFixture = CaptureContractSchema.parse({
  schemaVersion: 1,
  contractId: "carport-facade-completion-v1",
  projectType: "carport",
  requirements: [
    { id: "width", label: "Overall width", kind: "required", impact: "geometry", verification: "verified", source: "measurement" },
    { id: "depth", label: "Overall depth", kind: "required", impact: "geometry", verification: "verified", source: "measurement" },
    { id: "high-side-height", label: "High side height", kind: "required", impact: "geometry", verification: "verified", source: "measurement" },
    { id: "low-side-height", label: "Low side height", kind: "required", impact: "geometry", verification: "verified", source: "measurement" },
    { id: "facade-photos", label: "Facade reference photos", kind: "required", impact: "perception", verification: "verified", source: "photo" },
    { id: "material-notes", label: "Material and color notes", kind: "optional", impact: "perception", verification: "assumed", source: "user" }
  ]
});
