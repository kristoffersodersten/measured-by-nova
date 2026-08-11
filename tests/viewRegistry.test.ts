import { describe, expect, it } from "vitest";
import { buildOrthographicViewRegistry, validateRequiredViews } from "../src/viewRegistry.js";

const elements = [{ boundsMm: { x: 0, y: 0, z: 0, width: 8000, depth: 6000, height: 3500 } }];

describe("orthographic view registry", () => {
  it("builds stable named camera definitions in canonical order", () => {
    const first = buildOrthographicViewRegistry(elements, ["west", "north", "south", "east"]);
    const second = buildOrthographicViewRegistry(elements, ["east", "south", "north", "west"]);
    expect(second).toEqual(first);
    expect(first.views.map((view) => view.name)).toEqual(["north", "south", "east", "west"]);
    expect(first.views.every((view) => view.projection === "orthographic" && view.targetCollection === "MeasuredGeometry")).toBe(true);
    expect(first.registryHash).toHaveLength(64);
  });

  it("reports missing required facade views", () => {
    const registry = buildOrthographicViewRegistry(elements, ["north", "south", "east"]);
    expect(validateRequiredViews(registry, ["north", "south", "east", "west"])).toEqual({
      ok: false,
      missing: ["west"],
      hashValid: true
    });
  });

  it("rejects a mutated registry hash", () => {
    const registry = buildOrthographicViewRegistry(elements, ["north", "south", "east", "west"]);
    registry.views[0].orthoScaleMm += 1;
    expect(validateRequiredViews(registry, ["north", "south", "east", "west"])).toMatchObject({ ok: false, hashValid: false });
  });
});
