import path from "node:path";
import { BlenderConfigSchema, type BlenderConfig } from "./contracts.js";

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "outputs");

export function loadConfig(): BlenderConfig {
  return BlenderConfigSchema.parse({
    blenderPath: process.env.BLENDER_PATH,
    nativePublicationSignerPath: process.env.MEASURED_NATIVE_SIGNER_PATH,
    outputDir: process.env.BLENDER_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR,
    timeoutMs: process.env.BLENDER_TIMEOUT_MS ? Number(process.env.BLENDER_TIMEOUT_MS) : undefined
  });
}
