import { describe, expect, it } from "vitest";
import { CaptureContractSchema, CarportCaptureContractFixture, validateCaptureContract } from "../src/captureContracts.js";

describe("capture contract", () => {
  it("accepts the carport facade completion capture contract", () => {
    expect(CarportCaptureContractFixture.contractId).toBe("carport-facade-completion-v1");
    expect(validateCaptureContract(CarportCaptureContractFixture)).toMatchObject({ ok: true, blocking: [] });
  });

  it("blocks unverified geometry-impacting fields", () => {
    const contract = CaptureContractSchema.parse({
      ...CarportCaptureContractFixture,
      requirements: CarportCaptureContractFixture.requirements.map((requirement) =>
        requirement.id === "width" ? { ...requirement, verification: "assumed" } : requirement
      )
    });

    const result = validateCaptureContract(contract);

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "width",
      code: "geometry_not_verified",
      message: "Geometry-impacting capture fields must be verified before export."
    });
  });

  it("warns but does not block unverified perception-only fields", () => {
    const contract = CaptureContractSchema.parse({
      ...CarportCaptureContractFixture,
      requirements: CarportCaptureContractFixture.requirements.map((requirement) =>
        requirement.id === "material-notes" ? { ...requirement, verification: "assumed" } : requirement
      )
    });

    const result = validateCaptureContract(contract);

    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({
      id: "material-notes",
      code: "perception_not_verified",
      message: "Perception-only field is not verified; output must label it as reference or assumption."
    });
  });
});
