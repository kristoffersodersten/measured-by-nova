import { describe, expect, it } from "vitest";
import { DefaultCapabilityManifest } from "../src/capabilityManifest.js";
import { ProductMetadata } from "../src/productMetadata.js";

describe("published product metadata", () => {
  it("uses the package version for every imported runtime surface", () => {
    expect(ProductMetadata).toEqual({ name: "nova-measured", version: "0.2.0" });
    expect(DefaultCapabilityManifest.bridgeVersion).toBe(ProductMetadata.version);
  });
});
