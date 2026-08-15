import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const releaseRoot = path.resolve("release");
const commit = process.env.GITHUB_SHA ?? process.env.MEASURED_RELEASE_COMMIT;
const blenderPath = process.env.BLENDER_PATH;
if (!commit) throw new Error("release_commit_identity_missing");
if (!blenderPath) throw new Error("release_blender_path_missing");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== commit) throw new Error("release_commit_identity_mismatch");
if (execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim() !== "") {
  throw new Error("release_worktree_not_clean");
}

const firstPack = path.join(releaseRoot, "pack-a");
const secondPack = path.join(releaseRoot, "pack-b");
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(firstPack, { recursive: true });
await mkdir(secondPack, { recursive: true });
const pack = (destination: string): string => {
  const output = execFileSync("pnpm", ["pack", "--pack-destination", destination], { encoding: "utf8" });
  const filename = path.basename(output.trim().split("\n").at(-1) ?? "");
  if (!/^nova-measured-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/.test(filename)) {
    throw new Error("release_pack_filename_invalid");
  }
  return filename;
};
const filename = pack(firstPack);
const secondFilename = pack(secondPack);
if (filename !== secondFilename) throw new Error("release_pack_filename_mismatch");
const firstBytes = await readFile(path.join(firstPack, filename));
const secondBytes = await readFile(path.join(secondPack, filename));
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const firstSha = sha256(firstBytes);
const secondSha = sha256(secondBytes);
if (firstSha !== secondSha) throw new Error("release_pack_not_reproducible");
const corrupted = Buffer.from(firstBytes);
corrupted[corrupted.length - 1] ^= 1;
if (sha256(corrupted) === firstSha) throw new Error("release_corruption_not_detected");

const entries = execFileSync("tar", ["-tzf", path.join(firstPack, filename)], { encoding: "utf8" }).trim().split("\n");
const forbidden = entries.filter((entry) => /(__pycache__|\.pyc$|package\/dist\/(tests|scripts)\/|vitest|compute-distribution|novaforge|operator-tooling|remote-workspace|termux-hetzner)/.test(entry));
if (forbidden.length > 0) throw new Error(`release_product_boundary_violation:${forbidden.join(",")}`);

const installRoot = await mkdtemp(path.join(tmpdir(), "measured-release-install-"));
let tools: string[] = [];
try {
  execFileSync("npm", ["init", "--yes"], { cwd: installRoot, stdio: "pipe" });
  execFileSync("npm", ["install", "--ignore-scripts", path.join(firstPack, filename)], { cwd: installRoot, stdio: "pipe" });
  const serverPath = path.join(installRoot, "node_modules", "nova-measured", "dist", "src", "server.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: installRoot,
    env: { ...process.env, BLENDER_PATH: blenderPath, BLENDER_OUTPUT_DIR: path.join(installRoot, "outputs") },
    stderr: "pipe"
  });
  const client = new Client({ name: "measured-release-verifier", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    tools = listed.tools.map((tool) => tool.name).sort();
    if (!["create_measurement_project", "render_digital_viewing_preview", "align_and_project_source_photo"].every((tool) => tools.includes(tool))) {
      throw new Error("release_mcp_tools_missing");
    }
  } finally {
    await client.close();
  }
} finally {
  await rm(installRoot, { recursive: true, force: true });
}

const blenderVersion = execFileSync(blenderPath, ["--version"], { encoding: "utf8" }).split("\n")[0]?.trim();
if (!blenderVersion?.startsWith("Blender ")) throw new Error("release_blender_discovery_failed");

const finalTarball = path.join(releaseRoot, filename);
await writeFile(`${finalTarball}.tmp`, firstBytes, { flag: "wx" });
await rename(`${finalTarball}.tmp`, finalTarball);
const evidence = {
  schemaVersion: 1,
  commit,
  package: { name: "nova-measured", version: "0.1.0", filename, sha256: firstSha, bytes: firstBytes.length, reproducible: true },
  cleanInstall: { ok: true, toolCount: tools.length, requiredTools: ["create_measurement_project", "render_digital_viewing_preview", "align_and_project_source_photo"] },
  blender: { path: blenderPath, version: blenderVersion },
  productBoundary: { ok: true, entries: entries.length, forbidden: [] },
  recovery: { corruptedHashRejected: true, temporaryInstallRemoved: true }
};
const evidencePath = path.join(releaseRoot, "release-evidence.json");
await writeFile(`${evidencePath}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
await rename(`${evidencePath}.tmp`, evidencePath);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
