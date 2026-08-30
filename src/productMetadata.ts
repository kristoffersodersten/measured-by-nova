import { readFileSync } from "node:fs";

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
}

function loadPackageMetadata(): { name: "nova-measured"; version: string } {
  const candidates = [new URL("../package.json", import.meta.url), new URL("../../package.json", import.meta.url)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as PackageMetadata;
      if (parsed.name === "nova-measured" && typeof parsed.version === "string" && /^\d+\.\d+\.\d+$/.test(parsed.version)) {
        return { name: parsed.name, version: parsed.version };
      }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== "ENOENT") throw error;
    }
  }
  throw new Error("nova_measured_package_metadata_unavailable");
}

export const ProductMetadata = Object.freeze(loadPackageMetadata());
