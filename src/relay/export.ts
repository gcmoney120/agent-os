import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "./hash.js";
import { buildTarGz } from "./tar.js";
import type { RelayManifestV1 } from "./manifest.js";

export interface ExportOptions {
  runId: string;
  step: string;          // step_id or step_index (as string)
  artifactsRoot: string; // run artifacts root — contains steps/ subdirectory
  outDir: string;        // directory where the .tar.gz bundle is written
}

export type ExportResult =
  | { ok: true; bundlePath: string; bundleName: string }
  | { ok: false; code: string; message: string };

function collectFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...collectFiles(join(dir, ent.name), rel));
    else if (ent.isFile()) out.push(rel);
  }
  return out.sort();
}

export async function relayExport(opts: ExportOptions): Promise<ExportResult> {
  const { runId, step, artifactsRoot, outDir } = opts;
  const stepsRoot = join(artifactsRoot, "steps");

  // Locate step directory
  let stepDir: string | undefined;
  let stepIndex: number | undefined;
  let stepId: string | undefined;

  try {
    for (const ent of readdirSync(stepsRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const dash = ent.name.indexOf("-");
      if (dash === -1) continue;
      const idxStr = ent.name.slice(0, dash);
      const sid = ent.name.slice(dash + 1);
      if (sid === step || idxStr === step) {
        stepDir = join(stepsRoot, ent.name);
        stepIndex = parseInt(idxStr, 10);
        stepId = sid;
        break;
      }
    }
  } catch {
    return { ok: false, code: "RELAY_EXPORT_STEP_NOT_FOUND", message: `Cannot read: ${stepsRoot}` };
  }

  if (!stepDir || stepIndex === undefined || !stepId) {
    return { ok: false, code: "RELAY_EXPORT_STEP_NOT_FOUND", message: `Step not found: ${step}` };
  }

  // Require step-report.json
  if (!existsSync(join(stepDir, "step-report.json"))) {
    return { ok: false, code: "RELAY_EXPORT_MISSING_STEP_REPORT", message: "step-report.json missing" };
  }

  // Read actor/action from step-report
  let actor = "unknown";
  let action = "unknown";
  try {
    const r = JSON.parse(readFileSync(join(stepDir, "step-report.json"), "utf8")) as Record<string, unknown>;
    if (typeof r["actor"] === "string") actor = r["actor"];
    if (typeof r["action"] === "string") action = r["action"];
  } catch { /* keep defaults */ }

  // Collect step files (lexicographic)
  const relPaths = collectFiles(stepDir);
  const fileData = new Map(relPaths.map((p) => [p, readFileSync(join(stepDir!, p))]));

  const manifest: RelayManifestV1 = {
    relay_format_version: "1",
    run_id: runId,
    step_index: stepIndex,
    step_id: stepId,
    actor,
    action,
    files: relPaths.map((p) => {
      const d = fileData.get(p)!;
      return { path: p, sha256: sha256Hex(d), bytes: d.length };
    }),
    review_targets: ["step-report.json"],
  };

  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // Build sorted tar entries (relay-manifest.json + step files)
  const tarEntries = [
    { name: "relay-manifest.json", data: manifestBuf },
    ...relPaths.map((p) => ({ name: p, data: fileData.get(p)! })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const archiveBuf = await buildTarGz(tarEntries);
  const sha256Prefix = sha256Hex(archiveBuf).slice(0, 12);
  const bundleName = `relay_${runId}_${stepIndex}_${stepId}_${sha256Prefix}.tar.gz`;

  mkdirSync(outDir, { recursive: true });
  const bundlePath = join(outDir, bundleName);

  if (existsSync(bundlePath)) {
    return { ok: false, code: "RELAY_EXPORT_BUNDLE_EXISTS", message: `Bundle already exists: ${bundlePath}` };
  }

  writeFileSync(bundlePath, archiveBuf);
  return { ok: true, bundlePath, bundleName };
}
