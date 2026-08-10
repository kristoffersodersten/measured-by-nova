import { z } from "zod";

export const BlenderConfigSchema = z.object({
  blenderPath: z.string().optional(),
  outputDir: z.string().default("outputs"),
  timeoutMs: z.number().int().positive().max(300_000).default(120_000)
});

export type BlenderConfig = z.infer<typeof BlenderConfigSchema>;

const NameSchema = z.string().min(1).max(80).regex(/^[\w .:-]+$/);
const RelativePathSchema = z
  .string()
  .min(1)
  .max(180)
  .refine((value) => !value.startsWith("/") && !value.includes(".."), "Path must stay inside outputDir.");
const Vector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const SceneFileSchema = RelativePathSchema.default("scene.blend");

export const SketchStrokeSchema = z.object({
  points: z.array(z.tuple([z.number(), z.number()])).min(2),
  color: HexColorSchema.default("#111111"),
  width: z.number().positive().max(64).default(3)
}).strict();

export const CreateSketchSchema = z.object({
  name: NameSchema.default("measured-sketch"),
  strokes: z.array(SketchStrokeSchema).min(1),
  backgroundColor: HexColorSchema.default("#ffffff"),
  outputFile: RelativePathSchema.default("sketch.blend")
}).strict();

export type CreateSketchInput = z.infer<typeof CreateSketchSchema>;

export const ModelPrimitiveSchema = z.object({
  kind: z.enum(["cube", "sphere", "cylinder", "cone", "torus"]),
  name: NameSchema.optional(),
  location: Vector3Schema.default([0, 0, 0]),
  scale: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).default([1, 1, 1]),
  rotation: Vector3Schema.default([0, 0, 0]),
  color: HexColorSchema.default("#8fb3ff")
}).strict();

export const CreateModelSchema = z.object({
  name: NameSchema.default("measured-model"),
  primitives: z.array(ModelPrimitiveSchema).min(1).max(128),
  camera: z
    .object({
      location: Vector3Schema.default([5, -7, 5]),
      target: Vector3Schema.default([0, 0, 0])
    })
    .strict()
    .default({}),
  outputFile: RelativePathSchema.default("model.blend")
}).strict();

export type CreateModelInput = z.infer<typeof CreateModelSchema>;

export const RunPythonSchema = z.object({
  code: z.string().min(1).max(20_000),
  sceneFile: SceneFileSchema,
  outputFile: RelativePathSchema.optional(),
  unsafeAllowExecution: z.literal(true),
  allowImports: z.array(z.enum(["bpy", "math"])).default(["bpy", "math"])
}).strict();

export type RunPythonInput = z.infer<typeof RunPythonSchema>;

export const CreateObjectSchema = z.object({
  sceneFile: SceneFileSchema,
  name: NameSchema.optional(),
  type: z.enum(["cube", "sphere", "plane"]),
  location: Vector3Schema.default([0, 0, 0]),
  size: z.number().positive().max(100).default(1)
}).strict();

export const CreateLightSchema = z.object({
  sceneFile: SceneFileSchema,
  name: NameSchema.optional(),
  type: z.enum(["point", "sun", "area"]),
  location: Vector3Schema.default([0, 0, 4]),
  energy: z.number().nonnegative().max(100_000).default(500)
}).strict();

export const CreateCameraSchema = z.object({
  sceneFile: SceneFileSchema,
  name: NameSchema.optional(),
  location: Vector3Schema.default([5, -7, 5]),
  rotation: Vector3Schema.default([60, 0, 35])
}).strict();

export const SetMaterialSchema = z.object({
  sceneFile: SceneFileSchema,
  objectName: NameSchema,
  materialType: z.enum(["principled", "diffuse"]).default("principled"),
  color: HexColorSchema
}).strict();

export const ApplyModifierSchema = z.object({
  sceneFile: SceneFileSchema,
  objectName: NameSchema,
  modifierType: z.enum(["bevel", "subdivision", "solidify"]),
  params: z
    .object({
      width: z.number().positive().max(10).optional(),
      segments: z.number().int().min(1).max(16).optional(),
      levels: z.number().int().min(0).max(6).optional(),
      thickness: z.number().positive().max(10).optional()
    })
    .strict()
    .default({})
}).strict();

export const ExtrudeMeshSchema = z.object({
  sceneFile: SceneFileSchema,
  objectName: NameSchema,
  amount: z.number().finite().min(-100).max(100)
}).strict();

export const ExportModelSchema = z.object({
  sceneFile: SceneFileSchema,
  format: z.enum(["glb", "obj"]),
  outputPath: RelativePathSchema
}).strict();

export const RenderPreviewSchema = z.object({
  sceneFile: SceneFileSchema,
  outputPath: RelativePathSchema.default("preview.png"),
  cameraName: NameSchema.optional()
}).strict();

export const SceneFileOnlySchema = z.object({
  sceneFile: SceneFileSchema
}).strict();

export const GetObjectInfoSchema = z.object({
  sceneFile: SceneFileSchema,
  name: NameSchema
}).strict();

export type CreateObjectInput = z.infer<typeof CreateObjectSchema>;
export type CreateLightInput = z.infer<typeof CreateLightSchema>;
export type CreateCameraInput = z.infer<typeof CreateCameraSchema>;
export type SetMaterialInput = z.infer<typeof SetMaterialSchema>;
export type ApplyModifierInput = z.infer<typeof ApplyModifierSchema>;
export type ExtrudeMeshInput = z.infer<typeof ExtrudeMeshSchema>;
export type ExportModelInput = z.infer<typeof ExportModelSchema>;
export type RenderPreviewInput = z.infer<typeof RenderPreviewSchema>;

export interface BlenderToolResult {
  ok: boolean;
  requestId?: string;
  outputPath?: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
  stdout: string;
  stderr: string;
}
