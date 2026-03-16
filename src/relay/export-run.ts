/**
 * Agent OS v1.0 — Run-level Relay Export (Slice 7).
 *
 * relayExportRun() bundles an entire run directory into a deterministic
 * tar.gz archive suitable for offline transport.
 *
 * Bundle filename format: run_<runId>_<sha256prefix12>.tar.gz
 *
 * Determinism guarantees (identical to Slice 5 step-level relay):
 *   - Entries sorted lexicographically by relative path
 *   - Fixed mtime = Unix epoch 0
 *   - Compression level 6
 *   - Symlinks rejected at walk time
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { buildTarGz } from "./tar.js";
import { sha256Hex } from "./hash.js";
import type { RunRelayManifestV1 } from "./manifest.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExportRunOptions {
  /** The run identifier (sub-directory name under runsRoot). */
  runId: string;
  /** Root directory that contains per-run directories. */
  runsRoot: string;
  /** Directory to write the resulting .tar.gz bundle into. */
  outDir: string;
  /** When true, overwrite an existing bundle with the same name. */
  overwrite?: boolean;
}

export type ExportRunResult =
  | { ok: true; bundlePath: string }
  | { ok: false; code: string; message: string };

// ── Recursive file walker ──────────────────────────────────────────────────────

/**
 * Recursively walks `dir`, returning relative POSIX paths for all regular files
 * sorted in lexicographic order.  Throws if a symlink is encountered.
 */
function walkFiles(dir: string): string[] {
  const results: string[] = [];

  function recurse(absDir: string, prefix: string): void {
    const entries = readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink found at: ${rel}`);
      } else if (entry.isDirectory()) {
        recurse(join(absDir, entry.name), rel);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  }

  recurse(dir, "");
  results.sort();
  return results;
}

// ── Exporter ───────────────────────────────────────────────────────────────────

export async function relayExportRun(
  opts: ExportRunOptions,
): Promise<ExportRunResult> {
  const { runId, runsRoot, outDir, overwrite = false } = opts;

  // 1. Locate run directory.
  const runDir = join(runsRoot, runId);
  if (!existsSync(runDir)) {
    return {
      ok: false,
      code: "RELAY_EXPORT_RUN_NOT_FOUND",
      message: `Run directory not found: ${runDir}`,
    };
  }

  // 2. Walk files — rejects symlinks.
  let relPaths: string[];
  try {
    relPaths = walkFiles(runDir);
  } catch (e) {
    return {
      ok: false,
      code: "RELAY_EXPORT_RUN_SYMLINK_FOUND",
      message: String(e),
    };
  }

  if (relPaths.length === 0) {
    return {
      ok: false,
      code: "RELAY_EXPORT_RUN_EMPTY",
      message: `Run directory contains no files: ${runDir}`,
    };
  }

  // 3. Read each file and record its sha256 + size.
  type FileRecord = { relPath: string; data: Buffer; sha256: string };
  const fileRecords: FileRecord[] = [];

  for (const relPath of relPaths) {
    let data: Buffer;
    try {
      data = readFileSync(join(runDir, relPath));
    } catch (e) {
      return {
        ok: false,
        code: "RELAY_EXPORT_RUN_READ_FAILED",
        message: String(e),
      };
    }
    fileRecords.push({ relPath, data, sha256: sha256Hex(data) });
  }

  // 4. Build the run-relay manifest (excludes itself from files[]).
  const manifest: RunRelayManifestV1 = {
    relay_format_version: "1",
    run_id: runId,
    files: fileRecords.map((f) => ({
      path: f.relPath,
      sha256: f.sha256,
      bytes: f.data.length,
    })),
  };
  const manifestData = Buffer.from(
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );

  // 5. Build tar entries: manifest first (for easy identification), then files
  //    in lexicographic order (already sorted by walkFiles).
  const tarEntries = [
    { name: "run-relay-manifest.json", data: manifestData },
    ...fileRecords.map((f) => ({ name: f.relPath, data: f.data })),
  ];

  // 6. Compress.
  const archive = await buildTarGz(tarEntries);

  // 7. Compute sha256 of the archive → derive deterministic filename.
  const sha256prefix = sha256Hex(archive).slice(0, 12);
  const filename = `run_${runId}_${sha256prefix}.tar.gz`;

  mkdirSync(outDir, { recursive: true });
  const bundlePath = join(outDir, filename);

  if (!overwrite && existsSync(bundlePath)) {
    return {
      ok: false,
      code: "RELAY_EXPORT_RUN_BUNDLE_EXISTS",
      message: `Bundle already exists: ${bundlePath}`,
    };
  }

  // 8. Write archive.
  writeFileSync(bundlePath, archive);
  return { ok: true, bundlePath };
}
