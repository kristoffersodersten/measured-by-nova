import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { safeOutputPath } from "./blenderRunner.js";

const HashSchema = z.string().length(64).regex(/^[a-f0-9]+$/);
const require = createRequire(import.meta.url);

export const WebViewerManifestSchema = z.object({
  schemaVersion: z.literal(1),
  manifestType: z.literal("measured-web-viewer"),
  projectId: z.string().min(1),
  modelLock: z.object({
    artifact: z.string().min(1),
    modelHash: HashSchema,
    sourceProjectHash: HashSchema
  }).strict(),
  classification: z.object({
    purpose: z.literal("photorealistic-preview"),
    geometryAuthority: z.literal("locked-blender-model"),
    previewIsVerifiedTruth: z.literal(false)
  }).strict(),
  environment: z.object({
    execution: z.literal("local-browser"),
    network: z.literal("forbidden"),
    telemetry: z.literal(false),
    fallback: z.literal("none")
  }).strict(),
  artifacts: z.object({
    html: z.object({ path: z.literal("index.html"), sha256: HashSchema, sizeBytes: z.number().int().positive() }).strict(),
    script: z.object({ path: z.literal("viewer.js"), sha256: HashSchema, sizeBytes: z.number().int().positive() }).strict(),
    library: z.object({ path: z.literal("three.module.js"), sha256: HashSchema, sizeBytes: z.number().int().positive() }).strict(),
    libraryCore: z.object({ path: z.literal("three.core.js"), sha256: HashSchema, sizeBytes: z.number().int().positive() }).strict(),
    loader: z.object({ path: z.literal("GLTFLoader.js"), sha256: HashSchema, sizeBytes: z.number().int().positive() }).strict(),
    geometryUtils: z.object({ path: z.literal("BufferGeometryUtils.js"), sha256: HashSchema, sizeBytes: z.number().int().positive() }).strict(),
    controls: z.object({ path: z.literal("OrbitControls.js"), sha256: HashSchema, sizeBytes: z.number().int().positive() }).strict(),
    model: z.object({ path: z.literal("model.glb"), sha256: HashSchema, sizeBytes: z.number().int().positive() }).strict()
  }).strict(),
  packageHash: HashSchema
}).strict();
export type WebViewerManifest = z.infer<typeof WebViewerManifestSchema>;

