import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ExecutionIntentSchema } from "./executionGate.js";
import {
  CapturePackageBindingSchema,
  PublicationCapturePackageSchema,
  type CapturePackageBinding,
  type PublicationCapturePackage
} from "./publicationTrust.js";

const execFileAsync = promisify(execFile);
const KeyIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9_.-]+$/);

export const NativePublicationSigningInputSchema = z.object({
  binding: CapturePackageBindingSchema,
  keyId: KeyIdSchema
}).strict();

export const SignPublicationCaptureInputSchema = NativePublicationSigningInputSchema.extend({
  executionIntent: ExecutionIntentSchema,
  outputPackagePath: z.string().min(1).max(240).refine(
    (value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes(".."),
    "Signed package path must stay inside outputDir."
  )
}).strict();

/** Requests one exact capture-package signature from the native macOS adapter. */
export async function signNativePublicationCapture(input: {
  binding: CapturePackageBinding;
  keyId: string;
  executablePath: string;
  timeoutMs?: number;
}): Promise<PublicationCapturePackage> {
  const payload = NativePublicationSigningInputSchema.parse({ binding: input.binding, keyId: input.keyId });
  if (process.platform !== "darwin") throw new Error("publication_native_signer_macos_required");
  const executablePath = path.resolve(input.executablePath);
  const resolvedExecutable = await realpath(executablePath);
  if (resolvedExecutable !== executablePath) throw new Error("publication_native_signer_symlink_forbidden");
  const executableStat = await stat(resolvedExecutable);
  if (!executableStat.isFile() || (executableStat.mode & 0o111) === 0) {
    throw new Error("publication_native_signer_not_executable");
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "measured-native-sign-"));
  const bindingPath = path.join(temporaryDirectory, "binding.json");
  try {
    await writeFile(bindingPath, `${JSON.stringify(payload.binding)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const { stdout, stderr } = await execFileAsync(resolvedExecutable, [
      "sign", "--key-id", payload.keyId, "--binding-file", bindingPath
    ], {
      encoding: "utf8",
      timeout: Math.min(input.timeoutMs ?? 120_000, 300_000),
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: os.homedir() }
    });
    if (stderr.trim()) throw new Error("publication_native_signer_stderr");
    return PublicationCapturePackageSchema.parse(JSON.parse(stdout));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new Error("publication_native_signer_output_invalid");
    }
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
