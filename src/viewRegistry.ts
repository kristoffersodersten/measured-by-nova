import { createHash } from "node:crypto";
import { z } from "zod";

export const OrthographicViewNameSchema = z.enum(["plan", "north", "south", "east", "west", "section_a_a"]);
export type OrthographicViewName = z.infer<typeof OrthographicViewNameSchema>;

const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const OrthographicViewDefinitionSchema = z.object({
  name: OrthographicViewNameSchema,
  projection: z.literal("orthographic"),
  cameraLocationMm: Vec3Schema,
  targetMm: Vec3Schema,
  upVector: Vec3Schema,
  orthoScaleMm: z.number().finite().positive(),
  clipStartMm: z.number().finite().positive(),
  clipEndMm: z.number().finite().positive(),
  targetCollection: z.literal("MeasuredGeometry")
}).strict();
export type OrthographicViewDefinition = z.infer<typeof OrthographicViewDefinitionSchema>;

export const OrthographicViewRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  views: z.array(OrthographicViewDefinitionSchema),
  registryHash: z.string().length(64)
}).strict();
export type OrthographicViewRegistry = z.infer<typeof OrthographicViewRegistrySchema>;

type BoundsElement = { boundsMm: { x: number; y: number; z: number; width: number; depth: number; height: number } };
const ViewOrder: OrthographicViewName[] = ["plan", "north", "south", "east", "west", "section_a_a"];

export function buildOrthographicViewRegistry(elements: BoundsElement[], requested: OrthographicViewName[]): OrthographicViewRegistry {
  if (elements.length === 0) throw new Error("Cannot build orthographic view registry without measured geometry.");
  const minX = Math.min(...elements.map((element) => element.boundsMm.x));
  const minY = Math.min(...elements.map((element) => element.boundsMm.y));
  const minZ = Math.min(...elements.map((element) => element.boundsMm.z));
  const maxX = Math.max(...elements.map((element) => element.boundsMm.x + element.boundsMm.width));
  const maxY = Math.max(...elements.map((element) => element.boundsMm.y + element.boundsMm.depth));
  const maxZ = Math.max(...elements.map((element) => element.boundsMm.z + element.boundsMm.height));
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1000);
  const distance = span * 1.5;
  const definitions: Record<OrthographicViewName, [number, number, number]> = {
    plan: [center[0], center[1], maxZ + distance],
    north: [center[0], maxY + distance, center[2]],
    south: [center[0], minY - distance, center[2]],
    east: [maxX + distance, center[1], center[2]],
    west: [minX - distance, center[1], center[2]],
    section_a_a: [center[0], minY - span, center[2]]
  };
  const selected = new Set(requested);
  const views = ViewOrder.filter((name) => selected.has(name)).map((name) => ({
    name,
    projection: "orthographic" as const,
    cameraLocationMm: definitions[name],
    targetMm: name === "plan" ? [center[0], center[1], minZ] as [number, number, number] : center,
    upVector: name === "plan" ? [0, 1, 0] as [number, number, number] : [0, 0, 1] as [number, number, number],
    orthoScaleMm: span * 1.25,
    clipStartMm: Math.max(1, span * 0.001),
    clipEndMm: span * 10,
    targetCollection: "MeasuredGeometry" as const
  }));
  return OrthographicViewRegistrySchema.parse({ schemaVersion: 1, views, registryHash: hashViews(views) });
}

export function validateRequiredViews(registry: OrthographicViewRegistry | undefined, required: OrthographicViewName[]) {
  if (!registry) return { ok: false, missing: [...required], hashValid: false };
  const names = new Set(registry.views.map((view) => view.name));
  const missing = required.filter((name) => !names.has(name));
  return { ok: missing.length === 0 && hashViews(registry.views) === registry.registryHash, missing, hashValid: hashViews(registry.views) === registry.registryHash };
}

function hashViews(views: OrthographicViewDefinition[]): string {
  return createHash("sha256").update(JSON.stringify(views)).digest("hex");
}