export async function buildWebViewerPackage(input: {
  outputRoot: string;
  projectId: string;
  sourceGlb: string;
  outputDirectory: string;
  requestId: string;
  modelLock: { artifact: string; modelHash: string; sourceProjectHash: string };
}): Promise<{ directory: string; manifestPath: string; manifest: WebViewerManifest }> {
  const finalDirectory = safeOutputPath(input.outputRoot, input.outputDirectory);
  await assertParentWithinRoot(input.outputRoot, finalDirectory);
  try {
    await stat(finalDirectory);
    throw new Error("web_viewer_output_exists");
  } catch (error) {
    if (error instanceof Error && error.message === "web_viewer_output_exists") throw error;
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const stagingDirectory = `${finalDirectory}.tmp-${input.requestId}`;
  await rm(stagingDirectory, { recursive: true, force: true });
  try {
    await mkdir(path.dirname(finalDirectory), { recursive: true, mode: 0o700 });
    await assertParentWithinRoot(input.outputRoot, finalDirectory);
    await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
    const modelPath = path.join(stagingDirectory, "model.glb");
    await copyFile(input.sourceGlb, modelPath);
    const model = await glbIdentity(modelPath);

    const htmlPath = path.join(stagingDirectory, "index.html");
    const scriptPath = path.join(stagingDirectory, "viewer.js");
    const threeSource = path.join(path.dirname(require.resolve("three")), "three.module.js");
    const addonsRoot = path.resolve(path.dirname(threeSource), "../examples/jsm");
    const libraryPath = path.join(stagingDirectory, "three.module.js");
    const libraryCorePath = path.join(stagingDirectory, "three.core.js");
    const loaderPath = path.join(stagingDirectory, "GLTFLoader.js");
    const geometryUtilsPath = path.join(stagingDirectory, "BufferGeometryUtils.js");
    const controlsPath = path.join(stagingDirectory, "OrbitControls.js");
    await writeFile(htmlPath, viewerHtml(input.projectId), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(scriptPath, viewerScript(), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await copyFile(threeSource, libraryPath);
    await copyFile(path.join(path.dirname(threeSource), "three.core.js"), libraryCorePath);
    await writeFile(loaderPath, rewriteThreeImport(await readFile(path.join(addonsRoot, "loaders/GLTFLoader.js"), "utf8"), [["../utils/BufferGeometryUtils.js", "./BufferGeometryUtils.js"]]), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(geometryUtilsPath, rewriteThreeImport(await readFile(path.join(addonsRoot, "utils/BufferGeometryUtils.js"), "utf8")), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(controlsPath, rewriteThreeImport(await readFile(path.join(addonsRoot, "controls/OrbitControls.js"), "utf8")), { encoding: "utf8", flag: "wx", mode: 0o600 });
    const [html, script, library, libraryCore, loader, geometryUtils, controls] = await Promise.all([htmlPath, scriptPath, libraryPath, libraryCorePath, loaderPath, geometryUtilsPath, controlsPath].map(artifactIdentity));
    const unsigned = {
      schemaVersion: 1 as const,
      manifestType: "measured-web-viewer" as const,
      projectId: input.projectId,
      modelLock: input.modelLock,
      classification: { purpose: "photorealistic-preview" as const, geometryAuthority: "locked-blender-model" as const, previewIsVerifiedTruth: false as const },
      environment: { execution: "local-browser" as const, network: "forbidden" as const, telemetry: false as const, fallback: "none" as const },
      artifacts: {
        html: { path: "index.html" as const, ...html },
        script: { path: "viewer.js" as const, ...script },
        library: { path: "three.module.js" as const, ...library },
        libraryCore: { path: "three.core.js" as const, ...libraryCore },
        loader: { path: "GLTFLoader.js" as const, ...loader },
        geometryUtils: { path: "BufferGeometryUtils.js" as const, ...geometryUtils },
        controls: { path: "OrbitControls.js" as const, ...controls },
        model: { path: "model.glb" as const, ...model }
      }
    };
    const manifest = WebViewerManifestSchema.parse({ ...unsigned, packageHash: hash(Buffer.from(stableJson(unsigned))) });
    await writeFile(path.join(stagingDirectory, "viewer-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await validateWebViewerPackage(stagingDirectory, input.projectId, input.modelLock);
    await rename(stagingDirectory, finalDirectory);
    return { directory: input.outputDirectory, manifestPath: path.join(input.outputDirectory, "viewer-manifest.json"), manifest };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function validateWebViewerPackage(
  directory: string,
  projectId: string,
  modelLock: { artifact: string; modelHash: string; sourceProjectHash: string }
): Promise<WebViewerManifest> {
  const manifest = WebViewerManifestSchema.parse(JSON.parse(await readFile(path.join(directory, "viewer-manifest.json"), "utf8")));
  if (manifest.projectId !== projectId) throw new Error("web_viewer_project_mismatch");
  if (stableJson(manifest.modelLock) !== stableJson(modelLock)) throw new Error("web_viewer_model_lock_mismatch");
  const { packageHash, ...unsigned } = manifest;
  if (hash(Buffer.from(stableJson(unsigned))) !== packageHash) throw new Error("web_viewer_manifest_hash_mismatch");
  for (const artifact of Object.values(manifest.artifacts)) {
    const identity = artifact.path === "model.glb"
      ? await glbIdentity(path.join(directory, artifact.path))
      : await artifactIdentity(path.join(directory, artifact.path));
    if (identity.sha256 !== artifact.sha256 || identity.sizeBytes !== artifact.sizeBytes) throw new Error(`web_viewer_artifact_mismatch:${artifact.path}`);
  }
  return manifest;
}

async function artifactIdentity(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const bytes = await readFile(filePath);
  if (bytes.byteLength === 0) throw new Error("web_viewer_artifact_empty");
  return { sha256: hash(bytes), sizeBytes: bytes.byteLength };
}

async function glbIdentity(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const bytes = await readFile(filePath);
  if (bytes.byteLength === 0) throw new Error("web_viewer_artifact_empty");
  if (bytes.subarray(0, 4).toString("ascii") !== "glTF") throw new Error("web_viewer_model_invalid");
  return { sha256: hash(bytes), sizeBytes: bytes.byteLength };
}

async function assertParentWithinRoot(root: string, destination: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  let ancestor = path.dirname(destination);
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error("web_viewer_path_escape");
      ancestor = parent;
    }
  }
  if (ancestor !== canonicalRoot && !ancestor.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error("web_viewer_path_escape");
}

function hash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function rewriteThreeImport(source: string, replacements: Array<[string, string]> = []): string {
  return replacements.reduce((result, [from, to]) => result.replaceAll(`'${from}'`, `'${to}'`), source.replaceAll("'three'", "'./three.module.js'"));
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function viewerHtml(projectId: string): string {
  const safeProject = projectId.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self' blob: data:; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Measured viewer · ${safeProject}</title><style>html,body{margin:0;height:100%;background:#111;color:#eee;font:14px system-ui}main{height:100%;display:grid;grid-template-rows:auto 1fr auto}header,footer{padding:12px 16px;background:#191919}h1{font-size:16px;margin:0 0 4px}.truth{color:#b8c7b8}.warning{color:#e8c77b}canvas{width:100%;height:100%;display:block}#status{font-variant-numeric:tabular-nums}</style></head><body data-project-id="${safeProject}"><main><header><h1>Measured by Nova · ${safeProject}</h1><div class="truth">Local browser · network forbidden · telemetry off · fallback none</div><div class="warning">Photorealistic preview. Verified measurements and material evidence remain separately traceable.</div></header><canvas id="viewer" aria-label="Locked measured model preview"></canvas><footer id="status" role="status">Validating package…</footer></main><script type="module" src="viewer.js"></script></body></html>`;
}

function viewerScript(): string {
  return `import * as THREE from "./three.module.js";import{GLTFLoader}from"./GLTFLoader.js";import{OrbitControls}from"./OrbitControls.js";const status=document.getElementById("status"),canvas=document.getElementById("viewer");const fail=e=>{status.textContent="Viewer blocked: "+(e&&e.message?e.message:String(e));document.body.dataset.viewerState="blocked"};const hex=b=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,"0")).join("");const sha=async b=>hex(await crypto.subtle.digest("SHA-256",b));const read=async path=>fetch(path,{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("artifact_missing:"+path);return r.arrayBuffer()});const load=async()=>{if(!window.WebGLRenderingContext||!crypto.subtle)throw Error("unsupported_browser_runtime");const manifest=await fetch("viewer-manifest.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("manifest_missing");return r.json()});if(manifest.projectId!==document.body.dataset.projectId)throw Error("project_identity_mismatch");if(manifest.classification.previewIsVerifiedTruth!==false||manifest.environment.network!=="forbidden"||manifest.environment.telemetry!==false||manifest.environment.fallback!=="none")throw Error("environment_truth_invalid");for(const artifact of Object.values(manifest.artifacts)){const bytes=await read(artifact.path);if(await sha(bytes)!==artifact.sha256)throw Error("artifact_hash_mismatch:"+artifact.path)}const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.setClearColor(0x111111,1);const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x303840,2));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(4,-5,7);scene.add(key);const camera=new THREE.PerspectiveCamera(45,1,.01,1e7);const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;const gltf=await new GLTFLoader().loadAsync(manifest.artifacts.model.path);scene.add(gltf.scene);gltf.scene.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(gltf.scene);if(box.isEmpty())throw Error("model_scene_empty");const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z);camera.position.set(center.x+radius*1.5,center.y-radius*1.5,center.z+radius);camera.near=Math.max(radius/10000,.01);camera.far=Math.max(radius*100,100);camera.updateProjectionMatrix();controls.target.copy(center);controls.update();let meshes=0,primitives=0;gltf.scene.traverse(node=>{if(node.isMesh){meshes+=1;primitives+=Array.isArray(node.material)?node.material.length:1}});if(meshes===0)throw Error("model_meshes_missing");const resize=()=>{const d=Math.min(devicePixelRatio||1,2),w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);renderer.setPixelRatio(d);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};const render=()=>{resize();controls.update();renderer.render(scene,camera);requestAnimationFrame(render)};render();status.textContent="Ready · exact locked model verified · "+manifest.artifacts.model.sha256.slice(0,12)+" · "+meshes+" meshes · "+primitives+" material primitives";document.body.dataset.viewerState="ready";document.body.dataset.meshCount=String(meshes);document.body.dataset.materialPrimitiveCount=String(primitives)};load().catch(fail);`;
}
